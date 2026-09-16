import assert from "node:assert/strict";
import { decideWebLoginDestination } from "../src/web-login-access.js";

assert.deepEqual(
  decideWebLoginDestination({ hasManagerRole: true, canEnterReceivables: false }),
  { allowed: true, path: "/" },
);
assert.deepEqual(
  decideWebLoginDestination({ hasManagerRole: false, canEnterReceivables: true }),
  { allowed: true, path: "/receivables" },
);
assert.deepEqual(
  decideWebLoginDestination({ hasManagerRole: false, canEnterReceivables: false }),
  { allowed: false, reason: "no_web_access" },
);

console.log("WEB_LOGIN_ACCESS_OK");
