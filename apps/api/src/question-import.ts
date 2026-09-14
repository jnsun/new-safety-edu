import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import type { QuestionType } from "@prisma/client";

export type ImportedQuestion = { rowNumber: number; type: QuestionType; prompt: string; options: string[]; correct: string[]; explanation?: string };
export type QuestionImportError = { rowNumber: number; reason: string };

const headers = ["题型", "题干", "选项A", "选项B", "选项C", "选项D", "正确答案", "解析"] as const;
const typeAliases: Record<string, QuestionType> = {
  "单选": "single_choice", "单选题": "single_choice", single_choice: "single_choice",
  "多选": "multiple_choice", "多选题": "multiple_choice", multiple_choice: "multiple_choice",
  "判断": "true_false", "判断题": "true_false", true_false: "true_false"
};
const text = (value: unknown) => String(value ?? "").trim();

export const questionImportTemplate = () => `\uFEFF${headers.join(",")}\r\n单选题,进入施工现场应首先做什么,接受安全教育,直接作业,自行参观,离开现场,A,示例解析\r\n多选题,培训记录应包含哪些内容,学习情况,考试结果,本人签字,通行资格,"A,B,C",\r\n判断题,考试答案可由客户端提前获取,正确,错误,,,B,\r\n`;

function parseRows(rows: unknown[][]) {
  const first = rows[0]?.map(text) ?? [];
  const index = new Map(first.map((name, position) => [name, position]));
  const missing = headers.filter((name) => !index.has(name));
  if (missing.length) return { questions: [] as ImportedQuestion[], errors: [{ rowNumber: 1, reason: `缺少表头：${missing.join("、")}` }] };
  const questions: ImportedQuestion[] = [];
  const errors: QuestionImportError[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((row, offset) => {
    const rowNumber = offset + 2;
    if (row.every((value) => !text(value))) return;
    const get = (name: typeof headers[number]) => text(row[index.get(name)!]);
    const type = typeAliases[get("题型")];
    const prompt = get("题干");
    const rawOptions = [get("选项A"), get("选项B"), get("选项C"), get("选项D")];
    const options = type === "true_false" ? ["正确", "错误"] : rawOptions.filter(Boolean);
    const letters = get("正确答案").toUpperCase().split(/[，,、\s]+/).filter(Boolean);
    const answerIndexes = letters.map((letter) => "ABCD".indexOf(letter));
    const reasons: string[] = [];
    if (!type) reasons.push("题型无效");
    if (prompt.length < 2) reasons.push("题干至少 2 个字符");
    if (options.length < 2) reasons.push("至少填写两个选项");
    if (!letters.length || answerIndexes.some((position) => position < 0 || position >= options.length)) reasons.push("正确答案应填写有效选项字母，如 A 或 A,B");
    if (type === "single_choice" && letters.length !== 1) reasons.push("单选题只能有一个正确答案");
    if (type === "true_false" && (letters.length !== 1 || answerIndexes[0]! > 1)) reasons.push("判断题正确答案只能填写 A 或 B");
    const key = `${type}|${prompt}`;
    if (seen.has(key)) reasons.push("文件内存在重复题目");
    seen.add(key);
    if (reasons.length || !type) errors.push({ rowNumber, reason: reasons.join("；") });
    else questions.push({ rowNumber, type, prompt, options, correct: answerIndexes.map((position) => options[position]!), ...(get("解析") ? { explanation: get("解析") } : {}) });
  });
  if (!questions.length && !errors.length) errors.push({ rowNumber: 2, reason: "文件中没有试题" });
  return { questions, errors };
}

export async function parseQuestionImport(buffer: Buffer, filename: string) {
  if (/\.csv$/i.test(filename)) {
    const records = parse(buffer, { bom: true, skip_empty_lines: false, relax_column_count: true }) as unknown[][];
    return parseRows(records);
  }
  if (!/\.xlsx$/i.test(filename)) throw Object.assign(new Error("仅支持 .xlsx 或 .csv 文件"), { statusCode: 400, code: "INVALID_IMPORT_FILE" });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { questions: [], errors: [{ rowNumber: 1, reason: "工作簿没有工作表" }] };
  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => rows.push((row.values as unknown[]).slice(1)));
  return parseRows(rows);
}
