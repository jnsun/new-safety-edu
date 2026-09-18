import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routes = await readFile(new URL("../src/routes/daily-challenge.ts", import.meta.url), "utf8");
assert.match(routes, /get\("\/api\/challenge\/admin\/questions"/);
assert.match(routes, /patch\("\/api\/challenge\/admin\/questions\/:id"/);
assert.match(routes, /get\("\/api\/challenge\/admin\/points"/);
assert.match(routes, /post\("\/api\/challenge\/admin\/points\/:id\/void"/);
assert.match(routes, /if \(!isCompanyAdmin\(principal\)\) forbidden\("只有公司管理员可以配置日常挑战题"\)/);
assert.match(routes, /updateMany\(\{ where: \{ id, voidedAt: null \}/);
assert.match(routes, /action: "challenge\.point_void"/);
assert.doesNotMatch(routes, /challengePointLedger\.(create|delete).*admin/);
assert.match(routes, /accessibleOrganizationIds\(principal\)/);
console.log("CHALLENGE_ADMIN_POLICY_OK");
