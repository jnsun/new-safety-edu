import assert from "node:assert/strict";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { encryptNationalId } from "../src/crypto.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
const baseUrl = process.env.SENSITIVE_PROFILE_API_BASE_URL ?? "http://127.0.0.1:55446";
assert.match(databaseUrl, /sensitive_profile_test/i, "Refusing to run outside isolated sensitive_profile_test database");
const prisma = new PrismaClient();
const request = (path: string, init: RequestInit = {}) => fetch(`${baseUrl}${path}`, init);
const authRequest = (path: string, token: string, init: RequestInit = {}) => request(path, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });

try {
  const env = { FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY! };
  const company = await prisma.organization.create({ data: { name: "敏感显露验证公司", type: "company" } });
  const department = await prisma.organization.create({ data: { name: "验证部门", type: "department", parentId: company.id } });
  const first = await prisma.person.create({ data: { name: "验证人员甲", phone: "19900000501", type: "employee", status: "active", nationalIdLast4: "1234", ...encryptNationalId("110101199001011234", env), organizations: { create: { organizationId: department.id, primary: true } } } });
  const second = await prisma.person.create({ data: { name: "验证人员乙", phone: "19900000502", type: "employee", status: "active", nationalIdLast4: "5678", ...encryptNationalId("110101199001015678", env), organizations: { create: { organizationId: department.id, primary: true } } } });
  const managerPassword = "SensitiveProfile!234";
  const managerPerson = await prisma.person.create({ data: { name: "验证管理员", phone: "19900000503", type: "employee", status: "active", organizations: { create: { organizationId: department.id, primary: true } } } });
  await prisma.account.create({ data: { username: "profile-manager", usernameNormalized: "profile-manager", passwordHash: await argon2.hash(managerPassword), passwordLoginEnabled: true, personId: managerPerson.id, roles: { create: { personId: managerPerson.id, role: "org_admin", scopeType: "organization", scopeId: department.id } } } });
  const selfAccount = await prisma.account.create({ data: { personId: first.id, wechatBindings: { create: { appId: "development", openid: "dev-profile-user" } } } });

  const login = await request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "profile-manager", password: managerPassword }) });
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.equal(login.status, 200); assert.ok(cookie);
  const grant = await request(`/api/persons/${first.id}/sensitive-access`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ password: managerPassword }) });
  assert.equal(grant.status, 200);
  const scopedToken = (await grant.json() as { data: { token: string } }).data.token;
  assert.equal((await request(`/api/persons/${first.id}/sensitive`, { headers: { cookie, "x-sensitive-token": scopedToken } })).status, 200);
  assert.equal((await request(`/api/persons/${second.id}/sensitive`, { headers: { cookie, "x-sensitive-token": scopedToken } })).status, 401);

  const wxLogin = await request("/api/wechat/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "dev:profile-user" }) });
  assert.equal(wxLogin.status, 200);
  const accessToken = (await wxLogin.json() as { data: { accessToken: string } }).data.accessToken;
  const profile = await authRequest("/api/me/profile", accessToken);
  const profileBody = (await profile.json() as { data: Record<string, unknown> }).data;
  assert.equal(profileBody.nationalId, undefined);
  assert.equal(profileBody.nationalIdMasked, "**************1234");
  const wxGrant = await authRequest("/api/wechat/reauthenticate", accessToken, { method: "POST", body: JSON.stringify({ code: "dev:profile-user" }) });
  assert.equal(wxGrant.status, 200);
  const wxToken = (await wxGrant.json() as { data: { token: string } }).data.token;
  assert.equal((await authRequest("/api/me/profile/sensitive", accessToken, { headers: { "x-sensitive-token": wxToken } })).status, 200);
  assert.equal(await prisma.auditLog.count({ where: { action: { in: ["person.sensitive_access_grant", "person.sensitive_read", "person.self_sensitive_access_grant", "person.self_sensitive_read"] } } }), 4);
  assert.equal((await prisma.account.findUniqueOrThrow({ where: { id: selfAccount.id } })).status, "active");
  console.log("SENSITIVE_PROFILE_SMOKE=PASS");
} finally { await prisma.$disconnect(); }
