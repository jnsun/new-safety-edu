import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [todo, task, courseware, coursewarePage, exam, examPage, signature, signaturePage, records, recordDetail] = await Promise.all([
  "apps/miniprogram/pages/todo/index.wxml",
  "apps/miniprogram/pages/task/index.wxml",
  "apps/miniprogram/pages/courseware/index.wxml",
  "apps/miniprogram/pages/courseware/index.js",
  "apps/miniprogram/pages/exam/index.wxml",
  "apps/miniprogram/pages/exam/index.js",
  "apps/miniprogram/pages/signature/index.wxml",
  "apps/miniprogram/pages/signature/index.js",
  "apps/miniprogram/pages/records/index.wxml",
  "apps/miniprogram/pages/record-detail/index.wxml"
].map(read));

assert.match(todo, /\{\{primaryTask\.priorityReason\}\}/, "待办页必须展示服务端优先原因");
assert.match(todo, /\{\{primaryTask\.nextAction\}\}/, "待办页必须展示服务端下一步");
assert.match(task, /wx:for="\{\{stageItems\}\}"/, "任务详情必须展示任务阶段");
assert.match(task, /bindtap="runPrimaryAction">\{\{primaryAction\.label\}\}/, "任务详情必须只有服务端状态派生的主操作");

assert.match(courseware, /bindtap="attestRichTextComplete"/, "图文课件必须显式确认阅读至末尾");
assert.match(courseware, /bindtap="attestHtmlComplete"/, "HTML 课件必须显式确认完成互动内容");
assert.match(courseware, /disabled="\{\{!atEnd\}\}" bindtap="complete"/, "未确认末尾时不得完成学习");
assert.match(coursewarePage, /\/resume`, 'PATCH'/, "课件必须保存续学位置");
assert.match(coursewarePage, /\/reached-end`, 'POST'/, "课件必须由服务端记录到达末尾");

assert.match(exam, /wx:if="\{\{!reviewing && currentQuestion\}\}"/, "考试必须一次展示一题");
assert.match(exam, /bindtap="previous">上一题<\/button>/, "考试必须支持返回上一题");
assert.match(exam, /bindtap="next">\{\{nextLabel\}\}<\/button>/, "下一步按钮必须绑定动态标签");
assert.doesNotMatch(exam, /wx:for="\{\{questions\}\}"/, "考试不得一次渲染整份试卷");
assert.match(examPage, /nextLabel: currentIndex < questions\.length - 1 \? '下一题' : '检查答题'/, "末题后必须进入答题检查");
assert.match(examPage, /\/attempts\/start`, 'POST'/, "进入考试必须复用开始或恢复接口");
assert.match(examPage, /\/answers`, 'PUT'/, "答案必须自动保存到服务端");

assert.match(signature, /wx:if="\{\{signedAtText\}\}" class="submitted-panel"/, "已签字时必须展示不可覆盖状态");
assert.match(signature, /disabled="\{\{busy \|\| !previewed\}\}" bindtap="submit"/, "正式签字提交前必须预览");
assert.match(signaturePage, /MIN_SIGNATURE_DISTANCE/, "签字必须具有真实笔迹证据");
for (const fact of ["学习记录", "考试记录", "本人签字", "项目现场确认"]) assert.match(recordDetail, new RegExp(fact), `记录详情缺少${fact}`);
for (const fact of ["完成时间", "最终成绩", "考试结果", "本人签字"]) assert.match(records, new RegExp(fact), `记录列表缺少${fact}`);

assert.doesNotMatch([todo, task, courseware, exam, signature, records, recordDetail].join("\n"), /可上岗|禁止上岗|准入/, "学习端不得显示资格结论");
console.log("MINIPROGRAM_TRAINING_FLOW_OK");
