/* =============================================================================
   安全生产培训教育平台 · 视觉规范 → Figma 画布
   数据驱动：所有画板由本文件绘制，重跑幂等（先清旧产物再重建）。
   来源：公司 logo（青绿主环）+ 界面参考图（深墨绿 × 亮黄绿）
   ============================================================================= */

const MARK = 'safety-vs-v1';        // 产物标记，用于幂等重跑
const MARK_KEY = 'safetyVsMark';
const GAP = 64;                     // 画板间距

/* ----------------------------- 色彩令牌 ----------------------------- */
const C = {
  brandInk: '#04302A', brandDeep: '#075445', brand: '#12A17D', brandStrong: '#0C8567',
  brandText: '#0A7A5F', brandSoft: '#E4F4EF', brandLine: '#B9E1D6',
  accent: '#C9F16B', accentStrong: '#B4E247', accentSoft: '#EEFAD2', accentInk: '#4A6600',
  ink: '#0F1A16', inkSoft: '#33443D', muted: '#61736B',
  line: '#E1E8E4', lineStrong: '#C9D5CF',
  canvas: '#F3F6F3', surface: '#FFFFFF', surfaceSoft: '#F7FAF8',
  success: '#0F7A57', successSoft: '#E3F4EC',
  warning: '#A85A0A', warningSoft: '#FDF1E2',
  danger: '#B8321F', dangerSoft: '#FBEAE6',
  info: '#2A5FA8', infoSoft: '#E8F0FA',
  logoBlue: '#3E6FB5', logoOrange: '#D2691E', logoGray: '#4A4A4A',
  track: '#E6EAE0',
};

/* ----------------------------- 字体探测 ----------------------------- */
// Windows 上 Microsoft YaHei 通常只有 Regular / Bold，Mac 上 PingFang SC 有四档。
// 统一收敛到 Regular / Bold 两档，避免在不同机器上抛 "font not found"。
const FAMILIES = ['PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'Source Han Sans SC', 'Inter'];
let FONT = { family: 'Inter', regular: 'Regular', bold: 'Bold' };

async function resolveFont() {
  for (const family of FAMILIES) {
    try {
      await figma.loadFontAsync({ family, style: 'Regular' });
      let bold = 'Bold';
      try { await figma.loadFontAsync({ family, style: 'Bold' }); }
      catch (e) { bold = 'Regular'; }
      FONT = { family, regular: 'Regular', bold };
      return FONT;
    } catch (e) { /* 换下一个候选 */ }
  }
  return FONT;
}

/* ----------------------------- 基础工具 ----------------------------- */
function rgb(hex) {
  const h = String(hex).replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}
function solid(hex, opacity) {
  const paint = { type: 'SOLID', color: rgb(hex) };
  if (opacity !== undefined && opacity < 1) paint.opacity = opacity;
  return paint;
}
function shadow(x, y, blur, spread, hex, alpha) {
  return {
    type: 'DROP_SHADOW', visible: true, blendMode: 'NORMAL',
    color: Object.assign(rgb(hex), { a: alpha }),
    offset: { x, y }, radius: blur, spread,
  };
}
const ELEV = [shadow(0, 4, 12, 0, C.brandInk, 0.05)];
const ELEV_RAISED = [shadow(0, 9, 21, 0, C.brandInk, 0.14)];
const ELEV_BRAND = [shadow(0, 12, 32, 0, C.brandInk, 0.18)];
const ELEV_WEB = [shadow(0, 1, 2, 0, '#000000', 0.03), shadow(0, 12, 32, 0, '#000000', 0.05)];

function setSize(f, dir, w, h) {
  if (!w && !h) return;
  f.resize(w || 120, h || 120);
  if (dir === 'VERTICAL') {
    f.counterAxisSizingMode = w ? 'FIXED' : 'AUTO';
    f.primaryAxisSizingMode = h ? 'FIXED' : 'AUTO';
  } else if (dir === 'HORIZONTAL') {
    f.counterAxisSizingMode = h ? 'FIXED' : 'AUTO';
    f.primaryAxisSizingMode = w ? 'FIXED' : 'AUTO';
  }
}

function frame(name, o) {
  o = o || {};
  const f = figma.createFrame();
  f.name = name;
  f.fills = o.fill ? [solid(o.fill, o.opacity)] : [];
  if (o.radius) f.cornerRadius = o.radius;
  if (o.stroke) {
    f.strokes = [solid(o.stroke)];
    f.strokeWeight = o.sw || 1;
    f.strokeAlign = 'INSIDE';
  }
  if (o.effects) f.effects = o.effects;
  if (o.dir) {
    f.layoutMode = o.dir;
    f.itemSpacing = o.gap || 0;
    const px = o.padX !== undefined ? o.padX : (o.pad || 0);
    const py = o.padY !== undefined ? o.padY : (o.pad || 0);
    f.paddingLeft = px; f.paddingRight = px; f.paddingTop = py; f.paddingBottom = py;
    f.primaryAxisAlignItems = o.main || 'MIN';
    f.counterAxisAlignItems = o.cross || 'MIN';
    setSize(f, o.dir, o.w, o.h);
  } else if (o.w || o.h) {
    f.resize(o.w || 120, o.h || 120);
  }
  if (o.clip) f.clipsContent = true;
  return f;
}

function box(name, w, h, fill, radius) {
  const r = figma.createRectangle();
  r.name = name;
  r.resize(w, h);
  r.fills = fill ? [solid(fill)] : [];
  if (radius) r.cornerRadius = radius;
  return r;
}

function line(w, color, weight) {
  const r = figma.createRectangle();
  r.name = '分隔线';
  r.resize(w, weight || 1);
  r.fills = [solid(color || C.line)];
  return r;
}

function txt(str, o) {
  o = o || {};
  const t = figma.createText();
  t.fontName = { family: FONT.family, style: (o.weight || 400) >= 600 ? FONT.bold : FONT.regular };
  t.fontSize = o.size || 14;
  t.characters = str;
  t.fills = [solid(o.color || C.ink)];
  t.lineHeight = o.lh ? { value: Math.round((o.size || 14) * o.lh), unit: 'PIXELS' } : { value: Math.round((o.size || 14) * 1.45), unit: 'PIXELS' };
  if (o.ls) t.letterSpacing = { value: o.ls, unit: 'PIXELS' };
  if (o.align) t.textAlignHorizontal = o.align;
  t.textAutoResize = 'HEIGHT';
  t.name = str.length > 20 ? str.slice(0, 20) + '…' : str;
  return t;
}

/** 加入父级，可选在主轴/交叉轴方向撑满 */
function add(parent, node, sizing) {
  parent.appendChild(node);
  try {
    if (sizing === 'H' || sizing === 'FILL') node.layoutSizingHorizontal = 'FILL';
    if (sizing === 'V') node.layoutSizingVertical = 'FILL';
    if (sizing === 'B') { node.layoutSizingHorizontal = 'FILL'; node.layoutSizingVertical = 'FILL'; }
    if (sizing === 'GROW') node.layoutGrow = 1;
  } catch (e) { /* 非自动布局父级会抛错，忽略 */ }
  return node;
}

function spacer(w, h) {
  const r = figma.createRectangle();
  r.name = 'spacer';
  r.resize(w || 1, h || 1);
  r.fills = [];
  return r;
}

/* -------------------- 通用复合组件（跨画板复用） -------------------- */

/** 胶囊标签 */
function chip(label, bg, fg, o) {
  o = o || {};
  const f = frame('标签/' + label, {
    dir: 'HORIZONTAL', fill: bg, radius: 999,
    padX: o.padX || 10, padY: o.padY || 5, gap: 0,
    w: o.w || null,
  });
  add(f, txt(label, { size: o.size || 11, weight: 600, color: fg, lh: 1.3 }), 'H');
  if (!o.w) { f.primaryAxisSizingMode = 'AUTO'; }
  f.counterAxisAlignItems = 'CENTER';
  f.primaryAxisAlignItems = 'CENTER';
  return f;
}

/** 进度条 */
function progress(pct, o) {
  o = o || {};
  const h = o.h || 6;
  const w = o.w || 200;
  const track = frame('进度条', { fill: o.track || C.track, radius: 999, w: w, h: h });
  if (pct > 0) {
    const bar = frame('已完成', { fill: o.color || C.brand, radius: 999, w: Math.max(4, Math.round(w * pct / 100)), h: h });
    add(track, bar);
    bar.x = 0; bar.y = 0;
  }
  return track;
}

/** 按钮 */
function btn(label, variant, o) {
  o = o || {};
  const map = {
    primary: { fill: C.accent, color: C.brandInk, stroke: null },
    dark: { fill: C.brandInk, color: '#FFFFFF', stroke: null },
    secondary: { fill: C.surface, color: C.brandText, stroke: C.lineStrong },
    ghost: { fill: null, color: C.brandText, stroke: null },
    danger: { fill: C.dangerSoft, color: C.danger, stroke: null },
    disabled: { fill: C.canvas, color: C.muted, stroke: C.line },
  };
  const v = map[variant] || map.primary;
  const f = frame('按钮/' + variant, {
    dir: 'HORIZONTAL', fill: v.fill, stroke: v.stroke, sw: 1.5, radius: o.radius !== undefined ? o.radius : 12,
    padX: o.padX || 18, padY: o.padY || 12, main: 'CENTER', cross: 'CENTER',
    w: o.w || null, h: o.h || null,
  });
  add(f, txt(label, { size: o.size || 14, weight: 600, color: v.color, lh: 1.2 }), o.w ? 'H' : null);
  if (o.w) f.counterAxisAlignItems = 'CENTER';
  return f;
}

/* ----------------------------- 画板骨架 ----------------------------- */

/** 画板外壳：白/浅底 + 标题条 */
function board(title, subtitle, w, h, o) {
  o = o || {};
  const outer = frame(title, {
    dir: 'VERTICAL', fill: o.outerFill || C.canvas, gap: 18, pad: 32,
    w: w, h: h, radius: 24, clip: true,
  });
  const head = frame('画板标题', { dir: 'VERTICAL', gap: 4, w: w - 64 });
  add(head, txt(title, { size: 22, weight: 600, color: C.ink, lh: 1.2, ls: -0.4 }), 'H');
  if (subtitle) add(head, txt(subtitle, { size: 13, color: C.muted, lh: 1.5 }), 'H');
  add(outer, head);
  const body = frame('内容', { dir: 'VERTICAL', gap: 16, w: w - 64 });
  add(outer, body);
  outer.setPluginData(MARK_KEY, MARK);
  return { outer: outer, body: body };
}

/** 分区小标题 */
function sectionLabel(text, o) {
  o = o || {};
  const f = frame('分区/' + text, { dir: 'HORIZONTAL', gap: 10, cross: 'CENTER', w: o.w || null });
  const dot = box('dot', 8, 8, o.color || C.brand, 999);
  add(f, dot);
  add(f, txt(text, { size: 13, weight: 600, color: C.ink, lh: 1.3 }), 'H');
  return f;
}

/* ============================================================================
   A 区：规范基础
   ============================================================================ */

/** logo 圆环（复刻公司 logo 的分片结构，用于封面与品牌页） */
function logoRing(size, opts) {
  opts = opts || {};
  const wrap = frame('Logo/圆环', { w: size, h: size });
  const mono = opts.mono || null;
  const arc = (color, startDeg, endDeg, inner) => {
    const e = figma.createEllipse();
    e.name = '弧段';
    e.resize(size, size);
    e.fills = [solid(mono || color)];
    e.arcData = {
      startingAngle: startDeg * Math.PI / 180,
      endingAngle: endDeg * Math.PI / 180,
      innerRadius: inner,
    };
    wrap.appendChild(e);
    e.x = 0; e.y = 0;
  };
  // 内环：品牌青绿完整环
  arc(C.brand, 0, 360, 0.62);
  // 外环：五段分片，对应 logo 的青绿 / 黄绿 / 橙 / 灰 / 蓝
  const segs = opts.mono
    ? [[0, 72, 0.8], [76, 148, 0.8], [152, 224, 0.8], [228, 300, 0.8], [304, 356, 0.8]]
    : [[205, 296, 0.8], [301, 356, 0.8], [0, 56, 0.8], [60, 150, 0.8], [154, 200, 0.8]];
  const cols = opts.mono
    ? [mono, mono, mono, mono, mono]
    : ['#12A17D', '#C9F16B', C.logoOrange, C.logoGray, C.logoBlue];
  segs.forEach((s, i) => arc(cols[i], s[0], s[1], s[2]));
  return wrap;
}

function buildCover(x, y) {
  const b = board('00 · 封面', null, 1120, 560, { outerFill: C.brandInk });
  b.outer.itemSpacing = 0;
  // 隐藏的画板标题在自动布局里仍占位，必须真的移除
  b.outer.children[0].remove();

  const row = frame('封面内容', { dir: 'HORIZONTAL', gap: 48, w: 1056, h: 496, cross: 'CENTER' });
  const left = frame('文字', { dir: 'VERTICAL', gap: 18, w: 640 });
  add(left, txt('安全生产培训教育平台', { size: 15, weight: 600, color: C.accent, ls: 2 }), 'H');
  add(left, txt('视觉规范 v1', { size: 60, weight: 600, color: '#FFFFFF', lh: 1.12, ls: -1.6 }), 'H');
  add(left, txt('微信小程序（员工端）＋ Web 管理后台（管理端）', { size: 17, color: 'rgba', lh: 1.6 }), 'H');
  left.children[left.children.length - 1].fills = [solid('#FFFFFF', 0.72)];
  const rule = box('分隔', 72, 3, C.accent, 999);
  add(left, rule);
  add(left, txt('深墨绿承载权威 · 亮黄绿只给动作 · 青绿表达身份 · 橙只表示异常', { size: 14, color: '#FFFFFF', lh: 1.7 }), 'H');
  left.children[left.children.length - 1].fills = [solid('#FFFFFF', 0.6)];
  const tags = frame('要点', { dir: 'HORIZONTAL', gap: 10, w: 640 });
  ['对齐 WCAG 2.1', '小程序 750rpx 栅格', '后台 1440 栅格', 'Ant Design 令牌层'].forEach((t) => {
    add(tags, chip(t, C.surface, C.brandText, { padX: 12, padY: 7, size: 12 }), null);
  });
  add(left, tags);
  add(row, left);
  const ringWrap = frame('品牌图形', { dir: 'HORIZONTAL', w: 368, main: 'CENTER', cross: 'CENTER' });
  add(ringWrap, logoRing(320));
  add(row, ringWrap, 'V');
  add(b.body, row);
  b.outer.x = x; b.outer.y = y;
  return b.outer;
}

function buildColors(x, y) {
  const b = board('01 · 色彩系统', '四组令牌：品牌（logo 主环青绿）· 强调（logo 黄绿分片）· 中性 · 语义（logo 橙与蓝）。右侧为对比度实测值。', 1120, 1060);
  const groups = [
    {
      name: '品牌色 Brand · 来自 logo 主环', color: C.brand, rows: [
        [C.brandInk, '--brand-ink', '最深墨绿', '员工端欢迎区/主任务卡底色、后台侧栏'],
        [C.brandDeep, '--brand-deep', '深青绿', '权威数据面板、深色卡片次级层'],
        [C.brand, '--brand', '品牌主青绿', '图形/进度条/图标/大面积色块（不做小字）'],
        [C.brandStrong, '--brand-strong', '青绿·悬停', '悬停与按下；16px 以上文字下限', '4.60:1'],
        [C.brandText, '--brand-text', '青绿·文字档', '青绿系唯一可做正文与链接的档位', '5.30:1'],
        [C.brandSoft, '--brand-soft', '青绿·浅底', '选中态、信息条、标签底（配 --brand-line）'],
      ],
    },
    {
      name: '强调色 Accent · 来自 logo 黄绿分片', color: C.accent, rows: [
        [C.accent, '--accent', '高亮黄绿', '主按钮底色（配 --brand-ink 文字）', '11.14:1'],
        [C.accentStrong, '--accent-strong', '黄绿·悬停', '主按钮悬停与按下'],
        [C.accentSoft, '--accent-soft', '黄绿·浅底', '待办计数、今日挑战标签底'],
        [C.accentInk, '--accent-ink', '黄绿·深字', '黄绿浅底上的文字', '5.10:1'],
      ],
    },
    {
      name: '中性 Neutral', color: C.muted, rows: [
        [C.ink, '--ink', '墨色', '标题与正文（带绿相的黑，比纯黑柔和）', '17.80:1'],
        [C.inkSoft, '--ink-soft', '次级正文', '表单值、次级段落', '10.32:1'],
        [C.muted, '--muted', '说明灰', '说明、元信息、占位文字', '5.03:1'],
        [C.line, '--line', '常规描边', '卡片描边与列表分隔'],
        [C.lineStrong, '--line-strong', '强描边', '输入框、次级按钮'],
        [C.canvas, '--canvas', '页面底', '全局画布（比旧值多一点绿相）'],
        [C.surface, '--surface', '表面', '卡片与容器'],
        [C.surfaceSoft, '--surface-soft', '浅表面', '卡片内嵌层、表头'],
      ],
    },
    {
      name: '语义 Semantic · 橙与蓝来自 logo 分片', color: C.warning, rows: [
        [C.success, '--success', '成功', '已完成 / 通过 / 已确认（浅底 --success-soft）', '5.33:1'],
        [C.warning, '--warning', '警示', '待补学 / 即将到期 / 需重考（浅底 --warning-soft）', '5.08:1'],
        [C.danger, '--danger', '危险', '未通过 / 已锁定 / 逾期（浅底 --danger-soft）', '5.98:1'],
        [C.info, '--info', '信息', '中性提示 / 外部链接（浅底 --info-soft）', '6.36:1'],
      ],
    },
  ];
  groups.forEach((g) => {
    add(b.body, sectionLabel(g.name, { color: g.color, w: 1056 }));
    const list = frame('色板组', { dir: 'VERTICAL', fill: C.surface, radius: 20, stroke: C.line, w: 1056, clip: true });
    g.rows.forEach((r, i) => {
      const row = frame('色/' + r[1], { dir: 'HORIZONTAL', gap: 18, pad: 14, w: 1056, cross: 'CENTER' });
      const swatch = box('色块', 68, 68, r[0], 14);
      if (r[0] === C.surface) { swatch.strokes = [solid(C.line)]; swatch.strokeWeight = 1; swatch.strokeAlign = 'INSIDE'; }
      add(row, swatch);
      const meta = frame('元信息', { dir: 'VERTICAL', gap: 3, w: 240 });
      add(meta, txt(r[1], { size: 13, weight: 600, color: C.ink, lh: 1.3 }), 'H');
      add(meta, txt(r[2], { size: 12, color: C.muted, lh: 1.3 }), 'H');
      add(row, meta);
      add(row, txt(r[3], { size: 13, color: C.inkSoft, lh: 1.5 }), 'H');
      add(row, txt(r[4] || r[0].toUpperCase(), { size: 12, weight: 600, color: r[4] ? C.success : C.muted, lh: 1.3 }));
      add(list, row);
      if (i < g.rows.length - 1) add(list, line(1056, C.line));
    });
    add(b.body, list);
  });

  // 渐变
  add(b.body, sectionLabel('渐变 · 只保留两条，方向固定 135°', { color: C.brand }));
  const grads = frame('渐变组', { dir: 'HORIZONTAL', gap: 16, w: 1056 });
  [['--gradient-brand', 'linear-gradient(135deg, #12A17D 0%, #075445 100%)', [C.brand, C.brandDeep], '品牌面：强调区块、深色渐变'],
   ['--gradient-hero', 'linear-gradient(135deg, #075445 0%, #04302A 100%)', [C.brandDeep, C.brandInk], '员工端 Hero 深底']].forEach((g) => {
    const card = frame('渐变卡', { dir: 'VERTICAL', gap: 10, fill: C.surface, stroke: C.line, radius: 16, w: 520, pad: 16 });
    const sw = frame('色带', { w: 488, h: 56, radius: 10, clip: true });
    sw.fills = [{ type: 'GRADIENT_LINEAR', gradientTransform: [[0.7, 0.7, 0], [-0.7, 0.7, 0]],
      gradientStops: [
        { position: 0, color: Object.assign(rgb(g[2][0]), { a: 1 }) },
        { position: 1, color: Object.assign(rgb(g[2][1]), { a: 1 }) },
      ] }];
    add(card, sw);
    add(card, txt(g[0], { size: 13, weight: 600, color: C.ink }), 'H');
    add(card, txt(g[1], { size: 11, color: C.muted }), 'H');
    add(card, txt(g[3], { size: 12, color: C.inkSoft }), 'H');
    add(grads, card);
  });
  add(b.body, grads);

  // 硬规则提醒
  const note = frame('规则', { dir: 'HORIZONTAL', gap: 14, fill: C.warningSoft, radius: 16, pad: 18, w: 1056, cross: 'CENTER' });
  add(note, txt('关键判断', { size: 13, weight: 600, color: C.warning, lh: 1.4 }));
  add(note, txt('青绿 #12A17D 配白字只有 2.9:1，不能作按钮底色或小字。主按钮一律「黄绿底 + 深墨绿字」（11.14:1）。青绿出现在文字上时，必须降到 --brand-text #0A7A5F。', { size: 13, color: C.inkSoft, lh: 1.6 }), 'H');
  add(b.body, note);

  b.outer.x = x; b.outer.y = y;
  return b.outer;
}

function buildType(x, y) {
  const b = board('02 · 字体与字阶', '全平台一套系统字体栈；数字统一等宽数字。左栏小程序（rpx），右栏 Web 后台（px）。', 1120, 800);
  const cols = frame('双栏', { dir: 'HORIZONTAL', gap: 20, w: 1056 });
  const mpRows = [
    ['Display', '56rpx / 700', 26, 600, '欢迎语中的姓名、Hero 主标题'],
    ['H1 页面标题', '44rpx / 700', 22, 600, '.page-title（沿用现有值）'],
    ['H2 区块标题', '34rpx / 700', 18, 600, '.section-title（沿用现有值）'],
    ['H3 卡片标题', '32rpx / 650', 17, 600, '任务名、课件名'],
    ['Body-L 正文', '30rpx / 400', 16, 400, '正文（沿用默认 30rpx）'],
    ['Body 说明', '28rpx / 400', 15, 400, '说明、元信息'],
    ['Caption', '25rpx / 500', 13, 400, '时间、次要标签'],
    ['Micro', '22rpx / 600', 12, 600, '胶囊标签、计数徽标'],
  ];
  const webRows = [
    ['Page Title', '22px / 700', 22, 600, '页面标题'],
    ['Section', '16px / 600', 16, 600, '卡片标题'],
    ['Body', '14px / 400', 14, 400, '常规内容'],
    ['Table', '13px / 400', 13, 400, '表格正文（高密度）'],
    ['Label', '12px / 600', 12, 600, '表头、字段标签'],
    ['Metric', '34px / 700', 34, 600, '关键统计数字（等宽数字）'],
  ];
  const col = (title, rows, w) => {
    const c = frame(title, { dir: 'VERTICAL', gap: 12, fill: C.surface, stroke: C.line, radius: 20, w: w, pad: 20 });
    add(c, txt(title, { size: 15, weight: 600, color: C.ink }), 'H');
    rows.forEach((r) => {
      const row = frame('字阶/' + r[0], { dir: 'HORIZONTAL', gap: 16, w: w - 40, cross: 'CENTER' });
      const sample = frame('样本', { dir: 'VERTICAL', w: 150 });
      add(sample, txt(r[0], { size: r[2], weight: r[3], color: C.ink, lh: 1.25 }), 'H');
      add(row, sample);
      const meta = frame('规格', { dir: 'VERTICAL', gap: 2, w: 130 });
      add(meta, txt(r[1], { size: 11, weight: 600, color: C.brandText, lh: 1.3 }), 'H');
      add(meta, txt(r[4], { size: 11, color: C.muted, lh: 1.4 }), 'H');
      add(row, meta);
      add(c, row);
      add(c, line(w - 40, C.line));
    });
    return c;
  };
  add(cols, col('小程序 · 750rpx 栅格', mpRows, 518));
  add(cols, col('Web 后台 · 1440 栅格', webRows, 518));
  add(b.body, cols);

  const ruleRow = frame('规则', { dir: 'HORIZONTAL', gap: 16, w: 1056 });
  [['一屏一个 Display', '整个界面只允许一个 Display 级元素，它是屏幕的眼神焦点。'],
   ['等宽数字强制', '成绩 / 进度 / 人数 / 金额一律 tabular-nums，保证纵向对齐。'],
   ['字重收敛两档', 'Windows 上 Microsoft YaHei 只有 Regular / Bold，跨端只用两档。']].forEach((r) => {
    const c = frame('规则卡', { dir: 'VERTICAL', gap: 6, fill: C.surfaceSoft, stroke: C.line, radius: 14, w: 341, pad: 16 });
    add(c, txt(r[0], { size: 13, weight: 600, color: C.ink }), 'H');
    add(c, txt(r[1], { size: 12, color: C.muted, lh: 1.55 }), 'H');
    add(ruleRow, c);
  });
  add(b.body, ruleRow);

  b.outer.x = x; b.outer.y = y;
  return b.outer;
}

function buildShape(x, y) {
  const b = board('03 · 圆角 · 间距 · 阴影 · 栅格', '大圆角是本套视觉的签名特征，但圆角只表达容器层级，不把每段文字包成胶囊。', 1120, 900);

  add(b.body, sectionLabel('圆角', { color: C.brand }));
  const radii = [
    ['--radius-card', 36, '卡片、面板', '沿用现有 36rpx'],
    ['--radius-panel', 28, '内嵌分区、表格容器', ''],
    ['--radius-control', 24, '按钮、输入框', ''],
    ['--radius-tile', 18, '图标底、计数徽标', ''],
    ['--radius-chip', 999, '胶囊标签、筛选器', ''],
  ];
  const rRow = frame('圆角组', { dir: 'HORIZONTAL', gap: 16, w: 1056 });
  radii.forEach((r) => {
    const c = frame('圆角/' + r[0], { dir: 'VERTICAL', gap: 8, w: 202, cross: 'CENTER' });
    const sw = box('样本', 202, 100, C.brandSoft, Math.min(r[1] === 999 ? 50 : r[1], 50));
    sw.strokes = [solid(C.brandLine)]; sw.strokeWeight = 1.5; sw.strokeAlign = 'INSIDE';
    add(c, sw);
    add(c, txt(r[0], { size: 12, weight: 600, color: C.ink, align: 'CENTER' }), 'H');
    add(c, txt(r[1] === 999 ? '999rpx 全圆角' : r[1] + 'rpx / ' + Math.round(r[1] / 2.25) + 'px', { size: 11, color: C.brandText, align: 'CENTER' }), 'H');
    add(c, txt(r[2], { size: 11, color: C.muted, align: 'CENTER', lh: 1.4 }), 'H');
    add(rRow, c);
  });
  add(b.body, rRow);

  add(b.body, sectionLabel('间距 · 基础单位 4px / 8rpx', { color: C.brand }));
  const spRow = frame('间距组', { dir: 'HORIZONTAL', gap: 14, w: 1056, cross: 'CENTER', fill: C.surface, stroke: C.line, radius: 16, pad: 18 });
  [8, 12, 16, 24, 32, 48, 64].forEach((v) => {
    const c = frame('间距/' + v, { dir: 'VERTICAL', gap: 8, cross: 'CENTER' });
    add(c, box('块', v * 2, 20, C.brand, 4));
    add(c, txt(String(v), { size: 12, weight: 600, color: C.ink, align: 'CENTER' }), 'H');
    add(c, txt(v * 2 + 'rpx', { size: 10, color: C.muted, align: 'CENTER' }), 'H');
    add(spRow, c);
  });
  add(b.body, spRow);

  add(b.body, sectionLabel('阴影 · 色相统一带绿，不用纯黑', { color: C.brand }));
  const shRow = frame('阴影组', { dir: 'HORIZONTAL', gap: 16, w: 1056 });
  [['--elevation', ELEV, '常规卡片', '0 4px 12px rgba(4,48,42,.05)'],
   ['--elevation-raised', ELEV_RAISED, '主任务卡', '0 9px 21px rgba(4,48,42,.14)'],
   ['--elevation-brand', ELEV_BRAND, '深色权威面板', '0 12px 32px rgba(4,48,42,.18)']].forEach((s) => {
    const c = frame('阴影卡', { dir: 'VERTICAL', gap: 8, fill: C.surface, radius: 18, w: 341, h: 150, pad: 20, effects: s[1] });
    add(c, txt(s[2], { size: 14, weight: 600, color: C.ink }), 'H');
    add(c, txt(s[0], { size: 12, weight: 600, color: C.brandText }), 'H');
    add(c, txt(s[3], { size: 11, color: C.muted, lh: 1.5 }), 'H');
    add(shRow, c);
  });
  add(b.body, shRow);

  add(b.body, sectionLabel('栅格', { color: C.brand }));
  const gridRow = frame('栅格组', { dir: 'HORIZONTAL', gap: 16, w: 1056 });
  const g1 = frame('小程序栅格', { dir: 'VERTICAL', gap: 8, fill: C.surface, stroke: C.line, radius: 16, w: 520, pad: 18 });
  add(g1, txt('小程序 · 375pt / 750rpx 单列流式', { size: 13, weight: 600, color: C.ink }), 'H');
  const gv = frame('示意', { dir: 'HORIZONTAL', gap: 0, w: 484, h: 80 });
  add(gv, box('边距 32rpx', 32, 80, C.brandSoft, 4));
  add(gv, box('内容 686rpx', 420, 80, C.brandLine, 4));
  add(gv, box('边距 32rpx', 32, 80, C.brandSoft, 4));
  add(g1, gv);
  add(g1, txt('页面水平内边距 32rpx；卡片内边距 32rpx；列表行最小高 104rpx；页面级禁止横向滚动。', { size: 12, color: C.muted, lh: 1.55 }), 'H');
  add(gridRow, g1);

  const g2 = frame('后台栅格', { dir: 'VERTICAL', gap: 8, fill: C.surface, stroke: C.line, radius: 16, w: 520, pad: 18 });
  add(g2, txt('Web 后台 · 1440px 视口', { size: 13, weight: 600, color: C.ink }), 'H');
  const gh = frame('示意', { dir: 'HORIZONTAL', gap: 6, w: 484, h: 80 });
  add(gh, box('侧栏 224', 96, 80, C.brandInk, 6));
  add(gh, box('顶栏 64', 382, 80, C.brandSoft, 6));
  add(g2, gh);
  add(g2, txt('左侧导航固定 224px、顶栏 64px；内容区 1440 用 28px、1280 用 22px、1920 用 48px；宽表只在表格容器内滚动。', { size: 12, color: C.muted, lh: 1.55 }), 'H');
  add(gridRow, g2);
  add(b.body, gridRow);

  b.outer.x = x; b.outer.y = y;
  return b.outer;
}

function buildDataViz(x, y) {
  const b = board('04 · 数据可视化色序', '图表按固定色序取色，不额外发明颜色。财务金额沿用中国习惯：涨红跌绿。', 1120, 640);
  const ORDER = [C.brand, C.accent, C.info, C.warning, C.muted, C.brandStrong];
  add(b.body, sectionLabel('色序', { color: C.brand }));
  const seq = frame('色序条', { dir: 'HORIZONTAL', gap: 0, w: 1056, h: 72, clip: true, radius: 14 });
  ORDER.forEach((c, i) => {
    const seg = frame('色序/' + (i + 1), { fill: c, w: Math.round(1056 / 6), h: 72 });
    add(seq, seg);
  });
  add(b.body, seq);
  const legend = frame('图例', { dir: 'HORIZONTAL', gap: 12, w: 1056 });
  ORDER.forEach((c, i) => {
    const it = frame('项', { dir: 'HORIZONTAL', gap: 6, cross: 'CENTER' });
    add(it, box('dot', 10, 10, c, 999));
    add(it, txt(['主序列', '次序列', '第三序列', '第四序列', '第五序列', '第六序列'][i], { size: 12, color: C.inkSoft }));
    add(legend, it);
  });
  add(b.body, legend);

  add(b.body, sectionLabel('柱状示意', { color: C.brand }));
  const chart = frame('柱状图', { dir: 'VERTICAL', gap: 10, fill: C.surface, stroke: C.line, radius: 18, w: 1056, pad: 20 });
  add(chart, txt('各单位培训完成率', { size: 14, weight: 600, color: C.ink }), 'H');
  const bars = frame('柱', { dir: 'HORIZONTAL', gap: 22, w: 1016, h: 160, cross: 'MAX' });
  [92, 84, 71, 63, 48, 30].forEach((v, i) => {
    const colWrap = frame('列', { dir: 'VERTICAL', gap: 6, w: 145, main: 'MAX', cross: 'CENTER' });
    add(colWrap, box('柱', 84, Math.round(160 * v / 100), i === 5 ? C.danger : ORDER[i % 6], 8));
    add(colWrap, txt(v + '%', { size: 12, weight: 600, color: C.ink, align: 'CENTER' }), 'H');
    add(colWrap, txt('实体 ' + String.fromCharCode(65 + i), { size: 11, color: C.muted, align: 'CENTER' }), 'H');
    add(bars, colWrap);
  });
  add(chart, bars);
  add(b.body, chart);

  const finRow = frame('财务规则', { dir: 'HORIZONTAL', gap: 16, w: 1056 });
  [['涨 ↑', C.danger, '金额上升 / 增长', C.dangerSoft], ['跌 ↓', C.success, '金额下降 / 减少', C.successSoft]].forEach((f) => {
    const c = frame('财务色', { dir: 'HORIZONTAL', gap: 14, fill: f[3], radius: 14, pad: 18, w: 520, cross: 'CENTER' });
    add(c, txt(f[0], { size: 20, weight: 600, color: f[1] }));
    add(c, txt(f[2], { size: 13, color: C.inkSoft }), 'H');
    add(finRow, c);
  });
  add(b.body, finRow);

  b.outer.x = x; b.outer.y = y;
  return b.outer;
}

/* ============================================================================
   B 区：组件
   ============================================================================ */

function buildButtons(x, y) {
  const b = board('05 · 按钮与状态标签', '每个界面只允许一个黄绿主按钮，它就是当前唯一该做的事。', 1120, 560);
  add(b.body, sectionLabel('按钮变体', { color: C.brand }));
  const row = frame('按钮组', { dir: 'HORIZONTAL', gap: 18, w: 1056, cross: 'CENTER' });
  [['primary', '主操作', '继续完成'], ['dark', '深色面反白', '进入学习'], ['secondary', '次要操作', '返回'],
   ['ghost', '行内动作', '查看全部'], ['danger', '危险操作', '解锁任务'], ['disabled', '不可用', '已锁定']].forEach((v) => {
    const c = frame('按钮用例', { dir: 'VERTICAL', gap: 10, cross: 'CENTER', w: 160 });
    add(c, btn(v[2], v[0], { w: 150, padY: 14 }));
    add(c, txt(v[1], { size: 11, color: C.muted, align: 'CENTER', lh: 1.35 }), 'H');
    add(row, c);
  });
  add(b.body, row);

  add(b.body, sectionLabel('状态标签', { color: C.brand }));
  const tags = frame('标签组', { dir: 'HORIZONTAL', gap: 12, w: 1056, cross: 'CENTER' });
  [['待学习', C.brandSoft, C.brandText], ['进行中', C.brandSoft, C.brandText], ['需补学后重考', C.warningSoft, C.warning],
   ['考试次数已用完', C.dangerSoft, C.danger], ['已完成', C.successSoft, C.success], ['待现场确认', C.infoSoft, C.info],
   ['未开通', C.surfaceSoft, C.muted]].forEach((t) => {
    const c = frame('标签用例', { dir: 'VERTICAL', gap: 8, cross: 'CENTER' });
    add(c, chip(t[0], t[1], t[2], { padX: 14, padY: 8, size: 12 }));
    add(c, txt(t[2], { size: 10, color: C.muted, align: 'CENTER' }), 'H');
    add(tags, c);
  });
  add(b.body, tags);

  const note = frame('规则', { dir: 'HORIZONTAL', gap: 14, fill: C.brandSoft, radius: 14, pad: 16, w: 1056 });
  add(note, txt('红橙合并', { size: 13, weight: 600, color: C.brandText }));
  add(note, txt('本系统只保留一个警示档位（logo 的橙）。需要区分轻重时靠文案与图标，不加第三种颜色。', { size: 12, color: C.inkSoft, lh: 1.5 }), 'H');
  add(b.body, note);

  b.outer.x = x; b.outer.y = y;
  return b.outer;
}

function buildCards(x, y) {
  const b = board('06 · 卡片与胶囊筛选', '四种卡片承担不同权威等级；筛选器一律胶囊，不用下拉菜单。', 1120, 700);
  add(b.body, sectionLabel('卡片', { color: C.brand }));
  const row = frame('卡片组', { dir: 'HORIZONTAL', gap: 16, w: 1056 });
  const mk = (title, desc, action, opt) => {
    const c = frame('卡/' + title, { dir: 'VERTICAL', gap: 10, radius: 18, w: 252, h: 210, pad: 18,
      fill: opt.fill, stroke: opt.stroke, effects: opt.effects });
    add(c, txt(title, { size: 15, weight: 600, color: opt.titleColor }), 'H');
    add(c, txt(desc, { size: 12, color: opt.bodyColor, lh: 1.55 }), 'H');
    add(c, spacer(1, 6));
    add(c, btn(action, opt.btn, { w: 216, padY: 11 }));
    return c;
  };
  add(row, mk('白卡 Card', '默认容器。白底 + --line 描边 + 36rpx 圆角。', '默认动作',
    { fill: C.surface, stroke: C.line, titleColor: C.ink, bodyColor: C.muted, btn: 'secondary', effects: ELEV }));
  add(row, mk('深色卡 Ink Card', '每页最多一张。承载「现在先做」的主任务。', '继续完成',
    { fill: C.brandInk, titleColor: '#FFFFFF', bodyColor: C.brandLine, btn: 'primary', effects: ELEV_RAISED }));
  add(row, mk('黄绿卡 Accent Card', '今天的关键动作。与深色卡不同屏出现。', '开始挑战',
    { fill: C.accent, titleColor: C.brandInk, bodyColor: C.accentInk, btn: 'dark' }));
  add(row, mk('扁平卡 Flat', '只靠底色分层，无阴影。用于筛选面板。', '筛选',
    { fill: C.surface, stroke: C.line, titleColor: C.ink, bodyColor: C.muted, btn: 'ghost' }));
  add(b.body, row);

  add(b.body, sectionLabel('胶囊筛选器', { color: C.brand }));
  const chips = frame('筛选组', { dir: 'VERTICAL', gap: 14, fill: C.surface, stroke: C.line, radius: 16, w: 1056, pad: 18 });
  [['全部', true, ['全部', '三级教育', '项目入场', '日常培训', '变化补充']],
   ['全部', false, ['全部', '三级教育', '项目入场', '日常培训', '变化补充']]].forEach((group) => {
    const r = frame('胶囊行', { dir: 'HORIZONTAL', gap: 10, w: 1020, cross: 'CENTER' });
    group[2].forEach((label, i) => {
      const active = group[1] && i === 0;
      const ch = chip(label, active ? C.brandSoft : C.surface, active ? C.brandText : C.muted, { padX: 16, padY: 9, size: 12 });
      if (!active) { ch.strokes = [solid(C.line)]; ch.strokeWeight = 1; ch.strokeAlign = 'INSIDE'; }
      add(r, ch);
    });
    add(chips, r);
  });
  add(chips, txt('选中态去掉描边并加粗字重；一组内不超过 7 个；横向可滚动、滚动条隐藏。', { size: 12, color: C.muted, lh: 1.5 }), 'H');
  add(b.body, chips);

  b.outer.x = x; b.outer.y = y;
  return b.outer;
}

function buildRows(x, y) {
  const b = board('07 · 任务行与进度', '员工端与后台共用同一个列表单元；整行必须是真按钮，不是绑了点击的容器。', 1120, 760);
  add(b.body, sectionLabel('主任务行（深色）', { color: C.brand }));
  const main = frame('主任务', { dir: 'VERTICAL', gap: 12, fill: C.brandInk, radius: 20, w: 1056, pad: 22, effects: ELEV_RAISED });
  const mh = frame('头', { dir: 'HORIZONTAL', gap: 12, w: 1012, cross: 'CENTER' });
  add(mh, chip('现在先做', C.accent, C.accentInk, { padX: 12, padY: 6, size: 11 }));
  add(mh, txt('2026 年度三级安全教育（公司级）', { size: 19, weight: 600, color: '#FFFFFF', lh: 1.3 }), 'H');
  add(mh, chip('待学习', C.surface, C.brandText, { padX: 12, padY: 6, size: 11 }));
  add(main, mh);
  const mm = frame('元信息', { dir: 'HORIZONTAL', gap: 16, w: 1012 });
  ['培训类型：员工三级教育', '截止时间：2026-10-08', '学习进度 2/5'].forEach((t) => {
    add(mm, txt(t, { size: 12, color: C.brandLine }));
  });
  add(main, mm);
  const mp = progress(40, { w: 1012, h: 8, color: C.accent, track: 'rgba' });
  mp.children[0].fills = [solid(C.accent)];
  mp.fills = [solid(C.brand, 0.35)];
  add(main, mp);
  const mf = frame('底', { dir: 'HORIZONTAL', gap: 12, w: 1012, cross: 'CENTER' });
  add(mf, txt('下一步：完成剩余 3 个必学课件', { size: 13, color: '#FFFFFF' }), 'H');
  add(mf, btn('继续完成', 'primary', { padX: 18, padY: 10 }));
  add(main, mf);
  add(b.body, main);

  add(b.body, sectionLabel('普通任务行（白色）', { color: C.brand }));
  const list = frame('任务列表', { dir: 'VERTICAL', fill: C.surface, stroke: C.line, radius: 18, w: 1056, clip: true });
  [['项目入场教育 · 某某钻探项目', '项目入场教育 · 截止 2026-10-15', '去学习', 0],
   ['2026 年日常安全培训', '日常培训 · 截止 2026-11-30', '去考试', 75],
   ['变化内容补充培训', '变化补充 · 已逾期 3 天', '去补学', 30]].forEach((r, idx) => {
    const row = frame('任务行', { dir: 'VERTICAL', gap: 8, w: 1056, pad: 18 });
    const h1 = frame('h1', { dir: 'HORIZONTAL', gap: 12, w: 1020, cross: 'CENTER' });
    add(h1, txt(r[0], { size: 15, weight: 600, color: C.ink, lh: 1.3 }), 'H');
    const st = idx === 2 ? ['已逾期', C.dangerSoft, C.danger] : idx === 0 ? ['待学习', C.brandSoft, C.brandText] : ['进行中', C.brandSoft, C.brandText];
    add(h1, chip(st[0], st[1], st[2], { padX: 10, padY: 5, size: 11 }));
    add(row, h1);
    const h2 = frame('h2', { dir: 'HORIZONTAL', gap: 12, w: 1020, cross: 'CENTER' });
    add(h2, txt(r[1], { size: 12, color: C.muted }), 'H');
    add(h2, txt('下一步：' + r[2], { size: 12, weight: 600, color: C.brandText }));
    add(h2, txt('›', { size: 14, weight: 600, color: C.muted }));
    add(row, h2);
    add(row, progress(r[3], { w: 1020, h: 6, color: idx === 2 ? C.warning : C.brand }));
    add(list, row);
    if (idx < 2) add(list, line(1056, C.line));
  });
  add(b.body, list);

  add(b.body, sectionLabel('进度条三态', { color: C.brand }));
  const pg = frame('进度组', { dir: 'HORIZONTAL', gap: 16, w: 1056 });
  [['默认进行中', C.brand, 45], ['逾期 / 补学（不切红）', C.warning, 30], ['已完成', C.success, 100]].forEach((p) => {
    const c = frame('进度用例', { dir: 'VERTICAL', gap: 10, fill: C.surface, stroke: C.line, radius: 14, w: 341, pad: 16 });
    add(c, txt(p[0], { size: 12, weight: 600, color: C.ink }), 'H');
    add(c, progress(p[2], { w: 309, h: 8, color: p[1] }));
    add(c, txt(p[2] + '%', { size: 12, color: C.muted }), 'H');
    add(pg, c);
  });
  add(b.body, pg);

  b.outer.x = x; b.outer.y = y;
  return b.outer;
}

function buildForms(x, y) {
  const b = board('08 · 表单与状态面板', '五种非正常状态文案各不相同，不能共用一句「暂无数据」。', 1120, 780);
  add(b.body, sectionLabel('输入框四态', { color: C.brand }));
  const fRow = frame('表单组', { dir: 'HORIZONTAL', gap: 16, w: 1056 });
  [['默认', C.surface, C.line, C.muted, '请输入姓名', C.ink],
   ['聚焦', C.surface, C.brand, C.muted, '请输入姓名', C.ink],
   ['错误', C.surface, C.danger, C.muted, '请输入姓名', C.ink],
   ['禁用', C.canvas, C.line, C.muted, '该字段不可修改', C.muted]].forEach((s) => {
    const c = frame('输入框/' + s[0], { dir: 'VERTICAL', gap: 8, w: 252 });
    add(c, txt(s[0], { size: 12, weight: 600, color: C.ink }));
    const f = frame('field', { dir: 'HORIZONTAL', fill: s[1], stroke: s[2], sw: 2, radius: 12, w: 252, h: 44, padX: 14, cross: 'CENTER' });
    add(f, txt(s[4], { size: 13, color: s[3] }), 'H');
    add(c, f);
    add(c, txt(s[2] === C.danger ? '姓名不能为空' : (s[0] === '禁用' ? '由管理员维护' : ' '), { size: 11, color: s[2] === C.danger ? C.danger : C.muted, lh: 1.4 }), 'H');
    add(fRow, c);
  });
  add(b.body, fRow);

  add(b.body, sectionLabel('状态面板', { color: C.brand }));
  const sRow = frame('状态组', { dir: 'HORIZONTAL', gap: 14, w: 1056 });
  [['加载中', '正在加载待办', '正在获取最新任务和进度，请稍候。', C.brand, C.brandSoft, null],
   ['空数据', '当前没有待完成任务', '新的培训任务下发后会显示在这里。', C.brand, C.brandSoft, '去安全闯关'],
   ['筛选无结果', '没有符合条件的记录', '可以切换上方培训类型或完成状态。', C.brand, C.brandSoft, '清除筛选'],
   ['请求失败', '待办加载失败', '网络异常，请稍后重试。', C.danger, C.dangerSoft, '重新加载'],
   ['无权限', '不在你的管理范围', '该功能仅对授权范围内的管理员开放。', C.muted, C.surfaceSoft, '返回上一页']].forEach((s) => {
    const c = frame('状态/' + s[0], { dir: 'VERTICAL', gap: 10, fill: C.surface, stroke: C.line, radius: 18, w: 202, h: 250, pad: 16, cross: 'CENTER', main: 'CENTER' });
    const icon = frame('图标底', { dir: 'HORIZONTAL', fill: s[4], radius: 999, w: 44, h: 44, main: 'CENTER', cross: 'CENTER' });
    add(icon, box('核心', 18, 18, s[3], 6));
    add(c, icon);
    add(c, txt(s[1], { size: 13, weight: 600, color: s[3], align: 'CENTER', lh: 1.35 }), 'H');
    add(c, txt(s[2], { size: 11, color: C.muted, align: 'CENTER', lh: 1.5 }), 'H');
    if (s[5]) add(c, btn(s[5], s[3] === C.danger ? 'danger' : 'secondary', { w: 170, padY: 9, size: 12 }));
    add(sRow, c);
  });
  add(b.body, sRow);

  b.outer.x = x; b.outer.y = y;
  return b.outer;
}

/* ============================================================================
   C 区：微信小程序页面（员工端）
   ============================================================================ */

const MP_W = 375, MP_H = 812;

function mpShell(name, o) {
  o = o || {};
  const f = frame(name, { dir: 'VERTICAL', fill: o.fill || C.canvas, w: MP_W, h: MP_H, radius: 28, clip: true, effects: ELEV_WEB, gap: 0 });
  const sb = frame('状态栏', { dir: 'HORIZONTAL', w: MP_W, h: 44, padX: 20, cross: 'CENTER', fill: o.headFill });
  add(sb, txt('9:41', { size: 13, weight: 600, color: o.dark ? '#FFFFFF' : C.ink }));
  add(sb, spacer(1, 1), 'H');
  const dots = frame('信号', { dir: 'HORIZONTAL', gap: 3, cross: 'CENTER' });
  [5, 8, 11].forEach((h) => add(dots, box('bar', 3, h, o.dark ? C.accent : C.ink, 1)));
  add(dots, box('电池', 18, 9, o.dark ? '#FFFFFF' : C.ink, 2));
  add(sb, dots);
  add(f, sb);
  return f;
}

function mpNav(title, o) {
  o = o || {};
  const n = frame('导航栏', { dir: 'HORIZONTAL', w: MP_W, h: 50, padX: 16, cross: 'CENTER', gap: 10, fill: o.fill });
  add(n, txt('‹', { size: 24, weight: 600, color: o.dark ? '#FFFFFF' : C.brandText, lh: 1 }));
  const mid = frame('标题', { dir: 'VERTICAL', w: 270, cross: 'CENTER' });
  add(mid, txt(title, { size: 17, weight: 600, color: o.dark ? '#FFFFFF' : C.ink, align: 'CENTER', lh: 1.3 }), 'H');
  add(n, mid, 'H');
  add(n, txt('···', { size: 16, weight: 600, color: o.dark ? '#FFFFFF' : C.muted, lh: 1 }));
  return n;
}

const TAB_ITEMS = [['待办', 0], ['记录', 1], ['闯关', 2], ['消息', 3], ['我的', 4]];
function mpTab(active) {
  const wrap = frame('底部', { dir: 'VERTICAL', w: MP_W, gap: 0 });
  add(wrap, line(MP_W, C.line));
  const t = frame('TabBar', { dir: 'HORIZONTAL', w: MP_W, h: 62, fill: C.surface, padX: 6, cross: 'CENTER' });
  TAB_ITEMS.forEach((it, i) => {
    const on = i === active;
    const c = frame('Tab/' + it[0], { dir: 'VERTICAL', gap: 4, w: 72.6, h: 62, main: 'CENTER', cross: 'CENTER' });
    add(c, box('图标', 20, 20, on ? C.brand : C.lineStrong, 7));
    add(c, txt(it[0], { size: 10, weight: on ? 600 : 400, color: on ? C.brandText : C.muted, align: 'CENTER', lh: 1.2 }), 'H');
    add(t, c);
  });
  add(wrap, t);
  return wrap;
}

/** 小程序内容容器 */
function mpContent(o) {
  o = o || {};
  const c = frame('内容区', { dir: 'VERTICAL', gap: o.gap === undefined ? 12 : o.gap, w: MP_W, padX: 16, padY: 14 });
  return c;
}

function mpCard(name, o) {
  o = o || {};
  return frame(name, {
    dir: 'VERTICAL', gap: o.gap === undefined ? 8 : o.gap, fill: o.fill || C.surface,
    stroke: o.stroke === undefined ? C.line : o.stroke, radius: o.radius || 18,
    w: o.w || 343, pad: o.pad || 16, effects: o.effects,
  });
}

/* --- M1 待办首页 --- */
function buildMpTodo(x, y) {
  const f = mpShell('M1 · 待办首页', {});
  add(f, mpNav('待办', { fill: C.canvas }));

  const c = mpContent({ gap: 14 });
  // 欢迎区
  const hero = frame('欢迎区', { dir: 'HORIZONTAL', w: 343, gap: 12, cross: 'CENTER' });
  const hc = frame('问候', { dir: 'VERTICAL', gap: 2, w: 280 });
  add(hc, txt('上午好，卫红学', { size: 26, weight: 600, color: C.ink, lh: 1.2, ls: -0.6 }), 'H');
  add(hc, txt('今天也要平安工作', { size: 13, color: C.muted }), 'H');
  add(hero, hc, 'H');
  const av = frame('头像', { dir: 'HORIZONTAL', fill: C.brandSoft, radius: 999, w: 46, h: 46, main: 'CENTER', cross: 'CENTER' });
  add(av, box('人像', 16, 16, C.brand, 8));
  add(hero, av);
  add(c, hero);

  // 优先提示
  const pri = frame('优先提示', { dir: 'HORIZONTAL', gap: 10, fill: C.accentSoft, radius: 14, w: 343, pad: 12, cross: 'CENTER' });
  add(pri, box('旗', 16, 16, C.accentInk, 5));
  add(pri, txt('这是当前最优先的培训任务，不影响你查看其他任务。', { size: 12, color: C.accentInk, lh: 1.5 }), 'H');
  add(c, pri);

  // 主任务（深色卡）
  add(c, txt('现在先做', { size: 15, weight: 600, color: C.ink }), 'H');
  const main = frame('主任务', { dir: 'VERTICAL', gap: 10, fill: C.brandInk, radius: 20, w: 343, pad: 18, effects: ELEV_RAISED });
  add(main, chip('现在先做', C.accent, C.accentInk, { padX: 10, padY: 5, size: 11 }));
  const mh = frame('标题行', { dir: 'HORIZONTAL', gap: 10, w: 307, cross: 'CENTER' });
  add(mh, txt('2026 年度三级安全教育（公司级）', { size: 17, weight: 600, color: '#FFFFFF', lh: 1.3 }), 'H');
  add(mh, chip('待学习', C.surface, C.brandText, { padX: 9, padY: 4, size: 10 }));
  add(main, mh);
  ['培训类型：员工三级教育', '截止时间：2026-10-08'].forEach((t) => {
    add(main, txt(t, { size: 12, color: C.brandLine }), 'H');
  });
  const bar = progress(40, { w: 307, h: 8, color: C.accent });
  bar.fills = [solid(C.brand, 0.35)];
  bar.children[0].fills = [solid(C.accent)];
  add(main, bar);
  add(main, txt('学习进度 2/5', { size: 12, color: C.brandLine }), 'H');
  const mf = frame('动作', { dir: 'HORIZONTAL', gap: 10, w: 307, cross: 'CENTER' });
  add(mf, txt('下一步：完成剩余 3 个课件', { size: 12, color: '#FFFFFF' }), 'H');
  add(mf, btn('继续完成', 'primary', { padX: 16, padY: 9, size: 13 }));
  add(main, mf);
  add(c, main);

  // 其余任务
  const sh = frame('区块头', { dir: 'HORIZONTAL', w: 343, cross: 'CENTER' });
  add(sh, txt('其余任务', { size: 15, weight: 600, color: C.ink }), 'H');
  add(sh, txt('2 项', { size: 12, color: C.muted }));
  add(c, sh);
  const rest = frame('其余列表', { dir: 'VERTICAL', fill: C.surface, stroke: C.line, radius: 18, w: 343, clip: true });
  [['项目入场教育 · 钻探项目', '项目入场教育 · 截止 10-15', 0, '去学习'],
   ['变化内容补充培训', '变化补充 · 逾期 3 天', 30, '去补学']].forEach((r, i) => {
    const row = frame('行', { dir: 'VERTICAL', gap: 7, w: 343, pad: 14 });
    const h1 = frame('h1', { dir: 'HORIZONTAL', gap: 8, w: 315, cross: 'CENTER' });
    add(h1, txt(r[0], { size: 14, weight: 600, color: C.ink, lh: 1.3 }), 'H');
    add(h1, chip(i === 1 ? '已逾期' : '待学习', i === 1 ? C.dangerSoft : C.brandSoft, i === 1 ? C.danger : C.brandText, { padX: 9, padY: 4, size: 10 }));
    add(row, h1);
    const h2 = frame('h2', { dir: 'HORIZONTAL', gap: 8, w: 315, cross: 'CENTER' });
    add(h2, txt(r[1], { size: 11, color: C.muted }), 'H');
    add(h2, txt('下一步：' + r[3] + ' ›', { size: 11, weight: 600, color: C.brandText }));
    add(row, h2);
    add(row, progress(r[2], { w: 315, h: 5, color: i === 1 ? C.warning : C.brand }));
    add(rest, row);
    if (i === 0) add(rest, line(343, C.line));
  });
  add(c, rest);

  // 每日挑战（黄绿卡）
  const ch = frame('每日挑战', { dir: 'VERTICAL', gap: 10, fill: C.accent, radius: 18, w: 343, pad: 16 });
  const chh = frame('ch', { dir: 'HORIZONTAL', gap: 10, w: 311, cross: 'CENTER' });
  add(chh, box('灯泡', 26, 26, C.brandInk, 8));
  add(chh, txt('用几分钟巩固安全判断', { size: 14, weight: 600, color: C.brandInk, lh: 1.3 }), 'H');
  add(ch, chh);
  add(ch, txt('已答 3/5 题 · 今日 30 分', { size: 12, color: C.accentInk }), 'H');
  add(ch, btn('开始挑战', 'dark', { w: 311, padY: 10, size: 13 }));
  add(c, ch);
  add(c, txt('日常挑战为自愿巩固，不属于必须完成的培训任务。', { size: 11, color: C.muted, lh: 1.45 }), 'H');

  add(f, c, 'V');
  add(f, mpTab(0));
  f.x = x; f.y = y;
  return f;
}

/* --- M2 任务详情 --- */
function buildMpTask(x, y) {
  const f = mpShell('M2 · 任务详情', {});
  add(f, mpNav('培训任务', { fill: C.canvas }));
  const c = mpContent({ gap: 12 });

  const head = mpCard('任务摘要', { gap: 10, pad: 16 });
  const h1 = frame('h1', { dir: 'HORIZONTAL', gap: 10, w: 311, cross: 'CENTER' });
  const ht = frame('标题', { dir: 'VERTICAL', gap: 3, w: 250 });
  add(ht, txt('2026 年度三级安全教育（公司级）', { size: 16, weight: 600, color: C.ink, lh: 1.3 }), 'H');
  add(ht, txt('员工三级教育', { size: 12, color: C.muted }), 'H');
  add(h1, ht, 'H');
  add(h1, chip('待学习', C.brandSoft, C.brandText, { padX: 9, padY: 4, size: 10 }));
  add(head, h1);
  [['适用范围', '公司范围'], ['截止时间', '2026-10-08'], ['整体进度', '2/5 项已学']].forEach((r) => {
    const row = frame('事实行', { dir: 'HORIZONTAL', gap: 10, w: 311, cross: 'CENTER' });
    add(row, txt(r[0], { size: 12, color: C.muted, }), 'H');
    add(row, txt(r[1], { size: 12, weight: 600, color: C.inkSoft }));
    add(head, row);
  });
  add(head, progress(40, { w: 311, h: 7, color: C.brand }));
  const az = frame('下一步', { dir: 'VERTICAL', gap: 8, fill: C.brandSoft, radius: 12, w: 311, pad: 12 });
  add(az, txt('当前下一步', { size: 11, weight: 600, color: C.brandText }), 'H');
  add(az, txt('完成剩余 3 个必学课件后进入考试', { size: 13, color: C.inkSoft, lh: 1.5 }), 'H');
  add(az, btn('去学习课件', 'primary', { w: 287, padY: 10, size: 13 }));
  add(head, az);
  add(c, head);

  // 阶段
  const stage = mpCard('任务阶段', { gap: 10 });
  add(stage, txt('任务阶段', { size: 14, weight: 600, color: C.ink }), 'H');
  add(stage, txt('依次完成学习、考试、签字和完成确认。', { size: 11, color: C.muted }), 'H');
  [['学习课件', '进行中', C.brand, C.brandSoft], ['在线考试', '待开始', C.lineStrong, C.surfaceSoft],
   ['本人签字', '待开始', C.lineStrong, C.surfaceSoft], ['项目确认', '待开始', C.lineStrong, C.surfaceSoft]].forEach((s, i) => {
    const row = frame('阶段行', { dir: 'HORIZONTAL', gap: 10, w: 311, cross: 'CENTER' });
    const mark = frame('标记', { dir: 'HORIZONTAL', fill: s[3], radius: 999, w: 22, h: 22, main: 'CENTER', cross: 'CENTER', stroke: s[2], sw: 1.5 });
    add(mark, txt(String(i + 1), { size: 11, weight: 600, color: s[0] === '学习课件' ? C.brandText : C.muted, align: 'CENTER', lh: 1 }));
    add(row, mark);
    add(row, txt(s[0], { size: 13, color: C.ink }), 'H');
    add(row, txt(s[1], { size: 12, weight: 600, color: s[0] === '学习课件' ? C.brandText : C.muted }));
    add(stage, row);
  });
  add(c, stage);

  // 必学课件
  const cw = mpCard('必学课件', { gap: 0, pad: 0 });
  const cwh = frame('头', { dir: 'VERTICAL', gap: 2, w: 343, pad: 14 });
  add(cwh, txt('必学课件', { size: 14, weight: 600, color: C.ink }), 'H');
  add(cwh, txt('已完成 2/5 项，所有课件均可查看。', { size: 11, color: C.muted }), 'H');
  add(cw, cwh);
  add(cw, line(343, C.line));
  [['01 安全生产法律法规基础', '图文 · v3', '已完成', C.success],
   ['02 公司安全管理制度', 'HTML · v2', '已完成', C.success],
   ['03 作业现场风险辨识', 'HTML · v4', '未完成', C.warning],
   ['04 个人防护用品使用', '图文 · v1', '未完成', C.warning],
   ['05 应急处置与自救互救', 'HTML · v2', '未完成', C.warning]].forEach((r, i) => {
    const row = frame('课件行', { dir: 'HORIZONTAL', gap: 10, w: 343, pad: 14, cross: 'CENTER' });
    add(row, txt(r[0].slice(0, 2), { size: 13, weight: 600, color: C.lineStrong, lh: 1.2 }));
    const mid = frame('课件名', { dir: 'VERTICAL', gap: 2, w: 190 });
    add(mid, txt(r[0].slice(3), { size: 13, weight: 600, color: C.ink, lh: 1.3 }), 'H');
    add(mid, txt(r[1], { size: 11, color: C.muted }), 'H');
    add(row, mid, 'H');
    const right = frame('状态', { dir: 'VERTICAL', gap: 2, w: 62, cross: 'MAX' });
    add(right, txt(r[2], { size: 11, weight: 600, color: r[3], align: 'RIGHT' }), 'H');
    add(right, txt('去学习 ›', { size: 11, color: C.brandText, align: 'RIGHT' }), 'H');
    add(row, right);
    add(cw, row);
    if (i < 4) add(cw, line(343, C.line));
  });
  add(c, cw);
  add(f, c, 'V');
  add(f, mpTab(0));
  f.x = x; f.y = y;
  return f;
}

/* --- M3 课件学习 --- */
function buildMpCourseware(x, y) {
  const f = mpShell('M3 · 课件学习', {});
  add(f, mpNav('作业现场风险辨识', { fill: C.canvas }));
  const c = mpContent({ gap: 12 });

  // 进度
  const ph = frame('进度头', { dir: 'VERTICAL', gap: 6, w: 343 });
  const phr = frame('行', { dir: 'HORIZONTAL', w: 343, cross: 'CENTER' });
  add(phr, txt('内容块 3 / 7', { size: 12, weight: 600, color: C.ink }), 'H');
  add(phr, txt('43%', { size: 12, color: C.muted }));
  add(ph, phr);
  add(ph, progress(43, { w: 343, h: 6, color: C.brand }));
  add(c, ph);

  // 知识卡
  const card = mpCard('知识卡', { gap: 12, pad: 0, radius: 20, clip: true });
  const img = frame('配图', { fill: C.brandSoft, w: 343, h: 130, radius: 0 });
  add(img, box('场景示意', 60, 40, C.brandLine, 8));
  img.children[0].x = 141.5; img.children[0].y = 45;
  add(card, img);
  const cb = frame('正文', { dir: 'VERTICAL', gap: 10, w: 343, pad: 18 });
  add(cb, txt('知识卡 · 什么是作业现场风险', { size: 11, weight: 600, color: C.brandText, ls: 0.5 }), 'H');
  add(cb, txt('风险是危险源与暴露条件的组合', { size: 19, weight: 600, color: C.ink, lh: 1.35, ls: -0.4 }), 'H');
  add(cb, txt('同样的设备，在不同的天气、地形和作业方式下，可能造成伤害的严重程度完全不同。辨识风险就是把「可能出什么事」和「出了会多严重」分开写清楚。', { size: 13, color: C.inkSoft, lh: 1.65 }), 'H');
  add(card, cb);
  add(c, card);

  // 随堂题
  const quiz = mpCard('随堂题', { gap: 10, fill: C.surface, stroke: C.brandLine, radius: 18, pad: 16 });
  add(quiz, chip('随堂题 · 单选', C.brandSoft, C.brandText, { padX: 10, padY: 5, size: 11 }));
  add(quiz, txt('发现作业面有临边未设防护，正确做法是？', { size: 14, weight: 600, color: C.ink, lh: 1.45 }), 'H');
  [['A 继续作业，注意脚下即可', false], ['B 立即停止作业并设置警戒', true], ['C 报告后再决定是否继续', false]].forEach((o) => {
    const row = frame('选项', { dir: 'HORIZONTAL', gap: 10, w: 311, padX: 12, padY: 11, radius: 12, cross: 'CENTER',
      fill: o[1] ? C.brandSoft : C.surface, stroke: o[1] ? C.brand : C.line, sw: o[1] ? 1.5 : 1 });
    const dot = frame('标记', { dir: 'HORIZONTAL', fill: o[1] ? C.brand : C.surface, radius: 999, w: 16, h: 16, stroke: o[1] ? C.brand : C.lineStrong, sw: 1.5, main: 'CENTER', cross: 'CENTER' });
    if (o[1]) add(dot, txt('✓', { size: 10, weight: 600, color: '#FFFFFF', align: 'CENTER', lh: 1 }));
    add(row, dot);
    add(row, txt(o[0], { size: 13, color: o[1] ? C.brandText : C.inkSoft, lh: 1.4 }), 'H');
    add(quiz, row);
  });
  add(quiz, txt('随堂题不计分，不构成完成门槛，作答不写入服务端。', { size: 11, color: C.muted, lh: 1.45 }), 'H');
  add(c, quiz);

  add(f, c, 'V');
  // 底部操作条
  const act = frame('操作条', { dir: 'HORIZONTAL', gap: 10, w: MP_W, pad: 14, fill: C.surface });
  add(act, btn('上一块', 'secondary', { w: 110, padY: 12 }));
  add(act, btn('我已确认，下一块', 'primary', { w: 205, padY: 12, size: 14 }));
  add(f, act);
  f.x = x; f.y = y;
  return f;
}

/* --- M4 考试 --- */
function buildMpExam(x, y) {
  const f = mpShell('M4 · 在线考试', {});
  add(f, mpNav('在线考试', { fill: C.canvas }));
  const c = mpContent({ gap: 12 });

  // 头部
  const head = frame('考试头', { dir: 'VERTICAL', gap: 8, fill: C.brandInk, radius: 18, w: 343, pad: 16 });
  const hr = frame('hr', { dir: 'HORIZONTAL', w: 311, cross: 'CENTER' });
  const hl = frame('左', { dir: 'VERTICAL', gap: 2, w: 190 });
  add(hl, txt('第 1 次考试', { size: 11, color: C.brandLine }), 'H');
  add(hl, txt('第 3 / 20 题', { size: 17, weight: 600, color: '#FFFFFF' }), 'H');
  add(hr, hl, 'H');
  const timer = frame('计时', { dir: 'VERTICAL', gap: 2, fill: C.surface, radius: 12, w: 100, pad: 10, cross: 'MAX' });
  add(timer, txt('剩余时间', { size: 10, color: C.muted, align: 'RIGHT' }), 'H');
  add(timer, txt('24:36', { size: 17, weight: 600, color: C.ink, align: 'RIGHT' }), 'H');
  add(hr, timer);
  add(head, hr);
  const pc = frame('pc', { dir: 'HORIZONTAL', w: 311, cross: 'CENTER' });
  add(pc, txt('已答 2 / 20', { size: 11, color: C.brandLine }), 'H');
  add(pc, txt('10%', { size: 11, color: C.brandLine }));
  add(head, pc);
  const pb = progress(10, { w: 311, h: 6, color: C.accent });
  pb.fills = [solid(C.brand, 0.4)];
  pb.children[0].fills = [solid(C.accent)];
  add(head, pb);
  add(c, head);

  // 题干
  const q = mpCard('题干', { gap: 10, pad: 16 });
  add(q, chip('单选题', C.brandSoft, C.brandText, { padX: 10, padY: 5, size: 11 }));
  add(q, txt('三级安全教育中，公司级教育的组织者应当是？', { size: 15, weight: 600, color: C.ink, lh: 1.5 }), 'H');
  add(c, q);

  // 选项
  const opts = frame('选项组', { dir: 'VERTICAL', gap: 10, w: 343 });
  [['A 所在项目部', false], ['B 公司安全生产管理部门', true], ['C 员工本人', false], ['D 外协单位', false]].forEach((o) => {
    const row = frame('选项', { dir: 'HORIZONTAL', gap: 12, w: 343, padX: 16, padY: 14, radius: 14, cross: 'CENTER',
      fill: o[1] ? C.brandSoft : C.surface, stroke: o[1] ? C.brand : C.line, sw: o[1] ? 1.5 : 1, effects: ELEV });
    const dot = frame('标记', { dir: 'HORIZONTAL', fill: o[1] ? C.brand : C.surface, radius: 999, w: 18, h: 18, stroke: o[1] ? C.brand : C.lineStrong, sw: 1.5, main: 'CENTER', cross: 'CENTER' });
    if (o[1]) add(dot, txt('✓', { size: 11, weight: 600, color: '#FFFFFF', align: 'CENTER', lh: 1 }));
    add(row, dot);
    add(row, txt(o[0], { size: 14, color: o[1] ? C.brandText : C.inkSoft, lh: 1.4 }), 'H');
    add(opts, row);
  });
  add(c, opts);
  add(c, txt('答案已保存 · 刚刚', { size: 11, color: C.success }), 'H');

  // 导航
  const nav = frame('考试动作', { dir: 'HORIZONTAL', gap: 10, w: 343 });
  add(nav, btn('上一题', 'secondary', { w: 166, padY: 12 }));
  add(nav, btn('下一题', 'primary', { w: 166, padY: 12 }));
  add(c, nav);
  add(c, btn('答完了，去检查', 'ghost', { w: 343, padY: 10, size: 13 }));
  add(f, c, 'V');
  add(f, mpTab(0));
  f.x = x; f.y = y;
  return f;
}

/* --- M5 培训记录 --- */
function buildMpRecords(x, y) {
  const f = mpShell('M5 · 培训记录', {});
  add(f, mpNav('培训记录', { fill: C.canvas }));
  const c = mpContent({ gap: 12 });
  add(c, txt('学习、考试、签字和项目确认事实均在这里留档。', { size: 12, color: C.muted, lh: 1.5 }), 'H');

  // 胶囊筛选
  const fl = frame('筛选面板', { dir: 'VERTICAL', gap: 10, w: 343 });
  const r1 = frame('类型', { dir: 'HORIZONTAL', gap: 8, w: 343 });
  ['全部', '三级教育', '项目入场', '日常培训'].forEach((t, i) => {
    const ch = chip(t, i === 0 ? C.brandSoft : C.surface, i === 0 ? C.brandText : C.muted, { padX: 14, padY: 8, size: 12 });
    if (i !== 0) { ch.strokes = [solid(C.line)]; ch.strokeWeight = 1; ch.strokeAlign = 'INSIDE'; }
    add(r1, ch);
  });
  add(fl, r1);
  const r2 = frame('状态', { dir: 'HORIZONTAL', gap: 8, w: 343 });
  ['全部', '已完成', '进行中', '未通过'].forEach((t, i) => {
    const ch = chip(t, i === 0 ? C.brandText : C.surface, i === 0 ? '#FFFFFF' : C.muted, { padX: 14, padY: 7, size: 11 });
    if (i !== 0) { ch.strokes = [solid(C.line)]; ch.strokeWeight = 1; ch.strokeAlign = 'INSIDE'; }
    add(r2, ch);
  });
  add(fl, r2);
  add(c, fl);

  // 记录卡
  [['2026 年度三级安全教育（公司级）', '员工三级教育', '已完成', C.success, C.successSoft,
     [['完成时间', '2026-09-20'], ['最终成绩', '92 分'], ['考试结果', '合格'], ['本人签字', '已提交']]],
   ['项目入场教育 · 某某钻探项目', '项目入场教育', '进行中', C.brandText, C.brandSoft,
     [['完成时间', '—'], ['最终成绩', '—'], ['考试结果', '待考试'], ['本人签字', '待签字']]]].forEach((r) => {
    const card = mpCard('记录卡', { gap: 10, pad: 16, stroke: C.line, effects: ELEV });
    const h = frame('头部', { dir: 'HORIZONTAL', gap: 10, w: 311, cross: 'MIN' });
    const ht = frame('标题', { dir: 'VERTICAL', gap: 3, w: 220 });
    add(ht, txt(r[0], { size: 14, weight: 600, color: C.ink, lh: 1.35 }), 'H');
    add(ht, txt(r[1], { size: 11, color: C.muted }), 'H');
    add(h, ht, 'H');
    add(h, chip(r[2], r[4], r[3], { padX: 9, padY: 4, size: 10 }));
    add(card, h);
    const facts = frame('事实', { dir: 'VERTICAL', gap: 6, w: 311 });
    r[5].forEach((fr) => {
      const row = frame('行', { dir: 'HORIZONTAL', w: 311, cross: 'CENTER' });
      add(row, txt(fr[0], { size: 11, color: C.muted }), 'H');
      add(row, txt(fr[1], { size: 11, weight: 600, color: C.inkSoft }));
      add(facts, row);
    });
    add(card, facts);
    add(card, btn('查看完整记录', 'ghost', { w: 311, padY: 9, size: 12 }));
    add(c, card);
  });
  add(f, c, 'V');
  add(f, mpTab(1));
  f.x = x; f.y = y;
  return f;
}

/* --- M6 安全闯关 --- */
function buildMpGames(x, y) {
  const f = mpShell('M6 · 安全闯关', {});
  add(f, mpNav('安全闯关', { fill: C.canvas }));
  const c = mpContent({ gap: 12 });

  // Hero
  const hero = frame('Hero', { dir: 'VERTICAL', gap: 12, fill: C.brandInk, radius: 20, w: 343, pad: 18 });
  add(hero, txt('安全闯关', { size: 24, weight: 600, color: '#FFFFFF', ls: -0.6 }), 'H');
  add(hero, txt('自愿练习，巩固安全知识', { size: 12, color: C.brandLine }), 'H');
  const stats = frame('积分统计', { dir: 'HORIZONTAL', gap: 8, w: 307 });
  [['1,280', '累计积分'], ['320', '本月积分'], ['7', '本月排名']].forEach((s, i) => {
    const cell = frame('格', { dir: 'VERTICAL', gap: 3, fill: i === 2 ? C.accent : 'rgba', radius: 12, w: 97, pad: 12, cross: 'CENTER' });
    if (i < 2) cell.fills = [solid(C.brand, 0.28)];
    add(cell, txt(s[0], { size: 20, weight: 600, color: i === 2 ? C.brandInk : '#FFFFFF', align: 'CENTER' }), 'H');
    add(cell, txt(s[1], { size: 10, color: i === 2 ? C.accentInk : C.brandLine, align: 'CENTER' }), 'H');
    add(stats, cell);
  });
  add(hero, stats);
  add(c, hero);

  // 每日挑战（黄绿卡）
  const sh = frame('区块头', { dir: 'HORIZONTAL', w: 343, cross: 'CENTER' });
  add(sh, txt('今日挑战', { size: 15, weight: 600, color: C.ink }), 'H');
  add(sh, txt('自愿参与，不影响培训完成', { size: 11, color: C.muted }));
  add(c, sh);
  const daily = frame('每日挑战卡', { dir: 'HORIZONTAL', gap: 12, fill: C.accent, radius: 18, w: 343, pad: 16, cross: 'CENTER' });
  add(daily, box('灯泡', 34, 34, C.brandInk, 10));
  const dc = frame('copy', { dir: 'VERTICAL', gap: 3, w: 190 });
  add(dc, txt('每日安全挑战', { size: 15, weight: 600, color: C.brandInk }), 'H');
  add(dc, txt('已答 3/5 题 · 今日 30 分', { size: 11, color: C.accentInk }), 'H');
  add(daily, dc, 'H');
  add(daily, chip('进行中', C.brandInk, C.accent, { padX: 9, padY: 5, size: 10 }));
  add(c, daily);
  add(c, progress(60, { w: 343, h: 6, color: C.brandInk }));
  add(c, btn('继续挑战', 'dark', { w: 343, padY: 12 }));

  // 专题游戏
  add(c, txt('专题游戏', { size: 15, weight: 600, color: C.ink }), 'H');
  const gl = frame('游戏列表', { dir: 'VERTICAL', fill: C.surface, stroke: C.line, radius: 18, w: 343, clip: true });
  [['找隐患', '从工作场景中发现风险'], ['步骤排序', '把安全操作按顺序排好']].forEach((g, i) => {
    const row = frame('游戏行', { dir: 'HORIZONTAL', gap: 12, w: 343, pad: 16, cross: 'CENTER' });
    const ic = frame('图标', { dir: 'HORIZONTAL', fill: C.brandSoft, radius: 12, w: 38, h: 38, main: 'CENTER', cross: 'CENTER' });
    add(ic, box('glyph', 16, 16, C.brand, 5));
    add(row, ic);
    const gc = frame('copy', { dir: 'VERTICAL', gap: 2, w: 190 });
    add(gc, txt(g[0], { size: 14, weight: 600, color: C.ink }), 'H');
    add(gc, txt(g[1], { size: 11, color: C.muted }), 'H');
    add(row, gc, 'H');
    add(row, txt('开始闯关 ›', { size: 12, weight: 600, color: C.brandText }));
    add(gl, row);
    if (i === 0) add(gl, line(343, C.line));
  });
  add(c, gl);

  // 排行榜入口
  const rank = frame('排行榜', { dir: 'HORIZONTAL', fill: C.surface, stroke: C.line, radius: 16, w: 343, pad: 16, cross: 'CENTER' });
  const rc = frame('copy', { dir: 'VERTICAL', gap: 2, w: 250 });
  add(rc, txt('积分排行榜', { size: 14, weight: 600, color: C.ink }), 'H');
  add(rc, txt('查看个人和部门本月排名', { size: 11, color: C.muted }), 'H');
  add(rank, rc, 'H');
  add(rank, txt('›', { size: 18, weight: 600, color: C.muted }));
  add(c, rank);
  add(f, c, 'V');
  add(f, mpTab(2));
  f.x = x; f.y = y;
  return f;
}

/* --- M7 我的 --- */
function buildMpProfile(x, y) {
  const f = mpShell('M7 · 我的', {});
  add(f, mpNav('我的', { fill: C.canvas }));
  const c = mpContent({ gap: 12 });

  // 档案卡
  const card = mpCard('档案卡', { gap: 12, pad: 16 });
  const row = frame('身份', { dir: 'HORIZONTAL', gap: 14, w: 311, cross: 'CENTER' });
  const av = frame('头像', { dir: 'HORIZONTAL', fill: C.brandSoft, radius: 999, w: 60, h: 60, main: 'CENTER', cross: 'CENTER' });
  add(av, box('人像', 22, 22, C.brand, 11));
  add(row, av);
  const id = frame('身份信息', { dir: 'VERTICAL', gap: 4, w: 200 });
  const idl = frame('名字行', { dir: 'HORIZONTAL', gap: 8, w: 200, cross: 'CENTER' });
  add(idl, txt('卫红学', { size: 19, weight: 600, color: C.ink }), 'H');
  add(idl, chip('正式员工', C.brandSoft, C.brandText, { padX: 8, padY: 4, size: 10 }));
  add(id, idl);
  add(id, txt('工程物探经营实体 · 野外作业组', { size: 12, color: C.muted }), 'H');
  add(id, txt('138****8299', { size: 12, color: C.inkSoft }), 'H');
  add(row, id, 'H');
  add(row, txt('›', { size: 18, weight: 600, color: C.muted }));
  add(card, row);
  add(c, card);

  // 积分卡
  const pc = frame('积分卡', { dir: 'VERTICAL', gap: 12, fill: C.brandInk, radius: 18, w: 343, pad: 16 });
  const pch = frame('pch', { dir: 'HORIZONTAL', gap: 10, w: 311, cross: 'CENTER' });
  add(pch, box('星', 26, 26, C.accent, 8));
  const pcc = frame('copy', { dir: 'VERTICAL', gap: 2, w: 220 });
  add(pcc, txt('安全积分', { size: 15, weight: 600, color: '#FFFFFF' }), 'H');
  add(pcc, txt('积分来自每日安全挑战', { size: 11, color: C.brandLine }), 'H');
  add(pch, pcc, 'H');
  add(pch, txt('›', { size: 16, weight: 600, color: C.brandLine }));
  add(pc, pch);
  const pg = frame('pg', { dir: 'HORIZONTAL', gap: 8, w: 311 });
  [['1,280', '累计积分'], ['320', '本月积分'], ['7', '本月排名']].forEach((s) => {
    const cell = frame('格', { dir: 'VERTICAL', gap: 3, fill: C.brand, radius: 12, w: 98, pad: 10, cross: 'CENTER', opacity: 0.28 });
    add(cell, txt(s[0], { size: 17, weight: 600, color: '#FFFFFF', align: 'CENTER' }), 'H');
    add(cell, txt(s[1], { size: 10, color: C.brandLine, align: 'CENTER' }), 'H');
    add(pg, cell);
  });
  add(pc, pg);
  add(c, pc);

  // 证书入口
  const cert = frame('证书', { dir: 'HORIZONTAL', gap: 12, fill: C.surface, stroke: C.line, radius: 16, w: 343, pad: 15, cross: 'CENTER' });
  add(cert, box('icon', 30, 30, C.brandSoft, 9));
  const cc = frame('copy', { dir: 'VERTICAL', gap: 2, w: 230 });
  add(cc, txt('证书与授权', { size: 14, weight: 600, color: C.ink }), 'H');
  add(cc, txt('3 项证书 · 1 项管理角色', { size: 11, color: C.muted }), 'H');
  add(cert, cc, 'H');
  add(cert, txt('›', { size: 16, weight: 600, color: C.muted }));
  add(c, cert);

  // 服务宫格
  add(c, txt('资料与服务', { size: 15, weight: 600, color: C.ink }), 'H');
  const grid = frame('服务宫格', { dir: 'HORIZONTAL', gap: 10, w: 343 });
  [['个人资料', C.brandSoft, C.brand], ['调换部门', C.brandSoft, C.brand], ['变更申请', C.brandSoft, C.brand], ['订阅提醒', C.accentSoft, C.accentInk]].forEach((s) => {
    const item = frame('服务', { dir: 'VERTICAL', gap: 6, fill: C.surface, stroke: C.line, radius: 14, w: 78.25, h: 86, pad: 10, cross: 'CENTER', main: 'CENTER' });
    const ic = frame('icon', { dir: 'HORIZONTAL', fill: s[1], radius: 10, w: 30, h: 30, main: 'CENTER', cross: 'CENTER' });
    add(ic, box('glyph', 14, 14, s[2], 4));
    add(item, ic);
    add(item, txt(s[0], { size: 11, color: C.inkSoft, align: 'CENTER' }), 'H');
    add(grid, item);
  });
  add(c, grid);

  // 账号与设备
  const acc = frame('账号列表', { dir: 'VERTICAL', fill: C.surface, stroke: C.line, radius: 16, w: 343, clip: true });
  [['账号与设备', '登录方式、手机号和有效设备'], ['下载本人资料', '限时生成，仅可读取一次'], ['培训管理', '审核、催办、解锁与项目确认']].forEach((a, i) => {
    const row = frame('行', { dir: 'HORIZONTAL', gap: 12, w: 343, pad: 15, cross: 'CENTER' });
    add(row, box('icon', 28, 28, C.brandSoft, 8));
    const rc = frame('copy', { dir: 'VERTICAL', gap: 2, w: 220 });
    add(rc, txt(a[0], { size: 13, weight: 600, color: C.ink }), 'H');
    add(rc, txt(a[1], { size: 11, color: C.muted }), 'H');
    add(row, rc, 'H');
    add(row, txt('›', { size: 15, weight: 600, color: C.muted }));
    add(acc, row);
    if (i < 2) add(acc, line(343, C.line));
  });
  add(c, acc);
  add(f, c, 'V');
  add(f, mpTab(4));
  f.x = x; f.y = y;
  return f;
}

/* --- M8 登录 / 绑定 --- */
function buildMpLogin(x, y) {
  const f = mpShell('M8 · 登录与绑定', { fill: C.brandInk });
  f.children[0].remove();   // 深底登录页不用浅色状态栏

  const top = frame('顶部', { dir: 'VERTICAL', gap: 0, fill: C.brandInk, w: MP_W, h: 380, padX: 32, padY: 20, cross: 'CENTER' });
  const status = frame('状态栏', { dir: 'HORIZONTAL', w: 311, h: 32, cross: 'CENTER' });
  add(status, txt('9:41', { size: 13, weight: 600, color: '#FFFFFF' }));
  add(status, spacer(1, 1), 'H');
  const dots = frame('信号', { dir: 'HORIZONTAL', gap: 3, cross: 'CENTER' });
  [5, 8, 11].forEach((h) => add(dots, box('bar', 3, h, C.accent, 1)));
  add(dots, box('电池', 18, 9, '#FFFFFF', 2));
  add(status, dots);
  add(top, status);
  add(top, spacer(1, 1));
  add(top, logoRing(150));
  add(top, spacer(1, 14));
  add(top, txt('安全生产培训教育平台', { size: 19, weight: 600, color: '#FFFFFF', align: 'CENTER', ls: -0.4 }), 'H');
  add(top, txt('物化院 · 员工学习与考试', { size: 12, color: C.brandLine, align: 'CENTER' }), 'H');
  add(top, spacer(1, 1));
  add(f, top);

  const sheet = frame('表单', { dir: 'VERTICAL', gap: 14, fill: C.surface, radius: 28, w: MP_W, padX: 24, padY: 26 });
  add(sheet, txt('微信一键登录', { size: 17, weight: 600, color: C.ink }), 'H');
  add(sheet, txt('首次登录会用你已登记的手机号匹配公司人员档案，匹配不上时进入人工核对，不会自动建档。', { size: 12, color: C.muted, lh: 1.6 }), 'H');
  const field = frame('手机号', { dir: 'HORIZONTAL', fill: C.surface, stroke: C.line, sw: 2, radius: 12, w: 327, h: 52, padX: 16, cross: 'CENTER' });
  add(field, txt('已登记手机号', { size: 14, color: C.muted }), 'H');
  add(sheet, field);
  add(sheet, btn('微信授权登录', 'primary', { w: 327, padY: 15, size: 15 }));
  add(sheet, btn('使用手机号验证码', 'secondary', { w: 327, padY: 14, size: 14 }));
  const note = frame('提示', { dir: 'HORIZONTAL', gap: 10, fill: C.brandSoft, radius: 12, w: 327, pad: 12 });
  add(note, txt('i', { size: 12, weight: 600, color: C.brandText }));
  add(note, txt('同一手机号只能绑定一个账号。换号或换微信请先在「账号与设备」中发起换绑。', { size: 11, color: C.brandText, lh: 1.5 }), 'H');
  add(sheet, note);
  add(sheet, spacer(1, 1));
  const foot = frame('底部', { dir: 'HORIZONTAL', gap: 6, w: 327, main: 'CENTER', cross: 'CENTER' });
  add(foot, txt('登录即表示同意', { size: 11, color: C.muted }));
  add(foot, txt('《平台使用与信息采集说明》', { size: 11, weight: 600, color: C.brandText }));
  add(sheet, foot);
  add(f, sheet, 'V');
  f.x = x; f.y = y;
  return f;
}

/* ============================================================================
   D 区：Web 管理后台
   ============================================================================ */

const WEB_W = 1440, WEB_H = 900;

const NAV = [
  ['培训教育', ['首页总览', '课件管理', '题库与试卷', '培训安排', '培训记录', '统计报表']],
  ['人员与组织', ['人员档案', '组织与职责', '项目与成员', '审核中心']],
  ['野外项目报送', ['经营实体月报', '月报复核', '报送配置']],
  ['资质证照管理', ['人员证书', '单位资质', '到期预警']],
];

/** 后台外壳：深墨绿侧栏 + 白顶栏 */
function webShell(name, o) {
  o = o || {};
  const f = frame(name, { dir: 'HORIZONTAL', fill: C.canvas, w: WEB_W, h: WEB_H, clip: true, effects: ELEV_WEB, gap: 0 });
  const sider = frame('侧栏 224', { dir: 'VERTICAL', fill: C.brandInk, w: 224, h: WEB_H, padX: 14, padY: 18, gap: 6 });
  const brand = frame('品牌区', { dir: 'HORIZONTAL', gap: 10, w: 196, padY: 6, cross: 'CENTER' });
  add(brand, logoRing(26, { mono: '#FFFFFF' }));
  const bc = frame('文案', { dir: 'VERTICAL', gap: 1, w: 150 });
  add(bc, txt('物化院 · 安全管理', { size: 13, weight: 600, color: '#FFFFFF' }), 'H');
  add(bc, txt('企业管理工作台', { size: 10, color: C.brandLine }), 'H');
  add(brand, bc, 'H');
  add(sider, brand);
  add(sider, spacer(1, 10));
  NAV.forEach((g) => {
    const isActive = g[0] === o.active;
    const grp = frame('组/' + g[0], { dir: 'HORIZONTAL', gap: 8, w: 196, padY: 9, cross: 'CENTER', radius: 8 });
    add(grp, box('图标', 14, 14, isActive ? C.accent : C.brandLine, 5));
    add(grp, txt(g[0], { size: 13, weight: isActive ? 600 : 400, color: isActive ? C.accent : '#FFFFFF' }), 'H');
    if (!isActive) grp.children[1].fills = [solid('#FFFFFF', 0.82)];
    if (isActive) grp.fills = [solid(C.brand, 0.22)];
    add(sider, grp);
    if (isActive) {
      g[1].forEach((sub, i) => {
        const s = frame('子项', { dir: 'HORIZONTAL', gap: 8, w: 196, padY: 7, padX: 22, cross: 'CENTER', radius: 8 });
        add(s, txt(sub, { size: 12, color: i === o.sub ? C.accent : '#FFFFFF', weight: i === o.sub ? 600 : 400 }), 'H');
        if (i !== o.sub) s.children[0].fills = [solid('#FFFFFF', 0.62)];
        if (i === o.sub) s.fills = [solid('#FFFFFF', 0.08)];
        add(sider, s);
      });
    }
  });
  add(f, sider);

  const main = frame('主区', { dir: 'VERTICAL', fill: C.canvas, w: 1216, h: WEB_H, gap: 0 });
  const top = frame('顶栏 64', { dir: 'HORIZONTAL', fill: C.surface, w: 1216, h: 64, padX: 28, cross: 'CENTER', gap: 12 });
  top.strokes = []; add(top, txt(o.title || '培训教育', { size: 17, weight: 600, color: C.ink }), 'H');
  const idn = frame('身份', { dir: 'VERTICAL', gap: 1, w: 200, cross: 'MAX' });
  add(idn, txt('孙建宁', { size: 13, weight: 600, color: C.ink, align: 'RIGHT' }), 'H');
  add(idn, txt('安全生产部 · 公司管理员', { size: 11, color: C.muted, align: 'RIGHT' }), 'H');
  add(top, idn);
  add(top, btn('修改密码', 'secondary', { padX: 14, padY: 8, size: 12 }));
  const tl = line(1216, C.line);
  add(main, top);
  add(main, tl);
  const body = frame('内容', { dir: 'VERTICAL', gap: 16, w: 1216, padX: 28, padY: 20 });
  add(main, body, 'V');
  add(f, main, 'V');
  return { shell: f, body: body, main: main };
}

/** 后台页面标题区块 */
function webPageHead(title, desc, actions) {
  const f = frame('页面头', { dir: 'HORIZONTAL', gap: 16, w: 1160, cross: 'CENTER' });
  const c = frame('文案', { dir: 'VERTICAL', gap: 4, w: 760 });
  add(c, txt(title, { size: 22, weight: 600, color: C.ink, ls: -0.5 }), 'H');
  add(c, txt(desc, { size: 13, color: C.muted, lh: 1.5 }), 'H');
  add(f, c, 'H');
  const act = frame('动作', { dir: 'HORIZONTAL', gap: 10, cross: 'CENTER' });
  (actions || []).forEach((a, i) => add(act, btn(a, i === (actions || []).length - 1 ? 'primary' : 'secondary', { padX: 16, padY: 10, size: 13 })));
  add(f, act);
  return f;
}

function buildWebLogin(x, y) {
  const f = frame('W1 · 后台登录', { dir: 'HORIZONTAL', fill: C.brandInk, w: WEB_W, h: WEB_H, clip: true, effects: ELEV_WEB, gap: 0 });
  const left = frame('品牌面', { dir: 'VERTICAL', gap: 20, fill: C.brandInk, w: 820, h: WEB_H, padX: 72, padY: 72 });
  add(left, spacer(1, 60));
  add(left, logoRing(120));
  add(left, spacer(1, 20));
  add(left, txt('安全生产管理平台', { size: 44, weight: 600, color: '#FFFFFF', lh: 1.15, ls: -1.2 }), 'H');
  add(left, txt('培训教育 · 野外项目报送 · 资质证照 · 人员组织', { size: 16, color: C.brandLine, lh: 1.6 }), 'H');
  add(left, box('分隔', 80, 3, C.accent, 999));
  add(left, txt('管理端只服务有后台业务权限的账号。普通员工请使用微信小程序完成学习与考试。', { size: 14, color: '#FFFFFF', lh: 1.7 }), 'H');
  left.children[left.children.length - 1].fills = [solid('#FFFFFF', 0.62)];
  add(left, spacer(1, 1));
  const foot = frame('底部', { dir: 'HORIZONTAL', gap: 10, w: 676, cross: 'CENTER' });
  add(foot, txt('仅限授权人员使用', { size: 12, color: C.brandLine }));
  add(foot, txt('·', { size: 12, color: C.brandLine }));
  add(foot, txt('登录即视为确认已阅读信息安全责任告知', { size: 12, color: C.brandLine }));
  add(left, foot);

  const right = frame('登录面', { dir: 'VERTICAL', fill: C.surface, w: 620, h: WEB_H, padX: 72, padY: 72, gap: 0 });
  add(right, spacer(1, 70));
  add(right, txt('登录', { size: 30, weight: 600, color: C.ink, ls: -0.8 }), 'H');
  add(right, spacer(1, 6));
  add(right, txt('使用微信扫码或用户名密码进入', { size: 13, color: C.muted }), 'H');
  add(right, spacer(1, 26));
  add(right, txt('用户名', { size: 12, weight: 600, color: C.ink }), 'H');
  add(right, spacer(1, 6));
  const f1 = frame('用户名', { dir: 'HORIZONTAL', fill: C.surface, stroke: C.line, sw: 2, radius: 10, w: 476, h: 46, padX: 14, cross: 'CENTER' });
  add(f1, txt('请输入用户名', { size: 13, color: C.muted }), 'H');
  add(right, f1);
  add(right, spacer(1, 16));
  add(right, txt('密码', { size: 12, weight: 600, color: C.ink }), 'H');
  add(right, spacer(1, 6));
  const f2 = frame('密码', { dir: 'HORIZONTAL', fill: C.surface, stroke: C.brand, sw: 2, radius: 10, w: 476, h: 46, padX: 14, cross: 'CENTER' });
  add(f2, txt('••••••••••••', { size: 13, color: C.ink }), 'H');
  add(right, f2);
  add(right, spacer(1, 22));
  add(right, btn('登 录', 'primary', { w: 476, padY: 14, size: 15 }));
  add(right, spacer(1, 14));
  add(right, btn('使用微信扫码登录', 'secondary', { w: 476, padY: 13, size: 14 }));
  add(right, spacer(1, 20));
  const hint = frame('提示', { dir: 'HORIZONTAL', gap: 10, fill: C.warningSoft, radius: 10, w: 476, pad: 12 });
  add(hint, txt('连续 5 次密码错误会延迟 15 分钟，不会停用账号。忘记密码请联系公司管理员重置。', { size: 11, color: C.warning, lh: 1.5 }), 'H');
  add(right, hint);
  add(right, spacer(1, 1));
  add(f, left, 'V');
  add(f, right, 'V');
  f.x = x; f.y = y;
  return f;
}

function buildWebPortal(x, y) {
  const w = webShell('W2 · 平台首页（九宫格）', { active: null, title: '安全生产管理平台' });
  const b = w.body;
  add(b, webPageHead('安全生产管理平台', '公司管理员可进入全部模块；其他角色只看到自己获授权的入口。', ['返回首页']));
  const grid = frame('九宫格', { dir: 'HORIZONTAL', gap: 16, w: 1160 });
  const mods = [
    ['培训教育', '人员学习、考试、签字与培训档案', C.brand, C.brandSoft, true],
    ['野外项目报送', '按项目、月份填报安全生产月报', C.brand, C.brandSoft, true],
    ['资质证照管理', '人员证书、单位资质与到期时间', C.brand, C.brandSoft, true],
    ['人员与组织管理', '人员账号、角色权限、组织与项目主档', C.brand, C.brandSoft, true],
    ['安全责任制（待规划）', '岗位安全职责与责任落实记录', C.muted, C.surfaceSoft, false],
    ['隐患排查治理（待规划）', '隐患登记、整改和复查记录', C.muted, C.surfaceSoft, false],
    ['安全检查（待规划）', '日常检查、专项检查与检查记录', C.muted, C.surfaceSoft, false],
    ['应急管理（待规划）', '预案、演练和应急处置记录', C.muted, C.surfaceSoft, false],
    ['事故事件管理（待规划）', '事故、未遂事件和调查记录', C.muted, C.surfaceSoft, false],
  ];
  const col1 = frame('列1', { dir: 'VERTICAL', gap: 16, w: 376 });
  const col2 = frame('列2', { dir: 'VERTICAL', gap: 16, w: 376 });
  const col3 = frame('列3', { dir: 'VERTICAL', gap: 16, w: 376 });
  mods.forEach((m, i) => {
    const card = frame('模块卡', { dir: 'VERTICAL', gap: 12, fill: C.surface, stroke: C.line, radius: 16, w: 376, h: 190, pad: 22, effects: m[4] ? ELEV_WEB : [] });
    const ih = frame('ih', { dir: 'HORIZONTAL', gap: 12, w: 332, cross: 'CENTER' });
    const ic = frame('图标', { dir: 'HORIZONTAL', fill: m[3], radius: 12, w: 44, h: 44, main: 'CENTER', cross: 'CENTER' });
    add(ic, box('glyph', 20, 20, m[2], 6));
    add(ih, ic);
    add(ih, txt(m[0], { size: 16, weight: 600, color: m[4] ? C.ink : C.muted }), 'H');
    add(card, ih);
    add(card, txt(m[1], { size: 13, color: C.muted, lh: 1.55 }), 'H');
    add(card, spacer(1, 1));
    add(card, m[4] ? btn('进入模块', 'primary', { w: 332, padY: 10, size: 13 }) : btn('暂未开放', 'disabled', { w: 332, padY: 10, size: 13 }));
    add(i % 3 === 0 ? col1 : (i % 3 === 1 ? col2 : col3), card);
  });
  add(grid, col1); add(grid, col2); add(grid, col3);
  add(b, grid);
  w.shell.x = x; w.shell.y = y;
  return w.shell;
}

function buildWebTraining(x, y) {
  const w = webShell('W3 · 培训教育首页', { active: '培训教育', sub: '首页总览' });
  const b = w.body;
  add(b, webPageHead('培训教育', '人员学习、考试、签字与培训档案', ['导出统计', '新建培训安排']));

  // 指标行
  const kpi = frame('指标', { dir: 'HORIZONTAL', gap: 16, w: 1160 });
  [['应培训人数', '386', C.ink, ''], ['已完成', '312', C.success, '80.8%'], ['未完成', '74', C.warning, '19.2%'], ['考试未通过', '18', C.danger, '4.7%']].forEach((k) => {
    const c = frame('指标卡', { dir: 'VERTICAL', gap: 8, fill: C.surface, stroke: C.line, radius: 14, w: 278, pad: 18, effects: ELEV_WEB });
    add(c, txt(k[0], { size: 12, weight: 600, color: C.muted }), 'H');
    const vr = frame('值', { dir: 'HORIZONTAL', gap: 8, w: 242, cross: 'CENTER' });
    add(vr, txt(k[1], { size: 32, weight: 600, color: k[2], ls: -1.2, lh: 1.1 }), 'H');
    if (k[3]) add(vr, chip(k[3], C.surfaceSoft, C.muted, { padX: 8, padY: 4, size: 11 }));
    add(c, vr);
    add(c, progress(k[0] === '已完成' ? 80 : (k[0] === '未完成' ? 19 : 5), { w: 242, h: 5, color: k[2] }));
    add(kpi, c);
  });
  add(b, kpi);

  // 主区：深色权威面板 + 待办
  const two = frame('双栏', { dir: 'HORIZONTAL', gap: 16, w: 1160 });
  const dark = frame('权威面板', { dir: 'VERTICAL', gap: 14, fill: C.brandInk, radius: 16, w: 460, h: 300, pad: 24 });
  add(dark, chip('当前筛选 · 全部组织', C.brand, '#FFFFFF', { padX: 10, padY: 5, size: 11 }));
  add(dark, txt('应完成培训人次', { size: 12, weight: 600, color: C.brandLine, ls: 0.8 }), 'H');
  add(dark, txt('386', { size: 54, weight: 600, color: '#FFFFFF', ls: -2, lh: 1.05 }), 'H');
  add(dark, txt('其中 74 人尚未完成，18 人考试未通过', { size: 12, color: C.brandLine, lh: 1.5 }), 'H');
  add(dark, spacer(1, 1));
  add(dark, btn('查看未完成名单', 'primary', { w: 412, padY: 12, size: 13 }));
  add(two, dark);

  const todo = frame('待办列表', { dir: 'VERTICAL', gap: 0, fill: C.surface, stroke: C.line, radius: 16, w: 684, h: 300, clip: true, effects: ELEV_WEB });
  const th = frame('头', { dir: 'HORIZONTAL', w: 684, pad: 18, cross: 'CENTER' });
  add(th, txt('需要处理', { size: 15, weight: 600, color: C.ink }), 'H');
  add(th, txt('按紧急程度排序', { size: 11, color: C.muted }));
  add(todo, th);
  add(todo, line(684, C.line));
  [['三级教育未完成', '74 人', C.warningSoft, C.warning, '进入'],
   ['考试未通过待补学', '18 人', C.dangerSoft, C.danger, '进入'],
   ['待现场确认', '26 人', C.infoSoft, C.info, '进入'],
   ['证照 30 天内到期', '9 项', C.warningSoft, C.warning, '进入']].forEach((r, i) => {
    const row = frame('待办行', { dir: 'HORIZONTAL', gap: 14, w: 684, h: 52, pad: 18, cross: 'CENTER' });
    add(row, box('点', 8, 8, r[3], 999));
    add(row, txt(r[0], { size: 13, color: C.ink }), 'H');
    add(row, chip(r[1], r[2], r[3], { padX: 10, padY: 4, size: 11 }));
    add(row, txt(r[4], { size: 12, weight: 600, color: C.brandText }));
    add(todo, row);
    if (i < 3) add(todo, line(684, C.line));
  });
  add(two, todo);
  add(b, two);
  w.shell.x = x; w.shell.y = y;
  return w.shell;
}

function buildWebPeople(x, y) {
  const w = webShell('W4 · 人员档案', { active: '人员与组织', sub: '人员档案' });
  const b = w.body;
  add(b, webPageHead('人员档案', '按经营实体或部门分组；账号状态只在人员详情中展示，不另建账号列表。', ['导入人员', '新建人员']));

  // 筛选条（无阴影）
  const filter = frame('筛选条', { dir: 'HORIZONTAL', gap: 12, w: 1160, fill: C.surface, stroke: C.line, radius: 12, pad: 16, cross: 'CENTER' });
  const p1 = frame('胶囊组', { dir: 'HORIZONTAL', gap: 8, cross: 'CENTER' });
  ['全部人员', '正式员工', '外协人员', '临时个人'].forEach((t, i) => {
    const ch = chip(t, i === 0 ? C.brandSoft : C.surface, i === 0 ? C.brandText : C.muted, { padX: 14, padY: 8, size: 12 });
    if (i !== 0) { ch.strokes = [solid(C.line)]; ch.strokeWeight = 1; ch.strokeAlign = 'INSIDE'; }
    add(p1, ch);
  });
  add(filter, p1);
  const p2 = frame('胶囊组2', { dir: 'HORIZONTAL', gap: 8, cross: 'CENTER' });
  ['全部状态', '正常', '待审核', '已停用'].forEach((t, i) => {
    const ch = chip(t, i === 0 ? C.brandSoft : C.surface, i === 0 ? C.brandText : C.muted, { padX: 14, padY: 8, size: 12 });
    if (i !== 0) { ch.strokes = [solid(C.line)]; ch.strokeWeight = 1; ch.strokeAlign = 'INSIDE'; }
    add(p2, ch);
  });
  add(filter, p2);
  add(filter, spacer(1, 1), 'H');
  const search = frame('搜索', { dir: 'HORIZONTAL', fill: C.surface, stroke: C.line, sw: 1.5, radius: 10, w: 240, h: 38, padX: 12, cross: 'CENTER' });
  add(search, txt('搜索姓名或手机号', { size: 12, color: C.muted }), 'H');
  add(filter, search);
  add(b, filter);

  // 表格
  const table = frame('表格', { dir: 'VERTICAL', fill: C.surface, stroke: C.line, radius: 14, w: 1160, clip: true, effects: ELEV_WEB });
  const cols = [180, 110, 190, 140, 120, 160, 90];
  const head = frame('表头', { dir: 'HORIZONTAL', fill: C.surfaceSoft, w: 1160, h: 44, padX: 18, cross: 'CENTER' });
  ['姓名', '人员类型', '当前组织', '手机号', '资料完整性', '管理职责', '操作'].forEach((t, i) => {
    const c = frame('th', { dir: 'HORIZONTAL', w: cols[i], cross: 'CENTER' });
    add(c, txt(t, { size: 12, weight: 600, color: C.muted }), 'H');
    add(head, c);
  });
  add(table, head);
  add(table, line(1160, C.line));
  [['卫红学', '正式员工', '工程物探经营实体 · 野外作业组', '138****8299', '完整', '普通人员', C.muted, C.surfaceSoft],
   ['孙建宁', '正式员工', '安全生产部', '150****1583', '完整', '公司管理员', C.brand, C.brandSoft],
   ['王建国', '正式员工', '工程物探经营实体 · 钻探组', '139****3821', '缺照片', '组织管理员', C.brand, C.brandSoft],
   ['李海峰', '外协人员', '外协单位 · 某某地质队', '137****9902', '缺身份证', '普通人员', C.muted, C.surfaceSoft],
   ['张明远', '正式员工', '内部机构 · 后勤中心', '135****4417', '完整', '普通人员', C.muted, C.surfaceSoft],
   ['刘伟', '临时个人', '责任实体 · 工程物探经营实体', '136****7788', '完整', '普通人员', C.muted, C.surfaceSoft]].forEach((r, i) => {
    const row = frame('行', { dir: 'HORIZONTAL', w: 1160, h: 52, padX: 18, cross: 'CENTER' });
    const c0 = frame('c0', { dir: 'HORIZONTAL', gap: 8, w: cols[0], cross: 'CENTER' });
    const av = frame('头像', { dir: 'HORIZONTAL', fill: C.brandSoft, radius: 999, w: 28, h: 28, main: 'CENTER', cross: 'CENTER' });
    add(av, box('人', 10, 10, C.brand, 5));
    add(c0, av);
    add(c0, txt(r[0], { size: 13, weight: 600, color: C.brandText }), 'H');
    add(row, c0);
    const cell = (text, w2, o) => {
      const c = frame('td', { dir: 'HORIZONTAL', w: w2, cross: 'CENTER' });
      if (o && o.tag) add(c, chip(text, o.tag[0], o.tag[1], { padX: 9, padY: 4, size: 11 }));
      else add(c, txt(text, { size: 13, color: (o && o.color) || C.inkSoft, weight: (o && o.weight) || 400 }), 'H');
      return c;
    };
    add(row, cell(r[1], cols[1]));
    add(row, cell(r[2], cols[2]));
    add(row, cell(r[3], cols[3]));
    add(row, cell(r[4], cols[4], r[4] === '完整' ? { tag: [C.successSoft, C.success] } : { tag: [C.warningSoft, C.warning] }));
    add(row, cell(r[5], cols[5], r[5] === '普通人员' ? null : { tag: [r[7], r[6]] }));
    const act = frame('操作', { dir: 'HORIZONTAL', gap: 10, w: cols[6], cross: 'CENTER' });
    add(act, txt('详情', { size: 12, weight: 600, color: C.brandText }));
    add(row, act);
    add(table, row);
    if (i < 5) add(table, line(1160, C.line));
  });
  add(b, table);
  w.shell.x = x; w.shell.y = y;
  return w.shell;
}

function buildWebTrainingPlan(x, y) {
  const w = webShell('W5 · 培训安排', { active: '培训教育', sub: '培训安排' });
  const b = w.body;
  add(b, webPageHead('培训安排', '一次培训批次决定下发范围、课件、考试要求与截止时间。', ['导出名单', '新建培训安排']));
  const two = frame('双栏', { dir: 'HORIZONTAL', gap: 16, w: 1160 });
  const list = frame('批次列表', { dir: 'VERTICAL', gap: 0, fill: C.surface, stroke: C.line, radius: 14, w: 700, h: 560, clip: true, effects: ELEV_WEB });
  const lh = frame('头', { dir: 'HORIZONTAL', w: 700, pad: 16, cross: 'CENTER' });
  add(lh, txt('培训批次', { size: 15, weight: 600, color: C.ink }), 'H');
  add(lh, txt('共 12 个批次', { size: 11, color: C.muted }));
  add(list, lh);
  add(list, line(700, C.line));
  [['2026 年度三级安全教育', '员工三级教育 · 公司范围', 312, 386, C.brand, '进行中', C.brandSoft, C.brandText],
   ['项目入场教育 · 钻探项目', '项目入场教育 · 某某钻探项目', 24, 28, C.brand, '进行中', C.brandSoft, C.brandText],
   ['2026 年三季度日常培训', '日常培训 · 全公司', 350, 386, C.warning, '进行中', C.brandSoft, C.brandText],
   ['变化内容补充培训（新规）', '变化补充 · 工程物探经营实体', 42, 42, C.success, '已完成', C.successSoft, C.success]].forEach((r, i) => {
    const row = frame('批次行', { dir: 'VERTICAL', gap: 10, w: 700, pad: 18 });
    const h1 = frame('h1', { dir: 'HORIZONTAL', gap: 10, w: 664, cross: 'CENTER' });
    add(h1, txt(r[0], { size: 14, weight: 600, color: C.ink }), 'H');
    add(h1, chip(r[5], r[6], r[7], { padX: 9, padY: 4, size: 11 }));
    add(row, h1);
    add(row, txt(r[1], { size: 12, color: C.muted }), 'H');
    const pr = frame('pr', { dir: 'HORIZONTAL', gap: 10, w: 664, cross: 'CENTER' });
    add(pr, progress(Math.round(r[2] / r[3] * 100), { w: 540, h: 6, color: r[4] }), 'H');
    add(pr, txt(r[2] + ' / ' + r[3] + ' 人', { size: 12, weight: 600, color: C.inkSoft }), 'H');
    add(row, pr);
    add(list, row);
    if (i < 3) add(list, line(700, C.line));
  });
  add(two, list);

  const side = frame('详情', { dir: 'VERTICAL', gap: 14, w: 444 });
  const detail = frame('批次详情', { dir: 'VERTICAL', gap: 12, fill: C.surface, stroke: C.line, radius: 14, w: 444, pad: 20, effects: ELEV_WEB });
  add(detail, txt('批次详情', { size: 15, weight: 600, color: C.ink }), 'H');
  [['下发范围', '公司范围（386 人）'], ['培训类型', '员工三级教育'], ['考试要求', '必须考试 · 20 题 / 30 分钟 / 80 分'], ['补考次数', '3 次'], ['截止时间', '2026-10-08'], ['签字要求', '需要在完整记录上签字一次']].forEach((r) => {
    const row = frame('详情行', { dir: 'HORIZONTAL', gap: 12, w: 404, cross: 'MIN' });
    add(row, txt(r[0], { size: 12, color: C.muted, }), 'H');
    add(row, txt(r[1], { size: 12, weight: 600, color: C.inkSoft, align: 'RIGHT', lh: 1.5 }));
    add(detail, row);
  });
  add(detail, line(404, C.line));
  add(detail, btn('下发范围与催办', 'secondary', { w: 404, padY: 11, size: 13 }));
  add(detail, btn('查看完成情况', 'primary', { w: 404, padY: 11, size: 13 }));
  add(side, detail);

  const unlock = frame('解锁记录', { dir: 'VERTICAL', gap: 10, fill: C.surface, stroke: C.line, radius: 14, w: 444, pad: 20, effects: ELEV_WEB });
  add(unlock, txt('最近的高风险操作', { size: 14, weight: 600, color: C.ink }), 'H');
  [['考试解锁', '张明远 · 2026-09-22 · 原因：网络中断', C.warningSoft, C.warning],
   ['记录更正', '王建国 · 2026-09-20 · 原因：录错部门', C.dangerSoft, C.danger]].forEach((r) => {
    const row = frame('审计行', { dir: 'VERTICAL', gap: 6, fill: C.surfaceSoft, radius: 10, w: 404, pad: 12 });
    add(row, chip(r[0], r[2], r[3], { padX: 9, padY: 4, size: 11 }));
    add(row, txt(r[1], { size: 11, color: C.muted, lh: 1.5 }), 'H');
    add(unlock, row);
  });
  add(unlock, txt('高风险操作必须填写原因并写入不可修改的审计记录。', { size: 11, color: C.muted, lh: 1.5 }), 'H');
  add(side, unlock);
  add(two, side);
  add(b, two);
  w.shell.x = x; w.shell.y = y;
  return w.shell;
}

function buildWebQualification(x, y) {
  const w = webShell('W6 · 资质证照', { active: '资质证照管理', sub: '人员证书' });
  const b = w.body;
  add(b, webPageHead('人员证书', '人员证书与单位资质在同一台账呈现，但两类记录各自独立、权限边界不同。', ['批量导入', '新增证书']));

  const filter = frame('筛选条', { dir: 'HORIZONTAL', gap: 12, w: 1160, fill: C.surface, stroke: C.line, radius: 12, pad: 16, cross: 'CENTER' });
  const p1 = frame('胶囊', { dir: 'HORIZONTAL', gap: 8, cross: 'CENTER' });
  ['全部', '人员证书', '单位资质'].forEach((t, i) => {
    const ch = chip(t, i === 1 ? C.brandSoft : C.surface, i === 1 ? C.brandText : C.muted, { padX: 14, padY: 8, size: 12 });
    if (i !== 1) { ch.strokes = [solid(C.line)]; ch.strokeWeight = 1; ch.strokeAlign = 'INSIDE'; }
    add(p1, ch);
  });
  add(filter, p1);
  add(filter, spacer(1, 1), 'H');
  const p2 = frame('胶囊2', { dir: 'HORIZONTAL', gap: 8, cross: 'CENTER' });
  ['全部状态', '有效', '即将到期', '已过期', '已换证'].forEach((t, i) => {
    const ch = chip(t, i === 0 ? C.brandSoft : C.surface, i === 0 ? C.brandText : C.muted, { padX: 14, padY: 8, size: 12 });
    if (i !== 0) { ch.strokes = [solid(C.line)]; ch.strokeWeight = 1; ch.strokeAlign = 'INSIDE'; }
    add(p2, ch);
  });
  add(filter, p2);
  add(b, filter);

  const table = frame('台账', { dir: 'VERTICAL', fill: C.surface, stroke: C.line, radius: 14, w: 1160, clip: true, effects: ELEV_WEB });
  const cols = [170, 150, 170, 130, 120, 150, 90, 80];
  const head = frame('表头', { dir: 'HORIZONTAL', fill: C.surfaceSoft, w: 1160, h: 44, padX: 18, cross: 'CENTER' });
  ['人员 / 单位', '证书名称', '证书编号', '发证机构', '有效期至', '到期状态', '年度培训', '操作'].forEach((t, i) => {
    const c = frame('th', { dir: 'HORIZONTAL', w: cols[i], cross: 'CENTER' });
    add(c, txt(t, { size: 12, weight: 600, color: C.muted }), 'H');
    add(head, c);
  });
  add(table, head);
  add(table, line(1160, C.line));
  [['卫红学', '安全生产考核合格证', 'AQ-2023-0451', '省住建厅', '2026-11-02', '有效', C.successSoft, C.success, '无需培训'],
   ['王建国', '电工特种作业证', 'DG-2024-1183', '省应急厅', '2026-10-05', '即将到期', C.warningSoft, C.warning, '待培训'],
   ['李海峰', '焊工特种作业证', 'HG-2022-0776', '省应急厅', '2026-08-30', '已过期', C.dangerSoft, C.danger, '待培训'],
   ['张明远', '登高作业证', 'DG-2025-0231', '市应急局', '2027-03-18', '有效', C.successSoft, C.success, '已培训'],
   ['某某地质队', '地质灾害治理资质', 'DZ-甲-0092', '省自然资源厅', '2027-06-30', '有效', C.successSoft, C.success, '不适用'],
   ['某某测绘公司', '测绘资质证书', 'CH-乙-0341', '省自然资源厅', '2026-10-20', '即将到期', C.warningSoft, C.warning, '不适用']].forEach((r, i) => {
    const row = frame('行', { dir: 'HORIZONTAL', w: 1160, h: 52, padX: 18, cross: 'CENTER' });
    const mk = (text, idx, o) => {
      const c = frame('td', { dir: 'HORIZONTAL', w: cols[idx], cross: 'CENTER' });
      if (o && o.tag) add(c, chip(text, o.tag[0], o.tag[1], { padX: 9, padY: 4, size: 11 }));
      else add(c, txt(text, { size: (o && o.size) || 13, color: (o && o.color) || C.inkSoft, weight: (o && o.weight) || 400 }), 'H');
      return c;
    };
    add(row, mk(r[0], 0, { color: C.brandText, weight: 600 }));
    add(row, mk(r[1], 1));
    add(row, mk(r[2], 2, { color: C.muted }));
    add(row, mk(r[3], 3));
    add(row, mk(r[4], 4));
    add(row, mk(r[5], 5, { tag: [r[6], r[7]] }));
    add(row, mk(r[8], 6, r[8] === '待培训' ? { tag: [C.warningSoft, C.warning] } : (r[8] === '已培训' ? { tag: [C.successSoft, C.success] } : null)));
    add(row, mk('详情', 7, { color: C.brandText, weight: 600 }));
    add(table, row);
    if (i < 5) add(table, line(1160, C.line));
  });
  add(b, table);

  const warn = frame('提醒条', { dir: 'HORIZONTAL', gap: 14, fill: C.warningSoft, radius: 12, w: 1160, pad: 16, cross: 'CENTER' });
  add(warn, txt('到期提醒', { size: 12, weight: 600, color: C.warning }));
  add(warn, txt('证照进入预警期、到期前关键时间点及到期后每周汇总产生待处理消息。到期状态不改变证照生命周期，也不表示禁止上岗。', { size: 12, color: C.inkSoft, lh: 1.5 }), 'H');
  add(b, warn);
  w.shell.x = x; w.shell.y = y;
  return w.shell;
}

/* ============================================================================
   E 区：品牌与图标
   ============================================================================ */

function logoApp(size) {
  const wrap = frame('Logo/单环', { w: size, h: size });
  const e = figma.createEllipse();
  e.name = '青绿主环';
  e.resize(size, size);
  e.fills = [solid(C.brand)];
  e.arcData = { startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0.6 };
  wrap.appendChild(e);
  e.x = 0; e.y = 0;
  return wrap;
}

function buildBrand(x, y) {
  const b = board('09 · Logo 应用与图标', 'Logo 为青绿主环 + 黄绿/橙/灰/蓝分片。深底用反白版，浅底用彩色版。', 1120, 720);
  add(b.body, sectionLabel('场景', { color: C.brand }));
  const row = frame('场景组', { dir: 'HORIZONTAL', gap: 16, w: 1056 });
  const scenes = [
    { name: '深底反白', bg: C.brandInk, fg: '#FFFFFF', mode: 'mono', desc: '后台侧栏、深色 Hero' },
    { name: '浅底彩色', bg: C.surface, fg: C.ink, mode: 'color', desc: '文档页眉、报表、浅色页' },
    { name: '小程序图标', bg: C.canvas, fg: C.ink, mode: 'app', desc: '只用青绿主环，去掉分片' },
    { name: 'TabBar / 小尺寸', bg: C.surfaceSoft, fg: C.ink, mode: 'mono', desc: '40rpx 以下不用彩色分片' },
  ];
  scenes.forEach((s) => {
    const c = frame('场景/' + s.name, {
      dir: 'VERTICAL', gap: 12, fill: s.bg, stroke: C.line, radius: 16,
      w: 252, h: 240, pad: 20, cross: 'CENTER', main: 'CENTER', clip: true,
    });
    add(c, s.mode === 'app' ? logoApp(76) : logoRing(110, s.mode === 'mono' ? { mono: s.fg } : {}));
    add(c, txt(s.name, { size: 13, weight: 600, color: s.fg, align: 'CENTER' }), 'H');
    const d = txt(s.desc, { size: 11, color: s.fg, align: 'CENTER', lh: 1.4 });
    d.fills = [solid(s.fg, 0.65)];
    add(c, d, 'H');
    add(row, c);
  });
  add(b.body, row);

  const rules = frame('使用规则', { dir: 'HORIZONTAL', gap: 16, w: 1056 });
  [['最小留白', 'Logo 四周留白 ≥ 圆环外径的 25%。'],
   ['不做的三件事', '不加水印、不旋转、不加投影。'],
   ['对比不足时', '青绿环在深底上对比只有 4.39:1，深底一律用反白版而不是彩色版。']].forEach((r) => {
    const c = frame('规则卡', { dir: 'VERTICAL', gap: 6, fill: C.surface, stroke: C.line, radius: 14, w: 341, pad: 18 });
    add(c, txt(r[0], { size: 13, weight: 600, color: C.ink }), 'H');
    add(c, txt(r[1], { size: 12, color: C.muted, lh: 1.55 }), 'H');
    add(rules, c);
  });
  add(b.body, rules);

  add(b.body, sectionLabel('Logo 放置位（把公司 logo 图片拖到这里）', { color: C.brand }));
  const drop = frame('放置位', { dir: 'VERTICAL', gap: 8, fill: C.surfaceSoft, stroke: C.brandLine, sw: 2, radius: 16, w: 1056, h: 150, main: 'CENTER', cross: 'CENTER' });
  add(drop, txt('把公司 logo.PNG 拖入此处', { size: 15, weight: 600, color: C.brandText, align: 'CENTER' }), 'H');
  add(drop, txt('插件无法读取你本地的图片文件，这一格留给你手动放入真实 logo，再对照左右两个背景检查反白版是否可用。', { size: 12, color: C.muted, align: 'CENTER', lh: 1.6 }), 'H');
  add(b.body, drop);

  b.outer.x = x; b.outer.y = y;
  return b.outer;
}

/* ============================================================================
   主流程
   ============================================================================ */

function clearPrevious() {
  const removed = [];
  figma.root.children.forEach((page) => {
    page.children.forEach((node) => {
      if (node.getPluginData(MARK_KEY) === MARK) removed.push(node);
    });
  });
  removed.forEach((n) => n.remove());
  return removed.length;
}

async function buildAll(scope) {
  const created = [];
  const ax = 0;          // A 区 x
  const bx = 1320;       // B 区 x
  const ex = 2640;       // E 区 x
  const cy0 = 3400;      // C 区（小程序）起始 y
  const dy0 = 3400 + 2 * (812 + GAP) + 240;   // D 区（Web）起始 y

  // ---- A 区：规范基础，竖排 ----
  if (!scope || scope === 'all' || scope === 'base') {
    post({ type: 'progress', text: '正在绘制 A 区：规范基础…' });
    created.push(buildCover(ax, 0));
    created.push(buildColors(ax, 560 + GAP));
    created.push(buildType(ax, 560 + GAP + 1060 + GAP));
    created.push(buildShape(ax, 560 + GAP + 1060 + GAP + 800 + GAP));
    created.push(buildDataViz(ax, 560 + GAP + 1060 + GAP + 800 + GAP + 900 + GAP));
  }

  // ---- B 区：组件，竖排 ----
  if (!scope || scope === 'all' || scope === 'components') {
    post({ type: 'progress', text: '正在绘制 B 区：组件…' });
    created.push(buildButtons(bx, 0));
    created.push(buildCards(bx, 560 + GAP));
    created.push(buildRows(bx, 560 + GAP + 700 + GAP));
    created.push(buildForms(bx, 560 + GAP + 700 + GAP + 760 + GAP));
  }

  // ---- C 区：小程序页面，4 列 × 2 行 ----
  if (!scope || scope === 'all' || scope === 'miniprogram') {
    post({ type: 'progress', text: '正在绘制 C 区：小程序页面…' });
    const pages = [buildMpTodo, buildMpTask, buildMpCourseware, buildMpExam, buildMpRecords, buildMpGames, buildMpProfile, buildMpLogin];
    pages.forEach((fn, i) => {
      const col = i % 4, rowIdx = Math.floor(i / 4);
      created.push(fn(col * (MP_W + GAP), cy0 + rowIdx * (MP_H + GAP)));
    });
  }

  // ---- D 区：Web 后台，竖排 ----
  if (!scope || scope === 'all' || scope === 'web') {
    post({ type: 'progress', text: '正在绘制 D 区：Web 后台页面…' });
    const pages = [buildWebLogin, buildWebPortal, buildWebTraining, buildWebPeople, buildWebTrainingPlan, buildWebQualification];
    pages.forEach((fn, i) => {
      created.push(fn(0, dy0 + i * (WEB_H + GAP)));
    });
  }

  // ---- E 区：品牌 ----
  if (!scope || scope === 'all' || scope === 'base') {
    post({ type: 'progress', text: '正在绘制 E 区：品牌与图标…' });
    created.push(buildBrand(ex, 0));
  }

  // 统一打幂等标记。小程序页（mpShell）和 Web 页（webShell）的顶层 frame 不走 board()，
  // 必须在这里补齐标记，否则重跑时清不掉，画布上会翻倍堆积。
  created.forEach((n) => { try { n.setPluginData(MARK_KEY, MARK); } catch (e) { /* 忽略 */ } });

  figma.viewport.scrollAndZoomIntoView(created);
  return created.length;
}

function post(msg) { figma.ui.postMessage(msg); }

figma.showUI(__html__, { width: 400, height: 560, themeColors: true });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'build') {
    try {
      post({ type: 'log', text: '正在探测可用中文字体…' });
      await resolveFont();
      post({ type: 'log', text: '字体：' + FONT.family + '（Regular / ' + FONT.bold + '）' });
      const n = clearPrevious();
      if (n) post({ type: 'log', text: '已清理上一轮产物 ' + n + ' 个画板' });
      const total = await buildAll(msg.scope);
      post({ type: 'done', text: '完成：共绘制 ' + total + ' 个画板。' });
    } catch (e) {
      post({ type: 'error', text: '绘制失败：' + (e && e.message ? e.message : String(e)) });
    }
  }
  if (msg.type === 'clear') {
    const n = clearPrevious();
    post({ type: 'done', text: n ? '已清理 ' + n + ' 个画板' : '没有找到本插件的产物' });
  }
};

