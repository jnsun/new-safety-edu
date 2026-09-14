import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  COOKIE_SECRET: z.string().min(32),
  JWT_SECRET: z.string().min(32),
  FIELD_ENCRYPTION_KEY: z.string().min(1),
  UPLOAD_ROOT: z.string().default("var/uploads"),
  UPLOAD_SIGNING_SECRET: z.string().min(32),
  WECHAT_APP_ID: z.string().optional(),
  WECHAT_APP_SECRET: z.string().optional(),
  WECHAT_SUBSCRIBE_TEMPLATE_TASK: z.string().optional(),
  WECHAT_SUBSCRIBE_TEMPLATE_DUE: z.string().optional(),
  WECHAT_SUBSCRIBE_FIELD_TITLE: z.string().default("thing1"),
  WECHAT_SUBSCRIBE_FIELD_BODY: z.string().default("thing2"),
  SMS_SEND_ENDPOINT: z.string().url().optional(),
  SMS_SEND_TOKEN: z.string().min(16).optional(),
  WECHAT_WEB_APP_ID: z.string().optional(),
  WECHAT_WEB_APP_SECRET: z.string().optional(),
  WECHAT_WEB_REDIRECT_URI: z.string().url().optional()
});

export type Env = z.infer<typeof schema>;

export function loadEnv(): Env {
  const env = schema.parse(process.env);
  const key = Buffer.from(env.FIELD_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY 必须是 Base64 编码的 32 字节密钥");
  return env;
}
