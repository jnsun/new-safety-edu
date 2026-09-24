/* ===========================================================================
 * _kit-icon.js — 24 栅格图标集 + 插画原语
 * 被 E 区脚本用 `//!include ./_kit-icon.js` 内联（需先 include ./_kit.js + ./_kit-shape.js）。
 *
 * 设计栅格：24×24，描边 2，端帽与拐角一律 ROUND。
 * 严格扁平：只有填充与描边 —— 没有渐变、没有阴影、没有高光。
 * =========================================================================== */

/* ===========================================================================
 * 图标集。每个函数 (s, o) 返回节点数组，坐标为「24 栅格 × s」的局部像素。
 * 几何统一压在 2..22 之间，留 2 单位呼吸，便于压进 20 圆 / 18 方的对齐框。
 * =========================================================================== */
const ICON = {
  /* 安全防护：盾牌 + 对勾 */
  shield: (s, o) => {
    o = o || {};
    const c = o.color || C.brand, sw = 2 * s;
    const P = (a) => a.map((p) => [p[0] * s, p[1] * s]);
    return [
      poly(P([[12, 2], [21, 5.5], [21, 11.5], [19, 16], [15.5, 19.5], [12, 21],
        [8.5, 19.5], [5, 16], [3, 11.5], [3, 5.5]]), { stroke: c, sw, fill: o.fill }),
      poly(P([[8.9, 11.8], [11.2, 14.1], [15.3, 9.8]]), { stroke: c, sw, close: false }),
    ];
  },

  /* 课件学习：摊开的书 */
  book: (s, o) => {
    o = o || {};
    const c = o.color || C.brand, sw = 2 * s;
    const P = (a) => a.map((p) => [p[0] * s, p[1] * s]);
    return [
      poly(P([[11.4, 6.2], [3, 4.6], [3, 17.4], [11.4, 19]]), { stroke: c, sw, fill: o.fill || C.brandSoft }),
      poly(P([[12.6, 6.2], [21, 4.6], [21, 17.4], [12.6, 19]]), { stroke: c, sw, fill: o.fill || C.brandSoft }),
    ];
  },

  /* 在线考试：圆圈 + 对勾（直径正好 20 单位，可贴住栅格对齐框） */
  check: (s, o) => {
    o = o || {};
    const c = o.color || C.brand, sw = 2 * s;
    const P = (a) => a.map((p) => [p[0] * s, p[1] * s]);
    return [
      icircle(2 * s, 2 * s, 20 * s, null, { stroke: c, sw }),
      poly(P([[7.4, 12.2], [10.8, 15.5], [16.6, 9.4]]), { stroke: c, sw, close: false }),
    ];
  },

  /* 学习记录：记事板 + 三行 */
  record: (s, o) => {
    o = o || {};
    const c = o.color || C.brand, sw = 2 * s;
    const P = (a) => a.map((p) => [p[0] * s, p[1] * s]);
    return [
      irect(4 * s, 4 * s, 16 * s, 16.4 * s, { stroke: c, sw, radius: 2.6 * s }),
      poly(P([[7.6, 9.6], [16.4, 9.6]]), { stroke: C.muted, sw: 1.8 * s, close: false }),
      poly(P([[7.6, 12.8], [16.4, 12.8]]), { stroke: C.muted, sw: 1.8 * s, close: false }),
      poly(P([[7.6, 16], [13.4, 16]]), { stroke: C.muted, sw: 1.8 * s, close: false }),
      irect(8.8 * s, 2.2 * s, 6.4 * s, 3.6 * s, { fill: c, radius: 1.4 * s }),
    ];
  },

  /* 证照管理：证书 + 黄绿封条 */
  cert: (s, o) => {
    o = o || {};
    const c = o.color || C.brand, sw = 2 * s;
    const P = (a) => a.map((p) => [p[0] * s, p[1] * s]);
    return [
      irect(3.4 * s, 4 * s, 17.2 * s, 14 * s, { stroke: c, sw, radius: 2.4 * s }),
      irect(5.6 * s, 6.6 * s, 3.4 * s, 8.6 * s, { fill: C.accent, radius: 1.2 * s }),
      poly(P([[11, 8.6], [17.8, 8.6]]), { stroke: C.muted, sw: 1.8 * s, close: false }),
      poly(P([[11, 11.6], [17.8, 11.6]]), { stroke: C.muted, sw: 1.8 * s, close: false }),
      poly(P([[11, 14.6], [15, 14.6]]), { stroke: C.muted, sw: 1.8 * s, close: false }),
    ];
  },

  /* 到期预警：三角感叹号 */
  warning: (s, o) => {
    o = o || {};
    const c = o.color || C.warning, sw = 2 * s;
    const P = (a) => a.map((p) => [p[0] * s, p[1] * s]);
    return [
      poly(P([[12, 2.6], [22, 20.4], [2, 20.4]]), { stroke: c, sw, fill: o.fill || C.warningSoft }),
      poly(P([[12, 9.4], [12, 14.6]]), { stroke: c, sw: 2.2 * s, close: false }),
      icircle(10.9 * s, 16.6 * s, 2.2 * s, null, { fill: c }),
    ];
  },

  /* 人员与组织：三个节点 + 连接线 */
  org: (s, o) => {
    o = o || {};
    const c = o.color || C.brand, sw = 2 * s;
    const P = (a) => a.map((p) => [p[0] * s, p[1] * s]);
    return [
      poly(P([[12, 9.8], [12, 12.4]]), { stroke: c, sw: 1.8 * s, close: false }),
      poly(P([[12, 12.4], [5.8, 14.4]]), { stroke: c, sw: 1.8 * s, close: false }),
      poly(P([[12, 12.4], [18.2, 14.4]]), { stroke: c, sw: 1.8 * s, close: false }),
      icircle(8.8 * s, 3.2 * s, 6.4 * s, null, { stroke: c, sw }),
      icircle(2.6 * s, 14.4 * s, 6.4 * s, null, { stroke: c, sw }),
      icircle(15 * s, 14.4 * s, 6.4 * s, null, { stroke: c, sw }),
    ];
  },

  /* 报表统计：三根柱 + 基线 */
  chart: (s, o) => {
    o = o || {};
    const P = (a) => a.map((p) => [p[0] * s, p[1] * s]);
    return [
      irect(3.6 * s, 15.4 * s, 4.2 * s, 6 * s, { fill: C.brandStrong, radius: 1.4 * s }),
      irect(9.9 * s, 11 * s, 4.2 * s, 10.4 * s, { fill: C.brand, radius: 1.4 * s }),
      irect(16.2 * s, 6.8 * s, 4.2 * s, 14.6 * s, { fill: C.accent, radius: 1.4 * s }),
      poly(P([[2.6, 21.9], [21.4, 21.9]]), { stroke: C.lineStrong, sw: 1.8 * s, close: false }),
    ];
  },

  /* 系统设置：齿轮（圆 + 8 根径向齿） */
  gear: (s, o) => {
    o = o || {};
    const c = o.color || C.brand, sw = 2 * s;
    const nodes = [
      icircle(4 * s, 4 * s, 16 * s, null, { stroke: c, sw }),
      icircle(9 * s, 9 * s, 6 * s, null, { stroke: c, sw }),
    ];
    for (let i = 0; i < 8; i++) {
      const a = (i * 45) * Math.PI / 180;
      nodes.push(poly([
        [12 * s + 7.6 * s * Math.cos(a), 12 * s + 7.6 * s * Math.sin(a)],
        [12 * s + 10.2 * s * Math.cos(a), 12 * s + 10.2 * s * Math.sin(a)],
      ], { stroke: c, sw: 2.2 * s, close: false }));
    }
    return nodes;
  },

  /* 消息通知：信封 */
  mail: (s, o) => {
    o = o || {};
    const c = o.color || C.brand, sw = 2 * s;
    const P = (a) => a.map((p) => [p[0] * s, p[1] * s]);
    return [
      irect(2.8 * s, 5 * s, 18.4 * s, 14 * s, { stroke: c, sw, radius: 2.4 * s }),
      poly(P([[4, 6.6], [12, 12.4], [20, 6.6]]), { stroke: c, sw, close: false }),
    ];
  },
};

/** 图标卡：白底圆角方块 + 居中 24 栅格图标。 */
function iconCard(name, s, size, o) {
  o = o || {};
  const card = frame('card·' + name, {
    dir: 'NONE', w: size, h: size,
    fill: o.fill != null ? o.fill : C.surface,
    radius: o.radius != null ? o.radius : 14,
    stroke: o.stroke != null ? o.stroke : C.line, sw: 1,
  });
  const tile = layer('tile·' + name, 24 * s, 24 * s);
  for (const n of ICON[name](s, o)) add(tile, n);
  add(card, tile);
  tile.x = (size - 24 * s) / 2;
  tile.y = (size - 24 * s) / 2;
  return card;
}

/* ===========================================================================
 * 插画原语（严格扁平：无渐变、无投影、无高光、无文字、无人物）
 * =========================================================================== */

/** 盾牌形。x,y = 图形包围盒左上角；实际宽 = 0.75size、高 ≈ 0.79size。 */
function shieldAt(size, x, y, o) {
  o = o || {};
  const u = size / 24;
  return poly([[12, 2], [21, 5.5], [21, 11.5], [19, 16], [15.5, 19.5], [12, 21],
    [8.5, 19.5], [5, 16], [3, 11.5], [3, 5.5]].map((p) => [x + (p[0] - 3) * u, y + (p[1] - 2) * u]),
  { fill: o.fill, stroke: o.stroke, sw: o.sw, name: 'shield' });
}

/**
 * 交通锥（施工现场安全）。cx = 中心线 x，by = 底面 y，w/h 为三角形宽高。
 * 反光带用梯形精确贴合三角形侧边 —— 矩形盖上去两侧一定会露错位。
 */
function cone(cx, by, w, h) {
  const g = [];
  g.push(poly([[cx, by - h], [cx + w / 2, by], [cx - w / 2, by]], { fill: C.warning, name: 'cone' }));
  for (const d of [[0.50, 0.62], [0.20, 0.32]]) {
    const hw1 = (w / 2) * (1 - d[0]), hw2 = (w / 2) * (1 - d[1]);
    g.push(poly([
      [cx - hw2, by - d[1] * h], [cx + hw2, by - d[1] * h],
      [cx + hw1, by - d[0] * h], [cx - hw1, by - d[0] * h],
    ], { fill: C.white, name: 'band' }));
  }
  g.push(irect(cx - w * 0.62, by, w * 1.24, 5, { fill: C.warning, radius: 2, name: 'base' }));
  return g;
}
