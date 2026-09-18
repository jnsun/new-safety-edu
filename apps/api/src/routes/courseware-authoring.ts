import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { Prisma, type CoursewareType } from "@prisma/client";
import type { StructuredCoursewareDocument } from "@safety/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Principal } from "../auth.js";
import { audit } from "../audit.js";
import { prisma } from "../db.js";
import type { Env } from "../env.js";
import { exportCoursewareJson, exportCoursewareXlsx, exportCoursewareZip, type ExportAsset } from "../courseware-export.js";
import { createAnonymousCoursewareXlsx, createBlankCoursewareXlsx, createCoursewareJsonSchema, createCoursewareJsonTemplate } from "../courseware-template.js";
import { confirmCoursewareImport, previewCoursewareImport, type CoursewareImportActionPlan, type CoursewareImportConfirmationDatabase, type CoursewareImportConfirmationTransaction, type CoursewareImportScope } from "../courseware-import.js";
import { parseCoursewarePackage } from "../courseware-import-package.js";
import {
  canEditCoursewareVersion,
  hashStructuredCourseware,
  normalizeStructuredCourseware,
  retryCoursewareVersionCreate,
  structuredAssetSyncPlan,
  structuredCoursewareAssetIds,
  validateStructuredCoursewareAssets
} from "../structured-courseware.js";
import { assertCoursewareFile, assertScope } from "./day2.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
type Deps = { env: Env; authenticate: Guard; requireManager: Guard };

const principalOf = (request: FastifyRequest) => {
  if (!request.principal) throw Object.assign(new Error("未登录"), { statusCode: 401, code: "UNAUTHORIZED" });
  return request.principal;
};

const contentSchema = z.object({
  richText: z.string().trim().min(1).optional(),
  fileId: z.string().uuid().optional(),
  structuredContent: z.unknown().optional()
});

const createSchema = contentSchema.extend({
  title: z.string().trim().min(2).max(180),
  type: z.enum(["rich_text", "single_html", "structured"]),
  scopeType: z.enum(["company", "organization", "project"]),
  scopeId: z.string().uuid().nullable().optional()
});

const contentRequired = (): never => {
  throw Object.assign(new Error("课件内容不完整"), { statusCode: 400, code: "CONTENT_REQUIRED" });
};

type VersionFields = {
  richText: string | null;
  fileId: string | null;
  structuredContent: Prisma.InputJsonValue | typeof Prisma.DbNull;
  schemaVersion: number | null;
  estimatedMinutes: number | null;
  contentHash: string;
};

async function versionFields(type: CoursewareType, input: z.infer<typeof contentSchema>, principal: Principal): Promise<{ fields: VersionFields; document: StructuredCoursewareDocument | null }> {
  if (type === "rich_text") {
    const richText = input.richText;
    if (!richText) return contentRequired();
    return { fields: {
      richText,
      fileId: null,
      structuredContent: Prisma.DbNull,
      schemaVersion: null,
      estimatedMinutes: null,
      contentHash: createHash("sha256").update(richText).digest("hex")
    }, document: null };
  }
  if (type === "single_html") {
    const fileId = input.fileId;
    if (!fileId) return contentRequired();
    await assertCoursewareFile(principal, fileId);
    return { fields: {
      richText: null,
      fileId,
      structuredContent: Prisma.DbNull,
      schemaVersion: null,
      estimatedMinutes: null,
      contentHash: createHash("sha256").update(fileId).digest("hex")
    }, document: null };
  }
  if (input.structuredContent === undefined) contentRequired();
  const document = normalizeStructuredCourseware(input.structuredContent);
  return { fields: {
    richText: null,
    fileId: null,
    structuredContent: document as unknown as Prisma.InputJsonValue,
    schemaVersion: document.schemaVersion,
    estimatedMinutes: document.estimatedMinutes,
    contentHash: hashStructuredCourseware(document)
  }, document };
}

type Scope = { scopeType: string; scopeId: string | null };

async function validatedStructuredAssetIds(tx: Prisma.TransactionClient, document: StructuredCoursewareDocument | null, principal: Principal, scope: Scope) {
  if (!document) return [];
  const ids = structuredCoursewareAssetIds(document);
  if (!ids.length) return ids;
  const files = await tx.privateFile.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      kind: true,
      mimeType: true,
      uploadedBy: true,
      coursewareVersionAssets: { select: { coursewareVersion: { select: { courseware: { select: { scopeType: true, scopeId: true } } } } } }
    }
  });
  return validateStructuredCoursewareAssets(document, files.map((file) => ({
    id: file.id,
    kind: file.kind,
    mimeType: file.mimeType,
    uploadedBy: file.uploadedBy,
    scopes: file.coursewareVersionAssets.map(({ coursewareVersion }) => coursewareVersion.courseware)
  })), principal.accountId, scope);
}

async function syncStructuredAssets(tx: Prisma.TransactionClient, coursewareVersionId: string, desiredIds: string[]) {
  const current = await tx.coursewareVersionAsset.findMany({ where: { coursewareVersionId }, select: { fileId: true } });
  const plan = structuredAssetSyncPlan(current.map(({ fileId }) => fileId), desiredIds);
  if (plan.remove.length) await tx.coursewareVersionAsset.deleteMany({ where: { coursewareVersionId, fileId: { in: plan.remove } } });
  if (plan.add.length) await tx.coursewareVersionAsset.createMany({ data: plan.add.map((fileId) => ({ coursewareVersionId, fileId })), skipDuplicates: true });
}

type ImportApplyResult = {
  success: number;
  failed: number;
  items: Array<{ courseCode: string; status: "created" | "new_version"; coursewareId: string; versionId: string; version: number }>;
};

async function applyCoursewareImport(
  tx: Prisma.TransactionClient,
  actionPlan: CoursewareImportActionPlan,
  sourceBuffer: Buffer | null,
  importSessionId: string,
  actorId: string,
  env: Env
): Promise<ImportApplyResult> {
  const sourcePackage = sourceBuffer ? await parseCoursewarePackage(sourceBuffer) : null;
  const root = resolve(env.UPLOAD_ROOT);
  const createdPaths: string[] = [];
  const fileIdsByPath = new Map<string, string>();
  const rows: ImportApplyResult["items"] = [];
  try {
    for (const item of actionPlan.items) {
      const document = structuredClone(item.document);
      for (const identity of item.sourceAssets) {
        const source = sourcePackage?.assets.get(identity.path);
        if (!source || createHash("sha256").update(source.buffer).digest("hex") !== identity.sha256) {
          throw Object.assign(new Error(`课件 ${item.courseCode} 的素材校验失败`), { statusCode: 409, code: "COURSEWARE_IMPORT_ASSET_CHANGED" });
        }
        let fileId = fileIdsByPath.get(identity.path);
        if (!fileId) {
          const storageKey = `.courseware-assets/${randomUUID()}`;
          const path = resolve(root, storageKey);
          await mkdir(resolve(path, ".."), { recursive: true });
          await writeFile(path, source.buffer, { mode: 0o600 });
          createdPaths.push(path);
          const file = await tx.privateFile.create({ data: {
            kind: "courseware",
            storageKey,
            originalName: basename(identity.path).slice(0, 240),
            mimeType: source.mimeType,
            size: source.buffer.length,
            sha256: identity.sha256,
            uploadedBy: actorId
          } });
          fileId = file.id;
          fileIdsByPath.set(identity.path, fileId);
        }
        for (const unit of document.units) {
          const block = unit.blocks.find((candidate) => candidate.key === identity.blockKey);
          if (block?.type === "knowledge") block.imageFileId = fileId;
        }
      }

      let coursewareId: string;
      let version: number;
      if (item.classification === "create") {
        const existing = await tx.courseware.findFirst({ where: { code: item.courseCode, scopeType: actionPlan.scope.scopeType, scopeId: actionPlan.scope.scopeId }, select: { id: true } });
        if (existing) throw Object.assign(new Error(`课程编码 ${item.courseCode} 已存在，请重新预检`), { statusCode: 409, code: "COURSEWARE_IMPORT_STALE_PREVIEW" });
        const courseware = await tx.courseware.create({ data: { code: item.courseCode, title: item.title, type: "structured", scopeType: actionPlan.scope.scopeType, scopeId: actionPlan.scope.scopeId } });
        coursewareId = courseware.id;
        version = 1;
      } else {
        coursewareId = item.existingCoursewareId!;
        await tx.$queryRaw`SELECT id FROM coursewares WHERE id = ${coursewareId}::uuid FOR UPDATE`;
        const courseware = await tx.courseware.findFirst({ where: { id: coursewareId, code: item.courseCode, type: "structured", scopeType: actionPlan.scope.scopeType, scopeId: actionPlan.scope.scopeId }, select: { id: true } });
        if (!courseware) throw Object.assign(new Error(`课程编码 ${item.courseCode} 已发生变化，请重新预检`), { statusCode: 409, code: "COURSEWARE_IMPORT_STALE_PREVIEW" });
        const latest = await tx.coursewareVersion.findFirst({ where: { coursewareId }, orderBy: { version: "desc" }, select: { version: true } });
        version = (latest?.version ?? 0) + 1;
      }

      const created = await tx.coursewareVersion.create({ data: {
        coursewareId,
        version,
        status: "draft",
        richText: null,
        fileId: null,
        structuredContent: document as unknown as Prisma.InputJsonValue,
        schemaVersion: document.schemaVersion,
        estimatedMinutes: document.estimatedMinutes,
        contentHash: item.contentHash,
        importSessionId,
        importCourseCode: item.courseCode
      } });
      const assetIds = [...new Set(item.sourceAssets.map(({ path }) => fileIdsByPath.get(path)).filter((id): id is string => !!id))];
      if (assetIds.length) await tx.coursewareVersionAsset.createMany({ data: assetIds.map((fileId) => ({ coursewareVersionId: created.id, fileId })) });
      rows.push({ courseCode: item.courseCode, status: item.classification === "create" ? "created" : "new_version", coursewareId, versionId: created.id, version });
    }
    await tx.auditLog.create({ data: { actorId, action: "courseware.import_apply", objectType: "courseware_import_session", objectId: importSessionId, result: "success", metadata: { scope: actionPlan.scope, count: rows.length } } });
    return { success: rows.length, failed: 0, items: rows };
  } catch (error) {
    await Promise.all(createdPaths.map((path) => unlink(path).catch(() => undefined)));
    throw error;
  }
}

export async function registerCoursewareAuthoringRoutes(app: FastifyInstance, deps: Deps) {
  const manager = { preHandler: [deps.authenticate, deps.requireManager] };

  app.get("/api/courseware-authoring/templates/:format", manager, async (request, reply) => {
    const principal = principalOf(request);
    const { format } = z.object({ format: z.enum(["xlsx-blank", "xlsx-example", "json", "schema"]) }).parse(request.params);
    const output = format === "xlsx-blank" ? await createBlankCoursewareXlsx() : format === "xlsx-example" ? await createAnonymousCoursewareXlsx() : format === "json" ? createCoursewareJsonTemplate() : createCoursewareJsonSchema();
    const filename = format === "schema" ? "structured-courseware.schema.json" : format === "xlsx-blank" ? "structured-courseware-blank.xlsx" : format === "xlsx-example" ? "structured-courseware-example.xlsx" : "structured-courseware-example.json";
    audit(principal.accountId, "courseware.template_download", "courseware_template", format);
    return reply
      .header("Content-Type", format.startsWith("xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .send(output);
  });

  const importScopeSchema = z.object({
    scopeType: z.enum(["company", "organization", "project"]),
    scopeId: z.string().uuid().nullable().optional()
  }).transform((value): CoursewareImportScope => ({ scopeType: value.scopeType, scopeId: value.scopeType === "company" ? null : value.scopeId ?? null }));

  app.post("/api/courseware-authoring/imports/preview", manager, async (request, reply) => {
    const principal = principalOf(request);
    const scope = importScopeSchema.parse(request.query);
    await assertScope(principal, scope.scopeType, scope.scopeId);
    const part = await request.file({ limits: { files: 1, fileSize: 50 * 1024 * 1024 } });
    if (!part) throw Object.assign(new Error("请选择课件导入文件"), { statusCode: 400, code: "FILE_REQUIRED" });
    const filename = basename(part.filename).slice(0, 240);
    if (!/[.](xlsx|xlsm|json|zip)$/i.test(filename)) throw Object.assign(new Error("仅支持 XLSX、JSON 或 ZIP 课件文件"), { statusCode: 400, code: "UNSUPPORTED_IMPORT_FILE" });
    const buffer = await part.toBuffer();
    const storageKey = `.courseware-import-sources/${randomUUID()}`;
    const root = resolve(deps.env.UPLOAD_ROOT);
    const diskPath = resolve(root, storageKey);
    await mkdir(resolve(diskPath, ".."), { recursive: true });
    await writeFile(diskPath, buffer, { mode: 0o600 });
    let sourceFileId: string | undefined;
    try {
      const source = await prisma.privateFile.create({ data: {
        kind: "attachment",
        storageKey,
        originalName: filename,
        mimeType: part.mimetype || "application/octet-stream",
        size: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        uploadedBy: principal.accountId
      } });
      sourceFileId = source.id;
      const existingCoursewares = await prisma.courseware.findMany({
        where: { scopeType: scope.scopeType, scopeId: scope.scopeId },
        select: { id: true, code: true, type: true, scopeType: true, scopeId: true, versions: { orderBy: { version: "desc" }, take: 1, select: { contentHash: true } } }
      });
      const preview = await previewCoursewareImport({ filename, buffer }, {
        createdBy: principal.accountId,
        scope,
        sourceFileId,
        existingCoursewares: existingCoursewares.map(({ versions, ...courseware }) => ({ ...courseware, scopeType: courseware.scopeType as CoursewareImportScope["scopeType"], latestContentHash: versions[0]?.contentHash ?? null })),
        store: { create: async (data) => prisma.coursewareImportSession.create({ data: data as Prisma.CoursewareImportSessionUncheckedCreateInput, select: { id: true } }) }
      });
      audit(principal.accountId, "courseware.import_preview", "courseware_import_session", preview.previewId, { scopeType: scope.scopeType, scopeId: scope.scopeId, itemCount: preview.items.length, issueCount: preview.issues.length });
      return reply.code(201).send({ data: preview });
    } catch (error) {
      if (sourceFileId) await prisma.privateFile.delete({ where: { id: sourceFileId } }).catch(() => undefined);
      await unlink(diskPath).catch(() => undefined);
      throw error;
    }
  });

  const confirmSchema = z.object({ previewId: z.string().uuid(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
  app.post("/api/courseware-authoring/imports/confirm", manager, async (request) => {
    const principal = principalOf(request);
    const input = confirmSchema.parse(request.body);
    const confirmationDatabase = prisma as unknown as CoursewareImportConfirmationDatabase<CoursewareImportConfirmationTransaction>;
    const result = await confirmCoursewareImport<CoursewareImportConfirmationTransaction, ImportApplyResult>(confirmationDatabase, { ...input, actorId: principal.accountId }, {
      authorizeScope: async (_tx, actorId, scope) => {
        if (actorId !== principal.accountId) throw Object.assign(new Error("导入操作者不一致"), { statusCode: 403, code: "FORBIDDEN" });
        await assertScope(principal, scope.scopeType, scope.scopeId);
      },
      loadPrivateSource: async (tx, fileId, actorId) => {
        const database = tx as unknown as Prisma.TransactionClient;
        const file = await database.privateFile.findFirst({ where: { id: fileId, uploadedBy: actorId, kind: "attachment" } });
        if (!file) throw Object.assign(new Error("课件导入源文件不存在"), { statusCode: 409, code: "COURSEWARE_IMPORT_SOURCE_MISSING" });
        const root = resolve(deps.env.UPLOAD_ROOT);
        const path = resolve(root, file.storageKey);
        const outside = relative(root, path);
        if (isAbsolute(file.storageKey) || outside === ".." || outside.startsWith("../") || outside.startsWith("..\\") || isAbsolute(outside)) throw Object.assign(new Error("课件导入源文件路径无效"), { statusCode: 409, code: "COURSEWARE_IMPORT_SOURCE_INVALID" });
        const stat = await lstat(path);
        if (!stat.isFile() || stat.size !== file.size) throw Object.assign(new Error("课件导入源文件已变化"), { statusCode: 409, code: "COURSEWARE_IMPORT_SOURCE_CHANGED" });
        return readFile(path);
      }
    }, async (tx, state, importSessionId) => applyCoursewareImport(tx as unknown as Prisma.TransactionClient, state.actionPlan, state.sourceBuffer, importSessionId, principal.accountId, deps.env));
    audit(principal.accountId, "courseware.import_confirm", "courseware_import_session", input.previewId, { repeated: result.repeated });
    return { data: result };
  });

  app.get("/api/courseware-versions/:id/export", manager, async (request, reply) => {
    const principal = principalOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { format } = z.object({ format: z.enum(["xlsx", "json", "zip"]) }).parse(request.query);
    const version = await prisma.coursewareVersion.findUniqueOrThrow({
      where: { id },
      include: { courseware: true, assets: { include: { file: true } } }
    });
    await assertScope(principal, version.courseware.scopeType, version.courseware.scopeId);
    if (version.courseware.type !== "structured" || !version.structuredContent) {
      throw Object.assign(new Error("仅结构化课件支持此导出格式"), { statusCode: 400, code: "STRUCTURED_COURSEWARE_REQUIRED" });
    }
    const document = normalizeStructuredCourseware(version.structuredContent);
    const hasImages = document.units.some((unit) => unit.blocks.some((block) => block.type === "knowledge" && block.imageFileId));
    if (hasImages && format !== "zip") {
      throw Object.assign(new Error("包含图片的课件请导出 ZIP，以免丢失素材"), { statusCode: 400, code: "COURSEWARE_ZIP_REQUIRED" });
    }
    const filesById = new Map(version.assets.map(({ file }) => [file.id, file]));
    const usedNames = new Set<string>();
    const extensionByMime: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
    const assets: ExportAsset[] = [];
    for (const unit of document.units) for (const block of unit.blocks) {
      if (block.type !== "knowledge" || !block.imageFileId) continue;
      const file = filesById.get(block.imageFileId);
      if (!file) throw Object.assign(new Error("课件素材关联不完整"), { statusCode: 409, code: "COURSEWARE_ASSET_MISSING" });
      const extension = extensionByMime[file.mimeType] ?? extname(file.originalName).toLowerCase();
      let name = `${block.key.replace(/[^A-Za-z0-9_-]/g, "_") || "asset"}-${file.id.slice(0, 8)}${extension}`;
      while (usedNames.has(name.toLocaleLowerCase("en-US"))) name = `${block.key.replace(/[^A-Za-z0-9_-]/g, "_") || "asset"}-${file.id}${extension}`;
      usedNames.add(name.toLocaleLowerCase("en-US"));
      const path = `assets/${name}`;
      const root = resolve(deps.env.UPLOAD_ROOT);
      const diskPath = resolve(root, file.storageKey);
      const outside = relative(root, diskPath);
      if (outside.startsWith("..") || outside === "" || resolve(diskPath) !== diskPath) throw Object.assign(new Error("课件素材存储路径无效"), { statusCode: 409, code: "COURSEWARE_ASSET_PATH_INVALID" });
      const buffer = format === "zip" ? await readFile(diskPath) : Buffer.alloc(0);
      if (format === "zip" && (buffer.length !== file.size || createHash("sha256").update(buffer).digest("hex") !== file.sha256)) {
        throw Object.assign(new Error("课件素材文件校验失败"), { statusCode: 409, code: "COURSEWARE_ASSET_INTEGRITY_FAILED" });
      }
      assets.push({ blockKey: block.key, path, sha256: file.sha256, buffer });
    }
    const code = version.courseware.code ?? `courseware-${version.courseware.id}`;
    const output = format === "xlsx" ? await exportCoursewareXlsx(code, document, assets) : format === "json" ? exportCoursewareJson(code, document, assets) : await exportCoursewareZip(code, document, assets);
    audit(principal.accountId, "courseware.export", "courseware_version", id, { format, assetCount: assets.length });
    const filename = `courseware-${version.courseware.id}-v${version.version}.${format}`;
    const contentType = format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : format === "zip" ? "application/zip" : "application/json; charset=utf-8";
    return reply.header("Content-Type", contentType).header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`).send(output);
  });

  app.post("/api/coursewares", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = createSchema.parse(request.body);
    await assertScope(principal, input.scopeType, input.scopeId);
    const prepared = await versionFields(input.type, input, principal);
    const scope = { scopeType: input.scopeType, scopeId: input.scopeId ?? null };
    const courseware = await prisma.$transaction(async (tx) => {
      const assetIds = await validatedStructuredAssetIds(tx, prepared.document, principal, scope);
      const created = await tx.courseware.create({
        data: {
          title: input.title,
          type: input.type,
          ...scope,
          versions: { create: { version: 1, ...prepared.fields } }
        },
        include: { versions: true }
      });
      await syncStructuredAssets(tx, created.versions[0]!.id, assetIds);
      return created;
    });
    audit(principal.accountId, "courseware.create", "courseware", courseware.id);
    return reply.code(201).send({ data: courseware });
  });

  app.post("/api/coursewares/:id/versions", manager, async (request, reply) => {
    const principal = principalOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const courseware = await prisma.courseware.findUniqueOrThrow({ where: { id } });
    await assertScope(principal, courseware.scopeType, courseware.scopeId);
    const prepared = await versionFields(courseware.type, contentSchema.parse(request.body), principal);
    const scope = { scopeType: courseware.scopeType, scopeId: courseware.scopeId };
    const version = await retryCoursewareVersionCreate(() => prisma.$transaction(async (tx) => {
      const assetIds = await validatedStructuredAssetIds(tx, prepared.document, principal, scope);
      const latest = await tx.coursewareVersion.findFirst({ where: { coursewareId: id }, select: { version: true }, orderBy: { version: "desc" } });
      const created = await tx.coursewareVersion.create({ data: { coursewareId: id, version: (latest?.version ?? 0) + 1, ...prepared.fields } });
      await syncStructuredAssets(tx, created.id, assetIds);
      return created;
    }));
    audit(principal.accountId, "courseware.version_create", "courseware_version", version.id);
    return reply.code(201).send({ data: version });
  });

  app.put("/api/courseware-versions/:id/draft", manager, async (request) => {
    const principal = principalOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const version = await prisma.coursewareVersion.findUniqueOrThrow({ where: { id }, include: { courseware: true } });
    await assertScope(principal, version.courseware.scopeType, version.courseware.scopeId);
    if (!canEditCoursewareVersion(version)) throw Object.assign(new Error("已发布或归档的课件版本不可修改"), { statusCode: 409, code: "COURSEWARE_VERSION_IMMUTABLE" });
    const prepared = await versionFields(version.courseware.type, contentSchema.parse(request.body), principal);
    const updated = await prisma.$transaction(async (tx) => {
      const assetIds = await validatedStructuredAssetIds(tx, prepared.document, principal, { scopeType: version.courseware.scopeType, scopeId: version.courseware.scopeId });
      const changed = await tx.coursewareVersion.updateMany({ where: { id, status: "draft" }, data: prepared.fields });
      if (!changed.count) throw Object.assign(new Error("课件版本已不再是草稿"), { statusCode: 409, code: "COURSEWARE_VERSION_IMMUTABLE" });
      await syncStructuredAssets(tx, id, assetIds);
      return tx.coursewareVersion.findUniqueOrThrow({ where: { id } });
    });
    audit(principal.accountId, "courseware.draft_update", "courseware_version", id);
    return { data: updated };
  });

  app.patch("/api/coursewares/:id", manager, async (request) => {
    const principal = principalOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = contentSchema.extend({ title: z.string().trim().min(2).max(180) }).parse(request.body);
    const courseware = await prisma.courseware.findUniqueOrThrow({
      where: { id },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } }
    });
    await assertScope(principal, courseware.scopeType, courseware.scopeId);
    if (!courseware.active) throw Object.assign(new Error("课件已删除"), { statusCode: 409, code: "COURSEWARE_INACTIVE" });
    const current = courseware.versions[0];
    if (!current) throw Object.assign(new Error("课件没有可编辑内容"), { statusCode: 409, code: "COURSEWARE_VERSION_MISSING" });
    const prepared = await versionFields(courseware.type, input, principal);
    const updated = await prisma.$transaction(async (tx) => {
      const scope = { scopeType: courseware.scopeType, scopeId: courseware.scopeId };
      const assetIds = await validatedStructuredAssetIds(tx, prepared.document, principal, scope);
      const used = await tx.learningProgress.count({ where: { coursewareVersionId: current.id } });
      let versionId = current.id;
      let replaced = false;
      if (!used) {
        await tx.coursewareVersion.update({ where: { id: current.id }, data: prepared.fields });
        await syncStructuredAssets(tx, current.id, assetIds);
      } else {
        const created = await tx.coursewareVersion.create({ data: {
          coursewareId: id,
          version: current.version + 1,
          status: current.status === "draft" ? "draft" : "published",
          publishedAt: current.status === "draft" ? null : new Date(),
          ...prepared.fields
        } });
        await syncStructuredAssets(tx, created.id, assetIds);
        await tx.trainingTemplateItem.updateMany({ where: { coursewareVersionId: current.id, template: { active: true } }, data: { coursewareVersionId: created.id } });
        if (current.status === "published") await tx.coursewareVersion.update({ where: { id: current.id }, data: { status: "retired" } });
        versionId = created.id;
        replaced = true;
      }
      await tx.courseware.update({ where: { id }, data: { title: input.title } });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "courseware.update", objectType: "courseware", objectId: id, result: "success", metadata: { versionId, replacedUsedVersion: replaced } } });
      return tx.courseware.findUniqueOrThrow({ where: { id }, include: { versions: { orderBy: { version: "desc" } } } });
    });
    return { data: updated };
  });

  app.delete("/api/coursewares/:id", manager, async (request) => {
    const principal = principalOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const courseware = await prisma.courseware.findUniqueOrThrow({ where: { id }, include: { versions: { select: { id: true } } } });
    await assertScope(principal, courseware.scopeType, courseware.scopeId);
    const versionIds = courseware.versions.map(({ id: versionId }) => versionId);
    const activeTemplateCount = await prisma.trainingTemplateItem.count({ where: { coursewareVersionId: { in: versionIds }, template: { active: true } } });
    if (activeTemplateCount) throw Object.assign(new Error("课件仍被培训模板使用，请先编辑或删除相关模板"), { statusCode: 409, code: "COURSEWARE_IN_ACTIVE_TEMPLATE" });
    await prisma.$transaction(async (tx) => {
      await tx.coursewareVersion.updateMany({ where: { coursewareId: id, status: { not: "retired" } }, data: { status: "retired" } });
      await tx.courseware.update({ where: { id }, data: { active: false } });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "courseware.delete", objectType: "courseware", objectId: id, result: "success" } });
    });
    return { data: { id, deleted: true } };
  });
}
