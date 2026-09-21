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
  canEditBaseInfo?: boolean;
  canMaintainCollection?: boolean;
  canUploadAttachments?: boolean;
  editableFields?: readonly string[];
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
  "dunningDate",
  "communicationMethod",
  "counterpartyFeedback",
  "latestProgress",
  "nextPlan",
] as const);

export const reporterPatchFields = Object.freeze(["debtStatus", "collectionOwner", "collectionNotes"] as const);
export const reporterCollectionFields = Object.freeze([
  "projectStatus", "dunningDate", "communicationMethod", "counterpartyFeedback", "latestProgress", "nextPlan",
] as const);

export function normalizeContractNo(value: string): string {
  return value.trim();
}

const creditorUnitsByPrefix: Record<string, string> = {
  WH: "山西省地球物理化学勘查院有限公司",
  CH: "山西省地质测绘院有限公司",
  LK: "山西省第六地质工程勘察院有限公司",
  YD: "山西禹地基础工程有限公司",
};

export function defaultCreditorUnitForContract(contractNo: string): string | null {
  return creditorUnitsByPrefix[normalizeContractNo(contractNo).slice(0, 2).toUpperCase()] ?? null;
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

  const capabilityFields = new Set<string>();
  if (actor.canEditBaseInfo) reporterCreateFields.forEach((field) => capabilityFields.add(field));
  if (actor.canMaintainCollection) [...reporterPatchFields, ...reporterCollectionFields].forEach((field) => capabilityFields.add(field));
  if (current === null && actor.canCreateLedger) {
    capabilityFields.add("financeDepartmentId");
    capabilityFields.add("contractNo");
  }
  const individuallyGranted = new Set(actor.editableFields ?? []);
  const allowedFields = [...capabilityFields].filter((field) =>
    field === "financeDepartmentId" || field === "contractNo" || individuallyGranted.has(field),
  );
  for (const field of Object.keys(patch)) {
    if (!allowedFields.includes(field as never)) throw new Error("REPORTER_FIELD_NOT_ALLOWED");
  }
}

export function assertTransition(currentStatus: string, action: string): void {
  if (currentStatus === "voided") throw new Error(`VOIDED_FACT_IMMUTABLE:${action}`);
}

function decimal(value: DecimalValue): Prisma.Decimal {
  try {
    return assertDecimal18_4(new Prisma.Decimal(value));
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
  return assertDecimal18_4(value).toFixed(4);
}

function assertDecimal18_4(value: Prisma.Decimal): Prisma.Decimal {
  if (!value.isFinite() || value.decimalPlaces() > 4 || value.abs().trunc().toFixed(0).length > 14) {
    throw new Error("DECIMAL_18_4_INVALID");
  }
  return value;
}
