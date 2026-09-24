/* 只读探针：把文件里的文本样式 / 颜色样式 / 效果样式 / 变量全部拉出来，
 * 用于核对画布上的令牌资产是否与《财务应收视觉规范》§2.2 令牌表、§3.2 字阶 一一对应。
 *
 * ⚠️ 全部走 *Async 变体：同步的 getLocalTextStyles() 在新版 API 里已移除或待废弃。
 * 变量接口是 Figma 的新 API，老文件/老权限下可能为空数组，所以用 try 兜住，不因为取不到就整条挂掉。
 */

const text = await figma.getLocalTextStylesAsync();
const paints = await figma.getLocalPaintStylesAsync();
const effects = await figma.getLocalEffectStylesAsync();
const grids = await figma.getLocalGridStylesAsync();

let collections = [];
let variables = [];
try {
  collections = await figma.variables.getLocalVariableCollectionsAsync();
  variables = await figma.variables.getLocalVariablesAsync();
} catch (e) {
  collections = [];
  variables = [];
}

const round = (n) => Math.round(n * 100) / 100;

const textOut = text.map((s) => ({
  id: s.id,
  name: s.name,
  font: s.fontName && typeof s.fontName === 'object' ? `${s.fontName.family} / ${s.fontName.style}` : String(s.fontName),
  size: round(s.fontSize),
  lh: s.lineHeight && s.lineHeight.unit === 'PIXELS' ? s.lineHeight.value : (s.lineHeight ? s.lineHeight.unit : null),
  ls: s.letterSpacing ? `${round(s.letterSpacing.value)}${s.letterSpacing.unit === 'PERCENT' ? '%' : 'px'}` : null,
  trunc: s.textTruncation || 'NONE',
  maxLines: s.maxLines == null ? null : s.maxLines,
}));

const paintOut = paints.map((s) => {
  const p = s.paints && s.paints[0];
  let hex = null;
  if (p && p.type === 'SOLID') {
    const c = p.color;
    const to255 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    hex = '#' + [to255(c.r), to255(c.g), to255(c.b)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return { id: s.id, name: s.name, hex, opacity: p && p.opacity != null ? round(p.opacity) : 1 };
});

const effectOut = effects.map((s) => ({
  id: s.id,
  name: s.name,
  effects: (s.effects || []).map((e) => e.type + (e.radius != null ? ':' + round(e.radius) : '')),
}));

const varOut = variables.map((v) => {
  const col = collections.find((c) => c.id === v.variableCollectionId);
  const values = {};
  for (const modeId of Object.keys(v.valuesByMode || {})) {
    const mode = col ? (col.modes.find((m) => m.modeId === modeId) || {}).name : modeId;
    const raw = v.valuesByMode[modeId];
    let val = raw;
    if (raw && typeof raw === 'object' && raw.r != null) {
      const to255 = (x) => Math.round(Math.min(1, Math.max(0, x)) * 255);
      val = '#' + [to255(raw.r), to255(raw.g), to255(raw.b)].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    values[mode || modeId] = val;
  }
  return {
    name: v.name,
    resolvedType: v.resolvedType,
    collection: col ? col.name : null,
    values,
  };
});

return {
  页面: figma.currentPage.name,
  文本样式: { 数量: textOut.length, 清单: textOut },
  颜色样式: { 数量: paintOut.length, 清单: paintOut },
  效果样式: { 数量: effectOut.length, 清单: effectOut },
  网格样式: { 数量: grids.length, 名称: grids.map((g) => g.name) },
  变量集合: collections.map((c) => ({
    名称: c.name,
    模式: c.modes.map((m) => m.name),
    变量数: c.variableIds.length,
  })),
  变量: { 数量: varOut.length, 清单: varOut },
};
