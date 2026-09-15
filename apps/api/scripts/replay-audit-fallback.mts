import { readFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db.js";
import { loadEnv } from "../src/env.js";
import { parseAuditFallbackLine } from "../src/audit-fallback.js";

const apply = process.argv.includes("--apply"); const env = loadEnv();
if (env.NODE_ENV === "production" && apply && !process.argv.includes("--confirm-production")) throw new Error("生产补写必须同时传入 --apply --confirm-production");
const path = resolve(process.env.AUDIT_FALLBACK_PATH ?? "var/audit-fallback.ndjson");
let content = ""; try { content = await readFile(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const lines = content.split(/\r?\n/).filter(Boolean); const parsed = []; let invalid = 0;
for (const line of lines) { try { parsed.push(parseAuditFallbackLine(line)); } catch { invalid += 1; } }
if (apply && invalid) throw new Error(`审计补写文件包含 ${invalid} 条无效记录，未做任何修改`);
if (apply && parsed.length) {
  await prisma.auditLog.createMany({ data: parsed.map((row) => ({ id: row.id, actorId: row.actorId, action: row.action, objectType: row.objectType, objectId: row.objectId, result: row.result, ...(row.metadata === undefined ? {} : { metadata: row.metadata as Prisma.InputJsonValue }), createdAt: row.createdAt })), skipDuplicates: true });
  await rename(path, `${path}.replayed-${new Date().toISOString().replace(/[:.]/g, "-")}`);
}
process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "dry-run", valid: parsed.length, invalid })}\n`); await prisma.$disconnect();
