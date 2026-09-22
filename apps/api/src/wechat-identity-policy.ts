type ScopedPrincipal = {
  roles: readonly { role: string; scopeType: string; scopeId: string | null }[];
};

export function canReviewWechatIdentityRequest(principal: ScopedPrincipal, organizationId: string, escalatedToCompany: boolean) {
  if (principal.roles.some(({ role }) => role === "company_admin")) return true;
  if (escalatedToCompany) return false;
  return principal.roles.some(({ role, scopeType, scopeId }) => (role === "org_leader" || role === "org_admin") && scopeType === "organization" && scopeId === organizationId);
}

export function decideWechatBinding(input: {
  activePersonMatches: number;
  selectedOrganizationMatches: boolean;
  hasIdentityConflict: boolean;
  crossEntityConflict: boolean;
}) {
  if (input.hasIdentityConflict || input.crossEntityConflict || input.activePersonMatches > 1) return "company_review" as const;
  if (input.activePersonMatches === 1 && input.selectedOrganizationMatches) return "direct" as const;
  return "organization_review" as const;
}

export type WechatVerificationPurpose = "wechat_bind" | "wechat_rebind";

export function assertWechatVerificationPurpose(value: string): WechatVerificationPurpose {
  if (value === "wechat_bind" || value === "wechat_rebind") return value;
  throw Object.assign(new Error("短信验证码用途无效"), { statusCode: 400, code: "INVALID_SMS_PURPOSE" });
}
