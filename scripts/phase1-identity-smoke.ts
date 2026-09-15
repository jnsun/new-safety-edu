import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { bindAccountToPerson, disablePerson, grantRole, reactivatePerson, revokeRole, setPrimaryOrganization } from "../apps/api/src/identity.js";

const url = process.env.DATABASE_URL ?? "";
assert.match(url, /phase1_test/i, "Refusing to run outside an isolated phase1_test database");
const prisma = new PrismaClient();

async function main() {
try {
  const database = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  assert.match(database[0]!.current_database, /phase1_test/i);

  const company = await prisma.organization.create({ data: { name: "阶段一测试公司", type: "company" } });
  const entityA = await prisma.organization.create({ data: { name: "经营实体甲", type: "business_entity", parentId: company.id } });
  const entityB = await prisma.organization.create({ data: { name: "经营实体乙", type: "business_entity", parentId: company.id } });
  const department = await prisma.organization.create({ data: { name: "职能部门甲", type: "department", parentId: company.id } });
  const person = await prisma.person.create({ data: { name: "匿名测试人员", phone: "19900000001", type: "employee", status: "active" } });
  const account = await prisma.account.create({ data: { personId: person.id, username: "phase1-person", status: "active" } });

  await prisma.$transaction((tx) => setPrimaryOrganization(tx, { personId: person.id, organizationId: entityA.id, actorId: account.id, reason: "初始归属" }));
  await prisma.$transaction((tx) => setPrimaryOrganization(tx, { personId: person.id, organizationId: entityB.id, actorId: account.id, reason: "组织调换" }));
  const memberships = await prisma.organizationMembership.findMany({ where: { personId: person.id }, orderBy: { createdAt: "asc" } });
  assert.equal(memberships.length, 2);
  assert.equal(memberships.filter((row) => row.active && row.primary).length, 1);
  assert.equal(memberships[0]!.active, false);
  assert.ok(memberships[0]!.endedAt);

  await assert.rejects(() => prisma.organizationMembership.create({ data: { personId: person.id, organizationId: entityA.id, active: true, primary: true } }));

  const leaderA = await prisma.account.create({ data: { username: "phase1-leader-a" } });
  const leaderB = await prisma.account.create({ data: { username: "phase1-leader-b" } });
  const firstLeader = await prisma.$transaction((tx) => grantRole(tx, { accountId: leaderA.id, role: "org_leader", scopeType: "organization", scopeId: entityA.id }));
  await assert.rejects(() => prisma.$transaction((tx) => grantRole(tx, { accountId: leaderB.id, role: "org_leader", scopeType: "organization", scopeId: entityA.id })));
  await prisma.$transaction((tx) => revokeRole(tx, { roleId: firstLeader.id, actorId: account.id, reason: "更换负责人" }));
  await prisma.$transaction((tx) => grantRole(tx, { accountId: leaderB.id, role: "org_leader", scopeType: "organization", scopeId: entityA.id }));
  assert.equal(await prisma.roleAssignment.count({ where: { scopeId: entityA.id, role: "org_leader", active: true } }), 1);
  assert.equal(await prisma.roleAssignment.count({ where: { scopeId: entityA.id, role: "org_leader", active: false } }), 1);

  const project = await prisma.project.create({ data: { name: "阶段一隔离项目", code: "PHASE1-ONLY", responsibleOrganizationId: entityB.id } });
  await prisma.projectMember.create({ data: { projectId: project.id, personId: person.id, status: "active" } });
  const batch = await prisma.trainingBatch.create({ data: { businessKey: "phase1-disable", name: "阶段一隔离培训", type: "routine" } });
  await prisma.trainingAssignment.create({ data: { batchId: batch.id, personId: person.id, status: "pending_learning" } });
  await prisma.refreshSession.create({ data: { accountId: account.id, tokenHash: "phase1-token", expiresAt: new Date(Date.now() + 86_400_000) } });
  await prisma.$transaction((tx) => grantRole(tx, { accountId: account.id, role: "project_admin", scopeType: "project", scopeId: project.id }));
  await prisma.$transaction((tx) => disablePerson(tx, { personId: person.id, actorId: leaderB.id, reason: "隔离验证停用" }));
  assert.equal((await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).status, "disabled");
  assert.equal(await prisma.refreshSession.count({ where: { accountId: account.id, revokedAt: null } }), 0);
  assert.equal(await prisma.roleAssignment.count({ where: { accountId: account.id, active: true } }), 0);
  assert.equal((await prisma.projectMember.findFirstOrThrow({ where: { personId: person.id } })).status, "removed");
  assert.equal((await prisma.trainingAssignment.findFirstOrThrow({ where: { personId: person.id } })).status, "cancelled");

  await prisma.$transaction((tx) => reactivatePerson(tx, { personId: person.id }));
  const activeRoles = await prisma.roleAssignment.findMany({ where: { accountId: account.id, active: true } });
  assert.deepEqual(activeRoles.map((row) => row.role), ["learner"]);

  const source = await prisma.account.create({ data: {} });
  await prisma.$transaction((tx) => grantRole(tx, { accountId: source.id, role: "learner", scopeType: "person", scopeId: person.id }));
  const collision = await prisma.$transaction((tx) => bindAccountToPerson(tx, { currentAccountId: source.id, personId: person.id, reason: "隔离账号冲突验证" }));
  assert.equal(collision.status, "pending_merge");
  assert.equal(await prisma.account.count({ where: { id: source.id } }), 1);
  const repeated = await prisma.$transaction((tx) => bindAccountToPerson(tx, { currentAccountId: source.id, personId: person.id, reason: "重复请求" }));
  assert.equal(repeated.status, "pending_merge");
  assert.equal(await prisma.changeRequest.count({ where: { accountId: source.id, type: "account_merge", status: "pending" } }), 1);

  const passwordHash = await argon2.hash("Phase1Only!234");
  const companyAdmin = await prisma.account.create({ data: { username: "phase1-admin", passwordHash } });
  const entityAdmin = await prisma.account.create({ data: { username: "phase1-entity", passwordHash } });
  const departmentAdmin = await prisma.account.create({ data: { username: "phase1-department", passwordHash } });
  await prisma.account.update({ where: { id: account.id }, data: { username: "phase1-project", passwordHash } });
  await prisma.$transaction((tx) => grantRole(tx, { accountId: companyAdmin.id, role: "company_admin", scopeType: "company", scopeId: null }));
  await prisma.$transaction((tx) => grantRole(tx, { accountId: entityAdmin.id, role: "org_admin", scopeType: "organization", scopeId: entityB.id }));
  await prisma.$transaction((tx) => grantRole(tx, { accountId: departmentAdmin.id, role: "org_admin", scopeType: "organization", scopeId: department.id }));
  await prisma.$transaction((tx) => grantRole(tx, { accountId: account.id, role: "project_admin", scopeType: "project", scopeId: project.id }));
  await prisma.person.create({ data: { name: "待删除空档案", phone: "19900000002", type: "employee", status: "pending" } });

  console.log("PHASE1_IDENTITY_SMOKE=PASS");
} finally {
  await prisma.$disconnect();
}
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
