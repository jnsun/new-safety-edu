import type { Prisma } from "@prisma/client";

type AuditWriter = Pick<Prisma.TransactionClient, "auditLog" | "account">;

export type CriticalAuditEvent = {
  actorId: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  requestId?: string | null;
  actorRole?: string | null;
  actorScopeType?: string | null;
  actorScopeId?: string | null;
  reason?: string | null;
  result?: string;
  metadata?: Prisma.InputJsonValue;
};

export async function writeCriticalAudit(tx: AuditWriter, event: CriticalAuditEvent) {
  if (event.actorId) {
    const actor = await tx.account.findUnique({ where: { id: event.actorId }, select: { status: true, personId: true, person: { select: { status: true } } } });
    if (!actor || actor.status !== "active" || (actor.personId && actor.person?.status !== "active")) {
      throw Object.assign(new Error("操作者账号或人员状态已变化，请重新登录"), { statusCode: 409, code: "ACTOR_STATE_CHANGED" });
    }
  }
  const metadata = event.reason
    ? ({ ...(event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata) ? event.metadata : {}), reason: event.reason } as Prisma.InputJsonValue)
    : event.metadata;
  return tx.auditLog.create({ data: {
    actorId: event.actorId,
    action: event.action,
    objectType: event.objectType,
    objectId: event.objectId ?? null,
    requestId: event.requestId ?? null,
    actorRole: event.actorRole ?? null,
    actorScopeType: event.actorScopeType ?? null,
    actorScopeId: event.actorScopeId ?? null,
    result: event.result ?? "success",
    ...(metadata === undefined ? {} : { metadata })
  } });
}
