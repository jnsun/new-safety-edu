import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma, type TrainingType } from "@prisma/client";
import { z } from "zod";
import { accessibleOrganizationIds, canAccessOrganization, canAccessPerson, canAccessProject, forbidden, isCompanyAdmin, projectScopeIds } from "../access.js";
import { audit, auditCritical } from "../audit.js";
import { verifySensitiveToken, type Principal } from "../auth.js";
import { prisma } from "../db.js";
import type { Env } from "../env.js";
import { decryptNationalId } from "../crypto.js";
import { grantRole, mergeAccounts, reactivatePerson, setPrimaryOrganization } from "../identity.js";
import { autoDispatchInTransaction, freezePaper } from "./day2.js";
import { mergePersons } from "../person-merge.js";
import { changeRequestKey, claimPendingRequest } from "../request-policy.js";
import { writeCriticalAudit } from "../transaction-audit.js";
import { qualificationExpiryMilestone } from "../qualification-policy.js";
import { allowedRequestActions } from "../change-requests.js";
import { assertPersonChangeRequestAllowed, canReviewPersonChange, type PersonChangeRequestType } from "../person-change-policy.js";
import { assertOwnedFiles } from "../file-association-policy.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
type Deps = { env: Env; authenticate: Guard; requireManager: Guard };
const principalOf = (request: FastifyRequest) => request.principal ?? forbidden("未登录");
const idParam = z.object({ id: z.string().uuid() });
const incomplete = ["pending_learning", "learning", "pending_exam", "remediation_required", "locked", "pending_signature", "confirmation_pending"] as const;

async function canLeadOrganization(principal: Principal, organizationId: string) {
  if (isCompanyAdmin(principal)) return true;
  const leader: Principal = { ...principal, roles: principal.roles.filter(({ role }) => role === "org_leader") };
  return (await accessibleOrganizationIds(leader)).includes(organizationId);
}

function transferTarget(row: { payload: Prisma.JsonValue }) {
  const value = (row.payload as Record<string, unknown>).organizationId;
  return typeof value === "string" ? value : null;
}

async function assignmentWhere(principal: Principal, filters: { organizationId?: string | undefined; projectId?: string | undefined; batchId?: string | undefined } = {}): Promise<Prisma.TrainingAssignmentWhereInput> {
  if (filters.organizationId && !await canAccessOrganization(principal, filters.organizationId)) forbidden();
  if (filters.projectId && !await canAccessProject(principal, filters.projectId)) forbidden();
  const orgIds = await accessibleOrganizationIds(principal);
  const projectIds = projectScopeIds(principal);
  const scope: Prisma.TrainingAssignmentWhereInput = isCompanyAdmin(principal) ? {} : { OR: [
    ...(projectIds.length ? [{ batch: { projectId: { in: projectIds } } }] : []),
    ...(orgIds.length ? [{ person: { organizations: { some: { active: true, organizationId: { in: orgIds } } } } }] : [])
  ] };
  return { AND: [scope, ...(filters.organizationId ? [{ person: { organizations: { some: { active: true, organizationId: filters.organizationId } } } }] : []), ...(filters.projectId ? [{ batch: { projectId: filters.projectId } }] : []), ...(filters.batchId ? [{ batchId: filters.batchId }] : [])] };
}

async function assertManagedAssignment(principal: Principal, id: string) {
  const row = await prisma.trainingAssignment.findFirst({ where: { id, ...(await assignmentWhere(principal)) }, include: { batch: true } });
  if (!row) forbidden();
  return row;
}

const displayStatus = (row: { status: string; progress: Array<{ openedAt: Date | null; completedAt: Date | null }>; attempts: Array<{ passed: boolean | null }> }) => {
  if (row.status === "pending_learning" && !row.progress.some((item) => item.openedAt)) return "not_started";
  if (row.status === "remediation_required" || (row.attempts[0]?.passed === false && row.status !== "locked")) return "failed";
  return row.status;
};

async function createNotification(data: { personId: string; assignmentId?: string; title: string; body: string; dedupeKey: string }, env: Env) {
  return prisma.notification.upsert({
    where: { dedupeKey: data.dedupeKey }, update: {}, create: {
      ...data,
      outbox: { create: env.WECHAT_APP_ID && env.WECHAT_APP_SECRET && (env.WECHAT_SUBSCRIBE_TEMPLATE_TASK || env.WECHAT_SUBSCRIBE_TEMPLATE_DUE)
        ? { status: "pending" } : { status: "skipped", lastError: "微信订阅消息未配置，已保留系统内提醒" } }
    }
  });
}

const weekKey = (date: Date) => Math.floor(date.getTime() / (7 * 24 * 60 * 60 * 1000));

export async function generateScheduledReminders(env: Env) {
  const now = new Date(); const dueSoon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const rows = await prisma.trainingAssignment.findMany({ where: { status: { in: [...incomplete] }, batch: { dueAt: { lte: dueSoon } } }, include: { batch: { select: { name: true, dueAt: true } } } });
  for (const row of rows) {
    if (!row.batch.dueAt) continue;
    const overdue = row.batch.dueAt < now;
    await createNotification({ personId: row.personId, assignmentId: row.id, title: overdue ? "培训任务已逾期" : "培训任务即将截止", body: `${row.batch.name}，请尽快完成。`, dedupeKey: overdue ? `overdue:${row.id}:${weekKey(now)}` : `due:${row.id}` }, env);
  }
  const managers = await prisma.roleAssignment.findMany({ where: { active: true, role: { in: ["company_admin", "org_leader", "org_admin", "project_admin"] }, person: { status: "active", account: { status: "active" } } }, include: { person: { select: { id: true } } } });
  for (const role of managers) {
    const overdueWhere: Prisma.TrainingAssignmentWhereInput = { status: { in: [...incomplete] }, batch: { dueAt: { lt: now } } };
    if (["org_leader", "org_admin"].includes(role.role) && role.scopeId) overdueWhere.person = { organizations: { some: { active: true, organizationId: role.scopeId } } };
    if (role.role === "project_admin" && role.scopeId) overdueWhere.batch = { dueAt: { lt: now }, projectId: role.scopeId };
    const count = await prisma.trainingAssignment.count({ where: overdueWhere });
    if (count && role.personId) await createNotification({ personId: role.personId, title: "逾期培训摘要", body: `当前授权范围有 ${count} 人次培训逾期，请在培训管理中查看。`, dedupeKey: `manager-overdue:${role.id}:${weekKey(now)}` }, env);
  }
  const reportSetting = await prisma.reportSetting.upsert({ where: { id: "default" }, create: {}, update: {} });
  const reportMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); const reportKey = reportMonth.toISOString().slice(0, 7); const reportDeadline = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), reportSetting.deadlineDay, 23, 59, 59));
  const entities = await prisma.organization.findMany({ where: { type: "business_entity", reportingEnabled: true }, select: { id: true, name: true } });
    for (const entity of entities) {
      const [reports, noField] = await Promise.all([prisma.projectMonthlyReport.count({ where: { reportingOrganizationId: entity.id, reportMonth, status: "submitted" } }), prisma.departmentMonthStatus.count({ where: { organizationId: entity.id, reportingYear: now.getUTCFullYear(), reportingMonth: now.getUTCMonth() + 1, active: true, noFieldProjects: true } })]);
      if (reports || noField) continue; const near = reportDeadline.getTime() - now.getTime() <= 3 * 86_400_000; if (!near && now < reportDeadline) continue;
      const recipients = managers.filter((role) => role.personId && (["org_leader", "org_admin"].includes(role.role) ? role.scopeId === entity.id : role.role === "company_admin"));
      for (const role of recipients) await createNotification({ personId: role.personId!, title: now > reportDeadline ? "野外项目月报逾期" : "野外项目月报临近截止", body: `${entity.name} ${reportKey} 尚未报送或确认无野外项目。`, dedupeKey: now > reportDeadline ? `report-overdue:${entity.id}:${reportKey}:${weekKey(now)}` : `report-due:${entity.id}:${reportKey}` }, env);
    }
  const certificateSetting = await prisma.certificateSetting.upsert({ where: { id: "default" }, create: {}, update: {} }); const certificateDeadline = new Date(now.getTime() + certificateSetting.warnDays * 86_400_000);
  const expiring = await prisma.personCertificate.findMany({ where: { status: "active", isLongTerm: false, expiresAt: { lte: certificateDeadline } }, select: { id: true, name: true, expiresAt: true, person: { select: { organizations: { where: { active: true, primary: true }, take: 1, select: { organizationId: true } } } } } });
  for (const certificate of expiring) { if (!certificate.expiresAt) continue; const { days, milestone } = qualificationExpiryMilestone(certificate.expiresAt, now, certificateSetting.warnDays); const organizationId = certificate.person.organizations[0]?.organizationId; const recipients = managers.filter((role) => role.personId && (role.role === "company_admin" || (organizationId && ["org_leader", "org_admin"].includes(role.role) && role.scopeId === organizationId))); for (const role of recipients) await createNotification({ personId: role.personId!, title: days < 0 ? "人员证照已到期" : "人员证照即将到期", body: `${certificate.name}需要处理，请进入资质证照模块查看。`, dedupeKey: `certificate-expiry:${certificate.id}:${milestone}:${role.id}` }, env); }
  const expiringUnits = await prisma.organizationQualification.findMany({ where: { status: "active", isLongTerm: false, expiresAt: { lte: certificateDeadline }, organization: { type: { in: ["company", "business_entity"] } } }, select: { id: true, name: true, expiresAt: true, organizationId: true } });
  for (const qualification of expiringUnits) { if (!qualification.expiresAt) continue; const { days, milestone } = qualificationExpiryMilestone(qualification.expiresAt, now, certificateSetting.warnDays); const recipients = managers.filter((role) => role.personId && (role.role === "company_admin" || (["org_leader", "org_admin"].includes(role.role) && role.scopeId === qualification.organizationId))); for (const role of recipients) await createNotification({ personId: role.personId!, title: days < 0 ? "单位资质已到期" : "单位资质即将到期", body: `${qualification.name}需要处理，请进入资质证照模块查看。`, dedupeKey: `organization-qualification-expiry:${qualification.id}:${milestone}:${role.id}` }, env); }
  return rows.length;
}

function requestOrganizationId(row: { payload: Prisma.JsonValue }) {
  const payload = row.payload as Record<string, unknown>;
  const value = payload.organizationId ?? payload.targetOrganizationId;
  return typeof value === "string" ? value : null;
}

const reportLabels: Record<string, string> = { ledger: "三级安全教育台账", cards: "三级安全教育记录卡", attendance: "培训签到表", scores: "考试成绩单", annual: "年度培训统计" };
const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = (rows: Record<string, unknown>[]) => rows.length ? [Object.keys(rows[0]!).map(csvCell).join(","), ...rows.map((row) => Object.values(row).map(csvCell).join(","))].join("\r\n") : "";

async function reportRows(principal: Principal, type: string, query: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const parsed = z.object({ year: z.coerce.number().int().min(2020).max(2100).default(new Date().getFullYear()), batchId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), organizationId: z.string().uuid().optional() }).parse(query);
  const where = await assignmentWhere(principal, parsed);
  const yearRange = { gte: new Date(`${parsed.year}-01-01T00:00:00.000Z`), lt: new Date(`${parsed.year + 1}-01-01T00:00:00.000Z`) };
  const assignments = await prisma.trainingAssignment.findMany({
    where: { ...where, ...(type === "ledger" || type === "cards" ? { batch: { type: "three_level" } } : {}), ...(type === "annual" ? { createdAt: yearRange } : {}) },
    include: { batch: { include: { project: { select: { name: true } }, template: { include: { items: { include: { coursewareVersion: { include: { courseware: { select: { title: true } } } } } } } } } }, person: { include: { organizations: { where: { active: true }, include: { organization: { select: { name: true } } }, orderBy: { primary: "desc" } } } }, progress: true, attempts: { where: { status: "submitted" }, orderBy: { attemptNumber: "desc" } }, signatures: { where: { correctionOfId: null }, take: 1 }, confirmations: { orderBy: { confirmedAt: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" }
  });
  if (type === "annual") {
    const groups = new Map<string, { 年度: number; 培训类型: string; 项目: string; 培训任务数: number; 应培训人数: number; 完成人数: number; 考试通过人数: number }>();
    for (const row of assignments) { const key = `${row.batch.type}:${row.batch.project?.name ?? "公司/组织"}`; const current = groups.get(key) ?? { 年度: parsed.year, 培训类型: row.batch.type, 项目: row.batch.project?.name ?? "公司/组织", 培训任务数: 0, 应培训人数: 0, 完成人数: 0, 考试通过人数: 0 }; current.应培训人数++; if (row.status === "completed") current.完成人数++; if (row.attempts.some((a) => a.passed)) current.考试通过人数++; groups.set(key, current); }
    const batchSets = new Map<string, Set<string>>(); for (const row of assignments) { const key = `${row.batch.type}:${row.batch.project?.name ?? "公司/组织"}`; if (!batchSets.has(key)) batchSets.set(key, new Set()); batchSets.get(key)!.add(row.batchId); }
    return [...groups].map(([key, row]) => ({ ...row, 培训任务数: batchSets.get(key)!.size, 完成率: row.应培训人数 ? `${Math.round(row.完成人数 / row.应培训人数 * 100)}%` : "0%" }));
  }
  return assignments.flatMap<Record<string, unknown>>((row) => {
    const organization = row.person.organizations.map((item) => item.organization.name).join("、"); const latest = row.attempts[0]; const content = row.batch.template?.items.map((item) => item.coursewareVersion.courseware.title).join("、") ?? String((row.batch.offlineDetail as Record<string, unknown> | null)?.content ?? "");
    const base = { 姓名: row.person.name, 所属组织: organization, 培训名称: row.batch.name, 培训类型: row.batch.type, 项目: row.batch.project?.name ?? "", 完成状态: row.status };
    if (type === "ledger") return [{ ...base, 学习完成时间: row.progress.map((p) => p.completedAt).filter(Boolean).sort().at(-1)?.toISOString() ?? row.completedAt?.toISOString() ?? "", 考试成绩: latest?.score === null || latest?.score === undefined ? "" : Number(latest.score), 是否通过: row.batch.paperId ? (latest?.passed ? "是" : "否") : "不要求考试", 签字状态: row.signatures.length ? "已签字" : "未签字" }];
    if (type === "cards") return [{ ...base, 培训内容: content, 培训时间: String((row.batch.offlineDetail as Record<string, unknown> | null)?.date ?? row.createdAt.toISOString()), 考试成绩: latest?.score === null || latest?.score === undefined ? "" : Number(latest.score), 完成时间: row.completedAt?.toISOString() ?? "", 本人签字: row.signatures.length ? "已签字" : "未签字", 签字文件ID: row.signatures[0]?.fileId ?? "", 现场确认人账号: row.confirmations[0]?.confirmedBy ?? "", 现场确认时间: row.confirmations[0]?.confirmedAt.toISOString() ?? "" }];
    if (type === "attendance") return [{ ...base, 培训日期: String((row.batch.offlineDetail as Record<string, unknown> | null)?.date ?? ""), 授课人: String((row.batch.offlineDetail as Record<string, unknown> | null)?.instructor ?? ""), 实际学习完成: row.progress.some((p) => p.completedAt) || row.batch.source === "offline" ? "是" : "否" }];
    return row.attempts.map((attempt) => ({ ...base, 考试时间: attempt.submittedAt?.toISOString() ?? "", 成绩: attempt.score === null ? "" : Number(attempt.score), 是否通过: attempt.passed ? "是" : "否", 考试次数: attempt.attemptNumber }));
  });
}

export async function registerDay4Routes(app: FastifyInstance, deps: Deps) {
  const authenticated = { preHandler: deps.authenticate }; const manager = { preHandler: [deps.authenticate, deps.requireManager] };

  app.get("/api/me/profile", authenticated, async (request) => {
    const principal = principalOf(request); if (!principal.personId) forbidden("账号尚未绑定人员档案");
    const person = await prisma.person.findUniqueOrThrow({ where: { id: principal.personId }, include: { organizations: { where: { active: true }, include: { organization: { select: { id: true, name: true, type: true } } }, orderBy: { primary: "desc" } } } });
    return { data: { id: person.id, name: person.name, type: person.type, status: person.status, phone: person.phone,
      nationalIdMasked: person.nationalIdLast4 ? `**************${person.nationalIdLast4}` : null,
      photoFileId: person.photoFileId, organizations: person.organizations.map(({ primary, organization }) => ({ primary, ...organization })) } };
  });

  app.get("/api/me/profile/sensitive", authenticated, async (request) => {
    const principal = principalOf(request); if (!principal.personId) forbidden("账号尚未绑定人员档案");
    await verifySensitiveToken(request, deps.env, { targetPersonId: principal.personId, field: "nationalId", action: "read" });
    const person = await prisma.person.findUniqueOrThrow({ where: { id: principal.personId } });
    if (!person.nationalIdCipher || !person.nationalIdIv || !person.nationalIdTag) throw Object.assign(new Error("身份证号码尚未补录"), { statusCode: 404, code: "NATIONAL_ID_MISSING" });
    await auditCritical(principal.accountId, "person.self_sensitive_read", "person", person.id, { field: "nationalId" }, "var/audit-fallback.ndjson");
    return { data: { nationalId: decryptNationalId(person.nationalIdCipher, person.nationalIdIv, person.nationalIdTag, deps.env) } };
  });

  app.patch("/api/me/profile/photo", authenticated, async (request) => {
    const principal = principalOf(request); if (!principal.personId) forbidden("账号尚未绑定人员档案");
    const { photoFileId } = z.object({ photoFileId: z.string().uuid() }).parse(request.body);
    const file = await prisma.privateFile.findFirst({ where: { id: photoFileId, kind: "photo", uploadedBy: principal.accountId }, select: { id: true } });
    if (!file) forbidden("只能使用本人刚上传的照片");
    await prisma.$transaction(async (tx) => {
      const current = await tx.person.findUniqueOrThrow({ where: { id: principal.personId! }, select: { photoFileId: true } });
      if (current.photoFileId === photoFileId) return;
      await tx.personPhotoHistory.updateMany({ where: { personId: principal.personId!, active: true }, data: { active: false, endedAt: new Date(), changedBy: principal.accountId } });
      await tx.personPhotoHistory.create({ data: { personId: principal.personId!, fileId: photoFileId, changedBy: principal.accountId } });
      await tx.person.update({ where: { id: principal.personId! }, data: { photoFileId } });
      await writeCriticalAudit(tx, { actorId: principal.accountId, action: "person.self_photo_update", objectType: "person", objectId: principal.personId, metadata: { previousPhotoFileId: current.photoFileId, photoFileId } });
    });
    return { data: { photoFileId } };
  });

  app.get("/api/me/organization-options", authenticated, async () => ({ data: await prisma.organization.findMany({ where: { type: { in: ["department", "business_entity", "contractor"] } }, select: { id: true, name: true, type: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }) }));

  app.post("/api/me/department-transfer-requests", authenticated, async (request, reply) => {
    const principal = principalOf(request); if (!principal.personId) forbidden("账号尚未绑定人员档案");
    const input = z.object({ organizationId: z.string().uuid(), reason: z.string().trim().min(2).max(500) }).parse(request.body);
    const organization = await prisma.organization.findFirst({ where: { id: input.organizationId, type: { in: ["department", "business_entity"] } }, select: { id: true } });
    if (!organization) throw Object.assign(new Error("目标部门不存在"), { statusCode: 404, code: "ORGANIZATION_NOT_FOUND" });
    if (await prisma.organizationMembership.findFirst({ where: { personId: principal.personId, organizationId: input.organizationId, active: true } })) throw Object.assign(new Error("你已属于该部门"), { statusCode: 409, code: "ALREADY_IN_ORGANIZATION" });
    const requestKey = changeRequestKey("department_transfer", principal.personId, input.organizationId);
    const existing = await prisma.changeRequest.findFirst({ where: { type: "department_transfer", status: "pending", requestKey } });
    if (existing) return { data: { id: existing.id, status: existing.status } };
    const row = await prisma.changeRequest.create({ data: { accountId: principal.accountId, personId: principal.personId, type: "department_transfer", requestKey, payload: input } });
    audit(principal.accountId, "department_transfer.request", "change_request", row.id, { organizationId: input.organizationId });
    return reply.code(201).send({ data: { id: row.id, status: row.status } });
  });

  app.get("/api/management/overview", manager, async (request) => {
    const principal = principalOf(request); const filters = z.object({ organizationId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), batchId: z.string().uuid().optional() }).parse(request.query);
    const assignments = await prisma.trainingAssignment.findMany({ where: await assignmentWhere(principal, filters), include: { progress: { select: { openedAt: true, completedAt: true } }, attempts: { where: { status: "submitted" }, select: { passed: true }, orderBy: { attemptNumber: "desc" }, take: 1 }, person: { select: { id: true, name: true } }, batch: { select: { id: true, name: true } } } });
    const pendingRequests = (await visibleRequests(principal)).filter((row) => row.status === "pending").length;
    return { data: { required: assignments.length, completed: assignments.filter((row) => row.status === "completed").length, incomplete: assignments.filter((row) => row.status !== "completed" && row.status !== "cancelled").length, failed: assignments.filter((row) => displayStatus(row) === "failed").length, locked: assignments.filter((row) => row.status === "locked").length, pendingRequests, people: assignments.filter((row) => row.status !== "completed" && row.status !== "cancelled").slice(0, 50).map((row) => ({ id: row.id, person: row.person, batch: row.batch, status: displayStatus(row) })) } };
  });

  app.get("/api/management/assignments", manager, async (request) => {
    const principal = principalOf(request); const query = z.object({ organizationId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), batchId: z.string().uuid().optional(), status: z.string().optional() }).parse(request.query);
    const rows = await prisma.trainingAssignment.findMany({ where: await assignmentWhere(principal, query), include: { person: { include: { organizations: { where: { active: true }, include: { organization: { select: { id: true, name: true } } } } } }, batch: { include: { project: { select: { id: true, name: true } } } }, progress: { select: { openedAt: true, completedAt: true } }, attempts: { where: { status: "submitted" }, select: { attemptNumber: true, score: true, passed: true, submittedAt: true }, orderBy: { attemptNumber: "desc" } }, signatures: { where: { correctionOfId: null }, select: { signedAt: true }, take: 1 }, confirmations: { orderBy: { confirmedAt: "desc" } } }, orderBy: { createdAt: "desc" } });
    const mapped = rows.map((row) => ({ id: row.id, status: row.status, displayStatus: displayStatus(row), completedAt: row.completedAt, person: { id: row.person.id, name: row.person.name, organizations: row.person.organizations.map((item) => item.organization) }, batch: { id: row.batch.id, name: row.batch.name, type: row.batch.type, source: row.batch.source, project: row.batch.project }, progress: { completed: row.progress.filter((item) => item.completedAt).length, total: row.progress.length }, latestAttempt: row.attempts[0] ? { ...row.attempts[0], score: row.attempts[0].score === null ? null : Number(row.attempts[0].score) } : null, attemptCount: row.attempts.length, signedAt: row.signatures[0]?.signedAt ?? null, confirmation: row.confirmations[0] ?? null }));
    return { data: query.status ? mapped.filter((row) => row.displayStatus === query.status || row.status === query.status) : mapped };
  });

  app.post("/api/management/reminders", manager, async (request) => {
    const principal = principalOf(request); const ids = z.object({ assignmentIds: z.array(z.string().uuid()).min(1).max(200) }).parse(request.body).assignmentIds; let created = 0; const bucket = Math.floor(Date.now() / 600_000);
    for (const id of [...new Set(ids)]) { const row = await assertManagedAssignment(principal, id); const dedupeKey = `manual:${id}:${bucket}`; const existed = await prisma.notification.count({ where: { dedupeKey } }); await createNotification({ personId: row.personId, assignmentId: id, title: "培训任务催办", body: `${row.batch.name}尚未完成，请尽快处理。`, dedupeKey }, deps.env); if (!existed) created++; }
    audit(principal.accountId, "training.remind", "training_assignment", undefined, { assignmentIds: ids, created }); return { data: { requested: ids.length, created } };
  });

  app.post("/api/management/assignments/:id/unlock", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const row = await assertManagedAssignment(principal, id); const { reason } = z.object({ reason: z.string().trim().min(2).max(300) }).parse(request.body);
    if (row.status !== "locked") throw Object.assign(new Error("任务未锁定"), { statusCode: 409, code: "NOT_LOCKED" });
    const attemptsBefore = await prisma.examAttempt.count({ where: { assignmentId: id } }); const originals = await prisma.learningProgress.findMany({ where: { assignmentId: id, remediationRound: 0 }, select: { coursewareVersionId: true } });
    await prisma.$transaction(async (tx) => { const changed = await tx.trainingAssignment.updateMany({ where: { id, status: "locked" }, data: { status: "remediation_required", extraAttempts: { increment: 1 } } }); if (!changed.count) throw Object.assign(new Error("任务已被其他人处理"), { statusCode: 409, code: "ASSIGNMENT_ALREADY_CHANGED" }); await tx.learningProgress.createMany({ data: originals.map((item) => ({ assignmentId: id, coursewareVersionId: item.coursewareVersionId, remediationRound: attemptsBefore })), skipDuplicates: true }); await writeCriticalAudit(tx, { actorId: principal.accountId, action: "assignment.unlock", objectType: "training_assignment", objectId: id, reason, metadata: { before: "locked", attemptsBefore, addedAttempts: 1 } }); }); return { data: { status: "remediation_required", attemptsBefore, addedAttempts: 1 } };
  });

  app.post("/api/management/confirmations", manager, async (request) => {
    const principal = principalOf(request); const input = z.object({ assignmentIds: z.array(z.string().uuid()).min(1).max(200), note: z.string().trim().max(300).optional() }).parse(request.body); let confirmed = 0;
    if (isCompanyAdmin(principal)) forbidden("公司管理员只查看项目现场确认记录，不代为确认");
    for (const id of [...new Set(input.assignmentIds)]) { const row = await assertManagedAssignment(principal, id); if (row.personId === principal.personId) forbidden("不能确认本人已到场或已接受现场交底"); if (row.batch.type !== "project_induction" && row.batch.source !== "reconfirmation") throw Object.assign(new Error("仅项目入场或重新确认任务可现场确认"), { statusCode: 409, code: "CONFIRMATION_NOT_REQUIRED" }); if (!row.batch.projectId || !await canAccessProject(principal, row.batch.projectId)) forbidden(); if (row.status !== "confirmation_pending") continue; const round = await prisma.projectConfirmation.count({ where: { assignmentId: id } }); await prisma.$transaction(async (tx) => { const changed = await tx.trainingAssignment.updateMany({ where: { id, status: "confirmation_pending" }, data: { status: "completed", completedAt: new Date() } }); if (!changed.count) return; const confirmation = await tx.projectConfirmation.create({ data: { assignmentId: id, confirmedBy: principal.accountId, note: input.note ?? null, round } }); await writeCriticalAudit(tx, { actorId: principal.accountId, action: "project.confirm", objectType: "project_confirmation", objectId: confirmation.id, reason: input.note ?? null, metadata: { assignmentId: id, projectId: row.batch.projectId } }); confirmed++; }); }
    return { data: { confirmed } };
  });

  app.post("/api/management/projects/:id/reconfirmation", manager, async (request, reply) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); if (!await canAccessProject(principal, id)) forbidden(); const personIds = z.object({ personIds: z.array(z.string().uuid()).min(1).max(500) }).parse(request.body).personIds; const project = await prisma.project.findUniqueOrThrow({ where: { id } }); if (project.status !== "active") throw Object.assign(new Error("项目必须处于 active 状态"), { statusCode: 409, code: "PROJECT_NOT_ACTIVE" });
    const members = await prisma.projectMember.findMany({ where: { projectId: id, personId: { in: [...new Set(personIds)] }, status: "active" }, select: { personId: true } }); if (!members.length) throw Object.assign(new Error("没有有效项目成员"), { statusCode: 400, code: "NO_TARGETS" });
    const batch = await prisma.trainingBatch.create({ data: { businessKey: `reconfirmation:${id}:${randomUUID()}`, name: `${project.name}重新现场确认`, type: "project_induction", source: "reconfirmation", projectId: id, assignments: { create: members.map(({ personId }) => ({ personId, status: "confirmation_pending" })) } } }); audit(principal.accountId, "project.reconfirmation.create", "training_batch", batch.id, { count: members.length }); return reply.code(201).send({ data: { id: batch.id, count: members.length } });
  });

  app.post("/api/management/offline-batches", manager, async (request, reply) => {
    const principal = principalOf(request); const input = z.object({ name: z.string().trim().min(2).max(180), type: z.enum(["three_level", "project_induction", "routine", "change_update"]), content: z.string().trim().min(2).max(3000), date: z.coerce.date(), startTime: z.string().max(10).optional(), endTime: z.string().max(10).optional(), hours: z.number().positive().max(24), instructor: z.string().trim().min(2).max(80), organizationId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), personIds: z.array(z.string().uuid()).min(1).max(1000), note: z.string().max(1000).optional(), attachmentIds: z.array(z.string().uuid()).max(20).default([]), paperId: z.string().uuid().optional(), dueAt: z.coerce.date().optional() }).parse(request.body);
    if (input.organizationId && !await canAccessOrganization(principal, input.organizationId)) forbidden(); if (input.projectId && !await canAccessProject(principal, input.projectId)) forbidden(); if (input.type === "project_induction" && !input.projectId) throw Object.assign(new Error("项目入场教育必须选择项目"), { statusCode: 400, code: "PROJECT_REQUIRED" });
    if (["three_level", "project_induction"].includes(input.type) && !input.paperId) throw Object.assign(new Error("三级教育和项目入场教育必须配置考试"), { statusCode: 400, code: "EXAM_REQUIRED" });
    const paperSnapshot = input.paperId ? await freezePaper(input.paperId) : undefined;
    const persons = await prisma.person.findMany({ where: { id: { in: [...new Set(input.personIds)] }, status: "active" }, select: { id: true } }); for (const person of persons) if (!await canAccessPerson(principal, person.id)) forbidden(); if (persons.length !== new Set(input.personIds).size) throw Object.assign(new Error("参加人员无效或超出范围"), { statusCode: 400, code: "INVALID_PARTICIPANTS" });
    if (input.attachmentIds.length !== await prisma.privateFile.count({ where: { id: { in: input.attachmentIds }, kind: "attachment", uploadedBy: principal.accountId } })) forbidden("附件无效");
    const detail = { content: input.content, date: input.date.toISOString(), startTime: input.startTime, endTime: input.endTime, hours: input.hours, instructor: input.instructor, organizationId: input.organizationId, note: input.note, attachmentIds: input.attachmentIds };
    const batch = await prisma.trainingBatch.create({ data: { businessKey: `offline:${randomUUID()}`, name: input.name, type: input.type as TrainingType, source: "offline", projectId: input.projectId ?? null, paperId: input.paperId ?? null, paperSnapshot: paperSnapshot as unknown as Prisma.InputJsonValue, dueAt: input.dueAt ?? null, offlineDetail: detail as Prisma.InputJsonValue, assignments: { create: persons.map(({ id }) => input.paperId ? { personId: id, status: "pending_exam" } : { personId: id, status: "pending_signature" }) } } }); audit(principal.accountId, "offline_training.create", "training_batch", batch.id, { count: persons.length }); return reply.code(201).send({ data: { id: batch.id, count: persons.length } });
  });

  app.post("/api/management/assignments/:id/assisted-sign", manager, async (request, reply) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const assignment = await assertManagedAssignment(principal, id);
    if (assignment.status !== "pending_signature") throw Object.assign(new Error("当前任务不可签字"), { statusCode: 409, code: "INVALID_ASSIGNMENT_STATE" });
    const input = z.object({ fileId: z.string().uuid(), deviceInfo: z.record(z.string(), z.unknown()).optional(), witnessedPersonWriting: z.literal(true) }).parse(request.body);
    const file = await prisma.privateFile.findFirst({ where: { id: input.fileId, kind: "signature", uploadedBy: principal.accountId }, select: { id: true } }); if (!file) forbidden("辅助签字文件无效");
    const recordHash = createHash("sha256").update(JSON.stringify({ assignmentId: id, personId: assignment.personId, batchId: assignment.batchId })).digest("hex");
    const signature = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM training_assignments WHERE id = ${id}::uuid FOR UPDATE`;
      if (await tx.signature.findFirst({ where: { assignmentId: id, correctionOfId: null } })) throw Object.assign(new Error("正式签字已提交，不可覆盖"), { statusCode: 409, code: "SIGNATURE_EXISTS" });
      const created = await tx.signature.create({ data: { assignmentId: id, personId: assignment.personId, fileId: input.fileId, recordHash, deviceInfo: { ...(input.deviceInfo ?? {}), assistedBy: principal.accountId, witnessedPersonWriting: true } } });
      await tx.trainingAssignment.update({ where: { id }, data: assignment.batch.type === "project_induction" ? { status: "confirmation_pending" } : { status: "completed", completedAt: new Date() } }); await writeCriticalAudit(tx, { actorId: principal.accountId, action: "assignment.assisted_sign", objectType: "signature", objectId: created.id, metadata: { assignmentId: id, personId: assignment.personId, witnessedPersonWriting: true } }); return created;
    });
    return reply.code(201).send({ data: { id: signature.id, signedAt: signature.signedAt } });
  });

  app.get("/api/me/notifications", authenticated, async (request) => { const principal = principalOf(request); if (!principal.personId) forbidden("账号尚未绑定人员档案"); return { data: await prisma.notification.findMany({ where: { personId: principal.personId }, orderBy: { createdAt: "desc" }, take: 100 }) }; });
  app.patch("/api/me/notifications/:id/read", authenticated, async (request) => { const principal = principalOf(request); const { id } = idParam.parse(request.params); if (!principal.personId) forbidden(); const result = await prisma.notification.updateMany({ where: { id, personId: principal.personId }, data: { status: "read" } }); if (!result.count) forbidden(); return { data: { status: "read" } }; });

  app.get("/api/me/change-requests", authenticated, async (request) => {
    const principal = principalOf(request);
    const rows = await prisma.changeRequest.findMany({
      where: { OR: [{ accountId: principal.accountId }, ...(principal.personId ? [{ personId: principal.personId }] : [])] },
      select: { id: true, type: true, status: true, payload: true, reviewNote: true, reviewedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" }
    });
    return { data: rows.map(({ payload, ...row }) => ({
      ...row,
      reviewStage: row.type === "binding" && row.status === "pending"
        ? (payload as Record<string, unknown>).escalatedToCompany === true ? "company_review" : "organization_review"
        : row.status,
      availableActions: row.status === "pending" ? ["withdraw"] : []
    })) };
  });
  app.post("/api/me/change-requests/:id/withdraw", authenticated, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const { reason } = z.object({ reason: z.string().trim().min(2).max(500) }).parse(request.body);
    const row = await prisma.changeRequest.findFirst({ where: { id, OR: [{ accountId: principal.accountId }, ...(principal.personId ? [{ personId: principal.personId }] : [])] }, select: { id: true, type: true } });
    if (!row) forbidden("只能撤回本人尚未处理的申请");
    await prisma.$transaction(async (tx) => {
      await claimPendingRequest(tx, id, { status: "withdrawn", reviewedBy: principal.accountId, reviewNote: reason });
      await writeCriticalAudit(tx, { actorId: principal.accountId, action: "change_request.withdraw", objectType: "change_request", objectId: id, requestId: id, reason, metadata: { type: row.type } });
    });
    return { data: { status: "withdrawn" } };
  });
  app.post("/api/me/change-requests", authenticated, async (request, reply) => {
    const principal = principalOf(request); if (!principal.personId) forbidden("账号尚未绑定人员档案");
    const input = z.object({ type: z.enum(["profile_change", "binding_change", "identity_correction", "contractor_unit_change", "responsible_entity_change"]), name: z.string().trim().min(2).max(80).optional(), phone: z.string().regex(/^1\d{10}$/).optional(), newPersonType: z.enum(["employee", "contractor", "temporary_individual"]).optional(), organizationId: z.string().uuid().optional(), contractorOrganizationId: z.string().uuid().optional(), attachmentIds: z.array(z.string().uuid()).max(10).default([]), reason: z.string().trim().min(2).max(500) }).parse(request.body);
    if (input.phone) throw Object.assign(new Error("修改手机号必须先完成短信验证"), { statusCode: 409, code: "SMS_VERIFICATION_REQUIRED" });
    if (input.type === "binding_change") throw Object.assign(new Error("微信换绑必须由新微信登录并完成手机号短信验证"), { statusCode: 409, code: "WECHAT_REBIND_VERIFICATION_REQUIRED" });
    if (input.type === "profile_change" && !input.name) throw Object.assign(new Error("请填写需要修改的姓名"), { statusCode: 400, code: "CHANGE_REQUIRED" });
    const person = await prisma.person.findUniqueOrThrow({ where: { id: principal.personId }, select: { type: true, status: true, organizations: { where: { active: true, primary: true }, take: 1, select: { organizationId: true } } } });
    if (["identity_correction", "contractor_unit_change", "responsible_entity_change"].includes(input.type)) {
      assertPersonChangeRequestAllowed({ requestType: input.type as PersonChangeRequestType, currentPersonType: person.type, ...(input.newPersonType ? { nextPersonType: input.newPersonType } : {}) });
      if (input.type !== "identity_correction" && !input.organizationId) throw Object.assign(new Error("请选择目标组织"), { statusCode: 400, code: "TARGET_ORGANIZATION_REQUIRED" });
      if (input.type === "identity_correction" && input.newPersonType === "contractor" && !input.contractorOrganizationId) throw Object.assign(new Error("更正为外协人员时必须选择外协单位"), { statusCode: 400, code: "CONTRACTOR_ORGANIZATION_REQUIRED" });
      if (input.type === "identity_correction" && ["contractor", "temporary_individual"].includes(input.newPersonType ?? "") && !input.organizationId) throw Object.assign(new Error("更正为外部人员时必须选择内部责任经营实体"), { statusCode: 400, code: "RESPONSIBLE_ORGANIZATION_REQUIRED" });
      const organizationIds = [input.organizationId, input.contractorOrganizationId].filter((value): value is string => !!value);
      const organizations = await prisma.organization.findMany({ where: { id: { in: organizationIds } }, select: { id: true, type: true } });
      const byId = new Map(organizations.map((organization) => [organization.id, organization.type]));
      if (input.organizationId && ((input.type === "contractor_unit_change" && byId.get(input.organizationId) !== "contractor") || (input.type !== "contractor_unit_change" && byId.get(input.organizationId) !== "business_entity"))) throw Object.assign(new Error("目标组织类型不符合申请要求"), { statusCode: 409, code: "TARGET_ORGANIZATION_TYPE_INVALID" });
      if (input.contractorOrganizationId && byId.get(input.contractorOrganizationId) !== "contractor") throw Object.assign(new Error("外协单位类型无效"), { statusCode: 409, code: "CONTRACTOR_ORGANIZATION_INVALID" });
    }
    if (input.attachmentIds.length) {
      if (!["identity_correction", "contractor_unit_change", "responsible_entity_change"].includes(input.type)) throw Object.assign(new Error("该申请类型不接受附件"), { statusCode: 400, code: "REQUEST_ATTACHMENTS_NOT_ALLOWED" });
      const files = await prisma.privateFile.findMany({ where: { id: { in: input.attachmentIds } }, select: { id: true, uploadedBy: true, kind: true } });
      assertOwnedFiles(files, input.attachmentIds, principal.accountId, "attachment");
    }
    const targetKey = input.type === "profile_change" ? input.name ?? "" : [input.newPersonType, input.organizationId, input.contractorOrganizationId].filter(Boolean).join(":");
    const requestKey = changeRequestKey(input.type, principal.personId, targetKey);
    const existing = await prisma.changeRequest.findFirst({ where: { type: input.type, status: "pending", requestKey } });
    if (existing) return { data: { id: existing.id, status: existing.status } };
    const row = await prisma.$transaction(async (tx) => {
      const { attachmentIds, ...safePayload } = input;
      const created = await tx.changeRequest.create({ data: { accountId: principal.accountId, personId: principal.personId, type: input.type, requestKey, payload: safePayload, beforeSummary: { personType: person.type }, attachments: { create: attachmentIds.map((fileId) => ({ fileId })) } } });
      await writeCriticalAudit(tx, { actorId: principal.accountId, action: "change_request.create", objectType: "change_request", objectId: created.id, requestId: created.id, reason: input.reason, metadata: { type: input.type } });
      const reviewerWhere: Prisma.RoleAssignmentWhereInput = input.type === "identity_correction"
        ? { role: "company_admin", scopeType: "company", active: true }
        : input.type === "responsible_entity_change" && input.organizationId
          ? { role: "org_leader", scopeType: "organization", scopeId: input.organizationId, active: true }
          : input.type === "contractor_unit_change" && person.organizations[0]?.organizationId
            ? { role: "org_leader", scopeType: "organization", scopeId: person.organizations[0].organizationId, active: true }
            : { id: "00000000-0000-0000-0000-000000000000" };
      const reviewers = await tx.roleAssignment.findMany({ where: reviewerWhere, select: { personId: true } });
      for (const reviewer of reviewers) if (reviewer.personId && reviewer.personId !== principal.personId) await tx.notification.upsert({ where: { dedupeKey: `change-request-pending:${created.id}:${reviewer.personId}` }, update: {}, create: { personId: reviewer.personId, title: "有新的待处理申请", body: "有一项人员资料或关系申请等待处理，请进入申请与审核查看。", dedupeKey: `change-request-pending:${created.id}:${reviewer.personId}` } });
      return created;
    });
    return reply.code(201).send({ data: { id: row.id, status: row.status } });
  });
  app.post("/api/me/projects/:id/exit-request", authenticated, async (request, reply) => {
    const principal = principalOf(request); if (!principal.personId) forbidden("账号尚未绑定人员档案"); const { id: projectId } = idParam.parse(request.params);
    const { reason } = z.object({ reason: z.string().trim().min(2).max(500) }).parse(request.body);
    const membership = await prisma.projectMember.findFirst({ where: { projectId, personId: principal.personId, status: { in: ["active", "approved"] } }, select: { id: true } });
    if (!membership) throw Object.assign(new Error("当前不是该项目的有效成员"), { statusCode: 409, code: "PROJECT_MEMBERSHIP_NOT_ACTIVE" });
    const requestKey = changeRequestKey("project_exit", membership.id, projectId);
    const existing = await prisma.changeRequest.findFirst({ where: { type: "project_exit", requestKey, status: "pending" } }); if (existing) return { data: { id: existing.id, status: existing.status } };
    const row = await prisma.changeRequest.create({ data: { accountId: principal.accountId, personId: principal.personId, projectId, type: "project_exit", requestKey, payload: { reason, membershipId: membership.id } } });
    return reply.code(201).send({ data: { id: row.id, status: row.status } });
  });

  app.get("/api/management/requests", manager, async (request) => { const principal = principalOf(request); const rows = (await visibleRequests(principal)).filter((row) => row.type !== "binding"); const ids = [...new Set(rows.map(transferTarget).filter((id): id is string => !!id))]; const organizations = new Map((await prisma.organization.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(({ id, name }) => [id, name])); return { data: rows.map((row) => safeRequest(row, organizations, principal)) }; });
  app.get("/api/management/requests/:id", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const row = (await visibleRequests(principal)).find((item) => item.id === id); if (!row) forbidden();
    const ids = [transferTarget(row)].filter((value): value is string => !!value); const organizations = new Map((await prisma.organization.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(({ id, name }) => [id, name]));
    return { data: safeRequest(row, organizations, principal) };
  });
  app.post("/api/management/requests/:id/cancel", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const { reason } = z.object({ reason: z.string().trim().min(2).max(500) }).parse(request.body);
    const row = (await visibleRequests(principal)).find((item) => item.id === id); if (!row) forbidden();
    if (!isCompanyAdmin(principal) && row.accountId !== principal.accountId) forbidden("仅发起人或公司管理员可以取消申请");
    await prisma.$transaction(async (tx) => {
      await claimPendingRequest(tx, id, { status: "cancelled", reviewedBy: principal.accountId, reviewNote: reason });
      await writeCriticalAudit(tx, { actorId: principal.accountId, action: "change_request.cancel", objectType: "change_request", objectId: id, requestId: id, reason, metadata: { type: row.type } });
    });
    return { data: { status: "cancelled" } };
  });
  app.post("/api/management/requests/:id/reject", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const { note } = z.object({ note: z.string().trim().min(2).max(500) }).parse(request.body);
    const row = (await visibleRequests(principal)).find((item) => item.id === id); if (!row) forbidden();
    if (row.type === "binding") throw Object.assign(new Error("身份绑定申请请使用专用审核操作"), { statusCode: 409, code: "IDENTITY_REVIEW_REQUIRED" });
    if (["account_merge", "person_merge", "identity_correction", "account_recovery"].includes(row.type)) { if (!isCompanyAdmin(principal)) forbidden("仅公司管理员可以处理该申请"); await verifySensitiveToken(request, deps.env); }
    if (row.type === "department_transfer") { const target = transferTarget(row); if (!target || !await canLeadOrganization(principal, target)) forbidden("仅目标部门负责人可审批调换部门申请"); }
    await prisma.$transaction(async (tx) => {
      await claimPendingRequest(tx, id, { status: "rejected", reviewedBy: principal.accountId, reviewNote: note });
      await writeCriticalAudit(tx, { actorId: principal.accountId, action: row.type === "account_merge" ? "account.merge_reject" : row.type === "person_merge" ? "person.merge_reject" : "change_request.reject", objectType: "change_request", objectId: id, reason: note, metadata: { type: row.type } });
    });
    return { data: { status: "rejected" } };
  });
  app.post("/api/management/requests/:id/approve", manager, async (request) => { const principal = principalOf(request); const { id } = idParam.parse(request.params); const { note } = z.object({ note: z.string().trim().max(500).default("") }).parse(request.body); const row = (await visibleRequests(principal)).find((item) => item.id === id); if (!row) forbidden(); if (row.status !== "pending" || !["profile_change", "binding_change", "department_transfer", "account_merge", "person_merge", "project_exit", "cross_entity_project_admin", "person_reactivation", "identity_correction", "contractor_unit_change", "responsible_entity_change", "account_recovery"].includes(row.type)) throw Object.assign(new Error("该申请请使用对应的专用审核操作"), { statusCode: 409, code: "SPECIAL_APPROVAL_REQUIRED" }); const payload = row.payload as Record<string, unknown>;
    if (row.type === "binding_change") throw Object.assign(new Error("旧微信换绑申请不能直接批准，请申请人使用新微信完成手机号验证"), { statusCode: 409, code: "WECHAT_REBIND_VERIFICATION_REQUIRED" });
    if (row.type === "account_merge") {
      if (!isCompanyAdmin(principal)) forbidden("仅公司管理员可以确认账号合并");
      await verifySensitiveToken(request, deps.env);
      if (note.trim().length < 2) throw Object.assign(new Error("请填写账号合并确认原因"), { statusCode: 400, code: "MERGE_REASON_REQUIRED" });
      const targetAccountId = z.string().uuid().parse(payload.targetAccountId);
      if (!row.accountId) throw Object.assign(new Error("账号合并申请缺少来源账号"), { statusCode: 409, code: "ACCOUNT_MERGE_INVALID" });
      await prisma.$transaction(async (tx) => {
        await claimPendingRequest(tx, id, { status: "approved", reviewedBy: principal.accountId, reviewNote: note });
        await mergeAccounts(tx, { sourceAccountId: row.accountId!, targetAccountId, actorId: principal.accountId, reason: note });
        if (row.personId) await tx.changeRequest.updateMany({ where: { accountId: row.accountId!, personId: row.personId, type: "binding", status: "pending" }, data: { status: "approved", reviewedBy: principal.accountId, reviewedAt: new Date(), reviewNote: "账号合并后完成绑定" } });
        await writeCriticalAudit(tx, { actorId: principal.accountId, action: "account.merge", objectType: "account", objectId: row.accountId, requestId: id, reason: note, metadata: { targetAccountId } });
      });
      return { data: { status: "approved" } };
    }
    if (row.type === "account_recovery") {
      if (!isCompanyAdmin(principal)) forbidden("仅公司管理员可以处理账号找回");
      await verifySensitiveToken(request, deps.env);
      if (note.trim().length < 2) throw Object.assign(new Error("请填写线下核验和处理意见"), { statusCode: 400, code: "REVIEW_NOTE_REQUIRED" });
      await prisma.$transaction(async (tx) => {
        await claimPendingRequest(tx, id, { status: "approved", reviewedBy: principal.accountId, reviewNote: note });
        if (row.accountId) { await tx.account.update({ where: { id: row.accountId }, data: { sessionVersion: { increment: 1 } } }); await tx.refreshSession.updateMany({ where: { accountId: row.accountId, revokedAt: null }, data: { revokedAt: new Date() } }); }
        await writeCriticalAudit(tx, { actorId: principal.accountId, action: "account.recovery_review", objectType: "change_request", objectId: id, requestId: id, reason: note, metadata: { accountId: row.accountId, personId: row.personId } });
      });
      return { data: { status: "approved", nextAction: "由本人验证新手机号或微信；需要后台密码时由公司管理员另行设置临时密码" } };
    }
    if (row.type === "person_merge") {
      if (!isCompanyAdmin(principal)) forbidden("仅公司管理员可以确认人员合并");
      await verifySensitiveToken(request, deps.env);
      if (note.trim().length < 2) throw Object.assign(new Error("请填写人员合并确认原因"), { statusCode: 400, code: "MERGE_REASON_REQUIRED" });
      const targetPersonId = z.string().uuid().parse(payload.targetPersonId);
      if (!row.personId) throw Object.assign(new Error("人员合并申请缺少来源档案"), { statusCode: 409, code: "PERSON_MERGE_INVALID" });
      await prisma.$transaction(async (tx) => {
        await claimPendingRequest(tx, id, { status: "approved", reviewedBy: principal.accountId, reviewNote: note });
        await mergePersons(tx, { sourcePersonId: row.personId!, targetPersonId, actorAccountId: principal.accountId, actorPersonId: principal.personId, reason: note });
        await tx.changeRequest.update({ where: { id }, data: { afterSummary: { mergedIntoPersonId: targetPersonId } } });
        await writeCriticalAudit(tx, { actorId: principal.accountId, action: "person.merge", objectType: "person", objectId: row.personId, requestId: id, reason: note, metadata: { targetPersonId } });
      });
      return { data: { status: "approved" } };
    }
    if (row.type === "department_transfer") {
      const target = transferTarget(row);
      if (!row.personId || !target || !await canLeadOrganization(principal, target)) forbidden("仅目标组织负责人可审批调换组织申请");
      const targetOrganization = await prisma.organization.findFirst({ where: { id: target, type: { in: ["department", "business_entity"] } }, select: { id: true, name: true } });
      if (!targetOrganization) throw Object.assign(new Error("目标组织不存在或类型不允许"), { statusCode: 409, code: "TRANSFER_TARGET_INVALID" });
      const previous = await prisma.organizationMembership.findFirst({ where: { personId: row.personId, active: true, primary: true }, select: { organizationId: true } });
      const previousLeaders = previous ? await prisma.roleAssignment.findMany({ where: { role: "org_leader", scopeType: "organization", scopeId: previous.organizationId, active: true }, select: { personId: true } }) : [];
      await prisma.$transaction(async (tx) => {
        await claimPendingRequest(tx, id, { status: "approved", reviewedBy: principal.accountId, reviewNote: note });
        await setPrimaryOrganization(tx, { personId: row.personId!, organizationId: target, actorId: principal.accountId, reason: note || "组织调换申请审批通过" });
        for (const leader of previousLeaders) if (leader.personId) await tx.notification.create({ data: { personId: leader.personId, title: "人员组织调换结果", body: `一名人员已调入${targetOrganization.name}，详情请在人员档案中查看。`, dedupeKey: `transfer-result:${id}:${leader.personId}` } });
        await writeCriticalAudit(tx, { actorId: principal.accountId, action: "change_request.approve", objectType: "change_request", objectId: id, requestId: id, reason: note || "组织调换申请审批通过", metadata: { type: row.type } });
      });
    }
    else if (row.type === "project_exit") {
      if (!row.projectId || !row.personId || !await canAccessProject(principal, row.projectId)) forbidden("仅项目管理范围内可以处理退出申请");
      const membershipId = z.string().uuid().parse(payload.membershipId);
      await prisma.$transaction(async (tx) => {
        await claimPendingRequest(tx, id, { status: "approved", reviewedBy: principal.accountId, reviewNote: note });
        const changed = await tx.projectMember.updateMany({ where: { id: membershipId, projectId: row.projectId!, personId: row.personId!, status: { in: ["active", "approved"] } }, data: { status: "ended", endedAt: new Date(), endedBy: principal.accountId, endReason: note || "本人退出项目申请通过" } });
        if (!changed.count) throw Object.assign(new Error("项目成员关系已经结束"), { statusCode: 409, code: "PROJECT_MEMBERSHIP_NOT_ACTIVE" });
        await tx.trainingAssignment.updateMany({ where: { personId: row.personId!, batch: { projectId: row.projectId!, type: "project_induction" }, status: { notIn: ["completed", "cancelled"] } }, data: { status: "cancelled", cancelledAt: new Date() } });
        await writeCriticalAudit(tx, { actorId: principal.accountId, action: "project_member.exit_approve", objectType: "project_member", objectId: membershipId, requestId: id, reason: note || "本人退出项目申请通过", metadata: { projectId: row.projectId, personId: row.personId } });
      });
    }
    else if (row.type === "cross_entity_project_admin") {
      if (!row.projectId || !row.personId) throw Object.assign(new Error("跨实体项目管理员申请数据不完整"), { statusCode: 409, code: "REQUEST_INVALID" });
      const targetOrganizationId = z.string().uuid().parse(payload.targetOrganizationId); if (!await canLeadOrganization(principal, targetOrganizationId)) forbidden("仅目标人员所属经营实体负责人可以审批");
      if (note.trim().length < 2) throw Object.assign(new Error("跨实体授权必须填写审批意见"), { statusCode: 400, code: "REVIEW_NOTE_REQUIRED" });
      const [project, person] = await Promise.all([
        prisma.project.findUniqueOrThrow({ where: { id: row.projectId }, select: { status: true } }),
        prisma.person.findUniqueOrThrow({ where: { id: row.personId }, select: { status: true, type: true, organizations: { where: { active: true, primary: true, organizationId: targetOrganizationId }, select: { id: true } } } })
      ]);
      if (project.status !== "active" || person.status !== "active" || person.type !== "employee" || !person.organizations.length) throw Object.assign(new Error("项目或人员当前状态不再符合授权条件"), { statusCode: 409, code: "ROLE_TARGET_INVALID" });
      await prisma.$transaction(async (tx) => {
        await claimPendingRequest(tx, id, { status: "approved", reviewedBy: principal.accountId, reviewNote: note });
        const created = await grantRole(tx, { personId: row.personId!, role: "project_admin", scopeType: "project", scopeId: row.projectId!, actorId: principal.accountId, reason: note });
        const current = await tx.projectMember.findFirst({ where: { projectId: row.projectId!, personId: row.personId!, status: { in: ["active", "approved"] } } });
        if (!current) {
          const previous = await tx.projectMember.findFirst({ where: { projectId: row.projectId!, personId: row.personId!, status: { in: ["ended", "removed", "withdrawn", "rejected", "cancelled"] } }, orderBy: { createdAt: "desc" }, select: { id: true } });
          await tx.projectMember.create({ data: { projectId: row.projectId!, personId: row.personId!, status: "active", reviewedBy: principal.accountId, reviewedAt: new Date(), previousMembershipId: previous?.id ?? null } });
          await autoDispatchInTransaction(tx, "project_induction", row.personId!, deps.env, row.projectId!);
        }
        await writeCriticalAudit(tx, { actorId: principal.accountId, action: "project_admin.cross_entity_approve", objectType: "role_assignment", objectId: created.id, requestId: id, reason: note, metadata: { projectId: row.projectId, personId: row.personId, targetOrganizationId } });
      }, { isolationLevel: "Serializable" });
    }
    else if (row.type === "person_reactivation") {
      if (!row.personId) throw Object.assign(new Error("人员启用申请数据不完整"), { statusCode: 409, code: "REQUEST_INVALID" }); const memberships = await prisma.organizationMembership.findMany({ where: { personId: row.personId, active: true }, select: { organizationId: true } });
      if (!isCompanyAdmin(principal) && !memberships.some(({ organizationId }) => principal.roles.some((role) => role.role === "org_leader" && role.scopeType === "organization" && role.scopeId === organizationId))) forbidden("仅公司管理员或该组织负责人可以审批重新启用");
      await prisma.$transaction(async (tx) => { await claimPendingRequest(tx, id, { status: "approved", reviewedBy: principal.accountId, reviewNote: note }); await reactivatePerson(tx, { personId: row.personId! }); await writeCriticalAudit(tx, { actorId: principal.accountId, action: "person.reactivation_approve", objectType: "person", objectId: row.personId, requestId: id, reason: note || "重新启用申请通过" }); });
    }
    else if (row.type === "identity_correction") {
      if (!isCompanyAdmin(principal) || !row.personId) forbidden("仅公司管理员可以审批身份更正");
      await verifySensitiveToken(request, deps.env);
      if (note.trim().length < 2) throw Object.assign(new Error("身份更正必须填写审批原因"), { statusCode: 400, code: "REVIEW_NOTE_REQUIRED" });
      const newPersonType = z.enum(["employee", "contractor", "temporary_individual"]).parse(payload.newPersonType);
      const organizationId = typeof payload.organizationId === "string" ? z.string().uuid().parse(payload.organizationId) : null;
      const contractorOrganizationId = typeof payload.contractorOrganizationId === "string" ? z.string().uuid().parse(payload.contractorOrganizationId) : null;
      const person = await prisma.person.findUniqueOrThrow({ where: { id: row.personId }, include: { organizations: { where: { active: true }, include: { organization: { select: { type: true } } } } } });
      assertPersonChangeRequestAllowed({ requestType: "identity_correction", currentPersonType: person.type, nextPersonType: newPersonType });
      const currentPrimary = person.organizations.find((membership) => membership.primary);
      if (!organizationId && (!currentPrimary || (newPersonType === "employee" ? !["department", "business_entity"].includes(currentPrimary.organization.type) : currentPrimary.organization.type !== "business_entity"))) throw Object.assign(new Error("当前主组织不符合新身份要求，请在申请中指定目标组织"), { statusCode: 409, code: "PRIMARY_ORGANIZATION_INVALID" });
      await prisma.$transaction(async (tx) => {
        await claimPendingRequest(tx, id, { status: "approved", reviewedBy: principal.accountId, reviewNote: note });
        if (organizationId) await setPrimaryOrganization(tx, { personId: row.personId!, organizationId, actorId: principal.accountId, reason: note, actorIsCompanyAdmin: true });
        if (newPersonType === "contractor") {
          if (!contractorOrganizationId) throw Object.assign(new Error("缺少外协单位"), { statusCode: 409, code: "CONTRACTOR_ORGANIZATION_REQUIRED" });
          await tx.organizationMembership.updateMany({ where: { personId: row.personId!, active: true, organization: { type: "contractor" } }, data: { active: false, endedAt: new Date(), endedBy: principal.accountId, endReason: note } });
          await tx.organizationMembership.create({ data: { personId: row.personId!, organizationId: contractorOrganizationId, primary: false, active: true } });
        } else {
          await tx.organizationMembership.updateMany({ where: { personId: row.personId!, active: true, organization: { type: "contractor" } }, data: { active: false, endedAt: new Date(), endedBy: principal.accountId, endReason: note } });
        }
        await tx.person.update({ where: { id: row.personId! }, data: { type: newPersonType } });
        if (newPersonType !== "employee") {
          await tx.roleAssignment.updateMany({ where: { personId: row.personId!, OR: [{ active: true }, { activationPending: true }] }, data: { active: false, activationPending: false, endedAt: new Date(), endedBy: principal.accountId, endReason: "人员身份更正为非正式员工" } });
          const account = await tx.account.findUnique({ where: { personId: row.personId! }, select: { id: true } });
          if (account) { await tx.account.update({ where: { id: account.id }, data: { sessionVersion: { increment: 1 } } }); await tx.refreshSession.updateMany({ where: { accountId: account.id, revokedAt: null }, data: { revokedAt: new Date() } }); }
        } else if (person.status === "active") await autoDispatchInTransaction(tx, "three_level", row.personId!, deps.env);
        await tx.changeRequest.update({ where: { id }, data: { afterSummary: { personType: newPersonType, organizationId, contractorOrganizationId } } });
        await writeCriticalAudit(tx, { actorId: principal.accountId, action: "person.identity_correct", objectType: "person", objectId: row.personId, requestId: id, reason: note, metadata: { beforePersonType: person.type, afterPersonType: newPersonType } });
      }, { isolationLevel: "Serializable" });
    }
    else if (row.type === "contractor_unit_change") {
      if (!row.personId) throw Object.assign(new Error("申请数据不完整"), { statusCode: 409, code: "REQUEST_INVALID" });
      const organizationId = z.string().uuid().parse(payload.organizationId); const person = await prisma.person.findUniqueOrThrow({ where: { id: row.personId }, select: { type: true, organizations: { where: { active: true, primary: true }, select: { organizationId: true } } } });
      if (!await prisma.organization.findFirst({ where: { id: organizationId, type: "contractor" }, select: { id: true } })) throw Object.assign(new Error("目标外协单位不存在"), { statusCode: 409, code: "CONTRACTOR_ORGANIZATION_INVALID" });
      assertPersonChangeRequestAllowed({ requestType: "contractor_unit_change", currentPersonType: person.type });
      const leaderIds = new Set(principal.roles.filter((role) => role.role === "org_leader" && role.scopeType === "organization" && role.scopeId).map((role) => role.scopeId!));
      if (!canReviewPersonChange({ requestType: "contractor_unit_change", isCompanyAdmin: isCompanyAdmin(principal), leaderOrganizationIds: leaderIds, currentOrganizationId: person.organizations[0]?.organizationId ?? null })) forbidden("仅当前责任经营实体负责人或公司管理员可以审批");
      await prisma.$transaction(async (tx) => { await claimPendingRequest(tx, id, { status: "approved", reviewedBy: principal.accountId, reviewNote: note }); await tx.organizationMembership.updateMany({ where: { personId: row.personId!, active: true, organization: { type: "contractor" } }, data: { active: false, endedAt: new Date(), endedBy: principal.accountId, endReason: note || "外协单位变更" } }); await tx.organizationMembership.create({ data: { personId: row.personId!, organizationId, primary: false, active: true } }); await tx.changeRequest.update({ where: { id }, data: { afterSummary: { contractorOrganizationId: organizationId } } }); await writeCriticalAudit(tx, { actorId: principal.accountId, action: "person.contractor_unit_change", objectType: "person", objectId: row.personId, requestId: id, reason: note || "外协单位变更" }); });
    }
    else if (row.type === "responsible_entity_change") {
      if (!row.personId) throw Object.assign(new Error("申请数据不完整"), { statusCode: 409, code: "REQUEST_INVALID" });
      const organizationId = z.string().uuid().parse(payload.organizationId); const person = await prisma.person.findUniqueOrThrow({ where: { id: row.personId }, select: { type: true } });
      if (!await prisma.organization.findFirst({ where: { id: organizationId, type: "business_entity" }, select: { id: true } })) throw Object.assign(new Error("目标责任经营实体不存在"), { statusCode: 409, code: "RESPONSIBLE_ORGANIZATION_INVALID" });
      assertPersonChangeRequestAllowed({ requestType: "responsible_entity_change", currentPersonType: person.type });
      const leaderIds = new Set(principal.roles.filter((role) => role.role === "org_leader" && role.scopeType === "organization" && role.scopeId).map((role) => role.scopeId!));
      if (!canReviewPersonChange({ requestType: "responsible_entity_change", isCompanyAdmin: isCompanyAdmin(principal), leaderOrganizationIds: leaderIds, targetOrganizationId: organizationId })) forbidden("仅目标责任经营实体负责人或公司管理员可以审批");
      await prisma.$transaction(async (tx) => { await claimPendingRequest(tx, id, { status: "approved", reviewedBy: principal.accountId, reviewNote: note }); await setPrimaryOrganization(tx, { personId: row.personId!, organizationId, actorId: principal.accountId, reason: note || "内部责任实体变更", actorIsCompanyAdmin: isCompanyAdmin(principal) }); await tx.changeRequest.update({ where: { id }, data: { afterSummary: { responsibleOrganizationId: organizationId } } }); await writeCriticalAudit(tx, { actorId: principal.accountId, action: "person.responsible_entity_change", objectType: "person", objectId: row.personId, requestId: id, reason: note || "内部责任实体变更" }); });
    }
    else {
      await prisma.$transaction(async (tx) => {
        await claimPendingRequest(tx, id, { status: "approved", reviewedBy: principal.accountId, reviewNote: note });
        if (row.type === "profile_change" && row.personId) { if (typeof payload.phone === "string") throw Object.assign(new Error("手机号尚未完成短信验证，不能审批变更"), { statusCode: 409, code: "SMS_VERIFICATION_REQUIRED" }); const update: { name?: string } = {}; if (typeof payload.name === "string") update.name = payload.name; if (Object.keys(update).length) await tx.person.update({ where: { id: row.personId }, data: update }); }
        await writeCriticalAudit(tx, { actorId: principal.accountId, action: "change_request.approve", objectType: "change_request", objectId: id, requestId: id, reason: note || null, metadata: { type: row.type } });
      });
    }
    return { data: { status: "approved" } }; });

  app.get("/api/preferences/dashboard", manager, async (request) => { const principal = principalOf(request); const row = await prisma.userPreference.findUnique({ where: { accountId_key: { accountId: principal.accountId, key: "dashboard.cards" } } }); return { data: row?.value ?? ["required", "completed", "incomplete", "failed", "locked", "pendingRequests"] }; });
  app.put("/api/preferences/dashboard", manager, async (request) => { const principal = principalOf(request); const value = z.array(z.enum(["required", "completed", "incomplete", "failed", "locked", "pendingRequests"])).parse(request.body); await prisma.userPreference.upsert({ where: { accountId_key: { accountId: principal.accountId, key: "dashboard.cards" } }, create: { accountId: principal.accountId, key: "dashboard.cards", value }, update: { value } }); return { data: value }; });

  app.get("/api/reports/:type", manager, async (request, reply) => { const principal = principalOf(request); const type = z.enum(["ledger", "cards", "attendance", "scores", "annual"]).parse((request.params as { type: string }).type); const query = z.object({ format: z.enum(["json", "csv"]).default("json") }).passthrough().parse(request.query); const rows = await reportRows(principal, type, query); if (query.format === "csv") return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename=${type}.csv`).send(`\uFEFF${csv(rows)}`); return { data: { title: reportLabels[type], rows } }; });
}

async function visibleRequests(principal: Principal) {
  const rows = await prisma.changeRequest.findMany({ include: { person: { include: { organizations: { where: { active: true }, select: { organizationId: true, primary: true } } } } }, orderBy: { createdAt: "desc" } });
  const seen = new Set<string>(); const unique = rows.filter((row) => { const payload = row.payload as Record<string, unknown>; const key = [row.accountId, row.personId, row.projectId, row.type, payload.name, payload.phone, payload.type, payload.organizationId, payload.targetAccountId, payload.reason].map((value) => String(value ?? "")).join("|"); if (seen.has(key)) return false; seen.add(key); return true; });
  if (isCompanyAdmin(principal)) return unique;
  const orgIds = new Set(await accessibleOrganizationIds(principal)); const projects = new Set(projectScopeIds(principal));
  const leader: Principal = { ...principal, roles: principal.roles.filter(({ role }) => role === "org_leader") }; const leaderOrgIds = new Set(await accessibleOrganizationIds(leader));
  return unique.filter((row) => {
    if (["account_merge", "person_merge", "identity_correction", "account_recovery", "binding_change"].includes(row.type)) return false;
    const targetOrganizationId = requestOrganizationId(row);
    if (["department_transfer", "responsible_entity_change", "cross_entity_project_admin"].includes(row.type)) return !!targetOrganizationId && leaderOrgIds.has(targetOrganizationId);
    if (["contractor_unit_change", "person_reactivation"].includes(row.type)) {
      const currentPrimary = row.person?.organizations.find((membership) => membership.primary)?.organizationId;
      return !!currentPrimary && leaderOrgIds.has(currentPrimary);
    }
    return (row.projectId && projects.has(row.projectId)) || row.person?.organizations.some((item) => orgIds.has(item.organizationId)) || (!!targetOrganizationId && orgIds.has(targetOrganizationId));
  });
}

function safeRequest(row: Awaited<ReturnType<typeof visibleRequests>>[number], organizations = new Map<string, string>(), principal?: Principal) {
  const payload = row.payload as Record<string, unknown>; const phone = typeof payload.phone === "string" ? `${payload.phone.slice(0, 3)}****${payload.phone.slice(-4)}` : undefined;
  const organizationId = typeof payload.organizationId === "string" ? payload.organizationId : undefined;
  const isAdmin = !!principal && isCompanyAdmin(principal); const canReview = !!principal;
  const actions = principal ? allowedRequestActions({ status: row.status, isApplicant: row.accountId === principal.accountId || (!!principal.personId && row.personId === principal.personId), isCreator: row.accountId === principal.accountId, canReview, isCompanyAdmin: isAdmin }) : [];
  return { id: row.id, type: row.type, status: row.status, personId: row.personId, projectId: row.projectId, applicant: row.person?.name ?? (typeof payload.name === "string" ? payload.name : "待匹配账号"), summary: { ...(phone ? { phone } : {}), ...(typeof payload.name === "string" ? { name: payload.name } : {}), ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}), ...(typeof payload.type === "string" ? { personType: payload.type } : {}), ...(organizationId ? { targetOrganization: organizations.get(organizationId) ?? organizationId } : {}), matchCount: payload.matchCount }, reviewedBy: row.reviewedBy, reviewedAt: row.reviewedAt, reviewNote: row.reviewNote, createdAt: row.createdAt, availableActions: row.type === "binding_change" ? actions.filter((action) => action !== "approve") : actions };
}
