import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import unzipper from "unzipper";

const databaseUrl = process.env.DATABASE_URL ?? "";
const baseUrl = process.env.SENSITIVE_EXPORT_API_BASE_URL ?? "http://127.0.0.1:55446";
const uploadRoot = process.env.UPLOAD_ROOT ?? "";
assert.match(databaseUrl, /sensitive_export_test/i, "Refusing to run outside an isolated sensitive_export_test database");
assert.match(uploadRoot, /tmp-sensitive-export-uploads/i, "Refusing to write outside isolated export uploads");
const prisma = new PrismaClient();

const request = (path: string, cookie?: string, init: RequestInit = {}) => {
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes((init.method ?? "GET").toUpperCase());
  const csrf = cookie?.split("; ").find((value) => value.startsWith("safety_csrf="))?.slice("safety_csrf=".length);
  return fetch(`${baseUrl}${path}`, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(unsafe && csrf ? { origin: baseUrl, host: new URL(baseUrl).host, "x-csrf-token": csrf } : {}), ...init.headers } });
};

try {
  const password = "SensitiveExport!234";
  const passwordHash = await argon2.hash(password);
  const company = await prisma.organization.create({ data: { name: "敏感导出验证公司", type: "company" } });
  const ownOrganization = await prisma.organization.create({ data: { name: "允许导出组织", type: "department", parentId: company.id } });
  const otherOrganization = await prisma.organization.create({ data: { name: "禁止导出组织", type: "department", parentId: company.id } });
  const managerPerson = await prisma.person.create({ data: { name: "导出验证管理员", phone: "19900000401", type: "employee", status: "active", organizations: { create: { organizationId: ownOrganization.id, primary: true } } } });
  const ownPerson = await prisma.person.create({ data: { name: "范围内人员", phone: "19900000402", type: "employee", status: "active", organizations: { create: { organizationId: ownOrganization.id, primary: true } } } });
  await prisma.person.create({ data: { name: "范围外人员", phone: "19900000403", type: "employee", status: "active", organizations: { create: { organizationId: otherOrganization.id, primary: true } } } });
  await prisma.account.create({ data: { username: "export-manager", usernameNormalized: "export-manager", passwordHash, passwordLoginEnabled: true, personId: managerPerson.id, roles: { create: { personId: managerPerson.id, role: "company_admin", scopeType: "company", scopeId: null } } } });
  const photo = Buffer.from("isolated-private-photo");
  const storageKey = "test/person-photo.jpg";
  await mkdir(resolve(uploadRoot, "test"), { recursive: true });
  await writeFile(resolve(uploadRoot, storageKey), photo);
  const file = await prisma.privateFile.create({ data: { kind: "photo", storageKey, originalName: "person-photo.jpg", mimeType: "image/jpeg", size: photo.length, sha256: createHash("sha256").update(photo).digest("hex"), uploadedBy: (await prisma.account.findFirstOrThrow({ where: { usernameNormalized: "export-manager" } })).id } });
  await prisma.person.update({ where: { id: ownPerson.id }, data: { photoFileId: file.id } });

  const login = await request("/api/auth/login", undefined, { method: "POST", body: JSON.stringify({ username: "export-manager", password }) });
  assert.equal(login.status, 200);
  const setCookies = (login.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [login.headers.get("set-cookie") ?? ""];
  const cookie = setCookies.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
  assert.ok(cookie);
  const input = { scopeType: "organization", scopeId: ownOrganization.id, categories: ["photos", "audit"], confirmed: true };
  const created = await request("/api/sensitive-exports", cookie, { method: "POST", body: JSON.stringify(input) });
  assert.equal(created.status, 202);
  const jobId = (await created.json() as { data: { id: string } }).data.id;
  const duplicate = await request("/api/sensitive-exports", cookie, { method: "POST", body: JSON.stringify(input) });
  assert.equal((await duplicate.json() as { data: { id: string } }).data.id, jobId);

  let status = "pending";
  for (let attempt = 0; attempt < 50 && !["ready", "failed"].includes(status); attempt++) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    const jobs = await request("/api/sensitive-exports", cookie);
    status = ((await jobs.json() as { data: Array<{ id: string; status: string }> }).data.find((row) => row.id === jobId))?.status ?? "missing";
  }
  assert.equal(status, "ready");
  const tokenResponse = await request(`/api/sensitive-exports/${jobId}/token`, cookie, { method: "POST", body: "{}" });
  assert.equal(tokenResponse.status, 200);
  const token = (await tokenResponse.json() as { data: { token: string } }).data.token;
  const download = await request(`/api/sensitive-exports/${jobId}/download`, cookie, { method: "POST", body: JSON.stringify({ token }) });
  assert.equal(download.status, 200);
  const zip = await unzipper.Open.buffer(Buffer.from(await download.arrayBuffer()));
  const names = zip.files.map(({ path }) => path);
  assert.ok(names.includes("manifest.json"));
  assert.ok(names.some((name) => name.startsWith("files/photos/")));
  const manifestEntry = zip.files.find(({ path }) => path === "manifest.json");
  assert.ok(manifestEntry);
  const manifest = (await manifestEntry!.buffer()).toString("utf8");
  assert.match(manifest, /范围内人员/);
  assert.doesNotMatch(manifest, /范围外人员/);
  assert.equal((await request(`/api/sensitive-exports/${jobId}/download`, cookie, { method: "POST", body: JSON.stringify({ token }) })).status, 409);
  assert.equal(await prisma.auditLog.count({ where: { action: { in: ["sensitive_export.request", "sensitive_export.complete", "sensitive_export.token", "sensitive_export.download"] } } }), 4);
  console.log("SENSITIVE_EXPORT_SMOKE=PASS");
} finally {
  await prisma.$disconnect();
}
