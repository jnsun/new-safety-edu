import { rename, unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";

export async function orphanPrivateFiles(db: PrismaClient, olderThan: Date) {
  const rows = await db.privateFile.findMany({ where: { createdAt: { lt: olderThan }, personPhotos: { none: {} }, personPhotoHistory: { none: {} }, versions: { none: {} }, signatures: { none: {} }, personCertificates: { none: {} }, organizationQualifications: { none: {} }, certificateAttachments: { none: {} }, monthlyReportAttachments: { none: {} } }, select: { id: true, storageKey: true, size: true } });
  const unused = [];
  for (const row of rows) {
    const references = await db.$queryRaw<Array<{ used: boolean }>>(Prisma.sql`SELECT EXISTS (
      SELECT 1 FROM training_batches WHERE COALESCE(offline_detail::text, '') LIKE ${`%${row.id}%`}
      UNION ALL SELECT 1 FROM change_requests WHERE COALESCE(payload::text, '') LIKE ${`%${row.id}%`} OR COALESCE(before_summary::text, '') LIKE ${`%${row.id}%`} OR COALESCE(after_summary::text, '') LIKE ${`%${row.id}%`}
    ) AS used`);
    if (!references[0]?.used) unused.push(row);
  }
  return unused;
}

export async function removeOrphanPrivateFile(db: PrismaClient, uploadRoot: string, file: { id: string; storageKey: string }) {
  const root = resolve(uploadRoot); const source = resolve(root, file.storageKey); if (source !== root && !source.startsWith(`${root}${sep}`)) throw new Error("非法文件路径");
  const quarantine = `${source}.deleting`; await rename(source, quarantine);
  try { await db.$transaction(async (tx) => { await tx.privateFile.delete({ where: { id: file.id } }); await tx.auditLog.create({ data: { action: "private_file.orphan_delete", objectType: "private_file", objectId: file.id, result: "success" } }); }); await unlink(quarantine); }
  catch (error) { await rename(quarantine, source).catch(() => undefined); throw error; }
}
