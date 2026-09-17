import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../miniprogram/pages/courseware/index.js", import.meta.url), "utf8");
const template = await readFile(new URL("../../miniprogram/pages/courseware/index.wxml", import.meta.url), "utf8");
let definition: Record<string, any> | undefined;
let navigation: Record<string, any> | undefined;
const requests: unknown[][] = [];
let coursewareResponse: Record<string, unknown> | undefined;

vm.runInNewContext(source, {
  Page(value: Record<string, any>) { definition = value; },
  require(id: string) {
    assert.equal(id, "../../utils/api");
    return { request: async (...args: unknown[]) => {
      requests.push(args);
      if (String(args[0]).endsWith("/reached-end")) return { reachedEndAt: "2026-09-17T00:00:00.000Z" };
      return coursewareResponse ?? {};
    } };
  },
  wx: {
    navigateTo(options: Record<string, any>) { navigation = options; },
    nextTick(callback: () => void) { callback(); },
    getWindowInfo() { return { windowHeight: 800 }; },
    createSelectorQuery() {
      return {
        in() { return this; },
        select() { return this; },
        boundingClientRect() { return this; },
        exec(callback: (rects: unknown[]) => void) { callback([{ height: 100 }, { bottom: 500 }]); }
      };
    }
  },
  console,
  Promise,
  setTimeout(callback: () => void) { callback(); return 1; },
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

coursewareResponse = { title: "Rich", type: "rich_text", richText: "<p>content</p>", resumeState: null, reachedEndAt: null };
const richPage = {
  ...definition,
  data: { ...definition.data },
  setData(values: Record<string, unknown>) { Object.assign(this.data, values); }
};
await richPage.onLoad({ assignmentId: "assignment", versionId: "version" });
await Promise.resolve();
assert.equal(requests.filter(([path]) => String(path).endsWith("/reached-end")).length, 0);
assert.equal(richPage.data.atEnd, false);
assert.equal(typeof richPage.attestRichTextComplete, "function");
await richPage.attestRichTextComplete();
assert.equal(requests.filter(([path]) => String(path).endsWith("/reached-end")).length, 1);
assert.equal(richPage.data.atEnd, true);
assert.match(template, /bindtap="attestRichTextComplete">本人确认已阅读至末尾<\/button>/);

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
