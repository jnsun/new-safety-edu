export type PlatformConditionalModule = "receivables" | "incident";
export type ReceivablesPortalMode = "enabled" | "recover" | "confirm" | "hidden";
export type PlatformLanding =
  | { kind: "choose" }
  | { kind: "redirect"; path: "/safety" | "/receivables" | "/receivables/departments" | "/contracts" | "/my-profile" }
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
  if ([input.canEnterSafety, canEnterReceivables, Boolean(input.canEnterContracts)].filter(Boolean).length > 1) return { kind: "choose" };
  if (input.canEnterSafety) return { kind: "redirect", path: "/safety" };
  if (input.receivablesMode === "confirm") return { kind: "redirect", path: "/receivables/departments" };
  if (canEnterReceivables) return { kind: "redirect", path: "/receivables" };
  if (input.canEnterContracts) return { kind: "redirect", path: "/contracts" };
  if (input.canViewSelf) return { kind: "redirect", path: "/my-profile" };
  return { kind: "denied" };
}

export function platformConditionalModule(canEnterReceivables: boolean): PlatformConditionalModule {
  return canEnterReceivables ? "receivables" : "incident";
}
