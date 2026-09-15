import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

for (const expected of [
  "merged\n}",
  "account_merge",
  "mergedIntoAccountId",
  "endedAt",
  "endReason"
]) assert.ok(schema.includes(expected), `Prisma schema is missing ${expected}`);

const migration = await readFile(new URL("../../../prisma/migrations/202609140009_phase1_identity_integrity/migration.sql", import.meta.url), "utf8");
for (const expected of [
  "organization_memberships_one_active_primary_per_person",
  "role_assignments_one_active_org_leader",
  "role_assignments_one_active_assignment"
]) assert.ok(migration.includes(expected), `Migration is missing ${expected}`);

for (const route of ["phone-auth.ts", "wechat.ts"]) {
  const source = await readFile(new URL(`../src/routes/${route}`, import.meta.url), "utf8");
  assert.ok(!source.includes("account.delete"), `${route} must not physically delete account collisions`);
}

const day1 = await readFile(new URL("../src/routes/day1.ts", import.meta.url), "utf8");
assert.ok(day1.includes("/api/auth/reauthenticate"), "Sensitive reveal must require explicit reauthentication");
assert.ok(day1.includes("verifySensitiveToken"), "Sensitive reveal route must verify the short-lived token");
const day4 = await readFile(new URL("../src/routes/day4.ts", import.meta.url), "utf8");
assert.ok(!day1.includes("organizationMembership.upsert") && !day4.includes("organizationMembership.upsert"), "Primary organization changes must append history instead of upserting old rows");
assert.ok(!day1.includes("roleAssignment.upsert"), "Role grants must append history instead of reactivating old rows");
const safetyManagement = await readFile(new URL("../src/routes/safety-management.ts", import.meta.url), "utf8");
assert.ok(!safetyManagement.includes("certificateNo: certificateNumber"), "Ordinary profile/detail responses must not expose full certificate numbers");
assert.ok(day1.includes('app.delete("/api/persons/:id"'), "Company administrators need a guarded empty-person delete route");

console.log("PHASE1_INVARIANTS_OK");
