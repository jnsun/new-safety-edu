import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { loadEnv } from "./env.js";
import { prisma } from "./db.js";
import { authHandlers } from "./auth.js";
import { registerDay1Routes } from "./routes/day1.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerWechatRoutes } from "./routes/wechat.js";
import { registerDay2Routes } from "./routes/day2.js";
import { generateScheduledReminders, registerDay4Routes } from "./routes/day4.js";

const env = loadEnv();
const app = Fastify({ logger: { level: env.NODE_ENV === "production" ? "info" : "debug", redact: ["req.headers.authorization", "req.headers.cookie", "body.password", "body.code", "body.refreshToken", "body.nationalId"] }, bodyLimit: 16 * 1024 * 1024 });

app.decorateRequest("principal", null);
await app.register(cookie, { secret: env.COOKIE_SECRET });
await app.register(cors, { origin: env.NODE_ENV === "production" ? env.PUBLIC_BASE_URL : true, credentials: true });
await app.register(multipart);

app.setErrorHandler((error, _request, reply) => {
  const tagged = error as Error & { statusCode?: number; code?: string };
  let statusCode = tagged.statusCode ?? 500;
  let code = tagged.code ?? "INTERNAL_ERROR";
  let message = statusCode >= 500 ? "服务器内部错误" : tagged.message;
  if (error instanceof ZodError) { statusCode = 400; code = "VALIDATION_ERROR"; message = error.issues[0]?.message ?? "请求参数错误"; }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") { statusCode = 409; code = "CONFLICT"; message = "数据已存在"; }
    if (error.code === "P2025") { statusCode = 404; code = "NOT_FOUND"; message = "数据不存在"; }
  }
  if (statusCode >= 500) app.log.error({ err: error }, "request_failed");
  return reply.code(statusCode).send({ error: { code, message } });
});

const guards = authHandlers(env);
await registerDay1Routes(app, { env, ...guards });
await registerFileRoutes(app, { env, ...guards });
await registerWechatRoutes(app, { env, ...guards });
await registerDay2Routes(app, { env, ...guards });
await registerDay4Routes(app, { env, ...guards });

app.get("/api/health", async () => {
  await prisma.$queryRaw`SELECT 1`;
  return { data: { status: "ok" } };
});

const adminDist = resolve("apps/admin/dist");
if (existsSync(adminDist)) {
  await app.register(fastifyStatic, { root: adminDist, wildcard: false });
  app.setNotFoundHandler((request, reply) => request.url.startsWith("/api/")
    ? reply.code(404).send({ error: { code: "NOT_FOUND", message: "接口不存在" } })
    : reply.sendFile("index.html"));
}

const shutdown = async () => { await app.close(); await prisma.$disconnect(); };
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

const reminderTimer = setInterval(() => void generateScheduledReminders(env).catch((error) => app.log.error({ err: error }, "reminder_generation_failed")), 6 * 60 * 60 * 1000);
reminderTimer.unref();
void generateScheduledReminders(env).catch((error) => app.log.error({ err: error }, "reminder_generation_failed"));

await app.listen({ port: env.PORT, host: "0.0.0.0" });
