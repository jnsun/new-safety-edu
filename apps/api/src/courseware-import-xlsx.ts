import ExcelJS from "exceljs";
import {
  COURSEWARE_SCHEMA_VERSION,
  CoursewareBlockSchema,
  StructuredCoursewareDocumentSchema,
  type CoursewareBlock,
  type StructuredCoursewareDocument
} from "@safety/contracts";
import type { CoursewareImportIssue, ParsedCoursewareImport } from "./courseware-import.js";

const requiredSheets = ["课程", "单元", "内容块", "随堂题", "情境选择"] as const;
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const list = (value: unknown) => text(value).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

type Row = { sheet: string; row: number; values: Map<string, unknown> };

function issue(sheet: string, row: number, field: string, code: string, message: string, context: Partial<CoursewareImportIssue> = {}): CoursewareImportIssue {
  return { file: "", sheet, row, field, code, message, ...context };
}

function sheetRows(sheet: ExcelJS.Worksheet, issues: CoursewareImportIssue[]) {
  const headers = new Map<number, string>();
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    const name = text(cell.value);
    if (name) headers.set(column, name);
  });
  const rows: Row[] = [];
  sheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    if (rowNumber === 1) return;
    const values = new Map<string, unknown>();
    let populated = false;
    headers.forEach((header, column) => {
      const value = excelRow.getCell(column).value;
      if (value !== null && value !== undefined && value !== "") populated = true;
      if (value && typeof value === "object" && ("formula" in value || "sharedFormula" in value)) {
        issues.push(issue(sheet.name, rowNumber, header, "FORMULA_NOT_ALLOWED", "业务字段不允许使用公式"));
        values.set(header, undefined);
      } else values.set(header, value);
    });
    if (populated) rows.push({ sheet: sheet.name, row: rowNumber, values });
  });
  return rows;
}

const value = (row: Row, name: string) => row.values.get(name);
const rowText = (row: Row, name: string) => text(value(row, name));
function positiveInteger(row: Row, name: string, issues: CoursewareImportIssue[], context: Partial<CoursewareImportIssue>) {
  const raw = rowText(row, name);
  const number = Number(raw);
  if (!raw || !Number.isInteger(number) || number < 1) {
    issues.push(issue(row.sheet, row.row, name, "INVALID_INTEGER", `${name}必须为正整数`, context));
    return null;
  }
  return number;
}

function required(row: Row, name: string, issues: CoursewareImportIssue[], context: Partial<CoursewareImportIssue>) {
  const result = rowText(row, name);
  if (!result) issues.push(issue(row.sheet, row.row, name, "REQUIRED", `${name}不能为空`, context));
  return result;
}

function duplicateCodes(rows: Row[], field: string, code: string, issues: CoursewareImportIssue[], courseOf: (row: Row) => string | undefined) {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const key = rowText(row, field);
    if (key) grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  for (const [key, duplicates] of grouped) {
    if (duplicates.length < 2) continue;
    duplicates.forEach((row) => {
      const courseCode = courseOf(row);
      issues.push(issue(row.sheet, row.row, field, code, `${field}重复：${key}`, courseCode ? { courseCode } : {}));
    });
  }
  return new Set([...grouped].filter(([, values]) => values.length > 1).map(([key]) => key));
}

export async function parseCoursewareXlsx(buffer: Buffer): Promise<ParsedCoursewareImport> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    return { templateVersion: COURSEWARE_SCHEMA_VERSION, courses: [], issues: [issue("工作簿", 0, "文件", "INVALID_XLSX", "无法读取 XLSX 工作簿")] };
  }

  const issues: CoursewareImportIssue[] = [];
  const byName = new Map(workbook.worksheets.map((sheet) => [sheet.name, sheet]));
  for (const name of requiredSheets) if (!byName.has(name)) issues.push(issue(name, 0, "工作表", "MISSING_SHEET", `缺少工作表：${name}`));
  if (issues.length) return { templateVersion: COURSEWARE_SCHEMA_VERSION, courses: [], issues };

  const courseRows = sheetRows(byName.get("课程")!, issues);
  const unitRows = sheetRows(byName.get("单元")!, issues);
  const blockRows = sheetRows(byName.get("内容块")!, issues);
  const checkpointRows = sheetRows(byName.get("随堂题")!, issues);
  const scenarioRows = sheetRows(byName.get("情境选择")!, issues);
  const scenarioGroups = new Map<string, Row[]>();
  scenarioRows.forEach((row) => {
    const blockCode = rowText(row, "内容块编码");
    if (blockCode) scenarioGroups.set(blockCode, [...(scenarioGroups.get(blockCode) ?? []), row]);
  });

  const versions = new Set(courseRows.map((row) => Number(rowText(row, "模板版本"))).filter(Number.isFinite));
  const templateVersion = versions.size === 1 ? [...versions][0]! : COURSEWARE_SCHEMA_VERSION;
  if (versions.size !== 1 || templateVersion !== COURSEWARE_SCHEMA_VERSION) {
    issues.push(issue("课程", courseRows[0]?.row ?? 1, "模板版本", "UNSUPPORTED_TEMPLATE_VERSION", `模板版本必须为 ${COURSEWARE_SCHEMA_VERSION}`));
  }

  const duplicateCourseCodes = duplicateCodes(courseRows, "课程编码", "DUPLICATE_COURSE_CODE", issues, (row) => rowText(row, "课程编码"));
  const duplicateUnitCodes = duplicateCodes(unitRows, "单元编码", "DUPLICATE_UNIT_CODE", issues, (row) => rowText(row, "课程编码"));
  const duplicateBlockCodes = duplicateCodes([...blockRows, ...checkpointRows, ...[...scenarioGroups.values()].map((rows) => rows[0]!)], "内容块编码", "DUPLICATE_BLOCK_CODE", issues, () => undefined);
  const coursesByCode = new Map<string, Row>();
  courseRows.forEach((row) => {
    const courseCode = required(row, "课程编码", issues, {});
    required(row, "标题", issues, { courseCode });
    required(row, "摘要", issues, { courseCode });
    if (!list(value(row, "学习目标")).length) issues.push(issue(row.sheet, row.row, "学习目标", "REQUIRED", "学习目标不能为空", { courseCode }));
    positiveInteger(row, "预计时长", issues, { courseCode });
    if (courseCode && !coursesByCode.has(courseCode)) coursesByCode.set(courseCode, row);
  });

  const unitsByCode = new Map<string, Row>();
  const unitsByCourse = new Map<string, Row[]>();
  unitRows.forEach((row) => {
    const courseCode = required(row, "课程编码", issues, {});
    const unitCode = required(row, "单元编码", issues, { courseCode });
    required(row, "标题", issues, { courseCode, unitCode });
    positiveInteger(row, "顺序", issues, { courseCode, unitCode });
    positiveInteger(row, "预计时长", issues, { courseCode, unitCode });
    if (courseCode && !coursesByCode.has(courseCode)) issues.push(issue(row.sheet, row.row, "课程编码", "UNKNOWN_COURSE_CODE", `课程编码不存在：${courseCode}`, { courseCode, unitCode }));
    if (unitCode && !unitsByCode.has(unitCode)) unitsByCode.set(unitCode, row);
    if (courseCode) unitsByCourse.set(courseCode, [...(unitsByCourse.get(courseCode) ?? []), row]);
  });

  const blocksByUnit = new Map<string, Array<{ order: number; block: CoursewareBlock; assetPath?: string; assetRow?: number }>>();
  const addBlock = (unitCode: string, order: number, block: CoursewareBlock, assetPath?: string, assetRow?: number) => {
    blocksByUnit.set(unitCode, [...(blocksByUnit.get(unitCode) ?? []), { order, block, ...(assetPath ? { assetPath, ...(assetRow === undefined ? {} : { assetRow }) } : {}) }]);
  };
  const contextForUnit = (unitCode: string) => {
    const unit = unitsByCode.get(unitCode);
    const courseCode = unit ? rowText(unit, "课程编码") : "";
    return { unitCode, ...(courseCode ? { courseCode } : {}) };
  };
  const validateAndAddBlock = (row: Row, unitCode: string, order: number, candidate: unknown, assetPath?: string) => {
    const checked = CoursewareBlockSchema.safeParse(candidate);
    if (!checked.success) {
      checked.error.issues.forEach((entry) => issues.push(issue(row.sheet, row.row, entry.path.join("."), "INVALID_BLOCK", entry.message, contextForUnit(unitCode))));
      return;
    }
    addBlock(unitCode, order, checked.data, assetPath, assetPath ? row.row : undefined);
  };

  blockRows.forEach((row) => {
    const unitCode = required(row, "单元编码", issues, {});
    const blockCode = required(row, "内容块编码", issues, { unitCode });
    const kind = required(row, "块类型", issues, contextForUnit(unitCode));
    const order = positiveInteger(row, "顺序", issues, contextForUnit(unitCode));
    if (!unitsByCode.has(unitCode)) {
      issues.push(issue(row.sheet, row.row, "单元编码", "UNKNOWN_UNIT_CODE", `单元编码不存在：${unitCode}`, { unitCode }));
      return;
    }
    if (!blockCode || !order || duplicateBlockCodes.has(blockCode)) return;
    const title = rowText(row, "标题");
    const body = rowText(row, "正文");
    const items = list(value(row, "列表项"));
    const donts = list(value(row, "禁止项"));
    const assetPath = rowText(row, "素材文件名");
    if (kind === "knowledge") validateAndAddBlock(row, unitCode, order, { key: blockCode, type: "knowledge", title, body, imageFileId: null }, assetPath || undefined);
    else if (kind === "do_dont") validateAndAddBlock(row, unitCode, order, { key: blockCode, type: "do_dont", title, dos: items, donts });
    else if (kind === "steps") validateAndAddBlock(row, unitCode, order, { key: blockCode, type: "steps", title, steps: items });
    else if (kind === "summary") validateAndAddBlock(row, unitCode, order, { key: blockCode, type: "summary", points: items });
    else issues.push(issue(row.sheet, row.row, "块类型", "INVALID_BLOCK_TYPE", `不支持的块类型：${kind}`, contextForUnit(unitCode)));
  });

  checkpointRows.forEach((row) => {
    const unitCode = required(row, "单元编码", issues, {});
    const blockCode = required(row, "内容块编码", issues, { unitCode });
    const order = positiveInteger(row, "顺序", issues, contextForUnit(unitCode));
    if (!unitsByCode.has(unitCode)) {
      issues.push(issue(row.sheet, row.row, "单元编码", "UNKNOWN_UNIT_CODE", `单元编码不存在：${unitCode}`, { unitCode }));
      return;
    }
    if (!blockCode || !order || duplicateBlockCodes.has(blockCode)) return;
    const aliases: Record<string, "single_choice" | "multiple_choice" | "true_false"> = { single_choice: "single_choice", multiple_choice: "multiple_choice", true_false: "true_false", 单选: "single_choice", 多选: "multiple_choice", 判断: "true_false" };
    const questionType = aliases[rowText(row, "题型")];
    if (!questionType) {
      issues.push(issue(row.sheet, row.row, "题型", "INVALID_QUESTION_TYPE", "题型必须为单选、多选或判断", contextForUnit(unitCode)));
      return;
    }
    const options = list(value(row, "选项"));
    const correctIndexes = rowText(row, "答案").split(/[,，\s]+/).filter(Boolean).map((item) => Number(item) - 1);
    validateAndAddBlock(row, unitCode, order, {
      key: blockCode,
      type: "checkpoint",
      prompt: rowText(row, "题干"),
      questionType,
      options,
      correctIndexes,
      explanation: rowText(row, "解析")
    });
  });

  for (const [blockCode, rows] of scenarioGroups) {
    const first = rows[0]!;
    if (duplicateBlockCodes.has(blockCode)) continue;
    const unitCode = required(first, "单元编码", issues, {});
    const order = positiveInteger(first, "顺序", issues, contextForUnit(unitCode));
    rows.forEach((row) => {
      required(row, "选项", issues, contextForUnit(unitCode));
      required(row, "选择后果", issues, contextForUnit(unitCode));
      required(row, "制度依据", issues, contextForUnit(unitCode));
    });
    if (!unitsByCode.has(unitCode)) {
      issues.push(issue(first.sheet, first.row, "单元编码", "UNKNOWN_UNIT_CODE", `单元编码不存在：${unitCode}`, { unitCode }));
      continue;
    }
    const inconsistent = rows.some((row) => rowText(row, "单元编码") !== unitCode || rowText(row, "场景") !== rowText(first, "场景") || rowText(row, "顺序") !== rowText(first, "顺序"));
    if (inconsistent) {
      rows.forEach((row) => issues.push(issue(row.sheet, row.row, "内容块编码", "INCONSISTENT_SCENARIO", `同一情境编码 ${blockCode} 的场景、单元或顺序不一致`, contextForUnit(unitCode))));
      continue;
    }
    if (order) validateAndAddBlock(first, unitCode, order, {
      key: blockCode,
      type: "scenario",
      prompt: rowText(first, "场景"),
      choices: rows.map((row) => ({ label: rowText(row, "选项"), consequence: rowText(row, "选择后果"), basis: rowText(row, "制度依据") }))
    });
  }

  const courses: ParsedCoursewareImport["courses"] = [];
  for (const [courseCode, courseRow] of coursesByCode) {
    const unitRowsForCourse = unitsByCourse.get(courseCode) ?? [];
    const units = unitRowsForCourse.filter((row) => !duplicateUnitCodes.has(rowText(row, "单元编码"))).map((unitRow) => {
      const unitCode = rowText(unitRow, "单元编码");
      const blocks = (blocksByUnit.get(unitCode) ?? []).sort((left, right) => left.order - right.order).map(({ block }) => block);
      if (!blocks.length) issues.push(issue("单元", unitRow.row, "内容块", "EMPTY_UNIT", "单元至少需要一个有效内容块", { courseCode, unitCode }));
      return {
        key: unitCode,
        title: rowText(unitRow, "标题"),
        estimatedMinutes: Number(rowText(unitRow, "预计时长")),
        blocks
      };
    }).sort((left, right) => Number(rowText(unitsByCode.get(left.key)!, "顺序")) - Number(rowText(unitsByCode.get(right.key)!, "顺序")));
    const candidate = {
      schemaVersion: COURSEWARE_SCHEMA_VERSION,
      title: rowText(courseRow, "标题"),
      summary: rowText(courseRow, "摘要"),
      learningObjectives: list(value(courseRow, "学习目标")),
      estimatedMinutes: Number(rowText(courseRow, "预计时长")),
      units
    };
    const checked = StructuredCoursewareDocumentSchema.safeParse(candidate);
    if (!checked.success) checked.error.issues.forEach((entry) => issues.push(issue("课程", courseRow.row, entry.path.join("."), "INVALID_DOCUMENT", entry.message, { courseCode })));
    const assetBindings = unitRowsForCourse.flatMap((unitRow) => (blocksByUnit.get(rowText(unitRow, "单元编码")) ?? []))
      .filter((entry) => entry.assetPath)
      .map((entry) => ({ blockKey: entry.block.key, path: entry.assetPath!, sheet: "内容块", ...(entry.assetRow === undefined ? {} : { row: entry.assetRow }) }));
    courses.push({ courseCode, title: candidate.title, document: checked.success ? checked.data : candidate as StructuredCoursewareDocument, assetBindings, duplicateCode: duplicateCourseCodes.has(courseCode) });
  }

  return { templateVersion, courses, issues };
}
