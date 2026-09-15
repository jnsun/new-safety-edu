import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { issueSession } from "../auth.js";
import { audit } from "../audit.js";
import { setCsrfCookie } from "../csrf.js";
import { writeCriticalAudit } from "../transaction-audit.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

function configured(env: Env) {
  return Boolean(env.WECHAT_WEB_APP_ID && env.WECHAT_WEB_APP_SECRET && env.WECHAT_WEB_REDIRECT_URI);
}

export async function registerWechatWebAuthRoutes(app: FastifyInstance, deps: { env: Env; authenticate: Guard; requireManager: Guard }) {
  app.get("/api/auth/wechat-web/config", async () => ({ data: { enabled: configured(deps.env) } }));

  app.get("/api/auth/wechat-web/start", async (_request, reply) => {
    if (!configured(deps.env)) throw Object.assign(new Error("网页微信扫码登录尚未配置"), { statusCode: 503, code: "WECHAT_WEB_NOT_CONFIGURED" });
    const state = randomBytes(24).toString("base64url");
    reply.setCookie("wechat_oauth_state", state, { httpOnly: true, secure: deps.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/wechat-web", maxAge: 600 });
    const url = new URL("https://open.weixin.qq.com/connect/qrconnect");
    url.searchParams.set("appid", deps.env.WECHAT_WEB_APP_ID!); url.searchParams.set("redirect_uri", deps.env.WECHAT_WEB_REDIRECT_URI!);
    url.searchParams.set("response_type", "code"); url.searchParams.set("scope", "snsapi_login"); url.searchParams.set("state", state);
    return reply.redirect(`${url.toString()}#wechat_redirect`);
  });

  app.get("/api/auth/wechat-web/bind/start", { preHandler: [deps.authenticate, deps.requireManager] }, async (request, reply) => {
    if (!configured(deps.env)) throw Object.assign(new Error("网页微信扫码登录尚未配置"), { statusCode: 503, code: "WECHAT_WEB_NOT_CONFIGURED" });
    const state = randomBytes(24).toString("base64url");
    reply.setCookie("wechat_oauth_state", state, { httpOnly: true, secure: deps.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/wechat-web", maxAge: 600 });
    reply.setCookie("wechat_oauth_bind", `${state}:${request.principal!.accountId}`, { signed: true, httpOnly: true, secure: deps.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/wechat-web", maxAge: 600 });
    const url = new URL("https://open.weixin.qq.com/connect/qrconnect");
    url.searchParams.set("appid", deps.env.WECHAT_WEB_APP_ID!); url.searchParams.set("redirect_uri", deps.env.WECHAT_WEB_REDIRECT_URI!); url.searchParams.set("response_type", "code"); url.searchParams.set("scope", "snsapi_login"); url.searchParams.set("state", state);
    return reply.redirect(`${url.toString()}#wechat_redirect`);
  });

  app.get("/api/auth/wechat-web/callback", async (request, reply) => {
    if (!configured(deps.env)) return reply.redirect("/login?wechat=not_configured");
    const input = z.object({ code: z.string().min(1).max(300), state: z.string().min(20).max(100) }).safeParse(request.query);
    if (!input.success || !request.cookies.wechat_oauth_state || input.data.state !== request.cookies.wechat_oauth_state) return reply.redirect("/login?wechat=invalid_state");
    reply.clearCookie("wechat_oauth_state", { path: "/api/auth/wechat-web" });
    const url = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
    url.searchParams.set("appid", deps.env.WECHAT_WEB_APP_ID!); url.searchParams.set("secret", deps.env.WECHAT_WEB_APP_SECRET!);
    url.searchParams.set("code", input.data.code); url.searchParams.set("grant_type", "authorization_code");
    const response = await fetch(url); const body = await response.json() as { unionid?: string; openid?: string; errcode?: number };
    if (!response.ok || !body.unionid) return reply.redirect("/login?wechat=exchange_failed");
    const bindCookie = request.cookies.wechat_oauth_bind ? request.unsignCookie(request.cookies.wechat_oauth_bind) : null;
    if (bindCookie?.valid) {
      const [bindState, accountId] = bindCookie.value.split(":");
      reply.clearCookie("wechat_oauth_bind", { path: "/api/auth/wechat-web" });
      if (bindState !== input.data.state || !accountId) return reply.redirect("/?wechat=invalid_bind_state");
      try { await deps.authenticate(request, reply); } catch { return reply.redirect("/login?wechat=session_expired"); }
      if (request.principal!.accountId !== accountId) return reply.redirect("/?wechat=account_mismatch");
      const conflict = await prisma.wechatBinding.findFirst({ where: { unionid: body.unionid, active: true, accountId: { not: accountId } }, select: { id: true } });
      if (conflict) return reply.redirect("/?wechat=already_bound");
      await prisma.$transaction(async (tx) => {
        await tx.wechatBinding.upsert({ where: { appId_openid: { appId: deps.env.WECHAT_WEB_APP_ID!, openid: body.openid ?? body.unionid! } }, create: { appId: deps.env.WECHAT_WEB_APP_ID!, openid: body.openid ?? body.unionid!, unionid: body.unionid!, accountId, active: true, boundAt: new Date() }, update: { accountId, unionid: body.unionid!, active: true, boundAt: new Date(), endedAt: null, endedBy: null, endReason: null } });
        await writeCriticalAudit(tx, { actorId: accountId, action: "auth.wechat_web_bind", objectType: "account", objectId: accountId });
      });
      return reply.redirect("/?wechat=bound");
    }
    const binding = await prisma.wechatBinding.findFirst({ where: { unionid: body.unionid, active: true, account: { status: "active", person: { status: "active" }, roles: { some: { active: true, role: { in: ["company_admin", "org_leader", "org_admin", "project_admin"] } } } } }, select: { accountId: true } });
    if (!binding) return reply.redirect("/login?wechat=unbound");
    const session = await issueSession(binding.accountId, deps.env, { clientKind: "web", loginMethod: "wechat", userAgent: request.headers["user-agent"] });
    reply.setCookie("safety_session", session.accessToken, { httpOnly: true, sameSite: "strict", secure: deps.env.NODE_ENV === "production", path: "/", maxAge: 900 });
    reply.setCookie("safety_refresh", session.refreshToken, { httpOnly: true, sameSite: "strict", secure: deps.env.NODE_ENV === "production", path: "/api/auth", maxAge: 8 * 60 * 60 });
    setCsrfCookie(reply, deps.env);
    audit(binding.accountId, "auth.wechat_web_login", "account", binding.accountId);
    return reply.redirect("/");
  });
}
