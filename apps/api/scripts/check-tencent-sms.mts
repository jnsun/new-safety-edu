import assert from "node:assert/strict";
import type { Env } from "../src/env.js";
import { assertTencentSmsAccepted, buildTencentSmsParams, isSmsConfigured, isTencentSmsConfigured } from "../src/sms-delivery.js";

const env = {
  TENCENTCLOUD_SECRET_ID: "test-secret-id",
  TENCENTCLOUD_SECRET_KEY: "test-secret-key",
  TENCENT_SMS_SDK_APP_ID: "1400000000",
  TENCENT_SMS_SIGN_NAME: "测试签名",
  TENCENT_SMS_TEMPLATE_ID: "12345"
} as Env;

assert.equal(isTencentSmsConfigured(env), true);
assert.equal(isTencentSmsConfigured({ ...env, TENCENTCLOUD_SECRET_KEY: undefined }), false);
assert.equal(isSmsConfigured({ ...env, TENCENTCLOUD_SECRET_KEY: undefined, SMS_SEND_ENDPOINT: "https://sms-gateway.example.test", SMS_SEND_TOKEN: "test-gateway-token-123" }), false);
assert.equal(isSmsConfigured({ SMS_SEND_ENDPOINT: "https://sms-gateway.example.test", SMS_SEND_TOKEN: "test-gateway-token-123" } as Env), true);
assert.deepEqual(buildTencentSmsParams("13800138000", "012345", env), {
  PhoneNumberSet: ["+8613800138000"],
  SmsSdkAppId: "1400000000",
  SignName: "测试签名",
  TemplateId: "12345",
  TemplateParamSet: ["012345", "5"]
});
assert.doesNotThrow(() => assertTencentSmsAccepted({ SendStatusSet: [{ Code: "Ok" }] }));
assert.throws(() => assertTencentSmsAccepted({ SendStatusSet: [{ Code: "FailedOperation.TemplateIncorrectOrUnapproved" }] }), (error: unknown) => error instanceof Error && "code" in error && error.code === "SMS_DELIVERY_FAILED");
assert.throws(() => assertTencentSmsAccepted({ SendStatusSet: [] }), (error: unknown) => error instanceof Error && "code" in error && error.code === "SMS_DELIVERY_FAILED");

console.log("TENCENT_SMS_CHECK_OK");
