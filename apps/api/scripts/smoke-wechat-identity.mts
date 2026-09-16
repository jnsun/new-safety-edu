import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { issueSession } from "../src/auth.js";
import { loadEnv } from "../src/env.js";
import { attachProvisionalWechatAccount, resolveWechatAccount } from "../src/wechat-identity.js";

assert.equal(process.env.APP_ENV, "test", "Refusing to run outside APP_ENV=test");
const env = loadEnv();
const prisma = new PrismaClient();
const baseUrl = process.env.WECHAT_IDENTITY_API_BASE_URL ?? "http://127.0.0.1:3000";
const marker = `微信身份匿名验证-${randomUUID().slice(0, 8)}`;
const ids = { accounts: [] as string[], people: [] as string[], organizations: [] as string[], requests: [] as string[], batches: [] as string[] };
const digest = (value: string) => createHmac("sha256", env.JWT_SECRET).update(value).digest("hex");

async function token(accountId: string) { return (await issueSession(accountId, env, { clientKind: "miniprogram", loginMethod: "wechat" })).accessToken; }
async function request(path: string, accessToken: string, method = "GET", body?: unknown) {
  return fetch(`${baseUrl}${path}`, { method, headers: { authorization: `Bearer ${accessToken}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function provisional(openid: string, unionid?: string) {
  const account = await prisma.account.create({ data: { status: "pending" } }); ids.accounts.push(account.id);
  await prisma.wechatBinding.create({ data: { appId: "smoke-mini", openid, unionid, accountId: account.id, active: true } });
  return { account, token: await token(account.id) };
}
async function code(phone: string, purpose: "wechat_bind" | "wechat_rebind", value = "123456", expiresAt = new Date(Date.now() + 300_000)) {
  await prisma.phoneVerificationCode.create({ data: { phoneHash: digest(phone), codeHash: digest(`${phone}:${value}`), purpose, expiresAt } });
}
async function person(name: string, phone: string, organizationId: string) {
  const row = await prisma.person.create({ data: { name, phone, type: "employee", status: "active", organizations: { create: { organizationId, primary: true } } } }); ids.people.push(row.id); return row;
}

try {
  let company = await prisma.organization.findFirst({ where: { type: "company" } });
  if (!company) { company = await prisma.organization.create({ data: { name: `${marker}-公司`, type: "company" } }); ids.organizations.push(company.id); }
  const orgA = await prisma.organization.create({ data: { name: `${marker}-甲`, type: "department", parentId: company.id } }); ids.organizations.push(orgA.id);
  const orgB = await prisma.organization.create({ data: { name: `${marker}-乙`, type: "department", parentId: company.id } }); ids.organizations.push(orgB.id);
  const orgNoAdmin = await prisma.organization.create({ data: { name: `${marker}-无管理员`, type: "department", parentId: company.id } }); ids.organizations.push(orgNoAdmin.id);

  const companyPerson = await person(`${marker}-公司管理员`, "19991000001", orgA.id);
  const companyAccount = await prisma.account.create({ data: { status: "active", personId: companyPerson.id, roles: { create: { personId: companyPerson.id, role: "company_admin", scopeType: "company" } } } }); ids.accounts.push(companyAccount.id);
  const adminA = await person(`${marker}-甲管理员`, "19991000002", orgA.id);
  const accountA = await prisma.account.create({ data: { status: "active", personId: adminA.id, roles: { create: { personId: adminA.id, role: "org_admin", scopeType: "organization", scopeId: orgA.id } } } }); ids.accounts.push(accountA.id);
  const adminB = await person(`${marker}-乙管理员`, "19991000003", orgB.id);
  const accountB = await prisma.account.create({ data: { status: "active", personId: adminB.id, roles: { create: { personId: adminB.id, role: "org_admin", scopeType: "organization", scopeId: orgB.id } } } }); ids.accounts.push(accountB.id);
  const [companyToken, adminAToken, adminBToken] = await Promise.all([token(companyAccount.id), token(accountA.id), token(accountB.id)]);

  const directPerson = await person(`${marker}-直接绑定`, "19991000011", orgA.id);
  const direct = await provisional(`${marker}-direct`, `${marker}-union-direct`); await code("19991000011", "wechat_bind");
  const directResponse = await request("/api/wechat/identity/confirm", direct.token, "POST", { phone: "19991000011", code: "123456", purpose: "wechat_bind", name: directPerson.name, organizationId: orgA.id, reason: "匿名流程验证" });
  assert.equal(directResponse.status, 200); assert.equal((await directResponse.json() as { data: { status: string } }).data.status, "bound");
  assert.equal(await prisma.roleAssignment.count({ where: { personId: directPerson.id } }), 0, "binding must not grant roles");
  const resolved = await prisma.$transaction((tx) => resolveWechatAccount(tx, { appId: "smoke-mini", openid: `${marker}-direct`, unionid: `${marker}-union-direct` }));
  assert.equal(resolved.account.personId, directPerson.id, "existing WeChat identity must resolve to its bound person");
  const crossAppResolved = await prisma.$transaction((tx) => resolveWechatAccount(tx, { appId: "smoke-web", openid: `${marker}-direct-web`, unionid: `${marker}-union-direct` }));
  assert.equal(crossAppResolved.account.id, resolved.account.id, "unionid must resolve the same person across WeChat applications");
  const boundToken = await token(resolved.account.id);
  const legacyRebind = await request("/api/me/change-requests", boundToken, "POST", { type: "binding_change", reason: "旧换绑入口不得绕过微信和短信验证" });
  assert.equal(legacyRebind.status, 409, "generic change request must not create an unverified WeChat rebind");
  assert.equal((await legacyRebind.json() as { error: { code: string } }).error.code, "WECHAT_REBIND_VERIFICATION_REQUIRED");
  const legacyPending = await prisma.changeRequest.create({ data: { accountId: resolved.account.id, personId: directPerson.id, type: "binding_change", requestKey: `smoke-legacy-rebind:${marker}`, payload: { reason: "历史申请" } } }); ids.requests.push(legacyPending.id);
  const legacyVisible = await request("/api/management/requests", companyToken).then((response) => response.json()) as { data: Array<{ id: string; availableActions: string[] }> };
  const legacyActions = legacyVisible.data.find(({ id }) => id === legacyPending.id)?.availableActions ?? [];
  assert.ok(legacyActions.includes("reject"), "company admin must be able to close a legacy rebind request");
  assert.ok(!legacyActions.includes("approve"), "legacy rebind request must not offer unsafe direct approval");

  const unsafePerson = await person(`${marker}-禁止合并`, "19991000018", orgA.id);
  const unsafeTarget = await prisma.account.create({ data: { status: "active", personId: unsafePerson.id } }); ids.accounts.push(unsafeTarget.id);
  const unsafeSource = await provisional(`${marker}-unsafe-source`, `${marker}-unsafe-union`);
  await prisma.userPreference.create({ data: { accountId: unsafeSource.account.id, key: "smoke.unsafe", value: true } });
  await assert.rejects(
    () => prisma.$transaction((tx) => attachProvisionalWechatAccount(tx, { provisionalAccountId: unsafeSource.account.id, personId: unsafePerson.id, verifiedPhone: unsafePerson.phone, actorId: unsafeSource.account.id, reason: "不应合并带业务关联的临时账号" })),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "WECHAT_IDENTITY_CONFLICT",
    "a provisional account with non-session business state must require company review"
  );
  const duplicateWechatAccount = await prisma.account.create({ data: { status: "pending", wechatBindings: { create: { appId: "smoke-web-conflict", openid: `${marker}-union-conflict`, unionid: `${marker}-union-direct`, active: true } } } }); ids.accounts.push(duplicateWechatAccount.id);
  await assert.rejects(() => prisma.$transaction((tx) => resolveWechatAccount(tx, { appId: "smoke-another-app", openid: `${marker}-another`, unionid: `${marker}-union-direct` })), (error: unknown) => error instanceof Error && "code" in error && error.code === "WECHAT_IDENTITY_CONFLICT");

  const unmatched = await provisional(`${marker}-unmatched`); await code("19991000012", "wechat_bind");
  const pendingResponse = await request("/api/wechat/identity/confirm", unmatched.token, "POST", { phone: "19991000012", code: "123456", purpose: "wechat_bind", name: `${marker}-新员工`, organizationId: orgA.id, reason: "人员库无匹配" });
  const pendingBody = await pendingResponse.json() as { data?: { requestId: string }; error?: { code: string } };
  assert.equal(pendingResponse.status, 200, pendingBody.error?.code); const pendingId = pendingBody.data!.requestId; ids.requests.push(pendingId);
  const orgARequests = await request("/api/binding-requests", adminAToken); const orgBRequests = await request("/api/binding-requests", adminBToken);
  assert.ok((await orgARequests.json() as { data: Array<{ id: string }> }).data.some(({ id }) => id === pendingId));
  assert.ok(!(await orgBRequests.json() as { data: Array<{ id: string }> }).data.some(({ id }) => id === pendingId), "other department must not see request");
  const createResponse = await request(`/api/identity-binding-requests/${pendingId}/review`, adminAToken, "POST", { action: "create_employee_and_bind", note: "确认是本部门正式员工" });
  assert.equal(createResponse.status, 200); const created = await prisma.changeRequest.findUniqueOrThrow({ where: { id: pendingId } }); assert.equal(created.status, "approved");
  assert.equal(await prisma.roleAssignment.count({ where: { personId: created.personId! } }), 0, "review-created learner must not receive management roles"); ids.people.push(created.personId!);

  const mismatchPerson = await person(`${marker}-部门不一致`, "19991000013", orgB.id);
  const mismatch = await provisional(`${marker}-mismatch`); await code("19991000013", "wechat_bind");
  const mismatchResponse = await request("/api/wechat/identity/confirm", mismatch.token, "POST", { phone: "19991000013", code: "123456", purpose: "wechat_bind", name: mismatchPerson.name, organizationId: orgA.id, reason: "部门资料待核对" });
  const mismatchId = (await mismatchResponse.json() as { data: { requestId: string } }).data.requestId; ids.requests.push(mismatchId);
  assert.equal((await request(`/api/identity-binding-requests/${mismatchId}/review`, adminBToken, "POST", { action: "bind_existing", personId: mismatchPerson.id, note: "越权尝试" })).status, 403);
  assert.equal((await request(`/api/identity-binding-requests/${mismatchId}/review`, adminAToken, "POST", { action: "bind_existing", personId: mismatchPerson.id, note: "跨部门尝试" })).status, 403);
  assert.equal((await request(`/api/identity-binding-requests/${mismatchId}/review`, adminAToken, "POST", { action: "escalate_company", note: "人员当前属于其他部门" })).status, 200);
  assert.equal((await request(`/api/identity-binding-requests/${mismatchId}/review`, companyToken, "POST", { action: "repair_membership_and_bind", personId: mismatchPerson.id, note: "公司核实后调整主部门" })).status, 200);

  const noAdmin = await provisional(`${marker}-fallback`); await code("19991000014", "wechat_bind");
  const fallbackResponse = await request("/api/wechat/identity/confirm", noAdmin.token, "POST", { phone: "19991000014", code: "123456", purpose: "wechat_bind", name: `${marker}-兜底`, organizationId: orgNoAdmin.id, reason: "部门无管理员" });
  const fallbackId = (await fallbackResponse.json() as { data: { requestId: string; escalatedToCompany: boolean } }).data; ids.requests.push(fallbackId.requestId); assert.equal(fallbackId.escalatedToCompany, true);
  assert.ok((await request("/api/binding-requests", companyToken).then((r) => r.json()) as { data: Array<{ id: string }> }).data.some(({ id }) => id === fallbackId.requestId));
  assert.ok(!(await request("/api/binding-requests", adminAToken).then((r) => r.json()) as { data: Array<{ id: string }> }).data.some(({ id }) => id === fallbackId.requestId));

  const rebindPerson = await person(`${marker}-换绑`, "19991000015", orgA.id);
  const oldAccount = await prisma.account.create({ data: { status: "active", personId: rebindPerson.id, verifiedPhone: rebindPerson.phone, wechatBindings: { create: { appId: "smoke-mini", openid: `${marker}-old`, unionid: `${marker}-old-union`, active: true, boundAt: new Date() } } } }); ids.accounts.push(oldAccount.id);
  const replacement = await provisional(`${marker}-new`, `${marker}-new-union`); await code(rebindPerson.phone, "wechat_rebind");
  const rebindResponse = await request("/api/wechat/identity/confirm", replacement.token, "POST", { phone: rebindPerson.phone, code: "123456", purpose: "wechat_rebind", name: rebindPerson.name, organizationId: orgA.id, reason: "本人更换微信" });
  assert.equal(rebindResponse.status, 200);
  assert.equal(await prisma.wechatBinding.count({ where: { accountId: oldAccount.id, active: false, endedAt: { not: null }, endReason: "本人短信验证后更换微信" } }), 1);
  assert.equal(await prisma.wechatBinding.count({ where: { accountId: oldAccount.id, active: true, openid: `${marker}-new` } }), 1);
  assert.equal((await request("/api/wechat/identity/confirm", replacement.token, "POST", { phone: rebindPerson.phone, code: "123456", purpose: "wechat_rebind", name: rebindPerson.name, organizationId: orgA.id, reason: "重复使用" })).status, 401);

  const expired = await provisional(`${marker}-expired`); await code("19991000016", "wechat_bind", "654321", new Date(Date.now() - 1));
  assert.equal((await request("/api/wechat/identity/confirm", expired.token, "POST", { phone: "19991000016", code: "654321", purpose: "wechat_bind", name: `${marker}-过期`, organizationId: orgA.id, reason: "过期验证" })).status, 401);
  const wrong = await provisional(`${marker}-wrong`); await code("19991000017", "wechat_bind", "111111");
  for (let index = 0; index < 5; index++) assert.equal((await request("/api/wechat/identity/confirm", wrong.token, "POST", { phone: "19991000017", code: "222222", purpose: "wechat_bind", name: `${marker}-错误`, organizationId: orgA.id, reason: "错误验证" })).status, 401);
  assert.equal((await prisma.phoneVerificationCode.findFirstOrThrow({ where: { phoneHash: digest("19991000017"), purpose: "wechat_bind" }, orderBy: { createdAt: "desc" } })).attempts, 5);

  console.log("WECHAT_IDENTITY_SMOKE=PASS");
} finally {
  const people = [...new Set(ids.people)];
  const accounts = [...new Set(ids.accounts)];
  const assignments = people.length ? await prisma.trainingAssignment.findMany({ where: { personId: { in: people } }, select: { id: true, batchId: true } }) : [];
  if (assignments.length) { await prisma.learningProgress.deleteMany({ where: { assignmentId: { in: assignments.map(({ id }) => id) } } }); await prisma.trainingAssignment.deleteMany({ where: { id: { in: assignments.map(({ id }) => id) } } }); }
  await prisma.trainingBatch.deleteMany({ where: { id: { in: assignments.map(({ batchId }) => batchId) }, assignments: { none: {} } } });
  await prisma.notificationOutbox.deleteMany({ where: { notification: { personId: { in: people } } } });
  await prisma.notification.deleteMany({ where: { personId: { in: people } } });
  await prisma.changeRequest.deleteMany({ where: { OR: [{ id: { in: ids.requests } }, { accountId: { in: accounts } }, { personId: { in: people } }] } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: accounts } }, { objectId: { in: [...accounts, ...people, ...ids.requests] } }] } });
  await prisma.refreshSession.deleteMany({ where: { accountId: { in: accounts } } });
  await prisma.roleAssignment.deleteMany({ where: { OR: [{ accountId: { in: accounts } }, { personId: { in: people } }] } });
  await prisma.wechatBinding.deleteMany({ where: { accountId: { in: accounts } } });
  await prisma.account.deleteMany({ where: { id: { in: accounts } } });
  await prisma.organizationMembership.deleteMany({ where: { personId: { in: people } } });
  await prisma.person.deleteMany({ where: { id: { in: people } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids.organizations } } });
  await prisma.phoneVerificationCode.deleteMany({ where: { phoneHash: { in: ["19991000011", "19991000012", "19991000013", "19991000014", "19991000015", "19991000016", "19991000017", "19991000018"].map(digest) } } });
  await prisma.$disconnect();
}
