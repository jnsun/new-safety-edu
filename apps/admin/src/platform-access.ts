export type PlatformConditionalModule = "receivables" | "incident";
export type ReceivablesPortalMode = "enabled" | "recover" | "confirm" | "hidden";
export type PlatformLanding =
  | { kind: "choose" }
  | { kind: "denied" };

const safetyWebRoles = new Set(["company_admin", "org_leader", "org_admin", "field_reporter", "project_admin"]);

export function canEnterSafetySystem(roles: readonly { role: string }[]): boolean {
  return roles.some(({ role }) => safetyWebRoles.has(role));
}

export function resolvePlatformLanding(input: {
  canEnterSafety: boolean;
  receivablesMode: ReceivablesPortalMode;
  canEnterContracts?: boolean;
  canViewSelf?: boolean;
}): PlatformLanding {
  const canEnterReceivables = input.receivablesMode !== "hidden";
  if (input.canEnterSafety || canEnterReceivables || input.canEnterContracts || input.canViewSelf) return { kind: "choose" };
  return { kind: "denied" };
}

export function platformConditionalModule(canEnterReceivables: boolean): PlatformConditionalModule {
  return canEnterReceivables ? "receivables" : "incident";
}
