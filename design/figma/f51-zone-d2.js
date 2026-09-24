//!include ./_kit.js
//!include ./_kit-web.js

/* D 区（下）· Web 管理后台：题库与试卷 / 学习记录 / 人员与组织 / 证照管理
 * 起点 y=6104（D 区上方的下方）。 */

await loadFonts();

const ZX = 2640;
const ZY = 6104;
const GAPD = 140;

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

/* =========================== 34 题库与试卷 =========================== */
function w34Questions() {
  const s = webShell('34 · 题库与试卷', { menu: MENU(3), crumb: '题库与试卷', user: '孙金宁 · 公司管理员' });
  const c = s.content;

  add(c, webPageHead('题库与试卷', '共 862 道题 · 覆盖 8 个安全板块，支持按规范原文批量原创出题',
    [btn('查重去重', 'secondary', { h: 36 }), btn('新建题目', 'primary', { h: 36 })]), 'H');

  const kpis = row('kpis', { gap: 16, w: WEB_CW });
  for (const [label, v, sub, tone] of [
    ['题目总数', '862', '单选 604 · 多选 186 · 判断 72', 'brand'],
    ['已启用', '794', '含 68 道待审核未启用', 'success'],
    ['试卷数', '34', '其中 9 份正在被培训引用', 'brand'],
    ['平均正确率', '78.4', '%；最低板块：有限空间作业 61.2%', 'warning'],
  ]) add(kpis, kpiCard(label, v, sub, tone, { w: 278 }), 'H');
  add(c, kpis, 'H');

  add(c, webFilterBar([
    [['全部题型', true], ['单选', false], ['多选', false], ['判断', false]],
    [['全部板块', true], ['通用安全', false], ['高处作业', false], ['起重吊装', false], ['有限空间', false]],
  ], '搜索题干关键词 / 规范条款号'), 'H');

  add(c, webTable(
    [{ title: '题干', w: 372 }, { title: '题型', w: 84 }, { title: '分值', w: 64, align: 'CENTER' },
      { title: '所属板块', w: 140 }, { title: '引用次数', w: 96, align: 'CENTER' },
      { title: '版本', w: 84, align: 'CENTER' }, { title: '状态', w: 100 }, { title: '操作', w: 220 }],
    [
      ['高处作业时，安全带应当如何悬挂？', '单选', '10', '高处作业', '26', 'v2', tag('已启用', 'done'), webActions(['编辑', '停用'])],
      ['下列属于特种作业的有？', '多选', '15', '通用安全', '18', 'v1', tag('已启用', 'done'), webActions(['编辑', '停用'])],
      ['有限空间作业必须先检测氧含量再进入。', '判断', '8', '有限空间', '12', 'v1', tag('已启用', 'done'), webActions(['编辑', '停用'])],
      ['起重吊装作业中，指挥人员应站在哪个位置？', '单选', '10', '起重吊装', '21', 'v2', tag('已启用', 'done'), webActions(['编辑', '停用'])],
      ['临时用电线路的架空高度要求是？', '单选', '10', '通用安全', '15', 'v1', tag('已启用', 'done'), webActions(['编辑', '停用'])],
      ['遇到火灾时应当乘坐电梯快速撤离。', '判断', '8', '消防应急', '9', 'v1', tag('已启用', 'done'), webActions(['编辑', '停用'])],
      ['下列关于坠落防护的说法，错误的是？', '单选', '10', '高处作业', '0', 'v1', tag('待审核', 'confirm'), webActions(['审核', '编辑'])],
      ['有限空间作业气体检测的时间间隔要求是？', '单选', '10', '有限空间', '0', 'v1', tag('待审核', 'confirm'), webActions(['审核', '编辑'])],
    ]), 'H');
  add(c, webPager(862, 1), 'H');

  return s.outer;
}

/* ============================ 35 学习记录 ============================ */
function w35Records() {
  const s = webShell('35 · 学习记录', { menu: MENU(4), crumb: '学习记录', user: '孙金宁 · 公司管理员' });
  const c = s.content;

  add(c, webPageHead('学习记录', '可按人员、部门、培训维度查询；数据来自小程序端学习与考试留痕',
    [btn('导出 Excel', 'secondary', { h: 36 }), btn('批量催办', 'primary', { h: 36 })]), 'H');

  const kpis = row('kpis', { gap: 16, w: WEB_CW });
  for (const [label, v, sub, tone] of [
    ['已完成', '1,043', '占总应完成人数的 81.3%', 'success'],
    ['进行中', '168', '平均进度 46%', 'brand'],
    ['未开始', '73', '其中 73 人已逾期', 'warning'],
    ['平均成绩', '82.6', '分 · 合格线 80 分', 'brand'],
  ]) add(kpis, kpiCard(label, v, sub, tone, { w: 278 }), 'H');
  add(c, kpis, 'H');

  add(c, webFilterBar([
    [['全部部门', true], ['工程物探部', false], ['地质勘查部', false], ['测绘工程部', false]],
    [['全部状态', true], ['已完成', false], ['进行中', false], ['已逾期', false]],
    [['近 30 天', true], ['近 90 天', false], ['本年度', false]],
  ], '搜索姓名 / 工号 / 手机号'), 'H');

  add(c, webTable(
    [{ title: '姓名', w: 108 }, { title: '所属组织', w: 168 }, { title: '培训名称', w: 232 },
      { title: '进度', w: 152 }, { title: '成绩', w: 76, align: 'CENTER' }, { title: '最近学习', w: 144 },
      { title: '状态', w: 100 }, { title: '操作', w: 180 }],
    [
      ['王建国', '工程物探部 / 外业一组', '高处作业安全规程', cellProgress(1.0, C.success), '92', '2026-09-22 16:20', tag('已完成', 'done'), webActions(['查看明细', '导出'])],
      ['李海燕', '地质勘查部 / 内业组', '起重机械安全操作', cellProgress(1.0, C.success), '96', '2026-09-18 10:05', tag('已完成', 'done'), webActions(['查看明细', '导出'])],
      ['张玉良', '测绘工程部 / 测量一组', '应急预案桌面演练', cellProgress(0.45, C.warning), '—', '2026-09-23 09:12', tag('需补学', 'warning'), webActions(['查看明细', '催办'])],
      ['赵启明', '工程物探部 / 外业二组', '高处作业安全规程', cellProgress(0.7), '—', '2026-09-24 08:41', tag('进行中', 'doing'), webActions(['查看明细', '催办'])],
      ['孙立群', '机关科室 / 安全管理', '有限空间作业安全', cellProgress(1.0, C.success), '88', '2026-09-10 14:30', tag('已完成', 'done'), webActions(['查看明细', '导出'])],
      ['周文彬', '岩土工程部 / 施工组', '岗位风险辨识（第二期）', cellProgress(0.2, C.warning), '—', '2026-09-19 17:52', tag('已逾期', 'locked'), webActions(['查看明细', '催办'])],
      ['陈丽娟', '安全监督部 / 综合组', '消防应急疏散演练', cellProgress(1.0, C.success), '100', '2026-09-05 11:18', tag('已完成', 'done'), webActions(['查看明细', '导出'])],
      ['吴文涛', '地质勘查部 / 外业组', '临时用电安全规范', cellProgress(0.0), '—', '—', tag('未开始', 'neutral'), webActions(['查看明细', '催办'])],
    ]), 'H');
  add(c, webPager(1284, 1), 'H');

  return s.outer;
}

/* =========================== 36 人员与组织 =========================== */
function w36People() {
  const s = webShell('36 · 人员与组织', { menu: MENU(5), crumb: '人员与组织', user: '孙金宁 · 公司管理员' });
  const c = s.content;

  add(c, webPageHead('人员与组织', '组织架构共 3 级 · 在册 1,284 人 · 支持 Excel 批量导入与账号开通',
    [btn('Excel 批量导入', 'secondary', { h: 36 }), btn('新建人员', 'primary', { h: 36 })]), 'H');
  add(c, webFilterBar([
    [['全部状态', true], ['已开通账号', false], ['待开通', false], ['已停用', false]],
    [['全部类型', true], ['正式人员', false], ['外协人员', false]],
  ], '搜索姓名 / 工号 / 手机号'), 'H');

  const split = webSplit(16);

  // 左：组织树
  const tree = webPanel({ name: '组织', w: 260, padX: 12, padY: 14, gap: 2 });
  add(tree, text('组织架构', { size: 12.5, weight: 700, color: C.inkSoft }), 'H');
  add(tree, box(1, 6), 'H');
  const orgRows = [
    ['公司本部', 1284, 0, true, false],
    ['工程物探部', 268, 1, false, true],
    ['外业一组', 62, 2, false, false],
    ['外业二组', 58, 2, false, false],
    ['内业组', 44, 2, false, false],
    ['地质勘查部', 214, 1, false, false],
    ['测绘工程部', 186, 1, false, false],
    ['岩土工程部', 158, 1, false, false],
    ['机关科室', 142, 1, false, false],
    ['安全监督部', 96, 1, false, false],
  ];
  for (const [name, count, depth, root, on] of orgRows) {
    const r = row('org', {
      gap: 8, w: 236 - depth * 14, h: 32, padX: 8, cross: 'CENTER', radius: 6,
      fill: on ? C.brandSoft : null,
    });
    r.paddingLeft = 8;
    if (depth > 0) {
      const ind = box(depth * 14, 1);
      ind.layoutSizingHorizontal = 'FIXED';
      add(r, ind, null);
    }
    add(r, text(depth === 0 ? '▾' : (count > 100 ? '▸' : '·'), { size: 9, weight: 500, color: C.muted }), null);
    add(r, text(name, { size: 12, weight: (root || on) ? 700 : 400, color: on ? C.brandText : (root ? C.ink : C.inkSoft) }), 'H');
    add(r, text(String(count), { size: 10, weight: 400, color: on ? C.brandText : C.muted }));
    add(tree, r, 'H');
  }
  split.left(tree);

  // 右：人员表
  const right = col('右', { gap: 14, w: 884 });
  add(right, webTable(
    [{ title: '姓名', w: 100 }, { title: '工号', w: 96 }, { title: '所属组织', w: 176 },
      { title: '手机号', w: 132 }, { title: '账号状态', w: 108 }, { title: '培训完成率', w: 146 },
      { title: '操作', w: 126 }],
    [
      ['王建国', 'GC01023', '工程物探部 / 外业一组', '15035081583', tag('已开通', 'done'), cellProgress(0.92), webActions(['编辑'])],
      ['李海燕', 'DZ02187', '地质勘查部 / 内业组', '13835938299', tag('已开通', 'done'), cellProgress(1.0, C.success), webActions(['编辑'])],
      ['张玉良', 'CH03451', '测绘工程部 / 测量一组', '13701234567', tag('已开通', 'done'), cellProgress(0.45, C.warning), webActions(['编辑'])],
      ['赵启明', 'GC01288', '工程物探部 / 外业二组', '15901234876', tag('已开通', 'done'), cellProgress(0.7), webActions(['编辑'])],
      ['孙立群', 'JG00042', '机关科室 / 安全管理', '18601234567', tag('已开通', 'done'), cellProgress(1.0, C.success), webActions(['编辑'])],
      ['周文彬', 'YT04512', '岩土工程部 / 施工组', '13312345678', tag('已开通', 'done'), cellProgress(0.2, C.warning), webActions(['编辑'])],
      ['陈丽娟', 'AQ00316', '安全监督部 / 综合组', '13512345678', tag('已开通', 'done'), cellProgress(1.0, C.success), webActions(['编辑'])],
      ['吴文涛', 'DZ02290', '地质勘查部 / 外业组', '15012345678', tag('待开通', 'confirm'), cellProgress(0.0), webActions(['开通账号', '编辑'])],
      ['郑永强', 'CH03502', '测绘工程部 / 测量二组', '15812345678', tag('待开通', 'confirm'), cellProgress(0.0), webActions(['开通账号', '编辑'])],
      ['刘振华', 'WX00931', '工程物探部 / 外业一组', '13712345678', tag('已停用', 'neutral'), cellProgress(0.0), webActions(['启用'])],
    ]), 'H');
  add(right, webPager(1284, 1), 'H');
  split.right(right);

  add(c, split.root, 'H');
  return s.outer;
}

/* =========================== 37 证照管理 =========================== */
function w37Qualification() {
  const s = webShell('37 · 证照管理', { menu: MENU(6), crumb: '证照管理', user: '孙金宁 · 公司管理员' });
  const c = s.content;

  add(c, webPageHead('证照管理', '共 316 张证照 · 按有效期自动预警，避免过期上岗',
    [btn('Excel 批量导入', 'secondary', { h: 36 }), btn('新增证照', 'primary', { h: 36 })]), 'H');

  const kpis = row('kpis', { gap: 16, w: WEB_CW });
  for (const [label, v, sub, tone] of [
    ['有效证照', '286', '张 · 覆盖 9 类证照', 'success'],
    ['30 天内到期', '18', '张 · 已发提醒给本人与部门', 'warning'],
    ['已过期', '12', '张 · 需立即停岗换证', 'danger'],
    ['待审核', '6', '张 · 附件已上传待确认', 'brand'],
  ]) add(kpis, kpiCard(label, v, sub, tone, { w: 278 }), 'H');
  add(c, kpis, 'H');

  add(c, webFilterBar([
    [['全部证照类型', true], ['特种作业操作证', false], ['安全生产考核合格证', false], ['注册类', false]],
    [['全部状态', true], ['有效', false], ['30 天内到期', false], ['已过期', false], ['待审核', false]],
  ], '搜索持证人 / 证号 / 发证机关'), 'H');

  add(c, webTable(
    [{ title: '持证人', w: 104 }, { title: '证照类型', w: 168 }, { title: '证号', w: 168 },
      { title: '发证机关', w: 176 }, { title: '有效期至', w: 116 }, { title: '预警', w: 104 },
      { title: '附件', w: 66, align: 'CENTER' }, { title: '操作', w: 158 }],
    [
      ['王建国', '特种作业操作证（高处）', 'T 1401101988…', '山西省应急管理厅', '2028-06-30', tag('有效', 'done'), '2', webActions(['查看', '编辑'])],
      ['李海燕', '安全生产考核合格证', 'JZ 2023 041 887', '中国地质调查局', '2027-03-15', tag('有效', 'done'), '1', webActions(['查看', '编辑'])],
      ['张玉良', '特种作业操作证（电工）', 'T 1401101992…', '山西省应急管理厅', '2026-10-18', tag('30 天内到期', 'warning'), '2', webActions(['查看', '提醒'])],
      ['赵启明', '特种作业操作证（起重）', 'T 1401101985…', '山西省应急管理厅', '2029-01-20', tag('有效', 'done'), '1', webActions(['查看', '编辑'])],
      ['周文彬', '特种作业操作证（高处）', 'T 1401101990…', '山西省应急管理厅', '2026-09-01', tag('已过期', 'locked'), '2', webActions(['查看', '停岗'])],
      ['陈丽娟', '注册安全工程师', 'A 2021 003 421', '国家应急管理部', '2027-11-30', tag('有效', 'done'), '3', webActions(['查看', '编辑'])],
      ['吴文涛', '特种作业操作证（焊接）', 'T 1401101993…', '山西省应急管理厅', '2026-10-05', tag('30 天内到期', 'warning'), '1', webActions(['查看', '提醒'])],
      ['郑永强', '测绘作业证', 'CH 2024 1182', '山西省自然资源厅', '2029-04-12', tag('有效', 'done'), '1', webActions(['查看', '编辑'])],
    ]), 'H');
  add(c, webPager(316, 1), 'H');

  return s.outer;
}

/* ------------------------------ 装配 ------------------------------ */
const cleared = clearBoards(['▣ 34', '▣ 35', '▣ 36', '▣ 37']);
const boards = [w34Questions(), w35Records(), w36People(), w37Qualification()];
let y = ZY;
for (const f of boards) { f.x = ZX; f.y = y; y += f.height + GAPD; }

return {
  分区: 'D 区（下）· Web 后台',
  画板数: boards.length,
  清理旧画板: cleared,
  起止: { x: ZX, y0: ZY, 结束Y: y - GAPD },
};
