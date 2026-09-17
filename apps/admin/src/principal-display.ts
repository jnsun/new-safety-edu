export function principalRoleSummary(
  roles: readonly { role: string }[],
  labels: Record<string, string>,
) {
  const names = [...new Set(roles
    .filter(({ role }) => role !== "learner")
    .map(({ role }) => labels[role] ?? role))];
  return names.join(" / ") || "普通人员";
}
