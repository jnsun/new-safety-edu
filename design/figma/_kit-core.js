/* ===========================================================================
 * _kit-core.js — 与主题无关的 Figma 绘图核心原语
 *
 * 从 _kit.js 抽取的**公共子集**：色彩原语、字体映射、text/容器/版式骨架、
 * 小组件（tintBar / dot / chip / progress）、矢量绘制（含弧转贝塞尔的坑）、
 * 以及 btn / tag / field。
 *
 * 这里**不含**任何页面外壳与主题构件（mpShell / webShell / logoGroup 等），
 * 因此可以被任何主题的规范脚本复用。
 *
 * ⚠️ 与 _kit.js 的关系：_kit-core.js 是 _kit.js 第 1–8 节与第 10 节的副本。
 *    _kit.js 仍被 Page 1（安全生产）的分区脚本依赖，两者保持独立、互不影响。
 *    改这里的通用原语时，请同步考虑 _kit.js；反之亦然。
 *
 * 所有函数均为同步：字体在 loadFonts() 里一次性预加载，
 * 因此 text() 可以直接同步创建，不必到处 await。
 * =========================================================================== */

/* ----------------------------- 1. 色彩令牌 ----------------------------- */
const C = {
  // 品牌（logo 主环青绿）
  brandInk: '#04302A', brandDeep: '#075445', brand: '#12A17D', brandStrong: '#0C8567',
  brandText: '#0A7A5F', brandSoft: '#E4F4EF', brandLine: '#B9E1D6',
  // 强调（logo 黄绿分片）
  accent: '#C9F16B', accentStrong: '#B4E247', accentSoft: '#EEFAD2', accentInk: '#4A6600',
  // 中性
  ink: '#0F1A16', inkSoft: '#33443D', muted: '#61736B',
  line: '#E1E8E4', lineStrong: '#C9D5CF', canvas: '#F3F6F3', surface: '#FFFFFF', surfaceSoft: '#F7FAF8',
  // 语义
  success: '#0F7A57', successSoft: '#E3F4EC',
  warning: '#A85A0A', warningSoft: '#FDF1E2',
  danger: '#B8321F', dangerSoft: '#FBEAE6',
  info: '#2A5FA8', infoSoft: '#E8F0FA',
  // 其他
  track: '#E6EAE0',
  white: '#FFFFFF', black: '#000000',
};

/* --------------------------- 2. 颜色与效果原语 --------------------------- */
function hex2rgb(h) {
  const s = String(h).replace('#', '');
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return {
    r: parseInt(f.slice(0, 2), 16) / 255,
    g: parseInt(f.slice(2, 4), 16) / 255,
    b: parseInt(f.slice(4, 6), 16) / 255,
  };
}

/** SOLID 填充。注意：color 只放 {r,g,b}，透明度在 paint 层用 opacity（Rule 6）。 */
function solid(h, opacity) {
  const p = { type: 'SOLID', color: hex2rgb(h) };
  if (opacity != null) p.opacity = opacity;
  return p;
}

function rgba(h, a) {
  const c = hex2rgb(h);
  return { r: c.r, g: c.g, b: c.b, a };
}

/** 投影。阴影色相统一带绿（rgba(4,48,42,·)），不用纯黑。 */
function shadow(h, a, x, y, blur, spread) {
  return {
    type: 'DROP_SHADOW',
    color: rgba(h, a),
    offset: { x, y },
    radius: blur,
    spread: spread || 0,
    visible: true,
    blendMode: 'NORMAL',
  };
}

const SH = {
  elevation: shadow(C.brandInk, 0.05, 0, 8, 24),
  raised: shadow(C.brandInk, 0.14, 0, 18, 42),
  brand: shadow(C.brandInk, 0.18, 0, 12, 32),
};

/* ------------------------------ 3. 字体映射 ------------------------------ */
/* 实测可用 style（非斜体）：
 *   Inter        : Thin / Extra Light / Light / Regular / Medium / Semi Bold / Bold / Extra Bold / Black
 *   Noto Sans SC : Thin / DemiLight / Light / Regular / Medium / Bold / Black
 * Inter 的 style 名带空格（"Semi Bold" 而非 "SemiBold"），这是官方点名的坑。 */
const F_CJK = 'Noto Sans SC';
const F_LAT = 'Inter';

const WEIGHT_MAP = {
  [F_CJK]: [[350, 'Light'], [450, 'Regular'], [620, 'Medium'], [820, 'Bold'], [1000, 'Black']],
  [F_LAT]: [[250, 'Thin'], [350, 'Light'], [450, 'Regular'], [550, 'Medium'], [660, 'Semi Bold'], [770, 'Bold'], [880, 'Extra Bold'], [1000, 'Black']],
};

function styleFor(family, weight) {
  const t = WEIGHT_MAP[family] || WEIGHT_MAP[F_LAT];
  for (const pair of t) if (weight <= pair[0]) return pair[1];
  return t[t.length - 1][1];
}

const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF\u2010-\u203B\u00B7\u2014\u2026]/;
function hasCJK(s) { return CJK_RE.test(String(s)); }

/** 中英混排：含中日韩字符走 Noto Sans SC，纯拉丁/数字走 Inter。 */
function fontOf(str, weight) {
  const family = hasCJK(str) ? F_CJK : F_LAT;
  return { family, style: styleFor(family, weight) };
}

const _fontLoaded = new Set();
async function loadFonts() {
  const families = [
    [F_CJK, ['Light', 'Regular', 'Medium', 'Bold', 'Black']],
    [F_LAT, ['Thin', 'Light', 'Regular', 'Medium', 'Semi Bold', 'Bold', 'Extra Bold', 'Black']],
  ];
  for (const [family, styles] of families) {
    for (const style of styles) {
      await figma.loadFontAsync({ family, style });
      _fontLoaded.add(family + '|' + style);
    }
  }
  return _fontLoaded.size;
}

/* -------------------------------- 4. 文本 -------------------------------- */
/**
 * 创建文本节点。所有函数同步 —— 前提是调用方先跑过 loadFonts()。
 * 对齐 Figma 侧约定：换行文本用 textAutoResize='HEIGHT' + 固定宽度（Rule 12c）。
 */
function text(str, o) {
  o = o || {};
  const size = o.size != null ? o.size : 14;
  const weight = o.weight != null ? o.weight : 400;
  const f = fontOf(str, weight);
  const key = f.family + '|' + f.style;
  if (!_fontLoaded.has(key)) {
    throw new Error('字体未预加载：' + key + '（先在脚本开头 await loadFonts()）');
  }
  const t = figma.createText();
  t.name = o.name || ('T·' + String(str).slice(0, 20));
  t.fontName = f;
  t.characters = String(str);
  t.fontSize = size;
  t.fills = [solid(o.color != null ? o.color : C.ink, o.opacity)];
  t.textAlignHorizontal = o.align || 'LEFT';
  if (o.lh != null) t.lineHeight = { unit: 'PERCENT', value: Math.round(o.lh * 100) };
  if (o.ls != null) t.letterSpacing = { unit: 'PIXELS', value: o.ls };
  if (o.w != null) {
    t.textAutoResize = 'HEIGHT';
    t.resize(o.w, t.height);
  } else {
    t.textAutoResize = 'WIDTH_AND_HEIGHT';
  }
  if (o.decorate && o.decorate.underline) t.textDecoration = 'UNDERLINE';
  return t;
}

/* ------------------------------- 5. 容器 -------------------------------- */
/**
 * 创建容器。dir='NONE' 时不做 Auto Layout（用于绝对定位的图层）。
 * w/h 给值即固定该轴，不给即 HUG。
 */
function frame(name, o) {
  o = o || {};
  const f = figma.createFrame();
  f.name = name || 'frame';
  f.fills = o.fill == null ? [] : [solid(o.fill, o.fillOpacity)];
  f.clipsContent = o.clips === true;
  if (o.stroke) {
    f.strokes = [solid(o.stroke, o.strokeOpacity)];
    f.strokeWeight = o.sw != null ? o.sw : 1;
    f.strokeAlign = 'INSIDE';
  } else {
    f.strokes = [];
  }
  if (o.radius != null) f.cornerRadius = o.radius;
  if (o.effects) f.effects = o.effects;

  const dir = o.dir || 'NONE';
  if (dir !== 'NONE') {
    f.layoutMode = dir;
    f.itemSpacing = o.gap != null ? o.gap : 0;
    const px = o.padX != null ? o.padX : (o.pad != null ? o.pad : 0);
    const py = o.padY != null ? o.padY : (o.pad != null ? o.pad : 0);
    const pt = o.padTop != null ? o.padTop : py;
    const pb = o.padBottom != null ? o.padBottom : py;
    f.paddingLeft = px; f.paddingRight = px; f.paddingTop = pt; f.paddingBottom = pb;
    f.primaryAxisAlignItems = o.main || 'MIN';
    f.counterAxisAlignItems = o.cross || 'MIN';
    if (o.wrap) {
      f.layoutWrap = 'WRAP';
      if (o.gapY != null) f.counterAxisSpacing = o.gapY;
    }
    f.layoutSizingHorizontal = o.w != null ? 'FIXED' : 'HUG';
    f.layoutSizingVertical = o.h != null ? 'FIXED' : 'HUG';
    if (o.w != null) f.resize(o.w, f.height);
    if (o.h != null) f.resize(f.width, o.h);
  } else if (o.w != null || o.h != null) {
    f.resize(o.w != null ? o.w : f.width, o.h != null ? o.h : f.height);
  }
  return f;
}

const row = (name, o) => frame(name, Object.assign({ dir: 'HORIZONTAL' }, o));
const col = (name, o) => frame(name, Object.assign({ dir: 'VERTICAL' }, o));

/**
 * 挂载子节点并可选设置填充行为。
 * sizing: 'H' 横向填满 / 'V' 纵向填满 / 'B' 双向 / 'HUG' 收至内容。
 * 关键：FILL 必须在 appendChild 之后设置。
 */
function add(parent, child, sizing) {
  parent.appendChild(child);
  if (!sizing) return child;
  const s = String(sizing);
  const wantH = s === 'H' || s === 'B' || s === 'FILL';
  const wantV = s === 'V' || s === 'B' || s === 'FILL';
  if (wantH && 'layoutSizingHorizontal' in child) {
    if (child.type === 'TEXT' && child.textAutoResize !== 'HEIGHT') child.textAutoResize = 'HEIGHT';
    child.layoutSizingHorizontal = 'FILL';
  }
  if (wantV && 'layoutSizingVertical' in child) {
    if (child.type === 'TEXT') child.textAutoResize = 'HEIGHT';
    child.layoutSizingVertical = 'FILL';
  }
  if (s === 'HUG' && 'layoutSizingHorizontal' in child) {
    child.layoutSizingHorizontal = 'HUG';
    child.layoutSizingVertical = 'HUG';
  }
  return child;
}

/** 弹性占位，把后续内容推到远端。父级必须是 Auto Layout。
 *  两个坑：
 *  1) 不能设 layoutSizingHorizontal='FILL' —— 那要求节点已挂在自动布局父级下，
 *     脱离父级设置会抛 "node must be an auto-layout frame"；
 *  2) 必须显式 resize 到 1×1 —— createFrame 默认 100×100，不改的话会把整行撑到 100 高
 *     （实测：一排按钮的底栏被这个占位块顶成 100px 高）。 */
function flex() {
  const f = figma.createFrame();
  f.name = 'flex';
  f.fills = [];
  f.strokes = [];
  f.resize(1, 1);
  f.layoutGrow = 1;
  return f;
}

/** 固定尺寸的透明间隔块。 */
function box(w, h, name) {
  const f = figma.createFrame();
  f.name = name || 'box';
  f.fills = [];
  f.strokes = [];
  f.resize(w != null ? w : 1, h != null ? h : 1);
  return f;
}

/* --------------------------- 6. 版式骨架（画板） --------------------------- */
/**
 * 规范画板：顶部标题条（画板名 + 一句说明）+ 内容区。
 * h 传 null 即自适应高度（内容区纵向 HUG），避免内容超出被裁。
 * clips 仅在固定高度时开启。
 */
function board(name, desc, w, h, o) {
  o = o || {};
  const fixedH = h != null;
  const outer = frame('▣ ' + name, {
    dir: 'VERTICAL', w, h, gap: 0, fill: o.fill || C.surface, clips: fixedH,
  });
  const hp = o.headPadX != null ? o.headPadX : 44;
  const head = col('head', {
    padX: hp, padY: 26, gap: 6, w,
    fill: o.headFill != null ? o.headFill : C.canvas,
  });
  add(head, text(name, { size: 21, weight: 700, color: o.headInk || C.ink }), 'H');
  if (desc) {
    add(head, text(desc, { size: 12.5, weight: 400, color: o.headSub || C.muted, w: w - hp * 2, lh: 1.55 }), 'H');
  }
  add(outer, head, 'H');
  const body = col('body', { padX: 44, padY: 32, gap: 26, w, fill: o.bodyFill || C.surface });
  add(outer, body, fixedH ? 'B' : 'H');
  return { outer, head, body, w, h };
}

/** 堆叠定位器：同一个 x 上顺序竖排，自动按实际高度累加。 */
function stackAt(x, y0, gap) {
  let y = y0;
  const put = (f) => { f.x = x; f.y = y; y += f.height + gap; return f; };
  put.end = () => y - gap;
  return put;
}

/**
 * 幂等清理：删掉当前页里名字以给定前缀开头的顶层节点。
 * 每个分区脚本开头调用一次 —— 不这么做，脚本重跑会在画布上叠出第二份。
 */
function clearBoards(prefixes) {
  const removed = [];
  for (const n of Array.from(figma.currentPage.children)) {
    if (prefixes.some((p) => n.name.indexOf(p) === 0)) {
      removed.push(n.name);
      n.remove();
    }
  }
  return removed;
}

/** 网格定位器：cols 列自动换行。 */
function gridAt(x0, y0, cols, cw, ch, gapX, gapY) {
  let i = 0;
  return (f) => {
    const c = i % cols, r = Math.floor(i / cols);
    f.x = x0 + c * (cw + gapX);
    f.y = y0 + r * (ch + gapY);
    i++;
    return f;
  };
}

/* --------------------------- 7. 通用小组件 --------------------------- */
function tintBar(h, w, radius) {
  const f = figma.createFrame();
  f.name = 'tint';
  f.fills = [solid(h)];
  f.strokes = [];
  f.layoutSizingHorizontal = 'FIXED';
  f.layoutSizingVertical = 'FIXED';
  f.resize(w != null ? w : 10, 10);
  if (radius != null) f.cornerRadius = radius;
  return f;
}

/** 圆点，用于色卡与状态点。 */
function dot(h, d, stroke) {
  const e = figma.createEllipse();
  e.name = 'dot';
  e.fills = [solid(h)];
  e.strokes = stroke ? [solid(stroke)] : [];
  e.resize(d, d);
  return e;
}

/** 章节小标题（左一条 3px 品牌色指示条 + 标题）。 */
function sectionLabel(str, o) {
  o = o || {};
  const r = row('secLabel', { gap: 10, cross: 'CENTER' });
  const barEl = tintBar(o.color || C.brand, 4, 2);
  barEl.resize(4, o.size != null ? o.size + 4 : 17);
  add(r, barEl);
  add(r, text(str, { size: o.size != null ? o.size : 14, weight: 700, color: o.ink || C.ink }));
  return r;
}

/** 胶囊标签。 */
function chip(label, o) {
  o = o || {};
  const c = row('chip·' + label, {
    gap: 6, cross: 'CENTER',
    padX: o.padX != null ? o.padX : 12, padY: o.padY != null ? o.padY : 6,
    radius: 999,
    fill: o.fill,
    stroke: o.stroke,
    sw: 1,
  });
  add(c, text(label, { size: o.size != null ? o.size : 11.5, weight: o.weight != null ? o.weight : 600, color: o.color || C.muted }));
  return c;
}

/* ------------------------------ 8. 矢量绘制 ------------------------------ */
function polar(cx, cy, r, deg) {
  const a = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

const _nz = (v) => Math.round(v * 1000) / 1000;

/**
 * 生成一段圆弧路径。
 * 关键：Figma 的 vectorPaths 不接受 SVG 的 `A`（arc）指令 —— 实测报
 * "Invalid command at A"。因此这里自己把弧按 ≤90° 切段、转成三次贝塞尔（C 指令）。
 * 角度制，0° 指向 12 点方向，顺时针为正。
 */
function arcPath(cx, cy, r, a1deg, a2deg) {
  const toRad = (d) => (d - 90) * Math.PI / 180;
  const t1 = toRad(a1deg);
  const t2 = toRad(a2deg);
  const delta = t2 - t1;
  const n = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / n;
  const pt = (t) => [cx + r * Math.cos(t), cy + r * Math.sin(t)];
  const start = pt(t1);
  let d = '';
  for (let i = 0; i < n; i++) {
    const ta = t1 + step * i;
    const tb = ta + step;
    const k = (4 / 3) * Math.tan((tb - ta) / 4);
    const [p1x, p1y] = pt(ta);
    const [p2x, p2y] = pt(tb);
    const c1x = p1x + k * r * -Math.sin(ta);
    const c1y = p1y + k * r * Math.cos(ta);
    const c2x = p2x - k * r * -Math.sin(tb);
    const c2y = p2y - k * r * Math.cos(tb);
    d += ' C ' + _nz(c1x) + ' ' + _nz(c1y) + ' ' + _nz(c2x) + ' ' + _nz(c2y) + ' ' + _nz(p2x) + ' ' + _nz(p2y);
  }
  const end = pt(t2);
  return { d, start, end };
}

/** 环形扇段路径（用于 logo 分片）。外弧顺时针、内弧逆时针，NONZERO 规则下挖空。 */
function ringSegPath(size, rOut, rIn, a1, a2) {
  const c = size / 2;
  const o = arcPath(c, c, rOut, a1, a2);
  const i = arcPath(c, c, rIn, a2, a1);
  return 'M ' + _nz(o.start[0]) + ' ' + _nz(o.start[1]) + o.d
    + ' L ' + _nz(i.start[0]) + ' ' + _nz(i.start[1]) + i.d + ' Z';
}

/** 完整圆环（甜甜圈）。 */
function ringFullPath(size, rOut, rIn) {
  const c = size / 2;
  const o = arcPath(c, c, rOut, 0, 360);
  const i = arcPath(c, c, rIn, 0, -360);
  return 'M ' + _nz(o.start[0]) + ' ' + _nz(o.start[1]) + o.d + ' Z'
    + ' M ' + _nz(i.start[0]) + ' ' + _nz(i.start[1]) + i.d + ' Z';
}

function vector(pathData, name, fill) {
  const v = figma.createVector();
  v.name = name || 'vector';
  v.vectorPaths = [{ windingRule: 'NONZERO', data: pathData }];
  v.fills = fill ? [solid(fill)] : [];
  v.strokes = [];
  return v;
}

/** 计算环形扇段的包围盒（理想坐标系：方框左上角为 0,0）。 */
function ringSegBox(size, rOut, rIn, a1, a2) {
  const c = size / 2;
  const angles = [a1, a2];
  for (const base of [-360, 0, 360]) {
    for (const k of [0, 90, 180, 270, 360]) {
      const kk = k + base;
      if (kk > a1 + 1e-9 && kk < a2 - 1e-9) angles.push(kk);
    }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ang of angles) {
    for (const r of [rOut, rIn]) {
      const p = polar(c, c, r, ang);
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * 创建环形扇段矢量。
 * ⚠️ 这里有个必须记住的坑：给 VectorNode.vectorPaths 赋值后，Figma 会把路径按
 * 包围盒归一化 —— 节点原点被挪到**该段自身包围盒的左上角**，而不是路径里的 (0,0)。
 * 所以 `v.x = 0` 会让每一段各自跑偏（实测表现：环形图各段圆心不重合、图缺一块）。
 * 正确做法是把节点放到「这一段包围盒左上角本该在的位置」。
 */
function ringSegVector(size, rOut, rIn, a1, a2, color, name) {
  const box = ringSegBox(size, rOut, rIn, a1, a2);
  const v = vector(ringSegPath(size, rOut, rIn, a1, a2), name, color);
  v.x = box.minX;
  v.y = box.minY;
  return v;
}

/** 完整圆环矢量（同样要按包围盒归位，但整环包围盒即方框，故位置恒为 0,0）。 */
function ringFullVector(size, rOut, rIn, color, name) {
  const v = vector(ringFullPath(size, rOut, rIn), name, color);
  v.x = 0;
  v.y = 0;
  return v;
}
/* --------------------------- 10. 组件构件（跨区复用） --------------------------- */
/** 按钮。变体：primary / primary-dark / secondary / ghost / danger。 */
function btn(label, variant, o) {
  o = o || {};
  const h = o.h != null ? o.h : 40;
  const spec = {
    primary: { fill: C.accent, color: C.brandInk, stroke: null },
    'primary-dark': { fill: C.brandInk, color: C.white, stroke: null },
    secondary: { fill: C.surface, color: C.brandText, stroke: C.lineStrong },
    ghost: { fill: null, color: C.brandText, stroke: null },
    danger: { fill: C.dangerSoft, color: C.danger, stroke: null },
  }[variant] || {};
  const b = row('btn·' + label, {
    h, padX: o.padX != null ? o.padX : 20, gap: 6, cross: 'CENTER', main: 'CENTER',
    radius: o.radius != null ? o.radius : 8,
    fill: spec.fill, stroke: spec.stroke, sw: 1,
  });
  b.counterAxisAlignItems = 'CENTER';
  add(b, text(label, { size: o.size != null ? o.size : 13.5, weight: o.weight != null ? o.weight : 600, color: o.color || spec.color }));
  return b;
}

/** 状态标签（胶囊）。 */
function tag(label, kind) {
  const map = {
    doing: [C.brandSoft, C.brandText],
    warning: [C.warningSoft, C.warning],
    locked: [C.dangerSoft, C.danger],
    done: [C.successSoft, C.success],
    confirm: [C.infoSoft, C.info],
    neutral: [C.surfaceSoft, C.muted],
  };
  const [bg, fg] = map[kind] || map.neutral;
  return chip(label, { fill: bg, color: fg, size: 10.5, padX: 10, padY: 5, weight: 600 });
}

/** 进度条：轨道 + 填充。 */
function progress(pct, o) {
  o = o || {};
  const w = o.w != null ? o.w : 240;
  const h = o.h != null ? o.h : 6;
  const wrap = frame('progress', { dir: 'NONE', w, h, radius: 999, fill: C.track });
  const inner = tintBar(o.color || C.brand, 1, 999);
  inner.resize(Math.max(2, Math.round(w * pct)), h);
  inner.x = 0; inner.y = 0;
  add(wrap, inner);
  return wrap;
}

/** 输入框。state: normal / focus / error / disabled */
function field(label, value, state, o) {
  o = o || {};
  const w = o.w != null ? o.w : 300;
  const c = col('field', { gap: 6, w });
  add(c, text(label, { size: 11.5, weight: 600, color: C.inkSoft }), 'H');
  const spec = {
    normal: { fill: C.surface, stroke: C.line, color: C.ink },
    focus: { fill: C.surface, stroke: C.brand, color: C.ink },
    error: { fill: C.surface, stroke: C.danger, color: C.ink },
    disabled: { fill: C.canvas, stroke: C.line, color: C.muted },
  }[state || 'normal'];
  const inp = row('input', { w, h: 42, padX: 13, cross: 'CENTER', radius: 8, fill: spec.fill, stroke: spec.stroke, sw: state === 'focus' ? 2 : 1 });
  add(inp, text(value, { size: 13, weight: 400, color: spec.color }));
  add(c, inp, 'H');
  if (state === 'error') add(c, text(o.hint || '必填项，请填写身份证后 6 位', { size: 10.5, color: C.danger }), 'H');
  else if (o.hint) add(c, text(o.hint, { size: 10.5, color: C.muted }), 'H');
  return c;
}
