import assert from "node:assert/strict";
import { assertFirstReleaseEmployee, assertFirstReleaseWorkflowAllowed } from "../src/first-release-policy.js";

assert.doesNotThrow(() => assertFirstReleaseEmployee("employee"));
assert.throws(() => assertFirstReleaseEmployee("contractor"), { code: "FIRST_RELEASE_EMPLOYEE_ONLY", statusCode: 403 });
assert.throws(() => assertFirstReleaseEmployee("temporary_individual"), { code: "FIRST_RELEASE_EMPLOYEE_ONLY", statusCode: 403 });
assert.doesNotThrow(() => assertFirstReleaseWorkflowAllowed("profile_change"));
assert.doesNotThrow(() => assertFirstReleaseWorkflowAllowed("department_transfer"));
assert.throws(() => assertFirstReleaseWorkflowAllowed("registration"), { code: "FIRST_RELEASE_EMPLOYEE_ONLY", statusCode: 403 });
assert.throws(() => assertFirstReleaseWorkflowAllowed("identity_correction"), { code: "FIRST_RELEASE_EMPLOYEE_ONLY", statusCode: 403 });
assert.throws(() => assertFirstReleaseWorkflowAllowed("contractor_unit_change"), { code: "FIRST_RELEASE_EMPLOYEE_ONLY", statusCode: 403 });
assert.throws(() => assertFirstReleaseWorkflowAllowed("responsible_entity_change"), { code: "FIRST_RELEASE_EMPLOYEE_ONLY", statusCode: 403 });

console.log("FIRST_RELEASE_POLICY_OK");
