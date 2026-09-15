import assert from "node:assert/strict";
import { assertMembershipTransition, membershipBusinessKey } from "../src/project-membership.js";

assert.doesNotThrow(() => assertMembershipTransition("pending", "active"));
assert.doesNotThrow(() => assertMembershipTransition("pending", "withdrawn"));
assert.doesNotThrow(() => assertMembershipTransition("active", "ended"));
assert.throws(() => assertMembershipTransition("ended", "active"), /新的关系段/);
assert.equal(membershipBusinessKey("p", "u", "segment"), membershipBusinessKey("p", "u", "segment"));
console.log("PROJECT_MEMBERSHIP_POLICY_OK");
