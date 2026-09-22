type ReportingRole = {
  role: string;
  scopeType: string;
  scopeId: string | null;
  organizationType?: string | null;
};

type ReportingPrincipal = { roles: ReportingRole[] };

export function reportingOrganizationIds(principal: ReportingPrincipal) {
  return principal.roles
    .filter((role) => role.role === "field_reporter" && role.scopeType === "organization" && role.scopeId && role.organizationType === "business_entity")
    .map((role) => role.scopeId as string);
}

export function canSubmitMonthlyFacts(principal: ReportingPrincipal) {
  return reportingOrganizationIds(principal).length > 0;
}

export function canGovernMonthlyReporting(principal: ReportingPrincipal) {
  return principal.roles.some((role) => role.role === "company_admin" && role.scopeType === "company");
}

export function inheritedMonthlyDefaults(previous?: {
  overallProgress?: string | null;
  onsiteCount?: number | null;
  onsiteVehicles?: number | null;
  equipmentModels?: string | null;
} | null) {
  return previous ? {
    overallProgress: previous.overallProgress ?? undefined,
    onsiteCount: previous.onsiteCount ?? 0,
    onsiteVehicles: previous.onsiteVehicles ?? 0,
    equipmentModels: previous.equipmentModels ?? undefined,
  } : {};
}

export function monthlySubmissionReadiness(input: {
  organizationEnabled: boolean;
  periodStatus: string;
  submissionStatus?: string | undefined;
  projects: Array<{ reportStatus?: string | undefined }>;
}) {
  const completedCount = input.projects.filter((project) => !!project.reportStatus).length;
  const submittableCount = input.projects.filter((project) => project.reportStatus === "draft" || project.reportStatus === "withdrawn").length;
  const reasons = [
    ...(!input.organizationEnabled ? ["该经营实体未启用月报"] : []),
    ...(!["open", "review"].includes(input.periodStatus) ? ["该月份尚未开放或已经锁定"] : []),
    ...(input.submissionStatus && !["draft", "rejected"].includes(input.submissionStatus) ? ["该经营实体本月报送已提交，不能重复提交"] : []),
    ...(input.projects.length > submittableCount ? ["仍有项目未保存可提交的月报草稿"] : []),
  ];
  return { expectedCount: input.projects.length, completedCount, ready: reasons.length === 0, reasons };
}

export type DepartmentSubmissionStatus = "draft" | "submitted" | "rejected" | "confirmed" | "locked";
export type DepartmentSubmissionAction = "submit" | "reject" | "lock";
export const submittedMonthStatuses = ["submitted", "confirmed"] as const;

export function monthlyReminderEligible(status?: string) {
  return !status || !["submitted", "confirmed", "locked"].includes(status);
}

export function monthlyReminderDedupeKey(organizationId: string, month: string, personId: string, at: number) {
  return `monthly-manual:${organizationId}:${month}:${Math.floor(at / 600_000)}:${personId}`;
}

export function nextSubmissionStatus(current: DepartmentSubmissionStatus, action: DepartmentSubmissionAction): DepartmentSubmissionStatus {
  const transitions: Partial<Record<DepartmentSubmissionStatus, Partial<Record<DepartmentSubmissionAction, DepartmentSubmissionStatus>>>> = {
    draft: { submit: "submitted" },
    rejected: { submit: "submitted" },
    submitted: { reject: "rejected", lock: "locked" },
    confirmed: { lock: "locked" },
  };
  const next = transitions[current]?.[action];
  if (!next) throw Object.assign(new Error("当前报送状态不允许执行该操作"), { statusCode: 409, code: "SUBMISSION_TRANSITION_INVALID" });
  return next;
}
