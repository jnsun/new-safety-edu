import type { PrismaClient } from "@prisma/client";

const beforeMonths = (now: Date, months: number) => { const value = new Date(now); value.setUTCMonth(value.getUTCMonth() - months); return value; };
const beforeDays = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

export function retentionCutoffs(now = new Date()) {
  return { authSuccess: beforeMonths(now, 12), loginFailure: beforeMonths(now, 6), verificationCode: beforeDays(now, 90) };
}

export async function runSecurityRetention(db: PrismaClient, options: { apply: boolean; now?: Date }) {
  const cutoffs = retentionCutoffs(options.now);
  const [authSuccess, loginFailure, verificationCode] = await Promise.all([
    db.authSecurityEvent.count({ where: { eventType: { in: ["login.success", "session.refresh"] }, createdAt: { lt: cutoffs.authSuccess } } }),
    db.authSecurityEvent.count({ where: { eventType: { in: ["login.failed", "sms.rate_limited"] }, createdAt: { lt: cutoffs.loginFailure } } }),
    db.phoneVerificationCode.count({ where: { createdAt: { lt: cutoffs.verificationCode }, OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: options.now ?? new Date() } }] } })
  ]);
  if (options.apply) {
    await db.$transaction([
      db.authSecurityEvent.deleteMany({ where: { eventType: { in: ["login.success", "session.refresh"] }, createdAt: { lt: cutoffs.authSuccess } } }),
      db.authSecurityEvent.deleteMany({ where: { eventType: { in: ["login.failed", "sms.rate_limited"] }, createdAt: { lt: cutoffs.loginFailure } } }),
      db.phoneVerificationCode.deleteMany({ where: { createdAt: { lt: cutoffs.verificationCode }, OR: [{ consumedAt: { not: null } }, { expiresAt: { lt: options.now ?? new Date() } }] } })
    ]);
  }
  return { mode: options.apply ? "apply" : "dry-run", authSuccess, loginFailure, verificationCode, immutableBusinessAuditDeleted: 0 };
}
