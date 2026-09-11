import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { encryptNationalId, normalizePhone } from "../crypto.js";
import { issueSession } from "../auth.js";
import { audit } from "../audit.js";
import { canAccessPerson, canAccessProject, forbidden } from "../access.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

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

async function wechatPhone(code: string, env: Env): Promise<string> {
  if (env.NODE_ENV === "development" && code.startsWith("dev:")) return normalizePhone(code.slice(4));
  if (!env.WECHAT_APP_ID || !env.WECHAT_APP_SECRET) throw Object.assign(new Error("微信手机号能力尚未配置"), { statusCode: 503, code: "WECHAT_NOT_CONFIGURED" });
  const tokenUrl = new URL("https://api.weixin.qq.com/cgi-bin/token");
  tokenUrl.searchParams.set("grant_type", "client_credential"); tokenUrl.searchParams.set("appid", env.WECHAT_APP_ID); tokenUrl.searchParams.set("secret", env.WECHAT_APP_SECRET);
  const tokenResponse = await fetch(tokenUrl); const tokenBody = await tokenResponse.json() as { access_token?: string };
  if (!tokenBody.access_token) throw Object.assign(new Error("微信服务暂不可用"), { statusCode: 502, code: "WECHAT_TOKEN_FAILED" });
  const phoneResponse = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(tokenBody.access_token)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code })
  });
  const phoneBody = await phoneResponse.json() as { phone_info?: { purePhoneNumber?: string } };
  if (!phoneBody.phone_info?.purePhoneNumber) throw Object.assign(new Error("无法取得微信手机号"), { statusCode: 400, code: "WECHAT_PHONE_FAILED" });
  return normalizePhone(phoneBody.phone_info.purePhoneNumber);
}

async function bindPerson(currentAccountId: string, personId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.account.findUnique({ where: { personId } });
    const targetId = existing?.id ?? currentAccountId;
    if (existing && existing.id !== currentAccountId) {
      await tx.wechatBinding.updateMany({ where: { accountId: currentAccountId, active: true }, data: { accountId: existing.id, boundAt: new Date() } });
      await tx.account.delete({ where: { id: currentAccountId } });
    } else {
      await tx.account.update({ where: { id: currentAccountId }, data: { personId, status: "active" } });
      await tx.wechatBinding.updateMany({ where: { accountId: currentAccountId, active: true }, data: { boundAt: new Date() } });
    }
    await tx.roleAssignment.upsert({
      where: { accountId_role_scopeType_scopeId: { accountId: targetId, role: "learner", scopeType: "person", scopeId: personId } },
      create: { accountId: targetId, role: "learner", scopeType: "person", scopeId: personId }, update: { active: true }
    });
    return targetId;
  });
}

export async function registerWechatRoutes(app: FastifyInstance, deps: { env: Env; authenticate: Guard; requireManager: Guard }) {
  app.post("/api/wechat/login", async (request) => {
    const code = z.object({ code: z.string().min(1).max(200) }).parse(request.body).code;
    const wx = await wechatSession(code, deps.env);
    const appId = deps.env.WECHAT_APP_ID ?? "development";
    const binding = await prisma.wechatBinding.upsert({
      where: { appId_openid: { appId, openid: wx.openid } },
      create: { appId, openid: wx.openid, unionid: wx.unionid ?? null, account: { create: { status: "active" } } },
      update: { ...(wx.unionid ? { unionid: wx.unionid } : {}) }, include: { account: true }
    });
    const session = await issueSession(binding.accountId, deps.env);
    return { data: { ...session, bindingStatus: binding.account.personId ? "bound" : "unbound" } };
  });

  app.get("/api/wechat/registration-options", { preHandler: deps.authenticate }, async () => ({ data: {
    organizations: await prisma.organization.findMany({ where: { type: { in: ["department", "contractor"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    projects: await prisma.project.findMany({ where: { status: "active" }, select: { id: true, name: true }, orderBy: { name: "asc" } })
  } }));

  app.post("/api/wechat/bind-phone", { preHandler: deps.authenticate }, async (request) => {
    const accountId = request.principal!.accountId;
    const code = z.object({ code: z.string().min(1).max(200) }).parse(request.body).code;
    const phone = await wechatPhone(code, deps.env);
    if (!/^1\d{10}$/.test(phone)) throw Object.assign(new Error("手机号格式错误"), { statusCode: 400, code: "INVALID_PHONE" });
    const matches = await prisma.person.findMany({ where: { phone, status: "active" }, select: { id: true }, take: 2 });
    if (matches.length === 1) {
      const targetId = await bindPerson(accountId, matches[0]!.id);
      audit(targetId, "wechat.auto_bind", "person", matches[0]!.id);
      return { data: { status: "bound", ...(await issueSession(targetId, deps.env)) } };
    }
    const requestRow = await prisma.changeRequest.create({ data: { accountId, type: "binding", payload: { phone, matchCount: matches.length } } });
    return { data: { status: "pending_review", requestId: requestRow.id } };
  });

  app.post("/api/wechat/registration-requests", { preHandler: deps.authenticate }, async (request, reply) => {
    const input = z.object({
      name: z.string().trim().min(2).max(80), phone: z.string().regex(/^1\d{10}$/),
      type: z.enum(["contractor", "temporary_individual"]), organizationId: z.string().uuid(), projectId: z.string().uuid(),
      nationalId: z.string().trim().min(6).max(30), photoFileId: z.string().uuid()
    }).parse(request.body);
    const encrypted = encryptNationalId(input.nationalId, deps.env);
    const row = await prisma.changeRequest.create({ data: {
      accountId: request.principal!.accountId, projectId: input.projectId, type: "registration",
      payload: { name: input.name, phone: input.phone, type: input.type, organizationId: input.organizationId, photoFileId: input.photoFileId, ...encrypted }
    } });
    return reply.code(201).send({ data: { id: row.id, status: row.status } });
  });

  app.get("/api/binding-requests", { preHandler: [deps.authenticate, deps.requireManager] }, async (request) => {
    const projectIds = request.principal!.roles.filter((r) => r.role === "project_admin" && r.scopeId).map((r) => r.scopeId!);
    const companyOrOrg = request.principal!.roles.some((r) => r.role === "company_admin" || r.role === "org_admin");
    const rows = await prisma.changeRequest.findMany({ where: { status: "pending", type: { in: ["binding", "registration"] }, ...(companyOrOrg ? {} : { projectId: { in: projectIds } }) }, orderBy: { createdAt: "asc" } });
    return { data: rows.map(({ payload, ...row }) => {
      const value = payload as Record<string, unknown>;
      const phone = typeof value.phone === "string" ? `${value.phone.slice(0, 3)}****${value.phone.slice(-4)}` : undefined;
      return { ...row, payload: { ...(typeof value.name === "string" ? { name: value.name } : {}), ...(phone ? { phone } : {}), ...(typeof value.type === "string" ? { type: value.type } : {}), matchCount: value.matchCount } };
    }) };
  });

  app.post("/api/binding-requests/:id/approve", { preHandler: [deps.authenticate, deps.requireManager] }, async (request) => {
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const personId = z.object({ personId: z.string().uuid().optional() }).parse(request.body).personId;
    const change = await prisma.changeRequest.findUniqueOrThrow({ where: { id } });
    if (change.projectId && !await canAccessProject(request.principal!, change.projectId)) forbidden();
    if (!change.accountId || change.status !== "pending") throw Object.assign(new Error("申请状态不可审批"), { statusCode: 409, code: "REQUEST_NOT_PENDING" });
    let targetId: string;
    let approvedPersonId: string;
    if (change.type === "registration") {
      if (!change.projectId) throw Object.assign(new Error("注册申请缺少项目"), { statusCode: 409, code: "INVALID_REGISTRATION" });
      const payload = z.object({
        name: z.string().min(2), phone: z.string().regex(/^1\d{10}$/), type: z.enum(["contractor", "temporary_individual"]),
        organizationId: z.string().uuid(), photoFileId: z.string().uuid(), nationalIdCipher: z.string().min(1), nationalIdIv: z.string().min(1),
        nationalIdTag: z.string().min(1), nationalIdHash: z.string().length(64), nationalIdLast4: z.string().length(4)
      }).parse(change.payload);
      const [duplicate, organization, photo, project] = await Promise.all([
        prisma.person.findFirst({ where: { phone: payload.phone, status: "active" }, select: { id: true } }),
        prisma.organization.findUnique({ where: { id: payload.organizationId }, select: { type: true } }),
        prisma.privateFile.findUnique({ where: { id: payload.photoFileId }, select: { kind: true } }),
        prisma.project.findUnique({ where: { id: change.projectId }, select: { status: true } })
      ]);
      if (duplicate) throw Object.assign(new Error("手机号已有在用档案，请改为绑定申请"), { statusCode: 409, code: "PHONE_EXISTS" });
      if (!organization || !["department", "contractor"].includes(organization.type) || photo?.kind !== "photo" || project?.status !== "active") {
        throw Object.assign(new Error("申请的组织、照片或项目已不可用"), { statusCode: 409, code: "REGISTRATION_CONTEXT_INVALID" });
      }
      const result = await prisma.$transaction(async (tx) => {
        const person = await tx.person.create({ data: {
          name: payload.name, phone: payload.phone, type: payload.type, status: "active", photoFileId: payload.photoFileId,
          nationalIdCipher: payload.nationalIdCipher, nationalIdIv: payload.nationalIdIv, nationalIdTag: payload.nationalIdTag,
          nationalIdHash: payload.nationalIdHash, nationalIdLast4: payload.nationalIdLast4,
          organizations: { create: { organizationId: payload.organizationId, primary: true } },
          projectMemberships: { create: { projectId: change.projectId!, status: "active", reviewedBy: request.principal!.accountId, reviewedAt: new Date() } }
        } });
        await tx.account.update({ where: { id: change.accountId! }, data: { personId: person.id, status: "active" } });
        await tx.wechatBinding.updateMany({ where: { accountId: change.accountId!, active: true }, data: { boundAt: new Date() } });
        await tx.roleAssignment.create({ data: { accountId: change.accountId!, role: "learner", scopeType: "person", scopeId: person.id } });
        await tx.changeRequest.update({ where: { id }, data: { personId: person.id, status: "approved", reviewedBy: request.principal!.accountId, reviewedAt: new Date() } });
        return { accountId: change.accountId!, personId: person.id };
      });
      targetId = result.accountId; approvedPersonId = result.personId;
    } else {
      if (!personId || !await canAccessPerson(request.principal!, personId)) forbidden();
      targetId = await bindPerson(change.accountId, personId); approvedPersonId = personId;
      await prisma.changeRequest.update({ where: { id }, data: { personId, status: "approved", reviewedBy: request.principal!.accountId, reviewedAt: new Date() } });
    }
    audit(request.principal!.accountId, "binding.approve", "change_request", id, { targetAccountId: targetId, personId: approvedPersonId });
    return { data: { status: "approved" } };
  });
}
