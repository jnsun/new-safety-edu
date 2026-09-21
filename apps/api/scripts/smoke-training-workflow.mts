import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const root = resolve(import.meta.dirname, "../../..");
const databaseUrl = process.env.DATABASE_URL ?? "";
const apiOrigin = "http://127.0.0.1:55453";
const marker = `training-workflow-${randomUUID().slice(0, 8)}`;
const evidencePath = resolve(root, "docs/training/evidence/training-workflow-smoke.json");
const smokePassword = process.env.TRAINING_WORKFLOW_SMOKE_PASSWORD ?? `Tw!${randomBytes(16).toString("base64url")}9`;

function assertEnvironment() {
  const database = new URL(databaseUrl);
  const name = decodeURIComponent(database.pathname.replace(/^\//, ""));
  if (process.env.SAFETY_ENV !== "test" || database.hostname !== "127.0.0.1" || database.port !== "55432" || database.username !== "postgres" || name !== "training_workflow_e2e_test") throw new Error("TRAINING_WORKFLOW_E2E_DATABASE_UNSAFE");
}

assertEnvironment();
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let server: ChildProcess | null = null;
let serverOutput = "";
const checks: Array<{ check: string; result: string; detail: string }> = [];
const record = (check: string, detail: string) => checks.push({ check, result: "PASS", detail });
const delay = (milliseconds: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
type ApiBody<T> = { data?: T; error?: { code?: string; message?: string } };
type Session = { bearer: string };

async function startServer() {
  server = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "apps/api/src/server.ts"], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl, SAFETY_ENV: "test", NODE_ENV: "test", PORT: "55453", RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1", PUBLIC_BASE_URL: apiOrigin, COOKIE_SECRET: randomBytes(48).toString("base64url"), JWT_SECRET: randomBytes(48).toString("base64url"), FIELD_ENCRYPTION_KEY: randomBytes(32).toString("base64"), UPLOAD_SIGNING_SECRET: randomBytes(48).toString("base64url"), UPLOAD_ROOT: resolve(root, "var/training-workflow-upload") }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout?.on("data", (chunk) => { serverOutput += String(chunk); }); server.stderr?.on("data", (chunk) => { serverOutput += String(chunk); });
  for (let attempt = 0; attempt < 200; attempt += 1) { if (server.exitCode !== null) throw new Error(`API_EXITED\n${serverOutput}`); try { if ((await fetch(`${apiOrigin}/api/health`)).status === 200) return; } catch {} await delay(50); }
  throw new Error(`API_NOT_READY\n${serverOutput}`);
}
async function stopServer() { if (!server || server.exitCode !== null) return; const exited = once(server, "exit"); server.kill(); const force = setTimeout(() => server?.kill("SIGKILL"), 5_000); force.unref(); await exited; clearTimeout(force); }
async function login(username: string, password: string): Promise<Session> { const response = await fetch(`${apiOrigin}/api/auth/login`, json("POST", { username, password })); assert.equal(response.status, 200, await response.text()); const cookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""]; const access = cookies.find((cookie) => cookie.startsWith("safety_session=")); assert.ok(access); return { bearer: access.split(";", 1)[0]!.slice("safety_session=".length) }; }
async function request<T>(session: Session, path: string, init: RequestInit = {}) { const response = await fetch(`${apiOrigin}${path}`, { ...init, headers: { authorization: `Bearer ${session.bearer}`, ...init.headers } }); const text = await response.text(); const body = text ? JSON.parse(text) as ApiBody<T> : {}; return { response, body, text }; }
async function identity(label: string, role?: { role: "company_admin" | "org_admin"; scopeType: "company" | "organization"; scopeId?: string }) { const password = smokePassword; const username = `tw-${randomUUID().slice(0, 12)}`; const person = await prisma.person.create({ data: { name: label, phone: `195${String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0")}`, type: "employee", status: "active" } }); const account = await prisma.account.create({ data: { personId: person.id, username, usernameNormalized: username, passwordHash: await argon2.hash(password), passwordLoginEnabled: true, status: "active" } }); if (role) await prisma.roleAssignment.create({ data: { accountId: account.id, personId: person.id, role: role.role, scopeType: role.scopeType, scopeId: role.scopeId ?? null } }); return { person, account, username, password }; }

try {
  const rootOrg = await prisma.organization.findFirst({ where: { type: "company" } }) ?? await prisma.organization.create({ data: { name: `${marker}-公司`, type: "company" } });
  const entityA = await prisma.organization.create({ data: { name: `${marker}-实体A`, type: "business_entity", parentId: rootOrg.id } });
  const entityB = await prisma.organization.create({ data: { name: `${marker}-实体B`, type: "business_entity", parentId: rootOrg.id } });
  const adminIdentity = await identity("隔离管理员", { role: "company_admin", scopeType: "company" });
  const learnerIdentity = await identity("隔离学员");
  const inactivePerson = await prisma.person.create({ data: { name: "停用测试人员", phone: `196${String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0")}`, type: "employee", status: "disabled" } });
  await prisma.organizationMembership.createMany({ data: [{ personId: learnerIdentity.person.id, organizationId: entityA.id, primary: true, active: true }, { personId: inactivePerson.id, organizationId: entityA.id, primary: true, active: true }] });
  const project = await prisma.project.create({ data: { name: `${marker}-项目`, code: marker.slice(0, 40), responsibleOrganizationId: entityA.id, status: "active" } });
  const emptyProject = await prisma.project.create({ data: { name: `${marker}-空项目`, code: `${marker}-empty`.slice(0, 50), responsibleOrganizationId: entityA.id, status: "active" } });
  await prisma.projectMember.createMany({ data: [{ projectId: project.id, personId: learnerIdentity.person.id, status: "active" }, { projectId: project.id, personId: inactivePerson.id, status: "active" }] });
  const scopedAdmin = await identity("实体A管理员", { role: "org_admin", scopeType: "organization", scopeId: entityA.id });
  await prisma.organizationMembership.create({ data: { personId: scopedAdmin.person.id, organizationId: entityA.id, primary: true, active: true } });
  await startServer();
  const admin = await login(adminIdentity.username, adminIdentity.password); const learner = await login(learnerIdentity.username, learnerIdentity.password); const orgAdmin = await login(scopedAdmin.username, scopedAdmin.password);

  const course = await request<{ id: string; versions: Array<{ id: string }> }>(admin, "/api/coursewares", json("POST", { title: `${marker}-课件`, type: "rich_text", scopeType: "company", scopeId: null, richText: "隔离项目入场教育内容" })); assert.equal(course.response.status, 201, course.text); const courseId = course.body.data!.id; const versionId = course.body.data!.versions[0]!.id;
  const unpublishedTemplate = await request(admin, "/api/training-templates", json("POST", { name: `${marker}-未发布模板`, type: "project_induction", scopeType: "company", scopeId: null, coursewareVersionIds: [versionId] })); assert.equal(unpublishedTemplate.response.status, 400); record("未发布课件阻断", "模板接口拒绝引用未发布课件");
  assert.equal((await request(admin, `/api/courseware-versions/${versionId}/publish`, { method: "POST" })).response.status, 200);
  const template = await request<{ id: string }>(admin, "/api/training-templates", json("POST", { name: `${marker}-项目模板`, type: "project_induction", scopeType: "company", scopeId: null, coursewareVersionIds: [versionId] })); assert.equal(template.response.status, 201, template.text);
  const routineTemplate = await request<{ id: string }>(admin, "/api/training-templates", json("POST", { name: `${marker}-日常模板`, type: "routine", scopeType: "company", scopeId: null, coursewareVersionIds: [versionId] })); assert.equal(routineTemplate.response.status, 201, routineTemplate.text); record("就地课件发布回填基础", "通过真实课件、发布和模板 API 建立有序已发布内容");
  const bank = await request<{ id: string }>(admin, "/api/question-banks", json("POST", { name: `${marker}-题库`, scopeType: "company", scopeId: null })); assert.equal(bank.response.status, 201, bank.text);
  const question = await request<{ id: string }>(admin, `/api/question-banks/${bank.body.data!.id}/questions`, json("POST", { type: "single_choice", prompt: "进入现场前首先应做什么？", options: ["确认风险与联系人", "直接作业"], correct: ["确认风险与联系人"], explanation: "先确认风险" })); assert.equal(question.response.status, 201, question.text);
  const insufficient = await request<{ id: string }>(admin, "/api/exam-papers", json("POST", { name: `${marker}-题量不足`, mode: "random", bankId: bank.body.data!.id, randomCount: 2 })); assert.equal(insufficient.response.status, 201, insufficient.text);
  const paper = await request<{ id: string }>(admin, "/api/exam-papers", json("POST", { name: `${marker}-固定试卷`, mode: "fixed", items: [{ questionId: question.body.data!.id, score: 100 }] })); assert.equal(paper.response.status, 201, paper.text); record("就地题库题目试卷回填基础", "通过真实题库、题目、固定和随机试卷 API 创建对象");

  const draft = { name: `${marker}-入场教育`, description: "隔离验证", type: "project_induction", templateId: template.body.data!.id, examRequired: true, paperId: paper.body.data!.id, targetType: "project", projectId: project.id, organizationIds: [], durationMin: 30, passScore: 80, maxAttempts: 3 };
  const mandatoryOff = await request(admin, "/api/training-batches/preflight", json("POST", { ...draft, examRequired: false, paperId: undefined })); assert.equal(mandatoryOff.response.status, 400); record("必须考试不可关闭", "项目入场教育关闭考试被服务端拒绝");
  const insufficientPreflight = await request<{ ready: boolean; blockers: Array<{ code: string }> }>(admin, "/api/training-batches/preflight", json("POST", { ...draft, paperId: insufficient.body.data!.id })); assert.equal(insufficientPreflight.response.status, 200); assert.equal(insufficientPreflight.body.data!.ready, false); assert.ok(insufficientPreflight.body.data!.blockers.some(({ code }) => code === "INSUFFICIENT_QUESTIONS")); record("题量不足阻断", "服务端准备度检查返回 INSUFFICIENT_QUESTIONS");
  const emptyPreflight = await request<{ ready: boolean; blockers: Array<{ code: string }> }>(admin, "/api/training-batches/preflight", json("POST", { ...draft, projectId: emptyProject.id })); assert.equal(emptyPreflight.response.status, 200); assert.ok(emptyPreflight.body.data!.blockers.some(({ code }) => code === "NO_TARGETS")); record("无有效人员阻断", "空项目返回 NO_TARGETS 且未生成任务");
  const illegal = await request(orgAdmin, "/api/training-batches/preflight", json("POST", { name: "非法组织范围", description: "", type: "routine", templateId: routineTemplate.body.data!.id, examRequired: false, targetType: "organization", organizationIds: [entityB.id], durationMin: 30, passScore: 80, maxAttempts: 3 })); assert.equal(illegal.response.status, 403); record("非法范围阻断", "实体A管理员不能选择实体B完整组织");
  const optional = await request<{ ready: boolean }>(admin, "/api/training-batches/preflight", json("POST", { name: "日常培训默认不考试", description: "", type: "routine", templateId: routineTemplate.body.data!.id, examRequired: false, targetType: "organization", organizationIds: [entityA.id], durationMin: 30, passScore: 80, maxAttempts: 3 })); assert.equal(optional.response.status, 200); assert.equal(optional.body.data!.ready, true); record("可选考试默认关闭", "日常培训不选择试卷仍可通过准备度检查");

  const preflight = await request<{ ready: boolean; token: string; fingerprint: string; coverage: { includedCount: number; excludedCount: number; deduplicatedCount: number } }>(admin, "/api/training-batches/preflight", json("POST", draft)); assert.equal(preflight.response.status, 200, preflight.text); assert.equal(preflight.body.data!.ready, true); assert.equal(preflight.body.data!.coverage.includedCount, 1); assert.equal(preflight.body.data!.coverage.excludedCount, 1); record("真实覆盖与排除", "项目2名成员，1名active纳入，1名disabled排除");
  const key = randomUUID(); const envelope = { draft, preflightToken: preflight.body.data!.token, preflightFingerprint: preflight.body.data!.fingerprint, idempotencyKey: key };
  const dispatched = await request<{ batchId: string; assignmentCount: number; excludedCount: number; duplicate: boolean }>(admin, "/api/training-batches", json("POST", envelope)); assert.equal(dispatched.response.status, 201, dispatched.text); assert.equal(dispatched.body.data!.assignmentCount, 1); assert.equal(dispatched.body.data!.excludedCount, 1);
  const repeated = await request<{ batchId: string; assignmentCount: number; excludedCount: number; duplicate: boolean }>(admin, "/api/training-batches", json("POST", envelope)); assert.equal(repeated.response.status, 200, repeated.text); assert.equal(repeated.body.data!.batchId, dispatched.body.data!.batchId); assert.equal(repeated.body.data!.assignmentCount, 1); assert.equal(repeated.body.data!.excludedCount, 1); assert.equal(repeated.body.data!.duplicate, true); assert.equal(await prisma.trainingBatch.count({ where: { id: dispatched.body.data!.batchId } }), 1); assert.equal(await prisma.trainingAssignment.count({ where: { batchId: dispatched.body.data!.batchId } }), 1); record("幂等派发", "相同幂等键重试返回同一批次，数据库仅1批次1任务");
  const batch = await prisma.trainingBatch.findUniqueOrThrow({ where: { id: dispatched.body.data!.batchId } }); assert.equal((batch.coursewareSnapshot as Array<unknown>).length, 1); assert.ok(batch.paperSnapshot); assert.equal((batch.dispatchResult as { excludedCount: number }).excludedCount, 1); record("历史快照", "批次保存课件顺序、试卷题目版本和真实派发结果快照");
  const learnerAssignments = await request<Array<{ id: string; batch: { id: string }; progress: Array<{ coursewareVersionId: string }> }>>(learner, "/api/assignments"); assert.equal(learnerAssignments.response.status, 200, learnerAssignments.text); const learnerAssignment = learnerAssignments.body.data!.find(({ batch: row }) => row.id === batch.id); assert.ok(learnerAssignment); assert.equal(learnerAssignment.progress[0]?.coursewareVersionId, versionId); const learningRead = await request(learner, `/api/assignments/${learnerAssignment.id}/coursewares/${versionId}`); assert.equal(learningRead.response.status, 200, learningRead.text); record("学习端读取", "新任务可通过原学习任务和课件读取接口访问");
  const before = await request<{ token: string; fingerprint: string }>(admin, "/api/training-batches/preflight", json("POST", { ...draft, name: `${marker}-陈旧预检` })); const added = await identity("范围变化人员"); await prisma.projectMember.create({ data: { projectId: project.id, personId: added.person.id, status: "active" } }); const stale = await request(admin, "/api/training-batches", json("POST", { draft: { ...draft, name: `${marker}-陈旧预检` }, preflightToken: before.body.data!.token, preflightFingerprint: before.body.data!.fingerprint, idempotencyKey: randomUUID() })); assert.equal(stale.response.status, 409); assert.match(stale.text, /PREFLIGHT_STALE|重新预检/); record("配置与范围变化使预检失效", "新增项目成员后使用旧预检被服务端拒绝");

  await mkdir(resolve(evidencePath, ".."), { recursive: true }); await writeFile(evidencePath, JSON.stringify({ generatedAt: new Date().toISOString(), environment: "local isolated PostgreSQL; no remote server", marker, checks, summary: { passed: checks.length, failed: 0 } }, null, 2), "utf8");
  console.log(`TRAINING_WORKFLOW_SMOKE=PASS checks=${checks.length}`);
} finally { await stopServer(); await prisma.$disconnect(); }
