import assert from "node:assert/strict";
import { PersonMergePolicyError, assertPersonMergeAllowed } from "../src/person-merge-policy.js";

const base = {
  actorPersonId: "admin-person",
  sourceId: "source-person",
  targetId: "target-person",
  sourceStatus: "active" as const,
  targetStatus: "active" as const,
  sourceType: "employee" as const,
  targetType: "employee" as const,
  sourcePhone: "13800000000",
  targetPhone: "13800000000",
  sourceNationalIdHash: null,
  targetNationalIdHash: "same-natural-person",
  sourcePrimaryOrganizationId: "department-a",
  targetPrimaryOrganizationId: "department-a",
  sourceHasAccount: false,
  targetHasAccount: true
};

assert.doesNotThrow(() => assertPersonMergeAllowed(base));

for (const [overrides, code] of [
  [{ targetId: "source-person" }, "PERSON_MERGE_SAME"],
  [{ actorPersonId: "source-person" }, "PERSON_SELF_MERGE_FORBIDDEN"],
  [{ actorPersonId: "target-person" }, "PERSON_SELF_MERGE_FORBIDDEN"],
  [{ sourceStatus: "merged" }, "PERSON_ALREADY_MERGED"],
  [{ targetStatus: "disabled" }, "PERSON_MERGE_TARGET_INACTIVE"],
  [{ sourceType: "contractor" }, "PERSON_TYPE_CONFLICT"],
  [{ sourcePhone: "13900000000" }, "PERSON_PHONE_CONFLICT"],
  [{ sourceNationalIdHash: "different-natural-person" }, "PERSON_IDENTITY_CONFLICT"],
  [{ sourcePrimaryOrganizationId: "department-b" }, "PERSON_ORGANIZATION_CONFLICT"],
  [{ sourceHasAccount: true }, "PERSON_ACCOUNT_CONFLICT"]
] as const) {
  assert.throws(
    () => assertPersonMergeAllowed({ ...base, ...overrides }),
    (error: unknown) => error instanceof PersonMergePolicyError && error.code === code,
    code
  );
}

console.log("PERSON_MERGE_POLICY_OK");
