//!include ./_kit-fin-c.js

/* 财务应收 · C 区：73 数据处理
 *
 * 本板的每一处文案与结构都对齐真实代码，不臆造：
 *   apps/admin/src/ReceivablesTransfers.tsx
 *     :60  stageItems        = 上传与映射 / 阻断错误 / 重复决策 / 影响预览 / 确认应用
 *     :597 Card title        = 「新建导入」
 *     :598 <Steps current={stageIndex[stage]}>
 *     :630 「将 XLSX 文件拖放到此处，或点击上传」
 *     :631 「仅支持标准后缀为 .xlsx 的文件，大小不超过 10 MiB」
 *     :652 「校验并生成预览」
 *     :803 重复表列          = 行号 / 合同编号 / 处理决定
 *     :816 处理决定选项      = 跳过 / 更新现有台账
 *     :833 选项副文案        = 「只补充当前为空的字段」
 *     :849 影响预览 Descriptions = 新建 / 更新 / 跳过
 *     :875 「将新建 N 条、更新 N 条、跳过 N 条」
 *     :928 「放弃本次预览」
 *     :934 Card title        = 「历史批次」
 *     :949 历史批次列        = 文件 / 状态 / 行数 / 错误 / 创建时间 / 操作
 *     :977 操作按钮          = 「回滚」（danger，仅 status==='applied' 可用）
 *     :995 「回滚会按批次修订恢复或删除受影响台账，冲突时服务端将拒绝。」
 *   apps/admin/src/ReceivablesPage.tsx
 *     :1099 页头 = 数据处理 / 「新增台账、导入和导出均使用当前账号的服务端权限范围。」
 *     :1052/:1068/:1084 Tabs = 新增记录 / Excel 导入 / Excel 导出（按权限逐项出现）
 *   apps/admin/src/receivables-types.ts
 *     :1049 unresolvedDuplicate = 有重复行未选决定 → 阶段停在 duplicate_decisions
 *   apps/api/src/receivables-import.ts
 *     :310 「重复导入只补充台账空字段，期初开票和到账明细不会重复写入」
 *
 * ⚠️ 三处最容易画错、且会带歪前端的点：
 *   1. 「更新现有台账」是 **只补充当前为空的字段**，不是覆盖（types.ts 与 import.ts 两处印证）。
 *   2. 阶段是**派生**的（receivablesImportStage），不是「上一步/下一步」按钮推的 ——
 *      所以这一步没有「上一步/下一步」，只有「放弃本次预览」。
 *      只要还有一条重复未选，阶段就停在 duplicate_decisions。
 *   3. 「历史批次」是一张 6 列表格、且是**上下堆叠的独立 Card**，不是右侧的卡片列表。 */

await loadFonts();
await useFinPage();

const cleared = clearBoards(['▣ 73']);
const CW = FIN_CW;                 // 1184
const PADX = 20;                   // 卡片内边距
const IN = CW - PADX * 2;          // 1144 卡片内宽

const STEPS = ['上传与映射', '阻断错误', '重复决策', '影响预览', '确认应用'];
const CUR = 2;                     // duplicate_decisions

/* 重复决策表：按内容定宽（代码里 antd 用 scroll.x='max-content'，不撑满卡片）。
 * 合计 96 + 200 + 400 = 696，卡内宽 1144 —— 右边留白是真实表现，不是漏画。 */
const DUP_COLS = [
  { title: '行号', w: 96, lines: 1 },
  { title: '合同编号', w: 200, lines: 1 },
  { title: '处理决定', w: 400, lines: 1 },
];
const DUP_ROWS = [
  [12, 'HT-2026-0041', '更新现有台账'],
  [37, 'HT-2026-0038', '跳过'],
  [94, 'HT-2025-0089', null],      // 未选 → 阶段停在这一步
];

/* 历史批次表：文件 / 状态 / 行数 / 错误 / 创建时间 / 操作 = 1144 */
const HIS_COLS = [
  { title: '文件', w: 520, lines: 1 },
  { title: '状态', w: 104, lines: 1 },
  { title: '行数', w: 88, align: 'RIGHT', lines: 1 },
  { title: '错误', w: 88, align: 'RIGHT', lines: 1 },
  { title: '创建时间', w: 244, lines: 1 },
  { title: '操作', w: 100, lines: 1 },
];
const HIS_ROWS = [
  ['2026-09-应收台账.xlsx', '已应用', 128, 0, '2026-09-22 09:41', 'applied'],
  ['2026-08-补录（勘误）.xlsx', '已回滚', 4, 0, '2026-08-25 16:08', 'rolled_back'],
  ['2026-08-应收台账.xlsx', '已应用', 126, 0, '2026-08-20 10:12', 'applied'],
  ['2026-07-应收台账.xlsx', '待应用', 119, 3, '2026-07-19 15:37', 'previewed'],
];

/* ------------------------- 局部构件 ------------------------- */

/** 五步阶段指示器。antd <Steps> 只给 title，没有 description —— 所以圆点下面
 *  只有一行标题。状态靠圆点自身表达：已完成绿底白勾 / 当前墨绿实底 / 待处理白底描边。 */
function stepper(w, cur) {
  const r = row('stepper', { gap: 0, w, cross: 'CENTER' });
  const sw = w / STEPS.length;
  STEPS.forEach((s, i) => {
    const done = i < cur;
    const on = i === cur;
    const cell = col('sc', { gap: 6, w: sw });
    const top = row('top', { w: sw, gap: 0, cross: 'CENTER', h: 24 });
    const circ = row('c', {
      w: 24, h: 24, radius: 999, cross: 'CENTER', main: 'CENTER',
      fill: done ? C.success : (on ? C.brandInk : C.surface),
      stroke: (done || on) ? null : C.lineStrong, sw: (done || on) ? 0 : 1,
    });
    add(circ, text(done ? '✓' : String(i + 1), { size: 11.5, weight: 700, color: (done || on) ? C.white : C.muted }));
    add(top, circ, null);
    // 连接线：从本圆点右缘一直连到下一个圆点左缘（cells 之间 gap 0，所以能接上）。
    if (i < STEPS.length - 1) {
      const ln = row('ln', { h: 2, radius: 1, fill: done ? C.success : C.line });
      add(top, ln, 'H');
    }
    add(cell, top, 'H');
    add(cell, text(s, { size: 12, weight: on ? 600 : 400, color: on ? C.ink : (done ? C.inkSoft : C.muted) }), null);
    add(r, cell, null);
  });
  return r;
}

/** 页内分段导航用**下划线标签**，故意不用 §6.3 的胶囊 —— 胶囊是筛选器的语义，
 *  两者混用会让人分不清「切换视图」和「筛掉数据」。选中项 2px 墨绿下划线。 */
function tabs(items, active, w) {
  const wrap = col('tabs', { gap: 0, w });
  const r = row('tabbar', { gap: 28, w, cross: 'MAX' });
  items.forEach((t, i) => {
    const on = i === active;
    const cell = col('tb·' + t, { gap: 9, cross: 'MIN' });
    add(cell, text(t, { size: 13.5, weight: on ? 600 : 400, color: on ? C.ink : C.muted }), null);
    const bar = row('bar', { h: on ? 2 : 1, radius: 1, fill: on ? C.brandInk : C.line });
    add(cell, bar, 'H');
    add(r, cell, null);
  });
  add(wrap, r, 'H');
  return wrap;
}

/** 表格内可编辑单元格的视觉替身：antd <Select style={{width:160}}>。
 *  undecided=true 时是空值态（更浅的字 + 更淡的描边），因为代码里默认是 null。 */
function selMock(label, undecided) {
  const r = row('sel', {
    w: 160, h: 26, padX: 10, gap: 6, cross: 'CENTER', radius: 6,
    fill: undecided ? C.canvas : C.surface,
    stroke: undecided ? C.line : C.lineStrong, sw: 1,
  });
  add(r, text(label || '请选择', { size: 12, color: undecided ? C.muted : C.ink }), 'H');
  add(r, text('▾', { size: 9, color: C.muted }), null);
  return r;
}

/** 处理决定单元格 = Select + 恒显的副文案「只补充当前为空的字段」（代码 :833）。 */
function decisionCell(label) {
  const c = col('dec', { gap: 4 });
  add(c, selMock(label, !label), null);
  add(c, text('只补充当前为空的字段', { size: 11, weight: 400, color: C.muted }), null);
  return c;
}

/** 历史批次「操作」列：回滚按钮，仅 已应用 行可用（代码 :970）。 */
function rollbackBtn(status) {
  const on = status === 'applied';
  return finBtn('回滚', on ? 'danger' : 'secondary', on ? { h: 24, padX: 10, size: 12 } : {
    h: 24, padX: 10, size: 12, fill: C.canvas, color: C.muted, stroke: C.line,
  });
}

/** 回滚弹窗标题（代码 :986）。 */
const ROLLBACK_TITLE = '回滚导入批次';

/* ---------------------------- 画板 ---------------------------- */
function a73Data() {
  const sh = finShell('73 · 数据处理', { active: 2, crumb: '数据处理' });
  const c = sh.content;

  add(c, finPageHead('数据处理',
    '新增台账、导入和导出均使用当前账号的服务端权限范围。'), 'H');

  // 三个 tab 按权限逐项出现（ReceivablesPage.tsx :1048-1095），这里 3 项都在。
  add(c, tabs(['新增记录', 'Excel 导入', 'Excel 导出'], 1, CW), 'H');

  /* ---------------- Card 1 · 新建导入 ---------------- */
  const c1 = col('card1', { gap: 12, w: CW, fill: C.surface, radius: 14, stroke: C.line, sw: 1, padX: PADX, padY: 16 });
  const c1h = row('c1h', { gap: 10, w: IN, cross: 'CENTER' });
  add(c1h, text('新建导入', { size: 15, weight: 600, color: C.ink }), null);
  add(c1h, flex(), null);
  add(c1h, finTag('第 3 步 / 共 5 步', 'brand', { dot: false }), null);
  add(c1, c1h, 'H');
  add(c1, stepper(IN, 2), 'H');

  const dh = row('dh', { gap: 10, w: IN, cross: 'CENTER' });
  add(dh, text('重复决策', { size: 13.5, weight: 600, color: C.ink }), null);
  const cnt = row('cnt', { h: 20, padX: 7, radius: 5, cross: 'CENTER', main: 'CENTER', fill: C.warningSoft });
  add(cnt, text('3 条', { size: 11, weight: 700, color: C.warningText }));
  add(dh, cnt, null);
  add(dh, text('合同编号与现有台账重复', { size: 11.5, weight: 400, color: C.muted }), null);
  add(c1, dh, 'H');

  add(c1, text('「更新现有台账」只补充当前为空的字段，已有值不会被覆盖；'
    + '每一条都必须显式决定 —— 只要还有一条未选，就停在这一步，不会进入影响预览。',
  { size: 11.5, weight: 400, color: C.inkSoft, w: IN, lh: 1.55 }), 'H');

  add(c1, finTable(DUP_COLS, DUP_ROWS.map((r) => [r[0], r[1], decisionCell(r[2])]), { rowH: 46 }), null);

  const c1f = row('c1f', { gap: 10, w: IN, cross: 'CENTER' });
  add(c1f, finBtn('放弃本次预览', 'secondary'), null);
  add(c1f, flex(), null);
  add(c1f, text('影响预览与最终确认分别出现「进入最终确认」「确认应用」按钮。',
    { size: 11, weight: 400, color: C.muted }), null);
  add(c1, c1f, 'H');
  add(c, c1, 'H');

  /* ---------------- Card 2 · 历史批次 ---------------- */
  const c2 = col('card2', { gap: 10, w: CW, fill: C.surface, radius: 14, stroke: C.line, sw: 1, padX: PADX, padY: 16 });
  const c2h = row('c2h', { gap: 10, w: IN, cross: 'CENTER' });
  add(c2h, text('历史批次', { size: 15, weight: 600, color: C.ink }), null);
  add(c2h, flex(), null);
  add(c2h, text('「回滚」仅对已应用的批次可用', { size: 11, weight: 400, color: C.muted }), null);
  add(c2, c2h, 'H');

  const hisRows = HIS_ROWS.map((r) => {
    const kind = { 已应用: 'ok', 待应用: 'info', 已回滚: 'mute', 失败: 'bad' }[r[1]];
    return [r[0], finTag(r[1], kind), r[2], r[3], r[4], rollbackBtn(r[5])];
  });
  add(c2, finTable(HIS_COLS, hisRows, { rowH: 34 }), 'H');

  add(c2, text('「' + ROLLBACK_TITLE + '」弹窗：回滚会按批次修订恢复或删除受影响台账，冲突时服务端将拒绝。'
    + '失败态显示「历史批次加载失败，已隐藏缓存内容」。',
  { size: 11, weight: 400, color: C.muted, w: IN, lh: 1.5 }), 'H');
  add(c, c2, 'H');

  // 把最后一张卡交出去，装配后用它量「内容底边离画板顶边还有多远」。
  return { outer: sh.outer, last: c2 };
}

/* ------------------------------ 装配 ------------------------------ */
const put = stackAt(2720, yAfter('▣ 72', 240), 240);
const made = a73Data();
// ⚠️ 不能叫 board —— _kit-core.js 里已有一个名为 board 的函数，同名 const 会触发
// Figma 沙箱的「invalid redefinition of a variable」，且报错不带行号，很难找。
const art = made.outer;
put(art);

/* 可用高度 = 900 − 顶栏 56 − 内容区上下内边距 40 = 804。
 * 内容底边一旦越过 880（=900−20 下内边距），就会被画板的 clips 裁掉 —— 改完必须看这个数。
 * ⚠️ 必须用 absoluteBoundingBox：node.y 是**相对父节点**的，最后一层卡片的 y 会算出负数。 */
const bbArt = art.absoluteBoundingBox;
const bbLast = made.last.absoluteBoundingBox;
const contentBottom = Math.round(bbLast.y + bbLast.height - bbArt.y);

return {
  分区: '财务应收 · C 区 · 73 数据处理',
  画板数: 1,
  清理旧画板: cleared,
  尺寸: FIN_W + 'x' + FIN_H,
  阶段: STEPS.join(' / '),
  当前阶段: STEPS[CUR],
  顶部Tab: '新增记录 / Excel 导入 / Excel 导出（当前：Excel 导入）',
  重复表列: DUP_COLS.map((d) => d.title + '(' + d.w + ')').join(' '),
  重复表合计宽: DUP_COLS.reduce((s, d) => s + d.w, 0),
  历史批次表列: HIS_COLS.map((d) => d.title + '(' + d.w + ')').join(' '),
  历史批次表合计宽: HIS_COLS.reduce((s, d) => s + d.w, 0),
  卡内可用宽: IN,
  内容底边Y: contentBottom,
  底边余量: 880 - contentBottom,
  本区结束Y: put.end(),
};
