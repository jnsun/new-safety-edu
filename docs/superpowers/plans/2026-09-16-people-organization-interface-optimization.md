# 人员与组织管理模块界面优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将人员、组织、项目、审核和数据工具整理为可在 20–30 个组织间快速切换的统一工作台，并保持列表与详情导航状态。

**Architecture:** 新增一个只负责布局和滚动边界的共享双栏组件，业务查询、权限和 mutation 仍留在现有页面。新增纯函数管理组织分组和 URL 状态，使关键交互可用现有脚本式检查验证，不引入新依赖、不修改 API 或数据库。

**Tech Stack:** React 19、React Router、TanStack Query、Ant Design、TypeScript strict、CSS。

**Spec:** `docs/superpowers/specs/2026-09-16-people-organization-interface-optimization-design.md`

## Global Constraints

- 不修改 Prisma schema，不新增 migration。
- 不修改培训教育、资质证照、野外项目报送、应收账款和微信小程序业务。
- 不改变角色授权矩阵、服务端数据范围或敏感字段策略。
- 不新增状态管理、表格、虚拟滚动或设计依赖。
- 前端隐藏、筛选和禁用不能替代服务端鉴权。
- 桌面端目录与详情独立滚动，小屏不得出现页面级横向滚动。

---

### Task 1: 工作台状态与组织分组

**Files:**
- Create: `apps/admin/src/people-organization/workspace-state.ts`
- Create: `apps/admin/scripts/check-workspace-state.mts`
- Modify: `package.json`

**Interfaces:**
- Produces: `groupOrganizations(rows)`、`readWorkspaceSelection(search, key, availableIds)`、`writeWorkspaceSelection(search, key, id)`。
- Consumes: 组织对象的 `id`、`name`、`type`、`memberCount` 字段。

- [ ] **Step 1: 写失败检查**

```ts
assert.deepEqual(groupOrganizations(rows).map(({ type, rows }) => [type, rows.length]), [
  ["business_entity", 1], ["department", 2], ["contractor", 1],
]);
assert.equal(readWorkspaceSelection(new URLSearchParams("organizationId=dept-2"), "organizationId", ids), "dept-2");
assert.equal(readWorkspaceSelection(new URLSearchParams("organizationId=missing"), "organizationId", ids), "entity-1");
```

- [ ] **Step 2: 运行检查并确认因导出不存在而失败**

Run: `pnpm --filter @safety/admin exec tsx scripts/check-workspace-state.mts`

- [ ] **Step 3: 实现最小纯函数**

```ts
export function readWorkspaceSelection(search: URLSearchParams, key: string, availableIds: string[]) {
  const requested = search.get(key);
  return requested && availableIds.includes(requested) ? requested : availableIds[0];
}
```

- [ ] **Step 4: 添加根脚本并验证通过**

Run: `pnpm check:workspace-state`

---

### Task 2: 通用双栏工作台外壳

**Files:**
- Create: `apps/admin/src/people-organization/SplitWorkspace.tsx`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Produces: `SplitWorkspace`、`WorkspaceDirectory`、`WorkspaceDetail`。
- Consumes: 目录头、目录内容、详情头、详情内容和可选 `mobileSelector` React 节点。

- [ ] **Step 1: 写组件契约检查**

在 `check-workspace-state.mts` 中断言 `workspaceViewportClass({ compact: false }) === "master-workbench"`、紧凑模式包含 `is-compact`，保证样式入口稳定。

- [ ] **Step 2: 运行检查并确认失败**

Run: `pnpm check:workspace-state`

- [ ] **Step 3: 实现布局组件**

```tsx
export function SplitWorkspace({ directory, detail, mobileSelector }: Props) {
  return <div className="master-workbench">
    <aside className="master-directory">{directory}</aside>
    {mobileSelector && <div className="master-mobile-selector">{mobileSelector}</div>}
    <section className="master-detail">{detail}</section>
  </div>;
}
```

- [ ] **Step 4: 完成滚动和响应式 CSS**

桌面端设置可视区高度、左右 `min-height: 0`、目录内容与详情内容独立 `overflow: auto`；小于 900px 隐藏长目录并显示顶部切换器。

- [ ] **Step 5: 运行 Admin 类型检查**

Run: `pnpm --filter @safety/admin typecheck`

---

### Task 3: 组织与项目工作台

**Files:**
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/styles.css`
- Modify: `apps/admin/scripts/check-workspace-state.mts`

**Interfaces:**
- Consumes: `GET /api/organizations`、`GET /api/persons`、`GET /api/projects` 与现有角色、成员 mutation。
- Produces: `/organization?organizationId=...`、`/projects?projectId=...` 可恢复工作台。

- [ ] **Step 1: 扩展失败检查**

断言组织类型顺序固定为经营实体、部门、外协单位；过滤结果中不包含公司根组织；选择不存在时安全回退到第一项。

- [ ] **Step 2: 运行检查并确认失败**

Run: `pnpm check:workspace-state`

- [ ] **Step 3: 重构组织目录**

使用分组、类型筛选、名称搜索和紧凑人数行；点击时写入 `organizationId`，并将右侧滚动容器回到顶部。

- [ ] **Step 4: 重构组织详情**

将概览、人员、职责权限、项目和变更记录放入右侧页签；普通部门隐藏项目与报送权限；人员表不分页且姓名进入详情。

- [ ] **Step 5: 重构项目目录与详情**

使用相同工作台外壳，按状态和名称筛选项目；右侧展示概览、成员、管理员、加入申请、培训摘要和变更记录，继续复用现有成员操作。

- [ ] **Step 6: 验证策略与构建**

Run: `pnpm check:workspace-state && pnpm check:person-role-contract && pnpm check:project-membership-policy && pnpm --filter @safety/admin typecheck`

---

### Task 4: 人员列表与详情导航状态

**Files:**
- Modify: `apps/admin/src/people-organization/people-list.ts`
- Modify: `apps/admin/scripts/check-people-list.mts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/styles.css`
- Modify: `package.json`

**Interfaces:**
- Produces: `readPeopleListState(search)`、`writePeopleListState(state)`。
- Consumes: 现有 `filterPeopleRows`、`PeopleView` 和 `/people/:personId` 路由。

- [ ] **Step 1: 写失败检查**

```ts
const state = readPeopleListState(new URLSearchParams("q=张&organizationId=dept&view=grouped&page=2"));
assert.deepEqual(state, { search: "张", organizationId: "dept", view: "grouped", page: 2 });
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @safety/admin exec tsx scripts/check-people-list.mts`

- [ ] **Step 3: 用 URL 查询参数驱动筛选与页码**

搜索、组织、人员状态、账号状态、角色、视图和页码更新 URL；进入详情时保留 `returnTo`，返回后恢复过滤与分页。

- [ ] **Step 4: 收紧列表和详情层级**

列表只保留必要字段与姓名入口；勾选后才显示批量工具条。人员详情维持八个页签，统一标题、返回、摘要和谨慎操作位置。

- [ ] **Step 5: 运行检查和类型检查**

Run: `pnpm --filter @safety/admin exec tsx scripts/check-people-list.mts && pnpm --filter @safety/admin typecheck`

---

### Task 5: 审核中心与数据工具

**Files:**
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/styles.css`
- Create: `apps/admin/src/people-organization/review-list.ts`
- Create: `apps/admin/scripts/check-review-list.mts`
- Modify: `package.json`

**Interfaces:**
- Produces: `filterReviewRows(rows, scope, accountId)` 与同页选中详情。
- Consumes: 现有身份绑定审核专用端点、`GET /api/management/requests`、敏感导出和导入组件。

- [ ] **Step 1: 写审核筛选失败检查**

断言待我处理只包含 `pending`，我已处理只包含当前账号处理的非 pending，全部记录保留服务端已授权数据。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm --filter @safety/admin exec tsx scripts/check-review-list.mts`

- [ ] **Step 3: 实现审核队列与同页详情**

左侧显示类型、申请人、范围和状态；右侧保留现有专用审核动作，不用普通管理审核端点处理身份绑定申请。

- [ ] **Step 4: 重排数据工具**

用纵向任务清单承载人员导入、照片导入、批量部门、导入结果和敏感导出，继续复用现有组件与权限判断。

- [ ] **Step 5: 验证**

Run: `pnpm check:review-list && pnpm check:request-policy && pnpm check:change-request-lifecycle && pnpm --filter @safety/admin typecheck`

---

### Task 6: 视觉、响应式与交付

**Files:**
- Modify: `apps/admin/src/styles.css`
- Modify: `docs/admin-quick-guide.md`

**Interfaces:**
- Consumes: Tasks 1–5 的最终页面。
- Produces: 桌面、中间宽度和小屏一致的完成态。

- [ ] **Step 1: 完成状态样式**

补齐加载、空数据、错误、无权限、选中、悬停、键盘焦点、禁用和移动端切换状态。

- [ ] **Step 2: 更新管理员简明说明**

说明目录独立滚动、组织分组、人员详情入口、审核中心和数据工具的新位置。

- [ ] **Step 3: 运行 Impeccable 检测**

Run: `impeccable detect --json apps/admin/src/App.tsx apps/admin/src/people-organization apps/admin/src/styles.css`

- [ ] **Step 4: 运行完整最小验证**

Run: `pnpm check:workspace-state && pnpm check:people-list && pnpm check:review-list && pnpm check:person-role-contract && pnpm check:project-membership-policy && pnpm --filter @safety/admin typecheck && pnpm --filter @safety/admin build`

- [ ] **Step 5: 浏览器人工检查**

在桌面和小屏尺寸验证：从目录底部选择组织、详情回顶、人员较少、刷新保留选择、人员详情返回、项目切换、审核处理和空数据状态。

- [ ] **Step 6: 提交、推送并部署测试站**

显式暂存本计划涉及文件，执行 `git diff --cached --check` 和敏感信息扫描；提交后确认 `origin/main` 是本地 HEAD 祖先再推送。只重建测试站 Web 镜像并核验 `https://test.safety.sx.cn` 与 `/api/health`，不修改生产站、数据库或数据卷。
