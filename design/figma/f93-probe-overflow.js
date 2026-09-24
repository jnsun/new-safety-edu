// 只读诊断：逐层检查 E 区画板里有没有子节点超出父容器（横向 / 纵向溢出）。
// 缩略截图看不出 1–20px 的溢出，但它在 Figma 里就是"贴边"或"被裁"。
const LIMIT = 0.5;
const out = [];
const roots = figma.currentPage.children.filter((n) => /^▣ 4/.test(n.name));

function walk(n, path) {
  const kids = 'children' in n ? n.children : [];
  if (kids.length) {
    const isAuto = n.type === 'FRAME' && n.layoutMode && n.layoutMode !== 'NONE';
    for (const c of kids) {
      const r = c.x + c.width;
      const b = c.y + c.height;
      const ow = r - n.width;
      const oh = b - n.height;
      // 自动布局父级：子节点 x/y 一定在内部，只查右/下越界。
      // 绝对定位父级：也查左/上负值（说明有人算错了归位）。
      if (ow > LIMIT || oh > LIMIT || c.x < -LIMIT || c.y < -LIMIT) {
        out.push([
          path + '/' + c.name,
          '子 ' + Math.round(c.x) + ',' + Math.round(c.y) + ' ' + Math.round(c.width) + 'x' + Math.round(c.height),
          '父 ' + Math.round(n.width) + 'x' + Math.round(n.height) + (isAuto ? '(auto)' : '(abs)'),
          '越界 右' + Math.round(ow) + ' 下' + Math.round(oh),
        ].join('  |  '));
      }
      walk(c, path + '/' + c.name);
    }
  }
}

for (const r of roots) walk(r, r.name);

const lines = ['检查画板数=' + roots.length + '，越界条目=' + out.length];
for (const s of out.slice(0, 40)) lines.push(s);
return lines.join('\n');
