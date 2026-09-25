# Five-page baseline UI scope audit

Source: dirty `E:\codex\new-safety-edu` (`main`, `e6950929`); target: clean contract RC `codex/baseline-ui-test` (`3ad746d0`). The source is evidence for individual UI hunks, **not** a branch to merge or a directory to copy. Contract business code in `3ad746d0` remains authoritative.

| Source file / hunk | Target | Five-page reason | Other content in source | Extraction |
| --- | --- | --- | --- | --- |
| `apps/admin/src/App.tsx`: Login, PlatformGateway, baseline shell classes | same file | `/login`, `/`, route-scoped density | contract route, navigation and API hook already in RC | semantic hunks only; no contract implementation copied |
| `apps/admin/src/platform-access.ts` | same file | always land on the equal three-system center | none beyond landing behavior | semantic hunk |
| `apps/admin/scripts/check-platform-access.mts` | same file | checks new landing behavior, including self-profile-only users | none | semantic hunk |
| `apps/admin/src/SafetyManagementPages.tsx`: `view === "mine"` workbench | same file | `/monthly-reports/mine` filters, columns, action placement | other monthly views and historical logic | workbench hunks only; styles applied only on mine route |
| `apps/admin/scripts/check-monthly-report-ui.mts` | same file | asserts the single-entity fixed scope label | none | one assertion |
| `apps/admin/src/monthly-reports.css` | same file | comfortable S13 list layout | rules for other monthly pages | appended `.baseline-monthly-shell .is-baseline-mine` rules only |
| `apps/admin/src/ReceivablesLedger.tsx` | same file | `/receivables/ledger` compact filter/table, tooltip, authorized create entry | unrelated dashboard/data-entry changes in `ReceivablesPage.tsx` | ledger hunks only |
| `apps/admin/src/receivables-baseline.css` | new file | compact F02 layout | source was untracked | selected route-scoped rules, no finance-wide redesign |
| `apps/admin/src/visual-system.css` | `apps/admin/src/baseline-ui.css` | Figma palette and five route visual rules | source contains global Ant selectors and safety/finance-wide styling | **not copied**; rewrote as scoped selectors |
| `apps/admin/src/visual-tokens.ts`, `apps/admin/src/main.tsx` | `baseline-ui.css`, one CSS import in `main.tsx` | CSS variables scoped to five routes | source changes global Ant theme | global theme change excluded |
| `apps/admin/src/styles.css` | unchanged | existing contract RC styles retained; new baseline overrides live in separate file | source appends contract-detail styling and generic platform overrides | no whole-file transfer |
| `apps/admin/public/company-logo.png` | same asset path | company mark on login and system center | none | exact binary copy |
| `apps/admin/src/contracts/*` in source | unchanged | `/contracts` RC business surface already exists | alternate uncommitted contract implementation | excluded entirely; only ledger CSS override |

Excluded: `Dockerfile`, `prisma/*`, `apps/api/*`, `package.json`, `ReceivablesPage.tsx`, `Day4Pages.tsx`, `CONTEXT-MAP.md`, broader design docs and other parallel source files. No schema, migration, backend contract, mock, debug code, credential or environment file belongs to this commit.

## Design evidence and status

- Company palette `#0C6A5B`, `#F5F8F7`, `#182B27`, `#D8E3DF` is confirmed in Figma `ZNyGaVfu208iwemCaHSwbu`, node `5:3`. These are foundation tokens, not proof that the page layouts match.
- `/login` and `/`: no independent latest Figma frame supplied; **PARTIAL / WAITING_FOR_FIGMA**. Existing auth, QR/password flip and real capability queries remain.
- `/monthly-reports/mine` S13 `5:309` and `/receivables/ledger` F02 `2:73`: these IDs are **not in the known foundation file**; both `get_design_context` calls returned `INVALID_ARGUMENT`. Their live page-frame fidelity is **UNVERIFIED pending file-specific links**. The extracted changes remain route-scoped and use real APIs; do not label either PASS against Figma until the correct frames are read and compared.
- `/contracts`: RC module is the business base; no verified latest project/contract page frame, so **BLOCKED_BY_FIGMA** for visual fidelity.

## Density and side-effect boundary

- Safety: comfortable, only `.baseline-monthly-shell` and `.is-baseline-mine`.
- Finance: compact, only `.baseline-finance-shell` on the ledger route. Complete-filter totals are still supplied by the server; monetary calculations and permission checks are unchanged.
- Contract: medium-compact, only `.contract-shell .contract-ledger-page`; detail, forms and business code remain from RC.
- No new unscoped `table`, `button`, `.ant-table-row` or global Ant theme overrides. Existing app-wide styles were not rewritten. A CSS import is global in loading only; its selectors are limited to the five page roots.

## Extraction verification

- The staged file list must match this table; `git diff --check` found no whitespace errors.
- Admin and API build/typecheck passed. Platform access, login card, monthly UI static, receivables admin UI, Web login, WeChat login, receivables access, contract access and project-reporting policy checks passed.
- Contract E2E smoke passed against a disposable local PostgreSQL instance; no test-site or production database was changed.
- The local login page rendered and its password/QR faces switched in a browser. Authenticated monthly, receivables and contract flows were **not** browser-verified in this extraction phase.
- The style-token detector reported advisory mismatches with the older repository `DESIGN.md`; the foundation colors above were checked against the named Figma file, but page-frame alignment remains unverified.
- Build emitted the existing Node engine mismatch and large-bundle warnings; neither was treated as a visual pass.

After the commit, repeat build/typecheck and relevant checks from a clean checkout. Real test-site browser acceptance belongs to the later release phase.
