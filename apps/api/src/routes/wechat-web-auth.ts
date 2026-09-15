import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { issueSession } from "../auth.js";
import { audit } from "../audit.js";

function configured(env: Env) {
  return Boolean(env.WECHAT_WEB_APP_ID && env.WECHAT_WEB_APP_SECRET && env.WECHAT_WEB_REDIRECT_URI);
}

export async function registerWechatWebAuthRoutes(app: FastifyInstance, deps: { env: Env }) {
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
    const binding = await prisma.wechatBinding.findFirst({ where: { unionid: body.unionid, active: true, account: { status: "active" } }, select: { accountId: true } });
    if (!binding) return reply.redirect("/login?wechat=unbound");
    const session = await issueSession(binding.accountId, deps.env, { clientKind: "web", userAgent: request.headers["user-agent"] });
    reply.setCookie("safety_session", session.accessToken, { httpOnly: true, sameSite: "strict", secure: deps.env.NODE_ENV === "production", path: "/", maxAge: 900 });
    reply.setCookie("safety_refresh", session.refreshToken, { httpOnly: true, sameSite: "strict", secure: deps.env.NODE_ENV === "production", path: "/api/auth", maxAge: 30 * 86400 });
    audit(binding.accountId, "auth.wechat_web_login", "account", binding.accountId);
    return reply.redirect("/");
  });
}
