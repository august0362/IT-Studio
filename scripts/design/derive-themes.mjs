// Architect design tool (not app code): derives config/themes.json from the palettes in src/image/theme/.
// Usage: node scripts/design/derive-themes.mjs  (deterministic; re-run after editing THEME_META)
// Spec: docs/design/THEMES.md
import fs from 'node:fs';

const THEME_META = [
  { id: 'arctic-focus', name: 'Arctic Focus', source: 'ColdColor.png', palette: ['#e3f2fd', '#90caf9', '#2196f3', '#0d47a1'], native: 'light',
    mood: 'Calm, trustworthy, focused', psychology: 'Blue lowers arousal and is associated with trust and concentration; ideal default for long coding and reading sessions.', recommendedFor: ['coding', 'long sessions', 'default'] },
  { id: 'midnight-focus', name: 'Midnight Focus', source: 'DarkColdColor.png', palette: ['#091540', '#1b2cc1', '#7692ff', '#abd2fa'], native: 'dark',
    mood: 'Deep, quiet, concentrated', psychology: 'Deep navy keeps the calming effect of blue while cutting glare at night; periwinkle accents keep focus cues visible.', recommendedFor: ['night work', 'coding', 'default dark'] },
  { id: 'deep-forest', name: 'Deep Forest', source: 'DarkWinterColor.png', palette: ['#092328', '#12544f', '#2a835f', '#8bbb92'], native: 'dark',
    mood: 'Balanced, restful, grounded', psychology: 'Green is linked to balance and low visual fatigue; dark teal-green suits extended monitoring of long pipeline runs.', recommendedFor: ['night work', 'monitoring'] },
  { id: 'harbor', name: 'Harbor', source: 'Color Hunt Palette 3368a066a3bfc8dfdbf2efe7.png', palette: ['#3368a0', '#66a3bf', '#c8dfdb', '#f2efe7'], native: 'light',
    mood: 'Stable, professional, clear', psychology: 'Steel blue on warm sand reads as dependable and precise, well suited to financial review (Cost & P&L).', recommendedFor: ['finance', 'reporting'] },
  { id: 'royal-ink', name: 'Royal Ink', source: 'Color Hunt Palette 3e0f8d9564dde4da72eeeeee.png', palette: ['#3e0f8d', '#9564dd', '#e4da72', '#eeeeee'], native: 'light',
    mood: 'Imaginative, inspired, optimistic', psychology: 'Purple is associated with creativity and imagination; a yellow accent adds optimism. Good for ideation and image generation.', recommendedFor: ['ideation', 'image generation'] },
  { id: 'spring-grove', name: 'Spring Grove', source: 'Color Hunt Palette 499a13bbdc128eca3c276f27.png', palette: ['#499a13', '#bbdc12', '#8eca3c', '#276f27'], native: 'light',
    mood: 'Energetic, fresh, growth-oriented', psychology: 'Greens signal growth and progress; lime adds energy. Because green also means success, status colors are hue-shifted to avoid confusion.', recommendedFor: ['short sprints', 'daytime'] },
  { id: 'berry-dusk', name: 'Berry Dusk', source: 'Color Hunt Palette 601d49bd5579ea9d9dffebb8.png', palette: ['#601d49', '#bd5579', '#ea9d9d', '#ffebb8'], native: 'light',
    mood: 'Warm, expressive, empathetic', psychology: 'Plum and rose convey warmth and emotional depth; cream softens the intensity. Suited to writing and conversational chat.', recommendedFor: ['writing', 'chat'] },
  { id: 'espresso', name: 'Espresso', source: 'Color Hunt Palette e4e0e1d6c0b3ab886d493628.png', palette: ['#e4e0e1', '#d6c0b3', '#ab886d', '#493628'], native: 'light',
    mood: 'Reliable, cozy, grounded', psychology: 'Browns evoke reliability and comfort with low stimulation, reducing visual noise while reading documentation.', recommendedFor: ['reading', 'documentation'] },
  { id: 'blush-lavender', name: 'Blush Lavender', source: 'Color Hunt Palette fbefefffe2e2f5cbcbc5b3d3.png', palette: ['#fbefef', '#ffe2e2', '#f5cbcb', '#c5b3d3'], native: 'light',
    mood: 'Gentle, soothing, low-stress', psychology: 'Soft pinks and lavender are associated with calm and stress relief; text is darkened for legibility.', recommendedFor: ['relaxed browsing', 'chat'] },
  { id: 'vintage-dawn', name: 'Vintage Dawn', source: 'Color Hunt Palette fdf4d2b0cde6a290b7946d6d.png', palette: ['#fdf4d2', '#b0cde6', '#a290b7', '#946d6d'], native: 'light',
    mood: 'Nostalgic, relaxed, thoughtful', psychology: 'Cream with dusty blue and mauve feels unhurried and reflective, good for planning and reading specs.', recommendedFor: ['planning', 'specs'] },
  { id: 'sherbet', name: 'Sherbet', source: 'Color Hunt Palette ff9d9dffc5aaeef8cdbbf1d2.png', palette: ['#ff9d9d', '#ffc5aa', '#eef8cd', '#bbf1d2'], native: 'light',
    mood: 'Playful, friendly, upbeat', psychology: 'Coral warmth plus mint freshness lifts mood and approachability; best for casual chat and brainstorming.', recommendedFor: ['brainstorming', 'chat'] },
  { id: 'peach-cream', name: 'Peach Cream', source: 'Color Hunt Palette ffdcdcfff2ebffe8cdffd6ba.png', palette: ['#ffdcdc', '#fff2eb', '#ffe8cd', '#ffd6ba'], native: 'light',
    mood: 'Comforting, soft, welcoming', psychology: 'Peach tones are perceived as warm and approachable with low arousal; easy on the eyes in daylight.', recommendedFor: ['daytime', 'chat'] },
  { id: 'candy-floss', name: 'Candy Floss', source: 'Color Hunt Palette ffeeccffddccffccccfebbcc.png', palette: ['#ffeecc', '#ffddcc', '#ffcccc', '#febbcc'], native: 'light',
    mood: 'Sweet, light-hearted, warm', psychology: 'Warm pastel pinks feel gentle and cheerful; accents are deepened so interactive elements stay discoverable.', recommendedFor: ['casual use'] },
  { id: 'lemon-sky', name: 'Lemon Sky', source: 'Color Hunt Palette fff2c6fff8deaac4f58ca9ff.png', palette: ['#fff2c6', '#fff8de', '#aac4f5', '#8ca9ff'], native: 'light',
    mood: 'Optimistic yet focused', psychology: 'Soft yellow brings optimism and energy while periwinkle blue keeps focus, a balance for productive daytime work.', recommendedFor: ['daytime', 'productivity'] },
  { id: 'honey-sand', name: 'Honey Sand', source: 'Color Hunt Palette fff2d7ffe0b5f8c794d8ae7e.png', palette: ['#fff2d7', '#ffe0b5', '#f8c794', '#d8ae7e'], native: 'light',
    mood: 'Cheerful, warm, sunny', psychology: 'Golden sand tones read as warm and positive with little blue-light character, pleasant for evening use without full dark mode.', recommendedFor: ['evening', 'reading'] },
  { id: 'autumn-ember', name: 'Autumn Ember', source: 'FallColor.png', palette: ['#e2a16f', '#fff0dd', '#d1d3d4', '#86b0bd'], native: 'light',
    mood: 'Warm but composed', psychology: 'Ember orange adds warmth and enthusiasm, balanced by cool slate-teal for composure: energetic without being aggressive.', recommendedFor: ['general use'] },
  { id: 'summer-meadow', name: 'Summer Meadow', source: 'SummerColor.png', palette: ['#ffeed6', '#a5af79', '#827148', '#e8a07c'], native: 'light',
    mood: 'Natural, grounded, relaxed', psychology: 'Olive and terracotta are earthy and organic; they signal stability and ease, good for steady routine work.', recommendedFor: ['routine work'] },
  { id: 'winter-stone', name: 'Winter Stone', source: 'WinterColor.png', palette: ['#777c6d', '#b7b89f', '#cbcbcb', '#eeeeee'], native: 'light',
    mood: 'Neutral, minimal, distraction-free', psychology: 'Muted greys minimise emotional and visual stimulation and let content dominate: a focus-mode theme.', recommendedFor: ['focus mode', 'presentations'] },
];

// ---- color math: sRGB <-> OKLCH, WCAG 2.x contrast ----
const h2r = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const delin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055);
function rgb2oklch([r, g, b]) {
  [r, g, b] = [r, g, b].map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
function oklch2rgb([L, C, H]) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(delin);
}
const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
function toHex([L, C, H]) {
  let c = C;
  let rgb = oklch2rgb([L, c, H]);
  while (!inGamut(rgb) && c > 0) { c -= 0.002; rgb = oklch2rgb([L, Math.max(c, 0), H]); }
  return '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}
const lum = (hex) => { const [r, g, b] = h2r(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const lch = (hex) => rgb2oklch(h2r(hex));
/** Shift OKLCH lightness of `color` (dir -1 darker / +1 lighter) until contrast with `against` >= target. */
function ensure(color, against, target, dir) {
  let [L, C, H] = lch(color);
  let hex = toHex([L, C, H]);
  while (contrast(hex, against) < target && L > 0.02 && L < 0.99) { L += dir * 0.01; hex = toHex([L, C, H]); }
  return hex;
}
const hueDist = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

// ---- derivation (algorithm documented in docs/design/THEMES.md §3) ----
function derive(meta) {
  const cols = meta.palette.map((h) => ({ hex: h, lch: lch(h) }));
  const byChroma = [...cols].sort((a, b) => b.lch[1] - a.lch[1]);
  const brand = byChroma[0];
  const accent = byChroma.find((c) => c !== brand && hueDist(c.lch[2], brand.lch[2]) > 30 && c.lch[1] > 0.03) ?? byChroma[1];
  const darkest = [...cols].sort((a, b) => a.lch[0] - b.lch[0])[0];
  const lightest = [...cols].sort((a, b) => b.lch[0] - a.lch[0])[0];
  const bh = brand.lch[2];
  const bc = Math.max(brand.lch[1], 0.02);
  const neutralC = brand.lch[1] < 0.03 ? 0.006 : Math.min(0.02, bc * 0.18);

  const light = (() => {
    const bg = lightest.lch[0] >= 0.94 ? lightest.hex : toHex([0.975, neutralC, lightest.lch[2]]);
    const bgL = lch(bg)[0];
    const surface = toHex([Math.min(0.995, bgL + 0.015), neutralC * 0.6, lch(bg)[2]]);
    const surfaceAlt = toHex([bgL - 0.035, neutralC * 1.4, bh]);
    const border = toHex([0.86, neutralC * 1.5, bh]);
    const text = contrast(darkest.hex, bg) >= 7 && contrast(darkest.hex, surface) >= 7 && contrast(darkest.hex, surfaceAlt) >= 7
      ? darkest.hex
      : ensure(toHex([0.3, Math.min(0.06, bc * 0.5), darkest.lch[2]]), surfaceAlt, 7, -1);
    const textMuted = ensure(toHex([0.5, Math.min(0.04, bc * 0.35), bh]), surfaceAlt, 4.5, -1);
    const primary = ensure(brand.hex, '#ffffff', 4.5, -1);
    const accentC = ensure(accent.hex, bg, 3, -1);
    const [pL, pC, pH] = lch(primary);
    return { bg, surface, surfaceAlt, border, text, textMuted, primary, primaryFg: '#ffffff', primaryHover: toHex([pL - 0.05, pC, pH]), accent: accentC, focusRing: accentC };
  })();

  const dark = (() => {
    const baseH = darkest.lch[1] > 0.02 ? darkest.lch[2] : bh;
    const bg = darkest.lch[0] <= 0.26 ? darkest.hex : toHex([0.18, Math.min(0.035, bc * 0.3), baseH]);
    const bL = lch(bg)[0];
    const sc = Math.min(0.045, bc * 0.3);
    const surface = toHex([bL + 0.04, sc, baseH]);
    const surfaceAlt = toHex([bL + 0.08, sc, baseH]);
    const border = toHex([bL + 0.16, sc, baseH]);
    const text = ensure(toHex([0.95, 0.01, bh]), surfaceAlt, 7, 1);
    const textMuted = ensure(toHex([0.75, Math.min(0.03, bc * 0.3), bh]), surfaceAlt, 4.5, 1);
    const primary = ensure(brand.hex, surface, 4.5, 1);
    const primaryFg = contrast(bg, primary) >= 4.5 ? bg : '#0b0b0f';
    const accentC = ensure(accent.hex, bg, 3, 1);
    const [pL, pC, pH] = lch(primary);
    return { bg, surface, surfaceAlt, border, text, textMuted, primary, primaryFg, primaryHover: toHex([pL + 0.05, pC, pH]), accent: accentC, focusRing: accentC };
  })();

  // Status colors: conventional hues, shifted when within 25° of the brand hue (avoid "brand = success" confusion).
  const statusHue = {
    success: hueDist(bh, 145) < 25 ? 185 : 145,
    warning: hueDist(bh, 75) < 25 ? 50 : 75,
    danger: hueDist(bh, 25) < 25 ? 0 : 25,
    info: hueDist(bh, 250) < 25 ? 215 : 250,
  };
  const min = { 'text/bg': 7, 'text/surface': 7, 'text/surfaceAlt': 7, 'muted/surfaceAlt': 4.5, 'primaryFg/primary': 4.5, 'accent/bg': 3 };
  for (const [mode, t] of [['light', light], ['dark', dark]]) {
    for (const [k, h] of Object.entries(statusHue)) {
      t[k] = mode === 'light' ? ensure(toHex([0.55, 0.15, h]), t.surface, 4.5, -1) : ensure(toHex([0.75, 0.14, h]), t.surface, 4.5, 1);
    }
    const series = [t.primary, t.accent, ...cols.map((c) => ensure(c.hex, t.surface, 3, mode === 'light' ? -1 : 1))];
    t.chart = [...new Set(series)].slice(0, 6);
    const checks = {
      'text/bg': contrast(t.text, t.bg), 'text/surface': contrast(t.text, t.surface), 'text/surfaceAlt': contrast(t.text, t.surfaceAlt),
      'muted/surfaceAlt': contrast(t.textMuted, t.surfaceAlt), 'primaryFg/primary': contrast(t.primaryFg, t.primary), 'accent/bg': contrast(t.accent, t.bg),
    };
    for (const [k, v] of Object.entries(checks)) if (v < min[k] - 0.005) throw new Error(`${meta.id} ${mode} ${k}=${v.toFixed(2)} < ${min[k]}`);
    t.contrast = Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  }
  return {
    id: meta.id, name: meta.name, source: `src/image/theme/${meta.source}`, palette: meta.palette, nativeMode: meta.native,
    mood: meta.mood, psychology: meta.psychology, recommendedFor: meta.recommendedFor, light, dark,
  };
}

const themes = THEME_META.map(derive);
const out = { version: 1, generatedBy: 'scripts/design/derive-themes.mjs', defaultLight: 'arctic-focus', defaultDark: 'midnight-focus', themes };
fs.writeFileSync(new URL('../../config/themes.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
for (const t of themes) {
  console.log(t.id.padEnd(15), 'L', t.light.bg, t.light.text, t.light.primary, t.light.accent, '| D', t.dark.bg, t.dark.text, t.dark.primary, t.dark.accent);
}
