import assert from "node:assert/strict";
import { assertSensitiveTokenScope } from "../src/sensitive-token-scope.js";

const expected = { targetPersonId: "person-a", field: "nationalId", action: "read" } as const;

assert.doesNotThrow(() => assertSensitiveTokenScope({ sensitiveTargetPersonId: "person-a", sensitiveField: "nationalId", sensitiveAction: "read" }, expected));
assert.throws(() => assertSensitiveTokenScope({ sensitiveTargetPersonId: "person-b", sensitiveField: "nationalId", sensitiveAction: "read" }, expected));
assert.throws(() => assertSensitiveTokenScope({ sensitiveTargetPersonId: "person-a", sensitiveField: "photo", sensitiveAction: "read" }, expected));
assert.throws(() => assertSensitiveTokenScope({ sensitiveTargetPersonId: "person-a", sensitiveField: "nationalId", sensitiveAction: "update" }, expected));
assert.throws(() => assertSensitiveTokenScope({}, expected));

console.log("SENSITIVE_TOKEN_SCOPE_OK");
