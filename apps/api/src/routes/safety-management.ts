import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { auditCritical } from "../audit.js";
import {
  accessibleOrganizationIds,
  canAccessOrganization,
  canAccessPerson,
  forbidden,
  isCompanyAdmin,
} from "../access.js";
import { decryptField } from "../crypto.js";
import { verifySensitiveToken } from "../auth.js";
import { writeCriticalAudit } from "../transaction-audit.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
const idParam = z.object({ id: z.string().uuid() });

function certificateNumber(
  row: {
    certificateNoCipher: string | null;
    certificateNoIv: string | null;
    certificateNoTag: string | null;
  },
  env: Env,
) {
  return row.certificateNoCipher && row.certificateNoIv && row.certificateNoTag
    ? decryptField(
        row.certificateNoCipher,
        row.certificateNoIv,
        row.certificateNoTag,
        env,
      )
    : null;
}

const maskedCertificateNumber = (row: { certificateNoLast4: string | null }) =>
  row.certificateNoLast4 ? `********${row.certificateNoLast4}` : null;

export async function registerSafetyManagementRoutes(
  app: FastifyInstance,
  deps: { env: Env; authenticate: Guard; requireManager: Guard },
) {
  app.get(
    "/api/me/certificates",
    { preHandler: deps.authenticate },
    async (request) => {
      if (!request.principal!.personId) return { data: [] };
      const rows = await prisma.personCertificate.findMany({
        where: { personId: request.principal!.personId, status: "active" },
        include: {
          type: { select: { name: true, requiresAnnualTraining: true } },
          annualTrainingStatuses: { orderBy: { year: "desc" } },
        },
        orderBy: [{ expiresAt: "asc" }, { name: "asc" }],
      });
      return {
        data: rows.map((row) => ({
          ...row,
          certificateNo: maskedCertificateNumber(row),
          certificateNoCipher: undefined,
          certificateNoIv: undefined,
          certificateNoTag: undefined,
        })),
      };
    },
  );

  app.get(
    "/api/persons/:id/details",
    { preHandler: [deps.authenticate, deps.requireManager] },
    async (request) => {
      const { id } = idParam.parse(request.params);
      const principal = request.principal!;
      if (!(await canAccessPerson(principal, id))) forbidden();
      const person = await prisma.person.findUniqueOrThrow({
        where: { id },
        include: {
          account: {
            select: {
              id: true,
              username: true,
              verifiedPhone: true,
              status: true,
              wechatBindings: {
                select: {
                  id: true,
                  appId: true,
                  active: true,
                  boundAt: true,
                  createdAt: true,
                },
              },
            },
          },
          roleAssignments: { orderBy: { createdAt: "desc" } },
          changeRequests: { orderBy: { createdAt: "desc" }, take: 100, select: { id: true, type: true, status: true, reviewNote: true, reviewedAt: true, createdAt: true } },
          photoHistory: { orderBy: { createdAt: "desc" }, include: { file: { select: { id: true, originalName: true, mimeType: true, size: true } } } },
          organizations: {
            include: { organization: true },
            orderBy: { createdAt: "desc" },
          },
          projectMemberships: {
            include: {
              project: {
                select: { id: true, name: true, code: true, status: true },
              },
            },
            orderBy: { createdAt: "desc" },
          },
          certificates: { orderBy: { createdAt: "desc" } },
          assignments: {
            orderBy: { createdAt: "desc" },
            take: 20,
            include: {
              batch: { select: { name: true, type: true } },
              attempts: {
                where: { status: "submitted" },
                orderBy: { submittedAt: "desc" },
                take: 1,
              },
            },
          },
        },
      });
      const accountId = person.account?.id;
      const timeline = await prisma.auditLog.findMany({ where: { OR: [{ objectType: "person", objectId: id }, ...(accountId ? [{ objectType: "account", objectId: accountId }] : []), { metadata: { path: ["personId"], equals: id } }] }, select: { id: true, action: true, objectType: true, objectId: true, result: true, metadata: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 200 });
      await auditCritical(
        principal.accountId,
        "person.detail_read",
        "person",
        id,
        undefined,
        "var/audit-fallback.ndjson",
      );
      return {
        data: {
          ...person,
          nationalIdCipher: undefined,
          nationalIdIv: undefined,
          nationalIdTag: undefined,
          certificates: person.certificates.map((row) => ({
            ...row,
            certificateNo: maskedCertificateNumber(row),
            certificateNoCipher: undefined,
            certificateNoIv: undefined,
            certificateNoTag: undefined,
          })),
          timeline,
        },
      };
    },
  );

  app.get(
    "/api/person-certificates/:id/sensitive",
    { preHandler: deps.authenticate },
    async (request) => {
      const { id } = idParam.parse(request.params);
      const principal = request.principal!;
      const row = await prisma.personCertificate.findUniqueOrThrow({
        where: { id },
        select: {
          personId: true,
          certificateNoCipher: true,
          certificateNoIv: true,
          certificateNoTag: true,
        },
      });
      if (principal.personId !== row.personId && !isCompanyAdmin(principal)) {
        const organizationIds = await accessibleOrganizationIds(principal);
        if (
          !organizationIds.length ||
          !(await prisma.organizationMembership.findFirst({
            where: {
              personId: row.personId,
              active: true,
              organizationId: { in: organizationIds },
            },
            select: { id: true },
          }))
        )
          forbidden();
      }
      await verifySensitiveToken(request, deps.env);
      const certificateNo = certificateNumber(row, deps.env);
      if (!certificateNo)
        throw Object.assign(new Error("该证照尚未填写编号"), {
          statusCode: 404,
          code: "CERTIFICATE_NUMBER_MISSING",
        });
      await auditCritical(
        principal.accountId,
        "person_certificate.sensitive_read",
        "person_certificate",
        id,
        undefined,
        "var/audit-fallback.ndjson",
      );
      return { data: { certificateNo } };
    },
  );

  app.post(
    "/api/persons/:id/certificates",
    { preHandler: [deps.authenticate, deps.requireManager] },
    async (request, reply) => {
      idParam.parse(request.params);
      return reply
        .code(410)
        .send({
          error: {
            code: "LEGACY_CERTIFICATE_WRITE_DISABLED",
            message: "请在资质证照管理模块按证照类型统一维护",
          },
        });
    },
  );

  app.patch(
    "/api/person-certificates/:id/retire",
    { preHandler: [deps.authenticate, deps.requireManager] },
    async (request) => {
      if (!isCompanyAdmin(request.principal!))
        forbidden("仅公司管理员可以维护资质证照");
      const { id } = idParam.parse(request.params);
      const row = await prisma.personCertificate.findUniqueOrThrow({
        where: { id },
        select: { personId: true },
      });
      if (!(await canAccessPerson(request.principal!, row.personId)))
        forbidden();
      await prisma.$transaction(async (tx) => { await tx.personCertificate.update({ where: { id }, data: { active: false, status: "revoked" } }); await writeCriticalAudit(tx, { actorId: request.principal!.accountId, action: "person_certificate.retire", objectType: "person_certificate", objectId: id }); });
      return { data: { id, active: false } };
    },
  );

  app.get(
    "/api/organization-qualifications",
    { preHandler: [deps.authenticate, deps.requireManager] },
    async (request) => {
      const ids = isCompanyAdmin(request.principal!)
        ? undefined
        : await accessibleOrganizationIds(request.principal!);
      const rows = await prisma.organizationQualification.findMany({
        where: {
          active: true,
          ...(ids ? { organizationId: { in: ids } } : {}),
        },
        include: { organization: { select: { id: true, name: true } } },
        orderBy: { expiresAt: "asc" },
      });
      return {
        data: rows.map((row) => ({
          ...row,
          certificateNo: maskedCertificateNumber(row),
          certificateNoCipher: undefined,
          certificateNoIv: undefined,
          certificateNoTag: undefined,
        })),
      };
    },
  );

  app.get(
    "/api/organization-qualifications/:id/sensitive",
    { preHandler: [deps.authenticate, deps.requireManager] },
    async (request) => {
      const { id } = idParam.parse(request.params);
      const principal = request.principal!;
      const row = await prisma.organizationQualification.findUniqueOrThrow({
        where: { id },
        select: {
          organizationId: true,
          certificateNoCipher: true,
          certificateNoIv: true,
          certificateNoTag: true,
        },
      });
      if (!(await canAccessOrganization(principal, row.organizationId)))
        forbidden();
      await verifySensitiveToken(request, deps.env);
      const certificateNo = certificateNumber(row, deps.env);
      if (!certificateNo)
        throw Object.assign(new Error("该资质尚未填写编号"), {
          statusCode: 404,
          code: "CERTIFICATE_NUMBER_MISSING",
        });
      await auditCritical(
        principal.accountId,
        "organization_qualification.sensitive_read",
        "organization_qualification",
        id,
        undefined,
        "var/audit-fallback.ndjson",
      );
      return { data: { certificateNo } };
    },
  );

  app.post(
    "/api/organizations/:id/qualifications",
    { preHandler: [deps.authenticate, deps.requireManager] },
    async (request, reply) => {
      idParam.parse(request.params);
      return reply
        .code(410)
        .send({
          error: {
            code: "LEGACY_CERTIFICATE_WRITE_DISABLED",
            message: "请在资质证照管理模块按证照类型统一维护",
          },
        });
    },
  );

  app.patch(
    "/api/organization-qualifications/:id/retire",
    { preHandler: [deps.authenticate, deps.requireManager] },
    async (request) => {
      if (!isCompanyAdmin(request.principal!))
        forbidden("仅公司管理员可以维护资质证照");
      const { id } = idParam.parse(request.params);
      const row = await prisma.organizationQualification.findUniqueOrThrow({
        where: { id },
        select: { organizationId: true },
      });
      if (
        !(await canAccessOrganization(request.principal!, row.organizationId))
      )
        forbidden();
      await prisma.$transaction(async (tx) => { await tx.organizationQualification.update({ where: { id }, data: { active: false, status: "revoked" } }); await writeCriticalAudit(tx, { actorId: request.principal!.accountId, action: "organization_qualification.retire", objectType: "organization_qualification", objectId: id }); });
      return { data: { id, active: false } };
    },
  );
}
