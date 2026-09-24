/* ===========================================================================
 * _kit-fin-c.js — C 区（整页）复用构件
 * =========================================================================== */

//!include ./_kit-fin.js

/* 拆出来的原因：use_figma 单次 code 上限 5 万字符。
 * 这 8 个构件只有「整页」场景（C 区）用得到；A/B 区的规范板（字体、色卡、组件矩阵）
 * 用不上，却要为它们多付约 4K 字符 —— 实测 52 板正文 9.2K + 工具箱 42.7K = 51.9K 被拒。
 * 所以 C 区脚本 include 本文件，A/B 区脚本继续只 include _kit-fin.js。
 * ------------------------------------------------------------------------- */

/** 分组标签 + 胶囊组。 */
function finChipGroup(label, chips, w) {
  const c = col('grp', { gap: 6, w });
  add(c, text(label, { size: 11.5, weight: 500, color: C.muted }), 'H');
  const r = row('chips', { gap: 6, w, cross: 'CENTER' });
  for (const [t, on] of chips) add(r, finChip(t, on), null);
  add(c, r, 'H');
  return c;
}

/** 胶囊样式的下拉触发器（多值筛选）。 */
function finChipSelect(label, active, w) {
  const r = row('cs', {
    w, h: 28, padX: 12, gap: 8, radius: 999, cross: 'CENTER',
    fill: active ? C.brandInk : C.surface,
    stroke: active ? null : C.lineStrong, sw: active ? 0 : 1,
  });
  add(r, text(label, { size: 13, weight: active ? 600 : 400, color: active ? C.white : C.inkSoft, w: w - 42 }), 'H');
  add(r, text('▾', { size: 10, weight: 500, color: active ? C.white : C.muted }), null);
  return r;
}

/** 已生效筛选的回显胶囊（可单独关闭）。 */
function finRemovableChip(label) {
  const r = row('fc', { gap: 6, h: 26, padX: 10, radius: 999, cross: 'CENTER', fill: C.brandSoft, stroke: C.brandLine, sw: 1 });
  add(r, text(label, { size: 11.5, weight: 500, color: C.brandText }));
  add(r, text('✕', { size: 9.5, weight: 600, color: C.brandText }));
  return r;
}

/** 搜索框。state: idle / focus；传 value 即变成「有值 + 清除按钮」。 */
function finSearch(w, state, value) {
  const stroke = state === 'focus' ? C.brand : C.lineStrong;
  const r = row('srch', {
    w, h: 32, padX: 11, gap: 8, radius: 8, cross: 'CENTER',
    fill: C.surface, stroke, sw: 1,
    effects: state === 'focus' ? [shadow(C.brand, 0.14, 0, 0, 0, 3)] : undefined,
  });
  add(r, text('⌕', { size: 12.5, color: state === 'focus' ? C.brandText : C.muted }));
  add(r, text(value || '合同、项目或客户', { size: 12.5, weight: 400, color: value ? C.ink : C.muted }), 'H');
  if (value) add(r, text('✕', { size: 10.5, color: C.muted }), null);
  return r;
}

/** 完整筛选条（三行：搜索 + 三选一类 → 多值类 → 已生效回显）。宽一律传 FIN_CW（1184）。 */
function finLedgerFilters(W0) {
  const inner = W0 - 40;
  const bar = col('filters', { gap: 14, w: W0, fill: C.surface, radius: 12, stroke: C.line, sw: 1, padX: 20, padY: 16 });

  const r1 = row('r1', { gap: 16, w: inner, cross: 'MAX' });
  const sg = col('sg', { gap: 6, w: 240 });
  add(sg, text('搜索', { size: 11.5, weight: 500, color: C.muted }), 'H');
  add(sg, finSearch(240, 'idle'), 'H');
  add(r1, sg, null);
  /* ⚠️ 胶囊组的 w 是**下界**不是上界：Figma 不会压缩超宽的子节点，
   * 宽度估小了最后一个胶囊就会戳出组外（实测 9–11px）。宁可多留 14–20px。 */
  add(r1, finChipGroup('结清状态', [['未结', true], ['已结清', false], ['全部', false]], 186), null);
  add(r1, finChipGroup('记录状态', [['有效', true], ['已作废', false], ['全部', false]], 186), null);
  add(r1, flex(), null);
  add(r1, finBtn('导出条件', 'secondary'), null);
  add(bar, r1, 'H');

  const r2 = row('r2', { gap: 16, w: inner, cross: 'MAX' });
  add(r2, finChipGroup('单位', [['物化院', false], ['六勘院', false], ['测绘院', false], ['禹地公司', false]], 342), null);
  const r2b = row('r2b', { gap: 10, w: inner - 358, cross: 'MAX' });
  add(r2b, finChipSelect('归属部门', false, 118), null);
  add(r2b, finChipSelect('债权状态', false, 112), null);
  add(r2b, finChipSelect('待核对', false, 100), null);
  add(r2b, flex(), null);
  add(r2, r2b, null);
  add(bar, r2, 'H');

  const r3 = row('r3', { gap: 8, w: inner, cross: 'CENTER' });
  add(r3, text('已生效筛选', { size: 11.5, weight: 400, color: C.muted }), null);
  for (const t of ['结清状态：未结', '记录状态：有效', '单位：物化院']) add(r3, finRemovableChip(t), null);
  add(r3, flex(), null);
  add(r3, finBtn('恢复默认筛选', 'ghost', { size: 12 }), null);
  add(bar, r3, 'H');
  return bar;
}

/** 分页条（与表格同宽）。 */
function finPager(w, total) {
  const r = row('pager', { gap: 8, w, cross: 'CENTER', h: 40 });
  add(r, text('共 ' + (total != null ? total : 128) + ' 条', { size: 12, weight: 400, color: C.muted }), null);
  add(r, flex(), null);
  add(r, text('每页', { size: 12, color: C.muted }), null);
  add(r, finChip('20 条', true, { h: 26, padX: 10, size: 11.5 }), null);
  add(r, box(8, 1), null);
  for (const [n, on] of [['‹', false], ['1', true], ['2', false], ['3', false], ['…', false], ['13', false], ['›', false]]) {
    const wide = n.length > 1 && n !== '‹' && n !== '›';
    const pg = row('pg', {
      w: wide ? 30 : 28, h: 28, radius: 8, cross: 'CENTER', main: 'CENTER',
      fill: on ? C.brandInk : null, stroke: on ? null : C.line, sw: on ? 0 : 1,
    });
    add(pg, text(n, { size: 12, weight: on ? 600 : 400, color: on ? C.white : (n === '…' ? C.muted : C.inkSoft) }));
    add(r, pg, null);
  }
  return r;
}

/** 表格骨架屏（§6.6：加载用骨架屏，不用转圈）。 */
function finSkeleton(w, rows) {
  const BW = [128, 112, 200, 142, 142, 88, 104, 96];
  const t = col('sk', { gap: 0, w, radius: 12, stroke: C.line, sw: 1, clips: true, fill: C.surface });
  t.strokeAlign = 'OUTSIDE';
  const hd = row('hd', { w, h: 40, fill: C.surfaceSoft, padX: 12, gap: 16, cross: 'CENTER' });
  for (const bw of BW) add(hd, tintBar(C.line, bw, 4), null);
  add(t, hd, 'H');
  for (let i = 0; i < rows; i++) {
    const tr = row('r', { w, h: 36, padX: 12, gap: 16, cross: 'CENTER' });
    for (let k = 0; k < BW.length; k++) {
      // 条宽做点抖动，看起来才像内容而不是表格线
      add(tr, tintBar(C.line, Math.max(28, BW[k] - (i * 7 + k * 11) % 42), 4), null);
    }
    add(t, tr, 'H');
    if (i < rows - 1) { const ln = tintBar(C.line, w, 0); ln.resize(w, 1); add(t, ln, 'H'); }
  }
  return t;
}

/** 表格工具栏（记录数 + 说明 + 紧凑列宽）。 */
function finLedgerToolbar(w, count) {
  const r = row('tbar', { gap: 10, w, cross: 'CENTER' });
  add(r, text(String(count != null ? count : 128), { size: 14, weight: 700, color: C.ink }), null);
  add(r, text('条记录（当前筛选范围）', { size: 12.5, color: C.muted }), null);
  add(r, flex(), null);
  add(r, text('项目、客户和催收内容最多显示 2 行', { size: 11.5, color: C.muted }), null);
  add(r, box(8, 1), null);
  add(r, text('金额单位：万元', { size: 11.5, weight: 600, color: C.inkSoft }), null);
  add(r, box(8, 1), null);
  add(r, finChip('紧凑列宽', false, { h: 28, padX: 11, size: 12 }), null);
  return r;
}
