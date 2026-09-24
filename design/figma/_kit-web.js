/* ===========================================================================
 * _kit-web.js — Web 后台专用的版式构件（表格 / KPI 卡 / 筛选条 / 面板）
 * 被 D 区脚本用 `//!include ./_kit-web.js` 内联（需先 include ./_kit.js）。
 * 后台内容区宽度：1440 - 224（侧栏）- 28×2（内边距）= 1160
 * =========================================================================== */

const WEB_CW = 1160;

/** 内容区标题带（小节标题 + 右侧动作）。 */
function webSection(title, right) {
  const r = row('sec', { gap: 12, w: WEB_CW, cross: 'CENTER' });
  add(r, text(title, { size: 15, weight: 700, color: C.ink }), 'H');
  if (right) { add(r, flex(), null); add(r, right); }
  return r;
}

/** 白底面板（后台默认容器）。 */
function webPanel(o) {
  o = o || {};
  const c = col(o.name || 'panel', {
    gap: o.gap != null ? o.gap : 14, w: o.w != null ? o.w : WEB_CW,
    fill: o.fill || C.surface, radius: 12, stroke: C.line, sw: 1,
    padX: o.padX != null ? o.padX : 20, padY: o.padY != null ? o.padY : 18,
  });
  return c;
}

/** KPI 指标卡。tone 决定数值色：'brand' | 'accent' | 'warning' | 'danger' | 'success' */
function kpiCard(label, value, sub, tone, o) {
  o = o || {};
  const toneColor = { brand: C.brandText, accent: C.accentInk, warning: C.warning, danger: C.danger, success: C.success }[tone] || C.brandText;
  const c = col('kpi', {
    gap: 7, fill: o.fill || C.surface, radius: 12, stroke: C.line, sw: 1,
    padX: 18, padY: 16, w: o.w != null ? o.w : null,
  });
  const top = row('top', { gap: 8, cross: 'CENTER' });
  add(top, text(label, { size: 12, weight: 600, color: C.muted }), 'H');
  add(top, flex(), null);
  const mark = tintBar(tone === 'accent' ? C.accent : toneColor, 8, 2);
  mark.resize(8, 8);
  add(top, mark, null);
  add(c, top, 'H');
  const v = row('v', { gap: 6, cross: 'MIN' });
  add(v, text(value, { size: 30, weight: 700, color: toneColor }), null);
  if (o.unit) add(v, text(o.unit, { size: 12, weight: 500, color: C.muted }), null);
  add(c, v, 'H');
  if (sub) add(c, text(sub, { size: 11, weight: 400, color: C.muted, w: (o.w != null ? o.w : 260) - 36, lh: 1.45 }), 'H');
  return c;
}

/** 表格。
 *  defs: [{ title, w, align?: 'LEFT'|'CENTER'|'RIGHT' }]
 *  rows: 二维数组；单元格可为字符串，或直接给一个已构建的节点。
 *  zebra: 是否隔行底色。 */
function webTable(defs, rows, o) {
  o = o || {};
  const total = defs.reduce((a, d) => a + d.w, 0);
  const t = col('table', { gap: 0, w: total, radius: 12, stroke: C.line, sw: 1, clips: true, fill: C.surface });
  // ⚠️ 必须 OUTSIDE：strokeAlign='INSIDE' 时 Figma 会从自动布局内容区里扣掉描边宽度，
  // 列宽按设计值拼出来就右越界 2px，被 clips 裁掉最后一列的右边框。
  t.strokeAlign = 'OUTSIDE';
  const applyAlign = (node, align) => {
    if (align === 'CENTER') node.textAlignHorizontal = 'CENTER';
    else if (align === 'RIGHT') node.textAlignHorizontal = 'RIGHT';
  };
  const hd = row('thead', { w: total, gap: 0, fill: C.surfaceSoft });
  for (const d of defs) {
    const cell = row('th', { w: d.w, padX: 14, padY: 11, cross: 'CENTER', gap: 4 });
    const t2 = text(d.title, { size: 12, weight: 700, color: C.inkSoft, w: d.w - 28 });
    applyAlign(t2, d.align);
    add(cell, t2, 'H');
    add(hd, cell);
  }
  add(t, hd, 'H');
  rows.forEach((r, i) => {
    const tr = row('tr', { w: total, gap: 0, cross: 'CENTER', fill: o.zebra !== false && i % 2 ? C.surfaceSoft : C.surface });
    defs.forEach((d, ci) => {
      const cell = row('td', { w: d.w, padX: 14, padY: 10, cross: 'CENTER', gap: 6 });
      const v = r[ci];
      if (v == null || v === '') {
        add(cell, text('—', { size: 12, color: C.lineStrong, w: d.w - 28 }), 'H');
      } else if (typeof v === 'string' || typeof v === 'number') {
        const t2 = text(String(v), { size: 12, weight: 400, color: C.inkSoft, w: d.w - 28, lh: 1.45 });
        applyAlign(t2, d.align);
        add(cell, t2, 'H');
      } else {
        add(cell, v, null);
      }
      add(tr, cell);
    });
    add(t, tr, 'H');
  });
  return t;
}

/** 表头右侧的排序小箭头，配合 webTable 用（视觉提示，不实现交互）。 */
function sortArrow() {
  return text('↕', { size: 9, weight: 500, color: C.lineStrong });
}

/** 胶囊筛选条：胶囊组 + 右侧搜索框。 */
function webFilterBar(groups, searchPlaceholder, o) {
  o = o || {};
  const bar = row('filter', {
    gap: 10, w: WEB_CW, cross: 'CENTER', flex: false,
    fill: o.fill != null ? o.fill : null, radius: 12,
    padX: o.padX != null ? o.padX : 0, padY: o.padY != null ? o.padY : 0,
  });
  for (const g of groups) {
    const grp = row('grp', { gap: 6, cross: 'CENTER' });
    g.forEach(([label, on]) => {
      add(grp, on
        ? chip(label, { fill: C.brandSoft, color: C.brandText, size: 11.5, padX: 12, padY: 6, weight: 700 })
        : chip(label, { fill: C.surface, color: C.muted, stroke: C.line, size: 11.5, padX: 12, padY: 6 }), null);
    });
    add(bar, grp, null);
  }
  add(bar, flex(), null);
  if (searchPlaceholder) {
    const srch = row('srch', { w: o.searchW != null ? o.searchW : 220, h: 34, padX: 11, gap: 7, cross: 'CENTER', radius: 8, fill: C.surface, stroke: C.line, sw: 1 });
    add(srch, text('⌕', { size: 12.5, color: C.muted }));
    add(srch, text(searchPlaceholder, { size: 12, color: C.muted }), 'H');
    add(bar, srch, null);
  }
  return bar;
}

/** 分页条。 */
function webPager(total, page) {
  const r = row('pager', { gap: 8, w: WEB_CW, cross: 'CENTER' });
  add(r, text('共 ' + total + ' 条 · 每页 20 条', { size: 11.5, weight: 400, color: C.muted }), 'H');
  add(r, flex(), null);
  const pg = row('pg', { gap: 4, cross: 'CENTER' });
  for (const [label, on] of [['‹', false], ['1', true], ['2', false], ['3', false], ['…', false], ['8', false], ['›', false]]) {
    const c = col('pn', {
      w: 28, h: 28, radius: 6, cross: 'CENTER', main: 'CENTER',
      fill: on ? C.brand : C.surface, stroke: on ? null : C.line, sw: 1,
    });
    add(c, text(label, { size: 11.5, weight: on ? 700 : 500, color: on ? C.white : C.inkSoft }), null);
    c.children[0].textAlignHorizontal = 'CENTER';
    add(pg, c);
  }
  add(r, pg);
  return r;
}

/** 行内动作链接组。 */
function webActions(labels) {
  const r = row('acts', { gap: 12, cross: 'CENTER' });
  for (const [i, label] of labels.entries()) {
    add(r, text(label, { size: 12, weight: 500, color: label.indexOf('删除') >= 0 || label.indexOf('停用') >= 0 ? C.danger : C.brandText }), null);
    if (i < labels.length - 1) add(r, text('|', { size: 10, color: C.line }));
  }
  return r;
}

/** 左树 + 右侧内容的双栏布局。左栏节点请自带固定宽度，右栏会横向填满。 */
function webSplit(gap) {
  const r = row('split', { gap: gap != null ? gap : 16, w: WEB_CW, cross: 'MIN' });
  return {
    root: r,
    left: (node) => { add(r, node); return node; },
    right: (node) => { add(r, node, 'H'); return node; },
  };
}

/** 后台里的横向进度（单元格内用）。 */
function cellProgress(pct, tone) {
  const w = 108;
  const wrap = row('cp', { gap: 8, cross: 'CENTER', w });
  add(wrap, progress(pct, { w: 64, h: 6, color: tone || C.brand }), null);
  add(wrap, text(Math.round(pct * 100) + '%', { size: 11, weight: 700, color: C.inkSoft, w: 32 }), null);
  return wrap;
}
