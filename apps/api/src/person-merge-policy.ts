export class PersonMergePolicyError extends Error {
  readonly statusCode = 409;

  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PersonMergePolicyError";
  }
}

export function assertPersonMergeAllowed(input: {
  actorPersonId: string | null;
  sourceId: string;
  targetId: string;
  sourceStatus: "pending" | "active" | "disabled" | "merged";
  targetStatus: "pending" | "active" | "disabled" | "merged";
  sourceType: "employee" | "contractor" | "temporary_individual";
  targetType: "employee" | "contractor" | "temporary_individual";
  sourcePhone: string;
  targetPhone: string;
  sourceNationalIdHash: string | null;
  targetNationalIdHash: string | null;
  sourcePrimaryOrganizationId: string | null;
  targetPrimaryOrganizationId: string | null;
  sourceHasAccount: boolean;
  targetHasAccount: boolean;
}) {
  if (input.sourceId === input.targetId) throw new PersonMergePolicyError("PERSON_MERGE_SAME", "不能合并同一人员档案");
  if (input.actorPersonId === input.sourceId || input.actorPersonId === input.targetId) throw new PersonMergePolicyError("PERSON_SELF_MERGE_FORBIDDEN", "不能合并当前管理员本人的人员档案");
  if (input.sourceStatus === "merged" || input.targetStatus === "merged") throw new PersonMergePolicyError("PERSON_ALREADY_MERGED", "人员档案已经合并");
  if (input.targetStatus !== "active") throw new PersonMergePolicyError("PERSON_MERGE_TARGET_INACTIVE", "主档案必须处于正常状态");
  if (input.sourceType !== input.targetType) throw new PersonMergePolicyError("PERSON_TYPE_CONFLICT", "两个人员档案类型不同，请先核实身份");
  if (input.sourcePhone && input.targetPhone && input.sourcePhone !== input.targetPhone) throw new PersonMergePolicyError("PERSON_PHONE_CONFLICT", "两个人员档案手机号不同，请先核实并更正");
  if (input.sourceNationalIdHash && input.targetNationalIdHash && input.sourceNationalIdHash !== input.targetNationalIdHash) throw new PersonMergePolicyError("PERSON_IDENTITY_CONFLICT", "两个人员档案身份证身份不同，禁止合并");
  if (input.sourcePrimaryOrganizationId && input.targetPrimaryOrganizationId && input.sourcePrimaryOrganizationId !== input.targetPrimaryOrganizationId) throw new PersonMergePolicyError("PERSON_ORGANIZATION_CONFLICT", "两个人员档案当前主部门不同，请先处理组织关系");
  if (input.sourceHasAccount && input.targetHasAccount) throw new PersonMergePolicyError("PERSON_ACCOUNT_CONFLICT", "两个人员档案都有关联账号，请先完成账号合并");
}
