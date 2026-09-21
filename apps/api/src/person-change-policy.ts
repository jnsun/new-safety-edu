import type { PersonType } from "@prisma/client";
import { assertFirstReleaseWorkflowAllowed } from "./first-release-policy.js";

export type PersonChangeRequestType = "identity_correction" | "contractor_unit_change" | "responsible_entity_change";

export function assertPersonChangeRequestAllowed(input: {
  requestType: PersonChangeRequestType;
  currentPersonType: PersonType;
  nextPersonType?: PersonType;
}) {
  assertFirstReleaseWorkflowAllowed(input.requestType);
  if (input.requestType === "contractor_unit_change" && input.currentPersonType !== "contractor") {
    throw Object.assign(new Error("仅外协人员可以申请变更外协单位"), { statusCode: 409, code: "PERSON_TYPE_NOT_CONTRACTOR" });
  }
  if (input.requestType === "responsible_entity_change" && !["contractor", "temporary_individual"].includes(input.currentPersonType)) {
    throw Object.assign(new Error("仅外协人员或临时个人可以申请变更内部责任实体"), { statusCode: 409, code: "RESPONSIBLE_ENTITY_CHANGE_NOT_ALLOWED" });
  }
  if (input.requestType === "identity_correction" && (!input.nextPersonType || input.nextPersonType === input.currentPersonType)) {
    throw Object.assign(new Error("请选择与当前身份不同的人员类型"), { statusCode: 409, code: "PERSON_TYPE_UNCHANGED" });
  }
}

export function canReviewPersonChange(input: {
  requestType: PersonChangeRequestType;
  isCompanyAdmin: boolean;
  leaderOrganizationIds: ReadonlySet<string>;
  currentOrganizationId?: string | null;
  targetOrganizationId?: string | null;
}) {
  if (input.isCompanyAdmin) return true;
  if (input.requestType === "identity_correction") return false;
  if (input.requestType === "contractor_unit_change") return !!input.currentOrganizationId && input.leaderOrganizationIds.has(input.currentOrganizationId);
  return !!input.targetOrganizationId && input.leaderOrganizationIds.has(input.targetOrganizationId);
}
