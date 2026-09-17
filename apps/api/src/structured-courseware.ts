import { createHash } from "node:crypto";
import {
  StructuredCoursewareDocumentSchema,
  type StructuredCoursewareDocument
} from "@safety/contracts";

export function canEditCoursewareVersion(version: { status: string }) {
  return version.status === "draft";
}

export function normalizeStructuredCourseware(input: unknown): StructuredCoursewareDocument {
  return StructuredCoursewareDocumentSchema.parse(input);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashStructuredCourseware(input: unknown) {
  return createHash("sha256").update(stableJson(normalizeStructuredCourseware(input))).digest("hex");
}

export type StructuredCoursewareSourceAssetIdentity = {
  blockKey: string;
  path: string;
  sha256: string;
};

/**
 * Portable identity for imported structured content. Imported versions must persist
 * this hash from the server action plan; generated PrivateFile UUIDs are deliberately
 * removed so the same source document and assets hash identically after materialization.
 */
export function hashStructuredCoursewareSourceIdentity(input: unknown, sourceAssets: StructuredCoursewareSourceAssetIdentity[]) {
  const document = normalizeStructuredCourseware(input);
  const materializedImageKeys = new Set(document.units.flatMap((unit) => unit.blocks.flatMap((block) => block.type === "knowledge" && block.imageFileId ? [block.key] : [])));
  if (!sourceAssets.length) {
    if (materializedImageKeys.size) throw new Error("已物化图片必须提供来源身份");
    return hashStructuredCourseware(document);
  }
  const knowledgeKeys = new Set(document.units.flatMap((unit) => unit.blocks.flatMap((block) => block.type === "knowledge" ? [block.key] : [])));
  const seenBlocks = new Set<string>();
  const assets = sourceAssets.map((asset) => {
    const blockKey = asset.blockKey.trim();
    const path = asset.path.trim().normalize("NFC");
    const digest = asset.sha256.toLowerCase();
    if (!knowledgeKeys.has(blockKey)) throw new Error(`素材只能关联图文知识卡：${blockKey}`);
    if (seenBlocks.has(blockKey)) throw new Error(`同一图文知识卡只能关联一个素材：${blockKey}`);
    if (!path || !/^[a-f0-9]{64}$/.test(digest)) throw new Error(`素材来源身份无效：${blockKey}`);
    seenBlocks.add(blockKey);
    return { blockKey, path, sha256: digest };
  }).sort((left, right) => left.blockKey.localeCompare(right.blockKey) || left.path.localeCompare(right.path));
  for (const blockKey of materializedImageKeys) if (!seenBlocks.has(blockKey)) throw new Error(`缺少已物化图片的来源身份：${blockKey}`);
  const portableDocument: StructuredCoursewareDocument = {
    ...document,
    units: document.units.map((unit) => ({
      ...unit,
      blocks: unit.blocks.map((block) => block.type === "knowledge" ? { ...block, imageFileId: null } : block)
    }))
  };
  return createHash("sha256").update(stableJson({
    kind: "structured-courseware-source",
    version: 1,
    document: portableDocument,
    assets
  })).digest("hex");
}

export function serializeStructuredCoursewareForLearner(input: unknown, resumeState: unknown) {
  const document = normalizeStructuredCourseware(input);
  return {
    schemaVersion: document.schemaVersion,
    estimatedMinutes: document.estimatedMinutes,
    units: document.units,
    resumeState
  };
}

type CoursewareScope = { scopeType: string; scopeId: string | null };
type StructuredAssetRecord = {
  id: string;
  kind: string;
  mimeType: string;
  uploadedBy: string;
  scopes: CoursewareScope[];
};

const structuredImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function structuredCoursewareAssetIds(document: StructuredCoursewareDocument) {
  return [...new Set(document.units.flatMap((unit) => unit.blocks.flatMap((block) =>
    block.type === "knowledge" && block.imageFileId ? [block.imageFileId] : []
  )))];
}

export function validateStructuredCoursewareAssets(
  document: StructuredCoursewareDocument,
  files: StructuredAssetRecord[],
  accountId: string,
  scope: CoursewareScope
) {
  const ids = structuredCoursewareAssetIds(document);
  const byId = new Map(files.map((file) => [file.id, file]));
  for (const id of ids) {
    const file = byId.get(id);
    if (!file) throw Object.assign(new Error("结构化课件图片不存在"), { statusCode: 400, code: "COURSEWARE_ASSET_NOT_FOUND" });
    if (file.kind !== "attachment" || !structuredImageMimeTypes.has(file.mimeType)) {
      throw Object.assign(new Error("结构化课件图片只支持附件类型的 JPEG、PNG 或 WebP"), { statusCode: 400, code: "COURSEWARE_ASSET_INVALID" });
    }
    const sameScope = file.scopes.some((candidate) => candidate.scopeType === scope.scopeType && candidate.scopeId === scope.scopeId);
    if (file.uploadedBy !== accountId && !sameScope) {
      throw Object.assign(new Error("无权在当前课件范围使用该图片"), { statusCode: 403, code: "COURSEWARE_ASSET_FORBIDDEN" });
    }
  }
  return ids;
}

export function structuredAssetSyncPlan(currentIds: string[], desiredIds: string[]) {
  const current = new Set(currentIds);
  const desired = new Set(desiredIds);
  return {
    add: [...desired].filter((id) => !current.has(id)),
    remove: [...current].filter((id) => !desired.has(id))
  };
}

function isCoursewareVersionUniqueConflict(error: unknown) {
  if (!error || typeof error !== "object" || (error as { code?: unknown }).code !== "P2002") return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const fields = (Array.isArray(target) ? target : [target]).map(String).join("_").toLowerCase();
  return (fields.includes("courseware_id") || fields.includes("coursewareid")) && fields.includes("version");
}

export async function retryCoursewareVersionCreate<T>(attempt: () => Promise<T>, maxAttempts = 5): Promise<T> {
  for (let number = 1; number <= maxAttempts; number += 1) {
    try { return await attempt(); }
    catch (error) {
      if (!isCoursewareVersionUniqueConflict(error) || number === maxAttempts) throw error;
    }
  }
  throw new Error("unreachable");
}
