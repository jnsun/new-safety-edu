import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

const expectedDatabaseUrl = "postgresql://postgres@127.0.0.1:55433/contract_test";
assert.equal(process.env.DATABASE_URL, expectedDatabaseUrl, `Refusing to run outside ${expectedDatabaseUrl}`);
const baseUrl = "http://127.0.0.1:55449";
const prisma = new PrismaClient();
const marker = `contract-${randomUUID()}`;
const jwtSecret = "contract-management-smoke-jwt-secret";
const scratchBase = resolve(process.env.TEMP ?? ".");
const uploadRoot = resolve(scratchBase, marker);
assert.equal(dirname(uploadRoot), scratchBase, "cleanup target must remain directly inside the temporary directory");
let server: ChildProcess | null = null;
let serverOutput = "";
let phone = 1;
const phoneRun = Number.parseInt(randomUUID().slice(0, 4), 16) % 10_000;

const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function identity(label: string) {
  const person = await prisma.person.create({ data: { name: `${marker}-${label}`, phone: `196${String(phoneRun).padStart(4, "0")}${String(phone++).padStart(4, "0")}`, type: "employee", status: "active" } });
  const account = await prisma.account.create({ data: { username: `${marker}-${label}`, usernameNormalized: `${marker}-${label}`, status: "active", personId: person.id } });
  return { person, account };
}
async function token(accountId: string) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { sessionVersion: true } });
  const session = await prisma.refreshSession.create({ data: { accountId, tokenHash: `contract-smoke-${randomUUID()}`, clientKind: "contract-smoke", expiresAt: new Date(Date.now() + 3_600_000), absoluteExpiresAt: new Date(Date.now() + 3_600_000) } });
  return new SignJWT({ ver: account.sessionVersion, sid: session.id }).setProtectedHeader({ alg: "HS256" }).setSubject(accountId).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(jwtSecret));
}
async function request(path: string, bearer: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers); headers.set("authorization", `Bearer ${bearer}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
async function body<T>(response: Response) { return response.json() as Promise<{ data: T; error?: { code: string } }>; }
async function startServer() {
  const root = resolve(import.meta.dirname, "../../.."); await mkdir(uploadRoot, { recursive: true });
  server = spawn(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "apps/api/src/server.ts"], { cwd: root, env: { ...process.env, NODE_ENV: "test", PORT: "55449", RECEIVABLES_TEST_LISTEN_HOST: "127.0.0.1", PUBLIC_BASE_URL: baseUrl, COOKIE_SECRET: "contract-management-smoke-cookie-secret", JWT_SECRET: jwtSecret, FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"), UPLOAD_SIGNING_SECRET: "contract-management-upload-secret-123", UPLOAD_ROOT: uploadRoot }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout?.on("data", (chunk) => { serverOutput += String(chunk); }); server.stderr?.on("data", (chunk) => { serverOutput += String(chunk); });
  for (let attempt = 0; attempt < 120; attempt += 1) { if (server.exitCode !== null) throw new Error(serverOutput); try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {} await delay(50); }
  throw new Error(`API not ready\n${serverOutput}`);
}
async function stopServer() { if (!server || server.exitCode !== null) return; server.kill(); await Promise.race([once(server, "exit"), delay(2_000)]); if (server.exitCode === null) server.kill("SIGKILL"); }

try {
  const company = await prisma.organization.findFirst({ where: { type: "company" } }) ?? await prisma.organization.create({ data: { name: `${marker}-company`, type: "company" } });
  const orgA = await prisma.organization.create({ data: { name: `${marker}-A`, type: "business_entity", parentId: company.id, reportingEnabled: true } });
  const orgB = await prisma.organization.create({ data: { name: `${marker}-B`, type: "business_entity", parentId: company.id, reportingEnabled: true } });
  const governor = await identity("governor"); const editor = await identity("editor-a"); const reader = await identity("reader-b"); const editorB = await identity("editor-b"); const scopedAdmin = await identity("scoped-admin"); const safetyAdmin = await identity("safety-admin");
  await prisma.roleAssignment.create({ data: { personId: safetyAdmin.person.id, accountId: safetyAdmin.account.id, role: "company_admin", scopeType: "company" } });
  await prisma.organizationMembership.createMany({ data: [{ personId: editor.person.id, organizationId: orgA.id, primary: true }, { personId: reader.person.id, organizationId: orgB.id, primary: true }, { personId: editorB.person.id, organizationId: orgB.id, primary: true }, { personId: scopedAdmin.person.id, organizationId: orgA.id, primary: true }] });
  await prisma.contractAccessGrant.create({ data: { personId: editor.person.id, accountId: editor.account.id, role: "editor", canCreateProject: true, canEditProject: true, canManageContracts: true, canUploadAttachments: true, canChangeStage: true, grantedBy: governor.account.id, grantReason: "isolated smoke" } });
  await prisma.contractAccessGrant.create({ data: { personId: reader.person.id, accountId: reader.account.id, role: "readonly", canExport: true, grantedBy: governor.account.id, grantReason: "isolated smoke" } });
  await prisma.contractAccessGrant.create({ data: { personId: editorB.person.id, accountId: editorB.account.id, role: "editor", canEditProject: true, canManageContracts: true, canUploadAttachments: true, canChangeStage: true, grantedBy: governor.account.id, grantReason: "isolated smoke" } });
  await prisma.contractAccessGrant.create({ data: { personId: scopedAdmin.person.id, accountId: scopedAdmin.account.id, role: "admin", grantedBy: governor.account.id, grantReason: "isolated smoke" } });
  const hiddenBid = await prisma.project.create({ data: { name: `${marker}-B-bid`, code: `${marker}-B`, responsibleOrganizationId: orgB.id, contractBidStatus: "bidding", contractStage: "bid_preparation" } });
  const existingSafetyProject = await prisma.project.create({ data: { name: `${marker}-existing-safety`, code: `existing-${randomUUID().slice(0, 12)}`, responsibleOrganizationId: orgA.id } });
  const historicalMember = await prisma.projectMember.create({ data: { projectId: existingSafetyProject.id, personId: editor.person.id, status: "active", reviewedBy: safetyAdmin.account.id, reviewedAt: new Date("2026-08-31") } });
  const historicalReport = await prisma.projectMonthlyReport.create({ data: { projectId: existingSafetyProject.id, reportingOrganizationId: orgA.id, reportMonth: new Date("2026-08-01"), status: "submitted", progressSummary: "synthetic completed report", submittedBy: safetyAdmin.account.id, submittedAt: new Date("2026-09-01"), updatedBy: safetyAdmin.account.id, projectSnapshot: { historical: true } } });
  const historicalMemberBefore = await prisma.projectMember.findUniqueOrThrow({ where: { id: historicalMember.id } });
  const historicalReportBefore = await prisma.projectMonthlyReport.findUniqueOrThrow({ where: { id: historicalReport.id } });
  const tokens = { editor: await token(editor.account.id), reader: await token(reader.account.id), editorB: await token(editorB.account.id), scopedAdmin: await token(scopedAdmin.account.id), safety: await token(safetyAdmin.account.id) };
  await startServer();

  assert.equal((await fetch(`${baseUrl}/api/contracts/projects`)).status, 401, "合同列表必须要求登录");
  const safetyAccess = await body<{ canEnter: boolean }>(await request("/api/contracts/access", tokens.safety)); assert.equal(safetyAccess.data.canEnter, false);
  assert.equal((await request("/api/contracts/projects", tokens.safety)).status, 403, "安全管理员不得自动读取合同项目");
  let response = await request("/api/contracts/projects", tokens.editor); assert.equal(response.status, 200); assert.deepEqual((await body<{ items: Array<{ id: string }>; total: number }>(response)).data.items, []);
  response = await request("/api/contracts/projects", tokens.reader); assert.equal(response.status, 200); assert.deepEqual((await body<{ items: Array<{ id: string }>; total: number }>(response)).data.items.map(({ id }) => id), [hiddenBid.id]);
  response = await request("/api/contracts/project-candidates", tokens.editor); assert.equal(response.status, 200); assert.equal((await body<Array<{ id: string }>>(response)).data.some(({ id }) => id === existingSafetyProject.id), true);
  assert.equal((await body<Array<{ id: string }>>(await request("/api/contracts/project-candidates", tokens.editor))).data.some(({ id }) => id === hiddenBid.id), false, "关联合同候选项目也必须限制经营实体范围");
  assert.equal((await request(`/api/contracts/project-candidates/${hiddenBid.id}/activate`, tokens.editor, { method: "POST", body: JSON.stringify({ bidStatus: "bidding" }) })).status, 404, "候选项目的具体 ID 不能泄露其他经营实体项目");
  assert.equal((await request("/api/contracts/grants", tokens.editor)).status, 403, "无授权管理能力不得读取授权清单");
  assert.equal((await request("/api/contracts/grants", tokens.scopedAdmin)).status, 403, "仅有局部组织范围的合同管理员不得读取全局授权清单");
  assert.equal((await request("/api/contracts/grants", tokens.safety)).status, 200, "公司管理员可以审计合同授权清单但不能自动读取合同项目");
  assert.equal((await request(`/api/contracts/project-candidates/${existingSafetyProject.id}/activate`, tokens.editor, { method: "POST", body: JSON.stringify({ businessSector: "smoke-sector", bidStatus: "bidding" }) })).status, 201);
  assert.equal((await request(`/api/projects/${existingSafetyProject.id}/members`, tokens.safety)).status, 200, "既有安全项目纳入合同后仍可访问成员");
  assert.deepEqual(await prisma.projectMember.findUniqueOrThrow({ where: { id: historicalMember.id } }), historicalMemberBefore, "既有项目成员记录不得因纳入合同管理被改写");
  assert.deepEqual(await prisma.projectMonthlyReport.findUniqueOrThrow({ where: { id: historicalReport.id } }), historicalReportBefore, "既有已报月报及快照不得因纳入合同管理被改写");

  response = await request("/api/contracts/projects", tokens.editor, { method: "POST", body: JSON.stringify({ name: `${marker}-project-a`, code: `${marker}-A`, responsibleOrganizationId: orgA.id, bidStatus: "bidding" }) });
  assert.equal(response.status, 201); const created = (await body<{ id: string }>(response)).data;
  assert.equal((await request("/api/contracts/projects", tokens.editor, { method: "POST", body: JSON.stringify({ name: "cross-scope", code: `cross-${randomUUID().slice(0, 12)}`, responsibleOrganizationId: orgB.id }) })).status, 403);
  response = await request(`/api/contracts/projects?q=${encodeURIComponent(hiddenBid.name)}`, tokens.editor);
  assert.deepEqual((await body<{ items: Array<{ id: string }> }>(response)).data.items, [], "搜索不得覆盖经营实体数据范围");
  for (const term of [hiddenBid.code, hiddenBid.id]) {
    response = await request(`/api/contracts/projects?q=${encodeURIComponent(term)}`, tokens.editor);
    assert.deepEqual((await body<{ items: Array<{ id: string }> }>(response)).data.items, [], "项目编号或 ID 不能绕过组织范围");
  }
  assert.equal((await request(`/api/contracts/projects/${created.id}`, tokens.reader)).status, 404, "其他经营实体不得读取项目详情");
  assert.equal((await request(`/api/contracts/projects/${hiddenBid.id}`, tokens.editor, { method: "PATCH", body: JSON.stringify({ location: "must-not-write" }) })).status, 404, "完全越出授权范围的写请求不得泄露项目存在性");
  assert.equal((await request(`/api/contracts/projects/${hiddenBid.id}/main-contract`, tokens.editorB, { method: "PUT", body: JSON.stringify({ contractNo: `${marker}-HIDDEN-MAIN`, partyA: `${marker}-HIDDEN-CUSTOMER`, amountYuan: "50000.00" }) })).status, 200);
  for (const term of [`${marker}-HIDDEN-MAIN`, `${marker}-HIDDEN-CUSTOMER`]) {
    response = await request(`/api/contracts/projects?q=${encodeURIComponent(term)}`, tokens.editor);
    assert.deepEqual((await body<{ items: Array<{ id: string }> }>(response)).data.items, [], "知道其他实体合同编号或甲方仍不得搜索到项目");
  }
  response = await request(`/api/contracts/projects?q=${encodeURIComponent(`${marker}-HIDDEN-CUSTOMER`)}`, tokens.editorB);
  assert.deepEqual((await body<{ items: Array<{ id: string }> }>(response)).data.items.map(({ id }) => id), [hiddenBid.id], "同实体可按甲方查询主合同");
  const scopedExport = await request("/api/contracts/projects-export.csv", tokens.reader);
  assert.equal(scopedExport.status, 200);
  const scopedCsv = await scopedExport.text();
  assert.equal(scopedCsv.includes(hiddenBid.code), true, "导出包含授权实体项目");
  assert.equal(scopedCsv.includes(`${marker}-A,`), false, "导出不得包含其他实体项目");
  response = await request(`/api/contracts/projects/${created.id}`, tokens.editor); const beforeEdit = (await body<{ updatedAt: string }>(response)).data;
  assert.equal((await request(`/api/contracts/projects/${created.id}`, tokens.editor, { method: "PATCH", body: JSON.stringify({ location: "isolated-smoke-location", expectedUpdatedAt: beforeEdit.updatedAt }) })).status, 200);
  response = await request(`/api/contracts/projects/${created.id}`, tokens.editor, { method: "PATCH", body: JSON.stringify({ location: "stale-overwrite", expectedUpdatedAt: beforeEdit.updatedAt }) });
  assert.equal(response.status, 409, "过期版本不得覆盖项目"); assert.equal((await body<never>(response)).error?.code, "CONTRACT_PROJECT_REVISION_CONFLICT");
  response = await request(`/api/contracts/projects?q=${encodeURIComponent(`${marker}-project-a`)}`, tokens.editor); assert.deepEqual((await body<{ items: Array<{ id: string }> }>(response)).data.items.map(({ id }) => id), [created.id], "台账筛选必须由服务端执行");
  response = await request("/api/contracts/projects?page=1&pageSize=1", tokens.editor);
  const firstPage = (await body<{ items: Array<{ id: string }>; total: number }>(response)).data;
  assert.equal(firstPage.items.length, 1); assert.equal(firstPage.total >= 2, true, "分页总数来自服务端完整范围");
  assert.equal((await request(`/api/contracts/projects/${created.id}`, tokens.editor, { method: "PATCH", body: JSON.stringify({ responsibleOrganizationId: orgB.id }) })).status, 400, "合同页不能直接迁移责任实体");
  response = await request("/api/projects", tokens.safety); assert.equal(response.status, 200);
  assert.equal((await body<Array<{ id: string }>>(response)).data.some(({ id }) => id === created.id), false, "未登记主合同不得进入安全项目");
  assert.equal((await request(`/api/contracts/projects/${created.id}/main-contract`, tokens.editor, { method: "PUT", body: JSON.stringify({ contractNo: `${marker}-negative`, partyA: "smoke-party-a", amountYuan: "-1.00" }) })).status, 400);

  response = await request(`/api/contracts/projects/${created.id}/main-contract`, tokens.editor, { method: "PUT", body: JSON.stringify({ contractNo: `${marker} main 001`, partyA: "smoke-party-a", amountYuan: "120000.00" }) }); assert.equal(response.status, 200);
  const main = (await body<{ id: string }>(response)).data;
  response = await request("/api/projects", tokens.safety); assert.equal(response.status, 200);
  assert.equal((await body<Array<{ id: string }>>(response)).data.some(({ id }) => id === created.id), false, "主合同仅登记但未签署，不得进入安全项目");
  response = await request("/api/monthly-reports/projects", tokens.safety); assert.equal(response.status, 200);
  assert.equal((await body<Array<{ id: string }>>(response)).data.some(({ id }) => id === created.id), false, "未签主合同不得进入月报项目");
  response = await request(`/api/contracts/projects/${created.id}/main-contract`, tokens.editor, { method: "PUT", body: JSON.stringify({ contractNo: `${marker} main 001`, partyA: "smoke-party-a", amountYuan: "120000.00", signedAt: "2026-09-25" }) }); assert.equal(response.status, 200);
  response = await request(`/api/contracts/projects?q=${encodeURIComponent(`${marker}MAIN001`)}`, tokens.editor);
  assert.deepEqual((await body<{ items: Array<{ id: string }> }>(response)).data.items.map(({ id }) => id), [created.id], "主合同编号应在授权范围内可搜索");
  response = await request(`/api/contracts/projects?q=${encodeURIComponent(`${marker}MAIN001`)}`, tokens.editorB);
  assert.deepEqual((await body<{ items: Array<{ id: string }> }>(response)).data.items, [], "知道主合同编号也不能跨组织搜索");
  assert.equal((await request(`/api/contracts/projects/${created.id}`, tokens.editor, { method: "PATCH", body: JSON.stringify({ bidStatus: "lost" }) })).status, 409, "签约项目不能回退为未中标");
  assert.equal((await request(`/api/contracts/projects/${created.id}/supplements`, tokens.editor, { method: "POST", body: JSON.stringify({ contractNo: `${marker}-S1`, amountDeltaYuan: "-1000.00", reason: "smoke" }) })).status, 201);
  response = await request(`/api/contracts/projects/${created.id}/subcontracts`, tokens.editor, { method: "POST", body: JSON.stringify({ contractNo: `${marker}-SUB1`, subcontractorName: "smoke-subcontractor", amountYuan: "30000.00", owningOrganizationId: orgA.id }) });
  assert.equal(response.status, 201);
  const subcontract = (await body<{ id: string }>(response)).data;
  const authoritativeBefore = await prisma.project.findUniqueOrThrow({ where: { id: created.id }, select: { responsibleOrganizationId: true, managerName: true, mainContractId: true } });
  assert.equal(authoritativeBefore.responsibleOrganizationId, orgA.id, "创建分包不得改写主项目归属");
  const otherSubcontract = await prisma.contractSubcontract.create({ data: { projectId: created.id, contractNo: `${marker}-SUB-B`, subcontractorName: "scope-only", owningOrganizationId: orgB.id } });
  assert.deepEqual(await prisma.project.findUniqueOrThrow({ where: { id: created.id }, select: { responsibleOrganizationId: true, managerName: true, mainContractId: true } }), authoritativeBefore, "多个分包实体不得覆盖主项目权威字段");
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: created.id }, include: { mainContract: true, contractSubcontracts: true } })).contractSubcontracts.length, 2, "主合同与多个分包合同保持独立关联");
  await prisma.contractSubcontract.update({ where: { id: subcontract.id }, data: { owningOrganizationId: orgB.id } });
  assert.deepEqual(await prisma.project.findUniqueOrThrow({ where: { id: created.id }, select: { responsibleOrganizationId: true, managerName: true, mainContractId: true } }), authoritativeBefore, "修改分包实体不得改写主项目权威字段");
  await prisma.contractSubcontract.delete({ where: { id: subcontract.id } });
  assert.deepEqual(await prisma.project.findUniqueOrThrow({ where: { id: created.id }, select: { responsibleOrganizationId: true, managerName: true, mainContractId: true } }), authoritativeBefore, "删除分包关系不得改写主项目权威字段");
  assert.equal((await prisma.contractSubcontract.findMany({ where: { projectId: created.id } })).at(0)?.id, otherSubcontract.id, "删除一个分包关系不影响其他分包实体");
  assert.equal((await request(`/api/contracts/projects/${created.id}`, tokens.editorB)).status, 200, "分包实体可以查看关联项目");
  assert.equal((await request(`/api/contracts/projects/${created.id}`, tokens.editorB, { method: "PATCH", body: JSON.stringify({ location: "cross-scope-write" }) })).status, 403, "分包实体不得修改责任实体主项目");
  assert.equal((await request(`/api/contracts/projects/${created.id}/stage-transitions`, tokens.editor, { method: "POST", body: JSON.stringify({ toStage: "field_work" }) })).status, 201);
  response = await request(`/api/contracts/projects/${created.id}`, tokens.editor); assert.equal(response.status, 200); const detail = (await body<{ contractStatusHistory: Array<{ toStage: string }> }>(response)).data; assert.deepEqual(detail.contractStatusHistory.slice(0, 3).map(({ toStage }) => toStage), ["field_work", "contract_registration", "bid_preparation"]);

  const second = await prisma.project.create({ data: { name: `${marker}-project-a-2`, code: `${marker}-A2`, responsibleOrganizationId: orgA.id, contractBidStatus: "bidding", contractStage: "bid_preparation" } });
  response = await request(`/api/contracts/projects/${second.id}/main-contract`, tokens.editor, { method: "PUT", body: JSON.stringify({ contractNo: `${marker} main 001`, partyA: "smoke-party-a", amountYuan: "120000.00" }) });
  assert.equal(response.status, 409, "一份主合同不得关联多个项目");
  assert.equal((await body<never>(response)).error?.code, "MAIN_CONTRACT_ALREADY_ASSIGNED");
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: second.id } })).mainContractId, null);

  const form = new FormData(); form.append("file", new Blob(["contract-private-file"], { type: "application/pdf" }), "evidence.pdf");
  response = await request("/api/files?kind=attachment", tokens.editor, { method: "POST", body: form }); assert.equal(response.status, 201); const file = (await body<{ id: string }>(response)).data;
  assert.equal((await request(`/api/contracts/projects/${created.id}/attachments`, tokens.editor, { method: "POST", body: JSON.stringify({ fileId: file.id, ownerType: "main_contract", ownerId: main.id }) })).status, 201);
  assert.equal((await request(`/api/contracts/projects/${created.id}/attachments`, tokens.editor, { method: "POST", body: JSON.stringify({ fileId: file.id, ownerType: "project", ownerId: created.id }) })).status, 409, "私有文件不得重复关联");
  assert.equal((await request(`/api/files/${file.id}`, tokens.editor)).status, 200);
  assert.equal((await request(`/api/files/${file.id}`, tokens.reader)).status, 200, "已关联分包的经营实体按合同项目可见范围读取附件");
  assert.equal((await request(`/api/files/${file.id}`, tokens.safety)).status, 403, "安全管理员身份不代替合同附件授权");
  assert.equal((await request("/api/contracts/projects-export.csv", tokens.editor)).status, 403, "未授予导出能力时必须拒绝");

  response = await request("/api/projects", tokens.safety); assert.equal(response.status, 200); const safetyProjects = (await body<Array<{ id: string }>>(response)).data.map(({ id }) => id); assert.equal(safetyProjects.includes(created.id), true, "中标项目继续复用安全项目"); assert.equal(safetyProjects.includes(existingSafetyProject.id), true, "纳入合同系统不得破坏既有安全项目行为"); assert.equal(safetyProjects.includes(hiddenBid.id), false, "投标中项目不得进入安全项目清单");
  response = await request("/api/monthly-reports/projects", tokens.safety); assert.equal(response.status, 200); const reportProjects = (await body<Array<{ id: string }>>(response)).data.map(({ id }) => id); assert.equal(reportProjects.includes(hiddenBid.id), false, "投标中项目不得进入月报清单");
  response = await request("/api/receivables/access", tokens.editor); assert.equal(response.status, 200); assert.equal((await body<{ canEnter: boolean }>(response)).data.canEnter, false, "合同权限不得自动变成财务权限");
  console.log("CONTRACTS_E2E_SMOKE=PASS");
} finally {
  await stopServer(); await prisma.$disconnect(); await rm(uploadRoot, { recursive: true, force: true });
}
