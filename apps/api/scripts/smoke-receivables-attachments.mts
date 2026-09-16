import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import archiver from "archiver";
import ExcelJS from "exceljs";
import { SignJWT } from "jose";
import unzipper from "unzipper";
import { orphanPrivateFiles } from "../src/private-file-retention.js";
import { RECEIVABLE_WORKBOOK_LIMITS, parseReceivableWorkbookEndOfCentralDirectory, preflightReceivableWorkbookArchive, receivableAttachmentStoragePath, removeReceivableAttachmentFiles, validateReceivableWorkbookDirectory, validateReceivableWorkbookShape } from "../src/receivables-files.js";

const expectedDatabaseUrl = "postgresql://postgres@127.0.0.1:55432/receivables_test";
const databaseUrl = process.env.DATABASE_URL ?? "";
assert.equal(databaseUrl, expectedDatabaseUrl, `Refusing to run outside ${expectedDatabaseUrl}`);
const baseUrl = process.env.RECEIVABLES_API_BASE_URL ?? "http://127.0.0.1:55448";
const apiUrl = new URL(baseUrl); assert.equal(apiUrl.hostname, "127.0.0.1"); assert.equal(apiUrl.port, "55448");
const root = resolve(import.meta.dirname, "../../..");
const uploadRoot = resolve(root, ".artifact-work", "task8-receivables-uploads");
assert.match(uploadRoot, /[\\/]\.artifact-work[\\/]task8-receivables-uploads$/i, "Refusing unsafe upload root");
const marker = `rxa-files-${randomUUID()}`;
const jwtSecret = "receivables-attachments-smoke-jwt-secret";
const prisma = new PrismaClient();
const ids = { accounts: [] as string[], people: [] as string[], organizations: [] as string[], roles: [] as string[], sessions: [] as string[], departments: [] as string[], grants: [] as string[], ledgers: [] as string[], files: [] as string[] };
let server: ChildProcess | null = null;
let output = "";
let phone = Math.floor(Math.random() * 900_000) + 100_000;
let originalSetting: { financeOrganizationId: string | null; configurationConfirmedAt: Date | null; configurationConfirmedBy: string | null } | null = null;
let settingExisted = false;
let failure: unknown;
type Json<T = unknown> = { data?: T; error?: { code: string; message: string } };
type Attachment = { id: string; revision: number; status: "active" | "voided"; file: { id: string; storageKey: string; size: number; sha256: string } };
type Fixture = { filename: string; mime: string; content: Buffer };
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
const hash = (content: Buffer) => createHash("sha256").update(content).digest("hex");

async function storedFiles(path = uploadRoot): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? storedFiles(resolve(path, entry.name)) : [resolve(path, entry.name)]))).flat();
}

async function identity(label: string, role?: "org_leader" | "company_admin", scopeId?: string) {
  const person = await prisma.person.create({ data: { name: `${marker}-${label}`, phone: `19${String(phone++).padStart(9, "0")}`, type: "employee", status: "active" } }); ids.people.push(person.id);
  const account = await prisma.account.create({ data: { username: `${marker}-${label}`, usernameNormalized: `${marker}-${label}`, status: "active", personId: person.id } }); ids.accounts.push(account.id);
  if (role) { const row = await prisma.roleAssignment.create({ data: { accountId: account.id, personId: person.id, role, scopeType: role === "company_admin" ? "company" : "organization", scopeId: scopeId ?? null } }); ids.roles.push(row.id); }
  return account;
}

async function grant(accountId: string, grantedBy: string, role: "admin" | "reporter" | "readonly", departmentId?: string, canViewAll = false, canMaintainCollection = false) {
  const row = await prisma.receivableAccessGrant.create({ data: { accountId, grantedBy, role, canViewAll, canMaintainCollection, departments: departmentId ? { create: { financeDepartmentId: departmentId, canRead: true, canWrite: role === "reporter" } } : undefined } }); ids.grants.push(row.id);
}

async function token(accountId: string) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { sessionVersion: true } });
  const session = await prisma.refreshSession.create({ data: { accountId, tokenHash: `smoke-${randomUUID()}`, clientKind: "rxa-files-smoke", expiresAt: new Date(Date.now() + 3_600_000), absoluteExpiresAt: new Date(Date.now() + 3_600_000) } }); ids.sessions.push(session.id);
  return new SignJWT({ ver: account.sessionVersion, sid: session.id }).setProtectedHeader({ alg: "HS256" }).setSubject(accountId).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(jwtSecret));
}

async function request<T>(path: string, bearer: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${bearer}`, ...init.headers } });
  return { response, body: response.headers.get("content-type")?.includes("application/json") ? await response.json() as Json<T> : undefined };
}

async function expect<T>(path: string, bearer: string, statusCode: number, init: RequestInit = {}) {
  const result = await request<T>(path, bearer, init);
  assert.equal(result.response.status, statusCode, `${init.method ?? "GET"} ${path}: ${JSON.stringify(result.body)}`);
  return result;
}

function form(ledgerRevision: number, fixture: Fixture) {
  const body = new FormData(); body.set("ledgerRevision", String(ledgerRevision)); body.set("category", "proof"); body.set("file", new Blob([fixture.content], { type: fixture.mime }), fixture.filename); return body;
}

async function plainZip() {
  const zip = archiver("zip"); const chunks: Buffer[] = [];
  zip.on("data", (chunk: Buffer) => chunks.push(chunk));
  const ended = once(zip, "end");
  zip.append("not an Excel workbook", { name: "readme.txt" });
  await zip.finalize(); await ended;
  return Buffer.concat(chunks);
}

async function validXlsx() {
  const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("Evidence").addRow(["ok"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function bombXlsx() {
  const source = await unzipper.Open.buffer(await validXlsx());
  const zip = archiver("zip"); const chunks: Buffer[] = [];
  zip.on("data", (chunk: Buffer) => chunks.push(chunk));
  const ended = once(zip, "end");
  for (const file of source.files.filter(({ type }) => type === "File")) zip.append(await file.buffer(), { name: file.path });
  zip.append(Buffer.alloc(16 * 1024 * 1024 + 1), { name: "xl/media/bomb.bin" });
  await zip.finalize(); await ended;
  const content = Buffer.concat(chunks); assert.ok(content.length <= 10 * 1024 * 1024, "bomb fixture must stay within upload limit");
  return content;
}

function checkWorkbookResourcePolicy() {
  const entry = (overrides: Partial<{ path: string; type: "Directory" | "File"; flags: number; compressedSize: number; uncompressedSize: number }> = {}) => ({ path: "xl/workbook.xml", type: "File" as const, flags: 0, compressedSize: 10, uncompressedSize: 20, ...overrides });
  assert.deepEqual(RECEIVABLE_WORKBOOK_LIMITS, { entries: 256, entryUncompressedBytes: 16 * 1024 * 1024, totalUncompressedBytes: 64 * 1024 * 1024, compressionRatio: 100, worksheets: 50, rows: 200_000, cells: 1_000_000 });
  assert.doesNotThrow(() => validateReceivableWorkbookDirectory([entry()]));
  for (const entries of [
    Array.from({ length: 257 }, (_, index) => entry({ path: `xl/item-${index}.xml` })),
    [entry({ uncompressedSize: 16 * 1024 * 1024 + 1 })],
    Array.from({ length: 5 }, (_, index) => entry({ path: `xl/large-${index}.xml`, compressedSize: 14 * 1024 * 1024, uncompressedSize: 14 * 1024 * 1024 })),
    [entry({ compressedSize: 1, uncompressedSize: 101 })],
    [entry({ compressedSize: 0, uncompressedSize: 1 })],
    [entry({ flags: 1 })],
    [entry({ path: "../workbook.xml" })],
    [entry({ path: "/workbook.xml" })],
    [entry({ path: "xl\\workbook.xml" })],
    [entry({ path: "xl/\0workbook.xml" })],
    [entry({ path: "C:/workbook.xml" })],
    [entry(), entry()],
  ]) assert.throws(() => validateReceivableWorkbookDirectory(entries), (error: Error & { code?: string }) => error.code === "INVALID_FILE_CONTENT");
  const tooManySheets = new ExcelJS.Workbook(); for (let index = 0; index <= RECEIVABLE_WORKBOOK_LIMITS.worksheets; index += 1) tooManySheets.addWorksheet(`Sheet${index}`);
  assert.throws(() => validateReceivableWorkbookShape(tooManySheets), (error: Error & { code?: string }) => error.code === "INVALID_FILE_CONTENT");
  const sparseRows = new ExcelJS.Workbook(); sparseRows.addWorksheet("Rows").getCell(`A${RECEIVABLE_WORKBOOK_LIMITS.rows + 1}`).value = "too far";
  assert.throws(() => validateReceivableWorkbookShape(sparseRows), (error: Error & { code?: string }) => error.code === "INVALID_FILE_CONTENT");
}

function maliciousEndOfCentralDirectory(overrides: Partial<{ diskNumber: number; diskStart: number; entriesOnDisk: number; entries: number; centralSize: number; centralOffset: number; commentLength: number }> = {}) {
  const values = { diskNumber: 0, diskStart: 0, entriesOnDisk: 1, entries: 1, centralSize: 0, centralOffset: 0, commentLength: 0, ...overrides };
  const content = Buffer.alloc(22 + values.commentLength); content.writeUInt32LE(0x06054b50, 0); content.writeUInt16LE(values.diskNumber, 4); content.writeUInt16LE(values.diskStart, 6); content.writeUInt16LE(values.entriesOnDisk, 8); content.writeUInt16LE(values.entries, 10); content.writeUInt32LE(values.centralSize, 12); content.writeUInt32LE(values.centralOffset, 16); content.writeUInt16LE(values.commentLength, 20); return content;
}

function downstreamDivergentEndOfCentralDirectory() {
  const content = Buffer.alloc(200);
  maliciousEndOfCentralDirectory({ commentLength: 78 }).copy(content, 100);
  maliciousEndOfCentralDirectory({ entriesOnDisk: 0xffff, entries: 0xffff }).copy(content, 150, 0, 22);
  return content;
}

async function checkBoundedEndOfCentralDirectory() {
  const workbook = await validXlsx();
  const parsed = parseReceivableWorkbookEndOfCentralDirectory(workbook);
  assert.ok(parsed.entries > 0 && parsed.entries <= 256); assert.ok(parsed.centralOffset + parsed.centralSize <= parsed.endOffset);
  for (const content of [
    Buffer.alloc(200),
    downstreamDivergentEndOfCentralDirectory(),
    (() => { const content = maliciousEndOfCentralDirectory({ commentLength: 58 }); maliciousEndOfCentralDirectory().copy(content, 40, 0, 22); return content; })(),
    maliciousEndOfCentralDirectory({ entriesOnDisk: 0xffff, entries: 0xffff, centralSize: 0xffffffff, centralOffset: 0xffffffff }),
    maliciousEndOfCentralDirectory({ entriesOnDisk: 257, entries: 257 }),
    maliciousEndOfCentralDirectory({ diskNumber: 1 }),
    maliciousEndOfCentralDirectory({ diskStart: 1 }),
    maliciousEndOfCentralDirectory({ entriesOnDisk: 1, entries: 2 }),
    maliciousEndOfCentralDirectory({ centralSize: 1 }),
    Buffer.concat([maliciousEndOfCentralDirectory(), Buffer.from("trailing")]),
  ]) assert.throws(() => parseReceivableWorkbookEndOfCentralDirectory(content), (error: Error & { code?: string }) => error.code === "INVALID_FILE_CONTENT");
  const zip64Locator = Buffer.alloc(20); zip64Locator.writeUInt32LE(0x07064b50, 0);
  const zip64Record = Buffer.alloc(56); zip64Record.writeUInt32LE(0x06064b50, 0);
  for (const content of [Buffer.concat([zip64Locator, maliciousEndOfCentralDirectory()]), Buffer.concat([zip64Record, maliciousEndOfCentralDirectory()])]) assert.throws(() => parseReceivableWorkbookEndOfCentralDirectory(content), (error: Error & { code?: string }) => error.code === "INVALID_FILE_CONTENT");
  const open = unzipper.Open as typeof unzipper.Open & { buffer: typeof unzipper.Open.buffer }; const original = open.buffer; let thirdPartyCalled = false;
  open.buffer = (() => { thirdPartyCalled = true; throw new Error("unzipper must not receive rejected metadata"); }) as typeof open.buffer;
  try { for (const content of [maliciousEndOfCentralDirectory({ entriesOnDisk: 0xffff, entries: 0xffff }), downstreamDivergentEndOfCentralDirectory()]) await assert.rejects(() => preflightReceivableWorkbookArchive(content), (error: Error & { code?: string }) => error.code === "INVALID_FILE_CONTENT"); }
  finally { open.buffer = original; }
  assert.equal(thirdPartyCalled, false, "malicious EOCD reached unzipper");
}

async function start() {
  await rm(uploadRoot, { recursive: true, force: true }); await mkdir(uploadRoot, { recursive: true });
  server = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "apps/api/src/server.ts"], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test", PORT: "55448", RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1", PUBLIC_BASE_URL: baseUrl, COOKIE_SECRET: "receivables-attachments-smoke-cookie-secret", JWT_SECRET: jwtSecret, FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"), UPLOAD_SIGNING_SECRET: "receivables-attachments-smoke-upload-secret", UPLOAD_ROOT: uploadRoot }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout?.on("data", (chunk) => { output += chunk.toString(); }); server.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt += 1) { if (server.exitCode !== null) throw new Error(output); try { if ((await fetch(`${baseUrl}/api/health`)).status === 200) return; } catch {} await delay(50); }
  throw new Error(`attachments smoke API unavailable: ${output}`);
}

async function stop() {
  if (!server || server.exitCode !== null) return;
  server.kill(); await Promise.race([once(server, "exit"), delay(2_000)]);
  if (server.exitCode === null) { server.kill("SIGKILL"); await Promise.race([once(server, "exit"), delay(2_000)]); }
  assert.ok(server.exitCode !== null || server.signalCode !== null, "attachments smoke API did not stop");
}

async function cleanup() {
  const cleanupErrors: unknown[] = [];
  const attachmentFiles = await prisma.receivableAttachment.findMany({ where: { ledgerId: { in: ids.ledgers } }, select: { fileId: true } }).catch((error) => { cleanupErrors.push(error); return []; });
  const fileIds = [...new Set([...ids.files, ...attachmentFiles.map(({ fileId }) => fileId)])];
  const actions = [
    () => prisma.auditLog.deleteMany({ where: { actorId: { in: ids.accounts } } }),
    () => prisma.receivableAttachment.deleteMany({ where: { ledgerId: { in: ids.ledgers } } }),
    () => prisma.privateFile.deleteMany({ where: { OR: [{ id: { in: fileIds } }, { uploadedBy: { in: ids.accounts } }] } }),
    () => prisma.receivableLedgerRevision.deleteMany({ where: { ledgerId: { in: ids.ledgers } } }),
    () => prisma.receivableLedger.deleteMany({ where: { id: { in: ids.ledgers } } }),
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
  for (const action of actions) { try { await action(); } catch (error) { cleanupErrors.push(error); } }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "receivables attachments cleanup failed");
}

async function assertClean() {
  const [people, accounts, departments, grants, ledgers, attachments, files, revisions, audits, sessions, setting] = await Promise.all([
    prisma.person.count({ where: { name: { startsWith: marker } } }), prisma.account.count({ where: { username: { startsWith: marker } } }), prisma.receivableDepartment.count({ where: { name: { startsWith: marker } } }), prisma.receivableAccessGrant.count({ where: { id: { in: ids.grants } } }), prisma.receivableLedger.count({ where: { id: { in: ids.ledgers } } }), prisma.receivableAttachment.count({ where: { ledgerId: { in: ids.ledgers } } }), prisma.privateFile.count({ where: { uploadedBy: { in: ids.accounts } } }), prisma.receivableLedgerRevision.count({ where: { ledgerId: { in: ids.ledgers } } }), prisma.auditLog.count({ where: { actorId: { in: ids.accounts } } }), prisma.refreshSession.count({ where: { clientKind: "rxa-files-smoke" } }), prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } }),
  ]);
  assert.deepEqual({ people, accounts, departments, grants, ledgers, attachments, files, revisions, audits, sessions }, { people: 0, accounts: 0, departments: 0, grants: 0, ledgers: 0, attachments: 0, files: 0, revisions: 0, audits: 0, sessions: 0 });
  assert.deepEqual(setting, settingExisted ? originalSetting : null, "receivables setting baseline was not restored");
  assert.deepEqual(await storedFiles(), [], "attachment physical files were not cleaned");
}

async function dbState(ledgerId: string) {
  const [ledger, attachments, files, revisions, audits, physicalFiles] = await Promise.all([
    prisma.receivableLedger.findUniqueOrThrow({ where: { id: ledgerId }, select: { revision: true } }),
    prisma.receivableAttachment.count({ where: { ledgerId } }),
    prisma.privateFile.count({ where: { uploadedBy: { in: ids.accounts } } }),
    prisma.receivableLedgerRevision.count({ where: { ledgerId } }),
    prisma.auditLog.count({ where: { actorId: { in: ids.accounts }, action: { startsWith: "receivables.attachment." } } }),
    storedFiles(),
  ]);
  return { revision: ledger.revision, attachments, files, revisions, audits, physicalFiles: physicalFiles.sort() };
}

async function unchanged(ledgerId: string, action: () => Promise<unknown>) {
  const before = await dbState(ledgerId); await action(); assert.deepEqual(await dbState(ledgerId), before, "failed attachment operation changed DB, audit, revision, or files");
}

try {
  checkWorkbookResourcePolicy();
  await checkBoundedEndOfCentralDirectory();
  if (process.platform === "win32") {
    const source = await readFile(resolve(root, "apps/api/src/receivables-files.ts"), "utf8");
    assert.match(source, /writeFile\(temporaryPath, content, \{ mode: 0o600 \}\)/, "atomic upload helper must request mode 0600");
  }
  const company = await prisma.organization.create({ data: { name: `${marker}-company`, type: "company" } }); ids.organizations.push(company.id);
  const financeOrg = await prisma.organization.create({ data: { name: `${marker}-finance`, type: "department", parentId: company.id } }); ids.organizations.push(financeOrg.id);
  const owner = await identity("owner", "org_leader", financeOrg.id); const admin = await identity("admin"); const reporter = await identity("reporter"); const sameReporter = await identity("same-reporter"); const readonly = await identity("readonly"); const viewAll = await identity("view-all"); const recovery = await identity("recovery", "company_admin"); const crossReporter = await identity("cross-reporter");
  const department = await prisma.receivableDepartment.create({ data: { name: `${marker}-department` } }); const otherDepartment = await prisma.receivableDepartment.create({ data: { name: `${marker}-other` } }); ids.departments.push(department.id, otherDepartment.id);
  originalSetting = await prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } }); settingExisted = originalSetting !== null;
  await prisma.receivableSetting.upsert({ where: { id: 1 }, create: { id: 1, financeOrganizationId: financeOrg.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.id }, update: { financeOrganizationId: financeOrg.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.id } });
  await grant(admin.id, owner.id, "admin"); await grant(reporter.id, owner.id, "reporter", department.id, false, true); await grant(sameReporter.id, owner.id, "reporter", department.id); await grant(readonly.id, owner.id, "readonly", department.id); await grant(viewAll.id, owner.id, "readonly", undefined, true); await grant(crossReporter.id, owner.id, "reporter", otherDepartment.id, false, true);
  const [ownerToken, adminToken, reporterToken, sameReporterToken, readonlyToken, viewAllToken, recoveryToken, crossReporterToken] = await Promise.all([token(owner.id), token(admin.id), token(reporter.id), token(sameReporter.id), token(readonly.id), token(viewAll.id), token(recovery.id), token(crossReporter.id)]);
  const ledger = await prisma.receivableLedger.create({ data: { financeDepartmentId: department.id, contractNo: `${marker}-contract`, contractNoNormalized: `${marker}-contract`, createdBy: owner.id } }); ids.ledgers.push(ledger.id);
  await start();
  const attachmentPath = `/api/receivables/ledgers/${ledger.id}/attachments`;
  const pdf: Fixture = { filename: "proof.pdf", mime: "application/pdf", content: Buffer.from("%PDF-1.4\nattachment") };
  const invalids: Array<[string, string, Fixture]> = [
    ["recovery", recoveryToken, pdf], ["readonly", readonlyToken, pdf],
    ["extension mismatch", ownerToken, { filename: "wrong.pdf", mime: "image/png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }],
    ["invalid PDF", ownerToken, { filename: "fake.pdf", mime: "application/pdf", content: Buffer.from("not a pdf") }],
    ["plain ZIP", ownerToken, { filename: "fake.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", content: await plainZip() }],
    ["compressed workbook bomb", ownerToken, { filename: "bomb.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", content: await bombXlsx() }],
  ];
  for (const [label, bearer, fixture] of invalids) await unchanged(ledger.id, () => expect(attachmentPath, bearer, label === "recovery" || label === "readonly" ? 404 : 400, { method: "POST", body: form(1, fixture) }));
  await unchanged(ledger.id, () => expect(attachmentPath, sameReporterToken, 404, { method: "POST", body: form(1, pdf) }));
  const malformedMultipart = { method: "POST", headers: { "content-type": "multipart/form-data; boundary=broken" }, body: "not-a-valid-boundary" };
  for (const bearer of [readonlyToken, recoveryToken, crossReporterToken]) await unchanged(ledger.id, () => expect(attachmentPath, bearer, 404, malformedMultipart));
  await unchanged(ledger.id, () => expect(attachmentPath, ownerToken, 413, { method: "POST", body: form(1, { filename: "large.pdf", mime: "application/pdf", content: Buffer.alloc(10 * 1024 * 1024 + 1) }) }));
  await unchanged(ledger.id, () => expect(attachmentPath, ownerToken, 409, { method: "POST", body: form(99, pdf) }));

  const fixtures: Fixture[] = [
    pdf,
    { filename: "proof.png", mime: "image/png", content: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") },
    { filename: "proof.jpg", mime: "image/jpeg", content: Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k=", "base64") },
    { filename: "proof.webp", mime: "image/webp", content: Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJQBOgCHwAP7+AAAAAA==", "base64") },
    { filename: "proof.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", content: await validXlsx() },
  ];
  const uploadTokens = [reporterToken, adminToken, ownerToken, reporterToken, adminToken];
  const uploaded: Attachment[] = [];
  let ledgerRevision = 1;
  const cleanupKey = `receivables/test/${randomUUID()}`; const cleanupPath = receivableAttachmentStoragePath(uploadRoot, cleanupKey); const cleanupTemp = `${cleanupPath}.uploading`;
  await mkdir(resolve(cleanupPath, ".."), { recursive: true }); await writeFile(cleanupPath, "final"); await writeFile(cleanupTemp, "temporary"); await removeReceivableAttachmentFiles(uploadRoot, cleanupKey, cleanupTemp);
  assert.equal((await storedFiles()).length, 0, "cleanup helper left final or temporary files");
  await assert.rejects(() => removeReceivableAttachmentFiles(uploadRoot, cleanupKey, resolve(uploadRoot, "..", "outside.uploading")), (error: Error & { code?: string }) => error.code === "FILE_PATH_INVALID");
  const failedCleanupKey = `receivables/test/${randomUUID()}`; const failedCleanupPath = receivableAttachmentStoragePath(uploadRoot, failedCleanupKey); await mkdir(failedCleanupPath, { recursive: true });
  await assert.rejects(() => removeReceivableAttachmentFiles(uploadRoot, failedCleanupKey), (error) => error instanceof AggregateError && error.errors.length > 0); await rm(failedCleanupPath, { recursive: true });
  for (let index = 0; index < fixtures.length; index += 1) {
    const result = await expect<Attachment>(attachmentPath, uploadTokens[index]!, 201, { method: "POST", body: form(ledgerRevision, fixtures[index]!) });
    const attachment = result.body!.data!; uploaded.push(attachment); ids.files.push(attachment.file.id); ledgerRevision += 1;
    assert.equal(attachment.file.size, fixtures[index]!.content.length); assert.equal(attachment.file.sha256, hash(fixtures[index]!.content), `${fixtures[index]!.filename} SHA-256`);
    const metadata = await stat(resolve(uploadRoot, attachment.file.storageKey)); assert.equal(metadata.size, fixtures[index]!.content.length);
    if (process.platform !== "win32") assert.equal(metadata.mode & 0o777, 0o600, `${fixtures[index]!.filename} mode`);
  }
  if (process.platform === "win32") console.log("RECEIVABLES_ATTACHMENT_MODE=NOT_PROVABLE_ON_WINDOWS");
  assert.equal((await storedFiles()).filter((path) => path.endsWith(".uploading")).length, 0, "temporary upload files remain");
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: ledger.id } })).revision, ledgerRevision);
  assert.equal(await prisma.receivableLedgerRevision.count({ where: { ledgerId: ledger.id } }), fixtures.length);
  assert.equal(await prisma.auditLog.count({ where: { action: "receivables.attachment.create", objectId: { in: uploaded.map(({ id }) => id) } } }), fixtures.length);
  const reporterCreateAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "receivables.attachment.create", objectId: uploaded[0]!.id } });
  const reporterCreateMetadata = reporterCreateAudit.metadata as Record<string, unknown> | null;
  assert.deepEqual({ actorRole: reporterCreateAudit.actorRole, actorScopeType: reporterCreateAudit.actorScopeType, actorScopeId: reporterCreateAudit.actorScopeId, reason: reporterCreateMetadata?.reason }, { actorRole: "reporter", actorScopeType: "receivable_department", actorScopeId: department.id, reason: "上传财务附件" });
  assert.ok(reporterCreateAudit.metadata && typeof reporterCreateAudit.metadata === "object" && !Array.isArray(reporterCreateAudit.metadata) && "before" in reporterCreateAudit.metadata && "after" in reporterCreateAudit.metadata, "create audit lacks before/after metadata");
  const orphans = await orphanPrivateFiles(prisma, new Date(Date.now() + 60_000));
  assert.equal(orphans.some(({ id }) => uploaded.some(({ file }) => file.id === id)), false, "retention treated a linked receivables file as orphaned");

  await prisma.receivableSetting.update({ where: { id: 1 }, data: { configurationConfirmedAt: null, configurationConfirmedBy: null } });
  await expect(`/api/files/${uploaded[0]!.file.id}`, ownerToken, 403);
  await prisma.receivableSetting.update({ where: { id: 1 }, data: { configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.id } });
  await expect(`/api/files/${uploaded[0]!.file.id}`, ownerToken, 200);
  await expect(`/api/files/${uploaded[0]!.file.id}`, reporterToken, 200);
  await expect(`/api/files/${uploaded[3]!.file.id}`, readonlyToken, 200);
  await expect(`/api/files/${uploaded[4]!.file.id}`, viewAllToken, 200);
  await expect(`/api/files/${uploaded[0]!.file.id}`, crossReporterToken, 403);
  await expect(`/api/files/${uploaded[0]!.file.id}`, recoveryToken, 403);
  for (let attempt = 0; attempt < 80 && await prisma.auditLog.count({ where: { action: "file.read", objectId: { in: uploaded.map(({ file }) => file.id) } } }) < 4; attempt += 1) await delay(25);
  assert.equal(await prisma.auditLog.count({ where: { action: "file.read", objectId: { in: uploaded.map(({ file }) => file.id) } } }), 4, "only successful active reads write file.read audits");
  await writeFile(resolve(uploadRoot, uploaded[3]!.file.storageKey), Buffer.alloc(uploaded[3]!.file.size, 0x78));
  await expect(`/api/files/${uploaded[3]!.file.id}`, readonlyToken, 409);
  await delay(50);
  assert.equal(await prisma.auditLog.count({ where: { action: "file.read", objectId: uploaded[3]!.file.id } }), 1, "tampered read wrote file.read audit");

  const voidPath = (attachment: Attachment) => `${attachmentPath}/${attachment.id}/void`;
  const voidBody = (reason: string, revision = 1) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ledgerRevision, revision, reason }) });
  await unchanged(ledger.id, () => expect(voidPath(uploaded[0]!), sameReporterToken, 404, voidBody("same department non-uploader")));
  const ownerVoided = (await expect<Attachment>(voidPath(uploaded[1]!), ownerToken, 200, voidBody("owner void"))).body!.data!; ledgerRevision += 1; assert.equal(ownerVoided.status, "voided");
  const ownerVoidAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "receivables.attachment.void", objectId: uploaded[1]!.id } });
  const ownerVoidMetadata = ownerVoidAudit.metadata as Record<string, unknown> | null;
  assert.deepEqual({ actorRole: ownerVoidAudit.actorRole, actorScopeType: ownerVoidAudit.actorScopeType, actorScopeId: ownerVoidAudit.actorScopeId, reason: ownerVoidMetadata?.reason }, { actorRole: "owner", actorScopeType: "receivables", actorScopeId: null, reason: "owner void" });
  assert.ok(ownerVoidAudit.metadata && typeof ownerVoidAudit.metadata === "object" && !Array.isArray(ownerVoidAudit.metadata) && "before" in ownerVoidAudit.metadata && "after" in ownerVoidAudit.metadata, "void audit lacks before/after metadata");
  const adminVoided = (await expect<Attachment>(voidPath(uploaded[2]!), adminToken, 200, voidBody("admin void"))).body!.data!; ledgerRevision += 1; assert.equal(adminVoided.status, "voided");
  const reporterVoided = (await expect<Attachment>(voidPath(uploaded[0]!), reporterToken, 200, voidBody("uploader void"))).body!.data!; ledgerRevision += 1; assert.equal(reporterVoided.status, "voided");
  await expect(`/api/files/${uploaded[0]!.file.id}`, reporterToken, 403); await expect(`/api/files/${uploaded[0]!.file.id}`, viewAllToken, 403); await expect(`/api/files/${uploaded[1]!.file.id}`, ownerToken, 200); await expect(`/api/files/${uploaded[2]!.file.id}`, adminToken, 200);
  await unchanged(ledger.id, () => expect(voidPath(uploaded[0]!), reporterToken, 409, voidBody("again", 2)));
  assert.equal(await prisma.auditLog.count({ where: { action: "receivables.attachment.void", objectId: { in: uploaded.map(({ id }) => id) } } }), 3);
  await prisma.receivableDepartment.update({ where: { id: department.id }, data: { active: false } });
  const inactiveHistoryUpload = (await expect<Attachment>(attachmentPath, reporterToken, 201, { method: "POST", body: form(ledgerRevision, fixtures[0]!) })).body!.data!;
  uploaded.push(inactiveHistoryUpload); ids.files.push(inactiveHistoryUpload.file.id); ledgerRevision += 1;
  await expect(`/api/files/${inactiveHistoryUpload.file.id}`, reporterToken, 200);
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors: unknown[] = [];
  for (const action of [stop, cleanup, assertClean, () => prisma.$disconnect()]) { try { await action(); } catch (error) { cleanupErrors.push(error); } }
  if (cleanupErrors.length) failure = new AggregateError(failure === undefined ? cleanupErrors : [failure, ...cleanupErrors], "receivables attachments smoke cleanup failed");
}

if (failure !== undefined) throw failure;
console.log("RECEIVABLES_ATTACHMENTS_SMOKE=PASS");
