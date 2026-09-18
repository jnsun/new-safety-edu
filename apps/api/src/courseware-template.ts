import ExcelJS from "exceljs";
import { COURSEWARE_SCHEMA_VERSION, type CoursewareBlock, type StructuredCoursewareDocument } from "@safety/contracts";

export const COURSEWARE_TEMPLATE_VERSION = COURSEWARE_SCHEMA_VERSION;

export const anonymousCoursewareDocument: StructuredCoursewareDocument = {
  schemaVersion: COURSEWARE_SCHEMA_VERSION,
  title: "匿名安全学习示例",
  summary: "用于说明结构化课件导入格式，不包含真实人员或业务数据。",
  learningObjectives: ["识别示例风险", "掌握示例处置步骤"],
  estimatedMinutes: 12,
  units: [{
    key: "UNIT-001",
    title: "示例单元",
    estimatedMinutes: 12,
    blocks: [
      { key: "BLOCK-KNOWLEDGE", type: "knowledge", title: "知识卡", body: "这里填写简洁、可执行的安全知识。", imageFileId: null },
      { key: "BLOCK-DO-DONT", type: "do_dont", title: "应做与禁止", dos: ["按规定操作"], donts: ["不得冒险作业"] },
      { key: "BLOCK-STEPS", type: "steps", title: "操作步骤", steps: ["确认环境", "执行操作", "完成复核"] },
      { key: "BLOCK-CHECK", type: "checkpoint", prompt: "发现异常后首先应当做什么？", questionType: "single_choice", options: ["停止并报告", "继续作业"], correctIndexes: [0], explanation: "先停止风险行为，再按制度报告。" },
      { key: "BLOCK-SCENE", type: "scenario", prompt: "同事要求跳过检查时，你会怎么做？", choices: [{ label: "拒绝并说明要求", consequence: "避免带风险作业", basis: "作业前检查要求" }, { label: "直接开始作业", consequence: "可能遗漏风险", basis: "不符合安全操作要求" }] },
      { key: "BLOCK-SUMMARY", type: "summary", points: ["先确认风险", "按步骤作业", "异常立即报告"] }
    ]
  }]
};

type XlsxCourse = { courseCode: string; document: StructuredCoursewareDocument; assetPaths?: Record<string, string> };

const columns = {
  courses: ["模板版本", "课程编码", "标题", "摘要", "学习目标", "预计时长"],
  units: ["课程编码", "单元编码", "标题", "顺序", "预计时长"],
  blocks: ["课程编码", "单元编码", "内容块编码", "块类型", "顺序", "标题", "正文", "列表项", "禁止项", "素材文件名"],
  checkpoints: ["课程编码", "单元编码", "内容块编码", "顺序", "题型", "题干", "选项", "答案", "解析"],
  scenarios: ["课程编码", "单元编码", "内容块编码", "顺序", "场景", "选项", "选择后果", "制度依据"]
} as const;

function configureSheet(sheet: ExcelJS.Worksheet, headers: readonly string[], widths: number[]) {
  sheet.addRow([...headers]);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  sheet.columns.forEach((column, index) => { column.width = widths[index] ?? 18; });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  headers.forEach((header, index) => { sheet.getCell(1, index + 1).note = `字段：${header}。请使用固定编码关联课程、单元和内容块，不要按名称关联。`; });
}

function blockRow(courseCode: string, unitKey: string, block: CoursewareBlock, order: number, assetPaths: Record<string, string>) {
  if (block.type === "knowledge") return [courseCode, unitKey, block.key, block.type, order, block.title, block.body, "", "", assetPaths[block.key] ?? ""];
  if (block.type === "do_dont") return [courseCode, unitKey, block.key, block.type, order, block.title, "", block.dos.join("\n"), block.donts.join("\n"), ""];
  if (block.type === "steps") return [courseCode, unitKey, block.key, block.type, order, block.title, "", block.steps.join("\n"), "", ""];
  if (block.type === "summary") return [courseCode, unitKey, block.key, block.type, order, "", "", block.points.join("\n"), "", ""];
  return null;
}

export async function createCoursewareXlsx(courses: XlsxCourse[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "安全生产管理平台";
  workbook.created = new Date(0);
  const courseSheet = workbook.addWorksheet("课程");
  const unitSheet = workbook.addWorksheet("单元");
  const blockSheet = workbook.addWorksheet("内容块");
  const checkpointSheet = workbook.addWorksheet("随堂题");
  const scenarioSheet = workbook.addWorksheet("情境选择");
  configureSheet(courseSheet, columns.courses, [12, 22, 28, 42, 42, 12]);
  configureSheet(unitSheet, columns.units, [22, 22, 28, 10, 12]);
  configureSheet(blockSheet, columns.blocks, [22, 22, 24, 18, 10, 28, 48, 42, 42, 36]);
  configureSheet(checkpointSheet, columns.checkpoints, [22, 22, 24, 10, 18, 42, 42, 16, 42]);
  configureSheet(scenarioSheet, columns.scenarios, [22, 22, 24, 10, 42, 32, 42, 42]);

  for (const { courseCode, document, assetPaths = {} } of courses) {
    courseSheet.addRow([COURSEWARE_TEMPLATE_VERSION, courseCode, document.title, document.summary, document.learningObjectives.join("\n"), document.estimatedMinutes]);
    document.units.forEach((unit, unitIndex) => {
      unitSheet.addRow([courseCode, unit.key, unit.title, unitIndex + 1, unit.estimatedMinutes]);
      unit.blocks.forEach((block, blockIndex) => {
        const row = blockRow(courseCode, unit.key, block, blockIndex + 1, assetPaths);
        if (row) blockSheet.addRow(row);
        else if (block.type === "checkpoint") checkpointSheet.addRow([courseCode, unit.key, block.key, blockIndex + 1, block.questionType, block.prompt, block.options.join("\n"), block.correctIndexes.map((index) => index + 1).join(","), block.explanation]);
        else if (block.type === "scenario") block.choices.forEach((choice) => scenarioSheet.addRow([courseCode, unit.key, block.key, blockIndex + 1, block.prompt, choice.label, choice.consequence, choice.basis]));
      });
    });
  }

  for (let row = 2; row <= 1000; row += 1) checkpointSheet.getCell(row, 5).dataValidation = { type: "list", allowBlank: false, formulae: ['"single_choice,multiple_choice,true_false"'] };
  for (let row = 2; row <= 1000; row += 1) blockSheet.getCell(row, 4).dataValidation = { type: "list", allowBlank: false, formulae: ['"knowledge,do_dont,steps,summary"'] };
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

export function createCoursewareJsonTemplate() {
  return Buffer.from(JSON.stringify({ templateVersion: COURSEWARE_TEMPLATE_VERSION, courses: [{ courseCode: "COURSE-EXAMPLE", document: anonymousCoursewareDocument }] }, null, 2));
}

export function createCoursewareJsonSchema() {
  const text = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
  const key = text(120);
  const strictObject = (required: string[], properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required, properties });
  const blockBase = { key };
  return Buffer.from(JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "结构化课件导入包",
    type: "object",
    additionalProperties: false,
    required: ["templateVersion", "courses"],
    properties: {
      templateVersion: { const: COURSEWARE_TEMPLATE_VERSION },
      courses: { type: "array", minItems: 1, items: { $ref: "#/$defs/course" } }
    },
    $defs: {
      course: strictObject(["courseCode", "document"], { courseCode: text(120), document: { $ref: "#/$defs/document" }, assets: { type: "array", items: { $ref: "#/$defs/asset" } } }),
      asset: strictObject(["blockKey", "path"], { blockKey: key, path: { type: "string", pattern: "^assets/[A-Za-z0-9._/-]+$" } }),
      document: strictObject(["schemaVersion", "title", "summary", "learningObjectives", "estimatedMinutes", "units"], {
        schemaVersion: { const: COURSEWARE_SCHEMA_VERSION }, title: text(180), summary: text(2000), learningObjectives: { type: "array", minItems: 1, maxItems: 20, items: text(500) }, estimatedMinutes: { type: "integer", minimum: 1, maximum: 480 }, units: { type: "array", minItems: 1, maxItems: 50, items: { $ref: "#/$defs/unit" } }
      }),
      unit: strictObject(["key", "title", "estimatedMinutes", "blocks"], { key, title: text(160), estimatedMinutes: { type: "integer", minimum: 1, maximum: 120 }, blocks: { type: "array", minItems: 1, maxItems: 100, items: { oneOf: [{ $ref: "#/$defs/knowledge" }, { $ref: "#/$defs/doDont" }, { $ref: "#/$defs/steps" }, { $ref: "#/$defs/checkpoint" }, { $ref: "#/$defs/scenario" }, { $ref: "#/$defs/summary" }] } } }),
      knowledge: strictObject(["key", "type", "title", "body", "imageFileId"], { ...blockBase, type: { const: "knowledge" }, title: text(160), body: text(10_000), imageFileId: { type: ["string", "null"], format: "uuid" } }),
      doDont: strictObject(["key", "type", "title", "dos", "donts"], { ...blockBase, type: { const: "do_dont" }, title: text(160), dos: { type: "array", minItems: 1, maxItems: 20, items: text(500) }, donts: { type: "array", minItems: 1, maxItems: 20, items: text(500) } }),
      steps: strictObject(["key", "type", "title", "steps"], { ...blockBase, type: { const: "steps" }, title: text(160), steps: { type: "array", minItems: 1, maxItems: 30, items: text(1000) } }),
      checkpoint: strictObject(["key", "type", "prompt", "questionType", "options", "correctIndexes", "explanation"], { ...blockBase, type: { const: "checkpoint" }, prompt: text(2000), questionType: { enum: ["single_choice", "multiple_choice", "true_false"] }, options: { type: "array", minItems: 2, maxItems: 20, items: text(500) }, correctIndexes: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: { type: "integer", minimum: 0 } }, explanation: text(4000) }),
      scenario: strictObject(["key", "type", "prompt", "choices"], { ...blockBase, type: { const: "scenario" }, prompt: text(3000), choices: { type: "array", minItems: 2, maxItems: 20, items: strictObject(["label", "consequence", "basis"], { label: text(500), consequence: text(3000), basis: text(3000) }) } }),
      summary: strictObject(["key", "type", "points"], { ...blockBase, type: { const: "summary" }, points: { type: "array", minItems: 1, maxItems: 5, items: text(1000) } })
    }
  }, null, 2));
}

export async function createAnonymousCoursewareXlsx() {
  return createCoursewareXlsx([{ courseCode: "COURSE-EXAMPLE", document: anonymousCoursewareDocument }]);
}

export async function createBlankCoursewareXlsx() {
  return createCoursewareXlsx([]);
}
