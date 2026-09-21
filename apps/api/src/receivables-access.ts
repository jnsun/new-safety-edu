import type { Prisma, ReceivableGrantRole } from "@prisma/client";
import { prisma } from "./db.js";
import type { Principal } from "./auth.js";
import type { ReceivablesActorCapabilities } from "./receivables-core.js";

export type ReceivablesAccessState = "unconfigured" | "pending_owner" | "pending_confirmation" | "ready";
export type ReceivablesRole = "owner" | ReceivableGrantRole | null;

type DepartmentScope = { departmentId: string; canRead: boolean; canWrite: boolean };
type GrantFacts = {
  role: ReceivableGrantRole;
  canCreate?: boolean;
  canEditBaseInfo?: boolean;
  canExport?: boolean;
  canViewAll?: boolean;
  canMaintainCollection?: boolean;
  canUploadAttachments?: boolean;
  editableFields?: readonly string[];
  globalEditableFields?: readonly string[];
  departments?: readonly DepartmentScope[];
};

export type ReceivablesAccessFacts = {
  accountActive: boolean;
  personActive: boolean;
  isCompanyAdmin?: boolean;
  configured?: boolean;
  configurationConfirmed?: boolean;
  hasBoundOrgLeader?: boolean;
  isBoundOrgLeader?: boolean;
  grant: GrantFacts | null;
};

export type ReceivablesAccess = ReceivablesActorCapabilities & {
  state: ReceivablesAccessState;
  role: ReceivablesRole;
  canEnter: boolean;
  canReadLedger: boolean;
  canWriteLedger: boolean;
  canManageMoney: boolean;
  canManageConfiguration: boolean;
  canManageAccess: boolean;
  canImport: boolean;
  canExport: boolean;
  canViewAll: boolean;
  canMaintainCollection: boolean;
  canEditBaseInfo: boolean;
  canUploadAttachments: boolean;
  editableFields: string[];
  canConfirmSetup: boolean;
  canRecover: boolean;
  readDepartmentIds: string[];
  writeDepartmentIds: string[];
};

export type ReceivablesAction =
  | "enter"
  | "read"
  | "write"
  | "create"
  | "manageMoney"
  | "manageConfiguration"
  | "manageAccess"
  | "import"
  | "export"
  | "confirmSetup"
  | "recover";

type AccessDb = Pick<Prisma.TransactionClient, "account" | "organization" | "receivableSetting" | "roleAssignment" | "receivableAccessGrant">;

export const receivablesFinanceOrganizationName = "财务资产部";

export function selectReceivablesFinanceOrganization<T extends { id: string; type: string }>(organizations: readonly T[]): T | null {
  return organizations.length === 1 && organizations[0]!.type === "department" ? organizations[0]! : null;
}

export function selectSingleReceivablesGrant<T>(grants: readonly T[]): T | null {
  return grants.length === 1 ? grants[0]! : null;
}

const emptyAccess = (state: ReceivablesAccessState, canRecover: boolean): ReceivablesAccess => ({
  state,
  role: null,
  canEnter: false,
  canReadLedger: false,
  canWriteLedger: false,
  canManageAll: false,
  canCreateLedger: false,
  canManageMoney: false,
  canManageConfiguration: false,
  canManageAccess: false,
  canImport: false,
  canExport: false,
  canViewAll: false,
  canMaintainCollection: false,
  canEditBaseInfo: false,
  canUploadAttachments: false,
  editableFields: [],
  canConfirmSetup: false,
  canRecover,
  readDepartmentIds: [],
  writeDepartmentIds: [],
});

export function decideReceivablesAccess(facts: ReceivablesAccessFacts): ReceivablesAccess {
  const configured = facts.configured ?? true;
  const hasBoundOrgLeader = facts.hasBoundOrgLeader ?? configured;
  const configurationConfirmed = facts.configurationConfirmed ?? true;
  const activeIdentity = facts.accountActive && facts.personActive;
  const state: ReceivablesAccessState = !configured
    ? "unconfigured"
    : !hasBoundOrgLeader
      ? "pending_owner"
      : !configurationConfirmed
        ? "pending_confirmation"
        : "ready";
  const canRecover = activeIdentity && !!facts.isCompanyAdmin && state !== "ready";
  const denied = emptyAccess(state, canRecover);

  if (!activeIdentity) return denied;
  if (facts.isBoundOrgLeader && state === "pending_confirmation") {
    return { ...denied, role: "owner", canManageConfiguration: true, canConfirmSetup: true };
  }
  if (state !== "ready") return denied;

  if (facts.isBoundOrgLeader) {
    return {
      ...denied,
      role: "owner",
      canEnter: true,
      canReadLedger: true,
      canWriteLedger: true,
      canManageAll: true,
      canCreateLedger: true,
      canManageMoney: true,
      canManageConfiguration: true,
      canManageAccess: true,
      canImport: true,
      canExport: true,
      canViewAll: true,
      canMaintainCollection: true,
      canEditBaseInfo: true,
      canUploadAttachments: true,
      editableFields: [],
    };
  }

  const grant = facts.grant;
  if (!grant) return denied;
  const scopes = grant.departments ?? [];
  const readDepartmentIds = [...new Set(scopes.filter(({ canRead }) => canRead).map(({ departmentId }) => departmentId))].sort();
  const writeDepartmentIds = grant.role === "readonly"
    ? []
    : [...new Set(scopes.filter(({ canWrite }) => canWrite).map(({ departmentId }) => departmentId))].sort();

  if (grant.role === "admin") {
    return {
      ...denied,
      role: "admin",
      canEnter: true,
      canReadLedger: true,
      canWriteLedger: true,
      canManageAll: true,
      canCreateLedger: true,
      canManageMoney: true,
      canManageConfiguration: true,
      canManageAccess: true,
      canImport: true,
      canExport: true,
      canViewAll: true,
      canMaintainCollection: true,
      canEditBaseInfo: true,
      canUploadAttachments: true,
      editableFields: [],
      readDepartmentIds,
      writeDepartmentIds,
    };
  }

  const canViewAll = !!grant.canViewAll;
  const canReadLedger = canViewAll || readDepartmentIds.length > 0;
  const canWriteLedger = grant.role === "reporter" && writeDepartmentIds.length > 0;
  const globalEditableFields = new Set(grant.globalEditableFields ?? []);
  const editableFields = grant.role === "reporter"
    ? [...new Set((grant.editableFields ?? []).filter((field) => globalEditableFields.has(field)))].sort()
    : [];
  return {
    ...denied,
    role: grant.role,
    canEnter: canReadLedger,
    canReadLedger,
    canWriteLedger,
    canCreateLedger: grant.role === "reporter" && !!grant.canCreate && canWriteLedger,
    canExport: !!grant.canExport && canReadLedger,
    canViewAll,
    canMaintainCollection: grant.role === "reporter" && !!grant.canMaintainCollection,
    canEditBaseInfo: grant.role === "reporter" && !!grant.canEditBaseInfo,
    canUploadAttachments: grant.role === "reporter" && !!grant.canUploadAttachments,
    editableFields,
    readDepartmentIds,
    writeDepartmentIds,
  };
}

export function assertReceivablesFinanceOrganization(organization: { type: string } | null): asserts organization is { type: "department" } {
  if (!organization || organization.type !== "department") {
    throw Object.assign(new Error("应收账款主管组织必须是现有部门"), { statusCode: 409, code: "RECEIVABLES_FINANCE_ORGANIZATION_INVALID" });
  }
}

export async function resolveReceivablesAccess(principal: Pick<Principal, "accountId"> & Partial<Pick<Principal, "roles">>, db: AccessDb = prisma): Promise<ReceivablesAccess> {
  const [account, setting] = await Promise.all([
    db.account.findUnique({
      where: { id: principal.accountId },
      select: {
        status: true,
        personId: true,
        person: {
          select: {
            status: true,
          },
        },
      },
    }),
    db.receivableSetting.findUnique({
      where: { id: 1 },
      select: { financeOrganizationId: true, configurationConfirmedAt: true, reporterEditableFields: true, financeOrganization: { select: { type: true } } },
    }),
  ]);
  const accountActive = account?.status === "active";
  const personActive = !!account?.personId && account.person?.status === "active";
  const isCompanyAdmin = principal.roles
    ? principal.roles.some(({ role }) => role === "company_admin")
    : !!(accountActive && await db.roleAssignment.findFirst({
        where: {
          role: "company_admin",
          scopeType: "company",
          active: true,
          OR: [{ accountId: principal.accountId }, ...(account?.personId ? [{ personId: account.personId }] : [])],
        },
        select: { id: true },
      }));
  const financeOrganizationId = setting?.financeOrganizationId ?? null;
  const configured = !!financeOrganizationId && setting?.financeOrganization?.type === "department";
  const [leaderRoles, grants] = await Promise.all([
    configured
      ? db.roleAssignment.findMany({
          where: {
            role: "org_leader",
            scopeType: "organization",
            scopeId: financeOrganizationId!,
            active: true,
            activationPending: false,
            personId: { not: null },
            person: { status: "active", account: { status: "active" } },
          },
          select: { personId: true, person: { select: { account: { select: { id: true } } } } },
        })
      : Promise.resolve([]),
    accountActive && personActive
      ? db.receivableAccessGrant.findMany({
          where: { personId: account!.personId!, active: true, revokedAt: null },
          select: {
            role: true,
            canCreate: true,
            canEditBaseInfo: true,
            canExport: true,
            canViewAll: true,
            canMaintainCollection: true,
            canUploadAttachments: true,
            editableFields: true,
            departments: { select: { financeDepartmentId: true, canRead: true, canWrite: true } },
          },
        })
      : Promise.resolve([]),
  ]);
  const leaderPersonIds = [...new Set(leaderRoles.map(({ personId }) => personId).filter((value): value is string => !!value))];
  const activeGrant = selectSingleReceivablesGrant(grants);
  const grant = activeGrant ? {
    ...activeGrant,
    globalEditableFields: setting?.reporterEditableFields ?? [],
    departments: activeGrant.departments
      .map(({ financeDepartmentId, canRead, canWrite }) => ({ departmentId: financeDepartmentId, canRead, canWrite })),
  } : null;

  return decideReceivablesAccess({
    accountActive,
    personActive,
    isCompanyAdmin,
    configured,
    configurationConfirmed: !!setting?.configurationConfirmedAt,
    hasBoundOrgLeader: leaderPersonIds.length === 1,
    isBoundOrgLeader: leaderPersonIds.length === 1 && leaderPersonIds[0] === account?.personId,
    grant,
  });
}

export function requireReceivables(access: ReceivablesAccess, action: ReceivablesAction, departmentId?: string): void {
  const scopedRead = !departmentId || access.canManageAll || access.canViewAll || access.readDepartmentIds.includes(departmentId);
  const scopedWrite = !departmentId || access.canManageAll || access.writeDepartmentIds.includes(departmentId);
  const allowed = {
    enter: access.canEnter,
    read: access.canReadLedger && scopedRead,
    write: access.canWriteLedger && scopedWrite,
    create: access.canCreateLedger && scopedWrite,
    manageMoney: access.canManageMoney && scopedWrite,
    manageConfiguration: access.canManageConfiguration,
    manageAccess: access.canManageAccess,
    import: access.canImport,
    export: access.canExport && scopedRead,
    confirmSetup: access.canConfirmSetup,
    recover: access.canRecover,
  }[action];
  if (!allowed) throw Object.assign(new Error("无应收账款操作权限"), { statusCode: 403, code: "RECEIVABLES_FORBIDDEN" });
}
