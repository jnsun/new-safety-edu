import assert from "node:assert/strict";
import { challengeAnswersEqual, challengeDateKey, challengeDayRange, challengeMonthRange, scoreFirstAnswer, selectDailyQuestions } from "../src/daily-challenge-policy.js";

assert.equal(scoreFirstAnswer({ correct: true, alreadyAnswered: false, dailyAwarded: 8 }), 2);
assert.equal(scoreFirstAnswer({ correct: true, alreadyAnswered: true, dailyAwarded: 4 }), 0);
assert.equal(scoreFirstAnswer({ correct: false, alreadyAnswered: false, dailyAwarded: 4 }), 0);
assert.equal(scoreFirstAnswer({ correct: true, alreadyAnswered: false, dailyAwarded: 10 }), 0);

const candidates = Array.from({ length: 8 }, (_, index) => ({ id: `q-${index}`, active: index !== 6, challengeEnabled: index !== 7, scopeAllowed: index !== 5 }));
const first = selectDailyQuestions(candidates, "person:2026-09-17");
const second = selectDailyQuestions([...candidates].reverse(), "person:2026-09-17");
assert.equal(first.length, 5);
assert.deepEqual(first.map(({ id }) => id), second.map(({ id }) => id));
assert.ok(first.every(({ id }) => !["q-5", "q-6", "q-7"].includes(id)));
assert.notDeepEqual(first.map(({ id }) => id), selectDailyQuestions(candidates, "person:2026-09-18").map(({ id }) => id));

assert.equal(challengeDateKey(new Date("2026-09-16T16:30:00.000Z"), "Asia/Shanghai"), "2026-09-17");
const day = challengeDayRange(new Date("2026-09-16T16:30:00.000Z"), "Asia/Shanghai");
assert.equal(day.start.toISOString(), "2026-09-16T16:00:00.000Z");
assert.equal(day.end.toISOString(), "2026-09-17T16:00:00.000Z");
const september = challengeMonthRange(new Date("2026-09-17T04:00:00.000Z"), "Asia/Shanghai");
assert.equal(september.month, "2026-09");
assert.equal(september.start.toISOString(), "2026-08-31T16:00:00.000Z");
assert.equal(september.end.toISOString(), "2026-09-30T16:00:00.000Z");
assert.equal(challengeAnswersEqual(["B", "A"], ["A", "B"]), true);
assert.equal(challengeAnswersEqual("A", "B"), false);

console.log("DAILY_CHALLENGE_POLICY_OK");
