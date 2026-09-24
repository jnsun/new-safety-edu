//!include ./_kit-fin.js

/* 财务应收 · B 区：61 大表格
 * 依据 docs/design/财务应收视觉规范-v1.md §5.2 / §5.3
 * 列名与列宽全部取自 apps/admin/src/ReceivablesLedger.tsx + receivables-types.ts 真实定义。 */

await loadFonts();
await useFinPage();

const W = 1120;
const CW = W - 88;              // 1032
const cleared = clearBoards(['▣ 61']);

/* ---------------------------------------------------------------------------
 * 表格片段用的 8 列。合计 1004 —— 刻意不凑满 1032：
 * 真实表格的 8 个金额列（决算/开票/到账/账内/账外/余额/核销）都是 142px，
 * 22 列合起来远宽于 1440，交付时靠横向滚动 + 冻结前两列。这里只截取一段。
 * ------------------------------------------------------------------------- */
const TB_W = 1004;
const COLS = [
  { title: '财务归属部门', w: 128, freeze: true, lines: 1 },
  { title: '合同编号', w: 112, freeze: true, lines: 1 },
  { title: '项目名称', w: 200, lines: 2 },
  { title: '单位', w: 88, lines: 1 },
  { title: '决算额', w: 142, align: 'RIGHT', lines: 1 },
  { title: '应收余额', w: 142, align: 'RIGHT', lines: 1 },
  { title: '债权状态', w: 88, lines: 1 },
  { title: '待核对事项', w: 104, lines: 1 },
];

const ROWS = [
  ['财务资产部', 'HT-2026-0041', '某市轨道交通勘察项目', '物化院', '386.20', '128.40', '待收', null],
  ['经营部', 'HT-2026-0038', '城东片区地灾评估', '六勘院', '152.00', '62.50', '部分到账', null],
  ['财务资产部', 'HT-2026-0033', '省道改线工程测量', '测绘院', null, '0.00', '待收', '决算未定'],
  ['地勘分院', 'HT-2025-0117', '某矿区水文地质调查', '禹地公司', '94.80', '94.80', '逾期', '超收'],
  ['经营部', 'HT-2025-0089', '工业园区基础测绘', '物化院', '210.40', '84.60', '待收', null],
  ['财务资产部', 'HT-2025-0076', '水库除险加固监测', '六勘院', '88.00', '12.40', '已结清', null],
  ['地勘分院', 'HT-2025-0052', '某园区管线探测（已作废）', '禹地公司', '66.00', null, '已作废', null],
];

/* --------------------------- 局部构件 --------------------------- */
function td(colW, node, align, h) {
  const c = row('td', { w: colW, padX: 14, cross: 'CENTER', h: h != null ? h : 40 });
  if (align === 'CENTER') { add(c, flex()); add(c, node); add(c, flex()); }
  else if (align === 'FIT') add(c, node);
  else add(c, node, 'H');
  return c;
}

/** 分页条（与表格同宽）。 */
function pager(w) {
  const r = row('pager', { gap: 8, w, cross: 'CENTER', h: 40 });
  add(r, text('共 128 条', { size: 12, weight: 400, color: C.muted }), null);
  add(r, flex(), null);
  add(r, text('每页', { size: 12, color: C.muted }), null);
  add(r, finChip('20 条', true, { h: 26, padX: 10, size: 11.5 }), null);
  add(r, box(8, 1));
  const nums = [['‹', false], ['1', true], ['2', false], ['3', false], ['…', false], ['13', false], ['›', false]];
  for (const [n, on] of nums) {
    const pg = row('pg', {
      w: n.length > 1 && n !== '‹' && n !== '›' ? 30 : 28, h: 28, radius: 8,
      cross: 'CENTER', main: 'CENTER',
      fill: on ? C.brandInk : null,
      stroke: on ? null : C.line,
      sw: on ? 0 : 1,
    });
    add(pg, text(n, { size: 12, weight: on ? 600 : 400, color: on ? C.white : (n === '…' ? C.muted : C.inkSoft) }));
    add(r, pg, null);
  }
  return r;
}

/** 行状态说明卡。 */
function stateCard(title, tag, note, w, mod) {
  const c = col('sc', { gap: 9, w, fill: C.surfaceSoft, radius: 10, stroke: C.line, sw: 1, padX: 14, padY: 12 });
  const head = row('h', { gap: 8, w: w - 28, cross: 'CENTER' });
  add(head, text(title, { size: 11.5, weight: 600, color: C.ink }), null);
  add(head, flex(), null);
  add(head, finTag(tag, mod.tagKind), null);
  add(c, head, 'H');
  // 迷你行：真实渲染出来的一行单元格
  const rowBox = row('rb', { w: w - 28, h: 36, cross: 'CENTER', fill: mod.rowFill || C.surface, radius: 6, stroke: C.line, sw: 1 });
  if (mod.leftBar) edgeLine(rowBox, 'LEFT', C.warning, 3);
  const cell = col('cell', { gap: 1, padX: 10 });
  const t1 = text(mod.c1, { size: 12, weight: 400, color: mod.dim ? C.muted : C.ink });
  if (mod.strike) t1.textDecoration = 'STRIKETHROUGH';
  add(cell, t1, 'H');
  add(cell, text(mod.c2, { size: 10, weight: 400, color: C.muted }), 'H');
  add(rowBox, cell, 'H');
  add(c, rowBox, 'H');
  add(c, text(note, { size: 10.5, weight: 400, color: C.muted, w: w - 28, lh: 1.5 }), 'H');
  return c;
}

/* ---------------------------- 画板 ---------------------------- */
function a61Table() {
  const b = board('61 · 大表格（一行一合同）',
    '这张表是整套系统最容易做坏的地方：22 列、8 个金额列、还有「决算未定」这类合法中间态。'
    + '下面这段是台账页的真实列宽与真实文案，不是示意。', W, null);

  /* ---- 1. 完整片段：工具栏 + 汇总条 + 表格 + 分页 ---- */
  add(b.body, sectionLabel('1 · 台账片段：工具栏 → 汇总条 → 表格 → 分页', { color: C.brand }), 'H');
  const box1 = col('slice', { gap: 12, w: CW });

  const tbar = row('tbar', { gap: 10, w: TB_W, cross: 'CENTER' });
  add(tbar, text('128', { size: 14, weight: 700, color: C.ink }), null);
  add(tbar, text('条记录（当前筛选范围）', { size: 12.5, color: C.muted }), null);
  add(tbar, flex(), null);
  add(tbar, text('项目、客户和催收内容最多显示 2 行', { size: 11.5, color: C.muted }), null);
  add(tbar, box(8, 1));
  add(tbar, text('金额单位：万元', { size: 11.5, weight: 600, color: C.inkSoft }), null);
  add(tbar, box(8, 1));
  add(tbar, finChip('紧凑列宽', false, { h: 28, padX: 11, size: 12 }), null);
  // 一律用 TB_W 宽 + 不加 'H'：加 'H' 会被 FILL 到容器宽（1032），
  // 表格右侧多出 28px 空白带，看上去像最后一列被拉宽了。
  add(box1, tbar);
  add(box1, finSummary([
    ['当前筛选范围', '128 条合同'],
    ['应收余额（万元）', '4,286.35'],
    ['到账金额（万元）', '3,914.02'],
    ['开票金额（万元）', '5,102.80'],
  ], '以上为服务端对完整筛选范围的汇总，不是当前页求和。', TB_W));
  add(box1, finTable(COLS, ROWS, { markRows: [2, 3], dimRows: [6] }));
  add(box1, pager(TB_W));
  add(b.body, box1, 'H');

  /* ---- 2. 四种行状态 ---- */
  add(b.body, sectionLabel('2 · 四种行状态：不靠斑马纹，靠一条线和一个色条', { color: C.brand }), 'H');
  const stRow = row('states', { gap: 16, w: CW, cross: 'MIN' });
  const sw = (CW - 48) / 4;
  add(stRow, stateCard('正常行', '默认', '行高 36，底部 1px 分隔线。不用斑马纹 —— 财务数字多，底色一换就读串行。',
    sw, { tagKind: 'mute', c1: 'HT-2026-0041', c2: '某市轨道交通勘察项目' }), null);
  add(stRow, stateCard('异常行', '超收 / 决算未定', '首列左侧 3px 橙条，悬停时保留。不给整行上底色 —— 一屏十几个异常会把表格变成橙色。',
    sw, { tagKind: 'warn', leftBar: true, c1: 'HT-2025-0117', c2: '某矿区水文地质调查 · 超收' }), null);
  add(stRow, stateCard('作废行', '已作废', '整行 neutral/soft 底 + muted 字 + 删除线。作废记录必须还在表里 —— 财务要能追溯。',
    sw, { tagKind: 'bad', dim: true, strike: true, rowFill: C.neutralSoft, c1: 'HT-2025-0052', c2: '某园区管线探测' }), null);
  add(stRow, stateCard('空值单元格', '—', '没有数据渲染成「—」，绝不渲染成 0。0 和「没有」在财务上是两件事。',
    sw, { tagKind: 'info', c1: '决算额    —', c2: '应收余额   0.00' }), null);
  add(b.body, stRow, 'H');

  /* ---- 3. 表格规格清单 ---- */
  add(b.body, sectionLabel('3 · 表格规格（14 条，违反即返工）', { color: C.brand }), 'H');
  const SPECS = [
    ['行高', '36px；紧凑模式 32px'],
    ['表头高', '40px，surface/soft 底，12px/500 muted，允许换行'],
    ['单元格内边距', '8px 12px'],
    ['冻结列', '前 2 列：财务归属部门、合同编号；右边界 1px line/strong + 3px 淡晕'],
    ['文本列', '单行省略；项目名称 / 客户名称 / 对方反馈 / 最新进展 / 下一步计划最多 2 行'],
    ['金额列', '右对齐，142px，千分位 + 固定两位小数'],
    ['日期列', 'YYYY-MM-DD，104px'],
    ['状态列', '色点 + 文字，88px'],
    ['异常行', '行首 3px warning 橙条，悬停时保留'],
    ['作废行', '整行 muted + 删除线，底色 neutral/soft'],
    ['斑马纹', '不用。用 1px line 横线分隔'],
    ['行悬停', 'surface/soft 底'],
    ['排序箭头', '只在当前排序列常显；未排序列悬停才出现 —— 22 列全带箭头会变成噪声场'],
    ['列宽偏好', '服务端存每人的列宽 / 顺序 / 可见性；金额列恒为 142，不随偏好收缩'],
  ];
  const st = col('t', { gap: 0, w: CW, radius: 12, stroke: C.line, sw: 1, clips: true, fill: C.surface });
  st.strokeAlign = 'OUTSIDE';
  const hd = row('thead', { w: CW, gap: 0, h: 38, cross: 'CENTER', fill: C.surfaceSoft });
  add(hd, td(150, text('项', { size: 11.5, weight: 600, color: C.muted, w: 122 }), 'LEFT', 38));
  add(hd, td(CW - 150, text('规格', { size: 11.5, weight: 600, color: C.muted, w: CW - 178 }), 'LEFT', 38));
  add(st, hd, 'H');
  SPECS.forEach(([k, v], i) => {
    const tr = row('tr', { w: CW, gap: 0, h: 34, cross: 'CENTER', fill: i % 2 ? C.surface : C.surfaceSoft });
    add(tr, td(150, text(k, { size: 12, weight: 600, color: C.ink, w: 122 }), 'LEFT', 34));
    add(tr, td(CW - 150, text(v, { size: 11.5, weight: 400, color: C.inkSoft, w: CW - 178, lh: 1.4 }), 'LEFT', 34));
    add(st, tr, 'H');
    if (i < SPECS.length - 1) { const ln = tintBar(C.line, CW, 0); ln.resize(CW, 1); add(st, ln, 'H'); }
  });
  add(b.body, st, 'H');

  add(b.body, finNote('代码里有一处待修：defaultReceivablesColumnWidths 把 7 个金额列写成 96px，'
    + '而 moneyColumn() 渲染时强制 142px —— 用户点「紧凑列宽」会看到金额列从 142 掉到 96，与默认状态不一致。'
    + '本规范以渲染值 142 为准，建议把偏好表里的金额列默认值也改成 142。', 'warn', CW), 'H');

  return b.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const Y0 = yAfter('▣ 60', 200);
const put = stackAt(1360, Y0, 200);
put(a61Table());

return {
  分区: '财务应收 · B 区 · 61 大表格',
  画板数: 1,
  清理旧画板: cleared,
  展示列数: COLS.length,
  表格片段宽: TB_W,
  规格条数: 14,
  起点Y: Y0,
  本区结束Y: put.end(),
};
