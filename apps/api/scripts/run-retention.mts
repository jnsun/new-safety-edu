import { prisma } from "../src/db.js";
import { loadEnv } from "../src/env.js";
import { cleanupExpiredSensitiveExports } from "../src/sensitive-export.js";
import { runSecurityRetention } from "../src/retention.js";

const apply = process.argv.includes("--apply");
const env = loadEnv();
if (env.NODE_ENV === "production" && apply && !process.argv.includes("--confirm-production")) throw new Error("生产清理必须同时传入 --apply --confirm-production");
const result = await runSecurityRetention(prisma, { apply });
if (apply) await cleanupExpiredSensitiveExports(env);
process.stdout.write(`${JSON.stringify(result)}\n`);
await prisma.$disconnect();
