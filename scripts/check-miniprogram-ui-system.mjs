import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"

const root = new URL("../apps/miniprogram/", import.meta.url)
const read = (name) => readFile(new URL(name, root), "utf8")

const [packageJson, app, project, appStyles] = await Promise.all([
  read("package.json").then(JSON.parse),
  read("app.json").then(JSON.parse),
  read("project.config.json").then(JSON.parse),
  read("app.wxss"),
])

assert.equal(packageJson.dependencies?.["tdesign-miniprogram"], "1.16.1", "TDesign Miniprogram 必须锁定已验证版本")
assert.equal(project.setting?.packNpmManually, true, "微信开发者工具必须启用手动 npm 构建配置")
assert.equal(project.setting?.packNpmRelationList?.[0]?.packageJsonPath, "./package.json", "npm 构建必须读取小程序 package.json")
assert.equal(project.setting?.packNpmRelationList?.[0]?.miniprogramNpmDistDir, "./", "npm 构建产物必须输出到当前小程序根目录")

const components = app.usingComponents || {}
for (const name of ["t-icon", "t-loading"]) {
  assert.match(components[name] || "", /^tdesign-miniprogram\//, `${name} 必须由全局 TDesign 按需组件提供`)
}

for (const token of ["--canvas", "--surface", "--ink", "--action", "--success", "--warning", "--danger", "--radius-card", "--elevation"]) {
  assert.ok(appStyles.includes(token), `统一 WXSS 缺少 ${token}`)
}

const files = (await readdir(root, { recursive: true }))
  .map((name) => name.replaceAll("\\", "/"))
  .filter((name) => !name.startsWith("node_modules/") && !name.startsWith("miniprogram_npm/"))
const sources = await Promise.all(files.filter((name) => /\.(js|json|wxml|wxss)$/.test(name)).map(async (name) => [name, await read(name)]))
const joined = sources.map(([, source]) => source).join("\n")

assert.doesNotMatch(joined, /linear-gradient|radial-gradient/, "小程序业务 UI 不使用装饰性渐变")
assert.doesNotMatch(joined, /border-left\s*:/, "状态提示不使用粗侧边框")
assert.doesNotMatch(joined, /tailwind|shadcn|framer-motion|react-hook-form|from\s+['\"](?:react|next)/i, "原生小程序不得引入 Web 框架")

for (const page of ["todo", "task", "courseware", "exam", "signature", "messages", "profile", "record-detail"]) {
  const wxml = await read(`pages/${page}/index.wxml`)
  assert.match(wxml, /<t-(?:icon|loading)/, `${page} 必须使用按需 TDesign 状态或图标组件`)
}

const todoTemplate = await read("pages/todo/index.wxml")
for (const cardClass of ["primary-task", "task-row", "challenge-card"]) {
  assert.doesNotMatch(todoTemplate, new RegExp(`<button[^>]*class="[^"]*${cardClass}`), `${cardClass} 不得使用原生 button 充当整张卡片`)
}
assert.doesNotMatch(await read("pages/records/index.wxml"), /<button[^>]*class="[^"]*record-item/, "培训记录卡不得使用原生 button 容器")
assert.doesNotMatch(await read("pages/task/index.wxml"), /<button[^>]*class="[^"]*course-row/, "课件列表行不得使用原生 button 容器")

const coursewareBlocks = await read("components/courseware-blocks/index.wxml")
for (const controlClass of ["choice-button", "answer-button", "previous-button", "continue-button"]) {
  assert.doesNotMatch(coursewareBlocks, new RegExp(`<button[^>]*class="[^"]*${controlClass}`), `${controlClass} 不得使用会收缩内容宽度的原生 button`)
  assert.match(coursewareBlocks, new RegExp(`<view[^>]*class="[^"]*${controlClass}`), `${controlClass} 必须使用全宽可访问交互容器`)
}
const coursewareStyles = await read("components/courseware-blocks/index.wxss")
for (const selector of [".choice-button", ".answer-button", ".continue-button"]) {
  assert.match(coursewareStyles, new RegExp(`${selector.replace(".", "\\.")}[^}]*width:\\s*100%`), `${selector} 必须显式占满可用宽度`)
}
assert.match(coursewareStyles, /\.choice-copy[^}]*overflow-wrap:\s*anywhere/, "长选项文字必须允许安全换行")

const iconStyles = await read("node_modules/tdesign-miniprogram/miniprogram_dist/icon/icon.wxss")
const availableIcons = new Set([...iconStyles.matchAll(/\.t-icon-([a-z0-9-]+):before/g)].map((match) => match[1]))
for (const [filename, source] of sources.filter(([name]) => name.endsWith(".wxml"))) {
  for (const match of source.matchAll(/<t-icon\b[^>]*\bname="([a-z0-9-]+)"/g)) {
    assert.equal(availableIcons.has(match[1]), true, `${filename} 使用了不存在的 TDesign 图标 ${match[1]}`)
  }
}

console.log(`MINIPROGRAM_UI_SYSTEM_CHECK=PASS files=${sources.length}`)
