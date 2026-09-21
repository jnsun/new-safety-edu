export type ReceivablesAccessState =
  | "unconfigured"
  | "pending_owner"
  | "pending_confirmation"
  | "ready";
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
  anomaly?:
    | "over_received"
    | "writeoff_adjustment_required"
    | "final_amount_missing";
  search?: string;
};
export type ReceivablesSort =
  | "updatedAt"
  | "contractNo"
  | "projectName"
  | "customerName"
  | "debtStatus"
  | "finalAmount"
  | "invoicedAmount"
  | "receivedAmount"
  | "balance"
  | "openingChargeDate";

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
export type ReceivablesAmountFacet = ReceivablesFacet & { amount: string };
export type ReceivablesMonthlyCashflow = {
  month: string;
  invoicedAmount: string;
  receivedAmount: string;
};
export type ReceivablesCollectionFollowup = {
  id: string;
  contractNo: string;
  projectName: string | null;
  financeDepartmentName: string;
  balance: string | null;
  debtStatus: string | null;
  dunningDate: string | null;
  collectionOwner: string | null;
};
export type ReceivablesDashboardResponse = {
  amounts: ReceivablesAmounts;
  statuses: ReceivablesFacet[];
  anomalies: ReceivablesFacet[];
  debtStatuses: ReceivablesAmountFacet[];
  creditorUnits: ReceivablesAmountFacet[];
  monthlyCashflow: ReceivablesMonthlyCashflow[];
  departmentBalances: ReceivablesAmountFacet[];
  customerBalances: ReceivablesAmountFacet[];
  customerTypes: ReceivablesAmountFacet[];
  collectionFollowups: ReceivablesCollectionFollowup[];
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
  anomaly:
    | "over_received"
    | "writeoff_adjustment_required"
    | "final_amount_missing"
    | null;
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
  invoices: Array<{
    id: string;
    invoiceDate: string;
    invoiceNo: string | null;
    amount: string;
    note: string | null;
    source: "manual" | "opening_import";
    status: "active" | "voided";
    revision: number;
    voidReason: string | null;
  }>;
  receipts: Array<{
    id: string;
    receiptDate: string;
    referenceNo: string | null;
    amount: string;
    note: string | null;
    source: "manual" | "opening_import";
    status: "active" | "voided";
    revision: number;
    voidReason: string | null;
  }>;
  attachments: Array<{
    id: string;
    category: string;
    status: "active" | "voided";
    revision: number;
    uploadedBy: string;
    voidReason: string | null;
    capabilities: { canDownload: boolean; canVoid: boolean; canDelete: boolean };
    file: {
      id: string;
      originalName: string;
      mimeType: string;
      size: number;
      sha256: string;
    };
  }>;
  revisions: Array<{
    id: string;
    revision: number;
    reason: string;
    createdAt: string;
  }>;
  capabilities: ReceivablesAccess;
};

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
export type ReceivablesReferenceCategory =
  (typeof receivablesReferenceCategories)[number];
export const receivablesReferenceCategoryLabels: Record<
  ReceivablesReferenceCategory,
  string
> = {
  project_status: "项目状态",
  final_method: "决算方式",
  debt_status: "债权状态",
  client_attr: "客户属性",
  unit: "单位",
  work_nature: "工作性质",
  sector: "八大板块",
  comm_method: "沟通方式",
  feedback: "对方反馈",
  progress_note: "最新进展",
  next_plan: "下一步计划",
  attach_category: "附件分类",
};
export type ReceivablesReferenceData = {
  departments: Array<{
    id: string;
    name: string;
    canRead: boolean;
    canWrite: boolean;
  }>;
  dictionaries: Record<
    ReceivablesReferenceCategory,
    Array<{ id: string; value: string }>
  >;
};
export type ReceivablesGrantCandidate = {
  personId: string;
  accountId: string | null;
  accountStatus: "pending" | "active" | null;
  name: string;
  username: string | null;
  hasActiveGrant: boolean;
};

export type ReceivablesGrant = {
  id: string;
  personId: string;
  accountId: string | null;
  role: "admin" | "reporter" | "readonly";
  canCreate: boolean;
  canEditBaseInfo: boolean;
  canExport: boolean;
  canViewAll: boolean;
  canMaintainCollection: boolean;
  canUploadAttachments: boolean;
  editableFields: string[];
  active: boolean;
  revision: number;
  grantedAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  departments: Array<{
    financeDepartmentId: string;
    canRead: boolean;
    canWrite: boolean;
  }>;
  person: {
    name: string;
    account: { id: string; username: string | null; status: string } | null;
    organizations: Array<{ organization: { name: string } }>;
  };
};

const creditorUnitLabels: Record<string, string> = {
  山西省地球物理化学勘查院有限公司: "物化院",
  山西省地质测绘院有限公司: "测绘院",
  山西省第六地质工程勘察院有限公司: "六勘院",
  山西禹地基础工程有限公司: "禹地公司",
};
export const receivablesCreditorUnitLabel = (
  value: string | null | undefined,
) => (value ? (creditorUnitLabels[value.trim()] ?? value) : "—");

export type ReceivablesDepartment = {
  id: string;
  name: string;
  code: string | null;
  sortOrder: number;
  showReceivables: boolean;
  accountCount: number;
  receivableCount: number;
  active: boolean;
  revision: number;
  deactivatedAt: string | null;
  deactivateReason: string | null;
};

export function moveReceivablesDepartment(rows: ReceivablesDepartment[], sourceId: string, targetId: string): ReceivablesDepartment[] {
  const sourceIndex = rows.findIndex(({ id }) => id === sourceId);
  const targetIndex = rows.findIndex(({ id }) => id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return rows;
  const reordered = [...rows];
  const [source] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, source!);
  return reordered.map((row, sortOrder) => ({ ...row, sortOrder }));
}

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

export type ReceivablesImportIssue = {
  code: string;
  message: string;
  rowNumber?: number;
  field?: string;
  column?: string;
};
export function groupReceivablesImportIssues(issues: ReceivablesImportIssue[]) {
  const groups = new Map<
    string,
    {
      code: string;
      message: string;
      count: number;
      rows: number[];
      columns: string[];
    }
  >();
  for (const issue of issues) {
    const key = `${issue.code}\u0000${issue.message}`;
    const group = groups.get(key) ?? {
      code: issue.code,
      message: issue.message,
      count: 0,
      rows: [],
      columns: [],
    };
    group.count += 1;
    if (issue.rowNumber && !group.rows.includes(issue.rowNumber))
      group.rows.push(issue.rowNumber);
    if (issue.column && !group.columns.includes(issue.column))
      group.columns.push(issue.column);
    groups.set(key, group);
  }
  return [...groups.values()];
}
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
  originalFile: {
    id: string;
    originalName: string;
    size: number;
    sha256: string;
  };
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
export type ReceivablesExportList = {
  rows: ReceivablesExportJob[];
  page: number;
  pageSize: number;
  total: number;
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
export type ReceivablesExportPreview = {
  rowCount: number;
  previewRows: Array<{
    id: string;
    contractNo: string;
    projectName: string | null;
    customerName: string | null;
    financeDepartmentName: string;
  }>;
  categoryOptions: Record<
    ReceivablesExportCategoryId,
    Array<{ value: string; label: string }>
  >;
  columns: Array<{ id: string; label: string; nonEmptyCount: number }>;
};

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
export type ReceivablesDashboardCardId =
  (typeof receivablesDashboardCardIds)[number];
export type ReceivablesDashboardCardPreference = {
  id: ReceivablesDashboardCardId;
  w: number;
  h: number;
  title?: string;
};
export const defaultReceivablesDashboardPreference: ReceivablesDashboardCardPreference[] =
  [
    { id: "balance", w: 12, h: 3 },
    { id: "anomalies", w: 8, h: 6 },
    { id: "collection", w: 4, h: 6 },
    { id: "monthlyCashflow", w: 8, h: 5 },
    { id: "departmentBalances", w: 4, h: 6 },
    { id: "debtStatuses", w: 6, h: 4 },
    { id: "creditorUnits", w: 6, h: 4 },
  ];

export function normalizeReceivablesDashboardPreference(
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
    const title =
      typeof item.title === "string" ? item.title.trim().slice(0, 40) : "";
    const rawWidth =
      typeof item.w === "number" && Number.isFinite(item.w) ? item.w : 4;
    const rawHeight =
      typeof item.h === "number" && Number.isFinite(item.h) ? item.h : 3;
    return [
      {
        id: item.id as ReceivablesDashboardCardId,
        w: Math.max(3, Math.min(12, Math.round(rawWidth))),
        h: Math.max(2, Math.min(8, Math.round(rawHeight))),
        ...(title ? { title } : {}),
      },
    ];
  });
}
export type ReceivablesColumnId = (typeof receivablesColumnIds)[number];
export type ReceivablesColumnPreference = {
  order: ReceivablesColumnId[];
  visible: ReceivablesColumnId[];
  frozen: ReceivablesColumnId[];
  widths: Record<ReceivablesColumnId, number>;
  moneyDecimals: 0 | 2 | 4;
};
export const defaultReceivablesColumnWidths: Record<
  ReceivablesColumnId,
  number
> = {
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
export type ReceivablesImportField = keyof Omit<
  ReceivablesImportData,
  "presentFields"
>;
export type ReceivablesImportInspection = {
  unknownColumns: Array<{ name: string; samples: string[] }>;
  recognizedFields: ReceivablesImportField[];
};

export function groupReceivablesDictionaryOptions(
  rows: ReceivablesDictionaryOption[],
) {
  const byCategory = new Map(
    rows.map((row) => [row.category, [] as ReceivablesDictionaryOption[]]),
  );
  for (const row of rows) byCategory.get(row.category)!.push(row);
  return receivablesReferenceCategories.map((category) => {
    const sorted = [...(byCategory.get(category) ?? [])].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.value.localeCompare(right.value, "zh-CN"),
    );
    return {
      category,
      label: receivablesReferenceCategoryLabels[category],
      total: sorted.length,
      active: sorted.filter((item) => item.active).length,
      options: sorted,
    };
  });
}

export function filterReceivablesDepartments(
  rows: ReceivablesDepartment[],
  search: string,
  status: "active" | "inactive" | "all",
) {
  const keyword = search.trim().toLocaleLowerCase("zh-CN");
  return rows
    .filter((row) => {
      if (status !== "all" && row.active !== (status === "active"))
        return false;
      return (
        !keyword ||
        row.name.toLocaleLowerCase("zh-CN").includes(keyword) ||
        row.code?.toLocaleLowerCase("zh-CN").includes(keyword)
      );
    })
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.name.localeCompare(right.name, "zh-CN"),
    );
}

export function updateReceivablesSelectedScopes(
  role: ReceivablesGrant["role"],
  departmentIds: string[],
  scopes: Array<{ departmentId: string; canRead: boolean; canWrite: boolean }>,
) {
  if (role === "admin") return [];
  const current = new Map(scopes.map((scope) => [scope.departmentId, scope]));
  return departmentIds.map((departmentId) => {
    const scope = current.get(departmentId);
    return {
      departmentId,
      canRead: true,
      canWrite: role === "readonly" ? false : !!scope?.canWrite,
    };
  });
}
export const defaultReceivablesColumnPreference: ReceivablesColumnPreference = {
  order: [...receivablesColumnIds],
  visible: [...receivablesColumnIds],
  frozen: ["financeDepartmentName", "contractNo"],
  widths: defaultReceivablesColumnWidths,
  moneyDecimals: 2,
};

const receivablesColumnIdSet = new Set<string>(receivablesColumnIds);
const uniqueColumnIds = (value: unknown): value is ReceivablesColumnId[] =>
  Array.isArray(value) &&
  value.length <= receivablesColumnIds.length &&
  value.every(
    (item) => typeof item === "string" && receivablesColumnIdSet.has(item),
  ) &&
  new Set(value).size === value.length;

const defaultColumnPreference = () => ({
  ...defaultReceivablesColumnPreference,
  order: [...receivablesColumnIds],
  visible: [...receivablesColumnIds],
  frozen: [...defaultReceivablesColumnPreference.frozen],
  widths: { ...defaultReceivablesColumnWidths },
});
export function normalizeReceivablesColumnPreference(
  value: unknown,
): ReceivablesColumnPreference {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return defaultColumnPreference();
  const record = value as Record<string, unknown>;
  const order = record.order;
  const visible = record.visible;
  const frozen = record.frozen;
  if (
    !uniqueColumnIds(order) ||
    order.length !== receivablesColumnIds.length ||
    !uniqueColumnIds(visible) ||
    visible.length === 0 ||
    !uniqueColumnIds(frozen)
  ) {
    return defaultColumnPreference();
  }
  if (
    visible.some((id) => !order.includes(id)) ||
    frozen.some((id) => !visible.includes(id))
  ) {
    return defaultColumnPreference();
  }
  const rawWidths =
    record.widths &&
    typeof record.widths === "object" &&
    !Array.isArray(record.widths)
      ? (record.widths as Record<string, unknown>)
      : {};
  const widths = Object.fromEntries(
    receivablesColumnIds.map((id) => [
      id,
      Math.max(
        80,
        Math.min(
          id === "projectName" || id === "customerName" ? 600 : 420,
          typeof rawWidths[id] === "number" && Number.isFinite(rawWidths[id])
            ? rawWidths[id]
            : defaultReceivablesColumnWidths[id],
        ),
      ),
    ]),
  ) as Record<ReceivablesColumnId, number>;
  const moneyDecimals =
    record.moneyDecimals === 0 || record.moneyDecimals === 4
      ? record.moneyDecimals
      : 2;
  return {
    order: [...order],
    visible: [...visible],
    frozen: [...frozen],
    widths,
    moneyDecimals,
  };
}

export const receivablesQueryKey = (
  accountId: string,
  ...parts: readonly unknown[]
) => ["receivables", accountId, ...parts] as const;

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

export const receivablesScopedQueryKey = (
  accountId: string,
  scopeFingerprint: string,
  ...parts: readonly unknown[]
) => receivablesQueryKey(accountId, "scope", scopeFingerprint, ...parts);

export function usableReceivablesData<T>(query: {
  data: T | undefined;
  isFetching: boolean;
  isError: boolean;
}): T | undefined {
  return query.isFetching || query.isError ? undefined : query.data;
}

export function usableReceivablesAccess<T>(query: {
  data: T | undefined;
  isFetching: boolean;
  isError: boolean;
}): T | undefined {
  return usableReceivablesData(query);
}

export function receivablesPortalMode(
  access: Pick<ReceivablesAccess, "state" | "canEnter" | "canRecover"> & {
    canConfirmSetup?: boolean;
  },
): "enabled" | "recover" | "confirm" | "hidden" {
  if (access.canEnter) return "enabled";
  if (access.state === "pending_confirmation" && access.canConfirmSetup)
    return "confirm";
  return access.state !== "ready" && access.canRecover ? "recover" : "hidden";
}

export type ReceivablesRoute =
  | "dashboard"
  | "ledger"
  | "data"
  | "grants"
  | "departments"
  | "dictionaries"
  | "redirect";

export function resolveReceivablesRoute(pathname: string): ReceivablesRoute {
  if (pathname === "/receivables" || pathname === "/receivables/")
    return "dashboard";
  if (pathname === "/receivables/ledger" || pathname === "/receivables/ledger/")
    return "ledger";
  if (
    [
      "/receivables/data",
      "/receivables/data/",
      "/receivables/imports",
      "/receivables/imports/",
      "/receivables/exports",
      "/receivables/exports/",
    ].includes(pathname)
  )
    return "data";
  if (pathname === "/receivables/access" || pathname === "/receivables/access/")
    return "grants";
  if (
    pathname === "/receivables/departments" ||
    pathname === "/receivables/departments/"
  )
    return "departments";
  if (
    pathname === "/receivables/dictionaries" ||
    pathname === "/receivables/dictionaries/"
  )
    return "dictionaries";
  return "redirect";
}

export const receivablesNavigation = (access: ReceivablesAccess) => [
  ...(access.canRecover ? [{ path: "/receivables", label: "初始化状态" }] : []),
  ...(access.canEnter && access.canReadLedger
    ? [
        { path: "/receivables", label: "应收账款看板" },
        { path: "/receivables/ledger", label: "应收账款台账" },
      ]
    : []),
  ...(access.canCreateLedger || access.canImport || access.canExport
    ? [{ path: "/receivables/data", label: "数据处理" }]
    : []),
  ...(access.canManageAccess
    ? [{ path: "/receivables/access", label: "账号与权限" }]
    : []),
  ...(access.canManageConfiguration
    ? [
        { path: "/receivables/departments", label: "财务归属部门" },
        { path: "/receivables/dictionaries", label: "业务字典" },
      ]
    : []),
];

export function receivablesPageTitle(pathname: string) {
  if (pathname.startsWith("/receivables/ledger")) return "台账总览";
  if (
    pathname.startsWith("/receivables/data") ||
    pathname.startsWith("/receivables/imports") ||
    pathname.startsWith("/receivables/exports")
  )
    return "数据处理";
  if (pathname.startsWith("/receivables/access")) return "账号与权限";
  if (pathname.startsWith("/receivables/departments")) return "财务归属部门";
  if (pathname.startsWith("/receivables/dictionaries")) return "业务字典";
  return "应收账款看板";
}

export function receivablesDashboardMode(
  access: Pick<ReceivablesAccess, "canManageMoney" | "canMaintainCollection">,
) {
  if (access.canManageMoney)
    return {
      kind: "finance" as const,
      title: "财务异常处置台",
      description: "先核对金额异常，再处理开票、回款和台账数据。",
      actionLabel: "处理财务数据",
      actionPath: "/receivables/data",
    };
  if (access.canMaintainCollection)
    return {
      kind: "collection" as const,
      title: "催收工作台",
      description: "查看权限范围内的未结账款，持续更新催收进展和下一步计划。",
      actionLabel: "更新催收进展",
      actionPath: "/receivables/ledger",
    };
  return {
    kind: "overview" as const,
    title: "应收账款总览",
    description: "查看权限范围内的应收余额、回款情况和待核对事项。",
    actionLabel: "查看全部台账",
    actionPath: "/receivables/ledger",
  };
}

export function receivablesDashboardActionModel(
  kind: ReturnType<typeof receivablesDashboardMode>["kind"],
) {
  if (kind === "collection")
    return { title: "催收工作", kind: "collection" as const };
  return {
    title: kind === "finance" ? "需要处理" : "风险关注",
    kind: "anomalies" as const,
  };
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
    status:
      status === "active" || status === "voided" || status === "all"
        ? status
        : ("active" as const),
    settlement:
      settlement === "unsettled" ||
      settlement === "settled" ||
      settlement === "all"
        ? settlement
        : ("unsettled" as const),
    anomaly:
      anomaly === "over_received" ||
      anomaly === "writeoff_adjustment_required" ||
      anomaly === "final_amount_missing"
        ? anomaly
        : undefined,
    debtStatus: query.get("debtStatus") || undefined,
    creditorUnit: query.get("creditorUnit") || undefined,
  };
}

export function preserveReceivablesConflictDraft<TDraft, TLatest>(
  draft: TDraft,
  latest: TLatest,
) {
  return { draft, latest, retryRequired: true as const };
}

export function normalizeReceivablesGrantScopes(
  role: ReceivablesGrant["role"],
  scopes: Array<{ departmentId: string; canRead: boolean; canWrite: boolean }>,
) {
  return scopes.map((scope) => ({
    departmentId: scope.departmentId,
    canRead: scope.canRead || scope.canWrite,
    canWrite: role === "readonly" ? false : scope.canWrite,
  }));
}

export function normalizeReceivablesGrantDraft(
  role: ReceivablesGrant["role"],
  draft: {
    canCreate: boolean;
    canEditBaseInfo?: boolean;
    canExport: boolean;
    canViewAll: boolean;
    canMaintainCollection?: boolean;
    canUploadAttachments?: boolean;
    editableFields?: string[];
    departments: Array<{
      departmentId: string;
      canRead: boolean;
      canWrite: boolean;
    }>;
  },
) {
  if (role === "admin")
    return {
      canCreate: false,
      canEditBaseInfo: false,
      canExport: false,
      canViewAll: false,
      canMaintainCollection: false,
      canUploadAttachments: false,
      editableFields: [],
      departments: [],
    };
  return {
    canCreate: role === "reporter" && draft.canCreate,
    canEditBaseInfo: role === "reporter" && !!draft.canEditBaseInfo,
    canExport: draft.canExport,
    canViewAll: draft.canViewAll,
    canMaintainCollection: role === "reporter" && !!draft.canMaintainCollection,
    canUploadAttachments: role === "reporter" && !!draft.canUploadAttachments,
    editableFields: role === "reporter" ? [...new Set(draft.editableFields ?? [])] : [],
    departments: normalizeReceivablesGrantScopes(role, draft.departments),
  };
}

type ImportPreviewGuard = {
  errors: readonly unknown[];
  rows: readonly {
    rowNumber: number;
    ledgerId: string | null;
    normalizedData?: Pick<
      ReceivablesImportData,
      | "openingInvoiceAmount"
      | "openingInvoiceDate"
      | "openingReceiptAmount"
      | "openingReceiptDate"
    >;
  }[];
};
type ImportDecisions = Record<number, "skip" | "update">;
const unresolvedDuplicate = (
  preview: ImportPreviewGuard,
  decisions: ImportDecisions,
) => preview.rows.some((row) => row.ledgerId && !decisions[row.rowNumber]);
const hasPositiveImportAmount = (value: string | null | undefined) =>
  !!value && !/^0+(?:\.0+)?$/.test(value);

export const receivablesImportNeedsOpeningBalanceDate = (
  preview: ImportPreviewGuard,
) =>
  preview.rows.some(
    ({ ledgerId, normalizedData }) =>
      !ledgerId &&
      !!normalizedData &&
      ((hasPositiveImportAmount(normalizedData.openingInvoiceAmount) &&
        !normalizedData.openingInvoiceDate) ||
        (hasPositiveImportAmount(normalizedData.openingReceiptAmount) &&
          !normalizedData.openingReceiptDate)),
  );

export function receivablesImportStage(
  preview: ImportPreviewGuard | undefined,
  decisions: ImportDecisions,
  confirmed: boolean,
):
  | "upload"
  | "blocking_errors"
  | "duplicate_decisions"
  | "impact_preview"
  | "confirm_apply" {
  if (!preview) return "upload";
  if (preview.errors.length) return "blocking_errors";
  if (unresolvedDuplicate(preview, decisions)) return "duplicate_decisions";
  return confirmed ? "confirm_apply" : "impact_preview";
}

export const canApplyReceivablesImport = (
  preview: ImportPreviewGuard,
  decisions: ImportDecisions,
  confirmed: boolean,
) => receivablesImportStage(preview, decisions, confirmed) === "confirm_apply";

export function updateReceivablesImportDecision(
  state: {
    decisions: ImportDecisions;
    confirmStage: boolean;
    confirmed: boolean;
  },
  rowNumber: number,
  decision: "skip" | "update",
) {
  return {
    decisions: { ...state.decisions, [rowNumber]: decision },
    confirmStage: false,
    confirmed: false,
  };
}

export const receivablesExportDownloadRequest = (
  jobId: string,
  token: string,
) => ({
  path: `/api/receivables/exports/${encodeURIComponent(jobId)}/download`,
  init: {
    method: "POST",
    body: JSON.stringify({ token }),
  } satisfies RequestInit,
});

export const receivablesMutationInvalidationKeys = (
  accountId: string,
  scopeFingerprint: string,
  ledgerId?: string,
) => [
  receivablesQueryKey(accountId, "access"),
  receivablesScopedQueryKey(accountId, scopeFingerprint, "dashboard"),
  receivablesScopedQueryKey(accountId, scopeFingerprint, "ledgers"),
  ...(ledgerId
    ? [
        receivablesScopedQueryKey(
          accountId,
          scopeFingerprint,
          "ledger",
          ledgerId,
        ),
      ]
    : []),
  receivablesScopedQueryKey(accountId, scopeFingerprint, "admin"),
  receivablesScopedQueryKey(accountId, scopeFingerprint, "imports"),
  receivablesScopedQueryKey(accountId, scopeFingerprint, "exports"),
];

export const receivablesScopeQueryPrefix = (
  accountId: string,
  scopeFingerprint: string,
) => receivablesScopedQueryKey(accountId, scopeFingerprint);

export function normalizeReceivablesMoneyInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(normalized)
    ? normalized
    : null;
}

export function normalizeReceivablesPositiveMoneyInput(
  value: unknown,
): string | null {
  const normalized = normalizeReceivablesMoneyInput(value);
  return normalized && !/^0(?:\.0+)?$/.test(normalized) ? normalized : null;
}

const receivablesRevisionConflictCodes = new Set([
  "REVISION_CONFLICT",
  "RECEIVABLES_REVISION_CONFLICT",
]);
const receivablesStaleCodes = new Set([
  "IMPORT_PREVIEW_STALE",
  "IMPORT_TARGET_CHANGED",
  "IMPORT_FILE_CHANGED",
  "IMPORT_ROLLBACK_CONFLICT",
  "RECEIVABLES_MIGRATION_STATE_CHANGED",
]);

export function receivablesErrorKind(
  error: unknown,
): "revision_conflict" | "stale" | "revoked" | "other" {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (typeof code === "string" && receivablesRevisionConflictCodes.has(code))
    return "revision_conflict";
  if (typeof code === "string" && receivablesStaleCodes.has(code))
    return "stale";
  if (status === 403 || code === "RECEIVABLES_FORBIDDEN") return "revoked";
  return "other";
}

export function receivablesDownloadFilename(
  contentDisposition: string | null,
  fallback: string,
): string {
  const encoded = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quoted = contentDisposition?.match(/filename="?([^";]+)"?/i)?.[1];
  let candidate = encoded ?? quoted ?? fallback;
  if (encoded) {
    try {
      candidate = decodeURIComponent(encoded);
    } catch {
      candidate = fallback;
    }
  }
  candidate =
    candidate
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/[\u0000-\u001f\u007f]/g, "")
      .trim() ?? "";
  return candidate || fallback;
}

export function formatReceivablesMoney(
  value: string | null,
  decimals: 0 | 2 | 4 = 2,
): string {
  if (value === null) return "—";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, sign, integer, fraction = ""] = match;
  const scale = 10n ** BigInt(decimals);
  const padded = fraction.padEnd(decimals + 1, "0");
  let scaled =
    BigInt(integer!) * scale + BigInt(padded.slice(0, decimals) || "0");
  if ((padded[decimals] ?? "0") >= "5") scaled += 1n;
  const scaledText = scaled.toString().padStart(decimals + 1, "0");
  const whole = decimals ? scaledText.slice(0, -decimals) : scaledText;
  const decimalDigits = decimals ? scaledText.slice(-decimals) : "";
  const decimal = decimals && !(decimals === 2 && /^0+$/.test(decimalDigits)) ? `.${decimalDigits}` : "";
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${decimal}`;
}

export function formatReceivablesDate(value: string | null): string {
  if (!value) return "—";
  const match = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(value);
  return match?.[1] ?? "—";
}
