import assert from "node:assert/strict";
import { nextQuestionVersion, questionVersionSnapshot } from "../src/question-versions.js";
import { coursewareViewerHeaders } from "../src/courseware-viewer-policy.js";
import { canPublishCourseware } from "../src/courseware-publish-policy.js";

assert.equal(nextQuestionVersion(1), 2);
const source = { id: "q1", version: 3, type: "single_choice", prompt: "题干", options: ["A", "B"], correct: ["A"], explanation: null } as const;
assert.deepEqual(questionVersionSnapshot(source, 5), { id: "q1", questionVersionId: "q1", questionVersion: 3, type: "single_choice", prompt: "题干", options: ["A", "B"], correct: ["A"], score: 5 });
const headers = coursewareViewerHeaders();
assert.match(headers["Content-Security-Policy"], /connect-src 'none'/);
assert.match(headers["Content-Security-Policy"], /form-action 'none'/);
assert.equal(headers["Referrer-Policy"], "no-referrer");
assert.equal(canPublishCourseware([{ role: "company_admin", scopeType: "company", scopeId: null }], [], { scopeType: "organization", scopeId: "o1" }), true);
assert.equal(canPublishCourseware([{ role: "org_admin", scopeType: "organization", scopeId: "o1" }], [], { scopeType: "organization", scopeId: "o1" }), false);
assert.equal(canPublishCourseware([{ role: "org_admin", scopeType: "organization", scopeId: "o1" }], [{ scopeType: "organization", scopeId: "o1" }], { scopeType: "organization", scopeId: "o1" }), true);
console.log("TRAINING_GOVERNANCE_OK");
