import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();
const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const headers = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });

async function call(path: string, init: RequestInit = {}, expected = 200) {
  const request = { ...init };
  if (request.method && request.method !== "GET" && request.body === undefined) request.body = "{}";
  const response = await fetch(`${base}${path}`, request);
  const body = await response.json() as { data?: unknown; error?: { code?: string; message?: string } };
  assert.equal(response.status, expected, `${path}: ${body.error?.code} ${body.error?.message}`);
  return body.data as any;
}

async function main() {
  const adminPassword = randomBytes(24).toString("base64url");
  const admin = await prisma.account.create({ data: { username: `smoke-${randomUUID()}`, passwordHash: await argon2.hash(adminPassword), roles: { create: { role: "company_admin", scopeType: "company" } } } });
  const org = await prisma.organization.create({ data: { name: "Day3 smoke org", type: "department" } });
  const photo = await prisma.privateFile.create({ data: { kind: "photo", storageKey: `smoke/${randomUUID()}`, originalName: "fixture.png", mimeType: "image/png", size: 1, sha256: "0".repeat(64), uploadedBy: admin.id } });
  const people = await Promise.all([1, 2].map((n) => prisma.person.create({ data: { name: `Learner ${n}`, phone: `1990000000${n}`, type: "employee", status: "active", nationalIdCipher: "fixture", nationalIdIv: "fixture", nationalIdTag: "fixture", nationalIdHash: createHash("sha256").update(`fixture-${n}`).digest("hex"), nationalIdLast4: `000${n}`, photoFileId: photo.id, organizations: { create: { organizationId: org.id, primary: true } } } })));
  const learner = await prisma.account.create({ data: { personId: people[0]!.id, roles: { create: { role: "learner", scopeType: "person", scopeId: people[0]!.id } }, wechatBindings: { create: { appId: "development", openid: "dev-day3-smoke", boundAt: new Date() } } } });
  await prisma.account.create({ data: { personId: people[1]!.id, roles: { create: { role: "learner", scopeType: "person", scopeId: people[1]!.id } } } });
  const courseware = await prisma.courseware.create({ data: { title: "Day3 smoke course", type: "rich_text", scopeType: "company", versions: { create: { version: 1, status: "published", richText: "<p>Smoke content</p>", contentHash: "1".repeat(64), publishedAt: new Date() } } }, include: { versions: true } });
  const version = courseware.versions[0]!;
  const template = await prisma.trainingTemplate.create({ data: { name: "Day3 smoke template", type: "routine", scopeType: "company", items: { create: { coursewareVersionId: version.id, sortOrder: 0 } } } });
  const bank = await prisma.questionBank.create({ data: { name: "Day3 smoke bank", scopeType: "company" } });
  const question = await prisma.question.create({ data: { bankId: bank.id, type: "true_false", prompt: "Smoke question", options: ["正确", "错误"], correct: ["正确"] } });
  const paper = await prisma.examPaper.create({ data: { name: "Day3 smoke paper", mode: "fixed", items: { create: { questionId: question.id, sortOrder: 0, score: 100 } } } });
  const batch = await prisma.trainingBatch.create({ data: { businessKey: `smoke:${randomUUID()}`, name: "Day3 smoke training", type: "routine", templateId: template.id, paperId: paper.id, durationMin: 30, passScore: 80, maxAttempts: 2 } });
  const assignments = await Promise.all(people.map((person) => prisma.trainingAssignment.create({ data: { batchId: batch.id, personId: person.id, progress: { create: { coursewareVersionId: version.id } } } })));

  const login = await call("/api/wechat/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "dev:day3-smoke" }) });
  assert.equal(login.bindingStatus, "bound");
  const refreshed = await call("/api/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: login.refreshToken }) });
  const token = refreshed.accessToken as string;
  assert.equal((await call("/api/me/assignments?scope=todo", { headers: headers(token) })).length, 1);
  await call(`/api/me/assignments/${assignments[1]!.id}`, { headers: headers(token) }, 404);
  await call(`/api/assignments/${assignments[0]!.id}/learning/${version.id}/complete`, { method: "POST", headers: headers(token) }, 409);
  await call(`/api/assignments/${assignments[0]!.id}/coursewares/${version.id}`, { headers: headers(token) });
  await call(`/api/assignments/${assignments[0]!.id}/learning/${version.id}/complete`, { method: "POST", headers: headers(token) });

  const first = await call(`/api/assignments/${assignments[0]!.id}/attempts/start`, { method: "POST", headers: headers(token) });
  await call(`/api/attempts/${first.id}/answers`, { method: "PUT", headers: headers(token), body: JSON.stringify({ answers: [{ questionId: question.id, answer: ["错误"] }] }) });
  const resumed = await call(`/api/assignments/${assignments[0]!.id}/attempts/start`, { method: "POST", headers: headers(token) });
  assert.equal(resumed.id, first.id); assert.deepEqual(resumed.answers[0].answer, ["错误"]);
  assert.equal((await call(`/api/attempts/${first.id}/submit`, { method: "POST", headers: headers(token) })).assignmentStatus, "remediation_required");
  await call(`/api/assignments/${assignments[0]!.id}/coursewares/${version.id}`, { headers: headers(token) });
  await call(`/api/assignments/${assignments[0]!.id}/learning/${version.id}/complete`, { method: "POST", headers: headers(token) });
  const second = await call(`/api/assignments/${assignments[0]!.id}/attempts/start`, { method: "POST", headers: headers(token) });
  await call(`/api/attempts/${second.id}/answers`, { method: "PUT", headers: headers(token), body: JSON.stringify({ answers: [{ questionId: question.id, answer: ["错误"] }] }) });
  assert.equal((await call(`/api/attempts/${second.id}/submit`, { method: "POST", headers: headers(token) })).assignmentStatus, "locked");

  const adminLogin = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: admin.username, password: adminPassword }) });
  assert.equal(adminLogin.status, 200); const managerCookie = adminLogin.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(managerCookie);
  await call(`/api/assignments/${assignments[0]!.id}/unlock`, { method: "POST", headers: { cookie: managerCookie, "content-type": "application/json" }, body: JSON.stringify({ reason: "Day3 smoke unlock" }) });
  await call(`/api/assignments/${assignments[0]!.id}/coursewares/${version.id}`, { headers: headers(token) });
  await call(`/api/assignments/${assignments[0]!.id}/learning/${version.id}/complete`, { method: "POST", headers: headers(token) });
  const third = await call(`/api/assignments/${assignments[0]!.id}/attempts/start`, { method: "POST", headers: headers(token) });
  await call(`/api/attempts/${third.id}/answers`, { method: "PUT", headers: headers(token), body: JSON.stringify({ answers: [{ questionId: question.id, answer: ["正确"] }] }) });
  assert.equal((await call(`/api/attempts/${third.id}/submit`, { method: "POST", headers: headers(token) })).assignmentStatus, "pending_signature");

  const form = new FormData(); form.append("file", new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" }), "signature.png");
  const uploadResponse = await fetch(`${base}/api/files?kind=signature`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  assert.equal(uploadResponse.status, 201); const uploaded = (await uploadResponse.json() as any).data;
  assert.equal((await call(`/api/assignments/${assignments[0]!.id}/sign`, { method: "POST", headers: headers(token), body: JSON.stringify({ fileId: uploaded.id, deviceInfo: { platform: "smoke" } }) }, 201)).status, "completed");
  await call(`/api/assignments/${assignments[0]!.id}/sign`, { method: "POST", headers: headers(token), body: JSON.stringify({ fileId: uploaded.id }) }, 409);
  assert.equal((await call("/api/me/assignments?scope=records", { headers: headers(token) })).length, 1);
  await call(`/api/me/records/${assignments[0]!.id}`, { headers: headers(token) });
  assert.equal(await prisma.trainingAssignment.count({ where: { personId: people[1]!.id, status: "pending_learning" } }), 1);
  assert.equal(learner.personId, people[0]!.id);
  console.log("DAY3_SMOKE_OK");
}

main().finally(() => prisma.$disconnect());
