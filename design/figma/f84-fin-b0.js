//!include ./_kit-fin.js

/* 财务应收 · B 区：60 按钮与操作
 * 依据 docs/design/财务应收视觉规范-v1.md §6.1 */

await loadFonts();
await useFinPage();

const W = 1120;
const CW = W - 88;              // 1032
const cleared = clearBoards(['▣ 60']);

/* 内阴影（按下态用）—— core 的 shadow() 只做 DROP_SHADOW，这里手写一个。 */
const inner = (h, a, y, blur) => ({
  type: 'INNER_SHADOW', color: rgba(h, a), offset: { x: 0, y }, radius: blur,
  spread: 0, visible: true, blendMode: 'NORMAL',
});

/* ---------------------------------------------------------------------------
 * 变体与交互态的完整规格
 * 「按下」统一 = 悬停底色 + 内阴影，不引入新颜色令牌 —— 少一个令牌就少一处走样。
 * 「禁用」一律用 canvas 底 + muted 字，**不降低透明度**：半透明在表格里看不清（§6.2）。
 * ------------------------------------------------------------------------- */
const VARIANTS = [
  ['primary', '保存台账', '主操作'],
  ['primary-dark', '导出下载', '深色区主操作'],
  ['secondary', '取消', '次要 / 取消'],
  ['ghost', '查看详情', '表内文字操作'],
  ['danger', '作废台账', '作废 / 撤销 / 回滚'],
];

const SPEC = {
  primary: {
    默认: {},
    悬停: { fill: C.accentStrong },
    按下: { fill: C.accentStrong, effects: [inner(C.brandInk, 0.18, 2, 4)] },
    禁用: { fill: C.canvas, color: C.muted },
  },
  'primary-dark': {
    默认: {},
    悬停: { fill: C.brandMid },
    按下: { fill: C.brandDeep, effects: [inner(C.black, 0.28, 2, 4)] },
    禁用: { fill: C.line, color: C.muted },
  },
  secondary: {
    默认: {},
    悬停: { fill: C.brandSoft, stroke: C.brandLine },
    按下: { fill: C.brandSoft, stroke: C.brand, effects: [inner(C.brandInk, 0.10, 2, 4)] },
    禁用: { fill: C.canvas, stroke: C.line, color: C.muted },
  },
  ghost: {
    默认: {},
    悬停: { fill: C.brandSoft },
    按下: { fill: C.brandSoft, effects: [inner(C.brandInk, 0.10, 2, 4)] },
    禁用: { color: C.muted },
  },
  danger: {
    默认: {},
    悬停: { fill: C.dangerSoft, stroke: C.danger, strokeOpacity: 1 },
    按下: { fill: C.dangerSoft, stroke: C.danger, strokeOpacity: 1, effects: [inner(C.danger, 0.16, 2, 4)] },
    禁用: { color: C.muted, stroke: C.line, strokeOpacity: 1 },
  },
};

const STATES = ['默认', '悬停', '按下', '禁用'];

/* --------------------------- 局部构件 --------------------------- */
function td(colW, node, align, h) {
  const c = row('td', { w: colW, padX: 14, cross: 'CENTER', h: h != null ? h : 54 });
  if (align === 'CENTER') { add(c, flex()); add(c, node); add(c, flex()); }
  else if (align === 'FIT') add(c, node);
  else add(c, node, 'H');
  return c;
}

/** 变体一览：按钮 + 名称 + 用途。 */
function variantCard(variant, label, use, w) {
  const c = col('vc', { gap: 8, w });
  const stage = row('stage', { w, h: 56, fill: C.surfaceSoft, radius: 8, cross: 'CENTER', main: 'CENTER' });
  // 不要给按钮传 fill 覆盖 —— 那会把 primary 的黄绿底也一起换掉。
  add(stage, finBtn(label, variant));
  add(c, stage, 'H');
  add(c, text(variant, { size: 11.5, weight: 600, color: C.ink, w }), 'H');
  add(c, text(use, { size: 10.5, weight: 400, color: C.muted, w, lh: 1.45 }), 'H');
  return c;
}

/** 图标按钮（28×28）。 */
function iconBtn(icon, state) {
  const spec = {
    idle: { fill: C.surface, stroke: C.lineStrong, color: C.inkSoft },
    hover: { fill: C.brandSoft, stroke: C.brandLine, color: C.brandText },
    disabled: { fill: C.canvas, stroke: C.line, color: C.muted },
  }[state || 'idle'];
  const r = row('ib', { w: 28, h: 28, radius: 8, cross: 'CENTER', main: 'CENTER', fill: spec.fill, stroke: spec.stroke, sw: 1 });
  add(r, text(icon, { size: 13, weight: 500, color: spec.color }));
  return r;
}

/* ---------------------------- 画板 ---------------------------- */
function a60Buttons() {
  const b = board('60 · 按钮与操作',
    '主按钮是全站最贵的一格视觉预算：黄绿底 + 墨绿字（10.30:1），一屏只允许出现一次。'
    + '两个黄绿按钮并排，用户就不知道该点哪个 —— 这条比配色本身更重要。', W, null);

  /* ---- 1. 五个变体 ---- */
  add(b.body, sectionLabel('1 · 五个变体', { color: C.brand }), 'H');
  const vRow = row('variants', { gap: 16, w: CW, cross: 'MIN' });
  const vw = (CW - 16 * 4) / 5;
  for (const [v, l, u] of VARIANTS) add(vRow, variantCard(v, l, u, vw), null);
  add(b.body, vRow, 'H');

  /* ---- 2. 尺寸三档 ---- */
  add(b.body, sectionLabel('2 · 尺寸三档：40 / 32 / 28', { color: C.brand }), 'H');
  const sizeRow = row('sizes', { gap: 24, w: CW, cross: 'MIN' });
  for (const [h, name, use] of [
    [40, '40px · 登录页 / 空态页', '整页只有一个操作的场景，做大才有「这就是唯一动作」的分量'],
    [32, '32px · 默认（工具栏 / 表单 / 页头）', '绝大多数按钮用这一档'],
    [28, '28px · 表格行内 / 密集操作区', '行内操作与同一行的高度对齐，不再额外撑高'],
  ]) {
    const c = col('sc', { gap: 6, w: (CW - 48) / 3 });
    const stage = row('stage', { w: (CW - 48) / 3, h: 62, fill: C.surfaceSoft, radius: 8, cross: 'CENTER', main: 'CENTER' });
    add(stage, finBtn('保存台账', 'primary', { h }));
    add(c, stage, 'H');
    add(c, text(name, { size: 12, weight: 600, color: C.ink, w: (CW - 48) / 3 }), 'H');
    add(c, text(use, { size: 10.5, weight: 400, color: C.muted, w: (CW - 48) / 3, lh: 1.45 }), 'H');
    add(sizeRow, c, null);
  }
  add(b.body, sizeRow, 'H');

  /* ---- 3. 交互四态矩阵 ---- */
  add(b.body, sectionLabel('3 · 交互四态（五个变体 × 默认 / 悬停 / 按下 / 禁用）', { color: C.brand }), 'H');
  const cw0 = 132;
  const cw1 = (CW - cw0) / 4;      // 225
  const t = col('t', { gap: 0, w: CW, radius: 12, stroke: C.line, sw: 1, clips: true, fill: C.surface });
  t.strokeAlign = 'OUTSIDE';

  const hd = row('thead', { w: CW, gap: 0, h: 40, cross: 'CENTER', fill: C.surfaceSoft });
  add(hd, td(cw0, text('变体', { size: 11.5, weight: 600, color: C.muted, w: cw0 - 28 }), 'LEFT', 40));
  for (const s of STATES) add(hd, td(cw1, text(s, { size: 11.5, weight: 600, color: C.muted, w: cw1 - 28 }), 'CENTER', 40));
  add(t, hd, 'H');

  VARIANTS.forEach(([v, label], i) => {
    const tr = row('tr', { w: CW, gap: 0, h: 54, cross: 'CENTER', fill: i % 2 ? C.surface : C.surfaceSoft });
    add(tr, td(cw0, text(v, { size: 11.5, weight: 600, color: C.ink, w: cw0 - 28 }), 'LEFT'));
    for (const s of STATES) {
      const o = SPEC[v][s];
      add(tr, td(cw1, finBtn(label, v, o), 'CENTER'));
    }
    add(t, tr, 'H');
    if (i < VARIANTS.length - 1) { const ln = tintBar(C.line, CW, 0); ln.resize(CW, 1); add(t, ln, 'H'); }
  });
  add(b.body, t, 'H');
  add(b.body, text('「按下」= 悬停底色 + 内阴影，刻意不为它单独加颜色令牌 —— 多一个令牌就多一处实现走样的机会。',
    { size: 10.5, color: C.muted, w: CW, lh: 1.55 }), 'H');

  /* ---- 4. 按钮组 ---- */
  add(b.body, sectionLabel('4 · 按钮组：主次顺序从右往左', { color: C.brand }), 'H');
  const groups = row('groups', { gap: 24, w: CW, cross: 'MIN' });
  const gw = (CW - 48) / 3;

  const g1 = finPanel({ w: gw, gap: 10, name: 'g1' });
  add(g1, text('表单底部：取消 + 主操作', { size: 11.5, weight: 600, color: C.ink, w: gw - 40 }), 'H');
  const r1 = row('r', { gap: 10, w: gw - 40, cross: 'CENTER' });
  add(r1, flex(), null);
  add(r1, finBtn('取消', 'secondary'), null);
  add(r1, finBtn('保存台账', 'primary'), null);
  add(g1, r1, 'H');

  const g2 = finPanel({ w: gw, gap: 10, name: 'g2' });
  add(g2, text('危险确认：取消 + 作废', { size: 11.5, weight: 600, color: C.ink, w: gw - 40 }), 'H');
  const r2 = row('r', { gap: 10, w: gw - 40, cross: 'CENTER' });
  add(r2, flex(), null);
  add(r2, finBtn('取消', 'secondary'), null);
  add(r2, finBtn('确认作废', 'danger'), null);
  add(g2, r2, 'H');

  const g3 = finPanel({ w: gw, gap: 10, name: 'g3' });
  add(g3, text('表格工具栏：导出 + 新建', { size: 11.5, weight: 600, color: C.ink, w: gw - 40 }), 'H');
  const r3 = row('r', { gap: 10, w: gw - 40, cross: 'CENTER' });
  add(r3, flex(), null);
  add(r3, finBtn('导出条件', 'secondary'), null);
  add(r3, finBtn('新建台账', 'primary'), null);
  add(g3, r3, 'H');

  add(groups, g1, null); add(groups, g2, null); add(groups, g3, null);
  add(b.body, groups, 'H');

  /* ---- 5. 图标按钮与加载态 ---- */
  add(b.body, sectionLabel('5 · 图标按钮 · 加载态', { color: C.brand }), 'H');
  const last = row('last', { gap: 24, w: CW, cross: 'MIN' });

  const lp = finPanel({ w: 508, gap: 12, name: 'icons' });
  add(lp, text('图标按钮 28 × 28（表格工具栏、卡片右上角）', { size: 11.5, weight: 600, color: C.ink, w: 468 }), 'H');
  const ir = row('ir', { gap: 10, w: 468, cross: 'CENTER' });
  add(ir, iconBtn('⟳'), null);
  add(ir, iconBtn('⇩'), null);
  add(ir, iconBtn('⛃'), null);
  add(ir, iconBtn('⋯'), null);
  add(ir, box(12, 1));
  add(ir, iconBtn('⟳', 'hover'), null);
  add(ir, iconBtn('⇩', 'hover'), null);
  add(ir, box(12, 1));
  add(ir, iconBtn('⟳', 'disabled'), null);
  add(ir, iconBtn('⇩', 'disabled'), null);
  add(lp, ir, 'H');
  add(lp, text('左：静止　中：悬停（brand/soft 底）　右：禁用。图标本身用 16px 图标字体实现，'
    + '这里用 Unicode 字形占位，尺寸按 13px 排。', { size: 10.5, color: C.muted, w: 468, lh: 1.55 }), 'H');
  add(last, lp);

  const rp2 = finPanel({ w: CW - 532, gap: 12, name: 'loading' });
  add(rp2, text('加载态：禁用按钮 + 文案说明，不做全屏遮罩', { size: 11.5, weight: 600, color: C.ink, w: CW - 572 }), 'H');
  const lr = row('lr', { gap: 12, w: CW - 572, cross: 'CENTER' });
  add(lr, finBtn('⟳  保存中…', 'primary', { fill: C.accentSoft, color: C.brandText }), null);
  add(lr, finBtn('保存台账', 'primary', { fill: C.canvas, color: C.muted }), null);
  add(rp2, lr, 'H');
  add(rp2, text('提交期间按钮转「加载中」并禁用，避免重复提交；不做全屏遮罩 —— '
    + '财务录入表很长，遮住整屏会让用户丢失当前位置。', { size: 10.5, color: C.muted, w: CW - 572, lh: 1.55 }), 'H');
  add(last, rp2);
  add(b.body, last, 'H');

  add(b.body, finNote('危险操作不做红色实底按钮。财务界面里一片红会让人以为「事情已经发生了」，'
    + '而作废、回滚其实都还能取消 —— 所以用白底红字 + 30% 红描边，语气是「这是一个选择」而不是「这是结果」。', 'warn', CW), 'H');

  return b.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const Y0 = 0;
const put = stackAt(1360, Y0, 200);
put(a60Buttons());

return {
  分区: '财务应收 · B 区 · 60 按钮与操作',
  画板数: 1,
  清理旧画板: cleared,
  变体数: VARIANTS.length,
  交互态数: STATES.length,
  起点: 'x=1360 y=' + Y0,
  本区结束Y: put.end(),
};
