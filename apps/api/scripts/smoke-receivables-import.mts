import assert from "node:assert/strict";
import { once } from "node:events";
import { rm, mkdir, writeFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { SignJWT } from "jose";
import { orphanPrivateFiles } from "../src/private-file-retention.js";

const root = resolve(import.meta.dirname, "../../..");
const databaseUrl = process.env.DATABASE_URL ?? "";
const baseUrl = process.env.RECEIVABLES_API_BASE_URL ?? "http://127.0.0.1:55448";
const uploadRoot = resolve(root, "var/receivables-import-smoke");
const jwtSecret = "receivables-import-smoke-jwt-secret";
const marker = `rxa-import-${randomUUID().slice(0, 8)}`;
function assertSmokeEnvironment(input: { databaseUrl: string; baseUrl: string; uploadRoot: string }) {
  if (input.databaseUrl !== "postgresql://postgres@127.0.0.1:55432/receivables_test") throw new Error("IMPORT_SMOKE_DATABASE_URL_UNSAFE");
  const api = new URL(input.baseUrl);
  if (api.protocol !== "http:" || api.hostname !== "127.0.0.1" || api.port !== "55448") throw new Error("IMPORT_SMOKE_API_URL_UNSAFE");
  if (resolve(input.uploadRoot) !== resolve(root, "var/receivables-import-smoke")) throw new Error("IMPORT_SMOKE_UPLOAD_ROOT_UNSAFE");
}
assert.throws(() => assertSmokeEnvironment({ databaseUrl: "postgresql://postgres@example.com:5432/production", baseUrl, uploadRoot }), /IMPORT_SMOKE_DATABASE_URL_UNSAFE/);
assertSmokeEnvironment({ databaseUrl, baseUrl, uploadRoot });
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const ids = { organizations: [] as string[], people: [] as string[], accounts: [] as string[], roles: [] as string[], sessions: [] as string[], departments: [] as string[], grants: [] as string[] };
let server: ChildProcess | undefined;
let output = "";
let originalSetting: { financeOrganizationId: string | null; configurationConfirmedAt: Date | null; configurationConfirmedBy: string | null } | null = null;
let settingCaptured = false;
let completed = false;

const delay = (milliseconds: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function identity(label: string, role?: "org_leader" | "company_admin", scopeId?: string) {
  const person = await prisma.person.create({ data: { name: `${marker}-${label}`, phone: `19${Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, "0")}`, type: "employee", status: "active" } }); ids.people.push(person.id);
  const account = await prisma.account.create({ data: { personId: person.id, username: `${marker}-${label}`, usernameNormalized: `${marker}-${label}`, status: "active" } }); ids.accounts.push(account.id);
  if (role) {
    const assignment = await prisma.roleAssignment.create({ data: { personId: person.id, accountId: account.id, role, scopeType: role === "company_admin" ? "company" : "organization", scopeId: scopeId ?? null } });
    ids.roles.push(assignment.id);
  }
  return account;
}

async function token(accountId: string) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { sessionVersion: true } });
  const session = await prisma.refreshSession.create({ data: { accountId, tokenHash: `smoke-${randomUUID()}`, clientKind: "rxa-import-smoke", expiresAt: new Date(Date.now() + 3_600_000), absoluteExpiresAt: new Date(Date.now() + 3_600_000) } }); ids.sessions.push(session.id);
  return new SignJWT({ ver: account.sessionVersion, sid: session.id }).setProtectedHeader({ alg: "HS256" }).setSubject(accountId).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(jwtSecret));
}

async function start() {
  await rm(uploadRoot, { recursive: true, force: true }); await mkdir(uploadRoot, { recursive: true });
  server = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "apps/api/src/server.ts"], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test", PORT: "55448", RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1", PUBLIC_BASE_URL: baseUrl, COOKIE_SECRET: "receivables-import-smoke-cookie-secret", JWT_SECRET: jwtSecret, FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), UPLOAD_SIGNING_SECRET: "receivables-import-smoke-upload-secret", UPLOAD_ROOT: uploadRoot }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout?.on("data", (chunk) => { output += chunk.toString(); }); server.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt += 1) { try { if ((await fetch(`${baseUrl}/api/health`)).status === 200) return; } catch {} if (server.exitCode !== null) throw new Error(output); await delay(50); }
  throw new Error(`import smoke API unavailable: ${output}`);
}

async function stop() {
  if (!server || server.exitCode !== null) return;
  server.kill(); await Promise.race([once(server, "exit"), delay(2_000)]);
  if (server.exitCode === null) { server.kill("SIGKILL"); await Promise.race([once(server, "exit"), delay(2_000)]); }
}

async function workbook(rows: unknown[][]) {
  return customWorkbook(["归属部门", "合同编号", "项目名称", "决算方式", "合同金额", "决算金额", "开票金额", "开票日期", "到账金额", "到账日期"], rows);
}
async function customWorkbook(headers: string[], rows: unknown[][]) {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("台账").addRows([headers, ...rows]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function preview(bearer: string, content: Buffer) {
  const form = new FormData(); form.set("file", new Blob([content], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "import.xlsx");
  const response = await fetch(`${baseUrl}/api/receivables/imports/preview`, { method: "POST", headers: { authorization: `Bearer ${bearer}` }, body: form });
  const body = await response.json() as { data?: any; error?: { code: string } };
  return { response, body };
}

async function post(path: string, bearer: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { response, body: await response.json() as { data?: any; error?: { code: string } } };
}

async function cleanup() {
  const errors: unknown[] = [];
  const attempt = async (action: () => Promise<unknown>) => { try { await action(); } catch (error) { errors.push(error); } };
  const batches = await prisma.receivableImportBatch.findMany({ where: { requestedBy: { in: ids.accounts } }, select: { id: true, originalFileId: true } }).catch((error) => { errors.push(error); return []; });
  await attempt(() => prisma.receivableImportItem.deleteMany({ where: { batchId: { in: batches.map(({ id }) => id) } } }));
  const ledgers = await prisma.receivableLedger.findMany({ where: { OR: [{ contractNoNormalized: { startsWith: marker } }, { createdByImportBatchId: { in: batches.map(({ id }) => id) } }] }, select: { id: true } }).catch((error) => { errors.push(error); return []; });
  const ledgerIds = ledgers.map(({ id }) => id);
  await attempt(() => prisma.receivableInvoice.deleteMany({ where: { ledgerId: { in: ledgerIds } } }));
  await attempt(() => prisma.receivableReceipt.deleteMany({ where: { ledgerId: { in: ledgerIds } } }));
  await attempt(() => prisma.receivableLedgerRevision.deleteMany({ where: { ledgerId: { in: ledgerIds } } }));
  await attempt(() => prisma.receivableLedger.deleteMany({ where: { id: { in: ledgerIds } } }));
  await attempt(() => prisma.receivableImportBatch.deleteMany({ where: { id: { in: batches.map(({ id }) => id) } } }));
  await attempt(() => prisma.privateFile.deleteMany({ where: { id: { in: batches.map(({ originalFileId }) => originalFileId) } } }));
  await attempt(() => prisma.auditLog.deleteMany({ where: { actorId: { in: ids.accounts } } }));
  await attempt(() => prisma.refreshSession.deleteMany({ where: { id: { in: ids.sessions } } }));
  if (settingCaptured) {
    if (originalSetting) await attempt(() => prisma.receivableSetting.update({ where: { id: 1 }, data: originalSetting! }));
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
  if (errors.length) throw new AggregateError(errors, "receivables import fixture cleanup failed");
}

async function assertClean() {
  const [people, accounts, departments, ledgers, batches, files, sessions, invoices, receipts, revisions, audits, setting] = await Promise.all([
    prisma.person.count({ where: { name: { startsWith: marker } } }), prisma.account.count({ where: { username: { startsWith: marker } } }),
    prisma.receivableDepartment.count({ where: { name: { startsWith: marker } } }), prisma.receivableLedger.count({ where: { contractNoNormalized: { startsWith: marker } } }),
    prisma.receivableImportBatch.count({ where: { requestedBy: { in: ids.accounts } } }), prisma.privateFile.count({ where: { uploadedBy: { in: ids.accounts } } }),
    prisma.refreshSession.count({ where: { clientKind: "rxa-import-smoke" } }),
    prisma.receivableInvoice.count({ where: { ledger: { contractNoNormalized: { startsWith: marker } } } }), prisma.receivableReceipt.count({ where: { ledger: { contractNoNormalized: { startsWith: marker } } } }),
    prisma.receivableLedgerRevision.count({ where: { ledger: { contractNoNormalized: { startsWith: marker } } } }), prisma.auditLog.count({ where: { actorId: { in: ids.accounts } } }),
    prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } }),
  ]);
  assert.deepEqual({ people, accounts, departments, ledgers, batches, files, sessions, invoices, receipts, revisions, audits }, { people: 0, accounts: 0, departments: 0, ledgers: 0, batches: 0, files: 0, sessions: 0, invoices: 0, receipts: 0, revisions: 0, audits: 0 }, "import smoke left database residue");
  assert.deepEqual(setting, originalSetting, "import smoke did not restore settings baseline");
  await assert.rejects(lstat(uploadRoot), (error: NodeJS.ErrnoException) => error.code === "ENOENT", "import smoke upload root still exists");
  assert.equal(await new Promise<boolean>((resolveClosed) => { const socket = createConnection({ host: "127.0.0.1", port: 55448 }); socket.once("connect", () => { socket.destroy(); resolveClosed(false); }); socket.once("error", () => resolveClosed(true)); }), true, "import smoke API port still listens");
}

try {
  const finance = await prisma.organization.create({ data: { name: `${marker}-finance`, type: "department" } }); ids.organizations.push(finance.id);
  const owner = await identity("owner", "org_leader", finance.id);
  const admin = await identity("admin"); const reporter = await identity("reporter"); const readonly = await identity("readonly"); const viewAll = await identity("view-all"); const recovery = await identity("recovery", "company_admin");
  originalSetting = await prisma.receivableSetting.findUniqueOrThrow({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } });
  settingCaptured = true;
  await prisma.receivableSetting.update({ where: { id: 1 }, data: { financeOrganizationId: finance.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.id } });
  const department = await prisma.receivableDepartment.create({ data: { name: `${marker}-department` } });
  const inactive = await prisma.receivableDepartment.create({ data: { name: `${marker}-inactive`, active: false } }); ids.departments.push(department.id, inactive.id);
  const adminGrant = await prisma.receivableAccessGrant.create({ data: { accountId: admin.id, grantedBy: owner.id, role: "admin" } });
  const reporterGrant = await prisma.receivableAccessGrant.create({ data: { accountId: reporter.id, grantedBy: owner.id, role: "reporter", departments: { create: { financeDepartmentId: department.id, canRead: true, canWrite: true } } } }); ids.grants.push(adminGrant.id, reporterGrant.id);
  const readonlyGrant = await prisma.receivableAccessGrant.create({ data: { accountId: readonly.id, grantedBy: owner.id, role: "readonly", departments: { create: { financeDepartmentId: department.id, canRead: true } } } });
  const viewAllGrant = await prisma.receivableAccessGrant.create({ data: { accountId: viewAll.id, grantedBy: owner.id, role: "readonly", canViewAll: true } }); ids.grants.push(readonlyGrant.id, viewAllGrant.id);
  const existing = await prisma.receivableLedger.create({ data: { financeDepartmentId: department.id, contractNo: `${marker}-existing`, contractNoNormalized: `${marker}-existing`, projectName: "before", collectionNotes: "preserve", contractAmount: "5.0000", finalAmount: "5.0000", createdBy: owner.id } });
  const inactiveExisting = await prisma.receivableLedger.create({ data: { financeDepartmentId: inactive.id, contractNo: `${marker}-inactive-existing`, contractNoNormalized: `${marker}-inactive-existing`, projectName: "inactive before", createdBy: owner.id } });
  const skipped = await prisma.receivableLedger.create({ data: { financeDepartmentId: department.id, contractNo: `${marker}-skipped`, contractNoNormalized: `${marker}-skipped`, projectName: "unchanged", createdBy: owner.id } });
  const openingExisting = await prisma.receivableLedger.create({ data: { financeDepartmentId: department.id, contractNo: `${marker}-opening-existing`, contractNoNormalized: `${marker}-opening-existing`, projectName: "opening-before", createdBy: owner.id } });
  const [bearer, adminBearer, reporterBearer, readonlyBearer, viewAllBearer, recoveryBearer] = await Promise.all([token(owner.id), token(admin.id), token(reporter.id), token(readonly.id), token(viewAll.id), token(recovery.id)]);
  await start();

  const malformed = { method: "POST", headers: { authorization: `Bearer ${reporterBearer}`, "content-type": "multipart/form-data; boundary=broken" }, body: "broken" };
  for (const denied of [reporterBearer, recoveryBearer]) assert.equal((await fetch(`${baseUrl}/api/receivables/imports/preview`, { ...malformed, headers: { ...malformed.headers, authorization: `Bearer ${denied}` } })).status, 403, "unauthorized import parsed multipart or was allowed");

  const pdf = new FormData(); pdf.set("file", new Blob([Buffer.from("%PDF-1.4")], { type: "application/pdf" }), "not-import.pdf");
  const pdfResponse = await fetch(`${baseUrl}/api/receivables/imports/preview`, { method: "POST", headers: { authorization: `Bearer ${bearer}` }, body: pdf }); assert.equal(pdfResponse.status, 400, await pdfResponse.text());

  const bad = await preview(bearer, await workbook([[department.name, "", "bad"], [inactive.name, `${marker}-bad`, "bad"]]));
  assert.equal(bad.response.status, 201); assert.ok(bad.body.data.errors.length >= 2);
  assert.ok(bad.body.data.errors.some((error: any) => error.code === "DEPARTMENT_INACTIVE"), "new inactive-department assignment must remain blocked");
  const ledgersBeforeBadApply = await prisma.receivableLedger.count({ where: { contractNoNormalized: { startsWith: marker } } });
  const badApply = await post(`/api/receivables/imports/${bad.body.data.batchId}/apply`, bearer, { revision: 1, decisions: [] });
  assert.equal(badApply.response.status, 422); assert.equal(badApply.body.error?.code, "IMPORT_HAS_BLOCKING_ERRORS");
  assert.equal(await prisma.receivableLedger.count({ where: { contractNoNormalized: { startsWith: marker } } }), ledgersBeforeBadApply, "failed batch wrote business facts");

  const inactiveHistoryPreview = await preview(adminBearer, await customWorkbook(["归属部门", "合同编号", "项目名称"], [[inactive.name, inactiveExisting.contractNo, "inactive after"]]));
  assert.equal(inactiveHistoryPreview.response.status, 201, JSON.stringify(inactiveHistoryPreview.body));
  assert.deepEqual(inactiveHistoryPreview.body.data.errors, [], "same-department inactive history must be updateable");
  const inactiveHistoryApply = await post(`/api/receivables/imports/${inactiveHistoryPreview.body.data.batchId}/apply`, adminBearer, { revision: inactiveHistoryPreview.body.data.revision, decisions: [{ rowNumber: 2, decision: "update" }] });
  assert.equal(inactiveHistoryApply.response.status, 200, JSON.stringify(inactiveHistoryApply.body));
  const inactiveExistingAfter = await prisma.receivableLedger.findUniqueOrThrow({ where: { id: inactiveExisting.id } });
  assert.deepEqual({ projectName: inactiveExistingAfter.projectName, financeDepartmentId: inactiveExistingAfter.financeDepartmentId }, { projectName: "inactive after", financeDepartmentId: inactive.id });

  const valid = await preview(adminBearer, await workbook([
    [department.name, `${marker}-new`, "new", "合同金额", "100.0000", "", "20.0000", "2026-09-01", "3.0000", "2026-09-02"],
    [department.name, existing.contractNo, "after", "合同金额", "7.0000", "", "", "", "", ""],
    [department.name, skipped.contractNo, "must-not-change", "合同金额", "9.0000", "", "", "", "", ""],
  ]));
  assert.equal(valid.response.status, 201, JSON.stringify(valid.body)); assert.equal(valid.body.data.errors.length, 0);
  assert.equal(await prisma.receivableLedger.count({ where: { contractNoNormalized: `${marker}-new` } }), 0, "preview wrote a ledger");
  const missingDecision = await post(`/api/receivables/imports/${valid.body.data.batchId}/apply`, adminBearer, { revision: valid.body.data.revision, decisions: [] });
  assert.equal(missingDecision.response.status, 422); assert.equal(missingDecision.body.error?.code, "IMPORT_DECISION_REQUIRED");
  const deniedApply = await post(`/api/receivables/imports/${valid.body.data.batchId}/apply`, reporterBearer, { revision: valid.body.data.revision, decisions: [{ rowNumber: 3, decision: "update" }, { rowNumber: 4, decision: "skip" }] }); assert.equal(deniedApply.response.status, 403);
  const applyBody = { revision: valid.body.data.revision, decisions: [{ rowNumber: 3, decision: "update" }, { rowNumber: 4, decision: "skip" }] };
  const applied = await Promise.all([post(`/api/receivables/imports/${valid.body.data.batchId}/apply`, adminBearer, applyBody), post(`/api/receivables/imports/${valid.body.data.batchId}/apply`, adminBearer, applyBody)]);
  assert.deepEqual(applied.map(({ response }) => response.status).sort(), [200, 409], `concurrent apply must succeed once: ${JSON.stringify(applied.map(({ body }) => body))}`);
  const newLedger = await prisma.receivableLedger.findUniqueOrThrow({ where: { contractNoNormalized: `${marker}-new` }, include: { invoices: true, receipts: true } });
  assert.equal(newLedger.invoices[0]?.source, "opening_import"); assert.equal(newLedger.receipts[0]?.source, "opening_import");
  const invoiceAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "receivables.money.invoice.create", objectId: newLedger.id, result: "success" } });
  assert.equal((invoiceAudit.metadata as any).before.revision, 1); assert.ok(Object.prototype.hasOwnProperty.call((invoiceAudit.metadata as any).before, "openingChargeDate"));
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: existing.id } })).projectName, "after");
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: existing.id } })).collectionNotes, "preserve", "omitted update field was cleared");
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: skipped.id } })).projectName, "unchanged");
  const success = applied.find(({ response }) => response.status === 200)!.body.data;
  const deniedRollback = await post(`/api/receivables/imports/${valid.body.data.batchId}/rollback`, reporterBearer, { revision: success.revision, reason: "越权" }); assert.equal(deniedRollback.response.status, 403);
  const rollback = await post(`/api/receivables/imports/${valid.body.data.batchId}/rollback`, bearer, { revision: success.revision, reason: "整批更正" });
  assert.equal(rollback.response.status, 200, JSON.stringify(rollback.body));
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: newLedger.id } })).status, "voided");
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: existing.id } })).projectName, "before");

  const itemAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "receivables.import.item.update", objectId: existing.id } });
  assert.equal((itemAudit.metadata as any).before.projectName, "before"); assert.equal((itemAudit.metadata as any).after.projectName, "after"); assert.equal((itemAudit.metadata as any).batchId, valid.body.data.batchId); assert.equal((itemAudit.metadata as any).rowNumber, 3); assert.equal((itemAudit.metadata as any).targetRevision, 1); assert.equal((itemAudit.metadata as any).appliedRevision, 2);
  const rollbackAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "receivables.import.item.rollback", objectId: existing.id } });
  assert.equal((rollbackAudit.metadata as any).before.projectName, "after"); assert.equal((rollbackAudit.metadata as any).after.projectName, "before"); assert.equal((rollbackAudit.metadata as any).rowNumber, 3); assert.equal((rollbackAudit.metadata as any).appliedRevision, 2); assert.equal((rollbackAudit.metadata as any).rollbackRevision, 3);
  const createAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "receivables.import.item.create", objectId: newLedger.id } });
  assert.equal((createAudit.metadata as any).before, null); assert.equal((createAudit.metadata as any).after.id, newLedger.id); assert.equal((createAudit.metadata as any).rowNumber, 2);

  const openingPreview = await preview(bearer, await workbook([[department.name, openingExisting.contractNo, "drop", "合同金额", "1", "", "2", "2026-09-01", "", ""]]));
  assert.deepEqual(openingPreview.body.data.rows[0].normalizedData.presentFields.includes("openingInvoiceAmount"), true);
  assert.ok(openingPreview.body.data.warnings.some((warning: any) => warning.code === "EXISTING_OPENING_TOTALS_SKIP_ONLY"));
  const openingUpdate = await post(`/api/receivables/imports/${openingPreview.body.data.batchId}/apply`, bearer, { revision: 1, decisions: [{ rowNumber: 2, decision: "update" }] });
  assert.equal(openingUpdate.response.status, 422); assert.equal(openingUpdate.body.error?.code, "IMPORT_OPENING_TOTALS_UPDATE_FORBIDDEN");
  const openingSkip = await post(`/api/receivables/imports/${openingPreview.body.data.batchId}/apply`, bearer, { revision: 1, decisions: [{ rowNumber: 2, decision: "skip" }] });
  assert.equal(openingSkip.response.status, 200); assert.equal(openingSkip.body.data.items[0].result, "skipped");
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: openingExisting.id } })).projectName, "opening-before");

  const bulkRows = Array.from({ length: 50 }, (_, index) => [department.name, `${marker}-bulk-${index.toString().padStart(2, "0")}`, `bulk ${index}`, "合同金额", "1.0000", "", "", "", "", ""]);
  const bulkPreview = await preview(bearer, await workbook(bulkRows));
  assert.equal(bulkPreview.response.status, 201, JSON.stringify(bulkPreview.body)); assert.equal(bulkPreview.body.data.rows.length, 50);
  const bulkApply = await post(`/api/receivables/imports/${bulkPreview.body.data.batchId}/apply`, bearer, { revision: bulkPreview.body.data.revision, decisions: [] });
  assert.equal(bulkApply.response.status, 200, JSON.stringify(bulkApply.body)); assert.equal(bulkApply.body.data.items.filter((item: any) => item.result === "created").length, 50);
  assert.equal(await prisma.receivableLedger.count({ where: { contractNoNormalized: { startsWith: `${marker}-bulk-` } } }), 50);

  const importFileId = (await prisma.receivableImportBatch.findUniqueOrThrow({ where: { id: valid.body.data.batchId } })).originalFileId;
  await prisma.privateFile.update({ where: { id: importFileId }, data: { createdAt: new Date("2000-01-01T00:00:00.000Z") } });
  assert.equal((await orphanPrivateFiles(prisma, new Date("2001-01-01T00:00:00.000Z"))).some(({ id }) => id === importFileId), false, "linked import file was classified as orphan");
  const download = (tokenValue: string) => fetch(`${baseUrl}/api/files/${importFileId}`, { headers: { authorization: `Bearer ${tokenValue}` } });
  assert.equal((await download(bearer)).status, 200); assert.equal((await download(adminBearer)).status, 200);
  const readAudits = () => prisma.auditLog.count({ where: { action: "file.read", objectId: importFileId, result: "success" } });
  assert.equal(await readAudits(), 2);
  for (const denied of [reporterBearer, readonlyBearer, viewAllBearer, recoveryBearer]) assert.equal((await download(denied)).status, 403);
  assert.equal(await readAudits(), 2, "denied import-file read wrote success audit");

  const adminOwnedPreview = await preview(adminBearer, await workbook([[department.name, `${marker}-revoked-uploader`, "revoked uploader", "合同金额", "1", "", "", "", "", ""]]));
  const adminOwnedFileId = (await prisma.receivableImportBatch.findUniqueOrThrow({ where: { id: adminOwnedPreview.body.data.batchId } })).originalFileId;
  assert.equal((await fetch(`${baseUrl}/api/files/${adminOwnedFileId}`, { headers: { authorization: `Bearer ${adminBearer}` } })).status, 200);
  await prisma.receivableAccessGrant.update({ where: { id: adminGrant.id }, data: { active: false, revokedAt: new Date(), revokedBy: owner.id, revokeReason: "smoke revoke" } });
  assert.equal((await fetch(`${baseUrl}/api/files/${adminOwnedFileId}`, { headers: { authorization: `Bearer ${adminBearer}` } })).status, 403, "revoked uploader retained generic uploader access");
  assert.equal(await readAudits(), 2);

  const tampered = await preview(bearer, await workbook([[department.name, `${marker}-tamper`, "tamper", "合同金额", "1", "", "", "", "", ""]]));
  const tamperBatch = await prisma.receivableImportBatch.findUniqueOrThrow({ where: { id: tampered.body.data.batchId }, include: { originalFile: true } });
  await writeFile(resolve(uploadRoot, tamperBatch.originalFile.storageKey), Buffer.alloc(tamperBatch.originalFile.size, 1));
  const tamperApply = await post(`/api/receivables/imports/${tampered.body.data.batchId}/apply`, bearer, { revision: 1, decisions: [] });
  assert.equal(tamperApply.response.status, 409); assert.equal(tamperApply.body.error?.code, "IMPORT_FILE_CHANGED");

  const missing = await preview(bearer, await workbook([[department.name, `${marker}-missing-file`, "missing", "合同金额", "1", "", "", "", "", ""]]));
  const missingBatch = await prisma.receivableImportBatch.findUniqueOrThrow({ where: { id: missing.body.data.batchId }, include: { originalFile: true } });
  await rm(resolve(uploadRoot, missingBatch.originalFile.storageKey));
  const missingApply = await post(`/api/receivables/imports/${missing.body.data.batchId}/apply`, bearer, { revision: 1, decisions: [] });
  assert.equal(missingApply.response.status, 409); assert.equal(missingApply.body.error?.code, "IMPORT_FILE_CHANGED");
  assert.equal(await prisma.receivableLedger.count({ where: { contractNoNormalized: `${marker}-missing-file` } }), 0);

  const conflictPreview = await preview(bearer, await workbook([[department.name, `${marker}-rollback-conflict`, "conflict", "合同金额", "1", "", "", "", "", ""]]));
  const conflictApply = await post(`/api/receivables/imports/${conflictPreview.body.data.batchId}/apply`, bearer, { revision: 1, decisions: [] }); assert.equal(conflictApply.response.status, 200);
  const conflictLedger = await prisma.receivableLedger.findUniqueOrThrow({ where: { contractNoNormalized: `${marker}-rollback-conflict` } });
  await prisma.receivableLedger.update({ where: { id: conflictLedger.id }, data: { collectionNotes: "later change", revision: { increment: 1 } } });
  const beforeConflictRevisions = await prisma.receivableLedgerRevision.count({ where: { ledgerId: conflictLedger.id } });
  const conflictRollback = await post(`/api/receivables/imports/${conflictPreview.body.data.batchId}/rollback`, bearer, { revision: conflictApply.body.data.revision, reason: "不得覆盖后续变更" });
  assert.equal(conflictRollback.response.status, 409); assert.equal(conflictRollback.body.error?.code, "IMPORT_ROLLBACK_CONFLICT");
  assert.equal((await prisma.receivableImportBatch.findUniqueOrThrow({ where: { id: conflictPreview.body.data.batchId } })).status, "applied");
  assert.equal(await prisma.receivableLedgerRevision.count({ where: { ledgerId: conflictLedger.id } }), beforeConflictRevisions, "rollback conflict wrote correction facts");

  const listed = await fetch(`${baseUrl}/api/receivables/imports`, { headers: { authorization: `Bearer ${bearer}` } }); assert.equal(listed.status, 200);
  completed = true;
} finally {
  const cleanupErrors: unknown[] = [];
  for (const action of [stop, cleanup, assertClean, () => prisma.$disconnect()]) { try { await action(); } catch (error) { cleanupErrors.push(error); } }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "receivables import smoke cleanup failed");
}
if (completed) console.log("RECEIVABLES_IMPORT_SMOKE=PASS");
