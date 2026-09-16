import assert from "node:assert/strict";
import { platformConditionalModule } from "../src/platform-access.js";

assert.equal(platformConditionalModule(false), "incident");
assert.equal(platformConditionalModule(true), "receivables");

console.log("PLATFORM_ACCESS_OK");
