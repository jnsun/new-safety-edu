import assert from "node:assert/strict";
import { filterPeopleRows, peopleInOrganization, readPeopleView } from "../src/people-organization/people-list.ts";

const rows = [
  { id: "1", name: "张三", phone: "13800001111", status: "active", type: "employee", organizationIds: ["finance"], organizationNames: ["财务资产部"], accountStatus: "active", username: "zhangsan", roles: ["org_leader"] },
  { id: "2", name: "李四", phone: "13900002222", status: "active", type: "employee", organizationIds: ["safety"], organizationNames: ["安全生产部"], accountStatus: "none", username: null, roles: [] },
];

assert.deepEqual(filterPeopleRows(rows, { search: "zhangsan" }).map((row) => row.id), ["1"]);
assert.deepEqual(filterPeopleRows(rows, { search: "财务资产" }).map((row) => row.id), ["1"]);
assert.deepEqual(filterPeopleRows(rows, { organizationId: "safety" }).map((row) => row.id), ["2"]);
assert.deepEqual(filterPeopleRows(rows, { accountStatus: "none" }).map((row) => row.id), ["2"]);
assert.deepEqual(filterPeopleRows(rows, { role: "org_leader" }).map((row) => row.id), ["1"]);
const organizationRows = [
  { id: "1", organizations: [{ organization: { id: "finance" } }] },
  { id: "2", organizations: [{ organization: { id: "safety" } }] },
];
assert.deepEqual(peopleInOrganization(organizationRows, "finance").map((row) => row.id), ["1"]);
assert.deepEqual(peopleInOrganization(organizationRows, "missing"), []);
assert.equal(readPeopleView(null), "list");
assert.equal(readPeopleView("grouped"), "grouped");
assert.equal(readPeopleView("unexpected"), "list");

console.log("people list check passed");
