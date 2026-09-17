import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { Prisma, type CoursewareType } from "@prisma/client";
import type { StructuredCoursewareDocument } from "@safety/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Principal } from "../auth.js";
import { audit } from "../audit.js";
import { prisma } from "../db.js";
import type { Env } from "../env.js";
import { exportCoursewareJson, exportCoursewareXlsx, exportCoursewareZip, type ExportAsset } from "../courseware-export.js";
import { createAnonymousCoursewareXlsx, createCoursewareJsonSchema, createCoursewareJsonTemplate } from "../courseware-template.js";
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

export async function registerCoursewareAuthoringRoutes(app: FastifyInstance, deps: Deps) {
  const manager = { preHandler: [deps.authenticate, deps.requireManager] };

  app.get("/api/courseware-authoring/templates/:format", manager, async (request, reply) => {
    const principal = principalOf(request);
    const { format } = z.object({ format: z.enum(["xlsx", "json", "schema"]) }).parse(request.params);
    const output = format === "xlsx" ? await createAnonymousCoursewareXlsx() : format === "json" ? createCoursewareJsonTemplate() : createCoursewareJsonSchema();
    const filename = format === "schema" ? "structured-courseware.schema.json" : `structured-courseware-template.${format}`;
    audit(principal.accountId, "courseware.template_download", "courseware_template", format);
    return reply
      .header("Content-Type", format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .send(output);
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
}
