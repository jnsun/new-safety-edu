import assert from "node:assert/strict";
import { retentionCutoffs } from "../src/retention.js";

const now = new Date("2026-09-15T00:00:00.000Z");
const cutoffs = retentionCutoffs(now);
assert.equal(cutoffs.authSuccess.toISOString(), "2025-09-15T00:00:00.000Z");
assert.equal(cutoffs.loginFailure.toISOString(), "2026-03-15T00:00:00.000Z");
assert.equal(cutoffs.verificationCode.toISOString(), "2026-06-17T00:00:00.000Z");
assert.equal("auditLog" in cutoffs, false);
console.log("RETENTION_POLICY_OK");
