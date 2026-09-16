import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { issueSession } from "../auth.js";
import { audit } from "../audit.js";
import { setCsrfCookie } from "../csrf.js";
import { resolveWechatAccount } from "../wechat-identity.js";
import { resolveReceivablesAccess } from "../receivables-access.js";
import { decideWebLoginDestination } from "../web-login-access.js";
import { buildWechatWebAuthorizeUrl, publicWechatWidgetConfig } from "../wechat-web-login.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

function configured(env: Env) {
  return Boolean(env.WECHAT_WEB_APP_ID && env.WECHAT_WEB_APP_SECRET && env.WECHAT_WEB_REDIRECT_URI);
}

export async function registerWechatWebAuthRoutes(app: FastifyInstance, deps: { env: Env; authenticate: Guard; requireManager: Guard }) {
  app.get("/api/auth/wechat-web/config", async () => ({ data: { enabled: configured(deps.env) } }));

  app.get("/api/auth/wechat-web/widget-config", async (_request, reply) => {
    if (!configured(deps.env)) throw Object.assign(new Error("网页微信扫码登录尚未配置"), { statusCode: 503, code: "WECHAT_WEB_NOT_CONFIGURED" });
    const state = randomBytes(24).toString("base64url");
    reply.setCookie("wechat_oauth_state", state, { httpOnly: true, secure: deps.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/wechat-web", maxAge: 600 });
    return { data: publicWechatWidgetConfig(deps.env, state) };
  });

  app.get("/api/auth/wechat-web/start", async (_request, reply) => {
    if (!configured(deps.env)) throw Object.assign(new Error("网页微信扫码登录尚未配置"), { statusCode: 503, code: "WECHAT_WEB_NOT_CONFIGURED" });
    const state = randomBytes(24).toString("base64url");
    reply.setCookie("wechat_oauth_state", state, { httpOnly: true, secure: deps.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/wechat-web", maxAge: 600 });
    return reply.redirect(buildWechatWebAuthorizeUrl(deps.env, state));
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
    if (!response.ok || !body.openid) return reply.redirect("/login?wechat=exchange_failed");
    const resolved = await prisma.$transaction((tx) => resolveWechatAccount(tx, { appId: deps.env.WECHAT_WEB_APP_ID!, openid: body.openid!, ...(body.unionid ? { unionid: body.unionid } : {}) }), { isolationLevel: "Serializable" });
    if (!["active", "pending"].includes(resolved.account.status)) return reply.redirect("/login?wechat=account_unavailable");
    let destination: "/" | "/receivables" = "/";
    if (resolved.account.personId) {
      const manager = await prisma.roleAssignment.findFirst({ where: { personId: resolved.account.personId, active: true, role: { in: ["company_admin", "org_leader", "org_admin", "project_admin"] } }, select: { id: true } });
      const receivables = await resolveReceivablesAccess({ accountId: resolved.account.id });
      const access = decideWebLoginDestination({ hasManagerRole: !!manager, canEnterReceivables: receivables.canEnter });
      if (!access.allowed) return reply.redirect(`/login?wechat=${access.reason}`);
      destination = access.path;
    }
    const session = await issueSession(resolved.account.id, deps.env, { clientKind: "web", loginMethod: "wechat", userAgent: request.headers["user-agent"] });
    reply.setCookie("safety_session", session.accessToken, { httpOnly: true, sameSite: "strict", secure: deps.env.NODE_ENV === "production", path: "/", maxAge: 900 });
    reply.setCookie("safety_refresh", session.refreshToken, { httpOnly: true, sameSite: "strict", secure: deps.env.NODE_ENV === "production", path: "/api/auth", maxAge: 8 * 60 * 60 });
    setCsrfCookie(reply, deps.env);
    if (!resolved.account.personId) {
      const pending = await prisma.changeRequest.findFirst({ where: { accountId: resolved.account.id, type: "binding", status: "pending" }, select: { id: true } });
      return reply.redirect(pending ? "/wechat-bind?pending=1" : "/wechat-bind");
    }
    audit(resolved.account.id, "auth.wechat_web_login", "account", resolved.account.id);
    return reply.redirect(destination);
  });
}
