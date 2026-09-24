//!include ./_kit-fin.js

/* 财务应收 · B 区：62 筛选与搜索
 * 依据 docs/design/财务应收视觉规范-v1.md §6.3
 *
 * ⚠️ 这里有一处**要改代码的设计决策**：
 * 现有实现（ReceivablesLedger.tsx:1441-1547）用的是 antd 的 Form + 7 个 Select 下拉。
 * 规范要求三选一类改成药丸式胶囊组，多值类保留下拉但触发器做成胶囊样式。
 * 依据是用户既定偏好：筛选器一律胶囊选项卡，不用下拉菜单。
 */

await loadFonts();
await useFinPage();

const W = 1120;
const CW = W - 88;              // 1032
const cleared = clearBoards(['▣ 62']);

/* --------------------------- 局部构件 --------------------------- */
function td(colW, node, align, h) {
  const c = row('td', { w: colW, padX: 14, cross: 'CENTER', h: h != null ? h : 44 });
  if (align === 'CENTER') { add(c, flex()); add(c, node); add(c, flex()); }
  else if (align === 'FIT') add(c, node);
  else add(c, node, 'H');
  return c;
}

/** 分组：标签 + 胶囊组。 */
function group(label, chips, w) {
  const c = col('grp', { gap: 6, w });
  add(c, text(label, { size: 11.5, weight: 500, color: C.muted }), 'H');
  const r = row('chips', { gap: 6, w, cross: 'CENTER' });
  for (const [t, on] of chips) add(r, finChip(t, on), null);
  add(c, r, 'H');
  return c;
}

/** 胶囊样式的下拉触发器（多值筛选用）。 */
function chipSelect(label, active, w) {
  const r = row('cs', {
    w, h: 28, padX: 12, gap: 8, radius: 999, cross: 'CENTER',
    fill: active ? C.brandInk : C.surface,
    stroke: active ? null : C.lineStrong, sw: active ? 0 : 1,
  });
  add(r, text(label, { size: 13, weight: active ? 600 : 400, color: active ? C.white : C.inkSoft, w: w - 42 }), 'H');
  add(r, text('▾', { size: 10, weight: 500, color: active ? C.white : C.muted }), null);
  return r;
}

/** 搜索框。state: idle / focus / filled */
function searchBox(w, state, value) {
  const spec = {
    idle: { stroke: C.lineStrong, color: C.muted, val: '合同、项目或客户' },
    focus: { stroke: C.brand, color: C.muted, val: '合同、项目或客户' },
    filled: { stroke: C.lineStrong, color: C.ink, val: '轨道交通' },
  }[state];
  const r = row('srch', {
    w, h: 32, padX: 11, gap: 8, radius: 8, cross: 'CENTER',
    fill: C.surface, stroke: spec.stroke, sw: 1,
    effects: state === 'focus' ? [shadow(C.brand, 0.14, 0, 0, 0, 3)] : undefined,
  });
  add(r, text('⌕', { size: 12.5, color: state === 'focus' ? C.brandText : C.muted }));
  add(r, text(value || spec.val, { size: 12.5, weight: 400, color: value ? C.ink : spec.color }), 'H');
  if (value) add(r, text('✕', { size: 10.5, color: C.muted }), null);
  return r;
}

/* ---------------------------- 画板 ---------------------------- */
function a62Filters() {
  const b = board('62 · 筛选与搜索',
    '7 个筛选字段、22 列的表 —— 用户必须随时知道「现在被筛掉了什么」。'
    + '所以已生效筛选要原样回显成胶囊，而不是藏在表单控件里。', W, null);

  /* ---- 1. 筛选条：完整布局 ---- */
  add(b.body, sectionLabel('1 · 筛选条（三行：字段 → 字段 → 已生效回显）', { color: C.brand }), 'H');
  const bar = col('bar', { gap: 14, w: CW, fill: C.surface, radius: 12, stroke: C.line, sw: 1, padX: 20, padY: 16 });

  // 行 1：搜索 + 两个三选一
  const r1 = row('r1', { gap: 16, w: CW - 40, cross: 'MAX' });
  const sg = col('sg', { gap: 6, w: 240 });
  add(sg, text('搜索', { size: 11.5, weight: 500, color: C.muted }), 'H');
  add(sg, searchBox(240, 'idle'), 'H');
  add(r1, sg, null);
  add(r1, group('结清状态', [['未结', true], ['已结清', false], ['全部', false]], 186), null);
  add(r1, group('记录状态', [['有效', true], ['已作废', false], ['全部', false]], 186), null);
  add(r1, flex(), null);
  add(r1, finBtn('导出条件', 'secondary'), null);
  add(bar, r1, 'H');

  // 行 2：单位（4 个枚举，胶囊组）+ 三个多值筛选（胶囊样式下拉）
  const r2 = row('r2', { gap: 16, w: CW - 40, cross: 'MAX' });
  add(r2, group('单位', [['物化院', false], ['六勘院', false], ['测绘院', false], ['禹地公司', false]], 342), null);
  const r2b = row('r2b', { gap: 10, w: CW - 40 - 358, cross: 'MAX' });
  add(r2b, chipSelect('归属部门', false, 118), null);
  add(r2b, chipSelect('债权状态', false, 112), null);
  add(r2b, chipSelect('待核对', false, 100), null);
  add(r2b, chipSelect('待核对：超收', true, 132), null);
  add(r2, r2b, null);
  add(bar, r2, 'H');

  // 行 3：已生效筛选回显
  const r3 = row('r3', { gap: 8, w: CW - 40, cross: 'CENTER' });
  add(r3, text('已生效筛选', { size: 11.5, weight: 400, color: C.muted }), null);
  for (const t of ['结清状态：未结', '记录状态：有效', '单位：物化院', '待核对：超收']) {
    const ch = row('fc', { gap: 6, h: 26, padX: 10, radius: 999, cross: 'CENTER', fill: C.brandSoft, stroke: C.brandLine, sw: 1 });
    add(ch, text(t, { size: 11.5, weight: 500, color: C.brandText }));
    add(ch, text('✕', { size: 9.5, weight: 600, color: C.brandText }));
    add(r3, ch, null);
  }
  add(r3, flex(), null);
  add(r3, finBtn('恢复默认筛选', 'ghost', { size: 12 }), null);
  add(bar, r3, 'H');

  add(b.body, bar, 'H');
  add(b.body, text('行 3 是这套筛选设计的关键：胶囊直接列出「正在生效的条件」，每个都能单独关掉。'
    + '没有任何条件时显示一颗「默认：有效且未结」—— 默认值本身也是信息，不能省。',
  { size: 10.5, color: C.muted, w: CW, lh: 1.55 }), 'H');

  /* ---- 2. 胶囊四态 ---- */
  add(b.body, sectionLabel('2 · 胶囊四态（高 28 · 圆角 999 · 内边距 0 12）', { color: C.brand }), 'H');
  const chipStates = row('cs', { gap: 16, w: CW, cross: 'MIN' });
  const CASES = [
    ['未选', finChip('物化院', false), '白底 + line/strong 边 + ink/soft 字'],
    ['悬停', (() => {
      const c = row('hv', { h: 28, padX: 12, radius: 999, cross: 'CENTER', fill: C.brandSoft, stroke: C.brandLine, sw: 1 });
      add(c, text('物化院', { size: 13, weight: 400, color: C.brandText }));
      return c;
    })(), 'brand/soft 底 + brand/line 边 + brand/text 字'],
    ['已选（单选）', finChip('物化院', true), 'ink/900 底 + 白字，与侧栏选中态同一套语言'],
    ['已选（多选）', (() => {
      const c = row('hv2', { h: 28, padX: 12, gap: 6, radius: 999, cross: 'CENTER', fill: C.brandInk });
      add(c, text('物化院', { size: 13, weight: 600, color: C.white }));
      add(c, text('✕', { size: 10, weight: 600, color: C.onInk2 }));
      return c;
    })(), '多选类带关闭图标，可直接摘掉一项'],
  ];
  const cw2 = (CW - 48) / 4;
  for (const [t, node, use] of CASES) {
    const c = col('cc', { gap: 8, w: cw2 });
    const stage = row('stage', { w: cw2, h: 56, fill: C.surfaceSoft, radius: 8, cross: 'CENTER', main: 'CENTER' });
    add(stage, node);
    add(c, stage, 'H');
    add(c, text(t, { size: 11.5, weight: 600, color: C.ink, w: cw2 }), 'H');
    add(c, text(use, { size: 10.5, weight: 400, color: C.muted, w: cw2, lh: 1.45 }), 'H');
    add(chipStates, c, null);
  }
  add(b.body, chipStates, 'H');

  /* ---- 3. 搜索框三态 + 下拉面板 ---- */
  add(b.body, sectionLabel('3 · 搜索框三态 · 多值筛选的展开面板', { color: C.brand }), 'H');
  const last = row('last', { gap: 24, w: CW, cross: 'MIN' });

  const sp = finPanel({ w: 508, gap: 14, name: 'search' });
  add(sp, text('搜索框（顶栏 220 / 筛选栏 240）', { size: 11.5, weight: 600, color: C.ink, w: 468 }), 'H');
  for (const [st, t] of [['idle', '静止'], ['focus', '聚焦：青绿描边 + 3px 外发光'], ['filled', '有值：右侧出现清除按钮']]) {
    const r = row('sr', { gap: 12, w: 468, cross: 'CENTER' });
    add(r, text(t, { size: 10.5, weight: 400, color: C.muted, w: 148 }), null);
    add(r, searchBox(300, st), null);
    add(sp, r, 'H');
  }
  add(sp, text('搜索命中合同编号、项目名称、客户名称三个字段。placeholder 照抄代码文案，不做美化。',
    { size: 10.5, color: C.muted, w: 468, lh: 1.55 }), 'H');
  add(last, sp);

  const dp = finPanel({ w: CW - 532, gap: 12, name: 'pop' });
  add(dp, text('多值筛选的展开面板（面板里也是胶囊）', { size: 11.5, weight: 600, color: C.ink, w: CW - 572 }), 'H');
  const anchor = col('anchor', { gap: 8, w: CW - 572 });
  add(anchor, chipSelect('归属部门', false, 130), 'H');
  const pop = col('pop', {
    gap: 10, w: CW - 572, fill: C.surface, radius: 10,
    stroke: C.line, sw: 1, padX: 14, padY: 12, effects: [SH.pop],
  });
  const pw = CW - 572 - 28;
  const chipWrap = row('wrap', { gap: 6, w: pw, wrap: true, gapY: 6, cross: 'CENTER' });
  for (const [t, on] of [['财务资产部', true], ['经营部', false], ['地勘分院', false], ['测绘分院', false], ['物探分院', false], ['综合办公室', false]]) {
    add(chipWrap, finChip(t, on, { size: 12, padX: 10, h: 26 }), null);
  }
  add(pop, chipWrap, 'H');
  const popFoot = row('pf', { gap: 10, w: pw, cross: 'CENTER' });
  add(popFoot, flex(), null);
  add(popFoot, finBtn('清空', 'ghost', { size: 12, h: 26, padX: 8 }), null);
  add(popFoot, finBtn('确定', 'primary', { size: 12, h: 26, padX: 12 }), null);
  add(pop, popFoot, 'H');
  add(anchor, pop, 'H');
  add(dp, anchor, 'H');
  add(dp, text('部门可能十几项，全摊在筛选条上会挤爆 —— 所以这类保留下拉，但触发器做成胶囊、展开后仍是胶囊。',
    { size: 10.5, color: C.muted, w: CW - 572, lh: 1.55 }), 'H');
  add(last, dp);
  add(b.body, last, 'H');

  add(b.body, finNote('这是一处需要在代码里真改的地方：现有 ReceivablesLedger.tsx 的筛选区是 '
    + 'antd Form + 7 个 Select（receivables-ledger-filters）。按本规范要改成「三选一类用胶囊组、'
    + '多值类用胶囊触发器 + 面板」，替换掉 .receivables-filter-grid 的样式与结构，'
    + '但筛选字段、取值枚举、query 参数一律不动。', 'warn', CW), 'H');

  return b.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const Y0 = yAfter('▣ 61', 200);
const put = stackAt(1360, Y0, 200);
put(a62Filters());

return {
  分区: '财务应收 · B 区 · 62 筛选与搜索',
  画板数: 1,
  清理旧画板: cleared,
  筛选字段数: 7,
  起点Y: Y0,
  本区结束Y: put.end(),
};
