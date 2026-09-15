import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
const baseUrl = process.env.PHASE1_API_BASE_URL ?? "http://127.0.0.1:53101";
assert.match(databaseUrl, /phase1_test/i, "Refusing to run outside an isolated phase1_test database");
const prisma = new PrismaClient();

async function login(username: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "Phase1Only!234" }) });
  assert.equal(response.status, 200, `${username} login failed`);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  return cookie;
}

async function request(path: string, cookie?: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...init.headers } });
}

try {
  assert.equal((await request("/api/health")).status, 200);
  const companyCookie = await login("phase1-admin");
  const entityCookie = await login("phase1-entity");
  const departmentCookie = await login("phase1-department");
  const projectCookie = await login("phase1-project");
  assert.equal((await request("/api/auth/me", companyCookie)).status, 200);

  const project = await prisma.project.findUniqueOrThrow({ where: { code: "PHASE1-ONLY" } });
  const entity = await prisma.organization.findUniqueOrThrow({ where: { id: project.responsibleOrganizationId } });
  assert.equal((await request(`/api/projects/${project.id}/status`, projectCookie, { method: "PATCH", body: JSON.stringify({ status: "paused" }) })).status, 403);
  assert.equal((await request(`/api/projects/${project.id}/status`, entityCookie, { method: "PATCH", body: JSON.stringify({ status: "paused" }) })).status, 200);
  assert.equal((await request("/api/projects", departmentCookie, { method: "POST", body: JSON.stringify({ name: "越权项目", code: "DENIED-PROJECT", responsibleOrganizationId: entity.id }) })).status, 403);

  const person = await prisma.person.findFirstOrThrow({ where: { phone: "19900000001" } });
  assert.equal((await request(`/api/persons/${person.id}/sensitive`, entityCookie)).status, 401);
  const reauth = await request("/api/auth/reauthenticate", entityCookie, { method: "POST", body: JSON.stringify({ password: "Phase1Only!234" }) });
  assert.equal(reauth.status, 200);
  const token = (await reauth.json() as { data: { token: string } }).data.token;
  assert.equal((await request(`/api/persons/${person.id}/sensitive`, entityCookie, { headers: { "x-sensitive-token": token } })).status, 404);

  assert.equal((await request(`/api/persons/${person.id}`, companyCookie, { method: "DELETE", body: JSON.stringify({ reason: "隔离验证" }) })).status, 409);
  const empty = await prisma.person.findFirstOrThrow({ where: { phone: "19900000002" } });
  assert.equal((await request(`/api/persons/${empty.id}`, companyCookie, { method: "DELETE", body: JSON.stringify({ reason: "误建空档案" }) })).status, 204);

  const merge = await prisma.changeRequest.findFirstOrThrow({ where: { type: "account_merge", status: "pending" } });
  assert.equal((await request(`/api/management/requests/${merge.id}/approve`, companyCookie, { method: "POST", body: JSON.stringify({ note: "隔离验证账号合并" }) })).status, 200);
  const source = await prisma.account.findUniqueOrThrow({ where: { id: merge.accountId! } });
  assert.equal(source.status, "merged");
  assert.ok(source.mergedIntoAccountId);

  console.log("PHASE1_API_SMOKE=PASS");
} finally {
  await prisma.$disconnect();
}
