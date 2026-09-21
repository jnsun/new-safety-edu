import { sms } from "tencentcloud-sdk-nodejs-sms";
import type { Env } from "./env.js";

const deliveryFailed = () => Object.assign(new Error("短信发送暂时失败"), { statusCode: 502, code: "SMS_DELIVERY_FAILED" });
const notConfigured = () => Object.assign(new Error("短信服务尚未配置"), { statusCode: 503, code: "SMS_NOT_CONFIGURED" });

export function isTencentSmsConfigured(env: Env): boolean {
  return Boolean(env.TENCENTCLOUD_SECRET_ID && env.TENCENTCLOUD_SECRET_KEY && env.TENCENT_SMS_SDK_APP_ID && env.TENCENT_SMS_SIGN_NAME && env.TENCENT_SMS_TEMPLATE_ID);
}

function hasTencentSmsSettings(env: Env): boolean {
  return Boolean(env.TENCENTCLOUD_SECRET_ID || env.TENCENTCLOUD_SECRET_KEY || env.TENCENT_SMS_SDK_APP_ID || env.TENCENT_SMS_SIGN_NAME || env.TENCENT_SMS_TEMPLATE_ID);
}

export function isSmsConfigured(env: Env): boolean {
  return hasTencentSmsSettings(env) ? isTencentSmsConfigured(env) : Boolean(env.SMS_SEND_ENDPOINT && env.SMS_SEND_TOKEN);
}

export function buildTencentSmsParams(phone: string, code: string, env: Env) {
  if (!isTencentSmsConfigured(env)) throw notConfigured();
  return {
    PhoneNumberSet: [`+86${phone}`],
    SmsSdkAppId: env.TENCENT_SMS_SDK_APP_ID!,
    SignName: env.TENCENT_SMS_SIGN_NAME!,
    TemplateId: env.TENCENT_SMS_TEMPLATE_ID!,
    TemplateParamSet: [code, "5"]
  };
}

export function assertTencentSmsAccepted(response: { SendStatusSet?: Array<{ Code?: string }> }): void {
  if (response.SendStatusSet?.length !== 1 || response.SendStatusSet[0]?.Code !== "Ok") throw deliveryFailed();
}

export async function deliverCode(phone: string, code: string, purpose: string, env: Env): Promise<void> {
  if (hasTencentSmsSettings(env)) {
    const params = buildTencentSmsParams(phone, code, env);
    const client = new sms.v20210111.Client({
      credential: { secretId: env.TENCENTCLOUD_SECRET_ID!, secretKey: env.TENCENTCLOUD_SECRET_KEY! },
      region: "ap-guangzhou",
      profile: { httpProfile: { reqTimeout: 10 } }
    });
    try {
      assertTencentSmsAccepted(await client.SendSms(params));
    } catch {
      throw deliveryFailed();
    }
    return;
  }

  if (!env.SMS_SEND_ENDPOINT || !env.SMS_SEND_TOKEN) throw notConfigured();
  let response: Response;
  try {
    response = await fetch(env.SMS_SEND_ENDPOINT, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.SMS_SEND_TOKEN}` }, body: JSON.stringify({ phone, code, purpose }) });
  } catch {
    throw deliveryFailed();
  }
  if (!response.ok) throw deliveryFailed();
}
