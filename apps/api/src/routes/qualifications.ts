import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { auditCritical } from "../audit.js";
import { accessibleOrganizationIds, canAccessProject, forbidden, isCompanyAdmin } from "../access.js";
import { encryptField } from "../crypto.js";
import { parseQualificationWorkbook, type QualificationImportRow } from "../qualification-import.js";

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
const DAY = 86_400_000;
const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((value) => new Date(`${value}T00:00:00.000Z`));
const optionalDate = z.union([date, z.literal("").transform(() => undefined)]).optional();
const options = z.array(z.string().trim().min(1).max(120)).max(50).default([]);
const typeInput = z.object({
  name: z.string().trim().min(2).max(160), category: z.enum(["company", "personal"]),
  subtype1Label: z.string().trim().max(80).optional(), subtype1Options: options,
  subtype2Label: z.string().trim().max(80).optional(), subtype2Options: options,
  requiresAnnualTraining: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0), active: z.boolean().default(true)
}).superRefine((value, ctx) => {
  if (!!value.subtype1Label !== !!value.subtype1Options.length) ctx.addIssue({ code: "custom", path: ["subtype1Label"], message: "子分类1名称与选项必须同时填写" });
  if (!!value.subtype2Label !== !!value.subtype2Options.length) ctx.addIssue({ code: "custom", path: ["subtype2Label"], message: "子分类2名称与选项必须同时填写" });
});
const certificateInput = z.object({
  category: z.enum(["company", "personal"]), ownerId: id, typeId: id, name: z.string().trim().min(2).max(160),
  subtype1Value: z.string().trim().max(120).optional(), subtype2Value: z.string().trim().max(120).optional(),
  certificateNo: z.string().trim().max(120).optional(), issuingAuthority: z.string().trim().max(160).optional(),
  issuedAt: optionalDate, validFrom: optionalDate, expiresAt: optionalDate, isLongTerm: z.boolean().default(false),
  holderPosition: z.string().trim().max(120).optional(), trainingStatus: z.enum(["trained", "not_required", "pending"]).optional(),
  scope: z.string().trim().max(5000).optional(), remark: z.string().trim().max(2000).optional(), fileIds: z.array(id).max(20).default([])
}).superRefine((value, ctx) => {
  if (!value.isLongTerm && !value.expiresAt) ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "非长期证照必须填写到期日期" });
  if (value.validFrom && value.expiresAt && value.validFrom > value.expiresAt) ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "到期日期不能早于有效期开始日期" });
});

function requireCompanyAdmin(request: FastifyRequest) {
  if (!isCompanyAdmin(request.principal!)) forbidden("仅公司管理员可以维护资质证照");
}
function numberFields(value: string | undefined, env: Env) {
  if (!value) return { certificateNoCipher: null, certificateNoIv: null, certificateNoTag: null, certificateNoLast4: null };
  const encrypted = encryptField(value, env);
  return { certificateNoCipher: encrypted.cipher, certificateNoIv: encrypted.iv, certificateNoTag: encrypted.tag, certificateNoLast4: value.slice(-4) };
}
const numberOf = (row: { certificateNoLast4: string | null }) => row.certificateNoLast4 ? `********${row.certificateNoLast4}` : null;
const trainingDefault = (requiresAnnualTraining: boolean) => requiresAnnualTraining ? "pending" as const : "not_required" as const;
async function validateType(input: z.infer<typeof certificateInput>) {
  const type = await prisma.certificateType.findUniqueOrThrow({ where: { id: input.typeId } });
  if (!type.active || type.category !== input.category) throw Object.assign(new Error("证照类型与大类不匹配"), { statusCode: 400, code: "TYPE_MISMATCH" });
  const one = type.subtype1Options as string[]; const two = type.subtype2Options as string[];
  if (one.length && !one.includes(input.subtype1Value ?? "")) throw Object.assign(new Error(`${type.subtype1Label}必须从类型字典中选择`), { statusCode: 400, code: "INVALID_SUBTYPE" });
  if (two.length && !two.includes(input.subtype2Value ?? "")) throw Object.assign(new Error(`${type.subtype2Label}必须从类型字典中选择`), { statusCode: 400, code: "INVALID_SUBTYPE" });
  return type;
}
async function readableOrgIds(request: FastifyRequest) {
  return isCompanyAdmin(request.principal!) ? undefined : await accessibleOrganizationIds(request.principal!);
}
const dateText = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

export async function registerQualificationRoutes(app: FastifyInstance, deps: { env: Env; authenticate: Guard }) {
  app.get("/api/projects/:id/certificate-summary", { preHandler: deps.authenticate }, async (request) => { const projectId = id.parse((request.params as { id: string }).id); if (!await canAccessProject(request.principal!, projectId)) forbidden(); return { data: await prisma.personCertificate.findMany({ where: { person: { projectMemberships: { some: { projectId, status: "active" } } } }, select: { id: true, name: true, status: true, expiresAt: true, isLongTerm: true, person: { select: { id: true, name: true } }, type: { select: { name: true } } }, orderBy: { createdAt: "desc" } }) } });
  app.get("/api/certificate-types", { preHandler: deps.authenticate }, async () => ({ data: await prisma.certificateType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }) }));
  app.post("/api/certificate-types", { preHandler: deps.authenticate }, async (request, reply) => {
    requireCompanyAdmin(request); const input = typeInput.parse(request.body);
    const row = await prisma.certificateType.create({ data: { ...input, subtype1Label: input.subtype1Label ?? null, subtype2Label: input.subtype2Label ?? null } });
    await auditCritical(request.principal!.accountId, "certificate_type.create", "certificate_type", row.id, undefined, "var/audit-fallback.ndjson");
    return reply.code(201).send({ data: row });
  });
  app.patch("/api/certificate-types/:id", { preHandler: deps.authenticate }, async (request) => {
    requireCompanyAdmin(request); const typeId = id.parse((request.params as { id: string }).id); const input = typeInput.partial().parse(request.body);
    const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Prisma.CertificateTypeUpdateInput;
    const row = await prisma.certificateType.update({ where: { id: typeId }, data });
    await auditCritical(request.principal!.accountId, "certificate_type.update", "certificate_type", row.id, undefined, "var/audit-fallback.ndjson");
    return { data: row };
  });
  app.delete("/api/certificate-types/:id", { preHandler: deps.authenticate }, async (request, reply) => {
    requireCompanyAdmin(request); const typeId = id.parse((request.params as { id: string }).id); const [persons, organizations] = await Promise.all([prisma.personCertificate.count({ where: { typeId } }), prisma.organizationQualification.count({ where: { typeId } })]);
    if (persons + organizations > 0) throw Object.assign(new Error("该类型已有证照引用，不能删除；可以停用"), { statusCode: 409, code: "TYPE_IN_USE" }); await prisma.certificateType.delete({ where: { id: typeId } }); return reply.code(204).send();
  });

  app.get("/api/certificate-settings", { preHandler: deps.authenticate }, async () => ({ data: await prisma.certificateSetting.upsert({ where: { id: "default" }, create: {}, update: {} }) }));
  app.patch("/api/certificate-settings", { preHandler: deps.authenticate }, async (request) => {
    requireCompanyAdmin(request); const warnDays = z.object({ warnDays: z.coerce.number().int().min(1).max(365) }).parse(request.body).warnDays;
    const row = await prisma.certificateSetting.upsert({ where: { id: "default" }, create: { warnDays, updatedBy: request.principal!.accountId }, update: { warnDays, updatedBy: request.principal!.accountId } });
    await auditCritical(request.principal!.accountId, "certificate_setting.update", "certificate_setting", row.id, { warnDays }, "var/audit-fallback.ndjson");
    return { data: row };
  });

  app.get("/api/certificates", { preHandler: deps.authenticate }, async (request) => {
    const query = z.object({ category: z.enum(["company", "personal"]).optional(), organizationId: id.optional(), typeId: id.optional(), status: z.enum(["active", "replaced", "revoked", "voided"]).optional(), keyword: z.string().trim().max(120).optional() }).parse(request.query);
    const orgIds = await readableOrgIds(request); if (query.organizationId && orgIds && !orgIds.includes(query.organizationId)) forbidden();
    const allowed = query.organizationId ? [query.organizationId] : orgIds;
    const [setting, company, personal] = await Promise.all([
      prisma.certificateSetting.upsert({ where: { id: "default" }, create: {}, update: {} }),
      query.category === "personal" ? [] : prisma.organizationQualification.findMany({ where: { ...(allowed ? { organizationId: { in: allowed } } : {}), ...(query.typeId ? { typeId: query.typeId } : {}), ...(query.status ? { status: query.status } : {}) }, include: { organization: { select: { id: true, name: true } }, type: true, attachments: { include: { file: { select: { id: true, originalName: true, mimeType: true, size: true } } } }, renewedFrom: { select: { id: true, name: true } } } }),
      query.category === "company" ? [] : prisma.personCertificate.findMany({ where: { ...(query.typeId ? { typeId: query.typeId } : {}), ...(query.status ? { status: query.status } : {}), ...(allowed ? { person: { organizations: { some: { active: true, organizationId: { in: allowed } } } } } : {}) }, include: { person: { select: { id: true, name: true, nationalIdLast4: true, organizations: { where: { active: true, primary: true }, take: 1, include: { organization: { select: { id: true, name: true } } } } } }, type: true, attachments: { include: { file: { select: { id: true, originalName: true, mimeType: true, size: true } } } }, trainingRecords: { orderBy: [{ year: "desc" }, { trainingDate: "desc" }] }, annualTrainingStatuses: { orderBy: { year: "desc" } }, renewedFrom: { select: { id: true, name: true } } } })
    ]);
    const rows = [
      ...company.map((row) => ({ ...row, category: "company" as const, ownerId: row.organizationId, ownerName: row.organization.name, organizationId: row.organizationId, organizationName: row.organization.name, certificateNo: numberOf(row), issuedAt: dateText(row.issuedAt), validFrom: dateText(row.validFrom), expiresAt: dateText(row.expiresAt) })),
      ...personal.map((row) => { const org = row.person.organizations[0]?.organization; return ({ ...row, category: "personal" as const, ownerId: row.personId, ownerName: row.person.name, holderName: row.person.name, holderIdMasked: row.person.nationalIdLast4 ? `**************${row.person.nationalIdLast4}` : null, organizationId: org?.id ?? null, organizationName: org?.name ?? "未分配组织", certificateNo: numberOf(row), issuedAt: dateText(row.issuedAt), validFrom: dateText(row.validFrom), expiresAt: dateText(row.expiresAt) }); })
    ].filter((row) => !query.keyword || [row.name, row.certificateNo, row.ownerName, row.subtype1Value, row.subtype2Value].some((value) => value?.toLowerCase().includes(query.keyword!.toLowerCase())));
    const now = Date.now(); const warn = setting.warnDays * DAY;
    const decorated = rows.map((row) => ({ ...row, expiryState: row.isLongTerm || !row.expiresAt ? "long_term" : new Date(row.expiresAt).getTime() < now ? "expired" : new Date(row.expiresAt).getTime() <= now + warn ? "expiring" : "valid" }));
    const order: Record<string, number> = { expired: 0, expiring: 1, valid: 2, long_term: 3 };
    decorated.sort((a, b) => (order[a.expiryState] ?? 9) - (order[b.expiryState] ?? 9) || a.name.localeCompare(b.name, "zh-CN"));
    return { data: { rows: decorated, summary: { total: decorated.length, expiring: decorated.filter((row) => row.expiryState === "expiring").length, expired: decorated.filter((row) => row.expiryState === "expired").length }, warnDays: setting.warnDays } };
  });

  app.post("/api/certificates", { preHandler: deps.authenticate }, async (request, reply) => {
    requireCompanyAdmin(request); const input = certificateInput.parse(request.body); const type = await validateType(input); const actor = request.principal!.accountId;
    const common = { typeId: input.typeId, name: input.name, category: type.name, subtype1Value: input.subtype1Value ?? null, subtype2Value: input.subtype2Value ?? null, issuingAuthority: input.issuingAuthority ?? null, issuedAt: input.issuedAt ?? null, validFrom: input.validFrom ?? null, expiresAt: input.isLongTerm ? null : input.expiresAt ?? null, isLongTerm: input.isLongTerm, remark: input.remark ?? null, createdBy: actor, ...numberFields(input.certificateNo, deps.env) };
    const row = input.category === "company"
      ? await prisma.organizationQualification.create({ data: { ...common, organizationId: input.ownerId, scope: input.scope ?? null, attachments: { create: input.fileIds.map((fileId) => ({ fileId, createdBy: actor })) } } })
      : await prisma.personCertificate.create({ data: { ...common, personId: input.ownerId, holderPosition: input.holderPosition ?? null, trainingStatus: trainingDefault(type.requiresAnnualTraining), annualTrainingStatuses: { create: { year: new Date().getFullYear(), status: trainingDefault(type.requiresAnnualTraining), setBy: actor } }, attachments: { create: input.fileIds.map((fileId) => ({ fileId, createdBy: actor })) } } });
    await auditCritical(actor, "certificate.create", input.category, row.id, { ownerId: input.ownerId }, "var/audit-fallback.ndjson");
    return reply.code(201).send({ data: { id: row.id, category: input.category } });
  });

  app.patch("/api/certificates/:category/:id", { preHandler: deps.authenticate }, async (request) => {
    requireCompanyAdmin(request); const params = z.object({ category: z.enum(["company", "personal"]), id }).parse(request.params); const input = certificateInput.parse(request.body); if (input.category !== params.category) throw Object.assign(new Error("证照大类不能修改"), { statusCode: 400 });
    const type = await validateType(input); const data = { typeId: input.typeId, name: input.name, category: type.name, subtype1Value: input.subtype1Value ?? null, subtype2Value: input.subtype2Value ?? null, issuingAuthority: input.issuingAuthority ?? null, issuedAt: input.issuedAt ?? null, validFrom: input.validFrom ?? null, expiresAt: input.isLongTerm ? null : input.expiresAt ?? null, isLongTerm: input.isLongTerm, remark: input.remark ?? null, ...numberFields(input.certificateNo, deps.env) };
    const attachments = input.fileIds.length ? { create: input.fileIds.map((fileId) => ({ fileId, createdBy: request.principal!.accountId })) } : undefined;
    if (params.category === "company") await prisma.organizationQualification.update({ where: { id: params.id }, data: { ...data, organizationId: input.ownerId, scope: input.scope ?? null, ...(attachments ? { attachments } : {}) } });
    else await prisma.personCertificate.update({ where: { id: params.id }, data: { ...data, personId: input.ownerId, holderPosition: input.holderPosition ?? null, ...(attachments ? { attachments } : {}) } });
    await auditCritical(request.principal!.accountId, "certificate.update", params.category, params.id, undefined, "var/audit-fallback.ndjson");
    return { data: { id: params.id } };
  });

  app.post("/api/certificates/:category/:id/renew", { preHandler: deps.authenticate }, async (request, reply) => {
    requireCompanyAdmin(request); const params = z.object({ category: z.enum(["company", "personal"]), id }).parse(request.params); const input = certificateInput.parse(request.body); const type = await validateType(input); const actor = request.principal!.accountId;
    if (input.category !== params.category) throw Object.assign(new Error("换证大类必须与原证一致"), { statusCode: 400 });
    const common = { typeId: input.typeId, name: input.name, category: type.name, subtype1Value: input.subtype1Value ?? null, subtype2Value: input.subtype2Value ?? null, issuingAuthority: input.issuingAuthority ?? null, issuedAt: input.issuedAt ?? null, validFrom: input.validFrom ?? null, expiresAt: input.isLongTerm ? null : input.expiresAt ?? null, isLongTerm: input.isLongTerm, remark: input.remark ?? null, renewedFromId: params.id, createdBy: actor, ...numberFields(input.certificateNo, deps.env) };
    const created = await prisma.$transaction(async (tx) => {
      if (params.category === "company") { const old = await tx.organizationQualification.findUniqueOrThrow({ where: { id: params.id } }); const next = await tx.organizationQualification.create({ data: { ...common, organizationId: old.organizationId, scope: input.scope ?? old.scope, attachments: { create: input.fileIds.map((fileId) => ({ fileId, createdBy: actor })) } } }); await tx.organizationQualification.update({ where: { id: old.id }, data: { status: "replaced", active: false, renewedAt: new Date() } }); return next; }
      const old = await tx.personCertificate.findUniqueOrThrow({ where: { id: params.id } }); const next = await tx.personCertificate.create({ data: { ...common, personId: old.personId, holderPosition: input.holderPosition ?? old.holderPosition, trainingStatus: trainingDefault(type.requiresAnnualTraining), annualTrainingStatuses: { create: { year: new Date().getFullYear(), status: trainingDefault(type.requiresAnnualTraining), setBy: actor } }, attachments: { create: input.fileIds.map((fileId) => ({ fileId, createdBy: actor })) } } }); await tx.personCertificate.update({ where: { id: old.id }, data: { status: "replaced", active: false, renewedAt: new Date() } }); return next;
    });
    await auditCritical(actor, "certificate.renew", params.category, created.id, { renewedFromId: params.id }, "var/audit-fallback.ndjson");
    return reply.code(201).send({ data: { id: created.id } });
  });

  app.patch("/api/certificates/:category/:id/revoke", { preHandler: deps.authenticate }, async (request) => {
    requireCompanyAdmin(request); const params = z.object({ category: z.enum(["company", "personal"]), id }).parse(request.params);
    if (params.category === "company") await prisma.organizationQualification.update({ where: { id: params.id }, data: { status: "revoked", active: false } }); else await prisma.personCertificate.update({ where: { id: params.id }, data: { status: "revoked", active: false } });
    await auditCritical(request.principal!.accountId, "certificate.revoke", params.category, params.id, undefined, "var/audit-fallback.ndjson"); return { data: { id: params.id } };
  });

  app.post("/api/certificates/:category/:id/void", { preHandler: deps.authenticate }, async (request) => {
    requireCompanyAdmin(request); const params = z.object({ category: z.enum(["company", "personal"]), id }).parse(request.params); const { reason } = z.object({ reason: z.string().trim().min(2).max(500) }).parse(request.body);
    if (params.category === "company") await prisma.organizationQualification.update({ where: { id: params.id }, data: { status: "voided", active: false, voidedAt: new Date(), voidedBy: request.principal!.accountId, voidReason: reason } }); else await prisma.personCertificate.update({ where: { id: params.id }, data: { status: "voided", active: false, voidedAt: new Date(), voidedBy: request.principal!.accountId, voidReason: reason } });
    await auditCritical(request.principal!.accountId, "certificate.void", params.category, params.id, { reason }, "var/audit-fallback.ndjson"); return { data: { id: params.id, status: "voided" } };
  });

  app.post("/api/certificates/:category/:id/attachments", { preHandler: deps.authenticate }, async (request, reply) => {
    requireCompanyAdmin(request); const params = z.object({ category: z.enum(["company", "personal"]), id }).parse(request.params); const fileId = z.object({ fileId: id }).parse(request.body).fileId;
    const row = await prisma.certificateAttachment.create({ data: { fileId, createdBy: request.principal!.accountId, ...(params.category === "company" ? { organizationQualificationId: params.id } : { personCertificateId: params.id }) } });
    return reply.code(201).send({ data: row });
  });

  const trainingInput = z.object({ year: z.coerce.number().int().min(2000).max(9999), trainingDate: date, content: z.string().trim().min(1).max(1000), trainingOrganization: z.string().trim().max(160).optional(), hours: z.coerce.number().min(0).max(9999).optional(), result: z.string().trim().max(120).optional(), remark: z.string().trim().max(1000).optional() });
  app.post("/api/person-certificates/:id/training-records", { preHandler: deps.authenticate }, async (request, reply) => {
    requireCompanyAdmin(request); const certificateId = id.parse((request.params as { id: string }).id); const input = trainingInput.parse(request.body); const actor = request.principal!.accountId;
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.certificateTrainingRecord.create({ data: { personCertificateId: certificateId, year: input.year, trainingDate: input.trainingDate, content: input.content, trainingOrganization: input.trainingOrganization ?? null, hours: input.hours ?? null, result: input.result ?? null, remark: input.remark ?? null, createdBy: actor } });
      await tx.certificateAnnualTrainingStatus.upsert({ where: { personCertificateId_year: { personCertificateId: certificateId, year: input.year } }, create: { personCertificateId: certificateId, year: input.year, status: "trained", setBy: actor }, update: { status: "trained", reason: null, setBy: actor } });
      if (input.year === new Date().getFullYear()) await tx.personCertificate.update({ where: { id: certificateId }, data: { trainingStatus: "trained" } });
      return created;
    });
    await auditCritical(actor, "certificate_training.create", "certificate_training_record", row.id, { certificateId, year: input.year }, "var/audit-fallback.ndjson");
    return reply.code(201).send({ data: row });
  });
  app.patch("/api/certificate-training-records/:id", { preHandler: deps.authenticate }, async (request, reply) => {
    requireCompanyAdmin(request); const recordId = id.parse((request.params as { id: string }).id); const input = trainingInput.parse(request.body); const actor = request.principal!.accountId; const reason = z.string().trim().min(2).max(500).parse((request.body as { correctionReason?: unknown }).correctionReason);
    const replacement = await prisma.$transaction(async (tx) => { const old = await tx.certificateTrainingRecord.findUniqueOrThrow({ where: { id: recordId } }); if (old.status === "voided") throw Object.assign(new Error("已作废记录不能再次更正"), { statusCode: 409 }); await tx.certificateTrainingRecord.update({ where: { id: recordId }, data: { status: "voided", voidedAt: new Date(), voidedBy: actor, voidReason: reason } }); return tx.certificateTrainingRecord.create({ data: { personCertificateId: old.personCertificateId, year: input.year, trainingDate: input.trainingDate, content: input.content, trainingOrganization: input.trainingOrganization ?? null, hours: input.hours ?? null, result: input.result ?? null, remark: input.remark ?? null, correctionOfId: old.id, createdBy: actor } }); });
    await auditCritical(actor, "certificate_training.correct", "certificate_training_record", replacement.id, { correctionOfId: recordId, reason }, "var/audit-fallback.ndjson"); return reply.code(201).send({ data: replacement });
  });
  app.post("/api/certificate-training-records/:id/void", { preHandler: deps.authenticate }, async (request) => { requireCompanyAdmin(request); const recordId = id.parse((request.params as { id: string }).id); const { reason } = z.object({ reason: z.string().trim().min(2).max(500) }).parse(request.body); const row = await prisma.certificateTrainingRecord.update({ where: { id: recordId }, data: { status: "voided", voidedAt: new Date(), voidedBy: request.principal!.accountId, voidReason: reason } }); await auditCritical(request.principal!.accountId, "certificate_training.void", "certificate_training_record", recordId, { reason }, "var/audit-fallback.ndjson"); return { data: row }; });

  app.post("/api/person-certificates/training-status", { preHandler: deps.authenticate }, async (request) => {
    requireCompanyAdmin(request); const input = z.object({ ids: z.array(id).min(1).max(1000), year: z.coerce.number().int().min(2000).max(9999).default(new Date().getFullYear()), status: z.enum(["trained", "not_required", "pending"]), reason: z.string().trim().max(500).optional() }).superRefine((value, ctx) => { if (value.status === "not_required" && !value.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "手工设置无需培训必须填写原因" }); }).parse(request.body); const actor = request.principal!.accountId;
    await prisma.$transaction(async (tx) => { if (input.year === new Date().getFullYear()) await tx.personCertificate.updateMany({ where: { id: { in: input.ids } }, data: { trainingStatus: input.status } }); for (const certificateId of input.ids) await tx.certificateAnnualTrainingStatus.upsert({ where: { personCertificateId_year: { personCertificateId: certificateId, year: input.year } }, create: { personCertificateId: certificateId, year: input.year, status: input.status, reason: input.reason ?? null, setBy: actor }, update: { status: input.status, reason: input.reason ?? null, setBy: actor } }); });
    await auditCritical(actor, "certificate.training_status.bulk_update", "person_certificate", "bulk", { count: input.ids.length, status: input.status }, "var/audit-fallback.ndjson"); return { data: { updated: input.ids.length } };
  });
  app.post("/api/person-certificates/training-status/initialize", { preHandler: deps.authenticate }, async (request) => {
    requireCompanyAdmin(request); const rows = await prisma.personCertificate.findMany({ where: { status: "active", trainingStatus: { not: "trained" } }, include: { type: true } }); let updated = 0;
    const year = new Date().getFullYear(); for (const row of rows) { if (!row.type) continue; const status = trainingDefault(row.type.requiresAnnualTraining); await prisma.$transaction([prisma.personCertificate.update({ where: { id: row.id }, data: { trainingStatus: status } }), prisma.certificateAnnualTrainingStatus.upsert({ where: { personCertificateId_year: { personCertificateId: row.id, year } }, create: { personCertificateId: row.id, year, status }, update: {} })]); updated += 1; }
    await auditCritical(request.principal!.accountId, "certificate.training_status.initialize", "person_certificate", "bulk", { updated }, "var/audit-fallback.ndjson"); return { data: { updated } };
  });

  app.get("/api/certificates/duplicates", { preHandler: deps.authenticate }, async (request) => {
    requireCompanyAdmin(request); const [company, personal] = await Promise.all([prisma.organizationQualification.findMany({ orderBy: { createdAt: "asc" } }), prisma.personCertificate.findMany({ orderBy: { createdAt: "asc" } })]);
    const groups: Array<{ category: "company" | "personal"; keepId: string; duplicateIds: string[]; name: string }> = [];
    const collect = (category: "company" | "personal", rows: Array<{ id: string; ownerId: string; typeId: string | null; name: string; certificateNoCipher: string | null; subtype1Value: string | null; subtype2Value: string | null; issuedAt: Date | null; validFrom: Date | null; expiresAt: Date | null; isLongTerm: boolean; issuingAuthority: string | null; remark: string | null }>) => { const seen = new Map<string, { id: string; name: string; duplicateIds: string[] }>(); for (const row of rows) { const key = [row.ownerId, row.typeId, row.name, row.certificateNoCipher, row.subtype1Value, row.subtype2Value, dateText(row.issuedAt), dateText(row.validFrom), dateText(row.expiresAt), row.isLongTerm, row.issuingAuthority, row.remark].join("|"); const prior = seen.get(key); if (prior) prior.duplicateIds.push(row.id); else seen.set(key, { id: row.id, name: row.name, duplicateIds: [] }); } for (const value of seen.values()) if (value.duplicateIds.length) groups.push({ category, keepId: value.id, duplicateIds: value.duplicateIds, name: value.name }); };
    collect("company", company.map((row) => ({ ...row, ownerId: row.organizationId }))); collect("personal", personal.map((row) => ({ ...row, ownerId: row.personId })));
    return { data: { groups, duplicateCount: groups.reduce((sum, group) => sum + group.duplicateIds.length, 0) } };
  });
  app.post("/api/certificates/duplicates/cleanup", { preHandler: deps.authenticate }, async (request) => {
    requireCompanyAdmin(request); const input = z.object({ groups: z.array(z.object({ category: z.enum(["company", "personal"]), duplicateIds: z.array(id).min(1) })).max(1000) }).parse(request.body); let updated = 0;
    for (const group of input.groups) { if (group.category === "company") updated += (await prisma.organizationQualification.updateMany({ where: { id: { in: group.duplicateIds } }, data: { status: "revoked", active: false } })).count; else updated += (await prisma.personCertificate.updateMany({ where: { id: { in: group.duplicateIds } }, data: { status: "revoked", active: false } })).count; }
    await auditCritical(request.principal!.accountId, "certificate.duplicates.cleanup", "certificate", "bulk", { updated }, "var/audit-fallback.ndjson"); return { data: { updated } };
  });

  app.get("/api/certificates.csv", { preHandler: deps.authenticate }, async (request, reply) => {
    const orgIds = await readableOrgIds(request); const [company, personal] = await Promise.all([
      prisma.organizationQualification.findMany({ where: orgIds ? { organizationId: { in: orgIds } } : {}, include: { organization: true, type: true } }),
      prisma.personCertificate.findMany({ where: orgIds ? { person: { organizations: { some: { active: true, organizationId: { in: orgIds } } } } } : {}, include: { person: true, type: true } })
    ]); const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["大类,所属组织,持证人,证照类型,证照名称,证照编号,子分类1,子分类2,发证机关,有效期至,状态,当年培训状态", ...company.map((r) => ["公司", r.organization.name, "", r.type?.name, r.name, numberOf(r), r.subtype1Value, r.subtype2Value, r.issuingAuthority, dateText(r.expiresAt), r.status, ""].map(esc).join(",")), ...personal.map((r) => ["个人", "", r.person.name, r.type?.name, r.name, numberOf(r), r.subtype1Value, r.subtype2Value, r.issuingAuthority, dateText(r.expiresAt), r.status, r.trainingStatus].map(esc).join(","))];
    return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", "attachment; filename=certificates.csv").send(`\uFEFF${lines.join("\r\n")}`);
  });

  app.get("/api/certificates/import-template.xlsx", { preHandler: deps.authenticate }, async (_request, reply) => {
    const [types, organizations] = await Promise.all([prisma.certificateType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }), prisma.organization.findMany({ orderBy: { name: "asc" } })]); const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("证照导入");
    sheet.addRow(["大类", "所属组织", "持证人", "证照类型", "证照名称", "证照编号", "子分类1", "子分类2", "发证机关", "发证日期", "有效期开始", "有效期至", "长期有效", "持证岗位", "许可范围", "备注"]); sheet.getRow(1).font = { bold: true };
    const help = workbook.addWorksheet("填写说明"); help.addRow(["填写规则"]); help.addRow(["大类填写：公司或个人；公司证照必须填写所属组织，个人证照必须填写持证人。日期格式 YYYY-MM-DD；长期有效填写是。"]); help.addRow(["当前组织", ...organizations.map((row) => row.name)]); types.forEach((row) => help.addRow([row.category === "company" ? "公司" : "个人", row.name, row.subtype1Label ?? "", (row.subtype1Options as string[]).join("/"), row.subtype2Label ?? "", (row.subtype2Options as string[]).join("/")]));
    const buffer = await workbook.xlsx.writeBuffer(); return reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("Content-Disposition", "attachment; filename=certificate-import-template.xlsx").send(Buffer.from(buffer));
  });

  app.post("/api/certificates/import/preview", { preHandler: deps.authenticate }, async (request) => {
    requireCompanyAdmin(request); const part = await request.file({ limits: { files: 1, fileSize: 10 * 1024 * 1024 } }); if (!part) throw Object.assign(new Error("请选择 Excel 文件"), { statusCode: 400, code: "FILE_REQUIRED" });
    if (!/\.xlsx$/i.test(part.filename)) throw Object.assign(new Error("当前导入支持 .xlsx 文件，请先另存为 XLSX"), { statusCode: 400, code: "INVALID_IMPORT_FILE" });
    const buffer = await part.toBuffer(); const [organizations, persons, types] = await Promise.all([
      prisma.organization.findMany({ select: { id: true, name: true } }), prisma.person.findMany({ where: { status: "active" }, select: { id: true, name: true } }), prisma.certificateType.findMany({ where: { active: true }, select: { id: true, name: true, category: true, subtype1Label: true, subtype1Options: true, subtype2Label: true, subtype2Options: true } })
    ]); const result = await parseQualificationWorkbook(buffer, { organizations, persons, types });
    return { data: { ...result, summary: { total: result.rows.length, ready: result.rows.filter((row) => row.status === "ready").length, invalid: result.rows.filter((row) => row.status === "invalid").length } } };
  });

  app.post("/api/certificates/import/confirm", { preHandler: deps.authenticate }, async (request) => {
    requireCompanyAdmin(request); const rows = z.array(z.object({ rowNumber: z.number().int().min(2), status: z.enum(["ready", "invalid"]), reasons: z.array(z.string()).default([]) }).passthrough()).max(1000).parse((request.body as { rows?: unknown })?.rows) as unknown as QualificationImportRow[]; const actor = request.principal!.accountId; const result: Array<{ rowNumber: number; status: "success" | "failed" | "skipped"; reason?: string }> = [];
    for (let offset = 0; offset < rows.length; offset += 20) {
      for (const raw of rows.slice(offset, offset + 20)) {
        if (raw.status !== "ready") { result.push({ rowNumber: raw.rowNumber, status: "skipped", reason: raw.reasons.join("；") || "预检查未通过" }); continue; }
        const parsed = certificateInput.safeParse(raw); if (!parsed.success) { result.push({ rowNumber: raw.rowNumber, status: "failed", reason: parsed.error.issues[0]?.message ?? "数据无效" }); continue; }
        try {
          const input = parsed.data; const type = await validateType(input); const common = { typeId: input.typeId, name: input.name, category: type.name, subtype1Value: input.subtype1Value ?? null, subtype2Value: input.subtype2Value ?? null, issuingAuthority: input.issuingAuthority ?? null, issuedAt: input.issuedAt ?? null, validFrom: input.validFrom ?? null, expiresAt: input.isLongTerm ? null : input.expiresAt ?? null, isLongTerm: input.isLongTerm, remark: input.remark ?? null, createdBy: actor, ...numberFields(input.certificateNo, deps.env) };
          if (input.category === "company") { await prisma.organization.findUniqueOrThrow({ where: { id: input.ownerId } }); await prisma.organizationQualification.create({ data: { ...common, organizationId: input.ownerId, scope: input.scope ?? null } }); }
          else { await prisma.person.findUniqueOrThrow({ where: { id: input.ownerId } }); await prisma.personCertificate.create({ data: { ...common, personId: input.ownerId, holderPosition: input.holderPosition ?? null, trainingStatus: trainingDefault(type.requiresAnnualTraining), annualTrainingStatuses: { create: { year: new Date().getFullYear(), status: trainingDefault(type.requiresAnnualTraining), setBy: actor } } } }); }
          result.push({ rowNumber: raw.rowNumber, status: "success" });
        } catch (error) { result.push({ rowNumber: raw.rowNumber, status: "failed", reason: error instanceof Error ? error.message : "写入失败" }); }
      }
    }
    await auditCritical(actor, "certificate.import", "certificate", "bulk", { total: rows.length, success: result.filter((row) => row.status === "success").length }, "var/audit-fallback.ndjson");
    return { data: { rows: result, summary: { success: result.filter((row) => row.status === "success").length, failed: result.filter((row) => row.status === "failed").length, skipped: result.filter((row) => row.status === "skipped").length } } };
  });
}
