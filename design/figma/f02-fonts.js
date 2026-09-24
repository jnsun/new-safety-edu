// 只读：探明 Inter / Noto Sans SC 的非斜体 style 全名，以及文件里可用的组件/变量规模
const all = await figma.listAvailableFontsAsync();
const want = ['Inter', 'Noto Sans SC', 'Roboto', 'Arial'];
const map = {};
for (const f of all) {
  const fam = f.fontName.family;
  if (!want.includes(fam)) continue;
  (map[fam] = map[fam] || []).push(f.fontName.style);
}
const out = Object.keys(map).map((fam) => ({
  family: fam,
  nonItalic: map[fam].filter((s) => !/italic/i.test(s)),
  italicCount: map[fam].filter((s) => /italic/i.test(s)).length,
}));

// 顺带确认当前页可用画布范围
const page = figma.currentPage;
return {
  fonts: out,
  totalFontsAvailable: all.length,
  currentPage: { id: page.id, name: page.name, children: page.children.length },
  selectionCount: figma.currentPage.selection.length,
};
