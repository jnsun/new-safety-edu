//!include ./_kit-fin.js

/* 财务应收 · A 区：50 封面
 * 放在本区最上方（y=0），后续画板用 yAfter('▣ 50') 自动接续。 */

await loadFonts();
await useFinPage();

const W = 1120;
const CW = W - 88;
const cleared = clearBoards(['▣ 50']);

/** 封面用整块深墨绿，不用 board() 的浅色标题条。 */
function a50Cover() {
  const f = col('▣ 50 · 封面', { w: W, gap: 0, fill: C.brandInk, padX: 88, padY: 60 });
  add(f, text('VISUAL SPECIFICATION  ·  v1', { size: 11, weight: 600, color: C.onInk3, ls: 1.8 }), 'H');
  add(f, box(1, 44), 'H');
  add(f, logoMark(128, { mono: '#FFFFFF' }), 'H');
  add(f, box(1, 40), 'H');
  add(f, text('企业应收账款台账系统', { size: 40, weight: 700, color: C.white }), 'H');
  add(f, box(1, 12), 'H');
  add(f, text('财务应收 · Web 管理后台视觉规范', { size: 16, weight: 400, color: C.onInk2 }), 'H');
  add(f, box(1, 30), 'H');
  const ln = tintBar(C.accent, 64, 2);
  ln.resize(64, 3);
  add(f, ln, 'H');
  add(f, box(1, 30), 'H');

  const rows = [
    ['色源', '公司 logo 主环青绿 #12A289 + 黄绿 / 蓝 / 橙 / 灰五色分片（实测取值）'],
    ['设计基准', '1440 × 900；侧栏 208 固定 + 顶栏 56 + 内容 1184'],
    ['画布位置', 'Figma「workbuddy设计」→ 第 2 个页面「财务应收 · 视觉规范」'],
    ['令牌规模', '36 个颜色变量 · 21 个数值变量 · 13 个文本样式 · 2 个效果样式'],
    ['适用范围', '财务应收账款管理模块 Web 后台（路由 /receivables/*），不改任何业务逻辑'],
  ];
  const infoBox = col('info', { gap: 0, w: CW - 176, radius: 14, fill: C.brandDeep, padX: 28, padY: 22 });
  rows.forEach(([k, v], i) => {
    const r = row('row', { gap: 24, w: CW - 232, cross: 'MIN', padY: 10 });
    add(r, text(k, { size: 12, weight: 600, color: C.accent, w: 80 }), null);
    add(r, text(v, { size: 12, weight: 400, color: C.onInk2, w: CW - 336, lh: 1.6 }), 'H');
    add(infoBox, r, 'H');
    if (i < rows.length - 1) {
      const l2 = tintBar(C.brandMid, CW - 232, 0);
      l2.resize(CW - 232, 1);
      add(infoBox, l2, 'H');
    }
  });
  add(f, infoBox, 'H');

  add(f, box(1, 26), 'H');
  const foot = row('foot', { gap: 10, w: CW - 176, cross: 'CENTER' });
  add(foot, dot(C.accent, 7));
  add(foot, text('外壳越安静，数字越响。', { size: 13, weight: 600, color: C.white }));
  add(foot, text('—— 本规范的一句话原则', { size: 11.5, weight: 400, color: C.onInk3 }));
  add(f, foot, 'H');
  return f;
}

const put = stackAt(0, 0, 200);
put(a50Cover());

return {
  分区: '财务应收 · A 区 · 50 封面',
  画板数: 1,
  清理旧画板: cleared,
  封面高: put.end(),
};
