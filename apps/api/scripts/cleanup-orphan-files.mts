import { prisma } from "../src/db.js";
import { loadEnv } from "../src/env.js";
import { orphanPrivateFiles, removeOrphanPrivateFile } from "../src/private-file-retention.js";

const env = loadEnv(); const apply = process.argv.includes("--apply");
if (env.NODE_ENV === "production" && apply && !process.argv.includes("--confirm-production")) throw new Error("生产清理必须同时传入 --apply --confirm-production");
const olderThan = new Date(Date.now() - 30 * 86_400_000); const files = await orphanPrivateFiles(prisma, olderThan);
if (apply) for (const file of files) await removeOrphanPrivateFile(prisma, env.UPLOAD_ROOT, file);
process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "dry-run", count: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0), ids: files.map(({ id }) => id) })}\n`);
await prisma.$disconnect();
