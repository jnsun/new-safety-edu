//!include ./_kit-fin.js

/* 财务应收 · B 区：64 状态与反馈
 * 依据 docs/design/财务应收视觉规范-v1.md §5.6 / §6.2 / §6.6
 * 文案取自 ReceivablesUi.tsx / ReceivablesPage.tsx / ReceivablesLedger.tsx 真实字符串。 */

await loadFonts();
await useFinPage();

const W = 1120;
const CW = W - 88;              // 1032
const cleared = clearBoards(['▣ 64']);

/* --------------------------- 局部构件 --------------------------- */
function td(colW, node, align, h) {
  const c = row('td', { w: colW, padX: 14, cross: 'CENTER', h: h != null ? h : 44 });
  if (align === 'CENTER') { add(c, flex()); add(c, node); add(c, flex()); }
  else if (align === 'FIT') add(c, node);
  else add(c, node, 'H');
  return c;
}

/** 表格骨架屏（§6.6：加载用骨架屏，不用转圈）。
 *  ⚠️ 现有代码 ReceivablesUi.tsx 的 loading 分支用的是 antd <Spin size="large" />。
 *  规范要求换成骨架屏 —— 这是第三处需要在代码里真改的地方。 */
function skeleton(w, rows) {
  const t = col('sk', { gap: 0, w, radius: 12, stroke: C.line, sw: 1, clips: true, fill: C.surface });
  t.strokeAlign = 'OUTSIDE';
  const BW = [128, 112, 200, 142, 142, 88];
  const hd = row('hd', { w, h: 40, fill: C.surfaceSoft, padX: 12, gap: 16, cross: 'CENTER' });
  for (const bw of BW) add(hd, tintBar(C.line, bw, 4), null);
  add(t, hd, 'H');
  for (let i = 0; i < rows; i++) {
    const tr = row('r', { w, h: 36, padX: 12, gap: 16, cross: 'CENTER' });
    for (let k = 0; k < BW.length; k++) {
      // 条宽做点抖动，看起来才像内容而不是表格线
      const bw = Math.max(28, BW[k] - (i * 7 + k * 11) % 42);
      add(tr, tintBar(C.line, bw, 4), null);
    }
    add(t, tr, 'H');
    if (i < rows - 1) { const ln = tintBar(C.line, w, 0); ln.resize(w, 1); add(t, ln, 'H'); }
  }
  return t;
}

/** 状态面板（非 loading）。
 *  kind: empty / search / denied / error */
function statePanel(kind, title, desc, action, w) {
  const spec = {
    empty: { icon: '◫', tone: C.muted, bg: C.neutralSoft },
    search: { icon: '⌕', tone: C.muted, bg: C.neutralSoft },
    denied: { icon: '⊘', tone: C.danger, bg: C.dangerSoft },
    error: { icon: '⚠', tone: C.warningText, bg: C.warningSoft },
  }[kind];
  const c = col('sp', {
    gap: 12, w, fill: C.surface, radius: 12, stroke: C.line, sw: 1,
    padX: 24, padY: 32, cross: 'CENTER', main: 'CENTER',
  });
  const ic = row('ic', { w: 56, h: 56, radius: 999, fill: spec.bg, cross: 'CENTER', main: 'CENTER' });
  add(ic, text(spec.icon, { size: 24, weight: 600, color: spec.tone }));
  // ⚠️ 不能传 'H' —— FILL 会把 56×56 的圆形图标横向拉成一条胶囊
  add(c, ic);
  const tt = text(title, { size: 15, weight: 600, color: C.ink, w: w - 48, align: 'CENTER' });
  add(c, tt, 'H');
  if (desc) {
    const dd = text(desc, { size: 12.5, weight: 400, color: C.muted, w: w - 48, align: 'CENTER', lh: 1.55 });
    add(c, dd, 'H');
  }
  if (action) {
    const ar = row('ar', { gap: 10, w: w - 48, cross: 'CENTER', main: 'CENTER' });
    add(ar, action, null);
    add(c, ar, 'H');
  }
  return c;
}

/* ---------------------------- 画板 ---------------------------- */
function a64States() {
  const b = board('64 · 状态与反馈',
    '财务系统的空态与错误态有一条铁律：**权限不足或读取失败时，不显示任何数据碎片**。'
    + '宁可整屏空白并说清楚原因，也不能让用户看到半截数字 —— 半截数字会被当成真的报出去。', W, null);

  /* ---- 1. 状态标签 ---- */
  add(b.body, sectionLabel('1 · 状态标签（高 22 · 圆角 6 · 内边距 0 8 · 12px/500）', { color: C.brand }), 'H');
  const tagT = col('t', { gap: 0, w: CW, radius: 12, stroke: C.line, sw: 1, clips: true, fill: C.surface });
  tagT.strokeAlign = 'OUTSIDE';
  const TAG_COLS = [['语义', 150], ['色点 + 文字（表格内）', 230], ['浅底标签（卡片 / 摘要）', 250], ['用在哪', 402]];
  const th = row('th', { w: CW, h: 38, gap: 0, fill: C.surfaceSoft, cross: 'CENTER' });
  for (const [t, cw] of TAG_COLS) add(th, td(cw, text(t, { size: 11.5, weight: 600, color: C.muted, w: cw - 28 }), 'LEFT', 38));
  add(tagT, th, 'H');
  const TAGS = [
    ['完成 / 正常', ['已结清', 'ok'], ['已结清', 'ok'], '结清状态列；导入批次「已应用」'],
    ['预警 / 待处理', ['超收', 'warn'], ['决算未定', 'warn'], '异常提醒、债权状态、核销待调减'],
    ['危险 / 撤销', ['已作废', 'bad'], ['已回滚', 'bad'], '记录状态列、导入批次回滚'],
    ['信息 / 中性提示', ['处理中', 'info'], ['已提交', 'info'], '导入向导阶段、待核对'],
    ['停用 / 历史值', ['历史值', 'mute'], ['停用', 'mute'], '业务字典停用项、修订历史'],
  ];
  TAGS.forEach((r, i) => {
    const tr = row('tr', { w: CW, h: 44, gap: 0, cross: 'CENTER', fill: i % 2 ? C.surface : C.surfaceSoft });
    add(tr, td(TAG_COLS[0][1], text(r[0], { size: 12, weight: 500, color: C.inkSoft, w: TAG_COLS[0][1] - 28 }), 'LEFT'));
    add(tr, td(TAG_COLS[1][1], statusDot(r[1][0], r[1][1]), 'FIT'));
    add(tr, td(TAG_COLS[2][1], finTag(r[2][0], r[2][1]), 'FIT'));
    add(tr, td(TAG_COLS[3][1], text(r[3], { size: 11, weight: 400, color: C.muted, w: TAG_COLS[3][1] - 28, lh: 1.4 }), 'LEFT'));
    add(tagT, tr, 'H');
    if (i < TAGS.length - 1) { const ln = tintBar(C.line, CW, 0); ln.resize(CW, 1); add(tagT, ln, 'H'); }
  });
  add(b.body, tagT, 'H');
  add(b.body, text('禁用态用灰色标签，不降低透明度 —— 半透明标签压在表格横线上会看不清。'
    + '色点必须与文字同时出现，色弱用户和黑白打印都要能读（WCAG 1.4.1）。',
  { size: 10.5, color: C.muted, w: CW, lh: 1.55 }), 'H');

  /* ---- 2. 加载态：骨架屏 ---- */
  add(b.body, sectionLabel('2 · 加载态：骨架屏（不用转圈）', { color: C.brand }), 'H');
  add(b.body, skeleton(1004, 8), 'H');
  add(b.body, text('骨架屏直接复刻表格结构（表头 40 + 8 行 36），加载完成时布局不跳动。'
    + '代码里的文案保留：「正在加载应收账款看板…」/「正在按当前权限范围汇总台账和金额」。',
  { size: 10.5, color: C.muted, w: CW, lh: 1.55 }), 'H');

  /* ---- 3. 四种面板 ---- */
  add(b.body, sectionLabel('3 · 空态 / 无结果 / 无权限 / 读取失败', { color: C.brand }), 'H');
  const panels = row('panels', { gap: 16, w: CW, cross: 'MIN' });
  const pw = (CW - 48) / 4;
  add(panels, statePanel('empty', '当前筛选下没有台账记录',
    '可以放宽筛选条件，或恢复默认筛选（有效且未结）。',
    finBtn('恢复默认筛选', 'secondary', { h: 28, size: 12 }), pw), null);
  add(panels, statePanel('search', '没有匹配的合同',
    '搜索命中合同编号、项目名称、客户名称三个字段。',
    finBtn('清除搜索条件', 'secondary', { h: 28, size: 12 }), pw), null);
  add(panels, statePanel('denied', '当前账号没有此项管理权限',
    '未显示任何财务数据。请联系财务资产部管理员开通。', null, pw), null);
  add(panels, statePanel('error', '数据加载失败，已隐藏缓存内容',
    '未显示任何财务数据。请检查网络后重试。',
    finBtn('重新加载', 'primary', { h: 28, size: 12 }), pw), null);
  add(b.body, panels, 'H');

  /* ---- 4. 提示条与版本冲突 ---- */
  add(b.body, sectionLabel('4 · 提示条 · 版本冲突', { color: C.brand }), 'H');
  add(b.body, finNote('冻结列与金额列的宽度是每人单独存的；改动列宽只影响自己，不影响他人。', 'info', CW), 'H');
  add(b.body, finNote('该台账已被作废，编辑会被拒绝。作废记录保留在表内，用「记录状态：已作废」筛选查看。', 'warn', CW), 'H');

  const conflict = col('cf', {
    gap: 12, w: CW, radius: 12, fill: C.warningSoft, stroke: C.warning, strokeOpacity: 0.35, sw: 1, padX: 20, padY: 16,
  });
  const cfBorder = { fill: C.surface, radius: 8, stroke: C.warning, strokeOpacity: 0.35, sw: 1, padX: 14, padY: 10 };
  const cfh = row('cfh', { gap: 10, w: CW - 40, cross: 'CENTER' });
  add(cfh, text('⚠', { size: 14, weight: 700, color: C.warningText }), null);
  add(cfh, text('保存被拒绝：这条台账在你编辑期间被他人修改过', { size: 13.5, weight: 600, color: C.warningText }), 'H');
  add(conflict, cfh, 'H');

  const cmp = row('cmp', { gap: 16, w: CW - 40, cross: 'MIN' });
  for (const [who, tone, val] of [['你的草稿', C.ink, '应收余额  128.40 万元'], ['服务端最新值', C.ink, '应收余额  136.20 万元'],
    ['差异', C.warningText, '应收余额  7.80 万元']]) {
    const cc = col('cc', Object.assign({ gap: 6, w: (CW - 40 - 32) / 3 }, cfBorder));
    add(cc, text(who, { size: 11, weight: 500, color: C.muted }), 'H');
    add(cc, text(val, { size: 13, weight: 600, color: tone }), 'H');
    add(cmp, cc, null);
  }
  add(conflict, cmp, 'H');

  const cff = row('cff', { gap: 12, w: CW - 40, cross: 'CENTER' });
  const ck = row('ck', { gap: 8, w: 420, cross: 'CENTER' });
  add(ck, frame('box', { w: 16, h: 16, radius: 4, fill: C.surface, stroke: C.lineStrong, sw: 1 }), null);
  add(ck, text('我已核对两者差异，确认以我的修改覆盖', { size: 12, weight: 500, color: C.inkSoft }), 'H');
  add(cff, ck, null);
  add(cff, flex(), null);
  add(cff, finBtn('放弃我的修改', 'secondary', { h: 28, size: 12 }), null);
  add(cff, finBtn('覆盖保存', 'danger', { h: 28, size: 12 }), null);
  add(conflict, cff, 'H');
  add(b.body, conflict, 'H');

  add(b.body, finNote('版本冲突不做「自动合并」。财务数据必须二选一，而且要让用户看见两边到底差多少 —— '
    + '所以第三条卡直接算出差异。覆盖保存要勾确认框、走 Danger 按钮、记修改原因。'
    + '另外注意：面板里的加载态在代码里还是 <Spin>，规范要求换骨架屏（ReceivablesUi.tsx 的 loading 分支）。', 'warn', CW), 'H');

  return b.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const Y0 = yAfter('▣ 63', 200);
const put = stackAt(1360, Y0, 200);
put(a64States());

return {
  分区: '财务应收 · B 区 · 64 状态与反馈',
  画板数: 1,
  清理旧画板: cleared,
  骨架行数: 8,
  状态面板数: 4,
  起点Y: Y0,
  本区结束Y: put.end(),
};
