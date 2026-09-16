import assert from "node:assert/strict";
import { assertWechatVerificationPurpose, canReviewWechatIdentityRequest, decideWechatBinding } from "../src/wechat-identity-policy.js";

const orgAdmin = { accountId: "a", personId: "p", mustChangePassword: false, sessionId: null, roles: [{ role: "org_admin", scopeType: "organization", scopeId: "org-a" }] } as const;
const orgLeader = { ...orgAdmin, roles: [{ role: "org_leader", scopeType: "organization", scopeId: "org-a" }] } as const;
const companyAdmin = { ...orgAdmin, roles: [{ role: "company_admin", scopeType: "company", scopeId: null }] } as const;

assert.equal(canReviewWechatIdentityRequest(orgAdmin, "org-a", false), true);
assert.equal(canReviewWechatIdentityRequest(orgAdmin, "org-b", false), false);
assert.equal(canReviewWechatIdentityRequest(orgLeader, "org-a", false), false);
assert.equal(canReviewWechatIdentityRequest(companyAdmin, "org-a", false), true);
assert.equal(canReviewWechatIdentityRequest(orgAdmin, "org-a", true), false);

assert.equal(decideWechatBinding({ activePersonMatches: 1, selectedOrganizationMatches: true, hasIdentityConflict: false, crossEntityConflict: false }), "direct");
assert.equal(decideWechatBinding({ activePersonMatches: 0, selectedOrganizationMatches: false, hasIdentityConflict: false, crossEntityConflict: false }), "organization_review");
assert.equal(decideWechatBinding({ activePersonMatches: 1, selectedOrganizationMatches: false, hasIdentityConflict: false, crossEntityConflict: false }), "organization_review");
assert.equal(decideWechatBinding({ activePersonMatches: 2, selectedOrganizationMatches: false, hasIdentityConflict: true, crossEntityConflict: false }), "company_review");
assert.equal(decideWechatBinding({ activePersonMatches: 1, selectedOrganizationMatches: false, hasIdentityConflict: false, crossEntityConflict: true }), "company_review");

assert.equal(assertWechatVerificationPurpose("wechat_bind"), "wechat_bind");
assert.equal(assertWechatVerificationPurpose("wechat_rebind"), "wechat_rebind");
assert.throws(() => assertWechatVerificationPurpose("login"), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_SMS_PURPOSE");

console.log("WECHAT_IDENTITY_POLICY_OK");
