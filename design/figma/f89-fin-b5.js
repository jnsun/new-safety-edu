//!include ./_kit-fin.js

/* 财务应收 · B 区：65 导航与外壳
 * 依据 docs/design/财务应收视觉规范-v1.md §6.5 / §4.3
 * 菜单六项直接取自 receivablesNavigation() 的真实路由与中文名。 */

await loadFonts();
await useFinPage();

const W = 1120;
const CW = W - 88;              // 1032
const cleared = clearBoards(['▣ 65']);

const SIDE_W = 208;
const SIDE_H = 560;
const RIGHT_W = CW - SIDE_W - 24;   // 800

/* --------------------------- 局部构件 --------------------------- */
function td(colW, node, align, h) {
  const c = row('td', { w: colW, padX: 14, cross: 'CENTER', h: h != null ? h : 44 });
  if (align === 'CENTER') { add(c, flex()); add(c, node); add(c, flex()); }
  else if (align === 'FIT') add(c, node);
  else add(c, node, 'H');
  return c;
}

/**
 * 侧栏（1:1）。
 * activeIdx 选中（黄绿实底 + 墨绿字），hoverIdx 悬停（白 7% 叠加）。
 * 全站唯一允许黄绿大面积出现的地方 —— 它是「你现在在这里」的锚点。
 */
function sidebar(h, activeIdx, hoverIdx) {
  const s = col('side', { w: SIDE_W, h, fill: C.brandInk, gap: 0, clips: true });

  const br = row('brand', { w: SIDE_W, h: 60, padX: 16, gap: 10, cross: 'CENTER' });
  add(br, logoMark(26, { mono: '#FFFFFF' }));
  const bt = col('bt', { gap: 1 });
  add(bt, text('财务应收', { size: 13.5, weight: 700, color: C.onInk }));
  add(bt, text('账款管理', { size: 10, weight: 500, color: C.onInk3, ls: 0.5 }));
  add(br, bt);
  add(s, br, 'H');

  const mw = col('menu', { w: SIDE_W, gap: 2, padX: 12, padY: 12 });
  FIN_MENU.forEach(([icon, label], i) => {
    const on = i === activeIdx;
    const hov = i === hoverIdx;
    const it = row('m', {
      w: SIDE_W - 24, h: 40, padX: 12, gap: 10, radius: 8, cross: 'CENTER',
      fill: on ? C.accent : (hov ? C.white : null),
      fillOpacity: hov ? 0.07 : undefined,
    });
    /* ⚠️ 图标包一层固定 18px 容器、文字给固定 132px，两处都不能用 'H'。
     * 实测：若图标与文字都传 'H'，figma 会把 150px 内容区**均分**成两个 75px，
     * 6 个字的「应收账款看板」「财务归属部门」就会折成两行并溢出菜单项。 */
    const ic = row('ic', { w: 18, h: 18, cross: 'CENTER', main: 'CENTER' });
    add(ic, text(icon, { size: 13, weight: 500, color: on ? C.accentInk : C.onInk3 }));
    add(it, ic, null);
    add(it, text(label, { size: 13, weight: on ? 600 : 400, color: on ? C.accentInk : C.onInk2, w: 132 }), null);
    add(mw, it, 'H');
  });
  add(s, mw, 'H');
  add(s, flex(), 'H');

  const foot = row('foot', { w: SIDE_W, h: 56, padX: 16, gap: 10, cross: 'CENTER', fill: C.brandDeep });
  add(foot, dot(C.accent, 7));
  const fu = col('u', { gap: 1 });
  add(fu, text('张明 · 应收账款负责人', { size: 11, weight: 600, color: C.onInk, w: 160 }), 'H');
  add(fu, text('财务资产部', { size: 9.5, weight: 400, color: C.onInk3 }), 'H');
  add(foot, fu, 'H');
  add(s, foot, 'H');
  return s;
}

/** 顶栏。 */
function topbar(w) {
  const t = row('top', { w, h: 56, padX: 24, cross: 'CENTER', fill: C.surface });
  edgeLine(t, 'BOTTOM', C.line);
  const bc = row('bc', { gap: 8, cross: 'CENTER' });
  add(bc, text('应收账款', { size: 13, weight: 400, color: C.muted }), null);
  add(bc, text('/', { size: 13, weight: 400, color: C.line }), null);
  add(bc, text('应收账款台账', { size: 15, weight: 600, color: C.ink }), null);
  add(t, bc, null);
  add(t, flex(), null);
  const srch = row('srch', { w: 220, h: 32, padX: 11, gap: 8, radius: 8, cross: 'CENTER', fill: C.surfaceSoft, stroke: C.line, sw: 1 });
  add(srch, text('⌕', { size: 12.5, color: C.muted }));
  add(srch, text('搜索合同 / 项目 / 客户', { size: 12, color: C.muted }), 'H');
  add(t, srch, null);
  add(t, box(14, 1));
  add(t, dot(C.neutralSoft, 30), null);
  add(t, box(8, 1));
  add(t, text('张明', { size: 12.5, weight: 500, color: C.inkSoft }), null);
  return t;
}

/** 页头（ReceivablesPageHeader）。 */
function pageHead(w, title, desc, meta, actions) {
  const r = row('ph', { gap: 16, w, cross: 'CENTER' });
  const l = col('l', { gap: 5 });
  add(l, text(title, { size: 20, weight: 600, color: C.ink }), 'H');
  const sub = row('sub', { gap: 12, cross: 'CENTER' });
  add(sub, text(desc, { size: 12.5, weight: 400, color: C.muted }), null);
  if (meta) add(sub, text(meta, { size: 11.5, weight: 400, color: C.muted }), null);
  add(l, sub, 'H');
  add(r, l, 'H');
  add(r, flex(), null);
  const ar = row('ar', { gap: 10, cross: 'CENTER' });
  for (const a of actions) add(ar, a, null);
  add(r, ar, null);
  return r;
}

/* ---------------------------- 画板 ---------------------------- */
function a65Shell() {
  const b = board('65 · 导航与外壳',
    '侧栏 208px（比安全生产的 224 窄 16px）—— 台账 22 列、8 个 142px 金额列，'
    + '横向空间比导航舒适度更值钱。菜单项照抄 receivablesNavigation() 的六项与真实路由。', W, null);

  /* ---- 1. 三种状态的侧栏 ---- */
  add(b.body, sectionLabel('1 · 侧栏三种状态（1:1 绘制）', { color: C.brand }), 'H');
  const trio = row('trio', { gap: 20, w: CW, cross: 'MIN' });
  // [选中项索引, 悬停项索引]
  const CASES = [[0, -1], [1, 3]];
  add(trio, sidebar(SIDE_H, CASES[0][0], CASES[0][1]), null);
  add(trio, sidebar(SIDE_H, CASES[1][0], CASES[1][1]), null);

  const notes = col('notes', { gap: 14, w: CW - SIDE_W * 2 - 40 });
  for (const [t, d] of [
    ['品牌区 60px', '反白双环 logo 26px + 「财务应收 / 账款管理」两行，子标题用 on-ink-3（5.77:1）。'],
    ['菜单项 40px', '未选 on-ink-2；悬停白 7% 叠加；选中黄绿实底 + 墨绿字（10.30:1）。'],
    ['底部用户区 56px', '深一档 brand/deep 底 + 黄绿状态点。这里写财务归属部门，不是主系统组织。'],
  ]) {
    const c = col('n', { gap: 3, w: CW - SIDE_W * 2 - 40 });
    add(c, text(t, { size: 12, weight: 600, color: C.ink }), 'H');
    add(c, text(d, { size: 10.5, weight: 400, color: C.muted, w: CW - SIDE_W * 2 - 40, lh: 1.55 }), 'H');
    add(notes, c, 'H');
  }
  add(trio, notes, null);
  add(b.body, trio, 'H');

  /* ---- 2. 顶栏 + 页头 + 分段标题 ---- */
  add(b.body, sectionLabel('2 · 顶栏 · 页头 · 分段标题（右侧主区 ' + RIGHT_W + 'px）', { color: C.brand }), 'H');
  const main = col('main', { gap: 20, w: RIGHT_W, fill: C.canvas, radius: 12, stroke: C.line, sw: 1, clips: true });
  add(main, topbar(RIGHT_W), 'H');

  const body = col('body', { gap: 18, w: RIGHT_W, padX: 24, padY: 20 });
  add(body, pageHead(RIGHT_W - 48, '合同台账',
    '一行一合同；筛选、排序和分页均由服务端执行。', '默认显示未结合同',
    [finBtn('导出条件', 'secondary'), finBtn('新建台账', 'primary')]), 'H');
  // 分段标题（ReceivablesSectionTitle）：内联构造，省一个函数定义（脚本已接近 5 万上限）
  const stRow = row('st', { gap: 10, w: RIGHT_W - 48, cross: 'CENTER' });
  add(stRow, text('金额概览', { size: 14, weight: 600, color: C.ink }), null);
  add(stRow, text('按当前筛选范围汇总', { size: 11.5, weight: 400, color: C.muted }), null);
  add(stRow, flex(), null);
  add(stRow, finBtn('查看明细', 'ghost', { size: 12 }), null);
  add(body, stRow, 'H');
  const card = col('card', { gap: 10, w: RIGHT_W - 48, fill: C.surface, radius: 14, stroke: C.line, sw: 1, padX: 20, padY: 18 });
  add(card, text('顶栏高 56：左面包屑（末级 15px/600，前级 muted），右侧搜索 220px + 头像 30px + 用户名。',
    { size: 11.5, color: C.muted, w: RIGHT_W - 88, lh: 1.55 }), 'H');
  add(card, text('页头：标题 20px/600 + 说明 12.5px + meta 11.5px（同一行，12px 间距），右侧动作。'
    + 'meta 用来写「默认显示未结合同」这类当前口径。',
  { size: 11.5, color: C.muted, w: RIGHT_W - 88, lh: 1.55 }), 'H');
  add(body, card, 'H');
  add(main, body, 'H');
  add(b.body, main, 'H');

  const duo = row('duo', { gap: 24, w: CW, cross: 'MIN' });
  const p1 = finPanel({ w: 508, gap: 10, name: 'rules' });
  add(p1, text('侧栏与顶栏的边界规则', { size: 12, weight: 600, color: C.ink, w: 468 }), 'H');
  for (const s of [
    '侧栏无描边、无阴影 —— 靠色差分隔，不靠线',
    '顶栏只在底部画 1px line，不画右边框',
    '内容底色 canvas，卡片 surface，一级层次',
    '顶栏与内容区不做吸顶阴影，滚动时也不加',
  ]) {
    const r = row('i', { gap: 8, w: 468, cross: 'MIN' });
    add(r, text('·', { size: 12, weight: 700, color: C.brand }), null);
    add(r, text(s, { size: 11.5, weight: 400, color: C.inkSoft, w: 448, lh: 1.55 }), 'H');
    add(p1, r, 'H');
  }
  add(duo, p1);

  const p2 = finPanel({ w: CW - 532, gap: 10, name: 'menu' });
  add(p2, text('六个菜单项与真实路由', { size: 12, weight: 600, color: C.ink, w: CW - 572 }), 'H');
  for (const [icon, label, path] of FIN_MENU) {
    const r = row('m', { gap: 10, w: CW - 572, cross: 'CENTER', h: 26 });
    add(r, text(icon, { size: 12.5, weight: 500, color: C.inkSoft, w: 18 }), null);
    add(r, text(label, { size: 12, weight: 500, color: C.ink, w: 120 }), null);
    add(r, text(path, { size: 11, weight: 400, color: C.muted }), 'H');
    add(p2, r, 'H');
  }
  add(p2, text('菜单按权限动态生成，不是固定六项 —— 没有 canReadLedger 的账号看不到看板与台账。',
    { size: 10.5, color: C.muted, w: CW - 572, lh: 1.5 }), 'H');
  add(duo, p2);
  add(b.body, duo, 'H');

  return b.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const Y0 = yAfter('▣ 64', 200);
const put = stackAt(1360, Y0, 200);
put(a65Shell());

return {
  分区: '财务应收 · B 区 · 65 导航与外壳',
  画板数: 1,
  清理旧画板: cleared,
  菜单项数: FIN_MENU.length,
  起点Y: Y0,
  本区结束Y: put.end(),
};
