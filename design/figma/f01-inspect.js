// 只读：盘点目标文件的结构与既有约定
const pages = figma.root.children.map((p) => ({
  id: p.id,
  name: p.name,
  childCount: p.children.length,
}));

// 本机已加载的本地变量集合（不切页也能读）
let collections = [];
try {
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  collections = cols.map((c) => ({
    id: c.id,
    name: c.name,
    varCount: c.variableIds.length,
    modes: c.modes.map((m) => m.name),
  }));
} catch (e) {
  collections = [{ error: String(e && e.message) }];
}

// 本地文本样式 / 效果样式
let textStyles = [];
let effectStyles = [];
let paints = [];
try {
  textStyles = (await figma.getLocalTextStylesAsync()).map((s) => ({ id: s.id, name: s.name }));
  effectStyles = (await figma.getLocalEffectStylesAsync()).map((s) => ({ id: s.id, name: s.name }));
  paints = (await figma.getLocalPaintStylesAsync()).map((s) => ({ id: s.id, name: s.name }));
} catch (e) {
  textStyles = [{ error: String(e && e.message) }];
}

// 字体可用性（后面写文本要用，先探明）
let fontProbe = [];
try {
  const fonts = await figma.listAvailableFontsAsync();
  const wanted = ['Inter', 'Noto Sans SC', 'Source Han Sans SC', 'PingFang SC', 'Microsoft YaHei', 'HarmonyOS Sans SC', 'Alibaba PuHuiTi'];
  const byFamily = {};
  for (const f of fonts) {
    if (!wanted.includes(f.fontName.family)) continue;
    (byFamily[f.fontName.family] = byFamily[f.fontName.family] || []).push(f.fontName.style);
  }
  fontProbe = Object.keys(byFamily).map((k) => ({ family: k, styles: byFamily[k].slice(0, 12), total: byFamily[k].length }));
  fontProbe.push({ family: '__totalAvailable__', styles: [String(fonts.length)] });
} catch (e) {
  fontProbe = [{ error: String(e && e.message) }];
}

return {
  editorType: figma.editorType,
  fileName: figma.root.name,
  pages,
  collections,
  textStyles,
  effectStyles,
  paintStyles: paints,
  fontProbe,
};
