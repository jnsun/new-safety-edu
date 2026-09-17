import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import archiver from "archiver";
import ExcelJS from "exceljs";
import {
  coursewareImportConfirmationKey,
  confirmCoursewareImport,
  previewCoursewareImport,
  type CoursewareImportSessionData,
  type CoursewareImportSessionStore,
  type ExistingCoursewareReference
} from "../src/courseware-import.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const document = {
  schemaVersion: 1 as const,
  title: "匿名安全微课",
  summary: "匿名摘要",
  learningObjectives: ["识别风险", "正确处置"],
  estimatedMinutes: 15,
  units: [{
    key: "UNIT-001",
    title: "风险识别",
    estimatedMinutes: 8,
    blocks: [{ key: "BLOCK-001", type: "knowledge" as const, title: "知识卡", body: "匿名正文", imageFileId: null }]
  }]
};

async function workbookBuffer(options: { duplicate?: boolean; missingUnit?: boolean; asset?: string; formula?: boolean; emptyBody?: boolean } = {}) {
  const workbook = new ExcelJS.Workbook();
  const courses = workbook.addWorksheet("课程");
  courses.addRow(["模板版本", "课程编码", "标题", "摘要", "学习目标", "预计时长"]);
  courses.addRow([1, "SAFE-001", "匿名安全微课", "匿名摘要", "识别风险\n正确处置", 15]);
  if (options.formula) courses.getCell("C2").value = { formula: "1+1", result: "匿名安全微课" };
  if (options.duplicate) courses.addRow([1, "SAFE-001", "重复编码", "匿名摘要", "识别风险", 10]);
  const units = workbook.addWorksheet("单元");
  units.addRow(["课程编码", "单元编码", "标题", "顺序", "预计时长"]);
  units.addRow(["SAFE-001", "UNIT-001", "风险识别", 1, 8]);
  const blocks = workbook.addWorksheet("内容块");
  blocks.addRow(["单元编码", "内容块编码", "块类型", "标题", "正文", "素材文件名", "列表项", "禁止项", "顺序"]);
  blocks.addRow(["UNIT-001", "BLOCK-001", "knowledge", "知识卡", options.emptyBody ? "" : "匿名正文", options.asset ?? "", "", "", 1]);
  const checkpoints = workbook.addWorksheet("随堂题");
  checkpoints.addRow(["单元编码", "内容块编码", "题型", "题干", "选项", "答案", "解析", "顺序"]);
  if (options.missingUnit) checkpoints.addRow(["UNIT-404", "CHECK-001", "single_choice", "应如何处理？", "立即报告\n忽略", "1", "按制度报告", 2]);
  const scenarios = workbook.addWorksheet("情境选择");
  scenarios.addRow(["单元编码", "内容块编码", "场景", "选项", "选择后果", "制度依据", "顺序"]);
  scenarios.addRow(["UNIT-001", "SCENE-001", "发现隐患", "立即报告", "及时处置", "匿名制度条款", 3]);
  scenarios.addRow(["UNIT-001", "SCENE-001", "发现隐患", "继续作业", "风险扩大", "匿名制度条款", 3]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

type ZipEntry = { name: string; data?: Buffer; symlinkTarget?: string };
async function zip(entries: ZipEntry[]) {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const done = new Promise<Buffer>((resolve, reject) => {
    output.on("end", () => resolve(Buffer.concat(chunks)));
    output.on("error", reject);
  });
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (error) => output.destroy(error));
  archive.pipe(output);
  for (const entry of entries) {
    if (entry.symlinkTarget) archive.symlink(entry.name, entry.symlinkTarget);
    else archive.append(entry.data ?? Buffer.alloc(0), { name: entry.name });
  }
  await archive.finalize();
  return done;
}

function replaceStoredName(buffer: Buffer, replacement: string) {
  const source = Buffer.from("assets/diagram.png");
  const target = Buffer.from(replacement);
  assert.equal(target.length, source.length, "malicious fixture name must preserve ZIP header lengths");
  const changed = Buffer.from(buffer);
  for (let offset = changed.indexOf(source); offset >= 0; offset = changed.indexOf(source, offset + target.length)) target.copy(changed, offset);
  return changed;
}

const saved: CoursewareImportSessionData[] = [];
const store: CoursewareImportSessionStore = { async create(data) { saved.push(data); return { id: data.id }; } };
async function preview(filename: string, buffer: Buffer, existingCoursewares: ExistingCoursewareReference[] = []) {
  return previewCoursewareImport({ filename, buffer }, { createdBy: actorId, existingCoursewares, store, now: new Date("2026-09-17T00:00:00.000Z") });
}

const invalidWorkbook = await preview("anonymous.xlsx", await workbookBuffer({ duplicate: true, missingUnit: true, asset: "assets/missing.png" }));
assert.match(invalidWorkbook.sourceHash, /^[a-f0-9]{64}$/);
assert.ok(invalidWorkbook.items.some((item) => item.classification === "conflict" && item.courseCode === "SAFE-001"));
assert.ok(invalidWorkbook.issues.some((entry) => entry.sheet === "课程" && entry.row === 3 && entry.code === "DUPLICATE_COURSE_CODE"));
assert.ok(invalidWorkbook.issues.some((entry) => entry.sheet === "随堂题" && entry.row === 2 && entry.code === "UNKNOWN_UNIT_CODE"));
assert.ok(invalidWorkbook.issues.some((entry) => entry.sheet === "内容块" && entry.row === 2 && entry.code === "MISSING_ASSET"));
assert.ok(invalidWorkbook.issues.every((entry) => entry.file === "anonymous.xlsx"));

const formulaWorkbook = await preview("formula.xlsx", await workbookBuffer({ formula: true }));
assert.ok(formulaWorkbook.issues.some((entry) => entry.sheet === "课程" && entry.row === 2 && entry.field === "标题" && entry.code === "FORMULA_NOT_ALLOWED"));
const invalidBlockWorkbook = await preview("invalid-block.xlsx", await workbookBuffer({ emptyBody: true }));
assert.ok(invalidBlockWorkbook.issues.some((entry) => entry.sheet === "内容块" && entry.row === 2 && entry.field.endsWith("body") && entry.code === "INVALID_BLOCK"));
assert.ok((await preview("macro.xlsm", Buffer.from("anonymous"))).issues.some((entry) => entry.code === "MACRO_WORKBOOK_NOT_ALLOWED"));

const json = Buffer.from(JSON.stringify({ templateVersion: 1, courses: [{ courseCode: "SAFE-JSON", document }] }));
const created = await preview("courseware.json", json);
assert.equal(created.items[0]?.classification, "create");
const invalidJsonCourse = await preview("invalid-course.json", Buffer.from(JSON.stringify({ templateVersion: 1, courses: [{ courseCode: "SAFE-INVALID", document: { ...document, units: [] } }] })));
assert.equal(invalidJsonCourse.items[0]?.classification, "invalid");
const changed = await preview("courseware.json", json, [{ id: "10000000-0000-4000-8000-000000000001", code: "SAFE-JSON", type: "structured", latestContentHash: "different" }]);
assert.equal(changed.items[0]?.classification, "new_version");
const conflictingType = await preview("courseware.json", json, [{ id: "10000000-0000-4000-8000-000000000002", code: "SAFE-JSON", type: "rich_text", latestContentHash: null }]);
assert.equal(conflictingType.items[0]?.classification, "conflict");
assert.equal(conflictingType.items[0]?.issueCount, 1);

const otherDocument = structuredClone(document);
otherDocument.title = "另一门匿名课程";
otherDocument.units[0]!.key = "UNIT-002";
otherDocument.units[0]!.blocks[0]!.key = "BLOCK-002";
const crossCourseBinding = await preview("cross-course.json", Buffer.from(JSON.stringify({
  templateVersion: 1,
  courses: [
    { courseCode: "SAFE-A", document, assets: [{ blockKey: "BLOCK-002", path: "assets/diagram.png" }] },
    { courseCode: "SAFE-B", document: otherDocument }
  ]
})));
assert.ok(crossCourseBinding.issues.some((entry) => entry.code === "UNKNOWN_BLOCK_KEY" && entry.courseCode === "SAFE-A"));

const packageJson = Buffer.from(JSON.stringify({ templateVersion: 1, courses: [{ courseCode: "SAFE-ZIP", document, assets: [{ blockKey: "BLOCK-001", path: "assets/diagram.png" }] }] }));
const validPackage = await preview("courseware.zip", await zip([{ name: "courseware.json", data: packageJson }, { name: "assets/diagram.png", data: png }]));
assert.equal(validPackage.items[0]?.classification, "create");
assert.equal(validPackage.issues.length, 0);

const pathFixture = await zip([{ name: "courseware.json", data: packageJson }, { name: "assets/diagram.png", data: png }]);
for (const [label, replacement, expected] of [
  ["alternate separator", "assets\\diagram.png", "INVALID_ZIP_PATH"],
  ["parent traversal", "../evil/xxevil.png", "INVALID_ZIP_PATH"],
  ["absolute drive", "C:/evil/xxxxxx.png", "INVALID_ZIP_PATH"],
  ["hidden metadata", "assets/.hidden.png", "HIDDEN_ZIP_ENTRY"]
] as const) {
  const result = await preview(`${label}.zip`, replaceStoredName(pathFixture, replacement));
  assert.ok(result.issues.some((entry) => entry.code === expected), `${label} must be rejected with ${expected}`);
}

const invalidPackages: Array<[string, ZipEntry[], string]> = [
  ["duplicate folded name", [{ name: "courseware.json", data: packageJson }, { name: "assets/diagram.png", data: png }, { name: "assets/DIAGRAM.PNG", data: png }], "DUPLICATE_ZIP_ENTRY"],
  ["executable", [{ name: "courseware.json", data: packageJson }, { name: "assets/tool.exe", data: Buffer.from("MZ") }], "UNSUPPORTED_ASSET"],
  ["mime mismatch", [{ name: "courseware.json", data: packageJson }, { name: "assets/fake.png", data: Buffer.from("not-an-image") }], "ASSET_TYPE_MISMATCH"],
  ["symlink", [{ name: "courseware.json", data: packageJson }, { name: "assets/link.png", symlinkTarget: "../courseware.json" }], "NON_REGULAR_ZIP_ENTRY"],
  ["zip bomb ratio", [{ name: "courseware.json", data: packageJson }, { name: "assets/bomb.png", data: Buffer.alloc(2 * 1024 * 1024) }], "ZIP_COMPRESSION_RATIO_LIMIT"]
];
for (const [name, entries, expected] of invalidPackages) {
  const result = await preview(`${name}.zip`, await zip(entries));
  assert.ok(result.issues.some((entry) => entry.code === expected), `${name} must be rejected with ${expected}`);
}
const tooManyEntries = Array.from({ length: 250 }, (_, index) => ({ name: `assets/item-${String(index).padStart(3, "0")}.png`, data: png }));
assert.ok((await preview("too-many.zip", await zip([{ name: "courseware.json", data: packageJson }, ...tooManyEntries]))).issues.some((entry) => entry.code === "ZIP_ENTRY_LIMIT"));
assert.ok((await preview("entry-too-large.zip", await zip([{ name: "courseware.json", data: packageJson }, { name: "assets/large.png", data: Buffer.alloc(13 * 1024 * 1024) }]))).issues.some((entry) => entry.code === "ZIP_ENTRY_SIZE_LIMIT"));

const lastSession = saved.at(-1)!;
assert.equal(lastSession.createdBy, actorId);
assert.equal(lastSession.confirmationKey, coursewareImportConfirmationKey(lastSession.id, lastSession.sourceHash));
assert.equal(lastSession.expiresAt.toISOString(), "2026-09-17T00:30:00.000Z");
assert.ok(lastSession.parsedResult);
assert.ok(lastSession.previewResult);

const sessionRecord = { ...lastSession, status: "previewed", confirmedAt: null as Date | null, confirmResult: null as unknown };
const confirmationDb = {
  async $transaction<T>(run: (transaction: typeof transaction) => Promise<T>) { return run(transaction); }
};
const transaction = {
  coursewareImportSession: {
    async findUnique() { return sessionRecord; },
    async updateMany() {
      if (sessionRecord.status !== "previewed") return { count: 0 };
      sessionRecord.status = "confirming";
      return { count: 1 };
    },
    async update({ data }: { data: { status: string; confirmedAt: Date; confirmResult: unknown } }) {
      Object.assign(sessionRecord, data);
      return sessionRecord;
    }
  }
};
let applyCount = 0;
const firstConfirmation = await confirmCoursewareImport(confirmationDb, { previewId: lastSession.id, sourceHash: lastSession.sourceHash, actorId, now: new Date("2026-09-17T00:01:00.000Z") }, async (_tx, serverState) => {
  applyCount += 1;
  assert.deepEqual(serverState, { parsedResult: lastSession.parsedResult, previewResult: lastSession.previewResult });
  return { created: 1 };
});
const repeatedConfirmation = await confirmCoursewareImport(confirmationDb, { previewId: lastSession.id, sourceHash: lastSession.sourceHash, actorId, now: new Date("2026-09-17T00:02:00.000Z") }, async () => {
  applyCount += 1;
  return { created: 2 };
});
assert.deepEqual(firstConfirmation, { result: { created: 1 }, repeated: false });
assert.deepEqual(repeatedConfirmation, { result: { created: 1 }, repeated: true });
assert.equal(applyCount, 1);

console.log("courseware import checks passed");
