import assert from "node:assert/strict";
import { accountUsernamePattern, accountUsernameRuleMessage } from "../src/account-form.js";

assert.equal(accountUsernamePattern.test("finance.leader"), true);
assert.equal(accountUsernamePattern.test("财务负责人"), false);
assert.equal(accountUsernamePattern.test("abc"), false);
assert.equal(accountUsernamePattern.test("a".repeat(41)), false);
assert.match(accountUsernameRuleMessage, /4.*40/);

console.log("ACCOUNT_FORM_OK");
