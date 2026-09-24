import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "file:///C:/Users/sjn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const root = path.resolve("deliverables/miniprogram-ui-reference-v3.1");
const designDir = path.join(root, "08_路由映射_风格指南_设计参数_图片");
const imageDir = path.join(designDir, "images");
const templateDir = path.join(root, "09_实际导入模板");
const promptDir = path.join(root, "10_AI任务提示词");
await Promise.all([imageDir, templateDir, promptDir].map((dir) => fs.mkdir(dir, { recursive: true })));

const write = (relative, value) => fs.writeFile(path.join(root, relative), value.trimStart(), "utf8");

await write("00_使用说明.md", `# 安全生产教育培训小程序 V3.1 UI 与内容生产参考包

版本：V3.1（浅色主题）  
用途：交给 UI 设计 AI、课件制作 AI、题库编写人员和研发人员长期复用。  
基线：以当前系统真实能力为准，规划能力明确标注，不把规划页面冒充已上线功能。

## 使用顺序

1. 先读 01—06，理解产品边界、用户、流程和内容规范。
2. UI 设计与开发必须读第 08 项；其中路由、风格、参数、图片缺一不可。
3. 生成题目时只使用第 09 项对应模板。课件模板不能代替题库、每日挑战或游戏模板。
4. 游戏当前没有导入接口，提供的是长期内容制作草稿，文件名和封面均标明“不可直接导入”。
5. 所有示例姓名、日期、积分和课程均为虚构展示，不得当作生产数据。

## 交付内容

- 27 个 V3.1 页面/状态参考图，全部为浅色主题；
- 五 Tab 信息架构与现有 18 个路由映射；
- 颜色、字体、间距、圆角、控件、状态和无障碍参数；
- 正式题库 CSV/XLSX 实际导入模板；
- 每日挑战 CSV/XLSX 实际导入模板及导入后配置说明；
- 游戏内容制作草稿（当前不可直接导入）；
- 可直接交给 AI 的课件、题库、挑战、游戏和审核提示词。
`);

await write("01_产品定位与业务边界.md", `# 产品定位与业务边界

## 产品定位

小程序是安全生产管理平台的员工移动端，以“必须完成的培训”为第一优先级，同时提供记录、消息、每日挑战、积分和现场高频管理操作。

## 正式闭环

微信登录与身份绑定 → 查看本人待办 → 学习课件 → 正式考试 → 补学/重考 → 本人签字 → 项目确认（仅项目入场教育）→ 本人记录。

## 不得改变的边界

- 只记录培训、考试、签字、证书和项目确认事实；
- 不显示或推导“可上岗、禁止上岗、准入有效、通行资格”；
- 三级教育只面向正式员工；项目入场教育面向项目内正式员工、外协人员和临时个人；
- 三级教育和项目入场教育必须考试；
- 每日挑战自愿参与，与正式培训任务、正式考试和完成状态分离；
- 当前没有积分商城、自动奖励或游戏准入规则；
- 普通人员只能访问本人数据，管理功能以服务端角色和范围为准。

## 用户类型

- 普通人员：学习、考试、签字、记录、挑战、个人资料申请；
- 项目管理员：授权项目的审核、催办、解锁、现场确认等高频操作；
- 组织负责人/管理员：在授权组织范围内处理人员和培训；
- 公司管理员：全公司范围配置与兜底处理。
`);

await write("02_信息架构与五Tab导航.md", `# V3.1 信息架构与五 Tab 导航

## 目标导航

1. **待办**：必须完成的培训任务、下一步动作、临期/逾期提醒。
2. **记录**：本人已完成/进行中的培训、考试成绩、签字和详情。
3. **闯关**：每日挑战、专题关卡、积分、排行榜；正式训练与趣味学习明确分区。
4. **消息**：系统通知、催办、审核结果、提醒。
5. **我的**：个人资料、证书与角色、资料与服务、账号安全、管理入口。

## 当前与 V3.1 的关系

当前代码仍为四 Tab：待办、我的记录、消息、我的；每日挑战和排行榜是普通页面。V3.1 把“闯关”提升为独立 Tab，属于后续导航改造目标。本参考包保留现有 18 个路由，并为规划中的闯关中心和游戏页面预留明确页面编号。

## 核心导航原则

- 首屏只回答“我现在要做什么”；
- 正式培训任务不可被积分、排行榜或小游戏抢占第一优先级；
- 管理入口只对服务端返回有管理权限的人显示；
- 二级页面使用微信原生返回，不重复底部 Tab；
- 固定操作区必须避开底部安全区，键盘弹起时表单按钮可见。
`);

await write("03_页面功能与状态说明.md", `# 页面功能与状态说明

| 编号 | 页面 | 核心内容 | 关键状态 |
|---|---|---|---|
| 01 | 待办 | 优先任务、其他任务、每日挑战入口 | 加载、空、失败、需补学、锁定、逾期 |
| 02 | 记录 | 培训记录筛选与列表 | 进行中、已完成、已取消 |
| 03 | 闯关中心 | 每日挑战、专题关卡、积分入口 | 未开始、进行中、今日完成 |
| 04 | 消息 | 催办、提醒、审核结果 | 未读、已读、空 |
| 05 | 我的 | 人员信息、积分、证书、服务、账号安全 | 资料缺失、管理角色、普通人员 |
| 06 | 微信登录 | 微信授权登录 | 未配置、处理中、失败 |
| 07 | 身份绑定 | 微信手机号优先匹配，未匹配再申请 | 唯一匹配、0匹配、冲突 |
| 08 | 审核状态 | 显示绑定申请状态和原因 | 待部门审核、升级公司、通过、驳回 |
| 09 | 注册申请 | 外协/临时个人资料申请 | 草稿、提交中、待审核 |
| 10 | 培训任务详情 | 课件、考试、签字、项目确认进度 | 各下一步、锁定、完成 |
| 11 | 结构化课件 | 分段学习、位置恢复、练习/情景 | 未作答、已作答、完成 |
| 12 | HTML课件 | 受控 web-view | 加载、过期、无权限 |
| 13 | 正式考试 | 倒计时、自动保存、恢复、交卷 | 答题、断网、已提交、超时 |
| 14 | 本人签字 | Canvas书写、清空、预览、提交 | 空白、有效、提交中、已签 |
| 15 | 培训记录详情 | 内容版本、考试、签字、确认 | 完整/缺失项说明 |
| 16 | 培训管理 | 未完成、审核、催办、解锁、确认 | 权限范围、空、失败 |
| 17 | 绑定审核详情 | 匹配、创建、归属修复、升级、驳回 | 冲突与越权阻断 |
| 18 | 资料变更申请 | 手机、照片、部门等申请 | 验证、待审、完成、驳回 |
| 19 | 每日挑战 | 每日5题、逐题反馈 | 未答、正确、错误、完成 |
| 20 | 排行榜 | 个人/部门排名 | 本人定位、并列、空 |
| 21 | 游戏专题 | 专题关卡地图 | **规划中** |
| 22 | 通用小游戏 | 找隐患、排序、情景选择 | **规划中** |
| 23 | 闯关结果 | 得分、错题、继续动作 | **规划中** |
| 24 | 积分明细与规则 | 积分来源和规则 | 部分已有，独立页规划中 |
| 25 | 个人资料详情 | 完整个人资料和变更入口 | 部分已有 |
| 26 | 证书与角色 | 本人证书、到期状态、当前角色 | 部分已有 |
| 27 | 账号安全与设备 | 登录方式、设备、退出 | 部分已有 |
`);

await write("04_组件与交互规范.md", `# 组件与交互规范

## 基础组件

- 顶部导航：标题居中，右侧保留微信胶囊安全区；
- 任务卡：标题、类型/项目、截止时间、状态、进度、唯一主按钮；
- 状态标签：语义颜色固定，禁止只靠颜色传达；
- 信息行：左标签、右值/动作，长文本换行；
- 选项卡：整行可点，最小高度 52px，选中后显示边框、背景和文本三重反馈；
- 底部操作区：最多一个主操作和一个次操作，避开安全区；
- 弹层：只用于确认高风险或不可逆动作，不用弹层承载长流程。

## 统一状态

- 加载：骨架或明确加载文案，不展示伪空状态；
- 空：说明为什么为空，并提供唯一可行下一步；
- 错误：说明问题与“重新加载”；
- 提交中：禁用重复提交，保留当前表单内容；
- 权限不足：明确当前没有权限，不隐藏成“暂无数据”；
- 断网恢复：考试和课件保留本地显示状态，但以服务端结果为准。

## 课件交互

- 一屏一项，明确上一项/下一项；
- 学习进度置顶但不遮挡正文；
- 练习和情景选择必须完成选择后才能继续；
- 选择后的解释、依据与下一步在同一视野内；
- 恢复学习应回到最后有效项，而不是重新开始。
`);

await write("05_培训内容制作规范.md", `# 培训内容制作规范

## 推荐结构

每门结构化课件由 3—8 个单元组成，每单元 3—7 个内容块。总时长以 10—25 分钟为宜。

内容块类型：知识要点、做/不做、步骤、检查点、情景选择、单元小结。正式考试题不能混在课件内容里提前泄露答案。

## 写作要求

- 每屏只表达一个关键意思；
- 标题说结论，正文说明原因、动作和后果；
- 使用真实岗位、任务和风险场景，避免空泛口号；
- 法律条文应注明名称与条款，不编造依据；
- 情景题三个选项都应可信，错误选项说明具体风险；
- 图片服务于识别危险或正确动作，不用装饰性人物堆叠；
- 不将“完成学习”表述为“取得上岗资格”。

## AI 输出验收

事实准确、语言简短、动作明确、敏感信息最小化、无准入结论、无提前泄露正式考试答案、可在手机窄屏阅读。
`);

await write("06_题库_挑战_游戏内容规范.md", `# 题库、每日挑战与游戏内容规范

## 正式题库

- 题型：单选、多选、判断；
- 正确答案写选项字母，如 A 或 A,B；
- 题干至少 2 个字符；
- 每题至少两个有效选项；
- 解析解释判断依据，不能只复述答案；
- 同一文件中“题型+题干”不得重复；
- 文件任一行错误会阻止整批写入。

## 每日挑战

当前挑战题复用正式题库：先用挑战模板导入题目，再在 Web 管理后台“题库与试卷 → 日常挑战”启用并设置分类、难度。模板中的挑战配置参考页不会被导入器读取。

建议：题干短、场景明确、单题 20—45 秒；避免直接复制正式考试整题；每道题提供一句可行动的解析。

## 游戏

当前系统没有游戏数据模型和导入接口。包内工作簿只用于提前制作内容，不可上传系统。游戏内容必须与正式培训完成、考试通过和准入状态解耦。

建议首批玩法：找隐患、步骤排序、情景选择。每关都要包含学习目标、素材、正确规则、错误反馈、依据和无障碍替代文本。
`);

await write("07_AI内容生产提示词.md", `# AI 内容生产总提示词

你正在为“安全生产教育培训小程序”制作长期可复用内容。请遵守：

1. 产品只记录培训事实和下一步动作，不生成可上岗/禁止上岗/准入结论。
2. 输出必须适合手机阅读，一屏一个知识点，标题先给结论。
3. 使用真实工作场景、明确动作和可验证依据，不编造法规、统计或事故。
4. 正式题库、每日挑战、游戏分别按各自模板输出，课件模板不能替代它们。
5. 若信息不足，列出需要业务人员确认的事实，不自行猜测。
6. 示例数据不得包含真实姓名、手机号、身份证号、签字或人员照片。
7. 输出后执行自检：事实、权限、敏感信息、题目唯一性、答案有效性、移动端长度。
`);

const routes = `# 08A 路由映射

## 当前真实路由（18个）

| V3.1编号 | 页面 | 当前路由 | 导航关系 |
|---|---|---|---|
| 01 | 待办 | pages/todo/index | 当前Tab，V3.1 Tab1 |
| 02 | 记录 | pages/records/index | 当前Tab，V3.1 Tab2 |
| 04 | 消息 | pages/messages/index | 当前Tab，V3.1 Tab4 |
| 05 | 我的 | pages/profile/index | 当前Tab，V3.1 Tab5 |
| 06 | 微信登录 | pages/login/index | 登录入口 |
| 07 | 身份绑定 | pages/bind/index | 登录后未绑定 |
| 08 | 审核状态 | pages/pending/index | 绑定/注册待审 |
| 09 | 注册申请 | pages/register/index | 外协/临时个人 |
| 10 | 培训任务详情 | pages/task/index | 待办进入 |
| 11 | 结构化课件 | pages/courseware/index | 任务课件进入 |
| 12 | HTML课件 | pages/html/index | 受控web-view |
| 13 | 正式考试 | pages/exam/index | 任务进入 |
| 14 | 本人签字 | pages/signature/index | 考试通过后 |
| 15 | 培训记录详情 | pages/record-detail/index | 记录进入 |
| 16/17 | 培训管理/审核 | pages/management/index | 我的-管理入口 |
| 18 | 资料变更申请 | pages/change-request/index | 我的进入 |
| 19 | 每日挑战 | pages/challenge/index | 当前普通页；V3.1闯关Tab内 |
| 20 | 排行榜 | pages/leaderboard/index | 挑战/我的进入 |

## V3.1新增或拆分目标（尚未全部开发）

| 编号 | 建议路由 | 状态 |
|---|---|---|
| 03 | pages/game-hub/index | 规划：五Tab第三项 |
| 21 | pages/game-series/index | 规划 |
| 22 | pages/game-play/index | 规划 |
| 23 | pages/game-result/index | 规划 |
| 24 | pages/points/index | 规划拆分 |
| 25 | pages/profile-detail/index | 规划拆分 |
| 26 | pages/certificates/index | 规划拆分 |
| 27 | pages/account-security/index | 规划拆分 |

新增路由前必须确认接口和业务状态，不得仅因参考图存在就创建假功能。`;
await write("08_路由映射_风格指南_设计参数_图片/08A_路由映射.md", routes);

await write("08_路由映射_风格指南_设计参数_图片/08B_浅色风格指南.md", `# 08B 浅色风格指南

## 视觉目标

专业、清晰、可信、适合工地与办公室强光环境。深绿代表安全与稳定；暖金只用于积分和成就；红色只用于错误、危险和逾期。V3.1 不提供深色主题。

## 页面结构

- 页面背景 #F6F8F7；内容侧边距 16px；
- 主要卡片白色，圆角 16px，优先使用边框，阴影仅作轻层级；
- 标题 24px/700，分区标题 20px/700，正文 16px/400，辅助文字 14px；
- 列表密度适中，小屏不出现横向滚动；
- 单个页面最多一个实心主按钮；危险操作使用红色文字或确认页。

## 图形与人物

人物插图统一红色长袖野外工作服，可带银色反光条；户外人物佩戴白色安全帽。真实用户照片按原鉴权方式展示。图标使用一致线性图标，不用 emoji 代替。

## 无障碍

- 普通文本对比度不低于 4.5:1；
- 可点击区域至少 44×44px；
- 状态同时使用文本/图形/颜色；
- 支持系统字体放大，长部门名、长课件名换行；
- 所有图片提供用途说明或替代文本。
`);

const params = {
  version: "3.1", theme: "light-only", viewport: { referenceWidth: 390, referenceHeight: 844, unit: "px/rpx adaptive" },
  colors: { primary: "#245D47", primaryStrong: "#174533", primarySoft: "#EEF5F1", background: "#F6F8F7", surface: "#FFFFFF", text: "#102A24", textSecondary: "#526760", border: "#DDE7E2", info: "#2F6FED", success: "#25845F", warning: "#B07D2B", danger: "#C83D3D", points: "#B07D2B" },
  typography: { fontFamily: "system-ui, PingFang SC, Microsoft YaHei, sans-serif", pageTitle: { size: 24, lineHeight: 32, weight: 700 }, sectionTitle: { size: 20, lineHeight: 28, weight: 700 }, body: { size: 16, lineHeight: 24, weight: 400 }, secondary: { size: 14, lineHeight: 21, weight: 400 }, caption: { size: 12, lineHeight: 18, weight: 500 } },
  spacing: { base: 8, pageX: 16, sectionY: 24, cardPadding: 16, compactGap: 8, normalGap: 12, largeGap: 20 },
  radius: { card: 16, control: 12, small: 8, pill: 999 },
  control: { minTouch: 44, buttonHeight: 48, inputHeight: 48, optionMinHeight: 52, tabBarHeight: 56 },
  elevation: { card: "0 8px 24px rgba(25, 66, 52, 0.08)", floating: "0 12px 32px rgba(25, 66, 52, 0.14)" },
  animation: { fast: 160, normal: 240, easing: "cubic-bezier(0.16, 1, 0.3, 1)", reduceMotion: true },
  rules: { darkTheme: false, onePrimaryActionPerView: true, noAdmissionConclusion: true, noEmojiIcons: true }
};
await write("08_路由映射_风格指南_设计参数_图片/08C_设计参数.json", JSON.stringify(params, null, 2));

const screens = [
  ["01","待办","现在先做","三级安全教育","完成 3/6 项 · 下一步：继续学习",["项目入场教育 · 待考试","年度培训 · 截止 10月30日"]],
  ["02","记录","我的培训记录","已完成 18 项","按类型、年度和状态筛选",["三级安全教育 · 92分 · 已签字","项目入场教育 · 已完成"]],
  ["03","闯关","安全闯关中心","今日挑战 0/5","正式培训优先完成；挑战自愿参与",["每日安全挑战","专题关卡（规划中）","积分与排行榜"]],
  ["04","消息","消息中心","2 条未读","催办、临期提醒与审核结果",["培训将在3天后截止","部门变更申请已通过"]],
  ["05","我的","个人中心","李明 · 工程测绘中心","正式员工 · 普通人员",["安全积分 268","证书与角色","资料与服务","账号安全"]],
  ["06","微信登录","安全生产管理平台","使用微信身份进入本人培训和安全事项","",["微信登录","隐私政策与用户协议"]],
  ["07","身份绑定","确认本人身份","优先获取微信手机号自动匹配","未匹配时再填写姓名并选择部门",["获取微信手机号","填写绑定申请"]],
  ["08","审核状态","身份确认处理中","待部门管理员审核","申请提交后可随时查看结果",["已验证手机号 138****0628","申请部门 工程测绘中心","当前状态 待部门审核"]],
  ["09","注册申请","提交人员注册申请","适用于外协人员和临时个人","不会自动获得管理权限",["姓名","人员类型","责任经营实体","提交申请"]],
  ["10","任务详情","三级安全教育","完成 3/6 项 · 截止 10月30日","全部必学内容完成后统一考试",["公司级通识 · 已完成","经营实体级教育 · 学习中","第三级教育 · 未开始","正式考试 · 未解锁","本人签字 · 待考试通过"]],
  ["11","学习课件","公司业务布局与主要安全风险","第 5/33 项 · 15%","同一家公司 多种工作现场",["情景选择","先确认任务、危险区域和联系人，再按安排进入","上一项    继续下一项"]],
  ["12","HTML课件","交互课件","受控页面 · 链接短时有效","完成后返回任务页确认学习",["正在加载课件…","重新加载","返回任务"]],
  ["13","正式考试","项目入场教育考试","剩余 18:42 · 第 3/20 题","答案自动保存，可恢复同一次考试",["单选题：进入现场前应先做什么？","A 接受交底并确认风险","B 直接进入作业区","保存并下一题"]],
  ["14","本人签字","确认培训记录并签字","正式提交后本人不能覆盖","请在签字区域内本人手写",["签字画布","清空","预览并提交"]],
  ["15","记录详情","三级安全教育记录","已完成 · 92分 · 已签字","记录引用下发时的课件版本",["学习内容 6项","考试历史 2次","本人签字 已提交","完成时间 2026-09-18"]],
  ["16","培训管理","授权范围内的培训管理","12 人未完成 · 2 人锁定","手机端仅处理高频现场操作",["待审核申请","未完成人员","催办","考试解锁","现场确认"]],
  ["17","绑定审核","人员身份确认与微信绑定","手机号已验证 · 匹配存在冲突","只能处理本人组织范围内申请",["绑定已有人员","修正手机号","新建普通员工","修复部门归属","升级公司处理","驳回申请"]],
  ["18","资料变更","资料与关系变更申请","手机号修改需完成真实性验证","部门调换需目标部门负责人审批",["修改手机号","更换照片","申请调换部门","查看申请记录"]],
  ["19","每日挑战","今日安全挑战","第 2/5 题 · 今日已得 2分","首次答对得2分，答错不扣分",["在临时用电现场发现破损电缆应如何处理？","立即停止使用并报告","用胶带简单包扎继续用","提交答案"]],
  ["20","排行榜","安全积分排名","本月 · 全公司","排名用于学习激励，不代表上岗资格",["1  王晓  146分","2  李明  128分（我）","3  张宁  122分","按部门查看"]],
  ["21","专题关卡","野外作业安全专题","0/6 关 · 规划中","按知识主题组织，不替代正式培训",["出发准备","交通与营地","现场作业","应急处置"]],
  ["22","安全小游戏","找出现场隐患","0/5 · 规划中","点击图片中的隐患并查看解释",["作业区示意图","提示：已发现 0 处","提交本关"]],
  ["23","闯关结果","本关完成","80分 · 获得 8 积分","错题可复习，积分不改变培训状态",["答对 4题","需要复习 1题","查看解析","继续下一关"]],
  ["24","积分明细","安全积分","累计 268 · 本月 128","积分来自每日挑战等自愿学习",["今日挑战 +6","连续学习 +0（未启用）","积分规则","查看排行榜"]],
  ["25","个人资料","本人资料","李明 · 正式员工","工程测绘中心",["手机号 138****0628","身份证 140***********2816","个人照片","申请修改资料"]],
  ["26","证书与角色","证书与授权","只展示事实和到期状态","不生成可上岗或禁止上岗结论",["人员证书 · 2027-06-30到期","部门管理员 · 工程测绘中心","项目管理员 · 北区勘察项目"]],
  ["27","账号安全","账号与设备","微信登录 · 2台有效设备","高风险操作会使现有会话失效",["修改手机号","有效设备","退出当前设备","退出全部设备"]]
];

const esc = (s) => String(s ?? "").replace(/[&<>\"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function htmlFor(screen) {
  const [no, nav, title, meta, desc, rows] = screen;
  const tab = ["待办","记录","闯关","消息","我的"];
  const rowHtml = rows.map((row, i) => `<div class="row ${i===0?'accent':''}"><span class="dot"></span><span>${esc(row)}</span><b>›</b></div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}html,body{margin:0;width:390px;height:844px;overflow:hidden;background:#F6F8F7;color:#102A24;font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif}body{padding-top:24px}.status{height:24px;padding:0 18px;display:flex;justify-content:space-between;font-size:12px;font-weight:650;color:#233831}.nav{height:58px;display:flex;align-items:center;justify-content:center;background:#fff;border-bottom:1px solid #E7EEEA;font-size:18px;font-weight:700;position:relative}.back{position:absolute;left:16px;font-size:26px}.capsule{position:absolute;right:12px;border:1px solid #DCE5E1;border-radius:22px;padding:7px 12px;font-size:14px;letter-spacing:2px}.env{position:absolute;right:16px;top:91px;background:#FFF7E9;color:#8C641D;border:1px solid #E9D2A6;border-radius:99px;padding:4px 8px;font-size:11px}.main{padding:20px 16px 96px}.hero h1{font-size:26px;line-height:1.25;margin:0 0 8px;letter-spacing:-.02em}.meta{font-size:16px;color:#526760;font-weight:650;line-height:1.45}.desc{font-size:14px;line-height:1.55;color:#667B73;margin-top:8px}.progress{height:7px;background:#E7EEEA;border-radius:9px;margin-top:16px;overflow:hidden}.progress:before{content:"";display:block;width:${18+(Number(no)%7)*9}%;height:100%;background:#245D47}.card{background:#fff;border:1px solid #E1E9E5;border-radius:16px;padding:8px 14px;margin-top:20px;box-shadow:0 8px 24px rgba(25,66,52,.07)}.row{min-height:58px;padding:14px 2px;display:grid;grid-template-columns:12px 1fr 18px;align-items:center;gap:10px;border-bottom:1px solid #E7EEEA;font-size:15px;line-height:1.4}.row:last-child{border-bottom:0}.row b{font-size:23px;color:#81928C}.dot{width:8px;height:8px;border-radius:50%;background:#B8C7C1}.row.accent .dot{background:#245D47}.callout{margin-top:18px;background:#EEF5F1;border-radius:14px;padding:14px;color:#245D47;font-size:13px;line-height:1.5}.primary{height:48px;margin-top:18px;background:#245D47;color:white;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700}.tabs{position:absolute;bottom:0;left:0;right:0;height:76px;background:#fff;border-top:1px solid #DDE7E2;display:flex;padding-bottom:12px}.tab{flex:1;text-align:center;padding-top:12px;font-size:12px;color:#667B73}.tab .ico{display:block;width:20px;height:20px;margin:0 auto 4px;border:2px solid currentColor;border-radius:6px}.tab.active{color:#245D47;font-weight:700}.num{position:absolute;left:16px;top:92px;color:#7A8E86;font-size:11px}.figure{width:72px;height:72px;border-radius:50%;background:linear-gradient(145deg,#DCEAE4,#A9C6BA);display:flex;align-items:center;justify-content:center;margin-bottom:16px;color:#245D47;font-weight:800}.helmet{width:42px;height:23px;background:#fff;border:2px solid #8CA199;border-radius:24px 24px 7px 7px}.workwear{width:46px;height:20px;background:#B63B3B;margin-top:-2px;border-radius:6px}.avatar{display:flex;flex-direction:column;align-items:center}
  </style></head><body><div class="status"><span>9:41</span><span>●●●  Wi‑Fi  ▰</span></div><div class="nav"><span class="back">‹</span>${esc(nav)}<span class="capsule">••• ◉</span></div><span class="num">V3.1 · ${no}</span><span class="env">浅色主题</span><main class="main"><div class="hero">${["05","25","26","27"].includes(no)?'<div class="figure"><div class="avatar"><span class="helmet"></span><span class="workwear"></span></div></div>':''}<h1>${esc(title)}</h1><div class="meta">${esc(meta)}</div><div class="desc">${esc(desc)}</div><div class="progress"></div></div><section class="card">${rowHtml}</section><div class="callout">所有内容读取真实接口数据；示例值仅用于视觉参考。正式权限和状态始终由服务端判断。</div><div class="primary">${["06","07","09","13","14","19","22"].includes(no)?'继续':'查看详情'}</div></main><nav class="tabs">${tab.map(t=>`<div class="tab ${t===nav||((no>'05')&&t==='我的')?'active':''}"><i class="ico"></i>${t}</div>`).join('')}</nav></body></html>`;
}

let browser;
try { browser = await chromium.launch({ headless: true }); }
catch { browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" }); }
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
for (const screen of screens) {
  const [no, name] = screen;
  await page.setContent(htmlFor(screen), { waitUntil: "load" });
  await page.screenshot({ path: path.join(imageDir, `${no}_${name}.png`) });
}
await browser.close();

await write("08_路由映射_风格指南_设计参数_图片/08D_图片索引.md", `# 08D 图片索引

本目录 images/ 共 27 张 390×844 逻辑像素、2倍导出的浅色主题参考图。它们用于说明信息层级、组件、间距和状态，不包含真实人员数据，也不代表规划功能已经开发。

${screens.map(([no,name])=>`- ${no}：${name} — images/${no}_${name}.png`).join("\n")}
`);

const headers = "题型,题干,选项A,选项B,选项C,选项D,正确答案,解析\r\n";
await fs.writeFile(path.join(templateDir, "正式题库_实际导入模板.csv"), "\uFEFF" + headers +
  "单选题,进入施工现场前应首先完成哪项工作,接受安全教育和现场交底,直接进入作业区,自行寻找作业面,先操作设备,A,进入现场前应先完成规定的安全教育和现场交底。\r\n"+
  "多选题,培训记录应如实包含哪些事实,学习完成情况,考试结果,本人签字,通行资格,\"A,B,C\",系统记录培训事实，不生成通行资格。\r\n"+
  "判断题,考试答案可以在开考前返回客户端,正确,错误,,,B,正确答案和评分规则不得提前返回客户端。\r\n", "utf8");
await fs.writeFile(path.join(templateDir, "每日挑战题_实际导入模板.csv"), "\uFEFF" + headers +
  "单选题,发现临时用电电缆破损时应如何处理,立即停止使用并报告,用胶带简单包扎继续使用,避开破损处继续使用,等下班后再处理,A,先隔离风险并报告，由有资质人员处理。\r\n"+
  "多选题,进入陌生作业现场前应确认哪些信息,任务范围,危险区域,现场联系人,个人排行榜,\"A,B,C\",确认任务、风险和联系人能减少误入危险区域。\r\n"+
  "判断题,每日挑战积分可以替代正式培训考试成绩,正确,错误,,,B,每日挑战与正式培训考试相互独立。\r\n", "utf8");

await write("09_实际导入模板/每日挑战题_导入后配置说明.md", `# 每日挑战题导入后配置说明

1. 在 Web 管理后台进入“题库与试卷”，创建或选择题库。
2. 使用“每日挑战题_实际导入模板.xlsx”或 CSV 导入。导入器读取第一个工作表，字段与正式题库完全一致。
3. 进入“题库与试卷 → 日常挑战”。
4. 勾选刚导入的题目，批量启用“用于日常挑战”。
5. 分别设置安全分类和难度（easy / medium / hard 对应简单 / 中等 / 困难）。

注意：工作簿中的“挑战配置参考”页用于内容制作和人工核对，当前导入器不会读取该页，也不会自动启用挑战题。
`);
await write("09_实际导入模板/游戏导入能力现状.md", `# 游戏导入能力现状

当前系统没有安全小游戏的数据表、管理页面、导入接口或运行时关卡解释器。因此“游戏内容制作草稿_不可直接导入.xlsx”不是系统导入模板，不能上传到后台。

它的用途是提前积累：关卡目标、题面、选项/热点/步骤、正确规则、反馈、法规依据和素材清单。待游戏模块正式设计后，应以最终接口字段生成新的“实际导入模板”，并保留从本草稿迁移的明确规则。
`);

const prompts = {
  "课件内容生成提示词.md": `# 课件内容生成提示词\n\n请按移动端结构化课件生成：3—8个单元，每单元3—7项；只使用知识要点、做/不做、步骤、检查点、情景选择、总结。每屏一个知识点，标题先给结论；情景选择提供影响与依据；不得生成准入结论或泄露正式考试答案。输出前列出需要人工确认的事实。`,
  "正式题库生成提示词.md": `# 正式题库生成提示词\n\n请严格按“正式题库_实际导入模板”的8列输出，不增删列。题型只能是单选题、多选题、判断题；答案用A或A,B；判断题A=正确、B=错误；同一文件题干不重复；解析说明依据和动作。先生成10题供人工审核，确认后再扩量。`,
  "每日挑战生成提示词.md": `# 每日挑战生成提示词\n\n请严格按“每日挑战题_实际导入模板”的8列输出。题目应在20—45秒内完成，场景具体、语言短、解析可行动；与正式考试保持独立，不使用积分推导培训完成或资格。另附人工配置清单：建议分类、难度，但不要把它们写进导入列。`,
  "小游戏内容生成提示词.md": `# 小游戏内容生成提示词\n\n请使用“游戏内容制作草稿_不可直接导入.xlsx”制作内容。先选择找隐患、步骤排序或情景选择之一；逐关填写学习目标、题面、正确规则、错误反馈、依据、素材和替代文本。当前文件不可直接导入系统，请勿声称已兼容后台。`,
  "内容审核提示词.md": `# 内容审核提示词\n\n请逐项审查：事实与法规来源、岗位适用性、危险动作是否可能被模仿、答案唯一性/完整性、解析是否可行动、是否包含个人敏感信息、是否出现可上岗/禁止上岗结论、手机阅读长度、模板列是否完全匹配。输出通过/需修改/阻断及具体原因。`
};
for (const [name, body] of Object.entries(prompts)) await fs.writeFile(path.join(promptDir, name), body + "\n", "utf8");

await write("11_交付验收清单.md", `# 交付验收清单

- [ ] 第08项包含路由映射、浅色风格指南、JSON设计参数和27张图片；
- [ ] 不存在深色主题图片或参数；
- [ ] 正式题库 CSV/XLSX 使用当前接口的8个准确表头；
- [ ] 每日挑战 CSV/XLSX 可通过正式题目导入器读取；
- [ ] 每日挑战说明明确需要后台启用、分类和难度配置；
- [ ] 游戏工作簿明确标注不可直接导入；
- [ ] 课件模板未冒充题库、挑战或游戏模板；
- [ ] 示例不含真实人员信息或秘密；
- [ ] 规划页面均标注“规划中”或“部分已有”；
- [ ] UI不产生可上岗、禁止上岗或准入结论。
`);

console.log(JSON.stringify({ root, screenshots: screens.length }, null, 2));
