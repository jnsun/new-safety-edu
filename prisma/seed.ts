import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!username || !password || password.length < 12) {
    throw new Error("请设置 ADMIN_BOOTSTRAP_USERNAME 和至少 12 位的 ADMIN_BOOTSTRAP_PASSWORD");
  }

  const existing = await prisma.account.findUnique({ where: { username } });
  if (existing) throw new Error("管理员用户名已存在，bootstrap 未重复执行");
  const account = await prisma.account.create({
    data: { username, passwordHash: await argon2.hash(password), roles: { create: { role: "company_admin", scopeType: "company" } } },
    select: { id: true, username: true }
  });
  console.log(`首个 company_admin 已创建：${account.username} (${account.id})`);
  console.log("请立即删除 ADMIN_BOOTSTRAP_PASSWORD 环境变量，并在首次登录后改密。");
}

main().finally(() => prisma.$disconnect());
