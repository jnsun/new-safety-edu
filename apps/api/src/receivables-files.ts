import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import unzipper from "unzipper";
import type { Principal } from "./auth.js";
import { prisma } from "./db.js";
import { requireReceivables, resolveReceivablesAccess, type ReceivablesAccess } from "./receivables-access.js";
import { writeCriticalAudit } from "./transaction-audit.js";

type Tx = Prisma.TransactionClient;
export type ReceivablesFilesContext = { principal: Principal; requestId: string };
export type UploadedPrivateFile = { storageKey: string; originalName: string; mimeType: string; size: number; sha256: string };
const setupLockKey = 8_645_136_501n;
const maxAttachmentSize = 10 * 1024 * 1024;
const allowed = new Map([[
  "application/pdf", [".pdf"],
], ["image/png", [".png"]], ["image/jpeg", [".jpg", ".jpeg"]], ["image/webp", [".webp"]], ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", [".xlsx"]]]);
const httpError = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const ledgerNotFound = () => httpError(404, "RECEIVABLES_LEDGER_NOT_FOUND", "应收账款台账不存在");
const attachmentNotFound = () => httpError(404, "RECEIVABLES_ATTACHMENT_NOT_FOUND", "财务附件不存在");
const conflict = () => httpError(409, "REVISION_CONFLICT", "版本已变化，请刷新后重试");
const ledgerVoided = () => httpError(409, "RECEIVABLES_LEDGER_VOIDED", "已作废台账只读");
const attachmentVoided = () => httpError(409, "RECEIVABLES_ATTACHMENT_VOIDED", "财务附件已作废");
const invalidFileContent = () => httpError(400, "INVALID_FILE_CONTENT", "文件内容与声明类型不匹配");

export const RECEIVABLE_WORKBOOK_LIMITS = Object.freeze({
  entries: 256,
  entryUncompressedBytes: 16 * 1024 * 1024,
  totalUncompressedBytes: 64 * 1024 * 1024,
  compressionRatio: 100,
  worksheets: 50,
  rows: 200_000,
  cells: 1_000_000,
});

export type ReceivableWorkbookDirectoryEntry = { path: string; type: "Directory" | "File"; flags: number; compressedSize: number; uncompressedSize: number };

export function parseReceivableWorkbookEndOfCentralDirectory(content: Buffer) {
  const minimumSize = 22; const candidates: number[] = []; let hasZip64Metadata = false;
  const scanStart = Math.max(0, content.length - 80);
  for (let offset = scanStart; offset <= content.length - 4; offset += 1) {
    const signature = content.readUInt32LE(offset);
    if (signature === 0x06054b50) candidates.push(offset);
    if (signature === 0x07064b50 || signature === 0x06064b50) hasZip64Metadata = true;
  }
  if (candidates.length !== 1) throw invalidFileContent();
  const endOffset = candidates[0]!;
  if (endOffset + minimumSize > content.length || endOffset + minimumSize + content.readUInt16LE(endOffset + 20) !== content.length) throw invalidFileContent();
  const diskNumber = content.readUInt16LE(endOffset + 4); const diskStart = content.readUInt16LE(endOffset + 6);
  const entriesOnDisk = content.readUInt16LE(endOffset + 8); const entries = content.readUInt16LE(endOffset + 10);
  const centralSize = content.readUInt32LE(endOffset + 12); const centralOffset = content.readUInt32LE(endOffset + 16);
  const centralEnd = centralOffset + centralSize;
  const hasAdjacentZip64Locator = endOffset >= 20 && content.readUInt32LE(endOffset - 20) === 0x07064b50;
  const hasAdjacentZip64Record = [56, 76].some((distance) => endOffset >= distance && content.readUInt32LE(endOffset - distance) === 0x06064b50);
  if (diskNumber !== 0 || diskStart !== 0 || entriesOnDisk !== entries || entries === 0xffff || entries > RECEIVABLE_WORKBOOK_LIMITS.entries || centralSize === 0xffffffff || centralOffset === 0xffffffff || !Number.isSafeInteger(centralEnd) || centralEnd > endOffset || hasZip64Metadata || hasAdjacentZip64Locator || hasAdjacentZip64Record) throw invalidFileContent();
  return { entries, centralSize, centralOffset, endOffset };
}

export function validateReceivableWorkbookDirectory(entries: readonly ReceivableWorkbookDirectoryEntry[]) {
  if (entries.length > RECEIVABLE_WORKBOOK_LIMITS.entries) throw invalidFileContent();
  const seen = new Set<string>();
  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    const path = entry.path.replace(/\/$/, "");
    const normalized = path.toLowerCase();
    if (!path || path.includes("\\") || path.includes("\0") || path.startsWith("/") || /^[a-z]:/i.test(path) || path.split("/").some((segment) => !segment || segment === "." || segment === "..") || seen.has(normalized) || (entry.flags & 1) !== 0) throw invalidFileContent();
    seen.add(normalized);
    if (entry.type === "Directory") continue;
    const { compressedSize, uncompressedSize } = entry;
    if (!Number.isSafeInteger(compressedSize) || !Number.isSafeInteger(uncompressedSize) || compressedSize < 0 || uncompressedSize < 0 || uncompressedSize > RECEIVABLE_WORKBOOK_LIMITS.entryUncompressedBytes || uncompressedSize > 0 && (compressedSize === 0 || uncompressedSize / compressedSize > RECEIVABLE_WORKBOOK_LIMITS.compressionRatio)) throw invalidFileContent();
    totalUncompressedBytes += uncompressedSize;
    if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > RECEIVABLE_WORKBOOK_LIMITS.totalUncompressedBytes) throw invalidFileContent();
  }
}

export async function preflightReceivableWorkbookArchive(content: Buffer) {
  const metadata = parseReceivableWorkbookEndOfCentralDirectory(content);
  const directory = await unzipper.Open.buffer(content).catch(() => { throw invalidFileContent(); });
  if (directory.files.length !== metadata.entries) throw invalidFileContent();
  validateReceivableWorkbookDirectory(directory.files);
}

export function validateReceivableWorkbookShape(workbook: ExcelJS.Workbook) {
  if (!workbook.worksheets.length || workbook.worksheets.length > RECEIVABLE_WORKBOOK_LIMITS.worksheets) throw invalidFileContent();
  let rows = 0; let cells = 0;
  for (const worksheet of workbook.worksheets) {
    rows += worksheet.rowCount;
    worksheet.eachRow({ includeEmpty: false }, (row) => { cells += Math.max(row.cellCount, row.actualCellCount); });
    if (rows > RECEIVABLE_WORKBOOK_LIMITS.rows || cells > RECEIVABLE_WORKBOOK_LIMITS.cells) throw invalidFileContent();
  }
}

export async function validateReceivableAttachment(filename: string, mimeType: string, content: Buffer) {
  const suffix = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (!allowed.get(mimeType)?.includes(suffix)) throw httpError(400, "INVALID_MIME", "附件只支持 PDF/PNG/JPG/WebP/XLSX");
  if (content.length > maxAttachmentSize) throw httpError(413, "FILE_TOO_LARGE", "附件不得超过 10 MiB");
  const validContent = mimeType === "application/pdf" ? content.subarray(0, 5).equals(Buffer.from("%PDF-"))
    : mimeType === "image/png" ? content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : mimeType === "image/jpeg" ? content[0] === 0xff && content[1] === 0xd8
        : mimeType === "image/webp" ? content.subarray(0, 4).equals(Buffer.from("RIFF")) && content.subarray(8, 12).equals(Buffer.from("WEBP"))
          : await preflightReceivableWorkbookArchive(content).then(async () => {
            const workbook = await new ExcelJS.Workbook().xlsx.load(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer);
            validateReceivableWorkbookShape(workbook); return true;
          }).catch(() => false);
  if (!validContent) throw invalidFileContent();
}

export function receivableAttachmentStoragePath(uploadRoot: string, storageKey: string) {
  const root = resolve(uploadRoot);
  const path = resolve(root, storageKey);
  const outside = relative(root, path);
  if (!storageKey || isAbsolute(storageKey) || outside === ".." || outside.startsWith("../") || outside.startsWith("..\\") || isAbsolute(outside)) throw httpError(500, "FILE_PATH_INVALID", "私有文件路径越界");
  return path;
}

export const newReceivableAttachmentStorageKey = () => `receivables/${new Date().getUTCFullYear()}/${randomUUID()}`;
function containedTemporaryPath(uploadRoot: string, temporaryPath: string) {
  const root = resolve(uploadRoot); const path = resolve(temporaryPath); const outside = relative(root, path);
  if (!isAbsolute(temporaryPath) || !outside || outside === ".." || outside.startsWith("../") || outside.startsWith("..\\") || isAbsolute(outside)) throw httpError(500, "FILE_PATH_INVALID", "私有文件路径越界");
  return path;
}
export async function storeReceivableAttachment(uploadRoot: string, storageKey: string, content: Buffer) {
  const finalPath = receivableAttachmentStoragePath(uploadRoot, storageKey); const temporaryPath = containedTemporaryPath(uploadRoot, `${finalPath}.${randomUUID()}.uploading`);
  await mkdir(dirname(finalPath), { recursive: true });
  try { await writeFile(temporaryPath, content, { mode: 0o600 }); await chmod(temporaryPath, 0o600); await rename(temporaryPath, finalPath); }
  catch (error) {
    try { await removeReceivableAttachmentFiles(uploadRoot, storageKey, temporaryPath); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "附件落盘失败且清理失败"); }
    throw error;
  }
}
export async function removeReceivableAttachmentFiles(uploadRoot: string, storageKey: string, temporaryPath?: string) {
  const paths = [receivableAttachmentStoragePath(uploadRoot, storageKey), ...(temporaryPath ? [containedTemporaryPath(uploadRoot, temporaryPath)] : [])];
  const errors: unknown[] = [];
  for (const path of paths) {
    try { await unlink(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") errors.push(error); }
    try { await lstat(path); errors.push(new Error(`附件文件清理后仍存在: ${path}`)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "附件文件清理失败");
}

async function lockAuthority(tx: Tx, principal: Principal) {
  await tx.$queryRaw`SELECT 'locked'::text AS locked FROM pg_advisory_xact_lock(${setupLockKey})`;
  await tx.$queryRaw`SELECT id FROM receivable_access_grants WHERE account_id = ${principal.accountId}::uuid ORDER BY id FOR UPDATE`;
  return resolveReceivablesAccess(principal, tx);
}

const writeScope = (access: ReceivablesAccess) => access.canManageAll ? {} : { financeDepartmentId: { in: access.writeDepartmentIds } };
const auditScope = (access: ReceivablesAccess, departmentId: string) => ({ actorRole: access.role, actorScopeType: access.canManageAll ? "receivables" : "receivable_department", actorScopeId: access.canManageAll ? null : departmentId });
export async function authorizeReceivableAttachmentUpload(principal: Principal, ledgerId: string) {
  const access = await resolveReceivablesAccess(principal);
  if (!access.canWriteLedger) throw ledgerNotFound();
  const ledger = await prisma.receivableLedger.findFirst({ where: { id: ledgerId, status: "active", ...writeScope(access) }, select: { id: true } });
  if (!ledger) throw ledgerNotFound();
}
async function writableLedger(tx: Tx, access: ReceivablesAccess, ledgerId: string) {
  const candidate = await tx.receivableLedger.findFirst({ where: { id: ledgerId, ...writeScope(access) }, select: { financeDepartmentId: true } });
  if (!candidate) throw ledgerNotFound();
  const [department] = await tx.$queryRaw<Array<{ id: string; active: boolean }>>`SELECT id, active FROM receivable_departments WHERE id = ${candidate.financeDepartmentId}::uuid FOR UPDATE`;
  if (!department) throw httpError(409, "RECEIVABLES_DEPARTMENT_INACTIVE", "财务归属部门不存在");
  if (access.canManageAll) await tx.$queryRaw`SELECT id FROM receivable_ledgers WHERE id = ${ledgerId}::uuid FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM receivable_ledgers WHERE id = ${ledgerId}::uuid AND finance_department_id IN (${Prisma.join(access.writeDepartmentIds.map((id) => Prisma.sql`${id}::uuid`))}) FOR UPDATE`;
  const ledger = await tx.receivableLedger.findFirst({ where: { id: ledgerId, ...writeScope(access) }, select: { id: true, financeDepartmentId: true, status: true, revision: true, updatedBy: true } });
  if (!ledger) throw ledgerNotFound();
  requireReceivables(access, "write", ledger.financeDepartmentId);
  if (ledger.status !== "active") throw ledgerVoided();
  return ledger;
}
function snapshot(row: unknown): Prisma.InputJsonObject { return JSON.parse(JSON.stringify(row)) as Prisma.InputJsonObject; }
async function updateLedger(tx: Tx, context: ReceivablesFilesContext, access: ReceivablesAccess, before: { id: string; financeDepartmentId: string; status: string; revision: number; updatedBy: string | null }, reason: string) {
  await tx.receivableLedgerRevision.create({ data: { ledgerId: before.id, revision: before.revision, beforeSnapshot: snapshot(before), reason, changedBy: context.principal.accountId } });
  const changed = await tx.receivableLedger.updateMany({ where: { id: before.id, revision: before.revision, status: "active" }, data: { revision: { increment: 1 }, updatedBy: context.principal.accountId } });
  if (changed.count !== 1) throw conflict();
  return tx.receivableLedger.findUniqueOrThrow({ where: { id: before.id }, select: { id: true, financeDepartmentId: true, status: true, revision: true, updatedBy: true } });
}

export async function createReceivableAttachment(context: ReceivablesFilesContext, input: { ledgerId: string; ledgerRevision: number; category: string; file: UploadedPrivateFile }) {
  return prisma.$transaction(async (tx) => {
    const access = await lockAuthority(tx, context.principal);
    const ledger = await writableLedger(tx, access, input.ledgerId);
    if (ledger.revision !== input.ledgerRevision) throw conflict();
    const file = await tx.privateFile.create({ data: { kind: "attachment", ...input.file, uploadedBy: context.principal.accountId } });
    const attachment = await tx.receivableAttachment.create({ data: { ledgerId: ledger.id, fileId: file.id, category: input.category, uploadedBy: context.principal.accountId } });
    const after = await updateLedger(tx, context, access, ledger, "上传财务附件");
    await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: "receivables.attachment.create", objectType: "receivable_attachment", objectId: attachment.id, requestId: context.requestId, ...auditScope(access, ledger.financeDepartmentId), reason: "上传财务附件", metadata: { ledgerId: ledger.id, departmentId: ledger.financeDepartmentId, fileId: file.id, attachmentId: attachment.id, before: { ledger: snapshot(ledger), attachment: null }, after: { ledger: snapshot(after), attachment: snapshot(attachment) } } });
    return { ...attachment, file };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function voidReceivableAttachment(context: ReceivablesFilesContext, input: { ledgerId: string; attachmentId: string; ledgerRevision: number; revision: number; reason: string }) {
  return prisma.$transaction(async (tx) => {
    const access = await lockAuthority(tx, context.principal);
    const ledger = await writableLedger(tx, access, input.ledgerId);
    if (ledger.revision !== input.ledgerRevision) throw conflict();
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM receivable_attachments WHERE id = ${input.attachmentId}::uuid AND ledger_id = ${ledger.id}::uuid FOR UPDATE`;
    if (!locked) throw attachmentNotFound();
    const attachment = await tx.receivableAttachment.findUniqueOrThrow({ where: { id: input.attachmentId }, select: { id: true, ledgerId: true, fileId: true, category: true, status: true, revision: true, uploadedBy: true, voidedAt: true, voidedBy: true, voidReason: true } });
    if (attachment.status !== "active") throw attachmentVoided();
    if (attachment.revision !== input.revision) throw conflict();
    if (!access.canManageAll && (access.role !== "reporter" || attachment.uploadedBy !== context.principal.accountId)) throw attachmentNotFound();
    const changed = await tx.receivableAttachment.updateMany({ where: { id: attachment.id, revision: input.revision, status: "active" }, data: { status: "voided", revision: { increment: 1 }, voidedAt: new Date(), voidedBy: context.principal.accountId, voidReason: input.reason } });
    if (changed.count !== 1) throw conflict();
    const afterAttachment = await tx.receivableAttachment.findUniqueOrThrow({ where: { id: attachment.id } });
    const afterLedger = await updateLedger(tx, context, access, ledger, input.reason);
    await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: "receivables.attachment.void", objectType: "receivable_attachment", objectId: attachment.id, requestId: context.requestId, ...auditScope(access, ledger.financeDepartmentId), reason: input.reason, metadata: { ledgerId: ledger.id, departmentId: ledger.financeDepartmentId, fileId: attachment.fileId, attachmentId: attachment.id, before: { ledger: snapshot(ledger), attachment: snapshot(attachment) }, after: { ledger: snapshot(afterLedger), attachment: snapshot(afterAttachment) } } });
    return afterAttachment;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
