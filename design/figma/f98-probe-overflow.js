//!include ./_kit-fin.js

/* 只读：全页溢出探针。
 * 逐层比对「子节点 bbox 是否超出父节点 bbox」——这是唯一能自动抓出
 * 「列宽超了、行高被撑破、卡片内容压到描边上」这类问题的通用手段（截图靠肉眼看容易漏）。
 *
 * ⚠️ 早期版本只报**直接父节点**的名字，于是拿到「kpi 里纵超 12」这种结论时，
 * 根本不知道是哪块画板上的 kpi —— 必须一路把顶层画板名带下来，否则报出来的问题无法定位。 */

await useFinPage();

const bad = [];
function bbox(n) {
  const b = n.absoluteBoundingBox;
  return b ? { l: b.x, t: b.y, r: b.x + b.width, b: b.y + b.height } : null;
}
function walk(n, depth, art) {
  if (!n.children || !n.children.length) return;
  const pb = bbox(n);
  if (!pb) return;
  for (const k of n.children) {
    const cb = bbox(k);
    if (!cb) continue;
    /* ⚠️ 判断溢出要用「子边越出父边多少」：
     * 左 = 父左 − 子左，右 = 子右 − 父右。写成「父右 − 子右」会把
     * 「父容器里的剩余空白」当成溢出 —— 第一次跑出 4529 条假阳性就是这么来的。
     * dx/dy 为**负数**表示子节点完全落在父节点内部（不是溢出）。 */
    const dx = Math.max(pb.l - cb.l, cb.r - pb.r);
    const dy = Math.max(pb.t - cb.t, cb.b - pb.b);
    if (dx > 1.5 || dy > 1.5) {
      bad.push({
        属板: art,
        父: n.name.slice(0, 22),
        子: k.name.slice(0, 18),
        横超: Math.round(dx * 10) / 10,
        纵超: Math.round(dy * 10) / 10,
        层: depth,
      });
    }
    walk(k, depth + 1, art);
  }
}
for (const art of figma.currentPage.children) walk(art, 0, art.name);

/* 按「属板」分组统计，方便一眼看出问题集中在哪几块板。 */
const byArt = {};
for (const e of bad) byArt[e.属板] = (byArt[e.属板] || 0) + 1;

return {
  画板数: figma.currentPage.children.length,
  溢出数: bad.length,
  按板统计: byArt,
  明细: bad.slice(0, 40),
};
