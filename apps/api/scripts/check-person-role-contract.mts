import assert from "node:assert/strict";
import { roleAssignmentCreateSchema } from "@safety/contracts";

const personId = "00000000-0000-4000-8000-000000000001";
const organizationId = "00000000-0000-4000-8000-000000000002";

assert.equal(roleAssignmentCreateSchema.parse({
  personId,
  role: "org_admin",
  scopeType: "organization",
  scopeId: organizationId,
  reason: "日常组织管理授权"
}).personId, personId);

assert.equal(roleAssignmentCreateSchema.safeParse({
  accountId: personId,
  role: "org_admin",
  scopeType: "organization",
  scopeId: organizationId,
  reason: "不允许按账号直接授权"
}).success, false);

assert.equal(roleAssignmentCreateSchema.safeParse({
  personId,
  role: "learner",
  scopeType: "person",
  scopeId: personId,
  reason: "普通人员能力不再手工授权"
}).success, false);

console.log("PERSON_ROLE_CONTRACT_OK");
