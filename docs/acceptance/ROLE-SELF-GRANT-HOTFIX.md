# Role self-grant P0 hotfix

## Scope

Reject a management-role assignment when the acting principal's `personId` is the requested target `personId`, regardless of which management role is being assigned. This closes a privilege-escalation path in `POST /api/roles` without changing role scope rules for assignments to other people.

## Evidence

- Before the fix, the isolated test deployment accepted `QA_SAFETY_ONLY` granting `field_reporter` to its own person record (`201`). The temporary QA role was immediately revoked by the company-admin QA identity and confirmed inactive. Other QA identity checks, monthly submission idempotency, and synthetic account/person lifecycle checks passed.
- Local regression: the normal-login monthly-report integration flow submits an organization-admin self-grant and asserts `409 ROLE_SELF_GRANT_FORBIDDEN`; it passed against the dedicated loopback `monthly_reporting_e2e_test` database with zero residual rows.
- Build and policy checks are recorded after this patch is validated. The test deployment is not considered fixed until the deployed image and the same QA probe pass.

## Change

`POST /api/roles` now rejects any self-targeted management-role grant with `409 ROLE_SELF_GRANT_FORBIDDEN` before target lookup or role mutation. The existing company-admin-specific self-check remains as defense in depth.

No schema, migration, permission model, or existing assignment scope behavior changed.
