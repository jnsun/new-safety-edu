//!include ./_kit-fin.js

/* 财务应收 · A 区：53 形状与空间
 * 依据 docs/design/财务应收视觉规范-v1.md §4.1 / §4.2 / §4.3 / §4.4 */

await loadFonts();
await useFinPage();

const W = 1120;
const CW = W - 88;              // 1032
const cleared = clearBoards(['▣ 53']);

/* ------------------------------ 数据 ------------------------------ */
const RADII = [
  [14, 'radius/card', '--fin-r-card', '卡片、面板'],
  [10, 'radius/panel', '--fin-r-panel', '内嵌区块、筛选条'],
  [8, 'radius/control', '--fin-r-control', '按钮、输入框、下拉'],
  [6, 'radius/tile', '--fin-r-tile', '状态标签、色块'],
  [999, 'radius/pill', '--fin-r-pill', '胶囊筛选、状态点'],
];

const SPACES = [
  [4, 'space/xs', '--fin-space-xs', '基础单位：图标与文字之间'],
  [8, 'space/sm', '--fin-space-sm', '紧凑间距：标签内部、按钮内左右'],
  [12, 'space/md', '--fin-space-md', '组件内间距：表头与单元格、按钮组'],
  [16, 'space/lg', '--fin-space-lg', '卡片之间、区块之间'],
  [20, 'space/xl', '--fin-space-xl', '卡片内边距'],
  [24, 'space/2xl', '--fin-space-2xl', '页面左右内边距'],
  [32, 'space/3xl', '--fin-space-3xl', '大区块分隔'],
  [40, 'space/4xl', '--fin-space-4xl', '画板边距'],
  [48, 'space/5xl', '--fin-space-5xl', '最大分隔'],
];

/* --------------------------- 局部构件 --------------------------- */
/** 圆角样例卡。
 *  演示块统一 84×84（pill 用 84×34）—— 若让块尺寸随圆角变化，就分不清「看起来方」
 *  是因为圆角小还是因为块本身小。 */
function radiusCard(v, name, cssVar, use, w) {
  const c = col('rc', { gap: 10, w });
  const stage = row('stage', { w, h: 100, fill: C.surfaceSoft, radius: 8, cross: 'CENTER', main: 'CENTER' });
  const isPill = v >= 100;
  add(stage, frame('box', {
    w: 84, h: isPill ? 34 : 84,
    radius: v, fill: C.brandSoft, stroke: C.brandLine, sw: 1,
  }));
  add(c, stage, 'H');
  add(c, text(name, { size: 11.5, weight: 600, color: C.ink }), 'H');
  add(c, text(v >= 100 ? '999（全圆）' : v + 'px', { size: 12, weight: 500, color: C.brandText }), 'H');
  add(c, text(cssVar, { size: 10, weight: 400, color: C.muted }), 'H');
  add(c, text(use, { size: 10.5, weight: 400, color: C.muted, w, lh: 1.45 }), 'H');
  return c;
}

/** 间距样例行。条长按 3 倍放大，否则 4px 看不见。
 *  ⚠️ 条的「轨道」宽度固定 150 —— 若让条本身撑开行，各行的说明列会左右乱跳；
 *  另外最后说明列用 'H' 吃掉剩余宽度，前面几列的宽和必须留够余量。
 *  ⚠️ 别写 sr.padX：那只是给 JS 对象加了个无用属性，Figma 里没有这个 setter。 */
function spaceRow(v, name, cssVar, use, w) {
  const r = row('sr', { gap: 16, w, cross: 'CENTER', h: 26 });
  add(r, text(String(v), { size: 12, weight: 600, color: C.ink, w: 26, align: 'RIGHT' }), null);
  add(r, text('px', { size: 10.5, color: C.muted, w: 16 }), null);
  const track = frame('track', { dir: 'NONE', w: 150, h: 8 });
  const bar = frame('bar', { dir: 'NONE', w: Math.round(v * 3), h: 8, radius: 2, fill: C.brand });
  bar.x = 0; bar.y = 0;
  add(track, bar);
  add(r, track, null);
  add(r, text(name, { size: 11, weight: 500, color: C.inkSoft, w: 150 }), null);
  add(r, text(cssVar, { size: 10, color: C.muted, w: 130 }), null);
  add(r, text(use, { size: 10.5, color: C.muted, lh: 1.4 }), 'H');
  return r;
}

/** 阴影样例卡（放在 canvas 底上才看得见）。
 *  ⚠️ frame() 的 o.effects 必须是**数组** —— 把单个 effect 对象直接传进去会报
 *  "Expected array, received object"，且是在跑到这一步时才炸（前面已画的节点会残留）。 */
function shadowCard(title, styleName, effects, w) {
  const c = col('sh', { gap: 8, w });
  const stage = row('stage', { w, h: 118, fill: C.canvas, radius: 10, cross: 'CENTER', main: 'CENTER' });
  add(stage, frame('card', {
    w: w - 56, h: 72, radius: 14, fill: C.surface,
    effects: Array.isArray(effects) ? effects : [effects],
  }), null);
  add(c, stage, 'H');
  add(c, text(styleName, { size: 11.5, weight: 600, color: C.ink }), 'H');
  add(c, text(title, { size: 10.5, weight: 400, color: C.muted, w, lh: 1.45 }), 'H');
  return c;
}

/** 1440×900 后台骨架图（按 0.717 缩放绘制，标注为真实 px）。
 *
 *  ⚠️ 两个坑：
 *  1) 标注文字必须在色块**之后** add —— figma 按插入顺序叠放，先插的文字会被
 *     后插的不透明色块整个盖住（第一版就是这么消失的）。
 *  2) 12 列网格条不能用 accent 黄绿。黄绿对白只有 1.42:1，一排在白底上糊成一片
 *     刺眼的黄，既看不清也不符合规范（黄绿只允许出现在深色底上）。
 */
function gridMap() {
  const S = CW / FIN_W;
  const sc = (v) => Math.round(v * S * 100) / 100;
  const GH = Math.round(FIN_H * S);
  const g = frame('gridMap', { dir: 'NONE', w: CW, h: GH, radius: 10, fill: C.canvas, clips: true, stroke: C.line, sw: 1 });

  const sideW = sc(FIN_SIDE);
  const side = frame('side', { dir: 'NONE', w: sideW, h: GH, fill: C.brandInk });
  side.x = 0; side.y = 0; add(g, side);
  const topH = sc(FIN_TOP);
  const top = frame('top', { dir: 'NONE', w: CW - sideW, h: topH, fill: C.surface });
  top.x = sideW; top.y = 0; add(g, top);
  edgeLine(top, 'BOTTOM', C.line, 1);

  const px = sc(FIN_PADX);
  const x0 = sideW + px;
  const cw = sc(FIN_CW);
  const gapS = sc(20);
  let y = topH + sc(20);

  const label = (str, tx, ty, w) => {
    const t = text(str, { size: 9.5, weight: 500, color: C.muted, w });
    t.x = tx; t.y = ty;
    add(g, t);
  };

  // 12 列网格示意
  const gcolW = (cw - gapS * 11) / 12;
  for (let i = 0; i < 12; i++) {
    const c = frame('grid' + i, { dir: 'NONE', w: gcolW, h: 20, radius: 3, fill: C.brandSoft, stroke: C.brandLine, sw: 1 });
    c.x = x0 + i * (gcolW + gapS); c.y = y; add(g, c);
  }
  label('12 列 · 列间距 20 · 列宽自适应', x0, y + 24, 400);
  // 20（条高）+ 44 → 给 y+24 起的标注文字留足一行的高度，否则下一段的页头块会压上来
  y += 20 + sc(44);

  // 页头
  const head = frame('head', { dir: 'NONE', w: cw, h: 28, radius: 6, fill: C.surface, stroke: C.line, sw: 1 });
  head.x = x0; head.y = y; add(g, head);
  label('页头：标题 20 / 说明 12.5 / 右侧动作按钮 32', x0 + 10, y + 8, cw - 20);
  y += 28 + sc(12);

  // KPI × 4
  const kw = (cw - gapS * 3) / 4;
  for (let i = 0; i < 4; i++) {
    const k = frame('kpi' + i, { dir: 'NONE', w: kw, h: 66, radius: 6, fill: C.surface, stroke: C.line, sw: 1 });
    k.x = x0 + i * (kw + gapS); k.y = y; add(g, k);
    label('KPI', x0 + i * (kw + gapS) + 8, y + 8, kw - 16);
  }
  y += 66 + sc(12);

  // 数据表格：表头色带 + 行分隔线
  const th = GH - y - sc(16);
  const tf = frame('table', { dir: 'NONE', w: cw, h: th, radius: 6, fill: C.surface, stroke: C.line, sw: 1, clips: true });
  tf.x = x0; tf.y = y; add(g, tf);
  const hb = frame('thband', { dir: 'NONE', w: cw, h: 26, fill: C.surfaceSoft });
  hb.x = 0; hb.y = 0; add(tf, hb);
  for (let i = 1; i <= 5; i++) {
    if (26 + i * 24 > th - 4) break;
    const ln = frame('ln' + i, { dir: 'NONE', w: cw, h: 1, fill: C.line });
    ln.x = 0; ln.y = 26 + i * 24; add(tf, ln);
  }
  label('数据表格：表头 40 / 行高 36 / 22 列固定列宽 / 冻结列右侧 1px 分隔', x0 + 10, y + 8, cw - 20);

  return { node: g, h: GH };
}

/* ---------------------------- 画板 ---------------------------- */
function a53Shape() {
  const b = board('53 · 形状与空间',
    '圆角比安全生产那套整体小 2px —— 财务界面元素密度高，圆角一大就显得松散。'
    + '所有尺寸都来自 4 的倍数栅格，不允许出现 7px、13px 这类「手感值」。', W, null);

  /* ---- 1. 圆角 ---- */
  add(b.body, sectionLabel('1 · 圆角 5 档', { color: C.brand }), 'H');
  const rw = (CW - 20 * 4) / 5;
  const rRow = row('radii', { gap: 20, w: CW, cross: 'MIN' });
  for (const [v, name, cssVar, use] of RADII) add(rRow, radiusCard(v, name, cssVar, use, rw), null);
  add(b.body, rRow, 'H');

  /* ---- 2. 间距 ---- */
  add(b.body, sectionLabel('2 · 间距 9 档：用语义名，不写裸数字', { color: C.brand }), 'H');
  const spPanel = finPanel({ w: CW, gap: 0, name: 'spaces', padY: 14 });
  SPACES.forEach(([v, name, cssVar, use], i) => {
    const sr = spaceRow(v, name, cssVar, use, CW - 40);
    sr.fills = [solid(i % 2 ? C.surface : C.surfaceSoft)];
    add(spPanel, sr, 'H');
  });
  add(b.body, spPanel, 'H');
  add(b.body, text('上条按 ×3 放大绘制（4px 的条按原尺寸看不见）。CSS 变量名与 Figma 数值变量一一对应。',
    { size: 10.5, color: C.muted, w: CW }), 'H');

  /* ---- 3. 阴影与描边 ---- */
  add(b.body, sectionLabel('3 · 阴影 2 档 · 描边 3 种', { color: C.brand }), 'H');
  const shRow = row('shadows', { gap: 24, w: CW, cross: 'MIN' });
  const shw = 300;
  add(shRow, shadowCard('常规卡片。极轻，只用来把卡片从 canvas 底上「抬起来」一点。',
    'Fin Elevation/Card', SH.elevation, shw), null);

  const strokeCol = col('strokes', { gap: 12, w: CW - shw - 24 });
  const STROKES = [
    [C.line, 1, 'neutral/line', '表格分隔线、卡片描边 —— 1px，最轻一档'],
    [C.lineStrong, 1, 'neutral/line-strong', '输入框边、冻结列右侧分隔线 —— 收紧一档'],
    [C.warning, 3, 'semantic/warning', '异常行左侧 3px 橙条：超收 / 核销待调减 / 决算未定'],
  ];
  for (const [color, wt, name, use] of STROKES) {
    const r = row('st', { gap: 14, w: CW - shw - 24, cross: 'CENTER' });
    // 底色用 canvas 而不是 surface —— 前两档描边本身就很浅（#E2E8E6 / #D5DEDB），
    // 画在白底白块上根本看不见，等于没演示。
    const demo = frame('demo', { w: 116, h: 34, radius: 6, fill: C.canvas });
    if (wt === 3) edgeLine(demo, 'LEFT', color, 3);
    else { demo.strokes = [solid(color)]; demo.strokeWeight = wt; demo.strokeAlign = 'INSIDE'; }
    add(r, demo, null);
    const cc = col('c', { gap: 1 });
    add(cc, text(name, { size: 11.5, weight: 600, color: C.ink }), 'H');
    add(cc, text(use, { size: 10.5, color: C.muted, w: CW - shw - 24 - 130, lh: 1.45 }), 'H');
    add(r, cc, 'H');
    add(strokeCol, r, 'H');
  }
  add(shRow, strokeCol);
  add(b.body, shRow, 'H');

  /* ---- 4. 栅格骨架 ---- */
  add(b.body, sectionLabel('4 · 1440 × 900 后台骨架', { color: C.brand }), 'H');
  const gm = gridMap();
  add(b.body, gm.node, 'H');
  add(b.body, text('上图按 ' + (CW / FIN_W).toFixed(3) + ' 缩放绘制，括号外为比例值、下方为真实 px。'
    + '　1440 × 900　|　侧栏 208　|　顶栏 56　|　内容 1184 = 1440 − 208 − 24 × 2　|　12 列，列间距 20，列宽自适应',
  { size: 11, weight: 500, color: C.inkSoft, w: CW, lh: 1.6 }), 'H');

  add(b.body, finNote('侧栏取 208 而不是安全生产那套的 224：台账有 22 列、其中 6 列是 142px 的金额列，'
    + '横向空间比导航舒适度更值钱。菜单项固定 40px 高、图标 13px，选中态是黄绿实底 + 墨绿字（10.30:1），'
    + '这是全站唯一允许黄绿大面积出现的地方。', 'info', CW), 'H');

  return b.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const Y0 = yAfter('▣ 52', 200);
const put = stackAt(0, Y0, 200);
put(a53Shape());

return {
  分区: '财务应收 · A 区 · 53 形状与空间',
  画板数: 1,
  清理旧画板: cleared,
  圆角档数: RADII.length,
  间距档数: SPACES.length,
  栅格高: Math.round(FIN_H * (CW / FIN_W)),
  起点Y: Y0,
  本区结束Y: put.end(),
};
