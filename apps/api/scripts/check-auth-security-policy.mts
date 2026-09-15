import assert from "node:assert/strict";
import {
  assertPasswordAllowed,
  decidePasswordFailure,
  securityHash,
  sessionAbsoluteTtlMs,
  smsRateDecision
} from "../src/auth-security.js";

assert.equal(sessionAbsoluteTtlMs("web"), 8 * 60 * 60 * 1000);
assert.equal(sessionAbsoluteTtlMs("miniprogram"), 30 * 24 * 60 * 60 * 1000);
assert.equal(securityHash("same", "secret"), securityHash("same", "secret"));
assert.notEqual(securityHash("same", "secret"), securityHash("different", "secret"));
assert.equal(securityHash("same", "secret").length, 64);

assert.throws(() => assertPasswordAllowed("short", {}), (error: unknown) => error instanceof Error && "code" in error && error.code === "PASSWORD_TOO_SHORT");
assert.throws(() => assertPasswordAllowed("x".repeat(129), {}), (error: unknown) => error instanceof Error && "code" in error && error.code === "PASSWORD_TOO_LONG");
assert.throws(() => assertPasswordAllowed("safety.admin", { username: "Safety.Admin" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "PASSWORD_MATCHES_IDENTITY");
assert.throws(() => assertPasswordAllowed("13800138000", { phone: "13800138000" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "PASSWORD_MATCHES_IDENTITY");
assert.throws(() => assertPasswordAllowed("张安全张安全张安全", { name: "张安全张安全张安全" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "PASSWORD_MATCHES_IDENTITY");
assert.doesNotThrow(() => assertPasswordAllowed("correct horse battery staple", { username: "safety.admin", phone: "13800138000", name: "张安全" }));

const now = new Date("2026-09-15T00:00:00.000Z");
assert.deepEqual(decidePasswordFailure(4, now), { failedCount: 5, lockedUntil: new Date("2026-09-15T00:15:00.000Z") });
assert.deepEqual(decidePasswordFailure(1, now), { failedCount: 2, lockedUntil: null });

assert.equal(smsRateDecision({ lastMinute: 1, lastFifteenMinutes: 1, lastDay: 1 }), "minute");
assert.equal(smsRateDecision({ lastMinute: 0, lastFifteenMinutes: 5, lastDay: 5 }), "fifteen_minutes");
assert.equal(smsRateDecision({ lastMinute: 0, lastFifteenMinutes: 4, lastDay: 10 }), "day");
assert.equal(smsRateDecision({ lastMinute: 0, lastFifteenMinutes: 4, lastDay: 9 }), null);

console.log("AUTH_SECURITY_POLICY_OK");
