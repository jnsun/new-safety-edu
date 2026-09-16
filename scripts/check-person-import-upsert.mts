import assert from "node:assert/strict";

const policy = await import("../apps/api/src/person-import-upsert-policy.js").catch(() => ({}));
assert.equal(typeof policy.planExistingPersonImport, "function", "重复人员补齐策略尚未实现");

const plan = policy.planExistingPersonImport as (input: unknown) => {
  mode: "create" | "update" | "skip" | "conflict";
  personId?: string;
  fields: string[];
  reasons: string[];
};

const existing = {
  id: "person-1",
  name: "匿名人员",
  phone: "13000000000",
  nationalIdHash: "hash-1",
  photoFileId: null,
  primaryOrganizationId: null,
  status: "active"
};

assert.deepEqual(plan({ nationalIdHash: "hash-1", phone: "13000000000", name: "匿名人员", organizationId: "org-1", hasPhoto: false, matchesByNationalId: [existing], matchesByPhone: [existing] }), {
  mode: "update", personId: "person-1", fields: ["organization"], reasons: ["补齐主部门"]
});

assert.equal(plan({ nationalIdHash: "hash-1", phone: "13000000000", name: "匿名人员", organizationId: "org-2", hasPhoto: false, matchesByNationalId: [{ ...existing, primaryOrganizationId: "org-1" }], matchesByPhone: [{ ...existing, primaryOrganizationId: "org-1" }] }).mode, "conflict");
assert.equal(plan({ nationalIdHash: "hash-1", phone: "13000000000", name: "匿名人员", organizationId: "org-1", hasPhoto: false, matchesByNationalId: [{ ...existing, primaryOrganizationId: "org-1" }], matchesByPhone: [{ ...existing, primaryOrganizationId: "org-1" }] }).mode, "skip");
assert.equal(plan({ nationalIdHash: "hash-1", phone: "13000000000", name: "匿名人员", organizationId: "org-1", hasPhoto: false, matchesByNationalId: [existing], matchesByPhone: [{ ...existing, id: "person-2" }] }).mode, "conflict");
assert.equal(plan({ nationalIdHash: "hash-1", phone: "13000000000", name: "匿名人员", organizationId: "org-1", hasPhoto: false, matchesByNationalId: [], matchesByPhone: [] }).mode, "create");

console.log("person_import_upsert_check=PASS");
