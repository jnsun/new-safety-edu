# 项目与合同模块发布范围审查

日期：2026-09-25。本文件下半部分保留首轮独立范围审查，原“提交阻断项”是发现时的历史清单，不代表仍未修复。本轮最终 Gate 的合同 schema 分类见 [CONTRACT-SCHEMA-DIFF-SCOPE.md](./CONTRACT-SCHEMA-DIFF-SCOPE.md)；精确暂存范围列于下一节。**独立合同提交不等于部署**，原工作区的 46 项未提交修改保持不动。

## 本轮原子提交范围

只暂存下表所列路径，使用显式路径 `git add`，再以 `git diff --cached --name-only` 和 `git diff --cached --check` 对照。合同行为以代码、迁移和测试为准；历史文档只记录审查证据。不得把五页新版 UI、财务/月报业务重构、生产数据或部署配置放入提交。

| 范围 | 精确路径 | 目的 |
| --- | --- | --- |
| 领域说明 | `CONTEXT-MAP.md`; `docs/adr/0010-contract-project-finance-boundaries.md`; `docs/contracts/CONTEXT.md`; `docs/contracts/IMPORT-PREFLIGHT.md`; `docs/contracts/CONTRACT-SCHEMA-DIFF-SCOPE.md`; `docs/contracts/CONTRACT-RELEASE-CANDIDATE-REVIEW.md`; `docs/contracts/RELEASE-SCOPE-AUDIT.md` | 记录合同边界、导入预检、差异分类及阶段核查 |
| 数据结构 | `prisma/schema.prisma`; `prisma/migrations/202609240001_contract_management/migration.sql` | 合同实体、授权与项目关联；既有业务字段不迁移 |
| API 及跨模块门禁 | `apps/api/package.json`; `apps/api/src/contract-access.ts`; `apps/api/src/contract-import-preflight.ts`; `apps/api/src/contract-project-eligibility.ts`; `apps/api/src/routes/contracts.ts`; `apps/api/src/server.ts`; `apps/api/src/access.ts`; `apps/api/src/routes/day1.ts`; `apps/api/src/routes/project-reporting.ts`; `apps/api/src/routes/wechat.ts`; `apps/api/src/routes/files.ts`; `apps/api/src/private-file-access.ts`; `apps/api/src/private-file-policy.ts` | 合同 API、授权、文件隔离与新项目安全/月报准入 |
| 管理端接入 | `apps/admin/src/App.tsx`; `apps/admin/src/platform-access.ts`; `apps/admin/src/ContractManagementPage.tsx`; `apps/admin/src/contracts/model.ts`; `apps/admin/src/contracts/ProjectDetailPage.tsx`; `apps/admin/src/contracts/ProjectFormDrawer.tsx`; `apps/admin/src/contracts/contracts.css` | 系统入口、真实路由、列表与详情、表单和合同局部样式 |
| 针对性检查 | `apps/api/scripts/check-contract-access.mts`; `apps/api/scripts/preflight-contract-import.mts`; `apps/api/scripts/smoke-contracts-e2e.mts` | 授权、预检和真实 API 烟测 |

`prisma/schema.prisma` 的实际 diff 含原有格式对齐噪声；`git diff -w` 用于核对语义变更，整个文件无删除旧模型或更改财务/培训数据结构。发布范围审查以**实际 staged diff**而非本表的意向为准。

## 基线

- 测试站上次核验版本：`0d6a7493…`；本地 `main` 和 `origin/main`：`e6950929aa2060dcc23800fb9f594db7f6b3e08a`。
- 两者之间仅一个提交。业务代码差异仅 `apps/api/src/routes/day4.ts` 的 22 行新增与 2 行删除；其余主要为材料、Figma 工具、文档。五页测试包暂选 `0d6a7493…` 为干净基线，避免带入无关已提交内容。该选择仍需在最终构建中验证。
- 隔离工作树：`C:\Users\sjn\.codex\worktrees\baseline-ui-test\new-safety-edu`，分支 `codex/baseline-ui-test`，从 `0d6a7493…` 建立。

## 文件范围

| 文件或目录 | 合同模块 | 五页必需 | 混入其他改动 / 处理 |
| --- | --- | --- | --- |
| `apps/admin/src/ContractManagementPage.tsx`、`apps/admin/src/contracts/*` | 是 | 是 | 独立新文件，需修复并验证 |
| `apps/api/src/routes/contracts.ts`、`apps/api/src/contract-access.ts` | 是 | 是 | 独立新文件，发现权限阻断项 |
| `prisma/migrations/202609240001_contract_management/migration.sql` | 是 | 是 | 独立新迁移，不得先向测试库执行 |
| `prisma/schema.prisma` | 是 | 是 | 合同模型与大量格式化行混在同一 diff；应仅移植必要语义 |
| `apps/api/src/server.ts`、`apps/api/src/access.ts`、`apps/api/src/contract-project-eligibility.ts`、`apps/api/src/routes/day1.ts`、`apps/api/src/routes/project-reporting.ts`、`apps/api/src/routes/wechat.ts` | 是 | 是 | 与原安全/月报/微信域共用；只移植必要 hunk，统一项目准入检查 |
| `apps/api/src/private-file-access.ts`、`private-file-policy.ts`、`routes/files.ts` | 是 | 是 | 与财务、人员私有文件共用；须修复跨域复用边界 |
| `apps/admin/src/App.tsx` | 是 | 是 | 合同路由/菜单/权限与登录、系统中心、五页外壳同文件；禁止整文件作为合同提交 |
| `apps/admin/src/styles.css` | 是 | 是 | 合同样式与其他页面样式同文件；合同段已提取到 `apps/admin/src/contracts/contracts.css`，五页共用样式另行提交 |
| `apps/api/scripts/check-contract-access.mts`、`smoke-contracts-e2e.mts` | 是 | 是 | 独立测试，需补越权与失败场景 |
| `apps/api/src/contract-import-preflight.ts`、`scripts/preflight-contract-import.mts`、`docs/contracts/*`、`docs/adr/0010-*.md` | 是 | 非五页运行必需 | 可列入独立合同交付，但导入预检不得正式写入 |
| `apps/api/package.json`、`CONTEXT-MAP.md` | 是 | 部分 | 仅移植合同脚本和领域索引 |
| `Dockerfile`、根 `package.json`、`scripts/start-receivables-local.ps1` | 否 | 否 | Node 版本与本地启动改动不并入合同提交 |
| `apps/api/scripts/check-receivables-schema.mts`、`apps/api/src/web-login-access.ts` 等 | 否 | 否 | 不并入合同提交 |
| `apps/admin/src/visual-system.css`、`visual-tokens.ts`、`receivables-baseline.css`、`monthly-reports.css`、`Receivables*.tsx`、`SafetyManagementPages.tsx` | 否 | 五页 UI 阶段部分需要 | 单独按页面与 hunk 审计，不并入合同提交 |

## 静态迁移审查

迁移新增四个枚举、六张合同表，并仅给既有 `projects` 增加可空字段和外键；无 `DROP`、`DELETE` 或既有数据 `UPDATE`。主合同与项目为一对零或一，`projects.main_contract_id` 有唯一索引；有效授权按 `person_id` 有部分唯一索引。合同附件归属 `owner_type/owner_id` 未有多态外键，需由 API 与测试保证。

本机临时 PostgreSQL 17 的 `127.0.0.1:55433/contract_test` 从空库成功应用全部 44 个迁移，包含 `202609240001_contract_management`。随后合同端到端烟测通过；临时服务已停止。该验证不是测试站迁移，也不证明测试站已有数据的升级无冲突。Prisma schema diff 在合同表上未报告差异，但报告若干既有非合同表的默认值、索引和外键命名差异（命令退出码 1）；不能标为全库无漂移。

## 提交阻断项

1. `GET /api/contracts/projects` 已挂认证前置处理；此前搜索条件的 `OR` 会覆盖组织范围的 `OR`，有合同授权用户可跨实体查询。隔离分支已改为交集条件并补烟测断言，数据库端到端尚未运行。
2. 分包所属实体可查看关联项目，但当前写操作复用“可见”判定，可能改责任实体主项目、合同及阶段。写权限须限定责任实体或明确全局授权。
3. 新项目可直接设置 `won` 却无主合同，安全/月报接口便将其纳入；必须统一判定“既有项目例外，新增项目中标且已登记主合同”。微信登记等直查项目入口也须一并审计。
4. 纳入合同模块的既有安全项目若选择非 `won`，`canAccessProject` 又拒绝其安全操作，与列表例外及历史保护相冲突。
5. 合同编辑可直接修改共享项目的责任经营实体，或将已关联主合同项目退回 `lost/abandoned`，可能破坏已有成员、培训、月报数据范围；须锁定或设计受控迁移流程。
6. 同一私有文件可复用为合同和财务附件；读取策略遇合同关联先返回，可能绕过财务专用权限。须阻止跨域复用并按所有关联域收紧读取。
7. 主合同、年度金额和分包金额 API 当前允许负数；仅补充合同增减额可为负。
8. 项目主档已创建而附件上传失败时，页面仍提示整体保存失败，重试可能重复创建项目；须拆开结果与重试。
9. CSV 导出只转义双引号，用户输入若以公式前缀开头可能形成表格公式；需中和并测试。
10. 合同列表当前取全量、仅前端分页；五页验收要求服务端分页和真实总数，需补接口与 UI。

## 首轮下一道门槛（历史记录，已由本轮 Final Gate 复核）

隔离工作树已移植合同运行代码、迁移、领域说明与合同专用 CSS；没有整文件移植混合的 `App.tsx`、`styles.css`。已对以上风险做首轮修补，但**不代表安全验收完成**。

已核验：Prisma `validate` 与 `generate`、共享 contracts 包构建、API TypeScript 构建、管理端 typecheck/build、`check:contract-access`、`check:private-file-policy`、`check:platform-access`、`check:project-reporting`、`check:phase1-invariants`、`check:phase1-policy` 均通过。`smoke:contracts-e2e` 在本机独立临时库第二次增强后通过，覆盖搜索范围、分页、未签约准入、既有项目、分包只读范围、负金额、私有附件和财务权限隔离。测试库未触及。Node 24.19.0 与该基线声明的 Node 22 引擎不一致，构建不能替代目标运行环境验证。

当时尚未核验测试站现有数据的迁移预检、浏览器多角色流程和目标镜像启动。本轮合同 Final Gate 已分别补验；五页新版 UI 与 Figma 对照仍是**后续独立任务**，不在合同 RC 范围。`prisma/schema.prisma` 的格式对齐噪声通过语义 diff 审查，不代表旧业务模型的修改。测试库迁移与部署仍未执行。
