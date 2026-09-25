import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";

const app = dirname(dirname(fileURLToPath(import.meta.url)));
const page = readFileSync(resolve(app, "src/SafetyManagementPages.tsx"), "utf8");
const shell = readFileSync(resolve(app, "src/App.tsx"), "utf8");

for (const path of ["mine", "manage", "completed", "config"]) {
  assert.ok(shell.includes(`/monthly-reports/${path}`), `missing real navigation: ${path}`);
}
assert.ok(shell.includes('path="/monthly-reports/*"'), "monthly report subroutes unavailable");
assert.ok(page.includes('view === "config" ? !!capabilities.data?.canConfigure'), "configuration privilege guard missing");
assert.ok(page.includes('view === "manage" ? !!capabilities.data?.canReview'), "company review privilege guard missing");
assert.ok(page.includes('view === "mine" ? !!capabilities.data?.canSubmit'), "entity write privilege guard missing");
assert.ok(page.includes('/api/monthly-reports/submissions/preflight?organizationId='), "server preflight missing");
assert.ok(page.includes('latest.expectedCount !== preflight.data.expectedCount'), "changed project set must invalidate batch confirmation");
assert.ok(page.includes('setNoProjectDialog(!noFieldOrganizationId ? "select"'), "no-project scope selection missing");
assert.ok(page.includes('hasSingleReportingOrganization'), "single-entity reporter context missing");
assert.ok(page.includes('报送主体：{selectedOrganizationName}'), "single-entity reporter must see a fixed organization");
assert.ok(page.includes('projectTypeId: project?.projectType'), "new project type must carry into the monthly draft");
assert.ok(page.includes('projectTypeOptions.map'), "new project type must use the approved taxonomy");
assert.ok(page.includes('disabled={!preflight.data?.ready}'), "blocked batch must not submit");
assert.ok(page.includes('setBatchResult(result)'), "success state must use server result");
assert.ok(page.includes('readSnapshotField(previousSnapshot'), "history revision comparison missing");
assert.ok(!page.includes('action: "confirm"'), "company review must not require per-batch confirmation");

console.log("MONTHLY_REPORT_UI_STATIC_OK (route/state/source checks only; not browser E2E)");
