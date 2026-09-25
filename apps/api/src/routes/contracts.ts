import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { ContractAttachmentOwnerType, ContractProjectStage, Prisma } from "@prisma/client";
import { z } from "zod";
import type { Principal } from "../auth.js";
import type { ContractAccess } from "../contract-access.js";
import { assertContractProjectVisible, assertContractProjectWritable, contractProjectWhere, requireContractAccess, resolveContractAccess } from "../contract-access.js";
import { prisma } from "../db.js";

type Guard = (request: FastifyRequest) => Promise<void>;
const idParams = z.object({ id: z.string().uuid() }).strict();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const money = z.string().trim().regex(/^-?\d+(\.\d{1,2})?$/).nullable().optional();
const nonnegativeMoney = z.string().trim().regex(/^\d+(\.\d{1,2})?$/).nullable().optional();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const projectInput = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(50).optional(),
  responsibleOrganizationId: z.string().uuid(),
  projectType: optionalText(120),
  location: optionalText(300),
  managerName: optionalText(80),
  managerPhone: optionalText(20),
  businessSector: optionalText(120),
  bidStatus: z.enum(["bidding", "won", "lost", "abandoned"]).default("bidding"),
  plannedStartAt: date,
  plannedEndAt: date,
}).strict();
const mainContractInput = z.object({
  contractNo: z.string().trim().min(1).max(120),
  partyA: z.string().trim().min(1).max(240),
  amountYuan: nonnegativeMoney,
  annualAmountYuan: nonnegativeMoney,
  signedAt: date,
  handlerName: optionalText(80),
  sourceNote: optionalText(500),
}).strict();
const supplementInput = z.object({ contractNo: z.string().trim().min(1).max(120), amountDeltaYuan: money, signedAt: date, reason: optionalText(500) }).strict();
const subcontractInput = z.object({
  contractNo: z.string().trim().min(1).max(120),
  subcontractorName: z.string().trim().min(1).max(240),
  amountYuan: nonnegativeMoney,
  scope: optionalText(1000),
  signedAt: date,
  owningOrganizationId: z.string().uuid(),
  handlerName: optionalText(80),
}).strict();
const stageInput = z.object({ toStage: z.nativeEnum(ContractProjectStage), reason: optionalText(500) }).strict();
const attachmentInput = z.object({ fileId: z.string().uuid(), ownerType: z.nativeEnum(ContractAttachmentOwnerType), ownerId: z.string().uuid().nullable().optional(), category: optionalText(80), note: optionalText(500) }).strict();
const activateProjectInput = z.object({
  businessSector: optionalText(120),
  bidStatus: z.enum(["bidding", "won", "lost", "abandoned"]).default("won"),
}).strict();
const projectListQuery = z.object({
  q: z.string().trim().max(160).optional(),
  bidStatus: z.enum(["bidding", "won", "lost", "abandoned"]).optional(),
  organizationId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
const projectRevisionPatchInput = projectInput.omit({ code: true, responsibleOrganizationId: true }).partial().extend({ expectedUpdatedAt: z.string().datetime().optional() }).strict()
  .refine((value) => Object.keys(value).some((key) => key !== "expectedUpdatedAt"), "至少提交一个字段");
const grantInput = z.object({
  personId: z.string().uuid(),
  role: z.enum(["admin", "editor", "readonly"]),
  canCreateProject: z.boolean().default(false),
  canEditProject: z.boolean().default(false),
  canManageContracts: z.boolean().default(false),
  canUploadAttachments: z.boolean().default(false),
  canChangeStage: z.boolean().default(false),
  canExport: z.boolean().default(false),
  canViewAll: z.boolean().default(false),
  canManageAccess: z.boolean().default(false),
  reason: z.string().trim().min(1).max(500),
}).strict();
const grantRevokeInput = z.object({ revision: z.number().int().positive(), reason: z.string().trim().min(1).max(500) }).strict();

const normalizeContractNo = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
export const quoteContractCsvCell = (value: unknown) => {
  const raw = String(value ?? "");
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
};
const asDate = (value: string | null | undefined) => value ? new Date(`${value}T00:00:00.000Z`) : value === null ? null : undefined;
const clean = <T extends Record<string, unknown>>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
const httpError = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const isCompanyAdmin = (principal: Principal) => principal.roles.some(({ role }) => role === "company_admin");
const requireGlobalGrantManager = (principal: Principal, access: ContractAccess) => {
  if (isCompanyAdmin(principal)) return;
  requireContractAccess(access, "manageAccess");
  if (!access.canViewAll) throw httpError(403, "CONTRACT_GRANT_SCOPE_FORBIDDEN", "仅全范围授权管理员可以管理合同授权");
};

export const contractStageTransitions: Record<ContractProjectStage, readonly ContractProjectStage[]> = {
  bid_preparation: ["contract_registration", "terminated"],
  contract_registration: ["field_work", "terminated"],
  field_work: ["indoor_sorting", "terminated"],
  indoor_sorting: ["report_drafting", "terminated"],
  report_drafting: ["submitted_review", "terminated"],
  submitted_review: ["accepted", "report_drafting", "terminated"],
  accepted: ["warranty_payment", "closed"],
  warranty_payment: ["closed"],
  closed: [],
  terminated: [],
};

const projectInclude = {
  responsibleOrganization: { select: { id: true, name: true, type: true } },
  mainContract: { include: { supplements: { orderBy: { createdAt: "asc" as const } } } },
  contractSubcontracts: { include: { owningOrganization: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" as const } },
  contractStatusHistory: { orderBy: { createdAt: "desc" as const } },
  contractAttachments: { include: { file: { select: { id: true, originalName: true, mimeType: true, size: true } } }, orderBy: { createdAt: "desc" as const } },
} satisfies Prisma.ProjectInclude;

async function requireScopedOrganization(access: Awaited<ReturnType<typeof resolveContractAccess>>, organizationId: string) {
  if (!access.canViewAll && !access.organizationIds.includes(organizationId)) throw httpError(403, "CONTRACT_ORGANIZATION_FORBIDDEN", "无权在该经营实体下维护项目");
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, type: true } });
  if (!organization || organization.type !== "business_entity") throw httpError(409, "CONTRACT_ORGANIZATION_INVALID", "项目责任组织必须使用现有经营实体的稳定 ID");
}

async function assertAttachmentOwner(projectId: string, ownerType: ContractAttachmentOwnerType, ownerId?: string | null) {
  if (["bid", "project"].includes(ownerType)) {
    if (ownerId && ownerId !== projectId) throw httpError(409, "CONTRACT_ATTACHMENT_OWNER_INVALID", "附件归属与项目不一致");
    return;
  }
  if (!ownerId) throw httpError(400, "CONTRACT_ATTACHMENT_OWNER_REQUIRED", "合同附件必须指定归属记录");
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { mainContractId: true } });
  const valid = ownerType === "main_contract" ? project?.mainContractId === ownerId
    : ownerType === "supplement" ? !!await prisma.contractSupplement.findFirst({ where: { id: ownerId, mainContract: { project: { id: projectId } } }, select: { id: true } })
    : !!await prisma.contractSubcontract.findFirst({ where: { id: ownerId, projectId }, select: { id: true } });
  if (!valid) throw httpError(409, "CONTRACT_ATTACHMENT_OWNER_INVALID", "附件归属记录不属于该项目");
}

export async function registerContractRoutes(app: FastifyInstance, deps: { authenticate: Guard }) {
  app.get("/api/contracts/access", { preHandler: deps.authenticate }, async (request) => ({ data: await resolveContractAccess(request.principal as Principal) }));

  app.get("/api/contracts/organizations", { preHandler: deps.authenticate }, async (request) => {
    const access = await resolveContractAccess(request.principal as Principal); requireContractAccess(access, "enter");
    return { data: await prisma.organization.findMany({ where: { type: "business_entity", ...(access.canViewAll ? {} : { id: { in: access.organizationIds } }) }, select: { id: true, name: true }, orderBy: { name: "asc" } }) };
  });

  app.get("/api/contracts/projects", { preHandler: deps.authenticate }, async (request) => {
    const access = await resolveContractAccess(request.principal as Principal);
    const query = projectListQuery.parse(request.query);
    const where: Prisma.ProjectWhereInput = { AND: [
      contractProjectWhere(access),
      ...(query.q ? [{ OR: [
        { name: { contains: query.q, mode: "insensitive" as const } },
        { code: { contains: query.q, mode: "insensitive" as const } },
        { mainContract: { is: { contractNo: { contains: normalizeContractNo(query.q), mode: "insensitive" as const } } } },
        { mainContract: { is: { partyA: { contains: query.q, mode: "insensitive" as const } } } },
        ...(z.string().uuid().safeParse(query.q).success ? [{ id: query.q }] : []),
      ] }] : []),
      ...(query.bidStatus ? [{ contractBidStatus: query.bidStatus }] : []),
      ...(query.organizationId ? [{ responsibleOrganizationId: query.organizationId }] : []),
    ] };
    const [total, items] = await prisma.$transaction([prisma.project.count({ where }), prisma.project.findMany({
      where,
      include: { responsibleOrganization: { select: { id: true, name: true } }, mainContract: { select: { id: true, contractNo: true, partyA: true, amountYuan: true, signedAt: true } }, _count: { select: { contractSubcontracts: true, contractAttachments: true } } },
      orderBy: { updatedAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    })]);
    return { data: { items, total, page: query.page, pageSize: query.pageSize } };
  });

  app.get("/api/contracts/project-candidates", { preHandler: deps.authenticate }, async (request) => {
    const access = await resolveContractAccess(request.principal as Principal); requireContractAccess(access, "createProject");
    return { data: await prisma.project.findMany({ where: { contractStage: null, ...(access.canViewAll ? {} : { responsibleOrganizationId: { in: access.organizationIds } }) }, select: { id: true, code: true, name: true, status: true, responsibleOrganization: { select: { id: true, name: true } } }, orderBy: { updatedAt: "desc" }, take: 500 }) };
  });

  app.post("/api/contracts/project-candidates/:id/activate", { preHandler: deps.authenticate }, async (request, reply) => {
    const principal = request.principal as Principal; const projectId = idParams.parse(request.params).id;
    const access = await resolveContractAccess(principal); requireContractAccess(access, "createProject"); const input = activateProjectInput.parse(request.body);
    const current = await prisma.project.findUnique({ where: { id: projectId }, select: { responsibleOrganizationId: true, contractStage: true } });
    if (!current || (!access.canViewAll && !access.organizationIds.includes(current.responsibleOrganizationId))) throw httpError(404, "PROJECT_NOT_FOUND", "项目不存在");
    if (current.contractStage) throw httpError(409, "CONTRACT_PROJECT_ALREADY_ACTIVE", "项目已纳入项目与合同管理");
    const project = await prisma.$transaction(async (tx) => {
      const activated = await tx.project.update({ where: { id: projectId }, data: clean({ contractBidStatus: input.bidStatus, contractStage: "bid_preparation", contractBusinessSector: input.businessSector, contractRegisteredAt: new Date(), contractDataSource: "existing_project" }) as Prisma.ProjectUncheckedUpdateInput });
      await tx.contractProjectStatusHistory.create({ data: { projectId, toStage: "bid_preparation", reason: "纳入项目与合同管理（保留既有安全项目行为）", changedBy: principal.accountId } });
      return activated;
    });
    return reply.code(201).send({ data: project });
  });

  app.get("/api/contracts/projects/:id", { preHandler: deps.authenticate }, async (request) => {
    const projectId = idParams.parse(request.params).id;
    const access = await resolveContractAccess(request.principal as Principal); await assertContractProjectVisible(access, projectId);
    return { data: await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: projectInclude }) };
  });

  app.post("/api/contracts/projects", { preHandler: deps.authenticate }, async (request, reply) => {
    const principal = request.principal as Principal;
    const access = await resolveContractAccess(principal); requireContractAccess(access, "createProject");
    const input = projectInput.parse(request.body); await requireScopedOrganization(access, input.responsibleOrganizationId);
    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({ data: clean({
        name: input.name, code: input.code ?? `XM-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`, responsibleOrganizationId: input.responsibleOrganizationId,
        projectType: input.projectType, location: input.location, managerName: input.managerName, managerPhone: input.managerPhone,
        plannedStartAt: asDate(input.plannedStartAt), plannedEndAt: asDate(input.plannedEndAt),
        contractBusinessSector: input.businessSector, contractBidStatus: input.bidStatus, contractStage: "bid_preparation", contractRegisteredAt: new Date(), contractDataSource: "manual",
      }) as Prisma.ProjectUncheckedCreateInput });
      await tx.contractProjectStatusHistory.create({ data: { projectId: created.id, toStage: "bid_preparation", reason: "项目与合同管理建项", changedBy: principal.accountId } });
      return created;
    });
    return reply.code(201).send({ data: project });
  });

  app.patch("/api/contracts/projects/:id", { preHandler: deps.authenticate }, async (request) => {
    const projectId = idParams.parse(request.params).id;
    const access = await resolveContractAccess(request.principal as Principal); requireContractAccess(access, "editProject"); await assertContractProjectWritable(access, projectId);
    const input = projectRevisionPatchInput.parse(request.body);
    const { expectedUpdatedAt, ...projectPatch } = input;
    const { businessSector, bidStatus, plannedStartAt, plannedEndAt, ...rest } = projectPatch;
    if (bidStatus && bidStatus !== "won") {
      const current = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { mainContractId: true, contractDataSource: true } });
      if (current.mainContractId || current.contractDataSource === "existing_project") throw httpError(409, "CONTRACT_BID_STATUS_LOCKED", "已签主合同或既有安全项目不能退回未中标状态");
    }
    const data = clean({ ...rest, contractBusinessSector: businessSector, contractBidStatus: bidStatus, plannedStartAt: asDate(plannedStartAt), plannedEndAt: asDate(plannedEndAt) }) as Prisma.ProjectUncheckedUpdateInput;
    if (expectedUpdatedAt) {
      const updated = await prisma.project.updateMany({ where: { id: projectId, updatedAt: new Date(expectedUpdatedAt) }, data });
      if (updated.count !== 1) throw httpError(409, "CONTRACT_PROJECT_REVISION_CONFLICT", "项目已被他人更新，请载入最新版本后重试");
      return { data: await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: projectInclude }) };
    }
    return { data: await prisma.project.update({ where: { id: projectId }, data }) };
  });

  app.put("/api/contracts/projects/:id/main-contract", { preHandler: deps.authenticate }, async (request) => {
    const principal = request.principal as Principal; const projectId = idParams.parse(request.params).id;
    const access = await resolveContractAccess(principal); requireContractAccess(access, "manageContracts"); await assertContractProjectWritable(access, projectId);
    const input = mainContractInput.parse(request.body); const contractNo = normalizeContractNo(input.contractNo);
    const data = clean({ contractNo, rawContractNo: input.contractNo, partyA: input.partyA, amountYuan: input.amountYuan, annualAmountYuan: input.annualAmountYuan, signedAt: asDate(input.signedAt), handlerName: input.handlerName, sourceNote: input.sourceNote }) as Prisma.ContractMainContractUncheckedCreateInput;
    return { data: await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { mainContractId: true, contractStage: true } });
      const existing = await tx.contractMainContract.findUnique({ where: { contractNo }, include: { project: { select: { id: true, responsibleOrganizationId: true, contractSubcontracts: { select: { owningOrganizationId: true } } } } } });
      if (existing && project.mainContractId && existing.id !== project.mainContractId) throw httpError(409, "CONTRACT_NO_ALREADY_LINKED", "该合同编号已关联其他主合同记录");
      if (existing?.project && !access.canViewAll && !access.organizationIds.includes(existing.project.responsibleOrganizationId) && !existing.project.contractSubcontracts.some((subcontract) => access.organizationIds.includes(subcontract.owningOrganizationId))) {
        throw httpError(404, "CONTRACT_NOT_FOUND", "合同不存在或超出授权范围");
      }
      if (existing?.project && existing.project.id !== projectId) throw httpError(409, "MAIN_CONTRACT_ALREADY_ASSIGNED", "一份主合同只能属于一个项目");
      const contract = project.mainContractId
        ? await tx.contractMainContract.update({ where: { id: project.mainContractId }, data })
        : existing ?? await tx.contractMainContract.create({ data });
      const advancesStage = project.contractStage === "bid_preparation";
      await tx.project.update({ where: { id: projectId }, data: { mainContractId: contract.id, contractBidStatus: "won", ...(advancesStage ? { contractStage: "contract_registration" } : {}) } });
      if (advancesStage) await tx.contractProjectStatusHistory.create({ data: { projectId, fromStage: "bid_preparation", toStage: "contract_registration", reason: "登记主合同", changedBy: principal.accountId } });
      return tx.contractMainContract.findUniqueOrThrow({ where: { id: contract.id } });
    }) };
  });

  app.post("/api/contracts/projects/:id/supplements", { preHandler: deps.authenticate }, async (request, reply) => {
    const projectId = idParams.parse(request.params).id;
    const access = await resolveContractAccess(request.principal as Principal); requireContractAccess(access, "manageContracts"); await assertContractProjectWritable(access, projectId);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { mainContractId: true } });
    if (!project.mainContractId) throw httpError(409, "MAIN_CONTRACT_REQUIRED", "请先登记主合同");
    const input = supplementInput.parse(request.body);
    const row = await prisma.contractSupplement.create({ data: clean({ mainContractId: project.mainContractId, contractNo: normalizeContractNo(input.contractNo), amountDeltaYuan: input.amountDeltaYuan, signedAt: asDate(input.signedAt), reason: input.reason }) as Prisma.ContractSupplementUncheckedCreateInput });
    return reply.code(201).send({ data: row });
  });

  app.post("/api/contracts/projects/:id/subcontracts", { preHandler: deps.authenticate }, async (request, reply) => {
    const projectId = idParams.parse(request.params).id;
    const access = await resolveContractAccess(request.principal as Principal); requireContractAccess(access, "manageContracts"); await assertContractProjectWritable(access, projectId);
    const input = subcontractInput.parse(request.body); await requireScopedOrganization(access, input.owningOrganizationId);
    const row = await prisma.contractSubcontract.create({ data: clean({ projectId, contractNo: normalizeContractNo(input.contractNo), subcontractorName: input.subcontractorName, amountYuan: input.amountYuan, scope: input.scope, signedAt: asDate(input.signedAt), owningOrganizationId: input.owningOrganizationId, handlerName: input.handlerName }) as Prisma.ContractSubcontractUncheckedCreateInput });
    return reply.code(201).send({ data: row });
  });

  app.post("/api/contracts/projects/:id/stage-transitions", { preHandler: deps.authenticate }, async (request, reply) => {
    const principal = request.principal as Principal; const projectId = idParams.parse(request.params).id;
    const access = await resolveContractAccess(principal); requireContractAccess(access, "changeStage"); await assertContractProjectWritable(access, projectId);
    const input = stageInput.parse(request.body);
    const history = await prisma.$transaction(async (tx) => {
      const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { contractStage: true } });
      if (!project.contractStage || !contractStageTransitions[project.contractStage].includes(input.toStage)) throw httpError(409, "CONTRACT_STAGE_TRANSITION_INVALID", "当前阶段不允许该状态变更");
      if (project.contractStage === "submitted_review" && input.toStage === "report_drafting" && !input.reason) throw httpError(400, "CONTRACT_STAGE_REASON_REQUIRED", "审核退回必须填写原因");
      await tx.project.update({ where: { id: projectId }, data: { contractStage: input.toStage } });
      return tx.contractProjectStatusHistory.create({ data: clean({ projectId, fromStage: project.contractStage, toStage: input.toStage, reason: input.reason, changedBy: principal.accountId }) as Prisma.ContractProjectStatusHistoryUncheckedCreateInput });
    });
    return reply.code(201).send({ data: history });
  });

  app.post("/api/contracts/projects/:id/attachments", { preHandler: deps.authenticate }, async (request, reply) => {
    const principal = request.principal as Principal; const projectId = idParams.parse(request.params).id;
    const access = await resolveContractAccess(principal); requireContractAccess(access, "uploadAttachments"); await assertContractProjectWritable(access, projectId);
    const input = attachmentInput.parse(request.body); await assertAttachmentOwner(projectId, input.ownerType, input.ownerId);
    const file = await prisma.privateFile.findUnique({ where: { id: input.fileId }, select: {
      id: true, kind: true, uploadedBy: true,
      _count: { select: { personPhotos: true, personPhotoHistory: true, signatures: true, personCertificates: true, organizationQualifications: true, certificateAttachments: true, monthlyReportAttachments: true, requestAttachments: true, versions: true, coursewareVersionAssets: true, coursewareImportSources: true, receivableAttachments: true, receivableImportBatches: true, contractAttachments: true } },
    } });
    if (!file || file.uploadedBy !== principal.accountId || file.kind !== "attachment") throw httpError(404, "CONTRACT_FILE_NOT_FOUND", "文件不存在或不是当前账号刚上传的附件");
    if (Object.values(file._count).some((count) => count > 0)) throw httpError(409, "CONTRACT_FILE_ALREADY_LINKED", "该文件已关联其他业务记录，请重新上传专用附件");
    const row = await prisma.contractAttachment.create({ data: clean({ projectId, fileId: input.fileId, ownerType: input.ownerType, ownerId: input.ownerId ?? (input.ownerType === "project" || input.ownerType === "bid" ? projectId : null), category: input.category, note: input.note, uploadedBy: principal.accountId }) as Prisma.ContractAttachmentUncheckedCreateInput });
    return reply.code(201).send({ data: row });
  });

  app.get("/api/contracts/projects-export.csv", { preHandler: deps.authenticate }, async (request, reply) => {
    const access = await resolveContractAccess(request.principal as Principal); requireContractAccess(access, "export");
    const rows = await prisma.project.findMany({ where: contractProjectWhere(access), include: { responsibleOrganization: { select: { name: true } }, mainContract: { select: { contractNo: true, partyA: true, amountYuan: true } } }, orderBy: { code: "asc" } });
    const csv = ["项目编号,项目名称,经营实体,投标结果,合同阶段,主合同编号,甲方,主合同金额（元）", ...rows.map((row) => [row.code, row.name, row.responsibleOrganization.name, row.contractBidStatus, row.contractStage, row.mainContract?.contractNo, row.mainContract?.partyA, row.mainContract?.amountYuan].map(quoteContractCsvCell).join(","))].join("\r\n");
    return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", "attachment; filename=contract-projects.csv").send(`\uFEFF${csv}`);
  });

  app.get("/api/contracts/grants", { preHandler: deps.authenticate }, async (request) => {
    const principal = request.principal as Principal; const access = await resolveContractAccess(principal);
    requireGlobalGrantManager(principal, access);
    return { data: await prisma.contractAccessGrant.findMany({ where: { active: true, revokedAt: null }, include: { person: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } }) };
  });

  app.post("/api/contracts/grants", { preHandler: deps.authenticate }, async (request, reply) => {
    const principal = request.principal as Principal; const access = await resolveContractAccess(principal);
    requireGlobalGrantManager(principal, access);
    const input = grantInput.parse(request.body); const { reason, ...grant } = input;
    const person = await prisma.person.findFirst({ where: { id: input.personId, status: "active", account: { status: "active" } }, select: { id: true, account: { select: { id: true } } } });
    if (!person?.account) throw httpError(409, "CONTRACT_GRANTEE_INVALID", "授权对象必须是已绑定的在职人员和有效账号");
    const duplicateGrant = await prisma.contractAccessGrant.findFirst({ where: { personId: person.id, active: true, revokedAt: null }, select: { id: true } });
    if (duplicateGrant) {
      await prisma.auditLog.create({ data: { actorId: principal.accountId, requestId: request.id, action: "contract.grant.create", objectType: "contract_access_grant", objectId: duplicateGrant.id, result: "denied", metadata: { personId: person.id, role: input.role, reason, code: "CONTRACT_GRANT_ALREADY_ACTIVE" } } });
      throw httpError(409, "CONTRACT_GRANT_ALREADY_ACTIVE", "该人员已有有效的合同管理授权，请先撤销后重新授权");
    }
    let row;
    try {
      row = await prisma.contractAccessGrant.create({ data: { ...grant, accountId: person.account.id, grantedBy: principal.accountId, grantReason: reason } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const concurrentGrant = await prisma.contractAccessGrant.findFirst({ where: { personId: person.id, active: true, revokedAt: null }, select: { id: true } });
      if (!concurrentGrant) throw error;
      await prisma.auditLog.create({ data: { actorId: principal.accountId, requestId: request.id, action: "contract.grant.create", objectType: "contract_access_grant", objectId: concurrentGrant.id, result: "denied", metadata: { personId: person.id, role: input.role, reason, code: "CONTRACT_GRANT_ALREADY_ACTIVE", concurrent: true } } });
      throw httpError(409, "CONTRACT_GRANT_ALREADY_ACTIVE", "该人员已有有效的合同管理授权，请先撤销后重新授权");
    }
    return reply.code(201).send({ data: row });
  });

  app.patch("/api/contracts/grants/:id/revoke", { preHandler: deps.authenticate }, async (request) => {
    const principal = request.principal as Principal; const access = await resolveContractAccess(principal);
    requireGlobalGrantManager(principal, access);
    const grantId = idParams.parse(request.params).id; const input = grantRevokeInput.parse(request.body);
    const updated = await prisma.contractAccessGrant.updateMany({ where: { id: grantId, revision: input.revision, active: true, revokedAt: null }, data: { active: false, revision: { increment: 1 }, revokedAt: new Date(), revokedBy: principal.accountId, revokeReason: input.reason } });
    if (updated.count !== 1) throw httpError(409, "CONTRACT_GRANT_REVISION_CONFLICT", "授权已变更，请刷新后重试");
    return { data: await prisma.contractAccessGrant.findUniqueOrThrow({ where: { id: grantId } }) };
  });
}
