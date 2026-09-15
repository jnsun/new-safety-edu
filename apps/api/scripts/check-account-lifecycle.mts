import assert from "node:assert/strict";
import {
  AccountPolicyError,
  accountDeletionBlockers,
  assertAccountStatusChange,
  normalizeUsername
} from "../src/account-lifecycle.js";

assert.equal(normalizeUsername("  Admin.User_01  "), "admin.user_01");
for (const invalid of ["abc", "管理员", "123456789012345678", "has space"]) {
  assert.throws(() => normalizeUsername(invalid), AccountPolicyError, `username should be rejected: ${invalid}`);
}

assert.throws(
  () => assertAccountStatusChange({ actorId: "same", targetId: "same", currentStatus: "active", nextStatus: "disabled", targetIsCompanyAdmin: false, activeCompanyAdminCount: 2, personStatus: "active" }),
  (error: unknown) => error instanceof AccountPolicyError && error.code === "ACCOUNT_SELF_ACTION_FORBIDDEN"
);
assert.throws(
  () => assertAccountStatusChange({ actorId: "actor", targetId: "target", currentStatus: "active", nextStatus: "disabled", targetIsCompanyAdmin: true, activeCompanyAdminCount: 1, personStatus: "active" }),
  (error: unknown) => error instanceof AccountPolicyError && error.code === "LAST_COMPANY_ADMIN"
);
assert.throws(
  () => assertAccountStatusChange({ actorId: "actor", targetId: "target", currentStatus: "disabled", nextStatus: "active", targetIsCompanyAdmin: false, activeCompanyAdminCount: 2, personStatus: "disabled" }),
  (error: unknown) => error instanceof AccountPolicyError && error.code === "PERSON_NOT_ACTIVE"
);
assert.doesNotThrow(() => assertAccountStatusChange({ actorId: "actor", targetId: "target", currentStatus: "disabled", nextStatus: "active", targetIsCompanyAdmin: false, activeCompanyAdminCount: 2, personStatus: "active" }));

assert.deepEqual(accountDeletionBlockers({ person: 1, roles: 0, wechatBindings: 2, refreshSessions: 0, preferences: 0, requests: 0, audits: 1, usernameHistory: 0, mergedAccounts: 0, uploadedFiles: 0 }), ["已关联人员", "存在微信绑定", "存在审计记录"]);
assert.deepEqual(accountDeletionBlockers({ person: 0, roles: 0, wechatBindings: 0, refreshSessions: 0, preferences: 0, requests: 0, audits: 0, usernameHistory: 0, mergedAccounts: 0, uploadedFiles: 0 }), []);

console.log("ACCOUNT_LIFECYCLE_OK");
