import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { Env } from "./env.js";

type CsrfRequest = {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  cookies: Record<string, string | undefined>;
  publicBaseUrl: string;
};

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const publicWrites = new Set(["/api/auth/login", "/api/auth/phone/code", "/api/auth/phone/login", "/api/auth/password-recovery/code", "/api/auth/password-recovery/confirm", "/api/auth/recovery-request", "/api/wechat/login"]);
const rejected = () => Object.assign(new Error("请求安全校验失败，请刷新页面后重试"), { statusCode: 403, code: "CSRF_REJECTED" });

export function assertCsrfRequest(request: CsrfRequest) {
  if (safeMethods.has(request.method.toUpperCase())) return;
  if (typeof request.headers.authorization === "string" && request.headers.authorization.startsWith("Bearer ")) return;
  const path = request.url.split("?", 1)[0]!;
  if (publicWrites.has(path) || (path === "/api/auth/refresh" && !request.cookies.safety_refresh)) return;
  const expectedOrigin = new URL(request.publicBaseUrl);
  if (request.headers.origin !== expectedOrigin.origin || request.headers.host !== expectedOrigin.host) throw rejected();
  const contentType = typeof request.headers["content-type"] === "string" ? request.headers["content-type"] : "";
  if (!contentType.startsWith("application/json") && !contentType.startsWith("multipart/form-data")) throw rejected();
  const cookieToken = request.cookies.safety_csrf; const headerToken = request.headers["x-csrf-token"];
  if (!cookieToken || typeof headerToken !== "string") throw rejected();
  const expected = Buffer.from(cookieToken); const actual = Buffer.from(headerToken);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw rejected();
}

export function setCsrfCookie(reply: FastifyReply, env: Env) {
  const token = randomBytes(32).toString("base64url");
  reply.setCookie("safety_csrf", token, { httpOnly: false, sameSite: "strict", secure: env.NODE_ENV === "production", path: "/", maxAge: 8 * 60 * 60 });
  return token;
}
