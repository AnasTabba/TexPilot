/** Measures WCAG 2.x contrast ratios for the Yarnflow UI color pairs and prints a table.
    Usage: node scripts/ui-contrast.mjs
    Evidence for the ui-finish report; not part of any runtime bundle. */
function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map(c => c + c).join('') : h;
  const channel = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(parseInt(full.slice(0, 2), 16)) + 0.7152 * channel(parseInt(full.slice(2, 4), 16)) + 0.0722 * channel(parseInt(full.slice(4, 6), 16));
}
function ratio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (l1 + 0.05) / (l2 + 0.05);
}
/** [foreground, background, where it appears, minimum — 4.5 for text, 3.0 for large text/ui parts] */
const pairs = [
  ['#1d1b19', '#fefbf3', 'ink text on panel — headings, quantities, values (text)', 4.5],
  ['#1d1b19', '#faf5e9', 'ink text on sheet — working shell text (text)', 4.5],
  ['#5f5851', '#fefbf3', 'muted ink-2 on panel — secondary text, table meta (text)', 4.5],
  ['#5f5851', '#faf5e9', 'muted ink-2 on sheet — sync bar and footnotes (text)', 4.5],
  ['#5f5851', '#f3ecdd', 'muted ink-2 on ground fields — help and notes (text)', 4.5],
  ['#6f675f', '#f3ecdd', 'ink-3 on ground — segmented unpressed labels (text)', 4.5],
  ['#746b62', '#fefbf3', 'placeholder on panel inputs (text)', 4.5],
  ['#7f4d00', '#f9eed3', 'warn text on warn tint — tags, banners (text)', 4.5],
  ['#a8201a', '#fbe9e1', 'bad text on bad tint — QC hold, errors (text)', 4.5],
  ['#1d6b3e', '#e7f1e3', 'ok text on ok tint — QC approved (text)', 4.5],
  ['#2f6fd6', '#fefbf3', 'focus ring and caret on panel (non-text indicators)', 3.0],
  ['#2f6fd6', '#faf5e9', 'focus ring and caret on sheet (non-text indicators)', 3.0],
  ['#ffffff', '#2f6fd6', 'scan seen-box badge label on focus blue (text)', 4.5],
  ['#b28356', '#fefbf3', 'kraft accent on panel — icons, thread, tassels (non-text UI)', 3.0],
  ['#1d1b19', '#b28356', 'ink nav-count text on kraft pill fill (text)', 4.5],
  ['#d8d2ca', '#1d1b19', 'rail nav labels on dark rail (text)', 4.5],
  ['#a39b91', '#1d1b19', 'rail muted captions on dark rail (text)', 4.5],
  ['#c4bcb2', '#1d1b19', 'rail-soft body text on dark rail (text)', 4.5],
  ['#c4bcb2', '#34302c', 'language inactive اردو on rail-line pill (text)', 4.5],
  ['#1d1b19', '#fefbf3', 'pressed EN text on panel fill — dark pill interior (text)', 4.5],
  ['#1d1b19', '#f6f0e2', 'ink on raised — hovered rows (text)', 4.5],
];
let failures = 0;
for (const [fg, bg, where, min] of pairs) {
  const r = ratio(fg, bg);
  const pass = r >= min;
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${r.toFixed(2)}:1  (min ${min}:1)  ${fg} on ${bg} — ${where}`);
}
console.log(failures ? `${failures} pair(s) below minimum — darken the tint before shipping` : 'All measured pairs meet their WCAG minimum');
process.exit(failures ? 1 : 0);
