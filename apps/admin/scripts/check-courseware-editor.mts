import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  COURSEWARE_BLOCK_LABELS,
  createBlock,
  createEmptyCoursewareDocument,
  editorReducer,
  normalizeCheckpointQuestionType,
  validateCoursewareDocument
} from "../src/courseware/types.ts";

const blockTypes = ["knowledge", "do_dont", "steps", "checkpoint", "scenario", "summary"] as const;
assert.deepEqual(Object.keys(COURSEWARE_BLOCK_LABELS), blockTypes, "六种内容块必须都有明确中文名称");
assert.deepEqual(blockTypes.map((type) => createBlock(type, []).type), blockTypes, "六种内容块必须都能建立默认编辑状态");

const document = createEmptyCoursewareDocument();
const unitKey = document.units[0]!.key;
let state = { document, dirty: false, revision: 0, savedRevision: null };
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

const saveRevision = state.revision;
state = editorReducer(state, { type: "document", patch: { summary: "保存过程中产生的新修改" } });
state = editorReducer(state, { type: "saved", revision: saveRevision });
assert.equal(state.dirty, true, "旧保存响应不得清除保存期间产生的新修改");
state = editorReducer(state, { type: "saved", revision: state.revision });
assert.equal(state.dirty, false, "只有当前 revision 的保存响应才能清除 dirty 状态");

const checkpoint = createBlock("checkpoint", []);
assert.equal(checkpoint.type, "checkpoint");
if (checkpoint.type === "checkpoint") {
  assert.deepEqual(normalizeCheckpointQuestionType({ ...checkpoint, correctIndexes: [0, 1] }, "single_choice").correctIndexes, [0], "单选题只能保留一个正确答案");
  assert.deepEqual(normalizeCheckpointQuestionType(checkpoint, "true_false").options, ["正确", "错误"], "判断题必须规范化为两个固定选项");
}

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
assert.match(editorSource, /coursewareTitle/, "文档标题必须由权威课件标题派生");
assert.match(editorSource, /beforeunload/, "脏草稿必须阻止浏览器直接离开");

const day2Source = await readFile(new URL("../src/Day2Pages.tsx", import.meta.url), "utf8");
assert.match(day2Source, /export \{ CoursewarePage \} from "\.\/courseware\/CoursewarePage"/, "Day2Pages 应保持为薄入口并复用独立课件页面");

const pageSource = await readFile(new URL("../src/courseware/CoursewarePage.tsx", import.meta.url), "utf8");
assert.match(pageSource, /创建新版本/, "已发布结构化课件必须提供创建新版本入口");
assert.match(pageSource, /scopeKey/, "新建课件必须提交用户选择的授权范围");
assert.match(pageSource, /重新加载/, "课件列表错误必须提供重试入口");
assert.match(pageSource, /确认放弃未保存的修改/, "关闭编辑器必须确认未保存内容");

const blockSource = await readFile(new URL("../src/courseware/BlockEditor.tsx", import.meta.url), "utf8");
assert.match(blockSource, /questionType === "multiple_choice"/, "只有多选题可以使用多值正确答案控件");

const previewSource = await readFile(new URL("../src/courseware/MobilePreview.tsx", import.meta.url), "utf8");
assert.match(previewSource, /selectedChoice/, "情境后果必须在模拟选择后显示");
assert.match(previewSource, /selectedAnswers/, "随堂题解析必须在模拟作答后显示");

console.log("courseware editor check passed");
