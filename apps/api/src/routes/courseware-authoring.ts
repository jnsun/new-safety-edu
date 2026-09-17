import { createHash } from "node:crypto";
import { Prisma, type CoursewareType } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Principal } from "../auth.js";
import { audit } from "../audit.js";
import { prisma } from "../db.js";
import {
  canEditCoursewareVersion,
  hashStructuredCourseware,
  normalizeStructuredCourseware
} from "../structured-courseware.js";
import { assertCoursewareFile, assertScope } from "./day2.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
type Deps = { authenticate: Guard; requireManager: Guard };

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

async function versionFields(type: CoursewareType, input: z.infer<typeof contentSchema>, principal: Principal) {
  if (type === "rich_text") {
    const richText = input.richText;
    if (!richText) return contentRequired();
    return {
      richText,
      fileId: null,
      structuredContent: Prisma.DbNull,
      schemaVersion: null,
      estimatedMinutes: null,
      contentHash: createHash("sha256").update(richText).digest("hex")
    };
  }
  if (type === "single_html") {
    const fileId = input.fileId;
    if (!fileId) return contentRequired();
    await assertCoursewareFile(principal, fileId);
    return {
      richText: null,
      fileId,
      structuredContent: Prisma.DbNull,
      schemaVersion: null,
      estimatedMinutes: null,
      contentHash: createHash("sha256").update(fileId).digest("hex")
    };
  }
  if (input.structuredContent === undefined) contentRequired();
  const document = normalizeStructuredCourseware(input.structuredContent);
  return {
    richText: null,
    fileId: null,
    structuredContent: document as unknown as Prisma.InputJsonValue,
    schemaVersion: document.schemaVersion,
    estimatedMinutes: document.estimatedMinutes,
    contentHash: hashStructuredCourseware(document)
  };
}

export async function registerCoursewareAuthoringRoutes(app: FastifyInstance, deps: Deps) {
  const manager = { preHandler: [deps.authenticate, deps.requireManager] };

  app.post("/api/coursewares", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = createSchema.parse(request.body);
    await assertScope(principal, input.scopeType, input.scopeId);
    const fields = await versionFields(input.type, input, principal);
    const courseware = await prisma.courseware.create({
      data: {
        title: input.title,
        type: input.type,
        scopeType: input.scopeType,
        scopeId: input.scopeId ?? null,
        versions: { create: { version: 1, ...fields } }
      },
      include: { versions: true }
    });
    audit(principal.accountId, "courseware.create", "courseware", courseware.id);
    return reply.code(201).send({ data: courseware });
  });

  app.post("/api/coursewares/:id/versions", manager, async (request, reply) => {
    const principal = principalOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const courseware = await prisma.courseware.findUniqueOrThrow({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    await assertScope(principal, courseware.scopeType, courseware.scopeId);
    const fields = await versionFields(courseware.type, contentSchema.parse(request.body), principal);
    const version = await prisma.coursewareVersion.create({
      data: { coursewareId: id, version: (courseware.versions[0]?.version ?? 0) + 1, ...fields }
    });
    audit(principal.accountId, "courseware.version_create", "courseware_version", version.id);
    return reply.code(201).send({ data: version });
  });

  app.put("/api/courseware-versions/:id/draft", manager, async (request) => {
    const principal = principalOf(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const version = await prisma.coursewareVersion.findUniqueOrThrow({ where: { id }, include: { courseware: true } });
    await assertScope(principal, version.courseware.scopeType, version.courseware.scopeId);
    if (!canEditCoursewareVersion(version)) throw Object.assign(new Error("已发布或归档的课件版本不可修改"), { statusCode: 409, code: "COURSEWARE_VERSION_IMMUTABLE" });
    const fields = await versionFields(version.courseware.type, contentSchema.parse(request.body), principal);
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.coursewareVersion.updateMany({ where: { id, status: "draft" }, data: fields });
      if (!changed.count) throw Object.assign(new Error("课件版本已不再是草稿"), { statusCode: 409, code: "COURSEWARE_VERSION_IMMUTABLE" });
      return tx.coursewareVersion.findUniqueOrThrow({ where: { id } });
    });
    audit(principal.accountId, "courseware.draft_update", "courseware_version", id);
    return { data: updated };
  });
}
