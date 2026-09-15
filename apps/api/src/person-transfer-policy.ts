import type { OrganizationType } from "@prisma/client";

export class PersonTransferPolicyError extends Error {
  readonly statusCode = 409;

  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PersonTransferPolicyError";
  }
}

export function decidePersonTransfer(input: {
  currentOrganizationType: OrganizationType | null;
  targetOrganizationType: OrganizationType;
  isCurrentLeader: boolean;
  hasCrossEntityProjectAdminRole: boolean;
  keepCrossEntityProjectAdminRoles: boolean;
  actorIsCompanyAdmin: boolean;
}) {
  if (!["business_entity", "department"].includes(input.targetOrganizationType)) {
    throw new PersonTransferPolicyError("INVALID_PRIMARY_ORGANIZATION", "人员主组织只能是经营实体或部门");
  }
  if (input.isCurrentLeader) {
    throw new PersonTransferPolicyError("SUCCESSOR_REQUIRED", "请先设置继任负责人，再调换当前负责人所属组织");
  }
  if (input.keepCrossEntityProjectAdminRoles && !input.actorIsCompanyAdmin) {
    throw new PersonTransferPolicyError("CROSS_ENTITY_ROLE_DECISION_FORBIDDEN", "只有公司管理员可以保留跨经营实体项目管理员角色");
  }
  if (input.keepCrossEntityProjectAdminRoles && input.targetOrganizationType === "department") {
    throw new PersonTransferPolicyError("DEPARTMENT_PROJECT_ROLE_FORBIDDEN", "调入普通部门不能保留项目管理员角色");
  }
  const movingToDepartment = input.targetOrganizationType === "department";
  return {
    endOrganizationRoles: true,
    endProjectRoles: movingToDepartment || (input.hasCrossEntityProjectAdminRole && !input.keepCrossEntityProjectAdminRoles),
    endProjectMemberships: movingToDepartment
  };
}
