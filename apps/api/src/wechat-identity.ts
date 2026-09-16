import type { Prisma } from "@prisma/client";

export type WechatIdentity = { appId: string; openid: string; unionid?: string };

export async function resolveWechatAccount(tx: Prisma.TransactionClient, identity: WechatIdentity) {
  const lockKey = identity.unionid ? `unionid:${identity.unionid}` : `openid:${identity.appId}:${identity.openid}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

  const exact = await tx.wechatBinding.findFirst({
    where: { appId: identity.appId, openid: identity.openid, active: true },
    include: { account: true }
  });
  if (exact) {
    if (identity.unionid && exact.unionid && exact.unionid !== identity.unionid) throw identityConflict();
    if (identity.unionid && await tx.wechatBinding.findFirst({ where: { unionid: identity.unionid, active: true, accountId: { not: exact.accountId } }, select: { id: true } })) throw identityConflict();
    if (identity.unionid && !exact.unionid) await tx.wechatBinding.update({ where: { id: exact.id }, data: { unionid: identity.unionid } });
    return { bindingId: exact.id, account: exact.account, existing: true };
  }

  if (identity.unionid) {
    const unionBindings = await tx.wechatBinding.findMany({ where: { unionid: identity.unionid, active: true }, include: { account: true }, take: 3 });
    const accountIds = new Set(unionBindings.map(({ accountId }) => accountId));
    if (accountIds.size > 1) throw identityConflict();
    if (unionBindings[0]) {
      const binding = await tx.wechatBinding.create({ data: { ...identity, unionid: identity.unionid, accountId: unionBindings[0].accountId, active: true, boundAt: unionBindings[0].account.personId ? new Date() : null } });
      return { bindingId: binding.id, account: unionBindings[0].account, existing: true };
    }
  }

  const account = await tx.account.create({ data: { status: "pending" } });
  const binding = await tx.wechatBinding.create({ data: { ...identity, unionid: identity.unionid ?? null, accountId: account.id, active: true } });
  return { bindingId: binding.id, account, existing: false };
}

export async function attachProvisionalWechatAccount(tx: Prisma.TransactionClient, input: {
  provisionalAccountId: string;
  personId: string;
  verifiedPhone: string;
  actorId: string;
  reason: string;
}) {
  const [source, target] = await Promise.all([
    tx.account.findUniqueOrThrow({
      where: { id: input.provisionalAccountId },
      include: {
        wechatBindings: { where: { active: true } },
        _count: { select: { roles: true, preferences: true, usernameHistory: true, sensitiveExportJobs: true, securityEvents: true, mergedAccounts: true } }
      }
    }),
    tx.account.findUnique({ where: { personId: input.personId } })
  ]);
  if (source.personId && source.personId !== input.personId) throw Object.assign(new Error("当前微信已绑定其他人员"), { statusCode: 409, code: "WECHAT_PERSON_CONFLICT" });
  const accountId = target?.id ?? source.id;
  const now = new Date();
  if (target && !["active", "pending"].includes(target.status)) throw Object.assign(new Error("目标账号不可直接绑定，请由公司管理员处理账号状态"), { statusCode: 409, code: "TARGET_ACCOUNT_UNAVAILABLE" });

  if (target && target.id !== source.id) {
    if (source.status !== "pending" || source.personId || source.username || source.passwordHash || source.verifiedPhone || Object.values(source._count).some(Boolean)) throw identityConflict();
    await tx.wechatBinding.updateMany({
      where: { accountId: target.id, active: true },
      data: { active: false, endedAt: now, endedBy: input.actorId, endReason: input.reason }
    });
    for (const incoming of source.wechatBindings) {
      await tx.wechatBinding.update({ where: { id: incoming.id }, data: { accountId: target.id, boundAt: now } });
    }
    await tx.refreshSession.updateMany({ where: { accountId: { in: [source.id, target.id] }, revokedAt: null }, data: { revokedAt: now } });
    await tx.account.update({ where: { id: source.id }, data: { status: "merged", mergedIntoAccountId: target.id, mergedAt: now, sessionVersion: { increment: 1 } } });
  } else {
    await tx.wechatBinding.updateMany({ where: { accountId: source.id, active: true }, data: { boundAt: now } });
  }

  const phoneOwner = await tx.account.findFirst({ where: { verifiedPhone: input.verifiedPhone, id: { not: accountId } }, select: { id: true } });
  if (phoneOwner) throw Object.assign(new Error("手机号已绑定其他账号"), { statusCode: 409, code: "PHONE_ACCOUNT_CONFLICT" });
  await tx.account.update({ where: { id: accountId }, data: { personId: input.personId, verifiedPhone: input.verifiedPhone, status: "active", sessionVersion: { increment: 1 } } });
  return accountId;
}

function identityConflict(): never {
  throw Object.assign(new Error("微信身份存在账号冲突，需要公司管理员处理"), { statusCode: 409, code: "WECHAT_IDENTITY_CONFLICT" });
}
