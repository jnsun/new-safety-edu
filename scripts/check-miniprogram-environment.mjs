import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const environment = require("../apps/miniprogram/config/env.js");

assert.equal(environment.resolveEnvironment("develop").name, "test");
assert.equal(environment.resolveEnvironment("trial").name, "test");
assert.equal(environment.resolveEnvironment("release").name, "prod");
assert.equal(environment.resolveEnvironment("develop").apiBaseUrl, "https://test.safety.sx.cn/api");
assert.equal(environment.resolveEnvironment("trial").apiBaseUrl, "https://test.safety.sx.cn/api");
assert.equal(environment.resolveEnvironment("release").apiBaseUrl, "https://www.safety.sx.cn/api");
assert.throws(() => environment.resolveEnvironment("unknown"), /无法确认微信小程序运行环境/);
assert.throws(() => environment.assertSafeApiBaseUrl("test", "https://www.safety.sx.cn/api"), /已阻止连接生产环境/);
assert.throws(() => environment.assertSafeApiBaseUrl("prod", "https://test.safety.sx.cn/api"), /正式版小程序只能连接生产环境/);

const apiSource = await readFile(new URL("../apps/miniprogram/utils/api.js", import.meta.url), "utf8");
for (const api of ["wx.request", "wx.uploadFile", "wx.downloadFile"]) assert.match(apiSource, new RegExp(api.replace(".", "\\.")));
assert.match(apiSource, /getMiniProgramRequestHeaders/);
assert.match(apiSource, /resolveApiUrl/);

const root = new URL("../apps/miniprogram/", import.meta.url);
const files = (await readdir(root, { recursive: true })).filter((name) => /\.(js|wxml|json)$/.test(name));
const domainFiles = [];
for (const name of files) {
  const normalized = name.replaceAll("\\", "/");
  const source = await readFile(new URL(normalized, root), "utf8");
  if (/https:\/\/(?:test|www)\.safety\.sx\.cn/.test(source) && normalized !== "config/env.js") domainFiles.push(normalized);
}
assert.deepEqual(domainFiles, [], "业务页面和网络客户端不得硬编码测试或生产域名");

const appConfig = JSON.parse(await readFile(new URL("app.json", root), "utf8"));
assert.equal(appConfig.usingComponents?.["environment-badge"], "/components/environment-badge/index");
for (const page of appConfig.pages) {
  const template = await readFile(new URL(`${page}.wxml`, root), "utf8");
  assert.match(template, /<environment-badge\s*\/>/, `${page} 缺少测试环境标识`);
}

const project = JSON.parse(await readFile(new URL("project.config.json", root), "utf8"));
assert.equal(project.setting?.urlCheck, true, "必须开启微信合法域名校验");

const badgeSource = await readFile(new URL("components/environment-badge/index.js", root), "utf8");
let definition;
for (const [envVersion, expected] of [["develop", true], ["trial", true], ["release", false]]) {
  definition = undefined;
  Function("Component", "require", badgeSource)(
    (value) => { definition = value; },
    () => ({ isTestEnvironment: () => envVersion !== "release" })
  );
  const instance = { data: { ...definition.data }, setData(values) { Object.assign(this.data, values); } };
  definition.lifetimes.attached.call(instance);
  assert.equal(instance.data.visible, expected, `${envVersion} 测试标识显示错误`);
}

console.log("MINIPROGRAM_ENVIRONMENT_CHECK=PASS");
