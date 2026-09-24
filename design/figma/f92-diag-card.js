// 只读：诊断「11 · 卡片 Card」里白卡的内部结构高度，找出多余空隙的来源
function findByName(node, namePart, out) {
  out = out || [];
  if (node.name && node.name.indexOf(namePart) >= 0) out.push(node);
  if ('children' in node) for (const c of node.children) findByName(c, namePart, out);
  return out;
}
const boardNode = figma.currentPage.children.find((n) => n.name.indexOf('▣ 11') === 0);
if (!boardNode) return { error: '找不到 11 · 卡片 Card 画板' };

const cards = findByName(boardNode, '白卡');
const target = cards[0];
function dump(n, depth) {
  const pad = '  '.repeat(depth);
  const line = pad + n.name + ' [' + n.type + '] ' + Math.round(n.width) + '×' + Math.round(n.height)
    + (n.type === 'TEXT' ? ' "' + String(n.characters).slice(0, 14) + '"' : '')
    + (n.layoutMode && n.layoutMode !== 'NONE' ? ' ' + n.layoutMode + ' gap=' + n.itemSpacing : '')
    + ('layoutGrow' in n && n.layoutGrow ? ' grow=' + n.layoutGrow : '');
  const out = [line];
  if ('children' in n) for (const c of n.children) out.push(...dump(c, depth + 1));
  return out;
}
return {
  白卡: Math.round(target.width) + '×' + Math.round(target.height),
  结构: dump(target, 0).join('\n'),
};
