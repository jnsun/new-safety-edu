import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routes = await readFile(new URL("../src/routes/daily-challenge.ts", import.meta.url), "utf8");
const server = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");

assert.match(routes, /get\("\/api\/me\/daily-challenge"/);
assert.match(routes, /post\("\/api\/me\/daily-challenge\/answers"/);
assert.match(routes, /get\("\/api\/me\/challenge-points"/);
assert.match(routes, /answerSchema = z\.object\([\s\S]*?\)\.strict\(\)/);
assert.match(routes, /questionSnapshot: snapshot/);
assert.match(routes, /sourceKey: `challenge-answer:\$\{answer\.id\}`/);
assert.match(routes, /if \(existing\)[\s\S]*repeated: true/);
assert.doesNotMatch(routes.match(/questions: snapshot\.questions[\s\S]*?answers:/)?.[0] ?? "", /correct:/);
assert.match(server, /registerDailyChallengeRoutes/);

console.log("DAILY_CHALLENGE_ROUTES_OK");
