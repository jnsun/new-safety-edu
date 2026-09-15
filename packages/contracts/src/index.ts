import { z } from "zod";

export const roleNames = ["company_admin", "org_leader", "org_admin", "field_reporter", "project_admin", "learner"] as const;
export const assignableRoleNames = ["company_admin", "org_leader", "org_admin", "field_reporter", "project_admin"] as const;
export const personTypes = ["employee", "contractor", "temporary_individual"] as const;
export const personStatuses = ["pending", "active", "disabled", "merged"] as const;
export const projectStatuses = ["active", "paused", "ended"] as const;
export const organizationTypes = ["company", "business_entity", "department", "contractor"] as const;

export const loginSchema = z.object({ username: z.string().trim().min(3).max(80), password: z.string().min(8).max(200) });
export const organizationCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(organizationTypes),
  parentId: z.string().uuid().nullable().optional()
});
export const projectCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().min(2).max(50),
  responsibleOrganizationId: z.string().uuid(),
  projectType: z.string().trim().max(120).optional(),
  location: z.string().trim().max(300).optional(),
  contractAmount: z.coerce.number().min(0).optional(),
  plannedStartAt: z.string().date().optional(),
  plannedEndAt: z.string().date().optional(),
  managerName: z.string().trim().max(80).optional(),
  managerPhone: z.string().regex(/^1\d{10}$/).optional()
}).superRefine((value, context) => {
  if (value.plannedStartAt && value.plannedEndAt && value.plannedStartAt > value.plannedEndAt) context.addIssue({ code: "custom", path: ["plannedEndAt"], message: "计划结束日期不能早于开始日期" });
});
export const personCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().regex(/^1\d{10}$/),
  type: z.enum(personTypes),
  organizationId: z.string().uuid(),
  nationalId: z.string().trim().min(6).max(30),
  photoFileId: z.string().uuid()
});
export const roleAssignmentCreateSchema = z.object({
  personId: z.string().uuid(),
  role: z.enum(assignableRoleNames),
  scopeType: z.enum(["company", "organization", "project"]),
  scopeId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().min(2).max(500)
}).superRefine((value, context) => {
  const expected = { company_admin: "company", org_leader: "organization", org_admin: "organization", field_reporter: "organization", project_admin: "project" }[value.role];
  if (value.scopeType !== expected || (value.scopeType === "company" ? value.scopeId != null : !value.scopeId)) {
    context.addIssue({ code: "custom", message: "角色与 scope 类型不匹配" });
  }
});

export type RoleName = typeof roleNames[number];
export type AssignableRoleName = typeof assignableRoleNames[number];
export type PersonType = typeof personTypes[number];
