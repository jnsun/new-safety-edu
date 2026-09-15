import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import archiver from "archiver";
import { Prisma, type SensitiveExportScopeType } from "@prisma/client";
import type { Principal } from "./auth.js";
import { decryptNationalId } from "./crypto.js";
import { prisma } from "./db.js";
import type { Env } from "./env.js";
import { assertSensitiveExportScopeAllowed, sanitizeAuditValue, sensitiveExportLifetimeMs } from "./sensitive-export-policy.js";

export const sensitiveExportCategories = ["photos", "signatures", "certificates", "training_attachments", "audit"] as const;
export type SensitiveExportCategory = typeof sensitiveExportCategories[number];
type ScopeInput = { scopeType: SensitiveExportScopeType; scopeId: string | null };
type ScopeSnapshot = ScopeInput & { name: string; projectResponsibleOrganizationId?: string; requesterPersonId?: string | null; cutoffAt: string };
type ExportFile = { id: string; category: Exclude<SensitiveExportCategory, "audit">; storageKey: string; originalName: string; size: number; sha256: string };

async function resolveScope(principal: Principal, input: ScopeInput): Promise<ScopeSnapshot> {
  const cutoffAt = new Date().toISOString();
  if (input.scopeType === "self") {
    if (!principal.personId || input.scopeId !== principal.personId) throw Object.assign(new Error("只能生成本人资料文件"), { statusCode: 403, code: "SENSITIVE_EXPORT_FORBIDDEN" });
    const snapshot = { ...input, name: "本人资料", requesterPersonId: principal.personId, cutoffAt };
    assertSensitiveExportScopeAllowed(principal.roles, snapshot); return snapshot;
  }
  if (input.scopeType === "company") {
    if (input.scopeId) throw Object.assign(new Error("公司范围不能指定 scopeId"), { statusCode: 400, code: "INVALID_SCOPE" });
    assertSensitiveExportScopeAllowed(principal.roles, input);
    return { ...input, name: "全公司", cutoffAt };
  }
  if (!input.scopeId) throw Object.assign(new Error("请选择导出范围"), { statusCode: 400, code: "INVALID_SCOPE" });
  if (input.scopeType === "organization") {
    const organization = await prisma.organization.findFirst({ where: { id: input.scopeId, type: { in: ["department", "business_entity"] } }, select: { name: true } });
    if (!organization) throw Object.assign(new Error("组织不存在或不可作为导出范围"), { statusCode: 404, code: "SCOPE_NOT_FOUND" });
    assertSensitiveExportScopeAllowed(principal.roles, input);
    return { ...input, name: organization.name, cutoffAt };
  }
  const project = await prisma.project.findUnique({ where: { id: input.scopeId }, select: { name: true, responsibleOrganizationId: true } });
  if (!project) throw Object.assign(new Error("项目不存在"), { statusCode: 404, code: "SCOPE_NOT_FOUND" });
  const snapshot = { ...input, name: project.name, projectResponsibleOrganizationId: project.responsibleOrganizationId, cutoffAt };
  assertSensitiveExportScopeAllowed(principal.roles, snapshot);
  return snapshot;
}

const requestKey = (scope: ScopeInput, categories: SensitiveExportCategory[]) => createHash("sha256").update(JSON.stringify([scope.scopeType, scope.scopeId, [...categories].sort()])).digest("hex");

export async function cleanupExpiredSensitiveExports(env: Env) {
  const rows = await prisma.sensitiveExportJob.findMany({ where: { status: "ready", expiresAt: { lte: new Date() } }, select: { id: true, storageKey: true, requestedBy: true } });
  for (const row of rows) {
    if (row.storageKey) await unlink(resolve(env.UPLOAD_ROOT, row.storageKey)).catch(() => undefined);
    await prisma.$transaction(async (tx) => {
      const changed = await tx.sensitiveExportJob.updateMany({ where: { id: row.id, status: "ready" }, data: { status: "expired", downloadTokenHash: null, downloadExpiresAt: null } });
      if (changed.count) await tx.auditLog.create({ data: { actorId: row.requestedBy, action: "sensitive_export.expire", objectType: "sensitive_export_job", objectId: row.id, result: "success" } });
    });
  }
}

export async function createSensitiveExportJob(principal: Principal, input: ScopeInput & { categories: SensitiveExportCategory[] }, env: Env) {
  await cleanupExpiredSensitiveExports(env);
  const scope = await resolveScope(principal, input);
  const categories = [...new Set(input.categories)].sort() as SensitiveExportCategory[];
  const key = requestKey(scope, categories);
  const existing = await prisma.sensitiveExportJob.findFirst({ where: { requestedBy: principal.accountId, requestKey: key, status: { in: ["pending", "processing", "ready"] } }, orderBy: { createdAt: "desc" } });
  if (existing) return existing;
  try {
    return await prisma.$transaction(async (tx) => {
      const job = await tx.sensitiveExportJob.create({ data: { requestedBy: principal.accountId, scopeType: scope.scopeType, scopeId: scope.scopeId, scopeSnapshot: scope as unknown as Prisma.InputJsonValue, categories, requestKey: key, expiresAt: new Date(Date.now() + sensitiveExportLifetimeMs) } });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "sensitive_export.request", objectType: "sensitive_export_job", objectId: job.id, result: "success", actorScopeType: scope.scopeType, actorScopeId: scope.scopeId, metadata: { categories, scopeName: scope.name } } });
      return job;
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    return prisma.sensitiveExportJob.findFirstOrThrow({ where: { requestedBy: principal.accountId, requestKey: key, status: { in: ["pending", "processing", "ready"] } } });
  }
}

function personWhere(scope: ScopeSnapshot): Prisma.PersonWhereInput {
  if (scope.scopeType === "company") return {};
  if (scope.scopeType === "self") return { id: scope.scopeId! };
  if (scope.scopeType === "organization") return { organizations: { some: { organizationId: scope.scopeId!, active: true, primary: true } } };
  return { projectMemberships: { some: { projectId: scope.scopeId!, status: { in: ["active", "approved"] } } } };
}

const fileValue = (file: { id: string; storageKey: string; originalName: string; size: number; sha256: string }, category: ExportFile["category"]): ExportFile => ({ ...file, category });
const jsonFileIds = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(jsonFileIds);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => /^(fileId|photoFileId|attachmentIds)$/i.test(key) ? (Array.isArray(item) ? item : [item]).filter((candidate): candidate is string => typeof candidate === "string" && /^[0-9a-f-]{36}$/i.test(candidate)) : jsonFileIds(item));
};

async function collectExport(job: { scopeSnapshot: Prisma.JsonValue; categories: Prisma.JsonValue }, env: Env) {
  const scope = job.scopeSnapshot as unknown as ScopeSnapshot;
  const categories = job.categories as SensitiveExportCategory[];
  const persons = await prisma.person.findMany({ where: personWhere(scope), include: { organizations: { where: { active: true }, include: { organization: { select: { id: true, name: true, type: true } } } }, projectMemberships: { where: { status: { in: ["active", "approved"] } }, include: { project: { select: { id: true, name: true } } } }, roleAssignments: { where: { OR: [{ active: true }, { activationPending: true }] }, select: { role: true, scopeType: true, scopeId: true, active: true, activationPending: true, createdAt: true } }, photoFile: true } });
  const personIds = persons.map(({ id }) => id);
  const files = new Map<string, ExportFile>();
  if (categories.includes("photos")) for (const person of persons) if (person.photoFile) files.set(person.photoFile.id, fileValue(person.photoFile, "photos"));
  if (categories.includes("signatures") && personIds.length) {
    const rows = await prisma.signature.findMany({ where: { personId: { in: personIds } }, include: { file: true } });
    for (const row of rows) files.set(row.file.id, fileValue(row.file, "signatures"));
  }
  if (categories.includes("certificates") && personIds.length) {
    const rows = await prisma.personCertificate.findMany({ where: { personId: { in: personIds } }, include: { file: true, attachments: { include: { file: true } } } });
    for (const row of rows) {
      if (row.file) files.set(row.file.id, fileValue(row.file, "certificates"));
      for (const attachment of row.attachments) files.set(attachment.file.id, fileValue(attachment.file, "certificates"));
    }
    if (scope.scopeType !== "project") {
      const qualificationWhere = scope.scopeType === "company" ? {} : { organizationId: scope.scopeId! };
      const qualifications = await prisma.organizationQualification.findMany({ where: qualificationWhere, include: { file: true, attachments: { include: { file: true } } } });
      for (const row of qualifications) {
        if (row.file) files.set(row.file.id, fileValue(row.file, "certificates"));
        for (const attachment of row.attachments) files.set(attachment.file.id, fileValue(attachment.file, "certificates"));
      }
    }
  }
  if (categories.includes("training_attachments")) {
    const [batches, requests] = await Promise.all([
      prisma.trainingBatch.findMany({ where: scope.scopeType === "project" ? { projectId: scope.scopeId } : { assignments: { some: { personId: { in: personIds } } } }, select: { offlineDetail: true } }),
      prisma.changeRequest.findMany({ where: { OR: [{ personId: { in: personIds } }, ...(scope.scopeType === "project" ? [{ projectId: scope.scopeId }] : [])] }, select: { payload: true, beforeSummary: true, afterSummary: true } })
    ]);
    const ids = [...new Set([...batches.flatMap(({ offlineDetail }) => jsonFileIds(offlineDetail)), ...requests.flatMap((row) => jsonFileIds(row))])];
    const rows = ids.length ? await prisma.privateFile.findMany({ where: { id: { in: ids } } }) : [];
    for (const row of rows) files.set(row.id, fileValue(row, "training_attachments"));
  }
  const accountIds = await prisma.account.findMany({ where: { personId: { in: personIds } }, select: { id: true } }).then((rows) => rows.map(({ id }) => id));
  const auditRows = categories.includes("audit") ? await prisma.auditLog.findMany({ where: scope.scopeType === "company" ? {} : { OR: [{ actorId: { in: accountIds } }, { objectType: "person", objectId: { in: personIds } }, ...(scope.scopeType === "project" ? [{ actorScopeType: "project", actorScopeId: scope.scopeId }] : [{ actorScopeType: "organization", actorScopeId: scope.scopeId }])] }, orderBy: { createdAt: "asc" } }) : [];
  const personManifest = persons.map((person) => ({ id: person.id, name: person.name, phone: person.phone, type: person.type, status: person.status, nationalId: person.nationalIdCipher && person.nationalIdIv && person.nationalIdTag ? decryptNationalId(person.nationalIdCipher, person.nationalIdIv, person.nationalIdTag, env) : null, organizations: person.organizations.map(({ primary, organization }) => ({ primary, ...organization })), projects: person.projectMemberships.map(({ status, project }) => ({ status, ...project })), roles: person.roleAssignments }));
  return { scope, categories, persons: personManifest, files: [...files.values()], audits: auditRows.map((row) => sanitizeAuditValue(row)) };
}

const safeName = (value: string) => basename(value).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 160) || "file";
async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function writeZip(path: string, payload: Awaited<ReturnType<typeof collectExport>>, env: Env) {
  const archive = archiver("zip", { zlib: { level: 6 } });
  const output = createWriteStream(path, { mode: 0o600 });
  const done = new Promise<void>((resolvePromise, reject) => { output.on("close", resolvePromise); output.on("error", reject); archive.on("error", reject); });
  archive.pipe(output);
  const fileManifest: Array<{ id: string; category: string; name: string; size: number; sha256: string }> = [];
  const root = resolve(env.UPLOAD_ROOT);
  for (const file of payload.files) {
    const pathName = resolve(root, file.storageKey);
    if (pathName !== root && !pathName.startsWith(`${root}${sep}`)) throw new Error("检测到非法文件存储路径");
    const current = await stat(pathName);
    const currentHash = await hashFile(pathName);
    if (current.size !== file.size || currentHash !== file.sha256) throw new Error(`私有文件完整性校验失败：${file.id}`);
    const name = `${file.id}-${safeName(file.originalName)}`;
    archive.file(pathName, { name: `files/${file.category}/${name}` });
    fileManifest.push({ id: file.id, category: file.category, name, size: file.size, sha256: file.sha256 });
  }
  archive.append(JSON.stringify({ generatedAt: new Date().toISOString(), scope: payload.scope, categories: payload.categories, persons: payload.persons, files: fileManifest, missingFiles: [] }, null, 2), { name: "manifest.json" });
  if (payload.categories.includes("audit")) archive.append(JSON.stringify(payload.audits, null, 2), { name: "audit/audit.json" });
  await archive.finalize();
  await done;
}

export async function processSensitiveExportJob(jobId: string, env: Env) {
  const claimed = await prisma.sensitiveExportJob.updateMany({ where: { id: jobId, status: "pending" }, data: { status: "processing" } });
  if (!claimed.count) return;
  const directory = resolve(env.UPLOAD_ROOT, ".sensitive-exports");
  const temporaryPath = resolve(directory, `${jobId}.tmp`);
  const finalPath = resolve(directory, `${jobId}.zip`);
  let requestedBy: string | null = null;
  try {
    await mkdir(directory, { recursive: true });
    const job = await prisma.sensitiveExportJob.findUniqueOrThrow({ where: { id: jobId }, select: { scopeSnapshot: true, categories: true, requestedBy: true, requester: { select: { personId: true } } } });
    requestedBy = job.requestedBy;
    const payload = await collectExport(job, env);
    await writeZip(temporaryPath, payload, env);
    await rename(temporaryPath, finalPath);
    const details = await stat(finalPath);
    const digest = await hashFile(finalPath);
    await prisma.$transaction(async (tx) => {
      await tx.sensitiveExportJob.update({ where: { id: jobId }, data: { status: "ready", storageKey: `.sensitive-exports/${jobId}.zip`, size: details.size, sha256: digest, completedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: job.requestedBy, action: "sensitive_export.complete", objectType: "sensitive_export_job", objectId: jobId, result: "success", metadata: { personCount: payload.persons.length, fileCount: payload.files.length, size: details.size, sha256: digest } } });
      if (job.requester.personId) await tx.notification.create({ data: { personId: job.requester.personId, title: "敏感资料文件已生成", body: "资料文件已准备好，请在十分钟内完成一次性下载。", dedupeKey: `sensitive-export-ready:${jobId}` } });
    });
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    await unlink(finalPath).catch(() => undefined);
    await prisma.$transaction(async (tx) => {
      await tx.sensitiveExportJob.update({ where: { id: jobId }, data: { status: "failed", error: error instanceof Error ? error.message.slice(0, 900) : "导出生成失败" } });
      await tx.auditLog.create({ data: { actorId: requestedBy, action: "sensitive_export.complete", objectType: "sensitive_export_job", objectId: jobId, result: "failed" } });
    });
  }
}

export async function issueSensitiveExportToken(jobId: string, principal: Principal) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await prisma.$transaction(async (tx) => {
    const changed = await tx.sensitiveExportJob.updateMany({ where: { id: jobId, requestedBy: principal.accountId, status: "ready", expiresAt: { gt: new Date() } }, data: { downloadTokenHash: tokenHash, downloadExpiresAt: expiresAt } });
    if (!changed.count) throw Object.assign(new Error("导出任务不可下载"), { statusCode: 409, code: "EXPORT_NOT_READY" });
    await tx.auditLog.create({ data: { actorId: principal.accountId, action: "sensitive_export.token", objectType: "sensitive_export_job", objectId: jobId, result: "success" } });
  });
  return { token, expiresAt };
}

export async function consumeSensitiveExport(jobId: string, token: string, principal: Principal, env: Env) {
  const job = await prisma.sensitiveExportJob.findFirst({ where: { id: jobId, requestedBy: principal.accountId }, select: { id: true, status: true, storageKey: true, downloadTokenHash: true, downloadExpiresAt: true, scopeType: true, scopeId: true, scopeSnapshot: true } });
  if (!job || job.status !== "ready" || !job.storageKey || !job.downloadTokenHash || !job.downloadExpiresAt || job.downloadExpiresAt <= new Date()) throw Object.assign(new Error("下载令牌无效或已经使用"), { statusCode: 409, code: "EXPORT_TOKEN_INVALID" });
  const actualHash = createHash("sha256").update(token).digest("hex");
  const actualHashBuffer = Buffer.from(actualHash, "hex");
  const expectedHashBuffer = Buffer.from(job.downloadTokenHash, "hex");
  if (actualHashBuffer.length !== expectedHashBuffer.length || !timingSafeEqual(actualHashBuffer, expectedHashBuffer)) throw Object.assign(new Error("下载令牌无效或已经使用"), { statusCode: 409, code: "EXPORT_TOKEN_INVALID" });
  const snapshot = job.scopeSnapshot as unknown as ScopeSnapshot;
  assertSensitiveExportScopeAllowed(principal.roles, snapshot);
  const path = resolve(env.UPLOAD_ROOT, job.storageKey);
  await stat(path);
  await prisma.$transaction(async (tx) => {
    const changed = await tx.sensitiveExportJob.updateMany({ where: { id: jobId, requestedBy: principal.accountId, status: "ready", downloadTokenHash: actualHash, downloadExpiresAt: { gt: new Date() } }, data: { status: "downloaded", downloadedAt: new Date(), downloadTokenHash: null, downloadExpiresAt: null } });
    if (!changed.count) throw Object.assign(new Error("下载令牌无效或已经使用"), { statusCode: 409, code: "EXPORT_TOKEN_INVALID" });
    await tx.auditLog.create({ data: { actorId: principal.accountId, action: "sensitive_export.download", objectType: "sensitive_export_job", objectId: jobId, result: "success", actorScopeType: job.scopeType, actorScopeId: job.scopeId } });
  });
  return { path, name: `敏感资料-${safeName(snapshot.name)}-${jobId.slice(0, 8)}.zip` };
}
