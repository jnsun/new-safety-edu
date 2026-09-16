export class PersonBulkLifecyclePolicyError extends Error {
  statusCode = 400;
  constructor(public code: string, message: string) {
    super(message);
    this.name = "PersonBulkLifecyclePolicyError";
  }
}

export function previewBulkPersonDisable(input: {
  personIds: string[];
  persons: Array<{ id: string; status: string }>;
}) {
  const personIds = [...new Set(input.personIds)];
  if (!personIds.length || personIds.length > 500) {
    throw new PersonBulkLifecyclePolicyError("INVALID_PERSON_COUNT", "请选择 1 至 500 名人员");
  }
  const people = new Map(input.persons.map((person) => [person.id, person]));
  return personIds.map((personId) => {
    const person = people.get(personId);
    if (!person) return { personId, eligible: false, code: "NOT_FOUND", reason: "人员不存在或不在管理范围内" } as const;
    if (person.status === "disabled") return { personId, eligible: false, code: "ALREADY_DISABLED", reason: "人员已经停用" } as const;
    if (person.status !== "active") return { personId, eligible: false, code: "INVALID_STATUS", reason: "当前人员状态不能停用" } as const;
    return { personId, eligible: true, code: "READY", reason: "可以停用" } as const;
  });
}
