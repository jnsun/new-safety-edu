# Receivables Compact Departments and Personal Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the paginated finance-department table with a dense single-page manager and add per-account configurable receivables dashboard cards.

**Architecture:** Reuse the existing `UserPreference` table and receivables preference authorization boundary. Keep the card catalog fixed in code, persist only validated presentation metadata, and use native CSS Grid plus pointer/drag events instead of adding a UI dependency.

**Tech Stack:** React 19, Ant Design 5, TanStack Query, Fastify, Zod, Prisma/PostgreSQL, CSS Grid, Pointer Events.

**Spec:** `docs/superpowers/specs/2026-09-17-receivables-compact-departments-and-personal-dashboard.md`

## Global Constraints

- Preferences are account-specific and require current receivables entry permission.
- Dashboard cards may only use the existing authoritative dashboard response.
- Department management keeps existing revision, audit, deactivate, and migration flows.
- Preserve the uncommitted search/select alignment regression fix already in the worktree.

---

### Task 1: Compact finance-department manager

**Files:**
- Modify: `apps/admin/src/ReceivablesAdmin.tsx`
- Modify: `apps/admin/src/styles.css`
- Test: `apps/admin/scripts/check-receivables-admin-ui.mts`

**Interfaces:**
- Consumes: `visibleDepartments`, `rowActions`, `openEditor`, `statusFilter`, `listSearch`.
- Produces: one `receivables-department-toolbar` and one unpaginated `receivables-department-grid`.

- [ ] Add failing source assertions requiring a single department toolbar, a department grid, and no department-table pagination.
- [ ] Run `pnpm --filter @safety/admin check:receivables-admin-ui` and confirm the new assertion fails.
- [ ] Replace the department table with compact semantic department articles and move add/search/status/count into one toolbar.
- [ ] Add responsive 4/3/2/1-column CSS and keep inactive migration controls collapsed until requested.
- [ ] Re-run the admin UI check and typecheck.

### Task 2: Dashboard preference contract and persistence

**Files:**
- Modify: `apps/api/src/receivables-query.ts`
- Modify: `apps/api/src/routes/receivables.ts`
- Modify: `apps/api/scripts/check-receivables-core.mts`
- Modify: `apps/admin/src/receivables-types.ts`
- Modify: `apps/admin/scripts/check-receivables-admin-ui.mts`

**Interfaces:**
- Produces: `ReceivablesDashboardCardId`, `ReceivablesDashboardCardLayout`, `defaultReceivablesDashboardPreference`, `normalizeReceivablesDashboardPreference`, GET/PUT `/api/receivables/preferences/dashboard`.
- Validation: unique card IDs, width 3-12, height 2-8, title at most 40 characters, catalog-only IDs.

- [ ] Add failing normalization checks for invalid IDs, duplicates, bounds, missing cards, and custom titles.
- [ ] Run API and admin checks and confirm failures are caused by missing dashboard preference exports.
- [ ] Implement matching Zod and frontend normalizers with one canonical default layout per layer.
- [ ] Implement GET/PUT preference functions using `receivables.dashboard.v1` and the existing `requireReceivables(..., "enter")` boundary.
- [ ] Register authenticated routes and re-run focused checks.

### Task 3: Editable dashboard card grid

**Files:**
- Create: `apps/admin/src/ReceivablesDashboardGrid.tsx`
- Modify: `apps/admin/src/ReceivablesPage.tsx`
- Modify: `apps/admin/src/styles.css`
- Test: `apps/admin/scripts/check-receivables-admin-ui.mts`

**Interfaces:**
- Consumes: normalized personal preference, current authoritative dashboard response, existing ledger navigation callback and role-derived action model.
- Produces: edit mode, card catalog, title editing, add/remove, native drag reorder, pointer resize, save, cancel, and restore-default actions.

- [ ] Add failing assertions for edit mode, add-card catalog, drag handlers, resize pointer handlers, save/cancel, and restore-default.
- [ ] Run the focused admin check and confirm it fails.
- [ ] Implement card renderers for the seven approved catalog items without creating new financial calculations.
- [ ] Implement order-only native drag/drop and 12-column pointer resizing with min/max validation.
- [ ] Persist only on explicit save; cancel restores the last server value.
- [ ] Add compact desktop styles and automatic single-column mobile styles.
- [ ] Re-run focused checks, typecheck, and production build.

### Task 4: Verification

**Files:**
- Verify all changed files only.

- [ ] Run `pnpm check:receivables-core`.
- [ ] Run `pnpm check:receivables-admin-ui`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm build`.
- [ ] Run `git diff --check` and the Impeccable detector on changed UI targets.
- [ ] Use a local rendered fixture to verify department breakpoints and dashboard drag/resize affordances without changing production data.
