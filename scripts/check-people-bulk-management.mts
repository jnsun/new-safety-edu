import assert from "node:assert/strict";

const policyModule = await import("../apps/api/src/person-bulk-organization-policy.js").catch(() => ({}));
const searchModule = await import("../apps/admin/src/person-search.js").catch(() => ({}));

assert.equal(typeof policyModule.prepareBulkPrimaryOrganizationAssignment, "function", "批量设置部门策略尚未实现");
assert.equal(typeof searchModule.personMatchesSearch, "function", "人员搜索尚未实现");

const prepare = policyModule.prepareBulkPrimaryOrganizationAssignment as (input: unknown) => string[];
const ids = prepare({
  personIds: ["person-1", "person-1", "person-2"],
  targetOrganizationType: "department",
  persons: [
    { id: "person-1", status: "active", primaryOrganizationId: null },
    { id: "person-2", status: "active", primaryOrganizationId: null },
  ],
});
assert.deepEqual(ids, ["person-1", "person-2"]);

assert.throws(
  () => prepare({
    personIds: ["person-1"],
    targetOrganizationType: "company",
    persons: [{ id: "person-1", status: "active", primaryOrganizationId: null }],
  }),
  (error: unknown) => (error as { code?: string }).code === "INVALID_TARGET_ORGANIZATION",
);
assert.throws(
  () => prepare({
    personIds: ["person-1"],
    targetOrganizationType: "department",
    persons: [{ id: "person-1", status: "active", primaryOrganizationId: "organization-1" }],
  }),
  (error: unknown) => (error as { code?: string }).code === "PERSON_ALREADY_ASSIGNED",
);
assert.throws(
  () => prepare({
    personIds: ["person-1", "person-2"],
    targetOrganizationType: "department",
    persons: [{ id: "person-1", status: "active", primaryOrganizationId: null }],
  }),
  (error: unknown) => (error as { code?: string }).code === "PERSON_NOT_AVAILABLE",
);

const matches = searchModule.personMatchesSearch as (person: unknown, query: string) => boolean;
const person = {
  name: "张三",
  phone: "13800000000",
  type: "employee",
  status: "active",
  organizations: [{ organization: { name: "安全生产部" } }],
};
assert.equal(matches(person, "张三"), true);
assert.equal(matches(person, "1380000"), true);
assert.equal(matches(person, "安全生产部"), true);
assert.equal(matches(person, "正式员工"), true);
assert.equal(matches(person, "不存在"), false);

console.log("PEOPLE_BULK_MANAGEMENT_CHECK=PASS");
