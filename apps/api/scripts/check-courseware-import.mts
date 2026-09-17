import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import archiver from "archiver";
import ExcelJS from "exceljs";
import {
  coursewareImportConfirmationKey,
  COURSEWARE_IMPORT_PARSER_VERSION,
  confirmCoursewareImport,
  previewCoursewareImport,
  type CoursewareImportSessionData,
  type CoursewareImportSessionStore,
  type ExistingCoursewareReference
} from "../src/courseware-import.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const companyScope = { scopeType: "company" as const, scopeId: null };
const organizationScope = { scopeType: "organization" as const, scopeId: "00000000-0000-4000-8000-000000000010" };
const sourceFileId = "00000000-0000-4000-8000-000000000020";
const confirmNow = new Date("2026-09-17T00:01:00.000Z");
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
  blocks.addRow(["课程编码", "单元编码", "内容块编码", "块类型", "标题", "正文", "素材文件名", "列表项", "禁止项", "顺序"]);
  blocks.addRow(["SAFE-001", "UNIT-001", "BLOCK-001", "knowledge", "知识卡", options.emptyBody ? "" : "匿名正文", options.asset ?? "", "", "", 1]);
  const checkpoints = workbook.addWorksheet("随堂题");
  checkpoints.addRow(["课程编码", "单元编码", "内容块编码", "题型", "题干", "选项", "答案", "解析", "顺序"]);
  if (options.missingUnit) checkpoints.addRow(["SAFE-001", "UNIT-404", "CHECK-001", "single_choice", "应如何处理？", "立即报告\n忽略", "1", "按制度报告", 2]);
  const scenarios = workbook.addWorksheet("情境选择");
  scenarios.addRow(["课程编码", "单元编码", "内容块编码", "场景", "选项", "选择后果", "制度依据", "顺序"]);
  scenarios.addRow(["SAFE-001", "UNIT-001", "SCENE-001", "发现隐患", "立即报告", "及时处置", "匿名制度条款", 3]);
  scenarios.addRow(["SAFE-001", "UNIT-001", "SCENE-001", "发现隐患", "继续作业", "风险扩大", "匿名制度条款", 3]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function multiCourseWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const courses = workbook.addWorksheet("课程");
  courses.addRow(["模板版本", "课程编码", "标题", "摘要", "学习目标", "预计时长"]);
  courses.addRow([1, "SAFE-A", "课程 A", "匿名摘要", "目标 A", 10]);
  courses.addRow([1, "SAFE-B", "课程 B", "匿名摘要", "目标 B", 10]);
  const units = workbook.addWorksheet("单元");
  units.addRow(["课程编码", "单元编码", "标题", "顺序", "预计时长"]);
  units.addRow(["SAFE-A", "SHARED-UNIT", "单元 A", 1, 5]);
  units.addRow(["SAFE-B", "SHARED-UNIT", "单元 B", 1, 5]);
  const blocks = workbook.addWorksheet("内容块");
  blocks.addRow(["课程编码", "单元编码", "内容块编码", "块类型", "标题", "正文", "素材文件名", "列表项", "禁止项", "顺序"]);
  blocks.addRow(["SAFE-A", "SHARED-UNIT", "SHARED-BLOCK", "knowledge", "无效块", "", "", "", "", 1]);
  blocks.addRow(["SAFE-B", "SHARED-UNIT", "SHARED-BLOCK", "knowledge", "有效块", "匿名正文", "", "", "", 1]);
  const checkpoints = workbook.addWorksheet("随堂题");
  checkpoints.addRow(["课程编码", "单元编码", "内容块编码", "题型", "题干", "选项", "答案", "解析", "顺序"]);
  const scenarios = workbook.addWorksheet("情境选择");
  scenarios.addRow(["课程编码", "单元编码", "内容块编码", "场景", "选项", "选择后果", "制度依据", "顺序"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

type ZipEntry = { name: string; data?: Buffer; symlinkTarget?: string };
async function zip(entries: ZipEntry[], storeOnly = false) {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const done = new Promise<Buffer>((resolve, reject) => {
    output.on("end", () => resolve(Buffer.concat(chunks)));
    output.on("error", reject);
  });
  const archive = archiver("zip", storeOnly ? { store: true } : { zlib: { level: 9 } });
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
  return previewCoursewareImport({ filename, buffer }, { createdBy: actorId, scope: companyScope, existingCoursewares, store, now: new Date("2026-09-17T00:00:00.000Z") });
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
const isolatedWorkbook = await preview("isolated.xlsx", await multiCourseWorkbookBuffer());
assert.equal(isolatedWorkbook.items.find((item) => item.courseCode === "SAFE-A")?.classification, "invalid");
assert.equal(isolatedWorkbook.items.find((item) => item.courseCode === "SAFE-B")?.classification, "create");
assert.ok(isolatedWorkbook.issues.filter((entry) => entry.sheet === "内容块" && entry.row === 2).every((entry) => entry.courseCode === "SAFE-A"));
const isolatedSession = saved.at(-1)!;
assert.deepEqual((isolatedSession.actionPlan as { items: Array<{ courseCode: string; classification: string }> }).items.map(({ courseCode, classification }) => ({ courseCode, classification })), [{ courseCode: "SAFE-B", classification: "create" }]);
assert.ok((await preview("macro.xlsm", Buffer.from("anonymous"))).issues.some((entry) => entry.code === "MACRO_WORKBOOK_NOT_ALLOWED"));

const rowHeavyXml = Buffer.from(`<worksheet>${"<row></row>".repeat(20_001)}</worksheet>`);
const rowHeavyXlsx = await zip([{ name: "xl/worksheets/sheet1.xml", data: rowHeavyXml }], true);
assert.ok((await preview("row-heavy.xlsx", rowHeavyXlsx)).issues.some((entry) => entry.code === "XLSX_ROW_LIMIT"));
const nestedBombXlsx = await zip([{ name: "xl/worksheets/sheet1.xml", data: Buffer.alloc(2 * 1024 * 1024, 65) }]);
const nestedBombPackage = await zip([{ name: "courseware.xlsx", data: nestedBombXlsx }], true);
assert.ok((await preview("nested-bomb.zip", nestedBombPackage)).issues.some((entry) => entry.code === "XLSX_COMPRESSION_RATIO_LIMIT"));

const json = Buffer.from(JSON.stringify({ templateVersion: 1, courses: [{ courseCode: "SAFE-JSON", document }] }));
const created = await preview("courseware.json", json);
assert.equal(created.items[0]?.classification, "create");
const createdSession = saved.at(-1)!;
const invalidJsonCourse = await preview("invalid-course.json", Buffer.from(JSON.stringify({ templateVersion: 1, courses: [{ courseCode: "SAFE-INVALID", document: { ...document, units: [] } }] })));
assert.equal(invalidJsonCourse.items[0]?.classification, "invalid");
const emptyJson = await preview("empty.json", Buffer.from(JSON.stringify({ templateVersion: 1, courses: [] })));
assert.ok(emptyJson.issues.some((entry) => entry.code === "EMPTY_COURSES"));
const emptySession = saved.at(-1)!;
const unknownEnvelope = await preview("unknown-envelope.json", Buffer.from(JSON.stringify({ templateVersion: 1, courses: [{ courseCode: "SAFE-STRICT", document }], executable: "ignored-before-fix" })));
assert.ok(unknownEnvelope.issues.some((entry) => entry.code === "UNKNOWN_FIELD" && entry.field === "executable"));
const stringVersion = await preview("string-version.json", Buffer.from(JSON.stringify({ templateVersion: "1", courses: [{ courseCode: "SAFE-STRICT", document }] })));
assert.ok(stringVersion.issues.some((entry) => entry.code === "UNSUPPORTED_TEMPLATE_VERSION"));
const malformedEntries = await preview("malformed.json", Buffer.from(JSON.stringify({
  templateVersion: 1,
  courses: [
    null,
    { courseCode: "SAFE-ASSET", document, assets: [{ blockKey: "BLOCK-001", path: "assets/a.png" }, { blockKey: "BLOCK-001", path: "assets/a.png" }, { blockKey: "BLOCK-001", path: 123 }], unknown: true }
  ]
})));
assert.ok(malformedEntries.issues.some((entry) => entry.code === "MALFORMED_COURSE"));
assert.ok(malformedEntries.issues.some((entry) => entry.code === "UNKNOWN_FIELD" && entry.courseCode === "SAFE-ASSET"));
assert.ok(malformedEntries.issues.some((entry) => entry.code === "DUPLICATE_ASSET_PATH" && entry.courseCode === "SAFE-ASSET"));
assert.ok(malformedEntries.issues.some((entry) => entry.code === "INVALID_ASSET_BINDING" && entry.courseCode === "SAFE-ASSET"));
const changed = await preview("courseware.json", json, [{ id: "10000000-0000-4000-8000-000000000001", code: "SAFE-JSON", type: "structured", latestContentHash: "different", ...companyScope }]);
assert.equal(changed.items[0]?.classification, "new_version");
const conflictingType = await preview("courseware.json", json, [{ id: "10000000-0000-4000-8000-000000000002", code: "SAFE-JSON", type: "rich_text", latestContentHash: null, ...companyScope }]);
assert.equal(conflictingType.items[0]?.classification, "conflict");
assert.equal(conflictingType.items[0]?.issueCount, 1);
const otherScopeReference: ExistingCoursewareReference = { id: "10000000-0000-4000-8000-000000000003", code: "SAFE-JSON", type: "rich_text", latestContentHash: null, ...organizationScope };
assert.equal((await preview("courseware.json", json, [otherScopeReference])).items[0]?.classification, "create");

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
const validPackageBuffer = await zip([{ name: "courseware.json", data: packageJson }, { name: "assets/diagram.png", data: png }]);
await assert.rejects(() => preview("courseware.zip", validPackageBuffer), (error: unknown) => (error as { code?: string }).code === "COURSEWARE_IMPORT_PRIVATE_SOURCE_REQUIRED");
const validPackage = await previewCoursewareImport({ filename: "courseware.zip", buffer: validPackageBuffer }, { createdBy: actorId, scope: companyScope, existingCoursewares: [], store, sourceFileId, now: new Date("2026-09-17T00:00:00.000Z") });
assert.equal(validPackage.items[0]?.classification, "create");
assert.equal(validPackage.issues.length, 0);
const validPackageSession = saved.at(-1)!;

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

assert.equal(createdSession.createdBy, actorId);
assert.equal(createdSession.confirmationKey, coursewareImportConfirmationKey(createdSession.id, createdSession.sourceHash));
assert.equal(createdSession.expiresAt.toISOString(), "2026-09-17T00:30:00.000Z");
assert.equal(createdSession.parserVersion, COURSEWARE_IMPORT_PARSER_VERSION);
assert.deepEqual({ scopeType: createdSession.scopeType, scopeId: createdSession.scopeId }, companyScope);
assert.ok(createdSession.parsedResult);
assert.ok(createdSession.previewResult);

function confirmationHarness(session: CoursewareImportSessionData) {
  const record = { ...structuredClone(session), expiresAt: session.expiresAt, status: "previewed", confirmedAt: null as Date | null, confirmResult: null as unknown };
  const transaction = {
    coursewareImportSession: {
      async findUnique() { return record; },
      async updateMany() {
        if (record.status !== "previewed") return { count: 0 };
        record.status = "confirming";
        return { count: 1 };
      },
      async update({ data }: { data: { status: string; confirmedAt: Date; confirmResult: unknown } }) {
        Object.assign(record, data);
        return record;
      }
    }
  };
  const database = { async $transaction<T>(run: (tx: typeof transaction) => Promise<T>) { return run(transaction); } };
  return { database, record, transaction };
}

const confirmation = confirmationHarness(createdSession);
let authorizeCount = 0;
const guards = {
  async authorizeScope(_tx: unknown, confirmedActorId: string, scope: typeof companyScope) {
    authorizeCount += 1;
    assert.equal(confirmedActorId, actorId);
    assert.deepEqual(scope, companyScope);
  },
  async loadPrivateSource() { throw new Error("asset-free imports must not load a private source"); }
};
let applyCount = 0;
const firstConfirmation = await confirmCoursewareImport(confirmation.database, { previewId: createdSession.id, sourceHash: createdSession.sourceHash, actorId, now: new Date("2026-09-17T00:01:00.000Z") }, guards, async (_tx, serverState) => {
  applyCount += 1;
  assert.equal(serverState.sourceBuffer, null);
  assert.deepEqual(serverState.actionPlan.items.map(({ courseCode, classification }) => ({ courseCode, classification })), [{ courseCode: "SAFE-JSON", classification: "create" }]);
  return { created: 1 };
});
const repeatedConfirmation = await confirmCoursewareImport(confirmation.database, { previewId: createdSession.id, sourceHash: createdSession.sourceHash, actorId, now: new Date("2026-09-17T00:02:00.000Z") }, guards, async () => {
  applyCount += 1;
  return { created: 2 };
});
assert.deepEqual(firstConfirmation, { result: { created: 1 }, repeated: false });
assert.deepEqual(repeatedConfirmation, { result: { created: 1 }, repeated: true });
assert.equal(applyCount, 1);
assert.equal(authorizeCount, 2, "scope authorization must be checked again on every confirmation request");

const denied = confirmationHarness(createdSession);
await assert.rejects(() => confirmCoursewareImport(denied.database, { previewId: createdSession.id, sourceHash: createdSession.sourceHash, actorId, now: confirmNow }, {
  async authorizeScope() { throw Object.assign(new Error("forbidden"), { statusCode: 403 }); },
  async loadPrivateSource() { throw new Error("unreachable"); }
}, async () => ({ created: 1 })), (error: unknown) => (error as { statusCode?: number }).statusCode === 403);

const globalError = confirmationHarness(emptySession);
await assert.rejects(() => confirmCoursewareImport(globalError.database, { previewId: emptySession.id, sourceHash: emptySession.sourceHash, actorId, now: confirmNow }, guards, async () => ({ created: 1 })), (error: unknown) => (error as { code?: string }).code === "COURSEWARE_IMPORT_GLOBAL_ERRORS");

const staleParser = confirmationHarness({ ...createdSession, parserVersion: COURSEWARE_IMPORT_PARSER_VERSION + 1 });
await assert.rejects(() => confirmCoursewareImport(staleParser.database, { previewId: createdSession.id, sourceHash: createdSession.sourceHash, actorId, now: confirmNow }, guards, async () => ({ created: 1 })), (error: unknown) => (error as { code?: string }).code === "COURSEWARE_IMPORT_PARSER_EXPIRED");

const forbiddenPlan = confirmationHarness({
  ...createdSession,
  actionPlan: { ...(createdSession.actionPlan as object), items: [{ ...(createdSession.actionPlan as { items: object[] }).items[0], classification: "invalid" }] }
});
let forbiddenApply = false;
await assert.rejects(() => confirmCoursewareImport(forbiddenPlan.database, { previewId: createdSession.id, sourceHash: createdSession.sourceHash, actorId, now: confirmNow }, guards, async () => {
  forbiddenApply = true;
  return { created: 1 };
}), (error: unknown) => (error as { code?: string }).code === "COURSEWARE_IMPORT_ACTION_PLAN_INVALID");
assert.equal(forbiddenApply, false);

const packageConfirmation = confirmationHarness(validPackageSession);
let loadedSource = false;
await confirmCoursewareImport(packageConfirmation.database, { previewId: validPackageSession.id, sourceHash: validPackageSession.sourceHash, actorId, now: confirmNow }, {
  async authorizeScope() {},
  async loadPrivateSource(_tx, fileId, confirmedActorId) {
    loadedSource = true;
    assert.equal(fileId, sourceFileId);
    assert.equal(confirmedActorId, actorId);
    return validPackageBuffer;
  }
}, async (_tx, serverState) => {
  assert.equal(serverState.sourceBuffer, validPackageBuffer);
  return { created: 1 };
});
assert.equal(loadedSource, true);

const changedSource = confirmationHarness(validPackageSession);
await assert.rejects(() => confirmCoursewareImport(changedSource.database, { previewId: validPackageSession.id, sourceHash: validPackageSession.sourceHash, actorId, now: confirmNow }, {
  async authorizeScope() {},
  async loadPrivateSource() { return Buffer.from("changed-private-source"); }
}, async () => ({ created: 1 })), (error: unknown) => (error as { code?: string }).code === "COURSEWARE_IMPORT_SOURCE_CHANGED");

console.log("courseware import checks passed");
