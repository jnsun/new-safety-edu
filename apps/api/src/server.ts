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
import { processNotificationOutbox } from "./wechat-subscription.js";
import { registerPersonImportRoutes } from "./routes/person-import.js";
import { registerSafetyManagementRoutes } from "./routes/safety-management.js";
import { registerPhoneAuthRoutes } from "./routes/phone-auth.js";
import { registerWechatWebAuthRoutes } from "./routes/wechat-web-auth.js";
import { registerQualificationRoutes } from "./routes/qualifications.js";
import { registerProjectReportingRoutes } from "./routes/project-reporting.js";
import { registerSensitiveExportRoutes } from "./routes/sensitive-exports.js";
import { registerReceivablesRoutes } from "./routes/receivables.js";
import { cleanupExpiredSensitiveExports } from "./sensitive-export.js";
import { assertCsrfRequest } from "./csrf.js";

const env = loadEnv();
const app = Fastify({ logger: { level: env.NODE_ENV === "production" ? "info" : "debug", redact: ["req.headers.authorization", "req.headers.cookie", "body.password", "body.newPassword", "body.code", "body.refreshToken", "body.token", "body.nationalId"] }, bodyLimit: 16 * 1024 * 1024 });

app.decorateRequest("principal", null);
await app.register(cookie, { secret: env.COOKIE_SECRET });
await app.register(cors, { origin: env.NODE_ENV === "production" ? env.PUBLIC_BASE_URL : true, credentials: true });
await app.register(multipart);
app.addHook("onRequest", async (request) => assertCsrfRequest({ method: request.method, url: request.url, headers: request.headers, cookies: request.cookies, publicBaseUrl: env.PUBLIC_BASE_URL }));

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
await registerPersonImportRoutes(app, { env, ...guards });
await registerFileRoutes(app, { env, ...guards });
await registerWechatRoutes(app, { env, ...guards });
await registerDay2Routes(app, { env, ...guards });
await registerDay4Routes(app, { env, ...guards });
await registerSafetyManagementRoutes(app, { env, ...guards });
await registerQualificationRoutes(app, { env, authenticate: guards.authenticate });
await registerProjectReportingRoutes(app, { authenticate: guards.authenticate });
await registerSensitiveExportRoutes(app, { env, ...guards });
await registerReceivablesRoutes(app, { authenticate: guards.authenticate, enableAccessSmokeRoute: env.NODE_ENV === "test" && process.env.RECEIVABLES_ACCESS_SMOKE === "1" });
await registerPhoneAuthRoutes(app, { env, authenticate: guards.authenticate });
await registerWechatWebAuthRoutes(app, { env, authenticate: guards.authenticate, requireManager: guards.requireManager });

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
const outboxTimer = setInterval(() => void processNotificationOutbox(env).catch(() => app.log.error("wechat_delivery_failed")), 60 * 1000);
outboxTimer.unref();
void processNotificationOutbox(env).catch(() => app.log.error("wechat_delivery_failed"));
const sensitiveExportCleanupTimer = setInterval(() => void cleanupExpiredSensitiveExports(env).catch((error) => app.log.error({ err: error }, "sensitive_export_cleanup_failed")), 10 * 60 * 1000);
sensitiveExportCleanupTimer.unref();
void cleanupExpiredSensitiveExports(env).catch((error) => app.log.error({ err: error }, "sensitive_export_cleanup_failed"));

const listenHost = env.NODE_ENV === "test" && process.env.RECEIVABLES_TEST_LISTEN_HOST === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0";
await app.listen({ port: env.PORT, host: listenHost });
if (listenHost === "127.0.0.1") {
  const address = app.server.address();
  console.log(`RECEIVABLES_LISTEN_ADDRESS=${typeof address === "object" && address ? address.address : "unknown"}`);
}
