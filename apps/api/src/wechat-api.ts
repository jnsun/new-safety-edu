import type { Env } from "./env.js";

let tokenCache: { value: string; expiresAt: number } | undefined;

export async function getWechatAccessToken(env: Env, fetcher: typeof fetch = fetch) {
  if (!env.WECHAT_APP_ID || !env.WECHAT_APP_SECRET) throw Object.assign(new Error("微信服务尚未配置"), { statusCode: 503, code: "WECHAT_NOT_CONFIGURED" });
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", env.WECHAT_APP_ID);
  url.searchParams.set("secret", env.WECHAT_APP_SECRET);
  const response = await fetcher(url);
  const body = await response.json() as { access_token?: string; expires_in?: number; errcode?: number };
  if (!response.ok || !body.access_token) throw Object.assign(new Error(`wechat:${body.errcode ?? response.status}`), { statusCode: 502, code: "WECHAT_API_FAILED", wechatCode: body.errcode });
  tokenCache = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 7200) * 1000 };
  return tokenCache.value;
}

export async function getWechatPhoneNumber(code: string, env: Env, fetcher: typeof fetch = fetch) {
  let token: string;
  try { token = await getWechatAccessToken(env, fetcher); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "WECHAT_NOT_CONFIGURED") throw error;
    throw Object.assign(new Error("微信手机号验证失败，请重试或使用短信验证"), { statusCode: 502, code: "WECHAT_PHONE_FAILED" });
  }
  const response = await fetcher(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(token)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code })
  });
  const body = await response.json() as { errcode?: number; phone_info?: { purePhoneNumber?: string } };
  const phone = body.phone_info?.purePhoneNumber;
  if (!response.ok || body.errcode || !phone) throw Object.assign(new Error("微信手机号验证失败，请重试或使用短信验证"), { statusCode: 401, code: "WECHAT_PHONE_FAILED", wechatCode: body.errcode });
  if (!/^1\d{10}$/.test(phone)) throw Object.assign(new Error("微信返回的手机号格式无效"), { statusCode: 422, code: "WECHAT_PHONE_INVALID" });
  return phone;
}
