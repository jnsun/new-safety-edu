//!include ./_kit.js

/* A 区 · 规范基础：封面 / 色彩系统 / 字体与字阶 / 形状与空间 / 数据可视化与渐变
 * 布局：单列竖排于 x=0，画板高度自适应。 */

await loadFonts();

/* ---------------- 对比度计算（现场算，不手写数字） ---------------- */
function lum(h) {
  const c = hex2rgb(h);
  const f = (x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function cr(a, b) {
  const l1 = lum(a), l2 = lum(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
function crVerdict(v) {
  if (v >= 4.5) return ['AA 正文', C.success];
  if (v >= 3) return ['大字/图形', C.warning];
  return ['不达标', C.danger];
}

const W = 1120;
const CW = W - 88;   // 内容宽 1032

/* ------------------------------ A0 封面 ------------------------------ */
function a0Cover() {
  const f = frame('▣ 00 · 封面', { dir: 'VERTICAL', w: W, h: 520, gap: 0, fill: C.brandInk, clips: true });

  const top = row('top', { w: W, padX: 56, padY: 36, gap: 12, cross: 'CENTER' });
  add(top, logoGroup(40, { mono: C.accent }));
  add(top, flex());
  add(top, chip('视觉规范 v1', { fill: C.brandDeep, color: C.accent, size: 11.5, padX: 14, padY: 7 }));
  add(f, top, 'H');

  const mid = col('mid', { w: W, padX: 56, gap: 16 });
  add(mid, text('安全生产培训教育平台', { size: 42, weight: 700, color: C.white, ls: -0.5 }), 'H');
  add(mid, text('深绿底座上的黄绿指针 —— 一套服务员工端与管理端的统一视觉语言', {
    size: 16, weight: 400, color: '#CFE2DC', w: CW, lh: 1.6,
  }), 'H');
  add(f, mid, 'H');

  const mid2 = col('mid2', { w: W, padX: 56, padY: 26, gap: 14 });
  const chips = row('chips', { gap: 10, wrap: true, w: CW, gapY: 10 });
  for (const t of ['色彩系统', '字体与字阶', '形状与空间', '组件库', '小程序 8 屏', '后台 6 屏', 'Logo 与图标']) {
    add(chips, chip(t, { fill: C.brandDeep, color: C.accentSoft, size: 11.5, padX: 14, padY: 7 }));
  }
  add(mid2, chips, 'H');
  add(f, mid2, 'H');

  add(f, flex(), 'H');

  const bot = row('bot', {
    w: W, padX: 56, padY: 22, gap: 20, cross: 'CENTER', fill: C.brandDeep,
  });
  add(bot, text('色彩来源：公司 logo 主环青绿 + 黄绿分片', { size: 11.5, weight: 400, color: '#9FC4B9' }), 'H');
  add(bot, flex());
  add(bot, text('对齐 WCAG 2.1 · 小程序 750rpx 栅格 · 后台 1440 栅格', { size: 11.5, weight: 400, color: '#9FC4B9' }));
  add(f, bot, 'H');

  return f;
}

/* ---------------------------- A1 色彩系统 ---------------------------- */
function colorCard(name, hex, cssVar, use) {
  const c = col('sw·' + name, { gap: 7, w: 160 });
  const sw = frame('swatch', { w: 160, h: 62, radius: 8, fill: hex, stroke: C.line, sw: 1 });
  add(c, sw, 'H');
  add(c, text(name, { size: 12, weight: 700, color: C.ink }), 'H');
  add(c, text(hex.toUpperCase(), { size: 11, weight: 500, color: C.inkSoft }), 'H');
  add(c, text(cssVar, { size: 10, weight: 400, color: C.brandText }), 'H');
  add(c, text(use, { size: 10.5, weight: 400, color: C.muted, w: 160, lh: 1.45 }), 'H');
  return c;
}

const COLOR_GROUPS = [
  {
    label: '品牌色 Brand — 来自 logo 主环青绿', color: C.brand,
    items: [
      ['brand/ink', C.brandInk, '--brand-ink', '最深墨绿。员工端欢迎区、主任务卡底色；后台侧栏底色'],
      ['brand/deep', C.brandDeep, '--brand-deep', '深青绿。权威数据面板、深色卡片次级层'],
      ['brand/base', C.brand, '--brand', '品牌主青绿（logo 主环）。图形、进度条、图标、大面积色块'],
      ['brand/strong', C.brandStrong, '--brand-strong', '青绿的悬停/按下；可读下限 4.6:1，16px 以上文字可用'],
      ['brand/text', C.brandText, '--brand-text', '青绿系唯一允许做正文和链接的档位（5.3:1）'],
      ['brand/soft', C.brandSoft, '--brand-soft', '浅底：选中态、信息条、标签底'],
      ['brand/line', C.brandLine, '--brand-line', '浅描边、分隔'],
    ],
  },
  {
    label: '强调色 Accent — 来自 logo 黄绿分片', color: C.accentInk,
    items: [
      ['accent/base', C.accent, '--accent', '主按钮底色（配 brand/ink 文字，11.14:1）。也用于 Hero 装饰块'],
      ['accent/strong', C.accentStrong, '--accent-strong', '黄绿的悬停/按下'],
      ['accent/soft', C.accentSoft, '--accent-soft', '浅底：待办计数、标签'],
      ['accent/ink', C.accentInk, '--accent-ink', '黄绿浅底上的深色文字（5.1:1）'],
    ],
  },
  {
    label: '中性色 Neutral', color: C.muted,
    items: [
      ['neutral/ink', C.ink, '--ink', '标题与正文（带绿相的黑，比纯黑柔和）'],
      ['neutral/ink-soft', C.inkSoft, '--ink-soft', '次级正文、表单值'],
      ['neutral/muted', C.muted, '--muted', '说明、元信息、占位（白底 5.03:1，画布 4.62:1）'],
      ['neutral/line', C.line, '--line', '常规分隔与描边'],
      ['neutral/line-strong', C.lineStrong, '--line-strong', '输入框、次级按钮描边'],
      ['neutral/canvas', C.canvas, '--canvas', '页面底色（比原 #F4F5F7 多一点绿相）'],
      ['neutral/surface', C.surface, '--surface', '卡片与容器'],
      ['neutral/surface-soft', C.surfaceSoft, '--surface-soft', '卡片内嵌层、表头'],
      ['neutral/track', C.track, '--track', '进度条轨道'],
    ],
  },
  {
    label: '语义色 Semantic — 来自 logo 的橙与蓝分片', color: C.danger,
    items: [
      ['success', C.success, '--success', '已完成、通过、已确认（浅底 #E3F4EC）'],
      ['warning', C.warning, '--warning', '待补学、即将到期、需补学后重考（浅底 #FDF1E2）'],
      ['danger', C.danger, '--danger', '未通过、已锁定、逾期、不可用（浅底 #FBEAE6）'],
      ['info', C.info, '--info', '中性提示、外部链接、受控 HTML 课件标识（浅底 #E8F0FA）'],
    ],
  },
];

const CONTRAST_TESTS = [
  ['正文墨色 / 白底', C.ink, C.surface],
  ['次级正文 / 白底', C.inkSoft, C.surface],
  ['说明文字 / 白底', C.muted, C.surface],
  ['主按钮：墨绿字 / 黄绿底', C.brandInk, C.accent],
  ['品牌正文档 / 白底', C.brandText, C.surface],
  ['品牌主青绿 / 白底（仅图形）', C.brand, C.surface],
  ['白字 / 墨绿底', C.white, C.brandInk],
  ['白字 / 青绿底（不达正文）', C.white, C.brand],
  ['成功色 / 白底', C.success, C.surface],
  ['警示色 / 白底', C.warning, C.surface],
  ['危险色 / 白底', C.danger, C.surface],
  ['信息色 / 白底', C.info, C.surface],
  ['说明文字 / 画布底', C.muted, C.canvas],
];

function a1Colors() {
  const b = board('01 · 色彩系统', '令牌 → 变量 → CSS 变量三层一一对应。色值来自公司 logo；每个色卡下方标注用途与实测对比度判定。', W, null);

  for (const g of COLOR_GROUPS) {
    add(b.body, sectionLabel(g.label, { color: g.color }), 'H');
    const r = row('grid', { gap: 12, gapY: 18, wrap: true, w: CW });
    for (const [n, hex, cv, use] of g.items) add(r, colorCard(n, hex, cv, use));
    add(b.body, r, 'H');
  }

  // 语义色成对呈现（底 + 字）
  add(b.body, sectionLabel('语义色配对（浅底 + 深字，成对使用）', { color: C.info }), 'H');
  const pairs = row('pairs', { gap: 12, w: CW });
  const pairDefs = [
    ['进行中 / 待学习', C.brandSoft, C.brandText],
    ['待补学', C.warningSoft, C.warning],
    ['已锁定', C.dangerSoft, C.danger],
    ['已完成', C.successSoft, C.success],
    ['待现场确认', C.infoSoft, C.info],
    ['未开通 / 不适用', C.surfaceSoft, C.muted],
  ];
  for (const [label, bg, fg] of pairDefs) {
    const c = col('pair', { gap: 8, fill: bg, radius: 12, padX: 14, padY: 14 });
    add(c, tag(label, 'neutral'), null);
    c.children[0].fills = [solid(bg)];
    c.children[0].strokes = [];
    c.children[0].query('TEXT').set({ fills: [solid(fg)] });
    add(c, text('对比度 ' + cr(fg, bg) + ':1', { size: 10, weight: 500, color: fg }), 'H');
    add(pairs, c, 'H');
  }
  add(b.body, pairs, 'H');

  // 对比度实测
  add(b.body, sectionLabel('对比度实测（WCAG 2.1，脚本现场计算）', { color: C.ink }), 'H');
  const tbl = col('crTable', { gap: 0, w: CW, radius: 12, stroke: C.line, sw: 1, clips: true });
  const hd = row('crHead', { w: CW, gap: 0, fill: C.surfaceSoft });
  const cols = [['用途', 380], ['前景', 150], ['背景', 150], ['实测', 120], ['判定', 232]];
  for (const [t, w] of cols) {
    const cell = col('th', { w, padX: 14, padY: 10 });
    add(cell, text(t, { size: 11.5, weight: 700, color: C.inkSoft }), 'H');
    add(hd, cell);
  }
  add(tbl, hd, 'H');
  CONTRAST_TESTS.forEach((t, i) => {
    const [label, fg, bg] = t;
    const v = cr(fg, bg);
    const [verdict, vc] = crVerdict(v);
    const r = row('crRow', { w: CW, gap: 0, fill: i % 2 ? C.surfaceSoft : C.surface });
    const cells = [
      [label, 380, C.ink, 400], [null, 150, null, 0], [null, 150, null, 0],
      [v + ':1', 120, vc, 700], [verdict, 232, vc, 600],
    ];
    for (let ci = 0; ci < cells.length; ci++) {
      const [txt, w, color, weight] = cells[ci];
      const cell = row('td', { w, padX: 14, padY: 9, cross: 'CENTER', gap: 8 });
      if (ci === 0) add(cell, text(txt, { size: 11.5, weight: weight, color: color }));
      else if (ci === 1 || ci === 2) {
        const c = ci === 1 ? fg : bg;
        add(cell, dot(c, 14, C.line));
        add(cell, text(c.toUpperCase(), { size: 10.5, weight: 500, color: C.muted }));
      } else add(cell, text(txt, { size: 11.5, weight: weight, color: color }));
      add(r, cell);
    }
    add(tbl, r, 'H');
  });
  add(b.body, tbl, 'H');

  add(b.body, text('判定口径：≥4.5:1 为 AA 正文合格；3.0–4.5 仅可用于 18px 以上大字或图形；低于 3.0 不得使用。'
    + '青绿主色 #12A17D 配白字只有 ' + cr(C.white, C.brand) + ':1，因此它只用于图形与大色块，正文一律降档到 --brand-text。', {
    size: 11.5, weight: 400, color: C.muted, w: CW, lh: 1.6,
  }), 'H');

  return b.outer;
}

/* --------------------------- A2 字体与字阶 --------------------------- */
function typeRow(role, sample, spec, sampleSize, sampleWeight, opts) {
  opts = opts || {};
  const r = row('tyRow·' + role, { w: CW, gap: 16, cross: 'CENTER', padY: 12, stroke: C.line, sw: 1 });
  r.strokes = [solid(C.line)];
  r.strokeAlign = 'INSIDE';
  r.strokeWeight = 0;
  const l = col('role', { w: 130, gap: 3 });
  add(l, text(role, { size: 11.5, weight: 700, color: C.ink }), 'H');
  add(l, text(spec, { size: 10, weight: 400, color: C.muted, w: 130, lh: 1.4 }), 'H');
  add(r, l);
  const s = col('sample', { gap: 4 });
  add(s, text(sample, {
    size: sampleSize, weight: sampleWeight, color: opts.color || C.ink, lh: opts.lh || 1.35,
  }), 'H');
  add(r, s, 'H');
  return r;
}

function a2Type() {
  const b = board('02 · 字体与字阶', '字体栈全平台统一。层级规则：一屏之内只允许一个 Display 级元素，它是屏幕的眼神焦点。', W, null);

  add(b.body, sectionLabel('字体栈与排版规则', { color: C.brand }), 'H');
  const stack = col('stack', { gap: 14, w: CW, fill: C.brandInk, radius: 12, padX: 20, padY: 18 });
  add(stack, text('-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif',
    { size: 12.5, weight: 500, color: C.accent, lh: 1.6, w: CW - 40 }), 'H');
  add(stack, text('数字统一启用等宽数字 font-variant-numeric: tabular-nums —— 成绩、进度、人数、金额必须对齐。'
    + '西文与数字在规范文件中使用 Inter，中文使用 Noto Sans SC；本文件中按内容自动切换。',
    { size: 11.5, weight: 400, color: '#9FC4B9', w: CW - 40, lh: 1.6 }), 'H');
  add(b.body, stack, 'H');

  add(b.body, sectionLabel('小程序字阶（375px 设计基准，rpx = 2px）', { color: C.brandText }), 'H');
  const mini = [
    ['Display', '王建国，你好', '28px · 700 · 行高 115% · 字距 -1.2rpx · 欢迎语中的姓名', 28, 700, { lh: 1.15 }],
    ['H1 页面标题', '我的待办任务', '22px · 700 · 行高 122% · 字距 -0.5rpx', 22, 700],
    ['H2 区块标题', '本周需要完成', '17px · 700 · 行高 135%', 17, 700],
    ['H3 卡片标题', '高处作业安全规程', '16px · 600 · 行高 135%', 16, 600],
    ['Body-L 正文', '请在线学习完成后参加考试，80 分为合格线。', '15px · 400 · 行高 155%', 15, 400],
    ['Body 说明', '共 3 节 · 预计 24 分钟', '14px · 400 · 行高 155%', 14, 400],
    ['Caption 次要', '截止 2026-09-30 18:00', '12.5px · 500 · 行高 145%', 12.5, 500, { color: C.muted }],
    ['Micro 微标', '待补学', '11px · 600 · 行高 130% · 字距 0.2rpx', 11, 600, { color: C.brandText }],
  ];
  const mt = col('miniTable', { gap: 0, w: CW });
  for (const [role, sample, spec, sz, wt, o] of mini) add(mt, typeRow(role, sample, spec, sz, wt, o), 'H');
  add(b.body, mt, 'H');

  add(b.body, sectionLabel('Web 后台字阶（px）', { color: C.brandText }), 'H');
  const web = [
    ['Page Title', '培训任务管理', '22px · 700 · 行高 28px', 22, 700],
    ['Section', '任务完成情况', '16px · 600 · 行高 24px', 16, 600],
    ['Body', '筛选条件：2026 年第三季度 · 全部部门', '14px · 400 · 行高 22px', 14, 400],
    ['Table', '工程物探部 · 应完成 128 人 · 已完成 96 人', '13px · 400 · 行高 20px', 13, 400],
    ['Label', '所属部门', '12px · 600 · 行高 18px', 12, 600, { color: C.muted }],
    ['Metric', '128 / 156', '34px · 700 · 行高 40px · 等宽数字', 34, 700, { color: C.brandInk }],
  ];
  const wt = col('webTable', { gap: 0, w: CW });
  for (const [role, sample, spec, sz, w2, o] of web) add(wt, typeRow(role, sample, spec, sz, w2, o), 'H');
  add(b.body, wt, 'H');

  add(b.body, sectionLabel('等宽数字（成绩 / 人数必须对齐）', { color: C.warning }), 'H');
  const numRow = row('nums', { gap: 10, w: CW, wrap: true, gapY: 10 });
  for (const v of ['86.5', '100.0', '72.0', '9.5', '128', '1,024']) {
    const c = col('num', { fill: C.surfaceSoft, radius: 8, stroke: C.line, sw: 1, padX: 16, padY: 12, gap: 4 });
    add(c, text(v, { size: 24, weight: 700, color: C.brandInk }), 'H');
    add(c, text('Inter · 700', { size: 9.5, weight: 400, color: C.muted }), 'H');
    add(numRow, c);
  }
  add(b.body, numRow, 'H');

  return b.outer;
}

/* --------------------------- A3 形状与空间 --------------------------- */
function radiusTile(name, r, use) {
  const c = col('r·' + name, { gap: 8, w: 190 });
  const s = frame('shape', { w: 190, h: 84, radius: r, fill: C.brandSoft, stroke: C.brandLine, sw: 1 });
  add(c, s, 'H');
  add(c, text(name, { size: 12, weight: 700, color: C.ink }), 'H');
  add(c, text(use, { size: 10.5, weight: 400, color: C.muted, w: 190, lh: 1.45 }), 'H');
  return c;
}

function a3Shape() {
  const b = board('03 · 形状与空间', '大圆角是本套视觉的签名特征，但圆角只表达容器层级 —— 不要把每段文字都包成胶囊。', W, null);

  add(b.body, sectionLabel('圆角 radius', { color: C.brand }), 'H');
  const rr = row('radii', { gap: 14, w: CW });
  for (const [n, r, u] of [
    ['radius/card 36rpx · 16px', 16, '卡片、面板（沿用小程序现值）'],
    ['radius/panel 28rpx · 12px', 12, '内嵌分区、表格容器、图片'],
    ['radius/control 24rpx · 8px', 8, '按钮、输入框'],
    ['radius/tile 18rpx · 6px', 6, '图标底、计数徽标'],
    ['radius/chip 999rpx', 999, '胶囊标签、筛选器'],
  ]) add(rr, radiusTile(n, r, u));
  add(b.body, rr, 'H');

  add(b.body, sectionLabel('间距 space（基础单位 4px / 8rpx）', { color: C.brand }), 'H');
  const spaceCol = col('spaces', { gap: 10, w: CW });
  for (const [n, v, use] of [
    ['space/xs', 4, '基础单位'], ['space/sm', 8, '紧凑间距'], ['space/md', 12, '组件内间距'],
    ['space/lg', 16, '卡片间间距'], ['space/xl', 24, '区块间间距'], ['space/2xl', 32, '页面内边距'], ['space/3xl', 48, '大区块分隔'],
  ]) {
    const r = row('sp', { gap: 12, cross: 'CENTER', w: CW });
    add(r, text(n, { size: 11.5, weight: 600, color: C.inkSoft, w: 120 }), null);
    const bar = tintBar(C.brand, v * 2, 3);
    bar.resize(v * 2, 10);
    add(r, bar, null);
    add(r, text(String(v) + 'px', { size: 11, weight: 600, color: C.brandText, w: 56 }), null);
    add(r, text(use, { size: 11, weight: 400, color: C.muted }), null);
    add(spaceCol, r, 'H');
  }
  add(b.body, spaceCol, 'H');
  add(b.body, text('页面水平内边距：小程序 32rpx；后台 1440px 视口 28px。卡片内边距：小程序 32rpx；后台 20–24px。'
    + '列表行最小高度：小程序 104rpx；后台 48px。', { size: 11.5, weight: 400, color: C.muted, w: CW, lh: 1.6 }), 'H');

  add(b.body, sectionLabel('阴影 elevation', { color: C.brand }), 'H');
  const sr = row('shadows', { gap: 20, w: CW });
  const shadowDefs = [
    ['Elevation/Regular', SH.elevation, '常规卡片 0 8rpx 24rpx rgba(4,48,42,.05)', false],
    ['Elevation/Raised', SH.raised, '主任务卡 0 18rpx 42rpx rgba(4,48,42,.14)', false],
    ['Elevation/Brand', SH.brand, '深色权威面板 0 12px 32px rgba(4,48,42,.18)', true],
  ];
  for (const [n, eff, use, isDark] of shadowDefs) {
    const c = col('shadow', { gap: 12, w: 330 });
    const card = col('demo', {
      h: 96, fill: isDark ? C.brandInk : C.surface, radius: 16, padX: 18, padY: 16, gap: 6, effects: [eff],
    });
    add(card, text(n, { size: 12, weight: 700, color: isDark ? C.accent : C.ink }), 'H');
    add(card, text(use, { size: 10.5, weight: 400, color: isDark ? '#9FC4B9' : C.muted, w: 294, lh: 1.45 }), 'H');
    add(c, card, 'H');
    add(sr, c);
  }
  add(b.body, sr, 'H');
  add(b.body, text('阴影色相统一带绿 rgba(4,48,42,…)，不用纯黑，避免灰调与画面里的青绿打架。筛选条一律无阴影。',
    { size: 11.5, weight: 400, color: C.muted, w: CW }), 'H');

  add(b.body, sectionLabel('栅格', { color: C.brand }), 'H');
  const gr = row('grids', { gap: 24, w: CW });
  // 小程序栅格
  {
    const c = col('mpGrid', { gap: 10, w: 340 });
    add(c, text('小程序 · 750rpx 单列流式', { size: 12, weight: 700, color: C.ink }), 'H');
    const g = frame('grid', { dir: 'NONE', w: 340, h: 190, radius: 10, fill: C.canvas, stroke: C.line, sw: 1 });
    const inner = frame('inner', { dir: 'NONE', w: 300, h: 150, radius: 6, fill: C.brandSoft });
    inner.x = 20; inner.y = 20;
    add(g, inner);
    const lab = text('690rpx 内容宽 · 32rpx 边距', { size: 10, weight: 600, color: C.brandText });
    lab.x = 20; lab.y = 24;
    add(g, lab);
    add(c, g, 'H');
    add(c, text('单列流式，最大内容宽 690rpx，页面级禁止横向滚动。', { size: 10.5, weight: 400, color: C.muted, w: 340, lh: 1.45 }), 'H');
    add(gr, c);
  }
  // 后台栅格
  {
    const c = col('webGrid', { gap: 10, w: 340 });
    add(c, text('后台 · 1440 栅格', { size: 12, weight: 700, color: C.ink }), 'H');
    const g = frame('grid', { dir: 'NONE', w: 340, h: 190, radius: 10, fill: C.canvas, stroke: C.line, sw: 1 });
    const sb = frame('side', { dir: 'NONE', w: 53, h: 190, fill: C.brandInk });
    sb.x = 0; sb.y = 0; sb.cornerRadius = 10;
    add(g, sb);
    const top = frame('top', { dir: 'NONE', w: 287, h: 15, fill: C.surface, stroke: C.line, sw: 1 });
    top.x = 53; top.y = 0;
    add(g, top);
    const ct = frame('content', { dir: 'NONE', w: 273, h: 161, fill: C.surfaceSoft, radius: 4 });
    ct.x = 60; ct.y = 22;
    add(g, ct);
    // 标注放在图下方，避免压在深色侧栏上读不清
    const lg = col('legend', { gap: 5, w: 340 });
    for (const [swatch, text2] of [
      [C.brandInk, '侧栏 224px 固定（深墨绿 --brand-ink）'],
      [C.surface, '顶栏 64px（白底 + --line 下边线）'],
      [C.surfaceSoft, '内容区 28px 内边距，1280px 收至 22px，1920px 放宽至 48px'],
    ]) {
      const r = row('lg', { gap: 7, cross: 'MIN' });
      const d = tintBar(swatch, 10, 2);
      d.resize(10, 10);
      add(r, d);
      const t = text(text2, { size: 10.5, weight: 400, color: C.muted, w: 320, lh: 1.45 });
      add(r, t, 'H');
      add(lg, r, 'H');
    }
    add(c, g, 'H');
    add(c, lg, 'H');
    add(gr, c);
  }
  add(b.body, gr, 'H');

  return b.outer;
}

/* ----------------------- A4 数据可视化与渐变 ----------------------- */
function a4Data() {
  const b = board('04 · 数据可视化与渐变', '图表按固定色序取色，不额外发明颜色。渐变只保留两条，方向固定 135deg。', W, null);

  add(b.body, sectionLabel('图表色序', { color: C.brand }), 'H');
  const seq = ['#12A17D', '#C9F16B', '#2A5FA8', '#A85A0A', '#61736B', '#0C8567'];
  const sr = row('seq', { gap: 0, w: CW, radius: 10, clips: true });
  for (const h of seq) {
    const c = col('sq', { h: 62, fill: h, main: 'MAX' });
    add(c, text(h.toUpperCase(), { size: 10, weight: 600, color: h === '#C9F16B' ? C.brandInk : C.white }), null);
    c.paddingLeft = 10; c.paddingBottom = 8;
    add(sr, c, 'H');
  }
  add(b.body, sr, 'H');
  add(b.body, text('顺序即优先级：1 品牌青绿 → 2 黄绿 → 3 蓝 → 4 橙 → 5 灰 → 6 深青绿。'
    + '例外：财务与金额相关图表沿用中国习惯 —— 涨用红 ' + C.danger + '、跌用绿 ' + C.success + '。',
    { size: 11.5, weight: 400, color: C.muted, w: CW, lh: 1.6 }), 'H');

  // 迷你图表示例
  const charts = row('charts', { gap: 20, w: CW });
  {
    const c = col('barChart', { gap: 12, w: 330, fill: C.surface, stroke: C.line, sw: 1, radius: 12, padX: 18, padY: 16 });
    add(c, text('部门完成率对比', { size: 12.5, weight: 700, color: C.ink }), 'H');
    const plot = col('plot', { gap: 8, w: 294 });
    const bars = [['工程物探部', 0.92], ['地质勘查部', 0.78], ['测绘工程部', 0.64], ['机关科室', 0.86]];
    for (const [dept, pct] of bars) {
      const r = row('bar', { gap: 8, cross: 'CENTER', w: 294 });
      add(r, text(dept, { size: 10.5, weight: 500, color: C.inkSoft, w: 68 }), null);
      add(r, progress(pct, { w: 168, h: 8 }), null);
      add(r, text(Math.round(pct * 100) + '%', { size: 10.5, weight: 700, color: C.brandInk, w: 36 }), null);
      add(plot, r, 'H');
    }
    add(c, plot, 'H');
    add(charts, c);
  }
  {
    const c = col('donut', { gap: 12, w: 330, fill: C.surface, stroke: C.line, sw: 1, radius: 12, padX: 18, padY: 16 });
    add(c, text('任务状态构成', { size: 12.5, weight: 700, color: C.ink }), 'H');
    const chart = row('chart', { gap: 18, cross: 'CENTER' });
    const ring = frame('ring', { dir: 'NONE', w: 112, h: 112 });
    // 用同心圆环分段模拟环形图（分段定位必须走 ringSegVector，见 _kit.js 里的坑说明）
    let acc = 0;
    for (const [pct, color] of [[0.52, C.brand], [0.24, C.accent], [0.14, C.info], [0.10, C.muted]]) {
      add(ring, ringSegVector(112, 56, 38, acc * 360, (acc + pct) * 360 - 2.4, color, 'seg'));
      acc += pct;
    }
    add(chart, ring);
    const legend = col('legend', { gap: 7 });
    for (const [label, color, v] of [['已完成', C.brand, '52%'], ['进行中', C.accent, '24%'], ['待补学', C.info, '14%'], ['未开始', C.muted, '10%']]) {
      const r = row('lg', { gap: 7, cross: 'CENTER' });
      add(r, dot(color, 10));
      add(r, text(label, { size: 10.5, weight: 500, color: C.inkSoft, w: 52 }));
      add(r, text(v, { size: 10.5, weight: 700, color: C.ink }));
      add(legend, r, 'H');
    }
    add(chart, legend);
    add(c, chart, 'H');
    add(charts, c);
  }
  add(b.body, charts, 'H');

  add(b.body, sectionLabel('渐变（仅两条，方向固定 135deg）', { color: C.brandDeep }), 'H');
  const grads = row('grads', { gap: 20, w: CW });
  for (const [cv, from, to, use] of [
    ['--gradient-brand', C.brand, C.brandDeep, '品牌面：卡片装饰、图表强调、徽章'],
    ['--gradient-hero', C.brandDeep, C.brandInk, '员工端 Hero 深底：欢迎区、主任务卡'],
  ]) {
    const c = col('grad', { gap: 10, w: 506 });
    const g = frame('g', { w: 506, h: 110, radius: 12 });
    g.fills = [{
      type: 'GRADIENT_LINEAR',
      gradientTransform: [[0.7071, 0.7071, 0], [-0.7071, 0.7071, 0]],
      gradientStops: [
        { position: 0, color: Object.assign(hex2rgb(from), { a: 1 }) },
        { position: 1, color: Object.assign(hex2rgb(to), { a: 1 }) },
      ],
    }];
    add(c, g, 'H');
    add(c, text(cv + '  ·  ' + from + ' → ' + to, { size: 11, weight: 600, color: C.inkSoft, w: 506 }), 'H');
    add(c, text(use, { size: 10.5, weight: 400, color: C.muted, w: 506 }), 'H');
    add(grads, c);
  }
  add(b.body, grads, 'H');
  add(b.body, text('页面和组件不得自行声明渐变（沿用 scripts/check-miniprogram-ui-system.mjs 的既有约束，'
    + '只是把 --blue-gradient 换成 --gradient-brand）。', { size: 11.5, weight: 400, color: C.muted, w: CW }), 'H');

  return b.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const cleared = clearBoards(['▣ 0']);
const put = stackAt(0, 0, 200);
put(a0Cover());
put(a1Colors());
put(a2Type());
put(a3Shape());
put(a4Data());

return {
  分区: 'A · 规范基础',
  画板数: 5,
  清理旧画板: cleared,
  本区高度: put.end(),
  对比度抽检: {
    '墨绿字/黄绿底': cr(C.brandInk, C.accent),
    '品牌正文档/白底': cr(C.brandText, C.surface),
    '白字/青绿底(应<3)': cr(C.white, C.brand),
    '说明文字/画布底': cr(C.muted, C.canvas),
  },
};
