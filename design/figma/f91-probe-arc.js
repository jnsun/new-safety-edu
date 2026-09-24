//!include ./_kit.js

// 探针：确定 EllipseNode.arcData 的角度约定（起点基准与旋转方向）
await loadFonts();
const g = frame('PROBE arcData', { dir: 'HORIZONTAL', gap: 24, padX: 24, padY: 24, fill: C.surface });
g.x = 6000; g.y = -1400;

const QUARTER = Math.PI / 2;
const cases = [
  ['0 → π/2', 0, QUARTER],
  ['0 → π', 0, Math.PI],
  ['-π/2 → 0', -QUARTER, 0],
  ['π/2 → π', QUARTER, Math.PI],
  ['0 → 3π/2', 0, 3 * QUARTER],
  ['-π/2 → π/2', -QUARTER, QUARTER],
];

for (const [label, s, e] of cases) {
  const c = col('case', { gap: 8, w: 130, cross: 'CENTER' });
  const wrap = frame('wrap', { dir: 'NONE', w: 120, h: 120, fill: C.canvas, radius: 8 });
  const el = figma.createEllipse();
  el.name = 'arc';
  el.fills = [];
  el.strokes = [solid(C.brand)];
  el.strokeWeight = 14;
  el.resize(96, 96);
  el.x = 12; el.y = 12;
  el.arcData = { startingAngle: s, endingAngle: e, innerRadius: 0.62 };
  add(wrap, el);
  // 参考：一个不透明小圆点标出「12 点」方向，便于判读
  const t = dot(C.danger, 8);
  t.x = 56; t.y = 8;
  add(wrap, t);
  add(c, wrap, null);
  add(c, text(label, { size: 11, weight: 600, color: C.ink }), 'H');
  add(g, c);
}

return { probeId: g.id, 说明: '红点=12 点方向；观察绿色圆弧的起止位置' };
