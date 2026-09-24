//!include ./_kit-fin.js

/* 财务应收 · A 区：54 数据可视化与图表
 * 依据 docs/design/财务应收视觉规范-v1.md §5 —— 数据展示规范。
 * 这一块只讲「怎么把数字摆对」，组件本身在 B 区。 */

await loadFonts();
await useFinPage();

const W = 1120;
const CW = W - 88;              // 1032
const cleared = clearBoards(['▣ 54']);

/* --------------------------- 局部构件 --------------------------- */
/** 表格单元格。align：LEFT（文本填满换行）/ CENTER / FIT（右对齐小件、标签，不拉伸）。
 *  ⚠️ 标签与状态点必须用 FIT —— 用 LEFT 的 'H' 会把标签横向拉满整列，变成一条大色带。 */
function td(colW, node, align, h) {
  const c = row('td', { w: colW, padX: 12, cross: 'CENTER', h: h != null ? h : 44 });
  if (align === 'CENTER') { add(c, flex()); add(c, node); add(c, flex()); }
  else if (align === 'FIT') add(c, node);
  else add(c, node, 'H');
  return c;
}

/** 图表配色条目：色块 + 名称 + 用途。 */
function colorRow(color, name, use, w) {
  const r = row('cr', { gap: 10, w, cross: 'CENTER' });
  add(r, frame('sw', { w: 14, h: 14, radius: 4, fill: color }), null);
  add(r, text(name, { size: 11.5, weight: 600, color: C.ink, w: 84 }), null);
  add(r, text(use, { size: 10.5, weight: 400, color: C.muted }), 'H');
  return r;
}

/** 图例一行：色点 + 名称 + 百分比。 */
function legendRow(color, name, pct, w) {
  const r = row('lg', { gap: 7, w, cross: 'CENTER' });
  add(r, dot(color, 8));
  add(r, text(name, { size: 11, weight: 500, color: C.inkSoft, w: 74 }), null);
  add(r, flex(), null);
  add(r, text(pct, { size: 11, weight: 600, color: C.ink }), null);
  return r;
}

/* ---------------------------- 画板 ---------------------------- */
function a54Data() {
  const b = board('54 · 数据可视化与图表',
    '财务界面的图表只有一件事要做对：让人一眼看清「钱在哪、差多少」。'
    + '所以这一块没有装饰性图表 —— 没有渐变填充、没有阴影柱、没有 3D 饼图。', W, null);

  /* ---- 1. KPI 卡 ---- */
  add(b.body, sectionLabel('1 · KPI 卡：数字是主角，标签是配角', { color: C.brand }), 'H');
  const kpiRow = row('kpis', { gap: 16, w: CW, cross: 'MIN' });
  const KPI = [
    ['应收余额（万元）', '12,400.00', '较上月 +12.4%', 'brand'],
    ['到账金额（万元）', '8,260.40', '覆盖率 66.6%', 'ok'],
    ['异常提醒（笔）', '17', '超收 6 · 待调减 4 · 未定 7', 'warn'],
    ['台账数量（条合同）', '1,284', '未结 906 · 已结清 378', 'dark'],
  ];
  /* 高度交给 finKpi 自己 HUG —— 别在这里写死常量。
   * 曾经写 h: 96，结果带副行的卡内容高 83px 而卡内可用只有 56px，
   * 副行直接掉到深色卡外面（浅绿字落在白底上，截图放大才看得见）。 */
  for (const [l, v, s, t] of KPI) add(kpiRow, finKpi(l, v, s, t, { w: 246 }), null);
  add(b.body, kpiRow, 'H');
  add(b.body, text('四张卡的取色即语义：常规用青绿文字版、达标用 success、异常用 warning 文字版；'
    + '只有需要「压住整屏」的那张（台账数量）才用深墨绿底 + 黄绿数字 —— 一屏最多一张。',
  { size: 10.5, color: C.muted, w: CW, lh: 1.55 }), 'H');

  /* ---- 2. 汇总条 ---- */
  add(b.body, sectionLabel('2 · 汇总条：一行看清「这堆数字是哪来的」', { color: C.brand }), 'H');
  add(b.body, finSummary([
    ['当前筛选范围', '1,284 条合同'],
    ['应收余额（万元）', '12,400.00'],
    ['到账金额（万元）', '8,260.40'],
    ['开票金额（万元）', '10,880.00'],
  ], '以上为服务端对完整筛选范围的汇总，不是当前页求和。', CW), 'H');
  add(b.body, text('合同数用黄绿（全站唯一允许黄绿当数字色的地方，因为底色是深墨绿），其余金额用白。'
    + '第一项刻意不叫「合计」而叫「当前筛选范围」—— 这句话是从台账代码里原样搬来的，'
    + '分页与筛选都是服务端做的，标错这个口径财务会算错账。',
  { size: 10.5, color: C.muted, w: CW, lh: 1.55 }), 'H');

  /* ---- 3. 水平条 + 环形 ---- */
  add(b.body, sectionLabel('3 · 分布：水平余额条 · 环形占比', { color: C.brand }), 'H');
  const twoCol = row('two', { gap: 24, w: CW, cross: 'MIN' });
  const lw = 560;
  const rw = CW - lw - 24;      // 448

  const lp = finPanel({ w: lw, gap: 14, name: 'bars' });
  add(lp, text('单位分布 · 应收余额（万元）', { size: 13, weight: 600, color: C.ink }), 'H');
  for (const [l, p, a, n] of [
    ['物化院', 0.86, '4,120.00', 412],
    ['六勘院', 0.61, '2,940.00', 298],
    ['测绘院', 0.42, '2,010.00', 231],
    ['禹地公司', 0.29, '1,380.00', 143],
  ]) add(lp, finBarRow(l, p, a, n, { w: lw - 40 }), 'H');
  add(lp, text('条高 6px（不是 4 也不是 8），并强制最小宽度 2% —— 极小值若按真实比例画会变成一条看不见的线。'
    + '金额右对齐、笔数用 muted 小一号，主次不颠倒。',
  { size: 10.5, color: C.muted, w: lw - 40, lh: 1.55 }), 'H');
  add(twoCol, lp);

  const rp = finPanel({ w: rw, gap: 14, name: 'donut' });
  add(rp, text('客户属性构成', { size: 13, weight: 600, color: C.ink }), 'H');
  const dr = row('dr', { gap: 18, w: rw - 40, cross: 'CENTER' });
  add(dr, finDonut(148, [
    ['国有企业', 0.42, C.brand],
    ['民营企业', 0.31, C.info],
    ['事业单位', 0.18, C.warning],
    ['其他', 0.09, C.neutral],
  ], { center: [['1,284', 22, 700, C.ink], ['条合同', 10, 400, C.muted]] }), null);
  const lg = col('lg', { gap: 9, w: rw - 40 - 166 });
  for (const [n, p, cl] of [['国有企业', '42.0%', C.brand], ['民营企业', '31.0%', C.info],
    ['事业单位', '18.0%', C.warning], ['其他', '9.0%', C.neutral]]) {
    add(lg, legendRow(cl, n, p, rw - 40 - 166), 'H');
  }
  add(dr, lg, 'H');
  add(rp, dr, 'H');
  add(rp, text('中心永远写合计与单位，不写「占比」。分段之间留 1.2° 缝（脚本已内建）。',
    { size: 10.5, color: C.muted, w: rw - 40, lh: 1.5 }), 'H');
  add(twoCol, rp);
  add(b.body, twoCol, 'H');

  /* ---- 4. 双柱趋势 ---- */
  add(b.body, sectionLabel('4 · 趋势：月度开票 / 回款双柱', { color: C.brand }), 'H');
  const chRow = row('charts', { gap: 24, w: CW, cross: 'MIN' });
  const cp = finPanel({ w: 620, gap: 12, name: 'cols' });
  add(cp, text('月度开票 / 回款趋势（万元）', { size: 13, weight: 600, color: C.ink }), 'H');
  add(cp, finColumns([
    ['04', 1860, 1420], ['05', 2140, 1680], ['06', 1720, 1510],
    ['07', 2380, 1990], ['08', 2010, 1760], ['09', 1460, 1180],
  ], { w: 580, h: 176 }), 'H');
  add(cp, text('月标签只显示 MM（代码里就是 month.slice(5)）。柱顶不做数据标签 —— 12 个月挤在一起会糊；'
    + '要看数值去台账，图表只负责趋势。', { size: 10.5, color: C.muted, w: 580, lh: 1.5 }), 'H');
  add(chRow, cp);

  const crp = finPanel({ w: CW - 644, gap: 11, name: 'colorrules' });
  add(crp, text('图表配色：只有这 4 个色', { size: 12.5, weight: 600, color: C.ink }), 'H');
  for (const [cl, n, u] of [
    [C.brand, 'brand 青绿', '主序列：开票、余额、主要分布'],
    [C.info, 'info 蓝', '次序列：回款、对比项'],
    [C.warning, 'warning 橙', '异常序列：超收、逾期、决算未定'],
    [C.neutral, 'neutral 灰', '其他 / 历史值 / 停用'],
  ]) add(crp, colorRow(cl, n, u, CW - 684), 'H');

  const banRow = row('ban', { gap: 10, w: CW - 684, cross: 'CENTER', fill: C.warningSoft, radius: 8, padX: 10, padY: 8 });
  add(banRow, text('✗', { size: 12, weight: 700, color: C.warningText }), null);
  add(banRow, text('accent 黄绿不进图表序列', { size: 11, weight: 600, color: C.warningText }), null);
  add(crp, banRow, 'H');
  add(crp, text('黄绿对白底只有 1.42:1，远低于 WCAG 对图形要求的 3:1 —— 画在浅色图表里等于没画。'
    + '它只出现在深色底上（侧栏选中态、汇总条主数字）。',
  { size: 10.5, color: C.muted, w: CW - 684, lh: 1.5 }), 'H');
  add(chRow, crp);
  add(b.body, chRow, 'H');

  /* ---- 5. 状态表达 ---- */
  add(b.body, sectionLabel('5 · 状态：色点 + 文字，绝不靠颜色单打', { color: C.brand }), 'H');
  const cols = [
    ['语义', 150, 'LEFT'],
    ['色点 + 文字（表格内）', 210, 'LEFT'],
    ['浅底标签（卡片 / 摘要）', 240, 'LEFT'],
    ['典型场景', 432, 'LEFT'],
  ];
  const st = col('t', { gap: 0, w: CW, radius: 12, stroke: C.line, sw: 1, clips: true, fill: C.surface });
  st.strokeAlign = 'OUTSIDE';
  const shd = row('thead', { w: CW, gap: 0, h: 38, cross: 'CENTER', fill: C.surfaceSoft });
  for (const [t, cw, al] of cols) add(shd, td(cw, text(t, { size: 11.5, weight: 600, color: C.muted, w: cw - 24, align: al }), al, 38));
  add(st, shd, 'H');
  const ROWS = [
    ['正常 / 完成', ['已结清', 'ok'], ['已结清', 'ok'], '结清状态列、导入批次「已应用」'],
    ['预警 / 待处理', ['超收', 'warn'], ['决算未定', 'warn'], '异常提醒、债权状态、核销待调减'],
    ['危险 / 撤销', ['已作废', 'bad'], ['已回滚', 'bad'], '记录状态列、导入回滚'],
    ['信息 / 中性提示', ['处理中', 'info'], ['已提交', 'info'], '导入向导阶段、待核对'],
    ['停用 / 历史', ['历史值', 'mute'], ['停用', 'mute'], '业务字典停用项、修订历史'],
  ];
  ROWS.forEach((r, i) => {
    const tr = row('tr', { w: CW, gap: 0, h: 44, cross: 'CENTER', fill: i % 2 ? C.surface : C.surfaceSoft });
    add(tr, td(cols[0][1], text(r[0], { size: 12, weight: 500, color: C.inkSoft, w: cols[0][1] - 24 }), 'LEFT'));
    add(tr, td(cols[1][1], statusDot(r[1][0], r[1][1]), 'FIT'));
    add(tr, td(cols[2][1], finTag(r[2][0], r[2][1]), 'FIT'));
    add(tr, td(cols[3][1], text(r[3], { size: 11, weight: 400, color: C.muted, w: cols[3][1] - 24, lh: 1.45 }), 'LEFT'));
    add(st, tr, 'H');
    if (i < ROWS.length - 1) { const ln = tintBar(C.line, CW, 0); ln.resize(CW, 1); add(st, ln, 'H'); }
  });
  add(b.body, st, 'H');

  add(b.body, finNote('WCAG 1.4.1：不许只用颜色传达信息。所有状态一律「色点 + 文字」双轨，'
    + '色弱用户与黑白打印都能读。异常行另外用首列左侧 3px 橙条标记 —— '
    + '注意是给首列描左边，不是往行里插色块（插色块会把该行单元格整体右推 3px，与表头错位）。', 'warn', CW), 'H');

  return b.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const Y0 = yAfter('▣ 53', 200);
const put = stackAt(0, Y0, 200);
put(a54Data());

return {
  分区: '财务应收 · A 区 · 54 数据可视化与图表',
  画板数: 1,
  清理旧画板: cleared,
  KPI卡数: 4,
  起点Y: Y0,
  本区结束Y: put.end(),
  本区高度: put.end() - Y0 - 200,
};
