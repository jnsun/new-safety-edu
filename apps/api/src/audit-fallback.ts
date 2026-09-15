import { z } from "zod";

const fallbackSchema = z.object({
  id: z.string().uuid(), actorId: z.string().uuid().nullable(), action: z.string().min(1).max(160),
  objectType: z.string().min(1).max(120), objectId: z.string().uuid().nullable(), result: z.string().min(1).max(40),
  metadata: z.unknown().optional(), createdAt: z.string().datetime()
});

export function parseAuditFallbackLine(line: string) {
  const row = fallbackSchema.parse(JSON.parse(line));
  return { ...row, createdAt: new Date(row.createdAt) };
}
