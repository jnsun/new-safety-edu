import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { issueSession } from "../auth.js";
import { normalizePhone } from "../crypto.js";
import { auditCritical } from "../audit.js";
import { activatePendingRoles, bindAccountToPerson } from "../identity.js";
import { assertPasswordAllowed, securityHash, smsRateDecision } from "../auth-security.js";
import { writeCriticalAudit } from "../transaction-audit.js";
import { changeRequestKey } from "../request-policy.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
type VerificationPurpose = "login" | "change_phone" | "password_recovery";

const phoneSchema = z.string().transform(normalizePhone).pipe(z.string().regex(/^1\d{10}$/));
const digest = (value: string, env: Env) => createHmac("sha256", env.JWT_SECRET).update(value).digest("hex");

async function deliverCode(phone: string, code: string, purpose: VerificationPurpose, env: Env) {
  if (!env.SMS_SEND_ENDPOINT || !env.SMS_SEND_TOKEN) throw Object.assign(new Error("短信服务尚未配置"), { statusCode: 503, code: "SMS_NOT_CONFIGURED" });
  const response = await fetch(env.SMS_SEND_ENDPOINT, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.SMS_SEND_TOKEN}` }, body: JSON.stringify({ phone, code, purpose }) });
  if (!response.ok) throw Object.assign(new Error("短信发送暂时失败"), { statusCode: 502, code: "SMS_DELIVERY_FAILED" });
}

async function sendCode(phone: string, purpose: VerificationPurpose, source: string, env: Env) {
  const phoneHash = digest(phone, env); const sourceHash = securityHash(source, env.JWT_SECRET); const now = Date.now(); const scope = { OR: [{ phoneHash }, { sourceHash }] };
  const [lastMinute, lastFifteenMinutes, lastDay] = await Promise.all([
    prisma.phoneVerificationCode.count({ where: { ...scope, createdAt: { gt: new Date(now - 60_000) } } }),
    prisma.phoneVerificationCode.count({ where: { ...scope, createdAt: { gt: new Date(now - 15 * 60_000) } } }),
    prisma.phoneVerificationCode.count({ where: { ...scope, createdAt: { gt: new Date(now - 24 * 60 * 60_000) } } })
  ]);
  if (smsRateDecision({ lastMinute, lastFifteenMinutes, lastDay })) throw Object.assign(new Error("验证码发送过于频繁，请稍后再试"), { statusCode: 429, code: "SMS_RATE_LIMITED" });
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0"); await deliverCode(phone, code, purpose, env);
  await prisma.$transaction(async (tx) => {
    await tx.phoneVerificationCode.updateMany({ where: { phoneHash, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
    await tx.phoneVerificationCode.create({ data: { phoneHash, codeHash: digest(`${phone}:${code}`, env), purpose, sourceHash, expiresAt: new Date(Date.now() + 5 * 60_000) } });
    await tx.authSecurityEvent.create({ data: { accountIdentifierHash: phoneHash, eventType: "sms_code_sent", loginMethod: "phone", clientKind: "miniprogram", sourceHash, outcome: "success", metadata: { purpose } } });
  });
}

async function verifiedCode(phone: string, code: string, purpose: VerificationPurpose, env: Env) {
  const phoneHash = digest(phone, env); const row = await prisma.phoneVerificationCode.findFirst({ where: { phoneHash, purpose, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!row || row.attempts >= 5) throw Object.assign(new Error("验证码无效或已过期"), { statusCode: 401, code: "INVALID_SMS_CODE" });
  const expected = Buffer.from(row.codeHash, "hex"); const actual = Buffer.from(digest(`${phone}:${code}`, env), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) { await prisma.phoneVerificationCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } }); throw Object.assign(new Error("验证码无效或已过期"), { statusCode: 401, code: "INVALID_SMS_CODE" }); }
  return row;
}

export async function registerPhoneAuthRoutes(app: FastifyInstance, deps: { env: Env; authenticate: Guard }) {
  app.get("/api/auth/capabilities", async () => ({ data: { phoneLogin: Boolean(deps.env.SMS_SEND_ENDPOINT && deps.env.SMS_SEND_TOKEN), wechatLogin: Boolean(deps.env.WECHAT_APP_ID && deps.env.WECHAT_APP_SECRET) } }));
  app.post("/api/auth/recovery-request", async (request, reply) => {
    const input = z.object({ name: z.string().trim().min(2).max(80), oldPhone: phoneSchema, organizationId: z.string().uuid().optional(), reason: z.string().trim().min(2).max(500) }).parse(request.body); const phoneHash = digest(input.oldPhone, deps.env); const sourceHash = securityHash(request.ip, deps.env.JWT_SECRET);
    const person = await prisma.person.findFirst({ where: { name: input.name, phone: input.oldPhone, ...(input.organizationId ? { organizations: { some: { organizationId: input.organizationId, active: true } } } : {}) }, select: { id: true, account: { select: { id: true } } } });
    const requestKey = changeRequestKey("account_recovery", person?.id ?? phoneHash, sourceHash);
    const existing = await prisma.changeRequest.findFirst({ where: { type: "account_recovery", requestKey, status: "pending" } });
    if (!existing) await prisma.changeRequest.create({ data: { accountId: person?.account?.id ?? null, personId: person?.id ?? null, type: "account_recovery", requestKey, payload: { name: input.name, oldPhoneLast4: input.oldPhone.slice(-4), oldPhoneHash: phoneHash, organizationId: input.organizationId ?? null, reason: input.reason } } }).catch(() => undefined);
    return reply.code(202).send({ data: { accepted: true } });
  });
  app.post("/api/auth/phone/code", async (request) => {
    const phone = phoneSchema.parse(z.object({ phone: z.string() }).parse(request.body).phone); await sendCode(phone, "login", request.ip, deps.env);
    return { data: { sent: true, expiresIn: 300 } };
  });

  app.post("/api/auth/phone/login", async (request) => {
    const input = z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/) }).parse(request.body); const row = await verifiedCode(input.phone, input.code, "login", deps.env);
    const people = await prisma.person.findMany({ where: { phone: input.phone, status: "active" }, select: { id: true }, take: 2 });
    const result = await prisma.$transaction(async (tx) => {
      await tx.phoneVerificationCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      const byPhone = await tx.account.findUnique({ where: { verifiedPhone: input.phone } });
      const byPerson = people.length === 1 ? await tx.account.findUnique({ where: { personId: people[0]!.id } }) : null;
      if (byPhone?.status !== undefined && byPhone.status !== "active") throw Object.assign(new Error("账号已停用"), { statusCode: 403, code: "ACCOUNT_DISABLED" });
      if (byPerson?.status !== undefined && !["active", "pending"].includes(byPerson.status)) throw Object.assign(new Error("账号已停用"), { statusCode: 403, code: "ACCOUNT_DISABLED" });
      if (people.length === 1 && byPhone && byPerson && byPhone.id !== byPerson.id) {
        const binding = await bindAccountToPerson(tx, { currentAccountId: byPhone.id, personId: people[0]!.id, reason: "手机号登录识别到已有人员账号" });
        return { accountId: binding.status === "bound" ? binding.accountId : byPhone.id, bindingStatus: binding.status === "bound" ? "bound" as const : "pending_review" as const, ...(binding.status === "pending_merge" ? { requestId: binding.requestId } : {}) };
      }
      let account = byPerson ?? byPhone;
      if (!account) account = await tx.account.create({ data: { verifiedPhone: input.phone, ...(people.length === 1 ? { personId: people[0]!.id } : {}), status: people.length === 1 ? "active" : "pending" } });
      else account = await tx.account.update({ where: { id: account.id }, data: { verifiedPhone: input.phone, status: people.length === 1 ? "active" : "pending", ...(people.length === 1 ? { personId: people[0]!.id } : {}) } });
      if (people.length === 1) await activatePendingRoles(tx, { personId: people[0]!.id, accountId: account.id, actorId: account.id });
      if (people.length === 1) await tx.changeRequest.updateMany({ where: { personId: people[0]!.id, accountId: account.id, type: "account_opening", status: "pending" }, data: { status: "approved", reviewedBy: account.id, reviewedAt: new Date(), reviewNote: "本人通过短信验证激活" } });
      return { accountId: account.id, bindingStatus: people.length === 1 ? "bound" as const : "unbound" as const };
    });
    const requestId = "requestId" in result ? result.requestId : undefined;
    await auditCritical(result.accountId, "auth.phone_login", "account", result.accountId, requestId ? { mergeRequestId: requestId } : undefined, "var/audit-fallback.ndjson");
    return { data: { ...(await issueSession(result.accountId, deps.env, { clientKind: "miniprogram", loginMethod: "phone", userAgent: request.headers["user-agent"] })), bindingStatus: result.bindingStatus, ...(requestId ? { requestId } : {}) } };
  });

  app.post("/api/me/phone/code", { preHandler: deps.authenticate }, async (request) => {
    const phone = phoneSchema.parse(z.object({ phone: z.string() }).parse(request.body).phone); await sendCode(phone, "change_phone", request.ip, deps.env); return { data: { sent: true, expiresIn: 300 } };
  });

  app.post("/api/me/phone/confirm", { preHandler: deps.authenticate }, async (request, reply) => {
    const principal = request.principal!; if (!principal.personId) throw Object.assign(new Error("账号尚未绑定人员档案"), { statusCode: 409, code: "PERSON_REQUIRED" });
    const input = z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/) }).parse(request.body); const verification = await verifiedCode(input.phone, input.code, "change_phone", deps.env);
    await prisma.$transaction(async (tx) => {
      const conflict = await tx.account.findFirst({ where: { verifiedPhone: input.phone, id: { not: principal.accountId } }, select: { id: true } }); if (conflict) throw Object.assign(new Error("该手机号已被其他账号占用"), { statusCode: 409, code: "PHONE_ALREADY_BOUND" });
      await tx.phoneVerificationCode.update({ where: { id: verification.id }, data: { consumedAt: new Date() } });
      await tx.person.update({ where: { id: principal.personId! }, data: { phone: input.phone } });
      await tx.account.update({ where: { id: principal.accountId }, data: { verifiedPhone: input.phone, sessionVersion: { increment: 1 } } });
      await tx.refreshSession.updateMany({ where: { accountId: principal.accountId, revokedAt: null }, data: { revokedAt: new Date() } });
      await writeCriticalAudit(tx, { actorId: principal.accountId, action: "account.verified_phone_change", objectType: "account", objectId: principal.accountId, metadata: { personId: principal.personId } });
    });
    reply.clearCookie("safety_session", { path: "/" }); reply.clearCookie("safety_refresh", { path: "/api/auth" }); return reply.code(204).send();
  });

  app.post("/api/auth/password-recovery/code", async (request) => {
    const phone = phoneSchema.parse(z.object({ phone: z.string() }).parse(request.body).phone); await sendCode(phone, "password_recovery", request.ip, deps.env); return { data: { sent: true, expiresIn: 300 } };
  });

  app.post("/api/auth/password-recovery/confirm", async (request, reply) => {
    const input = z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/), newPassword: z.string().min(12).max(128) }).parse(request.body); const verification = await verifiedCode(input.phone, input.code, "password_recovery", deps.env);
    const account = await prisma.account.findUnique({ where: { verifiedPhone: input.phone }, include: { person: { select: { name: true, phone: true } } } });
    if (!account || account.status !== "active") throw Object.assign(new Error("验证码无效或账号不可用"), { statusCode: 401, code: "RECOVERY_NOT_AVAILABLE" });
    assertPasswordAllowed(input.newPassword, { username: account.usernameNormalized, phone: account.person?.phone ?? account.verifiedPhone, name: account.person?.name ?? null }); const passwordHash = await argon2.hash(input.newPassword);
    await prisma.$transaction(async (tx) => {
      await tx.phoneVerificationCode.update({ where: { id: verification.id }, data: { consumedAt: new Date() } });
      await tx.account.update({ where: { id: account.id }, data: { passwordHash, passwordLoginEnabled: true, mustChangePassword: false, sessionVersion: { increment: 1 }, failedLoginCount: 0, loginLockedUntil: null } });
      await tx.refreshSession.updateMany({ where: { accountId: account.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await writeCriticalAudit(tx, { actorId: account.id, action: "account.password_recovery", objectType: "account", objectId: account.id });
    });
    return reply.code(204).send();
  });
}
