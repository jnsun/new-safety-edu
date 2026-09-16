import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import * as unzipper from "unzipper";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { audit, auditCritical } from "../audit.js";
import { canAccessOrganization, forbidden, isCompanyAdmin } from "../access.js";
import { encryptNationalId, hashNationalId, sha256 } from "../crypto.js";
import { createPerson } from "../people.js";
import { maskNationalId, maskPhone, maskPhotoFilename, nationalIdError, parsePhoneWorkbook, parseSourceWorkbook, photoIdentity, type PhoneRow, type SourcePersonRow } from "../person-import-core.js";
import { planExistingPersonImport, type ExistingPersonImportMatch, type PersonImportPlan } from "../person-import-upsert-policy.js";
import { autoDispatch } from "./day2.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
type Meta = {
  id: string;
  accountId: string;
  createdAt: string;
  sourceFilename: string;
  phoneFilename?: string;
  photoFilename?: string;
  mappings: Record<string, string>;
  createDepartments?: string[];
  excludedRows: number[];
  photoAssignments: Record<string, string>;
  importedRows?: Record<string, string>;
  confirmedAt?: string;
  result?: ImportResult;
};
type RowStatus = "ready" | "unchanged" | "failed" | "conflict" | "pending_data";
type PreviewRow = {
  rowNumber: number;
  name: string;
  workDepartment: string;
  sourceDepartment: string;
  nationalIdMasked: string;
  phoneMasked: string;
  photoId?: string;
  photoName?: string;
  excluded: boolean;
  status: RowStatus;
  action?: "create" | "update" | "skip" | "conflict";
  reasons: string[];
};
type ImportResult = {
  counts: { success: number; created: number; updated: number; skipped: number; failed: number; conflict: number; pendingData: number };
  rows: Array<{ rowNumber: number; name: string; status: "created" | "updated" | "skipped" | "failed" | "conflict" | "pending_data"; reasons: string[] }>;
};
type OpenZipEntry = { type: "File" | "Directory"; path: string; uncompressedSize?: number; pathBuffer?: Buffer; isUnicode?: boolean; buffer(): Promise<Buffer> };
type PhotoEntry = { id: string; name: string; entry: OpenZipEntry };

const sessionId = z.string().uuid();
const DAY_MS = 24 * 60 * 60 * 1000;
const allowedPhoto = new Set([".jpg", ".jpeg", ".png"]);
const normalizeName = (value: string) => value.replace(/\s+/g, "");
const usableDepartment = (value: string) => value && value.replace(/\s+/g, "") !== "工作部门" ? value : "";
const departmentCandidates = (row: SourcePersonRow) => [...new Set([usableDepartment(row.workDepartment), usableDepartment(row.sourceDepartment)].filter(Boolean))];
const importRoot = (env: Env) => resolve(env.UPLOAD_ROOT, ".person-imports");
const sessionRoot = (env: Env, id: string) => resolve(importRoot(env), sessionId.parse(id));

async function saveMeta(env: Env, meta: Meta) {
  const root = sessionRoot(env, meta.id);
  const temporary = resolve(root, "meta.json.tmp");
  await writeFile(temporary, JSON.stringify(meta), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, resolve(root, "meta.json"));
}

async function loadMeta(env: Env, id: string, accountId: string): Promise<Meta> {
  const meta = JSON.parse(await readFile(resolve(sessionRoot(env, id), "meta.json"), "utf8")) as Meta;
  if (meta.accountId !== accountId) forbidden("无权访问该导入预览");
  if (Date.now() - Date.parse(meta.createdAt) > DAY_MS) throw Object.assign(new Error("导入预览已过期，请重新上传"), { statusCode: 410, code: "IMPORT_EXPIRED" });
  return { ...meta, createDepartments: meta.createDepartments ?? [] };
}

async function cleanupExpired(env: Env) {
  const root = importRoot(env);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const entries = await import("node:fs/promises").then(({ readdir }) => readdir(root, { withFileTypes: true }));
  await Promise.all(entries.filter((entry) => entry.isDirectory() && z.string().uuid().safeParse(entry.name).success).map(async (entry) => {
    const path = resolve(root, entry.name);
    if (Date.now() - (await stat(path)).mtimeMs > DAY_MS) await rm(path, { recursive: true, force: true });
  }));
}

async function storeUpload(request: FastifyRequest, path: string, maxBytes: number, extensions: string[]) {
  const part = await request.file({ limits: { files: 1, fileSize: maxBytes } });
  if (!part) throw Object.assign(new Error("请选择文件"), { statusCode: 400, code: "FILE_REQUIRED" });
  if (!extensions.includes(extname(part.filename).toLowerCase())) throw Object.assign(new Error(`仅支持 ${extensions.join("/")} 文件`), { statusCode: 400, code: "UNSUPPORTED_IMPORT" });
  await pipeline(part.file, createWriteStream(path, { mode: 0o600 }));
  if (part.file.truncated) {
    await unlink(path).catch(() => undefined);
    throw Object.assign(new Error("上传文件超过大小限制"), { statusCode: 413, code: "FILE_TOO_LARGE" });
  }
  return part.filename.slice(0, 240);
}

async function zipPhotos(path: string): Promise<{ entries: PhotoEntry[]; invalid: Array<{ name: string; reason: string }> }> {
  const directory = await unzipper.Open.file(path);
  if (directory.files.length > 1000) throw Object.assign(new Error("照片 ZIP 最多包含 1000 个条目"), { statusCode: 400, code: "ZIP_TOO_MANY_FILES" });
  const entries: PhotoEntry[] = [];
  const invalid: Array<{ name: string; reason: string }> = [];
  let totalSize = 0;
  for (const rawEntry of directory.files) {
    const entry = rawEntry as unknown as OpenZipEntry;
    if (entry.type === "Directory") continue;
    const decodedPath = (entry.isUnicode || !entry.pathBuffer ? entry.path : new TextDecoder("gbk").decode(entry.pathBuffer)).replace(/\\/g, "/");
    const pathParts = decodedPath.split("/").filter(Boolean);
    const name = pathParts.at(-1) ?? "";
    const size = entry.uncompressedSize ?? 0;
    totalSize += size;
    if (decodedPath.startsWith("/") || pathParts.length > 2 || pathParts.some((part) => part === "." || part === ".." || part.includes(":"))) { invalid.push({ name, reason: "ZIP 只允许根目录文件或一层照片文件夹" }); continue; }
    if (!allowedPhoto.has(extname(name).toLowerCase())) { invalid.push({ name, reason: "仅支持 JPG/JPEG/PNG" }); continue; }
    if (size <= 0 || size > 10 * 1024 * 1024) { invalid.push({ name, reason: "照片为空或超过 10MB" }); continue; }
    entries.push({ id: sha256(decodedPath), name, entry });
  }
  if (totalSize > 500 * 1024 * 1024) throw Object.assign(new Error("照片 ZIP 解压后总大小超过 500MB"), { statusCode: 400, code: "ZIP_TOO_LARGE" });
  return { entries, invalid };
}

const imageMime = (name: string, buffer: Buffer): string | null => {
  const extension = extname(name).toLowerCase();
  if ((extension === ".jpg" || extension === ".jpeg") && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (extension === ".png" && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
};

async function analysis(env: Env, meta: Meta, principal: NonNullable<FastifyRequest["principal"]>) {
  const root = sessionRoot(env, meta.id);
  const source = await parseSourceWorkbook(await readFile(resolve(root, "source")), meta.sourceFilename);
  if (!source.length || source.length > 1000) throw Object.assign(new Error("人员数据行数必须为 1-1000"), { statusCode: 400, code: "INVALID_ROW_COUNT" });
  const phones = meta.phoneFilename
    ? await parsePhoneWorkbook(await readFile(resolve(root, "phones")), meta.phoneFilename)
    : source.map((row) => ({ rowNumber: row.rowNumber, name: row.name, nationalId: row.nationalId, phone: row.phone }));
  const photos = meta.photoFilename ? await zipPhotos(resolve(root, "photos.zip")) : { entries: [], invalid: [] };
  const included = source.filter((row) => !meta.excludedRows.includes(row.rowNumber));
  const sourceIdCounts = new Map<string, number>();
  for (const row of included) if (row.nationalId) sourceIdCounts.set(row.nationalId, (sourceIdCounts.get(row.nationalId) ?? 0) + 1);
  const phoneById = new Map<string, PhoneRow[]>();
  for (const row of phones) if (row.nationalId) phoneById.set(row.nationalId, [...(phoneById.get(row.nationalId) ?? []), row]);
  const sourceById = new Map<string, SourcePersonRow[]>();
  for (const row of source) if (row.nationalId) sourceById.set(row.nationalId, [...(sourceById.get(row.nationalId) ?? []), row]);

  const photoById = new Map(photos.entries.map((entry) => [entry.id, entry]));
  const rowsByNationalId = new Map<string, SourcePersonRow[]>();
  for (const row of source) if (row.nationalId) rowsByNationalId.set(row.nationalId, [...(rowsByNationalId.get(row.nationalId) ?? []), row]);
  const assignments = new Map<number, PhotoEntry>();
  const usedPhotoIds = new Set<string>();
  for (const [rowRaw, photoId] of Object.entries(meta.photoAssignments)) {
    const rowNumber = Number(rowRaw); const photo = photoById.get(photoId);
    if (photo && source.some((row) => row.rowNumber === rowNumber) && !usedPhotoIds.has(photoId)) { assignments.set(rowNumber, photo); usedPhotoIds.add(photoId); }
  }
  for (const photo of photos.entries) {
    if (usedPhotoIds.has(photo.id)) continue;
    const identity = photoIdentity(photo.name);
    const candidates = (rowsByNationalId.get(identity.nationalId) ?? []).filter((row) => normalizeName(row.name) === normalizeName(identity.name));
    if (!nationalIdError(identity.nationalId) && candidates.length === 1 && !assignments.has(candidates[0]!.rowNumber)) {
      assignments.set(candidates[0]!.rowNumber, photo); usedPhotoIds.add(photo.id);
    }
  }
  const phonePreview = phones.map((row) => {
    const reasons: string[] = []; let status: "matched" | "failed" | "conflict" | "unmatched" = "matched";
    const idProblem = nationalIdError(row.nationalId);
    if (meta.phoneFilename && idProblem) { status = "failed"; reasons.push(idProblem); }
    if (!/^1\d{10}$/.test(row.phone)) { status = "failed"; reasons.push("手机号格式错误"); }
    const phoneMatches = phoneById.get(row.nationalId) ?? [];
    const sourceMatches = sourceById.get(row.nationalId) ?? [];
    if (meta.phoneFilename && !idProblem && phoneMatches.length > 1) { status = "conflict"; reasons.push("手机号清单中身份证号码重复"); }
    else if (meta.phoneFilename && !idProblem && sourceMatches.length === 0) { status = "unmatched"; reasons.push("主人员表中没有相同身份证号码"); }
    else if (meta.phoneFilename && !idProblem && sourceMatches.length > 1) { status = "conflict"; reasons.push("主人员表身份证号码重复"); }
    else if (meta.phoneFilename && !idProblem && sourceMatches.length === 1 && normalizeName(row.name) && normalizeName(row.name) !== normalizeName(sourceMatches[0]!.name)) { status = "conflict"; reasons.push("姓名与主人员表不一致"); }
    return { rowNumber: row.rowNumber, name: row.name || "未填写", nationalIdMasked: maskNationalId(row.nationalId), phoneMasked: maskPhone(row.phone), status, reasons };
  });
  const photoPreview = photos.entries.map((photo) => {
    const name = maskPhotoFilename(photo.name);
    if (usedPhotoIds.has(photo.id)) return { id: photo.id, name, status: "matched" as const, reason: "" };
    const identity = photoIdentity(photo.name);
    const idCandidates = rowsByNationalId.get(identity.nationalId) ?? [];
    if (nationalIdError(identity.nationalId)) return { id: photo.id, name, status: "unmatched" as const, reason: "文件名未包含有效身份证号码" };
    if (!idCandidates.length) return { id: photo.id, name, status: "unmatched" as const, reason: "Excel 中没有相同身份证号码" };
    if (!idCandidates.some((row) => normalizeName(row.name) === normalizeName(identity.name))) return { id: photo.id, name, status: "conflict" as const, reason: "照片文件名姓名与 Excel 不一致" };
    return { id: photo.id, name, status: "conflict" as const, reason: "该人员已有另一张照片或身份证记录重复" };
  });

  const candidateIds = included.filter((row) => !nationalIdError(row.nationalId)).map((row) => row.nationalId);
  const hashes = candidateIds.map((id) => hashNationalId(id, env));
  const candidatePhones = phones.map((row) => row.phone).filter((phone) => /^1\d{10}$/.test(phone));
  const existing = await prisma.person.findMany({
    where: { OR: [{ nationalIdHash: { in: hashes } }, { phone: { in: candidatePhones } }] },
    select: { id: true, name: true, nationalIdHash: true, phone: true, status: true, photoFileId: true, organizations: { where: { active: true, primary: true }, select: { organizationId: true }, take: 2 } }
  });
  const existingMatch = (person: (typeof existing)[number]): ExistingPersonImportMatch => ({
    id: person.id, name: person.name, phone: person.phone, nationalIdHash: person.nationalIdHash, photoFileId: person.photoFileId,
    primaryOrganizationId: person.organizations.length === 1 ? person.organizations[0]!.organizationId : person.organizations.length ? "multiple" : null,
    status: person.status
  });
  const existingByHash = new Map<string, ExistingPersonImportMatch[]>();
  const existingByPhone = new Map<string, ExistingPersonImportMatch[]>();
  for (const person of existing) {
    const match = existingMatch(person);
    if (person.nationalIdHash) existingByHash.set(person.nationalIdHash, [...(existingByHash.get(person.nationalIdHash) ?? []), match]);
    if (person.phone) existingByPhone.set(person.phone, [...(existingByPhone.get(person.phone) ?? []), match]);
  }

  const organizations = await prisma.organization.findMany({ select: { id: true, name: true, type: true, parentId: true, parent: { select: { name: true } } }, orderBy: { name: "asc" } });
  const accessibleOrganizations = new Map<string, (typeof organizations)[number]>();
  for (const organization of organizations) if (await canAccessOrganization(principal, organization.id)) accessibleOrganizations.set(organization.id, organization);
  const mappedOrganization = (sourceName: string) => {
    const manual = accessibleOrganizations.get(meta.mappings[sourceName] ?? "");
    if (manual && manual.type !== "company") return manual;
    const exact = [...accessibleOrganizations.values()].filter((organization) => organization.type !== "company" && organization.name === sourceName);
    return exact.length === 1 ? exact[0] : undefined;
  };
  const organizationOf = (row: SourcePersonRow) => departmentCandidates(row).map(mappedOrganization).find(Boolean);
  const phoneOf = (row: SourcePersonRow) => {
    if (!meta.phoneFilename) return row.phone;
    const matches = phoneById.get(row.nationalId) ?? [];
    return matches.length === 1 ? matches[0]!.phone : "";
  };
  const prepared = new Map<number, { source: SourcePersonRow; phone: string; organizationId?: string; photo?: PhotoEntry; nationalId?: string; mode: "create" | "update"; personId?: string; fields: PersonImportPlan["fields"] }>();
  const phoneOwners = new Map<string, number[]>();
  for (const row of included) {
    const phone = phoneOf(row);
    if (/^1\d{10}$/.test(phone)) phoneOwners.set(phone, [...(phoneOwners.get(phone) ?? []), row.rowNumber]);
  }

  const previewRows: PreviewRow[] = source.map((row) => {
    const excluded = meta.excludedRows.includes(row.rowNumber);
    const failed: string[] = []; const conflicts: string[] = []; const pending: string[] = []; const warnings: string[] = [];
    if (!row.name || row.name.length < 2) failed.push("缺少有效姓名");
    const idProblem = nationalIdError(row.nationalId); if (idProblem) warnings.push(`${idProblem}，将留空待后补`);
    if (!excluded && !idProblem && (sourceIdCounts.get(row.nationalId) ?? 0) > 1) conflicts.push("主表身份证号码重复");
    const department = departmentCandidates(row)[0] ?? "";
    const organization = organizationOf(row);
    const createDepartment = Boolean(department && (meta.createDepartments ?? []).includes(department));
    const organizationId = organization?.id ?? (createDepartment ? `new:${department}` : undefined);
    if (!organizationId) warnings.push(department ? "部门未精确匹配，请选择现有组织或勾选导入时创建" : "未提供工作部门或来源部门，将留空待后补");
    else if (createDepartment && !organization) warnings.push("确认时按 Excel 原名创建部门");
    const phoneMatches = phoneById.get(row.nationalId) ?? [];
    const phone = phoneOf(row);
    if (meta.phoneFilename && phoneMatches.length > 1) conflicts.push("同一身份证对应多条手机号记录");
    if (meta.phoneFilename && phoneMatches.length === 1 && normalizeName(phoneMatches[0]!.name) && normalizeName(phoneMatches[0]!.name) !== normalizeName(row.name)) conflicts.push("手机号清单姓名与主表不一致");
    if (!/^1\d{10}$/.test(phone)) failed.push(phone ? "手机号格式错误" : "缺少手机号");
    else {
      if ((phoneOwners.get(phone) ?? []).length > 1) conflicts.push("同一手机号匹配了多名人员");
    }
    const photo = assignments.get(row.rowNumber);
    if (!photo) warnings.push(meta.photoFilename ? "照片未唯一匹配，将留空待后补" : "尚未上传照片 ZIP，将留空待后补");
    if (excluded) pending.unshift("已人工排除，不参加本次初始化");
    const nationalIdHash = !idProblem ? hashNationalId(row.nationalId, env) : undefined;
    const plan = planExistingPersonImport({
      ...(nationalIdHash ? { nationalIdHash } : {}), phone, name: row.name,
      ...(organizationId ? { organizationId } : {}), hasPhoto: Boolean(photo),
      matchesByNationalId: nationalIdHash ? existingByHash.get(nationalIdHash) ?? [] : [],
      matchesByPhone: /^1\d{10}$/.test(phone) ? existingByPhone.get(phone) ?? [] : []
    });
    if (plan.mode === "conflict") conflicts.push(...plan.reasons);
    const status: RowStatus = excluded ? "pending_data" : conflicts.length ? "conflict" : failed.length ? "failed" : plan.mode === "skip" ? "unchanged" : "ready";
    if (status === "ready") prepared.set(row.rowNumber, {
      source: row, phone, ...(organization?.id ? { organizationId: organization.id } : {}), ...(photo ? { photo } : {}), ...(!idProblem ? { nationalId: row.nationalId } : {}),
      mode: plan.mode as "create" | "update", ...(plan.personId ? { personId: plan.personId } : {}), fields: plan.fields
    });
    return { rowNumber: row.rowNumber, name: row.name || "未填写", workDepartment: row.workDepartment || "—", sourceDepartment: row.sourceDepartment || "—", nationalIdMasked: maskNationalId(row.nationalId), phoneMasked: maskPhone(phone), ...(photo ? { photoId: photo.id, photoName: maskPhotoFilename(photo.name) } : {}), excluded, status, action: plan.mode, reasons: [...conflicts, ...failed, ...pending, ...(plan.mode === "conflict" ? [] : plan.reasons), ...warnings] };
  });
  const statusCounts = (status: RowStatus) => previewRows.filter((row) => row.status === status).length;
  const departments = [...new Set(source.flatMap(departmentCandidates))].sort((a, b) => a.localeCompare(b, "zh-CN")).map((sourceName) => {
    const mapped = mappedOrganization(sourceName);
    return { sourceName, count: source.filter((row) => departmentCandidates(row).includes(sourceName)).length, organizationId: mapped?.id ?? null, formalName: mapped?.name ?? null, organizationType: mapped?.type ?? null, parentName: mapped?.parent?.name ?? null };
  });
  return {
    preview: {
      id: meta.id,
      createdAt: meta.createdAt,
      files: { source: meta.sourceFilename, phone: meta.phoneFilename ?? null, photos: meta.photoFilename ?? null },
      counts: { total: source.length, ready: statusCounts("ready"), create: previewRows.filter((row) => row.status === "ready" && row.action === "create").length, update: previewRows.filter((row) => row.status === "ready" && row.action === "update").length, unchanged: statusCounts("unchanged"), failed: statusCounts("failed"), conflict: statusCounts("conflict"), pendingData: statusCounts("pending_data") },
      phoneStats: { total: phones.length, matched: phonePreview.filter((row) => row.status === "matched").length, failed: phonePreview.filter((row) => row.status === "failed").length, conflict: phonePreview.filter((row) => row.status === "conflict").length, unmatched: phonePreview.filter((row) => row.status === "unmatched").length },
      phoneIssues: phonePreview.filter((row) => row.status !== "matched"),
      photoStats: { total: photos.entries.length + photos.invalid.length, valid: photos.entries.length, invalid: photos.invalid.length, matched: usedPhotoIds.size, conflict: photoPreview.filter((row) => row.status === "conflict").length, unmatched: photoPreview.filter((row) => row.status === "unmatched").length },
      photoErrors: photos.invalid.map((item) => ({ ...item, name: maskPhotoFilename(item.name) })),
      photoIssues: photoPreview.filter((row) => row.status !== "matched"),
      departments: departments.map((department) => ({ ...department, createOnConfirm: (meta.createDepartments ?? []).includes(department.sourceName) })),
      organizations: [...accessibleOrganizations.values()],
      photoOptions: photos.entries.map(({ id, name }) => ({ id, name: maskPhotoFilename(name) })),
      rows: previewRows,
      confirmedAt: meta.confirmedAt ?? null,
      result: meta.result ?? null
    },
    prepared
  };
}

async function ensureSelectedDepartments(meta: Meta, actorId: string) {
  const names = [...new Set(meta.createDepartments ?? [])];
  if (!names.length) return;
  const company = await prisma.organization.findFirst({ where: { type: "company", parentId: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!company) throw Object.assign(new Error("尚未建立公司根组织，不能自动创建部门"), { statusCode: 409, code: "COMPANY_ORGANIZATION_REQUIRED" });
  await prisma.$transaction(async (tx) => {
    for (const name of names) {
      const matches = await tx.organization.findMany({ where: { name, type: { not: "company" } }, select: { id: true }, take: 2 });
      if (matches.length > 1) throw Object.assign(new Error(`组织名称“${name}”存在多条记录，请人工映射`), { statusCode: 409, code: "AMBIGUOUS_ORGANIZATION" });
      if (matches.length === 1) continue;
      const organization = await tx.organization.create({ data: { name, type: "department", parentId: company.id } });
      await tx.auditLog.create({ data: { actorId, action: "person_import.organization_create", objectType: "organization", objectId: organization.id, result: "success", metadata: { sourceName: name, importId: meta.id } } });
    }
  });
}

export async function registerPersonImportRoutes(app: FastifyInstance, deps: { env: Env; authenticate: Guard; requireManager: Guard }) {
  const guard = { preHandler: [deps.authenticate, deps.requireManager] };
  const principal = (request: FastifyRequest) => {
    if (!request.principal || !isCompanyAdmin(request.principal)) forbidden("仅公司管理员可执行全员初始化");
    return request.principal!;
  };

  app.post("/api/person-imports/preview", guard, async (request, reply) => {
    const actor = principal(request); await cleanupExpired(deps.env);
    const id = randomUUID(); const root = sessionRoot(deps.env, id); await mkdir(root, { recursive: true, mode: 0o700 });
    try {
      const filename = await storeUpload(request, resolve(root, "source"), 10 * 1024 * 1024, [".xlsx", ".csv"]);
      const meta: Meta = { id, accountId: actor.accountId, createdAt: new Date().toISOString(), sourceFilename: filename, mappings: {}, createDepartments: [], excludedRows: [], photoAssignments: {} };
      await saveMeta(deps.env, meta); audit(actor.accountId, "person_import.preview", "person_import", id, { sourceRows: (await parseSourceWorkbook(await readFile(resolve(root, "source")), filename)).length });
      return reply.code(201).send({ data: (await analysis(deps.env, meta, actor)).preview });
    } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
  });

  app.post("/api/person-imports/:id/phones", guard, async (request) => {
    const actor = principal(request); const id = sessionId.parse((request.params as { id: string }).id); const meta = await loadMeta(deps.env, id, actor.accountId);
    if (meta.confirmedAt) throw Object.assign(new Error("该导入已确认"), { statusCode: 409, code: "IMPORT_CONFIRMED" });
    meta.phoneFilename = await storeUpload(request, resolve(sessionRoot(deps.env, id), "phones"), 10 * 1024 * 1024, [".xlsx", ".csv"]); await saveMeta(deps.env, meta);
    return { data: (await analysis(deps.env, meta, actor)).preview };
  });

  app.post("/api/person-imports/:id/photos", guard, async (request) => {
    const actor = principal(request); const id = sessionId.parse((request.params as { id: string }).id); const meta = await loadMeta(deps.env, id, actor.accountId);
    if (meta.confirmedAt) throw Object.assign(new Error("该导入已确认"), { statusCode: 409, code: "IMPORT_CONFIRMED" });
    meta.photoFilename = await storeUpload(request, resolve(sessionRoot(deps.env, id), "photos.zip"), 300 * 1024 * 1024, [".zip"]); await zipPhotos(resolve(sessionRoot(deps.env, id), "photos.zip")); await saveMeta(deps.env, meta);
    return { data: (await analysis(deps.env, meta, actor)).preview };
  });

  app.put("/api/person-imports/:id/config", guard, async (request) => {
    const actor = principal(request); const id = sessionId.parse((request.params as { id: string }).id); const meta = await loadMeta(deps.env, id, actor.accountId);
    if (meta.confirmedAt) throw Object.assign(new Error("该导入已确认"), { statusCode: 409, code: "IMPORT_CONFIRMED" });
    const input = z.object({ mappings: z.record(z.string().max(120), z.string().uuid()), createDepartments: z.array(z.string().trim().min(1).max(120)).max(200).default([]), excludedRows: z.array(z.number().int().min(2)).max(1000), photoAssignments: z.record(z.string().regex(/^\d+$/), z.string().length(64)) }).parse(request.body);
    const source = await parseSourceWorkbook(await readFile(resolve(sessionRoot(deps.env, id), "source")), meta.sourceFilename);
    const allowedDepartments = new Set(source.flatMap(departmentCandidates));
    if (input.createDepartments.some((name) => !allowedDepartments.has(name))) throw Object.assign(new Error("待创建部门必须来自当前 Excel"), { statusCode: 400, code: "INVALID_IMPORT_DEPARTMENT" });
    meta.mappings = input.mappings; meta.createDepartments = [...new Set(input.createDepartments.filter((name) => !input.mappings[name]))]; meta.excludedRows = [...new Set(input.excludedRows)]; meta.photoAssignments = input.photoAssignments; await saveMeta(deps.env, meta);
    return { data: (await analysis(deps.env, meta, actor)).preview };
  });

  app.get("/api/person-imports/:id", guard, async (request) => {
    const actor = principal(request); const id = sessionId.parse((request.params as { id: string }).id); const meta = await loadMeta(deps.env, id, actor.accountId);
    return { data: (await analysis(deps.env, meta, actor)).preview };
  });

  app.post("/api/person-imports/:id/confirm", guard, async (request) => {
    const actor = principal(request); const id = sessionId.parse((request.params as { id: string }).id); const meta = await loadMeta(deps.env, id, actor.accountId);
    if (meta.result) return { data: meta.result };
    const lock = resolve(sessionRoot(deps.env, id), "confirm.lock");
    const lockHandle = await import("node:fs/promises").then(({ open }) => open(lock, "wx", 0o600)).catch(() => null);
    if (!lockHandle) throw Object.assign(new Error("导入正在确认，请勿重复提交"), { statusCode: 409, code: "IMPORT_CONFIRMING" });
    try {
      await ensureSelectedDepartments(meta, actor.accountId);
      const current = await analysis(deps.env, meta, actor); const rows: ImportResult["rows"] = [];
      for (const row of current.preview.rows as PreviewRow[]) {
        if (meta.importedRows?.[String(row.rowNumber)]) { rows.push({ rowNumber: row.rowNumber, name: row.name, status: "skipped", reasons: ["本批次已处理"] }); continue; }
        if (row.status === "unchanged") { rows.push({ rowNumber: row.rowNumber, name: row.name, status: "skipped", reasons: row.reasons }); continue; }
        if (row.status !== "ready") { rows.push({ rowNumber: row.rowNumber, name: row.name, status: row.status, reasons: row.reasons }); continue; }
        const item = current.prepared.get(row.rowNumber)!;
        const selectedPhoto = item.mode === "create" || item.fields.includes("photo") ? item.photo : undefined;
        const buffer = selectedPhoto ? await selectedPhoto.entry.buffer() : null;
        const mimeType = selectedPhoto && buffer ? imageMime(selectedPhoto.name, buffer) : null;
        const storageKey = buffer && mimeType ? `${new Date().getUTCFullYear()}/${randomUUID()}` : null;
        const filePath = storageKey ? resolve(deps.env.UPLOAD_ROOT, storageKey) : null;
        if (filePath && buffer) { await mkdir(resolve(filePath, ".."), { recursive: true }); await writeFile(filePath, buffer, { mode: 0o600 }); }
        let personId: string | null = null;
        try {
          personId = await prisma.$transaction(async (tx) => {
            const file = storageKey && buffer && mimeType && selectedPhoto ? await tx.privateFile.create({ data: { kind: "photo", storageKey, originalName: `人员照片${extname(selectedPhoto.name).toLowerCase()}`, mimeType, size: buffer.length, sha256: sha256(buffer), uploadedBy: actor.accountId } }) : null;
            if (item.mode === "create") {
              const person = await createPerson({ name: item.source.name, phone: item.phone, type: "employee", ...(item.organizationId ? { organizationId: item.organizationId } : {}), ...(item.nationalId ? { nationalId: item.nationalId } : {}), ...(file ? { photoFileId: file.id } : {}) }, actor, deps.env, tx);
              await tx.auditLog.create({ data: { actorId: actor.accountId, action: "person.import_create", objectType: "person", objectId: person.id, result: "success", metadata: { importId: id, rowNumber: row.rowNumber } } });
              return person.id;
            }
            const update = {
              ...(item.fields.includes("phone") ? { phone: item.phone } : {}),
              ...(item.fields.includes("nationalId") && item.nationalId ? encryptNationalId(item.nationalId, deps.env) : {}),
              ...(file ? { photoFile: { connect: { id: file.id } }, photoHistory: { create: { fileId: file.id, changedBy: actor.accountId } } } : {}),
              ...(item.fields.includes("organization") && item.organizationId ? { organizations: { create: { organizationId: item.organizationId, primary: true } } } : {})
            };
            const person = await tx.person.update({ where: { id: item.personId! }, data: update, select: { id: true } });
            await tx.auditLog.create({ data: { actorId: actor.accountId, action: "person.import_fill_missing", objectType: "person", objectId: person.id, result: "success", metadata: { importId: id, rowNumber: row.rowNumber, fields: item.fields } } });
            return person.id;
          });
        } catch (error) {
          if (filePath) await unlink(filePath).catch(() => undefined);
          const tagged = error as Error & { statusCode?: number };
          const conflict = (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") || tagged.statusCode === 409;
          rows.push({ rowNumber: row.rowNumber, name: row.name, status: conflict ? "conflict" : "failed", reasons: [conflict ? "人员资料或组织关系发生冲突" : tagged.statusCode && tagged.statusCode < 500 ? tagged.message : "人员写入失败，请查看服务端日志"] });
          continue;
        }
        meta.importedRows = { ...(meta.importedRows ?? {}), [String(row.rowNumber)]: personId! }; await saveMeta(deps.env, meta);
        if (item.mode === "create") await autoDispatch("three_level", personId!, deps.env).catch(() => audit(actor.accountId, "person.import_auto_dispatch_retry_required", "person", personId!, { importId: id }));
        rows.push({ rowNumber: row.rowNumber, name: row.name, status: item.mode === "create" ? "created" : "updated", reasons: row.reasons });
      }
      const created = rows.filter((row) => row.status === "created").length; const updated = rows.filter((row) => row.status === "updated").length;
      const result: ImportResult = { counts: { success: created + updated, created, updated, skipped: rows.filter((row) => row.status === "skipped").length, failed: rows.filter((row) => row.status === "failed").length, conflict: rows.filter((row) => row.status === "conflict").length, pendingData: rows.filter((row) => row.status === "pending_data").length }, rows };
      meta.confirmedAt = new Date().toISOString(); meta.result = result; await saveMeta(deps.env, meta);
      await auditCritical(actor.accountId, "person_import.confirm", "person_import", id, result.counts as unknown as Prisma.InputJsonValue, "var/audit-fallback.ndjson");
      return { data: result };
    } finally { await lockHandle.close(); await unlink(lock).catch(() => undefined); }
  });
}
