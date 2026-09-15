import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";

const model = (name: string) => {
  const value = Prisma.dmmf.datamodel.models.find((item) => item.name === name);
  assert.ok(value, `Prisma model ${name} is missing`);
  return value;
};

const fieldNames = (name: string) => new Set(model(name).fields.map((field) => field.name));
const expectFields = (name: string, expected: string[]) => {
  const actual = fieldNames(name);
  for (const field of expected) assert.ok(actual.has(field), `${name}.${field} is missing`);
};

const enumValues = (name: string) => {
  const value = Prisma.dmmf.datamodel.enums.find((item) => item.name === name);
  assert.ok(value, `Prisma enum ${name} is missing`);
  return new Set(value.values.map((item) => item.name));
};

for (const value of ["pending", "active", "disabled", "merged"]) {
  assert.ok(enumValues("PersonStatus").has(value), `PersonStatus.${value} is missing`);
}

for (const value of ["pending", "active", "approved", "rejected", "withdrawn", "removed", "ended", "cancelled"]) {
  assert.ok(enumValues("MembershipStatus").has(value), `MembershipStatus.${value} is missing`);
}

for (const value of ["pending", "approved", "rejected", "withdrawn", "cancelled", "duplicate", "failed"]) {
  assert.ok(enumValues("ChangeRequestStatus").has(value), `ChangeRequestStatus.${value} is missing`);
}

expectFields("Account", ["usernameNormalized", "mustChangePassword", "passwordLoginEnabled", "lastLoginAt", "usernameHistory"]);
expectFields("UsernameHistory", ["accountId", "username", "usernameNormalized", "endedAt", "changedBy", "reason"]);
expectFields("Person", ["mergedIntoPersonId", "mergedAt", "mergedBy", "mergeReason", "mergedInto", "mergedPersons"]);
expectFields("RoleAssignment", ["personId", "person"]);
expectFields("WechatBinding", ["endedAt", "endedBy", "endReason"]);
expectFields("RefreshSession", ["clientKind", "familyId", "rotatedFromId", "lastUsedAt", "userAgent"]);
expectFields("ProjectMember", ["previousMembershipId", "endedAt", "endedBy", "endReason", "previousMembership", "laterMemberships"]);
expectFields("ChangeRequest", ["requestKey", "beforeSummary", "afterSummary"]);
expectFields("AuditLog", ["requestId", "actorRole", "actorScopeType", "actorScopeId", "result"]);

const roleAccountRelation = model("RoleAssignment").fields.find((field) => field.name === "account");
assert.equal(roleAccountRelation?.relationOnDelete, "Restrict", "Deleting an account must not cascade-delete role history");

console.log("PERSON_ACCOUNT_DOMAIN_MODEL_OK");
