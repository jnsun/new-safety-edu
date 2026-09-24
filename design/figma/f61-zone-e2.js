//!include ./_kit.js
//!include ./_kit-shape.js
//!include ./_kit-icon.js

/* E 区（下）· 图标与插画规范
 * 画板：42 图标栅格与图标集 / 43 图文与插画
 * 布局：自动接在「▣ 41」下篇之后（不写死 y，避免上篇高度变化后重叠）。 */

await loadFonts();

const ZX = 4680;
const GAPZ = 200;

const W = 1120;
const CW = W - 88;   // 1032

/** 提示条（※ 开头）。w 默认整栏宽。 */
function noteBar(str, kind, w) {
  const pair = (kind === 'warn') ? [C.warningSoft, C.warning] : [C.brandSoft, C.brandText];
  const ww = w != null ? w : CW;
  const r = row('note', { w: ww, gap: 10, cross: 'MIN', fill: pair[0], radius: 10, padX: 14, padY: 12 });
  add(r, text('※', { size: 12, weight: 700, color: pair[1] }), null);
  add(r, text(str, { size: 11.5, weight: 500, color: pair[1], lh: 1.65 }), 'H');
  return r;
}

/* ==================== 42 · 图标栅格与图标集 ==================== */
/** 24 栅格放大图：4 单位网格 + 20 圆 / 18 方对齐框 + 中心轴 + 一个整幅放大的圆形示例图标。 */
function gridDemo(s) {
  const S = 24 * s;
  const f = frame('grid' + s, { dir: 'NONE', w: S, h: S, fill: C.surfaceSoft, radius: 12 });
  f.strokes = [solid(C.brandLine)];
  f.strokeWeight = 1;
  f.strokeAlign = 'INSIDE';

  for (let u = 4; u < 24; u += 4) {
    add(f, irect(u * s - 0.5, 0, 1, S, { fill: C.line, opacity: 0.9, name: 'gridv' }));
    add(f, irect(0, u * s - 0.5, S, 1, { fill: C.line, opacity: 0.9, name: 'gridh' }));
  }
  add(f, irect(12 * s - 0.75, 0, 1.5, S, { fill: C.brand, opacity: 0.4, name: 'axisv' }));
  add(f, irect(0, 12 * s - 0.75, S, 1.5, { fill: C.brand, opacity: 0.4, name: 'axish' }));

  // 示例图标（圆形，直径正好 20 单位 → 与虚线圆完全重合）。
  // ⚠️ 必须画在关键线**之前**：同尺寸同心圆叠在一起时，谁在上面谁才看得见。
  //    之前的顺序把关键线压在下面，虚线圆直接被图标盖掉，整张图就只剩一个放大图标。
  for (const n of ICON.check(s)) add(f, n);

  // 关键线画在最上层，用 --info 蓝虚线做"栅格辅助线" —— 不能沿用 --brand：
  // 圆形图标的描边本身就是 --brand，同色叠加等于看不见。蓝色是规范内已有的语义色，
  // 且在这张图里只承担"辅助线"一种含义，不会和界面里的信息色混淆。
  const cir = icircle(2 * s, 2 * s, 20 * s, null, { stroke: C.info, sw: 1.4, strokeOpacity: 0.8, name: 'keyline-circle' });
  dash(cir, [7, 5]);
  add(f, cir);
  const sq = irect(3 * s, 3 * s, 18 * s, 18 * s, { stroke: C.info, sw: 1.4, strokeOpacity: 0.8, name: 'keyline-square' });
  dash(sq, [7, 5]);
  add(f, sq);

  return f;
}

/** 线宽对比：真实尺寸 vs 放大 8 倍。总宽 700。 */
function strokeRow(sw, use) {
  const r = row('swrow', { gap: 16, w: 700, cross: 'CENTER' });
  for (const multi of [1, 8]) {
    const s = layer('sw' + multi, 120, 24);
    s.fills = [solid(C.surfaceSoft)];
    s.cornerRadius = 6;
    if (multi === 1) {
      s.strokes = [solid(C.line)];
      s.strokeWeight = 1;
    }
    add(s, poly([[10, 12], [110, 12]], { stroke: C.brand, sw: sw * multi, close: false }));
    add(r, s, null);
  }
  const t = col('t', { gap: 2, w: 428 });
  add(t, text(sw + ' px', { size: 12, weight: 700, color: C.ink }), 'H');
  add(t, text(use, { size: 10.5, weight: 400, color: C.muted, w: 428, lh: 1.45 }), 'H');
  add(r, t, 'H');
  return r;
}

/** 端帽 / 拐角对比。总宽 160。 */
function capDemo(kind, label, tone) {
  const c = col('cap·' + kind, { gap: 8, w: 160, cross: 'CENTER' });
  const s = layer('s', 96, 96);
  s.fills = [solid(C.surfaceSoft)];
  s.cornerRadius = 12;
  const o = kind === 'round'
    ? { stroke: C.brand, sw: 9, close: false, cap: 'ROUND', join: 'ROUND' }
    : { stroke: C.danger, sw: 9, close: false, cap: 'SQUARE', join: 'MITER', opacity: 0.9 };
  add(s, poly([[26, 52], [42, 68], [70, 30]], o));
  add(c, s, null);
  add(c, text(label, { size: 11.5, weight: 700, color: tone, w: 160, align: 'CENTER' }), 'H');
  return c;
}

function e42Icons() {
  const b = board('42 · 图标栅格与图标集',
    '图标画在 24×24 画布里，主体压在 20 圆 / 18 方的对齐框内；描边 2、端帽与拐角一律圆头。'
    + '全部严格扁平：只有填充与描边，没有渐变、没有阴影、没有高光。',
    W, null);

  const top = row('top', { gap: 30, w: CW, cross: 'MIN' });

  const left = col('left', { gap: 12, w: 300 });
  add(left, sectionLabel('24×24 绘制栅格'), 'H');
  add(left, gridDemo(6), null);
  add(left, text('整幅等比放大 6 倍（含描边），所以看起来偏粗 —— 真实画布只有 24px。'
    + '蓝色虚线圆 = 圆形图标的极限外径 20，蓝色虚线方 = 方形图标的极限边长 18，'
    + '灰细线是 4 单位网格。示例图标正好贴住虚线圆，说明它已经顶到极限。', {
    size: 10.5, weight: 400, color: C.muted, w: 300, lh: 1.55,
  }), 'H');
  add(top, left);

  const right = col('right', { gap: 12 });
  add(right, sectionLabel('线宽'), 'H');
  add(right, strokeRow(1.5, '小尺寸图标（16–20px）、内嵌在文字行里的图标'), null);
  add(right, strokeRow(2, '默认档。24px 图标全部走这一档'), null);
  add(right, strokeRow(2.5, '只在 32px 以上的强调图标上用；同一组图标里不许混用'), null);
  add(right, box(1, 8));
  add(right, sectionLabel('端帽与拐角'), 'H');
  const caps = row('caps', { gap: 20, w: 700, cross: 'MIN' });
  add(caps, capDemo('round', '圆头圆角（默认）', C.brand), null);
  add(caps, capDemo('square', '方头尖角（不用）', C.danger), null);
  const capNote = col('capnote', { gap: 4, w: 340 });
  add(capNote, text('圆头在 1× 下视觉重量更轻，拐角不会出现"针尖"。'
    + '方头尖角只适用于极简几何字标，图标里一律不用。', {
    size: 10.5, weight: 400, color: C.muted, w: 340, lh: 1.5,
  }), 'H');
  add(caps, capNote, null);
  add(right, caps, null);
  add(top, right, 'H');

  add(b.body, top, 'H');

  /* --- 图标集 --- */
  add(b.body, sectionLabel('图标集 · 10 个（24×24 / 描边 2）'), 'H');
  const SET = [
    ['shield', '安全防护', '课程分类、培训封面'],
    ['book', '课件学习', '学习任务、课件'],
    ['check', '在线考试', '考试、合格认证'],
    ['record', '学习记录', '学习档案、学时'],
    ['cert', '证照管理', '证书、资质'],
    ['warning', '到期预警', '证照到期、待办'],
    ['org', '人员组织', '组织架构、人员'],
    ['chart', '统计报表', '完成率、统计'],
    ['gear', '系统设置', '配置、参数'],
    ['mail', '消息通知', '服务号推送、站内信'],
  ];
  let cellRow = null;
  SET.forEach((it, i) => {
    if (i % 5 === 0) {
      cellRow = row('set' + i, { gap: 14, w: CW, cross: 'MIN' });
      add(b.body, cellRow, 'H');
    }
    const c = col('ic·' + it[1], { gap: 7, w: 194, cross: 'CENTER' });
    add(c, iconCard(it[0], 1, 56, { radius: 16 }), null);
    add(c, text(it[1], { size: 12, weight: 700, color: C.ink, w: 194, align: 'CENTER' }), 'H');
    add(c, text(it[2], { size: 10.5, weight: 400, color: C.muted, w: 190, align: 'CENTER', lh: 1.45 }), 'H');
    add(cellRow, c, null);
  });

  add(b.body, noteBar('图标只用四种品牌色：--brand、--brand-deep、--accent（仅用于"当前 / 强调"），'
    + '内嵌细节线用 --muted、--line-strong。禁止给图标加渐变、投影或多色描边。', 'info'), 'H');

  return b.outer;
}

/* ==================== 43 · 图文与插画 ==================== */
/** 插画 A：施工现场安全（围挡 + 三个交通锥 + 地面）。
 *  顶部那条浅色带不是为了装饰 —— 交通锥天生重心在下，不加东西上半张就是空的。 */
function illA() {
  const f = frame('ill-A', { dir: 'NONE', w: 336, h: 180, fill: C.surfaceSoft, radius: 12, clips: true });
  add(f, irect(0, 0, 336, 26, { fill: C.accentSoft, name: 'hoarding' }));
  add(f, irect(0, 146, 336, 34, { fill: C.brandInk, opacity: 0.82, name: 'ground' }));
  for (const n of cone(84, 152, 40, 96)) add(f, n);
  for (const n of cone(176, 152, 48, 116)) add(f, n);
  for (const n of cone(262, 152, 36, 88)) add(f, n);
  return f;
}

/** 插画 B：学习闭环（书 + 课件屏 + 进度）。 */
function illB() {
  const f = frame('ill-B', { dir: 'NONE', w: 336, h: 180, fill: C.surfaceSoft, radius: 12, clips: true });
  add(f, poly([[88, 44], [24, 32], [24, 122], [88, 134]], { fill: C.brand, name: 'page-L' }));
  add(f, poly([[96, 44], [160, 32], [160, 122], [96, 134]], { fill: C.brandDeep, name: 'page-R' }));
  add(f, irect(190, 26, 128, 96, { fill: C.brandInk, radius: 10, name: 'screen' }));
  add(f, poly([[242, 52], [242, 96], [276, 74]], { fill: C.accent, name: 'play' }));
  add(f, irect(190, 134, 128, 10, { fill: C.track, radius: 5, name: 'track' }));
  add(f, irect(190, 134, 82, 10, { fill: C.accent, radius: 5, name: 'progress' }));
  return f;
}

/** 插画 C：数据与合规（柱状图 + 徽章）。 */
function illC() {
  const f = frame('ill-C', { dir: 'NONE', w: 336, h: 180, fill: C.surfaceSoft, radius: 12, clips: true });
  add(f, irect(52, 112, 30, 40, { fill: C.brandStrong, radius: 4, name: 'b1' }));
  add(f, irect(92, 94, 30, 58, { fill: C.brand, radius: 4, name: 'b2' }));
  add(f, irect(132, 74, 30, 78, { fill: C.brandDeep, radius: 4, name: 'b3' }));
  add(f, irect(172, 54, 30, 98, { fill: C.accent, radius: 4, name: 'b4' }));
  add(f, irect(44, 154, 166, 4, { fill: C.lineStrong, radius: 2, name: 'base' }));
  add(f, icircle(226, 52, 76, null, { fill: C.brandDeep, name: 'badge' }));
  add(f, poly([[253, 86], [263, 96], [280, 74]], { stroke: C.accent, sw: 6, close: false, name: 'tick' }));
  return f;
}

function e43Illustration() {
  const b = board('43 · 图文与插画',
    '插画只有一个风格：严格扁平 —— 纯色块 + 几何形，没有渐变、没有投影、没有高光。'
    + '画面里不出现文字，也不出现人物。',
    W, null);

  const cards = row('ills', { gap: 12, w: CW, cross: 'MIN' });
  for (const item of [
    [illA(), '现场与器材', '施工现场安全、作业规范类课程的封面与配图'],
    [illB(), '学习与考试', '学习任务、课件与考试模块的空态与引导图'],
    [illC(), '数据与合规', '统计报表、证照管理与预警模块的说明图'],
  ]) {
    const c = col('ill', { gap: 10, w: 336 });
    add(c, item[0], 'H');
    add(c, text(item[1], { size: 13, weight: 700, color: C.ink, w: 336 }), 'H');
    add(c, text(item[2], { size: 10.5, weight: 400, color: C.muted, w: 336, lh: 1.55 }), 'H');
    add(cards, c);
  }
  add(b.body, cards, 'H');

  /* --- 插画配色 --- */
  add(b.body, sectionLabel('插画只允许这 5 个色'), 'H');
  const pal = row('pal', { gap: 13, w: CW, cross: 'MIN' });
  for (const item of [
    [C.brand, 'brand', '--brand', '主体块：器材、书本、柱体'],
    [C.brandDeep, 'brand/deep', '--brand-deep', '次级块、深色器件'],
    [C.accent, 'accent', '--accent', '唯一的"高亮"，一张图里最多一处'],
    [C.accentSoft, 'accent/soft', '--accent-soft', '浅背景块、地面、留白带'],
    [C.inkSoft, 'ink/soft', '--ink-soft', '线稿与结构线（仅线框风格用）'],
  ]) {
    const c = col('pc', { gap: 6, w: 196 });
    add(c, irect(0, 0, 196, 52, { fill: item[0], radius: 8, stroke: C.line, sw: 1 }), 'H');
    add(c, text(item[1], { size: 11.5, weight: 700, color: C.ink }), 'H');
    add(c, text(item[2] + '  ' + item[0].toUpperCase(), { size: 10, weight: 500, color: C.brandText }), 'H');
    add(c, text(item[3], { size: 10, weight: 400, color: C.muted, w: 196, lh: 1.45 }), 'H');
    add(pal, c);
  }
  add(b.body, pal, 'H');

  /* --- 落地约定 --- */
  add(b.body, sectionLabel('落地约定'), 'H');
  const rules = col('rules', {
    gap: 9, w: CW, fill: C.surfaceSoft, radius: 12, stroke: C.line, sw: 1, padX: 20, padY: 18,
  });
  for (const item of [
    ['画面', '不出现文字、不出现人物。要传达的信息由文案承担，图只负责氛围与识别。'],
    ['形态', '纯色块 + 几何形。禁止渐变、投影、高光、外发光、玻璃拟态。'],
    ['圆角', '插画容器统一 --radius-panel（12px），图片与卡片同圆角。'],
    ['描边', '白底或浅底图片上方加 1px 内描边 rgba(4,48,42,.06)，避免图片与卡片融在一起。'],
    ['资源', '场景写实图用 .png/.jpg，器材图解与空态插画用 .svg（可换色、可缩放）。'],
  ]) {
    const r = row('r', { gap: 12, w: CW - 40, cross: 'MIN' });
    add(r, text(item[0], { size: 11.5, weight: 700, color: C.brandText, w: 44 }), null);
    add(r, text(item[1], { size: 11.5, weight: 400, color: C.inkSoft, lh: 1.6 }), 'H');
    add(rules, r, 'H');
  }
  add(b.body, rules, 'H');

  return b.outer;
}

/* ------------------------------ 装配 ------------------------------ */
// 接着上篇（▣ 41）往下排，不写死 y —— 上篇高度随时会变
let y = 0;
for (const n of figma.currentPage.children) {
  if (n.name.indexOf('▣ 41') === 0) y = n.y + n.height + GAPZ;
}

const cleared = clearBoards(['▣ 42', '▣ 43']);
const y0 = y;
const boards = [e42Icons(), e43Illustration()];
for (const f of boards) {
  f.x = ZX;
  f.y = y;
  y += f.height + GAPZ;
}

return {
  分区: 'E 区（下）· 图标与插画',
  画板数: boards.length,
  画板: boards.map((f) => f.name + '  ' + Math.round(f.width) + 'x' + Math.round(f.height)),
  清理旧画板: cleared,
  起止: { x: ZX, y0: y0, 结束Y: y - GAPZ },
};
