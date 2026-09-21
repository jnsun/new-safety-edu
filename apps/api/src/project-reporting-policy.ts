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

export type DepartmentSubmissionStatus = "draft" | "submitted" | "rejected" | "confirmed" | "locked";
export type DepartmentSubmissionAction = "submit" | "reject" | "confirm" | "lock";

export function nextSubmissionStatus(current: DepartmentSubmissionStatus, action: DepartmentSubmissionAction): DepartmentSubmissionStatus {
  const transitions: Partial<Record<DepartmentSubmissionStatus, Partial<Record<DepartmentSubmissionAction, DepartmentSubmissionStatus>>>> = {
    draft: { submit: "submitted" },
    rejected: { submit: "submitted" },
    submitted: { reject: "rejected", confirm: "confirmed" },
    confirmed: { lock: "locked" },
  };
  const next = transitions[current]?.[action];
  if (!next) throw Object.assign(new Error("当前报送状态不允许执行该操作"), { statusCode: 409, code: "SUBMISSION_TRANSITION_INVALID" });
  return next;
}
