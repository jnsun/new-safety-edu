import assert from "node:assert/strict";
import { accountStatusAfterLoginMethodChange, assertLoginMethodCanBeRemoved } from "../src/session-login-policy.js";

assert.equal(accountStatusAfterLoginMethodChange("active", { password: false, phone: false, wechat: false }), "pending");
assert.equal(accountStatusAfterLoginMethodChange("active", { password: false, phone: true, wechat: false }), "active");
assert.equal(accountStatusAfterLoginMethodChange("disabled", { password: true, phone: true, wechat: true }), "disabled");
assert.equal(accountStatusAfterLoginMethodChange("merged", { password: true, phone: true, wechat: true }), "merged");

assert.throws(
  () => assertLoginMethodCanBeRemoved({ method: "password", targetIsLastCompanyAdmin: true, otherWebLoginAvailable: false }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "LAST_COMPANY_ADMIN_LOGIN_METHOD"
);
assert.doesNotThrow(() => assertLoginMethodCanBeRemoved({ method: "wechat", targetIsLastCompanyAdmin: true, otherWebLoginAvailable: false }));

console.log("SESSION_LOGIN_POLICY_OK");
