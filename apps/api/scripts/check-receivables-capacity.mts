import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import type { Principal } from "../src/auth.js";
import { prisma } from "../src/db.js";
import { createReceivablesExportJob, processReceivablesExportJob } from "../src/receivables-export.js";
import {
  buildReceivablesDashboardStatements,
  buildReceivablesExportBatchStatement,
  buildReceivablesListStatements,
  queryReceivables,
  type ReceivablesQueryScope,
} from "../src/receivables-query.js";

const root = resolve(import.meta.dirname, "../../..");
const uploadRoot = resolve(root, "var/receivables-capacity-test");
const databaseUrl = process.env.DATABASE_URL ?? "";
const marker = process.env.RECEIVABLES_CAPACITY_MARKER ?? `rxa-capacity-${randomUUID()}`;
const fullLedgerCount = 50_000;
const detailsPerLedger = 10;
const ledgerBatchSize = 500;
const pageSize = 200;

function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error("RECEIVABLES_CAPACITY_DEV_COUNT_INVALID");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error("RECEIVABLES_CAPACITY_DEV_COUNT_INVALID");
  return parsed;
}

function options() {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  if (args.some((argument) => !["--dev", "--dev-timeout-probe"].includes(argument))) throw new Error("RECEIVABLES_CAPACITY_ARGUMENT_INVALID");
  const timeoutProbe = args.includes("--dev-timeout-probe");
  const development = args.includes("--dev") || timeoutProbe;
  const ledgerCount = development ? positiveInteger(process.env.RECEIVABLES_CAPACITY_DEV_LEDGERS, 401, 5_000) : fullLedgerCount;
  assert.equal(development || ledgerCount === fullLedgerCount, true, "Formal capacity mode must use exactly 50,000 ledgers");
  return { development, timeoutProbe, ledgerCount, detailCount: ledgerCount * detailsPerLedger };
}

function assertEnvironment() {
  let parsed: URL;
  try { parsed = new URL(databaseUrl); } catch { throw new Error("RECEIVABLES_CAPACITY_DATABASE_URL_INVALID"); }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55432" || !databaseName.includes("receivables_capacity_test") || parsed.username !== "postgres") {
    throw new Error("RECEIVABLES_CAPACITY_DATABASE_URL_UNSAFE");
  }
  if (uploadRoot !== resolve(root, "var/receivables-capacity-test")) throw new Error("RECEIVABLES_CAPACITY_UPLOAD_ROOT_UNSAFE");
  if (!/^rxa-capacity-[0-9a-f-]{36}$/.test(marker)) throw new Error("RECEIVABLES_CAPACITY_MARKER_INVALID");
  return databaseName;
}

async function timed<T>(action: () => Promise<T>) {
  const started = performance.now();
  const value = await action();
  const milliseconds = Math.round(performance.now() - started);
  return { value, milliseconds };
}

function principal(accountId: string, personId: string): Principal {
  return { accountId, personId, mustChangePassword: false, sessionId: null, roles: [] };
}

type ExplainRow = { "QUERY PLAN": unknown };

function planEvidence(name: string, rows: ExplainRow[], expectedRootRows?: number) {
  const json = rows[0]?.["QUERY PLAN"];
  const root = Array.isArray(json) && json[0] && typeof json[0] === "object" ? (json[0] as { Plan?: Record<string, unknown> }).Plan : undefined;
  assert.ok(root, `${name} EXPLAIN plan missing`);
  const nodes: Record<string, unknown>[] = [];
  const visit = (node: Record<string, unknown>) => {
    nodes.push(node);
    if (Array.isArray(node.Plans)) for (const child of node.Plans) if (child && typeof child === "object") visit(child as Record<string, unknown>);
  };
  visit(root!);
  const actualRows = Number(root!["Actual Rows"]);
  assert.ok(Number.isFinite(actualRows), `${name} EXPLAIN actual rows missing`);
  if (expectedRootRows !== undefined) assert.equal(actualRows, expectedRootRows, `${name} EXPLAIN root row count mismatch`);
  const nodeTypes = [...new Set(nodes.map((node) => String(node["Node Type"] ?? "")))].filter(Boolean).sort();
  const scans = nodeTypes.filter((nodeType) => nodeType.includes("Scan"));
  assert.ok(scans.length > 0, `${name} EXPLAIN has no actual scan node`);
  const indexNames = [...new Set(nodes.map((node) => node["Index Name"]).filter((value): value is string => typeof value === "string"))].sort();
  return { actualRows, nodeTypes, scans, indexNames };
}

async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function xlsxRows(path: string) {
  let rows = 0;
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, { entries: "emit", sharedStrings: "cache", styles: "ignore", hyperlinks: "ignore", worksheets: "emit" });
  for await (const worksheet of reader) for await (const _row of worksheet) rows += 1;
  return rows;
}

const run = options();
const databaseName = assertEnvironment();
const phaseTimeoutMs = run.development ? 5 * 60_000 : 30 * 60_000;
const workerMode = process.env.RECEIVABLES_CAPACITY_WORKER === "1";
const ids = { organization: "", person: "", account: "", role: "", departments: [] as string[], ledgers: [] as string[], exportJobs: [] as string[] };
type SettingBaseline = { financeOrganizationId: string | null; configurationConfirmedAt: Date | null; configurationConfirmedBy: string | null } | null;
let originalSetting: SettingBaseline = null;
let report: Record<string, unknown> | null = null;

const readSetting = () => prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } });

async function cleanup(baseline: SettingBaseline) {
  const errors: unknown[] = [];
  const attempt = async (action: () => Promise<unknown>) => { try { await action(); } catch (error) { errors.push(error); } };
  const accounts = await prisma.account.findMany({ where: { usernameNormalized: { startsWith: marker } }, select: { id: true, personId: true } }).catch((error) => { errors.push(error); return []; });
  const accountIds = [...new Set([...accounts.map(({ id }) => id), ...(ids.account ? [ids.account] : [])])];
  const people = await prisma.person.findMany({ where: { name: { startsWith: marker } }, select: { id: true } }).catch((error) => { errors.push(error); return []; });
  const personIds = [...new Set([...people.map(({ id }) => id), ...accounts.flatMap(({ personId }) => personId ? [personId] : []), ...(ids.person ? [ids.person] : [])])];
  const organizations = await prisma.organization.findMany({ where: { name: { startsWith: marker } }, select: { id: true } }).catch((error) => { errors.push(error); return []; });
  const organizationIds = [...new Set([...organizations.map(({ id }) => id), ...(ids.organization ? [ids.organization] : [])])];
  const departments = await prisma.receivableDepartment.findMany({ where: { name: { startsWith: marker } }, select: { id: true } }).catch((error) => { errors.push(error); return []; });
  const departmentIds = [...new Set([...departments.map(({ id }) => id), ...ids.departments])];
  if (accountIds.length) await attempt(() => prisma.receivableExportJob.deleteMany({ where: { requestedBy: { in: accountIds } } }));
  await attempt(() => prisma.receivableExportJob.deleteMany({ where: { filterSnapshot: { path: ["search"], equals: marker } } }));
  if (accountIds.length) await attempt(() => prisma.auditLog.deleteMany({ where: { actorId: { in: accountIds } } }));
  await attempt(() => prisma.auditLog.deleteMany({ where: { requestId: marker } }));
  await attempt(() => prisma.receivableInvoice.deleteMany({ where: { ledger: { contractNoNormalized: { startsWith: marker } } } }));
  await attempt(() => prisma.receivableReceipt.deleteMany({ where: { ledger: { contractNoNormalized: { startsWith: marker } } } }));
  await attempt(() => prisma.receivableLedgerRevision.deleteMany({ where: { ledger: { contractNoNormalized: { startsWith: marker } } } }));
  await attempt(() => prisma.receivableLedger.deleteMany({ where: { contractNoNormalized: { startsWith: marker } } }));
  if (baseline) {
    await attempt(() => prisma.receivableSetting.upsert({ where: { id: 1 }, create: { id: 1, ...baseline }, update: baseline }));
  } else {
    await attempt(() => prisma.receivableSetting.deleteMany({ where: { id: 1 } }));
  }
  if (departmentIds.length) await attempt(() => prisma.receivableDepartment.deleteMany({ where: { id: { in: departmentIds } } }));
  const roleFilters = [
    ...(accountIds.length ? [{ accountId: { in: accountIds } }] : []),
    ...(personIds.length ? [{ personId: { in: personIds } }] : []),
    ...(organizationIds.length ? [{ scopeId: { in: organizationIds } }] : []),
  ];
  if (roleFilters.length) await attempt(() => prisma.roleAssignment.deleteMany({ where: { OR: roleFilters } }));
  if (accountIds.length) await attempt(() => prisma.account.deleteMany({ where: { id: { in: accountIds } } }));
  if (personIds.length) await attempt(() => prisma.person.deleteMany({ where: { id: { in: personIds } } }));
  if (organizationIds.length) await attempt(() => prisma.organization.deleteMany({ where: { id: { in: organizationIds } } }));
  await attempt(() => rm(uploadRoot, { recursive: true, force: true }));
  if (errors.length) throw new AggregateError(errors, "receivables capacity cleanup failed");
}

async function assertClean(baseline: SettingBaseline) {
  const [ledgers, invoices, receipts, jobs, audits, departments, accounts, people, organizations, uploadState] = await Promise.all([
    prisma.receivableLedger.count({ where: { contractNoNormalized: { startsWith: marker } } }),
    prisma.receivableInvoice.count({ where: { ledger: { contractNoNormalized: { startsWith: marker } } } }),
    prisma.receivableReceipt.count({ where: { ledger: { contractNoNormalized: { startsWith: marker } } } }),
    prisma.receivableExportJob.count({ where: { OR: [{ filterSnapshot: { path: ["search"], equals: marker } }, ...(ids.account ? [{ requestedBy: ids.account }] : [])] } }),
    prisma.auditLog.count({ where: { OR: [{ requestId: marker }, ...(ids.account ? [{ actorId: ids.account }] : [])] } }),
    prisma.receivableDepartment.count({ where: { name: { startsWith: marker } } }),
    prisma.account.count({ where: { usernameNormalized: { startsWith: marker } } }),
    prisma.person.count({ where: { name: { startsWith: marker } } }),
    prisma.organization.count({ where: { name: { startsWith: marker } } }),
    stat(uploadRoot).then(() => "present", (error: NodeJS.ErrnoException) => error.code === "ENOENT" ? "absent" : Promise.reject(error)),
  ]);
  assert.deepEqual({ ledgers, invoices, receipts, jobs, audits, departments, accounts, people, organizations, uploadState }, { ledgers: 0, invoices: 0, receipts: 0, jobs: 0, audits: 0, departments: 0, accounts: 0, people: 0, organizations: 0, uploadState: "absent" });
  const restored = await prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } });
  assert.deepEqual(restored, baseline, "capacity check did not restore the exact receivable setting baseline");
}

async function runCapacityWorker() {
try {
  await rm(uploadRoot, { recursive: true, force: true });
  await mkdir(uploadRoot, { recursive: true });
  originalSetting = await readSetting();

  const organization = await prisma.organization.create({ data: { name: `${marker}-finance`, type: "department" } }); ids.organization = organization.id;
  const person = await prisma.person.create({ data: { name: `${marker}-owner`, phone: "19800000001", type: "employee", status: "active" } }); ids.person = person.id;
  const account = await prisma.account.create({ data: { personId: person.id, username: `${marker}-owner`, usernameNormalized: `${marker}-owner`, status: "active" } }); ids.account = account.id;
  const role = await prisma.roleAssignment.create({ data: { accountId: account.id, personId: person.id, role: "org_leader", scopeType: "organization", scopeId: organization.id } }); ids.role = role.id;
  await prisma.receivableSetting.upsert({ where: { id: 1 }, create: { id: 1, financeOrganizationId: organization.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: account.id }, update: { financeOrganizationId: organization.id, configurationConfirmedAt: new Date(), configurationConfirmedBy: account.id } });
  await prisma.receivableDepartment.createMany({ data: Array.from({ length: 10 }, (_unused, index) => ({ name: `${marker}-department-${String(index).padStart(2, "0")}`, code: `${marker.slice(-8)}-${index}` })) });
  const departments = await prisma.receivableDepartment.findMany({ where: { name: { startsWith: marker } }, orderBy: { name: "asc" }, select: { id: true } });
  ids.departments.push(...departments.map(({ id }) => id));
  assert.equal(departments.length, 10);

  if (run.timeoutProbe) {
    const probeId = randomUUID();
    ids.ledgers.push(probeId);
    await prisma.receivableLedger.create({ data: { id: probeId, financeDepartmentId: departments[0]!.id, contractNo: `${marker}-timeout-probe`, contractNoNormalized: `${marker}-timeout-probe`, projectName: `${marker}-timeout-probe`, finalAmount: "1.0000", createdBy: account.id } });
    console.log("RECEIVABLES_CAPACITY_TIMEOUT_PROBE_READY");
    await new Promise<never>(() => { setInterval(() => {}, 1_000); });
  }

  const ledgerSeed = await timed(async () => {
    for (let offset = 0; offset < run.ledgerCount; offset += ledgerBatchSize) {
      const count = Math.min(ledgerBatchSize, run.ledgerCount - offset);
      const rows = Array.from({ length: count }, (_unused, local) => {
        const index = offset + local;
        const id = randomUUID();
        ids.ledgers.push(id);
        const contractNo = `${marker}-${String(index).padStart(6, "0")}`;
        return {
          id, financeDepartmentId: departments[index % departments.length]!.id, contractNo, contractNoNormalized: contractNo,
          projectName: `${marker}-project-${index}`, customerName: `${marker}-customer-${index % 97}`,
          creditorUnit: index % 2 ? "capacity-unit-b" : "capacity-unit-a", debtStatus: index % 3 ? "capacity-normal" : "capacity-review",
          contractAmount: "1000.0000", finalAmount: "1000.0000", writeoffAmount: "0.0000", createdBy: account.id,
        };
      });
      await prisma.receivableLedger.createMany({ data: rows });
    }
  });

  const detailSeed = await timed(async () => {
    for (let offset = 0; offset < ids.ledgers.length; offset += ledgerBatchSize) {
      const ledgerIds = ids.ledgers.slice(offset, offset + ledgerBatchSize);
      const invoices = ledgerIds.flatMap((ledgerId) => Array.from({ length: detailsPerLedger / 2 }, (_unused, detail) => ({ ledgerId, invoiceDate: new Date(Date.UTC(2026, detail, 1)), invoiceNo: `${marker}-I-${offset + detail}`, amount: "100.0000", createdBy: account.id })));
      const receipts = ledgerIds.flatMap((ledgerId) => Array.from({ length: detailsPerLedger / 2 }, (_unused, detail) => ({ ledgerId, receiptDate: new Date(Date.UTC(2026, detail, 2)), referenceNo: `${marker}-R-${offset + detail}`, amount: "50.0000", createdBy: account.id })));
      await prisma.$transaction([prisma.receivableInvoice.createMany({ data: invoices }), prisma.receivableReceipt.createMany({ data: receipts })], { maxWait: 10_000, timeout: phaseTimeoutMs });
    }
  });

  assert.equal(await prisma.receivableLedger.count({ where: { contractNoNormalized: { startsWith: marker } } }), run.ledgerCount);
  const [invoiceCount, receiptCount] = await Promise.all([
    prisma.receivableInvoice.count({ where: { ledger: { contractNoNormalized: { startsWith: marker } } } }),
    prisma.receivableReceipt.count({ where: { ledger: { contractNoNormalized: { startsWith: marker } } } }),
  ]);
  assert.equal(invoiceCount + receiptCount, run.detailCount);
  await prisma.$executeRaw`ANALYZE receivable_ledgers`;
  await prisma.$executeRaw`ANALYZE receivable_invoices`;
  await prisma.$executeRaw`ANALYZE receivable_receipts`;

  const actor = principal(account.id, person.id);
  const pagination = await timed(async () => {
    const seen = new Set<string>();
    const pages = Math.ceil(run.ledgerCount / pageSize);
    for (let page = 1; page <= pages; page += 1) {
      const result = await queryReceivables(actor, { type: "ledger.list", input: { page, pageSize, status: "all", settlement: "all", search: marker, sort: "contractNo", order: "asc" } }) as { rows: Array<{ id: string }>; total: number };
      assert.equal(result.total, run.ledgerCount);
      for (const row of result.rows) assert.equal(seen.has(row.id), false, `duplicate ledger on page ${page}: ${row.id}`), seen.add(row.id);
      assert.equal(result.rows.length, page === pages ? run.ledgerCount - pageSize * (pages - 1) : pageSize);
    }
    assert.equal(seen.size, run.ledgerCount, "paginated query omitted ledger ids");
    return pages;
  });

  const filtered = await queryReceivables(actor, { type: "ledger.list", input: { page: 1, pageSize, status: "active", settlement: "all", financeDepartmentId: departments[0]!.id, debtStatus: "capacity-review", sort: "contractNo", order: "asc" } }) as { total: number };
  assert.ok(filtered.total > 0 && filtered.total < run.ledgerCount, "filter/scope path did not narrow results");

  const allScope: ReceivablesQueryScope = {
    financeDepartmentId: null, status: "all", settlement: "all", debtStatus: null, creditorUnit: null, anomaly: null, search: marker,
    readDepartmentIds: null, capabilityReadDepartmentIds: [], capabilityWriteDepartmentIds: [], cutoffAt: null,
  };
  const listStatements = buildReceivablesListStatements(allScope, { page: 1, pageSize, status: "all", settlement: "all", search: marker, sort: "contractNo", order: "asc" });
  const dashboardStatements = buildReceivablesDashboardStatements(allScope);
  const exportStatement = buildReceivablesExportBatchStatement({ ...allScope, cutoffAt: new Date(Date.now() + 60_000) }, null, 500);
  const departmentStatements = buildReceivablesListStatements({ ...allScope, financeDepartmentId: departments[0]!.id, status: "active", search: null }, { page: 1, pageSize, status: "active", settlement: "all", financeDepartmentId: departments[0]!.id, sort: "contractNo", order: "asc" });
  const debtStatements = buildReceivablesListStatements({ ...allScope, status: "active", debtStatus: "capacity-review", search: null }, { page: 1, pageSize, status: "active", settlement: "all", debtStatus: "capacity-review", sort: "contractNo", order: "asc" });
  const explain = (statement: Prisma.Sql) => prisma.$queryRaw<ExplainRow[]>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`);
  const [listRowsPlan, listCountPlan, dashboardTotalsPlan, exportBatchPlan, departmentPlan, debtPlan] = await Promise.all([
    explain(listStatements.rows), explain(listStatements.count), explain(dashboardStatements.totals), explain(exportStatement), explain(departmentStatements.rows), explain(debtStatements.rows),
  ]);
  const planEvidenceByStatement = {
    listRows: planEvidence("production list rows", listRowsPlan, Math.min(pageSize, run.ledgerCount)),
    listCount: planEvidence("production list count", listCountPlan, 1),
    dashboardTotals: planEvidence("production dashboard totals", dashboardTotalsPlan, 1),
    exportBatch: planEvidence("production export batch", exportBatchPlan, Math.min(500, run.ledgerCount)),
    departmentRows: planEvidence("production department-filtered rows", departmentPlan),
    debtRows: planEvidence("production debt-filtered rows", debtPlan),
  };
  const expectedIndexes = [
    "receivable_ledgers_finance_department_id_status_idx", "receivable_ledgers_status_debt_status_idx",
    "receivable_invoices_ledger_id_status_invoice_date_idx", "receivable_receipts_ledger_id_status_receipt_date_idx",
  ];
  const catalogIndexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname IN
      ('receivable_ledgers_finance_department_id_status_idx', 'receivable_ledgers_status_debt_status_idx', 'receivable_invoices_ledger_id_status_invoice_date_idx', 'receivable_receipts_ledger_id_status_receipt_date_idx')`;
  assert.deepEqual(catalogIndexes.map(({ indexname }) => indexname).sort(), [...expectedIndexes].sort(), "capacity-critical indexes are missing");
  const observedIndexes = [...new Set(Object.values(planEvidenceByStatement).flatMap(({ indexNames }) => indexNames))].sort();
  if (!run.development) {
    for (const indexName of expectedIndexes) assert.equal(observedIndexes.includes(indexName), true, `formal production SQL plans did not select ${indexName}`);
  }

  const dashboard = await timed(() => queryReceivables(actor, { type: "dashboard", input: { status: "all", settlement: "all", search: marker } })) as { value: { amounts: Record<string, unknown> }; milliseconds: number };
  const [baseline] = await prisma.$queryRaw<Array<{ activeLedgerCount: number; finalAmount: Prisma.Decimal; invoicedAmount: Prisma.Decimal; receivedAmount: Prisma.Decimal; internalReceivable: Prisma.Decimal; externalReceivable: Prisma.Decimal; balance: Prisma.Decimal }>>(Prisma.sql`
    SELECT COUNT(*)::int AS "activeLedgerCount", SUM(l.final_amount) AS "finalAmount",
      SUM(COALESCE(i.amount, 0)) AS "invoicedAmount", SUM(COALESCE(r.amount, 0)) AS "receivedAmount",
      SUM(COALESCE(i.amount, 0) - COALESCE(r.amount, 0)) AS "internalReceivable",
      SUM(l.final_amount - COALESCE(i.amount, 0)) AS "externalReceivable",
      SUM(l.final_amount - COALESCE(r.amount, 0) - l.writeoff_amount) AS "balance"
    FROM receivable_ledgers l
    LEFT JOIN (SELECT ledger_id, SUM(amount) amount FROM receivable_invoices WHERE status = 'active' GROUP BY ledger_id) i ON i.ledger_id = l.id
    LEFT JOIN (SELECT ledger_id, SUM(amount) amount FROM receivable_receipts WHERE status = 'active' GROUP BY ledger_id) r ON r.ledger_id = l.id
    WHERE l.contract_no_normalized LIKE ${`${marker}%`} AND l.status = 'active'`);
  assert.ok(baseline);
  const expectedAmounts = {
    activeLedgerCount: baseline!.activeLedgerCount, finalAmount: baseline!.finalAmount.toFixed(4), invoicedAmount: baseline!.invoicedAmount.toFixed(4),
    receivedAmount: baseline!.receivedAmount.toFixed(4), internalReceivable: baseline!.internalReceivable.toFixed(4),
    externalReceivable: baseline!.externalReceivable.toFixed(4), balance: baseline!.balance.toFixed(4), writeoffAmount: "0.0000",
    finalAmountMissingCount: 0, overReceivedCount: 0, writeoffAdjustmentRequiredCount: 0,
  };
  assert.deepEqual(dashboard.value.amounts, expectedAmounts, "dashboard totals diverged from independent SQL numeric baseline");

  const exportRun = await timed(async () => {
    const job = await createReceivablesExportJob(actor, { status: "all", settlement: "all", search: marker }, { uploadRoot }, marker);
    ids.exportJobs.push(job.id);
    assert.equal(await processReceivablesExportJob(job.id, { uploadRoot }), true);
    const completed = await prisma.receivableExportJob.findUniqueOrThrow({ where: { id: job.id }, select: { status: true, rowCount: true, storageKey: true, size: true, sha256: true } });
    assert.equal(completed.status, "completed");
    assert.equal(completed.rowCount, run.ledgerCount);
    if (!run.development) assert.ok((completed.rowCount ?? 0) > 5_000, "formal export did not prove the absence of a 5,000-row truncation");
    assert.ok(completed.storageKey && completed.size && completed.sha256);
    const path = resolve(uploadRoot, completed.storageKey!);
    const [details, digest, rows] = await Promise.all([stat(path), sha256(path), xlsxRows(path)]);
    assert.equal(details.size, completed.size);
    assert.equal(digest, completed.sha256);
    assert.equal(rows, run.ledgerCount + 1, "streaming XLSX row count is incomplete");
    return { rowCount: completed.rowCount, size: completed.size, sha256: completed.sha256, worksheetRows: rows };
  });

  report = {
    result: "PASS", mode: run.development ? "scaled-development" : "formal", databaseName,
    ledgerCount: run.ledgerCount, detailCount: invoiceCount + receiptCount, pages: pagination.value,
    timingsMs: { ledgerSeed: ledgerSeed.milliseconds, detailSeed: detailSeed.milliseconds, pagination: pagination.milliseconds, dashboard: dashboard.milliseconds, export: exportRun.milliseconds },
    explain: { expectedIndexes, observedIndexes, statements: planEvidenceByStatement, plannerIndexAssertions: run.development ? "real-production-statements-scaled-scan-observed" : "real-production-statements-index-selected" },
    export: exportRun.value,
    note: "Synthetic isolated run; timings are not production benchmarks",
  };
} finally {
  const teardownErrors: unknown[] = [];
  for (const action of [() => cleanup(originalSetting), () => assertClean(originalSetting), () => prisma.$disconnect()]) {
    try { await action(); } catch (error) { teardownErrors.push(error); }
  }
  if (teardownErrors.length) throw new AggregateError(teardownErrors, "receivables capacity worker teardown failed");
}

console.log(`RECEIVABLES_CAPACITY=${JSON.stringify({ ...report, cleanup: "zero-residual" })}`);
}

function terminateWorker(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return false;
  child.kill();
  const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 5_000);
  force.unref();
  return true;
}

async function runCapacityParent() {
  const baseline = await readSetting();
  await prisma.$disconnect();
  const child = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    cwd: root,
    env: { ...process.env, RECEIVABLES_CAPACITY_WORKER: "1", RECEIVABLES_CAPACITY_MARKER: marker },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let timedOut = false;
  let terminationRequested = false;
  let probeReady = false;
  let probeKill: NodeJS.Timeout | undefined;
  child.stdout?.on("data", (chunk) => {
    const text = String(chunk); output += text; process.stdout.write(text);
    if (run.timeoutProbe && !probeReady && output.includes("RECEIVABLES_CAPACITY_TIMEOUT_PROBE_READY")) {
      probeReady = true;
      probeKill = setTimeout(() => { timedOut = true; terminationRequested = terminateWorker(child); }, 100);
    }
  });
  child.stderr?.on("data", (chunk) => { const text = String(chunk); output += text; process.stderr.write(text); });
  const overallTimeoutMs = run.timeoutProbe ? 30_000 : run.development ? 15 * 60_000 : 3 * 60 * 60_000;
  const overallTimer = setTimeout(() => { timedOut = true; terminationRequested = terminateWorker(child); }, overallTimeoutMs);
  const [code, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
  clearTimeout(overallTimer);
  if (probeKill) clearTimeout(probeKill);

  const failures: unknown[] = [];
  try { await cleanup(baseline); } catch (error) { failures.push(error); }
  try { await assertClean(baseline); } catch (error) { failures.push(error); }
  try { await prisma.$disconnect(); } catch (error) { failures.push(error); }
  if (run.timeoutProbe) {
    if (!probeReady || !timedOut || !terminationRequested) failures.push(new Error(`RECEIVABLES_CAPACITY_TIMEOUT_PROBE_DID_NOT_TERMINATE:${code}:${signal ?? "none"}`));
    if (!failures.length) console.log(`RECEIVABLES_CAPACITY_TIMEOUT_PROBE=${JSON.stringify({ result: "PASS", workerTerminated: true, databaseName, cleanup: "zero-residual" })}`);
  } else if (timedOut) {
    failures.push(new Error(`RECEIVABLES_CAPACITY_TIMEOUT:${overallTimeoutMs}`));
  } else if (code !== 0) {
    failures.push(new Error(`RECEIVABLES_CAPACITY_WORKER_FAILED:${code}:${signal ?? "none"}\n${output}`));
  }
  if (failures.length) throw new AggregateError(failures, "receivables capacity parent failed");
}

if (workerMode) await runCapacityWorker();
else await runCapacityParent();
