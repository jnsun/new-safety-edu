import assert from "node:assert/strict";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
const baseUrl = process.env.PERSON_MERGE_API_BASE_URL ?? "http://127.0.0.1:55442";
assert.match(databaseUrl, /person_merge_test/i, "Refusing to run outside an isolated person_merge_test database");
const prisma = new PrismaClient();

const request = (path: string, cookie?: string, init: RequestInit = {}) => fetch(`${baseUrl}${path}`, {
  ...init,
  headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...init.headers }
});

try {
  const password = "PersonMergeTest!234";
  const passwordHash = await argon2.hash(password);
  const company = await prisma.organization.create({ data: { name: "人员合并验证公司", type: "company" } });
  const department = await prisma.organization.create({ data: { name: "人员合并验证部门", type: "department", parentId: company.id } });
  const adminPerson = await prisma.person.create({ data: { name: "人员合并验证管理员", phone: "19900000201", type: "employee", status: "active", organizations: { create: { organizationId: department.id, primary: true } } } });
  const source = await prisma.person.create({ data: { name: "重复来源档案", phone: "19900000202", type: "employee", status: "disabled", organizations: { create: { organizationId: department.id, primary: true } }, roleAssignments: { create: [{ role: "org_admin", scopeType: "organization", scopeId: department.id, active: false, activationPending: true }, { role: "field_reporter", scopeType: "organization", scopeId: department.id, active: false, activationPending: true }] }, notifications: { create: { title: "待迁移提醒", body: "仅用于隔离验证" } }, certificates: { create: { name: "待迁移证照" } } } });
  const target = await prisma.person.create({ data: { name: "保留主档案", phone: "19900000202", type: "employee", status: "active", nationalIdHash: "a".repeat(64), nationalIdLast4: "0202", organizations: { create: { organizationId: department.id, primary: true } } } });
  const admin = await prisma.account.create({ data: { username: "person-merge-admin", usernameNormalized: "person-merge-admin", passwordHash, passwordLoginEnabled: true, personId: adminPerson.id, roles: { create: { personId: adminPerson.id, role: "company_admin", scopeType: "company" } } } });
  await prisma.account.create({ data: { username: "person-merge-target", usernameNormalized: "person-merge-target", passwordHash, passwordLoginEnabled: true, personId: target.id, roles: { create: { personId: target.id, role: "org_admin", scopeType: "organization", scopeId: department.id } } } });
  const pendingBatch = await prisma.trainingBatch.create({ data: { businessKey: "person-merge-pending", name: "待迁移培训", type: "routine", assignments: { create: { personId: source.id, status: "pending_learning" } } } });
  const completedBatch = await prisma.trainingBatch.create({ data: { businessKey: "person-merge-completed", name: "历史培训", type: "routine", assignments: { create: { personId: source.id, status: "completed", completedAt: new Date() } } } });

  const login = await request("/api/auth/login", undefined, { method: "POST", body: JSON.stringify({ username: "person-merge-admin", password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  const reauth = await request("/api/auth/reauthenticate", cookie, { method: "POST", body: JSON.stringify({ password }) });
  assert.equal(reauth.status, 200);
  const sensitiveToken = (await reauth.json() as { data: { token: string } }).data.token;
  const body = { sourcePersonId: source.id, targetPersonId: target.id, reason: "隔离验证重复人员档案" };
  const created = await request("/api/person-merge-requests", cookie, { method: "POST", headers: { "x-sensitive-token": sensitiveToken }, body: JSON.stringify(body) });
  assert.equal(created.status, 201);
  const requestId = (await created.json() as { data: { id: string } }).data.id;
  const repeated = await request("/api/person-merge-requests", cookie, { method: "POST", headers: { "x-sensitive-token": sensitiveToken }, body: JSON.stringify(body) });
  assert.equal(repeated.status, 201);
  assert.equal((await repeated.json() as { data: { id: string } }).data.id, requestId);
  const approved = await request(`/api/management/requests/${requestId}/approve`, cookie, { method: "POST", headers: { "x-sensitive-token": sensitiveToken }, body: JSON.stringify({ note: "确认合并隔离测试档案" }) });
  assert.equal(approved.status, 200, await approved.text());

  const [mergedSource, pendingAssignment, completedAssignment, movedNotification, movedCertificate, endedMembership, endedRole, activatedRole, audit] = await Promise.all([
    prisma.person.findUniqueOrThrow({ where: { id: source.id } }),
    prisma.trainingAssignment.findUniqueOrThrow({ where: { batchId_personId: { batchId: pendingBatch.id, personId: target.id } } }),
    prisma.trainingAssignment.findUniqueOrThrow({ where: { batchId_personId: { batchId: completedBatch.id, personId: source.id } } }),
    prisma.notification.findFirstOrThrow({ where: { title: "待迁移提醒" } }),
    prisma.personCertificate.findFirstOrThrow({ where: { name: "待迁移证照" } }),
    prisma.organizationMembership.findFirstOrThrow({ where: { personId: source.id, organizationId: department.id } }),
    prisma.roleAssignment.findFirstOrThrow({ where: { personId: source.id, role: "org_admin" } }),
    prisma.roleAssignment.findFirstOrThrow({ where: { personId: target.id, role: "field_reporter" } }),
    prisma.auditLog.findFirst({ where: { action: "person.merge", objectId: source.id } })
  ]);
  assert.equal(mergedSource.status, "merged");
  assert.equal(mergedSource.mergedIntoPersonId, target.id);
  assert.equal(pendingAssignment.personId, target.id);
  assert.equal(completedAssignment.personId, source.id);
  assert.equal(movedNotification.personId, target.id);
  assert.equal(movedCertificate.personId, target.id);
  assert.equal(endedMembership.active, false);
  assert.equal(endedRole.activationPending, false);
  assert.equal(activatedRole.active, true);
  assert.equal(activatedRole.activationPending, false);
  assert.ok(audit);

  const conflict = await prisma.person.create({ data: { name: "冲突档案", phone: "19900000203", type: "employee", status: "disabled", organizations: { create: { organizationId: department.id, primary: true } } } });
  const blocked = await request("/api/person-merge-requests", cookie, { method: "POST", headers: { "x-sensitive-token": sensitiveToken }, body: JSON.stringify({ sourcePersonId: conflict.id, targetPersonId: target.id, reason: "验证手机号冲突" }) });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json() as { error: { code: string } }).error.code, "PERSON_PHONE_CONFLICT");
  assert.equal(admin.personId, adminPerson.id);
  console.log("PERSON_MERGE_SMOKE=PASS");
} finally {
  await prisma.$disconnect();
}
