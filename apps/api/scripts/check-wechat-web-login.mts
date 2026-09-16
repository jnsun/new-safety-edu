import assert from "node:assert/strict";
import { buildWechatWebAuthorizeUrl, publicWechatWidgetConfig } from "../src/wechat-web-login.js";

const env = {
  WECHAT_WEB_APP_ID: "wx-public-id",
  WECHAT_WEB_APP_SECRET: "must-not-leak",
  WECHAT_WEB_REDIRECT_URI: "https://example.test/api/auth/wechat-web/callback",
};
const config = publicWechatWidgetConfig(env, "state-token");
assert.deepEqual(config, {
  appId: "wx-public-id",
  redirectUri: "https://example.test/api/auth/wechat-web/callback",
  state: "state-token",
});
assert.equal(JSON.stringify(config).includes("must-not-leak"), false);

const url = new URL(buildWechatWebAuthorizeUrl(env, "state-token"));
assert.equal(url.origin, "https://open.weixin.qq.com");
assert.equal(url.searchParams.get("appid"), "wx-public-id");
assert.equal(url.searchParams.get("state"), "state-token");

console.log("WECHAT_WEB_LOGIN_OK");
