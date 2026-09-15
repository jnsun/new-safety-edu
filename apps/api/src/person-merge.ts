import { Prisma } from "@prisma/client";
import { assertPersonMergeAllowed } from "./person-merge-policy.js";
import { changeRequestKey } from "./request-policy.js";

type Tx = Prisma.TransactionClient;

export async function assertPersonMergeCandidate(tx: Tx, input: { sourcePersonId: string; targetPersonId: string; actorPersonId: string | null }) {
  const include = {
    account: { select: { id: true } },
    organizations: { where: { active: true, primary: true }, take: 1, select: { organizationId: true, organization: { select: { name: true } } } },
    _count: { select: { assignments: true, certificates: true, projectMemberships: true, signatures: true } }
  } satisfies Prisma.PersonInclude;
  const [source, target] = await Promise.all([
    tx.person.findUniqueOrThrow({ where: { id: input.sourcePersonId }, include }),
    tx.person.findUniqueOrThrow({ where: { id: input.targetPersonId }, include })
  ]);
  assertPersonMergeAllowed({
    actorPersonId: input.actorPersonId,
    sourceId: source.id,
    targetId: target.id,
    sourceStatus: source.status,
    targetStatus: target.status,
    sourceType: source.type,
    targetType: target.type,
    sourcePhone: source.phone,
    targetPhone: target.phone,
    sourceNationalIdHash: source.nationalIdHash,
    targetNationalIdHash: target.nationalIdHash,
    sourcePrimaryOrganizationId: source.organizations[0]?.organizationId ?? null,
    targetPrimaryOrganizationId: target.organizations[0]?.organizationId ?? null,
    sourceHasAccount: Boolean(source.account),
    targetHasAccount: Boolean(target.account)
  });
  return { source, target };
}

export async function requestPersonMerge(tx: Tx, input: { sourcePersonId: string; targetPersonId: string; actorPersonId: string | null; accountId: string; reason: string }) {
  await assertPersonMergeCandidate(tx, input);
  const requestKey = changeRequestKey("person_merge", input.sourcePersonId, input.targetPersonId);
  const existing = await tx.changeRequest.findFirst({ where: { type: "person_merge", status: "pending", requestKey } });
  if (existing) return existing;
  try {
    return await tx.changeRequest.create({ data: { personId: input.sourcePersonId, accountId: input.accountId, type: "person_merge", requestKey, payload: { targetPersonId: input.targetPersonId, reason: input.reason } } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    return tx.changeRequest.findFirstOrThrow({ where: { type: "person_merge", status: "pending", requestKey } });
  }
}

export async function mergePersons(tx: Tx, input: { sourcePersonId: string; targetPersonId: string; actorAccountId: string; actorPersonId: string | null; reason: string }) {
  const { source, target } = await assertPersonMergeCandidate(tx, input);
  const now = new Date();
  const effectiveAccountId = target.account?.id ?? source.account?.id ?? null;

  if (source.account && !target.account) {
    await tx.account.update({ where: { id: source.account.id }, data: { personId: target.id } });
  }

  const sourceRoles = await tx.roleAssignment.findMany({ where: { personId: source.id, OR: [{ active: true }, { activationPending: true }] } });
  for (const role of sourceRoles) {
    const duplicate = await tx.roleAssignment.findFirst({ where: { personId: target.id, role: role.role, scopeType: role.scopeType, scopeId: role.scopeId, OR: [{ active: true }, { activationPending: true }] } });
    if (duplicate) {
      await tx.roleAssignment.update({ where: { id: role.id }, data: { active: false, activationPending: false, endedAt: now, endedBy: input.actorAccountId, endReason: "重复人员档案合并" } });
    } else {
      await tx.roleAssignment.update({ where: { id: role.id }, data: { personId: target.id, ...(effectiveAccountId ? { accountId: effectiveAccountId, active: true, activationPending: false } : {}) } });
    }
  }

  const memberships = await tx.organizationMembership.findMany({ where: { personId: source.id, active: true } });
  for (const membership of memberships) {
    const duplicate = await tx.organizationMembership.findFirst({ where: { personId: target.id, organizationId: membership.organizationId, primary: membership.primary, active: true } });
    if (duplicate) await tx.organizationMembership.update({ where: { id: membership.id }, data: { active: false, endedAt: now, endedBy: input.actorAccountId, endReason: "重复人员档案合并" } });
    else await tx.organizationMembership.update({ where: { id: membership.id }, data: { personId: target.id } });
  }

  const projectMemberships = await tx.projectMember.findMany({ where: { personId: source.id, status: { in: ["pending", "active", "approved"] } } });
  for (const membership of projectMemberships) {
    const duplicate = await tx.projectMember.findFirst({ where: { personId: target.id, projectId: membership.projectId, status: { in: ["pending", "active", "approved"] } } });
    if (duplicate) await tx.projectMember.update({ where: { id: membership.id }, data: { status: "ended", endedAt: now, endedBy: input.actorAccountId, endReason: "重复人员档案合并" } });
    else await tx.projectMember.update({ where: { id: membership.id }, data: { personId: target.id } });
  }

  const assignments = await tx.trainingAssignment.findMany({ where: { personId: source.id, status: { notIn: ["completed", "cancelled"] } } });
  for (const assignment of assignments) {
    const duplicate = await tx.trainingAssignment.findUnique({ where: { batchId_personId: { batchId: assignment.batchId, personId: target.id } } });
    if (duplicate) await tx.trainingAssignment.update({ where: { id: assignment.id }, data: { status: "cancelled", cancelledAt: now } });
    else await tx.trainingAssignment.update({ where: { id: assignment.id }, data: { personId: target.id } });
  }

  await tx.personCertificate.updateMany({ where: { personId: source.id }, data: { personId: target.id } });
  await tx.notification.updateMany({ where: { personId: source.id }, data: { personId: target.id } });
  await tx.changeRequest.updateMany({ where: { personId: source.id, status: "pending", type: { not: "person_merge" } }, data: { status: "cancelled", reviewedBy: input.actorAccountId, reviewedAt: now, reviewNote: "人员档案合并后取消原申请" } });
  if (effectiveAccountId) {
    await tx.account.update({ where: { id: effectiveAccountId }, data: { sessionVersion: { increment: 1 } } });
    await tx.refreshSession.updateMany({ where: { accountId: effectiveAccountId, revokedAt: null }, data: { revokedAt: now } });
  }

  const moveNationalId = !target.nationalIdHash && Boolean(source.nationalIdHash);
  if (moveNationalId) await tx.person.update({ where: { id: source.id }, data: { nationalIdCipher: null, nationalIdIv: null, nationalIdTag: null, nationalIdHash: null, nationalIdLast4: null } });
  await tx.person.update({ where: { id: target.id }, data: {
    ...(moveNationalId ? { nationalIdCipher: source.nationalIdCipher, nationalIdIv: source.nationalIdIv, nationalIdTag: source.nationalIdTag, nationalIdHash: source.nationalIdHash, nationalIdLast4: source.nationalIdLast4 } : {}),
    ...(!target.photoFileId && source.photoFileId ? { photoFileId: source.photoFileId } : {})
  } });
  await tx.person.update({ where: { id: source.id }, data: { status: "merged", mergedIntoPersonId: target.id, mergedAt: now, mergedBy: input.actorAccountId, mergeReason: input.reason } });
  return target.id;
}
