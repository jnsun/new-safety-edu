import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";

export type ContractImportMapping = {
  contractNo: number;
  projectName: number;
  amountWan?: number;
  annualAmountWan?: number;
  partyA?: number;
  sourceOrganizationName?: number;
  handlerName?: number;
  businessSector?: number;
  signedAt?: number;
  location?: number;
};

const defaultMappings: Record<string, ContractImportMapping> = {
  "2026物化院": { contractNo: 3, projectName: 4, amountWan: 5, annualAmountWan: 6, partyA: 7, sourceOrganizationName: 8, handlerName: 9, businessSector: 10, signedAt: 14, location: 15 },
  "2026六院": { contractNo: 3, projectName: 4, annualAmountWan: 5, partyA: 6, sourceOrganizationName: 7, handlerName: 8, businessSector: 9, signedAt: 11, location: 12 },
  "2026测绘院": { contractNo: 3, projectName: 4, amountWan: 5, annualAmountWan: 6, partyA: 7, sourceOrganizationName: 8, handlerName: 9, businessSector: 10, location: 15 },
};

const cellText = (row: ExcelJS.Row, column?: number): string | null => {
  if (!column) return null;
  const value = row.getCell(column).value;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && "text" in value) return String(value.text).trim() || null;
  if (typeof value === "object" && "result" in value) return value.result === null || value.result === undefined ? null : String(value.result).trim() || null;
  return String(value).trim() || null;
};
const normalizedNo = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
const yuanFromWan = (value: string | null, location: string, errors: string[]) => {
  if (!value) return null;
  const parsed = Number(value.replace(/[,，]/g, ""));
  if (!Number.isFinite(parsed)) { errors.push(`${location}: 金额无法按万元解析`); return null; }
  return Math.round(parsed * 1_000_000) / 100;
};

export async function preflightContractWorkbook(path: string, mappings: Record<string, ContractImportMapping> = defaultMappings, options: { sourceMode?: "data" | "template_only" } = {}) {
  const sourceMode = options.sourceMode ?? "data";
  const bytes = await readFile(path);
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const seen = new Map<string, string>();
  const rows: Array<Record<string, unknown>> = [];
  const sheetSummaries: Array<Record<string, unknown>> = [];
  for (const worksheet of workbook.worksheets) {
    const mapping = mappings[worksheet.name];
    if (!mapping) { sheetSummaries.push({ sheet: worksheet.name, status: "ignored_no_mapping", maxRow: worksheet.rowCount }); continue; }
    let candidateRows = 0;
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const contractNo = cellText(row, mapping.contractNo);
      const projectName = cellText(row, mapping.projectName);
      if (!contractNo && !projectName) continue;
      if (rowNumber <= 2 || /合同.*编号|编号/.test(contractNo ?? "") && /项目.*名称/.test(projectName ?? "")) continue;
      const errors: string[] = [];
      const location = `${worksheet.name}!${rowNumber}`;
      if (!contractNo) errors.push(`${location}: 缺少合同编号`);
      if (!projectName) errors.push(`${location}: 缺少项目名称`);
      const key = contractNo ? normalizedNo(contractNo) : "";
      if (key && seen.has(key)) errors.push(`${location}: 合同编号与 ${seen.get(key)} 重复`);
      else if (key) seen.set(key, location);
      const amountYuan = yuanFromWan(cellText(row, mapping.amountWan) ?? cellText(row, mapping.annualAmountWan), location, errors);
      const annualAmountYuan = yuanFromWan(cellText(row, mapping.annualAmountWan), location, errors);
      const idempotencyKey = createHash("sha256").update(`${sourceSha256}:${worksheet.name}:${rowNumber}:${key}`).digest("hex");
      rows.push({ sheet: worksheet.name, rowNumber, idempotencyKey, structurallyValid: errors.length === 0, importEligible: sourceMode === "data" && errors.length === 0, errors, preview: { contractNo, projectName, amountYuan, annualAmountYuan, partyA: cellText(row, mapping.partyA), sourceOrganizationName: cellText(row, mapping.sourceOrganizationName), handlerName: cellText(row, mapping.handlerName), businessSector: cellText(row, mapping.businessSector), signedAt: cellText(row, mapping.signedAt), location: cellText(row, mapping.location) } });
      candidateRows += 1;
    }
    sheetSummaries.push({ sheet: worksheet.name, status: "mapped", maxRow: worksheet.rowCount, candidateRows });
  }
  return {
    mode: "read_only_preflight" as const,
    sourceMode,
    sourceSha256,
    workbookSheets: workbook.worksheets.length,
    candidateRows: rows.length,
    structurallyValidRows: rows.filter((row) => row.structurallyValid).length,
    structurallyInvalidRows: rows.filter((row) => !row.structurallyValid).length,
    importEligibleRows: rows.filter((row) => row.importEligible).length,
    duplicateContractNumbers: rows.filter((row) => (row.errors as string[]).some((error) => error.includes("重复"))).length,
    amountUnit: "source_wan_to_yuan_x10000",
    sheetSummaries,
    rows,
  };
}

export { defaultMappings as contractImportDefaultMappings };
