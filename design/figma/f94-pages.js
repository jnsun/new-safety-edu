// 只读：列出该 Figma 文件的所有页面，以及每个页面的顶层节点概览。
//
// ⚠️ 这里必须先 setCurrentPageAsync 再读 children。
// 实测：跨会话（每次 use_figma 都是新会话）直接读 root.children[i].children 会
// 拿到**过期缓存** —— 曾读到刚建好的页「顶层节点=0」，误判画板丢了；
// 切过去一次就会触发该页内容重新加载，数字才对得上。
const root = figma.root;
const out = ['文件: ' + root.name + '   页面数=' + root.children.length];
for (let i = 0; i < root.children.length; i++) {
  const pg = root.children[i];
  try { await figma.setCurrentPageAsync(pg); } catch (e) { out.push('  (切页失败: ' + e.message + ')'); }
  out.push('[' + i + '] ' + pg.name + '   id=' + pg.id + '   顶层节点=' + pg.children.length);
  const sample = pg.children.slice(0, 40).map((n) =>
    '      ' + n.id + '\t' + n.name + '\t' + Math.round(n.x) + ',' + Math.round(n.y) + '\t' + Math.round(n.width) + 'x' + Math.round(n.height));
  out.push(...sample);
  if (pg.children.length > 40) out.push('      …（其余 ' + (pg.children.length - 40) + ' 个略）');
}
out.push('当前页面: ' + figma.currentPage.name + ' (' + figma.currentPage.id + ')');
return out.join('\n');
