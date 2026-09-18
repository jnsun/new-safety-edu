type HeaderValue = string | string[] | undefined;

const serverEnvironments = new Map([
  ["https://test.safety.sx.cn", "test"],
  ["https://www.safety.sx.cn", "prod"]
]);

function reject(statusCode: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { statusCode, code });
}

export function assertMiniProgramEnvironment(input: { publicBaseUrl: string; header: HeaderValue }): void {
  if (input.header === undefined) return;
  if (Array.isArray(input.header) || !["test", "prod"].includes(input.header)) reject(400, "MINIPROGRAM_ENV_INVALID", "小程序环境标识无效");
  const origin = new URL(input.publicBaseUrl).origin;
  const serverEnvironment = serverEnvironments.get(origin);
  if (!serverEnvironment) reject(503, "MINIPROGRAM_SERVER_ENV_UNKNOWN", "API 未配置可信的小程序环境");
  if (input.header !== serverEnvironment) reject(403, "MINIPROGRAM_ENV_MISMATCH", "小程序环境与 API 环境不匹配，已阻止请求");
}
