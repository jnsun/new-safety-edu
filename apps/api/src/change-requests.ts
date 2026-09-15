import type { ChangeRequestStatus } from "@prisma/client";

type ActionContext = {
  status: ChangeRequestStatus;
  isApplicant: boolean;
  isCreator: boolean;
  canReview: boolean;
  isCompanyAdmin: boolean;
};

export type ChangeRequestAction = "withdraw" | "cancel" | "approve" | "reject";

export function allowedRequestActions(context: ActionContext): ChangeRequestAction[] {
  if (context.status !== "pending") return [];
  const actions: ChangeRequestAction[] = [];
  if (context.isApplicant) actions.push("withdraw");
  if (context.canReview) actions.push("approve", "reject");
  if (context.isCreator || context.isCompanyAdmin) actions.push("cancel");
  return [...new Set(actions)];
}

export function assertRequestTransition(current: ChangeRequestStatus, next: ChangeRequestStatus) {
  if (current !== "pending") {
    throw Object.assign(new Error("申请已经进入终态，不能再次处理"), { statusCode: 409, code: "REQUEST_ALREADY_HANDLED" });
  }
  if (!["approved", "rejected", "withdrawn", "cancelled", "duplicate", "failed"].includes(next)) {
    throw Object.assign(new Error("申请状态转换无效"), { statusCode: 409, code: "INVALID_REQUEST_TRANSITION" });
  }
}
