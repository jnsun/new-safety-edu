import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import {
  COURSEWARE_SCHEMA_VERSION,
  StructuredCoursewareDocumentSchema,
  type StructuredCoursewareDocument
} from "@safety/contracts";
import { hashStructuredCourseware } from "./structured-courseware.js";
import { parseCoursewareXlsx } from "./courseware-import-xlsx.js";
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
};
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

type PreviewOptions = {
  createdBy: string;
  existingCoursewares: ExistingCoursewareReference[];
  store: CoursewareImportSessionStore;
  sourceFileId?: string;
  now?: Date;
  ttlMinutes?: number;
};

type SourceFile = { filename: string; buffer: Buffer };
type AssetMetadata = { path: string; mimeType: string; size: number; sha256: string };

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
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const templateVersion = Number(source.templateVersion);
  const entries = Array.isArray(source.courses) ? source.courses : [];
  const issues: CoursewareImportIssue[] = [];
  if (templateVersion !== COURSEWARE_SCHEMA_VERSION) issues.push(importIssue("UNSUPPORTED_TEMPLATE_VERSION", `模板版本必须为 ${COURSEWARE_SCHEMA_VERSION}`));
  if (!Array.isArray(source.courses)) issues.push(importIssue("INVALID_JSON_SHAPE", "JSON 必须包含 courses 数组"));
  const courses: ParsedCourseware[] = [];
  const counts = new Map<string, number>();
  entries.forEach((raw, index) => {
    const entry = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const courseCode = typeof entry.courseCode === "string" ? entry.courseCode.trim() : "";
    if (!courseCode) {
      issues.push({ file: "", sheet: "JSON", row: index + 1, field: "courseCode", code: "REQUIRED", message: "课程编码不能为空" });
      return;
    }
    counts.set(courseCode, (counts.get(courseCode) ?? 0) + 1);
    const checked = StructuredCoursewareDocumentSchema.safeParse(entry.document);
    if (!checked.success) {
      checked.error.issues.forEach((detail) => issues.push({ file: "", sheet: "JSON", row: index + 1, field: `document.${detail.path.join(".")}`, code: "INVALID_DOCUMENT", message: detail.message, courseCode }));
      const title = entry.document && typeof entry.document === "object" && typeof (entry.document as Record<string, unknown>).title === "string"
        ? String((entry.document as Record<string, unknown>).title)
        : courseCode;
      courses.push({ courseCode, title, document: null, assetBindings: [] });
      return;
    }
    const bindings = Array.isArray(entry.assets) ? entry.assets.flatMap((rawBinding) => {
      if (!rawBinding || typeof rawBinding !== "object") return [];
      const binding = rawBinding as Record<string, unknown>;
      return typeof binding.blockKey === "string" && typeof binding.path === "string"
        ? [{ blockKey: binding.blockKey.trim(), path: binding.path.trim(), sheet: "JSON", row: index + 1 }]
        : [];
    }) : [];
    courses.push({ courseCode, title: checked.data.title, document: checked.data, assetBindings: bindings });
  });
  for (const [courseCode, count] of counts) {
    if (count < 2) continue;
    courses.filter((course) => course.courseCode === courseCode).forEach((course) => { course.duplicateCode = true; });
    issues.push({ file: "", sheet: "JSON", row: 0, field: "courseCode", code: "DUPLICATE_COURSE_CODE", message: `课程编码重复：${courseCode}`, courseCode });
  }
  return { templateVersion: Number.isFinite(templateVersion) ? templateVersion : COURSEWARE_SCHEMA_VERSION, courses, issues };
}

function safeAssetReference(path: string) {
  if (!path || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
  const parts = path.split("/");
  return path.startsWith("assets/") && parts.every((part) => part && part !== "." && part !== ".." && !part.startsWith("."));
}

async function parseSource(file: SourceFile) {
  const extension = extname(file.filename).toLowerCase();
  if (extension === ".xlsm") return { parsed: { templateVersion: COURSEWARE_SCHEMA_VERSION, courses: [], issues: [importIssue("MACRO_WORKBOOK_NOT_ALLOWED", "不允许导入含宏工作簿 .xlsm")] }, assets: new Map<string, AssetMetadata>() };
  if (extension === ".xlsx") return { parsed: await parseCoursewareXlsx(file.buffer), assets: new Map<string, AssetMetadata>() };
  if (extension === ".json") return { parsed: jsonImport(file.buffer), assets: new Map<string, AssetMetadata>() };
  if (extension !== ".zip") return { parsed: { templateVersion: COURSEWARE_SCHEMA_VERSION, courses: [], issues: [importIssue("UNSUPPORTED_IMPORT_FILE", "仅支持 .xlsx、.json 或 .zip 文件")] }, assets: new Map<string, AssetMetadata>() };
  try {
    const bundle = await parseCoursewarePackage(file.buffer);
    const manifestExtension = extname(bundle.manifest.filename).toLowerCase();
    const parsed = manifestExtension === ".xlsx" ? await parseCoursewareXlsx(bundle.manifest.buffer) : jsonImport(bundle.manifest.buffer);
    const assets = new Map([...bundle.assets].map(([path, asset]) => [path, { path, mimeType: asset.mimeType, size: asset.buffer.length, sha256: sha256(asset.buffer) }]));
    return { parsed, assets };
  } catch (error) {
    if (error instanceof CoursewarePackageError) return { parsed: { templateVersion: COURSEWARE_SCHEMA_VERSION, courses: [], issues: [importIssue(error.code, error.message)] }, assets: new Map<string, AssetMetadata>() };
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
  apply: (transaction: TTransaction, serverState: { parsedResult: unknown; previewResult: unknown }, importSessionId: string) => Promise<TResult>
) {
  return database.$transaction(async (transaction) => {
    const selector = { id_sourceHash: { id: input.previewId, sourceHash: input.sourceHash } };
    let session = await transaction.coursewareImportSession.findUnique({ where: selector });
    if (!session) return confirmationError(404, "COURSEWARE_IMPORT_PREVIEW_NOT_FOUND", "导入预览不存在");
    if (session.createdBy !== input.actorId) return confirmationError(403, "COURSEWARE_IMPORT_PREVIEW_FORBIDDEN", "无权确认该导入预览");
    if (session.confirmationKey !== coursewareImportConfirmationKey(session.id, session.sourceHash)) {
      return confirmationError(409, "COURSEWARE_IMPORT_PREVIEW_INVALID", "导入预览校验失败");
    }
    if (session.status === "confirmed") return { result: session.confirmResult as TResult, repeated: true };
    if (session.status !== "previewed") return confirmationError(409, "COURSEWARE_IMPORT_PREVIEW_UNAVAILABLE", "导入预览正在处理或已失效");
    const now = input.now ?? new Date();
    if (session.expiresAt.getTime() <= now.getTime()) return confirmationError(409, "COURSEWARE_IMPORT_PREVIEW_EXPIRED", "导入预览已过期，请重新上传");

    const claimed = await transaction.coursewareImportSession.updateMany({
      where: { id: session.id, sourceHash: session.sourceHash, status: "previewed", expiresAt: { gt: now } },
      data: { status: "confirming" }
    });
    if (!claimed.count) {
      session = await transaction.coursewareImportSession.findUnique({ where: selector });
      if (session?.status === "confirmed") return { result: session.confirmResult as TResult, repeated: true };
      return confirmationError(409, "COURSEWARE_IMPORT_CONFIRMING", "导入正在确认，请勿重复提交");
    }

    const result = await apply(transaction, { parsedResult: session.parsedResult, previewResult: session.previewResult }, session.id);
    await transaction.coursewareImportSession.update({
      where: { id: session.id },
      data: { status: "confirmed", confirmedAt: now, confirmResult: serialized(result) }
    });
    return { result, repeated: false };
  });
}

export async function previewCoursewareImport(file: SourceFile, options: PreviewOptions): Promise<CoursewareImportPreview> {
  const sourceHash = sha256(file.buffer);
  const { parsed, assets } = await parseSource(file);
  const issues = parsed.issues.map((entry) => ({ ...entry, file: entry.file || file.filename }));
  for (const course of parsed.courses) {
    if (!course.document) continue;
    const blocks = new Map(course.document.units.flatMap((unit) => unit.blocks.map((block) => [block.key, block] as const)));
    for (const block of blocks.values()) {
      if (block.type === "knowledge" && block.imageFileId) {
        issues.push({ file: file.filename, sheet: "JSON", row: 0, field: "imageFileId", code: "INTERNAL_ASSET_ID_NOT_ALLOWED", message: "导入文件不能直接引用系统内部素材 ID", courseCode: course.courseCode });
      }
    }
    const seenBindings = new Set<string>();
    for (const binding of course.assetBindings) {
      if (!safeAssetReference(binding.path)) {
        issues.push({ file: file.filename, sheet: binding.sheet ?? "素材", row: binding.row ?? 0, field: "path", code: "INVALID_ASSET_PATH", message: `素材路径无效：${binding.path}`, courseCode: course.courseCode });
      } else if (!assets.has(binding.path)) {
        issues.push({ file: file.filename, sheet: binding.sheet ?? "内容块", row: binding.row ?? 0, field: "素材文件名", code: "MISSING_ASSET", message: `找不到素材：${binding.path}`, courseCode: course.courseCode });
      }
      const block = blocks.get(binding.blockKey);
      if (!block) issues.push({ file: file.filename, sheet: binding.sheet ?? "素材", row: binding.row ?? 0, field: "blockKey", code: "UNKNOWN_BLOCK_KEY", message: `素材关联的内容块不存在：${binding.blockKey}`, courseCode: course.courseCode });
      else if (block.type !== "knowledge") issues.push({ file: file.filename, sheet: binding.sheet ?? "素材", row: binding.row ?? 0, field: "blockKey", code: "INVALID_ASSET_BLOCK", message: `素材只能关联图文知识卡：${binding.blockKey}`, courseCode: course.courseCode });
      const key = `${binding.blockKey}\0${binding.path}`;
      if (seenBindings.has(key)) issues.push({ file: file.filename, sheet: "素材", row: 0, field: "path", code: "DUPLICATE_ASSET_BINDING", message: `素材关联重复：${binding.path}`, courseCode: course.courseCode });
      seenBindings.add(key);
    }
  }

  const existingByCode = new Map<string, ExistingCoursewareReference[]>();
  options.existingCoursewares.forEach((courseware) => {
    if (courseware.code) existingByCode.set(courseware.code, [...(existingByCode.get(courseware.code) ?? []), courseware]);
  });
  const globalInvalid = issues.some((entry) => !entry.courseCode);
  const items = parsed.courses.map((course): CoursewareImportPreviewItem => {
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
      const contentHash = hashStructuredCourseware(course.document);
      if (existing[0]!.latestContentHash === contentHash) {
        classification = "conflict";
        issues.push({ file: file.filename, sheet: "数据库", row: 0, field: "内容", code: "UNCHANGED_CONTENT", message: "导入内容与现有最新版本相同", courseCode: course.courseCode });
      } else classification = "new_version";
    }
    return { courseCode: course.courseCode, title: course.title, classification, existingCoursewareId: existing.length === 1 ? existing[0]!.id : null, issueCount: issues.filter((entry) => entry.courseCode === course.courseCode).length };
  });

  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (options.ttlMinutes ?? 30) * 60_000);
  const previewId = randomUUID();
  const preview: CoursewareImportPreview = { previewId, sourceHash, templateVersion: parsed.templateVersion, expiresAt: expiresAt.toISOString(), items, issues };
  await options.store.create({
    id: previewId,
    sourceFileId: options.sourceFileId ?? null,
    originalFilename: file.filename,
    sourceHash,
    templateVersion: parsed.templateVersion,
    parsedResult: serialized({ courses: parsed.courses, assets: [...assets.values()] }),
    previewResult: serialized({ items, issues }),
    confirmationKey: coursewareImportConfirmationKey(previewId, sourceHash),
    createdBy: options.createdBy,
    expiresAt
  });
  return preview;
}
