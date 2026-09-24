//!include ./_kit-fin.js

/* 财务应收 · B 区：63 表单
 * 依据 docs/design/财务应收视觉规范-v1.md §6.4
 * 字段名取自 ReceivablesLedger.tsx 的表单 Form.Item 定义（真实字段，含中文 label）。 */

await loadFonts();
await useFinPage();

const W = 1120;
const CW = W - 88;              // 1032
const cleared = clearBoards(['▣ 63']);

/* --------------------------- 局部构件 --------------------------- */
function td(colW, node, align, h) {
  const c = row('td', { w: colW, padX: 14, cross: 'CENTER', h: h != null ? h : 44 });
  if (align === 'CENTER') { add(c, flex()); add(c, node); add(c, flex()); }
  else if (align === 'FIT') add(c, node);
  else add(c, node, 'H');
  return c;
}

/** 下拉字段（触发器样式与输入框一致，右侧 ▾）。 */
function selectField(label, value, state, o) {
  o = o || {};
  const w = o.w != null ? o.w : 300;
  const spec = {
    normal: { stroke: C.lineStrong, color: value ? C.ink : C.muted },
    focus: { stroke: C.brand, color: C.ink, glow: true },
    error: { stroke: C.danger, color: C.ink },
    disabled: { stroke: C.line, color: C.muted, fill: C.canvas },
  }[state || 'normal'];
  const c = col('sf', { gap: 6, w });
  const lab = row('lab', { gap: 3, cross: 'CENTER' });
  if (o.required) add(lab, text('*', { size: 12, weight: 600, color: C.warning }), null);
  add(lab, text(label, { size: 12, weight: 500, color: state === 'disabled' ? C.muted : C.inkSoft }), null);
  add(c, lab, 'H');
  const inp = row('in', {
    w, h: 32, padX: 11, gap: 8, radius: 8, cross: 'CENTER',
    fill: spec.fill || C.surface, stroke: spec.stroke, sw: 1,
    effects: spec.glow ? [shadow(C.brand, 0.14, 0, 0, 0, 3)] : undefined,
  });
  add(inp, text(value || o.placeholder || '请选择', { size: 12.5, weight: 400, color: spec.color }), 'H');
  add(inp, text('▾', { size: 10, weight: 500, color: state === 'disabled' ? C.line : C.muted }), null);
  add(c, inp, 'H');
  if (state === 'error') add(c, text(o.hint || '必填项', { size: 11, weight: 400, color: C.danger, w }), 'H');
  else if (o.hint) add(c, text(o.hint, { size: 11, weight: 400, color: C.muted, w }), 'H');
  return c;
}

/** 表单分段标题（左竖条 + 标题 + 说明）。 */
function seg(label, note, w) {
  const c = col('seg', { gap: 4, w });
  const r = row('r', { gap: 8, w, cross: 'CENTER' });
  const barEl = tintBar(C.brand, 4, 2);
  barEl.resize(4, 17);
  add(r, barEl);
  add(r, text(label, { size: 14, weight: 600, color: C.ink }), null);
  add(r, text(note, { size: 11, weight: 400, color: C.muted }), null);
  add(c, r, 'H');
  return c;
}

/* ---------------------------- 画板 ---------------------------- */
function a63Form() {
  const b = board('63 · 表单',
    '新建台账按「基础信息 → 金额信息 → 催收信息」三段展开，两列栅格。'
    + '字段名、必填标记、单位文案全部照抄代码，不做任何「美化」。', W, null);

  /* ---- 1. 四种控件状态 ---- */
  add(b.body, sectionLabel('1 · 控件四态（高 32 · 圆角 8 · 描边 line/strong）', { color: C.brand }), 'H');
  const states = row('states', { gap: 16, w: CW, cross: 'MIN' });
  const sw = (CW - 48) / 4;
  const CASES = [
    ['常规', finField('合同编号', 'HT-2026-0041', 'normal', { w: sw, required: true }), '白底 + line/strong 边；必填用橙色 * 前置'],
    ['聚焦', finField('合同编号', 'HT-2026-0041', 'focus', { w: sw, required: true }), '青绿描边 + 3px 外发光（rgba(18,162,137,.14)）'],
    ['错误', finField('合同编号', '', 'error', { w: sw, required: true, hint: '合同编号全公司唯一，已存在' }), '红描边 + 控件下方 11px 红字'],
    ['禁用', finField('合同编号', 'HT-2026-0041', 'disabled', { w: sw }), 'canvas 底 + line 边 + muted 字，不降透明度'],
  ];
  for (const [t, node, use] of CASES) {
    const c = col('cc', { gap: 10, w: sw });
    add(c, node, 'H');
    add(c, text(t, { size: 11.5, weight: 600, color: C.ink, w: sw }), 'H');
    add(c, text(use, { size: 10.5, weight: 400, color: C.muted, w: sw, lh: 1.45 }), 'H');
    add(states, c, null);
  }
  add(b.body, states, 'H');

  /* ---- 2. 金额输入与下拉 ---- */
  add(b.body, sectionLabel('2 · 金额输入右对齐 · 单位内嵌 · 下拉与日期', { color: C.brand }), 'H');
  const row2 = row('row2', { gap: 24, w: CW, cross: 'MIN' });
  const p2 = finPanel({ w: 508, gap: 14, name: 'money' });
  add(p2, text('金额输入框：右对齐 + 等宽数字 + 内嵌「万元」', { size: 11.5, weight: 600, color: C.ink, w: 468 }), 'H');
  add(p2, finField('合同金额', '386.20', 'normal', { w: 300, money: true, unit: '万元', hint: '允许两位小数；负数用 − (U+2212)' }), 'H');
  add(p2, finField('决算金额', '386.20', 'normal', { w: 300, money: true, unit: '万元', required: true }), 'H');
  add(row2, p2);

  const p3 = finPanel({ w: CW - 532, gap: 14, name: 'others' });
  add(p3, text('下拉 · 日期 · 附件', { size: 11.5, weight: 600, color: C.ink, w: CW - 572 }), 'H');
  const o1 = row('o1', { gap: 14, w: CW - 572, cross: 'MIN' });
  add(o1, selectField('决算方式', null, 'normal', { w: (CW - 572 - 14) / 2, required: true, placeholder: '请选择决算方式' }), null);
  add(o1, selectField('债权单位', '物化院', 'normal', { w: (CW - 572 - 14) / 2 }), null);
  add(p3, o1, 'H');
  const o2 = row('o2', { gap: 14, w: CW - 572, cross: 'MIN' });
  add(o2, finField('期初挂账日期', '2026-09-22', 'normal', { w: (CW - 572 - 14) / 2, hint: 'YYYY-MM-DD' }), null);
  const up = col('up', { gap: 6, w: (CW - 572 - 14) / 2 });
  add(up, text('合同扫描件', { size: 12, weight: 500, color: C.inkSoft }), 'H');
  const dz = row('dz', {
    w: (CW - 572 - 14) / 2, h: 32, radius: 8, cross: 'CENTER', main: 'CENTER', gap: 6,
    fill: C.surfaceSoft, stroke: C.brandLine, sw: 1,
  });
  add(dz, text('⇪', { size: 12.5, weight: 500, color: C.brandText }));
  add(dz, text('上传附件（PDF / 图片）', { size: 12, weight: 500, color: C.brandText }));
  add(up, dz, 'H');
  add(o2, up, null);
  add(p3, o2, 'H');
  add(row2, p3);
  add(b.body, row2, 'H');

  /* ---- 3. 三段式表单片段 ---- */
  add(b.body, sectionLabel('3 · 三段式表单（两列栅格 · 字段宽 486）', { color: C.brand }), 'H');
  const form = col('form', { gap: 22, w: CW, fill: C.surface, radius: 12, stroke: C.line, sw: 1, padX: 20, padY: 20 });
  const colW = (CW - 40 - 20) / 2;   // 486

  add(form, seg('基础信息', '财务归属部门决定数据授权范围，先选它', CW - 40), 'H');
  const s1 = row('s1', { gap: 20, w: CW - 40, cross: 'MIN' });
  const s1a = col('s1a', { gap: 16, w: colW });
  add(s1a, selectField('财务归属部门', '财务资产部', 'normal', { w: colW, required: true }), 'H');
  add(s1a, finField('项目名称', '某市轨道交通勘察项目', 'normal', { w: colW, required: true }), 'H');
  add(s1a, selectField('客户属性', '国有企业', 'normal', { w: colW }), 'H');
  add(s1, s1a, null);
  const s1b = col('s1b', { gap: 16, w: colW });
  add(s1b, finField('合同编号', 'HT-2026-0041', 'normal', { w: colW, required: true, hint: '全公司唯一' }), 'H');
  add(s1b, finField('客户名称', '某市轨道交通集团', 'normal', { w: colW, required: true }), 'H');
  add(s1b, selectField('工作性质', '工程勘察', 'normal', { w: colW }), 'H');
  add(s1, s1b, null);
  add(form, s1, 'H');

  add(form, seg('金额信息', '金额列一律两位数 + 千分位；单位统一「万元」', CW - 40), 'H');
  const s2 = row('s2', { gap: 20, w: CW - 40, cross: 'MIN' });
  const s2a = col('s2a', { gap: 16, w: colW });
  add(s2a, finField('合同金额', '386.20', 'normal', { w: colW, money: true, unit: '万元' }), 'H');
  add(s2a, finField('决算金额', '386.20', 'normal', { w: colW, money: true, unit: '万元', hint: '决算 = 开票 + 账外应收' }), 'H');
  add(s2, s2a, null);
  const s2b = col('s2b', { gap: 16, w: colW });
  add(s2b, selectField('决算方式', '已决算', 'normal', { w: colW }), 'H');
  add(s2b, finField('期初挂账日期', '2026-09-22', 'normal', { w: colW, hint: 'YYYY-MM-DD' }), 'H');
  add(s2, s2b, null);
  add(form, s2, 'H');

  add(form, seg('催收信息', '报账员只有这 16 个字段可写，其余只读', CW - 40), 'H');
  const s3 = row('s3', { gap: 20, w: CW - 40, cross: 'MIN' });
  const s3a = col('s3a', { gap: 16, w: colW });
  add(s3a, finField('最新催收时间', '2026-09-18', 'normal', { w: colW }), 'H');
  add(s3a, selectField('沟通方式', '电话', 'normal', { w: colW }), 'H');
  add(s3, s3a, null);
  const s3b = col('s3b', { gap: 16, w: colW });
  add(s3b, selectField('债权状态', '待收', 'normal', { w: colW }), 'H');
  add(s3b, finField('清收责任人', '张明', 'normal', { w: colW }), 'H');
  add(s3, s3b, null);
  add(form, s3, 'H');

  add(b.body, form, 'H');

  /* ---- 4. 底部操作条 ---- */
  add(b.body, sectionLabel('4 · 表单底部操作条', { color: C.brand }), 'H');
  const foot = row('foot', {
    gap: 12, w: CW, cross: 'CENTER', h: 56, padX: 20, radius: 12,
    fill: C.canvas, stroke: C.line, sw: 1,
  });
  add(foot, text('所有变更均记录原因、修订号和审计信息', { size: 11.5, weight: 400, color: C.muted }), null);
  add(foot, flex(), null);
  add(foot, finBtn('取消', 'secondary'), null);
  add(foot, finBtn('保存台账', 'primary'), null);
  add(b.body, foot, 'H');
  add(b.body, text('保存前必须填「修改原因」—— 编辑既有台账时，原因字段直接嵌在底部操作条左侧，'
    + '不另开弹窗。财务追溯靠的就是这一栏。', { size: 10.5, color: C.muted, w: CW, lh: 1.55 }), 'H');

  add(b.body, finNote('金额输入框的右对齐 + tabular-nums 是硬要求：一列金额如果在输入时就左对齐，'
    + '录错了很难自己发现。单位「万元」内嵌在控件里而不是写成标签后缀，'
    + '是为了让「这个数是几万」和「单位是什么」在同一视线内。', 'info', CW), 'H');

  return b.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const Y0 = yAfter('▣ 62', 200);
const put = stackAt(1360, Y0, 200);
put(a63Form());

return {
  分区: '财务应收 · B 区 · 63 表单',
  画板数: 1,
  清理旧画板: cleared,
  起点Y: Y0,
  本区结束Y: put.end(),
};
