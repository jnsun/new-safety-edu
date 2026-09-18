import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [componentSource, componentTemplate, componentStyle, componentConfig, pageSource, pageTemplate, pageStyle] = await Promise.all([
  "apps/miniprogram/components/courseware-blocks/index.js",
  "apps/miniprogram/components/courseware-blocks/index.wxml",
  "apps/miniprogram/components/courseware-blocks/index.wxss",
  "apps/miniprogram/components/courseware-blocks/index.json",
  "apps/miniprogram/pages/courseware/index.js",
  "apps/miniprogram/pages/courseware/index.wxml",
  "apps/miniprogram/pages/courseware/index.wxss"
].map(read));

for (const type of ["knowledge", "do_dont", "steps", "checkpoint", "scenario", "summary"]) {
  assert.match(componentTemplate, new RegExp(`currentBlock\\.type === '${type}'`), `必须渲染 ${type} 内容块`);
}
assert.match(componentTemplate, /此内容需要升级小程序后查看/, "未知内容块必须安全降级");
assert.match(componentSource, /api\.download\(`\/api\/files\/\$\{[^}]+\}`\)/, "结构化课件图片必须通过鉴权文件接口读取");
assert.doesNotMatch(componentSource, /attempts|\/answers|\/submit/, "随堂题不得调用正式考试接口");
assert.match(componentSource, /triggerEvent\('checkpoint-answered'/, "随堂题必须产生本地学习反馈事件");
assert.match(componentSource, /triggerEvent\('block-reached'/, "内容块必须显式上报学习位置");
assert.match(componentTemplate, /bindtap="confirmBlockReached"/, "到达内容块必须由学习者显式确认");
assert.match(componentTemplate, /\{\{currentUnit\.title\}\}/, "结构化课件必须直接渲染唯一当前单元");
assert.match(componentTemplate, /\{\{currentBlock\.title\}\}/, "结构化课件必须直接渲染唯一当前内容项");
assert.match(componentTemplate, /bindtap="showPreviousBlock"/, "结构化课件必须可以返回上一项");
assert.match(componentTemplate, /disabled="\{\{!canContinue\}\}"/, "未完成互动或无法识别内容时不得继续");
assert.match(componentStyle, /\.continue-button\[disabled\]/, "禁用的继续按钮必须有清晰状态");
assert.match(pageSource, /persistResume\(progressPercent, detail\.blockKey\)/, "续学位置必须保存 blockKey");
assert.match(pageSource, /Math\.max\([^)]*progressPercent/, "结构化续学进度必须单调递增");
assert.match(pageSource, /detail\.isLast[\s\S]*recordReachedEnd\(\)/, "只有显式到达最后内容块才能记录末尾证据");
assert.match(pageTemplate, /courseware-blocks/, "课件页必须挂载结构化课件组件");
assert.match(pageTemplate, /bind:position-changed="onStructuredPositionChanged"/, "课件页必须接收当前学习项位置");
assert.match(pageStyle, /\.progress-dock[^{]*\{[^}]*position:\s*sticky/s, "学习进度必须使用置顶进度栏");
assert.match(pageTemplate, /bindtap="reloadCourseware">重新加载<\/button>/, "加载失败必须提供明确的重新加载操作");
assert.match(pageSource, /reloadCourseware\(\)/, "课件页必须提供可复用的重新加载处理器");
assert.equal(JSON.parse(componentConfig).component, true, "渲染器必须注册为小程序组件");

let definition;
vm.runInNewContext(componentSource, {
  Component(value) { definition = value; },
  require(id) {
    assert.equal(id, "../../utils/api");
    return { download: async (path) => `/tmp${path}` };
  },
  wx: { nextTick(callback) { callback(); }, createSelectorQuery() { return { in() { return this; }, selectViewport() { return this; }, scrollOffset() { return this; }, select() { return this; }, boundingClientRect() { return this; }, exec(callback) { callback([]); } }; }, pageScrollTo() {} },
  console,
  Promise,
  Set,
  Map
});
assert.ok(definition, "组件定义必须可加载");

const instance = {
  ...definition.methods,
  data: {
    units: [{ key: "u1", title: "第一单元", blocks: [{ key: "q1", type: "checkpoint", prompt: "应如何操作？", questionType: "multiple_choice", options: ["先断电", "直接处理", "设置警戒"], correctIndexes: [0, 2], explanation: "先控制能量并隔离现场。" }] }],
    preparedUnits: []
  },
  setData(values) {
    for (const [path, value] of Object.entries(values)) {
      const parts = path.split(".");
      let target = this.data;
      while (parts.length > 1) target = target[parts.shift()];
      target[parts[0]] = value;
    }
  },
  triggerEvent(name, detail) { this.lastEvent = { name, detail }; (this.events ||= []).push(this.lastEvent); }
};
instance.prepareUnits(instance.data.units);
instance.selectCheckpointOption({ currentTarget: { dataset: { unitIndex: 0, blockIndex: 0, optionIndex: 0 } } });
instance.selectCheckpointOption({ currentTarget: { dataset: { unitIndex: 0, blockIndex: 0, optionIndex: 2 } } });
instance.submitCheckpoint({ currentTarget: { dataset: { unitIndex: 0, blockIndex: 0 } } });
assert.equal(instance.lastEvent.name, "checkpoint-answered");
assert.equal(instance.lastEvent.detail.correct, true, "多选随堂题必须按完整选项集合判断");
assert.equal(instance.data.preparedUnits[0].blocks[0].feedback.text, "回答正确", "反馈不能只依赖颜色");

instance.prepareUnits([{ key: "u2", title: "判断", blocks: [{ key: "q2", type: "checkpoint", prompt: "需要先断电吗？", questionType: "true_false", options: ["否", "是"], correctIndexes: [1], explanation: "必须先控制能量。" }] }]);
instance.selectCheckpointOption({ currentTarget: { dataset: { unitIndex: 0, blockIndex: 0, optionIndex: 0 } } });
instance.selectCheckpointOption({ currentTarget: { dataset: { unitIndex: 0, blockIndex: 0, optionIndex: 1 } } });
assert.deepEqual(Array.from(instance.data.preparedUnits[0].blocks[0].options, (option) => option.selected), [false, true], "单选和判断只能保留一个选项");
instance.submitCheckpoint({ currentTarget: { dataset: { unitIndex: 0, blockIndex: 0 } } });
assert.equal(instance.lastEvent.detail.correct, true, "判断题必须支持本地即时反馈");

instance.prepareUnits([{ key: "u3", title: "分段学习", estimatedMinutes: 2, blocks: [
  { key: "k1", type: "knowledge", title: "第一项", body: "第一项内容" },
  { key: "k2", type: "knowledge", title: "第二项", body: "第二项内容" }
] }]);
assert.equal(instance.data.currentBlock.key, "k1", "首次应只展示第一项");
instance.confirmBlockReached({ currentTarget: { dataset: { unitIndex: 0, blockIndex: 0 } } });
assert.equal(instance.data.currentBlock.key, "k2", "点击继续下一项后必须切换到下一项");
assert.equal(instance.lastEvent.name, "position-changed", "切换内容项后必须向页面报告新位置");
instance.data.resumeBlockKey = "k1";
instance.prepareUnits(instance.data.units = [{ key: "u3", title: "分段学习", estimatedMinutes: 2, blocks: [
  { key: "k1", type: "knowledge", title: "第一项", body: "第一项内容" },
  { key: "k2", type: "knowledge", title: "第二项", body: "第二项内容" }
] }]);
assert.equal(instance.data.currentBlock.key, "k2", "恢复学习时应进入已确认内容的下一项");

instance.data.resumeBlockKey = "";
instance.prepareUnits(instance.data.units = [{ key: "u4", title: "情境单元", estimatedMinutes: 3, blocks: [
  { key: "s1", type: "scenario", prompt: "你会怎么做？", choices: [{ label: "先确认", consequence: "范围明确", basis: "制度要求" }] },
  { key: "q3", type: "checkpoint", prompt: "是否确认？", questionType: "true_false", options: ["否", "是"], correctIndexes: [1], explanation: "需要确认。" }
] }]);
assert.equal(instance.data.currentBlock.key, "s1", "情境题必须成为明确的当前内容项");
instance.selectScenarioChoice({ currentTarget: { dataset: { choiceIndex: 0 } } });
assert.equal(instance.data.currentBlock.key, "s1", "选择情境答案后当前内容不得消失");
assert.equal(instance.data.currentBlock.scenarioFeedback.consequence, "范围明确", "选择后必须显示情境反馈");
instance.confirmBlockReached();
assert.equal(instance.data.currentBlock.key, "q3", "确认情境题后必须进入下一项");
instance.showPreviousBlock();
assert.equal(instance.data.currentBlock.key, "s1", "必须可以返回上一项查看");
assert.equal(instance.data.completedThrough, 0, "返回查看不得回退已确认进度");
const savedEvents = instance.events.filter((event) => event.name === "block-reached").length;
instance.confirmBlockReached();
assert.equal(instance.data.currentBlock.key, "q3", "查看上一项后必须能再次返回下一项");
assert.equal(instance.events.filter((event) => event.name === "block-reached").length, savedEvents, "查看已完成内容不得重复保存或回退进度");

let pageDefinition;
let loadingAttempts = 0;
const requestedPaths = [];
vm.runInNewContext(pageSource, {
  Page(value) { pageDefinition = value; },
  require(id) {
    assert.equal(id, "../../utils/api");
    return { request: async (path, method = "GET") => {
      requestedPaths.push({ path, method });
      loadingAttempts += 1;
      if (loadingAttempts === 1) throw new Error("网络暂时不可用");
      return { title: "匿名课件", type: "structured", units: [], estimatedMinutes: 1, resumeState: null, reachedEndAt: null };
    } };
  },
  wx: { nextTick(callback) { callback(); } },
  console,
  Promise,
  Number,
  Math,
  setTimeout,
  clearTimeout
});
const pageInstance = {
  ...pageDefinition,
  data: { ...pageDefinition.data },
  setData(values) { Object.assign(this.data, values); }
};
await pageInstance.onLoad({ assignmentId: "assignment-1", versionId: "version-1" });
assert.equal(pageInstance.data.error, "网络暂时不可用");
await pageInstance.reloadCourseware();
assert.equal(pageInstance.data.error, "", "重试成功必须清理旧错误");
assert.equal(pageInstance.data.content.title, "匿名课件", "重试必须重新获取同一课件");
assert.deepEqual(requestedPaths, [
  { path: "/api/assignments/assignment-1/coursewares/version-1", method: "GET" },
  { path: "/api/assignments/assignment-1/coursewares/version-1", method: "GET" }
], "重试只能重复安全读取，不得创建进度或完成证据");

pageInstance.persistResume = async () => {};
pageInstance.data.progressPercent = 12;
await pageInstance.onStructuredBlockReached({ detail: { confirmed: true, blockKey: "scenario-5", progressPercent: 15, isLast: false } });
assert.equal(pageInstance.data.structuredResumeBlockKey, "scenario-5", "确认当前项后必须同步续学键，避免组件重绘回到旧位置");

console.log("MINIPROGRAM_STRUCTURED_COURSEWARE_CHECK=PASS");
