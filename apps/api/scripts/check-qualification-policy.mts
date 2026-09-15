import assert from "node:assert/strict";
import { assertOrganizationQualificationOwner, qualificationExpiryMilestone } from "../src/qualification-policy.js";

assert.doesNotThrow(() => assertOrganizationQualificationOwner("company"));
assert.doesNotThrow(() => assertOrganizationQualificationOwner("business_entity"));
for (const type of ["department", "contractor"] as const) assert.throws(
  () => assertOrganizationQualificationOwner(type),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "QUALIFICATION_OWNER_TYPE_INVALID"
);
const now = new Date("2026-09-15T00:00:00.000Z");
assert.deepEqual(qualificationExpiryMilestone(new Date("2026-09-14T00:00:00.000Z"), now, 30), { days: -1, milestone: "overdue-2958" });
assert.deepEqual(qualificationExpiryMilestone(new Date("2026-09-20T00:00:00.000Z"), now, 30), { days: 5, milestone: "7" });
console.log("QUALIFICATION_POLICY_OK");
