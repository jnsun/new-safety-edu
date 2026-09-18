import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import {
  COURSEWARE_SCHEMA_VERSION,
  StructuredCoursewareDocumentSchema,
  type StructuredCoursewareDocument
} from "@safety/contracts";
import { z } from "zod";
import {
  hashStructuredCoursewareSourceIdentity,
  type StructuredCoursewareSourceAssetIdentity
} from "./structured-courseware.js";
import { CoursewareXlsxError, parseCoursewareXlsx } from "./courseware-import-xlsx.js";
import { CoursewarePackageError, parseCoursewarePackage } from "./courseware-import-package.js";

export type CoursewareImportClassification = "create" | "new_version" | "conflict" | "invalid";
export type CoursewareImportIssue = {
  file: string;
  sheet: string;
  row: number;
  field: string;
  code: string;
  message: string;
  courseCode?: string;
  unitCode?: string;
};
export type CoursewareAssetBinding = { blockKey: string; path: string; sheet?: string; row?: number };
export type ParsedCourseware = {
  courseCode: string;
  title: string;
  document: StructuredCoursewareDocument | null;
  assetBindings: CoursewareAssetBinding[];
  duplicateCode?: boolean;
};
export type ParsedCoursewareImport = {
  templateVersion: number;
  courses: ParsedCourseware[];
  issues: CoursewareImportIssue[];
};
export type ExistingCoursewareReference = {
  id: string;
  code: string | null;
  type: string;
  latestContentHash: string | null;
  scopeType: CoursewareImportScope["scopeType"];
  scopeId: string | null;
};
export type CoursewareImportScope = { scopeType: "company" | "organization" | "project"; scopeId: string | null };
export type CoursewareImportPreviewItem = {
  courseCode: string;
  title: string;
  classification: CoursewareImportClassification;
  existingCoursewareId: string | null;
  issueCount: number;
};
export type CoursewareImportPreview = {
  previewId: string;
  sourceHash: string;
  templateVersion: number;
  expiresAt: string;
  items: CoursewareImportPreviewItem[];
  issues: CoursewareImportIssue[];
};

export type CoursewareImportSessionData = {
  id: string;
  sourceFileId: string | null;
  originalFilename: string;
  sourceHash: string;
  templateVersion: number;
  parserVersion: number;
  scopeType: CoursewareImportScope["scopeType"];
  scopeId: string | null;
  actionPlan: unknown;
  hasGlobalErrors: boolean;
  containsAssets: boolean;
  parsedResult: unknown;
  previewResult: unknown;
  confirmationKey: string;
  createdBy: string;
  expiresAt: Date;
};
export type CoursewareImportSessionStore = {
  create(data: CoursewareImportSessionData): Promise<{ id: string }>;
};

type ConfirmationSession = CoursewareImportSessionData & {
  status: string;
  confirmedAt: Date | null;
  confirmResult: unknown;
};
export type CoursewareImportConfirmationTransaction = {
  coursewareImportSession: {
    findUnique(args: unknown): Promise<ConfirmationSession | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
    update(args: unknown): Promise<ConfirmationSession>;
  };
};
export type CoursewareImportConfirmationDatabase<TTransaction extends CoursewareImportConfirmationTransaction> = {
  $transaction<TResult>(run: (transaction: TTransaction) => Promise<TResult>): Promise<TResult>;
};
export type CoursewareImportConfirmationGuards<TTransaction> = {
  authorizeScope(transaction: TTransaction, actorId: string, scope: CoursewareImportScope): Promise<void>;
  loadPrivateSource(transaction: TTransaction, sourceFileId: string, actorId: string): Promise<Buffer>;
};

type PreviewOptions = {
  createdBy: string;
  scope: CoursewareImportScope;
  existingCoursewares: ExistingCoursewareReference[];
  store: CoursewareImportSessionStore;
  sourceFileId?: string;
  now?: Date;
  ttlMinutes?: number;
};

type SourceFile = { filename: string; buffer: Buffer };
type AssetMetadata = { path: string; mimeType: string; size: number; sha256: string };

export const COURSEWARE_IMPORT_PARSER_VERSION = 1;

const ImportScopeSchema = z.object({
  scopeType: z.enum(["company", "organization", "project"]),
  scopeId: z.string().uuid().nullable()
}).strict().superRefine((scope, context) => {
  if (scope.scopeType === "company" && scope.scopeId !== null) context.addIssue({ code: "custom", path: ["scopeId"], message: "公司范围不能指定 scopeId" });
  if (scope.scopeType !== "company" && scope.scopeId === null) context.addIssue({ code: "custom", path: ["scopeId"], message: "组织或项目范围必须指定 scopeId" });
});

const AssetBindingSchema = z.object({
  blockKey: z.string().min(1),
  path: z.string().min(1),
  sheet: z.string().optional(),
  row: z.number().int().nonnegative().optional()
}).strict();

const SourceAssetIdentitySchema = z.object({
  blockKey: z.string().min(1),
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

const ImportActionPlanItemSchema = z.object({
  courseCode: z.string().trim().min(1).max(120),
  title: z.string().min(1).max(180),
  classification: z.enum(["create", "new_version"]),
  existingCoursewareId: z.string().uuid().nullable(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  document: StructuredCoursewareDocumentSchema,
  assetBindings: z.array(AssetBindingSchema),
  sourceAssets: z.array(SourceAssetIdentitySchema)
}).strict().superRefine((item, context) => {
  if (item.classification === "create" && item.existingCoursewareId !== null) context.addIssue({ code: "custom", path: ["existingCoursewareId"], message: "新增课程不能引用现有课件" });
  if (item.classification === "new_version" && item.existingCoursewareId === null) context.addIssue({ code: "custom", path: ["existingCoursewareId"], message: "新版本必须引用现有课件" });
  const bindingBlocks = item.assetBindings.map(({ blockKey }) => blockKey.trim());
  if (new Set(bindingBlocks).size !== bindingBlocks.length) {
    context.addIssue({ code: "custom", path: ["assetBindings"], message: "同一图文知识卡只能关联一个素材" });
  }
  const bindings = new Set(item.assetBindings.map(({ blockKey, path }) => `${blockKey}\0${path.normalize("NFC")}`));
  const identities = new Set(item.sourceAssets.map(({ blockKey, path }) => `${blockKey}\0${path.normalize("NFC")}`));
  if (bindings.size !== item.assetBindings.length || identities.size !== item.sourceAssets.length || bindings.size !== identities.size || [...bindings].some((key) => !identities.has(key))) {
    context.addIssue({ code: "custom", path: ["sourceAssets"], message: "素材绑定与来源身份不一致" });
  }
});

export const CoursewareImportActionPlanSchema = z.object({
  parserVersion: z.literal(COURSEWARE_IMPORT_PARSER_VERSION),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  scope: ImportScopeSchema,
  items: z.array(ImportActionPlanItemSchema).min(1)
}).strict();
export type CoursewareImportActionPlan = z.infer<typeof CoursewareImportActionPlanSchema>;

const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
export const coursewareImportConfirmationKey = (previewId: string, sourceHash: string) => sha256(`${previewId}:${sourceHash}`);

function importIssue(code: string, message: string): CoursewareImportIssue {
  return { file: "", sheet: "文件", row: 0, field: "文件", code, message };
}

function jsonImport(buffer: Buffer): ParsedCoursewareImport {
  if (buffer.length > 20 * 1024 * 1024) return { templateVersion: COURSEWARE_SCHEMA_VERSION, courses: [], issues: [importIssue("JSON_SIZE_LIMIT", "JSON 文件大小超过限制")] };
  let value: unknown;
  try { value = JSON.parse(buffer.toString("utf8")); }
  catch { return { templateVersion: COURSEWARE_SCHEMA_VERSION, courses: [], issues: [importIssue("INVALID_JSON", "JSON 文件格式无效")] }; }
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const templateVersion = typeof source.templateVersion === "number" && Number.isInteger(source.templateVersion) ? source.templateVersion : 0;
  const entries = Array.isArray(source.courses) ? source.courses : [];
  const issues: CoursewareImportIssue[] = [];
  for (const key of Object.keys(source)) if (key !== "templateVersion" && key !== "courses") {
    issues.push({ file: "", sheet: "JSON", row: 0, field: key, code: "UNKNOWN_FIELD", message: `JSON 顶层字段不受支持：${key}` });
  }
  if (templateVersion !== COURSEWARE_SCHEMA_VERSION) issues.push(importIssue("UNSUPPORTED_TEMPLATE_VERSION", `模板版本必须为整数 ${COURSEWARE_SCHEMA_VERSION}`));
  if (!Array.isArray(source.courses)) issues.push(importIssue("INVALID_JSON_SHAPE", "JSON 必须包含 courses 数组"));
  else if (!source.courses.length) issues.push(importIssue("EMPTY_COURSES", "JSON 至少需要一门课程"));
  const courses: ParsedCourseware[] = [];
  const counts = new Map<string, number>();
  entries.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      issues.push({ file: "", sheet: "JSON", row: index + 1, field: "courses", code: "MALFORMED_COURSE", message: "课程项必须为对象" });
      return;
    }
    const entry = raw as Record<string, unknown>;
    const courseCode = typeof entry.courseCode === "string" ? entry.courseCode.trim() : "";
    for (const key of Object.keys(entry)) if (key !== "courseCode" && key !== "document" && key !== "assets") {
      issues.push({ file: "", sheet: "JSON", row: index + 1, field: key, code: "UNKNOWN_FIELD", message: `课程字段不受支持：${key}`, ...(courseCode ? { courseCode } : {}) });
    }
    if (!courseCode) {
      issues.push({ file: "", sheet: "JSON", row: index + 1, field: "courseCode", code: "REQUIRED", message: "课程编码不能为空" });
      return;
    }
    if (courseCode.length > 120) {
      issues.push({ file: "", sheet: "JSON", row: index + 1, field: "courseCode", code: "INVALID_COURSE_CODE", message: "课程编码不能超过 120 个字符", courseCode });
    }
    counts.set(courseCode, (counts.get(courseCode) ?? 0) + 1);
    const checked = StructuredCoursewareDocumentSchema.safeParse(entry.document);
    let parsedDocument: StructuredCoursewareDocument | null = null;
    let title = courseCode;
    if (!checked.success) {
      checked.error.issues.forEach((detail) => issues.push({ file: "", sheet: "JSON", row: index + 1, field: `document.${detail.path.join(".")}`, code: "INVALID_DOCUMENT", message: detail.message, courseCode }));
      title = entry.document && typeof entry.document === "object" && typeof (entry.document as Record<string, unknown>).title === "string"
        ? String((entry.document as Record<string, unknown>).title)
        : courseCode;
    } else {
      parsedDocument = checked.data;
      title = checked.data.title;
    }
    const bindings: CoursewareAssetBinding[] = [];
    const seenPaths = new Set<string>();
    if (entry.assets !== undefined && !Array.isArray(entry.assets)) {
      issues.push({ file: "", sheet: "JSON", row: index + 1, field: "assets", code: "INVALID_ASSET_BINDING", message: "assets 必须为数组", courseCode });
    } else for (const [assetIndex, rawBinding] of (entry.assets as unknown[] | undefined ?? []).entries()) {
      if (!rawBinding || typeof rawBinding !== "object" || Array.isArray(rawBinding)) {
        issues.push({ file: "", sheet: "JSON", row: index + 1, field: `assets.${assetIndex}`, code: "INVALID_ASSET_BINDING", message: "素材关联项必须为对象", courseCode });
        continue;
      }
      const binding = rawBinding as Record<string, unknown>;
      for (const key of Object.keys(binding)) if (key !== "blockKey" && key !== "path") {
        issues.push({ file: "", sheet: "JSON", row: index + 1, field: `assets.${assetIndex}.${key}`, code: "UNKNOWN_FIELD", message: `素材字段不受支持：${key}`, courseCode });
      }
      const blockKey = typeof binding.blockKey === "string" ? binding.blockKey.trim() : "";
      const path = typeof binding.path === "string" ? binding.path.trim() : "";
      if (!blockKey || !path) {
        issues.push({ file: "", sheet: "JSON", row: index + 1, field: `assets.${assetIndex}`, code: "INVALID_ASSET_BINDING", message: "素材关联必须包含字符串 blockKey 和 path", courseCode });
        continue;
      }
      const foldedPath = path.normalize("NFC").toLocaleLowerCase("en-US");
      if (seenPaths.has(foldedPath)) issues.push({ file: "", sheet: "JSON", row: index + 1, field: `assets.${assetIndex}.path`, code: "DUPLICATE_ASSET_PATH", message: `素材路径重复：${path}`, courseCode });
      seenPaths.add(foldedPath);
      bindings.push({ blockKey, path, sheet: "JSON", row: index + 1 });
    }
    courses.push({ courseCode, title, document: parsedDocument, assetBindings: bindings });
  });
  for (const [courseCode, count] of counts) {
    if (count < 2) continue;
    courses.filter((course) => course.courseCode === courseCode).forEach((course) => { course.duplicateCode = true; });
    issues.push({ file: "", sheet: "JSON", row: 0, field: "courseCode", code: "DUPLICATE_COURSE_CODE", message: `课程编码重复：${courseCode}`, courseCode });
  }
  return { templateVersion, courses, issues };
}

function safeAssetReference(path: string) {
  if (!path || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
  const parts = path.split("/");
  return path.startsWith("assets/") && parts.every((part) => part && part !== "." && part !== ".." && !part.startsWith("."));
}

async function parseSource(file: SourceFile) {
  const extension = extname(file.filename).toLowerCase();
  if (extension === ".xlsm") return { parsed: { templateVersion: COURSEWARE_SCHEMA_VERSION, courses: [], issues: [importIssue("MACRO_WORKBOOK_NOT_ALLOWED", "不允许导入含宏工作簿 .xlsm")] }, assets: new Map<string, AssetMetadata>() };
  if (extension === ".xlsx") {
    try { return { parsed: await parseCoursewareXlsx(file.buffer), assets: new Map<string, AssetMetadata>() }; }
    catch (error) {
      if (error instanceof CoursewareXlsxError) return { parsed: { templateVersion: COURSEWARE_SCHEMA_VERSION, courses: [], issues: [importIssue(error.code, error.message)] }, assets: new Map<string, AssetMetadata>() };
      throw error;
    }
  }
  if (extension === ".json") return { parsed: jsonImport(file.buffer), assets: new Map<string, AssetMetadata>() };
  if (extension !== ".zip") return { parsed: { templateVersion: COURSEWARE_SCHEMA_VERSION, courses: [], issues: [importIssue("UNSUPPORTED_IMPORT_FILE", "仅支持 .xlsx、.json 或 .zip 文件")] }, assets: new Map<string, AssetMetadata>() };
  try {
    const bundle = await parseCoursewarePackage(file.buffer);
    const manifestExtension = extname(bundle.manifest.filename).toLowerCase();
    const parsed = manifestExtension === ".xlsx" ? await parseCoursewareXlsx(bundle.manifest.buffer) : jsonImport(bundle.manifest.buffer);
    const assets = new Map([...bundle.assets].map(([path, asset]) => [path, { path, mimeType: asset.mimeType, size: asset.buffer.length, sha256: sha256(asset.buffer) }]));
    return { parsed, assets };
  } catch (error) {
    if (error instanceof CoursewarePackageError || error instanceof CoursewareXlsxError) return { parsed: { templateVersion: COURSEWARE_SCHEMA_VERSION, courses: [], issues: [importIssue(error.code, error.message)] }, assets: new Map<string, AssetMetadata>() };
    throw error;
  }
}

function serialized<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function confirmationError(statusCode: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { statusCode, code });
}

export async function confirmCoursewareImport<TTransaction extends CoursewareImportConfirmationTransaction, TResult>(
  database: CoursewareImportConfirmationDatabase<TTransaction>,
  input: { previewId: string; sourceHash: string; actorId: string; now?: Date },
  guards: CoursewareImportConfirmationGuards<TTransaction>,
  apply: (transaction: TTransaction, serverState: { actionPlan: CoursewareImportActionPlan; sourceBuffer: Buffer | null }, importSessionId: string) => Promise<TResult>
) {
  return database.$transaction(async (transaction) => {
    const selector = { id_sourceHash: { id: input.previewId, sourceHash: input.sourceHash } };
    let session = await transaction.coursewareImportSession.findUnique({ where: selector });
    if (!session) return confirmationError(404, "COURSEWARE_IMPORT_PREVIEW_NOT_FOUND", "导入预览不存在");
    if (session.createdBy !== input.actorId) return confirmationError(403, "COURSEWARE_IMPORT_PREVIEW_FORBIDDEN", "无权确认该导入预览");
    if (session.confirmationKey !== coursewareImportConfirmationKey(session.id, session.sourceHash)) {
      return confirmationError(409, "COURSEWARE_IMPORT_PREVIEW_INVALID", "导入预览校验失败");
    }
    if (session.parserVersion !== COURSEWARE_IMPORT_PARSER_VERSION) return confirmationError(409, "COURSEWARE_IMPORT_PARSER_EXPIRED", "导入解析器版本已经更新，请重新上传");
    const scope = ImportScopeSchema.safeParse({ scopeType: session.scopeType, scopeId: session.scopeId });
    if (!scope.success) return confirmationError(409, "COURSEWARE_IMPORT_SCOPE_INVALID", "导入预览的权限范围无效");
    await guards.authorizeScope(transaction, input.actorId, scope.data);
    if (session.status === "confirmed") return { result: session.confirmResult as TResult, repeated: true };
    if (session.status !== "previewed") return confirmationError(409, "COURSEWARE_IMPORT_PREVIEW_UNAVAILABLE", "导入预览正在处理或已失效");
    const now = input.now ?? new Date();
    if (session.expiresAt.getTime() <= now.getTime()) return confirmationError(409, "COURSEWARE_IMPORT_PREVIEW_EXPIRED", "导入预览已过期，请重新上传");
    if (session.hasGlobalErrors) return confirmationError(409, "COURSEWARE_IMPORT_GLOBAL_ERRORS", "导入文件存在全局错误，请修正后重新上传");
    const actionPlan = CoursewareImportActionPlanSchema.safeParse(session.actionPlan);
    if (!actionPlan.success || actionPlan.data.sourceHash !== session.sourceHash || actionPlan.data.scope.scopeType !== scope.data.scopeType || actionPlan.data.scope.scopeId !== scope.data.scopeId) {
      return confirmationError(409, "COURSEWARE_IMPORT_ACTION_PLAN_INVALID", "导入执行计划无效，请重新上传");
    }
    let contentIdentityValid = true;
    try {
      contentIdentityValid = actionPlan.data.items.every((item) => hashStructuredCoursewareSourceIdentity(item.document, item.sourceAssets) === item.contentHash);
    } catch {
      contentIdentityValid = false;
    }
    if (!contentIdentityValid) {
      return confirmationError(409, "COURSEWARE_IMPORT_ACTION_PLAN_INVALID", "导入内容来源身份校验失败，请重新上传");
    }
    let sourceBuffer: Buffer | null = null;
    if (session.containsAssets) {
      if (!session.sourceFileId) return confirmationError(409, "COURSEWARE_IMPORT_PRIVATE_SOURCE_REQUIRED", "含素材的导入必须保留私有源文件");
      sourceBuffer = await guards.loadPrivateSource(transaction, session.sourceFileId, input.actorId);
      if (sha256(sourceBuffer) !== session.sourceHash) return confirmationError(409, "COURSEWARE_IMPORT_SOURCE_CHANGED", "私有源文件校验失败，请重新上传");
    }

    const claimed = await transaction.coursewareImportSession.updateMany({
      where: { id: session.id, sourceHash: session.sourceHash, status: "previewed", expiresAt: { gt: now } },
      data: { status: "confirming" }
    });
    if (!claimed.count) {
      session = await transaction.coursewareImportSession.findUnique({ where: selector });
      if (session?.status === "confirmed") return { result: session.confirmResult as TResult, repeated: true };
      return confirmationError(409, "COURSEWARE_IMPORT_CONFIRMING", "导入正在确认，请勿重复提交");
    }

    const result = await apply(transaction, { actionPlan: actionPlan.data, sourceBuffer }, session.id);
    await transaction.coursewareImportSession.update({
      where: { id: session.id },
      data: { status: "confirmed", confirmedAt: now, confirmResult: serialized(result) }
    });
    return { result, repeated: false };
  });
}

export async function previewCoursewareImport(file: SourceFile, options: PreviewOptions): Promise<CoursewareImportPreview> {
  const scope = ImportScopeSchema.safeParse(options.scope);
  if (!scope.success) return confirmationError(400, "COURSEWARE_IMPORT_SCOPE_INVALID", "请选择有效的课件导入范围");
  const sourceHash = sha256(file.buffer);
  const { parsed, assets } = await parseSource(file);
  const issues = parsed.issues.map((entry) => ({ ...entry, file: entry.file || file.filename }));
  const sourceAssetsByCourse = new Map<string, StructuredCoursewareSourceAssetIdentity[]>();
  for (const course of parsed.courses) {
    if (!course.document) continue;
    const blocks = new Map(course.document.units.flatMap((unit) => unit.blocks.map((block) => [block.key, block] as const)));
    for (const block of blocks.values()) {
      if (block.type === "knowledge" && block.imageFileId) {
        issues.push({ file: file.filename, sheet: "JSON", row: 0, field: "imageFileId", code: "INTERNAL_ASSET_ID_NOT_ALLOWED", message: "导入文件不能直接引用系统内部素材 ID", courseCode: course.courseCode });
      }
    }
    const seenBindings = new Set<string>();
    const boundBlocks = new Set<string>();
    const sourceAssets: StructuredCoursewareSourceAssetIdentity[] = [];
    for (const binding of course.assetBindings) {
      const normalizedPath = binding.path.normalize("NFC");
      const asset = assets.get(normalizedPath);
      if (!safeAssetReference(normalizedPath)) {
        issues.push({ file: file.filename, sheet: binding.sheet ?? "素材", row: binding.row ?? 0, field: "path", code: "INVALID_ASSET_PATH", message: `素材路径无效：${binding.path}`, courseCode: course.courseCode });
      } else if (!asset) {
        issues.push({ file: file.filename, sheet: binding.sheet ?? "内容块", row: binding.row ?? 0, field: "素材文件名", code: "MISSING_ASSET", message: `找不到素材：${binding.path}`, courseCode: course.courseCode });
      }
      const block = blocks.get(binding.blockKey);
      if (!block) issues.push({ file: file.filename, sheet: binding.sheet ?? "素材", row: binding.row ?? 0, field: "blockKey", code: "UNKNOWN_BLOCK_KEY", message: `素材关联的内容块不存在：${binding.blockKey}`, courseCode: course.courseCode });
      else if (block.type !== "knowledge") issues.push({ file: file.filename, sheet: binding.sheet ?? "素材", row: binding.row ?? 0, field: "blockKey", code: "INVALID_ASSET_BLOCK", message: `素材只能关联图文知识卡：${binding.blockKey}`, courseCode: course.courseCode });
      if (boundBlocks.has(binding.blockKey)) issues.push({ file: file.filename, sheet: binding.sheet ?? "素材", row: binding.row ?? 0, field: "blockKey", code: "MULTIPLE_ASSET_BINDINGS", message: `同一图文知识卡只能关联一个素材：${binding.blockKey}`, courseCode: course.courseCode });
      boundBlocks.add(binding.blockKey);
      const key = `${binding.blockKey}\0${normalizedPath}`;
      if (seenBindings.has(key)) issues.push({ file: file.filename, sheet: "素材", row: 0, field: "path", code: "DUPLICATE_ASSET_BINDING", message: `素材关联重复：${binding.path}`, courseCode: course.courseCode });
      seenBindings.add(key);
      if (asset && block?.type === "knowledge" && !sourceAssets.some((entry) => entry.blockKey === binding.blockKey)) {
        sourceAssets.push({ blockKey: binding.blockKey, path: normalizedPath, sha256: asset.sha256 });
      }
    }
    sourceAssetsByCourse.set(course.courseCode, sourceAssets);
  }

  const existingByCode = new Map<string, ExistingCoursewareReference[]>();
  options.existingCoursewares.filter((courseware) => courseware.scopeType === scope.data.scopeType && courseware.scopeId === scope.data.scopeId).forEach((courseware) => {
    if (courseware.code) existingByCode.set(courseware.code, [...(existingByCode.get(courseware.code) ?? []), courseware]);
  });
  const globalIssueCount = issues.filter((entry) => !entry.courseCode).length;
  const globalInvalid = globalIssueCount > 0;
  const previewCourses = [...parsed.courses];
  const previewCourseCodes = new Set(previewCourses.map(({ courseCode }) => courseCode));
  for (const courseCode of new Set(issues.flatMap((entry) => entry.courseCode ? [entry.courseCode] : []))) {
    if (!previewCourseCodes.has(courseCode)) previewCourses.push({ courseCode, title: courseCode, document: null, assetBindings: [] });
  }
  const items = previewCourses.map((course): CoursewareImportPreviewItem => {
    const related = issues.filter((entry) => entry.courseCode === course.courseCode);
    const existing = existingByCode.get(course.courseCode) ?? [];
    let classification: CoursewareImportClassification = "create";
    if (course.duplicateCode || related.some((entry) => entry.code.startsWith("DUPLICATE_"))) classification = "conflict";
    else if (globalInvalid || related.length) classification = "invalid";
    else if (!course.document) classification = "invalid";
    else if (existing.length > 1 || existing[0]?.type !== undefined && existing[0].type !== "structured") {
      classification = "conflict";
      issues.push({ file: file.filename, sheet: "数据库", row: 0, field: "课程编码", code: "EXISTING_COURSEWARE_CONFLICT", message: `课程编码 ${course.courseCode} 对应的现有课件冲突`, courseCode: course.courseCode });
    } else if (existing.length === 1) {
      const contentHash = hashStructuredCoursewareSourceIdentity(course.document, sourceAssetsByCourse.get(course.courseCode) ?? []);
      if (existing[0]!.latestContentHash === contentHash) {
        classification = "conflict";
        issues.push({ file: file.filename, sheet: "数据库", row: 0, field: "内容", code: "UNCHANGED_CONTENT", message: "导入内容与现有最新版本相同", courseCode: course.courseCode });
      } else classification = "new_version";
    }
    return { courseCode: course.courseCode, title: course.title, classification, existingCoursewareId: existing.length === 1 ? existing[0]!.id : null, issueCount: globalIssueCount + issues.filter((entry) => entry.courseCode === course.courseCode).length };
  });

  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (options.ttlMinutes ?? 30) * 60_000);
  const previewId = randomUUID();
  const preview: CoursewareImportPreview = { previewId, sourceHash, templateVersion: parsed.templateVersion, expiresAt: expiresAt.toISOString(), items, issues };
  const actionItems = items.flatMap((item) => {
    if (item.classification !== "create" && item.classification !== "new_version") return [];
    const course = parsed.courses.find((candidate) => candidate.courseCode === item.courseCode && candidate.document);
    if (!course?.document) return [];
    return [{
      courseCode: course.courseCode,
      title: course.title,
      classification: item.classification,
      existingCoursewareId: item.existingCoursewareId,
      contentHash: hashStructuredCoursewareSourceIdentity(course.document, sourceAssetsByCourse.get(course.courseCode) ?? []),
      document: course.document,
      assetBindings: course.assetBindings,
      sourceAssets: sourceAssetsByCourse.get(course.courseCode) ?? []
    }];
  });
  const actionPlan = {
    parserVersion: COURSEWARE_IMPORT_PARSER_VERSION,
    sourceHash,
    scope: scope.data,
    items: actionItems
  };
  const containsAssets = assets.size > 0;
  if (containsAssets && !options.sourceFileId) return confirmationError(400, "COURSEWARE_IMPORT_PRIVATE_SOURCE_REQUIRED", "含素材的 ZIP 导入必须先保存到私有文件存储");
  await options.store.create({
    id: previewId,
    sourceFileId: options.sourceFileId ?? null,
    originalFilename: file.filename,
    sourceHash,
    templateVersion: parsed.templateVersion,
    parserVersion: COURSEWARE_IMPORT_PARSER_VERSION,
    scopeType: scope.data.scopeType,
    scopeId: scope.data.scopeId,
    actionPlan: serialized(actionPlan),
    hasGlobalErrors: globalInvalid,
    containsAssets,
    parsedResult: serialized({ courses: parsed.courses, assets: [...assets.values()] }),
    previewResult: serialized({ items, issues }),
    confirmationKey: coursewareImportConfirmationKey(previewId, sourceHash),
    createdBy: options.createdBy,
    expiresAt
  });
  return preview;
}
