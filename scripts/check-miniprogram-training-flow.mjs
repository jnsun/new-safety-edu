import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

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

const storage = new Map([
  ["exam-active-attempt:assignment-1", "attempt-1"],
  ["exam-position:attempt-1", { attemptId: "attempt-1", currentIndex: 1, reviewing: true }]
]);
let attemptResponse = {
  id: "attempt-1",
  attemptNumber: 1,
  expiresAt: "2099-09-17T00:30:00.000Z",
  answers: [],
  questions: [
    { id: "q1", type: "single_choice", prompt: "第一题", options: ["A", "B"] },
    { id: "q2", type: "single_choice", prompt: "第二题", options: ["A", "B"] }
  ]
};
let startError;
let examDefinition;
vm.runInNewContext(examPage, {
  Page(value) { examDefinition = value; },
  require(id) {
    assert.equal(id, "../../utils/api");
    return { request: async (path) => {
      if (String(path).endsWith("/attempts/start")) {
        if (startError) throw startError;
        return attemptResponse;
      }
      if (String(path).endsWith("/submit")) return { passed: true, score: 100, assignmentStatus: "pending_signature" };
      return { saved: 1 };
    } };
  },
  wx: {
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync(key) { storage.delete(key); },
    showToast() {},
    showModal(options) { options.success?.({ confirm: true }); },
    navigateBack() {}
  },
  console,
  Promise,
  Date,
  setTimeout,
  clearTimeout,
  setInterval() { return 1; },
  clearInterval() {}
});

assert.ok(examDefinition);
const examInstance = () => ({
  ...examDefinition,
  data: { ...examDefinition.data, assignmentId: "assignment-1" },
  setData(values) { Object.assign(this.data, values); }
});

const resumedExam = examInstance();
await resumedExam.loadAttempt();
assert.equal(resumedExam.data.currentIndex, 1, "相同 active attempt 必须恢复上次题号");
assert.equal(resumedExam.data.reviewing, true, "相同 active attempt 必须恢复答题检查状态");

storage.set("exam-position:attempt-1", { attemptId: "other-attempt", currentIndex: 1, reviewing: true });
const mismatchedExam = examInstance();
await mismatchedExam.loadAttempt();
assert.equal(mismatchedExam.data.currentIndex, 0, "不匹配的 attempt 位置不得恢复");
assert.equal(mismatchedExam.data.reviewing, false, "不匹配的 attempt 检查状态不得恢复");

storage.set("exam-position:attempt-1", { attemptId: "attempt-1", currentIndex: 99, reviewing: false });
const clampedExam = examInstance();
await clampedExam.loadAttempt();
assert.equal(clampedExam.data.currentIndex, 1, "恢复题号必须限制在当前试卷范围内");

storage.set("exam-active-attempt:assignment-1", "attempt-old");
storage.set("exam-position:attempt-old", { attemptId: "attempt-old", currentIndex: 1, reviewing: true });
attemptResponse = { ...attemptResponse, id: "attempt-new" };
const newAttemptExam = examInstance();
await newAttemptExam.loadAttempt();
assert.equal(storage.has("exam-position:attempt-old"), false, "新 attempt 必须清理旧位置");
assert.equal(newAttemptExam.data.currentIndex, 0, "新 attempt 不得继承旧题号");

await newAttemptExam.submit();
newAttemptExam.onUnload();
assert.equal(storage.has("exam-position:attempt-new"), false, "交卷成功必须清理位置");
assert.equal(storage.has("exam-active-attempt:assignment-1"), false, "交卷成功必须清理 active attempt 指针");

attemptResponse = { ...attemptResponse, id: "attempt-expired", expiresAt: "2099-09-17T00:30:00.000Z" };
const expiredExam = examInstance();
await expiredExam.loadAttempt();
expiredExam.data.attempt.expiresAt = "2000-01-01T00:00:00.000Z";
expiredExam.startTimer();
assert.equal(storage.has("exam-position:attempt-expired"), false, "计时结束必须清理位置");
assert.equal(storage.has("exam-active-attempt:assignment-1"), false, "计时结束必须清理 active attempt 指针");

storage.set("exam-active-attempt:assignment-1", "attempt-stale");
storage.set("exam-position:attempt-stale", { attemptId: "attempt-stale", currentIndex: 1, reviewing: true });
startError = Object.assign(new Error("当前任务不可开始考试"), { code: "INVALID_ASSIGNMENT_STATE" });
const finalizedExam = examInstance();
await finalizedExam.loadAttempt();
assert.equal(storage.has("exam-position:attempt-stale"), false, "没有 active attempt 时必须清理旧位置");
assert.equal(storage.has("exam-active-attempt:assignment-1"), false, "没有 active attempt 时必须清理指针");

assert.match(signature, /wx:if="\{\{signedAtText\}\}" class="submitted-panel"/, "已签字时必须展示不可覆盖状态");
assert.match(signature, /disabled="\{\{busy \|\| !previewed\}\}" bindtap="submit"/, "正式签字提交前必须预览");
assert.match(signaturePage, /MIN_SIGNATURE_DISTANCE/, "签字必须具有真实笔迹证据");
for (const fact of ["学习记录", "考试记录", "本人签字", "项目现场确认"]) assert.match(recordDetail, new RegExp(fact), `记录详情缺少${fact}`);
for (const fact of ["完成时间", "最终成绩", "考试结果", "本人签字"]) assert.match(records, new RegExp(fact), `记录列表缺少${fact}`);

assert.doesNotMatch([todo, task, courseware, exam, signature, records, recordDetail].join("\n"), /可上岗|禁止上岗|准入/, "学习端不得显示资格结论");
console.log("MINIPROGRAM_TRAINING_FLOW_OK");
