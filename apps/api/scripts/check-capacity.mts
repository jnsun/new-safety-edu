import { readdir, stat, statfs } from "node:fs/promises";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db.js";
import { loadEnv } from "../src/env.js";

async function folder(path: string): Promise<{ files: number; bytes: number }> {
  let files = 0; let bytes = 0;
  for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) { const child = resolve(path, entry.name); if (entry.isDirectory()) { const nested = await folder(child); files += nested.files; bytes += nested.bytes; } else if (entry.isFile()) { files += 1; bytes += (await stat(child)).size; } }
  return { files, bytes };
}

const env = loadEnv(); const uploadRoot = resolve(env.UPLOAD_ROOT); const [uploads, disk, database] = await Promise.all([folder(uploadRoot), statfs(uploadRoot), prisma.$queryRaw<Array<{ bytes: bigint }>>(Prisma.sql`SELECT pg_database_size(current_database()) AS bytes`)]);
const usedRatio = 1 - Number(disk.bavail) / Number(disk.blocks); const threshold = Number(process.env.CAPACITY_WARNING_PERCENT ?? 80) / 100;
process.stdout.write(`${JSON.stringify({ databaseBytes: Number(database[0]?.bytes ?? 0), uploadFiles: uploads.files, uploadBytes: uploads.bytes, diskUsedPercent: Math.round(usedRatio * 1000) / 10, warning: usedRatio >= threshold })}\n`); await prisma.$disconnect();
