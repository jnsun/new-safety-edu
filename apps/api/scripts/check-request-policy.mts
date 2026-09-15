import assert from "node:assert/strict";
import { changeRequestKey, claimPendingRequest } from "../src/request-policy.js";

assert.equal(
  changeRequestKey("department_transfer", "person-1", "organization-2"),
  changeRequestKey("department_transfer", "person-1", "organization-2"),
  "the same business request must always have the same key"
);
assert.notEqual(
  changeRequestKey("department_transfer", "person-1", "organization-2"),
  changeRequestKey("department_transfer", "person-1", "organization-3"),
  "different targets must not collide"
);

let status: "pending" | "approved" = "pending";
const tx = {
  changeRequest: {
    updateMany: async ({ where }: { where: { status: string } }) => {
      if (status !== where.status) return { count: 0 };
      status = "approved";
      return { count: 1 };
    },
    findUnique: async () => ({ personId: "person-1" })
  },
  notification: { upsert: async () => ({ id: "notification-1" }) }
};
await claimPendingRequest(tx, "request-1", { status: "approved", reviewedBy: "admin-1" });
await assert.rejects(
  () => claimPendingRequest(tx, "request-1", { status: "approved", reviewedBy: "admin-2" }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "REQUEST_ALREADY_HANDLED",
  "only one concurrent reviewer may claim a pending request"
);

console.log("REQUEST_POLICY_OK");
