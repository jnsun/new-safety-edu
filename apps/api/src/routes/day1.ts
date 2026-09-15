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
import { nationalIdError } from "../person-import-core.js";
import { createPerson, maskPerson, personSafeSelect } from "../people.js";
import { issueAccessToken, issueSensitiveToken, issueSession, rotateRefreshToken, verifySensitiveToken, type Principal } from "../auth.js";
import { autoDispatch } from "./day2.js";
import { canGrantScopedRole, canJoinProject, canManagePersonStatus, disablePerson, grantRole, reactivatePerson, revokeRole, setPrimaryOrganization } from "../identity.js";

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
    const account = await prisma.account.findUnique({ where: { username: input.username } });
    if (!account?.passwordHash || account.status !== "active" || !await argon2.verify(account.passwordHash, input.password)) {
      throw Object.assign(new Error("用户名或密码错误"), { statusCode: 401, code: "INVALID_CREDENTIALS" });
    }
    const token = await issueAccessToken(account.id, deps.env);
    reply.setCookie("safety_session", token, { httpOnly: true, sameSite: "strict", secure: deps.env.NODE_ENV === "production", path: "/", maxAge: 900 });
    audit(account.id, "auth.login", "account", account.id);
    return { data: { accountId: account.id } };
  });

  app.post("/api/auth/logout", authenticated, async (request, reply) => {
    const principal = principalOf(request);
    await prisma.$transaction([
      prisma.account.update({ where: { id: principal.accountId }, data: { sessionVersion: { increment: 1 } } }),
      prisma.refreshSession.updateMany({ where: { accountId: principal.accountId, revokedAt: null }, data: { revokedAt: new Date() } })
    ]);
    reply.clearCookie("safety_session", { path: "/" });
    audit(principal.accountId, "auth.logout", "account", principal.accountId);
    return reply.code(204).send();
  });

  app.post("/api/auth/change-password", authenticated, async (request, reply) => {
    const principal = principalOf(request); const input = z.object({ currentPassword: z.string().min(8).max(200), newPassword: z.string().min(12).max(200) }).refine((value) => value.currentPassword !== value.newPassword, { message: "新密码不能与当前密码相同", path: ["newPassword"] }).parse(request.body);
    const account = await prisma.account.findUniqueOrThrow({ where: { id: principal.accountId } }); if (!account.passwordHash || !await argon2.verify(account.passwordHash, input.currentPassword)) throw Object.assign(new Error("当前密码错误"), { statusCode: 401, code: "INVALID_CURRENT_PASSWORD" });
    await prisma.$transaction([prisma.account.update({ where: { id: principal.accountId }, data: { passwordHash: await argon2.hash(input.newPassword), sessionVersion: { increment: 1 } } }), prisma.refreshSession.updateMany({ where: { accountId: principal.accountId, revokedAt: null }, data: { revokedAt: new Date() } })]);
    await auditCritical(principal.accountId, "account.password_change", "account", principal.accountId, undefined, "var/audit-fallback.ndjson"); reply.clearCookie("safety_session", { path: "/" }); return reply.code(204).send();
  });

  app.post("/api/auth/reauthenticate", authenticated, async (request) => {
    const principal = principalOf(request); const { password } = z.object({ password: z.string().min(8).max(200) }).parse(request.body);
    const account = await prisma.account.findUniqueOrThrow({ where: { id: principal.accountId } });
    if (!account.passwordHash) throw Object.assign(new Error("当前账号未配置密码，暂不能查看完整敏感信息"), { statusCode: 409, code: "REAUTH_METHOD_UNAVAILABLE" });
    if (!await argon2.verify(account.passwordHash, password)) throw Object.assign(new Error("当前密码错误"), { statusCode: 401, code: "INVALID_CURRENT_PASSWORD" });
    await auditCritical(principal.accountId, "account.sensitive_reauthenticate", "account", principal.accountId, undefined, "var/audit-fallback.ndjson");
    return { data: { token: await issueSensitiveToken(principal.accountId, deps.env), expiresIn: 300 } };
  });

  app.get("/api/auth/me", authenticated, async (request) => ({ data: principalOf(request) }));
  app.post("/api/auth/refresh", async (request) => ({ data: await rotateRefreshToken(z.object({ refreshToken: z.string().min(20) }).parse(request.body).refreshToken, deps.env) }));

  app.get("/api/organizations", manager, async (request) => {
    const principal = principalOf(request);
    const organizations = await prisma.organization.findMany({
      where: isCompanyAdmin(principal) ? {} : { id: { in: await accessibleOrganizationIds(principal) } },
      include: { _count: { select: { memberships: { where: { active: true } } } } },
      orderBy: { name: "asc" }
    });
    const roles = await prisma.roleAssignment.findMany({
      where: { active: true, scopeType: "organization", scopeId: { in: organizations.map(({ id }) => id) }, role: { in: ["org_leader", "org_admin", "field_reporter"] } },
      include: { account: { select: { person: { select: { id: true, name: true } } } } }
    });
    return { data: organizations.map(({ _count, ...organization }) => {
      const scoped = roles.filter((role) => role.scopeId === organization.id && role.account.person);
      const people = (role: "org_leader" | "org_admin") => scoped.filter((item) => item.role === role).map((item) => ({ roleId: item.id, personId: item.account.person!.id, name: item.account.person!.name }));
      const leaders = people("org_leader"); const admins = people("org_admin");
      const reporters = new Map(scoped.filter((item) => item.role === "field_reporter").map((item) => [item.account.person!.id, { roleId: item.id as string | null, personId: item.account.person!.id, name: item.account.person!.name, inherited: false }]));
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
    const input = z.object({ personId: z.string().uuid(), role: z.enum(["org_leader", "org_admin", "field_reporter"]) }).parse(request.body);
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id }, select: { type: true } });
    if (!["department", "business_entity"].includes(organization.type)) throw Object.assign(new Error("该权限只能设置在部门或经营实体"), { statusCode: 409, code: "INVALID_ORGANIZATION_ROLE_SCOPE" });
    if (!canGrantScopedRole(principal, { role: input.role, scopeType: "organization", scopeId: id, organizationType: organization.type })) forbidden("无权授予该组织角色");
    if (input.role === "field_reporter" && organization.type !== "business_entity") throw Object.assign(new Error("只有经营实体可以设置野外项目报送人员"), { statusCode: 409, code: "REPORTER_REQUIRES_BUSINESS_ENTITY" });
    const person = await prisma.person.findFirst({ where: { id: input.personId, status: "active", organizations: { some: { organizationId: id, active: true } } }, select: { id: true } });
    if (!person) throw Object.assign(new Error("只能设置该部门的在职人员"), { statusCode: 409, code: "PERSON_NOT_IN_ORGANIZATION" });
    const account = await prisma.account.upsert({ where: { personId: input.personId }, create: { personId: input.personId, status: "active" }, update: {} });
    const role = await prisma.$transaction(async (tx) => {
      if (input.role === "org_leader") {
        const current = await tx.roleAssignment.findFirst({ where: { role: "org_leader", scopeType: "organization", scopeId: id, active: true } });
        if (current && current.accountId !== account.id) await revokeRole(tx, { roleId: current.id, actorId: principal.accountId, reason: "更换组织负责人" });
      }
      return grantRole(tx, { accountId: account.id, role: input.role, scopeType: "organization", scopeId: id });
    });
    await auditCritical(principal.accountId, "organization.role_grant", "role_assignment", role.id, { organizationId: id, personId: input.personId, role: input.role }, "var/audit-fallback.ndjson");
    return reply.code(201).send({ data: role });
  });

  app.delete("/api/organizations/:id/roles/:roleId", manager, async (request, reply) => {
    const principal = principalOf(request); const input = z.object({ id: z.string().uuid(), roleId: z.string().uuid() }).parse(request.params);
    const role = await prisma.roleAssignment.findUniqueOrThrow({ where: { id: input.roleId } });
    if (role.scopeType !== "organization" || role.scopeId !== input.id || !["org_leader", "org_admin", "field_reporter"].includes(role.role)) forbidden();
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: input.id }, select: { type: true } });
    if (!canGrantScopedRole(principal, { role: role.role, scopeType: "organization", scopeId: input.id, organizationType: organization.type })) forbidden("无权取消该组织角色");
    await prisma.$transaction((tx) => revokeRole(tx, { roleId: role.id, actorId: principal.accountId, reason: "管理员取消组织角色" }));
    await auditCritical(principal.accountId, "organization.role_revoke", "role_assignment", role.id, { organizationId: input.id, role: role.role }, "var/audit-fallback.ndjson");
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
    if (status === "active" && person.type === "employee") await autoDispatch("three_level", id, deps.env);
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
    return { data: await prisma.account.findMany({ where, select: { id: true, username: true, status: true, personId: true, roles: true, createdAt: true } }) };
  });

  app.post("/api/accounts", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = z.object({ username: z.string().trim().min(3).max(80), password: z.string().min(12).max(200), personId: z.string().uuid().optional() }).parse(request.body);
    if (!isCompanyAdmin(principal) && (!input.personId || !await canAccessPerson(principal, input.personId))) forbidden();
    const account = await prisma.account.create({ data: { username: input.username, passwordHash: await argon2.hash(input.password), ...(input.personId ? { person: { connect: { id: input.personId } } } : {}) }, select: { id: true, username: true, status: true, personId: true } });
    audit(principal.accountId, "account.create", "account", account.id);
    return reply.code(201).send({ data: account });
  });

  app.post("/api/roles", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = roleAssignmentCreateSchema.parse(request.body);
    const scopeId = input.scopeId ?? null;
    const organization = input.scopeType === "organization" && scopeId ? await prisma.organization.findUniqueOrThrow({ where: { id: scopeId }, select: { type: true } }) : null;
    const project = input.scopeType === "project" && scopeId ? await prisma.project.findUniqueOrThrow({ where: { id: scopeId }, select: { responsibleOrganizationId: true } }) : null;
    if (!canGrantScopedRole(principal, { role: input.role, scopeType: input.scopeType, scopeId, ...(organization ? { organizationType: organization.type } : {}), ...(project ? { projectResponsibleOrganizationId: project.responsibleOrganizationId } : {}) })) forbidden("无权授予该角色或范围");
    if (input.role === "field_reporter" && organization?.type !== "business_entity") throw Object.assign(new Error("野外项目报送人员只能设置在经营实体"), { statusCode: 409, code: "REPORTER_REQUIRES_BUSINESS_ENTITY" });
    const target = await prisma.account.findUniqueOrThrow({ where: { id: input.accountId }, select: { status: true, personId: true } });
    if (target.status !== "active" || !target.personId) throw Object.assign(new Error("只能为已启用且已关联人员的账号授权"), { statusCode: 409, code: "ROLE_TARGET_INVALID" });
    if (!isCompanyAdmin(principal) && input.role === "project_admin" && project && !await prisma.organizationMembership.findFirst({ where: { personId: target.personId, organizationId: project.responsibleOrganizationId, active: true, primary: true } })) {
      forbidden("经营实体负责人或管理员只能从本实体在用人员中设置项目管理员");
    }
    const role = await prisma.$transaction(async (tx) => {
      if (input.role === "org_leader" && scopeId) {
        const current = await tx.roleAssignment.findFirst({ where: { role: "org_leader", scopeType: "organization", scopeId, active: true } });
        if (current && current.accountId !== input.accountId) await revokeRole(tx, { roleId: current.id, actorId: principal.accountId, reason: "更换组织负责人" });
      }
      return grantRole(tx, { accountId: input.accountId, role: input.role, scopeType: input.scopeType, scopeId });
    });
    await auditCritical(principal.accountId, "role.grant", "role_assignment", role.id, { role: role.role, scopeType: role.scopeType, scopeId: role.scopeId }, "var/audit-fallback.ndjson");
    return reply.code(201).send({ data: role });
  });

  app.delete("/api/roles/:id", manager, async (request, reply) => {
    const principal = principalOf(request);
    const { id } = idParam.parse(request.params);
    const role = await prisma.roleAssignment.findUniqueOrThrow({ where: { id } });
    const organization = role.scopeType === "organization" && role.scopeId ? await prisma.organization.findUniqueOrThrow({ where: { id: role.scopeId }, select: { type: true } }) : null;
    const project = role.scopeType === "project" && role.scopeId ? await prisma.project.findUniqueOrThrow({ where: { id: role.scopeId }, select: { responsibleOrganizationId: true } }) : null;
    if (!canGrantScopedRole(principal, { role: role.role, scopeType: role.scopeType, scopeId: role.scopeId, ...(organization ? { organizationType: organization.type } : {}), ...(project ? { projectResponsibleOrganizationId: project.responsibleOrganizationId } : {}) })) forbidden("无权取消该角色或范围");
    await prisma.$transaction(async (tx) => {
      if (role.active && role.role === "company_admin" && await tx.roleAssignment.count({ where: { role: "company_admin", scopeType: "company", active: true } }) <= 1) {
        throw Object.assign(new Error("系统必须至少保留一名公司管理员"), { statusCode: 409, code: "LAST_COMPANY_ADMIN" });
      }
      await revokeRole(tx, { roleId: id, actorId: principal.accountId, reason: "管理员取消角色" });
    }, { isolationLevel: "Serializable" });
    await auditCritical(principal.accountId, "role.revoke", "role_assignment", id, undefined, "var/audit-fallback.ndjson");
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
