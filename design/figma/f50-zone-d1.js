//!include ./_kit.js
//!include ./_kit-web.js

/* D 区（上）· Web 管理后台：登录 / 培训看板 / 培训安排 / 课件管理
 * 布局：单列竖排于 x=2640，起点 y=1944（C 区下方）。每屏 1440×900。 */

await loadFonts();

const ZX = 2640;
const ZY = 1944;
const GAPD = 140;

/** 后台侧栏菜单。索引即选中项。 */
function MENU(active) {
  return [
    ['◫', '培训看板', active === 0],
    ['▤', '培训安排', active === 1],
    ['◈', '课件管理', active === 2],
    ['▦', '题库与试卷', active === 3],
    ['◉', '学习记录', active === 4],
    ['◍', '人员与组织', active === 5],
    ['❏', '证照管理', active === 6],
    ['⚙', '报表与设置', active === 7],
  ];
}

/* ============================== 30 登录 ============================== */
function w30Login() {
  const outer = row('▣ 30 · 登录', { gap: 0, w: WEB_W, h: WEB_H, fill: C.surface, clips: true });

  // 左：品牌面
  const left = col('品牌面', { w: 720, h: WEB_H, fill: C.brandInk, padX: 72, padY: 72, gap: 26 });
  const lg = row('lg', { gap: 14, cross: 'CENTER' });
  add(lg, logoGroup(48, { mono: C.accent }));
  const lgt = col('lgt', { gap: 3 });
  add(lgt, text('安全生产培训教育平台', { size: 17, weight: 700, color: C.white }));
  add(lgt, text('SAFETY TRAINING · EDU PLATFORM', { size: 9, weight: 500, color: C.accent, ls: 0.8 }));
  add(lg, lgt);
  add(left, lg, 'H');
  add(left, flex(), 'H');
  add(left, text('把培训安排、学习过程和完成情况\n收在同一处', { size: 34, weight: 700, color: C.white, lh: 1.35, w: 560 }), 'H');
  add(left, text('员工在手机上学习与考试，管理员在后台下发、跟踪与导出。'
    + '所有完成记录按人员和组织自动归集，不再靠表格来回统计。', {
    size: 13, weight: 400, color: '#9FC4B9', w: 520, lh: 1.7,
  }), 'H');
  const feats = col('feats', { gap: 12 });
  for (const [k, v] of [
    ['培训范围自动展开', '公司级下发到全员，部门 / 项目级自动含所有下级组织'],
    ['学习与考试闭环', '课件学习 → 在线考试 → 补学重考，全程留痕'],
    ['证照到期预警', '按有效期自动提醒，避免过期上岗'],
  ]) {
    const r = row('ft', { gap: 10, cross: 'MIN' });
    const d = tintBar(C.accent, 6, 3);
    d.resize(6, 6);
    add(r, d, null);
    add(r, text(k, { size: 12.5, weight: 700, color: C.white, w: 150 }), null);
    add(r, text(v, { size: 11.5, weight: 400, color: '#9FC4B9', w: 330, lh: 1.5 }), 'H');
    add(feats, r, 'H');
  }
  add(left, feats, 'H');
  add(left, flex(), 'H');
  add(left, text('© 2026 安全生产培训教育平台 · 内部系统，请勿外传', { size: 10.5, weight: 400, color: '#6E9A8E' }), 'H');
  add(outer, left, 'V');

  // 右：表单
  const right = col('表单面', { h: WEB_H, fill: C.surface, main: 'CENTER', cross: 'CENTER', gap: 0 });
  add(outer, right, 'B');
  const card = col('login', { gap: 20, w: 380 });
  add(card, text('登录', { size: 22, weight: 700, color: C.ink }), 'H');
  add(card, text('使用管理员账号登录后台', { size: 12.5, weight: 400, color: C.muted }), 'H');
  add(card, field('账号', 'admin@company.com', 'normal', { w: 380 }), 'H');
  add(card, field('密码', '••••••••••', 'normal', { w: 380 }), 'H');
  const rr = row('rr', { gap: 8, cross: 'CENTER' });
  add(rr, text('忘记密码请联系系统管理员', { size: 11, weight: 400, color: C.muted }), 'H');
  add(rr, flex(), null);
  add(rr, text('微信扫码登录', { size: 11, weight: 600, color: C.brandText }));
  add(card, rr, 'H');
  add(card, btn('登 录', 'primary', { h: 46, padX: 24, size: 14.5 }), 'H');
  const tip = row('tip', { gap: 8, w: 380, fill: C.warningSoft, radius: 8, padX: 12, padY: 10, cross: 'MIN' });
  add(tip, text('!', { size: 11, weight: 700, color: C.warning }));
  add(tip, text('这是文档用的形态示例，不是真实登录页；账号与密码请以实际部署为准。', {
    size: 10.5, weight: 400, color: C.warning, w: 330, lh: 1.5,
  }), 'H');
  add(card, tip, 'H');
  add(right, card, 'H');
  return outer;
}

/* ============================ 31 培训看板 ============================ */
function w31Dashboard() {
  const s = webShell('31 · 培训看板', { menu: MENU(0), crumb: '培训看板', user: '孙金宁 · 公司管理员' });
  const c = s.content;

  add(c, webPageHead('培训看板', '2026 年第三季度 · 数据截至 2026-09-24 09:00',
    [btn('导出报表', 'secondary', { h: 36 }), btn('新建培训', 'primary', { h: 36 })]), 'H');

  const kpis = row('kpis', { gap: 16, w: WEB_CW });
  const kpiDefs = [
    ['应完成', '1,284', '人 · 覆盖 12 个部门', 'brand'],
    ['已完成', '1,043', '完成率 81.3%，较上周 +4.2%', 'success'],
    ['进行中', '168', '人 · 已开始未完成', 'brand'],
    ['已逾期', '73', '人 · 需催办', 'warning'],
  ];
  for (const [label, v, sub, tone] of kpiDefs) {
    add(kpis, kpiCard(label, v, sub, tone, { w: 278 }), 'H');
  }
  add(c, kpis, 'H');

  const mid = row('mid', { gap: 16, w: WEB_CW, cross: 'MIN' });

  // 部门完成率
  const dp = webPanel({ name: '部门完成率', w: 700 });
  add(dp, webSection('部门完成率', text('按应完成人数排序', { size: 11, color: C.muted })), 'H');
  const rowsWrap = col('rows', { gap: 11, w: 660 });
  for (const [dept, total, done, pct, warn] of [
    ['工程物探部', 268, 246, 0.92, false],
    ['地质勘查部', 214, 167, 0.78, false],
    ['测绘工程部', 186, 119, 0.64, true],
    ['机关科室', 142, 122, 0.86, false],
    ['岩土工程部', 158, 129, 0.82, false],
    ['安全监督部', 96, 94, 0.98, false],
  ]) {
    const r = row('dr', { gap: 12, w: 660, cross: 'CENTER' });
    add(r, text(dept, { size: 12.5, weight: 500, color: C.ink, w: 92 }), null);
    add(r, text(total + ' 人', { size: 11.5, weight: 400, color: C.muted, w: 56 }), null);
    add(r, progress(pct, { w: 320, h: 8, color: warn ? C.warning : (pct >= 0.9 ? C.success : C.brand) }), null);
    add(r, text(Math.round(pct * 100) + '%', { size: 12, weight: 700, color: warn ? C.warning : C.ink, w: 44 }), null);
    add(r, text(done + ' / ' + total, { size: 11, weight: 400, color: C.muted, w: 72 }), null);
    add(rowsWrap, r, 'H');
  }
  add(dp, rowsWrap, 'H');
  add(mid, dp, 'V');

  // 待处理
  const tp = webPanel({ name: '待处理', w: 444 });
  add(tp, webSection('待处理事项'), 'H');
  const todo = col('todo', { gap: 10, w: 404 });
  for (const [icon, title, meta, kind] of [
    ['!', '73 人培训已逾期', '涉及 4 个部门，最长的已逾期 11 天', 'locked'],
    ['◷', '12 份补学申请待审', '等待管理员确认是否通过', 'confirm'],
    ['❏', '5 张证照 30 天内到期', '测绘工程部 3 张、工程物探部 2 张', 'warning'],
    ['◫', '3 个培训计划待下发', '已建好但未选择下发范围', 'neutral'],
  ]) {
    const r = row('td', { gap: 11, w: 404, cross: 'MIN' });
    const ic = col('ic', { w: 28, h: 28, radius: 8, fill: C.surfaceSoft, cross: 'CENTER', main: 'CENTER' });
    add(ic, text(icon, { size: 12, weight: 700, color: kind === 'locked' ? C.danger : (kind === 'warning' ? C.warning : C.brandText) }), null);
    ic.children[0].textAlignHorizontal = 'CENTER';
    add(r, ic, null);
    const tx = col('tx', { gap: 3 });
    add(tx, text(title, { size: 12.5, weight: 600, color: C.ink }), 'H');
    add(tx, text(meta, { size: 10.5, weight: 400, color: C.muted, w: 330, lh: 1.4 }), 'H');
    add(r, tx, 'H');
    add(todo, r, 'H');
  }
  add(tp, todo, 'H');
  add(mid, tp, 'V');
  add(c, mid, 'H');

  // 近期安排
  const recent = col('recent', { gap: 12, w: WEB_CW, fill: C.surface, radius: 12, stroke: C.line, sw: 1, padX: 20, padY: 16 });
  add(recent, webSection('近期培训安排', btn('查看全部', 'ghost', { h: 30, padX: 10, size: 12 })), 'H');
  add(recent, webTable(
    [{ title: '培训名称', w: 300 }, { title: '类型', w: 96 }, { title: '适用范围', w: 200 },
      { title: '应完成', w: 90, align: 'RIGHT' }, { title: '已完成', w: 140 }, { title: '截止时间', w: 150 }, { title: '状态', w: 148 }],
    [
      ['高处作业安全规程', '课件+考试', '工程物探部 → 全员', '268', cellProgress(0.92), '2026-09-30 18:00', tag('进行中', 'doing')],
      ['起重机械安全操作', '课件学习', '公司级 → 全员', '1,284', cellProgress(0.81), '2026-10-08 18:00', tag('进行中', 'doing')],
      ['应急预案桌面演练', '线上考试', '地质勘查部 → 全员', '214', cellProgress(0.45, C.warning), '2026-10-12 18:00', tag('需补学', 'warning')],
    ], { zebra: false }), 'H');
  add(c, recent, 'H');

  return s.outer;
}

/* ============================ 32 培训安排 ============================ */
function w32Training() {
  const s = webShell('32 · 培训安排', { menu: MENU(1), crumb: '培训安排', user: '孙金宁 · 公司管理员' });
  const c = s.content;

  add(c, webPageHead('培训安排', '共 24 项培训 · 其中 6 项进行中、3 项待下发',
    [btn('批量催办', 'secondary', { h: 36 }), btn('新建培训', 'primary', { h: 36 })]), 'H');
  add(c, webFilterBar([
    [['全部状态', true], ['进行中', false], ['待下发', false], ['已结束', false]],
    [['全部类型', true], ['课件学习', false], ['在线考试', false], ['课件+考试', false]],
    [['全部范围', true], ['公司级', false], ['部门级', false], ['项目级', false]],
  ], '搜索培训名称 / 发起人'), 'H');

  const rows = [
    ['高处作业安全规程', '课件+考试', '工程物探部 → 全员', '268', cellProgress(0.92), '2026-09-30 18:00', tag('进行中', 'doing'), webActions(['跟踪', '编辑'])],
    ['起重机械安全操作', '课件学习', '公司级 → 全员', '1,284', cellProgress(0.81), '2026-10-08 18:00', tag('进行中', 'doing'), webActions(['跟踪', '编辑'])],
    ['应急预案桌面演练', '线上考试', '地质勘查部 → 全员', '214', cellProgress(0.45, C.warning), '2026-10-12 18:00', tag('需补学', 'warning'), webActions(['催办', '跟踪'])],
    ['岗位风险辨识（第二期）', '课件+考试', '测绘工程部 → 全员', '186', cellProgress(0.2, C.warning), '2026-09-20 18:00', tag('已逾期', 'locked'), webActions(['催办', '跟踪'])],
    ['有限空间作业安全', '课件学习', '公司级 → 全员', '1,284', cellProgress(0.96), '2026-09-10 18:00', tag('已完成', 'done'), webActions(['查看', '导出'])],
    ['消防应急疏散演练', '线上考试', '机关科室 → 全员', '142', cellProgress(0.86), '2026-09-05 18:00', tag('已完成', 'done'), webActions(['查看', '导出'])],
    ['安全操作技能考核', '线上考试', '岩土工程部 → 全员', '158', cellProgress(0.0), '—', tag('待下发', 'neutral'), webActions(['下发', '编辑', '删除'])],
    ['新员工三级安全教育', '课件+考试', '公司级 → 全员', '—', cellProgress(0.0), '—', tag('待下发', 'neutral'), webActions(['下发', '编辑', '删除'])],
    ['临时用电安全规范', '课件学习', '安全监督部 → 全员', '96', cellProgress(0.98), '2026-08-28 18:00', tag('已完成', 'done'), webActions(['查看', '导出'])],
    ['交通安全与车辆管理', '课件学习', '公司级 → 全员', '1,284', cellProgress(1.0), '2026-08-15 18:00', tag('已完成', 'done'), webActions(['查看', '导出'])],
  ];
  add(c, webTable(
    [{ title: '培训名称', w: 236 }, { title: '类型', w: 96 }, { title: '适用范围', w: 176 },
      { title: '应完成', w: 84, align: 'RIGHT' }, { title: '已完成', w: 140 }, { title: '截止时间', w: 140 },
      { title: '状态', w: 104 }, { title: '操作', w: 184 }], rows), 'H');
  add(c, webPager(24, 1), 'H');

  return s.outer;
}

/* ============================ 33 课件管理 ============================ */
function w33Courseware() {
  const s = webShell('33 · 课件管理', { menu: MENU(2), crumb: '课件管理', user: '孙金宁 · 公司管理员' });
  const c = s.content;

  add(c, webPageHead('课件管理', '共 46 个课件 · 支持富文本块编辑与 Excel 批量导入',
    [btn('Excel 批量导入', 'secondary', { h: 36 }), btn('新建课件', 'primary', { h: 36 })]), 'H');

  const split = webSplit(16);

  // 左：分类
  const catPanel = webPanel({ name: '分类', w: 240, padX: 12, padY: 14, gap: 4 });
  add(catPanel, text('课件分类', { size: 12.5, weight: 700, color: C.inkSoft }), 'H');
  catPanel.paddingBottom = 14;
  add(catPanel, box(1, 4), 'H');
  for (const [name, count, on] of [
    ['全部课件', 46, true], ['通用安全', 18, false], ['岗位技能', 14, false],
    ['应急处置', 7, false], ['管理类', 4, false], ['新员工入职', 3, false],
  ]) {
    const r = row('cat', { gap: 8, w: 216, h: 36, padX: 10, cross: 'CENTER', radius: 8, fill: on ? C.brandSoft : null });
    add(r, text(name, { size: 12.5, weight: on ? 700 : 500, color: on ? C.brandText : C.inkSoft }), 'H');
    add(r, text(String(count), { size: 11, weight: on ? 700 : 400, color: on ? C.brandText : C.muted }));
    add(catPanel, r, 'H');
  }
  split.left(catPanel);

  // 右：课件表
  const right = col('右', { gap: 14, w: 904 });
  add(right, webFilterBar([], '搜索课件名称', { searchW: 240 }), 'H');
  add(right, webTable(
    [{ title: '课件名称', w: 300 }, { title: '分类', w: 96 }, { title: '章节', w: 64, align: 'CENTER' },
      { title: '时长', w: 76, align: 'RIGHT' }, { title: '关联培训', w: 100, align: 'CENTER' },
      { title: '状态', w: 92 }, { title: '操作', w: 176 }],
    [
      ['高处作业安全规程', '岗位技能', '3', '24 分钟', '2', tag('已发布', 'done'), webActions(['预览', '编辑'])],
      ['起重机械安全操作', '岗位技能', '5', '38 分钟', '1', tag('已发布', 'done'), webActions(['预览', '编辑'])],
      ['应急预案桌面演练', '应急处置', '4', '31 分钟', '1', tag('已发布', 'done'), webActions(['预览', '编辑'])],
      ['岗位风险辨识（第一期）', '通用安全', '6', '42 分钟', '3', tag('已发布', 'done'), webActions(['预览', '编辑'])],
      ['有限空间作业安全', '岗位技能', '4', '27 分钟', '1', tag('已发布', 'done'), webActions(['预览', '编辑'])],
      ['消防应急疏散演练', '应急处置', '3', '19 分钟', '1', tag('已发布', 'done'), webActions(['预览', '编辑'])],
      ['临时用电安全规范', '通用安全', '2', '14 分钟', '1', tag('草稿', 'neutral'), webActions(['编辑', '删除'])],
      ['新员工三级安全教育', '新员工入职', '8', '56 分钟', '1', tag('草稿', 'neutral'), webActions(['编辑', '删除'])],
    ]), 'H');
  add(right, webPager(46, 1), 'H');
  split.right(right);

  add(c, split.root, 'H');
  return s.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const cleared = clearBoards(['▣ 3']);
const boards = [w30Login(), w31Dashboard(), w32Training(), w33Courseware()];
let y = ZY;
for (const f of boards) { f.x = ZX; f.y = y; y += f.height + GAPD; }

return {
  分区: 'D 区（上）· Web 后台',
  画板数: boards.length,
  清理旧画板: cleared,
  起止: { x: ZX, y0: ZY, 结束Y: y - GAPD },
};
