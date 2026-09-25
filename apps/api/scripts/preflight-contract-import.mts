import { resolve } from "node:path";
import { preflightContractWorkbook } from "../src/contract-import-preflight.js";

const path = process.argv.slice(2).find((argument) => argument !== "--" && !argument.startsWith("--"));
if (!path) throw new Error("用法: pnpm --filter @safety/api contract-import:preflight -- <xlsx 路径> [--template-only] [--include-values]");
const includeValues = process.argv.includes("--include-values");
const result = await preflightContractWorkbook(resolve(path), undefined, { sourceMode: process.argv.includes("--template-only") ? "template_only" : "data" });
const output = includeValues ? result : { ...result, rows: result.rows.map(({ preview: _preview, ...row }) => row) };
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
