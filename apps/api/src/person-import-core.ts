import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import { normalizePhone } from "./crypto.js";

export type SourcePersonRow = {
  rowNumber: number;
  name: string;
  nationalId: string;
  phone: string;
  workDepartment: string;
  sourceDepartment: string;
};

export type PhoneRow = {
  rowNumber: number;
  name: string;
  nationalId: string;
  phone: string;
};

const text = (value: unknown): string => {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const item = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: unknown }> };
    if (typeof item.text === "string") return item.text.trim();
    if (item.result != null) return String(item.result).trim();
    if (item.richText) return item.richText.map((part) => String(part.text ?? "")).join("").trim();
  }
  return String(value).trim();
};

const rowValue = (row: Record<string, unknown>, aliases: string[]): string => {
  for (const alias of aliases) {
    const value = row[alias];
    if (value != null && text(value)) return text(value);
  }
  return "";
};

async function tableRows(buffer: Buffer, filename: string): Promise<Array<{ rowNumber: number; values: Record<string, unknown> }>> {
  if (/\.csv$/i.test(filename)) {
    const parsed = parseCsv(buffer, { columns: true, skip_empty_lines: true, bom: true, trim: true }) as Record<string, unknown>[];
    return parsed.map((values, index) => ({ rowNumber: index + 2, values }));
  }
  if (!/\.xlsx$/i.test(filename)) throw Object.assign(new Error("仅支持 CSV 或 XLSX"), { statusCode: 400, code: "UNSUPPORTED_IMPORT" });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(text);
  const rows: Array<{ rowNumber: number; values: Record<string, unknown> }> = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = (row.values as unknown[]).slice(1);
    if (!values.some((value) => text(value))) return;
    rows.push({ rowNumber, values: Object.fromEntries(headers.map((header, index) => [header, values[index]])) });
  });
  return rows;
}

export async function parseSourceWorkbook(buffer: Buffer, filename: string): Promise<SourcePersonRow[]> {
  return (await tableRows(buffer, filename)).map(({ rowNumber, values }) => ({
    rowNumber,
    name: rowValue(values, ["姓名", "人员姓名", "name"]),
    nationalId: normalizeNationalId(rowValue(values, ["身份证号码", "身份证号", "nationalId"])),
    phone: normalizePhone(rowValue(values, ["手机号", "手机号码", "联系电话", "phone"])),
    workDepartment: rowValue(values, ["工作部门", "所属部门", "部门", "workDepartment"]),
    sourceDepartment: rowValue(values, ["来源部门", "来源单位", "sourceDepartment"])
  }));
}

export async function parsePhoneWorkbook(buffer: Buffer, filename: string): Promise<PhoneRow[]> {
  return (await tableRows(buffer, filename)).map(({ rowNumber, values }) => ({
    rowNumber,
    name: rowValue(values, ["姓名", "人员姓名", "name"]),
    nationalId: normalizeNationalId(rowValue(values, ["身份证号码", "身份证号", "nationalId"])),
    phone: normalizePhone(rowValue(values, ["手机号", "手机号码", "联系电话", "phone"]))
  }));
}

export const normalizeNationalId = (value: string): string => value.replace(/\s+/g, "").toUpperCase();

export function nationalIdError(value: string): string | null {
  if (!value) return "缺少身份证号码";
  if (!/^\d{17}[0-9X]$/.test(value)) return "身份证号码格式错误";
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = "10X98765432";
  const sum = value.slice(0, 17).split("").reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0);
  return checks[sum % 11] === value[17] ? null : "身份证号码校验码错误";
}

export const maskNationalId = (value: string): string => value ? `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}` : "—";
export const maskPhone = (value: string): string => /^1\d{10}$/.test(value) ? `${value.slice(0, 3)}****${value.slice(-4)}` : "—";

export function photoNameSuffix(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "").trim();
  const parts = stem.split(/[-－—]/);
  return (parts.at(-1) ?? "").replace(/\s+/g, "");
}

export function photoIdentity(filename: string): { nationalId: string; name: string } {
  const stem = filename.replace(/\.[^.]+$/, "").trim();
  const match = stem.match(/\d{17}[0-9Xx]/);
  if (!match) return { nationalId: "", name: photoNameSuffix(filename) };
  const name = `${stem.slice(0, match.index)}${stem.slice((match.index ?? 0) + match[0].length)}`.replace(/[+＋_\-—－\s]/g, "");
  return { nationalId: normalizeNationalId(match[0]), name };
}

export const maskPhotoFilename = (filename: string): string => filename.replace(/\d{17}[0-9Xx]/g, (value) => maskNationalId(value));
