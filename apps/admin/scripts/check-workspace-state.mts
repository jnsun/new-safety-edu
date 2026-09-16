import assert from "node:assert/strict";
import {
  groupOrganizations,
  readWorkspaceSelection,
  workspaceViewportClass,
  writeWorkspaceSelection,
} from "../src/people-organization/workspace-state.ts";

const rows = [
  { id: "root", name: "物化院有限公司", type: "company", memberCount: 0 },
  { id: "dept-2", name: "制图中心", type: "department", memberCount: 4 },
  { id: "entity-1", name: "地信中心", type: "business_entity", memberCount: 8 },
  { id: "contractor-1", name: "外协单位", type: "contractor", memberCount: 2 },
  { id: "dept-1", name: "人力资源部", type: "department", memberCount: 5 },
];

assert.deepEqual(groupOrganizations(rows).map(({ type, rows }) => [type, rows.length]), [
  ["business_entity", 1],
  ["department", 2],
  ["contractor", 1],
]);
const ids = ["entity-1", "dept-1", "dept-2", "contractor-1"];
assert.equal(readWorkspaceSelection(new URLSearchParams("organizationId=dept-2"), "organizationId", ids), "dept-2");
assert.equal(readWorkspaceSelection(new URLSearchParams("organizationId=missing"), "organizationId", ids), "entity-1");
assert.equal(writeWorkspaceSelection(new URLSearchParams("q=地质"), "organizationId", "dept-1").toString(), "q=%E5%9C%B0%E8%B4%A8&organizationId=dept-1");
assert.equal(workspaceViewportClass({ compact: false }), "master-workbench");
assert.equal(workspaceViewportClass({ compact: true }), "master-workbench is-compact");

console.log("workspace state check passed");
