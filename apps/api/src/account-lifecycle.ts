import type { AccountStatus, PersonStatus } from "@prisma/client";

export class AccountPolicyError extends Error {
  readonly statusCode: number;

  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AccountPolicyError";
    this.statusCode = code === "INVALID_USERNAME" ? 400 : 409;
  }
}

export function normalizeUsername(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9._-]{4,40}$/.test(normalized)) {
    throw new AccountPolicyError("INVALID_USERNAME", "用户名只能包含英文字母、数字、点、短横线和下划线，长度为 4—40 位");
  }
  if (/^\d{17}[\dx]$/.test(normalized)) {
    throw new AccountPolicyError("INVALID_USERNAME", "身份证号码不能作为用户名");
  }
  return normalized;
}

export function assertAccountStatusChange(input: {
  actorId: string;
  targetId: string;
  currentStatus: AccountStatus;
  nextStatus: "active" | "disabled";
  targetIsCompanyAdmin: boolean;
  activeCompanyAdminCount: number;
  personStatus: PersonStatus | null;
}) {
  if (input.actorId === input.targetId) {
    throw new AccountPolicyError("ACCOUNT_SELF_ACTION_FORBIDDEN", "不能停用或启用当前登录账号");
  }
  if (input.currentStatus === "merged") {
    throw new AccountPolicyError("MERGED_ACCOUNT_IMMUTABLE", "已合并账号不能重新启用或停用");
  }
  if (input.nextStatus === "disabled" && input.targetIsCompanyAdmin && input.activeCompanyAdminCount <= 1) {
    throw new AccountPolicyError("LAST_COMPANY_ADMIN", "系统必须至少保留一名有效公司管理员");
  }
  if (input.nextStatus === "active" && input.personStatus !== null && input.personStatus !== "active") {
    throw new AccountPolicyError("PERSON_NOT_ACTIVE", "关联人员不是正常状态，不能启用账号");
  }
}

const blockerLabels = {
  person: "已关联人员",
  roles: "存在角色授权",
  wechatBindings: "存在微信绑定",
  refreshSessions: "存在登录会话",
  preferences: "存在用户偏好",
  requests: "存在申请记录",
  audits: "存在审计记录",
  usernameHistory: "存在用户名历史",
  mergedAccounts: "存在账号合并历史",
  uploadedFiles: "存在上传文件"
} as const;

export function accountDeletionBlockers(counts: Record<keyof typeof blockerLabels, number>): string[] {
  return (Object.keys(blockerLabels) as Array<keyof typeof blockerLabels>)
    .filter((key) => counts[key] > 0)
    .map((key) => blockerLabels[key]!);
}
