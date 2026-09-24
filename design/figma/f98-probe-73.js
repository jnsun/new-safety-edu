//!include ./_kit-fin-c.js

/* 只读：核对 73 板历史批次表里「回滚」按钮的样式（仅 已应用 行应为 danger 红）。 */
await useFinPage();

// ⚠️ 别再踩同一个坑：_kit-core.js 里有 `function board`，同名 const 直接语法报错。
const art = figma.currentPage.children.find((n) => n.name.indexOf('▣ 73') === 0);
if (!art) return { err: '找不到 73 板' };

const hex = (fills) => {
  if (!fills || !fills.length || fills[0].type !== 'SOLID') return 'none';
  const c = fills[0].color;
  const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return '#' + to(c.r) + to(c.g) + to(c.b) + (fills[0].opacity != null ? '@' + fills[0].opacity : '');
};

const found = [];
function walk(n) {
  if (n.name && n.name.indexOf('btn·回滚') === 0) {
    const t = n.children.find((k) => k.type === 'TEXT');
    found.push({
      名称: n.name,
      背景: hex(n.fills),
      描边: hex(n.strokes) + (n.strokeTopWeight ? ' w' + n.strokeTopWeight : ''),
      字色: t ? hex(t.fills) : '?',
    });
  }
  if (n.children) for (const k of n.children) walk(k);
}
walk(art);

/* 顺带量一下：有没有文本节点真的被压缩成省略号（textTruncation 生效但内容超宽）。 */
const clipped = [];
function scan(n) {
  if (n.type === 'TEXT' && n.textTruncation === 'ENDING') {
    const need = Math.ceil(n.fontSize) * [...n.characters].length;
    if (need > n.width + 1) clipped.push({ 文本: n.characters, 宽: Math.round(n.width), 需要约: need });
  }
  if (n.children) for (const k of n.children) scan(k);
}
scan(art);

return { 回滚按钮: found, 可能被省略的文本: clipped };
