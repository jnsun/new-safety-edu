import ExcelJS from "exceljs";

export type QualificationImportReference = {
  organizations: Array<{ id: string; name: string }>;
  persons: Array<{ id: string; name: string }>;
  types: Array<{ id: string; name: string; category: "company" | "personal"; subtype1Label: string | null; subtype1Options: unknown; subtype2Label: string | null; subtype2Options: unknown }>;
};
export type QualificationImportRow = {
  rowNumber: number; status: "ready" | "invalid" | "conflict"; reasons: string[]; warnings: string[]; existingId?: string; conflictAction?: "skip" | "renew" | "void_and_create";
  category?: "company" | "personal"; ownerId?: string; ownerName: string; typeId?: string; typeName: string; name: string;
  certificateNo?: string; subtype1Value?: string; subtype2Value?: string; issuingAuthority?: string; issuedAt?: string;
  validFrom?: string; expiresAt?: string; isLongTerm: boolean; holderPosition?: string; scope?: string; remark?: string;
};

const headers = ["大类", "所属组织", "持证人", "证照类型", "证照名称", "证照编号", "子分类1", "子分类2", "发证机关", "发证日期", "有效期开始", "有效期至", "长期有效", "持证岗位", "许可范围", "备注"];
const requiredHeaders = ["大类", "所属组织", "持证人", "证照类型", "证照名称"];
const text = (value: unknown) => String(value ?? "").trim();
function day(value: unknown) {
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = text(value); return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) ? raw : null;
}

export async function parseQualificationWorkbook(buffer: Buffer, reference: QualificationImportReference) {
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer); const sheet = workbook.getWorksheet("证照导入") ?? workbook.worksheets[0];
  if (!sheet) return { rows: [] as QualificationImportRow[], errors: ["工作簿没有工作表"], unknownHeaders: [] as string[] };
  const headerValues = (sheet.getRow(1).values as unknown[]).slice(1).map(text); const indexes = new Map(headerValues.map((name, index) => [name, index]));
  const missing = requiredHeaders.filter((name) => !indexes.has(name)); if (missing.length) return { rows: [] as QualificationImportRow[], errors: [`缺少表头：${missing.join("、")}`], unknownHeaders: headerValues.filter((name) => name && !headers.includes(name)) };
  const unknownHeaders = headerValues.filter((name) => name && !headers.includes(name)); const orgByName = new Map(reference.organizations.map((row) => [row.name, row]));
  const typesByName = new Map(reference.types.map((row) => [row.name, row])); const personsByName = new Map<string, Array<{ id: string; name: string }>>();
  reference.persons.forEach((person) => personsByName.set(person.name, [...(personsByName.get(person.name) ?? []), person])); const rows: QualificationImportRow[] = []; const seen = new Set<string>();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const values = (sheet.getRow(rowNumber).values as unknown[]).slice(1); if (values.every((value) => !text(value))) continue;
    const get = (name: string) => values[indexes.get(name) ?? -1]; const rawCategory = text(get("大类")); const category = rawCategory === "公司" || rawCategory === "company" ? "company" : rawCategory === "个人" || rawCategory === "personal" ? "personal" : undefined;
    const organizationName = text(get("所属组织")); const holderName = text(get("持证人")); const ownerName = category === "personal" ? holderName : organizationName; const typeName = text(get("证照类型")); const name = text(get("证照名称")); const type = typesByName.get(typeName); const reasons: string[] = []; const warnings = unknownHeaders.map((header) => `未识别列“${header}”不会导入`);
    if (!category) reasons.push("大类必须填写公司或个人"); if (!type) reasons.push("证照类型不存在或已停用"); else if (category && type.category !== category) reasons.push("证照类型与大类不匹配"); if (!name) reasons.push("证照名称必填");
    let ownerId: string | undefined; if (category === "company") { const org = orgByName.get(organizationName); if (!org) reasons.push("所属组织不存在或名称不精确"); else ownerId = org.id; } else if (category === "personal") { const people = personsByName.get(holderName) ?? []; if (!holderName) reasons.push("个人证照必须填写持证人"); else if (people.length !== 1) reasons.push(people.length ? "持证人姓名重名，请手工录入" : "持证人不存在"); else ownerId = people[0]!.id; }
    const subtype1Value = text(get("子分类1")) || undefined; const subtype2Value = text(get("子分类2")) || undefined; const one = Array.isArray(type?.subtype1Options) ? type.subtype1Options as string[] : []; const two = Array.isArray(type?.subtype2Options) ? type.subtype2Options as string[] : [];
    if (one.length && !one.includes(subtype1Value ?? "")) reasons.push(`${type?.subtype1Label ?? "子分类1"}不在字典选项中`); if (two.length && !two.includes(subtype2Value ?? "")) reasons.push(`${type?.subtype2Label ?? "子分类2"}不在字典选项中`);
    const issuedAt = day(get("发证日期")); const validFrom = day(get("有效期开始")); const expiresAt = day(get("有效期至")); if (issuedAt === null) reasons.push("发证日期格式应为 YYYY-MM-DD"); if (validFrom === null) reasons.push("有效期开始格式应为 YYYY-MM-DD"); if (expiresAt === null) reasons.push("有效期至格式应为 YYYY-MM-DD");
    const isLongTerm = ["是", "长期", "true", "1"].includes(text(get("长期有效")).toLowerCase()); if (!isLongTerm && !expiresAt) reasons.push("非长期证照必须填写有效期至"); if (validFrom && expiresAt && validFrom > expiresAt) reasons.push("有效期至不能早于有效期开始");
    const certificateNo = text(get("证照编号")) || undefined; const duplicateKey = [category, ownerId, type?.id, name, certificateNo, subtype1Value, subtype2Value, issuedAt, validFrom, expiresAt, isLongTerm].join("|"); if (seen.has(duplicateKey)) reasons.push("文件内存在完全重复记录"); seen.add(duplicateKey);
    rows.push({ rowNumber, status: reasons.length ? "invalid" : "ready", reasons, warnings, ...(category ? { category } : {}), ...(ownerId ? { ownerId } : {}), ownerName, ...(type ? { typeId: type.id } : {}), typeName, name, ...(certificateNo ? { certificateNo } : {}), ...(subtype1Value ? { subtype1Value } : {}), ...(subtype2Value ? { subtype2Value } : {}), ...(text(get("发证机关")) ? { issuingAuthority: text(get("发证机关")) } : {}), ...(issuedAt ? { issuedAt } : {}), ...(validFrom ? { validFrom } : {}), ...(expiresAt ? { expiresAt } : {}), isLongTerm, ...(text(get("持证岗位")) ? { holderPosition: text(get("持证岗位")) } : {}), ...(text(get("许可范围")) ? { scope: text(get("许可范围")) } : {}), ...(text(get("备注")) ? { remark: text(get("备注")) } : {}) });
  }
  if (rows.length > 1000) return { rows: [], errors: ["单次最多导入 1000 行"], unknownHeaders };
  return { rows, errors: [] as string[], unknownHeaders };
}
