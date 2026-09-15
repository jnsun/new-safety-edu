import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma, ReceivableGrantRole } from "@prisma/client";
import { z } from "zod";
import type { Principal } from "../auth.js";
import { prisma } from "../db.js";
import { requireReceivables, resolveReceivablesAccess } from "../receivables-access.js";
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
const migrationTokenLifetimeMs = 5 * 60 * 1000;

const reasonInput = z.string().trim().min(1).max(500);
const departmentScopeInput = z.object({
  departmentId: z.string().uuid(),
  canRead: z.boolean(),
  canWrite: z.boolean(),
}).strict();
const grantFields = z.object({
  role: z.enum(["admin", "reporter", "readonly"]),
  canCreate: z.boolean().default(false),
  canExport: z.boolean().default(false),
  canViewAll: z.boolean().default(false),
  departments: z.array(departmentScopeInput).max(200).default([]),
});
const validateGrantPolicy = (input: z.infer<typeof grantFields>, context: z.RefinementCtx) => {
  const ids = input.departments.map(({ departmentId }) => departmentId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "财务归属部门范围不能重复", path: ["departments"] });
  input.departments.forEach((scope, index) => {
    if (scope.canWrite && !scope.canRead) context.addIssue({ code: "custom", message: "写权限必须同时包含读权限", path: ["departments", index] });
  });
  if (input.role === "admin" && (input.canCreate || input.canExport || input.canViewAll || input.departments.length > 0)) {
    context.addIssue({ code: "custom", message: "财务管理员使用固定模块权限，不能提交范围或能力标志" });
  }
  if (input.role === "readonly" && (input.canCreate || input.departments.some(({ canWrite }) => canWrite))) {
    context.addIssue({ code: "custom", message: "财务只读授权不能包含新增或写权限" });
  }
};
const grantCreateInput = grantFields.extend({ accountId: z.string().uuid(), reason: reasonInput }).superRefine(validateGrantPolicy);
const grantUpdateInput = grantFields.extend({ revision: z.number().int().positive(), reason: reasonInput }).superRefine(validateGrantPolicy);
const grantRevokeInput = z.object({ revision: z.number().int().positive(), revoke: z.literal(true), reason: reasonInput }).strict();
const grantPatchInput = z.union([grantRevokeInput, grantUpdateInput]);
const departmentCreateInput = z.object({ name: z.string().trim().min(1).max(160), code: z.string().trim().min(1).max(40).nullable().optional(), sortOrder: z.number().int().default(0) }).strict();
const departmentUpdateInput = z.object({
  revision: z.number().int().positive(),
  name: z.string().trim().min(1).max(160).optional(),
  code: z.string().trim().min(1).max(40).nullable().optional(),
  sortOrder: z.number().int().optional(),
  active: z.literal(false).optional(),
  reason: reasonInput.optional(),
}).strict().superRefine((input, context) => {
  if (input.active === false && !input.reason) context.addIssue({ code: "custom", message: "停用财务归属部门必须填写原因", path: ["reason"] });
  if (input.name === undefined && input.code === undefined && input.sortOrder === undefined && input.active === undefined) context.addIssue({ code: "custom", message: "至少提交一个变更字段" });
});
const dictionaryCreateInput = z.object({ category: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(240), sortOrder: z.number().int().default(0) }).strict();
const dictionaryUpdateInput = z.object({
  revision: z.number().int().positive(),
  value: z.string().trim().min(1).max(240).optional(),
  sortOrder: z.number().int().optional(),
  active: z.literal(false).optional(),
  reason: reasonInput.optional(),
}).strict().superRefine((input, context) => {
  if (input.active === false && !input.reason) context.addIssue({ code: "custom", message: "停用业务字典值必须填写原因", path: ["reason"] });
  if (input.value === undefined && input.sortOrder === undefined && input.active === undefined) context.addIssue({ code: "custom", message: "至少提交一个变更字段" });
});
const migrationPreviewInput = z.object({ mode: z.literal("preview"), targetId: z.string().uuid() }).strict();
const migrationApplyInput = z.object({ mode: z.literal("apply"), targetId: z.string().uuid(), token: z.string().min(1).max(2048), reason: reasonInput, confirm: z.literal(true) }).strict();
const migrationInput = z.discriminatedUnion("mode", [migrationPreviewInput, migrationApplyInput]);
const migrationTokenPayload = z.object({ version: z.literal(1), kind: z.enum(["department", "dictionary"]), actorId: z.string().uuid(), sourceId: z.string().uuid(), targetId: z.string().uuid(), impactCount: z.number().int().nonnegative(), expiresAt: z.number().int().positive() }).strict();

const grantSelect = {
  id: true, accountId: true, role: true, canCreate: true, canExport: true, canViewAll: true, active: true, revision: true,
  grantedBy: true, grantedAt: true, revokedAt: true, revokedBy: true, revokeReason: true,
  departments: { select: { financeDepartmentId: true, canRead: true, canWrite: true }, orderBy: { financeDepartmentId: "asc" as const } },
} satisfies Prisma.ReceivableAccessGrantSelect;
const departmentSelect = { id: true, name: true, code: true, sortOrder: true, active: true, revision: true, deactivatedAt: true, deactivatedBy: true, deactivateReason: true } satisfies Prisma.ReceivableDepartmentSelect;
const dictionarySelect = { id: true, category: true, value: true, sortOrder: true, active: true, revision: true, deactivatedAt: true, deactivatedBy: true, deactivateReason: true } satisfies Prisma.ReceivableDictionaryOptionSelect;

const httpError = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const lockReceivablesSetup = (tx: Prisma.TransactionClient) =>
  tx.$queryRaw`SELECT 'locked'::text AS locked FROM pg_advisory_xact_lock(${setupLockKey})`;
const auditMetadata = (before: unknown, after: unknown, impactCount: number) => JSON.parse(JSON.stringify({ before, after, impactCount })) as Prisma.InputJsonValue;
const migrationSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw httpError(500, "RECEIVABLES_MIGRATION_SECRET_MISSING", "迁移令牌密钥未配置");
  return secret;
};
const issueMigrationToken = (payload: z.infer<typeof migrationTokenPayload>) => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", migrationSecret()).update(encoded).digest("base64url")}`;
};
const readMigrationToken = (token: string) => {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) throw httpError(400, "RECEIVABLES_MIGRATION_TOKEN_INVALID", "迁移令牌无效");
  const expected = createHmac("sha256", migrationSecret()).update(encoded).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, "base64url"); } catch { throw httpError(400, "RECEIVABLES_MIGRATION_TOKEN_INVALID", "迁移令牌无效"); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw httpError(400, "RECEIVABLES_MIGRATION_TOKEN_INVALID", "迁移令牌无效");
  let payload: z.infer<typeof migrationTokenPayload>;
  try { payload = migrationTokenPayload.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))); } catch { throw httpError(400, "RECEIVABLES_MIGRATION_TOKEN_INVALID", "迁移令牌无效"); }
  if (payload.expiresAt <= Date.now()) throw httpError(400, "RECEIVABLES_MIGRATION_TOKEN_EXPIRED", "迁移令牌已过期");
  return payload;
};
const assertMigrationToken = (payload: z.infer<typeof migrationTokenPayload>, expected: { kind: "department" | "dictionary"; actorId: string; sourceId: string; targetId: string }) => {
  if (payload.kind !== expected.kind || payload.actorId !== expected.actorId || payload.sourceId !== expected.sourceId || payload.targetId !== expected.targetId) {
    throw httpError(400, "RECEIVABLES_MIGRATION_TOKEN_MISMATCH", "迁移令牌与当前请求不匹配");
  }
};

async function validateGrantDepartments(tx: Prisma.TransactionClient, input: { role: ReceivableGrantRole; departments: Array<{ departmentId: string; canRead: boolean; canWrite: boolean }> }) {
  if (input.role === "admin" || input.departments.length === 0) return;
  const ids = input.departments.map(({ departmentId }) => departmentId);
  const count = await tx.receivableDepartment.count({ where: { id: { in: ids }, active: true } });
  if (count !== ids.length) throw httpError(409, "RECEIVABLES_DEPARTMENT_INACTIVE", "授权范围包含不存在或已停用的财务归属部门");
}

async function assertActiveGrantSubject(tx: Prisma.TransactionClient, accountId: string) {
  const account = await tx.account.findUnique({ where: { id: accountId }, select: { status: true, personId: true, person: { select: { status: true } } } });
  if (!account || account.status !== "active" || !account.personId || account.person?.status !== "active") {
    throw httpError(409, "RECEIVABLES_GRANT_SUBJECT_INACTIVE", "财务授权对象必须是已启用账号并关联已启用人员");
  }
}

async function dictionaryImpactCount(tx: Prisma.TransactionClient, category: string, value: string) {
  switch (category) {
    case "project_status": return tx.receivableLedger.count({ where: { projectStatus: value } });
    case "final_method": return tx.receivableLedger.count({ where: { settlementMethod: value } });
    case "debt_status": return tx.receivableLedger.count({ where: { debtStatus: value } });
    case "client_attr": return tx.receivableLedger.count({ where: { customerType: value } });
    case "unit": return tx.receivableLedger.count({ where: { creditorUnit: value } });
    case "work_nature": return tx.receivableLedger.count({ where: { workNature: value } });
    case "sector": return tx.receivableLedger.count({ where: { sector: value } });
    case "attach_category": return tx.receivableAttachment.count({ where: { category: value } });
    default: return 0;
  }
}

async function migrateDictionaryValue(tx: Prisma.TransactionClient, category: string, sourceValue: string, targetValue: string) {
  switch (category) {
    case "project_status": return (await tx.receivableLedger.updateMany({ where: { projectStatus: sourceValue }, data: { projectStatus: targetValue, revision: { increment: 1 } } })).count;
    case "final_method": return (await tx.receivableLedger.updateMany({ where: { settlementMethod: sourceValue }, data: { settlementMethod: targetValue, revision: { increment: 1 } } })).count;
    case "debt_status": return (await tx.receivableLedger.updateMany({ where: { debtStatus: sourceValue }, data: { debtStatus: targetValue, revision: { increment: 1 } } })).count;
    case "client_attr": return (await tx.receivableLedger.updateMany({ where: { customerType: sourceValue }, data: { customerType: targetValue, revision: { increment: 1 } } })).count;
    case "unit": return (await tx.receivableLedger.updateMany({ where: { creditorUnit: sourceValue }, data: { creditorUnit: targetValue, revision: { increment: 1 } } })).count;
    case "work_nature": return (await tx.receivableLedger.updateMany({ where: { workNature: sourceValue }, data: { workNature: targetValue, revision: { increment: 1 } } })).count;
    case "sector": return (await tx.receivableLedger.updateMany({ where: { sector: sourceValue }, data: { sector: targetValue, revision: { increment: 1 } } })).count;
    case "attach_category": return (await tx.receivableAttachment.updateMany({ where: { category: sourceValue }, data: { category: targetValue, revision: { increment: 1 } } })).count;
    default: return 0;
  }
}

export async function registerReceivablesRoutes(app: FastifyInstance, deps: RouteDependencies) {
  app.get("/api/receivables/access", { preHandler: deps.authenticate }, async (request) => ({
    data: await resolveReceivablesAccess(request.principal as Principal),
  }));

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

      const previous = await tx.receivableSetting.findUnique({
        where: { id: 1 },
        select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true },
      });
      const isRebind = !!previous?.financeOrganizationId && previous.financeOrganizationId !== organization.id;
      if (isRebind && (input.confirm !== true || !input.reason)) {
        throw httpError(400, "RECEIVABLES_REBIND_CONFIRMATION_REQUIRED", "换绑必须填写原因并二次确认");
      }
      if (previous?.financeOrganizationId === organization.id) {
        return resolveReceivablesAccess(principal, tx);
      }

      await tx.receivableSetting.upsert({
        where: { id: 1 },
        create: { id: 1, financeOrganizationId: organization.id },
        update: { financeOrganizationId: organization.id, configurationConfirmedAt: null, configurationConfirmedBy: null },
      });
      await writeCriticalAudit(tx, {
        actorId: principal.accountId,
        action: isRebind ? "receivables.setup.rebind" : "receivables.setup.bind",
        objectType: "receivable_setting",
        objectId: organization.id,
        requestId: request.id,
        actorRole: "company_admin",
        actorScopeType: "company",
        ...(input.reason ? { reason: input.reason } : {}),
        metadata: {
          before: previous ?? null,
          after: { financeOrganizationId: organization.id, configurationConfirmedAt: null, configurationConfirmedBy: null },
        },
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
      const setting = await tx.receivableSetting.findUniqueOrThrow({
        where: { id: 1 },
        select: { financeOrganizationId: true, configurationConfirmedAt: true, configurationConfirmedBy: true },
      });
      const confirmedAt = new Date();
      await tx.receivableSetting.update({
        where: { id: 1 },
        data: { configurationConfirmedAt: confirmedAt, configurationConfirmedBy: principal.accountId },
      });
      await writeCriticalAudit(tx, {
        actorId: principal.accountId,
        action: "receivables.setup.confirm",
        objectType: "receivable_setting",
        objectId: setting.financeOrganizationId,
        requestId: request.id,
        actorRole: "owner",
        actorScopeType: "organization",
        actorScopeId: setting.financeOrganizationId,
        metadata: {
          before: setting,
          after: { ...setting, configurationConfirmedAt: confirmedAt, configurationConfirmedBy: principal.accountId },
        },
      });
      return resolveReceivablesAccess(principal, tx);
    });
    return { data };
  });

  app.get("/api/receivables/grants", { preHandler: deps.authenticate }, async (request) => {
    const principal = request.principal as Principal;
    requireReceivables(await resolveReceivablesAccess(principal), "manageAccess");
    return { data: await prisma.receivableAccessGrant.findMany({ select: grantSelect, orderBy: [{ active: "desc" }, { grantedAt: "desc" }] }) };
  });

  app.post("/api/receivables/grants", { preHandler: deps.authenticate }, async (request, reply) => {
    const input = grantCreateInput.parse(request.body);
    const principal = request.principal as Principal;
    const data = await prisma.$transaction(async (tx) => {
      const access = await resolveReceivablesAccess(principal, tx);
      requireReceivables(access, "manageAccess");
      await assertActiveGrantSubject(tx, input.accountId);
      await validateGrantDepartments(tx, input);
      const created = await tx.receivableAccessGrant.create({
        data: {
          accountId: input.accountId,
          role: input.role,
          canCreate: input.canCreate,
          canExport: input.canExport,
          canViewAll: input.canViewAll,
          grantedBy: principal.accountId,
          departments: { create: input.departments.map(({ departmentId, canRead, canWrite }) => ({ financeDepartmentId: departmentId, canRead, canWrite })) },
        },
        select: grantSelect,
      });
      await writeCriticalAudit(tx, {
        actorId: principal.accountId, action: "receivables.admin.grant.create", objectType: "receivable_access_grant", objectId: created.id,
        requestId: request.id, actorRole: access.role, actorScopeType: "receivables", reason: input.reason,
        metadata: auditMetadata(null, created, 1),
      });
      return created;
    });
    return reply.code(201).send({ data });
  });

  app.patch("/api/receivables/grants/:id", { preHandler: deps.authenticate }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = grantPatchInput.parse(request.body);
    const principal = request.principal as Principal;
    const data = await prisma.$transaction(async (tx) => {
      const access = await resolveReceivablesAccess(principal, tx);
      requireReceivables(access, "manageAccess");
      const before = await tx.receivableAccessGrant.findUnique({ where: { id }, select: grantSelect });
      if (!before) throw httpError(404, "RECEIVABLES_GRANT_NOT_FOUND", "财务授权不存在");
      if (!before.active || before.revokedAt) throw httpError(409, "RECEIVABLES_GRANT_INACTIVE", "财务授权已撤销");
      if (before.revision !== input.revision) throw httpError(409, "RECEIVABLES_REVISION_CONFLICT", "财务授权已被其他操作更新");
      await assertActiveGrantSubject(tx, before.accountId);

      if ("revoke" in input) {
        const result = await tx.receivableAccessGrant.updateMany({
          where: { id, revision: input.revision, active: true, revokedAt: null },
          data: { active: false, revision: { increment: 1 }, revokedAt: new Date(), revokedBy: principal.accountId, revokeReason: input.reason },
        });
        if (result.count !== 1) throw httpError(409, "RECEIVABLES_REVISION_CONFLICT", "财务授权已被其他操作更新");
        const after = await tx.receivableAccessGrant.findUniqueOrThrow({ where: { id }, select: grantSelect });
        await writeCriticalAudit(tx, {
          actorId: principal.accountId, action: "receivables.admin.grant.revoke", objectType: "receivable_access_grant", objectId: id,
          requestId: request.id, actorRole: access.role, actorScopeType: "receivables", reason: input.reason,
          metadata: auditMetadata(before, after, 1),
        });
        return after;
      }

      await validateGrantDepartments(tx, input);
      const result = await tx.receivableAccessGrant.updateMany({
        where: { id, revision: input.revision, active: true, revokedAt: null },
        data: { role: input.role, canCreate: input.canCreate, canExport: input.canExport, canViewAll: input.canViewAll, revision: { increment: 1 } },
      });
      if (result.count !== 1) throw httpError(409, "RECEIVABLES_REVISION_CONFLICT", "财务授权已被其他操作更新");
      await tx.receivableGrantDepartment.deleteMany({ where: { grantId: id } });
      if (input.departments.length) {
        await tx.receivableGrantDepartment.createMany({ data: input.departments.map(({ departmentId, canRead, canWrite }) => ({ grantId: id, financeDepartmentId: departmentId, canRead, canWrite })) });
      }
      const after = await tx.receivableAccessGrant.findUniqueOrThrow({ where: { id }, select: grantSelect });
      await writeCriticalAudit(tx, {
        actorId: principal.accountId, action: "receivables.admin.grant.update", objectType: "receivable_access_grant", objectId: id,
        requestId: request.id, actorRole: access.role, actorScopeType: "receivables", reason: input.reason,
        metadata: auditMetadata(before, after, 1),
      });
      return after;
    });
    return { data };
  });

  app.get("/api/receivables/departments", { preHandler: deps.authenticate }, async (request) => {
    const principal = request.principal as Principal;
    requireReceivables(await resolveReceivablesAccess(principal), "manageConfiguration");
    return { data: await prisma.receivableDepartment.findMany({ select: departmentSelect, orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }] }) };
  });

  app.post("/api/receivables/departments", { preHandler: deps.authenticate }, async (request, reply) => {
    const input = departmentCreateInput.parse(request.body);
    const principal = request.principal as Principal;
    const data = await prisma.$transaction(async (tx) => {
      const access = await resolveReceivablesAccess(principal, tx);
      requireReceivables(access, "manageConfiguration");
      const created = await tx.receivableDepartment.create({ data: { name: input.name, sortOrder: input.sortOrder, ...(input.code === undefined ? {} : { code: input.code }) }, select: departmentSelect });
      await writeCriticalAudit(tx, {
        actorId: principal.accountId, action: "receivables.admin.department.create", objectType: "receivable_department", objectId: created.id,
        requestId: request.id, actorRole: access.role, actorScopeType: "receivables", metadata: auditMetadata(null, created, 0),
      });
      return created;
    });
    return reply.code(201).send({ data });
  });

  app.patch("/api/receivables/departments/:id", { preHandler: deps.authenticate }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = departmentUpdateInput.parse(request.body);
    const principal = request.principal as Principal;
    const data = await prisma.$transaction(async (tx) => {
      const access = await resolveReceivablesAccess(principal, tx);
      requireReceivables(access, "manageConfiguration");
      const before = await tx.receivableDepartment.findUnique({ where: { id }, select: departmentSelect });
      if (!before) throw httpError(404, "RECEIVABLES_DEPARTMENT_NOT_FOUND", "财务归属部门不存在");
      if (before.revision !== input.revision) throw httpError(409, "RECEIVABLES_REVISION_CONFLICT", "财务归属部门已被其他操作更新");
      if (!before.active && input.active === false) throw httpError(409, "RECEIVABLES_DEPARTMENT_INACTIVE", "财务归属部门已经停用");
      const impactCount = await tx.receivableLedger.count({ where: { financeDepartmentId: id } });
      if (input.name !== undefined && input.name !== before.name && impactCount > 0) throw httpError(409, "RECEIVABLES_DEPARTMENT_RENAME_IN_USE", "在用财务归属部门须停用旧项并新建新项");
      const updateData: Prisma.ReceivableDepartmentUncheckedUpdateManyInput = { revision: { increment: 1 } };
      if (input.name !== undefined) updateData.name = input.name;
      if (input.code !== undefined) updateData.code = input.code;
      if (input.sortOrder !== undefined) updateData.sortOrder = input.sortOrder;
      if (input.active === false) Object.assign(updateData, { active: false, deactivatedAt: new Date(), deactivatedBy: principal.accountId, deactivateReason: input.reason! });
      const result = await tx.receivableDepartment.updateMany({ where: { id, revision: input.revision }, data: updateData });
      if (result.count !== 1) throw httpError(409, "RECEIVABLES_REVISION_CONFLICT", "财务归属部门已被其他操作更新");
      const after = await tx.receivableDepartment.findUniqueOrThrow({ where: { id }, select: departmentSelect });
      await writeCriticalAudit(tx, {
        actorId: principal.accountId, action: input.active === false ? "receivables.admin.department.deactivate" : "receivables.admin.department.update",
        objectType: "receivable_department", objectId: id, requestId: request.id, actorRole: access.role, actorScopeType: "receivables",
        ...(input.reason ? { reason: input.reason } : {}), metadata: auditMetadata(before, after, impactCount),
      });
      return after;
    });
    return { data };
  });

  app.get("/api/receivables/dictionary-options", { preHandler: deps.authenticate }, async (request) => {
    const principal = request.principal as Principal;
    requireReceivables(await resolveReceivablesAccess(principal), "manageConfiguration");
    const { category } = z.object({ category: z.string().trim().min(1).max(80).optional() }).parse(request.query);
    return { data: await prisma.receivableDictionaryOption.findMany({ ...(category ? { where: { category } } : {}), select: dictionarySelect, orderBy: [{ category: "asc" }, { active: "desc" }, { sortOrder: "asc" }, { value: "asc" }] }) };
  });

  app.post("/api/receivables/dictionary-options", { preHandler: deps.authenticate }, async (request, reply) => {
    const input = dictionaryCreateInput.parse(request.body);
    const principal = request.principal as Principal;
    const data = await prisma.$transaction(async (tx) => {
      const access = await resolveReceivablesAccess(principal, tx);
      requireReceivables(access, "manageConfiguration");
      const created = await tx.receivableDictionaryOption.create({ data: input, select: dictionarySelect });
      await writeCriticalAudit(tx, {
        actorId: principal.accountId, action: "receivables.admin.dictionary.create", objectType: "receivable_dictionary_option", objectId: created.id,
        requestId: request.id, actorRole: access.role, actorScopeType: "receivables", metadata: auditMetadata(null, created, 0),
      });
      return created;
    });
    return reply.code(201).send({ data });
  });

  app.patch("/api/receivables/dictionary-options/:id", { preHandler: deps.authenticate }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = dictionaryUpdateInput.parse(request.body);
    const principal = request.principal as Principal;
    const data = await prisma.$transaction(async (tx) => {
      const access = await resolveReceivablesAccess(principal, tx);
      requireReceivables(access, "manageConfiguration");
      const before = await tx.receivableDictionaryOption.findUnique({ where: { id }, select: dictionarySelect });
      if (!before) throw httpError(404, "RECEIVABLES_DICTIONARY_NOT_FOUND", "业务字典值不存在");
      if (before.revision !== input.revision) throw httpError(409, "RECEIVABLES_REVISION_CONFLICT", "业务字典值已被其他操作更新");
      if (!before.active && input.active === false) throw httpError(409, "RECEIVABLES_DICTIONARY_INACTIVE", "业务字典值已经停用");
      const impactCount = await dictionaryImpactCount(tx, before.category, before.value);
      if (input.value !== undefined && input.value !== before.value && impactCount > 0) throw httpError(409, "RECEIVABLES_DICTIONARY_RENAME_IN_USE", "在用业务字典值须停用旧项并新建新项");
      const updateData: Prisma.ReceivableDictionaryOptionUncheckedUpdateManyInput = { revision: { increment: 1 } };
      if (input.value !== undefined) updateData.value = input.value;
      if (input.sortOrder !== undefined) updateData.sortOrder = input.sortOrder;
      if (input.active === false) Object.assign(updateData, { active: false, deactivatedAt: new Date(), deactivatedBy: principal.accountId, deactivateReason: input.reason! });
      const result = await tx.receivableDictionaryOption.updateMany({ where: { id, revision: input.revision }, data: updateData });
      if (result.count !== 1) throw httpError(409, "RECEIVABLES_REVISION_CONFLICT", "业务字典值已被其他操作更新");
      const after = await tx.receivableDictionaryOption.findUniqueOrThrow({ where: { id }, select: dictionarySelect });
      await writeCriticalAudit(tx, {
        actorId: principal.accountId, action: input.active === false ? "receivables.admin.dictionary.deactivate" : "receivables.admin.dictionary.update",
        objectType: "receivable_dictionary_option", objectId: id, requestId: request.id, actorRole: access.role, actorScopeType: "receivables",
        ...(input.reason ? { reason: input.reason } : {}), metadata: auditMetadata(before, after, impactCount),
      });
      return after;
    });
    return { data };
  });

  app.post("/api/receivables/departments/:id/migrate", { preHandler: deps.authenticate }, async (request) => {
    const { id: sourceId } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = migrationInput.parse(request.body);
    const principal = request.principal as Principal;
    requireReceivables(await resolveReceivablesAccess(principal), "manageAccess");
    if (sourceId === input.targetId) throw httpError(400, "RECEIVABLES_MIGRATION_TARGET_INVALID", "迁移目标不能与来源相同");
    if (input.mode === "preview") {
      const preview = await prisma.$transaction(async (tx) => {
        const access = await resolveReceivablesAccess(principal, tx);
        requireReceivables(access, "manageAccess");
        const [source, target, impactCount] = await Promise.all([
          tx.receivableDepartment.findUnique({ where: { id: sourceId }, select: departmentSelect }),
          tx.receivableDepartment.findUnique({ where: { id: input.targetId }, select: departmentSelect }),
          tx.receivableLedger.count({ where: { financeDepartmentId: sourceId } }),
        ]);
        if (!source) throw httpError(404, "RECEIVABLES_DEPARTMENT_NOT_FOUND", "迁移来源部门不存在");
        if (!target || !target.active) throw httpError(409, "RECEIVABLES_MIGRATION_TARGET_INACTIVE", "迁移目标部门不存在或已停用");
        return { impactCount, expiresAt: Date.now() + migrationTokenLifetimeMs };
      });
      return { data: { ...preview, token: issueMigrationToken({ version: 1, kind: "department", actorId: principal.accountId, sourceId, targetId: input.targetId, ...preview }), expiresAt: new Date(preview.expiresAt).toISOString() } };
    }
    const payload = readMigrationToken(input.token);
    assertMigrationToken(payload, { kind: "department", actorId: principal.accountId, sourceId, targetId: input.targetId });
    const data = await prisma.$transaction(async (tx) => {
      const access = await resolveReceivablesAccess(principal, tx);
      requireReceivables(access, "manageAccess");
      const [source, target, impactCount] = await Promise.all([
        tx.receivableDepartment.findUnique({ where: { id: sourceId }, select: departmentSelect }),
        tx.receivableDepartment.findUnique({ where: { id: input.targetId }, select: departmentSelect }),
        tx.receivableLedger.count({ where: { financeDepartmentId: sourceId } }),
      ]);
      if (!source) throw httpError(404, "RECEIVABLES_DEPARTMENT_NOT_FOUND", "迁移来源部门不存在");
      if (!target || !target.active) throw httpError(409, "RECEIVABLES_MIGRATION_TARGET_INACTIVE", "迁移目标部门不存在或已停用");
      if (impactCount !== payload.impactCount) throw httpError(409, "RECEIVABLES_MIGRATION_IMPACT_CHANGED", "迁移影响数量已变化，请重新预览");
      const updated = await tx.receivableLedger.updateMany({ where: { financeDepartmentId: sourceId }, data: { financeDepartmentId: input.targetId, revision: { increment: 1 } } });
      if (updated.count !== impactCount) throw httpError(409, "RECEIVABLES_MIGRATION_IMPACT_CHANGED", "迁移影响数量已变化，请重新预览");
      await writeCriticalAudit(tx, {
        actorId: principal.accountId, action: "receivables.admin.department.migrate", objectType: "receivable_department", objectId: sourceId,
        requestId: request.id, actorRole: access.role, actorScopeType: "receivables", reason: input.reason,
        metadata: auditMetadata({ source, target }, { source, target, migratedTo: target.id }, impactCount),
      });
      return { impactCount };
    });
    return { data };
  });

  app.post("/api/receivables/dictionary-options/:id/migrate", { preHandler: deps.authenticate }, async (request) => {
    const { id: sourceId } = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = migrationInput.parse(request.body);
    const principal = request.principal as Principal;
    requireReceivables(await resolveReceivablesAccess(principal), "manageAccess");
    if (sourceId === input.targetId) throw httpError(400, "RECEIVABLES_MIGRATION_TARGET_INVALID", "迁移目标不能与来源相同");
    if (input.mode === "preview") {
      const preview = await prisma.$transaction(async (tx) => {
        const access = await resolveReceivablesAccess(principal, tx);
        requireReceivables(access, "manageAccess");
        const [source, target] = await Promise.all([
          tx.receivableDictionaryOption.findUnique({ where: { id: sourceId }, select: dictionarySelect }),
          tx.receivableDictionaryOption.findUnique({ where: { id: input.targetId }, select: dictionarySelect }),
        ]);
        if (!source) throw httpError(404, "RECEIVABLES_DICTIONARY_NOT_FOUND", "迁移来源字典值不存在");
        if (!target || !target.active || target.category !== source.category) throw httpError(409, "RECEIVABLES_MIGRATION_TARGET_INACTIVE", "迁移目标字典值不存在、已停用或类别不同");
        return { impactCount: await dictionaryImpactCount(tx, source.category, source.value), expiresAt: Date.now() + migrationTokenLifetimeMs };
      });
      return { data: { ...preview, token: issueMigrationToken({ version: 1, kind: "dictionary", actorId: principal.accountId, sourceId, targetId: input.targetId, ...preview }), expiresAt: new Date(preview.expiresAt).toISOString() } };
    }
    const payload = readMigrationToken(input.token);
    assertMigrationToken(payload, { kind: "dictionary", actorId: principal.accountId, sourceId, targetId: input.targetId });
    const data = await prisma.$transaction(async (tx) => {
      const access = await resolveReceivablesAccess(principal, tx);
      requireReceivables(access, "manageAccess");
      const [source, target] = await Promise.all([
        tx.receivableDictionaryOption.findUnique({ where: { id: sourceId }, select: dictionarySelect }),
        tx.receivableDictionaryOption.findUnique({ where: { id: input.targetId }, select: dictionarySelect }),
      ]);
      if (!source) throw httpError(404, "RECEIVABLES_DICTIONARY_NOT_FOUND", "迁移来源字典值不存在");
      if (!target || !target.active || target.category !== source.category) throw httpError(409, "RECEIVABLES_MIGRATION_TARGET_INACTIVE", "迁移目标字典值不存在、已停用或类别不同");
      const impactCount = await dictionaryImpactCount(tx, source.category, source.value);
      if (impactCount !== payload.impactCount) throw httpError(409, "RECEIVABLES_MIGRATION_IMPACT_CHANGED", "迁移影响数量已变化，请重新预览");
      const updatedCount = await migrateDictionaryValue(tx, source.category, source.value, target.value);
      if (updatedCount !== impactCount) throw httpError(409, "RECEIVABLES_MIGRATION_IMPACT_CHANGED", "迁移影响数量已变化，请重新预览");
      await writeCriticalAudit(tx, {
        actorId: principal.accountId, action: "receivables.admin.dictionary.migrate", objectType: "receivable_dictionary_option", objectId: sourceId,
        requestId: request.id, actorRole: access.role, actorScopeType: "receivables", reason: input.reason,
        metadata: auditMetadata({ source, target }, { source, target, migratedTo: target.id }, impactCount),
      });
      return { impactCount };
    });
    return { data };
  });
}
