import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import type { Principal } from "./auth.js";
import { prisma } from "./db.js";
import {
  authorizeReceivablesExportSnapshotInTransaction,
  createReceivablesExportSnapshot,
  createReceivablesExportSnapshotInTransaction,
  queryReceivablesExportBatch,
  previewReceivablesExport,
  receivablesExportColumnIds,
  receivablesExportColumns,
  resolveReceivablesExportScope,
  type NormalizedReceivablesFilters,
  type ReceivablesExportScopeSnapshot,
  type ReceivablesFiltersInput,
  type ReceivablesExportCategoryFilters,
  type ReceivablesExportColumnId,
} from "./receivables-query.js";

export type ReceivablesExportEnvironment = {
  uploadRoot: string;
  fileOperations?: { rename?: typeof rename; unlink?: typeof unlink };
  verificationBarrier?: () => Promise<void>;
};
type ExportJobPayload = { requestedBy: string; scopeSnapshot: Prisma.JsonValue; filterSnapshot: Prisma.JsonValue };
const jobLifetimeMs = 24 * 60 * 60 * 1_000;
const tokenLifetimeMs = 10 * 60 * 1_000;
const exportDirectoryName = ".receivables-exports";
const expectedStorageKey = (jobId: string) => `${exportDirectoryName}/${jobId}.xlsx`;
const temporaryStorageKey = (jobId: string) => `${exportDirectoryName}/${jobId}.tmp`;
const quarantineStorageKey = (jobId: string) => `${exportDirectoryName}/${jobId}.delete`;

const exportError = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const canonicalJson = (value: unknown): unknown => Array.isArray(value)
  ? value.map(canonicalJson)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalJson(item)]))
    : value;
const jsonEqual = (left: unknown, right: unknown) => JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
const auditData = (job: { requestedBy: string; id: string }, action: string, result = "success", metadata?: Prisma.InputJsonValue) => ({ actorId: job.requestedBy, action, objectType: "receivable_export_job", objectId: job.id, result, ...(metadata === undefined ? {} : { metadata }) });

function exportPath(env: ReceivablesExportEnvironment, storageKey: string) {
  const root = resolve(env.uploadRoot);
  const path = resolve(root, storageKey);
  if (path === root || !path.startsWith(`${root}${sep}`)) throw exportError(409, "RECEIVABLES_EXPORT_FILE_INVALID", "导出文件路径无效");
  return path;
}

type FileIdentity = { dev: number; ino: number; size: number };
class QuarantinedFileError extends AggregateError {
  constructor(readonly storageKey: string, errors: unknown[]) { super(errors, "导出文件删除和原路径恢复均失败，已保留隔离路径以便重试"); }
}
const identityOf = (details: Stats): FileIdentity => ({ dev: details.dev, ino: details.ino, size: details.size });
const sameIdentity = (left: FileIdentity, right: Stats) => left.dev === right.dev && left.ino === right.ino && left.size === right.size;

async function ensureStorageDirectory(env: ReceivablesExportEnvironment) {
  const root = resolve(env.uploadRoot);
  const rootDetails = await lstat(root);
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) throw exportError(409, "RECEIVABLES_EXPORT_FILE_INVALID", "导出存储根目录无效");
  const directory = exportPath(env, exportDirectoryName);
  await mkdir(directory, { recursive: true });
  const directoryDetails = await lstat(directory);
  if (!directoryDetails.isDirectory() || directoryDetails.isSymbolicLink()) throw exportError(409, "RECEIVABLES_EXPORT_FILE_INVALID", "导出存储目录无效");
  return directory;
}

async function hashHandle(handle: FileHandle) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  for (let position = 0;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

async function openVerifiedFile(env: ReceivablesExportEnvironment, storageKey: string, expectedSize?: number, expectedSha256?: string) {
  await ensureStorageDirectory(env);
  const path = exportPath(env, storageKey);
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("not a regular file");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const after = await handle.stat();
    if (!after.isFile() || !sameIdentity(identityOf(before), after) || expectedSize !== undefined && after.size !== expectedSize) throw new Error("integrity mismatch");
    if (expectedSha256) {
      await env.verificationBarrier?.();
      if (await hashHandle(handle) !== expectedSha256) throw new Error("integrity mismatch");
    }
    return { handle, path, identity: identityOf(after) };
  } catch (error) { await handle.close(); throw error; }
}

async function removeVerifiedFile(env: ReceivablesExportEnvironment, jobId: string, storageKey: string, identity?: FileIdentity) {
  await ensureStorageDirectory(env);
  const path = exportPath(env, storageKey);
  let current: Stats;
  try { current = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (!current.isFile() || current.isSymbolicLink() || identity && !sameIdentity(identity, current)) throw exportError(409, "RECEIVABLES_EXPORT_FILE_INVALID", "导出文件身份无效");
  const quarantineKey = quarantineStorageKey(jobId);
  const fileRename = env.fileOperations?.rename ?? rename;
  const fileUnlink = env.fileOperations?.unlink ?? unlink;
  if (storageKey === quarantineKey) { await fileUnlink(path); return; }
  const quarantine = exportPath(env, quarantineKey);
  try {
    await lstat(quarantine);
    throw exportError(409, "RECEIVABLES_EXPORT_FILE_INVALID", "导出文件隔离路径已被占用");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await fileRename(path, quarantine);
  try {
    const moved = await lstat(quarantine);
    if (!sameIdentity(identity ?? identityOf(current), moved)) throw exportError(409, "RECEIVABLES_EXPORT_FILE_INVALID", "导出文件身份在删除时发生变化");
    await fileUnlink(quarantine);
  } catch (error) {
    try { await fileRename(quarantine, path); } catch (restoreError) { throw new QuarantinedFileError(quarantineKey, [error, restoreError]); }
    throw error;
  }
}

async function principalForAccount(accountId: string): Promise<Principal> {
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { id: true, personId: true } });
  if (!account) throw exportError(403, "RECEIVABLES_FORBIDDEN", "导出请求者已不存在");
  return { accountId: account.id, personId: account.personId, mustChangePassword: false, sessionId: null, roles: [] };
}

const scopeValue = (value: Prisma.JsonValue) => value as unknown as ReceivablesExportScopeSnapshot;
const filterValue = (value: Prisma.JsonValue) => value as unknown as NormalizedReceivablesFilters;
const selectedColumnValue = (value: Prisma.JsonValue) => {
  const columns = (value as unknown as { columns?: unknown }).columns;
  return Array.isArray(columns) && columns.every((item) => typeof item === "string" && receivablesExportColumnIds.includes(item as ReceivablesExportColumnId))
    ? columns as ReceivablesExportColumnId[]
    : receivablesExportColumnIds;
};
const coversScope = (scope: ReceivablesExportScopeSnapshot, currentIds: string[] | null) => scope.all ? currentIds === null : currentIds === null || currentIds.length === scope.readDepartmentIds.length;

export async function createReceivablesExportJob(principal: Principal, filters: ReceivablesFiltersInput, env: ReceivablesExportEnvironment, idempotencyKey: string, categoryFilters: ReceivablesExportCategoryFilters = {}, selectedColumns?: ReceivablesExportColumnId[]) {
  const columns = selectedColumns ?? receivablesExportColumnIds;
  if (!columns.length || new Set(columns).size !== columns.length || columns.some((column) => !receivablesExportColumnIds.includes(column))) throw exportError(400, "RECEIVABLES_EXPORT_COLUMNS_INVALID", "请至少选择一个有效导出字段");
  if (selectedColumns && (await previewReceivablesExport(principal, filters, categoryFilters)).rowCount === 0) throw exportError(400, "RECEIVABLES_EXPORT_EMPTY", "当前条件没有可导出的记录");
  await cleanupExpiredReceivablesExports(env);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 'locked'::text AS locked FROM pg_advisory_xact_lock(hashtext(${`receivables-export:${principal.accountId}`}::text))`;
    await lockAuthorizationFacts(tx, principal);
    const snapshots = await createReceivablesExportSnapshotInTransaction(tx, principal, filters, categoryFilters);
    const filterSnapshot = { ...snapshots.filterSnapshot, columns };
    const scopeSnapshot = { ...snapshots.scopeSnapshot, idempotencyKey } satisfies ReceivablesExportScopeSnapshot;
    const candidates = await tx.receivableExportJob.findMany({ where: { requestedBy: principal.accountId }, orderBy: { createdAt: "desc" } });
    const existing = candidates.find((job) => scopeValue(job.scopeSnapshot).idempotencyKey === idempotencyKey);
    if (existing) {
      if (!jsonEqual(existing.filterSnapshot, filterSnapshot)) throw exportError(409, "RECEIVABLES_EXPORT_IDEMPOTENCY_CONFLICT", "幂等键已用于不同的导出请求");
      return existing;
    }
    const job = await tx.receivableExportJob.create({ data: { requestedBy: principal.accountId, scopeSnapshot: scopeSnapshot as unknown as Prisma.InputJsonValue, filterSnapshot: filterSnapshot as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + jobLifetimeMs) } });
    await tx.auditLog.create({ data: auditData(job, "receivables.export.request", "success", { scope: scopeSnapshot, filters: filterSnapshot, idempotencyKey }) });
    return job;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function listReceivablesExports(principal: Principal, input: { page: number; pageSize: number }, env: ReceivablesExportEnvironment) {
  await createReceivablesExportSnapshot(principal, {});
  await cleanupExpiredReceivablesExports(env);
  const [rows, total] = await Promise.all([
    prisma.receivableExportJob.findMany({ where: { requestedBy: principal.accountId }, select: { id: true, status: true, scopeSnapshot: true, filterSnapshot: true, rowCount: true, size: true, sha256: true, error: true, completedAt: true, downloadedAt: true, expiresAt: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    prisma.receivableExportJob.count({ where: { requestedBy: principal.accountId } }),
  ]);
  return { rows, page: input.page, pageSize: input.pageSize, total };
}

async function claimReceivablesExport(jobId: string) {
  return prisma.$transaction(async (tx) => {
    const changed = await tx.receivableExportJob.updateMany({ where: { id: jobId, status: "pending", expiresAt: { gt: new Date() } }, data: { status: "processing", storageKey: temporaryStorageKey(jobId), error: null } });
    if (!changed.count) return null;
    const job = await tx.receivableExportJob.findUniqueOrThrow({ where: { id: jobId }, select: { requestedBy: true, scopeSnapshot: true, filterSnapshot: true } });
    await tx.auditLog.create({ data: auditData({ id: jobId, requestedBy: job.requestedBy }, "receivables.export.claim", "success", { scope: job.scopeSnapshot, filters: job.filterSnapshot }) });
    return job;
  });
}

const widths: Partial<Record<ReceivablesExportColumnId, number>> = { contractNo: 24, projectName: 28, customerName: 28, collectionNotes: 36, latestProgress: 30, nextPlan: 30 };
const moneyColumns = new Set<ReceivablesExportColumnId>(["contractAmount", "finalAmount", "invoicedAmount", "receivedAmount", "writeoffAmount", "internalReceivable", "externalReceivable", "balance"]);

async function writeWorkbook(path: string, principal: Principal, job: ExportJobPayload) {
  const outputHandle = await open(path, "wx", 0o600);
  const initialIdentity = identityOf(await outputHandle.stat());
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: outputHandle.createWriteStream(), useStyles: true, useSharedStrings: false });
  const selected = selectedColumnValue(job.filterSnapshot);
  const columns = selected.map((key) => ({ header: receivablesExportColumns.find(([id]) => id === key)![1], key, width: widths[key] ?? 18, money: moneyColumns.has(key) }));
  const sheet = workbook.addWorksheet("应收账款明细", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  sheet.getRow(1).font = { bold: true };
  for (const column of sheet.columns) if (column.number && columns[column.number - 1]?.money) column.numFmt = "@";
  let afterId: string | null = null;
  let rowCount = 0;
  for (;;) {
    const rows = await queryReceivablesExportBatch(principal, scopeValue(job.scopeSnapshot), filterValue(job.filterSnapshot), afterId, 500);
    for (const row of rows) {
      sheet.addRow({ ...row, openingChargeDate: row.openingChargeDate?.toISOString().slice(0, 10) ?? null, dunningDate: row.dunningDate?.toISOString().slice(0, 10) ?? null, updatedAt: row.updatedAt.toISOString() }).commit();
      rowCount += 1;
    }
    if (rows.length < 500) break;
    afterId = rows.at(-1)!.id;
  }
  sheet.commit();
  await workbook.commit();
  const pathDetails = await lstat(path);
  if (!pathDetails.isFile() || pathDetails.isSymbolicLink() || pathDetails.dev !== initialIdentity.dev || pathDetails.ino !== initialIdentity.ino) throw new Error("RECEIVABLES_EXPORT_TEMP_IDENTITY_CHANGED");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const details = await handle.stat();
  if (!details.isFile() || details.dev !== initialIdentity.dev || details.ino !== initialIdentity.ino || !sameIdentity(identityOf(pathDetails), details)) { await handle.close(); throw new Error("RECEIVABLES_EXPORT_NOT_REGULAR_FILE"); }
  return { rowCount, handle, identity: identityOf(details), sha256: await hashHandle(handle) };
}

export async function processReceivablesExportJob(jobId: string, env: ReceivablesExportEnvironment) {
  const claimed = await claimReceivablesExport(jobId);
  if (!claimed) return false;
  const temporaryKey = temporaryStorageKey(jobId);
  const temporaryPath = exportPath(env, temporaryKey);
  const storageKey = expectedStorageKey(jobId);
  const finalPath = exportPath(env, storageKey);
  let artifact: { key: string; identity?: FileIdentity } = { key: temporaryKey };
  let fileHandle: FileHandle | null = null;
  try {
    const principal = await principalForAccount(claimed.requestedBy);
    const effective = await prisma.$transaction((tx) => resolveReceivablesExportScope(tx, principal, scopeValue(claimed.scopeSnapshot), filterValue(claimed.filterSnapshot)), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const effectiveSnapshot: ReceivablesExportScopeSnapshot = { ...scopeValue(claimed.scopeSnapshot), all: effective.readDepartmentIds === null, readDepartmentIds: effective.readDepartmentIds ?? [] };
    await ensureStorageDirectory(env);
    const written = await writeWorkbook(temporaryPath, principal, { ...claimed, scopeSnapshot: effectiveSnapshot as unknown as Prisma.JsonValue });
    fileHandle = written.handle;
    artifact.identity = written.identity;
    await rename(temporaryPath, finalPath);
    artifact = { key: storageKey, identity: written.identity };
    const finalDetails = await lstat(finalPath);
    if (!sameIdentity(written.identity, finalDetails)) throw new Error("RECEIVABLES_EXPORT_RENAME_IDENTITY_CHANGED");
    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM receivable_export_jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
      if (!locked.length) throw new Error("RECEIVABLES_EXPORT_STATE_CHANGED");
      await lockAuthorizationFacts(tx, principal);
      const current = await authorizeReceivablesExportSnapshotInTransaction(tx, principal, effectiveSnapshot, filterValue(claimed.filterSnapshot));
      if (!coversScope(effectiveSnapshot, current.readDepartmentIds)) throw exportError(403, "RECEIVABLES_FORBIDDEN", "导出生成期间权限已收缩");
      const changed = await tx.receivableExportJob.updateMany({ where: { id: jobId, status: "processing", storageKey: temporaryKey }, data: { status: "completed", rowCount: written.rowCount, storageKey, size: written.identity.size, sha256: written.sha256, completedAt: new Date() } });
      if (!changed.count) throw new Error("RECEIVABLES_EXPORT_STATE_CHANGED");
      await tx.auditLog.create({ data: auditData({ id: jobId, requestedBy: claimed.requestedBy }, "receivables.export.complete", "success", { scope: claimed.scopeSnapshot, effectiveScope: effectiveSnapshot, filters: claimed.filterSnapshot, rowCount: written.rowCount, size: written.identity.size, sha256: written.sha256 }) });
    });
    await fileHandle.close(); fileHandle = null;
    return true;
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    if (fileHandle) { try { await fileHandle.close(); } catch (closeError) { cleanupErrors.push(closeError); } fileHandle = null; }
    let retainedStorageKey: string | null = artifact.key;
    try { await removeVerifiedFile(env, jobId, artifact.key, artifact.identity); retainedStorageKey = null; }
    catch (cleanupError) { if (cleanupError instanceof QuarantinedFileError) retainedStorageKey = cleanupError.storageKey; cleanupErrors.push(cleanupError); }
    const combined = cleanupErrors.length ? new AggregateError([error, ...cleanupErrors], "导出失败且文件清理失败") : error;
    await prisma.$transaction(async (tx) => {
      const changed = await tx.receivableExportJob.updateMany({ where: { id: jobId, status: "processing" }, data: { status: "failed", storageKey: retainedStorageKey, error: combined instanceof Error ? combined.message.slice(0, 1_000) : "导出生成失败" } });
      if (changed.count) await tx.auditLog.create({ data: auditData({ id: jobId, requestedBy: claimed.requestedBy }, "receivables.export.failed", "failed", { scope: claimed.scopeSnapshot, filters: claimed.filterSnapshot, storageKey: retainedStorageKey, cleanupPending: retainedStorageKey !== null, error: combined instanceof Error ? combined.message.slice(0, 500) : "导出生成失败" }) });
    });
    return false;
  }
}

export async function processPendingReceivablesExports(env: ReceivablesExportEnvironment, limit = 2) {
  const jobs = await prisma.receivableExportJob.findMany({ where: { status: "pending", expiresAt: { gt: new Date() } }, select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: Math.max(1, Math.min(limit, 10)) });
  await Promise.all(jobs.map(({ id }) => processReceivablesExportJob(id, env)));
  return jobs.length;
}

async function lockAuthorizationFacts(tx: Prisma.TransactionClient, principal: Principal) {
  await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${principal.accountId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT p.id FROM persons p JOIN accounts a ON a.person_id = p.id WHERE a.id = ${principal.accountId}::uuid FOR SHARE OF p`;
  await tx.$queryRaw`SELECT id FROM receivable_settings WHERE id = 1 FOR SHARE`;
  await tx.$queryRaw`
    SELECT ra.id FROM role_assignments ra
    LEFT JOIN receivable_settings rs ON rs.id = 1
    WHERE ra.account_id = ${principal.accountId}::uuid
       OR ra.person_id = (SELECT person_id FROM accounts WHERE id = ${principal.accountId}::uuid)
       OR (ra.role = 'org_leader'::"RoleName" AND ra.scope_type = 'organization'::"ScopeType" AND ra.scope_id = rs.finance_organization_id)
    FOR SHARE OF ra
  `;
  await tx.$queryRaw`
    SELECT a.id FROM accounts a
    JOIN persons p ON p.id = a.person_id
    JOIN role_assignments ra ON ra.person_id = p.id
    JOIN receivable_settings rs ON rs.id = 1 AND rs.finance_organization_id = ra.scope_id
    WHERE ra.role = 'org_leader'::"RoleName" AND ra.scope_type = 'organization'::"ScopeType"
    FOR SHARE OF a, p
  `;
  await tx.$queryRaw`SELECT id FROM receivable_access_grants WHERE account_id = ${principal.accountId}::uuid FOR SHARE`;
  await tx.$queryRaw`
    SELECT gd.id FROM receivable_grant_departments gd
    JOIN receivable_access_grants g ON g.id = gd.grant_id
    WHERE g.account_id = ${principal.accountId}::uuid
    FOR SHARE OF gd
  `;
  await tx.$queryRaw`
    SELECT d.id FROM receivable_departments d
    JOIN receivable_grant_departments gd ON gd.finance_department_id = d.id
    JOIN receivable_access_grants g ON g.id = gd.grant_id
    WHERE g.account_id = ${principal.accountId}::uuid
    FOR SHARE OF d
  `;
}

async function authorizeLockedJob(tx: Prisma.TransactionClient, principal: Principal, jobId: string) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM receivable_export_jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
  if (!locked.length) throw exportError(404, "RECEIVABLES_EXPORT_NOT_FOUND", "导出任务不存在");
  const job = await tx.receivableExportJob.findFirst({ where: { id: jobId, requestedBy: principal.accountId }, select: { id: true, requestedBy: true, status: true, scopeSnapshot: true, filterSnapshot: true, rowCount: true, storageKey: true, size: true, sha256: true, downloadTokenHash: true, downloadExpiresAt: true, downloadedAt: true, expiresAt: true } });
  if (!job) throw exportError(404, "RECEIVABLES_EXPORT_NOT_FOUND", "导出任务不存在");
  await lockAuthorizationFacts(tx, principal);
  const completion = await tx.auditLog.findFirst({ where: { action: "receivables.export.complete", objectId: job.id }, select: { metadata: true }, orderBy: { createdAt: "desc" } });
  const metadata = completion?.metadata && typeof completion.metadata === "object" && !Array.isArray(completion.metadata) ? completion.metadata as Record<string, Prisma.JsonValue> : null;
  const generatedScope = metadata?.effectiveScope ? scopeValue(metadata.effectiveScope) : scopeValue(job.scopeSnapshot);
  const current = await authorizeReceivablesExportSnapshotInTransaction(tx, principal, generatedScope, filterValue(job.filterSnapshot));
  const currentIds = current.readDepartmentIds;
  if (!coversScope(generatedScope, currentIds)) throw exportError(403, "RECEIVABLES_FORBIDDEN", "当前权限不足以访问已生成导出文件");
  return job;
}

export async function issueReceivablesExportToken(jobId: string, principal: Principal) {
  const token = randomBytes(32).toString("base64url");
  const downloadTokenHash = createHash("sha256").update(token).digest("hex");
  const downloadExpiresAt = new Date(Date.now() + tokenLifetimeMs);
  await prisma.$transaction(async (tx) => {
    const job = await authorizeLockedJob(tx, principal, jobId);
    const changed = await tx.receivableExportJob.updateMany({ where: { id: job.id, requestedBy: principal.accountId, status: "completed", downloadedAt: null, expiresAt: { gt: new Date() } }, data: { downloadTokenHash, downloadExpiresAt } });
    if (!changed.count) throw exportError(409, "RECEIVABLES_EXPORT_NOT_READY", "导出任务不可下载");
    await tx.auditLog.create({ data: auditData(job, "receivables.export.token", "success", { before: { issued: !!job.downloadTokenHash, expiresAt: job.downloadExpiresAt?.toISOString() ?? null }, after: { issued: true, expiresAt: downloadExpiresAt.toISOString() } }) });
  });
  return { token, expiresAt: downloadExpiresAt };
}

function assertUsableDownloadToken(job: Awaited<ReturnType<typeof authorizeLockedJob>>, token: string) {
  if (job.status !== "completed" || job.downloadedAt || job.storageKey !== expectedStorageKey(job.id) || job.size === null || !job.sha256 || !job.downloadTokenHash || !job.downloadExpiresAt || job.downloadExpiresAt <= new Date() || job.expiresAt <= new Date()) throw exportError(409, "RECEIVABLES_EXPORT_TOKEN_INVALID", "下载令牌无效或已经使用");
  const actualHash = createHash("sha256").update(token).digest();
  const expectedHash = Buffer.from(job.downloadTokenHash, "hex");
  if (expectedHash.length !== actualHash.length || !timingSafeEqual(actualHash, expectedHash)) throw exportError(409, "RECEIVABLES_EXPORT_TOKEN_INVALID", "下载令牌无效或已经使用");
}

export async function consumeReceivablesExport(jobId: string, token: string, principal: Principal, env: ReceivablesExportEnvironment) {
  let opened: Awaited<ReturnType<typeof openVerifiedFile>> | null = null;
  try {
    const candidate = await prisma.$transaction(async (tx) => {
      const job = await authorizeLockedJob(tx, principal, jobId);
      assertUsableDownloadToken(job, token);
      return job;
    });
    try { opened = await openVerifiedFile(env, candidate.storageKey!, candidate.size!, candidate.sha256!); }
    catch { throw exportError(409, "RECEIVABLES_EXPORT_FILE_INVALID", "导出文件不存在或完整性校验失败"); }
    const result = await prisma.$transaction(async (tx) => {
      const job = await authorizeLockedJob(tx, principal, jobId);
      assertUsableDownloadToken(job, token);
      if (job.storageKey !== candidate.storageKey || job.size !== candidate.size || job.sha256 !== candidate.sha256 || job.downloadTokenHash !== candidate.downloadTokenHash) throw exportError(409, "RECEIVABLES_EXPORT_TOKEN_INVALID", "下载令牌状态已发生变化");
      const changed = await tx.receivableExportJob.updateMany({ where: { id: job.id, requestedBy: principal.accountId, status: "completed", downloadedAt: null, downloadTokenHash: job.downloadTokenHash, downloadExpiresAt: { gt: new Date() }, expiresAt: { gt: new Date() } }, data: { downloadedAt: new Date(), downloadTokenHash: null, downloadExpiresAt: null } });
      if (!changed.count) throw exportError(409, "RECEIVABLES_EXPORT_TOKEN_INVALID", "下载令牌无效或已经使用");
      await tx.auditLog.create({ data: auditData(job, "receivables.export.download", "success", { rowCount: job.rowCount, size: job.size, sha256: job.sha256 }) });
      return { job, file: opened! };
    });
    return { ...result.file, jobId: result.job.id, storageKey: result.job.storageKey!, requestedBy: result.job.requestedBy, name: `应收账款-${result.job.id}.xlsx` };
  } catch (error) { if (opened) await (opened as Awaited<ReturnType<typeof openVerifiedFile>>).handle.close(); throw error; }
}

export async function cleanupExpiredReceivablesExports(env: ReceivablesExportEnvironment) {
  const now = new Date();
  const responseCleanupRetryBefore = new Date(now.valueOf() - 30_000);
  const jobs = await prisma.receivableExportJob.findMany({ where: { OR: [{ status: { in: ["pending", "processing", "completed", "failed"] }, expiresAt: { lte: now } }, { status: "failed", storageKey: { not: null } }, { status: "completed", downloadedAt: { lte: responseCleanupRetryBefore }, storageKey: { not: null } }] }, select: { id: true, requestedBy: true, status: true, storageKey: true, rowCount: true, size: true, sha256: true, expiresAt: true, downloadedAt: true } });
  const errors: unknown[] = [];
  for (const job of jobs) {
    try {
      if (job.storageKey) {
        if (![expectedStorageKey(job.id), temporaryStorageKey(job.id), quarantineStorageKey(job.id)].includes(job.storageKey)) throw exportError(409, "RECEIVABLES_EXPORT_FILE_INVALID", "导出文件关联无效");
        try {
          const opened = await openVerifiedFile(env, job.storageKey, job.size ?? undefined, job.sha256 ?? undefined);
          await opened.handle.close();
          await removeVerifiedFile(env, job.id, job.storageKey, opened.identity);
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      await prisma.$transaction(async (tx) => {
        const shouldExpire = job.expiresAt <= now;
        const changed = await tx.receivableExportJob.updateMany({ where: { id: job.id, status: job.status, storageKey: job.storageKey }, data: { ...(shouldExpire ? { status: "expired" as const } : {}), storageKey: null, downloadTokenHash: null, downloadExpiresAt: null } });
        if (changed.count) await tx.auditLog.create({ data: auditData(job, shouldExpire ? "receivables.export.expire" : "receivables.export.cleanup", "success", { previousStatus: job.status, rowCount: job.rowCount, size: job.size, sha256: job.sha256 }) });
      });
    } catch (error) {
      if (error instanceof QuarantinedFileError && job.storageKey) {
        await prisma.$transaction(async (tx) => {
          const changed = await tx.receivableExportJob.updateMany({ where: { id: job.id, status: job.status, storageKey: job.storageKey }, data: { storageKey: error.storageKey } });
          if (!changed.count) throw exportError(409, "RECEIVABLES_EXPORT_CLEANUP_CONFLICT", "导出清理隔离路径持久化冲突");
          await tx.auditLog.create({ data: auditData(job, "receivables.export.cleanup.defer", "failed", { previousStorageKey: job.storageKey, storageKey: error.storageKey }) });
        });
      }
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "应收账款导出过期清理失败");
  return jobs.length;
}

export async function removeConsumedReceivablesExport(file: { jobId: string; storageKey: string; requestedBy: string; handle: FileHandle; identity: FileIdentity }, env: ReceivablesExportEnvironment) {
  await file.handle.close();
  try { await removeVerifiedFile(env, file.jobId, file.storageKey, file.identity); }
  catch (error) {
    if (error instanceof QuarantinedFileError) {
      await prisma.$transaction(async (tx) => {
        const changed = await tx.receivableExportJob.updateMany({ where: { id: file.jobId, requestedBy: file.requestedBy, downloadedAt: { not: null }, storageKey: file.storageKey }, data: { storageKey: error.storageKey } });
        if (!changed.count) throw exportError(409, "RECEIVABLES_EXPORT_CLEANUP_CONFLICT", "导出响应清理隔离路径持久化冲突");
        await tx.auditLog.create({ data: auditData({ id: file.jobId, requestedBy: file.requestedBy }, "receivables.export.cleanup.defer", "failed", { previousStorageKey: file.storageKey, storageKey: error.storageKey }) });
      });
    }
    throw error;
  }
  await prisma.$transaction(async (tx) => {
    const changed = await tx.receivableExportJob.updateMany({ where: { id: file.jobId, requestedBy: file.requestedBy, downloadedAt: { not: null }, storageKey: file.storageKey }, data: { storageKey: null } });
    if (!changed.count) throw exportError(409, "RECEIVABLES_EXPORT_CLEANUP_CONFLICT", "导出清理状态发生变化");
    await tx.auditLog.create({ data: auditData({ id: file.jobId, requestedBy: file.requestedBy }, "receivables.export.cleanup", "success") });
  });
}
