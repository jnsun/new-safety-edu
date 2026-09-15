import assert from "node:assert/strict";
import { assertPersonChangeRequestAllowed, canReviewPersonChange } from "../src/person-change-policy.js";

assert.doesNotThrow(() => assertPersonChangeRequestAllowed({ requestType: "contractor_unit_change", currentPersonType: "contractor" }));
assert.throws(() => assertPersonChangeRequestAllowed({ requestType: "contractor_unit_change", currentPersonType: "employee" }));
assert.throws(() => assertPersonChangeRequestAllowed({ requestType: "responsible_entity_change", currentPersonType: "employee" }));
assert.throws(() => assertPersonChangeRequestAllowed({ requestType: "identity_correction", currentPersonType: "employee", nextPersonType: "employee" }));
assert.equal(canReviewPersonChange({ requestType: "identity_correction", isCompanyAdmin: false, leaderOrganizationIds: new Set(["org-a"]) }), false);
assert.equal(canReviewPersonChange({ requestType: "contractor_unit_change", isCompanyAdmin: false, leaderOrganizationIds: new Set(["org-a"]), currentOrganizationId: "org-a" }), true);
assert.equal(canReviewPersonChange({ requestType: "contractor_unit_change", isCompanyAdmin: false, leaderOrganizationIds: new Set(["org-b"]), currentOrganizationId: "org-a" }), false);
assert.equal(canReviewPersonChange({ requestType: "responsible_entity_change", isCompanyAdmin: false, leaderOrganizationIds: new Set(["org-b"]), targetOrganizationId: "org-b" }), true);
assert.equal(canReviewPersonChange({ requestType: "identity_correction", isCompanyAdmin: true, leaderOrganizationIds: new Set() }), true);
console.log("PERSON_CHANGE_POLICY_OK");
