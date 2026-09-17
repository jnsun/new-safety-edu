export type ReceivablesAccessState = "unconfigured" | "pending_owner" | "pending_confirmation" | "ready";
export type ReceivablesAccess = {
  state: ReceivablesAccessState;
  role: "owner" | "admin" | "reporter" | "readonly" | null;
  canEnter: boolean;
  canReadLedger: boolean;
  canWriteLedger: boolean;
  canManageAll: boolean;
  canCreateLedger: boolean;
  canManageMoney: boolean;
  canManageConfiguration: boolean;
  canManageAccess: boolean;
  canImport: boolean;
  canExport: boolean;
  canMaintainCollection: boolean;
  canViewAll: boolean;
  canConfirmSetup: boolean;
  canRecover: boolean;
  readDepartmentIds: string[];
  writeDepartmentIds: string[];
};

export type ReceivablesFilters = {
  financeDepartmentId?: string;
  status?: "active" | "voided" | "all";
  settlement?: "unsettled" | "settled" | "all";
  debtStatus?: string;
  creditorUnit?: string;
  anomaly?: "over_received" | "writeoff_adjustment_required" | "final_amount_missing";
  search?: string;
};
export type ReceivablesSort = "updatedAt" | "contractNo" | "projectName" | "customerName" | "debtStatus" | "finalAmount" | "invoicedAmount" | "receivedAmount" | "balance" | "openingChargeDate";

export type ReceivablesAmounts = {
  activeLedgerCount: number;
  finalAmount: string | null;
  invoicedAmount: string;
  receivedAmount: string;
  internalReceivable: string;
  externalReceivable: string | null;
  balance: string | null;
  writeoffAmount: string;
  finalAmountMissingCount: number;
  overReceivedCount: number;
  writeoffAdjustmentRequiredCount: number;
};

export type ReceivablesFacet = { value: string | null; count: number };
export type ReceivablesDashboardResponse = {
  amounts: ReceivablesAmounts;
  statuses: ReceivablesFacet[];
  anomalies: ReceivablesFacet[];
  debtStatuses: ReceivablesFacet[];
  creditorUnits: ReceivablesFacet[];
};

export type ReceivablesLedgerRow = {
  id: string;
  financeDepartmentId: string;
  financeDepartmentName: string;
  contractNo: string;
  projectName: string | null;
  customerName: string | null;
  customerType: string | null;
  creditorUnit: string | null;
  workNature: string | null;
  sector: string | null;
  projectStatus: string | null;
  settlementMethod: string | null;
  contractAmount: string | null;
  finalAmount: string | null;
  writeoffAmount: string;
  openingChargeDate: string | null;
  debtStatus: string | null;
  collectionOwner: string | null;
  collectionNotes: string | null;
  dunningDate: string | null;
  communicationMethod: string | null;
  counterpartyFeedback: string | null;
  latestProgress: string | null;
  nextPlan: string | null;
  status: "active" | "voided";
  revision: number;
  createdAt: string;
  updatedAt: string;
  invoicedAmount: string;
  receivedAmount: string;
  internalReceivable: string;
  externalReceivable: string | null;
  balance: string | null;
  anomaly: "over_received" | "writeoff_adjustment_required" | "final_amount_missing" | null;
};

export type ReceivablesLedgerListResponse = {
  rows: ReceivablesLedgerRow[];
  page: number;
  pageSize: number;
  total: number;
  facets: {
    departments: Array<ReceivablesFacet & { name: string }>;
    debtStatuses: ReceivablesFacet[];
    creditorUnits: ReceivablesFacet[];
    statuses: ReceivablesFacet[];
    anomalies: ReceivablesFacet[];
  };
  totals: ReceivablesAmounts;
};

export type ReceivablesLedgerDetail = {
  ledger: ReceivablesLedgerRow;
  invoices: Array<{ id: string; invoiceDate: string; invoiceNo: string | null; amount: string; note: string | null; source: "manual" | "opening_import"; status: "active" | "voided"; revision: number; voidReason: string | null }>;
  receipts: Array<{ id: string; receiptDate: string; referenceNo: string | null; amount: string; note: string | null; source: "manual" | "opening_import"; status: "active" | "voided"; revision: number; voidReason: string | null }>;
  attachments: Array<{ id: string; category: string; status: "active" | "voided"; revision: number; uploadedBy: string; voidReason: string | null; capabilities: { canDownload: boolean; canVoid: boolean }; file: { id: string; originalName: string; mimeType: string; size: number; sha256: string } }>;
  revisions: Array<{ id: string; revision: number; reason: string; createdAt: string }>;
  capabilities: ReceivablesAccess;
};

export const receivablesReferenceCategories = [
  "project_status", "final_method", "debt_status", "client_attr", "unit", "work_nature", "sector", "comm_method", "feedback", "progress_note", "next_plan", "attach_category",
] as const;
export type ReceivablesReferenceCategory = typeof receivablesReferenceCategories[number];
export type ReceivablesReferenceData = {
  departments: Array<{ id: string; name: string; canRead: boolean; canWrite: boolean }>;
  dictionaries: Record<ReceivablesReferenceCategory, Array<{ id: string; value: string }>>;
};
export type ReceivablesGrantCandidate = { accountId: string; name: string; username: string | null; hasActiveGrant: boolean };

export type ReceivablesGrant = {
  id: string;
  accountId: string;
  role: "admin" | "reporter" | "readonly";
  canCreate: boolean;
  canExport: boolean;
  canViewAll: boolean;
  canMaintainCollection: boolean;
  active: boolean;
  revision: number;
  grantedAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  departments: Array<{ financeDepartmentId: string; canRead: boolean; canWrite: boolean }>;
};

export type ReceivablesDepartment = {
  id: string;
  name: string;
  code: string | null;
  sortOrder: number;
  active: boolean;
  revision: number;
  deactivatedAt: string | null;
  deactivateReason: string | null;
};

export type ReceivablesDictionaryOption = {
  id: string;
  category: string;
  value: string;
  sortOrder: number;
  active: boolean;
  revision: number;
  deactivatedAt: string | null;
  deactivateReason: string | null;
};

export type ReceivablesImportIssue = { code: string; message: string; rowNumber?: number; field?: string; column?: string };
export type ReceivablesImportData = {
  presentFields: string[];
  financeDepartmentId: string | null;
  contractNo: string | null;
  projectName: string | null;
  customerName: string | null;
  customerType: string | null;
  creditorUnit: string | null;
  workNature: string | null;
  sector: string | null;
  projectStatus: string | null;
  settlementMethod: string | null;
  contractAmount: string | null;
  finalAmount: string | null;
  openingChargeDate: string | null;
  debtStatus: string | null;
  collectionOwner: string | null;
  collectionNotes: string | null;
  dunningDate: string | null;
  communicationMethod: string | null;
  counterpartyFeedback: string | null;
  latestProgress: string | null;
  nextPlan: string | null;
  openingInvoiceAmount: string | null;
  openingInvoiceDate: string | null;
  openingReceiptAmount: string | null;
  openingReceiptDate: string | null;
};
export type ReceivablesImportItem = {
  id: string;
  rowNumber: number;
  contractNoNormalized: string | null;
  normalizedData: ReceivablesImportData;
  errors: ReceivablesImportIssue[] | null;
  decision: "skip" | "update" | null;
  result: "skipped" | "updated" | "created" | null;
  ledgerId: string | null;
  targetRevision: number | null;
  appliedRevision: number | null;
};
export type ReceivablesImportPreview = {
  batchId: string;
  revision: number;
  checksum: string;
  rows: ReceivablesImportItem[];
  errors: ReceivablesImportIssue[];
  warnings: ReceivablesImportIssue[];
};
export type ReceivablesImportBatch = {
  id: string;
  status: "previewed" | "applied" | "failed" | "rolled_back";
  revision: number;
  rowCount: number;
  errorCount: number;
  appliedAt: string | null;
  rolledBackAt: string | null;
  rollbackReason: string | null;
  createdAt: string;
  originalFile: { id: string; originalName: string; size: number; sha256: string };
  items: ReceivablesImportItem[];
};
export type ReceivablesExportJob = {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "expired";
  scopeSnapshot: unknown;
  filterSnapshot: unknown;
  rowCount: number | null;
  size: number | null;
  sha256: string | null;
  error: string | null;
  completedAt: string | null;
  downloadedAt: string | null;
  expiresAt: string;
  createdAt: string;
};
export type ReceivablesExportList = { rows: ReceivablesExportJob[]; page: number; pageSize: number; total: number };
export const receivablesExportCategoryIds = ["financeDepartment", "creditorUnit", "customerType", "workNature", "sector", "projectStatus", "settlementMethod", "debtStatus", "communicationMethod", "counterpartyFeedback", "latestProgress", "nextPlan", "status"] as const;
export type ReceivablesExportCategoryId = typeof receivablesExportCategoryIds[number];
export type ReceivablesExportCategoryFilters = Partial<Record<ReceivablesExportCategoryId, string[]>>;
export type ReceivablesExportPreview = {
  rowCount: number;
  categoryOptions: Record<ReceivablesExportCategoryId, Array<{ value: string; label: string }>>;
  columns: Array<{ id: string; label: string; nonEmptyCount: number }>;
};

export const receivablesColumnIds = [
  "financeDepartmentName", "contractNo", "projectName", "customerName", "creditorUnit", "debtStatus", "finalAmount",
  "invoicedAmount", "receivedAmount", "internalReceivable", "externalReceivable", "balance", "writeoffAmount",
  "collectionOwner", "openingChargeDate", "dunningDate", "communicationMethod", "counterpartyFeedback", "latestProgress", "nextPlan", "anomaly", "updatedAt",
] as const;
export type ReceivablesColumnId = typeof receivablesColumnIds[number];
export type ReceivablesColumnPreference = {
  order: ReceivablesColumnId[];
  visible: ReceivablesColumnId[];
  frozen: ReceivablesColumnId[];
  widths: Record<ReceivablesColumnId, number>;
};
export const defaultReceivablesColumnWidths: Record<ReceivablesColumnId, number> = {
  financeDepartmentName: 148, contractNo: 128, projectName: 220, customerName: 180,
  creditorUnit: 124, debtStatus: 112, finalAmount: 128, invoicedAmount: 128,
  receivedAmount: 128, internalReceivable: 128, externalReceivable: 128, balance: 128,
  writeoffAmount: 128, collectionOwner: 112, openingChargeDate: 124, dunningDate: 124,
  communicationMethod: 104, counterpartyFeedback: 160, latestProgress: 180, nextPlan: 180,
  anomaly: 124, updatedAt: 138,
};
export const defaultReceivablesColumnPreference: ReceivablesColumnPreference = {
  order: [...receivablesColumnIds],
  visible: [...receivablesColumnIds],
  frozen: ["financeDepartmentName", "contractNo"],
  widths: defaultReceivablesColumnWidths,
};

const receivablesColumnIdSet = new Set<string>(receivablesColumnIds);
const uniqueColumnIds = (value: unknown): value is ReceivablesColumnId[] => Array.isArray(value)
  && value.length <= receivablesColumnIds.length
  && value.every((item) => typeof item === "string" && receivablesColumnIdSet.has(item))
  && new Set(value).size === value.length;

const defaultColumnPreference = () => ({ ...defaultReceivablesColumnPreference, order: [...receivablesColumnIds], visible: [...receivablesColumnIds], frozen: [...defaultReceivablesColumnPreference.frozen], widths: { ...defaultReceivablesColumnWidths } });
export function normalizeReceivablesColumnPreference(value: unknown): ReceivablesColumnPreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultColumnPreference();
  const record = value as Record<string, unknown>;
  const order = record.order;
  const visible = record.visible;
  const frozen = record.frozen;
  if (!uniqueColumnIds(order) || order.length !== receivablesColumnIds.length || !uniqueColumnIds(visible) || visible.length === 0 || !uniqueColumnIds(frozen)) {
    return defaultColumnPreference();
  }
  if (visible.some((id) => !order.includes(id)) || frozen.some((id) => !visible.includes(id))) {
    return defaultColumnPreference();
  }
  const rawWidths = record.widths && typeof record.widths === "object" && !Array.isArray(record.widths) ? record.widths as Record<string, unknown> : {};
  const widths = Object.fromEntries(receivablesColumnIds.map((id) => [id, Math.max(80, Math.min(id === "projectName" || id === "customerName" ? 600 : 420, typeof rawWidths[id] === "number" && Number.isFinite(rawWidths[id]) ? rawWidths[id] : defaultReceivablesColumnWidths[id]))])) as Record<ReceivablesColumnId, number>;
  return { order: [...order], visible: [...visible], frozen: [...frozen], widths };
}

export const receivablesQueryKey = (accountId: string, ...parts: readonly unknown[]) => ["receivables", accountId, ...parts] as const;

export function receivablesScopeFingerprint(access: ReceivablesAccess): string {
  return JSON.stringify({
    state: access.state,
    role: access.role,
    canEnter: access.canEnter,
    canReadLedger: access.canReadLedger,
    canWriteLedger: access.canWriteLedger,
    canManageAll: access.canManageAll,
    canCreateLedger: access.canCreateLedger,
    canManageMoney: access.canManageMoney,
    canManageConfiguration: access.canManageConfiguration,
    canManageAccess: access.canManageAccess,
    canImport: access.canImport,
    canExport: access.canExport,
    canMaintainCollection: access.canMaintainCollection,
    canViewAll: access.canViewAll,
    canConfirmSetup: access.canConfirmSetup,
    canRecover: access.canRecover,
    readDepartmentIds: [...access.readDepartmentIds].sort(),
    writeDepartmentIds: [...access.writeDepartmentIds].sort(),
  });
}

export const receivablesScopedQueryKey = (accountId: string, scopeFingerprint: string, ...parts: readonly unknown[]) => receivablesQueryKey(accountId, "scope", scopeFingerprint, ...parts);

export function usableReceivablesData<T>(query: { data: T | undefined; isFetching: boolean; isError: boolean }): T | undefined {
  return query.isFetching || query.isError ? undefined : query.data;
}

export function usableReceivablesAccess<T>(query: { data: T | undefined; isFetching: boolean; isError: boolean }): T | undefined {
  return usableReceivablesData(query);
}

export function receivablesPortalMode(access: Pick<ReceivablesAccess, "state" | "canEnter" | "canRecover"> & { canConfirmSetup?: boolean }): "enabled" | "recover" | "confirm" | "hidden" {
  if (access.canEnter) return "enabled";
  if (access.state === "pending_confirmation" && access.canConfirmSetup) return "confirm";
  return access.state !== "ready" && access.canRecover ? "recover" : "hidden";
}

export type ReceivablesRoute = "dashboard" | "ledger" | "data" | "grants" | "departments" | "dictionaries" | "redirect";

export function resolveReceivablesRoute(pathname: string): ReceivablesRoute {
  if (pathname === "/receivables" || pathname === "/receivables/") return "dashboard";
  if (pathname === "/receivables/ledger" || pathname === "/receivables/ledger/") return "ledger";
  if (["/receivables/data", "/receivables/data/", "/receivables/imports", "/receivables/imports/", "/receivables/exports", "/receivables/exports/"].includes(pathname)) return "data";
  if (pathname === "/receivables/access" || pathname === "/receivables/access/") return "grants";
  if (pathname === "/receivables/departments" || pathname === "/receivables/departments/") return "departments";
  if (pathname === "/receivables/dictionaries" || pathname === "/receivables/dictionaries/") return "dictionaries";
  return "redirect";
}

export const receivablesNavigation = (access: ReceivablesAccess) => [
  ...(access.canEnter && access.canReadLedger ? [
    { path: "/receivables", label: "应收账款看板" },
    { path: "/receivables/ledger", label: "应收账款台账" },
  ] : []),
  ...(access.canCreateLedger || access.canImport || access.canExport ? [{ path: "/receivables/data", label: "数据处理" }] : []),
  ...(access.canManageAccess ? [{ path: "/receivables/access", label: "账号与权限" }] : []),
  ...(access.canManageConfiguration ? [
    { path: "/receivables/departments", label: "财务归属部门" },
    { path: "/receivables/dictionaries", label: "业务字典" },
  ] : []),
];

export function receivablesDashboardMode(access: Pick<ReceivablesAccess, "canManageMoney" | "canMaintainCollection">) {
  if (access.canManageMoney) return { kind: "finance" as const, title: "财务异常处置台", description: "先核对金额异常，再处理开票、回款和台账数据。", actionLabel: "处理财务数据", actionPath: "/receivables/data" };
  if (access.canMaintainCollection) return { kind: "collection" as const, title: "催收工作台", description: "查看权限范围内的未结账款，持续更新催收进展和下一步计划。", actionLabel: "更新催收进展", actionPath: "/receivables/ledger" };
  return { kind: "overview" as const, title: "应收账款总览", description: "查看权限范围内的应收余额、回款情况和待核对事项。", actionLabel: "查看全部台账", actionPath: "/receivables/ledger" };
}

export function receivablesDashboardActionModel(kind: ReturnType<typeof receivablesDashboardMode>["kind"]) {
  if (kind === "collection") return { title: "催收工作", kind: "collection" as const };
  return { title: kind === "finance" ? "需要处理" : "风险关注", kind: "anomalies" as const };
}

export function receivablesLedgerInitialFilters(search: string): {
  status: NonNullable<ReceivablesFilters["status"]>;
  settlement: NonNullable<ReceivablesFilters["settlement"]>;
  anomaly: ReceivablesFilters["anomaly"] | undefined;
  debtStatus: string | undefined;
  creditorUnit: string | undefined;
} {
  const query = new URLSearchParams(search);
  const status = query.get("status");
  const settlement = query.get("settlement");
  const anomaly = query.get("anomaly");
  return {
    status: status === "active" || status === "voided" || status === "all" ? status : "active" as const,
    settlement: settlement === "unsettled" || settlement === "settled" || settlement === "all" ? settlement : "unsettled" as const,
    anomaly: anomaly === "over_received" || anomaly === "writeoff_adjustment_required" || anomaly === "final_amount_missing" ? anomaly : undefined,
    debtStatus: query.get("debtStatus") || undefined,
    creditorUnit: query.get("creditorUnit") || undefined,
  };
}

export function preserveReceivablesConflictDraft<TDraft, TLatest>(draft: TDraft, latest: TLatest) {
  return { draft, latest, retryRequired: true as const };
}

export function normalizeReceivablesGrantScopes(role: ReceivablesGrant["role"], scopes: Array<{ departmentId: string; canRead: boolean; canWrite: boolean }>) {
  return scopes.map((scope) => ({
    departmentId: scope.departmentId,
    canRead: scope.canRead || scope.canWrite,
    canWrite: role === "readonly" ? false : scope.canWrite,
  }));
}

export function normalizeReceivablesGrantDraft(role: ReceivablesGrant["role"], draft: { canCreate: boolean; canExport: boolean; canViewAll: boolean; canMaintainCollection?: boolean; departments: Array<{ departmentId: string; canRead: boolean; canWrite: boolean }> }) {
  if (role === "admin") return { canCreate: false, canExport: false, canViewAll: false, canMaintainCollection: false, departments: [] };
  return {
    canCreate: role === "reporter" && draft.canCreate,
    canExport: draft.canExport,
    canViewAll: draft.canViewAll,
    canMaintainCollection: role === "reporter" && !!draft.canMaintainCollection,
    departments: normalizeReceivablesGrantScopes(role, draft.departments),
  };
}

type ImportPreviewGuard = { errors: readonly unknown[]; rows: readonly { rowNumber: number; ledgerId: string | null }[] };
type ImportDecisions = Record<number, "skip" | "update">;
const unresolvedDuplicate = (preview: ImportPreviewGuard, decisions: ImportDecisions) => preview.rows.some((row) => row.ledgerId && !decisions[row.rowNumber]);

export function receivablesImportStage(preview: ImportPreviewGuard | undefined, decisions: ImportDecisions, confirmed: boolean): "upload" | "blocking_errors" | "duplicate_decisions" | "impact_preview" | "confirm_apply" {
  if (!preview) return "upload";
  if (preview.errors.length) return "blocking_errors";
  if (unresolvedDuplicate(preview, decisions)) return "duplicate_decisions";
  return confirmed ? "confirm_apply" : "impact_preview";
}

export const canApplyReceivablesImport = (preview: ImportPreviewGuard, decisions: ImportDecisions, confirmed: boolean) => receivablesImportStage(preview, decisions, confirmed) === "confirm_apply";

export function updateReceivablesImportDecision(state: { decisions: ImportDecisions; confirmStage: boolean; confirmed: boolean }, rowNumber: number, decision: "skip" | "update") {
  return { decisions: { ...state.decisions, [rowNumber]: decision }, confirmStage: false, confirmed: false };
}

export const receivablesExportDownloadRequest = (jobId: string, token: string) => ({
  path: `/api/receivables/exports/${encodeURIComponent(jobId)}/download`,
  init: { method: "POST", body: JSON.stringify({ token }) } satisfies RequestInit,
});

export const receivablesMutationInvalidationKeys = (accountId: string, scopeFingerprint: string, ledgerId?: string) => [
  receivablesQueryKey(accountId, "access"),
  receivablesScopedQueryKey(accountId, scopeFingerprint, "dashboard"),
  receivablesScopedQueryKey(accountId, scopeFingerprint, "ledgers"),
  ...(ledgerId ? [receivablesScopedQueryKey(accountId, scopeFingerprint, "ledger", ledgerId)] : []),
  receivablesScopedQueryKey(accountId, scopeFingerprint, "admin"),
  receivablesScopedQueryKey(accountId, scopeFingerprint, "imports"),
  receivablesScopedQueryKey(accountId, scopeFingerprint, "exports"),
];

export const receivablesScopeQueryPrefix = (accountId: string, scopeFingerprint: string) => receivablesScopedQueryKey(accountId, scopeFingerprint);

export function normalizeReceivablesMoneyInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(normalized) ? normalized : null;
}

export function normalizeReceivablesPositiveMoneyInput(value: unknown): string | null {
  const normalized = normalizeReceivablesMoneyInput(value);
  return normalized && !/^0(?:\.0+)?$/.test(normalized) ? normalized : null;
}

const receivablesRevisionConflictCodes = new Set(["REVISION_CONFLICT", "RECEIVABLES_REVISION_CONFLICT"]);
const receivablesStaleCodes = new Set(["IMPORT_PREVIEW_STALE", "IMPORT_TARGET_CHANGED", "IMPORT_FILE_CHANGED", "IMPORT_ROLLBACK_CONFLICT", "RECEIVABLES_MIGRATION_STATE_CHANGED"]);

export function receivablesErrorKind(error: unknown): "revision_conflict" | "stale" | "revoked" | "other" {
  const status = typeof error === "object" && error !== null && "status" in error ? (error as { status?: unknown }).status : undefined;
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string" && receivablesRevisionConflictCodes.has(code)) return "revision_conflict";
  if (typeof code === "string" && receivablesStaleCodes.has(code)) return "stale";
  if (status === 403 || code === "RECEIVABLES_FORBIDDEN") return "revoked";
  return "other";
}

export function receivablesDownloadFilename(contentDisposition: string | null, fallback: string): string {
  const encoded = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quoted = contentDisposition?.match(/filename="?([^";]+)"?/i)?.[1];
  let candidate = encoded ?? quoted ?? fallback;
  if (encoded) {
    try { candidate = decodeURIComponent(encoded); } catch { candidate = fallback; }
  }
  candidate = candidate.split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "").trim() ?? "";
  return candidate || fallback;
}

export function formatReceivablesMoney(value: string | null): string {
  if (value === null) return "—";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, sign, integer, fraction = ""] = match;
  return `¥${sign}${integer!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
}

export function formatReceivablesDate(value: string | null): string {
  if (!value) return "—";
  const match = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(value);
  return match?.[1] ?? "—";
}
