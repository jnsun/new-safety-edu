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
assert.equal(apiUrl.hostname, "127.0.0.1");
assert.equal(apiUrl.port, "55448");

const prisma = new PrismaClient();
const marker = `rxa-money-${randomUUID()}`;
const jwtSecret = "receivables-money-smoke-jwt-secret";
const ids = { accounts: [] as string[], people: [] as string[], organizations: [] as string[], roleAssignments: [] as string[], sessions: [] as string[], departments: [] as string[], grants: [] as string[], ledgers: [] as string[] };
let server: ChildProcess | null = null;
let output = "";
let phone = Math.floor(Math.random() * 900_000) + 100_000;
let originalSetting: { financeOrganizationId: string | null; configurationConfirmedAt: Date | null; configurationConfirmedBy: string | null } | null = null;
let createdSetting = false;

type Json<T = unknown> = { data?: T; error?: { code: string; message: string } };
type Ledger = { id: string; revision: number; status: "active" | "voided"; openingChargeDate: string | null; writeoffAmount: string; invoicedAmount: string; receivedAmount: string; balance: string | null; anomaly: string | null };
type Detail = { id: string; revision: number; status: "active" | "voided"; amount: string };
const json = (value: unknown) => JSON.stringify(value);
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function identity(label: string, role?: "org_leader" | "company_admin", scopeId?: string) {
  const person = await prisma.person.create({ data: { name: `${marker}-${label}`, phone: `19${String(phone++).padStart(9, "0")}`, type: "employee", status: "active" } }); ids.people.push(person.id);
  const account = await prisma.account.create({ data: { username: `${marker}-${label}`, usernameNormalized: `${marker}-${label}`, status: "active", personId: person.id } }); ids.accounts.push(account.id);
  if (role) { const assignment = await prisma.roleAssignment.create({ data: { accountId: account.id, personId: person.id, role, scopeType: role === "company_admin" ? "company" : "organization", scopeId: scopeId ?? null } }); ids.roleAssignments.push(assignment.id); }
  return account;
}
async function grant(accountId: string, grantedBy: string, role: "admin" | "reporter" | "readonly", departmentId?: string) {
  const value = await prisma.receivableAccessGrant.create({ data: { accountId, grantedBy, role, departments: departmentId ? { create: { financeDepartmentId: departmentId, canRead: true, canWrite: role === "reporter" } } : undefined } }); ids.grants.push(value.id); return value;
}
async function token(accountId: string) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { sessionVersion: true } });
  const session = await prisma.refreshSession.create({ data: { accountId, tokenHash: `smoke-${randomUUID()}`, clientKind: "rxa-money-smoke", expiresAt: new Date(Date.now() + 3_600_000), absoluteExpiresAt: new Date(Date.now() + 3_600_000) } }); ids.sessions.push(session.id);
  return new SignJWT({ ver: account.sessionVersion, sid: session.id }).setProtectedHeader({ alg: "HS256" }).setSubject(accountId).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(jwtSecret));
}
async function request<T>(path: string, bearer: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { authorization: `Bearer ${bearer}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
  return { response, body: await response.json() as Json<T> };
}
async function expect<T>(path: string, bearer: string, status: number, init: RequestInit = {}) {
  const result = await request<T>(path, bearer, init); assert.equal(result.response.status, status, `${init.method ?? "GET"} ${path}: ${JSON.stringify(result.body)}`); return result.body;
}
async function error(path: string, bearer: string, status: number, code: string, init: RequestInit = {}) { const body = await expect(path, bearer, status, init); assert.equal(body.error?.code, code, JSON.stringify(body)); }
async function start() {
  const root = resolve(import.meta.dirname, "../../..");
  server = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "apps/api/src/server.ts"], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test", PORT: "55448", RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1", PUBLIC_BASE_URL: baseUrl, COOKIE_SECRET: "receivables-money-smoke-cookie-secret", JWT_SECRET: jwtSecret, FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 12).toString("base64"), UPLOAD_SIGNING_SECRET: "receivables-money-smoke-upload-secret" }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout?.on("data", (chunk) => { output += chunk.toString(); }); server.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  for (let i = 0; i < 100; i += 1) { if (server.exitCode !== null) throw new Error(output); try { if ((await fetch(`${baseUrl}/api/health`)).status === 200) return; } catch {} await delay(50); }
  throw new Error(`money smoke API unavailable: ${output}`);
}
async function stop() { if (server && server.exitCode === null) { server.kill(); await Promise.race([once(server, "exit"), delay(2_000)]); if (server.exitCode === null) server.kill("SIGKILL"); } }
async function cleanup() {
  await prisma.notification.deleteMany({ where: { dedupeKey: { startsWith: "receivables-anomaly:" } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.accounts }, action: { startsWith: "receivables.money." } } });
  await prisma.receivableInvoice.deleteMany({ where: { ledgerId: { in: ids.ledgers } } }); await prisma.receivableReceipt.deleteMany({ where: { ledgerId: { in: ids.ledgers } } }); await prisma.receivableLedgerRevision.deleteMany({ where: { ledgerId: { in: ids.ledgers } } }); await prisma.receivableLedger.deleteMany({ where: { id: { in: ids.ledgers } } });
  await prisma.receivableGrantDepartment.deleteMany({ where: { grantId: { in: ids.grants } } }); await prisma.receivableAccessGrant.deleteMany({ where: { id: { in: ids.grants } } }); await prisma.receivableDepartment.deleteMany({ where: { id: { in: ids.departments } } }); if (originalSetting) await prisma.receivableSetting.update({ where: { id: 1 }, data: originalSetting }); else if (createdSetting) await prisma.receivableSetting.delete({ where: { id: 1 } }); await prisma.refreshSession.deleteMany({ where: { id: { in: ids.sessions } } }); await prisma.roleAssignment.deleteMany({ where: { id: { in: ids.roleAssignments } } }); await prisma.account.deleteMany({ where: { id: { in: ids.accounts } } }); await prisma.person.deleteMany({ where: { id: { in: ids.people } } }); await prisma.organization.deleteMany({ where: { id: { in: ids.organizations } } });
}

try {
  const company = await prisma.organization.create({ data: { name: `${marker}-company`, type: "company" } }); ids.organizations.push(company.id);
  const financeOrg = await prisma.organization.create({ data: { name: `${marker}-finance`, type: "department", parentId: company.id } }); ids.organizations.push(financeOrg.id);
  const owner = await identity("owner", "org_leader", financeOrg.id); const admin = await identity("admin"); const reporter = await identity("reporter"); const readonly = await identity("readonly"); const recoveryAdmin = await identity("recovery", "company_admin");
  const department = await prisma.receivableDepartment.create({ data: { name: `${marker}-department` } }); const other = await prisma.receivableDepartment.create({ data: { name: `${marker}-other` } }); ids.departments.push(department.id, other.id);
  originalSetting = await prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } });
  if (originalSetting) await prisma.receivableSetting.update({ where: { id: 1 }, data: { financeOrganizationId: financeOrg.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.id } });
  else { createdSetting = true; await prisma.receivableSetting.create({ data: { id: 1, financeOrganizationId: financeOrg.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.id } }); }
  await grant(admin.id, owner.id, "admin"); await grant(reporter.id, owner.id, "reporter", department.id); await grant(readonly.id, owner.id, "readonly", department.id);
  const [ownerToken, adminToken, reporterToken, readonlyToken, recoveryToken] = await Promise.all([token(owner.id), token(admin.id), token(reporter.id), token(readonly.id), token(recoveryAdmin.id)]);
  const ledger = await prisma.receivableLedger.create({ data: { financeDepartmentId: department.id, contractNo: `${marker}-contract`, contractNoNormalized: `${marker}-contract`, finalAmount: "100.0000", createdBy: owner.id } }); ids.ledgers.push(ledger.id);
  const voidedLedger = await prisma.receivableLedger.create({ data: { financeDepartmentId: department.id, contractNo: `${marker}-voided`, contractNoNormalized: `${marker}-voided`, finalAmount: "100.0000", createdBy: owner.id, status: "voided", voidedAt: new Date(), voidedBy: owner.id, voidReason: "fixture" } }); ids.ledgers.push(voidedLedger.id);
  await start();
  const invoicePath = `/api/receivables/ledgers/${ledger.id}/invoices`;
  // The assertions below exercise the installed money adapter against a real isolated PostgreSQL database.
  await error(invoicePath, reporterToken, 403, "RECEIVABLES_FORBIDDEN", { method: "POST", body: json({ invoiceDate: "2026-09-15", amount: "10.0000" }) });
  await error(invoicePath, readonlyToken, 403, "RECEIVABLES_FORBIDDEN", { method: "POST", body: json({ invoiceDate: "2026-09-15", amount: "10.0000" }) });
  await error(invoicePath, recoveryToken, 403, "RECEIVABLES_FORBIDDEN", { method: "POST", body: json({ invoiceDate: "2026-09-15", amount: "10.0000" }) });
  await error(invoicePath, ownerToken, 400, "RECEIVABLES_AMOUNT_INVALID", { method: "POST", body: json({ invoiceDate: "2026-09-15", amount: "0" }) });
  await error(invoicePath, ownerToken, 400, "RECEIVABLES_AMOUNT_INVALID", { method: "POST", body: json({ invoiceDate: "2026-09-15", amount: "-1" }) });
  await error(`/api/receivables/ledgers/${voidedLedger.id}/invoices`, ownerToken, 409, "RECEIVABLES_LEDGER_VOIDED", { method: "POST", body: json({ invoiceDate: "2026-09-15", amount: "10" }) });
  const invoice = (await expect<Detail>(invoicePath, ownerToken, 201, { method: "POST", body: json({ invoiceDate: "2026-09-10", invoiceNo: "FP-1", amount: "80.0000", note: "first" }) })).data!;
  const invoice2 = (await expect<Detail>(invoicePath, adminToken, 201, { method: "POST", body: json({ invoiceDate: "2026-09-15", amount: "20.0000" }) })).data!;
  let detail = (await expect<{ ledger: Ledger }>(`/api/receivables/ledgers/${ledger.id}`, ownerToken, 200)).data!; assert.equal(detail.ledger.invoicedAmount, "100.0000"); assert.equal(detail.ledger.openingChargeDate?.slice(0, 10), "2026-09-15");
  await error(`${invoicePath}/${invoice.id}`, ownerToken, 409, "REVISION_CONFLICT", { method: "PATCH", body: json({ revision: invoice.revision + 1, reason: "old", amount: "70", invoiceDate: "2026-09-10" }) });
  const receiptPath = `/api/receivables/ledgers/${ledger.id}/receipts`;
  const receipt = (await expect<Detail>(receiptPath, ownerToken, 201, { method: "POST", body: json({ receiptDate: "2026-09-16", amount: "110.0000", referenceNo: "HK-1" }) })).data!;
  detail = (await expect<{ ledger: Ledger }>(`/api/receivables/ledgers/${ledger.id}`, ownerToken, 200)).data!; assert.equal(detail.ledger.receivedAmount, "110.0000"); assert.equal(detail.ledger.balance, "-10.0000"); assert.equal(detail.ledger.anomaly, "over_received");
  await error(`/api/receivables/ledgers/${ledger.id}/writeoff`, ownerToken, 409, "WRITEOFF_EXCEEDS_BALANCE", { method: "PATCH", body: json({ revision: detail.ledger.revision, reason: "cannot raise", writeoffAmount: "1" }) });
  await expect(`/api/receivables/ledgers/${ledger.id}/writeoff`, ownerToken, 200, { method: "PATCH", body: json({ revision: detail.ledger.revision, reason: "historic adjustment", writeoffAmount: "0" }) });
  await error(`${invoicePath}/${invoice2.id}/void`, ownerToken, 409, "REVISION_CONFLICT", { method: "POST", body: json({ revision: invoice2.revision + 1, reason: "old detail" }) });
  const afterInvoiceVoid = (await expect<Detail>(`${invoicePath}/${invoice2.id}/void`, ownerToken, 200, { method: "POST", body: json({ revision: invoice2.revision, reason: "duplicate invoice" }) })).data!; assert.equal(afterInvoiceVoid.status, "voided");
  detail = (await expect<{ ledger: Ledger }>(`/api/receivables/ledgers/${ledger.id}`, ownerToken, 200)).data!; assert.equal(detail.ledger.invoicedAmount, "80.0000"); assert.equal(detail.ledger.openingChargeDate?.slice(0, 10), "2026-09-10");
  const notifications = await prisma.notification.findMany({ where: { dedupeKey: { startsWith: `receivables-anomaly:${ledger.id}:over_received:` } } }); assert.ok(notifications.some((row) => row.personId === owner.personId)); assert.ok(notifications.some((row) => row.personId === admin.personId)); assert.ok(notifications.every((row) => row.personId !== recoveryAdmin.personId), "pure recovery company admin must not receive finance anomaly notification");
  const writeoffLedger = await prisma.receivableLedger.create({ data: { financeDepartmentId: department.id, contractNo: `${marker}-writeoff`, contractNoNormalized: `${marker}-writeoff`, finalAmount: "100.0000", createdBy: owner.id } }); ids.ledgers.push(writeoffLedger.id);
  let writeoffState = (await expect<{ ledger: Ledger }>(`/api/receivables/ledgers/${writeoffLedger.id}`, ownerToken, 200)).data!.ledger;
  await expect(`/api/receivables/ledgers/${writeoffLedger.id}/writeoff`, ownerToken, 200, { method: "PATCH", body: json({ revision: writeoffState.revision, reason: "approved adjustment", writeoffAmount: "50.0000" }) });
  writeoffState = (await expect<{ ledger: Ledger }>(`/api/receivables/ledgers/${writeoffLedger.id}`, ownerToken, 200)).data!.ledger; assert.equal(writeoffState.writeoffAmount, "50.0000");
  await expect(`/api/receivables/ledgers/${writeoffLedger.id}/receipts`, ownerToken, 201, { method: "POST", body: json({ receiptDate: "2026-09-20", amount: "60.0000" }) });
  writeoffState = (await expect<{ ledger: Ledger }>(`/api/receivables/ledgers/${writeoffLedger.id}`, ownerToken, 200)).data!.ledger; assert.equal(writeoffState.anomaly, "writeoff_adjustment_required"); assert.equal(writeoffState.balance, "-10.0000");
  assert.ok(receipt.id);
  console.log("RECEIVABLES_MONEY_SMOKE=PASS");
} finally { await stop(); await cleanup(); await prisma.$disconnect(); }
