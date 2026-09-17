import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [componentSource, componentTemplate, componentStyle, componentConfig, pageSource, pageTemplate] = await Promise.all([
  "apps/miniprogram/components/courseware-blocks/index.js",
  "apps/miniprogram/components/courseware-blocks/index.wxml",
  "apps/miniprogram/components/courseware-blocks/index.wxss",
  "apps/miniprogram/components/courseware-blocks/index.json",
  "apps/miniprogram/pages/courseware/index.js",
  "apps/miniprogram/pages/courseware/index.wxml"
].map(read));

for (const type of ["knowledge", "do_dont", "steps", "checkpoint", "scenario", "summary"]) {
  assert.match(componentTemplate, new RegExp(`block\\.type === '${type}'`), `必须渲染 ${type} 内容块`);
}
assert.match(componentTemplate, /此内容需要升级小程序后查看/, "未知内容块必须安全降级");
assert.match(componentSource, /api\.download\(`\/api\/files\/\$\{[^}]+\}`\)/, "结构化课件图片必须通过鉴权文件接口读取");
assert.doesNotMatch(componentSource, /attempts|\/answers|\/submit/, "随堂题不得调用正式考试接口");
assert.match(componentSource, /triggerEvent\('checkpoint-answered'/, "随堂题必须产生本地学习反馈事件");
assert.match(componentSource, /triggerEvent\('block-reached'/, "内容块必须显式上报学习位置");
assert.match(componentTemplate, /bindtap="confirmBlockReached"/, "到达内容块必须由学习者显式确认");
assert.match(componentTemplate, /disabled="\{\{!block\.known \|\| block\.type === 'checkpoint' && !block\.feedback \|\| block\.type === 'scenario' && !block\.scenarioFeedback\}\}"/, "未完成互动或无法识别内容时不得继续");
assert.match(componentStyle, /\.continue-button\[disabled\]/, "禁用的继续按钮必须有清晰状态");
assert.match(pageSource, /persistResume\(progressPercent, detail\.blockKey\)/, "续学位置必须保存 blockKey");
assert.match(pageSource, /Math\.max\([^)]*progressPercent/, "结构化续学进度必须单调递增");
assert.match(pageSource, /detail\.isLast[\s\S]*recordReachedEnd\(\)/, "只有显式到达最后内容块才能记录末尾证据");
assert.match(pageTemplate, /courseware-blocks/, "课件页必须挂载结构化课件组件");
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
  triggerEvent(name, detail) { this.lastEvent = { name, detail }; }
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

console.log("MINIPROGRAM_STRUCTURED_COURSEWARE_CHECK=PASS");
