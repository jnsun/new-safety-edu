// 只读：以易读的纯文本列出现有画板（便于直接挑 nodeId 截图）
const page = figma.currentPage;
const lines = ['page=' + page.name + ' 顶层节点=' + page.children.length];
for (const n of page.children) {
  lines.push(n.id + '\t' + n.name + '\t' + Math.round(n.x) + ',' + Math.round(n.y) + '\t' + Math.round(n.width) + 'x' + Math.round(n.height));
}
return lines.join('\n');
