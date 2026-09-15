import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import type { Principal } from "./auth.js";
import { prisma } from "./db.js";
import {
  authorizeReceivablesExportSnapshot,
  createReceivablesExportSnapshot,
  queryReceivablesExportBatch,
  type NormalizedReceivablesFilters,
  type ReceivablesExportScopeSnapshot,
  type ReceivablesFiltersInput,
} from "./receivables-query.js";

export type ReceivablesExportEnvironment = { uploadRoot: string };
type ExportJobPayload = { requestedBy: string; scopeSnapshot: Prisma.JsonValue; filterSnapshot: Prisma.JsonValue };
const jobLifetimeMs = 24 * 60 * 60 * 1_000;
const tokenLifetimeMs = 10 * 60 * 1_000;
const exportDirectoryName = ".receivables-exports";
const expectedStorageKey = (jobId: string) => `${exportDirectoryName}/${jobId}.xlsx`;

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

async function removeFile(path: string) {
  try { await unlink(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function principalForAccount(accountId: string): Promise<Principal> {
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { id: true, personId: true } });
  if (!account) throw exportError(403, "RECEIVABLES_FORBIDDEN", "导出请求者已不存在");
  return { accountId: account.id, personId: account.personId, mustChangePassword: false, sessionId: null, roles: [] };
}

const scopeValue = (value: Prisma.JsonValue) => value as unknown as ReceivablesExportScopeSnapshot;
const filterValue = (value: Prisma.JsonValue) => value as unknown as NormalizedReceivablesFilters;
const stableScope = (value: ReceivablesExportScopeSnapshot) => ({ role: value.role, all: value.all, readDepartmentIds: [...value.readDepartmentIds].sort() });

export async function createReceivablesExportJob(principal: Principal, filters: ReceivablesFiltersInput, env: ReceivablesExportEnvironment) {
  const snapshots = await createReceivablesExportSnapshot(principal, filters);
  await cleanupExpiredReceivablesExports(env);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 'locked'::text AS locked FROM pg_advisory_xact_lock(hashtext(${`receivables-export:${principal.accountId}`}::text))`;
    const candidates = await tx.receivableExportJob.findMany({ where: { requestedBy: principal.accountId, status: { in: ["pending", "processing", "completed"] }, downloadedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    const existing = candidates.find((job) => jsonEqual(stableScope(scopeValue(job.scopeSnapshot)), stableScope(snapshots.scopeSnapshot)) && jsonEqual(job.filterSnapshot, snapshots.filterSnapshot));
    if (existing) return existing;
    const job = await tx.receivableExportJob.create({ data: { requestedBy: principal.accountId, scopeSnapshot: snapshots.scopeSnapshot as unknown as Prisma.InputJsonValue, filterSnapshot: snapshots.filterSnapshot as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + jobLifetimeMs) } });
    await tx.auditLog.create({ data: auditData(job, "receivables.export.request", "success", { scope: snapshots.scopeSnapshot, filters: snapshots.filterSnapshot }) });
    return job;
  });
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
    const changed = await tx.receivableExportJob.updateMany({ where: { id: jobId, status: "pending", expiresAt: { gt: new Date() } }, data: { status: "processing", error: null } });
    if (!changed.count) return null;
    const job = await tx.receivableExportJob.findUniqueOrThrow({ where: { id: jobId }, select: { requestedBy: true, scopeSnapshot: true, filterSnapshot: true } });
    await tx.auditLog.create({ data: auditData({ id: jobId, requestedBy: job.requestedBy }, "receivables.export.claim", "success", { scope: job.scopeSnapshot, filters: job.filterSnapshot }) });
    return job;
  });
}

const columns: Array<{ header: string; key: string; width: number; money?: boolean }> = [
  { header: "合同编号", key: "contractNo", width: 24 }, { header: "财务归属部门", key: "financeDepartmentName", width: 22 },
  { header: "项目名称", key: "projectName", width: 28 }, { header: "客户名称", key: "customerName", width: 28 },
  { header: "客户属性", key: "customerType", width: 16 }, { header: "债权单位", key: "creditorUnit", width: 16 },
  { header: "工作性质", key: "workNature", width: 18 }, { header: "板块", key: "sector", width: 18 },
  { header: "项目状态", key: "projectStatus", width: 16 }, { header: "决算方式", key: "settlementMethod", width: 18 },
  { header: "合同金额", key: "contractAmount", width: 22, money: true }, { header: "决算金额", key: "finalAmount", width: 22, money: true },
  { header: "开票金额", key: "invoicedAmount", width: 22, money: true }, { header: "到账金额", key: "receivedAmount", width: 22, money: true },
  { header: "核销金额", key: "writeoffAmount", width: 22, money: true }, { header: "账内应收", key: "internalReceivable", width: 22, money: true },
  { header: "账外应收", key: "externalReceivable", width: 22, money: true }, { header: "应收余额", key: "balance", width: 22, money: true },
  { header: "最新挂账时间", key: "openingChargeDate", width: 16 }, { header: "债权状态", key: "debtStatus", width: 16 },
  { header: "清收责任人", key: "collectionOwner", width: 18 }, { header: "催收备注", key: "collectionNotes", width: 36 },
  { header: "记录状态", key: "status", width: 14 }, { header: "异常", key: "anomaly", width: 24 }, { header: "更新时间", key: "updatedAt", width: 24 },
];

async function writeWorkbook(path: string, principal: Principal, job: ExportJobPayload) {
  const handle = await open(path, "wx", 0o600); await handle.close();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: path, useStyles: true, useSharedStrings: false });
  const sheet = workbook.addWorksheet("应收账款台账", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  for (const column of sheet.columns) if (column.number && columns[column.number - 1]?.money) column.numFmt = "@";
  let afterId: string | null = null;
  let rowCount = 0;
  for (;;) {
    const rows = await queryReceivablesExportBatch(principal, scopeValue(job.scopeSnapshot), filterValue(job.filterSnapshot), afterId, 500);
    for (const row of rows) {
      sheet.addRow({ ...row, openingChargeDate: row.openingChargeDate?.toISOString().slice(0, 10) ?? null, updatedAt: row.updatedAt.toISOString() }).commit();
      rowCount += 1;
    }
    if (rows.length < 500) break;
    afterId = rows.at(-1)!.id;
  }
  sheet.commit();
  await workbook.commit();
  await chmod(path, 0o600);
  return rowCount;
}

export async function processReceivablesExportJob(jobId: string, env: ReceivablesExportEnvironment) {
  const claimed = await claimReceivablesExport(jobId);
  if (!claimed) return false;
  const directory = exportPath(env, exportDirectoryName);
  const temporaryPath = exportPath(env, `${exportDirectoryName}/${jobId}.${randomUUID()}.tmp`);
  const storageKey = expectedStorageKey(jobId);
  const finalPath = exportPath(env, storageKey);
  try {
    const principal = await principalForAccount(claimed.requestedBy);
    await authorizeReceivablesExportSnapshot(principal, scopeValue(claimed.scopeSnapshot), filterValue(claimed.filterSnapshot));
    await mkdir(directory, { recursive: true });
    const rowCount = await writeWorkbook(temporaryPath, principal, claimed);
    await rename(temporaryPath, finalPath);
    const details = await stat(finalPath);
    if (!details.isFile()) throw new Error("RECEIVABLES_EXPORT_NOT_REGULAR_FILE");
    const sha256 = await hashFile(finalPath);
    await prisma.$transaction(async (tx) => {
      const changed = await tx.receivableExportJob.updateMany({ where: { id: jobId, status: "processing" }, data: { status: "completed", rowCount, storageKey, size: details.size, sha256, completedAt: new Date() } });
      if (!changed.count) throw new Error("RECEIVABLES_EXPORT_STATE_CHANGED");
      await tx.auditLog.create({ data: auditData({ id: jobId, requestedBy: claimed.requestedBy }, "receivables.export.complete", "success", { scope: claimed.scopeSnapshot, filters: claimed.filterSnapshot, rowCount, size: details.size, sha256 }) });
    });
    return true;
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    for (const path of [temporaryPath, finalPath]) try { await removeFile(path); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    const combined = cleanupErrors.length ? new AggregateError([error, ...cleanupErrors], "导出失败且文件清理失败") : error;
    await prisma.$transaction(async (tx) => {
      const changed = await tx.receivableExportJob.updateMany({ where: { id: jobId, status: "processing" }, data: { status: "failed", error: combined instanceof Error ? combined.message.slice(0, 1_000) : "导出生成失败" } });
      if (changed.count) await tx.auditLog.create({ data: auditData({ id: jobId, requestedBy: claimed.requestedBy }, "receivables.export.failed", "failed", { scope: claimed.scopeSnapshot, filters: claimed.filterSnapshot, error: combined instanceof Error ? combined.message.slice(0, 500) : "导出生成失败" }) });
    });
    return false;
  }
}

export async function processPendingReceivablesExports(env: ReceivablesExportEnvironment, limit = 2) {
  const jobs = await prisma.receivableExportJob.findMany({ where: { status: "pending", expiresAt: { gt: new Date() } }, select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: Math.max(1, Math.min(limit, 10)) });
  await Promise.all(jobs.map(({ id }) => processReceivablesExportJob(id, env)));
  return jobs.length;
}

async function authorizeJob(principal: Principal, jobId: string) {
  const job = await prisma.receivableExportJob.findFirst({ where: { id: jobId, requestedBy: principal.accountId }, select: { id: true, requestedBy: true, status: true, scopeSnapshot: true, filterSnapshot: true, rowCount: true, storageKey: true, size: true, sha256: true, downloadTokenHash: true, downloadExpiresAt: true, downloadedAt: true, expiresAt: true } });
  if (!job) throw exportError(404, "RECEIVABLES_EXPORT_NOT_FOUND", "导出任务不存在");
  await authorizeReceivablesExportSnapshot(principal, scopeValue(job.scopeSnapshot), filterValue(job.filterSnapshot));
  return job;
}

export async function issueReceivablesExportToken(jobId: string, principal: Principal) {
  const job = await authorizeJob(principal, jobId);
  const token = randomBytes(32).toString("base64url");
  const downloadTokenHash = createHash("sha256").update(token).digest("hex");
  const downloadExpiresAt = new Date(Date.now() + tokenLifetimeMs);
  await prisma.$transaction(async (tx) => {
    const changed = await tx.receivableExportJob.updateMany({ where: { id: job.id, requestedBy: principal.accountId, status: "completed", downloadedAt: null, expiresAt: { gt: new Date() } }, data: { downloadTokenHash, downloadExpiresAt } });
    if (!changed.count) throw exportError(409, "RECEIVABLES_EXPORT_NOT_READY", "导出任务不可下载");
    await tx.auditLog.create({ data: auditData(job, "receivables.export.token", "success", { before: { issued: !!job.downloadTokenHash, expiresAt: job.downloadExpiresAt?.toISOString() ?? null }, after: { issued: true, expiresAt: downloadExpiresAt.toISOString() } }) });
  });
  return { token, expiresAt: downloadExpiresAt };
}

export async function consumeReceivablesExport(jobId: string, token: string, principal: Principal, env: ReceivablesExportEnvironment) {
  const job = await authorizeJob(principal, jobId);
  if (job.status !== "completed" || job.downloadedAt || job.storageKey !== expectedStorageKey(job.id) || job.size === null || !job.sha256 || !job.downloadTokenHash || !job.downloadExpiresAt || job.downloadExpiresAt <= new Date() || job.expiresAt <= new Date()) throw exportError(409, "RECEIVABLES_EXPORT_TOKEN_INVALID", "下载令牌无效或已经使用");
  const actualHash = createHash("sha256").update(token).digest();
  const expectedHash = Buffer.from(job.downloadTokenHash, "hex");
  if (expectedHash.length !== actualHash.length || !timingSafeEqual(actualHash, expectedHash)) throw exportError(409, "RECEIVABLES_EXPORT_TOKEN_INVALID", "下载令牌无效或已经使用");
  const path = exportPath(env, job.storageKey);
  try {
    const details = await stat(path);
    if (!details.isFile() || details.size !== job.size || await hashFile(path) !== job.sha256) throw new Error("integrity mismatch");
  } catch { throw exportError(409, "RECEIVABLES_EXPORT_FILE_INVALID", "导出文件不存在或完整性校验失败"); }
  await prisma.$transaction(async (tx) => {
    const changed = await tx.receivableExportJob.updateMany({ where: { id: job.id, requestedBy: principal.accountId, status: "completed", downloadedAt: null, downloadTokenHash: job.downloadTokenHash, downloadExpiresAt: { gt: new Date() }, expiresAt: { gt: new Date() } }, data: { downloadedAt: new Date(), downloadTokenHash: null, downloadExpiresAt: null } });
    if (!changed.count) throw exportError(409, "RECEIVABLES_EXPORT_TOKEN_INVALID", "下载令牌无效或已经使用");
    await tx.auditLog.create({ data: auditData(job, "receivables.export.download", "success", { rowCount: job.rowCount, size: job.size, sha256: job.sha256 }) });
  });
  return { path, name: `应收账款-${basename(job.id)}.xlsx` };
}

export async function cleanupExpiredReceivablesExports(env: ReceivablesExportEnvironment) {
  const jobs = await prisma.receivableExportJob.findMany({ where: { status: { in: ["pending", "processing", "completed", "failed"] }, expiresAt: { lte: new Date() } }, select: { id: true, requestedBy: true, status: true, storageKey: true, rowCount: true, size: true, sha256: true } });
  const errors: unknown[] = [];
  for (const job of jobs) {
    try {
      if (job.storageKey) {
        if (job.storageKey !== expectedStorageKey(job.id)) throw exportError(409, "RECEIVABLES_EXPORT_FILE_INVALID", "导出文件关联无效");
        await removeFile(exportPath(env, job.storageKey));
      }
      await prisma.$transaction(async (tx) => {
        const changed = await tx.receivableExportJob.updateMany({ where: { id: job.id, status: job.status, expiresAt: { lte: new Date() } }, data: { status: "expired", downloadTokenHash: null, downloadExpiresAt: null } });
        if (changed.count) await tx.auditLog.create({ data: auditData(job, "receivables.export.expire", "success", { previousStatus: job.status, rowCount: job.rowCount, size: job.size, sha256: job.sha256 }) });
      });
    } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "应收账款导出过期清理失败");
  return jobs.length;
}

export async function removeConsumedReceivablesExport(path: string, env: ReceivablesExportEnvironment) {
  const expectedRoot = exportPath(env, exportDirectoryName);
  const resolvedPath = resolve(path);
  if (!resolvedPath.startsWith(`${expectedRoot}${sep}`)) throw exportError(409, "RECEIVABLES_EXPORT_FILE_INVALID", "导出文件路径无效");
  await removeFile(resolvedPath);
}
