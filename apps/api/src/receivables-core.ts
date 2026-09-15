import { Prisma } from "@prisma/client";

export type DecimalValue = string | Prisma.Decimal;

export type ReceivablesActorCapabilities = {
  canManageAll: boolean;
  canCreateLedger: boolean;
};

export const reporterCreateFields = [
  "financeDepartmentId",
  "contractNo",
  "projectName",
  "customerName",
  "customerType",
  "creditorUnit",
  "workNature",
  "sector",
  "projectStatus",
  "settlementMethod",
  "debtStatus",
  "collectionOwner",
  "collectionNotes",
] as const;

export const reporterPatchFields = ["debtStatus", "collectionOwner", "collectionNotes"] as const;

export function normalizeContractNo(value: string): string {
  return value.trim();
}

export function calculateReceivableAmounts(input: {
  finalAmount: DecimalValue | null;
  writeoffAmount: DecimalValue;
  invoiceAmounts: readonly DecimalValue[];
  receiptAmounts: readonly DecimalValue[];
}): {
  invoicedAmount: string;
  receivedAmount: string;
  internalReceivable: string;
  externalReceivable: string | null;
  balance: string | null;
  anomaly: "over_received" | "writeoff_adjustment_required" | "final_amount_missing" | null;
} {
  const invoiced = sum(input.invoiceAmounts);
  const received = sum(input.receiptAmounts);
  const internalReceivable = invoiced.minus(received);

  if (input.finalAmount === null) {
    return {
      invoicedAmount: format(invoiced),
      receivedAmount: format(received),
      internalReceivable: format(internalReceivable),
      externalReceivable: null,
      balance: null,
      anomaly: "final_amount_missing",
    };
  }

  const finalAmount = decimal(input.finalAmount);
  const writeoff = decimal(input.writeoffAmount);
  const balance = finalAmount.minus(received).minus(writeoff);
  return {
    invoicedAmount: format(invoiced),
    receivedAmount: format(received),
    internalReceivable: format(internalReceivable),
    externalReceivable: format(finalAmount.minus(invoiced)),
    balance: format(balance),
    anomaly: balance.isNegative() ? (writeoff.gt(0) ? "writeoff_adjustment_required" : "over_received") : null,
  };
}

export function assertWriteoffAllowed(input: {
  previous: DecimalValue;
  next: DecimalValue;
  finalAmount: DecimalValue | null;
  receivedAmount: DecimalValue;
}): void {
  const previous = decimal(input.previous);
  const next = decimal(input.next);
  if (next.gt(previous) && (input.finalAmount === null || next.gt(decimal(input.finalAmount).minus(decimal(input.receivedAmount))))) {
    throw new Error("WRITEOFF_EXCEEDS_BALANCE");
  }
}

export function assertLedgerPatchAllowed(
  actor: ReceivablesActorCapabilities,
  current: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): void {
  if (actor.canManageAll) return;
  if (current === null && !actor.canCreateLedger) throw new Error("REPORTER_CREATE_NOT_ALLOWED");

  const allowedFields = current === null ? reporterCreateFields : reporterPatchFields;
  for (const field of Object.keys(patch)) {
    if (!allowedFields.includes(field as never)) throw new Error("REPORTER_FIELD_NOT_ALLOWED");
  }
}

export function assertTransition(currentStatus: string, action: string): void {
  if (currentStatus === "voided") throw new Error(`VOIDED_FACT_IMMUTABLE:${action}`);
}

function decimal(value: DecimalValue): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function sum(values: readonly DecimalValue[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((total, value) => total.plus(decimal(value)), new Prisma.Decimal(0));
}

function format(value: Prisma.Decimal): string {
  return value.toFixed(4);
}
