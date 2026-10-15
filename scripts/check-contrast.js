// Verifies a palette against WCAG AA before it ships. Run: npm run contrast
//
// Checks every foreground token against the surfaces it actually renders on,
// in both themes. 4.5:1 for body text, 3:1 for large text and UI borders.

const hex = (h) => {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const lum = (h) => {
  const [r, g, b] = hex(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return +((l1 + 0.05) / (l2 + 0.05)).toFixed(2);
};

const THEMES = {
  light: {
    bg: '#F7F9FC',
    surface: '#FFFFFF',
    ink: '#0F172A',
    muted: '#475569',
    faint: '#5B6B80',
    rule: '#D6DEE8',
    fieldBorder: '#7C8BA0',
    accent: '#1E3A5F',
    accentSoft: '#EAF1F8',
    amber: '#8A5308',
    focus: '#1E3A5F',
  },
  dark: {
    bg: '#0B1220',
    surface: '#111B2E',
    ink: '#E9EEF6',
    muted: '#AFBDD0',
    faint: '#94A5BA',
    rule: '#24334C',
    fieldBorder: '#61748F',
    accent: '#8FBCEC',
    accentSoft: '#17253C',
    amber: '#E0AC55',
    focus: '#8FBCEC',
  },
};

// foreground -> which surfaces it is painted on, and the threshold it needs
const CHECKS = [
  ['ink', ['bg', 'surface'], 4.5],
  ['muted', ['bg', 'surface'], 4.5],
  ['faint', ['bg', 'surface'], 4.5],
  ['accent', ['bg', 'surface', 'accentSoft'], 4.5],
  ['amber', ['bg', 'surface'], 4.5],
  ['ink', ['accentSoft'], 4.5],
  // WCAG 1.4.11 applies to UI component boundaries and focus indicators.
  // Input borders are components, so they must clear 3:1.
  ['fieldBorder', ['bg', 'surface'], 3, 'ui'],
  ['focus', ['bg', 'surface'], 3, 'ui'],
  // --rule is a decorative hairline between rows, not a component boundary
  // and not needed to understand content, so 1.4.11 does not apply. It is
  // reported for information only.
  ['rule', ['surface'], 0, 'decorative'],
];

let failures = 0;

for (const [name, tokens] of Object.entries(THEMES)) {
  console.log(`\n${name.toUpperCase()}`);
  for (const [fg, surfaces, need, kind] of CHECKS) {
    for (const bgKey of surfaces) {
      const r = ratio(tokens[fg], tokens[bgKey]);
      const pass = r >= need;
      if (!pass) failures += 1;
      console.log(
        `  ${pass ? 'ok  ' : 'FAIL'} ${String(r).padStart(6)}  need ${need}  ` +
          `${fg} (${tokens[fg]}) on ${bgKey} (${tokens[bgKey]})${kind ? '  [non-text]' : ''}`,
      );
    }
  }
}

console.log(failures ? `\n${failures} failing pair(s).` : '\nAll pairs pass.');
if (failures) process.exitCode = 1;
