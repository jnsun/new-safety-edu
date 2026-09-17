export type ReviewScope = "pending" | "reviewed" | "all";

export function filterReviewRows<T extends { status: string; reviewedBy: string | null }>(rows: T[], scope: ReviewScope, accountId: string) {
  if (scope === "all") return rows;
  if (scope === "pending") return rows.filter((row) => row.status === "pending");
  return rows.filter((row) => row.status !== "pending" && row.reviewedBy === accountId);
}
