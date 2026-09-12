import assert from "node:assert/strict";

const base = process.env.SMOKE_BASE_URL;
assert.ok(base && process.env.SMOKE_USERNAME && process.env.SMOKE_PASSWORD);
const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: process.env.SMOKE_USERNAME, password: process.env.SMOKE_PASSWORD }), signal: AbortSignal.timeout(10_000) });
assert.equal(login.status, 200);
const setCookie = login.headers.get("set-cookie") ?? "";
for (const attribute of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) assert.ok(setCookie.includes(attribute), `Cookie 缺少 ${attribute}`);
const cookie = setCookie.split(";", 1)[0];
assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie }, signal: AbortSignal.timeout(10_000) })).status, 200);
for (const path of ["/../package.json", "/%2e%2e/package.json", "//package.json"]) {
  const response = await fetch(`${base}${path}`, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  const body = await response.text();
  assert.ok(!body.includes("wuhuayuan-safety-education"), `${path} 泄露了工作区文件`);
}
const logout = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie }, signal: AbortSignal.timeout(10_000) });
assert.equal(logout.status, 204); assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);
console.log("PRODUCTION_COOKIE_AUTH=PASS");
