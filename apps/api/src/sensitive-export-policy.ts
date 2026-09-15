type Role = { role: string; scopeType: string; scopeId: string | null };
type ExportScope = { scopeType: "company" | "organization" | "project" | "self"; scopeId: string | null; projectResponsibleOrganizationId?: string; requesterPersonId?: string | null };

export const sensitiveExportLifetimeMs = 10 * 60 * 1000;

export class SensitiveExportPolicyError extends Error {
  readonly statusCode = 403;
  readonly code = "SENSITIVE_EXPORT_FORBIDDEN";
}

export function assertSensitiveExportScopeAllowed(roles: Role[], scope: ExportScope) {
  if (scope.scopeType === "self") {
    if (scope.scopeId && scope.requesterPersonId === scope.scopeId) return;
    throw new SensitiveExportPolicyError("只能生成本人敏感资料文件");
  }
  if (roles.some(({ role }) => role === "company_admin")) return;
  if (scope.scopeType === "organization" && scope.scopeId && roles.some(({ role, scopeType, scopeId }) => ["org_leader", "org_admin"].includes(role) && scopeType === "organization" && scopeId === scope.scopeId)) return;
  if (scope.scopeType === "project" && scope.scopeId) {
    if (roles.some(({ role, scopeType, scopeId }) => role === "project_admin" && scopeType === "project" && scopeId === scope.scopeId)) return;
    if (scope.projectResponsibleOrganizationId && roles.some(({ role, scopeType, scopeId }) => ["org_leader", "org_admin"].includes(role) && scopeType === "organization" && scopeId === scope.projectResponsibleOrganizationId)) return;
  }
  throw new SensitiveExportPolicyError(scope.scopeType === "company" ? "只有公司管理员拥有全公司敏感资料导出权限" : "敏感资料导出权限超出授权范围");
}

const forbiddenAuditKey = /(password|secret|token|hash|openid|unionid|session.?key|authorization|cookie|ip.?address|user.?agent|national.?id.?(cipher|iv|tag))/i;

export function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !forbiddenAuditKey.test(key))
    .map(([key, item]) => [key, sanitizeAuditValue(item)]));
}
