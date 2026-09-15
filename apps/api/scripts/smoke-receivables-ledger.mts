import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const expectedDatabaseUrl = "postgresql://postgres@127.0.0.1:55432/receivables_test";
const databaseUrl = process.env.DATABASE_URL ?? "";
assert.equal(databaseUrl, expectedDatabaseUrl, `Refusing to run outside ${expectedDatabaseUrl}`);
const baseUrl = process.env.RECEIVABLES_API_BASE_URL ?? "http://127.0.0.1:55448";
const apiUrl = new URL(baseUrl);
assert.equal(apiUrl.hostname, "127.0.0.1", "Receivables ledger smoke API must bind to 127.0.0.1");
assert.equal(apiUrl.port, "55448", "Receivables ledger smoke API must use port 55448");

const prisma = new PrismaClient();
const marker = `rxa-ledger-${randomUUID()}`;
const jwtSecret = "receivables-ledger-smoke-jwt-secret";
const ids = {
  accounts: [] as string[], people: [] as string[], organizations: [] as string[], roleAssignments: [] as string[],
  sessions: [] as string[], departments: [] as string[], grants: [] as string[], ledgers: [] as string[],
};
const triggerSuffix = randomUUID().replaceAll("-", "");
const triggerName = `rxa_ledger_atomicity_${triggerSuffix}`;
const triggerFunctionName = `${triggerName}_fn`;
let triggerInstalled = false;
let server: ChildProcess | null = null;
let serverOutput = "";
let phoneCounter = 1;

type JsonResponse<T = unknown> = { data?: T; error?: { code: string; message: string } };
type LedgerResponse = {
  id: string; financeDepartmentId: string; contractNo: string; contractNoNormalized: string;
  contractAmount: string | null; finalAmount: string | null; settlementMethod: string | null;
  collectionOwner: string | null; collectionNotes: string | null; status: "active" | "voided";
  revision: number; voidReason: string | null;
};

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const jsonBody = (value: unknown) => JSON.stringify(value);

async function waitForLockWaiters(tableFragment: string, queryPattern: string, expected: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query ILIKE ${`%${tableFragment}%`}
        AND query ILIKE ${queryPattern}
    `;
    if (Number(row?.count ?? 0n) >= expected) return true;
    await delay(20);
  }
  return false;
}

async function createIdentity(label: string, role?: "org_leader" | "company_admin", scopeId?: string) {
  const person = await prisma.person.create({ data: { name: `${marker}-${label}`, phone: `1940000${String(phoneCounter++).padStart(4, "0")}`, type: "employee", status: "active" } });
  ids.people.push(person.id);
  const account = await prisma.account.create({ data: { username: `${marker}-${label}`, usernameNormalized: `${marker}-${label}`, status: "active", personId: person.id } });
  ids.accounts.push(account.id);
  if (role) {
    const assignment = await prisma.roleAssignment.create({ data: { accountId: account.id, personId: person.id, role, scopeType: role === "company_admin" ? "company" : "organization", scopeId: scopeId ?? null } });
    ids.roleAssignments.push(assignment.id);
  }
  return account;
}

async function createGrant(input: { accountId: string; grantedBy: string; role: "admin" | "reporter" | "readonly"; canCreate?: boolean; departmentIds?: string[] }) {
  const grant = await prisma.receivableAccessGrant.create({
    data: {
      accountId: input.accountId, grantedBy: input.grantedBy, role: input.role, canCreate: input.canCreate ?? false,
      departments: { create: (input.departmentIds ?? []).map((financeDepartmentId) => ({ financeDepartmentId, canRead: true, canWrite: input.role === "reporter" })) },
    },
  });
  ids.grants.push(grant.id);
  return grant;
}

async function bearer(accountId: string) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { sessionVersion: true } });
  const session = await prisma.refreshSession.create({ data: { accountId, tokenHash: `smoke-${randomUUID()}`, clientKind: "rxa-ledger-smoke", expiresAt: new Date(Date.now() + 3_600_000), absoluteExpiresAt: new Date(Date.now() + 3_600_000) } });
  ids.sessions.push(session.id);
  return new SignJWT({ ver: account.sessionVersion, sid: session.id }).setProtectedHeader({ alg: "HS256" }).setSubject(accountId).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(jwtSecret));
}

async function request<T>(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
  return { response, body: await response.json() as JsonResponse<T> };
}

async function expectStatus<T>(path: string, token: string, status: number, init: RequestInit = {}) {
  const result = await request<T>(path, token, init);
  assert.equal(result.response.status, status, `${init.method ?? "GET"} ${path}: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function expectError(path: string, token: string, status: number, code: string, init: RequestInit = {}) {
  const body = await expectStatus(path, token, status, init);
  assert.equal(body.error?.code, code, `${init.method ?? "GET"} ${path}: ${JSON.stringify(body)}`);
  return body.error;
}

async function createLedger(token: string, input: Record<string, unknown>) {
  const result = await request<LedgerResponse>("/api/receivables/ledgers", token, { method: "POST", body: jsonBody(input) });
  if (result.body.data?.id) ids.ledgers.push(result.body.data.id);
  assert.equal(result.response.status, 201, `POST /api/receivables/ledgers: ${JSON.stringify(result.body)}`);
  return result.body.data!;
}

async function ledgerFacts(ledgerId: string) {
  const [ledger, revisions, audits] = await Promise.all([
    prisma.receivableLedger.findUnique({ where: { id: ledgerId } }),
    prisma.receivableLedgerRevision.findMany({ where: { ledgerId }, orderBy: { createdAt: "asc" } }),
    prisma.auditLog.findMany({ where: { objectId: ledgerId, action: { startsWith: "receivables.ledger." } }, orderBy: { createdAt: "asc" } }),
  ]);
  return { ledger, revisions, audits };
}

async function startServer() {
  const root = resolve(import.meta.dirname, "../../..");
  server = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "apps/api/src/server.ts"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test", PORT: "55448", RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1", PUBLIC_BASE_URL: baseUrl, COOKIE_SECRET: "receivables-ledger-smoke-cookie-secret", JWT_SECRET: jwtSecret, FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 10).toString("base64"), UPLOAD_SIGNING_SECRET: "receivables-ledger-smoke-upload-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr?.on("data", (chunk) => { serverOutput += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Receivables API exited early:\n${serverOutput}`);
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
  if (triggerInstalled) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "receivable_ledgers"`);
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}_insert" ON "receivable_ledgers"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${triggerFunctionName}"()`);
    triggerInstalled = false;
  }
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.accounts }, action: { startsWith: "receivables." } } });
  await prisma.receivableLedgerRevision.deleteMany({ where: { ledgerId: { in: ids.ledgers } } });
  await prisma.receivableLedger.deleteMany({ where: { id: { in: ids.ledgers } } });
  await prisma.receivableSetting.deleteMany({ where: { financeOrganizationId: { in: ids.organizations } } });
  await prisma.receivableGrantDepartment.deleteMany({ where: { grantId: { in: ids.grants } } });
  await prisma.receivableAccessGrant.deleteMany({ where: { id: { in: ids.grants } } });
  await prisma.receivableDepartment.deleteMany({ where: { id: { in: ids.departments } } });
  await prisma.refreshSession.deleteMany({ where: { id: { in: ids.sessions } } });
  await prisma.roleAssignment.deleteMany({ where: { id: { in: ids.roleAssignments } } });
  await prisma.account.deleteMany({ where: { id: { in: ids.accounts } } });
  await prisma.person.deleteMany({ where: { id: { in: ids.people } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids.organizations } } });
}

try {
  const company = await prisma.organization.create({ data: { name: `${marker}-company`, type: "company" } }); ids.organizations.push(company.id);
  const financeOrganization = await prisma.organization.create({ data: { name: `${marker}-finance-org`, type: "department", parentId: company.id } }); ids.organizations.push(financeOrganization.id);
  const owner = await createIdentity("owner", "org_leader", financeOrganization.id);
  const admin = await createIdentity("admin");
  const reporterA = await createIdentity("reporter-a");
  const reporterNoCreate = await createIdentity("reporter-no-create");
  const reporterB = await createIdentity("reporter-b");
  const revokeRaceReporter = await createIdentity("revoke-race-reporter");
  const readonly = await createIdentity("readonly");
  const companyAdmin = await createIdentity("company-admin", "company_admin");
  await prisma.receivableSetting.create({ data: { id: 1, financeOrganizationId: financeOrganization.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.id } });

  const departmentA = await prisma.receivableDepartment.create({ data: { name: `${marker}-department-a` } }); ids.departments.push(departmentA.id);
  const departmentB = await prisma.receivableDepartment.create({ data: { name: `${marker}-department-b` } }); ids.departments.push(departmentB.id);
  const inactiveDepartment = await prisma.receivableDepartment.create({ data: { name: `${marker}-department-inactive`, active: false } }); ids.departments.push(inactiveDepartment.id);
  const createRaceDepartment = await prisma.receivableDepartment.create({ data: { name: `${marker}-department-create-race` } }); ids.departments.push(createRaceDepartment.id);
  const reassignRaceDepartment = await prisma.receivableDepartment.create({ data: { name: `${marker}-department-reassign-race` } }); ids.departments.push(reassignRaceDepartment.id);
  await createGrant({ accountId: admin.id, grantedBy: owner.id, role: "admin" });
  await createGrant({ accountId: reporterA.id, grantedBy: owner.id, role: "reporter", canCreate: true, departmentIds: [departmentA.id] });
  await createGrant({ accountId: reporterNoCreate.id, grantedBy: owner.id, role: "reporter", departmentIds: [departmentA.id] });
  await createGrant({ accountId: reporterB.id, grantedBy: owner.id, role: "reporter", canCreate: true, departmentIds: [departmentB.id] });
  const revokeRaceGrant = await createGrant({ accountId: revokeRaceReporter.id, grantedBy: owner.id, role: "reporter", canCreate: true, departmentIds: [departmentA.id] });
  await createGrant({ accountId: readonly.id, grantedBy: owner.id, role: "readonly", departmentIds: [departmentA.id] });

  const tokens = Object.fromEntries(await Promise.all(Object.entries({ owner, admin, reporterA, reporterNoCreate, reporterB, revokeRaceReporter, readonly, companyAdmin }).map(async ([name, account]) => [name, await bearer(account.id)]))) as Record<string, string>;
  await startServer();

  const auto = await createLedger(tokens.owner!, {
    financeDepartmentId: departmentA.id, contractNo: `  ${marker}-auto  `, settlementMethod: "固定总价",
    contractAmount: "123.4500", projectName: "  自动带入项目  ", collectionNotes: "  初始备注  ",
  });
  assert.equal(auto.contractNo, `${marker}-auto`);
  assert.equal(auto.contractNoNormalized, `${marker}-auto`);
  const autoDb = await prisma.receivableLedger.findUniqueOrThrow({ where: { id: auto.id } });
  assert.equal(autoDb.contractAmount?.toFixed(4), "123.4500");
  assert.equal(autoDb.finalAmount?.toFixed(4), "123.4500", "non-workload create must carry omitted final from supplied contract amount");
  assert.equal(autoDb.projectName, "自动带入项目");
  assert.equal(autoDb.collectionNotes, "初始备注");

  const explicitNull = await createLedger(tokens.admin!, { financeDepartmentId: departmentA.id, contractNo: `${marker}-explicit-null`, settlementMethod: "固定总价", contractAmount: "9", finalAmount: null });
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: explicitNull.id } })).finalAmount, null, "explicit null final must remain null");
  const workload = await createLedger(tokens.admin!, { financeDepartmentId: departmentA.id, contractNo: `${marker}-workload`, settlementMethod: "按工作量结算", contractAmount: "88" });
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: workload.id } })).finalAmount, null, "workload settlement must not auto-fill final amount");
  const explicitFinal = await createLedger(tokens.admin!, { financeDepartmentId: departmentA.id, contractNo: `${marker}-explicit-final-patch`, settlementMethod: "固定总价", contractAmount: "100", finalAmount: "90" });
  await expectStatus(`/api/receivables/ledgers/${explicitFinal.id}`, tokens.admin!, 200, { method: "PATCH", body: jsonBody({ revision: 1, reason: "合同金额调整", contractAmount: "120" }) });
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: explicitFinal.id } })).finalAmount?.toFixed(4), "90.0000", "omitted final must preserve an existing explicit final amount");
  const nullFinalContractPatch = await createLedger(tokens.admin!, { financeDepartmentId: departmentA.id, contractNo: `${marker}-null-final-contract-patch`, settlementMethod: "固定总价", contractAmount: "100", finalAmount: null });
  await expectStatus(`/api/receivables/ledgers/${nullFinalContractPatch.id}`, tokens.admin!, 200, { method: "PATCH", body: jsonBody({ revision: 1, reason: "合同金额调整并带入", contractAmount: "120" }) });
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: nullFinalContractPatch.id } })).finalAmount?.toFixed(4), "120.0000", "null current final must auto-fill from a patched effective contract amount");
  await expectStatus(`/api/receivables/ledgers/${workload.id}`, tokens.admin!, 200, { method: "PATCH", body: jsonBody({ revision: 1, reason: "改为非工作量结算", settlementMethod: "固定总价" }) });
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: workload.id } })).finalAmount?.toFixed(4), "88.0000", "workload to non-workload must auto-fill a null final from the effective contract amount");
  const switchToWorkload = await createLedger(tokens.admin!, { financeDepartmentId: departmentA.id, contractNo: `${marker}-switch-workload`, settlementMethod: "固定总价", contractAmount: "70" });
  await expectStatus(`/api/receivables/ledgers/${switchToWorkload.id}`, tokens.admin!, 200, { method: "PATCH", body: jsonBody({ revision: 1, reason: "改为工作量结算", settlementMethod: "按工作量结算" }) });
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: switchToWorkload.id } })).finalAmount?.toFixed(4), "70.0000", "switching to workload with omitted final must preserve the current final");
  const explicitNullPatch = await createLedger(tokens.admin!, { financeDepartmentId: departmentA.id, contractNo: `${marker}-explicit-null-patch`, settlementMethod: "固定总价", contractAmount: "70" });
  await expectStatus(`/api/receivables/ledgers/${explicitNullPatch.id}`, tokens.admin!, 200, { method: "PATCH", body: jsonBody({ revision: 1, reason: "显式清空决算", contractAmount: "80", finalAmount: null }) });
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: explicitNullPatch.id } })).finalAmount, null, "explicit patch final null must remain null");
  const reporterCreated = await createLedger(tokens.reporterA!, { financeDepartmentId: departmentA.id, contractNo: `${marker}-reporter`, projectName: "报账员项目", debtStatus: "正常催收" });

  await expectError("/api/receivables/ledgers", tokens.owner!, 400, "VALIDATION_ERROR", { method: "POST", body: jsonBody({ financeDepartmentId: departmentA.id, contractNo: "   " }) });
  await expectError("/api/receivables/ledgers", tokens.owner!, 400, "VALIDATION_ERROR", { method: "POST", body: jsonBody({ financeDepartmentId: departmentA.id, contractNo: `${marker}-unknown`, surprise: true }) });
  await expectError("/api/receivables/ledgers", tokens.owner!, 409, "RECEIVABLES_CONTRACT_NO_CONFLICT", { method: "POST", body: jsonBody({ financeDepartmentId: departmentA.id, contractNo: ` ${marker}-auto ` }) });
  await expectError("/api/receivables/ledgers", tokens.owner!, 409, "RECEIVABLES_DEPARTMENT_INACTIVE", { method: "POST", body: jsonBody({ financeDepartmentId: inactiveDepartment.id, contractNo: `${marker}-inactive` }) });
  await expectError("/api/receivables/ledgers", tokens.reporterNoCreate!, 403, "RECEIVABLES_FORBIDDEN", { method: "POST", body: jsonBody({ financeDepartmentId: departmentA.id, contractNo: `${marker}-no-create` }) });
  await expectError("/api/receivables/ledgers", tokens.reporterB!, 403, "RECEIVABLES_FORBIDDEN", { method: "POST", body: jsonBody({ financeDepartmentId: departmentA.id, contractNo: `${marker}-cross-create` }) });
  await expectError("/api/receivables/ledgers", tokens.readonly!, 403, "RECEIVABLES_FORBIDDEN", { method: "POST", body: jsonBody({ financeDepartmentId: departmentA.id, contractNo: `${marker}-readonly-create` }) });
  await expectError("/api/receivables/ledgers", tokens.companyAdmin!, 403, "RECEIVABLES_FORBIDDEN", { method: "POST", body: jsonBody({ financeDepartmentId: departmentA.id, contractNo: `${marker}-company-admin` }) });
  await expectError("/api/receivables/ledgers", tokens.reporterA!, 403, "RECEIVABLES_REPORTER_FIELD_NOT_ALLOWED", { method: "POST", body: jsonBody({ financeDepartmentId: departmentA.id, contractNo: `${marker}-reporter-money`, contractAmount: "1" }) });
  for (const [label, contractAmount] of [["scale", "1.23456"], ["precision", "100000000000000"], ["negative", "-1"], ["number", 1]] as const) {
    await expectError("/api/receivables/ledgers", tokens.owner!, 400, label === "number" ? "VALIDATION_ERROR" : "RECEIVABLES_AMOUNT_INVALID", { method: "POST", body: jsonBody({ financeDepartmentId: departmentA.id, contractNo: `${marker}-${label}`, contractAmount }) });
  }

  const patchBefore = await prisma.receivableLedger.findUniqueOrThrow({ where: { id: reporterCreated.id } });
  const patched = (await expectStatus<LedgerResponse>(`/api/receivables/ledgers/${reporterCreated.id}`, tokens.reporterA!, 200, { method: "PATCH", body: jsonBody({ revision: 1, reason: "更新催收责任", collectionOwner: "  张三  ", collectionNotes: "  已电话联系  " }) })).data!;
  assert.equal(patched.revision, 2);
  assert.equal(patched.collectionOwner, "张三");
  assert.equal(patched.collectionNotes, "已电话联系");
  const patchFacts = await ledgerFacts(reporterCreated.id);
  assert.equal(patchFacts.revisions.length, 1);
  assert.equal(patchFacts.audits.length, 2, "create and patch must each write one critical audit");
  const snapshot = patchFacts.revisions[0]!.beforeSnapshot as Record<string, unknown>;
  assert.equal(patchFacts.revisions[0]!.revision, 1);
  assert.equal(snapshot.id, patchBefore.id);
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.collectionOwner, null);
  assert.equal(snapshot.status, "active");
  assert.equal((patchFacts.audits[1]!.metadata as Record<string, unknown>).reason, "更新催收责任");

  await expectError(`/api/receivables/ledgers/${reporterCreated.id}`, tokens.reporterA!, 400, "VALIDATION_ERROR", { method: "PATCH", body: jsonBody({ revision: 2, reason: " ", collectionNotes: "x" }) });
  await expectError(`/api/receivables/ledgers/${reporterCreated.id}`, tokens.reporterA!, 400, "VALIDATION_ERROR", { method: "PATCH", body: jsonBody({ revision: 2, reason: "missing change" }) });
  await expectError(`/api/receivables/ledgers/${reporterCreated.id}`, tokens.reporterA!, 400, "VALIDATION_ERROR", { method: "PATCH", body: jsonBody({ revision: 2, reason: "unknown", unexpected: true }) });
  await expectError(`/api/receivables/ledgers/${reporterCreated.id}`, tokens.reporterA!, 403, "RECEIVABLES_REPORTER_FIELD_NOT_ALLOWED", { method: "PATCH", body: jsonBody({ revision: 2, reason: "越权金额", finalAmount: "10" }) });
  await expectError(`/api/receivables/ledgers/${reporterCreated.id}`, tokens.reporterA!, 403, "RECEIVABLES_REPORTER_FIELD_NOT_ALLOWED", { method: "PATCH", body: jsonBody({ revision: 2, reason: "越权合同", contractNo: `${marker}-changed` }) });
  await expectError(`/api/receivables/ledgers/${reporterCreated.id}`, tokens.readonly!, 403, "RECEIVABLES_FORBIDDEN", { method: "PATCH", body: jsonBody({ revision: 2, reason: "只读禁止修改", collectionNotes: "no" }) });
  await expectError(`/api/receivables/ledgers/${reporterCreated.id}`, tokens.reporterA!, 409, "REVISION_CONFLICT", { method: "PATCH", body: jsonBody({ revision: 1, reason: "旧版本", collectionNotes: "stale" }) });
  const hidden = await request(`/api/receivables/ledgers/${reporterCreated.id}`, tokens.reporterB!, { method: "PATCH", body: jsonBody({ revision: 2, reason: "cross scope", collectionNotes: "hidden" }) });
  const absent = await request(`/api/receivables/ledgers/${randomUUID()}`, tokens.reporterB!, { method: "PATCH", body: jsonBody({ revision: 2, reason: "absent", collectionNotes: "hidden" }) });
  assert.equal(hidden.response.status, 404);
  assert.equal(absent.response.status, 404);
  assert.deepEqual(hidden.body.error, absent.body.error, "cross-scope patch must not disclose ledger existence");
  const rejectedFacts = await ledgerFacts(reporterCreated.id);
  assert.equal(rejectedFacts.ledger?.revision, 2);
  assert.equal(rejectedFacts.revisions.length, 1);
  assert.equal(rejectedFacts.audits.length, 2, "failed patches must write neither revisions nor audits");

  const raceContract = `${marker}-contract-race`;
  const createRace = await Promise.all([
    request<LedgerResponse>("/api/receivables/ledgers", tokens.owner!, { method: "POST", body: jsonBody({ financeDepartmentId: departmentA.id, contractNo: ` ${raceContract} ` }) }),
    request<LedgerResponse>("/api/receivables/ledgers", tokens.admin!, { method: "POST", body: jsonBody({ financeDepartmentId: departmentB.id, contractNo: raceContract }) }),
  ]);
  for (const result of createRace) if (result.body.data?.id) ids.ledgers.push(result.body.data.id);
  assert.deepEqual(createRace.map(({ response }) => response.status).sort(), [201, 409]);
  assert.equal(createRace.find(({ response }) => response.status === 409)?.body.error?.code, "RECEIVABLES_CONTRACT_NO_CONFLICT");
  assert.equal(await prisma.receivableLedger.count({ where: { contractNoNormalized: raceContract } }), 1);
  const raceCreated = createRace.find(({ response }) => response.status === 201)!.body.data!;
  assert.equal((await ledgerFacts(raceCreated.id)).audits.length, 1, "unique-race loser must not leave an audit");

  const concurrent = await createLedger(tokens.owner!, { financeDepartmentId: departmentA.id, contractNo: `${marker}-patch-race`, collectionNotes: "before race" });
  const beforeConcurrent = await ledgerFacts(concurrent.id);
  const patchRace = await Promise.all([
    request<LedgerResponse>(`/api/receivables/ledgers/${concurrent.id}`, tokens.owner!, { method: "PATCH", body: jsonBody({ revision: 1, reason: "owner race", collectionNotes: "owner won" }) }),
    request<LedgerResponse>(`/api/receivables/ledgers/${concurrent.id}`, tokens.admin!, { method: "PATCH", body: jsonBody({ revision: 1, reason: "admin race", collectionNotes: "admin won" }) }),
  ]);
  assert.deepEqual(patchRace.map(({ response }) => response.status).sort(), [200, 409]);
  assert.equal(patchRace.find(({ response }) => response.status === 409)?.body.error?.code, "REVISION_CONFLICT");
  const afterConcurrent = await ledgerFacts(concurrent.id);
  assert.equal(afterConcurrent.ledger?.revision, 2);
  assert.equal(afterConcurrent.revisions.length, beforeConcurrent.revisions.length + 1);
  assert.equal(afterConcurrent.audits.length, beforeConcurrent.audits.length + 1);
  assert.equal((afterConcurrent.revisions[0]!.beforeSnapshot as Record<string, unknown>).collectionNotes, "before race");
  assert.ok(["owner won", "admin won"].includes(afterConcurrent.ledger?.collectionNotes ?? ""));

  const revokeRaceContract = `${marker}-grant-revoke-race`;
  const revokeRaceAuditBefore = await prisma.auditLog.count({ where: { actorId: revokeRaceReporter.id, action: "receivables.ledger.create" } });
  let revokeRequest!: ReturnType<typeof request>;
  let revokeRaceWrite!: ReturnType<typeof request<LedgerResponse>>;
  let revokeRaceWriteWaited = false;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM receivable_access_grants WHERE id = ${revokeRaceGrant.id}::uuid FOR UPDATE`;
    revokeRequest = request(`/api/receivables/grants/${revokeRaceGrant.id}`, tokens.owner!, { method: "PATCH", body: jsonBody({ revision: revokeRaceGrant.revision, revoke: true, reason: "race revoke wins" }) });
    assert.equal(await waitForLockWaiters("receivable_access_grants", "UPDATE%", 1), true, "grant revocation did not enter the row-lock queue");
    revokeRaceWrite = request<LedgerResponse>("/api/receivables/ledgers", tokens.revokeRaceReporter!, { method: "POST", body: jsonBody({ financeDepartmentId: departmentA.id, contractNo: revokeRaceContract }) });
    revokeRaceWriteWaited = await waitForLockWaiters("receivable_access_grants", "%SELECT%FOR UPDATE%", 1);
  });
  const [revokeResult, revokeRaceWriteResult] = await Promise.all([revokeRequest, revokeRaceWrite]);
  if (revokeRaceWriteResult.body.data?.id) ids.ledgers.push(revokeRaceWriteResult.body.data.id);
  assert.equal(revokeRaceWriteWaited, true, "ledger write did not queue behind the earlier grant revocation");
  assert.equal(revokeResult.response.status, 200, JSON.stringify(revokeResult.body));
  assert.equal(revokeRaceWriteResult.response.status, 403, JSON.stringify(revokeRaceWriteResult.body));
  assert.equal(revokeRaceWriteResult.body.error?.code, "RECEIVABLES_FORBIDDEN");
  assert.equal(await prisma.receivableLedger.count({ where: { contractNoNormalized: revokeRaceContract } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { actorId: revokeRaceReporter.id, action: "receivables.ledger.create" } }), revokeRaceAuditBefore);

  const departmentCreateRaceContract = `${marker}-department-create-race-ledger`;
  const departmentCreateAuditBefore = await prisma.auditLog.count({ where: { actorId: owner.id, action: "receivables.ledger.create" } });
  let departmentDeactivateRequest!: ReturnType<typeof request>;
  let departmentCreateRequest!: ReturnType<typeof request<LedgerResponse>>;
  let departmentCreateWaited = false;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM receivable_departments WHERE id = ${createRaceDepartment.id}::uuid FOR UPDATE`;
    departmentDeactivateRequest = request(`/api/receivables/departments/${createRaceDepartment.id}`, tokens.owner!, { method: "PATCH", body: jsonBody({ revision: createRaceDepartment.revision, active: false, reason: "race deactivate wins" }) });
    assert.equal(await waitForLockWaiters("receivable_departments", "UPDATE%", 1), true, "department deactivation did not enter the row-lock queue");
    departmentCreateRequest = request<LedgerResponse>("/api/receivables/ledgers", tokens.owner!, { method: "POST", body: jsonBody({ financeDepartmentId: createRaceDepartment.id, contractNo: departmentCreateRaceContract }) });
    departmentCreateWaited = await waitForLockWaiters("receivable_departments", "%SELECT%FOR UPDATE%", 1);
  });
  const [departmentDeactivateResult, departmentCreateResult] = await Promise.all([departmentDeactivateRequest, departmentCreateRequest]);
  if (departmentCreateResult.body.data?.id) ids.ledgers.push(departmentCreateResult.body.data.id);
  assert.equal(departmentCreateWaited, true, "ledger create did not queue behind the earlier department deactivation");
  assert.equal(departmentDeactivateResult.response.status, 200, JSON.stringify(departmentDeactivateResult.body));
  assert.equal(departmentCreateResult.response.status, 409, JSON.stringify(departmentCreateResult.body));
  assert.equal(departmentCreateResult.body.error?.code, "RECEIVABLES_DEPARTMENT_INACTIVE");
  assert.equal(await prisma.receivableLedger.count({ where: { contractNoNormalized: departmentCreateRaceContract } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { actorId: owner.id, action: "receivables.ledger.create" } }), departmentCreateAuditBefore);

  const reassignRaceLedger = await createLedger(tokens.owner!, { financeDepartmentId: departmentA.id, contractNo: `${marker}-department-reassign-ledger` });
  const reassignFactsBefore = await ledgerFacts(reassignRaceLedger.id);
  let reassignDeactivateRequest!: ReturnType<typeof request>;
  let reassignPatchRequest!: ReturnType<typeof request<LedgerResponse>>;
  let reassignWaited = false;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM receivable_departments WHERE id = ${reassignRaceDepartment.id}::uuid FOR UPDATE`;
    reassignDeactivateRequest = request(`/api/receivables/departments/${reassignRaceDepartment.id}`, tokens.owner!, { method: "PATCH", body: jsonBody({ revision: reassignRaceDepartment.revision, active: false, reason: "race reassign deactivate wins" }) });
    assert.equal(await waitForLockWaiters("receivable_departments", "UPDATE%", 1), true, "reassignment target deactivation did not enter the row-lock queue");
    reassignPatchRequest = request<LedgerResponse>(`/api/receivables/ledgers/${reassignRaceLedger.id}`, tokens.owner!, { method: "PATCH", body: jsonBody({ revision: 1, reason: "race reassignment", financeDepartmentId: reassignRaceDepartment.id }) });
    reassignWaited = await waitForLockWaiters("receivable_departments", "%SELECT%FOR UPDATE%", 1);
  });
  const [reassignDeactivateResult, reassignPatchResult] = await Promise.all([reassignDeactivateRequest, reassignPatchRequest]);
  assert.equal(reassignWaited, true, "ledger reassignment did not queue behind the earlier target deactivation");
  assert.equal(reassignDeactivateResult.response.status, 200, JSON.stringify(reassignDeactivateResult.body));
  assert.equal(reassignPatchResult.response.status, 409, JSON.stringify(reassignPatchResult.body));
  assert.equal(reassignPatchResult.body.error?.code, "RECEIVABLES_DEPARTMENT_INACTIVE");
  const reassignFactsAfter = await ledgerFacts(reassignRaceLedger.id);
  assert.equal(reassignFactsAfter.ledger?.financeDepartmentId, departmentA.id);
  assert.equal(reassignFactsAfter.ledger?.revision, reassignFactsBefore.ledger?.revision);
  assert.equal(reassignFactsAfter.revisions.length, reassignFactsBefore.revisions.length);
  assert.equal(reassignFactsAfter.audits.length, reassignFactsBefore.audits.length);

  const atomic = await createLedger(tokens.admin!, { financeDepartmentId: departmentA.id, contractNo: `${marker}-audit-atomic`, collectionNotes: "atomic before" });
  const unrelatedContract = `${marker}-unrelated-p2002`;
  const escapedUnrelatedContract = unrelatedContract.replaceAll("'", "''");
  await prisma.$executeRawUnsafe(`CREATE FUNCTION "${triggerFunctionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP = 'INSERT' AND NEW.contract_no_normalized = '${escapedUnrelatedContract}' THEN RAISE EXCEPTION USING ERRCODE = '23505', CONSTRAINT = 'rxa_unrelated_unique'; END IF; IF TG_OP = 'UPDATE' AND NEW.collection_notes = 'unrelated-p2002' THEN RAISE EXCEPTION USING ERRCODE = '23505', CONSTRAINT = 'rxa_unrelated_update_unique'; END IF; RETURN NEW; END $$`);
  triggerInstalled = true;
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE UPDATE ON "receivable_ledgers" FOR EACH ROW EXECUTE FUNCTION "${triggerFunctionName}"()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}_insert" BEFORE INSERT ON "receivable_ledgers" FOR EACH ROW EXECUTE FUNCTION "${triggerFunctionName}"()`);
  const unrelatedAuditBefore = await prisma.auditLog.count({ where: { actorId: owner.id, action: "receivables.ledger.create" } });
  await expectError("/api/receivables/ledgers", tokens.owner!, 500, "INTERNAL_ERROR", { method: "POST", body: jsonBody({ financeDepartmentId: departmentA.id, contractNo: unrelatedContract }) });
  assert.equal(await prisma.receivableLedger.count({ where: { contractNoNormalized: unrelatedContract } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { actorId: owner.id, action: "receivables.ledger.create" } }), unrelatedAuditBefore, "unrelated P2002 must not leave a create audit");
  const unrelatedPatchBefore = await ledgerFacts(atomic.id);
  await expectError(`/api/receivables/ledgers/${atomic.id}`, tokens.admin!, 500, "INTERNAL_ERROR", { method: "PATCH", body: jsonBody({ revision: 1, reason: "unrelated unique", collectionNotes: "unrelated-p2002" }) });
  const unrelatedPatchAfter = await ledgerFacts(atomic.id);
  assert.equal(unrelatedPatchAfter.ledger?.revision, unrelatedPatchBefore.ledger?.revision);
  assert.equal(unrelatedPatchAfter.ledger?.collectionNotes, unrelatedPatchBefore.ledger?.collectionNotes);
  assert.equal(unrelatedPatchAfter.revisions.length, unrelatedPatchBefore.revisions.length);
  assert.equal(unrelatedPatchAfter.audits.length, unrelatedPatchBefore.audits.length);
  const atomicBefore = await ledgerFacts(atomic.id);
  let atomicRequest!: ReturnType<typeof request<LedgerResponse>>;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM receivable_ledgers WHERE id = ${atomic.id}::uuid FOR UPDATE`;
    atomicRequest = request<LedgerResponse>(`/api/receivables/ledgers/${atomic.id}`, tokens.admin!, { method: "PATCH", body: jsonBody({ revision: 1, reason: "force audit rollback", collectionNotes: "atomicity-change" }) });
    assert.equal(await waitForLockWaiters("receivable_ledgers", "%SELECT%FOR UPDATE%", 1), true, "atomicity write did not enter the ledger row-lock queue");
    await prisma.account.update({ where: { id: admin.id }, data: { status: "disabled" } });
  });
  const atomicFailure = await atomicRequest;
  assert.equal(atomicFailure.response.status, 409, JSON.stringify(atomicFailure.body));
  assert.equal(atomicFailure.body.error?.code, "ACTOR_STATE_CHANGED");
  await prisma.account.update({ where: { id: admin.id }, data: { status: "active" } });
  const atomicAfter = await ledgerFacts(atomic.id);
  assert.equal(atomicAfter.ledger?.revision, atomicBefore.ledger?.revision, "failed audit must roll back ledger update");
  assert.equal(atomicAfter.ledger?.collectionNotes, "atomic before");
  assert.equal(atomicAfter.revisions.length, atomicBefore.revisions.length, "failed audit must roll back before snapshot");
  assert.equal(atomicAfter.audits.length, atomicBefore.audits.length, "failed audit must not leave an audit row");

  const toVoid = await createLedger(tokens.owner!, { financeDepartmentId: departmentA.id, contractNo: `${marker}-void`, collectionNotes: "before void" });
  await expectError(`/api/receivables/ledgers/${toVoid.id}/void`, tokens.reporterA!, 403, "RECEIVABLES_REPORTER_FIELD_NOT_ALLOWED", { method: "POST", body: jsonBody({ revision: 1, reason: "reporter cannot void", confirm: true }) });
  await expectError(`/api/receivables/ledgers/${toVoid.id}/void`, tokens.readonly!, 403, "RECEIVABLES_FORBIDDEN", { method: "POST", body: jsonBody({ revision: 1, reason: "readonly cannot void", confirm: true }) });
  await expectError(`/api/receivables/ledgers/${toVoid.id}/void`, tokens.owner!, 400, "VALIDATION_ERROR", { method: "POST", body: jsonBody({ revision: 1, reason: "missing confirm", confirm: false }) });
  await expectError(`/api/receivables/ledgers/${toVoid.id}/void`, tokens.owner!, 400, "VALIDATION_ERROR", { method: "POST", body: jsonBody({ revision: 1, reason: "unknown", confirm: true, unexpected: true }) });
  const voided = (await expectStatus<LedgerResponse>(`/api/receivables/ledgers/${toVoid.id}/void`, tokens.owner!, 200, { method: "POST", body: jsonBody({ revision: 1, reason: "重复录入作废", confirm: true }) })).data!;
  assert.equal(voided.status, "voided");
  assert.equal(voided.revision, 2);
  assert.equal(voided.voidReason, "重复录入作废");
  const detail = (await expectStatus<{ ledger: LedgerResponse }>(`/api/receivables/ledgers/${toVoid.id}`, tokens.owner!, 200)).data!;
  assert.equal(detail.ledger.status, "voided", "voided detail must remain readable");
  const voidFacts = await ledgerFacts(toVoid.id);
  assert.equal(voidFacts.revisions.length, 1);
  assert.equal(voidFacts.audits.length, 2);
  assert.equal((voidFacts.revisions[0]!.beforeSnapshot as Record<string, unknown>).status, "active");
  await expectError(`/api/receivables/ledgers/${toVoid.id}`, tokens.owner!, 409, "RECEIVABLES_LEDGER_VOIDED", { method: "PATCH", body: jsonBody({ revision: 2, reason: "voided patch", collectionNotes: "no" }) });
  await expectError(`/api/receivables/ledgers/${toVoid.id}/void`, tokens.owner!, 409, "RECEIVABLES_LEDGER_VOIDED", { method: "POST", body: jsonBody({ revision: 2, reason: "repeat void", confirm: true }) });
  await expectError(`/api/receivables/ledgers/${toVoid.id}`, tokens.owner!, 404, "NOT_FOUND", { method: "DELETE" });
  const afterRejectedVoid = await ledgerFacts(toVoid.id);
  assert.equal(afterRejectedVoid.revisions.length, 1);
  assert.equal(afterRejectedVoid.audits.length, 2);

  const rebindOrganization = await prisma.organization.create({ data: { name: `${marker}-rebind-finance-org`, type: "department", parentId: company.id } }); ids.organizations.push(rebindOrganization.id);
  const setupRaceContract = `${marker}-setup-rebind-race`;
  const setupRaceAuditBefore = await prisma.auditLog.count({ where: { actorId: owner.id, action: "receivables.ledger.create" } });
  let rebindRequest!: ReturnType<typeof request>;
  let setupRaceWrite!: ReturnType<typeof request<LedgerResponse>>;
  let setupRaceWriteWaited = false;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 'locked'::text AS locked FROM pg_advisory_xact_lock(8645136501)`;
    rebindRequest = request("/api/receivables/setup/organization", tokens.companyAdmin!, { method: "PUT", body: jsonBody({ organizationId: rebindOrganization.id, reason: "race rebind wins", confirm: true }) });
    assert.equal(await waitForLockWaiters("pg_advisory_xact_lock", "%", 1), true, "setup rebind did not enter the advisory-lock queue");
    setupRaceWrite = request<LedgerResponse>("/api/receivables/ledgers", tokens.owner!, { method: "POST", body: jsonBody({ financeDepartmentId: departmentA.id, contractNo: setupRaceContract }) });
    setupRaceWriteWaited = await waitForLockWaiters("pg_advisory_xact_lock", "%", 2);
  });
  const [rebindResult, setupRaceWriteResult] = await Promise.all([rebindRequest, setupRaceWrite]);
  if (setupRaceWriteResult.body.data?.id) ids.ledgers.push(setupRaceWriteResult.body.data.id);
  assert.equal(setupRaceWriteWaited, true, "ledger write did not queue behind the earlier setup rebind");
  assert.equal(rebindResult.response.status, 200, JSON.stringify(rebindResult.body));
  assert.equal(setupRaceWriteResult.response.status, 403, JSON.stringify(setupRaceWriteResult.body));
  assert.equal(setupRaceWriteResult.body.error?.code, "RECEIVABLES_FORBIDDEN");
  assert.equal(await prisma.receivableLedger.count({ where: { contractNoNormalized: setupRaceContract } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { actorId: owner.id, action: "receivables.ledger.create" } }), setupRaceAuditBefore);

  console.log("RECEIVABLES_LEDGER_SMOKE=PASS");
} finally {
  await stopServer();
  if (ids.accounts.length) await prisma.account.updateMany({ where: { id: { in: ids.accounts } }, data: { status: "active" } });
  await cleanup();
  assert.equal(await prisma.auditLog.count({ where: { actorId: { in: ids.accounts }, action: { startsWith: "receivables." } } }), 0);
  assert.equal(await prisma.receivableLedgerRevision.count({ where: { ledgerId: { in: ids.ledgers } } }), 0);
  assert.equal(await prisma.receivableLedger.count({ where: { id: { in: ids.ledgers } } }), 0);
  assert.equal(await prisma.receivableSetting.count({ where: { financeOrganizationId: { in: ids.organizations } } }), 0);
  assert.equal(await prisma.receivableAccessGrant.count({ where: { id: { in: ids.grants } } }), 0);
  assert.equal(await prisma.receivableDepartment.count({ where: { id: { in: ids.departments } } }), 0);
  assert.equal(await prisma.refreshSession.count({ where: { id: { in: ids.sessions } } }), 0);
  assert.equal(await prisma.roleAssignment.count({ where: { id: { in: ids.roleAssignments } } }), 0);
  assert.equal(await prisma.account.count({ where: { id: { in: ids.accounts } } }), 0);
  assert.equal(await prisma.person.count({ where: { id: { in: ids.people } } }), 0);
  assert.equal(await prisma.organization.count({ where: { id: { in: ids.organizations } } }), 0);
  await prisma.$disconnect();
}
