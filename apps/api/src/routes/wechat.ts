import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { encryptNationalId, normalizePhone } from "../crypto.js";
import { issueSession } from "../auth.js";
import { audit } from "../audit.js";
import { accessibleOrganizationIds, canAccessOrganization, canAccessPerson, canAccessProject, forbidden, isCompanyAdmin, projectScopeIds } from "../access.js";
import { bindAccountToPerson, grantRole } from "../identity.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

const requestContentKey = (row: { accountId: string | null; personId: string | null; projectId: string | null; type: string; payload: Prisma.JsonValue }) => {
  const payload = row.payload as Record<string, unknown>;
  return [row.accountId, row.personId, row.projectId, row.type, payload.name, payload.phone, payload.type, payload.organizationId, payload.contractorOrganizationId, payload.responsibleOrganizationId, payload.targetAccountId, payload.reason].map((value) => String(value ?? "")).join("|");
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
    const result = await bindAccountToPerson(tx, { currentAccountId, personId, reason: "微信身份绑定已有人员账号" });
    if (result.status === "bound") await tx.wechatBinding.updateMany({ where: { accountId: result.accountId, active: true }, data: { boundAt: new Date() } });
    return result;
  });
}

async function pendingBindingRequest(accountId: string, phone: string, matchCount: number) {
  const existing = await prisma.changeRequest.findFirst({ where: { accountId, type: "binding", status: "pending", payload: { path: ["phone"], equals: phone } }, orderBy: { createdAt: "desc" } });
  if (existing) return existing;
  try {
    return await prisma.changeRequest.create({ data: { accountId, type: "binding", payload: { phone, matchCount } } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    return prisma.changeRequest.findFirstOrThrow({ where: { accountId, type: "binding", status: "pending", payload: { path: ["phone"], equals: phone } }, orderBy: { createdAt: "desc" } });
  }
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
    const binding = await prisma.wechatBinding.upsert({
      where: { appId_openid: { appId, openid: wx.openid } },
      create: { appId, openid: wx.openid, unionid: wx.unionid ?? null, account: { create: { status: "active" } } },
      update: { ...(wx.unionid ? { unionid: wx.unionid } : {}) }, include: { account: true }
    });
    if (!binding.active) throw Object.assign(new Error("原微信绑定已撤销，请使用新微信重新绑定"), { statusCode: 403, code: "WECHAT_BINDING_REVOKED" });
    const session = await issueSession(binding.accountId, deps.env);
    return { data: { ...session, bindingStatus: binding.account.personId ? "bound" : "unbound" } };
  });

  app.get("/api/wechat/registration-options", { preHandler: deps.authenticate }, async () => ({ data: {
    organizations: await prisma.organization.findMany({ where: { type: "contractor" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    businessEntities: await prisma.organization.findMany({ where: { type: "business_entity" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    departments: await prisma.organization.findMany({ where: { type: { in: ["business_entity", "department"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    projects: await prisma.project.findMany({ where: { status: "active", responsibleOrganization: { type: "business_entity" } }, select: { id: true, name: true, responsibleOrganizationId: true, responsibleOrganization: { select: { name: true } } }, orderBy: { name: "asc" } })
  } }));

  app.post("/api/wechat/bind-phone", { preHandler: deps.authenticate }, async (request) => {
    const accountId = request.principal!.accountId;
    const code = z.object({ code: z.string().min(1).max(200) }).parse(request.body).code;
    const phone = await wechatPhone(code, deps.env);
    if (!/^1\d{10}$/.test(phone)) throw Object.assign(new Error("手机号格式错误"), { statusCode: 400, code: "INVALID_PHONE" });
    const matches = await prisma.person.findMany({ where: { phone, status: "active" }, select: { id: true }, take: 2 });
    if (matches.length === 1) {
      const result = await bindPerson(accountId, matches[0]!.id);
      if (result.status === "pending_merge") return { data: { status: "pending_review", requestId: result.requestId, ...(await issueSession(accountId, deps.env)) } };
      audit(result.accountId, "wechat.auto_bind", "person", matches[0]!.id);
      return { data: { status: "bound", ...(await issueSession(result.accountId, deps.env)) } };
    }
    const requestRow = await pendingBindingRequest(accountId, phone, matches.length);
    return { data: { status: "pending_review", requestId: requestRow.id } };
  });

  app.put("/api/wechat/binding-requests/:id/profile", { preHandler: deps.authenticate }, async (request) => {
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const input = z.object({ name: z.string().trim().min(2).max(80), organizationId: z.string().uuid(), reason: z.string().trim().min(2).max(500) }).parse(request.body);
    const [row, organization] = await Promise.all([
      prisma.changeRequest.findFirst({ where: { id, accountId: request.principal!.accountId, type: "binding", status: "pending" } }),
      prisma.organization.findFirst({ where: { id: input.organizationId, type: { in: ["business_entity", "department"] } }, select: { id: true } })
    ]);
    if (!row) forbidden("只能补充本人当前待审核的绑定申请");
    if (!organization) throw Object.assign(new Error("所选部门不存在或不可申请"), { statusCode: 400, code: "INVALID_ORGANIZATION" });
    const payload = row.payload as Record<string, unknown>;
    await prisma.changeRequest.update({ where: { id }, data: { payload: { ...payload, name: input.name, organizationId: input.organizationId, reason: input.reason } } });
    audit(request.principal!.accountId, "binding.profile_submitted", "change_request", id, { organizationId: input.organizationId });
    return { data: { id, status: "pending" } };
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
    const existing = (await prisma.changeRequest.findMany({ where: { accountId, projectId: input.projectId, type: "registration", status: "pending" }, orderBy: { createdAt: "desc" } })).find((row) => {
      const payload = row.payload as Record<string, unknown>;
      return payload.name === input.name && payload.phone === input.phone && payload.type === input.type && payload.contractorOrganizationId === input.organizationId && payload.responsibleOrganizationId === project.responsibleOrganizationId;
    });
    if (existing) return { data: { id: existing.id, status: existing.status } };
    const encrypted = encryptNationalId(input.nationalId, deps.env);
    const row = await prisma.changeRequest.create({ data: {
      accountId, projectId: input.projectId, type: "registration",
      payload: { name: input.name, phone: input.phone, type: input.type, contractorOrganizationId: input.type === "contractor" ? input.organizationId : null, responsibleOrganizationId: project.responsibleOrganizationId, photoFileId: input.photoFileId, ...encrypted }
    } });
    return reply.code(201).send({ data: { id: row.id, status: row.status } });
  });

  app.get("/api/binding-requests", { preHandler: [deps.authenticate, deps.requireManager] }, async (request) => {
    const principal = request.principal!; const orgIds = new Set(await accessibleOrganizationIds(principal)); const projectIds = new Set(projectScopeIds(principal));
    const candidates = await prisma.changeRequest.findMany({ where: { status: "pending", type: { in: isCompanyAdmin(principal) ? ["binding", "registration", "account_merge"] : ["binding", "registration"] } }, orderBy: { createdAt: "desc" } });
    const seen = new Set<string>(); const uniqueCandidates = candidates.filter((row) => { const key = requestContentKey(row); if (seen.has(key)) return false; seen.add(key); return true; });
    const rows = isCompanyAdmin(principal) ? uniqueCandidates : uniqueCandidates.filter((row) => (row.projectId && projectIds.has(row.projectId)) || orgIds.has(String((row.payload as Record<string, unknown>).organizationId ?? "")));
    const organizationIds = [...new Set(rows.flatMap((row) => { const payload = row.payload as Record<string, unknown>; return [payload.responsibleOrganizationId, payload.organizationId, payload.contractorOrganizationId].map((value) => String(value ?? "")).filter(Boolean); }))];
    const organizationNames = new Map((await prisma.organization.findMany({ where: { id: { in: organizationIds } }, select: { id: true, name: true } })).map((row) => [row.id, row.name]));
    return { data: rows.map(({ payload, ...row }) => {
      const value = payload as Record<string, unknown>;
      const phone = typeof value.phone === "string" ? `${value.phone.slice(0, 3)}****${value.phone.slice(-4)}` : undefined;
      const organizationId = typeof value.responsibleOrganizationId === "string" ? value.responsibleOrganizationId : typeof value.organizationId === "string" ? value.organizationId : undefined;
      return { ...row, payload: { ...(typeof value.name === "string" ? { name: value.name } : {}), ...(phone ? { phone } : {}), ...(typeof value.type === "string" ? { type: value.type } : {}), ...(typeof value.reason === "string" ? { reason: value.reason } : {}), ...(organizationId ? { organizationId, organizationName: organizationNames.get(organizationId) } : {}), matchCount: value.matchCount } };
    }) };
  });

  app.post("/api/binding-requests/:id/approve", { preHandler: [deps.authenticate, deps.requireManager] }, async (request) => {
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const input = z.object({ personId: z.string().uuid().optional(), note: z.string().trim().max(500).optional() }).parse(request.body); const personId = input.personId;
    const change = await prisma.changeRequest.findUniqueOrThrow({ where: { id } });
    if (change.projectId && !await canAccessProject(request.principal!, change.projectId)) forbidden();
    if (!change.accountId || change.status !== "pending") throw Object.assign(new Error("申请状态不可审批"), { statusCode: 409, code: "REQUEST_NOT_PENDING" });
    let targetId: string;
    let approvedPersonId: string;
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
        prisma.privateFile.findUnique({ where: { id: payload.photoFileId }, select: { kind: true } }),
        prisma.project.findUnique({ where: { id: change.projectId }, select: { status: true, responsibleOrganizationId: true, responsibleOrganization: { select: { type: true } } } })
      ]);
      if (duplicate) throw Object.assign(new Error("手机号已有在用档案，请改为绑定申请"), { statusCode: 409, code: "PHONE_EXISTS" });
      if (!project || project.status !== "active" || project.responsibleOrganization.type !== "business_entity" || (payload.responsibleOrganizationId && payload.responsibleOrganizationId !== project.responsibleOrganizationId) || (payload.type === "contractor" && contractorOrganization?.type !== "contractor") || photo?.kind !== "photo") {
        throw Object.assign(new Error("申请的组织、照片或项目已不可用"), { statusCode: 409, code: "REGISTRATION_CONTEXT_INVALID" });
      }
      const result = await prisma.$transaction(async (tx) => {
        const person = await tx.person.create({ data: {
          name: payload.name, phone: payload.phone, type: payload.type, status: "active", photoFileId: payload.photoFileId,
          nationalIdCipher: payload.nationalIdCipher, nationalIdIv: payload.nationalIdIv, nationalIdTag: payload.nationalIdTag,
          nationalIdHash: payload.nationalIdHash, nationalIdLast4: payload.nationalIdLast4,
          organizations: { create: [{ organizationId: project.responsibleOrganizationId, primary: true }, ...(payload.type === "contractor" ? [{ organizationId: (payload.contractorOrganizationId ?? payload.organizationId)!, primary: false }] : [])] },
          projectMemberships: { create: { projectId: change.projectId!, status: "active", reviewedBy: request.principal!.accountId, reviewedAt: new Date() } }
        } });
        await tx.account.update({ where: { id: change.accountId! }, data: { personId: person.id, status: "active" } });
        await tx.wechatBinding.updateMany({ where: { accountId: change.accountId!, active: true }, data: { boundAt: new Date() } });
        await grantRole(tx, { accountId: change.accountId!, role: "learner", scopeType: "person", scopeId: person.id });
        await tx.changeRequest.update({ where: { id }, data: { personId: person.id, status: "approved", reviewedBy: request.principal!.accountId, reviewedAt: new Date(), reviewNote: input.note ?? null } });
        return { accountId: change.accountId!, personId: person.id };
      });
      targetId = result.accountId; approvedPersonId = result.personId;
    } else {
      if (!personId || !await canAccessPerson(request.principal!, personId)) forbidden();
      const result = await bindPerson(change.accountId, personId);
      if (result.status === "pending_merge") return { data: { status: "account_merge_pending", requestId: result.requestId } };
      targetId = result.accountId; approvedPersonId = personId;
      await prisma.changeRequest.update({ where: { id }, data: { personId, status: "approved", reviewedBy: request.principal!.accountId, reviewedAt: new Date(), reviewNote: input.note ?? null } });
    }
    audit(request.principal!.accountId, "binding.approve", "change_request", id, { targetAccountId: targetId, personId: approvedPersonId });
    return { data: { status: "approved" } };
  });
}
