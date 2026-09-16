# Web 微信登录与模块入口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将后台登录改为微信扫码优先的翻转卡片，并按服务端权限展示应收账款或事故事件模块，同时把人员与账号、组织与项目整合为独立模块入口。

**Architecture:** 继续复用现有微信开放平台 OAuth、`ReceivableSetting.financeOrganizationId` 和 `ReceivableAccessGrant`。服务端把财务部门当前 active 主部门成员解析为全台账只读访问；现有负责人、管理员和报账员权限不变。Admin 仅消费服务端访问结果，不根据中文部门名或前端角色自行推断权限。

**Tech Stack:** Fastify、Prisma、React、Ant Design、TanStack Query、TypeScript strict。

**Spec:** 本任务对话中已确认的短设计。

## Global Constraints

- 不修改培训教育业务页面、数据库 schema 或现有应收授权记录。
- 不把微信 AppSecret 或其他秘密值返回客户端。
- 财务部门普通人员只读，负责人、管理员和报账员继续按现有授权获得能力。
- 无应收访问权限的人员只看到待规划“事故事件管理”，服务端仍拒绝应收 API。
- 微信扫码为主，用户名密码为备用；保留现有找回密码能力。
- 复用既有页面和路由，不引入新的 UI 或二维码依赖。

---

### Task 1: 财务部门普通人员只读访问

**Files:**
- Modify: `apps/api/scripts/check-receivables-access.mts`
- Modify: `apps/api/src/receivables-access.ts`

**Interfaces:**
- Consumes: `ReceivableSetting.financeOrganizationId`、人员当前 active primary `OrganizationMembership`。
- Produces: `ReceivablesAccessFacts.isFinanceOrganizationMember`，对应 `role: "readonly"`、`canViewAll: true` 的只读访问结果。

- [ ] **Step 1: Write the failing check**

在专项检查中构造 active 财务部门成员且没有显式 grant 的事实，断言可以进入和读取全部台账，但所有写入、导出和配置能力为 false。

- [ ] **Step 2: Run check to verify it fails**

Run: `pnpm --filter @safety/api check:receivables-access`

Expected: FAIL，因为当前 `decideReceivablesAccess` 不识别财务部门成员。

- [ ] **Step 3: Write minimal implementation**

在 `resolveReceivablesAccess` 查询人员当前主部门是否等于配置的财务部门；在策略函数中仅赋予只读、全范围查看能力。

- [ ] **Step 4: Run check to verify it passes**

Run: `pnpm --filter @safety/api check:receivables-access`

Expected: `RECEIVABLES_ACCESS_OK`。

### Task 2: 微信网页登录准入策略

**Files:**
- Create: `apps/api/src/web-login-access.ts`
- Create: `apps/api/scripts/check-web-login-access.mts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/routes/wechat-web-auth.ts`

**Interfaces:**
- Consumes: 当前人员是否具备后台管理角色、`ReceivablesAccess.canEnter`。
- Produces: `decideWebLoginDestination({ hasManagerRole, canEnterReceivables })`，返回平台首页、应收账款或拒绝原因。

- [ ] **Step 1: Write the failing check**

断言管理人员进入平台首页、只有应收权限的普通人员进入 `/receivables`、两者都没有则拒绝。

- [ ] **Step 2: Run check to verify it fails**

Run: `pnpm --filter @safety/api check:web-login-access`

Expected: FAIL，因为策略文件尚不存在。

- [ ] **Step 3: Write minimal implementation**

提取纯策略函数；微信回调完成账号识别后调用 `resolveReceivablesAccess`，按策略跳转，仍使用现有 HttpOnly Cookie 和审计。

- [ ] **Step 4: Run check to verify it passes**

Run: `pnpm --filter @safety/api check:web-login-access`

Expected: `WEB_LOGIN_ACCESS_OK`。

### Task 3: 登录翻转界面

**Files:**
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: `/api/auth/wechat-web/config`、既有 `/api/auth/wechat-web/start`。
- Produces: 默认微信扫码面、备用密码面、可键盘操作的翻转按钮和 reduced-motion 兼容样式。

- [ ] **Step 1: Implement the smallest UI state**

用一个 `loginMode` 状态控制同一张卡片正反面；默认微信面，未配置微信时自动显示密码面。扫码面调用现有微信授权入口，不读取秘密值。

- [ ] **Step 2: Replace login copy**

删除登录页公司名与“安”字标识，主文案改为“安全生产管理平台”，说明人员、组织、项目和业务模块统一协同。

- [ ] **Step 3: Add accessible motion**

增加 3D 翻转、清晰焦点、窄屏布局和 `prefers-reduced-motion` 无动画回退。

- [ ] **Step 4: Run Admin typecheck**

Run: `pnpm --filter @safety/admin typecheck`

Expected: PASS。

### Task 4: 首页按权限替换模块并独立人员组织模块

**Files:**
- Modify: `apps/admin/src/App.tsx`

**Interfaces:**
- Consumes: `/api/receivables/access` 返回的服务端权威结果。
- Produces: 有权限显示应收账款，无权限显示事故事件管理；“人员与组织管理”替换风险分级管控。

- [ ] **Step 1: Replace the fixed module card**

把风险分级管控替换为“人员与组织管理”，入口复用 `/people`。

- [ ] **Step 2: Scope the module menu**

`/people` 与 `/organization` 使用只包含返回首页、人员与账号、组织与项目的模块侧栏；培训侧栏删除这两个入口。

- [ ] **Step 3: Make the ninth card deterministic**

始终渲染九个位置：应收权限有效时显示应收账款；否则显示无路由的事故事件管理待规划卡片。

- [ ] **Step 4: Run Admin production build**

Run: `pnpm --filter @safety/admin build`

Expected: PASS。

### Task 5: 最小回归验证

**Files:**
- Verify only.

**Interfaces:**
- Consumes: Tasks 1-4 的构建产物。
- Produces: 可复现的检查结果和干净的变更清单。

- [ ] **Step 1: Run service checks**

Run: `pnpm --filter @safety/api check:receivables-access` and `pnpm --filter @safety/api check:web-login-access`。

- [ ] **Step 2: Run production builds**

Run: `pnpm --filter @safety/api build` and `pnpm --filter @safety/admin build`。

- [ ] **Step 3: Run Impeccable detector**

Run the detector against modified Admin source and resolve any high-signal findings.

- [ ] **Step 4: Inspect Git diff**

确认没有秘密值、真实个人数据、数据库迁移或培训教育业务改动；不自动部署生产。
