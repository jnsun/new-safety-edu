import { createHash } from "node:crypto";
import { Prisma, type QuestionType, type ScopeType, type TrainingType } from "@prisma/client";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { canAccessOrganization, canAccessProject, forbidden, isCompanyAdmin, organizationScopeIds } from "./access.js";
import type { Principal } from "./auth.js";
import { prisma } from "./db.js";
import type { Env } from "./env.js";
import { questionVersionSnapshot } from "./question-versions.js";

export const trainingWorkflowInputSchema = z.object({
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().max(1000).optional().default(""),
  type: z.enum(["three_level", "project_induction", "routine", "change_update"]),
  templateId: z.string().uuid(),
  examRequired: z.boolean().default(false),
  paperId: z.string().uuid().optional(),
  targetType: z.enum(["organization", "project"]),
  projectId: z.string().uuid().optional(),
  organizationIds: z.array(z.string().uuid()).default([]),
  dueAt: z.coerce.date().optional(),
  durationMin: z.number().int().min(1).max(240).default(30),
  passScore: z.number().min(0).max(100).default(80),
  maxAttempts: z.number().int().min(1).max(10).default(3)
}).superRefine((value, context) => {
  const mandatory = value.type === "three_level" || value.type === "project_induction";
  if (mandatory && !value.examRequired) context.addIssue({ code: "custom", path: ["examRequired"], message: "三级安全教育和项目入场教育必须考试" });
  if (value.examRequired && !value.paperId) context.addIssue({ code: "custom", path: ["paperId"], message: "需要考试时必须选择试卷" });
  if (value.type === "project_induction" && value.targetType !== "project") context.addIssue({ code: "custom", path: ["targetType"], message: "项目入场教育必须按项目下发" });
  if (value.targetType === "project" && !value.projectId) context.addIssue({ code: "custom", path: ["projectId"], message: "请选择项目" });
});

export type TrainingWorkflowInput = z.infer<typeof trainingWorkflowInputSchema>;
export type TrainingBlocker = { code: string; message: string; field?: string };
export type TrainingTargetPerson = { id: string; name: string; personType: string };
export type TrainingExcludedPerson = TrainingTargetPerson & { reason: string };
export type CoursewareSnapshotItem = { coursewareVersionId: string; coursewareId: string; title: string; type: string; version: number; sortOrder: number };
export type BatchPaperSnapshot = { mode: "fixed" | "random"; questions: Array<{ id: string; questionVersionId?: string; questionVersion?: number; type: QuestionType; prompt: string; options: unknown; correct: unknown; explanation?: string | null; score: number }>; randomCount?: number };

export type TrainingResolution = {
  input: TrainingWorkflowInput;
  template: { id: string; name: string; type: TrainingType };
  coursewares: CoursewareSnapshotItem[];
  paper: { id: string; name: string; mode: string; availableQuestions: number; randomCount: number | null } | null;
  paperSnapshot?: BatchPaperSnapshot;
  included: TrainingTargetPerson[];
  excluded: TrainingExcludedPerson[];
  deduplicatedCount: number;
  blockers: TrainingBlocker[];
  fingerprint: string;
};

type WorkflowDb = Prisma.TransactionClient;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  if (value instanceof Date) return value.toISOString();
  return value;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

async function assertScope(principal: Principal, scopeType: ScopeType, scopeId?: string | null) {
  if (scopeType === "company") {
    if (scopeId || !isCompanyAdmin(principal)) forbidden();
  } else if (scopeType === "organization") {
    if (!scopeId || !await canAccessOrganization(principal, scopeId)) forbidden();
  } else if (scopeType === "project") {
    if (!scopeId || !await canAccessProject(principal, scopeId)) forbidden();
  } else forbidden();
}

export async function freezeTrainingPaper(db: WorkflowDb, paperId: string, principal?: Principal): Promise<{ paper: TrainingResolution["paper"]; snapshot?: BatchPaperSnapshot; blocker?: TrainingBlocker }> {
  const paper = await db.examPaper.findFirstOrThrow({ where: { id: paperId, active: true }, include: {
    items: { include: { question: { include: { bank: true, versions: { orderBy: { version: "desc" }, take: 1 } } }, questionVersion: true }, orderBy: { sortOrder: "asc" } },
    bank: { include: { questions: { where: { active: true }, include: { versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { createdAt: "asc" } } } }
  } });
  if (principal) {
    if (paper.bank) await assertScope(principal, paper.bank.scopeType, paper.bank.scopeId);
    for (const item of paper.items) await assertScope(principal, item.question.bank.scopeType, item.question.bank.scopeId);
  }
  const questions = paper.mode === "fixed"
    ? paper.items.map(({ question, questionVersion, score }) => questionVersionSnapshot(questionVersion ?? question.versions[0] ?? { id: question.id, version: question.currentVersion, type: question.type, prompt: question.prompt, options: question.options, correct: question.correct, explanation: question.explanation }, Number(score)))
    : (paper.bank?.questions ?? []).map((question) => questionVersionSnapshot(question.versions[0] ?? { id: question.id, version: question.currentVersion, type: question.type, prompt: question.prompt, options: question.options, correct: question.correct, explanation: question.explanation }, 100 / (paper.randomCount ?? 1)));
  const summary = { id: paper.id, name: paper.name, mode: paper.mode, availableQuestions: questions.length, randomCount: paper.randomCount ?? null };
  if (!questions.length || (paper.mode === "random" && questions.length < (paper.randomCount ?? 0))) {
    return { paper: summary, blocker: { code: "INSUFFICIENT_QUESTIONS", field: "paperId", message: `试卷题量不足：需要 ${paper.randomCount ?? 1} 题，当前可用 ${questions.length} 题` } };
  }
  return { paper: summary, snapshot: { mode: paper.mode, questions, ...(paper.mode === "random" ? { randomCount: paper.randomCount ?? 0 } : {}) } };
}

async function resolveTargets(db: WorkflowDb, principal: Principal, input: TrainingWorkflowInput) {
  const included = new Map<string, TrainingTargetPerson>();
  const excluded = new Map<string, TrainingExcludedPerson>();
  let candidates = 0;
  if (input.targetType === "project") {
    const projectId = input.projectId!;
    if (!await canAccessProject(principal, projectId)) forbidden("无权向该项目下发培训");
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { status: true } });
    if (project.status !== "active") throw Object.assign(new Error("暂停或结束项目不能下发新培训"), { statusCode: 409, code: "PROJECT_READ_ONLY" });
    const members = await db.projectMember.findMany({ where: { projectId, status: "active" }, include: { person: { select: { id: true, name: true, type: true, status: true } } } });
    candidates = members.length;
    for (const { person } of members) {
      const target = { id: person.id, name: person.name, personType: person.type };
      if (person.status !== "active") excluded.set(person.id, { ...target, reason: "人员不是在用状态" });
      else if (input.type === "three_level" && person.type !== "employee") excluded.set(person.id, { ...target, reason: "三级安全教育只面向正式员工" });
      else included.set(person.id, target);
    }
  } else {
    if (input.type === "project_induction") throw Object.assign(new Error("项目入场教育必须按项目下发"), { statusCode: 400, code: "PROJECT_REQUIRED" });
    const allowed = isCompanyAdmin(principal)
      ? (await db.organization.findMany({ where: { type: { in: ["department", "business_entity"] } }, select: { id: true } })).map(({ id }) => id)
      : organizationScopeIds(principal);
    const requested = input.organizationIds.length ? [...new Set(input.organizationIds)] : allowed;
    if (!requested.length) forbidden("当前账号没有可下发的组织范围");
    if (requested.some((id) => !allowed.includes(id))) forbidden("只能选择完整的授权组织");
    const memberships = await db.organizationMembership.findMany({ where: { active: true, organizationId: { in: requested } }, include: { person: { select: { id: true, name: true, type: true, status: true } } } });
    candidates = memberships.length;
    for (const { person } of memberships) {
      const target = { id: person.id, name: person.name, personType: person.type };
      if (person.status !== "active") excluded.set(person.id, { ...target, reason: "人员不是在用状态" });
      else if (input.type === "three_level" && person.type !== "employee") excluded.set(person.id, { ...target, reason: "三级安全教育只面向正式员工" });
      else included.set(person.id, target);
    }
  }
  return { included: [...included.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")), excluded: [...excluded.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")), deduplicatedCount: Math.max(0, candidates - included.size - excluded.size) };
}

export async function resolveTrainingWorkflow(db: WorkflowDb, principal: Principal, rawInput: unknown): Promise<TrainingResolution> {
  const input = trainingWorkflowInputSchema.parse(rawInput);
  const blockers: TrainingBlocker[] = [];
  const template = await db.trainingTemplate.findFirstOrThrow({ where: { id: input.templateId, active: true }, include: { items: { orderBy: { sortOrder: "asc" }, include: { coursewareVersion: { include: { courseware: true } } } } } });
  await assertScope(principal, template.scopeType, template.scopeId);
  if (template.type !== input.type) blockers.push({ code: "TYPE_MISMATCH", field: "templateId", message: "培训模板类型与本次培训类型不一致" });
  const coursewares = template.items.map(({ coursewareVersion, sortOrder }) => ({ coursewareVersionId: coursewareVersion.id, coursewareId: coursewareVersion.coursewareId, title: coursewareVersion.courseware.title, type: coursewareVersion.courseware.type, version: coursewareVersion.version, sortOrder }));
  if (!coursewares.length) blockers.push({ code: "EMPTY_TEMPLATE", field: "templateId", message: "培训至少需要一个已发布课件" });
  for (const item of template.items) {
    await assertScope(principal, item.coursewareVersion.courseware.scopeType, item.coursewareVersion.courseware.scopeId);
    if (!item.coursewareVersion.courseware.active || item.coursewareVersion.status !== "published") blockers.push({ code: "UNPUBLISHED_COURSEWARE", field: "templateId", message: `课件“${item.coursewareVersion.courseware.title}”尚未发布或已停用` });
  }
  const mandatory = input.type === "three_level" || input.type === "project_induction";
  if (mandatory && !input.examRequired) blockers.push({ code: "EXAM_REQUIRED", field: "examRequired", message: "三级安全教育和项目入场教育必须考试" });
  let paper: TrainingResolution["paper"] = null;
  let paperSnapshot: BatchPaperSnapshot | undefined;
  if (input.examRequired && input.paperId) {
    const frozen = await freezeTrainingPaper(db, input.paperId, principal);
    paper = frozen.paper;
    paperSnapshot = frozen.snapshot;
    if (frozen.blocker) blockers.push(frozen.blocker);
  } else if (input.examRequired) blockers.push({ code: "PAPER_REQUIRED", field: "paperId", message: "需要考试时必须选择试卷" });
  const targets = await resolveTargets(db, principal, input);
  if (!targets.included.length) blockers.push({ code: "NO_TARGETS", field: "targetType", message: "当前范围没有符合条件的在用人员" });
  const fingerprint = digest({ input: { ...input, dueAt: input.dueAt?.toISOString(), organizationIds: [...input.organizationIds].sort() }, template: { id: template.id, updatedAt: template.updatedAt.toISOString() }, coursewares, paperSnapshot, includedIds: targets.included.map(({ id }) => id).sort(), excluded: targets.excluded.map(({ id, reason }) => ({ id, reason })).sort((a, b) => a.id.localeCompare(b.id)) });
  return { input, template: { id: template.id, name: template.name, type: template.type }, coursewares, paper, ...(paperSnapshot ? { paperSnapshot } : {}), ...targets, blockers, fingerprint };
}

const tokenKey = (env: Env) => new TextEncoder().encode(env.JWT_SECRET);

export async function signTrainingPreflight(resolution: TrainingResolution, principal: Principal, env: Env) {
  return new SignJWT({ purpose: "training_preflight", fingerprint: resolution.fingerprint }).setProtectedHeader({ alg: "HS256" }).setSubject(principal.accountId).setIssuedAt().setExpirationTime("10m").sign(tokenKey(env));
}

export async function verifyTrainingPreflight(token: string, fingerprint: string, principal: Principal, env: Env) {
  let payload: unknown;
  try { payload = (await jwtVerify(token, tokenKey(env))).payload; }
  catch { throw Object.assign(new Error("预检已过期，请重新检查覆盖范围"), { statusCode: 409, code: "PREFLIGHT_EXPIRED" }); }
  const parsed = z.object({ sub: z.string().uuid(), purpose: z.literal("training_preflight"), fingerprint: z.string().length(64) }).parse(payload);
  if (parsed.sub !== principal.accountId || parsed.fingerprint !== fingerprint) throw Object.assign(new Error("培训配置或人员范围已经变化，请重新预检"), { statusCode: 409, code: "PREFLIGHT_STALE" });
}

export async function preflightTrainingWorkflow(principal: Principal, rawInput: unknown, env: Env) {
  const resolution = await resolveTrainingWorkflow(prisma as unknown as WorkflowDb, principal, rawInput);
  const token = resolution.blockers.length ? undefined : await signTrainingPreflight(resolution, principal, env);
  return {
    ready: resolution.blockers.length === 0,
    fingerprint: resolution.fingerprint,
    token,
    blockers: resolution.blockers,
    template: resolution.template,
    coursewares: resolution.coursewares,
    paper: resolution.paper,
    coverage: { includedCount: resolution.included.length, excludedCount: resolution.excluded.length, deduplicatedCount: resolution.deduplicatedCount, included: resolution.included, excluded: resolution.excluded }
  };
}
