import assert from "node:assert/strict";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
const baseUrl = process.env.ACCOUNT_LIFECYCLE_API_BASE_URL ?? "http://127.0.0.1:55440";
assert.match(databaseUrl, /account_lifecycle_test/i, "Refusing to run outside an isolated account_lifecycle_test database");
const prisma = new PrismaClient();

const request = (path: string, cookie?: string, init: RequestInit = {}) => fetch(`${baseUrl}${path}`, {
  ...init,
  headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...init.headers }
});

async function login(username: string, password: string) {
  const response = await request("/api/auth/login", undefined, { method: "POST", body: JSON.stringify({ username, password }) });
  const setCookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  return { response, cookie: setCookies[0]?.split(";", 1)[0], cookies: setCookies.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ") };
}

try {
  const passwordHash = await argon2.hash("AccountTest!234");
  const company = await prisma.organization.create({ data: { name: "账号验证公司", type: "company" } });
  const department = await prisma.organization.create({ data: { name: "账号验证部门", type: "department", parentId: company.id } });
  const adminPerson = await prisma.person.create({ data: { name: "账号验证管理员", phone: "19900000101", type: "employee", status: "active", organizations: { create: { organizationId: department.id, primary: true } } } });
  const targetPerson = await prisma.person.create({ data: { name: "账号验证目标", phone: "19900000102", type: "employee", status: "active", organizations: { create: { organizationId: department.id, primary: true } } } });
  const admin = await prisma.account.create({ data: { username: "account-admin", usernameNormalized: "account-admin", passwordHash, passwordLoginEnabled: true, personId: adminPerson.id, roles: { create: { personId: adminPerson.id, role: "company_admin", scopeType: "company" } } } });
  const target = await prisma.account.create({ data: { username: "account-target", usernameNormalized: "account-target", passwordHash, passwordLoginEnabled: true, verifiedPhone: "19900000102", personId: targetPerson.id, roles: { create: { personId: targetPerson.id, role: "org_admin", scopeType: "organization", scopeId: department.id } } } });
  const empty = await prisma.account.create({ data: { username: "mistake-empty", usernameNormalized: "mistake-empty", passwordHash, passwordLoginEnabled: true, status: "pending" } });

  const adminLogin = await login("ACCOUNT-ADMIN", "AccountTest!234");
  assert.equal(adminLogin.response.status, 200);
  assert.ok(adminLogin.cookie);
  const cookie = adminLogin.cookie!;

  const listed = await request("/api/accounts", cookie);
  assert.equal(listed.status, 200);
  const accounts = (await listed.json() as { data: Array<{ id: string; person: { name: string } | null; verifiedPhoneMasked: string | null; loginMethods: { password: boolean; phone: boolean; wechat: boolean } }> }).data;
  const targetRow = accounts.find((account) => account.id === target.id);
  assert.equal(targetRow?.person?.name, "账号验证目标");
  assert.equal(targetRow?.verifiedPhoneMasked, "199****0102");
  assert.deepEqual(targetRow?.loginMethods, { password: true, phone: true, wechat: false });

  assert.equal((await request(`/api/accounts/${target.id}/username`, cookie, { method: "PATCH", body: JSON.stringify({ username: "Account-Renamed", reason: "验证用户名修改" }) })).status, 204);
  assert.equal((await login("account-target", "AccountTest!234")).response.status, 401);
  assert.equal((await login("ACCOUNT-RENAMED", "AccountTest!234")).response.status, 200);

  assert.equal((await request(`/api/accounts/${target.id}/status`, cookie, { method: "POST", body: JSON.stringify({ status: "disabled", reason: "验证停用" }) })).status, 204);
  assert.equal((await login("account-renamed", "AccountTest!234")).response.status, 401);
  assert.equal((await request(`/api/accounts/${target.id}/status`, cookie, { method: "POST", body: JSON.stringify({ status: "active", reason: "验证启用" }) })).status, 204);

  assert.equal((await request(`/api/accounts/${target.id}/reset-password`, cookie, { method: "POST", body: JSON.stringify({ newPassword: "Temporary!234" }) })).status, 204);
  const temporaryLogin = await login("account-renamed", "Temporary!234");
  assert.equal(temporaryLogin.response.status, 200);
  assert.ok(temporaryLogin.cookie);
  const me = await request("/api/auth/me", temporaryLogin.cookie);
  assert.equal(me.status, 200);
  assert.equal((await me.json() as { data: { mustChangePassword: boolean } }).data.mustChangePassword, true);
  const blocked = await request("/api/organizations", temporaryLogin.cookie);
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json() as { error: { code: string } }).error.code, "PASSWORD_CHANGE_REQUIRED");
  assert.equal((await request("/api/auth/change-password", temporaryLogin.cookie, { method: "POST", body: JSON.stringify({ currentPassword: "Temporary!234", newPassword: "ChangedAgain!234" }) })).status, 204);
  const changedLogin = await login("account-renamed", "ChangedAgain!234");
  assert.equal(changedLogin.response.status, 200);
  assert.equal((await request("/api/organizations", changedLogin.cookie)).status, 200);

  const secondDevice = await login("account-renamed", "ChangedAgain!234");
  assert.equal(secondDevice.response.status, 200);
  assert.equal((await request("/api/auth/logout", changedLogin.cookie, { method: "POST" })).status, 204);
  assert.equal((await request("/api/auth/me", changedLogin.cookie)).status, 401);
  assert.equal((await request("/api/auth/me", secondDevice.cookie)).status, 200);
  assert.equal((await request("/api/auth/logout-all", secondDevice.cookie, { method: "POST" })).status, 204);
  assert.equal((await request("/api/auth/me", secondDevice.cookie)).status, 401);

  const adminSensitive = await request("/api/auth/reauthenticate", cookie, { method: "POST", body: JSON.stringify({ password: "AccountTest!234" }) });
  assert.equal(adminSensitive.status, 200);
  const sensitiveToken = (await adminSensitive.json() as { data: { token: string } }).data.token;
  assert.equal((await request(`/api/accounts/${admin.id}/login-methods/password`, cookie, { method: "DELETE", headers: { "x-sensitive-token": sensitiveToken }, body: JSON.stringify({ reason: "验证最后管理员登录保护" }) })).status, 409);
  assert.equal((await request(`/api/accounts/${target.id}/login-methods/phone`, cookie, { method: "DELETE", headers: { "x-sensitive-token": sensitiveToken }, body: JSON.stringify({ reason: "验证解除手机号登录" }) })).status, 204);
  assert.equal((await prisma.account.findUniqueOrThrow({ where: { id: target.id } })).verifiedPhone, null);

  const mergeSource = await prisma.account.create({ data: { status: "active", verifiedPhone: "19900000103", preferences: { create: { key: "merge-test", value: { enabled: true } } }, wechatBindings: { create: { appId: "merge-test-app", openid: "merge-test-openid", boundAt: new Date() } } } });
  const sourceSession = await prisma.refreshSession.create({ data: { accountId: mergeSource.id, tokenHash: "merge-source-session-hash", expiresAt: new Date(Date.now() + 3600_000) } });
  const mergeBody = { sourceAccountId: mergeSource.id, targetAccountId: target.id, reason: "验证重复账号合并" };
  const firstMergeRequest = await request("/api/account-merge-requests", cookie, { method: "POST", headers: { "x-sensitive-token": sensitiveToken }, body: JSON.stringify(mergeBody) });
  assert.equal(firstMergeRequest.status, 201);
  const mergeRequestId = (await firstMergeRequest.json() as { data: { id: string } }).data.id;
  const repeatedMergeRequest = await request("/api/account-merge-requests", cookie, { method: "POST", headers: { "x-sensitive-token": sensitiveToken }, body: JSON.stringify(mergeBody) });
  assert.equal(repeatedMergeRequest.status, 201);
  assert.equal((await repeatedMergeRequest.json() as { data: { id: string } }).data.id, mergeRequestId);
  assert.equal((await request(`/api/management/requests/${mergeRequestId}/approve`, cookie, { method: "POST", headers: { "x-sensitive-token": sensitiveToken }, body: JSON.stringify({ note: "确认合并重复登录身份" }) })).status, 200);
  const [mergedSource, mergedTarget, movedBinding, movedPreference, revokedSourceSession, mergeAudit] = await Promise.all([
    prisma.account.findUniqueOrThrow({ where: { id: mergeSource.id } }),
    prisma.account.findUniqueOrThrow({ where: { id: target.id } }),
    prisma.wechatBinding.findUniqueOrThrow({ where: { appId_openid: { appId: "merge-test-app", openid: "merge-test-openid" } } }),
    prisma.userPreference.findUniqueOrThrow({ where: { accountId_key: { accountId: target.id, key: "merge-test" } } }),
    prisma.refreshSession.findUniqueOrThrow({ where: { id: sourceSession.id } }),
    prisma.auditLog.findFirst({ where: { action: "account.merge", objectId: mergeSource.id } })
  ]);
  assert.equal(mergedSource.status, "merged");
  assert.equal(mergedSource.mergedIntoAccountId, target.id);
  assert.equal(mergedSource.personId, null);
  assert.equal(mergedTarget.personId, targetPerson.id);
  assert.equal(mergedTarget.verifiedPhone, "19900000103");
  assert.equal(movedBinding.accountId, target.id);
  assert.deepEqual(movedPreference.value, { enabled: true });
  assert.ok(revokedSourceSession.revokedAt);
  assert.ok(mergeAudit);

  assert.equal((await request(`/api/accounts/${empty.id}`, cookie, { method: "DELETE", body: JSON.stringify({ reason: "验证删除误建空账号" }) })).status, 204);
  assert.equal(await prisma.account.count({ where: { id: empty.id } }), 0);
  assert.equal((await request(`/api/accounts/${target.id}`, cookie, { method: "DELETE", body: JSON.stringify({ reason: "验证引用保护" }) })).status, 409);
  assert.equal((await request(`/api/accounts/${admin.id}/status`, cookie, { method: "POST", body: JSON.stringify({ status: "disabled", reason: "验证自身保护" }) })).status, 409);

  const rotationLogin = await login("account-admin", "AccountTest!234");
  const rotated = await request("/api/auth/refresh", rotationLogin.cookies, { method: "POST", body: "{}" });
  assert.equal(rotated.status, 200);
  assert.equal((await request("/api/auth/me", rotationLogin.cookie)).status, 401);
  const rotatedSetCookies = (rotated.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const rotatedCookies = rotatedSetCookies.map((value) => value.split(";", 1)[0]).join("; ");
  assert.equal((await request("/api/auth/me", rotatedCookies)).status, 200);
  assert.equal((await request("/api/auth/refresh", rotationLogin.cookies, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await request("/api/auth/me", rotatedCookies)).status, 401);

  console.log("ACCOUNT_LIFECYCLE_SMOKE=PASS");
} finally {
  await prisma.$disconnect();
}
