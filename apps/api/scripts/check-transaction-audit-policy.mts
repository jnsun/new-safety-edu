import assert from "node:assert/strict";
import { writeCriticalAudit } from "../src/transaction-audit.js";

const written: unknown[] = [];
const tx = {
  account: { findUnique: async () => ({ status: "active", personId: "person-1", person: { status: "active" } }) },
  auditLog: {
    create: async (input: unknown) => {
      written.push(input);
      return { id: "audit-1" };
    }
  }
};

await writeCriticalAudit(tx, {
  actorId: "00000000-0000-0000-0000-000000000001",
  action: "account.disable",
  objectType: "account",
  objectId: "00000000-0000-0000-0000-000000000002",
  reason: "账号存在安全风险",
  metadata: { before: "active", after: "disabled" }
});
assert.equal(written.length, 1, "critical audit must be written through the supplied transaction");

await assert.rejects(
  () => writeCriticalAudit({ account: { findUnique: async () => ({ status: "active", personId: null, person: null }) }, auditLog: { create: async () => { throw new Error("database unavailable"); } } }, {
    actorId: null,
    action: "account.recovery",
    objectType: "account",
    objectId: "00000000-0000-0000-0000-000000000002"
  }),
  /database unavailable/,
  "critical audit failure must reject so the surrounding transaction rolls back"
);

await assert.rejects(
  () => writeCriticalAudit({ account: { findUnique: async () => ({ status: "disabled", personId: null, person: null }) }, auditLog: { create: async () => ({ id: "audit-2" }) } }, {
    actorId: "00000000-0000-0000-0000-000000000001", action: "account.disable", objectType: "account"
  }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "ACTOR_STATE_CHANGED",
  "critical transactions must re-check actor state before commit"
);

console.log("TRANSACTION_AUDIT_POLICY_OK");
