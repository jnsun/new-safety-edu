import assert from "node:assert/strict";
import { canEnterSafetySystem, platformConditionalModule, resolvePlatformLanding } from "../src/platform-access.js";

assert.equal(platformConditionalModule(false), "incident");
assert.equal(platformConditionalModule(true), "receivables");
assert.equal(canEnterSafetySystem([{ role: "field_reporter" }]), true);
assert.equal(canEnterSafetySystem([{ role: "learner" }]), false);
assert.deepEqual(resolvePlatformLanding({ canEnterSafety: true, receivablesMode: "enabled" }), { kind: "choose" });
assert.deepEqual(resolvePlatformLanding({ canEnterSafety: true, receivablesMode: "hidden" }), { kind: "redirect", path: "/safety" });
assert.deepEqual(resolvePlatformLanding({ canEnterSafety: false, receivablesMode: "enabled" }), { kind: "redirect", path: "/receivables" });
assert.deepEqual(resolvePlatformLanding({ canEnterSafety: false, receivablesMode: "confirm" }), { kind: "redirect", path: "/receivables/departments" });
assert.deepEqual(resolvePlatformLanding({ canEnterSafety: false, receivablesMode: "hidden" }), { kind: "denied" });

console.log("PLATFORM_ACCESS_OK");
