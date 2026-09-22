import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";
import { Prisma, type OrganizationType, type RoleName, type ScopeType } from "@prisma/client";
import { prisma } from "./db.js";
import type { Env } from "./env.js";
import { sessionAbsoluteTtlMs } from "./auth-security.js";
import { sha256 } from "./crypto.js";
import { assertSensitiveTokenScope, type SensitiveTokenScope } from "./sensitive-token-scope.js";
import { assertFirstReleaseEmployee } from "./first-release-policy.js";

export type Principal = {
  accountId: string;
  personId: string | null;
  mustChangePassword: boolean;
  sessionId: string | null;
  roles: Array<{ role: RoleName; scopeType: ScopeType; scopeId: string | null; organizationType?: OrganizationType }>;
};

const unauthorized = () => Object.assign(new Error("未登录或会话已失效"), { statusCode: 401, code: "UNAUTHORIZED" });

async function signAccessToken(accountId: string, sessionVersion: number, sessionId: string | null, env: Env) {
  return new SignJWT({ ver: sessionVersion, ...(sessionId ? { sid: sessionId } : {}) }).setProtectedHeader({ alg: "HS256" }).setSubject(accountId).setIssuedAt().setExpirationTime("15m")
    .sign(new TextEncoder().encode(env.JWT_SECRET));
}

export async function issueAccessToken(accountId: string, env: Env, sessionId: string | null = null): Promise<string> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { sessionVersion: true } });
  return signAccessToken(accountId, account.sessionVersion, sessionId, env);
}

export async function issueSensitiveToken(accountId: string, env: Env, scope?: SensitiveTokenScope): Promise<string> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { sessionVersion: true } });
  return new SignJWT({ ver: account.sessionVersion, purpose: "sensitive", ...(scope ? { sensitiveTargetPersonId: scope.targetPersonId, sensitiveField: scope.field, sensitiveAction: scope.action } : {}) }).setProtectedHeader({ alg: "HS256" }).setSubject(accountId).setIssuedAt().setExpirationTime("5m")
    .sign(new TextEncoder().encode(env.JWT_SECRET));
}

export async function verifySensitiveToken(request: FastifyRequest, env: Env, expectedScope?: SensitiveTokenScope) {
  const token = request.headers["x-sensitive-token"];
  if (typeof token !== "string" || !request.principal) throw Object.assign(new Error("查看完整敏感信息前请再次验证"), { statusCode: 401, code: "SENSITIVE_REAUTH_REQUIRED" });
  try {
    const result = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET));
    if (result.payload.sub !== request.principal.accountId || result.payload.purpose !== "sensitive") throw new Error("invalid sensitive token");
    if (expectedScope) assertSensitiveTokenScope(result.payload, expectedScope);
    const account = await prisma.account.findUnique({ where: { id: request.principal.accountId }, select: { status: true, sessionVersion: true } });
    if (!account || account.status !== "active" || result.payload.ver !== account.sessionVersion) throw new Error("stale sensitive token");
  } catch {
    throw Object.assign(new Error("再次验证已失效，请重新验证"), { statusCode: 401, code: "SENSITIVE_REAUTH_REQUIRED" });
  }
}

export async function issueSession(accountId: string, env: Env, context: { clientKind?: string | undefined; loginMethod?: string | undefined; userAgent?: string | undefined } = {}) {
  const refreshToken = randomBytes(48).toString("base64url");
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { sessionVersion: true, personId: true, person: { select: { type: true } } } });
  if (account.personId) assertFirstReleaseEmployee(account.person?.type);
  const absoluteExpiresAt = new Date(Date.now() + sessionAbsoluteTtlMs(context.clientKind));
  const session = await prisma.refreshSession.create({ data: { accountId, tokenHash: sha256(refreshToken), clientKind: context.clientKind ?? null, loginMethod: context.loginMethod ?? null, userAgent: context.userAgent?.slice(0, 500) ?? null, expiresAt: absoluteExpiresAt, absoluteExpiresAt } });
  const accessToken = await signAccessToken(accountId, account.sessionVersion, session.id, env);
  return { accessToken, refreshToken, expiresIn: 900 };
}

export function authHandlers(env: Env) {
  return {
    async authenticate(request: FastifyRequest) {
      const bearer = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : undefined;
      const token = bearer ?? request.cookies.safety_session;
      if (!token) throw unauthorized();
      let accountId: string; let sessionVersion = -1; let sessionId: string | null = null;
      try {
        const result = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET));
        if (!result.payload.sub) throw unauthorized();
        accountId = result.payload.sub; sessionVersion = typeof result.payload.ver === "number" ? result.payload.ver : -1; sessionId = typeof result.payload.sid === "string" ? result.payload.sid : null;
      } catch {
        throw unauthorized();
      }
      const account = await prisma.account.findUnique({
        where: { id: accountId },
        include: { person: { select: { status: true, type: true } } }
      });
      if (!account || !["active", "pending"].includes(account.status) || account.sessionVersion !== sessionVersion || (account.personId && account.person?.status !== "active")) throw unauthorized();
      if (account.personId) {
        try { assertFirstReleaseEmployee(account.person?.type); } catch { throw unauthorized(); }
      }
      if (sessionId && !await prisma.refreshSession.findFirst({ where: { id: sessionId, accountId: account.id, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } })) throw unauthorized();
      const path = request.url.split("?", 1)[0];
      if (account.status === "pending") {
        const pendingAllowed = ["/api/auth/me", "/api/auth/logout", "/api/auth/logout-all", "/api/wechat/registration-options", "/api/wechat/identity/phone-code", "/api/wechat/identity/phone-verify", "/api/wechat/identity/wechat-phone", "/api/wechat/identity/confirm", "/api/wechat/registration-requests", "/api/me/change-requests"];
        if (!pendingAllowed.includes(path ?? "") && !/^\/api\/me\/change-requests\/[0-9a-f-]+\/withdraw$/i.test(path ?? "") && path !== "/api/files") {
          throw Object.assign(new Error("账号身份尚待绑定或审核"), { statusCode: 403, code: "ACCOUNT_PENDING" });
        }
      }
      if (account.mustChangePassword && !["/api/auth/me", "/api/auth/change-password", "/api/auth/logout"].includes(path ?? "")) {
        throw Object.assign(new Error("首次登录必须先修改临时密码"), { statusCode: 403, code: "PASSWORD_CHANGE_REQUIRED" });
      }
      const roles = await prisma.roleAssignment.findMany({
        where: account.personId
          ? { personId: account.personId, active: true }
          : { accountId: account.id, personId: null, active: true },
        select: { role: true, scopeType: true, scopeId: true }
      });
      const organizationIds = roles.filter((role) => role.scopeType === "organization" && role.scopeId).map((role) => role.scopeId as string);
      const organizationTypes = new Map((organizationIds.length ? await prisma.organization.findMany({ where: { id: { in: organizationIds } }, select: { id: true, type: true } }) : []).map((organization) => [organization.id, organization.type]));
      request.principal = { accountId: account.id, personId: account.personId, mustChangePassword: account.mustChangePassword, sessionId, roles: roles.map((role) => { const organizationType = role.scopeType === "organization" && role.scopeId ? organizationTypes.get(role.scopeId) : undefined; return organizationType ? { ...role, organizationType } : role; }) };
    },
    async requireManager(request: FastifyRequest, _reply: FastifyReply) {
      if (!request.principal?.roles.some(({ role }) => ["company_admin", "org_leader", "org_admin", "project_admin"].includes(role))) {
        throw Object.assign(new Error("无管理权限"), { statusCode: 403, code: "FORBIDDEN" });
      }
    }
  };
}

export async function rotateRefreshToken(refreshToken: string, env: Env) {
  const session = await prisma.refreshSession.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { account: { include: { person: { select: { type: true } } } } } });
  if (!session || session.expiresAt <= new Date() || !["active", "pending"].includes(session.account.status)) throw unauthorized();
  if (session.account.personId) {
    try { assertFirstReleaseEmployee(session.account.person?.type); } catch { throw unauthorized(); }
  }
  if (session.revokedAt) {
    await prisma.$transaction([
      prisma.refreshSession.updateMany({ where: { accountId: session.accountId, ...(session.familyId ? { OR: [{ familyId: session.familyId }, { id: session.familyId }] } : {}) }, data: { revokedAt: new Date() } }),
      prisma.account.update({ where: { id: session.accountId }, data: { sessionVersion: { increment: 1 } } })
    ]);
    throw unauthorized();
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date(), lastUsedAt: new Date() } });
      if (claimed.count !== 1) throw Object.assign(new Error("refresh token reused"), { code: "REFRESH_TOKEN_REUSED" });
      const next = randomBytes(48).toString("base64url");
      const nextSession = await tx.refreshSession.create({ data: { accountId: session.accountId, tokenHash: sha256(next), clientKind: session.clientKind, loginMethod: session.loginMethod, userAgent: session.userAgent, familyId: session.familyId ?? session.id, rotatedFromId: session.id, expiresAt: session.absoluteExpiresAt, absoluteExpiresAt: session.absoluteExpiresAt } });
      return { accessToken: await signAccessToken(session.accountId, session.account.sessionVersion, nextSession.id, env), refreshToken: next, expiresIn: 900 };
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") && (!error || typeof error !== "object" || !("code" in error) || error.code !== "REFRESH_TOKEN_REUSED")) throw error;
    await prisma.$transaction([
      prisma.refreshSession.updateMany({ where: { accountId: session.accountId, OR: [{ id: session.familyId ?? session.id }, { familyId: session.familyId ?? session.id }] }, data: { revokedAt: new Date() } }),
      prisma.account.update({ where: { id: session.accountId }, data: { sessionVersion: { increment: 1 } } })
    ]);
    throw unauthorized();
  }
}
