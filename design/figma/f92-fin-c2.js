//!include ./_kit-fin-c.js

/* 财务应收 · C 区：72 应收账款台账（本模块最大的一屏）
 * 1440×900 真实尺寸。列名、列宽、文案全部来自 ReceivablesLedger.tsx 真实定义：
 * 冻结前 2 列、8 个 142px 金额列、22 列合计远超一屏 —— 一屏只显示 9 列，其余横向滚动。 */

await loadFonts();
await useFinPage();

const cleared = clearBoards(['▣ 72']);
const CW = FIN_CW;              // 1184

/* 一屏能放下的 9 列 = 1164px（真实列宽，不做缩放） */
const COLS = [
  { title: '财务归属部门', w: 128, freeze: true, lines: 1 },
  { title: '合同编号', w: 112, freeze: true, lines: 1 },
  { title: '项目名称', w: 200, lines: 2 },
  { title: '客户名称', w: 160, lines: 2 },
  { title: '单位', w: 88, lines: 1 },
  { title: '决算额', w: 142, align: 'RIGHT', lines: 1 },
  { title: '应收余额', w: 142, align: 'RIGHT', lines: 1 },
  { title: '债权状态', w: 88, lines: 1 },
  { title: '待核对事项', w: 104, lines: 1 },
];
const TB_W = COLS.reduce((a, c) => a + c.w, 0);   // 1164

const ROWS = [
  ['财务资产部', 'HT-2026-0041', '某市轨道交通勘察项目', '某市轨道交通集团', '物化院', '386.20', '128.40', '待收', null],
  ['经营部', 'HT-2026-0038', '城东片区地灾评估', '某工业园区管委会', '六勘院', '152.00', '62.50', '部分到账', null],
  ['财务资产部', 'HT-2026-0033', '省道改线工程测量', '省交通设计院', '测绘院', null, '0.00', '待收', '决算未定'],
  ['地勘分院', 'HT-2025-0117', '某矿区水文地质调查', '某矿业集团', '禹地公司', '94.80', '94.80', '逾期', '超收'],
  ['经营部', 'HT-2025-0089', '工业园区基础测绘', '某工业园区管委会', '物化院', '210.40', '84.60', '待收', null],
  ['财务资产部', 'HT-2025-0076', '水库除险加固监测', '省水利勘测设计院', '六勘院', '88.00', '12.40', '已结清', null],
  ['地勘分院', 'HT-2025-0052', '某园区管线探测（已作废）', '某市政集团', '禹地公司', '66.00', null, '已作废', null],
];

/* ---------------------------- 画板 ---------------------------- */
function a72Ledger() {
  const sh = finShell('72 · 应收账款台账', {
    active: 1,
    crumb: '应收账款台账',
    searchPlaceholder: '搜索合同 / 项目 / 客户',
  });
  const c = sh.content;

  add(c, finPageHead('合同台账',
    '一行一合同；筛选、排序和分页均由服务端执行。',
    '默认显示未结合同 · 本页 9 / 22 列，其余横向滚动',
    [finBtn('导出条件', 'secondary'), finBtn('新建台账', 'primary')]), 'H');

  add(c, finLedgerFilters(CW), 'H');
  // 工具栏 / 汇总条 / 表格 / 分页统一用 TB_W（1164）并**不加 'H'**：
  // 加 'H' 会被 FILL 到容器宽 1184，表格右侧多出一段 20px 空白带，
  // 看起来像最后一列被拉宽了（探针实测：th 行宽 1184、列宽合计 1164）。
  add(c, finLedgerToolbar(TB_W, 128));
  add(c, finSummary([
    ['当前筛选范围', '128 条合同'],
    ['应收余额（万元）', '4,286.35'],
    ['到账金额（万元）', '3,914.02'],
    ['开票金额（万元）', '5,102.80'],
  ], '以上为服务端对完整筛选范围的汇总，不是当前页求和。', TB_W));
  // markRows：第 3、4 行是「决算未定 / 超收」；dimRows：第 7 行已作废
  add(c, finTable(COLS, ROWS, { markRows: [2, 3], dimRows: [6] }));
  add(c, finPager(TB_W, 128));

  return sh.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const put = stackAt(2720, yAfter('▣ 71', 240), 240);
put(a72Ledger());

return {
  分区: '财务应收 · C 区 · 72 应收账款台账',
  画板数: 1,
  清理旧画板: cleared,
  尺寸: FIN_W + 'x' + FIN_H,
  一屏列数: COLS.length,
  表格宽: TB_W,
  本区结束Y: put.end(),
};
