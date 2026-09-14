import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { maskPhotoFilename, nationalIdError, parsePhoneWorkbook, parseSourceWorkbook, photoIdentity, photoNameSuffix } from "../src/person-import-core.ts";

const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const checks = "10X98765432";
const base = "1".repeat(17);
const nationalId = `${base}${checks[base.split("").reduce((sum, digit, index) => sum + Number(digit) * weights[index]!, 0) % 11]}`;

const sourceBook = new ExcelJS.Workbook(); const sourceSheet = sourceBook.addWorksheet("人员");
sourceSheet.addRow(["姓名", "身份证号码", "手机号码", "工作部门", "来源部门"]); sourceSheet.addRow(["匿名人员", nationalId, "130 0000 0000", "匿名部门", "匿名来源"]);
const source = await parseSourceWorkbook(Buffer.from(await sourceBook.xlsx.writeBuffer()), "source.xlsx");
assert.deepEqual(source, [{ rowNumber: 2, name: "匿名人员", nationalId, phone: "13000000000", workDepartment: "匿名部门", sourceDepartment: "匿名来源" }]);
assert.equal(nationalIdError(nationalId), null); assert.equal(nationalIdError(`${nationalId.slice(0, 17)}${nationalId.endsWith("0") ? "1" : "0"}`), "身份证号码校验码错误");

const phoneBook = new ExcelJS.Workbook(); const phoneSheet = phoneBook.addWorksheet("手机号");
phoneSheet.addRow(["姓名", "身份证号", "手机号码"]); phoneSheet.addRow(["匿名人员", nationalId, "130 0000 0000"]);
const phones = await parsePhoneWorkbook(Buffer.from(await phoneBook.xlsx.writeBuffer()), "phones.xlsx");
assert.equal(phones[0]?.nationalId, nationalId); assert.equal(phones[0]?.phone, "13000000000");
assert.equal(photoNameSuffix("匿名前缀-匿名人员.jpeg"), "匿名人员");
assert.deepEqual(photoIdentity(`${nationalId}+匿名人员.jpeg`), { nationalId, name: "匿名人员" });
assert.equal(maskPhotoFilename(`${nationalId}匿名人员.jpeg`), `**************${nationalId.slice(-4)}匿名人员.jpeg`);
console.log("person_import_core_check=PASS");
