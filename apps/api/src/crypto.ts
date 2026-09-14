import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Env } from "./env.js";

export function normalizePhone(value: string): string {
  return value.replace(/[\s-]/g, "").replace(/^\+86/, "");
}

export function encryptNationalId(value: string, env: Env) {
  const normalized = value.trim().toUpperCase();
  const key = Buffer.from(env.FIELD_ENCRYPTION_KEY, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  return {
    nationalIdCipher: ciphertext.toString("base64"),
    nationalIdIv: iv.toString("base64"),
    nationalIdTag: cipher.getAuthTag().toString("base64"),
    nationalIdHash: hashNationalId(normalized, env),
    nationalIdLast4: normalized.slice(-4).padStart(4, "*")
  };
}

export function hashNationalId(value: string, env: Env): string {
  return createHmac("sha256", Buffer.from(env.FIELD_ENCRYPTION_KEY, "base64")).update(value.trim().toUpperCase()).digest("hex");
}

export function decryptNationalId(ciphertext: string, iv: string, tag: string, env: Env): string {
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(env.FIELD_ENCRYPTION_KEY, "base64"), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function signShortToken(value: string, expiresAt: number, secret: string): string {
  const payload = `${value}.${expiresAt}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function verifyShortToken(token: string, secret: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [value, expiresRaw, signature] = parts as [string, string, string];
  if (!/^\d+$/.test(expiresRaw) || Number(expiresRaw) < Math.floor(Date.now() / 1000)) return null;
  const expected = createHmac("sha256", secret).update(`${value}.${expiresRaw}`).digest();
  const actual = Buffer.from(signature, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? value : null;
}
