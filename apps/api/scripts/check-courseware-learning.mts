import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../miniprogram/pages/courseware/index.js", import.meta.url), "utf8");
let definition: Record<string, any> | undefined;
let navigation: Record<string, any> | undefined;
const requests: unknown[][] = [];

vm.runInNewContext(source, {
  Page(value: Record<string, any>) { definition = value; },
  require(id: string) {
    assert.equal(id, "../../utils/api");
    return { request: async (...args: unknown[]) => { requests.push(args); return {}; } };
  },
  wx: { navigateTo(options: Record<string, any>) { navigation = options; } },
  console,
  Promise,
  setTimeout,
  clearTimeout
});

assert.ok(definition);
const page = {
  ...definition,
  data: { ...definition.data, content: { type: "single_html", viewerUrl: "https://example.test/courseware" } },
  setData(values: Record<string, unknown>) { Object.assign(this.data, values); }
};

page.openHtml();
assert.equal(page.data.htmlNavigationSucceeded, false);
navigation?.fail?.({ errMsg: "navigateTo:fail" });
assert.equal(page.data.htmlNavigationSucceeded, false);
await page.attestHtmlComplete();
assert.equal(requests.length, 0);

const { completionEvidenceError, latestLearningProgress, resumeUpdateData } = await import("../src/learning-progress-policy.js");
const openedAt = new Date("2026-09-17T00:00:00Z");
assert.equal(completionEvidenceError({ openedAt, reachedEndAt: null }), "COURSEWARE_END_NOT_REACHED");
assert.equal(completionEvidenceError({ openedAt, reachedEndAt: openedAt }), null);

const latest = latestLearningProgress([
  { id: "round-1", remediationRound: 1 },
  { id: "round-3", remediationRound: 3 },
  { id: "round-2", remediationRound: 2 }
]);
assert.equal(latest?.id, "round-3");
assert.deepEqual(
  resumeUpdateData({ blockKey: "rich-text", progressPercent: 70 }, { blockKey: "rich-text", progressPercent: 40 }),
  { resumeState: { blockKey: "rich-text", progressPercent: 70 } }
);
assert.deepEqual(
  resumeUpdateData({ blockKey: "rich-text", progressPercent: 70 }, { blockKey: "rich-text", progressPercent: 90 }),
  { resumeState: { blockKey: "rich-text", progressPercent: 90 } }
);

console.log("COURSEWARE_LEARNING_POLICY_OK");
