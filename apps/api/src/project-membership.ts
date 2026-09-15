import { createHash } from "node:crypto";
import type { MembershipStatus } from "@prisma/client";

const transitions: Partial<Record<MembershipStatus, MembershipStatus[]>> = {
  pending: ["active", "rejected", "withdrawn", "cancelled"],
  active: ["ended", "removed"],
  approved: ["ended", "removed"]
};

export function assertMembershipTransition(current: MembershipStatus, next: MembershipStatus) {
  if (!transitions[current]?.includes(next)) {
    throw Object.assign(new Error(current === "ended" ? "重新加入必须建立新的关系段" : "项目成员状态转换无效"), { statusCode: 409, code: "INVALID_MEMBERSHIP_TRANSITION" });
  }
}

export function membershipBusinessKey(projectId: string, personId: string, segmentId: string) {
  return createHash("sha256").update(JSON.stringify([projectId, personId, segmentId])).digest("hex");
}
