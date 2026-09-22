import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import type { Env } from "./env.js";

const purpose = "wechat_phone_verification";
const smsPurpose = "wechat_sms_identity_verification";
const key = (env: Env) => new TextEncoder().encode(env.JWT_SECRET);

export async function issueWechatPhoneVerificationToken(accountId: string, phone: string, env: Env) {
  return new SignJWT({ purpose, phone }).setProtectedHeader({ alg: "HS256" }).setSubject(accountId).setIssuedAt().setExpirationTime("10m").sign(key(env));
}

export async function verifyWechatPhoneVerificationToken(token: string, accountId: string, env: Env) {
  try {
    const verified = await jwtVerify(token, key(env));
    return z.object({ sub: z.literal(accountId), purpose: z.literal(purpose), phone: z.string().regex(/^1\d{10}$/) }).parse({ ...verified.payload, sub: verified.payload.sub }).phone;
  } catch {
    throw Object.assign(new Error("微信手机号验证已失效，请重新验证"), { statusCode: 401, code: "WECHAT_PHONE_VERIFICATION_INVALID" });
  }
}

export async function issueWechatSmsVerificationToken(accountId: string, phone: string, env: Env) {
  return new SignJWT({ purpose: smsPurpose, phone }).setProtectedHeader({ alg: "HS256" }).setSubject(accountId).setIssuedAt().setExpirationTime("10m").sign(key(env));
}

export async function verifyWechatSmsVerificationToken(token: string, accountId: string, env: Env) {
  try {
    const verified = await jwtVerify(token, key(env));
    return z.object({ sub: z.literal(accountId), purpose: z.literal(smsPurpose), phone: z.string().regex(/^1\d{10}$/) }).parse({ ...verified.payload, sub: verified.payload.sub }).phone;
  } catch {
    throw Object.assign(new Error("短信验证已失效，请重新验证"), { statusCode: 401, code: "WECHAT_SMS_VERIFICATION_INVALID" });
  }
}
