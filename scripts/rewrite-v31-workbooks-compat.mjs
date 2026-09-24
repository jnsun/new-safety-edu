import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { FileBlob, SpreadsheetFile } from "file:///C:/Users/sjn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const require = createRequire(import.meta.url);
const ExcelJS = require("../apps/api/node_modules/exceljs");
const outDir = path.resolve("deliverables/miniprogram-ui-reference-v3.1/09_实际导入模板");
const previewDir = path.join(outDir, "预览");
const green = "245D47", soft = "EEF5F1", text = "102A24", red = "C83D3D";
const headers = ["题型","题干","选项A","选项B","选项C","选项D","正确答案","解析"];

function styleSheet(sheet, headerRow = 1) {
  sheet.views = [{ state: "frozen", ySplit: headerRow }];
  sheet.getRow(headerRow).height = 30;
  sheet.getRow(headerRow).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: green } };
    cell.font = { name: "Microsoft YaHei", bold: true, color: { argb: "FFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  sheet.eachRow((row, number) => {
    row.eachCell((cell) => { cell.font = { ...(cell.font ?? {}), name: "Microsoft YaHei", color: cell.font?.color ?? { argb: text } }; cell.alignment = { ...(cell.alignment ?? {}), vertical: "middle", wrapText: true }; });
    if (number > headerRow) row.height = Math.max(row.height ?? 22, 34);
  });
}
function addRows(sheet, rows) { rows.forEach((row) => sheet.addRow(row)); }

async function validateVisual(fileName, sheetNames) {
  const file = await FileBlob.load(path.join(outDir, fileName));
  const wb = await SpreadsheetFile.importXlsx(file);
  for (const sheetName of sheetNames) {
    const png = await wb.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
    await fs.writeFile(path.join(previewDir, `${fileName.replace(/\.xlsx$/,'')}_${sheetName}_final.png`), new Uint8Array(await png.arrayBuffer()));
  }
  const inspected = await wb.inspect({ kind: "sheet,region", maxChars: 3500, tableMaxRows: 6, tableMaxCols: 10, tableMaxCellChars: 90 });
  console.log(fileName, inspected.ndjson.slice(0, 900));
}

async function formalWorkbook() {
  const wb = new ExcelJS.Workbook(); wb.creator = "安全生产管理平台";
  const s = wb.addWorksheet("试题导入");
  addRows(s, [headers,
    ["单选题","进入施工现场前应首先完成哪项工作","接受安全教育和现场交底","直接进入作业区","自行寻找作业面","先操作设备","A","进入现场前应先完成规定的安全教育和现场交底。"],
    ["多选题","培训记录应如实包含哪些事实","学习完成情况","考试结果","本人签字","通行资格","A,B,C","系统记录培训事实，不生成通行资格。"],
    ["判断题","考试答案可以在开考前返回客户端","正确","错误","","","B","正确答案和评分规则不得提前返回客户端。"]]);
  [12,42,28,28,28,28,14,46].forEach((w,i)=>s.getColumn(i+1).width=w); styleSheet(s);
  const h = wb.addWorksheet("填写说明"); addRows(h, [["项目","说明"],["用途","可直接用于当前 Web 管理后台题库批量导入"],["支持格式","XLSX 或 CSV；系统读取第一个工作表"],["题型","单选题、多选题、判断题"],["正确答案","填写选项字母，例如 A 或 A,B"],["判断题","A=正确，B=错误"],["校验方式","任一行错误会阻止整批写入"],["禁止","不得新增、删除或改名第一个工作表的8个表头"],["数据安全","不得包含真实人员敏感信息"]]); h.getColumn(1).width=18; h.getColumn(2).width=70; styleSheet(h);
  await wb.xlsx.writeFile(path.join(outDir,"正式题库_实际导入模板.xlsx"));
  await validateVisual("正式题库_实际导入模板.xlsx", ["试题导入","填写说明"]);
}

async function challengeWorkbook() {
  const wb = new ExcelJS.Workbook(); wb.creator = "安全生产管理平台";
  const s = wb.addWorksheet("试题导入"); addRows(s, [headers,
    ["单选题","发现临时用电电缆破损时应如何处理","立即停止使用并报告","用胶带简单包扎继续使用","避开破损处继续使用","等下班后再处理","A","先隔离风险并报告，由有资质人员处理。"],
    ["多选题","进入陌生作业现场前应确认哪些信息","任务范围","危险区域","现场联系人","个人排行榜","A,B,C","确认任务、风险和联系人能减少误入危险区域。"],
    ["判断题","每日挑战积分可以替代正式培训考试成绩","正确","错误","","","B","每日挑战与正式培训考试相互独立。"]]); [12,42,28,28,28,28,14,46].forEach((w,i)=>s.getColumn(i+1).width=w); styleSheet(s);
  const c = wb.addWorksheet("挑战配置参考"); addRows(c, [["题号/题干摘要","建议分类","建议难度","是否启用","重要说明"],["发现电缆破损","临时用电","easy","是","本页不被导入器读取"],["陌生现场确认信息","作业准备","medium","是","导入后在后台人工配置"],["积分替代正式考试","培训规则","easy","是","挑战与正式培训相互独立"],["自编题目","","","","不要在本页放待导入题目"]]); [32,18,16,16,42].forEach((w,i)=>c.getColumn(i+1).width=w); styleSheet(c);
  const h = wb.addWorksheet("导入后操作"); addRows(h, [["步骤","操作"],[1,"在题库中导入第一个工作表"],[2,"进入“题库与试卷 → 日常挑战”"],[3,"筛选并勾选本批题目"],[4,"批量启用“用于日常挑战”"],[5,"逐题设置分类和难度"],["注意","当前系统不会导入第二个工作表的挑战配置"]]); h.getColumn(1).width=14; h.getColumn(2).width=70; styleSheet(h);
  await wb.xlsx.writeFile(path.join(outDir,"每日挑战题_实际导入模板.xlsx"));
  await validateVisual("每日挑战题_实际导入模板.xlsx", ["试题导入","挑战配置参考","导入后操作"]);
}

async function gameWorkbook() {
  const wb = new ExcelJS.Workbook(); wb.creator = "安全生产管理平台";
  const cover = wb.addWorksheet("请先阅读"); cover.mergeCells("A1:F2"); cover.getCell("A1").value="游戏内容制作草稿｜不可直接导入"; cover.getCell("A1").fill={type:"pattern",pattern:"solid",fgColor:{argb:red}}; cover.getCell("A1").font={name:"Microsoft YaHei",size:20,bold:true,color:{argb:"FFFFFF"}}; cover.getCell("A1").alignment={horizontal:"center",vertical:"middle"};
  addRows(cover, [[],["项目","说明"],["当前状态","系统尚无游戏数据模型、管理页面和导入接口"],["本文件用途","提前制作和审核长期游戏内容"],["不可执行","不能上传后台，不能声称已兼容系统"],["推荐玩法","找隐患、步骤排序、情景选择"],["正式边界","积分和游戏不得改变培训完成、考试通过或准入状态"],["后续动作","游戏接口完成后另行发布实际导入模板"]]); cover.getColumn(1).width=18; cover.getColumn(2).width=76; styleSheet(cover,4);
  const defs = [
    ["游戏清单",["游戏编号","名称","玩法","学习目标","适用人群","预计时长(分钟)","积分建议","状态","备注"],["G001","野外现场找隐患","找隐患","识别常见现场风险","项目成员",3,5,"草稿","不可直接导入"]],
    ["情景选择",["游戏编号","关卡编号","情景题干","选项A","选项B","选项C","正确答案","正确反馈","错误反馈","判断依据"],["G002","L01","临时进入陌生现场时应先做什么","确认任务、风险区域和联系人","直接跟随他人进入","先自行查看设备","A","先确认再进入","不能把跟随或自行查看当作安全确认","填写制度或法规依据"]],
    ["步骤排序",["游戏编号","关卡编号","任务名称","步骤1","步骤2","步骤3","步骤4","正确顺序","错误反馈","依据"],["G003","L01","作业前准备","确认任务","识别风险","检查防护","接受交底","1,2,3,4","重新检查作业前准备顺序","填写制度依据"]],
    ["找隐患",["游戏编号","关卡编号","场景图片文件名","热点编号","热点X百分比","热点Y百分比","热点半径百分比","隐患名称","正确反馈","替代文本"],["G001","L01","scene-001.png","H01",35,42,8,"电缆破损","发现正确：停止使用并报告","作业区地面有破损电缆"]],
    ["素材清单",["素材编号","文件名","类型","用途","版权/来源","尺寸建议","替代文本","状态"],["A001","scene-001.png","图片","找隐患场景","自制或已授权","1560×1200","作业区现场示意","待制作"]],
    ["审核清单",["游戏编号","事实准确","依据已核对","无敏感信息","不含准入结论","移动端可读","素材有版权","审核人","结论/备注"],["G001","待审","待审","是","是","待审","待审","",""]]
  ];
  for (const [name, hs, example] of defs) { const s=wb.addWorksheet(name); addRows(s,[hs,example]); hs.forEach((_,i)=>s.getColumn(i+1).width=Math.min(42,Math.max(14,String(hs[i]).length*2+6))); styleSheet(s); }
  await wb.xlsx.writeFile(path.join(outDir,"游戏内容制作草稿_不可直接导入.xlsx"));
  await validateVisual("游戏内容制作草稿_不可直接导入.xlsx", ["请先阅读",...defs.map(([name])=>name)]);
}

await formalWorkbook(); await challengeWorkbook(); await gameWorkbook();
console.log("COMPAT_WORKBOOKS_DONE");
