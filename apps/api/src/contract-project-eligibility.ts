import type { Prisma } from "@prisma/client";

// Existing safety projects keep their established behaviour when later adopted
// into contract management. New bid projects enter safety only after signature.
export const safetyEligibleProjectWhere: Prisma.ProjectWhereInput = {
  OR: [
    { contractStage: null },
    { contractDataSource: "existing_project" },
    { contractBidStatus: "won", mainContract: { is: { signedAt: { not: null } } } },
  ],
};

export function isSafetyEligibleProject(project: {
  contractStage: string | null;
  contractDataSource: string | null;
  contractBidStatus: string | null;
  mainContract: { signedAt: Date | null } | null;
}): boolean {
  return !project.contractStage || project.contractDataSource === "existing_project"
    || (project.contractBidStatus === "won" && Boolean(project.mainContract?.signedAt));
}
