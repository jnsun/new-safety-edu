import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  filterReceivablesDepartments,
  groupReceivablesDictionaryOptions,
  groupReceivablesImportIssues,
  receivablesPageTitle,
  receivablesReferenceCategoryLabels,
  updateReceivablesSelectedScopes,
} from "../src/receivables-types.js";

assert.equal(receivablesPageTitle("/receivables/access"), "账号与权限");
assert.equal(receivablesPageTitle("/receivables/data"), "数据处理");
assert.equal(receivablesPageTitle("/receivables/ledger"), "台账总览");

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
  { id: "one", name: "物探一公司", code: "WT01", sortOrder: 2, active: true, revision: 1, deactivatedAt: null, deactivateReason: null },
  { id: "energy", name: "能源物探", code: "NY", sortOrder: 1, active: false, revision: 1, deactivatedAt: null, deactivateReason: null },
];
assert.deepEqual(filterReceivablesDepartments(departments, "物探", "active").map(({ id }) => id), ["one"]);
assert.deepEqual(filterReceivablesDepartments(departments, "ny", "inactive").map(({ id }) => id), ["energy"], "search includes department code");

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
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
assert.match(ledgerSource, /className: "receivables-resizable-header"/, "resize handles are anchored to the table header cell");
assert.match(ledgerSource, /pointercancel/, "column resizing cleans up cancelled pointer gestures");
assert.doesNotMatch(styles, /\.receivables-filter-grid \.ant-input-group \.ant-input[^\{]*\{[^}]*height:/s, "the inner search input must not be forced to the wrapper height");
assert.match(styles, /\.receivables-filter-grid \.ant-input-affix-wrapper > \.ant-input\s*\{[^}]*height:\s*auto/s, "the inner search input stays inside its affix wrapper");
assert.match(styles, /\.receivables-resizable-header\s*\{[^}]*position:\s*relative/s, "the resize hit target uses the real header boundary");

console.log("RECEIVABLES_ADMIN_UI_OK");
