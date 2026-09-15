import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, type ReceivableGrantRole } from "@prisma/client";
import { z } from "zod";
import type { Principal } from "./auth.js";
import { prisma } from "./db.js";
import { requireReceivables, resolveReceivablesAccess, type ReceivablesAction } from "./receivables-access.js";
import { writeCriticalAudit } from "./transaction-audit.js";

type GrantScope = { departmentId: string; canRead: boolean; canWrite: boolean };
type GrantFields = { role: ReceivableGrantRole; canCreate: boolean; canExport: boolean; canViewAll: boolean; departments: GrantScope[] };
type MigrationInput =
  | { mode: "preview"; targetId: string }
  | { mode: "apply"; targetId: string; token: string; reason: string; confirm: true };

export type ReceivablesAdminOperation =
  | { type: "grant.list" }
  | { type: "grant.create"; input: GrantFields & { accountId: string; reason: string } }
  | { type: "grant.update"; id: string; input: (GrantFields & { revision: number; reason: string }) | { revision: number; revoke: true; reason: string } }
  | { type: "department.list" }
  | { type: "department.create"; input: { name: string; code?: string | null | undefined; sortOrder: number } }
  | { type: "department.update"; id: string; input: { revision: number; name?: string | undefined; code?: string | null | undefined; sortOrder?: number | undefined; active?: false | undefined; reason?: string | undefined } }
  | { type: "dictionary.list"; category?: string | undefined }
  | { type: "dictionary.create"; input: { category: string; value: string; sortOrder: number } }
  | { type: "dictionary.update"; id: string; input: { revision: number; value?: string | undefined; sortOrder?: number | undefined; active?: false | undefined; reason?: string | undefined } }
  | { type: "department.migrate"; sourceId: string; input: MigrationInput }
  | { type: "dictionary.migrate"; sourceId: string; input: MigrationInput };

export type ReceivablesAdminContext = { principal: Principal; requestId: string };

const migrationTokenLifetimeMs = 5 * 60 * 1000;
const httpError = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const migrationStateChanged = () => httpError(409, "RECEIVABLES_MIGRATION_STATE_CHANGED", "迁移状态已变化，请重新预览");
const auditMetadata = (before: unknown, after: unknown, impactCount: number) => JSON.parse(JSON.stringify({ before, after, impactCount })) as Prisma.InputJsonValue;

async function runMigrationApply<T>(apply: () => Promise<T>) {
  try {
    return await apply();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw migrationStateChanged();
    throw error;
  }
}

const grantSelect = {
  id: true, accountId: true, role: true, canCreate: true, canExport: true, canViewAll: true, active: true, revision: true,
  grantedBy: true, grantedAt: true, revokedAt: true, revokedBy: true, revokeReason: true,
  departments: { select: { financeDepartmentId: true, canRead: true, canWrite: true }, orderBy: { financeDepartmentId: "asc" as const } },
} satisfies Prisma.ReceivableAccessGrantSelect;
const departmentSelect = { id: true, name: true, code: true, sortOrder: true, active: true, revision: true, deactivatedAt: true, deactivatedBy: true, deactivateReason: true } satisfies Prisma.ReceivableDepartmentSelect;
const dictionarySelect = { id: true, category: true, value: true, sortOrder: true, active: true, revision: true, deactivatedAt: true, deactivatedBy: true, deactivateReason: true } satisfies Prisma.ReceivableDictionaryOptionSelect;
type GrantRow = Prisma.ReceivableAccessGrantGetPayload<{ select: typeof grantSelect }>;
type DepartmentRow = Prisma.ReceivableDepartmentGetPayload<{ select: typeof departmentSelect }>;
type DictionaryRow = Prisma.ReceivableDictionaryOptionGetPayload<{ select: typeof dictionarySelect }>;
export type ReceivablesAdminResult = GrantRow | GrantRow[] | DepartmentRow | DepartmentRow[] | DictionaryRow | DictionaryRow[] | { impactCount: number } | { impactCount: number; token: string; expiresAt: string };

const migrationTokenPayload = z.object({
  version: z.literal(2),
  kind: z.enum(["department", "dictionary"]),
  actorId: z.string().uuid(),
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  sourceRevision: z.number().int().positive(),
  targetRevision: z.number().int().positive(),
  impactCount: z.number().int().nonnegative(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().int().positive(),
}).strict();
type MigrationTokenPayload = z.infer<typeof migrationTokenPayload>;
type AffectedRow = { id: string; revision: number };

const migrationSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw httpError(500, "RECEIVABLES_MIGRATION_SECRET_MISSING", "迁移令牌密钥未配置");
  return secret;
};

const issueMigrationToken = (payload: MigrationTokenPayload) => {
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
  let payload: MigrationTokenPayload;
  try { payload = migrationTokenPayload.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))); } catch { throw httpError(400, "RECEIVABLES_MIGRATION_TOKEN_INVALID", "迁移令牌无效"); }
  if (payload.expiresAt <= Date.now()) throw httpError(400, "RECEIVABLES_MIGRATION_TOKEN_EXPIRED", "迁移令牌已过期");
  return payload;
};

const fingerprint = (rows: AffectedRow[]) => createHash("sha256")
  .update([...rows].sort((left, right) => left.id.localeCompare(right.id)).map(({ id, revision }) => `${id}:${revision}`).join("\n"))
  .digest("hex");

const migrationSnapshot = (rows: AffectedRow[]) => ({ impactCount: rows.length, fingerprint: fingerprint(rows) });

function validateGrantPolicy(input: GrantFields) {
  const ids = input.departments.map(({ departmentId }) => departmentId);
  if (new Set(ids).size !== ids.length) throw httpError(400, "RECEIVABLES_GRANT_SCOPE_DUPLICATE", "财务归属部门范围不能重复");
  if (input.departments.some(({ canRead, canWrite }) => canWrite && !canRead)) throw httpError(400, "RECEIVABLES_GRANT_SCOPE_INVALID", "写权限必须同时包含读权限");
  if (input.role === "admin" && (input.canCreate || input.canExport || input.canViewAll || input.departments.length > 0)) throw httpError(400, "RECEIVABLES_ADMIN_FLAGS_INVALID", "财务管理员使用固定模块权限，不能提交范围或能力标志");
  if (input.role === "readonly" && (input.canCreate || input.departments.some(({ canWrite }) => canWrite))) throw httpError(400, "RECEIVABLES_READONLY_FLAGS_INVALID", "财务只读授权不能包含新增或写权限");
}

async function requireAction(context: ReceivablesAdminContext, action: ReceivablesAction, tx?: Prisma.TransactionClient) {
  const access = await resolveReceivablesAccess(context.principal, tx ?? prisma);
  requireReceivables(access, action);
  return access;
}

async function validateGrantDepartments(tx: Prisma.TransactionClient, input: GrantFields) {
  if (input.role === "admin" || input.departments.length === 0) return;
  const ids = input.departments.map(({ departmentId }) => departmentId);
  const count = await tx.receivableDepartment.count({ where: { id: { in: ids }, active: true } });
  if (count !== ids.length) throw httpError(409, "RECEIVABLES_DEPARTMENT_INACTIVE", "授权范围包含不存在或已停用的财务归属部门");
}

async function assertActiveGrantSubject(tx: Prisma.TransactionClient, accountId: string) {
  const account = await tx.account.findUnique({ where: { id: accountId }, select: { status: true, personId: true, person: { select: { status: true } } } });
  if (!account || account.status !== "active" || !account.personId || account.person?.status !== "active") throw httpError(409, "RECEIVABLES_GRANT_SUBJECT_INACTIVE", "财务授权对象必须是已启用账号并关联已启用人员");
}

type DictionaryMigration = {
  affected(tx: Prisma.TransactionClient, value: string): Promise<AffectedRow[]>;
  apply(tx: Prisma.TransactionClient, ids: string[], sourceValue: string, targetValue: string): Promise<number>;
};

type LedgerDictionaryField = "projectStatus" | "settlementMethod" | "debtStatus" | "customerType" | "creditorUnit" | "workNature" | "sector";
const ledgerDictionaryMigration = (field: LedgerDictionaryField): DictionaryMigration => ({
  affected: (tx, value) => tx.receivableLedger.findMany({ where: { [field]: value } as Prisma.ReceivableLedgerWhereInput, select: { id: true, revision: true }, orderBy: { id: "asc" } }),
  apply: async (tx, ids, sourceValue, targetValue) => (await tx.receivableLedger.updateMany({
    where: { id: { in: ids }, [field]: sourceValue } as Prisma.ReceivableLedgerWhereInput,
    data: { [field]: targetValue, revision: { increment: 1 } } as Prisma.ReceivableLedgerUpdateManyMutationInput,
  })).count,
});

const dictionaryMigrations: Record<string, DictionaryMigration> = {
  project_status: ledgerDictionaryMigration("projectStatus"),
  final_method: ledgerDictionaryMigration("settlementMethod"),
  debt_status: ledgerDictionaryMigration("debtStatus"),
  client_attr: ledgerDictionaryMigration("customerType"),
  unit: ledgerDictionaryMigration("creditorUnit"),
  work_nature: ledgerDictionaryMigration("workNature"),
  sector: ledgerDictionaryMigration("sector"),
  attach_category: {
    affected: (tx, value) => tx.receivableAttachment.findMany({ where: { category: value }, select: { id: true, revision: true }, orderBy: { id: "asc" } }),
    apply: async (tx, ids, sourceValue, targetValue) => (await tx.receivableAttachment.updateMany({ where: { id: { in: ids }, category: sourceValue }, data: { category: targetValue, revision: { increment: 1 } } })).count,
  },
};

const assertSourceAndTarget = (source: { active: boolean } | null, target: { active: boolean } | null, noun: string) => {
  if (!source) throw httpError(404, "RECEIVABLES_MIGRATION_SOURCE_NOT_FOUND", `迁移来源${noun}不存在`);
  if (source.active) throw httpError(409, "RECEIVABLES_MIGRATION_SOURCE_ACTIVE", `迁移来源${noun}必须先停用`);
  if (!target || !target.active) throw httpError(409, "RECEIVABLES_MIGRATION_TARGET_INACTIVE", `迁移目标${noun}不存在或已停用`);
};

const assertTokenIdentity = (payload: MigrationTokenPayload, expected: { kind: "department" | "dictionary"; actorId: string; sourceId: string; targetId: string }) => {
  if (payload.kind !== expected.kind || payload.actorId !== expected.actorId || payload.sourceId !== expected.sourceId || payload.targetId !== expected.targetId) throw httpError(400, "RECEIVABLES_MIGRATION_TOKEN_MISMATCH", "迁移令牌与当前请求不匹配");
};

const assertTokenFresh = (payload: MigrationTokenPayload, sourceRevision: number, targetRevision: number, snapshot: ReturnType<typeof migrationSnapshot>) => {
  if (payload.sourceRevision !== sourceRevision || payload.targetRevision !== targetRevision || payload.impactCount !== snapshot.impactCount || payload.fingerprint !== snapshot.fingerprint) throw migrationStateChanged();
};

async function createGrant(context: ReceivablesAdminContext, input: Extract<ReceivablesAdminOperation, { type: "grant.create" }>["input"]) {
  validateGrantPolicy(input);
  return prisma.$transaction(async (tx) => {
    const access = await requireAction(context, "manageAccess", tx);
    await assertActiveGrantSubject(tx, input.accountId);
    await validateGrantDepartments(tx, input);
    const created = await tx.receivableAccessGrant.create({ data: {
      accountId: input.accountId, role: input.role, canCreate: input.canCreate, canExport: input.canExport, canViewAll: input.canViewAll, grantedBy: context.principal.accountId,
      departments: { create: input.departments.map(({ departmentId, canRead, canWrite }) => ({ financeDepartmentId: departmentId, canRead, canWrite })) },
    }, select: grantSelect });
    await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: "receivables.admin.grant.create", objectType: "receivable_access_grant", objectId: created.id, requestId: context.requestId, actorRole: access.role, actorScopeType: "receivables", reason: input.reason, metadata: auditMetadata(null, created, 1) });
    return created;
  });
}

async function updateGrant(context: ReceivablesAdminContext, id: string, input: Extract<ReceivablesAdminOperation, { type: "grant.update" }>["input"]) {
  if (!("revoke" in input)) validateGrantPolicy(input);
  return prisma.$transaction(async (tx) => {
    const access = await requireAction(context, "manageAccess", tx);
    const before = await tx.receivableAccessGrant.findUnique({ where: { id }, select: grantSelect });
    if (!before) throw httpError(404, "RECEIVABLES_GRANT_NOT_FOUND", "财务授权不存在");
    if (!before.active || before.revokedAt) throw httpError(409, "RECEIVABLES_GRANT_INACTIVE", "财务授权已撤销");
    if (before.revision !== input.revision) throw httpError(409, "RECEIVABLES_REVISION_CONFLICT", "财务授权已被其他操作更新");
    if ("revoke" in input) {
      const result = await tx.receivableAccessGrant.updateMany({ where: { id, revision: input.revision, active: true, revokedAt: null }, data: { active: false, revision: { increment: 1 }, revokedAt: new Date(), revokedBy: context.principal.accountId, revokeReason: input.reason } });
      if (result.count !== 1) throw httpError(409, "RECEIVABLES_REVISION_CONFLICT", "财务授权已被其他操作更新");
      const after = await tx.receivableAccessGrant.findUniqueOrThrow({ where: { id }, select: grantSelect });
      await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: "receivables.admin.grant.revoke", objectType: "receivable_access_grant", objectId: id, requestId: context.requestId, actorRole: access.role, actorScopeType: "receivables", reason: input.reason, metadata: auditMetadata(before, after, 1) });
      return after;
    }
    await assertActiveGrantSubject(tx, before.accountId);
    await validateGrantDepartments(tx, input);
    const result = await tx.receivableAccessGrant.updateMany({ where: { id, revision: input.revision, active: true, revokedAt: null }, data: { role: input.role, canCreate: input.canCreate, canExport: input.canExport, canViewAll: input.canViewAll, revision: { increment: 1 } } });
    if (result.count !== 1) throw httpError(409, "RECEIVABLES_REVISION_CONFLICT", "财务授权已被其他操作更新");
    await tx.receivableGrantDepartment.deleteMany({ where: { grantId: id } });
    if (input.departments.length) await tx.receivableGrantDepartment.createMany({ data: input.departments.map(({ departmentId, canRead, canWrite }) => ({ grantId: id, financeDepartmentId: departmentId, canRead, canWrite })) });
    const after = await tx.receivableAccessGrant.findUniqueOrThrow({ where: { id }, select: grantSelect });
    await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: "receivables.admin.grant.update", objectType: "receivable_access_grant", objectId: id, requestId: context.requestId, actorRole: access.role, actorScopeType: "receivables", reason: input.reason, metadata: auditMetadata(before, after, 1) });
    return after;
  });
}

async function createDepartment(context: ReceivablesAdminContext, input: Extract<ReceivablesAdminOperation, { type: "department.create" }>["input"]) {
  return prisma.$transaction(async (tx) => {
    const access = await requireAction(context, "manageConfiguration", tx);
    const created = await tx.receivableDepartment.create({ data: { name: input.name, sortOrder: input.sortOrder, ...(input.code === undefined ? {} : { code: input.code }) }, select: departmentSelect });
    await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: "receivables.admin.department.create", objectType: "receivable_department", objectId: created.id, requestId: context.requestId, actorRole: access.role, actorScopeType: "receivables", metadata: auditMetadata(null, created, 0) });
    return created;
  });
}

async function updateDepartment(context: ReceivablesAdminContext, id: string, input: Extract<ReceivablesAdminOperation, { type: "department.update" }>["input"]) {
  if (input.name === undefined && input.code === undefined && input.sortOrder === undefined && input.active === undefined) throw httpError(400, "RECEIVABLES_DEPARTMENT_CHANGE_REQUIRED", "至少提交一个变更字段");
  if (input.active === false && !input.reason) throw httpError(400, "RECEIVABLES_DEPARTMENT_REASON_REQUIRED", "停用财务归属部门必须填写原因");
  return prisma.$transaction(async (tx) => {
    const access = await requireAction(context, "manageConfiguration", tx);
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
    if (input.active === false) Object.assign(updateData, { active: false, deactivatedAt: new Date(), deactivatedBy: context.principal.accountId, deactivateReason: input.reason! });
    const result = await tx.receivableDepartment.updateMany({ where: { id, revision: input.revision }, data: updateData });
    if (result.count !== 1) throw httpError(409, "RECEIVABLES_REVISION_CONFLICT", "财务归属部门已被其他操作更新");
    const after = await tx.receivableDepartment.findUniqueOrThrow({ where: { id }, select: departmentSelect });
    await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: input.active === false ? "receivables.admin.department.deactivate" : "receivables.admin.department.update", objectType: "receivable_department", objectId: id, requestId: context.requestId, actorRole: access.role, actorScopeType: "receivables", ...(input.reason ? { reason: input.reason } : {}), metadata: auditMetadata(before, after, impactCount) });
    return after;
  });
}

async function dictionaryImpactCount(tx: Prisma.TransactionClient, category: string, value: string) {
  const migration = dictionaryMigrations[category];
  return migration ? (await migration.affected(tx, value)).length : 0;
}

async function createDictionary(context: ReceivablesAdminContext, input: Extract<ReceivablesAdminOperation, { type: "dictionary.create" }>["input"]) {
  return prisma.$transaction(async (tx) => {
    const access = await requireAction(context, "manageConfiguration", tx);
    const created = await tx.receivableDictionaryOption.create({ data: input, select: dictionarySelect });
    await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: "receivables.admin.dictionary.create", objectType: "receivable_dictionary_option", objectId: created.id, requestId: context.requestId, actorRole: access.role, actorScopeType: "receivables", metadata: auditMetadata(null, created, 0) });
    return created;
  });
}

async function updateDictionary(context: ReceivablesAdminContext, id: string, input: Extract<ReceivablesAdminOperation, { type: "dictionary.update" }>["input"]) {
  if (input.value === undefined && input.sortOrder === undefined && input.active === undefined) throw httpError(400, "RECEIVABLES_DICTIONARY_CHANGE_REQUIRED", "至少提交一个变更字段");
  if (input.active === false && !input.reason) throw httpError(400, "RECEIVABLES_DICTIONARY_REASON_REQUIRED", "停用业务字典值必须填写原因");
  return prisma.$transaction(async (tx) => {
    const access = await requireAction(context, "manageConfiguration", tx);
    const before = await tx.receivableDictionaryOption.findUnique({ where: { id }, select: dictionarySelect });
    if (!before) throw httpError(404, "RECEIVABLES_DICTIONARY_NOT_FOUND", "业务字典值不存在");
    if (before.revision !== input.revision) throw httpError(409, "RECEIVABLES_REVISION_CONFLICT", "业务字典值已被其他操作更新");
    if (!before.active && input.active === false) throw httpError(409, "RECEIVABLES_DICTIONARY_INACTIVE", "业务字典值已经停用");
    const impactCount = await dictionaryImpactCount(tx, before.category, before.value);
    if (input.value !== undefined && input.value !== before.value && impactCount > 0) throw httpError(409, "RECEIVABLES_DICTIONARY_RENAME_IN_USE", "在用业务字典值须停用旧项并新建新项");
    const updateData: Prisma.ReceivableDictionaryOptionUncheckedUpdateManyInput = { revision: { increment: 1 } };
    if (input.value !== undefined) updateData.value = input.value;
    if (input.sortOrder !== undefined) updateData.sortOrder = input.sortOrder;
    if (input.active === false) Object.assign(updateData, { active: false, deactivatedAt: new Date(), deactivatedBy: context.principal.accountId, deactivateReason: input.reason! });
    const result = await tx.receivableDictionaryOption.updateMany({ where: { id, revision: input.revision }, data: updateData });
    if (result.count !== 1) throw httpError(409, "RECEIVABLES_REVISION_CONFLICT", "业务字典值已被其他操作更新");
    const after = await tx.receivableDictionaryOption.findUniqueOrThrow({ where: { id }, select: dictionarySelect });
    await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: input.active === false ? "receivables.admin.dictionary.deactivate" : "receivables.admin.dictionary.update", objectType: "receivable_dictionary_option", objectId: id, requestId: context.requestId, actorRole: access.role, actorScopeType: "receivables", ...(input.reason ? { reason: input.reason } : {}), metadata: auditMetadata(before, after, impactCount) });
    return after;
  });
}

async function migrateDepartment(context: ReceivablesAdminContext, sourceId: string, input: MigrationInput) {
  if (sourceId === input.targetId) throw httpError(400, "RECEIVABLES_MIGRATION_TARGET_INVALID", "迁移目标不能与来源相同");
  await requireAction(context, "manageAccess");
  if (input.mode === "preview") {
    return prisma.$transaction(async (tx) => {
      await requireAction(context, "manageAccess", tx);
      const [source, target, rows] = await Promise.all([
        tx.receivableDepartment.findUnique({ where: { id: sourceId }, select: departmentSelect }),
        tx.receivableDepartment.findUnique({ where: { id: input.targetId }, select: departmentSelect }),
        tx.receivableLedger.findMany({ where: { financeDepartmentId: sourceId }, select: { id: true, revision: true }, orderBy: { id: "asc" } }),
      ]);
      assertSourceAndTarget(source, target, "部门");
      const snapshot = migrationSnapshot(rows);
      const expiresAt = Date.now() + migrationTokenLifetimeMs;
      const token = issueMigrationToken({ version: 2, kind: "department", actorId: context.principal.accountId, sourceId, targetId: target!.id, sourceRevision: source!.revision, targetRevision: target!.revision, ...snapshot, expiresAt });
      return { impactCount: snapshot.impactCount, token, expiresAt: new Date(expiresAt).toISOString() };
    });
  }
  const payload = readMigrationToken(input.token);
  assertTokenIdentity(payload, { kind: "department", actorId: context.principal.accountId, sourceId, targetId: input.targetId });
  return runMigrationApply(() => prisma.$transaction(async (tx) => {
    const access = await requireAction(context, "manageAccess", tx);
    const [source, target, rows] = await Promise.all([
      tx.receivableDepartment.findUnique({ where: { id: sourceId }, select: departmentSelect }),
      tx.receivableDepartment.findUnique({ where: { id: input.targetId }, select: departmentSelect }),
      tx.receivableLedger.findMany({ where: { financeDepartmentId: sourceId }, select: { id: true, revision: true }, orderBy: { id: "asc" } }),
    ]);
    assertSourceAndTarget(source, target, "部门");
    assertTokenFresh(payload, source!.revision, target!.revision, migrationSnapshot(rows));
    const updated = await tx.receivableLedger.updateMany({ where: { id: { in: rows.map(({ id }) => id) }, financeDepartmentId: sourceId }, data: { financeDepartmentId: input.targetId, revision: { increment: 1 } } });
    if (updated.count !== rows.length) throw migrationStateChanged();
    const sourceTouch = await tx.receivableDepartment.updateMany({ where: { id: sourceId, active: false, revision: payload.sourceRevision }, data: { revision: { increment: 1 } } });
    const targetTouch = await tx.receivableDepartment.updateMany({ where: { id: input.targetId, active: true, revision: payload.targetRevision }, data: { revision: { increment: 1 } } });
    if (sourceTouch.count !== 1 || targetTouch.count !== 1) throw migrationStateChanged();
    const [sourceAfter, targetAfter] = await Promise.all([
      tx.receivableDepartment.findUniqueOrThrow({ where: { id: sourceId }, select: departmentSelect }),
      tx.receivableDepartment.findUniqueOrThrow({ where: { id: input.targetId }, select: departmentSelect }),
    ]);
    await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: "receivables.admin.department.migrate", objectType: "receivable_department", objectId: sourceId, requestId: context.requestId, actorRole: access.role, actorScopeType: "receivables", reason: input.reason, metadata: auditMetadata({ source, target, fingerprint: payload.fingerprint }, { source: sourceAfter, target: targetAfter, migratedTo: targetAfter.id }, rows.length) });
    return { impactCount: rows.length };
  }, { isolationLevel: "Serializable" }));
}

async function migrateDictionary(context: ReceivablesAdminContext, sourceId: string, input: MigrationInput) {
  if (sourceId === input.targetId) throw httpError(400, "RECEIVABLES_MIGRATION_TARGET_INVALID", "迁移目标不能与来源相同");
  await requireAction(context, "manageAccess");
  if (input.mode === "preview") {
    return prisma.$transaction(async (tx) => {
      await requireAction(context, "manageAccess", tx);
      const [source, target] = await Promise.all([
        tx.receivableDictionaryOption.findUnique({ where: { id: sourceId }, select: dictionarySelect }),
        tx.receivableDictionaryOption.findUnique({ where: { id: input.targetId }, select: dictionarySelect }),
      ]);
      assertSourceAndTarget(source, target, "字典值");
      if (target!.category !== source!.category) throw httpError(409, "RECEIVABLES_MIGRATION_TARGET_CATEGORY", "迁移目标字典值类别不同");
      const migration = dictionaryMigrations[source!.category];
      if (!migration) throw httpError(409, "RECEIVABLES_DICTIONARY_MIGRATION_UNSUPPORTED", "该业务字典类别没有可迁移的持久化字段");
      const snapshot = migrationSnapshot(await migration.affected(tx, source!.value));
      const expiresAt = Date.now() + migrationTokenLifetimeMs;
      const token = issueMigrationToken({ version: 2, kind: "dictionary", actorId: context.principal.accountId, sourceId, targetId: target!.id, sourceRevision: source!.revision, targetRevision: target!.revision, ...snapshot, expiresAt });
      return { impactCount: snapshot.impactCount, token, expiresAt: new Date(expiresAt).toISOString() };
    });
  }
  const payload = readMigrationToken(input.token);
  assertTokenIdentity(payload, { kind: "dictionary", actorId: context.principal.accountId, sourceId, targetId: input.targetId });
  return runMigrationApply(() => prisma.$transaction(async (tx) => {
    const access = await requireAction(context, "manageAccess", tx);
    const [source, target] = await Promise.all([
      tx.receivableDictionaryOption.findUnique({ where: { id: sourceId }, select: dictionarySelect }),
      tx.receivableDictionaryOption.findUnique({ where: { id: input.targetId }, select: dictionarySelect }),
    ]);
    assertSourceAndTarget(source, target, "字典值");
    if (target!.category !== source!.category) throw httpError(409, "RECEIVABLES_MIGRATION_TARGET_CATEGORY", "迁移目标字典值类别不同");
    const migration = dictionaryMigrations[source!.category];
    if (!migration) throw httpError(409, "RECEIVABLES_DICTIONARY_MIGRATION_UNSUPPORTED", "该业务字典类别没有可迁移的持久化字段");
    const rows = await migration.affected(tx, source!.value);
    assertTokenFresh(payload, source!.revision, target!.revision, migrationSnapshot(rows));
    if (await migration.apply(tx, rows.map(({ id }) => id), source!.value, target!.value) !== rows.length) throw migrationStateChanged();
    const sourceTouch = await tx.receivableDictionaryOption.updateMany({ where: { id: sourceId, active: false, revision: payload.sourceRevision }, data: { revision: { increment: 1 } } });
    const targetTouch = await tx.receivableDictionaryOption.updateMany({ where: { id: input.targetId, active: true, revision: payload.targetRevision }, data: { revision: { increment: 1 } } });
    if (sourceTouch.count !== 1 || targetTouch.count !== 1) throw migrationStateChanged();
    const [sourceAfter, targetAfter] = await Promise.all([
      tx.receivableDictionaryOption.findUniqueOrThrow({ where: { id: sourceId }, select: dictionarySelect }),
      tx.receivableDictionaryOption.findUniqueOrThrow({ where: { id: input.targetId }, select: dictionarySelect }),
    ]);
    await writeCriticalAudit(tx, { actorId: context.principal.accountId, action: "receivables.admin.dictionary.migrate", objectType: "receivable_dictionary_option", objectId: sourceId, requestId: context.requestId, actorRole: access.role, actorScopeType: "receivables", reason: input.reason, metadata: auditMetadata({ source, target, fingerprint: payload.fingerprint }, { source: sourceAfter, target: targetAfter, migratedTo: targetAfter.id }, rows.length) });
    return { impactCount: rows.length };
  }, { isolationLevel: "Serializable" }));
}

export async function administerReceivables(context: ReceivablesAdminContext, operation: ReceivablesAdminOperation): Promise<ReceivablesAdminResult> {
  switch (operation.type) {
    case "grant.list":
      await requireAction(context, "manageAccess");
      return prisma.receivableAccessGrant.findMany({ select: grantSelect, orderBy: [{ active: "desc" }, { grantedAt: "desc" }] });
    case "grant.create": return createGrant(context, operation.input);
    case "grant.update": return updateGrant(context, operation.id, operation.input);
    case "department.list":
      await requireAction(context, "manageConfiguration");
      return prisma.receivableDepartment.findMany({ select: departmentSelect, orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }] });
    case "department.create": return createDepartment(context, operation.input);
    case "department.update": return updateDepartment(context, operation.id, operation.input);
    case "dictionary.list":
      await requireAction(context, "manageConfiguration");
      return prisma.receivableDictionaryOption.findMany({ ...(operation.category ? { where: { category: operation.category } } : {}), select: dictionarySelect, orderBy: [{ category: "asc" }, { active: "desc" }, { sortOrder: "asc" }, { value: "asc" }] });
    case "dictionary.create": return createDictionary(context, operation.input);
    case "dictionary.update": return updateDictionary(context, operation.id, operation.input);
    case "department.migrate": return migrateDepartment(context, operation.sourceId, operation.input);
    case "dictionary.migrate": return migrateDictionary(context, operation.sourceId, operation.input);
  }
}
