import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Principal } from "./auth.js";
import { prisma } from "./db.js";
import { calculateReceivableAmounts } from "./receivables-core.js";
import {
  requireReceivables,
  resolveReceivablesAccess,
  type ReceivablesAccess,
} from "./receivables-access.js";

export type ReceivablesFiltersInput = {
  financeDepartmentId?: string | undefined;
  status?: "active" | "voided" | "all" | undefined;
  settlement?: "unsettled" | "settled" | "all" | undefined;
  debtStatus?: string | undefined;
  creditorUnit?: string | undefined;
  anomaly?:
    | "over_received"
    | "writeoff_adjustment_required"
    | "final_amount_missing"
    | undefined;
  search?: string | undefined;
};

export const receivablesExportCategoryIds = [
  "financeDepartment",
  "creditorUnit",
  "customerType",
  "workNature",
  "sector",
  "projectStatus",
  "settlementMethod",
  "debtStatus",
  "communicationMethod",
  "counterpartyFeedback",
  "latestProgress",
  "nextPlan",
  "status",
] as const;
export type ReceivablesExportCategoryId =
  (typeof receivablesExportCategoryIds)[number];
export type ReceivablesExportCategoryFilters = Partial<
  Record<ReceivablesExportCategoryId, string[]>
>;
export const receivablesExportColumns = [
  ["contractNo", "合同编号"],
  ["financeDepartmentName", "财务归属部门"],
  ["projectName", "项目名称"],
  ["customerName", "客户名称"],
  ["customerType", "客户属性"],
  ["creditorUnit", "债权单位"],
  ["workNature", "工作性质"],
  ["sector", "板块"],
  ["projectStatus", "项目状态"],
  ["settlementMethod", "决算方式"],
  ["contractAmount", "合同金额（万元）"],
  ["finalAmount", "决算金额（万元）"],
  ["invoicedAmount", "开票金额（万元）"],
  ["receivedAmount", "到账金额（万元）"],
  ["writeoffAmount", "核销金额（万元）"],
  ["internalReceivable", "账内应收（万元）"],
  ["externalReceivable", "账外应收（万元）"],
  ["balance", "应收余额（万元）"],
  ["openingChargeDate", "最新挂账时间"],
  ["debtStatus", "债权状态"],
  ["collectionOwner", "清收责任人"],
  ["collectionNotes", "催收备注"],
  ["dunningDate", "最新催收时间"],
  ["communicationMethod", "沟通方式"],
  ["counterpartyFeedback", "对方反馈"],
  ["latestProgress", "最新进展"],
  ["nextPlan", "下一步计划"],
  ["status", "记录状态"],
  ["anomaly", "异常"],
  ["updatedAt", "更新时间"],
] as const;
export type ReceivablesExportColumnId =
  (typeof receivablesExportColumns)[number][0];
export const receivablesExportColumnIds = receivablesExportColumns.map(
  ([id]) => id,
) as ReceivablesExportColumnId[];

export type ReceivablesListInput = ReceivablesFiltersInput & {
  page?: number | undefined;
  pageSize?: number | undefined;
  sort?:
    | "updatedAt"
    | "contractNo"
    | "projectName"
    | "customerName"
    | "debtStatus"
    | "finalAmount"
    | "invoicedAmount"
    | "receivedAmount"
    | "balance"
    | "openingChargeDate"
    | undefined;
  order?: "asc" | "desc" | undefined;
};

export type ReceivablesQueryOperation =
  | { type: "ledger.list"; input: ReceivablesListInput }
  | { type: "ledger.detail"; id: string }
  | { type: "dashboard"; input: ReceivablesFiltersInput };

export const receivablesColumnIds = [
  "financeDepartmentName",
  "contractNo",
  "projectName",
  "customerName",
  "creditorUnit",
  "debtStatus",
  "finalAmount",
  "invoicedAmount",
  "receivedAmount",
  "internalReceivable",
  "externalReceivable",
  "balance",
  "writeoffAmount",
  "collectionOwner",
  "openingChargeDate",
  "dunningDate",
  "communicationMethod",
  "counterpartyFeedback",
  "latestProgress",
  "nextPlan",
  "anomaly",
  "updatedAt",
] as const;
export type ReceivablesColumnId = (typeof receivablesColumnIds)[number];
export type ReceivablesColumnPreference = {
  order: ReceivablesColumnId[];
  visible: ReceivablesColumnId[];
  frozen: ReceivablesColumnId[];
  widths: Record<ReceivablesColumnId, number>;
  moneyDecimals: 0 | 2 | 4;
};
const defaultReceivablesColumnWidths: Record<ReceivablesColumnId, number> = {
  financeDepartmentName: 128,
  contractNo: 112,
  projectName: 200,
  customerName: 160,
  creditorUnit: 88,
  debtStatus: 88,
  finalAmount: 96,
  invoicedAmount: 96,
  receivedAmount: 96,
  internalReceivable: 96,
  externalReceivable: 96,
  balance: 96,
  writeoffAmount: 96,
  collectionOwner: 96,
  openingChargeDate: 104,
  dunningDate: 104,
  communicationMethod: 88,
  counterpartyFeedback: 160,
  latestProgress: 180,
  nextPlan: 180,
  anomaly: 104,
  updatedAt: 104,
};
export const defaultReceivablesColumnPreference: ReceivablesColumnPreference = {
  order: [...receivablesColumnIds],
  visible: [...receivablesColumnIds],
  frozen: ["financeDepartmentName", "contractNo"],
  widths: defaultReceivablesColumnWidths,
  moneyDecimals: 2,
};
const receivablesColumnIdSchema = z.enum(receivablesColumnIds);
const uniqueReceivablesColumnIds = z
  .array(receivablesColumnIdSchema)
  .max(receivablesColumnIds.length)
  .refine((items) => new Set(items).size === items.length, "列 ID 不得重复");
export const receivablesColumnPreferenceSchema = z
  .object({
    order: uniqueReceivablesColumnIds.refine(
      (items) => items.length === receivablesColumnIds.length,
      "列顺序必须包含全部列",
    ),
    visible: uniqueReceivablesColumnIds.min(1),
    frozen: uniqueReceivablesColumnIds,
    widths: z
      .object(
        Object.fromEntries(
          receivablesColumnIds.map((id) => [
            id,
            z
              .number()
              .int()
              .min(80)
              .max(id === "projectName" || id === "customerName" ? 600 : 420),
          ]),
        ),
      )
      .strict(),
    moneyDecimals: z.union([z.literal(0), z.literal(2), z.literal(4)]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.visible.some((id) => !value.order.includes(id)))
      context.addIssue({
        code: "custom",
        message: "可见列必须包含在列顺序中",
        path: ["visible"],
      });
    if (value.frozen.some((id) => !value.visible.includes(id)))
      context.addIssue({
        code: "custom",
        message: "冻结列必须为可见列",
        path: ["frozen"],
      });
  })
  .transform((value) => value as ReceivablesColumnPreference);
export function normalizeStoredReceivablesColumnPreference(
  value: unknown,
): ReceivablesColumnPreference {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const columnSet = new Set<string>(receivablesColumnIds);
  const list = (key: "order" | "visible" | "frozen") =>
    Array.isArray(record[key])
      ? [
          ...new Set(
            record[key].filter(
              (id): id is ReceivablesColumnId =>
                typeof id === "string" && columnSet.has(id),
            ),
          ),
        ]
      : [];
  const order = [
    ...list("order"),
    ...receivablesColumnIds.filter((id) => !list("order").includes(id)),
  ];
  const visible = list("visible");
  const effectiveVisible = visible.length ? visible : [...receivablesColumnIds];
  const frozen = list("frozen").filter((id) => effectiveVisible.includes(id));
  const rawWidths =
    record.widths &&
    typeof record.widths === "object" &&
    !Array.isArray(record.widths)
      ? (record.widths as Record<string, unknown>)
      : {};
  const widths = Object.fromEntries(
    receivablesColumnIds.map((id) => {
      const maximum = id === "projectName" || id === "customerName" ? 600 : 420;
      const width =
        typeof rawWidths[id] === "number" && Number.isFinite(rawWidths[id])
          ? rawWidths[id]
          : defaultReceivablesColumnWidths[id];
      return [id, Math.max(80, Math.min(maximum, Math.round(width)))];
    }),
  ) as Record<ReceivablesColumnId, number>;
  const moneyDecimals =
    record.moneyDecimals === 0 || record.moneyDecimals === 4
      ? record.moneyDecimals
      : 2;
  return { order, visible: effectiveVisible, frozen, widths, moneyDecimals };
}
const receivablesColumnPreferenceKey = "receivables.columns.v1";
export const receivablesDashboardCardIds = [
  "balance",
  "amounts",
  "ledgerCount",
  "anomalies",
  "collection",
  "debtStatuses",
  "creditorUnits",
  "monthlyCashflow",
  "departmentBalances",
  "customerBalances",
  "customerTypes",
  "collectionFollowups",
] as const;
export type ReceivablesDashboardCardPreference = {
  id: (typeof receivablesDashboardCardIds)[number];
  w: number;
  h: number;
  title?: string | undefined;
};
export const defaultReceivablesDashboardPreference: ReceivablesDashboardCardPreference[] =
  [
    { id: "balance", w: 8, h: 4 },
    { id: "anomalies", w: 4, h: 4 },
    { id: "amounts", w: 5, h: 3 },
    { id: "ledgerCount", w: 3, h: 3 },
    { id: "collection", w: 4, h: 3 },
    { id: "debtStatuses", w: 6, h: 4 },
    { id: "creditorUnits", w: 6, h: 4 },
  ];
export const receivablesDashboardPreferenceSchema = z
  .array(
    z
      .object({
        id: z.enum(receivablesDashboardCardIds),
        w: z.number().int().min(3).max(12),
        h: z.number().int().min(2).max(8),
        title: z.string().trim().min(1).max(40).optional(),
      })
      .strict(),
  )
  .max(receivablesDashboardCardIds.length)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    "看板卡片不得重复",
  );
export function normalizeStoredReceivablesDashboardPreference(
  value: unknown,
): ReceivablesDashboardCardPreference[] {
  if (!Array.isArray(value))
    return defaultReceivablesDashboardPreference.map((item) => ({ ...item }));
  const validIds = new Set<string>(receivablesDashboardCardIds);
  const seen = new Set<string>();
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      !validIds.has(item.id) ||
      seen.has(item.id)
    )
      return [];
    seen.add(item.id);
    const rawWidth =
      typeof item.w === "number" && Number.isFinite(item.w) ? item.w : 4;
    const rawHeight =
      typeof item.h === "number" && Number.isFinite(item.h) ? item.h : 3;
    const title =
      typeof item.title === "string" ? item.title.trim().slice(0, 40) : "";
    return [
      {
        id: item.id as ReceivablesDashboardCardPreference["id"],
        w: Math.max(3, Math.min(12, Math.round(rawWidth))),
        h: Math.max(2, Math.min(8, Math.round(rawHeight))),
        ...(title ? { title } : {}),
      },
    ];
  });
}
const receivablesDashboardPreferenceKey = "receivables.dashboard.v1";
export const receivablesReferenceCategories = [
  "project_status",
  "final_method",
  "debt_status",
  "client_attr",
  "unit",
  "work_nature",
  "sector",
  "comm_method",
  "feedback",
  "progress_note",
  "next_plan",
  "attach_category",
] as const;

export type NormalizedReceivablesFilters = {
  financeDepartmentId: string | null;
  status: "active" | "voided" | "all";
  settlement: "unsettled" | "settled" | "all";
  debtStatus: string | null;
  creditorUnit: string | null;
  anomaly:
    | "over_received"
    | "writeoff_adjustment_required"
    | "final_amount_missing"
    | null;
  search: string | null;
  categoryFilters: Record<ReceivablesExportCategoryId, string[]>;
};

type QueryScope = NormalizedReceivablesFilters & {
  readDepartmentIds: string[] | null;
  capabilityReadDepartmentIds: string[];
  capabilityWriteDepartmentIds: string[];
  cutoffAt: Date | null;
};
export type ReceivablesQueryScope = QueryScope;
export type ReceivablesExportScopeSnapshot = {
  role: Exclude<ReceivablesAccess["role"], null>;
  all: boolean;
  readDepartmentIds: string[];
  cutoffAt: string;
  idempotencyKey?: string;
};
type QueryTx = Prisma.TransactionClient;
type Facet = { value: string | null; count: number };
type RawFacet = { value: string | null; count: number };
type RawAmountFacet = RawFacet & { amount: Prisma.Decimal };
type RawMonthlyCashflow = {
  month: string;
  invoiced_amount: Prisma.Decimal;
  received_amount: Prisma.Decimal;
};
type RawCollectionFollowup = {
  id: string;
  contract_no: string;
  project_name: string | null;
  finance_department_name: string;
  balance: Prisma.Decimal | null;
  debt_status: string | null;
  dunning_date: Date | null;
  collection_owner: string | null;
};
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
  dunning_date: Date | null;
  comm_method: string | null;
  feedback: string | null;
  latest_progress: string | null;
  next_plan: string | null;
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
  anomaly:
    | "over_received"
    | "writeoff_adjustment_required"
    | "final_amount_missing"
    | null;
};

const notFound = () =>
  Object.assign(new Error("应收账款台账不存在"), {
    statusCode: 404,
    code: "RECEIVABLES_LEDGER_NOT_FOUND",
  });
const forbiddenDepartment = () =>
  Object.assign(new Error("无权读取该财务归属部门"), {
    statusCode: 403,
    code: "RECEIVABLES_FORBIDDEN",
  });
const money = (value: Prisma.Decimal | string | null) =>
  value === null ? null : new Prisma.Decimal(value).toFixed(4);
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

function normalizeCategoryFilters(
  input: ReceivablesExportCategoryFilters = {},
) {
  return Object.fromEntries(
    receivablesExportCategoryIds.map((id) => [
      id,
      [
        ...new Set(
          (input[id] ?? []).map((value) => value.trim()).filter(Boolean),
        ),
      ].sort(),
    ]),
  ) as Record<ReceivablesExportCategoryId, string[]>;
}

export function normalizeReceivablesFilters(
  input: ReceivablesFiltersInput,
  categoryFilters: ReceivablesExportCategoryFilters = {},
): NormalizedReceivablesFilters {
  return {
    financeDepartmentId: input.financeDepartmentId ?? null,
    status: input.status ?? "active",
    settlement: input.settlement ?? "unsettled",
    debtStatus: text(input.debtStatus),
    creditorUnit: text(input.creditorUnit),
    anomaly: input.anomaly ?? null,
    search: text(input.search),
    categoryFilters: normalizeCategoryFilters(categoryFilters),
  };
}

async function resolveQueryScope(
  tx: QueryTx,
  access: ReceivablesAccess,
  input: ReceivablesFiltersInput,
): Promise<QueryScope> {
  const filters = normalizeReceivablesFilters(input);
  const capabilityReadDepartmentIds = [...access.readDepartmentIds].sort();
  const capabilityWriteDepartmentIds = [...access.writeDepartmentIds].sort();
  const readDepartmentIds =
    access.canManageAll || access.canViewAll
      ? null
      : capabilityReadDepartmentIds;
  if (
    filters.financeDepartmentId &&
    readDepartmentIds !== null &&
    !readDepartmentIds.includes(filters.financeDepartmentId)
  )
    throw forbiddenDepartment();
  return {
    ...filters,
    readDepartmentIds,
    capabilityReadDepartmentIds,
    capabilityWriteDepartmentIds,
    cutoffAt: null,
  };
}

function queryWhere(scope: QueryScope): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  if (scope.readDepartmentIds !== null) {
    clauses.push(
      scope.readDepartmentIds.length
        ? Prisma.sql`q.finance_department_id IN (${Prisma.join(scope.readDepartmentIds.map((id) => Prisma.sql`${id}::uuid`))})`
        : Prisma.sql`FALSE`,
    );
  }
  if (scope.cutoffAt)
    clauses.push(
      Prisma.sql`q.created_at <= ${scope.cutoffAt.toISOString()}::timestamp`,
    );
  if (scope.financeDepartmentId)
    clauses.push(
      Prisma.sql`q.finance_department_id = ${scope.financeDepartmentId}::uuid`,
    );
  if (scope.status !== "all")
    clauses.push(
      Prisma.sql`q.status = ${scope.status}::"ReceivableRecordStatus"`,
    );
  if (scope.settlement === "unsettled")
    clauses.push(Prisma.sql`(q.balance IS NULL OR q.balance <> 0)`);
  if (scope.settlement === "settled") clauses.push(Prisma.sql`q.balance = 0`);
  if (scope.debtStatus)
    clauses.push(Prisma.sql`q.debt_status = ${scope.debtStatus}`);
  if (scope.creditorUnit)
    clauses.push(Prisma.sql`q.creditor_unit = ${scope.creditorUnit}`);
  if (scope.anomaly) clauses.push(Prisma.sql`q.anomaly = ${scope.anomaly}`);
  if (scope.search) {
    const search = `%${scope.search}%`;
    clauses.push(
      Prisma.sql`(q.contract_no ILIKE ${search} OR q.project_name ILIKE ${search} OR q.customer_name ILIKE ${search})`,
    );
  }
  const categoryColumns: Record<ReceivablesExportCategoryId, Prisma.Sql> = {
    financeDepartment: Prisma.sql`q.finance_department_id::text`,
    creditorUnit: Prisma.sql`q.creditor_unit`,
    customerType: Prisma.sql`q.customer_type`,
    workNature: Prisma.sql`q.work_nature`,
    sector: Prisma.sql`q.sector`,
    projectStatus: Prisma.sql`q.project_status`,
    settlementMethod: Prisma.sql`q.settlement_method`,
    debtStatus: Prisma.sql`q.debt_status`,
    communicationMethod: Prisma.sql`q.comm_method`,
    counterpartyFeedback: Prisma.sql`q.feedback`,
    latestProgress: Prisma.sql`q.latest_progress`,
    nextPlan: Prisma.sql`q.next_plan`,
    status: Prisma.sql`q.status::text`,
  };
  for (const category of receivablesExportCategoryIds) {
    const values = scope.categoryFilters?.[category] ?? [];
    if (values.length)
      clauses.push(
        Prisma.sql`${categoryColumns[category]} IN (${Prisma.join(values)})`,
      );
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
      JOIN receivable_departments d ON d.id = l.finance_department_id AND d.show_receivables = true
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
  f.collection_owner, f.collection_notes, f.dunning_date, f.comm_method, f.feedback, f.latest_progress, f.next_plan,
  f.status, f.revision, f.voided_at, f.voided_by, f.void_reason,
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
    dunningDate: row.dunning_date,
    communicationMethod: row.comm_method,
    counterpartyFeedback: row.feedback,
    latestProgress: row.latest_progress,
    nextPlan: row.next_plan,
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

function amountsStatement(cte: Prisma.Sql) {
  return Prisma.sql`${cte}
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
    FROM filtered`;
}

async function amounts(tx: QueryTx, statement: Prisma.Sql) {
  const [row] = await tx.$queryRaw<RawAmounts[]>(statement);
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

function facetStatement(cte: Prisma.Sql, column: Prisma.Sql) {
  return Prisma.sql`${cte}
    SELECT ${column} AS value, COUNT(*)::int AS count FROM filtered f GROUP BY ${column} ORDER BY ${column} ASC NULLS FIRST`;
}

function amountFacetStatement(
  cte: Prisma.Sql,
  column: Prisma.Sql,
  limit?: number,
) {
  return Prisma.sql`${cte}
    SELECT ${column} AS value, COUNT(*)::int AS count,
      COALESCE(SUM(f.balance) FILTER (WHERE f.status = 'active' AND f.balance IS NOT NULL), 0::numeric) AS amount
    FROM filtered f
    GROUP BY ${column}
    ORDER BY amount DESC, ${column} ASC NULLS LAST
    ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}`;
}

function mapAmountFacets(rows: RawAmountFacet[]) {
  return rows.map((row) => ({
    value: row.value,
    count: row.count,
    amount: money(row.amount)!,
  }));
}

function statusFacetStatement(cte: Prisma.Sql) {
  return facetStatement(cte, Prisma.sql`f.status::text`);
}

function anomalyFacetStatement(cte: Prisma.Sql, activeOnly = false) {
  if (!activeOnly) return facetStatement(cte, Prisma.sql`f.anomaly`);
  return Prisma.sql`${cte}
    SELECT f.anomaly AS value, COUNT(*)::int AS count FROM filtered f WHERE f.status = 'active'
    GROUP BY f.anomaly ORDER BY f.anomaly ASC NULLS FIRST`;
}

export function buildReceivablesListStatements(
  scope: ReceivablesQueryScope,
  input: ReceivablesListInput,
) {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;
  const sort = input.sort ?? "updatedAt";
  const order = input.order ?? "desc";
  const direction = order === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const cte = filteredCte(scope);
  return {
    page,
    pageSize,
    rows: Prisma.sql`${cte} SELECT ${rowColumns} FROM filtered f ORDER BY ${sortColumns[sort]} ${direction} NULLS LAST, f.id ${direction} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    count: Prisma.sql`${cte} SELECT COUNT(*)::int AS count FROM filtered`,
    departmentFacets: Prisma.sql`${cte} SELECT f.finance_department_id AS value, f.finance_department_name AS name, COUNT(*)::int AS count FROM filtered f GROUP BY f.finance_department_id, f.finance_department_name ORDER BY f.finance_department_name, f.finance_department_id`,
    debtStatuses: facetStatement(cte, Prisma.sql`f.debt_status`),
    creditorUnits: facetStatement(cte, Prisma.sql`f.creditor_unit`),
    statuses: statusFacetStatement(cte),
    anomalies: anomalyFacetStatement(cte),
    totals: amountsStatement(cte),
  };
}

export function buildReceivablesDashboardStatements(
  scope: ReceivablesQueryScope,
) {
  const cte = filteredCte(scope);
  return {
    totals: amountsStatement(cte),
    statuses: statusFacetStatement(cte),
    anomalies: anomalyFacetStatement(cte, true),
    debtStatuses: amountFacetStatement(cte, Prisma.sql`f.debt_status`),
    creditorUnits: amountFacetStatement(cte, Prisma.sql`f.creditor_unit`),
    monthlyCashflow: Prisma.sql`${cte},
      months AS (
        SELECT generate_series(date_trunc('month', CURRENT_DATE) - interval '11 months', date_trunc('month', CURRENT_DATE), interval '1 month') AS month
      ), invoice_totals AS (
        SELECT date_trunc('month', i.invoice_date) AS month, SUM(i.amount) AS amount
        FROM receivable_invoices i JOIN filtered f ON f.id = i.ledger_id
        WHERE i.status = 'active' AND f.status = 'active' AND i.invoice_date >= date_trunc('month', CURRENT_DATE) - interval '11 months'
        GROUP BY date_trunc('month', i.invoice_date)
      ), receipt_totals AS (
        SELECT date_trunc('month', r.receipt_date) AS month, SUM(r.amount) AS amount
        FROM receivable_receipts r JOIN filtered f ON f.id = r.ledger_id
        WHERE r.status = 'active' AND f.status = 'active' AND r.receipt_date >= date_trunc('month', CURRENT_DATE) - interval '11 months'
        GROUP BY date_trunc('month', r.receipt_date)
      )
      SELECT to_char(m.month, 'YYYY-MM') AS month,
        COALESCE(i.amount, 0::numeric) AS invoiced_amount,
        COALESCE(r.amount, 0::numeric) AS received_amount
      FROM months m LEFT JOIN invoice_totals i ON i.month = m.month LEFT JOIN receipt_totals r ON r.month = m.month
      ORDER BY m.month`,
    departmentBalances: amountFacetStatement(
      cte,
      Prisma.sql`f.finance_department_name`,
      8,
    ),
    customerBalances: amountFacetStatement(
      cte,
      Prisma.sql`f.customer_name`,
      10,
    ),
    customerTypes: amountFacetStatement(cte, Prisma.sql`f.customer_type`),
    collectionFollowups: Prisma.sql`${cte}
      SELECT f.id, f.contract_no, f.project_name, f.finance_department_name, f.balance, f.debt_status,
        f.dunning_date, f.collection_owner
      FROM filtered f
      WHERE f.status = 'active' AND (f.balance IS NULL OR f.balance <> 0)
      ORDER BY CASE WHEN f.debt_status = '逾期' THEN 0 ELSE 1 END,
        f.dunning_date ASC NULLS FIRST, f.balance DESC NULLS LAST, f.id
      LIMIT 10`,
  };
}

async function listLedgers(
  tx: QueryTx,
  scope: QueryScope,
  input: ReceivablesListInput,
) {
  const statements = buildReceivablesListStatements(scope, input);
  const [
    rawRows,
    countRows,
    departmentFacets,
    debtStatuses,
    creditorUnits,
    statuses,
    anomalies,
    totals,
  ] = await Promise.all([
    tx.$queryRaw<RawRow[]>(statements.rows),
    tx.$queryRaw<Array<{ count: number }>>(statements.count),
    tx.$queryRaw<RawDepartmentFacet[]>(statements.departmentFacets),
    tx.$queryRaw<RawFacet[]>(statements.debtStatuses),
    tx.$queryRaw<RawFacet[]>(statements.creditorUnits),
    tx.$queryRaw<RawFacet[]>(statements.statuses),
    tx.$queryRaw<RawFacet[]>(statements.anomalies),
    amounts(tx, statements.totals),
  ]);
  return {
    rows: rawRows.map(mapRow),
    page: statements.page,
    pageSize: statements.pageSize,
    total: countRows[0]?.count ?? 0,
    facets: {
      departments: departmentFacets,
      debtStatuses,
      creditorUnits,
      statuses,
      anomalies,
    },
    totals,
  };
}

async function dashboard(tx: QueryTx, scope: QueryScope) {
  const statements = buildReceivablesDashboardStatements(scope);
  const [
    dashboardAmounts,
    statuses,
    anomalies,
    debtStatuses,
    creditorUnits,
    monthlyCashflow,
    departmentBalances,
    customerBalances,
    customerTypes,
    collectionFollowups,
  ] = await Promise.all([
    amounts(tx, statements.totals),
    tx.$queryRaw<RawFacet[]>(statements.statuses),
    tx.$queryRaw<RawFacet[]>(statements.anomalies),
    tx.$queryRaw<RawAmountFacet[]>(statements.debtStatuses),
    tx.$queryRaw<RawAmountFacet[]>(statements.creditorUnits),
    tx.$queryRaw<RawMonthlyCashflow[]>(statements.monthlyCashflow),
    tx.$queryRaw<RawAmountFacet[]>(statements.departmentBalances),
    tx.$queryRaw<RawAmountFacet[]>(statements.customerBalances),
    tx.$queryRaw<RawAmountFacet[]>(statements.customerTypes),
    tx.$queryRaw<RawCollectionFollowup[]>(statements.collectionFollowups),
  ]);
  return {
    amounts: dashboardAmounts,
    statuses,
    anomalies,
    debtStatuses: mapAmountFacets(debtStatuses),
    creditorUnits: mapAmountFacets(creditorUnits),
    monthlyCashflow: monthlyCashflow.map((row) => ({
      month: row.month,
      invoicedAmount: money(row.invoiced_amount)!,
      receivedAmount: money(row.received_amount)!,
    })),
    departmentBalances: mapAmountFacets(departmentBalances),
    customerBalances: mapAmountFacets(customerBalances),
    customerTypes: mapAmountFacets(customerTypes),
    collectionFollowups: collectionFollowups.map((row) => ({
      id: row.id,
      contractNo: row.contract_no,
      projectName: row.project_name,
      financeDepartmentName: row.finance_department_name,
      balance: money(row.balance),
      debtStatus: row.debt_status,
      dunningDate: row.dunning_date?.toISOString().slice(0, 10) ?? null,
      collectionOwner: row.collection_owner,
    })),
  };
}

async function ledgerDetail(
  tx: QueryTx,
  access: ReceivablesAccess,
  scope: QueryScope,
  id: string,
  accountId: string,
) {
  const row = await tx.receivableLedger.findFirst({
    where: {
      id,
      ...(scope.readDepartmentIds === null
        ? {}
        : { financeDepartmentId: { in: scope.readDepartmentIds } }),
    },
    select: {
      id: true,
      financeDepartmentId: true,
      contractNo: true,
      projectName: true,
      customerName: true,
      customerType: true,
      creditorUnit: true,
      workNature: true,
      sector: true,
      projectStatus: true,
      settlementMethod: true,
      contractAmount: true,
      finalAmount: true,
      writeoffAmount: true,
      openingChargeDate: true,
      debtStatus: true,
      collectionOwner: true,
      collectionNotes: true,
      dunningDate: true,
      communicationMethod: true,
      counterpartyFeedback: true,
      latestProgress: true,
      nextPlan: true,
      status: true,
      revision: true,
      voidedAt: true,
      voidedBy: true,
      voidReason: true,
      createdBy: true,
      updatedBy: true,
      createdAt: true,
      updatedAt: true,
      financeDepartment: { select: { name: true } },
      invoices: {
        orderBy: [{ invoiceDate: "asc" }, { id: "asc" }],
        select: {
          id: true,
          invoiceNo: true,
          invoiceDate: true,
          amount: true,
          note: true,
          source: true,
          status: true,
          revision: true,
          voidedAt: true,
          voidedBy: true,
          voidReason: true,
          createdBy: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      receipts: {
        orderBy: [{ receiptDate: "asc" }, { id: "asc" }],
        select: {
          id: true,
          receiptDate: true,
          referenceNo: true,
          amount: true,
          note: true,
          source: true,
          status: true,
          revision: true,
          voidedAt: true,
          voidedBy: true,
          voidReason: true,
          createdBy: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      attachments: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          category: true,
          status: true,
          revision: true,
          uploadedBy: true,
          voidedAt: true,
          voidedBy: true,
          voidReason: true,
          createdAt: true,
          updatedAt: true,
          file: {
            select: {
              id: true,
              originalName: true,
              mimeType: true,
              size: true,
              sha256: true,
            },
          },
        },
      },
      revisions: {
        orderBy: [{ revision: "asc" }, { id: "asc" }],
        select: {
          id: true,
          revision: true,
          beforeSnapshot: true,
          reason: true,
          changedBy: true,
          importBatchId: true,
          createdAt: true,
        },
      },
    },
  });
  if (!row) throw notFound();
  const canWriteLedger =
    access.canWriteLedger &&
    (access.canManageAll ||
      scope.capabilityWriteDepartmentIds.includes(row.financeDepartmentId));
  const calculated = calculateReceivableAmounts({
    finalAmount: row.finalAmount,
    writeoffAmount: row.writeoffAmount,
    invoiceAmounts: row.invoices,
    receiptAmounts: row.receipts,
  });
  const {
    financeDepartment,
    invoices,
    receipts,
    attachments,
    revisions,
    ...ledger
  } = row;
  return {
    ledger: {
      ...ledger,
      financeDepartmentName: financeDepartment.name,
      contractAmount: money(ledger.contractAmount),
      finalAmount: money(ledger.finalAmount),
      writeoffAmount: money(ledger.writeoffAmount)!,
      ...calculated,
    },
    invoices: invoices.map((invoice) => ({
      ...invoice,
      amount: money(invoice.amount)!,
    })),
    receipts: receipts.map((receipt) => ({
      ...receipt,
      amount: money(receipt.amount)!,
    })),
    attachments: attachments.map((attachment) => ({
      ...attachment,
      capabilities: {
        canDownload: attachment.status === "active" || access.canManageAll,
        canDelete: false,
        canVoid:
          ledger.status === "active" &&
          attachment.status === "active" &&
          (access.canManageAll ||
            (canWriteLedger &&
              access.role === "reporter" &&
              attachment.uploadedBy === accountId)),
      },
    })),
    revisions,
    capabilities: {
      ...access,
      canWriteLedger,
      readDepartmentIds: scope.capabilityReadDepartmentIds,
      writeDepartmentIds: scope.capabilityWriteDepartmentIds,
    },
  };
}

export async function getReceivablesReferenceData(principal: Principal) {
  return prisma.$transaction(async (tx) => {
    const access = await resolveReceivablesAccess(principal, tx);
    requireReceivables(access, "enter");
    const unrestrictedRead = access.canManageAll || access.canViewAll;
    const departmentIds = [
      ...new Set([...access.readDepartmentIds, ...access.writeDepartmentIds]),
    ];
    const [departments, options] = await Promise.all([
      tx.receivableDepartment.findMany({
        where: {
          active: true,
          ...(unrestrictedRead ? {} : { id: { in: departmentIds } }),
        },
        select: { id: true, name: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      }),
      tx.receivableDictionaryOption.findMany({
        where: {
          active: true,
          category: { in: [...receivablesReferenceCategories] },
        },
        select: { id: true, category: true, value: true },
        orderBy: [
          { category: "asc" },
          { sortOrder: "asc" },
          { value: "asc" },
          { id: "asc" },
        ],
      }),
    ]);
    return {
      departments: departments.map((department) => ({
        ...department,
        canRead:
          unrestrictedRead || access.readDepartmentIds.includes(department.id),
        canWrite:
          access.canManageAll ||
          access.writeDepartmentIds.includes(department.id),
      })),
      dictionaries: Object.fromEntries(
        receivablesReferenceCategories.map((category) => [
          category,
          options
            .filter((option) => option.category === category)
            .map(({ id, value }) => ({ id, value })),
        ]),
      ),
    };
  });
}

export async function queryReceivables(
  principal: Principal,
  operation: ReceivablesQueryOperation,
) {
  return prisma.$transaction(
    async (tx) => {
      const access = await resolveReceivablesAccess(principal, tx);
      requireReceivables(access, "read");
      const input = operation.type === "ledger.detail" ? {} : operation.input;
      const scope = await resolveQueryScope(tx, access, input);
      if (operation.type === "ledger.list")
        return listLedgers(tx, scope, operation.input);
      if (operation.type === "dashboard") return dashboard(tx, scope);
      return ledgerDetail(tx, access, scope, operation.id, principal.accountId);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function getReceivablesColumnPreference(
  principal: Principal,
): Promise<ReceivablesColumnPreference> {
  return prisma.$transaction(async (tx) => {
    requireReceivables(await resolveReceivablesAccess(principal, tx), "enter");
    const row = await tx.userPreference.findUnique({
      where: {
        accountId_key: {
          accountId: principal.accountId,
          key: receivablesColumnPreferenceKey,
        },
      },
      select: { value: true },
    });
    return row
      ? normalizeStoredReceivablesColumnPreference(row.value)
      : defaultReceivablesColumnPreference;
  });
}

export async function saveReceivablesColumnPreference(
  principal: Principal,
  value: ReceivablesColumnPreference,
): Promise<ReceivablesColumnPreference> {
  return prisma.$transaction(async (tx) => {
    requireReceivables(await resolveReceivablesAccess(principal, tx), "enter");
    await tx.userPreference.upsert({
      where: {
        accountId_key: {
          accountId: principal.accountId,
          key: receivablesColumnPreferenceKey,
        },
      },
      create: {
        accountId: principal.accountId,
        key: receivablesColumnPreferenceKey,
        value,
      },
      update: { value },
    });
    return value;
  });
}

export async function getReceivablesDashboardPreference(
  principal: Principal,
): Promise<ReceivablesDashboardCardPreference[]> {
  return prisma.$transaction(async (tx) => {
    requireReceivables(await resolveReceivablesAccess(principal, tx), "enter");
    const row = await tx.userPreference.findUnique({
      where: {
        accountId_key: {
          accountId: principal.accountId,
          key: receivablesDashboardPreferenceKey,
        },
      },
      select: { value: true },
    });
    return row
      ? normalizeStoredReceivablesDashboardPreference(row.value)
      : defaultReceivablesDashboardPreference.map((item) => ({ ...item }));
  });
}

export async function saveReceivablesDashboardPreference(
  principal: Principal,
  value: ReceivablesDashboardCardPreference[],
): Promise<ReceivablesDashboardCardPreference[]> {
  return prisma.$transaction(async (tx) => {
    requireReceivables(await resolveReceivablesAccess(principal, tx), "enter");
    await tx.userPreference.upsert({
      where: {
        accountId_key: {
          accountId: principal.accountId,
          key: receivablesDashboardPreferenceKey,
        },
      },
      create: {
        accountId: principal.accountId,
        key: receivablesDashboardPreferenceKey,
        value,
      },
      update: { value },
    });
    return value;
  });
}

export async function createReceivablesExportSnapshotInTransaction(
  tx: QueryTx,
  principal: Principal,
  input: ReceivablesFiltersInput,
  categoryFilters: ReceivablesExportCategoryFilters = {},
) {
  const access = await resolveReceivablesAccess(principal, tx);
  requireReceivables(access, "export", input.financeDepartmentId);
  const scope = {
    ...(await resolveQueryScope(tx, access, input)),
    categoryFilters: normalizeCategoryFilters(categoryFilters),
  };
  if (scope.readDepartmentIds !== null && scope.readDepartmentIds.length === 0)
    throw forbiddenDepartment();
  if (!access.role) throw forbiddenDepartment();
  const cutoffRows = await tx.$queryRaw<
    Array<{ cutoffAt: Date }>
  >`SELECT clock_timestamp() AS "cutoffAt"`;
  const cutoffAt = cutoffRows[0]?.cutoffAt;
  if (!cutoffAt) throw new Error("RECEIVABLES_EXPORT_CUTOFF_UNAVAILABLE");
  return {
    scopeSnapshot: {
      role: access.role,
      all: scope.readDepartmentIds === null,
      readDepartmentIds: scope.readDepartmentIds ?? [],
      cutoffAt: cutoffAt!.toISOString(),
    } satisfies ReceivablesExportScopeSnapshot,
    filterSnapshot: normalizeReceivablesFilters(input, categoryFilters),
  };
}

export async function createReceivablesExportSnapshot(
  principal: Principal,
  input: ReceivablesFiltersInput,
  categoryFilters: ReceivablesExportCategoryFilters = {},
) {
  return prisma.$transaction(
    (tx) =>
      createReceivablesExportSnapshotInTransaction(
        tx,
        principal,
        input,
        categoryFilters,
      ),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function resolveReceivablesExportScope(
  tx: QueryTx,
  principal: Principal,
  snapshot: ReceivablesExportScopeSnapshot,
  filters: NormalizedReceivablesFilters,
) {
  const access = await resolveReceivablesAccess(principal, tx);
  requireReceivables(
    access,
    "export",
    filters.financeDepartmentId ?? undefined,
  );
  const current = {
    ...(await resolveQueryScope(tx, access, {
      ...(filters.financeDepartmentId
        ? { financeDepartmentId: filters.financeDepartmentId }
        : {}),
      status: filters.status,
      settlement: filters.settlement,
      ...(filters.debtStatus ? { debtStatus: filters.debtStatus } : {}),
      ...(filters.creditorUnit ? { creditorUnit: filters.creditorUnit } : {}),
      ...(filters.anomaly ? { anomaly: filters.anomaly } : {}),
      ...(filters.search ? { search: filters.search } : {}),
    })),
    categoryFilters: normalizeCategoryFilters(filters.categoryFilters),
  };
  const saved = snapshot.all ? null : snapshot.readDepartmentIds;
  const readDepartmentIds =
    saved === null
      ? current.readDepartmentIds
      : current.readDepartmentIds === null
        ? saved
        : saved.filter((id) => current.readDepartmentIds!.includes(id));
  if (readDepartmentIds !== null && readDepartmentIds.length === 0)
    throw forbiddenDepartment();
  if (
    filters.financeDepartmentId &&
    readDepartmentIds !== null &&
    !readDepartmentIds.includes(filters.financeDepartmentId)
  )
    throw forbiddenDepartment();
  const cutoffAt = new Date(snapshot.cutoffAt);
  if (Number.isNaN(cutoffAt.valueOf()))
    throw Object.assign(new Error("导出范围快照无效"), {
      statusCode: 409,
      code: "RECEIVABLES_EXPORT_SNAPSHOT_INVALID",
    });
  return { ...current, readDepartmentIds, cutoffAt };
}

const categoryDictionary: Partial<Record<ReceivablesExportCategoryId, string>> =
  {
    creditorUnit: "unit",
    customerType: "client_attr",
    workNature: "work_nature",
    sector: "sector",
    projectStatus: "project_status",
    settlementMethod: "final_method",
    debtStatus: "debt_status",
    communicationMethod: "comm_method",
    counterpartyFeedback: "feedback",
    latestProgress: "progress_note",
    nextPlan: "next_plan",
  };

export async function previewReceivablesExport(
  principal: Principal,
  filters: ReceivablesFiltersInput,
  categoryFilters: ReceivablesExportCategoryFilters = {},
) {
  return prisma.$transaction(
    async (tx) => {
      const access = await resolveReceivablesAccess(principal, tx);
      requireReceivables(access, "export", filters.financeDepartmentId);
      const scope = {
        ...(await resolveQueryScope(tx, access, filters)),
        categoryFilters: normalizeCategoryFilters(categoryFilters),
      };
      const cte = filteredCte(scope);
      const [summary] = await tx.$queryRaw<
        Array<{ row_count: number; counts: Record<string, number> }>
      >(Prisma.sql`${cte}
      SELECT COUNT(*)::int AS row_count, jsonb_build_object(
        'contractNo', COUNT(f.contract_no)::int, 'financeDepartmentName', COUNT(f.finance_department_name)::int, 'projectName', COUNT(f.project_name)::int,
        'customerName', COUNT(f.customer_name)::int, 'customerType', COUNT(f.customer_type)::int, 'creditorUnit', COUNT(f.creditor_unit)::int,
        'workNature', COUNT(f.work_nature)::int, 'sector', COUNT(f.sector)::int, 'projectStatus', COUNT(f.project_status)::int,
        'settlementMethod', COUNT(f.settlement_method)::int, 'contractAmount', COUNT(f.contract_amount)::int, 'finalAmount', COUNT(f.final_amount)::int,
        'invoicedAmount', COUNT(f.invoiced_amount)::int, 'receivedAmount', COUNT(f.received_amount)::int, 'writeoffAmount', COUNT(f.writeoff_amount)::int,
        'internalReceivable', COUNT(f.internal_receivable)::int, 'externalReceivable', COUNT(f.external_receivable)::int, 'balance', COUNT(f.balance)::int,
        'openingChargeDate', COUNT(f.opening_charge_date)::int, 'debtStatus', COUNT(f.debt_status)::int, 'collectionOwner', COUNT(f.collection_owner)::int,
        'collectionNotes', COUNT(f.collection_notes)::int, 'dunningDate', COUNT(f.dunning_date)::int, 'communicationMethod', COUNT(f.comm_method)::int,
        'counterpartyFeedback', COUNT(f.feedback)::int, 'latestProgress', COUNT(f.latest_progress)::int, 'nextPlan', COUNT(f.next_plan)::int,
        'status', COUNT(f.status)::int, 'anomaly', COUNT(f.anomaly)::int, 'updatedAt', COUNT(f.updated_at)::int
      ) AS counts FROM filtered f`);
      const previewRows = await tx.$queryRaw<
        Array<{
          id: string;
          contract_no: string;
          project_name: string | null;
          customer_name: string | null;
          finance_department_name: string;
        }>
      >(Prisma.sql`${cte}
      SELECT f.id, f.contract_no, f.project_name, f.customer_name, f.finance_department_name
      FROM filtered f
      ORDER BY f.updated_at DESC, f.id DESC
      LIMIT 50`);
      const actual = await tx.$queryRaw<
        Array<{
          category: ReceivablesExportCategoryId;
          value: string;
          label: string;
        }>
      >(Prisma.sql`${cte}
      SELECT 'financeDepartment' AS category, f.finance_department_id::text AS value, f.finance_department_name AS label FROM filtered f
      UNION SELECT 'creditorUnit', f.creditor_unit, f.creditor_unit FROM filtered f WHERE f.creditor_unit IS NOT NULL
      UNION SELECT 'customerType', f.customer_type, f.customer_type FROM filtered f WHERE f.customer_type IS NOT NULL
      UNION SELECT 'workNature', f.work_nature, f.work_nature FROM filtered f WHERE f.work_nature IS NOT NULL
      UNION SELECT 'sector', f.sector, f.sector FROM filtered f WHERE f.sector IS NOT NULL
      UNION SELECT 'projectStatus', f.project_status, f.project_status FROM filtered f WHERE f.project_status IS NOT NULL
      UNION SELECT 'settlementMethod', f.settlement_method, f.settlement_method FROM filtered f WHERE f.settlement_method IS NOT NULL
      UNION SELECT 'debtStatus', f.debt_status, f.debt_status FROM filtered f WHERE f.debt_status IS NOT NULL
      UNION SELECT 'communicationMethod', f.comm_method, f.comm_method FROM filtered f WHERE f.comm_method IS NOT NULL
      UNION SELECT 'counterpartyFeedback', f.feedback, f.feedback FROM filtered f WHERE f.feedback IS NOT NULL
      UNION SELECT 'latestProgress', f.latest_progress, f.latest_progress FROM filtered f WHERE f.latest_progress IS NOT NULL
      UNION SELECT 'nextPlan', f.next_plan, f.next_plan FROM filtered f WHERE f.next_plan IS NOT NULL
      UNION SELECT 'status', f.status::text, f.status::text FROM filtered f`);
      const dictionaries = await tx.receivableDictionaryOption.findMany({
        where: {
          active: true,
          category: { in: Object.values(categoryDictionary) },
        },
        select: { category: true, value: true },
      });
      const options = [...actual];
      for (const option of dictionaries) {
        const category = Object.entries(categoryDictionary).find(
          ([, dictionary]) => dictionary === option.category,
        )?.[0] as ReceivablesExportCategoryId | undefined;
        if (
          category &&
          !options.some(
            (item) => item.category === category && item.value === option.value,
          )
        )
          options.push({ category, value: option.value, label: option.value });
      }
      return {
        rowCount: summary?.row_count ?? 0,
        previewRows: previewRows.map((row) => ({
          id: row.id,
          contractNo: row.contract_no,
          projectName: row.project_name,
          customerName: row.customer_name,
          financeDepartmentName: row.finance_department_name,
        })),
        categoryOptions: Object.fromEntries(
          receivablesExportCategoryIds.map((category) => [
            category,
            options
              .filter((item) => item.category === category)
              .sort((a, b) => a.label.localeCompare(b.label))
              .map(({ value, label }) => ({ value, label })),
          ]),
        ),
        columns: receivablesExportColumns.map(([id, label]) => ({
          id,
          label,
          nonEmptyCount: Number(summary?.counts?.[id] ?? 0),
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function authorizeReceivablesExportSnapshotInTransaction(
  tx: QueryTx,
  principal: Principal,
  snapshot: ReceivablesExportScopeSnapshot,
  filters: NormalizedReceivablesFilters,
) {
  return resolveReceivablesExportScope(tx, principal, snapshot, filters);
}

export async function authorizeReceivablesExportSnapshot(
  principal: Principal,
  snapshot: ReceivablesExportScopeSnapshot,
  filters: NormalizedReceivablesFilters,
) {
  return prisma.$transaction(
    async (tx) => {
      await resolveReceivablesExportScope(tx, principal, snapshot, filters);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function queryReceivablesExportBatch(
  principal: Principal,
  snapshot: ReceivablesExportScopeSnapshot,
  filters: NormalizedReceivablesFilters,
  afterId: string | null,
  batchSize = 500,
) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000)
    throw new Error("RECEIVABLES_EXPORT_BATCH_SIZE_INVALID");
  return prisma.$transaction(
    async (tx) => {
      const scope = await resolveReceivablesExportScope(
        tx,
        principal,
        snapshot,
        filters,
      );
      const statement = buildReceivablesExportBatchStatement(
        scope,
        afterId,
        batchSize,
      );
      const rows = await tx.$queryRaw<RawRow[]>(statement);
      return rows.map(mapRow);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export function buildReceivablesExportBatchStatement(
  scope: ReceivablesQueryScope,
  afterId: string | null,
  batchSize = 500,
) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000)
    throw new Error("RECEIVABLES_EXPORT_BATCH_SIZE_INVALID");
  if (!scope.cutoffAt) throw new Error("RECEIVABLES_EXPORT_CUTOFF_UNAVAILABLE");
  const cte = filteredCte(scope);
  const cursor = afterId
    ? Prisma.sql`AND f.id > ${afterId}::uuid`
    : Prisma.empty;
  return Prisma.sql`${cte} SELECT ${rowColumns} FROM filtered f WHERE f.created_at <= ${scope.cutoffAt.toISOString()}::timestamp ${cursor} ORDER BY f.id ASC LIMIT ${batchSize}`;
}
