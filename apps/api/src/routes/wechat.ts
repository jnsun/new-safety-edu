import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { encryptNationalId, normalizePhone } from "../crypto.js";
import { issueSensitiveToken, issueSession } from "../auth.js";
import { audit, auditCritical } from "../audit.js";
import { accessibleOrganizationIds, canAccessOrganization, canAccessPerson, canAccessProject, forbidden, isCompanyAdmin, orgAdminScopeIds, projectScopeIds } from "../access.js";
import { activatePendingRoles, bindAccountToPerson, setPrimaryOrganization } from "../identity.js";
import { assertOwnedFiles } from "../file-association-policy.js";
import { changeRequestKey, claimPendingRequest } from "../request-policy.js";
import { writeCriticalAudit } from "../transaction-audit.js";
import { assertWechatVerificationPurpose, canReviewWechatIdentityRequest, decideWechatBinding } from "../wechat-identity-policy.js";
import { attachProvisionalWechatAccount, resolveWechatAccount } from "../wechat-identity.js";
import { sendPhoneVerificationCode, verifiedPhoneCode } from "./phone-auth.js";
import { autoDispatchInTransaction } from "./day2.js";
import { setCsrfCookie } from "../csrf.js";
import { getWechatPhoneNumber } from "../wechat-api.js";
import { issueWechatPhoneVerificationToken, verifyWechatPhoneVerificationToken } from "../wechat-phone-verification.js";
import { decideWebLoginDestination, safetyWebRoleNames } from "../web-login-access.js";
import { resolveReceivablesAccess } from "../receivables-access.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

const requestContentKey = (row: { accountId: string | null; personId: string | null; projectId: string | null; type: string; payload: Prisma.JsonValue }) => {
  const payload = row.payload as Record<string, unknown>;
  return [row.accountId, row.personId, row.projectId, row.type, payload.name, payload.phone, payload.type, payload.organizationId, payload.contractorOrganizationId, payload.responsibleOrganizationId, payload.targetAccountId, payload.targetPersonId, payload.reason].map((value) => String(value ?? "")).join("|");
};

async function wechatSession(code: string, env: Env): Promise<{ openid: string; unionid?: string }> {
  if (env.NODE_ENV === "development" && code.startsWith("dev:")) return { openid: `dev-${code.slice(4) || "user"}` };
  if (!env.WECHAT_APP_ID || !env.WECHAT_APP_SECRET) throw Object.assign(new Error("微信登录尚未配置"), { statusCode: 503, code: "WECHAT_NOT_CONFIGURED" });
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", env.WECHAT_APP_ID); url.searchParams.set("secret", env.WECHAT_APP_SECRET);
  url.searchParams.set("js_code", code); url.searchParams.set("grant_type", "authorization_code");
  const response = await fetch(url); const body = await response.json() as { openid?: string; unionid?: string; errcode?: number };
  if (!response.ok || !body.openid) throw Object.assign(new Error("微信登录失败"), { statusCode: 401, code: "WECHAT_LOGIN_FAILED" });
  return { openid: body.openid, ...(body.unionid ? { unionid: body.unionid } : {}) };
}

export async function registerWechatRoutes(app: FastifyInstance, deps: { env: Env; authenticate: Guard; requireManager: Guard }) {
  app.get("/api/wechat/subscription-config", { preHandler: deps.authenticate }, async () => ({ data: {
    templateIds: [...new Set([deps.env.WECHAT_SUBSCRIBE_TEMPLATE_TASK, deps.env.WECHAT_SUBSCRIBE_TEMPLATE_DUE].filter((value): value is string => Boolean(value)))]
  } }));

  app.post("/api/wechat/subscription-consent", { preHandler: deps.authenticate }, async (request) => {
    const statuses = z.record(z.string().min(1).max(100), z.enum(["accept", "reject", "ban"])).parse(z.object({ statuses: z.unknown() }).parse(request.body).statuses);
    await prisma.userPreference.upsert({
      where: { accountId_key: { accountId: request.principal!.accountId, key: "wechat.subscriptionConsent" } },
      create: { accountId: request.principal!.accountId, key: "wechat.subscriptionConsent", value: statuses },
      update: { value: statuses }
    });
    if (request.principal!.personId && Object.values(statuses).includes("accept")) await prisma.notificationOutbox.updateMany({ where: { status: "skipped", notification: { personId: request.principal!.personId } }, data: { status: "pending", nextAttemptAt: null, lastError: null } });
    return { data: { saved: true } };
  });

  app.post("/api/wechat/login", async (request) => {
    const code = z.object({ code: z.string().min(1).max(200) }).parse(request.body).code;
    const wx = await wechatSession(code, deps.env);
    const appId = deps.env.WECHAT_APP_ID ?? "development";
    const resolved = await prisma.$transaction((tx) => resolveWechatAccount(tx, { appId, openid: wx.openid, ...(wx.unionid ? { unionid: wx.unionid } : {}) }), { isolationLevel: "Serializable" });
    if (!["active", "pending"].includes(resolved.account.status) || (resolved.account.status === "active" && !resolved.account.personId)) throw Object.assign(new Error("微信关联账号不可用"), { statusCode: 403, code: "WECHAT_ACCOUNT_UNAVAILABLE" });
    const session = await issueSession(resolved.account.id, deps.env, { clientKind: "miniprogram", loginMethod: "wechat", userAgent: request.headers["user-agent"] });
    const pending = !resolved.account.personId ? await prisma.changeRequest.findFirst({ where: { accountId: resolved.account.id, type: "binding", status: "pending" }, orderBy: { createdAt: "desc" }, select: { id: true } }) : null;
    return { data: { ...session, bindingStatus: resolved.account.personId ? "bound" : pending ? "pending_review" : "unbound", ...(pending ? { requestId: pending.id } : {}) } };
  });

  app.post("/api/wechat/reauthenticate", { preHandler: deps.authenticate }, async (request) => {
    const principal = request.principal!;
    if (!principal.personId) forbidden("账号尚未绑定人员档案");
    const code = z.object({ code: z.string().min(1).max(200) }).parse(request.body).code;
    const wx = await wechatSession(code, deps.env);
    const binding = await prisma.wechatBinding.findFirst({ where: { appId: deps.env.WECHAT_APP_ID ?? "development", openid: wx.openid, accountId: principal.accountId, active: true }, select: { id: true } });
    if (!binding) throw Object.assign(new Error("微信身份再次验证失败"), { statusCode: 401, code: "WECHAT_REAUTH_FAILED" });
    await auditCritical(principal.accountId, "person.self_sensitive_access_grant", "person", principal.personId, { field: "nationalId", action: "read" }, "var/audit-fallback.ndjson");
    return { data: { token: await issueSensitiveToken(principal.accountId, deps.env, { targetPersonId: principal.personId, field: "nationalId", action: "read" }), expiresIn: 300 } };
  });

  app.get("/api/wechat/registration-options", { preHandler: deps.authenticate }, async () => ({ data: {
    organizations: await prisma.organization.findMany({ where: { type: "contractor" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    businessEntities: await prisma.organization.findMany({ where: { type: "business_entity" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    departments: await prisma.organization.findMany({ where: { type: { in: ["business_entity", "department"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    projects: await prisma.project.findMany({ where: { status: "active", responsibleOrganization: { type: "business_entity" } }, select: { id: true, name: true, responsibleOrganizationId: true, responsibleOrganization: { select: { name: true } } }, orderBy: { name: "asc" } })
  } }));

  app.post("/api/wechat/identity/phone-code", { preHandler: deps.authenticate }, async (request) => {
    const input = z.object({ phone: z.string().transform(normalizePhone).pipe(z.string().regex(/^1\d{10}$/)) }).parse(request.body);
    const match = await prisma.person.findFirst({ where: { phone: input.phone, status: "active" }, select: { account: { select: { id: true, wechatBindings: { where: { active: true }, select: { id: true } } } } } });
    const purpose = match?.account && match.account.id !== request.principal!.accountId && match.account.wechatBindings.length ? "wechat_rebind" : "wechat_bind";
    await sendPhoneVerificationCode(input.phone, purpose, request.ip, deps.env);
    return { data: { sent: true, expiresIn: 300, purpose } };
  });

  app.post("/api/wechat/identity/wechat-phone", { preHandler: deps.authenticate }, async (request) => {
    const principal = request.principal!;
    if (principal.personId) throw Object.assign(new Error("当前微信已绑定人员档案"), { statusCode: 409, code: "WECHAT_ALREADY_BOUND" });
    const input = z.object({ code: z.string().min(1).max(300) }).parse(request.body);
    const phone = await getWechatPhoneNumber(input.code, deps.env);
    const [matches, phoneOwner, activeBinding] = await Promise.all([
      prisma.person.findMany({ where: { phone, status: "active" }, take: 3, include: { organizations: { where: { active: true, primary: true }, include: { organization: { select: { type: true } } } }, account: { include: { wechatBindings: { where: { active: true } } } } } }),
      prisma.account.findUnique({ where: { verifiedPhone: phone }, select: { id: true, personId: true } }),
      prisma.wechatBinding.findFirst({ where: { accountId: principal.accountId, active: true }, select: { id: true } })
    ]);
    if (!activeBinding) throw Object.assign(new Error("绑定上下文无效"), { statusCode: 409, code: "WECHAT_BIND_CONTEXT_INVALID" });

    const matched = matches.length === 1 ? matches[0]! : null;
    const primary = matched?.organizations[0];
    const validPrimary = primary && ["business_entity", "department"].includes(primary.organization.type);
    const accountConflict = Boolean((phoneOwner && phoneOwner.id !== principal.accountId && phoneOwner.personId !== matched?.id) || (matched?.account && !["active", "pending"].includes(matched.account.status)));
    if (matched && validPrimary && !accountConflict) {
      const purpose = matched.account && matched.account.id !== principal.accountId && matched.account.wechatBindings.length ? "wechat_rebind" : "wechat_bind";
      const accountId = await prisma.$transaction(async (tx) => {
        const targetAccountId = await attachProvisionalWechatAccount(tx, { provisionalAccountId: principal.accountId, personId: matched.id, verifiedPhone: phone, actorId: principal.accountId, reason: `本人微信手机号验证后${purpose === "wechat_rebind" ? "更换微信" : "首次绑定微信"}` });
        await activatePendingRoles(tx, { personId: matched.id, accountId: targetAccountId, actorId: principal.accountId });
        await tx.changeRequest.updateMany({ where: { personId: matched.id, type: "account_opening", status: "pending" }, data: { status: "approved", reviewedBy: principal.accountId, reviewedAt: new Date(), reviewNote: "本人完成微信及手机号验证" } });
        await writeCriticalAudit(tx, { actorId: targetAccountId, action: purpose === "wechat_rebind" ? "auth.wechat_rebind" : "auth.wechat_bind", objectType: "person", objectId: matched.id, metadata: { organizationId: primary.organizationId, phoneVerified: true, phoneVerificationMethod: "wechat" } });
        return targetAccountId;
      }, { isolationLevel: "Serializable" });
      if (matched.type === "employee") await prisma.$transaction((tx) => autoDispatchInTransaction(tx, "three_level", matched.id, deps.env));
      return { data: { status: "bound", ...await issueSession(accountId, deps.env, { clientKind: "miniprogram", loginMethod: "wechat", userAgent: request.headers["user-agent"] }) } };
    }

    return { data: {
      status: "profile_required",
      maskedPhone: `${phone.slice(0, 3)}****${phone.slice(-4)}`,
      wechatPhoneVerificationToken: await issueWechatPhoneVerificationToken(principal.accountId, phone, deps.env),
      matchStatus: matches.length === 0 ? "none" : matches.length > 1 ? "multiple" : accountConflict ? "conflict" : "organization_required"
    } };
  });

  app.post("/api/wechat/identity/confirm", { preHandler: deps.authenticate }, async (request, reply) => {
    const principal = request.principal!;
    const details = { name: z.string().trim().min(2).max(80), organizationId: z.string().uuid(), reason: z.string().trim().max(500).default("") };
    const input = z.union([
      z.object({ ...details, phone: z.string().transform(normalizePhone).pipe(z.string().regex(/^1\d{10}$/)), code: z.string().regex(/^\d{6}$/), purpose: z.string() }),
      z.object({ ...details, wechatPhoneVerificationToken: z.string().min(1).max(2000) })
    ]).parse(request.body);
    const smsPurpose = "purpose" in input ? assertWechatVerificationPurpose(input.purpose) : null;
    const verification = "code" in input ? await verifiedPhoneCode(input.phone, input.code, smsPurpose!, deps.env) : null;
    const phone = "wechatPhoneVerificationToken" in input ? await verifyWechatPhoneVerificationToken(input.wechatPhoneVerificationToken, principal.accountId, deps.env) : input.phone;
    const verificationMethod = verification ? "sms" : "wechat";
    const [organization, matches, phoneOwner, activeBinding] = await Promise.all([
      prisma.organization.findFirst({ where: { id: input.organizationId, type: { in: ["business_entity", "department"] } }, select: { id: true, type: true } }),
      prisma.person.findMany({ where: { phone, status: "active" }, take: 3, include: { organizations: { where: { active: true, primary: true }, include: { organization: { select: { type: true } } } }, account: { include: { wechatBindings: { where: { active: true } } } } } }),
      prisma.account.findUnique({ where: { verifiedPhone: phone }, select: { id: true, personId: true } }),
      prisma.wechatBinding.findFirst({ where: { accountId: principal.accountId, active: true }, select: { unionid: true } })
    ]);
    if (!organization || !activeBinding) throw Object.assign(new Error("绑定上下文无效"), { statusCode: 409, code: "WECHAT_BIND_CONTEXT_INVALID" });
    const matched = matches.length === 1 ? matches[0]! : null;
    const primary = matched?.organizations[0];
    const selectedOrganizationMatches = primary?.organizationId === input.organizationId;
    const accountConflict = Boolean((phoneOwner && phoneOwner.id !== principal.accountId && phoneOwner.personId !== matched?.id) || (matched?.account && !["active", "pending"].includes(matched.account.status)));
    const crossEntityConflict = Boolean(primary && primary.organizationId !== input.organizationId && primary.organization.type === "business_entity" && organization.type === "business_entity");
    const identityConflict = matches.length > 1 || accountConflict;
    const purpose = smsPurpose ?? (matched?.account && matched.account.id !== principal.accountId && matched.account.wechatBindings.length ? "wechat_rebind" : "wechat_bind");
    let decision = decideWechatBinding({ activePersonMatches: matches.length, selectedOrganizationMatches, hasIdentityConflict: identityConflict, crossEntityConflict });
    const reviewers = await prisma.roleAssignment.findMany({ where: { role: "org_admin", scopeType: "organization", scopeId: input.organizationId, active: true, personId: { not: null }, person: { status: "active", account: { status: "active" } } }, select: { personId: true } });
    if (!reviewers.length && decision !== "direct") decision = "company_review";

    if (decision === "direct" && matched) {
      const accountId = await prisma.$transaction(async (tx) => {
        if (verification) {
          const consumed = await tx.phoneVerificationCode.updateMany({ where: { id: verification.id, consumedAt: null }, data: { consumedAt: new Date() } });
          if (consumed.count !== 1) throw Object.assign(new Error("验证码已使用"), { statusCode: 409, code: "SMS_CODE_CONSUMED" });
        }
        const targetAccountId = await attachProvisionalWechatAccount(tx, { provisionalAccountId: principal.accountId, personId: matched.id, verifiedPhone: phone, actorId: principal.accountId, reason: `${verificationMethod === "wechat" ? "本人微信手机号验证" : "本人短信验证"}后${purpose === "wechat_rebind" ? "更换微信" : "首次绑定微信"}` });
        await activatePendingRoles(tx, { personId: matched.id, accountId: targetAccountId, actorId: principal.accountId });
        await tx.changeRequest.updateMany({ where: { personId: matched.id, type: "account_opening", status: "pending" }, data: { status: "approved", reviewedBy: principal.accountId, reviewedAt: new Date(), reviewNote: "本人完成微信及手机号验证" } });
        await writeCriticalAudit(tx, { actorId: targetAccountId, action: purpose === "wechat_rebind" ? "auth.wechat_rebind" : "auth.wechat_bind", objectType: "person", objectId: matched.id, metadata: { organizationId: input.organizationId, phoneVerified: true, phoneVerificationMethod: verificationMethod } });
        return targetAccountId;
      }, { isolationLevel: "Serializable" });
      if (matched.type === "employee") await prisma.$transaction((tx) => autoDispatchInTransaction(tx, "three_level", matched.id, deps.env));
      const clientKind = request.headers.authorization?.startsWith("Bearer ") ? "miniprogram" as const : "web" as const;
      let destination: "/" | "/receivables" = "/";
      if (clientKind === "web") {
        const [safetyRole, receivables] = await Promise.all([
          prisma.roleAssignment.findFirst({ where: { personId: matched.id, active: true, role: { in: [...safetyWebRoleNames] } }, select: { id: true } }),
          resolveReceivablesAccess({ accountId }),
        ]);
        const access = decideWebLoginDestination({ hasManagerRole: Boolean(safetyRole), canEnterReceivables: receivables.canEnter });
        if (!access.allowed) return { data: { status: "bound_no_admin" } };
        destination = access.path;
      }
      const session = await issueSession(accountId, deps.env, { clientKind, loginMethod: "wechat", userAgent: request.headers["user-agent"] });
      if (clientKind === "web") {
        reply.setCookie("safety_session", session.accessToken, { httpOnly: true, sameSite: "strict", secure: deps.env.NODE_ENV === "production", path: "/", maxAge: 900 });
        reply.setCookie("safety_refresh", session.refreshToken, { httpOnly: true, sameSite: "strict", secure: deps.env.NODE_ENV === "production", path: "/api/auth", maxAge: 8 * 60 * 60 });
        setCsrfCookie(reply, deps.env);
      }
      return { data: { status: "bound", destination, ...session } };
    }

    const requestKey = changeRequestKey("binding", principal.accountId, phone);
    const row = await prisma.$transaction(async (tx) => {
      if (verification) {
        const consumed = await tx.phoneVerificationCode.updateMany({ where: { id: verification.id, consumedAt: null }, data: { consumedAt: new Date() } });
        if (consumed.count !== 1) throw Object.assign(new Error("验证码已使用"), { statusCode: 409, code: "SMS_CODE_CONSUMED" });
      }
      let change = await tx.changeRequest.findFirst({ where: { type: "binding", status: "pending", requestKey } });
      if (!change) change = await tx.changeRequest.create({ data: { accountId: principal.accountId, type: "binding", requestKey, payload: { name: input.name, phone, phoneVerified: true, phoneVerifiedAt: new Date().toISOString(), phoneVerificationMethod: verificationMethod, ...(verification ? { phoneVerificationId: verification.id } : {}), organizationId: input.organizationId, reason: input.reason, matchCount: matches.length, matchStatus: matches.length === 0 ? "none" : matches.length === 1 ? selectedOrganizationMatches ? "unique" : "department_mismatch" : "multiple", escalatedToCompany: decision === "company_review", conflictCodes: [...(accountConflict ? ["phone_account_conflict"] : []), ...(crossEntityConflict ? ["cross_entity_conflict"] : []), ...(matches.length > 1 ? ["multiple_person_matches"] : []), ...(!reviewers.length ? ["no_org_admin"] : [])] } } });
      const recipientIds = decision === "company_review"
        ? (await tx.roleAssignment.findMany({ where: { role: "company_admin", scopeType: "company", active: true, personId: { not: null }, person: { status: "active", account: { status: "active" } } }, select: { personId: true } })).map(({ personId }) => personId!)
        : reviewers.map(({ personId }) => personId!);
      for (const personId of new Set(recipientIds)) await tx.notification.upsert({ where: { dedupeKey: `identity-binding-review:${change.id}:${personId}` }, update: {}, create: { personId, title: "身份绑定申请待审核", body: "有一条已完成手机号验证的微信身份绑定申请待处理。", dedupeKey: `identity-binding-review:${change.id}:${personId}` } });
      await writeCriticalAudit(tx, { actorId: principal.accountId, allowPendingActor: true, action: "binding.request_create", objectType: "change_request", objectId: change.id, requestId: change.id, metadata: { organizationId: input.organizationId, phoneVerified: true, phoneVerificationMethod: verificationMethod, escalatedToCompany: decision === "company_review" } });
      return change;
    }, { isolationLevel: "Serializable" });
    return { data: { status: "pending_review", requestId: row.id, escalatedToCompany: decision === "company_review" } };
  });

  app.post("/api/wechat/registration-requests", { preHandler: deps.authenticate }, async (request, reply) => {
    const input = z.object({
      name: z.string().trim().min(2).max(80), phone: z.string().regex(/^1\d{10}$/),
      type: z.enum(["contractor", "temporary_individual"]), organizationId: z.string().uuid().optional(), projectId: z.string().uuid(),
      nationalId: z.string().trim().min(6).max(30), photoFileId: z.string().uuid()
    }).parse(request.body);
    const accountId = request.principal!.accountId;
    const [project, contractorOrganization] = await Promise.all([
      prisma.project.findFirst({ where: { id: input.projectId, status: "active", responsibleOrganization: { type: "business_entity" } }, select: { responsibleOrganizationId: true } }),
      input.organizationId ? prisma.organization.findUnique({ where: { id: input.organizationId }, select: { type: true } }) : null
    ]);
    if (!project) throw Object.assign(new Error("所选项目不存在或不可申请"), { statusCode: 400, code: "INVALID_PROJECT" });
    if (input.type === "contractor" && contractorOrganization?.type !== "contractor") throw Object.assign(new Error("外协人员必须选择外协单位"), { statusCode: 400, code: "CONTRACTOR_ORGANIZATION_REQUIRED" });
    const photo = await prisma.privateFile.findUnique({ where: { id: input.photoFileId }, select: { id: true, kind: true, uploadedBy: true } });
    assertOwnedFiles(photo ? [photo] : [], [input.photoFileId], accountId, "photo");
    const requestKey = changeRequestKey("registration", accountId, `${input.projectId}:${input.phone}`);
    const existing = await prisma.changeRequest.findFirst({ where: { type: "registration", status: "pending", requestKey } });
    if (existing) return { data: { id: existing.id, status: existing.status } };
    const encrypted = encryptNationalId(input.nationalId, deps.env);
    const row = await prisma.changeRequest.create({ data: {
      accountId, projectId: input.projectId, type: "registration", requestKey,
      payload: { name: input.name, phone: input.phone, type: input.type, contractorOrganizationId: input.type === "contractor" ? input.organizationId : null, responsibleOrganizationId: project.responsibleOrganizationId, photoFileId: input.photoFileId, ...encrypted },
      attachments: { create: { fileId: input.photoFileId } }
    } });
    return reply.code(201).send({ data: { id: row.id, status: row.status } });
  });

  app.get("/api/binding-requests", { preHandler: [deps.authenticate, deps.requireManager] }, async (request) => {
    const principal = request.principal!; const orgIds = new Set(await accessibleOrganizationIds(principal)); const identityOrgIds = new Set(orgAdminScopeIds(principal)); const projectIds = new Set(projectScopeIds(principal));
    const candidates = await prisma.changeRequest.findMany({ where: { status: "pending", type: { in: isCompanyAdmin(principal) ? ["binding", "registration", "account_merge", "person_merge"] : ["binding", "registration"] } }, orderBy: { createdAt: "desc" } });
    const seen = new Set<string>(); const uniqueCandidates = candidates.filter((row) => { const key = requestContentKey(row); if (seen.has(key)) return false; seen.add(key); return true; });
    const rows = isCompanyAdmin(principal) ? uniqueCandidates : uniqueCandidates.filter((row) => {
      const payload = row.payload as Record<string, unknown>;
      if (row.type === "binding") return payload.escalatedToCompany !== true && identityOrgIds.has(String(payload.organizationId ?? ""));
      return (row.projectId && projectIds.has(row.projectId)) || orgIds.has(String(payload.organizationId ?? ""));
    });
    const organizationIds = [...new Set(rows.flatMap((row) => { const payload = row.payload as Record<string, unknown>; return [payload.responsibleOrganizationId, payload.organizationId, payload.contractorOrganizationId].map((value) => String(value ?? "")).filter(Boolean); }))];
    const organizationNames = new Map((await prisma.organization.findMany({ where: { id: { in: organizationIds } }, select: { id: true, name: true } })).map((row) => [row.id, row.name]));
    const mergeAccountIds = [...new Set(rows.flatMap((row) => row.type === "account_merge" ? [row.accountId, (row.payload as Record<string, unknown>).targetAccountId].filter((value): value is string => typeof value === "string") : []))];
    const mergeAccountLabels = new Map((await prisma.account.findMany({ where: { id: { in: mergeAccountIds } }, select: { id: true, username: true, person: { select: { name: true } } } })).map((account) => [account.id, `${account.person?.name ?? "未关联人员"} · ${account.username ?? "无用户名"}`]));
    return { data: rows.map(({ payload, ...row }) => {
      const value = payload as Record<string, unknown>;
      const phone = typeof value.phone === "string" ? `${value.phone.slice(0, 3)}****${value.phone.slice(-4)}` : undefined;
      const organizationId = typeof value.responsibleOrganizationId === "string" ? value.responsibleOrganizationId : typeof value.organizationId === "string" ? value.organizationId : undefined;
      const targetAccountId = typeof value.targetAccountId === "string" ? value.targetAccountId : undefined;
      const targetPersonId = typeof value.targetPersonId === "string" ? value.targetPersonId : undefined;
      return { ...row, payload: { ...(typeof value.name === "string" ? { name: value.name } : {}), ...(phone ? { phone } : {}), ...(typeof value.type === "string" ? { type: value.type } : {}), ...(typeof value.reason === "string" ? { reason: value.reason } : {}), ...(organizationId ? { organizationId, organizationName: organizationNames.get(organizationId) } : {}), ...(row.type === "account_merge" ? { sourceAccountLabel: row.accountId ? mergeAccountLabels.get(row.accountId) : undefined, targetAccountLabel: targetAccountId ? mergeAccountLabels.get(targetAccountId) : undefined } : {}), ...(row.type === "person_merge" ? { targetPersonId } : {}), matchCount: value.matchCount, phoneVerified: value.phoneVerified === true, matchStatus: value.matchStatus, conflictCodes: value.conflictCodes, escalatedToCompany: value.escalatedToCompany === true } };
    }) };
  });

  app.get("/api/identity-binding-requests/:id/candidates", { preHandler: [deps.authenticate, deps.requireManager] }, async (request) => {
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const row = await prisma.changeRequest.findFirst({ where: { id, type: "binding", status: "pending" } });
    if (!row) throw Object.assign(new Error("绑定申请不存在或已处理"), { statusCode: 404, code: "BINDING_REQUEST_NOT_FOUND" });
    const payload = z.object({ organizationId: z.string().uuid(), escalatedToCompany: z.boolean().optional() }).passthrough().parse(row.payload);
    if (!canReviewWechatIdentityRequest(request.principal!, payload.organizationId, payload.escalatedToCompany === true)) forbidden();
    const people = await prisma.person.findMany({
      where: {
        status: "active",
        ...(isCompanyAdmin(request.principal!)
          ? { OR: [{ organizations: { some: { organizationId: payload.organizationId, active: true, primary: true } } }, ...(typeof payload.phone === "string" ? [{ phone: payload.phone }] : [])] }
          : { organizations: { some: { organizationId: payload.organizationId, active: true, primary: true } } })
      },
      select: { id: true, name: true, phone: true, account: { select: { id: true, status: true } } }, orderBy: { name: "asc" }
    });
    return { data: people.map(({ phone, ...person }) => ({ ...person, phone: `${phone.slice(0, 3)}****${phone.slice(-4)}` })) };
  });

  app.post("/api/identity-binding-requests/:id/review", { preHandler: [deps.authenticate, deps.requireManager] }, async (request) => {
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const input = z.object({ action: z.enum(["bind_existing", "update_phone_and_bind", "create_employee_and_bind", "repair_membership_and_bind", "escalate_company", "reject"]), personId: z.string().uuid().optional(), note: z.string().trim().min(2).max(500) }).parse(request.body);
    const row = await prisma.changeRequest.findFirst({ where: { id, type: "binding", status: "pending" } });
    if (!row?.accountId) throw Object.assign(new Error("绑定申请不存在或已处理"), { statusCode: 404, code: "BINDING_REQUEST_NOT_FOUND" });
    const payload = z.object({ name: z.string().min(2), phone: z.string().regex(/^1\d{10}$/), phoneVerified: z.literal(true), phoneVerificationId: z.string().uuid().optional(), organizationId: z.string().uuid(), escalatedToCompany: z.boolean().optional() }).passthrough().parse(row.payload);
    if (!canReviewWechatIdentityRequest(request.principal!, payload.organizationId, payload.escalatedToCompany === true)) forbidden();
    if (input.action === "escalate_company") {
      if (isCompanyAdmin(request.principal!)) throw Object.assign(new Error("申请已由公司管理员处理"), { statusCode: 409, code: "ALREADY_COMPANY_REVIEW" });
      await prisma.$transaction(async (tx) => {
        await tx.changeRequest.update({ where: { id }, data: { payload: { ...(row.payload as Record<string, unknown>), escalatedToCompany: true, conflictCodes: [...new Set([...(Array.isArray((row.payload as Record<string, unknown>).conflictCodes) ? (row.payload as Record<string, unknown>).conflictCodes as string[] : []), "organization_change_required"])] } } });
        const companyAdmins = await tx.roleAssignment.findMany({ where: { role: "company_admin", scopeType: "company", active: true, personId: { not: null }, person: { status: "active", account: { status: "active" } } }, select: { personId: true } });
        for (const { personId } of companyAdmins) await tx.notification.upsert({ where: { dedupeKey: `identity-binding-review:${id}:${personId}` }, update: {}, create: { personId: personId!, title: "身份绑定申请需公司处理", body: "部门管理员发现人员归属或账号冲突，请公司管理员处理。", dedupeKey: `identity-binding-review:${id}:${personId}` } });
        await writeCriticalAudit(tx, { actorId: request.principal!.accountId, action: "binding.escalate_company", objectType: "change_request", objectId: id, requestId: id, reason: input.note, metadata: { organizationId: payload.organizationId } });
      });
      return { data: { status: "company_review" } };
    }
    if (input.action === "reject") {
      await prisma.$transaction(async (tx) => {
        await claimPendingRequest(tx, id, { status: "rejected", reviewedBy: request.principal!.accountId, reviewNote: input.note });
        await writeCriticalAudit(tx, { actorId: request.principal!.accountId, action: "binding.reject", objectType: "change_request", objectId: id, requestId: id, reason: input.note });
      });
      return { data: { status: "rejected" } };
    }

    const result = await prisma.$transaction(async (tx) => {
      let person;
      if (input.action === "create_employee_and_bind") {
        const duplicate = await tx.person.findFirst({ where: { phone: payload.phone, status: "active" }, select: { id: true } });
        if (duplicate) throw Object.assign(new Error("手机号已有在用人员档案，请选择已有档案"), { statusCode: 409, code: "PHONE_PERSON_CONFLICT" });
        person = await tx.person.create({ data: { name: payload.name, phone: payload.phone, type: "employee", status: "active", organizations: { create: { organizationId: payload.organizationId, primary: true, active: true } } } });
      } else {
        if (!input.personId) throw Object.assign(new Error("请选择本部门人员档案"), { statusCode: 400, code: "PERSON_REQUIRED" });
        person = await tx.person.findFirst({ where: { id: input.personId, status: "active" }, include: { organizations: { where: { active: true, primary: true } } } });
        if (!person) throw Object.assign(new Error("人员档案不存在或不可用"), { statusCode: 409, code: "PERSON_NOT_ACTIVE" });
        const primary = person.organizations[0];
        if (primary && primary.organizationId !== payload.organizationId) {
          if (input.action !== "repair_membership_and_bind" || !isCompanyAdmin(request.principal!)) forbidden("人员当前属于其他组织，请升级给公司管理员处理部门变更");
          await setPrimaryOrganization(tx, { personId: person.id, organizationId: payload.organizationId, actorId: request.principal!.accountId, reason: input.note, actorIsCompanyAdmin: true });
        }
        if (!primary) {
          if (input.action !== "repair_membership_and_bind") throw Object.assign(new Error("人员缺少当前主部门，请选择修复归属后绑定"), { statusCode: 409, code: "PRIMARY_ORGANIZATION_REQUIRED" });
          await tx.organizationMembership.create({ data: { personId: person.id, organizationId: payload.organizationId, primary: true, active: true } });
        }
        if (input.action === "bind_existing" && person.phone !== payload.phone) throw Object.assign(new Error("档案手机号与已验证手机号不一致，请选择修正手机号后绑定"), { statusCode: 409, code: "VERIFIED_PHONE_MISMATCH" });
        if (input.action === "update_phone_and_bind") {
          const duplicate = await tx.person.findFirst({ where: { phone: payload.phone, status: "active", id: { not: person.id } }, select: { id: true } });
          if (duplicate) throw Object.assign(new Error("已验证手机号对应其他人员档案"), { statusCode: 409, code: "PHONE_PERSON_CONFLICT" });
          person = await tx.person.update({ where: { id: person.id }, data: { phone: payload.phone } });
        }
      }
      const accountId = await attachProvisionalWechatAccount(tx, { provisionalAccountId: row.accountId!, personId: person.id, verifiedPhone: payload.phone, actorId: request.principal!.accountId, reason: input.note });
      await activatePendingRoles(tx, { personId: person.id, accountId, actorId: request.principal!.accountId });
      await claimPendingRequest(tx, id, { status: "approved", reviewedBy: request.principal!.accountId, reviewNote: input.note });
      await tx.changeRequest.update({ where: { id }, data: { personId: person.id, afterSummary: { action: input.action, organizationId: payload.organizationId, phoneVerified: true } } });
      await writeCriticalAudit(tx, { actorId: request.principal!.accountId, action: "binding.approve", objectType: "change_request", objectId: id, requestId: id, reason: input.note, metadata: { personId: person.id, organizationId: payload.organizationId, action: input.action } });
      if (input.action === "create_employee_and_bind") await autoDispatchInTransaction(tx, "three_level", person.id, deps.env);
      return { personId: person.id, accountId };
    }, { isolationLevel: "Serializable" });
    return { data: { status: "approved", personId: result.personId } };
  });

  app.post("/api/binding-requests/:id/approve", { preHandler: [deps.authenticate, deps.requireManager] }, async (request) => {
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const input = z.object({ personId: z.string().uuid().optional(), note: z.string().trim().max(500).optional() }).parse(request.body); const personId = input.personId;
    const change = await prisma.changeRequest.findUniqueOrThrow({ where: { id } });
    if (change.projectId && !await canAccessProject(request.principal!, change.projectId)) forbidden();
    if (!change.accountId || change.status !== "pending") throw Object.assign(new Error("申请状态不可审批"), { statusCode: 409, code: "REQUEST_NOT_PENDING" });
    if (change.type === "registration") {
      if (!change.projectId) throw Object.assign(new Error("注册申请缺少项目"), { statusCode: 409, code: "INVALID_REGISTRATION" });
      const payload = z.object({
        name: z.string().min(2), phone: z.string().regex(/^1\d{10}$/), type: z.enum(["contractor", "temporary_individual"]),
        organizationId: z.string().uuid().optional(), contractorOrganizationId: z.string().uuid().nullable().optional(), responsibleOrganizationId: z.string().uuid().optional(), photoFileId: z.string().uuid(), nationalIdCipher: z.string().min(1), nationalIdIv: z.string().min(1),
        nationalIdTag: z.string().min(1), nationalIdHash: z.string().length(64), nationalIdLast4: z.string().length(4)
      }).parse(change.payload);
      const [duplicate, contractorOrganization, photo, project] = await Promise.all([
        prisma.person.findFirst({ where: { phone: payload.phone, status: "active" }, select: { id: true } }),
        payload.contractorOrganizationId ?? payload.organizationId ? prisma.organization.findUnique({ where: { id: (payload.contractorOrganizationId ?? payload.organizationId)! }, select: { type: true } }) : null,
        prisma.privateFile.findUnique({ where: { id: payload.photoFileId }, select: { id: true, kind: true, uploadedBy: true } }),
        prisma.project.findUnique({ where: { id: change.projectId }, select: { status: true, responsibleOrganizationId: true, responsibleOrganization: { select: { type: true } } } })
      ]);
      if (duplicate) throw Object.assign(new Error("手机号已有在用档案，请改为绑定申请"), { statusCode: 409, code: "PHONE_EXISTS" });
      if (!project || project.status !== "active" || project.responsibleOrganization.type !== "business_entity" || (payload.responsibleOrganizationId && payload.responsibleOrganizationId !== project.responsibleOrganizationId) || (payload.type === "contractor" && contractorOrganization?.type !== "contractor")) {
        throw Object.assign(new Error("申请的组织、照片或项目已不可用"), { statusCode: 409, code: "REGISTRATION_CONTEXT_INVALID" });
      }
      try {
        assertOwnedFiles(photo ? [photo] : [], [payload.photoFileId], change.accountId, "photo");
      } catch {
        throw Object.assign(new Error("申请的组织、照片或项目已不可用"), { statusCode: 409, code: "REGISTRATION_CONTEXT_INVALID" });
      }
      await prisma.$transaction(async (tx) => {
        await claimPendingRequest(tx, id, { status: "approved", reviewedBy: request.principal!.accountId, reviewNote: input.note ?? null });
        const person = await tx.person.create({ data: {
          name: payload.name, phone: payload.phone, type: payload.type, status: "active", photoFileId: payload.photoFileId,
          nationalIdCipher: payload.nationalIdCipher, nationalIdIv: payload.nationalIdIv, nationalIdTag: payload.nationalIdTag,
          nationalIdHash: payload.nationalIdHash, nationalIdLast4: payload.nationalIdLast4,
          organizations: { create: [{ organizationId: project.responsibleOrganizationId, primary: true }, ...(payload.type === "contractor" ? [{ organizationId: (payload.contractorOrganizationId ?? payload.organizationId)!, primary: false }] : [])] },
          projectMemberships: { create: { projectId: change.projectId!, status: "active", reviewedBy: request.principal!.accountId, reviewedAt: new Date() } }
        } });
        await tx.account.update({ where: { id: change.accountId! }, data: { personId: person.id, status: "active" } });
        await activatePendingRoles(tx, { personId: person.id, accountId: change.accountId!, actorId: request.principal!.accountId });
        await tx.wechatBinding.updateMany({ where: { accountId: change.accountId!, active: true }, data: { boundAt: new Date() } });
        await tx.changeRequest.update({ where: { id }, data: { personId: person.id } });
        await writeCriticalAudit(tx, { actorId: request.principal!.accountId, action: "registration.approve", objectType: "change_request", objectId: id, requestId: id, reason: input.note ?? null, metadata: { personId: person.id, projectId: change.projectId } });
      }, { isolationLevel: "Serializable" });
    } else if (change.type === "binding") {
      throw Object.assign(new Error("身份绑定申请请使用专用审核操作"), { statusCode: 409, code: "IDENTITY_REVIEW_REQUIRED" });
    } else {
      if (!personId || !await canAccessPerson(request.principal!, personId)) forbidden();
      const result = await prisma.$transaction(async (tx) => {
        const bound = await bindAccountToPerson(tx, { currentAccountId: change.accountId!, personId, reason: "管理员审批档案绑定" });
        if (bound.status === "pending_merge") return bound;
        await tx.wechatBinding.updateMany({ where: { accountId: bound.accountId, active: true }, data: { boundAt: new Date() } });
        await claimPendingRequest(tx, id, { status: "approved", reviewedBy: request.principal!.accountId, reviewNote: input.note ?? null });
        await tx.changeRequest.update({ where: { id }, data: { personId } });
        await writeCriticalAudit(tx, { actorId: request.principal!.accountId, action: "binding.approve", objectType: "change_request", objectId: id, requestId: id, reason: input.note ?? null, metadata: { targetAccountId: bound.accountId, personId } });
        return bound;
      }, { isolationLevel: "Serializable" });
      if (result.status === "pending_merge") return { data: { status: "account_merge_pending", requestId: result.requestId } };
    }
    return { data: { status: "approved" } };
  });
}
