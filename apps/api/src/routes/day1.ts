import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import argon2 from "argon2";
import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";
import {
  loginSchema, organizationCreateSchema, personCreateSchema, projectCreateSchema, roleAssignmentCreateSchema
} from "@safety/contracts";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { audit, auditCritical } from "../audit.js";
import { accessibleOrganizationIds, canAccessOrganization, canAccessPerson, canAccessProject, forbidden, isCompanyAdmin, organizationScopeIds, projectScopeIds } from "../access.js";
import { decryptNationalId } from "../crypto.js";
import { createPerson, maskPerson, personSafeSelect, type PersonInput } from "../people.js";
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

async function importRows(buffer: Buffer, filename: string): Promise<Record<string, unknown>[]> {
  if (/\.csv$/i.test(filename)) return parseCsv(buffer, { columns: true, skip_empty_lines: true, bom: true, trim: true }) as Record<string, unknown>[];
  if (!/\.xlsx$/i.test(filename)) throw Object.assign(new Error("仅支持 CSV 或 XLSX"), { statusCode: 400, code: "UNSUPPORTED_IMPORT" });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
  const rows: Record<string, unknown>[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const values = (row.values as unknown[]).slice(1);
    rows.push(Object.fromEntries(headers.map((header, i) => [header, values[i]])));
  });
  return rows;
}

const rowValue = (row: Record<string, unknown>, ...keys: string[]) => {
  const value = keys.map((key) => row[key]).find((item) => item !== undefined && item !== null);
  return value == null ? "" : String(value).trim();
};

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
    reply.clearCookie("safety_session", { path: "/" });
    audit(principalOf(request).accountId, "auth.logout", "account", principalOf(request).accountId);
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
    return { data: await prisma.organization.findMany({
      where: isCompanyAdmin(principal) ? {} : { id: { in: await accessibleOrganizationIds(principal) } },
      orderBy: { name: "asc" }
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
    audit(principal.accountId, "person.sensitive_read", "person", id);
    return { data: { nationalId: decryptNationalId(person.nationalIdCipher, person.nationalIdIv, person.nationalIdTag, deps.env) } };
  });

  app.patch("/api/persons/:id/status", manager, async (request) => {
    const principal = principalOf(request);
    const { id } = idParam.parse(request.params);
    if (!await canAccessPerson(principal, id)) forbidden();
    const status = z.object({ status: z.enum(["active", "disabled"]) }).parse(request.body).status;
    const person = await prisma.$transaction(async (tx) => {
      const updated = await tx.person.update({ where: { id }, data: { status }, select: personSafeSelect });
      if (status === "disabled") await tx.account.updateMany({ where: { personId: id }, data: { status: "disabled" } });
      return updated;
    });
    audit(principal.accountId, "person.status_change", "person", id, { status });
    if (status === "active" && person.type === "employee") await autoDispatch("three_level", id);
    return { data: maskPerson(person) };
  });

  app.post("/api/persons/import", manager, async (request, reply) => {
    const principal = principalOf(request);
    const file = await request.file({ limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
    if (!file) throw Object.assign(new Error("请选择导入文件"), { statusCode: 400, code: "FILE_REQUIRED" });
    const rows = await importRows(await file.toBuffer(), file.filename);
    if (!rows.length || rows.length > 1000) throw Object.assign(new Error("导入行数必须为 1-1000"), { statusCode: 400, code: "INVALID_ROW_COUNT" });
    const created = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const row of rows) {
        const parsed = personCreateSchema.parse({
          name: rowValue(row, "name", "姓名"), phone: rowValue(row, "phone", "手机号"), type: rowValue(row, "type", "人员类型"),
          organizationId: rowValue(row, "organizationId", "组织ID"), nationalId: rowValue(row, "nationalId", "身份证号码"), photoFileId: rowValue(row, "photoFileId", "照片文件ID")
        });
        results.push(await createPerson(parsed as PersonInput, principal, deps.env, tx));
      }
      return results;
    });
    audit(principal.accountId, "person.import", "person", undefined, { count: created.length });
    return reply.code(201).send({ data: { count: created.length, persons: created.map(maskPerson) } });
  });

  app.get("/api/accounts", manager, async (request) => {
    const principal = principalOf(request);
    const roles = isCompanyAdmin(principal) ? undefined : { some: { active: true, OR: [
      { scopeType: "organization" as const, scopeId: { in: await accessibleOrganizationIds(principal) } },
      { scopeType: "project" as const, scopeId: { in: projectScopeIds(principal) } }
    ] } };
    return { data: await prisma.account.findMany({ where: roles ? { roles } : {}, select: { id: true, username: true, status: true, personId: true, roles: true, createdAt: true } }) };
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
    const role = await prisma.roleAssignment.create({ data: { ...input, scopeId: input.scopeId ?? null } });
    await auditCritical(principal.accountId, "role.grant", "role_assignment", role.id, { role: role.role, scopeType: role.scopeType, scopeId: role.scopeId }, "var/audit-fallback.ndjson");
    return reply.code(201).send({ data: role });
  });

  app.delete("/api/roles/:id", manager, async (request, reply) => {
    const principal = principalOf(request);
    const { id } = idParam.parse(request.params);
    const role = await prisma.roleAssignment.findUniqueOrThrow({ where: { id } });
    if (role.scopeType === "company" && !isCompanyAdmin(principal)) forbidden();
    if (role.scopeType === "organization" && (!role.scopeId || !await canAccessOrganization(principal, role.scopeId))) forbidden();
    if (role.scopeType === "project" && (!role.scopeId || !await canAccessProject(principal, role.scopeId))) forbidden();
    await prisma.roleAssignment.update({ where: { id }, data: { active: false } });
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
    await autoDispatch("project_induction", personId, id);
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
    if (status === "active") await autoDispatch("project_induction", member.personId, member.projectId);
    return { data: updated };
  });
}
