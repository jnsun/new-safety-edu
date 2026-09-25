import type { ContractGrantRole, Prisma } from "@prisma/client";
import type { Principal } from "./auth.js";
import { prisma } from "./db.js";

type GrantFacts = {
  role: ContractGrantRole;
  canCreateProject: boolean;
  canEditProject: boolean;
  canManageContracts: boolean;
  canUploadAttachments: boolean;
  canChangeStage: boolean;
  canExport: boolean;
  canViewAll: boolean;
  canManageAccess: boolean;
};

export type ContractAccess = {
  role: ContractGrantRole | null;
  canEnter: boolean;
  canCreateProject: boolean;
  canEditProject: boolean;
  canManageContracts: boolean;
  canUploadAttachments: boolean;
  canChangeStage: boolean;
  canExport: boolean;
  canViewAll: boolean;
  canManageAccess: boolean;
  organizationIds: string[];
};

export type ContractAction = "enter" | "createProject" | "editProject" | "manageContracts" | "uploadAttachments" | "changeStage" | "export" | "manageAccess";
type AccessDb = Pick<Prisma.TransactionClient, "account" | "contractAccessGrant">;

const denied = (organizationIds: string[] = []): ContractAccess => ({
  role: null,
  canEnter: false,
  canCreateProject: false,
  canEditProject: false,
  canManageContracts: false,
  canUploadAttachments: false,
  canChangeStage: false,
  canExport: false,
  canViewAll: false,
  canManageAccess: false,
  organizationIds,
});

export function decideContractAccess(facts: { accountActive: boolean; personActive: boolean; grant: GrantFacts | null; organizationIds: readonly string[] }): ContractAccess {
  const organizationIds = [...new Set(facts.organizationIds)].sort();
  if (!facts.accountActive || !facts.personActive || !facts.grant) return denied(organizationIds);
  const grant = facts.grant;
  const scoped = grant.canViewAll || organizationIds.length > 0;
  const admin = grant.role === "admin";
  const editor = grant.role === "editor";
  return {
    role: grant.role,
    canEnter: scoped,
    canCreateProject: scoped && (admin || editor && grant.canCreateProject),
    canEditProject: scoped && (admin || editor && grant.canEditProject),
    canManageContracts: scoped && (admin || editor && grant.canManageContracts),
    canUploadAttachments: scoped && (admin || editor && grant.canUploadAttachments),
    canChangeStage: scoped && (admin || editor && grant.canChangeStage),
    canExport: scoped && (admin || grant.canExport),
    canViewAll: grant.canViewAll,
    canManageAccess: admin || grant.canManageAccess,
    organizationIds,
  };
}

export function selectSingleContractGrant<T>(grants: readonly T[]): T | null {
  return grants.length === 1 ? grants[0]! : null;
}

export async function resolveContractAccess(principal: Pick<Principal, "accountId">, db: AccessDb = prisma): Promise<ContractAccess> {
  const account = await db.account.findUnique({
    where: { id: principal.accountId },
    select: {
      status: true,
      personId: true,
      person: {
        select: {
          status: true,
          organizations: { where: { active: true }, select: { organizationId: true } },
        },
      },
    },
  });
  if (!account?.personId) return denied();
  const grants = account.status === "active" && account.person?.status === "active"
    ? await db.contractAccessGrant.findMany({
        where: { personId: account.personId, active: true, revokedAt: null },
        select: {
          role: true,
          canCreateProject: true,
          canEditProject: true,
          canManageContracts: true,
          canUploadAttachments: true,
          canChangeStage: true,
          canExport: true,
          canViewAll: true,
          canManageAccess: true,
        },
      })
    : [];
  return decideContractAccess({
    accountActive: account.status === "active",
    personActive: account.person?.status === "active",
    grant: selectSingleContractGrant(grants),
    organizationIds: account.person?.organizations.map(({ organizationId }) => organizationId) ?? [],
  });
}

export function requireContractAccess(access: ContractAccess, action: ContractAction): void {
  const allowed = action === "enter" ? access.canEnter
    : action === "createProject" ? access.canCreateProject
    : action === "editProject" ? access.canEditProject
    : action === "manageContracts" ? access.canManageContracts
    : action === "uploadAttachments" ? access.canUploadAttachments
    : action === "changeStage" ? access.canChangeStage
    : action === "export" ? access.canExport
    : access.canManageAccess;
  if (!allowed) throw Object.assign(new Error("无项目与合同管理权限"), { statusCode: 403, code: "CONTRACT_FORBIDDEN" });
}

export function contractProjectWhere(access: ContractAccess): Prisma.ProjectWhereInput {
  requireContractAccess(access, "enter");
  return {
    contractStage: { not: null },
    ...(access.canViewAll ? {} : {
      OR: [
        { responsibleOrganizationId: { in: access.organizationIds } },
        { contractSubcontracts: { some: { owningOrganizationId: { in: access.organizationIds } } } },
      ],
    }),
  };
}

export async function assertContractProjectVisible(access: ContractAccess, projectId: string): Promise<void> {
  const found = await prisma.project.findFirst({ where: { id: projectId, ...contractProjectWhere(access) }, select: { id: true } });
  if (!found) throw Object.assign(new Error("项目不存在或无权访问"), { statusCode: 404, code: "CONTRACT_PROJECT_NOT_FOUND" });
}

export async function assertContractProjectWritable(
  access: ContractAccess,
  projectId: string,
  db: Pick<Prisma.TransactionClient, "project"> = prisma,
): Promise<void> {
  requireContractAccess(access, "enter");
  const found = await db.project.findFirst({
    where: {
      id: projectId,
      contractStage: { not: null },
      ...(access.canViewAll ? {} : { responsibleOrganizationId: { in: access.organizationIds } }),
    },
    select: { id: true },
  });
  if (!found) throw Object.assign(new Error("项目不存在或无权访问"), { statusCode: 404, code: "CONTRACT_PROJECT_NOT_FOUND" });
}
