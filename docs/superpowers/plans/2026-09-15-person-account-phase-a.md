# Person and Account Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backward-compatible database foundations and preflight checks for the confirmed person, account, role, request, session, and project-membership rules without changing current UI behavior.

**Architecture:** Extend the existing Prisma models additively, backfill new canonical fields from current relationships, and enforce only constraints that are safe after explicit conflict checks. Keep existing `accountId`, legacy role values, and membership values temporarily so the current API continues to build; later phases switch behavior before removing compatibility fields.

**Tech Stack:** PostgreSQL 16, Prisma 6, TypeScript 5, Node.js 22, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-09-15-person-account-permission-audit.md`

## Global Constraints

- Work only on `main`; do not create a long-lived feature branch or worktree.
- Do not access old projects, production secrets, or production personal data.
- Do not run `prisma migrate reset`, `prisma db push`, or `docker compose down -v`.
- Do not deploy or modify production in this phase.
- Preserve current API compatibility; new columns are nullable or have safe defaults until Phase B changes behavior.
- Use a forward-only formal migration with conflict guards; never silently repair conflicting production rows.
- Do not remove legacy `learner`, `active`, or `removed` enum values in this compatibility migration.

---

### Task 1: Add an executable model-contract check

**Files:**
- Create: `apps/api/scripts/check-person-account-domain-model.mts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: the Prisma Client DMMF generated from `prisma/schema.prisma`.
- Produces: `pnpm check:person-account-domain-model`, which exits nonzero when a required compatibility field or guarded constraint is missing.

- [x] **Step 1: Write the failing check**

The check must assert the generated model contains Person merge fields, RoleAssignment `personId`, username history, current WeChat binding history, refresh-session metadata, request keys, structured audit metadata, project-membership history, and restrictive role-history deletion behavior.

- [x] **Step 2: Run the check and verify RED**

Run: `pnpm check:person-account-domain-model`

Expected: FAIL because the generated model does not yet contain the new foundations.

- [x] **Step 3: Add only the package scripts needed to run the check**

Add `check:person-account-domain-model` to the root and API package scripts using the existing `tsx scripts/...` pattern.

### Task 2: Extend the Prisma schema additively

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces nullable compatibility fields used by Phase B: `Person.mergedIntoPersonId`, `RoleAssignment.personId`, `ChangeRequest.requestKey`, and project membership history fields.
- Preserves current API access through existing `Account.roles`, `RoleAssignment.accountId`, and legacy enum values.

- [x] **Step 1: Add confirmed lifecycle values and relations**

Add `PersonStatus.merged`; add `withdrawn` and `failed` request states; add `approved`, `withdrawn`, `ended`, and `cancelled` membership states while preserving current values.

- [x] **Step 2: Add account and credential foundations**

Add normalized username, forced-password-change flag, password-login flag, last-login timestamp, username history, WeChat binding end metadata, and refresh-session family/client/rotation metadata.

- [x] **Step 3: Add person, role, request, audit, and membership foundations**

Add person merge history, nullable canonical role `personId`, request key and summaries, structured audit context/result fields, and multi-period project membership fields.

- [x] **Step 4: Synchronize shared lifecycle constants**

Add `merged` to the shared person-status contract. Preserve `learner` and the existing role-create contract until Phase B introduces person-based role commands.

### Task 3: Add the guarded forward migration

**Files:**
- Create: `prisma/migrations/202609150001_person_account_domain_foundations/migration.sql`

**Interfaces:**
- Backfills normalized usernames and role person IDs from current account-person links.
- Stops with an explicit exception on case-insensitive username conflicts, active role assignments without a linked person, duplicate active WeChat bindings, or duplicate current project memberships.

- [x] **Step 1: Add enum values and nullable/defaulted columns**

Use `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, additive columns, foreign keys with restrictive or nullifying delete behavior, and indexes matching Prisma relations.

- [x] **Step 2: Backfill canonical values**

Populate normalized usernames with `lower(username)` and role `person_id` through `accounts.person_id` without changing existing account or role identifiers.

- [x] **Step 3: Guard existing conflicts**

Use a PostgreSQL `DO` block to raise descriptive exceptions before creating unique indexes. Do not choose winners or mutate conflicting business relationships.

- [x] **Step 4: Replace permanent project-member uniqueness**

Drop the old `(project_id, person_id)` unique index and add partial uniqueness for current pending and current active/approved relationships while retaining historical rows.

### Task 4: Verify the compatibility batch

**Files:**
- Modify only files already listed if verification exposes a defect.

**Interfaces:**
- Consumes the finished schema, migration, contracts, and package scripts.
- Produces buildable generated Prisma types and repeatable verification evidence.

- [x] **Step 1: Run the new check and verify GREEN**

Run: `pnpm check:person-account-domain-model`

Expected: `PERSON_ACCOUNT_DOMAIN_MODEL_OK`.

- [x] **Step 2: Validate and generate Prisma**

Run: `pnpm exec prisma validate` and `pnpm exec prisma generate`.

Expected: both commands exit 0.

- [x] **Step 3: Run affected checks and builds**

Run: `pnpm check:phase1-invariants`, `pnpm check:phase1-policy`, `pnpm --filter @safety/contracts build`, and `pnpm --filter @safety/api build`.

Expected: all exit 0.

- [x] **Step 4: Apply all migrations to an isolated empty PostgreSQL database**

Run `prisma migrate deploy` against a disposable loopback-only PostgreSQL instance, query `_prisma_migrations` and the new indexes, then run `prisma migrate diff --from-url ... --to-schema-datamodel prisma/schema.prisma --exit-code`.

Expected: 18 finished migrations, all five targeted partial indexes, and no schema drift.

- [x] **Step 5: Inspect the final diff**

Run: `git diff --check`, a targeted secret scan, and `git status --short`.

Expected: no whitespace errors or secret values; only planned documentation, schema, migration, contract, and check-script changes remain.

## Self-review

- This plan covers only the additive database foundation and does not claim the P0/P1 behavior is already fixed.
- It deliberately preserves current compatibility fields and enum values; their removal belongs after Phase B has migrated every caller.
- No production deployment, production data cleanup, or Admin/miniprogram behavior change is included.
