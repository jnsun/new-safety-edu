import assert from "node:assert/strict";
import { assertOwnedFiles } from "../src/file-association-policy.js";

const accountId = "account-a";
const files = [
  { id: "photo-a", kind: "photo", uploadedBy: accountId },
  { id: "attachment-a", kind: "attachment", uploadedBy: accountId },
];

assert.doesNotThrow(() => assertOwnedFiles(files, ["photo-a"], accountId, "photo"));
assert.throws(
  () => assertOwnedFiles(files, ["photo-a"], "account-b", "photo"),
  (error: unknown) => (error as { code?: string }).code === "FILE_ASSOCIATION_FORBIDDEN",
);
assert.throws(
  () => assertOwnedFiles(files, ["attachment-a"], accountId, "photo"),
  (error: unknown) => (error as { code?: string }).code === "FILE_ASSOCIATION_FORBIDDEN",
);
assert.throws(
  () => assertOwnedFiles(files, ["missing"], accountId, "photo"),
  (error: unknown) => (error as { code?: string }).code === "FILE_ASSOCIATION_FORBIDDEN",
);
assert.throws(
  () => assertOwnedFiles(files, ["photo-a", "photo-a"], accountId, "photo"),
  (error: unknown) => (error as { code?: string }).code === "DUPLICATE_FILE_ID",
);

console.log("FILE_ASSOCIATION_POLICY_OK");
