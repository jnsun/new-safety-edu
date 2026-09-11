import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";
import type { RoleName, ScopeType } from "@prisma/client";
import { prisma } from "./db.js";
import type { Env } from "./env.js";
import { sha256 } from "./crypto.js";

export type Principal = {
  accountId: string;
  personId: string | null;
  roles: Array<{ role: RoleName; scopeType: ScopeType; scopeId: string | null }>;
};

const unauthorized = () => Object.assign(new Error("未登录或会话已失效"), { statusCode: 401, code: "UNAUTHORIZED" });

export async function issueAccessToken(accountId: string, env: Env): Promise<string> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { sessionVersion: true } });
  return new SignJWT({ ver: account.sessionVersion }).setProtectedHeader({ alg: "HS256" }).setSubject(accountId).setIssuedAt().setExpirationTime("15m")
    .sign(new TextEncoder().encode(env.JWT_SECRET));
}

export async function issueSession(accountId: string, env: Env) {
  const accessToken = await issueAccessToken(accountId, env);
  const refreshToken = randomBytes(48).toString("base64url");
  await prisma.refreshSession.create({ data: { accountId, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + 30 * 86400_000) } });
  return { accessToken, refreshToken, expiresIn: 900 };
}

export function authHandlers(env: Env) {
  return {
    async authenticate(request: FastifyRequest) {
      const bearer = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : undefined;
      const token = bearer ?? request.cookies.safety_session;
      if (!token) throw unauthorized();
      let accountId: string; let sessionVersion = -1;
      try {
        const result = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET));
        if (!result.payload.sub) throw unauthorized();
        accountId = result.payload.sub; sessionVersion = typeof result.payload.ver === "number" ? result.payload.ver : -1;
      } catch {
        throw unauthorized();
      }
      const account = await prisma.account.findUnique({
        where: { id: accountId },
        include: { roles: { where: { active: true }, select: { role: true, scopeType: true, scopeId: true } } }
      });
      if (!account || account.status !== "active" || account.sessionVersion !== sessionVersion) throw unauthorized();
      request.principal = { accountId: account.id, personId: account.personId, roles: account.roles };
    },
    async requireManager(request: FastifyRequest, _reply: FastifyReply) {
      if (!request.principal?.roles.some(({ role }) => role !== "learner")) {
        throw Object.assign(new Error("无管理权限"), { statusCode: 403, code: "FORBIDDEN" });
      }
    }
  };
}

export async function rotateRefreshToken(refreshToken: string, env: Env) {
  const session = await prisma.refreshSession.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { account: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.account.status !== "active") throw unauthorized();
  return prisma.$transaction(async (tx) => {
    await tx.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    const next = randomBytes(48).toString("base64url");
    await tx.refreshSession.create({ data: { accountId: session.accountId, tokenHash: sha256(next), expiresAt: new Date(Date.now() + 30 * 86400_000) } });
    return { accessToken: await issueAccessToken(session.accountId, env), refreshToken: next, expiresIn: 900 };
  });
}
