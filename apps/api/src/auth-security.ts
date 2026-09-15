import { createHmac } from "node:crypto";

export class AuthPolicyError extends Error {
  readonly statusCode = 400;
  constructor(public readonly code: string, message: string) { super(message); this.name = "AuthPolicyError"; }
}

export function sessionAbsoluteTtlMs(clientKind: string | null | undefined) {
  return clientKind === "web" ? 8 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
}

export function securityHash(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function assertPasswordAllowed(password: string, identity: { username?: string | null; phone?: string | null; name?: string | null }) {
  const normalized = password.normalize("NFKC").toLocaleLowerCase();
  if ([identity.username, identity.phone, identity.name].some((value) => value?.normalize("NFKC").toLocaleLowerCase() === normalized)) {
    throw new AuthPolicyError("PASSWORD_MATCHES_IDENTITY", "密码不能与用户名、完整手机号或姓名相同");
  }
  if (password.length < 12) throw new AuthPolicyError("PASSWORD_TOO_SHORT", "密码至少需要十二位");
  if (password.length > 128) throw new AuthPolicyError("PASSWORD_TOO_LONG", "密码不能超过一百二十八位");
}

export function decidePasswordFailure(previousFailures: number, now = new Date()) {
  const failedCount = previousFailures + 1;
  return { failedCount, lockedUntil: failedCount >= 5 ? new Date(now.getTime() + 15 * 60_000) : null };
}

export function smsRateDecision(counts: { lastMinute: number; lastFifteenMinutes: number; lastDay: number }) {
  if (counts.lastMinute >= 1) return "minute" as const;
  if (counts.lastFifteenMinutes >= 5) return "fifteen_minutes" as const;
  if (counts.lastDay >= 10) return "day" as const;
  return null;
}
