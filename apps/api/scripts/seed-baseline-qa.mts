import { isIP } from "node:net";
import argon2 from "argon2";
import { assertPasswordAllowed } from "../src/auth-security.js";
import { resolveContractAccess } from "../src/contract-access.js";
import { grantRole, revokeRole } from "../src/identity.js";
import { resolveReceivablesAccess } from "../src/receivables-access.js";
import { canSubmitMonthlyFacts, reportingOrganizationIds } from "../src/project-reporting-policy.js";
import { prisma } from "../src/db.js";
import { hasSafetyWebRole } from "../src/web-login-access.js";

const identities = [
  "QA_ALL_ACCESS",
  "QA_MONTHLY_REPORT",
  "QA_RECEIVABLE",
  "QA_CONTRACT_GLOBAL",
  "QA_CONTRACT_SCOPED",
  "QA_SAFETY_ONLY",
  "QA_NO_ACCESS",
] as const;
type Identity = (typeof identities)[number];
type FixtureInput = { passwords: Record<Identity, string> };
const marker = (identity: Identity) => `QA-BASELINE-${identity}`;
const placeholderPhone = (identity: Identity) => `0000000000${identities.indexOf(identity)}`;

function assertTestEnvironment() {
  if (process.env.APP_ENV !== "test") throw new Error("APP_ENV must equal test");
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("DATABASE_URL is required");
  const url = new URL(rawUrl);
  if (url.protocol !== "postgresql:" || url.hostname !== "postgres" || url.pathname !== "/safety_training_test") {
    throw new Error("Database must be the isolated safety_training_test service");
  }
  if (process.env.BASELINE_QA_FIXTURE_CONFIRM !== "safety_training_test") {
    throw new Error("Explicit test database confirmation is required");
  }
}

function isPrivateDatabaseAddress(value: string | null): boolean {
  const address = value?.split("/", 1)[0];
  if (!address || isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168);
}

async function readInput(): Promise<FixtureInput> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as FixtureInput;
  if (!parsed.passwords || identities.some((identity) => typeof parsed.passwords[identity] !== "string" || parsed.passwords[identity]!.length < 12)) {
    throw new Error("Password input must contain every QA identity");
  }
  return parsed;
}

async function upsertIdentity(identity: Identity, password: string) {
  const name = marker(identity);
  const username = identity.toLowerCase();
  const phone = placeholderPhone(identity);
  const matches = await prisma.person.findMany({ where: { name }, select: { id: true, phone: true, type: true, status: true, account: { select: { id: true } } } });
  if (matches.length > 1 || matches.some((person) => person.phone !== phone || person.type !== "employee" || person.status !== "active")) {
    throw new Error(`QA identity marker collision: ${identity}`);
  }
  let person = matches[0];
  if (!person) person = await prisma.person.create({ data: { name, phone, type: "employee", status: "active" }, select: { id: true, phone: true, type: true, status: true, account: { select: { id: true } } } });

  const existingAccount = await prisma.account.findUnique({ where: { usernameNormalized: username }, select: { id: true, personId: true } });
  if (existingAccount && existingAccount.personId !== person.id) throw new Error(`QA username collision: ${identity}`);
  if (person.account && person.account.id !== existingAccount?.id) throw new Error(`QA account association collision: ${identity}`);
  const fixtureMarker = existingAccount ? await prisma.userPreference.findUnique({ where: { accountId_key: { accountId: existingAccount.id, key: "baseline-qa-fixture" } }, select: { value: true } }) : null;
  if (fixtureMarker && (fixtureMarker.value as { fixture?: string; identity?: string }).fixture !== "baseline-qa-fixture-v1") throw new Error(`QA identity ownership marker collision: ${identity}`);
  if (fixtureMarker && (fixtureMarker.value as { identity?: string }).identity !== identity) throw new Error(`QA identity marker mismatch: ${identity}`);
  assertPasswordAllowed(password, { username, phone, name });
  const passwordHash = await argon2.hash(password);
  const account = existingAccount
    ? await prisma.account.update({ where: { id: existingAccount.id }, data: { username, passwordHash, passwordLoginEnabled: true, mustChangePassword: false, status: "active", failedLoginCount: 0, loginLockedUntil: null, sessionVersion: { increment: 1 } } })
    : await prisma.account.create({ data: { username, usernameNormalized: username, passwordHash, passwordLoginEnabled: true, mustChangePassword: false, status: "active", personId: person.id } });
  await prisma.userPreference.upsert({ where: { accountId_key: { accountId: account.id, key: "baseline-qa-fixture" } }, create: { accountId: account.id, key: "baseline-qa-fixture", value: { fixture: "baseline-qa-fixture-v1", identity } }, update: { value: { fixture: "baseline-qa-fixture-v1", identity } } });
  return { personId: person.id, accountId: account.id };
}

async function upsertOrganization(name: string) {
  const rows = await prisma.organization.findMany({ where: { name }, select: { id: true, type: true, parentId: true } });
  if (rows.length > 1 || rows.some((row) => row.type !== "business_entity" || row.parentId !== null)) throw new Error(`QA organization marker collision: ${name}`);
  if (rows[0]) return prisma.organization.update({ where: { id: rows[0].id }, data: { reportingEnabled: true } });
  return prisma.organization.create({ data: { name, type: "business_entity", reportingEnabled: true } });
}

async function ensureMembership(personId: string, organizationId: string) {
  const memberships = await prisma.organizationMembership.findMany({ where: { personId, active: true }, select: { id: true, organizationId: true, primary: true } });
  if (memberships.some((row) => row.organizationId !== organizationId && row.primary)) throw new Error("QA person has a conflicting primary organization");
  if (memberships.some((row) => row.organizationId === organizationId && row.primary)) return;
  await prisma.organizationMembership.create({ data: { personId, organizationId, active: true, primary: true } });
}

async function ensureRole(personId: string, actorId: string, role: "company_admin" | "field_reporter" | "org_admin", scopeId: string | null) {
  await prisma.$transaction((tx) => grantRole(tx, { personId, role, scopeType: scopeId ? "organization" : "company", scopeId, actorId, reason: "BASELINE QA fixture" }));
}

type FixtureRole = { role: "company_admin" | "field_reporter" | "org_admin"; scopeId: string | null };
async function reconcileIdentityRoles(personId: string, actorId: string, expected: FixtureRole[]) {
  const current = await prisma.roleAssignment.findMany({ where: { personId, OR: [{ active: true }, { activationPending: true }] }, select: { id: true, role: true, scopeType: true, scopeId: true } });
  for (const assignment of current) {
    const isExpected = expected.some(({ role, scopeId }) => assignment.role === role && assignment.scopeType === (scopeId ? "organization" : "company") && assignment.scopeId === scopeId);
    if (!isExpected) {
      await prisma.$transaction((tx) => revokeRole(tx, { roleId: assignment.id, actorId, reason: "BASELINE QA fixture role reconciliation" }));
    }
  }
  for (const role of expected) await ensureRole(personId, actorId, role.role, role.scopeId);
}

async function ensureContractGrant(input: { personId: string; accountId: string; actorId: string; role: "admin" | "editor"; organizationScoped: boolean }) {
  const current = await prisma.contractAccessGrant.findMany({ where: { personId: input.personId, active: true, revokedAt: null }, select: { id: true } });
  if (current.length > 1) throw new Error("QA contract grant is ambiguous");
  const grant = {
    personId: input.personId,
    accountId: input.accountId,
    role: input.role,
    canCreateProject: true,
    canEditProject: true,
    canManageContracts: true,
    canUploadAttachments: true,
    canChangeStage: true,
    canExport: input.role === "admin",
    canViewAll: !input.organizationScoped,
    canManageAccess: input.role === "admin",
    active: true,
    grantReason: "BASELINE QA fixture",
    grantedBy: input.actorId,
  } as const;
  if (current[0]) await prisma.contractAccessGrant.update({ where: { id: current[0].id }, data: { ...grant, revision: { increment: 1 }, revokedAt: null, revokedBy: null, revokeReason: null } });
  else await prisma.contractAccessGrant.create({ data: grant });
}

async function ensureQaFinanceDepartment() {
  const name = "BASELINE-TEST-RECEIVABLES";
  const code = "QA-BASELINE-TEST";
  const [byName, byCode] = await Promise.all([
    prisma.receivableDepartment.findUnique({ where: { name } }),
    prisma.receivableDepartment.findUnique({ where: { code } }),
  ]);
  if (byName && byCode && byName.id !== byCode.id) throw new Error("QA finance department ownership collision");
  const existing = byName ?? byCode;
  if (existing && (existing.name !== name || existing.code !== code)) throw new Error("QA finance department marker collision");
  return existing
    ? prisma.receivableDepartment.update({ where: { id: existing.id }, data: { active: true, showReceivables: true } })
    : prisma.receivableDepartment.create({ data: { name, code, active: true, showReceivables: true } });
}

async function ensureReceivableGrant(input: { personId: string; accountId: string; actorId: string; financeDepartmentId: string; role: "admin" | "readonly" }) {
  const current = await prisma.receivableAccessGrant.findMany({ where: { personId: input.personId, active: true, revokedAt: null }, select: { id: true } });
  if (current.length > 1) throw new Error("QA receivable grant is ambiguous");
  const grant = { personId: input.personId, accountId: input.accountId, role: input.role, active: true, grantedBy: input.actorId };
  const saved = current[0]
    ? await prisma.receivableAccessGrant.update({ where: { id: current[0].id }, data: { ...grant, revision: { increment: 1 }, revokedAt: null, revokedBy: null, revokeReason: null } })
    : await prisma.receivableAccessGrant.create({ data: grant });
  await prisma.receivableGrantDepartment.deleteMany({ where: { grantId: saved.id, financeDepartmentId: { not: input.financeDepartmentId } } });
  await prisma.receivableGrantDepartment.upsert({
    where: { grantId_financeDepartmentId: { grantId: saved.id, financeDepartmentId: input.financeDepartmentId } },
    create: { grantId: saved.id, financeDepartmentId: input.financeDepartmentId, canRead: true, canWrite: false },
    update: { canRead: true, canWrite: false },
  });
}

async function upsertTestProject(input: { code: string; name: string; organizationId: string; stage: "bid_preparation" | "field_work"; bidStatus: "bidding" | "won"; mainContractNo?: string; actorId: string }) {
  let project = await prisma.project.findUnique({ where: { code: input.code }, select: { id: true, name: true, responsibleOrganizationId: true } });
  if (project && (project.name !== input.name || project.responsibleOrganizationId !== input.organizationId)) throw new Error(`QA project marker collision: ${input.code}`);
  if (!project) project = await prisma.project.create({ data: { code: input.code, name: input.name, responsibleOrganizationId: input.organizationId, projectType: "其他", contractStage: input.stage, contractBidStatus: input.bidStatus, contractDataSource: "manual", contractRegisteredAt: new Date(), contractBusinessSector: "BASELINE-TEST" } });
  if (input.mainContractNo) {
    const prior = await prisma.contractMainContract.findUnique({ where: { contractNo: input.mainContractNo }, include: { project: { select: { id: true } } } });
    if (prior?.project && prior.project.id !== project.id) throw new Error(`QA contract marker collision: ${input.mainContractNo}`);
    const main = prior ?? await prisma.contractMainContract.create({ data: { contractNo: input.mainContractNo, rawContractNo: input.mainContractNo, partyA: "BASELINE-TEST-COUNTERPARTY", amountYuan: "1286450.00", annualAmountYuan: "1286450.00", signedAt: new Date("2026-01-15T00:00:00.000Z"), handlerName: "QA-TEST", sourceNote: "BASELINE-TEST fixture" } });
    await prisma.project.update({ where: { id: project.id }, data: { mainContractId: main.id, contractStage: input.stage, contractBidStatus: "won" } });
    if (!await prisma.contractProjectStatusHistory.findFirst({ where: { projectId: project.id, toStage: input.stage } })) await prisma.contractProjectStatusHistory.create({ data: { projectId: project.id, toStage: input.stage, changedBy: input.actorId, reason: "BASELINE-TEST fixture" } });
  } else {
    await prisma.project.update({ where: { id: project.id }, data: { mainContractId: null, contractStage: "bid_preparation", contractBidStatus: "bidding" } });
    if (!await prisma.contractProjectStatusHistory.findFirst({ where: { projectId: project.id, toStage: "bid_preparation" } })) await prisma.contractProjectStatusHistory.create({ data: { projectId: project.id, toStage: "bid_preparation", changedBy: input.actorId, reason: "BASELINE-TEST fixture" } });
  }
  return project.id;
}

async function seedFinanceRows(departmentId: string, createdBy: string) {
  let created = 0;
  for (let index = 1; index <= 25; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const contractNo = `BASELINE-TEST-F02-${suffix}`;
    const existing = await prisma.receivableLedger.findUnique({ where: { contractNoNormalized: contractNo }, select: { id: true, contractNo: true, projectName: true, customerName: true } });
    if (existing && existing.contractNo !== contractNo) throw new Error(`QA finance marker collision: ${contractNo}`);
    if (existing && (!existing.projectName?.startsWith("BASELINE-TEST-F02-PROJECT-") || !existing.customerName?.startsWith("QA-TEST-CUSTOMER-"))) throw new Error(`QA finance ownership collision: ${contractNo}`);
    const data = { financeDepartmentId: departmentId, contractNo, contractNoNormalized: contractNo, projectName: `BASELINE-TEST-F02-PROJECT-${suffix}`, customerName: `QA-TEST-CUSTOMER-${suffix}`, creditorUnit: `QA-TEST-UNIT-${suffix}`, workNature: "BASELINE-TEST", contractAmount: String(100000 + index * 1000), finalAmount: String(100000 + index * 1000), createdBy };
    if (existing) await prisma.receivableLedger.update({ where: { id: existing.id }, data });
    else { await prisma.receivableLedger.create({ data }); created += 1; }
  }
  return created;
}

async function main() {
  assertTestEnvironment();
  const databaseIdentity = await prisma.$queryRaw<Array<{ database: string; address: string | null }>>`SELECT current_database() AS database, inet_server_addr()::text AS address`;
  if (databaseIdentity[0]?.database !== "safety_training_test" || !isPrivateDatabaseAddress(databaseIdentity[0]?.address ?? null)) {
    throw new Error("Connected PostgreSQL identity is not the isolated safety_training_test service; no fixture writes performed");
  }
  const { passwords } = await readInput();
  const existingAdmin = await prisma.roleAssignment.findFirst({ where: { role: "company_admin", scopeType: "company", active: true, account: { status: "active" } }, select: { accountId: true } });
  const financeSetting = await prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true } });
  if (!existingAdmin?.accountId || !financeSetting?.financeOrganizationId || !financeSetting.configurationConfirmedAt) {
    throw new Error("Existing test financial configuration or company administrator is unavailable; no fixture writes performed");
  }

  const accounts = {} as Record<Identity, { personId: string; accountId: string }>;
  for (const identity of identities) accounts[identity] = await upsertIdentity(identity, passwords[identity]);
  const entityA = await upsertOrganization("QA-BASELINE-ENTITY-A");
  const entityB = await upsertOrganization("QA-BASELINE-ENTITY-B");

  await ensureMembership(accounts.QA_MONTHLY_REPORT.personId, entityA.id);
  await ensureMembership(accounts.QA_SAFETY_ONLY.personId, entityA.id);
  await ensureMembership(accounts.QA_CONTRACT_SCOPED.personId, entityA.id);
  await reconcileIdentityRoles(accounts.QA_ALL_ACCESS.personId, existingAdmin.accountId, [{ role: "company_admin", scopeId: null }, { role: "field_reporter", scopeId: entityA.id }]);
  await reconcileIdentityRoles(accounts.QA_MONTHLY_REPORT.personId, existingAdmin.accountId, [{ role: "field_reporter", scopeId: entityA.id }]);
  await reconcileIdentityRoles(accounts.QA_RECEIVABLE.personId, existingAdmin.accountId, []);
  await reconcileIdentityRoles(accounts.QA_CONTRACT_GLOBAL.personId, existingAdmin.accountId, []);
  await reconcileIdentityRoles(accounts.QA_CONTRACT_SCOPED.personId, existingAdmin.accountId, []);
  await reconcileIdentityRoles(accounts.QA_SAFETY_ONLY.personId, existingAdmin.accountId, [{ role: "org_admin", scopeId: entityA.id }]);
  await reconcileIdentityRoles(accounts.QA_NO_ACCESS.personId, existingAdmin.accountId, []);

  const financeDepartment = await ensureQaFinanceDepartment();
  await ensureReceivableGrant({ ...accounts.QA_ALL_ACCESS, actorId: existingAdmin.accountId, financeDepartmentId: financeDepartment.id, role: "admin" });
  await ensureReceivableGrant({ ...accounts.QA_RECEIVABLE, actorId: existingAdmin.accountId, financeDepartmentId: financeDepartment.id, role: "readonly" });
  await ensureContractGrant({ ...accounts.QA_ALL_ACCESS, actorId: existingAdmin.accountId, role: "admin", organizationScoped: false });
  await ensureContractGrant({ ...accounts.QA_CONTRACT_GLOBAL, actorId: existingAdmin.accountId, role: "admin", organizationScoped: false });
  await ensureContractGrant({ ...accounts.QA_CONTRACT_SCOPED, actorId: existingAdmin.accountId, role: "editor", organizationScoped: true });

  await upsertTestProject({ code: "BASELINE-TEST-PROJECT-A", name: "BASELINE-TEST-PROJECT-A", organizationId: entityA.id, stage: "field_work", bidStatus: "won", mainContractNo: "BASELINE-TEST-CONTRACT-A-001", actorId: existingAdmin.accountId });
  await upsertTestProject({ code: "BASELINE-TEST-PROJECT-B", name: "BASELINE-TEST-PROJECT-B", organizationId: entityB.id, stage: "field_work", bidStatus: "won", mainContractNo: "BASELINE-TEST-CONTRACT-B-001", actorId: existingAdmin.accountId });
  await upsertTestProject({ code: "BASELINE-TEST-UNSIGNED-GATE", name: "BASELINE-TEST-UNSIGNED-GATE", organizationId: entityA.id, stage: "bid_preparation", bidStatus: "bidding", actorId: existingAdmin.accountId });
  const addedFinanceRows = await seedFinanceRows(financeDepartment.id, accounts.QA_RECEIVABLE.accountId);
  const openPeriods = await prisma.reportingPeriod.count({ where: { status: { in: ["open", "review"] } } });

  const expected = {
    QA_ALL_ACCESS: { safety: true, finance: true, contracts: true, monthly: true },
    QA_MONTHLY_REPORT: { safety: true, finance: false, contracts: false, monthly: true },
    QA_RECEIVABLE: { safety: false, finance: true, contracts: false, monthly: false },
    QA_CONTRACT_GLOBAL: { safety: false, finance: false, contracts: true, monthly: false },
    QA_CONTRACT_SCOPED: { safety: false, finance: false, contracts: true, monthly: false },
    QA_SAFETY_ONLY: { safety: true, finance: false, contracts: false, monthly: false },
    QA_NO_ACCESS: { safety: false, finance: false, contracts: false, monthly: false },
  } satisfies Record<Identity, { safety: boolean; finance: boolean; contracts: boolean; monthly: boolean }>;
  const matrix = await Promise.all(identities.map(async (identity) => {
    const personId = accounts[identity].personId;
    const [account, roles] = await Promise.all([
      prisma.account.findUniqueOrThrow({ where: { id: accounts[identity].accountId }, select: { status: true } }),
      prisma.roleAssignment.findMany({ where: { personId, active: true, activationPending: false }, select: { role: true, scopeType: true, scopeId: true } }),
    ]);
    const [finance, contracts] = await Promise.all([
      resolveReceivablesAccess({ accountId: accounts[identity].accountId, roles }, prisma),
      resolveContractAccess({ accountId: accounts[identity].accountId }, prisma),
    ]);
    const actual = { safety: account.status === "active" && hasSafetyWebRole(roles), finance: finance.canEnter, contracts: contracts.canEnter, monthly: account.status === "active" && canSubmitMonthlyFacts({ roles }) };
    if (identity === "QA_MONTHLY_REPORT") assert.deepEqual(reportingOrganizationIds({ roles }), [entityA.id], "Monthly report identity must be limited to its assigned QA entity");
    if (identity === "QA_CONTRACT_SCOPED") assert.deepEqual(contracts.organizationIds, [entityA.id], "Scoped contract identity must be limited to Entity A");
    assert.deepEqual(actual, expected[identity], `Authorization resolver mismatch for ${identity}`);
    if (identity === "QA_RECEIVABLE") assert.equal(finance.canWriteLedger, false, "QA_RECEIVABLE must remain read-only");
    return { identity, ...actual };
  }));
  console.log(JSON.stringify({ fixture: "BASELINE_QA_READY", testOnly: true, idempotent: true, identities: identities.map((identity) => `${identity} ready`), matrix, qaFinanceRowsAdded: addedFinanceRows, financeDepartment: "BASELINE-TEST-RECEIVABLES", writableReportingPeriods: openPeriods }));
}

main().catch(() => {
  console.error("BASELINE_QA_FIXTURE_FAILED; no credentials or record details were printed");
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
