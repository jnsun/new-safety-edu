# 应收账款角色化异常处置台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将应收账款首页改造成按 capability 呈现的异常处置台，并让首页入口可靠落到筛选后的台账。

**Architecture:** 复用现有 dashboard 查询和 Ant Design 页面，在查询层仅增加债权状态、单位两个 facet。把 URL 初始筛选和角色化首页文案收敛为纯函数，以现有 `check-receivables-core.mts` 做最小行为验证。

**Tech Stack:** React 19、TypeScript 5.9、Ant Design 5、Fastify、Prisma/PostgreSQL、Node assert 检查脚本

**Spec:** `docs/superpowers/specs/2026-09-16-receivables-role-workbench-design.md`

## Global Constraints

- 不新增依赖，不新增数据库表，不改变财务写权限。
- 所有统计和列表继续使用服务端范围约束。
- 不发明久未催收阈值、自动逾期或回款目标。
- 保持现有路由兼容、加载失败关闭显示和权限撤销处理。

---

### Task 1: 固化角色文案与台账 URL 初始筛选

**Files:**
- Modify: `apps/admin/src/receivables-types.ts`
- Modify: `apps/api/scripts/check-receivables-core.mts`

**Interfaces:**
- Produces: `receivablesDashboardMode(access)` 返回首页模式、标题、说明和主操作。
- Produces: `receivablesLedgerInitialState(search)` 返回受白名单约束的初始筛选。

- [x] **Step 1: Write the failing test**

在 `check-receivables-core.mts` 断言管理金额、维护催收和只读 capability 分别得到正确首页模式；断言合法 URL 条件被读取、非法枚举回退到 `active` / `unsettled`。

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm check:receivables-core`

Expected: FAIL，因为两个纯函数尚未导出。

- [x] **Step 3: Write minimal implementation**

在 `receivables-types.ts` 增加两个无副作用函数；只解析现有 API 已支持的筛选字段，不复制权限判断。

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm check:receivables-core`

Expected: PASS。

### Task 2: 增加首页所需的现有维度聚合

**Files:**
- Modify: `apps/api/src/receivables-query.ts`
- Modify: `apps/admin/src/receivables-types.ts`
- Modify: `apps/api/scripts/check-receivables-core.mts`

**Interfaces:**
- Extends: `ReceivablesDashboardResponse` 增加 `debtStatuses`、`creditorUnits`。
- Extends: `buildReceivablesDashboardStatements` 和 dashboard 执行结果。

- [x] **Step 1: Write the failing test**

断言 dashboard statement builder 提供 `debtStatuses` 和 `creditorUnits` 两条参数化 facet 查询。

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm check:receivables-core`

Expected: FAIL，因为 dashboard builder 尚无这两个键。

- [x] **Step 3: Write minimal implementation**

复用现有 `facetStatement`/列表 facet SQL 生成器，在同一个权限 CTE 上并行执行并返回结果。

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm check:receivables-core`

Expected: PASS。

### Task 3: 构建异常处置台并验证响应式布局

**Files:**
- Modify: `apps/admin/src/ReceivablesPage.tsx`
- Modify: `apps/admin/src/ReceivablesLedger.tsx`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: `receivablesDashboardMode`、`receivablesLedgerInitialState`、扩展后的 dashboard facets。

- [x] **Step 1: Use the tested model in the page**

把八张平铺卡重组为重点余额面板、三个辅助指标、异常处置列表、债权状态和单位分布，并让入口生成现有台账筛选 URL。

- [x] **Step 2: Initialize ledger filters from URL**

台账 `useState` 使用 `receivablesLedgerInitialState(location.search)`，保留 `ledgerId` 打开详情行为。

- [x] **Step 3: Add the minimum CSS**

只增加异常处置台语义类、键盘焦点和 900px/768px 响应式规则，复用现有颜色和圆角体系。

- [x] **Step 4: Verify compilation and focused behavior**

Run: `pnpm check:receivables-core`

Run: `pnpm --filter @safety/admin typecheck`

Expected: 两项均 PASS。

- [x] **Step 5: Run Impeccable detector and capture desktop/mobile**

Run: `impeccable detect --json`

用本地页面分别检查 1440px 与 390px：首屏层级清楚，无横向页面溢出，筛选和卡片可键盘操作。
