import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { cleanupExpiredSensitiveExports, consumeSensitiveExport, createSensitiveExportJob, issueSensitiveExportToken, processSensitiveExportJob, sensitiveExportCategories } from "../sensitive-export.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export async function registerSensitiveExportRoutes(app: FastifyInstance, deps: { env: Env; authenticate: Guard; requireManager: Guard }) {
  app.get("/api/sensitive-exports", { preHandler: [deps.authenticate] }, async (request) => {
    await cleanupExpiredSensitiveExports(deps.env);
    const rows = await prisma.sensitiveExportJob.findMany({ where: { requestedBy: request.principal!.accountId }, select: { id: true, scopeType: true, scopeId: true, scopeSnapshot: true, categories: true, status: true, size: true, sha256: true, error: true, completedAt: true, downloadedAt: true, expiresAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 50 });
    return { data: rows };
  });

  app.post("/api/sensitive-exports", { preHandler: [deps.authenticate] }, async (request, reply) => {
    const input = z.object({ scopeType: z.enum(["company", "organization", "project", "self"]), scopeId: z.string().uuid().nullable(), categories: z.array(z.enum(sensitiveExportCategories)).min(1).max(sensitiveExportCategories.length), confirmed: z.literal(true) }).parse(request.body);
    if (input.scopeType === "self" && input.categories.includes("audit")) throw Object.assign(new Error("本人资料文件不包含内部审计详情"), { statusCode: 400, code: "SELF_EXPORT_CATEGORY_FORBIDDEN" });
    const job = await createSensitiveExportJob(request.principal!, input, deps.env);
    if (job.status === "pending") setImmediate(() => void processSensitiveExportJob(job.id, deps.env).catch((error) => app.log.error({ err: error, jobId: job.id }, "sensitive_export_failed")));
    return reply.code(202).send({ data: { id: job.id, status: job.status } });
  });

  app.post("/api/sensitive-exports/:id/token", { preHandler: [deps.authenticate] }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { data: await issueSensitiveExportToken(id, request.principal!) };
  });

  app.post("/api/sensitive-exports/:id/download", { preHandler: [deps.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { token } = z.object({ token: z.string().min(32).max(200) }).parse(request.body);
    const file = await consumeSensitiveExport(id, token, request.principal!, deps.env);
    const stream = createReadStream(file.path);
    stream.once("close", () => void unlink(file.path).catch(() => undefined));
    reply.header("Content-Type", "application/zip").header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff").header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return reply.send(stream);
  });
}
