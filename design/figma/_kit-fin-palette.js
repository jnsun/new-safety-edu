/* ===========================================================================
 * _kit-fin-palette.js — 财务应收的**色板与常量层**（不含任何 UI 构件）
 *
 * 拆出来的原因：use_figma 单次 code 上限 5 万字符。
 * 令牌脚本只用到色板，不该被迫拖进整套 UI 构件；
 * 所以这一层只依赖 `_kit.js`（基础原语），可以被任何脚本单独 include。
 *
 * 色值来源：对 公司logo.PNG 做逐半径扫描 + 纯色像素计数实测，非目测。
 * 依据：docs/design/财务应收视觉规范-v1.md §2.2 / §4.3 / §7
 * =========================================================================== */

/* ---------------------------------------------------------------------------
 * 1. 覆盖为财务应收色板
 *
 * _kit.js 里的原语（text/frame/chip/btn/progress…）全部通过读取对象 C 取色，
 * 所以这里 Object.assign(C, …) 之后，那些原语自动适配，不必重写一遍。
 * SH（顶层已求值的阴影）不是函数、不会被重新求值，必须单独覆盖属性。
 * ------------------------------------------------------------------------- */
Object.assign(C, {
  // 深色（壳 / 承载）
  brandInk: '#0A2E28', brandDeep: '#0D3B32', brandMid: '#12564A',
  onInk: '#FFFFFF', onInk2: '#B9E8DE', onInk3: '#8FA8A0',
  // 品牌（logo 主环青绿）
  brand: '#12A289', brandStrong: '#0E8570', brandText: '#0E7A64',
  brandSoft: '#E4F4EF', brandLine: '#B9E1D6',
  // 强调（logo 黄绿）
  accent: '#BFE81E', accentStrong: '#A9D40F', accentSoft: '#E8F7C4', accentInk: '#0A2E28',
  // 中性
  ink: '#0F1A17', inkSoft: '#33443D', muted: '#5A6B66',
  line: '#E2E8E6', lineStrong: '#D5DEDB',
  canvas: '#F4F6F5', surface: '#FFFFFF', surfaceSoft: '#FAFBFA', sand: '#F6F4EF',
  // 语义：图形色 + 文字色成对（规范 §2.4 硬约束）
  warning: '#E66D1E', warningText: '#A0500C', warningSoft: '#FDF0E4',
  danger: '#B3261E', dangerSoft: '#FBEAE6',
  success: '#0B6B4B', successSoft: '#E3F4EC',
  info: '#3468A1', infoSoft: '#E8F0FA',
  neutral: '#4F5053', neutralSoft: '#EEF1F0',
  // 其他
  track: '#E6EAE0',
  white: '#FFFFFF', black: '#000000',
});

Object.assign(SH, {
  elevation: shadow(C.brandInk, 0.05, 0, 1, 2),
  raised: shadow(C.brandInk, 0.08, 0, 8, 24),
  pop: shadow(C.brandInk, 0.12, 0, 8, 24),
});

/* ---------------------------------------------------------------------------
 * 2. 栅格常量（规范 §4.3）
 * ------------------------------------------------------------------------- */
const FIN_W = 1440;                                  // 设计基准宽
const FIN_H = 900;                                   // 后台页高
const FIN_SIDE = 208;                                // 侧栏（比安全生产的 224 窄，给宽表让位）
const FIN_TOP = 56;                                  // 顶栏
const FIN_PADX = 24;                                 // 内容区左右内边距
const FIN_CW = FIN_W - FIN_SIDE - FIN_PADX * 2;      // 内容宽 = 1184

/** 侧栏菜单（依据 receivablesNavigation + resolveReceivablesRoute 的真实路由） */
const FIN_MENU = [
  ['▤', '应收账款看板', '/receivables'],
  ['▦', '应收账款台账', '/receivables/ledger'],
  ['⇅', '数据处理', '/receivables/data'],
  ['◉', '账号与权限', '/receivables/access'],
  ['⬡', '财务归属部门', '/receivables/departments'],
  ['❏', '业务字典', '/receivables/dictionaries'],
];

/* ---------------------------------------------------------------------------
 * 3. Logo —— 按实测几何重绘的**双环**结构
 *
 * 实测（源文件 1600×1600，内容包围盒 1360×1360，外半径 R）：
 *   中心孔   0     → 0.382R
 *   青绿内环 0.382R → 0.696R   （环厚 0.314R）
 *   环间缝隙 0.696R → 0.807R
 *   外圈分片 0.807R → 1.000R   （5 片，每片 72°，片间留约 5° 缝）
 *
 * 外圈角度取自八方向实测：0°=缝、45°=黄绿、90°/135°=橙、180°=灰、
 * 225°/270°=蓝、315°=青绿。polar() 的 0° 恰好也指向 12 点方向，两者对齐。
 *
 * ⚠️ 上一版（安全生产规范）画的是「单环分片」，那是简化示意；
 *    真实 logo 是双环，本版按实测重绘。
 * ------------------------------------------------------------------------- */
const LOGO_GEO = { hole: 0.382, inner: 0.696, outerIn: 0.807, outerOut: 1.0 };
const LOGO_SEGS = [
  [2.5, 69.5, 'accent'],     // 黄绿
  [74.5, 141.5, 'warning'],  // 橙
  [146.5, 213.5, 'neutral'], // 深灰
  [218.5, 285.5, 'info'],    // 蓝
  [290.5, 357.5, 'brand'],   // 青绿
];

/**
 * 完整圆环，并按路径包围盒归位。
 *
 * ⚠️ 坑：_kit-core.js 的 ringFullVector 把 v.x/v.y 写死为 0，它的注释假设
 * 「整环包围盒即方框」—— 那只在外半径等于 size/2 时成立。
 * 内环外半径只有 0.696R，其 bbox 左上角在 (c − 0.696R, c − 0.696R) ≠ (0,0)。
 * 实测表现：反白 logo 的内环整体偏向左上，与五个分片对不上，看起来像「@ 加一个逗号」。
 * 所以这里显式按 bbox 归位。
 */
function ringFullBoxed(size, rOut, rIn, color, name) {
  const c = size / 2;
  const v = vector(ringFullPath(size, rOut, rIn), name, color);
  v.x = c - rOut;
  v.y = c - rOut;
  return v;
}

/**
 * 绘制 Logo（双环）。
 * o.mono      传色值 → 单色反白版（内环 + 外圈同色，保留环间缝隙）
 * o.onlyInner 只画青绿内环（≤24px 与 favicon；分片在 40px 以下会糊）
 */
function logoMark(size, o) {
  o = o || {};
  const R = size / 2;
  const g = frame('Logo/' + size, { dir: 'NONE', w: size, h: size });
  g.fills = [];
  g.strokes = [];
  const rHole = LOGO_GEO.hole * R;
  const rInner = LOGO_GEO.inner * R;
  const rOuterIn = LOGO_GEO.outerIn * R;

  add(g, ringFullBoxed(size, rInner, rHole, o.mono || C.brand, 'ring-inner'));
  if (o.onlyInner) return g;

  if (o.mono) {
    add(g, ringFullBoxed(size, R, rOuterIn, o.mono, 'ring-outer-mono'));
  } else {
    for (const [a1, a2, key] of LOGO_SEGS) {
      add(g, ringSegVector(size, R, rOuterIn, a1, a2, C[key], 'seg-' + key));
    }
  }
  return g;
}

/* ---------------------------------------------------------------------------
 * 4. WCAG 对比度（现场计算，便于在返回值里抽检；规范里的数字都出自它）
 * ------------------------------------------------------------------------- */
function cr(a, b) {
  const L = (h) => {
    const s = String(h).replace('#', '');
    const v = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const la = L(a), lb = L(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const cr2 = (a, b) => Math.round(cr(a, b) * 100) / 100;
