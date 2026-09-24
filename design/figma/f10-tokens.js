//!include ./_kit.js

/* 建立设计令牌：颜色变量集合 + 圆角/间距数值变量 + 文本样式 + 效果样式。
 * 颜色变量同时写入 WEB code syntax（var(--xxx)），让开发直接对照 CSS 变量名取用。 */

const loadedCount = await loadFonts();

/* ---------------- 幂等：清掉上一轮生成的同名令牌，避免重跑后重复 ---------------- */
const CLEAN = { collections: [], textStyles: [], effectStyles: [] };
for (const c of await figma.variables.getLocalVariableCollectionsAsync()) {
  if (c.name === 'Color · 颜色' || c.name === 'Shape & Space · 形状与间距') {
    CLEAN.collections.push(c.name);
    c.remove();
  }
}
for (const s of await figma.getLocalTextStylesAsync()) {
  if (/^(Mini|Web)\//.test(s.name)) { CLEAN.textStyles.push(s.name); s.remove(); }
}
for (const s of await figma.getLocalEffectStylesAsync()) {
  if (/^Elevation\//.test(s.name)) { CLEAN.effectStyles.push(s.name); s.remove(); }
}

// 作用域常量：避免默认 ALL_SCOPES 污染每个属性选择器
const FILL_ALL = ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR'];
const FILL_BG = ['FRAME_FILL', 'SHAPE_FILL', 'STROKE_COLOR'];
const TEXT_ONLY = ['TEXT_FILL'];

const colorDefs = [
  // [变量名, 色值, 作用域, CSS 变量, 说明, 分组]
  ['brand/ink', C.brandInk, FILL_ALL, '--brand-ink', '最深墨绿。员工端欢迎区、主任务卡；后台侧栏底色'],
  ['brand/deep', C.brandDeep, FILL_ALL, '--brand-deep', '深青绿。权威数据面板、深色卡片次级层'],
  ['brand/base', C.brand, FILL_BG, '--brand', '品牌主青绿（logo 主环）。图形、进度条、图标；禁止用于小于 18px 文字'],
  ['brand/strong', C.brandStrong, FILL_ALL, '--brand-strong', '青绿悬停/按下；可读下限 4.6:1，16px 以上文字可用'],
  ['brand/text', C.brandText, FILL_ALL, '--brand-text', '青绿系唯一可做正文与链接的档位 5.3:1'],
  ['brand/soft', C.brandSoft, FILL_BG, '--brand-soft', '浅底：选中态、信息条、标签底'],
  ['brand/line', C.brandLine, FILL_BG, '--brand-line', '浅描边、分隔'],
  ['accent/base', C.accent, FILL_ALL, '--accent', '主按钮底色，配 brand/ink 文字 11.14:1'],
  ['accent/strong', C.accentStrong, FILL_ALL, '--accent-strong', '黄绿悬停/按下'],
  ['accent/soft', C.accentSoft, FILL_BG, '--accent-soft', '浅底：待办计数、标签'],
  ['accent/ink', C.accentInk, FILL_ALL, '--accent-ink', '黄绿浅底上的深色文字 5.1:1'],
  ['neutral/ink', C.ink, FILL_ALL, '--ink', '标题与正文（带绿相的黑）'],
  ['neutral/ink-soft', C.inkSoft, FILL_ALL, '--ink-soft', '次级正文、表单值'],
  ['neutral/muted', C.muted, FILL_ALL, '--muted', '说明、元信息、占位'],
  ['neutral/line', C.line, FILL_BG, '--line', '常规分隔与描边'],
  ['neutral/line-strong', C.lineStrong, FILL_BG, '--line-strong', '输入框、次级按钮描边'],
  ['neutral/canvas', C.canvas, FILL_BG, '--canvas', '页面底色'],
  ['neutral/surface', C.surface, FILL_BG, '--surface', '卡片与容器'],
  ['neutral/surface-soft', C.surfaceSoft, FILL_BG, '--surface-soft', '卡片内嵌层、表头'],
  ['semantic/success', C.success, FILL_ALL, '--success', '已完成、通过、已确认'],
  ['semantic/success-soft', C.successSoft, FILL_BG, '--success-soft', '成功态浅底'],
  ['semantic/warning', C.warning, FILL_ALL, '--warning', '待补学、即将到期、需补学后重考'],
  ['semantic/warning-soft', C.warningSoft, FILL_BG, '--warning-soft', '警示态浅底'],
  ['semantic/danger', C.danger, FILL_ALL, '--danger', '未通过、已锁定、逾期、不可用'],
  ['semantic/danger-soft', C.dangerSoft, FILL_BG, '--danger-soft', '危险态浅底'],
  ['semantic/info', C.info, FILL_ALL, '--info', '中性提示、外部链接、受控 HTML 课件标识'],
  ['semantic/info-soft', C.infoSoft, FILL_BG, '--info-soft', '信息态浅底'],
  ['neutral/track', C.track, FILL_BG, '--track', '进度条轨道'],
];

const colorColl = figma.variables.createVariableCollection('Color · 颜色');
colorColl.renameMode(colorColl.modes[0].modeId, 'Light');
const modeId = colorColl.modes[0].modeId;

const colorVarIds = [];
for (const [name, hex, scopes, cssVar, desc] of colorDefs) {
  const v = figma.variables.createVariable(name, colorColl, 'COLOR');
  v.setValueForMode(modeId, hex2rgb(hex));
  v.scopes = scopes;
  v.description = desc + '（原始值 ' + hex + '，对应 CSS ' + cssVar + '）';
  try { v.setVariableCodeSyntax('WEB', 'var(' + cssVar + ')'); } catch (e) { /* 部分版本不支持，忽略 */ }
  colorVarIds.push(v.id);
}

// ---- 圆角与间距（数值令牌）----
const numColl = figma.variables.createVariableCollection('Shape & Space · 形状与间距');
numColl.renameMode(numColl.modes[0].modeId, 'Default');
const nMode = numColl.modes[0].modeId;

const numDefs = [
  ['radius/card', 16, ['CORNER_RADIUS'], '--radius-card', '卡片、面板'],
  ['radius/panel', 12, ['CORNER_RADIUS'], '--radius-panel', '内嵌分区、表格容器、图片'],
  ['radius/control', 8, ['CORNER_RADIUS'], '--radius-control', '按钮、输入框'],
  ['radius/tile', 6, ['CORNER_RADIUS'], '--radius-tile', '图标底、计数徽标'],
  ['radius/chip', 999, ['CORNER_RADIUS'], '--radius-chip', '胶囊标签、筛选器'],
  ['space/xs', 4, ['GAP', 'WIDTH_HEIGHT'], '--space-xs', '基础单位'],
  ['space/sm', 8, ['GAP', 'WIDTH_HEIGHT'], '--space-sm', '紧凑间距'],
  ['space/md', 12, ['GAP', 'WIDTH_HEIGHT'], '--space-md', '组件内间距'],
  ['space/lg', 16, ['GAP', 'WIDTH_HEIGHT'], '--space-lg', '卡片间间距'],
  ['space/xl', 24, ['GAP', 'WIDTH_HEIGHT'], '--space-xl', '区块间间距'],
  ['space/2xl', 32, ['GAP', 'WIDTH_HEIGHT'], '--space-2xl', '页面内边距'],
  ['space/3xl', 48, ['GAP', 'WIDTH_HEIGHT'], '--space-3xl', '大区块分隔'],
];

const numVarIds = [];
for (const [name, val, scopes, cssVar, desc] of numDefs) {
  const v = figma.variables.createVariable(name, numColl, 'FLOAT');
  v.setValueForMode(nMode, val);
  v.scopes = scopes;
  v.description = desc + '（' + val + 'px，对应 CSS ' + cssVar + '）';
  try { v.setVariableCodeSyntax('WEB', 'var(' + cssVar + ')'); } catch (e) { /* ignore */ }
  numVarIds.push(v.id);
}

// ---- 文本样式（小程序以 375px 为设计基准，rpx = 2px）----
const textStyleDefs = [
  ['Mini/Display', 28, 700, 1.15, '欢迎语中的姓名、Hero 主标题'],
  ['Mini/H1 页面标题', 22, 700, 1.22, 'page-title'],
  ['Mini/H2 区块标题', 17, 700, 1.35, 'section-title'],
  ['Mini/H3 卡片标题', 16, 600, 1.35, '任务名、课件名'],
  ['Mini/Body-L 正文', 15, 400, 1.55, '正文（沿用默认）'],
  ['Mini/Body 说明', 14, 400, 1.55, '说明、元信息'],
  ['Mini/Caption 次要', 12.5, 500, 1.45, '时间、次要标签'],
  ['Mini/Micro 微标', 11, 600, 1.3, '胶囊标签、计数徽标'],
  ['Web/Page Title', 22, 700, 1.27, '后台页面标题'],
  ['Web/Section', 16, 600, 1.5, '卡片标题'],
  ['Web/Body', 14, 400, 1.57, '常规内容'],
  ['Web/Table', 13, 400, 1.54, '表格正文'],
  ['Web/Label', 12, 600, 1.5, '表头、字段标签'],
  ['Web/Metric', 34, 700, 1.18, '关键统计数字（等宽数字）'],
];

const textStyleIds = [];
for (const [name, size, weight, lh, desc] of textStyleDefs) {
  const s = figma.createTextStyle();
  s.name = name;
  s.fontName = { family: F_CJK, style: styleFor(F_CJK, weight) };
  s.fontSize = size;
  s.lineHeight = { unit: 'PERCENT', value: Math.round(lh * 100) };
  s.description = desc;
  if (name === 'Mini/Micro 微标') s.letterSpacing = { unit: 'PIXELS', value: 0.2 };
  textStyleIds.push(s.id);
}

// ---- 效果样式（阴影色相统一带绿）----
const effectDefs = [
  ['Elevation/Regular', [shadow(C.brandInk, 0.05, 0, 8, 24)], '常规卡片'],
  ['Elevation/Raised', [shadow(C.brandInk, 0.14, 0, 18, 42)], '主任务卡'],
  ['Elevation/Brand', [shadow(C.brandInk, 0.18, 0, 12, 32)], '深色权威面板'],
];
const effectStyleIds = [];
for (const [name, effects, desc] of effectDefs) {
  const s = figma.createEffectStyle();
  s.name = name;
  s.effects = effects;
  s.description = desc;
  effectStyleIds.push(s.id);
}

return {
  预加载字体数: loadedCount,
  清理旧令牌: CLEAN,
  颜色变量集合: { id: colorColl.id, name: colorColl.name, modes: colorColl.modes.map((m) => m.name), count: colorVarIds.length },
  数值变量集合: { id: numColl.id, name: numColl.name, modes: numColl.modes.map((m) => m.name), count: numVarIds.length },
  文本样式数: textStyleIds.length,
  效果样式数: effectStyleIds.length,
  颜色变量IDs: colorVarIds,
  数值变量IDs: numVarIds,
  文本样式IDs: textStyleIds,
  效果样式IDs: effectStyleIds,
};
