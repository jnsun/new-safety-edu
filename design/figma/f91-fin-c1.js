//!include ./_kit-fin-c.js

/* 财务应收 · C 区：71 应收账款看板
 * 1440×900 真实尺寸，套 finShell。
 * 卡片名与栅格（w/h）取自 apps/admin/src/ReceivablesPage.tsx 与
 * defaultReceivablesDashboardPreference —— balance 12×3 / anomalies 8×6 / collection 4×6 …
 *
 * ⚠️ 看板的「模式」不是用户可切换的分段控件：财务异常处置台 / 催收工作台 / 应收账款总览
 * 三者由权限（canManageMoney / canMaintainCollection）自动决定，只显示当前那一个。
 */

await loadFonts();
await useFinPage();

const cleared = clearBoards(['▣ 71']);
const CW = FIN_CW;              // 1184

/* --------------------------- 局部构件 --------------------------- */
/** 卡片外壳：标题 + 右上角说明 + 内容。 */
function card(name, title, note, w, h) {
  const c = col('card', { gap: 14, w, h, fill: C.surface, radius: 14, stroke: C.line, sw: 1, padX: 20, padY: 18 });
  const hd = row('hd', { gap: 10, w: w - 40, cross: 'CENTER' });
  add(hd, text(title, { size: 14, weight: 600, color: C.ink }), null);
  add(hd, flex(), null);
  if (note) add(hd, text(note, { size: 11, weight: 400, color: C.muted }), null);
  add(c, hd, 'H');
  return c;
}

/** 异常条目行。 */
function anomalyRow(code, project, tagText, tagKind, value, w) {
  const r = row('ar', { gap: 10, w, cross: 'CENTER', h: 34 });
  add(r, text(code, { size: 12, weight: 500, color: C.ink, w: 96 }), null);
  add(r, text(project, { size: 12, weight: 400, color: C.inkSoft, w: 300 }), 'H');
  add(r, finTag(tagText, tagKind), null);
  add(r, flex(), null);
  add(r, text(value, { size: 12.5, weight: 600, color: C.ink, w: 84, align: 'RIGHT' }), null);
  return r;
}

/* ---------------------------- 画板 ---------------------------- */
function a71Dashboard() {
  const sh = finShell('71 · 应收账款看板', { active: 0, crumb: '应收账款看板' });
  const c = sh.content;

  // ---- 页头 ----
  add(c, finPageHead('应收账款看板',
    '按当前权限范围汇总；金额来自服务端，不是本地累加。',
    '当前模式：应收账款总览',
    [finBtn('刷新', 'secondary'), finBtn('导出条件', 'primary')]), 'H');

  // ---- 应收余额（12×3）----
  const k1 = card('balance', '应收余额（万元）', '决算 − 到账 − 核销', CW, 200);
  const kr = row('kr', { gap: 24, w: CW - 40, cross: 'MIN' });
  const kl = col('kl', { gap: 8, w: 380 });
  add(kl, text('12,400.00', { size: 40, weight: 700, color: C.ink }), 'H');
  const sub1 = row('s1', { gap: 10, w: 380, cross: 'CENTER' });
  add(sub1, finTag('较上月 +12.4%', 'warn'), null);
  add(sub1, text('1,284 条合同', { size: 12, weight: 400, color: C.muted }), null);
  add(kl, sub1, 'H');
  add(kr, kl, null);

  // 分隔线组：1px 线两侧各留白，靠 gap 撑开
  const sep1 = tintBar(C.line, 1, 0); sep1.resize(1, 104);
  add(kr, sep1, null);

  // 宽度必须凑准：1144 − 4×24(gap) − 380 − 1 = 667，否则整行溢出被裁
  const mw = CW - 40 - 380 - 1 - 96;
  const metrics = col('m', { gap: 14, w: mw });
  for (const [label, val, tone] of [['决算额（万元）', '12,400.00', C.ink], ['开票额（万元）', '10,880.00', C.ink], ['到账额（万元）', '8,260.40', C.brandText]]) {
    const r = row('mr', { gap: 12, w: mw, cross: 'CENTER', h: 30 });
    add(r, text(label, { size: 12, weight: 500, color: C.muted, w: 160 }), null);
    add(r, text(val, { size: 16, weight: 700, color: tone }), 'H');
    add(metrics, r, 'H');
  }
  add(kr, metrics, null);
  add(k1, kr, 'H');
  add(c, k1, 'H');

  // ---- 异常提醒（8×6） + 催收工作（4×6）----
  const row2 = row('row2', { gap: 16, w: CW, cross: 'MIN' });
  const w8 = 784;
  const w4 = CW - w8 - 16;      // 384

  const k2 = card('anomalies', '异常提醒', '三类中间状态，不是错误', w8, 372);
  const tagBar = row('tb', { gap: 8, w: w8 - 40, cross: 'CENTER' });
  add(tagBar, finTag('超收 6', 'warn'), null);
  add(tagBar, finTag('核销待调减 4', 'warn'), null);
  add(tagBar, finTag('决算未定 7', 'bad'), null);
  add(tagBar, flex(), null);
  add(tagBar, text('合计 17 笔', { size: 11.5, weight: 600, color: C.inkSoft }), null);
  add(k2, tagBar, 'H');

  const list = col('list', { gap: 0, w: w8 - 40 });
  for (const [code, proj, tg, kind, val] of [
    ['HT-2025-0117', '某矿区水文地质调查', '超收', 'warn', '94.80'],
    ['HT-2026-0033', '省道改线工程测量', '决算未定', 'bad', '0.00'],
    ['HT-2025-0041', '某园区管线探测', '超收', 'warn', '66.00'],
    ['HT-2025-0089', '工业园区基础测绘', '核销待调减', 'warn', '84.60'],
    ['HT-2025-0122', '水库除险加固监测', '决算未定', 'bad', '12.40'],
    ['HT-2025-0130', '城东片区地灾评估', '核销待调减', 'warn', '62.50'],
  ]) {
    add(list, anomalyRow(code, proj, tg, kind, val, w8 - 40), 'H');
    const ln = tintBar(C.line, w8 - 40, 0); ln.resize(w8 - 40, 1); add(list, ln, 'H');
  }
  add(k2, list, 'H');
  add(k2, text('「决算未定」「超收」「核销待调减」都是业务允许的中间状态，不是数据错误 —— '
    + '界面用橙/红标签引导核对，但不阻断任何操作。',
  { size: 10.5, color: C.muted, w: w8 - 40, lh: 1.5 }), 'H');
  add(row2, k2, null);

  const k3 = card('collection', '催收工作', '余额 TOP', w4, 372);
  const cl = col('cl', { gap: 14, w: w4 - 40 });
  for (const [name, amount, days] of [
    ['某市轨道交通集团', '3,120.00', 186],
    ['某矿业集团', '2,640.50', 152],
    ['省交通设计院', '1,880.00', 98],
    ['某工业园区管委会', '1,240.00', 64],
  ]) {
    const r = col('r', { gap: 4, w: w4 - 40 });
    const h1 = row('h', { gap: 8, w: w4 - 40, cross: 'CENTER' });
    add(h1, text(name, { size: 12, weight: 500, color: C.ink, w: w4 - 130 }), 'H');
    add(h1, flex(), null);
    add(h1, text(amount, { size: 12.5, weight: 700, color: C.ink }), null);
    add(r, h1, 'H');
    const h2 = row('h2', { gap: 8, w: w4 - 40, cross: 'CENTER' });
    add(h2, text('逾期 ' + days + ' 天', { size: 10.5, weight: 500, color: days > 150 ? C.danger : C.warningText }), null);
    add(h2, flex(), null);
    add(h2, text('清收责任人：张明', { size: 10.5, weight: 400, color: C.muted }), null);
    add(r, h2, 'H');
    add(cl, r, 'H');
  }
  add(k3, cl, 'H');
  add(k3, flex(), 'H');
  add(k3, finBtn('查看催收跟踪 TOP10', 'secondary', { h: 28, size: 12 }), 'H');
  add(row2, k3, null);
  add(c, row2, 'H');

  // ---- 底部：还有多少内容 ----
  const more = row('more', { gap: 12, w: CW, cross: 'CENTER', h: 56, fill: C.canvas, radius: 10, padX: 16 });
  add(more, text('↓', { size: 13, weight: 700, color: C.brandText }), null);
  add(more, text('继续向下滚动还有 9 张卡片：金额概览 · 台账数量 · 债权状态 · 单位分布 · 月度开票／回款趋势 · '
    + '财务归属部门应收余额 TOP8 · 客户应收余额 TOP10 · 客户属性构成 · 催收跟踪 TOP10。'
    + '　卡片栅格（w/h）是每人单独存的偏好，可拖拽调整，卡片间距固定 16px。',
  { size: 11.5, weight: 400, color: C.inkSoft, w: CW - 80, lh: 1.6 }), 'H');
  add(c, more, 'H');

  return sh.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const put = stackAt(2720, 900 + 240, 240);
put(a71Dashboard());

return {
  分区: '财务应收 · C 区 · 71 应收账款看板',
  画板数: 1,
  清理旧画板: cleared,
  尺寸: FIN_W + 'x' + FIN_H,
  本区结束Y: put.end(),
};
