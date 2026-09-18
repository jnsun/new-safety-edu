import assert from "node:assert/strict";
import { canReadPrivateFile, type PrivateFileFacts } from "../src/private-file-policy.js";

const principal = (personId: string | null, roles: Array<{ role: string; scopeType: string; scopeId: string | null }> = []) => ({ accountId: "account-reader", personId, roles });
const base: PrivateFileFacts = { uploadedBy: "account-uploader", linked: true, photos: [], signatures: [], personCertificates: [], organizationQualifications: [], monthlyReports: [], coursewares: [], trainingAttachments: [], requestAttachments: [], receivableAttachments: [], receivableImportBatches: [] };

assert.equal(canReadPrivateFile(principal("person-a"), { ...base, photos: [{ personId: "person-a", organizationIds: [], projectIds: [] }] }), true);
assert.equal(canReadPrivateFile(principal(null, [{ role: "project_admin", scopeType: "project", scopeId: "project-a" }]), { ...base, signatures: [{ personId: "person-a", organizationIds: ["org-a"], projectId: "project-a" }] }), true);
assert.equal(canReadPrivateFile(principal(null, [{ role: "project_admin", scopeType: "project", scopeId: "project-a" }]), { ...base, signatures: [{ personId: "person-a", organizationIds: ["org-a"], projectId: "project-b" }] }), false);
assert.equal(canReadPrivateFile(principal(null, [{ role: "project_admin", scopeType: "project", scopeId: "project-a" }]), { ...base, personCertificates: [{ personId: "person-a", organizationIds: ["org-a"], projectIds: ["project-a"] }] }), true);
assert.equal(canReadPrivateFile(principal(null, [{ role: "org_admin", scopeType: "organization", scopeId: "org-a" }]), { ...base, personCertificates: [{ personId: "person-a", organizationIds: ["org-a"], projectIds: [] }] }), true);
assert.equal(canReadPrivateFile(principal(null, [{ role: "org_admin", scopeType: "organization", scopeId: "org-a" }]), { ...base, organizationQualifications: [{ organizationId: "org-b" }] }), false);
assert.equal(canReadPrivateFile(principal(null, [{ role: "project_admin", scopeType: "project", scopeId: "project-a" }]), { ...base, monthlyReports: [{ projectId: "project-a", organizationId: "org-b" }] }), true);
assert.equal(canReadPrivateFile(principal("person-a"), { ...base, trainingAttachments: [{ projectId: null, organizationId: "org-a", personIds: ["person-a"] }] }), true);
assert.equal(canReadPrivateFile(principal(null, [{ role: "project_admin", scopeType: "project", scopeId: "project-a" }]), { ...base, requestAttachments: [{ accountId: "applicant", personId: null, organizationId: null, projectId: "project-a" }] }), true);
assert.equal(canReadPrivateFile(principal(null, [{ role: "company_admin", scopeType: "company", scopeId: null }]), base), true);
assert.equal(canReadPrivateFile(principal(null), { ...base, linked: false, uploadedBy: "account-reader" }), true);
assert.equal(canReadPrivateFile(principal(null), { ...base, uploadedBy: "account-reader" }), false);
assert.equal(canReadPrivateFile(principal("person-a"), { ...base, coursewares: [{ scopeType: "company", scopeId: null, personIds: ["person-a"] }] }), true, "assigned learner can read an asset linked to the exact courseware version");
assert.equal(canReadPrivateFile(principal("person-b"), { ...base, coursewares: [{ scopeType: "company", scopeId: null, personIds: ["person-a"] }] }), false, "another learner cannot read an asset by UUID alone");

const receivablesReader = (access: { role: "owner" | "admin" | "reporter" | "readonly" | null; canReadLedger: boolean; canViewAll: boolean; readDepartmentIds: string[] }) => ({ ...principal(null, [{ role: "company_admin", scopeType: "company", scopeId: null }]), receivablesAccess: access });
const activeReceivable = { financeDepartmentId: "finance-department-a", status: "active" as const };
assert.equal(canReadPrivateFile(receivablesReader({ role: "reporter", canReadLedger: true, canViewAll: false, readDepartmentIds: ["finance-department-a"] }), { ...base, receivableAttachments: [activeReceivable] }), true);
assert.equal(canReadPrivateFile(receivablesReader({ role: "reporter", canReadLedger: true, canViewAll: false, readDepartmentIds: ["finance-department-b"] }), { ...base, receivableAttachments: [activeReceivable] }), false);
assert.equal(canReadPrivateFile(receivablesReader({ role: null, canReadLedger: false, canViewAll: false, readDepartmentIds: [] }), { ...base, receivableAttachments: [activeReceivable] }), false);
assert.equal(canReadPrivateFile(receivablesReader({ role: "readonly", canReadLedger: true, canViewAll: true, readDepartmentIds: [] }), { ...base, receivableAttachments: [activeReceivable] }), true);
assert.equal(canReadPrivateFile(receivablesReader({ role: "reporter", canReadLedger: true, canViewAll: true, readDepartmentIds: [] }), { ...base, receivableAttachments: [{ ...activeReceivable, status: "voided" }] }), false);
assert.equal(canReadPrivateFile(receivablesReader({ role: "owner", canReadLedger: true, canViewAll: true, readDepartmentIds: [] }), { ...base, receivableAttachments: [{ ...activeReceivable, status: "voided" }] }), true);
assert.equal(canReadPrivateFile(receivablesReader({ role: "owner", canReadLedger: false, canViewAll: false, readDepartmentIds: [] }), { ...base, receivableAttachments: [activeReceivable] }), false, "pending-confirmation owner must not read active receivables attachments");
assert.equal(canReadPrivateFile(receivablesReader({ role: "owner", canReadLedger: false, canViewAll: false, readDepartmentIds: [] }), { ...base, receivableAttachments: [{ ...activeReceivable, status: "voided" }] }), false, "pending-confirmation owner must not read voided receivables attachments");

const importOriginal = { ...base, uploadedBy: "account-reader", receivableImportBatches: [{}] };
assert.equal(canReadPrivateFile(receivablesReader({ role: "owner", canReadLedger: true, canViewAll: true, readDepartmentIds: [] }), importOriginal), true);
assert.equal(canReadPrivateFile(receivablesReader({ role: "admin", canReadLedger: true, canViewAll: true, readDepartmentIds: [] }), importOriginal), true);
assert.equal(canReadPrivateFile(receivablesReader({ role: "reporter", canReadLedger: true, canViewAll: true, readDepartmentIds: [] }), importOriginal), false);
assert.equal(canReadPrivateFile(receivablesReader({ role: "readonly", canReadLedger: true, canViewAll: true, readDepartmentIds: [] }), importOriginal), false);
assert.equal(canReadPrivateFile(receivablesReader({ role: null, canReadLedger: false, canViewAll: false, readDepartmentIds: [] }), importOriginal), false);
assert.equal(canReadPrivateFile(receivablesReader({ role: "owner", canReadLedger: false, canViewAll: false, readDepartmentIds: [] }), importOriginal), false, "pending-confirmation owner must not read receivables import originals");

console.log("PRIVATE_FILE_POLICY_OK");
