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
  attachments: Array<{ id: string; category: string; status: "active" | "voided"; revision: number; uploadedBy: string; voidReason: string | null; file: { id: string; originalName: string; mimeType: string; size: number; sha256: string } }>;
  revisions: Array<{ id: string; revision: number; reason: string; createdAt: string }>;
  capabilities: ReceivablesAccess;
};

export type ReceivablesGrant = {
  id: string;
  accountId: string;
  role: "admin" | "reporter" | "readonly";
  canCreate: boolean;
  canExport: boolean;
  canViewAll: boolean;
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

export const receivablesColumnIds = [
  "financeDepartmentName", "contractNo", "projectName", "customerName", "creditorUnit", "debtStatus", "finalAmount",
  "invoicedAmount", "receivedAmount", "internalReceivable", "externalReceivable", "balance", "writeoffAmount",
  "collectionOwner", "openingChargeDate", "anomaly", "updatedAt",
] as const;
export type ReceivablesColumnId = typeof receivablesColumnIds[number];
export type ReceivablesColumnPreference = {
  order: ReceivablesColumnId[];
  visible: ReceivablesColumnId[];
  frozen: ReceivablesColumnId[];
};
export const defaultReceivablesColumnPreference: ReceivablesColumnPreference = {
  order: [...receivablesColumnIds],
  visible: [...receivablesColumnIds],
  frozen: ["financeDepartmentName", "contractNo"],
};

const receivablesColumnIdSet = new Set<string>(receivablesColumnIds);
const uniqueColumnIds = (value: unknown): value is ReceivablesColumnId[] => Array.isArray(value)
  && value.length <= receivablesColumnIds.length
  && value.every((item) => typeof item === "string" && receivablesColumnIdSet.has(item))
  && new Set(value).size === value.length;

export function normalizeReceivablesColumnPreference(value: unknown): ReceivablesColumnPreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...defaultReceivablesColumnPreference, order: [...receivablesColumnIds], visible: [...receivablesColumnIds], frozen: [...defaultReceivablesColumnPreference.frozen] };
  const record = value as Record<string, unknown>;
  const order = record.order;
  const visible = record.visible;
  const frozen = record.frozen;
  const exactKeys = Object.keys(record).sort().join(",") === "frozen,order,visible";
  if (!exactKeys || !uniqueColumnIds(order) || order.length !== receivablesColumnIds.length || !uniqueColumnIds(visible) || visible.length === 0 || !uniqueColumnIds(frozen)) {
    return { ...defaultReceivablesColumnPreference, order: [...receivablesColumnIds], visible: [...receivablesColumnIds], frozen: [...defaultReceivablesColumnPreference.frozen] };
  }
  if (visible.some((id) => !order.includes(id)) || frozen.some((id) => !visible.includes(id))) {
    return { ...defaultReceivablesColumnPreference, order: [...receivablesColumnIds], visible: [...receivablesColumnIds], frozen: [...defaultReceivablesColumnPreference.frozen] };
  }
  return { order: [...order], visible: [...visible], frozen: [...frozen] };
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

export function receivablesPortalMode(access: Pick<ReceivablesAccess, "state" | "canEnter" | "canRecover">): "enabled" | "recover" | "hidden" {
  if (access.canEnter) return "enabled";
  return access.state !== "ready" && access.canRecover ? "recover" : "hidden";
}

export type ReceivablesRoute = "dashboard" | "ledger" | "imports" | "exports" | "grants" | "departments" | "dictionaries" | "redirect";

export function resolveReceivablesRoute(pathname: string): ReceivablesRoute {
  if (pathname === "/receivables" || pathname === "/receivables/") return "dashboard";
  if (pathname === "/receivables/ledger" || pathname === "/receivables/ledger/") return "ledger";
  if (pathname === "/receivables/imports" || pathname === "/receivables/imports/") return "imports";
  if (pathname === "/receivables/exports" || pathname === "/receivables/exports/") return "exports";
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
  ...(access.canImport ? [{ path: "/receivables/imports", label: "导入批次" }] : []),
  ...(access.canExport ? [{ path: "/receivables/exports", label: "导出任务" }] : []),
  ...(access.canManageAccess ? [{ path: "/receivables/access", label: "财务授权" }] : []),
  ...(access.canManageConfiguration ? [
    { path: "/receivables/departments", label: "财务归属部门" },
    { path: "/receivables/dictionaries", label: "业务字典" },
  ] : []),
];

export function preserveReceivablesConflictDraft<TDraft, TLatest>(draft: TDraft, latest: TLatest) {
  return { draft, latest, retryRequired: true as const };
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

export function normalizeReceivablesMoneyInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(normalized) ? normalized : null;
}

export function receivablesErrorKind(error: unknown): "conflict" | "revoked" | "other" {
  const message = error instanceof Error ? error.message : String(error);
  if (["版本已变化", "已被其他操作更新", "迁移状态已变化", "预览已失效", "台账已变化", "目标版本已变化"].some((part) => message.includes(part))) return "conflict";
  if (["无应收账款操作权限", "无权读取该财务归属部门", "权限已收缩", "当前权限不足"].some((part) => message.includes(part))) return "revoked";
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
