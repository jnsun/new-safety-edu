import { Prisma } from "@prisma/client";
import type { Principal } from "./auth.js";
import { prisma } from "./db.js";
import { assertTransition, assertWriteoffAllowed, calculateReceivableAmounts } from "./receivables-core.js";
import { requireReceivables, resolveReceivablesAccess, type ReceivablesAccess } from "./receivables-access.js";
import { writeCriticalAudit } from "./transaction-audit.js";

type DetailInput = { ledgerRevision: number; amount: string; date: string; referenceNo?: string | null | undefined; note?: string | null | undefined; invoiceNo?: string | null | undefined };
type UpdateDetailInput = DetailInput & { revision: number; reason: string };
export type ReceivablesMoneyContext = { principal: Principal; requestId: string };
export type ReceivablesMoneyOperation =
  | { type: "invoice.create"; ledgerId: string; input: DetailInput }
  | { type: "invoice.patch"; ledgerId: string; detailId: string; input: UpdateDetailInput }
  | { type: "invoice.void"; ledgerId: string; detailId: string; input: { ledgerRevision: number; revision: number; reason: string } }
  | { type: "receipt.create"; ledgerId: string; input: DetailInput }
  | { type: "receipt.patch"; ledgerId: string; detailId: string; input: UpdateDetailInput }
  | { type: "receipt.void"; ledgerId: string; detailId: string; input: { ledgerRevision: number; revision: number; reason: string } }
  | { type: "writeoff.patch"; ledgerId: string; input: { ledgerRevision: number; reason: string; writeoffAmount: string } };

type Tx = Prisma.TransactionClient;
const setupLockKey = 8_645_136_501n;
const httpError = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const notFound = () => httpError(404, "RECEIVABLES_LEDGER_NOT_FOUND", "应收账款台账不存在");
const detailNotFound = () => httpError(404, "RECEIVABLES_DETAIL_NOT_FOUND", "应收账款明细不存在");
const conflict = () => httpError(409, "REVISION_CONFLICT", "版本已变化，请刷新后重试");
const voidedLedger = () => httpError(409, "RECEIVABLES_LEDGER_VOIDED", "已作废台账只读");
const voidedDetail = () => httpError(409, "RECEIVABLES_DETAIL_VOIDED", "已作废明细只读");
const amountInvalid = () => httpError(400, "RECEIVABLES_AMOUNT_INVALID", "金额必须为大于 0 的 Decimal(18,4) 字符串");
const writeoffInvalid = () => httpError(400, "RECEIVABLES_WRITEOFF_INVALID", "核销金额必须为非负 Decimal(18,4) 字符串");
const dateInvalid = () => httpError(400, "RECEIVABLES_DATE_INVALID", "日期格式无效");
const openingDateHistoryInvalid = () => httpError(409, "RECEIVABLES_OPENING_DATE_HISTORY_INVALID", "首次开票前挂账日期审计缺失或损坏");
const unexpectedDatabaseConflict = () => httpError(500, "INTERNAL_ERROR", "未识别的数据库写入异常");

const ledgerSelect = {
  id: true, financeDepartmentId: true, finalAmount: true, writeoffAmount: true, openingChargeDate: true,
  status: true, revision: true, voidedAt: true, voidedBy: true, voidReason: true, updatedBy: true, updatedAt: true,
} satisfies Prisma.ReceivableLedgerSelect;
type Ledger = Prisma.ReceivableLedgerGetPayload<{ select: typeof ledgerSelect }>;
type DetailAudit = { detailType: "invoice" | "receipt"; detailId: string; before: Prisma.InputJsonObject | null; after: Prisma.InputJsonObject };

function snapshot(row: unknown): Prisma.InputJsonObject { return JSON.parse(JSON.stringify(row)) as Prisma.InputJsonObject; }
export function classifyReceivablesMoneyDatabaseError(error: { code: string; meta?: { target?: unknown } | null }): "revision_conflict" | "internal" | null {
  const target = error.meta?.target;
  const revisionConflict = target === "receivable_ledger_revisions_ledger_id_revision_key" || (Array.isArray(target) && target.length === 2 && target[0] === "ledger_id" && target[1] === "revision");
  if (error.code === "P2002" && revisionConflict) return "revision_conflict";
  if (error.code === "P2002" || error.code === "P2025") return "internal";
  return null;
}
function parseOpeningDateHistory(metadata: Prisma.JsonValue | null) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw openingDateHistoryInvalid();
  const before = metadata.before;
  if (!before || typeof before !== "object" || Array.isArray(before) || !Object.prototype.hasOwnProperty.call(before, "openingChargeDate")) throw openingDateHistoryInvalid();
  const revision = before.revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision <= 0) throw openingDateHistoryInvalid();
  const value = before.openingChargeDate;
  if (value === null) return { revision, openingChargeDate: null };
  if (typeof value !== "string") throw openingDateHistoryInvalid();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) throw openingDateHistoryInvalid();
  return { revision, openingChargeDate: parsed };
}
function decimal(value: string, invalid: () => Error, positive: boolean) {
  try {
    const parsed = new Prisma.Decimal(value.trim());
    if (!parsed.isFinite() || parsed.isNegative() || (positive && parsed.isZero()) || parsed.decimalPlaces() > 4 || parsed.trunc().toFixed(0).length > 14) throw new Error();
    return parsed;
  } catch { throw invalid(); }
}
function date(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw dateInvalid();
  return parsed;
}
function text(value: string | null | undefined) { return value === undefined ? undefined : value === null ? null : value.trim() || null; }
function responseDetail<T extends { amount: Prisma.Decimal }>(row: T) { return { ...row, amount: row.amount.toFixed(4) }; }
function scope(access: ReceivablesAccess) { return access.canManageAll ? {} : { financeDepartmentId: { in: access.writeDepartmentIds } }; }
function auditScope(access: ReceivablesAccess, departmentId: string) { return { actorRole: access.role, actorScopeType: access.canManageAll ? "receivables" : "receivable_department", actorScopeId: access.canManageAll ? null : departmentId }; }

async function lockAuthority(tx: Tx, principal: Principal) {
  await tx.$queryRaw`SELECT 'locked'::text AS locked FROM pg_advisory_xact_lock(${setupLockKey})`;
  await tx.$queryRaw`SELECT id FROM receivable_access_grants WHERE account_id = ${principal.accountId}::uuid ORDER BY id FOR UPDATE`;
  return resolveReceivablesAccess(principal, tx);
}
async function writableLedger(tx: Tx, access: ReceivablesAccess, ledgerId: string) {
  // Read the department only to acquire the shared lock prefix; the locked query below remains the authority.
  requireReceivables(access, "manageMoney");
  const candidate = await tx.receivableLedger.findFirst({ where: { id: ledgerId, ...scope(access) }, select: { financeDepartmentId: true } });
  if (!candidate) throw notFound();
  const [department] = await tx.$queryRaw<Array<{ id: string; active: boolean }>>`SELECT id, active FROM receivable_departments WHERE id = ${candidate.financeDepartmentId}::uuid FOR UPDATE`;
  if (!department) throw httpError(409, "RECEIVABLES_DEPARTMENT_INACTIVE", "财务归属部门不存在");
  if (access.canManageAll) await tx.$queryRaw`SELECT id FROM receivable_ledgers WHERE id = ${ledgerId}::uuid FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM receivable_ledgers WHERE id = ${ledgerId}::uuid AND finance_department_id IN (${Prisma.join(access.writeDepartmentIds.map((id) => Prisma.sql`${id}::uuid`))}) FOR UPDATE`;
  const row = await tx.receivableLedger.findFirst({ where: { id: ledgerId, ...scope(access) }, select: ledgerSelect });
  if (!row) throw notFound();
  if (row.financeDepartmentId !== candidate.financeDepartmentId) throw conflict();
  requireReceivables(access, "manageMoney", row.financeDepartmentId);
  if (row.status !== "active") throw voidedLedger();
  return row;
}
function assertDetailActive(status: string) { try { assertTransition(status, "money"); } catch { throw voidedDetail(); } }
async function aggregates(tx: Tx, ledgerId: string) {
  const [invoices, receipts] = await Promise.all([
    tx.receivableInvoice.findMany({ where: { ledgerId }, select: { amount: true, status: true } }),
    tx.receivableReceipt.findMany({ where: { ledgerId }, select: { amount: true, status: true } }),
  ]);
  return { invoices, receipts };
}
async function notifyAnomaly(tx: Tx, ledger: Ledger, beforeAnomaly: string | null, afterAnomaly: string | null) {
  if (!afterAnomaly || afterAnomaly === beforeAnomaly) return;
  const setting = await tx.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true } });
  if (!setting?.financeOrganizationId) return;
  const [leaders, administrators] = await Promise.all([
    tx.roleAssignment.findMany({ where: { role: "org_leader", scopeType: "organization", scopeId: setting.financeOrganizationId, active: true, activationPending: false, personId: { not: null }, person: { status: "active", account: { status: "active" } } }, select: { personId: true } }),
    tx.receivableAccessGrant.findMany({ where: { role: "admin", active: true, revokedAt: null, person: { status: "active", account: { status: "active" } } }, select: { personId: true } }),
  ]);
  const recipients = [...new Set([...leaders.map((row) => row.personId), ...administrators.map((row) => row.personId)].filter((id): id is string => !!id))];
  const base = `receivables-anomaly:${ledger.id}:${afterAnomaly}:${ledger.revision + 1}`;
  if (recipients.length) await tx.notification.createMany({ data: recipients.map((personId) => ({ personId, title: "应收账款待核对", body: `合同台账出现${afterAnomaly === "over_received" ? "超收" : "核销待调减"}，请核对处理。`, dedupeKey: `${base}:${personId}` })), skipDuplicates: true });
}
async function openingChargeDate(tx: Tx, before: Ledger, latestInvoice: { invoiceDate: Date } | null) {
  if (latestInvoice) return latestInvoice.invoiceDate;
  const hasInvoiceHistory = await tx.receivableInvoice.findFirst({ where: { ledgerId: before.id }, select: { id: true } });
  if (!hasInvoiceHistory) return before.openingChargeDate;
  const createAudits = await tx.auditLog.findMany({
    where: { objectType: "receivable_ledger", objectId: before.id, action: "receivables.money.invoice.create", result: "success" },
    select: { metadata: true },
  });
  if (!createAudits.length) throw openingDateHistoryInvalid();
  const histories = createAudits.map(({ metadata }) => parseOpeningDateHistory(metadata));
  const fallbacksByRevision = new Map<number, string | null>();
  for (const history of histories) {
    const fallback = history.openingChargeDate?.toISOString() ?? null;
    if (fallbacksByRevision.has(history.revision) && fallbacksByRevision.get(history.revision) !== fallback) throw openingDateHistoryInvalid();
    fallbacksByRevision.set(history.revision, fallback);
  }
  return histories.reduce((earliest, history) => history.revision < earliest.revision ? history : earliest).openingChargeDate;
}
async function updateParent(tx: Tx, context: ReceivablesMoneyContext, access: ReceivablesAccess, before: Ledger, reason: string, action: string, beforeAnomaly: string | null, nextWriteoff = before.writeoffAmount, detailAudit?: DetailAudit) {
  const detailTotals = await aggregates(tx, before.id);
  const afterAmounts = calculateReceivableAmounts({ finalAmount: before.finalAmount, writeoffAmount: nextWriteoff, invoiceAmounts: detailTotals.invoices, receiptAmounts: detailTotals.receipts });
  const latestInvoice = await tx.receivableInvoice.findFirst({ where: { ledgerId: before.id, status: "active" }, orderBy: [{ invoiceDate: "desc" }, { id: "desc" }], select: { invoiceDate: true } });
  const nextOpeningChargeDate = await openingChargeDate(tx, before, latestInvoice);
  await tx.receivableLedgerRevision.create({ data: { ledgerId: before.id, revision: before.revision, beforeSnapshot: snapshot(before), reason, changedBy: context.principal.accountId } });
  const changed = await tx.receivableLedger.updateMany({ where: { id: before.id, revision: before.revision, status: "active" }, data: { openingChargeDate: nextOpeningChargeDate, writeoffAmount: nextWriteoff, updatedBy: context.principal.accountId, revision: { increment: 1 } } });
  if (changed.count !== 1) throw conflict();
  const after = await tx.receivableLedger.findUniqueOrThrow({ where: { id: before.id }, select: ledgerSelect });
  await notifyAnomaly(tx, before, beforeAnomaly, afterAmounts.anomaly);
  await writeCriticalAudit(tx, { actorId: context.principal.accountId, action, objectType: "receivable_ledger", objectId: before.id, requestId: context.requestId, ...auditScope(access, before.financeDepartmentId), reason, metadata: { before: snapshot(before), after: { ...snapshot(after), amounts: afterAmounts }, ...(detailAudit ? { detailType: detailAudit.detailType, detailId: detailAudit.detailId, detail: { before: detailAudit.before, after: detailAudit.after } } : {}) } });
  return { ledger: { ...after, ...afterAmounts, finalAmount: after.finalAmount?.toFixed(4) ?? null, writeoffAmount: after.writeoffAmount.toFixed(4) }, amounts: afterAmounts };
}
async function detailCommand(context: ReceivablesMoneyContext, operation: Exclude<ReceivablesMoneyOperation, { type: "writeoff.patch" }>) {
  return prisma.$transaction(async (tx) => {
    const access = await lockAuthority(tx, context.principal);
    const before = await writableLedger(tx, access, operation.ledgerId);
    if (before.revision !== operation.input.ledgerRevision) throw conflict();
    const beforeTotals = await aggregates(tx, before.id);
    const beforeAnomaly = calculateReceivableAmounts({ finalAmount: before.finalAmount, writeoffAmount: before.writeoffAmount, invoiceAmounts: beforeTotals.invoices, receiptAmounts: beforeTotals.receipts }).anomaly;
    const invoice = operation.type.startsWith("invoice");
    const creating = operation.type.endsWith(".create");
    const detailId = creating ? null : (operation as { detailId: string }).detailId;
    const reason = creating ? `登记${invoice ? "开票" : "回款"}` : (operation.input as { reason: string }).reason.trim();
    let result: { id: string; amount: Prisma.Decimal } & Record<string, unknown>;
    let detailBefore: Prisma.InputJsonObject | null = null;
    if (invoice) {
      if (creating) {
        const input = operation.input as DetailInput;
        result = await tx.receivableInvoice.create({ data: { ledgerId: before.id, invoiceDate: date(input.date), invoiceNo: text(input.invoiceNo) ?? null, amount: decimal(input.amount, amountInvalid, true), note: text(input.note) ?? null, createdBy: context.principal.accountId } });
      } else {
        const input = operation.input as UpdateDetailInput;
        const current = await tx.receivableInvoice.findFirst({ where: { id: detailId!, ledgerId: before.id } });
        if (!current) throw detailNotFound(); assertDetailActive(current.status); if (current.revision !== input.revision) throw conflict();
        detailBefore = snapshot(current);
        const changed = operation.type.endsWith(".void")
          ? await tx.receivableInvoice.updateMany({ where: { id: current.id, ledgerId: before.id, revision: input.revision, status: "active" }, data: { status: "voided", voidedAt: new Date(), voidedBy: context.principal.accountId, voidReason: reason, revision: { increment: 1 } } })
          : await tx.receivableInvoice.updateMany({ where: { id: current.id, ledgerId: before.id, revision: input.revision, status: "active" }, data: { invoiceDate: date(input.date), invoiceNo: text(input.invoiceNo) ?? null, amount: decimal(input.amount, amountInvalid, true), note: text(input.note) ?? null, revision: { increment: 1 } } });
        if (changed.count !== 1) throw conflict();
        result = await tx.receivableInvoice.findUniqueOrThrow({ where: { id: current.id } });
      }
    } else if (creating) {
      const input = operation.input as DetailInput;
      result = await tx.receivableReceipt.create({ data: { ledgerId: before.id, receiptDate: date(input.date), referenceNo: text(input.referenceNo) ?? null, amount: decimal(input.amount, amountInvalid, true), note: text(input.note) ?? null, createdBy: context.principal.accountId } });
    } else {
      const input = operation.input as UpdateDetailInput;
      const current = await tx.receivableReceipt.findFirst({ where: { id: detailId!, ledgerId: before.id } });
      if (!current) throw detailNotFound(); assertDetailActive(current.status); if (current.revision !== input.revision) throw conflict();
      detailBefore = snapshot(current);
      const changed = operation.type.endsWith(".void")
        ? await tx.receivableReceipt.updateMany({ where: { id: current.id, ledgerId: before.id, revision: input.revision, status: "active" }, data: { status: "voided", voidedAt: new Date(), voidedBy: context.principal.accountId, voidReason: reason, revision: { increment: 1 } } })
        : await tx.receivableReceipt.updateMany({ where: { id: current.id, ledgerId: before.id, revision: input.revision, status: "active" }, data: { receiptDate: date(input.date), referenceNo: text(input.referenceNo) ?? null, amount: decimal(input.amount, amountInvalid, true), note: text(input.note) ?? null, revision: { increment: 1 } } });
      if (changed.count !== 1) throw conflict();
      result = await tx.receivableReceipt.findUniqueOrThrow({ where: { id: current.id } });
    }
    await updateParent(tx, context, access, before, reason, `receivables.money.${operation.type}`, beforeAnomaly, before.writeoffAmount, { detailType: invoice ? "invoice" : "receipt", detailId: result.id, before: detailBefore, after: snapshot(result) });
    return responseDetail(result);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
async function writeoffCommand(context: ReceivablesMoneyContext, operation: Extract<ReceivablesMoneyOperation, { type: "writeoff.patch" }>) {
  return prisma.$transaction(async (tx) => {
    const access = await lockAuthority(tx, context.principal);
    const before = await writableLedger(tx, access, operation.ledgerId);
    if (before.revision !== operation.input.ledgerRevision) throw conflict();
    const totals = await aggregates(tx, before.id);
    const beforeAmounts = calculateReceivableAmounts({ finalAmount: before.finalAmount, writeoffAmount: before.writeoffAmount, invoiceAmounts: totals.invoices, receiptAmounts: totals.receipts });
    const next = decimal(operation.input.writeoffAmount, writeoffInvalid, false);
    try { assertWriteoffAllowed({ previous: before.writeoffAmount, next, finalAmount: before.finalAmount, receivedAmount: beforeAmounts.receivedAmount }); } catch (error) { if (error instanceof Error && error.message === "WRITEOFF_EXCEEDS_BALANCE") throw httpError(409, "WRITEOFF_EXCEEDS_BALANCE", "核销金额超过未收余额"); throw error; }
    return updateParent(tx, context, access, before, operation.input.reason.trim(), "receivables.money.writeoff.patch", beforeAmounts.anomaly, next);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function writeReceivablesMoney(context: ReceivablesMoneyContext, operation: ReceivablesMoneyOperation) {
  try {
    return await (operation.type === "writeoff.patch" ? writeoffCommand(context, operation) : detailCommand(context, operation));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const classification = classifyReceivablesMoneyDatabaseError(error);
      if (classification === "revision_conflict") throw conflict();
      if (classification === "internal") throw unexpectedDatabaseConflict();
    }
    throw error;
  }
}
