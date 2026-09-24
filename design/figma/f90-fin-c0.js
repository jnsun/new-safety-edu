//!include ./_kit-fin-c.js

/* 财务应收 · C 区：70 登录页
 * 1440×900 真实尺寸。左侧深墨绿品牌区 + 右侧登录卡。
 * 登录页不套后台外壳（finShell），因为此时还没有权限上下文。 */

await loadFonts();
await useFinPage();

const W = FIN_W;               // 1440
const H = FIN_H;               // 900
const cleared = clearBoards(['▣ 70']);

/* ---------------------------- 画板 ---------------------------- */
function a70Login() {
  const g = row('▣ 70 · 登录页', { gap: 0, w: W, h: H, fill: C.surface, clips: true });

  /* ---- 左：品牌区 880 ---- */
  const left = col('brand', {
    w: 880, h: H, fill: C.brandInk, gap: 0,
    padX: 88, cross: 'MIN', main: 'CENTER',
  });

  const mark = col('mark', { gap: 26 });
  add(mark, logoMark(96, { mono: '#FFFFFF' }));
  const tt = col('tt', { gap: 14 });
  add(tt, text('企业应收账款台账系统', { size: 32, weight: 700, color: C.onInk, ls: 0.5 }));
  add(tt, text('财务资产部 · 内部系统', { size: 14, weight: 400, color: C.onInk2, ls: 0.5 }));
  // ⚠️ 不能传 'H' —— FILL 会把 84px 的短线拉满整个容器宽度（实测拉到了 500px）
  add(tt, row('line', { w: 84, h: 4, radius: 2, fill: C.accent }));
  add(tt, text('一行一合同。金额口径只有一套：决算 = 开票 + 账外应收。',
    { size: 13, weight: 400, color: C.onInk3, w: 460, lh: 1.7 }), 'H');
  add(mark, tt, 'H');
  add(left, mark, 'H');

  const foot = row('foot', { gap: 10, w: 704, cross: 'CENTER' });
  add(foot, text('仅限内部账号登录', { size: 11.5, weight: 400, color: C.onInk3 }), null);
  const sep = tintBar(C.brandMid, 1, 0); sep.resize(1, 12);
  add(foot, sep, null);
  add(foot, text('所有登录与变更均记录审计', { size: 11.5, weight: 400, color: C.onInk3 }), null);
  add(left, foot, 'H');

  // 底部左侧小字：靠 main=SPACE_BETWEEN 拉不精确，改用显式间距
  left.primaryAxisAlignItems = 'SPACE_BETWEEN';
  left.paddingTop = 120;
  left.paddingBottom = 64;
  add(g, left, 'V');

  /* ---- 右：登录卡 560 ---- */
  const right = col('form-zone', {
    w: W - 880, h: H, fill: C.canvas, cross: 'CENTER', main: 'CENTER',
  });

  const card = col('card', {
    gap: 22, w: 400, fill: C.surface, radius: 16,
    stroke: C.line, sw: 1, padX: 32, padY: 36,
    effects: [shadow(C.brandInk, 0.06, 0, 8, 24)],
  });

  const head = col('h', { gap: 6 });
  add(head, text('登录', { size: 22, weight: 600, color: C.ink }), 'H');
  add(head, text('权限由财务资产部按财务归属部门配置，登录后自动生效。',
    { size: 12, weight: 400, color: C.muted, w: 336, lh: 1.55 }), 'H');
  add(card, head, 'H');

  const fields = col('fields', { gap: 16, w: 336 });
  add(fields, finField('账号', '', 'normal', { w: 336, required: true, hint: '邮箱或手机号' }), 'H');
  add(fields, finField('密码', '••••••••', 'normal', { w: 336, required: true }), 'H');
  add(card, fields, 'H');

  const btn = finBtn('登 录', 'primary', { h: 40, size: 14, w: 336 });
  add(card, btn, 'H');

  const hr = tintBar(C.line, 336, 0); hr.resize(336, 1);
  add(card, hr, 'H');
  add(card, text('忘记密码请联系财务资产部管理员重置，系统不提供自助找回。',
    { size: 11, weight: 400, color: C.muted, w: 336, lh: 1.6 }), 'H');

  add(right, card, 'H');
  add(g, right, 'B');

  return g;
}

/* ------------------------------ 装配 ------------------------------ */
const put = stackAt(2720, 0, 240);
put(a70Login());

return {
  分区: '财务应收 · C 区 · 70 登录页',
  画板数: 1,
  清理旧画板: cleared,
  尺寸: W + 'x' + H,
  起点: 'x=2720 y=0',
  本区结束Y: put.end(),
};
