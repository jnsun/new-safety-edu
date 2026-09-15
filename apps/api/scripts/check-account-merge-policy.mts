import assert from "node:assert/strict";
import { AccountMergePolicyError, assertAccountMergeAllowed } from "../src/account-merge-policy.js";

const base = {
  actorId: "actor",
  sourceId: "source",
  targetId: "target",
  sourceStatus: "active" as const,
  targetStatus: "active" as const,
  sourcePersonId: null,
  targetPersonId: "person",
  targetPersonStatus: "active" as const,
  sourceVerifiedPhone: null,
  targetVerifiedPhone: "13800000000",
  sourceUsername: "source.user",
  targetUsername: null,
  sourcePassword: true,
  targetPassword: false,
  sourceActiveWechatAppIds: [] as string[],
  targetActiveWechatAppIds: [] as string[],
  sourceIsCompanyAdmin: false,
  activeCompanyAdminCount: 2
};

assert.doesNotThrow(() => assertAccountMergeAllowed(base));
assert.doesNotThrow(() => assertAccountMergeAllowed({ ...base, actorId: "source", automaticEmptySource: true }));

for (const [overrides, code] of [
  [{ targetId: "source" }, "ACCOUNT_MERGE_SAME"],
  [{ actorId: "source" }, "ACCOUNT_SELF_ACTION_FORBIDDEN"],
  [{ actorId: "target" }, "ACCOUNT_SELF_ACTION_FORBIDDEN"],
  [{ sourceStatus: "merged" }, "ACCOUNT_ALREADY_MERGED"],
  [{ targetStatus: "disabled" }, "ACCOUNT_MERGE_TARGET_INACTIVE"],
  [{ targetPersonStatus: "disabled" }, "ACCOUNT_MERGE_TARGET_INACTIVE"],
  [{ sourcePersonId: "one", targetPersonId: "two" }, "ACCOUNT_PERSON_CONFLICT"],
  [{ sourceVerifiedPhone: "13900000000" }, "ACCOUNT_PHONE_CONFLICT"],
  [{ targetUsername: "target.user", targetPassword: true }, "ACCOUNT_CREDENTIAL_CONFLICT"],
  [{ sourceActiveWechatAppIds: ["wx-app"], targetActiveWechatAppIds: ["wx-app"] }, "ACCOUNT_WECHAT_CONFLICT"],
  [{ sourceIsCompanyAdmin: true, activeCompanyAdminCount: 1 }, "LAST_COMPANY_ADMIN"]
] as const) {
  assert.throws(
    () => assertAccountMergeAllowed({ ...base, ...overrides }),
    (error: unknown) => error instanceof AccountMergePolicyError && error.code === code,
    code
  );
}

console.log("ACCOUNT_MERGE_POLICY_OK");
