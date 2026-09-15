import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeAuditObjectId(objectId?: string | null) {
  return objectId && uuidPattern.test(objectId) ? objectId : null;
}

export function audit(actorId: string | null, action: string, objectType: string, objectId?: string, metadata?: Prisma.InputJsonValue) {
  const normalizedObjectId = normalizeAuditObjectId(objectId);
  const normalizedMetadata = objectId && !normalizedObjectId
    ? ({ ...(metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}), objectLabel: objectId } as Prisma.InputJsonValue)
    : metadata;
  const data = { id: randomUUID(), actorId, action, objectType, objectId: normalizedObjectId, result: "success", ...(normalizedMetadata === undefined ? {} : { metadata: normalizedMetadata }), createdAt: new Date() };
  void prisma.auditLog.create({ data }).catch(async (error: unknown) => {
    const path = resolve(process.env.AUDIT_FALLBACK_PATH ?? "var/audit-fallback.ndjson");
    try { await mkdir(dirname(path), { recursive: true }); await appendFile(path, `${JSON.stringify({ ...data, createdAt: data.createdAt.toISOString() })}\n`, { encoding: "utf8", mode: 0o600 }); }
    catch { console.error("audit_log_write_failed", error instanceof Error ? error.message : "unknown"); }
  });
}

export async function auditCritical(actorId: string | null, action: string, objectType: string, objectId: string | undefined, metadata: Prisma.InputJsonValue | undefined, fallbackPath: string) {
  void fallbackPath;
  return prisma.auditLog.create({ data: { actorId, action, objectType, objectId: objectId ?? null, ...(metadata === undefined ? {} : { metadata }) } });
}
