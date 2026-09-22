import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { normalizePhone } from "../crypto.js";
import { assertPasswordAllowed, securityHash, smsRateDecision } from "../auth-security.js";
import { writeCriticalAudit } from "../transaction-audit.js";
import { changeRequestKey } from "../request-policy.js";
import { deliverCode, isSmsConfigured } from "../sms-delivery.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
export type VerificationPurpose = "wechat_bind" | "wechat_rebind" | "change_phone" | "password_recovery";

const phoneSchema = z.string().transform(normalizePhone).pipe(z.string().regex(/^1\d{10}$/));
const digest = (value: string, env: Env) => createHmac("sha256", env.JWT_SECRET).update(value).digest("hex");

export async function sendPhoneVerificationCode(phone: string, purpose: VerificationPurpose, source: string, env: Env) {
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

export async function verifiedPhoneCode(phone: string, code: string, purpose: VerificationPurpose, env: Env) {
  const phoneHash = digest(phone, env); const row = await prisma.phoneVerificationCode.findFirst({ where: { phoneHash, purpose, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!row || row.attempts >= 5) throw Object.assign(new Error("验证码无效或已过期"), { statusCode: 401, code: "INVALID_SMS_CODE" });
  const expected = Buffer.from(row.codeHash, "hex"); const actual = Buffer.from(digest(`${phone}:${code}`, env), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) { await prisma.phoneVerificationCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } }); throw Object.assign(new Error("验证码无效或已过期"), { statusCode: 401, code: "INVALID_SMS_CODE" }); }
  return row;
}

export async function registerPhoneAuthRoutes(app: FastifyInstance, deps: { env: Env; authenticate: Guard }) {
  app.get("/api/auth/capabilities", async () => ({ data: { smsVerification: isSmsConfigured(deps.env), wechatLogin: Boolean(deps.env.WECHAT_APP_ID && deps.env.WECHAT_APP_SECRET) } }));
  app.post("/api/auth/recovery-request", async (request, reply) => {
    const input = z.object({ name: z.string().trim().min(2).max(80), oldPhone: phoneSchema, organizationId: z.string().uuid().optional(), reason: z.string().trim().min(2).max(500) }).parse(request.body); const phoneHash = digest(input.oldPhone, deps.env); const sourceHash = securityHash(request.ip, deps.env.JWT_SECRET);
    const person = await prisma.person.findFirst({ where: { name: input.name, phone: input.oldPhone, ...(input.organizationId ? { organizations: { some: { organizationId: input.organizationId, active: true } } } : {}) }, select: { id: true, account: { select: { id: true } } } });
    const requestKey = changeRequestKey("account_recovery", person?.id ?? phoneHash, sourceHash);
    const existing = await prisma.changeRequest.findFirst({ where: { type: "account_recovery", requestKey, status: "pending" } });
    if (!existing) await prisma.changeRequest.create({ data: { accountId: person?.account?.id ?? null, personId: person?.id ?? null, type: "account_recovery", requestKey, payload: { name: input.name, oldPhoneLast4: input.oldPhone.slice(-4), oldPhoneHash: phoneHash, organizationId: input.organizationId ?? null, reason: input.reason } } }).catch(() => undefined);
    return reply.code(202).send({ data: { accepted: true } });
  });
  app.post("/api/me/phone/code", { preHandler: deps.authenticate }, async (request) => {
    const phone = phoneSchema.parse(z.object({ phone: z.string() }).parse(request.body).phone); await sendPhoneVerificationCode(phone, "change_phone", request.ip, deps.env); return { data: { sent: true, expiresIn: 300 } };
  });

  app.post("/api/me/phone/change-request", { preHandler: deps.authenticate }, async (request, reply) => {
    const principal = request.principal!;
    if (!principal.personId) throw Object.assign(new Error("账号尚未绑定人员档案"), { statusCode: 409, code: "PERSON_REQUIRED" });
    const personId = principal.personId;
    const input = z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/), reason: z.string().trim().min(2).max(500) }).parse(request.body);
    const person = await prisma.person.findUniqueOrThrow({ where: { id: personId }, select: { phone: true } });
    if (person.phone === input.phone) throw Object.assign(new Error("新手机号与现有手机号相同"), { statusCode: 409, code: "PHONE_UNCHANGED" });
    const verification = await verifiedPhoneCode(input.phone, input.code, "change_phone", deps.env);
    const requestKey = changeRequestKey("profile_change", personId, input.phone);
    const result = await prisma.$transaction(async (tx) => {
      const conflict = await tx.account.findFirst({ where: { verifiedPhone: input.phone, id: { not: principal.accountId } }, select: { id: true } });
      const personConflict = await tx.person.findFirst({ where: { phone: input.phone, id: { not: personId }, status: "active" }, select: { id: true } });
      if (conflict || personConflict) throw Object.assign(new Error("该手机号已关联其他人员"), { statusCode: 409, code: "PHONE_ALREADY_BOUND" });
      const claimed = await tx.phoneVerificationCode.updateMany({ where: { id: verification.id, consumedAt: null }, data: { consumedAt: new Date() } });
      if (claimed.count !== 1) throw Object.assign(new Error("验证码已使用"), { statusCode: 409, code: "SMS_CODE_CONSUMED" });
      const existing = await tx.changeRequest.findFirst({ where: { type: "profile_change", status: "pending", requestKey }, select: { id: true } });
      if (existing) return existing;
      const row = await tx.changeRequest.create({ data: { accountId: principal.accountId, personId, type: "profile_change", requestKey, payload: { phone: input.phone, phoneVerificationId: verification.id, reason: input.reason } } });
      const reviewers = await tx.roleAssignment.findMany({ where: { role: "company_admin", scopeType: "company", active: true, personId: { not: personId }, person: { status: "active", account: { status: "active" } } }, select: { personId: true } });
      for (const reviewer of reviewers) if (reviewer.personId) await tx.notification.upsert({ where: { dedupeKey: `phone-change-review:${row.id}:${reviewer.personId}` }, update: {}, create: { personId: reviewer.personId, title: "手机号变更待审核", body: "有一条已完成新手机号短信验证的资料变更申请待处理。", dedupeKey: `phone-change-review:${row.id}:${reviewer.personId}` } });
      await writeCriticalAudit(tx, { actorId: principal.accountId, action: "person.phone_change_request", objectType: "change_request", objectId: row.id, requestId: row.id, reason: input.reason, metadata: { phoneVerified: true } });
      return row;
    });
    return reply.code(201).send({ data: { id: result.id, status: "pending" } });
  });

  app.post("/api/me/phone/confirm", { preHandler: deps.authenticate }, async (request, reply) => {
    const principal = request.principal!; if (!principal.personId) throw Object.assign(new Error("账号尚未绑定人员档案"), { statusCode: 409, code: "PERSON_REQUIRED" });
    const input = z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/) }).parse(request.body); const verification = await verifiedPhoneCode(input.phone, input.code, "change_phone", deps.env);
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
    const phone = phoneSchema.parse(z.object({ phone: z.string() }).parse(request.body).phone); await sendPhoneVerificationCode(phone, "password_recovery", request.ip, deps.env); return { data: { sent: true, expiresIn: 300 } };
  });

  app.post("/api/auth/password-recovery/confirm", async (request, reply) => {
    const input = z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/), newPassword: z.string().min(12).max(128) }).parse(request.body); const verification = await verifiedPhoneCode(input.phone, input.code, "password_recovery", deps.env);
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
