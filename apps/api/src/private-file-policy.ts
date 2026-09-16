type Role = { role: string; scopeType: string; scopeId: string | null };
type Reader = { accountId: string; personId: string | null; roles: Role[]; receivablesAccess?: { role: "owner" | "admin" | "reporter" | "readonly" | null; canReadLedger: boolean; canViewAll: boolean; readDepartmentIds: string[] } };
type PersonScope = { personId: string; organizationIds: string[] };

export type PrivateFileFacts = {
  uploadedBy: string;
  linked: boolean;
  photos: Array<PersonScope & { projectIds: string[] }>;
  signatures: Array<PersonScope & { projectId: string | null }>;
  personCertificates: Array<PersonScope & { projectIds: string[] }>;
  organizationQualifications: Array<{ organizationId: string }>;
  monthlyReports: Array<{ projectId: string; organizationId: string }>;
  coursewares: Array<{ scopeType: string; scopeId: string | null; personIds: string[] }>;
  trainingAttachments: Array<{ projectId: string | null; organizationId: string | null; personIds: string[] }>;
  requestAttachments: Array<{ accountId: string | null; personId: string | null; organizationId: string | null; projectId: string | null }>;
  receivableAttachments: Array<{ financeDepartmentId: string; status: "active" | "voided" }>;
  receivableImportBatches: Array<Record<string, never>>;
};

export function canReadPrivateFile(reader: Reader, facts: PrivateFileFacts) {
  if (facts.receivableImportBatches.length) return !!reader.receivablesAccess?.canReadLedger && (reader.receivablesAccess.role === "owner" || reader.receivablesAccess.role === "admin");
  if (facts.receivableAttachments.length) {
    const access = reader.receivablesAccess;
    if (!access?.canReadLedger) return false;
    return facts.receivableAttachments.every(({ financeDepartmentId, status }) => status === "voided"
      ? access.role === "owner" || access.role === "admin"
      : (access.role === "owner" || access.role === "admin" || access.canViewAll || access.canReadLedger && access.readDepartmentIds.includes(financeDepartmentId)));
  }
  if (reader.roles.some(({ role }) => role === "company_admin")) return true;
  if (!facts.linked) return facts.uploadedBy === reader.accountId;
  const organizationIds = new Set(reader.roles.filter(({ role, scopeType, scopeId }) => ["org_leader", "org_admin"].includes(role) && scopeType === "organization" && scopeId).map(({ scopeId }) => scopeId!));
  const projectIds = new Set(reader.roles.filter(({ role, scopeType, scopeId }) => role === "project_admin" && scopeType === "project" && scopeId).map(({ scopeId }) => scopeId!));
  const self = (personId: string) => reader.personId === personId;
  const organization = (ids: string[]) => ids.some((id) => organizationIds.has(id));
  if (facts.photos.some((row) => self(row.personId) || organization(row.organizationIds) || row.projectIds.some((id) => projectIds.has(id)))) return true;
  if (facts.signatures.some((row) => self(row.personId) || organization(row.organizationIds) || !!row.projectId && projectIds.has(row.projectId))) return true;
  if (facts.personCertificates.some((row) => self(row.personId) || organization(row.organizationIds) || row.projectIds.some((id) => projectIds.has(id)))) return true;
  if (facts.organizationQualifications.some((row) => organizationIds.has(row.organizationId))) return true;
  if (facts.monthlyReports.some((row) => projectIds.has(row.projectId) || organizationIds.has(row.organizationId))) return true;
  if (facts.coursewares.some((row) => !!reader.personId && row.personIds.includes(reader.personId) || row.scopeType === "organization" && !!row.scopeId && organizationIds.has(row.scopeId) || row.scopeType === "project" && !!row.scopeId && projectIds.has(row.scopeId))) return true;
  if (facts.trainingAttachments.some((row) => !!reader.personId && row.personIds.includes(reader.personId) || !!row.projectId && projectIds.has(row.projectId) || !!row.organizationId && organizationIds.has(row.organizationId))) return true;
  return facts.requestAttachments.some((row) => row.accountId === reader.accountId || !!reader.personId && row.personId === reader.personId || !!row.projectId && projectIds.has(row.projectId) || !!row.organizationId && organizationIds.has(row.organizationId));
}
