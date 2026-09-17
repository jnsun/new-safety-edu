# 结构化课件编辑、导入导出与模板下载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Courseware/CoursewareVersion 版本体系内增加结构化互动课件、可视化内容块编辑器，以及 XLSX、JSON、ZIP 批量导入导出和系统模板下载。

**Architecture:** `CoursewareVersion` 保存版本化 JSON 内容并沿用现有发布与 scope 权限；API 通过单一 Zod schema 校验编辑、导入和小程序读取。Admin 使用纵向内容块编辑器，XLSX/JSON/ZIP 先服务端预检再确认写入草稿，已发布版本永不覆盖。

**Tech Stack:** React 19、Ant Design、TanStack Query、Fastify、Prisma/PostgreSQL、Zod、ExcelJS、unzipper、原生微信小程序。

**Spec:** `docs/superpowers/specs/2026-09-17-miniprogram-training-courseware-design.md`

## Global Constraints

- 扩展现有 Courseware、CoursewareVersion、PrivateFile 和发布授权，不建立第二套课件模型。
- 已发布课件版本不可原地覆盖；导入更新只能生成新草稿版本。
- XLSX、JSON 和 ZIP 必须经过预检和人工确认，不允许点击上传后直接写入正式课件。
- 系统必须提供空白 XLSX、匿名示例 XLSX、JSON 示例、JSON Schema 和字段说明下载。
- 不支持 Word、PDF、PPT 自动转换，不建设自由画布或任意脚本执行环境。
- HTML 与素材保持私有，并继续使用短时授权读取。

## File Map

- `packages/contracts/src/courseware.ts`：结构化内容块与导入导出契约。
- `prisma/schema.prisma`、新 migration：结构化版本和导入会话字段。
- `apps/api/src/structured-courseware.ts`：schema、规范化和 hash。
- `apps/api/src/courseware-import.ts`：XLSX/JSON/ZIP 解析与预检。
- `apps/api/src/courseware-export.ts`：模板和课件导出。
- `apps/api/src/routes/courseware-authoring.ts`：编辑、预览、确认和下载接口。
- `apps/admin/src/courseware/*`：列表、编辑器、内容块、手机预览、导入确认。
- `apps/miniprogram/components/courseware-blocks/*`：原生结构化内容渲染器。
- `apps/miniprogram/pages/courseware/*`：结构化课件容器与进度上报。

---

### Task 1: 结构化内容契约与数据库版本

**Files:**
- Create: `packages/contracts/src/courseware.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_structured_courseware/migration.sql`
- Create: `apps/api/scripts/check-structured-courseware-schema.mts`

**Interfaces:**
- Produces: `StructuredCoursewareDocumentSchema`、`CoursewareBlockSchema`、`COURSEWARE_SCHEMA_VERSION = 1`。
- Produces: `CoursewareType.structured` 和 `CoursewareVersion.structuredContent`、`schemaVersion`、`estimatedMinutes`。

- [ ] **Step 1: 定义 discriminated union 契约**

```ts
const common = z.object({ key: z.string().min(1).max(120) });
export const CoursewareBlockSchema = z.discriminatedUnion("type", [
  common.extend({ type: z.literal("knowledge"), title: z.string().max(160), body: z.string().max(10_000), imageFileId: z.string().uuid().nullable() }),
  common.extend({ type: z.literal("do_dont"), title: z.string().max(160), dos: z.array(z.string().max(500)).min(1), donts: z.array(z.string().max(500)).min(1) }),
  common.extend({ type: z.literal("steps"), title: z.string().max(160), steps: z.array(z.string().max(1000)).min(1) }),
  common.extend({ type: z.literal("checkpoint"), prompt: z.string().max(2000), questionType: z.enum(["single_choice", "multiple_choice", "true_false"]), options: z.array(z.string().max(500)).min(2), correctIndexes: z.array(z.number().int().nonnegative()).min(1), explanation: z.string().max(4000) }),
  common.extend({ type: z.literal("scenario"), prompt: z.string().max(3000), choices: z.array(z.object({ label: z.string().max(500), consequence: z.string().max(3000), basis: z.string().max(3000) })).min(2) }),
  common.extend({ type: z.literal("summary"), points: z.array(z.string().max(1000)).min(1).max(5) })
]);
```

- [ ] **Step 2: 写 schema 检查并确认失败**

检查重复 block key、无效正确选项索引、空单元和超限内容；运行 `pnpm --filter @safety/api exec tsx scripts/check-structured-courseware-schema.mts`，预期因实现不存在而失败。

- [ ] **Step 3: 增加 Prisma 字段与正式 migration**

```prisma
enum CoursewareType { rich_text single_html structured }

model CoursewareVersion {
  structuredContent Json? @map("structured_content")
  schemaVersion Int? @map("schema_version")
  estimatedMinutes Int? @map("estimated_minutes")
}
```

- [ ] **Step 4: 验证并提交**

Run: `pnpm db:validate && pnpm prisma:generate && pnpm --filter @safety/contracts build && pnpm --filter @safety/api exec tsx scripts/check-structured-courseware-schema.mts`
Expected: 全部通过。

```bash
git add packages/contracts prisma/schema.prisma prisma/migrations apps/api/scripts/check-structured-courseware-schema.mts
git commit -m "feat(courseware): define structured content contract"
```

### Task 2: 结构化课件版本 API

**Files:**
- Create: `apps/api/src/structured-courseware.ts`
- Create: `apps/api/src/routes/courseware-authoring.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/routes/day2.ts`
- Create: `apps/api/scripts/check-courseware-version-policy.mts`

**Interfaces:**
- Consumes: Task 1 schema。
- Produces: `normalizeStructuredCourseware(input)`、`hashStructuredCourseware(input)`。
- Produces: `POST /api/coursewares` 支持 `type=structured`；`POST /api/coursewares/:id/versions` 创建新草稿；`PUT /api/courseware-versions/:id/draft` 只更新草稿。

- [ ] **Step 1: 写版本不可变检查**

```ts
assert.equal(canEditCoursewareVersion({ status: "draft" }), true);
assert.equal(canEditCoursewareVersion({ status: "published" }), false);
assert.equal(canEditCoursewareVersion({ status: "archived" }), false);
```

- [ ] **Step 2: 实现规范化、稳定 hash 和草稿更新策略**

JSON hash 必须基于排序稳定的规范化值；编辑 API 使用 `updateMany({ where: { id, status: "draft" } })`，0 行更新返回 409。

- [ ] **Step 3: 扩展本人课件读取接口**

结构化课件只返回渲染需要的 blocks、预计时长和 resume state；随堂题的解释可随选择后本地显示，但不得混入正式考试接口。

- [ ] **Step 4: 运行检查与提交**

Run: `pnpm --filter @safety/api exec tsx scripts/check-courseware-version-policy.mts && pnpm --filter @safety/api build`
Expected: PASS。

```bash
git add apps/api/src/structured-courseware.ts apps/api/src/routes/courseware-authoring.ts apps/api/src/routes/day2.ts apps/api/src/server.ts apps/api/scripts/check-courseware-version-policy.mts
git commit -m "feat(courseware): add structured draft and version APIs"
```

### Task 3: 小程序结构化内容渲染器

**Files:**
- Create: `apps/miniprogram/components/courseware-blocks/index.js`
- Create: `apps/miniprogram/components/courseware-blocks/index.json`
- Create: `apps/miniprogram/components/courseware-blocks/index.wxml`
- Create: `apps/miniprogram/components/courseware-blocks/index.wxss`
- Modify: `apps/miniprogram/pages/courseware/index.json`
- Modify: `apps/miniprogram/pages/courseware/index.js`
- Modify: `apps/miniprogram/pages/courseware/index.wxml`
- Modify: `apps/miniprogram/pages/courseware/index.wxss`

**Interfaces:**
- Consumes: `{ schemaVersion, units, estimatedMinutes }`。
- Produces: `block-reached`、`checkpoint-answered` 事件；不产生正式考试成绩。

- [ ] **Step 1: 注册组件并实现 block 类型穷尽渲染**

未知 block 显示“此内容需要升级小程序后查看”，不能白屏；图片通过鉴权下载接口读取。

- [ ] **Step 2: 实现随堂题即时反馈**

组件本地比对结构化课件内的 checkpoint 答案，只用于学习解释；事件不得调用正式考试提交接口。

- [ ] **Step 3: 连接续学与完成规则**

进入时滚动到 `resumeState.blockKey`；到达最后一个 block 上报 reached end；完成按钮仍调用现有服务端完成接口。

- [ ] **Step 4: 验证并提交**

Run: `pnpm check:miniprogram`
Expected: PASS。

```bash
git add apps/miniprogram/components/courseware-blocks apps/miniprogram/pages/courseware
git commit -m "feat(miniprogram): render structured courseware blocks"
```

### Task 4: Admin 纵向内容块编辑器

**Files:**
- Create: `apps/admin/src/courseware/types.ts`
- Create: `apps/admin/src/courseware/BlockEditor.tsx`
- Create: `apps/admin/src/courseware/CoursewareEditor.tsx`
- Create: `apps/admin/src/courseware/MobilePreview.tsx`
- Create: `apps/admin/src/courseware/courseware.css`
- Modify: `apps/admin/src/Day2Pages.tsx`
- Create: `apps/admin/scripts/check-courseware-editor.mts`

**Interfaces:**
- Consumes: Task 2 草稿 API 和共享结构化契约。
- Produces: `CoursewareEditor`，支持添加、复制、删除、上下移动、保存草稿和手机预览。

- [ ] **Step 1: 写编辑器静态契约检查**

检查每种 block 有明确 label、未知 block 不可提交、发布按钮与保存草稿分离；先运行并确认失败。

- [ ] **Step 2: 建立 reducer 而非散落表单状态**

```ts
type EditorAction =
  | { type: "add"; block: CoursewareBlock; index?: number }
  | { type: "update"; key: string; patch: Partial<CoursewareBlock> }
  | { type: "duplicate"; key: string }
  | { type: "remove"; key: string }
  | { type: "move"; key: string; direction: -1 | 1 };
```

- [ ] **Step 3: 完成内容块表单与即时手机预览**

编辑器按纵向顺序显示块；不实现任意像素拖拽。保存失败保留当前本地状态并显示服务器错误。

- [ ] **Step 4: 接入现有课件与模板页面**

`Day2Pages.tsx` 只负责路由/标签挂载，不继续堆积块编辑器细节。

- [ ] **Step 5: 验证并提交**

Run: `pnpm --filter @safety/admin exec tsx scripts/check-courseware-editor.mts && pnpm --filter @safety/admin build`
Expected: PASS。

```bash
git add apps/admin/src/courseware apps/admin/src/Day2Pages.tsx apps/admin/scripts/check-courseware-editor.mts
git commit -m "feat(admin): add structured courseware editor"
```

### Task 5: XLSX、JSON、ZIP 解析与预检查

**Files:**
- Create: `apps/api/src/courseware-import.ts`
- Create: `apps/api/src/courseware-import-xlsx.ts`
- Create: `apps/api/src/courseware-import-package.ts`
- Create: `apps/api/scripts/check-courseware-import.mts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_courseware_import_sessions/migration.sql`

**Interfaces:**
- Produces: `previewCoursewareImport(file): CoursewareImportPreview`；确认时使用 `previewId + sourceHash`，不得信任客户端回传的解析内容。
- Produces: 预览分类 `create | new_version | conflict | invalid`。

- [ ] **Step 1: 写匿名内存工作簿检查**

使用 ExcelJS 创建包含 `课程`、`单元`、`内容块`、`随堂题`、`情境选择` 的最小工作簿，断言行号错误、重复编码和缺失素材均出现在预览。

- [ ] **Step 2: 实现 XLSX 多工作表映射**

所有关联只使用课程编码和单元编码；不得按标题模糊匹配。禁止公式作为业务值，拒绝 `.xlsm`。

- [ ] **Step 3: 实现 JSON 和 ZIP 包解析**

ZIP 只允许根清单与 `assets/`，拒绝绝对路径、`..`、符号链接、可执行文件、超限解压体积和重复素材名。

- [ ] **Step 4: 保存预览会话并实现幂等确认**

预览会话保存 source hash、模板版本、解析结果摘要、创建人和过期时间；确认使用唯一键防止双击重复创建版本。

- [ ] **Step 5: 验证并提交**

Run: `pnpm db:validate && pnpm prisma:generate && pnpm --filter @safety/api exec tsx scripts/check-courseware-import.mts`
Expected: PASS。

```bash
git add apps/api/src/courseware-import* apps/api/scripts/check-courseware-import.mts prisma/schema.prisma prisma/migrations
git commit -m "feat(courseware): preview structured courseware imports"
```

### Task 6: 导出和系统模板下载

**Files:**
- Create: `apps/api/src/courseware-export.ts`
- Create: `apps/api/src/courseware-template.ts`
- Modify: `apps/api/src/routes/courseware-authoring.ts`
- Create: `apps/api/scripts/check-courseware-template.mts`

**Interfaces:**
- Produces: 空白/匿名示例 XLSX、JSON 示例、JSON Schema；导出选中课件为 XLSX、JSON 或 ZIP。

- [ ] **Step 1: 编写 round-trip 检查**

`document → XLSX → parse → document` 与 `document → JSON → parse → document` 在规范化后必须深度相等。

- [ ] **Step 2: 生成版本化模板**

模板包含 `模板版本`、固定 sheet 名、数据验证、冻结表头、列宽、字段说明和匿名示例；不得含真实人员或业务数据。

- [ ] **Step 3: 增加鉴权下载接口**

模板下载需要管理员登录但不要求课件 scope；实际课件导出必须通过现有可见 scope 校验并写审计。

- [ ] **Step 4: 验证并提交**

Run: `pnpm --filter @safety/api exec tsx scripts/check-courseware-template.mts && pnpm --filter @safety/api build`
Expected: PASS。

```bash
git add apps/api/src/courseware-export.ts apps/api/src/courseware-template.ts apps/api/src/routes/courseware-authoring.ts apps/api/scripts/check-courseware-template.mts
git commit -m "feat(courseware): export courses and downloadable templates"
```

### Task 7: Admin 导入确认与结果页面

**Files:**
- Create: `apps/admin/src/courseware/ImportCoursewareModal.tsx`
- Create: `apps/admin/src/courseware/ImportPreviewTable.tsx`
- Modify: `apps/admin/src/courseware/CoursewareEditor.tsx`
- Modify: `apps/admin/src/courseware/courseware.css`

**Interfaces:**
- Consumes: preview、confirm、template download 和 export API。
- Produces: 上传 → 预览 → 冲突处理 → 确认 → 结果的可恢复 UI。

- [ ] **Step 1: 增加模板下载与导出入口**

分别提供空白 XLSX、示例 XLSX、JSON 示例、Schema，以及选中课件导出；下载错误必须展示服务端原因。

- [ ] **Step 2: 实现预览表格**

按新增、新版本、冲突、无效分组，显示工作表、行号、字段和原因；未预览成功时禁用确认按钮。

- [ ] **Step 3: 实现确认和幂等反馈**

只提交 `previewId` 与 `sourceHash`；结果显示成功、失败、冲突、跳过数量和逐项原因。

- [ ] **Step 4: 验证并提交**

Run: `pnpm --filter @safety/admin build && pnpm --filter @safety/api build && pnpm check:miniprogram`
Expected: 全部通过。

```bash
git add apps/admin/src/courseware
git commit -m "feat(admin): add courseware import and export workflow"
```

### Task 8: 结构化课件端到端最小验证

**Files:**
- Create: `apps/api/scripts/smoke-structured-courseware.mts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `pnpm smoke:structured-courseware`，只使用匿名隔离数据并自动清理。

- [ ] **Step 1: 编写匿名 smoke**

创建草稿 → 编辑 blocks → 下载/导入模板 → 预览 → 确认生成新草稿 → 发布 → learner 读取 → 上报位置 → 完成；最后删除未发布匿名对象，已发布测试对象仅在隔离库运行。

- [ ] **Step 2: 运行最终验证**

Run: `pnpm db:validate && pnpm prisma:generate && pnpm --filter @safety/contracts build && pnpm --filter @safety/api build && pnpm --filter @safety/admin build && pnpm check:miniprogram && pnpm smoke:structured-courseware`
Expected: 全部退出码为 0。

- [ ] **Step 3: 提交**

```bash
git add apps/api/scripts/smoke-structured-courseware.mts apps/api/package.json package.json
git commit -m "chore(courseware): add structured authoring smoke check"
```
