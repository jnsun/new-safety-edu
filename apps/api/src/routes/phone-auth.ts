import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { issueSession } from "../auth.js";
import { normalizePhone } from "../crypto.js";
import { auditCritical } from "../audit.js";
import { activatePendingRoles, bindAccountToPerson } from "../identity.js";

const phoneSchema = z.string().transform(normalizePhone).pipe(z.string().regex(/^1\d{10}$/));
const digest = (value: string, env: Env) => createHmac("sha256", env.JWT_SECRET).update(value).digest("hex");

async function deliverCode(phone: string, code: string, env: Env) {
  if (!env.SMS_SEND_ENDPOINT || !env.SMS_SEND_TOKEN) throw Object.assign(new Error("短信服务尚未配置"), { statusCode: 503, code: "SMS_NOT_CONFIGURED" });
  const response = await fetch(env.SMS_SEND_ENDPOINT, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.SMS_SEND_TOKEN}` }, body: JSON.stringify({ phone, code, purpose: "login" }) });
  if (!response.ok) throw Object.assign(new Error("短信发送暂时失败"), { statusCode: 502, code: "SMS_DELIVERY_FAILED" });
}

export async function registerPhoneAuthRoutes(app: FastifyInstance, deps: { env: Env }) {
  app.get("/api/auth/capabilities", async () => ({ data: { phoneLogin: Boolean(deps.env.SMS_SEND_ENDPOINT && deps.env.SMS_SEND_TOKEN), wechatLogin: Boolean(deps.env.WECHAT_APP_ID && deps.env.WECHAT_APP_SECRET) } }));
  app.post("/api/auth/phone/code", async (request) => {
    const phone = phoneSchema.parse(z.object({ phone: z.string() }).parse(request.body).phone); const phoneHash = digest(phone, deps.env);
    const recent = await prisma.phoneVerificationCode.findFirst({ where: { phoneHash, purpose: "login", createdAt: { gt: new Date(Date.now() - 60_000) } } });
    if (recent) throw Object.assign(new Error("验证码发送过于频繁，请稍后再试"), { statusCode: 429, code: "SMS_RATE_LIMITED" });
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await deliverCode(phone, code, deps.env);
    await prisma.phoneVerificationCode.create({ data: { phoneHash, codeHash: digest(`${phone}:${code}`, deps.env), purpose: "login", expiresAt: new Date(Date.now() + 5 * 60_000) } });
    return { data: { sent: true, expiresIn: 300 } };
  });

  app.post("/api/auth/phone/login", async (request) => {
    const input = z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/) }).parse(request.body); const phoneHash = digest(input.phone, deps.env);
    const row = await prisma.phoneVerificationCode.findFirst({ where: { phoneHash, purpose: "login", consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    if (!row || row.attempts >= 5) throw Object.assign(new Error("验证码无效或已过期"), { statusCode: 401, code: "INVALID_SMS_CODE" });
    const expected = Buffer.from(row.codeHash, "hex"); const actual = Buffer.from(digest(`${input.phone}:${input.code}`, deps.env), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) { await prisma.phoneVerificationCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } }); throw Object.assign(new Error("验证码无效或已过期"), { statusCode: 401, code: "INVALID_SMS_CODE" }); }
    const people = await prisma.person.findMany({ where: { phone: input.phone, status: "active" }, select: { id: true }, take: 2 });
    const result = await prisma.$transaction(async (tx) => {
      await tx.phoneVerificationCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      const byPhone = await tx.account.findUnique({ where: { verifiedPhone: input.phone } });
      const byPerson = people.length === 1 ? await tx.account.findUnique({ where: { personId: people[0]!.id } }) : null;
      if (byPhone?.status !== undefined && byPhone.status !== "active") throw Object.assign(new Error("账号已停用"), { statusCode: 403, code: "ACCOUNT_DISABLED" });
      if (byPerson?.status !== undefined && byPerson.status !== "active") throw Object.assign(new Error("账号已停用"), { statusCode: 403, code: "ACCOUNT_DISABLED" });
      if (people.length === 1 && byPhone && byPerson && byPhone.id !== byPerson.id) {
        const binding = await bindAccountToPerson(tx, { currentAccountId: byPhone.id, personId: people[0]!.id, reason: "手机号登录识别到已有人员账号" });
        return { accountId: binding.status === "bound" ? binding.accountId : byPhone.id, bindingStatus: binding.status === "bound" ? "bound" as const : "pending_review" as const, ...(binding.status === "pending_merge" ? { requestId: binding.requestId } : {}) };
      }
      let account = byPerson ?? byPhone;
      if (!account) account = await tx.account.create({ data: { verifiedPhone: input.phone, ...(people.length === 1 ? { personId: people[0]!.id } : {}), status: "active" } });
      else account = await tx.account.update({ where: { id: account.id }, data: { verifiedPhone: input.phone, ...(people.length === 1 ? { personId: people[0]!.id } : {}) } });
      if (people.length === 1) await activatePendingRoles(tx, { personId: people[0]!.id, accountId: account.id, actorId: account.id });
      return { accountId: account.id, bindingStatus: people.length === 1 ? "bound" as const : "unbound" as const };
    });
    const requestId = "requestId" in result ? result.requestId : undefined;
    await auditCritical(result.accountId, "auth.phone_login", "account", result.accountId, requestId ? { mergeRequestId: requestId } : undefined, "var/audit-fallback.ndjson");
    return { data: { ...(await issueSession(result.accountId, deps.env, { clientKind: "miniprogram", userAgent: request.headers["user-agent"] })), bindingStatus: result.bindingStatus, ...(requestId ? { requestId } : {}) } };
  });
}
