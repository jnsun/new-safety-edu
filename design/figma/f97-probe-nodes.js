//!include ./_kit-fin-c.js

/* 只读：列出 Page 2 顶层画板的 id / 位置 / 尺寸，用于取截图 nodeId。 */
await useFinPage();

const out = [];
for (const n of figma.currentPage.children) {
  out.push({
    id: n.id,
    name: n.name,
    x: n.x,
    y: n.y,
    w: n.width,
    h: n.height,
  });
}
out.sort((a, b) => (a.x - b.x) || (a.y - b.y));
return { 页面: figma.currentPage.name, 画板数: out.length, 画板: out };
