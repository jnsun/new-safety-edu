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
  throw new SensitiveExportPolicyError("当前仅公司管理员拥有人员完整资料查看与导出权限");
}

const forbiddenAuditKey = /(password|secret|token|hash|openid|unionid|session.?key|authorization|cookie|ip.?address|user.?agent|national.?id.?(cipher|iv|tag))/i;

export function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !forbiddenAuditKey.test(key))
    .map(([key, item]) => [key, sanitizeAuditValue(item)]));
}
