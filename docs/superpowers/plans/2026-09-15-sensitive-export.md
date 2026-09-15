# 范围化敏感资料导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许公司、组织和项目范围管理员生成受范围约束、可审计、一次性下载的敏感资料 ZIP。

**Architecture:** 新建 `SensitiveExportJob` 保存不可变范围快照和任务状态；`sensitive-export.ts` 作为深模块，唯一公开接口负责授权、文件归集、ZIP 构建和一次性领取。Fastify 路由只校验固定输入并调用该模块，Admin 只提交固定 scope/category，不接受任意查询条件。

**Tech Stack:** Fastify、Prisma、PostgreSQL、Node.js fs/crypto、archiver、React、Ant Design。

**Spec:** `docs/superpowers/specs/2026-09-15-person-account-permission-audit.md`

## Global Constraints

- 不导出密码、哈希、密钥、token、openid、unionid、session_key、IP 或原始 User-Agent。
- 服务端根据当前数据库角色重新计算 company/organization/project 范围。
- ZIP 文件保存在 `UPLOAD_ROOT/.sensitive-exports`，权限 600，不登记为普通公开文件。
- 下载令牌只保存 SHA-256，十分钟内一次有效；请求、完成、领取均与审计同一事务。
- 同一账号同一有效请求只生成一份，不增加通用任务编排器。

---

### Task 1: 导出任务模型与范围策略

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202609150005_sensitive_export_jobs/migration.sql`
- Create: `apps/api/src/sensitive-export-policy.ts`
- Test: `apps/api/scripts/check-sensitive-export-policy.mts`

**Interfaces:**
- Produces: `resolveSensitiveExportScope(principal, { scopeType, scopeId })`，仅返回已授权的不可变范围描述；无权限抛出 403。
- Produces: `SensitiveExportJob` 状态 `pending | processing | ready | failed | downloaded | expired`。

- [x] **Step 1: Write the failing test** — 覆盖公司、组织、项目允许路径和越权拒绝。
- [x] **Step 2: Run test to verify it fails** — `pnpm check:sensitive-export-policy` 已因模块缺失失败。
- [x] **Step 3: Write minimal implementation** — 固定三类 scope 和五类 category，不接受任意筛选器。
- [x] **Step 4: Run test to verify it passes** — 输出 `SENSITIVE_EXPORT_POLICY_OK`。

### Task 2: ZIP 生成与一次性下载

**Files:**
- Create: `apps/api/src/sensitive-export.ts`
- Create: `apps/api/src/routes/sensitive-exports.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Test: `apps/api/scripts/smoke-sensitive-export.mts`

**Interfaces:**
- Produces: `createSensitiveExportJob(principal, input, env)` 返回任务 ID。
- Produces: `processSensitiveExportJob(jobId, env)` 原子转移状态并生成 ZIP。
- Produces: `issueSensitiveExportDownload(jobId, principal)` 返回一次性原始 token，数据库只保存 hash。
- Produces: `consumeSensitiveExportDownload(jobId, token, principal, env)` 原子领取并返回文件路径和下载名。

- [x] **Step 1: Write the failing integration check** — 匿名隔离库中验证授权范围、ZIP 清单、重复请求、一次性 token、第二次下载拒绝和审计。
- [x] **Step 2: Run it to verify it fails** — 新路由不存在时预期 404。
- [x] **Step 3: Implement fixed-scope collection** — 归集范围内人员基本敏感档案、照片、签字、证照附件、培训/审批附件和脱敏安全审计；每个文件再次按业务关系确定归属。
- [x] **Step 4: Stream ZIP and finalize atomically** — 任一文件失败则任务 `failed`，不标记为 `ready`。
- [x] **Step 5: Verify download semantics** — 首次成功，重复 token 返回 409，到期任务清理产物。

### Task 3: Admin 入口与收口验证

**Files:**
- Create: `apps/admin/src/SensitiveExports.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `docs/superpowers/specs/2026-09-15-person-account-permission-audit.md`

**Interfaces:**
- Consumes: `/api/sensitive-exports`、`/api/sensitive-exports/:id/token`、`/api/sensitive-exports/:id/download`。

- [x] **Step 1: Add the minimal tab** — 固定范围、固定类别、显式确认、任务状态和下载按钮。
- [x] **Step 2: Build** — `pnpm typecheck && pnpm build && pnpm check:miniprogram`。
- [x] **Step 3: Validate migrations and smoke** — 空 PostgreSQL `prisma migrate deploy` 与 `pnpm smoke:sensitive-export`。
- [x] **Step 4: Safety scan** — `git diff --check` 和变更文件密钥/真实数据扫描。
