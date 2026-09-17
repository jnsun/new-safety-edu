import assert from "node:assert/strict";
import { filterReviewRows } from "../src/people-organization/review-list.ts";

const rows = [
  { id: "1", status: "pending", reviewedBy: null },
  { id: "2", status: "approved", reviewedBy: "admin-1" },
  { id: "3", status: "rejected", reviewedBy: "admin-2" },
];

assert.deepEqual(filterReviewRows(rows, "pending", "admin-1").map((row) => row.id), ["1"]);
assert.deepEqual(filterReviewRows(rows, "reviewed", "admin-1").map((row) => row.id), ["2"]);
assert.deepEqual(filterReviewRows(rows, "all", "admin-1").map((row) => row.id), ["1", "2", "3"]);

console.log("review list check passed");
