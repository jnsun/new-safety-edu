import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { PrismaClient, type AccountStatus, type PersonStatus, type ReceivableGrantRole, type RoleName, type ScopeType } from "@prisma/client";
import { SignJWT } from "jose";

const expectedDatabaseUrl = "postgresql://postgres@127.0.0.1:55432/receivables_test";
const databaseUrl = process.env.DATABASE_URL ?? "";
assert.equal(databaseUrl, expectedDatabaseUrl, "Refusing to run outside postgresql://postgres@127.0.0.1:55432/receivables_test");
const baseUrl = process.env.RECEIVABLES_API_BASE_URL ?? "http://127.0.0.1:55448";
const apiUrl = new URL(baseUrl);
assert.equal(apiUrl.hostname, "127.0.0.1", "Receivables smoke API must bind to 127.0.0.1");
assert.equal(apiUrl.port, "55448", "Receivables smoke API must use port 55448");

const prisma = new PrismaClient();
const marker = `rxa-${randomUUID()}`;
const jwtSecret = "receivables-access-smoke-jwt-secret";
const setupLockKey = 8_645_136_501n;
const ids = { accounts: [] as string[], people: [] as string[], organizations: [] as string[], financeDepartments: [] as string[], grants: [] as string[] };
let server: ChildProcess | null = null;
let serverOutput = "";
let phoneCounter = 1;

type AccessResponse = {
  state: "unconfigured" | "pending_owner" | "pending_confirmation" | "ready";
  role: "owner" | "admin" | "reporter" | "readonly" | null;
  canEnter: boolean;
  canReadLedger: boolean;
  canWriteLedger: boolean;
  canManageAll: boolean;
  canCreateLedger: boolean;
  canExport: boolean;
  canViewAll: boolean;
  canConfirmSetup: boolean;
  canRecover: boolean;
  readDepartmentIds: string[];
  writeDepartmentIds: string[];
};

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function waitForSetupLockWaiters(expected: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query ILIKE '%pg_advisory_xact_lock%'
    `;
    if (Number(row?.count ?? 0n) >= expected) return;
    await delay(20);
  }
  assert.fail(`Expected ${expected} setup request(s) waiting on the transaction lock`);
}

async function createIdentity(input: {
  label: string;
  accountStatus?: AccountStatus;
  personStatus?: PersonStatus;
  role?: RoleName;
  scopeType?: ScopeType;
  scopeId?: string;
}) {
  const person = await prisma.person.create({
    data: { name: `${marker}-${input.label}`, phone: `1970000${String(phoneCounter++).padStart(4, "0")}`, type: "employee", status: input.personStatus ?? "active" },
  });
  ids.people.push(person.id);
  const account = await prisma.account.create({
    data: { username: `${marker}-${input.label}`, usernameNormalized: `${marker}-${input.label}`, status: input.accountStatus ?? "active", personId: person.id },
  });
  ids.accounts.push(account.id);
  if (input.role) {
    await prisma.roleAssignment.create({
      data: { accountId: account.id, personId: person.id, role: input.role, scopeType: input.scopeType!, scopeId: input.scopeId ?? null },
    });
  }
  return account;
}

async function grant(input: {
  accountId: string;
  grantedBy: string;
  role: ReceivableGrantRole;
  canCreate?: boolean;
  canExport?: boolean;
  canViewAll?: boolean;
  departments?: Array<{ id: string; canRead: boolean; canWrite: boolean }>;
}) {
  const created = await prisma.receivableAccessGrant.create({
    data: {
      accountId: input.accountId,
      grantedBy: input.grantedBy,
      role: input.role,
      canCreate: input.canCreate ?? false,
      canExport: input.canExport ?? false,
      canViewAll: input.canViewAll ?? false,
      departments: { create: (input.departments ?? []).map((department) => ({ financeDepartmentId: department.id, canRead: department.canRead, canWrite: department.canWrite })) },
    },
  });
  ids.grants.push(created.id);
  return created;
}

async function token(accountId: string) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { sessionVersion: true } });
  const session = await prisma.refreshSession.create({
    data: { accountId, tokenHash: `smoke-${randomUUID()}`, clientKind: "receivables-smoke", expiresAt: new Date(Date.now() + 3_600_000), absoluteExpiresAt: new Date(Date.now() + 3_600_000) },
  });
  return new SignJWT({ ver: account.sessionVersion, sid: session.id }).setProtectedHeader({ alg: "HS256" }).setSubject(accountId).setIssuedAt().setExpirationTime("15m")
    .sign(new TextEncoder().encode(jwtSecret));
}

async function request(path: string, bearer: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${bearer}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
}

async function access(bearer: string) {
  const response = await request("/api/receivables/access", bearer);
  const body = await response.json() as { data?: AccessResponse; error?: { code: string } };
  return { response, body };
}

async function startServer() {
  const root = resolve(import.meta.dirname, "../../..");
  server = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "apps/api/src/server.ts"], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "test",
      PORT: "55448",
      RECEIVABLES_ACCESS_SMOKE: "1",
      RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1",
      PUBLIC_BASE_URL: baseUrl,
      COOKIE_SECRET: "receivables-access-smoke-cookie-secret",
      JWT_SECRET: jwtSecret,
      FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      UPLOAD_SIGNING_SECRET: "receivables-access-smoke-upload-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr?.on("data", (chunk) => { serverOutput += String(chunk); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Receivables API exited before readiness:\n${serverOutput}`);
    let health: Response | undefined;
    try { health = await fetch(`${baseUrl}/api/health`); } catch {}
    if (health?.status === 200) {
      assert.match(serverOutput, /RECEIVABLES_LISTEN_ADDRESS=127\.0\.0\.1/, "Smoke API did not actually bind its socket to loopback");
      return;
    }
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
  await prisma.receivableSetting.deleteMany({ where: { financeOrganizationId: { in: ids.organizations } } });
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: "receivables.setup." }, objectId: { in: ids.organizations } } });
  await prisma.receivableGrantDepartment.deleteMany({ where: { grantId: { in: ids.grants } } });
  await prisma.receivableAccessGrant.deleteMany({ where: { id: { in: ids.grants } } });
  await prisma.refreshSession.deleteMany({ where: { accountId: { in: ids.accounts } } });
  await prisma.roleAssignment.deleteMany({ where: { OR: [{ accountId: { in: ids.accounts } }, { personId: { in: ids.people } }] } });
  await prisma.organizationMembership.deleteMany({ where: { personId: { in: ids.people } } });
  await prisma.account.deleteMany({ where: { id: { in: ids.accounts } } });
  await prisma.person.deleteMany({ where: { id: { in: ids.people } } });
  await prisma.receivableDepartment.deleteMany({ where: { id: { in: ids.financeDepartments } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids.organizations } } });
}

try {
  assert.equal(await prisma.receivableSetting.count(), 0, "receivables_test must start without a ReceivableSetting row");
  const company = await prisma.organization.create({ data: { name: `${marker}-company`, type: "company" } });
  ids.organizations.push(company.id);
  const financeOrganization = await prisma.organization.create({ data: { name: `${marker}-finance-org`, type: "department", parentId: company.id } });
  ids.organizations.push(financeOrganization.id);
  const replacementOrganization = await prisma.organization.create({ data: { name: `${marker}-replacement-org`, type: "department", parentId: company.id } });
  ids.organizations.push(replacementOrganization.id);
  const departmentA = await prisma.receivableDepartment.create({ data: { name: `${marker}-finance-a` } });
  ids.financeDepartments.push(departmentA.id);
  const departmentB = await prisma.receivableDepartment.create({ data: { name: `${marker}-finance-b` } });
  ids.financeDepartments.push(departmentB.id);
  const inactiveDepartment = await prisma.receivableDepartment.create({ data: { name: `${marker}-finance-inactive`, active: false } });
  ids.financeDepartments.push(inactiveDepartment.id);

  const companyAdmin = await createIdentity({ label: "company-admin", role: "company_admin", scopeType: "company" });
  const owner = await createIdentity({ label: "owner", role: "org_leader", scopeType: "organization", scopeId: financeOrganization.id });
  const replacementOwner = await createIdentity({ label: "replacement-owner", role: "org_leader", scopeType: "organization", scopeId: replacementOrganization.id });
  const financeAdmin = await createIdentity({ label: "finance-admin" });
  const reporterA = await createIdentity({ label: "reporter-a" });
  const reporterB = await createIdentity({ label: "reporter-b" });
  const viewer = await createIdentity({ label: "viewer" });
  const inactiveDepartmentViewer = await createIdentity({ label: "inactive-department-viewer" });
  const ordinary = await createIdentity({ label: "ordinary" });
  const pending = await createIdentity({ label: "pending", accountStatus: "pending" });
  const disabled = await createIdentity({ label: "disabled", accountStatus: "disabled" });
  const inactivePerson = await createIdentity({ label: "inactive-person", personStatus: "disabled" });

  const adminGrant = await grant({ accountId: financeAdmin.id, grantedBy: companyAdmin.id, role: "admin" });
  const reporterAGrant = await grant({ accountId: reporterA.id, grantedBy: companyAdmin.id, role: "reporter", canCreate: true, departments: [{ id: departmentA.id, canRead: true, canWrite: true }] });
  await grant({ accountId: reporterB.id, grantedBy: companyAdmin.id, role: "reporter", departments: [{ id: departmentB.id, canRead: true, canWrite: false }] });
  await grant({ accountId: viewer.id, grantedBy: companyAdmin.id, role: "readonly", canExport: true, departments: [{ id: departmentA.id, canRead: true, canWrite: false }] });
  await grant({ accountId: inactiveDepartmentViewer.id, grantedBy: companyAdmin.id, role: "readonly", departments: [{ id: inactiveDepartment.id, canRead: true, canWrite: false }] });
  await grant({ accountId: pending.id, grantedBy: companyAdmin.id, role: "admin" });
  await grant({ accountId: disabled.id, grantedBy: companyAdmin.id, role: "admin" });
  await grant({ accountId: inactivePerson.id, grantedBy: companyAdmin.id, role: "admin" });

  const tokens = Object.fromEntries(await Promise.all(Object.entries({ companyAdmin, owner, replacementOwner, financeAdmin, reporterA, reporterB, viewer, inactiveDepartmentViewer, ordinary, pending, disabled, inactivePerson })
    .map(async ([key, account]) => [key, await token(account.id)]))) as Record<string, string>;

  await startServer();

  const initialAdmin = await access(tokens.companyAdmin!);
  assert.equal(initialAdmin.response.status, 200);
  assert.equal(initialAdmin.body.data?.state, "unconfigured");
  assert.equal(initialAdmin.body.data?.canRecover, true);
  assert.equal(initialAdmin.body.data?.canEnter, false);
  const initialOrdinary = await access(tokens.ordinary!);
  assert.equal(initialOrdinary.body.data?.canRecover, false);
  assert.equal(initialOrdinary.body.data?.canEnter, false);
  const initialFinanceAdmin = await access(tokens.financeAdmin!);
  assert.equal(initialFinanceAdmin.body.data?.canRecover, false);
  assert.equal(initialFinanceAdmin.body.data?.canEnter, false);

  const invalidBind = await request("/api/receivables/setup/organization", tokens.companyAdmin!, { method: "PUT", body: JSON.stringify({ organizationId: company.id }) });
  assert.equal(invalidBind.status, 409);
  assert.equal((await invalidBind.json() as { error: { code: string } }).error.code, "RECEIVABLES_ORGANIZATION_NOT_DEPARTMENT");

  const bind = await request("/api/receivables/setup/organization", tokens.companyAdmin!, { method: "PUT", body: JSON.stringify({ organizationId: financeOrganization.id }) });
  assert.equal(bind.status, 200);
  const pendingAdmin = await access(tokens.companyAdmin!);
  assert.equal(pendingAdmin.body.data?.state, "pending_confirmation");
  assert.equal(pendingAdmin.body.data?.canReadLedger, false);
  assert.equal(pendingAdmin.body.data?.canRecover, true);
  const pendingOwner = await access(tokens.owner!);
  assert.equal(pendingOwner.body.data?.role, "owner");
  assert.equal(pendingOwner.body.data?.canConfirmSetup, true);
  assert.equal(pendingOwner.body.data?.canEnter, false);
  assert.equal((await access(tokens.financeAdmin!)).body.data?.canEnter, false);
  assert.equal((await request("/api/receivables/setup/confirm", tokens.companyAdmin!, { method: "POST", body: "{}" })).status, 403);
  assert.equal((await request("/api/receivables/setup/confirm", tokens.financeAdmin!, { method: "POST", body: "{}" })).status, 403);
  assert.equal((await request("/api/receivables/setup/confirm", tokens.owner!, { method: "POST", body: "{}" })).status, 200);

  const readyOwner = await access(tokens.owner!);
  assert.equal(readyOwner.body.data?.state, "ready");
  assert.equal(readyOwner.body.data?.role, "owner");
  assert.equal(readyOwner.body.data?.canManageAll, true);
  const readyAdmin = await access(tokens.financeAdmin!);
  assert.equal(readyAdmin.body.data?.role, "admin");
  assert.equal(readyAdmin.body.data?.canManageAll, true);
  const readyReporterA = await access(tokens.reporterA!);
  assert.equal(readyReporterA.body.data?.role, "reporter");
  assert.equal(readyReporterA.body.data?.canCreateLedger, true);
  assert.deepEqual(readyReporterA.body.data?.readDepartmentIds, [departmentA.id]);
  assert.deepEqual(readyReporterA.body.data?.writeDepartmentIds, [departmentA.id]);
  assert.equal((await request("/api/receivables/_smoke/protected", tokens.reporterA!)).status, 200);
  const readyReporterB = await access(tokens.reporterB!);
  assert.deepEqual(readyReporterB.body.data?.readDepartmentIds, [departmentB.id]);
  assert.deepEqual(readyReporterB.body.data?.writeDepartmentIds, []);
  const readyViewer = await access(tokens.viewer!);
  assert.equal(readyViewer.body.data?.role, "readonly");
  assert.equal(readyViewer.body.data?.canWriteLedger, false);
  assert.equal(readyViewer.body.data?.canExport, true);
  assert.deepEqual(readyViewer.body.data?.readDepartmentIds, [departmentA.id]);
  const inactiveScoped = await access(tokens.inactiveDepartmentViewer!);
  assert.equal(inactiveScoped.body.data?.canEnter, false);
  assert.equal(inactiveScoped.body.data?.canReadLedger, false);
  assert.deepEqual(inactiveScoped.body.data?.readDepartmentIds, []);
  assert.deepEqual(inactiveScoped.body.data?.writeDepartmentIds, []);
  assert.equal((await request("/api/receivables/_smoke/protected", tokens.inactiveDepartmentViewer!)).status, 403);
  assert.equal((await access(tokens.companyAdmin!)).body.data?.canReadLedger, false);

  await prisma.receivableAccessGrant.update({ where: { id: reporterAGrant.id }, data: { active: false, revokedAt: new Date(), revokedBy: companyAdmin.id, revokeReason: "smoke revocation" } });
  const revoked = await access(tokens.reporterA!);
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.body.data?.role, null);
  assert.equal(revoked.body.data?.canEnter, false);
  const revokedProtected = await request("/api/receivables/_smoke/protected", tokens.reporterA!);
  assert.equal(revokedProtected.status, 403);
  assert.equal((await revokedProtected.json() as { error: { code: string } }).error.code, "RECEIVABLES_FORBIDDEN");

  assert.equal((await access(tokens.pending!)).response.status, 403);
  assert.equal((await access(tokens.disabled!)).response.status, 401);
  assert.equal((await access(tokens.inactivePerson!)).response.status, 401);

  for (const body of [
    { organizationId: replacementOrganization.id, confirm: true },
    { organizationId: replacementOrganization.id, confirm: false, reason: "smoke rebind" },
    { organizationId: replacementOrganization.id, confirm: true, reason: "   " },
  ]) {
    assert.equal((await request("/api/receivables/setup/organization", tokens.companyAdmin!, { method: "PUT", body: JSON.stringify(body) })).status, 400);
  }
  let releaseSetupLock!: () => void;
  let setupLockReady!: () => void;
  const releaseSetupLockPromise = new Promise<void>((resolveRelease) => { releaseSetupLock = resolveRelease; });
  const setupLockReadyPromise = new Promise<void>((resolveReady) => { setupLockReady = resolveReady; });
  const setupLockHolder = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 'locked'::text AS locked FROM pg_advisory_xact_lock(${setupLockKey})`;
    setupLockReady();
    await releaseSetupLockPromise;
  }).catch((error) => { setupLockReady(); throw error; });
  void setupLockHolder.catch(() => undefined);
  await setupLockReadyPromise;
  const rebindPromise = request("/api/receivables/setup/organization", tokens.companyAdmin!, { method: "PUT", body: JSON.stringify({ organizationId: replacementOrganization.id, confirm: true, reason: "smoke recovery rebind" }) });
  let staleOwnerConfirmPromise: Promise<Response> | undefined;
  try {
    await waitForSetupLockWaiters(1);
    staleOwnerConfirmPromise = request("/api/receivables/setup/confirm", tokens.owner!, { method: "POST", body: "{}" });
    await waitForSetupLockWaiters(2);
  } finally {
    releaseSetupLock();
    await setupLockHolder;
  }
  const rebind = await rebindPromise;
  const staleOwnerConfirm = await staleOwnerConfirmPromise!;
  assert.equal(rebind.status, 200);
  assert.equal(staleOwnerConfirm.status, 403);
  assert.equal((await access(tokens.companyAdmin!)).body.data?.state, "pending_confirmation");
  assert.equal((await request("/api/receivables/setup/confirm", tokens.replacementOwner!, { method: "POST", body: "{}" })).status, 200);

  assert.equal(await prisma.auditLog.count({ where: { action: { in: ["receivables.setup.bind", "receivables.setup.rebind", "receivables.setup.confirm"] }, objectId: { in: ids.organizations } } }), 4);
  assert.equal(await prisma.receivableAccessGrant.count({ where: { id: adminGrant.id, active: true } }), 1);
  console.log("RECEIVABLES_ACCESS_SMOKE=PASS");
} finally {
  await stopServer();
  await cleanup();
  assert.equal(await prisma.receivableSetting.count({ where: { financeOrganizationId: { in: ids.organizations } } }), 0);
  assert.equal(await prisma.receivableAccessGrant.count({ where: { id: { in: ids.grants } } }), 0);
  assert.equal(await prisma.account.count({ where: { id: { in: ids.accounts } } }), 0);
  assert.equal(await prisma.person.count({ where: { id: { in: ids.people } } }), 0);
  assert.equal(await prisma.receivableDepartment.count({ where: { id: { in: ids.financeDepartments } } }), 0);
  assert.equal(await prisma.organization.count({ where: { id: { in: ids.organizations } } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { action: { startsWith: "receivables.setup." }, objectId: { in: ids.organizations } } }), 0);
  await prisma.$disconnect();
}
