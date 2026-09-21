const firstReleaseError = () => Object.assign(new Error("第一版仅面向公司正式员工"), {
  statusCode: 403,
  code: "FIRST_RELEASE_EMPLOYEE_ONLY",
});

export function assertFirstReleaseEmployee(personType: string | null | undefined): asserts personType is "employee" {
  if (personType !== "employee") throw firstReleaseError();
}

export function assertFirstReleaseWorkflowAllowed(workflow: string): void {
  if (["registration", "identity_correction", "contractor_unit_change", "responsible_entity_change"].includes(workflow)) throw firstReleaseError();
}
