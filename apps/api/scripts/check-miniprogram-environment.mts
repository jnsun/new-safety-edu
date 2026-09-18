import assert from "node:assert/strict";
import { assertMiniProgramEnvironment } from "../src/miniprogram-environment.js";

const prod = { publicBaseUrl: "https://www.safety.sx.cn", header: "prod" };
const test = { publicBaseUrl: "https://test.safety.sx.cn", header: "test" };

assert.doesNotThrow(() => assertMiniProgramEnvironment(prod));
assert.doesNotThrow(() => assertMiniProgramEnvironment(test));
assert.doesNotThrow(() => assertMiniProgramEnvironment({ publicBaseUrl: prod.publicBaseUrl, header: undefined }), "Web 请求不带小程序环境头时不得受影响");
assert.throws(() => assertMiniProgramEnvironment({ ...prod, header: "test" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "MINIPROGRAM_ENV_MISMATCH");
assert.throws(() => assertMiniProgramEnvironment({ ...test, header: "prod" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "MINIPROGRAM_ENV_MISMATCH");
assert.throws(() => assertMiniProgramEnvironment({ ...prod, header: "other" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "MINIPROGRAM_ENV_INVALID");
assert.throws(() => assertMiniProgramEnvironment({ publicBaseUrl: "http://localhost:3000", header: "test" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "MINIPROGRAM_SERVER_ENV_UNKNOWN");

console.log("MINIPROGRAM_SERVER_ENVIRONMENT_CHECK=PASS");
