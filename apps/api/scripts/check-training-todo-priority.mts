import assert from "node:assert/strict";
import { decorateTodoPriority, sortTodoAssignments } from "../src/training-todo-priority.js";

const three = decorateTodoPriority({ trainingType: "three_level", status: "learning", dueAt: null, createdAt: new Date("2026-09-01") }, new Date("2026-09-17"));
const overdue = decorateTodoPriority({ trainingType: "routine", status: "learning", dueAt: new Date("2026-09-10"), createdAt: new Date("2026-09-02") }, new Date("2026-09-17"));
assert.equal(three.isThreeLevelPriority, true);
assert.deepEqual(sortTodoAssignments([overdue, three]).map((row) => row.trainingType), ["three_level", "routine"]);
assert.equal(three.blocksOtherTraining, false);
console.log("TRAINING_TODO_PRIORITY_OK");
