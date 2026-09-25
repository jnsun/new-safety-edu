import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { projectTypeOptions } from "@safety/contracts";
import { prisma } from "../db.js";
import { forbidden, isCompanyAdmin, projectScopeIds } from "../access.js";
import {
  reportStats,
  validateReportFields,
} from "../project-reporting-core.js";
import { canGovernMonthlyReporting, canSubmitMonthlyFacts, inheritedMonthlyDefaults, monthlyReminderDedupeKey, monthlyReminderEligible, monthlySubmissionReadiness, nextSubmissionStatus, reportingOrganizationIds, submittedMonthStatuses } from "../project-reporting-policy.js";
import { writeCriticalAudit } from "../transaction-audit.js";
import { isSafetyEligibleProject, safetyEligibleProjectWhere } from "../contract-project-eligibility.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
const id = z.string().uuid();
const month = z.string().regex(/^\d{4}-\d{2}$/);
const reportMonth = (value: string) => new Date(`${value}-01T00:00:00.000Z`);
const reportMonthLabel = (value: string) => {
  const [year, monthNumber] = value.split("-").map(Number);
  return `${year}年${monthNumber}月`;
};
function reportOrganizationIds(request: FastifyRequest) { return reportingOrganizationIds(request.principal!); }
function isApprovedProjectType(name: string) {
  return (projectTypeOptions as readonly string[]).includes(name);
}
function requireCompanyAdmin(request: FastifyRequest) {
  if (!canGovernMonthlyReporting(request.principal!))
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
  if (!canSubmitMonthlyFacts(request.principal!)) return false;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { responsibleOrganizationId: true, status: true, contractBidStatus: true, contractStage: true, contractDataSource: true, mainContract: { select: { signedAt: true } } },
  });
  return (
    !!project &&
    project.status !== "ended" &&
    isSafetyEligibleProject(project) &&
    reportOrganizationIds(request).includes(project.responsibleOrganizationId)
  );
}
async function canWriteReport(request: FastifyRequest, reportId: string) {
  const row = await prisma.projectMonthlyReport.findUnique({
    where: { id: reportId },
    select: { projectId: true },
  });
  return !!row && canWriteProject(request, row.projectId);
}

async function reportingPeriodFor(value: string) {
  return prisma.reportingPeriod.findUnique({ where: { reportMonth: reportMonth(value) } });
}

async function requireWritablePeriod(value: string) {
  const period = await reportingPeriodFor(value);
  if (!period || !["open", "review"].includes(period.status))
    throw Object.assign(new Error("该月份尚未开放或已经锁定"), { statusCode: 409, code: "REPORTING_PERIOD_NOT_WRITABLE" });
  return period;
}

async function activeSubmission(organizationId: string, value: string) {
  const [year, number] = value.split("-").map(Number);
  return prisma.departmentMonthStatus.findFirst({ where: { organizationId, reportingYear: year!, reportingMonth: number!, active: true } });
}

function submissionEditable(status?: string) {
  return !status || status === "draft" || status === "rejected";
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
// This is deliberately narrower than the general project-master endpoint.  A
// field reporter may create a formal project only while preparing the current
// entity's open monthly report; it does not grant access to the organisation
// and project administration screens.
const monthlyProjectCreateInput = z.object({
  organizationId: id,
  reportMonth: month,
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(50),
  projectType: z.enum(projectTypeOptions).optional(),
  location: z.string().trim().max(300).optional(),
  contractAmount: z.coerce.number().min(0).optional(),
  plannedStartAt: z.string().date().optional(),
  plannedEndAt: z.string().date().optional(),
  managerName: z.string().trim().max(80).optional(),
  managerPhone: z.string().trim().max(20).optional(),
});
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
        canReview: canGovernMonthlyReporting(request.principal!),
        canSubmit: canSubmitMonthlyFacts(request.principal!),
        organizationIds: reportOrganizationIds(request),
      },
    }),
  );
  app.get(
    "/api/monthly-reports/projects",
    { preHandler: deps.authenticate },
    async (request) => {
      canRead(request);
      const query = z.object({ month: month.optional() }).parse(request.query);
      const orgIds = reportOrganizationIds(request);
      const projectIds = projectScopeIds(request.principal!);
      const targetMonth = query.month ? reportMonth(query.month) : undefined;
      return {
        data: await prisma.project.findMany({
          where: {
            AND: [
              safetyEligibleProjectWhere,
              ...(isCompanyAdmin(request.principal!)
                ? []
                : [{ OR: [
                     { responsibleOrganizationId: { in: orgIds } },
                     { id: { in: projectIds } },
                  ] }]),
            ],
          },
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
            responsibleOrganizationId: true,
            responsibleOrganization: { select: { id: true, name: true } },
            projectType: true,
            location: true,
            contractAmount: true,
            plannedStartAt: true,
            plannedEndAt: true,
            managerName: true,
            managerPhone: true,
            monthlyReports: targetMonth ? {
              where: { reportMonth: { lt: targetMonth }, status: { not: "voided" } },
              orderBy: { reportMonth: "desc" },
              take: 1,
              select: { overallProgress: true, onsiteCount: true, onsiteVehicles: true, equipmentModels: true },
            } : false,
          },
          orderBy: { name: "asc" },
        }).then((rows) => rows.map((row) => ({ ...row, previousDefaults: inheritedMonthlyDefaults("monthlyReports" in row ? row.monthlyReports[0] : null), monthlyReports: undefined }))),
      };
    },
  );
  app.post(
    "/api/monthly-reports/projects",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      if (!canSubmitMonthlyFacts(request.principal!))
        forbidden("仅具有野外项目报送权限的人员可以从月报中新建项目");
      const parsed = monthlyProjectCreateInput.parse(request.body);
      if (!reportOrganizationIds(request).includes(parsed.organizationId))
        forbidden("只能为本人负责填报的经营实体新建项目");

      await requireWritablePeriod(parsed.reportMonth);
      const submission = await activeSubmission(parsed.organizationId, parsed.reportMonth);
      if (!submissionEditable(submission?.status))
        throw Object.assign(new Error("该经营实体本月已提交或锁定，不能新增报送项目"), {
          statusCode: 409,
          code: "MONTHLY_SUBMISSION_NOT_EDITABLE",
        });

      const organization = await prisma.organization.findUnique({
        where: { id: parsed.organizationId },
        select: { id: true, name: true, type: true },
      });
      if (!organization || organization.type !== "business_entity")
        throw Object.assign(new Error("项目必须归属经营实体"), {
          statusCode: 409,
          code: "PROJECT_REQUIRES_BUSINESS_ENTITY",
        });

      try {
        const project = await prisma.$transaction(async (tx) => {
          // User-confirmed rule: a report-originated project is a formal
          // project master immediately.  There is no pending-review state.
          const created = await tx.project.create({
            data: {
              name: parsed.name,
              code: parsed.code,
              responsibleOrganizationId: organization.id,
              projectType: parsed.projectType ?? null,
              location: parsed.location ?? null,
              contractAmount: parsed.contractAmount ?? null,
              plannedStartAt: parsed.plannedStartAt
                ? new Date(`${parsed.plannedStartAt}T00:00:00.000Z`)
                : null,
              plannedEndAt: parsed.plannedEndAt
                ? new Date(`${parsed.plannedEndAt}T00:00:00.000Z`)
                : null,
              managerName: parsed.managerName ?? null,
              managerPhone: parsed.managerPhone ?? null,
            },
            include: { responsibleOrganization: { select: { id: true, name: true } } },
          });
          await writeCriticalAudit(tx, {
            actorId: request.principal!.accountId,
            action: "project.create_from_monthly_reporting",
            objectType: "project",
            objectId: created.id,
            metadata: {
              organizationId: organization.id,
              reportMonth: parsed.reportMonth,
              source: "monthly_reporting",
            },
          });
          return created;
        });
        return reply.code(201).send({ data: project });
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw Object.assign(new Error("项目编号已存在，请使用未占用的项目编号"), {
            statusCode: 409,
            code: "PROJECT_CODE_EXISTS",
          });
        }
        throw error;
      }
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
          status: z.enum(["draft", "submitted", "withdrawn", "voided"]).optional(),
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
      const [organizations, reports, submissions, period] = await Promise.all([
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
        prisma.reportingPeriod.findUnique({ where: { reportMonth: date } }),
      ]);
      const stats = reportStats(
        organizations,
        reports,
        submissions,
      );
      const byOrg = new Map<string, typeof reports>();
      reports.forEach((row) =>
        byOrg.set(row.reportingOrganizationId, [
          ...(byOrg.get(row.reportingOrganizationId) ?? []),
          row,
        ]),
      );
      const submissionByOrg = new Map(submissions.map((row) => [row.organizationId, row]));
      return {
        data: {
          month: value,
          period,
          stats,
          departments: organizations.map((org) => ({
            ...org,
            status: submissionByOrg.get(org.id)?.status ?? ((byOrg.get(org.id)?.length ?? 0) ? "draft" : "missing"),
            reportType: submissionByOrg.get(org.id)?.reportType ?? "projects",
            returnReason: submissionByOrg.get(org.id)?.returnReason ?? null,
            submissionId: submissionByOrg.get(org.id)?.id ?? null,
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
        include: { ...include, revisions: { orderBy: { revision: "desc" } } },
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
      await requireWritablePeriod(parsed.reportMonth);
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
      const existingReport = await prisma.projectMonthlyReport.findFirst({
        where: { projectId: parsed.projectId, reportMonth: date, status: { not: "voided" } },
        select: { id: true },
      });
      if (existingReport) throw Object.assign(new Error("该项目本月已经存在月报草稿"), { statusCode: 409, code: "PROJECT_MONTHLY_REPORT_EXISTS" });
      const currentSubmission = await activeSubmission(project.responsibleOrganizationId, parsed.reportMonth);
      if (!submissionEditable(currentSubmission?.status))
        throw Object.assign(new Error("部门月报已经提交，需管理员退回后才能修改"), { statusCode: 409, code: "DEPARTMENT_SUBMISSION_READ_ONLY" });
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
        status: "draft" as const,
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
        submittedBy: null,
        submittedAt: null,
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
        const submission = await tx.departmentMonthStatus.findFirst({ where: { organizationId: project.responsibleOrganizationId, reportingYear: date.getUTCFullYear(), reportingMonth: date.getUTCMonth() + 1, active: true } });
        if (submission) await tx.departmentMonthStatus.update({ where: { id: submission.id }, data: { reportType: "projects", noFieldProjects: false, status: "draft", returnReason: null } });
        else await tx.departmentMonthStatus.create({ data: { organizationId: project.responsibleOrganizationId, reportingYear: date.getUTCFullYear(), reportingMonth: date.getUTCMonth() + 1, reportType: "projects", noFieldProjects: false, status: "draft" } });
        await writeCriticalAudit(tx, { actorId: request.principal!.accountId, action: "project_monthly_report.create", objectType: "project_monthly_report", objectId: created.id, metadata: { projectId: created.projectId, reportMonth: parsed.reportMonth } });
        return created;
      }).catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw Object.assign(new Error("该项目本月已经存在月报草稿"), { statusCode: 409, code: "PROJECT_MONTHLY_REPORT_EXISTS" });
        }
        throw error;
      });
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
      await requireWritablePeriod(current.reportMonth.toISOString().slice(0, 7));
      const currentSubmission = await activeSubmission(current.reportingOrganizationId, current.reportMonth.toISOString().slice(0, 7));
      if (!submissionEditable(currentSubmission?.status) || current.status === "submitted")
        throw Object.assign(new Error("部门月报已经提交，需管理员退回后才能修改"), { statusCode: 409, code: "DEPARTMENT_SUBMISSION_READ_ONLY" });
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
        const changed = await tx.projectMonthlyReport.updateMany({
          where: { id: reportId, status: { in: ["draft", "withdrawn"] }, revision: current.revision },
          data,
        });
        if (changed.count !== 1) throw Object.assign(new Error("月报已被更新或提交，请刷新后重试"), { statusCode: 409, code: "REPORT_CHANGED" });
        const updated = await tx.projectMonthlyReport.findUniqueOrThrow({ where: { id: reportId } });
        await writeCriticalAudit(tx, { actorId: request.principal!.accountId, action: "project_monthly_report.update", objectType: "project_monthly_report", objectId: updated.id, reason, metadata: { beforeRevision: current.revision } });
        return updated;
      });
      return { data: row };
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
      await prisma.$transaction(async (tx) => { await tx.projectMonthlyReport.update({ where: { id: reportId }, data: {
          status: "voided",
          voidedBy: request.principal!.accountId,
          voidedAt: new Date(),
          voidReason: reason,
        } }); await writeCriticalAudit(tx, { actorId: request.principal!.accountId, action: "project_monthly_report.void", objectType: "project_monthly_report", objectId: reportId, reason }); });
      return { data: { status: "voided" } };
    },
  );

  app.get(
    "/api/monthly-reports/submissions",
    { preHandler: deps.authenticate },
    async (request) => {
      canRead(request);
      const value = month.parse((request.query as { month?: string }).month);
      const [year, number] = value.split("-").map(Number);
      return { data: await prisma.departmentMonthStatus.findMany({
        where: { reportingYear: year!, reportingMonth: number!, active: true, ...(isCompanyAdmin(request.principal!) ? {} : { organizationId: { in: reportOrganizationIds(request) } }) },
        include: { organization: { select: { id: true, name: true } } },
        orderBy: { organization: { name: "asc" } },
      }) };
    },
  );

  app.post(
    "/api/monthly-reports/submissions/remind",
    { preHandler: deps.authenticate },
    async (request) => {
      requireCompanyAdmin(request);
      const body = z.object({ organizationId: id, month }).parse(request.body);
      const [year, number] = body.month.split("-").map(Number);
      return { data: await prisma.$transaction(async (tx) => {
        const [organization, submission, recipients] = await Promise.all([
          tx.organization.findFirst({ where: { id: body.organizationId, type: "business_entity", reportingEnabled: true }, select: { name: true } }),
          tx.departmentMonthStatus.findFirst({ where: { organizationId: body.organizationId, reportingYear: year!, reportingMonth: number!, active: true }, select: { status: true } }),
          tx.roleAssignment.findMany({ where: { active: true, role: { in: ["org_leader", "org_admin"] }, scopeType: "organization", scopeId: body.organizationId, personId: { not: null }, person: { status: "active", account: { status: "active" } } }, select: { personId: true } }),
        ]);
        if (!organization) throw Object.assign(new Error("经营实体未启用报送"), { statusCode: 404 });
        if (!monthlyReminderEligible(submission?.status)) throw Object.assign(new Error("本月已提交，无需提醒"), { statusCode: 409 });
        const personIds = [...new Set(recipients.map((row) => row.personId).filter((personId): personId is string => !!personId))];
        if (!personIds.length) throw Object.assign(new Error("该实体没有可接收提醒的在职负责人"), { statusCode: 409 });
        const now = Date.now();
        const result = await tx.notification.createMany({ data: personIds.map((personId) => ({ personId, title: "野外项目月报提醒", body: `${organization.name} ${body.month} 月报尚未完成整批提交，请核对项目草稿后报送。`, dedupeKey: monthlyReminderDedupeKey(body.organizationId, body.month, personId, now) })), skipDuplicates: true });
        await writeCriticalAudit(tx, { actorId: request.principal!.accountId, action: "monthly_report.remind", objectType: "organization", objectId: body.organizationId, metadata: { month: body.month, recipientCount: personIds.length, created: result.count } });
        return { requested: personIds.length, created: result.count, channel: "in_app" as const };
      }) };
    },
  );

  app.get(
    "/api/monthly-reports/submissions/preflight",
    { preHandler: deps.authenticate },
    async (request) => {
      const query = z.object({ organizationId: id, month }).parse(request.query);
      if (!canSubmitMonthlyFacts(request.principal!) || !reportOrganizationIds(request).includes(query.organizationId))
        forbidden("只能核对获授权经营实体的月报");
      const date = reportMonth(query.month);
      const [year, number] = query.month.split("-").map(Number);
      const [organization, period, projects, reports, submission] = await Promise.all([
        prisma.organization.findFirst({ where: { id: query.organizationId, type: "business_entity", reportingEnabled: true }, select: { id: true } }),
        reportingPeriodFor(query.month),
        prisma.project.findMany({ where: { responsibleOrganizationId: query.organizationId, status: { in: ["active", "paused"] }, ...safetyEligibleProjectWhere }, select: { id: true, name: true, code: true, status: true }, orderBy: { name: "asc" } }),
        prisma.projectMonthlyReport.findMany({ where: { reportingOrganizationId: query.organizationId, reportMonth: date, status: { not: "voided" } }, select: { id: true, projectId: true, status: true, revision: true, updatedAt: true } }),
        prisma.departmentMonthStatus.findFirst({ where: { organizationId: query.organizationId, reportingYear: year!, reportingMonth: number!, active: true }, select: { id: true, status: true, reportType: true, returnReason: true } }),
      ]);
      const byProject = new Map(reports.map((row) => [row.projectId, row]));
      const items = projects.map((project) => ({ ...project, report: byProject.get(project.id) ?? null }));
      const readiness = monthlySubmissionReadiness({ organizationEnabled: !!organization, periodStatus: period?.status ?? "closed", submissionStatus: submission?.status, projects: items.map((item) => ({ reportStatus: item.report?.status })) });
      const duplicate = items.some((item) => reports.filter((row) => row.projectId === item.id).length > 1);
      return { data: { organizationId: query.organizationId, month: query.month, periodStatus: period?.status ?? "closed", submission, reportType: projects.length ? "projects" : "no_projects", ...readiness, ready: readiness.ready && !duplicate, reasons: [...readiness.reasons, ...(duplicate ? ["存在重复项目月报，请联系管理员核查"] : [])], items } };
    },
  );

  app.post(
    "/api/monthly-reports/submissions",
    { preHandler: deps.authenticate },
    async (request) => {
      const body = z.object({ organizationId: id, month, reportType: z.enum(["projects", "no_projects"]), note: z.string().trim().max(1000).optional() }).parse(request.body);
      if (!canSubmitMonthlyFacts(request.principal!) || !reportOrganizationIds(request).includes(body.organizationId)) forbidden("只能提交获授权经营实体的月报");
      const date = reportMonth(body.month);
      const [year, number] = body.month.split("-").map(Number);
      const row = await prisma.$transaction(async (tx) => {
        // Serialize submissions for the same entity and month; a retry must observe the first result.
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${body.organizationId}), hashtext(${body.month}))`;
        const [period, organization, projects, current] = await Promise.all([
          tx.reportingPeriod.findUnique({ where: { reportMonth: date } }),
          tx.organization.findFirst({ where: { id: body.organizationId, type: "business_entity", reportingEnabled: true }, select: { id: true } }),
          tx.project.findMany({ where: { responsibleOrganizationId: body.organizationId, status: { in: ["active", "paused"] }, ...safetyEligibleProjectWhere }, select: { id: true } }),
          tx.departmentMonthStatus.findFirst({ where: { organizationId: body.organizationId, reportingYear: year!, reportingMonth: number!, active: true } }),
        ]);
        if (current && ["submitted", "confirmed", "locked"].includes(current.status)) {
          if (current.reportType === body.reportType) return current;
          throw Object.assign(new Error("当前部门月报已经提交且配置不同，需管理员退回后再提交"), { statusCode: 409, code: "SUBMISSION_ALREADY_EXISTS" });
        }
        if (!period || !["open", "review"].includes(period.status)) throw Object.assign(new Error("该月份尚未开放或已经锁定"), { statusCode: 409, code: "REPORTING_PERIOD_NOT_WRITABLE" });
        if (!organization) throw Object.assign(new Error("该经营实体未启用月报"), { statusCode: 409, code: "REPORTING_ENTITY_REQUIRED" });
        const projectIds = projects.map((project) => project.id);
        const liveReports = projectIds.length ? await tx.projectMonthlyReport.findMany({ where: { projectId: { in: projectIds }, reportingOrganizationId: body.organizationId, reportMonth: date, status: { in: ["draft", "withdrawn"] } }, select: { projectId: true } }) : [];
        const reportCount = new Set(liveReports.map((row) => row.projectId)).size;
        if (body.reportType === "no_projects" && projects.length) throw Object.assign(new Error("本月仍有在建或暂停项目，不能申报无在建项目"), { statusCode: 409, code: "ACTIVE_PROJECTS_EXIST" });
        if (body.reportType === "projects" && (!projects.length || reportCount !== projects.length || liveReports.length !== projects.length)) throw Object.assign(new Error(`应报 ${projects.length} 个项目，已完成 ${reportCount} 个，请全部填写后统一提交`), { statusCode: 409, code: "DEPARTMENT_REPORTS_INCOMPLETE" });
        if (!submissionEditable(current?.status)) throw Object.assign(new Error("当前部门月报状态不可重复提交"), { statusCode: 409, code: "SUBMISSION_NOT_EDITABLE" });
        const submittedAt = new Date();
        if (projectIds.length) {
          const changed = await tx.projectMonthlyReport.updateMany({ where: { projectId: { in: projectIds }, reportingOrganizationId: body.organizationId, reportMonth: date, status: { in: ["draft", "withdrawn"] } }, data: { status: "submitted", submittedBy: request.principal!.accountId, submittedAt } });
          if (changed.count !== projectIds.length) throw Object.assign(new Error("提交期间项目月报已变化，请刷新后重试"), { statusCode: 409, code: "DEPARTMENT_REPORTS_CHANGED" });
        }
        const data = { reportType: body.reportType, noFieldProjects: body.reportType === "no_projects", status: nextSubmissionStatus((current?.status ?? "draft") as "draft" | "rejected", "submit"), expectedProjectCount: projects.length, completedProjectCount: reportCount, submittedAt, submittedBy: request.principal!.accountId, reviewedAt: null, reviewedBy: null, returnReason: null, note: body.note ?? null } as const;
        const updated = current ? await tx.departmentMonthStatus.update({ where: { id: current.id }, data }) : await tx.departmentMonthStatus.create({ data: { organizationId: body.organizationId, reportingYear: year!, reportingMonth: number!, ...data } });
        await writeCriticalAudit(tx, { actorId: request.principal!.accountId, action: "department_monthly_submission.submit", objectType: "department_month_status", objectId: updated.id, metadata: { organizationId: body.organizationId, reportMonth: body.month, reportType: body.reportType, projectCount: reportCount } });
        return updated;
      });
      return { data: row };
    },
  );

  app.post(
    "/api/monthly-reports/submissions/:id/review",
    { preHandler: deps.authenticate },
    async (request) => {
      requireCompanyAdmin(request);
      const submissionId = id.parse((request.params as { id: string }).id);
      const body = z.object({ action: z.literal("reject"), reason: z.string().trim().min(2).max(1000) }).parse(request.body);
      const row = await prisma.$transaction(async (tx) => {
        const current = await tx.departmentMonthStatus.findUniqueOrThrow({ where: { id: submissionId } });
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${current.organizationId}), hashtext(${`${current.reportingYear}-${String(current.reportingMonth).padStart(2, "0")}`}))`;
        if (!current.active) throw Object.assign(new Error("该部门月报已失效"), { statusCode: 409, code: "SUBMISSION_INACTIVE" });
        const next = nextSubmissionStatus(current.status, "reject");
        const reviewedAt = new Date();
        const changed = await tx.departmentMonthStatus.updateMany({ where: { id: submissionId, active: true, status: "submitted" }, data: { status: next, reviewedAt, reviewedBy: request.principal!.accountId, returnReason: body.reason } });
        if (changed.count !== 1) throw Object.assign(new Error("该批次状态已变化，请刷新后查看"), { statusCode: 409, code: "SUBMISSION_ALREADY_REVIEWED" });
        const updated = await tx.departmentMonthStatus.findUniqueOrThrow({ where: { id: submissionId } });
        await tx.projectMonthlyReport.updateMany({ where: { reportingOrganizationId: current.organizationId, reportMonth: new Date(Date.UTC(current.reportingYear, current.reportingMonth - 1, 1)), status: "submitted" }, data: { status: "draft", withdrawnBy: request.principal!.accountId, withdrawnAt: reviewedAt, withdrawalReason: body.reason } });
        await writeCriticalAudit(tx, { actorId: request.principal!.accountId, action: "department_monthly_submission.reject", objectType: "department_month_status", objectId: submissionId, reason: body.reason });
        return updated;
      });
      return { data: row };
    },
  );

  app.get(
    "/api/reporting-periods",
    { preHandler: deps.authenticate },
    async (request) => { canRead(request); return { data: await prisma.reportingPeriod.findMany({ orderBy: { reportMonth: "desc" }, take: 36 }) }; },
  );

  app.put(
    "/api/reporting-periods/:month",
    { preHandler: deps.authenticate },
    async (request) => {
      requireCompanyAdmin(request);
      const value = month.parse((request.params as { month: string }).month);
      const body = z.object({ status: z.enum(["closed", "open", "review", "locked"]), deadlineAt: z.string().datetime().nullable().optional(), reason: z.string().trim().max(500).optional() }).parse(request.body);
      const date = reportMonth(value); const current = await reportingPeriodFor(value);
      if (current?.status === "locked" && body.status !== "locked" && (!body.reason || body.reason.length < 2)) throw Object.assign(new Error("重新开放锁定月份必须填写原因"), { statusCode: 400, code: "REOPEN_REASON_REQUIRED" });
      if (body.status === "locked") {
        const [enabled, submitted] = await Promise.all([prisma.organization.count({ where: { type: "business_entity", reportingEnabled: true } }), prisma.departmentMonthStatus.count({ where: { reportingYear: date.getUTCFullYear(), reportingMonth: date.getUTCMonth() + 1, active: true, status: { in: [...submittedMonthStatuses] } } })]);
        if (enabled !== submitted) throw Object.assign(new Error(`仍有 ${enabled - submitted} 个经营实体未提交，不能锁定`), { statusCode: 409, code: "REPORTING_PERIOD_INCOMPLETE" });
      }
      const row = await prisma.$transaction(async (tx) => {
        const updated = await tx.reportingPeriod.upsert({ where: { reportMonth: date }, create: { reportMonth: date, status: body.status, deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : null, reopenReason: body.reason ?? null, updatedBy: request.principal!.accountId }, update: { status: body.status, ...(body.deadlineAt !== undefined ? { deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : null } : {}), reopenReason: body.reason ?? null, updatedBy: request.principal!.accountId } });
        if (body.status === "locked") await tx.departmentMonthStatus.updateMany({ where: { reportingYear: date.getUTCFullYear(), reportingMonth: date.getUTCMonth() + 1, active: true, status: { in: [...submittedMonthStatuses] } }, data: { status: "locked", lockedAt: new Date(), lockedBy: request.principal!.accountId } });
        if (current?.status === "locked" && body.status !== "locked") {
          await tx.departmentMonthStatus.updateMany({ where: { reportingYear: date.getUTCFullYear(), reportingMonth: date.getUTCMonth() + 1, active: true, status: "locked", confirmedAt: { not: null } }, data: { status: "confirmed", lockedAt: null, lockedBy: null } });
          await tx.departmentMonthStatus.updateMany({ where: { reportingYear: date.getUTCFullYear(), reportingMonth: date.getUTCMonth() + 1, active: true, status: "locked", confirmedAt: null }, data: { status: "submitted", lockedAt: null, lockedBy: null } });
        }
        await writeCriticalAudit(tx, { actorId: request.principal!.accountId, action: "reporting_period.update", objectType: "reporting_period", objectId: updated.id, reason: body.reason ?? null, metadata: { month: value, status: body.status } });
        return updated;
      });
      return { data: row };
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
      if (!canSubmitMonthlyFacts(request.principal!) || !reportOrganizationIds(request).includes(body.organizationId))
        forbidden("只能确认本经营实体");
      const date = reportMonth(body.month);
      const [year, number] = body.month.split("-").map(Number);
      const row = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${body.organizationId}), hashtext(${body.month}))`;
        const [period, organization, projectCount, current] = await Promise.all([
          tx.reportingPeriod.findUnique({ where: { reportMonth: date } }),
          tx.organization.findFirst({ where: { id: body.organizationId, type: "business_entity", reportingEnabled: true }, select: { id: true } }),
          tx.project.count({ where: { responsibleOrganizationId: body.organizationId, status: { in: ["active", "paused"] }, ...safetyEligibleProjectWhere } }),
          tx.departmentMonthStatus.findFirst({ where: { organizationId: body.organizationId, reportingYear: year!, reportingMonth: number!, active: true } }),
        ]);
        if (current && ["submitted", "confirmed", "locked"].includes(current.status)) {
          if (current.reportType === "no_projects") return current;
          throw Object.assign(new Error("本月已按项目提交月报，不能改报无项目"), { statusCode: 409, code: "SUBMISSION_ALREADY_EXISTS" });
        }
        if (!period || !["open", "review"].includes(period.status)) throw Object.assign(new Error("该月份尚未开放或已经锁定"), { statusCode: 409, code: "REPORTING_PERIOD_NOT_WRITABLE" });
        if (!organization) throw Object.assign(new Error("该经营实体未启用月报"), { statusCode: 409, code: "REPORTING_ENTITY_REQUIRED" });
        if (projectCount) throw Object.assign(new Error("本月仍有在建或暂停项目，不能确认无野外项目"), { statusCode: 409, code: "ACTIVE_PROJECTS_EXIST" });
        if (!submissionEditable(current?.status)) throw Object.assign(new Error("当前部门月报状态不可重复提交"), { statusCode: 409, code: "SUBMISSION_NOT_EDITABLE" });
        const data = { noFieldProjects: true, reportType: "no_projects" as const, status: "submitted" as const, expectedProjectCount: 0, completedProjectCount: 0, submittedBy: request.principal!.accountId, submittedAt: new Date(), note: body.note ?? null, reviewedAt: null, reviewedBy: null, returnReason: null };
        const updated = current ? await tx.departmentMonthStatus.update({ where: { id: current.id }, data }) : await tx.departmentMonthStatus.create({ data: { organizationId: body.organizationId, reportingYear: year!, reportingMonth: number!, ...data } });
        await writeCriticalAudit(tx, { actorId: request.principal!.accountId, action: "department_monthly_submission.submit", objectType: "department_month_status", objectId: updated.id, metadata: { organizationId: body.organizationId, reportMonth: body.month, reportType: "no_projects", projectCount: 0 } });
        return updated;
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
      if (!reportOrganizationIds(request).includes(query.organizationId)) forbidden("只能处理本经营实体");
      throw Object.assign(new Error("部门月报提交后不能自行撤销，请联系管理员退回"), { statusCode: 409, code: "SUBMISSION_REVIEW_REQUIRED" });
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
          name: z.enum(projectTypeOptions),
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
          name: z.enum(projectTypeOptions).optional(),
          sortOrder: z.coerce.number().int().min(0).optional(),
          active: z.boolean().optional(),
        })
        .parse(request.body);
      const typeId = id.parse((request.params as { id: string }).id);
      const current = await prisma.reportProjectType.findUniqueOrThrow({
        where: { id: typeId },
        select: { name: true },
      });
      if (isApprovedProjectType(current.name) && (body.active === false || (body.name && body.name !== current.name)))
        throw Object.assign(new Error("标准项目类型不能停用或改名"), { statusCode: 409, code: "APPROVED_PROJECT_TYPE_LOCKED" });
      const data = Object.fromEntries(
        Object.entries(body).filter(([, value]) => value !== undefined),
      ) as Prisma.ReportProjectTypeUpdateInput;
      return {
        data: await prisma.reportProjectType.update({
          where: { id: typeId },
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
      const current = await prisma.reportProjectType.findUniqueOrThrow({
        where: { id: typeId },
        select: { name: true },
      });
      if (isApprovedProjectType(current.name))
        throw Object.assign(new Error("标准项目类型不能删除"), { statusCode: 409, code: "APPROVED_PROJECT_TYPE_LOCKED" });
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
      const row = await prisma.$transaction(async (tx) => { const updated = await tx.reportSetting.upsert({ where: { id: "default" }, create: { deadlineDay, updatedBy: request.principal!.accountId }, update: { deadlineDay, updatedBy: request.principal!.accountId } }); await writeCriticalAudit(tx, { actorId: request.principal!.accountId, action: "report_setting.update", objectType: "report_setting", objectId: updated.id, metadata: { deadlineDay } }); return updated; });
      return { data: row };
    },
  );

  app.get(
    "/api/monthly-reports.xlsx",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      requireCompanyAdmin(request);
      const query = z.object({ month }).parse(request.query);
      const date = reportMonth(query.month);
      const submissions = await prisma.departmentMonthStatus.findMany({
        where: {
          reportingYear: date.getUTCFullYear(),
          reportingMonth: date.getUTCMonth() + 1,
          active: true,
          status: { in: [...submittedMonthStatuses, "locked"] },
        },
        select: { organizationId: true },
      });
      const submittedOrganizationIds = submissions.map(({ organizationId }) => organizationId);
      const rows = await prisma.projectMonthlyReport.findMany({
        where: {
          reportMonth: date,
          status: "submitted",
          reportingOrganizationId: { in: submittedOrganizationIds },
        },
        include,
        orderBy: [{ reportingOrganization: { name: "asc" } }, { project: { name: "asc" } }],
      });
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "安全生产统一管理平台";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet("野外施工现场统计表", {
        pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
      });
      const monthLabel = reportMonthLabel(query.month);
      const projectTypes = new Map<string, number>();
      for (const row of rows) {
        const key = row.projectType?.name ?? "其他";
        projectTypes.set(key, (projectTypes.get(key) ?? 0) + 1);
      }
      const onsitePeople = rows.reduce((sum, row) => sum + row.onsiteCount, 0);
      const onsiteVehicles = rows.reduce((sum, row) => sum + row.onsiteVehicles, 0);
      const equipment = [...new Set(rows.map((row) => row.equipmentModels?.trim()).filter((value): value is string => !!value))].join("；") || "无";
      const hazardCount = rows.filter((row) => row.safetyHazards).length;
      const inspectionCount = rows.filter((row) => row.safetyInspection).length;
      sheet.mergeCells("A1:P1");
      sheet.getCell("A1").value = `山西省地球物理化学勘查院有限公司${monthLabel}野外施工现场统计表    填表日期：${new Date().toISOString().slice(0, 10)}`;
      sheet.mergeCells("B2:P2"); sheet.mergeCells("B3:P3"); sheet.mergeCells("B4:P4"); sheet.mergeCells("B5:P5"); sheet.mergeCells("A2:A5");
      sheet.getCell("A2").value = "安全生产情况说明";
      sheet.getCell("B2").value = `1. ${monthLabel}共有施工类项目${rows.length}项。`;
      sheet.getCell("B3").value = `2. 在建项目包括：${[...projectTypes.entries()].map(([name, count]) => `${name}${count}项`).join("；") || "无"}。`;
      sheet.getCell("B4").value = `3. 现场施工人员${onsitePeople}人；现场车辆${onsiteVehicles}辆；主要设备：${equipment}。`;
      sheet.getCell("B5").value = `4. 已完成安全自检${inspectionCount}项；${hazardCount ? `存在安全隐患${hazardCount}项，详见项目备注。` : "未报送安全隐患。"}`;
      const headers = ["序号", "项目名称", "项目类型", "施工地点", "合同额\n（万元）", "工期\n（月）", "项目归属部门或实体", "项目负责人\n及联系方式", "项目整体\n进度情况", "本月项目\n施工情况", "设备型号\n及数量", "现场\n人数", "现场\n车辆数", "是否进行\n安全自检", "是否存在\n安全隐患", "备注"];
      sheet.getRow(6).values = headers;
      rows.forEach((row, index) => {
        sheet.getRow(index + 7).values = [
          index + 1,
          row.project.name,
          row.projectType?.name ?? "",
          row.constructionLocation ?? "",
          Number(row.contractAmount),
          row.durationMonths ?? "",
          row.reportingOrganization.name,
          [row.projectManager, row.contactInfo].filter(Boolean).join(" / "),
          row.overallProgress ?? "",
          row.monthlyConstructionStatus ?? row.progressSummary,
          row.equipmentModels ?? "",
          row.onsiteCount,
          row.onsiteVehicles,
          row.safetyInspection ? "是" : "否",
          row.safetyHazards ? "是" : "否",
          [row.safetyHazardDetail, row.notes].filter(Boolean).join("；"),
        ];
      });
      sheet.columns = [6, 22, 14, 20, 12, 10, 20, 20, 24, 28, 20, 9, 9, 11, 11, 24].map((width) => ({ width }));
      sheet.getRow(1).height = 28;
      sheet.getRow(6).height = 44;
      sheet.getCell("A1").font = { name: "宋体", size: 16, bold: true };
      sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
      for (let rowNumber = 2; rowNumber <= Math.max(6, rows.length + 6); rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        row.alignment = { vertical: "middle", horizontal: rowNumber === 6 ? "center" : "left", wrapText: true };
        row.font = { name: "宋体", size: rowNumber === 6 ? 10 : 11, bold: rowNumber === 6 };
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
        });
      }
      sheet.views = [{ state: "frozen", ySplit: 6 }];
      sheet.autoFilter = { from: "A6", to: "P6" };
      const buffer = await workbook.xlsx.writeBuffer();
      return reply
        .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${query.month}-field-project-report.xlsx`)}`)
        .send(Buffer.from(buffer));
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
          organizationId: id.optional(),
          projectTypeId: id.optional(),
        })
        .parse(request.query);
      const fields = await prisma.reportField.findMany({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
      });
      const exportMonth = query.year && query.month ? new Date(Date.UTC(query.year, query.month - 1, 1)) : null;
      const submittedOrganizationIds = exportMonth ? (await prisma.departmentMonthStatus.findMany({ where: { reportingYear: exportMonth.getUTCFullYear(), reportingMonth: exportMonth.getUTCMonth() + 1, active: true, status: { in: [...submittedMonthStatuses, "locked"] }, reportType: "projects" }, select: { organizationId: true } })).map((row) => row.organizationId) : undefined;
      const rows = await prisma.projectMonthlyReport.findMany({
        where: {
          ...visibleWhere(request),
          status: "submitted",
          ...(query.projectTypeId ? { projectTypeId: query.projectTypeId } : {}),
          ...(submittedOrganizationIds ? { reportingOrganizationId: { in: query.organizationId ? submittedOrganizationIds.filter((organizationId) => organizationId === query.organizationId) : submittedOrganizationIds } } : query.organizationId ? { reportingOrganizationId: query.organizationId } : {}),
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
