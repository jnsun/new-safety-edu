import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../apps/miniprogram/", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");
const exists = async (name) => { try { await access(new URL(name, root)); return true; } catch { return false; } };

const app = JSON.parse(await read("app.json"));
const pages = new Set(app.pages || []);
assert.equal(pages.size, app.pages?.length, "app.json 不得重复声明页面");

for (const page of pages) {
  for (const extension of ["js", "json", "wxml", "wxss"]) assert.equal(await exists(`${page}.${extension}`), true, `${page} 缺少 .${extension}`);
  const pageConfig = JSON.parse(await read(`${page}.json`));
  for (const component of Object.values(pageConfig.usingComponents || {})) {
    if (!String(component).startsWith("/")) continue;
    const base = String(component).slice(1);
    for (const extension of ["js", "json", "wxml", "wxss"]) assert.equal(await exists(`${base}.${extension}`), true, `${page} 引用的 ${base} 缺少 .${extension}`);
    assert.equal(JSON.parse(await read(`${base}.json`)).component, true, `${base} 必须声明为组件`);
  }
}

for (const item of app.tabBar?.list || []) assert.equal(pages.has(item.pagePath), true, `Tab 页面未在 app.json 声明：${item.pagePath}`);

const files = (await readdir(root, { recursive: true })).map((name) => name.replaceAll("\\", "/"));
for (const filename of files.filter((name) => name.endsWith(".json"))) JSON.parse(await read(filename));
for (const filename of files.filter((name) => name.endsWith(".js"))) new vm.Script(await read(filename), { filename });

const source = (await Promise.all(files.filter((name) => /\.(js|wxml)$/.test(name)).map(read))).join("\n");
for (const match of source.matchAll(/\/pages\/([a-z0-9-]+\/index)/gi)) {
  assert.equal(pages.has(`pages/${match[1]}`), true, `导航目标未在 app.json 声明：pages/${match[1]}`);
}

console.log(`MINIPROGRAM_ALL_PAGES_CHECK=PASS pages=${pages.size}`);
