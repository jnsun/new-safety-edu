import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Principal } from "../auth.js";
import { prisma } from "../db.js";
import { requireReceivables, resolveReceivablesAccess } from "../receivables-access.js";
import { writeCriticalAudit } from "../transaction-audit.js";

type RouteDependencies = {
  authenticate(request: FastifyRequest): Promise<void>;
};

const organizationInput = z.object({
  organizationId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500).optional(),
  confirm: z.boolean().optional(),
});

const httpError = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });

export async function registerReceivablesRoutes(app: FastifyInstance, deps: RouteDependencies) {
  app.get("/api/receivables/access", { preHandler: deps.authenticate }, async (request) => ({
    data: await resolveReceivablesAccess(request.principal as Principal),
  }));

  app.put("/api/receivables/setup/organization", { preHandler: deps.authenticate }, async (request) => {
    const input = organizationInput.parse(request.body);
    const principal = request.principal as Principal;
    const data = await prisma.$transaction(async (tx) => {
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
}
