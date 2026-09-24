//!include ./_kit-fin-c.js

/* 财务应收 · C 区：75 账号与权限
 * 全部对齐 apps/admin/src/ReceivablesAdmin.tsx:
 *   :218 sectionCopy.title/description = 「账号与权限」/「按财务归属部门配置数据范围，并为人员单独设置业务能力。」
 *   :227 meta = 「所有变更均记录原因、修订号和审计信息」
 *   :217 createLabel = 「新建授权」
 *   :232 Card「报账员全局可编辑字段」+ 说明「只有负责人可维护。个人授权只能从此白名单继续缩小，
 *       金额、开票、回款、核销和权限字段永远不可选择。」（仅负责人可见）
 *   :234 工作台 = 左 directory + 右 detail（.receivables-grant-workbench）
 *   :237 搜索 placeholder「搜索姓名、账号或部门」 :238 「N 个授权账号」
 *   :241 空态「没有匹配的授权账号」/「暂无财务授权」
 *   :242-244 列表项 = 头像首字 + 姓名 + 「username · 主部门」 + Tag 有效/撤销
 *   :251-252 详情头 = 姓名 + 「username · 主部门」 + [编辑][撤销]
 *   :255-258 四格摘要 = 角色 / 数据范围 / 账号状态 / 授权状态
 *   :256 数据范围取值 =「全模块管理」/「查看全部部门」/「N 个财务部门」
 *   :257 账号状态 = 已激活 / 待激活 / 尚未开通
 *   :114 roleLabels = admin 财务管理员 / reporter 报账员 / readonly 只读人员
 *   :261 「部门数据范围」 :262 admin → Alert「财务管理员拥有全模块管理权限」/ 空 →「尚未配置部门范围」
 *   :264 每行部门右侧 Tag 可读 / 可写
 *   :268 「业务能力」6 项：新建台账 / 编辑基础信息 / 维护催收 / 上传附件 / 导出数据 / 查看全部
 *   :273 空态「请选择一个授权账号」 :157 「当前账号没有此项管理权限」 */

await loadFonts();
await useFinPage();

const cleared = clearBoards(['▣ 75']);
const CW = FIN_CW;                    // 1184 = main(1232) − 内容区 padX 24×2
const AW = 336;                       // 左侧授权目录宽
const DW = CW - AW - 16;              // 832 详情宽
const AI = AW - 28;                   // 308 目录卡内宽
const DI = DW - 28;                   // 804 详情卡内宽

const WHITELIST = ['项目名称', '客户名称', '客户类型', '债权单位', '工作性质', '行业'];
/* 第四个元素是「当前选中」（对应 .is-active），第 3 个是授权是否有效。
 * ⚠️ 两者不是一个东西：只有被选中的那一行有浅绿底，但 6 行的授权状态可能都是「有效」。 */
const ACCOUNTS = [
  ['张明', 'zhangming · 财务资产部', true, false],
  ['李工', 'ligong · 工程财务部', true, true],
  ['王芳', 'wangfang · 财务资产部', true, false],
  ['赵强', 'zhaoqiang · 综合管理部', true, false],
  ['孙倩', '账号待激活 · 财务资产部', true, false],
  ['周涛', 'zhoutao · 工程财务部', false, false],
];
const SCOPES = [['工程财务部', true, true], ['财务资产部', true, false]];
const SKILLS = [
  ['新建台账', true], ['编辑基础信息', true], ['维护催收', false],
  ['上传附件', false], ['导出数据', true], ['查看全部', false],
];

/** 单行省略。Figma 没有 CSS 的 text-overflow，等价物是 textTruncation + maxLines。
 *  ⚠️ kit 的 text() 没有 trunc 选项 —— 传进去会被静默忽略，长文本照样折行撑破行高。 */
function clip(node) {
  node.textTruncation = 'ENDING';
  node.maxLines = 1;
  return node;
}

/** 头像：姓名首字。 */
function avatar(ch, size) {
  const r = row('头像', { w: size, h: size, radius: 999, cross: 'CENTER', main: 'CENTER', fill: C.brandSoft });
  add(r, text(ch, { size: 12, weight: 600, color: C.brandText }));
  return r;
}

/** 四格摘要。 */
function stat4(items, w) {
  const r = row('stat4', { gap: 10, w, cross: 'MIN' });
  const cw = (w - 30) / 4;
  for (const [k, v] of items) {
    const c = col('st', { gap: 5, w: cw, fill: C.canvas, radius: 10, padX: 14, padY: 10 });
    add(c, text(k, { size: 11, weight: 400, color: C.muted }), 'H');
    add(c, text(v, { size: 14, weight: 600, color: C.ink, w: cw - 28 }), 'H');
    add(r, c, null);
  }
  return r;
}

/** 键值行组：用于部门数据范围 / 业务能力。 */
function kvRows(rows, w) {
  const t = col('kvr', { gap: 0, w, radius: 10, stroke: C.line, sw: 1, clips: true, fill: C.surface });
  t.strokeAlign = 'OUTSIDE';
  rows.forEach((r, i) => {
    if (i > 0) {
      const ln = tintBar(C.line, w, 0);
      ln.resize(w, 1);
      add(t, ln, 'H');
    }
    add(t, r, 'H');
  });
  return t;
}

function skillRow(label, on, w) {
  const r = row('sk', { w, h: 34, padX: 14, cross: 'CENTER' });
  add(r, text(label, { size: 12.5, weight: 400, color: C.ink }), null);
  add(r, flex(), null);
  add(r, finTag(on ? '已允许' : '未允许', on ? 'ok' : 'mute', { dot: false }), null);
  return r;
}

function scopeRow(label, canRead, canWrite, w) {
  const r = row('sc', { w, h: 34, padX: 14, gap: 6, cross: 'CENTER' });
  add(r, text(label, { size: 12.5, weight: 500, color: C.ink }), null);
  add(r, flex(), null);
  if (canRead) add(r, finTag('可读', 'info', { dot: false }), null);
  if (canWrite) add(r, finTag('可写', 'ok', { dot: false }), null);
  return r;
}

/* ----------------------------- 画板 ----------------------------- */
function a75() {
  const sh = finShell('75 · 账号与权限', { active: 3, crumb: '账号与权限' });
  const c = sh.content;

  add(c, finPageHead('账号与权限',
    '按财务归属部门配置数据范围，并为人员单独设置业务能力。',
    '所有变更均记录原因、修订号和审计信息',
    [finBtn('新建授权', 'primary')]), 'H');

  // 白名单卡（仅负责人可见）
  const wl = col('白名单', { gap: 8, w: CW, fill: C.surface, radius: 14, stroke: C.line, sw: 1, padX: 20, padY: 14 });
  add(wl, text('报账员全局可编辑字段', { size: 14, weight: 600, color: C.ink }), 'H');
  add(wl, text('只有负责人可维护。个人授权只能从此白名单继续缩小，金额、开票、回款、核销和权限字段永远不可选择。',
    { size: 11.5, weight: 400, color: C.muted, w: CW - 40 }), 'H');
  const sel = row('多选', { gap: 7, padX: 11, padY: 7, w: CW - 40, wrap: true, radius: 8, fill: C.surface, stroke: C.lineStrong, sw: 1 });
  for (const t of WHITELIST) add(sel, finTag(t + ' ✕', 'brand', { dot: false, padX: 8 }), null);
  add(sel, finTag('+10', 'mute', { dot: false, padX: 8 }), null);
  add(wl, sel, 'H');
  add(c, wl, 'H');

  const wb = row('工作台', { gap: 16, w: CW, cross: 'MIN' });

  // ---- 左：授权目录 ----
  const as = col('目录', { gap: 10, w: AW, fill: C.surface, radius: 14, stroke: C.line, sw: 1, padX: 14, padY: 14 });
  const sr = row('搜索', { w: AI, h: 32, padX: 11, gap: 7, cross: 'CENTER', radius: 8, fill: C.surfaceSoft, stroke: C.line, sw: 1 });
  add(sr, text('⌕', { size: 12.5, color: C.muted }));
  add(sr, text('搜索姓名、账号或部门', { size: 12, color: C.muted }), 'H');
  add(as, sr, 'H');
  add(as, text('6 个授权账号', { size: 11.5, weight: 400, color: C.muted }), 'H');

  ACCOUNTS.forEach(([name, meta, active, on]) => {
    const it = row('acc', { gap: 10, w: AI, h: 56, padX: 10, cross: 'CENTER', radius: 10, fill: on ? C.brandSoft : null });
    add(it, avatar(name.slice(0, 1), 28), null);
    /* 可用宽 = 288 − 头像 28 − gap 10 − 标签约 46 − gap 10 = 194。
     * 文字给 178 并强制单行省略：「zhangming · 财务资产部」有 20 字符，
     * 不截断会折成两行把 56px 的行撑破。 */
    const tx = col('tx', { gap: 3, w: 178 });
    add(tx, clip(text(name, { size: 12.5, weight: 600, color: C.ink, w: 178 })), 'H');
    add(tx, clip(text(meta, { size: 10.5, weight: 400, color: C.muted, w: 178 })), 'H');
    add(it, tx, null);
    add(it, flex(), null);
    add(it, finTag(active ? '有效' : '撤销', active ? 'ok' : 'mute', { dot: false }), null);
    add(as, it, 'H');
  });
  add(as, flex(), 'H');
  add(as, text('空态：没有匹配的授权账号 / 暂无财务授权', { size: 10.5, weight: 400, color: C.muted, w: AI }), 'H');
  add(wb, as, 'V');

  // ---- 右：详情 ----
  const dt = col('详情', { gap: 16, w: DW, fill: C.surface, radius: 14, stroke: C.line, sw: 1, padX: 14, padY: 16 });
  const dh = row('详情头', { gap: 10, w: DI, cross: 'CENTER' });
  const dhl = col('dhl', { gap: 3 });
  add(dhl, text('李工', { size: 17, weight: 600, color: C.ink }), null);
  add(dhl, text('ligong · 工程财务部', { size: 12, weight: 400, color: C.muted }), null);
  add(dh, dhl, null);
  add(dh, flex(), null);
  add(dh, finBtn('编辑', 'secondary', { h: 28, padX: 12, size: 12 }), null);
  add(dh, finBtn('撤销', 'danger', { h: 28, padX: 12, size: 12 }), null);
  add(dt, dh, 'H');

  add(dt, stat4([['角色', '报账员'], ['数据范围', '2 个财务部门'], ['账号状态', '已激活'], ['授权状态', '有效']], DI), 'H');

  const s1 = col('s1', { gap: 8, w: DI });
  add(s1, text('部门数据范围', { size: 13.5, weight: 600, color: C.ink }), 'H');
  add(s1, kvRows(SCOPES.map(([n, r, w]) => scopeRow(n, r, w, DI)), DI), 'H');
  add(dt, s1, 'H');

  const s2 = col('s2', { gap: 8, w: DI });
  add(s2, text('业务能力', { size: 13.5, weight: 600, color: C.ink }), 'H');
  add(s2, kvRows([skillRow(SKILLS[0][0], SKILLS[0][1], DI), skillRow(SKILLS[1][0], SKILLS[1][1], DI),
    skillRow(SKILLS[2][0], SKILLS[2][1], DI), skillRow(SKILLS[3][0], SKILLS[3][1], DI),
    skillRow(SKILLS[4][0], SKILLS[4][1], DI), skillRow(SKILLS[5][0], SKILLS[5][1], DI)], DI), 'H');
  add(dt, s2, 'H');

  add(dt, flex(), 'H');
  add(dt, text('admin 角色时「部门数据范围」显示提示条「财务管理员拥有全模块管理权限」，'
    + '未配置时显示「尚未配置部门范围」；未选中账号显示「请选择一个授权账号」。'
    + '非 owner 不能管理「财务管理员」授权，按钮置灰并提示「只有财务资产部负责人可以管理财务管理员」。',
  { size: 10.5, weight: 400, color: C.muted, w: DI, lh: 1.5 }), 'H');
  add(wb, dt, 'V');

  add(c, wb, 'B');
  return { outer: sh.outer, dt: dt, as: as };
}

const y = yAfter('▣ 74', 240);
const put = stackAt(2720, y, 240);
const made = a75();
const art = made.outer;
put(art);

const bbArt = art.absoluteBoundingBox;
const bbDt = made.dt.absoluteBoundingBox;
return {
  分区: '财务应收 · C 区 · 75 账号与权限',
  画板数: 1,
  清理旧画板: cleared,
  尺寸: FIN_W + 'x' + FIN_H,
  左目录宽: AW,
  右详情宽: DW,
  授权账号: ACCOUNTS.length,
  业务能力项: SKILLS.length,
  详情底边Y: Math.round(bbDt.y + bbDt.height - bbArt.y),
  本区结束Y: put.end(),
};
