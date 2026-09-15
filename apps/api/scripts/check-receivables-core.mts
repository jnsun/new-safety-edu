import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  assertLedgerPatchAllowed,
  assertTransition,
  assertWriteoffAllowed,
  calculateReceivableAmounts,
  normalizeContractNo,
  reporterCreateFields,
  reporterPatchFields,
} from "../src/receivables-core.js";

assert.equal(normalizeContractNo("  HT-001  "), "HT-001");
assert.deepEqual(
  calculateReceivableAmounts({ finalAmount: "100", writeoffAmount: "0", invoiceAmounts: ["80"], receiptAmounts: ["30"] }),
  { invoicedAmount: "80.0000", receivedAmount: "30.0000", internalReceivable: "50.0000", externalReceivable: "20.0000", balance: "70.0000", anomaly: null },
);
assert.deepEqual(
  calculateReceivableAmounts({ finalAmount: new Prisma.Decimal("100"), writeoffAmount: new Prisma.Decimal("10"), invoiceAmounts: ["80.1234"], receiptAmounts: ["110.1234"] }),
  { invoicedAmount: "80.1234", receivedAmount: "110.1234", internalReceivable: "-30.0000", externalReceivable: "19.8766", balance: "-20.1234", anomaly: "writeoff_adjustment_required" },
);
assert.equal(calculateReceivableAmounts({ finalAmount: null, writeoffAmount: "0", invoiceAmounts: ["80"], receiptAmounts: ["30"] }).balance, null);
assert.equal(calculateReceivableAmounts({ finalAmount: null, writeoffAmount: "0", invoiceAmounts: [], receiptAmounts: [] }).anomaly, "final_amount_missing");
assert.equal(calculateReceivableAmounts({ finalAmount: "100", writeoffAmount: "0", invoiceAmounts: [], receiptAmounts: ["101"] }).anomaly, "over_received");

assert.throws(() => assertWriteoffAllowed({ previous: "0", next: "20", finalAmount: "100", receivedAmount: "90" }), /WRITEOFF_EXCEEDS_BALANCE/);
assert.doesNotThrow(() => assertWriteoffAllowed({ previous: "20", next: "10", finalAmount: "100", receivedAmount: "90" }));

assert.ok(reporterCreateFields.includes("contractNo"));
assert.ok(reporterPatchFields.includes("debtStatus"));
assert.throws(() => assertLedgerPatchAllowed({ canManageAll: false, canCreateLedger: true }, null, { finalAmount: "100" }), /REPORTER_FIELD_NOT_ALLOWED/);
assert.throws(() => assertLedgerPatchAllowed({ canManageAll: false, canCreateLedger: false }, null, { contractNo: "HT-001" }), /REPORTER_CREATE_NOT_ALLOWED/);
assert.throws(() => assertLedgerPatchAllowed({ canManageAll: false, canCreateLedger: true }, { id: "ledger-1" }, { contractNo: "HT-002" }), /REPORTER_FIELD_NOT_ALLOWED/);
assert.doesNotThrow(() => assertLedgerPatchAllowed({ canManageAll: true, canCreateLedger: false }, { id: "ledger-1" }, { finalAmount: "100" }));

assert.throws(() => assertTransition("voided", "update"), /VOIDED_FACT_IMMUTABLE/);
assert.doesNotThrow(() => assertTransition("active", "update"));

console.log("RECEIVABLES_CORE_OK");
