export class AccountMergePolicyError extends Error {
  readonly statusCode = 409;

  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AccountMergePolicyError";
  }
}

export function assertAccountMergeAllowed(input: {
  actorId: string;
  sourceId: string;
  targetId: string;
  sourceStatus: "pending" | "active" | "disabled" | "merged";
  targetStatus: "pending" | "active" | "disabled" | "merged";
  sourcePersonId: string | null;
  targetPersonId: string | null;
  targetPersonStatus: "pending" | "active" | "disabled" | "merged" | null;
  sourceVerifiedPhone: string | null;
  targetVerifiedPhone: string | null;
  sourceUsername: string | null;
  targetUsername: string | null;
  sourcePassword: boolean;
  targetPassword: boolean;
  sourceActiveWechatAppIds: string[];
  targetActiveWechatAppIds: string[];
  sourceIsCompanyAdmin: boolean;
  activeCompanyAdminCount: number;
  automaticEmptySource?: boolean;
}) {
  if (input.sourceId === input.targetId) throw new AccountMergePolicyError("ACCOUNT_MERGE_SAME", "不能合并同一账号");
  if (!input.automaticEmptySource && (input.actorId === input.sourceId || input.actorId === input.targetId)) throw new AccountMergePolicyError("ACCOUNT_SELF_ACTION_FORBIDDEN", "不能合并当前登录账号");
  if (input.sourceStatus === "merged" || input.targetStatus === "merged") throw new AccountMergePolicyError("ACCOUNT_ALREADY_MERGED", "账号已经合并");
  if (input.targetStatus !== "active") throw new AccountMergePolicyError("ACCOUNT_MERGE_TARGET_INACTIVE", "目标账号必须处于正常状态");
  if (input.targetPersonStatus !== null && input.targetPersonStatus !== "active") throw new AccountMergePolicyError("ACCOUNT_MERGE_TARGET_INACTIVE", "目标账号关联人员必须处于正常状态");
  if (input.sourcePersonId && input.targetPersonId && input.sourcePersonId !== input.targetPersonId) throw new AccountMergePolicyError("ACCOUNT_PERSON_CONFLICT", "两个账号属于不同人员，不能直接合并");
  if (input.sourceVerifiedPhone && input.targetVerifiedPhone && input.sourceVerifiedPhone !== input.targetVerifiedPhone) throw new AccountMergePolicyError("ACCOUNT_PHONE_CONFLICT", "两个账号的已验证手机号不同，请先处理手机号变更");
  if (input.sourceUsername && input.targetUsername) throw new AccountMergePolicyError("ACCOUNT_CREDENTIAL_CONFLICT", "两个账号都有独立用户名，请先处理登录名");
  if (input.sourcePassword && input.targetPassword && input.sourceUsername !== input.targetUsername) throw new AccountMergePolicyError("ACCOUNT_CREDENTIAL_CONFLICT", "两个账号都有独立密码凭据，请先处理登录方式");
  const targetApps = new Set(input.targetActiveWechatAppIds);
  if (input.sourceActiveWechatAppIds.some((appId) => targetApps.has(appId))) throw new AccountMergePolicyError("ACCOUNT_WECHAT_CONFLICT", "两个账号在同一微信应用中都有有效绑定，请先处理微信换绑");
  if (input.sourceIsCompanyAdmin && input.activeCompanyAdminCount <= 1) throw new AccountMergePolicyError("LAST_COMPANY_ADMIN", "不能合并最后一个有效公司管理员账号");
}
