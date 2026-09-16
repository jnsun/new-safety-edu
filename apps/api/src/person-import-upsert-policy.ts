export type ExistingPersonImportMatch = {
  id: string;
  name: string;
  phone: string;
  nationalIdHash: string | null;
  photoFileId: string | null;
  primaryOrganizationId: string | null;
  status: string;
};

type ImportCandidate = {
  nationalIdHash?: string;
  phone: string;
  name: string;
  organizationId?: string;
  hasPhoto: boolean;
  matchesByNationalId: ExistingPersonImportMatch[];
  matchesByPhone: ExistingPersonImportMatch[];
};

export type PersonImportPlan = {
  mode: "create" | "update" | "skip" | "conflict";
  personId?: string;
  fields: Array<"phone" | "nationalId" | "photo" | "organization">;
  reasons: string[];
};

const normalizedName = (value: string) => value.replace(/\s+/g, "");

export function planExistingPersonImport(input: ImportCandidate): PersonImportPlan {
  const matches = [...new Map([...input.matchesByNationalId, ...input.matchesByPhone].map((person) => [person.id, person])).values()];
  if (!matches.length) return { mode: "create", fields: [], reasons: ["新建人员档案"] };
  if (matches.length > 1) return { mode: "conflict", fields: [], reasons: ["身份证和手机号对应不同人员档案"] };

  const person = matches[0]!;
  const conflicts: string[] = [];
  if (person.status !== "active") conflicts.push("匹配到的人员不是正常状态");
  if (normalizedName(person.name) !== normalizedName(input.name)) conflicts.push("姓名与已有人员档案不一致");
  if (input.nationalIdHash && person.nationalIdHash && input.nationalIdHash !== person.nationalIdHash) conflicts.push("身份证与已有人员档案不一致");
  if (input.phone && person.phone && input.phone !== person.phone) conflicts.push("手机号与已有人员档案不一致");
  if (input.organizationId && person.primaryOrganizationId && input.organizationId !== person.primaryOrganizationId) conflicts.push("Excel 部门与已有主部门不一致");
  if (conflicts.length) return { mode: "conflict", personId: person.id, fields: [], reasons: conflicts };

  const fields: PersonImportPlan["fields"] = [];
  if (!person.phone && input.phone) fields.push("phone");
  if (!person.nationalIdHash && input.nationalIdHash) fields.push("nationalId");
  if (!person.photoFileId && input.hasPhoto) fields.push("photo");
  if (!person.primaryOrganizationId && input.organizationId) fields.push("organization");
  const labels = { phone: "补齐手机号", nationalId: "补齐身份证", photo: "补齐照片", organization: "补齐主部门" } as const;
  return fields.length
    ? { mode: "update", personId: person.id, fields, reasons: fields.map((field) => labels[field]) }
    : { mode: "skip", personId: person.id, fields: [], reasons: ["已有档案资料无需补齐"] };
}
