import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { parseQuestionImport } from "../apps/api/src/question-import.js";

const root = path.resolve("deliverables/miniprogram-ui-reference-v3.1");
const item08 = path.join(root, "08_路由映射_风格指南_设计参数_图片");
const templates = path.join(root, "09_实际导入模板");

for (const file of ["08A_路由映射.md","08B_浅色风格指南.md","08C_设计参数.json","08D_图片索引.md"]) {
  await fs.access(path.join(item08, file));
}
const params = JSON.parse(await fs.readFile(path.join(item08, "08C_设计参数.json"), "utf8"));
assert.equal(params.theme, "light-only");
assert.equal(params.rules.darkTheme, false);

const images = (await fs.readdir(path.join(item08, "images"))).filter((name) => name.endsWith(".png"));
assert.equal(images.length, 27, "第08项应有27张页面图");

for (const name of ["正式题库_实际导入模板.xlsx","每日挑战题_实际导入模板.xlsx"]) {
  const parsed = await parseQuestionImport(await fs.readFile(path.join(templates, name)), name);
  assert.equal(parsed.errors.length, 0, `${name} 不应有导入错误：${JSON.stringify(parsed.errors)}`);
  assert.equal(parsed.questions.length, 3, `${name} 应包含3条有效示例`);
}
for (const name of ["正式题库_实际导入模板.csv","每日挑战题_实际导入模板.csv"]) {
  const parsed = await parseQuestionImport(await fs.readFile(path.join(templates, name)), name);
  assert.equal(parsed.errors.length, 0, `${name} 不应有导入错误：${JSON.stringify(parsed.errors)}`);
  assert.equal(parsed.questions.length, 3, `${name} 应包含3条有效示例`);
}

const gameStatus = await fs.readFile(path.join(templates, "游戏导入能力现状.md"), "utf8");
assert.match(gameStatus, /没有.*导入接口/);
assert.match(gameStatus, /不可直接导入|不能上传/);

const allTextFiles = [];
async function walk(dir: string) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.(md|json|csv)$/i.test(entry.name)) allTextFiles.push(full);
  }
}
await walk(root);
const combined = (await Promise.all(allTextFiles.map((file) => fs.readFile(file, "utf8")))).join("\n");
assert.doesNotMatch(combined, /AppSecret|session_key|JWT_SECRET|数据库密码/);

console.log(`V31_REFERENCE_PACK_OK images=${images.length} importableTemplates=4`);
