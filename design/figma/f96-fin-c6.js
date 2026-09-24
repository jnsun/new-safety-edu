//!include ./_kit-fin-c.js

/* 财务应收 · C 区：76 财务归属部门
 * 全部对齐 apps/admin/src/ReceivablesAdmin.tsx:
 *   :221 sectionCopy = 「财务归属部门」/「独立于主系统组织口径，作为财务数据授权与分组范围。」
 *   :228 ⚠️ departments 段**页头不带操作按钮**（actions 只在 grants/dictionaries 出现），
 *        唯一入口是工具栏右侧的「新增部门」（:282）
 *   :279 工具栏 = 「N 个部门」 :280 搜索「搜索名称或代码」 aria「搜索财务归属部门」
 *        :281 状态 Select 启用/停用/全部 :282 主按钮「新增部门」
 *   :285 表头 = 排序 / 部门名称 | 当前台账 | 授权人数 | 状态 | 操作
 *   :286 行 aria = 「{name}，{receivableCount} 笔应收账款，{accountCount} 个授权账号」
 *   :290 「N 笔」 :291 「N 人」 :292 Tag 启用/停用
 *   :294-296 操作 = 编辑 / 停用(danger) / 迁移引用（仅停用行 + 有管理权限时）
 *   :289 拖拽提示「拖拽或使用方向键调整顺序」/「清除搜索并切换到启用部门后可排序」
 *   :284 空态「没有匹配的财务归属部门」/「暂无财务归属部门」
 *   :119 停用需填原因；:123 成功提示「配置项已停用」
 * 领域事实来自 docs/receivables/CONTEXT.md:24-40：财务归属部门是**责任口径**，与单位（法人口径）正交；
 * 停用后保留历史但不再承接新台账；「翟悟飞」「孙勇军」是合法的个人独立核算归属主体。 */

await loadFonts();
await useFinPage();

const cleared = clearBoards(['▣ 76']);
const CW = FIN_CW;

/* [名称, 当前台账, 授权人数, 启用?, 停用?, 备注] */
const DEPTS = [
  ['财务资产部', 128, 6, true, false, ''],
  ['工程财务部', 84, 3, true, false, ''],
  ['综合管理部', 42, 2, true, false, ''],
  ['岩土工程部', 31, 2, true, false, ''],
  ['翟悟飞', 12, 1, true, false, '个人独立核算'],
  ['孙勇军', 8, 1, true, false, '个人独立核算'],
  ['原测绘经营部', 5, 0, false, false, '改名前的历史经营实体'],
  ['六勘院财务科', 0, 0, false, true, '已退出使用'],
];
const OPS_W = 268;
const CNT_W = 112;
const PER_W = 112;
const ST_W = 96;
const NAME_W = CW - OPS_W - CNT_W - PER_W - ST_W;
const ROWH = 58;

function hcell(t, w, align) {
  const c = row('th', { w, padX: 14, cross: 'CENTER', h: 36 });
  add(c, text(t, { size: 11.5, weight: 500, color: C.muted, w: w - 28, align: align || 'LEFT' }), 'H');
  return c;
}

function row76(r) {
  const [name, cnt, per, active, retired, note] = r;
  const it = row('dept', { w: CW, h: ROWH, gap: 0, cross: 'CENTER', fill: active ? C.surface : C.canvas });

  const nc = row('nc', { w: NAME_W, padX: 14, gap: 8, cross: 'CENTER' });
  add(nc, text('⠿', { size: 12, color: active ? C.muted : C.lineStrong }), null);
  const nt = col('nt', { gap: 3, w: NAME_W - 62 });
  add(nt, text(name, { size: 13, weight: 500, color: active ? C.ink : C.muted, w: NAME_W - 62 }), 'H');
  if (note) add(nt, text(note, { size: 10.5, weight: 400, color: C.muted, w: NAME_W - 62 }), 'H');
  add(nc, nt, null);
  add(it, nc, null);

  const cc = row('cc', { w: CNT_W, padX: 14, cross: 'CENTER' });
  add(cc, text(cnt + ' 笔', { size: 12.5, weight: cnt ? 500 : 400, color: cnt ? C.ink : C.muted, align: 'RIGHT', w: CNT_W - 28 }), 'H');
  add(it, cc, null);

  const pc = row('pc', { w: PER_W, padX: 14, cross: 'CENTER' });
  add(pc, text(per + ' 人', { size: 12.5, weight: per ? 500 : 400, color: per ? C.ink : C.muted, align: 'RIGHT', w: PER_W - 28 }), 'H');
  add(it, pc, null);

  const sc = row('sc', { w: ST_W, padX: 14, cross: 'CENTER' });
  add(sc, finTag(active ? '启用' : '停用', active ? 'ok' : 'mute', { dot: false }), null);
  add(it, sc, null);

  const oc = row('oc', { w: OPS_W, padX: 14, gap: 6, cross: 'CENTER', main: 'MIN' });
  const small = { h: 26, padX: 10, size: 12 };
  const smallOff = { h: 26, padX: 10, size: 12, fill: C.canvas, color: C.muted, stroke: C.line };
  add(oc, finBtn('编辑', 'secondary', active ? small : smallOff), null);
  add(oc, finBtn('停用', active ? 'danger' : 'secondary', active ? small : smallOff), null);
  if (!active) add(oc, finBtn('迁移引用', 'secondary', small), null);
  add(it, oc, null);

  return it;
}

function a76() {
  const sh = finShell('76 · 财务归属部门', { active: 4, crumb: '财务归属部门' });
  const c = sh.content;

  // ⚠️ 页头不带按钮 —— 新增入口在工具栏里（代码 :228 只给 grants/dictionaries 传 actions）。
  add(c, finPageHead('财务归属部门',
    '独立于主系统组织口径，作为财务数据授权与分组范围。',
    '所有变更均记录原因、修订号和审计信息'), 'H');

  const tb = row('工具栏', { gap: 12, w: CW, cross: 'CENTER', h: 40 });
  const tn = row('tn', { gap: 5, cross: 'CENTER' });
  add(tn, text('8', { size: 15, weight: 700, color: C.ink }), null);
  add(tn, text('个部门', { size: 12.5, weight: 400, color: C.muted }), null);
  add(tb, tn, null);
  add(tb, flex(), null);
  const sr = row('搜索', { w: 220, h: 32, padX: 11, gap: 7, cross: 'CENTER', radius: 8, fill: C.surface, stroke: C.line, sw: 1 });
  add(sr, text('⌕', { size: 12.5, color: C.muted }));
  add(sr, text('搜索名称或代码', { size: 12, color: C.muted }), 'H');
  add(tb, sr, null);
  const st = row('状态', { w: 96, h: 32, padX: 11, gap: 6, cross: 'CENTER', radius: 8, fill: C.surface, stroke: C.lineStrong, sw: 1 });
  add(st, text('启用', { size: 12, color: C.ink }), 'H');
  add(st, text('▾', { size: 9, color: C.muted }), null);
  add(tb, st, null);
  add(tb, finBtn('新增部门', 'primary'), null);
  add(c, tb, 'H');

  // 网格：表头 + 行，1px 分隔线
  const g = col('grid', { gap: 0, w: CW, radius: 12, stroke: C.line, sw: 1, clips: true, fill: C.surface });
  g.strokeAlign = 'OUTSIDE';
  const hd = row('表头', { w: CW, gap: 0, h: 36, fill: C.surfaceSoft, cross: 'CENTER' });
  add(hd, hcell('排序 / 部门名称', NAME_W), null);
  add(hd, hcell('当前台账', CNT_W, 'RIGHT'), null);
  add(hd, hcell('授权人数', PER_W, 'RIGHT'), null);
  add(hd, hcell('状态', ST_W), null);
  add(hd, hcell('操作', OPS_W), null);
  add(g, hd, 'H');
  DEPTS.forEach((r, i) => {
    const ln = tintBar(C.line, CW, 0);
    ln.resize(CW, 1);
    add(g, ln, 'H');
    add(g, row76(r), 'H');
  });
  add(c, g, 'H');

  add(c, flex(), 'H');
  add(c, text('停用需填「变更原因」，成功后提示「配置项已停用」；停用行保留原名称与历史台账归属，但不再承接新台账。'
    + '「迁移引用」只在停用行 + 有管理权限时出现，展开后选目标部门 → 弹窗「迁移引用」预览影响条数 →「确认应用迁移」。'
    + '排序仅在「启用 + 无搜索」时可用，提示「拖拽或使用方向键调整顺序」。',
  { size: 10.5, weight: 400, color: C.muted, w: CW, lh: 1.5 }), 'H');
  return sh.outer;
}

const y = yAfter('▣ 75', 240);
const put = stackAt(2720, y, 240);
const art = a76();
put(art);

const bb = art.absoluteBoundingBox;
return {
  分区: '财务应收 · C 区 · 76 财务归属部门',
  画板数: 1,
  清理旧画板: cleared,
  尺寸: FIN_W + 'x' + FIN_H,
  列宽: '名称 ' + NAME_W + ' / 台账 ' + CNT_W + ' / 人数 ' + PER_W + ' / 状态 ' + ST_W + ' / 操作 ' + OPS_W,
  列宽合计: NAME_W + CNT_W + PER_W + ST_W + OPS_W,
  部门数: DEPTS.length,
  停用数: DEPTS.filter((d) => !d[3]).length,
  本区结束Y: put.end(),
};
