import assert from "node:assert/strict";
import { authMeProfile } from "../src/auth-me-profile.ts";

assert.deepEqual(
  authMeProfile({
    username: "finance-admin",
    person: {
      name: "张三",
      organizations: [{ organization: { id: "finance", name: "财务资产部" } }],
    },
  }),
  {
    displayName: "张三",
    primaryOrganization: { id: "finance", name: "财务资产部" },
  },
);
assert.deepEqual(authMeProfile({ username: "bootstrap", person: null }), {
  displayName: "bootstrap",
  primaryOrganization: null,
});

console.log("auth me profile check passed");
