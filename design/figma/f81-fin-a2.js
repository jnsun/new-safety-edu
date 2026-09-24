//!include ./_kit-fin.js

/* 财务应收 · A 区：52 字体与字阶
 * 依据 docs/design/财务应收视觉规范-v1.md §3.1 / §3.2
 * 字阶与 f70-fin-page.js 建出的 13 个 Fin/* 文本样式严格一一对应。 */

await loadFonts();
await useFinPage();

const W = 1120;
const CW = W - 88;              // 1032
const cleared = clearBoards(['▣ 52']);

/* ---------------------------------------------------------------------------
 * 字阶表数据
 * [样式名, 字号, 字重, 行高, Figma 实际落到的中文字重, 用途, 真实样例文案]
 * ⚠️ 最后一列必须用真实界面文案 —— 拿「示例文字」占位看不出实际换行效果。
 * ------------------------------------------------------------------------- */
/* ⚠️ 字重只能写 400 / 500 / 700 —— Noto Sans SC 没有真实的 SemiBold，
 * 「600」这种写法在 Figma 会落到 Medium，但在浏览器里会被解析成 Bold(700)，
 * 两边对不上。所以全表统一用 500 表示 Medium。 */
const SPECS = [
  ['Fin/Page Title', 20, 500, '1.40', 'Medium', '页面标题', '合同台账'],
  ['Fin/Page Desc', 13, 400, '1.50', 'Regular', '标题下的范围说明', '一行一合同；筛选、排序和分页均由服务端执行。'],
  ['Fin/Section', 15, 500, '1.45', 'Medium', '区块标题', '金额概览'],
  ['Fin/Card Title', 14, 500, '1.45', 'Medium', '卡片标题', '财务归属部门应收余额 TOP8'],
  ['Fin/Metric', 30, 700, '1.20', 'Bold', 'KPI 主数字', '1,284.60'],
  ['Fin/Metric Sub', 12, 400, '1.50', 'Regular', 'KPI 补充说明', '较上月 +12.4%'],
  ['Fin/Table Head', 12, 500, '1.35', 'Medium', '表头（允许换行）', '应收余额（万元）'],
  ['Fin/Table Cell', 13, 400, '1.55', 'Regular', '表格正文', '山西某场地勘察项目合同'],
  ['Fin/Table Cell Bold', 13, 500, '1.55', 'Medium', '关键金额列', '1,284.60'],
  ['Fin/Body', 14, 400, '1.60', 'Regular', '表单与页面正文', '上传附件后系统自动比对合同编号'],
  ['Fin/Label', 12, 500, '1.35', 'Medium', '表单标签', '债权状态'],
  ['Fin/Tag', 12, 500, '1.35', 'Medium', '状态标签', '决算未定'],
  ['Fin/Micro', 11, 400, '1.45', 'Regular', '修订号与元信息', '修订号 7 · 2026-09-22 14:03'],
];

const ROWH = 52;
const COLS = [
  ['样式名', 158, 'LEFT'],
  ['字号', 52, 'CENTER'],
  ['字重', 92, 'CENTER'],
  ['行高', 56, 'CENTER'],
  ['用途', 236, 'LEFT'],
  ['实时样例（按该档字号真实渲染）', 438, 'LEFT'],
];
const COLS_W = COLS.reduce((a, c) => a + c[1], 0);   // 必须等于 CW

/* --------------------------- 局部构件 --------------------------- */
/** 表格单元格：撑满列宽、内容垂直居中。 */
function td(colW, node, align, h) {
  const c = row('td', { w: colW, padX: 12, cross: 'CENTER', h: h != null ? h : ROWH });
  if (align === 'CENTER') { add(c, flex()); add(c, node); add(c, flex()); }
  else if (align === 'RIGHT') { add(c, flex()); add(c, node); }
  else add(c, node, 'H');
  return c;
}

/** 小尺寸字重胶囊。 */
function wChip(label) {
  return chip(label, { fill: C.surfaceSoft, color: C.inkSoft, stroke: C.line, size: 10.5, padX: 9, padY: 4, weight: 500 });
}

/** 一小列金额演示卡（对齐方式可切）。 */
function moneyDemo(title, align, tone) {
  const w = 236;
  const c = col('demo', { gap: 8, w, radius: 10, fill: C.surfaceSoft, padX: 14, padY: 12, stroke: C.line, sw: 1 });
  add(c, text(title, { size: 10.5, weight: 600, color: C.muted }), 'H');
  for (const v of ['1,284.60', '96.00', '12,400.00']) {
    add(c, text(v, { size: 13.5, weight: 500, color: tone, w: w - 28, align }), 'H');
  }
  return c;
}

/* ---------------------------- 画板 ---------------------------- */
function a52Type() {
  const b = board('52 · 字体与字阶',
    '中文与中英混排走 Noto Sans SC，纯数字与拉丁走 Inter —— 由脚本按字符集自动判定，不靠人肉指定。'
    + '下面 13 档字阶与 Figma 的 Fin/* 文本样式一一对应，样式名可直接开发对照。', W, null);

  /* ---- 1. 字体分工 ---- */
  add(b.body, sectionLabel('1 · 字体分工：谁渲染什么', { color: C.brand }), 'H');
  const pw = (CW - 24) / 2;
  const duo = row('duo', { gap: 24, w: CW, cross: 'MIN' });

  const p1 = finPanel({ w: pw, gap: 12, name: 'p-cjk' });
  add(p1, text('Noto Sans SC', { size: 15, weight: 700, color: C.ink }), 'H');
  add(p1, text('中文、中英混排、含标点的整句。只要字符串里出现一个中日韩字符，整串都走这个字体 —— '
    + '所以「合同编号 HT-2026-0041」会用中文字形渲染数字，这是刻意的。',
  { size: 11.5, color: C.muted, w: pw - 40, lh: 1.62 }), 'H');
  const fw1 = row('fw', { gap: 6, w: pw - 40, cross: 'CENTER', wrap: true, gapY: 6 });
  for (const s of ['Light', 'Regular', 'Medium', 'Bold', 'Black']) add(fw1, wChip(s), null);
  add(p1, fw1, 'H');
  add(p1, text('合同台账 · 应收账款看板', { size: 20, weight: 600, color: C.ink }), 'H');
  add(p1, text('决算未定不是错误，是业务允许的中间状态。', { size: 13, weight: 400, color: C.inkSoft, w: pw - 40, lh: 1.55 }), 'H');
  add(duo, p1);

  const p2 = finPanel({ w: pw, gap: 12, name: 'p-lat', fill: C.brandSoft, stroke: C.brandLine });
  add(p2, text('Inter', { size: 15, weight: 700, color: C.ink }), 'H');
  add(p2, text('纯数字、金额、编号、日期、百分比。表格里全是数字，等宽字形才能让上下行的位数对齐 —— '
    + '这是财务系统选 Inter 的唯一理由。', { size: 11.5, color: C.inkSoft, w: pw - 40, lh: 1.62 }), 'H');
  const fw2 = row('fw', { gap: 6, w: pw - 40, cross: 'CENTER', wrap: true, gapY: 6 });
  for (const s of ['Regular', 'Medium', 'Semi Bold', 'Bold', 'Extra Bold', 'Black']) add(fw2, wChip(s), null);
  add(p2, fw2, 'H');
  add(p2, text('1,284.60', { size: 30, weight: 700, color: C.brandText }), 'H');
  add(p2, text('2026-09-22  ·  +12.4%  ·  142px', { size: 13, weight: 400, color: C.inkSoft, w: pw - 40, lh: 1.55 }), 'H');
  add(duo, p2);
  add(b.body, duo, 'H');

  /* ---- 2. 字阶表 ---- */
  add(b.body, sectionLabel('2 · 13 档字阶（与 Fin/* 文本样式一一对应）', { color: C.brand }), 'H');
  const tbl = col('t', { gap: 0, w: COLS_W, radius: 12, stroke: C.line, sw: 1, clips: true, fill: C.surface });
  tbl.strokeAlign = 'OUTSIDE';

  const hd = row('thead', { w: COLS_W, gap: 0, h: 40, cross: 'CENTER', fill: C.surfaceSoft });
  for (const [title, cw, align] of COLS) {
    add(hd, td(cw, text(title, { size: 11.5, weight: 600, color: C.muted, w: cw - 24, align }), align, 40));
  }
  add(tbl, hd, 'H');

  SPECS.forEach((sp, i) => {
    const [name, size, weight, lh, styleName, use, sample] = sp;
    const tr = row('tr', { w: COLS_W, gap: 0, h: ROWH, cross: 'CENTER', fill: i % 2 ? C.surface : C.surfaceSoft });

    add(tr, td(COLS[0][1], text(name, { size: 11.5, weight: 600, color: C.ink, w: COLS[0][1] - 24 }), 'LEFT'));
    add(tr, td(COLS[1][1], text(String(size), { size: 12.5, weight: 500, color: C.ink }), 'CENTER'));

    const wtCol = col('wt', { gap: 1, cross: 'CENTER' });
    add(wtCol, text(String(weight), { size: 12, weight: 600, color: C.ink }), 'H');
    add(wtCol, text(styleName, { size: 9.5, weight: 400, color: C.muted }), 'H');
    add(tr, td(COLS[2][1], wtCol, 'CENTER'));

    add(tr, td(COLS[3][1], text(lh, { size: 12, weight: 400, color: C.muted }), 'CENTER'));
    add(tr, td(COLS[4][1], text(use, { size: 11.5, weight: 400, color: C.muted, w: COLS[4][1] - 24, lh: 1.5 }), 'LEFT'));
    add(tr, td(COLS[5][1], text(sample, {
      size, weight, color: weight >= 600 ? C.ink : C.inkSoft, w: COLS[5][1] - 24, lh: 1.4,
    }), 'LEFT'));

    add(tbl, tr, 'H');
    if (i < SPECS.length - 1) {
      const ln = tintBar(C.line, COLS_W, 0); ln.resize(COLS_W, 1); add(tbl, ln, 'H');
    }
  });
  add(b.body, tbl, 'H');

  /* ---- 3. 金额与数字 ---- */
  add(b.body, sectionLabel('3 · 金额与数字：三条不能破的规矩', { color: C.brand }), 'H');
  const amtRow = row('amt', { gap: 24, w: CW, cross: 'MIN' });

  const demoSide = col('demos', { gap: 12 });
  const dd = row('dd', { gap: 12, cross: 'MIN' });
  add(dd, moneyDemo('✗ 左对齐 —— 小数点参差', 'LEFT', C.warningText));
  add(dd, moneyDemo('✓ 右对齐 —— 末位与小数点对齐', 'RIGHT', C.ink));
  /* ⚠️ dd 不能给 'H'：demoSide 是 HUG 宽度，dd 一旦 FILL 就会反过来把它撑到 666px，
   * 右栏 rules 被顶出画板边界 158px（实测）。让 dd 保持 236+12+236 = 484，
   * demoSide 就取下面那段 508 宽说明文字的宽度，508 + 24 + 500 = 1032 刚好铺满。 */
  add(demoSide, dd, null);
  add(demoSide, text('列宽固定 142px。数字等宽（tabular-nums）＋ 右对齐，上下行的位数才会咬合；'
    + '少任何一条，22 列的表一眼扫过去就会读错行。',
  { size: 11.5, color: C.muted, w: 508, lh: 1.62 }), 'H');
  add(amtRow, demoSide);

  const rulePanel = finPanel({ w: CW - 532, gap: 11, name: 'rules' });
  const RULES = [
    ['单位只写「万元」', '不提供单位切换。切单位就要改列宽、改汇总口径，收益远小于风险。'],
    ['空值渲染 —', '没有数据就是「—」，绝不渲染成 0。0 和「没有」在财务上是两件事。'],
    ['千分位 + 固定两位小数', '12,400.00，不写 12400、不写 1.24万。'],
    ['负数用 − (U+2212)', '不用连字符 -，也不放进括号。回滚、核销调减会出现负数。'],
    ['启用 tabular-nums', 'CSS 侧 font-variant-numeric: tabular-nums，Figma 里由 Inter 天然等宽。'],
    ['金额与笔数并排', '金额 700 字重、笔数 muted 小一号，主次不能颠倒。'],
  ];
  RULES.forEach(([t, d], i) => {
    const r = row('r', { gap: 10, w: CW - 572, cross: 'MIN' });
    add(r, text((i + 1 < 10 ? '0' : '') + (i + 1), { size: 11, weight: 700, color: C.brandText, w: 18 }), null);
    const cc = col('c', { gap: 2 });
    add(cc, text(t, { size: 12.5, weight: 600, color: C.ink }), 'H');
    add(cc, text(d, { size: 11, weight: 400, color: C.muted, w: CW - 610, lh: 1.5 }), 'H');
    add(r, cc, 'H');
    add(rulePanel, r, 'H');
  });
  add(amtRow, rulePanel);
  add(b.body, amtRow, 'H');

  /* ---- 4. 中英混排与标点 ---- */
  add(b.body, sectionLabel('4 · 中英混排与标点：写死在规范里，避免各页各写一套', { color: C.brand }), 'H');
  const punct = row('punct', { gap: 24, w: CW, cross: 'MIN' });
  const ppw = (CW - 24) / 2;

  const okBox = finPanel({ w: ppw, gap: 10, name: 'ok' });
  add(okBox, finTag('这样写', 'ok'), 'H');
  for (const s of [
    '省略号用「…」，不用三个点 ...',
    '区间用「–」（en dash）：5–10 个工作日',
    '数字与单位之间不加空格：142px、20px、7 笔',
    '金额千分位用半角逗号：12,400.00',
    '字段名、路由、代码用半角 + 反引号：/receivables/ledger',
  ]) {
    const r = row('i', { gap: 8, cross: 'MIN', w: ppw - 40 });
    add(r, text('✓', { size: 11, weight: 700, color: C.success }), null);
    add(r, text(s, { size: 11.5, weight: 400, color: C.inkSoft, w: ppw - 62, lh: 1.55 }), 'H');
    add(okBox, r, 'H');
  }
  add(punct, okBox);

  const noBox = finPanel({ w: ppw, gap: 10, name: 'no' });
  add(noBox, finTag('别这样写', 'bad'), 'H');
  for (const s of [
    '半角句点结尾：「已结清.」',
    '区间用连字符：5-10 个工作日',
    '数字与单位之间塞空格：142 px',
    '金额写成 1.24万、12400、12400.0',
    '同一句里中英标点混用：应收余额(万元)，合计 8 笔.',
  ]) {
    const r = row('i', { gap: 8, cross: 'MIN', w: ppw - 40 });
    add(r, text('✗', { size: 11, weight: 700, color: C.danger }), null);
    add(r, text(s, { size: 11.5, weight: 400, color: C.inkSoft, w: ppw - 62, lh: 1.55 }), 'H');
    add(noBox, r, 'H');
  }
  add(punct, noBox);
  add(b.body, punct, 'H');

  add(b.body, finNote('Noto Sans SC 实际只有 Regular(400) / Medium(500) / Bold(700) 三档可用 —— 没有 SemiBold。'
    + '所以本表字重一律落在 400 / 500 / 700 上，13 档字阶与 Figma 的 Fin/* 文本样式完全一致。'
    + '⚠️ 开发不要写 font-weight: 600：浏览器在缺 600 时会向 Bold(700) 取近似，比设计稿重一档；'
    + '要 Medium 就明确写 500。', 'warn', CW), 'H');

  return b.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const Y0 = yAfter('▣ 51', 200);
const put = stackAt(0, Y0, 200);
put(a52Type());

return {
  分区: '财务应收 · A 区 · 52 字体与字阶',
  画板数: 1,
  清理旧画板: cleared,
  字阶档数: SPECS.length,
  字阶表列宽合计: COLS_W,
  画板宽: W,
  起点Y: Y0,
  本区结束Y: put.end(),
};
