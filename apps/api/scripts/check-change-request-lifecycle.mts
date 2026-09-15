import assert from "node:assert/strict";
import { allowedRequestActions, assertRequestTransition } from "../src/change-requests.js";

assert.deepEqual(allowedRequestActions({ status: "pending", isApplicant: true, isCreator: false, canReview: false, isCompanyAdmin: false }), ["withdraw"]);
assert.deepEqual(allowedRequestActions({ status: "pending", isApplicant: false, isCreator: true, canReview: false, isCompanyAdmin: false }), ["cancel"]);
assert.deepEqual(allowedRequestActions({ status: "pending", isApplicant: false, isCreator: false, canReview: true, isCompanyAdmin: false }), ["approve", "reject"]);
assert.deepEqual(allowedRequestActions({ status: "pending", isApplicant: false, isCreator: false, canReview: true, isCompanyAdmin: true }), ["approve", "reject", "cancel"]);
assert.deepEqual(allowedRequestActions({ status: "approved", isApplicant: true, isCreator: true, canReview: true, isCompanyAdmin: true }), []);
assert.doesNotThrow(() => assertRequestTransition("pending", "withdrawn"));
assert.throws(() => assertRequestTransition("approved", "withdrawn"), /终态/);
console.log("CHANGE_REQUEST_LIFECYCLE_OK");
