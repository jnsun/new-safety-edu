import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import argon2 from "argon2";
import { z } from "zod";
import {
  loginSchema, organizationCreateSchema, personCreateSchema, projectCreateSchema, roleAssignmentCreateSchema
} from "@safety/contracts";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { audit, auditCritical } from "../audit.js";
import { accessibleOrganizationIds, canAccessOrganization, canAccessPerson, canAccessProject, forbidden, isCompanyAdmin, organizationScopeIds, projectScopeIds } from "../access.js";
import { decryptNationalId, encryptNationalId, hashNationalId, normalizePhone } from "../crypto.js";
import { maskPhone, nationalIdError } from "../person-import-core.js";
import { createPerson, maskPerson, personSafeSelect } from "../people.js";
import { issueSensitiveToken, issueSession, rotateRefreshToken, verifySensitiveToken, type Principal } from "../auth.js";
import { autoDispatch } from "./day2.js";
import { activatePendingRoles, assertAccountMergeCandidate, canGrantScopedRole, canJoinProject, canManagePersonStatus, disablePerson, grantRole, reactivatePerson, requestAccountMerge, revokeRole, setPrimaryOrganization } from "../identity.js";
import { accountDeletionBlockers, assertAccountStatusChange, normalizeUsername } from "../account-lifecycle.js";
import { accountStatusAfterLoginMethodChange, assertLoginMethodCanBeRemoved } from "../session-login-policy.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
type Deps = { env: Env; authenticate: Guard; requireManager: Guard };

const principalOf = (request: FastifyRequest): Principal => {
  if (!request.principal) throw Object.assign(new Error("未登录"), { statusCode: 401, code: "UNAUTHORIZED" });
  return request.principal;
};

const idParam = z.object({ id: z.string().uuid() });

async function personWhere(principal: Principal): Promise<Prisma.PersonWhereInput> {
  if (isCompanyAdmin(principal)) return {};
  const orgIds = await accessibleOrganizationIds(principal);
  const projectIds = projectScopeIds(principal);
  return { OR: [
    ...(principal.personId ? [{ id: principal.personId }] : []),
    ...(orgIds.length ? [{ organizations: { some: { active: true, organizationId: { in: orgIds } } } }] : []),
    ...(projectIds.length ? [{ projectMemberships: { some: { status: "active" as const, projectId: { in: projectIds } } } }] : [])
  ] };
}

export async function registerDay1Routes(app: FastifyInstance, deps: Deps) {
  const manager = { preHandler: [deps.authenticate, deps.requireManager] };
  const authenticated = { preHandler: deps.authenticate };

  app.post("/api/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    let usernameNormalized: string;
    try { usernameNormalized = normalizeUsername(input.username); } catch { throw Object.assign(new Error("用户名或密码错误"), { statusCode: 401, code: "INVALID_CREDENTIALS" }); }
    const account = await prisma.account.findUnique({ where: { usernameNormalized } });
    if (!account?.passwordHash || !account.passwordLoginEnabled || account.status !== "active" || !await argon2.verify(account.passwordHash, input.password)) {
      throw Object.assign(new Error("用户名或密码错误"), { statusCode: 401, code: "INVALID_CREDENTIALS" });
    }
    await prisma.account.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
    const session = await issueSession(account.id, deps.env, { clientKind: "web", userAgent: request.headers["user-agent"] });
    reply.setCookie("safety_session", session.accessToken, { httpOnly: true, sameSite: "strict", secure: deps.env.NODE_ENV === "production", path: "/", maxAge: 900 });
    reply.setCookie("safety_refresh", session.refreshToken, { httpOnly: true, sameSite: "strict", secure: deps.env.NODE_ENV === "production", path: "/api/auth", maxAge: 30 * 86400 });
    audit(account.id, "auth.login", "account", account.id);
    return { data: { accountId: account.id } };
  });

  app.post("/api/auth/logout", authenticated, async (request, reply) => {
    const principal = principalOf(request);
    if (principal.sessionId) await prisma.refreshSession.updateMany({ where: { id: principal.sessionId, accountId: principal.accountId, revokedAt: null }, data: { revokedAt: new Date() } });
    else await prisma.$transaction([
      prisma.account.update({ where: { id: principal.accountId }, data: { sessionVersion: { increment: 1 } } }),
      prisma.refreshSession.updateMany({ where: { accountId: principal.accountId, revokedAt: null }, data: { revokedAt: new Date() } })
    ]);
    reply.clearCookie("safety_session", { path: "/" });
    reply.clearCookie("safety_refresh", { path: "/api/auth" });
    audit(principal.accountId, "auth.logout", "account", principal.accountId);
    return reply.code(204).send();
  });

  app.post("/api/auth/change-password", authenticated, async (request, reply) => {
    const principal = principalOf(request); const input = z.object({ currentPassword: z.string().min(8).max(200), newPassword: z.string().min(12).max(200) }).refine((value) => value.currentPassword !== value.newPassword, { message: "新密码不能与当前密码相同", path: ["newPassword"] }).parse(request.body);
    const account = await prisma.account.findUniqueOrThrow({ where: { id: principal.accountId } }); if (!account.passwordHash || !await argon2.verify(account.passwordHash, input.currentPassword)) throw Object.assign(new Error("当前密码错误"), { statusCode: 401, code: "INVALID_CURRENT_PASSWORD" });
    const passwordHash = await argon2.hash(input.newPassword);
    await prisma.$transaction(async (tx) => {
      await tx.account.update({ where: { id: principal.accountId }, data: { passwordHash, passwordLoginEnabled: true, mustChangePassword: false, sessionVersion: { increment: 1 } } });
      await tx.refreshSession.updateMany({ where: { accountId: principal.accountId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "account.password_change", objectType: "account", objectId: principal.accountId, result: "success" } });
    });
    reply.clearCookie("safety_session", { path: "/" }); return reply.code(204).send();
  });

  app.post("/api/auth/logout-all", authenticated, async (request, reply) => {
    const principal = principalOf(request);
    await prisma.$transaction(async (tx) => {
      await tx.account.update({ where: { id: principal.accountId }, data: { sessionVersion: { increment: 1 } } });
      await tx.refreshSession.updateMany({ where: { accountId: principal.accountId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "auth.logout_all", objectType: "account", objectId: principal.accountId, result: "success" } });
    });
    reply.clearCookie("safety_session", { path: "/" });
    reply.clearCookie("safety_refresh", { path: "/api/auth" });
    return reply.code(204).send();
  });

  app.post("/api/auth/reauthenticate", authenticated, async (request) => {
    const principal = principalOf(request); const { password } = z.object({ password: z.string().min(8).max(200) }).parse(request.body);
    const account = await prisma.account.findUniqueOrThrow({ where: { id: principal.accountId } });
    if (!account.passwordHash) throw Object.assign(new Error("当前账号未配置密码，暂不能查看完整敏感信息"), { statusCode: 409, code: "REAUTH_METHOD_UNAVAILABLE" });
    if (!await argon2.verify(account.passwordHash, password)) throw Object.assign(new Error("当前密码错误"), { statusCode: 401, code: "INVALID_CURRENT_PASSWORD" });
    await auditCritical(principal.accountId, "account.sensitive_reauthenticate", "account", principal.accountId, undefined, "var/audit-fallback.ndjson");
    return { data: { token: await issueSensitiveToken(principal.accountId, deps.env), expiresIn: 300 } };
  });

  app.get("/api/auth/security", authenticated, async (request) => {
    const principal = principalOf(request);
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: principal.accountId },
      select: {
        username: true, passwordLoginEnabled: true, verifiedPhone: true,
        wechatBindings: { where: { active: true }, select: { id: true, boundAt: true } },
        refreshSessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, clientKind: true, lastUsedAt: true, createdAt: true }, orderBy: { createdAt: "desc" } }
      }
    });
    const roleRows = await prisma.roleAssignment.findMany({ where: principal.personId ? { personId: principal.personId, active: true } : { accountId: principal.accountId, personId: null, active: true }, select: { id: true, role: true, scopeType: true, scopeId: true, createdAt: true } });
    const organizationIds = roleRows.filter((role) => role.scopeType === "organization" && role.scopeId).map((role) => role.scopeId!);
    const projectIds = roleRows.filter((role) => role.scopeType === "project" && role.scopeId).map((role) => role.scopeId!);
    const [organizations, projects] = await Promise.all([
      prisma.organization.findMany({ where: { id: { in: organizationIds } }, select: { id: true, name: true } }),
      prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })
    ]);
    const scopeNames = new Map([...organizations, ...projects].map((item) => [item.id, item.name]));
    return { data: {
      username: account.username,
      loginMethods: { password: account.passwordLoginEnabled, phone: Boolean(account.verifiedPhone), wechat: account.wechatBindings.length > 0 },
      verifiedPhoneMasked: account.verifiedPhone ? maskPhone(account.verifiedPhone) : null,
      sessions: account.refreshSessions.map((session) => ({ ...session, current: session.id === principal.sessionId })),
      roles: roleRows.filter((role) => role.role !== "learner").map((role) => ({ id: role.id, role: role.role, scopeType: role.scopeType, scopeId: role.scopeId, scopeName: role.scopeId ? scopeNames.get(role.scopeId) ?? null : "全公司", grantedAt: role.createdAt }))
    } };
  });

  app.get("/api/auth/me", authenticated, async (request) => ({ data: principalOf(request) }));
  app.post("/api/auth/refresh", async (request, reply) => {
    const body = z.object({ refreshToken: z.string().min(20).optional() }).parse(request.body ?? {});
    const fromCookie = !body.refreshToken && request.cookies.safety_refresh;
    const refreshToken = body.refreshToken ?? request.cookies.safety_refresh;
    if (!refreshToken) throw Object.assign(new Error("刷新会话已失效"), { statusCode: 401, code: "UNAUTHORIZED" });
    const session = await rotateRefreshToken(refreshToken, deps.env);
    if (fromCookie) {
      reply.setCookie("safety_session", session.accessToken, { httpOnly: true, sameSite: "strict", secure: deps.env.NODE_ENV === "production", path: "/", maxAge: 900 });
      reply.setCookie("safety_refresh", session.refreshToken, { httpOnly: true, sameSite: "strict", secure: deps.env.NODE_ENV === "production", path: "/api/auth", maxAge: 30 * 86400 });
    }
    return { data: session };
  });

  app.get("/api/organizations", manager, async (request) => {
    const principal = principalOf(request);
    const organizations = await prisma.organization.findMany({
      where: isCompanyAdmin(principal) ? {} : { id: { in: await accessibleOrganizationIds(principal) } },
      include: { _count: { select: { memberships: { where: { active: true } } } } },
      orderBy: { name: "asc" }
    });
    const roles = await prisma.roleAssignment.findMany({
      where: { OR: [{ active: true }, { activationPending: true }], scopeType: "organization", scopeId: { in: organizations.map(({ id }) => id) }, role: { in: ["org_leader", "org_admin", "field_reporter"] } },
      include: { person: { select: { id: true, name: true } } }
    });
    return { data: organizations.map(({ _count, ...organization }) => {
      const scoped = roles.filter((role) => role.scopeId === organization.id && role.person);
      const people = (role: "org_leader" | "org_admin") => scoped.filter((item) => item.role === role).map((item) => ({ roleId: item.id, personId: item.person!.id, name: item.person!.name, activationPending: item.activationPending }));
      const leaders = people("org_leader"); const admins = people("org_admin");
      const reporters = new Map(scoped.filter((item) => item.role === "field_reporter").map((item) => [item.person!.id, { roleId: item.id as string | null, personId: item.person!.id, name: item.person!.name, inherited: false, activationPending: item.activationPending }]));
      return { ...organization, memberCount: _count.memberships, leaders, admins, reporters: [...reporters.values()] };
    }) };
  });

  app.post("/api/organizations", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = organizationCreateSchema.parse(request.body);
    if (!isCompanyAdmin(principal)) forbidden("只有公司管理员可以创建组织");
    const company = await prisma.organization.findFirst({ where: { type: "company" }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (input.type === "company" && company) throw Object.assign(new Error("系统只能有一个公司根组织"), { statusCode: 409, code: "COMPANY_ROOT_EXISTS" });
    if (input.type !== "company" && !company) throw Object.assign(new Error("请先创建公司根组织"), { statusCode: 409, code: "COMPANY_ROOT_REQUIRED" });
    const parentId = input.type === "company" ? null : company!.id;
    if (input.parentId && input.parentId !== parentId) throw Object.assign(new Error("当前版本组织只能直接隶属公司"), { statusCode: 409, code: "INVALID_ORGANIZATION_PARENT" });
    const organization = await prisma.organization.create({ data: { name: input.name, type: input.type, ...(parentId ? { parent: { connect: { id: parentId } } } : {}) } });
    audit(principal.accountId, "organization.create", "organization", organization.id);
    return reply.code(201).send({ data: organization });
  });

  app.patch("/api/organizations/:id", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    if (!isCompanyAdmin(principal)) forbidden("只有公司管理员可以修改组织主档");
    const input = organizationCreateSchema.partial().refine((value) => Object.keys(value).length > 0, "至少填写一项").parse(request.body);
    const current = await prisma.organization.findUniqueOrThrow({ where: { id } });
    if (input.parentId !== undefined) throw Object.assign(new Error("当前版本不允许调整组织层级"), { statusCode: 409, code: "ORGANIZATION_PARENT_IMMUTABLE" });
    if (input.type && input.type !== current.type) throw Object.assign(new Error("组织类型建立后不能直接修改"), { statusCode: 409, code: "ORGANIZATION_TYPE_IMMUTABLE" });
    if (current.type === "company" && (input.type && input.type !== "company" || input.parentId)) throw Object.assign(new Error("公司根组织不能更改类型或设置上级"), { statusCode: 409, code: "COMPANY_ROOT_IMMUTABLE" });
    const organization = await prisma.organization.update({ where: { id }, data: { ...(input.name ? { name: input.name } : {}) } });
    await auditCritical(principal.accountId, "organization.update", "organization", id, { fields: Object.keys(input) }, "var/audit-fallback.ndjson");
    return { data: organization };
  });

  app.delete("/api/organizations/:id", manager, async (request, reply) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    if (!isCompanyAdmin(principal)) forbidden("只有公司管理员可以删除未使用的组织");
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id }, include: { _count: { select: { children: true, memberships: true, projects: true } } } });
    const scopedReferences = await Promise.all([
      prisma.roleAssignment.count({ where: { scopeType: "organization", scopeId: id } }),
      prisma.courseware.count({ where: { scopeType: "organization", scopeId: id } }),
      prisma.trainingTemplate.count({ where: { scopeType: "organization", scopeId: id } }),
      prisma.questionBank.count({ where: { scopeType: "organization", scopeId: id } })
    ]);
    if (organization.type === "company" || organization._count.children + organization._count.memberships + organization._count.projects + scopedReferences.reduce((sum, count) => sum + count, 0) > 0) {
      throw Object.assign(new Error("该组织已被人员、下级组织、项目、权限或培训资料使用，不能删除"), { statusCode: 409, code: "ORGANIZATION_IN_USE" });
    }
    await prisma.organization.delete({ where: { id } });
    await auditCritical(principal.accountId, "organization.delete", "organization", id, { name: organization.name }, "var/audit-fallback.ndjson");
    return reply.code(204).send();
  });

  app.post("/api/organizations/:id/roles", manager, async (request, reply) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    const input = z.object({ personId: z.string().uuid(), role: z.enum(["org_leader", "org_admin", "field_reporter"]), reason: z.string().trim().min(2).max(500) }).parse(request.body);
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id }, select: { type: true } });
    if (!["department", "business_entity"].includes(organization.type)) throw Object.assign(new Error("该权限只能设置在部门或经营实体"), { statusCode: 409, code: "INVALID_ORGANIZATION_ROLE_SCOPE" });
    if (!canGrantScopedRole(principal, { role: input.role, scopeType: "organization", scopeId: id, organizationType: organization.type })) forbidden("无权授予该组织角色");
    if (input.role === "field_reporter" && organization.type !== "business_entity") throw Object.assign(new Error("只有经营实体可以设置野外项目报送人员"), { statusCode: 409, code: "REPORTER_REQUIRES_BUSINESS_ENTITY" });
    const person = await prisma.person.findFirst({ where: { id: input.personId, status: "active", organizations: { some: { organizationId: id, active: true } } }, select: { id: true } });
    if (!person) throw Object.assign(new Error("只能设置该部门的在职人员"), { statusCode: 409, code: "PERSON_NOT_IN_ORGANIZATION" });
    const role = await prisma.$transaction(async (tx) => {
      const created = await grantRole(tx, { personId: input.personId, role: input.role, scopeType: "organization", scopeId: id, actorId: principal.accountId, reason: input.reason });
      if (created.accountId) {
        await tx.account.update({ where: { id: created.accountId }, data: { sessionVersion: { increment: 1 } } });
        await tx.refreshSession.updateMany({ where: { accountId: created.accountId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "organization.role_grant", objectType: "role_assignment", objectId: created.id, result: "success", metadata: { organizationId: id, personId: input.personId, role: input.role, reason: input.reason, activationPending: created.activationPending } } });
      return created;
    });
    return reply.code(201).send({ data: role });
  });

  app.delete("/api/organizations/:id/roles/:roleId", manager, async (request, reply) => {
    const principal = principalOf(request); const input = z.object({ id: z.string().uuid(), roleId: z.string().uuid() }).parse(request.params);
    const role = await prisma.roleAssignment.findUniqueOrThrow({ where: { id: input.roleId } });
    if (role.scopeType !== "organization" || role.scopeId !== input.id || !["org_leader", "org_admin", "field_reporter"].includes(role.role)) forbidden();
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: input.id }, select: { type: true } });
    if (!canGrantScopedRole(principal, { role: role.role, scopeType: "organization", scopeId: input.id, organizationType: organization.type })) forbidden("无权取消该组织角色");
    const { reason } = z.object({ reason: z.string().trim().min(2).max(500) }).parse(request.body);
    await prisma.$transaction(async (tx) => {
      await revokeRole(tx, { roleId: role.id, actorId: principal.accountId, reason });
      if (role.accountId) {
        await tx.account.update({ where: { id: role.accountId }, data: { sessionVersion: { increment: 1 } } });
        await tx.refreshSession.updateMany({ where: { accountId: role.accountId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "organization.role_revoke", objectType: "role_assignment", objectId: role.id, result: "success", metadata: { organizationId: input.id, role: role.role, reason } } });
    });
    return reply.code(204).send();
  });

  app.get("/api/projects", manager, async (request) => {
    const principal = principalOf(request);
    const orgIds = await accessibleOrganizationIds(principal);
    const scopedProjectIds = projectScopeIds(principal);
    return { data: await prisma.project.findMany({
      where: isCompanyAdmin(principal) ? {} : { OR: [{ id: { in: scopedProjectIds } }, { responsibleOrganizationId: { in: orgIds } }] },
      include: { responsibleOrganization: { select: { id: true, name: true } }, _count: { select: { members: true } } },
      orderBy: { createdAt: "desc" }
    }) };
  });

  app.post("/api/projects", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = projectCreateSchema.parse(request.body);
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: input.responsibleOrganizationId }, select: { type: true } });
    if (organization.type !== "business_entity") throw Object.assign(new Error("只有经营实体可以创建并负责项目"), { statusCode: 409, code: "PROJECT_REQUIRES_BUSINESS_ENTITY" });
    if (!isCompanyAdmin(principal) && !organizationScopeIds(principal).includes(input.responsibleOrganizationId)) forbidden("只能为本人管理的经营实体创建项目");
    const project = await prisma.project.create({ data: { name: input.name, code: input.code, responsibleOrganizationId: input.responsibleOrganizationId, projectType: input.projectType ?? null, location: input.location ?? null, contractAmount: input.contractAmount ?? null, plannedStartAt: input.plannedStartAt ? new Date(`${input.plannedStartAt}T00:00:00.000Z`) : null, plannedEndAt: input.plannedEndAt ? new Date(`${input.plannedEndAt}T00:00:00.000Z`) : null, managerName: input.managerName ?? null, managerPhone: input.managerPhone ?? null } });
    audit(principal.accountId, "project.create", "project", project.id);
    return reply.code(201).send({ data: project });
  });

  app.patch("/api/projects/:id/status", manager, async (request) => {
    const principal = principalOf(request);
    const { id } = idParam.parse(request.params);
    const current = await prisma.project.findUniqueOrThrow({ where: { id } });
    if (!isCompanyAdmin(principal) && !organizationScopeIds(principal).includes(current.responsibleOrganizationId)) {
      forbidden("只有公司管理员或项目责任经营实体负责人、管理员可以调整项目状态");
    }
    const status = z.object({ status: z.enum(["active", "paused", "ended"]) }).parse(request.body).status;
    if (current.status === "ended") throw Object.assign(new Error("已结束项目为只读"), { statusCode: 409, code: "PROJECT_ENDED" });
    const project = await prisma.project.update({ where: { id }, data: { status } });
    await auditCritical(principal.accountId, "project.status_change", "project", id, { from: current.status, to: status }, "var/audit-fallback.ndjson");
    return { data: project };
  });

  app.get("/api/persons", authenticated, async (request) => ({ data: (await prisma.person.findMany({ where: await personWhere(principalOf(request)), select: personSafeSelect, orderBy: { createdAt: "desc" } })).map(maskPerson) }));

  app.post("/api/persons", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = personCreateSchema.parse(request.body);
    const person = await createPerson(input, principal, deps.env);
    audit(principal.accountId, "person.create", "person", person.id);
    return reply.code(201).send({ data: maskPerson(person) });
  });

  app.get("/api/persons/:id/sensitive", manager, async (request) => {
    const principal = principalOf(request);
    const { id } = idParam.parse(request.params);
    if (!await canAccessPerson(principal, id)) forbidden();
    await verifySensitiveToken(request, deps.env);
    const person = await prisma.person.findUniqueOrThrow({ where: { id } });
    if (!person.nationalIdCipher || !person.nationalIdIv || !person.nationalIdTag) throw Object.assign(new Error("该人员尚未补录身份证号码"), { statusCode: 404, code: "NATIONAL_ID_MISSING" });
    audit(principal.accountId, "person.sensitive_read", "person", id);
    return { data: { nationalId: decryptNationalId(person.nationalIdCipher, person.nationalIdIv, person.nationalIdTag, deps.env) } };
  });

  app.patch("/api/persons/:id", manager, async (request) => {
    const principal = principalOf(request);
    const { id } = idParam.parse(request.params);
    if (!await canAccessPerson(principal, id)) forbidden();
    const input = z.object({
      name: z.string().trim().min(2).max(80).optional(),
      phone: z.string().regex(/^1\d{10}$/).optional(),
      organizationId: z.string().uuid().optional(),
      nationalId: z.string().trim().min(6).max(30).optional(),
      photoFileId: z.string().uuid().optional()
    }).refine((value) => Object.keys(value).length > 0, "至少填写一项资料").parse(request.body);
    const currentMemberships = await prisma.organizationMembership.findMany({ where: { personId: id, active: true }, select: { organizationId: true } });
    if (!canManagePersonStatus(principal, currentMemberships.map((item) => item.organizationId))) forbidden("只有人员所属组织负责人、管理员或公司管理员可以维护人员资料");
    if (!isCompanyAdmin(principal) && (input.name || input.phone || input.organizationId || input.nationalId)) forbidden("姓名、手机号、身份证和所属组织只能由公司管理员直接调整");
    if (input.organizationId) {
      if (!await canAccessOrganization(principal, input.organizationId)) forbidden();
      const target = await prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId }, select: { type: true } });
      if (!['department', 'business_entity'].includes(target.type)) throw Object.assign(new Error("人员主组织只能是经营实体或部门"), { statusCode: 409, code: "INVALID_PRIMARY_ORGANIZATION" });
    }
    const phone = input.phone ? normalizePhone(input.phone) : undefined;
    if (phone && await prisma.person.findFirst({ where: { id: { not: id }, phone, status: "active" }, select: { id: true } })) throw Object.assign(new Error("该手机号已有在用人员档案"), { statusCode: 409, code: "PHONE_EXISTS" });
    if (input.nationalId) {
      const problem = nationalIdError(input.nationalId);
      if (problem) throw Object.assign(new Error(problem), { statusCode: 400, code: "INVALID_NATIONAL_ID" });
      if (await prisma.person.findFirst({ where: { id: { not: id }, nationalIdHash: hashNationalId(input.nationalId, deps.env) }, select: { id: true } })) throw Object.assign(new Error("该身份证号码已有人员档案"), { statusCode: 409, code: "NATIONAL_ID_EXISTS" });
    }
    if (input.photoFileId) {
      const file = await prisma.privateFile.findUnique({ where: { id: input.photoFileId }, select: { kind: true } });
      if (file?.kind !== "photo") throw Object.assign(new Error("所选文件不是个人照片"), { statusCode: 400, code: "INVALID_PHOTO" });
    }
    const person = await prisma.$transaction(async (tx) => {
      if (input.organizationId) {
        await setPrimaryOrganization(tx, { personId: id, organizationId: input.organizationId, actorId: principal.accountId, reason: "公司管理员直接调整主组织" });
      }
      return tx.person.update({ where: { id }, data: { ...(input.name ? { name: input.name } : {}), ...(phone ? { phone } : {}), ...(input.photoFileId ? { photoFileId: input.photoFileId } : {}), ...(input.nationalId ? encryptNationalId(input.nationalId, deps.env) : {}) }, select: personSafeSelect });
    });
    await auditCritical(principal.accountId, "person.profile_update", "person", id, { fields: Object.keys(input) }, "var/audit-fallback.ndjson");
    return { data: maskPerson(person) };
  });

  app.patch("/api/persons/:id/status", manager, async (request) => {
    const principal = principalOf(request);
    const { id } = idParam.parse(request.params);
    if (!await canAccessPerson(principal, id)) forbidden();
    const memberships = await prisma.organizationMembership.findMany({ where: { personId: id, active: true }, select: { organizationId: true } });
    if (!canManagePersonStatus(principal, memberships.map((item) => item.organizationId))) forbidden("项目管理员不能停用或启用人员档案");
    const input = z.object({ status: z.enum(["active", "disabled"]), reason: z.string().trim().min(2).max(500) }).parse(request.body); const status = input.status;
    const person = await prisma.$transaction(async (tx) => {
      if (status === "disabled") await disablePerson(tx, { personId: id, actorId: principal.accountId, reason: input.reason });
      else await reactivatePerson(tx, { personId: id });
      return tx.person.findUniqueOrThrow({ where: { id }, select: personSafeSelect });
    });
    await auditCritical(principal.accountId, "person.status_change", "person", id, { status, reason: input.reason }, "var/audit-fallback.ndjson");
    return { data: maskPerson(person) };
  });

  app.patch("/api/projects/:id", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const current = await prisma.project.findUniqueOrThrow({ where: { id } });
    if (!isCompanyAdmin(principal) && !organizationScopeIds(principal).includes(current.responsibleOrganizationId)) forbidden("只有公司管理员或项目责任经营实体负责人、管理员可以编辑项目主档");
    if (current.status === "ended") throw Object.assign(new Error("已结束项目为只读"), { statusCode: 409, code: "PROJECT_ENDED" });
    const input = projectCreateSchema.partial().omit({ responsibleOrganizationId: true }).parse(request.body);
    const data = Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== undefined && !["plannedStartAt", "plannedEndAt"].includes(key))) as Prisma.ProjectUncheckedUpdateInput;
    if (input.plannedStartAt !== undefined) data.plannedStartAt = new Date(`${input.plannedStartAt}T00:00:00.000Z`);
    if (input.plannedEndAt !== undefined) data.plannedEndAt = new Date(`${input.plannedEndAt}T00:00:00.000Z`);
    const project = await prisma.project.update({ where: { id }, data });
    await auditCritical(principal.accountId, "project.update", "project", id, { fields: Object.keys(input) }, "var/audit-fallback.ndjson"); return { data: project };
  });

  app.delete("/api/persons/:id", manager, async (request, reply) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    if (!isCompanyAdmin(principal)) forbidden("只有公司管理员可以删除误建空档案");
    const { reason } = z.object({ reason: z.string().trim().min(2).max(500) }).parse(request.body);
    const [person, account, audits] = await Promise.all([
      prisma.person.findUniqueOrThrow({ where: { id }, include: { _count: { select: { organizations: true, projectMemberships: true, assignments: true, signatures: true, changeRequests: true, notifications: true, certificates: true } } } }),
      prisma.account.count({ where: { personId: id } }),
      prisma.auditLog.count({ where: { objectType: "person", objectId: id } })
    ]);
    const references = account + audits + Object.values(person._count).reduce((sum, count) => sum + count, 0);
    if (references) throw Object.assign(new Error("该人员已有账号、组织、项目、培训、证照、申请或审计记录，只能停用"), { statusCode: 409, code: "PERSON_IN_USE" });
    await prisma.person.delete({ where: { id } });
    await auditCritical(principal.accountId, "person.delete_empty", "person", id, { name: person.name, reason }, "var/audit-fallback.ndjson");
    return reply.code(204).send();
  });

  app.post("/api/persons/import", manager, async () => {
    throw Object.assign(new Error("请使用人员初始化预检查与确认流程"), { statusCode: 410, code: "IMPORT_PREVIEW_REQUIRED" });
  });

  app.get("/api/accounts", manager, async (request) => {
    const principal = principalOf(request);
    const orgIds = await accessibleOrganizationIds(principal); const projectIds = projectScopeIds(principal);
    const where: Prisma.AccountWhereInput = isCompanyAdmin(principal) ? {} : { OR: [
      { roles: { some: { active: true, OR: [{ scopeType: "organization", scopeId: { in: orgIds } }, { scopeType: "project", scopeId: { in: projectIds } }] } } },
      { person: { organizations: { some: { active: true, organizationId: { in: orgIds } } } } },
      { person: { projectMemberships: { some: { status: "active", projectId: { in: projectIds } } } } }
    ] };
    const accounts = await prisma.account.findMany({
      where,
      select: {
        id: true, username: true, status: true, personId: true, verifiedPhone: true,
        passwordLoginEnabled: true, mustChangePassword: true, lastLoginAt: true, createdAt: true,
        wechatBindings: { where: { active: true }, select: { id: true } },
        roles: true,
        person: { select: { name: true, status: true, organizations: { where: { active: true, primary: true }, take: 1, select: { organization: { select: { id: true, name: true } } } } } }
      },
      orderBy: { createdAt: "desc" }
    });
    return { data: accounts.map(({ verifiedPhone, wechatBindings, ...account }) => ({
      ...account,
      verifiedPhoneMasked: verifiedPhone ? maskPhone(verifiedPhone) : null,
      loginMethods: { password: account.passwordLoginEnabled, phone: Boolean(verifiedPhone), wechat: wechatBindings.length > 0 }
    })) };
  });

  app.post("/api/accounts", manager, async (request, reply) => {
    const principal = principalOf(request);
    if (!isCompanyAdmin(principal)) forbidden("只有公司管理员可以直接创建用户名密码账号");
    const input = z.object({ username: z.string(), password: z.string().min(12).max(200), personId: z.string().uuid() }).parse(request.body);
    const usernameNormalized = normalizeUsername(input.username);
    const person = await prisma.person.findUniqueOrThrow({ where: { id: input.personId }, select: { status: true, account: { select: { id: true } } } });
    if (person.status !== "active") throw Object.assign(new Error("只能为正常人员创建账号"), { statusCode: 409, code: "PERSON_NOT_ACTIVE" });
    if (person.account) throw Object.assign(new Error("该人员已关联账号"), { statusCode: 409, code: "PERSON_ACCOUNT_EXISTS" });
    const passwordHash = await argon2.hash(input.password);
    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.account.create({ data: { username: usernameNormalized, usernameNormalized, passwordHash, passwordLoginEnabled: true, mustChangePassword: true, personId: input.personId }, select: { id: true, username: true, status: true, personId: true } });
      await activatePendingRoles(tx, { personId: input.personId, accountId: created.id, actorId: principal.accountId });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "account.create", objectType: "account", objectId: created.id, result: "success", metadata: { personId: input.personId } } });
      return created;
    });
    return reply.code(201).send({ data: account });
  });

  app.post("/api/account-merge-requests", manager, async (request, reply) => {
    const principal = principalOf(request);
    if (!isCompanyAdmin(principal)) forbidden("只有公司管理员可以发起账号合并");
    await verifySensitiveToken(request, deps.env);
    const input = z.object({ sourceAccountId: z.string().uuid(), targetAccountId: z.string().uuid(), reason: z.string().trim().min(2).max(500) }).parse(request.body);
    const row = await prisma.$transaction(async (tx) => {
      const { source, target } = await assertAccountMergeCandidate(tx, { ...input, actorId: principal.accountId });
      const personId = target.personId ?? source.personId;
      if (!personId) throw Object.assign(new Error("至少一个账号必须关联人员档案"), { statusCode: 409, code: "ACCOUNT_MERGE_PERSON_REQUIRED" });
      const created = await requestAccountMerge(tx, { ...input, personId });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "account.merge_request", objectType: "change_request", objectId: created.id, result: "success", metadata: { sourceAccountId: input.sourceAccountId, targetAccountId: input.targetAccountId, reason: input.reason } } });
      return created;
    }, { isolationLevel: "Serializable" });
    return reply.code(201).send({ data: { id: row.id, status: row.status } });
  });

  app.post("/api/accounts/:id/reset-password", manager, async (request, reply) => {
    const principal = principalOf(request);
    if (!isCompanyAdmin(principal)) forbidden("只有公司管理员可以重置其他账号密码");
    const { id } = idParam.parse(request.params);
    if (id === principal.accountId) throw Object.assign(new Error("请使用修改密码功能变更本人密码"), { statusCode: 409, code: "USE_CHANGE_PASSWORD" });
    const input = z.object({ newPassword: z.string().min(12).max(200) }).parse(request.body);
    const passwordHash = await argon2.hash(input.newPassword);
    await prisma.$transaction(async (tx) => {
      const target = await tx.account.findUniqueOrThrow({ where: { id }, select: { status: true } });
      if (target.status === "merged") throw Object.assign(new Error("已合并账号不能重置密码"), { statusCode: 409, code: "MERGED_ACCOUNT_IMMUTABLE" });
      await tx.account.update({ where: { id }, data: { passwordHash, passwordLoginEnabled: true, mustChangePassword: true, sessionVersion: { increment: 1 } } });
      await tx.refreshSession.updateMany({ where: { accountId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "account.password_reset", objectType: "account", objectId: id, result: "success" } });
    });
    return reply.code(204).send();
  });

  app.patch("/api/accounts/:id/username", manager, async (request, reply) => {
    const principal = principalOf(request);
    if (!isCompanyAdmin(principal)) forbidden("只有公司管理员可以修改用户名");
    const { id } = idParam.parse(request.params);
    const input = z.object({ username: z.string(), reason: z.string().trim().min(2).max(500) }).parse(request.body);
    const usernameNormalized = normalizeUsername(input.username);
    await prisma.$transaction(async (tx) => {
      const target = await tx.account.findUniqueOrThrow({ where: { id }, select: { username: true, usernameNormalized: true, status: true } });
      if (target.status === "merged") throw Object.assign(new Error("已合并账号不能修改用户名"), { statusCode: 409, code: "MERGED_ACCOUNT_IMMUTABLE" });
      if (target.usernameNormalized === usernameNormalized) return;
      if (await tx.usernameHistory.findUnique({ where: { usernameNormalized } })) throw Object.assign(new Error("该用户名属于历史保留用户名，不能复用"), { statusCode: 409, code: "USERNAME_RESERVED" });
      if (target.username && target.usernameNormalized) await tx.usernameHistory.create({ data: { accountId: id, username: target.username, usernameNormalized: target.usernameNormalized, changedBy: principal.accountId, reason: input.reason } });
      await tx.account.update({ where: { id }, data: { username: usernameNormalized, usernameNormalized, sessionVersion: { increment: 1 } } });
      await tx.refreshSession.updateMany({ where: { accountId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "account.username_change", objectType: "account", objectId: id, result: "success", metadata: { before: target.username, after: usernameNormalized, reason: input.reason } } });
    }, { isolationLevel: "Serializable" });
    if (id === principal.accountId) reply.clearCookie("safety_session", { path: "/" });
    return reply.code(204).send();
  });

  app.post("/api/accounts/:id/status", manager, async (request, reply) => {
    const principal = principalOf(request);
    if (!isCompanyAdmin(principal)) forbidden("只有公司管理员可以停用或启用账号");
    const { id } = idParam.parse(request.params);
    const input = z.object({ status: z.enum(["active", "disabled"]), reason: z.string().trim().min(2).max(500) }).parse(request.body);
    await prisma.$transaction(async (tx) => {
      const target = await tx.account.findUniqueOrThrow({ where: { id }, select: { status: true, person: { select: { status: true } }, roles: { where: { active: true, role: "company_admin", scopeType: "company" }, select: { id: true } } } });
      if (target.status === input.status) return;
      const activeCompanyAdminCount = await tx.account.count({ where: { status: "active", roles: { some: { active: true, role: "company_admin", scopeType: "company" } } } });
      assertAccountStatusChange({ actorId: principal.accountId, targetId: id, currentStatus: target.status, nextStatus: input.status, targetIsCompanyAdmin: target.roles.length > 0, activeCompanyAdminCount, personStatus: target.person?.status ?? null });
      await tx.account.update({ where: { id }, data: { status: input.status, sessionVersion: { increment: 1 } } });
      await tx.refreshSession.updateMany({ where: { accountId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: input.status === "active" ? "account.enable" : "account.disable", objectType: "account", objectId: id, result: "success", metadata: { before: target.status, after: input.status, reason: input.reason } } });
    }, { isolationLevel: "Serializable" });
    return reply.code(204).send();
  });

  app.delete("/api/accounts/:id", manager, async (request, reply) => {
    const principal = principalOf(request);
    if (!isCompanyAdmin(principal)) forbidden("只有公司管理员可以删除误建空账号");
    const { id } = idParam.parse(request.params);
    if (id === principal.accountId) throw Object.assign(new Error("不能删除当前登录账号"), { statusCode: 409, code: "ACCOUNT_SELF_ACTION_FORBIDDEN" });
    const { reason } = z.object({ reason: z.string().trim().min(2).max(500) }).parse(request.body);
    await prisma.$transaction(async (tx) => {
      const target = await tx.account.findUniqueOrThrow({ where: { id }, select: { personId: true, username: true, status: true, _count: { select: { roles: true, wechatBindings: true, refreshSessions: true, preferences: true, usernameHistory: true, mergedAccounts: true } } } });
      const [requests, audits, uploadedFiles] = await Promise.all([
        tx.changeRequest.count({ where: { accountId: id } }),
        tx.auditLog.count({ where: { OR: [{ actorId: id }, { objectType: "account", objectId: id }] } }),
        tx.privateFile.count({ where: { uploadedBy: id } })
      ]);
      const blockers = accountDeletionBlockers({ person: target.personId ? 1 : 0, ...target._count, requests, audits, uploadedFiles });
      if (blockers.length) throw Object.assign(new Error(`该账号不能物理删除：${blockers.join("、")}`), { statusCode: 409, code: "ACCOUNT_IN_USE", details: blockers });
      await tx.account.delete({ where: { id } });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "account.delete_empty", objectType: "account", objectId: id, result: "success", metadata: { username: target.username, status: target.status, reason } } });
    }, { isolationLevel: "Serializable" });
    return reply.code(204).send();
  });

  app.delete("/api/accounts/:id/login-methods/:method", authenticated, async (request, reply) => {
    const principal = principalOf(request);
    const { id, method } = z.object({ id: z.string().uuid(), method: z.enum(["password", "phone", "wechat"]) }).parse(request.params);
    if (id !== principal.accountId && !isCompanyAdmin(principal)) forbidden("只有公司管理员可以解除其他账号的登录方式");
    if (id === principal.accountId && method !== "password") forbidden("手机号或微信换绑请提交身份变更申请");
    await verifySensitiveToken(request, deps.env);
    const { reason } = z.object({ reason: z.string().trim().min(2).max(500) }).parse(request.body);
    await prisma.$transaction(async (tx) => {
      const target = await tx.account.findUniqueOrThrow({ where: { id }, include: { wechatBindings: { where: { active: true } }, roles: { where: { active: true, role: "company_admin", scopeType: "company" } } } });
      if (target.status === "merged") throw Object.assign(new Error("已合并账号不能修改登录方式"), { statusCode: 409, code: "MERGED_ACCOUNT_IMMUTABLE" });
      const before = { password: target.passwordLoginEnabled, phone: Boolean(target.verifiedPhone), wechat: target.wechatBindings.length > 0 };
      if (!before[method]) throw Object.assign(new Error("该登录方式当前未启用"), { statusCode: 409, code: "LOGIN_METHOD_NOT_ENABLED" });
      const activeCompanyAdmins = await tx.roleAssignment.count({ where: { role: "company_admin", scopeType: "company", active: true, account: { status: "active" } } });
      assertLoginMethodCanBeRemoved({ method, targetIsLastCompanyAdmin: target.roles.length > 0 && activeCompanyAdmins <= 1, otherWebLoginAvailable: target.wechatBindings.some((binding) => Boolean(binding.unionid)) });
      const after = { ...before, [method]: false };
      if (method === "password") await tx.account.update({ where: { id }, data: { passwordHash: null, passwordLoginEnabled: false, mustChangePassword: false, status: accountStatusAfterLoginMethodChange(target.status, after), sessionVersion: { increment: 1 } } });
      if (method === "phone") await tx.account.update({ where: { id }, data: { verifiedPhone: null, status: accountStatusAfterLoginMethodChange(target.status, after), sessionVersion: { increment: 1 } } });
      if (method === "wechat") {
        await tx.wechatBinding.updateMany({ where: { accountId: id, active: true }, data: { active: false, endedAt: new Date(), endedBy: principal.accountId, endReason: reason } });
        await tx.account.update({ where: { id }, data: { status: accountStatusAfterLoginMethodChange(target.status, after), sessionVersion: { increment: 1 } } });
      }
      await tx.refreshSession.updateMany({ where: { accountId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: `account.login_method_remove.${method}`, objectType: "account", objectId: id, result: "success", metadata: { method, reason, before, after } } });
    }, { isolationLevel: "Serializable" });
    if (id === principal.accountId) {
      reply.clearCookie("safety_session", { path: "/" });
      reply.clearCookie("safety_refresh", { path: "/api/auth" });
    }
    return reply.code(204).send();
  });

  app.post("/api/roles", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = roleAssignmentCreateSchema.parse(request.body);
    if (input.role === "company_admin") await verifySensitiveToken(request, deps.env);
    const scopeId = input.scopeId ?? null;
    const organization = input.scopeType === "organization" && scopeId ? await prisma.organization.findUniqueOrThrow({ where: { id: scopeId }, select: { type: true } }) : null;
    const project = input.scopeType === "project" && scopeId ? await prisma.project.findUniqueOrThrow({ where: { id: scopeId }, select: { responsibleOrganizationId: true, status: true } }) : null;
    if (!canGrantScopedRole(principal, { role: input.role, scopeType: input.scopeType, scopeId, ...(organization ? { organizationType: organization.type } : {}), ...(project ? { projectResponsibleOrganizationId: project.responsibleOrganizationId } : {}) })) forbidden("无权授予该角色或范围");
    if (input.role === "field_reporter" && organization?.type !== "business_entity") throw Object.assign(new Error("野外项目报送人员只能设置在经营实体"), { statusCode: 409, code: "REPORTER_REQUIRES_BUSINESS_ENTITY" });
    const target = await prisma.person.findUniqueOrThrow({ where: { id: input.personId }, select: { status: true, type: true, account: { select: { id: true, status: true } }, organizations: { where: { active: true, primary: true }, take: 1, select: { organizationId: true, organization: { select: { type: true } } } } } });
    if (target.status !== "active" || target.type !== "employee") throw Object.assign(new Error("管理角色只能授予在用正式员工"), { statusCode: 409, code: "ROLE_TARGET_INVALID" });
    if (input.role === "company_admin" && (!target.account || target.account.status !== "active")) throw Object.assign(new Error("公司管理员必须先激活账号"), { statusCode: 409, code: "COMPANY_ADMIN_ACCOUNT_REQUIRED" });
    if (input.role === "company_admin" && target.account?.id === principal.accountId) throw Object.assign(new Error("不能给自己授予公司管理员角色"), { statusCode: 409, code: "ROLE_SELF_GRANT_FORBIDDEN" });
    if (["org_leader", "org_admin", "field_reporter"].includes(input.role) && scopeId && !await prisma.organizationMembership.findFirst({ where: { personId: input.personId, organizationId: scopeId, active: true, primary: true } })) {
      throw Object.assign(new Error("组织管理角色只能授予该组织当前成员"), { statusCode: 409, code: "ROLE_ORGANIZATION_MEMBERSHIP_REQUIRED" });
    }
    if (input.role === "project_admin" && target.organizations[0]?.organization.type !== "business_entity") {
      throw Object.assign(new Error("普通部门人员不能担任项目管理员"), { statusCode: 409, code: "PROJECT_ADMIN_REQUIRES_BUSINESS_ENTITY" });
    }
    if (input.role === "project_admin" && project?.status !== "active") throw Object.assign(new Error("暂停或结束项目不能新增项目管理员"), { statusCode: 409, code: "PROJECT_READ_ONLY" });
    if (!isCompanyAdmin(principal) && input.role === "project_admin" && project && !await prisma.organizationMembership.findFirst({ where: { personId: input.personId, organizationId: project.responsibleOrganizationId, active: true, primary: true } })) {
      forbidden("经营实体负责人或管理员只能从本实体在用人员中设置项目管理员");
    }
    const role = await prisma.$transaction(async (tx) => {
      const created = await grantRole(tx, { personId: input.personId, role: input.role, scopeType: input.scopeType, scopeId, actorId: principal.accountId, reason: input.reason });
      if (input.role === "project_admin" && scopeId) {
        const currentMember = await tx.projectMember.findFirst({ where: { projectId: scopeId, personId: input.personId, status: { in: ["active", "approved"] } } });
        if (!currentMember) await tx.projectMember.create({ data: { projectId: scopeId, personId: input.personId, status: "active", reviewedBy: principal.accountId, reviewedAt: new Date() } });
      }
      if (created.accountId) {
        await tx.account.update({ where: { id: created.accountId }, data: { sessionVersion: { increment: 1 } } });
        await tx.refreshSession.updateMany({ where: { accountId: created.accountId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "role.grant", objectType: "role_assignment", objectId: created.id, result: "success", metadata: { personId: input.personId, role: input.role, scopeType: input.scopeType, scopeId, reason: input.reason, activationPending: created.activationPending } } });
      return created;
    });
    if (input.role === "project_admin" && scopeId) await autoDispatch("project_induction", input.personId, deps.env, scopeId);
    return reply.code(201).send({ data: role });
  });

  app.delete("/api/roles/:id", manager, async (request, reply) => {
    const principal = principalOf(request);
    const { id } = idParam.parse(request.params);
    const { reason } = z.object({ reason: z.string().trim().min(2).max(500) }).parse(request.body);
    const role = await prisma.roleAssignment.findUniqueOrThrow({ where: { id } });
    if (role.role === "company_admin") await verifySensitiveToken(request, deps.env);
    const organization = role.scopeType === "organization" && role.scopeId ? await prisma.organization.findUniqueOrThrow({ where: { id: role.scopeId }, select: { type: true } }) : null;
    const project = role.scopeType === "project" && role.scopeId ? await prisma.project.findUniqueOrThrow({ where: { id: role.scopeId }, select: { responsibleOrganizationId: true } }) : null;
    if (!canGrantScopedRole(principal, { role: role.role, scopeType: role.scopeType, scopeId: role.scopeId, ...(organization ? { organizationType: organization.type } : {}), ...(project ? { projectResponsibleOrganizationId: project.responsibleOrganizationId } : {}) })) forbidden("无权取消该角色或范围");
    if (role.accountId === principal.accountId && role.role === "company_admin") throw Object.assign(new Error("不能撤销自己的公司管理员角色"), { statusCode: 409, code: "ROLE_SELF_REVOKE_FORBIDDEN" });
    await prisma.$transaction(async (tx) => {
      if (role.active && role.role === "company_admin" && await tx.roleAssignment.count({ where: { role: "company_admin", scopeType: "company", active: true } }) <= 1) {
        throw Object.assign(new Error("系统必须至少保留一名公司管理员"), { statusCode: 409, code: "LAST_COMPANY_ADMIN" });
      }
      await revokeRole(tx, { roleId: id, actorId: principal.accountId, reason });
      if (role.accountId) {
        await tx.account.update({ where: { id: role.accountId }, data: { sessionVersion: { increment: 1 } } });
        await tx.refreshSession.updateMany({ where: { accountId: role.accountId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "role.revoke", objectType: "role_assignment", objectId: id, result: "success", metadata: { role: role.role, scopeType: role.scopeType, scopeId: role.scopeId, reason } } });
    }, { isolationLevel: "Serializable" });
    return reply.code(204).send();
  });

  app.get("/api/projects/:id/members", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    if (!await canAccessProject(principal, id)) forbidden();
    const members = await prisma.projectMember.findMany({ where: { projectId: id }, include: { person: { select: personSafeSelect } }, orderBy: { createdAt: "desc" } });
    return { data: members.map((member) => ({ ...member, person: maskPerson(member.person) })) };
  });

  app.post("/api/projects/:id/members", manager, async (request, reply) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    if (!await canAccessProject(principal, id)) forbidden();
    const project = await prisma.project.findUniqueOrThrow({ where: { id } });
    if (project.status !== "active") throw Object.assign(new Error("暂停或结束项目不能新增成员"), { statusCode: 409, code: "PROJECT_READ_ONLY" });
    const personId = z.object({ personId: z.string().uuid() }).parse(request.body).personId;
    if (!await canAccessPerson(principal, personId)) forbidden();
    const person = await prisma.person.findUniqueOrThrow({ where: { id: personId }, select: { type: true, status: true, organizations: { where: { active: true, primary: true }, take: 1, select: { organization: { select: { type: true } } } } } });
    if (person.status !== "active" || !canJoinProject(person.type, person.organizations[0]?.organization.type ?? null)) throw Object.assign(new Error("只有当前主组织为经营实体的在用人员可以加入项目"), { statusCode: 409, code: "PROJECT_MEMBER_INELIGIBLE" });
    const member = await prisma.projectMember.create({ data: { projectId: id, personId, status: "active", reviewedBy: principal.accountId, reviewedAt: new Date() } });
    audit(principal.accountId, "project_member.add", "project_member", member.id);
    await autoDispatch("project_induction", personId, deps.env, id);
    return reply.code(201).send({ data: member });
  });

  app.patch("/api/project-members/:id/review", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    const member = await prisma.projectMember.findUniqueOrThrow({ where: { id }, include: { project: true } });
    if (!await canAccessProject(principal, member.projectId)) forbidden();
    if (member.project.status !== "active") throw Object.assign(new Error("项目不是 active 状态"), { statusCode: 409, code: "PROJECT_READ_ONLY" });
    const input = z.object({ status: z.enum(["active", "rejected"]), note: z.string().trim().max(500).optional() }).parse(request.body); const status = input.status;
    if (status === "active") {
      const person = await prisma.person.findUniqueOrThrow({ where: { id: member.personId }, select: { type: true, status: true, organizations: { where: { active: true, primary: true }, take: 1, select: { organization: { select: { type: true } } } } } });
      if (person.status !== "active" || !canJoinProject(person.type, person.organizations[0]?.organization.type ?? null)) throw Object.assign(new Error("该人员当前不符合项目成员关系要求"), { statusCode: 409, code: "PROJECT_MEMBER_INELIGIBLE" });
    }
    const updated = await prisma.projectMember.update({ where: { id }, data: { status, reviewedBy: principal.accountId, reviewedAt: new Date() } });
    audit(principal.accountId, "project_member.review", "project_member", id, { status, note: input.note });
    if (status === "active") await autoDispatch("project_induction", member.personId, deps.env, member.projectId);
    return { data: updated };
  });
}
