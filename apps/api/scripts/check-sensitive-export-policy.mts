import assert from "node:assert/strict";
import { assertSensitiveExportScopeAllowed, sanitizeAuditValue, sensitiveExportLifetimeMs } from "../src/sensitive-export-policy.js";

const company = [{ role: "company_admin", scopeType: "company", scopeId: null }];
const organization = [{ role: "org_admin", scopeType: "organization", scopeId: "org-1" }];
const project = [{ role: "project_admin", scopeType: "project", scopeId: "project-1" }];

assert.doesNotThrow(() => assertSensitiveExportScopeAllowed(company, { scopeType: "company", scopeId: null }));
assert.doesNotThrow(() => assertSensitiveExportScopeAllowed(organization, { scopeType: "organization", scopeId: "org-1" }));
assert.doesNotThrow(() => assertSensitiveExportScopeAllowed(organization, { scopeType: "project", scopeId: "project-2", projectResponsibleOrganizationId: "org-1" }));
assert.doesNotThrow(() => assertSensitiveExportScopeAllowed(project, { scopeType: "project", scopeId: "project-1", projectResponsibleOrganizationId: "org-2" }));
assert.throws(() => assertSensitiveExportScopeAllowed(organization, { scopeType: "organization", scopeId: "org-2" }), /范围/);
assert.throws(() => assertSensitiveExportScopeAllowed(project, { scopeType: "project", scopeId: "project-2", projectResponsibleOrganizationId: "org-2" }), /范围/);
assert.throws(() => assertSensitiveExportScopeAllowed([{ role: "field_reporter", scopeType: "organization", scopeId: "org-1" }], { scopeType: "organization", scopeId: "org-1" }), /权限/);
assert.doesNotThrow(() => assertSensitiveExportScopeAllowed([], { scopeType: "self", scopeId: "person-1", requesterPersonId: "person-1" }));
assert.throws(() => assertSensitiveExportScopeAllowed([], { scopeType: "self", scopeId: "person-2", requesterPersonId: "person-1" }), /本人/);
assert.equal(sensitiveExportLifetimeMs, 10 * 60 * 1000);

assert.deepEqual(sanitizeAuditValue({ reason: "保留", token: "禁止", nested: { passwordHash: "禁止", value: 2 }, rows: [{ openid: "禁止", name: "保留" }] }), { reason: "保留", nested: { value: 2 }, rows: [{ name: "保留" }] });
console.log("SENSITIVE_EXPORT_POLICY_OK");
