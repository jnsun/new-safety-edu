import assert from "node:assert/strict";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
const baseUrl = process.env.PERSON_ROLE_API_BASE_URL ?? "http://127.0.0.1:55443";
assert.match(databaseUrl, /person_role_test/i, "Refusing to run outside an isolated person_role_test database");
const prisma = new PrismaClient();

const request = (path: string, cookie?: string, init: RequestInit = {}) => fetch(`${baseUrl}${path}`, {
  ...init,
  headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...init.headers }
});

async function login(username: string, password: string) {
  const response = await request("/api/auth/login", undefined, { method: "POST", body: JSON.stringify({ username, password }) });
  return { response, cookie: response.headers.get("set-cookie")?.split(";", 1)[0] };
}

try {
  const passwordHash = await argon2.hash("PersonRole!234");
  const company = await prisma.organization.create({ data: { name: "人员角色验证公司", type: "company" } });
  const department = await prisma.organization.create({ data: { name: "人员角色验证部门", type: "department", parentId: company.id } });
  const entity = await prisma.organization.create({ data: { name: "人员角色验证经营实体", type: "business_entity", parentId: company.id } });
  const adminPerson = await prisma.person.create({ data: { name: "人员角色验证管理员", phone: "19900000201", type: "employee", status: "active", organizations: { create: { organizationId: department.id, primary: true } } } });
  const pendingPerson = await prisma.person.create({ data: { name: "人员角色待激活", phone: "19900000202", type: "employee", status: "active", organizations: { create: { organizationId: department.id, primary: true } } } });
  const projectPerson = await prisma.person.create({ data: { name: "人员角色项目管理员", phone: "19900000203", type: "employee", status: "active", organizations: { create: { organizationId: entity.id, primary: true } } } });
  const project = await prisma.project.create({ data: { name: "人员角色验证项目", code: "PERSON-ROLE-001", responsibleOrganizationId: entity.id } });
  await prisma.account.create({ data: { username: "person-role-admin", usernameNormalized: "person-role-admin", passwordHash, passwordLoginEnabled: true, personId: adminPerson.id, roles: { create: { personId: adminPerson.id, role: "company_admin", scopeType: "company" } } } });

  const adminLogin = await login("person-role-admin", "PersonRole!234");
  assert.equal(adminLogin.response.status, 200);
  assert.ok(adminLogin.cookie);
  const adminCookie = adminLogin.cookie!;

  const selfGrant = await request("/api/roles", adminCookie, { method: "POST", body: JSON.stringify({ personId: adminPerson.id, role: "org_admin", scopeType: "organization", scopeId: department.id, reason: "不能向本人授予组织管理角色" }) });
  assert.equal(selfGrant.status, 409);
  assert.equal((await selfGrant.json() as { error?: { code?: string } }).error?.code, "ROLE_SELF_GRANT_FORBIDDEN");

  const grant = await request("/api/roles", adminCookie, { method: "POST", body: JSON.stringify({ personId: pendingPerson.id, role: "org_admin", scopeType: "organization", scopeId: department.id, reason: "验证待账号激活授权" }) });
  assert.equal(grant.status, 201);
  const role = (await grant.json() as { data: { id: string; active: boolean; activationPending: boolean; accountId: string | null } }).data;
  assert.equal(role.active, false);
  assert.equal(role.activationPending, true);
  assert.equal(role.accountId, null);

  const learner = await request("/api/roles", adminCookie, { method: "POST", body: JSON.stringify({ personId: pendingPerson.id, role: "learner", scopeType: "person", scopeId: pendingPerson.id, reason: "不应允许" }) });
  assert.equal(learner.status, 400);

  const departmentProjectAdmin = await request("/api/roles", adminCookie, { method: "POST", body: JSON.stringify({ personId: pendingPerson.id, role: "project_admin", scopeType: "project", scopeId: project.id, reason: "验证普通部门人员限制" }) });
  assert.equal(departmentProjectAdmin.status, 409);
  const projectAdmin = await request("/api/roles", adminCookie, { method: "POST", body: JSON.stringify({ personId: projectPerson.id, role: "project_admin", scopeType: "project", scopeId: project.id, reason: "验证项目管理员自动入组" }) });
  assert.equal(projectAdmin.status, 201);
  assert.equal(await prisma.projectMember.count({ where: { projectId: project.id, personId: projectPerson.id, status: "active" } }), 1);

  const createAccount = await request("/api/accounts", adminCookie, { method: "POST", body: JSON.stringify({ username: "person-role-target", password: "Temporary!234", personId: pendingPerson.id }) });
  assert.equal(createAccount.status, 201);
  const activated = await prisma.roleAssignment.findUniqueOrThrow({ where: { id: role.id } });
  assert.equal(activated.active, true);
  assert.equal(activated.activationPending, false);
  assert.ok(activated.accountId);

  const temporaryLogin = await login("person-role-target", "Temporary!234");
  assert.equal(temporaryLogin.response.status, 200);
  assert.ok(temporaryLogin.cookie);
  assert.equal((await request("/api/auth/change-password", temporaryLogin.cookie, { method: "POST", body: JSON.stringify({ currentPassword: "Temporary!234", newPassword: "PersonRoleNew!234" }) })).status, 204);
  const targetLogin = await login("person-role-target", "PersonRoleNew!234");
  assert.equal(targetLogin.response.status, 200);
  assert.ok(targetLogin.cookie);
  const me = await request("/api/auth/me", targetLogin.cookie);
  assert.equal(me.status, 200);
  assert.ok((await me.json() as { data: { roles: Array<{ role: string }> } }).data.roles.some((item) => item.role === "org_admin"));

  assert.equal((await request(`/api/roles/${role.id}`, adminCookie, { method: "DELETE", body: JSON.stringify({ reason: "验证角色撤销" }) })).status, 204);
  assert.equal((await request("/api/auth/me", targetLogin.cookie)).status, 401);
  const revoked = await prisma.roleAssignment.findUniqueOrThrow({ where: { id: role.id } });
  assert.equal(revoked.active, false);
  assert.equal(revoked.endReason, "验证角色撤销");

  console.log("PERSON_ROLE_SMOKE=PASS");
} finally {
  await prisma.$disconnect();
}
