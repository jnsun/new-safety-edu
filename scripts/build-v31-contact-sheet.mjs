import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "file:///C:/Users/sjn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const dir = path.resolve("deliverables/miniprogram-ui-reference-v3.1/08_路由映射_风格指南_设计参数_图片/images");
const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".png")).sort();
const cells = [];
for (const name of names) {
  const data = (await fs.readFile(path.join(dir, name))).toString("base64");
  cells.push(`<figure><img src="data:image/png;base64,${data}"><figcaption>${name.replace('.png','')}</figcaption></figure>`);
}
let browser;
try { browser = await chromium.launch({ headless: true }); }
catch { browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" }); }
const page = await browser.newPage({ viewport: { width: 1120, height: 3200 }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><style>*{box-sizing:border-box}body{margin:0;padding:20px;background:#E9EFEC;font-family:system-ui,"Microsoft YaHei",sans-serif}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:16px}figure{margin:0;background:white;padding:6px;border-radius:10px;box-shadow:0 5px 18px rgba(25,66,52,.08)}img{display:block;width:100%;height:auto;border-radius:6px}figcaption{text-align:center;font-size:12px;color:#245D47;padding:8px 2px 4px}</style><div class="grid">${cells.join('')}</div>`, { waitUntil: "load" });
await page.screenshot({ path: path.join(path.dirname(dir), "00_全页面总览.png"), fullPage: true });
await browser.close();
console.log(`CONTACT_SHEET_OK screens=${names.length}`);
