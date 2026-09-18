import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const schema = await readFile(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = await readFile(resolve(root, "prisma/migrations/202609170005_daily_safety_challenge/migration.sql"), "utf8");

assert.match(schema, /challengeEnabled\s+Boolean\s+@default\(false\)/);
assert.match(schema, /model ChallengeAttempt[\s\S]*@@unique\(\[personId, challengeDate\]\)/);
assert.match(schema, /model ChallengeAnswer[\s\S]*@@unique\(\[attemptId, questionVersionId\]\)/);
assert.match(schema, /model ChallengePointLedger[\s\S]*sourceKey\s+String\s+@unique/);
assert.match(schema, /model ChallengePointLedger[\s\S]*voidedAt\s+DateTime\?/);
assert.match(schema, /model ChallengeMonthlyOrganizationSnapshot[\s\S]*@@unique\(\[month, organizationId\]\)/);
assert.match(migration, /challenge_point_ledgers_void_check/);
assert.match(migration, /challenge_answers_points_check/);
assert.match(migration, /FOREIGN KEY \("person_id"\) REFERENCES "persons"/);
assert.match(migration, /FOREIGN KEY \("organization_id_snapshot"\) REFERENCES "organizations"/);

console.log("DAILY_CHALLENGE_SCHEMA_OK");
