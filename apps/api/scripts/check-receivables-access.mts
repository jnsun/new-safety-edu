import assert from "node:assert/strict";
import { assertReceivablesFinanceOrganization, decideReceivablesAccess, requireReceivables, selectReceivablesFinanceOrganization, selectSingleReceivablesGrant } from "../src/receivables-access.js";
import { assertReceivablesGrantManagement, receivablesGrantSubjectDisposition } from "../src/receivables-admin.js";
import { receivableSettingBinding, selectFinanceOrganizationId } from "../../../prisma/receivables-defaults.js";

assert.equal(selectFinanceOrganizationId([{ id: "finance-org" }]), "finance-org");
assert.throws(() => selectFinanceOrganizationId([]), /财务资产部必须且只能存在一个/);
assert.throws(() => selectFinanceOrganizationId([{ id: "a" }, { id: "b" }]), /财务资产部必须且只能存在一个/);
assert.deepEqual(receivableSettingBinding("finance-org", "finance-org"), { financeOrganizationId: "finance-org" });
assert.deepEqual(receivableSettingBinding("old-org", "finance-org"), { financeOrganizationId: "finance-org", configurationConfirmedAt: null, configurationConfirmedBy: null });
assert.doesNotThrow(() => assertReceivablesFinanceOrganization({ type: "department" }));
assert.throws(() => assertReceivablesFinanceOrganization(null), { code: "RECEIVABLES_FINANCE_ORGANIZATION_INVALID", statusCode: 409 });
assert.throws(() => assertReceivablesFinanceOrganization({ type: "business_entity" }), { code: "RECEIVABLES_FINANCE_ORGANIZATION_INVALID", statusCode: 409 });
assert.equal(selectReceivablesFinanceOrganization([{ id: "finance", type: "department" }])?.id, "finance");
assert.equal(selectReceivablesFinanceOrganization([]), null);
assert.equal(selectReceivablesFinanceOrganization([{ id: "a", type: "department" }, { id: "b", type: "department" }]), null);
assert.equal(receivablesGrantSubjectDisposition({ personType: "employee", personStatus: "active", accountStatus: "active" }), "existing");
assert.equal(receivablesGrantSubjectDisposition({ personType: "employee", personStatus: "active", accountStatus: "pending" }), "existing");
assert.equal(receivablesGrantSubjectDisposition({ personType: "employee", personStatus: "active", accountStatus: null }), "create_pending");
assert.throws(() => receivablesGrantSubjectDisposition({ personType: "employee", personStatus: "active", accountStatus: "disabled" }), { code: "RECEIVABLES_GRANT_SUBJECT_INACTIVE", statusCode: 409 });
assert.throws(() => receivablesGrantSubjectDisposition({ personType: "contractor", personStatus: "active", accountStatus: null }), { code: "RECEIVABLES_GRANT_SUBJECT_INACTIVE", statusCode: 409 });

const unconfiguredAdmin = decideReceivablesAccess({
  accountActive: true,
  personActive: true,
  isCompanyAdmin: true,
  configured: false,
  grant: null,
});
assert.equal(unconfiguredAdmin.state, "unconfigured");
assert.equal(unconfiguredAdmin.canRecover, true);
assert.equal(decideReceivablesAccess({ accountActive: true, personActive: false, isCompanyAdmin: true, configured: false }).canRecover, false);
assert.equal(unconfiguredAdmin.canEnter, false);

const pendingOwnerCompanyAdmin = decideReceivablesAccess({
  accountActive: true,
  personActive: true,
  isCompanyAdmin: true,
  configured: true,
  configurationConfirmed: false,
  hasBoundOrgLeader: false,
  grant: null,
});
assert.equal(pendingOwnerCompanyAdmin.state, "pending_owner");
assert.equal(pendingOwnerCompanyAdmin.canRecover, true);
assert.equal(pendingOwnerCompanyAdmin.canEnter, false);

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
assert.equal(owner.canEnter, true);
assert.equal(owner.canReadLedger, true);
assert.equal(owner.canWriteLedger, false);
assert.equal(owner.canManageAll, false);
assert.equal(owner.canViewAll, true);
assert.equal(owner.canManageAccess, true);
assert.equal(owner.canManageConfiguration, true);
assert.equal(owner.canImport, true);
assert.equal(owner.canExport, true);
assert.equal(owner.canManageMoney, false);
assert.equal(owner.canMaintainCollection, false);

const configuredAdmin = decideReceivablesAccess({ accountActive: true, personActive: true, configured: true, grant: null });
assert.equal(configuredAdmin.canReadLedger, false);
assert.equal(configuredAdmin.canRecover, false);

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
assert.equal(financeAdmin.canManageAccess, true);
assert.doesNotThrow(() => assertReceivablesGrantManagement("owner", null, "admin"));
assert.doesNotThrow(() => assertReceivablesGrantManagement("owner", "admin", null));
assert.throws(() => assertReceivablesGrantManagement("owner", null, "reporter"), { code: "RECEIVABLES_ADMIN_GRANT_FORBIDDEN", statusCode: 403 });
assert.doesNotThrow(() => assertReceivablesGrantManagement("admin", null, "reporter"));
assert.doesNotThrow(() => assertReceivablesGrantManagement("admin", null, "readonly"));
assert.doesNotThrow(() => assertReceivablesGrantManagement("admin", "readonly", "reporter"));
assert.throws(() => assertReceivablesGrantManagement("admin", null, "admin"), { code: "RECEIVABLES_ADMIN_GRANT_FORBIDDEN", statusCode: 403 });
assert.throws(() => assertReceivablesGrantManagement("admin", "admin", null), { code: "RECEIVABLES_ADMIN_GRANT_FORBIDDEN", statusCode: 403 });
assert.doesNotThrow(() => assertReceivablesGrantManagement("owner", "admin", "admin"));

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
