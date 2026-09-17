import assert from "node:assert/strict";
import { publicAttempt } from "../src/routes/day2.js";

const result = publicAttempt({
  id: "attempt-1",
  attemptNumber: 2,
  startedAt: new Date("2026-09-17T00:00:00.000Z"),
  expiresAt: new Date("2026-09-17T00:30:00.000Z"),
  status: "in_progress",
  snapshot: {
    totalScore: 100,
    questions: [{
      id: "question-1",
      type: "single_choice",
      prompt: "示例题目",
      options: ["A", "B"],
      correct: ["A"],
      score: 100,
      explanation: "答案解析",
      answerKey: "A",
      scoringMetadata: { weight: 1 }
    }]
  },
  answers: [{ questionId: "question-1", answer: ["B"] }]
} as any);

assert.deepEqual(Object.keys(result.questions[0] ?? {}).sort(), ["id", "options", "prompt", "type"]);
assert.deepEqual(result.answers, [{ questionId: "question-1", answer: ["B"] }]);
const serialized = JSON.stringify(result);
for (const forbidden of ["correct", "score", "explanation", "answerKey", "scoringMetadata", "totalScore"]) {
  assert.equal(serialized.includes(forbidden), false, `公开考试响应泄露字段：${forbidden}`);
}

console.log("EXAM_PUBLIC_ATTEMPT_POLICY_OK");
