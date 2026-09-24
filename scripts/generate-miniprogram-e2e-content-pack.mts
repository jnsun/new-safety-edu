import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "../apps/api/node_modules/exceljs/excel.js";
import { COURSEWARE_SCHEMA_VERSION, type StructuredCoursewareDocument } from "../packages/contracts/src/courseware.js";
import { createCoursewareXlsx } from "../apps/api/src/courseware-template.js";
import { parseCoursewareXlsx } from "../apps/api/src/courseware-import-xlsx.js";
import { parseQuestionImport } from "../apps/api/src/question-import.js";

const root = path.resolve("deliverables/miniprogram-e2e-test-content-v1");
await fs.mkdir(root, { recursive: true });
const write = (name: string, content: string | Buffer) => fs.writeFile(path.join(root, name), content);

const courseA: StructuredCoursewareDocument = {
  schemaVersion: COURSEWARE_SCHEMA_VERSION,
  title: "测试课件A｜作业前安全确认",
  summary: "用于验收结构化课件分段展示、学习位置恢复、随堂练习、情景选择和完成学习。内容为匿名测试材料。",
  learningObjectives: ["识别作业前必须确认的信息", "掌握发现异常后的停止和报告动作", "验证小程序结构化课件全部内容块"],
  estimatedMinutes: 12,
  units: [
    {
      key: "UNIT-A01", title: "先确认，再进入", estimatedMinutes: 4,
      blocks: [
        { key: "A01-K01", type: "knowledge", title: "先确认任务边界", body: "进入陌生作业区域前，应确认本次任务、作业范围、主要风险和现场联系人。没有确认清楚时，不要凭经验自行进入。", imageFileId: null },
        { key: "A01-DD01", type: "do_dont", title: "应做与禁止", dos: ["确认任务和作业范围", "确认危险区域和现场联系人", "按要求接受现场交底"], donts: ["跟随他人直接进入", "以熟悉类似工作为由跳过确认", "擅自扩大作业范围"] },
        { key: "A01-CP01", type: "checkpoint", prompt: "进入陌生作业现场前，首先应当怎么做？", questionType: "single_choice", options: ["确认任务、风险区域和现场联系人", "先进入现场再询问", "只看其他人如何操作"], correctIndexes: [0], explanation: "先确认任务和风险，再按现场安排进入。" },
        { key: "A01-S01", type: "summary", points: ["任务不清楚不进入", "风险不清楚不开始", "联系人和报告方式要提前确认"] }
      ]
    },
    {
      key: "UNIT-A02", title: "发现异常立即停下来", estimatedMinutes: 4,
      blocks: [
        { key: "A02-K01", type: "knowledge", title: "异常不是小事", body: "防护缺失、设备异常、环境变化或任务与交底不一致时，应先停止相关操作、远离或隔离风险，并向现场负责人报告。", imageFileId: null },
        { key: "A02-ST01", type: "steps", title: "异常处置四步", steps: ["停止可能扩大风险的操作", "提醒附近人员并保持安全距离", "报告现场负责人或管理人员", "未经确认不要擅自恢复作业"] },
        { key: "A02-CP01", type: "checkpoint", prompt: "发现设备防护缺失时，应选择哪些动作？", questionType: "multiple_choice", options: ["停止使用", "报告负责人", "保持安全距离", "继续使用到下班"], correctIndexes: [0,1,2], explanation: "先控制风险，再由有权限、有能力的人员处理。" },
        { key: "A02-S01", type: "summary", points: ["停止、隔离、报告", "未经确认不恢复", "如实记录发现的问题"] }
      ]
    },
    {
      key: "UNIT-A03", title: "情景判断与复盘", estimatedMinutes: 4,
      blocks: [
        { key: "A03-SC01", type: "scenario", prompt: "同事说任务很简单，可以跳过现场确认直接开始。你会怎么做？", choices: [
          { label: "坚持先完成任务和风险确认", consequence: "避免因信息不足进入错误区域或采取错误操作。", basis: "作业前应确认任务、风险和控制措施。" },
          { label: "跟随同事直接开始", consequence: "可能遗漏现场变化、人员分工和风险控制要求。", basis: "不能用经验替代本次现场确认。" },
          { label: "只在远处观察后自行决定", consequence: "观察不能替代交底和任务确认。", basis: "作业边界和职责应由有权限人员明确。" }
        ] },
        { key: "A03-CP01", type: "checkpoint", prompt: "完成办公室安全课程后，就可以直接进入任何现场作业。", questionType: "true_false", options: ["正确", "错误"], correctIndexes: [1], explanation: "不同现场仍需完成针对本项目和本任务的确认、交底与培训。" },
        { key: "A03-S01", type: "summary", points: ["安全确认要针对本次任务", "通用课程不能替代现场要求", "有疑问先问清楚再行动"] }
      ]
    }
  ]
};

const courseB: StructuredCoursewareDocument = {
  schemaVersion: COURSEWARE_SCHEMA_VERSION,
  title: "测试课件B｜个人防护与报告",
  summary: "用于验收多课件切换、继续下一项、退出后恢复和补学重新确认。",
  learningObjectives: ["正确检查个人防护用品", "掌握风险报告的必要信息"],
  estimatedMinutes: 8,
  units: [
    {
      key: "UNIT-B01", title: "个人防护用品检查", estimatedMinutes: 4,
      blocks: [
        { key: "B01-K01", type: "knowledge", title: "使用前必须检查", body: "根据任务和现场要求选择个人防护用品，并在使用前检查外观、有效状态和适配情况。发现损坏、过期或不适用时不得继续使用。", imageFileId: null },
        { key: "B01-ST01", type: "steps", title: "检查顺序", steps: ["确认任务需要的防护用品", "检查外观和有效状态", "正确佩戴并检查适配", "发现异常立即更换和报告"] },
        { key: "B01-CP01", type: "checkpoint", prompt: "防护用品看起来还能用，就可以忽略有效状态。", questionType: "true_false", options: ["正确", "错误"], correctIndexes: [1], explanation: "外观、有效状态和适用性都需要确认。" }
      ]
    },
    {
      key: "UNIT-B02", title: "把风险报告说清楚", estimatedMinutes: 4,
      blocks: [
        { key: "B02-DD01", type: "do_dont", title: "报告要具体", dos: ["说明地点和时间", "说明看到的异常", "说明已采取的临时措施", "留下可联系人员"], donts: ["只说“有问题”", "隐瞒已经发生的异常", "未经确认擅自恢复"] },
        { key: "B02-SC01", type: "scenario", prompt: "你发现通道被临时材料占用，最合适的做法是什么？", choices: [
          { label: "先提醒人员避让并报告具体位置", consequence: "能及时控制风险并便于安排清理。", basis: "风险报告应包含位置、现状和临时措施。" },
          { label: "只在群里发一句“注意安全”", consequence: "信息不具体，其他人难以找到并处理风险。", basis: "报告内容应足以支持处置。" }
        ] },
        { key: "B02-S01", type: "summary", points: ["防护用品使用前检查", "报告要包含位置、异常和措施", "未经确认不擅自恢复"] }
      ]
    }
  ]
};

const coursewareXlsx = await createCoursewareXlsx([
  { courseCode: "TEST-CW-001", document: courseA },
  { courseCode: "TEST-CW-002", document: courseB }
]);
await write("01_结构化课件_可直接导入.xlsx", coursewareXlsx);
await write("01_结构化课件_可直接导入.json", JSON.stringify({ templateVersion: COURSEWARE_SCHEMA_VERSION, courses: [
  { courseCode: "TEST-CW-001", document: courseA },
  { courseCode: "TEST-CW-002", document: courseB }
] }, null, 2));

const parsedCourseware = await parseCoursewareXlsx(coursewareXlsx);
if (parsedCourseware.issues.length || parsedCourseware.courses.length !== 2) throw new Error(`课件模板验证失败：${JSON.stringify(parsedCourseware.issues)}`);

const questionHeaders = ["题型","题干","选项A","选项B","选项C","选项D","正确答案","解析"];
const examRows = [
  ["单选题","进入陌生作业现场前首先应做什么","确认任务、风险区域和联系人","直接跟随同事进入","自行查看设备","等待别人开始后再决定","A","先确认本次任务和风险，再按安排进入。"],
  ["单选题","发现设备防护缺失时首先应做什么","停止使用并报告","继续使用但放慢速度","自行拆卸修理","拍照后继续作业","A","应先停止可能扩大风险的操作并报告。"],
  ["单选题","风险报告中最需要包含哪组信息","地点、异常和已采取措施","个人排名和积分","其他人的评价","与任务无关的历史情况","A","具体信息才能支持及时处置。"],
  ["单选题","培训任务显示“已锁定”通常表示什么","考试次数已达到限制，需要管理员解锁","已经取得资格","课件永久删除","账号已经注销","A","锁定只限制继续考试，不改变历史成绩。"],
  ["多选题","作业开始前应确认哪些内容","任务范围","主要风险","现场联系人","个人排行榜","A,B,C","确认任务、风险和联系人是作业前准备的一部分。"],
  ["多选题","发现异常后可以采取哪些动作","停止相关操作","提醒附近人员","报告负责人","隐瞒问题继续作业","A,B,C","先控制风险并如实报告。"],
  ["多选题","个人防护用品使用前应检查哪些方面","外观","有效状态","是否适合当前任务","同事是否喜欢","A,B,C","防护用品必须完好、有效并适用。"],
  ["多选题","培训记录可以如实包含哪些事实","学习完成情况","考试成绩","本人签字","自动可上岗结论","A,B,C","系统记录培训事实，不生成上岗结论。"],
  ["判断题","通用安全课程可以替代所有项目现场交底","正确","错误","","","B","项目现场仍需针对任务和环境进行确认与交底。"],
  ["判断题","考试失败后可以删除旧成绩再重新考试","正确","错误","","","B","失败记录保留，补学后产生新的考试尝试。"],
  ["判断题","本人正式提交签字后可以随意覆盖原签字","正确","错误","","","B","正式签字保留，不能由本人直接覆盖。"],
  ["判断题","每日安全挑战积分可以替代正式考试成绩","正确","错误","","","B","每日挑战与正式培训考试相互独立。"]
];

const challengeRows = [
  ["单选题","看到通道被材料占用时最合适的第一步是什么","提醒人员避让并报告具体位置","直接跨过去","等待别人处理","只发一句注意安全","A","先控制暴露风险并提供可处置的信息。"],
  ["单选题","防护用品损坏时应怎么做","停止使用并更换或报告","继续使用到当天结束","借给同事使用","自己简单改装","A","损坏的防护用品不能继续使用。"],
  ["单选题","现场任务与原交底不一致时应怎么做","暂停并重新确认","按原经验继续","自行扩大范围","忽略变化","A","任务变化需要重新确认风险和控制要求。"],
  ["多选题","有效的风险报告通常包含哪些信息","具体位置","异常现象","临时措施","无关人员隐私","A,B,C","提供足够信息以支持处置，同时避免无关敏感信息。"],
  ["多选题","进入现场前可以主动确认哪些事项","工作内容","危险区域","联系人和报告方式","积分排名","A,B,C","这些信息直接关系到本次作业安全。"],
  ["判断题","发现异常后，未经确认不应自行恢复作业","正确","错误","","","A","恢复作业前应确认风险已经得到控制。"],
  ["判断题","只要戴了安全帽，就不需要了解现场风险","正确","错误","","","B","个人防护不能替代风险识别和现场管理。"],
  ["判断题","每日挑战答错不应修改正式培训考试成绩","正确","错误","","","A","挑战记录和正式考试相互独立。"]
];

async function makeQuestionFiles(baseName: string, rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook(); workbook.creator = "安全生产管理平台";
  const sheet = workbook.addWorksheet("试题导入"); sheet.addRow(questionHeaders); rows.forEach((row) => sheet.addRow(row));
  sheet.views = [{ state: "frozen", ySplit: 1 }]; sheet.autoFilter = "A1:H1";
  [12,46,30,30,30,30,14,50].forEach((width, index) => sheet.getColumn(index + 1).width = width);
  sheet.getRow(1).height = 30; sheet.getRow(1).eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "245D47" } }; cell.font = { name: "Microsoft YaHei", bold: true, color: { argb: "FFFFFF" } }; cell.alignment = { vertical: "middle", horizontal: "center" }; });
  sheet.eachRow((row, number) => { if (number > 1) row.height = 40; row.eachCell((cell) => { cell.font = { ...(cell.font ?? {}), name: "Microsoft YaHei" }; cell.alignment = { ...(cell.alignment ?? {}), vertical: "middle", wrapText: true }; }); });
  const xlsxPath = path.join(root, `${baseName}.xlsx`); await workbook.xlsx.writeFile(xlsxPath);
  const escape = (value: unknown) => { const text = String(value ?? ""); return /[\",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const csv = "\uFEFF" + [questionHeaders, ...rows].map((row) => row.map(escape).join(",")).join("\r\n") + "\r\n";
  await write(`${baseName}.csv`, csv);
  for (const name of [`${baseName}.xlsx`, `${baseName}.csv`]) {
    const parsed = await parseQuestionImport(await fs.readFile(path.join(root, name)), name);
    if (parsed.errors.length || parsed.questions.length !== rows.length) throw new Error(`${name} 验证失败：${JSON.stringify(parsed.errors)}`);
  }
}
await makeQuestionFiles("02_正式考试题库_可直接导入", examRows);
await makeQuestionFiles("03_每日挑战题库_可直接导入", challengeRows);

await write("04_单文件HTML课件_可直接上传.html", `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>测试HTML课件｜异常报告演练</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f6f8f7;color:#102a24;font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif}.wrap{max-width:720px;margin:auto;padding:20px}.card{background:#fff;border:1px solid #dde7e2;border-radius:16px;padding:20px;margin:14px 0}.step{display:none}.step.active{display:block}h1{font-size:28px}h2{font-size:22px}.muted{color:#526760}.options button,.nav button{width:100%;min-height:48px;margin:8px 0;border-radius:12px;border:1px solid #9ab1a8;background:#fff;color:#174533;font-size:16px;padding:12px}.options button.selected{background:#eef5f1;border:2px solid #245d47}.nav button{background:#245d47;color:#fff;border:0}.bar{height:8px;background:#e4ece8;border-radius:8px;overflow:hidden}.bar i{display:block;height:100%;background:#245d47;width:25%}.result{display:none;background:#eef5f1;padding:14px;border-radius:12px;margin-top:12px}</style></head>
<body><main class="wrap"><h1>异常报告演练</h1><p class="muted">测试目标：HTML加载、交互、进度与返回小程序。</p><div class="bar"><i id="bar"></i></div>
<section class="card step active"><h2>1. 发现异常</h2><p>你发现作业通道被临时材料占用，人员仍在附近通行。</p><div class="nav"><button onclick="go(1)">继续</button></div></section>
<section class="card step"><h2>2. 选择第一步</h2><div class="options"><button onclick="choose(this,true)">提醒附近人员避让，并报告具体位置</button><button onclick="choose(this,false)">直接跨过去，等别人处理</button></div><div id="feedback" class="result"></div><div class="nav"><button onclick="go(2)">继续</button></div></section>
<section class="card step"><h2>3. 报告要点</h2><ul><li>具体地点和时间</li><li>看到的异常情况</li><li>已经采取的临时措施</li><li>需要谁进一步处理</li></ul><div class="nav"><button onclick="go(3)">完成本页</button></div></section>
<section class="card step"><h2>页面学习完成</h2><p>请返回小程序，在任务课件页面按现有流程确认“完成学习”。</p></section></main>
<script>let current=0,answered=false;const steps=[...document.querySelectorAll('.step')];function show(){steps.forEach((s,i)=>s.classList.toggle('active',i===current));document.getElementById('bar').style.width=((current+1)/steps.length*100)+'%';scrollTo(0,0)}function go(n){if(current===1&&!answered){alert('请先选择一个答案');return}current=n;show()}function choose(el,ok){answered=true;document.querySelectorAll('.options button').forEach(b=>b.classList.remove('selected'));el.classList.add('selected');const f=document.getElementById('feedback');f.style.display='block';f.textContent=ok?'正确：先控制人员暴露，再准确报告位置和异常。':'需要调整：不能把已经发现的风险留给其他人。'}</script></body></html>`);

await write("05_富文本课件_后台粘贴稿.md", `# 测试富文本课件｜培训记录与本人签字

> 用途：在 Web 后台新建“图文/富文本课件”时复制粘贴，用于验证富文本展示。不是批量导入文件。

## 培训记录只记录事实

培训记录应如实反映学习内容、完成时间、考试结果、本人签字和项目现场确认等事实。系统不会因为完成一门课程就自动生成“可上岗”或“通行资格”结论。

## 本人签字的要求

1. 学员应先查看完整培训记录；
2. 由本人在小程序签字画布上手写；
3. 提交前可以清空重写；
4. 正式提交后不能由本人覆盖；
5. 如需更正，应保留原记录和审计信息。

## 记住

- 学习、考试、签字分别形成真实记录；
- 考试失败记录不会被删除；
- 项目入场教育签字后仍需项目现场确认。
`);

await write("00_先读我_使用说明.md", `# 小程序主要流程测试内容包

本包用于**测试系统流程**，不是正式培训教材。请先在测试站使用匿名测试人员验证，确认流程正常后再批量制作正式内容。

## 可直接导入/上传

1. **01_结构化课件_可直接导入.xlsx**：一次导入两门课件，覆盖知识卡、应做/禁止、步骤、单选/多选/判断随堂题、情景选择和总结。
2. **01_结构化课件_可直接导入.json**：与 XLSX 内容相同，二选一导入，不要重复导入。
3. **02_正式考试题库_可直接导入.xlsx/csv**：12题，二选一导入。
4. **03_每日挑战题库_可直接导入.xlsx/csv**：8题，二选一导入；导入后仍需在“日常挑战”页启用。
5. **04_单文件HTML课件_可直接上传.html**：用于新建 single_html 课件。

## 需要后台手工操作

- 富文本课件没有批量导入接口，请复制 05 文件内容新建一门图文课件；
- 培训模板、固定试卷、随机试卷和培训下发没有文件导入接口，请按 07 配置；
- 每日挑战题导入后要人工启用并设置分类/难度；
- 所有课件导入/创建后先检查预览，再发布版本。

## 建议测试账号

- 1名 active 正式员工：测试三级教育优先、日常培训、考试、补学、锁定、签字；
- 1名项目管理员：测试催办、解锁和项目现场确认；
- 1名外协或临时个人：测试项目入场教育，不参加正式员工三级教育。
`);

await write("06_AI生成完整测试材料提示词.md", `# 可直接交给 AI 的提示词

你要为“安全生产教育培训小程序”制作一套**仅用于功能验收的匿名测试材料**。不要制作正式制度教材，不要使用真实人员、真实项目、手机号、身份证号、签字或内部秘密。

请严格遵守以下要求：

## 一、测试目标

材料需要帮助人工验证：多课件列表、分段学习、上一项/下一项、学习位置恢复、单选/多选/判断随堂题、情景选择、HTML课件、完成学习、正式考试、答案自动保存、退出后恢复、不及格、补学、次数耗尽锁定、管理员解锁、通过后本人签字、项目确认、本人记录、每日挑战、积分和排行榜。

## 二、结构化课件

严格按提供的“01_结构化课件_可直接导入.xlsx”工作表和表头生成，不增删或改名工作表、表头。课程编码、单元编码、内容块编码必须稳定且唯一。至少生成2门课件，每门2—3个单元；六类内容块 knowledge、do_dont、steps、checkpoint、scenario、summary 都要出现。随堂题不是正式考试题，不得用随堂题提前泄露正式试卷答案。

## 三、正式考试题库

严格按“02_正式考试题库_可直接导入.xlsx”8列生成：题型、题干、选项A、选项B、选项C、选项D、正确答案、解析。只允许单选题、多选题、判断题。答案写 A 或 A,B；判断题 A=正确、B=错误。至少12题，三种题型都要覆盖，同一文件不得有重复题干。

## 四、每日挑战

严格按“03_每日挑战题库_可直接导入.xlsx”8列生成。每题20—45秒可完成，题干短、场景具体、解析可行动。每日挑战与正式培训、正式考试、签字和项目确认完全独立，积分不得代表培训完成或上岗资格。另附人工配置建议：分类和 easy/medium/hard 难度，但不要新增导入列。

## 五、HTML课件

只生成一个自包含 .html 文件，使用原生 HTML/CSS/JavaScript，不引用外部脚本、字体、图片或网络地址。适配手机窄屏，按钮最小44px，包含3—5步交互和清晰进度。完成后提示用户返回小程序按现有流程确认完成，不自行伪造小程序学习完成状态。

## 六、内容边界

- 只记录培训事实和下一步动作；
- 不输出“可上岗、禁止上岗、准入有效、通行资格”等结论；
- 不编造法规、事故、统计数字；
- 不把课件模板当作题库、每日挑战或游戏模板；
- 测试数据必须显著标注“测试”；
- 输出后逐项自检表头、编码、答案、重复题、移动端长度和敏感信息。

先输出10%的样例和校验结果，待人工确认后再扩充；不要直接生成数百条未经审核的内容。
`);

await write("07_Web后台配置步骤.md", `# Web 后台配置步骤

## 1. 导入并发布课件

1. 进入“课件与模板 → 课件”。
2. 打开批量导入，上传 **01_结构化课件_可直接导入.xlsx**。
3. 预检查应显示2门可导入课件；确认导入。
4. 检查两门课件移动端预览并发布版本。
5. 新建单文件 HTML 课件，上传 04 文件并发布。
6. 新建图文/富文本课件，粘贴 05 内容并发布。

## 2. 创建四个培训模板

| 模板名称 | 类型 | 课件顺序 | 用途 |
|---|---|---|---|
| TEST-三级教育模板 | 三级教育 | 课件A → 课件B → HTML → 富文本 | 验证三级教育优先和强制考试 |
| TEST-项目入场教育模板 | 项目入场教育 | 课件A → HTML | 验证项目确认 |
| TEST-日常培训-考试 | 日常/年度培训 | 课件A → 课件B | 验证失败、补学、锁定、解锁、通过 |
| TEST-日常培训-免考试 | 日常/年度培训 | 富文本课件 | 验证无考试直接进入本人签字 |

## 3. 导入题目并创建试卷

1. 新建题库：**TEST-小程序全流程题库**。
2. 导入 02 文件，预期成功12题、失败0题。
3. 新建固定试卷：**TEST-固定试卷-8题**，从题库选择前8题，每题12.5分。
4. 新建随机试卷：**TEST-随机试卷-5题**，指定该题库，题量5。

## 4. 导入每日挑战

1. 可新建题库：**TEST-每日挑战题库**。
2. 导入 03 文件，预期成功8题、失败0题。
3. 进入“题库与试卷 → 日常挑战”，筛选本批题目并批量启用。
4. 分类建议：作业准备、个人防护、风险报告；难度可先设 easy/medium。

## 5. 下发建议

### A. 日常培训考试全流程

- 模板：TEST-日常培训-考试
- 试卷：TEST-固定试卷-8题
- 时长：15分钟
- 合格分：80
- 最大次数：2
- 只下发给隔离测试组织的测试人员

测试顺序：学习第一门到中间退出 → 恢复位置 → 完成全部课件 → 开始考试答几题退出 → 恢复同一 attempt → 第一次故意不及格 → 完成全部补学 → 第二次故意不及格进入锁定 → 管理员填写原因解锁 → 再次补学 → 正确作答通过 → 本人签字 → 查看记录。

### B. 免考试流程

- 模板：TEST-日常培训-免考试
- 关闭“需要考试”

验证课件完成后直接进入“待本人签字”，签字后完成。

### C. 项目入场教育

- 使用隔离测试项目和 TEST-项目入场教育模板
- 必须配置考试

验证签字后进入“待项目确认”，由项目管理员确认到场和已接受现场交底后完成。

### D. 三级教育优先

- 仅对隔离的 active 正式员工验证
- 配置 TEST-三级教育模板和试卷为默认自动任务

验证三级教育显示为优先任务；不要在正式人员上重复生成测试任务。
`);

await write("08_小程序人工验收清单.md", `# 小程序人工验收清单

## 登录与身份

- [ ] 微信已绑定人员可直接登录
- [ ] 未绑定微信按现有流程完成手机号匹配或申请
- [ ] 普通人员看不到无权限管理操作

## 学习

- [ ] 待办第一屏显示必须完成任务
- [ ] 任务详情显示全部课件和下一步
- [ ] 课件A/B可进入，上一项/下一项可操作
- [ ] 单选、多选、判断随堂题均可完成
- [ ] 情景选择后可查看影响和依据并继续
- [ ] 退出课件再进入恢复到最后有效位置
- [ ] 未完成全部课件时不能开始正式考试
- [ ] HTML课件正常加载并能返回
- [ ] 多门课件可以切换到下一门

## 正式考试

- [ ] 开始考试不返回正确答案
- [ ] 答案自动保存
- [ ] 退出后恢复同一 attempt 和剩余时间
- [ ] 第一次失败进入补学
- [ ] 补学必须逐项重新完成
- [ ] 达到次数后显示已锁定
- [ ] 管理解锁不修改旧成绩或删除历史 attempt
- [ ] 正确作答后进入待签字

## 签字与记录

- [ ] Canvas有效书写、清空、预览正常
- [ ] 正式提交后本人不能覆盖
- [ ] 普通培训签字后完成
- [ ] 项目入场教育签字后进入待项目确认
- [ ] 项目管理员确认后完成
- [ ] 本人记录显示课程、成绩、通过和签字状态

## 挑战与消息

- [ ] 每日挑战显示5题并逐题反馈
- [ ] 首次正确计分，重复提交不重复计分
- [ ] 排行榜可以定位本人
- [ ] 挑战积分不改变正式培训状态
- [ ] 催办、临期/逾期和审核消息可查看
`);

console.log(JSON.stringify({ root, coursewares: parsedCourseware.courses.length, examQuestions: examRows.length, challengeQuestions: challengeRows.length }, null, 2));
