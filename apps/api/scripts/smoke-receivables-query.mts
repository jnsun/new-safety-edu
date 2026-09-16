import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const expectedDatabaseUrl = "postgresql://postgres@127.0.0.1:55432/receivables_test";
const databaseUrl = process.env.DATABASE_URL ?? "";
assert.equal(databaseUrl, expectedDatabaseUrl, `Refusing to run outside ${expectedDatabaseUrl}`);
const baseUrl = process.env.RECEIVABLES_API_BASE_URL ?? "http://127.0.0.1:55448";
const apiUrl = new URL(baseUrl);
assert.equal(apiUrl.hostname, "127.0.0.1", "Receivables query smoke API must bind to 127.0.0.1");
assert.equal(apiUrl.port, "55448", "Receivables query smoke API must use port 55448");

const prisma = new PrismaClient();
const marker = `rxa-query-${randomUUID()}`;
const jwtSecret = "receivables-query-smoke-jwt-secret";
const ids = {
  accounts: [] as string[], people: [] as string[], organizations: [] as string[], roleAssignments: [] as string[],
  sessions: [] as string[], departments: [] as string[], grants: [] as string[], ledgers: [] as string[],
  invoices: [] as string[], receipts: [] as string[], attachments: [] as string[], files: [] as string[], revisions: [] as string[], dictionaries: [] as string[],
};
let server: ChildProcess | null = null;
let serverOutput = "";
let phoneCounter = 1;
const originalSetting = await prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } });

type JsonResponse<T = unknown> = { data?: T; error?: { code: string; message: string } };
type Amounts = {
  activeLedgerCount: number; finalAmount: string | null; invoicedAmount: string; receivedAmount: string;
  internalReceivable: string; externalReceivable: string | null; balance: string | null; writeoffAmount: string;
  finalAmountMissingCount: number; overReceivedCount: number; writeoffAdjustmentRequiredCount: number;
};
type Row = { id: string; financeDepartmentId: string; contractNo: string; status: "active" | "voided"; debtStatus: string | null; finalAmount: string | null; invoicedAmount: string; receivedAmount: string; balance: string | null; anomaly: string | null };
type Facet = { value: string | null; count: number };
type ListResponse = { rows: Row[]; page: number; pageSize: number; total: number; facets: { departments: Array<Facet & { name: string }>; debtStatuses: Facet[]; creditorUnits: Facet[]; statuses: Facet[]; anomalies: Facet[] }; totals: Amounts };
type DashboardResponse = { amounts: Amounts; statuses: Facet[]; anomalies: Facet[] };
type ColumnPreference = { order: string[]; visible: string[]; frozen: string[] };
type DetailResponse = {
  ledger: Row & { writeoffAmount: string };
  invoices: Array<{ id: string; status: "active" | "voided"; amount: string }>;
  receipts: Array<{ id: string; status: "active" | "voided"; amount: string }>;
  attachments: Array<{ id: string; status: "active" | "voided"; capabilities: { canDownload: boolean; canVoid: boolean }; file: { id: string; originalName: string } }>;
  revisions: Array<{ id: string; reason: string }>;
  capabilities: { role: string | null; canViewAll: boolean; canWriteLedger: boolean; canManageMoney: boolean; readDepartmentIds: string[]; writeDepartmentIds: string[] };
};
type ReferenceDataResponse = {
  departments: Array<{ id: string; name: string; canRead: boolean; canWrite: boolean }>;
  dictionaries: Record<string, Array<{ id: string; value: string }>>;
};
const referenceCategories = ["project_status", "final_method", "debt_status", "client_attr", "unit", "work_nature", "sector", "comm_method", "feedback", "progress_note", "next_plan", "attach_category"];

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const fixed = (value: Prisma.Decimal | null) => value === null ? null : value.toFixed(4);

async function createIdentity(label: string, role?: "org_leader" | "company_admin", scopeId?: string) {
  const person = await prisma.person.create({ data: { name: `${marker}-${label}`, phone: `1950000${String(phoneCounter++).padStart(4, "0")}`, type: "employee", status: "active" } });
  ids.people.push(person.id);
  const account = await prisma.account.create({ data: { username: `${marker}-${label}`, usernameNormalized: `${marker}-${label}`, status: "active", personId: person.id } });
  ids.accounts.push(account.id);
  if (role) {
    const assignment = await prisma.roleAssignment.create({ data: { accountId: account.id, personId: person.id, role, scopeType: role === "company_admin" ? "company" : "organization", scopeId: scopeId ?? null } });
    ids.roleAssignments.push(assignment.id);
  }
  return account;
}

async function createGrant(input: { accountId: string; grantedBy: string; role: "admin" | "reporter" | "readonly"; canViewAll?: boolean; departmentIds?: string[] }) {
  const grant = await prisma.receivableAccessGrant.create({
    data: {
      accountId: input.accountId, grantedBy: input.grantedBy, role: input.role, canViewAll: input.canViewAll ?? false,
      departments: { create: (input.departmentIds ?? []).map((financeDepartmentId) => ({ financeDepartmentId, canRead: true, canWrite: input.role === "reporter" })) },
    },
  });
  ids.grants.push(grant.id);
  return grant;
}

async function createLedger(input: { departmentId: string; createdBy: string; label: string; finalAmount: string | null; writeoffAmount?: string; debtStatus: string; status?: "active" | "voided" }) {
  const contractNo = `${marker}-${input.label}`;
  const ledger = await prisma.receivableLedger.create({
    data: {
      financeDepartmentId: input.departmentId, contractNo, contractNoNormalized: contractNo, projectName: `${input.label}-project`,
      customerName: `${input.label}-customer`, creditorUnit: input.label.includes("stable") ? "unit-stable" : "unit-review",
      debtStatus: input.debtStatus, finalAmount: input.finalAmount, writeoffAmount: input.writeoffAmount ?? "0", status: input.status ?? "active", createdBy: input.createdBy,
      ...(input.status === "voided" ? { voidedAt: new Date(), voidedBy: input.createdBy, voidReason: "fixture void" } : {}),
    },
  });
  ids.ledgers.push(ledger.id);
  return ledger;
}

async function addInvoice(ledgerId: string, amount: string, createdBy: string, status: "active" | "voided" = "active") {
  const row = await prisma.receivableInvoice.create({ data: { ledgerId, invoiceDate: new Date("2026-01-02T00:00:00Z"), amount, createdBy, status, ...(status === "voided" ? { voidedAt: new Date(), voidedBy: createdBy, voidReason: "fixture void" } : {}) } });
  ids.invoices.push(row.id);
  return row;
}

async function addReceipt(ledgerId: string, amount: string, createdBy: string, status: "active" | "voided" = "active") {
  const row = await prisma.receivableReceipt.create({ data: { ledgerId, receiptDate: new Date("2026-02-03T00:00:00Z"), amount, createdBy, status, ...(status === "voided" ? { voidedAt: new Date(), voidedBy: createdBy, voidReason: "fixture void" } : {}) } });
  ids.receipts.push(row.id);
  return row;
}

async function addAttachment(ledgerId: string, uploadedBy: string, label: string, status: "active" | "voided") {
  const file = await prisma.privateFile.create({ data: { kind: "attachment", storageKey: `${marker}/${label}`, originalName: `${label}.pdf`, mimeType: "application/pdf", size: 10, sha256: "a".repeat(64), uploadedBy } });
  ids.files.push(file.id);
  const attachment = await prisma.receivableAttachment.create({ data: { ledgerId, fileId: file.id, category: "contract", uploadedBy, status, ...(status === "voided" ? { voidedAt: new Date(), voidedBy: uploadedBy, voidReason: "fixture void" } : {}) } });
  ids.attachments.push(attachment.id);
  return attachment;
}

async function bearer(accountId: string) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { sessionVersion: true } });
  const session = await prisma.refreshSession.create({ data: { accountId, tokenHash: `smoke-${randomUUID()}`, clientKind: "rxa-query-smoke", expiresAt: new Date(Date.now() + 3_600_000), absoluteExpiresAt: new Date(Date.now() + 3_600_000) } });
  ids.sessions.push(session.id);
  return new SignJWT({ ver: account.sessionVersion, sid: session.id }).setProtectedHeader({ alg: "HS256" }).setSubject(accountId).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(jwtSecret));
}

async function request<T>(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  return { response, body: await response.json() as JsonResponse<T> };
}

async function expectStatus<T>(path: string, token: string, status: number) {
  const result = await request<T>(path, token);
  assert.equal(result.response.status, status, `GET ${path}: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function startServer() {
  const root = resolve(import.meta.dirname, "../../..");
  server = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "apps/api/src/server.ts"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test", PORT: "55448", RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1", PUBLIC_BASE_URL: baseUrl, COOKIE_SECRET: "receivables-query-smoke-cookie-secret", JWT_SECRET: jwtSecret, FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"), UPLOAD_SIGNING_SECRET: "receivables-query-smoke-upload-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr?.on("data", (chunk) => { serverOutput += String(chunk); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Receivables API exited before readiness:\n${serverOutput}`);
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
  await prisma.userPreference.deleteMany({ where: { accountId: { in: ids.accounts } } });
  await prisma.receivableAttachment.deleteMany({ where: { id: { in: ids.attachments } } });
  await prisma.privateFile.deleteMany({ where: { id: { in: ids.files } } });
  await prisma.receivableInvoice.deleteMany({ where: { id: { in: ids.invoices } } });
  await prisma.receivableReceipt.deleteMany({ where: { id: { in: ids.receipts } } });
  await prisma.receivableLedgerRevision.deleteMany({ where: { id: { in: ids.revisions } } });
  await prisma.receivableLedger.deleteMany({ where: { id: { in: ids.ledgers } } });
  if (originalSetting) await prisma.receivableSetting.upsert({ where: { id: 1 }, create: { id: 1, ...originalSetting }, update: originalSetting });
  else await prisma.receivableSetting.deleteMany({ where: { id: 1, financeOrganizationId: { in: ids.organizations } } });
  await prisma.receivableGrantDepartment.deleteMany({ where: { grantId: { in: ids.grants } } });
  await prisma.receivableAccessGrant.deleteMany({ where: { id: { in: ids.grants } } });
  await prisma.receivableDictionaryOption.deleteMany({ where: { id: { in: ids.dictionaries } } });
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
  const reporterViewAll = await createIdentity("reporter-view-all");
  const reporterB = await createIdentity("reporter-b");
  const readonlyScoped = await createIdentity("readonly-scoped");
  const readonlyAll = await createIdentity("readonly-all");
  const companyAdmin = await createIdentity("company-admin", "company_admin");
  await prisma.receivableSetting.upsert({ where: { id: 1 }, create: { id: 1, financeOrganizationId: financeOrganization.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.id }, update: { financeOrganizationId: financeOrganization.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: owner.id } });

  const departmentA = await prisma.receivableDepartment.create({ data: { name: `${marker}-department-a` } }); ids.departments.push(departmentA.id);
  const departmentB = await prisma.receivableDepartment.create({ data: { name: `${marker}-department-b` } }); ids.departments.push(departmentB.id);
  const inactiveDepartment = await prisma.receivableDepartment.create({ data: { name: `${marker}-department-inactive`, active: false } }); ids.departments.push(inactiveDepartment.id);
  for (const category of referenceCategories) {
    const option = await prisma.receivableDictionaryOption.create({ data: { category, value: `${marker}-${category}` } });
    ids.dictionaries.push(option.id);
  }
  const inactiveOption = await prisma.receivableDictionaryOption.create({ data: { category: "project_status", value: `${marker}-inactive-option`, active: false } }); ids.dictionaries.push(inactiveOption.id);
  await createGrant({ accountId: admin.id, grantedBy: owner.id, role: "admin" });
  await createGrant({ accountId: reporterA.id, grantedBy: owner.id, role: "reporter", departmentIds: [departmentA.id, inactiveDepartment.id] });
  await createGrant({ accountId: reporterViewAll.id, grantedBy: owner.id, role: "reporter", canViewAll: true, departmentIds: [departmentA.id] });
  const reporterBGrant = await createGrant({ accountId: reporterB.id, grantedBy: owner.id, role: "reporter", departmentIds: [departmentB.id] });
  await createGrant({ accountId: readonlyScoped.id, grantedBy: owner.id, role: "readonly", departmentIds: [departmentA.id, inactiveDepartment.id] });
  await createGrant({ accountId: readonlyAll.id, grantedBy: owner.id, role: "readonly", canViewAll: true });

  const pending = await createLedger({ departmentId: departmentA.id, createdBy: owner.id, label: "pending-final", finalAmount: null, debtStatus: "review" });
  const settled = await createLedger({ departmentId: departmentA.id, createdBy: owner.id, label: "settled", finalAmount: "100", debtStatus: "normal" });
  const over = await createLedger({ departmentId: departmentA.id, createdBy: owner.id, label: "over-received", finalAmount: "100", debtStatus: "review" });
  const writeoff = await createLedger({ departmentId: departmentA.id, createdBy: owner.id, label: "writeoff-adjustment", finalAmount: "100", writeoffAmount: "10", debtStatus: "review" });
  const stableA = await createLedger({ departmentId: departmentA.id, createdBy: owner.id, label: "stable-a", finalAmount: "50", debtStatus: "stable" });
  const stableB = await createLedger({ departmentId: departmentA.id, createdBy: owner.id, label: "stable-b", finalAmount: "50", debtStatus: "stable" });
  const voided = await createLedger({ departmentId: departmentA.id, createdBy: owner.id, label: "voided", finalAmount: "999", debtStatus: "review", status: "voided" });
  const otherDepartment = await createLedger({ departmentId: departmentB.id, createdBy: owner.id, label: "other-department", finalAmount: "200", debtStatus: "other" });
  const inactiveDepartmentLedger = await createLedger({ departmentId: inactiveDepartment.id, createdBy: owner.id, label: "inactive-department", finalAmount: "300", debtStatus: "inactive" });

  await addInvoice(pending.id, "80", owner.id); await addInvoice(pending.id, "999", owner.id, "voided"); await addReceipt(pending.id, "30", owner.id); await addReceipt(pending.id, "777", owner.id, "voided");
  await addReceipt(settled.id, "100", owner.id);
  await addInvoice(over.id, "80", owner.id); await addReceipt(over.id, "120", owner.id); await addReceipt(over.id, "888", owner.id, "voided");
  await addReceipt(writeoff.id, "95", owner.id);
  await addInvoice(voided.id, "999", owner.id); await addReceipt(voided.id, "1200", owner.id);
  await addInvoice(otherDepartment.id, "150", owner.id); await addReceipt(otherDepartment.id, "50", owner.id);
  await addAttachment(pending.id, owner.id, "active-attachment", "active"); await addAttachment(pending.id, owner.id, "voided-attachment", "voided");
  await addAttachment(otherDepartment.id, reporterViewAll.id, "view-all-cross-department", "active");
  const revision = await prisma.receivableLedgerRevision.create({ data: { ledgerId: pending.id, revision: 1, beforeSnapshot: {}, reason: "fixture correction", changedBy: owner.id } }); ids.revisions.push(revision.id);

  const tokens = Object.fromEntries(await Promise.all(Object.entries({ owner, admin, reporterA, reporterViewAll, reporterB, readonlyScoped, readonlyAll, companyAdmin }).map(async ([name, account]) => [name, await bearer(account.id)]))) as Record<string, string>;
  await startServer();

  const ownerReferences = (await expectStatus<ReferenceDataResponse>("/api/receivables/reference-data", tokens.owner!, 200)).data!;
  assert.deepEqual(Object.keys(ownerReferences.dictionaries).sort(), [...referenceCategories].sort());
  assert.ok(Object.values(ownerReferences.dictionaries).every((options) => options.every((option) => option.value !== inactiveOption.value)), "reference dictionaries must exclude inactive options");
  assert.deepEqual(ownerReferences.departments.filter(({ id }) => [departmentA.id, departmentB.id, inactiveDepartment.id].includes(id)).map(({ id, canRead, canWrite }) => ({ id, canRead, canWrite })), [departmentA, departmentB].sort((left, right) => left.name.localeCompare(right.name)).map(({ id }) => ({ id, canRead: true, canWrite: true })));
  assert.ok(!ownerReferences.departments.some(({ id }) => id === inactiveDepartment.id), "reference departments must exclude inactive rows");
  const reporterReferences = (await expectStatus<ReferenceDataResponse>("/api/receivables/reference-data", tokens.reporterA!, 200)).data!;
  assert.deepEqual(reporterReferences.departments, [{ id: departmentA.id, name: departmentA.name, canRead: true, canWrite: true }]);
  const readonlyReferences = (await expectStatus<ReferenceDataResponse>("/api/receivables/reference-data", tokens.readonlyScoped!, 200)).data!;
  assert.deepEqual(readonlyReferences.departments, [{ id: departmentA.id, name: departmentA.name, canRead: true, canWrite: false }]);
  await expectStatus("/api/receivables/reference-data", tokens.companyAdmin!, 403);

  const preferencePath = "/api/receivables/preferences/columns";
  const columnOrder = [
    "financeDepartmentName", "contractNo", "projectName", "customerName", "creditorUnit", "debtStatus", "finalAmount",
    "invoicedAmount", "receivedAmount", "internalReceivable", "externalReceivable", "balance", "writeoffAmount",
    "collectionOwner", "openingChargeDate", "anomaly", "updatedAt",
  ];
  const defaultPreference: ColumnPreference = { order: columnOrder, visible: columnOrder, frozen: ["financeDepartmentName", "contractNo"] };
  const ownerPreference: ColumnPreference = { order: columnOrder, visible: columnOrder.slice(0, -1), frozen: ["financeDepartmentName", "contractNo"] };
  await expectStatus(preferencePath, tokens.companyAdmin!, 403);
  assert.equal((await request(preferencePath, tokens.companyAdmin!, { method: "PUT", body: JSON.stringify(ownerPreference) })).response.status, 403);
  await prisma.userPreference.upsert({
    where: { accountId_key: { accountId: owner.id, key: "receivables.columns.v1" } },
    create: { accountId: owner.id, key: "receivables.columns.v1", value: { order: ["not-a-column"], visible: "all", frozen: [], extra: true } },
    update: { value: { order: ["not-a-column"], visible: "all", frozen: [], extra: true } },
  });
  assert.deepEqual((await expectStatus<ColumnPreference>(preferencePath, tokens.owner!, 200)).data, defaultPreference, "malformed stored preference must fail closed to the canonical default");
  assert.equal((await request(preferencePath, tokens.owner!, { method: "PUT", body: JSON.stringify(ownerPreference) })).response.status, 200);
  assert.deepEqual((await expectStatus<ColumnPreference>(preferencePath, tokens.owner!, 200)).data, ownerPreference);
  assert.notDeepEqual((await expectStatus<ColumnPreference>(preferencePath, tokens.reporterA!, 200)).data, ownerPreference, "preferences must be isolated by account");
  const reporterPreference: ColumnPreference = { ...ownerPreference, visible: columnOrder.slice(0, -2), frozen: ["contractNo"] };
  assert.equal((await request(preferencePath, tokens.reporterA!, { method: "PUT", body: JSON.stringify(reporterPreference) })).response.status, 200);
  assert.deepEqual((await expectStatus<ColumnPreference>(preferencePath, tokens.reporterA!, 200)).data, reporterPreference);
  assert.deepEqual((await expectStatus<ColumnPreference>(preferencePath, tokens.owner!, 200)).data, ownerPreference, "one account must not overwrite another account's preference");
  for (const invalid of [
    { ...ownerPreference, order: [...columnOrder, "notAColumn"] },
    { ...ownerPreference, frozen: ["updatedAt"], visible: columnOrder.slice(0, -1) },
    { ...ownerPreference, extra: true },
  ]) {
    assert.equal((await request(preferencePath, tokens.owner!, { method: "PUT", body: JSON.stringify(invalid) })).response.status, 400);
  }

  const listA = (await expectStatus<ListResponse>("/api/receivables/ledgers?page=1&pageSize=50", tokens.reporterA!, 200)).data!;
  assert.equal(listA.total, 6, "default list must retain active unsettled history in inactive scoped departments");
  assert.ok(listA.rows.every((row) => row.financeDepartmentId === departmentA.id || row.financeDepartmentId === inactiveDepartment.id));
  assert.ok(listA.rows.some((row) => row.id === inactiveDepartmentLedger.id));
  assert.ok(!listA.rows.some((row) => row.id === settled.id || row.id === voided.id || row.id === otherDepartment.id));
  assert.equal((await expectStatus<ListResponse>("/api/receivables/ledgers", tokens.reporterB!, 200)).data?.total, 1);
  const readonlyScopedList = (await expectStatus<ListResponse>("/api/receivables/ledgers", tokens.readonlyScoped!, 200)).data!;
  assert.equal(readonlyScopedList.total, 6);
  assert.ok(readonlyScopedList.rows.every((row) => row.financeDepartmentId === departmentA.id || row.financeDepartmentId === inactiveDepartment.id));
  assert.ok(readonlyScopedList.rows.some((row) => row.id === inactiveDepartmentLedger.id));
  const readonlyScopedDetail = (await expectStatus<DetailResponse>(`/api/receivables/ledgers/${pending.id}`, tokens.readonlyScoped!, 200)).data!;
  assert.deepEqual(readonlyScopedDetail.capabilities.readDepartmentIds, [departmentA.id, inactiveDepartment.id].sort(), "response must retain historical inactive read scope");
  assert.deepEqual(readonlyScopedDetail.capabilities.writeDepartmentIds, []);
  await expectStatus(`/api/receivables/ledgers/${inactiveDepartmentLedger.id}`, tokens.readonlyScoped!, 200);
  assert.equal((await expectStatus<ListResponse>("/api/receivables/ledgers", tokens.readonlyAll!, 200)).data?.total, 7);
  assert.equal((await expectStatus<ListResponse>("/api/receivables/ledgers", tokens.admin!, 200)).data?.total, 7);
  assert.equal((await expectStatus<ListResponse>("/api/receivables/ledgers", tokens.owner!, 200)).data?.total, 7);
  await expectStatus("/api/receivables/ledgers", tokens.companyAdmin!, 403);
  assert.equal((await expectStatus<ListResponse>(`/api/receivables/ledgers?financeDepartmentId=${inactiveDepartment.id}`, tokens.reporterA!, 200)).data?.total, 1);
  await expectStatus(`/api/receivables/ledgers?financeDepartmentId=${departmentB.id}`, tokens.reporterA!, 403);
  await expectStatus("/api/receivables/ledgers?pageSize=201", tokens.owner!, 400);
  await expectStatus("/api/receivables/ledgers?sort=drop_table", tokens.owner!, 400);

  const filteredPath = `/api/receivables/ledgers?financeDepartmentId=${departmentA.id}&settlement=all&debtStatus=review&pageSize=20`;
  const filtered = (await expectStatus<ListResponse>(filteredPath, tokens.owner!, 200)).data!;
  assert.equal(filtered.total, 3);
  assert.equal(filtered.rows.length, filtered.total);
  assert.deepEqual(filtered.facets.departments, [{ value: departmentA.id, name: departmentA.name, count: 3 }]);
  assert.deepEqual(filtered.facets.debtStatuses, [{ value: "review", count: 3 }]);
  assert.deepEqual(filtered.facets.statuses, [{ value: "active", count: 3 }]);
  assert.deepEqual(filtered.facets.anomalies, [
    { value: "final_amount_missing", count: 1 }, { value: "over_received", count: 1 }, { value: "writeoff_adjustment_required", count: 1 },
  ]);

  const [baseline] = await prisma.$queryRaw<Array<{ final_amount: Prisma.Decimal; invoiced_amount: Prisma.Decimal; received_amount: Prisma.Decimal; internal_receivable: Prisma.Decimal; external_receivable: Prisma.Decimal; balance: Prisma.Decimal; writeoff_amount: Prisma.Decimal }>>`
    SELECT SUM(l.final_amount) FILTER (WHERE l.final_amount IS NOT NULL) AS final_amount,
      COALESCE(SUM(i.amount), 0) AS invoiced_amount, COALESCE(SUM(r.amount), 0) AS received_amount,
      COALESCE(SUM(i.amount), 0) - COALESCE(SUM(r.amount), 0) AS internal_receivable,
      SUM(l.final_amount - COALESCE(i.amount, 0)) FILTER (WHERE l.final_amount IS NOT NULL) AS external_receivable,
      SUM(l.final_amount - COALESCE(r.amount, 0) - l.writeoff_amount) FILTER (WHERE l.final_amount IS NOT NULL) AS balance,
      SUM(l.writeoff_amount) AS writeoff_amount
    FROM receivable_ledgers l
    LEFT JOIN LATERAL (SELECT SUM(amount) AS amount FROM receivable_invoices WHERE ledger_id = l.id AND status = 'active') i ON TRUE
    LEFT JOIN LATERAL (SELECT SUM(amount) AS amount FROM receivable_receipts WHERE ledger_id = l.id AND status = 'active') r ON TRUE
    WHERE l.finance_department_id = ${departmentA.id}::uuid AND l.status = 'active' AND l.debt_status = 'review'
  `;
  assert.ok(baseline);
  const expectedAmounts: Amounts = {
    activeLedgerCount: 3, finalAmount: fixed(baseline.final_amount), invoicedAmount: fixed(baseline.invoiced_amount)!, receivedAmount: fixed(baseline.received_amount)!,
    internalReceivable: fixed(baseline.internal_receivable)!, externalReceivable: fixed(baseline.external_receivable), balance: fixed(baseline.balance), writeoffAmount: fixed(baseline.writeoff_amount)!,
    finalAmountMissingCount: 1, overReceivedCount: 1, writeoffAdjustmentRequiredCount: 1,
  };
  assert.deepEqual(filtered.totals, expectedAmounts);
  const dashboard = (await expectStatus<DashboardResponse>(`/api/receivables/dashboard?financeDepartmentId=${departmentA.id}&settlement=all&debtStatus=review`, tokens.owner!, 200)).data!;
  assert.deepEqual(dashboard.amounts, expectedAmounts, "dashboard amounts must match the independently aggregated SQL baseline and filtered list totals");
  assert.deepEqual(dashboard.statuses, filtered.facets.statuses);
  assert.deepEqual(dashboard.anomalies, filtered.facets.anomalies);

  const allStatuses = (await expectStatus<ListResponse>(`/api/receivables/ledgers?financeDepartmentId=${departmentA.id}&status=all&settlement=all&pageSize=20`, tokens.owner!, 200)).data!;
  assert.equal(allStatuses.total, 7);
  assert.equal(allStatuses.totals.finalAmount, "400.0000", "voided ledger must not inflate financial totals");
  assert.equal(allStatuses.totals.invoicedAmount, "160.0000", "voided detail must not inflate financial totals");
  const onlyVoided = (await expectStatus<ListResponse>(`/api/receivables/ledgers?financeDepartmentId=${departmentA.id}&status=voided&settlement=all`, tokens.owner!, 200)).data!;
  assert.equal(onlyVoided.total, 1);
  assert.deepEqual({ activeLedgerCount: onlyVoided.totals.activeLedgerCount, finalAmount: onlyVoided.totals.finalAmount, invoicedAmount: onlyVoided.totals.invoicedAmount }, { activeLedgerCount: 0, finalAmount: null, invoicedAmount: "0.0000" });
  const allStatusDashboard = (await expectStatus<DashboardResponse>(`/api/receivables/dashboard?financeDepartmentId=${departmentA.id}&status=all&settlement=all`, tokens.owner!, 200)).data!;
  assert.deepEqual(allStatusDashboard.anomalies, [
    { value: null, count: 3 }, { value: "final_amount_missing", count: 1 }, { value: "over_received", count: 1 }, { value: "writeoff_adjustment_required", count: 1 },
  ], "voided anomalies must not inflate dashboard business facts");
  const voidedDashboard = (await expectStatus<DashboardResponse>(`/api/receivables/dashboard?financeDepartmentId=${departmentA.id}&status=voided&settlement=all`, tokens.owner!, 200)).data!;
  assert.deepEqual(voidedDashboard.anomalies, [], "voided-only dashboard has no active anomaly facts");
  assert.equal(voidedDashboard.amounts.activeLedgerCount, 0);

  const invoiceSorted = (await expectStatus<ListResponse>(`/api/receivables/ledgers?financeDepartmentId=${departmentA.id}&settlement=all&sort=invoicedAmount&order=asc&pageSize=20`, tokens.owner!, 200)).data!.rows;
  assert.deepEqual(invoiceSorted.slice(0, 4).map(({ id }) => id), [settled.id, writeoff.id, stableA.id, stableB.id].sort(), "zero-invoice ties use ascending id");
  assert.deepEqual(invoiceSorted.slice(4).map(({ id }) => id), [pending.id, over.id].sort(), "equal invoice totals use ascending id");
  const receiptSorted = (await expectStatus<ListResponse>(`/api/receivables/ledgers?financeDepartmentId=${departmentA.id}&settlement=all&sort=receivedAmount&order=desc&pageSize=20`, tokens.owner!, 200)).data!.rows;
  assert.deepEqual(receiptSorted.map(({ id }) => id), [over.id, settled.id, writeoff.id, pending.id, ...[stableA.id, stableB.id].sort().reverse()]);
  const balanceSorted = (await expectStatus<ListResponse>(`/api/receivables/ledgers?financeDepartmentId=${departmentA.id}&settlement=all&sort=balance&order=asc&pageSize=20`, tokens.owner!, 200)).data!.rows;
  assert.deepEqual(balanceSorted.map(({ id }) => id), [over.id, writeoff.id, settled.id, ...[stableA.id, stableB.id].sort(), pending.id], "null balance sorts last and equal balances use id");

  const firstPage = (await expectStatus<ListResponse>(`/api/receivables/ledgers?financeDepartmentId=${departmentA.id}&settlement=all&sort=debtStatus&order=asc&page=1&pageSize=2`, tokens.owner!, 200)).data!;
  const secondPage = (await expectStatus<ListResponse>(`/api/receivables/ledgers?financeDepartmentId=${departmentA.id}&settlement=all&sort=debtStatus&order=asc&page=2&pageSize=2`, tokens.owner!, 200)).data!;
  const repeatedFirstPage = (await expectStatus<ListResponse>(`/api/receivables/ledgers?financeDepartmentId=${departmentA.id}&settlement=all&sort=debtStatus&order=asc&page=1&pageSize=2`, tokens.owner!, 200)).data!;
  assert.deepEqual(repeatedFirstPage.rows.map(({ id }) => id), firstPage.rows.map(({ id }) => id), "pagination order must be deterministic");
  assert.equal(new Set([...firstPage.rows, ...secondPage.rows].map(({ id }) => id)).size, 4, "stable pagination must not duplicate tied rows");

  const detail = (await expectStatus<DetailResponse>(`/api/receivables/ledgers/${pending.id}`, tokens.reporterA!, 200)).data!;
  assert.equal(detail.ledger.finalAmount, null);
  assert.equal(detail.ledger.invoicedAmount, "80.0000");
  assert.equal(detail.ledger.receivedAmount, "30.0000");
  assert.equal(detail.ledger.anomaly, "final_amount_missing");
  assert.deepEqual(detail.invoices.map(({ status }) => status).sort(), ["active", "voided"]);
  assert.deepEqual(detail.receipts.map(({ status }) => status).sort(), ["active", "voided"]);
  assert.deepEqual(detail.attachments.map(({ status }) => status).sort(), ["active", "voided"]);
  assert.deepEqual(detail.attachments.map(({ status, capabilities }) => ({ status, capabilities })).sort((left, right) => left.status.localeCompare(right.status)), [
    { status: "active", capabilities: { canDownload: true, canVoid: false } },
    { status: "voided", capabilities: { canDownload: false, canVoid: false } },
  ]);
  assert.equal(detail.revisions[0]?.reason, "fixture correction");
  assert.deepEqual({ role: detail.capabilities.role, canViewAll: detail.capabilities.canViewAll, canManageMoney: detail.capabilities.canManageMoney }, { role: "reporter", canViewAll: false, canManageMoney: false });
  assert.deepEqual(detail.capabilities.readDepartmentIds, [departmentA.id, inactiveDepartment.id].sort());
  assert.deepEqual(detail.capabilities.writeDepartmentIds, [departmentA.id, inactiveDepartment.id].sort());
  const viewAllOwnDepartment = (await expectStatus<DetailResponse>(`/api/receivables/ledgers/${pending.id}`, tokens.reporterViewAll!, 200)).data!;
  assert.equal(viewAllOwnDepartment.capabilities.canWriteLedger, true, "view-all reporter retains write capability in its granted department");
  const viewAllCrossDepartment = (await expectStatus<DetailResponse>(`/api/receivables/ledgers/${otherDepartment.id}`, tokens.reporterViewAll!, 200)).data!;
  assert.equal(viewAllCrossDepartment.capabilities.canWriteLedger, false, "view-all must not advertise cross-department ledger writes");
  assert.ok(viewAllCrossDepartment.attachments.every((attachment) => attachment.capabilities.canVoid === false), "view-all must not advertise cross-department attachment voids");
  const ownerDetail = (await expectStatus<DetailResponse>(`/api/receivables/ledgers/${pending.id}`, tokens.owner!, 200)).data!;
  assert.equal(ownerDetail.attachments.find((attachment) => attachment.status === "voided")?.capabilities.canDownload, true, "owner audit access must allow downloading voided attachments");
  assert.equal(ownerDetail.attachments.find((attachment) => attachment.status === "voided")?.capabilities.canVoid, false);
  const adminDetail = (await expectStatus<DetailResponse>(`/api/receivables/ledgers/${pending.id}`, tokens.admin!, 200)).data!;
  assert.equal(adminDetail.attachments.find((attachment) => attachment.status === "voided")?.capabilities.canDownload, true, "finance admin audit access must allow downloading voided attachments");
  assert.equal(adminDetail.attachments.find((attachment) => attachment.status === "voided")?.capabilities.canVoid, false);
  const hidden = await request(`/api/receivables/ledgers/${pending.id}`, tokens.reporterB!);
  const absent = await request(`/api/receivables/ledgers/${randomUUID()}`, tokens.reporterB!);
  assert.equal(hidden.response.status, 404);
  assert.equal(absent.response.status, 404);
  assert.deepEqual(hidden.body.error, absent.body.error, "cross-scope detail must not disclose existence");
  const readonlyDetail = (await expectStatus<DetailResponse>(`/api/receivables/ledgers/${pending.id}`, tokens.readonlyAll!, 200)).data!;
  assert.equal(readonlyDetail.capabilities.role, "readonly");
  assert.equal(readonlyDetail.capabilities.canViewAll, true);
  assert.equal(readonlyDetail.attachments.length, 2);
  assert.ok(readonlyDetail.attachments.every((attachment) => attachment.capabilities.canVoid === false));
  assert.equal(readonlyDetail.attachments.find((attachment) => attachment.status === "voided")?.capabilities.canDownload, false);
  assert.equal(readonlyDetail.revisions.length, 1);

  await prisma.receivableAccessGrant.update({ where: { id: reporterBGrant.id }, data: { active: false, revokedAt: new Date(), revokedBy: owner.id, revokeReason: "smoke revocation" } });
  await expectStatus("/api/receivables/ledgers", tokens.reporterB!, 403);
  await prisma.account.update({ where: { id: readonlyAll.id }, data: { status: "disabled" } });
  await expectStatus("/api/receivables/dashboard", tokens.readonlyAll!, 401);
  console.log("RECEIVABLES_QUERY_SMOKE=PASS");
} finally {
  await stopServer();
  await cleanup();
  assert.equal(await prisma.receivableAttachment.count({ where: { id: { in: ids.attachments } } }), 0);
  assert.equal(await prisma.privateFile.count({ where: { id: { in: ids.files } } }), 0);
  assert.equal(await prisma.receivableInvoice.count({ where: { id: { in: ids.invoices } } }), 0);
  assert.equal(await prisma.receivableReceipt.count({ where: { id: { in: ids.receipts } } }), 0);
  assert.equal(await prisma.receivableLedgerRevision.count({ where: { id: { in: ids.revisions } } }), 0);
  assert.equal(await prisma.receivableLedger.count({ where: { id: { in: ids.ledgers } } }), 0);
  assert.deepEqual(await prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } }), originalSetting);
  assert.equal(await prisma.userPreference.count({ where: { accountId: { in: ids.accounts } } }), 0);
  assert.equal(await prisma.receivableAccessGrant.count({ where: { id: { in: ids.grants } } }), 0);
  assert.equal(await prisma.receivableDepartment.count({ where: { id: { in: ids.departments } } }), 0);
  assert.equal(await prisma.refreshSession.count({ where: { id: { in: ids.sessions } } }), 0);
  assert.equal(await prisma.roleAssignment.count({ where: { id: { in: ids.roleAssignments } } }), 0);
  assert.equal(await prisma.account.count({ where: { id: { in: ids.accounts } } }), 0);
  assert.equal(await prisma.person.count({ where: { id: { in: ids.people } } }), 0);
  assert.equal(await prisma.organization.count({ where: { id: { in: ids.organizations } } }), 0);
  await prisma.$disconnect();
}
