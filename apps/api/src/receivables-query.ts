import { Prisma } from "@prisma/client";
import type { Principal } from "./auth.js";
import { prisma } from "./db.js";
import { calculateReceivableAmounts } from "./receivables-core.js";
import { requireReceivables, resolveReceivablesAccess, type ReceivablesAccess } from "./receivables-access.js";

export type ReceivablesFiltersInput = {
  financeDepartmentId?: string | undefined;
  status?: "active" | "voided" | "all" | undefined;
  settlement?: "unsettled" | "settled" | "all" | undefined;
  debtStatus?: string | undefined;
  creditorUnit?: string | undefined;
  anomaly?: "over_received" | "writeoff_adjustment_required" | "final_amount_missing" | undefined;
  search?: string | undefined;
};

export type ReceivablesListInput = ReceivablesFiltersInput & {
  page?: number | undefined;
  pageSize?: number | undefined;
  sort?: "updatedAt" | "contractNo" | "projectName" | "customerName" | "debtStatus" | "finalAmount" | "invoicedAmount" | "receivedAmount" | "balance" | "openingChargeDate" | undefined;
  order?: "asc" | "desc" | undefined;
};

export type ReceivablesQueryOperation =
  | { type: "ledger.list"; input: ReceivablesListInput }
  | { type: "ledger.detail"; id: string }
  | { type: "dashboard"; input: ReceivablesFiltersInput };

type NormalizedFilters = {
  financeDepartmentId: string | null;
  status: "active" | "voided" | "all";
  settlement: "unsettled" | "settled" | "all";
  debtStatus: string | null;
  creditorUnit: string | null;
  anomaly: "over_received" | "writeoff_adjustment_required" | "final_amount_missing" | null;
  search: string | null;
};

type QueryScope = NormalizedFilters & { readDepartmentIds: string[] | null };
type QueryTx = Prisma.TransactionClient;
type Facet = { value: string | null; count: number };
type RawFacet = { value: string | null; count: number };
type RawDepartmentFacet = { value: string; name: string; count: number };
type RawAmounts = {
  active_ledger_count: number;
  final_amount: Prisma.Decimal | null;
  invoiced_amount: Prisma.Decimal;
  received_amount: Prisma.Decimal;
  internal_receivable: Prisma.Decimal;
  external_receivable: Prisma.Decimal | null;
  balance: Prisma.Decimal | null;
  writeoff_amount: Prisma.Decimal;
  final_amount_missing_count: number;
  over_received_count: number;
  writeoff_adjustment_required_count: number;
};
type RawRow = {
  id: string;
  finance_department_id: string;
  finance_department_name: string;
  contract_no: string;
  project_name: string | null;
  customer_name: string | null;
  customer_type: string | null;
  creditor_unit: string | null;
  work_nature: string | null;
  sector: string | null;
  project_status: string | null;
  settlement_method: string | null;
  contract_amount: Prisma.Decimal | null;
  final_amount: Prisma.Decimal | null;
  writeoff_amount: Prisma.Decimal;
  opening_charge_date: Date | null;
  debt_status: string | null;
  collection_owner: string | null;
  collection_notes: string | null;
  status: "active" | "voided";
  revision: number;
  voided_at: Date | null;
  voided_by: string | null;
  void_reason: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  invoiced_amount: Prisma.Decimal;
  received_amount: Prisma.Decimal;
  internal_receivable: Prisma.Decimal;
  external_receivable: Prisma.Decimal | null;
  balance: Prisma.Decimal | null;
  anomaly: "over_received" | "writeoff_adjustment_required" | "final_amount_missing" | null;
};

const notFound = () => Object.assign(new Error("应收账款台账不存在"), { statusCode: 404, code: "RECEIVABLES_LEDGER_NOT_FOUND" });
const forbiddenDepartment = () => Object.assign(new Error("无权读取该财务归属部门"), { statusCode: 403, code: "RECEIVABLES_FORBIDDEN" });
const money = (value: Prisma.Decimal | string | null) => value === null ? null : new Prisma.Decimal(value).toFixed(4);
const text = (value: string | undefined) => value?.trim() || null;

const sortColumns = {
  updatedAt: Prisma.sql`f.updated_at`,
  contractNo: Prisma.sql`f.contract_no`,
  projectName: Prisma.sql`f.project_name`,
  customerName: Prisma.sql`f.customer_name`,
  debtStatus: Prisma.sql`f.debt_status`,
  finalAmount: Prisma.sql`f.final_amount`,
  invoicedAmount: Prisma.sql`f.invoiced_amount`,
  receivedAmount: Prisma.sql`f.received_amount`,
  balance: Prisma.sql`f.balance`,
  openingChargeDate: Prisma.sql`f.opening_charge_date`,
} satisfies Record<NonNullable<ReceivablesListInput["sort"]>, Prisma.Sql>;

function normalizeFilters(input: ReceivablesFiltersInput): NormalizedFilters {
  return {
    financeDepartmentId: input.financeDepartmentId ?? null,
    status: input.status ?? "active",
    settlement: input.settlement ?? "unsettled",
    debtStatus: text(input.debtStatus),
    creditorUnit: text(input.creditorUnit),
    anomaly: input.anomaly ?? null,
    search: text(input.search),
  };
}

async function resolveQueryScope(tx: QueryTx, access: ReceivablesAccess, input: ReceivablesFiltersInput): Promise<QueryScope> {
  const filters = normalizeFilters(input);
  if (access.canManageAll || access.canViewAll) return { ...filters, readDepartmentIds: null };
  const activeDepartments = access.readDepartmentIds.length
    ? await tx.receivableDepartment.findMany({ where: { id: { in: access.readDepartmentIds }, active: true }, select: { id: true } })
    : [];
  const readDepartmentIds = activeDepartments.map(({ id }) => id).sort();
  if (filters.financeDepartmentId && !readDepartmentIds.includes(filters.financeDepartmentId)) throw forbiddenDepartment();
  return { ...filters, readDepartmentIds };
}

function queryWhere(scope: QueryScope): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  if (scope.readDepartmentIds !== null) {
    clauses.push(scope.readDepartmentIds.length
      ? Prisma.sql`q.finance_department_id IN (${Prisma.join(scope.readDepartmentIds.map((id) => Prisma.sql`${id}::uuid`))})`
      : Prisma.sql`FALSE`);
  }
  if (scope.financeDepartmentId) clauses.push(Prisma.sql`q.finance_department_id = ${scope.financeDepartmentId}::uuid`);
  if (scope.status !== "all") clauses.push(Prisma.sql`q.status = ${scope.status}::"ReceivableRecordStatus"`);
  if (scope.settlement === "unsettled") clauses.push(Prisma.sql`(q.balance IS NULL OR q.balance <> 0)`);
  if (scope.settlement === "settled") clauses.push(Prisma.sql`q.balance = 0`);
  if (scope.debtStatus) clauses.push(Prisma.sql`q.debt_status = ${scope.debtStatus}`);
  if (scope.creditorUnit) clauses.push(Prisma.sql`q.creditor_unit = ${scope.creditorUnit}`);
  if (scope.anomaly) clauses.push(Prisma.sql`q.anomaly = ${scope.anomaly}`);
  if (scope.search) {
    const search = `%${scope.search}%`;
    clauses.push(Prisma.sql`(q.contract_no ILIKE ${search} OR q.project_name ILIKE ${search} OR q.customer_name ILIKE ${search})`);
  }
  return clauses.length ? Prisma.join(clauses, " AND ") : Prisma.sql`TRUE`;
}

function filteredCte(scope: QueryScope): Prisma.Sql {
  return Prisma.sql`
    WITH enriched AS (
      SELECT l.*, d.name AS finance_department_name,
        COALESCE(i.invoiced_amount, 0::numeric) AS invoiced_amount,
        COALESCE(r.received_amount, 0::numeric) AS received_amount,
        COALESCE(i.invoiced_amount, 0::numeric) - COALESCE(r.received_amount, 0::numeric) AS internal_receivable,
        CASE WHEN l.final_amount IS NULL THEN NULL ELSE l.final_amount - COALESCE(i.invoiced_amount, 0::numeric) END AS external_receivable,
        CASE WHEN l.final_amount IS NULL THEN NULL ELSE l.final_amount - COALESCE(r.received_amount, 0::numeric) - l.writeoff_amount END AS balance,
        CASE
          WHEN l.final_amount IS NULL THEN 'final_amount_missing'
          WHEN l.final_amount - COALESCE(r.received_amount, 0::numeric) - l.writeoff_amount < 0 AND l.writeoff_amount > 0 THEN 'writeoff_adjustment_required'
          WHEN l.final_amount - COALESCE(r.received_amount, 0::numeric) - l.writeoff_amount < 0 THEN 'over_received'
          ELSE NULL
        END AS anomaly
      FROM receivable_ledgers l
      JOIN receivable_departments d ON d.id = l.finance_department_id
      LEFT JOIN LATERAL (
        SELECT SUM(amount) AS invoiced_amount FROM receivable_invoices WHERE ledger_id = l.id AND status = 'active'
      ) i ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(amount) AS received_amount FROM receivable_receipts WHERE ledger_id = l.id AND status = 'active'
      ) r ON TRUE
    ), filtered AS (SELECT * FROM enriched q WHERE ${queryWhere(scope)})
  `;
}

const rowColumns = Prisma.sql`
  f.id, f.finance_department_id, f.finance_department_name, f.contract_no, f.project_name, f.customer_name,
  f.customer_type, f.creditor_unit, f.work_nature, f.sector, f.project_status, f.settlement_method,
  f.contract_amount, f.final_amount, f.writeoff_amount, f.opening_charge_date, f.debt_status,
  f.collection_owner, f.collection_notes, f.status, f.revision, f.voided_at, f.voided_by, f.void_reason,
  f.created_by, f.updated_by, f.created_at, f.updated_at, f.invoiced_amount, f.received_amount,
  f.internal_receivable, f.external_receivable, f.balance, f.anomaly
`;

function mapRow(row: RawRow) {
  return {
    id: row.id,
    financeDepartmentId: row.finance_department_id,
    financeDepartmentName: row.finance_department_name,
    contractNo: row.contract_no,
    projectName: row.project_name,
    customerName: row.customer_name,
    customerType: row.customer_type,
    creditorUnit: row.creditor_unit,
    workNature: row.work_nature,
    sector: row.sector,
    projectStatus: row.project_status,
    settlementMethod: row.settlement_method,
    contractAmount: money(row.contract_amount),
    finalAmount: money(row.final_amount),
    writeoffAmount: money(row.writeoff_amount)!,
    openingChargeDate: row.opening_charge_date,
    debtStatus: row.debt_status,
    collectionOwner: row.collection_owner,
    collectionNotes: row.collection_notes,
    status: row.status,
    revision: row.revision,
    voidedAt: row.voided_at,
    voidedBy: row.voided_by,
    voidReason: row.void_reason,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    invoicedAmount: money(row.invoiced_amount)!,
    receivedAmount: money(row.received_amount)!,
    internalReceivable: money(row.internal_receivable)!,
    externalReceivable: money(row.external_receivable),
    balance: money(row.balance),
    anomaly: row.anomaly,
  };
}

async function amounts(tx: QueryTx, cte: Prisma.Sql) {
  const [row] = await tx.$queryRaw<RawAmounts[]>(Prisma.sql`${cte}
    SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active_ledger_count,
      SUM(final_amount) FILTER (WHERE status = 'active' AND final_amount IS NOT NULL) AS final_amount,
      COALESCE(SUM(invoiced_amount) FILTER (WHERE status = 'active'), 0::numeric) AS invoiced_amount,
      COALESCE(SUM(received_amount) FILTER (WHERE status = 'active'), 0::numeric) AS received_amount,
      COALESCE(SUM(internal_receivable) FILTER (WHERE status = 'active'), 0::numeric) AS internal_receivable,
      SUM(external_receivable) FILTER (WHERE status = 'active' AND final_amount IS NOT NULL) AS external_receivable,
      SUM(balance) FILTER (WHERE status = 'active' AND final_amount IS NOT NULL) AS balance,
      COALESCE(SUM(writeoff_amount) FILTER (WHERE status = 'active'), 0::numeric) AS writeoff_amount,
      COUNT(*) FILTER (WHERE status = 'active' AND anomaly = 'final_amount_missing')::int AS final_amount_missing_count,
      COUNT(*) FILTER (WHERE status = 'active' AND anomaly = 'over_received')::int AS over_received_count,
      COUNT(*) FILTER (WHERE status = 'active' AND anomaly = 'writeoff_adjustment_required')::int AS writeoff_adjustment_required_count
    FROM filtered`);
  if (!row) throw new Error("RECEIVABLES_TOTALS_MISSING");
  return {
    activeLedgerCount: row.active_ledger_count,
    finalAmount: money(row.final_amount),
    invoicedAmount: money(row.invoiced_amount)!,
    receivedAmount: money(row.received_amount)!,
    internalReceivable: money(row.internal_receivable)!,
    externalReceivable: money(row.external_receivable),
    balance: money(row.balance),
    writeoffAmount: money(row.writeoff_amount)!,
    finalAmountMissingCount: row.final_amount_missing_count,
    overReceivedCount: row.over_received_count,
    writeoffAdjustmentRequiredCount: row.writeoff_adjustment_required_count,
  };
}

async function facet(tx: QueryTx, cte: Prisma.Sql, column: Prisma.Sql): Promise<Facet[]> {
  return tx.$queryRaw<RawFacet[]>(Prisma.sql`${cte}
    SELECT ${column} AS value, COUNT(*)::int AS count FROM filtered f GROUP BY ${column} ORDER BY ${column} ASC NULLS FIRST`);
}

async function statusFacets(tx: QueryTx, cte: Prisma.Sql) {
  return facet(tx, cte, Prisma.sql`f.status::text`);
}

async function anomalyFacets(tx: QueryTx, cte: Prisma.Sql) {
  return facet(tx, cte, Prisma.sql`f.anomaly`);
}

async function listLedgers(tx: QueryTx, scope: QueryScope, input: ReceivablesListInput) {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;
  const sort = input.sort ?? "updatedAt";
  const order = input.order ?? "desc";
  const direction = order === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const cte = filteredCte(scope);
  const [rawRows, countRows, departmentFacets, debtStatuses, creditorUnits, statuses, anomalies, totals] = await Promise.all([
    tx.$queryRaw<RawRow[]>(Prisma.sql`${cte} SELECT ${rowColumns} FROM filtered f ORDER BY ${sortColumns[sort]} ${direction} NULLS LAST, f.id ${direction} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`${cte} SELECT COUNT(*)::int AS count FROM filtered`),
    tx.$queryRaw<RawDepartmentFacet[]>(Prisma.sql`${cte} SELECT f.finance_department_id AS value, f.finance_department_name AS name, COUNT(*)::int AS count FROM filtered f GROUP BY f.finance_department_id, f.finance_department_name ORDER BY f.finance_department_name, f.finance_department_id`),
    facet(tx, cte, Prisma.sql`f.debt_status`),
    facet(tx, cte, Prisma.sql`f.creditor_unit`),
    statusFacets(tx, cte),
    anomalyFacets(tx, cte),
    amounts(tx, cte),
  ]);
  return {
    rows: rawRows.map(mapRow), page, pageSize, total: countRows[0]?.count ?? 0,
    facets: { departments: departmentFacets, debtStatuses, creditorUnits, statuses, anomalies },
    totals,
  };
}

async function dashboard(tx: QueryTx, scope: QueryScope) {
  const cte = filteredCte(scope);
  const [dashboardAmounts, statuses, anomalies] = await Promise.all([amounts(tx, cte), statusFacets(tx, cte), anomalyFacets(tx, cte)]);
  return { amounts: dashboardAmounts, statuses, anomalies };
}

async function ledgerDetail(tx: QueryTx, access: ReceivablesAccess, scope: QueryScope, id: string) {
  const row = await tx.receivableLedger.findFirst({
    where: { id, ...(scope.readDepartmentIds === null ? {} : { financeDepartmentId: { in: scope.readDepartmentIds } }) },
    select: {
      id: true, financeDepartmentId: true, contractNo: true, projectName: true, customerName: true, customerType: true,
      creditorUnit: true, workNature: true, sector: true, projectStatus: true, settlementMethod: true, contractAmount: true,
      finalAmount: true, writeoffAmount: true, openingChargeDate: true, debtStatus: true, collectionOwner: true,
      collectionNotes: true, status: true, revision: true, voidedAt: true, voidedBy: true, voidReason: true,
      createdBy: true, updatedBy: true, createdAt: true, updatedAt: true,
      financeDepartment: { select: { name: true } },
      invoices: { orderBy: [{ invoiceDate: "asc" }, { id: "asc" }], select: { id: true, invoiceNo: true, invoiceDate: true, amount: true, note: true, source: true, status: true, revision: true, voidedAt: true, voidedBy: true, voidReason: true, createdBy: true, createdAt: true, updatedAt: true } },
      receipts: { orderBy: [{ receiptDate: "asc" }, { id: "asc" }], select: { id: true, receiptDate: true, referenceNo: true, amount: true, note: true, source: true, status: true, revision: true, voidedAt: true, voidedBy: true, voidReason: true, createdBy: true, createdAt: true, updatedAt: true } },
      attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, category: true, status: true, revision: true, uploadedBy: true, voidedAt: true, voidedBy: true, voidReason: true, createdAt: true, updatedAt: true, file: { select: { id: true, originalName: true, mimeType: true, size: true, sha256: true } } } },
      revisions: { orderBy: [{ revision: "asc" }, { id: "asc" }], select: { id: true, revision: true, beforeSnapshot: true, reason: true, changedBy: true, importBatchId: true, createdAt: true } },
    },
  });
  if (!row) throw notFound();
  const calculated = calculateReceivableAmounts({ finalAmount: row.finalAmount, writeoffAmount: row.writeoffAmount, invoiceAmounts: row.invoices, receiptAmounts: row.receipts });
  const { financeDepartment, invoices, receipts, attachments, revisions, ...ledger } = row;
  return {
    ledger: {
      ...ledger, financeDepartmentName: financeDepartment.name, contractAmount: money(ledger.contractAmount), finalAmount: money(ledger.finalAmount),
      writeoffAmount: money(ledger.writeoffAmount)!, ...calculated,
    },
    invoices: invoices.map((invoice) => ({ ...invoice, amount: money(invoice.amount)! })),
    receipts: receipts.map((receipt) => ({ ...receipt, amount: money(receipt.amount)! })),
    attachments,
    revisions,
    capabilities: access,
  };
}

export async function queryReceivables(principal: Principal, operation: ReceivablesQueryOperation) {
  return prisma.$transaction(async (tx) => {
    const access = await resolveReceivablesAccess(principal, tx);
    requireReceivables(access, "read");
    const input = operation.type === "ledger.detail" ? {} : operation.input;
    const scope = await resolveQueryScope(tx, access, input);
    if (operation.type === "ledger.list") return listLedgers(tx, scope, operation.input);
    if (operation.type === "dashboard") return dashboard(tx, scope);
    return ledgerDetail(tx, access, scope, operation.id);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
