import type { Principal } from "./auth.js";
import { prisma } from "./db.js";

export const isCompanyAdmin = (principal: Principal) => principal.roles.some((r) => r.role === "company_admin");

export function organizationScopeIds(principal: Principal): string[] {
  return principal.roles.filter((r) => ["org_leader", "org_admin"].includes(r.role) && r.scopeType === "organization" && r.scopeId).map((r) => r.scopeId as string);
}

export function projectScopeIds(principal: Principal): string[] {
  return principal.roles.filter((r) => r.role === "project_admin" && r.scopeType === "project" && r.scopeId).map((r) => r.scopeId as string);
}

export async function accessibleOrganizationIds(principal: Principal): Promise<string[]> {
  return [...new Set(organizationScopeIds(principal))];
}

export async function canAccessOrganization(principal: Principal, organizationId: string) {
  return isCompanyAdmin(principal) || (await accessibleOrganizationIds(principal)).includes(organizationId);
}

export async function canAccessProject(principal: Principal, projectId: string): Promise<boolean> {
  if (isCompanyAdmin(principal) || projectScopeIds(principal).includes(projectId)) return true;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { responsibleOrganizationId: true } });
  return !!project && (await accessibleOrganizationIds(principal)).includes(project.responsibleOrganizationId);
}

export async function canAccessPerson(principal: Principal, personId: string): Promise<boolean> {
  if (principal.personId === personId || isCompanyAdmin(principal)) return true;
  const orgIds = await accessibleOrganizationIds(principal);
  if (orgIds.length && await prisma.organizationMembership.findFirst({ where: { personId, active: true, organizationId: { in: orgIds } } })) return true;
  const projectIds = projectScopeIds(principal);
  return !!projectIds.length && !!await prisma.projectMember.findFirst({ where: { personId, projectId: { in: projectIds }, status: "active" } });
}

export function forbidden(message = "超出授权范围"): never {
  throw Object.assign(new Error(message), { statusCode: 403, code: "SCOPE_FORBIDDEN" });
}
