import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  COURSEWARE_BLOCK_LABELS,
  createBlock,
  createEmptyCoursewareDocument,
  editorReducer,
  validateCoursewareDocument
} from "../src/courseware/types.ts";

const blockTypes = ["knowledge", "do_dont", "steps", "checkpoint", "scenario", "summary"] as const;
assert.deepEqual(Object.keys(COURSEWARE_BLOCK_LABELS), blockTypes, "六种内容块必须都有明确中文名称");
assert.deepEqual(blockTypes.map((type) => createBlock(type, []).type), blockTypes, "六种内容块必须都能建立默认编辑状态");

const document = createEmptyCoursewareDocument();
const unitKey = document.units[0]!.key;
let state = { document, dirty: false };
const first = createBlock("knowledge", []);
state = editorReducer(state, { type: "add", unitKey, block: first });
state = editorReducer(state, { type: "duplicate", unitKey, key: first.key });
assert.equal(state.document.units[0]!.blocks.length, 2, "复制内容块应新增一块");
assert.notEqual(state.document.units[0]!.blocks[0]!.key, state.document.units[0]!.blocks[1]!.key, "复制内容块必须生成稳定且唯一的 key");

const secondKey = state.document.units[0]!.blocks[1]!.key;
state = editorReducer(state, { type: "move", unitKey, key: secondKey, direction: -1 });
assert.equal(state.document.units[0]!.blocks[0]!.key, secondKey, "内容块应能上移");
state = editorReducer(state, { type: "remove", unitKey, key: secondKey });
assert.equal(state.document.units[0]!.blocks.length, 1, "内容块应能删除");

const unknownBlock = {
  ...state.document,
  title: "匿名安全课程",
  summary: "课程摘要",
  learningObjectives: ["掌握一项安全知识"],
  units: [{
    ...state.document.units[0]!,
    title: "第一单元",
    blocks: [{ key: "unsupported-1", type: "video", source: "unsafe" }]
  }]
};
assert.equal(validateCoursewareDocument(unknownBlock).success, false, "未知内容块不得通过保存校验");

const editorSource = await readFile(new URL("../src/courseware/CoursewareEditor.tsx", import.meta.url), "utf8");
assert.match(editorSource, /保存草稿/, "编辑器必须提供明确的保存草稿动作");
assert.match(editorSource, /发布.*版本列表/, "编辑器必须说明发布动作与保存草稿分离");

const day2Source = await readFile(new URL("../src/Day2Pages.tsx", import.meta.url), "utf8");
assert.match(day2Source, /CoursewareEditor/, "课件页面应只挂载独立编辑器组件");

console.log("courseware editor check passed");
