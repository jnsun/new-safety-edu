import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma, type QuestionType, type ScopeType, type TrainingType } from "@prisma/client";
import { z } from "zod";
import { accessibleOrganizationIds, canAccessOrganization, canAccessPerson, canAccessProject, forbidden, isCompanyAdmin, projectScopeIds } from "../access.js";
import { audit, auditCritical } from "../audit.js";
import type { Principal } from "../auth.js";
import { prisma } from "../db.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
type Deps = { authenticate: Guard; requireManager: Guard };
const idParam = z.object({ id: z.string().uuid() });
const principalOf = (request: FastifyRequest) => request.principal ?? forbidden("未登录");
const scopeSchema = z.object({ scopeType: z.enum(["company", "organization", "project"]), scopeId: z.string().uuid().nullable().optional() });

async function assertScope(principal: Principal, scopeType: ScopeType, scopeId?: string | null) {
  if (scopeType === "company") {
    if (scopeId || !isCompanyAdmin(principal)) forbidden();
  } else if (scopeType === "organization") {
    if (!scopeId || !await canAccessOrganization(principal, scopeId)) forbidden();
  } else if (scopeType === "project") {
    if (!scopeId || !await canAccessProject(principal, scopeId)) forbidden();
  } else forbidden();
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

const normalize = (value: unknown) => Array.isArray(value) ? [...value].map(String).sort() : [String(value)].sort();
const sameAnswer = (a: unknown, b: unknown) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
type SnapshotQuestion = { id: string; type: QuestionType; prompt: string; options: unknown; correct: unknown; score: number };
type ExamSnapshot = { questions: SnapshotQuestion[]; totalScore: number };
const publicAttempt = (attempt: { id: string; attemptNumber: number; startedAt: Date; expiresAt: Date; status: string; snapshot: Prisma.JsonValue }) => {
  const snapshot = attempt.snapshot as unknown as ExamSnapshot;
  return { id: attempt.id, attemptNumber: attempt.attemptNumber, startedAt: attempt.startedAt, expiresAt: attempt.expiresAt, status: attempt.status,
    questions: snapshot.questions.map(({ correct: _correct, ...question }) => question) };
};

async function createAssignments(tx: Prisma.TransactionClient, batchId: string, templateId: string, personIds: string[]) {
  const items = await tx.trainingTemplateItem.findMany({ where: { templateId }, orderBy: { sortOrder: "asc" } });
  if (!items.length) throw Object.assign(new Error("培训模板没有已发布课件"), { statusCode: 400, code: "EMPTY_TEMPLATE" });
  for (const personId of personIds) {
    const assignment = await tx.trainingAssignment.create({ data: { batchId, personId } });
    await tx.learningProgress.createMany({ data: items.map((item) => ({ assignmentId: assignment.id, coursewareVersionId: item.coursewareVersionId })) });
  }
}

export async function autoDispatch(type: "three_level" | "project_induction", personId: string, projectId?: string) {
  const template = await prisma.trainingTemplate.findFirst({ where: { type, active: true, OR: [
    ...(projectId ? [{ scopeType: "project" as const, scopeId: projectId }] : []), { scopeType: "company" as const, scopeId: null }
  ] }, orderBy: { createdAt: "asc" } });
  const paper = await prisma.examPaper.findFirst({ orderBy: { createdAt: "asc" } });
  if (!template || !paper) return null;
  const businessKey = `auto:${type}:${projectId ?? "company"}:${personId}`;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.trainingBatch.findUnique({ where: { businessKey }, include: { assignments: true } });
    if (existing) return existing;
    const batch = await tx.trainingBatch.create({ data: { businessKey, name: type === "three_level" ? "员工基础三级教育" : "项目入场教育", type, templateId: template.id, paperId: paper.id, projectId: projectId ?? null } });
    await createAssignments(tx, batch.id, template.id, [personId]);
    return batch;
  });
}

export async function registerDay2Routes(app: FastifyInstance, deps: Deps) {
  const authenticated = { preHandler: deps.authenticate };
  const manager = { preHandler: [deps.authenticate, deps.requireManager] };

  app.get("/api/coursewares", manager, async (request) => ({ data: await prisma.courseware.findMany({ where: await visibleScope(principalOf(request)), include: { versions: { orderBy: { version: "desc" } } }, orderBy: { createdAt: "desc" } }) }));
  app.post("/api/coursewares", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = scopeSchema.extend({ title: z.string().trim().min(2).max(180), type: z.enum(["rich_text", "single_html"]), richText: z.string().min(1).optional(), fileId: z.string().uuid().optional() }).parse(request.body);
    await assertScope(principal, input.scopeType, input.scopeId);
    if (input.type === "rich_text" ? !input.richText : !input.fileId) throw Object.assign(new Error("课件内容不完整"), { statusCode: 400, code: "CONTENT_REQUIRED" });
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
    const version = await prisma.coursewareVersion.create({ data: { coursewareId: id, version: (courseware.versions[0]?.version ?? 0) + 1, richText: input.richText ?? null, fileId: input.fileId ?? null, contentHash: createHash("sha256").update(content).digest("hex") } });
    audit(principal.accountId, "courseware.version_create", "courseware_version", version.id);
    return reply.code(201).send({ data: version });
  });
  app.post("/api/courseware-versions/:id/publish", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params);
    const version = await prisma.coursewareVersion.findUniqueOrThrow({ where: { id }, include: { courseware: true } });
    await assertScope(principal, version.courseware.scopeType, version.courseware.scopeId);
    const updated = await prisma.coursewareVersion.update({ where: { id }, data: { status: "published", publishedAt: new Date() } });
    await auditCritical(principal.accountId, "courseware.publish", "courseware_version", id, undefined, "var/audit-fallback.ndjson");
    return { data: updated };
  });

  app.get("/api/training-templates", manager, async (request) => ({ data: await prisma.trainingTemplate.findMany({ where: await visibleScope(principalOf(request)), include: { items: { include: { coursewareVersion: { include: { courseware: true } } }, orderBy: { sortOrder: "asc" } } } }) }));
  app.post("/api/training-templates", manager, async (request, reply) => {
    const principal = principalOf(request);
    const input = scopeSchema.extend({ name: z.string().trim().min(2).max(180), type: z.enum(["three_level", "project_induction", "routine", "change_update"]), coursewareVersionIds: z.array(z.string().uuid()).min(1) }).parse(request.body);
    await assertScope(principal, input.scopeType, input.scopeId);
    const count = await prisma.coursewareVersion.count({ where: { id: { in: input.coursewareVersionIds }, status: "published" } });
    if (count !== new Set(input.coursewareVersionIds).size) throw Object.assign(new Error("模板只能引用已发布课件版本"), { statusCode: 400, code: "UNPUBLISHED_COURSEWARE" });
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
    const question = await prisma.question.create({ data: { bankId: id, type: input.type, prompt: input.prompt, options: input.options, correct: input.correct, explanation: input.explanation ?? null } }); audit(principal.accountId, "question.create", "question", question.id);
    return reply.code(201).send({ data: question });
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
    const paper = await prisma.examPaper.create({ data: input.mode === "fixed" ? { name: input.name, mode: input.mode, items: { create: input.items.map((item, sortOrder) => ({ ...item, sortOrder })) } } : { name: input.name, mode: input.mode, bankId: input.bankId, randomCount: input.randomCount }, include: { items: true } });
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
    const input = z.object({ name: z.string().min(2).max(180), type: z.enum(["three_level", "project_induction", "routine", "change_update"]), templateId: z.string().uuid(), paperId: z.string().uuid(), projectId: z.string().uuid().optional(), dueAt: z.coerce.date().optional(), durationMin: z.number().int().min(1).max(240).default(30), passScore: z.number().min(0).max(100).default(80), maxAttempts: z.number().int().min(1).max(10).default(3), personIds: z.array(z.string().uuid()).default([]), organizationIds: z.array(z.string().uuid()).default([]) }).parse(request.body);
    if (input.type === "project_induction" && !input.projectId) throw Object.assign(new Error("项目入场教育必须绑定项目"), { statusCode: 400, code: "PROJECT_REQUIRED" });
    if (input.projectId && !await canAccessProject(principal, input.projectId)) forbidden();
    const template = await prisma.trainingTemplate.findUniqueOrThrow({ where: { id: input.templateId } }); await assertScope(principal, template.scopeType, template.scopeId);
    if (template.type !== input.type) throw Object.assign(new Error("模板培训类型不匹配"), { statusCode: 400, code: "TYPE_MISMATCH" });
    const paper = await prisma.examPaper.findUniqueOrThrow({ where: { id: input.paperId }, include: { bank: true, items: { include: { question: { include: { bank: true } } } } } });
    if (paper.bank) await assertScope(principal, paper.bank.scopeType, paper.bank.scopeId);
    for (const item of paper.items) await assertScope(principal, item.question.bank.scopeType, item.question.bank.scopeId);
    const ids = new Set(input.personIds);
    if (input.organizationIds.length) (await prisma.organizationMembership.findMany({ where: { active: true, organizationId: { in: input.organizationIds }, person: { status: "active" } }, select: { personId: true } })).forEach(({ personId }) => ids.add(personId));
    if (input.projectId) (await prisma.projectMember.findMany({ where: { projectId: input.projectId, status: "active" }, select: { personId: true } })).forEach(({ personId }) => ids.add(personId));
    const persons = await prisma.person.findMany({ where: { id: { in: [...ids] }, status: "active", ...(input.type === "three_level" ? { type: "employee" as const } : {}) }, select: { id: true } });
    for (const person of persons) if (!await canAccessPerson(principal, person.id)) forbidden();
    if (!persons.length) throw Object.assign(new Error("没有符合条件的在用人员"), { statusCode: 400, code: "NO_TARGETS" });
    const batch = await prisma.$transaction(async (tx) => { const created = await tx.trainingBatch.create({ data: { businessKey: `manual:${randomUUID()}`, name: input.name, type: input.type, templateId: input.templateId, paperId: input.paperId, projectId: input.projectId ?? null, dueAt: input.dueAt ?? null, durationMin: input.durationMin, passScore: input.passScore, maxAttempts: input.maxAttempts } }); await createAssignments(tx, created.id, input.templateId, persons.map(({ id }) => id)); return created; });
    audit(principal.accountId, "training_batch.dispatch", "training_batch", batch.id, { assignmentCount: persons.length });
    return reply.code(201).send({ data: { ...batch, assignmentCount: persons.length } });
  });
  app.post("/api/training-batches/bootstrap-three-level", manager, async (request) => {
    const principal = principalOf(request);
    const employees = await prisma.person.findMany({ where: { type: "employee", status: "active" }, select: { id: true } });
    let created = 0;
    for (const employee of employees) if (await canAccessPerson(principal, employee.id) && await autoDispatch("three_level", employee.id)) created++;
    audit(principal.accountId, "training_batch.bootstrap_three_level", "training_batch", undefined, { eligible: employees.length, processed: created });
    return { data: { eligible: employees.length, processed: created } };
  });

  app.get("/api/assignments", authenticated, async (request) => {
    const principal = principalOf(request);
    const managerRole = principal.roles.some(({ role }) => role !== "learner");
    const orgIds = managerRole ? await accessibleOrganizationIds(principal) : []; const projectIds = managerRole ? projectScopeIds(principal) : [];
    const where = !managerRole ? { personId: principal.personId ?? "00000000-0000-0000-0000-000000000000" } : isCompanyAdmin(principal) ? {} : { OR: [
      { batch: { projectId: { in: projectIds } } }, { person: { organizations: { some: { active: true, organizationId: { in: orgIds } } } } }
    ] };
    return { data: await prisma.trainingAssignment.findMany({ where, include: { batch: true, progress: { include: { coursewareVersion: { include: { courseware: true } } }, orderBy: { createdAt: "asc" } }, attempts: { select: { id: true, attemptNumber: true, status: true, score: true, passed: true, expiresAt: true } } }, orderBy: { createdAt: "desc" } }) };
  });
  app.post("/api/assignments/:id/learning/:versionId/complete", authenticated, async (request) => {
    const principal = principalOf(request); const { id, versionId } = z.object({ id: z.string().uuid(), versionId: z.string().uuid() }).parse(request.params); const assignment = await assertAssignment(principal, id);
    if (principal.personId !== assignment.personId) forbidden("学习只能由本人完成");
    const now = new Date(); const progress = await prisma.learningProgress.updateMany({ where: { assignmentId: id, coursewareVersionId: versionId, completedAt: null }, data: { openedAt: now, reachedEndAt: now, completedAt: now } });
    if (!progress.count) throw Object.assign(new Error("课件不属于当前任务或已完成"), { statusCode: 409, code: "INVALID_PROGRESS" });
    const remaining = await prisma.learningProgress.count({ where: { assignmentId: id, completedAt: null } }); if (!remaining) await prisma.trainingAssignment.update({ where: { id }, data: { status: "pending_exam" } });
    return { data: { remaining } };
  });

  app.post("/api/assignments/:id/attempts/start", authenticated, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const assignment = await assertAssignment(principal, id);
    if (!principal.personId || principal.personId !== assignment.personId) forbidden("考试只能由本人开始");
    const existing = await prisma.examAttempt.findFirst({ where: { assignmentId: id, status: "in_progress", expiresAt: { gt: new Date() } }, orderBy: { attemptNumber: "desc" } }); if (existing) return { data: publicAttempt(existing) };
    if (!(["pending_exam", "remediation_required"] as string[]).includes(assignment.status)) throw Object.assign(new Error("当前任务不可开始考试"), { statusCode: 409, code: "INVALID_ASSIGNMENT_STATE" });
    if (await prisma.learningProgress.count({ where: { assignmentId: id, completedAt: null } })) throw Object.assign(new Error("请先完成全部课件"), { statusCode: 409, code: "LEARNING_INCOMPLETE" });
    const paper = await prisma.examPaper.findUniqueOrThrow({ where: { id: assignment.batch.paperId! }, include: { items: { include: { question: true }, orderBy: { sortOrder: "asc" } }, bank: { include: { questions: { where: { active: true } } } } } });
    const selected = paper.mode === "fixed" ? paper.items.map((item) => ({ question: item.question, score: Number(item.score) })) : (paper.bank?.questions ?? []).sort(() => Math.random() - .5).slice(0, paper.randomCount ?? 0).map((question) => ({ question, score: 100 / (paper.randomCount ?? 1) }));
    if (!selected.length || (paper.mode === "random" && selected.length !== paper.randomCount)) throw Object.assign(new Error("试卷题目不足"), { statusCode: 409, code: "INSUFFICIENT_QUESTIONS" });
    const snapshot: ExamSnapshot = { questions: selected.map(({ question, score }) => ({ id: question.id, type: question.type, prompt: question.prompt, options: question.options, correct: question.correct, score })), totalScore: selected.reduce((sum, item) => sum + item.score, 0) };
    const attemptNumber = await prisma.examAttempt.count({ where: { assignmentId: id } }) + 1;
    const attempt = await prisma.examAttempt.create({ data: { assignmentId: id, attemptNumber, snapshot: snapshot as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + assignment.batch.durationMin * 60_000) } });
    return { data: publicAttempt(attempt) };
  });
  app.put("/api/attempts/:id/answers", authenticated, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const attempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id } }); const assignment = await assertAssignment(principal, attempt.assignmentId); if (principal.personId !== assignment.personId) forbidden("答题只能由本人操作");
    if (attempt.status !== "in_progress" || attempt.expiresAt <= new Date()) throw Object.assign(new Error("考试已结束"), { statusCode: 409, code: "ATTEMPT_CLOSED" });
    const answers = z.object({ answers: z.array(z.object({ questionId: z.string().uuid(), answer: z.array(z.string()).min(1) })).max(200) }).parse(request.body).answers;
    await prisma.$transaction(answers.map((answer) => prisma.examAnswer.upsert({ where: { attemptId_questionId: { attemptId: id, questionId: answer.questionId } }, create: { attemptId: id, questionId: answer.questionId, answer: answer.answer }, update: { answer: answer.answer } })));
    return { data: { saved: answers.length } };
  });
  app.post("/api/attempts/:id/submit", authenticated, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const attempt = await prisma.examAttempt.findUniqueOrThrow({ where: { id }, include: { assignment: { include: { batch: true } }, answers: true } }); const owned = await assertAssignment(principal, attempt.assignmentId); if (principal.personId !== owned.personId) forbidden("交卷只能由本人操作");
    if (attempt.status === "submitted") return { data: { score: Number(attempt.score), passed: attempt.passed, assignmentStatus: attempt.assignment.status } };
    if (attempt.expiresAt < new Date()) throw Object.assign(new Error("考试已超时"), { statusCode: 409, code: "ATTEMPT_EXPIRED" });
    const snapshot = attempt.snapshot as unknown as ExamSnapshot; const answers = new Map(attempt.answers.map((answer) => [answer.questionId, answer.answer]));
    const raw = snapshot.questions.reduce((sum, question) => sum + (sameAnswer(answers.get(question.id), question.correct) ? question.score : 0), 0); const score = snapshot.totalScore ? Math.round(raw / snapshot.totalScore * 10000) / 100 : 0; const passed = score >= Number(attempt.assignment.batch.passScore); const status = passed ? "pending_signature" : attempt.attemptNumber >= attempt.assignment.batch.maxAttempts ? "locked" : "remediation_required";
    const result = await prisma.$transaction(async (tx) => { const submitted = await tx.examAttempt.update({ where: { id }, data: { status: "submitted", submittedAt: new Date(), score, passed } }); await tx.trainingAssignment.update({ where: { id: attempt.assignmentId }, data: { status } }); if (!passed && status === "remediation_required") { const originals = await tx.learningProgress.findMany({ where: { assignmentId: attempt.assignmentId, remediationRound: 0 }, select: { coursewareVersionId: true } }); await tx.learningProgress.createMany({ data: originals.map((item) => ({ assignmentId: attempt.assignmentId, coursewareVersionId: item.coursewareVersionId, remediationRound: attempt.attemptNumber })), skipDuplicates: true }); } return submitted; });
    audit(principal.accountId, "exam.submit", "exam_attempt", id, { score, passed }); return { data: { score: Number(result.score), passed, assignmentStatus: status } };
  });
  app.post("/api/assignments/:id/unlock", manager, async (request) => {
    const principal = principalOf(request); const { id } = idParam.parse(request.params); const assignment = await assertAssignment(principal, id, true); if (assignment.status !== "locked") throw Object.assign(new Error("任务未锁定"), { statusCode: 409, code: "NOT_LOCKED" }); const reason = z.object({ reason: z.string().trim().min(2).max(300) }).parse(request.body).reason;
    const round = await prisma.examAttempt.count({ where: { assignmentId: id } }); const originals = await prisma.learningProgress.findMany({ where: { assignmentId: id, remediationRound: 0 }, select: { coursewareVersionId: true } }); await prisma.$transaction([prisma.trainingAssignment.update({ where: { id }, data: { status: "remediation_required" } }), prisma.learningProgress.createMany({ data: originals.map((item) => ({ assignmentId: id, coursewareVersionId: item.coursewareVersionId, remediationRound: round })), skipDuplicates: true })]); await auditCritical(principal.accountId, "assignment.unlock", "training_assignment", id, { reason }, "var/audit-fallback.ndjson"); return { data: { status: "remediation_required" } };
  });
}
