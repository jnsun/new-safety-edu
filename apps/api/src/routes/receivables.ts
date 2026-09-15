import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { z } from "zod";
import type { Principal } from "../auth.js";
import { prisma } from "../db.js";
import { administerReceivables } from "../receivables-admin.js";
import { requireReceivables, resolveReceivablesAccess } from "../receivables-access.js";
import { queryReceivables } from "../receivables-query.js";
import { writeReceivablesLedger } from "../receivables-ledger.js";
import { writeReceivablesMoney } from "../receivables-money.js";
import { authorizeReceivableAttachmentUpload, createReceivableAttachment, newReceivableAttachmentStorageKey, removeReceivableAttachmentFiles, storeReceivableAttachment, validateReceivableAttachment, voidReceivableAttachment } from "../receivables-files.js";
import { applyReceivablesImport, authorizeReceivablesImport, listReceivablesImports, previewReceivablesImport, rollbackReceivablesImport } from "../receivables-import.js";
import { consumeReceivablesExport, createReceivablesExportJob, issueReceivablesExportToken, listReceivablesExports, removeConsumedReceivablesExport } from "../receivables-export.js";
import { writeCriticalAudit } from "../transaction-audit.js";

type RouteDependencies = {
  authenticate(request: FastifyRequest): Promise<void>;
  enableAccessSmokeRoute?: boolean;
};

const organizationInput = z.object({
  organizationId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500).optional(),
  confirm: z.boolean().optional(),
});
const setupLockKey = 8_645_136_501n;
const reasonInput = z.string().trim().min(1).max(500);
const idParams = z.object({ id: z.string().uuid() }).strict();
const departmentScopeInput = z.object({ departmentId: z.string().uuid(), canRead: z.boolean(), canWrite: z.boolean() }).strict();
const grantFields = z.object({
  role: z.enum(["admin", "reporter", "readonly"]),
  canCreate: z.boolean().default(false),
  canExport: z.boolean().default(false),
  canViewAll: z.boolean().default(false),
  departments: z.array(departmentScopeInput).max(200).default([]),
}).strict();
const grantCreateInput = grantFields.extend({ accountId: z.string().uuid(), reason: reasonInput }).strict();
const grantUpdateInput = grantFields.extend({ revision: z.number().int().positive(), reason: reasonInput }).strict();
const grantRevokeInput = z.object({ revision: z.number().int().positive(), revoke: z.literal(true), reason: reasonInput }).strict();
const grantPatchInput = z.union([grantRevokeInput, grantUpdateInput]);
const departmentCreateInput = z.object({ name: z.string().trim().min(1).max(160), code: z.string().trim().min(1).max(40).nullable().optional(), sortOrder: z.number().int().default(0) }).strict();
const departmentUpdateInput = z.object({ revision: z.number().int().positive(), name: z.string().trim().min(1).max(160).optional(), code: z.string().trim().min(1).max(40).nullable().optional(), sortOrder: z.number().int().optional(), active: z.literal(false).optional(), reason: reasonInput.optional() }).strict();
const dictionaryCreateInput = z.object({ category: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(240), sortOrder: z.number().int().default(0) }).strict();
const dictionaryUpdateInput = z.object({ revision: z.number().int().positive(), value: z.string().trim().min(1).max(240).optional(), sortOrder: z.number().int().optional(), active: z.literal(false).optional(), reason: reasonInput.optional() }).strict();
const migrationPreviewInput = z.object({ mode: z.literal("preview"), targetId: z.string().uuid() }).strict();
const migrationApplyInput = z.object({ mode: z.literal("apply"), targetId: z.string().uuid(), token: z.string().min(1).max(2048), reason: reasonInput, confirm: z.literal(true) }).strict();
const migrationInput = z.discriminatedUnion("mode", [migrationPreviewInput, migrationApplyInput]);
const receivablesFilters = {
  financeDepartmentId: z.string().uuid().optional(),
  status: z.enum(["active", "voided", "all"]).optional(),
  settlement: z.enum(["unsettled", "settled", "all"]).optional(),
  debtStatus: z.string().trim().min(1).max(120).optional(),
  creditorUnit: z.string().trim().min(1).max(120).optional(),
  anomaly: z.enum(["over_received", "writeoff_adjustment_required", "final_amount_missing"]).optional(),
  search: z.string().trim().min(1).max(240).optional(),
};
const receivablesListInput = z.object({
  ...receivablesFilters,
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["updatedAt", "contractNo", "projectName", "customerName", "debtStatus", "finalAmount", "invoicedAmount", "receivedAmount", "balance", "openingChargeDate"]).default("updatedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
}).strict();
const receivablesDashboardInput = z.object(receivablesFilters).strict();
const receivablesExportCreateInput = z.object({ filters: z.object(receivablesFilters).strict().default({}) }).strict();
const receivablesExportListInput = z.object({ page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }).strict();
const receivablesExportTokenInput = z.object({ token: z.string().min(32).max(200) }).strict();
const ledgerText = (max: number) => z.string().max(max).nullable().optional();
const ledgerFields = {
  financeDepartmentId: z.string().uuid(),
  contractNo: z.string().max(160).refine((value) => value.trim().length > 0, "合同编号不能为空"),
  projectName: ledgerText(240), customerName: ledgerText(240), customerType: ledgerText(120),
  creditorUnit: ledgerText(120), workNature: ledgerText(160), sector: ledgerText(160),
  projectStatus: ledgerText(120), settlementMethod: ledgerText(120),
  contractAmount: z.string().min(1).max(80).nullable().optional(), finalAmount: z.string().min(1).max(80).nullable().optional(),
  openingChargeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  debtStatus: ledgerText(120), collectionOwner: ledgerText(120), collectionNotes: ledgerText(10_000),
};
const ledgerCreateInput = z.object(ledgerFields).strict();
const ledgerPatchInput = z.object({
  ...Object.fromEntries(Object.entries(ledgerFields).map(([field, schema]) => [field, schema.optional()])),
  revision: z.number().int().positive(), reason: reasonInput,
}).strict().refine((input) => Object.keys(input).some((field) => field !== "revision" && field !== "reason"), "至少提交一个修改字段");
const ledgerVoidInput = z.object({ revision: z.number().int().positive(), reason: reasonInput, confirm: z.literal(true) }).strict();
const amountInput = z.string().trim().min(1).max(80);
const detailDateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const invoiceCreateInput = z.object({ ledgerRevision: z.number().int().positive(), invoiceDate: detailDateInput, invoiceNo: z.string().trim().max(120).nullable().optional(), amount: amountInput, note: z.string().trim().max(10_000).nullable().optional() }).strict();
const receiptCreateInput = z.object({ ledgerRevision: z.number().int().positive(), receiptDate: detailDateInput, referenceNo: z.string().trim().max(120).nullable().optional(), amount: amountInput, note: z.string().trim().max(10_000).nullable().optional() }).strict();
const invoicePatchInput = invoiceCreateInput.extend({ revision: z.number().int().positive(), reason: reasonInput }).strict();
const receiptPatchInput = receiptCreateInput.extend({ revision: z.number().int().positive(), reason: reasonInput }).strict();
const detailVoidInput = z.object({ ledgerRevision: z.number().int().positive(), revision: z.number().int().positive(), reason: reasonInput }).strict();
const detailParams = z.object({ id: z.string().uuid(), invoiceId: z.string().uuid() }).strict();
const receiptParams = z.object({ id: z.string().uuid(), receiptId: z.string().uuid() }).strict();
const writeoffInput = z.object({ ledgerRevision: z.number().int().positive(), reason: reasonInput, writeoffAmount: amountInput }).strict();
const attachmentFields = z.object({ ledgerRevision: z.coerce.number().int().positive(), category: z.string().trim().min(1).max(120).default("general") }).strict();
const attachmentVoidInput = z.object({ ledgerRevision: z.number().int().positive(), revision: z.number().int().positive(), reason: reasonInput }).strict();
const attachmentParams = z.object({ id: z.string().uuid(), attachmentId: z.string().uuid() }).strict();
const importApplyInput = z.object({ revision: z.number().int().positive(), decisions: z.array(z.object({ rowNumber: z.number().int().min(2), decision: z.enum(["skip", "update"]) }).strict()).max(200_000) }).strict();
const importRollbackInput = z.object({ revision: z.number().int().positive(), reason: reasonInput }).strict();

const httpError = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const lockReceivablesSetup = (tx: Prisma.TransactionClient) => tx.$queryRaw`SELECT 'locked'::text AS locked FROM pg_advisory_xact_lock(${setupLockKey})`;
const adminContext = (request: FastifyRequest) => ({ principal: request.principal as Principal, requestId: request.id });
const ledgerContext = adminContext;
const multipartFields = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "file").map(([key, value]) => [key, value && typeof value === "object" && "value" in value ? (value as { value: unknown }).value : value]));

export async function registerReceivablesRoutes(app: FastifyInstance, deps: RouteDependencies) {
  const exportEnvironment = { uploadRoot: process.env.UPLOAD_ROOT ?? "var/uploads" };
  app.get("/api/receivables/access", { preHandler: deps.authenticate }, async (request) => ({ data: await resolveReceivablesAccess(request.principal as Principal) }));

  if (deps.enableAccessSmokeRoute) {
    app.get("/api/receivables/_smoke/protected", { preHandler: deps.authenticate }, async (request) => {
      requireReceivables(await resolveReceivablesAccess(request.principal as Principal), "enter");
      return { data: { allowed: true } };
    });
  }

  app.put("/api/receivables/setup/organization", { preHandler: deps.authenticate }, async (request) => {
    const input = organizationInput.parse(request.body);
    const principal = request.principal as Principal;
    const data = await prisma.$transaction(async (tx) => {
      await lockReceivablesSetup(tx);
      requireReceivables(await resolveReceivablesAccess(principal, tx), "recover");
      const organization = await tx.organization.findUnique({ where: { id: input.organizationId }, select: { id: true, name: true, type: true } });
      if (!organization) throw httpError(404, "RECEIVABLES_ORGANIZATION_NOT_FOUND", "组织不存在");
      if (organization.type !== "department") throw httpError(409, "RECEIVABLES_ORGANIZATION_NOT_DEPARTMENT", "应收账款组织必须是部门类型");
      const previous = await tx.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } });
      const isRebind = !!previous?.financeOrganizationId && previous.financeOrganizationId !== organization.id;
      if (isRebind && (input.confirm !== true || !input.reason)) throw httpError(400, "RECEIVABLES_REBIND_CONFIRMATION_REQUIRED", "换绑必须填写原因并二次确认");
      if (previous?.financeOrganizationId === organization.id) return resolveReceivablesAccess(principal, tx);
      await tx.receivableSetting.upsert({ where: { id: 1 }, create: { id: 1, financeOrganizationId: organization.id }, update: { financeOrganizationId: organization.id, configurationConfirmedAt: null, configurationConfirmedBy: null } });
      await writeCriticalAudit(tx, {
        actorId: principal.accountId, action: isRebind ? "receivables.setup.rebind" : "receivables.setup.bind", objectType: "receivable_setting", objectId: organization.id,
        requestId: request.id, actorRole: "company_admin", actorScopeType: "company", ...(input.reason ? { reason: input.reason } : {}),
        metadata: { before: previous ?? null, after: { financeOrganizationId: organization.id, configurationConfirmedAt: null, configurationConfirmedBy: null } },
      });
      return resolveReceivablesAccess(principal, tx);
    });
    return { data };
  });

  app.post("/api/receivables/setup/confirm", { preHandler: deps.authenticate }, async (request) => {
    const principal = request.principal as Principal;
    const data = await prisma.$transaction(async (tx) => {
      await lockReceivablesSetup(tx);
      const access = await resolveReceivablesAccess(principal, tx);
      requireReceivables(access, "confirmSetup");
      const setting = await tx.receivableSetting.findUniqueOrThrow({ where: { id: 1 }, select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true } });
      const confirmedAt = new Date();
      await tx.receivableSetting.update({ where: { id: 1 }, data: { configurationConfirmedAt: confirmedAt, configurationConfirmedBy: principal.accountId } });
      await writeCriticalAudit(tx, {
        actorId: principal.accountId, action: "receivables.setup.confirm", objectType: "receivable_setting", objectId: setting.financeOrganizationId,
        requestId: request.id, actorRole: "owner", actorScopeType: "organization", actorScopeId: setting.financeOrganizationId,
        metadata: { before: setting, after: { ...setting, configurationConfirmedAt: confirmedAt, configurationConfirmedBy: principal.accountId } },
      });
      return resolveReceivablesAccess(principal, tx);
    });
    return { data };
  });

  app.get("/api/receivables/ledgers", { preHandler: deps.authenticate }, async (request) => ({
    data: await queryReceivables(request.principal as Principal, { type: "ledger.list", input: receivablesListInput.parse(request.query) }),
  }));
  app.get("/api/receivables/ledgers/:id", { preHandler: deps.authenticate }, async (request) => ({
    data: await queryReceivables(request.principal as Principal, { type: "ledger.detail", id: idParams.parse(request.params).id }),
  }));
  app.get("/api/receivables/dashboard", { preHandler: deps.authenticate }, async (request) => ({
    data: await queryReceivables(request.principal as Principal, { type: "dashboard", input: receivablesDashboardInput.parse(request.query) }),
  }));
  app.get("/api/receivables/exports", { preHandler: deps.authenticate }, async (request) => ({
    data: await listReceivablesExports(request.principal as Principal, receivablesExportListInput.parse(request.query), exportEnvironment),
  }));
  app.post("/api/receivables/exports", { preHandler: deps.authenticate }, async (request, reply) => {
    const { filters } = receivablesExportCreateInput.parse(request.body);
    const job = await createReceivablesExportJob(request.principal as Principal, filters, exportEnvironment);
    return reply.code(202).send({ data: { id: job.id, status: job.status } });
  });
  app.post("/api/receivables/exports/:id/token", { preHandler: deps.authenticate }, async (request) => ({
    data: await issueReceivablesExportToken(idParams.parse(request.params).id, request.principal as Principal),
  }));
  app.post("/api/receivables/exports/:id/download", { preHandler: deps.authenticate }, async (request, reply) => {
    const { token } = receivablesExportTokenInput.parse(request.body);
    const file = await consumeReceivablesExport(idParams.parse(request.params).id, token, request.principal as Principal, exportEnvironment);
    reply.raw.once("finish", () => void removeConsumedReceivablesExport(file.path, exportEnvironment).catch((error) => app.log.error({ err: error }, "receivables_export_response_cleanup_failed")));
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff").header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return reply.send(createReadStream(file.path));
  });
  app.get("/api/receivables/imports", { preHandler: deps.authenticate }, async (request) => ({ data: await listReceivablesImports(request.principal as Principal) }));
  app.post("/api/receivables/imports/preview", { preHandler: deps.authenticate }, async (request, reply) => {
    await authorizeReceivablesImport(request.principal as Principal);
    const part = await request.file({ limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
    if (!part) throw httpError(400, "FILE_REQUIRED", "请选择文件");
    const content = await part.toBuffer();
    if (part.file.truncated) throw httpError(413, "FILE_TOO_LARGE", "导入文件不得超过 10 MiB");
    const data = await previewReceivablesImport(adminContext(request), { originalName: part.filename, mimeType: part.mimetype, content }, { uploadRoot: process.env.UPLOAD_ROOT ?? "var/uploads" });
    return reply.code(201).send({ data });
  });
  app.post("/api/receivables/imports/:id/apply", { preHandler: deps.authenticate }, async (request) => {
    const input = importApplyInput.parse(request.body);
    return { data: await applyReceivablesImport(adminContext(request), idParams.parse(request.params).id, { revision: input.revision, rows: input.decisions }, { uploadRoot: process.env.UPLOAD_ROOT ?? "var/uploads" }) };
  });
  app.post("/api/receivables/imports/:id/rollback", { preHandler: deps.authenticate }, async (request) => ({ data: await rollbackReceivablesImport(adminContext(request), idParams.parse(request.params).id, importRollbackInput.parse(request.body)) }));
  app.post("/api/receivables/ledgers", { preHandler: deps.authenticate }, async (request, reply) => {
    const data = await writeReceivablesLedger(ledgerContext(request), { type: "create", input: ledgerCreateInput.parse(request.body) });
    return reply.code(201).send({ data });
  });
  app.patch("/api/receivables/ledgers/:id", { preHandler: deps.authenticate }, async (request) => ({
    data: await writeReceivablesLedger(ledgerContext(request), { type: "patch", id: idParams.parse(request.params).id, input: ledgerPatchInput.parse(request.body) }),
  }));
  app.post("/api/receivables/ledgers/:id/void", { preHandler: deps.authenticate }, async (request) => ({
    data: await writeReceivablesLedger(ledgerContext(request), { type: "void", id: idParams.parse(request.params).id, input: ledgerVoidInput.parse(request.body) }),
  }));
  app.post("/api/receivables/ledgers/:id/attachments", { preHandler: deps.authenticate }, async (request, reply) => {
    const ledgerId = idParams.parse(request.params).id;
    await authorizeReceivableAttachmentUpload(request.principal as Principal, ledgerId);
    const part = await request.file({ limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
    if (!part) throw httpError(400, "FILE_REQUIRED", "请选择文件");
    const buffer = await part.toBuffer();
    if (part.file.truncated) throw httpError(413, "FILE_TOO_LARGE", "附件不得超过 10 MiB");
    await validateReceivableAttachment(part.filename, part.mimetype, buffer);
    const input = attachmentFields.parse(multipartFields(part.fields as Record<string, unknown>));
    const root = process.env.UPLOAD_ROOT ?? "var/uploads";
    const storageKey = newReceivableAttachmentStorageKey();
    await storeReceivableAttachment(root, storageKey, buffer);
    let data;
    try {
      data = await createReceivableAttachment(ledgerContext(request), { ledgerId, ledgerRevision: input.ledgerRevision, category: input.category, file: { storageKey, originalName: part.filename.slice(0, 240), mimeType: part.mimetype, size: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") } });
    } catch (error) {
      await removeReceivableAttachmentFiles(root, storageKey);
      throw error;
    }
    return reply.code(201).send({ data });
  });
  app.post("/api/receivables/ledgers/:id/attachments/:attachmentId/void", { preHandler: deps.authenticate }, async (request) => {
    const params = attachmentParams.parse(request.params);
    return { data: await voidReceivableAttachment(ledgerContext(request), { ledgerId: params.id, attachmentId: params.attachmentId, ...attachmentVoidInput.parse(request.body) }) };
  });
  app.post("/api/receivables/ledgers/:id/invoices", { preHandler: deps.authenticate }, async (request, reply) => {
    const input = invoiceCreateInput.parse(request.body); const id = idParams.parse(request.params).id;
    const data = await writeReceivablesMoney(ledgerContext(request), { type: "invoice.create", ledgerId: id, input: { ledgerRevision: input.ledgerRevision, date: input.invoiceDate, invoiceNo: input.invoiceNo, amount: input.amount, note: input.note } }); return reply.code(201).send({ data });
  });
  app.patch("/api/receivables/ledgers/:id/invoices/:invoiceId", { preHandler: deps.authenticate }, async (request) => {
    const input = invoicePatchInput.parse(request.body); const params = detailParams.parse(request.params);
    return { data: await writeReceivablesMoney(ledgerContext(request), { type: "invoice.patch", ledgerId: params.id, detailId: params.invoiceId, input: { ledgerRevision: input.ledgerRevision, date: input.invoiceDate, invoiceNo: input.invoiceNo, amount: input.amount, note: input.note, revision: input.revision, reason: input.reason } }) };
  });
  app.post("/api/receivables/ledgers/:id/invoices/:invoiceId/void", { preHandler: deps.authenticate }, async (request) => { const params = detailParams.parse(request.params); return { data: await writeReceivablesMoney(ledgerContext(request), { type: "invoice.void", ledgerId: params.id, detailId: params.invoiceId, input: detailVoidInput.parse(request.body) }) }; });
  app.post("/api/receivables/ledgers/:id/receipts", { preHandler: deps.authenticate }, async (request, reply) => { const input = receiptCreateInput.parse(request.body); const id = idParams.parse(request.params); const data = await writeReceivablesMoney(ledgerContext(request), { type: "receipt.create", ledgerId: id.id, input: { ledgerRevision: input.ledgerRevision, date: input.receiptDate, referenceNo: input.referenceNo, amount: input.amount, note: input.note } }); return reply.code(201).send({ data }); });
  app.patch("/api/receivables/ledgers/:id/receipts/:receiptId", { preHandler: deps.authenticate }, async (request) => { const input = receiptPatchInput.parse(request.body); const params = receiptParams.parse(request.params); return { data: await writeReceivablesMoney(ledgerContext(request), { type: "receipt.patch", ledgerId: params.id, detailId: params.receiptId, input: { ledgerRevision: input.ledgerRevision, date: input.receiptDate, referenceNo: input.referenceNo, amount: input.amount, note: input.note, revision: input.revision, reason: input.reason } }) }; });
  app.post("/api/receivables/ledgers/:id/receipts/:receiptId/void", { preHandler: deps.authenticate }, async (request) => { const params = receiptParams.parse(request.params); return { data: await writeReceivablesMoney(ledgerContext(request), { type: "receipt.void", ledgerId: params.id, detailId: params.receiptId, input: detailVoidInput.parse(request.body) }) }; });
  app.patch("/api/receivables/ledgers/:id/writeoff", { preHandler: deps.authenticate }, async (request) => ({ data: await writeReceivablesMoney(ledgerContext(request), { type: "writeoff.patch", ledgerId: idParams.parse(request.params).id, input: writeoffInput.parse(request.body) }) }));

  app.get("/api/receivables/grants", { preHandler: deps.authenticate }, async (request) => ({ data: await administerReceivables(adminContext(request), { type: "grant.list" }) }));
  app.post("/api/receivables/grants", { preHandler: deps.authenticate }, async (request, reply) => {
    const data = await administerReceivables(adminContext(request), { type: "grant.create", input: grantCreateInput.parse(request.body) });
    return reply.code(201).send({ data });
  });
  app.patch("/api/receivables/grants/:id", { preHandler: deps.authenticate }, async (request) => ({ data: await administerReceivables(adminContext(request), { type: "grant.update", id: idParams.parse(request.params).id, input: grantPatchInput.parse(request.body) }) }));

  app.get("/api/receivables/departments", { preHandler: deps.authenticate }, async (request) => ({ data: await administerReceivables(adminContext(request), { type: "department.list" }) }));
  app.post("/api/receivables/departments", { preHandler: deps.authenticate }, async (request, reply) => {
    const data = await administerReceivables(adminContext(request), { type: "department.create", input: departmentCreateInput.parse(request.body) });
    return reply.code(201).send({ data });
  });
  app.patch("/api/receivables/departments/:id", { preHandler: deps.authenticate }, async (request) => ({ data: await administerReceivables(adminContext(request), { type: "department.update", id: idParams.parse(request.params).id, input: departmentUpdateInput.parse(request.body) }) }));

  app.get("/api/receivables/dictionary-options", { preHandler: deps.authenticate }, async (request) => {
    const { category } = z.object({ category: z.string().trim().min(1).max(80).optional() }).strict().parse(request.query);
    return { data: await administerReceivables(adminContext(request), { type: "dictionary.list", category }) };
  });
  app.post("/api/receivables/dictionary-options", { preHandler: deps.authenticate }, async (request, reply) => {
    const data = await administerReceivables(adminContext(request), { type: "dictionary.create", input: dictionaryCreateInput.parse(request.body) });
    return reply.code(201).send({ data });
  });
  app.patch("/api/receivables/dictionary-options/:id", { preHandler: deps.authenticate }, async (request) => ({ data: await administerReceivables(adminContext(request), { type: "dictionary.update", id: idParams.parse(request.params).id, input: dictionaryUpdateInput.parse(request.body) }) }));

  app.post("/api/receivables/departments/:id/migrate", { preHandler: deps.authenticate }, async (request) => ({ data: await administerReceivables(adminContext(request), { type: "department.migrate", sourceId: idParams.parse(request.params).id, input: migrationInput.parse(request.body) }) }));
  app.post("/api/receivables/dictionary-options/:id/migrate", { preHandler: deps.authenticate }, async (request) => ({ data: await administerReceivables(adminContext(request), { type: "dictionary.migrate", sourceId: idParams.parse(request.params).id, input: migrationInput.parse(request.body) }) }));
}
