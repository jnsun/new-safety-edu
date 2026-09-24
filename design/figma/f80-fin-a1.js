//!include ./_kit-fin.js

/* 财务应收 · A 区：51 色源与令牌色卡
 * 色源数据来自对 公司logo.PNG 的逐半径扫描与纯色像素计数实测（非目测）。
 * 依据 docs/design/财务应收视觉规范-v1.md §2.1 / §2.2 */

await loadFonts();
await useFinPage();

const W = 1120;
const CW = W - 88;              // 内容宽 1032
const cleared = clearBoards(['▣ 51']);

/* --------------------------- 局部构件 --------------------------- */
function swatch(name, hex, cssVar, note, w) {
  const c = col('sw', { gap: 6, w });
  add(c, frame('chip', { w, h: 56, radius: 10, fill: hex, stroke: C.line, sw: 1 }), 'H');
  add(c, text(name, { size: 11.5, weight: 600, color: C.ink, w }), 'H');
  add(c, text(hex + '   ' + cssVar, { size: 10, weight: 400, color: C.muted, w }), 'H');
  if (note) add(c, text(note, { size: 10, weight: 400, color: C.muted, w, lh: 1.45 }), 'H');
  return c;
}

function swatchGrid(items, cols) {
  const gap = 16;
  const w = (CW - gap * (cols - 1)) / cols;
  const g = row('grid', { gap, gapY: 18, wrap: true, w: CW, cross: 'MIN' });
  for (const it of items) add(g, swatch(it[0], it[1], it[2], it[3], w), null);
  return g;
}

/* ---------------------------- 画板 ---------------------------- */
function a51Colors() {
  const b = board('51 · 色源与令牌色卡', '色值全部由 logo 位图实测得出（逐半径扫描 + 纯色像素计数）。'
    + '每个变量都挂了 CSS 变量名，开发可直接对照取用。', W, null);

  /* ---- 1. 色源实测 ---- */
  add(b.body, sectionLabel('1 · 色源实测：logo 五色分片', { color: C.brand }), 'H');
  const srcRows = [
    ['青绿主环', '#12A289', '60.2%', '内圈整环'],
    ['黄绿', '#BFE81E', '10.2%', '外圈 5°–80°'],
    ['橙', '#E66D1E', '9.1%', '外圈 85°–160°'],
    ['深灰', '#4F5053', '8.7%', '外圈 165°–215°'],
    ['蓝', '#3468A1', '9.2%', '外圈 220°–272°'],
    ['青绿分片', '#12A289', '—', '外圈 275°–355°'],
  ];
  const srcWrap = row('src', { gap: 24, w: CW, cross: 'MIN' });
  const tbl = col('t', { gap: 0, w: 600, radius: 12, stroke: C.line, sw: 1, clips: true, fill: C.surface });
  tbl.strokeAlign = 'OUTSIDE';
  srcRows.forEach((r, i) => {
    const tr = row('tr', { w: 600, gap: 0, h: 40, cross: 'CENTER', fill: i === 0 ? C.surfaceSoft : C.surface });
    const cells = [[r[0], 170, 'LEFT'], [r[1], 140, 'LEFT'], [r[2], 90, 'RIGHT'], [r[3], 200, 'LEFT']];
    for (const [v, w, align] of cells) {
      const c = row('td', { w, padX: 12, h: 40, cross: 'CENTER' });
      const isHex = String(v).indexOf('#') === 0;
      if (i === 0 && !isHex) {
        add(c, text(v, { size: 11.5, weight: 600, color: C.muted, w: w - 24, align }), 'H');
      } else if (isHex) {
        add(c, dot(v, 10, C.line), null);
        add(c, text(v, { size: 11.5, weight: 500, color: C.ink, w: w - 46, align }), 'H');
      } else {
        add(c, text(v, { size: 11.5, weight: i === 0 ? 600 : 400, color: C.ink, w: w - 24, align }), 'H');
      }
      add(tr, c);
    }
    add(tbl, tr, 'H');
    if (i < srcRows.length - 1) { const l = tintBar(C.line, 600, 0); l.resize(600, 1); add(tbl, l, 'H'); }
  });
  add(srcWrap, tbl);

  const geo = col('geo', { gap: 10, w: CW - 624 });
  const badge = row('bd', { gap: 14, w: CW - 624, fill: C.canvas, radius: 12, padX: 16, padY: 14, cross: 'CENTER' });
  add(badge, logoMark(84), null);
  const gt = col('gt', { gap: 5 });
  add(gt, text('双环结构', { size: 12.5, weight: 700, color: C.ink }), 'H');
  for (const [k, v] of [['中心孔', '0 → 0.382R'], ['青绿内环', '0.382R → 0.696R'], ['环间缝隙', '0.696R → 0.807R'], ['外圈分片', '0.807R → 1.000R']]) {
    const r = row('g', { gap: 8, cross: 'CENTER' });
    add(r, text(k, { size: 10.5, color: C.muted, w: 54 }), null);
    add(r, text(v, { size: 10.5, weight: 600, color: C.inkSoft }), null);
    add(gt, r, 'H');
  }
  add(badge, gt, 'H');
  add(geo, badge, 'H');
  add(geo, text('外圈 5 片，每片 72°，片间留约 5° 缝。上一版规范画的是单环分片 —— 那是简化示意，'
    + '真实 logo 是双环，本版按实测重绘。', { size: 10.5, weight: 400, color: C.muted, w: CW - 624, lh: 1.6 }), 'H');
  add(srcWrap, geo);
  add(b.body, srcWrap, 'H');

  /* ---- 2. 令牌色卡 ---- */
  add(b.body, sectionLabel('2 · 令牌色卡（36 个颜色变量，全部挂了 CSS 变量名）', { color: C.brand }), 'H');
  const GROUPS = [
    ['深色 · 壳与承载', [
      ['shell/ink-900', C.brandInk, '--fin-ink-900', '侧栏、深色汇总条、主按钮文字'],
      ['shell/ink-800', C.brandDeep, '--fin-ink-800', '深色次级面、悬停'],
      ['shell/ink-700', C.brandMid, '--fin-ink-700', '深底上的抬升面'],
      ['shell/on-ink', C.onInk, '--fin-on-ink', '深底正文 14.64:1'],
      ['shell/on-ink-2', C.onInk2, '--fin-on-ink-2', '深底次要 10.92:1'],
      ['shell/on-ink-3', C.onInk3, '--fin-on-ink-3', '深底辅助 5.77:1（侧栏未选中项）'],
    ]],
    ['品牌 · 识别与操作', [
      ['brand/base', C.brand, '--fin-brand', '★ 仅图形，禁作文字'],
      ['brand/strong', C.brandStrong, '--fin-brand-strong', '青绿悬停 / 按下'],
      ['brand/text', C.brandText, '--fin-brand-text', '青绿文字版 5.27:1'],
      ['brand/soft', C.brandSoft, '--fin-brand-soft', '选中行、信息条'],
      ['brand/line', C.brandLine, '--fin-brand-line', '青绿浅描边'],
    ]],
    ['强调 · 就是这里', [
      ['accent/base', C.accent, '--fin-accent', '★ 只出现在深色底上'],
      ['accent/strong', C.accentStrong, '--fin-accent-strong', '黄绿悬停 / 按下'],
      ['accent/soft', C.accentSoft, '--fin-accent-soft', '标记、图表填充'],
      ['accent/ink', C.accentInk, '--fin-accent-ink', '黄绿底文字 10.30:1'],
    ]],
    ['中性 · 面与线', [
      ['neutral/ink', C.ink, '--fin-ink', '正文 17.79:1'],
      ['neutral/ink-soft', C.inkSoft, '--fin-ink-soft', '次级正文'],
      ['neutral/muted', C.muted, '--fin-muted', '辅助文字 5.63:1'],
      ['neutral/line', C.line, '--fin-line', '分隔线与表格线'],
      ['neutral/line-strong', C.lineStrong, '--fin-line-strong', '输入框边、冻结列分隔'],
      ['neutral/canvas', C.canvas, '--fin-canvas', '页面底色'],
      ['neutral/surface', C.surface, '--fin-surface', '卡片与表格'],
      ['neutral/surface-soft', C.surfaceSoft, '--fin-surface-soft', '表头底'],
      ['neutral/sand', C.sand, '--fin-sand', '米色分区：说明区、页脚'],
      ['neutral/track', C.track, '--fin-track', '进度条轨道'],
    ]],
    ['语义 · 图形色与文字色成对', [
      ['warning（图形）', C.warning, '--fin-warning', '逾期、超收、决算未定'],
      ['warning-text', C.warningText, '--fin-warning-text', '橙文字版 5.76:1'],
      ['warning-soft', C.warningSoft, '--fin-warning-soft', '警示浅底'],
      ['danger', C.danger, '--fin-danger', '作废、撤销、回滚 6.54:1'],
      ['danger-soft', C.dangerSoft, '--fin-danger-soft', '危险浅底'],
      ['success', C.success, '--fin-success', '结清、已应用 6.52:1'],
      ['success-soft', C.successSoft, '--fin-success-soft', '成功浅底'],
      ['info', C.info, '--fin-info', '信息、提示 5.77:1'],
      ['info-soft', C.infoSoft, '--fin-info-soft', '信息浅底'],
      ['neutral（语义）', C.neutral, '--fin-neutral', '停用、历史值 8.06:1'],
      ['neutral-soft', C.neutralSoft, '--fin-neutral-soft', '停用浅底'],
    ]],
  ];
  for (const [title, items] of GROUPS) {
    add(b.body, sectionLabel(title, { color: C.brand }), 'H');
    add(b.body, swatchGrid(items, 5), 'H');
  }

  add(b.body, finNote('变量集合名「Color · 财务应收」与「Shape & Space · 财务应收」—— '
    + 'Figma 的变量是文件级的，与 Page 1（安全生产）的集合分开存放，互不覆盖。', 'info'), 'H');
  return b.outer;
}

/* ------------------------------ 装配 ------------------------------ */
// 接在 50 封面的下方（封面由 f79-fin-a0.js 负责）
const Y0 = yAfter('▣ 50', 200);
const put = stackAt(0, Y0, 200);
put(a51Colors());

return {
  分区: '财务应收 · A 区 · 51 色源与令牌色卡',
  画板数: 1,
  清理旧画板: cleared,
  起点Y: Y0,
  本区结束Y: put.end(),
};
