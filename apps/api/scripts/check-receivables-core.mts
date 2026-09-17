import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  assertLedgerPatchAllowed,
  assertTransition,
  assertWriteoffAllowed,
  calculateReceivableAmounts,
  normalizeContractNo,
  reporterCreateFields,
  reporterCollectionFields,
  reporterPatchFields,
} from "../src/receivables-core.js";
import {
  defaultReceivablesColumnPreference,
  normalizeReceivablesColumnPreference,
  receivablesDashboardMode,
  receivablesDashboardActionModel,
  receivablesLedgerInitialFilters,
  receivablesNavigation,
  resolveReceivablesRoute,
} from "../../admin/src/receivables-types.js";
import { buildReceivablesDashboardStatements, normalizeStoredReceivablesColumnPreference } from "../src/receivables-query.js";

assert.equal(normalizeContractNo("  HT-001  "), "HT-001");
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
assert.equal(receivablesNavigation({ canEnter: true, canReadLedger: true, canCreateLedger: true, canImport: false, canExport: false, canManageAccess: false, canManageConfiguration: false } as never).some((item) => item.path === "/receivables/data"), true);
assert.equal(normalizeReceivablesColumnPreference({ order: defaultReceivablesColumnPreference.order, visible: defaultReceivablesColumnPreference.visible, frozen: defaultReceivablesColumnPreference.frozen }).widths.projectName, defaultReceivablesColumnPreference.widths.projectName);
assert.equal(defaultReceivablesColumnPreference.widths.projectName, 220);
assert.equal(defaultReceivablesColumnPreference.widths.latestProgress, 180);
assert.equal(defaultReceivablesColumnPreference.widths.balance, 128);
assert.equal(normalizeReceivablesColumnPreference({ ...defaultReceivablesColumnPreference, widths: { ...defaultReceivablesColumnPreference.widths, projectName: 99999 } }).widths.projectName, 600);
assert.equal(normalizeStoredReceivablesColumnPreference({ order: ["contractNo"], visible: ["contractNo"], frozen: ["contractNo"] }).order[0], "contractNo");
assert.equal(normalizeStoredReceivablesColumnPreference({ order: ["contractNo"], visible: ["contractNo"], frozen: ["contractNo"] }).widths.projectName, 220);
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
assert.ok("debtStatuses" in dashboardStatements);
assert.ok("creditorUnits" in dashboardStatements);

console.log("RECEIVABLES_CORE_OK");
