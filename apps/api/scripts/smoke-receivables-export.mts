import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { SignJWT } from "jose";

const expectedDatabaseUrl = "postgresql://postgres@127.0.0.1:55432/receivables_test";
const databaseUrl = process.env.DATABASE_URL ?? "";
assert.equal(databaseUrl, expectedDatabaseUrl, `Refusing to run outside ${expectedDatabaseUrl}`);
const baseUrl = process.env.RECEIVABLES_API_BASE_URL ?? "http://127.0.0.1:55448";
const apiUrl = new URL(baseUrl);
assert.deepEqual({ hostname: apiUrl.hostname, port: apiUrl.port }, { hostname: "127.0.0.1", port: "55448" });
const root = resolve(import.meta.dirname, "../../..");
const uploadRoot = resolve(root, ".artifact-work", "task10-receivables-uploads");
assert.match(uploadRoot, /[\\/]\.artifact-work[\\/]task10-receivables-uploads$/i, "Refusing unsafe Task10 upload root");
const marker = `rxa-export-${randomUUID()}`;
const jwtSecret = "receivables-export-smoke-jwt-secret";
const prisma = new PrismaClient();
const ids = { accounts: [] as string[], people: [] as string[], organizations: [] as string[], roles: [] as string[], sessions: [] as string[], departments: [] as string[], grants: [] as string[] };
let server: ChildProcess | null = null;
let serverOutput = "";
const serverMessages: string[] = [];
let shutdownRequested = false;
let phone = Math.floor(Math.random() * 900_000) + 100_000;
let originalSetting: { financeOrganizationId: string | null; configurationConfirmedAt: Date | null; configurationConfirmedBy: string | null } | null = null;
let settingExisted = false;
let failure: unknown;

type Json<T = unknown> = { data?: T; error?: { code: string; message: string } };
type Job = { id: string; status: "pending" | "processing" | "completed" | "failed" | "expired"; rowCount: number | null; size: number | null; sha256: string | null; error: string | null };
type GrantRole = "admin" | "reporter" | "readonly";
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function identity(label: string, role?: "org_leader" | "company_admin", scopeId?: string) {
  const person = await prisma.person.create({ data: { name: `${marker}-${label}`, phone: `18${String(phone++).padStart(9, "0")}`, type: "employee", status: "active" } });
  ids.people.push(person.id);
  const account = await prisma.account.create({ data: { username: `${marker}-${label}`, usernameNormalized: `${marker}-${label}`, status: "active", personId: person.id } });
  ids.accounts.push(account.id);
  if (role) {
    const row = await prisma.roleAssignment.create({ data: { accountId: account.id, personId: person.id, role, scopeType: role === "company_admin" ? "company" : "organization", scopeId: scopeId ?? null } });
    ids.roles.push(row.id);
  }
  return account;
}

async function grant(accountId: string, grantedBy: string, role: GrantRole, departmentIds: string[], canExport: boolean, canViewAll = false) {
  const row = await prisma.receivableAccessGrant.create({ data: { accountId, grantedBy, role, canExport, canViewAll, departments: { create: departmentIds.map((financeDepartmentId) => ({ financeDepartmentId, canRead: true, canWrite: role === "reporter" })) } } });
  ids.grants.push(row.id);
  return row;
}

async function bearer(accountId: string) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { sessionVersion: true } });
  const session = await prisma.refreshSession.create({ data: { accountId, tokenHash: `smoke-${randomUUID()}`, clientKind: "rxa-export-smoke", expiresAt: new Date(Date.now() + 3_600_000), absoluteExpiresAt: new Date(Date.now() + 3_600_000) } });
  ids.sessions.push(session.id);
  return new SignJWT({ ver: account.sessionVersion, sid: session.id }).setProtectedHeader({ alg: "HS256" }).setSubject(accountId).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(jwtSecret));
}

async function request<T>(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
  const body = response.headers.get("content-type")?.includes("application/json") ? await response.json() as Json<T> : undefined;
  return { response, body };
}

async function expect<T>(path: string, token: string, status: number, init: RequestInit = {}) {
  const result = await request<T>(path, token, init);
  assert.equal(result.response.status, status, `${init.method ?? "GET"} ${path}: ${JSON.stringify(result.body)}\n${result.response.status >= 500 ? serverOutput : ""}`);
  return result;
}

const post = <T>(path: string, token: string, body: unknown, status = 200) => expect<T>(path, token, status, { method: "POST", body: JSON.stringify(body) });
const createExport = <T>(token: string, filters: Record<string, unknown>, status = 202, idempotencyKey = randomUUID(), selection: Record<string, unknown> = {}) => post<T>("/api/receivables/exports", token, { idempotencyKey, filters, ...selection }, status);

async function waitForJob(jobId: string, wanted: Job["status"][]) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const row = await prisma.receivableExportJob.findUnique({ where: { id: jobId } });
    if (row && wanted.includes(row.status)) return row;
    await delay(100);
  }
  throw new Error(`Timed out waiting for export ${jobId}: ${serverOutput}`);
}

async function waitForBlockedDatabaseQuery(fragment: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT COALESCE(bool_or(cardinality(pg_blocking_pids(pid)) > 0), false) AS blocked
      FROM pg_stat_activity WHERE datname = current_database()
    `;
    if (rows[0]?.blocked) return;
    await delay(20);
  }
  const evidence = await prisma.$queryRaw<Array<{ pid: number; state: string; waitEventType: string | null; waitEvent: string | null; blockers: number[]; query: string }>>`
    SELECT pid, state, wait_event_type AS "waitEventType", wait_event AS "waitEvent", pg_blocking_pids(pid) AS blockers, query
    FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
  `;
  throw new Error(`Timed out waiting for blocked database query ${fragment}: ${JSON.stringify(evidence)}`);
}

async function files(path = uploadRoot): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(resolve(path, entry.name)) : [resolve(path, entry.name)]))).flat();
}

async function startServer() {
  await rm(uploadRoot, { recursive: true, force: true });
  await mkdir(uploadRoot, { recursive: true });
  server = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "apps/api/src/server.ts"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test", RECEIVABLES_EXPORT_SMOKE: "1", PORT: "55448", RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1", PUBLIC_BASE_URL: baseUrl, COOKIE_SECRET: "receivables-export-smoke-cookie-secret", JWT_SECRET: jwtSecret, FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"), UPLOAD_SIGNING_SECRET: "receivables-export-smoke-upload-secret", UPLOAD_ROOT: uploadRoot },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  server.on("message", (message) => { if (typeof message === "string") serverMessages.push(message); });
  server.stdout?.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr?.on("data", (chunk) => { serverOutput += String(chunk); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try { if ((await fetch(`${baseUrl}/api/health`)).status === 200) return; } catch {}
    await delay(50);
  }
  throw new Error(`Task10 API unavailable: ${serverOutput}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return false;
  if (!shutdownRequested && server.connected) { shutdownRequested = true; server.send("receivables-export-smoke-shutdown"); }
  await Promise.race([once(server, "exit"), delay(5_000)]);
  const forced = server.exitCode === null && server.signalCode === null;
  if (forced) { server.kill("SIGKILL"); await Promise.race([once(server, "exit"), delay(2_000)]); }
  return forced;
}

async function waitForServerMessage(message: string) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (serverMessages.includes(message)) return;
    await delay(20);
  }
  throw new Error(`Timed out waiting for server IPC message ${message}: ${serverOutput}`);
}

async function cleanup() {
  const errors: unknown[] = [];
  const actions = [
    () => prisma.auditLog.deleteMany({ where: { actorId: { in: ids.accounts } } }),
    () => prisma.receivableExportJob.deleteMany({ where: { requestedBy: { in: ids.accounts } } }),
    () => prisma.receivableInvoice.deleteMany({ where: { ledger: { contractNoNormalized: { startsWith: marker } } } }),
    () => prisma.receivableReceipt.deleteMany({ where: { ledger: { contractNoNormalized: { startsWith: marker } } } }),
    () => prisma.receivableLedgerRevision.deleteMany({ where: { ledger: { contractNoNormalized: { startsWith: marker } } } }),
    () => prisma.receivableLedger.deleteMany({ where: { contractNoNormalized: { startsWith: marker } } }),
    () => prisma.receivableGrantDepartment.deleteMany({ where: { grantId: { in: ids.grants } } }),
    () => prisma.receivableAccessGrant.deleteMany({ where: { id: { in: ids.grants } } }),
    () => prisma.receivableDepartment.deleteMany({ where: { id: { in: ids.departments } } }),
    () => settingExisted && originalSetting ? prisma.receivableSetting.update({ where: { id: 1 }, data: originalSetting }) : prisma.receivableSetting.deleteMany({ where: { id: 1 } }),
    () => prisma.refreshSession.deleteMany({ where: { id: { in: ids.sessions } } }),
    () => prisma.roleAssignment.deleteMany({ where: { id: { in: ids.roles } } }),
    () => prisma.account.deleteMany({ where: { id: { in: ids.accounts } } }),
    () => prisma.person.deleteMany({ where: { id: { in: ids.people } } }),
    () => prisma.organization.deleteMany({ where: { id: { in: ids.organizations } } }),
    () => rm(uploadRoot, { recursive: true, force: true }),
  ];
  for (const action of actions) { try { await action(); } catch (error) { errors.push(error); } }
  if (errors.length) throw new AggregateError(errors, "Task10 cleanup failed");
}

async function assertClean() {
  const [people, accounts, departments, grants, ledgers, exports, audits, sessions, setting, physical] = await Promise.all([
    prisma.person.count({ where: { name: { startsWith: marker } } }), prisma.account.count({ where: { username: { startsWith: marker } } }),
    prisma.receivableDepartment.count({ where: { name: { startsWith: marker } } }), prisma.receivableAccessGrant.count({ where: { id: { in: ids.grants } } }),
    prisma.receivableLedger.count({ where: { contractNoNormalized: { startsWith: marker } } }), prisma.receivableExportJob.count({ where: { requestedBy: { in: ids.accounts } } }),
    prisma.auditLog.count({ where: { actorId: { in: ids.accounts } } }), prisma.refreshSession.count({ where: { clientKind: "rxa-export-smoke" } }),
    prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } }), files(),
  ]);
  assert.deepEqual({ people, accounts, departments, grants, ledgers, exports, audits, sessions, physical }, { people: 0, accounts: 0, departments: 0, grants: 0, ledgers: 0, exports: 0, audits: 0, sessions: 0, physical: [] });
  assert.deepEqual(setting, settingExisted ? originalSetting : null, "receivable setting baseline was not restored");
}

try {
  const company = await prisma.organization.create({ data: { name: `${marker}-company`, type: "company" } }); ids.organizations.push(company.id);
  const financeOrg = await prisma.organization.create({ data: { name: `${marker}-finance`, type: "department", parentId: company.id } }); ids.organizations.push(financeOrg.id);
  const owner = await identity("owner", "org_leader", financeOrg.id);
  const admin = await identity("admin");
  const reporter = await identity("reporter");
  const denied = await identity("denied");
  const revokedAtProcess = await identity("revoked-process");
  const revokedAtToken = await identity("revoked-token");
  const revokedAtDownload = await identity("revoked-download");
  const revokedDuringHash = await identity("revoked-hash");
  const partiallyRevoked = await identity("partial-revoke");
  const recovery = await identity("recovery", "company_admin");
  const departmentA = await prisma.receivableDepartment.create({ data: { name: `${marker}-department-a` } });
  const departmentB = await prisma.receivableDepartment.create({ data: { name: `${marker}-department-b` } });
  ids.departments.push(departmentA.id, departmentB.id);
  originalSetting = await prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } });
  settingExisted = originalSetting !== null;
  await prisma.receivableSetting.upsert({ where: { id: 1 }, create: { id: 1, financeOrganizationId: financeOrg.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.id }, update: { financeOrganizationId: financeOrg.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.id } });
  await grant(admin.id, owner.id, "admin", [], false);
  await grant(reporter.id, owner.id, "reporter", [departmentA.id], true);
  await grant(denied.id, owner.id, "readonly", [departmentA.id], false);
  const processGrant = await grant(revokedAtProcess.id, owner.id, "readonly", [departmentA.id], true);
  const tokenGrant = await grant(revokedAtToken.id, owner.id, "readonly", [departmentA.id], true);
  const downloadGrant = await grant(revokedAtDownload.id, owner.id, "readonly", [departmentA.id], true);
  const hashGrant = await grant(revokedDuringHash.id, owner.id, "readonly", [departmentA.id], true);
  const partialGrant = await grant(partiallyRevoked.id, owner.id, "readonly", [departmentA.id, departmentB.id], true);

  const rows = Array.from({ length: 5_001 }, (_, index) => ({ financeDepartmentId: departmentA.id, contractNo: `${marker}-bulk-${index}`, contractNoNormalized: `${marker}-bulk-${index}`, projectName: index === 0 ? `${marker}-needle` : `${marker}-project-${index}`, finalAmount: "99999999999999.1234", createdBy: owner.id }));
  for (let offset = 0; offset < rows.length; offset += 500) await prisma.receivableLedger.createMany({ data: rows.slice(offset, offset + 500) });
  const ledgerA = await prisma.receivableLedger.findUniqueOrThrow({ where: { contractNoNormalized: `${marker}-bulk-0` } });
  const ledgerB = await prisma.receivableLedger.create({ data: { financeDepartmentId: departmentB.id, contractNo: `${marker}-department-b-ledger`, contractNoNormalized: `${marker}-department-b-ledger`, finalAmount: "100.0000", createdBy: owner.id } });
  const [ledgerA2, ledgerA3] = await Promise.all([
    prisma.receivableLedger.findUniqueOrThrow({ where: { contractNoNormalized: `${marker}-bulk-1` } }),
    prisma.receivableLedger.findUniqueOrThrow({ where: { contractNoNormalized: `${marker}-bulk-2` } }),
  ]);
  await prisma.$transaction([
    prisma.receivableLedger.update({ where: { id: ledgerA.id }, data: { creditorUnit: `${marker}-unit-a`, projectStatus: `${marker}-status-x`, latestProgress: "已对账" } }),
    prisma.receivableLedger.update({ where: { id: ledgerA2.id }, data: { creditorUnit: `${marker}-unit-b`, projectStatus: `${marker}-status-x` } }),
    prisma.receivableLedger.update({ where: { id: ledgerA3.id }, data: { creditorUnit: `${marker}-unit-a`, projectStatus: `${marker}-status-y` } }),
  ]);
  await prisma.receivableInvoice.create({ data: { ledgerId: ledgerA.id, invoiceDate: new Date("2026-01-02T00:00:00Z"), amount: "80.0000", createdBy: owner.id } });
  await prisma.receivableReceipt.create({ data: { ledgerId: ledgerA.id, receiptDate: new Date("2026-02-03T00:00:00Z"), amount: "30.0000", createdBy: owner.id } });

  const [ownerToken, adminToken, reporterToken, deniedToken, processToken, tokenToken, downloadToken, recoveryToken, partialToken, hashToken] = await Promise.all([owner.id, admin.id, reporter.id, denied.id, revokedAtProcess.id, revokedAtToken.id, revokedAtDownload.id, recovery.id, partiallyRevoked.id, revokedDuringHash.id].map(bearer));
  await startServer();
  const { cleanupExpiredReceivablesExports, consumeReceivablesExport, createReceivablesExportJob, processReceivablesExportJob, removeConsumedReceivablesExport } = await import("../src/receivables-export.js");

  await createExport(deniedToken, {}, 403);
  await createExport(recoveryToken, {}, 403);
  await createExport(reporterToken, { financeDepartmentId: departmentB.id }, 403);
  await post("/api/receivables/exports", reporterToken, { filters: { financeDepartmentId: departmentA.id, search: `${marker}-missing-idempotency-key` } }, 400);

  const categoryFilters = { creditorUnit: [`${marker}-unit-a`, `${marker}-unit-b`], projectStatus: [`${marker}-status-x`] };
  const preview = await post<{ rowCount: number; columns: Array<{ id: string; label: string; nonEmptyCount: number }> }>("/api/receivables/exports/preview", reporterToken, { filters: { settlement: "all" }, categoryFilters });
  assert.equal(preview.body!.data!.rowCount, 2, "category OR/AND filtering returned the wrong row count");
  assert.equal(preview.body!.data!.columns.find(({ id }) => id === "customerName")?.nonEmptyCount, 0);
  assert.equal(preview.body!.data!.columns.find(({ id }) => id === "latestProgress")?.nonEmptyCount, 1);
  const selectedHeaders = ["合同编号", "项目名称", "最新进展"];
  const selectedCreate = await createExport<{ id: string }>(reporterToken, { settlement: "all" }, 202, randomUUID(), { categoryFilters, columns: ["contractNo", "projectName", "latestProgress"] });
  const selectedReady = await waitForJob(selectedCreate.body!.data!.id, ["completed", "failed"]);
  assert.equal(selectedReady.status, "completed", selectedReady.error ?? undefined);
  const selectedWorkbook = new ExcelJS.Workbook(); await selectedWorkbook.xlsx.readFile(resolve(uploadRoot, selectedReady.storageKey!));
  assert.equal(selectedWorkbook.worksheets.length, 1);
  assert.equal(selectedWorkbook.worksheets[0]!.name, "应收账款明细");
  assert.ok(selectedWorkbook.worksheets[0]!.autoFilter);
  assert.deepEqual((selectedWorkbook.worksheets[0]!.getRow(1).values as unknown[]).slice(1), selectedHeaders);
  assert.equal(selectedWorkbook.worksheets[0]!.rowCount, 3);

  const scopedIdempotencyKey = randomUUID();
  const scopedCreate = await createExport<{ id: string; status: string }>(reporterToken, { financeDepartmentId: departmentA.id, search: `${marker}-needle`, settlement: "all" }, 202, scopedIdempotencyKey);
  const scopedId = scopedCreate.body!.data!.id;
  const duplicate = await createExport<{ id: string }>(reporterToken, { financeDepartmentId: departmentA.id, search: `${marker}-needle`, settlement: "all" }, 202, scopedIdempotencyKey);
  assert.equal(duplicate.body!.data!.id, scopedId, "identical active export was not reused");
  const scopedDb = await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: scopedId } });
  assert.equal((scopedDb.filterSnapshot as any).financeDepartmentId, departmentA.id);
  assert.equal((scopedDb.filterSnapshot as any).search, `${marker}-needle`);
  assert.deepEqual((scopedDb.filterSnapshot as any).categoryFilters.creditorUnit, []);
  assert.ok((scopedDb.filterSnapshot as any).columns.includes("latestProgress"));
  assert.deepEqual((scopedDb.scopeSnapshot as any).readDepartmentIds, [departmentA.id]);
  assert.equal((scopedDb.scopeSnapshot as any).role, "reporter");
  assert.ok(Date.parse((scopedDb.scopeSnapshot as any).cutoffAt));
  const scopedReady = await waitForJob(scopedId, ["completed", "failed"]);
  assert.equal(scopedReady.status, "completed", scopedReady.error ?? undefined);
  assert.equal(scopedReady.rowCount, 1);
  const scopedPath = resolve(uploadRoot, scopedReady.storageKey!);
  const metadata = await stat(scopedPath); assert.equal(metadata.isFile(), true); assert.equal(metadata.size, scopedReady.size);
  if (process.platform !== "win32") assert.equal(metadata.mode & 0o777, 0o600);
  assert.equal((await files()).some((path) => path.endsWith(".tmp")), false, "atomic export rename left a temporary file");
  assert.equal(await prisma.auditLog.count({ where: { action: "receivables.export.claim", objectId: scopedId } }), 1, "concurrent workers claimed one job more than once");
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(scopedPath);
  const sheet = workbook.worksheets[0]!; assert.equal(sheet.rowCount, 2);
  const values = sheet.getRow(2).values as unknown[];
  assert.ok(values.includes("99999999999999.1234"), "large fixed-point amount was not preserved as a string");
  assert.ok(values.includes("80.0000") && values.includes("30.0000"), "authoritative invoice/receipt totals missing");

  const ownerCreated = await createExport<{ id: string }>(ownerToken, { settlement: "all" });
  const ownerReady = await waitForJob(ownerCreated.body!.data!.id, ["completed", "failed"]);
  assert.equal(ownerReady.status, "completed", ownerReady.error ?? undefined);
  assert.equal(ownerReady.rowCount, 5_002, "export silently truncated at or below 5000 rows");
  const adminCreated = await createExport<{ id: string }>(adminToken, { financeDepartmentId: departmentB.id, settlement: "all" });
  assert.equal((await waitForJob(adminCreated.body!.data!.id, ["completed", "failed"])).rowCount, 1);

  const idempotencyKey = randomUUID();
  const idempotentFirst = await createExport<{ id: string }>(adminToken, { financeDepartmentId: departmentB.id, search: `${marker}-idempotent`, settlement: "all" }, 202, idempotencyKey);
  const afterCutoff = await prisma.receivableLedger.create({ data: { financeDepartmentId: departmentB.id, contractNo: `${marker}-idempotent-new`, contractNoNormalized: `${marker}-idempotent-new`, projectName: `${marker}-idempotent`, finalAmount: "2.0000", createdBy: owner.id } });
  const idempotentSnapshot = await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: idempotentFirst.body!.data!.id }, select: { scopeSnapshot: true } });
  assert.ok(afterCutoff.createdAt > new Date((idempotentSnapshot.scopeSnapshot as any).cutoffAt), `fixture row ${afterCutoff.createdAt.toISOString()} was not after cutoff ${(idempotentSnapshot.scopeSnapshot as any).cutoffAt}`);
  const directCutoff = await prisma.receivableLedger.count({ where: { id: afterCutoff.id, createdAt: { lte: new Date((idempotentSnapshot.scopeSnapshot as any).cutoffAt) } } });
  const idempotentReady = await waitForJob(idempotentFirst.body!.data!.id, ["completed", "failed"]);
  const idempotentAudit = await prisma.auditLog.findFirst({ where: { action: "receivables.export.complete", objectId: idempotentReady.id }, select: { metadata: true } });
  const idempotentWorkbook = new ExcelJS.Workbook(); await idempotentWorkbook.xlsx.readFile(resolve(uploadRoot, idempotentReady.storageKey!));
  const idempotentValues = idempotentWorkbook.worksheets[0]!.getRow(2).values;
  assert.equal(idempotentReady.rowCount, 0, `snapshot cutoff included a row created after the request: ${JSON.stringify({ scope: idempotentSnapshot.scopeSnapshot, audit: idempotentAudit?.metadata, createdAt: afterCutoff.createdAt, directCutoff, values: idempotentValues })}\n${serverOutput}`);
  const idempotentRetry = await createExport<{ id: string }>(adminToken, { financeDepartmentId: departmentB.id, search: `${marker}-idempotent`, settlement: "all" }, 202, idempotencyKey);
  assert.equal(idempotentRetry.body!.data!.id, idempotentFirst.body!.data!.id, "explicit idempotency key did not reuse the original immutable snapshot");
  const refreshed = await createExport<{ id: string }>(adminToken, { financeDepartmentId: departmentB.id, search: `${marker}-idempotent`, settlement: "all" });
  assert.notEqual(refreshed.body!.data!.id, idempotentFirst.body!.data!.id, "a new request key reused a completed scope/filter cache");
  assert.equal((await waitForJob(refreshed.body!.data!.id, ["completed", "failed"])).rowCount, 1);
  assert.ok(afterCutoff.id);

  await prisma.receivableLedger.createMany({ data: [
    { financeDepartmentId: departmentA.id, contractNo: `${marker}-partial-a`, contractNoNormalized: `${marker}-partial-a`, projectName: `${marker}-partial`, finalAmount: "3.0000", createdBy: owner.id },
    { financeDepartmentId: departmentB.id, contractNo: `${marker}-partial-b`, contractNoNormalized: `${marker}-partial-b`, projectName: `${marker}-partial`, finalAmount: "4.0000", createdBy: owner.id },
  ] });
  const partialCreate = await createExport<{ id: string }>(partialToken, { search: `${marker}-partial`, settlement: "all" });
  await prisma.receivableGrantDepartment.delete({ where: { grantId_financeDepartmentId: { grantId: partialGrant.id, financeDepartmentId: departmentB.id } } });
  const partialReady = await waitForJob(partialCreate.body!.data!.id, ["completed", "failed"]);
  assert.equal(partialReady.status, "completed", partialReady.error ?? undefined);
  assert.equal(partialReady.rowCount, 1, "processing did not reduce the snapshot to the nonempty current-scope intersection");
  const partialWorkbook = new ExcelJS.Workbook(); await partialWorkbook.xlsx.readFile(resolve(uploadRoot, partialReady.storageKey!));
  assert.equal((partialWorkbook.worksheets[0]!.getRow(2).values as unknown[]).includes(`${marker}-partial-a`), true);
  assert.equal((partialWorkbook.worksheets[0]!.getRow(2).values as unknown[]).includes(`${marker}-partial-b`), false);
  await post(`/api/receivables/exports/${partialReady.id}/token`, partialToken, {}, 200);
  await prisma.receivableGrantDepartment.delete({ where: { grantId_financeDepartmentId: { grantId: partialGrant.id, financeDepartmentId: departmentA.id } } });
  await post(`/api/receivables/exports/${partialReady.id}/token`, partialToken, {}, 403);

  const processCreated = await createExport<{ id: string }>(processToken, { settlement: "all" });
  await prisma.receivableAccessGrant.update({ where: { id: processGrant.id }, data: { active: false, revokedAt: new Date(), revokedBy: owner.id, revokeReason: "process revoke" } });
  const processFailed = await waitForJob(processCreated.body!.data!.id, ["failed"]); assert.match(processFailed.error ?? "", /权限|RECEIVABLES/i);

  const tokenCreated = await createExport<{ id: string }>(tokenToken, { search: `${marker}-needle`, settlement: "all" });
  await waitForJob(tokenCreated.body!.data!.id, ["completed"]);
  let releaseTokenLock!: () => void; let tokenLocked!: () => void;
  const tokenRelease = new Promise<void>((done) => { releaseTokenLock = done; });
  const tokenLockReady = new Promise<void>((done) => { tokenLocked = done; });
  const tokenBlocker = prisma.$transaction(async (tx) => { await tx.$queryRaw`SELECT id FROM receivable_export_jobs WHERE id = ${tokenCreated.body!.data!.id}::uuid FOR UPDATE`; tokenLocked(); await tokenRelease; });
  await tokenLockReady;
  const racingTokenRequest = request(`/api/receivables/exports/${tokenCreated.body!.data!.id}/token`, tokenToken, { method: "POST", body: JSON.stringify({}) });
  await waitForBlockedDatabaseQuery("receivable_export_jobs");
  await prisma.receivableAccessGrant.update({ where: { id: tokenGrant.id }, data: { active: false, revokedAt: new Date(), revokedBy: owner.id, revokeReason: "token revoke" } });
  releaseTokenLock(); await tokenBlocker;
  assert.equal((await racingTokenRequest).response.status, 403, "token issuance authorized stale permissions before acquiring the job lock");

  const downloadCreated = await createExport<{ id: string }>(downloadToken, { search: `${marker}-needle`, settlement: "all" });
  await waitForJob(downloadCreated.body!.data!.id, ["completed"]);
  const issuedBeforeRevoke = await post<{ token: string }>(`/api/receivables/exports/${downloadCreated.body!.data!.id}/token`, downloadToken, {});
  let releaseDownloadLock!: () => void; let downloadLocked!: () => void;
  const downloadRelease = new Promise<void>((done) => { releaseDownloadLock = done; });
  const downloadLockReady = new Promise<void>((done) => { downloadLocked = done; });
  const downloadBlocker = prisma.$transaction(async (tx) => { await tx.$queryRaw`SELECT id FROM receivable_export_jobs WHERE id = ${downloadCreated.body!.data!.id}::uuid FOR UPDATE`; downloadLocked(); await downloadRelease; });
  await downloadLockReady;
  const racingDownloadRequest = request(`/api/receivables/exports/${downloadCreated.body!.data!.id}/download`, downloadToken, { method: "POST", body: JSON.stringify({ token: issuedBeforeRevoke.body!.data!.token }) });
  await waitForBlockedDatabaseQuery("receivable_export_jobs");
  await prisma.receivableAccessGrant.update({ where: { id: downloadGrant.id }, data: { active: false, revokedAt: new Date(), revokedBy: owner.id, revokeReason: "download revoke" } });
  releaseDownloadLock(); await downloadBlocker;
  assert.equal((await racingDownloadRequest).response.status, 403, "download consumed a token using stale permissions before acquiring the job lock");

  const hashCreate = await createExport<{ id: string }>(hashToken, { search: `${marker}-needle`, settlement: "all" });
  const hashJob = await waitForJob(hashCreate.body!.data!.id, ["completed"]);
  const hashTokenIssued = await post<{ token: string }>(`/api/receivables/exports/${hashJob.id}/token`, hashToken, {});
  let releaseHash!: () => void; let hashStarted!: () => void;
  const hashRelease = new Promise<void>((done) => { releaseHash = done; });
  const hashReady = new Promise<void>((done) => { hashStarted = done; });
  const hashingDownload = consumeReceivablesExport(hashJob.id, hashTokenIssued.body!.data!.token, { accountId: revokedDuringHash.id, personId: revokedDuringHash.personId, mustChangePassword: false, sessionId: null, roles: [] }, { uploadRoot, verificationBarrier: async () => { hashStarted(); await hashRelease; } });
  await hashReady;
  const [authorizationLocks] = await prisma.$queryRaw<Array<{ tableShareLocks: bigint; idleTransactions: bigint }>>`
    SELECT
      count(*) FILTER (WHERE l.mode = 'ShareLock' AND c.relname IN ('accounts', 'persons', 'role_assignments', 'receivable_settings', 'receivable_access_grants', 'receivable_grant_departments', 'receivable_departments')) AS "tableShareLocks",
      (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction') AS "idleTransactions"
    FROM pg_locks l LEFT JOIN pg_class c ON c.oid = l.relation
  `;
  assert.deepEqual(authorizationLocks, { tableShareLocks: 0n, idleTransactions: 0n }, "full SHA verification retained an authorization transaction or whole-table SHARE lock");
  await prisma.receivableAccessGrant.update({ where: { id: hashGrant.id }, data: { active: false, revokedAt: new Date(), revokedBy: owner.id, revokeReason: "hash revoke" } });
  releaseHash();
  await assert.rejects(hashingDownload, /权限|RECEIVABLES_FORBIDDEN/i, "download did not re-authorize after out-of-transaction SHA verification");

  const replacedToken = await post<{ token: string }>(`/api/receivables/exports/${scopedId}/token`, reporterToken, {});
  const oneUse = await post<{ token: string }>(`/api/receivables/exports/${scopedId}/token`, reporterToken, {});
  await post(`/api/receivables/exports/${scopedId}/download`, reporterToken, { token: replacedToken.body!.data!.token }, 409);
  const concurrent = await Promise.all([0, 1].map(() => request(`/api/receivables/exports/${scopedId}/download`, reporterToken, { method: "POST", body: JSON.stringify({ token: oneUse.body!.data!.token }) })));
  assert.deepEqual(concurrent.map(({ response }) => response.status).sort(), [200, 409]);
  await Promise.all(concurrent.map(({ response }) => response.arrayBuffer().catch(() => new ArrayBuffer(0))));
  for (let attempt = 0; attempt < 100 && (await files()).some((path) => path === scopedPath); attempt += 1) await delay(25);
  assert.equal((await files()).includes(scopedPath), false, "download response did not clean the export artifact");
  for (let attempt = 0; attempt < 100 && (await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: scopedId } })).storageKey !== null; attempt += 1) await delay(25);
  assert.equal((await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: scopedId } })).storageKey, null, "response cleanup deleted the file without confirming durable cleanup state");

  const handleCreate = await createExport<{ id: string }>(reporterToken, { search: `${marker}-project-3`, settlement: "all" });
  const handleJob = await waitForJob(handleCreate.body!.data!.id, ["completed"]);
  const handleToken = await post<{ token: string }>(`/api/receivables/exports/${handleJob.id}/token`, reporterToken, {});
  const fixedFile = await consumeReceivablesExport(handleJob.id, handleToken.body!.data!.token, { accountId: reporter.id, personId: reporter.personId, mustChangePassword: false, sessionId: null, roles: [] }, { uploadRoot });
  const handlePath = resolve(uploadRoot, handleJob.storageKey!); const heldPath = `${handlePath}.held`; const originalBytes = await readFile(handlePath);
  await rename(handlePath, heldPath); await writeFile(handlePath, Buffer.alloc(originalBytes.length, 0x78));
  const delivered: Buffer[] = []; for await (const chunk of fixedFile.handle.createReadStream({ start: 0, autoClose: false })) delivered.push(chunk as Buffer);
  assert.equal(Buffer.concat(delivered).equals(originalBytes), true, "download stream reopened a replaced path instead of reading the verified handle");
  await assert.rejects(() => removeConsumedReceivablesExport(fixedFile, { uploadRoot }), /身份无效/, "cleanup deleted a replacement path instead of the verified artifact");
  assert.equal((await readFile(handlePath)).equals(Buffer.alloc(originalBytes.length, 0x78)), true);
  await rm(handlePath); await rename(heldPath, handlePath); await removeConsumedReceivablesExport(fixedFile, { uploadRoot });
  assert.equal((await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: handleJob.id } })).storageKey, null);

  const quarantineCreate = await createExport<{ id: string }>(reporterToken, { search: `${marker}-project-4`, settlement: "all" });
  const quarantineJob = await waitForJob(quarantineCreate.body!.data!.id, ["completed"]);
  const quarantineToken = await post<{ token: string }>(`/api/receivables/exports/${quarantineJob.id}/token`, reporterToken, {});
  const quarantineFile = await consumeReceivablesExport(quarantineJob.id, quarantineToken.body!.data!.token, { accountId: reporter.id, personId: reporter.personId, mustChangePassword: false, sessionId: null, roles: [] }, { uploadRoot });
  let renameAttempts = 0;
  const forcedFileError = () => Object.assign(new Error("forced cleanup failure"), { code: "EACCES" });
  await assert.rejects(() => removeConsumedReceivablesExport(quarantineFile, {
    uploadRoot,
    fileOperations: {
      unlink: async () => { throw forcedFileError(); },
      rename: async (from, to) => { renameAttempts += 1; if (renameAttempts === 1) return rename(from, to); throw forcedFileError(); },
    },
  }), /隔离路径/);
  const quarantineKey = `.receivables-exports/${quarantineJob.id}.delete`;
  assert.equal((await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: quarantineJob.id } })).storageKey, quarantineKey, "double cleanup failure left the job pointing at the missing original path");
  await assert.rejects(() => stat(resolve(uploadRoot, quarantineJob.storageKey!)));
  assert.equal((await stat(resolve(uploadRoot, quarantineKey))).isFile(), true);
  assert.equal(await prisma.auditLog.count({ where: { action: "receivables.export.cleanup.defer", objectId: quarantineJob.id } }), 1);
  await prisma.receivableExportJob.update({ where: { id: quarantineJob.id }, data: { downloadedAt: new Date(0) } });
  await cleanupExpiredReceivablesExports({ uploadRoot });
  assert.equal((await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: quarantineJob.id } })).storageKey, null, "quarantined cleanup artifact was not retryable");
  await assert.rejects(() => stat(resolve(uploadRoot, quarantineKey)));

  const tamperCreate = await createExport<{ id: string }>(reporterToken, { search: `${marker}-project-1`, settlement: "all" });
  const tamperJob = await waitForJob(tamperCreate.body!.data!.id, ["completed"]);
  const tamperToken = await post<{ token: string }>(`/api/receivables/exports/${tamperJob.id}/token`, reporterToken, {});
  await writeFile(resolve(uploadRoot, tamperJob.storageKey!), Buffer.alloc(tamperJob.size!, 0x78));
  await post(`/api/receivables/exports/${tamperJob.id}/download`, reporterToken, { token: tamperToken.body!.data!.token }, 409);
  assert.equal(await prisma.auditLog.count({ where: { action: "receivables.export.download", objectId: tamperJob.id } }), 0);

  const traversalCreate = await createExport<{ id: string }>(reporterToken, { search: `${marker}-project-2`, settlement: "all" });
  const traversalJob = await waitForJob(traversalCreate.body!.data!.id, ["completed"]);
  const traversalToken = await post<{ token: string }>(`/api/receivables/exports/${traversalJob.id}/token`, reporterToken, {});
  await prisma.receivableExportJob.update({ where: { id: traversalJob.id }, data: { storageKey: "../outside.xlsx" } });
  await post(`/api/receivables/exports/${traversalJob.id}/download`, reporterToken, { token: traversalToken.body!.data!.token }, 409);
  assert.equal(await prisma.auditLog.count({ where: { action: "receivables.export.download", objectId: traversalJob.id } }), 0);

  const cleanupCreate = await createExport<{ id: string }>(adminToken, { financeDepartmentId: departmentB.id, search: ledgerB.contractNo, settlement: "all" });
  const cleanupJob = await waitForJob(cleanupCreate.body!.data!.id, ["completed"]);
  await prisma.receivableExportJob.update({ where: { id: cleanupJob.id }, data: { expiresAt: new Date(0) } });
  await cleanupExpiredReceivablesExports({ uploadRoot });
  assert.equal((await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: cleanupJob.id } })).status, "expired");
  await assert.rejects(() => stat(resolve(uploadRoot, cleanupJob.storageKey!)));
  const expiredPending = await prisma.receivableExportJob.create({ data: { requestedBy: admin.id, status: "pending", scopeSnapshot: cleanupJob.scopeSnapshot as any, filterSnapshot: cleanupJob.filterSnapshot as any, expiresAt: new Date(0) } });
  const expiredProcessing = await prisma.receivableExportJob.create({ data: { requestedBy: admin.id, status: "processing", scopeSnapshot: cleanupJob.scopeSnapshot as any, filterSnapshot: cleanupJob.filterSnapshot as any, expiresAt: new Date(0) } });
  await cleanupExpiredReceivablesExports({ uploadRoot });
  assert.deepEqual((await prisma.receivableExportJob.findMany({ where: { id: { in: [expiredPending.id, expiredProcessing.id] } }, orderBy: { id: "asc" }, select: { status: true } })).map(({ status }) => status), ["expired", "expired"]);
  const blockedId = randomUUID(); const blockedKey = `.receivables-exports/${blockedId}.xlsx`; const blockedPath = resolve(uploadRoot, blockedKey); await mkdir(blockedPath, { recursive: true });
  const blockedCleanup = await prisma.receivableExportJob.create({ data: { id: blockedId, requestedBy: admin.id, status: "completed", scopeSnapshot: cleanupJob.scopeSnapshot as any, filterSnapshot: cleanupJob.filterSnapshot as any, storageKey: blockedKey, size: 1, sha256: "a".repeat(64), expiresAt: new Date(0) } });
  await assert.rejects(() => cleanupExpiredReceivablesExports({ uploadRoot }), /清理失败/);
  assert.equal((await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: blockedCleanup.id } })).status, "completed", "file deletion failure was silently marked expired");
  await rm(blockedPath, { recursive: true }); await cleanupExpiredReceivablesExports({ uploadRoot });
  assert.equal((await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: blockedCleanup.id } })).status, "expired");
  const retryId = randomUUID(); const retryKey = `.receivables-exports/${retryId}.tmp`; const retryPath = resolve(uploadRoot, retryKey); await mkdir(retryPath, { recursive: true });
  const retryCleanup = await prisma.receivableExportJob.create({ data: { id: retryId, requestedBy: admin.id, status: "failed", scopeSnapshot: cleanupJob.scopeSnapshot as any, filterSnapshot: cleanupJob.filterSnapshot as any, storageKey: retryKey, error: "generation and cleanup failed", expiresAt: new Date(Date.now() + 60_000) } });
  await assert.rejects(() => cleanupExpiredReceivablesExports({ uploadRoot }), /清理失败/);
  assert.equal((await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: retryCleanup.id } })).storageKey, retryKey, "failed generation lost its retryable storage identity");
  await rm(retryPath, { recursive: true }); await cleanupExpiredReceivablesExports({ uploadRoot });
  assert.deepEqual(await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: retryCleanup.id }, select: { status: true, storageKey: true } }), { status: "failed", storageKey: null });

  const listed = await expect<{ rows: Job[] }>("/api/receivables/exports?page=1&pageSize=100", reporterToken, 200);
  assert.ok(listed.body!.data!.rows.every((job) => ![ownerCreated.body!.data!.id, adminCreated.body!.data!.id].includes(job.id)), "export list leaked another requester's job");
  const actions = await prisma.auditLog.groupBy({ by: ["action"], where: { actorId: { in: ids.accounts }, action: { startsWith: "receivables.export." } }, _count: true });
  for (const action of ["receivables.export.request", "receivables.export.claim", "receivables.export.complete", "receivables.export.failed", "receivables.export.token", "receivables.export.download", "receivables.export.expire"]) assert.ok(actions.some((row) => row.action === action), `${action} audit missing`);
  const auditMetadata = JSON.stringify((await prisma.auditLog.findMany({ where: { action: { startsWith: "receivables.export." }, actorId: { in: ids.accounts } }, select: { metadata: true } })).map(({ metadata }) => metadata));
  for (const rawToken of [issuedBeforeRevoke.body!.data!.token, replacedToken.body!.data!.token, oneUse.body!.data!.token, handleToken.body!.data!.token, tamperToken.body!.data!.token, traversalToken.body!.data!.token]) assert.equal(auditMetadata.includes(rawToken), false, "raw download token leaked into audit metadata");
  let releaseWorker!: () => void; let workerTableLocked!: () => void;
  const workerRelease = new Promise<void>((done) => { releaseWorker = done; });
  const workerLockReady = new Promise<void>((done) => { workerTableLocked = done; });
  const workerBlocker = prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe("LOCK TABLE receivable_ledgers IN ACCESS EXCLUSIVE MODE"); workerTableLocked(); await workerRelease; });
  await workerLockReady;
  const shutdownJob = await createExport<{ id: string }>(adminToken, { financeDepartmentId: departmentB.id, search: ledgerB.contractNo, settlement: "all" });
  await waitForJob(shutdownJob.body!.data!.id, ["processing"]);
  await waitForBlockedDatabaseQuery("receivable_ledgers");
  shutdownRequested = true; server!.send("receivables-export-smoke-shutdown");
  await waitForServerMessage("receivables-export-smoke-shutdown-started");
  assert.equal(server!.exitCode, null, "shutdown disconnected before the active export worker completed");
  assert.equal(serverMessages.includes("receivables-export-smoke-shutdown-complete"), false, "shutdown reported complete while the worker was blocked");
  releaseWorker(); await workerBlocker;
  await waitForServerMessage("receivables-export-smoke-shutdown-complete");
  assert.equal(await stopServer(), false, "server shutdown required a forced kill after the active worker completed");
  const adminPrincipal = { accountId: admin.id, personId: admin.personId, mustChangePassword: false, sessionId: null, roles: [] };
  const cutoffBarrier = await createReceivablesExportJob(adminPrincipal, { financeDepartmentId: departmentB.id, search: `${marker}-barrier-cutoff`, settlement: "all" }, { uploadRoot }, randomUUID());
  await prisma.receivableLedger.create({ data: { financeDepartmentId: departmentB.id, contractNo: `${marker}-barrier-cutoff`, contractNoNormalized: `${marker}-barrier-cutoff`, projectName: `${marker}-barrier-cutoff`, finalAmount: "5.0000", createdBy: owner.id } });
  await processReceivablesExportJob(cutoffBarrier.id, { uploadRoot });
  assert.equal((await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: cutoffBarrier.id } })).rowCount, 0, "claim/process barrier did not exclude the row inserted after cutoff");
  await prisma.receivableGrantDepartment.createMany({ data: [
    { grantId: partialGrant.id, financeDepartmentId: departmentA.id, canRead: true },
    { grantId: partialGrant.id, financeDepartmentId: departmentB.id, canRead: true },
  ] });
  const partialBarrier = await createReceivablesExportJob({ accountId: partiallyRevoked.id, personId: partiallyRevoked.personId, mustChangePassword: false, sessionId: null, roles: [] }, { search: `${marker}-partial`, settlement: "all" }, { uploadRoot }, randomUUID());
  await prisma.receivableGrantDepartment.delete({ where: { grantId_financeDepartmentId: { grantId: partialGrant.id, financeDepartmentId: departmentB.id } } });
  await processReceivablesExportJob(partialBarrier.id, { uploadRoot });
  assert.equal((await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: partialBarrier.id } })).rowCount, 1, "claim/process barrier did not apply the A+B to A intersection");
  const concurrentClaim = await prisma.receivableExportJob.create({ data: { requestedBy: admin.id, status: "pending", scopeSnapshot: cleanupJob.scopeSnapshot as any, filterSnapshot: cleanupJob.filterSnapshot as any, expiresAt: new Date(Date.now() + 60_000) } });
  assert.deepEqual((await Promise.all([processReceivablesExportJob(concurrentClaim.id, { uploadRoot }), processReceivablesExportJob(concurrentClaim.id, { uploadRoot })])).sort(), [false, true]);
  assert.equal(await prisma.auditLog.count({ where: { action: "receivables.export.claim", objectId: concurrentClaim.id } }), 1, "true concurrent claim created more than one claim audit");
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors: unknown[] = [];
  for (const action of [stopServer, cleanup, assertClean, () => prisma.$disconnect()]) { try { await action(); } catch (error) { cleanupErrors.push(error); } }
  if (cleanupErrors.length) failure = new AggregateError(failure === undefined ? cleanupErrors : [failure, ...cleanupErrors], "Task10 smoke cleanup failed");
}

if (failure !== undefined) throw failure;
console.log("RECEIVABLES_EXPORT_SMOKE=PASS");
