import argon2 from "argon2";
import { assertPasswordAllowed } from "../src/auth-security.js";
import { grantRole } from "../src/identity.js";
import { prisma } from "../src/db.js";

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
  assertPasswordAllowed(password, { username, phone, name });
  const passwordHash = await argon2.hash(password);
  const account = existingAccount
    ? await prisma.account.update({ where: { id: existingAccount.id }, data: { username, passwordHash, passwordLoginEnabled: true, mustChangePassword: false, status: "active", failedLoginCount: 0, loginLockedUntil: null, sessionVersion: { increment: 1 } } })
    : await prisma.account.create({ data: { username, usernameNormalized: username, passwordHash, passwordLoginEnabled: true, mustChangePassword: false, status: "active", personId: person.id } });
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

async function ensureRole(personId: string, actorId: string, role: "company_admin" | "field_reporter", scopeId: string | null) {
  await prisma.$transaction((tx) => grantRole(tx, { personId, role, scopeType: scopeId ? "organization" : "company", scopeId, actorId, reason: "BASELINE QA fixture" }));
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

async function ensureReceivableGrant(input: { personId: string; accountId: string; actorId: string }) {
  const current = await prisma.receivableAccessGrant.findMany({ where: { personId: input.personId, active: true, revokedAt: null }, select: { id: true } });
  if (current.length > 1) throw new Error("QA receivable grant is ambiguous");
  const grant = { personId: input.personId, accountId: input.accountId, role: "admin" as const, active: true, grantedBy: input.actorId };
  if (current[0]) await prisma.receivableAccessGrant.update({ where: { id: current[0].id }, data: { ...grant, revision: { increment: 1 }, revokedAt: null, revokedBy: null, revokeReason: null } });
  else await prisma.receivableAccessGrant.create({ data: grant });
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
    const existing = await prisma.receivableLedger.findUnique({ where: { contractNoNormalized: contractNo }, select: { id: true, contractNo: true } });
    if (existing && existing.contractNo !== contractNo) throw new Error(`QA finance marker collision: ${contractNo}`);
    const data = { financeDepartmentId: departmentId, contractNo, contractNoNormalized: contractNo, projectName: `BASELINE-TEST-F02-PROJECT-${suffix}`, customerName: `QA-TEST-CUSTOMER-${suffix}`, creditorUnit: `QA-TEST-UNIT-${suffix}`, workNature: "BASELINE-TEST", contractAmount: String(100000 + index * 1000), finalAmount: String(100000 + index * 1000), createdBy };
    if (existing) await prisma.receivableLedger.update({ where: { id: existing.id }, data });
    else { await prisma.receivableLedger.create({ data }); created += 1; }
  }
  return created;
}

async function main() {
  assertTestEnvironment();
  const { passwords } = await readInput();
  const existingAdmin = await prisma.roleAssignment.findFirst({ where: { role: "company_admin", scopeType: "company", active: true, account: { status: "active" } }, select: { accountId: true } });
  const financeSetting = await prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true } });
  const financeDepartments = await prisma.receivableDepartment.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  if (!existingAdmin?.accountId || !financeSetting?.financeOrganizationId || !financeSetting.configurationConfirmedAt || !financeDepartments.length) {
    throw new Error("Existing test financial configuration or company administrator is unavailable; no fixture writes performed");
  }

  const accounts = {} as Record<Identity, { personId: string; accountId: string }>;
  for (const identity of identities) accounts[identity] = await upsertIdentity(identity, passwords[identity]);
  const entityA = await upsertOrganization("QA-BASELINE-ENTITY-A");
  const entityB = await upsertOrganization("QA-BASELINE-ENTITY-B");

  await ensureMembership(accounts.QA_MONTHLY_REPORT.personId, entityA.id);
  await ensureMembership(accounts.QA_SAFETY_ONLY.personId, entityA.id);
  await ensureMembership(accounts.QA_CONTRACT_SCOPED.personId, entityA.id);
  await ensureRole(accounts.QA_ALL_ACCESS.personId, existingAdmin.accountId, "company_admin", null);
  await ensureRole(accounts.QA_MONTHLY_REPORT.personId, existingAdmin.accountId, "field_reporter", entityA.id);
  await ensureRole(accounts.QA_SAFETY_ONLY.personId, existingAdmin.accountId, "field_reporter", entityA.id);

  await ensureReceivableGrant({ ...accounts.QA_ALL_ACCESS, actorId: existingAdmin.accountId });
  await ensureReceivableGrant({ ...accounts.QA_RECEIVABLE, actorId: existingAdmin.accountId });
  await ensureContractGrant({ ...accounts.QA_ALL_ACCESS, actorId: existingAdmin.accountId, role: "admin", organizationScoped: false });
  await ensureContractGrant({ ...accounts.QA_CONTRACT_GLOBAL, actorId: existingAdmin.accountId, role: "admin", organizationScoped: false });
  await ensureContractGrant({ ...accounts.QA_CONTRACT_SCOPED, actorId: existingAdmin.accountId, role: "editor", organizationScoped: true });

  await upsertTestProject({ code: "BASELINE-TEST-PROJECT-A", name: "BASELINE-TEST-PROJECT-A", organizationId: entityA.id, stage: "field_work", bidStatus: "won", mainContractNo: "BASELINE-TEST-CONTRACT-A-001", actorId: existingAdmin.accountId });
  await upsertTestProject({ code: "BASELINE-TEST-PROJECT-B", name: "BASELINE-TEST-PROJECT-B", organizationId: entityB.id, stage: "field_work", bidStatus: "won", mainContractNo: "BASELINE-TEST-CONTRACT-B-001", actorId: existingAdmin.accountId });
  await upsertTestProject({ code: "BASELINE-TEST-UNSIGNED-GATE", name: "BASELINE-TEST-UNSIGNED-GATE", organizationId: entityA.id, stage: "bid_preparation", bidStatus: "bidding", actorId: existingAdmin.accountId });
  const addedFinanceRows = await seedFinanceRows(financeDepartments[0]!.id, accounts.QA_RECEIVABLE.accountId);
  const openPeriods = await prisma.reportingPeriod.count({ where: { status: { in: ["open", "review"] } } });

  const matrix = await Promise.all(identities.map(async (identity) => {
    const personId = accounts[identity].personId;
    const [roles, financeGrants, contractGrants] = await Promise.all([
      prisma.roleAssignment.findMany({ where: { personId, active: true }, select: { role: true, scopeType: true } }),
      prisma.receivableAccessGrant.count({ where: { personId, active: true, revokedAt: null } }),
      prisma.contractAccessGrant.count({ where: { personId, active: true, revokedAt: null } }),
    ]);
    return { identity, safety: roles.some((row) => row.role === "company_admin" || row.role === "field_reporter"), finance: financeGrants > 0, contracts: contractGrants > 0 };
  }));
  console.log(JSON.stringify({ fixture: "BASELINE_QA_READY", testOnly: true, idempotent: true, identities: identities.map((identity) => `${identity} ready`), matrix, qaFinanceRowsAdded: addedFinanceRows, writableReportingPeriods: openPeriods }));
}

main().catch(() => {
  console.error("BASELINE_QA_FIXTURE_FAILED; no credentials or record details were printed");
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
