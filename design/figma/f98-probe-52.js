//!include ./_kit-fin.js

/* 只读：量 52 板「金额与数字」这一段三个容器的实际位置与宽度，定位 158px 溢出的来源。 */
await useFinPage();

const art = figma.currentPage.children.find((n) => n.name.indexOf('▣ 52') === 0);
if (!art) return { err: '找不到 52 板' };

const out = [];
function walk(n) {
  if (['amt', 'demos', 'dd', 'rules', 'demo'].indexOf(n.name) >= 0) {
    const b = n.absoluteBoundingBox;
    out.push({ 名: n.name, x: Math.round(b.x), w: Math.round(b.width), 右: Math.round(b.x + b.width), 子数: n.children ? n.children.length : 0 });
  }
  if (n.children) for (const k of n.children) walk(k);
}
walk(art);
return { 明细: out };
