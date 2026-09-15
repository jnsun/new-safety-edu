# CONTEXT Remaining Requirements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining partially implemented requirements in `CONTEXT.md` for the three formal modules without building the six planned modules.

**Architecture:** Extend the existing Fastify, Prisma, React Admin, and native miniprogram paths in place. Put authorization, idempotency, lifecycle transitions, and high-risk audit writes in small server-side domain helpers; clients consume allowed actions and never recreate policy.

**Tech Stack:** Node.js 22, pnpm 11, Fastify, TypeScript strict, Prisma 6, PostgreSQL 16, React/Vite/Ant Design, native WeChat miniprogram JavaScript.

**Spec:** `CONTEXT.md` and `docs/superpowers/specs/2026-09-15-person-account-permission-audit.md`

**Current status (2026-09-15):** Tasks 1–8 are implemented in the local working tree and the focused closure inventory reports 22/22. Prisma validation, TypeScript, production builds, and miniprogram static checks pass. Forward migrations 004–010 still require execution against an authorized independent test PostgreSQL before any deployment.

## Global Constraints

- Continue on `main`; do not create a worktree or long-lived feature branch.
- Preserve all current uncommitted work and do not deploy or modify production without a separate instruction.
- Add only forward Prisma migrations; never use `db push`, `migrate reset`, or destructive volume operations.
- The three formal modules are training education, field monthly reporting, and qualifications; the six planned cards remain placeholders.
- High-risk mutations and structured audit facts commit in the same database transaction or both fail.
- Authorization is recalculated server-side at mutation time and never delegated to hidden client buttons.
- Do not add a new test framework; use the repository's focused executable policy checks and isolated smoke scripts.

---

### Task 1: Transactional audit and request concurrency foundation

**Files:**
- Create: `apps/api/src/transaction-audit.ts`
- Create: `apps/api/src/request-policy.ts`
- Create: `apps/api/scripts/check-transaction-audit-policy.mts`
- Create: `apps/api/scripts/check-request-policy.mts`
- Modify: `apps/api/src/audit.ts`
- Modify: `apps/api/src/routes/day1.ts`
- Modify: `apps/api/src/routes/day4.ts`
- Modify: `apps/api/src/routes/wechat.ts`
- Modify: `apps/api/src/routes/qualifications.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202609150006_request_and_security_foundations/migration.sql`

**Interfaces:**
- Produces: `writeCriticalAudit(tx, event)` and `claimPendingRequest(tx, requestId)`.
- Produces: stable `changeRequestKey(type, subject, target)` values used by all active pending requests.

- [ ] Write policy checks that fail while `auditCritical` can swallow high-risk database failures and while pending request creation lacks a stable key.
- [ ] Add a forward migration for request uniqueness and security-event foundations, with guarded backfill for existing duplicates.
- [ ] Implement transaction-scoped audit and conditional pending-request claim helpers.
- [ ] Convert account, role, person, relationship, merge, sensitive access/export, exam unlock, certificate mutation, and project confirmation paths to use the transaction helper.
- [ ] Run `pnpm check:transaction-audit-policy`, `pnpm check:request-policy`, Prisma validation, API typecheck, and affected isolated smokes.

### Task 2: Authentication, CSRF, session, and credential lifecycle

**Files:**
- Create: `apps/api/src/auth-security.ts`
- Create: `apps/api/src/csrf.ts`
- Create: `apps/api/scripts/check-auth-security-policy.mts`
- Modify: `apps/api/src/auth.ts`
- Modify: `apps/api/src/routes/day1.ts`
- Modify: `apps/api/src/routes/phone-auth.ts`
- Modify: `apps/api/src/routes/wechat.ts`
- Modify: `apps/api/src/routes/wechat-web-auth.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/miniprogram/utils/api.js`
- Modify: `apps/miniprogram/pages/profile/index.js`

**Interfaces:**
- Produces: `issueSession(accountId, env, { clientKind, loginMethod, absoluteTtlMs })` with Web capped at eight hours and miniprogram at thirty days.
- Produces: password/SMS attempt guards, purpose-specific verification codes, CSRF issuance/verification, per-session revocation, recovery, phone change, and WeChat rebind endpoints.

- [ ] Write failing policy checks for password rules, five-failure lock, Web eight-hour maximum, per-device revoke, CSRF, purpose-specific SMS codes, and management-role-only Web WeChat login.
- [ ] Implement database-backed password and SMS attempt limits without exposing whether an account exists.
- [ ] Add CSRF cookie/header checks for Cookie-authenticated writes while excluding Bearer-authenticated miniprogram calls.
- [ ] Add per-device revoke, password recovery, verified-phone change, and WeChat rebind flows with session invalidation and audit.
- [ ] Add Web first-bind and reject ordinary-person Web OAuth sessions.
- [ ] Run focused checks plus API/Admin/miniprogram type and static checks.

### Task 3: Complete person/account requests and detail timelines

**Files:**
- Create: `apps/api/src/change-requests.ts`
- Create: `apps/api/src/person-actions.ts`
- Create: `apps/api/scripts/check-person-request-policy.mts`
- Modify: `apps/api/src/routes/day1.ts`
- Modify: `apps/api/src/routes/day4.ts`
- Modify: `apps/api/src/routes/wechat.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/Day4Pages.tsx`
- Modify: `apps/miniprogram/pages/profile/index.js`
- Modify: `apps/miniprogram/pages/profile/index.wxml`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202609150007_person_request_lifecycle/migration.sql`

**Interfaces:**
- Produces: dedicated account-opening, recovery, identity correction, reactivation, credential rebind, contractor-unit, responsible-entity, project-exit, and cross-entity-admin request types.
- Produces: withdraw/cancel/approve/reject handlers, attachment authorization, `availableActions`, deletion-preview, exact-ID lookup, and immutable person timeline APIs.

- [ ] Write failing request-matrix and person-action checks.
- [ ] Add only the enum values, attachment relation, and immutable history fields required by the confirmed workflows.
- [ ] Implement direct actions separately from applications and enforce the confirmed reviewer matrix.
- [ ] Add the “申请与变更” and “操作记录” person-detail tabs with current/history separation.
- [ ] Add exact national-ID lookup, type correction, reactivation, deletion preview, and photo history handling.
- [ ] Run focused checks, Prisma validation, and Admin/API builds.

### Task 4: Project member and role lifecycle completion

**Files:**
- Create: `apps/api/src/project-membership.ts`
- Create: `apps/api/scripts/check-project-membership-policy.mts`
- Modify: `apps/api/src/roles.ts`
- Modify: `apps/api/src/routes/day1.ts`
- Modify: `apps/api/src/routes/day4.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/miniprogram/pages/management/index.js`
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: atomic project-admin grant/member creation/induction dispatch/audit.
- Produces: exit, withdraw, cancel, rejoin, carry-forward, bulk-add, cross-entity approval, and project-end services.

- [ ] Write failing checks for project end, self-confirm denial, cross-entity project-admin approval, exit/rejoin linkage, and atomic automatic induction.
- [ ] Implement the lifecycle service with row locking and per-person result objects.
- [ ] Route all project member and project-admin mutations through the service.
- [ ] Expose allowed actions and denial reasons to Admin and miniprogram management views.
- [ ] Run focused checks and isolated project lifecycle smoke.

### Task 5: Sensitive reveal, archive packages, and private-file lifecycle

**Files:**
- Modify: `apps/api/src/sensitive-token-scope.ts`
- Modify: `apps/api/src/sensitive-export.ts`
- Modify: `apps/api/src/routes/sensitive-exports.ts`
- Modify: `apps/api/src/private-file-access.ts`
- Create: `apps/api/src/private-file-retention.ts`
- Modify: `apps/admin/src/SensitiveExports.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/miniprogram/pages/profile/index.js`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202609150008_sensitive_history_and_retention/migration.sql`

**Interfaces:**
- Produces: reason-bound sensitive reveal grants, self profile-package scope, ten-minute one-use downloads, completion notifications, photo history, and orphan-file retention jobs.

- [ ] Write failing checks for reason requirement, target-bound reveal, self package, scope-derived membership, ten-minute expiry, one-use download, whole-package failure, and notifications.
- [ ] Implement package metadata and retention rules without storing secrets or public paths.
- [ ] Add self package and administrator scope package UI.
- [ ] Add controlled photo-history references and a dry-run-first orphan cleanup command.
- [ ] Run focused checks and isolated private-file/export smokes.

### Task 6: Training governance hardening

**Files:**
- Create: `apps/api/src/question-versions.ts`
- Create: `apps/api/src/courseware-viewer-policy.ts`
- Create: `apps/api/scripts/check-training-governance.mts`
- Modify: `apps/api/src/routes/day2.ts`
- Modify: `apps/api/src/routes/day3.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/miniprogram/pages/courseware/index.js`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202609150009_training_governance/migration.sql`

**Interfaces:**
- Produces: append-only question versions, fixed/random paper version references, explicit scoped publishing capability, and sandboxed HTML viewer policy.

- [ ] Write failing checks for immutable question versions, batch snapshot stability, explicit publish capability, and HTML viewer isolation.
- [ ] Add additive version and publish-grant models and backfill current questions as version one.
- [ ] Route question edits/imports through append-only versions and freeze version IDs in paper snapshots.
- [ ] Enforce separately granted publication capability.
- [ ] Serve interactive HTML without platform authentication cookies and with restrictive CSP/network policy.
- [ ] Run training policy checks, API/Admin builds, and miniprogram static check.

### Task 7: Qualification ownership, import conflicts, and reminders

**Files:**
- Create: `apps/api/src/qualification-policy.ts`
- Create: `apps/api/scripts/check-qualification-policy.mts`
- Modify: `apps/api/src/qualification-import.ts`
- Modify: `apps/api/src/routes/qualifications.ts`
- Modify: `apps/api/src/reminders.ts`
- Modify: `apps/admin/src/Qualifications.tsx`

**Interfaces:**
- Produces: owner-type validation, explicit import conflict actions (`skip`, `renew`, `void_and_create`), and deduplicated personal/unit expiry reminders.

- [ ] Write failing checks for company/business-entity ownership, department rejection, import conflict actions, and unit reminders.
- [ ] Apply owner-type validation to create, update, renew, and import.
- [ ] Add conflict previews and require an explicit action for each conflicting row.
- [ ] Replace blind duplicate revocation with reasoned correction actions and transactional audit.
- [ ] Generate deduplicated unit qualification expiry notifications without any work-eligibility conclusion.
- [ ] Run qualification checks, API/Admin builds, and focused import parser checks.

### Task 8: Operational retention, recovery CLI, regression, and delivery readiness

**Files:**
- Create: `apps/api/src/retention.ts`
- Create: `apps/api/scripts/admin-recovery.mts`
- Create: `apps/api/scripts/run-retention.mts`
- Create: `apps/api/scripts/check-context-closure.mts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/mvp-deploy.md`

**Interfaces:**
- Produces: sudo-operated administrator recovery, retention jobs for security metadata/logs/temp files, low-risk audit replay/archival, capacity warning, and one closure check covering all 22 areas.

- [ ] Write failing checks for recovery preconditions, retention cutoffs, immutable business audit, and safe audit replay.
- [ ] Implement commands with dry-run defaults, explicit production confirmation, structured result counts, and no secret output.
- [ ] Wire scheduler-friendly one-shot commands without adding a job platform.
- [ ] Run all focused policy checks, Prisma generate/validate, TypeScript checks, production builds, and miniprogram static checks.
- [ ] Inspect `git diff --check`, secret patterns, generated artifacts, and migration ordering; do not commit, push, or deploy without separate authorization.

## Self-review

- Coverage: Tasks 1–8 cover all 22 remaining/partial areas from the static audit.
- Scope: The six planned platform cards and all automatic work-eligibility conclusions remain excluded.
- Delivery: Each task leaves a focused executable check and can be reviewed independently while staying on `main`.
