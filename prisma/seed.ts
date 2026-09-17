import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { receivableSettingBinding, selectFinanceOrganizationId } from "./receivables-defaults.js";

const prisma = new PrismaClient();

const receivableDepartments = [
  ["地调所", "D001"], ["地勘分院", "D002"], ["岩土所", "D003"], ["地灾所", "D004"], ["实验室", "D005"],
  ["禹地公司", "D006"], ["资环所", "D007"], ["测绘院太原分院", "D008"], ["大地测绘中心", "D009"], ["工程测绘中心", "D010"],
  ["遥感中心", "D011"], ["大数据中心", "D012"], ["测绘咨询中心", "D013"], ["晋城分院", "D014"], ["能源所", "D015"],
  ["地震物探", "D016"], ["工程物探所", "D017"], ["综合研究所", "D018"], ["广州分院", "D019"], ["电磁所", "D020"],
  ["碳中和", "D021"], ["矿产咨询", "D022"], ["六勘院太原分院", "D023"], ["一测", "D024"], ["二测", "D025"],
  ["综勘三", "D026"], ["原物探/太原", "D027"], ["翟悟飞", "D028"], ["孙勇军", "D029"], ["其他", "D030"],
] as const;

const receivableDictionary = {
  project_status: ["完工", "施工中", "中止", "取消或作废"],
  final_method: ["合同金额", "工作量"],
  debt_status: ["正常", "逾期", "诉讼", "和解"],
  client_attr: ["内部单位", "政府部门--省", "政府部门--市", "政府部门--县", "政府部门--县以下", "煤矿集团--晋能控股", "煤矿集团--山西焦煤", "煤矿集团--潞安化工", "煤矿集团--华阳新材", "煤矿集团--华新燃气", "煤矿集团--其他煤矿", "社会客户-省内", "社会客户-省外", "社会客户-海外", "其他"],
  unit: ["山西省地球物理化学勘查院有限公司", "山西省第六地质工程勘察院有限公司", "山西省地质测绘院有限公司", "山西禹地基础工程有限公司"],
  work_nature: ["二、三维地震", "宅基地", "农经权", "房地一体", "其他测绘", "工民建勘察", "报告编写、设计方案", "政府性灾害勘察", "地灾评估、勘察、设计", "市场地质", "价款项目", "综合物探", "基础施工", "灾害施工", "生态修复", "化验、基础检测", "土工试验", "其他"],
  sector: ["能源资源勘查开发", "生态保护修复", "地质灾害治理", "工程勘察与施工", "地质延伸产业", "实验测试", "测绘地理信息", "海外勘查贸易"],
  comm_method: ["电话", "上门拜访", "邮件", "微信", "函件+电话", "函件+微信"],
  feedback: ["承认欠款，但资金紧张", "拒接电话", "对质量提出异议", "正在筹款，近期付", "工程量结算有争议", "承认欠款，要求分期"],
  progress_note: ["已发送第二次催款函", "停工", "需协商", "已安排对账", "对方提出分期", "移交法务部"],
  next_plan: ["升级催收手段", "需实地调查", "需核实情况", "跟踪付款进度", "申请财产保全", "提供分期计划"],
  attach_category: ["决算", "中止证明", "其他"],
} as const;

async function seedReceivables() {
  const financeOrganizations = await prisma.organization.findMany({
    where: { name: "财务资产部", type: "department" },
    select: { id: true },
  });
  const financeOrganizationId = selectFinanceOrganizationId(financeOrganizations);
  const currentSetting = await prisma.receivableSetting.findUnique({ where: { id: 1 }, select: { financeOrganizationId: true } });
  const settingBinding = receivableSettingBinding(currentSetting?.financeOrganizationId, financeOrganizationId);
  const dictionaryRows = Object.entries(receivableDictionary).flatMap(([category, values]) =>
    values.map((value, index) => ({ category, value, sortOrder: index + 1 })),
  );

  await prisma.$transaction([
    prisma.receivableSetting.upsert({
      where: { id: 1 },
      create: { id: 1, financeOrganizationId },
      update: settingBinding,
    }),
    ...receivableDepartments.map(([name, code], index) => prisma.receivableDepartment.upsert({
      where: { name },
      update: {},
      create: { name, code, sortOrder: index + 1 },
    })),
    ...dictionaryRows.map(({ category, value, sortOrder }) => prisma.receivableDictionaryOption.upsert({
      where: { category_value: { category, value } },
      update: {},
      create: { category, value, sortOrder },
    })),
  ]);

  const [departmentCount, dictionaryOptionCount] = await Promise.all([
    prisma.receivableDepartment.count(),
    prisma.receivableDictionaryOption.count(),
  ]);
  console.log(`应收账款初始配置：部门 ${departmentCount}，字典 ${dictionaryOptionCount}`);
}

async function bootstrapAdmin() {
  const rawUsername = process.env.ADMIN_BOOTSTRAP_USERNAME;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!rawUsername && !password) return;

  const username = rawUsername?.trim().toLowerCase();
  if (!username || !password || password.length < 12) {
    throw new Error("请同时设置 ADMIN_BOOTSTRAP_USERNAME 和至少 12 位的 ADMIN_BOOTSTRAP_PASSWORD");
  }

  if (!/^[a-z0-9._-]{4,40}$/.test(username) || /^\d{17}[\dx]$/.test(username)) throw new Error("管理员用户名格式无效");
  const existing = await prisma.account.findUnique({ where: { usernameNormalized: username } });
  if (existing) throw new Error("管理员用户名已存在，bootstrap 未重复执行");
  const account = await prisma.account.create({
    data: { username, usernameNormalized: username, passwordHash: await argon2.hash(password), passwordLoginEnabled: true, mustChangePassword: true, roles: { create: { role: "company_admin", scopeType: "company" } } },
    select: { id: true, username: true }
  });
  console.log(`首个 company_admin 已创建：${account.username} (${account.id})`);
  console.log("请立即删除 ADMIN_BOOTSTRAP_PASSWORD 环境变量，并在首次登录后改密。");
}

async function main() {
  await bootstrapAdmin();
  await seedReceivables();
}

main().finally(() => prisma.$disconnect());
