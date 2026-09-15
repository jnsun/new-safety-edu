import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

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
let server: ChildProcess | null = null; let output = ""; let phone = Math.floor(Math.random() * 900_000) + 100_000;
let originalSetting: { financeOrganizationId: string | null; configurationConfirmedAt: Date | null; configurationConfirmedBy: string | null } | null = null;
let completed = false;
type Json<T = unknown> = { data?: T; error?: { code: string; message: string } };
type Attachment = { id: string; revision: number; status: "active" | "voided"; file: { id: string; storageKey: string; size: number; sha256: string } };
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function auditCount(fileId: string) { for (let attempt = 0; attempt < 40; attempt += 1) { const count = await prisma.auditLog.count({ where: { action: "file.read", objectId: fileId } }); if (count >= 2) return count; await delay(25); } return prisma.auditLog.count({ where: { action: "file.read", objectId: fileId } }); }
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
async function grant(accountId: string, grantedBy: string, role: "admin" | "reporter" | "readonly", departmentId?: string, canViewAll = false) {
  const row = await prisma.receivableAccessGrant.create({ data: { accountId, grantedBy, role, canViewAll, departments: departmentId ? { create: { financeDepartmentId: departmentId, canRead: true, canWrite: role === "reporter" } } : undefined } }); ids.grants.push(row.id);
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
async function expect<T>(path: string, bearer: string, status: number, init: RequestInit = {}) { const result = await request<T>(path, bearer, init); assert.equal(result.response.status, status, `${init.method ?? "GET"} ${path}: ${JSON.stringify(result.body)}`); return result; }
function form(ledgerRevision: number, filename = "proof.pdf", mime = "application/pdf", content = Buffer.from("%PDF-1.4\nattachment")) { const body = new FormData(); body.set("ledgerRevision", String(ledgerRevision)); body.set("category", "proof"); body.set("file", new Blob([content], { type: mime }), filename); return body; }
async function start() {
  await rm(uploadRoot, { recursive: true, force: true }); await mkdir(uploadRoot, { recursive: true });
  server = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "apps/api/src/server.ts"], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test", PORT: "55448", RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1", PUBLIC_BASE_URL: baseUrl, COOKIE_SECRET: "receivables-attachments-smoke-cookie-secret", JWT_SECRET: jwtSecret, FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"), UPLOAD_SIGNING_SECRET: "receivables-attachments-smoke-upload-secret", UPLOAD_ROOT: uploadRoot }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout?.on("data", (chunk) => { output += chunk.toString(); }); server.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  for (let i = 0; i < 100; i += 1) { if (server.exitCode !== null) throw new Error(output); try { if ((await fetch(`${baseUrl}/api/health`)).status === 200) return; } catch {} await delay(50); }
  throw new Error(`attachments smoke API unavailable: ${output}`);
}
async function stop() { if (server && server.exitCode === null) { server.kill(); await Promise.race([once(server, "exit"), delay(2_000)]); if (server.exitCode === null) server.kill("SIGKILL"); } }
async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids.accounts }, action: { startsWith: "receivables.attachment." } }, { objectId: { in: ids.files }, action: "file.read" }] } });
  await prisma.receivableAttachment.deleteMany({ where: { ledgerId: { in: ids.ledgers } } }); await prisma.privateFile.deleteMany({ where: { id: { in: ids.files } } }); await prisma.receivableLedgerRevision.deleteMany({ where: { ledgerId: { in: ids.ledgers } } }); await prisma.receivableLedger.deleteMany({ where: { id: { in: ids.ledgers } } });
  await prisma.receivableGrantDepartment.deleteMany({ where: { grantId: { in: ids.grants } } }); await prisma.receivableAccessGrant.deleteMany({ where: { id: { in: ids.grants } } }); await prisma.receivableDepartment.deleteMany({ where: { id: { in: ids.departments } } });
  if (originalSetting) await prisma.receivableSetting.update({ where: { id: 1 }, data: originalSetting });
  await prisma.refreshSession.deleteMany({ where: { id: { in: ids.sessions } } }); await prisma.roleAssignment.deleteMany({ where: { id: { in: ids.roles } } }); await prisma.account.deleteMany({ where: { id: { in: ids.accounts } } }); await prisma.person.deleteMany({ where: { id: { in: ids.people } } }); await prisma.organization.deleteMany({ where: { id: { in: ids.organizations } } });
  await rm(uploadRoot, { recursive: true, force: true });
}
async function assertClean() {
  const [people, accounts, departments, grants, ledgers, attachments, files, revisions, audits, sessions] = await Promise.all([
    prisma.person.count({ where: { name: { startsWith: marker } } }), prisma.account.count({ where: { username: { startsWith: marker } } }), prisma.receivableDepartment.count({ where: { name: { startsWith: marker } } }), prisma.receivableAccessGrant.count({ where: { id: { in: ids.grants } } }), prisma.receivableLedger.count({ where: { id: { in: ids.ledgers } } }), prisma.receivableAttachment.count({ where: { ledgerId: { in: ids.ledgers } } }), prisma.privateFile.count({ where: { id: { in: ids.files } } }), prisma.receivableLedgerRevision.count({ where: { ledgerId: { in: ids.ledgers } } }), prisma.auditLog.count({ where: { actorId: { in: ids.accounts }, action: { startsWith: "receivables.attachment." } } }), prisma.refreshSession.count({ where: { clientKind: "rxa-files-smoke" } }),
  ]);
  assert.deepEqual({ people, accounts, departments, grants, ledgers, attachments, files, revisions, audits, sessions }, { people: 0, accounts: 0, departments: 0, grants: 0, ledgers: 0, attachments: 0, files: 0, revisions: 0, audits: 0, sessions: 0 });
  assert.equal((await storedFiles()).length, 0, "attachment physical files were not cleaned");
}

try {
  const company = await prisma.organization.create({ data: { name: `${marker}-company`, type: "company" } }); ids.organizations.push(company.id);
  const financeOrg = await prisma.organization.create({ data: { name: `${marker}-finance`, type: "department", parentId: company.id } }); ids.organizations.push(financeOrg.id);
  const owner = await identity("owner", "org_leader", financeOrg.id); const admin = await identity("admin"); const reporter = await identity("reporter"); const readonly = await identity("readonly"); const viewAll = await identity("view-all"); const recovery = await identity("recovery", "company_admin"); const otherReporter = await identity("other-reporter");
  const department = await prisma.receivableDepartment.create({ data: { name: `${marker}-department` } }); const otherDepartment = await prisma.receivableDepartment.create({ data: { name: `${marker}-other` } }); ids.departments.push(department.id, otherDepartment.id);
  originalSetting = await prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } }); assert.deepEqual(originalSetting, { financeOrganizationId: null, configurationConfirmedAt: null, configurationConfirmedBy: null }, "baseline setting id=1 must be a null row");
  await prisma.receivableSetting.update({ where: { id: 1 }, data: { financeOrganizationId: financeOrg.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.id } });
  await grant(admin.id, owner.id, "admin"); await grant(reporter.id, owner.id, "reporter", department.id); await grant(readonly.id, owner.id, "readonly", department.id); await grant(viewAll.id, owner.id, "readonly", undefined, true); await grant(otherReporter.id, owner.id, "reporter", otherDepartment.id);
  const [ownerToken, adminToken, reporterToken, readonlyToken, viewAllToken, recoveryToken, otherReporterToken] = await Promise.all([token(owner.id), token(admin.id), token(reporter.id), token(readonly.id), token(viewAll.id), token(recovery.id), token(otherReporter.id)]);
  const ledger = await prisma.receivableLedger.create({ data: { financeDepartmentId: department.id, contractNo: `${marker}-contract`, contractNoNormalized: `${marker}-contract`, createdBy: owner.id } }); ids.ledgers.push(ledger.id);
  await start(); const attachmentPath = `/api/receivables/ledgers/${ledger.id}/attachments`;
  await expect(attachmentPath, recoveryToken, 404, { method: "POST", body: form(1) }); assert.equal((await storedFiles()).length, 0, "denied upload left a physical orphan");
  await expect(attachmentPath, readonlyToken, 404, { method: "POST", body: form(1) }); await expect(attachmentPath, ownerToken, 400, { method: "POST", body: form(1, "wrong.exe") });
  await expect(attachmentPath, ownerToken, 400, { method: "POST", body: form(1, "fake.pdf", "application/pdf", Buffer.from("not a pdf")) });
  await expect(attachmentPath, ownerToken, 413, { method: "POST", body: form(1, "large.pdf", "application/pdf", Buffer.alloc(10 * 1024 * 1024 + 1)) });
  await expect(attachmentPath, ownerToken, 409, { method: "POST", body: form(99) }); assert.equal((await storedFiles()).length, 0, "database rollback left a physical orphan");
  const uploaded = (await expect<Attachment>(attachmentPath, reporterToken, 201, { method: "POST", body: form(1) })).body!.data!; ids.files.push(uploaded.file.id); assert.equal(uploaded.status, "active"); assert.equal(uploaded.file.size, Buffer.byteLength("%PDF-1.4\nattachment")); assert.match(uploaded.file.sha256, /^[a-f0-9]{64}$/); const mode = (await stat(resolve(uploadRoot, uploaded.file.storageKey))).mode & 0o777; if (process.platform !== "win32") assert.equal(mode, 0o600);
  assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: ledger.id } })).revision, 2); assert.equal(await prisma.receivableLedgerRevision.count({ where: { ledgerId: ledger.id } }), 1); assert.equal(await prisma.auditLog.count({ where: { action: "receivables.attachment.create", objectId: uploaded.id } }), 1);
  await expect(`/api/files/${uploaded.file.id}`, reporterToken, 200); await expect(`/api/files/${uploaded.file.id}`, otherReporterToken, 403); await expect(`/api/files/${uploaded.file.id}`, recoveryToken, 403); await expect(`/api/files/${uploaded.file.id}`, viewAllToken, 200); assert.equal(await auditCount(uploaded.file.id), 2, "only successful reads write file.read audits");
  const voidPath = `${attachmentPath}/${uploaded.id}/void`;
  await expect(voidPath, otherReporterToken, 404, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ledgerRevision: 2, revision: 1, reason: "hidden" }) });
  const voided = (await expect<Attachment>(voidPath, reporterToken, 200, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ledgerRevision: 2, revision: 1, reason: "replace" }) })).body!.data!; assert.equal(voided.status, "voided"); assert.equal(voided.revision, 2);
  await expect(`/api/files/${uploaded.file.id}`, reporterToken, 403); await expect(`/api/files/${uploaded.file.id}`, viewAllToken, 403); await expect(`/api/files/${uploaded.file.id}`, ownerToken, 200); await expect(`/api/files/${uploaded.file.id}`, adminToken, 200); await expect(voidPath, reporterToken, 409, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ledgerRevision: 3, revision: 2, reason: "again" }) });
  assert.equal(await prisma.auditLog.count({ where: { action: "receivables.attachment.void", objectId: uploaded.id } }), 1); assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: ledger.id } })).revision, 3);
  completed = true;
} finally {
  await stop(); await cleanup(); await assertClean(); await prisma.$disconnect();
}

if (completed) console.log("RECEIVABLES_ATTACHMENTS_SMOKE=PASS");
