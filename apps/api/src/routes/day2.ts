import { createHash, randomUUID } from "node:crypto";
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
import { nextQuestionVersion, questionVersionSnapshot } from "../question-versions.js";
import { canPublishCourseware } from "../courseware-publish-policy.js";
import { writeCriticalAudit } from "../transaction-audit.js";
import { decorateTodoPriority, sortTodoAssignments } from "../training-todo-priority.js";
import { completionEvidenceError, latestLearningProgress, resumeUpdateData } from "../learning-progress-policy.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
type Deps = { env: Env; authenticate: Guard; requireManager: Guard };
const idParam = z.object({ id: z.string().uuid() });
const principalOf = (request: FastifyRequest) => request.principal ?? forbidden("未登录");
const scopeSchema = z.object({ scopeType: z.enum(["company", "organization", "project"]), scopeId: z.string().uuid().nullable().optional() });
export const resumeSchema = z.object({
  blockKey: z.string().trim().min(1).max(120),
  progressPercent: z.number().int().min(0).max(100)
});

async function assertScope(principal: Principal, scopeType: ScopeType, scopeId?: string | null) {
  if (scopeType === "company") {
    if (scopeId || !isCompanyAdmin(principal)) forbidden();
  } else if (scopeType === "organization") {
    if (!scopeId || !await canAccessOrganization(principal, scopeId)) forbidden();
  } else if (scopeType === "project") {
    if (!scopeId || !await canAccessProject(principal, scopeId)) forbidden();
  } else forbidden();
}

async function assertCoursewareFile(principal: Principal, fileId: string) {
  const file = await prisma.privateFile.findFirst({ where: { id: fileId, kind: "courseware", uploadedBy: principal.accountId }, select: { id: true } });
  if (!file) forbidden("HTML 课件文件无效");
}

async function visibleScope(principal: Principal) {
  if (isCompanyAdmin(principal)) return {};
  return { OR: [
    { scopeType: "organization" as const, scopeId: { in: await accessibleOrganizationIds(principal) } },
    { scopeType: "project" as const, scopeId: { in: projectScopeIds(principal) } }
  ] };
}

async function assertAssignment(principal: Principal, assignmentId: string, manager = false) {
  const assignment = await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { batch: true } });
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
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM training_assignments WHERE id = ${assignmentId}::uuid AND person_id = ${personId}::uuid FOR UPDATE`;
  if (!rows.length) forbidden("课件只能由本人学习");
}

const normalize = (value: unknown) => Array.isArray(value) ? [...value].map(String).sort() : [String(value)].sort();
const sameAnswer = (a: unknown, b: unknown) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
type SnapshotQuestion = { id: string; type: QuestionType; prompt: string; options: unknown; correct: unknown; score: number };
type ExamSnapshot = { questions: SnapshotQuestion[]; totalScore: number };
type BatchPaperSnapshot = { mode: "fixed" | "random"; questions: SnapshotQuestion[]; randomCount?: number };
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
  const coursewares = [...current.values()].map((item) => ({
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
    tx.trainingBatch.findUniqueOrThrow({ where: { id: batchId }, select: { name: true } }),
    tx.trainingTemplateItem.findMany({ where: { templateId }, orderBy: { sortOrder: "asc" } })
  ]);
  if (!items.length) throw Object.assign(new Error("培训模板没有已发布课件"), { statusCode: 400, code: "EMPTY_TEMPLATE" });
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
  const paper = await prisma.examPaper.findUniqueOrThrow({ where: { id: paperId }, include: { items: { include: { question: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } }, questionVersion: true }, orderBy: { sortOrder: "asc" } }, bank: { include: { questions: { where: { active: true }, include: { versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { createdAt: "asc" } } } } } });
  const questions = paper.mode === "fixed"
    ? paper.items.map(({ question, questionVersion, score }) => questionVersionSnapshot(questionVersion ?? question.versions[0] ?? { id: question.id, version: question.currentVersion, type: question.type, prompt: question.prompt, options: question.options, correct: question.correct, explanation: question.explanation }, Number(score)))
    : (paper.bank?.questions ?? []).map((question) => questionVersionSnapshot(question.versions[0] ?? { id: question.id, version: question.currentVersion, type: question.type, prompt: question.prompt, options: question.options, correct: question.correct, explanation: question.explanation }, 100 / (paper.randomCount ?? 1)));
  if (!questions.length || (paper.mode === "random" && questions.length < (paper.randomCount ?? 0))) throw Object.assign(new Error("试卷题目不足"), { statusCode: 409, code: "INSUFFICIENT_QUESTIONS" });
  return { mode: paper.mode, questions, ...(paper.mode === "random" ? { randomCount: paper.randomCount ?? 0 } : {}) };
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
  const paperSnapshot = await freezePaper(config.paperId);
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
    const [template, snapshot] = await Promise.all([prisma.trainingTemplate.findUniqueOrThrow({ where: { id: input.templateId } }), freezePaper(input.paperId)]); void snapshot;
    if (template.type !== input.type || !template.active) throw Object.assign(new Error("默认模板类型不匹配或已停用"), { statusCode: 409, code: "AUTOMATION_TEMPLATE_INVALID" });
    const row = await prisma.$transaction(async (tx) => { await tx.trainingAutomationConfig.updateMany({ where: { type: input.type, scopeType: input.scopeType, scopeId: input.scopeId ?? null, active: true }, data: { active: false } }); const created = await tx.trainingAutomationConfig.create({ data: { ...input, scopeId: input.scopeId ?? null, createdBy: principal.accountId } }); await writeCriticalAudit(tx, { actorId: principal.accountId, action: "training.automation_config", objectType: "training_automation_config", objectId: created.id, metadata: { type: input.type, scopeType: input.scopeType, scopeId: input.scopeId } }); return created; });
    return reply.code(201).send({ data: row });
  });

  app.get("/api/coursewares", manager, async (request) => ({ data: await prisma.courseware.findMany({ where: await visibleScope(principalOf(request)), include: { versions: { orderBy: { version: "desc" } } }, orderBy: { createdAt: "desc" } }) }));
  app.post("/api/coursewares", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = scopeSchema.extend({ title: z.string().trim().min(2).max(180), type: z.enum(["rich_text", "single_html"]), richText: z.string().min(1).optional(), fileId: z.string().uuid().optional() }).parse(request.body);
    await assertScope(principal, input.scopeType, input.scopeId);
    if (input.type === "rich_text" ? !input.richText : !input.fileId) throw Object.assign(new Error("课件内容不完整"), { statusCode: 400, code: "CONTENT_REQUIRED" });
    if (input.fileId) await assertCoursewareFile(principal, input.fileId);
    const content = input.richText ?? input.fileId!;
    const courseware = await prisma.courseware.create({ data: { title: input.title, type: input.type, scopeType: input.scopeType, scopeId: input.scopeId ?? null,
      versions: { create: { version: 1, richText: input.richText ?? null, fileId: input.fileId ?? null, contentHash: createHash("sha256").update(content).digest("hex") } } }, include: { versions: true } });
    audit(principal.accountId, "courseware.create", "courseware", courseware.id);
    return reply.code(201).send({ data: courseware });
  });
  app.post("/api/coursewares/:id/versions", manager, async (request, reply) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    const courseware = await prisma.courseware.findUniqueOrThrow({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    await assertScope(principal, courseware.scopeType, courseware.scopeId);
    const input = z.object({ richText: z.string().min(1).optional(), fileId: z.string().uuid().optional() }).parse(request.body);
    const content = input.richText ?? input.fileId;
    if (!content || (courseware.type === "rich_text" ? !input.richText : !input.fileId)) throw Object.assign(new Error("课件内容不完整"), { statusCode: 400, code: "CONTENT_REQUIRED" });
    if (input.fileId) await assertCoursewareFile(principal, input.fileId);
    const version = await prisma.coursewareVersion.create({ data: { coursewareId: id, version: (courseware.versions[0]?.version ?? 0) + 1, richText: input.richText ?? null, fileId: input.fileId ?? null, contentHash: createHash("sha256").update(content).digest("hex") } });
    audit(principal.accountId, "courseware.version_create", "courseware_version", version.id);
    return reply.code(201).send({ data: version });
  });
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

  app.get("/api/training-templates", manager, async (request) => ({ data: await prisma.trainingTemplate.findMany({ where: await visibleScope(principalOf(request)), include: { items: { include: { coursewareVersion: { include: { courseware: true } } }, orderBy: { sortOrder: "asc" } } } }) }));
  app.post("/api/training-templates", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = scopeSchema.extend({ name: z.string().trim().min(2).max(180), type: z.enum(["three_level", "project_induction", "routine", "change_update"]), coursewareVersionIds: z.array(z.string().uuid()).min(1) }).parse(request.body);
    await assertScope(principal, input.scopeType, input.scopeId);
    const versions = await prisma.coursewareVersion.findMany({ where: { id: { in: input.coursewareVersionIds }, status: "published" }, include: { courseware: true } });
    if (versions.length !== new Set(input.coursewareVersionIds).size) throw Object.assign(new Error("模板只能引用已发布课件版本"), { statusCode: 400, code: "UNPUBLISHED_COURSEWARE" });
    for (const version of versions) await assertScope(principal, version.courseware.scopeType, version.courseware.scopeId);
    const template = await prisma.trainingTemplate.create({ data: { name: input.name, type: input.type, scopeType: input.scopeType, scopeId: input.scopeId ?? null, items: { create: [...new Set(input.coursewareVersionIds)].map((coursewareVersionId, sortOrder) => ({ coursewareVersionId, sortOrder })) } }, include: { items: true } });
    audit(principal.accountId, "training_template.create", "training_template", template.id);
    return reply.code(201).send({ data: template });
  });

  app.get("/api/question-banks", manager, async (request) => ({ data: await prisma.questionBank.findMany({ where: await visibleScope(principalOf(request)), include: { questions: true } }) }));
  app.post("/api/question-banks", manager, async (request, reply) => {
    const principal = principalOf(request); const input = scopeSchema.extend({ name: z.string().trim().min(2).max(160) }).parse(request.body);
    await assertScope(principal, input.scopeType, input.scopeId);
    const bank = await prisma.questionBank.create({ data: { name: input.name, scopeType: input.scopeType, scopeId: input.scopeId ?? null } });
    audit(principal.accountId, "question_bank.create", "question_bank", bank.id);
    return reply.code(201).send({ data: bank });
  });
  app.post("/api/question-banks/:id/questions", manager, async (request, reply) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    const bank = await prisma.questionBank.findUniqueOrThrow({ where: { id } }); await assertScope(principal, bank.scopeType, bank.scopeId);
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
      const version = nextQuestionVersion(question.currentVersion);
      await tx.questionVersion.create({ data: { questionId: id, version, type: input.type, prompt: input.prompt, options: input.options, correct: input.correct, explanation: input.explanation ?? null, createdBy: principal.accountId } });
      const updated = await tx.question.update({ where: { id }, data: { type: input.type, prompt: input.prompt, options: input.options, correct: input.correct, explanation: input.explanation ?? null, currentVersion: version, ...(input.active === undefined ? {} : { active: input.active }) } });
      await tx.auditLog.create({ data: { actorId: principal.accountId, action: "question.version_create", objectType: "question", objectId: id, result: "success", metadata: { fromVersion: question.currentVersion, toVersion: version } } }); return updated;
    }, { isolationLevel: "Serializable" }) };
  });
  app.get("/api/question-import-template.csv", manager, async (_request, reply) => reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", "attachment; filename*=UTF-8''question-import-template.csv")
    .send(questionImportTemplate()));
  app.post("/api/question-banks/:id/questions/import", manager, async (request, reply) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    const bank = await prisma.questionBank.findUniqueOrThrow({ where: { id } }); await assertScope(principal, bank.scopeType, bank.scopeId);
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
    const where = isCompanyAdmin(principal) ? {} : { OR: [{ bank: scopeWhere }, { items: { some: { question: { bank: scopeWhere } } } }] };
    return { data: await prisma.examPaper.findMany({ where, include: { items: { include: { question: true }, orderBy: { sortOrder: "asc" } }, bank: true } }) };
  });
  app.post("/api/exam-papers", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = z.discriminatedUnion("mode", [
      z.object({ name: z.string().min(2).max(160), mode: z.literal("fixed"), items: z.array(z.object({ questionId: z.string().uuid(), score: z.number().positive() })).min(1) }),
      z.object({ name: z.string().min(2).max(160), mode: z.literal("random"), bankId: z.string().uuid(), randomCount: z.number().int().positive().max(200) })
    ]).parse(request.body);
    if (input.mode === "random") { const bank = await prisma.questionBank.findUniqueOrThrow({ where: { id: input.bankId } }); await assertScope(principal, bank.scopeType, bank.scopeId); }
    else for (const item of input.items) { const question = await prisma.question.findUniqueOrThrow({ where: { id: item.questionId }, include: { bank: true } }); await assertScope(principal, question.bank.scopeType, question.bank.scopeId); }
    const currentVersions = new Map<string, string>();
    if (input.mode === "fixed") for (const version of await prisma.questionVersion.findMany({ where: { questionId: { in: input.items.map(({ questionId }) => questionId) } }, orderBy: { version: "desc" } })) if (!currentVersions.has(version.questionId)) currentVersions.set(version.questionId, version.id);
    const paper = await prisma.examPaper.create({ data: input.mode === "fixed" ? { name: input.name, mode: input.mode, items: { create: input.items.map((item, sortOrder) => ({ ...item, ...(currentVersions.get(item.questionId) ? { questionVersionId: currentVersions.get(item.questionId)! } : {}), sortOrder })) } } : { name: input.name, mode: input.mode, bankId: input.bankId, randomCount: input.randomCount }, include: { items: true } });
    audit(principal.accountId, "exam_paper.create", "exam_paper", paper.id);
    return reply.code(201).send({ data: paper });
  });

  app.get("/api/training-batches", manager, async (request) => {
    const principal = principalOf(request); const orgIds = await accessibleOrganizationIds(principal); const projectIds = projectScopeIds(principal);
    const where = isCompanyAdmin(principal) ? {} : { OR: [{ projectId: { in: projectIds } }, { assignments: { some: { person: { organizations: { some: { active: true, organizationId: { in: orgIds } } } } } } }] };
    return { data: await prisma.trainingBatch.findMany({ where, include: { template: true, paper: true, project: true, assignments: { include: { person: { select: { id: true, name: true, phone: true } } } } }, orderBy: { createdAt: "desc" } }) };
  });
  app.post("/api/training-batches", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = z.object({ name: z.string().min(2).max(180), type: z.enum(["three_level", "project_induction", "routine", "change_update"]), templateId: z.string().uuid(), paperId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), dueAt: z.coerce.date().optional(), durationMin: z.number().int().min(1).max(240).default(30), passScore: z.number().min(0).max(100).default(80), maxAttempts: z.number().int().min(1).max(10).default(3), personIds: z.array(z.string().uuid()).default([]), organizationIds: z.array(z.string().uuid()).default([]) }).parse(request.body);
    if (["three_level", "project_induction"].includes(input.type) && !input.paperId) throw Object.assign(new Error("三级教育和项目入场教育必须配置考试"), { statusCode: 400, code: "EXAM_REQUIRED" });
    if (input.type === "project_induction" && !input.projectId) throw Object.assign(new Error("项目入场教育必须绑定项目"), { statusCode: 400, code: "PROJECT_REQUIRED" });
    if (input.projectId) { if (!await canAccessProject(principal, input.projectId)) forbidden(); const project = await prisma.project.findUniqueOrThrow({ where: { id: input.projectId }, select: { status: true } }); if (project.status !== "active") throw Object.assign(new Error("暂停或结束项目不能下发新培训"), { statusCode: 409, code: "PROJECT_READ_ONLY" }); }
    const template = await prisma.trainingTemplate.findUniqueOrThrow({ where: { id: input.templateId } }); await assertScope(principal, template.scopeType, template.scopeId);
    if (template.type !== input.type) throw Object.assign(new Error("模板培训类型不匹配"), { statusCode: 400, code: "TYPE_MISMATCH" });
    let paperSnapshot: BatchPaperSnapshot | undefined;
    if (input.paperId) {
      const paper = await prisma.examPaper.findUniqueOrThrow({ where: { id: input.paperId }, include: { bank: true, items: { include: { question: { include: { bank: true } } } } } });
      if (paper.bank) await assertScope(principal, paper.bank.scopeType, paper.bank.scopeId);
      for (const item of paper.items) await assertScope(principal, item.question.bank.scopeType, item.question.bank.scopeId);
      paperSnapshot = await freezePaper(input.paperId);
    }
    if (input.personIds.length) throw Object.assign(new Error("培训下发只允许按完整部门或完整项目选择"), { statusCode: 400, code: "INDIVIDUAL_TARGET_DISABLED" });
    const ids = new Set<string>();
    const directOrgScopes = organizationScopeIds(principal);
    if (input.projectId && !isCompanyAdmin(principal) && !directOrgScopes.length) {
      if (!projectScopeIds(principal).includes(input.projectId)) forbidden();
      (await prisma.projectMember.findMany({ where: { projectId: input.projectId, status: "active" }, select: { personId: true } })).forEach(({ personId }) => ids.add(personId));
    } else if (input.type === "project_induction" && input.projectId) {
      (await prisma.projectMember.findMany({ where: { projectId: input.projectId, status: "active" }, select: { personId: true } })).forEach(({ personId }) => ids.add(personId));
    } else {
      const selectableOrgIds = isCompanyAdmin(principal) ? (await prisma.organization.findMany({ where: { type: { in: ["department", "business_entity"] } }, select: { id: true } })).map(({ id }) => id) : directOrgScopes;
      const requestedOrgIds = input.organizationIds.length ? [...new Set(input.organizationIds)] : selectableOrgIds;
      if (requestedOrgIds.some((id) => !selectableOrgIds.includes(id))) forbidden("只能选择完整的授权部门");
      (await prisma.organizationMembership.findMany({ where: { active: true, organizationId: { in: requestedOrgIds }, person: { status: "active" } }, select: { personId: true } })).forEach(({ personId }) => ids.add(personId));
    }
    const persons = await prisma.person.findMany({ where: { id: { in: [...ids] }, status: "active", ...(input.type === "three_level" ? { type: "employee" as const } : {}) }, select: { id: true } });
    for (const person of persons) if (!await canAccessPerson(principal, person.id)) forbidden();
    if (!persons.length) throw Object.assign(new Error("没有符合条件的在用人员"), { statusCode: 400, code: "NO_TARGETS" });
    const batch = await prisma.$transaction(async (tx) => { const created = await tx.trainingBatch.create({ data: { businessKey: `manual:${randomUUID()}`, name: input.name, type: input.type, templateId: input.templateId, paperId: input.paperId ?? null, paperSnapshot: paperSnapshot as unknown as Prisma.InputJsonValue, projectId: input.projectId ?? null, dueAt: input.dueAt ?? null, durationMin: input.durationMin, passScore: input.passScore, maxAttempts: input.maxAttempts } }); await createAssignments(tx, created.id, input.templateId, persons.map(({ id }) => id), deps.env); return created; });
    audit(principal.accountId, "training_batch.dispatch", "training_batch", batch.id, { assignmentCount: persons.length });
    return reply.code(201).send({ data: { ...batch, assignmentCount: persons.length } });
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
    const progress = account?.status === "active" && account.personId ? await prisma.learningProgress.findFirst({ where: { assignmentId: payload.assignmentId, coursewareVersionId: payload.versionId, assignment: { personId: account.personId } }, include: { coursewareVersion: { include: { file: true } } } }) : null;
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
