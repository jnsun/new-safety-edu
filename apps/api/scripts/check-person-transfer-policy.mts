import assert from "node:assert/strict";
import { decidePersonTransfer } from "../src/person-transfer-policy.js";

const base = {
  currentOrganizationType: "business_entity" as const,
  targetOrganizationType: "business_entity" as const,
  isCurrentLeader: false,
  hasCrossEntityProjectAdminRole: true,
  keepCrossEntityProjectAdminRoles: false,
  actorIsCompanyAdmin: false
};

assert.deepEqual(decidePersonTransfer(base), { endOrganizationRoles: true, endProjectRoles: true, endProjectMemberships: false });
assert.deepEqual(decidePersonTransfer({ ...base, actorIsCompanyAdmin: true, keepCrossEntityProjectAdminRoles: true }), { endOrganizationRoles: true, endProjectRoles: false, endProjectMemberships: false });
assert.deepEqual(decidePersonTransfer({ ...base, targetOrganizationType: "department", hasCrossEntityProjectAdminRole: false }), { endOrganizationRoles: true, endProjectRoles: true, endProjectMemberships: true });
assert.throws(() => decidePersonTransfer({ ...base, isCurrentLeader: true }), /继任负责人/);
assert.throws(() => decidePersonTransfer({ ...base, keepCrossEntityProjectAdminRoles: true }), /公司管理员/);
assert.throws(() => decidePersonTransfer({ ...base, targetOrganizationType: "department", actorIsCompanyAdmin: true, keepCrossEntityProjectAdminRoles: true }), /普通部门/);
assert.throws(() => decidePersonTransfer({ ...base, targetOrganizationType: "company" }), /经营实体或部门/);

console.log("PERSON_TRANSFER_POLICY_OK");
