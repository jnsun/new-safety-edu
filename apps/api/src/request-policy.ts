import { createHash } from "node:crypto";
import type { ChangeRequestStatus, Prisma } from "@prisma/client";

type RequestClaimer = Pick<Prisma.TransactionClient, "changeRequest" | "notification">;

export function changeRequestKey(type: string, subject: string, target = "") {
  return createHash("sha256").update(JSON.stringify([type, subject, target])).digest("hex");
}

export async function claimPendingRequest(
  tx: RequestClaimer,
  requestId: string,
  data: { status: Exclude<ChangeRequestStatus, "pending">; reviewedBy: string; reviewedAt?: Date; reviewNote?: string | null }
) {
  const claimed = await tx.changeRequest.updateMany({
    where: { id: requestId, status: "pending" },
    data: { ...data, reviewedAt: data.reviewedAt ?? new Date() }
  });
  if (claimed.count !== 1) throw Object.assign(new Error("申请已由其他人处理，请刷新后查看"), { statusCode: 409, code: "REQUEST_ALREADY_HANDLED" });
  if (["approved", "rejected", "cancelled", "failed"].includes(data.status)) {
    const request = await tx.changeRequest.findUnique({ where: { id: requestId }, select: { personId: true } });
    if (request?.personId) await tx.notification.upsert({
      where: { dedupeKey: `change-request-result:${requestId}:${data.status}` }, update: {},
      create: { personId: request.personId, title: "申请处理结果", body: `你的申请已${data.status === "approved" ? "通过" : data.status === "rejected" ? "驳回" : data.status === "cancelled" ? "取消" : "处理失败"}，请进入申请记录查看详情。`, dedupeKey: `change-request-result:${requestId}:${data.status}` }
    });
  }
}
