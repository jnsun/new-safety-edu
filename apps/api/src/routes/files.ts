import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { forbidden } from "../access.js";
import { sha256 } from "../crypto.js";
import { readablePrivateFile } from "../private-file-access.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export async function registerFileRoutes(app: FastifyInstance, deps: { env: Env; authenticate: Guard; requireManager: Guard }) {
  app.post("/api/files", { preHandler: deps.authenticate }, async (request, reply) => {
    const principal = request.principal!;
    const kind = z.object({ kind: z.enum(["photo", "signature", "courseware", "attachment"]) }).parse(request.query).kind;
    if (!["photo", "signature"].includes(kind) && !principal.roles.some(({ role }) => ["company_admin", "org_leader", "org_admin", "project_admin"].includes(role))) forbidden("无权上传该类型文件");
    const part = await request.file({ limits: { fileSize: kind === "courseware" ? 15 * 1024 * 1024 : 10 * 1024 * 1024, files: 1 } });
    if (!part) throw Object.assign(new Error("请选择文件"), { statusCode: 400, code: "FILE_REQUIRED" });
    if (kind === "photo" && !["image/jpeg", "image/png"].includes(part.mimetype)) throw Object.assign(new Error("照片只支持 JPEG/PNG"), { statusCode: 400, code: "INVALID_MIME" });
    if (kind === "signature" && part.mimetype !== "image/png") throw Object.assign(new Error("签字只支持 PNG"), { statusCode: 400, code: "INVALID_MIME" });
    if (kind === "attachment" && !["application/pdf", "image/png", "image/jpeg", "image/webp", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"].includes(part.mimetype)) throw Object.assign(new Error("附件只支持 PDF/PNG/JPG/WebP/XLSX"), { statusCode: 400, code: "INVALID_MIME" });
    if (kind === "courseware" && (part.mimetype !== "text/html" || !/\.html?$/i.test(part.filename))) throw Object.assign(new Error("HTML 课件只支持单个 .html 文件"), { statusCode: 400, code: "INVALID_MIME" });
    const buffer = await part.toBuffer();
    const key = `${new Date().getUTCFullYear()}/${randomUUID()}`;
    const root = resolve(deps.env.UPLOAD_ROOT);
    const path = resolve(root, key);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, buffer, { mode: 0o600 });
    const file = await prisma.privateFile.create({ data: { kind, storageKey: key, originalName: part.filename.slice(0, 240), mimeType: part.mimetype, size: buffer.length, sha256: sha256(buffer), uploadedBy: principal.accountId } });
    audit(principal.accountId, "file.upload", "file", file.id, { kind, size: buffer.length });
    return reply.code(201).send({ data: { id: file.id, kind: file.kind, originalName: file.originalName, size: file.size } });
  });

  app.get("/api/files/:id", { preHandler: deps.authenticate }, async (request, reply) => {
    const principal = request.principal!;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const file = await readablePrivateFile(principal, id);
    const content = await readFile(resolve(deps.env.UPLOAD_ROOT, file.storageKey));
    audit(principal.accountId, "file.read", "file", id);
    reply.header("Content-Type", file.mimeType).header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
    return reply.send(content);
  });
}
