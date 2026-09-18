import { extname } from "node:path";
import * as unzipper from "unzipper";

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_ENTRY_COUNT = 250;
const MAX_ENTRY_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 120 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 200;
const assetExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export class CoursewarePackageError extends Error {
  statusCode = 400;
  constructor(public code: string, message: string) { super(message); }
}

type PackageAsset = { path: string; buffer: Buffer; mimeType: string };
export type CoursewarePackage = { manifest: { filename: string; buffer: Buffer }; assets: Map<string, PackageAsset> };

function reject(code: string, message: string): never { throw new CoursewarePackageError(code, message); }

function normalizedPath(path: string) {
  if (!path || path.includes("\0") || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    reject("INVALID_ZIP_PATH", `ZIP 路径不安全：${path || "(空)"}`);
  }
  const directory = path.endsWith("/");
  const parts = path.split("/");
  if (directory) parts.pop();
  if (!parts.length || parts.some((part) => !part || part === "." || part === "..")) reject("INVALID_ZIP_PATH", `ZIP 路径不安全：${path}`);
  if (parts.some((part) => part.startsWith(".") || part === "__MACOSX")) reject("HIDDEN_ZIP_ENTRY", `ZIP 包含隐藏元数据：${path}`);
  const result = `${parts.map((part) => part.normalize("NFC")).join("/")}${directory ? "/" : ""}`;
  return { path: result, directory };
}

function assertRegularEntry(file: unzipper.File, directory: boolean) {
  const unixOrigin = (file.versionMadeBy >>> 8) === 3;
  if (!unixOrigin) return;
  const mode = (file.externalFileAttributes >>> 16) & 0xffff;
  const kind = mode & 0o170000;
  if (kind && kind !== (directory ? 0o040000 : 0o100000)) reject("NON_REGULAR_ZIP_ENTRY", `ZIP 包含符号链接或非普通文件：${file.path}`);
}

function imageMime(path: string, buffer: Buffer) {
  const extension = extname(path).toLowerCase();
  if (!assetExtensions.has(extension)) reject("UNSUPPORTED_ASSET", `不支持的素材格式：${path}`);
  const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const webp = buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  const mime = png ? "image/png" : jpeg ? "image/jpeg" : webp ? "image/webp" : null;
  if (!mime || (mime === "image/png" && extension !== ".png") || (mime === "image/webp" && extension !== ".webp") || (mime === "image/jpeg" && extension !== ".jpg" && extension !== ".jpeg")) {
    reject("ASSET_TYPE_MISMATCH", `素材扩展名与内容不一致：${path}`);
  }
  return mime;
}

async function readEntry(file: unzipper.File, path: string, limit: number, total: { bytes: number }) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of file.stream()) {
      const value = Buffer.from(chunk as Uint8Array);
      bytes += value.length;
      total.bytes += value.length;
      if (bytes > limit) reject("ZIP_ENTRY_SIZE_LIMIT", `ZIP 条目实际解压大小超过限制：${path}`);
      if (total.bytes > MAX_TOTAL_BYTES) reject("ZIP_TOTAL_SIZE_LIMIT", "ZIP 实际总解压大小超过限制");
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof CoursewarePackageError) throw error;
    return reject("INVALID_ZIP_ENTRY", `无法读取 ZIP 条目：${path}`);
  }
  if (bytes !== file.uncompressedSize) reject("ZIP_ENTRY_SIZE_MISMATCH", `ZIP 条目大小不一致：${path}`);
  return Buffer.concat(chunks, bytes);
}

export async function parseCoursewarePackage(buffer: Buffer): Promise<CoursewarePackage> {
  if (!buffer.length || buffer.length > MAX_ARCHIVE_BYTES) reject("ZIP_SIZE_LIMIT", "ZIP 文件大小超过限制");
  let directory: unzipper.CentralDirectory;
  try { directory = await unzipper.Open.buffer(buffer); }
  catch { return reject("INVALID_ZIP", "无法读取 ZIP 课件包"); }
  if (directory.files.length > MAX_ENTRY_COUNT) reject("ZIP_ENTRY_LIMIT", "ZIP 文件条目数量超过限制");

  const seen = new Set<string>();
  const files: Array<{ file: unzipper.File; path: string }> = [];
  let total = 0;
  for (const file of directory.files) {
    const safe = normalizedPath(file.path);
    assertRegularEntry(file, safe.directory);
    const folded = safe.path.toLocaleLowerCase("en-US");
    if (seen.has(folded)) reject("DUPLICATE_ZIP_ENTRY", `ZIP 存在重复文件名：${safe.path}`);
    seen.add(folded);
    if ((file.flags & 1) !== 0) reject("ENCRYPTED_ZIP_ENTRY", `ZIP 不允许加密文件：${safe.path}`);
    if (file.compressionMethod !== 0 && file.compressionMethod !== 8) reject("UNSUPPORTED_ZIP_COMPRESSION", `ZIP 压缩方法不受支持：${safe.path}`);
    if (safe.directory) {
      if (safe.path !== "assets/" && !safe.path.startsWith("assets/")) reject("INVALID_ZIP_LAYOUT", `ZIP 只允许 assets/ 素材目录：${safe.path}`);
      continue;
    }
    if (file.uncompressedSize > MAX_ENTRY_BYTES) reject("ZIP_ENTRY_SIZE_LIMIT", `ZIP 条目解压大小超过限制：${safe.path}`);
    if (file.uncompressedSize > 0 && (file.compressedSize === 0 || file.uncompressedSize / file.compressedSize > MAX_COMPRESSION_RATIO)) {
      reject("ZIP_COMPRESSION_RATIO_LIMIT", `ZIP 条目压缩比异常：${safe.path}`);
    }
    total += file.uncompressedSize;
    if (total > MAX_TOTAL_BYTES) reject("ZIP_TOTAL_SIZE_LIMIT", "ZIP 总解压大小超过限制");
    if (!safe.path.startsWith("assets/") && safe.path !== "courseware.json" && safe.path !== "courseware.xlsx") {
      reject("INVALID_ZIP_LAYOUT", `ZIP 根目录只允许 courseware.json 或 courseware.xlsx：${safe.path}`);
    }
    files.push({ file, path: safe.path });
  }

  const manifests = files.filter(({ path }) => path === "courseware.json" || path === "courseware.xlsx");
  if (manifests.length !== 1) reject("INVALID_ZIP_MANIFEST", "ZIP 必须且只能包含一个 courseware.json 或 courseware.xlsx");
  const manifestEntry = manifests[0]!;
  const actualTotal = { bytes: 0 };
  const manifestBuffer = await readEntry(manifestEntry.file, manifestEntry.path, MAX_ENTRY_BYTES, actualTotal);

  const assets = new Map<string, PackageAsset>();
  for (const entry of files.filter(({ path }) => path.startsWith("assets/"))) {
    const assetBuffer = await readEntry(entry.file, entry.path, MAX_ENTRY_BYTES, actualTotal);
    assets.set(entry.path, { path: entry.path, buffer: assetBuffer, mimeType: imageMime(entry.path, assetBuffer) });
  }
  return { manifest: { filename: manifestEntry.path, buffer: manifestBuffer }, assets };
}
