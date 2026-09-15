import { Prisma } from "@prisma/client";

export type DecimalValue = string | Prisma.Decimal;

export type ReceivableAmountDetail = {
  amount: DecimalValue;
  status: string;
};

type ReceivableAmount = DecimalValue | ReceivableAmountDetail;

export type ReceivablesActorCapabilities = {
  canManageAll: boolean;
  canCreateLedger: boolean;
};

export const reporterCreateFields = Object.freeze([
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
] as const);

export const reporterPatchFields = Object.freeze(["debtStatus", "collectionOwner", "collectionNotes"] as const);

export function normalizeContractNo(value: string): string {
  return value.trim();
}

export function calculateReceivableAmounts(input: {
  finalAmount: DecimalValue | null;
  writeoffAmount: DecimalValue;
  invoiceAmounts: readonly ReceivableAmount[];
  receiptAmounts: readonly ReceivableAmount[];
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
  try {
    const amount = new Prisma.Decimal(value);
    if (!amount.isFinite() || amount.decimalPlaces() > 4 || amount.abs().trunc().toFixed(0).length > 14) {
      throw new Error("DECIMAL_18_4_INVALID");
    }
    return amount;
  } catch (error) {
    if (error instanceof Error && error.message === "DECIMAL_18_4_INVALID") throw error;
    throw new Error("DECIMAL_18_4_INVALID");
  }
}

function sum(values: readonly ReceivableAmount[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((total, value) => {
    if (isAmountDetail(value) && value.status !== "active") return total;
    return total.plus(decimal(isAmountDetail(value) ? value.amount : value));
  }, new Prisma.Decimal(0));
}

function isAmountDetail(value: ReceivableAmount): value is ReceivableAmountDetail {
  return typeof value === "object" && value !== null && "amount" in value && "status" in value;
}

function format(value: Prisma.Decimal): string {
  return value.toFixed(4);
}
