import assert from "node:assert/strict";

Object.defineProperty(globalThis, "document", { value: { cookie: "safety_csrf=csrf-test-token" } });

let captured: RequestInit | undefined;
Object.defineProperty(globalThis, "fetch", {
  value: async (_path: string, init?: RequestInit) => {
    captured = init;
    return new Response(null, { status: 204 });
  }
});

const { api } = await import("../apps/admin/src/api.ts");
await api("/api/auth/logout", { method: "POST" });

assert.equal(new Headers(captured?.headers).get("content-type"), "application/json");
assert.equal(new Headers(captured?.headers).get("x-csrf-token"), "csrf-test-token");
console.log("ADMIN_API_CHECK=PASS");
