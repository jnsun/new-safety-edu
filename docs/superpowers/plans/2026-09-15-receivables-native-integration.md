# 应收账款管理原生迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在主系统中原生实现可独立授权、服务端强制隔离、金额可追溯且可从九宫格进入的应收账款管理模块。

**Architecture:** 以 Fastify 内的应收账款深模块为唯一业务接口，集中处理财务身份、财务归属部门范围、金额口径、版本冲突、作废更正和事务审计；路由只做输入输出适配，React 页面只消费服务端能力。PostgreSQL 约束保证合同唯一和基本金额合法性，主系统 `PrivateFile`、`Notification`、`UserPreference` 和异步导出模式直接复用，不移植 Supabase RLS/RPC。

**Tech Stack:** Node.js 22、TypeScript、Fastify 5、Prisma 6、PostgreSQL 16、React 19、Ant Design 5、TanStack Query、ExcelJS。

**Spec:** `docs/superpowers/specs/2026-09-15-receivables-native-integration.md`

## Global Constraints

- 业务术语以 `docs/receivables/CONTEXT.md` 和 `docs/receivables/adr/` 为准。
- 系统级边界以 `docs/adr/0001-native-finance-integration.md` 至 `0004-authoritative-financial-history.md` 为准。
- 旧实现只读参考路径为 `E:\codex\legacy\Enterprise-Accounts-Receivable-Ledger`；不得复制 Supabase SDK、密钥、RLS 或独立账号实现。
- 必须复用主系统统一账号和会话；财务台账不关联平台项目主档，生产不做双写。
- 所有客户端提交均视为不可信；入口隐藏、字段禁用和筛选选择不是授权证据。
- 所有财务关键写操作和成功审计必须位于同一 Prisma 事务。
- 金额使用 `Decimal(18,4)`，不得用 JavaScript 浮点数执行权威合计。
- 开票金额和到账金额只从有效开票、回款明细聚合，不保存第二套可编辑汇总。
- 新建和导入台账必须关联启用的财务归属部门；合同编号规范化后全局唯一。
- 正式业务事实只作废、冲销或回滚，不物理删除。
- 不增加新运行时依赖；Excel 读写复用已经安装的 `exceljs`。
- 不改微信小程序，不修改与本模块无关的人员、账号和项目规则。
- 服务端分页和后台任务必须在五万份合同、五十万条明细基线上验证，不允许 5000 条静默截断。
- 当前工作树可能含用户修改。每次只显式暂存任务白名单文件，禁止 `git add .`、`git add -A`、reset 或 clean。
- 计划中的提交步骤只有在用户明确授权提交后执行；未授权时保持 staged 为 0。
- 开始数据库任务前确认 `prisma/migrations/202609150012_receivables_core` 未被占用；若被占用，使用当时下一个连续编号并同步计划记录。

## File and Module Map

- `apps/api/src/receivables-core.ts`：纯金额、合同编号、字段写入和状态转换规则；这是算法测试接口。
- `apps/api/src/receivables-access.ts`：从当前 `Principal` 和数据库事实解析单一 `ReceivablesAccess`；这是所有财务授权的唯一接口。
- `apps/api/src/receivables-admin.ts`：封装财务授权、独立部门、字典和历史迁移的策略、令牌与事务；路由只调用该深模块接口。
- `apps/api/src/receivables-query.ts`：封装授权范围、筛选、分页、facets、totals、详情和看板查询，保证所有视图复用同一过滤接口。
- `apps/api/src/receivables-ledger.ts`：封装台账创建、字段权限、乐观锁、修订快照、作废和同事务审计。
- `apps/api/src/receivables-money.ts`：封装开票、回款、核销、父台账串行化、权威金额重算和异常通知去重。
- `apps/api/src/receivables-files.ts`：封装财务附件关联、范围校验、作废、关键审计及文件读取所需的财务授权事实。
- `apps/api/src/routes/receivables.ts`：HTTP adapter，负责 Zod 输入和调用财务模块。
- `apps/api/src/receivables-import.ts`：服务端 Excel 预览、应用和批次回滚。
- `apps/api/src/receivables-export.ts`：后台 XLSX 生成、一次性下载和清理。
- `apps/admin/src/ReceivablesPage.tsx`：模块外壳、看板和台账查询。
- `apps/admin/src/ReceivablesLedger.tsx`：宽表、筛选、列偏好、编辑详情、明细和附件。
- `apps/admin/src/ReceivablesAdmin.tsx`：首次配置、财务授权、财务归属部门和字典。
- `apps/admin/src/ReceivablesTransfers.tsx`：导入预览、批次回滚和后台导出任务。
- `apps/admin/src/receivables-types.ts`：前端响应类型与固定字典键；不复制授权判断。

---

### Task 1: 纯业务规则接口

**Files:**
- Create: `apps/api/src/receivables-core.ts`
- Create: `apps/api/scripts/check-receivables-core.mts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `normalizeContractNo(value: string): string`。
- Produces: `calculateReceivableAmounts(input): { invoicedAmount; receivedAmount; internalReceivable; externalReceivable; balance; anomaly }`，金额值为字符串或 `Prisma.Decimal`，不返回 JS 浮点数。
- Produces: `assertWriteoffAllowed(input): void`，新增或调高核销超过未收余额时抛出 `WRITEOFF_EXCEEDS_BALANCE`。
- Produces: `assertLedgerPatchAllowed(actor: ReceivablesActorCapabilities, current, patch): void`，集中执行报账员字段白名单；Task 3 将数据库授权结果映射成该纯类型。
- Produces: `assertTransition(currentStatus, action): void`，拒绝修改已作废事实。

- [ ] **Step 1: 写失败检查**

```ts
assert.equal(normalizeContractNo("  HT-001  "), "HT-001");
assert.deepEqual(calculateReceivableAmounts({ finalAmount: "100", writeoffAmount: "0", invoiceAmounts: ["80"], receiptAmounts: ["30"] }), { invoicedAmount: "80.0000", receivedAmount: "30.0000", internalReceivable: "50.0000", externalReceivable: "20.0000", balance: "70.0000", anomaly: null });
assert.equal(calculateReceivableAmounts({ finalAmount: null, writeoffAmount: "0", invoiceAmounts: ["80"], receiptAmounts: ["30"] }).balance, null);
assert.throws(() => assertWriteoffAllowed({ previous: "0", next: "20", finalAmount: "100", receivedAmount: "90" }), /WRITEOFF_EXCEEDS_BALANCE/);
```

- [ ] **Step 2: 运行红灯**

Run: `pnpm check:receivables-core`

Expected: FAIL，提示 `receivables-core.js` 不存在。

- [ ] **Step 3: 实现最小纯函数**

实现固定字段集合 `reporterCreateFields`、`reporterPatchFields`，用 `Prisma.Decimal` 做四位小数运算；`anomaly` 只返回 `over_received | writeoff_adjustment_required | final_amount_missing | null`。

- [ ] **Step 4: 运行绿灯和类型检查**

Run: `pnpm check:receivables-core && pnpm typecheck`

Expected: 输出 `RECEIVABLES_CORE_OK`，命令退出码 0。

- [ ] **Step 5: 检查点提交**

```powershell
git add apps/api/src/receivables-core.ts apps/api/scripts/check-receivables-core.mts apps/api/package.json package.json
git diff --cached --check
git commit -m "feat: define receivables domain rules"
```

### Task 2: 数据库模型、约束和初始配置

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202609150012_receivables_core/migration.sql`
- Modify: `prisma/seed.ts`
- Create: `apps/api/scripts/check-receivables-schema.mts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `ReceivableSetting` 单行配置，保存 `financeOrganizationId`、`configurationConfirmedAt/By`。
- Produces: `ReceivableDepartment`、`ReceivableAccessGrant`、`ReceivableGrantDepartment`。
- Produces: `ReceivableLedger`、`ReceivableLedgerRevision`、`ReceivableInvoice`、`ReceivableReceipt`、`ReceivableAttachment`。
- Produces: `ReceivableDictionaryOption`、`ReceivableImportBatch`、`ReceivableImportItem`、`ReceivableExportJob`。
- Consumes: `Account`、`Organization`、`PrivateFile`、`AuditLog`、`Notification`、`UserPreference`。

- [ ] **Step 1: 写结构失败检查**

`check-receivables-schema.mts` 连接名称包含 `receivables_test` 的隔离数据库，断言合同规范化唯一索引、活动授权部分唯一索引、金额非负 CHECK、明细索引、外键 `ON DELETE RESTRICT` 和所有表存在；数据库名不匹配时立即退出。

- [ ] **Step 2: 运行红灯**

Run: `$env:DATABASE_URL='<isolated-receivables_test-url>'; pnpm check:receivables-schema`

Expected: FAIL，第一张 `receivable_settings` 表不存在。

- [ ] **Step 3: 增加 Prisma 模型和手写约束**

迁移必须至少包含：

```sql
CREATE UNIQUE INDEX "receivable_ledgers_contract_no_normalized_key" ON "receivable_ledgers"("contract_no_normalized");
CREATE UNIQUE INDEX "receivable_access_grants_one_active_account" ON "receivable_access_grants"("account_id") WHERE "active" = TRUE;
ALTER TABLE "receivable_invoices" ADD CONSTRAINT "receivable_invoice_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "receivable_receipts" ADD CONSTRAINT "receivable_receipt_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "receivable_ledgers" ADD CONSTRAINT "receivable_ledger_amounts_nonnegative" CHECK (("contract_amount" IS NULL OR "contract_amount" >= 0) AND ("final_amount" IS NULL OR "final_amount" >= 0) AND "writeoff_amount" >= 0);
```

`ReceivableLedger` 保存 `revision Int @default(1)`、`status`、作废字段、基础字段、`contractAmount`、`finalAmount`、`writeoffAmount` 和 `openingChargeDate`；不保存开票或到账汇总列。

- [ ] **Step 4: 添加幂等种子**

从 `E:\codex\legacy\Enterprise-Accounts-Receivable-Ledger\sql\init-new-instance.sql` 的部门及 `ar_dict` 种子提取值，用 `upsert` 写入独立财务表。种子不得创建财务账号、权限、台账或自动确认模块启用。

- [ ] **Step 5: 空库部署并验证**

Run: `$env:DATABASE_URL='<isolated-receivables_test-url>'; pnpm prisma:generate; pnpm db:deploy; pnpm db:bootstrap; pnpm check:receivables-schema`

Expected: migration 全部应用，种子重复执行两次无重复，输出 `RECEIVABLES_SCHEMA_OK`。

- [ ] **Step 6: 检查点提交**

```powershell
git add prisma/schema.prisma prisma/migrations/202609150012_receivables_core/migration.sql prisma/seed.ts apps/api/scripts/check-receivables-schema.mts apps/api/package.json package.json
git diff --cached --check
git commit -m "feat: add receivables persistence model"
```

### Task 3: 单一授权接口和首次绑定

**Files:**
- Create: `apps/api/src/receivables-access.ts`
- Create: `apps/api/scripts/check-receivables-access.mts`
- Create: `apps/api/scripts/smoke-receivables-access.mts`
- Create: `apps/api/src/routes/receivables.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `resolveReceivablesAccess(principal): Promise<ReceivablesAccess>`。
- Produces: `requireReceivables(access, action, departmentId?): void`。
- Produces: `GET /api/receivables/access`，返回 `state`、`role`、固定 capabilities、可读/可写部门 ID 和 `canRecover`。
- Produces: `PUT /api/receivables/setup/organization`，仅公司管理员可绑定 `department` 类型组织；换绑要求 `reason` 和 `confirm: true`。
- Produces: `POST /api/receivables/setup/confirm`，仅派生负责人可确认初始配置。

- [ ] **Step 1: 写纯授权矩阵红灯**

```ts
assert.equal(decideReceivablesAccess({ accountActive: true, personActive: true, isBoundOrgLeader: true, grant: null }).role, "owner");
assert.equal(decideReceivablesAccess({ accountActive: true, personActive: true, isCompanyAdmin: true, configured: true, grant: null }).canReadLedger, false);
assert.equal(decideReceivablesAccess({ accountActive: false, personActive: true, grant: { role: "admin" } }).canEnter, false);
```

- [ ] **Step 2: 运行红灯并实现接口**

Run: `pnpm check:receivables-access`

Expected: 先因模块缺失失败；实现后输出 `RECEIVABLES_ACCESS_OK`。

- [ ] **Step 3: 写隔离数据库 smoke**

创建公司管理员、财务资产部负责人、财务管理员、两个报账员和只读人员，断言：未配置时只有公司管理员 `canRecover`；配置后公司管理员仍不能读台账；负责人自动获得 owner；授权撤销后下一次请求 403；pending/disabled 账号 403。

- [ ] **Step 4: 运行 smoke**

Run: `$env:DATABASE_URL='<isolated-receivables_test-url>'; $env:RECEIVABLES_API_BASE_URL='http://127.0.0.1:55448'; pnpm smoke:receivables-access`

Expected: 输出 `RECEIVABLES_ACCESS_SMOKE=PASS`。

- [ ] **Step 5: 检查点提交**

```powershell
git add apps/api/src/receivables-access.ts apps/api/src/routes/receivables.ts apps/api/src/server.ts apps/api/scripts/check-receivables-access.mts apps/api/scripts/smoke-receivables-access.mts apps/api/package.json package.json
git diff --cached --check
git commit -m "feat: enforce receivables access boundary"
```

### Task 4: 财务授权、部门和字典管理

**Files:**
- Create: `apps/api/src/receivables-admin.ts`
- Modify: `apps/api/src/routes/receivables.ts`
- Create: `apps/api/scripts/smoke-receivables-admin.mts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `GET/POST/PATCH /api/receivables/grants`，负责人任命、撤销并配置多个部门读写范围、`canCreate`、`canExport`、`canViewAll`。
- Produces: `GET/POST/PATCH /api/receivables/departments`，负责人或财务管理员新增、排序、停用；不提供 DELETE。
- Produces: `GET/POST/PATCH /api/receivables/dictionary-options`，在用值改名表达为停用旧值和新建新值。
- Produces: `POST /api/receivables/departments/:id/migrate` 和 `POST /api/receivables/dictionary-options/:id/migrate`，仅负责人、要求影响预览 token、原因和二次确认。

- [ ] **Step 1: 写管理路径 smoke 红灯**

覆盖负责人可任命管理员、管理员不能任命负责人或授权、管理员可维护部门/字典、报账员全部拒绝、在用配置无 DELETE、迁移后历史审计含 before/after 和影响数量。

- [ ] **Step 2: 运行红灯**

Run: `pnpm smoke:receivables-admin`

Expected: FAIL，管理路由返回 404。

- [ ] **Step 3: 实现事务写入**

所有授权、撤销、换绑、部门/字典停用和批量迁移调用 `writeCriticalAudit(tx, event)`；角色授权主体只接受 active account + active person，负责人更换不修改已有财务管理员授权。

- [ ] **Step 4: 运行绿灯**

Run: `pnpm smoke:receivables-admin && pnpm typecheck`

Expected: 输出 `RECEIVABLES_ADMIN_SMOKE=PASS`。

- [ ] **Step 5: 检查点提交**

```powershell
git add apps/api/src/routes/receivables.ts apps/api/scripts/smoke-receivables-admin.mts apps/api/package.json package.json
git diff --cached --check
git commit -m "feat: add receivables administration"
```

### Task 5: 服务端列表、详情和看板

**Files:**
- Create: `apps/api/src/receivables-query.ts`
- Modify: `apps/api/src/routes/receivables.ts`
- Create: `apps/api/scripts/smoke-receivables-query.mts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `GET /api/receivables/ledgers?page&pageSize&sort&order&...filters`，最大 `pageSize=200`，返回 `{ rows, page, pageSize, total, facets, totals }`。
- Produces: `GET /api/receivables/ledgers/:id`，返回台账、有效及已作废明细、附件和当前 capabilities。
- Produces: `GET /api/receivables/dashboard`，返回当前可见范围的金额、状态和待核对聚合。

- [ ] **Step 1: 写查询 smoke 红灯**

插入两个财务归属部门、未决算、结清、超收和作废记录，分别以两个报账员、查看全部用户、管理员和公司管理员查询；断言总数、金额、facets 与列表使用同一过滤条件，公司管理员 403。

- [ ] **Step 2: 运行红灯**

Run: `pnpm smoke:receivables-query`

Expected: FAIL，列表路由返回 404。

- [ ] **Step 3: 实现单一查询构造器**

在路由内部使用一个 `buildReceivablesWhere(access, filters)` 结果同时驱动 rows、count、facets 和 totals；禁止先读全表再在 Node 过滤。允许排序字段使用固定白名单，金额聚合由 PostgreSQL Decimal 完成。

- [ ] **Step 4: 运行绿灯**

Run: `pnpm smoke:receivables-query && pnpm typecheck`

Expected: 输出 `RECEIVABLES_QUERY_SMOKE=PASS`。

- [ ] **Step 5: 检查点提交**

```powershell
git add apps/api/src/routes/receivables.ts apps/api/scripts/smoke-receivables-query.mts apps/api/package.json package.json
git diff --cached --check
git commit -m "feat: add scoped receivables queries"
```

### Task 6: 台账写入、版本冲突和作废

**Files:**
- Create: `apps/api/src/receivables-ledger.ts`
- Modify: `apps/api/src/routes/receivables.ts`
- Create: `apps/api/scripts/smoke-receivables-ledger.mts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `POST /api/receivables/ledgers`。
- Produces: `PATCH /api/receivables/ledgers/:id`，请求必须含 `revision` 和 `reason`。
- Produces: `POST /api/receivables/ledgers/:id/void`，不提供 DELETE。

- [ ] **Step 1: 写写入 smoke 红灯**

断言合同号空值 400、规范化重复 409、停用部门 409、无 `canCreate` 报账员 403、跨部门 403、报账员金额字段 403、旧 revision 409、作废后只读、非工作量结算自动带入决算金额、每次成功修改生成 revision 和关键审计。

- [ ] **Step 2: 运行红灯**

Run: `pnpm smoke:receivables-ledger`

Expected: FAIL，写路由返回 404。

- [ ] **Step 3: 实现最小写接口**

更新使用 `updateMany({ where: { id, revision, status: 'active' }, data: { ..., revision: { increment: 1 } } })`；count 为 0 时重新读取并区分不存在、作废或 `REVISION_CONFLICT`。事务先写 `ReceivableLedgerRevision.beforeSnapshot`，再更新，再写关键审计。

- [ ] **Step 4: 运行绿灯**

Run: `pnpm smoke:receivables-ledger && pnpm typecheck`

Expected: 输出 `RECEIVABLES_LEDGER_SMOKE=PASS`。

- [ ] **Step 5: 检查点提交**

```powershell
git add apps/api/src/routes/receivables.ts apps/api/scripts/smoke-receivables-ledger.mts apps/api/package.json package.json
git diff --cached --check
git commit -m "feat: add auditable receivables ledger writes"
```

### Task 7: 开票、回款、核销和待核对通知

**Files:**
- Create: `apps/api/src/receivables-money.ts`
- Modify: `apps/api/src/routes/receivables.ts`
- Create: `apps/api/scripts/smoke-receivables-money.mts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `POST/PATCH /api/receivables/ledgers/:id/invoices` 和 `POST .../invoices/:invoiceId/void`。
- Produces: `POST/PATCH /api/receivables/ledgers/:id/receipts` 和 `POST .../receipts/:receiptId/void`。
- Produces: `PATCH /api/receivables/ledgers/:id/writeoff`。
- Produces: 每收件人去重通知键 `receivables-anomaly:<ledgerId>:<anomaly>:<revision>:<recipientId>`。

- [ ] **Step 1: 写金额 smoke 红灯**

断言报账员不能写明细；负数和零金额 400；有效明细合计决定汇总；作废明细退出合计；最近有效开票日期决定挂账时间，且全部发票作废后按审计中最小有效父 revision 的因果顺序恢复首次开票前原手填/期初值；超收允许并通知负责人/管理员；超额调高核销 409；后续回款触发核销待调减；相同父 revision 的重复/并发请求只成功一次且不会重复事实或通知。

- [ ] **Step 2: 运行红灯**

Run: `pnpm smoke:receivables-money`

Expected: FAIL，明细路由返回 404。

- [ ] **Step 3: 实现金额事务**

明细和核销写入必须锁定或按 revision 条件更新父台账，在同一事务写审计和 `Notification`；响应始终返回由有效明细重新计算的金额字符串。

- [ ] **Step 4: 运行绿灯**

Run: `pnpm smoke:receivables-money && pnpm typecheck`

Expected: 输出 `RECEIVABLES_MONEY_SMOKE=PASS`。

- [ ] **Step 5: 检查点提交**

```powershell
git add apps/api/src/receivables-money.ts apps/api/src/routes/receivables.ts apps/api/scripts/smoke-receivables-money.mts apps/api/package.json package.json
git diff --cached --check
git commit -m "feat: add authoritative receivables money events"
```

### Task 8: 财务附件的专用上传和下载授权

**Files:**
- Create: `apps/api/src/receivables-files.ts`
- Modify: `apps/api/src/routes/receivables.ts`
- Modify: `apps/api/src/private-file-access.ts`
- Modify: `apps/api/src/private-file-policy.ts`
- Modify: `apps/api/src/private-file-retention.ts`
- Modify: `apps/api/src/routes/files.ts`
- Modify: `apps/api/scripts/check-private-file-policy.mts`
- Modify: `apps/api/scripts/smoke-private-file-access.mts`
- Create: `apps/api/scripts/smoke-receivables-attachments.mts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `POST /api/receivables/ledgers/:id/attachments`，专用 multipart 上传同时建立 `PrivateFile` 和 `ReceivableAttachment`。
- Produces: `POST /api/receivables/ledgers/:id/attachments/:attachmentId/void`。
- Consumes: 现有 `GET /api/files/:id`；`readablePrivateFile` 增加财务关联事实并调用当前财务授权。

- [ ] **Step 1: 扩展私有文件失败检查**

加入财务附件事实，断言同部门可读、跨部门拒绝、公司管理员默认拒绝、查看全部允许、附件作废后仅负责人/管理员可在历史详情读取。

- [ ] **Step 2: 运行红灯**

Run: `pnpm check:private-file-policy && pnpm smoke:receivables-attachments`

Expected: 新财务事实尚未实现而失败。

- [ ] **Step 3: 实现上传限制和失败清理**

只接受 PDF/PNG/JPG/WebP/XLSX，限制 10MB；XLSX 在 ExcelJS 解析前做 ZIP 条目数、展开大小和压缩比限额，且 multipart 解析前先做 ledger 轻量预授权。保存 mode 600 和 SHA-256；文件写入后若数据库事务失败，删除刚写入的孤儿文件。报账员只能作废本人上传的附件，负责人/管理员可作废任意附件。

- [ ] **Step 4: 运行完整文件验证**

Run: `pnpm check:private-file-policy && pnpm smoke:private-file-access && pnpm smoke:receivables-attachments`

Expected: 三项均 PASS，跨部门下载返回 403，成功下载生成 `file.read` 审计。

- [ ] **Step 5: 检查点提交**

```powershell
git add apps/api/src/receivables-files.ts apps/api/src/routes/receivables.ts apps/api/src/private-file-access.ts apps/api/src/private-file-policy.ts apps/api/src/private-file-retention.ts apps/api/src/routes/files.ts apps/api/scripts/check-private-file-policy.mts apps/api/scripts/smoke-private-file-access.mts apps/api/scripts/smoke-receivables-attachments.mts apps/api/package.json package.json
git diff --cached --check
git commit -m "feat: secure receivables attachments"
```

### Task 9: 服务端 Excel 导入和可冲突回滚

**Files:**
- Create: `apps/api/src/receivables-import.ts`
- Modify: `apps/api/src/routes/receivables.ts`
- Modify: `apps/api/src/private-file-access.ts`
- Modify: `apps/api/src/private-file-policy.ts`
- Modify: `apps/api/src/private-file-retention.ts`
- Modify: `apps/api/scripts/check-private-file-policy.mts`
- Create: `apps/api/scripts/check-receivables-import.mts`
- Create: `apps/api/scripts/smoke-receivables-import.mts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `previewReceivablesImport(actor, file, env): Promise<{ batchId; checksum; rows; errors }>`。
- Produces: `applyReceivablesImport(actor, batchId, decisions): Promise<ImportResult>`。
- Produces: `rollbackReceivablesImport(actor, batchId, reason): Promise<RollbackResult>`。
- Produces routes: `POST /api/receivables/imports/preview`、`POST /api/receivables/imports/:id/apply`、`POST /api/receivables/imports/:id/rollback`、`GET /api/receivables/imports`。

- [ ] **Step 1: 写解析红灯**

用内存生成的 XLSX 覆盖别名表头、金额四位小数、期初开票/回款明细、停用部门、缺少合同号、重复合同和同文件内部重复；不得依赖真实 Excel 或个人数据。

- [ ] **Step 2: 运行红灯**

Run: `pnpm check:receivables-import`

Expected: FAIL，导入模块不存在。

- [ ] **Step 3: 实现预览与应用**

预览保存原 XLSX 为私有文件和逐行规范化结果；apply 重新核对 checksum、当前权限、部门状态和目标 revision，并在一个事务应用所有行。重复行只接受 `skip | update`，更新字段不包含明细、附件或审计。

- [ ] **Step 4: 实现回滚冲突**

新建行回滚为作废；更新行按 `ReceivableLedgerRevision.beforeSnapshot` 恢复并新增更正 revision。任何目标在批次后再次变化时，整批返回 `IMPORT_ROLLBACK_CONFLICT` 且不写入。

- [ ] **Step 5: 运行绿灯**

Run: `pnpm check:receivables-import && pnpm smoke:receivables-import`

Expected: 输出 `RECEIVABLES_IMPORT_OK` 和 `RECEIVABLES_IMPORT_SMOKE=PASS`，失败批次写入 0 个业务事实。

- [ ] **Step 6: 检查点提交**

```powershell
git add apps/api/src/receivables-import.ts apps/api/src/routes/receivables.ts apps/api/src/private-file-access.ts apps/api/src/private-file-policy.ts apps/api/src/private-file-retention.ts apps/api/scripts/check-private-file-policy.mts apps/api/scripts/check-receivables-import.mts apps/api/scripts/smoke-receivables-import.mts apps/api/package.json package.json
git diff --cached --check
git commit -m "feat: add atomic receivables import"
```

### Task 10: 后台 XLSX 导出和一次性下载

**Files:**
- Create: `apps/api/src/receivables-export.ts`
- Modify: `apps/api/src/receivables-query.ts`
- Modify: `apps/api/src/routes/receivables.ts`
- Modify: `apps/api/src/server.ts`
- Create: `apps/api/scripts/smoke-receivables-export.mts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `createReceivablesExportJob`、`processReceivablesExportJob`、`issueReceivablesExportToken`、`consumeReceivablesExport`、`cleanupExpiredReceivablesExports`。
- Produces routes: `POST/GET /api/receivables/exports`、`POST /api/receivables/exports/:id/token`、`POST /api/receivables/exports/:id/download`（token 放请求体，避免 URL 泄漏）。

- [ ] **Step 1: 写导出 smoke 红灯**

断言无 `canExport` 用户 403、报账员只能导出授权部门、负责人/管理员全量、任务保存范围和筛选快照、XLSX 行数/金额正确、一次性 token 第二次使用 409、过期产物清理且全流程审计。

- [ ] **Step 2: 运行红灯**

Run: `pnpm smoke:receivables-export`

Expected: FAIL，导出路由返回 404。

- [ ] **Step 3: 复用现有模式实现专用模块**

沿用 `sensitive-export.ts` 的 claim、临时文件 rename、SHA-256、短时 token 和清理模式，但不抽取通用任务框架。使用 ExcelJS 流式 workbook 写入 `UPLOAD_ROOT/.receivables-exports`。

- [ ] **Step 4: 运行绿灯**

Run: `pnpm smoke:receivables-export && pnpm typecheck`

Expected: 输出 `RECEIVABLES_EXPORT_SMOKE=PASS`。

- [ ] **Step 5: 检查点提交**

```powershell
git add apps/api/src/receivables-export.ts apps/api/src/receivables-query.ts apps/api/src/routes/receivables.ts apps/api/src/server.ts apps/api/scripts/smoke-receivables-export.mts apps/api/package.json package.json
git diff --cached --check
git commit -m "feat: add scoped receivables exports"
```

### Task 11: 九宫格、模块外壳、看板和宽表

**Files:**
- Create: `apps/admin/src/receivables-types.ts`
- Create: `apps/admin/src/ReceivablesPage.tsx`
- Create: `apps/admin/src/ReceivablesLedger.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: `/api/receivables/access`、`/api/receivables/dashboard`、`/api/receivables/ledgers`、`/api/receivables/ledgers/:id`。
- Produces: `/receivables`、`/receivables/ledger` 路由和按服务端能力生成的财务侧栏。

- [ ] **Step 1: 接入入口能力**

`PlatformPortal` 查询 `/api/receivables/access`：`canEnter=true` 时用应收账款卡片替换第九格；仅未配置且 `canRecover=true` 时显示“待配置”；其他用户不渲染该卡片。不得从 `principal.roles` 推导财务权限。

- [ ] **Step 2: 实现模块外壳和看板**

标题固定为“应收账款管理”；看板卡片和图表只渲染服务端聚合。筛选变化使用稳定 query key，不在浏览器重新汇总全量记录。

- [ ] **Step 3: 实现宽表**

Ant Design Table 使用服务端分页、排序和筛选；保留固定字段、列显示顺序、冻结列和未结默认筛选。列偏好保存到现有 `UserPreference`，key 固定为 `receivables.columns.v1`。

- [ ] **Step 4: 构建验证**

Run: `pnpm --filter @safety/admin typecheck && pnpm --filter @safety/admin build`

Expected: 两条命令退出码 0；未知财务子路由回到 `/receivables` 而不是培训模块。

- [ ] **Step 5: 检查点提交**

```powershell
git add apps/admin/src/receivables-types.ts apps/admin/src/ReceivablesPage.tsx apps/admin/src/ReceivablesLedger.tsx apps/admin/src/App.tsx apps/admin/src/styles.css
git diff --cached --check
git commit -m "feat: add receivables portal and ledger UI"
```

### Task 12: 编辑详情、授权配置、导入导出界面

**Files:**
- Modify: `apps/admin/src/ReceivablesLedger.tsx`
- Create: `apps/admin/src/ReceivablesAdmin.tsx`
- Create: `apps/admin/src/ReceivablesTransfers.tsx`
- Modify: `apps/admin/src/ReceivablesPage.tsx`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: Tasks 4、6、7、8、9、10 的固定路由和服务端 capabilities。

- [ ] **Step 1: 实现详情编辑**

表单按基础、状态与金额、债权与催收、开票、回款、附件分区；按钮完全按响应 capabilities 展示。409 revision 冲突时保留用户输入，同时展示服务端最新值并要求重新确认。

- [ ] **Step 2: 实现财务管理页**

负责人看到授权管理；负责人和管理员看到财务归属部门及字典；公司管理员恢复入口放在现有组织管理页面，仅允许首次绑定或换绑，不展示财务数据。

- [ ] **Step 3: 实现导入导出页**

导入必须经过文件上传、阻断错误、逐行重复决策、影响预览、确认应用五个状态；批次回滚要求原因和二次确认。导出显示任务状态并通过一次性 token 下载。

- [ ] **Step 4: 前端构建**

Run: `pnpm --filter @safety/admin typecheck && pnpm --filter @safety/admin build`

Expected: 退出码 0，无 Supabase 字符串或 SDK import。

- [ ] **Step 5: 检查点提交**

```powershell
git add apps/admin/src/ReceivablesLedger.tsx apps/admin/src/ReceivablesAdmin.tsx apps/admin/src/ReceivablesTransfers.tsx apps/admin/src/ReceivablesPage.tsx apps/admin/src/App.tsx apps/admin/src/styles.css
git diff --cached --check
git commit -m "feat: complete receivables workflows"
```

### Task 13: 容量、全链路验收和切换交接

**实际状态（2026-09-16）：** `PARTIAL`。有序 FINAL 前 11 个门通过，第 12 个 `smoke:receivables-money` 因测试 wrapper 删除 `receivable_settings` baseline 行而首次失败并停止；恢复 `1|||` 后只从失败点续跑并通过 money、attachments、import、export、默认正式规模 capacity 和 E2E。因此不能记录为完整套件无中断一次通过。capacity 实际为 50,000 台账/500,000 明细、四个目标索引命中、导出 50,000 行且零残留；E2E 为 7 会话/5 台账/5 导出行/22 类审计且零残留。真实浏览器角色边界与 390×844 无页面级横向溢出通过；Windows 附件 mode 为 `NOT_PROVABLE`，运行环境 Node.js 24/PostgreSQL 17 与目标 22/16 不同，故整体仍为 `PARTIAL`。

**Files:**
- Create: `apps/api/scripts/check-receivables-capacity.mts`
- Create: `apps/api/scripts/smoke-receivables-e2e.mts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-09-15-receivables-native-integration.md`
- Create: `docs/receivables/CUTOVER.md`

**Interfaces:**
- Consumes: 所有前述模块接口。
- Produces: 可重复执行且拒绝非隔离数据库的容量和角色矩阵验证。

- [ ] **Step 1: 写容量检查**

脚本只接受数据库名包含 `receivables_capacity_test`，批量生成五万合同和五十万条明细，断言分页无重复/遗漏、关键查询使用预期索引、看板总额与 SQL 基准一致、导出行数完整且无 5000 条截断。

- [ ] **Step 2: 写角色矩阵 E2E**

使用负责人、管理员、两个部门报账员、只读、查看全部和公司管理员七个独立会话，覆盖入口、跨部门、字段、附件、撤权、导入、导出、作废、审计和乐观锁允许/拒绝路径。

- [ ] **Step 3: 运行自动化 FINAL**

Run:

```powershell
pnpm db:validate
pnpm typecheck
pnpm build
pnpm check:miniprogram
pnpm check:receivables-core
pnpm check:receivables-access
pnpm check:receivables-import
pnpm smoke:receivables-access
pnpm smoke:receivables-admin
pnpm smoke:receivables-query
pnpm smoke:receivables-ledger
pnpm smoke:receivables-money
pnpm smoke:receivables-attachments
pnpm smoke:receivables-import
pnpm smoke:receivables-export
pnpm check:receivables-capacity
pnpm smoke:receivables-e2e
```

Expected: 所有命令退出码 0；首次失败立即定位并停止，不重复整套运行掩盖首个失败。

- [ ] **Step 4: 浏览器人工验收**

逐角色验证九宫格、待配置、财务侧栏、宽表、冻结列、筛选、看板、编辑冲突、导入预览、导出下载和附件拒绝；记录桌面及窄屏截图。浏览器验收未完成时状态只能写 `PARTIAL`。

- [ ] **Step 5: 编写切换步骤**

`CUTOVER.md` 固定包含：备份 PostgreSQL 和 uploads、空库 migration、种子、财务资产部绑定、负责人确认配置、角色矩阵 smoke、启用 `/receivables`、将旧 `/ledger/` 重定向、新版本健康检查和反向回退步骤。不得包含真实密码、token 或个人数据。

- [ ] **Step 6: 安全扫描**

Run: `rg -n "supabase|sb_publishable_|bttnxyexkbsskmqttbzi" apps prisma package.json docker-compose*.yml`

Expected: 新运行路径无匹配；文档中的历史说明可以保留并单独审阅。

- [ ] **Step 7: 最终检查点提交**

```powershell
git add apps/api/scripts/check-receivables-capacity.mts apps/api/scripts/smoke-receivables-e2e.mts apps/api/package.json package.json docs/superpowers/specs/2026-09-15-receivables-native-integration.md docs/receivables/CUTOVER.md
git diff --cached --check
git commit -m "test: close receivables migration gates"
```

## Execution Order and Stop Conditions

1. Tasks 1–4 建立数据库、规则和授权地基，未通过不得做页面。
2. Tasks 5–8 完成日常查询、写入、金额和附件闭环。
3. Tasks 9–10 完成批量迁移能力，不允许前端绕过服务端解析或范围检查。
4. Tasks 11–12 才替换第九格并开放 UI；此时服务端拒绝路径必须已验证。
5. Task 13 只在功能闭环后运行一次完整 FINAL。
6. 任一 migration 冲突、非隔离数据库、权限拒绝不符合预期、审计无法同事务或文件路径越界时立即停止，不尝试自动修复生产数据。
