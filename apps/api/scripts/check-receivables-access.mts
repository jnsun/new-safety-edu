import assert from "node:assert/strict";
import { decideReceivablesAccess, receivablesRoleAssignmentSubjects, requireReceivables, selectSingleReceivablesGrant } from "../src/receivables-access.js";

const unconfiguredAdmin = decideReceivablesAccess({
  accountActive: true,
  personActive: true,
  isCompanyAdmin: true,
  configured: false,
  grant: null,
});
assert.equal(unconfiguredAdmin.state, "unconfigured");
assert.equal(unconfiguredAdmin.canRecover, true);
assert.equal(decideReceivablesAccess({ accountActive: true, personActive: false, isCompanyAdmin: true, configured: false }).canRecover, true);
assert.deepEqual(receivablesRoleAssignmentSubjects("account-1", "person-1"), [{ accountId: "account-1" }, { personId: "person-1" }]);
assert.equal(unconfiguredAdmin.canEnter, false);

const pendingOwner = decideReceivablesAccess({
  accountActive: true,
  personActive: true,
  configured: true,
  configurationConfirmed: false,
  isBoundOrgLeader: true,
  grant: null,
});
assert.equal(pendingOwner.state, "pending_confirmation");
assert.equal(pendingOwner.role, "owner");
assert.equal(pendingOwner.canConfirmSetup, true);
assert.equal(pendingOwner.canEnter, false);

const owner = decideReceivablesAccess({ accountActive: true, personActive: true, isBoundOrgLeader: true, grant: null });
assert.equal(owner.role, "owner");
assert.equal(owner.canManageAll, true);
assert.equal(owner.canViewAll, true);
assert.equal(owner.canMaintainCollection, true);

const configuredAdmin = decideReceivablesAccess({ accountActive: true, personActive: true, isCompanyAdmin: true, configured: true, grant: null });
assert.equal(configuredAdmin.canReadLedger, false);
assert.equal(configuredAdmin.canRecover, true);

const financeDepartmentMember = decideReceivablesAccess({
  accountActive: true,
  personActive: true,
  configured: true,
  isFinanceOrganizationMember: true,
  grant: null,
});
assert.equal(financeDepartmentMember.role, "readonly");
assert.equal(financeDepartmentMember.canEnter, true);
assert.equal(financeDepartmentMember.canReadLedger, true);
assert.equal(financeDepartmentMember.canViewAll, true);
assert.equal(financeDepartmentMember.canWriteLedger, false);
assert.equal(financeDepartmentMember.canCreateLedger, false);
assert.equal(financeDepartmentMember.canExport, false);
assert.equal(financeDepartmentMember.canManageConfiguration, false);
assert.doesNotThrow(() => requireReceivables(financeDepartmentMember, "read", "any-department"));
assert.throws(() => requireReceivables(financeDepartmentMember, "write", "any-department"), { code: "RECEIVABLES_FORBIDDEN", statusCode: 403 });

const financeAdmin = decideReceivablesAccess({
  accountActive: true,
  personActive: true,
  configured: true,
  isBoundOrgLeader: false,
  grant: { role: "admin", canCreate: false, canExport: false, canViewAll: false, departments: [] },
});
assert.equal(financeAdmin.role, "admin");
assert.equal(financeAdmin.canManageAll, true);
assert.equal(financeAdmin.canManageAccess, false);

const reporter = decideReceivablesAccess({
  accountActive: true,
  personActive: true,
  configured: true,
  grant: {
    role: "reporter",
    canCreate: true,
    canExport: false,
    canViewAll: false,
    canMaintainCollection: true,
    departments: [
      { departmentId: "department-a", canRead: true, canWrite: true },
      { departmentId: "department-b", canRead: true, canWrite: false },
    ],
  },
});
assert.equal(reporter.canCreateLedger, true);
assert.equal(reporter.canMaintainCollection, true);
assert.deepEqual(reporter.readDepartmentIds, ["department-a", "department-b"]);
assert.deepEqual(reporter.writeDepartmentIds, ["department-a"]);
assert.doesNotThrow(() => requireReceivables(reporter, "read", "department-b"));
assert.throws(() => requireReceivables(reporter, "write", "department-b"), { code: "RECEIVABLES_FORBIDDEN", statusCode: 403 });

const viewer = decideReceivablesAccess({
  accountActive: true,
  personActive: true,
  configured: true,
  grant: {
    role: "readonly",
    canCreate: true,
    canExport: true,
    canViewAll: false,
    departments: [{ departmentId: "department-a", canRead: true, canWrite: true }],
  },
});
assert.equal(viewer.canCreateLedger, false);
assert.equal(viewer.canWriteLedger, false);
assert.equal(viewer.canExport, true);
assert.equal(viewer.canMaintainCollection, false);
assert.deepEqual(viewer.writeDepartmentIds, []);

assert.equal(decideReceivablesAccess({ accountActive: false, personActive: true, grant: { role: "admin" } }).canEnter, false);
assert.equal(decideReceivablesAccess({ accountActive: true, personActive: false, grant: { role: "admin" } }).canEnter, false);
assert.equal(selectSingleReceivablesGrant([{ role: "admin" }, { role: "readonly" }]), null);

console.log("RECEIVABLES_ACCESS_OK");
