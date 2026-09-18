import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, rm, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { anonymousCoursewareDocument } from "../src/courseware-template.js";

const root = resolve(import.meta.dirname, "../../..");
const databaseUrl = process.env.DATABASE_URL ?? "";
const apiOrigin = "http://127.0.0.1:55452";
const uploadRoot = resolve(root, "var/courseware-e2e-test");
const marker = `courseware-e2e-${randomUUID().slice(0, 8)}`;

function assertEnvironment() {
  let database: URL;
  try { database = new URL(databaseUrl); } catch { throw new Error("COURSEWARE_E2E_DATABASE_URL_REQUIRED"); }
  const name = decodeURIComponent(database.pathname.replace(/^\//, ""));
  if (process.env.SAFETY_ENV !== "test" || database.protocol !== "postgresql:" || database.hostname !== "127.0.0.1" || database.port !== "55432" || database.username !== "postgres" || !name.includes("courseware_e2e_test")) {
    throw new Error("COURSEWARE_E2E_DATABASE_URL_UNSAFE");
  }
}

assertEnvironment();
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let server: ChildProcess | null = null;
let serverOutput = "";
const ids = { people: [] as string[], accounts: [] as string[], roles: [] as string[], coursewares: [] as string[], templates: [] as string[], batches: [] as string[], assignments: [] as string[], importSessions: [] as string[], files: [] as string[] };

type ApiBody<T> = { data?: T; error?: { code?: string; message?: string } };
type Session = { bearer: string };

const delay = (milliseconds: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function startServer() {
  await rm(uploadRoot, { recursive: true, force: true });
  await mkdir(uploadRoot, { recursive: true });
  server = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "apps/api/src/server.ts"], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "test",
      PORT: "55452",
      RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1",
      PUBLIC_BASE_URL: apiOrigin,
      COOKIE_SECRET: randomBytes(48).toString("base64url"),
      JWT_SECRET: randomBytes(48).toString("base64url"),
      FIELD_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      UPLOAD_SIGNING_SECRET: randomBytes(48).toString("base64url"),
      UPLOAD_ROOT: uploadRoot
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout?.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr?.on("data", (chunk) => { serverOutput += String(chunk); });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`COURSEWARE_E2E_API_EXITED\n${serverOutput}`);
    try { if ((await fetch(`${apiOrigin}/api/health`, { signal: AbortSignal.timeout(500) })).status === 200) return; } catch {}
    await delay(50);
  }
  throw new Error(`COURSEWARE_E2E_API_NOT_READY\n${serverOutput}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, "exit");
  server.kill();
  const force = setTimeout(() => { if (server?.exitCode === null) server.kill("SIGKILL"); }, 5_000);
  force.unref();
  await exited;
  clearTimeout(force);
}

async function login(username: string, password: string): Promise<Session> {
  const response = await fetch(`${apiOrigin}/api/auth/login`, json("POST", { username, password }));
  assert.equal(response.status, 200, await response.text());
  const cookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const access = cookies.find((cookie) => cookie.startsWith("safety_session="));
  assert.ok(access, "login did not issue safety_session");
  return { bearer: access.split(";", 1)[0]!.slice("safety_session=".length) };
}

async function request<T>(session: Session, path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiOrigin}${path}`, { ...init, headers: { authorization: `Bearer ${session.bearer}`, ...init.headers } });
  const content = Buffer.from(await response.arrayBuffer());
  let body: ApiBody<T> = {};
  if ((response.headers.get("content-type") ?? "").includes("application/json")) body = JSON.parse(content.toString("utf8")) as ApiBody<T>;
  return { response, body, content };
}

async function createIdentity(role?: "company_admin") {
  const password = `Cw!${randomBytes(18).toString("base64url")}9a`;
  const username = `${marker}-${role ?? "learner"}`;
  const person = await prisma.person.create({ data: { name: username, phone: `194${String(ids.people.length + 1).padStart(8, "0")}`, type: "employee", status: "active" } });
  ids.people.push(person.id);
  const account = await prisma.account.create({ data: { personId: person.id, username, usernameNormalized: username, passwordHash: await argon2.hash(password), passwordLoginEnabled: true, status: "active" } });
  ids.accounts.push(account.id);
  if (role) {
    const assignment = await prisma.roleAssignment.create({ data: { accountId: account.id, personId: person.id, role, scopeType: "company", scopeId: null } });
    ids.roles.push(assignment.id);
  }
  return { person, account, username, password };
}

async function cleanup() {
  await stopServer();
  if (ids.accounts.length) {
    await prisma.refreshSession.deleteMany({ where: { accountId: { in: ids.accounts } } });
    await prisma.authSecurityEvent.deleteMany({ where: { accountId: { in: ids.accounts } } });
  }
  if (ids.assignments.length) await prisma.learningProgress.deleteMany({ where: { assignmentId: { in: ids.assignments } } });
  if (ids.assignments.length) await prisma.trainingAssignment.deleteMany({ where: { id: { in: ids.assignments } } });
  if (ids.batches.length) await prisma.trainingBatch.deleteMany({ where: { id: { in: ids.batches } } });
  if (ids.templates.length) await prisma.trainingTemplateItem.deleteMany({ where: { templateId: { in: ids.templates } } });
  if (ids.templates.length) await prisma.trainingTemplate.deleteMany({ where: { id: { in: ids.templates } } });
  if (ids.coursewares.length) {
    const versions = await prisma.coursewareVersion.findMany({ where: { coursewareId: { in: ids.coursewares } }, select: { id: true } });
    await prisma.coursewareVersionAsset.deleteMany({ where: { coursewareVersionId: { in: versions.map(({ id }) => id) } } });
    await prisma.coursewareVersion.deleteMany({ where: { id: { in: versions.map(({ id }) => id) } } });
    await prisma.courseware.deleteMany({ where: { id: { in: ids.coursewares } } });
  }
  if (ids.importSessions.length) await prisma.coursewareImportSession.deleteMany({ where: { id: { in: ids.importSessions } } });
  if (ids.files.length) {
    const files = await prisma.privateFile.findMany({ where: { id: { in: ids.files } }, select: { id: true, storageKey: true } });
    await prisma.privateFile.deleteMany({ where: { id: { in: ids.files } } });
    await Promise.all(files.map(({ storageKey }) => unlink(resolve(uploadRoot, storageKey)).catch(() => undefined)));
  }
  if (ids.roles.length) await prisma.roleAssignment.deleteMany({ where: { id: { in: ids.roles } } });
  if (ids.accounts.length) await prisma.account.deleteMany({ where: { id: { in: ids.accounts } } });
  if (ids.people.length) await prisma.person.deleteMany({ where: { id: { in: ids.people } } });
  await rm(uploadRoot, { recursive: true, force: true });
  await prisma.$disconnect();
}

try {
  const migration = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.ok(Number(migration[0]?.count ?? 0) > 0, "migrations are not applied");
  const adminIdentity = await createIdentity("company_admin");
  const learnerIdentity = await createIdentity();
  await startServer();
  const admin = await login(adminIdentity.username, adminIdentity.password);
  const learner = await login(learnerIdentity.username, learnerIdentity.password);

  const initialDocument = { ...anonymousCoursewareDocument, title: `${marker}-draft`, summary: "匿名隔离课件草稿" };
  const created = await request<{ id: string; versions: Array<{ id: string }> }>(admin, "/api/coursewares", json("POST", { title: initialDocument.title, type: "structured", scopeType: "company", scopeId: null, structuredContent: initialDocument }));
  assert.equal(created.response.status, 201, created.content.toString("utf8"));
  ids.coursewares.push(created.body.data!.id);
  const initialVersionId = created.body.data!.versions[0]!.id;
  const edited = { ...initialDocument, summary: "已经通过 API 编辑内容块的匿名隔离课件" };
  assert.equal((await request(admin, `/api/courseware-versions/${initialVersionId}/draft`, json("PUT", { structuredContent: edited }))).response.status, 200);

  const template = await request<never>(admin, "/api/courseware-authoring/templates/xlsx-example");
  assert.equal(template.response.status, 200);
  assert.ok(template.content.length > 1_000);
  const form = new FormData();
  form.append("file", new Blob([template.content], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "courseware.xlsx");
  const preview = await request<{ previewId: string; sourceHash: string; items: Array<{ classification: string }> }>(admin, "/api/courseware-authoring/imports/preview?scopeType=company", { method: "POST", body: form });
  assert.equal(preview.response.status, 201, preview.content.toString("utf8"));
  assert.deepEqual(preview.body.data!.items.map(({ classification }) => classification), ["create"]);
  ids.importSessions.push(preview.body.data!.previewId);
  const source = await prisma.coursewareImportSession.findUniqueOrThrow({ where: { id: preview.body.data!.previewId }, select: { sourceFileId: true } });
  if (source.sourceFileId) ids.files.push(source.sourceFileId);

  const confirmed = await request<{ result: { success: number; items: Array<{ coursewareId: string; versionId: string }> }; repeated: boolean }>(admin, "/api/courseware-authoring/imports/confirm", json("POST", { previewId: preview.body.data!.previewId, sourceHash: preview.body.data!.sourceHash }));
  assert.equal(confirmed.response.status, 200, confirmed.content.toString("utf8"));
  assert.equal(confirmed.body.data!.result.success, 1);
  assert.equal(confirmed.body.data!.repeated, false);
  const imported = confirmed.body.data!.result.items[0]!;
  ids.coursewares.push(imported.coursewareId);
  const repeated = await request<{ repeated: boolean }>(admin, "/api/courseware-authoring/imports/confirm", json("POST", { previewId: preview.body.data!.previewId, sourceHash: preview.body.data!.sourceHash }));
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.body.data!.repeated, true);
  assert.equal((await request(admin, `/api/courseware-versions/${imported.versionId}/publish`, { method: "POST" })).response.status, 200);

  const trainingTemplate = await prisma.trainingTemplate.create({ data: { name: `${marker}-template`, type: "routine", scopeType: "company", scopeId: null, items: { create: { coursewareVersionId: imported.versionId, sortOrder: 0 } } } });
  ids.templates.push(trainingTemplate.id);
  const batch = await prisma.trainingBatch.create({ data: { businessKey: marker, name: `${marker}-batch`, type: "routine", templateId: trainingTemplate.id } });
  ids.batches.push(batch.id);
  const assignment = await prisma.trainingAssignment.create({ data: { batchId: batch.id, personId: learnerIdentity.person.id } });
  ids.assignments.push(assignment.id);
  await prisma.learningProgress.create({ data: { assignmentId: assignment.id, coursewareVersionId: imported.versionId } });

  const read = await request<{ document: { units: Array<{ blocks: Array<{ key: string }> }> }; resumeState: unknown }>(learner, `/api/assignments/${assignment.id}/coursewares/${imported.versionId}`);
  assert.equal(read.response.status, 200, read.content.toString("utf8"));
  const blockKey = read.body.data!.document.units[0]!.blocks[0]!.key;
  assert.equal((await request(learner, `/api/assignments/${assignment.id}/coursewares/${imported.versionId}/resume`, json("PATCH", { blockKey, progressPercent: 50 }))).response.status, 200);
  assert.equal((await request(learner, `/api/assignments/${assignment.id}/coursewares/${imported.versionId}/reached-end`, { method: "POST" })).response.status, 200);
  assert.equal((await request(learner, `/api/assignments/${assignment.id}/learning/${imported.versionId}/complete`, { method: "POST" })).response.status, 200);
  assert.equal((await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: assignment.id }, select: { status: true } })).status, "pending_signature");
  console.log("STRUCTURED_COURSEWARE_SMOKE=PASS");
} finally {
  await cleanup();
}
