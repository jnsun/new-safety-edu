import { PassThrough } from "node:stream";
import archiver from "archiver";
import { normalizeStructuredCourseware, type StructuredCoursewareSourceAssetIdentity } from "./structured-courseware.js";
import { createCoursewareXlsx } from "./courseware-template.js";

export type ExportAsset = { blockKey: string; path: string; sha256: string; buffer: Buffer };

export function coursewareExportManifest(courseCode: string, documentInput: unknown, assets: Array<Omit<ExportAsset, "buffer">> = []) {
  const document = normalizeStructuredCourseware(documentInput);
  const portable = {
    ...document,
    units: document.units.map((unit) => ({ ...unit, blocks: unit.blocks.map((block) => block.type === "knowledge" ? { ...block, imageFileId: null } : block) }))
  };
  return { templateVersion: document.schemaVersion, courses: [{ courseCode, document: portable, ...(assets.length ? { assets: assets.map(({ blockKey, path }) => ({ blockKey, path })) } : {}) }] };
}

export function exportCoursewareJson(courseCode: string, document: unknown, assets: Array<Omit<ExportAsset, "buffer">> = []) {
  return Buffer.from(JSON.stringify(coursewareExportManifest(courseCode, document, assets), null, 2));
}

export async function exportCoursewareXlsx(courseCode: string, documentInput: unknown, assets: Array<Omit<ExportAsset, "buffer">> = []) {
  const document = normalizeStructuredCourseware(documentInput);
  return createCoursewareXlsx([{ courseCode, document: { ...document, units: document.units.map((unit) => ({ ...unit, blocks: unit.blocks.map((block) => block.type === "knowledge" ? { ...block, imageFileId: null } : block) })) }, assetPaths: Object.fromEntries(assets.map(({ blockKey, path }) => [blockKey, path])) }]);
}

export async function exportCoursewareZip(courseCode: string, document: unknown, assets: ExportAsset[]) {
  const archive = archiver("zip", { zlib: { level: 6 } });
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    output.on("end", () => resolve(Buffer.concat(chunks)));
    output.on("error", reject);
    archive.on("error", reject);
  });
  archive.pipe(output);
  archive.append(exportCoursewareJson(courseCode, document, assets), { name: "courseware.json" });
  for (const asset of assets) archive.append(asset.buffer, { name: asset.path });
  await archive.finalize();
  return completed;
}

export function exportedSourceAssets(assets: ExportAsset[]): StructuredCoursewareSourceAssetIdentity[] {
  return assets.map(({ blockKey, path, sha256 }) => ({ blockKey, path, sha256 }));
}
