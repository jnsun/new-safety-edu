/* ===========================================================================
 * _kit-fin.js — 财务应收 Web 后台的**版式构件层**
 * =========================================================================== */

//!include ./_kit-core.js
//!include ./_kit-fin-palette.js

/* ---------------------------------------------------------------------------
 * 0. 页面守卫 —— 每个分区脚本开头必须调用
 *
 * ⚠️ figma.createFrame() 会把新节点挂到**当前页面**。若忘了切页，
 * 画板会落到 Page 1（安全生产那套）上，直接破坏已交付的 31 个画板。
 * 另外新版 API 已移除 `figma.currentPage = x` 的 setter，只能用异步版本。
 * ------------------------------------------------------------------------- */
async function useFinPage() {
  const target = '财务应收 · 视觉规范';
  let pg = null;
  for (const p of figma.root.children) if (p.name === target) pg = p;
  if (!pg) throw new Error('找不到页面「' + target + '」，请先执行 f70-fin-page.js');
  await figma.setCurrentPageAsync(pg);
  return pg;
}

/**
 * 接在某个已有画板下方。
 * 返回该画板（名字以 prefix 开头）底部 + gap；找不到则返回 0（从顶部开始）。
 * 用于把分区顺序做成「一个脚本一个画板」时仍能正确竖排 ——
 * 因为每个脚本都从 y=0 排会把画板叠在一起。
 */
function yAfter(prefix, gap) {
  let bottom = 0;
  for (const n of figma.currentPage.children) {
    if (n.name.indexOf(prefix) === 0) bottom = Math.max(bottom, n.y + n.height);
  }
  return bottom > 0 ? bottom + (gap != null ? gap : 200) : 0;
}

/* ---------------------------------------------------------------------------
 * 1. 后台外壳（§4.3 / §6.5）—— 深墨绿侧栏，选中项黄绿实底
 * ------------------------------------------------------------------------- */
function finShell(name, o) {
  o = o || {};
  const outer = row('▣ ' + name, { gap: 0, w: FIN_W, h: FIN_H, fill: C.canvas, clips: true });

  // ---- 侧栏 208px ----
  const side = col('侧栏', { w: FIN_SIDE, fill: C.brandInk, gap: 0, padX: 0, padY: 0 });
  const brandRow = row('品牌', { w: FIN_SIDE, h: 60, padX: 16, gap: 10, cross: 'CENTER' });
  add(brandRow, logoMark(26, { mono: '#FFFFFF' }));
  const bt = col('品牌字', { gap: 1 });
  add(bt, text('财务应收', { size: 13.5, weight: 700, color: C.onInk }));
  add(bt, text('账款管理', { size: 10, weight: 500, color: C.onInk3, ls: 0.5 }));
  add(brandRow, bt);
  add(side, brandRow, 'H');

  const menuWrap = col('菜单', { w: FIN_SIDE, gap: 2, padX: 12, padY: 12 });
  const active = o.active != null ? o.active : 0;
  FIN_MENU.forEach(([icon, label], i) => {
    const on = i === active;
    const it = row('menu·' + label, {
      w: FIN_SIDE - 24, h: 40, padX: 12, gap: 10, cross: 'CENTER', radius: 8,
      fill: on ? C.accent : null,
    });
    /* ⚠️ 图标必须包一层固定宽度的容器，文字必须给固定宽度 —— 两处都不能用 'H'(FILL)。
     * 实测：菜单项内宽 160px，若让文字 FILL，可用宽度会被图标挤到 70px 左右，
     * 6 个字的「应收账款看板」「财务归属部门」直接折成两行、第二行溢出到菜单项外。
     * 固定 18 + 10 + 132 = 160 是唯一稳定写法。 */
    const ic = row('ic', { w: 18, h: 18, cross: 'CENTER', main: 'CENTER' });
    add(ic, text(icon, { size: 13, weight: 500, color: on ? C.accentInk : C.onInk3 }));
    add(it, ic, null);
    add(it, text(label, { size: 13, weight: on ? 600 : 400, color: on ? C.accentInk : C.onInk2, w: 132 }), null);
    add(menuWrap, it, 'H');
  });
  add(side, menuWrap, 'H');
  add(side, flex(), 'H');

  const foot = row('侧栏脚', { w: FIN_SIDE, h: 56, padX: 16, gap: 10, cross: 'CENTER', fill: C.brandDeep });
  add(foot, dot(C.accent, 7));
  const fu = col('用户', { gap: 1 });
  add(fu, text(o.user || '张明 · 应收账款负责人', { size: 11.5, weight: 600, color: C.onInk }));
  add(fu, text('财务资产部', { size: 9.5, weight: 400, color: C.onInk3 }));
  add(foot, fu);
  add(side, foot, 'H');
  add(outer, side, 'V');

  // ---- 主区 ----
  const main = col('主区', { gap: 0, fill: C.canvas });
  add(outer, main, 'B');

  const top = row('顶栏', { h: FIN_TOP, padX: FIN_PADX, cross: 'CENTER', fill: C.surface, stroke: C.line, sw: 1 });
  add(top, text(o.crumb || '应收账款看板', { size: 15, weight: 600, color: C.ink }), 'H');
  add(top, flex());
  const srch = row('搜索', { w: 220, h: 32, padX: 11, gap: 7, cross: 'CENTER', radius: 8, fill: C.surfaceSoft, stroke: C.line, sw: 1 });
  add(srch, text('⌕', { size: 12.5, color: C.muted }));
  add(srch, text(o.searchPlaceholder || '搜索合同 / 项目 / 客户', { size: 12, color: C.muted }));
  add(top, srch);
  add(top, box(14, 1));
  add(top, dot(C.neutralSoft, 30), null);
  add(top, box(8, 1));
  add(top, text((o.user || '张明').split(' · ')[0], { size: 12.5, weight: 500, color: C.inkSoft }));
  add(main, top, 'H');

  const content = col('内容', { gap: 16, padX: FIN_PADX, padY: 20, fill: C.canvas });
  add(main, content, 'B');
  return { outer, side, main, top, content, name };
}

/* ---------------------------------------------------------------------------
 * 2. 页头 / 区块 / 面板
 * ------------------------------------------------------------------------- */
/** 单行省略。Figma 没有 CSS 的 text-overflow，等价物就是这两个属性。 */
function clip1(node) {
  node.textTruncation = 'ENDING';
  node.maxLines = 1;
  return node;
}

/**
 * 页头。
 * ⚠️ 副行（desc + meta 并排）必须显式算宽度并截断，不能靠自动布局自己收：
 * Figma 不会压缩超出容器的文本，两个 hug 文本并排一旦超过容器宽度就直接**溢出**——
 * 实测 72 板溢出 64px、75 板 28px，文字压到了右侧按钮下面。
 * 做法：先量出动作区宽度，把左栏宽度定死，再让 desc 吃掉 meta 之外的剩余宽度并单行省略。
 */
function finPageHead(title, desc, meta, actions) {
  const r = row('页头', { gap: 16, w: FIN_CW, cross: 'CENTER' });
  const hasActs = !!(actions && actions.length);
  const ra = hasActs ? row('页头动作', { gap: 10, cross: 'CENTER' }) : null;
  if (hasActs) for (const a of actions) add(ra, a);
  // 三个子节点 → 两个 16 的间距 + 至少 1px 的 flex 占位，都要扣掉。
  const lw = hasActs ? FIN_CW - ra.width - 33 : FIN_CW;

  const l = col('页头左', { gap: 5, w: lw });
  add(l, clip1(text(title, { size: 20, weight: 600, color: C.ink })), 'H');
  if (desc || meta) {
    const sub = row('副', { gap: 10, w: lw, cross: 'CENTER' });
    // meta 只建一次：先拿它的宽度算 desc 的剩余宽度，再把它本身挂上去，避免留下游离节点。
    const mt = meta ? text(meta, { size: 12, weight: 400, color: C.muted }) : null;
    if (desc) {
      const remain = lw - (mt ? mt.width + 10 : 0);
      add(sub, clip1(text(desc, { size: 12.5, weight: 400, color: C.muted, w: Math.max(60, remain) })), null);
    }
    if (mt) add(sub, mt, null);
    add(l, sub, 'H');
  }
  add(r, l, null);
  if (hasActs) {
    add(r, flex(), null);
    add(r, ra, null);
  }
  return r;
}

function finSection(title, right, o) {
  o = o || {};
  const r = row('sec', { gap: 12, w: o.w != null ? o.w : FIN_CW, cross: 'CENTER' });
  add(r, text(title, { size: 14, weight: 600, color: C.ink }), 'H');
  if (right) { add(r, flex(), null); add(r, right); }
  return r;
}

function finPanel(o) {
  o = o || {};
  return col(o.name || 'panel', {
    gap: o.gap != null ? o.gap : 14,
    w: o.w != null ? o.w : FIN_CW,
    fill: o.fill || C.surface,
    radius: 14,
    stroke: o.stroke !== undefined ? o.stroke : C.line,
    sw: 1,
    padX: o.padX != null ? o.padX : 20,
    padY: o.padY != null ? o.padY : 18,
  });
}

/* ---------------------------------------------------------------------------
 * 3. 表格（§5.2）
 * ------------------------------------------------------------------------- */
const TD = (defs) => defs.reduce((a, d) => a + d.w, 0);

/** 金额文本（右对齐。空值渲染为 —，绝不渲染成 0）。 */
function moneyCell(value, o) {
  o = o || {};
  const empty = value == null || value === '';
  return text(empty ? '—' : String(value), {
    size: o.size != null ? o.size : 13,
    weight: o.weight != null ? o.weight : 400,
    color: empty ? C.lineStrong : (o.color || C.ink),
    w: o.w,
    align: 'RIGHT',
  });
}

/** 状态：色点 + 文字（§5.6 硬约束——不许只用颜色表达状态）。 */
function statusDot(label, kind, o) {
  o = o || {};
  const map = {
    ok: [C.success, C.success], warn: [C.warning, C.warningText],
    bad: [C.danger, C.danger], info: [C.info, C.info],
    mute: [C.neutral, C.muted], brand: [C.brand, C.brandText],
  };
  const [dc, tc] = map[kind] || map.mute;
  const r = row('st', { gap: 6, cross: 'CENTER' });
  add(r, dot(dc, 6));
  add(r, text(label, { size: o.size != null ? o.size : 12, weight: 500, color: tc }));
  return r;
}

/** 浅底圆角标签（带色点）。§6.2：高 22、圆角 6、内边距 0 8、字号 12/500。 */
function finTag(label, kind, o) {
  o = o || {};
  const map = {
    ok: [C.successSoft, C.success], warn: [C.warningSoft, C.warningText],
    bad: [C.dangerSoft, C.danger], info: [C.infoSoft, C.info],
    mute: [C.neutralSoft, C.muted], brand: [C.brandSoft, C.brandText],
  };
  const [bg, fg] = map[kind] || map.mute;
  const r = row('tag', {
    gap: 5, cross: 'CENTER', radius: 6, fill: bg,
    padX: o.padX != null ? o.padX : 8, padY: o.padY != null ? o.padY : 3,
  });
  if (o.dot !== false) add(r, dot(fg, 5));
  add(r, text(label, { size: o.size != null ? o.size : 12, weight: 500, color: fg }));
  return r;
}

/** 财务输入框（§6.4）。控件高 32 —— core 的 field 是 42，那是移动端尺寸。
 *  state: normal / focus / error / disabled
 *  o.money: 金额输入框 → 右对齐 + 右侧内嵌单位「万元」 */
function finField(label, value, state, o) {
  o = o || {};
  const w = o.w != null ? o.w : 260;
  const spec = {
    normal: { fill: C.surface, stroke: C.lineStrong, color: C.ink, sw: 1 },
    focus: { fill: C.surface, stroke: C.brand, color: C.ink, sw: 1, glow: true },
    error: { fill: C.surface, stroke: C.danger, color: C.ink, sw: 1 },
    disabled: { fill: C.canvas, stroke: C.line, color: C.muted, sw: 1 },
  }[state || 'normal'];

  const c = col('field', { gap: 6, w });
  const lab = row('lab', { gap: 3, cross: 'CENTER' });
  if (o.required) add(lab, text('*', { size: 12, weight: 600, color: C.warning }), null);
  add(lab, text(label, { size: 12, weight: 500, color: state === 'disabled' ? C.muted : C.inkSoft }), null);
  add(c, lab, 'H');

  const inp = row('input', {
    w, h: 32, padX: 11, gap: 6, cross: 'CENTER', radius: 8,
    fill: spec.fill, stroke: spec.stroke, sw: spec.sw,
    // 聚焦外发光：Figma 没有 CSS 的 box-shadow，用 spread 外扩的 DROP_SHADOW 等价实现
    effects: spec.glow ? [shadow(C.brand, 0.14, 0, 0, 0, 3)] : undefined,
  });
  const txt = text(value, {
    size: 12.5, weight: 400, color: spec.color,
    align: o.money ? 'RIGHT' : 'LEFT',
  });
  add(inp, txt, 'H');
  if (o.unit) add(inp, text(o.unit, { size: 11.5, weight: 500, color: C.muted }), null);
  add(c, inp, 'H');

  if (state === 'error') add(c, text(o.hint || '必填项', { size: 11, weight: 400, color: C.danger, w }), 'H');
  else if (o.hint) add(c, text(o.hint, { size: 11, weight: 400, color: C.muted, w }), 'H');
  return c;
}

/** 只给某一边画线。frame() 的 o.stroke 会画满四边，冻结尾只要右边一条。
 *  第 5 参 opacity 用于「淡晕」层（冻结列的投影靠两层拼出来，见 finTable）。 */
function edgeLine(node, side, color, w, opacity) {
  const wt = w != null ? w : 1;
  node.strokes = [solid(color, opacity)];
  node.strokeAlign = 'INSIDE';
  node.strokeTopWeight = side === 'TOP' ? wt : 0;
  node.strokeBottomWeight = side === 'BOTTOM' ? wt : 0;
  node.strokeLeftWeight = side === 'LEFT' ? wt : 0;
  node.strokeRightWeight = side === 'RIGHT' ? wt : 0;
  return node;
}

/**
 * 财务大表格。
 * defs: [{ title, w, align?:'LEFT'|'CENTER'|'RIGHT', freeze?:true（该列右侧加冻结分隔线）,
 *          lines?:1|2（文本列单行省略 / 最多 2 行，默认 1） }]
 * rows: 二维数组；单元格可为 字符串 / 数字 / 节点 / null（渲染为 —）
 * o: { markRows?:[行索引] 行首橙条(异常), dimRows?:[行索引] 整行次要色+删除线(作废),
 *      rowH?:number 行高（默认 36，紧凑模式传 32） }
 */
function finTable(defs, rows, o) {
  o = o || {};
  const total = TD(defs);
  const t = col('table', { gap: 0, w: total, radius: 12, stroke: C.line, sw: 1, clips: true, fill: C.surface });
  // ⚠️ 必须 OUTSIDE：INSIDE 时 Figma 会从自动布局内容区扣掉描边宽度，
  // 列宽按设计值拼出来就右越界 2px，最后一列的右边框被 clips 裁掉。
  t.strokeAlign = 'OUTSIDE';

  /**
   * §5.2 文本列截断：单行省略 / 最多 2 行。
   * Figma 没有 CSS 的 text-overflow，等价物是 textTruncation='ENDING' + maxLines。
   * ⚠️ 不设这两项的话，宽过列宽的文本（例如 112px 列里的 HT-2026-0041）会**折成两行**，
   * 把 36px 行高撑破、行与行对不齐 —— 这才是表格看起来「错位」的真实原因。
   * 前提是 textAutoResize='HEIGHT'（text() 给了 w 就是 HEIGHT）。
   */
  function fit(node, lines) {
    node.textTruncation = 'ENDING';
    node.maxLines = lines != null ? lines : 1;
    return node;
  }

  const hd = row('thead', { w: total, gap: 0, fill: C.surfaceSoft, h: 40, cross: 'CENTER' });
  defs.forEach((d, ci) => {
    const cell = row('th', { w: d.w, padX: 12, cross: 'CENTER', gap: 4, h: 40 });
    add(cell, text(d.title, { size: 12, weight: 500, color: C.muted, w: d.w - 24, align: d.align || 'LEFT' }), 'H');
    if (d.freeze) edgeLine(cell, 'RIGHT', C.lineStrong);
    if (ci > 0 && defs[ci - 1].freeze) edgeLine(cell, 'LEFT', C.brandInk, 2, 0.05);
    add(hd, cell);
  });
  add(t, hd, 'H');

  const ROWH = o.rowH != null ? o.rowH : 36;
  rows.forEach((r, i) => {
    const marked = (o.markRows || []).indexOf(i) >= 0;
    const dim = (o.dimRows || []).indexOf(i) >= 0;
    const tr = row('tr', {
      w: total, gap: 0, cross: 'CENTER', h: ROWH,
      // §5.2：作废行整行 neutral/soft 底 + muted 字 + 删除线（不用斑马纹）
      fill: dim ? C.neutralSoft : C.surface,
    });
    defs.forEach((d, ci) => {
      const cell = row('td', { w: d.w, padX: 12, cross: 'CENTER', gap: 6, h: ROWH });
      const v = r[ci];
      if (v == null || v === '') {
        add(cell, fit(text('—', { size: 13, color: C.lineStrong, w: d.w - 24, align: d.align || 'LEFT' }), d.lines), 'H');
      } else if (typeof v === 'string' || typeof v === 'number') {
        const node = fit(text(String(v), {
          size: 13, weight: 400, color: dim ? C.muted : C.ink,
          w: d.w - 24, lh: 1.5, align: d.align || 'LEFT',
        }), d.lines);
        if (dim) node.textDecoration = 'STRIKETHROUGH';
        add(cell, node, 'H');
      } else {
        add(cell, v, null);
      }
      if (d.freeze) edgeLine(cell, 'RIGHT', C.lineStrong);
      // 冻结列右侧的投影：设计上是 1px 实线 + 3px 渐隐阴影。auto-layout 里塞不进
      // 绝对定位的渐隐条（子节点会被自动排列），所以改为给「冻结列的下一个单元格」
      // 描左边 2px 的 5% 墨绿 —— 视觉上就是那道淡晕，且描边不占布局尺寸。
      if (ci > 0 && defs[ci - 1].freeze) edgeLine(cell, 'LEFT', C.brandInk, 2, 0.05);
      // 异常行：首列左侧 3px 橙条。
      // 不要用 insertChild 插 3px 色块 —— 那会把该行单元格整体右推 3px 与表头错位；
      // 给首列描左边不改变任何布局尺寸。
      if (marked && ci === 0) edgeLine(cell, 'LEFT', C.warning, 3);
      add(tr, cell);
    });
    add(t, tr, 'H');
    if (i < rows.length - 1) {
      const ln = tintBar(C.line, total, 0);
      ln.resize(total, 1);
      add(t, ln, 'H');
    }
  });
  return t;
}

/** 表格工具栏（记录数 + 单位说明 + 紧凑列宽按钮）。w 同样必须显式传（板宽 1032）。 */
function finTableToolbar(count, tail, w) {
  const W0 = w != null ? w : FIN_CW;
  const r = row('tbar', { gap: 10, w: W0, cross: 'CENTER' });
  add(r, text(String(count), { size: 14, weight: 700, color: C.ink }));
  add(r, text('条记录', { size: 12.5, color: C.muted }));
  add(r, flex(), null);
  add(r, text('项目、客户和催收内容最多显示 2 行', { size: 11.5, color: C.muted }));
  add(r, box(8, 1));
  add(r, text('金额单位：万元', { size: 11.5, weight: 600, color: C.inkSoft }));
  if (tail) { add(r, box(8, 1)); add(r, tail); }
  return r;
}

/**
 * 深色汇总条（§5.3）。items: [[标签, 值]]，第一项为「当前筛选范围」的合同数。
 * note 必须说明「不是当前页求和」—— 财务算错账就出在这种歧义上。
 * ⚠️ 规范板宽 1120（内容 1032），而 FIN_CW 是 1184 —— 一律显式传 w，否则溢出。
 */
function finSummary(items, note, w) {
  const W0 = w != null ? w : FIN_CW;
  const c = col('汇总', { gap: 6, w: W0, fill: C.brandInk, radius: 12, padX: 20, padY: 16 });
  const r = row('行', { gap: 0, w: W0 - 40, cross: 'MIN' });
  const first = col('首', { gap: 4 });
  add(first, text(items[0][0], { size: 11.5, weight: 500, color: C.onInk3 }), 'H');
  add(first, text(items[0][1], { size: 20, weight: 700, color: C.accent }), 'H');
  add(r, first, 'H');
  for (let i = 1; i < items.length; i++) {
    add(r, flex(), null);
    const cell = col('c', { gap: 4 });
    add(cell, text(items[i][0], { size: 11.5, weight: 500, color: C.onInk3 }), 'H');
    add(cell, text(items[i][1], { size: 20, weight: 700, color: C.onInk }), 'H');
    add(r, cell, null);
  }
  add(c, r, 'H');
  add(c, text(note, { size: 11, weight: 400, color: C.onInk2, w: W0 - 40, lh: 1.5 }), 'H');
  return c;
}

/* ---------------------------------------------------------------------------
 * 4. 看板构件（§5.4 / §5.5）
 * ------------------------------------------------------------------------- */
/** KPI 卡。tone: 'brand' | 'warn' | 'bad' | 'ok' | 'dark' */
function finKpi(label, value, sub, tone, o) {
  o = o || {};
  const dark = tone === 'dark';
  const vc = dark ? C.accent
    : ({ brand: C.brandText, warn: C.warningText, bad: C.danger, ok: C.success }[tone] || C.ink);
  /* 高度默认 **HUG**（按内容自适应），只有调用方明确要强制等高时才传 o.h。
   * ⚠️ 千万别写死一个「看着差不多」的常量：卡片一旦定高，内容超高就会**掉到卡外**，
   * 而副行是浅色字（onInk2 #B9E8DE），落到白底上几乎看不见，肉眼极易漏掉 ——
   * 实测给 96 时副行正好溢出 12px，只有跑溢出探针才抓得出来。
   * 一排 KPI 卡只要形态一致（都有副行），HUG 出来的高度天然相等。 */
  const c = col('kpi', {
    gap: 7, fill: dark ? C.brandInk : C.surface, radius: 14,
    stroke: dark ? null : C.line, sw: 1,
    padX: 20, padY: 20, w: o.w != null ? o.w : null, h: o.h != null ? o.h : null,
  });
  const top = row('top', { gap: 8, cross: 'CENTER' });
  /* ⚠️ 标签行里**不要**再放 flex() 占位块。
   * 标签是 'H'（FILL）、flex 是 layoutGrow=1 —— 两者都「抢剩余空间」，Figma 按比例对半分：
   * 246 宽的卡里标签只拿到 94px，「台账数量（条合同）」需要 104px → 被挤成两行（实测）。
   * 正确做法：标签自己 FILL 吃掉全部剩余空间，色点靠右自然就贴边了。 */
  add(top, clip1(text(label, { size: 11.5, weight: 500, color: dark ? C.onInk3 : C.muted })), 'H');
  if (o.mark !== false) add(top, dot(dark ? C.accent : (tone === 'brand' ? C.brand : (vc === C.ink ? C.muted : vc)), 6));
  add(c, top, 'H');
  const v = row('v', { gap: 6, cross: 'MIN' });
  /* ⚠️ 数值字号必须跟 Fin/Metric 对齐（30px/700）—— 之前默认 28 与画布自己的字阶表打架。 */
  add(v, text(String(value), { size: o.vs != null ? o.vs : 30, weight: 700, color: vc }), null);
  if (o.unit) add(v, text(o.unit, { size: 11.5, weight: 500, color: dark ? C.onInk3 : C.muted, lh: 2.0 }), null);
  add(c, v, 'H');
  /* 副行必须单行省略：卡片高度是定值，副行一旦折成两行就会纵向溢出。 */
  if (sub) add(c, clip1(text(sub, { size: 11, weight: 400, color: dark ? C.onInk2 : C.muted, w: (o.w != null ? o.w : 260) - 40, lh: 1.45 })), 'H');
  return c;
}

/** 水平余额条（部门 / 客户 / 债权状态分布）。 */
function finBarRow(label, pct, amount, count, o) {
  o = o || {};
  const w = o.w != null ? o.w : 380;
  const r = col('bar', { gap: 5, w });
  const head = row('h', { gap: 8, w, cross: 'CENTER' });
  add(head, text(label, { size: 12.5, weight: 500, color: C.ink, w: w - 150 }), 'H');
  add(head, flex(), null);
  add(head, text(amount, { size: 12.5, weight: 700, color: C.ink }), 'H');
  if (count != null) add(head, text(String(count) + ' 笔', { size: 10.5, color: C.muted }), null);
  add(r, head, 'H');
  add(r, progress(Math.max(0.02, pct), { w, h: 6, color: o.color || C.brand }), 'H');
  return r;
}

/** 月度开票／回款双柱图。data: [[月,'开票','回款']]
 *  ⚠️ 回款柱默认用 info 蓝，**不是** accent 黄绿。
 *  WCAG 1.4.11 要求非文本图形对底色的对比度 ≥ 3:1；黄绿 #BFE81E 对白只有 1.42:1，
 *  画在白底图表里等于看不见。黄绿只在深色底（侧栏选中态、汇总条主数字）上出现。 */
function finColumns(data, o) {
  o = o || {};
  const w = o.w != null ? o.w : 460;
  const h = o.h != null ? o.h : 150;
  const max = Math.max(1, ...data.flatMap((d) => [Number(d[1]) || 0, Number(d[2]) || 0]));
  const c = col('chart', { gap: 8, w });
  const legend = row('lg', { gap: 14, cross: 'CENTER' });
  for (const [label, color] of [['开票', C.brand], ['回款', o.receiptColor || C.info]]) {
    const g = row('lgi', { gap: 6, cross: 'CENTER' });
    add(g, dot(color, 8));
    add(g, text(label, { size: 11.5, weight: 500, color: C.muted }));
    add(legend, g, null);
  }
  add(c, legend, 'H');
  const plotH = h - 22;
  const plot = row('plot', { gap: 0, w, h, cross: 'MAX', main: 'SPACE_BETWEEN' });
  const colW = w / data.length;
  for (const d of data) {
    const grp = col('col', { gap: 6, w: colW, cross: 'CENTER', main: 'MAX' });
    const bars = row('bars', { gap: 3, cross: 'MAX', main: 'CENTER', h: plotH });
    for (const [val, color] of [[Number(d[1]) || 0, C.brand], [Number(d[2]) || 0, o.receiptColor || C.info]]) {
      const bh = Math.max(2, Math.round((val / max) * plotH));
      const bx = col('b', { w: 13, h: bh, fill: color, radius: 3, main: 'MAX' });
      add(bars, bx, null);
    }
    add(grp, bars, null);
    add(grp, text(d[0], { size: 10.5, color: C.muted }), 'H');
    add(plot, grp, null);
  }
  add(c, plot, 'H');
  return c;
}

/** 环形占比图。segs: [[标签, 占比, 色值]]；o.center: [[文本, 字号, 字重, 色值]] */
function finDonut(size, segs, o) {
  o = o || {};
  const g = frame('donut', { dir: 'NONE', w: size, h: size });
  g.fills = [];
  g.strokes = [];
  const rIn = size * 0.31;
  let acc = 0;
  for (const [label, pct, color] of segs) {
    const a1 = acc * 360 + 1.2;
    const a2 = (acc + pct) * 360 - 1.2;
    acc += pct;
    if (a2 > a1) add(g, ringSegVector(size, size / 2, rIn, a1, a2, color, 'seg-' + label));
  }
  if (o.center) {
    const cc = col('c', { gap: 2, cross: 'CENTER', main: 'CENTER', w: size, h: size });
    cc.x = 0; cc.y = 0;
    for (const [t, sz, wt, cl] of o.center) {
      const node = text(t, { size: sz, weight: wt, color: cl, align: 'CENTER' });
      add(cc, node, 'H');
    }
    add(g, cc);
  }
  return g;
}

/* ---------------------------------------------------------------------------
 * 5. 胶囊筛选器（§6.3）—— 选中态为墨绿实底，与安全平台的青绿浅底不同
 * ------------------------------------------------------------------------- */
function finChip(label, on, o) {
  o = o || {};
  const c = row('chip·' + label, {
    h: o.h != null ? o.h : 28,
    padX: o.padX != null ? o.padX : 12,
    gap: 6, cross: 'CENTER',
    radius: 999,
    fill: on ? C.brandInk : C.surface,
    stroke: on ? null : C.lineStrong,
    sw: 1,
  });
  add(c, text(label, {
    size: o.size != null ? o.size : 13,
    weight: on ? 600 : 400,
    color: on ? C.white : C.inkSoft,
  }));
  return c;
}
/* 高 28 是固定值、不靠 padY 撑 —— 字号一改高度就跑，而筛选条是横向对齐的一排。 */

/** 财务按钮（§6.1）。高 32（表内 28），内边距 0 14，圆角 8，字号 13/500。
 *  ⚠️ 不复用 core 的 btn()：它的变体色是安全生产那套（danger 用浅红实底、
 *  secondary 用青绿字），与财务规范不一致。这里按 §6.1 的表重新定义。 */
function finBtn(label, variant, o) {
  o = o || {};
  const spec = {
    primary: { fill: C.accent, color: C.accentInk, stroke: null },
    'primary-dark': { fill: C.brandInk, color: C.white, stroke: null },
    secondary: { fill: C.surface, color: C.ink, stroke: C.lineStrong },
    ghost: { fill: null, color: C.brandText, stroke: null },
    danger: { fill: C.surface, color: C.danger, stroke: C.danger, strokeOpacity: 0.3 },
  }[variant] || {};
  const b = row('btn·' + label, {
    h: o.h != null ? o.h : 32,
    padX: o.padX != null ? o.padX : 14,
    gap: 6, cross: 'CENTER', main: 'CENTER',
    radius: 8,
    // 允许逐项覆盖 —— B 区的「交互四态」矩阵靠它把同一个变体换成悬停/按下/禁用的色
    fill: o.fill !== undefined ? o.fill : spec.fill,
    fillOpacity: o.fillOpacity,
    stroke: o.stroke !== undefined ? o.stroke : spec.stroke,
    strokeOpacity: o.strokeOpacity !== undefined ? o.strokeOpacity : spec.strokeOpacity,
    sw: (o.stroke !== undefined ? o.stroke : spec.stroke) ? 1 : 0,
    effects: o.effects,
  });
  add(b, text(label, {
    size: o.size != null ? o.size : 13,
    weight: o.weight != null ? o.weight : 500,
    color: o.color || spec.color,
    opacity: o.inkOpacity,
  }));
  return b;
}

/** 筛选条：胶囊分组 + 右侧搜索。groups: [[[label,on],…],…] */
function finFilterBar(groups, searchPlaceholder, o) {
  o = o || {};
  const bar = row('filter', { gap: 12, w: FIN_CW, cross: 'CENTER' });
  for (const g of groups) {
    const grp = row('grp', { gap: 6, cross: 'CENTER' });
    for (const [label, on] of g) add(grp, finChip(label, on), null);
    add(bar, grp, null);
  }
  add(bar, flex(), null);
  if (searchPlaceholder) {
    const srch = row('srch', {
      w: o.searchW != null ? o.searchW : 200, h: 32, padX: 11, gap: 7,
      cross: 'CENTER', radius: 8, fill: C.surface, stroke: C.line, sw: 1,
    });
    add(srch, text('⌕', { size: 12.5, color: C.muted }));
    add(srch, text(searchPlaceholder, { size: 12, color: C.muted }), 'H');
    add(bar, srch, null);
  }
  return bar;
}

/** 已生效筛选回显（§6.3 财务额外要求）——22 列的表必须一眼看出被筛掉了什么。 */
function finActiveFilters(labels, o) {
  o = o || {};
  const r = row('active', { gap: 8, w: o.w != null ? o.w : FIN_CW, cross: 'CENTER' });
  add(r, text('已生效筛选', { size: 11.5, color: C.muted }));
  for (const l of labels) {
    add(r, chip(l, { fill: C.brandSoft, color: C.brandText, size: 11, padX: 9, padY: 4, weight: 500 }), null);
  }
  add(r, flex(), null);
  add(r, text('恢复默认筛选', { size: 11.5, weight: 500, color: C.brandText }));
  return r;
}

/* finBtn 见上方「胶囊筛选器」之后 —— 财务版按钮按 §6.1 自行定义，不复用 core 的 btn()。 */

/** 提示条（※ 开头，放硬约束与说明）。 */
function finNote(str, kind, w) {
  const warn = kind === 'warn';
  const r = row('note', {
    gap: 10, cross: 'MIN', w: w != null ? w : FIN_CW,
    fill: warn ? C.warningSoft : C.brandSoft, radius: 10, padX: 14, padY: 12,
  });
  add(r, text('※', { size: 12, weight: 700, color: warn ? C.warningText : C.brandText }), null);
  add(r, text(str, { size: 11.5, weight: 500, color: warn ? C.warningText : C.brandText, lh: 1.65 }), 'H');
  return r;
}

