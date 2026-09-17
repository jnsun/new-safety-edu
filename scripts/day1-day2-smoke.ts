import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const auth = (cookie: string) => ({ cookie, "content-type": "application/json" });

async function call(path: string, init: RequestInit = {}, expected = 200) {
  const request = { ...init }; if (request.method && request.method !== "GET" && request.body === undefined) request.body = "{}";
  const response = await fetch(`${base}${path}`, { ...request, signal: AbortSignal.timeout(10_000) });
  const body = await response.json() as { data?: any; error?: { code?: string; message?: string } };
  assert.equal(response.status, expected, `${path}: ${body.error?.code} ${body.error?.message}`);
  return body.data;
}

async function login(username: string, password: string, expected = 200) {
  const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, expected);
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function upload(cookie: string, kind: "photo" | "courseware", content: string, filename: string, type: string) {
  const form = new FormData(); form.append("file", new Blob([content], { type }), filename);
  const response = await fetch(`${base}/api/files?kind=${kind}`, { method: "POST", headers: { cookie }, body: form, signal: AbortSignal.timeout(10_000) });
  const body = await response.json() as { data: { id: string }; error?: { message?: string } }; assert.equal(response.status, 201, body.error?.message); return body.data;
}

async function main() {
  console.log("DAY1_DAY2_SMOKE_START");
  const password = randomBytes(24).toString("base64url");
  const company = await prisma.account.create({ data: { username: `company-${randomUUID()}`, passwordHash: await argon2.hash(password), roles: { create: { role: "company_admin", scopeType: "company" } } } });
  await call("/api/health"); await call("/api/persons", {}, 401); assert.equal(await login(company.username!, "wrong-password", 401), "");
  const companyCookie = await login(company.username!, password); assert.ok(companyCookie); await call("/api/auth/me", { headers: auth(companyCookie) });

  const org1 = await call("/api/organizations", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ name: "Smoke department A", type: "department" }) }, 201);
  const org2 = await call("/api/organizations", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ name: "Smoke department B", type: "department" }) }, 201);
  const project1 = await call("/api/projects", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ name: "Smoke project A", code: `SMOKE-${randomUUID()}`, responsibleOrganizationId: org1.id }) }, 201);
  const project2 = await call("/api/projects", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ name: "Smoke project B", code: `SMOKE-${randomUUID()}`, responsibleOrganizationId: org2.id }) }, 201);
  const [photo1, photo2, photo3, photo4] = await Promise.all([upload(companyCookie, "photo", "png-a", "a.png", "image/png"), upload(companyCookie, "photo", "png-b", "b.png", "image/png"), upload(companyCookie, "photo", "png-c", "c.png", "image/png"), upload(companyCookie, "photo", "png-d", "d.png", "image/png")]);
  const nationalId1 = "110101199001010011"; const nationalId2 = "110101199001010022";
  const person1 = await call("/api/persons", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ name: "Smoke employee A", phone: "18800000001", type: "employee", organizationId: org1.id, nationalId: nationalId1, photoFileId: photo1.id }) }, 201);
  const person2 = await call("/api/persons", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ name: "Smoke employee B", phone: "18800000002", type: "employee", organizationId: org2.id, nationalId: nationalId2, photoFileId: photo2.id }) }, 201);
  assert.equal(person1.phone, "188****0001"); assert.equal((await call(`/api/persons/${person1.id}/sensitive`, { headers: auth(companyCookie) })).nationalId, nationalId1);
  await call("/api/persons", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ name: "Duplicate phone", phone: "18800000001", type: "employee", organizationId: org1.id, nationalId: "110101199001010033", photoFileId: photo3.id }) }, 409);
  const csv = `name,phone,type,organizationId,nationalId,photoFileId\nSmoke imported,18800000003,contractor,${org1.id},110101199001010033,${photo3.id}\n`;
  const csvForm = new FormData(); csvForm.append("file", new Blob([csv], { type: "text/csv" }), "persons.csv"); const importedResponse = await fetch(`${base}/api/persons/import`, { method: "POST", headers: { cookie: companyCookie }, body: csvForm }); assert.equal(importedResponse.status, 201); const imported = (await importedResponse.json() as any).data; assert.equal(imported.count, 1);
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("人员"); sheet.addRow(["name", "phone", "type", "organizationId", "nationalId", "photoFileId"]); sheet.addRow(["Smoke XLSX imported", "18800000004", "temporary_individual", org1.id, "110101199001010044", photo4.id]); const xlsxForm = new FormData(); xlsxForm.append("file", new Blob([Buffer.from(await workbook.xlsx.writeBuffer())], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "persons.xlsx"); const xlsxResponse = await fetch(`${base}/api/persons/import`, { method: "POST", headers: { cookie: companyCookie }, body: xlsxForm }); assert.equal(xlsxResponse.status, 201); assert.equal(((await xlsxResponse.json() as any).data.count), 1);
  const peopleBody = JSON.stringify(await call("/api/persons", { headers: auth(companyCookie) })); assert.ok(!peopleBody.includes(nationalId1) && !peopleBody.includes(nationalId2));

  const orgAccount = await call("/api/accounts", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ username: `org-${randomUUID()}`, password, personId: person1.id }) }, 201);
  await call("/api/roles", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ accountId: orgAccount.id, role: "org_admin", scopeType: "organization", scopeId: org1.id }) }, 201);
  const inScopeLearner = await call("/api/accounts", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ username: `in-scope-${randomUUID()}`, password, personId: imported.persons[0].id }) }, 201); await call("/api/roles", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ accountId: inScopeLearner.id, role: "learner", scopeType: "person", scopeId: imported.persons[0].id }) }, 201);
  const orgCookie = await login(orgAccount.username, password); const scopedPeople = await call("/api/persons", { headers: auth(orgCookie) }); assert.ok(scopedPeople.some((person: any) => person.id === person1.id)); assert.ok(!scopedPeople.some((person: any) => person.id === person2.id)); assert.ok((await call("/api/accounts", { headers: auth(orgCookie) })).some((account: any) => account.id === inScopeLearner.id));
  await call(`/api/persons/${person2.id}/sensitive`, { headers: auth(orgCookie) }, 403); await call("/api/projects", { method: "POST", headers: auth(orgCookie), body: JSON.stringify({ name: "Cross scope", code: `X-${randomUUID()}`, responsibleOrganizationId: org2.id }) }, 403); await call("/api/roles", { method: "POST", headers: auth(orgCookie), body: JSON.stringify({ accountId: orgAccount.id, role: "company_admin", scopeType: "company" }) }, 403);

  const rich = await call("/api/coursewares", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ title: "Smoke rich course", type: "rich_text", scopeType: "company", richText: "<p>Required safety content</p>" }) }, 201);
  const richVersion = rich.versions[0]; await call(`/api/courseware-versions/${richVersion.id}/publish`, { method: "POST", headers: auth(companyCookie) }); await call(`/api/courseware-versions/${richVersion.id}/publish`, { method: "POST", headers: auth(companyCookie) });
  await assert.rejects(() => prisma.coursewareVersion.update({ where: { id: richVersion.id }, data: { richText: "changed" } }));
  await call("/api/coursewares", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ title: "Invalid HTML file", type: "single_html", scopeType: "company", fileId: photo1.id }) }, 403);
  const invalidHtml = new FormData(); invalidHtml.append("file", new Blob(["<p>invalid extension</p>"], { type: "text/html" }), "course.txt"); assert.equal((await fetch(`${base}/api/files?kind=courseware`, { method: "POST", headers: { cookie: companyCookie }, body: invalidHtml })).status, 400);
  const htmlFile = await upload(companyCookie, "courseware", "<!doctype html><p>interactive</p>", "course.html", "text/html");
  const html = await call("/api/coursewares", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ title: "Smoke HTML course", type: "single_html", scopeType: "company", fileId: htmlFile.id }) }, 201); const htmlVersion = html.versions[0]; await call(`/api/courseware-versions/${htmlVersion.id}/publish`, { method: "POST", headers: auth(companyCookie) });
  const routineTemplate = await call("/api/training-templates", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ name: "Smoke routine template", type: "routine", scopeType: "company", coursewareVersionIds: [richVersion.id, htmlVersion.id] }) }, 201);
  await call("/api/training-templates", { method: "POST", headers: auth(orgCookie), body: JSON.stringify({ name: "Cross-scope template", type: "routine", scopeType: "organization", scopeId: org1.id, coursewareVersionIds: [richVersion.id] }) }, 403);
  const inductionTemplate = await call("/api/training-templates", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ name: "Smoke induction template", type: "project_induction", scopeType: "company", coursewareVersionIds: [richVersion.id] }) }, 201);
  const threeTemplate = await call("/api/training-templates", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ name: "Smoke three-level template", type: "three_level", scopeType: "company", coursewareVersionIds: [richVersion.id] }) }, 201); assert.ok(threeTemplate.id && inductionTemplate.id);

  const bank = await call("/api/question-banks", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ name: "Smoke question bank", scopeType: "company" }) }, 201);
  const questions = [] as any[]; for (const [type, prompt, options, correct] of [["single_choice", "Select one", ["A", "B"], ["A"]], ["multiple_choice", "Select many", ["A", "B", "C"], ["A", "C"]], ["true_false", "True or false", ["正确", "错误"], ["正确"]]] as const) questions.push(await call(`/api/question-banks/${bank.id}/questions`, { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ type, prompt, options, correct }) }, 201));
  await call(`/api/question-banks/${bank.id}/questions`, { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ type: "single_choice", prompt: "Invalid answer", options: ["A", "B"], correct: ["C"] }) }, 400);
  const fixedPaper = await call("/api/exam-papers", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ name: "Smoke fixed paper", mode: "fixed", items: questions.map((question, index) => ({ questionId: question.id, score: index === 2 ? 34 : 33 })) }) }, 201);
  const randomPaper = await call("/api/exam-papers", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ name: "Smoke random paper", mode: "random", bankId: bank.id, randomCount: 2 }) }, 201);
  const batch = await call("/api/training-batches", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ name: "Smoke dispatched training", type: "routine", templateId: routineTemplate.id, paperId: randomPaper.id, personIds: [person2.id, person2.id], durationMin: 10, passScore: 80, maxAttempts: 2 }) }, 201); assert.equal(batch.assignmentCount, 1);
  await call("/api/training-batches", { method: "POST", headers: auth(orgCookie), body: JSON.stringify({ name: "Forbidden company content", type: "routine", templateId: routineTemplate.id, paperId: fixedPaper.id, personIds: [person1.id] }) }, 403);

  const learnerAccount = await call("/api/accounts", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ username: `learner-${randomUUID()}`, password, personId: person2.id }) }, 201);
  const learnerRole = await call("/api/roles", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ accountId: learnerAccount.id, role: "learner", scopeType: "person", scopeId: person2.id }) }, 201); await prisma.wechatBinding.create({ data: { appId: "development", openid: "dev-day12-smoke", accountId: learnerAccount.id, boundAt: new Date() } }); await call(`/api/roles/${learnerRole.id}`, { method: "DELETE", headers: auth(orgCookie) }, 403);
  assert.ok(!(await call("/api/accounts", { headers: auth(orgCookie) })).some((account: any) => account.id === learnerAccount.id));
  const wx = await call("/api/wechat/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "dev:day12-smoke" }) }); const bearer = { authorization: `Bearer ${wx.accessToken}`, "content-type": "application/json" };
  await call(`/api/files/${photo1.id}`, { headers: bearer }, 403);
  const assignment = await prisma.trainingAssignment.findFirstOrThrow({ where: { batchId: batch.id, personId: person2.id }, include: { progress: true } });
  for (const progress of assignment.progress) { const course = await call(`/api/assignments/${assignment.id}/coursewares/${progress.coursewareVersionId}`, { headers: bearer }); if (course.type === "single_html") { const viewer = new URL(course.viewerUrl); const page = await fetch(`${base}/api/courseware-viewer${viewer.search}`, { signal: AbortSignal.timeout(10_000) }); assert.equal(page.status, 200); assert.match(await page.text(), /interactive/); const bad = await fetch(`${base}/api/courseware-viewer?token=${encodeURIComponent(`${viewer.searchParams.get("token")}x`)}`); assert.equal(bad.status, 401); } await call(`/api/assignments/${assignment.id}/coursewares/${progress.coursewareVersionId}/reached-end`, { method: "POST", headers: bearer }); await call(`/api/assignments/${assignment.id}/learning/${progress.coursewareVersionId}/complete`, { method: "POST", headers: bearer }); }
  const attempt = await call(`/api/assignments/${assignment.id}/attempts/start`, { method: "POST", headers: bearer }); assert.equal(attempt.questions.length, 2); assert.ok(attempt.questions.every((question: any) => !("correct" in question)));

  await call(`/api/projects/${project1.id}/status`, { method: "PATCH", headers: auth(companyCookie), body: JSON.stringify({ status: "paused" }) }); await call(`/api/projects/${project1.id}/members`, { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ personId: person1.id }) }, 409); await call("/api/training-batches", { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ name: "Paused project training", type: "project_induction", templateId: inductionTemplate.id, paperId: fixedPaper.id, projectId: project1.id, personIds: [person1.id] }) }, 409); await call(`/api/projects/${project1.id}/status`, { method: "PATCH", headers: auth(companyCookie), body: JSON.stringify({ status: "active" }) }); await call(`/api/projects/${project1.id}/members`, { method: "POST", headers: auth(companyCookie), body: JSON.stringify({ personId: person1.id }) }, 201);
  assert.equal(await prisma.trainingBatch.count({ where: { businessKey: `auto:project_induction:${project1.id}:${person1.id}` } }), 1); await call(`/api/projects/${project2.id}/members`, { method: "POST", headers: auth(orgCookie), body: JSON.stringify({ personId: person1.id }) }, 403);
  await call(`/api/persons/${person2.id}/status`, { method: "PATCH", headers: auth(companyCookie), body: JSON.stringify({ status: "disabled" }) }); await call("/api/auth/me", { headers: bearer }, 401); await call(`/api/persons/${person2.id}/status`, { method: "PATCH", headers: auth(companyCookie), body: JSON.stringify({ status: "active" }) }); await call("/api/auth/me", { headers: bearer }, 401); assert.ok(await login(learnerAccount.username, password)); await call(`/api/persons/${person2.id}/status`, { method: "PATCH", headers: auth(companyCookie), body: JSON.stringify({ status: "active" }) }); assert.equal(await prisma.trainingBatch.count({ where: { businessKey: `auto:three_level:company:${person2.id}` } }), 1);
  await call(`/api/projects/${project1.id}/status`, { method: "PATCH", headers: auth(companyCookie), body: JSON.stringify({ status: "ended" }) }); await call(`/api/projects/${project1.id}/status`, { method: "PATCH", headers: auth(companyCookie), body: JSON.stringify({ status: "active" }) }, 409);
  console.log("DAY1_DAY2_SMOKE_OK");
}

main().finally(() => prisma.$disconnect());
