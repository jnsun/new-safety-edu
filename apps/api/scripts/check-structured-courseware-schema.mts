import assert from "node:assert/strict";
import {
  COURSEWARE_SCHEMA_VERSION,
  StructuredCoursewareDocumentSchema
} from "../../../packages/contracts/src/courseware.js";

const validDocument = {
  schemaVersion: COURSEWARE_SCHEMA_VERSION,
  title: "进入受限空间前的安全确认",
  summary: "识别进入受限空间前必须完成的确认事项。",
  learningObjectives: ["说出进入前的三项必要确认"],
  estimatedMinutes: 12,
  units: [{
    key: "entry-check",
    title: "进入前检查",
    estimatedMinutes: 6,
    blocks: [
      {
        key: "entry-knowledge",
        type: "knowledge",
        title: "先检测，再进入",
        body: "进入前必须完成气体检测。",
        imageFileId: null
      },
      {
        key: "entry-checkpoint",
        type: "checkpoint",
        prompt: "进入前是否必须检测气体？",
        questionType: "true_false",
        options: ["正确", "错误"],
        correctIndexes: [0],
        explanation: "检测结果是进入许可的重要依据。"
      }
    ]
  }]
};

assert.equal(StructuredCoursewareDocumentSchema.parse(validDocument).schemaVersion, 1);

function rejects(mutator: (document: any) => void, message: string) {
  const input = structuredClone(validDocument);
  mutator(input);
  assert.equal(StructuredCoursewareDocumentSchema.safeParse(input).success, false, message);
}

rejects((document) => {
  document.units[0].blocks[1].key = document.units[0].blocks[0].key;
}, "整份课件中的 block key 必须唯一");
rejects((document) => {
  document.units[0].blocks[1].correctIndexes = [2];
}, "正确选项索引不得越界");
rejects((document) => {
  document.units[0].blocks = [];
}, "单元不得为空");
rejects((document) => {
  document.units[0].blocks[0].body = " ";
}, "正文不得只包含空白字符");
rejects((document) => {
  document.units[0].blocks[0].body = "x".repeat(10_001);
}, "正文不得超过长度上限");
rejects((document) => {
  document.units[0].blocks[1].correctIndexes = [0, 1];
}, "判断题必须且只能有一个正确选项");
rejects((document) => {
  document.units[0].blocks[1].options.push("不确定");
}, "判断题必须恰好有两个选项");
rejects((document) => {
  document.schemaVersion = 2;
}, "只接受当前 schemaVersion");
rejects((document) => {
  document.estimatedMinutes = 0;
}, "预计时长必须位于允许范围内");

console.log("STRUCTURED_COURSEWARE_SCHEMA_OK");
