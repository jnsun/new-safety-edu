import assert from "node:assert/strict";
import { assertCsrfRequest } from "../src/csrf.js";

const base = {
  method: "POST",
  url: "/api/persons",
  headers: { origin: "https://www.safety.sx.cn", host: "www.safety.sx.cn", "content-type": "application/json", "x-csrf-token": "csrf-token" },
  cookies: { safety_csrf: "csrf-token" },
  publicBaseUrl: "https://www.safety.sx.cn"
};
assert.doesNotThrow(() => assertCsrfRequest(base));
assert.doesNotThrow(() => assertCsrfRequest({ ...base, method: "GET", headers: {}, cookies: {} }));
assert.doesNotThrow(() => assertCsrfRequest({ ...base, headers: { authorization: "Bearer token" }, cookies: {} }));
assert.doesNotThrow(() => assertCsrfRequest({ ...base, url: "/api/auth/login", headers: { "content-type": "application/json" }, cookies: {} }));
assert.doesNotThrow(() => assertCsrfRequest({ ...base, url: "/api/auth/recovery-request", headers: { "content-type": "application/json" }, cookies: {} }));
for (const input of [
  { ...base, cookies: {} },
  { ...base, headers: { ...base.headers, "x-csrf-token": "wrong" } },
  { ...base, headers: { ...base.headers, origin: "https://evil.example" } },
  { ...base, headers: { ...base.headers, "content-type": "text/plain" } }
]) assert.throws(() => assertCsrfRequest(input), (error: unknown) => error instanceof Error && "code" in error && error.code === "CSRF_REJECTED");

console.log("CSRF_POLICY_OK");
