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
import { issueAccessToken, issueSession, rotateRefreshToken, type Principal } from "../auth.js";
import { autoDispatch } from "./day2.js";

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
      [...leaders, ...admins].forEach((item) => reporters.set(item.personId, { ...item, roleId: null, inherited: true }));
      return { ...organization, memberCount: _count.memberships, leaders, admins, reporters: [...reporters.values()] };
    }) };
  });

  app.post("/api/organizations", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = organizationCreateSchema.parse(request.body);
    if (!isCompanyAdmin(principal) && (!input.parentId || !await canAccessOrganization(principal, input.parentId))) forbidden();
    const organization = await prisma.organization.create({ data: { name: input.name, type: input.type, ...(input.parentId ? { parent: { connect: { id: input.parentId } } } : {}) } });
    audit(principal.accountId, "organization.create", "organization", organization.id);
    return reply.code(201).send({ data: organization });
  });

  app.patch("/api/organizations/:id", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    if (!await canAccessOrganization(principal, id)) forbidden();
    const input = organizationCreateSchema.partial().refine((value) => Object.keys(value).length > 0, "至少填写一项").parse(request.body);
    const current = await prisma.organization.findUniqueOrThrow({ where: { id } });
    if (!isCompanyAdmin(principal) && (input.type !== undefined || input.parentId !== undefined)) forbidden("组织管理员只能修改本范围组织名称");
    if (current.type === "company" && (input.type && input.type !== "company" || input.parentId)) throw Object.assign(new Error("公司根组织不能更改类型或设置上级"), { statusCode: 409, code: "COMPANY_ROOT_IMMUTABLE" });
    if (input.parentId) {
      if (!await canAccessOrganization(principal, input.parentId)) forbidden();
      let parentId: string | null = input.parentId;
      while (parentId) {
        if (parentId === id) throw Object.assign(new Error("上级组织不能形成循环关系"), { statusCode: 409, code: "ORGANIZATION_CYCLE" });
        parentId = (await prisma.organization.findUnique({ where: { id: parentId }, select: { parentId: true } }))?.parentId ?? null;
      }
    }
    const organization = await prisma.organization.update({ where: { id }, data: { ...(input.name ? { name: input.name } : {}), ...(input.type ? { type: input.type } : {}), ...(input.parentId !== undefined ? { parentId: input.parentId } : {}) } });
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
    if (!await canAccessOrganization(principal, id)) forbidden();
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id }, select: { type: true } });
    if (!["department", "business_entity"].includes(organization.type)) throw Object.assign(new Error("该权限只能设置在部门或经营实体"), { statusCode: 409, code: "INVALID_ORGANIZATION_ROLE_SCOPE" });
    if (!isCompanyAdmin(principal) && input.role !== "field_reporter") forbidden("只有公司管理员可以设置部门负责人或部门管理员");
    const person = await prisma.person.findFirst({ where: { id: input.personId, status: "active", organizations: { some: { organizationId: id, active: true } } }, select: { id: true } });
    if (!person) throw Object.assign(new Error("只能设置该部门的在职人员"), { statusCode: 409, code: "PERSON_NOT_IN_ORGANIZATION" });
    const account = await prisma.account.upsert({ where: { personId: input.personId }, create: { personId: input.personId, status: "active" }, update: {} });
    const role = await prisma.roleAssignment.upsert({
      where: { accountId_role_scopeType_scopeId: { accountId: account.id, role: input.role, scopeType: "organization", scopeId: id } },
      create: { accountId: account.id, role: input.role, scopeType: "organization", scopeId: id }, update: { active: true }
    });
    await auditCritical(principal.accountId, "organization.role_grant", "role_assignment", role.id, { organizationId: id, personId: input.personId, role: input.role }, "var/audit-fallback.ndjson");
    return reply.code(201).send({ data: role });
  });

  app.delete("/api/organizations/:id/roles/:roleId", manager, async (request, reply) => {
    const principal = principalOf(request); const input = z.object({ id: z.string().uuid(), roleId: z.string().uuid() }).parse(request.params);
    if (!await canAccessOrganization(principal, input.id)) forbidden();
    const role = await prisma.roleAssignment.findUniqueOrThrow({ where: { id: input.roleId } });
    if (role.scopeType !== "organization" || role.scopeId !== input.id || !["org_leader", "org_admin", "field_reporter"].includes(role.role)) forbidden();
    if (!isCompanyAdmin(principal) && role.role !== "field_reporter") forbidden("只有公司管理员可以取消部门负责人或部门管理员");
    await prisma.roleAssignment.update({ where: { id: role.id }, data: { active: false } });
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
    if (!await canAccessOrganization(principal, input.responsibleOrganizationId)) forbidden();
    const project = await prisma.project.create({ data: input });
    audit(principal.accountId, "project.create", "project", project.id);
    return reply.code(201).send({ data: project });
  });

  app.patch("/api/projects/:id/status", manager, async (request) => {
    const principal = principalOf(request);
    const { id } = idParam.parse(request.params);
    if (!await canAccessProject(principal, id)) forbidden();
    const status = z.object({ status: z.enum(["active", "paused", "ended"]) }).parse(request.body).status;
    const current = await prisma.project.findUniqueOrThrow({ where: { id } });
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
    if (input.organizationId && !await canAccessOrganization(principal, input.organizationId)) forbidden();
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
        await tx.organizationMembership.updateMany({ where: { personId: id, active: true }, data: { primary: false } });
        await tx.organizationMembership.upsert({ where: { personId_organizationId: { personId: id, organizationId: input.organizationId } }, create: { personId: id, organizationId: input.organizationId, primary: true }, update: { active: true, primary: true } });
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
    const status = z.object({ status: z.enum(["active", "disabled"]) }).parse(request.body).status;
    const person = await prisma.$transaction(async (tx) => {
      const updated = await tx.person.update({ where: { id }, data: { status }, select: personSafeSelect });
      if (status === "disabled") { await tx.account.updateMany({ where: { personId: id }, data: { status: "disabled", sessionVersion: { increment: 1 } } }); await tx.refreshSession.updateMany({ where: { account: { personId: id }, revokedAt: null }, data: { revokedAt: new Date() } }); }
      else await tx.account.updateMany({ where: { personId: id }, data: { status: "active" } });
      return updated;
    });
    audit(principal.accountId, "person.status_change", "person", id, { status });
    if (status === "active" && person.type === "employee") await autoDispatch("three_level", id, deps.env);
    return { data: maskPerson(person) };
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
    if (!isCompanyAdmin(principal)) {
      if (input.role !== "field_reporter" || input.scopeType !== "organization" || !input.scopeId) forbidden("部门管理员只能设置本部门野外项目报送人员");
      const target = await prisma.account.findUniqueOrThrow({ where: { id: input.accountId }, select: { personId: true } });
      if (!target.personId || !await canAccessPerson(principal, target.personId)) forbidden("只能为本范围人员授权");
    }
    if (input.role === "company_admin" || input.scopeType === "company") {
      if (!isCompanyAdmin(principal)) forbidden();
    } else if (input.scopeType === "organization") {
      if (!input.scopeId || !await canAccessOrganization(principal, input.scopeId)) forbidden();
    } else if (input.scopeType === "project") {
      if (!input.scopeId || !await canAccessProject(principal, input.scopeId)) forbidden();
    } else if (input.scopeType === "person") {
      if (!input.scopeId || !await canAccessPerson(principal, input.scopeId)) forbidden();
    }
    const existing = await prisma.roleAssignment.findFirst({ where: { accountId: input.accountId, role: input.role, scopeType: input.scopeType, scopeId: input.scopeId ?? null } });
    const role = existing ? await prisma.roleAssignment.update({ where: { id: existing.id }, data: { active: true } }) : await prisma.roleAssignment.create({ data: { ...input, scopeId: input.scopeId ?? null } });
    await auditCritical(principal.accountId, "role.grant", "role_assignment", role.id, { role: role.role, scopeType: role.scopeType, scopeId: role.scopeId }, "var/audit-fallback.ndjson");
    return reply.code(201).send({ data: role });
  });

  app.delete("/api/roles/:id", manager, async (request, reply) => {
    const principal = principalOf(request);
    const { id } = idParam.parse(request.params);
    const role = await prisma.roleAssignment.findUniqueOrThrow({ where: { id } });
    if (!isCompanyAdmin(principal) && role.role !== "field_reporter") forbidden("部门管理员只能取消本部门野外项目报送人员");
    if (role.scopeType === "company" && !isCompanyAdmin(principal)) forbidden();
    if (role.scopeType === "organization" && (!role.scopeId || !await canAccessOrganization(principal, role.scopeId))) forbidden();
    if (role.scopeType === "project" && (!role.scopeId || !await canAccessProject(principal, role.scopeId))) forbidden();
    if (role.scopeType === "person" && (!role.scopeId || !await canAccessPerson(principal, role.scopeId))) forbidden();
    await prisma.$transaction(async (tx) => {
      if (role.active && role.role === "company_admin" && await tx.roleAssignment.count({ where: { role: "company_admin", scopeType: "company", active: true } }) <= 1) {
        throw Object.assign(new Error("系统必须至少保留一名公司管理员"), { statusCode: 409, code: "LAST_COMPANY_ADMIN" });
      }
      await tx.roleAssignment.update({ where: { id }, data: { active: false } });
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
    const updated = await prisma.projectMember.update({ where: { id }, data: { status, reviewedBy: principal.accountId, reviewedAt: new Date() } });
    audit(principal.accountId, "project_member.review", "project_member", id, { status, note: input.note });
    if (status === "active") await autoDispatch("project_induction", member.personId, deps.env, member.projectId);
    return { data: updated };
  });
}
