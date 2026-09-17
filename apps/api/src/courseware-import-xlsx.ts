import ExcelJS from "exceljs";
import * as unzipper from "unzipper";
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

const MAX_XLSX_BYTES = 20 * 1024 * 1024;
const MAX_XLSX_ENTRY_COUNT = 250;
const MAX_XLSX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_XLSX_TOTAL_BYTES = 80 * 1024 * 1024;
const MAX_XLSX_COMPRESSION_RATIO = 200;
const MAX_XLSX_ROWS = 20_000;
const MAX_XLSX_CELLS = 200_000;

export class CoursewareXlsxError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

function rejectXlsx(code: string, message: string): never { throw new CoursewareXlsxError(code, message); }

function safeOoxmlPath(path: string) {
  if (!path || path.includes("\0") || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) rejectXlsx("INVALID_XLSX_PATH", `XLSX 内部路径不安全：${path || "(空)"}`);
  const parts = path.split("/").filter((part) => part !== "");
  if (!parts.length || parts.some((part) => part === "." || part === "..")) rejectXlsx("INVALID_XLSX_PATH", `XLSX 内部路径不安全：${path}`);
  return parts.join("/");
}

async function readXlsxEntry(file: unzipper.File, path: string, state: { bytes: number; rows: number; cells: number }) {
  let entryBytes = 0;
  let carry = "";
  try {
    for await (const chunk of file.stream()) {
      const value = Buffer.from(chunk as Uint8Array);
      entryBytes += value.length;
      state.bytes += value.length;
      if (entryBytes > MAX_XLSX_ENTRY_BYTES) rejectXlsx("XLSX_ENTRY_SIZE_LIMIT", `XLSX 内部文件实际解压大小超过限制：${path}`);
      if (state.bytes > MAX_XLSX_TOTAL_BYTES) rejectXlsx("XLSX_TOTAL_SIZE_LIMIT", "XLSX 实际总解压大小超过限制");
      if (path.startsWith("xl/worksheets/") && path.endsWith(".xml")) {
        const text = carry + value.toString("utf8");
        const safeLength = Math.max(0, text.length - 8);
        for (const match of text.matchAll(/<row(?=\s|>)/g)) if ((match.index ?? 0) < safeLength) state.rows += 1;
        for (const match of text.matchAll(/<c(?=\s|>)/g)) if ((match.index ?? 0) < safeLength) state.cells += 1;
        if (state.rows > MAX_XLSX_ROWS) rejectXlsx("XLSX_ROW_LIMIT", "XLSX 工作表行数超过限制");
        if (state.cells > MAX_XLSX_CELLS) rejectXlsx("XLSX_CELL_LIMIT", "XLSX 工作表单元格数量超过限制");
        carry = text.slice(safeLength);
      }
    }
  } catch (error) {
    if (error instanceof CoursewareXlsxError) throw error;
    return rejectXlsx("INVALID_XLSX_ENTRY", `无法读取 XLSX 内部文件：${path}`);
  }
  if (path.startsWith("xl/worksheets/") && path.endsWith(".xml")) {
    state.rows += carry.match(/<row(?=\s|>)/g)?.length ?? 0;
    state.cells += carry.match(/<c(?=\s|>)/g)?.length ?? 0;
    if (state.rows > MAX_XLSX_ROWS) rejectXlsx("XLSX_ROW_LIMIT", "XLSX 工作表行数超过限制");
    if (state.cells > MAX_XLSX_CELLS) rejectXlsx("XLSX_CELL_LIMIT", "XLSX 工作表单元格数量超过限制");
  }
  if (entryBytes !== file.uncompressedSize) rejectXlsx("XLSX_ENTRY_SIZE_MISMATCH", `XLSX 内部文件大小不一致：${path}`);
}

async function preflightCoursewareXlsx(buffer: Buffer) {
  if (!buffer.length || buffer.length > MAX_XLSX_BYTES) rejectXlsx("XLSX_SIZE_LIMIT", "XLSX 文件大小超过限制");
  let directory: unzipper.CentralDirectory;
  try { directory = await unzipper.Open.buffer(buffer); }
  catch { return rejectXlsx("INVALID_XLSX", "无法读取 XLSX 文件"); }
  if (directory.files.length > MAX_XLSX_ENTRY_COUNT) rejectXlsx("XLSX_ENTRY_LIMIT", "XLSX 内部文件数量超过限制");
  const state = { bytes: 0, rows: 0, cells: 0 };
  const seen = new Set<string>();
  for (const file of directory.files) {
    const path = safeOoxmlPath(file.path);
    const folded = path.normalize("NFC").toLocaleLowerCase("en-US");
    if (seen.has(folded)) rejectXlsx("DUPLICATE_XLSX_ENTRY", `XLSX 存在重复内部文件名：${path}`);
    seen.add(folded);
    const directoryEntry = file.path.endsWith("/");
    const unixOrigin = (file.versionMadeBy >>> 8) === 3;
    if (unixOrigin) {
      const kind = ((file.externalFileAttributes >>> 16) & 0xffff) & 0o170000;
      if (kind && kind !== (directoryEntry ? 0o040000 : 0o100000)) rejectXlsx("NON_REGULAR_XLSX_ENTRY", `XLSX 包含符号链接或非普通文件：${path}`);
    }
    if ((file.flags & 1) !== 0) rejectXlsx("ENCRYPTED_XLSX_ENTRY", `XLSX 不允许加密内部文件：${path}`);
    if (file.compressionMethod !== 0 && file.compressionMethod !== 8) rejectXlsx("UNSUPPORTED_XLSX_COMPRESSION", `XLSX 压缩方法不受支持：${path}`);
    const lower = path.toLocaleLowerCase("en-US");
    if (lower === "xl/vbaproject.bin" || lower.startsWith("xl/macrosheets/")) rejectXlsx("MACRO_WORKBOOK_NOT_ALLOWED", "不允许导入含宏工作簿");
    if (directoryEntry) continue;
    if (file.uncompressedSize > MAX_XLSX_ENTRY_BYTES) rejectXlsx("XLSX_ENTRY_SIZE_LIMIT", `XLSX 内部文件解压大小超过限制：${path}`);
    if (file.uncompressedSize > 0 && (file.compressedSize === 0 || file.uncompressedSize / file.compressedSize > MAX_XLSX_COMPRESSION_RATIO)) {
      rejectXlsx("XLSX_COMPRESSION_RATIO_LIMIT", `XLSX 内部文件压缩比异常：${path}`);
    }
    await readXlsxEntry(file, path, state);
  }
}

function issue(sheet: string, row: number, field: string, code: string, message: string, context: Partial<CoursewareImportIssue> = {}): CoursewareImportIssue {
  return { file: "", sheet, row, field, code, message, ...context };
}

function sheetRows(sheet: ExcelJS.Worksheet, issues: CoursewareImportIssue[]) {
  const headers = new Map<number, string>();
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    if (cell.value && typeof cell.value === "object" && ("formula" in cell.value || "sharedFormula" in cell.value)) {
      issues.push(issue(sheet.name, 1, `第 ${column} 列`, "FORMULA_NOT_ALLOWED", "表头不允许使用公式"));
      return;
    }
    const name = text(cell.value);
    if (name) headers.set(column, name);
  });
  const rows: Row[] = [];
  sheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    if (rowNumber === 1) return;
    const values = new Map<string, unknown>();
    const formulas: string[] = [];
    let populated = false;
    headers.forEach((header, column) => {
      const value = excelRow.getCell(column).value;
      if (value !== null && value !== undefined && value !== "") populated = true;
      if (value && typeof value === "object" && ("formula" in value || "sharedFormula" in value)) {
        formulas.push(header);
        values.set(header, undefined);
      } else values.set(header, value);
    });
    if (populated) {
      const courseCode = text(values.get("课程编码"));
      formulas.forEach((header) => issues.push(issue(sheet.name, rowNumber, header, "FORMULA_NOT_ALLOWED", "业务字段不允许使用公式", courseCode ? { courseCode } : {})));
      rows.push({ sheet: sheet.name, row: rowNumber, values });
    }
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

function courseCode(row: Row, issues: CoursewareImportIssue[]) {
  const raw = value(row, "课程编码");
  const result = required(row, "课程编码", issues, {});
  if (result && typeof raw !== "string") issues.push(issue(row.sheet, row.row, "课程编码", "INVALID_COURSE_CODE", "课程编码必须为文本", { courseCode: result }));
  if (result.length > 120) issues.push(issue(row.sheet, row.row, "课程编码", "INVALID_COURSE_CODE", "课程编码不能超过 120 个字符", { courseCode: result }));
  return result;
}

function duplicateCodes(
  rows: Row[],
  field: string,
  code: string,
  issues: CoursewareImportIssue[],
  courseOf: (row: Row) => string | undefined,
  identityOf: (row: Row) => string = (row) => rowText(row, field)
) {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const key = identityOf(row);
    if (key) grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  for (const [key, duplicates] of grouped) {
    if (duplicates.length < 2) continue;
    duplicates.forEach((row) => {
      const courseCode = courseOf(row);
      issues.push(issue(row.sheet, row.row, field, code, `${field}重复：${rowText(row, field)}`, courseCode ? { courseCode } : {}));
    });
  }
  return new Set([...grouped].filter(([, values]) => values.length > 1).map(([key]) => key));
}

export async function parseCoursewareXlsx(buffer: Buffer): Promise<ParsedCoursewareImport> {
  await preflightCoursewareXlsx(buffer);
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
  const composite = (courseCode: string, localCode: string) => `${courseCode}\0${localCode}`;
  const scenarioGroups = new Map<string, Row[]>();
  scenarioRows.forEach((row) => {
    const courseCode = rowText(row, "课程编码");
    const blockCode = rowText(row, "内容块编码");
    if (courseCode && blockCode) {
      const key = composite(courseCode, blockCode);
      scenarioGroups.set(key, [...(scenarioGroups.get(key) ?? []), row]);
    }
  });

  const versions = new Set(courseRows.map((row) => Number(rowText(row, "模板版本"))).filter(Number.isFinite));
  const templateVersion = versions.size === 1 ? [...versions][0]! : COURSEWARE_SCHEMA_VERSION;
  if (versions.size !== 1 || templateVersion !== COURSEWARE_SCHEMA_VERSION) {
    issues.push(issue("课程", courseRows[0]?.row ?? 1, "模板版本", "UNSUPPORTED_TEMPLATE_VERSION", `模板版本必须为 ${COURSEWARE_SCHEMA_VERSION}`));
  }

  const duplicateCourseCodes = duplicateCodes(courseRows, "课程编码", "DUPLICATE_COURSE_CODE", issues, (row) => rowText(row, "课程编码"));
  const duplicateUnitCodes = duplicateCodes(unitRows, "单元编码", "DUPLICATE_UNIT_CODE", issues, (row) => rowText(row, "课程编码"), (row) => composite(rowText(row, "课程编码"), rowText(row, "单元编码")));
  const duplicateBlockCodes = duplicateCodes(
    [...blockRows, ...checkpointRows, ...[...scenarioGroups.values()].map((rows) => rows[0]!)],
    "内容块编码",
    "DUPLICATE_BLOCK_CODE",
    issues,
    (row) => rowText(row, "课程编码"),
    (row) => composite(rowText(row, "课程编码"), rowText(row, "内容块编码"))
  );
  const coursesByCode = new Map<string, Row>();
  courseRows.forEach((row) => {
    const code = courseCode(row, issues);
    required(row, "标题", issues, { courseCode: code });
    required(row, "摘要", issues, { courseCode: code });
    if (!list(value(row, "学习目标")).length) issues.push(issue(row.sheet, row.row, "学习目标", "REQUIRED", "学习目标不能为空", { courseCode: code }));
    positiveInteger(row, "预计时长", issues, { courseCode: code });
    if (code && !coursesByCode.has(code)) coursesByCode.set(code, row);
  });

  const unitsByCode = new Map<string, Row>();
  const unitsByCourse = new Map<string, Row[]>();
  unitRows.forEach((row) => {
    const code = courseCode(row, issues);
    const unitCode = required(row, "单元编码", issues, { courseCode: code });
    required(row, "标题", issues, { courseCode: code, unitCode });
    positiveInteger(row, "顺序", issues, { courseCode: code, unitCode });
    positiveInteger(row, "预计时长", issues, { courseCode: code, unitCode });
    if (code && !coursesByCode.has(code)) issues.push(issue(row.sheet, row.row, "课程编码", "UNKNOWN_COURSE_CODE", `课程编码不存在：${code}`, { courseCode: code, unitCode }));
    const unitIdentity = composite(code, unitCode);
    if (code && unitCode && !unitsByCode.has(unitIdentity)) unitsByCode.set(unitIdentity, row);
    if (code) unitsByCourse.set(code, [...(unitsByCourse.get(code) ?? []), row]);
  });

  const blocksByUnit = new Map<string, Array<{ order: number; block: CoursewareBlock; assetPath?: string; assetRow?: number }>>();
  const addBlock = (courseCode: string, unitCode: string, order: number, block: CoursewareBlock, assetPath?: string, assetRow?: number) => {
    const unitIdentity = composite(courseCode, unitCode);
    blocksByUnit.set(unitIdentity, [...(blocksByUnit.get(unitIdentity) ?? []), { order, block, ...(assetPath ? { assetPath, ...(assetRow === undefined ? {} : { assetRow }) } : {}) }]);
  };
  const contextForUnit = (courseCode: string, unitCode: string) => {
    return { unitCode, ...(courseCode ? { courseCode } : {}) };
  };
  const validateAndAddBlock = (row: Row, courseCode: string, unitCode: string, order: number, candidate: unknown, assetPath?: string) => {
    const checked = CoursewareBlockSchema.safeParse(candidate);
    if (!checked.success) {
      checked.error.issues.forEach((entry) => issues.push(issue(row.sheet, row.row, entry.path.join("."), "INVALID_BLOCK", entry.message, contextForUnit(courseCode, unitCode))));
      return;
    }
    addBlock(courseCode, unitCode, order, checked.data, assetPath, assetPath ? row.row : undefined);
  };

  blockRows.forEach((row) => {
    const code = courseCode(row, issues);
    const unitCode = required(row, "单元编码", issues, { courseCode: code });
    const blockCode = required(row, "内容块编码", issues, { courseCode: code, unitCode });
    const context = contextForUnit(code, unitCode);
    const kind = required(row, "块类型", issues, context);
    const order = positiveInteger(row, "顺序", issues, context);
    if (!unitsByCode.has(composite(code, unitCode))) {
      issues.push(issue(row.sheet, row.row, "单元编码", "UNKNOWN_UNIT_CODE", `当前课程中不存在单元编码：${unitCode}`, context));
      return;
    }
    if (!blockCode || !order || duplicateBlockCodes.has(composite(code, blockCode))) return;
    const title = rowText(row, "标题");
    const body = rowText(row, "正文");
    const items = list(value(row, "列表项"));
    const donts = list(value(row, "禁止项"));
    const assetPath = rowText(row, "素材文件名");
    if (kind === "knowledge") validateAndAddBlock(row, code, unitCode, order, { key: blockCode, type: "knowledge", title, body, imageFileId: null }, assetPath || undefined);
    else if (kind === "do_dont") validateAndAddBlock(row, code, unitCode, order, { key: blockCode, type: "do_dont", title, dos: items, donts });
    else if (kind === "steps") validateAndAddBlock(row, code, unitCode, order, { key: blockCode, type: "steps", title, steps: items });
    else if (kind === "summary") validateAndAddBlock(row, code, unitCode, order, { key: blockCode, type: "summary", points: items });
    else issues.push(issue(row.sheet, row.row, "块类型", "INVALID_BLOCK_TYPE", `不支持的块类型：${kind}`, context));
  });

  checkpointRows.forEach((row) => {
    const code = courseCode(row, issues);
    const unitCode = required(row, "单元编码", issues, { courseCode: code });
    const context = contextForUnit(code, unitCode);
    const blockCode = required(row, "内容块编码", issues, context);
    const order = positiveInteger(row, "顺序", issues, context);
    if (!unitsByCode.has(composite(code, unitCode))) {
      issues.push(issue(row.sheet, row.row, "单元编码", "UNKNOWN_UNIT_CODE", `当前课程中不存在单元编码：${unitCode}`, context));
      return;
    }
    if (!blockCode || !order || duplicateBlockCodes.has(composite(code, blockCode))) return;
    const aliases: Record<string, "single_choice" | "multiple_choice" | "true_false"> = { single_choice: "single_choice", multiple_choice: "multiple_choice", true_false: "true_false", 单选: "single_choice", 多选: "multiple_choice", 判断: "true_false" };
    const questionType = aliases[rowText(row, "题型")];
    if (!questionType) {
      issues.push(issue(row.sheet, row.row, "题型", "INVALID_QUESTION_TYPE", "题型必须为单选、多选或判断", context));
      return;
    }
    const options = list(value(row, "选项"));
    const correctIndexes = rowText(row, "答案").split(/[,，\s]+/).filter(Boolean).map((item) => Number(item) - 1);
    validateAndAddBlock(row, code, unitCode, order, {
      key: blockCode,
      type: "checkpoint",
      prompt: rowText(row, "题干"),
      questionType,
      options,
      correctIndexes,
      explanation: rowText(row, "解析")
    });
  });

  for (const [blockIdentity, rows] of scenarioGroups) {
    const first = rows[0]!;
    if (duplicateBlockCodes.has(blockIdentity)) continue;
    const code = courseCode(first, issues);
    const unitCode = required(first, "单元编码", issues, { courseCode: code });
    const blockCode = required(first, "内容块编码", issues, { courseCode: code, unitCode });
    const context = contextForUnit(code, unitCode);
    const order = positiveInteger(first, "顺序", issues, context);
    rows.forEach((row) => {
      if (row !== first) courseCode(row, issues);
      required(row, "选项", issues, context);
      required(row, "选择后果", issues, context);
      required(row, "制度依据", issues, context);
    });
    if (!unitsByCode.has(composite(code, unitCode))) {
      issues.push(issue(first.sheet, first.row, "单元编码", "UNKNOWN_UNIT_CODE", `当前课程中不存在单元编码：${unitCode}`, context));
      continue;
    }
    const inconsistent = rows.some((row) => rowText(row, "课程编码") !== code || rowText(row, "单元编码") !== unitCode || rowText(row, "场景") !== rowText(first, "场景") || rowText(row, "顺序") !== rowText(first, "顺序"));
    if (inconsistent) {
      rows.forEach((row) => issues.push(issue(row.sheet, row.row, "内容块编码", "INCONSISTENT_SCENARIO", `同一课程内情境编码 ${blockCode} 的场景、单元或顺序不一致`, context)));
      continue;
    }
    if (order && blockCode) validateAndAddBlock(first, code, unitCode, order, {
      key: blockCode,
      type: "scenario",
      prompt: rowText(first, "场景"),
      choices: rows.map((row) => ({ label: rowText(row, "选项"), consequence: rowText(row, "选择后果"), basis: rowText(row, "制度依据") }))
    });
  }

  const courses: ParsedCoursewareImport["courses"] = [];
  for (const [courseCode, courseRow] of coursesByCode) {
    const unitRowsForCourse = unitsByCourse.get(courseCode) ?? [];
    const units = unitRowsForCourse.filter((row) => !duplicateUnitCodes.has(composite(courseCode, rowText(row, "单元编码")))).map((unitRow) => {
      const unitCode = rowText(unitRow, "单元编码");
      const blocks = (blocksByUnit.get(composite(courseCode, unitCode)) ?? []).sort((left, right) => left.order - right.order).map(({ block }) => block);
      if (!blocks.length) issues.push(issue("单元", unitRow.row, "内容块", "EMPTY_UNIT", "单元至少需要一个有效内容块", { courseCode, unitCode }));
      return {
        key: unitCode,
        title: rowText(unitRow, "标题"),
        estimatedMinutes: Number(rowText(unitRow, "预计时长")),
        blocks
      };
    }).sort((left, right) => Number(rowText(unitsByCode.get(composite(courseCode, left.key))!, "顺序")) - Number(rowText(unitsByCode.get(composite(courseCode, right.key))!, "顺序")));
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
    const assetBindings = unitRowsForCourse.flatMap((unitRow) => (blocksByUnit.get(composite(courseCode, rowText(unitRow, "单元编码"))) ?? []))
      .filter((entry) => entry.assetPath)
      .map((entry) => ({ blockKey: entry.block.key, path: entry.assetPath!, sheet: "内容块", ...(entry.assetRow === undefined ? {} : { row: entry.assetRow }) }));
    courses.push({ courseCode, title: candidate.title, document: checked.success ? checked.data : candidate as StructuredCoursewareDocument, assetBindings, duplicateCode: duplicateCourseCodes.has(courseCode) });
  }

  return { templateVersion, courses, issues };
}
