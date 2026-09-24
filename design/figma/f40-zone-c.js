//!include ./_kit.js

/* C 区 · 微信小程序（员工端）8 个关键页
 * 布局：4 列 × 2 行，起点 x=2640，列距 120。每屏 375×812。 */

await loadFonts();

const ZX = 2640;
const GAPC = 120;

/* ------------------------------ 局部组件 ------------------------------ */
const PAD = 16;            // 页面水平内边距 32rpx
const CWm = MP_W - PAD * 2; // 内容宽 343

/** 页面导航条。 */
function mpNav(title, o) {
  o = o || {};
  const r = row('nav', { w: MP_W, h: 48, padX: PAD, gap: 6, cross: 'CENTER', fill: o.fill != null ? o.fill : null });
  if (o.back !== false) add(r, text('‹', { size: 22, weight: 500, color: o.ink || C.ink }), null);
  add(r, text(title, { size: 17, weight: 700, color: o.ink || C.ink }), 'H');
  r.children[r.children.length - 1].textAlignHorizontal = 'CENTER';
  if (o.right) add(r, o.right, null);
  else add(r, box(14, 1), null);
  // 用绝对定位把标题居中
  return r;
}

/** 页面内容区（带水平内边距的竖排）。 */
function mpBody(o) {
  o = o || {};
  return col('内容', { gap: o.gap != null ? o.gap : 12, padX: PAD, padY: o.padY != null ? o.padY : 12, fill: o.fill != null ? o.fill : C.canvas });
}

/** 小程序里的输入框（高 48 ≈ 96rpx）。 */
function mpField(label, value, o) {
  o = o || {};
  const c = col('f', { gap: 6, w: CWm });
  add(c, text(label, { size: 12, weight: 600, color: o.labelColor || C.inkSoft }), 'H');
  const inp = row('inp', { w: CWm, h: 48, padX: 14, cross: 'CENTER', radius: 12, fill: o.fill || C.surface, stroke: o.stroke || C.line, sw: 1.5 });
  add(inp, text(value, { size: 14, weight: 400, color: o.valueColor || C.ink }));
  if (o.unit) { add(inp, flex()); add(inp, text(o.unit, { size: 12, color: C.muted })); }
  add(c, inp, 'H');
  if (o.hint) add(c, text(o.hint, { size: 10.5, weight: 400, color: o.hintColor || C.muted, w: CWm, lh: 1.45 }), 'H');
  return c;
}

/** 小程序里的任务行（紧凑版，整行是一个可点单元）。 */
function mpTaskRow(title, meta, pct, tagLabel, kind, cta, o) {
  o = o || {};
  const c = col('task', { gap: 7, w: CWm, fill: C.surface, radius: 14, padX: 14, padY: 10, stroke: C.line, sw: 1 });
  const top = row('top', { gap: 8, cross: 'CENTER' });
  add(top, text(title, { size: 14.5, weight: 600, color: C.ink }), 'H');
  add(top, tag(tagLabel, kind), null);
  add(c, top, 'H');
  add(c, text(meta, { size: 11, weight: 400, color: C.muted }), 'H');
  add(c, progress(pct, { w: CWm - 28, h: 6, color: o.barColor || C.brand }), 'H');
  const f = row('f', { gap: 8, cross: 'CENTER' });
  add(f, text('下一步：' + cta, { size: 11.5, weight: 600, color: C.brandText }), 'H');
  add(f, flex());
  add(f, text(Math.round(pct * 100) + '%', { size: 11, weight: 700, color: C.inkSoft }));
  add(f, text('›', { size: 14, weight: 700, color: C.muted }));
  add(c, f, 'H');
  return c;
}

/** 小程序里的胶囊筛选行（横向）。 */
function mpChips(items, activeIdx) {
  const r = row('chips', { gap: 8, w: CWm });
  items.forEach((t, i) => {
    add(r, i === activeIdx
      ? chip(t, { fill: C.brandSoft, color: C.brandText, size: 12, padX: 14, padY: 7, weight: 700 })
      : chip(t, { fill: C.surface, color: C.muted, stroke: C.line, size: 12, padX: 14, padY: 7 }));
  });
  return r;
}

/* ============================ M1 待办（首页） ============================ */
function m1Todo() {
  const s = mpShell('20 · 待办（首页）', { fill: C.canvas });
  // 状态栏与 Hero 连成一片深墨绿
  s.sb.fills = [solid(C.brandInk)];
  s.sb.children[0].fills = [solid(C.white)];
  s.sb.children[2].fills = [solid(C.white)];

  const hero = col('Hero', { w: MP_W, fill: C.brandInk, padX: PAD, padY: 4, gap: 10 });
  hero.paddingBottom = 12;
  add(hero, text('王建国，你好', { size: 28, weight: 700, color: C.white, ls: -0.6 }), 'H');
  add(hero, text('本周有 3 项培训待完成，先做最紧急的那项', { size: 12.5, weight: 400, color: '#CFE2DC', w: CWm }), 'H');
  const pr = col('progress', { gap: 7, w: CWm, fill: C.brandDeep, radius: 12, padX: 14, padY: 12 });
  const pt = row('pt', { gap: 8, cross: 'CENTER' });
  add(pt, text('季度学习进度', { size: 11.5, weight: 500, color: '#CFE2DC' }), 'H');
  add(pt, flex());
  add(pt, text('4 / 7', { size: 15, weight: 700, color: C.accent }));
  add(pr, pt, 'H');
  add(pr, progress(4 / 7, { w: CWm - 28, h: 6, color: C.accent }), 'H');
  add(hero, pr, 'H');
  add(s.body, hero, 'H');

  const body = mpBody({ gap: 10, padY: 10 });
  add(s.body, body, 'B');

  // 主任务卡（黄绿）
  const main = col('主任务卡', { gap: 8, w: CWm, fill: C.accent, radius: 16, padX: 16, padY: 12 });
  add(main, text('现在先做', { size: 10.5, weight: 700, color: C.accentInk, ls: 0.4 }), 'H');
  add(main, text('高处作业安全规程', { size: 17, weight: 700, color: C.brandInk }), 'H');
  add(main, text('今天是截止日，还需 16 分钟', { size: 11.5, weight: 400, color: C.brandInk, opacity: 0.78 }), 'H');
  const mf = row('mf', { gap: 8, cross: 'CENTER' });
  add(mf, progress(0.34, { w: 150, h: 6, color: C.brandInk }), null);
  add(mf, text('34%', { size: 11, weight: 700, color: C.brandInk }));
  add(mf, flex());
  add(mf, btn('继续完成', 'primary-dark', { h: 34, padX: 14, size: 12.5 }));
  add(main, mf, 'H');
  add(body, main, 'H');

  // 区块标题与筛选胶囊并到一行，省一行高度
  const listHead = row('listHead', { gap: 8, w: CWm, cross: 'CENTER' });
  add(listHead, text('全部待办', { size: 15, weight: 700, color: C.ink }), null);
  add(listHead, flex(), null);
  for (const [t2, on] of [['全部', true], ['进行中', false], ['未开始', false]]) {
    add(listHead, on
      ? chip(t2, { fill: C.brandSoft, color: C.brandText, size: 11.5, padX: 11, padY: 6, weight: 700 })
      : chip(t2, { fill: C.surface, color: C.muted, stroke: C.line, size: 11.5, padX: 11, padY: 6 }), null);
  }
  add(body, listHead, 'H');
  add(body, mpTaskRow('起重机械安全操作', '课件学习 · 截止 10-08', 0.7, '进行中', 'doing', '继续学习'), 'H');
  add(body, mpTaskRow('应急预案桌面演练', '线上考试 · 截止 10-12', 0.45, '补学中', 'warning', '去补学', { barColor: C.warning }), 'H');
  add(body, mpTaskRow('岗位风险辨识（第二期）', '课件学习 · 已逾期 4 天', 0.2, '已逾期', 'locked', '查看原因', { barColor: C.warning }), 'H');

  add(s.body, flex(), 'H');
  add(s.body, mpTabBar(0), 'H');
  return s.outer;
}

/* ============================ M2 任务详情 ============================ */
function m2Detail() {
  const s = mpShell('21 · 任务详情', { fill: C.canvas });
  add(s.body, mpNav('任务详情'), 'H');
  const body = mpBody({ gap: 12 });
  add(s.body, body, 'B');

  const head = col('head', { gap: 10, w: CWm });
  add(head, text('高处作业安全规程', { size: 20, weight: 700, color: C.ink, lh: 1.3 }), 'H');
  const tags = row('tags', { gap: 6 });
  add(tags, tag('进行中', 'doing'));
  add(tags, tag('必修', 'confirm'));
  add(head, tags, 'H');
  add(head, text('课件学习 · 共 3 节 · 预计 24 分钟', { size: 11.5, weight: 400, color: C.muted }), 'H');
  add(head, text('截止时间 2026-09-30 18:00（还剩 6 小时）', { size: 11.5, weight: 600, color: C.warning }), 'H');
  add(body, head, 'H');

  const pcard = col('进度', { gap: 8, w: CWm, fill: C.surface, radius: 14, padX: 16, padY: 14, stroke: C.line, sw: 1 });
  const pt = row('pt', { gap: 8, cross: 'CENTER' });
  add(pt, text('学习进度', { size: 12.5, weight: 600, color: C.inkSoft }), 'H');
  add(pt, flex());
  add(pt, text('1 / 3 节', { size: 13, weight: 700, color: C.brandText }));
  add(pcard, pt, 'H');
  add(pcard, progress(0.34, { w: CWm - 32, h: 8 }), 'H');
  add(body, pcard, 'H');

  add(body, text('学习内容', { size: 15, weight: 700, color: C.ink }), 'H');
  const steps = col('steps', { gap: 8, w: CWm });
  for (const [i, t2, sub, done, cur] of [
    [1, '作业前风险辨识', '已完成 · 用时 8 分钟', true, false],
    [2, '安全带与防坠器使用', '进行中 · 还剩 9 分钟', false, true],
    [3, '应急处置与撤离', '未开始 · 约 7 分钟', false, false],
  ]) {
    const r = row('step', { gap: 12, w: CWm, fill: C.surface, radius: 14, padX: 14, padY: 12, cross: 'CENTER', stroke: cur ? C.brand : C.line, sw: cur ? 1.5 : 1 });
    const ic = col('ic', { w: 34, h: 34, radius: 999, fill: done ? C.success : (cur ? C.brand : C.canvas), cross: 'CENTER', main: 'CENTER' });
    add(ic, text(done ? '✓' : String(i), { size: 13, weight: 700, color: done || cur ? C.white : C.muted }), null);
    ic.children[0].textAlignHorizontal = 'CENTER';
    add(r, ic, null);
    const tx = col('tx', { gap: 3 });
    add(tx, text(t2, { size: 13.5, weight: 600, color: C.ink }), 'H');
    add(tx, text(sub, { size: 10.5, weight: 400, color: cur ? C.brandText : C.muted }), 'H');
    add(r, tx, 'H');
    add(r, text('›', { size: 15, weight: 700, color: C.muted }));
    add(steps, r, 'H');
  }
  add(body, steps, 'H');

  const callout = row('callout', { gap: 8, w: CWm, fill: C.warningSoft, radius: 12, padX: 13, padY: 11 });
  add(callout, text('!', { size: 12, weight: 700, color: C.warning }));
  add(callout, text('完成后需参加在线考试，80 分为合格。不合格可在 24 小时后重考两次。',
    { size: 10.5, weight: 400, color: C.warning, w: CWm - 50, lh: 1.5 }), 'H');
  add(body, callout, 'H');

  add(s.body, flex(), 'H');
  const bar = col('底部操作', { w: MP_W, padX: PAD, padY: 12, gap: 0, fill: C.surface, stroke: C.line, sw: 1 });
  add(bar, btn('继续第 2 节', 'primary', { h: 48, padX: 24, size: 14.5 }), 'H');
  add(s.body, bar, 'H');
  return s.outer;
}

/* ============================ M3 课件学习 ============================ */
function m3Course() {
  const s = mpShell('22 · 课件学习', { fill: C.canvas });
  add(s.body, mpNav('课件学习', { right: chip('1 / 3', { fill: C.brandSoft, color: C.brandText, size: 11, padX: 10, padY: 4 }) }), 'H');
  const body = mpBody({ gap: 14 });
  add(s.body, body, 'B');

  // 场景图占位（正式资产用写实图，画面不出现人物与文字）
  const img = col('课件配图', {
    w: CWm, h: 190, radius: 12, fill: C.brandSoft, stroke: C.brandLine, sw: 1,
    gap: 6, padX: 22, main: 'CENTER', cross: 'CENTER',
  });
  add(img, text('场景写实图占位 · 16:9', { size: 12, weight: 600, color: C.brandText }), 'H');
  img.children[0].textAlignHorizontal = 'CENTER';
  add(img, text('画面不出现人物与文字；圆角 --radius-panel；上沿加 1px rgba(4,48,42,.06) 内描边，避免白底图与卡片融在一起', {
    size: 9.5, weight: 400, color: C.muted, w: CWm - 44, lh: 1.5,
  }), 'H');
  img.children[1].textAlignHorizontal = 'CENTER';
  add(body, img, 'H');

  add(body, text('第 2 节 · 安全带与防坠器使用', { size: 17, weight: 700, color: C.ink, lh: 1.35 }), 'H');
  add(body, text('安全带必须高挂低用，挂点强度不低于 22kN。每次使用前检查织带是否有割伤、霉变，'
    + '金属件是否变形；发现任一异常立即停用并上报。', {
    size: 14, weight: 400, color: C.inkSoft, w: CWm, lh: 1.62,
  }), 'H');

  const tip = row('tip', { gap: 8, w: CWm, fill: C.brandSoft, radius: 12, padX: 13, padY: 11 });
  add(tip, text('要点', { size: 10.5, weight: 700, color: C.brandText }), null);
  add(tip, text('挂点高于腰部才算"高挂"；低挂会造成坠落距离加倍。', { size: 10.5, weight: 400, color: C.brandText, w: CWm - 60, lh: 1.5 }), 'H');
  add(body, tip, 'H');

  add(s.body, flex(), 'H');
  const bar = row('底部', { w: MP_W, padX: PAD, padY: 12, gap: 10, cross: 'CENTER', fill: C.surface, stroke: C.line, sw: 1 });
  add(bar, btn('上一节', 'secondary', { h: 48, padX: 18, size: 14 }), null);
  add(bar, btn('学完，下一节', 'primary', { h: 48, padX: 20, size: 14 }), 'H');
  add(s.body, bar, 'H');
  return s.outer;
}

/* ============================ M4 在线考试 ============================ */
function m4Exam() {
  const s = mpShell('23 · 在线考试', { fill: C.canvas });
  add(s.body, mpNav('在线考试', { right: chip('18:42', { fill: C.warningSoft, color: C.warning, size: 11, padX: 10, padY: 4 }) }), 'H');
  const body = mpBody({ gap: 14 });
  add(s.body, body, 'B');

  const pr = col('pr', { gap: 7, w: CWm });
  const pt = row('pt', { gap: 8, cross: 'CENTER' });
  add(pt, text('第 3 / 10 题', { size: 12.5, weight: 600, color: C.inkSoft }), 'H');
  add(pt, flex());
  add(pt, text('单选题 · 每题 10 分', { size: 10.5, weight: 400, color: C.muted }));
  add(pr, pt, 'H');
  add(pr, progress(0.3, { w: CWm, h: 8 }), 'H');
  add(body, pr, 'H');

  const q = col('q', { gap: 10, w: CWm, fill: C.surface, radius: 14, padX: 16, padY: 16, stroke: C.line, sw: 1 });
  add(q, text('高处作业时，安全带应当如何悬挂？', { size: 15.5, weight: 600, color: C.ink, w: CWm - 32, lh: 1.5 }), 'H');
  add(body, q, 'H');

  const opts = col('opts', { gap: 10, w: CWm });
  for (const [letter, t2, on] of [
    ['A', '低挂高用，挂在腰部以下的构架上', false],
    ['B', '高挂低用，挂在腰部以上的牢固挂点', true],
    ['C', '挂在临时搭设的钢管上即可', false],
    ['D', '无所谓高低，只要系紧就行', false],
  ]) {
    const r = row('opt', { gap: 10, w: CWm, fill: on ? C.brandSoft : C.surface, radius: 12, padX: 14, padY: 13, cross: 'CENTER', stroke: on ? C.brand : C.line, sw: on ? 1.5 : 1 });
    const cc = col('cc', { w: 24, h: 24, radius: 999, fill: on ? C.brand : C.surface, stroke: on ? null : C.lineStrong, sw: 1.5, cross: 'CENTER', main: 'CENTER' });
    add(cc, text(on ? '✓' : letter, { size: on ? 12 : 11, weight: 700, color: on ? C.white : C.muted }), null);
    cc.children[0].textAlignHorizontal = 'CENTER';
    add(r, cc, null);
    add(r, text(t2, { size: 12.5, weight: on ? 600 : 400, color: on ? C.brandText : C.inkSoft, w: CWm - 70, lh: 1.45 }), 'H');
    add(opts, r, 'H');
  }
  add(body, opts, 'H');

  add(body, text('合格线 80 分。不合格可在 24 小时后重考，共 2 次机会。', { size: 10.5, weight: 400, color: C.muted, w: CWm }), 'H');

  add(s.body, flex(), 'H');
  const bar = row('底部', { w: MP_W, padX: PAD, padY: 12, gap: 10, cross: 'CENTER', fill: C.surface, stroke: C.line, sw: 1 });
  add(bar, btn('上一题', 'secondary', { h: 48, padX: 18, size: 14 }), null);
  add(bar, btn('下一题', 'primary', { h: 48, padX: 20, size: 14 }), 'H');
  add(s.body, bar, 'H');
  return s.outer;
}

/* ============================ M5 学习记录 ============================ */
function m5Records() {
  const s = mpShell('24 · 学习记录', { fill: C.canvas });
  add(s.body, mpNav('学习记录'), 'H');
  const body = mpBody({ gap: 12 });
  add(s.body, body, 'B');

  const stats = row('stats', { gap: 10, w: CWm });
  for (const [v, label, color] of [['12', '已完成任务', C.brandText], ['18.5', '累计学时', C.brandText], ['3', '获得徽章', C.accentInk]]) {
    const c = col('st', { gap: 4, fill: C.surface, radius: 14, padX: 14, padY: 13, stroke: C.line, sw: 1, cross: 'CENTER' });
    add(c, text(v, { size: 22, weight: 700, color: color }), 'H');
    c.children[0].textAlignHorizontal = 'CENTER';
    add(c, text(label, { size: 10.5, weight: 400, color: C.muted }), 'H');
    c.children[1].textAlignHorizontal = 'CENTER';
    add(stats, c, 'H');
  }
  add(body, stats, 'H');

  add(body, mpChips(['全部', '课件', '考试', '闯关'], 0), 'H');

  const list = col('list', { gap: 10, w: CWm });
  for (const [title, meta, badge, kind] of [
    ['高处作业安全规程', '课件学习 · 09-22 完成 · 用时 26 分钟', '已完成', 'done'],
    ['起重机械安全操作', '在线考试 · 09-18 完成 · 96 分', '96 分 · 合格', 'done'],
    ['应急预案桌面演练', '在线考试 · 09-12 · 72 分', '需补学后重考', 'warning'],
    ['岗位风险辨识（第一期）', '课件学习 · 08-30 完成 · 用时 18 分钟', '已完成', 'done'],
  ]) {
    const r = row('rec', { gap: 12, w: CWm, fill: C.surface, radius: 14, padX: 14, padY: 13, cross: 'CENTER', stroke: C.line, sw: 1 });
    const ic = col('ic', { w: 34, h: 34, radius: 999, fill: kind === 'warning' ? C.warningSoft : C.successSoft, cross: 'CENTER', main: 'CENTER' });
    add(ic, text(kind === 'warning' ? '!' : '✓', { size: 14, weight: 700, color: kind === 'warning' ? C.warning : C.success }), null);
    ic.children[0].textAlignHorizontal = 'CENTER';
    add(r, ic, null);
    const tx = col('tx', { gap: 3 });
    add(tx, text(title, { size: 13.5, weight: 600, color: C.ink }), 'H');
    add(tx, text(meta, { size: 10.5, weight: 400, color: C.muted }), 'H');
    add(r, tx, 'H');
    add(r, tag(badge, kind === 'warning' ? 'warning' : 'done'));
    add(list, r, 'H');
  }
  add(body, list, 'H');

  add(s.body, flex(), 'H');
  add(s.body, mpTabBar(1), 'H');
  return s.outer;
}

/* ============================ M6 安全闯关 ============================ */
function m6Games() {
  const s = mpShell('25 · 安全闯关', { fill: C.canvas });
  s.sb.fills = [solid(C.brandInk)];
  s.sb.children[0].fills = [solid(C.white)];
  s.sb.children[2].fills = [solid(C.white)];

  const hero = col('Hero', { w: MP_W, fill: C.brandInk, padX: PAD, padY: 6, gap: 10 });
  hero.paddingBottom = 18;
  const ht = row('ht', { gap: 8, cross: 'CENTER' });
  add(ht, text('安全闯关', { size: 20, weight: 700, color: C.white }), 'H');
  add(ht, flex());
  add(ht, chip('关卡 3 / 9', { fill: C.brandDeep, color: C.accent, size: 11, padX: 11, padY: 5 }));
  add(hero, ht, 'H');
  add(hero, text('连续答对 5 题，解锁"识险能手"徽章', { size: 12, weight: 400, color: '#CFE2DC', w: CWm }), 'H');
  add(hero, progress(3 / 9, { w: CWm, h: 6, color: C.accent }), 'H');
  add(s.body, hero, 'H');

  const body = mpBody({ gap: 12 });
  add(s.body, body, 'B');

  add(body, text('全部关卡', { size: 15, weight: 700, color: C.ink }), 'H');
  const grid = row('grid', { gap: 10, w: CWm, wrap: true, gapY: 10 });
  for (const [n, name, state] of [
    [1, '个人防护', 'done'], [2, '用电安全', 'done'], [3, '高处作业', 'cur'],
    [4, '起重吊装', 'locked'], [5, '有限空间', 'locked'], [6, '消防应急', 'locked'],
  ]) {
    const on = state === 'cur';
    const c = col('lv', { gap: 6, w: (CWm - 10) / 2, fill: C.surface, radius: 14, padX: 14, padY: 13, stroke: on ? C.brand : C.line, sw: on ? 1.5 : 1 });
    const top = row('top', { gap: 8, cross: 'CENTER' });
    const cc = col('cc', { w: 30, h: 30, radius: 999, fill: state === 'done' ? C.success : (on ? C.accent : C.canvas), cross: 'CENTER', main: 'CENTER' });
    add(cc, text(state === 'done' ? '✓' : (on ? String(n) : '⊘'), { size: 12.5, weight: 700, color: state === 'done' ? C.white : (on ? C.brandInk : C.muted) }), null);
    cc.children[0].textAlignHorizontal = 'CENTER';
    add(top, cc, null);
    add(top, text('第 ' + n + ' 关', { size: 11, weight: 700, color: C.muted }), 'H');
    add(c, top, 'H');
    add(c, text(name, { size: 13.5, weight: 600, color: on ? C.ink : (state === 'done' ? C.inkSoft : C.muted) }), 'H');
    add(c, text(state === 'done' ? '已通关 · 5 / 5' : (on ? '进行中 · 3 / 5' : '完成第 3 关后解锁'), { size: 10, weight: 400, color: C.muted }), 'H');
    add(grid, c);
  }
  add(body, grid, 'H');

  const acc = col('acc', { gap: 9, w: CWm, fill: C.accent, radius: 16, padX: 16, padY: 14 });
  add(acc, text('今日挑战', { size: 10.5, weight: 700, color: C.accentInk, ls: 0.4 }), 'H');
  add(acc, text('安全闯关 · 第 3 关', { size: 17, weight: 700, color: C.brandInk }), 'H');
  const af = row('af', { gap: 8, cross: 'CENTER' });
  add(af, chip('3 / 5 题', { fill: C.brandInk, color: C.accent, size: 11, padX: 12, padY: 5 }));
  add(af, flex());
  add(af, btn('继续闯关', 'primary-dark', { h: 34, padX: 14, size: 12.5 }));
  add(acc, af, 'H');
  add(body, acc, 'H');

  add(s.body, flex(), 'H');
  add(s.body, mpTabBar(2), 'H');
  return s.outer;
}

/* ============================== M7 我的 ============================== */
function m7Profile() {
  const s = mpShell('26 · 我的', { fill: C.canvas });
  s.sb.fills = [solid(C.brandInk)];
  s.sb.children[0].fills = [solid(C.white)];
  s.sb.children[2].fills = [solid(C.white)];

  const hero = col('Hero', { w: MP_W, fill: C.brandInk, padX: PAD, padY: 10, gap: 14 });
  const who = row('who', { gap: 12, cross: 'CENTER' });
  const av = col('avatar', { w: 54, h: 54, radius: 999, fill: C.accent, cross: 'CENTER', main: 'CENTER' });
  add(av, text('王', { size: 22, weight: 700, color: C.brandInk }), null);
  av.children[0].textAlignHorizontal = 'CENTER';
  add(who, av, null);
  const wt = col('wt', { gap: 4 });
  add(wt, text('王建国', { size: 20, weight: 700, color: C.white }), 'H');
  add(wt, text('工程物探部 · 外业一组', { size: 11.5, weight: 400, color: '#CFE2DC' }), 'H');
  add(who, wt, 'H');
  add(hero, who, 'H');

  const stats = row('stats', { gap: 0, w: CWm, fill: C.brandDeep, radius: 12, padX: 0, padY: 12 });
  for (const [v, label] of [['12', '已完成'], ['18.5', '学时'], ['3', '徽章']]) {
    const c = col('st', { gap: 3, cross: 'CENTER' });
    add(c, text(v, { size: 18, weight: 700, color: C.accent }), 'H');
    c.children[0].textAlignHorizontal = 'CENTER';
    add(c, text(label, { size: 10, weight: 400, color: '#CFE2DC' }), 'H');
    c.children[1].textAlignHorizontal = 'CENTER';
    add(stats, c, 'H');
  }
  add(hero, stats, 'H');
  add(s.body, hero, 'H');

  const body = mpBody({ gap: 12 });
  add(s.body, body, 'B');

  const menu = col('menu', { gap: 0, w: CWm, fill: C.surface, radius: 14, stroke: C.line, sw: 1, clips: true });
  for (const [icon, label, extra, last] of [
    ['❏', '我的证照', '2 张', false],
    ['◈', '我的证书', '3 张', false],
    ['✉', '消息通知', '', false],
    ['⚙', '设置', '', false],
    ['?', '帮助与反馈', '', true],
  ]) {
    const r = row('mi', { gap: 12, w: CWm, padX: 14, padY: 14, cross: 'CENTER', fill: C.surface });
    add(r, text(icon, { size: 14, weight: 500, color: C.brand }), null);
    add(r, text(label, { size: 13.5, weight: 500, color: C.ink }), 'H');
    if (extra) add(r, text(extra, { size: 11, weight: 400, color: C.muted }));
    add(r, text('›', { size: 15, weight: 700, color: C.muted }));
    add(menu, r, 'H');
    if (!last) {
      const line = tintBar(C.line, CWm - 28, 0);
      line.resize(CWm - 28, 1);
      const lw = col('line', { w: CWm, padX: 14, gap: 0 });
      add(lw, line, 'H');
      add(menu, lw, 'H');
    }
  }
  add(body, menu, 'H');

  add(body, btn('退出登录', 'secondary', { h: 44, padX: 20, size: 13.5 }), 'H');

  add(s.body, flex(), 'H');
  add(s.body, mpTabBar(4), 'H');
  return s.outer;
}

/* ========================== M8 登录与绑定 ========================== */
function m8Login() {
  const s = mpShell('27 · 登录与绑定', { fill: C.brandInk });
  s.sb.fills = [solid(C.brandInk)];
  s.sb.children[0].fills = [solid('#9FC4B9')];
  s.sb.children[2].fills = [solid('#9FC4B9')];

  const top = col('top', { w: MP_W, padX: PAD, padY: 72, gap: 20, cross: 'CENTER', fill: C.brandInk });
  add(top, logoGroup(90, { mono: C.accent }), null);
  const t = col('title', { gap: 7, cross: 'CENTER' });
  add(t, text('安全培训教育平台', { size: 22, weight: 700, color: C.white }), 'H');
  t.children[0].textAlignHorizontal = 'CENTER';
  add(t, text('员工登录 · 学习与考试入口', { size: 12, weight: 400, color: '#9FC4B9' }), 'H');
  t.children[1].textAlignHorizontal = 'CENTER';
  add(top, t, 'H');
  add(s.body, top, 'H');

  const form = col('form', { w: MP_W, padX: PAD, padY: 4, gap: 16, fill: C.brandInk });
  add(form, mpField('手机号', '15035081583', {
    fill: C.brandDeep, stroke: C.brandStrong, labelColor: '#CFE2DC', valueColor: C.white, unit: '获取验证码', hint: '', hintColor: '#9FC4B9',
  }), 'H');
  add(form, mpField('身份证后 6 位', '••••••', {
    fill: C.brandDeep, stroke: C.brandStrong, labelColor: '#CFE2DC', valueColor: C.white, hint: '用于与员工档案匹配', hintColor: '#9FC4B9',
  }), 'H');
  const btnWrap = col('btnWrap', { w: CWm, gap: 12 });
  const pbtn = btn('登录', 'primary', { h: 52, padX: 24, size: 15 });
  add(btnWrap, pbtn, 'H');
  add(form, btnWrap, 'H');
  add(s.body, form, 'H');

  add(s.body, flex(), 'H');

  const foot = col('foot', { w: MP_W, padX: PAD, padY: 22, gap: 8, fill: C.brandInk });
  add(foot, text('首次登录即完成手机号绑定，无需注册。账号由公司统一导入，如无法登录请联系所在部门管理员。',
    { size: 10.5, weight: 400, color: '#9FC4B9', w: CWm, lh: 1.55 }), 'H');
  const fr = row('fr', { gap: 8, cross: 'CENTER' });
  add(fr, text('关注公众号接收培训通知', { size: 10.5, weight: 600, color: C.accent }), 'H');
  add(fr, text('›', { size: 12, weight: 700, color: C.accent }));
  add(foot, fr, 'H');
  add(s.body, foot, 'H');
  return s.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const cleared = clearBoards(['▣ 2']);
const grid = gridAt(ZX, 0, 4, MP_W, MP_H, GAPC, 132);
const boards = [m1Todo(), m2Detail(), m3Course(), m4Exam(), m5Records(), m6Games(), m7Profile(), m8Login()];
for (const f of boards) grid(f);

return {
  分区: 'C · 小程序（员工端）',
  画板数: boards.length,
  清理旧画板: cleared,
  尺寸: MP_W + '×' + MP_H,
  本区高度: 2 * MP_H + 132,
  位置: { x: ZX },
};
