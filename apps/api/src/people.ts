import type { PersonType, Prisma } from "@prisma/client";
import type { Principal } from "./auth.js";
import { canAccessOrganization, forbidden, isCompanyAdmin } from "./access.js";
import { encryptNationalId, normalizePhone } from "./crypto.js";
import type { Env } from "./env.js";
import { prisma } from "./db.js";

export type PersonInput = {
  name: string;
  phone: string;
  type: PersonType;
  organizationId?: string;
  nationalId?: string;
  photoFileId?: string;
};

const safeSelect = {
  id: true, name: true, phone: true, type: true, status: true, nationalIdLast4: true,
  photoFileId: true, createdAt: true, updatedAt: true,
  organizations: { where: { active: true }, select: { organization: { select: { id: true, name: true } }, primary: true } },
  account: { select: { id: true, username: true, status: true, roles: { where: { active: true }, select: { id: true, role: true, scopeType: true, scopeId: true } } } }
} satisfies Prisma.PersonSelect;

export async function createPerson(input: PersonInput, principal: Principal, env: Env, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  if (input.organizationId ? !await canAccessOrganization(principal, input.organizationId) : !isCompanyAdmin(principal)) forbidden();
  const phone = normalizePhone(input.phone);
  if (!/^1\d{10}$/.test(phone)) throw Object.assign(new Error("手机号格式错误"), { statusCode: 400, code: "INVALID_PHONE" });
  const [duplicate, photo] = await Promise.all([
    tx.person.findFirst({ where: { phone, status: "active" }, select: { id: true } }),
    input.photoFileId ? tx.privateFile.findUnique({ where: { id: input.photoFileId }, select: { kind: true } }) : null
  ]);
  if (duplicate) throw Object.assign(new Error("该手机号已有在用人员档案"), { statusCode: 409, code: "PHONE_EXISTS" });
  if (input.photoFileId && photo?.kind !== "photo") throw Object.assign(new Error("所选文件不是个人照片"), { statusCode: 400, code: "INVALID_PHOTO" });
  const encrypted = input.nationalId ? encryptNationalId(input.nationalId, env) : {};
  return tx.person.create({
    data: {
      name: input.name.trim(), phone, type: input.type, status: "active", ...(input.photoFileId ? { photoFileId: input.photoFileId } : {}), ...encrypted,
      ...(input.organizationId ? { organizations: { create: { organizationId: input.organizationId, primary: true } } } : {})
    },
    select: safeSelect
  });
}

export { safeSelect as personSafeSelect };

export function maskPerson<T extends { phone: string }>(person: T): T {
  return { ...person, phone: `${person.phone.slice(0, 3)}****${person.phone.slice(-4)}` };
}
