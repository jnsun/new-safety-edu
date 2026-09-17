# Receivables Import and Admin Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the supplied legacy receivables workbook importable without losing financial facts, and replace three flat administration surfaces with compact task-oriented views.

**Architecture:** Keep server-side authorization and accounting rules authoritative. Extend only the import normalization boundary for legacy headers and batch-level opening-balance date, while keeping derived receivable columns server-calculated. Build UI grouping and department-scope selection from small pure helpers so behavior is covered without adding a new test framework.

**Tech Stack:** React 19, Ant Design 5, Fastify, ExcelJS, TypeScript, Prisma/PostgreSQL.

**Spec:** `docs/receivables/CONTEXT.md` plus the user-approved 2026-09-17 change brief in this task.

## Global Constraints

- Preserve unified accounts, server-authoritative permissions, private files, audit, revision conflicts, and independent finance departments.
- Never import `账内应收`, `账外应收`, or `应收合计`; they remain calculated results.
- `查看全部部门` remains a separate server capability and cannot be inferred from selected departments.
- Keep the implementation minimal and dependency-free.

---

### Task 1: Legacy workbook normalization

**Files:**
- Modify: `apps/api/scripts/check-receivables-import.mts`
- Modify: `apps/api/src/receivables-import.ts`
- Modify: `apps/api/src/routes/receivables.ts`
- Modify: `apps/admin/src/ReceivablesTransfers.tsx`
- Modify: `apps/admin/src/receivables-types.ts`

**Interfaces:**
- Consumes: XLSX upload plus optional `openingBalanceDate` multipart field.
- Produces: normalized legacy headers, ignored derived columns, grouped diagnostics, and explicit batch opening-balance dates.

- [ ] Add failing parser checks for `项目进度`, `债务单位`, `已开发票`, `已到账收入`, derived columns, trimmed contract numbers, cached formulas, and missing batch date.
- [ ] Run `pnpm check:receivables-import` and confirm the new assertions fail for missing compatibility behavior.
- [ ] Add the smallest alias/ignored-column/date normalization implementation and multipart field handling.
- [ ] Run `pnpm check:receivables-import` until all assertions pass.

### Task 2: Compact administration models

**Files:**
- Create: `apps/admin/scripts/check-receivables-admin-ui.mts`
- Modify: `apps/admin/package.json`
- Modify: `package.json`
- Modify: `apps/admin/src/receivables-types.ts`

**Interfaces:**
- Produces: Chinese dictionary category labels, grouped category summaries, department filters, and selected-only grant scopes.

- [ ] Add failing pure-behavior checks for category grouping, active/inactive filtering, search, and selected department scopes.
- [ ] Run the new check and confirm the assertions fail because helpers do not exist.
- [ ] Implement the pure helpers with literal labels and stable sorting.
- [ ] Run the new check until it passes.

### Task 3: Task-oriented management screens

**Files:**
- Modify: `apps/admin/src/ReceivablesAdmin.tsx`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: Task 2 helpers and existing admin APIs.
- Produces: category navigation with one option list, searchable department table, and searchable selected-only permission scope editor.

- [ ] Replace flat dictionary rows with category navigation and one selected-category table.
- [ ] Add compact department search/status filters and clear empty states.
- [ ] Replace all-department grant rows with a searchable multi-select and permissions only for chosen departments.
- [ ] Keep modal cancel/close handlers explicit and preserve draft reset behavior.

### Task 4: Verification and UI audit

**Files:**
- Verify all modified targets.

- [ ] Run targeted API and admin behavior checks.
- [ ] Run API/admin typechecks and admin build.
- [ ] Run Impeccable detect exactly once on the final changed UI targets and resolve relevant findings.
- [ ] Inspect the final diff, whitespace check, and branch status without staging unrelated files.
