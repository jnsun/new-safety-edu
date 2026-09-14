import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { auditCritical } from "../audit.js";
import { accessibleOrganizationIds, canAccessOrganization, canAccessPerson, forbidden, isCompanyAdmin } from "../access.js";
import { decryptField, encryptField } from "../crypto.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
const idParam = z.object({ id: z.string().uuid() });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((value) => new Date(`${value}T00:00:00.000Z`));
const optionalDate = z.union([date, z.literal("").transform(() => undefined)]).optional();
const certificateInput = z.object({
  name: z.string().trim().min(2).max(160), category: z.string().trim().max(80).optional(),
  certificateNo: z.string().trim().max(120).optional(), issuingAuthority: z.string().trim().max(160).optional(),
  issuedAt: optionalDate, expiresAt: optionalDate, fileId: z.string().uuid().optional()
});

function certificateNumber(row: { certificateNoCipher: string | null; certificateNoIv: string | null; certificateNoTag: string | null }, env: Env) {
  return row.certificateNoCipher && row.certificateNoIv && row.certificateNoTag
    ? decryptField(row.certificateNoCipher, row.certificateNoIv, row.certificateNoTag, env) : null;
}

function encryptedNumber(value: string | undefined, env: Env) {
  if (!value) return {};
  const encrypted = encryptField(value, env);
  return { certificateNoCipher: encrypted.cipher, certificateNoIv: encrypted.iv, certificateNoTag: encrypted.tag, certificateNoLast4: value.slice(-4) };
}

const certificateFields = (input: z.infer<typeof certificateInput>) => ({
  name: input.name, category: input.category ?? null, issuingAuthority: input.issuingAuthority ?? null,
  issuedAt: input.issuedAt ?? null, expiresAt: input.expiresAt ?? null, fileId: input.fileId ?? null
});

export async function registerSafetyManagementRoutes(app: FastifyInstance, deps: { env: Env; authenticate: Guard; requireManager: Guard }) {
  app.get("/api/me/certificates", { preHandler: deps.authenticate }, async (request) => {
    if (!request.principal!.personId) return { data: [] };
    const rows = await prisma.personCertificate.findMany({ where: { personId: request.principal!.personId, active: true }, orderBy: [{ expiresAt: "asc" }, { name: "asc" }] });
    return { data: rows.map((row) => ({ ...row, certificateNo: certificateNumber(row, deps.env), certificateNoCipher: undefined, certificateNoIv: undefined, certificateNoTag: undefined })) };
  });

  app.get("/api/persons/:id/details", { preHandler: [deps.authenticate, deps.requireManager] }, async (request) => {
    const { id } = idParam.parse(request.params); const principal = request.principal!;
    if (!await canAccessPerson(principal, id)) forbidden();
    const person = await prisma.person.findUniqueOrThrow({ where: { id }, include: {
      organizations: { where: { active: true }, include: { organization: true } },
      projectMemberships: { where: { status: "active" }, include: { project: { select: { id: true, name: true, code: true, status: true } } } },
      certificates: { where: { active: true }, orderBy: { expiresAt: "asc" } },
      assignments: { orderBy: { createdAt: "desc" }, take: 20, include: { batch: { select: { name: true, type: true } }, attempts: { where: { status: "submitted" }, orderBy: { submittedAt: "desc" }, take: 1 } } }
    } });
    await auditCritical(principal.accountId, "person.detail_read", "person", id, undefined, "var/audit-fallback.ndjson");
    return { data: { ...person, nationalIdCipher: undefined, nationalIdIv: undefined, nationalIdTag: undefined,
      certificates: person.certificates.map((row) => ({ ...row, certificateNo: certificateNumber(row, deps.env), certificateNoCipher: undefined, certificateNoIv: undefined, certificateNoTag: undefined })) } };
  });

  app.post("/api/persons/:id/certificates", { preHandler: [deps.authenticate, deps.requireManager] }, async (request, reply) => {
    const { id } = idParam.parse(request.params); const principal = request.principal!; const input = certificateInput.parse(request.body);
    if (!isCompanyAdmin(principal)) forbidden("仅公司管理员可以维护资质证照");
    if (!await canAccessPerson(principal, id)) forbidden();
    const row = await prisma.personCertificate.create({ data: { personId: id, ...certificateFields(input), ...encryptedNumber(input.certificateNo, deps.env) } });
    await auditCritical(principal.accountId, "person_certificate.create", "person_certificate", row.id, { personId: id }, "var/audit-fallback.ndjson");
    return reply.code(201).send({ data: { id: row.id } });
  });

  app.patch("/api/person-certificates/:id/retire", { preHandler: [deps.authenticate, deps.requireManager] }, async (request) => {
    if (!isCompanyAdmin(request.principal!)) forbidden("仅公司管理员可以维护资质证照");
    const { id } = idParam.parse(request.params); const row = await prisma.personCertificate.findUniqueOrThrow({ where: { id }, select: { personId: true } });
    if (!await canAccessPerson(request.principal!, row.personId)) forbidden();
    await prisma.personCertificate.update({ where: { id }, data: { active: false, status: "revoked" } });
    await auditCritical(request.principal!.accountId, "person_certificate.retire", "person_certificate", id, undefined, "var/audit-fallback.ndjson");
    return { data: { id, active: false } };
  });

  app.get("/api/organization-qualifications", { preHandler: [deps.authenticate, deps.requireManager] }, async (request) => {
    const ids = isCompanyAdmin(request.principal!) ? undefined : await accessibleOrganizationIds(request.principal!);
    const rows = await prisma.organizationQualification.findMany({ where: { active: true, ...(ids ? { organizationId: { in: ids } } : {}) }, include: { organization: { select: { id: true, name: true } } }, orderBy: { expiresAt: "asc" } });
    return { data: rows.map((row) => ({ ...row, certificateNo: certificateNumber(row, deps.env), certificateNoCipher: undefined, certificateNoIv: undefined, certificateNoTag: undefined })) };
  });

  app.post("/api/organizations/:id/qualifications", { preHandler: [deps.authenticate, deps.requireManager] }, async (request, reply) => {
    const { id } = idParam.parse(request.params); const principal = request.principal!;
    if (!isCompanyAdmin(principal)) forbidden("仅公司管理员可以维护资质证照");
    if (!await canAccessOrganization(principal, id)) forbidden();
    const input = certificateInput.extend({ scope: z.string().trim().max(5000).optional() }).parse(request.body);
    const row = await prisma.organizationQualification.create({ data: { organizationId: id, ...certificateFields(input), scope: input.scope ?? null, ...encryptedNumber(input.certificateNo, deps.env) } });
    await auditCritical(principal.accountId, "organization_qualification.create", "organization_qualification", row.id, { organizationId: id }, "var/audit-fallback.ndjson");
    return reply.code(201).send({ data: { id: row.id } });
  });

  app.patch("/api/organization-qualifications/:id/retire", { preHandler: [deps.authenticate, deps.requireManager] }, async (request) => {
    if (!isCompanyAdmin(request.principal!)) forbidden("仅公司管理员可以维护资质证照");
    const { id } = idParam.parse(request.params); const row = await prisma.organizationQualification.findUniqueOrThrow({ where: { id }, select: { organizationId: true } });
    if (!await canAccessOrganization(request.principal!, row.organizationId)) forbidden();
    await prisma.organizationQualification.update({ where: { id }, data: { active: false, status: "revoked" } });
    await auditCritical(request.principal!.accountId, "organization_qualification.retire", "organization_qualification", id, undefined, "var/audit-fallback.ndjson");
    return { data: { id, active: false } };
  });

}
