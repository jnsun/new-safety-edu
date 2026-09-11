import type { Prisma } from "@prisma/client";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { prisma } from "./db.js";

export function audit(actorId: string | null, action: string, objectType: string, objectId?: string, metadata?: Prisma.InputJsonValue) {
  void prisma.auditLog.create({ data: { actorId, action, objectType, objectId: objectId ?? null, ...(metadata === undefined ? {} : { metadata }) } }).catch((error: unknown) => {
    console.error("audit_log_write_failed", error instanceof Error ? error.message : "unknown");
  });
}

export async function auditCritical(actorId: string | null, action: string, objectType: string, objectId: string | undefined, metadata: Prisma.InputJsonValue | undefined, fallbackPath: string) {
  try {
    await prisma.auditLog.create({ data: { actorId, action, objectType, objectId: objectId ?? null, ...(metadata === undefined ? {} : { metadata }) } });
  } catch {
    await mkdir(dirname(fallbackPath), { recursive: true });
    await appendFile(fallbackPath, `${JSON.stringify({ actorId, action, objectType, objectId, metadata, createdAt: new Date().toISOString() })}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
