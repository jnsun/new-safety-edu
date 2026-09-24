/* 只读探针：打印 13 个 Fin/* 文本样式的**原始** lineHeight / 字重，
 * 用于核对是否落在 §3.2 字阶表给的像素行高上。
 * ⚠️ 上一版探针只打印了 lineHeight.unit，看不出 PERCENT 到底是 100%（=Auto）还是真实百分比，
 * 所以这里把原始对象整个打出来。 */

const all = await figma.getLocalTextStylesAsync();
const fin = all.filter((s) => s.name.startsWith('Fin/'));

const rows = fin.map((s) => ({
  name: s.name,
  size: s.fontSize,
  style: s.fontName && s.fontName.style,
  lineHeightRaw: JSON.stringify(s.lineHeight),
  letterSpacingRaw: JSON.stringify(s.letterSpacing),
  textCase: JSON.stringify(s.textCase),
}));

// 顺便统计非 Fin 的样式名，确认没漏建
const others = all.filter((s) => !s.name.startsWith('Fin/')).map((s) => s.name);

return { Fin样式数: fin.length, 明细: rows, 其它样式: others };
