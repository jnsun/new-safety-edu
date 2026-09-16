export class PersonBulkOrganizationPolicyError extends Error {
  statusCode = 409;

  constructor(public code: string, message: string) {
    super(message);
    this.name = "PersonBulkOrganizationPolicyError";
  }
}

export function prepareBulkPrimaryOrganizationAssignment(input: {
  personIds: string[];
  targetOrganizationType: string;
  persons: Array<{ id: string; status: string; primaryOrganizationId: string | null }>;
}) {
  const personIds = [...new Set(input.personIds)];
  if (!personIds.length || personIds.length > 500) {
    throw new PersonBulkOrganizationPolicyError("INVALID_PERSON_COUNT", "请选择 1 至 500 名人员");
  }
  if (!["department", "business_entity"].includes(input.targetOrganizationType)) {
    throw new PersonBulkOrganizationPolicyError("INVALID_TARGET_ORGANIZATION", "主部门只能设置为部门或经营实体");
  }
  const people = new Map(input.persons.map((person) => [person.id, person]));
  if (personIds.some((id) => people.get(id)?.status !== "active")) {
    throw new PersonBulkOrganizationPolicyError("PERSON_NOT_AVAILABLE", "所选人员不存在或不是在用状态");
  }
  if (personIds.some((id) => people.get(id)?.primaryOrganizationId)) {
    throw new PersonBulkOrganizationPolicyError("PERSON_ALREADY_ASSIGNED", "所选人员中包含已有主部门的人员，请刷新后重试");
  }
  return personIds;
}
