//!include ./_kit-fin-c.js

/* 财务应收 · C 区：77 业务字典
 * 全部对齐 apps/admin/src/ReceivablesAdmin.tsx:
 *   :222 sectionCopy = 「业务字典」/「维护业务中使用的分类值；改名会同步受影响的台账引用。」
 *   :217 createLabel = 「新增选项」（页头主按钮）
 *   :304 左导航 12 个分类（aria「业务字典分类」），每项 = 分类名 + `启用数/总数`
 *   :308 右侧 = Title level5（分类名）+「只管理当前类别，停用项可切换查看。」+ 搜索「搜索选项」+ 状态 Select
 *   :309 表格列 = 选项 / 状态(90) / 排序(80) / 修订(80) / 操作(280)，分页 pageSize 20 + hideOnSinglePage
 *   :309 空态「当前类别没有匹配选项」/「当前类别暂无选项」
 *   :212-214 行操作 = 编辑 / 停用(仅停用行出现「迁移到…」Select)
 *   :188-201 改名走二次确认：「确认同步改名」/「“X”将改为“Y”，并同步更新 N 条引用。」/「确认改名」
 *            成功后提示「改名完成，共更新 N 条引用」
 *   分类枚举见 receivables-types.ts:200-232（12 个） */

await loadFonts();
await useFinPage();

const cleared = clearBoards(['▣ 77']);
const CW = FIN_CW;
const NAV_W = 208;
const CT_W = CW - NAV_W - 16;        // 960 右栏宽
const NAV_IN = NAV_W - 24;           // 184

/* [分类, 启用数, 总数] */
const CATS = [
  ['项目状态', 6, 7], ['决算方式', 3, 3], ['债权状态', 5, 5], ['客户属性', 4, 4],
  ['单位', 4, 4], ['工作性质', 3, 3], ['八大板块', 8, 8], ['沟通方式', 5, 5],
  ['对方反馈', 5, 6], ['最新进展', 6, 6], ['下一步计划', 6, 6], ['附件分类', 4, 4],
];
/* 当前分类「项目状态」的选项：选项 / 启用 / 排序 / 修订 */
const OPTS = [
  ['在建', true, 10, 3], ['已完工', true, 20, 2], ['结算中', true, 30, 5],
  ['已决算', true, 40, 1], ['暂停', true, 50, 2], ['终止', false, 60, 4],
  ['待定', true, 70, 1], ['前期筹备', true, 80, 1], ['已送审', true, 90, 2], ['争议中', true, 100, 3],
];
/* 列宽合计必须 = 右栏内宽 920（CT_W 960 − padX 20×2）。
 * ⚠️ 原来按 960 排，表格右边框直接压到卡片描边上（多了 40px）。 */
const O_COLS = [
  { title: '选项', w: 390, lines: 1 },
  { title: '状态', w: 90, lines: 1 },
  { title: '排序', w: 80, align: 'RIGHT', lines: 1 },
  { title: '修订', w: 80, align: 'RIGHT', lines: 1 },
  { title: '操作', w: 280, lines: 1 },
];

function navRow(label, act, tot, on) {
  const r = row('nav·' + label, { w: NAV_IN, h: 40, padX: 12, gap: 8, cross: 'CENTER', radius: 8, fill: on ? C.brandSoft : null });
  add(r, text(label, { size: 12.5, weight: on ? 600 : 400, color: on ? C.brandText : C.inkSoft, w: 96 }), null);
  add(r, flex(), null);
  add(r, text(act + '/' + tot, { size: 11, weight: 500, color: on ? C.brandText : C.muted }), null);
  return r;
}

function optCell(r) {
  const [label, active] = r;
  const oc = row('oc', { gap: 6, cross: 'CENTER', main: 'MIN' });
  const small = { h: 26, padX: 10, size: 12 };
  const off = { h: 26, padX: 10, size: 12, fill: C.canvas, color: C.muted, stroke: C.line };
  add(oc, finBtn('编辑', 'secondary', active ? small : off), null);
  add(oc, finBtn('停用', active ? 'danger' : 'secondary', active ? small : off), null);
  if (!active) {
    const sel = row('迁移', { w: 96, h: 26, padX: 9, gap: 5, cross: 'CENTER', radius: 6, fill: C.surface, stroke: C.lineStrong, sw: 1 });
    add(sel, text('迁移到…', { size: 11.5, color: C.muted }), 'H');
    add(sel, text('▾', { size: 9, color: C.muted }), null);
    add(oc, sel, null);
  }
  return oc;
}

function a77() {
  const sh = finShell('77 · 业务字典', { active: 5, crumb: '业务字典' });
  const c = sh.content;

  add(c, finPageHead('业务字典',
    '维护业务中使用的分类值；改名会同步受影响的台账引用。',
    '所有变更均记录原因、修订号和审计信息',
    [finBtn('新增选项', 'primary')]), 'H');

  const lay = row('布局', { gap: 16, w: CW, cross: 'MIN' });

  // 左：分类导航
  const nav = col('分类导航', { gap: 4, w: NAV_W, fill: C.surface, radius: 14, stroke: C.line, sw: 1, padX: 12, padY: 12 });
  CATS.forEach(([label, a, t], i) => add(nav, navRow(label, a, t, i === 0), 'H'));
  add(lay, nav, 'V');

  // 右：当前类别
  const ct = col('类别内容', { gap: 12, w: CT_W, fill: C.surface, radius: 14, stroke: C.line, sw: 1, padX: 20, padY: 16 });
  const tb = row('类别工具栏', { gap: 12, w: CT_W - 40, cross: 'CENTER' });
  const tl = col('tl', { gap: 3 });
  add(tl, text('项目状态', { size: 15, weight: 600, color: C.ink }), null);
  add(tl, text('只管理当前类别，停用项可切换查看。', { size: 11.5, weight: 400, color: C.muted }), null);
  add(tb, tl, null);
  add(tb, flex(), null);
  const sr = row('搜索', { w: 200, h: 32, padX: 11, gap: 7, cross: 'CENTER', radius: 8, fill: C.surface, stroke: C.line, sw: 1 });
  add(sr, text('⌕', { size: 12.5, color: C.muted }));
  add(sr, text('搜索选项', { size: 12, color: C.muted }), 'H');
  add(tb, sr, null);
  const st = row('状态筛选', { w: 92, h: 32, padX: 11, gap: 6, cross: 'CENTER', radius: 8, fill: C.surface, stroke: C.lineStrong, sw: 1 });
  add(st, text('启用', { size: 12, color: C.ink }), 'H');
  add(st, text('▾', { size: 9, color: C.muted }), null);
  add(tb, st, null);
  add(ct, tb, 'H');

  add(ct, finTable(O_COLS, OPTS.map((r) => [r[0], finTag(r[1] ? '启用' : '停用', r[1] ? 'ok' : 'mute', { dot: false }), r[2], r[3], optCell(r)]), { rowH: 36 }), 'H');

  const pg = row('分页', { gap: 8, w: CT_W - 40, cross: 'CENTER' });
  add(pg, text('每页 20 条（单页时隐藏分页器）', { size: 11, weight: 400, color: C.muted }), null);
  add(pg, flex(), null);
  add(pg, text('共 10 条', { size: 11.5, weight: 500, color: C.inkSoft }), null);
  add(ct, pg, 'H');
  add(lay, ct, 'V');

  add(c, lay, 'H');
  add(c, flex(), 'H');
  add(c, text('改名走二次确认：「确认同步改名」/「“原值”将改为“新值”，并同步更新 N 条引用。」/「确认改名」；'
    + '成功后提示「改名完成，共更新 N 条引用」。停用行才出现「迁移到…」，选目标后弹「迁移引用」预览影响条数。'
    + '空态：当前类别没有匹配选项 / 当前类别暂无选项。',
  { size: 10.5, weight: 400, color: C.muted, w: CW, lh: 1.5 }), 'H');
  return sh.outer;
}

const y = yAfter('▣ 76', 240);
const put = stackAt(2720, y, 240);
const art = a77();
put(art);

return {
  分区: '财务应收 · C 区 · 77 业务字典',
  画板数: 1,
  清理旧画板: cleared,
  尺寸: FIN_W + 'x' + FIN_H,
  分类数: CATS.length,
  当前类别选项数: OPTS.length,
  左导航宽: NAV_W,
  右栏宽: CT_W,
  右栏内宽: CT_W - 40,
  列表合计宽: O_COLS.reduce((s, d) => s + d.w, 0),
  本区结束Y: put.end(),
};
