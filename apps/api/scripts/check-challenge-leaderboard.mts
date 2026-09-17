import assert from "node:assert/strict";
import { personalLeaderboardView, rankOrganizationScores, rankPersonalScores } from "../src/challenge-leaderboard.js";
import { readFile } from "node:fs/promises";

const organizations = rankOrganizationScores([
  { organizationId: "a", name: "甲部门", type: "department", activePersonCount: 30, participantCount: 20, totalPoints: 300 },
  { organizationId: "b", name: "乙部门", type: "business_entity", activePersonCount: 5, participantCount: 5, totalPoints: 100 },
  { organizationId: "c", name: "小部门", type: "department", activePersonCount: 2, participantCount: 1, totalPoints: 60 },
  { organizationId: "d", name: "外协", type: "contractor", activePersonCount: 50, participantCount: 50, totalPoints: 5_000 }
]);
assert.equal(organizations.find(({ organizationId }) => organizationId === "a")?.averagePoints, 10);
assert.equal(organizations.find(({ organizationId }) => organizationId === "b")?.averagePoints, 20);
assert.equal(organizations.find(({ organizationId }) => organizationId === "c")?.rewardEligible, false);
assert.equal(organizations.some(({ organizationId }) => organizationId === "d"), false);

const reached = new Date("2026-09-01T00:00:00Z");
const people = rankPersonalScores([
  { personId: "late", name: "晚", organizationName: "甲", points: 10, reachedAt: new Date("2026-09-02T00:00:00Z") },
  { personId: "early", name: "早", organizationName: "甲", points: 10, reachedAt: reached },
  { personId: "high", name: "高", organizationName: "乙", points: 12, reachedAt: reached }
], new Map([["early", 1], ["high", 2]]));
assert.deepEqual(people.map(({ personId }) => personId), ["high", "early", "late"]);
assert.equal(people[0]?.rankChange, 1);
assert.equal(personalLeaderboardView(people, "early", 20, 1).nearby.length, 3);

const routes = await readFile(new URL("../src/routes/daily-challenge.ts", import.meta.url), "utf8");
assert.match(routes, /get\("\/api\/challenge\/leaderboards"/);
assert.match(routes, /challengeMonthlyOrganizationSnapshot\.createMany/);
assert.match(routes, /voidedAt: null/);
assert.match(routes, /type: \{ in: \["department", "business_entity"\] \}/);

console.log("CHALLENGE_LEADERBOARD_OK");
