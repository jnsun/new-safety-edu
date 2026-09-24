// 只读探针：量 72 台账页里「侧栏菜单项」与「表格各列」的实际宽度。
// 用途：验证 finTable 的列宽是否按 defs 真实分配、菜单项是否折行。
const PG = '财务应收 · 视觉规范';
let pg = null;
for (const p of figma.root.children) if (p.name === PG) pg = p;
if (!pg) return '找不到页面 ' + PG;
await figma.setCurrentPageAsync(pg);

const b = pg.children.filter((n) => n.name.indexOf('▣ 72') === 0)[0];
if (!b) return '找不到 72 画板';

function find(n, key) {
  if (n.name && n.name.indexOf(key) === 0) return n;
  if (!n.children) return null;
  for (const c of n.children) { const r = find(c, key); if (r) return r; }
  return null;
}

const out = [];
const r1 = (v) => Math.round(v * 10) / 10;

const menu = find(b, '菜单');
if (menu) {
  out.push('【侧栏菜单】menu 宽=' + r1(menu.width));
  for (const it of menu.children) {
    const parts = it.children.map((c) => c.name + '=' + r1(c.width));
    out.push('  ' + it.name + '  w=' + r1(it.width) + ' h=' + r1(it.height) + '  [' + parts.join(', ') + ']');
  }
}

const tb = find(b, 'table');
if (tb) {
  out.push('【表格】宽=' + r1(tb.width) + ' 高=' + r1(tb.height));
  const th = tb.children[0];
  out.push('  表头行宽=' + r1(th.width) + ' 列数=' + th.children.length);
  const names = ['财务归属部门', '合同编号', '项目名称', '客户名称', '单位', '决算额', '应收余额', '债权状态', '待核对事项'];
  let acc = 0;
  th.children.forEach((c, i) => {
    acc += c.width;
    out.push('   [' + i + '] ' + (names[i] || '?') + ' 实际=' + r1(c.width) + ' 累计=' + r1(acc));
  });
  out.push('  列宽合计=' + r1(acc));
}
return out.join('\n');
