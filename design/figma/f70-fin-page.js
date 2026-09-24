//!include ./_kit.js
//!include ./_kit-fin-palette.js

/* 第 1 步：在「workbuddy设计」文件里新建第 2 个页面，并写入财务应收的设计令牌。
 *
 * ⚠️ 关键：Figma 的变量集合与文本样式是**文件级**的，不随页面走。
 * Page 1 已有 `Color · 颜色` / `Shape & Space · 形状与间距` 两个集合和 Mini/ Web/ 前缀的文本样式。
 * 所以这里所有令牌一律用独立名字（后缀「财务应收」/ 前缀 `Fin/`），
 * 清理时也只按这些名字清理 —— 绝不动 Page 1 的任何东西。
 *
 * 依据：docs/design/财务应收视觉规范-v1.md §2.2 / §3.2 / §4.1 / §4.2 / §4.4
 */

const loaded = await loadFonts();

const PAGE_NAME = '财务应收 · 视觉规范';

/* ------------------------- 1. 建页 / 找页 并切过去 ------------------------- */
const root = figma.root;
let page = null;
for (const p of root.children) if (p.name === PAGE_NAME) page = p;
let created = false;
if (!page) {
  page = figma.createPage();
  page.name = PAGE_NAME;
  created = true;
}
/* ⚠️ 新版 Figma API 里 `figma.currentPage = x` 的 setter 已被移除（实测报
 * "Setting figma.currentPage is not supported"），必须用异步的 setCurrentPageAsync。
 * 切换是必须的：figma.createFrame() 会自动把新节点挂到**当前页面**。 */
await figma.setCurrentPageAsync(page);

/* ------------------- 2. 幂等：只清本页与 Fin 前缀的令牌 ------------------- */
const CLEAN = { boards: [], collections: [], textStyles: [], effectStyles: [] };
for (const n of Array.from(page.children)) { CLEAN.boards.push(n.name); n.remove(); }
for (const c of await figma.variables.getLocalVariableCollectionsAsync()) {
  if (c.name === 'Color · 财务应收' || c.name === 'Shape & Space · 财务应收') {
    CLEAN.collections.push(c.name);
    c.remove();
  }
}
for (const s of await figma.getLocalTextStylesAsync()) {
  if (/^Fin/.test(s.name)) { CLEAN.textStyles.push(s.name); s.remove(); }
}
for (const s of await figma.getLocalEffectStylesAsync()) {
  if (/^Fin /.test(s.name)) { CLEAN.effectStyles.push(s.name); s.remove(); }
}

/* ----------------------------- 3. 颜色变量 ----------------------------- */
const FILL_ALL = ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR'];
const FILL_BG = ['FRAME_FILL', 'SHAPE_FILL', 'STROKE_COLOR'];
const TEXT_ONLY = ['TEXT_FILL'];

const finColors = [
  // [变量名, 色值, 作用域, CSS 变量, 说明]
  ['shell/ink-900', C.brandInk, FILL_ALL, '--fin-ink-900', '墨绿最深：侧栏、深色汇总条、主按钮文字'],
  ['shell/ink-800', C.brandDeep, FILL_ALL, '--fin-ink-800', '深墨绿：深色次级面、悬停'],
  ['shell/ink-700', C.brandMid, FILL_ALL, '--fin-ink-700', '中深绿：深底上的抬升面'],
  ['shell/on-ink', C.onInk, TEXT_ONLY, '--fin-on-ink', '深底正文 14.64:1'],
  ['shell/on-ink-2', C.onInk2, TEXT_ONLY, '--fin-on-ink-2', '深底次要文字 10.92:1'],
  ['shell/on-ink-3', C.onInk3, TEXT_ONLY, '--fin-on-ink-3', '深底辅助文字 5.77:1'],

  ['brand/base', C.brand, FILL_BG, '--fin-brand', '品牌青绿=logo 主环。★仅图形，禁作文字（白底 3.20:1 不合格）'],
  ['brand/strong', C.brandStrong, FILL_ALL, '--fin-brand-strong', '青绿悬停/按下'],
  ['brand/text', C.brandText, FILL_ALL, '--fin-brand-text', '青绿文字版 5.27:1，链接与可点文字用这个'],
  ['brand/soft', C.brandSoft, FILL_BG, '--fin-brand-soft', '浅底：选中行、信息条'],
  ['brand/line', C.brandLine, FILL_BG, '--fin-brand-line', '青绿浅描边'],

  ['accent/base', C.accent, FILL_ALL, '--fin-accent', 'logo 黄绿。★只出现在深色底上（白底 1.42:1 等于看不见）'],
  ['accent/strong', C.accentStrong, FILL_ALL, '--fin-accent-strong', '黄绿悬停/按下'],
  ['accent/soft', C.accentSoft, FILL_BG, '--fin-accent-soft', '浅底：标记、图表填充'],
  ['accent/ink', C.accentInk, TEXT_ONLY, '--fin-accent-ink', '黄绿底的文字 10.30:1'],

  ['neutral/ink', C.ink, FILL_ALL, '--fin-ink', '正文 17.79:1'],
  ['neutral/ink-soft', C.inkSoft, FILL_ALL, '--fin-ink-soft', '次级正文'],
  ['neutral/muted', C.muted, FILL_ALL, '--fin-muted', '辅助文字 5.63:1'],
  ['neutral/line', C.line, FILL_BG, '--fin-line', '分隔线与表格线'],
  ['neutral/line-strong', C.lineStrong, FILL_BG, '--fin-line-strong', '输入框边、冻结列分隔'],
  ['neutral/canvas', C.canvas, FILL_BG, '--fin-canvas', '页面底色'],
  ['neutral/surface', C.surface, FILL_BG, '--fin-surface', '卡片与表格'],
  ['neutral/surface-soft', C.surfaceSoft, FILL_BG, '--fin-surface-soft', '表头底'],
  ['neutral/sand', C.sand, FILL_BG, '--fin-sand', '米色分区：说明区、页脚'],
  ['neutral/track', C.track, FILL_BG, '--fin-track', '进度条轨道'],

  ['semantic/warning', C.warning, FILL_BG, '--fin-warning', 'logo 橙。★图形专用：逾期、超收、决算未定（白底 3.20:1 不合格）'],
  ['semantic/warning-text', C.warningText, FILL_ALL, '--fin-warning-text', '橙文字版 5.76:1'],
  ['semantic/warning-soft', C.warningSoft, FILL_BG, '--fin-warning-soft', '警示浅底'],
  ['semantic/danger', C.danger, FILL_ALL, '--fin-danger', '作废、撤销、回滚 6.54:1'],
  ['semantic/danger-soft', C.dangerSoft, FILL_BG, '--fin-danger-soft', '危险浅底'],
  ['semantic/success', C.success, FILL_ALL, '--fin-success', '结清、已应用 6.52:1'],
  ['semantic/success-soft', C.successSoft, FILL_BG, '--fin-success-soft', '成功浅底'],
  ['semantic/info', C.info, FILL_ALL, '--fin-info', 'logo 蓝：信息 5.77:1'],
  ['semantic/info-soft', C.infoSoft, FILL_BG, '--fin-info-soft', '信息浅底'],
  ['semantic/neutral', C.neutral, FILL_ALL, '--fin-neutral', 'logo 深灰：停用、历史值 8.06:1'],
  ['semantic/neutral-soft', C.neutralSoft, FILL_BG, '--fin-neutral-soft', '停用浅底'],
];

const colorColl = figma.variables.createVariableCollection('Color · 财务应收');
colorColl.renameMode(colorColl.modes[0].modeId, 'Light');
const cMode = colorColl.modes[0].modeId;
for (const [name, hex, scopes, cssVar, desc] of finColors) {
  const v = figma.variables.createVariable(name, colorColl, 'COLOR');
  v.setValueForMode(cMode, hex2rgb(hex));
  v.scopes = scopes;
  v.description = desc + '（' + hex + '，CSS ' + cssVar + '）';
  try { v.setVariableCodeSyntax('WEB', 'var(' + cssVar + ')'); } catch (e) { /* 忽略 */ }
}

/* --------------------------- 4. 数值变量 --------------------------- */
const numColl = figma.variables.createVariableCollection('Shape & Space · 财务应收');
numColl.renameMode(numColl.modes[0].modeId, 'Default');
const nMode = numColl.modes[0].modeId;

const finNums = [
  ['radius/card', 14, ['CORNER_RADIUS'], '--fin-r-card', '卡片、面板'],
  ['radius/panel', 10, ['CORNER_RADIUS'], '--fin-r-panel', '内嵌区块、筛选条'],
  ['radius/control', 8, ['CORNER_RADIUS'], '--fin-r-control', '按钮、输入框、下拉'],
  ['radius/tile', 6, ['CORNER_RADIUS'], '--fin-r-tile', '状态标签、色块'],
  ['radius/pill', 999, ['CORNER_RADIUS'], '--fin-r-pill', '胶囊、状态点'],
  ['space/xs', 4, ['GAP', 'WIDTH_HEIGHT'], '--fin-space-xs', '基础单位'],
  ['space/sm', 8, ['GAP', 'WIDTH_HEIGHT'], '--fin-space-sm', '紧凑间距'],
  ['space/md', 12, ['GAP', 'WIDTH_HEIGHT'], '--fin-space-md', '组件内间距'],
  ['space/lg', 16, ['GAP', 'WIDTH_HEIGHT'], '--fin-space-lg', '卡片之间'],
  ['space/xl', 20, ['GAP', 'WIDTH_HEIGHT'], '--fin-space-xl', '卡片内边距'],
  ['space/2xl', 24, ['GAP', 'WIDTH_HEIGHT'], '--fin-space-2xl', '页面内边距'],
  ['space/3xl', 32, ['GAP', 'WIDTH_HEIGHT'], '--fin-space-3xl', '大区块分隔'],
  ['space/4xl', 40, ['GAP', 'WIDTH_HEIGHT'], '--fin-space-4xl', '画板边距'],
  ['space/5xl', 48, ['GAP', 'WIDTH_HEIGHT'], '--fin-space-5xl', '最大分隔'],
  ['layout/page', 1440, ['WIDTH_HEIGHT'], '--fin-page-w', '设计基准宽'],
  ['layout/sidebar', 208, ['WIDTH_HEIGHT'], '--fin-sidebar-w', '侧栏宽（安全生产为 224，财务更窄以让位宽表）'],
  ['layout/topbar', 56, ['WIDTH_HEIGHT'], '--fin-topbar-h', '顶栏高'],
  ['layout/content', 1184, ['WIDTH_HEIGHT'], '--fin-content-w', '内容宽 = 1440 − 208 − 24×2'],
  ['table/row-h', 36, ['WIDTH_HEIGHT'], '--fin-row-h', '表格行高'],
  ['table/head-h', 40, ['WIDTH_HEIGHT'], '--fin-head-h', '表头高'],
  ['table/money-w', 142, ['WIDTH_HEIGHT'], '--fin-money-w', '金额列宽'],
];
for (const [name, val, scopes, cssVar, desc] of finNums) {
  const v = figma.variables.createVariable(name, numColl, 'FLOAT');
  v.setValueForMode(nMode, val);
  v.scopes = scopes;
  v.description = desc + '（' + val + 'px，CSS ' + cssVar + '）';
  try { v.setVariableCodeSyntax('WEB', 'var(' + cssVar + ')'); } catch (e) { /* 忽略 */ }
}

/* ---------------------------- 5. 文本样式 ---------------------------- */
/* ⚠️ 字重只写 400 / 500 / 700：Noto Sans SC 没有真实的 SemiBold，
 * 写 600 这边会落到 Medium，但前端照抄 600 时浏览器会向 Bold(700) 取近似 —— 两边不一致。
 * 行高用百分比而非像素：这样字号改一档，行高跟着等比缩放，不会脱节。 */
const finText = [
  ['Fin/Page Title', 20, 500, 1.40, '页面标题（合同台账）'],
  ['Fin/Page Desc', 13, 400, 1.50, '标题下说明'],
  ['Fin/Section', 15, 500, 1.45, '区块标题'],
  ['Fin/Card Title', 14, 500, 1.45, '卡片标题'],
  ['Fin/Metric', 30, 700, 1.20, 'KPI 主数字（等宽数字）'],
  ['Fin/Metric Sub', 12, 400, 1.50, 'KPI 说明'],
  ['Fin/Table Head', 12, 500, 1.35, '表头'],
  ['Fin/Table Cell', 13, 400, 1.55, '表格正文'],
  ['Fin/Table Cell Bold', 13, 500, 1.55, '关键金额列'],
  ['Fin/Body', 14, 400, 1.60, '表单与正文'],
  ['Fin/Label', 12, 500, 1.35, '表单标签'],
  ['Fin/Tag', 12, 500, 1.35, '状态标签'],
  ['Fin/Micro', 11, 400, 1.45, '修订号、元信息'],
];
for (const [name, size, weight, lh, desc] of finText) {
  const s = figma.createTextStyle();
  s.name = name;
  s.fontName = { family: F_CJK, style: styleFor(F_CJK, weight) };
  s.fontSize = size;
  s.lineHeight = { unit: 'PERCENT', value: Math.round(lh * 100) };
  s.description = desc;
}

/* ---------------------------- 6. 效果样式 ---------------------------- */
for (const [name, effects, desc] of [
  ['Fin Elevation/Card', [shadow(C.brandInk, 0.05, 0, 1, 2)], '常规卡片（极轻）'],
  ['Fin Elevation/Pop', [shadow(C.brandInk, 0.12, 0, 8, 24)], '浮层、下拉、抽屉'],
]) {
  const s = figma.createEffectStyle();
  s.name = name;
  s.effects = effects;
  s.description = desc;
}

return {
  页面: { 名称: page.name, id: page.id, 新建: created, 页面总数: root.children.length },
  清理: CLEAN,
  颜色变量: finColors.length,
  数值变量: finNums.length,
  文本样式: finText.length,
  效果样式: 2,
  对比度抽检: {
    '白/墨绿最深': Math.round(cr(C.white, C.brandInk) * 100) / 100,
    '墨绿最深/黄绿(主按钮)': Math.round(cr(C.brandInk, C.accent) * 100) / 100,
    '青绿/白(应<4.5)': Math.round(cr(C.brand, C.white) * 100) / 100,
    '青绿文字版/白': Math.round(cr(C.brandText, C.white) * 100) / 100,
    '橙文字版/白': Math.round(cr(C.warningText, C.white) * 100) / 100,
  },
};
