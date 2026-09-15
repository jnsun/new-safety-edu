import { Prisma } from "@prisma/client";
import type { Principal } from "./auth.js";
import { prisma } from "./db.js";
import { canReadPrivateFile, type PrivateFileFacts } from "./private-file-policy.js";
import { resolveReceivablesAccess } from "./receivables-access.js";

const organizationIds = (person: { organizations: Array<{ organizationId: string }> }) => person.organizations.map((row) => row.organizationId);
const projectIds = (person: { projectMemberships: Array<{ projectId: string }> }) => person.projectMemberships.map((row) => row.projectId);
const linkedFileIds = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(linkedFileIds);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => /^(fileId|photoFileId|attachmentIds)$/i.test(key)
    ? (Array.isArray(item) ? item : [item]).filter((candidate): candidate is string => typeof candidate === "string")
    : linkedFileIds(item));
};
const stringValue = (value: unknown) => typeof value === "string" ? value : null;

export async function readablePrivateFile(principal: Principal, id: string) {
  const file = await prisma.privateFile.findUnique({ where: { id }, include: {
    personPhotos: { select: { id: true, organizations: { where: { active: true }, select: { organizationId: true } }, projectMemberships: { where: { status: "active" }, select: { projectId: true } } } },
    signatures: { select: { personId: true, person: { select: { organizations: { where: { active: true }, select: { organizationId: true } } } }, assignment: { select: { batch: { select: { projectId: true } } } } } },
    personCertificates: { select: { personId: true, person: { select: { organizations: { where: { active: true }, select: { organizationId: true } }, projectMemberships: { where: { status: "active" }, select: { projectId: true } } } } } },
    organizationQualifications: { select: { organizationId: true } },
    certificateAttachments: { select: { personCertificate: { select: { personId: true, person: { select: { organizations: { where: { active: true }, select: { organizationId: true } }, projectMemberships: { where: { status: "active" }, select: { projectId: true } } } } } }, organizationQualification: { select: { organizationId: true } } } },
    monthlyReportAttachments: { select: { report: { select: { projectId: true, reportingOrganizationId: true } } } },
    requestAttachments: { select: { changeRequest: { select: { accountId: true, personId: true, projectId: true, payload: true } } } },
    versions: { select: { courseware: { select: { scopeType: true, scopeId: true } }, progress: { select: { assignment: { select: { personId: true } } } } } },
    receivableAttachments: { select: { status: true, ledger: { select: { financeDepartmentId: true } } } },
  } });
  if (!file) throw Object.assign(new Error("文件不存在"), { statusCode: 404, code: "NOT_FOUND" });

  const batches = await prisma.trainingBatch.findMany({ where: { offlineDetail: { not: Prisma.DbNull } }, select: { projectId: true, offlineDetail: true, assignments: { select: { personId: true } } } });
  const trainingAttachments = batches.filter((row) => linkedFileIds(row.offlineDetail).includes(id)).map((row) => {
    const detail = row.offlineDetail as Record<string, unknown>;
    return { projectId: row.projectId, organizationId: stringValue(detail.organizationId), personIds: row.assignments.map(({ personId }) => personId) };
  });
  const requestAttachments = file.requestAttachments.map(({ changeRequest: row }) => {
    const payload = row.payload as Record<string, unknown>;
    return { accountId: row.accountId, personId: row.personId, projectId: row.projectId ?? stringValue(payload.projectId), organizationId: stringValue(payload.organizationId) ?? stringValue(payload.responsibleOrganizationId) };
  });
  const directCertificates = file.personCertificates.map((row) => ({ personId: row.personId, organizationIds: organizationIds(row.person), projectIds: projectIds(row.person) }));
  const attachedCertificates = file.certificateAttachments.flatMap((row) => row.personCertificate ? [{ personId: row.personCertificate.personId, organizationIds: organizationIds(row.personCertificate.person), projectIds: projectIds(row.personCertificate.person) }] : []);
  const facts: PrivateFileFacts = {
    uploadedBy: file.uploadedBy,
    linked: !!(file.personPhotos.length || file.signatures.length || directCertificates.length || attachedCertificates.length || file.organizationQualifications.length || file.certificateAttachments.length || file.monthlyReportAttachments.length || file.versions.length || trainingAttachments.length || requestAttachments.length),
    photos: file.personPhotos.map((row) => ({ personId: row.id, organizationIds: organizationIds(row), projectIds: projectIds(row) })),
    signatures: file.signatures.map((row) => ({ personId: row.personId, organizationIds: organizationIds(row.person), projectId: row.assignment.batch.projectId })),
    personCertificates: [...directCertificates, ...attachedCertificates],
    organizationQualifications: [...file.organizationQualifications, ...file.certificateAttachments.flatMap((row) => row.organizationQualification ? [{ organizationId: row.organizationQualification.organizationId }] : [])],
    monthlyReports: file.monthlyReportAttachments.map(({ report }) => ({ projectId: report.projectId, organizationId: report.reportingOrganizationId })),
    coursewares: file.versions.map((row) => ({ scopeType: row.courseware.scopeType, scopeId: row.courseware.scopeId, personIds: row.progress.map(({ assignment }) => assignment.personId) })),
    trainingAttachments,
    requestAttachments,
    receivableAttachments: file.receivableAttachments.map(({ status, ledger }) => ({ financeDepartmentId: ledger.financeDepartmentId, status })),
  };
  const receivablesAccess = facts.receivableAttachments.length ? await resolveReceivablesAccess(principal) : undefined;
  if (!canReadPrivateFile({ ...principal, ...(receivablesAccess ? { receivablesAccess } : {}) }, facts)) throw Object.assign(new Error("无权读取该私有文件"), { statusCode: 403, code: "SCOPE_FORBIDDEN" });
  return { storageKey: file.storageKey, originalName: file.originalName, mimeType: file.mimeType };
}
