import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
const parsedDatabaseUrl = new URL(databaseUrl);
assert.equal(parsedDatabaseUrl.hostname, "127.0.0.1", "private file smoke requires local PostgreSQL");
assert.equal(parsedDatabaseUrl.port, "55432", "private file smoke requires PostgreSQL port 55432");
assert.equal(parsedDatabaseUrl.pathname, "/private_file_test", "Refusing to run outside private_file_test");
const uploadRoot = resolve(process.env.UPLOAD_ROOT ?? "");
assert.match(uploadRoot, /[\\/]tmp-private-file-uploads$/i, "Refusing to write outside isolated tmp-private-file-uploads");
const baseUrl = process.env.PRIVATE_FILE_API_BASE_URL ?? "http://127.0.0.1:55447";
const apiUrl = new URL(baseUrl);
assert.equal(apiUrl.hostname, "127.0.0.1");
assert.equal(apiUrl.port, "55447");

const root = resolve(import.meta.dirname, "../../..");
const marker = `pf-${randomUUID().slice(0, 8)}`;
const jwtSecret = "private-file-access-smoke-jwt-secret";
const prisma = new PrismaClient();
const ids = { organizations: [] as string[], projects: [] as string[], people: [] as string[], accounts: [] as string[], roles: [] as string[], files: [] as string[], reports: [] as string[], batches: [] as string[], assignments: [] as string[] };
let server: ChildProcess | null = null;
let output = "";
let failure: unknown;
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function storedFiles(path = uploadRoot): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? storedFiles(resolve(path, entry.name)) : [resolve(path, entry.name)]))).flat();
}

async function start() {
  server = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "apps/api/src/server.ts"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test", PORT: "55447", RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1", PUBLIC_BASE_URL: baseUrl, COOKIE_SECRET: "private-file-access-smoke-cookie-secret", JWT_SECRET: jwtSecret, FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), UPLOAD_SIGNING_SECRET: "private-file-access-smoke-upload-secret", UPLOAD_ROOT: uploadRoot },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(`${baseUrl}/api/health`)).status === 200) return; } catch {}
    await delay(50);
  }
  throw new Error(`private file smoke API unavailable: ${output}`);
}

async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  server.kill();
  for (let attempt = 0; attempt < 40 && server.exitCode === null && server.signalCode === null; attempt += 1) await delay(50);
  if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
  for (let attempt = 0; attempt < 40 && server.exitCode === null && server.signalCode === null; attempt += 1) await delay(50);
  assert.ok(server.exitCode !== null || server.signalCode !== null, "private file smoke API did not stop");
}

async function cleanup() {
  const cleanupErrors: unknown[] = [];
  const actions = [
    () => prisma.auditLog.deleteMany({ where: { actorId: { in: ids.accounts } } }),
    () => prisma.projectMonthlyReportAttachment.deleteMany({ where: { reportId: { in: ids.reports } } }),
    () => prisma.projectMonthlyReport.deleteMany({ where: { id: { in: ids.reports } } }),
    async () => { await prisma.$executeRawUnsafe('ALTER TABLE "signatures" DISABLE TRIGGER "signatures_append_only"'); try { await prisma.signature.deleteMany({ where: { assignmentId: { in: ids.assignments } } }); } finally { await prisma.$executeRawUnsafe('ALTER TABLE "signatures" ENABLE TRIGGER "signatures_append_only"'); } },
    () => prisma.trainingAssignment.deleteMany({ where: { id: { in: ids.assignments } } }),
    () => prisma.trainingBatch.deleteMany({ where: { id: { in: ids.batches } } }),
    () => prisma.personCertificate.deleteMany({ where: { personId: { in: ids.people } } }),
    () => prisma.person.updateMany({ where: { id: { in: ids.people } }, data: { photoFileId: null } }),
    () => prisma.privateFile.deleteMany({ where: { id: { in: ids.files } } }),
    () => prisma.refreshSession.deleteMany({ where: { accountId: { in: ids.accounts } } }),
    () => prisma.roleAssignment.deleteMany({ where: { id: { in: ids.roles } } }),
    () => prisma.projectMember.deleteMany({ where: { projectId: { in: ids.projects } } }),
    () => prisma.account.deleteMany({ where: { id: { in: ids.accounts } } }),
    () => prisma.organizationMembership.deleteMany({ where: { personId: { in: ids.people } } }),
    () => prisma.person.deleteMany({ where: { id: { in: ids.people } } }),
    () => prisma.project.deleteMany({ where: { id: { in: ids.projects } } }),
    () => prisma.organization.deleteMany({ where: { id: { in: ids.organizations } } }),
    () => rm(resolve(uploadRoot, "..", `${marker}-outside.bin`), { force: true }),
    () => rm(uploadRoot, { recursive: true, force: true }),
  ];
  for (const action of actions) { try { await action(); } catch (error) { cleanupErrors.push(error); } }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "private file fixture cleanup failed");
}

async function assertClean() {
  const [organizations, projects, people, accounts, files, audits] = await Promise.all([
    prisma.organization.count({ where: { name: { startsWith: marker } } }),
    prisma.project.count({ where: { code: { startsWith: marker } } }),
    prisma.person.count({ where: { name: { startsWith: marker } } }),
    prisma.account.count({ where: { username: { startsWith: marker } } }),
    prisma.privateFile.count({ where: { storageKey: { contains: marker } } }),
    prisma.auditLog.count({ where: { actorId: { in: ids.accounts } } }),
  ]);
  assert.deepEqual({ organizations, projects, people, accounts, files, audits }, { organizations: 0, projects: 0, people: 0, accounts: 0, files: 0, audits: 0 });
  assert.deepEqual(await storedFiles(), [], "private file smoke left physical files");
}

try {
  await rm(uploadRoot, { recursive: true, force: true });
  await mkdir(uploadRoot, { recursive: true });
  const company = await prisma.organization.create({ data: { name: `${marker}-company`, type: "company" } }); ids.organizations.push(company.id);
  const entity = await prisma.organization.create({ data: { name: `${marker}-project-entity`, type: "business_entity", parentId: company.id } }); ids.organizations.push(entity.id);
  const otherEntity = await prisma.organization.create({ data: { name: `${marker}-member-entity`, type: "business_entity", parentId: company.id } }); ids.organizations.push(otherEntity.id);
  const project = await prisma.project.create({ data: { name: `${marker}-project`, code: `${marker}-project`, responsibleOrganizationId: entity.id } }); ids.projects.push(project.id);
  const manager = await prisma.person.create({ data: { name: `${marker}-manager`, phone: `19${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`, type: "employee", status: "active", organizations: { create: { organizationId: entity.id, primary: true } } } }); ids.people.push(manager.id);
  const member = await prisma.person.create({ data: { name: `${marker}-member`, phone: `18${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`, type: "employee", status: "active", organizations: { create: { organizationId: otherEntity.id, primary: true } }, projectMemberships: { create: { projectId: project.id, status: "active" } } } }); ids.people.push(member.id);
  const username = `${marker}-admin`;
  const account = await prisma.account.create({ data: { username, usernameNormalized: username, passwordHash: await argon2.hash("PrivateFile!234"), passwordLoginEnabled: true, personId: manager.id } }); ids.accounts.push(account.id);
  const role = await prisma.roleAssignment.create({ data: { accountId: account.id, personId: manager.id, role: "project_admin", scopeType: "project", scopeId: project.id } }); ids.roles.push(role.id);
  await prisma.projectMember.create({ data: { projectId: project.id, personId: manager.id, status: "active" } });

  async function file(name: string, kind: "photo" | "signature" | "attachment") {
    const content = Buffer.from(`${marker}-${name}`);
    const storageKey = `${marker}/${name}.bin`;
    await mkdir(resolve(uploadRoot, marker), { recursive: true });
    await writeFile(resolve(uploadRoot, storageKey), content);
    const row = await prisma.privateFile.create({ data: { kind, storageKey, originalName: `${name}.bin`, mimeType: "application/octet-stream", size: content.length, sha256: createHash("sha256").update(content).digest("hex"), uploadedBy: account.id } });
    ids.files.push(row.id);
    return { row, content };
  }

  const photo = await file("photo", "photo"); await prisma.person.update({ where: { id: member.id }, data: { photoFileId: photo.row.id } });
  const projectSignature = await file("project-signature", "signature"); const projectBatch = await prisma.trainingBatch.create({ data: { businessKey: `${marker}-project-batch`, name: `${marker}-project-training`, type: "routine", projectId: project.id } }); ids.batches.push(projectBatch.id); const projectAssignment = await prisma.trainingAssignment.create({ data: { batchId: projectBatch.id, personId: member.id } }); ids.assignments.push(projectAssignment.id); await prisma.signature.create({ data: { assignmentId: projectAssignment.id, personId: member.id, fileId: projectSignature.row.id, recordHash: "project" } });
  const otherSignature = await file("other-signature", "signature"); const otherBatch = await prisma.trainingBatch.create({ data: { businessKey: `${marker}-other-batch`, name: `${marker}-other-training`, type: "routine" } }); ids.batches.push(otherBatch.id); const otherAssignment = await prisma.trainingAssignment.create({ data: { batchId: otherBatch.id, personId: member.id } }); ids.assignments.push(otherAssignment.id); await prisma.signature.create({ data: { assignmentId: otherAssignment.id, personId: member.id, fileId: otherSignature.row.id, recordHash: "other" } });
  const certificate = await file("certificate", "attachment"); await prisma.personCertificate.create({ data: { personId: member.id, name: `${marker}-certificate`, fileId: certificate.row.id } });
  const reportFile = await file("report", "attachment"); const report = await prisma.projectMonthlyReport.create({ data: { projectId: project.id, reportingOrganizationId: entity.id, reportMonth: new Date("2026-09-01T00:00:00.000Z"), progressSummary: marker, updatedBy: account.id } }); ids.reports.push(report.id); await prisma.projectMonthlyReportAttachment.create({ data: { reportId: report.id, fileId: reportFile.row.id, createdBy: account.id } });
  const unlinked = await file("unlinked", "attachment");
  const outsideContent = Buffer.from(`${marker}-outside`); const outsidePath = resolve(uploadRoot, "..", `${marker}-outside.bin`); await writeFile(outsidePath, outsideContent);
  const traversal = await prisma.privateFile.create({ data: { kind: "attachment", storageKey: `../${marker}-outside.bin`, originalName: "outside.bin", mimeType: "application/octet-stream", size: outsideContent.length, sha256: createHash("sha256").update(outsideContent).digest("hex"), uploadedBy: account.id } }); ids.files.push(traversal.id);

  await start();
  const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "PrivateFile!234" }) });
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0]; assert.equal(login.status, 200); assert.ok(cookie);
  const read = (id: string) => fetch(`${baseUrl}/api/files/${id}`, { headers: { cookie } });
  for (const accessible of [photo.row, projectSignature.row, certificate.row, reportFile.row, unlinked.row]) {
    const response = await read(accessible.id); const body = response.status === 200 ? "" : await response.text();
    assert.equal(response.status, 200, `${accessible.storageKey}: ${body}\n${output}`);
  }
  assert.equal((await read(otherSignature.row.id)).status, 403);
  assert.equal((await read(traversal.id)).status, 409);
  await writeFile(resolve(uploadRoot, unlinked.row.storageKey), Buffer.alloc(unlinked.content.length, 0x78));
  assert.equal((await read(unlinked.row.id)).status, 409);
  for (let attempt = 0; attempt < 80 && await prisma.auditLog.count({ where: { actorId: account.id, action: "file.read" } }) < 5; attempt += 1) await delay(25);
  assert.equal(await prisma.auditLog.count({ where: { actorId: account.id, action: "file.read" } }), 5, "denied/integrity-failed reads must not write file.read audits");
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors: unknown[] = [];
  for (const action of [stop, cleanup, assertClean, () => prisma.$disconnect()]) {
    try { await action(); } catch (error) { cleanupErrors.push(error); }
  }
  if (cleanupErrors.length) failure = new AggregateError(failure === undefined ? cleanupErrors : [failure, ...cleanupErrors], "private file smoke cleanup failed");
}

if (failure !== undefined) throw failure;
console.log("PRIVATE_FILE_ACCESS_SMOKE=PASS");
