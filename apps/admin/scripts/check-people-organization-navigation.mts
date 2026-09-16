import assert from "node:assert/strict";
import { masterDataSelectedKey, peopleOrganizationNav } from "../src/people-organization/navigation.ts";

assert.deepEqual(
  peopleOrganizationNav.filter((item) => !item.companyAdminOnly).map((item) => item.label),
  ["人员档案", "组织与职责", "项目与成员", "审核中心", "数据工具"],
);
assert.equal(
  peopleOrganizationNav.find((item) => item.key === "/people/account-issues")?.companyAdminOnly,
  true,
);
assert.equal(masterDataSelectedKey("/people/9f2c"), "/people");
assert.equal(masterDataSelectedKey("/people/reviews"), "/people/reviews");
assert.equal(masterDataSelectedKey("/projects"), "/projects");

console.log("people organization navigation check passed");
