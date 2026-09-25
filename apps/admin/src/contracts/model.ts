export type ContractAccess = {
  role: "admin" | "editor" | "readonly" | null;
  canEnter: boolean;
  canCreateProject: boolean;
  canEditProject: boolean;
  canManageContracts: boolean;
  canUploadAttachments: boolean;
  canChangeStage: boolean;
  canExport: boolean;
  canViewAll: boolean;
  canManageAccess: boolean;
  organizationIds: string[];
};

export type Organization = { id: string; name: string };
export type MainContract = {
  id: string;
  contractNo: string;
  partyA: string;
  amountYuan: string | null;
  annualAmountYuan?: string | null;
  signedAt: string | null;
  handlerName?: string | null;
  sourceNote?: string | null;
  supplements?: Array<{ id: string; contractNo: string; amountDeltaYuan: string | null; signedAt: string | null; reason: string | null }>;
};
export type ProjectRow = {
  id: string;
  name: string;
  code: string;
  status?: string;
  updatedAt: string;
  contractBidStatus: string;
  contractStage: string;
  contractBusinessSector: string | null;
  responsibleOrganization: Organization;
  mainContract: MainContract | null;
  _count?: { contractSubcontracts: number; contractAttachments: number };
};
export type ProjectCandidate = { id: string; name: string; code: string; status: string; responsibleOrganization: Organization };
export type ProjectDetail = ProjectRow & {
  projectType: string | null;
  location: string | null;
  managerName: string | null;
  managerPhone: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  mainContract: MainContract | null;
  contractSubcontracts: Array<{ id: string; contractNo: string; subcontractorName: string; amountYuan: string | null; scope: string | null; signedAt?: string | null; handlerName?: string | null; owningOrganization: Organization }>;
  contractStatusHistory: Array<{ id: string; fromStage: string | null; toStage: string; reason: string | null; createdAt: string }>;
  contractAttachments: Array<{ id: string; ownerType: string; category: string | null; note: string | null; createdAt: string; file: { id: string; originalName: string; mimeType?: string; size: number } }>;
};

export const bidLabels: Record<string, string> = { bidding: "投标中", won: "已中标", lost: "未中标", abandoned: "放弃" };
export const projectStatusLabels: Record<string, string> = { active: "在建", paused: "暂停", ended: "归档" };
export const stageLabels: Record<string, string> = { bid_preparation: "投标准备", contract_registration: "合同登记", field_work: "外业实施", indoor_sorting: "内业整理", report_drafting: "报告编制", submitted_review: "送审", accepted: "验收", warranty_payment: "质保/尾款", closed: "关闭", terminated: "终止" };
export const nextStages: Record<string, string[]> = { bid_preparation: ["contract_registration", "terminated"], contract_registration: ["field_work", "terminated"], field_work: ["indoor_sorting", "terminated"], indoor_sorting: ["report_drafting", "terminated"], report_drafting: ["submitted_review", "terminated"], submitted_review: ["accepted", "report_drafting", "terminated"], accepted: ["warranty_payment", "closed"], warranty_payment: ["closed"], closed: [], terminated: [] };
export const dateOnly = (value?: string | null) => value?.slice(0, 10);
export const formatMoney = (value?: string | null) => value ? new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(Number(value)) : "—";
export const formatFileSize = (size: number) => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
