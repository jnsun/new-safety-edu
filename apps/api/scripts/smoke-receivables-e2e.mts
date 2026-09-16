import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import argon2 from "argon2";
import { Prisma, PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";

const root = resolve(import.meta.dirname, "../../..");
const databaseUrl = process.env.DATABASE_URL ?? "";
const configuredBaseUrl = process.env.RECEIVABLES_API_BASE_URL ?? "http://127.0.0.1:55450";
const uploadRoot = resolve(root, "var/receivables-e2e-test");
const marker = `rxa-e2e-${randomUUID().slice(0, 8)}`;
const browserFixture = process.argv.slice(2).filter((argument) => argument !== "--").includes("--browser-fixture");
const teardownProbe = process.argv.slice(2).filter((argument) => argument !== "--").includes("--dev-teardown-probe");
const allowedArguments = new Set(["--", "--browser-fixture", "--dev-teardown-probe"]);
if (process.argv.slice(2).some((argument) => !allowedArguments.has(argument))) throw new Error("RECEIVABLES_E2E_ARGUMENT_INVALID");
if (browserFixture && teardownProbe) throw new Error("RECEIVABLES_E2E_ARGUMENT_INVALID");

function assertEnvironment() {
  let database: URL;
  let api: URL;
  try { database = new URL(databaseUrl); api = new URL(configuredBaseUrl); } catch { throw new Error("RECEIVABLES_E2E_URL_INVALID"); }
  const databaseName = decodeURIComponent(database.pathname.replace(/^\//, ""));
  if (database.protocol !== "postgresql:" || database.hostname !== "127.0.0.1" || database.port !== "55432" || database.username !== "postgres" || !databaseName.includes("receivables_e2e_test")) throw new Error("RECEIVABLES_E2E_DATABASE_URL_UNSAFE");
  if (api.protocol !== "http:" || api.hostname !== "127.0.0.1" || api.port !== "55450" || api.pathname !== "/" || api.username !== "" || api.password !== "" || api.search !== "" || api.hash !== "") throw new Error("RECEIVABLES_E2E_API_URL_UNSAFE");
  if (uploadRoot !== resolve(root, "var/receivables-e2e-test")) throw new Error("RECEIVABLES_E2E_UPLOAD_ROOT_UNSAFE");
  if (browserFixture && !existsSync(resolve(root, "apps/admin/dist/index.html"))) throw new Error("RECEIVABLES_BROWSER_BUILD_MISSING");
  return { databaseName, apiOrigin: api.origin };
}

const { databaseName, apiOrigin } = assertEnvironment();
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const jwtSecret = randomBytes(48).toString("base64url");
const cookieSecret = randomBytes(48).toString("base64url");
const uploadSigningSecret = randomBytes(48).toString("base64url");
const fieldEncryptionKey = randomBytes(32).toString("base64");
const ids = {
  organizations: [] as string[], people: [] as string[], accounts: [] as string[], roles: [] as string[],
  departments: [] as string[], grants: [] as string[], seedLedgers: [] as string[],
};
const credentials = new Map<string, { label: string; username: string; password: string; accountId: string; personId: string }>();
let server: ChildProcess | null = null;
let roleBroker: HttpServer | null = null;
let serverOutput = "";
let originalSetting: { financeOrganizationId: string | null; configurationConfirmedAt: Date | null; configurationConfirmedBy: string | null } | null = null;
let settingCaptured = false;
let phoneCounter = 1;

type RoleLabel = "owner" | "finance-admin" | "reporter-a" | "reporter-b" | "readonly" | "view-all" | "company-admin";
type Session = { label: RoleLabel; accountId: string; bearer: string };
type JsonBody<T = unknown> = { data?: T; error?: { code: string; message: string } };
type Access = { state: "unconfigured" | "pending_owner" | "pending_confirmation" | "ready"; role: "owner" | "admin" | "reporter" | "readonly" | null; canEnter: boolean; canReadLedger: boolean; canWriteLedger: boolean; canManageAll: boolean; canCreateLedger: boolean; canExport: boolean; canViewAll: boolean; canConfirmSetup: boolean; canRecover: boolean; readDepartmentIds: string[]; writeDepartmentIds: string[] };
type Ledger = { id: string; financeDepartmentId: string; contractNo: string; projectName: string | null; finalAmount: string | null; writeoffAmount: string; revision: number; status: "active" | "voided"; invoicedAmount?: string; receivedAmount?: string };
type LedgerDetail = { ledger: Ledger; invoices: Array<{ id: string; revision: number; status: string; amount: string }>; receipts: Array<{ id: string; revision: number; status: string; amount: string }>; attachments: Array<{ id: string; revision: number; status: string; file: { id: string; storageKey: string; size: number; sha256: string } }> };

const rolePaths: Record<RoleLabel, string> = {
  owner: "/receivables", "finance-admin": "/receivables/access",
  "reporter-a": "/receivables/ledger", "reporter-b": "/receivables/ledger",
  readonly: "/receivables/ledger", "view-all": "/receivables", "company-admin": "/receivables",
};

const delay = (milliseconds: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const hash = (content: Buffer) => createHash("sha256").update(content).digest("hex");
const json = (method: string, value: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
const httpFetch = (input: string | URL, init: RequestInit = {}, timeoutMs = 10_000) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });

async function createIdentity(label: RoleLabel, role?: "org_leader" | "company_admin", scopeId?: string) {
  const password = `T13!${randomBytes(18).toString("base64url")}Aa9`;
  const username = `${marker}-${label}`;
  const person = await prisma.person.create({ data: { name: `${marker}-${label}`, phone: `1940000${String(phoneCounter++).padStart(4, "0")}`, type: "employee", status: "active" } });
  ids.people.push(person.id);
  const account = await prisma.account.create({ data: { personId: person.id, username, usernameNormalized: username, passwordHash: await argon2.hash(password), passwordLoginEnabled: true, mustChangePassword: false, status: "active" } });
  ids.accounts.push(account.id);
  if (role) {
    const assignment = await prisma.roleAssignment.create({ data: { accountId: account.id, personId: person.id, role, scopeType: role === "company_admin" ? "company" : "organization", scopeId: scopeId ?? null } });
    ids.roles.push(assignment.id);
  }
  const value = { label, username, password, accountId: account.id, personId: person.id };
  credentials.set(label, value);
  return value;
}

async function createGrant(input: { accountId: string; grantedBy: string; role: "admin" | "reporter" | "readonly"; canCreate?: boolean; canExport?: boolean; canViewAll?: boolean; departmentId?: string }) {
  const grant = await prisma.receivableAccessGrant.create({ data: {
    accountId: input.accountId, grantedBy: input.grantedBy, role: input.role, canCreate: input.canCreate ?? false, canExport: input.canExport ?? false, canViewAll: input.canViewAll ?? false,
    ...(input.departmentId ? { departments: { create: { financeDepartmentId: input.departmentId, canRead: true, canWrite: input.role === "reporter" } } } : {}),
  } });
  ids.grants.push(grant.id);
  return grant;
}

async function setupFixture() {
  originalSetting = await prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } });
  settingCaptured = true;
  const company = await prisma.organization.create({ data: { name: `${marker}-company`, type: "company" } }); ids.organizations.push(company.id);
  const financeOrganization = await prisma.organization.create({ data: { name: `${marker}-finance`, type: "department", parentId: company.id } }); ids.organizations.push(financeOrganization.id);
  const replacementFinanceOrganization = await prisma.organization.create({ data: { name: `${marker}-finance-replacement`, type: "department", parentId: company.id } }); ids.organizations.push(replacementFinanceOrganization.id);
  const owner = await createIdentity("owner", "org_leader", financeOrganization.id);
  const replacementOwnerRole = await prisma.roleAssignment.create({ data: { accountId: owner.accountId, personId: owner.personId, role: "org_leader", scopeType: "organization", scopeId: replacementFinanceOrganization.id } });
  ids.roles.push(replacementOwnerRole.id);
  const financeAdmin = await createIdentity("finance-admin");
  const reporterA = await createIdentity("reporter-a");
  const reporterB = await createIdentity("reporter-b");
  const readonly = await createIdentity("readonly");
  const viewAll = await createIdentity("view-all");
  const companyAdmin = await createIdentity("company-admin", "company_admin");
  const departmentA = await prisma.receivableDepartment.create({ data: { name: `${marker}-department-a`, code: `${marker}-a` } });
  const departmentB = await prisma.receivableDepartment.create({ data: { name: `${marker}-department-b`, code: `${marker}-b` } });
  const inactiveDepartment = await prisma.receivableDepartment.create({ data: { name: `${marker}-inactive`, code: `${marker}-x`, active: false } });
  ids.departments.push(departmentA.id, departmentB.id, inactiveDepartment.id);
  await prisma.receivableSetting.upsert({ where: { id: 1 }, create: { id: 1, financeOrganizationId: financeOrganization.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.accountId }, update: { financeOrganizationId: financeOrganization.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.accountId } });
  const adminGrant = await createGrant({ accountId: financeAdmin.accountId, grantedBy: owner.accountId, role: "admin" });
  const reporterAGrant = await createGrant({ accountId: reporterA.accountId, grantedBy: owner.accountId, role: "reporter", canCreate: true, canExport: true, departmentId: departmentA.id });
  const reporterBGrant = await createGrant({ accountId: reporterB.accountId, grantedBy: owner.accountId, role: "reporter", canCreate: true, departmentId: departmentB.id });
  await createGrant({ accountId: readonly.accountId, grantedBy: owner.accountId, role: "readonly", departmentId: departmentA.id });
  await createGrant({ accountId: viewAll.accountId, grantedBy: owner.accountId, role: "readonly", canViewAll: true, canExport: true });
  const seedA = await prisma.receivableLedger.create({ data: { financeDepartmentId: departmentA.id, contractNo: `${marker}-browser-a`, contractNoNormalized: `${marker}-browser-a`, projectName: "浏览器验收 A", finalAmount: "100.0000", createdBy: owner.accountId } });
  const seedB = await prisma.receivableLedger.create({ data: { financeDepartmentId: departmentB.id, contractNo: `${marker}-browser-b`, contractNoNormalized: `${marker}-browser-b`, projectName: "浏览器验收 B", finalAmount: "200.0000", createdBy: owner.accountId } });
  ids.seedLedgers.push(seedA.id, seedB.id);
  return { company, financeOrganization, replacementFinanceOrganization, owner, financeAdmin, reporterA, reporterB, readonly, viewAll, companyAdmin, departmentA, departmentB, inactiveDepartment, adminGrant, reporterAGrant, reporterBGrant, seedA, seedB };
}

async function startServer() {
  await rm(uploadRoot, { recursive: true, force: true });
  await mkdir(uploadRoot, { recursive: true });
  server = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "apps/api/src/server.ts"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test", PORT: "55450", RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1", PUBLIC_BASE_URL: apiOrigin, COOKIE_SECRET: cookieSecret, JWT_SECRET: jwtSecret, FIELD_ENCRYPTION_KEY: fieldEncryptionKey, UPLOAD_SIGNING_SECRET: uploadSigningSecret, UPLOAD_ROOT: uploadRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr?.on("data", (chunk) => { serverOutput += String(chunk); });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Receivables E2E API exited before readiness:\n${serverOutput}`);
    try {
      if ((await httpFetch(`${apiOrigin}/api/health`, {}, 500)).status === 200) {
        assert.match(serverOutput, /RECEIVABLES_LISTEN_ADDRESS=127\.0\.0\.1/, "E2E API did not actually bind to loopback");
        return;
      }
    } catch {}
    await delay(50);
  }
  throw new Error(`Receivables E2E API did not become ready:\n${serverOutput}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, "exit");
  server.kill();
  const force = setTimeout(() => { if (server?.exitCode === null) server.kill("SIGKILL"); }, 5_000);
  force.unref();
  await exited;
  clearTimeout(force);
}

async function startRoleBroker() {
  assert.equal(browserFixture, true, "role broker is restricted to browser fixture mode");
  const brokerBaseUrl = "http://127.0.0.1:55451";
  const broker = createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("referrer-policy", "no-referrer");
    if (request.method !== "GET") { response.setHeader("allow", "GET"); response.writeHead(405).end(); return; }
    const match = new URL(request.url ?? "/", brokerBaseUrl).pathname.match(/^\/role\/([^/]+)$/);
    const label = match?.[1];
    if (!label || !Object.hasOwn(rolePaths, label)) { response.writeHead(404).end(); return; }
    const roleLabel = label as RoleLabel;
    try {
      const credential = credentials.get(roleLabel)!;
      const loginResponse = await httpFetch(`${apiOrigin}/api/auth/login`, json("POST", { username: credential.username, password: credential.password }));
      if (loginResponse.status !== 200) { response.writeHead(502).end(); return; }
      const setCookies = (loginResponse.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [loginResponse.headers.get("set-cookie") ?? ""];
      const cookies = setCookies.filter(Boolean);
      assert.ok(cookies.some((cookie) => cookie.startsWith("safety_session=")), `${roleLabel} broker login did not issue a session cookie`);
      response.setHeader("set-cookie", cookies);
      response.setHeader("location", `${apiOrigin}${rolePaths[roleLabel]}`);
      response.writeHead(302).end();
    } catch {
      response.writeHead(502).end();
    }
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    const reject = (error: Error) => rejectListen(error);
    broker.once("error", reject);
    broker.listen(55451, "127.0.0.1", () => { broker.off("error", reject); resolveListen(); });
  });
  roleBroker = broker;
  return Object.fromEntries((Object.keys(rolePaths) as RoleLabel[]).map((label) => [label, `${brokerBaseUrl}/role/${label}`]));
}

async function stopRoleBroker() {
  if (!roleBroker?.listening) { roleBroker = null; return; }
  const broker = roleBroker;
  roleBroker = null;
  broker.closeAllConnections();
  await new Promise<void>((resolveClose, rejectClose) => broker.close((error) => error ? rejectClose(error) : resolveClose()));
}

async function login(label: RoleLabel): Promise<Session> {
  const credential = credentials.get(label)!;
  const response = await httpFetch(`${apiOrigin}/api/auth/login`, json("POST", { username: credential.username, password: credential.password }));
  assert.equal(response.status, 200, `${label} login failed: ${await response.text()}`);
  const setCookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const accessCookie = setCookies.find((cookie) => cookie.startsWith("safety_session="));
  assert.ok(accessCookie, `${label} login did not issue a safety_session cookie`);
  return { label, accountId: credential.accountId, bearer: accessCookie!.split(";", 1)[0]!.slice("safety_session=".length) };
}

async function request<T>(session: Session, path: string, init: RequestInit = {}) {
  const response = await httpFetch(`${apiOrigin}${path}`, { ...init, headers: { authorization: `Bearer ${session.bearer}`, ...(typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...init.headers } });
  const text = await response.text();
  let body: JsonBody<T> = {};
  if (text) { try { body = JSON.parse(text) as JsonBody<T>; } catch { body = {} as JsonBody<T>; } }
  return { response, body, content: Buffer.from(text) };
}

async function expect<T>(session: Session, path: string, status: number, init: RequestInit = {}) {
  const result = await request<T>(session, path, init);
  assert.equal(result.response.status, status, `${session.label} ${init.method ?? "GET"} ${path}: ${JSON.stringify(result.body)}`);
  return result;
}

async function businessFacts() {
  // Refresh-session/auth telemetry is intentionally excluded: it is authentication state, not a receivables denial side effect.
  return prisma.$transaction(async (tx) => {
    const facts = await Promise.all([
      tx.receivableSetting.findMany({ orderBy: { id: "asc" } }),
      tx.receivableDepartment.findMany({ where: { id: { in: ids.departments } }, orderBy: { id: "asc" } }),
      tx.organization.findMany({ where: { id: { in: ids.organizations } }, orderBy: { id: "asc" } }),
      tx.receivableLedger.findMany({ where: { financeDepartmentId: { in: ids.departments } }, orderBy: { id: "asc" } }),
      tx.receivableLedgerRevision.findMany({ where: { ledger: { financeDepartmentId: { in: ids.departments } } }, orderBy: { id: "asc" } }),
      tx.receivableInvoice.findMany({ where: { ledger: { financeDepartmentId: { in: ids.departments } } }, orderBy: { id: "asc" } }),
      tx.receivableReceipt.findMany({ where: { ledger: { financeDepartmentId: { in: ids.departments } } }, orderBy: { id: "asc" } }),
      tx.receivableAttachment.findMany({ where: { ledger: { financeDepartmentId: { in: ids.departments } } }, orderBy: { id: "asc" } }),
      tx.privateFile.findMany({ where: { uploadedBy: { in: ids.accounts } }, orderBy: { id: "asc" } }),
      tx.receivableImportBatch.findMany({ where: { requestedBy: { in: ids.accounts } }, orderBy: { id: "asc" } }),
      tx.receivableImportItem.findMany({ where: { batch: { requestedBy: { in: ids.accounts } } }, orderBy: { id: "asc" } }),
      tx.receivableExportJob.findMany({ where: { requestedBy: { in: ids.accounts } }, orderBy: { id: "asc" } }),
      tx.notification.findMany({ where: { personId: { in: ids.people } }, orderBy: { id: "asc" } }),
      tx.notificationOutbox.findMany({ where: { notification: { personId: { in: ids.people } } }, orderBy: { id: "asc" } }),
      tx.auditLog.findMany({ where: { actorId: { in: ids.accounts } }, orderBy: { id: "asc" } }),
      tx.receivableAccessGrant.findMany({ where: { id: { in: ids.grants } }, orderBy: { id: "asc" } }),
      tx.receivableGrantDepartment.findMany({ where: { grantId: { in: ids.grants } }, orderBy: { id: "asc" } }),
    ]);
    return hash(Buffer.from(JSON.stringify(facts)));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

async function deniedWithoutMutation(session: Session, label: string, path: string, status: number, code: string | null, init: RequestInit = {}) {
  const before = await businessFacts();
  const result = await request(session, path, init);
  assert.equal(result.response.status, status, `${label}: ${JSON.stringify(result.body)}`);
  if (code) assert.equal(result.body.error?.code, code, label);
  assert.deepEqual(await businessFacts(), before, `${label} changed business/audit facts`);
  return result;
}

async function importWorkbook(departmentName: string, rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("台账").addRows([["归属部门", "合同编号", "项目名称", "决算方式", "合同金额", "决算金额", "开票金额", "开票日期", "到账金额", "到账日期"], ...rows.map((row) => [departmentName, ...row])]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function previewImport(session: Session, content: Buffer) {
  const form = new FormData();
  form.set("file", new Blob([content], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "task13-import.xlsx");
  return expect<any>(session, "/api/receivables/imports/preview", 201, { method: "POST", body: form });
}

async function waitForExport(jobId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const job = await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: jobId }, select: { status: true, rowCount: true, size: true, sha256: true, storageKey: true } });
    if (["completed", "failed"].includes(job.status)) return job;
    await delay(50);
  }
  throw new Error("RECEIVABLES_E2E_EXPORT_TIMEOUT");
}

async function cleanup() {
  const errors: unknown[] = [];
  const attempt = async (action: () => Promise<unknown>) => { try { await action(); } catch (error) { errors.push(error); } };
  const batches = await prisma.receivableImportBatch.findMany({ where: { requestedBy: { in: ids.accounts } }, select: { id: true, originalFileId: true } }).catch((error) => { errors.push(error); return []; });
  const ledgers = await prisma.receivableLedger.findMany({ where: { financeDepartmentId: { in: ids.departments } }, select: { id: true } }).catch((error) => { errors.push(error); return []; });
  const ledgerIds = ledgers.map(({ id }) => id);
  const attachments = await prisma.receivableAttachment.findMany({ where: { ledgerId: { in: ledgerIds } }, select: { fileId: true } }).catch((error) => { errors.push(error); return []; });
  await attempt(() => prisma.receivableExportJob.deleteMany({ where: { requestedBy: { in: ids.accounts } } }));
  await attempt(() => prisma.receivableImportItem.deleteMany({ where: { batchId: { in: batches.map(({ id }) => id) } } }));
  await attempt(() => prisma.receivableAttachment.deleteMany({ where: { ledgerId: { in: ledgerIds } } }));
  await attempt(() => prisma.receivableInvoice.deleteMany({ where: { ledgerId: { in: ledgerIds } } }));
  await attempt(() => prisma.receivableReceipt.deleteMany({ where: { ledgerId: { in: ledgerIds } } }));
  await attempt(() => prisma.receivableLedgerRevision.deleteMany({ where: { ledgerId: { in: ledgerIds } } }));
  await attempt(() => prisma.receivableLedger.deleteMany({ where: { id: { in: ledgerIds } } }));
  await attempt(() => prisma.receivableImportBatch.deleteMany({ where: { id: { in: batches.map(({ id }) => id) } } }));
  await attempt(() => prisma.privateFile.deleteMany({ where: { id: { in: [...batches.map(({ originalFileId }) => originalFileId), ...attachments.map(({ fileId }) => fileId)] } } }));
  await attempt(() => prisma.notificationOutbox.deleteMany({ where: { notification: { personId: { in: ids.people } } } }));
  await attempt(() => prisma.notification.deleteMany({ where: { personId: { in: ids.people } } }));
  await attempt(() => prisma.auditLog.deleteMany({ where: { actorId: { in: ids.accounts } } }));
  await attempt(() => prisma.authSecurityEvent.deleteMany({ where: { accountId: { in: ids.accounts } } }));
  await attempt(() => prisma.refreshSession.deleteMany({ where: { accountId: { in: ids.accounts } } }));
  if (settingCaptured) {
    if (originalSetting) await attempt(() => prisma.receivableSetting.upsert({ where: { id: 1 }, create: { id: 1, ...originalSetting }, update: originalSetting! }));
    else await attempt(() => prisma.receivableSetting.deleteMany({ where: { id: 1 } }));
  }
  await attempt(() => prisma.receivableGrantDepartment.deleteMany({ where: { grantId: { in: ids.grants } } }));
  await attempt(() => prisma.receivableAccessGrant.deleteMany({ where: { id: { in: ids.grants } } }));
  await attempt(() => prisma.receivableDepartment.deleteMany({ where: { id: { in: ids.departments } } }));
  await attempt(() => prisma.roleAssignment.deleteMany({ where: { id: { in: ids.roles } } }));
  await attempt(() => prisma.account.deleteMany({ where: { id: { in: ids.accounts } } }));
  await attempt(() => prisma.person.deleteMany({ where: { id: { in: ids.people } } }));
  await attempt(() => prisma.organization.deleteMany({ where: { id: { in: ids.organizations } } }));
  await attempt(() => rm(uploadRoot, { recursive: true, force: true }));
  if (errors.length) throw new AggregateError(errors, "receivables E2E cleanup failed");
}

async function assertClean() {
  const [ledgers, departments, accounts, people, organizations, grants, sessions, audits, authEvents, batches, jobs, files, uploadState, setting, apiPortClosed, brokerPortClosed] = await Promise.all([
    prisma.receivableLedger.count({ where: { financeDepartmentId: { in: ids.departments } } }), prisma.receivableDepartment.count({ where: { id: { in: ids.departments } } }),
    prisma.account.count({ where: { id: { in: ids.accounts } } }), prisma.person.count({ where: { id: { in: ids.people } } }), prisma.organization.count({ where: { id: { in: ids.organizations } } }),
    prisma.receivableAccessGrant.count({ where: { id: { in: ids.grants } } }), prisma.refreshSession.count({ where: { accountId: { in: ids.accounts } } }), prisma.auditLog.count({ where: { actorId: { in: ids.accounts } } }),
    prisma.authSecurityEvent.count({ where: { accountId: { in: ids.accounts } } }), prisma.receivableImportBatch.count({ where: { requestedBy: { in: ids.accounts } } }), prisma.receivableExportJob.count({ where: { requestedBy: { in: ids.accounts } } }), prisma.privateFile.count({ where: { uploadedBy: { in: ids.accounts } } }),
    stat(uploadRoot).then(() => "present", (error: NodeJS.ErrnoException) => error.code === "ENOENT" ? "absent" : Promise.reject(error)),
    prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } }),
    new Promise<boolean>((resolveClosed) => { const socket = createConnection({ host: "127.0.0.1", port: 55450 }); socket.once("connect", () => { socket.destroy(); resolveClosed(false); }); socket.once("error", () => resolveClosed(true)); }),
    new Promise<boolean>((resolveClosed) => { const socket = createConnection({ host: "127.0.0.1", port: 55451 }); socket.once("connect", () => { socket.destroy(); resolveClosed(false); }); socket.once("error", () => resolveClosed(true)); }),
  ]);
  assert.deepEqual({ ledgers, departments, accounts, people, organizations, grants, sessions, audits, authEvents, batches, jobs, files, uploadState, apiPortClosed, brokerPortClosed }, { ledgers: 0, departments: 0, accounts: 0, people: 0, organizations: 0, grants: 0, sessions: 0, audits: 0, authEvents: 0, batches: 0, jobs: 0, files: 0, uploadState: "absent", apiPortClosed: true, brokerPortClosed: true });
  assert.deepEqual(setting, originalSetting, "E2E did not restore the exact receivable setting baseline");
}

async function runAutomated(fixture: Awaited<ReturnType<typeof setupFixture>>) {
  const labels: RoleLabel[] = ["owner", "finance-admin", "reporter-a", "reporter-b", "readonly", "view-all", "company-admin"];
  const loggedIn = await Promise.all(labels.map(login));
  const sessions = Object.fromEntries(loggedIn.map((session) => [session.label, session])) as Record<RoleLabel, Session>;
  assert.equal(new Set(loggedIn.map(({ bearer }) => bearer)).size, 7, "seven independent logins did not issue seven JWT cookies");
  const sessionRows = await prisma.refreshSession.findMany({ where: { accountId: { in: ids.accounts }, revokedAt: null }, select: { id: true, accountId: true } });
  assert.equal(new Set(sessionRows.map(({ id }) => id)).size, 7);
  assert.equal(sessionRows.filter(({ accountId }) => [fixture.reporterA.accountId, fixture.reporterB.accountId].includes(accountId)).length, 2, "reporters do not have genuinely independent sessions");

  const expectedRoles: Record<RoleLabel, Access["role"]> = { owner: "owner", "finance-admin": "admin", "reporter-a": "reporter", "reporter-b": "reporter", readonly: "readonly", "view-all": "readonly", "company-admin": null };
  for (const label of labels) {
    const access = (await expect<Access>(sessions[label], "/api/receivables/access", 200)).body.data!;
    assert.equal(access.role, expectedRoles[label]);
    assert.equal(access.canEnter, label !== "company-admin");
  }
  const companyAccess = (await expect<Access>(sessions["company-admin"], "/api/receivables/access", 200)).body.data!;
  assert.equal(companyAccess.canRecover, true); assert.equal(companyAccess.canReadLedger, false);
  const reboundAccess = (await expect<Access>(sessions["company-admin"], "/api/receivables/setup/organization", 200, json("PUT", { organizationId: fixture.replacementFinanceOrganization.id, confirm: true, reason: "Task 13 真实换绑验证" }))).body.data!;
  assert.equal(reboundAccess.state, "pending_confirmation"); assert.equal(reboundAccess.canRecover, true); assert.equal(reboundAccess.canReadLedger, false);
  let reboundSetting = await prisma.receivableSetting.findUniqueOrThrow({ where: { id: 1 } });
  assert.equal(reboundSetting.financeOrganizationId, fixture.replacementFinanceOrganization.id); assert.equal(reboundSetting.configurationConfirmedAt, null); assert.equal(reboundSetting.configurationConfirmedBy, null);
  assert.equal(await prisma.auditLog.count({ where: { actorId: fixture.companyAdmin.accountId, action: "receivables.setup.rebind", objectId: fixture.replacementFinanceOrganization.id } }), 1);
  await deniedWithoutMutation(sessions["company-admin"], "company admin finance data denial after rebind", "/api/receivables/ledgers?status=all&settlement=all", 403, "RECEIVABLES_FORBIDDEN");
  const replacementOwnerAccess = (await expect<Access>(sessions.owner, "/api/receivables/access", 200)).body.data!;
  assert.equal(replacementOwnerAccess.state, "pending_confirmation"); assert.equal(replacementOwnerAccess.canConfirmSetup, true);
  assert.equal((await expect<Access>(sessions.owner, "/api/receivables/setup/confirm", 200, json("POST", {}))).body.data!.state, "ready");
  const restoredAccess = (await expect<Access>(sessions["company-admin"], "/api/receivables/setup/organization", 200, json("PUT", { organizationId: fixture.financeOrganization.id, confirm: true, reason: "Task 13 恢复原财务组织" }))).body.data!;
  assert.equal(restoredAccess.state, "pending_confirmation"); assert.equal(restoredAccess.canReadLedger, false);
  reboundSetting = await prisma.receivableSetting.findUniqueOrThrow({ where: { id: 1 } });
  assert.equal(reboundSetting.financeOrganizationId, fixture.financeOrganization.id); assert.equal(reboundSetting.configurationConfirmedAt, null); assert.equal(reboundSetting.configurationConfirmedBy, null);
  assert.equal((await expect<Access>(sessions.owner, "/api/receivables/setup/confirm", 200, json("POST", {}))).body.data!.state, "ready");
  await deniedWithoutMutation(sessions["company-admin"], "company admin finance data denial", "/api/receivables/ledgers?status=all&settlement=all", 403, "RECEIVABLES_FORBIDDEN");

  const reporterAList = await expect<{ rows: Ledger[]; total: number }>(sessions["reporter-a"], `/api/receivables/ledgers?status=all&settlement=all&search=${encodeURIComponent(marker)}`, 200);
  assert.equal(reporterAList.body.data!.rows.every(({ financeDepartmentId }) => financeDepartmentId === fixture.departmentA.id), true);
  const reporterBList = await expect<{ rows: Ledger[]; total: number }>(sessions["reporter-b"], `/api/receivables/ledgers?status=all&settlement=all&search=${encodeURIComponent(marker)}`, 200);
  assert.equal(reporterBList.body.data!.rows.every(({ financeDepartmentId }) => financeDepartmentId === fixture.departmentB.id), true);
  const viewAllList = await expect<{ rows: Ledger[]; total: number }>(sessions["view-all"], `/api/receivables/ledgers?status=all&settlement=all&search=${encodeURIComponent(marker)}`, 200);
  assert.equal(viewAllList.body.data!.total, 2);
  await deniedWithoutMutation(sessions["reporter-a"], "cross-department detail", `/api/receivables/ledgers/${fixture.seedB.id}`, 404, "RECEIVABLES_LEDGER_NOT_FOUND");
  await deniedWithoutMutation(sessions["reporter-a"], "cross-department create", "/api/receivables/ledgers", 403, "RECEIVABLES_FORBIDDEN", json("POST", { financeDepartmentId: fixture.departmentB.id, contractNo: `${marker}-cross-create` }));
  await deniedWithoutMutation(sessions.owner, "inactive department create", "/api/receivables/ledgers", 409, "RECEIVABLES_DEPARTMENT_INACTIVE", json("POST", { financeDepartmentId: fixture.inactiveDepartment.id, contractNo: `${marker}-inactive-create` }));

  const createdA = (await expect<Ledger>(sessions["reporter-a"], "/api/receivables/ledgers", 201, json("POST", { financeDepartmentId: fixture.departmentA.id, contractNo: `${marker}-http-a`, projectName: "报账员 A", debtStatus: "正常催收" }))).body.data!;
  const createdB = (await expect<Ledger>(sessions["reporter-b"], "/api/receivables/ledgers", 201, json("POST", { financeDepartmentId: fixture.departmentB.id, contractNo: `${marker}-http-b`, projectName: "报账员 B", debtStatus: "正常催收" }))).body.data!;
  await deniedWithoutMutation(sessions["reporter-a"], "reporter amount field denial", `/api/receivables/ledgers/${createdA.id}`, 403, "RECEIVABLES_REPORTER_FIELD_NOT_ALLOWED", json("PATCH", { revision: 1, reason: "越权金额", finalAmount: "10.0000" }));
  let ledgerA = (await expect<Ledger>(sessions["reporter-a"], `/api/receivables/ledgers/${createdA.id}`, 200, json("PATCH", { revision: 1, reason: "更新催收", collectionNotes: "已联系客户" }))).body.data!;
  assert.equal(ledgerA.revision, 2);
  await deniedWithoutMutation(sessions["reporter-a"], "optimistic conflict", `/api/receivables/ledgers/${createdA.id}`, 409, "REVISION_CONFLICT", json("PATCH", { revision: 1, reason: "旧版本", collectionNotes: "stale" }));
  await deniedWithoutMutation(sessions.readonly, "readonly write denial", `/api/receivables/ledgers/${createdA.id}`, 403, "RECEIVABLES_FORBIDDEN", json("PATCH", { revision: 2, reason: "只读越权", collectionNotes: "no" }));
  await deniedWithoutMutation(sessions["reporter-a"], "reporter money denial", `/api/receivables/ledgers/${createdA.id}/invoices`, 403, "RECEIVABLES_FORBIDDEN", json("POST", { ledgerRevision: 2, invoiceDate: "2026-09-01", amount: "10.0000" }));

  ledgerA = (await expect<Ledger>(sessions["finance-admin"], `/api/receivables/ledgers/${createdA.id}`, 200, json("PATCH", { revision: 2, reason: "确认决算金额", finalAmount: "100.0000" }))).body.data!;
  const invoice = (await expect<{ id: string; revision: number }>(sessions["finance-admin"], `/api/receivables/ledgers/${createdA.id}/invoices`, 201, json("POST", { ledgerRevision: 3, invoiceDate: "2026-09-01", invoiceNo: `${marker}-invoice`, amount: "80.0000" }))).body.data!;
  await expect(sessions["finance-admin"], `/api/receivables/ledgers/${createdA.id}/receipts`, 201, json("POST", { ledgerRevision: 4, receiptDate: "2026-09-02", referenceNo: `${marker}-receipt`, amount: "30.0000" }));
  await expect(sessions["finance-admin"], `/api/receivables/ledgers/${createdA.id}/invoices/${invoice.id}/void`, 200, json("POST", { ledgerRevision: 5, revision: invoice.revision, reason: "发票更正" }));
  ledgerA = (await expect<{ ledger: Ledger }>(sessions.owner, `/api/receivables/ledgers/${createdA.id}`, 200)).body.data!.ledger;
  assert.equal(ledgerA.invoicedAmount, "0.0000"); assert.equal(ledgerA.receivedAmount, "30.0000"); assert.equal(ledgerA.revision, 6);
  ledgerA = (await expect<{ ledger: Ledger }>(sessions["finance-admin"], `/api/receivables/ledgers/${createdA.id}/writeoff`, 200, json("PATCH", { ledgerRevision: 6, reason: "批准核销", writeoffAmount: "10.0000" }))).body.data!.ledger;
  assert.equal(ledgerA.revision, 7);

  const pdf = Buffer.from("%PDF-1.4\nTask 13 isolated attachment\n");
  const attachmentForm = new FormData(); attachmentForm.set("ledgerRevision", String(ledgerA.revision)); attachmentForm.set("category", "contract"); attachmentForm.set("file", new Blob([pdf], { type: "application/pdf" }), "task13-proof.pdf");
  const attachment = (await expect<{ id: string; revision: number; file: { id: string; storageKey: string; size: number; sha256: string } }>(sessions["reporter-a"], `/api/receivables/ledgers/${createdA.id}/attachments`, 201, { method: "POST", body: attachmentForm })).body.data!;
  assert.equal(attachment.file.size, pdf.length); assert.equal(attachment.file.sha256, hash(pdf));
  const downloadedFile = await httpFetch(`${apiOrigin}/api/files/${attachment.file.id}`, { headers: { authorization: `Bearer ${sessions["reporter-a"].bearer}` } });
  assert.equal(downloadedFile.status, 200); assert.deepEqual(Buffer.from(await downloadedFile.arrayBuffer()), pdf);
  for (let attempt = 0; attempt < 100 && await prisma.auditLog.count({ where: { action: "file.read", objectId: attachment.file.id } }) < 1; attempt += 1) await delay(20);
  assert.equal(await prisma.auditLog.count({ where: { action: "file.read", objectId: attachment.file.id } }), 1);
  await deniedWithoutMutation(sessions["reporter-b"], "cross-department file denial", `/api/files/${attachment.file.id}`, 403, "SCOPE_FORBIDDEN");

  const invalidPreview = await previewImport(sessions["finance-admin"], await importWorkbook(fixture.departmentA.name, [["", "missing contract", "合同金额", "1", "", "", "", "", ""]]));
  assert.ok(invalidPreview.body.data.errors.length > 0);
  await deniedWithoutMutation(sessions["finance-admin"], "blocking import apply", `/api/receivables/imports/${invalidPreview.body.data.batchId}/apply`, 422, "IMPORT_HAS_BLOCKING_ERRORS", json("POST", { revision: invalidPreview.body.data.revision, decisions: [] }));

  const validPreview = await previewImport(sessions["finance-admin"], await importWorkbook(fixture.departmentA.name, [
    [`${marker}-import-new`, "导入新增", "合同金额", "100.0000", "", "20.0000", "2026-09-03", "5.0000", "2026-09-04"],
    [fixture.seedA.contractNo, "导入更新", "合同金额", "100.0000", "", "", "", "", ""],
  ]));
  assert.equal(validPreview.body.data.errors.length, 0);
  const applied = await expect<any>(sessions["finance-admin"], `/api/receivables/imports/${validPreview.body.data.batchId}/apply`, 200, json("POST", { revision: validPreview.body.data.revision, decisions: [{ rowNumber: 3, decision: "update" }] }));
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { contractNoNormalized: `${marker}-import-new` } })).createdByImportBatchId, validPreview.body.data.batchId);
  let importedExisting = await prisma.receivableLedger.findUniqueOrThrow({ where: { id: fixture.seedA.id } });
  assert.equal(importedExisting.projectName, "导入更新");
  await expect(sessions["finance-admin"], `/api/receivables/ledgers/${fixture.seedA.id}`, 200, json("PATCH", { revision: importedExisting.revision, reason: "导入后继续维护", collectionNotes: "newer fact" }));
  importedExisting = await prisma.receivableLedger.findUniqueOrThrow({ where: { id: fixture.seedA.id } });
  const beforeRollbackConflict = await businessFacts();
  const rollbackConflict = await request(sessions["finance-admin"], `/api/receivables/imports/${validPreview.body.data.batchId}/rollback`, json("POST", { revision: applied.body.data.revision, reason: "不得覆盖后续事实" }));
  assert.equal(rollbackConflict.response.status, 409); assert.equal(rollbackConflict.body.error?.code, "IMPORT_ROLLBACK_CONFLICT");
  assert.deepEqual(await businessFacts(), beforeRollbackConflict, "rollback conflict wrote partial corrections or audit");

  const exportRequest = await expect<{ id: string }>(sessions["view-all"], "/api/receivables/exports", 202, json("POST", { idempotencyKey: randomUUID(), filters: { status: "all", settlement: "all", search: marker } }));
  const jobId = exportRequest.body.data!.id;
  const exportJob = await waitForExport(jobId);
  assert.equal(exportJob.status, "completed", serverOutput);
  const expectedExportRows = await prisma.receivableLedger.count({ where: { contractNoNormalized: { startsWith: marker } } });
  assert.equal(exportJob.rowCount, expectedExportRows);
  const issued = await expect<{ token: string }>(sessions["view-all"], `/api/receivables/exports/${jobId}/token`, 200, json("POST", {}));
  const exportResponse = await httpFetch(`${apiOrigin}/api/receivables/exports/${jobId}/download`, { method: "POST", headers: { authorization: `Bearer ${sessions["view-all"].bearer}`, "content-type": "application/json" }, body: JSON.stringify({ token: issued.body.data!.token }) });
  assert.equal(exportResponse.status, 200);
  const exportBytes = Buffer.from(await exportResponse.arrayBuffer());
  assert.equal(hash(exportBytes), exportJob.sha256);
  const exportWorkbook = new ExcelJS.Workbook(); await exportWorkbook.xlsx.load(exportBytes as unknown as ExcelJS.Buffer);
  assert.equal(exportWorkbook.worksheets[0]!.rowCount, expectedExportRows + 1);
  await deniedWithoutMutation(sessions["view-all"], "one-use export token reuse", `/api/receivables/exports/${jobId}/download`, 409, "RECEIVABLES_EXPORT_TOKEN_INVALID", json("POST", { token: issued.body.data!.token }));

  const revoke = await expect<any>(sessions.owner, `/api/receivables/grants/${fixture.reporterBGrant.id}`, 200, json("PATCH", { revision: fixture.reporterBGrant.revision, revoke: true, reason: "Task 13 即时撤权" }));
  assert.equal(revoke.body.data.active, false);
  const revokedAccess = (await expect<Access>(sessions["reporter-b"], "/api/receivables/access", 200)).body.data!;
  assert.equal(revokedAccess.role, null); assert.equal(revokedAccess.canEnter, false);
  await deniedWithoutMutation(sessions["reporter-b"], "revoked finance request", "/api/receivables/ledgers?status=all&settlement=all", 403, "RECEIVABLES_FORBIDDEN");
  await expect(sessions["reporter-b"], "/api/auth/me", 200);
  assert.ok(createdB.id);

  const actions = new Set((await prisma.auditLog.findMany({ where: { actorId: { in: ids.accounts } }, select: { action: true } })).map(({ action }) => action));
  for (const action of [
    "receivables.setup.rebind", "receivables.setup.confirm",
    "receivables.ledger.create", "receivables.ledger.patch", "receivables.money.invoice.create", "receivables.money.receipt.create", "receivables.money.invoice.void", "receivables.money.writeoff.patch",
    "receivables.attachment.create", "file.read", "receivables.import.preview", "receivables.import.apply", "receivables.import.item.create", "receivables.import.item.update",
    "receivables.export.request", "receivables.export.claim", "receivables.export.complete", "receivables.export.token", "receivables.export.download", "receivables.admin.grant.revoke",
  ]) assert.equal(actions.has(action), true, `missing critical audit action ${action}`);
  assert.equal((await readdir(uploadRoot, { recursive: true })).some((entry) => String(entry).endsWith(".uploading")), false, "temporary upload files remain");
  return { sessions: 7, ledgers: expectedExportRows, exportRows: exportJob.rowCount, audits: actions.size, databaseName };
}

async function holdBrowserFixture() {
  const roleUrls = await startRoleBroker();
  console.log(`RECEIVABLES_BROWSER_FIXTURE=${JSON.stringify({ roleUrls })}`);
  await new Promise<void>((resolveSignal) => {
    let finished = false;
    const parentPid = process.ppid;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(parentWatch);
      process.stdin.off("data", onInput); process.stdin.off("end", finish); process.stdin.off("close", finish);
      process.off("SIGINT", finish); process.off("SIGTERM", finish); process.off("SIGHUP", finish); process.off("disconnect", finish);
      process.stdin.pause();
      resolveSignal();
    };
    const onInput = (chunk: Buffer | string) => { const input = String(chunk); if (/q/i.test(input) || /[\r\n]/.test(input)) finish(); };
    const parentWatch = setInterval(() => { try { process.kill(parentPid, 0); } catch { finish(); } }, 500);
    parentWatch.unref();
    process.stdin.on("data", onInput); process.stdin.once("end", finish); process.stdin.once("close", finish); process.stdin.resume();
    process.once("SIGINT", finish); process.once("SIGTERM", finish); process.once("SIGHUP", finish); process.once("disconnect", finish);
  });
}

let result: Record<string, unknown> | null = null;
const failures: unknown[] = [];
try {
  const fixture = await setupFixture();
  await startServer();
  if (browserFixture) await holdBrowserFixture();
  else if (!teardownProbe) result = await runAutomated(fixture);
} catch (error) {
  failures.push(error);
}

const completedTeardownSteps: string[] = [];
const teardownSteps: Array<[string, () => Promise<unknown>]> = [
  ["broker", stopRoleBroker],
  ["stop", async () => { await stopServer(); if (teardownProbe) throw new Error("RECEIVABLES_E2E_INJECTED_STOP_FAILURE"); }],
  ["cleanup", async () => { await delay(100); await cleanup(); }],
  ["residual", assertClean],
  ["disconnect", () => prisma.$disconnect()],
];
for (const [label, action] of teardownSteps) {
  try { await action(); completedTeardownSteps.push(label); } catch (error) { failures.push(Object.assign(new Error(`RECEIVABLES_E2E_TEARDOWN_${label.toUpperCase()}`), { cause: error })); }
}

if (teardownProbe) {
  assert.equal(failures.length, 1, `teardown probe had unexpected failures: ${failures.map(String).join(" | ")}`);
  assert.match(String((failures[0] as Error & { cause?: unknown }).cause), /RECEIVABLES_E2E_INJECTED_STOP_FAILURE/);
  assert.deepEqual(completedTeardownSteps, ["broker", "cleanup", "residual", "disconnect"]);
  console.log(`RECEIVABLES_E2E_TEARDOWN_PROBE=${JSON.stringify({ result: "PASS", injectedFailureObserved: true, continued: completedTeardownSteps, cleanup: "zero-residual" })}`);
} else {
  if (failures.length) throw new AggregateError(failures, "receivables E2E run/teardown failed");
  if (!browserFixture) console.log(`RECEIVABLES_E2E=${JSON.stringify({ result: "PASS", ...result, cleanup: "zero-residual" })}`);
}
