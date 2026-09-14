import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { auditCritical } from "../audit.js";
import { accessibleOrganizationIds, canAccessOrganization, canAccessPerson, canAccessProject, forbidden, isCompanyAdmin, projectScopeIds } from "../access.js";
import { decryptField, encryptField } from "../crypto.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
const idParam = z.object({ id: z.string().uuid() });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((value) => new Date(`${value}T00:00:00.000Z`));
const optionalDate = z.union([date, z.literal("").transform(() => undefined)]).optional();
const certificateInput = z.object({
  name: z.string().trim().min(2).max(160), category: z.string().trim().max(80).optional(),
  certificateNo: z.string().trim().max(120).optional(), issuingAuthority: z.string().trim().max(160).optional(),
  issuedAt: optionalDate, expiresAt: optionalDate, fileId: z.string().uuid().optional()
});

function certificateNumber(row: { certificateNoCipher: string | null; certificateNoIv: string | null; certificateNoTag: string | null }, env: Env) {
  return row.certificateNoCipher && row.certificateNoIv && row.certificateNoTag
    ? decryptField(row.certificateNoCipher, row.certificateNoIv, row.certificateNoTag, env) : null;
}

function encryptedNumber(value: string | undefined, env: Env) {
  if (!value) return {};
  const encrypted = encryptField(value, env);
  return { certificateNoCipher: encrypted.cipher, certificateNoIv: encrypted.iv, certificateNoTag: encrypted.tag, certificateNoLast4: value.slice(-4) };
}

const certificateFields = (input: z.infer<typeof certificateInput>) => ({
  name: input.name, category: input.category ?? null, issuingAuthority: input.issuingAuthority ?? null,
  issuedAt: input.issuedAt ?? null, expiresAt: input.expiresAt ?? null, fileId: input.fileId ?? null
});

function reportOrganizationIds(request: FastifyRequest) {
  return request.principal!.roles.filter((role) => ["org_leader", "org_admin", "field_reporter"].includes(role.role) && role.scopeType === "organization" && role.scopeId).map((role) => role.scopeId as string);
}

async function canSubmitProject(request: FastifyRequest, projectId: string) {
  const principal = request.principal!;
  if (isCompanyAdmin(principal) || projectScopeIds(principal).includes(projectId)) return true;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { responsibleOrganizationId: true } });
  return !!project && reportOrganizationIds(request).includes(project.responsibleOrganizationId);
}

const monthlyInput = z.object({
  projectId: z.string().uuid(), reportMonth: z.string().regex(/^\d{4}-\d{2}$/),
  progressSummary: z.string().trim().min(2).max(5000), onsiteCount: z.coerce.number().int().min(0),
  safetyHazardCount: z.coerce.number().int().min(0), rectifiedHazardCount: z.coerce.number().int().min(0),
  safetyInvestment: z.coerce.number().min(0), incidentCount: z.coerce.number().int().min(0),
  notes: z.string().trim().max(5000).optional(), status: z.enum(["draft", "submitted"]).default("submitted")
}).refine((value) => value.rectifiedHazardCount <= value.safetyHazardCount, { message: "已整改隐患数不能大于隐患总数", path: ["rectifiedHazardCount"] });

export async function registerSafetyManagementRoutes(app: FastifyInstance, deps: { env: Env; authenticate: Guard; requireManager: Guard }) {
  app.get("/api/me/certificates", { preHandler: deps.authenticate }, async (request) => {
    if (!request.principal!.personId) return { data: [] };
    const rows = await prisma.personCertificate.findMany({ where: { personId: request.principal!.personId, active: true }, orderBy: [{ expiresAt: "asc" }, { name: "asc" }] });
    return { data: rows.map((row) => ({ ...row, certificateNo: certificateNumber(row, deps.env), certificateNoCipher: undefined, certificateNoIv: undefined, certificateNoTag: undefined })) };
  });

  app.get("/api/persons/:id/details", { preHandler: [deps.authenticate, deps.requireManager] }, async (request) => {
    const { id } = idParam.parse(request.params); const principal = request.principal!;
    if (!await canAccessPerson(principal, id)) forbidden();
    const person = await prisma.person.findUniqueOrThrow({ where: { id }, include: {
      organizations: { where: { active: true }, include: { organization: true } },
      projectMemberships: { where: { status: "active" }, include: { project: { select: { id: true, name: true, code: true, status: true } } } },
      certificates: { where: { active: true }, orderBy: { expiresAt: "asc" } },
      assignments: { orderBy: { createdAt: "desc" }, take: 20, include: { batch: { select: { name: true, type: true } }, attempts: { where: { status: "submitted" }, orderBy: { submittedAt: "desc" }, take: 1 } } }
    } });
    await auditCritical(principal.accountId, "person.detail_read", "person", id, undefined, "var/audit-fallback.ndjson");
    return { data: { ...person, nationalIdCipher: undefined, nationalIdIv: undefined, nationalIdTag: undefined,
      certificates: person.certificates.map((row) => ({ ...row, certificateNo: certificateNumber(row, deps.env), certificateNoCipher: undefined, certificateNoIv: undefined, certificateNoTag: undefined })) } };
  });

  app.post("/api/persons/:id/certificates", { preHandler: [deps.authenticate, deps.requireManager] }, async (request, reply) => {
    const { id } = idParam.parse(request.params); const principal = request.principal!; const input = certificateInput.parse(request.body);
    if (!await canAccessPerson(principal, id)) forbidden();
    const row = await prisma.personCertificate.create({ data: { personId: id, ...certificateFields(input), ...encryptedNumber(input.certificateNo, deps.env) } });
    await auditCritical(principal.accountId, "person_certificate.create", "person_certificate", row.id, { personId: id }, "var/audit-fallback.ndjson");
    return reply.code(201).send({ data: { id: row.id } });
  });

  app.patch("/api/person-certificates/:id/retire", { preHandler: [deps.authenticate, deps.requireManager] }, async (request) => {
    const { id } = idParam.parse(request.params); const row = await prisma.personCertificate.findUniqueOrThrow({ where: { id }, select: { personId: true } });
    if (!await canAccessPerson(request.principal!, row.personId)) forbidden();
    await prisma.personCertificate.update({ where: { id }, data: { active: false } });
    await auditCritical(request.principal!.accountId, "person_certificate.retire", "person_certificate", id, undefined, "var/audit-fallback.ndjson");
    return { data: { id, active: false } };
  });

  app.get("/api/organization-qualifications", { preHandler: [deps.authenticate, deps.requireManager] }, async (request) => {
    const ids = isCompanyAdmin(request.principal!) ? undefined : await accessibleOrganizationIds(request.principal!);
    const rows = await prisma.organizationQualification.findMany({ where: { active: true, ...(ids ? { organizationId: { in: ids } } : {}) }, include: { organization: { select: { id: true, name: true } } }, orderBy: { expiresAt: "asc" } });
    return { data: rows.map((row) => ({ ...row, certificateNo: certificateNumber(row, deps.env), certificateNoCipher: undefined, certificateNoIv: undefined, certificateNoTag: undefined })) };
  });

  app.post("/api/organizations/:id/qualifications", { preHandler: [deps.authenticate, deps.requireManager] }, async (request, reply) => {
    const { id } = idParam.parse(request.params); const principal = request.principal!;
    if (!await canAccessOrganization(principal, id)) forbidden();
    const input = certificateInput.extend({ scope: z.string().trim().max(5000).optional() }).parse(request.body);
    const row = await prisma.organizationQualification.create({ data: { organizationId: id, ...certificateFields(input), scope: input.scope ?? null, ...encryptedNumber(input.certificateNo, deps.env) } });
    await auditCritical(principal.accountId, "organization_qualification.create", "organization_qualification", row.id, { organizationId: id }, "var/audit-fallback.ndjson");
    return reply.code(201).send({ data: { id: row.id } });
  });

  app.patch("/api/organization-qualifications/:id/retire", { preHandler: [deps.authenticate, deps.requireManager] }, async (request) => {
    const { id } = idParam.parse(request.params); const row = await prisma.organizationQualification.findUniqueOrThrow({ where: { id }, select: { organizationId: true } });
    if (!await canAccessOrganization(request.principal!, row.organizationId)) forbidden();
    await prisma.organizationQualification.update({ where: { id }, data: { active: false } });
    await auditCritical(request.principal!.accountId, "organization_qualification.retire", "organization_qualification", id, undefined, "var/audit-fallback.ndjson");
    return { data: { id, active: false } };
  });

  app.get("/api/monthly-reports", { preHandler: deps.authenticate }, async (request) => {
    const principal = request.principal!; const query = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(request.query);
    const directOrgIds = reportOrganizationIds(request); const projectIds = projectScopeIds(principal);
    if (!isCompanyAdmin(principal) && !directOrgIds.length && !projectIds.length) forbidden("无野外项目月报权限");
    const where: Prisma.ProjectMonthlyReportWhereInput = {
      ...(query.month ? { reportMonth: new Date(`${query.month}-01T00:00:00.000Z`) } : {}),
      ...(!isCompanyAdmin(principal) ? { OR: [{ reportingOrganizationId: { in: directOrgIds } }, { projectId: { in: projectIds } }] } : {})
    };
    return { data: await prisma.projectMonthlyReport.findMany({ where, include: { project: { select: { id: true, name: true, code: true } }, reportingOrganization: { select: { id: true, name: true } } }, orderBy: [{ reportMonth: "desc" }, { createdAt: "desc" }] }) };
  });

  app.get("/api/monthly-reports/projects", { preHandler: deps.authenticate }, async (request) => {
    const principal = request.principal!; const directOrgIds = reportOrganizationIds(request); const scopedProjects = projectScopeIds(principal);
    if (!isCompanyAdmin(principal) && !directOrgIds.length && !scopedProjects.length) forbidden("无野外项目月报权限");
    return { data: await prisma.project.findMany({ where: { status: { not: "ended" }, ...(!isCompanyAdmin(principal) ? { OR: [{ responsibleOrganizationId: { in: directOrgIds } }, { id: { in: scopedProjects } }] } : {}) }, select: { id: true, name: true, code: true, responsibleOrganizationId: true }, orderBy: { name: "asc" } }) };
  });

  app.get("/api/monthly-reports/summary", { preHandler: deps.authenticate }, async (request) => {
    const month = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(request.query).month;
    const principal = request.principal!; const directOrgIds = reportOrganizationIds(request); const scopedProjects = projectScopeIds(principal);
    if (!isCompanyAdmin(principal) && !directOrgIds.length && !scopedProjects.length) forbidden("无野外项目月报权限");
    const projects = await prisma.project.findMany({ where: { status: { not: "ended" }, ...(!isCompanyAdmin(principal) ? { OR: [{ responsibleOrganizationId: { in: directOrgIds } }, { id: { in: scopedProjects } }] } : {}) }, select: { id: true, name: true, code: true, responsibleOrganization: { select: { name: true } } }, orderBy: { name: "asc" } });
    const reports = await prisma.projectMonthlyReport.findMany({ where: { reportMonth: new Date(`${month}-01T00:00:00.000Z`), projectId: { in: projects.map((row) => row.id) } }, select: { projectId: true, status: true } });
    const status = new Map(reports.map((row) => [row.projectId, row.status])); const rows = projects.map((project) => ({ ...project, reportStatus: status.get(project.id) ?? "missing" }));
    return { data: { month, projectCount: rows.length, submittedCount: rows.filter((row) => row.reportStatus === "submitted").length, draftCount: rows.filter((row) => row.reportStatus === "draft").length, missingCount: rows.filter((row) => row.reportStatus === "missing").length, projects: rows } };
  });

  app.post("/api/monthly-reports", { preHandler: deps.authenticate }, async (request, reply) => {
    const principal = request.principal!; const input = monthlyInput.parse(request.body);
    if (!await canSubmitProject(request, input.projectId)) forbidden("无权报送该项目月报");
    const project = await prisma.project.findUniqueOrThrow({ where: { id: input.projectId }, select: { responsibleOrganizationId: true } });
    const reportMonth = new Date(`${input.reportMonth}-01T00:00:00.000Z`); const submitted = input.status === "submitted";
    const row = await prisma.projectMonthlyReport.upsert({
      where: { projectId_reportMonth: { projectId: input.projectId, reportMonth } },
      create: { ...input, notes: input.notes ?? null, reportMonth, reportingOrganizationId: project.responsibleOrganizationId, updatedBy: principal.accountId, submittedBy: submitted ? principal.accountId : null, submittedAt: submitted ? new Date() : null },
      update: { ...input, notes: input.notes ?? null, reportMonth, updatedBy: principal.accountId, submittedBy: submitted ? principal.accountId : null, submittedAt: submitted ? new Date() : null }
    });
    await auditCritical(principal.accountId, "project_monthly_report.upsert", "project_monthly_report", row.id, { projectId: input.projectId, reportMonth: input.reportMonth, status: input.status }, "var/audit-fallback.ndjson");
    return reply.code(201).send({ data: row });
  });

  app.get("/api/monthly-reports.csv", { preHandler: deps.authenticate }, async (request, reply) => {
    const principal = request.principal!; const directOrgIds = reportOrganizationIds(request); const projectIds = projectScopeIds(principal);
    if (!isCompanyAdmin(principal) && !directOrgIds.length && !projectIds.length) forbidden("无野外项目月报权限");
    const rows = await prisma.projectMonthlyReport.findMany({ where: isCompanyAdmin(principal) ? {} : { OR: [{ reportingOrganizationId: { in: directOrgIds } }, { projectId: { in: projectIds } }] }, include: { project: true, reportingOrganization: true }, orderBy: { reportMonth: "desc" } });
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = ["月份,项目编号,项目名称,报送部门,现场人数,隐患数,已整改数,安全投入,事故数,状态", ...rows.map((row) => [row.reportMonth.toISOString().slice(0, 7), row.project.code, row.project.name, row.reportingOrganization.name, row.onsiteCount, row.safetyHazardCount, row.rectifiedHazardCount, row.safetyInvestment, row.incidentCount, row.status].map(escape).join(","))].join("\r\n");
    return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", "attachment; filename=project-monthly-reports.csv").send(`\uFEFF${csv}`);
  });
}
