//!include ./_kit-fin.js

/* 只读：把 54 板上第 4 张（深色）KPI 卡的子树完整量出来 —— 名称 / 尺寸 / 位置 / 是否 FILL / layoutGrow。
 * 起因：溢出探针报「kpi 的副行纵超 12px」，但主因疑似不是副行本身，
 * 而是标签行里的弹性占位块（layoutGrow=1）跟标签（FILL）在抢宽度，把标签挤到折行。 */

await useFinPage();

const art = figma.currentPage.children.find((n) => n.name.indexOf('▣ 54') === 0);
if (!art) throw new Error('找不到 54 板');

/* 找出所有 kpi 卡；取最后一张（深色那张）。 */
const kart = [];
(function find(n) {
  if (n.name === 'kpi') kart.push(n);
  for (const c of n.children || []) find(c);
})(art);
if (!kart.length) throw new Error('没找到 kpi 卡');

const dump = (n, depth) => {
  const b = n.absoluteBoundingBox;
  const row = {
    缩进: '  '.repeat(depth),
    名: n.name.slice(0, 26),
    型: n.type,
    宽: Math.round(n.width * 10) / 10,
    高: Math.round(n.height * 10) / 10,
    x: b ? Math.round(b.x) : null,
    y: b ? Math.round(b.y) : null,
    H: 'layoutSizingHorizontal' in n ? n.layoutSizingHorizontal : null,
    V: 'layoutSizingVertical' in n ? n.layoutSizingVertical : null,
    grow: n.layoutGrow,
    autoResize: n.type === 'TEXT' ? n.textAutoResize : null,
    trunc: n.type === 'TEXT' ? n.textTruncation : null,
    maxLines: n.type === 'TEXT' ? n.maxLines : null,
  };
  const out = [row];
  for (const c of n.children || []) out.push(...dump(c, depth + 1));
  return out;
};

const last = kart[kart.length - 1];
const tree = dump(last, 0);
const pb = last.absoluteBoundingBox;

return {
  卡片数: kart.length,
  卡片尺寸: { 宽: last.width, 高: last.height },
  卡片底边Y: Math.round(pb.y + pb.height),
  子树: tree,
  /* 关键判断：每个直接子节点的底边 vs 卡片底边 */
  直接子节点底边: (last.children || []).map((c) => {
    const cb = c.absoluteBoundingBox;
    return {
      名: c.name.slice(0, 20),
      底边: Math.round(cb.y + cb.height),
      超出卡片: Math.round(cb.y + cb.height - (pb.y + pb.height)),
    };
  }),
};
