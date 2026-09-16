import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { PrismaClient, type AccountStatus, type PersonStatus, type RoleName, type ScopeType } from "@prisma/client";
import { SignJWT } from "jose";

const expectedDatabaseUrl = "postgresql://postgres@127.0.0.1:55432/receivables_test";
const databaseUrl = process.env.DATABASE_URL ?? "";
assert.equal(databaseUrl, expectedDatabaseUrl, `Refusing to run outside ${expectedDatabaseUrl}`);
const baseUrl = process.env.RECEIVABLES_API_BASE_URL ?? "http://127.0.0.1:55448";
const apiUrl = new URL(baseUrl);
assert.equal(apiUrl.hostname, "127.0.0.1", "Receivables admin smoke API must bind to 127.0.0.1");
assert.equal(apiUrl.port, "55448", "Receivables admin smoke API must use port 55448");

const prisma = new PrismaClient();
const marker = `rxa-admin-${randomUUID()}`;
const jwtSecret = "receivables-admin-smoke-jwt-secret";
const ids = {
  accounts: [] as string[], people: [] as string[], organizations: [] as string[], roleAssignments: [] as string[],
  sessions: [] as string[], departments: [] as string[], grants: [] as string[], dictionaries: [] as string[], ledgers: [] as string[],
};
let server: ChildProcess | null = null;
let serverOutput = "";
let phoneCounter = 1;

type JsonResponse<T = unknown> = { data?: T; error?: { code: string; message: string } };
type AccessResponse = { role: "owner" | "admin" | "reporter" | "readonly" | null; canViewAll: boolean; canCreateLedger: boolean; canExport: boolean; readDepartmentIds: string[]; writeDepartmentIds: string[] };
type GrantResponse = { id: string; accountId: string; role: "admin" | "reporter" | "readonly"; revision: number; active: boolean; canCreate: boolean; canExport: boolean; canViewAll: boolean; departments: Array<{ financeDepartmentId: string; canRead: boolean; canWrite: boolean }> };
type DepartmentResponse = { id: string; name: string; code: string | null; sortOrder: number; active: boolean; revision: number };
type DictionaryResponse = { id: string; category: string; value: string; sortOrder: number; active: boolean; revision: number };
type PreviewResponse = { impactCount: number; token: string; expiresAt: string };
type CandidateResponse = { accountId: string; name: string; username: string | null; hasActiveGrant: boolean };

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function waitForMigrationLockWaiters(expected: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%receivable_departments%'
        AND (query ILIKE 'UPDATE%' OR query ILIKE 'SELECT id FROM receivable_departments WHERE id IN (%ORDER BY id FOR UPDATE%')
    `;
    if (Number(row?.count ?? 0n) >= expected) return;
    await delay(20);
  }
  assert.fail(`Expected ${expected} migration request(s) waiting on the source row lock`);
}

async function createIdentity(input: { label: string; accountStatus?: AccountStatus; personStatus?: PersonStatus; role?: RoleName; scopeType?: ScopeType; scopeId?: string }) {
  const person = await prisma.person.create({ data: { name: `${marker}-${input.label}`, phone: `1960000${String(phoneCounter++).padStart(4, "0")}`, type: "employee", status: input.personStatus ?? "active" } });
  ids.people.push(person.id);
  const account = await prisma.account.create({ data: { username: `${marker}-${input.label}`, usernameNormalized: `${marker}-${input.label}`, status: input.accountStatus ?? "active", personId: person.id } });
  ids.accounts.push(account.id);
  if (input.role) {
    const assignment = await prisma.roleAssignment.create({ data: { accountId: account.id, personId: person.id, role: input.role, scopeType: input.scopeType!, scopeId: input.scopeId ?? null } });
    ids.roleAssignments.push(assignment.id);
  }
  return account;
}

async function createDepartmentFixture(label: string, active: boolean) {
  const row = await prisma.receivableDepartment.create({ data: { name: `${marker}-${label}`, active } });
  ids.departments.push(row.id);
  return row;
}

async function createDictionaryFixture(category: string, label: string, active: boolean) {
  const row = await prisma.receivableDictionaryOption.create({ data: { category, value: `${marker}-${label}`, active } });
  ids.dictionaries.push(row.id);
  return row;
}

async function createLedgerFixture(financeDepartmentId: string, label: string, createdBy: string) {
  const contractNo = `${marker}-${label}`;
  const row = await prisma.receivableLedger.create({ data: { financeDepartmentId, contractNo, contractNoNormalized: contractNo, createdBy } });
  ids.ledgers.push(row.id);
  return row;
}

async function bearer(accountId: string) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { sessionVersion: true } });
  const session = await prisma.refreshSession.create({ data: { accountId, tokenHash: `smoke-${randomUUID()}`, clientKind: "rxa-admin-smoke", expiresAt: new Date(Date.now() + 3_600_000), absoluteExpiresAt: new Date(Date.now() + 3_600_000) } });
  ids.sessions.push(session.id);
  return new SignJWT({ ver: account.sessionVersion, sid: session.id }).setProtectedHeader({ alg: "HS256" }).setSubject(accountId).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(jwtSecret));
}

async function request(path: string, token: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
}

async function json<T>(path: string, token: string, init: RequestInit = {}) {
  const response = await request(path, token, init);
  return { response, body: await response.json() as JsonResponse<T> };
}

async function expectStatus(path: string, token: string, status: number, init: RequestInit = {}) {
  const result = await json(path, token, init);
  assert.equal(result.response.status, status, `${init.method ?? "GET"} ${path}: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function administrationFacts() {
  const [grants, departments, dictionaries, ledgers, audits] = await Promise.all([
    prisma.receivableAccessGrant.findMany({ where: { accountId: { in: ids.accounts } }, select: { id: true, accountId: true, role: true, active: true, revision: true, revokedAt: true, departments: { select: { financeDepartmentId: true, canRead: true, canWrite: true }, orderBy: { financeDepartmentId: "asc" } } }, orderBy: { id: "asc" } }),
    prisma.receivableDepartment.findMany({ where: { name: { startsWith: marker } }, select: { id: true, name: true, code: true, sortOrder: true, active: true, revision: true }, orderBy: { id: "asc" } }),
    prisma.receivableDictionaryOption.findMany({ where: { value: { startsWith: marker } }, select: { id: true, category: true, value: true, sortOrder: true, active: true, revision: true }, orderBy: { id: "asc" } }),
    prisma.receivableLedger.findMany({ where: { contractNo: { startsWith: marker } }, select: { id: true, financeDepartmentId: true, debtStatus: true, revision: true }, orderBy: { id: "asc" } }),
    prisma.auditLog.findMany({ where: { actorId: { in: ids.accounts }, action: { startsWith: "receivables.admin." } }, select: { id: true, action: true, objectId: true, metadata: true }, orderBy: { id: "asc" } }),
  ]);
  return { grants, departments, dictionaries, ledgers, audits };
}

async function expectRejectedWithoutMutation(path: string, token: string, status: number, init: RequestInit, trackCreated?: "grant") {
  const before = await administrationFacts();
  const result = await json<{ id?: string }>(path, token, init);
  const createdId = result.body.data?.id;
  if (trackCreated === "grant" && createdId) ids.grants.push(createdId);
  const after = await administrationFacts();
  assert.deepEqual(after, before, `${init.method ?? "GET"} ${path} changed business or audit facts on rejection`);
  assert.equal(result.response.status, status, `${init.method ?? "GET"} ${path}: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function startServer() {
  const root = resolve(import.meta.dirname, "../../..");
  server = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "apps/api/src/server.ts"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test", PORT: "55448", RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1", PUBLIC_BASE_URL: baseUrl, COOKIE_SECRET: "receivables-admin-smoke-cookie-secret", JWT_SECRET: jwtSecret, FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), UPLOAD_SIGNING_SECRET: "receivables-admin-smoke-upload-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr?.on("data", (chunk) => { serverOutput += String(chunk); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Receivables API exited before readiness:\n${serverOutput}`);
    try {
      if ((await fetch(`${baseUrl}/api/health`)).status === 200) {
        assert.match(serverOutput, /RECEIVABLES_LISTEN_ADDRESS=127\.0\.0\.1/, "Smoke API did not actually bind its socket to loopback");
        return;
      }
    } catch {}
    await delay(50);
  }
  throw new Error(`Receivables API did not become ready:\n${serverOutput}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill();
  await Promise.race([once(server, "exit"), delay(2_000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.accounts }, action: { startsWith: "receivables." } } });
  await prisma.receivableLedgerRevision.deleteMany({ where: { ledgerId: { in: ids.ledgers } } });
  await prisma.receivableLedger.deleteMany({ where: { id: { in: ids.ledgers } } });
  await prisma.receivableSetting.deleteMany({ where: { financeOrganizationId: { in: ids.organizations } } });
  await prisma.receivableGrantDepartment.deleteMany({ where: { grantId: { in: ids.grants } } });
  await prisma.receivableAccessGrant.deleteMany({ where: { id: { in: ids.grants } } });
  await prisma.receivableDictionaryOption.deleteMany({ where: { id: { in: ids.dictionaries } } });
  await prisma.receivableDepartment.deleteMany({ where: { id: { in: ids.departments } } });
  await prisma.refreshSession.deleteMany({ where: { id: { in: ids.sessions } } });
  await prisma.roleAssignment.deleteMany({ where: { id: { in: ids.roleAssignments } } });
  await prisma.organizationMembership.deleteMany({ where: { personId: { in: ids.people } } });
  await prisma.account.deleteMany({ where: { id: { in: ids.accounts } } });
  await prisma.person.deleteMany({ where: { id: { in: ids.people } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids.organizations } } });
}

function expiredTokenFrom(token: string) {
  const [encoded] = token.split(".");
  assert.ok(encoded);
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
  payload.expiresAt = Date.now() - 1;
  const expiredPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", jwtSecret).update(expiredPayload).digest("base64url");
  return `${expiredPayload}.${signature}`;
}

try {
  const company = await prisma.organization.create({ data: { name: `${marker}-company`, type: "company" } });
  ids.organizations.push(company.id);
  const financeOrganization = await prisma.organization.create({ data: { name: `${marker}-finance-org`, type: "department", parentId: company.id } });
  ids.organizations.push(financeOrganization.id);
  const crossOrganization = await prisma.organization.create({ data: { name: `${marker}-cross-org`, type: "business_entity", parentId: company.id } });
  ids.organizations.push(crossOrganization.id);
  const owner = await createIdentity({ label: "owner", role: "org_leader", scopeType: "organization", scopeId: financeOrganization.id });
  const replacementOwner = await createIdentity({ label: "replacement-owner" });
  const financeAdmin = await createIdentity({ label: "finance-admin" });
  const reporter = await createIdentity({ label: "reporter" });
  const readonly = await createIdentity({ label: "readonly" });
  const companyAdmin = await createIdentity({ label: "company-admin", role: "company_admin", scopeType: "company" });
  const inactiveAccount = await createIdentity({ label: "inactive-account", accountStatus: "disabled" });
  const inactivePerson = await createIdentity({ label: "inactive-person", personStatus: "disabled" });
  const pendingAccount = await createIdentity({ label: "pending-account", accountStatus: "pending" });
  const crossOrganizationCandidate = await createIdentity({ label: "cross-candidate" });
  await prisma.organizationMembership.create({ data: { personId: crossOrganizationCandidate.personId!, organizationId: crossOrganization.id, primary: true } });
  const inactiveAfterGrant = await createIdentity({ label: "inactive-after-grant" });
  await prisma.receivableSetting.create({ data: { id: 1, financeOrganizationId: financeOrganization.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.id } });

  const tokens = Object.fromEntries(await Promise.all(Object.entries({ owner, replacementOwner, financeAdmin, reporter, readonly, companyAdmin }).map(async ([name, account]) => [name, await bearer(account.id)]))) as Record<string, string>;
  await startServer();

  const departmentA = (await expectStatus<DepartmentResponse>("/api/receivables/departments", tokens.owner!, 201, { method: "POST", body: JSON.stringify({ name: `${marker}-department-a`, code: `${marker.slice(-8)}A`, sortOrder: 2 }) })).data!;
  ids.departments.push(departmentA.id);
  const departmentB = (await expectStatus<DepartmentResponse>("/api/receivables/departments", tokens.owner!, 201, { method: "POST", body: JSON.stringify({ name: `${marker}-department-b`, code: `${marker.slice(-8)}B`, sortOrder: 1 }) })).data!;
  ids.departments.push(departmentB.id);
  const adminGrant = (await expectStatus<GrantResponse>("/api/receivables/grants", tokens.owner!, 201, { method: "POST", body: JSON.stringify({ accountId: financeAdmin.id, role: "admin", canCreate: false, canExport: false, canViewAll: false, departments: [], reason: "appoint finance admin" }) })).data!;
  ids.grants.push(adminGrant.id);
  assert.equal((await expectStatus<AccessResponse>("/api/receivables/access", tokens.financeAdmin!, 200)).data?.role, "admin");

  const candidates = (await expectStatus<CandidateResponse[]>(`/api/receivables/grant-candidates?search=${encodeURIComponent(marker)}`, tokens.owner!, 200)).data!;
  assert.ok(candidates.length <= 50, "candidate search must be capped at 50");
  assert.deepEqual(Object.keys(candidates[0] ?? {}).sort(), ["accountId", "hasActiveGrant", "name", "username"]);
  assert.ok(candidates.some((candidate) => candidate.accountId === crossOrganizationCandidate.id), "owner must see active candidates outside the finance organization scope");
  assert.equal(candidates.find((candidate) => candidate.accountId === financeAdmin.id)?.hasActiveGrant, true);
  assert.ok(!candidates.some((candidate) => [inactiveAccount.id, inactivePerson.id, pendingAccount.id].includes(candidate.accountId)), "inactive/pending account or person must be excluded");
  await expectStatus("/api/receivables/grant-candidates?search=x", tokens.owner!, 400);
  await expectStatus(`/api/receivables/grant-candidates?search=${"x".repeat(81)}`, tokens.owner!, 400);
  await expectStatus(`/api/receivables/grant-candidates?search=${encodeURIComponent(marker)}`, tokens.financeAdmin!, 403);

  for (const actor of [tokens.financeAdmin!, tokens.reporter!, tokens.readonly!, tokens.companyAdmin!]) {
    await expectStatus("/api/receivables/grants", actor, 403, { method: "POST", body: JSON.stringify({ accountId: reporter.id, role: "reporter", departments: [{ departmentId: departmentA.id, canRead: true, canWrite: false }], reason: "forbidden grant" }) });
  }
  await expectStatus("/api/receivables/grants", tokens.owner!, 400, { method: "POST", body: JSON.stringify({ accountId: reporter.id, role: "owner", departments: [], reason: "owner cannot be granted" }) });
  await expectStatus("/api/receivables/grants", tokens.owner!, 400, { method: "POST", body: JSON.stringify({ accountId: replacementOwner.id, role: "admin", canViewAll: true, departments: [], reason: "invalid admin flags" }) });
  await expectStatus("/api/receivables/grants", tokens.owner!, 409, { method: "POST", body: JSON.stringify({ accountId: inactiveAccount.id, role: "reporter", departments: [{ departmentId: departmentA.id, canRead: true, canWrite: false }], reason: "inactive account" }) });
  await expectStatus("/api/receivables/grants", tokens.owner!, 409, { method: "POST", body: JSON.stringify({ accountId: inactivePerson.id, role: "readonly", departments: [{ departmentId: departmentA.id, canRead: true, canWrite: false }], reason: "inactive person" }) });
  await expectStatus("/api/receivables/grants", tokens.owner!, 400, { method: "POST", body: JSON.stringify({ accountId: readonly.id, role: "readonly", canCreate: true, departments: [{ departmentId: departmentA.id, canRead: true, canWrite: true }], reason: "readonly escalation" }) });

  let reporterGrant = (await expectStatus<GrantResponse>("/api/receivables/grants", tokens.owner!, 201, { method: "POST", body: JSON.stringify({ accountId: reporter.id, role: "reporter", canCreate: true, canExport: true, canViewAll: false, departments: [{ departmentId: departmentA.id, canRead: true, canWrite: true }, { departmentId: departmentB.id, canRead: true, canWrite: false }], reason: "reporting coverage" }) })).data!;
  ids.grants.push(reporterGrant.id);
  let reporterAccess = (await expectStatus<AccessResponse>("/api/receivables/access", tokens.reporter!, 200)).data!;
  assert.deepEqual(reporterAccess.readDepartmentIds, [departmentA.id, departmentB.id].sort());
  assert.deepEqual(reporterAccess.writeDepartmentIds, [departmentA.id]);
  assert.equal(reporterAccess.canViewAll, false);

  reporterGrant = (await expectStatus<GrantResponse>(`/api/receivables/grants/${reporterGrant.id}`, tokens.owner!, 200, { method: "PATCH", body: JSON.stringify({ revision: reporterGrant.revision, role: "reporter", canCreate: true, canExport: false, canViewAll: false, departments: [{ departmentId: departmentB.id, canRead: true, canWrite: true }], reason: "replace scope" }) })).data!;
  reporterAccess = (await expectStatus<AccessResponse>("/api/receivables/access", tokens.reporter!, 200)).data!;
  assert.deepEqual(reporterAccess.readDepartmentIds, [departmentB.id]);
  assert.deepEqual(reporterAccess.writeDepartmentIds, [departmentB.id]);
  assert.equal(reporterAccess.canExport, false);
  assert.equal(reporterAccess.canViewAll, false);

  reporterGrant = (await expectStatus<GrantResponse>(`/api/receivables/grants/${reporterGrant.id}`, tokens.owner!, 200, { method: "PATCH", body: JSON.stringify({ revision: reporterGrant.revision, role: "reporter", canCreate: false, canExport: true, canViewAll: true, departments: [{ departmentId: departmentB.id, canRead: true, canWrite: false }], reason: "separate all-view" }) })).data!;
  reporterAccess = (await expectStatus<AccessResponse>("/api/receivables/access", tokens.reporter!, 200)).data!;
  assert.equal(reporterAccess.canViewAll, true);
  assert.equal(reporterAccess.canCreateLedger, false);
  assert.deepEqual(reporterAccess.readDepartmentIds, [departmentB.id]);
  assert.deepEqual(reporterAccess.writeDepartmentIds, []);
  await expectStatus(`/api/receivables/grants/${reporterGrant.id}`, tokens.financeAdmin!, 403, { method: "PATCH", body: JSON.stringify({ revision: reporterGrant.revision, role: "reporter", canCreate: false, canExport: false, canViewAll: false, departments: [{ departmentId: departmentB.id, canRead: true, canWrite: false }], reason: "admin cannot alter grants" }) });
  await expectStatus("/api/receivables/grants", tokens.owner!, 409, { method: "POST", body: JSON.stringify({ accountId: reporter.id, role: "reporter", canCreate: false, canExport: false, canViewAll: false, departments: [{ departmentId: departmentB.id, canRead: true, canWrite: false }], reason: "duplicate active grant" }) });
  const readonlyGrant = (await expectStatus<GrantResponse>("/api/receivables/grants", tokens.owner!, 201, { method: "POST", body: JSON.stringify({ accountId: readonly.id, role: "readonly", canExport: true, canViewAll: false, departments: [{ departmentId: departmentA.id, canRead: true, canWrite: false }, { departmentId: departmentB.id, canRead: true, canWrite: false }], reason: "readonly coverage" }) })).data!;
  ids.grants.push(readonlyGrant.id);
  const readonlyAccess = (await expectStatus<AccessResponse>("/api/receivables/access", tokens.readonly!, 200)).data!;
  assert.deepEqual(readonlyAccess.readDepartmentIds, [departmentA.id, departmentB.id].sort());
  assert.deepEqual(readonlyAccess.writeDepartmentIds, []);
  assert.equal(readonlyAccess.canExport, true);

  const adminDepartment = (await expectStatus<DepartmentResponse>("/api/receivables/departments", tokens.financeAdmin!, 201, { method: "POST", body: JSON.stringify({ name: `${marker}-admin-department`, sortOrder: 9 }) })).data!;
  ids.departments.push(adminDepartment.id);
  const reorderedDepartment = (await expectStatus<DepartmentResponse>(`/api/receivables/departments/${adminDepartment.id}`, tokens.financeAdmin!, 200, { method: "PATCH", body: JSON.stringify({ revision: adminDepartment.revision, sortOrder: 3 }) })).data!;
  assert.equal(reorderedDepartment.sortOrder, 3);
  const sourceOption = (await expectStatus<DictionaryResponse>("/api/receivables/dictionary-options", tokens.financeAdmin!, 201, { method: "POST", body: JSON.stringify({ category: "debt_status", value: `${marker}-old`, sortOrder: 1 }) })).data!;
  ids.dictionaries.push(sourceOption.id);
  const targetOption = (await expectStatus<DictionaryResponse>("/api/receivables/dictionary-options", tokens.financeAdmin!, 201, { method: "POST", body: JSON.stringify({ category: "debt_status", value: `${marker}-new`, sortOrder: 2 }) })).data!;
  ids.dictionaries.push(targetOption.id);
  const reorderedOption = (await expectStatus<DictionaryResponse>(`/api/receivables/dictionary-options/${targetOption.id}`, tokens.financeAdmin!, 200, { method: "PATCH", body: JSON.stringify({ revision: targetOption.revision, sortOrder: 4 }) })).data!;
  assert.equal(reorderedOption.sortOrder, 4);

  for (const actor of [tokens.reporter!, tokens.readonly!, tokens.companyAdmin!]) {
    await expectStatus("/api/receivables/departments", actor, 403);
    await expectStatus("/api/receivables/dictionary-options", actor, 403);
  }
  for (const path of [`/api/receivables/grants/${reporterGrant.id}`, `/api/receivables/departments/${departmentA.id}`, `/api/receivables/dictionary-options/${sourceOption.id}`]) {
    await expectStatus(path, tokens.owner!, 404, { method: "DELETE" });
  }

  const ledger = await prisma.receivableLedger.create({ data: { financeDepartmentId: departmentA.id, contractNo: `${marker}-contract-1`, contractNoNormalized: `${marker}-contract-1`, debtStatus: sourceOption.value, createdBy: owner.id } });
  ids.ledgers.push(ledger.id);
  await expectRejectedWithoutMutation(`/api/receivables/departments/${departmentA.id}/migrate`, tokens.owner!, 409, { method: "POST", body: JSON.stringify({ mode: "preview", targetId: departmentB.id }) });
  await expectRejectedWithoutMutation(`/api/receivables/dictionary-options/${sourceOption.id}/migrate`, tokens.owner!, 409, { method: "POST", body: JSON.stringify({ mode: "preview", targetId: targetOption.id }) });
  const auditCountBeforeRejectedRenames = await prisma.auditLog.count({ where: { actorId: financeAdmin.id, action: { startsWith: "receivables.admin." } } });
  await expectStatus(`/api/receivables/departments/${departmentA.id}`, tokens.financeAdmin!, 409, { method: "PATCH", body: JSON.stringify({ revision: departmentA.revision, name: `${marker}-renamed-department` }) });
  await expectStatus(`/api/receivables/dictionary-options/${sourceOption.id}`, tokens.financeAdmin!, 409, { method: "PATCH", body: JSON.stringify({ revision: sourceOption.revision, value: `${marker}-renamed-option` }) });
  assert.equal(await prisma.auditLog.count({ where: { actorId: financeAdmin.id, action: { startsWith: "receivables.admin." } } }), auditCountBeforeRejectedRenames);
  assert.equal((await prisma.receivableDepartment.findUniqueOrThrow({ where: { id: departmentA.id }, select: { name: true } })).name, departmentA.name);
  assert.equal((await prisma.receivableDictionaryOption.findUniqueOrThrow({ where: { id: sourceOption.id }, select: { value: true } })).value, sourceOption.value);
  const deactivatedDepartment = (await expectStatus<DepartmentResponse>(`/api/receivables/departments/${departmentA.id}`, tokens.financeAdmin!, 200, { method: "PATCH", body: JSON.stringify({ revision: departmentA.revision, active: false, reason: "historical department" }) })).data!;
  assert.equal(deactivatedDepartment.active, false);
  const deactivatedOption = (await expectStatus<DictionaryResponse>(`/api/receivables/dictionary-options/${sourceOption.id}`, tokens.financeAdmin!, 200, { method: "PATCH", body: JSON.stringify({ revision: sourceOption.revision, active: false, reason: "historical option" }) })).data!;
  assert.equal(deactivatedOption.active, false);
  await expectStatus("/api/receivables/grants", tokens.owner!, 409, { method: "POST", body: JSON.stringify({ accountId: replacementOwner.id, role: "readonly", departments: [{ departmentId: departmentA.id, canRead: true, canWrite: false }], reason: "inactive department scope" }) });
  await expectRejectedWithoutMutation("/api/receivables/grants", tokens.owner!, 400, { method: "POST", body: JSON.stringify({ accountId: replacementOwner.id, role: "readonly", canCreate: false, canExport: false, canViewAll: false, departments: [{ departmentId: departmentB.id, canRead: true, canWrite: false }], reason: "strict grant create", canManageAccess: true }) }, "grant");
  await expectRejectedWithoutMutation(`/api/receivables/grants/${reporterGrant.id}`, tokens.owner!, 400, { method: "PATCH", body: JSON.stringify({ revision: reporterGrant.revision, role: "reporter", canCreate: false, canExport: true, canViewAll: true, departments: [{ departmentId: departmentB.id, canRead: true, canWrite: false }], reason: "strict grant update", canManageAccess: true }) });

  const inactiveSubjectGrant = (await expectStatus<GrantResponse>("/api/receivables/grants", tokens.owner!, 201, { method: "POST", body: JSON.stringify({ accountId: inactiveAfterGrant.id, role: "readonly", canExport: false, canViewAll: false, departments: [{ departmentId: departmentB.id, canRead: true, canWrite: false }], reason: "grant before identity deactivation" }) })).data!;
  ids.grants.push(inactiveSubjectGrant.id);
  await prisma.account.update({ where: { id: inactiveAfterGrant.id }, data: { status: "disabled" } });
  const inactiveSubjectRevocation = (await expectStatus<GrantResponse>(`/api/receivables/grants/${inactiveSubjectGrant.id}`, tokens.owner!, 200, { method: "PATCH", body: JSON.stringify({ revision: inactiveSubjectGrant.revision, revoke: true, reason: "identity disabled" }) })).data!;
  assert.equal(inactiveSubjectRevocation.active, false);

  const departmentPreview = (await expectStatus<PreviewResponse>(`/api/receivables/departments/${departmentA.id}/migrate`, tokens.owner!, 200, { method: "POST", body: JSON.stringify({ mode: "preview", targetId: departmentB.id }) })).data!;
  assert.equal(departmentPreview.impactCount, 1);
  await expectStatus(`/api/receivables/departments/${departmentA.id}/migrate`, tokens.financeAdmin!, 403, { method: "POST", body: JSON.stringify({ mode: "apply", targetId: departmentB.id, token: departmentPreview.token, confirm: true, reason: "admin forbidden" }) });
  const [tamperedPayload, originalSignature] = departmentPreview.token.split(".");
  assert.ok(tamperedPayload && originalSignature);
  const tamperedToken = `${tamperedPayload}.${originalSignature.startsWith("A") ? "B" : "A"}${originalSignature.slice(1)}`;
  await expectStatus(`/api/receivables/departments/${departmentA.id}/migrate`, tokens.owner!, 400, { method: "POST", body: JSON.stringify({ mode: "apply", targetId: departmentB.id, token: tamperedToken, confirm: true, reason: "tampered" }) });
  await expectStatus(`/api/receivables/departments/${departmentA.id}/migrate`, tokens.owner!, 400, { method: "POST", body: JSON.stringify({ mode: "apply", targetId: departmentB.id, token: expiredTokenFrom(departmentPreview.token), confirm: true, reason: "expired" }) });

  const ownerAssignment = ids.roleAssignments[0]!;
  await prisma.roleAssignment.update({ where: { id: ownerAssignment }, data: { active: false } });
  const replacementAssignment = await prisma.roleAssignment.create({ data: { accountId: replacementOwner.id, personId: replacementOwner.personId, role: "org_leader", scopeType: "organization", scopeId: financeOrganization.id } });
  ids.roleAssignments.push(replacementAssignment.id);
  await expectStatus(`/api/receivables/departments/${departmentA.id}/migrate`, tokens.replacementOwner!, 400, { method: "POST", body: JSON.stringify({ mode: "apply", targetId: departmentB.id, token: departmentPreview.token, confirm: true, reason: "wrong actor" }) });
  await prisma.roleAssignment.update({ where: { id: replacementAssignment.id }, data: { active: false } });
  await prisma.roleAssignment.update({ where: { id: ownerAssignment }, data: { active: true } });

  const staleLedger = await prisma.receivableLedger.create({ data: { financeDepartmentId: departmentA.id, contractNo: `${marker}-contract-2`, contractNoNormalized: `${marker}-contract-2`, createdBy: owner.id } });
  ids.ledgers.push(staleLedger.id);
  await expectStatus(`/api/receivables/departments/${departmentA.id}/migrate`, tokens.owner!, 409, { method: "POST", body: JSON.stringify({ mode: "apply", targetId: departmentB.id, token: departmentPreview.token, confirm: true, reason: "stale impact" }) });
  await expectStatus(`/api/receivables/departments/${departmentA.id}/migrate`, tokens.owner!, 400, { method: "POST", body: JSON.stringify({ mode: "apply", targetId: departmentB.id, token: departmentPreview.token, confirm: false, reason: "unconfirmed" }) });
  const freshDepartmentPreview = (await expectStatus<PreviewResponse>(`/api/receivables/departments/${departmentA.id}/migrate`, tokens.owner!, 200, { method: "POST", body: JSON.stringify({ mode: "preview", targetId: departmentB.id }) })).data!;
  assert.equal(freshDepartmentPreview.impactCount, 2);
  await expectStatus(`/api/receivables/departments/${departmentA.id}/migrate`, tokens.owner!, 200, { method: "POST", body: JSON.stringify({ mode: "apply", targetId: departmentB.id, token: freshDepartmentPreview.token, confirm: true, reason: "move historical department" }) });
  assert.equal(await prisma.receivableLedger.count({ where: { id: { in: ids.ledgers }, financeDepartmentId: departmentB.id } }), 2);

  const dictionaryPreview = (await expectStatus<PreviewResponse>(`/api/receivables/dictionary-options/${sourceOption.id}/migrate`, tokens.owner!, 200, { method: "POST", body: JSON.stringify({ mode: "preview", targetId: targetOption.id }) })).data!;
  assert.equal(dictionaryPreview.impactCount, 1);
  await expectStatus(`/api/receivables/dictionary-options/${sourceOption.id}/migrate`, tokens.owner!, 200, { method: "POST", body: JSON.stringify({ mode: "apply", targetId: targetOption.id, token: dictionaryPreview.token, confirm: true, reason: "replace historical status" }) });
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: ledger.id }, select: { debtStatus: true } })).debtStatus, targetOption.value);

  const activeApplySource = await createDepartmentFixture("active-apply-source", false);
  const activeApplyTarget = await createDepartmentFixture("active-apply-target", true);
  const activeApplyPreview = (await expectStatus<PreviewResponse>(`/api/receivables/departments/${activeApplySource.id}/migrate`, tokens.owner!, 200, { method: "POST", body: JSON.stringify({ mode: "preview", targetId: activeApplyTarget.id }) })).data!;
  await prisma.receivableDepartment.update({ where: { id: activeApplySource.id }, data: { active: true } });
  await expectRejectedWithoutMutation(`/api/receivables/departments/${activeApplySource.id}/migrate`, tokens.owner!, 409, { method: "POST", body: JSON.stringify({ mode: "apply", targetId: activeApplyTarget.id, token: activeApplyPreview.token, confirm: true, reason: "active source rejected at apply" }) });

  const activeDictionarySource = await createDictionaryFixture("debt_status", "active-dictionary-source", false);
  const activeDictionaryTarget = await createDictionaryFixture("debt_status", "active-dictionary-target", true);
  const activeDictionaryPreview = (await expectStatus<PreviewResponse>(`/api/receivables/dictionary-options/${activeDictionarySource.id}/migrate`, tokens.owner!, 200, { method: "POST", body: JSON.stringify({ mode: "preview", targetId: activeDictionaryTarget.id }) })).data!;
  await prisma.receivableDictionaryOption.update({ where: { id: activeDictionarySource.id }, data: { active: true } });
  await expectRejectedWithoutMutation(`/api/receivables/dictionary-options/${activeDictionarySource.id}/migrate`, tokens.owner!, 409, { method: "POST", body: JSON.stringify({ mode: "apply", targetId: activeDictionaryTarget.id, token: activeDictionaryPreview.token, confirm: true, reason: "active dictionary source rejected at apply" }) });

  const unsupportedSource = await createDictionaryFixture("comm_method", "unsupported-source", false);
  const unsupportedTarget = await createDictionaryFixture("comm_method", "unsupported-target", true);
  await expectRejectedWithoutMutation(`/api/receivables/dictionary-options/${unsupportedSource.id}/migrate`, tokens.owner!, 409, { method: "POST", body: JSON.stringify({ mode: "preview", targetId: unsupportedTarget.id }) });

  const staleSource = await createDepartmentFixture("stale-source-revision", false);
  const staleSourceTarget = await createDepartmentFixture("stale-source-target", true);
  const staleSourcePreview = (await expectStatus<PreviewResponse>(`/api/receivables/departments/${staleSource.id}/migrate`, tokens.owner!, 200, { method: "POST", body: JSON.stringify({ mode: "preview", targetId: staleSourceTarget.id }) })).data!;
  await prisma.receivableDepartment.update({ where: { id: staleSource.id }, data: { revision: { increment: 1 } } });
  await expectRejectedWithoutMutation(`/api/receivables/departments/${staleSource.id}/migrate`, tokens.owner!, 409, { method: "POST", body: JSON.stringify({ mode: "apply", targetId: staleSourceTarget.id, token: staleSourcePreview.token, confirm: true, reason: "stale source revision" }) });

  const staleTargetSource = await createDepartmentFixture("stale-target-source", false);
  const staleTarget = await createDepartmentFixture("stale-target", true);
  const staleTargetPreview = (await expectStatus<PreviewResponse>(`/api/receivables/departments/${staleTargetSource.id}/migrate`, tokens.owner!, 200, { method: "POST", body: JSON.stringify({ mode: "preview", targetId: staleTarget.id }) })).data!;
  await prisma.receivableDepartment.update({ where: { id: staleTarget.id }, data: { revision: { increment: 1 } } });
  await expectRejectedWithoutMutation(`/api/receivables/departments/${staleTargetSource.id}/migrate`, tokens.owner!, 409, { method: "POST", body: JSON.stringify({ mode: "apply", targetId: staleTarget.id, token: staleTargetPreview.token, confirm: true, reason: "stale target revision" }) });

  const fingerprintSource = await createDepartmentFixture("fingerprint-source", false);
  const fingerprintHolding = await createDepartmentFixture("fingerprint-holding", true);
  const fingerprintTarget = await createDepartmentFixture("fingerprint-target", true);
  const fingerprintLedgerA = await createLedgerFixture(fingerprintSource.id, "fingerprint-a", owner.id);
  const fingerprintLedgerB = await createLedgerFixture(fingerprintHolding.id, "fingerprint-b", owner.id);
  const fingerprintPreview = (await expectStatus<PreviewResponse>(`/api/receivables/departments/${fingerprintSource.id}/migrate`, tokens.owner!, 200, { method: "POST", body: JSON.stringify({ mode: "preview", targetId: fingerprintTarget.id }) })).data!;
  assert.equal(fingerprintPreview.impactCount, 1);
  await prisma.$transaction([
    prisma.receivableLedger.update({ where: { id: fingerprintLedgerA.id }, data: { financeDepartmentId: fingerprintHolding.id } }),
    prisma.receivableLedger.update({ where: { id: fingerprintLedgerB.id }, data: { financeDepartmentId: fingerprintSource.id } }),
  ]);
  await expectRejectedWithoutMutation(`/api/receivables/departments/${fingerprintSource.id}/migrate`, tokens.owner!, 409, { method: "POST", body: JSON.stringify({ mode: "apply", targetId: fingerprintTarget.id, token: fingerprintPreview.token, confirm: true, reason: "same count different records" }) });

  const replaySource = await createDepartmentFixture("replay-source", false);
  const replayTarget = await createDepartmentFixture("replay-target", true);
  const replayPreview = (await expectStatus<PreviewResponse>(`/api/receivables/departments/${replaySource.id}/migrate`, tokens.owner!, 200, { method: "POST", body: JSON.stringify({ mode: "preview", targetId: replayTarget.id }) })).data!;
  const replaySourceRevision = replaySource.revision;
  const replayTargetRevision = replayTarget.revision;
  const zeroImpactApply = (await expectStatus<{ impactCount: number }>(`/api/receivables/departments/${replaySource.id}/migrate`, tokens.owner!, 200, { method: "POST", body: JSON.stringify({ mode: "apply", targetId: replayTarget.id, token: replayPreview.token, confirm: true, reason: "consume zero impact token" }) })).data!;
  assert.equal(zeroImpactApply.impactCount, 0);
  assert.equal((await prisma.receivableDepartment.findUniqueOrThrow({ where: { id: replaySource.id }, select: { revision: true } })).revision, replaySourceRevision + 1);
  assert.equal((await prisma.receivableDepartment.findUniqueOrThrow({ where: { id: replayTarget.id }, select: { revision: true } })).revision, replayTargetRevision + 1);
  await expectRejectedWithoutMutation(`/api/receivables/departments/${replaySource.id}/migrate`, tokens.owner!, 409, { method: "POST", body: JSON.stringify({ mode: "apply", targetId: replayTarget.id, token: replayPreview.token, confirm: true, reason: "replay rejected" }) });

  const concurrentSource = await createDepartmentFixture("concurrent-source", false);
  const concurrentTarget = await createDepartmentFixture("concurrent-target", true);
  const concurrentPreview = (await expectStatus<PreviewResponse>(`/api/receivables/departments/${concurrentSource.id}/migrate`, tokens.owner!, 200, { method: "POST", body: JSON.stringify({ mode: "preview", targetId: concurrentTarget.id }) })).data!;
  assert.equal(concurrentPreview.impactCount, 0);
  const concurrentAuditBefore = await prisma.auditLog.count({ where: { action: "receivables.admin.department.migrate", objectId: concurrentSource.id } });
  const concurrentApply = { method: "POST", body: JSON.stringify({ mode: "apply", targetId: concurrentTarget.id, token: concurrentPreview.token, confirm: true, reason: "concurrent token consumption" }) } satisfies RequestInit;
  let concurrentRequests!: Array<ReturnType<typeof json<{ impactCount: number }>>>;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM receivable_departments WHERE id = ${concurrentSource.id}::uuid FOR UPDATE`;
    concurrentRequests = [
      json<{ impactCount: number }>(`/api/receivables/departments/${concurrentSource.id}/migrate`, tokens.owner!, concurrentApply),
      json<{ impactCount: number }>(`/api/receivables/departments/${concurrentSource.id}/migrate`, tokens.owner!, concurrentApply),
    ];
    await waitForMigrationLockWaiters(2);
  });
  const concurrentResults = await Promise.all(concurrentRequests);
  assert.deepEqual(concurrentResults.map(({ response }) => response.status).sort(), [200, 409], `concurrent apply statuses: ${JSON.stringify(concurrentResults.map(({ response, body }) => ({ status: response.status, body })))}`);
  assert.equal(concurrentResults.find(({ response }) => response.status === 200)?.body.data?.impactCount, 0);
  assert.equal(concurrentResults.find(({ response }) => response.status === 409)?.body.error?.code, "RECEIVABLES_MIGRATION_STATE_CHANGED");
  assert.equal((await prisma.receivableDepartment.findUniqueOrThrow({ where: { id: concurrentSource.id }, select: { revision: true } })).revision, concurrentSource.revision + 1);
  assert.equal((await prisma.receivableDepartment.findUniqueOrThrow({ where: { id: concurrentTarget.id }, select: { revision: true } })).revision, concurrentTarget.revision + 1);
  assert.equal(await prisma.auditLog.count({ where: { action: "receivables.admin.department.migrate", objectId: concurrentSource.id } }), concurrentAuditBefore + 1);

  const grants = (await expectStatus<GrantResponse[]>("/api/receivables/grants", tokens.owner!, 200)).data!;
  assert.ok(grants.some((grant) => grant.id === adminGrant.id));
  const revokedAdmin = (await expectStatus<GrantResponse>(`/api/receivables/grants/${adminGrant.id}`, tokens.owner!, 200, { method: "PATCH", body: JSON.stringify({ revision: adminGrant.revision, revoke: true, reason: "rotation" }) })).data!;
  assert.equal(revokedAdmin.active, false);
  assert.equal((await expectStatus<AccessResponse>("/api/receivables/access", tokens.financeAdmin!, 200)).data?.role, null);
  await expectStatus("/api/receivables/departments", tokens.financeAdmin!, 403);

  const auditRows = await prisma.auditLog.findMany({ where: { actorId: { in: [owner.id, financeAdmin.id] }, action: { startsWith: "receivables.admin." } }, select: { action: true, metadata: true } });
  assert.ok(auditRows.length >= 12);
  for (const row of auditRows) {
    const metadata = row.metadata as Record<string, unknown>;
    assert.ok(Object.hasOwn(metadata, "before"), `${row.action} missing audit before`);
    assert.ok(Object.hasOwn(metadata, "after"), `${row.action} missing audit after`);
    assert.equal(typeof metadata.impactCount, "number", `${row.action} missing audit impactCount`);
  }
  assert.ok(auditRows.some((row) => row.action === "receivables.admin.department.migrate" && (row.metadata as Record<string, unknown>).impactCount === 2));
  assert.ok(auditRows.some((row) => row.action === "receivables.admin.dictionary.migrate" && (row.metadata as Record<string, unknown>).impactCount === 1));
  console.log("RECEIVABLES_ADMIN_SMOKE=PASS");
} finally {
  await stopServer();
  await cleanup();
  assert.equal(await prisma.auditLog.count({ where: { actorId: { in: ids.accounts }, action: { startsWith: "receivables." } } }), 0);
  assert.equal(await prisma.receivableLedger.count({ where: { id: { in: ids.ledgers } } }), 0);
  assert.equal(await prisma.receivableSetting.count({ where: { financeOrganizationId: { in: ids.organizations } } }), 0);
  assert.equal(await prisma.receivableAccessGrant.count({ where: { id: { in: ids.grants } } }), 0);
  assert.equal(await prisma.receivableDictionaryOption.count({ where: { id: { in: ids.dictionaries } } }), 0);
  assert.equal(await prisma.receivableDepartment.count({ where: { id: { in: ids.departments } } }), 0);
  assert.equal(await prisma.refreshSession.count({ where: { id: { in: ids.sessions } } }), 0);
  assert.equal(await prisma.roleAssignment.count({ where: { id: { in: ids.roleAssignments } } }), 0);
  assert.equal(await prisma.account.count({ where: { id: { in: ids.accounts } } }), 0);
  assert.equal(await prisma.person.count({ where: { id: { in: ids.people } } }), 0);
  assert.equal(await prisma.organization.count({ where: { id: { in: ids.organizations } } }), 0);
  await prisma.$disconnect();
}
