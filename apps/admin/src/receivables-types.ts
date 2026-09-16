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
  invoices: Array<{ id: string; invoiceDate: string; invoiceNo: string | null; amount: string; status: "active" | "voided" }>;
  receipts: Array<{ id: string; receiptDate: string; referenceNo: string | null; amount: string; status: "active" | "voided" }>;
  attachments: Array<{ id: string; category: string; status: "active" | "voided"; file: { id: string; originalName: string } }>;
  revisions: Array<{ id: string; revision: number; reason: string; createdAt: string }>;
  capabilities: ReceivablesAccess;
};

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

export function receivablesPortalMode(access: Pick<ReceivablesAccess, "state" | "canEnter" | "canRecover">): "enabled" | "recover" | "hidden" {
  if (access.canEnter) return "enabled";
  return access.state !== "ready" && access.canRecover ? "recover" : "hidden";
}

export function resolveReceivablesRoute(pathname: string): "dashboard" | "ledger" | "redirect" {
  if (pathname === "/receivables" || pathname === "/receivables/") return "dashboard";
  if (pathname === "/receivables/ledger" || pathname === "/receivables/ledger/") return "ledger";
  return "redirect";
}

export function formatReceivablesMoney(value: string | null): string {
  if (value === null) return "—";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const [, sign, integer, fraction = ""] = match;
  return `¥${sign}${integer!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
}
