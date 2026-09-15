export type SensitiveTokenScope = { targetPersonId: string; field: "nationalId"; action: "read" };

export function assertSensitiveTokenScope(payload: Record<string, unknown>, expected: SensitiveTokenScope) {
  if (payload.sensitiveTargetPersonId !== expected.targetPersonId || payload.sensitiveField !== expected.field || payload.sensitiveAction !== expected.action) {
    throw Object.assign(new Error("敏感信息授权与当前读取对象不匹配"), { statusCode: 401, code: "SENSITIVE_SCOPE_MISMATCH" });
  }
}
