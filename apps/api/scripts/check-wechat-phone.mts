import assert from "node:assert/strict";
import type { Env } from "../src/env.js";
import { getWechatPhoneNumber } from "../src/wechat-api.js";

const baseEnv = { WECHAT_APP_ID: "wx-test", WECHAT_APP_SECRET: "secret" } as Env;
const calls: Array<{ url: string; init?: RequestInit }> = [];
const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input); calls.push({ url, init });
  if (url.includes("/cgi-bin/token")) return new Response(JSON.stringify({ access_token: "token", expires_in: 7200 }), { status: 200 });
  return new Response(JSON.stringify({ errcode: 0, phone_info: { phoneNumber: "+86 138-0013-8000", purePhoneNumber: "13800138000", countryCode: "86" } }), { status: 200 });
};

await assert.rejects(() => getWechatPhoneNumber("phone-code", {} as Env, fakeFetch), (error: unknown) => error instanceof Error && "code" in error && error.code === "WECHAT_NOT_CONFIGURED");
assert.equal(await getWechatPhoneNumber("phone-code", baseEnv, fakeFetch), "13800138000");
assert.equal(calls.length, 2);
assert.equal(JSON.parse(String(calls[1]!.init?.body)).code, "phone-code");

await assert.rejects(
  () => getWechatPhoneNumber("bad-code", baseEnv, async () => new Response(JSON.stringify({ errcode: 40029 }), { status: 200 })),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "WECHAT_PHONE_FAILED"
);

console.log("WECHAT_PHONE_OK");
