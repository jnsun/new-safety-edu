import { Prisma } from "@prisma/client";
import type { Principal } from "./auth.js";
import { prisma } from "./db.js";
import { assertLedgerPatchAllowed, assertTransition, defaultCreditorUnitForContract } from "./receivables-core.js";
import { requireReceivables, resolveReceivablesAccess, type ReceivablesAccess } from "./receivables-access.js";
import { writeCriticalAudit } from "./transaction-audit.js";

type LedgerFields = {
  financeDepartmentId?: string | undefined;
  contractNo?: string | undefined;
  projectName?: string | null | undefined;
  customerName?: string | null | undefined;
  customerType?: string | null | undefined;
  creditorUnit?: string | null | undefined;
  workNature?: string | null | undefined;
  sector?: string | null | undefined;
  projectStatus?: string | null | undefined;
  settlementMethod?: string | null | undefined;
  contractAmount?: string | null | undefined;
  finalAmount?: string | null | undefined;
  openingChargeDate?: string | null | undefined;
  debtStatus?: string | null | undefined;
  collectionOwner?: string | null | undefined;
  collectionNotes?: string | null | undefined;
  dunningDate?: string | null | undefined;
  communicationMethod?: string | null | undefined;
  counterpartyFeedback?: string | null | undefined;
  latestProgress?: string | null | undefined;
  nextPlan?: string | null | undefined;
};

export type ReceivablesLedgerOperation =
  | { type: "create"; input: LedgerFields & { financeDepartmentId: string; contractNo: string } }
  | { type: "patch"; id: string; input: LedgerFields & { revision: number; reason: string } }
  | { type: "void"; id: string; input: { revision: number; reason: string; confirm: true } };

export type ReceivablesLedgerContext = { principal: Principal; requestId: string };

const ledgerSelect = {
  id: true, financeDepartmentId: true, contractNo: true, contractNoNormalized: true, projectName: true,
  customerName: true, customerType: true, creditorUnit: true, workNature: true, sector: true,
  projectStatus: true, settlementMethod: true, contractAmount: true, finalAmount: true, writeoffAmount: true,
  openingChargeDate: true, debtStatus: true, collectionOwner: true, collectionNotes: true, status: true,
  dunningDate: true, communicationMethod: true, counterpartyFeedback: true, latestProgress: true, nextPlan: true,
  revision: true, voidedAt: true, voidedBy: true, voidReason: true, createdBy: true, updatedBy: true,
  createdByImportBatchId: true, createdAt: true, updatedAt: true,
} satisfies Prisma.ReceivableLedgerSelect;

type LedgerRow = Prisma.ReceivableLedgerGetPayload<{ select: typeof ledgerSelect }>;
type LedgerTx = Prisma.TransactionClient;

const httpError = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const notFound = () => httpError(404, "RECEIVABLES_LEDGER_NOT_FOUND", "应收账款台账不存在");
const revisionConflict = () => httpError(409, "REVISION_CONFLICT", "台账版本已变化，请刷新后重试");
const voided = () => httpError(409, "RECEIVABLES_LEDGER_VOIDED", "已作废台账只读");
const reporterFieldForbidden = () => httpError(403, "RECEIVABLES_REPORTER_FIELD_NOT_ALLOWED", "报账员无权修改该字段");
const unexpectedUniqueConflict = () => httpError(500, "INTERNAL_ERROR", "未识别的唯一约束冲突");
const setupLockKey = 8_645_136_501n;
const workloadSettlement = "按工作量结算";
const textFields = ["projectName", "customerName", "customerType", "creditorUnit", "workNature", "sector", "projectStatus", "settlementMethod", "debtStatus", "collectionOwner", "collectionNotes", "communicationMethod", "counterpartyFeedback", "latestProgress", "nextPlan"] as const;

function snapshot(row: LedgerRow): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(row)) as Prisma.InputJsonObject;
}

function hasExactUniqueTarget(error: Prisma.PrismaClientKnownRequestError, columns: readonly string[], indexName: string) {
  const target = error.meta?.target;
  return target === indexName || (Array.isArray(target) && target.length === columns.length && target.every((column, index) => column === columns[index]));
}

function decimal18_4(value: string | null, field: string): Prisma.Decimal | null {
  if (value === null) return null;
  try {
    const parsed = new Prisma.Decimal(value.trim());
    if (!parsed.isFinite() || parsed.isNegative() || parsed.decimalPlaces() > 4 || parsed.trunc().toFixed(0).length > 14) throw new Error();
    return parsed;
  } catch {
    throw httpError(400, "RECEIVABLES_AMOUNT_INVALID", `${field}必须为非负 Decimal(18,4) 金额`);
  }
}

function dateOnly(value: string | null, label: string): Date | null {
  if (value === null) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw httpError(400, "RECEIVABLES_DATE_INVALID", `${label}格式无效`);
  }
  return parsed;
}

function normalizeFields(input: LedgerFields, current?: LedgerRow): Prisma.ReceivableLedgerUncheckedUpdateInput {
  const data: Prisma.ReceivableLedgerUncheckedUpdateInput = {};
  if (input.financeDepartmentId !== undefined) data.financeDepartmentId = input.financeDepartmentId;
  if (input.contractNo !== undefined) {
    const contractNo = input.contractNo.trim();
    if (!contractNo) throw httpError(400, "RECEIVABLES_CONTRACT_NO_REQUIRED", "合同编号不能为空");
    data.contractNo = contractNo;
    data.contractNoNormalized = contractNo;
  }
  for (const field of textFields) {
    if (input[field] !== undefined) data[field] = input[field] === null ? null : input[field]!.trim() || null;
  }
  const effectiveContractNo = input.contractNo?.trim() || current?.contractNo || "";
  if ((!current || current.creditorUnit === null) && (input.creditorUnit === undefined || input.creditorUnit === null || !input.creditorUnit.trim())) {
    data.creditorUnit = defaultCreditorUnitForContract(effectiveContractNo);
  }
  if (input.contractAmount !== undefined) data.contractAmount = decimal18_4(input.contractAmount, "合同金额");
  if (input.finalAmount !== undefined) data.finalAmount = decimal18_4(input.finalAmount, "决算金额");
  if (input.openingChargeDate !== undefined) data.openingChargeDate = dateOnly(input.openingChargeDate, "挂账日期");
  if (input.dunningDate !== undefined) data.dunningDate = dateOnly(input.dunningDate, "最新催收时间");

  const shouldConsiderAutoFinal = current
    ? current.finalAmount === null && (input.contractAmount !== undefined || input.settlementMethod !== undefined)
    : input.contractAmount !== undefined;
  if (input.finalAmount === null || input.finalAmount === undefined && shouldConsiderAutoFinal) {
    const settlementMethod = input.settlementMethod === undefined ? current?.settlementMethod ?? null : (data.settlementMethod as string | null);
    const contractAmount = input.contractAmount === undefined ? current?.contractAmount : data.contractAmount;
    if (settlementMethod !== workloadSettlement && contractAmount !== null && contractAmount !== undefined) data.finalAmount = contractAmount;
  }
  const effectiveSettlementMethod = input.settlementMethod === undefined ? current?.settlementMethod ?? null : data.settlementMethod;
  if (input.contractAmount === null && input.finalAmount === null && effectiveSettlementMethod !== workloadSettlement) {
    throw httpError(400, "RECEIVABLES_FINAL_AMOUNT_REQUIRED", "非工作量结算必须提供合同金额或决算金额");
  }
  return data;
}

function assertFieldPolicy(access: ReceivablesAccess, current: LedgerRow | null, fields: Record<string, unknown>) {
  try {
    assertLedgerPatchAllowed(access, current, fields);
  } catch (error) {
    if (error instanceof Error && ["REPORTER_FIELD_NOT_ALLOWED", "REPORTER_CREATE_NOT_ALLOWED"].includes(error.message)) throw reporterFieldForbidden();
    throw error;
  }
}

async function lockLedgerAuthority(tx: LedgerTx, principal: Principal) {
  await tx.$queryRaw`SELECT 'locked'::text AS locked FROM pg_advisory_xact_lock(${setupLockKey})`;
  await tx.$queryRaw`SELECT id FROM receivable_access_grants WHERE account_id = ${principal.accountId}::uuid ORDER BY id FOR UPDATE`;
  return resolveReceivablesAccess(principal, tx);
}

async function lockActiveDepartment(tx: LedgerTx, id: string, currentId?: string) {
  const [department] = await tx.$queryRaw<Array<{ id: string; active: boolean }>>`SELECT id, active FROM receivable_departments WHERE id = ${id}::uuid FOR UPDATE`;
  if (!department || !department.active && currentId !== id) throw httpError(409, "RECEIVABLES_DEPARTMENT_INACTIVE", "财务归属部门不存在或已停用");
}

function writeScope(access: ReceivablesAccess) {
  return access.canManageAll ? {} : { financeDepartmentId: { in: access.writeDepartmentIds } };
}

async function findWritableLedger(tx: LedgerTx, access: ReceivablesAccess, id: string) {
  if (access.canManageAll) {
    await tx.$queryRaw`SELECT id FROM receivable_ledgers WHERE id = ${id}::uuid FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT id FROM receivable_ledgers WHERE id = ${id}::uuid AND finance_department_id IN (${Prisma.join(access.writeDepartmentIds.map((departmentId) => Prisma.sql`${departmentId}::uuid`))}) FOR UPDATE`;
  }
  return tx.receivableLedger.findFirst({ where: { id, ...writeScope(access) }, select: ledgerSelect });
}

function assertActive(row: LedgerRow, action: string) {
  try {
    assertTransition(row.status, action);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("VOIDED_FACT_IMMUTABLE:")) throw voided();
    throw error;
  }
}

const auditScope = (access: ReceivablesAccess, departmentId: string) => ({
  actorRole: access.role,
  actorScopeType: access.canManageAll ? "receivables" : "receivable_department",
  actorScopeId: access.canManageAll ? null : departmentId,
});

async function createLedger(context: ReceivablesLedgerContext, input: Extract<ReceivablesLedgerOperation, { type: "create" }>["input"]) {
  try {
    return await prisma.$transaction(async (tx) => {
      const access = await lockLedgerAuthority(tx, context.principal);
      await lockActiveDepartment(tx, input.financeDepartmentId);
      requireReceivables(access, "create", input.financeDepartmentId);
      assertFieldPolicy(access, null, input);
      const data = normalizeFields(input);
      const created = await tx.receivableLedger.create({
        data: { ...(data as Prisma.ReceivableLedgerUncheckedCreateInput), financeDepartmentId: input.financeDepartmentId, contractNo: data.contractNo as string, contractNoNormalized: data.contractNoNormalized as string, createdBy: context.principal.accountId },
        select: ledgerSelect,
      });
      await writeCriticalAudit(tx, {
        actorId: context.principal.accountId, action: "receivables.ledger.create", objectType: "receivable_ledger", objectId: created.id,
        requestId: context.requestId, ...auditScope(access, created.financeDepartmentId), metadata: { before: null, after: snapshot(created) },
      });
      return created;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      if (hasExactUniqueTarget(error, ["contract_no_normalized"], "receivable_ledgers_contract_no_normalized_key")) {
        throw httpError(409, "RECEIVABLES_CONTRACT_NO_CONFLICT", "合同编号已存在");
      }
      throw unexpectedUniqueConflict();
    }
    throw error;
  }
}

async function updateLedger(context: ReceivablesLedgerContext, operation: Extract<ReceivablesLedgerOperation, { type: "patch" | "void" }>) {
  try {
    return await prisma.$transaction(async (tx) => {
      const access = await lockLedgerAuthority(tx, context.principal);
      requireReceivables(access, "write");
      const candidate = operation.type === "patch" && operation.input.financeDepartmentId !== undefined
        ? await tx.receivableLedger.findFirst({ where: { id: operation.id, ...writeScope(access) }, select: { financeDepartmentId: true } })
        : null;
      if (operation.type === "patch" && operation.input.financeDepartmentId !== undefined) await lockActiveDepartment(tx, operation.input.financeDepartmentId, candidate?.financeDepartmentId);
      const before = await findWritableLedger(tx, access, operation.id);
      if (!before) throw notFound();
      if (candidate && before.financeDepartmentId !== candidate.financeDepartmentId) throw revisionConflict();
      assertActive(before, operation.type);
      const fields = operation.type === "patch"
        ? Object.fromEntries(Object.entries(operation.input).filter(([field]) => field !== "revision" && field !== "reason"))
        : { status: "voided" };
      assertFieldPolicy(access, before, fields);
      if (operation.input.revision !== before.revision) throw revisionConflict();

      const reason = operation.input.reason.trim();
      let data: Prisma.ReceivableLedgerUncheckedUpdateManyInput;
      if (operation.type === "patch") {
        data = { ...normalizeFields(operation.input, before), updatedBy: context.principal.accountId, revision: { increment: 1 } };
      } else {
        data = { status: "voided", voidedAt: new Date(), voidedBy: context.principal.accountId, voidReason: reason, updatedBy: context.principal.accountId, revision: { increment: 1 } };
      }

      await tx.receivableLedgerRevision.create({ data: { ledgerId: before.id, revision: before.revision, beforeSnapshot: snapshot(before), reason, changedBy: context.principal.accountId } });
      const updated = await tx.receivableLedger.updateMany({ where: { id: before.id, revision: operation.input.revision, status: "active" }, data });
      if (updated.count === 0) {
        const latest = await findWritableLedger(tx, access, operation.id);
        if (!latest) throw notFound();
        if (latest.status === "voided") throw voided();
        throw revisionConflict();
      }
      const after = await tx.receivableLedger.findUniqueOrThrow({ where: { id: before.id }, select: ledgerSelect });
      await writeCriticalAudit(tx, {
        actorId: context.principal.accountId, action: operation.type === "patch" ? "receivables.ledger.patch" : "receivables.ledger.void",
        objectType: "receivable_ledger", objectId: before.id, requestId: context.requestId, ...auditScope(access, before.financeDepartmentId),
        reason, metadata: { before: snapshot(before), after: snapshot(after) },
      });
      return after;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      if (hasExactUniqueTarget(error, ["contract_no_normalized"], "receivable_ledgers_contract_no_normalized_key")) {
        throw httpError(409, "RECEIVABLES_CONTRACT_NO_CONFLICT", "合同编号已存在");
      }
      if (hasExactUniqueTarget(error, ["ledger_id", "revision"], "receivable_ledger_revisions_ledger_id_revision_key")) throw revisionConflict();
      throw unexpectedUniqueConflict();
    }
    throw error;
  }
}

export async function writeReceivablesLedger(context: ReceivablesLedgerContext, operation: ReceivablesLedgerOperation): Promise<LedgerRow> {
  if (operation.type === "create") return createLedger(context, operation.input);
  return updateLedger(context, operation);
}
