//!include ./_kit-fin-c.js

/* 财务应收 · C 区：74 合同详情（抽屉）
 * 全部对齐 apps/admin/src/ReceivablesLedger.tsx:
 *   :1647 <Drawer> title = 「合同详情」+ 合同编号 + 无写权限时 <Tag>只读</Tag>，width=920
 *   :1661 「正在加载详情…」 / :1668 「详情加载失败」+「记录可能已不存在或当前账号已失去读取权限。」
 *   :1806 操作条按能力逐项出现：编辑 / 上传附件 / 作废台账(danger) / 登记开票 / 登记回款 / 调整核销
 *   :1845 页签 = 合同概览 / 开票明细 / 回款明细 / 附件 / 修订历史
 *   :1854 概览三段 = 基本事实 / 状态与权威金额 / 债权与催收（Descriptions bordered, 2 列）
 *   :2101 「暂无回款明细」 :2185 「暂无附件」 :2248 段标题「修订历史」
 *   作废台账时整块加 is-voided。
 *
 * 抽屉是覆盖层，auto-layout 塞不进去 —— 所以画板根节点用 dir:'NONE' 的普通 frame，
 * 三个子层（外壳 / 遮罩 / 抽屉）全部手动定位。 */

await loadFonts();
await useFinPage();

const cleared = clearBoards(['▣ 74']);

const DW = 920;                  // 抽屉宽
const DIX = FIN_W - DW;          // 520 抽屉左边界
const IN = DW - 56;              // 864 内容内宽（padX 28）

const FACTS = [
  ['合同编号', 'HT-2026-0041'], ['财务归属部门', '财务资产部'],
  ['项目名称', '某市轨道交通 3 号线勘察'], ['客户名称', '某市轨道交通集团'],
  ['债权单位', '物化院'], ['决算方式', '工作量结算'],
];
const MONEY = [
  ['记录状态', '有效'], ['待核对', '决算未定'],
  ['合同金额（万元）', '1,286.40'], ['决算金额（万元）', '1,240.00'],
  ['开票金额（万元，服务端汇总）', '1,180.00'], ['到账金额（万元，服务端汇总）', '1,051.60'],
  ['账内应收（万元）', '128.40'], ['账外应收（万元）', '60.00'],
  ['应收余额（万元）', '188.40'], ['核销金额（万元）', '—'],
];
const COLLECT = [
  ['债权状态', '正常催收'], ['清收责任人', '李工'],
  ['最新挂账时间', '2026-03-18'], ['最新催收时间', '2026-09-12'],
  ['沟通方式', '上门'], ['对方反馈', '已在内部审批'],
  ['最新进展', '等待对方财务付款'], ['下一步计划', '10 月再次上门对账'],
];
const DTABS = ['合同概览', '开票明细', '回款明细', '附件', '修订历史'];

/* --------------------------- 局部构件 --------------------------- */

/** 页内页签：下划线式，不用筛选胶囊 —— 两者语义不同，见 §6.3 的说明。 */
function tabBar(items, active, w, size) {
  const wrap = col('tabs', { gap: 0, w });
  const r = row('tabbar', { gap: 24, w, cross: 'MAX' });
  items.forEach((t, i) => {
    const on = i === active;
    const cell = col('tb·' + t, { gap: 9, cross: 'MIN' });
    add(cell, text(t, { size: size || 13.5, weight: on ? 600 : 400, color: on ? C.ink : C.muted }), null);
    add(cell, row('bar', { h: on ? 2 : 1, radius: 1, fill: on ? C.brandInk : C.line }), 'H');
    add(r, cell, null);
  });
  add(wrap, r, 'H');
  return wrap;
}

/** Descriptions bordered：2 列键值网格。行/列分隔线都靠描边画，
 *  所以外层必须 strokeAlign='OUTSIDE'，否则内容区被扣掉描边宽、最后一列右越界。 */
function kvGrid(items, w) {
  const cw = w / 2;
  const t = col('kv', { gap: 0, w, radius: 10, stroke: C.line, sw: 1, clips: true, fill: C.surface });
  t.strokeAlign = 'OUTSIDE';
  for (let i = 0; i < items.length; i += 2) {
    if (i > 0) {
      const ln = tintBar(C.line, w, 0);
      ln.resize(w, 1);
      add(t, ln, 'H');
    }
    const rr = row('kvr', { gap: 0, w, h: 46 });
    items.slice(i, i + 2).forEach((it, ci, arr) => {
      const cell = col('kvc', { gap: 3, w: cw, padX: 12, padY: 3 });
      add(cell, text(it[0], { size: 11, weight: 400, color: C.muted, w: cw - 24 }), 'H');
      add(cell, text(it[1], { size: 13, weight: 500, color: it[1] === '—' ? C.muted : C.ink, w: cw - 24 }), 'H');
      if (ci < arr.length - 1) edgeLine(cell, 'RIGHT', C.line);
      add(rr, cell, null);
    });
    add(t, rr, 'H');
  }
  return t;
}

/** 一段：14px 段标题 + 网格。 */
function sec(title, items, w) {
  const c = col('sec', { gap: 8, w });
  add(c, text(title, { size: 14, weight: 600, color: C.ink }), 'H');
  add(c, kvGrid(items, w), 'H');
  return c;
}

/* ----------------------------- 背景外壳 ----------------------------- */
function backdrop() {
  const sh = finShell('74 · 背景台账', { active: 1, crumb: '应收账款台账' });
  const c = sh.content;
  add(c, finPageHead('合同台账', '一行一合同；筛选、排序和分页均由服务端执行。'), 'H');
  const COLS = [
    { title: '财务归属部门', w: 128 }, { title: '合同编号', w: 132 }, { title: '项目名称', w: 220, lines: 2 },
    { title: '客户名称', w: 180, lines: 2 }, { title: '单位', w: 88 }, { title: '债权状态', w: 96 },
    { title: '决算额', w: 142, align: 'RIGHT' }, { title: '应收余额', w: 142, align: 'RIGHT' },
  ];
  const ROWS = [
    ['财务资产部', 'HT-2026-0041', '某市轨道交通 3 号线勘察', '某市轨道交通集团', '物化院', '正常催收', '1,240.00', '188.40'],
    ['财务资产部', 'HT-2026-0038', '城东片区地灾评估', '某区自然资源局', '物化院', '正常催收', '480.00', '62.50'],
    ['财务资产部', 'HT-2025-0117', '某矿区水文地质调查', '某矿业集团', '六勘院', '诉讼中', '760.00', '94.80'],
    ['工程财务部', 'HT-2025-0089', '工业园区基础测绘', '某开发区管委会', '测绘院', '正常催收', '620.00', '84.60'],
    ['工程财务部', 'HT-2025-0071', '某水库大坝安全监测', '某水利局', '禹地公司', '已结清', '300.00', '0.00'],
  ];
  add(c, finTable(COLS, ROWS, { markRows: [0], rowH: 40 }), null);
  return sh.outer;
}

/* ------------------------------ 抽屉 ------------------------------ */
function drawer() {
  const d = col('抽屉', { gap: 0, w: DW, h: FIN_H, fill: C.surface });

  const hd = row('抽屉头', { gap: 10, w: DW, h: 50, padX: 28, cross: 'CENTER', fill: C.surface, stroke: C.line, sw: 1 });
  add(hd, text('合同详情', { size: 15, weight: 600, color: C.ink }), null);
  add(hd, text('HT-2026-0041', { size: 12.5, weight: 400, color: C.muted }), null);
  /* ⚠️ 这里不画「只读」标签。代码里它只在 !canWriteLedger 时出现，
   * 而那种情况下操作条里一个按钮都不会渲染 —— 两者不能同时存在。
   * 只读形态写在脚注里说明。 */
  add(hd, flex(), null);
  add(hd, text('✕', { size: 14, color: C.muted }), null);
  add(d, hd, 'H');

  const act = row('操作条', { gap: 8, w: DW, h: 52, padX: 28, cross: 'CENTER' });
  for (const v of ['编辑', '上传附件', '登记开票', '登记回款', '调整核销']) add(act, finBtn(v, 'secondary'), null);
  add(act, finBtn('作废台账', 'danger'), null);
  add(d, act, 'H');

  const tw = col('页签区', { gap: 0, w: DW, padX: 28, padY: 0 });
  add(tw, tabBar(DTABS, 0, IN), 'H');
  add(d, tw, 'H');

  const body = col('抽屉内容', { gap: 14, w: DW, padX: 28, padY: 16 });
  add(body, sec('基本事实', FACTS, IN), 'H');
  add(body, sec('状态与权威金额', MONEY, IN), 'H');
  add(body, sec('债权与催收', COLLECT, IN), 'H');
  add(d, body, 'H');
  add(d, flex(), 'H');

  const note = row('脚注', { gap: 8, w: DW, padX: 28, padY: 14, cross: 'CENTER', fill: C.canvas, stroke: C.line, sw: 1 });
  add(note, text('本图为可写形态（合同编号右侧无标签，操作条 6 个按钮全出现）。无写权限时标题右加灰色「只读」标签，'
    + '且操作条整条不渲染。加载中：正在加载详情…　失败：详情加载失败 · 记录可能已不存在或当前账号已失去读取权限。'
    + '　空态：暂无开票明细 / 暂无回款明细 / 暂无附件。作废后整块加 is-voided。',
  { size: 10.5, weight: 400, color: C.muted, w: DW - 56, lh: 1.5 }), 'H');
  add(d, note, 'H');

  return d;
}

/* ------------------------------ 装配 ------------------------------ */
const y = yAfter('▣ 73', 240);
const art = frame('▣ 74 · 合同详情', { w: FIN_W, h: FIN_H, fill: C.canvas, clips: true });
art.x = 2720;
art.y = y;

const shell = backdrop();
shell.x = 0;
shell.y = 0;
art.appendChild(shell);

// 遮罩：Drawer 打开时背景压暗。用墨绿最深色 45% 而不是纯黑，压暗后仍保持色相。
const scrim = frame('遮罩', { w: FIN_W, h: FIN_H, fill: C.brandInk, fillOpacity: 0.45, clips: true });
scrim.x = 0;
scrim.y = 0;
art.appendChild(scrim);

const dr = drawer();
dr.x = DIX;
dr.y = 0;
art.appendChild(dr);

/* ⚠️ 不能只量脚注底边 —— 抽屉里的 flex() 会把剩余空间全部吃掉，
 * 脚注底边永远等于 900，看不出到底有没有超。
 * 真正有信息量的是 flex 的残余高度：它被压到 1px 就说明已经顶死了。 */
const spacer = dr.children.find((n) => n.name === 'flex');
const foot = dr.children.find((n) => n.name === '脚注');
const bbArt2 = art.absoluteBoundingBox;
const bbFoot = foot.absoluteBoundingBox;
const drawerBottom = Math.round(bbFoot.y + bbFoot.height - bbArt2.y);

return {
  分区: '财务应收 · C 区 · 74 合同详情',
  画板数: 1,
  清理旧画板: cleared,
  尺寸: FIN_W + 'x' + FIN_H,
  抽屉宽: DW,
  抽屉左边界: DIX,
  页签: DTABS.join(' / '),
  概览段数: 3,
  键值项数: FACTS.length + MONEY.length + COLLECT.length,
  抽屉内容底边Y: drawerBottom,
  剩余空档: Math.round(spacer.height),
  脚注高: Math.round(foot.height),
  本区结束Y: y + FIN_H,
};
