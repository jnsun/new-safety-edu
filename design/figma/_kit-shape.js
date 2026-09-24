/* ===========================================================================
 * _kit-shape.js — 通用绘图原语（多边形 / 矩形 / 圆 / 舞台 / 虚线）
 * 被 E 区脚本用 `//!include ./_kit-shape.js` 内联（需先 include ./_kit.js）。
 *
 * 只用这三种基本形就能画出全部图标与插画，且坐标完全可预测 —— 见 poly() 的注释。
 * =========================================================================== */

/**
 * 折线 / 多边形。points: [[x,y],...]；o.close === false 时为开口折线（不闭合）。
 *
 * ⚠️ 为什么刻意不用曲线路径（C / Q 指令）：
 * 给 VectorNode.vectorPaths 赋值后，Figma 会把节点原点归一化到**该路径自身紧包围盒**
 * 的左上角。直线段路径的紧包围盒 = 所有顶点的极值，手算绝对可靠；
 * 而三次贝塞尔的紧包围盒可能外凸超出端点，手算容易错 —— 一错整个图形就跑偏
 * （C 区环形图就是这么踩过一次）。所以图标一律用多边形逼近，既安全又符合
 * "严格扁平、几何化"的风格。
 */
function poly(points, o) {
  o = o || {};
  // ⚠️ 踩过的坑：这里必须对**每个坐标分别**做 _nz 后再拼字符串。
  // 早期写法是 `points.slice(1).map((c) => ' L ' + c)` —— 直接拼数组会走
  // Array.toString()，用逗号连接，生成 "L 64.8,93" 这种非法路径，
  // Figma 报 `Failed to convert path. Invalid command at ,93`。
  const cs = points.map((p) => _nz(p[0]) + ' ' + _nz(p[1]));
  const d = 'M ' + cs[0] + cs.slice(1).map((c) => ' L ' + c).join('')
    + (o.close === false ? '' : ' Z');
  const v = figma.createVector();
  v.name = o.name || 'poly';
  v.vectorPaths = [{ windingRule: 'NONZERO', data: d }];
  v.fills = o.fill != null ? [solid(o.fill, o.opacity)] : [];
  v.strokes = o.stroke != null ? [solid(o.stroke, o.strokeOpacity)] : [];
  if (o.stroke != null) {
    v.strokeWeight = o.sw != null ? o.sw : 2;
    // 默认全圆头圆角；线宽 / 端帽对比图里需要显式传 'SQUARE' / 'MITER' 做反例
    v.strokeCap = o.cap || 'ROUND';
    v.strokeJoin = o.join || 'ROUND';
  }
  let mnx = Infinity, mny = Infinity;
  for (const p of points) {
    if (p[0] < mnx) mnx = p[0];
    if (p[1] < mny) mny = p[1];
  }
  v.x = (o.x || 0) + mnx;
  v.y = (o.y || 0) + mny;
  return v;
}

/** 矩形（可圆角、可单角圆角）。矩形 / 椭圆没有包围盒归一化问题，x/y 即精确原点。 */
function irect(x, y, w, h, o) {
  o = o || {};
  const r = figma.createRectangle();
  r.name = o.name || 'rect';
  r.fills = o.fill != null ? [solid(o.fill, o.opacity)] : [];
  r.strokes = o.stroke != null ? [solid(o.stroke, o.strokeOpacity)] : [];
  if (o.stroke != null) {
    r.strokeWeight = o.sw != null ? o.sw : 2;
    r.strokeAlign = o.strokeAlign || 'CENTER';
  }
  r.resize(w, h);
  if (o.radius != null) r.cornerRadius = o.radius;
  if (o.rTL != null) r.topLeftRadius = o.rTL;
  if (o.rTR != null) r.topRightRadius = o.rTR;
  if (o.rBR != null) r.bottomRightRadius = o.rBR;
  if (o.rBL != null) r.bottomLeftRadius = o.rBL;
  r.x = x;
  r.y = y;
  return r;
}

/** 圆 / 椭圆。w 给定、h 省略则画正圆。 */
function icircle(x, y, w, h, o) {
  o = o || {};
  const e = figma.createEllipse();
  e.name = o.name || 'circle';
  e.fills = o.fill != null ? [solid(o.fill, o.opacity)] : [];
  e.strokes = o.stroke != null ? [solid(o.stroke, o.strokeOpacity)] : [];
  if (o.stroke != null) e.strokeWeight = o.sw != null ? o.sw : 2;
  e.resize(w, h != null ? h : w);
  e.x = x;
  e.y = y;
  return e;
}

/** 虚线描边（用于留白框、栅格框）。 */
function dash(n, pattern) {
  n.dashPattern = pattern || [5, 4];
  return n;
}

/** 透明容器（绝对定位用）。 */
function layer(name, w, h) {
  const f = frame(name || 'layer', { dir: 'NONE', w: w, h: h });
  f.fills = [];
  f.strokes = [];
  return f;
}

/** 固定尺寸舞台 + 内容居中。用于把 logo / 图标在不同尺寸下等比陈列。 */
function stage(w, h, node, o) {
  o = o || {};
  const f = frame(o.name || 'stage', { dir: 'NONE', w: w, h: h, fill: o.fill, radius: o.radius });
  f.clipsContent = false;
  add(f, node);
  node.x = (w - node.width) / 2;
  node.y = (h - node.height) / 2;
  return f;
}

/** 把节点按「整体包围盒左上角」定位到 (X,Y)。 */
function placeNodes(nodes, X, Y) {
  let mnx = Infinity, mny = Infinity;
  for (const n of nodes) {
    if (n.x < mnx) mnx = n.x;
    if (n.y < mny) mny = n.y;
  }
  for (const n of nodes) { n.x += X - mnx; n.y += Y - mny; }
  return nodes;
}

/** 等比拉伸（**只用于演示"错误用法"**）。矢量节点 resize 会真的缩放几何。 */
function stretchGroup(g, sx, sy) {
  for (const c of g.children) {
    c.x = c.x * sx;
    c.y = c.y * sy;
    c.resize(Math.max(0.5, c.width * sx), Math.max(0.5, c.height * sy));
  }
  g.resize(g.width * sx, g.height * sy);
  return g;
}
