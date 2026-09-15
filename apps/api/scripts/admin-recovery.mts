import argon2 from "argon2";
import { prisma } from "../src/db.js";
import { loadEnv } from "../src/env.js";
import { assertPasswordAllowed } from "../src/auth-security.js";
import { grantRole } from "../src/identity.js";
import { writeCriticalAudit } from "../src/transaction-audit.js";

const value = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const username = value("--username")?.trim().toLowerCase();
const personId = value("--person-id");
const password = process.env.ADMIN_RECOVERY_PASSWORD;
const env = loadEnv();
if (env.NODE_ENV === "production" && !process.argv.includes("--confirm-production")) throw new Error("生产恢复必须传入 --confirm-production");
if (env.NODE_ENV === "production" && process.platform !== "win32" && process.getuid?.() !== 0) throw new Error("生产恢复只能由服务器 sudo/root 身份执行");
if ((!username && !personId) || !password) throw new Error("需要 --username 或 --person-id，并通过临时环境变量 ADMIN_RECOVERY_PASSWORD 提供密码");

const account = await prisma.account.findFirst({ where: username ? { username } : { personId }, include: { person: true, roles: { where: { active: true, role: "company_admin", scopeType: "company" } } } });
if (!account?.person || account.person.status !== "active" || account.person.type !== "employee") throw new Error("只能恢复已关联的在用正式员工账号");
assertPasswordAllowed(password, { username: account.username, phone: account.person.phone, name: account.person.name });
const activeAdmins = await prisma.account.count({ where: { status: "active", roles: { some: { active: true, role: "company_admin", scopeType: "company" } } } });
if (activeAdmins > 0 && !account.roles.length) throw new Error("仍有有效公司管理员时，只能恢复已有公司管理员");
const passwordHash = await argon2.hash(password);
await prisma.$transaction(async (tx) => {
  await tx.account.update({ where: { id: account.id }, data: { status: "active", passwordHash, passwordLoginEnabled: true, mustChangePassword: true, failedLoginCount: 0, loginLockedUntil: null, sessionVersion: { increment: 1 } } });
  await tx.refreshSession.updateMany({ where: { accountId: account.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!account.roles.length) await grantRole(tx, { personId: account.personId!, role: "company_admin", scopeType: "company", scopeId: null, actorId: account.id, reason: "服务器应急恢复：系统无有效公司管理员" });
  await writeCriticalAudit(tx, { actorId: account.id, action: "account.emergency_recovery", objectType: "account", objectId: account.id, reason: "服务器 sudo 应急恢复", metadata: { grantedCompanyAdmin: !account.roles.length } });
}, { isolationLevel: "Serializable" });
process.stdout.write(`${JSON.stringify({ recoveredAccountId: account.id, mustChangePassword: true, sessionsRevoked: true })}\n`);
await prisma.$disconnect();
