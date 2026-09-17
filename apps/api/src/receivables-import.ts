import { createHash, randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import type { Principal } from "./auth.js";
import { prisma } from "./db.js";
import { normalizeContractNo } from "./receivables-core.js";
import { requireReceivables, resolveReceivablesAccess, type ReceivablesAccess } from "./receivables-access.js";
import { receivableAttachmentStoragePath, removeReceivableAttachmentFiles, storeReceivableAttachment, validateReceivableAttachment, validateReceivableWorkbookShape } from "./receivables-files.js";
import { writeCriticalAudit } from "./transaction-audit.js";

export type ReceivablesImportReference = {
  departments: readonly { id: string; name: string; code: string | null; active: boolean }[];
  dictionaryOptions: readonly { category: string; value: string; active: boolean }[];
  ledgers: readonly { id: string; contractNoNormalized: string; revision: number; financeDepartmentId: string }[];
};

export type ReceivablesImportIssue = {
  code: string;
  message: string;
  rowNumber?: number;
  field?: string;
  column?: string;
};

export type ReceivablesImportData = {
  presentFields: string[];
  financeDepartmentId: string | null;
  contractNo: string | null;
  projectName: string | null;
  customerName: string | null;
  customerType: string | null;
  creditorUnit: string | null;
  workNature: string | null;
  sector: string | null;
  projectStatus: string | null;
  settlementMethod: string | null;
  contractAmount: string | null;
  finalAmount: string | null;
  openingChargeDate: string | null;
  debtStatus: string | null;
  collectionOwner: string | null;
  collectionNotes: string | null;
  dunningDate: string | null;
  communicationMethod: string | null;
  counterpartyFeedback: string | null;
  latestProgress: string | null;
  nextPlan: string | null;
  openingInvoiceAmount: string | null;
  openingInvoiceDate: string | null;
  openingReceiptAmount: string | null;
  openingReceiptDate: string | null;
};
export type ReceivablesImportField = Exclude<keyof ReceivablesImportData, "presentFields">;
export type ReceivablesImportColumnMappings = Partial<Record<string, ReceivablesImportField>>;
type ReceivablesImportParseOptions = { openingBalanceDate?: string | null | undefined; columnMappings?: ReceivablesImportColumnMappings | undefined };

export type ReceivablesImportParsedRow = {
  rowNumber: number;
  normalizedData: ReceivablesImportData;
  errors: ReceivablesImportIssue[];
  ledgerId: string | null;
  targetRevision: number | null;
  allowedDecisions: readonly ("create" | "skip" | "update")[];
  warnings: ReceivablesImportIssue[];
};

const aliases: Record<ReceivablesImportField, readonly string[]> = {
  financeDepartmentId: ["财务归属部门", "归属部门", "finance_department", "financeDepartment"],
  contractNo: ["合同编号", "合同号", "contract_no", "contractNo"],
  projectName: ["项目名称", "project_name", "projectName"],
  customerName: ["客户名称", "债务单位", "customer_name", "customerName"],
  customerType: ["客户属性", "customer_type", "customerType"],
  creditorUnit: ["债权单位", "单位", "creditor_unit", "creditorUnit"],
  workNature: ["工作性质", "work_nature", "workNature"],
  sector: ["八大板块", "板块", "sector"],
  projectStatus: ["项目状态", "项目进度", "project_status", "projectStatus"],
  settlementMethod: ["决算方式", "settlement_method", "settlementMethod"],
  contractAmount: ["合同金额", "contract_amount", "contractAmount"],
  finalAmount: ["决算金额", "final_amount", "finalAmount"],
  openingChargeDate: ["最新挂账时间", "挂账日期", "opening_charge_date", "openingChargeDate"],
  debtStatus: ["债权状态", "debt_status", "debtStatus"],
  collectionOwner: ["清收责任人", "collection_owner", "collectionOwner"],
  collectionNotes: ["催收备注", "collection_notes", "collectionNotes"],
  dunningDate: ["最新催收时间", "催收时间", "催收日期", "询证日期", "dunning_date", "dunningDate"],
  communicationMethod: ["沟通方式", "comm_method", "communicationMethod"],
  counterpartyFeedback: ["对方反馈", "反馈", "feedback", "counterpartyFeedback"],
  latestProgress: ["最新进展", "进展", "latest_progress", "latestProgress"],
  nextPlan: ["下一步计划", "计划", "next_plan", "nextPlan"],
  openingInvoiceAmount: ["开票金额", "期初开票金额", "已开发票", "opening_invoice_amount", "openingInvoiceAmount"],
  openingInvoiceDate: ["开票日期", "期初开票日期", "opening_invoice_date", "openingInvoiceDate"],
  openingReceiptAmount: ["到账金额", "回款金额", "期初到账金额", "已到账收入", "opening_receipt_amount", "openingReceiptAmount"],
  openingReceiptDate: ["到账日期", "回款日期", "期初到账日期", "opening_receipt_date", "openingReceiptDate"],
};

const ignoredLegacyColumns = new Set(["决算情况", "账内应收", "账外应收", "应收合计"]);
export const receivablesImportFields = Object.keys(aliases) as ReceivablesImportField[];

const dictionaryCategories: Partial<Record<keyof ReceivablesImportData, string>> = {
  projectStatus: "project_status",
  settlementMethod: "final_method",
  debtStatus: "debt_status",
  customerType: "client_attr",
  creditorUnit: "unit",
  workNature: "work_nature",
  sector: "sector",
  communicationMethod: "comm_method",
  counterpartyFeedback: "feedback",
  latestProgress: "progress_note",
  nextPlan: "next_plan",
};

const textLimits: Partial<Record<keyof ReceivablesImportData, number>> = {
  contractNo: 160,
  projectName: 240,
  customerName: 240,
  customerType: 120,
  creditorUnit: 120,
  workNature: 160,
  sector: 160,
  projectStatus: 120,
  settlementMethod: 120,
  debtStatus: 120,
  collectionOwner: 120,
  collectionNotes: 10_000,
  communicationMethod: 120,
  counterpartyFeedback: 240,
  latestProgress: 240,
  nextPlan: 240,
};

const amountFields = ["contractAmount", "finalAmount", "openingInvoiceAmount", "openingReceiptAmount"] as const;
const dateFields = ["openingChargeDate", "dunningDate", "openingInvoiceDate", "openingReceiptDate"] as const;
const dictionaryValueAliases: Partial<Record<ReceivablesImportField, Record<string, string>>> = {
  projectStatus: { 作废: "取消或作废" },
};
const issue = (code: string, message: string, extra: Omit<ReceivablesImportIssue, "code" | "message"> = {}): ReceivablesImportIssue => ({ code, message, ...extra });

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (typeof value === "object" && "result" in value && (typeof value.result === "string" || typeof value.result === "number")) return String(value.result).trim();
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) return value.richText.map(({ text }) => text).join("").trim();
  return cell.text.trim();
}

function formulaResultMissing(cell: ExcelJS.Cell): boolean {
  const value = cell.value;
  return !!value && typeof value === "object" && "formula" in value && (!("result" in value) || value.result === null || value.result === undefined || value.result === "");
}

function decimal(value: string, rowNumber: number, field: string, errors: ReceivablesImportIssue[]): string | null {
  if (!value) return null;
  try {
    const parsed = new Prisma.Decimal(value);
    if (!parsed.isFinite() || parsed.isNegative() || parsed.decimalPlaces() > 4 || parsed.trunc().toFixed(0).length > 14) throw new Error();
    return parsed.toFixed(4);
  } catch {
    errors.push(issue("AMOUNT_INVALID", "金额必须为非负 Decimal(18,4)", { rowNumber, field }));
    return null;
  }
}

function dateOnly(value: string, rowNumber: number, field: string, errors: ReceivablesImportIssue[]): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push(issue("DATE_INVALID", "日期必须为 YYYY-MM-DD", { rowNumber, field }));
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    errors.push(issue("DATE_INVALID", "日期不存在", { rowNumber, field }));
    return null;
  }
  return value;
}

export function inspectReceivablesImportWorkbook(workbook: ExcelJS.Workbook) {
  validateReceivableWorkbookShape(workbook);
  const worksheet = workbook.worksheets[0]!;
  const headerRow = worksheet.getRow(1);
  const knownHeaders = new Set(Object.values(aliases).flat());
  const unknownColumns: Array<{ name: string; samples: string[] }> = [];
  const recognizedFields = new Set<ReceivablesImportField>();
  for (let column = 1; column <= Math.max(headerRow.cellCount, headerRow.actualCellCount); column += 1) {
    const name = cellText(headerRow.getCell(column));
    if (!name) continue;
    const field = (Object.entries(aliases) as Array<[ReceivablesImportField, readonly string[]]>).find(([, names]) => names.includes(name))?.[0];
    if (field) { recognizedFields.add(field); continue; }
    if (knownHeaders.has(name) || ignoredLegacyColumns.has(name)) continue;
    const samples = [...new Set(Array.from({ length: Math.min(5, Math.max(0, worksheet.rowCount - 1)) }, (_, index) => cellText(worksheet.getRow(index + 2).getCell(column))).filter(Boolean))].slice(0, 3);
    unknownColumns.push({ name, samples });
  }
  return { unknownColumns, recognizedFields: [...recognizedFields] };
}

export function parseReceivablesImportWorkbook(workbook: ExcelJS.Workbook, references: ReceivablesImportReference, options: ReceivablesImportParseOptions = {}) {
  validateReceivableWorkbookShape(workbook);
  const worksheet = workbook.worksheets[0]!;
  const headerRow = worksheet.getRow(1);
  const aliasToField = new Map<string, keyof ReceivablesImportData>();
  for (const [field, names] of Object.entries(aliases) as Array<[ReceivablesImportField, readonly string[]]>) {
    for (const name of names) aliasToField.set(name, field);
  }
  const columns = new Map<keyof ReceivablesImportData, number>();
  const errors: ReceivablesImportIssue[] = [];
  const warnings: ReceivablesImportIssue[] = [];
  for (let column = 1; column <= Math.max(headerRow.cellCount, headerRow.actualCellCount); column += 1) {
    const name = cellText(headerRow.getCell(column));
    if (!name) continue;
    const field = aliasToField.get(name) ?? options.columnMappings?.[name];
    if (!field) {
      if (ignoredLegacyColumns.has(name)) {
        warnings.push(issue("IGNORED_CALCULATED_COLUMN", "该列由系统重新计算或不属于导入事实，已忽略", { column: name }));
        continue;
      }
      warnings.push(issue("UNKNOWN_COLUMN", "未知列将被忽略", { column: name }));
      continue;
    }
    if (columns.has(field)) errors.push(issue("AMBIGUOUS_COLUMN", "多个列映射到同一字段", { field, column: name }));
    else columns.set(field, column);
  }
  for (const field of ["financeDepartmentId", "contractNo"] as const) {
    if (!columns.has(field)) errors.push(issue("REQUIRED_COLUMN_MISSING", "缺少必填列", { field }));
  }

  const departmentByName = new Map<string, ReceivablesImportReference["departments"][number][]>();
  for (const department of references.departments) {
    for (const key of [department.name.trim(), ...(department.code ? [department.code.trim()] : [])]) {
      const matches = departmentByName.get(key) ?? [];
      if (!matches.some(({ id }) => id === department.id)) departmentByName.set(key, [...matches, department]);
    }
  }
  const dictionaries = new Map<string, Map<string, boolean>>();
  for (const option of references.dictionaryOptions) {
    const values = dictionaries.get(option.category) ?? new Map<string, boolean>();
    values.set(option.value.trim(), option.active);
    dictionaries.set(option.category, values);
  }
  const ledgerByContract = new Map(references.ledgers.map((ledger) => [ledger.contractNoNormalized, ledger]));
  const rows: ReceivablesImportParsedRow[] = [];
  let openingBalanceDatePending = false;

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (!columns.size || [...columns.values()].every((column) => !cellText(row.getCell(column)))) continue;
    const rowErrors: ReceivablesImportIssue[] = [];
    const raw: Partial<Record<keyof ReceivablesImportData, string>> = {};
    for (const [field, column] of columns) {
      const cell = row.getCell(column);
      if (formulaResultMissing(cell)) rowErrors.push(issue("FORMULA_RESULT_MISSING", "公式单元格没有已计算结果，请先在 Excel 中重新计算并保存", { rowNumber, field }));
      raw[field] = cellText(cell);
    }
    const normalizedData = { ...Object.fromEntries(Object.keys(aliases).map((field) => [field, null])), presentFields: [...columns.keys()] } as ReceivablesImportData;
    for (const field of Object.keys(aliases) as ReceivablesImportField[]) {
      const sourceValue = raw[field]?.trim() ?? "";
      const value = dictionaryValueAliases[field]?.[sourceValue] ?? sourceValue;
      if (!value) continue;
      if ((amountFields as readonly string[]).includes(field)) normalizedData[field] = decimal(value, rowNumber, field, rowErrors) as never;
      else if ((dateFields as readonly string[]).includes(field)) normalizedData[field] = dateOnly(value, rowNumber, field, rowErrors) as never;
      else normalizedData[field] = value as never;
      const limit = textLimits[field];
      if (limit && value.length > limit) rowErrors.push(issue("FIELD_TOO_LONG", `字段长度不得超过 ${limit}`, { rowNumber, field }));
    }
    const contractNo = normalizeContractNo(raw.contractNo ?? "");
    normalizedData.contractNo = contractNo || null;
    if (!contractNo) rowErrors.push(issue("CONTRACT_NO_REQUIRED", "合同编号不能为空", { rowNumber, field: "contractNo" }));
    const target = contractNo ? ledgerByContract.get(contractNo) : undefined;

    const departmentName = raw.financeDepartmentId?.trim() ?? "";
    const departmentCandidates = departmentByName.get(departmentName) ?? [];
    const department = departmentCandidates.length === 1 ? departmentCandidates[0] : undefined;
    normalizedData.financeDepartmentId = department?.id ?? null;
    if (departmentCandidates.length > 1) rowErrors.push(issue("DEPARTMENT_AMBIGUOUS", "财务归属部门名称或编码映射不唯一", { rowNumber, field: "financeDepartmentId" }));
    else if (!department) rowErrors.push(issue("DEPARTMENT_NOT_FOUND", "财务归属部门不存在", { rowNumber, field: "financeDepartmentId" }));
    else if (!department.active && target?.financeDepartmentId !== department.id) rowErrors.push(issue("DEPARTMENT_INACTIVE", "财务归属部门已停用", { rowNumber, field: "financeDepartmentId" }));

    for (const [field, category] of Object.entries(dictionaryCategories) as Array<[ReceivablesImportField, string]>) {
      const value = normalizedData[field];
      if (value && dictionaries.get(category)?.get(value) !== true) rowErrors.push(issue("DICTIONARY_VALUE_INVALID", "字典值不存在或已停用", { rowNumber, field }));
    }
    if (!normalizedData.finalAmount && normalizedData.contractAmount && !["工作量", "按工作量结算"].includes(normalizedData.settlementMethod ?? "")) {
      normalizedData.finalAmount = normalizedData.contractAmount;
    }
    const amountFieldsPresent = ["settlementMethod", "contractAmount", "finalAmount"].some((field) => normalizedData.presentFields.includes(field));
    if ((!target || amountFieldsPresent) && normalizedData.contractAmount === null && normalizedData.finalAmount === null && !["工作量", "按工作量结算"].includes(normalizedData.settlementMethod ?? "")) {
      rowErrors.push(issue("FINAL_AMOUNT_REQUIRED", "非工作量结算必须提供合同金额或决算金额", { rowNumber, field: "finalAmount" }));
    }
    let resolvedOpeningBalanceDate: string | null | undefined;
    const openingBalanceDate = () => {
      if (resolvedOpeningBalanceDate === undefined) resolvedOpeningBalanceDate = options.openingBalanceDate ? dateOnly(options.openingBalanceDate, rowNumber, "openingBalanceDate", rowErrors) : null;
      return resolvedOpeningBalanceDate;
    };
    if (normalizedData.openingInvoiceAmount && new Prisma.Decimal(normalizedData.openingInvoiceAmount).gt(0) && !normalizedData.openingInvoiceDate) {
      if (options.openingBalanceDate) normalizedData.openingInvoiceDate = openingBalanceDate();
      else if (!target) openingBalanceDatePending = true;
    }
    if (normalizedData.openingReceiptAmount && new Prisma.Decimal(normalizedData.openingReceiptAmount).gt(0) && !normalizedData.openingReceiptDate) {
      if (options.openingBalanceDate) normalizedData.openingReceiptDate = openingBalanceDate();
      else if (!target) openingBalanceDatePending = true;
    }
    const openingTotals = [normalizedData.openingInvoiceAmount, normalizedData.openingReceiptAmount].some((amount) => amount !== null && new Prisma.Decimal(amount).gt(0));
    const rowWarnings = target && openingTotals ? [issue("EXISTING_OPENING_TOTALS_SKIP_ONLY", "已有合同含非零期初开票或到账金额，只能跳过", { rowNumber })] : [];
    rows.push({ rowNumber, normalizedData, errors: rowErrors, ledgerId: target?.id ?? null, targetRevision: target?.revision ?? null, allowedDecisions: target ? openingTotals ? ["skip"] : ["skip", "update"] : ["create"], warnings: rowWarnings });
  }
  if (openingBalanceDatePending) warnings.push(issue("OPENING_BALANCE_DATE_PENDING", "检测到期初开票或到账金额，请在最终应用前填写期初余额日期", { field: "openingBalanceDate" }));

  const contracts = new Map<string, ReceivablesImportParsedRow[]>();
  for (const row of rows) {
    const contractNo = row.normalizedData.contractNo;
    if (contractNo) contracts.set(contractNo, [...(contracts.get(contractNo) ?? []), row]);
  }
  for (const duplicateRows of contracts.values()) {
    if (duplicateRows.length < 2) continue;
    for (const row of duplicateRows) row.errors.push(issue("DUPLICATE_CONTRACT_IN_FILE", "同一文件合同编号重复", { rowNumber: row.rowNumber, field: "contractNo" }));
  }
  errors.push(...rows.flatMap((row) => row.errors));
  warnings.push(...rows.flatMap((row) => row.warnings));
  return { rows, errors, warnings };
}

export type ReceivablesImportContext = { principal: Principal; requestId: string };
export type ReceivablesImportFile = { originalName: string; mimeType: string; content: Buffer };
export type ReceivablesImportEnvironment = { uploadRoot: string; openingBalanceDate?: string | null | undefined; columnMappings?: ReceivablesImportColumnMappings | undefined };

export function receivablesImportNeedsOpeningBalanceDate(rows: readonly { ledgerId: string | null; normalizedData: unknown }[]) {
  return rows.some((item) => {
    if (item.ledgerId) return false;
    const data = item.normalizedData as ReceivablesImportData;
    return (!!data.openingInvoiceAmount && new Prisma.Decimal(data.openingInvoiceAmount).gt(0) && !data.openingInvoiceDate)
      || (!!data.openingReceiptAmount && new Prisma.Decimal(data.openingReceiptAmount).gt(0) && !data.openingReceiptDate);
  });
}
export type ReceivablesImportDecisions = { revision: number; rows: readonly { rowNumber: number; decision: "skip" | "update" }[] };
type Tx = Prisma.TransactionClient;
const setupLockKey = 8_645_136_501n;
const httpError = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const batchNotFound = () => httpError(404, "RECEIVABLES_IMPORT_NOT_FOUND", "导入批次不存在");
const conflict = (code = "REVISION_CONFLICT", message = "导入批次或目标版本已变化") => httpError(409, code, message);
const invalid = (code: string, message: string) => httpError(422, code, message);
const snapshot = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
const stableJson = (value: unknown): string => value && typeof value === "object"
  ? Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`
  : JSON.stringify(value);
const importStorageKey = () => `receivables/imports/${new Date().getUTCFullYear()}/${randomUUID()}.xlsx`;
const auditScope = (access: ReceivablesAccess) => ({ actorRole: access.role, actorScopeType: "receivables" });
export const receivablesImportBatchTransactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 10_000,
  timeout: 120_000,
} as const;

export const receivablesImportBatchParseOptions = (batch: { openingBalanceDate: Date | null; columnMappings?: unknown }) => ({
  ...(batch.openingBalanceDate ? { openingBalanceDate: batch.openingBalanceDate.toISOString().slice(0, 10) } : {}),
  ...(batch.columnMappings && typeof batch.columnMappings === "object" && !Array.isArray(batch.columnMappings) && Object.keys(batch.columnMappings).length ? { columnMappings: batch.columnMappings as ReceivablesImportColumnMappings } : {}),
});

async function references(db: Tx | typeof prisma): Promise<ReceivablesImportReference> {
  const [departments, dictionaryOptions, ledgers] = await Promise.all([
    db.receivableDepartment.findMany({ select: { id: true, name: true, code: true, active: true } }),
    db.receivableDictionaryOption.findMany({ select: { category: true, value: true, active: true } }),
    db.receivableLedger.findMany({ select: { id: true, contractNoNormalized: true, revision: true, financeDepartmentId: true } }),
  ]);
  return { departments, dictionaryOptions, ledgers };
}

async function loadWorkbook(content: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer);
  return workbook;
}

export async function authorizeReceivablesImport(principal: Principal) {
  requireReceivables(await resolveReceivablesAccess(principal), "import");
}

export async function inspectReceivablesImport(context: ReceivablesImportContext, file: ReceivablesImportFile) {
  await authorizeReceivablesImport(context.principal);
  if (file.mimeType !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || !file.originalName.toLowerCase().endsWith(".xlsx")) throw httpError(400, "INVALID_IMPORT_FILE_TYPE", "导入仅支持 XLSX 文件");
  await validateReceivableAttachment(file.originalName, file.mimeType, file.content);
  return inspectReceivablesImportWorkbook(await loadWorkbook(file.content));
}

export async function previewReceivablesImport(context: ReceivablesImportContext, file: ReceivablesImportFile, env: ReceivablesImportEnvironment) {
  await authorizeReceivablesImport(context.principal);
  if (file.mimeType !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || !file.originalName.toLowerCase().endsWith(".xlsx")) throw httpError(400, "INVALID_IMPORT_FILE_TYPE", "导入仅支持 XLSX 文件");
  await validateReceivableAttachment(file.originalName, file.mimeType, file.content);
  const parsed = parseReceivablesImportWorkbook(await loadWorkbook(file.content), await references(prisma), { openingBalanceDate: env.openingBalanceDate, columnMappings: env.columnMappings });
  const checksum = createHash("sha256").update(file.content).digest("hex");
  const storageKey = importStorageKey();
  await storeReceivableAttachment(env.uploadRoot, storageKey, file.content);
  try {
    const batch = await prisma.$transaction(async (tx) => {
      const access = await lockAuthority(tx, context.principal);
      requireReceivables(access, "import");
      const originalFile = await tx.privateFile.create({ data: { kind: "attachment", storageKey, originalName: file.originalName.slice(0, 240), mimeType: file.mimeType, size: file.content.length, sha256: checksum, uploadedBy: context.principal.accountId } });
      const created = await tx.receivableImportBatch.create({ data: { originalFileId: originalFile.id, checksum, rowCount: parsed.rows.length, errorCount: parsed.errors.length, openingBalanceDate: env.openingBalanceDate ? new Date(`${env.openingBalanceDate}T00:00:00.000Z`) : null, columnMappings: env.columnMappings && Object.keys(env.columnMappings).length ? snapshot(env.columnMappings) : Prisma.JsonNull, requestedBy: context.principal.accountId, items: { create: parsed.rows.map((row) => ({ rowNumber: row.rowNumber, contractNoNormalized: row.normalizedData.contractNo, normalizedData: snapshot(row.normalizedData), errors: row.errors.length ? snapshot(row.errors) : Prisma.JsonNull, ledgerId: row.ledgerId, targetRevision: row.targetRevision })) } }, include: { items: { orderBy: { rowNumber: "asc" } } } });
      await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: "receivables.import.preview", objectType: "receivable_import_batch", objectId: created.id, requestId: context.requestId, ...auditScope(access), metadata: { checksum, rowCount: parsed.rows.length, errorCount: parsed.errors.length, fileId: originalFile.id, openingBalanceDate: env.openingBalanceDate ?? null, columnMappings: env.columnMappings ?? {} } });
      return created;
    });
    return { batchId: batch.id, revision: batch.revision, checksum, rows: batch.items, errors: parsed.errors, warnings: parsed.warnings };
  } catch (error) {
    await removeReceivableAttachmentFiles(env.uploadRoot, storageKey);
    throwReceivablesImportDatabaseError(error);
  }
}

type ImportFileClassification = "changed" | "io" | null;
export function classifyReceivablesImportFileError(error: unknown): ImportFileClassification {
  if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return null;
  return error.code === "ENOENT" ? "changed" : "io";
}

function throwReceivablesImportFileError(error: unknown): never {
  const classification = classifyReceivablesImportFileError(error);
  if (classification === "changed") throw Object.assign(conflict("IMPORT_FILE_CHANGED", "导入原文件不存在或已替换"), { cause: error });
  if (classification === "io") throw Object.assign(httpError(500, "IMPORT_FILE_IO_ERROR", "读取导入原文件失败"), { cause: error });
  throw error;
}

async function fileOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) { throwReceivablesImportFileError(error); }
}

function sameFileIdentity(expected: Stats, actual: Stats) {
  const devIno = expected.dev !== 0 && expected.ino !== 0 && actual.dev !== 0 && actual.ino !== 0;
  return {
    mode: devIno ? "dev_ino" : "size_mtime",
    same: expected.isFile() && actual.isFile() && expected.size === actual.size && expected.mtimeMs === actual.mtimeMs && (!devIno || expected.dev === actual.dev && expected.ino === actual.ino),
  } as const;
}

type PreparedImportFile = {
  handle: FileHandle;
  path: string;
  stat: Stats;
  content: Buffer;
  checksum: string;
  reparsed: ReturnType<typeof parseReceivablesImportWorkbook>;
};

async function prepareReceivablesImportFile(batchId: string, uploadRoot: string): Promise<PreparedImportFile> {
  const snapshotBatch = await prisma.receivableImportBatch.findUnique({ where: { id: batchId }, include: { originalFile: true } });
  if (!snapshotBatch) throw batchNotFound();
  const path = receivableAttachmentStoragePath(uploadRoot, snapshotBatch.originalFile.storageKey);
  const handle = await fileOperation(() => open(path, "r"));
  try {
    const before = await fileOperation(() => handle.stat());
    const content = await fileOperation(() => handle.readFile());
    const after = await fileOperation(() => handle.stat());
    if (!sameFileIdentity(before, after).same) throw conflict("IMPORT_FILE_CHANGED", "导入原文件不存在或已替换");
    const checksum = createHash("sha256").update(content).digest("hex");
    if (after.size !== snapshotBatch.originalFile.size || checksum !== snapshotBatch.checksum || checksum !== snapshotBatch.originalFile.sha256) throw conflict("IMPORT_FILE_CHANGED", "导入原文件不存在或已替换");
    await validateReceivableAttachment(snapshotBatch.originalFile.originalName, snapshotBatch.originalFile.mimeType, content).catch(() => { throw conflict("IMPORT_FILE_CHANGED", "导入原文件不存在或已替换"); });
    const reparsed = parseReceivablesImportWorkbook(await loadWorkbook(content), await references(prisma), receivablesImportBatchParseOptions(snapshotBatch));
    return { handle, path, stat: after, content, checksum, reparsed };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function verifyPreparedImportFile(prepared: PreparedImportFile, batch: { checksum: string }, originalFile: { size: number; sha256: string }) {
  const [handleStat, pathStat] = await Promise.all([
    fileOperation(() => prepared.handle.stat()),
    fileOperation(() => lstat(prepared.path)),
  ]);
  const handleIdentity = sameFileIdentity(prepared.stat, handleStat);
  const pathIdentity = sameFileIdentity(handleStat, pathStat);
  if (!handleIdentity.same || !pathIdentity.same || handleStat.size !== prepared.content.length || handleStat.size !== originalFile.size || prepared.checksum !== batch.checksum || prepared.checksum !== originalFile.sha256) {
    throw conflict("IMPORT_FILE_CHANGED", "导入原文件不存在或已替换");
  }
  return handleIdentity.mode === "size_mtime" || pathIdentity.mode === "size_mtime" ? "size_mtime" : "dev_ino";
}

async function lockAuthority(tx: Tx, principal: Principal) {
  await tx.$queryRaw`SELECT 'locked'::text AS locked FROM pg_advisory_xact_lock(${setupLockKey})`;
  await tx.$queryRaw`SELECT id FROM receivable_access_grants WHERE account_id = ${principal.accountId}::uuid ORDER BY id FOR UPDATE`;
  return resolveReceivablesAccess(principal, tx);
}

const ledgerFields = ["financeDepartmentId", "contractNo", "projectName", "customerName", "customerType", "creditorUnit", "workNature", "sector", "projectStatus", "settlementMethod", "contractAmount", "finalAmount", "openingChargeDate", "debtStatus", "collectionOwner", "collectionNotes", "dunningDate", "communicationMethod", "counterpartyFeedback", "latestProgress", "nextPlan"] as const;
function ledgerData(data: ReceivablesImportData, mode: "create" | "update") {
  const values = {
    financeDepartmentId: data.financeDepartmentId!, contractNo: data.contractNo!, contractNoNormalized: data.contractNo!,
    projectName: data.projectName, customerName: data.customerName, customerType: data.customerType, creditorUnit: data.creditorUnit,
    workNature: data.workNature, sector: data.sector, projectStatus: data.projectStatus, settlementMethod: data.settlementMethod,
    contractAmount: data.contractAmount === null ? null : new Prisma.Decimal(data.contractAmount), finalAmount: data.finalAmount === null ? null : new Prisma.Decimal(data.finalAmount),
    openingChargeDate: data.openingChargeDate === null ? null : new Date(`${data.openingChargeDate}T00:00:00.000Z`),
    debtStatus: data.debtStatus, collectionOwner: data.collectionOwner, collectionNotes: data.collectionNotes,
    dunningDate: data.dunningDate === null ? null : new Date(`${data.dunningDate}T00:00:00.000Z`),
    communicationMethod: data.communicationMethod, counterpartyFeedback: data.counterpartyFeedback,
    latestProgress: data.latestProgress, nextPlan: data.nextPlan,
  };
  if (mode === "create") return values;
  const present = new Set(data.presentFields);
  return Object.fromEntries(Object.entries(values).filter(([field]) => present.has(field) || field === "contractNoNormalized" && present.has("contractNo")));
}

async function importedDetail(tx: Tx, context: ReceivablesImportContext, access: ReceivablesAccess, ledgerId: string, batchId: string, kind: "invoice" | "receipt", amount: string, date: string) {
  const before = await tx.receivableLedger.findUniqueOrThrow({ where: { id: ledgerId } });
  const detail = kind === "invoice"
    ? await tx.receivableInvoice.create({ data: { ledgerId, invoiceDate: new Date(`${date}T00:00:00.000Z`), amount: new Prisma.Decimal(amount), source: "opening_import", note: "期初导入", createdBy: context.principal.accountId } })
    : await tx.receivableReceipt.create({ data: { ledgerId, receiptDate: new Date(`${date}T00:00:00.000Z`), amount: new Prisma.Decimal(amount), source: "opening_import", note: "期初导入", createdBy: context.principal.accountId } });
  await tx.receivableLedgerRevision.create({ data: { ledgerId, revision: before.revision, beforeSnapshot: snapshot(before), reason: "期初导入", changedBy: context.principal.accountId, importBatchId: batchId } });
  const after = await tx.receivableLedger.update({ where: { id: ledgerId }, data: { ...(kind === "invoice" ? { openingChargeDate: new Date(`${date}T00:00:00.000Z`) } : {}), updatedBy: context.principal.accountId, revision: { increment: 1 } } });
  await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: `receivables.money.${kind}.create`, objectType: "receivable_ledger", objectId: ledgerId, requestId: context.requestId, ...auditScope(access), reason: "期初导入", metadata: { before: snapshot(before), after: snapshot(after), detailType: kind, detailId: detail.id, detail: { before: null, after: snapshot(detail) }, importBatchId: batchId } });
}

function exactTarget(error: Prisma.PrismaClientKnownRequestError, columns: readonly string[], index: string) {
  const target = error.meta?.target;
  return target === index || Array.isArray(target) && target.length === columns.length && target.every((value, i) => value === columns[i]);
}

export function classifyReceivablesImportDatabaseError(error: { code: string; meta?: { target?: unknown } | null }): "contract_conflict" | "revision_conflict" | "internal" | null {
  if (error.code === "P2002" && exactTarget(error as Prisma.PrismaClientKnownRequestError, ["contract_no_normalized"], "receivable_ledgers_contract_no_normalized_key")) return "contract_conflict";
  if (error.code === "P2002" && exactTarget(error as Prisma.PrismaClientKnownRequestError, ["ledger_id", "revision"], "receivable_ledger_revisions_ledger_id_revision_key")) return "revision_conflict";
  if (error.code === "P2002" || error.code === "P2025") return "internal";
  return null;
}
function throwReceivablesImportDatabaseError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const classification = classifyReceivablesImportDatabaseError(error);
    if (classification === "contract_conflict") throw conflict("IMPORT_CONTRACT_CONFLICT", "合同编号已存在");
    if (classification === "revision_conflict") throw conflict();
    if (classification === "internal") throw httpError(500, "INTERNAL_ERROR", "未识别的数据库写入异常");
  }
  throw error;
}

export async function applyReceivablesImport(context: ReceivablesImportContext, batchId: string, decisions: ReceivablesImportDecisions, env: ReceivablesImportEnvironment) {
  await authorizeReceivablesImport(context.principal);
  const suppliedDateErrors: ReceivablesImportIssue[] = [];
  const suppliedOpeningBalanceDate = env.openingBalanceDate ? dateOnly(env.openingBalanceDate, 0, "openingBalanceDate", suppliedDateErrors) : null;
  if (suppliedDateErrors.length) throw invalid("OPENING_BALANCE_DATE_INVALID", "期初余额日期无效");
  const prepared = await prepareReceivablesImportFile(batchId, env.uploadRoot);
  let primaryError: unknown;
  try {
    return await prisma.$transaction(async (tx) => {
      const access = await lockAuthority(tx, context.principal); requireReceivables(access, "import");
      await tx.$queryRaw`SELECT id FROM receivable_import_batches WHERE id = ${batchId}::uuid FOR UPDATE`;
      const batch = await tx.receivableImportBatch.findUnique({ where: { id: batchId }, include: { items: { orderBy: { rowNumber: "asc" } } } });
      if (!batch) throw batchNotFound();
      if (batch.status !== "previewed" || batch.revision !== decisions.revision) throw conflict();
      if (batch.errorCount > 0) throw invalid("IMPORT_HAS_BLOCKING_ERRORS", "导入预览存在阻断错误");
      await tx.$queryRaw`SELECT id FROM files WHERE id = ${batch.originalFileId}::uuid FOR UPDATE`;
      const originalFile = await tx.privateFile.findUnique({ where: { id: batch.originalFileId }, select: { size: true, sha256: true } });
      if (!originalFile) throw conflict("IMPORT_FILE_CHANGED", "导入原文件不存在或已替换");
      const departmentIds = [...new Set(batch.items.map((item) => (item.normalizedData as ReceivablesImportData).financeDepartmentId!))].sort();
      if (departmentIds.length) await tx.$queryRaw`SELECT id FROM receivable_departments WHERE id IN (${Prisma.join(departmentIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
      const targets = batch.items.filter((item) => item.ledgerId).map((item) => item.ledgerId!).sort();
      if (targets.length) await tx.$queryRaw`SELECT id FROM receivable_ledgers WHERE id IN (${Prisma.join(targets.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
      const fileIdentityMode = await verifyPreparedImportFile(prepared, batch, originalFile);
      const reparsed = prepared.reparsed;
      if (reparsed.errors.length || reparsed.rows.length !== batch.items.length) throw conflict("IMPORT_PREVIEW_STALE", "导入预览已失效");
      const choice = new Map(decisions.rows.map((row) => [row.rowNumber, row.decision]));
      if (choice.size !== decisions.rows.length || decisions.rows.some((row) => !batch.items.some((item) => item.rowNumber === row.rowNumber && item.ledgerId))) throw invalid("IMPORT_DECISION_INVALID", "重复决策无效");
      for (const item of batch.items) if (item.ledgerId && !choice.has(item.rowNumber)) throw invalid("IMPORT_DECISION_REQUIRED", "已有合同必须选择跳过或更新");
      for (const item of batch.items) {
        const data = item.normalizedData as unknown as ReceivablesImportData;
        const hasOpeningTotals = [data.openingInvoiceAmount, data.openingReceiptAmount].some((amount) => amount !== null && new Prisma.Decimal(amount).gt(0));
        if (item.ledgerId && choice.get(item.rowNumber) === "update" && hasOpeningTotals) throw invalid("IMPORT_OPENING_TOTALS_UPDATE_FORBIDDEN", "已有合同含非零期初金额，只能跳过");
      }
      const batchOpeningBalanceDate = batch.openingBalanceDate?.toISOString().slice(0, 10) ?? suppliedOpeningBalanceDate;
      const needsOpeningBalanceDate = receivablesImportNeedsOpeningBalanceDate(batch.items);
      if (needsOpeningBalanceDate && !batchOpeningBalanceDate) throw invalid("OPENING_BALANCE_DATE_REQUIRED", "请在最终应用前填写期初余额日期");
      for (const [index, item] of batch.items.entries()) {
        const row = reparsed.rows[index]!;
        if (stableJson(item.normalizedData) !== stableJson(row.normalizedData) || item.ledgerId !== row.ledgerId || item.targetRevision !== row.targetRevision) throw conflict("IMPORT_PREVIEW_STALE", "导入预览已失效");
      }
      const lockedTargets = new Map((await tx.receivableLedger.findMany({ where: { id: { in: targets } }, select: { id: true, contractNoNormalized: true, revision: true, status: true, financeDepartmentId: true } })).map((ledger) => [ledger.id, ledger]));
      for (const item of batch.items.filter((candidate) => candidate.ledgerId)) {
        const target = lockedTargets.get(item.ledgerId!);
        if (!target || target.status !== "active" || target.revision !== item.targetRevision || target.contractNoNormalized !== item.contractNoNormalized) throw conflict("IMPORT_TARGET_CHANGED", "目标台账已变化");
      }
      for (const item of batch.items) {
        const data = item.normalizedData as unknown as ReceivablesImportData;
        const decision = item.ledgerId ? choice.get(item.rowNumber)! : "create";
        if (decision === "skip") { await tx.receivableImportItem.update({ where: { id: item.id }, data: { decision, result: "skipped", appliedRevision: item.targetRevision } }); continue; }
        const department = await tx.receivableDepartment.findUnique({ where: { id: data.financeDepartmentId! }, select: { id: true, active: true } });
        const target = item.ledgerId ? lockedTargets.get(item.ledgerId) : undefined;
        if (!department || !department.active && target?.financeDepartmentId !== department.id) throw conflict("IMPORT_PREVIEW_STALE", "财务归属部门已变化");
        let ledger;
        let ledgerBefore: Prisma.InputJsonObject | null = null;
        if (!item.ledgerId) {
          ledger = await tx.receivableLedger.create({ data: { ...ledgerData(data, "create"), createdBy: context.principal.accountId, updatedBy: context.principal.accountId, createdByImportBatchId: batchId } as Prisma.ReceivableLedgerUncheckedCreateInput });
        } else {
          const before = await tx.receivableLedger.findUnique({ where: { id: item.ledgerId } });
          if (!before || before.revision !== item.targetRevision || before.status !== "active") throw conflict("IMPORT_TARGET_CHANGED", "目标台账已变化");
          ledgerBefore = snapshot(before);
          await tx.receivableLedgerRevision.create({ data: { ledgerId: before.id, revision: before.revision, beforeSnapshot: snapshot(before), reason: "批次导入更新", changedBy: context.principal.accountId, importBatchId: batchId } });
          ledger = await tx.receivableLedger.update({ where: { id: before.id }, data: { ...ledgerData(data, "update"), updatedBy: context.principal.accountId, revision: { increment: 1 } } });
        }
        if (!item.ledgerId && data.openingInvoiceAmount && new Prisma.Decimal(data.openingInvoiceAmount).gt(0)) await importedDetail(tx, context, access, ledger.id, batchId, "invoice", data.openingInvoiceAmount, data.openingInvoiceDate ?? batchOpeningBalanceDate!);
        if (!item.ledgerId && data.openingReceiptAmount && new Prisma.Decimal(data.openingReceiptAmount).gt(0)) await importedDetail(tx, context, access, ledger.id, batchId, "receipt", data.openingReceiptAmount, data.openingReceiptDate ?? batchOpeningBalanceDate!);
        ledger = await tx.receivableLedger.findUniqueOrThrow({ where: { id: ledger.id } });
        await tx.receivableImportItem.update({ where: { id: item.id }, data: { decision: item.ledgerId ? "update" : null, result: item.ledgerId ? "updated" : "created", ledgerId: ledger.id, appliedRevision: ledger.revision } });
        await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: item.ledgerId ? "receivables.import.item.update" : "receivables.import.item.create", objectType: "receivable_ledger", objectId: ledger.id, requestId: context.requestId, ...auditScope(access), metadata: { batchId, rowNumber: item.rowNumber, targetRevision: item.targetRevision, appliedRevision: ledger.revision, before: ledgerBefore, after: snapshot(ledger) } });
      }
      const changed = await tx.receivableImportBatch.updateMany({ where: { id: batchId, revision: decisions.revision, status: "previewed" }, data: { status: "applied", revision: { increment: 1 }, appliedAt: new Date(), appliedBy: context.principal.accountId, ...(batch.openingBalanceDate || !suppliedOpeningBalanceDate ? {} : { openingBalanceDate: new Date(`${suppliedOpeningBalanceDate}T00:00:00.000Z`) }) } });
      if (changed.count !== 1) throw conflict();
      const result = await tx.receivableImportBatch.findUniqueOrThrow({ where: { id: batchId }, include: { items: { orderBy: { rowNumber: "asc" } } } });
      await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: "receivables.import.apply", objectType: "receivable_import_batch", objectId: batchId, requestId: context.requestId, ...auditScope(access), metadata: { before: { status: batch.status, revision: batch.revision }, after: { status: result.status, revision: result.revision }, checksum: batch.checksum, fileIdentityMode } });
      return result;
    }, receivablesImportBatchTransactionOptions);
  } catch (error) {
    primaryError = error;
    throwReceivablesImportDatabaseError(error);
  } finally {
    try { await prepared.handle.close(); }
    catch (error) { if (!primaryError) throwReceivablesImportFileError(error); }
  }
}

export async function rollbackReceivablesImport(context: ReceivablesImportContext, batchId: string, input: { revision: number; reason: string }) {
  try { return await prisma.$transaction(async (tx) => {
    const access = await lockAuthority(tx, context.principal); requireReceivables(access, "import");
    await tx.$queryRaw`SELECT id FROM receivable_import_batches WHERE id = ${batchId}::uuid FOR UPDATE`;
    const batch = await tx.receivableImportBatch.findUnique({ where: { id: batchId }, include: { items: { orderBy: { rowNumber: "asc" } } } });
    if (!batch) throw batchNotFound();
    if (batch.status !== "applied" || batch.revision !== input.revision) throw conflict();
    const departmentIds = [...new Set(batch.items.map((item) => (item.normalizedData as ReceivablesImportData).financeDepartmentId!))].sort();
    if (departmentIds.length) await tx.$queryRaw`SELECT id FROM receivable_departments WHERE id IN (${Prisma.join(departmentIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
    const ledgerIds = [...new Set(batch.items.filter((item) => item.result !== "skipped").map((item) => item.ledgerId!))].sort();
    if (ledgerIds.length) await tx.$queryRaw`SELECT id FROM receivable_ledgers WHERE id IN (${Prisma.join(ledgerIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
    const ledgers = new Map((await tx.receivableLedger.findMany({ where: { id: { in: ledgerIds } } })).map((ledger) => [ledger.id, ledger]));
    for (const item of batch.items) if (item.result !== "skipped" && ledgers.get(item.ledgerId!)?.revision !== item.appliedRevision) throw conflict("IMPORT_ROLLBACK_CONFLICT", "批次应用后台账已变化");
    for (const item of batch.items) {
      if (item.result === "skipped") continue;
      const before = ledgers.get(item.ledgerId!)!;
      await tx.receivableLedgerRevision.create({ data: { ledgerId: before.id, revision: before.revision, beforeSnapshot: snapshot(before), reason: input.reason, changedBy: context.principal.accountId, importBatchId: batchId } });
      let data: Prisma.ReceivableLedgerUncheckedUpdateInput;
      if (item.result === "created") data = { status: "voided", voidedAt: new Date(), voidedBy: context.principal.accountId, voidReason: input.reason, updatedBy: context.principal.accountId, revision: { increment: 1 } };
      else {
        const revision = await tx.receivableLedgerRevision.findFirst({ where: { ledgerId: before.id, importBatchId: batchId, revision: item.targetRevision! } });
        if (!revision || !revision.beforeSnapshot || typeof revision.beforeSnapshot !== "object" || Array.isArray(revision.beforeSnapshot)) throw conflict("IMPORT_ROLLBACK_CONFLICT", "导入前快照缺失");
        const old = revision.beforeSnapshot as Record<string, unknown>;
        const imported = item.normalizedData as unknown as ReceivablesImportData;
        const restoredFields = ledgerFields.filter((field) => imported.presentFields.includes(field));
        data = Object.fromEntries(restoredFields.map((field) => [field, old[field] ?? null]));
        if (restoredFields.includes("contractNo")) data.contractNoNormalized = old.contractNoNormalized as string;
        data.updatedBy = context.principal.accountId; data.revision = { increment: 1 };
      }
      const after = await tx.receivableLedger.update({ where: { id: before.id }, data });
      await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: "receivables.import.item.rollback", objectType: "receivable_ledger", objectId: before.id, requestId: context.requestId, ...auditScope(access), reason: input.reason, metadata: { batchId, rowNumber: item.rowNumber, targetRevision: item.targetRevision, appliedRevision: item.appliedRevision, rollbackRevision: after.revision, before: snapshot(before), after: snapshot(after) } });
    }
    const changed = await tx.receivableImportBatch.updateMany({ where: { id: batchId, revision: input.revision, status: "applied" }, data: { status: "rolled_back", revision: { increment: 1 }, rolledBackAt: new Date(), rolledBackBy: context.principal.accountId, rollbackReason: input.reason } });
    if (changed.count !== 1) throw conflict();
    const result = await tx.receivableImportBatch.findUniqueOrThrow({ where: { id: batchId }, include: { items: { orderBy: { rowNumber: "asc" } } } });
    await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: "receivables.import.rollback", objectType: "receivable_import_batch", objectId: batchId, requestId: context.requestId, ...auditScope(access), reason: input.reason, metadata: { before: { status: batch.status, revision: batch.revision }, after: { status: result.status, revision: result.revision } } });
    return result;
  }, receivablesImportBatchTransactionOptions); }
  catch (error) { throwReceivablesImportDatabaseError(error); }
}

export async function listReceivablesImports(principal: Principal) {
  requireReceivables(await resolveReceivablesAccess(principal), "import");
  return prisma.receivableImportBatch.findMany({ include: { originalFile: { select: { id: true, originalName: true, size: true, sha256: true } }, items: { orderBy: { rowNumber: "asc" } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}
