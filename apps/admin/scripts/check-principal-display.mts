import assert from "node:assert/strict";
import { principalRoleSummary } from "../src/principal-display.ts";

const labels = {
  company_admin: "公司管理员",
  org_admin: "组织管理员",
  learner: "普通人员",
};

assert.equal(
  principalRoleSummary(
    [
      { role: "org_admin" },
      { role: "org_admin" },
      { role: "learner" },
    ],
    labels,
  ),
  "组织管理员",
);
assert.equal(principalRoleSummary([], labels), "普通人员");

console.log("principal display check passed");
