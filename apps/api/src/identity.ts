import { Prisma, type OrganizationType, type PersonType, type RoleName, type ScopeType } from "@prisma/client";
import type { Principal } from "./auth.js";

type Tx = Prisma.TransactionClient;
type ScopedRole = { role: RoleName; scopeType: ScopeType; scopeId: string | null };

export type GrantContext = ScopedRole & {
  organizationType?: OrganizationType;
  projectResponsibleOrganizationId?: string;
};

const orgManagerIds = (principal: Principal) => new Set(principal.roles
  .filter((item) => ["org_leader", "org_admin"].includes(item.role) && item.scopeType === "organization" && item.scopeId)
  .map((item) => item.scopeId!));

export function canGrantScopedRole(principal: Principal, target: GrantContext) {
  if (principal.roles.some((item) => item.role === "company_admin")) return true;
  const organizationIds = orgManagerIds(principal);
  if (target.role === "field_reporter") {
    return target.scopeType === "organization" && target.organizationType === "business_entity" && !!target.scopeId && organizationIds.has(target.scopeId);
  }
  if (target.role === "project_admin") {
    return target.scopeType === "project" && !!target.projectResponsibleOrganizationId && organizationIds.has(target.projectResponsibleOrganizationId);
  }
  return false;
}

export function canManagePersonStatus(principal: Principal, activeOrganizationIds: string[]) {
  if (principal.roles.some((item) => item.role === "company_admin")) return true;
  const organizationIds = orgManagerIds(principal);
  return activeOrganizationIds.some((id) => organizationIds.has(id));
}

export function canJoinProject(_personType: PersonType, primaryOrganizationType: OrganizationType | null) {
  return primaryOrganizationType === "business_entity";
}

export async function setPrimaryOrganization(tx: Tx, input: { personId: string; organizationId: string; actorId: string; reason: string }) {
  const current = await tx.organizationMembership.findFirst({
    where: { personId: input.personId, active: true, primary: true },
    orderBy: { createdAt: "desc" }
  });
  if (current?.organizationId === input.organizationId) return current;
  const now = new Date();
  await tx.organizationMembership.updateMany({
    where: { personId: input.personId, active: true, primary: true },
    data: { active: false, primary: false, endedAt: now, endedBy: input.actorId, endReason: input.reason }
  });
  return tx.organizationMembership.create({
    data: { personId: input.personId, organizationId: input.organizationId, primary: true, active: true }
  });
}

export async function grantRole(tx: Tx, input: { accountId: string; role: RoleName; scopeType: ScopeType; scopeId: string | null }) {
  const existing = await tx.roleAssignment.findFirst({ where: { ...input, active: true } });
  if (existing) return existing;
  if (input.role === "org_leader" && input.scopeType === "organization") {
    const leader = await tx.roleAssignment.findFirst({ where: { role: "org_leader", scopeType: "organization", scopeId: input.scopeId, active: true } });
    if (leader) throw Object.assign(new Error("该组织已有当前负责人，请先更换负责人"), { statusCode: 409, code: "ORGANIZATION_LEADER_EXISTS" });
  }
  try {
    return await tx.roleAssignment.create({ data: input });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const concurrent = await tx.roleAssignment.findFirst({ where: { ...input, active: true } });
    if (concurrent) return concurrent;
    throw error;
  }
}

export async function revokeRole(tx: Tx, input: { roleId: string; actorId: string; reason: string }) {
  const role = await tx.roleAssignment.findUniqueOrThrow({ where: { id: input.roleId } });
  if (!role.active) return role;
  return tx.roleAssignment.update({
    where: { id: input.roleId },
    data: { active: false, endedAt: new Date(), endedBy: input.actorId, endReason: input.reason }
  });
}

export async function disablePerson(tx: Tx, input: { personId: string; actorId: string; reason: string }) {
  const now = new Date();
  const person = await tx.person.update({ where: { id: input.personId }, data: { status: "disabled" } });
  const accounts = await tx.account.findMany({ where: { personId: input.personId }, select: { id: true } });
  const accountIds = accounts.map(({ id }) => id);
  if (accountIds.length) {
    await tx.account.updateMany({ where: { id: { in: accountIds } }, data: { status: "disabled", sessionVersion: { increment: 1 } } });
    await tx.refreshSession.updateMany({ where: { accountId: { in: accountIds }, revokedAt: null }, data: { revokedAt: now } });
    await tx.roleAssignment.updateMany({
      where: { accountId: { in: accountIds }, active: true },
      data: { active: false, endedAt: now, endedBy: input.actorId, endReason: input.reason }
    });
  }
  await tx.projectMember.updateMany({
    where: { personId: input.personId, status: "active" },
    data: { status: "removed", reviewedBy: input.actorId, reviewedAt: now }
  });
  await tx.trainingAssignment.updateMany({
    where: { personId: input.personId, status: { notIn: ["completed", "cancelled"] } },
    data: { status: "cancelled", cancelledAt: now }
  });
  return person;
}

export async function reactivatePerson(tx: Tx, input: { personId: string }) {
  const now = new Date();
  const person = await tx.person.update({ where: { id: input.personId }, data: { status: "active" } });
  const account = await tx.account.findUnique({ where: { personId: input.personId } });
  if (account) {
    await tx.refreshSession.updateMany({ where: { accountId: account.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.account.update({ where: { id: account.id }, data: { status: "active", sessionVersion: { increment: 1 } } });
    await grantRole(tx, { accountId: account.id, role: "learner", scopeType: "person", scopeId: input.personId });
  }
  return person;
}

async function isEmptyAccount(tx: Tx, accountId: string) {
  const account = await tx.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { username: true, passwordHash: true, personId: true, _count: { select: { roles: true, wechatBindings: true, refreshSessions: true, preferences: true } } }
  });
  const [requests, audits] = await Promise.all([
    tx.changeRequest.count({ where: { accountId } }),
    tx.auditLog.count({ where: { OR: [{ actorId: accountId }, { objectType: "account", objectId: accountId }] } })
  ]);
  return !account.username && !account.passwordHash && !account.personId
    && !account._count.roles && !account._count.wechatBindings && !account._count.refreshSessions && !account._count.preferences
    && !requests && !audits;
}

export async function requestAccountMerge(tx: Tx, input: { sourceAccountId: string; targetAccountId: string; personId: string; reason: string }) {
  const existing = await tx.changeRequest.findFirst({
    where: { accountId: input.sourceAccountId, personId: input.personId, type: "account_merge", status: "pending", payload: { path: ["targetAccountId"], equals: input.targetAccountId } },
    orderBy: { createdAt: "desc" }
  });
  if (existing) return existing;
  try {
    return await tx.changeRequest.create({
      data: { accountId: input.sourceAccountId, personId: input.personId, type: "account_merge", payload: { targetAccountId: input.targetAccountId, reason: input.reason } }
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    return tx.changeRequest.findFirstOrThrow({
      where: { accountId: input.sourceAccountId, personId: input.personId, type: "account_merge", status: "pending", payload: { path: ["targetAccountId"], equals: input.targetAccountId } },
      orderBy: { createdAt: "desc" }
    });
  }
}

export async function mergeAccounts(tx: Tx, input: { sourceAccountId: string; targetAccountId: string; actorId: string; reason: string }) {
  if (input.sourceAccountId === input.targetAccountId) throw Object.assign(new Error("不能合并同一账号"), { statusCode: 409, code: "ACCOUNT_MERGE_SAME" });
  const [source, target] = await Promise.all([
    tx.account.findUniqueOrThrow({ where: { id: input.sourceAccountId }, include: { roles: { where: { active: true } }, preferences: true } }),
    tx.account.findUniqueOrThrow({ where: { id: input.targetAccountId } })
  ]);
  if (source.status === "merged" || target.status === "merged") throw Object.assign(new Error("账号已经合并"), { statusCode: 409, code: "ACCOUNT_ALREADY_MERGED" });
  if (source.personId && target.personId && source.personId !== target.personId) throw Object.assign(new Error("两个账号属于不同人员，不能直接合并"), { statusCode: 409, code: "ACCOUNT_PERSON_CONFLICT" });
  if (source.verifiedPhone && target.verifiedPhone && source.verifiedPhone !== target.verifiedPhone) throw Object.assign(new Error("两个账号的已验证手机号不同，请先处理手机号变更"), { statusCode: 409, code: "ACCOUNT_PHONE_CONFLICT" });
  if (source.username && target.username && source.username !== target.username) throw Object.assign(new Error("两个账号都有独立用户名，请先处理登录名"), { statusCode: 409, code: "ACCOUNT_CREDENTIAL_CONFLICT" });

  const now = new Date();
  for (const role of source.roles) {
    await revokeRole(tx, { roleId: role.id, actorId: input.actorId, reason: input.reason });
    await grantRole(tx, { accountId: target.id, role: role.role, scopeType: role.scopeType, scopeId: role.scopeId });
  }
  for (const preference of source.preferences) {
    await tx.userPreference.upsert({
      where: { accountId_key: { accountId: target.id, key: preference.key } },
      create: { accountId: target.id, key: preference.key, value: preference.value as Prisma.InputJsonValue },
      update: {}
    });
  }
  await tx.wechatBinding.updateMany({ where: { accountId: source.id }, data: { accountId: target.id } });
  await tx.refreshSession.updateMany({ where: { accountId: { in: [source.id, target.id] }, revokedAt: null }, data: { revokedAt: now } });
  await tx.account.update({
    where: { id: source.id },
    data: { username: null, passwordHash: null, verifiedPhone: null, personId: null, status: "merged", mergedIntoAccountId: target.id, mergedAt: now, sessionVersion: { increment: 1 } }
  });
  await tx.account.update({
    where: { id: target.id },
    data: {
      status: "active",
      personId: target.personId ?? source.personId,
      verifiedPhone: target.verifiedPhone ?? source.verifiedPhone,
      username: target.username ?? source.username,
      passwordHash: target.passwordHash ?? source.passwordHash,
      sessionVersion: { increment: 1 }
    }
  });
  return target.id;
}

export async function bindAccountToPerson(tx: Tx, input: { currentAccountId: string; personId: string; reason: string }) {
  const [current, existing] = await Promise.all([
    tx.account.findUniqueOrThrow({ where: { id: input.currentAccountId } }),
    tx.account.findUnique({ where: { personId: input.personId } })
  ]);
  if (current.personId && current.personId !== input.personId) throw Object.assign(new Error("当前账号已绑定其他人员"), { statusCode: 409, code: "ACCOUNT_PERSON_CONFLICT" });
  if (!existing || existing.id === current.id) {
    await tx.account.update({ where: { id: current.id }, data: { personId: input.personId, status: "active" } });
    await grantRole(tx, { accountId: current.id, role: "learner", scopeType: "person", scopeId: input.personId });
    return { status: "bound" as const, accountId: current.id };
  }
  if (await isEmptyAccount(tx, current.id)) {
    const accountId = await mergeAccounts(tx, { sourceAccountId: current.id, targetAccountId: existing.id, actorId: existing.id, reason: input.reason });
    return { status: "bound" as const, accountId };
  }
  const request = await requestAccountMerge(tx, { sourceAccountId: current.id, targetAccountId: existing.id, personId: input.personId, reason: input.reason });
  return { status: "pending_merge" as const, requestId: request.id, targetAccountId: existing.id };
}
