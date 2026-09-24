//!include ./_kit.js

/* B 区 · 组件库：按钮 / 卡片 / 胶囊与标签与进度 / 表单 / 任务行与状态页 / 导航
 * 布局：单列竖排于 x=1360（A 区右侧留 240px）。 */

await loadFonts();

const W = 1120;
const CW = W - 88;
const ZX = 1360;

/* --------------------------- 按钮族的派生态 --------------------------- */
function btnPressed(label, variant, o) {
  const b = btn(label, variant, o);
  b.opacity = 0.82;
  return b;
}

function btnDisabled(label, o) {
  const b = btn(label, 'secondary', o);
  b.fills = [solid(C.canvas)];
  b.strokes = [solid(C.line)];
  b.opacity = 0.65;
  b.query('TEXT').set({ fills: [solid(C.muted)] });
  return b;
}

function b0Buttons() {
  const b = board('10 · 按钮 Button', '一个界面只允许一个黄绿主按钮 —— 它出现的位置只有一个含义：现在点这里。'
    + '按下态 opacity .82 + scale(.995)；焦点态 3px 半透明青绿轮廓 + 2px 偏移（Web）。', W, null);

  add(b.body, sectionLabel('变体 × 状态', { color: C.brand }), 'H');

  const VARIANTS = [
    ['primary', '主操作', '继续完成', '黄绿底 + 墨绿字 11.14:1。每屏唯一'],
    ['primary-dark', '深色面反白', '进入学习', '深色 Hero 内部的反白动作'],
    ['secondary', '次要操作', '返回', '白底 + 青绿字 + --line-strong 描边'],
    ['ghost', '行内动作', '查看详情', '透明底，表格链接与行内动作'],
    ['danger', '危险操作', '解锁重考', '需二次确认：解锁、作废、停用'],
  ];

  const t = col('btnTable', { gap: 0, w: CW, radius: 12, stroke: C.line, sw: 1, clips: true });
  const head = row('head', { w: CW, gap: 0, fill: C.surfaceSoft });
  for (const [label, w] of [['变体', 180], ['默认', 250], ['按下（opacity .82）', 250], ['禁用（--canvas 底 + opacity .65）', 352]]) {
    const c = col('th', { w, padX: 16, padY: 10 });
    add(c, text(label, { size: 11.5, weight: 700, color: C.inkSoft }), 'H');
    add(head, c);
  }
  add(t, head, 'H');

  VARIANTS.forEach((v, i) => {
    const r = row('row', { w: CW, gap: 0, fill: i % 2 ? C.surfaceSoft : C.surface, cross: 'CENTER' });
    const nameCell = col('name', { w: 180, padX: 16, padY: 16, gap: 4 });
    add(nameCell, text(v[1], { size: 12, weight: 700, color: C.ink }), 'H');
    add(nameCell, text('btn·' + v[0], { size: 10, weight: 400, color: C.muted }), 'H');
    add(nameCell, text(v[3], { size: 10, weight: 400, color: C.muted, w: 148, lh: 1.45 }), 'H');
    add(r, nameCell);
    const c1 = col('c1', { w: 250, padX: 16, padY: 16, cross: 'MIN' });
    const c2 = col('c2', { w: 250, padX: 16, padY: 16, cross: 'MIN' });
    const c3 = col('c3', { w: 352, padX: 16, padY: 16, cross: 'MIN' });
    add(c1, btn(v[2], v[0], { h: 40 }), null);
    add(c2, btnPressed(v[2], v[0], { h: 40 }), null);
    add(c3, btnDisabled(v[2], { h: 40 }), null);
    add(r, c1); add(r, c2); add(r, c3);
    add(t, r, 'H');
  });
  add(b.body, t, 'H');

  add(b.body, sectionLabel('尺寸（小程序以 rpx 折算，后台用 px）', { color: C.brandText }), 'H');
  const sizes = row('sizes', { gap: 28, w: CW, cross: 'MIN' });
  for (const [n, h, pad, size, use] of [
    ['标准', 48, 26, 16, '小程序 96rpx · 页面级主操作'],
    ['小号 mini', 36, 18, 13.5, '小程序 72rpx · 卡片内次级动作'],
    ['Web 标准', 40, 20, 13.5, '后台表格工具条、表单提交'],
    ['Web 小号', 32, 14, 12, '后台表格行内动作'],
  ]) {
    const c = col('sz', { gap: 10, cross: 'MIN' });
    add(c, btn('确定提交', 'primary', { h, padX: pad, size }), null);
    add(c, text(n + ' · 高 ' + h + 'px · 圆角 8px', { size: 11, weight: 600, color: C.inkSoft }), 'H');
    add(c, text(use, { size: 10.5, weight: 400, color: C.muted, w: 220, lh: 1.45 }), 'H');
    add(sizes, c);
  }
  add(b.body, sizes, 'H');

  // 一屏一个 Primary 的反例说明
  const callout = row('callout', { gap: 12, w: CW, fill: C.warningSoft, radius: 10, padX: 16, padY: 14, cross: 'MIN' });
  add(callout, text('!', { size: 13, weight: 700, color: C.warning }), null);
  add(callout, text('反例：同一屏出现两个黄绿主按钮，会让员工无法判断"现在到底该点哪个"。'
    + '若确实有两个动作，把次要的那个降为 secondary 或 ghost。',
    { size: 11.5, weight: 400, color: C.warning, w: CW - 60, lh: 1.55 }), 'H');
  add(b.body, callout, 'H');

  return b.outer;
}

/* ------------------------------ 卡片 ------------------------------ */
function b1Cards() {
  const b = board('11 · 卡片 Card', '卡片只有四种。深色卡与黄绿卡不同屏出现；每页最多一张深色卡。', W, null);

  const grid = row('cards', { gap: 20, w: CW, wrap: true, gapY: 20, cross: 'MIN' });

  // 1 白卡
  {
    const c = col('白卡', { gap: 12, w: 506, fill: C.surface, stroke: C.line, sw: 1, radius: 16, padX: 24, padY: 22, effects: [SH.elevation] });
    add(c, row('h', { gap: 8, cross: 'CENTER' }, undefined), null);
    const h = c.children[0];
    add(h, text('高处作业安全规程', { size: 16, weight: 600, color: C.ink }), 'H');
    add(h, tag('进行中', 'doing'));
    add(c, text('共 3 节 · 已完成 1 节 · 预计还需 16 分钟', { size: 12.5, weight: 400, color: C.muted, w: 458 }), 'H');
    add(c, progress(0.34, { w: 458, h: 6 }), 'H');
    const f = row('f', { gap: 10, cross: 'CENTER' });
    add(f, text('下一步：继续第 2 节', { size: 12.5, weight: 600, color: C.brandText }), 'H');
    add(f, flex());
    add(f, btn('继续学习', 'primary', { h: 36, padX: 16, size: 12.5 }));
    add(c, f, 'H');
    add(grid, labelWrap('Card · 默认容器', '白底 + --line 描边 + --radius-card 16px。列表、内容页的默认容器。', c));
  }

  // 2 深色卡
  {
    const c = col('深色卡', { gap: 12, w: 506, fill: C.brandInk, radius: 16, padX: 24, padY: 22, effects: [SH.brand] });
    add(c, text('现在先做', { size: 11, weight: 600, color: C.accent, ls: 0.4 }), 'H');
    add(c, text('高处作业安全规程', { size: 20, weight: 700, color: C.white }), 'H');
    add(c, text('今天是截止日，还需 16 分钟', { size: 12.5, weight: 400, color: '#CFE2DC', w: 458 }), 'H');
    add(c, progress(0.34, { w: 458, h: 6, color: C.accent }), 'H');
    add(c, btn('继续完成', 'primary', { h: 40, padX: 20, size: 13.5 }), null);
    add(grid, labelWrap('Ink Card · 主任务卡', '--brand-ink 底 + 白字 + --elevation-brand。用于"现在先做"，一张页面最多一张。', c));
  }

  // 3 黄绿卡
  {
    const c = col('黄绿卡', { gap: 12, w: 506, fill: C.accent, radius: 16, padX: 24, padY: 22 });
    add(c, text('今日挑战', { size: 11, weight: 700, color: C.accentInk, ls: 0.4 }), 'H');
    add(c, text('安全闯关 · 第 3 关', { size: 20, weight: 700, color: C.brandInk }), 'H');
    add(c, text('连续答对 5 题即可解锁"识险能手"徽章', { size: 12.5, weight: 400, color: C.brandInk, w: 458, opacity: 0.78 }), 'H');
    const f = row('f', { gap: 10, cross: 'CENTER' });
    add(f, chip('3 / 5 题', { fill: C.brandInk, color: C.accent, size: 11, padX: 12, padY: 5 }));
    add(f, flex());
    add(f, btn('开始闯关', 'primary-dark', { h: 40, padX: 20, size: 13.5 }));
    add(c, f, 'H');
    add(grid, labelWrap('Accent Card · 今日关键动作', '--accent 底 + --brand-ink 字。与深色卡不同屏出现。', c));
  }

  // 4 无边框卡
  {
    const c = col('无边框卡', { gap: 12, w: 506, fill: C.surface, radius: 16, padX: 24, padY: 22 });
    add(c, text('筛选条件', { size: 13, weight: 700, color: C.inkSoft }), 'H');
    const chips = row('chips', { gap: 8, wrap: true, w: 458, gapY: 8 });
    for (const [t2, on] of [['全部', true], ['未开始', false], ['进行中', false], ['已完成', false], ['已逾期', false]]) {
      add(chips, on
        ? chip(t2, { fill: C.brandSoft, color: C.brandText, size: 11.5, padX: 14, padY: 7, weight: 700 })
        : chip(t2, { fill: C.surface, color: C.muted, stroke: C.line, size: 11.5, padX: 14, padY: 7 }));
    }
    add(c, chips, 'H');
    add(c, text('无边框卡只靠 --canvas 与白底的分层，本身没有描边和阴影 —— 筛选面板一律用它。', {
      size: 11, weight: 400, color: C.muted, w: 458, lh: 1.5,
    }), 'H');
    add(grid, labelWrap('Flat Card · 筛选面板', '无描边、无阴影，靠底色分层。筛选条一律不加深阴影。', c));
  }

  add(b.body, grid, 'H');
  return b.outer;
}

/** 给组件示例包一层「标题 + 说明」标注。 */
function labelWrap(title, desc, node) {
  const c = col('lw', { gap: 10, w: 506 });
  add(c, text(title, { size: 12.5, weight: 700, color: C.ink }), 'H');
  add(c, node, 'H');
  add(c, text(desc, { size: 10.5, weight: 400, color: C.muted, w: 506, lh: 1.5 }), 'H');
  return c;
}

/* --------------------- 胶囊筛选器 · 状态标签 · 进度 --------------------- */
function b2Chips() {
  const b = board('12 · 胶囊筛选器 · 状态标签 · 进度', '筛选器一律用胶囊，不用下拉菜单（既有约定）。标签不是按钮 —— 不可点击的标签不得有悬停态。', W, null);

  add(b.body, sectionLabel('胶囊筛选器 Chip', { color: C.brand }), 'H');
  const chipRow = row('chipRow', { gap: 10, w: CW, wrap: true, gapY: 12, cross: 'CENTER' });
  const chipStates = [
    ['全部', true, '选中：--brand-soft 底 + --brand-text 字，去掉描边，字重 650'],
    ['未开始', false, '默认：白底 + --line 描边 + --muted 字'],
    ['进行中', false, ''],
    ['已完成', false, ''],
    ['已逾期', false, ''],
  ];
  for (const [t, on, note] of chipStates) {
    const c = col('cs', { gap: 8, cross: 'MIN' });
    add(c, on
      ? chip(t, { fill: C.brandSoft, color: C.brandText, size: 12.5, padX: 16, padY: 9, weight: 700 })
      : chip(t, { fill: C.surface, color: C.muted, stroke: C.line, size: 12.5, padX: 16, padY: 9 }), null);
    add(c, text(on ? '选中' : (t === '未开始' ? '默认' : '同默认'), { size: 10, weight: 500, color: C.muted }), 'H');
    add(chipRow, c);
  }
  add(b.body, chipRow, 'H');
  add(b.body, text('小程序高 56rpx（28px），Web 高 28px；横向可滚且滚动条隐藏；一组内不超过 7 个。',
    { size: 11.5, weight: 400, color: C.muted, w: CW }), 'H');

  add(b.body, sectionLabel('状态标签 Tag', { color: C.brandText }), 'H');
  const tagRow = row('tagRow', { gap: 12, w: CW, wrap: true, gapY: 14, cross: 'MIN' });
  for (const [label, kind, note] of [
    ['待学习 / 进行中', 'doing', '--brand-soft / --brand-text'],
    ['需补学后重考', 'warning', '--warning-soft / --warning'],
    ['考试次数已用完', 'locked', '--danger-soft / --danger'],
    ['已完成 / 已签字', 'done', '--success-soft / --success'],
    ['待现场确认', 'confirm', '--info-soft / --info'],
    ['未开通 / 不适用', 'neutral', '--surface-soft / --muted'],
  ]) {
    const c = col('tg', { gap: 8, cross: 'MIN', w: 300 });
    add(c, tag(label, kind), null);
    add(c, text(note, { size: 10.5, weight: 400, color: C.muted }), 'H');
    add(tagRow, c);
  }
  add(b.body, tagRow, 'H');
  add(b.body, text('标签一律胶囊形，小程序高 44rpx（22px），Web 高 22px，用 Micro 字阶。标签不响应点击。',
    { size: 11.5, weight: 400, color: C.muted, w: CW }), 'H');

  add(b.body, sectionLabel('进度 Progress', { color: C.brand }), 'H');
  const progRow = row('progRow', { gap: 24, w: CW, wrap: true, gapY: 18, cross: 'MIN' });
  const progDefs = [
    ['正常进行', 0.34, C.brand, '填充 --brand。轨道 #E6EAE0，高 12rpx / 6px，胶囊端。'],
    ['逾期 / 补学中', 0.6, C.warning, '逾期或补学态切 --warning，不切红 —— 红只留给"已锁定"。'],
    ['已完成', 1, C.success, '完成态用 --success，并配"已完成"标签而非纯色变化。'],
    ['刚起步', 0.06, C.brand, '极小值仍保留最小可见宽度，不能渲染成 0。'],
  ];
  for (const [label, pct, color, note] of progDefs) {
    const c = col('pg', { gap: 8, w: 234 });
    add(c, text(label, { size: 11.5, weight: 600, color: C.inkSoft }), 'H');
    add(c, progress(pct, { w: 234, h: 8, color }), 'H');
    add(c, text(note, { size: 10, weight: 400, color: C.muted, w: 234, lh: 1.45 }), 'H');
    add(progRow, c);
  }
  add(b.body, progRow, 'H');
  add(b.body, text('进度条必须带 aria-label（现有代码已有此约定）；数值一律等宽数字，与右侧百分比对齐。',
    { size: 11.5, weight: 400, color: C.muted, w: CW }), 'H');

  return b.outer;
}

/* ------------------------------ 表单 ------------------------------ */
function b3Forms() {
  const b = board('13 · 表单 Form', '聚焦只改描边颜色，不做发光；错误只改描边加下方说明，不用红色底填满输入框。', W, null);

  add(b.body, sectionLabel('输入框四态', { color: C.brand }), 'H');
  const st = row('states', { gap: 24, w: CW, wrap: true, gapY: 20, cross: 'MIN' });
  for (const [state, label, note] of [
    ['normal', '常规', '白底 + 1px --line 描边 + --radius-control 8px，高 42px（小程序 96rpx）'],
    ['focus', '聚焦', '描边变 2px --brand，底色不变，不加外发光'],
    ['error', '错误', '描边 --danger + 下方 --danger 文字说明'],
    ['disabled', '禁用', '--canvas 底 + --muted 字 + opacity .65'],
  ]) {
    add(st, field(label + ' 状态', state === 'error' ? '1503508158' : '15035081583', state, {
      w: 234, hint: state === 'normal' ? '手机号，用于接收培训通知' : (state === 'focus' ? '已聚焦：描边 2px --brand' : undefined),
    }));
  }
  add(b.body, st, 'H');

  add(b.body, sectionLabel('登录表单实例（手机号 + 身份证后 6 位）', { color: C.brandText }), 'H');
  const login = row('login', { gap: 28, w: CW, cross: 'MIN', wrap: true, gapY: 20 });
  {
    const card = col('card', { gap: 16, w: 340, fill: C.surface, stroke: C.line, sw: 1, radius: 16, padX: 24, padY: 24 });
    const lg = row('lg', { gap: 10, cross: 'CENTER' });
    add(lg, logoGroup(32));
    const lt = col('lt', { gap: 2 });
    add(lt, text('安全培训教育平台', { size: 13.5, weight: 700, color: C.ink }));
    add(lt, text('员工登录', { size: 10.5, weight: 400, color: C.muted }));
    add(lg, lt);
    add(card, lg, 'H');
    add(card, field('手机号', '15035081583', 'normal', { w: 292 }), 'H');
    add(card, field('身份证后 6 位', '••••••', 'normal', { w: 292 }), 'H');
    add(card, btn('登录', 'primary', { h: 44, padX: 24, size: 14 }), 'H');
    add(card, text('首次登录即完成手机号绑定。登录后在"我的"里可查看全部学习记录。',
      { size: 10.5, weight: 400, color: C.muted, w: 292, lh: 1.5 }), 'H');
    add(login, card);
  }
  {
    const notes = col('notes', { gap: 12, w: 620 });
    for (const [t2, d2] of [
      ['认证方式', '手机号 + 身份证后 6 位，两者都匹配才通过。员工由管理员用 Excel 批量导入后即可登录，不需要自行注册。'],
      ['错误反馈', '手机号与身份证不匹配时，只在身份证字段下方提示"信息不匹配，请核对后 6 位"，不暴露哪一项错了。'],
      ['键盘与输入', '手机号用数字键盘；身份证后 6 位同样用数字键盘，6 位输入完成后主按钮才可点。'],
      ['触达通道', '培训通知通过微信公众号服务号推送，登录页不出现"关注公众号"以外的额外引导。'],
    ]) {
      const r = col('n', { gap: 4, w: 620, fill: C.surfaceSoft, radius: 10, padX: 16, padY: 12 });
      add(r, text(t2, { size: 11.5, weight: 700, color: C.ink }), 'H');
      add(r, text(d2, { size: 11, weight: 400, color: C.muted, w: 588, lh: 1.55 }), 'H');
      add(notes, r, 'H');
    }
    add(login, notes);
  }
  add(b.body, login, 'H');

  return b.outer;
}

/* --------------------- 任务行 · 四类非正常状态 --------------------- */
function b4Rows() {
  const b = board('14 · 任务行与状态页', '任务行是员工端与后台共用的核心列表单元；整行必须是真的按钮，不是包了点击事件的容器。', W, null);

  add(b.body, sectionLabel('任务行 Task Row', { color: C.brand }), 'H');

  // 主任务行（深色）
  {
    const c = col('主任务行', { gap: 12, w: CW, fill: C.brandInk, radius: 16, padX: 24, padY: 20, effects: [SH.brand] });
    add(c, text('现在先做', { size: 11, weight: 600, color: C.accent, ls: 0.4 }), 'H');
    const top = row('top', { gap: 12, cross: 'CENTER' });
    add(top, text('高处作业安全规程', { size: 18, weight: 700, color: C.white }), 'H');
    add(top, flex());
    add(top, tag('进行中', 'doing'));
    add(c, top, 'H');
    add(c, text('课件学习 · 截止 2026-09-30 18:00', { size: 12, weight: 400, color: '#CFE2DC' }), 'H');
    add(c, progress(0.34, { w: CW - 48, h: 6, color: C.accent }), 'H');
    const f = row('f', { gap: 10, cross: 'CENTER' });
    add(f, text('下一步：继续第 2 节', { size: 12.5, weight: 600, color: C.accent }), 'H');
    add(f, flex());
    add(f, text('›', { size: 16, weight: 700, color: C.accent }));
    add(c, f, 'H');
    add(b.body, c, 'H');
  }

  // 普通任务行列表
  const list = col('list', { gap: 12, w: CW });
  for (const [title, type, due, pct, tagLabel, kind, cta, warn] of [
    ['起重机械安全操作', '课件学习 · 截止 2026-10-08', '进行中', 0.7, '进行中', 'doing', '继续学习', false],
    ['应急预案桌面演练', '线上考试 · 截止 2026-10-12', '需补学后重考', 0.45, '补学中', 'warning', '去补学', true],
    ['岗位风险辨识（第二期）', '课件学习 · 截止 2026-09-20', '已逾期', 0.2, '已逾期', 'locked', '查看原因', false],
    ['安全操作技能考核', '线上考试 · 已完成', '已完成', 1, '已完成', 'done', '查看成绩', false],
  ]) {
    const c = col('row', { gap: 10, w: CW, fill: C.surface, stroke: C.line, sw: 1, radius: 14, padX: 20, padY: 16 });
    const top = row('top', { gap: 12, cross: 'CENTER' });
    add(top, text(title, { size: 14.5, weight: 600, color: C.ink }), 'H');
    add(top, flex());
    add(top, tag(tagLabel, kind));
    add(c, top, 'H');
    add(c, text(type + ' · ' + due, { size: 11.5, weight: 400, color: C.muted }), 'H');
    add(c, progress(pct, { w: CW - 40, h: 6, color: warn ? C.warning : (pct >= 1 ? C.success : C.brand) }), 'H');
    const f = row('f', { gap: 10, cross: 'CENTER' });
    add(f, text('下一步：' + cta, { size: 12, weight: 600, color: C.brandText }), 'H');
    add(f, flex());
    add(f, text(Math.round(pct * 100) + '%', { size: 11.5, weight: 700, color: C.inkSoft }), 'H');
    add(f, text('›', { size: 15, weight: 700, color: C.muted }));
    add(c, f, 'H');
    add(list, c, 'H');
  }
  add(b.body, list, 'H');
  add(b.body, text('主任务行用深色卡 + 黄绿 CTA；其余任务行用白卡 + 青绿进度条。整行是 <button>，'
    + '不是包了 bindtap 的 view —— 项目里 check-miniprogram-ui-system.mjs 已有此约束。',
    { size: 11.5, weight: 400, color: C.muted, w: CW, lh: 1.6 }), 'H');

  add(b.body, sectionLabel('四类非正常状态（必须分别呈现，不能共用一句"暂无数据"）', { color: C.warning }), 'H');
  const stGrid = row('stateGrid', { gap: 20, w: CW, wrap: true, gapY: 20, cross: 'MIN' });
  const states = [
    ['加载中', 'brandSoft', 'brand', 'ink', '正在加载任务…', '骨架屏用 --brand-soft 色块，不做旋转菊花'],
    ['空数据', 'brandSoft', 'brand', 'ink', '还没有学习任务', '提供下一步：去安全闯关'],
    ['筛选无结果', 'brandSoft', 'brand', 'ink', '没有符合条件的任务', '动作是"切换上方条件"，不是"重新加载"'],
    ['请求失败', 'dangerSoft', 'danger', 'danger', '任务加载失败', '动作是"重新加载"，并说明可重试'],
  ];
  for (const [title, bgKey, fgKey, inkKey, msg, note] of states) {
    const c = col('st', { gap: 12, w: 246, fill: C.surface, stroke: C.line, sw: 1, radius: 14, padX: 18, padY: 20, cross: 'CENTER' });
    const ic = col('icon', { w: 52, h: 52, radius: 999, fill: C[bgKey], cross: 'CENTER', main: 'CENTER' });
    add(ic, text(title === '请求失败' ? '!' : '◌', { size: 20, weight: 700, color: C[fgKey] }), null);
    ic.children[0].textAlignHorizontal = 'CENTER';
    add(c, ic, null);
    add(c, text(msg, { size: 13, weight: 700, color: C[inkKey] }), 'H');
    c.children[c.children.length - 1].textAlignHorizontal = 'CENTER';
    add(c, text(note, { size: 10.5, weight: 400, color: C.muted, w: 210, lh: 1.45 }), 'H');
    c.children[c.children.length - 1].textAlignHorizontal = 'CENTER';
    add(c, title === '加载中' ? chip('无动作', { fill: C.surfaceSoft, color: C.muted, size: 10.5, padX: 12, padY: 5 })
      : btn(title === '请求失败' ? '重新加载' : (title === '空数据' ? '去安全闯关' : '切换条件'), 'secondary', { h: 32, padX: 14, size: 12 }), null);
    add(stGrid, c);
  }
  add(b.body, stGrid, 'H');
  add(b.body, text('图标底为 88rpx 圆形、图标 48rpx（此处按 1/2 折算为 44px / 24px）。加载态用骨架屏，不用转圈动画。',
    { size: 11.5, weight: 400, color: C.muted, w: CW }), 'H');

  return b.outer;
}

/* ------------------------------ 导航 ------------------------------ */
function b5Nav() {
  const b = board('15 · 导航 Navigation', '小程序用自定义 TabBar 5 项；后台用 224px 深墨绿侧栏 —— 这是对现有浅色壳的一处明确变化。', W, null);

  add(b.body, sectionLabel('小程序 TabBar', { color: C.brand }), 'H');
  const mpWrap = col('mpWrap', { gap: 12, w: 375 });
  const tb = mpTabBar(0);
  tb.cornerRadius = 12;
  tb.strokes = [solid(C.line)];
  tb.strokeAlign = 'INSIDE';
  tb.strokeWeight = 1;
  add(mpWrap, tb, 'H');
  add(mpWrap, text('白底 + --line 上边线；选中项 --brand-text 字 + --brand 图标，未选中 --muted。五项固定：待办 / 记录 / 闯关 / 消息 / 我的。',
    { size: 10.5, weight: 400, color: C.muted, w: 375, lh: 1.5 }), 'H');
  add(b.body, mpWrap, 'H');

  add(b.body, sectionLabel('Web 后台侧栏与顶栏', { color: C.brandDeep }), 'H');
  const navRow = row('navRow', { gap: 28, w: CW, cross: 'MIN', wrap: true, gapY: 20 });

  // 侧栏（深墨绿）
  {
    const side = col('侧栏', { w: 234, fill: C.brandInk, radius: 12, padX: 0, padY: 0, gap: 0, clips: true });
    const brandRow = row('品牌', { w: 234, h: 62, padX: 18, gap: 10, cross: 'CENTER' });
    add(brandRow, logoGroup(24, { mono: C.accent }));
    const bt = col('bt', { gap: 1 });
    add(bt, text('安全培训', { size: 13.5, weight: 700, color: C.white }));
    add(bt, text('EDU PLATFORM', { size: 8, weight: 500, color: C.accent, ls: 0.6 }));
    add(brandRow, bt);
    add(side, brandRow, 'H');
    const menu = col('menu', { gap: 2, padX: 10, padY: 8 });
    for (const [icon, label, on] of [
      ['◫', '工作台', false], ['▤', '培训任务', true], ['◈', '题库与试卷', false],
      ['◉', '人员与组织', false], ['▦', '培训计划', false], ['❏', '证照管理', false],
    ]) {
      const it = row('mi', { w: 214, h: 44, padX: 12, gap: 11, cross: 'CENTER', radius: 8, fill: on ? C.brand : null, fillOpacity: on ? 0.16 : null });
      if (on) {
        const barEl = tintBar(C.accent, 3, 2);
        barEl.resize(3, 17);
        add(it, barEl);
        it.paddingLeft = 6;
      } else add(it, box(3, 17));
      add(it, text(icon, { size: 13.5, weight: 500, color: on ? C.accent : C.brandLine }), 'H');
      add(it, text(label, { size: 13, weight: on ? 700 : 400, color: on ? C.accent : '#CFE2DC' }), 'H');
      add(menu, it, 'H');
    }
    add(side, menu, 'H');
    add(navRow, labelWrap('侧栏 224px · 深墨绿', '选中项 --brand 12% 透明底 + --accent 文字 + 左侧 3px 黄绿指示条。'
      + '深侧栏把管理端和员工端拉到同一品牌下，同时让浅色内容区获得更强对比。', side));
  }

  // 顶栏（白底）
  {
    const top = row('顶栏', { w: 506, h: 64, padX: 20, cross: 'CENTER', fill: C.surface, stroke: C.line, sw: 1, radius: 12 });
    add(top, text('培训任务管理', { size: 15, weight: 700, color: C.ink }));
    add(top, flex());
    const srch = row('srch', { w: 180, h: 34, padX: 11, gap: 7, cross: 'CENTER', radius: 8, fill: C.surfaceSoft, stroke: C.line, sw: 1 });
    add(srch, text('⌕', { size: 12.5, color: C.muted }));
    add(srch, text('搜索任务 / 人员', { size: 12, color: C.muted }));
    add(top, srch);
    add(top, box(12, 1));
    add(top, dot(C.accent, 30), null);
    add(top, box(8, 1));
    add(top, text('孙金宁', { size: 12.5, weight: 600, color: C.ink }));
    const tw = col('tw', { gap: 14, w: 506 });
    add(tw, labelWrap('顶栏 64px · 白底', '白底 + --line 下边线。左侧页面标题、中间留白、右侧搜索 + 账号。', top), 'H');
    add(navRow, tw);
  }
  add(b.body, navRow, 'H');

  return b.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const cleared = clearBoards(['▣ 1']);
const put = stackAt(ZX, 0, 200);
put(b0Buttons());
put(b1Cards());
put(b2Chips());
put(b3Forms());
put(b4Rows());
put(b5Nav());

return {
  分区: 'B · 组件库',
  画板数: 6,
  清理旧画板: cleared,
  本区高度: put.end(),
  位置: { x: ZX },
};
