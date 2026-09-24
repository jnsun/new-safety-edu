import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "file:///C:/Users/sjn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const root = path.resolve("deliverables/miniprogram-e2e-test-content-v1");
const preview = path.join(root, "_previews");
await fs.mkdir(preview, { recursive: true });
const items = [
  ["01_结构化课件_可直接导入.xlsx", "课程"],
  ["02_正式考试题库_可直接导入.xlsx", "试题导入"],
  ["03_每日挑战题库_可直接导入.xlsx", "试题导入"]
];
for (const [fileName, sheetName] of items) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(path.join(root, fileName)));
  const inspected = await workbook.inspect({ kind: "sheet,region", maxChars: 5000, tableMaxRows: 8, tableMaxCols: 12, tableMaxCellChars: 100 });
  if (!inspected.ndjson.includes(`"name":"${sheetName}"`)) throw new Error(`${fileName} 缺少 ${sheetName}`);
  const rendered = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(path.join(preview, `${fileName.replace('.xlsx','')}.png`), new Uint8Array(await rendered.arrayBuffer()));
  console.log(fileName, inspected.ndjson.slice(0, 700));
}
console.log("E2E_CONTENT_WORKBOOKS_VISUAL_OK");
