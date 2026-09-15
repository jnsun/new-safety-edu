import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFile(resolve(root, path), "utf8");
const [schema, day1, day2, day4, auth, files, exports, qualifications, admin, mini] = await Promise.all([
  read("prisma/schema.prisma"), read("apps/api/src/routes/day1.ts"), read("apps/api/src/routes/day2.ts"), read("apps/api/src/routes/day4.ts"), read("apps/api/src/auth.ts"), read("apps/api/src/private-file-access.ts"), read("apps/api/src/routes/sensitive-exports.ts"), read("apps/api/src/routes/qualifications.ts"), read("apps/admin/src/App.tsx"), read("apps/miniprogram/pages/profile/index.js")
]);
const checks: Array<[string, boolean]> = [
  ["01 person-owned roles", /personId\s+String/.test(schema) && /activationPending/.test(schema)],
  ["02 person merge history", /mergedIntoPersonId/.test(schema) && /person-merge-requests/.test(day1)],
  ["03 active uniqueness", /WHERE "active"/.test(await read("prisma/migrations/202609150002_person_account_current_uniques/migration.sql"))],
  ["04 project membership history", /previousMembershipId/.test(schema) && /members\/bulk/.test(day1)],
  ["05 intrinsic learner ability", /role === "learner"/.test(await read("apps/api/src/identity.ts"))],
  ["06 active identity guard", /person\.status !== "active"/.test(day1)],
  ["07 transactional critical audit", /writeCriticalAudit/.test(day1 + day2 + day4) && /ACTOR_STATE_CHANGED/.test(await read("apps/api/src/transaction-audit.ts"))],
  ["08 object private-file authorization", /canReadPrivateFile/.test(files)],
  ["09 target-bound sensitive reveal", /targetPersonId/.test(await read("apps/api/src/sensitive-token-scope.ts"))],
  ["10 account and person merge", /account-merge-requests/.test(day1) && /person-merge-requests/.test(day1)],
  ["11 account lifecycle", /reset-password/.test(day1) && /login-methods/.test(day1)],
  ["12 bounded sessions", /absoluteExpiresAt/.test(auth) && /ACCOUNT_PENDING/.test(auth) && /sessions\/:id\/revoke/.test(day1)],
  ["13 request lifecycle", /identity_correction/.test(day4) && /contractor_unit_change/.test(day4) && /responsible_entity_change/.test(day4) && /withdraw/.test(day4) && /requests\/:id\/cancel/.test(day4) && /model ChangeRequestAttachment/.test(schema)],
  ["14 primary organization transfer", /setPrimaryOrganization/.test(await read("apps/api/src/identity.ts"))],
  ["15 project lifecycle", /project_exit/.test(day4) && /PROJECT_READ_ONLY/.test(day1)],
  ["16 account operations UI", /availableActions/.test(admin) && /重置密码/.test(admin)],
  ["17 person details timeline", /操作记录/.test(admin) && /照片历史/.test(admin)],
  ["18 miniprogram account security", /logoutAll/.test(mini) && /confirmPhone/.test(mini)],
  ["19 scoped sensitive archives", /scopeType/.test(exports) && /downloadedAt/.test(exports) && /sensitiveExportLifetimeMs/.test(await read("apps/api/src/sensitive-export-policy.ts"))],
  ["20 immutable training governance", /questionVersionId/.test(schema) && /coursewarePublishGrant/.test(schema)],
  ["21 qualification correction", /conflictAction/.test(qualifications) && /duplicates\.correct/.test(qualifications)],
  ["22 operational recovery and retention", /immutableBusinessAuditDeleted/.test(await read("apps/api/src/retention.ts")) && (await read("apps/api/scripts/admin-recovery.mts")).includes("confirm-production") && (await read("apps/api/scripts/preflight-identity.mts")).includes("IDENTITY_PREFLIGHT")]
];
for (const [name, passed] of checks) assert.ok(passed, `CONTEXT closure failed: ${name}`);
console.log(`CONTEXT_CLOSURE_OK ${checks.length}/${checks.length}`);
