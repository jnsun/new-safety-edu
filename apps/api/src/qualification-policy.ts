import type { OrganizationType } from "@prisma/client";

export function assertOrganizationQualificationOwner(type: OrganizationType) {
  if (type !== "company" && type !== "business_entity") throw Object.assign(new Error("单位资质只能归属于公司或经营实体"), { statusCode: 409, code: "QUALIFICATION_OWNER_TYPE_INVALID" });
}

export function qualificationExpiryMilestone(expiresAt: Date, now: Date, warnDays: number) {
  const days = Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
  const week = Math.floor(now.getTime() / (7 * 86_400_000));
  const milestone = days < 0 ? `overdue-${week}` : days <= 0 ? "0" : days <= 7 ? "7" : days <= 30 ? "30" : `entry-${warnDays}`;
  return { days, milestone };
}
