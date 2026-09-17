import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { StructuredCoursewareDocumentSchema } from "@safety/contracts";
import { parseCoursewareXlsx } from "../src/courseware-import-xlsx.js";
import { parseCoursewarePackage } from "../src/courseware-import-package.js";
import { exportCoursewareJson, exportCoursewareXlsx, exportCoursewareZip } from "../src/courseware-export.js";
import { anonymousCoursewareDocument, createAnonymousCoursewareXlsx, createCoursewareJsonSchema, createCoursewareJsonTemplate } from "../src/courseware-template.js";

const code = "COURSE-EXAMPLE";
const normalized = StructuredCoursewareDocumentSchema.parse(anonymousCoursewareDocument);

const xlsx = await exportCoursewareXlsx(code, normalized);
const parsedXlsx = await parseCoursewareXlsx(xlsx);
assert.deepEqual(parsedXlsx.issues, []);
assert.equal(parsedXlsx.courses[0]?.courseCode, code);
assert.deepEqual(parsedXlsx.courses[0]?.document, normalized);

const json = JSON.parse(exportCoursewareJson(code, normalized).toString("utf8"));
assert.equal(json.templateVersion, 1);
assert.equal(json.courses[0].courseCode, code);
assert.deepEqual(StructuredCoursewareDocumentSchema.parse(json.courses[0].document), normalized);

const zip = await exportCoursewareZip(code, normalized, []);
const parsedZip = await parseCoursewarePackage(zip);
assert.equal(parsedZip.manifest.filename, "courseware.json");
assert.equal(parsedZip.assets.size, 0);

const template = await createAnonymousCoursewareXlsx();
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(template as unknown as ExcelJS.Buffer);
assert.deepEqual(workbook.worksheets.map(({ name }) => name), ["课程", "单元", "内容块", "随堂题", "情境选择"]);
for (const sheet of workbook.worksheets) {
  assert.equal(sheet.views[0]?.state, "frozen");
  assert.equal(sheet.views[0]?.ySplit, 1);
  assert.ok((sheet.getRow(1).font as { bold?: boolean }).bold);
  assert.ok(sheet.columns.every(({ width }) => typeof width === "number" && width >= 10));
}
assert.equal(workbook.getWorksheet("随堂题")?.getCell("E2").dataValidation.type, "list");

const jsonTemplate = JSON.parse(createCoursewareJsonTemplate().toString("utf8"));
assert.equal(jsonTemplate.courses[0].courseCode, code);
assert.deepEqual(StructuredCoursewareDocumentSchema.parse(jsonTemplate.courses[0].document), normalized);
const schema = JSON.parse(createCoursewareJsonSchema().toString("utf8"));
assert.equal(schema.additionalProperties, false);
assert.deepEqual(schema.required, ["templateVersion", "courses"]);
assert.equal(schema.$defs.knowledge.properties.type.const, "knowledge");
assert.equal(schema.$defs.unit.properties.blocks.items.oneOf.length, 6);

const routes = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../src/routes/courseware-authoring.ts", import.meta.url), "utf8"));
assert.match(routes, /courseware-authoring\/templates\/\:format/);
assert.match(routes, /courseware-versions\/\:id\/export/);
assert.match(routes, /await assertScope\(principal, version\.courseware\.scopeType, version\.courseware\.scopeId\)/);
assert.match(routes, /courseware\.template_download/);
assert.match(routes, /courseware\.export/);
assert.match(routes, /COURSEWARE_ZIP_REQUIRED/);
assert.match(routes, /COURSEWARE_ASSET_INTEGRITY_FAILED/);

console.log("COURSEWARE_TEMPLATE_EXPORT_OK");
