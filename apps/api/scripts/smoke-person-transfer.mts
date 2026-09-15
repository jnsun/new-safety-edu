import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { setPrimaryOrganization } from "../src/identity.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assert.match(databaseUrl, /person_transfer_test/i, "Refusing to run outside an isolated person_transfer_test database");
const prisma = new PrismaClient();

try {
  const company = await prisma.organization.create({ data: { name: "调动验证公司", type: "company" } });
  const sourceEntity = await prisma.organization.create({ data: { name: "调动来源实体", type: "business_entity", parentId: company.id } });
  const targetEntity = await prisma.organization.create({ data: { name: "调动目标实体", type: "business_entity", parentId: company.id } });
  const department = await prisma.organization.create({ data: { name: "调动目标部门", type: "department", parentId: company.id } });
  const project = await prisma.project.create({ data: { name: "调动验证项目", code: "TRANSFER-TEST", responsibleOrganizationId: sourceEntity.id } });
  const person = await prisma.person.create({ data: { name: "调动验证人员", phone: "19900000301", type: "employee", status: "active", organizations: { create: { organizationId: sourceEntity.id, primary: true } } } });
  const account = await prisma.account.create({ data: { personId: person.id, status: "active", roles: { create: [{ personId: person.id, role: "org_admin", scopeType: "organization", scopeId: sourceEntity.id }, { personId: person.id, role: "project_admin", scopeType: "project", scopeId: project.id }] }, refreshSessions: { create: { tokenHash: "person-transfer-session", expiresAt: new Date(Date.now() + 3600_000) } } } });
  await prisma.projectMember.create({ data: { projectId: project.id, personId: person.id, status: "active" } });

  await prisma.$transaction((tx) => setPrimaryOrganization(tx, { personId: person.id, organizationId: targetEntity.id, actorId: account.id, reason: "隔离验证调动", actorIsCompanyAdmin: true }));
  const [memberships, roles, member, session, updatedAccount, audit] = await Promise.all([
    prisma.organizationMembership.findMany({ where: { personId: person.id }, orderBy: { createdAt: "asc" } }),
    prisma.roleAssignment.findMany({ where: { personId: person.id } }),
    prisma.projectMember.findFirstOrThrow({ where: { personId: person.id, projectId: project.id } }),
    prisma.refreshSession.findFirstOrThrow({ where: { accountId: account.id } }),
    prisma.account.findUniqueOrThrow({ where: { id: account.id } }),
    prisma.auditLog.findFirst({ where: { actorId: account.id, action: "organization.membership_transfer", objectId: person.id } })
  ]);
  assert.equal(memberships.filter((row) => row.active && row.primary).length, 1);
  assert.equal(memberships.find((row) => row.active)?.organizationId, targetEntity.id);
  assert.ok(roles.every((row) => !row.active));
  assert.equal(member.status, "active", "跨经营实体调动保留项目成员关系");
  assert.ok(session.revokedAt);
  assert.equal(updatedAccount.sessionVersion, 1);
  assert.ok(audit);

  const departmentPerson = await prisma.person.create({ data: { name: "调入部门人员", phone: "19900000302", type: "employee", status: "active", organizations: { create: { organizationId: sourceEntity.id, primary: true } }, projectMemberships: { create: { projectId: project.id, status: "active" } }, roleAssignments: { create: { role: "project_admin", scopeType: "project", scopeId: project.id, active: false, activationPending: true } } } });
  await prisma.$transaction((tx) => setPrimaryOrganization(tx, { personId: departmentPerson.id, organizationId: department.id, actorId: account.id, reason: "隔离验证调入部门", actorIsCompanyAdmin: true }));
  assert.equal((await prisma.projectMember.findFirstOrThrow({ where: { personId: departmentPerson.id } })).status, "removed");
  assert.equal((await prisma.roleAssignment.findFirstOrThrow({ where: { personId: departmentPerson.id } })).activationPending, false);

  const leader = await prisma.person.create({ data: { name: "当前负责人", phone: "19900000303", type: "employee", status: "active", organizations: { create: { organizationId: sourceEntity.id, primary: true } }, roleAssignments: { create: { role: "org_leader", scopeType: "organization", scopeId: sourceEntity.id, active: false, activationPending: true } } } });
  await assert.rejects(() => prisma.$transaction((tx) => setPrimaryOrganization(tx, { personId: leader.id, organizationId: targetEntity.id, actorId: account.id, reason: "验证负责人保护", actorIsCompanyAdmin: true })), /继任负责人/);
  console.log("PERSON_TRANSFER_SMOKE=PASS");
} finally {
  await prisma.$disconnect();
}
