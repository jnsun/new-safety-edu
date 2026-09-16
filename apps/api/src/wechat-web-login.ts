import type { Env } from "./env.js";

type WechatWebEnvironment = Pick<Env, "WECHAT_WEB_APP_ID" | "WECHAT_WEB_APP_SECRET" | "WECHAT_WEB_REDIRECT_URI">;

export function publicWechatWidgetConfig(env: WechatWebEnvironment, state: string) {
  return {
    appId: env.WECHAT_WEB_APP_ID!,
    redirectUri: env.WECHAT_WEB_REDIRECT_URI!,
    state,
  };
}

export function buildWechatWebAuthorizeUrl(env: WechatWebEnvironment, state: string): string {
  const url = new URL("https://open.weixin.qq.com/connect/qrconnect");
  url.searchParams.set("appid", env.WECHAT_WEB_APP_ID!);
  url.searchParams.set("redirect_uri", env.WECHAT_WEB_REDIRECT_URI!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "snsapi_login");
  url.searchParams.set("state", state);
  return `${url.toString()}#wechat_redirect`;
}
