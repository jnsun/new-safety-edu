import assert from "node:assert/strict";
import { previewBulkPersonDisable } from "../src/person-bulk-lifecycle-policy.ts";

assert.throws(() => previewBulkPersonDisable({ personIds: [], persons: [] }), /1 至 500/);
assert.throws(() => previewBulkPersonDisable({ personIds: Array.from({ length: 501 }, (_, index) => String(index)), persons: [] }), /1 至 500/);

assert.deepEqual(previewBulkPersonDisable({
  personIds: ["active", "disabled", "missing", "active"],
  persons: [{ id: "active", status: "active" }, { id: "disabled", status: "disabled" }],
}), [
  { personId: "active", eligible: true, code: "READY", reason: "可以停用" },
  { personId: "disabled", eligible: false, code: "ALREADY_DISABLED", reason: "人员已经停用" },
  { personId: "missing", eligible: false, code: "NOT_FOUND", reason: "人员不存在或不在管理范围内" },
]);

console.log("person bulk lifecycle check passed");
