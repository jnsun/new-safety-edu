import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
const baseUrl = process.env.PHASES_API_BASE_URL ?? "http://127.0.0.1:53101";
assert.match(databaseUrl, /phase1_test/i, "Refusing to run outside the isolated phase1_test database");
const prisma = new PrismaClient();

async function login(username: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "Phase1Only!234" }) });
  assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie); return cookie;
}
async function call(path: string, cookie: string, init: RequestInit = {}, expected = 200) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), cookie, ...init.headers } });
  const body = response.status === 204 ? {} : await response.json() as { data?: any; error?: { message?: string } };
  assert.equal(response.status, expected, `${path}: ${body.error?.message ?? response.statusText}`); return body.data;
}

try {
  const company = await login("phase1-admin"); const entityAdmin = await login("phase1-entity"); const departmentAdmin = await login("phase1-department"); const projectAdmin = await login("phase1-project");
  const project = await prisma.project.findUniqueOrThrow({ where: { code: "PHASE1-ONLY" } }); const entity = await prisma.organization.findUniqueOrThrow({ where: { id: project.responsibleOrganizationId } });
  await prisma.project.update({ where: { id: project.id }, data: { status: "active" } });

  const courseware = await call("/api/coursewares", company, { method: "POST", body: JSON.stringify({ title: "阶段二隔离课件", type: "rich_text", scopeType: "company", richText: "<p>隔离测试内容</p>" }) }, 201);
  await call(`/api/courseware-versions/${courseware.versions[0].id}/publish`, company, { method: "POST" });
  const template = await call("/api/training-templates", company, { method: "POST", body: JSON.stringify({ name: "阶段二项目入场模板", type: "project_induction", scopeType: "company", coursewareVersionIds: [courseware.versions[0].id] }) }, 201);
  const bank = await call("/api/question-banks", company, { method: "POST", body: JSON.stringify({ name: "阶段二隔离题库", scopeType: "company" }) }, 201);
  const question = await call(`/api/question-banks/${bank.id}/questions`, company, { method: "POST", body: JSON.stringify({ type: "true_false", prompt: "隔离测试题", options: ["正确", "错误"], correct: ["正确"] }) }, 201);
  const paper = await call("/api/exam-papers", company, { method: "POST", body: JSON.stringify({ name: "阶段二隔离试卷", mode: "fixed", items: [{ questionId: question.id, score: 100 }] }) }, 201);
  await call("/api/training-automation-configs", company, { method: "POST", body: JSON.stringify({ type: "project_induction", scopeType: "company", scopeId: null, templateId: template.id, paperId: paper.id }) }, 201);
  await call("/api/training-batches", company, { method: "POST", body: JSON.stringify({ name: "缺少试卷", type: "project_induction", templateId: template.id, projectId: project.id }) }, 400);

  const person = await prisma.person.create({ data: { name: "阶段二匿名外协", phone: "19900000003", type: "contractor", status: "active", organizations: { create: { organizationId: entity.id, active: true, primary: true } } } });
  await call(`/api/projects/${project.id}/members`, company, { method: "POST", body: JSON.stringify({ personId: person.id }) }, 201);
  const assignment = await prisma.trainingAssignment.findFirstOrThrow({ where: { personId: person.id, batch: { projectId: project.id, type: "project_induction" } }, include: { batch: true } });
  assert.ok(assignment.batch.paperSnapshot); const frozen = assignment.batch.paperSnapshot as { questions: Array<{ correct: string[] }> }; assert.deepEqual(frozen.questions[0]?.correct, ["正确"]);
  await prisma.question.update({ where: { id: question.id }, data: { correct: ["错误"] } }); const unchanged = (await prisma.trainingBatch.findUniqueOrThrow({ where: { id: assignment.batchId } })).paperSnapshot as { questions: Array<{ correct: string[] }> }; assert.deepEqual(unchanged.questions[0]?.correct, ["正确"]);
  await prisma.trainingAssignment.update({ where: { id: assignment.id }, data: { status: "locked" } }); await call(`/api/management/assignments/${assignment.id}/unlock`, projectAdmin, { method: "POST", body: JSON.stringify({ reason: "隔离测试首次解锁" }) });
  await prisma.trainingAssignment.update({ where: { id: assignment.id }, data: { status: "locked" } }); await call(`/api/management/assignments/${assignment.id}/unlock`, projectAdmin, { method: "POST", body: JSON.stringify({ reason: "隔离测试再次解锁" }) }); assert.equal((await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).extraAttempts, 2);
  await prisma.trainingAssignment.update({ where: { id: assignment.id }, data: { status: "confirmation_pending" } }); await call("/api/management/confirmations", company, { method: "POST", body: JSON.stringify({ assignmentIds: [assignment.id] }) }, 403); await call("/api/management/confirmations", entityAdmin, { method: "POST", body: JSON.stringify({ assignmentIds: [assignment.id] }) });

  await call("/api/monthly-reports", departmentAdmin, {}, 403); const month = "2026-08";
  const report = await call("/api/monthly-reports", company, { method: "POST", body: JSON.stringify({ projectId: project.id, reportMonth: month, constructionLocation: "隔离地点", projectManager: "匿名负责人", monthlyConstructionStatus: "隔离进度", onsiteCount: 1, safetyInspection: true, safetyHazards: false }) }, 201);
  await call(`/api/monthly-reports/${report.id}/withdraw`, entityAdmin, { method: "POST", body: JSON.stringify({ reason: "隔离更正" }) }); await call(`/api/monthly-reports/${report.id}`, entityAdmin, { method: "PATCH", body: JSON.stringify({ constructionLocation: "隔离地点二", projectManager: "匿名负责人", monthlyConstructionStatus: "隔离进度二", onsiteCount: 2, safetyInspection: true, safetyHazards: false, reason: "修改现场人数" }) });
  assert.equal(await prisma.projectMonthlyReportRevision.count({ where: { reportId: report.id } }), 1); await call(`/api/monthly-reports/${report.id}/submit`, entityAdmin, { method: "POST" }); await call(`/api/monthly-reports/${report.id}/void`, entityAdmin, { method: "POST", body: JSON.stringify({ reason: "越权作废" }) }, 403); await call(`/api/monthly-reports/${report.id}/void`, company, { method: "POST", body: JSON.stringify({ reason: "隔离作废" }) });
  const replacement = await call("/api/monthly-reports", company, { method: "POST", body: JSON.stringify({ projectId: project.id, reportMonth: month, constructionLocation: "隔离地点三", projectManager: "匿名负责人", monthlyConstructionStatus: "重新报送", onsiteCount: 1, safetyInspection: true, safetyHazards: false }) }, 201); assert.notEqual(replacement.id, report.id);

  const certificateType = await call("/api/certificate-types", company, { method: "POST", body: JSON.stringify({ name: "阶段四隔离证照类型", category: "personal", requiresAnnualTraining: true }) }, 201);
  const certificate = await call("/api/certificates", company, { method: "POST", body: JSON.stringify({ category: "personal", ownerId: person.id, typeId: certificateType.id, name: "阶段四隔离证照", isLongTerm: true }) }, 201);
  const yearly = await prisma.certificateAnnualTrainingStatus.findUniqueOrThrow({ where: { personCertificateId_year: { personCertificateId: certificate.id, year: new Date().getFullYear() } } }); assert.equal(yearly.status, "pending");
  const record = await call(`/api/person-certificates/${certificate.id}/training-records`, company, { method: "POST", body: JSON.stringify({ year: 2026, trainingDate: "2026-03-01", content: "年度培训", trainingOrganization: "培训机构", hours: 2, result: "完成" }) }, 201);
  const correction = await call(`/api/certificate-training-records/${record.id}`, company, { method: "PATCH", body: JSON.stringify({ year: 2026, trainingDate: "2026-03-02", content: "年度培训更正", trainingOrganization: "培训机构", hours: 2, result: "完成", correctionReason: "日期录入更正" }) }, 201);
  assert.equal((await prisma.certificateTrainingRecord.findUniqueOrThrow({ where: { id: record.id } })).status, "voided"); assert.equal(correction.correctionOfId, record.id);
  console.log("PHASES2_4_API_SMOKE=PASS");
} finally { await prisma.$disconnect(); }
