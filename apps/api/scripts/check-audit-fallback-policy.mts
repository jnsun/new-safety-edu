import assert from "node:assert/strict";
import { parseAuditFallbackLine } from "../src/audit-fallback.js";
import { normalizeAuditObjectId } from "../src/audit.js";

const event = parseAuditFallbackLine(JSON.stringify({ id: "89ea5826-536e-4df4-9ccb-302152eca5af", actorId: null, action: "notification.delivery", objectType: "notification", objectId: "ad7465d7-753c-4484-a18f-d08f9d59af23", result: "failed", metadata: { safe: true }, createdAt: "2026-09-15T00:00:00.000Z" }));
assert.equal(event.action, "notification.delivery");
assert.equal(event.createdAt.toISOString(), "2026-09-15T00:00:00.000Z");
assert.throws(() => parseAuditFallbackLine('{"action":"missing identity"}'));
assert.throws(() => parseAuditFallbackLine(JSON.stringify({ id: "89ea5826-536e-4df4-9ccb-302152eca5af", actorId: null, action: "bad", objectType: "bad", objectId: "bulk", result: "failed", createdAt: "2026-09-15T00:00:00.000Z" })));
assert.equal(normalizeAuditObjectId("bulk"), null);
assert.equal(normalizeAuditObjectId("ad7465d7-753c-4484-a18f-d08f9d59af23"), "ad7465d7-753c-4484-a18f-d08f9d59af23");
console.log("AUDIT_FALLBACK_POLICY_OK");
