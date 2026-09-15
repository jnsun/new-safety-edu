import assert from "node:assert/strict";
import { canReadPrivateFile, type PrivateFileFacts } from "../src/private-file-policy.js";

const principal = (personId: string | null, roles: Array<{ role: string; scopeType: string; scopeId: string | null }> = []) => ({ accountId: "account-reader", personId, roles });
const base: PrivateFileFacts = { uploadedBy: "account-uploader", linked: true, photos: [], signatures: [], personCertificates: [], organizationQualifications: [], monthlyReports: [], coursewares: [], trainingAttachments: [], requestAttachments: [] };

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

console.log("PRIVATE_FILE_POLICY_OK");
