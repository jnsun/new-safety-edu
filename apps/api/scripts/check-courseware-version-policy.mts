import assert from "node:assert/strict";
import {
  canEditCoursewareVersion,
  hashStructuredCourseware,
  normalizeStructuredCourseware,
  serializeStructuredCoursewareForLearner
} from "../src/structured-courseware.js";

const document = {
  learningObjectives: ["  正确佩戴安全帽  "],
  units: [{
    blocks: [{ type: "summary", points: ["  进入现场前检查安全帽  "], key: " summary " }],
    estimatedMinutes: 3,
    title: "  进入现场  ",
    key: " unit-1 "
  }],
  estimatedMinutes: 3,
  summary: "  进入现场前的必要检查  ",
  title: "  入场安全  ",
  schemaVersion: 1
};

assert.equal(canEditCoursewareVersion({ status: "draft" }), true);
assert.equal(canEditCoursewareVersion({ status: "published" }), false);
assert.equal(canEditCoursewareVersion({ status: "archived" }), false);

const normalized = normalizeStructuredCourseware(document);
assert.equal(normalized.title, "入场安全");
assert.equal(normalized.units[0]?.key, "unit-1");
assert.equal(normalized.units[0]?.blocks[0]?.key, "summary");

const sameMeaningDifferentPropertyOrder = {
  schemaVersion: 1,
  title: "入场安全",
  summary: "进入现场前的必要检查",
  learningObjectives: ["正确佩戴安全帽"],
  estimatedMinutes: 3,
  units: [{
    key: "unit-1",
    title: "进入现场",
    estimatedMinutes: 3,
    blocks: [{ key: "summary", type: "summary", points: ["进入现场前检查安全帽"] }]
  }]
};
assert.equal(hashStructuredCourseware(document), hashStructuredCourseware(sameMeaningDifferentPropertyOrder));
assert.match(hashStructuredCourseware(document), /^[a-f0-9]{64}$/);

assert.deepEqual(
  serializeStructuredCoursewareForLearner(normalized, { blockKey: "summary", progressPercent: 100 }),
  {
    schemaVersion: 1,
    estimatedMinutes: 3,
    units: normalized.units,
    resumeState: { blockKey: "summary", progressPercent: 100 }
  }
);

console.log("courseware version policy check passed");
