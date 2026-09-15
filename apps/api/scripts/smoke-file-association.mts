import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
const baseUrl = process.env.FILE_ASSOCIATION_API_BASE_URL ?? "http://127.0.0.1:55448";
assert.match(databaseUrl, /file_association_test/i, "Refusing to run outside isolated file_association_test database");
const prisma = new PrismaClient();

try {
  const company = await prisma.organization.create({ data: { name: "文件关联验证公司", type: "company" } });
  const department = await prisma.organization.create({ data: { name: "验证部门", type: "department", parentId: company.id } });
  const adminPerson = await prisma.person.create({ data: { name: "验证管理员", phone: "19900000701", type: "employee", status: "active", organizations: { create: { organizationId: department.id, primary: true } } } });
  const target = await prisma.person.create({ data: { name: "目标人员", phone: "19900000702", type: "employee", status: "active", organizations: { create: { organizationId: department.id, primary: true } } } });
  const admin = await prisma.account.create({ data: { username: "file-association-admin", usernameNormalized: "file-association-admin", passwordHash: await argon2.hash("FileAssociation!234"), passwordLoginEnabled: true, personId: adminPerson.id, roles: { create: { personId: adminPerson.id, role: "company_admin", scopeType: "company" } } } });
  const other = await prisma.account.create({ data: {} });
  const makeFile = (uploadedBy: string, name: string) => prisma.privateFile.create({ data: { kind: "photo", storageKey: `${name}.jpg`, originalName: `${name}.jpg`, mimeType: "image/jpeg", size: 1, sha256: createHash("sha256").update(name).digest("hex"), uploadedBy } });
  const [otherPhoto, ownPhoto] = await Promise.all([makeFile(other.id, "other-photo"), makeFile(admin.id, "own-photo")]);

  const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "file-association-admin", password: "FileAssociation!234" }) });
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.equal(login.status, 200);
  assert.ok(cookie);
  const updatePhoto = (photoFileId: string) => fetch(`${baseUrl}/api/persons/${target.id}`, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ photoFileId }) });
  assert.equal((await updatePhoto(otherPhoto.id)).status, 403);
  assert.equal((await updatePhoto(ownPhoto.id)).status, 200);
  assert.equal((await prisma.person.findUniqueOrThrow({ where: { id: target.id }, select: { photoFileId: true } })).photoFileId, ownPhoto.id);
  console.log("FILE_ASSOCIATION_SMOKE=PASS");
} finally {
  await prisma.$disconnect();
}
