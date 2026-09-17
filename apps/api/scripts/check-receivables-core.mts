import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  assertLedgerPatchAllowed,
  assertTransition,
  assertWriteoffAllowed,
  calculateReceivableAmounts,
  normalizeContractNo,
  defaultCreditorUnitForContract,
  reporterCreateFields,
  reporterCollectionFields,
  reporterPatchFields,
} from "../src/receivables-core.js";
import {
  defaultReceivablesColumnPreference,
  formatReceivablesMoney,
  defaultReceivablesDashboardPreference,
  normalizeReceivablesDashboardPreference,
  normalizeReceivablesColumnPreference,
  receivablesDashboardMode,
  receivablesDashboardActionModel,
  receivablesLedgerInitialFilters,
  receivablesNavigation,
  receivablesPortalMode,
  resolveReceivablesRoute,
} from "../../admin/src/receivables-types.js";
import { buildReceivablesDashboardStatements, normalizeStoredReceivablesColumnPreference, normalizeStoredReceivablesDashboardPreference, receivablesDashboardPreferenceSchema } from "../src/receivables-query.js";
import { assertReceivableAttachmentDeletionAllowed } from "../src/receivables-files.js";

assert.doesNotThrow(() => assertReceivableAttachmentDeletionAllowed({ canManageAll: true, role: "admin" }));
assert.doesNotThrow(() => assertReceivableAttachmentDeletionAllowed({ canManageAll: true, role: "owner" }));
assert.throws(() => assertReceivableAttachmentDeletionAllowed({ canManageAll: false, role: "reporter" }), (error: Error & { code?: string }) => error.code === "RECEIVABLES_ATTACHMENT_NOT_FOUND");

assert.equal(normalizeContractNo("  HT-001  "), "HT-001");
assert.equal(defaultCreditorUnitForContract(" wh19-001 "), "山西省地球物理化学勘查院有限公司");
assert.equal(defaultCreditorUnitForContract("CH20-001"), "山西省地质测绘院有限公司");
assert.equal(defaultCreditorUnitForContract("LK20-001"), "山西省第六地质工程勘察院有限公司");
assert.equal(defaultCreditorUnitForContract("YD20-001"), "山西禹地基础工程有限公司");
assert.equal(defaultCreditorUnitForContract("QT20-001"), null);
assert.deepEqual(
  calculateReceivableAmounts({ finalAmount: "100", writeoffAmount: "0", invoiceAmounts: ["80"], receiptAmounts: ["30"] }),
  { invoicedAmount: "80.0000", receivedAmount: "30.0000", internalReceivable: "50.0000", externalReceivable: "20.0000", balance: "70.0000", anomaly: null },
);
assert.deepEqual(
  calculateReceivableAmounts({ finalAmount: new Prisma.Decimal("100"), writeoffAmount: new Prisma.Decimal("10"), invoiceAmounts: ["80.1234"], receiptAmounts: ["110.1234"] }),
  { invoicedAmount: "80.1234", receivedAmount: "110.1234", internalReceivable: "-30.0000", externalReceivable: "19.8766", balance: "-20.1234", anomaly: "writeoff_adjustment_required" },
);
assert.deepEqual(
  calculateReceivableAmounts({
    finalAmount: "100",
    writeoffAmount: "0",
    invoiceAmounts: [{ amount: "80", status: "active" }, { amount: "20", status: "voided" }],
    receiptAmounts: [{ amount: "30", status: "active" }, { amount: "10", status: "voided" }],
  }),
  { invoicedAmount: "80.0000", receivedAmount: "30.0000", internalReceivable: "50.0000", externalReceivable: "20.0000", balance: "70.0000", anomaly: null },
);
assert.throws(
  () => calculateReceivableAmounts({ finalAmount: "100.00001", writeoffAmount: "0", invoiceAmounts: [], receiptAmounts: [] }),
  /DECIMAL_18_4_INVALID/,
);
assert.throws(
  () => calculateReceivableAmounts({ finalAmount: "100000000000000", writeoffAmount: "0", invoiceAmounts: [], receiptAmounts: [] }),
  /DECIMAL_18_4_INVALID/,
);
for (const input of [
  { finalAmount: "99999999999999.9999", writeoffAmount: "0", invoiceAmounts: ["99999999999999.9999", "99999999999999.9999"], receiptAmounts: [] },
  { finalAmount: "99999999999999.9999", writeoffAmount: "0", invoiceAmounts: ["99999999999999.9999"], receiptAmounts: ["-99999999999999.9999"] },
]) {
  assert.throws(() => calculateReceivableAmounts(input), /DECIMAL_18_4_INVALID/);
}
assert.equal(calculateReceivableAmounts({ finalAmount: null, writeoffAmount: "0", invoiceAmounts: ["80"], receiptAmounts: ["30"] }).balance, null);
assert.equal(calculateReceivableAmounts({ finalAmount: null, writeoffAmount: "0", invoiceAmounts: [], receiptAmounts: [] }).anomaly, "final_amount_missing");
assert.equal(calculateReceivableAmounts({ finalAmount: "100", writeoffAmount: "0", invoiceAmounts: [], receiptAmounts: ["101"] }).anomaly, "over_received");

assert.throws(() => assertWriteoffAllowed({ previous: "0", next: "20", finalAmount: "100", receivedAmount: "90" }), /WRITEOFF_EXCEEDS_BALANCE/);
assert.doesNotThrow(() => assertWriteoffAllowed({ previous: "20", next: "10", finalAmount: "100", receivedAmount: "90" }));

assert.ok(reporterCreateFields.includes("contractNo"));
assert.ok(reporterPatchFields.includes("debtStatus"));
assert.ok(reporterCollectionFields.includes("latestProgress"));
assert.throws(() => (reporterPatchFields as unknown as string[]).push("finalAmount"), TypeError);
assert.equal(reporterPatchFields.includes("finalAmount" as never), false);
assert.throws(() => assertLedgerPatchAllowed({ canManageAll: false, canCreateLedger: true }, null, { finalAmount: "100" }), /REPORTER_FIELD_NOT_ALLOWED/);
assert.throws(() => assertLedgerPatchAllowed({ canManageAll: false, canCreateLedger: false }, null, { contractNo: "HT-001" }), /REPORTER_CREATE_NOT_ALLOWED/);
assert.throws(() => assertLedgerPatchAllowed({ canManageAll: false, canCreateLedger: true }, { id: "ledger-1" }, { contractNo: "HT-002" }), /REPORTER_FIELD_NOT_ALLOWED/);
assert.doesNotThrow(() => assertLedgerPatchAllowed({ canManageAll: true, canCreateLedger: false }, { id: "ledger-1" }, { finalAmount: "100" }));
assert.throws(
  () => assertLedgerPatchAllowed({ canManageAll: false, canCreateLedger: false, canMaintainCollection: false }, { id: "ledger-1" }, { latestProgress: "已对账" }),
  /REPORTER_FIELD_NOT_ALLOWED/,
);
assert.doesNotThrow(() => assertLedgerPatchAllowed(
  { canManageAll: false, canCreateLedger: false, canMaintainCollection: true },
  { id: "ledger-1" },
  { projectStatus: "完工", dunningDate: "2026-09-16", latestProgress: "已对账" },
));

assert.throws(() => assertTransition("voided", "update"), /VOIDED_FACT_IMMUTABLE/);
assert.doesNotThrow(() => assertTransition("active", "update"));

assert.equal(resolveReceivablesRoute("/receivables/data"), "data");
assert.equal(receivablesPortalMode({ state: "unconfigured", canEnter: false, canRecover: true }), "recover");
assert.deepEqual(receivablesNavigation({ canRecover: true } as never), [{ path: "/receivables", label: "初始化状态" }]);
assert.equal(receivablesNavigation({ canEnter: true, canReadLedger: true, canCreateLedger: true, canImport: false, canExport: false, canManageAccess: false, canManageConfiguration: false } as never).some((item) => item.path === "/receivables/data"), true);
assert.equal(normalizeReceivablesColumnPreference({ order: defaultReceivablesColumnPreference.order, visible: defaultReceivablesColumnPreference.visible, frozen: defaultReceivablesColumnPreference.frozen }).widths.projectName, defaultReceivablesColumnPreference.widths.projectName);
assert.equal(defaultReceivablesColumnPreference.widths.projectName, 200);
assert.equal(defaultReceivablesColumnPreference.widths.latestProgress, 180);
assert.equal(defaultReceivablesColumnPreference.widths.balance, 96);
assert.equal(normalizeReceivablesColumnPreference({ ...defaultReceivablesColumnPreference, widths: { ...defaultReceivablesColumnPreference.widths, projectName: 99999 } }).widths.projectName, 600);
assert.equal(normalizeStoredReceivablesColumnPreference({ order: ["contractNo"], visible: ["contractNo"], frozen: ["contractNo"] }).order[0], "contractNo");
assert.equal(normalizeStoredReceivablesColumnPreference({ order: ["contractNo"], visible: ["contractNo"], frozen: ["contractNo"] }).widths.projectName, 200);
assert.equal(defaultReceivablesColumnPreference.moneyDecimals, 2);
assert.equal(normalizeReceivablesColumnPreference({ ...defaultReceivablesColumnPreference, moneyDecimals: 4 }).moneyDecimals, 4);
assert.equal(normalizeReceivablesColumnPreference({ ...defaultReceivablesColumnPreference, moneyDecimals: 3 }).moneyDecimals, 2);
assert.equal(normalizeStoredReceivablesColumnPreference({ order: ["contractNo"], visible: ["contractNo"], frozen: ["contractNo"], moneyDecimals: 0 }).moneyDecimals, 0);
assert.equal(formatReceivablesMoney("145.0000"), "145");
assert.equal(formatReceivablesMoney("145.2000"), "145.20");
assert.equal(formatReceivablesMoney("1234.5678", 0), "1,235");
assert.equal(formatReceivablesMoney("1234.5678", 4), "1,234.5678");
assert.deepEqual(normalizeReceivablesDashboardPreference([{ id: "balance", w: 99, h: 0, title: "  我的应收  " }, { id: "balance", w: 4, h: 3 }, { id: "bad" }]), [{ id: "balance", w: 12, h: 2, title: "我的应收" }]);
assert.deepEqual(normalizeReceivablesDashboardPreference(null), defaultReceivablesDashboardPreference);
assert.deepEqual(normalizeStoredReceivablesDashboardPreference([{ id: "balance", w: 99, h: 0, title: "  我的应收  " }, { id: "balance", w: 4, h: 3 }, { id: "bad" }]), [{ id: "balance", w: 12, h: 2, title: "我的应收" }]);
assert.equal(receivablesDashboardPreferenceSchema.safeParse([{ id: "bad", w: 4, h: 3 }]).success, false);
assert.equal(receivablesDashboardMode({ canManageMoney: true, canMaintainCollection: true } as never).kind, "finance");
assert.equal(receivablesDashboardMode({ canManageMoney: false, canMaintainCollection: true } as never).kind, "collection");
assert.equal(receivablesDashboardMode({ canManageMoney: false, canMaintainCollection: false } as never).kind, "overview");
assert.deepEqual(receivablesDashboardActionModel("finance"), { title: "需要处理", kind: "anomalies" });
assert.deepEqual(receivablesDashboardActionModel("collection"), { title: "催收工作", kind: "collection" });
assert.deepEqual(receivablesDashboardActionModel("overview"), { title: "风险关注", kind: "anomalies" });
assert.deepEqual(receivablesLedgerInitialFilters("?status=voided&settlement=all&anomaly=over_received&debtStatus=诉讼&creditorUnit=一院"), {
  status: "voided",
  settlement: "all",
  anomaly: "over_received",
  debtStatus: "诉讼",
  creditorUnit: "一院",
});
assert.deepEqual(receivablesLedgerInitialFilters("?status=bad&settlement=bad&anomaly=bad"), {
  status: "active",
  settlement: "unsettled",
  anomaly: undefined,
  debtStatus: undefined,
  creditorUnit: undefined,
});
const dashboardStatements = buildReceivablesDashboardStatements({ filters: {}, readDepartmentIds: null } as never);
assert.match((dashboardStatements.totals as Prisma.Sql).strings.join(" "), /show_receivables/, "hidden departments stay out of ledger and dashboard queries");
assert.ok("debtStatuses" in dashboardStatements);
assert.ok("creditorUnits" in dashboardStatements);
assert.ok("monthlyCashflow" in dashboardStatements);
assert.ok("departmentBalances" in dashboardStatements);
assert.ok("customerBalances" in dashboardStatements);
assert.ok("customerTypes" in dashboardStatements);
assert.ok("collectionFollowups" in dashboardStatements);
assert.deepEqual(
  normalizeReceivablesDashboardPreference([
    { id: "monthlyCashflow", w: 12, h: 4 },
    { id: "collectionFollowups", w: 12, h: 6 },
  ]),
  [
    { id: "monthlyCashflow", w: 12, h: 4 },
    { id: "collectionFollowups", w: 12, h: 6 },
  ],
);

console.log("RECEIVABLES_CORE_OK");
