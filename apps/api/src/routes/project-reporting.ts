import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { auditCritical } from "../audit.js";
import { forbidden, isCompanyAdmin, projectScopeIds } from "../access.js";
import {
  reportStats,
  validateReportFields,
} from "../project-reporting-core.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
const id = z.string().uuid();
const month = z.string().regex(/^\d{4}-\d{2}$/);
const reportMonth = (value: string) => new Date(`${value}-01T00:00:00.000Z`);
const orgReportRoles = new Set(["org_leader", "org_admin", "field_reporter"]);
function reportOrganizationIds(request: FastifyRequest) {
  return request
    .principal!.roles.filter(
      (role) =>
        orgReportRoles.has(role.role) &&
        role.scopeType === "organization" &&
        role.scopeId &&
        role.organizationType === "business_entity",
    )
    .map((role) => role.scopeId as string);
}
function requireCompanyAdmin(request: FastifyRequest) {
  if (!isCompanyAdmin(request.principal!))
    forbidden("仅公司管理员可以维护报送配置");
}
function canRead(request: FastifyRequest) {
  const allowed =
    isCompanyAdmin(request.principal!) ||
    reportOrganizationIds(request).length ||
    projectScopeIds(request.principal!).length;
  if (!allowed) forbidden("无野外项目报送权限");
}
async function canWriteProject(request: FastifyRequest, projectId: string) {
  if (isCompanyAdmin(request.principal!)) return true;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { responsibleOrganizationId: true, status: true },
  });
  return (
    !!project &&
    project.status !== "ended" &&
    (projectScopeIds(request.principal!).includes(projectId) ||
      reportOrganizationIds(request).includes(
        project.responsibleOrganizationId,
      ))
  );
}
async function canWriteReport(request: FastifyRequest, reportId: string) {
  const row = await prisma.projectMonthlyReport.findUnique({
    where: { id: reportId },
    select: { projectId: true },
  });
  return !!row && canWriteProject(request, row.projectId);
}
function visibleWhere(
  request: FastifyRequest,
): Prisma.ProjectMonthlyReportWhereInput {
  const orgIds = reportOrganizationIds(request);
  const projectIds = projectScopeIds(request.principal!);
  return isCompanyAdmin(request.principal!)
    ? {}
    : {
        OR: [
          { reportingOrganizationId: { in: orgIds } },
          { projectId: { in: projectIds } },
        ],
      };
}

const inputFields = z.object({
  projectId: id,
  reportMonth: month,
  projectTypeId: id.optional(),
  constructionLocation: z.string().trim().max(300).optional(),
  contractAmount: z.coerce.number().min(0).default(0),
  durationMonths: z.coerce.number().int().min(0).optional(),
  departmentEntity: z.string().trim().max(160).optional(),
  projectManager: z.string().trim().max(80).optional(),
  contactInfo: z.string().trim().max(120).optional(),
  overallProgress: z.string().trim().max(5000).optional(),
  monthlyConstructionStatus: z.string().trim().max(5000).optional(),
  equipmentModels: z.string().trim().max(5000).optional(),
  onsiteCount: z.coerce.number().int().min(0).default(0),
  onsiteVehicles: z.coerce.number().int().min(0).default(0),
  safetyInspection: z.boolean().default(false),
  safetyHazards: z.boolean().default(false),
  safetyHazardDetail: z.string().trim().max(5000).optional(),
  safetyInvestment: z.coerce.number().min(0).default(0),
  incidentCount: z.coerce.number().int().min(0).default(0),
  projectStatus: z.enum(["active", "completed"]).default("active"),
  notes: z.string().trim().max(5000).optional(),
  customData: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .default({}),
});
const input = inputFields;
const fieldInput = z
  .object({
    label: z.string().trim().min(1).max(120),
    fieldType: z.enum(["text", "number", "textarea", "select", "date"]),
    options: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
    required: z.boolean().default(false),
    sortOrder: z.coerce.number().int().min(0).max(9999),
    active: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.fieldType === "select" && !value.options.length)
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "下拉字段至少需要一个选项",
      });
  });
const include = {
  project: { select: { id: true, name: true, code: true, status: true } },
  reportingOrganization: { select: { id: true, name: true } },
  projectType: true,
} as const;
function configuredValues(
  value: z.infer<typeof input>,
  projectName: string,
): Record<string, string | number | boolean | null | undefined> {
  return {
    project_name: projectName,
    project_type_id: value.projectTypeId,
    construction_location: value.constructionLocation,
    contract_amount: value.contractAmount,
    duration_months: value.durationMonths,
    department_entity: value.departmentEntity,
    project_manager: value.projectManager,
    contact_info: value.contactInfo,
    overall_progress: value.overallProgress,
    monthly_construction_status: value.monthlyConstructionStatus,
    equipment_models: value.equipmentModels,
    onsite_count: value.onsiteCount,
    onsite_vehicles: value.onsiteVehicles,
    safety_inspection: value.safetyInspection ? "是" : "否",
    safety_hazards: value.safetyHazards ? "是" : "否",
    safety_hazard_detail: value.safetyHazardDetail,
    ...value.customData,
  };
}

export async function registerProjectReportingRoutes(
  app: FastifyInstance,
  deps: { authenticate: Guard },
) {
  app.get(
    "/api/monthly-reports/capabilities",
    { preHandler: deps.authenticate },
    async (request) => ({
      data: {
        canConfigure: isCompanyAdmin(request.principal!),
        canSubmit:
          isCompanyAdmin(request.principal!) ||
          !!reportOrganizationIds(request).length ||
          !!projectScopeIds(request.principal!).length,
        organizationIds: reportOrganizationIds(request),
      },
    }),
  );
  app.get(
    "/api/monthly-reports/projects",
    { preHandler: deps.authenticate },
    async (request) => {
      canRead(request);
      const orgIds = reportOrganizationIds(request);
      const projectIds = projectScopeIds(request.principal!);
      return {
        data: await prisma.project.findMany({
          where: {
            ...(isCompanyAdmin(request.principal!)
              ? {}
              : {
                  OR: [
                    { responsibleOrganizationId: { in: orgIds } },
                    { id: { in: projectIds } },
                  ],
                }),
          },
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
            responsibleOrganizationId: true,
            responsibleOrganization: { select: { id: true, name: true } },
          },
          orderBy: { name: "asc" },
        }),
      };
    },
  );
  app.get(
    "/api/monthly-reports",
    { preHandler: deps.authenticate },
    async (request) => {
      canRead(request);
      const query = z
        .object({
          year: z.coerce.number().int().min(2000).max(9999).optional(),
          month: z.coerce.number().int().min(1).max(12).optional(),
          projectStatus: z.enum(["active", "completed"]).optional(),
          status: z.enum(["submitted", "withdrawn", "voided"]).optional(),
          keyword: z.string().trim().max(120).optional(),
        })
        .parse(request.query);
      const start = query.year
        ? new Date(Date.UTC(query.year, (query.month ?? 1) - 1, 1))
        : undefined;
      const end = query.year
        ? new Date(
            Date.UTC(
              query.month ? query.year : query.year + 1,
              query.month ? query.month : 0,
              1,
            ),
          )
        : undefined;
      const rows = await prisma.projectMonthlyReport.findMany({
        where: {
          ...visibleWhere(request),
          status: query.status ?? { not: "voided" },
          ...(start && end ? { reportMonth: { gte: start, lt: end } } : {}),
          ...(query.projectStatus
            ? { projectStatus: query.projectStatus }
            : {}),
        },
        include: {
          ...include,
          attachments: {
            include: {
              file: {
                select: {
                  id: true,
                  originalName: true,
                  mimeType: true,
                  size: true,
                },
              },
            },
          },
          revisions: { orderBy: { revision: "desc" }, take: 20 },
        },
        orderBy: [{ reportMonth: "desc" }, { submittedAt: "desc" }],
      });
      return {
        data: rows.filter(
          (row) =>
            !query.keyword ||
            [
              row.project.name,
              row.constructionLocation,
              row.projectType?.name,
            ].some((value) => value?.includes(query.keyword!)),
        ),
      };
    },
  );
  app.get(
    "/api/monthly-reports/summary",
    { preHandler: deps.authenticate },
    async (request) => {
      canRead(request);
      const value = month.parse((request.query as { month?: string }).month);
      const date = reportMonth(value);
      const next = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
      );
      const visible = visibleWhere(request);
      const [organizations, reports, confirmations] = await Promise.all([
        prisma.organization.findMany({
          where: {
            type: "business_entity",
            reportingEnabled: true,
            ...(isCompanyAdmin(request.principal!)
              ? {}
              : { id: { in: reportOrganizationIds(request) } }),
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        prisma.projectMonthlyReport.findMany({
          where: {
            ...visible,
            status: "submitted",
            reportMonth: { gte: date, lt: next },
          },
          include,
        }),
        prisma.departmentMonthStatus.findMany({
          where: {
            active: true,
            reportingYear: date.getUTCFullYear(),
            reportingMonth: date.getUTCMonth() + 1,
            ...(isCompanyAdmin(request.principal!)
              ? {}
              : { organizationId: { in: reportOrganizationIds(request) } }),
          },
        }),
      ]);
      const stats = reportStats(
        organizations,
        reports,
        confirmations
          .filter((row) => row.noFieldProjects)
          .map((row) => row.organizationId),
      );
      const byOrg = new Map<string, typeof reports>();
      reports.forEach((row) =>
        byOrg.set(row.reportingOrganizationId, [
          ...(byOrg.get(row.reportingOrganizationId) ?? []),
          row,
        ]),
      );
      const noField = new Set(
        confirmations
          .filter((row) => row.noFieldProjects)
          .map((row) => row.organizationId),
      );
      return {
        data: {
          month: value,
          stats,
          departments: organizations.map((org) => ({
            ...org,
            status:
              (byOrg.get(org.id)?.length ?? 0)
                ? "submitted"
                : noField.has(org.id)
                  ? "no_field"
                  : "missing",
            reportCount: byOrg.get(org.id)?.length ?? 0,
            latestSubmittedAt:
              byOrg
                .get(org.id)
                ?.map((row) => row.submittedAt)
                .filter(Boolean)
                .sort()
                .at(-1) ?? null,
          })),
          reports,
        },
      };
    },
  );
  app.get(
    "/api/monthly-reports/projects/:id/history",
    { preHandler: deps.authenticate },
    async (request) => {
      canRead(request);
      const projectId = id.parse((request.params as { id: string }).id);
      const rows = await prisma.projectMonthlyReport.findMany({
        where: { ...visibleWhere(request), projectId },
        include,
        orderBy: { reportMonth: "asc" },
      });
      return { data: rows };
    },
  );
  app.post(
    "/api/monthly-reports",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      const body = input
        .extend({ fileIds: z.array(id).max(20).default([]) })
        .parse(request.body);
      const { fileIds, ...parsed } = body;
      if (!(await canWriteProject(request, parsed.projectId)))
        forbidden("无权报送该项目");
      const [fields, project] = await Promise.all([
        prisma.reportField.findMany({ orderBy: { sortOrder: "asc" } }),
        prisma.project.findUniqueOrThrow({
          where: { id: parsed.projectId },
          include: {
            responsibleOrganization: { select: { id: true, name: true } },
          },
        }),
      ]);
      const errors = validateReportFields(
        configuredValues(parsed, project.name),
        fields,
      );
      if (errors.length)
        throw Object.assign(new Error(errors.join("；")), {
          statusCode: 400,
          code: "REPORT_VALIDATION_FAILED",
        });
      if (
        fileIds.length !==
        (await prisma.privateFile.count({
          where: {
            id: { in: fileIds },
            kind: "attachment",
            uploadedBy: request.principal!.accountId,
          },
        }))
      )
        forbidden("月报附件无效");
      const date = reportMonth(parsed.reportMonth);
      const values = configuredValues(parsed, project.name);
      const data = {
        ...parsed,
        progressSummary:
          parsed.monthlyConstructionStatus ||
          parsed.overallProgress ||
          "未填写",
        constructionLocation: parsed.constructionLocation ?? null,
        projectManager: parsed.projectManager ?? null,
        monthlyConstructionStatus: parsed.monthlyConstructionStatus ?? null,
        reportMonth: date,
        reportingOrganizationId: project.responsibleOrganizationId,
        status: "submitted" as const,
        projectSnapshot: {
          id: project.id,
          name: project.name,
          code: project.code,
          responsibleOrganization: project.responsibleOrganization,
          projectType: project.projectType,
          location: project.location,
          contractAmount: project.contractAmount,
          plannedStartAt: project.plannedStartAt,
          plannedEndAt: project.plannedEndAt,
          managerName: project.managerName,
          managerPhone: project.managerPhone,
        },
        fieldSnapshot: fields.map((field) => ({
          key: field.fieldKey,
          label: field.label,
          sortOrder: field.sortOrder,
          value: values[field.fieldKey] ?? null,
        })),
        submittedBy: request.principal!.accountId,
        submittedAt: new Date(),
        updatedBy: request.principal!.accountId,
        projectTypeId: parsed.projectTypeId ?? null,
        durationMonths: parsed.durationMonths ?? null,
        departmentEntity: parsed.departmentEntity ?? null,
        contactInfo: parsed.contactInfo ?? null,
        overallProgress: parsed.overallProgress ?? null,
        equipmentModels: parsed.equipmentModels ?? null,
        safetyHazardDetail: parsed.safetyHazardDetail ?? null,
        notes: parsed.notes ?? null,
        attachments: {
          create: fileIds.map((fileId) => ({
            fileId,
            createdBy: request.principal!.accountId,
          })),
        },
      } as Prisma.ProjectMonthlyReportUncheckedCreateInput;
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.projectMonthlyReport.create({ data });
        await tx.departmentMonthStatus.updateMany({
          where: {
            organizationId: project.responsibleOrganizationId,
            reportingYear: date.getUTCFullYear(),
            reportingMonth: date.getUTCMonth() + 1,
            active: true,
          },
          data: {
            active: false,
            invalidatedAt: new Date(),
            invalidatedBy: request.principal!.accountId,
            invalidReason: "当月新增有效月报",
          },
        });
        return created;
      });
      await auditCritical(
        request.principal!.accountId,
        "project_monthly_report.create",
        "project_monthly_report",
        row.id,
        { projectId: row.projectId, reportMonth: parsed.reportMonth },
        "var/audit-fallback.ndjson",
      );
      return reply.code(201).send({ data: row });
    },
  );
  app.patch(
    "/api/monthly-reports/:id",
    { preHandler: deps.authenticate },
    async (request) => {
      const reportId = id.parse((request.params as { id: string }).id);
      if (!(await canWriteReport(request, reportId)))
        forbidden("只能编辑本范围报送");
      const parsed = input
        .omit({ projectId: true, reportMonth: true })
        .extend({ reason: z.string().trim().min(2).max(500) })
        .parse(request.body);
      const { reason, ...changes } = parsed;
      const current = await prisma.projectMonthlyReport.findUniqueOrThrow({
        where: { id: reportId },
        include: { project: { select: { name: true } } },
      });
      if (current.status === "voided")
        throw Object.assign(new Error("作废月报只读保留"), {
          statusCode: 409,
          code: "REPORT_VOIDED",
        });
      const complete = {
        ...changes,
        projectId: current.projectId,
        reportMonth: current.reportMonth.toISOString().slice(0, 7),
      };
      const fields = await prisma.reportField.findMany();
      const errors = validateReportFields(
        configuredValues(complete, current.project.name),
        fields,
      );
      if (errors.length)
        throw Object.assign(new Error(errors.join("；")), {
          statusCode: 400,
          code: "REPORT_VALIDATION_FAILED",
        });
      const data = {
        ...changes,
        progressSummary:
          changes.monthlyConstructionStatus ||
          changes.overallProgress ||
          "未填写",
        constructionLocation: changes.constructionLocation ?? null,
        projectManager: changes.projectManager ?? null,
        monthlyConstructionStatus: changes.monthlyConstructionStatus ?? null,
        updatedBy: request.principal!.accountId,
        projectTypeId: changes.projectTypeId ?? null,
        durationMonths: changes.durationMonths ?? null,
        departmentEntity: changes.departmentEntity ?? null,
        contactInfo: changes.contactInfo ?? null,
        overallProgress: changes.overallProgress ?? null,
        equipmentModels: changes.equipmentModels ?? null,
        safetyHazardDetail: changes.safetyHazardDetail ?? null,
        notes: changes.notes ?? null,
        revision: { increment: 1 },
      } as Prisma.ProjectMonthlyReportUncheckedUpdateInput;
      const row = await prisma.$transaction(async (tx) => {
        await tx.projectMonthlyReportRevision.create({
          data: {
            reportId,
            revision: current.revision,
            beforeSnapshot: current as unknown as Prisma.InputJsonValue,
            changedBy: request.principal!.accountId,
            reason,
          },
        });
        return tx.projectMonthlyReport.update({
          where: { id: reportId },
          data,
        });
      });
      await auditCritical(
        request.principal!.accountId,
        "project_monthly_report.update",
        "project_monthly_report",
        row.id,
        { beforeRevision: current.revision, reason },
        "var/audit-fallback.ndjson",
      );
      return { data: row };
    },
  );
  app.post(
    "/api/monthly-reports/:id/withdraw",
    { preHandler: deps.authenticate },
    async (request) => {
      const reportId = id.parse((request.params as { id: string }).id);
      if (!(await canWriteReport(request, reportId))) forbidden();
      const { reason } = z
        .object({ reason: z.string().trim().min(2).max(500) })
        .parse(request.body);
      const row = await prisma.projectMonthlyReport.findUniqueOrThrow({
        where: { id: reportId },
      });
      if (row.status !== "submitted")
        throw Object.assign(new Error("只有已提交月报可以撤回"), {
          statusCode: 409,
          code: "REPORT_NOT_SUBMITTED",
        });
      await prisma.projectMonthlyReport.update({
        where: { id: reportId },
        data: {
          status: "withdrawn",
          withdrawnBy: request.principal!.accountId,
          withdrawnAt: new Date(),
          withdrawalReason: reason,
        },
      });
      await auditCritical(
        request.principal!.accountId,
        "project_monthly_report.withdraw",
        "project_monthly_report",
        reportId,
        { reason },
        "var/audit-fallback.ndjson",
      );
      return { data: { status: "withdrawn" } };
    },
  );
  app.post(
    "/api/monthly-reports/:id/submit",
    { preHandler: deps.authenticate },
    async (request) => {
      const reportId = id.parse((request.params as { id: string }).id);
      if (!(await canWriteReport(request, reportId))) forbidden();
      const row = await prisma.projectMonthlyReport.findUniqueOrThrow({
        where: { id: reportId },
      });
      if (row.status !== "withdrawn")
        throw Object.assign(new Error("只有撤回月报可以重新提交"), {
          statusCode: 409,
          code: "REPORT_NOT_WITHDRAWN",
        });
      await prisma.projectMonthlyReport.update({
        where: { id: reportId },
        data: {
          status: "submitted",
          submittedBy: request.principal!.accountId,
          submittedAt: new Date(),
        },
      });
      return { data: { status: "submitted" } };
    },
  );
  app.post(
    "/api/monthly-reports/:id/void",
    { preHandler: deps.authenticate },
    async (request) => {
      const reportId = id.parse((request.params as { id: string }).id);
      if (!isCompanyAdmin(request.principal!))
        forbidden("只有公司管理员可以作废月报");
      const { reason } = z
        .object({ reason: z.string().trim().min(2).max(500) })
        .parse(request.body);
      await prisma.projectMonthlyReport.update({
        where: { id: reportId },
        data: {
          status: "voided",
          voidedBy: request.principal!.accountId,
          voidedAt: new Date(),
          voidReason: reason,
        },
      });
      await auditCritical(
        request.principal!.accountId,
        "project_monthly_report.void",
        "project_monthly_report",
        reportId,
        { reason },
        "var/audit-fallback.ndjson",
      );
      return { data: { status: "voided" } };
    },
  );

  app.get(
    "/api/monthly-reports/no-field",
    { preHandler: deps.authenticate },
    async (request) => {
      canRead(request);
      const query = z
        .object({ organizationId: id, month })
        .parse(request.query);
      if (
        !isCompanyAdmin(request.principal!) &&
        !reportOrganizationIds(request).includes(query.organizationId)
      )
        forbidden();
      const [year, number] = query.month.split("-").map(Number);
      return {
        data: await prisma.departmentMonthStatus.findFirst({
          where: {
            organizationId: query.organizationId,
            reportingYear: year!,
            reportingMonth: number!,
            active: true,
          },
        }),
      };
    },
  );
  app.put(
    "/api/monthly-reports/no-field",
    { preHandler: deps.authenticate },
    async (request) => {
      const body = z
        .object({
          organizationId: id,
          month,
          note: z.string().trim().max(1000).optional(),
        })
        .parse(request.body);
      if (
        !isCompanyAdmin(request.principal!) &&
        !reportOrganizationIds(request).includes(body.organizationId)
      )
        forbidden("只能确认本经营实体");
      const organization = await prisma.organization.findFirst({
        where: { id: body.organizationId, type: "business_entity" },
      });
      if (!organization)
        throw Object.assign(new Error("只有经营实体参与月报确认"), {
          statusCode: 409,
          code: "REPORTING_ENTITY_REQUIRED",
        });
      const [year, number] = body.month.split("-").map(Number);
      const existing = await prisma.projectMonthlyReport.count({
        where: {
          reportingOrganizationId: body.organizationId,
          reportMonth: reportMonth(body.month),
          status: { not: "voided" },
        },
      });
      if (existing)
        throw Object.assign(new Error("当月已有报送，不能确认无野外项目"), {
          statusCode: 409,
          code: "REPORTS_EXIST",
        });
      const row = await prisma.$transaction(async (tx) => {
        await tx.departmentMonthStatus.updateMany({
          where: {
            organizationId: body.organizationId,
            reportingYear: year!,
            reportingMonth: number!,
            active: true,
          },
          data: {
            active: false,
            invalidatedAt: new Date(),
            invalidatedBy: request.principal!.accountId,
            invalidReason: "重新确认",
          },
        });
        return tx.departmentMonthStatus.create({
          data: {
            organizationId: body.organizationId,
            reportingYear: year!,
            reportingMonth: number!,
            noFieldProjects: true,
            confirmedBy: request.principal!.accountId,
            note: body.note ?? null,
          },
        });
      });
      return { data: row };
    },
  );
  app.delete(
    "/api/monthly-reports/no-field",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      const query = z
        .object({ organizationId: id, month })
        .parse(request.query);
      if (
        !isCompanyAdmin(request.principal!) &&
        !reportOrganizationIds(request).includes(query.organizationId)
      )
        forbidden("只能撤销本经营实体确认");
      const [year, number] = query.month.split("-").map(Number);
      await prisma.departmentMonthStatus.updateMany({
        where: {
          organizationId: query.organizationId,
          reportingYear: year!,
          reportingMonth: number!,
          active: true,
        },
        data: {
          active: false,
          invalidatedAt: new Date(),
          invalidatedBy: request.principal!.accountId,
          invalidReason: "管理员撤销",
        },
      });
      return reply.code(204).send();
    },
  );

  app.get(
    "/api/report-config",
    { preHandler: deps.authenticate },
    async (request) => {
      canRead(request);
      const [types, fields, organizations, settings] = await Promise.all([
        prisma.reportProjectType.findMany({
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        }),
        prisma.reportField.findMany({
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        }),
        prisma.organization.findMany({
          where: { type: "business_entity" },
          select: { id: true, name: true, reportingEnabled: true },
          orderBy: { name: "asc" },
        }),
        prisma.reportSetting.upsert({
          where: { id: "default" },
          create: {},
          update: {},
        }),
      ]);
      return { data: { types, fields, organizations, settings } };
    },
  );
  app.post(
    "/api/report-config/types",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      requireCompanyAdmin(request);
      const body = z
        .object({
          name: z.string().trim().min(1).max(160),
          sortOrder: z.coerce.number().int().min(0).default(0),
        })
        .parse(request.body);
      return reply
        .code(201)
        .send({ data: await prisma.reportProjectType.create({ data: body }) });
    },
  );
  app.patch(
    "/api/report-config/types/:id",
    { preHandler: deps.authenticate },
    async (request) => {
      requireCompanyAdmin(request);
      const body = z
        .object({
          name: z.string().trim().min(1).max(160).optional(),
          sortOrder: z.coerce.number().int().min(0).optional(),
          active: z.boolean().optional(),
        })
        .parse(request.body);
      const data = Object.fromEntries(
        Object.entries(body).filter(([, value]) => value !== undefined),
      ) as Prisma.ReportProjectTypeUpdateInput;
      return {
        data: await prisma.reportProjectType.update({
          where: { id: id.parse((request.params as { id: string }).id) },
          data,
        }),
      };
    },
  );
  app.delete(
    "/api/report-config/types/:id",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      requireCompanyAdmin(request);
      const typeId = id.parse((request.params as { id: string }).id);
      if (
        await prisma.projectMonthlyReport.count({
          where: { projectTypeId: typeId },
        })
      )
        throw Object.assign(new Error("项目类型已有历史引用，不能删除"), {
          statusCode: 409,
        });
      await prisma.reportProjectType.delete({ where: { id: typeId } });
      return reply.code(204).send();
    },
  );
  app.post(
    "/api/report-config/fields",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      requireCompanyAdmin(request);
      const body = fieldInput.parse(request.body);
      const key = `f_${randomBytes(4).toString("hex")}`;
      return reply.code(201).send({
        data: await prisma.reportField.create({
          data: { fieldKey: key, builtin: false, ...body },
        }),
      });
    },
  );
  app.patch(
    "/api/report-config/fields/:id",
    { preHandler: deps.authenticate },
    async (request) => {
      requireCompanyAdmin(request);
      const fieldId = id.parse((request.params as { id: string }).id);
      const current = await prisma.reportField.findUniqueOrThrow({
        where: { id: fieldId },
      });
      const body = fieldInput.partial().parse(request.body);
      if (
        current.builtin &&
        body.fieldType &&
        body.fieldType !== current.fieldType
      )
        throw Object.assign(new Error("内置字段不能修改类型"), {
          statusCode: 409,
        });
      const data = Object.fromEntries(
        Object.entries(body).filter(([, value]) => value !== undefined),
      ) as Prisma.ReportFieldUpdateInput;
      return {
        data: await prisma.reportField.update({ where: { id: fieldId }, data }),
      };
    },
  );
  app.delete(
    "/api/report-config/fields/:id",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      requireCompanyAdmin(request);
      const fieldId = id.parse((request.params as { id: string }).id);
      const current = await prisma.reportField.findUniqueOrThrow({
        where: { id: fieldId },
      });
      if (current.builtin)
        throw Object.assign(new Error("内置字段不能删除，可以停用"), {
          statusCode: 409,
        });
      await prisma.reportField.delete({ where: { id: fieldId } });
      return reply.code(204).send();
    },
  );
  app.patch(
    "/api/report-config/organizations/:id",
    { preHandler: deps.authenticate },
    async (request) => {
      requireCompanyAdmin(request);
      const organizationId = id.parse((request.params as { id: string }).id);
      const reportingEnabled = z
        .object({ reportingEnabled: z.boolean() })
        .parse(request.body).reportingEnabled;
      return {
        data: await prisma.organization.update({
          where: { id: organizationId },
          data: { reportingEnabled },
        }),
      };
    },
  );
  app.patch(
    "/api/report-config/settings",
    { preHandler: deps.authenticate },
    async (request) => {
      requireCompanyAdmin(request);
      const deadlineDay = z
        .object({ deadlineDay: z.coerce.number().int().min(1).max(28) })
        .parse(request.body).deadlineDay;
      const row = await prisma.reportSetting.upsert({
        where: { id: "default" },
        create: { deadlineDay, updatedBy: request.principal!.accountId },
        update: { deadlineDay, updatedBy: request.principal!.accountId },
      });
      await auditCritical(
        request.principal!.accountId,
        "report_setting.update",
        "report_setting",
        row.id,
        { deadlineDay },
        "var/audit-fallback.ndjson",
      );
      return { data: row };
    },
  );

  app.get(
    "/api/monthly-reports.csv",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      canRead(request);
      const query = z
        .object({
          year: z.coerce.number().int().optional(),
          month: z.coerce.number().int().min(1).max(12).optional(),
          completed: z.enum(["true", "false"]).optional(),
        })
        .parse(request.query);
      const fields = await prisma.reportField.findMany({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
      });
      const rows = await prisma.projectMonthlyReport.findMany({
        where: {
          ...visibleWhere(request),
          status: "submitted",
          ...(query.year
            ? {
                reportMonth: {
                  gte: new Date(
                    Date.UTC(query.year, (query.month ?? 1) - 1, 1),
                  ),
                  lt: new Date(
                    Date.UTC(
                      query.month ? query.year : query.year + 1,
                      query.month ? query.month : 0,
                      1,
                    ),
                  ),
                },
              }
            : {}),
          ...(query.completed === "true" ? { projectStatus: "completed" } : {}),
        },
        include,
        orderBy: { reportMonth: "desc" },
      });
      const esc = (value: unknown) =>
        `"${String(value ?? "").replace(/"/g, '""')}"`;
      const builtin: Record<string, (row: (typeof rows)[number]) => unknown> = {
        project_name: (r) => r.project.name,
        project_type_id: (r) => r.projectType?.name,
        construction_location: (r) => r.constructionLocation,
        contract_amount: (r) => r.contractAmount,
        duration_months: (r) => r.durationMonths,
        department_entity: (r) => r.departmentEntity,
        project_manager: (r) =>
          [r.projectManager, r.contactInfo].filter(Boolean).join(" / "),
        contact_info: () => "",
        overall_progress: (r) => r.overallProgress,
        monthly_construction_status: (r) => r.monthlyConstructionStatus,
        equipment_models: (r) => r.equipmentModels,
        onsite_count: (r) => r.onsiteCount,
        onsite_vehicles: (r) => r.onsiteVehicles,
        safety_inspection: (r) => (r.safetyInspection ? "是" : "否"),
        safety_hazards: (r) => (r.safetyHazards ? "是" : "否"),
        safety_hazard_detail: (r) => r.safetyHazardDetail,
      };
      const visibleFields = fields.filter(
        (field) =>
          ![
            "contact_info",
            "safety_hazard_detail",
            "equipment_models",
          ].includes(field.fieldKey),
      );
      const lines = [
        [
          "序号",
          "部门",
          "报送月份",
          ...visibleFields.map((field) => field.label),
          "报送时间",
        ]
          .map(esc)
          .join(","),
        ...rows.map((row, index) => {
          const custom = row.customData as Record<string, unknown>;
          return [
            index + 1,
            row.reportingOrganization.name,
            row.reportMonth.toISOString().slice(0, 7),
            ...visibleFields.map(
              (field) =>
                builtin[field.fieldKey]?.(row) ?? custom[field.fieldKey] ?? "",
            ),
            row.submittedAt?.toISOString() ?? "",
          ]
            .map(esc)
            .join(",");
        }),
      ];
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename=${query.completed === "true" ? "completed-projects" : "project-reports"}.csv`,
        )
        .send(`\uFEFF${lines.join("\r\n")}`);
    },
  );
}
