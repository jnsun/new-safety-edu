import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma, type QuestionType, type ScopeType, type TrainingType } from "@prisma/client";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { accessibleOrganizationIds, canAccessOrganization, canAccessPerson, canAccessProject, forbidden, isCompanyAdmin, organizationScopeIds, projectScopeIds } from "../access.js";
import { audit } from "../audit.js";
import type { Principal } from "../auth.js";
import { prisma } from "../db.js";
import type { Env } from "../env.js";
import { parseQuestionImport, questionImportTemplate } from "../question-import.js";
import { coursewareViewerHeaders } from "../courseware-viewer-policy.js";
import { canPublishCourseware } from "../courseware-publish-policy.js";
import { writeCriticalAudit } from "../transaction-audit.js";
import { freezeTrainingPaper, preflightTrainingWorkflow, resolveTrainingWorkflow, trainingWorkflowInputSchema, verifyTrainingPreflight, type BatchPaperSnapshot, type CoursewareSnapshotItem } from "../training-workflow.js";
import { decorateTodoPriority, sortTodoAssignments } from "../training-todo-priority.js";
import { completionEvidenceError, latestLearningProgress, resumeUpdateData } from "../learning-progress-policy.js";
import { serializeStructuredCoursewareForLearner } from "../structured-courseware.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
type Deps = { env: Env; authenticate: Guard; requireManager: Guard };
const idParam = z.object({ id: z.string().uuid() });
const principalOf = (request: FastifyRequest) => request.principal ?? forbidden("未登录");
const scopeSchema = z.object({ scopeType: z.enum(["company", "organization", "project"]), scopeId: z.string().uuid().nullable().optional() });
export const resumeSchema = z.object({
  blockKey: z.string().trim().min(1).max(120),
  progressPercent: z.number().int().min(0).max(100)
});

export async function assertScope(principal: Principal, scopeType: ScopeType, scopeId?: string | null) {
  if (scopeType === "company") {
    if (scopeId || !isCompanyAdmin(principal)) forbidden();
  } else if (scopeType === "organization") {
    if (!scopeId || !await canAccessOrganization(principal, scopeId)) forbidden();
  } else if (scopeType === "project") {
    if (!scopeId || !await canAccessProject(principal, scopeId)) forbidden();
  } else forbidden();
}

export async function assertCoursewareFile(principal: Principal, fileId: string) {
  const file = await prisma.privateFile.findFirst({ where: { id: fileId, kind: "courseware", uploadedBy: principal.accountId }, select: { id: true } });
  if (!file) forbidden("HTML 课件文件无效");
}

async function visibleScope(principal: Principal) {
  if (isCompanyAdmin(principal)) return {};
  const organizationIds = await accessibleOrganizationIds(principal);
  const organizationProjectIds = organizationIds.length
    ? (await prisma.project.findMany({ where: { responsibleOrganizationId: { in: organizationIds } }, select: { id: true } })).map(({ id }) => id)
    : [];
  const visibleProjectIds = [...new Set([...projectScopeIds(principal), ...organizationProjectIds])];
  return { OR: [
    { scopeType: "organization" as const, scopeId: { in: organizationIds } },
    { scopeType: "project" as const, scopeId: { in: visibleProjectIds } }
  ] };
}

async function assertAssignment(principal: Principal, assignmentId: string, manager = false) {
  const assignment = await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { batch: true } });
  if (!manager && assignment.status === "cancelled") throw Object.assign(new Error("培训任务已撤回"), { statusCode: 409, code: "ASSIGNMENT_CANCELLED" });
  if (!manager && principal.personId === assignment.personId) return assignment;
  if (await canAccessPerson(principal, assignment.personId) && (!assignment.batch.projectId || await canAccessProject(principal, assignment.batch.projectId))) return assignment;
  forbidden();
}

async function currentLearnerProgress(tx: Prisma.TransactionClient, assignmentId: string, versionId: string, personId: string) {
  const rows = await tx.learningProgress.findMany({
    where: { assignmentId, coursewareVersionId: versionId, assignment: { personId } },
    select: { id: true, remediationRound: true, openedAt: true, reachedEndAt: true, completedAt: true, resumeState: true }
  });
  return latestLearningProgress(rows);
}

async function lockLearnerAssignment(tx: Prisma.TransactionClient, assignmentId: string, personId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM training_assignments WHERE id = ${assignmentId}::uuid AND person_id = ${personId}::uuid AND status <> 'cancelled'::"AssignmentStatus" FOR UPDATE`;
  if (!rows.length) forbidden("课件只能由本人学习");
}

const normalize = (value: unknown) => Array.isArray(value) ? [...value].map(String).sort() : [String(value)].sort();
const sameAnswer = (a: unknown, b: unknown) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
type SnapshotQuestion = { id: string; type: QuestionType; prompt: string; options: unknown; correct: unknown; score: number };
type ExamSnapshot = { questions: SnapshotQuestion[]; totalScore: number };
export const publicAttempt = (attempt: { id: string; attemptNumber: number; startedAt: Date; expiresAt: Date; status: string; snapshot: Prisma.JsonValue; answers?: Array<{ questionId: string; answer: Prisma.JsonValue }> }) => {
  const snapshot = attempt.snapshot as unknown as ExamSnapshot;
  return { id: attempt.id, attemptNumber: attempt.attemptNumber, startedAt: attempt.startedAt, expiresAt: attempt.expiresAt, status: attempt.status,
    questions: snapshot.questions.map(({ id, type, prompt, options }) => ({ id, type, prompt, options })), answers: attempt.answers ?? [] };
};

const learnerAssignmentInclude = {
  batch: { include: { project: { select: { id: true, name: true } }, template: { select: { scopeType: true, scopeId: true } } } },
  progress: { include: { coursewareVersion: { select: { id: true, version: true, courseware: { select: { id: true, title: true, type: true } } } } }, orderBy: { remediationRound: "asc" as const } },
  attempts: { select: { id: true, attemptNumber: true, status: true, score: true, passed: true, expiresAt: true, submittedAt: true }, orderBy: { attemptNumber: "desc" as const } },
  signatures: { where: { correctionOfId: null }, select: { id: true, signedAt: true }, take: 1 }
} satisfies Prisma.TrainingAssignmentInclude;
type LearnerAssignment = Prisma.TrainingAssignmentGetPayload<{ include: typeof learnerAssignmentInclude }>;

const nextAction = (status: string) => ({
  pending_learning: "开始学习", learning: "继续学习", pending_exam: "开始考试", remediation_required: "完成补学",
  locked: "联系管理员解锁", pending_signature: "本人签字", confirmation_pending: "等待项目确认", completed: "查看记录", cancelled: "任务已取消"
}[status] ?? "查看任务");

function learnerAssignment(row: LearnerAssignment) {
  const current = new Map<string, LearnerAssignment["progress"][number]>();
  row.progress.forEach((item) => current.set(item.coursewareVersionId, item));
  const frozenOrder = Array.isArray(row.batch.coursewareSnapshot) ? (row.batch.coursewareSnapshot as unknown as CoursewareSnapshotItem[]).map(({ coursewareVersionId }) => coursewareVersionId) : [];
  const ordered = frozenOrder.length ? frozenOrder.flatMap((id) => current.get(id) ? [current.get(id)!] : []) : [...current.values()];
  const coursewares = ordered.map((item) => ({
    progressId: item.id, versionId: item.coursewareVersionId, title: item.coursewareVersion.courseware.title,
    type: item.coursewareVersion.courseware.type, version: item.coursewareVersion.version, remediationRound: item.remediationRound,
    openedAt: item.openedAt, completedAt: item.completedAt
  }));
  const latestAttempt = row.attempts[0] ?? null;
  return {
    id: row.id, status: row.status, nextAction: nextAction(row.status), createdAt: row.createdAt, completedAt: row.completedAt,
    batch: { id: row.batch.id, name: row.batch.name, type: row.batch.type, source: row.batch.source, dueAt: row.batch.dueAt,
      durationMin: row.batch.durationMin, passScore: Number(row.batch.passScore), maxAttempts: row.batch.maxAttempts, examRequired: !!row.batch.paperId, project: row.batch.project },
    progress: { completed: coursewares.filter((item) => item.completedAt).length, total: coursewares.length }, coursewares,
    latestAttempt: latestAttempt ? { ...latestAttempt, score: latestAttempt.score === null ? null : Number(latestAttempt.score) } : null,
    signedAt: row.signatures[0]?.signedAt ?? null
  };
}

async function createAssignments(tx: Prisma.TransactionClient, batchId: string, templateId: string, personIds: string[], env: Env) {
  const [batch, items] = await Promise.all([
    tx.trainingBatch.findUniqueOrThrow({ where: { id: batchId }, select: { name: true, coursewareSnapshot: true } }),
    tx.trainingTemplateItem.findMany({ where: { templateId }, orderBy: { sortOrder: "asc" }, include: { coursewareVersion: { include: { courseware: true } } } })
  ]);
  if (!items.length) throw Object.assign(new Error("培训模板没有已发布课件"), { statusCode: 400, code: "EMPTY_TEMPLATE" });
  if (!Array.isArray(batch.coursewareSnapshot) || batch.coursewareSnapshot.length === 0) {
    const snapshot = items.map(({ coursewareVersion, sortOrder }) => ({ coursewareVersionId: coursewareVersion.id, coursewareId: coursewareVersion.coursewareId, title: coursewareVersion.courseware.title, type: coursewareVersion.courseware.type, version: coursewareVersion.version, sortOrder }));
    await tx.trainingBatch.update({ where: { id: batchId }, data: { coursewareSnapshot: snapshot as unknown as Prisma.InputJsonValue } });
  }
  for (const personId of personIds) {
    const assignment = await tx.trainingAssignment.create({ data: { batchId, personId } });
    await tx.learningProgress.createMany({ data: items.map((item) => ({ assignmentId: assignment.id, coursewareVersionId: item.coursewareVersionId })) });
    await tx.notification.create({ data: {
      personId, assignmentId: assignment.id, title: "新的培训任务", body: `${batch.name}已下发，请按时完成。`, dedupeKey: `assignment:${assignment.id}`,
      outbox: { create: env.WECHAT_APP_ID && env.WECHAT_APP_SECRET && env.WECHAT_SUBSCRIBE_TEMPLATE_TASK
        ? { status: "pending" } : { status: "skipped", lastError: "微信订阅消息未配置，已保留系统内提醒" } }
    } });
  }
}

export async function freezePaper(paperId: string): Promise<BatchPaperSnapshot> {
  const frozen = await freezeTrainingPaper(prisma as unknown as Prisma.TransactionClient, paperId);
  if (!frozen.snapshot) throw Object.assign(new Error(frozen.blocker?.message ?? "试卷不可用"), { statusCode: 409, code: frozen.blocker?.code ?? "PAPER_INVALID" });
  return frozen.snapshot;
}

export async function autoDispatchInTransaction(tx: Prisma.TransactionClient, type: "three_level" | "project_induction", personId: string, env: Env, projectId?: string) {
  const config = projectId
    ? await tx.trainingAutomationConfig.findFirst({ where: { type, active: true, scopeType: "project", scopeId: projectId }, include: { template: true }, orderBy: { createdAt: "desc" } })
      ?? await tx.trainingAutomationConfig.findFirst({ where: { type, active: true, scopeType: "company", scopeId: null }, include: { template: true }, orderBy: { createdAt: "desc" } })
    : await tx.trainingAutomationConfig.findFirst({ where: { type, active: true, scopeType: "company", scopeId: null }, include: { template: true }, orderBy: { createdAt: "desc" } });
  if (!config || !config.template.active) {
    if (type === "project_induction") throw Object.assign(new Error("项目入场教育默认模板或试卷尚未配置，不能加入项目"), { statusCode: 409, code: "INDUCTION_CONFIG_REQUIRED" });
    const admins = await tx.account.findMany({ where: { status: "active", personId: { not: null }, roles: { some: { active: true, role: "company_admin" } } }, select: { personId: true } });
    for (const admin of admins) if (admin.personId) await tx.notification.upsert({ where: { dedupeKey: `auto-config-missing:${type}:${projectId ?? "company"}` }, create: { personId: admin.personId, title: "自动培训配置缺失", body: `${type === "three_level" ? "三级教育" : "项目入场教育"}未生成，请先配置默认模板和试卷。`, dedupeKey: `auto-config-missing:${type}:${projectId ?? "company"}` }, update: {} });
    return null;
  }
  const frozenPaper = await freezeTrainingPaper(tx, config.paperId);
  if (!frozenPaper.snapshot) throw Object.assign(new Error(frozenPaper.blocker?.message ?? "试卷不可用"), { statusCode: 409, code: frozenPaper.blocker?.code ?? "PAPER_INVALID" });
  const paperSnapshot = frozenPaper.snapshot;
  const businessKey = `auto:${type}:${projectId ?? "company"}:${personId}`;
  const existing = await tx.trainingBatch.findUnique({ where: { businessKey }, include: { assignments: true } });
  if (existing) return existing;
  const batch = await tx.trainingBatch.create({ data: { businessKey, name: type === "three_level" ? "员工基础三级教育" : "项目入场教育", type, templateId: config.templateId, paperId: config.paperId, paperSnapshot: paperSnapshot as unknown as Prisma.InputJsonValue, projectId: projectId ?? null } });
  await createAssignments(tx, batch.id, config.templateId, [personId], env);
  return batch;
}

export async function autoDispatch(type: "three_level" | "project_induction", personId: string, env: Env, projectId?: string) {
  return prisma.$transaction((tx) => autoDispatchInTransaction(tx, type, personId, env, projectId));
}

export async function registerDay2Routes(app: FastifyInstance, deps: Deps) {
  const authenticated = { preHandler: deps.authenticate };
  const manager = { preHandler: [deps.authenticate, deps.requireManager] };

  app.get("/api/courseware-publish-grants", manager, async (request) => {
    const principal = principalOf(request); if (!isCompanyAdmin(principal)) forbidden("仅公司管理员可以维护课件发布授权");
    return { data: await prisma.coursewarePublishGrant.findMany({ where: { active: true }, include: { person: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } }) };
  });
  app.post("/api/courseware-publish-grants", manager, async (request, reply) => {
    const principal = principalOf(request); if (!isCompanyAdmin(principal)) forbidden("仅公司管理员可以维护课件发布授权");
    const input = z.object({ personId: z.string().uuid(), scopeType: z.enum(["organization", "project"]), scopeId: z.string().uuid(), reason: z.string().trim().min(2).max(500) }).parse(request.body);
    const person = await prisma.person.findUniqueOrThrow({ where: { id: input.personId }, select: { status: true, type: true, roleAssignments: { where: { active: true }, select: { role: true, scopeType: true, scopeId: true } } } });
    if (person.status !== "active" || person.type !== "employee" || !person.roleAssignments.some((role) => role.scopeType === input.scopeType && role.scopeId === input.scopeId && ["org_leader", "org_admin", "project_admin"].includes(role.role))) throw Object.assign(new Error("发布授权只能授予该范围的当前管理员"), { statusCode: 409, code: "PUBLISH_GRANT_TARGET_INVALID" });
    const grant = await prisma.$transaction(async (tx) => { const existing = await tx.coursewarePublishGrant.findFirst({ where: { personId: input.personId, scopeType: input.scopeType, scopeId: input.scopeId, active: true } }); if (existing) return existing; const created = await tx.coursewarePublishGrant.create({ data: { personId: input.personId, scopeType: input.scopeType, scopeId: input.scopeId, grantedBy: principal.accountId } }); await tx.auditLog.create({ data: { actorId: principal.accountId, action: "courseware.publish_grant", objectType: "courseware_publish_grant", objectId: created.id, result: "success", metadata: { personId: input.personId, scopeType: input.scopeType, scopeId: input.scopeId, reason: input.reason } } }); return created; });
    return reply.code(201).send({ data: grant });
  });
  app.delete("/api/courseware-publish-grants/:id", manager, async (request, reply) => {
    const principal = principalOf(request); if (!isCompanyAdmin(principal)) forbidden("仅公司管理员可以维护课件发布授权"); const { id } = idParam.parse(request.params); const { reason } = z.object({ reason: z.string().trim().min(2).max(500) }).parse(request.body);
    await prisma.$transaction(async (tx) => { const changed = await tx.coursewarePublishGrant.updateMany({ where: { id, active: true }, data: { active: false, endedAt: new Date(), endedBy: principal.accountId, endReason: reason } }); if (!changed.count) throw Object.assign(new Error("发布授权已经结束"), { statusCode: 409, code: "PUBLISH_GRANT_ENDED" }); await tx.auditLog.create({ data: { actorId: principal.accountId, action: "courseware.publish_grant_revoke", objectType: "courseware_publish_grant", objectId: id, result: "success", metadata: { reason } } }); }); return reply.code(204).send();
  });

  app.get("/api/training-automation-configs", manager, async (request) => ({ data: await prisma.trainingAutomationConfig.findMany({ where: await visibleScope(principalOf(request)), include: { template: true, paper: true }, orderBy: { createdAt: "desc" } }) }));
  app.post("/api/training-automation-configs", manager, async (request, reply) => {
    const principal = principalOf(request); const input = scopeSchema.extend({ type: z.enum(["three_level", "project_induction"]), templateId: z.string().uuid(), paperId: z.string().uuid() }).parse(request.body); await assertScope(principal, input.scopeType, input.scopeId);
    const [template, frozenPaper] = await Promise.all([prisma.trainingTemplate.findUniqueOrThrow({ where: { id: input.templateId } }), freezeTrainingPaper(prisma as unknown as Prisma.TransactionClient, input.paperId)]); if (!frozenPaper.snapshot) throw Object.assign(new Error(frozenPaper.blocker?.message ?? "试卷不可用"), { statusCode: 409, code: frozenPaper.blocker?.code ?? "PAPER_INVALID" });
    if (template.type !== input.type || !template.active) throw Object.assign(new Error("默认模板类型不匹配或已停用"), { statusCode: 409, code: "AUTOMATION_TEMPLATE_INVALID" });
    const row = await prisma.$transaction(async (tx) => { await tx.trainingAutomationConfig.updateMany({ where: { type: input.type, scopeType: input.scopeType, scopeId: input.scopeId ?? null, active: true }, data: { active: false } }); const created = await tx.trainingAutomationConfig.create({ data: { ...input, scopeId: input.scopeId ?? null, createdBy: principal.accountId } }); await writeCriticalAudit(tx, { actorId: principal.accountId, action: "training.automation_config", objectType: "training_automation_config", objectId: created.id, metadata: { type: input.type, scopeType: input.scopeType, scopeId: input.scopeId } }); return created; });
    return reply.code(201).send({ data: row });
  });

  app.get("/api/coursewares", manager, async (request) => ({ data: await prisma.courseware.findMany({
    where: { ...(await visibleScope(principalOf(request))), active: true },
    include: { versions: { where: { status: { not: "retired" } }, orderBy: { version: "desc" } } },
    orderBy: { createdAt: "desc" }
  }) }));
  app.post("/api/courseware-versions/:id/publish", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    const version = await prisma.coursewareVersion.findUniqueOrThrow({ where: { id }, include: { courseware: true } });
    await assertScope(principal, version.courseware.scopeType, version.courseware.scopeId);
    const grants = principal.personId ? await prisma.coursewarePublishGrant.findMany({ where: { personId: principal.personId, active: true }, select: { scopeType: true, scopeId: true } }) : [];
    if (!canPublishCourseware(principal.roles, grants, version.courseware)) forbidden("当前账号只有编辑权限，尚未获得该范围的课件发布授权");
    if (version.status === "published") return { data: version };
    const updated = await prisma.$transaction(async (tx) => { const published = await tx.coursewareVersion.update({ where: { id }, data: { status: "published", publishedAt: new Date() } }); await tx.auditLog.create({ data: { actorId: principal.accountId, action: "courseware.publish", objectType: "courseware_version", objectId: id, result: "success" } }); return published; });
    return { data: updated };
  });

  app.get("/api/training-templates", manager, async (request) => ({ data: await prisma.trainingTemplate.findMany({ where: { ...(await visibleScope(principalOf(request))), active: true }, include: { items: { include: { coursewareVersion: { include: { courseware: true } } }, orderBy: { sortOrder: "asc" } } } }) }));
  app.post("/api/training-templates", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = scopeSchema.extend({ name: z.string().trim().min(2).max(180), type: z.enum(["three_level", "project_induction", "routine", "change_update"]), coursewareVersionIds: z.array(z.string().uuid()).min(1) }).parse(request.body);
    await assertScope(principal, input.scopeType, input.scopeId);
    const versions = await prisma.coursewareVersion.findMany({ where: { id: { in: input.coursewareVersionIds }, status: "published", courseware: { active: true } }, include: { courseware: true } });
    if (versions.length !== new Set(input.coursewareVersionIds).size) throw Object.assign(new Error("模板只能引用已发布课件版本"), { statusCode: 400, code: "UNPUBLISHED_COURSEWARE" });
    for (const version of versions) await assertScope(principal, version.courseware.scopeType, version.courseware.scopeId);
    const template = await prisma.trainingTemplate.create({ data: { name: input.name, type: input.type, scopeType: input.scopeType, scopeId: input.scopeId ?? null, items: { create: [...new Set(input.coursewareVersionIds)].map((coursewareVersionId, sortOrder) => ({ coursewareVersionId, sortOrder })) } }, include: { items: true } });
    audit(principal.accountId, "training_template.create", "training_template", template.id);
    return reply.code(201).send({ data: template });
  });

  app.patch("/api/training-templates/:id", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    const input = z.object({ name: z.string().trim().min(2).max(180), type: z.enum(["three_level", "project_induction", "routine", "change_update"]), coursewareVersionIds: z.array(z.string().uuid()).min(1) }).parse(request.body);
    const template = await prisma.trainingTemplate.findUniqueOrThrow({ where: { id } }); await assertScope(principal, template.scopeType, template.scopeId);
    const versionIds = [...new Set(input.coursewareVersionIds)];
    const versions = await prisma.coursewareVersion.findMany({ where: { id: { in: versionIds }, status: "published", courseware: { active: true } }, include: { courseware: true } });
    if (versions.length !== versionIds.length) throw Object.assign(new Error("模板只能引用当前已发布课件"), { statusCode: 400, code: "UNPUBLISHED_COURSEWARE" });
    for (const version of versions) await assertScope(principal, version.courseware.scopeType, version.courseware.scopeId);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.trainingTemplateItem.deleteMany({ where: { templateId: id } });
      return tx.trainingTemplate.update({ where: { id }, data: { name: input.name, type: input.type, items: { create: versionIds.map((coursewareVersionId, sortOrder) => ({ coursewareVersionId, sortOrder })) } }, include: { items: { include: { coursewareVersion: { include: { courseware: true } } }, orderBy: { sortOrder: "asc" } } } });
    });
    audit(principal.accountId, "training_template.update", "training_template", id);
    return { data: updated };
  });

  app.delete("/api/training-templates/:id", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    const template = await prisma.trainingTemplate.findUniqueOrThrow({ where: { id } }); await assertScope(principal, template.scopeType, template.scopeId);
    await prisma.$transaction(async (tx) => {
      await tx.trainingAutomationConfig.updateMany({ where: { templateId: id, active: true }, data: { active: false } });
      await tx.trainingTemplate.update({ where: { id }, data: { active: false } });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "training_template.delete", objectType: "training_template", objectId: id, result: "success" } });
    });
    return { data: { id, deleted: true } };
  });

  app.get("/api/question-banks", manager, async (request) => ({ data: await prisma.questionBank.findMany({ where: { ...(await visibleScope(principalOf(request))), active: true }, include: { _count: { select: { questions: { where: { active: true } } } } }, orderBy: { createdAt: "desc" } }) }));
  app.post("/api/question-banks", manager, async (request, reply) => {
    const principal = principalOf(request); const input = scopeSchema.extend({ name: z.string().trim().min(2).max(160) }).parse(request.body);
    await assertScope(principal, input.scopeType, input.scopeId);
    const bank = await prisma.questionBank.create({ data: { name: input.name, scopeType: input.scopeType, scopeId: input.scopeId ?? null } });
    audit(principal.accountId, "question_bank.create", "question_bank", bank.id);
    return reply.code(201).send({ data: bank });
  });
  app.patch("/api/question-banks/:id", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const { name } = z.object({ name: z.string().trim().min(2).max(160) }).parse(request.body);
    const bank = await prisma.questionBank.findFirstOrThrow({ where: { id, active: true } }); await assertScope(principal, bank.scopeType, bank.scopeId);
    const updated = await prisma.questionBank.update({ where: { id }, data: { name } }); audit(principal.accountId, "question_bank.update", "question_bank", id); return { data: updated };
  });
  app.delete("/api/question-banks/:id", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const bank = await prisma.questionBank.findUniqueOrThrow({ where: { id } }); await assertScope(principal, bank.scopeType, bank.scopeId);
    const paperCount = await prisma.examPaper.count({ where: { active: true, OR: [{ bankId: id }, { items: { some: { question: { bankId: id } } } }] } });
    if (paperCount) throw Object.assign(new Error("题库仍被试卷使用，请先编辑或删除相关试卷"), { statusCode: 409, code: "QUESTION_BANK_IN_ACTIVE_PAPER" });
    await prisma.$transaction(async (tx) => { await tx.question.updateMany({ where: { bankId: id }, data: { active: false, challengeEnabled: false } }); await tx.questionBank.update({ where: { id }, data: { active: false } }); await tx.auditLog.create({ data: { actorId: principal.accountId, action: "question_bank.delete", objectType: "question_bank", objectId: id, result: "success" } }); });
    return { data: { id, deleted: true } };
  });
  app.get("/api/question-banks/:id/questions", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    const query = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(10).max(100).default(20), keyword: z.string().trim().max(100).optional(), type: z.enum(["single_choice", "multiple_choice", "true_false"]).optional() }).parse(request.query);
    const bank = await prisma.questionBank.findFirstOrThrow({ where: { id, active: true } }); await assertScope(principal, bank.scopeType, bank.scopeId);
    const where: Prisma.QuestionWhereInput = { bankId: id, active: true, ...(query.keyword ? { prompt: { contains: query.keyword, mode: "insensitive" } } : {}), ...(query.type ? { type: query.type } : {}) };
    const [items, total] = await Promise.all([prisma.question.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }), prisma.question.count({ where })]);
    return { data: { items, total, page: query.page, pageSize: query.pageSize } };
  });
  app.post("/api/question-banks/:id/questions", manager, async (request, reply) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    const bank = await prisma.questionBank.findFirstOrThrow({ where: { id, active: true } }); await assertScope(principal, bank.scopeType, bank.scopeId);
    const input = z.object({ type: z.enum(["single_choice", "multiple_choice", "true_false"]), prompt: z.string().trim().min(2), options: z.array(z.string()).min(2), correct: z.array(z.string()).min(1), explanation: z.string().optional() }).parse(request.body);
    if (input.correct.some((answer) => !input.options.includes(answer))) throw Object.assign(new Error("正确答案必须来自选项"), { statusCode: 400, code: "INVALID_ANSWER" });
    const question = await prisma.question.create({ data: { bankId: id, type: input.type, prompt: input.prompt, options: input.options, correct: input.correct, explanation: input.explanation ?? null, versions: { create: { version: 1, type: input.type, prompt: input.prompt, options: input.options, correct: input.correct, explanation: input.explanation ?? null, createdBy: principal.accountId } } } }); audit(principal.accountId, "question.create", "question", question.id);
    return reply.code(201).send({ data: question });
  });
  app.patch("/api/questions/:id", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const input = z.object({ type: z.enum(["single_choice", "multiple_choice", "true_false"]), prompt: z.string().trim().min(2), options: z.array(z.string()).min(2), correct: z.array(z.string()).min(1), explanation: z.string().optional(), active: z.boolean().optional() }).parse(request.body);
    if (input.correct.some((answer) => !input.options.includes(answer))) throw Object.assign(new Error("正确答案必须来自选项"), { statusCode: 400, code: "INVALID_ANSWER" });
    const question = await prisma.question.findUniqueOrThrow({ where: { id }, include: { bank: true } }); await assertScope(principal, question.bank.scopeType, question.bank.scopeId);
    return { data: await prisma.$transaction(async (tx) => {
      const version = await tx.questionVersion.findFirst({ where: { questionId: id, version: question.currentVersion }, orderBy: { createdAt: "desc" } });
      if (version) await tx.questionVersion.update({ where: { id: version.id }, data: { type: input.type, prompt: input.prompt, options: input.options, correct: input.correct, explanation: input.explanation ?? null } });
      else await tx.questionVersion.create({ data: { questionId: id, version: question.currentVersion, type: input.type, prompt: input.prompt, options: input.options, correct: input.correct, explanation: input.explanation ?? null, createdBy: principal.accountId } });
      const updated = await tx.question.update({ where: { id }, data: { type: input.type, prompt: input.prompt, options: input.options, correct: input.correct, explanation: input.explanation ?? null, ...(input.active === undefined ? {} : { active: input.active }) } });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "question.update", objectType: "question", objectId: id, result: "success" } }); return updated;
    }, { isolationLevel: "Serializable" }) };
  });
  app.delete("/api/questions/:id", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const question = await prisma.question.findUniqueOrThrow({ where: { id }, include: { bank: true } }); await assertScope(principal, question.bank.scopeType, question.bank.scopeId);
    const paperCount = await prisma.examPaper.count({ where: { active: true, items: { some: { questionId: id } } } });
    if (paperCount) throw Object.assign(new Error("题目仍被固定试卷使用，请先编辑或删除相关试卷"), { statusCode: 409, code: "QUESTION_IN_ACTIVE_PAPER" });
    await prisma.$transaction(async (tx) => { await tx.question.update({ where: { id }, data: { active: false, challengeEnabled: false } }); await tx.auditLog.create({ data: { actorId: principal.accountId, action: "question.delete", objectType: "question", objectId: id, result: "success" } }); });
    return { data: { id, deleted: true } };
  });
  app.get("/api/question-import-template.csv", manager, async (_request, reply) => reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", "attachment; filename*=UTF-8''question-import-template.csv")
    .send(questionImportTemplate()));
  app.post("/api/question-banks/:id/questions/import", manager, async (request, reply) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    const bank = await prisma.questionBank.findFirstOrThrow({ where: { id, active: true } }); await assertScope(principal, bank.scopeType, bank.scopeId);
    const part = await request.file({ limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
    if (!part) throw Object.assign(new Error("请选择导入文件"), { statusCode: 400, code: "FILE_REQUIRED" });
    const parsed = await parseQuestionImport(await part.toBuffer(), part.filename);
    if (parsed.questions.length > 1000) throw Object.assign(new Error("单次最多导入 1000 道题"), { statusCode: 400, code: "IMPORT_LIMIT" });
    const existing = parsed.questions.length ? await prisma.question.findMany({ where: { bankId: id, active: true, OR: parsed.questions.map(({ type, prompt }) => ({ type, prompt })) }, select: { type: true, prompt: true } }) : [];
    const existingKeys = new Set(existing.map((question) => `${question.type}|${question.prompt}`));
    const conflicts = parsed.questions.flatMap((question) => existingKeys.has(`${question.type}|${question.prompt}`) ? [{ rowNumber: question.rowNumber, reason: "题库中已存在相同题型和题干" }] : []);
    const errors = [...parsed.errors, ...conflicts].sort((a, b) => a.rowNumber - b.rowNumber);
    if (errors.length) return { data: { created: 0, valid: parsed.questions.length - conflicts.length, failed: errors.length, errors } };
    const count = await prisma.$transaction(async (tx) => { for (const { rowNumber: _rowNumber, ...question } of parsed.questions) await tx.question.create({ data: { bankId: id, ...question, versions: { create: { version: 1, ...question, createdBy: principal.accountId } } } }); await tx.auditLog.create({ data: { actorId: principal.accountId, action: "question.import", objectType: "question_bank", objectId: id, result: "success", metadata: { created: parsed.questions.length, filename: part.filename.slice(0, 240) } } }); return parsed.questions.length; });
    return reply.code(201).send({ data: { created: count, valid: count, failed: 0, errors: [] } });
  });

  app.get("/api/exam-papers", manager, async (request) => {
    const principal = principalOf(request); const scopeWhere = await visibleScope(principal);
    const where = isCompanyAdmin(principal) ? { active: true } : { active: true, OR: [{ bank: scopeWhere }, { items: { some: { question: { bank: scopeWhere } } } }] };
    return { data: await prisma.examPaper.findMany({ where, include: { items: { include: { question: true }, orderBy: { sortOrder: "asc" } }, bank: true } }) };
  });
  app.post("/api/exam-papers", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = z.discriminatedUnion("mode", [
      z.object({ name: z.string().min(2).max(160), mode: z.literal("fixed"), items: z.array(z.object({ questionId: z.string().uuid(), score: z.number().positive() })).min(1) }),
      z.object({ name: z.string().min(2).max(160), mode: z.literal("random"), bankId: z.string().uuid(), randomCount: z.number().int().positive().max(200) })
    ]).parse(request.body);
    if (input.mode === "random") { const bank = await prisma.questionBank.findFirstOrThrow({ where: { id: input.bankId, active: true } }); await assertScope(principal, bank.scopeType, bank.scopeId); }
    else for (const item of input.items) { const question = await prisma.question.findFirstOrThrow({ where: { id: item.questionId, active: true }, include: { bank: true } }); await assertScope(principal, question.bank.scopeType, question.bank.scopeId); }
    const currentVersions = new Map<string, string>();
    if (input.mode === "fixed") for (const version of await prisma.questionVersion.findMany({ where: { questionId: { in: input.items.map(({ questionId }) => questionId) } }, orderBy: { version: "desc" } })) if (!currentVersions.has(version.questionId)) currentVersions.set(version.questionId, version.id);
    const paper = await prisma.examPaper.create({ data: input.mode === "fixed" ? { name: input.name, mode: input.mode, items: { create: input.items.map((item, sortOrder) => ({ ...item, ...(currentVersions.get(item.questionId) ? { questionVersionId: currentVersions.get(item.questionId)! } : {}), sortOrder })) } } : { name: input.name, mode: input.mode, bankId: input.bankId, randomCount: input.randomCount }, include: { items: true } });
    audit(principal.accountId, "exam_paper.create", "exam_paper", paper.id);
    return reply.code(201).send({ data: paper });
  });
  app.patch("/api/exam-papers/:id", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    const input = z.discriminatedUnion("mode", [
      z.object({ name: z.string().trim().min(2).max(160), mode: z.literal("fixed"), items: z.array(z.object({ questionId: z.string().uuid(), score: z.number().positive() })).min(1) }),
      z.object({ name: z.string().trim().min(2).max(160), mode: z.literal("random"), bankId: z.string().uuid(), randomCount: z.number().int().positive().max(200) })
    ]).parse(request.body);
    const existing = await prisma.examPaper.findUniqueOrThrow({ where: { id }, include: { bank: true, items: { include: { question: { include: { bank: true } } } } } });
    if (existing.bank) await assertScope(principal, existing.bank.scopeType, existing.bank.scopeId); else for (const item of existing.items) await assertScope(principal, item.question.bank.scopeType, item.question.bank.scopeId);
    if (input.mode === "random") { const bank = await prisma.questionBank.findFirstOrThrow({ where: { id: input.bankId, active: true } }); await assertScope(principal, bank.scopeType, bank.scopeId); }
    else for (const item of input.items) { const question = await prisma.question.findFirstOrThrow({ where: { id: item.questionId, active: true }, include: { bank: true } }); await assertScope(principal, question.bank.scopeType, question.bank.scopeId); }
    const currentVersions = new Map<string, string>();
    if (input.mode === "fixed") for (const version of await prisma.questionVersion.findMany({ where: { questionId: { in: input.items.map(({ questionId }) => questionId) } }, orderBy: { version: "desc" } })) if (!currentVersions.has(version.questionId)) currentVersions.set(version.questionId, version.id);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.examPaperItem.deleteMany({ where: { paperId: id } });
      const data = input.mode === "fixed"
        ? { name: input.name, mode: input.mode, bankId: null, randomCount: null, items: { create: input.items.map((item, sortOrder) => ({ ...item, ...(currentVersions.get(item.questionId) ? { questionVersionId: currentVersions.get(item.questionId)! } : {}), sortOrder })) } }
        : { name: input.name, mode: input.mode, bankId: input.bankId, randomCount: input.randomCount };
      const paper = await tx.examPaper.update({ where: { id }, data, include: { items: { include: { question: true }, orderBy: { sortOrder: "asc" } }, bank: true } });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "exam_paper.update", objectType: "exam_paper", objectId: id, result: "success" } }); return paper;
    });
    return { data: updated };
  });
  app.delete("/api/exam-papers/:id", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const paper = await prisma.examPaper.findUniqueOrThrow({ where: { id }, include: { bank: true, items: { include: { question: { include: { bank: true } } } } } });
    if (paper.bank) await assertScope(principal, paper.bank.scopeType, paper.bank.scopeId); else for (const item of paper.items) await assertScope(principal, item.question.bank.scopeType, item.question.bank.scopeId);
    await prisma.$transaction(async (tx) => { await tx.trainingAutomationConfig.updateMany({ where: { paperId: id, active: true }, data: { active: false } }); await tx.examPaper.update({ where: { id }, data: { active: false } }); await tx.auditLog.create({ data: { actorId: principal.accountId, action: "exam_paper.delete", objectType: "exam_paper", objectId: id, result: "success" } }); });
    return { data: { id, deleted: true } };
  });

  app.get("/api/training-batches", manager, async (request) => {
    const principal = principalOf(request); const orgIds = await accessibleOrganizationIds(principal); const projectIds = projectScopeIds(principal);
    const where = isCompanyAdmin(principal) ? {} : { OR: [{ projectId: { in: projectIds } }, { assignments: { some: { person: { organizations: { some: { active: true, organizationId: { in: orgIds } } } } } } }] };
    return { data: await prisma.trainingBatch.findMany({ where, include: { template: true, paper: true, project: true, assignments: { include: { person: { select: { id: true, name: true, phone: true } } } } }, orderBy: { createdAt: "desc" } }) };
  });
  app.post("/api/training-batches/preflight", manager, async (request) => {
    const principal = principalOf(request);
    return { data: await preflightTrainingWorkflow(principal, request.body, deps.env) };
  });
  app.post("/api/training-batches", manager, async (request, reply) => {
    const principal = principalOf(request);
    const envelope = z.object({
      draft: trainingWorkflowInputSchema,
      preflightToken: z.string().min(20),
      preflightFingerprint: z.string().length(64),
      idempotencyKey: z.string().uuid()
    }).parse(request.body);
    const businessKey = `manual:${principal.accountId}:${envelope.idempotencyKey}`;
    const existing = await prisma.trainingBatch.findUnique({ where: { businessKey } });
    if (existing) {
      if (existing.dispatchFingerprint !== envelope.preflightFingerprint) throw Object.assign(new Error("幂等键已用于另一份培训配置"), { statusCode: 409, code: "IDEMPOTENCY_KEY_REUSED" });
      return { data: { ...(existing.dispatchResult as Record<string, unknown>), batchId: existing.id, duplicate: true } };
    }
    const externalQueued = Boolean(deps.env.WECHAT_APP_ID && deps.env.WECHAT_APP_SECRET && deps.env.WECHAT_SUBSCRIBE_TEMPLATE_TASK);
    let result;
    try { result = await prisma.$transaction(async (tx) => {
      const resolution = await resolveTrainingWorkflow(tx, principal, envelope.draft);
      if (resolution.blockers.length) throw Object.assign(new Error(resolution.blockers.map(({ message }) => message).join("；")), { statusCode: 409, code: "TRAINING_NOT_READY", details: resolution.blockers });
      if (resolution.fingerprint !== envelope.preflightFingerprint) throw Object.assign(new Error("培训配置或人员范围已经变化，请重新预检"), { statusCode: 409, code: "PREFLIGHT_STALE" });
      await verifyTrainingPreflight(envelope.preflightToken, resolution.fingerprint, principal, deps.env);
      const input = resolution.input;
      const dispatchResult = {
        assignmentCount: resolution.included.length,
        excludedCount: resolution.excluded.length,
        failedCount: 0,
        excluded: resolution.excluded,
        notification: { systemCreated: resolution.included.length, externalDelivery: externalQueued ? "queued" : "not_configured" }
      };
      const created = await tx.trainingBatch.create({ data: {
        businessKey,
        dispatchFingerprint: resolution.fingerprint,
        name: input.name,
        description: input.description || null,
        type: input.type,
        templateId: input.templateId,
        paperId: input.examRequired ? input.paperId ?? null : null,
        paperSnapshot: resolution.paperSnapshot as unknown as Prisma.InputJsonValue,
        coursewareSnapshot: resolution.coursewares as unknown as Prisma.InputJsonValue,
        dispatchResult: dispatchResult as unknown as Prisma.InputJsonValue,
        projectId: input.targetType === "project" ? input.projectId ?? null : null,
        dueAt: input.dueAt ?? null,
        durationMin: input.durationMin,
        passScore: input.passScore,
        maxAttempts: input.maxAttempts
      } });
      await createAssignments(tx, created.id, input.templateId, resolution.included.map(({ id }) => id), deps.env);
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "training_batch.dispatch", objectType: "training_batch", objectId: created.id, result: "success", metadata: { assignmentCount: resolution.included.length, excludedCount: resolution.excluded.length, deduplicatedCount: resolution.deduplicatedCount, fingerprint: resolution.fingerprint } } });
      return { created, resolution };
    }, { isolationLevel: "Serializable" }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await prisma.trainingBatch.findUnique({ where: { businessKey } });
        if (raced?.dispatchFingerprint === envelope.preflightFingerprint) return { data: { ...(raced.dispatchResult as Record<string, unknown>), batchId: raced.id, duplicate: true } };
      }
      throw error;
    }
    return reply.code(201).send({ data: {
      batchId: result.created.id,
      assignmentCount: result.resolution.included.length,
      excludedCount: result.resolution.excluded.length,
      failedCount: 0,
      duplicate: false,
      excluded: result.resolution.excluded,
      notification: { systemCreated: result.resolution.included.length, externalDelivery: externalQueued ? "queued" : "not_configured" }
    } });
  });
  app.patch("/api/training-batches/:id", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const input = z.object({ name: z.string().trim().min(2).max(180), dueAt: z.coerce.date().nullable() }).parse(request.body);
    const batch = await prisma.trainingBatch.findUniqueOrThrow({ where: { id }, include: { assignments: { select: { personId: true } } } });
    if (batch.projectId && !await canAccessProject(principal, batch.projectId)) forbidden();
    for (const assignment of batch.assignments) if (!await canAccessPerson(principal, assignment.personId)) forbidden();
    const updated = await prisma.$transaction(async (tx) => { const row = await tx.trainingBatch.update({ where: { id }, data: { name: input.name, dueAt: input.dueAt } }); await tx.auditLog.create({ data: { actorId: principal.accountId, action: "training_batch.update", objectType: "training_batch", objectId: id, result: "success", metadata: { name: input.name, dueAt: input.dueAt?.toISOString() ?? null } } }); return row; });
    return { data: updated };
  });
  app.post("/api/training-batches/:id/cancel", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const { reason } = z.object({ reason: z.string().trim().min(2).max(500) }).parse(request.body);
    const batch = await prisma.trainingBatch.findUniqueOrThrow({ where: { id }, include: { assignments: { select: { personId: true, status: true } } } });
    if (batch.projectId && !await canAccessProject(principal, batch.projectId)) forbidden();
    for (const assignment of batch.assignments) if (!await canAccessPerson(principal, assignment.personId)) forbidden();
    const result = await prisma.$transaction(async (tx) => {
      const cancelled = await tx.trainingAssignment.updateMany({ where: { batchId: id, status: { notIn: ["completed", "cancelled"] } }, data: { status: "cancelled", cancelledAt: new Date() } });
      const completed = await tx.trainingAssignment.count({ where: { batchId: id, status: "completed" } });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "training_batch.cancel", objectType: "training_batch", objectId: id, result: "success", metadata: { reason, cancelled: cancelled.count, completedPreserved: completed } } });
      return { cancelled: cancelled.count, completedPreserved: completed };
    });
    return { data: result };
  });
  app.post("/api/training-batches/bootstrap-three-level", manager, async (request) => {
    const principal = principalOf(request);
    const employees = await prisma.person.findMany({ where: { type: "employee", status: "active" }, select: { id: true } });
    let created = 0;
    for (const employee of employees) if (await canAccessPerson(principal, employee.id) && await autoDispatch("three_level", employee.id, deps.env)) created++;
    audit(principal.accountId, "training_batch.bootstrap_three_level", "training_batch", undefined, { eligible: employees.length, processed: created });
    return { data: { eligible: employees.length, processed: created } };
  });

  app.get("/api/assignments", authenticated, async (request) => {
    const principal = principalOf(request);
    const managerRole = principal.roles.some(({ role }) => ["company_admin", "org_leader", "org_admin", "project_admin"].includes(role));
    const orgIds = managerRole ? await accessibleOrganizationIds(principal) : []; const projectIds = managerRole ? projectScopeIds(principal) : [];
    const where = !managerRole ? { personId: principal.personId ?? "00000000-0000-0000-0000-000000000000" } : isCompanyAdmin(principal) ? {} : { OR: [
      { batch: { projectId: { in: projectIds } } }, { person: { organizations: { some: { active: true, organizationId: { in: orgIds } } } } }
    ] };
    return { data: await prisma.trainingAssignment.findMany({ where, include: { batch: true, progress: { include: { coursewareVersion: { include: { courseware: true } } }, orderBy: { createdAt: "asc" } }, attempts: { select: { id: true, attemptNumber: true, status: true, score: true, passed: true, expiresAt: true } } }, orderBy: { createdAt: "desc" } }) };
  });
  app.get("/api/me/assignments", authenticated, async (request) => {
    const principal = principalOf(request);
    if (!principal.personId) forbidden("账号尚未绑定人员档案");
    const scope = z.object({ scope: z.enum(["todo", "records", "all"]).default("todo") }).parse(request.query).scope;
    const where: Prisma.TrainingAssignmentWhereInput = { personId: principal.personId };
    if (scope === "todo") where.status = { notIn: ["completed", "cancelled"] };
    if (scope === "records") where.status = { in: ["completed", "confirmation_pending"] };
    const rows = await prisma.trainingAssignment.findMany({ where, include: learnerAssignmentInclude, orderBy: { createdAt: "desc" } });
    if (scope === "todo") {
      const now = new Date();
      return { data: sortTodoAssignments(rows.map((row) => decorateTodoPriority({ ...learnerAssignment(row), trainingType: row.batch.type, dueAt: row.batch.dueAt }, now))) };
    }
    return { data: rows.map(learnerAssignment) };
  });
  app.get("/api/me/assignments/:id", authenticated, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    if (!principal.personId) forbidden("账号尚未绑定人员档案");
    const row = await prisma.trainingAssignment.findFirstOrThrow({ where: { id, personId: principal.personId }, include: learnerAssignmentInclude });
    const organization = row.batch.template?.scopeType === "organization" && row.batch.template.scopeId
      ? await prisma.organization.findUnique({ where: { id: row.batch.template.scopeId }, select: { id: true, name: true } }) : null;
    return { data: { ...learnerAssignment(row), organization } };
  });
  app.get("/api/me/records/:id", authenticated, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    if (!principal.personId) forbidden("账号尚未绑定人员档案");
    const row = await prisma.trainingAssignment.findFirstOrThrow({ where: { id, personId: principal.personId, status: { in: ["completed", "confirmation_pending"] } }, include: learnerAssignmentInclude });
    const confirmation = await prisma.projectConfirmation.findFirst({ where: { assignmentId: row.id }, select: { confirmedAt: true, confirmedBy: true }, orderBy: { confirmedAt: "desc" } });
    const confirmer = confirmation ? await prisma.account.findUnique({ where: { id: confirmation.confirmedBy }, select: { person: { select: { name: true } } } }) : null;
    return { data: { ...learnerAssignment(row), projectConfirmation: confirmation ? { confirmedAt: confirmation.confirmedAt, confirmerName: confirmer?.person?.name ?? "项目管理人员" } : null } };
  });
  app.get("/api/assignments/:id/coursewares/:versionId", authenticated, async (request) => {
    const principal = principalOf(request); const { id, versionId } = z.object({ id: z.string().uuid(), versionId: z.string().uuid() }).parse(request.params);
    const assignment = await assertAssignment(principal, id); if (principal.personId !== assignment.personId) forbidden("课件只能由本人学习");
    const progress = await prisma.learningProgress.findFirstOrThrow({ where: { assignmentId: id, coursewareVersionId: versionId }, orderBy: { remediationRound: "desc" }, include: { coursewareVersion: { include: { courseware: true } } } });
    if (!progress.openedAt) await prisma.learningProgress.update({ where: { id: progress.id }, data: { openedAt: new Date() } });
    if (assignment.status === "pending_learning") await prisma.$executeRaw`UPDATE training_assignments SET status = 'learning'::"AssignmentStatus", updated_at = now() WHERE id = ${id}::uuid AND status = 'pending_learning'::"AssignmentStatus"`;
    const version = progress.coursewareVersion;
    if (version.courseware.type === "rich_text") return { data: { title: version.courseware.title, type: version.courseware.type, richText: version.richText, resumeState: progress.resumeState, reachedEndAt: progress.reachedEndAt } };
    if (version.courseware.type === "structured") return { data: {
      title: version.courseware.title,
      type: version.courseware.type,
      ...serializeStructuredCoursewareForLearner(version.structuredContent, progress.resumeState),
      reachedEndAt: progress.reachedEndAt
    } };
    const token = await new SignJWT({ assignmentId: id, versionId, accountId: principal.accountId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(deps.env.UPLOAD_SIGNING_SECRET));
    return { data: { title: version.courseware.title, type: version.courseware.type, viewerUrl: `${deps.env.PUBLIC_BASE_URL}/api/courseware-viewer?token=${encodeURIComponent(token)}`, resumeState: progress.resumeState, reachedEndAt: progress.reachedEndAt } };
  });
  app.patch("/api/assignments/:id/coursewares/:versionId/resume", authenticated, async (request) => {
    const principal = principalOf(request); const { id, versionId } = z.object({ id: z.string().uuid(), versionId: z.string().uuid() }).parse(request.params);
    if (!principal.personId) forbidden("课件只能由本人学习");
    const incoming = resumeSchema.parse(request.body);
    const resumeState = await prisma.$transaction(async (tx) => {
      await lockLearnerAssignment(tx, id, principal.personId!);
      const progress = await currentLearnerProgress(tx, id, versionId, principal.personId!);
      if (!progress) forbidden("课件只能由本人学习");
      const updated = await tx.learningProgress.update({ where: { id: progress.id }, data: resumeUpdateData(progress.resumeState, incoming), select: { resumeState: true } });
      return updated.resumeState;
    });
    return { data: { resumeState } };
  });
  app.post("/api/assignments/:id/coursewares/:versionId/reached-end", authenticated, async (request) => {
    const principal = principalOf(request); const { id, versionId } = z.object({ id: z.string().uuid(), versionId: z.string().uuid() }).parse(request.params);
    if (!principal.personId) forbidden("课件只能由本人学习");
    const reachedEndAt = await prisma.$transaction(async (tx) => {
      await lockLearnerAssignment(tx, id, principal.personId!);
      const progress = await currentLearnerProgress(tx, id, versionId, principal.personId!);
      if (!progress) forbidden("课件只能由本人学习");
      if (!progress.openedAt) throw Object.assign(new Error("请先打开并浏览课件"), { statusCode: 409, code: "COURSEWARE_NOT_OPENED" });
      if (progress.reachedEndAt) return progress.reachedEndAt;
      return (await tx.learningProgress.update({ where: { id: progress.id }, data: { reachedEndAt: new Date() }, select: { reachedEndAt: true } })).reachedEndAt;
    });
    return { data: { reachedEndAt } };
  });
  app.get("/api/courseware-viewer", { logLevel: "silent" }, async (request, reply) => {
    const token = z.object({ token: z.string().min(1) }).parse(request.query).token;
    let payload: { assignmentId: string; versionId: string; accountId: string };
    try { const verified = await jwtVerify(token, new TextEncoder().encode(deps.env.UPLOAD_SIGNING_SECRET)); payload = z.object({ assignmentId: z.string().uuid(), versionId: z.string().uuid(), accountId: z.string().uuid() }).parse(verified.payload); }
    catch { throw Object.assign(new Error("课件链接已失效"), { statusCode: 401, code: "VIEWER_LINK_EXPIRED" }); }
    const account = await prisma.account.findUnique({ where: { id: payload.accountId }, select: { status: true, personId: true } });
    const progress = account?.status === "active" && account.personId ? await prisma.learningProgress.findFirst({ where: { assignmentId: payload.assignmentId, coursewareVersionId: payload.versionId, assignment: { personId: account.personId, status: { not: "cancelled" } } }, include: { coursewareVersion: { include: { file: true } } } }) : null;
    if (!progress?.coursewareVersion.file) forbidden("无权读取课件");
    const content = await readFile(resolve(deps.env.UPLOAD_ROOT, progress.coursewareVersion.file.storageKey));
    reply.header("Content-Type", "text/html; charset=utf-8"); for (const [name, value] of Object.entries(coursewareViewerHeaders())) reply.header(name, value);
    return reply.send(content);
  });
  app.post("/api/assignments/:id/learning/:versionId/complete", authenticated, async (request) => {
    const principal = principalOf(request); const { id, versionId } = z.object({ id: z.string().uuid(), versionId: z.string().uuid() }).parse(request.params);
    if (!principal.personId) forbidden("学习只能由本人完成");
    const remaining = await prisma.$transaction(async (tx) => {
      await lockLearnerAssignment(tx, id, principal.personId!);
      const assignment = await tx.trainingAssignment.findUniqueOrThrow({ where: { id }, select: { status: true, batch: { select: { paperId: true } } } });
      if (!["pending_learning", "learning", "remediation_required"].includes(assignment.status)) throw Object.assign(new Error("当前任务不可完成学习"), { statusCode: 409, code: "INVALID_ASSIGNMENT_STATE" });
      const progress = await currentLearnerProgress(tx, id, versionId, principal.personId!);
      if (!progress || progress.completedAt) throw Object.assign(new Error("课件不属于当前任务或已完成"), { statusCode: 409, code: "INVALID_PROGRESS" });
      const evidenceError = completionEvidenceError(progress);
      if (evidenceError === "COURSEWARE_NOT_OPENED") throw Object.assign(new Error("请先打开并浏览课件"), { statusCode: 409, code: evidenceError });
      if (evidenceError === "COURSEWARE_END_NOT_REACHED") throw Object.assign(new Error("请先浏览到课件末尾或确认已完成全部互动内容"), { statusCode: 409, code: evidenceError });
      await tx.learningProgress.update({ where: { id: progress.id }, data: { completedAt: new Date() } });
      const count = await tx.learningProgress.count({ where: { assignmentId: id, completedAt: null } });
      if (!count) await tx.trainingAssignment.update({ where: { id }, data: { status: assignment.batch.paperId ? "pending_exam" : "pending_signature" } });
      return count;
    });
    return { data: { remaining } };
  });

  app.post("/api/assignments/:id/attempts/start", authenticated, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const assignment = await assertAssignment(principal, id);
    if (!principal.personId || principal.personId !== assignment.personId) forbidden("考试只能由本人开始");
    const attempt = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM training_assignments WHERE id = ${id}::uuid FOR UPDATE`;
      const existing = await tx.examAttempt.findFirst({ where: { assignmentId: id, status: "in_progress", expiresAt: { gt: new Date() } }, include: { answers: { select: { questionId: true, answer: true } } }, orderBy: { attemptNumber: "desc" } }); if (existing) return existing;
      const current = await tx.trainingAssignment.findUniqueOrThrow({ where: { id }, include: { batch: true } });
      if (!(["pending_exam", "remediation_required"] as string[]).includes(current.status)) throw Object.assign(new Error("当前任务不可开始考试"), { statusCode: 409, code: "INVALID_ASSIGNMENT_STATE" });
      if (await tx.learningProgress.count({ where: { assignmentId: id, completedAt: null } })) throw Object.assign(new Error("请先完成全部课件"), { statusCode: 409, code: "LEARNING_INCOMPLETE" });
      if (!current.batch.paperId) throw Object.assign(new Error("本次培训不要求考试"), { statusCode: 409, code: "EXAM_NOT_REQUIRED" });
      const frozen = current.batch.paperSnapshot as unknown as BatchPaperSnapshot | null;
      if (!frozen?.questions.length) throw Object.assign(new Error("培训批次缺少考试快照"), { statusCode: 409, code: "BATCH_PAPER_SNAPSHOT_MISSING" });
      const questions = frozen.mode === "random" ? [...frozen.questions].sort(() => Math.random() - .5).slice(0, frozen.randomCount) : frozen.questions;
      const snapshot: ExamSnapshot = { questions, totalScore: questions.reduce((sum, item) => sum + item.score, 0) };
      const attemptNumber = await tx.examAttempt.count({ where: { assignmentId: id } }) + 1;
      return tx.examAttempt.create({ data: { assignmentId: id, attemptNumber, snapshot: snapshot as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + current.batch.durationMin * 60_000) } });
    });
    return { data: publicAttempt(attempt) };
  });
  app.put("/api/attempts/:id/answers", authenticated, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const attempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id } }); const assignment = await assertAssignment(principal, attempt.assignmentId); if (principal.personId !== assignment.personId) forbidden("答题只能由本人操作");
    const answers = z.object({ answers: z.array(z.object({ questionId: z.string().uuid(), answer: z.array(z.string()).min(1) })).max(200) }).parse(request.body).answers;
    const questionIds = new Set((attempt.snapshot as unknown as ExamSnapshot).questions.map((question) => question.id));
    if (new Set(answers.map((answer) => answer.questionId)).size !== answers.length || answers.some((answer) => !questionIds.has(answer.questionId))) throw Object.assign(new Error("答案不属于本次试卷"), { statusCode: 400, code: "INVALID_ATTEMPT_ANSWERS" });
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM exam_attempts WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.examAttempt.findUniqueOrThrow({ where: { id } });
      if (current.status !== "in_progress" || current.expiresAt <= new Date()) throw Object.assign(new Error("考试已结束"), { statusCode: 409, code: "ATTEMPT_CLOSED" });
      for (const answer of answers) await tx.examAnswer.upsert({ where: { attemptId_questionId: { attemptId: id, questionId: answer.questionId } }, create: { attemptId: id, questionId: answer.questionId, answer: answer.answer }, update: { answer: answer.answer } });
    });
    return { data: { saved: answers.length } };
  });
  app.post("/api/attempts/:id/submit", authenticated, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const found = await prisma.examAttempt.findUniqueOrThrow({ where: { id } }); const owned = await assertAssignment(principal, found.assignmentId); if (principal.personId !== owned.personId) forbidden("交卷只能由本人操作");
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM exam_attempts WHERE id = ${id}::uuid FOR UPDATE`;
      const attempt = await tx.examAttempt.findUniqueOrThrow({ where: { id }, include: { assignment: { include: { batch: true } }, answers: true } });
      if (attempt.status === "submitted") return { score: Number(attempt.score), passed: Boolean(attempt.passed), assignmentStatus: attempt.assignment.status, fresh: false };
      if (attempt.expiresAt < new Date()) throw Object.assign(new Error("考试已超时"), { statusCode: 409, code: "ATTEMPT_EXPIRED" });
      const snapshot = attempt.snapshot as unknown as ExamSnapshot; const answers = new Map(attempt.answers.map((answer) => [answer.questionId, answer.answer]));
      const raw = snapshot.questions.reduce((sum, question) => sum + (sameAnswer(answers.get(question.id), question.correct) ? question.score : 0), 0); const score = snapshot.totalScore ? Math.round(raw / snapshot.totalScore * 10000) / 100 : 0; const passed = score >= Number(attempt.assignment.batch.passScore); const assignmentStatus = passed ? "pending_signature" : attempt.attemptNumber >= attempt.assignment.batch.maxAttempts + attempt.assignment.extraAttempts ? "locked" : "remediation_required";
      await tx.examAttempt.update({ where: { id }, data: { status: "submitted", submittedAt: new Date(), score, passed } }); await tx.trainingAssignment.update({ where: { id: attempt.assignmentId }, data: { status: assignmentStatus } }); if (!passed && assignmentStatus === "remediation_required") { const originals = await tx.learningProgress.findMany({ where: { assignmentId: attempt.assignmentId, remediationRound: 0 }, select: { coursewareVersionId: true } }); await tx.learningProgress.createMany({ data: originals.map((item) => ({ assignmentId: attempt.assignmentId, coursewareVersionId: item.coursewareVersionId, remediationRound: attempt.attemptNumber })), skipDuplicates: true }); }
      return { score, passed, assignmentStatus, fresh: true };
    });
    if (result.fresh) audit(principal.accountId, "exam.submit", "exam_attempt", id, { score: result.score, passed: result.passed }); return { data: { score: result.score, passed: result.passed, assignmentStatus: result.assignmentStatus } };
  });
  app.post("/api/assignments/:id/sign", authenticated, async (request, reply) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const assignment = await assertAssignment(principal, id);
    if (!principal.personId || principal.personId !== assignment.personId) forbidden("签字只能由本人提交");
    if (assignment.status !== "pending_signature") throw Object.assign(new Error("当前任务不可签字"), { statusCode: 409, code: "INVALID_ASSIGNMENT_STATE" });
    const input = z.object({ fileId: z.string().uuid(), deviceInfo: z.record(z.string(), z.unknown()).optional() }).parse(request.body);
    const file = await prisma.privateFile.findFirst({ where: { id: input.fileId, kind: "signature", uploadedBy: principal.accountId }, select: { id: true } });
    if (!file) forbidden("签字文件无效");
    const record = await prisma.trainingAssignment.findUniqueOrThrow({ where: { id }, include: { batch: true, progress: { select: { coursewareVersionId: true, completedAt: true } }, attempts: { where: { passed: true }, select: { id: true, score: true, submittedAt: true }, orderBy: { submittedAt: "desc" }, take: 1 } } });
    const recordHash = createHash("sha256").update(JSON.stringify({ assignmentId: id, personId: principal.personId, batchId: record.batchId, coursewares: record.progress, passedAttempt: record.attempts[0] })).digest("hex");
    const signature = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM training_assignments WHERE id = ${id}::uuid FOR UPDATE`;
      if (await tx.signature.findFirst({ where: { assignmentId: id, correctionOfId: null } })) throw Object.assign(new Error("正式签字已提交，不可覆盖"), { statusCode: 409, code: "SIGNATURE_EXISTS" });
      const created = await tx.signature.create({ data: { assignmentId: id, personId: principal.personId!, fileId: input.fileId, recordHash, ...(input.deviceInfo ? { deviceInfo: input.deviceInfo as Prisma.InputJsonValue } : {}) } });
      await tx.trainingAssignment.update({ where: { id }, data: record.batch.type === "project_induction" ? { status: "confirmation_pending" } : { status: "completed", completedAt: new Date() } });
      return created;
    });
    audit(principal.accountId, "assignment.sign", "signature", signature.id, { assignmentId: id });
    return reply.code(201).send({ data: { id: signature.id, signedAt: signature.signedAt, status: record.batch.type === "project_induction" ? "confirmation_pending" : "completed" } });
  });
  app.post("/api/assignments/:id/unlock", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const assignment = await assertAssignment(principal, id, true); if (assignment.status !== "locked") throw Object.assign(new Error("任务未锁定"), { statusCode: 409, code: "NOT_LOCKED" }); const reason = z.object({ reason: z.string().trim().min(2).max(300) }).parse(request.body).reason;
    const round = await prisma.examAttempt.count({ where: { assignmentId: id } }); const originals = await prisma.learningProgress.findMany({ where: { assignmentId: id, remediationRound: 0 }, select: { coursewareVersionId: true } }); await prisma.$transaction(async (tx) => { await tx.trainingAssignment.update({ where: { id }, data: { status: "remediation_required", extraAttempts: { increment: 1 } } }); await tx.learningProgress.createMany({ data: originals.map((item) => ({ assignmentId: id, coursewareVersionId: item.coursewareVersionId, remediationRound: round })), skipDuplicates: true }); await writeCriticalAudit(tx, { actorId: principal.accountId, action: "assignment.unlock", objectType: "training_assignment", objectId: id, reason, metadata: { addedAttempts: 1 } }); }); return { data: { status: "remediation_required", addedAttempts: 1 } };
  });
}
