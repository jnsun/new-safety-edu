import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  filterReceivablesDepartments,
  groupReceivablesDictionaryOptions,
  groupReceivablesImportIssues,
  receivablesImportNeedsOpeningBalanceDate,
  receivablesPageTitle,
  receivablesReferenceCategoryLabels,
  receivablesCreditorUnitLabel,
  moveReceivablesDepartment,
  updateReceivablesSelectedScopes,
} from "../src/receivables-types.js";

assert.equal(receivablesImportNeedsOpeningBalanceDate({ errors: [], rows: [{ rowNumber: 2, ledgerId: null, normalizedData: { openingInvoiceAmount: "1.0000", openingInvoiceDate: null, openingReceiptAmount: null, openingReceiptDate: null } }] }), true);
assert.equal(receivablesImportNeedsOpeningBalanceDate({ errors: [], rows: [{ rowNumber: 2, ledgerId: null, normalizedData: { openingInvoiceAmount: "1.0000", openingInvoiceDate: "2026-09-17", openingReceiptAmount: null, openingReceiptDate: null } }] }), false);

assert.equal(receivablesPageTitle("/receivables/access"), "账号与权限");
assert.equal(receivablesPageTitle("/receivables/data"), "数据处理");
assert.equal(receivablesPageTitle("/receivables/ledger"), "台账总览");
assert.equal(receivablesCreditorUnitLabel("山西省地球物理化学勘查院有限公司"), "物化院");
assert.equal(receivablesCreditorUnitLabel("其他单位"), "其他单位");

const dictionaryRows = [
  { id: "status-2", category: "project_status", value: "完工", sortOrder: 2, active: true, revision: 1, deactivatedAt: null, deactivateReason: null },
  { id: "unit-1", category: "unit", value: "物探一公司", sortOrder: 1, active: true, revision: 1, deactivatedAt: null, deactivateReason: null },
  { id: "status-1", category: "project_status", value: "进行中", sortOrder: 1, active: false, revision: 1, deactivatedAt: null, deactivateReason: null },
];
const groups = groupReceivablesDictionaryOptions(dictionaryRows);
assert.equal(receivablesReferenceCategoryLabels.project_status, "项目状态");
assert.equal(groups[0]?.category, "project_status", "groups follow the configured business order");
assert.equal(groups[0]?.label, "项目状态");
assert.equal(groups[0]?.total, 2);
assert.equal(groups[0]?.active, 1);
assert.deepEqual(groups[0]?.options.map(({ value }) => value), ["进行中", "完工"], "options use sort order inside one category");
assert.equal(groups.find(({ category }) => category === "attach_category")?.total, 0, "empty configured categories remain navigable");

const departments = [
  { id: "one", name: "物探一公司", code: "WT01", sortOrder: 2, showReceivables: true, active: true, revision: 1, deactivatedAt: null, deactivateReason: null },
  { id: "energy", name: "能源物探", code: "NY", sortOrder: 1, showReceivables: false, active: false, revision: 1, deactivatedAt: null, deactivateReason: null },
];
assert.deepEqual(filterReceivablesDepartments(departments, "物探", "active").map(({ id }) => id), ["one"]);
assert.deepEqual(filterReceivablesDepartments(departments, "ny", "inactive").map(({ id }) => id), ["energy"], "search includes department code");
assert.deepEqual(moveReceivablesDepartment(departments, "one", "energy").map(({ id, sortOrder }) => ({ id, sortOrder })), [
  { id: "energy", sortOrder: 0 },
  { id: "one", sortOrder: 1 },
], "dragging produces one canonical contiguous order");
assert.equal(moveReceivablesDepartment(departments, "missing", "energy"), departments, "unknown drag sources leave the list unchanged");

assert.deepEqual(updateReceivablesSelectedScopes("reporter", ["energy", "one"], [{ departmentId: "one", canRead: true, canWrite: true }]), [
  { departmentId: "energy", canRead: true, canWrite: false },
  { departmentId: "one", canRead: true, canWrite: true },
]);
assert.deepEqual(updateReceivablesSelectedScopes("readonly", ["one"], [{ departmentId: "one", canRead: true, canWrite: true }]), [
  { departmentId: "one", canRead: true, canWrite: false },
]);

assert.deepEqual(groupReceivablesImportIssues([
  { code: "DEPARTMENT_NOT_FOUND", message: "财务归属部门不存在", rowNumber: 2 },
  { code: "DEPARTMENT_NOT_FOUND", message: "财务归属部门不存在", rowNumber: 3 },
  { code: "UNKNOWN_COLUMN", message: "未知列将被忽略", column: "旧列" },
]), [
  { code: "DEPARTMENT_NOT_FOUND", message: "财务归属部门不存在", count: 2, rows: [2, 3], columns: [] },
  { code: "UNKNOWN_COLUMN", message: "未知列将被忽略", count: 1, rows: [], columns: ["旧列"] },
]);

const ledgerSource = readFileSync(new URL("../src/ReceivablesLedger.tsx", import.meta.url), "utf8");
const adminSource = readFileSync(new URL("../src/ReceivablesAdmin.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../src/ReceivablesPage.tsx", import.meta.url), "utf8");
const transfersSource = readFileSync(new URL("../src/ReceivablesTransfers.tsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const adminPackage = readFileSync(new URL("../package.json", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
assert.match(ledgerSource, /className: "receivables-resizable-header"/, "resize handles are anchored to the table header cell");
assert.doesNotMatch(ledgerSource, /receivables-resize-handle/, "resize uses the real th boundary instead of a displaced nested handle");
assert.match(ledgerSource, /getBoundingClientRect\(\)/, "resize measures the rendered header boundary");
assert.match(ledgerSource, /moneyDecimals/, "column settings control monetary display precision");
assert.match(ledgerSource, /pointercancel/, "column resizing cleans up cancelled pointer gestures");
assert.doesNotMatch(styles, /\.receivables-filter-grid \.ant-input-group \.ant-input[^\{]*\{[^}]*height:/s, "the inner search input must not be forced to the wrapper height");
assert.match(styles, /\.receivables-filter-grid \.ant-input-affix-wrapper > \.ant-input\s*\{[^}]*height:\s*auto/s, "the inner search input stays inside its affix wrapper");
assert.match(styles, /\.receivables-filter-grid \.ant-select-single[^\{]*\{[^}]*height:\s*36px/s, "select and search controls use equal outer desktop heights");
assert.doesNotMatch(styles, /\.receivables-filter-grid \.ant-select-selector[^\{]*\{[^}]*height:/s, "the select inner selector must not overflow its outer layout box");
assert.match(styles, /\.receivables-resizable-header\s*\{[^}]*position:\s*relative/s, "the resize hit target uses the real header boundary");
assert.match(styles, /\.receivables-ledger-table \.ant-table-tbody > tr > td\s*\{[^}]*vertical-align:\s*middle/s, "ledger cells are vertically centered");
assert.match(styles, /\.receivables-ledger-table \.ant-table-tbody > tr > td\s*\{[^}]*padding:\s*3px 6px/s, "ledger rows stay compact when long cells wrap");
assert.match(ledgerSource, /金额单位：万元/, "ledger states the monetary unit once above the table");
assert.doesNotMatch(ledgerSource, /finalAmount:\s*"[^"]*（万元）"/, "money column headings do not repeat the unit");
assert.match(ledgerSource, /finalAmount:\s*"决算额"/, "money column headings use compact labels");
assert.match(transfersSource, /合同金额（万元）/, "data entry states the authoritative unit");
assert.match(adminSource, /receivables-department-toolbar/, "department controls share one compact toolbar");
assert.match(adminSource, /receivables-department-grid/, "departments use a dense unpaginated grid");
assert.match(adminSource, /draggable=\{canReorderDepartments\}/, "department cards expose native drag ordering only when the full list is visible");
assert.match(adminSource, /显示应收账款/, "department cards expose the receivables visibility switch");
assert.match(adminSource, /`\$\{path\}\/reorder`/, "department order is saved atomically");
assert.match(adminSource, /section === "departments"[^\n]+name="name"[^\n]+editor === "create"[^\n]+name="code"[^\n]+editor !== "create"[^\n]+name="reason"/, "department editor keeps code create-only and removes manual sorting");
assert.doesNotMatch(adminSource, /visibleDepartments[^\n]*pagination=/, "department results are not paginated");
assert.match(mainSource, /import ["']@ant-design\/v5-patch-for-react-19["']/, "React 19 compatibility patch is loaded before Ant Design static modals are used");
assert.match(adminPackage, /"@ant-design\/v5-patch-for-react-19"/, "React 19 compatibility patch is an explicit admin dependency");
assert.match(pageSource, /编辑看板/);
assert.match(pageSource, /onDragStart/);
assert.match(pageSource, /onPointerDown/);
assert.match(pageSource, /preferences\/dashboard/);
for (const label of ["月度开票／回款趋势", "财务归属部门应收余额 TOP8", "客户应收余额 TOP10", "客户属性构成", "催收跟踪 TOP10"]) {
  assert.match(pageSource, new RegExp(label), `dashboard catalog includes ${label}`);
}
assert.match(styles, /\.receivables-ledger-table \.ant-table-placeholder[^\{]*\{[^}]*height:\s*260px/s, "empty ledger keeps a stable desktop body height");
assert.doesNotMatch(adminSource, /scroll=\{\{\s*x:\s*760\s*\}\}/, "grant table does not force desktop horizontal scrolling");
assert.doesNotMatch(adminSource, /fixed:\s*["']right["']/, "grant actions are not pinned into a forced overflow table");
assert.match(adminSource, /receivables-grant-cards/, "narrow screens use grant cards instead of a horizontal table");
assert.match(adminSource, /row\.account\.person\?\.name/, "grant list shows the employee name instead of only the account id");
assert.doesNotMatch(pageSource, /defaultReceivablesDashboardPreference\.find\([^\n]+\)!/, "optional cards have a real catalog fallback size");
assert.match(transfersSource, /openingBalanceDate:\s*openingBalanceDate\s*\|\|\s*undefined/, "final apply sends the date selected after preview");
assert.match(transfersSource, /最终应用前填写/, "the preview explains when the pending date is required");
assert.match(transfersSource, /receivables-import-start/, "initial import controls share one compact row");
assert.match(transfersSource, /needsOpeningBalanceDate\s*&&/, "opening balance date stays hidden until opening amounts are detected");
assert.match(styles, /\.receivables-import-start\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center/s, "initial import controls use a compact aligned row");
assert.doesNotMatch(styles, /\.receivables-import-upload\s*\{[^}]*max-width:\s*680px/s, "initial import content does not leave a large empty right side");
assert.match(pageSource, /暂无法计算/, "an unreliable balance is described instead of rendered as a dash");
assert.match(pageSource, /查看待补充台账/, "unreliable balance links directly to missing final amounts");
assert.match(pageSource, /finalAmountMissingCount\s*>\s*0/, "balance reliability is driven by the missing-final count");
assert.match(styles, /\.receivables-balance-unavailable\s*\{[^}]*place-content:\s*center/s, "unavailable balance content remains centered when resized");
assert.match(styles, /\.receivables-department-grid\s*\{[^}]*repeat\(auto-fill,\s*minmax\(/s, "department cards use an adaptive compact grid");

console.log("RECEIVABLES_ADMIN_UI_OK");
