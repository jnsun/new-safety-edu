import assert from "node:assert/strict";
import { once } from "node:events";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { SignJWT } from "jose";

const root = resolve(import.meta.dirname, "../../..");
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:55432/receivables_test";
const baseUrl = process.env.RECEIVABLES_API_BASE_URL ?? "http://127.0.0.1:55448";
const uploadRoot = resolve(root, "var/receivables-import-smoke");
const jwtSecret = "receivables-import-smoke-jwt-secret";
const marker = `rxa-import-${randomUUID().slice(0, 8)}`;
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
  const book = new ExcelJS.Workbook();
  book.addWorksheet("台账").addRows([["归属部门", "合同编号", "项目名称", "决算方式", "合同金额", "决算金额", "开票金额", "开票日期", "到账金额", "到账日期"], ...rows]);
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
  const batches = await prisma.receivableImportBatch.findMany({ where: { requestedBy: { in: ids.accounts } }, select: { id: true, originalFileId: true } });
  await prisma.receivableImportItem.deleteMany({ where: { batchId: { in: batches.map(({ id }) => id) } } });
  const ledgers = await prisma.receivableLedger.findMany({ where: { OR: [{ contractNoNormalized: { startsWith: marker } }, { createdByImportBatchId: { in: batches.map(({ id }) => id) } }] }, select: { id: true } });
  const ledgerIds = ledgers.map(({ id }) => id);
  await prisma.receivableInvoice.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
  await prisma.receivableReceipt.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
  await prisma.receivableLedgerRevision.deleteMany({ where: { ledgerId: { in: ledgerIds } } });
  await prisma.receivableLedger.deleteMany({ where: { id: { in: ledgerIds } } });
  await prisma.receivableImportBatch.deleteMany({ where: { id: { in: batches.map(({ id }) => id) } } });
  await prisma.privateFile.deleteMany({ where: { id: { in: batches.map(({ originalFileId }) => originalFileId) } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.accounts } } });
  await prisma.refreshSession.deleteMany({ where: { id: { in: ids.sessions } } });
  if (settingCaptured) {
    if (originalSetting) await prisma.receivableSetting.update({ where: { id: 1 }, data: originalSetting });
    else await prisma.receivableSetting.deleteMany({ where: { id: 1 } });
  }
  await prisma.receivableGrantDepartment.deleteMany({ where: { grantId: { in: ids.grants } } });
  await prisma.receivableAccessGrant.deleteMany({ where: { id: { in: ids.grants } } });
  await prisma.receivableDepartment.deleteMany({ where: { id: { in: ids.departments } } });
  await prisma.roleAssignment.deleteMany({ where: { id: { in: ids.roles } } });
  await prisma.account.deleteMany({ where: { id: { in: ids.accounts } } });
  await prisma.person.deleteMany({ where: { id: { in: ids.people } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids.organizations } } });
  await rm(uploadRoot, { recursive: true, force: true });
}

async function assertClean() {
  const [people, accounts, departments, ledgers, batches, files, sessions, setting] = await Promise.all([
    prisma.person.count({ where: { name: { startsWith: marker } } }), prisma.account.count({ where: { username: { startsWith: marker } } }),
    prisma.receivableDepartment.count({ where: { name: { startsWith: marker } } }), prisma.receivableLedger.count({ where: { contractNoNormalized: { startsWith: marker } } }),
    prisma.receivableImportBatch.count({ where: { requestedBy: { in: ids.accounts } } }), prisma.privateFile.count({ where: { uploadedBy: { in: ids.accounts } } }),
    prisma.refreshSession.count({ where: { clientKind: "rxa-import-smoke" } }), prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } }),
  ]);
  assert.deepEqual({ people, accounts, departments, ledgers, batches, files, sessions }, { people: 0, accounts: 0, departments: 0, ledgers: 0, batches: 0, files: 0, sessions: 0 }, "import smoke left database residue");
  assert.deepEqual(setting, originalSetting, "import smoke did not restore settings baseline");
}

try {
  const finance = await prisma.organization.create({ data: { name: `${marker}-finance`, type: "department" } }); ids.organizations.push(finance.id);
  const owner = await identity("owner", "org_leader", finance.id);
  const admin = await identity("admin"); const reporter = await identity("reporter"); const recovery = await identity("recovery", "company_admin");
  originalSetting = await prisma.receivableSetting.findUniqueOrThrow({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } });
  settingCaptured = true;
  await prisma.receivableSetting.update({ where: { id: 1 }, data: { financeOrganizationId: finance.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.id } });
  const department = await prisma.receivableDepartment.create({ data: { name: `${marker}-department` } });
  const inactive = await prisma.receivableDepartment.create({ data: { name: `${marker}-inactive`, active: false } }); ids.departments.push(department.id, inactive.id);
  const adminGrant = await prisma.receivableAccessGrant.create({ data: { accountId: admin.id, grantedBy: owner.id, role: "admin" } });
  const reporterGrant = await prisma.receivableAccessGrant.create({ data: { accountId: reporter.id, grantedBy: owner.id, role: "reporter", departments: { create: { financeDepartmentId: department.id, canRead: true, canWrite: true } } } }); ids.grants.push(adminGrant.id, reporterGrant.id);
  const existing = await prisma.receivableLedger.create({ data: { financeDepartmentId: department.id, contractNo: `${marker}-existing`, contractNoNormalized: `${marker}-existing`, projectName: "before", contractAmount: "5.0000", finalAmount: "5.0000", createdBy: owner.id } });
  const skipped = await prisma.receivableLedger.create({ data: { financeDepartmentId: department.id, contractNo: `${marker}-skipped`, contractNoNormalized: `${marker}-skipped`, projectName: "unchanged", createdBy: owner.id } });
  const [bearer, adminBearer, reporterBearer, recoveryBearer] = await Promise.all([token(owner.id), token(admin.id), token(reporter.id), token(recovery.id)]);
  await start();

  const malformed = { method: "POST", headers: { authorization: `Bearer ${reporterBearer}`, "content-type": "multipart/form-data; boundary=broken" }, body: "broken" };
  for (const denied of [reporterBearer, recoveryBearer]) assert.equal((await fetch(`${baseUrl}/api/receivables/imports/preview`, { ...malformed, headers: { ...malformed.headers, authorization: `Bearer ${denied}` } })).status, 403, "unauthorized import parsed multipart or was allowed");

  const bad = await preview(bearer, await workbook([[department.name, "", "bad"], [inactive.name, `${marker}-bad`, "bad"]]));
  assert.equal(bad.response.status, 201); assert.ok(bad.body.data.errors.length >= 2);
  const ledgersBeforeBadApply = await prisma.receivableLedger.count({ where: { contractNoNormalized: { startsWith: marker } } });
  const badApply = await post(`/api/receivables/imports/${bad.body.data.batchId}/apply`, bearer, { revision: 1, decisions: [] });
  assert.equal(badApply.response.status, 422); assert.equal(badApply.body.error?.code, "IMPORT_HAS_BLOCKING_ERRORS");
  assert.equal(await prisma.receivableLedger.count({ where: { contractNoNormalized: { startsWith: marker } } }), ledgersBeforeBadApply, "failed batch wrote business facts");

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
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: skipped.id } })).projectName, "unchanged");
  const success = applied.find(({ response }) => response.status === 200)!.body.data;
  const deniedRollback = await post(`/api/receivables/imports/${valid.body.data.batchId}/rollback`, reporterBearer, { revision: success.revision, reason: "越权" }); assert.equal(deniedRollback.response.status, 403);
  const rollback = await post(`/api/receivables/imports/${valid.body.data.batchId}/rollback`, bearer, { revision: success.revision, reason: "整批更正" });
  assert.equal(rollback.response.status, 200, JSON.stringify(rollback.body));
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: newLedger.id } })).status, "voided");
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: existing.id } })).projectName, "before");

  const tampered = await preview(bearer, await workbook([[department.name, `${marker}-tamper`, "tamper", "合同金额", "1", "", "", "", "", ""]]));
  const tamperBatch = await prisma.receivableImportBatch.findUniqueOrThrow({ where: { id: tampered.body.data.batchId }, include: { originalFile: true } });
  await writeFile(resolve(uploadRoot, tamperBatch.originalFile.storageKey), Buffer.alloc(tamperBatch.originalFile.size, 1));
  const tamperApply = await post(`/api/receivables/imports/${tampered.body.data.batchId}/apply`, bearer, { revision: 1, decisions: [] });
  assert.equal(tamperApply.response.status, 409); assert.equal(tamperApply.body.error?.code, "IMPORT_FILE_CHANGED");

  const conflictPreview = await preview(bearer, await workbook([[department.name, `${marker}-rollback-conflict`, "conflict", "合同金额", "1", "", "", "", "", ""]]));
  const conflictApply = await post(`/api/receivables/imports/${conflictPreview.body.data.batchId}/apply`, bearer, { revision: 1, decisions: [] }); assert.equal(conflictApply.response.status, 200);
  const conflictLedger = await prisma.receivableLedger.findUniqueOrThrow({ where: { contractNoNormalized: `${marker}-rollback-conflict` } });
  await prisma.receivableLedger.update({ where: { id: conflictLedger.id }, data: { collectionNotes: "later change", revision: { increment: 1 } } });
  const beforeConflictRevisions = await prisma.receivableLedgerRevision.count({ where: { ledgerId: conflictLedger.id } });
  const conflictRollback = await post(`/api/receivables/imports/${conflictPreview.body.data.batchId}/rollback`, bearer, { revision: conflictApply.body.data.revision, reason: "不得覆盖后续变更" });
  assert.equal(conflictRollback.response.status, 409); assert.equal(conflictRollback.body.error?.code, "IMPORT_ROLLBACK_CONFLICT");
  assert.equal((await prisma.receivableImportBatch.findUniqueOrThrow({ where: { id: conflictPreview.body.data.batchId } })).status, "applied");
  assert.equal(await prisma.receivableLedgerRevision.count({ where: { ledgerId: conflictLedger.id } }), beforeConflictRevisions, "rollback conflict wrote correction facts");

  const listed = await fetch(`${baseUrl}/api/receivables/imports`, { headers: { authorization: `Bearer ${adminBearer}` } }); assert.equal(listed.status, 200);
  completed = true;
} finally {
  await stop();
  await cleanup();
  await assertClean();
  await prisma.$disconnect();
}
if (completed) console.log("RECEIVABLES_IMPORT_SMOKE=PASS");
