import { Prisma, type OrganizationType, type PersonType, type RoleName, type ScopeType } from "@prisma/client";
import type { Principal } from "./auth.js";
import { assertAccountMergeAllowed } from "./account-merge-policy.js";

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
  const leaderIds = new Set(principal.roles.filter((item) => item.role === "org_leader" && item.scopeType === "organization" && item.scopeId).map((item) => item.scopeId!));
  const organizationIds = orgManagerIds(principal);
  if (target.role === "org_admin") {
    return target.scopeType === "organization" && !!target.scopeId && leaderIds.has(target.scopeId);
  }
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

export async function grantRole(tx: Tx, input: { personId: string; role: RoleName; scopeType: ScopeType; scopeId: string | null; actorId: string; reason: string }) {
  if (input.role === "learner") throw Object.assign(new Error("普通人员能力无需手工授权"), { statusCode: 409, code: "LEARNER_ROLE_NOT_ASSIGNABLE" });
  const person = await tx.person.findUniqueOrThrow({
    where: { id: input.personId },
    select: { status: true, type: true, account: { select: { id: true, status: true } } }
  });
  if (person.status !== "active" || person.type !== "employee") throw Object.assign(new Error("管理角色只能授予在用正式员工"), { statusCode: 409, code: "ROLE_PERSON_INELIGIBLE" });
  const account = person.account?.status === "active" ? person.account : null;
  if (input.role === "company_admin" && !account) throw Object.assign(new Error("公司管理员必须先激活账号"), { statusCode: 409, code: "COMPANY_ADMIN_ACCOUNT_REQUIRED" });
  const state = account ? { accountId: account.id, active: true, activationPending: false } : { accountId: null, active: false, activationPending: true };
  const identity = { personId: input.personId, role: input.role, scopeType: input.scopeType, scopeId: input.scopeId };
  const existing = await tx.roleAssignment.findFirst({ where: { ...identity, OR: [{ active: true }, { activationPending: true }] } });
  if (existing) return existing;
  if (input.role === "org_leader" && input.scopeType === "organization") {
    const pendingLeader = await tx.roleAssignment.findFirst({ where: { role: "org_leader", scopeType: "organization", scopeId: input.scopeId, activationPending: true } });
    if (pendingLeader) throw Object.assign(new Error("该组织已有待激活负责人授权"), { statusCode: 409, code: "ORGANIZATION_PENDING_LEADER_EXISTS" });
    if (account) {
      await tx.roleAssignment.updateMany({
        where: { role: "org_leader", scopeType: "organization", scopeId: input.scopeId, active: true, personId: { not: input.personId } },
        data: { active: false, endedAt: new Date(), endedBy: input.actorId, endReason: input.reason }
      });
    }
  }
  const assignment = { ...identity, ...state };
  try {
    return await tx.roleAssignment.create({ data: assignment });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const concurrent = await tx.roleAssignment.findFirst({ where: { ...identity, OR: [{ active: true }, { activationPending: true }] } });
    if (concurrent) return concurrent;
    throw error;
  }
}

export async function revokeRole(tx: Tx, input: { roleId: string; actorId: string; reason: string }) {
  const role = await tx.roleAssignment.findUniqueOrThrow({ where: { id: input.roleId } });
  if (!role.active && !role.activationPending) return role;
  return tx.roleAssignment.update({
    where: { id: input.roleId },
    data: { active: false, activationPending: false, endedAt: new Date(), endedBy: input.actorId, endReason: input.reason }
  });
}

export async function activatePendingRoles(tx: Tx, input: { personId: string; accountId: string; actorId: string }) {
  const pending = await tx.roleAssignment.findMany({ where: { personId: input.personId, activationPending: true }, orderBy: { createdAt: "asc" } });
  for (const role of pending) {
    if (role.role === "org_leader" && role.scopeType === "organization") {
      await tx.roleAssignment.updateMany({
        where: { role: "org_leader", scopeType: "organization", scopeId: role.scopeId, active: true, id: { not: role.id } },
        data: { active: false, endedAt: new Date(), endedBy: input.actorId, endReason: "新负责人账号已激活" }
      });
    }
    await tx.roleAssignment.update({ where: { id: role.id }, data: { accountId: input.accountId, active: true, activationPending: false } });
  }
  return pending.length;
}

export async function disablePerson(tx: Tx, input: { personId: string; actorId: string; reason: string }) {
  const now = new Date();
  const person = await tx.person.update({ where: { id: input.personId }, data: { status: "disabled" } });
  const accounts = await tx.account.findMany({ where: { personId: input.personId }, select: { id: true } });
  const accountIds = accounts.map(({ id }) => id);
  if (accountIds.length) {
    await tx.account.updateMany({ where: { id: { in: accountIds } }, data: { status: "disabled", sessionVersion: { increment: 1 } } });
    await tx.refreshSession.updateMany({ where: { accountId: { in: accountIds }, revokedAt: null }, data: { revokedAt: now } });
  }
  await tx.roleAssignment.updateMany({
    where: { personId: input.personId, OR: [{ active: true }, { activationPending: true }] },
    data: { active: false, activationPending: false, endedAt: now, endedBy: input.actorId, endReason: input.reason }
  });
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

export async function assertAccountMergeCandidate(tx: Tx, input: { sourceAccountId: string; targetAccountId: string; actorId: string; automaticEmptySource?: boolean }) {
  const [source, target] = await Promise.all([
    tx.account.findUniqueOrThrow({ where: { id: input.sourceAccountId }, include: { roles: { where: { active: true } }, preferences: true, wechatBindings: { where: { active: true }, select: { appId: true } } } }),
    tx.account.findUniqueOrThrow({ where: { id: input.targetAccountId }, include: { person: { select: { status: true } }, wechatBindings: { where: { active: true }, select: { appId: true } } } })
  ]);
  const activeCompanyAdminCount = await tx.account.count({ where: { status: "active", roles: { some: { active: true, role: "company_admin", scopeType: "company" } } } });
  assertAccountMergeAllowed({
    actorId: input.actorId,
    sourceId: source.id,
    targetId: target.id,
    sourceStatus: source.status,
    targetStatus: target.status,
    sourcePersonId: source.personId,
    targetPersonId: target.personId,
    targetPersonStatus: target.person?.status ?? null,
    sourceVerifiedPhone: source.verifiedPhone,
    targetVerifiedPhone: target.verifiedPhone,
    sourceUsername: source.username,
    targetUsername: target.username,
    sourcePassword: Boolean(source.passwordHash),
    targetPassword: Boolean(target.passwordHash),
    sourceActiveWechatAppIds: source.wechatBindings.map(({ appId }) => appId),
    targetActiveWechatAppIds: target.wechatBindings.map(({ appId }) => appId),
    sourceIsCompanyAdmin: source.roles.some(({ role, scopeType }) => role === "company_admin" && scopeType === "company"),
    activeCompanyAdminCount,
    ...(input.automaticEmptySource ? { automaticEmptySource: true } : {})
  });
  return { source, target };
}

export async function mergeAccounts(tx: Tx, input: { sourceAccountId: string; targetAccountId: string; actorId: string; reason: string; automaticEmptySource?: boolean }) {
  const { source, target } = await assertAccountMergeCandidate(tx, input);

  const now = new Date();
  for (const role of source.roles) {
    await tx.roleAssignment.update({ where: { id: role.id }, data: { accountId: target.id } });
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
    data: { username: null, usernameNormalized: null, passwordHash: null, passwordLoginEnabled: false, verifiedPhone: null, personId: null, status: "merged", mergedIntoAccountId: target.id, mergedAt: now, sessionVersion: { increment: 1 } }
  });
  await tx.account.update({
    where: { id: target.id },
    data: {
      status: "active",
      personId: target.personId ?? source.personId,
      verifiedPhone: target.verifiedPhone ?? source.verifiedPhone,
      username: target.username ?? source.username,
      usernameNormalized: target.usernameNormalized ?? source.usernameNormalized,
      passwordHash: target.passwordHash ?? source.passwordHash,
      passwordLoginEnabled: target.passwordLoginEnabled || source.passwordLoginEnabled,
      mustChangePassword: target.passwordHash ? target.mustChangePassword : source.mustChangePassword,
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
    await activatePendingRoles(tx, { personId: input.personId, accountId: current.id, actorId: current.id });
    return { status: "bound" as const, accountId: current.id };
  }
  if (await isEmptyAccount(tx, current.id)) {
    const accountId = await mergeAccounts(tx, { sourceAccountId: current.id, targetAccountId: existing.id, actorId: current.id, reason: input.reason, automaticEmptySource: true });
    return { status: "bound" as const, accountId };
  }
  const request = await requestAccountMerge(tx, { sourceAccountId: current.id, targetAccountId: existing.id, personId: input.personId, reason: input.reason });
  return { status: "pending_merge" as const, requestId: request.id, targetAccountId: existing.id };
}
