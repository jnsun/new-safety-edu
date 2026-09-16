# Receivables Usability, Export, and Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成应收账款模块的数据处理入口、催收字段与授权、字典同步改名、可配置单表导出和台账易用性改造。

**Architecture:** 继续扩展现有应收账款 Prisma 模型、服务端权限解析、共享查询构造器和 React 页面；不新增通用权限框架、报表引擎或前端依赖。所有写权限和导出范围由服务端判定，前端只呈现 capability。

**Tech Stack:** Node.js 22、TypeScript、Fastify、Prisma、PostgreSQL 16、React 19、Ant Design 5、TanStack Query、ExcelJS、pnpm。

**Spec:** `docs/superpowers/specs/2026-09-16-receivables-usability-export-and-collection-design.md`

## Global Constraints

- 在 `codex/receivables-usability-export` 隔离分支/工作树中实施，不直接在 `main` 开发。
- 数据库迁移只增加五个可空台账字段和 `can_maintain_collection BOOLEAN NOT NULL DEFAULT false`，不删除或回填业务数据。
- 不新增 npm 依赖；复用 Prisma、ExcelJS、Ant Design 和现有脚本式测试。
- 报账员新开关只控制项目状态、五个催收字段和附件上传；债权状态、清收责任人、催收备注保持当前规则。
- 导出始终是一个 XLSX、一个“应收账款明细”工作表和连续明细行。
- 所有范围、字段白名单、字典改名和导出条件由服务端验证；前端隐藏不是授权证据。
- 每个任务先制造可观察的 RED，再做最小实现、运行 GREEN、逐文件暂存并提交。
- 正式 FINAL 只在功能完成后于 Node.js 22 + PostgreSQL 16 干净环境连续执行；首次失败立即停止。

## File Map

- `prisma/schema.prisma`、`prisma/migrations/202609160001_receivables_collection_tracking/migration.sql`：新增字段和授权开关。
- `apps/api/src/receivables-{core,access,ledger,files,query,import,admin,export}.ts`：权限、字段、字典改名和导出核心。
- `apps/api/src/routes/receivables.ts`：严格请求 schema 和新导出预览/字典改名路由。
- `apps/api/scripts/check-receivables-*.mts`、`apps/api/scripts/smoke-receivables-*.mts`：脚本式单元/数据库/HTTP 回归。
- `apps/admin/src/receivables-types.ts`：共享前端契约、路由、偏好归一化。
- `apps/admin/src/ReceivablesPage.tsx`、`ReceivablesTransfers.tsx`、`ReceivablesLedger.tsx`、`ReceivablesAdmin.tsx`：数据处理、台账和管理界面；直接扩展现有组件，不再增加中间组件层。
- `apps/admin/src/styles.css`、`apps/admin/src/App.tsx`：紧凑表格、长文本、拖动列宽和模块侧栏。

---

### Task 1: 数据模型、催收授权和五个恢复字段

**Files:**
- Create: `prisma/migrations/202609160001_receivables_collection_tracking/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `apps/api/src/receivables-core.ts`
- Modify: `apps/api/src/receivables-access.ts`
- Modify: `apps/api/src/receivables-ledger.ts`
- Modify: `apps/api/src/receivables-files.ts`
- Modify: `apps/api/src/receivables-query.ts`
- Modify: `apps/api/src/receivables-import.ts`
- Modify: `apps/api/src/receivables-admin.ts`
- Modify: `apps/api/src/routes/receivables.ts`
- Test: `apps/api/scripts/check-receivables-schema.mts`
- Test: `apps/api/scripts/check-receivables-access.mts`
- Test: `apps/api/scripts/check-receivables-core.mts`
- Test: `apps/api/scripts/check-receivables-import.mts`
- Test: `apps/api/scripts/smoke-receivables-ledger.mts`
- Test: `apps/api/scripts/smoke-receivables-attachments.mts`
- Test: `apps/api/scripts/smoke-receivables-admin.mts`

**Interfaces:**
- Produces `ReceivablesAccess.canMaintainCollection: boolean`。
- Produces ledger fields `dunningDate`, `communicationMethod`, `counterpartyFeedback`, `latestProgress`, `nextPlan`。
- Produces grant field `canMaintainCollection` and service-side collection field policy。

- [ ] **Step 1: Write failing schema/access/core/import assertions**

Add assertions equivalent to:

```ts
assert.equal(reporterWithoutFlag.canMaintainCollection, false);
assert.equal(reporterWithFlag.canMaintainCollection, true);
assert.throws(
  () => assertLedgerPatchAllowed({ canManageAll: false, canCreateLedger: false, canMaintainCollection: false }, { id: "1" }, { latestProgress: "已对账" }),
  /REPORTER_FIELD_NOT_ALLOWED/,
);
assert.doesNotThrow(() => assertLedgerPatchAllowed(
  { canManageAll: false, canCreateLedger: false, canMaintainCollection: true },
  { id: "1" },
  { projectStatus: "完工", dunningDate: "2026-09-16", latestProgress: "已对账" },
));
```

Extend the schema check to assert the five nullable ledger columns and the non-null/default-false grant column. Extend import checks with the old Chinese aliases and four dictionary categories.

- [ ] **Step 2: Run the focused checks and verify RED**

Run:

```powershell
pnpm check:receivables-core
pnpm check:receivables-access
pnpm check:receivables-import
```

Expected: missing property/field assertions fail before implementation.

- [ ] **Step 3: Add the additive migration and Prisma fields**

Use this migration shape:

```sql
ALTER TABLE "receivable_access_grants"
  ADD COLUMN "can_maintain_collection" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "receivable_ledgers"
  ADD COLUMN "dunning_date" DATE,
  ADD COLUMN "comm_method" VARCHAR(120),
  ADD COLUMN "feedback" VARCHAR(240),
  ADD COLUMN "latest_progress" VARCHAR(240),
  ADD COLUMN "next_plan" VARCHAR(240);
```

Map them in Prisma with `canMaintainCollection`, `dunningDate`, `communicationMethod`, `counterpartyFeedback`, `latestProgress`, and `nextPlan`.

- [ ] **Step 4: Extend access and grant policy**

Add `canMaintainCollection` to grant facts, selects, access responses, create/update bodies and audit snapshots. Owner/admin resolve to `true`; reporter resolves from the stored flag; readonly resolves to `false`. Reject `canMaintainCollection=true` for admin and readonly grants.

- [ ] **Step 5: Extend ledger, query, import and attachment paths**

Add all five fields to strict route schemas, ledger normalization/select/snapshot, raw query rows, detail/list mapping, import aliases/limits/date fields/dictionaries and import persistence. Keep `dunningDate` as `YYYY-MM-DD` at the HTTP boundary.

Change the field policy to:

```ts
export const reporterPatchFields = ["debtStatus", "collectionOwner", "collectionNotes"] as const;
export const reporterCollectionFields = [
  "projectStatus", "dunningDate", "communicationMethod",
  "counterpartyFeedback", "latestProgress", "nextPlan",
] as const;
```

For reporter PATCH, accept `reporterCollectionFields` only when `canMaintainCollection` is true. Require the same flag plus department write scope for reporter attachment upload; owner/admin behavior is unchanged.

- [ ] **Step 6: Prove history, department isolation and attachment gating through HTTP smoke**

Add fixtures for a reporter with two departments, enabling collection maintenance for only the account (not a department shortcut). Assert: writable department succeeds; read-only department fails; flag off fails; active flag succeeds; stale revision returns 409; each successful edit creates a before snapshot; attachment upload follows the same gate.

- [ ] **Step 7: Run GREEN and commit**

```powershell
pnpm prisma:generate
pnpm db:validate
pnpm check:receivables-core
pnpm check:receivables-access
pnpm check:receivables-import
pnpm smoke:receivables-ledger
pnpm smoke:receivables-attachments
pnpm smoke:receivables-admin
git add prisma/schema.prisma prisma/migrations/202609160001_receivables_collection_tracking/migration.sql apps/api/src/receivables-core.ts apps/api/src/receivables-access.ts apps/api/src/receivables-ledger.ts apps/api/src/receivables-files.ts apps/api/src/receivables-query.ts apps/api/src/receivables-import.ts apps/api/src/receivables-admin.ts apps/api/src/routes/receivables.ts apps/api/scripts/check-receivables-schema.mts apps/api/scripts/check-receivables-access.mts apps/api/scripts/check-receivables-core.mts apps/api/scripts/check-receivables-import.mts apps/api/scripts/smoke-receivables-ledger.mts apps/api/scripts/smoke-receivables-attachments.mts apps/api/scripts/smoke-receivables-admin.mts
git diff --cached --check
git commit -m "feat: restore receivables collection tracking"
```

---

### Task 2: 字典改名事务性同步

**Files:**
- Modify: `apps/api/src/receivables-admin.ts`
- Modify: `apps/api/src/routes/receivables.ts`
- Modify: `apps/api/scripts/smoke-receivables-admin.mts`
- Modify: `apps/admin/src/ReceivablesAdmin.tsx`
- Modify: `apps/admin/src/receivables-types.ts`

**Interfaces:**
- Produces `POST /api/receivables/dictionary-options/:id/rename` with `mode: "preview" | "apply"`。
- Preview returns `{ impactCount, token, expiresAt }`; apply requires `{ token, reason, confirm: true }`。

- [ ] **Step 1: Add failing admin smoke cases**

Create an in-use option for each of `project_status`, `comm_method`, `feedback`, `progress_note`, and `next_plan`. Assert preview count, apply result, changed ledger value, incremented ledger revision, one revision row per ledger, option revision increment and critical audit. Inject a stale ledger revision/fingerprint and assert 409 with zero partial writes.

- [ ] **Step 2: Run smoke and verify RED**

```powershell
pnpm smoke:receivables-admin
```

Expected: rename route is 404 or existing update rejects an in-use rename.

- [ ] **Step 3: Implement preview/apply using existing migration signing primitives**

Extend the dictionary-to-ledger map with:

```ts
comm_method: ledgerDictionaryMigration("communicationMethod"),
feedback: ledgerDictionaryMigration("counterpartyFeedback"),
progress_note: ledgerDictionaryMigration("latestProgress"),
next_plan: ledgerDictionaryMigration("nextPlan"),
```

Preview signs source option ID/revision, trimmed next value, affected IDs/revisions fingerprint and expiry. Apply locks the option and affected rows, rechecks the fingerprint, inserts a full before snapshot for every ledger, updates values/revisions/`updatedBy`, updates the option, and writes one audit in the same transaction. A conflicting target value returns 409. `attach_category` updates attachment revisions/audit but does not create fake ledger field history.

- [ ] **Step 4: Connect the option editor and invalidate all receivables scope queries**

When an edited value differs, request preview first and show impact/reason/confirmation. On success close/reset the modal and invalidate admin, reference-data, ledger, dashboard and export queries. Sort-only edits continue using the ordinary PATCH.

- [ ] **Step 5: Run GREEN and commit**

```powershell
pnpm smoke:receivables-admin
pnpm typecheck
git add apps/api/src/receivables-admin.ts apps/api/src/routes/receivables.ts apps/api/scripts/smoke-receivables-admin.mts apps/admin/src/ReceivablesAdmin.tsx apps/admin/src/receivables-types.ts
git diff --cached --check
git commit -m "feat: cascade receivables dictionary renames"
```

---

### Task 3: 分类预览和单工作表导出

**Files:**
- Modify: `apps/api/src/receivables-query.ts`
- Modify: `apps/api/src/receivables-export.ts`
- Modify: `apps/api/src/routes/receivables.ts`
- Modify: `apps/api/scripts/smoke-receivables-query.mts`
- Modify: `apps/api/scripts/smoke-receivables-export.mts`
- Modify: `apps/api/scripts/check-receivables-capacity.mts`

**Interfaces:**
- Produces `POST /api/receivables/exports/preview`。
- Consumes/produces `categoryFilters: Partial<Record<ReceivablesExportCategoryId, string[]>>` and `columns: ReceivablesExportColumnId[]`。

- [ ] **Step 1: Add failing query/export cases**

Cover category OR within one field, AND across fields, permission-scoped option unions, non-empty counts, zero-match rejection, invalid field rejection and a workbook assertion:

```ts
assert.equal(workbook.worksheets.length, 1);
assert.equal(workbook.worksheets[0]!.name, "应收账款明细");
assert.ok(workbook.worksheets[0]!.autoFilter);
assert.deepEqual(headerValues, selectedHeaders);
```

- [ ] **Step 2: Run focused smoke and verify RED**

```powershell
pnpm smoke:receivables-query
pnpm smoke:receivables-export
```

- [ ] **Step 3: Add fixed category and column allowlists beside the shared query builder**

Allow category filters only for finance department, unit, customer type, work nature, sector, project status, settlement method, debt status, communication method, feedback, latest progress, next plan and record status. Build all SQL fragments from a constant map; never interpolate client field names.

Preview returns `{ rowCount, categoryOptions, columns: [{ id, label, nonEmptyCount }] }`. Category options are the deduplicated union of permission-visible actual values and active dictionary values.

- [ ] **Step 4: Snapshot columns and conditions in the existing export job JSON**

Keep the current database table. Store `{ filters, categoryFilters, columns }` in `filterSnapshot`, revalidate it when claiming and completing the job, and include it in request/complete audit metadata. Reject zero matches and zero columns before creating a job.

- [ ] **Step 5: Generate only selected columns in one worksheet**

Replace the fixed workbook column loop with the ordered allowlisted selection, set the sheet name to `应收账款明细`, freeze row 1, set an auto-filter covering the selected header range, and preserve streaming batches and SHA-256 verification.

- [ ] **Step 6: Run GREEN, capacity regression and commit**

```powershell
pnpm smoke:receivables-query
pnpm smoke:receivables-export
pnpm check:receivables-capacity -- --dev
git add apps/api/src/receivables-query.ts apps/api/src/receivables-export.ts apps/api/src/routes/receivables.ts apps/api/scripts/smoke-receivables-query.mts apps/api/scripts/smoke-receivables-export.mts apps/api/scripts/check-receivables-capacity.mts
git diff --cached --check
git commit -m "feat: add scoped receivables export builder"
```

---

### Task 4: 数据处理页面、台账易用性和弹窗修复

**Files:**
- Modify: `apps/admin/src/ReceivablesPage.tsx`
- Modify: `apps/admin/src/ReceivablesTransfers.tsx`
- Modify: `apps/admin/src/ReceivablesLedger.tsx`
- Modify: `apps/admin/src/ReceivablesAdmin.tsx`
- Modify: `apps/admin/src/receivables-types.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/styles.css`
- Test: `apps/api/scripts/check-receivables-core.mts`

**Interfaces:**
- Produces canonical route `/receivables/data?tab=create|import|export`。
- Produces column preference `{ order, visible, frozen, widths }` with backward-compatible normalization。

- [ ] **Step 1: Add minimal pure-helper assertions and verify RED**

Extend the existing core check with pure helper assertions from `receivables-types.ts`:

```ts
assert.equal(resolveReceivablesRoute("/receivables/data"), "data");
assert.equal(receivablesNavigation(createOnlyAccess).some((item) => item.path === "/receivables/data"), true);
assert.equal(normalizeReceivablesColumnPreference(oldV1).widths.projectName, defaultWidths.projectName);
assert.equal(normalizeReceivablesColumnPreference({ ...v2, widths: { projectName: 99999 } }).widths.projectName, maxWidths.projectName);
```

Run `pnpm check:receivables-core` and confirm it fails on the missing route/width contract. Do not add a test framework or a new script.

- [ ] **Step 2: Build the single “数据处理” route and capability-gated tabs**

Show tabs only when their capability is true: create=`canCreateLedger`, import=`canImport`, export=`canExport`. Redirect `/receivables/imports` and `/receivables/exports` to the matching query tab. A forbidden tab renders 403 even if typed directly.

Move the create form from the ledger page into the existing `ReceivablesTransfers.tsx` data-processing view; keep edit in `ReceivablesLedger.tsx`. After create, navigate to `/receivables/ledger?ledgerId=<id>`. Let the ledger page read that ID and open the detail drawer. Remove the ledger header’s duplicate new-record button.

- [ ] **Step 3: Wire restored fields and the grant checkbox**

Add the five fields to frontend row/detail/import types, forms, details and selectable columns. Show “允许维护催收进展” only for reporter grants and include `canMaintainCollection` in normalized grant requests and scope fingerprints.

- [ ] **Step 4: Build the export form against the preview contract**

Render multi-select classification conditions, matched row count and column checkboxes. Default-check `nonEmptyCount > 0`; allow manual changes; disable submit when `rowCount === 0` or no columns. Submit exactly the previewed filters/categories/columns and reset the idempotency key when any of them changes.

- [ ] **Step 5: Add unit filter, resizable widths and compact long text**

Expose the already-supported `creditorUnit` list filter using actual facet values plus active unit options. Extend column IDs with the restored fields. Use native pointer events on a small header resize handle; clamp widths to per-column min/max and save on pointer-up through the existing preference endpoint.

Apply two-line ellipsis plus `title` text for project/customer names, single-line ellipsis for other text, `size="small"`, and retain horizontal scroll. Set `Layout.Sider width={inReceivables ? 196 : 228}`.

- [ ] **Step 6: Diagnose and fix all receivables Modal/Drawer close paths**

Before editing, reproduce right-close, Cancel, mask and Esc for ledger, import rollback, dictionary, grant, deactivate and migration dialogs. Record the common cause in the task notes. Replace ad-hoc setters with local close functions that reset the visible flag/object, form errors, conflict flags, uploads and temporary previews appropriate to that dialog. Add explicit `htmlType="button"` Cancel buttons to footerless forms so cancel never submits.

Do not clear a valid multi-step import preview when merely closing its rollback dialog.

- [ ] **Step 7: Run checks/build and commit**

```powershell
pnpm check:receivables-core
pnpm typecheck
pnpm --filter @safety/admin build
git add apps/admin/src/ReceivablesPage.tsx apps/admin/src/ReceivablesTransfers.tsx apps/admin/src/ReceivablesLedger.tsx apps/admin/src/ReceivablesAdmin.tsx apps/admin/src/receivables-types.ts apps/admin/src/App.tsx apps/admin/src/styles.css apps/api/scripts/check-receivables-core.mts
git diff --cached --check
git commit -m "feat: streamline receivables data workflows"
```

---

### Task 5: 集成验收和正式发布门

**Files:**
- Modify after evidence exists: `docs/superpowers/specs/2026-09-16-receivables-usability-export-and-collection-design.md`

- [ ] **Step 1: Run all focused receivables checks on the feature branch**

```powershell
pnpm db:validate
pnpm check:receivables-core
pnpm check:receivables-schema
pnpm check:receivables-access
pnpm check:receivables-import
pnpm smoke:receivables-access
pnpm smoke:receivables-admin
pnpm smoke:receivables-query
pnpm smoke:receivables-ledger
pnpm smoke:receivables-attachments
pnpm smoke:receivables-import
pnpm smoke:receivables-export
pnpm smoke:receivables-e2e
pnpm typecheck
pnpm build
```

Expected: every command exits 0; any first failure stops this sequence and is reported as `PARTIAL`.

- [ ] **Step 2: Browser acceptance**

Verify desktop and narrow viewport for: capability-hidden tabs/direct URL denial, create-to-detail, unit filter, column resize persistence, two-line project/customer text, export defaults/one sheet, grant toggle, dictionary rename refresh, and every Modal/Drawer close path. Confirm other modules retain 228px sidebar.

- [ ] **Step 3: Run one clean continuous target-runtime FINAL**

On Node.js 22 + PostgreSQL 16, create fresh isolated databases, deploy every migration, seed twice, then run the repository’s established ordered FINAL including the full 50,000-ledger/500,000-detail capacity check and zero-residual assertions. Stop on the first failure; do not label a targeted continuation as a complete FINAL.

- [ ] **Step 4: Record evidence only after a genuine PASS**

Append runtime versions, commit SHA, database freshness, ordered command results, capacity figures, browser acceptance and residual counts to the spec. If FINAL is not clean, record `PARTIAL` and the single blocker instead.

- [ ] **Step 5: Commit evidence and hand off**

```powershell
git add docs/superpowers/specs/2026-09-16-receivables-usability-export-and-collection-design.md
git diff --cached --check
git commit -m "docs: record receivables usability acceptance"
git status --short
```

Do not push, merge or deploy until the user explicitly approves those actions after reviewing the evidence.
