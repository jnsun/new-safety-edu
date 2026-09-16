# 人员与组织管理工作台改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Admin 的人员、账号、组织、项目、审核和数据工具整理成已确认的统一工作台，同时保持现有服务端权限和业务行为不变。

**Architecture:** 继续使用 React Router、TanStack Query 和 Ant Design。把 `App.tsx` 中已经过大的人员/账号/组织/项目组件提取到 `people-organization` 目录；复用现有 API，仅为稳定详情路由和批量预检查补充最小响应字段。所有写操作继续调用现有服务端端点，不在前端复制权限规则。

**Tech Stack:** React 19、React Router 7、TanStack Query 5、Ant Design 5、Fastify 5、Prisma 6、TypeScript strict。

**Spec:** `docs/superpowers/specs/2026-09-16-people-organization-workspace-redesign.md`

## Global Constraints

- 仅改“人员与组织管理”模块，不改变培训教育及其他业务模块。
- 不新增前端依赖或平行账号/人员模型。
- 默认不创建 Prisma migration；若现有结构可表达需求，数据库零变更。
- 服务端鉴权是唯一权限依据，前端隐藏按钮不能替代鉴权。
- 复用现有人员、账号、组织、项目、申请、导入、敏感导出和审计端点。
- 保留现有敏感字段二次验证、会话失效、历史保留和审计规则。

---

### Task 1: 建立模块路由与页面骨架

**Files:**
- Create: `apps/admin/src/people-organization/PeopleOrganizationLayout.tsx`
- Create: `apps/admin/src/people-organization/types.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: `Principal`、现有 `api()`、React Router 嵌套路由。
- Produces: `/people`、`/people/:personId`、`/organization`、`/projects`、`/people/reviews`、`/people/tools`、`/people/account-issues` 路由和统一模块菜单。

- [ ] **Step 1: 添加模块菜单静态检查**

在 `apps/admin/scripts/check-people-organization-navigation.mts` 中读取路由配置并断言日常入口恰好包含“人员档案、组织与职责、项目与成员、审核中心、数据工具”，账号异常处理带 `companyAdminOnly: true`。

- [ ] **Step 2: 运行检查并确认失败**

Run: `pnpm --filter @safety/admin exec tsx scripts/check-people-organization-navigation.mts`

Expected: FAIL，因为模块路由配置尚不存在。

- [ ] **Step 3: 创建最小布局和路由配置**

在 `PeopleOrganizationLayout.tsx` 导出：

```ts
export const peopleOrganizationNav = [
  { key: "/people", label: "人员档案" },
  { key: "/organization", label: "组织与职责" },
  { key: "/projects", label: "项目与成员" },
  { key: "/people/reviews", label: "审核中心" },
  { key: "/people/tools", label: "数据工具" },
  { key: "/people/account-issues", label: "账号异常处理", companyAdminOnly: true },
] as const;
```

布局只负责菜单、标题、权限过滤和 `<Outlet />`，不承载业务查询。

- [ ] **Step 4: 将 Shell 路由接入新布局**

保留现有外部 URL `/people` 和 `/organization`，新增其余子路由；移除旧页面内部“人员档案/账号与权限/身份绑定申请/敏感资料导出”总 Tabs。

- [ ] **Step 5: 验证导航和类型**

Run: `pnpm --filter @safety/admin exec tsx scripts/check-people-organization-navigation.mts && pnpm --filter @safety/admin typecheck`

Expected: PASS。

### Task 2: 改造人员列表并增加稳定详情路由

**Files:**
- Create: `apps/admin/src/people-organization/PeopleListPage.tsx`
- Create: `apps/admin/src/people-organization/people-list.ts`
- Create: `apps/admin/scripts/check-people-list.mts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: `GET /api/persons`、`GET /api/accounts`、`GET /api/organizations`。
- Produces: `filterPeople(rows, filters)`、列表/部门分组视图、`/people/:personId` 导航。

- [ ] **Step 1: 为搜索和筛选写失败检查**

覆盖姓名、脱敏手机号、用户名、组织、人员状态、账号状态和角色；断言默认视图为 `list`，分组视图只在用户主动切换后启用。

- [ ] **Step 2: 运行检查并确认失败**

Run: `pnpm --filter @safety/admin exec tsx scripts/check-people-list.mts`

Expected: FAIL，因为 `people-list.ts` 尚不存在。

- [ ] **Step 3: 实现纯筛选函数和页面**

使用现有查询数据建立人员行，不增加新状态库。用当前 `user_preferences` 接口（若已有对应键）保存 `peopleView=list|grouped`；没有通用写入口时先用 `localStorage` 保存纯显示偏好，不保存敏感数据。

- [ ] **Step 4: 将批量操作改为选择后显示**

保留现有批量设置部门调用；添加“批量停用”入口时先调用 Task 7 的预检查端点。未选择人员时不展示批量危险操作。

- [ ] **Step 5: 验证人员列表**

Run: `pnpm --filter @safety/admin exec tsx scripts/check-people-list.mts && pnpm --filter @safety/admin typecheck`

Expected: PASS。

### Task 3: 将人员详情从 Modal 改为独立页面

**Files:**
- Create: `apps/admin/src/people-organization/PersonDetailPage.tsx`
- Create: `apps/admin/src/people-organization/PersonAccountPanel.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: `GET /api/persons/:id/details` 及现有人员、账号、证照敏感访问端点。
- Produces: 八个详情页签，以及按账号状态计算的可执行动作界面。

- [ ] **Step 1: 提取现有 PersonDetail 内容**

保持现有 API 调用、敏感字段短时显示和审计不变，把 `person` 参数改为从 `useParams().personId` 读取。

- [ ] **Step 2: 按确认结构重排页签**

固定为“基本档案、账号与登录、组织与权限、项目关系、证照、培训记录、申请与变更、操作记录”。

- [ ] **Step 3: 合并 AccountsPanel 的单人操作**

将创建账号、重置密码、修改用户名、管理登录方式、停用/启用账号和误建空账号清理移入 `PersonAccountPanel`。每个状态只显示服务端允许的动作；已合并账号只读。

- [ ] **Step 4: 建立谨慎操作区域**

把人员停用、账号停用、解除微信、合并和清理误建档案从普通编辑按钮区移到底部；继续要求现有原因、二次确认和敏感令牌。

- [ ] **Step 5: 验证直达和刷新**

Run: `pnpm --filter @safety/admin typecheck && pnpm --filter @safety/admin build`

Expected: `/people/:personId` production build 成功，浏览器刷新不返回人员列表或 404。

### Task 4: 重建组织与职责工作台

**Files:**
- Create: `apps/admin/src/people-organization/OrganizationWorkspace.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /api/organizations`、组织角色授予/撤销端点、`GET /api/persons`。
- Produces: 左侧组织目录和右侧“概览、人员、职责权限、项目、变更记录”。

- [ ] **Step 1: 提取现有组织查询和 mutations**

删除宽表格呈现，但不改变创建、编辑、删除、授权和撤销请求体。

- [ ] **Step 2: 实现组织目录**

不分页；支持名称搜索和类型筛选；排除公司根组织；显示人数、负责人状态和经营实体项目数。

- [ ] **Step 3: 实现职责权限页签**

负责人使用“更换负责人”；管理员和经营实体报送人员使用人员列表管理；项目管理员只提供跳转到具体项目。候选人员继续由服务端结果和现有资格校验约束。

- [ ] **Step 4: 实现组织类型差异**

普通部门隐藏项目和报送入口；经营实体显示；外协单位只显示关联人员和基础资料。

- [ ] **Step 5: 验证组织权限**

Run: `pnpm check:person-role-contract && pnpm --filter @safety/admin typecheck`

Expected: 现有角色策略检查和 Admin 类型检查通过。

### Task 5: 重建项目与成员工作台

**Files:**
- Create: `apps/admin/src/people-organization/ProjectWorkspace.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: 现有项目 CRUD、项目成员、项目角色和申请端点。
- Produces: 左侧项目目录和右侧“项目概览、项目成员、项目管理员、加入申请、培训关联、变更记录”。

- [ ] **Step 1: 从 OrganizationProjects 提取项目代码**

保持原请求和权限判断，去除组织/项目同页 Tabs。

- [ ] **Step 2: 实现项目目录和详情区**

按项目名称、责任经营实体和状态筛选；页面内不复制月报表单或培训任务编辑器。

- [ ] **Step 3: 接入成员和管理员操作**

复用成员添加、批量添加、审核、结束关系及项目管理员授权端点。

- [ ] **Step 4: 验证项目边界**

Run: `pnpm check:project-membership-policy && pnpm check:person-role-contract && pnpm --filter @safety/admin typecheck`

Expected: PASS。

### Task 6: 统一审核中心和账号异常处理

**Files:**
- Create: `apps/admin/src/people-organization/ReviewCenter.tsx`
- Create: `apps/admin/src/people-organization/AccountIssuesPage.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/Day4Pages.tsx`

**Interfaces:**
- Consumes: `/api/binding-requests`、`/api/identity-binding-requests/:id/*`、`/api/management/requests`、`/api/accounts`。
- Produces: “待我处理、我已处理、全部记录”视图；公司管理员专用账号异常队列。

- [ ] **Step 1: 合并现有 BindingRequests 和管理申请列表**

统一类型标签和状态标签，但绑定申请仍调用专用审核端点，其他申请继续调用 management 端点，避免 `IDENTITY_REVIEW_REQUIRED`。

- [ ] **Step 2: 实现同页审核详情**

列表选择申请后在右侧显示申请摘要、匹配候选、冲突提示、可执行动作和审核意见，不再嵌套多层 Modal。

- [ ] **Step 3: 实现账号异常处理筛选**

仅公司管理员可进入；先复用现有账号状态和 `account_merge/person_merge/account_recovery` 申请，不创建新的异常表。

- [ ] **Step 4: 验证范围隔离**

Run: `pnpm check:request-policy && pnpm check:change-request-lifecycle && pnpm check:wechat-identity-policy && pnpm --filter @safety/admin typecheck`

Expected: PASS，部门管理员仍无法读取或处理其他组织申请。

### Task 7: 整理数据工具和批量人员生命周期

**Files:**
- Create: `apps/admin/src/people-organization/DataToolsPage.tsx`
- Create: `apps/api/src/person-bulk-lifecycle-policy.ts`
- Create: `apps/api/scripts/check-person-bulk-lifecycle.mts`
- Modify: `apps/api/src/routes/day1.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `package.json`

**Interfaces:**
- Consumes: 现有 `PersonImport`、批量设置部门、`SensitiveExports` 和单人 deletion preview。
- Produces: `POST /api/persons/batch-status-preview`、`POST /api/persons/batch-disable`，返回逐人 `eligible/code/reason`。

- [ ] **Step 1: 为批量预检查写失败检查**

覆盖空选择、超过 500 人、不存在人员、已停用人员、普通可停用人员，以及任何单行失败不阻断其他行预检查。

- [ ] **Step 2: 运行检查并确认失败**

Run: `pnpm --filter @safety/api exec tsx scripts/check-person-bulk-lifecycle.mts`

Expected: FAIL，因为策略模块尚不存在。

- [ ] **Step 3: 实现批量预检查和停用**

每名人员复用现有单人停用规则；事务内逐人结束当前管理角色、撤销会话并写审计。物理删除仍只使用现有单人误建档案删除端点，不提供批量强制删除。

- [ ] **Step 4: 组装数据工具页**

依次呈现人员导入、照片导入、批量部门调整、导入结果、模板下载和敏感资料导出；不复制各组件内部业务逻辑。

- [ ] **Step 5: 验证批量策略和导入回归**

Run: `pnpm check:people-bulk-management && pnpm check:person-import-upsert && pnpm --filter @safety/api exec tsx scripts/check-person-bulk-lifecycle.mts`

Expected: PASS。

### Task 8: 收口样式、构建和测试站人工验证

**Files:**
- Modify: `apps/admin/src/styles.css`
- Modify: `docs/admin-quick-guide.md`
- Modify: `docs/mvp-admin-guide.md`

**Interfaces:**
- Consumes: Tasks 1–7 全部页面。
- Produces: 一致的桌面布局、窄屏降级和更新后的管理员说明。

- [ ] **Step 1: 收口公共工作台样式**

使用现有 Ant Design token 和 CSS，统一目录宽度、详情区、状态标签、空状态、危险操作区和 1280px 以下布局；不新增设计系统。

- [ ] **Step 2: 更新管理员说明**

删除独立“账号与权限”入口说明，改为“搜索人员 → 进入详情 → 账号与登录”；补充组织职责、审核中心、数据工具和账号异常处理路径。

- [ ] **Step 3: 执行最小自动验证**

Run:

```powershell
pnpm --filter @safety/admin typecheck
pnpm --filter @safety/api typecheck
pnpm --filter @safety/admin build
pnpm --filter @safety/api build
pnpm check:person-account-domain-model
pnpm check:person-role-contract
pnpm check:request-policy
pnpm check:change-request-lifecycle
pnpm check:people-bulk-management
```

Expected: 全部退出码为 0。

- [ ] **Step 4: 在测试站完成定向人工验证**

验证：搜索人员并刷新详情路由；创建账号和重置密码；负责人/管理员/报送人员授权；跨组织审核不可见；导入入口和敏感导出可用；批量停用先预检查；培训教育、资质证照、野外项目报送和应收账款入口无回退。

- [ ] **Step 5: 检查工作区和秘密**

Run: `git diff --check && git status --short && rg -n "(APP_SECRET|SECRET_KEY|BEGIN .*PRIVATE KEY|真实身份证|真实手机号)" apps docs --glob '!docs/superpowers/**'`

Expected: diff 无空白错误，不包含密钥或真实人员数据。

## Self-review

- Spec coverage: 人员、账号、组织、项目、审核、数据工具、批量停用和误建档案清理均有对应任务。
- Scope: 无培训教育业务改动，无新依赖，默认无 migration。
- Security: 现有服务端鉴权、敏感访问、审计和会话失效路径均保留。
- Simplification: 不新增通用工作流、权限 DSL、全局状态库或平行 API；页面仅重组现有能力。
