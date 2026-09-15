import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
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
let settingCaptured = false;
let completed = false;

type Json<T = unknown> = { data?: T; error?: { code: string; message: string } };
type Ledger = { id: string; revision: number; status: "active" | "voided"; finalAmount: string | null; openingChargeDate: string | null; writeoffAmount: string; invoicedAmount: string; receivedAmount: string; balance: string | null; anomaly: string | null };
type Detail = { id: string; revision: number; status: "active" | "voided"; amount: string };
type AuditMetadata = { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; detailType?: string; detailId?: string; detail?: { before: Record<string, unknown> | null; after: Record<string, unknown> | null } };
const json = (value: unknown) => JSON.stringify(value);
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
const four = (value: unknown) => new Prisma.Decimal(String(value)).toFixed(4);

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
async function error(path: string, bearer: string, status: number, code: string, init: RequestInit = {}) {
  const body = await expect(path, bearer, status, init); assert.equal(body.error?.code, code, JSON.stringify(body)); return body.error!;
}
async function trackedFacts() {
  const prefixes = ids.ledgers.map((ledgerId) => ({ dedupeKey: { startsWith: `receivables-anomaly:${ledgerId}:` } }));
  const [ledgers, invoices, receipts, revisions, audits, notifications] = await Promise.all([
    prisma.receivableLedger.findMany({ where: { id: { in: ids.ledgers } }, select: { id: true, revision: true, openingChargeDate: true, writeoffAmount: true }, orderBy: { id: "asc" } }),
    prisma.receivableInvoice.findMany({ where: { ledgerId: { in: ids.ledgers } }, select: { id: true, ledgerId: true, revision: true, status: true, amount: true }, orderBy: { id: "asc" } }),
    prisma.receivableReceipt.findMany({ where: { ledgerId: { in: ids.ledgers } }, select: { id: true, ledgerId: true, revision: true, status: true, amount: true }, orderBy: { id: "asc" } }),
    prisma.receivableLedgerRevision.findMany({ where: { ledgerId: { in: ids.ledgers } }, select: { id: true, ledgerId: true, revision: true }, orderBy: { id: "asc" } }),
    prisma.auditLog.findMany({ where: { actorId: { in: ids.accounts }, action: { startsWith: "receivables.money." } }, select: { id: true, action: true, objectId: true }, orderBy: { id: "asc" } }),
    prefixes.length ? prisma.notification.findMany({ where: { OR: prefixes }, select: { id: true, personId: true, dedupeKey: true }, orderBy: { id: "asc" } }) : [],
  ]);
  return JSON.parse(JSON.stringify({ ledgers, invoices, receipts, revisions, audits, notifications }));
}
async function errorWithoutMutation(label: string, path: string, bearer: string, status: number, code: string, init: RequestInit = {}) {
  const before = await trackedFacts(); const result = await error(path, bearer, status, code, init);
  assert.deepEqual(await trackedFacts(), before, `${label} left money facts, parent revisions, audits, or notifications`); return result;
}
async function start() {
  const root = resolve(import.meta.dirname, "../../..");
  server = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "apps/api/src/server.ts"], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test", PORT: "55448", RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1", PUBLIC_BASE_URL: baseUrl, COOKIE_SECRET: "receivables-money-smoke-cookie-secret", JWT_SECRET: jwtSecret, FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 12).toString("base64"), UPLOAD_SIGNING_SECRET: "receivables-money-smoke-upload-secret" }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout?.on("data", (chunk) => { output += chunk.toString(); }); server.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  for (let i = 0; i < 100; i += 1) { if (server.exitCode !== null) throw new Error(output); try { if ((await fetch(`${baseUrl}/api/health`)).status === 200) return; } catch {} await delay(50); }
  throw new Error(`money smoke API unavailable: ${output}`);
}
async function stop() { if (server && server.exitCode === null) { server.kill(); await Promise.race([once(server, "exit"), delay(2_000)]); if (server.exitCode === null) server.kill("SIGKILL"); } }
async function cleanup() {
  const scopes = ids.ledgers.map((ledgerId) => ({ dedupeKey: { startsWith: `receivables-anomaly:${ledgerId}:` } })); if (scopes.length) await prisma.notification.deleteMany({ where: { OR: scopes } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids.accounts }, action: { startsWith: "receivables.money." } } });
  await prisma.receivableInvoice.deleteMany({ where: { ledgerId: { in: ids.ledgers } } }); await prisma.receivableReceipt.deleteMany({ where: { ledgerId: { in: ids.ledgers } } }); await prisma.receivableLedgerRevision.deleteMany({ where: { ledgerId: { in: ids.ledgers } } }); await prisma.receivableLedger.deleteMany({ where: { id: { in: ids.ledgers } } });
  await prisma.receivableGrantDepartment.deleteMany({ where: { grantId: { in: ids.grants } } }); await prisma.receivableAccessGrant.deleteMany({ where: { id: { in: ids.grants } } }); await prisma.receivableDepartment.deleteMany({ where: { id: { in: ids.departments } } });
  if (settingCaptured) { if (originalSetting) await prisma.receivableSetting.update({ where: { id: 1 }, data: originalSetting }); else await prisma.receivableSetting.deleteMany({ where: { id: 1 } }); }
  await prisma.refreshSession.deleteMany({ where: { id: { in: ids.sessions } } }); await prisma.roleAssignment.deleteMany({ where: { id: { in: ids.roleAssignments } } }); await prisma.account.deleteMany({ where: { id: { in: ids.accounts } } }); await prisma.person.deleteMany({ where: { id: { in: ids.people } } }); await prisma.organization.deleteMany({ where: { id: { in: ids.organizations } } });
}
async function assertClean() {
  const scopes = ids.ledgers.map((ledgerId) => ({ dedupeKey: { startsWith: `receivables-anomaly:${ledgerId}:` } }));
  const [organizations, people, accounts, departments, grants, ledgers, invoices, receipts, revisions, audits, notifications, sessions] = await Promise.all([
    prisma.organization.count({ where: { name: { startsWith: marker } } }), prisma.person.count({ where: { name: { startsWith: marker } } }), prisma.account.count({ where: { username: { startsWith: marker } } }), prisma.receivableDepartment.count({ where: { name: { startsWith: marker } } }), prisma.receivableAccessGrant.count({ where: { id: { in: ids.grants } } }), prisma.receivableLedger.count({ where: { id: { in: ids.ledgers } } }), prisma.receivableInvoice.count({ where: { ledgerId: { in: ids.ledgers } } }), prisma.receivableReceipt.count({ where: { ledgerId: { in: ids.ledgers } } }), prisma.receivableLedgerRevision.count({ where: { ledgerId: { in: ids.ledgers } } }), prisma.auditLog.count({ where: { actorId: { in: ids.accounts }, action: { startsWith: "receivables.money." } } }), scopes.length ? prisma.notification.count({ where: { OR: scopes } }) : 0, prisma.refreshSession.count({ where: { clientKind: "rxa-money-smoke" } }),
  ]);
  assert.deepEqual({ organizations, people, accounts, departments, grants, ledgers, invoices, receipts, revisions, audits, notifications, sessions }, { organizations: 0, people: 0, accounts: 0, departments: 0, grants: 0, ledgers: 0, invoices: 0, receipts: 0, revisions: 0, audits: 0, notifications: 0, sessions: 0 }, "money smoke cleanup left marker/Task 7 facts");
}

try {
  const company = await prisma.organization.create({ data: { name: `${marker}-company`, type: "company" } }); ids.organizations.push(company.id);
  const financeOrg = await prisma.organization.create({ data: { name: `${marker}-finance`, type: "department", parentId: company.id } }); ids.organizations.push(financeOrg.id);
  const owner = await identity("owner", "org_leader", financeOrg.id); const admin = await identity("admin"); const reporter = await identity("reporter"); const readonly = await identity("readonly"); const recoveryAdmin = await identity("recovery", "company_admin"); const inactiveAdmin = await identity("inactive-admin");
  const department = await prisma.receivableDepartment.create({ data: { name: `${marker}-department` } }); const other = await prisma.receivableDepartment.create({ data: { name: `${marker}-other` } }); ids.departments.push(department.id, other.id);
  originalSetting = await prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } }); settingCaptured = true;
  assert.deepEqual(originalSetting, { financeOrganizationId: null, configurationConfirmedAt: null, configurationConfirmedBy: null }, "money smoke must accept the baseline id=1 null setting row directly");
  await prisma.receivableSetting.update({ where: { id: 1 }, data: { financeOrganizationId: financeOrg.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.id } });
  await grant(admin.id, owner.id, "admin"); await grant(reporter.id, owner.id, "reporter", department.id); await grant(readonly.id, owner.id, "readonly", department.id); const inactiveGrant = await grant(inactiveAdmin.id, owner.id, "admin"); await prisma.receivableAccessGrant.update({ where: { id: inactiveGrant.id }, data: { active: false } });
  const [ownerToken, adminToken, reporterToken, readonlyToken, recoveryToken] = await Promise.all([token(owner.id), token(admin.id), token(reporter.id), token(readonly.id), token(recoveryAdmin.id)]);
  const ledger = await prisma.receivableLedger.create({ data: { financeDepartmentId: department.id, contractNo: `${marker}-contract`, contractNoNormalized: `${marker}-contract`, finalAmount: "100.0000", createdBy: owner.id } }); ids.ledgers.push(ledger.id);
  const otherLedger = await prisma.receivableLedger.create({ data: { financeDepartmentId: other.id, contractNo: `${marker}-other`, contractNoNormalized: `${marker}-other`, finalAmount: "100.0000", createdBy: owner.id } }); ids.ledgers.push(otherLedger.id);
  const foreignInvoice = await prisma.receivableInvoice.create({ data: { ledgerId: otherLedger.id, invoiceDate: new Date("2026-09-01T00:00:00.000Z"), amount: "5.0000", createdBy: owner.id } });
  const voidedLedger = await prisma.receivableLedger.create({ data: { financeDepartmentId: department.id, contractNo: `${marker}-voided`, contractNoNormalized: `${marker}-voided`, finalAmount: "100.0000", createdBy: owner.id, status: "voided", voidedAt: new Date(), voidedBy: owner.id, voidReason: "fixture" } }); ids.ledgers.push(voidedLedger.id);
  await start();
  const invoicePath = `/api/receivables/ledgers/${ledger.id}/invoices`;
  const postInvoice = (ledgerRevision: number, amount = "10.0000") => ({ method: "POST", body: json({ ledgerRevision, invoiceDate: "2026-09-15", amount }) });

  await errorWithoutMutation("missing ledgerRevision", invoicePath, ownerToken, 400, "VALIDATION_ERROR", { method: "POST", body: json({ invoiceDate: "2026-09-15", amount: "10.0000" }) });
  await errorWithoutMutation("reporter denial", invoicePath, reporterToken, 403, "RECEIVABLES_FORBIDDEN", postInvoice(1)); await errorWithoutMutation("readonly denial", invoicePath, readonlyToken, 403, "RECEIVABLES_FORBIDDEN", postInvoice(1)); await errorWithoutMutation("recovery-only admin denial", invoicePath, recoveryToken, 403, "RECEIVABLES_FORBIDDEN", postInvoice(1));
  await errorWithoutMutation("zero amount", invoicePath, ownerToken, 400, "RECEIVABLES_AMOUNT_INVALID", postInvoice(1, "0")); await errorWithoutMutation("negative amount", invoicePath, ownerToken, 400, "RECEIVABLES_AMOUNT_INVALID", postInvoice(1, "-1"));
  const hidden = await errorWithoutMutation("out-of-scope ledger", `/api/receivables/ledgers/${otherLedger.id}/invoices`, reporterToken, 403, "RECEIVABLES_FORBIDDEN", postInvoice(1)); const absent = await errorWithoutMutation("absent ledger", `/api/receivables/ledgers/${randomUUID()}/invoices`, reporterToken, 403, "RECEIVABLES_FORBIDDEN", postInvoice(1)); assert.deepEqual(hidden, absent, "out-of-scope and absent ledgers must be indistinguishable");
  await errorWithoutMutation("voided ledger", `/api/receivables/ledgers/${voidedLedger.id}/invoices`, ownerToken, 409, "RECEIVABLES_LEDGER_VOIDED", postInvoice(1));

  const invoice = (await expect<Detail>(invoicePath, ownerToken, 201, { method: "POST", body: json({ ledgerRevision: 1, invoiceDate: "2026-09-10", invoiceNo: "FP-1", amount: "80.0000", note: "first" }) })).data!; assert.equal(invoice.amount, "80.0000");
  const createAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "receivables.money.invoice.create", objectId: ledger.id }, orderBy: { createdAt: "desc" } }); const createMetadata = createAudit.metadata as AuditMetadata;
  assert.equal(createMetadata.detailType, "invoice"); assert.equal(createMetadata.detailId, invoice.id); assert.equal(createMetadata.detail?.before, null); assert.equal(createMetadata.detail?.after?.id, invoice.id);
  const firstParentRevision = await prisma.receivableLedgerRevision.findUniqueOrThrow({ where: { ledgerId_revision: { ledgerId: ledger.id, revision: 1 } } }); assert.equal((firstParentRevision.beforeSnapshot as { revision: number }).revision, 1, "parent revision beforeSnapshot must be retained");

  const invoice2 = (await expect<Detail>(invoicePath, adminToken, 201, { method: "POST", body: json({ ledgerRevision: 2, invoiceDate: "2026-09-15", amount: "20.0000" }) })).data!;
  let state = (await expect<{ ledger: Ledger }>(`/api/receivables/ledgers/${ledger.id}`, ownerToken, 200)).data!.ledger; assert.equal(state.finalAmount, "100.0000"); assert.equal(state.writeoffAmount, "0.0000"); assert.equal(state.invoicedAmount, "100.0000"); assert.equal(state.openingChargeDate?.slice(0, 10), "2026-09-15");
  await errorWithoutMutation("stale detail revision", `${invoicePath}/${invoice.id}`, ownerToken, 409, "REVISION_CONFLICT", { method: "PATCH", body: json({ ledgerRevision: 3, revision: invoice.revision + 1, reason: "old", amount: "70", invoiceDate: "2026-09-12" }) });
  const patchedInvoice = (await expect<Detail>(`${invoicePath}/${invoice.id}`, ownerToken, 200, { method: "PATCH", body: json({ ledgerRevision: 3, revision: invoice.revision, reason: "correct amount", amount: "70", invoiceDate: "2026-09-12" }) })).data!; assert.equal(patchedInvoice.amount, "70.0000"); assert.equal(patchedInvoice.revision, 2);
  const invoicePatchMetadata = (await prisma.auditLog.findFirstOrThrow({ where: { action: "receivables.money.invoice.patch", objectId: ledger.id }, orderBy: { createdAt: "desc" } })).metadata as AuditMetadata;
  assert.equal(invoicePatchMetadata.detailType, "invoice"); assert.equal(invoicePatchMetadata.detailId, invoice.id); assert.equal(four(invoicePatchMetadata.detail?.before?.amount), "80.0000"); assert.equal(four(invoicePatchMetadata.detail?.after?.amount), "70.0000");
  assert.equal(((await prisma.receivableLedgerRevision.findUniqueOrThrow({ where: { ledgerId_revision: { ledgerId: ledger.id, revision: 3 } } })).beforeSnapshot as { revision: number }).revision, 3);

  const receiptPath = `/api/receivables/ledgers/${ledger.id}/receipts`;
  await errorWithoutMutation("stale parent revision", receiptPath, ownerToken, 409, "REVISION_CONFLICT", { method: "POST", body: json({ ledgerRevision: 3, receiptDate: "2026-09-16", amount: "110.0000" }) });
  const receipt = (await expect<Detail>(receiptPath, ownerToken, 201, { method: "POST", body: json({ ledgerRevision: 4, receiptDate: "2026-09-16", amount: "110.0000", referenceNo: "HK-1" }) })).data!; assert.equal(receipt.amount, "110.0000");
  state = (await expect<{ ledger: Ledger }>(`/api/receivables/ledgers/${ledger.id}`, ownerToken, 200)).data!.ledger; assert.equal(state.receivedAmount, "110.0000"); assert.equal(state.balance, "-10.0000"); assert.equal(state.anomaly, "over_received");
  const expectedRecipients = [owner.personId!, admin.personId!].sort(); const anomalyPrefix = `receivables-anomaly:${ledger.id}:over_received:5`;
  const notifications = await prisma.notification.findMany({ where: { dedupeKey: { startsWith: `${anomalyPrefix}:` } }, orderBy: { personId: "asc" } }); assert.deepEqual(notifications.map((row) => row.personId), expectedRecipients); assert.deepEqual(notifications.map((row) => row.dedupeKey).sort(), expectedRecipients.map((personId) => `${anomalyPrefix}:${personId}`).sort()); assert.equal(notifications.length, 2); assert.ok(notifications.every((row) => row.personId !== recoveryAdmin.personId && row.personId !== inactiveAdmin.personId));

  await errorWithoutMutation("writeoff exceeds balance", `/api/receivables/ledgers/${ledger.id}/writeoff`, ownerToken, 409, "WRITEOFF_EXCEEDS_BALANCE", { method: "PATCH", body: json({ ledgerRevision: 5, reason: "cannot raise", writeoffAmount: "1" }) });
  const writeoff = (await expect<{ ledger: Ledger }>(`/api/receivables/ledgers/${ledger.id}/writeoff`, ownerToken, 200, { method: "PATCH", body: json({ ledgerRevision: 5, reason: "historic adjustment", writeoffAmount: "0" }) })).data!.ledger; assert.equal(writeoff.finalAmount, "100.0000"); assert.equal(writeoff.writeoffAmount, "0.0000");
  await errorWithoutMutation("foreign detail", `${invoicePath}/${foreignInvoice.id}`, ownerToken, 404, "RECEIVABLES_DETAIL_NOT_FOUND", { method: "PATCH", body: json({ ledgerRevision: 6, revision: 1, reason: "hidden", amount: "5", invoiceDate: "2026-09-01" }) }); await errorWithoutMutation("absent detail", `${invoicePath}/${randomUUID()}`, ownerToken, 404, "RECEIVABLES_DETAIL_NOT_FOUND", { method: "PATCH", body: json({ ledgerRevision: 6, revision: 1, reason: "absent", amount: "5", invoiceDate: "2026-09-01" }) });
  await errorWithoutMutation("stale void detail", `${invoicePath}/${invoice2.id}/void`, ownerToken, 409, "REVISION_CONFLICT", { method: "POST", body: json({ ledgerRevision: 6, revision: invoice2.revision + 1, reason: "old detail" }) });
  const voidedInvoice = (await expect<Detail>(`${invoicePath}/${invoice2.id}/void`, ownerToken, 200, { method: "POST", body: json({ ledgerRevision: 6, revision: invoice2.revision, reason: "duplicate invoice" }) })).data!; assert.equal(voidedInvoice.status, "voided");
  const invoiceVoidMetadata = (await prisma.auditLog.findFirstOrThrow({ where: { action: "receivables.money.invoice.void", objectId: ledger.id }, orderBy: { createdAt: "desc" } })).metadata as AuditMetadata;
  assert.equal(invoiceVoidMetadata.detailType, "invoice"); assert.equal(invoiceVoidMetadata.detailId, invoice2.id); assert.equal(invoiceVoidMetadata.detail?.before?.status, "active"); assert.equal(invoiceVoidMetadata.detail?.after?.status, "voided");
  assert.equal(((await prisma.receivableLedgerRevision.findUniqueOrThrow({ where: { ledgerId_revision: { ledgerId: ledger.id, revision: 6 } } })).beforeSnapshot as { revision: number }).revision, 6);
  await errorWithoutMutation("repeat invoice void", `${invoicePath}/${invoice2.id}/void`, ownerToken, 409, "RECEIVABLES_DETAIL_VOIDED", { method: "POST", body: json({ ledgerRevision: 7, revision: voidedInvoice.revision, reason: "again" }) });
  state = (await expect<{ ledger: Ledger }>(`/api/receivables/ledgers/${ledger.id}`, ownerToken, 200)).data!.ledger; assert.equal(state.invoicedAmount, "70.0000"); assert.equal(state.openingChargeDate?.slice(0, 10), "2026-09-12");

  const patchedReceipt = (await expect<Detail>(`${receiptPath}/${receipt.id}`, ownerToken, 200, { method: "PATCH", body: json({ ledgerRevision: 7, revision: receipt.revision, reason: "bank correction", amount: "105", receiptDate: "2026-09-17", referenceNo: "HK-2" }) })).data!; assert.equal(patchedReceipt.amount, "105.0000");
  const receiptPatchMetadata = (await prisma.auditLog.findFirstOrThrow({ where: { action: "receivables.money.receipt.patch", objectId: ledger.id }, orderBy: { createdAt: "desc" } })).metadata as AuditMetadata;
  assert.equal(receiptPatchMetadata.detailType, "receipt"); assert.equal(receiptPatchMetadata.detailId, receipt.id); assert.equal(four(receiptPatchMetadata.detail?.before?.amount), "110.0000"); assert.equal(four(receiptPatchMetadata.detail?.after?.amount), "105.0000");
  assert.equal(((await prisma.receivableLedgerRevision.findUniqueOrThrow({ where: { ledgerId_revision: { ledgerId: ledger.id, revision: 7 } } })).beforeSnapshot as { revision: number }).revision, 7);
  const voidedReceipt = (await expect<Detail>(`${receiptPath}/${receipt.id}/void`, ownerToken, 200, { method: "POST", body: json({ ledgerRevision: 8, revision: patchedReceipt.revision, reason: "wrong receipt" }) })).data!; assert.equal(voidedReceipt.status, "voided");
  const receiptVoidMetadata = (await prisma.auditLog.findFirstOrThrow({ where: { action: "receivables.money.receipt.void", objectId: ledger.id }, orderBy: { createdAt: "desc" } })).metadata as AuditMetadata;
  assert.equal(receiptVoidMetadata.detailType, "receipt"); assert.equal(receiptVoidMetadata.detailId, receipt.id); assert.equal(receiptVoidMetadata.detail?.before?.status, "active"); assert.equal(receiptVoidMetadata.detail?.after?.status, "voided");
  assert.equal(((await prisma.receivableLedgerRevision.findUniqueOrThrow({ where: { ledgerId_revision: { ledgerId: ledger.id, revision: 8 } } })).beforeSnapshot as { revision: number }).revision, 8);
  await errorWithoutMutation("repeat receipt void", `${receiptPath}/${receipt.id}/void`, ownerToken, 409, "RECEIVABLES_DETAIL_VOIDED", { method: "POST", body: json({ ledgerRevision: 9, revision: voidedReceipt.revision, reason: "again" }) });

  const historicLedger = await prisma.receivableLedger.create({ data: { financeDepartmentId: department.id, contractNo: `${marker}-historic`, contractNoNormalized: `${marker}-historic`, finalAmount: "40.0000", openingChargeDate: new Date("2025-01-02T00:00:00.000Z"), createdBy: owner.id } }); ids.ledgers.push(historicLedger.id);
  await expect(`/api/receivables/ledgers/${historicLedger.id}/receipts`, ownerToken, 201, { method: "POST", body: json({ ledgerRevision: 1, receiptDate: "2026-01-01", amount: "1" }) }); let historicState = (await expect<{ ledger: Ledger }>(`/api/receivables/ledgers/${historicLedger.id}`, ownerToken, 200)).data!.ledger; assert.equal(historicState.openingChargeDate?.slice(0, 10), "2025-01-02");
  const onlyInvoice = (await expect<Detail>(`/api/receivables/ledgers/${historicLedger.id}/invoices`, ownerToken, 201, { method: "POST", body: json({ ledgerRevision: 2, invoiceDate: "2026-01-03", amount: "4" }) })).data!;
  await expect(`/api/receivables/ledgers/${historicLedger.id}/invoices/${onlyInvoice.id}/void`, ownerToken, 200, { method: "POST", body: json({ ledgerRevision: 3, revision: onlyInvoice.revision, reason: "remove only active invoice" }) }); historicState = (await expect<{ ledger: Ledger }>(`/api/receivables/ledgers/${historicLedger.id}`, ownerToken, 200)).data!.ledger; assert.equal(historicState.openingChargeDate?.slice(0, 10), "2026-01-03", "voiding every active invoice must preserve the last historical opening charge date");

  const concurrentLedger = await prisma.receivableLedger.create({ data: { financeDepartmentId: department.id, contractNo: `${marker}-concurrent`, contractNoNormalized: `${marker}-concurrent`, finalAmount: "10.0000", createdBy: owner.id } }); ids.ledgers.push(concurrentLedger.id); const concurrentPath = `/api/receivables/ledgers/${concurrentLedger.id}/receipts`;
  const [concurrentA, concurrentB] = await Promise.all([request<Detail>(concurrentPath, ownerToken, { method: "POST", body: json({ ledgerRevision: 1, receiptDate: "2026-10-01", amount: "20", referenceNo: "race-a" }) }), request<Detail>(concurrentPath, ownerToken, { method: "POST", body: json({ ledgerRevision: 1, receiptDate: "2026-10-02", amount: "20", referenceNo: "race-b" }) })]);
  assert.deepEqual([concurrentA.response.status, concurrentB.response.status].sort(), [201, 409]); const loser = concurrentA.response.status === 409 ? concurrentA : concurrentB; assert.equal(loser.body.error?.code, "REVISION_CONFLICT");
  assert.equal(await prisma.receivableReceipt.count({ where: { ledgerId: concurrentLedger.id } }), 1); assert.equal((await prisma.receivableLedger.findUniqueOrThrow({ where: { id: concurrentLedger.id } })).revision, 2); assert.equal(await prisma.receivableLedgerRevision.count({ where: { ledgerId: concurrentLedger.id } }), 1); assert.equal(await prisma.auditLog.count({ where: { action: "receivables.money.receipt.create", objectId: concurrentLedger.id } }), 1);
  const concurrentPrefix = `receivables-anomaly:${concurrentLedger.id}:over_received:2`; const concurrentNotifications = await prisma.notification.findMany({ where: { dedupeKey: { startsWith: `${concurrentPrefix}:` } }, orderBy: { personId: "asc" } }); assert.deepEqual(concurrentNotifications.map((row) => row.personId), expectedRecipients); assert.deepEqual(concurrentNotifications.map((row) => row.dedupeKey).sort(), expectedRecipients.map((personId) => `${concurrentPrefix}:${personId}`).sort()); assert.equal(concurrentNotifications.length, 2);

  const writeoffLedger = await prisma.receivableLedger.create({ data: { financeDepartmentId: department.id, contractNo: `${marker}-writeoff`, contractNoNormalized: `${marker}-writeoff`, finalAmount: "100.0000", createdBy: owner.id } }); ids.ledgers.push(writeoffLedger.id);
  let writeoffState = (await expect<{ ledger: Ledger }>(`/api/receivables/ledgers/${writeoffLedger.id}`, ownerToken, 200)).data!.ledger; const adjusted = (await expect<{ ledger: Ledger }>(`/api/receivables/ledgers/${writeoffLedger.id}/writeoff`, ownerToken, 200, { method: "PATCH", body: json({ ledgerRevision: writeoffState.revision, reason: "approved adjustment", writeoffAmount: "50.0000" }) })).data!.ledger; assert.equal(adjusted.finalAmount, "100.0000"); assert.equal(adjusted.writeoffAmount, "50.0000");
  await expect(`/api/receivables/ledgers/${writeoffLedger.id}/receipts`, ownerToken, 201, { method: "POST", body: json({ ledgerRevision: 2, receiptDate: "2026-09-20", amount: "60.0000" }) }); writeoffState = (await expect<{ ledger: Ledger }>(`/api/receivables/ledgers/${writeoffLedger.id}`, ownerToken, 200)).data!.ledger; assert.equal(writeoffState.anomaly, "writeoff_adjustment_required"); assert.equal(writeoffState.balance, "-10.0000");

  const moneySource = await readFile(resolve(import.meta.dirname, "../src/receivables-money.ts"), "utf8"); assert.match(moneySource, /hasExactUniqueTarget\(error,[\s\S]*receivable_ledger_revisions_ledger_id_revision_key/); assert.match(moneySource, /throw unexpectedDatabaseConflict\(\)/, "unknown database errors must not be exposed as business conflicts");
  completed = true;
} finally {
  await stop(); await cleanup(); await assertClean(); const restored = await prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } }); assert.deepEqual(restored, { financeOrganizationId: null, configurationConfirmedAt: null, configurationConfirmedBy: null }, "baseline receivable setting was not restored"); await prisma.$disconnect();
}

if (completed) console.log("RECEIVABLES_MONEY_SMOKE=PASS");
