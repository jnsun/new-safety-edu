import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseQualificationWorkbook } from "../src/qualification-import.js";

const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("证照导入");
sheet.addRow(["大类", "所属组织", "持证人", "证照类型", "证照名称", "证照编号", "子分类1", "子分类2", "发证机关", "发证日期", "有效期开始", "有效期至", "长期有效", "持证岗位", "许可范围", "备注"]);
sheet.addRow(["公司", "测试公司", "", "安全生产许可证", "测试许可证", "ANON-001", "", "", "测试机构", "2026-01-01", "2026-01-01", "2027-01-01", "否"]);
sheet.addRow(["个人", "", "重名人员", "注册安全工程师", "测试个人证书", "ANON-002", "其他安全", "", "测试机构", "2026-01-01", "2026-01-01", "2027-01-01", "否"]);
const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
const result = await parseQualificationWorkbook(buffer, {
  organizations: [{ id: "10000000-0000-4000-8000-000000000001", name: "测试公司" }],
  persons: [{ id: "20000000-0000-4000-8000-000000000001", name: "重名人员" }, { id: "20000000-0000-4000-8000-000000000002", name: "重名人员" }],
  types: [{ id: "30000000-0000-4000-8000-000000000001", name: "安全生产许可证", category: "company", subtype1Label: null, subtype1Options: [], subtype2Label: null, subtype2Options: [] }, { id: "30000000-0000-4000-8000-000000000002", name: "注册安全工程师", category: "personal", subtype1Label: "专业类别", subtype1Options: ["其他安全"], subtype2Label: null, subtype2Options: [] }]
});
assert.equal(result.rows.length, 2); assert.equal(result.rows[0]?.status, "ready"); assert.equal(result.rows[0]?.rowNumber, 2); assert.equal(result.rows[1]?.status, "invalid"); assert.match(result.rows[1]?.reasons.join("；") ?? "", /重名/);
console.log("qualification import check passed: ready row and duplicate-name rejection");
