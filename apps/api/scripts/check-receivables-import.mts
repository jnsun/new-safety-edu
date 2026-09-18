import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { classifyReceivablesImportDatabaseError, classifyReceivablesImportFileError, inspectReceivablesImportWorkbook, mergeMissingReceivablesImportData, parseReceivablesImportWorkbook, receivablesImportBatchParseOptions, receivablesImportBatchTransactionOptions, receivablesImportNeedsOpeningBalanceDate } from "../src/receivables-import.js";

const references = {
  departments: [
    { id: "department-active", name: "一所", code: "D001", active: true },
    { id: "department-inactive", name: "停用所", code: "D002", active: false },
  ],
  dictionaryOptions: [
    { category: "final_method", value: "合同金额", active: true },
    { category: "final_method", value: "工作量", active: true },
    { category: "unit", value: "物化院", active: true },
    { category: "unit", value: "山西省地球物理化学勘查院有限公司", active: true },
    { category: "project_status", value: "完工", active: true },
    { category: "project_status", value: "取消或作废", active: true },
    { category: "debt_status", value: "正常", active: true },
    { category: "client_attr", value: "内部单位", active: true },
    { category: "work_nature", value: "综合物探", active: true },
    { category: "sector", value: "能源资源勘查开发", active: true },
    { category: "comm_method", value: "电话", active: true },
    { category: "feedback", value: "正在筹款，近期付", active: true },
    { category: "progress_note", value: "已安排对账", active: true },
    { category: "next_plan", value: "跟踪付款进度", active: true },
  ],
  ledgers: [{ id: "existing-ledger", contractNoNormalized: "HT-EXISTING", revision: 7, financeDepartmentId: "department-active" }],
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
  "项目状态", "决算方式", "合同金额", "决算金额", "最新挂账时间", "最新催收时间", "沟通方式", "对方反馈", "最新进展", "下一步计划", "开票金额", "开票日期", "到账金额", "到账日期", "债权状态", "未知旧列",
], [[
  "D001", " HT-EXISTING ", "匿名项目", "匿名客户", "内部单位", "物化院", "综合物探", "能源资源勘查开发",
  "完工", "合同金额", "100.1234", "", "2026-09-01", "2026-09-16", "电话", "正在筹款，近期付", "已安排对账", "跟踪付款进度", "10.0000", "2026-09-01", "3.2000", "2026-09-02", "正常", "ignored",
]]), references);
assert.deepEqual(codes(valid), []);
assert.deepEqual(valid.warnings.map(({ code }) => code), ["UNKNOWN_COLUMN", "EXISTING_OPENING_TOTALS_IGNORED"]);
assert.equal(valid.rows[0]?.rowNumber, 2);
assert.equal(valid.rows[0]?.normalizedData.contractNo, "HT-EXISTING");
assert.equal(valid.rows[0]?.normalizedData.financeDepartmentId, "department-active");
assert.equal(valid.rows[0]?.normalizedData.contractAmount, "100.1234");
assert.equal(valid.rows[0]?.normalizedData.finalAmount, "100.1234", "non-workload import should reuse contract amount");
assert.equal(valid.rows[0]?.normalizedData.openingInvoiceAmount, "10.0000");
assert.equal(valid.rows[0]?.normalizedData.openingReceiptAmount, "3.2000");
assert.equal(valid.rows[0]?.normalizedData.dunningDate, "2026-09-16");
assert.equal(valid.rows[0]?.normalizedData.communicationMethod, "电话");
assert.equal(valid.rows[0]?.normalizedData.counterpartyFeedback, "正在筹款，近期付");
assert.equal(valid.rows[0]?.normalizedData.latestProgress, "已安排对账");
assert.equal(valid.rows[0]?.normalizedData.nextPlan, "跟踪付款进度");
assert.equal(valid.rows[0]?.ledgerId, "existing-ledger");
assert.equal(valid.rows[0]?.targetRevision, 7);
assert.deepEqual(valid.rows[0]?.normalizedData.presentFields, ["financeDepartmentId", "contractNo", "projectName", "customerName", "customerType", "creditorUnit", "workNature", "sector", "projectStatus", "settlementMethod", "contractAmount", "finalAmount", "openingChargeDate", "dunningDate", "communicationMethod", "counterpartyFeedback", "latestProgress", "nextPlan", "openingInvoiceAmount", "openingInvoiceDate", "openingReceiptAmount", "openingReceiptDate", "debtStatus"]);
assert.deepEqual(valid.rows[0]?.allowedDecisions, ["skip", "update"], "repeat imports may supplement missing ledger fields");
assert.ok(valid.rows[0]?.warnings.some(({ code }) => code === "EXISTING_OPENING_TOTALS_IGNORED"));

const prefixDefault = parseReceivablesImportWorkbook(workbook(
  ["归属部门", "合同编号", "合同金额"],
  [["一所", "wh19-001", "10"]],
), references);
assert.deepEqual(codes(prefixDefault), []);
assert.equal(prefixDefault.rows[0]?.normalizedData.creditorUnit, "山西省地球物理化学勘查院有限公司");

assert.deepEqual(mergeMissingReceivablesImportData(
  { projectName: "已有项目", customerName: null, finalAmount: "0.0000", creditorUnit: null },
  { ...prefixDefault.rows[0]!.normalizedData, presentFields: ["projectName", "customerName", "finalAmount", "creditorUnit"], projectName: "不得覆盖", customerName: "补充客户", finalAmount: "99.0000" },
), { customerName: "补充客户", creditorUnit: "山西省地球物理化学勘查院有限公司" });

const workload = parseReceivablesImportWorkbook(workbook(
  ["财务归属部门", "合同编号", "决算方式", "合同金额", "决算金额"],
  [["一所", "HT-WORKLOAD", "工作量", "9.0000", ""]],
), references);
assert.deepEqual(codes(workload), []);
assert.equal(workload.rows[0]?.normalizedData.finalAmount, null, "workload settlement may omit final amount");
const workloadNullAmounts = parseReceivablesImportWorkbook(workbook(
  ["财务归属部门", "合同编号", "决算方式", "合同金额", "决算金额"],
  [["一所", "HT-WORKLOAD-NULL", "工作量", "", ""]],
), references);
assert.deepEqual(codes(workloadNullAmounts), [], "workload import may retain both amounts null");

const inactiveHistory = parseReceivablesImportWorkbook(workbook(
  ["财务归属部门", "合同编号", "项目名称"],
  [["停用所", "HT-INACTIVE", "历史更正"]],
), { ...references, ledgers: [{ id: "inactive-ledger", contractNoNormalized: "HT-INACTIVE", revision: 2, financeDepartmentId: "department-inactive" }] });
assert.deepEqual(codes(inactiveHistory), [], "existing ledger may retain its inactive department during import update");
assert.deepEqual(inactiveHistory.rows[0]?.allowedDecisions, ["skip", "update"]);

const legacyWorkbook = workbook([
  "合同编号", "项目名称", "合同金额", "项目进度", "决算情况", "决算金额", "已开发票", "已到账收入",
  "账内应收", "账外应收", "应收合计", "财务归属部门", "债务单位",
], [[
  " LEGACY-001 ", "旧表项目", 315, "完工", "未决算", 315, 315,
  { formula: "294.136+10", result: 304.136 }, { formula: "G2-H2", result: 10.864 },
  { formula: "F2-G2", result: 0 }, { formula: "F2-H2", result: 10.864 }, "一所", "债务客户",
]]);
const legacy = parseReceivablesImportWorkbook(legacyWorkbook, references, { openingBalanceDate: "2026-09-17" });
assert.deepEqual(codes(legacy), [], "the supplied legacy workbook shape should normalize without blocking errors");
assert.equal(legacy.rows[0]?.normalizedData.contractNo, "LEGACY-001");
assert.equal(legacy.rows[0]?.normalizedData.projectStatus, "完工");
assert.equal(legacy.rows[0]?.normalizedData.customerName, "债务客户");
assert.equal(legacy.rows[0]?.normalizedData.openingInvoiceAmount, "315.0000");
assert.equal(legacy.rows[0]?.normalizedData.openingInvoiceDate, "2026-09-17");
assert.equal(legacy.rows[0]?.normalizedData.openingReceiptAmount, "304.1360");
assert.equal(legacy.rows[0]?.normalizedData.openingReceiptDate, "2026-09-17");
assert.ok(!legacy.warnings.some(({ code }) => code === "UNKNOWN_COLUMN"), "known legacy and derived columns should not be reported as unknown");
assert.ok(!legacy.rows[0]?.normalizedData.presentFields.some((field) => ["internalReceivable", "externalReceivable", "balance"].includes(field)), "derived values must not become imported facts");

const legacyWithoutBalanceDate = parseReceivablesImportWorkbook(legacyWorkbook, references);
assert.deepEqual(codes(legacyWithoutBalanceDate), [], "missing opening balance date must not block preview");
assert.equal(legacyWithoutBalanceDate.warnings.filter(({ code }) => code === "OPENING_BALANCE_DATE_PENDING").length, 1, "missing opening balance date is summarized once");
assert.equal(legacyWithoutBalanceDate.rows[0]?.normalizedData.openingInvoiceDate, null);
assert.equal(legacyWithoutBalanceDate.rows[0]?.normalizedData.openingReceiptDate, null);
assert.equal(receivablesImportNeedsOpeningBalanceDate(legacyWithoutBalanceDate.rows), true, "final apply must require the deferred date");
assert.equal(receivablesImportNeedsOpeningBalanceDate(legacy.rows), false, "a preview carrying explicit dates can be applied directly");
assert.ok(codes(parseReceivablesImportWorkbook(legacyWorkbook, references, { openingBalanceDate: "2026-02-30" })).includes("DATE_INVALID"), "the shared opening balance date must be a real calendar date");

const cancelled = parseReceivablesImportWorkbook(workbook(
  ["合同编号", "归属部门", "项目状态", "合同金额"],
  [["CANCELLED-001", "一所", "作废", "1"]],
), references);
assert.deepEqual(codes(cancelled), []);
assert.equal(cancelled.rows[0]?.normalizedData.projectStatus, "取消或作废", "legacy 作废 status maps to the active canonical option");

const customHeaders = workbook(
  ["所属经营实体", "旧合同编号", "项目简称", "旧决算金额", "无关备注"],
  [["一所", "MAP-001", "北区勘查", "100", "第一条"], ["一所", "MAP-002", "南区勘查", "200", "第二条"]],
);
assert.deepEqual(inspectReceivablesImportWorkbook(customHeaders).unknownColumns, [
  { name: "所属经营实体", samples: ["一所"] },
  { name: "旧合同编号", samples: ["MAP-001", "MAP-002"] },
  { name: "项目简称", samples: ["北区勘查", "南区勘查"] },
  { name: "旧决算金额", samples: ["100", "200"] },
  { name: "无关备注", samples: ["第一条", "第二条"] },
]);
const mapped = parseReceivablesImportWorkbook(customHeaders, references, { columnMappings: { 所属经营实体: "financeDepartmentId", 旧合同编号: "contractNo", 项目简称: "projectName", 旧决算金额: "finalAmount" } });
assert.deepEqual(codes(mapped), []);
assert.equal(mapped.rows[0]?.normalizedData.contractNo, "MAP-001");
assert.equal(mapped.rows[0]?.normalizedData.projectName, "北区勘查");
assert.ok(mapped.warnings.some(({ code, column }) => code === "UNKNOWN_COLUMN" && column === "无关备注"));
assert.ok(codes(parseReceivablesImportWorkbook(customHeaders, references, { columnMappings: { 所属经营实体: "financeDepartmentId", 旧合同编号: "contractNo", 项目简称: "contractNo", 旧决算金额: "finalAmount" } })).includes("AMBIGUOUS_COLUMN"));

const formulaWithoutCachedResult = workbook(["合同编号", "归属部门", "合同金额"], [["FORMULA-001", "一所", { formula: "1+1" }]]);
assert.ok(codes(parseReceivablesImportWorkbook(formulaWithoutCachedResult, references)).includes("FORMULA_RESULT_MISSING"), "formula inputs without cached results must be explicit errors");

const failures = [
  ["ambiguous alias", workbook(["合同号", "合同编号", "归属部门"], [["A", "B", "一所"]]), "AMBIGUOUS_COLUMN"],
  ["missing contract", workbook(["合同号", "归属部门"], [["", "一所"]]), "CONTRACT_NO_REQUIRED"],
  ["inactive department", workbook(["合同号", "归属部门"], [["A", "停用所"]]), "DEPARTMENT_INACTIVE"],
  ["non-workload null amounts", workbook(["合同号", "归属部门", "决算方式", "合同金额", "决算金额"], [["A", "一所", "合同金额", "", ""]]), "FINAL_AMOUNT_REQUIRED"],
  ["unknown department", workbook(["合同号", "归属部门"], [["A", "不存在"]]), "DEPARTMENT_NOT_FOUND"],
  ["decimal scale", workbook(["合同号", "归属部门", "合同金额"], [["A", "一所", "1.00001"]]), "AMOUNT_INVALID"],
  ["invalid date", workbook(["合同号", "归属部门", "最新挂账时间"], [["A", "一所", "2026-02-30"]]), "DATE_INVALID"],
  ["invalid dunning date", workbook(["合同号", "归属部门", "最新催收时间"], [["A", "一所", "2026-02-30"]]), "DATE_INVALID"],
  ["dictionary", workbook(["合同号", "归属部门", "债权单位"], [["A", "一所", "未知单位"]]), "DICTIONARY_VALUE_INVALID"],
] as const;
for (const [label, fixture, expected] of failures) {
  assert.ok(codes(parseReceivablesImportWorkbook(fixture, references)).includes(expected), label);
}

for (const fixture of [
  workbook(["合同号", "归属部门", "合同金额", "开票金额"], [["A", "一所", "1", "1"]]),
  workbook(["合同号", "归属部门", "合同金额", "到账金额"], [["A", "一所", "1", "1"]]),
]) {
  const pending = parseReceivablesImportWorkbook(fixture, references);
  assert.deepEqual(codes(pending), [], "opening totals without a date may reach preview");
  assert.equal(pending.warnings.filter(({ code }) => code === "OPENING_BALANCE_DATE_PENDING").length, 1);
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

assert.equal(receivablesImportBatchTransactionOptions.maxWait, 10_000);
assert.ok(receivablesImportBatchTransactionOptions.timeout >= 120_000);
assert.equal(receivablesImportBatchTransactionOptions.isolationLevel, "ReadCommitted");
assert.deepEqual(receivablesImportBatchParseOptions({ openingBalanceDate: new Date("2026-09-17T00:00:00.000Z") }), { openingBalanceDate: "2026-09-17" });
assert.deepEqual(receivablesImportBatchParseOptions({ openingBalanceDate: null }), {});
assert.deepEqual(receivablesImportBatchParseOptions({ openingBalanceDate: null, columnMappings: { 旧合同编号: "contractNo" } }), { columnMappings: { 旧合同编号: "contractNo" } });
for (const code of ["ENOENT"] as const) assert.equal(classifyReceivablesImportFileError(Object.assign(new Error(code), { code })), "changed");
for (const code of ["EACCES", "EPERM", "EMFILE", "ENFILE", "EIO"] as const) assert.equal(classifyReceivablesImportFileError(Object.assign(new Error(code), { code })), "io");
assert.equal(classifyReceivablesImportFileError(new Error("not a filesystem error")), null);

const bounded = new ExcelJS.Workbook();
bounded.addWorksheet("too-many-rows").getCell("A200001").value = "x";
assert.throws(
  () => parseReceivablesImportWorkbook(bounded, references),
  (error: Error & { code?: string }) => error.code === "INVALID_FILE_CONTENT",
  "Task 8 workbook bounds must be reused",
);

console.log("RECEIVABLES_IMPORT_OK");
