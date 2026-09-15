import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
const uploadRoot = process.env.UPLOAD_ROOT ?? "";
const baseUrl = process.env.PRIVATE_FILE_API_BASE_URL ?? "http://127.0.0.1:55447";
assert.match(databaseUrl, /private_file_test/i, "Refusing to run outside isolated private_file_test database");
assert.match(uploadRoot, /tmp-private-file-uploads/i, "Refusing to write outside isolated private file uploads");
const prisma = new PrismaClient();

try {
  const company = await prisma.organization.create({ data: { name: "私有文件验证公司", type: "company" } });
  const entity = await prisma.organization.create({ data: { name: "项目责任实体", type: "business_entity", parentId: company.id } });
  const otherEntity = await prisma.organization.create({ data: { name: "成员所属实体", type: "business_entity", parentId: company.id } });
  const project = await prisma.project.create({ data: { name: "权限验证项目", code: "PRIVATE-FILE-001", responsibleOrganizationId: entity.id } });
  const manager = await prisma.person.create({ data: { name: "项目管理员", phone: "19900000601", type: "employee", status: "active", organizations: { create: { organizationId: entity.id, primary: true } } } });
  const member = await prisma.person.create({ data: { name: "跨实体项目成员", phone: "19900000602", type: "employee", status: "active", organizations: { create: { organizationId: otherEntity.id, primary: true } }, projectMemberships: { create: { projectId: project.id, status: "active" } } } });
  const account = await prisma.account.create({ data: { username: "file-project-admin", usernameNormalized: "file-project-admin", passwordHash: await argon2.hash("PrivateFile!234"), passwordLoginEnabled: true, personId: manager.id } });
  await prisma.roleAssignment.create({ data: { accountId: account.id, personId: manager.id, role: "project_admin", scopeType: "project", scopeId: project.id } });
  await prisma.projectMember.create({ data: { projectId: project.id, personId: manager.id, status: "active" } });
  await mkdir(uploadRoot, { recursive: true });
  async function file(name: string, kind: "photo" | "signature" | "attachment") {
    const content = Buffer.from(`isolated-${name}`); const storageKey = `${name}.bin`; await writeFile(resolve(uploadRoot, storageKey), content);
    return prisma.privateFile.create({ data: { kind, storageKey, originalName: `${name}.bin`, mimeType: "application/octet-stream", size: content.length, sha256: createHash("sha256").update(content).digest("hex"), uploadedBy: account.id } });
  }
  const photo = await file("photo", "photo"); await prisma.person.update({ where: { id: member.id }, data: { photoFileId: photo.id } });
  const projectSignature = await file("project-signature", "signature"); const projectBatch = await prisma.trainingBatch.create({ data: { businessKey: "private-file-project", name: "项目培训", type: "routine", projectId: project.id } }); const projectAssignment = await prisma.trainingAssignment.create({ data: { batchId: projectBatch.id, personId: member.id } }); await prisma.signature.create({ data: { assignmentId: projectAssignment.id, personId: member.id, fileId: projectSignature.id, recordHash: "project" } });
  const otherSignature = await file("other-signature", "signature"); const otherBatch = await prisma.trainingBatch.create({ data: { businessKey: "private-file-other", name: "其他培训", type: "routine" } }); const otherAssignment = await prisma.trainingAssignment.create({ data: { batchId: otherBatch.id, personId: member.id } }); await prisma.signature.create({ data: { assignmentId: otherAssignment.id, personId: member.id, fileId: otherSignature.id, recordHash: "other" } });
  const certificate = await file("certificate", "attachment"); await prisma.personCertificate.create({ data: { personId: member.id, name: "个人证书", fileId: certificate.id } });
  const reportFile = await file("report", "attachment"); const report = await prisma.projectMonthlyReport.create({ data: { projectId: project.id, reportingOrganizationId: entity.id, reportMonth: new Date("2026-09-01T00:00:00.000Z"), progressSummary: "验证", updatedBy: account.id } }); await prisma.projectMonthlyReportAttachment.create({ data: { reportId: report.id, fileId: reportFile.id, createdBy: account.id } });
  const unlinked = await file("unlinked", "attachment");
  const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "file-project-admin", password: "PrivateFile!234" }) });
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0]; assert.equal(login.status, 200); assert.ok(cookie);
  const read = (id: string) => fetch(`${baseUrl}/api/files/${id}`, { headers: { cookie } });
  assert.equal((await read(photo.id)).status, 200);
  assert.equal((await read(projectSignature.id)).status, 200);
  assert.equal((await read(otherSignature.id)).status, 403);
  assert.equal((await read(certificate.id)).status, 200);
  assert.equal((await read(reportFile.id)).status, 200);
  assert.equal((await read(unlinked.id)).status, 200);
  console.log("PRIVATE_FILE_ACCESS_SMOKE=PASS");
} finally { await prisma.$disconnect(); }
