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
import { mergeAccounts, setPrimaryOrganization } from "../identity.js";
import { freezePaper } from "./day2.js";

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
  for (const certificate of expiring) { if (!certificate.expiresAt) continue; const days = Math.ceil((certificate.expiresAt.getTime() - now.getTime()) / 86_400_000); const milestone = days < 0 ? `overdue-${weekKey(now)}` : days <= 0 ? "0" : days <= 7 ? "7" : days <= 30 ? "30" : `entry-${certificateSetting.warnDays}`; const organizationId = certificate.person.organizations[0]?.organizationId; const recipients = managers.filter((role) => role.personId && (role.role === "company_admin" || (organizationId && ["org_leader", "org_admin"].includes(role.role) && role.scopeId === organizationId))); for (const role of recipients) await createNotification({ personId: role.personId!, title: days < 0 ? "人员证照已到期" : "人员证照即将到期", body: `${certificate.name}需要处理，请进入资质证照模块查看。`, dedupeKey: `certificate-expiry:${certificate.id}:${milestone}:${role.id}` }, env); }
  return rows.length;
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
    await auditCritical(principal.accountId, "person.self_sensitive_read", "person", person.id, undefined, "var/audit-fallback.ndjson");
    return { data: { id: person.id, name: person.name, type: person.type, status: person.status, phone: person.phone,
      nationalId: person.nationalIdCipher && person.nationalIdIv && person.nationalIdTag ? decryptNationalId(person.nationalIdCipher, person.nationalIdIv, person.nationalIdTag, deps.env) : null,
      photoFileId: person.photoFileId, organizations: person.organizations.map(({ primary, organization }) => ({ primary, ...organization })) } };
  });

  app.patch("/api/me/profile/photo", authenticated, async (request) => {
    const principal = principalOf(request); if (!principal.personId) forbidden("账号尚未绑定人员档案");
    const { photoFileId } = z.object({ photoFileId: z.string().uuid() }).parse(request.body);
    const file = await prisma.privateFile.findFirst({ where: { id: photoFileId, kind: "photo", uploadedBy: principal.accountId }, select: { id: true } });
    if (!file) forbidden("只能使用本人刚上传的照片");
    await prisma.person.update({ where: { id: principal.personId }, data: { photoFileId } });
    audit(principal.accountId, "person.self_photo_update", "person", principal.personId, { photoFileId });
    return { data: { photoFileId } };
  });

  app.get("/api/me/organization-options", authenticated, async () => ({ data: await prisma.organization.findMany({ where: { type: { in: ["department", "business_entity"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) }));

  app.post("/api/me/department-transfer-requests", authenticated, async (request, reply) => {
    const principal = principalOf(request); if (!principal.personId) forbidden("账号尚未绑定人员档案");
    const input = z.object({ organizationId: z.string().uuid(), reason: z.string().trim().min(2).max(500) }).parse(request.body);
    const organization = await prisma.organization.findFirst({ where: { id: input.organizationId, type: { in: ["department", "business_entity"] } }, select: { id: true } });
    if (!organization) throw Object.assign(new Error("目标部门不存在"), { statusCode: 404, code: "ORGANIZATION_NOT_FOUND" });
    if (await prisma.organizationMembership.findFirst({ where: { personId: principal.personId, organizationId: input.organizationId, active: true } })) throw Object.assign(new Error("你已属于该部门"), { statusCode: 409, code: "ALREADY_IN_ORGANIZATION" });
    const existing = await prisma.changeRequest.findFirst({ where: { accountId: principal.accountId, personId: principal.personId, type: "department_transfer", status: "pending", payload: { path: ["organizationId"], equals: input.organizationId } }, orderBy: { createdAt: "desc" } });
    if (existing) return { data: { id: existing.id, status: existing.status } };
    const row = await prisma.changeRequest.create({ data: { accountId: principal.accountId, personId: principal.personId, type: "department_transfer", payload: input } });
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
    await prisma.$transaction([prisma.trainingAssignment.update({ where: { id }, data: { status: "remediation_required", extraAttempts: { increment: 1 } } }), prisma.learningProgress.createMany({ data: originals.map((item) => ({ assignmentId: id, coursewareVersionId: item.coursewareVersionId, remediationRound: attemptsBefore })), skipDuplicates: true })]);
    await auditCritical(principal.accountId, "assignment.unlock", "training_assignment", id, { before: "locked", attemptsBefore, reason, addedAttempts: 1 }, "var/audit-fallback.ndjson"); return { data: { status: "remediation_required", attemptsBefore, addedAttempts: 1 } };
  });

  app.post("/api/management/confirmations", manager, async (request) => {
    const principal = principalOf(request); const input = z.object({ assignmentIds: z.array(z.string().uuid()).min(1).max(200), note: z.string().trim().max(300).optional() }).parse(request.body); let confirmed = 0;
    if (isCompanyAdmin(principal)) forbidden("公司管理员只查看项目现场确认记录，不代为确认");
    for (const id of [...new Set(input.assignmentIds)]) { const row = await assertManagedAssignment(principal, id); if (row.batch.type !== "project_induction" && row.batch.source !== "reconfirmation") throw Object.assign(new Error("仅项目入场或重新确认任务可现场确认"), { statusCode: 409, code: "CONFIRMATION_NOT_REQUIRED" }); if (!row.batch.projectId || !await canAccessProject(principal, row.batch.projectId)) forbidden(); if (row.status !== "confirmation_pending") continue; const round = await prisma.projectConfirmation.count({ where: { assignmentId: id } }); await prisma.$transaction([prisma.projectConfirmation.create({ data: { assignmentId: id, confirmedBy: principal.accountId, note: input.note ?? null, round } }), prisma.trainingAssignment.update({ where: { id }, data: { status: "completed", completedAt: new Date() } })]); confirmed++; }
    await auditCritical(principal.accountId, "project.confirm", "training_assignment", undefined, { assignmentIds: input.assignmentIds, confirmed }, "var/audit-fallback.ndjson"); return { data: { confirmed } };
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
      await tx.trainingAssignment.update({ where: { id }, data: assignment.batch.type === "project_induction" ? { status: "confirmation_pending" } : { status: "completed", completedAt: new Date() } }); return created;
    });
    await auditCritical(principal.accountId, "assignment.assisted_sign", "signature", signature.id, { assignmentId: id, personId: assignment.personId, witnessedPersonWriting: true }, "var/audit-fallback.ndjson"); return reply.code(201).send({ data: { id: signature.id, signedAt: signature.signedAt } });
  });

  app.get("/api/me/notifications", authenticated, async (request) => { const principal = principalOf(request); if (!principal.personId) forbidden("账号尚未绑定人员档案"); return { data: await prisma.notification.findMany({ where: { personId: principal.personId }, orderBy: { createdAt: "desc" }, take: 100 }) }; });
  app.patch("/api/me/notifications/:id/read", authenticated, async (request) => { const principal = principalOf(request); const { id } = idParam.parse(request.params); if (!principal.personId) forbidden(); const result = await prisma.notification.updateMany({ where: { id, personId: principal.personId }, data: { status: "read" } }); if (!result.count) forbidden(); return { data: { status: "read" } }; });

  app.get("/api/me/change-requests", authenticated, async (request) => { const principal = principalOf(request); return { data: await prisma.changeRequest.findMany({ where: { accountId: principal.accountId }, select: { id: true, type: true, status: true, reviewNote: true, reviewedAt: true, createdAt: true }, orderBy: { createdAt: "desc" } }) }; });
  app.post("/api/me/change-requests", authenticated, async (request, reply) => { const principal = principalOf(request); const input = z.object({ type: z.enum(["profile_change", "binding_change"]), name: z.string().trim().min(2).max(80).optional(), phone: z.string().regex(/^1\d{10}$/).optional(), reason: z.string().trim().min(2).max(500) }).parse(request.body); if (input.phone) throw Object.assign(new Error("修改手机号必须先完成短信验证"), { statusCode: 409, code: "SMS_VERIFICATION_REQUIRED" }); if (input.type === "profile_change" && !input.name) throw Object.assign(new Error("请填写需要修改的姓名"), { statusCode: 400, code: "CHANGE_REQUIRED" }); const row = await prisma.changeRequest.create({ data: { accountId: principal.accountId, personId: principal.personId, type: input.type, payload: input } }); return reply.code(201).send({ data: { id: row.id, status: row.status } }); });

  app.get("/api/management/requests", manager, async (request) => { const rows = await visibleRequests(principalOf(request)); const ids = [...new Set(rows.map(transferTarget).filter((id): id is string => !!id))]; const organizations = new Map((await prisma.organization.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(({ id, name }) => [id, name])); return { data: rows.map((row) => safeRequest(row, organizations)) }; });
  app.post("/api/management/requests/:id/reject", manager, async (request) => { const principal = principalOf(request); const { id } = idParam.parse(request.params); const { note } = z.object({ note: z.string().trim().min(2).max(500) }).parse(request.body); const row = (await visibleRequests(principal)).find((item) => item.id === id); if (!row) forbidden(); if (row.status !== "pending") throw Object.assign(new Error("申请状态不可审批"), { statusCode: 409, code: "REQUEST_NOT_PENDING" }); if (row.type === "account_merge") { if (!isCompanyAdmin(principal)) forbidden("仅公司管理员可以处理账号合并"); await verifySensitiveToken(request, deps.env); await prisma.$transaction(async (tx) => { await tx.changeRequest.update({ where: { id }, data: { status: "rejected", reviewedBy: principal.accountId, reviewedAt: new Date(), reviewNote: note } }); await tx.auditLog.create({ data: { actorId: principal.accountId, action: "account.merge_reject", objectType: "change_request", objectId: id, result: "success", metadata: { reason: note } } }); }); return { data: { status: "rejected" } }; } if (row.type === "department_transfer") { const target = transferTarget(row); if (!target || !await canLeadOrganization(principal, target)) forbidden("仅目标部门负责人可审批调换部门申请"); } await prisma.changeRequest.update({ where: { id }, data: { status: "rejected", reviewedBy: principal.accountId, reviewedAt: new Date(), reviewNote: note } }); audit(principal.accountId, "change_request.reject", "change_request", id, { note }); return { data: { status: "rejected" } }; });
  app.post("/api/management/requests/:id/approve", manager, async (request) => { const principal = principalOf(request); const { id } = idParam.parse(request.params); const { note } = z.object({ note: z.string().trim().max(500).default("") }).parse(request.body); const row = (await visibleRequests(principal)).find((item) => item.id === id); if (!row) forbidden(); if (row.status !== "pending" || !["profile_change", "binding_change", "department_transfer", "account_merge"].includes(row.type)) throw Object.assign(new Error("该申请请使用档案绑定审核操作"), { statusCode: 409, code: "SPECIAL_APPROVAL_REQUIRED" }); const payload = row.payload as Record<string, unknown>;
    if (row.type === "account_merge") {
      if (!isCompanyAdmin(principal)) forbidden("仅公司管理员可以确认账号合并");
      await verifySensitiveToken(request, deps.env);
      if (note.trim().length < 2) throw Object.assign(new Error("请填写账号合并确认原因"), { statusCode: 400, code: "MERGE_REASON_REQUIRED" });
      const targetAccountId = z.string().uuid().parse(payload.targetAccountId);
      if (!row.accountId) throw Object.assign(new Error("账号合并申请缺少来源账号"), { statusCode: 409, code: "ACCOUNT_MERGE_INVALID" });
      await prisma.$transaction(async (tx) => {
        await mergeAccounts(tx, { sourceAccountId: row.accountId!, targetAccountId, actorId: principal.accountId, reason: note });
        await tx.changeRequest.update({ where: { id }, data: { status: "approved", reviewedBy: principal.accountId, reviewedAt: new Date(), reviewNote: note } });
        if (row.personId) await tx.changeRequest.updateMany({ where: { accountId: row.accountId!, personId: row.personId, type: "binding", status: "pending" }, data: { status: "approved", reviewedBy: principal.accountId, reviewedAt: new Date(), reviewNote: "账号合并后完成绑定" } });
        await tx.auditLog.create({ data: { actorId: principal.accountId, action: "account.merge", objectType: "account", objectId: row.accountId, result: "success", metadata: { targetAccountId, requestId: id, reason: note } } });
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
        await setPrimaryOrganization(tx, { personId: row.personId!, organizationId: target, actorId: principal.accountId, reason: note || "组织调换申请审批通过" });
        await tx.changeRequest.update({ where: { id }, data: { status: "approved", reviewedBy: principal.accountId, reviewedAt: new Date(), reviewNote: note } });
        for (const leader of previousLeaders) if (leader.personId) await tx.notification.create({ data: { personId: leader.personId, title: "人员组织调换结果", body: `一名人员已调入${targetOrganization.name}，详情请在人员档案中查看。`, dedupeKey: `transfer-result:${id}:${leader.personId}` } });
      });
    }
    else { if (row.type === "profile_change" && row.personId) { if (typeof payload.phone === "string") throw Object.assign(new Error("手机号尚未完成短信验证，不能审批变更"), { statusCode: 409, code: "SMS_VERIFICATION_REQUIRED" }); const update: { name?: string } = {}; if (typeof payload.name === "string") update.name = payload.name; if (Object.keys(update).length) await prisma.person.update({ where: { id: row.personId }, data: update }); } if (row.type === "binding_change" && row.accountId) await prisma.$transaction([prisma.wechatBinding.updateMany({ where: { accountId: row.accountId, active: true }, data: { active: false } }), prisma.account.update({ where: { id: row.accountId }, data: { sessionVersion: { increment: 1 } } }), prisma.refreshSession.updateMany({ where: { accountId: row.accountId, revokedAt: null }, data: { revokedAt: new Date() } })]); await prisma.changeRequest.update({ where: { id }, data: { status: "approved", reviewedBy: principal.accountId, reviewedAt: new Date(), reviewNote: note } }); }
    await auditCritical(principal.accountId, "change_request.approve", "change_request", id, { type: row.type }, "var/audit-fallback.ndjson"); return { data: { status: "approved" } }; });

  app.get("/api/preferences/dashboard", manager, async (request) => { const principal = principalOf(request); const row = await prisma.userPreference.findUnique({ where: { accountId_key: { accountId: principal.accountId, key: "dashboard.cards" } } }); return { data: row?.value ?? ["required", "completed", "incomplete", "failed", "locked", "pendingRequests"] }; });
  app.put("/api/preferences/dashboard", manager, async (request) => { const principal = principalOf(request); const value = z.array(z.enum(["required", "completed", "incomplete", "failed", "locked", "pendingRequests"])).parse(request.body); await prisma.userPreference.upsert({ where: { accountId_key: { accountId: principal.accountId, key: "dashboard.cards" } }, create: { accountId: principal.accountId, key: "dashboard.cards", value }, update: { value } }); return { data: value }; });

  app.get("/api/reports/:type", manager, async (request, reply) => { const principal = principalOf(request); const type = z.enum(["ledger", "cards", "attendance", "scores", "annual"]).parse((request.params as { type: string }).type); const query = z.object({ format: z.enum(["json", "csv"]).default("json") }).passthrough().parse(request.query); const rows = await reportRows(principal, type, query); if (query.format === "csv") return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename=${type}.csv`).send(`\uFEFF${csv(rows)}`); return { data: { title: reportLabels[type], rows } }; });
}

async function visibleRequests(principal: Principal) {
  const rows = await prisma.changeRequest.findMany({ include: { person: { include: { organizations: { where: { active: true }, select: { organizationId: true } } } } }, orderBy: { createdAt: "desc" } });
  const seen = new Set<string>(); const unique = rows.filter((row) => { const payload = row.payload as Record<string, unknown>; const key = [row.accountId, row.personId, row.projectId, row.type, payload.name, payload.phone, payload.type, payload.organizationId, payload.targetAccountId, payload.reason].map((value) => String(value ?? "")).join("|"); if (seen.has(key)) return false; seen.add(key); return true; });
  if (isCompanyAdmin(principal)) return unique;
  const orgIds = new Set(await accessibleOrganizationIds(principal)); const projects = new Set(projectScopeIds(principal));
  const leader: Principal = { ...principal, roles: principal.roles.filter(({ role }) => role === "org_leader") }; const leaderOrgIds = new Set(await accessibleOrganizationIds(leader));
  return unique.filter((row) => row.type !== "account_merge" && (row.type === "department_transfer" ? !!transferTarget(row) && leaderOrgIds.has(transferTarget(row)!) : (row.projectId && projects.has(row.projectId)) || row.person?.organizations.some((item) => orgIds.has(item.organizationId)) || (typeof (row.payload as Record<string, unknown>).organizationId === "string" && orgIds.has((row.payload as Record<string, unknown>).organizationId as string))));
}

function safeRequest(row: Awaited<ReturnType<typeof visibleRequests>>[number], organizations = new Map<string, string>()) {
  const payload = row.payload as Record<string, unknown>; const phone = typeof payload.phone === "string" ? `${payload.phone.slice(0, 3)}****${payload.phone.slice(-4)}` : undefined;
  const organizationId = typeof payload.organizationId === "string" ? payload.organizationId : undefined;
  return { id: row.id, type: row.type, status: row.status, personId: row.personId, projectId: row.projectId, applicant: row.person?.name ?? (typeof payload.name === "string" ? payload.name : "待匹配账号"), summary: { ...(phone ? { phone } : {}), ...(typeof payload.name === "string" ? { name: payload.name } : {}), ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}), ...(typeof payload.type === "string" ? { personType: payload.type } : {}), ...(organizationId ? { targetOrganization: organizations.get(organizationId) ?? organizationId } : {}), matchCount: payload.matchCount }, reviewedBy: row.reviewedBy, reviewedAt: row.reviewedAt, reviewNote: row.reviewNote, createdAt: row.createdAt };
}
