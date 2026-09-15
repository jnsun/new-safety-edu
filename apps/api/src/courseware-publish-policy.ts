type Scope = { scopeType: string; scopeId: string | null };
type Role = Scope & { role: string };

export function canPublishCourseware(roles: Role[], grants: Scope[], courseware: Scope) {
  if (roles.some(({ role }) => role === "company_admin")) return true;
  return grants.some((grant) => grant.scopeType === courseware.scopeType && grant.scopeId === courseware.scopeId);
}
