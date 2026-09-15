import assert from "node:assert/strict";
import type { Principal } from "../src/auth.js";
import { canGrantScopedRole, canJoinProject, canManagePersonStatus } from "../src/identity.js";

const principal = (role: Principal["roles"][number]["role"], scopeType: Principal["roles"][number]["scopeType"], scopeId: string | null): Principal => ({
  accountId: "00000000-0000-0000-0000-000000000001",
  personId: "00000000-0000-0000-0000-000000000002",
  roles: [{ role, scopeType, scopeId }]
});

const company = principal("company_admin", "company", null);
const entityLeader = principal("org_leader", "organization", "entity-a");
const departmentAdmin = principal("org_admin", "organization", "department-a");
const projectAdmin = principal("project_admin", "project", "project-a");

assert.equal(canGrantScopedRole(company, { role: "org_leader", scopeType: "organization", scopeId: "department-a", organizationType: "department" }), true);
assert.equal(canGrantScopedRole(entityLeader, { role: "field_reporter", scopeType: "organization", scopeId: "entity-a", organizationType: "business_entity" }), true);
assert.equal(canGrantScopedRole(entityLeader, { role: "project_admin", scopeType: "project", scopeId: "project-a", projectResponsibleOrganizationId: "entity-a" }), true);
assert.equal(canGrantScopedRole(departmentAdmin, { role: "field_reporter", scopeType: "organization", scopeId: "department-a", organizationType: "department" }), false);
assert.equal(canGrantScopedRole(departmentAdmin, { role: "project_admin", scopeType: "project", scopeId: "project-a", projectResponsibleOrganizationId: "entity-a" }), false);
assert.equal(canGrantScopedRole(projectAdmin, { role: "project_admin", scopeType: "project", scopeId: "project-a", projectResponsibleOrganizationId: "entity-a" }), false);

assert.equal(canManagePersonStatus(company, []), true);
assert.equal(canManagePersonStatus(entityLeader, ["entity-a"]), true);
assert.equal(canManagePersonStatus(entityLeader, ["entity-b"]), false);
assert.equal(canManagePersonStatus(projectAdmin, ["entity-a"]), false);

assert.equal(canJoinProject("employee", "business_entity"), true);
assert.equal(canJoinProject("contractor", "business_entity"), true);
assert.equal(canJoinProject("temporary_individual", "business_entity"), true);
assert.equal(canJoinProject("employee", "department"), false);
assert.equal(canJoinProject("contractor", "contractor"), false);

console.log("PHASE1_POLICY_OK");
