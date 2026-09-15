import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { classifyReceivablesImportDatabaseError, parseReceivablesImportWorkbook } from "../src/receivables-import.js";

const references = {
  departments: [
    { id: "department-active", name: "一所", code: "D001", active: true },
    { id: "department-inactive", name: "停用所", code: "D002", active: false },
  ],
  dictionaryOptions: [
    { category: "final_method", value: "合同金额", active: true },
    { category: "final_method", value: "工作量", active: true },
    { category: "unit", value: "物化院", active: true },
    { category: "project_status", value: "完工", active: true },
    { category: "debt_status", value: "正常", active: true },
    { category: "client_attr", value: "内部单位", active: true },
    { category: "work_nature", value: "综合物探", active: true },
    { category: "sector", value: "能源资源勘查开发", active: true },
  ],
  ledgers: [{ id: "existing-ledger", contractNoNormalized: "HT-EXISTING", revision: 7 }],
} as const;

function workbook(headers: string[], rows: unknown[][]) {
  const result = new ExcelJS.Workbook();
  const sheet = result.addWorksheet("应收台账");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return result;
}

function codes(result: ReturnType<typeof parseReceivablesImportWorkbook>) {
  return result.errors.map(({ code }) => code);
}

const valid = parseReceivablesImportWorkbook(workbook([
  "归属部门", "合同号", "项目名称", "客户名称", "客户属性", "债权单位", "工作性质", "八大板块",
  "项目状态", "决算方式", "合同金额", "决算金额", "最新挂账时间", "开票金额", "开票日期", "到账金额", "到账日期", "债权状态", "未知旧列",
], [[
  "D001", " HT-EXISTING ", "匿名项目", "匿名客户", "内部单位", "物化院", "综合物探", "能源资源勘查开发",
  "完工", "合同金额", "100.1234", "", "2026-09-01", "10.0000", "2026-09-01", "3.2000", "2026-09-02", "正常", "ignored",
]]), references);
assert.deepEqual(codes(valid), []);
assert.deepEqual(valid.warnings.map(({ code }) => code), ["UNKNOWN_COLUMN", "EXISTING_OPENING_TOTALS_SKIP_ONLY"]);
assert.equal(valid.rows[0]?.rowNumber, 2);
assert.equal(valid.rows[0]?.normalizedData.contractNo, "HT-EXISTING");
assert.equal(valid.rows[0]?.normalizedData.financeDepartmentId, "department-active");
assert.equal(valid.rows[0]?.normalizedData.contractAmount, "100.1234");
assert.equal(valid.rows[0]?.normalizedData.finalAmount, "100.1234", "non-workload import should reuse contract amount");
assert.equal(valid.rows[0]?.normalizedData.openingInvoiceAmount, "10.0000");
assert.equal(valid.rows[0]?.normalizedData.openingReceiptAmount, "3.2000");
assert.equal(valid.rows[0]?.ledgerId, "existing-ledger");
assert.equal(valid.rows[0]?.targetRevision, 7);
assert.deepEqual(valid.rows[0]?.normalizedData.presentFields, ["financeDepartmentId", "contractNo", "projectName", "customerName", "customerType", "creditorUnit", "workNature", "sector", "projectStatus", "settlementMethod", "contractAmount", "finalAmount", "openingChargeDate", "openingInvoiceAmount", "openingInvoiceDate", "openingReceiptAmount", "openingReceiptDate", "debtStatus"]);
assert.deepEqual(valid.rows[0]?.allowedDecisions, ["skip"], "existing opening totals must be skip-only");
assert.ok(valid.rows[0]?.warnings.some(({ code }) => code === "EXISTING_OPENING_TOTALS_SKIP_ONLY"));

const workload = parseReceivablesImportWorkbook(workbook(
  ["财务归属部门", "合同编号", "决算方式", "合同金额", "决算金额"],
  [["一所", "HT-WORKLOAD", "工作量", "9.0000", ""]],
), references);
assert.deepEqual(codes(workload), []);
assert.equal(workload.rows[0]?.normalizedData.finalAmount, null, "workload settlement may omit final amount");

const failures = [
  ["ambiguous alias", workbook(["合同号", "合同编号", "归属部门"], [["A", "B", "一所"]]), "AMBIGUOUS_COLUMN"],
  ["missing contract", workbook(["合同号", "归属部门"], [["", "一所"]]), "CONTRACT_NO_REQUIRED"],
  ["inactive department", workbook(["合同号", "归属部门"], [["A", "停用所"]]), "DEPARTMENT_INACTIVE"],
  ["unknown department", workbook(["合同号", "归属部门"], [["A", "不存在"]]), "DEPARTMENT_NOT_FOUND"],
  ["decimal scale", workbook(["合同号", "归属部门", "合同金额"], [["A", "一所", "1.00001"]]), "AMOUNT_INVALID"],
  ["invalid date", workbook(["合同号", "归属部门", "最新挂账时间"], [["A", "一所", "2026-02-30"]]), "DATE_INVALID"],
  ["dictionary", workbook(["合同号", "归属部门", "债权单位"], [["A", "一所", "未知单位"]]), "DICTIONARY_VALUE_INVALID"],
  ["invoice date", workbook(["合同号", "归属部门", "开票金额"], [["A", "一所", "1"]]), "OPENING_INVOICE_DATE_REQUIRED"],
  ["receipt date", workbook(["合同号", "归属部门", "到账金额"], [["A", "一所", "1"]]), "OPENING_RECEIPT_DATE_REQUIRED"],
] as const;
for (const [label, fixture, expected] of failures) {
  assert.ok(codes(parseReceivablesImportWorkbook(fixture, references)).includes(expected), label);
}

const duplicate = parseReceivablesImportWorkbook(workbook(
  ["合同编号", "归属部门"],
  [[" SAME ", "一所"], ["SAME", "一所"], []],
), references);
assert.equal(duplicate.rows.length, 2, "empty rows must be ignored");
assert.equal(codes(duplicate).filter((code) => code === "DUPLICATE_CONTRACT_IN_FILE").length, 2);

const ambiguousDepartment = parseReceivablesImportWorkbook(workbook(["合同编号", "归属部门"], [["HT-AMBIGUOUS", "D001"]]), {
  ...references,
  departments: [{ id: "by-name", name: "D001", code: null, active: true }, { id: "by-code", name: "二所", code: "D001", active: true }],
});
assert.ok(codes(ambiguousDepartment).includes("DEPARTMENT_AMBIGUOUS"));

assert.equal(classifyReceivablesImportDatabaseError({ code: "P2002", meta: { target: ["contract_no_normalized"] } }), "contract_conflict");
assert.equal(classifyReceivablesImportDatabaseError({ code: "P2002", meta: { target: ["ledger_id", "revision"] } }), "revision_conflict");
assert.equal(classifyReceivablesImportDatabaseError({ code: "P2002", meta: { target: ["other"] } }), "internal");
assert.equal(classifyReceivablesImportDatabaseError({ code: "P2025" }), "internal");
assert.equal(classifyReceivablesImportDatabaseError({ code: "P2024" }), null);

const bounded = new ExcelJS.Workbook();
bounded.addWorksheet("too-many-rows").getCell("A200001").value = "x";
assert.throws(
  () => parseReceivablesImportWorkbook(bounded, references),
  (error: Error & { code?: string }) => error.code === "INVALID_FILE_CONTENT",
  "Task 8 workbook bounds must be reused",
);

console.log("RECEIVABLES_IMPORT_OK");
