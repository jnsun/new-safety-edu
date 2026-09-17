import assert from "node:assert/strict";
import {
  canEditCoursewareVersion,
  hashStructuredCourseware,
  normalizeStructuredCourseware,
  retryCoursewareVersionCreate,
  serializeStructuredCoursewareForLearner,
  structuredAssetSyncPlan,
  structuredCoursewareAssetIds,
  validateStructuredCoursewareAssets
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

const imageFileId = "00000000-0000-4000-8000-000000000001";
const structuredWithImage = normalizeStructuredCourseware({
  ...sameMeaningDifferentPropertyOrder,
  units: [{
    key: "unit-1",
    title: "进入现场",
    estimatedMinutes: 3,
    blocks: [{ key: "knowledge", type: "knowledge", title: "安全帽", body: "正确佩戴", imageFileId }]
  }]
});
assert.deepEqual(structuredCoursewareAssetIds(structuredWithImage), [imageFileId]);
assert.deepEqual(structuredAssetSyncPlan([imageFileId, "00000000-0000-4000-8000-000000000002"], ["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"]), {
  add: ["00000000-0000-4000-8000-000000000003"],
  remove: [imageFileId]
});

const scope = { scopeType: "organization", scopeId: "00000000-0000-4000-8000-000000000010" };
const validAsset = { id: imageFileId, kind: "attachment", mimeType: "image/png", uploadedBy: "account-owner", scopes: [] };
assert.deepEqual(validateStructuredCoursewareAssets(structuredWithImage, [validAsset], "account-owner", scope), [imageFileId]);
assert.throws(
  () => validateStructuredCoursewareAssets(structuredWithImage, [], "account-owner", scope),
  (error: any) => error.code === "COURSEWARE_ASSET_NOT_FOUND"
);
assert.throws(
  () => validateStructuredCoursewareAssets(structuredWithImage, [{ ...validAsset, kind: "photo" }], "account-owner", scope),
  (error: any) => error.code === "COURSEWARE_ASSET_INVALID"
);
assert.throws(
  () => validateStructuredCoursewareAssets(structuredWithImage, [{ ...validAsset, mimeType: "application/pdf" }], "account-owner", scope),
  (error: any) => error.code === "COURSEWARE_ASSET_INVALID"
);
assert.deepEqual(validateStructuredCoursewareAssets(structuredWithImage, [{ ...validAsset, uploadedBy: "other", scopes: [scope] }], "account-owner", scope), [imageFileId]);
assert.throws(
  () => validateStructuredCoursewareAssets(structuredWithImage, [{ ...validAsset, uploadedBy: "other", scopes: [{ scopeType: "project", scopeId: scope.scopeId }] }], "account-owner", scope),
  (error: any) => error.code === "COURSEWARE_ASSET_FORBIDDEN"
);

const versionConflict = Object.assign(new Error("duplicate version"), { code: "P2002", meta: { target: ["courseware_id", "version"] } });
let attempts = 0;
assert.equal(await retryCoursewareVersionCreate(async () => {
  attempts += 1;
  if (attempts === 1) throw versionConflict;
  return 2;
}), 2);
assert.equal(attempts, 2);

const unrelatedConflict = Object.assign(new Error("duplicate hash"), { code: "P2002", meta: { target: ["content_hash"] } });
attempts = 0;
await assert.rejects(() => retryCoursewareVersionCreate(async () => {
  attempts += 1;
  throw unrelatedConflict;
}), (error) => error === unrelatedConflict);
assert.equal(attempts, 1);
attempts = 0;
await assert.rejects(() => retryCoursewareVersionCreate(async () => {
  attempts += 1;
  throw versionConflict;
}, 2), (error) => error === versionConflict);
assert.equal(attempts, 2);

let committedVersion = 1;
let initialReads = 0;
let releaseInitialReads!: () => void;
const initialReadBarrier = new Promise<void>((resolve) => { releaseInitialReads = resolve; });
const concurrentCreate = () => retryCoursewareVersionCreate(async () => {
  const candidate = committedVersion + 1;
  if (initialReads < 2) {
    initialReads += 1;
    if (initialReads === 2) releaseInitialReads();
    await initialReadBarrier;
  }
  if (candidate <= committedVersion) throw versionConflict;
  committedVersion = candidate;
  return candidate;
});
assert.deepEqual((await Promise.all([concurrentCreate(), concurrentCreate()])).sort(), [2, 3]);

console.log("courseware version policy check passed");
