export type WebLoginDestination =
  | { allowed: true; path: "/" | "/receivables" | "/my-profile" }
  | { allowed: false; reason: "no_web_access" };

export const safetyWebRoleNames = ["company_admin", "org_leader", "org_admin", "field_reporter", "project_admin"] as const;

export function hasSafetyWebRole(roles: readonly { role: string }[]): boolean {
  return roles.some(({ role }) => (safetyWebRoleNames as readonly string[]).includes(role));
}

export function decideWebLoginDestination(input: {
  hasManagerRole: boolean;
  canEnterReceivables: boolean;
  hasPerson?: boolean;
}): WebLoginDestination {
  if (input.hasManagerRole) return { allowed: true, path: "/" };
  if (input.canEnterReceivables) return { allowed: true, path: "/receivables" };
  if (input.hasPerson) return { allowed: true, path: "/my-profile" };
  return { allowed: false, reason: "no_web_access" };
}
