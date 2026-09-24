/* 离线验证：用 stub 模拟 Figma Plugin API，把 code.js 完整跑一遍。
   目的：在导入 Figma 之前抓出未定义变量、拼错的方法名、尺寸/色值异常。
   运行： node tools/figma-visual-system/verify.js                                */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const here = __dirname;
const code = fs.readFileSync(path.join(here, 'code.js'), 'utf8');
const ui = fs.readFileSync(path.join(here, 'ui.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
};

/* ------------------------------ Figma stub ------------------------------ */
class FakeNode {
  constructor(type) {
    this.type = type;
    this.children = [];
    this.parent = null;
    this.name = '';
    this.x = 0; this.y = 0; this.width = 0; this.height = 0;
    this.visible = true;
    this._data = {};
    this.fills = [];
    this.strokes = [];
  }
  appendChild(n) {
    if (n.parent) n.parent.children = n.parent.children.filter((c) => c !== n);
    n.parent = this;
    this.children.push(n);
    return n;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  resize(w, h) { this.width = w; this.height = h; }
  setPluginData(k, v) { this._data[k] = v; }
  getPluginData(k) { return this._data[k] || ''; }
  findAll() { return this.children.flatMap((c) => [c].concat(c.findAll ? c.findAll() : [])); }
}

const page = new FakeNode('PAGE');
page.name = 'Page 1';
const root = new FakeNode('DOCUMENT');
root.children = [page];

// 模拟真实 Figma 的字体可用情况：Windows 上 YaHei 只有 Regular / Bold，
// 而 PingFang SC / Noto Sans SC 在本机不存在 —— 用来验证降级探测逻辑。
const AVAILABLE_FONTS = {
  'Microsoft YaHei': ['Regular', 'Bold'],
  'Inter': ['Regular', 'Bold'],
};
const fontRequests = [];

const messages = [];
// 关键：真实 Figma 里 createXxx() 创建出来的节点会直接落在当前页面上，
// 之后 appendChild 到别的父级才会移动它。stub 必须复刻这个行为，否则顶层节点数为 0。
const attach = (node) => { node.parent = page; page.children.push(node); return node; };
const figma = {
  createFrame: () => attach(new FakeNode('FRAME')),
  createRectangle: () => attach(new FakeNode('RECTANGLE')),
  createText: () => attach(new FakeNode('TEXT')),
  createEllipse: () => attach(new FakeNode('ELLIPSE')),
  loadFontAsync: async (req) => {
    fontRequests.push(req.family + '/' + req.style);
    const styles = AVAILABLE_FONTS[req.family];
    if (!styles || !styles.includes(req.style)) throw new Error('The font "' + req.family + '" could not be loaded');
    return undefined;
  },
  showUI: () => undefined,
  currentPage: page,
  root,
  viewport: { scrollAndZoomIntoView: () => undefined },
  ui: { postMessage: (m) => messages.push(m), onmessage: null },
  mixed: Symbol('mixed'),
};

/* ------------------------------ 加载 code.js ------------------------------ */
console.log('\n[1] 语法与加载');
const sandbox = { figma, __html__: '<div></div>', console, Promise, Math, JSON, String, Array, Object, Number };
vm.createContext(sandbox);
try {
  vm.runInContext(code, sandbox, { filename: 'code.js' });
  ok(true, 'code.js 在 stub 环境中加载成功（等价于语法通过）');
} catch (e) {
  ok(false, 'code.js 加载失败', e.message);
  process.exit(1);
}

/* ------------------------------ 检查 ui.html ------------------------------ */
console.log('\n[2] ui.html');
const inline = ui.match(/<script>([\s\S]*?)<\/script>/);
ok(!!inline, '存在内联脚本');
try {
  vm.runInNewContext(inline[1], { parent: { postMessage: () => {} }, document: { getElementById: () => ({ addEventListener: () => {}, appendChild: () => {}, scrollTop: 0, innerHTML: '' }), querySelectorAll: () => [], createElement: () => ({ classList: {} }) }, onmessage: null, event: {} }, { filename: 'ui-inline.js' });
  ok(true, 'ui.html 内联脚本语法通过');
} catch (e) {
  ok(false, 'ui.html 内联脚本语法错误', e.message);
}

/* ------------------------------ 取回顶层常量 ------------------------------
   vm 里 const / let 不会挂到 context 全局对象上，只有 function 声明会。
   所以这里显式求值取回，而不是靠 sandbox.C。                                */
const API = vm.runInContext('({ C, FONT, MARK, buildAll, clearPrevious, resolveFont })', sandbox);

/* ------------------------------ 色值合法性 ------------------------------ */
console.log('\n[3] 色彩令牌');
const C = API.C;
ok(!!C, '令牌对象可访问');
const hexRe = /^#[0-9A-Fa-f]{6}$/;
const badHex = Object.keys(C).filter((k) => !hexRe.test(C[k]));
ok(badHex.length === 0, '所有色值都是 6 位 hex（' + Object.keys(C).length + ' 个）', badHex.join(', '));

// 对比度复算
const lum = (h) => {
  const s = h.slice(1);
  const f = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : Math.pow((c / 255 + 0.055) / 1.055, 2.4));
  return 0.2126 * f(parseInt(s.slice(0, 2), 16)) + 0.7152 * f(parseInt(s.slice(2, 4), 16)) + 0.0722 * f(parseInt(s.slice(4, 6), 16));
};
const cr = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
[
  ['主按钮 黄绿底+墨绿字', C.accent, C.brandInk, 4.5],
  ['正文墨色/白底', C.surface, C.ink, 4.5],
  ['说明文字/白底', C.surface, C.muted, 4.5],
  ['品牌文字档/白底', C.surface, C.brandText, 4.5],
  ['成功/白底', C.surface, C.success, 4.5],
  ['警示/白底', C.surface, C.warning, 4.5],
  ['危险/白底', C.surface, C.danger, 4.5],
  ['信息/白底', C.surface, C.info, 4.5],
  ['深底白字', C.brandInk, '#FFFFFF', 4.5],
].forEach(([label, bg, fg, min]) => {
  const v = cr(bg, fg);
  ok(v >= min, label + ' ' + v.toFixed(2) + ':1', '低于 ' + min);
});
const brandOnWhite = cr(C.surface, C.brand);
ok(brandOnWhite < 4.5, '青绿 #12A17D 在白底上确实不达标（' + brandOnWhite.toFixed(2) + ':1），规范里的降档规则成立');

/* ------------------------------ 实际渲染 ------------------------------ */
console.log('\n[4] 渲染全套画板');
let boardCount = 0;
(async () => {
  await API.resolveFont();
  const font = vm.runInContext('FONT', sandbox);
  ok(!!font && font.family === 'Microsoft YaHei', '字体降级探测正确：跳过不存在的 PingFang SC，落到 ' + (font && font.family));
  ok(font.bold === 'Bold', 'bold 档位探测正确：' + font.bold);
  ok(fontRequests.some((r) => r === 'PingFang SC/Regular'), '确实尝试过 PingFang SC 并失败（不是直接假定可用）');

  let total = 0;
  try {
    total = await API.buildAll('all');
    boardCount = total;
    ok(total > 20, '绘制出 ' + total + ' 个画板');
  } catch (e) {
    ok(false, 'buildAll 抛错', e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
    process.exit(1);
  }

  const boards = page.children;
  ok(boards.length === total, '页面顶层节点数（' + boards.length + '）与返回值（' + total + '）一致');

  const named = boards.filter((b) => /^\d{2}|^M\d|^W\d/.test(b.name));
  ok(named.length === boards.length, '所有画板都按编号命名', boards.filter((b) => !/^\d{2}|^M\d|^W\d/.test(b.name)).map((b) => b.name).join(', '));

  const sizes = (prefix, w, h) => boards.filter((b) => b.name.startsWith(prefix));
  const mp = sizes('M');
  ok(mp.length === 8, '小程序画板 8 个');
  ok(mp.every((b) => b.width === 375 && b.height === 812), '小程序画板尺寸均为 375×812',
    mp.filter((b) => b.width !== 375 || b.height !== 812).map((b) => b.name + ' ' + b.width + '×' + b.height).join(', '));
  const web = sizes('W');
  ok(web.length === 6, 'Web 后台画板 6 个');
  ok(web.every((b) => b.width === 1440 && b.height === 900), 'Web 画板尺寸均为 1440×900',
    web.filter((b) => b.width !== 1440 || b.height !== 900).map((b) => b.name + ' ' + b.width + '×' + b.height).join(', '));

  const all = page.findAll();
  const texts = all.filter((n) => n.type === 'TEXT');
  const empty = texts.filter((t) => !t.characters || t.characters === '');
  ok(texts.length > 300, '生成文本节点 ' + texts.length + ' 个');
  ok(empty.length === 0, '没有空文本节点', empty.length + ' 个空文本');

  const frames = all.filter((n) => n.type === 'FRAME');
  const gradFrames = frames.filter((f) => Array.isArray(f.fills) && f.fills.some((p) => p && p.type === 'GRADIENT_LINEAR'));
  ok(gradFrames.length === 2, '渐变只出现 2 处（规范硬规则：只保留两条渐变）', '实际 ' + gradFrames.length);

  const ellipses = all.filter((n) => n.type === 'ELLIPSE');
  ok(ellipses.length > 20, 'logo 圆环弧段 ' + ellipses.length + ' 个');
  const badArc = ellipses.filter((e) => !e.arcData || typeof e.arcData.innerRadius !== 'number');
  ok(badArc.length === 0, '所有弧段都带合法 arcData');

  /* ------------------------------ 幂等 ------------------------------ */
  console.log('\n[5] 幂等重跑');
  const cleared = API.clearPrevious();
  ok(cleared === total, '清理上一轮产物 ' + cleared + ' 个');
  ok(page.children.length === 0, '清理后页面为空');
  const again = await API.buildAll('all');
  ok(again === total, '重跑产出数量一致（' + again + '）');
  ok(page.children.length === total, '重跑后顶层节点数正确，没有翻倍');

  console.log('\n' + '='.repeat(56));
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('='.repeat(56) + '\n');
  process.exit(fail ? 1 : 0);
})();
