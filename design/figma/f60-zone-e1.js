//!include ./_kit.js
//!include ./_kit-shape.js

/* E 区（上）· Logo 应用与图标规范
 * 画板：40 Logo 应用场景 / 41 留白 · 最小尺寸 · 禁用
 * 布局：单列竖排于 x=4680（C 区右缘 4500 之外），画板高度自适应。
 * 下篇见 f61-zone-e2.js（42 图标栅格 / 43 图文与插画），它会自动接在本区下方。
 *
 * 依据：docs/design/视觉规范-v1.md §5 图文与插画、§6 Logo 应用。 */

await loadFonts();

const ZX = 4680;
const ZY = 0;
const GAPZ = 200;

const W = 1120;
const CW = W - 88;   // 1032

/* ------------------------------ 局部构件 ------------------------------ */
/** 提示条（※ 开头，用于放硬约束与免责说明）。w 默认整栏宽。 */
function noteBar(str, kind, w) {
  const pair = (kind === 'warn') ? [C.warningSoft, C.warning] : [C.brandSoft, C.brandText];
  const ww = w != null ? w : CW;
  const r = row('note', { w: ww, gap: 10, cross: 'MIN', fill: pair[0], radius: 10, padX: 14, padY: 12 });
  add(r, text('※', { size: 12, weight: 700, color: pair[1] }), null);
  add(r, text(str, { size: 11.5, weight: 500, color: pair[1], lh: 1.65 }), 'H');
  return r;
}

/** 精简表格（三栏文字即可，不需要 _kit-web 那一套）。
 *  ⚠️ 描边必须设 OUTSIDE：Figma 在 strokeAlign='INSIDE' 时会从自动布局的内容区
 *  里扣掉描边宽度（1px 描边扣 2px），列宽按设计值拼出来就会右越界 2px、被 clips 裁掉。
 *  _kit-web.js 的 webTable 也有同样的毛病，已在那边同步修掉。 */
function eTable(defs, rows) {
  const total = defs.reduce((a, d) => a + d.w, 0);
  const t = col('table', { gap: 0, w: total, radius: 12, stroke: C.line, sw: 1, clips: true, fill: C.surface });
  t.strokeAlign = 'OUTSIDE';
  const hd = row('thead', { w: total, gap: 0, fill: C.surfaceSoft });
  for (const d of defs) {
    const cell = row('th', { w: d.w, padX: 14, padY: 11, cross: 'CENTER' });
    add(cell, text(d.title, { size: 12, weight: 700, color: C.inkSoft, w: d.w - 28 }), 'H');
    add(hd, cell);
  }
  add(t, hd, 'H');
  rows.forEach((r, i) => {
    const tr = row('tr', { w: total, gap: 0, cross: 'CENTER', fill: i % 2 ? C.surfaceSoft : C.surface });
    defs.forEach((d, ci) => {
      const cell = row('td', { w: d.w, padX: 14, padY: 10, cross: 'CENTER' });
      add(cell, text(String(r[ci]), { size: 12, weight: 400, color: C.inkSoft, w: d.w - 28, lh: 1.45 }), 'H');
      add(tr, cell);
    });
    add(t, tr, 'H');
  });
  return t;
}

/** 应用场景卡：预览台 + 标题 + 说明。内容宽固定 210，四张卡刚好铺满 1032。 */
function sceneCard(title, sub, node, o) {
  o = o || {};
  const w = 246;
  const c = col('scene·' + title, {
    gap: 12, w,
    fill: o.fill != null ? o.fill : C.surface,
    radius: 12,
    stroke: o.stroke != null ? o.stroke : C.line, sw: 1,
    padX: 18, padY: 18,
  });
  add(c, node, 'H');
  add(c, text(title, { size: 13, weight: 700, color: o.titleColor || C.ink }), 'H');
  add(c, text(sub, { size: 10.5, weight: 400, color: o.subColor || C.muted, w: w - 36, lh: 1.58 }), 'H');
  return c;
}

/** 错误用法卡：虚线红框 + 左上 ✕ 徽标，宽 334（一行三张）。build(pv, w, h) 在 334×76 预览层里作画。 */
function forbidCard(title, note, build) {
  const w = 334, h = 168;
  const c = frame('forbid·' + title, {
    dir: 'NONE', w, h, fill: C.surface, radius: 12, stroke: C.dangerSoft, sw: 1.5,
  });
  dash(c, [6, 4]);

  add(c, icircle(14, 14, 20, null, { fill: C.dangerSoft }));
  const mark = text('✕', { size: 11, weight: 700, color: C.danger });
  add(c, mark);
  mark.x = 14 + (20 - mark.width) / 2;
  mark.y = 14 + (20 - mark.height) / 2;

  const pv = layer('pv', w, 76);
  add(c, pv);
  pv.x = 0; pv.y = 36;
  build(pv, w, 76);

  const t = text(title, { size: 12, weight: 700, color: C.danger, w: w - 28 });
  add(c, t);
  t.x = 14; t.y = 116;
  const n = text(note, { size: 9.5, weight: 400, color: C.muted, w: w - 28, lh: 1.5 });
  add(c, n);
  n.x = 14; n.y = 135;
  return c;
}

/** 把节点按包围盒在给定区域里居中。 */
function centerIn(pv, g, areaW, areaH) {
  add(pv, g);
  g.x = (areaW - g.width) / 2;
  g.y = (areaH - g.height) / 2;
  return g;
}

/* ======================== 40 · Logo 应用场景 ======================== */
function e40Logo() {
  const b = board('40 · Logo 应用场景',
    '同一个 Logo，四种处理。判断依据只有一条 —— 底色深浅：深底反白，浅底彩色；尺寸小于 24px 一律单色。',
    W, null);

  const scenes = row('scenes', { gap: 16, w: CW, cross: 'MIN' });

  // ① 浅底彩色（默认）
  add(scenes, sceneCard('浅底 · 彩色（默认）',
    '白底、浅灰底、表格与文档里都用这一版。五个分片色相不变。',
    stage(210, 116, logoGroup(88), { fill: C.surfaceSoft, radius: 10 })));

  // ② 深底反白
  add(scenes, sceneCard('深底 · 反白',
    '深绿底、深色卡片、照片与视频封面上用。仅保留圆环形状，单色填充。',
    stage(210, 116, logoGroup(88, { mono: C.white }), { fill: C.brandDeep, radius: 10 }),
    { fill: C.brandInk, stroke: C.brandInk, titleColor: C.white, subColor: '#9FC4B9' }));

  // ③ 小程序应用图标
  const appIcon = frame('appicon', { dir: 'NONE', w: 96, h: 96, fill: C.brandInk, radius: 22 });
  const lg3 = logoGroup(58, { mono: C.accent });
  add(appIcon, lg3);
  lg3.x = (96 - 58) / 2;
  lg3.y = (96 - 58) / 2;
  add(scenes, sceneCard('小程序应用图标',
    '深绿底 + 黄绿单色环。圆角 22、四周留白 22%，1024×1024 导出后由微信自动缩小。',
    stage(210, 116, appIcon, { fill: C.surfaceSoft, radius: 10 })));

  // ④ 小尺寸单色（TabBar / 列表前缀）
  const smallRow = row('small', { gap: 22, cross: 'CENTER' });
  for (const px of [24, 20, 16]) add(smallRow, logoGroup(px, { mono: C.brand }));
  add(scenes, sceneCard('小尺寸 · 仅青绿主环',
    '小于 24px（48rpx 以下）时去掉彩色分片 —— 那个尺寸下五个色相会糊成一团。',
    stage(210, 116, smallRow, { fill: C.surfaceSoft, radius: 10 })));

  add(b.body, scenes, 'H');

  /* --- 使用位置对照表 --- */
  add(b.body, sectionLabel('使用位置对照'), 'H');
  add(b.body, eTable(
    [{ title: '场景', w: 176 }, { title: '处理方式', w: 590 }, { title: '尺寸', w: 266 }],
    [
      ['小程序登录页', '居中，彩色版；下方留 40rpx 再排标题', '宽 180rpx（90px）'],
      ['小程序 TabBar', '只用青绿主环，去掉彩色分片', '48rpx（24px）'],
      ['小程序应用图标', '深绿底 + 黄绿单色环，四周留白 22%', '1024×1024 导出'],
      ['Web 后台侧栏', '深绿底上取黄绿单色（--accent），比纯白更贴品牌', '24px'],
      ['后台 / 文档页眉', '彩色原样，右侧留 12px 间距接标题', '高 24px'],
      ['登录页 / 邮件头图', '深绿底反白，可放大到 96px', '96px'],
      ['图片、深色照片上', '一律用反白版；不许在照片上直接压彩色版', '≥ 48px'],
    ]), 'H');

  add(b.body, sectionLabel('铁律'), 'H');
  add(b.body, noteBar('不加水印、不旋转、不加投影、不改分片色相。深底用反白、浅底用彩色 —— 只按底色选，不按"哪个更好看"选。', 'warn'), 'H');
  add(b.body, noteBar('本页 Logo 是按公司 logo 的结构矢量重绘的示意版本（青绿主环 + 黄绿 / 蓝 / 橙 / 灰五个分片），'
    + '用于规范校验与尺寸对照。正式矢量资产（AI / SVG）到位后整组替换即可 —— 色值、留白比例、禁用规则都不需要改。', 'info'), 'H');

  return b.outer;
}

/* ============== 41 · 留白 · 最小尺寸 · 禁用 ============== */
/** 最小留白示意：外径 160，四周留白 40（= 25%），净空区 240×240。 */
function clearanceDemo() {
  const S = 320;
  const LOGO = 160;
  const PAD = LOGO * 0.25;      // 40
  const BOX = LOGO + PAD * 2;   // 240
  const O = (S - BOX) / 2;      // 40
  const L = (S - LOGO) / 2;     // 80

  const f = layer('clearance', S, S);

  // 净空区四边的留白带（上下通宽，左右只占中间段，互不重叠）
  add(f, irect(O, O, BOX, PAD, { fill: C.accentSoft, name: 'band-top' }));
  add(f, irect(O, O + BOX - PAD, BOX, PAD, { fill: C.accentSoft, name: 'band-bottom' }));
  add(f, irect(O, O + PAD, PAD, LOGO, { fill: C.accentSoft, name: 'band-left' }));
  add(f, irect(O + BOX - PAD, O + PAD, PAD, LOGO, { fill: C.accentSoft, name: 'band-right' }));

  // Logo 与它的外径虚线框
  const lg = logoGroup(LOGO);
  add(f, lg);
  lg.x = L; lg.y = L;
  const outerRing = irect(L, L, LOGO, LOGO, { stroke: C.brandLine, sw: 1, radius: 8 });
  dash(outerRing, [4, 4]);
  add(f, outerRing);

  // 净空边界（画在最后，才不会被留白带盖住）
  const clearance = irect(O, O, BOX, BOX, { stroke: C.brand, sw: 1.5, radius: 12 });
  dash(clearance, [7, 5]);
  add(f, clearance);

  // 尺寸标注
  const lb = text('40', { size: 10.5, weight: 700, color: C.accentInk });
  add(f, lb);
  lb.x = O + BOX / 2 - lb.width / 2;
  lb.y = O + PAD / 2 - lb.height / 2;

  const lb2 = text('40', { size: 10.5, weight: 700, color: C.accentInk });
  add(f, lb2);
  lb2.x = O + PAD / 2 - lb2.width / 2;
  lb2.y = O + BOX / 2 - lb2.height / 2;

  const lb3 = text('外径 160', { size: 10.5, weight: 600, color: C.brandText });
  add(f, lb3);
  lb3.x = S / 2 - lb3.width / 2;
  lb3.y = O + BOX + 10;

  return f;
}

/** 尺寸刻度格：160 宽（含 160×152 的预览台）+ 尺寸 + 可用性标签。 */
function sizeCell(px, ok) {
  const c = col('size·' + px, { gap: 7, w: 160, cross: 'CENTER' });
  add(c, stage(160, 152, logoGroup(px, ok ? null : { mono: C.brand }), { fill: C.surfaceSoft, radius: 10 }), 'H');
  add(c, text(px + ' px', { size: 11, weight: 700, color: C.ink }), null);
  add(c, ok ? tag('彩色可用', 'done') : tag('仅单色', 'warning'), null);
  return c;
}

function e41Rules() {
  const b = board('41 · 留白 · 最小尺寸 · 禁用',
    '留白与最小尺寸是硬约束，不是"建议"。下面的错误用法一次也不许出现 —— 每条都给出反例，便于评审时对着看。',
    W, null);

  /* --- 留白 + 尺寸阈值说明 --- */
  const top = row('top', { gap: 28, w: CW, cross: 'MIN' });
  const left = col('left', { gap: 12, w: 320 });
  add(left, sectionLabel('最小留白 = 外径 × 25%'), 'H');
  add(left, clearanceDemo(), null);
  add(top, left);

  const right = col('right', { gap: 10 });
  add(right, sectionLabel('净空区怎么算'), 'H');
  add(right, text('留白不按"看着舒服"给，按外径算：160px 的 Logo 需要一块 240×240 的净空区'
    + '（160 + 40×2）。小程序登录页 Logo 宽 180rpx，净空区就是 270rpx；'
    + '写 CSS 时用 padding，不要用 margin —— margin 会被相邻元素折叠掉。', {
    size: 11.5, weight: 400, color: C.muted, w: 684, lh: 1.65,
  }), 'H');
  add(right, noteBar('净空区内不许出现任何其他元素：文字、图标、边框、分割线都不行。'
    + '浅底上的留白靠"什么都不放"实现，不要画一个白色方块去凑。', 'warn', 684), 'H');
  add(top, right, 'H');
  add(b.body, top, 'H');

  /* --- 最小尺寸 --- */
  add(b.body, sectionLabel('最小尺寸与单色阈值'), 'H');
  const sizes = row('sizes', { gap: 12, w: CW, cross: 'MIN' });
  for (const pair of [[128, true], [96, true], [64, true], [40, true], [24, true], [16, false]]) {
    add(sizes, sizeCell(pair[0], pair[1]), null);
  }
  add(b.body, sizes, 'H');
  add(b.body, noteBar('24px（48rpx）是分片色的下限。低于这个尺寸，黄绿 / 蓝 / 橙三段只剩 1–2 像素宽，'
    + '在手机上会变成脏点而不是分片 —— 这就是小尺寸强制单色的原因。', 'warn'), 'H');

  /* --- 禁用规则 --- */
  add(b.body, sectionLabel('禁止用法（6 条）', { color: C.danger }), 'H');
  const BAD = [
    ['拉伸变形', '横纵比锁死。只允许等比缩放，不许拉长或压扁。', (pv, w, h) => {
      centerIn(pv, stretchGroup(logoGroup(56), 1.6, 0.7), w, h);
    }],
    ['旋转', '只允许水平正放。不做倾斜，也不做环绕排列。', (pv, w, h) => {
      centerIn(pv, logoGroup(52), w, h).rotation = 20;
    }],
    ['加投影', '不加投影、不加发光。靠留白与底色把 Logo 分离出来。', (pv, w, h) => {
      centerIn(pv, logoGroup(52), w, h).effects = [shadow(C.brandInk, 0.45, 0, 7, 16)];
    }],
    ['改分片色相', '五个分片色相固定。不许改成品牌色、单色或自定义配色。', (pv, w, h) => {
      const g = logoGroup(52);
      const evil = ['#7C3AED', '#EC4899', '#F59E0B', '#0EA5E9', '#94A3B8'];
      g.children.forEach((seg, i) => { seg.fills = [solid(evil[i % evil.length])]; });
      centerIn(pv, g, w, h);
    }],
    ['描边 / 压暗当水印', '不加水印、不加描边。半透明只用于图片上的反白版。', (pv, w, h) => {
      add(pv, irect(w / 2 - 107, 8, 214, h - 16, { fill: C.canvas, radius: 8, name: 'bg' }));
      const g = logoGroup(52);
      for (const seg of g.children) { seg.strokes = [solid(C.white)]; seg.strokeWeight = 2; }
      g.opacity = 0.34;
      centerIn(pv, g, w, h);
    }],
    ['重排 / 拆分使用', '不许把分片拆开当装饰图形，也不许重排成别的形状。', (pv, w, h) => {
      const g = logoGroup(52);
      g.x = 0; g.y = 0;   // 不居中：分片要"散开"，靠下面的坐标摊到整个预览区
      const kids = Array.from(g.children);
      // 最大的一片 50×52，纵向余量只有 (76-52)/2 = 12 —— 半径再大就会压到标题
      kids.forEach((seg, i) => {
        const a = (i / kids.length) * Math.PI * 2;
        seg.x = (w / 2 - 26) + Math.cos(a) * 34;
        seg.y = (h - 52) / 2 + Math.sin(a) * 12;
      });
      add(pv, g);
    }],
  ];
  let badRow = null;
  BAD.forEach((item, i) => {
    if (i % 3 === 0) {
      badRow = row('bad' + i, { gap: 14, w: CW, cross: 'MIN' });
      add(b.body, badRow, 'H');
    }
    add(badRow, forbidCard(item[0], item[1], item[2]), null);
  });

  return b.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const cleared = clearBoards(['▣ 40', '▣ 41']);
const boards = [e40Logo(), e41Rules()];
let y = ZY;
for (const f of boards) {
  f.x = ZX;
  f.y = y;
  y += f.height + GAPZ;
}

return {
  分区: 'E 区（上）· Logo 应用',
  画板数: boards.length,
  画板: boards.map((f) => f.name + '  ' + Math.round(f.width) + 'x' + Math.round(f.height)),
  清理旧画板: cleared,
  起止: { x: ZX, y0: ZY, 结束Y: y - GAPZ },
};
