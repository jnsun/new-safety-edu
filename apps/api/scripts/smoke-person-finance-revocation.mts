import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { disablePerson, reactivatePerson } from "../src/identity.js";
import { issueSession } from "../src/auth.js";
import type { Env } from "../src/env.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assert.match(databaseUrl, /permission_p0_test/i, "Refusing to run outside isolated permission_p0_test database");
const prisma = new PrismaClient();

try {
  const company = await prisma.organization.create({ data: { name: "权限收权验证公司", type: "company" } });
  const department = await prisma.organization.create({ data: { name: "权限收权验证部门", type: "department", parentId: company.id } });
  const actorPerson = await prisma.person.create({ data: { name: "权限收权验证管理员", phone: "19900000601", type: "employee", status: "active", organizations: { create: { organizationId: department.id, primary: true } } } });
  const targetPerson = await prisma.person.create({ data: { name: "权限收权验证人员", phone: "19900000602", type: "employee", status: "active", organizations: { create: { organizationId: department.id, primary: true } } } });
  const actor = await prisma.account.create({ data: { personId: actorPerson.id, status: "active" } });
  const target = await prisma.account.create({ data: { personId: targetPerson.id, status: "active" } });
  const grant = await prisma.receivableAccessGrant.create({ data: { accountId: target.id, role: "readonly", canViewAll: true, grantedBy: actor.id } });
  const externalPerson = await prisma.person.create({ data: { name: "首版外部人员拒绝验证", phone: "19900000603", type: "contractor", status: "active" } });
  const externalAccount = await prisma.account.create({ data: { personId: externalPerson.id, status: "active" } });
  await assert.rejects(() => issueSession(externalAccount.id, { JWT_SECRET: "permission-p0-smoke-jwt-secret-123456789" } as Env), { code: "FIRST_RELEASE_EMPLOYEE_ONLY", statusCode: 403 });

  await prisma.$transaction((tx) => disablePerson(tx, { personId: targetPerson.id, actorId: actor.id, reason: "验证离职同步收回财务权限" }));
  const revoked = await prisma.receivableAccessGrant.findUniqueOrThrow({ where: { id: grant.id } });
  assert.deepEqual({ active: revoked.active, revokedBy: revoked.revokedBy, revokeReason: revoked.revokeReason }, { active: false, revokedBy: actor.id, revokeReason: "验证离职同步收回财务权限" });
  assert.ok(revoked.revokedAt);
  assert.equal((await prisma.account.findUniqueOrThrow({ where: { id: target.id } })).status, "disabled");

  await prisma.$transaction((tx) => reactivatePerson(tx, { personId: targetPerson.id }));
  assert.equal((await prisma.receivableAccessGrant.findUniqueOrThrow({ where: { id: grant.id } })).active, false);
  console.log("PERSON_FINANCE_REVOCATION_SMOKE=PASS");
} finally {
  await prisma.$disconnect();
}
