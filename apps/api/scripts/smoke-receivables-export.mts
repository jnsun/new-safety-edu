import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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

async function waitForJob(jobId: string, wanted: Job["status"][]) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const row = await prisma.receivableExportJob.findUnique({ where: { id: jobId } });
    if (row && wanted.includes(row.status)) return row;
    await delay(100);
  }
  throw new Error(`Timed out waiting for export ${jobId}: ${serverOutput}`);
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
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test", PORT: "55448", RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1", PUBLIC_BASE_URL: baseUrl, COOKIE_SECRET: "receivables-export-smoke-cookie-secret", JWT_SECRET: jwtSecret, FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"), UPLOAD_SIGNING_SECRET: "receivables-export-smoke-upload-secret", UPLOAD_ROOT: uploadRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  if (!server || server.exitCode !== null) return;
  server.kill();
  await Promise.race([once(server, "exit"), delay(2_000)]);
  if (server.exitCode === null) { server.kill("SIGKILL"); await Promise.race([once(server, "exit"), delay(2_000)]); }
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

  const rows = Array.from({ length: 5_001 }, (_, index) => ({ financeDepartmentId: departmentA.id, contractNo: `${marker}-bulk-${index}`, contractNoNormalized: `${marker}-bulk-${index}`, projectName: index === 0 ? `${marker}-needle` : `${marker}-project-${index}`, finalAmount: "99999999999999.1234", createdBy: owner.id }));
  for (let offset = 0; offset < rows.length; offset += 500) await prisma.receivableLedger.createMany({ data: rows.slice(offset, offset + 500) });
  const ledgerA = await prisma.receivableLedger.findUniqueOrThrow({ where: { contractNoNormalized: `${marker}-bulk-0` } });
  const ledgerB = await prisma.receivableLedger.create({ data: { financeDepartmentId: departmentB.id, contractNo: `${marker}-department-b-ledger`, contractNoNormalized: `${marker}-department-b-ledger`, finalAmount: "100.0000", createdBy: owner.id } });
  await prisma.receivableInvoice.create({ data: { ledgerId: ledgerA.id, invoiceDate: new Date("2026-01-02T00:00:00Z"), amount: "80.0000", createdBy: owner.id } });
  await prisma.receivableReceipt.create({ data: { ledgerId: ledgerA.id, receiptDate: new Date("2026-02-03T00:00:00Z"), amount: "30.0000", createdBy: owner.id } });

  const [ownerToken, adminToken, reporterToken, deniedToken, processToken, tokenToken, downloadToken, recoveryToken] = await Promise.all([owner.id, admin.id, reporter.id, denied.id, revokedAtProcess.id, revokedAtToken.id, revokedAtDownload.id, recovery.id].map(bearer));
  await startServer();

  await post("/api/receivables/exports", deniedToken, { filters: {} }, 403);
  await post("/api/receivables/exports", recoveryToken, { filters: {} }, 403);
  await post("/api/receivables/exports", reporterToken, { filters: { financeDepartmentId: departmentB.id } }, 403);

  const scopedCreate = await post<{ id: string; status: string }>("/api/receivables/exports", reporterToken, { filters: { financeDepartmentId: departmentA.id, search: `${marker}-needle`, settlement: "all" } }, 202);
  const scopedId = scopedCreate.body!.data!.id;
  const duplicate = await post<{ id: string }>("/api/receivables/exports", reporterToken, { filters: { financeDepartmentId: departmentA.id, search: `${marker}-needle`, settlement: "all" } }, 202);
  assert.equal(duplicate.body!.data!.id, scopedId, "identical active export was not reused");
  const scopedDb = await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: scopedId } });
  assert.deepEqual(scopedDb.filterSnapshot, { financeDepartmentId: departmentA.id, status: "active", settlement: "all", debtStatus: null, creditorUnit: null, anomaly: null, search: `${marker}-needle` });
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

  const ownerCreated = await post<{ id: string }>("/api/receivables/exports", ownerToken, { filters: { settlement: "all" } }, 202);
  const ownerReady = await waitForJob(ownerCreated.body!.data!.id, ["completed", "failed"]);
  assert.equal(ownerReady.status, "completed", ownerReady.error ?? undefined);
  assert.equal(ownerReady.rowCount, 5_002, "export silently truncated at or below 5000 rows");
  const adminCreated = await post<{ id: string }>("/api/receivables/exports", adminToken, { filters: { financeDepartmentId: departmentB.id, settlement: "all" } }, 202);
  assert.equal((await waitForJob(adminCreated.body!.data!.id, ["completed", "failed"])).rowCount, 1);

  const processCreated = await post<{ id: string }>("/api/receivables/exports", processToken, { filters: { settlement: "all" } }, 202);
  await prisma.receivableAccessGrant.update({ where: { id: processGrant.id }, data: { active: false, revokedAt: new Date(), revokedBy: owner.id, revokeReason: "process revoke" } });
  const processFailed = await waitForJob(processCreated.body!.data!.id, ["failed"]); assert.match(processFailed.error ?? "", /权限|RECEIVABLES/i);

  const tokenCreated = await post<{ id: string }>("/api/receivables/exports", tokenToken, { filters: { search: `${marker}-needle`, settlement: "all" } }, 202);
  await waitForJob(tokenCreated.body!.data!.id, ["completed"]);
  await prisma.receivableAccessGrant.update({ where: { id: tokenGrant.id }, data: { active: false, revokedAt: new Date(), revokedBy: owner.id, revokeReason: "token revoke" } });
  await post(`/api/receivables/exports/${tokenCreated.body!.data!.id}/token`, tokenToken, {}, 403);

  const downloadCreated = await post<{ id: string }>("/api/receivables/exports", downloadToken, { filters: { search: `${marker}-needle`, settlement: "all" } }, 202);
  await waitForJob(downloadCreated.body!.data!.id, ["completed"]);
  const issuedBeforeRevoke = await post<{ token: string }>(`/api/receivables/exports/${downloadCreated.body!.data!.id}/token`, downloadToken, {});
  await prisma.receivableAccessGrant.update({ where: { id: downloadGrant.id }, data: { active: false, revokedAt: new Date(), revokedBy: owner.id, revokeReason: "download revoke" } });
  await post(`/api/receivables/exports/${downloadCreated.body!.data!.id}/download`, downloadToken, { token: issuedBeforeRevoke.body!.data!.token }, 403);

  const replacedToken = await post<{ token: string }>(`/api/receivables/exports/${scopedId}/token`, reporterToken, {});
  const oneUse = await post<{ token: string }>(`/api/receivables/exports/${scopedId}/token`, reporterToken, {});
  await post(`/api/receivables/exports/${scopedId}/download`, reporterToken, { token: replacedToken.body!.data!.token }, 409);
  const concurrent = await Promise.all([0, 1].map(() => request(`/api/receivables/exports/${scopedId}/download`, reporterToken, { method: "POST", body: JSON.stringify({ token: oneUse.body!.data!.token }) })));
  assert.deepEqual(concurrent.map(({ response }) => response.status).sort(), [200, 409]);
  await Promise.all(concurrent.map(({ response }) => response.arrayBuffer().catch(() => new ArrayBuffer(0))));
  for (let attempt = 0; attempt < 100 && (await files()).some((path) => path === scopedPath); attempt += 1) await delay(25);
  assert.equal((await files()).includes(scopedPath), false, "download response did not clean the export artifact");

  const tamperCreate = await post<{ id: string }>("/api/receivables/exports", reporterToken, { filters: { search: `${marker}-project-1`, settlement: "all" } }, 202);
  const tamperJob = await waitForJob(tamperCreate.body!.data!.id, ["completed"]);
  const tamperToken = await post<{ token: string }>(`/api/receivables/exports/${tamperJob.id}/token`, reporterToken, {});
  await writeFile(resolve(uploadRoot, tamperJob.storageKey!), Buffer.alloc(tamperJob.size!, 0x78));
  await post(`/api/receivables/exports/${tamperJob.id}/download`, reporterToken, { token: tamperToken.body!.data!.token }, 409);
  assert.equal(await prisma.auditLog.count({ where: { action: "receivables.export.download", objectId: tamperJob.id } }), 0);

  const traversalCreate = await post<{ id: string }>("/api/receivables/exports", reporterToken, { filters: { search: `${marker}-project-2`, settlement: "all" } }, 202);
  const traversalJob = await waitForJob(traversalCreate.body!.data!.id, ["completed"]);
  const traversalToken = await post<{ token: string }>(`/api/receivables/exports/${traversalJob.id}/token`, reporterToken, {});
  await prisma.receivableExportJob.update({ where: { id: traversalJob.id }, data: { storageKey: "../outside.xlsx" } });
  await post(`/api/receivables/exports/${traversalJob.id}/download`, reporterToken, { token: traversalToken.body!.data!.token }, 409);
  assert.equal(await prisma.auditLog.count({ where: { action: "receivables.export.download", objectId: traversalJob.id } }), 0);

  const cleanupCreate = await post<{ id: string }>("/api/receivables/exports", adminToken, { filters: { financeDepartmentId: departmentB.id, search: ledgerB.contractNo, settlement: "all" } }, 202);
  const cleanupJob = await waitForJob(cleanupCreate.body!.data!.id, ["completed"]);
  await prisma.receivableExportJob.update({ where: { id: cleanupJob.id }, data: { expiresAt: new Date(0) } });
  const { cleanupExpiredReceivablesExports } = await import("../src/receivables-export.js");
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

  const listed = await expect<{ rows: Job[] }>("/api/receivables/exports?page=1&pageSize=100", reporterToken, 200);
  assert.ok(listed.body!.data!.rows.every((job) => ![ownerCreated.body!.data!.id, adminCreated.body!.data!.id].includes(job.id)), "export list leaked another requester's job");
  const actions = await prisma.auditLog.groupBy({ by: ["action"], where: { actorId: { in: ids.accounts }, action: { startsWith: "receivables.export." } }, _count: true });
  for (const action of ["receivables.export.request", "receivables.export.claim", "receivables.export.complete", "receivables.export.failed", "receivables.export.token", "receivables.export.download", "receivables.export.expire"]) assert.ok(actions.some((row) => row.action === action), `${action} audit missing`);
  const auditMetadata = JSON.stringify((await prisma.auditLog.findMany({ where: { action: { startsWith: "receivables.export." }, actorId: { in: ids.accounts } }, select: { metadata: true } })).map(({ metadata }) => metadata));
  for (const rawToken of [issuedBeforeRevoke.body!.data!.token, replacedToken.body!.data!.token, oneUse.body!.data!.token, tamperToken.body!.data!.token, traversalToken.body!.data!.token]) assert.equal(auditMetadata.includes(rawToken), false, "raw download token leaked into audit metadata");
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors: unknown[] = [];
  for (const action of [stopServer, cleanup, assertClean, () => prisma.$disconnect()]) { try { await action(); } catch (error) { cleanupErrors.push(error); } }
  if (cleanupErrors.length) failure = new AggregateError(failure === undefined ? cleanupErrors : [failure, ...cleanupErrors], "Task10 smoke cleanup failed");
}

if (failure !== undefined) throw failure;
console.log("RECEIVABLES_EXPORT_SMOKE=PASS");
