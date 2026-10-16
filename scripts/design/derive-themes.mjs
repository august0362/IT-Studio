// Architect design tool (not app code): derives config/themes.json from the palettes in src/image/theme/.
// Usage: node scripts/design/derive-themes.mjs  (deterministic; re-run after editing THEME_META)
// Design: docs/design/theme-system.md (UX-05); original palette reference: docs/design/THEMES.md
import fs from 'node:fs';

const THEME_META = [
  {
    id: 'arctic-focus',
    name: 'Arctic Focus',
    source: 'ColdColor.png',
    palette: ['#e3f2fd', '#90caf9', '#2196f3', '#0d47a1'],
    native: 'light',
    mood: 'Calm, trustworthy, focused',
    psychology:
      'Blue lowers arousal and is associated with trust and concentration; ideal default for long coding and reading sessions.',
    recommendedFor: ['coding', 'long sessions', 'default'],
  },
  {
    id: 'midnight-focus',
    name: 'Midnight Focus',
    source: 'DarkColdColor.png',
    palette: ['#091540', '#1b2cc1', '#7692ff', '#abd2fa'],
    native: 'dark',
    mood: 'Deep, quiet, concentrated',
    psychology:
      'Deep navy keeps the calming effect of blue while cutting glare at night; periwinkle accents keep focus cues visible.',
    recommendedFor: ['night work', 'coding', 'default dark'],
  },
  {
    id: 'deep-forest',
    name: 'Deep Forest',
    source: 'DarkWinterColor.png',
    palette: ['#092328', '#12544f', '#2a835f', '#8bbb92'],
    native: 'dark',
    mood: 'Balanced, restful, grounded',
    psychology:
      'Green is linked to balance and low visual fatigue; dark teal-green suits extended monitoring of long pipeline runs.',
    recommendedFor: ['night work', 'monitoring'],
  },
  {
    id: 'harbor',
    name: 'Harbor',
    source: 'Color Hunt Palette 3368a066a3bfc8dfdbf2efe7.png',
    palette: ['#3368a0', '#66a3bf', '#c8dfdb', '#f2efe7'],
    native: 'light',
    mood: 'Stable, professional, clear',
    psychology:
      'Steel blue on warm sand reads as dependable and precise, well suited to financial review (Cost & P&L).',
    recommendedFor: ['finance', 'reporting'],
  },
  {
    id: 'royal-ink',
    name: 'Royal Ink',
    source: 'Color Hunt Palette 3e0f8d9564dde4da72eeeeee.png',
    palette: ['#3e0f8d', '#9564dd', '#e4da72', '#eeeeee'],
    native: 'light',
    mood: 'Imaginative, inspired, optimistic',
    psychology:
      'Purple is associated with creativity and imagination; a yellow accent adds optimism. Good for ideation and image generation.',
    recommendedFor: ['ideation', 'image generation'],
  },
  {
    id: 'spring-grove',
    name: 'Spring Grove',
    source: 'Color Hunt Palette 499a13bbdc128eca3c276f27.png',
    palette: ['#499a13', '#bbdc12', '#8eca3c', '#276f27'],
    native: 'light',
    mood: 'Energetic, fresh, growth-oriented',
    psychology:
      'Greens signal growth and progress; lime adds energy. Because green also means success, status colors are hue-shifted to avoid confusion.',
    recommendedFor: ['short sprints', 'daytime'],
  },
  {
    id: 'berry-dusk',
    name: 'Berry Dusk',
    source: 'Color Hunt Palette 601d49bd5579ea9d9dffebb8.png',
    palette: ['#601d49', '#bd5579', '#ea9d9d', '#ffebb8'],
    native: 'light',
    mood: 'Warm, expressive, empathetic',
    psychology:
      'Plum and rose convey warmth and emotional depth; cream softens the intensity. Suited to writing and conversational chat.',
    recommendedFor: ['writing', 'chat'],
  },
  {
    id: 'espresso',
    name: 'Espresso',
    source: 'Color Hunt Palette e4e0e1d6c0b3ab886d493628.png',
    palette: ['#e4e0e1', '#d6c0b3', '#ab886d', '#493628'],
    native: 'light',
    mood: 'Reliable, cozy, grounded',
    psychology:
      'Browns evoke reliability and comfort with low stimulation, reducing visual noise while reading documentation.',
    recommendedFor: ['reading', 'documentation'],
  },
  {
    id: 'blush-lavender',
    name: 'Blush Lavender',
    source: 'Color Hunt Palette fbefefffe2e2f5cbcbc5b3d3.png',
    palette: ['#fbefef', '#ffe2e2', '#f5cbcb', '#c5b3d3'],
    native: 'light',
    mood: 'Gentle, soothing, low-stress',
    psychology: 'Soft pinks and lavender are associated with calm and stress relief; text is darkened for legibility.',
    recommendedFor: ['relaxed browsing', 'chat'],
  },
  {
    id: 'vintage-dawn',
    name: 'Vintage Dawn',
    source: 'Color Hunt Palette fdf4d2b0cde6a290b7946d6d.png',
    palette: ['#fdf4d2', '#b0cde6', '#a290b7', '#946d6d'],
    native: 'light',
    mood: 'Nostalgic, relaxed, thoughtful',
    psychology: 'Cream with dusty blue and mauve feels unhurried and reflective, good for planning and reading specs.',
    recommendedFor: ['planning', 'specs'],
  },
  {
    id: 'sherbet',
    name: 'Sherbet',
    source: 'Color Hunt Palette ff9d9dffc5aaeef8cdbbf1d2.png',
    palette: ['#ff9d9d', '#ffc5aa', '#eef8cd', '#bbf1d2'],
    native: 'light',
    mood: 'Playful, friendly, upbeat',
    psychology:
      'Coral warmth plus mint freshness lifts mood and approachability; best for casual chat and brainstorming.',
    recommendedFor: ['brainstorming', 'chat'],
  },
  {
    id: 'peach-cream',
    name: 'Peach Cream',
    source: 'Color Hunt Palette ffdcdcfff2ebffe8cdffd6ba.png',
    palette: ['#ffdcdc', '#fff2eb', '#ffe8cd', '#ffd6ba'],
    native: 'light',
    mood: 'Comforting, soft, welcoming',
    psychology: 'Peach tones are perceived as warm and approachable with low arousal; easy on the eyes in daylight.',
    recommendedFor: ['daytime', 'chat'],
  },
  {
    id: 'candy-floss',
    name: 'Candy Floss',
    source: 'Color Hunt Palette ffeeccffddccffccccfebbcc.png',
    palette: ['#ffeecc', '#ffddcc', '#ffcccc', '#febbcc'],
    native: 'light',
    mood: 'Sweet, light-hearted, warm',
    psychology:
      'Warm pastel pinks feel gentle and cheerful; accents are deepened so interactive elements stay discoverable.',
    recommendedFor: ['casual use'],
  },
  {
    id: 'lemon-sky',
    name: 'Lemon Sky',
    source: 'Color Hunt Palette fff2c6fff8deaac4f58ca9ff.png',
    palette: ['#fff2c6', '#fff8de', '#aac4f5', '#8ca9ff'],
    native: 'light',
    mood: 'Optimistic yet focused',
    psychology:
      'Soft yellow brings optimism and energy while periwinkle blue keeps focus, a balance for productive daytime work.',
    recommendedFor: ['daytime', 'productivity'],
  },
  {
    id: 'honey-sand',
    name: 'Honey Sand',
    source: 'Color Hunt Palette fff2d7ffe0b5f8c794d8ae7e.png',
    palette: ['#fff2d7', '#ffe0b5', '#f8c794', '#d8ae7e'],
    native: 'light',
    mood: 'Cheerful, warm, sunny',
    psychology:
      'Golden sand tones read as warm and positive with little blue-light character, pleasant for evening use without full dark mode.',
    recommendedFor: ['evening', 'reading'],
  },
  {
    id: 'autumn-ember',
    name: 'Autumn Ember',
    source: 'FallColor.png',
    palette: ['#e2a16f', '#fff0dd', '#d1d3d4', '#86b0bd'],
    native: 'light',
    mood: 'Warm but composed',
    psychology:
      'Ember orange adds warmth and enthusiasm, balanced by cool slate-teal for composure: energetic without being aggressive.',
    recommendedFor: ['general use'],
  },
  {
    id: 'summer-meadow',
    name: 'Summer Meadow',
    source: 'SummerColor.png',
    palette: ['#ffeed6', '#a5af79', '#827148', '#e8a07c'],
    native: 'light',
    mood: 'Natural, grounded, relaxed',
    psychology:
      'Olive and terracotta are earthy and organic; they signal stability and ease, good for steady routine work.',
    recommendedFor: ['routine work'],
  },
  {
    id: 'winter-stone',
    name: 'Winter Stone',
    source: 'WinterColor.png',
    palette: ['#777c6d', '#b7b89f', '#cbcbcb', '#eeeeee'],
    native: 'light',
    mood: 'Neutral, minimal, distraction-free',
    psychology: 'Muted greys minimise emotional and visual stimulation and let content dominate: a focus-mode theme.',
    recommendedFor: ['focus mode', 'presentations'],
  },
  {
    id: 'neon-gold',
    name: 'Neon Gold',
    source: 'NeonGold.png',
    palette: ['#12100d', '#f6c65b', '#ef9850', '#ffe7a5'],
    brand: '#f6c65b',
    native: 'dark',
    generatedPalette: true,
    mood: 'Warm, focused, quietly luminous',
    psychology:
      'Warm near-black surfaces reduce glare while restrained gold accents identify actions and large metrics. Amber adds warmth without turning the whole workspace into a warning signal.',
    recommendedFor: ['night work', 'finance', 'default dark'],
  },
  {
    id: 'neon-cyan',
    name: 'Neon Cyan',
    source: 'NeonCyan.png',
    palette: ['#0c1217', '#47d8ef', '#69a7ff', '#cbf4ff'],
    brand: '#47d8ef',
    native: 'dark',
    generatedPalette: true,
    mood: 'Clear, precise, composed',
    psychology:
      'Cool cyan focus cues distinguish interactive controls from quiet charcoal surfaces; blue secondary accents support clear navigation during coding and monitoring.',
    recommendedFor: ['coding', 'monitoring', 'night work'],
  },
  {
    id: 'neon-violet',
    name: 'Neon Violet',
    source: 'NeonViolet.png',
    palette: ['#12101b', '#bc92ff', '#906ee8', '#e7dcff'],
    brand: '#bc92ff',
    native: 'dark',
    generatedPalette: true,
    mood: 'Reflective, creative, calm',
    psychology:
      'Soft violet accents bring a creative mood to near-black surfaces, with restrained glow that keeps reading and ideation comfortable over long sessions.',
    recommendedFor: ['ideation', 'writing', 'night work'],
  },
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
  while (!inGamut(rgb) && c > 0) {
    c -= 0.002;
    rgb = oklch2rgb([L, Math.max(c, 0), H]);
  }
  return (
    '#' +
    rgb
      .map((v) =>
        Math.round(Math.min(1, Math.max(0, v)) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
const lum = (hex) => {
  const [r, g, b] = h2r(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const lch = (hex) => rgb2oklch(h2r(hex));
/** Shift OKLCH lightness of `color` (dir -1 darker / +1 lighter) until contrast with `against` >= target. */
function ensure(color, against, target, dir) {
  let [L, C, H] = lch(color);
  let hex = toHex([L, C, H]);
  while (contrast(hex, against) < target && L > 0.02 && L < 0.99) {
    L += dir * 0.01;
    hex = toHex([L, C, H]);
  }
  return hex;
}

// ---- derivation (algorithm documented in docs/design/THEMES.md §3) ----
function derive(meta) {
  const cols = meta.palette.map((hex) => ({ hex, lch: lch(hex) }));
  const brand = meta.brand ?? [...cols].sort((a, b) => b.lch[1] - a.lch[1])[0].hex;
  const [, chroma, hue] = lch(brand);
  const variants = {};
  for (const mode of ['light', 'dark']) {
    const dark = mode === 'dark';
    const direction = dark ? 1 : -1;
    // Near-neutral architecture; the palette's character lives in the accents.
    const tint = Math.min(0.012, chroma * 0.15);
    const bg = toHex([dark ? 0.19 : 0.97, tint, hue]);
    const surface = toHex([dark ? 0.235 : 0.995, tint * 0.6, hue]);
    const surfaceAlt = toHex([dark ? 0.28 : 0.94, tint, hue]);
    const against = surfaceAlt;
    const readable = (color, ratio = 4.6) => ensure(color, against, ratio, direction);
    const primaryFg = dark ? bg : '#ffffff';
    const primary = ensure(readable(brand), primaryFg, 4.6, direction);
    const border = readable(toHex([dark ? 0.59 : 0.62, tint, hue]), 3.1);
    const t = {
      bg,
      surface,
      surfaceAlt,
      border,
      text: readable(toHex([dark ? 0.95 : 0.24, tint, hue]), 7.1),
      textMuted: readable(toHex([dark ? 0.73 : 0.47, tint, hue])),
      primary,
      primaryFg,
      primaryHover: primary,
      accent: readable(toHex([dark ? 0.78 : 0.46, 0.12, (hue + 45) % 360])),
      focusRing: primary,
    };
    for (const [key, h] of Object.entries({ success: 165, warning: 75, danger: 25, info: 250 })) {
      t[key] = readable(toHex([dark ? 0.78 : 0.46, 0.14, h]));
    }
    t.chart = [
      ...new Set([
        t.primary,
        t.accent,
        ...[165, 75, 25, 250].map((h) => readable(toHex([dark ? 0.78 : 0.46, 0.12, h]), 3.1)),
      ]),
    ].slice(0, 6);
    if (meta.generatedPalette) {
      Object.assign(t, {
        glow: primary,
        surfaceGlass: surface,
        borderGlow: primary,
        gradientStart: bg,
        gradientEnd: surfaceAlt,
      });
    }
    const checks = {};
    for (const background of ['bg', 'surface', 'surfaceAlt']) {
      for (const foreground of [
        'text',
        'textMuted',
        'primary',
        'accent',
        'focusRing',
        'success',
        'warning',
        'danger',
        'info',
        'border',
      ]) {
        const ratio = contrast(t[foreground], t[background]);
        const minimum = foreground === 'text' ? 7 : foreground === 'border' ? 3 : 4.5;
        if (ratio < minimum) throw new Error(meta.id + ' ' + mode + ' ' + foreground + '/' + background + ': ' + ratio);
        checks[foreground + '/' + background] = Math.round(ratio * 100) / 100;
      }
    }
    // Every accent choice also serves as a solid button with this label color.
    for (const color of [t.primary, t.info, t.success, t.warning, t.accent]) {
      if (contrast(primaryFg, color) < 4.5) throw new Error(meta.id + ' accent label contrast');
    }
    t.contrast = checks;
    variants[mode] = t;
  }
  return {
    id: meta.id,
    name: meta.name,
    source: 'src/image/theme/' + meta.source,
    palette: meta.palette,
    nativeMode: meta.native,
    mood: meta.mood,
    psychology: meta.psychology,
    recommendedFor: meta.recommendedFor,
    ...variants,
  };
}

const themes = THEME_META.map(derive);
const out = {
  version: 1,
  generatedBy: 'scripts/design/derive-themes.mjs',
  defaultLight: 'arctic-focus',
  defaultDark: 'neon-gold',
  themes,
};
fs.writeFileSync(new URL('../../config/themes.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');

// Apply exactly the same catalog before React, including optional-token fallbacks.
const properties = [
  'bg',
  'surface',
  'surfaceAlt',
  'border',
  'text',
  'textMuted',
  'primary',
  'primaryFg',
  'primaryHover',
  'accent',
  'focusRing',
  'success',
  'warning',
  'danger',
  'info',
  'glow',
  'surfaceGlass',
  'borderGlow',
  'gradientStart',
  'gradientEnd',
];
const startupCatalog = themes.map((theme) => [
  theme.id,
  ...['light', 'dark'].map((mode) => {
    const tokens = theme[mode];
    const resolved = {
      ...tokens,
      glow: tokens.glow ?? tokens.primary,
      surfaceGlass: tokens.surfaceGlass ?? tokens.surface,
      borderGlow: tokens.borderGlow ?? tokens.border,
      gradientStart: tokens.gradientStart ?? tokens.bg,
      gradientEnd: tokens.gradientEnd ?? tokens.surfaceAlt,
    };
    return [...properties.map((key) => resolved[key]), tokens.chart.join(',')];
  }),
]);
const startup = `(function(){const properties=${JSON.stringify(properties)};const themes=${JSON.stringify(startupCatalog)};const defaults=${JSON.stringify({ light: out.defaultLight, dark: out.defaultDark })};let cached={};try{const value=JSON.parse(localStorage.getItem('itstudio.theme')||'{}');if(value&&typeof value==='object')cached=value}catch{}const mode=['system','light','dark'].includes(cached.mode)?cached.mode:'system';const active=mode==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):mode;const selected=themes.find(theme=>theme[0]===cached.themeId)||themes.find(theme=>theme[0]===defaults[active]);if(selected){const root=document.documentElement,tokens=selected[active==='dark'?2:1];properties.forEach((key,index)=>root.style.setProperty('--color-'+key.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase()),tokens[index]));tokens[properties.length].split(',').forEach((color,index)=>root.style.setProperty('--color-chart-'+(index+1),color));for(let index=tokens[properties.length].split(',').length;index<6;index++)root.style.removeProperty('--color-chart-'+(index+1));const density=['comfortable','compact'].includes(cached.density)?cached.density:'comfortable';const motion=['full','reduced','system'].includes(cached.motion)?cached.motion:'system';const fontScale=['small','default','large'].includes(cached.fontScale)?cached.fontScale:'default';root.dataset.density=density;root.dataset.motion=motion;root.dataset.fontScale=fontScale;root.style.setProperty('--ui-scale',({small:'0.9375',default:'1',large:'1.125'})[fontScale]);const accentKey=['ocean','grove','ember','alternate'].includes(cached.accent)?({ocean:'info',grove:'success',ember:'warning',alternate:'accent'})[cached.accent]:undefined;if(accentKey){const color=tokens[properties.indexOf(accentKey)];['primary','primaryHover','focusRing','glow','borderGlow'].forEach(key=>root.style.setProperty('--color-'+key.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase()),color))}root.style.colorScheme=active;root.dataset.theme=selected[0];root.dataset.mode=active}})();`;
const htmlPath = new URL('../../apps/desktop/index.html', import.meta.url);
const html = fs.readFileSync(htmlPath, 'utf8');
const generatedBlock =
  /    <!-- Generated from config\/themes\.json;[^\n]*-->\r?\n    <!-- prettier-ignore -->\r?\n    <script>[\s\S]*?<\/script>/;
if (!generatedBlock.test(html)) throw new Error('Startup theme block is missing from index.html');
fs.writeFileSync(
  htmlPath,
  html.replace(
    generatedBlock,
    `    <!-- Generated from config/themes.json; color map ${Buffer.byteLength(startup)} bytes. -->\n    <!-- prettier-ignore -->\n    <script>${startup}</script>`,
  ),
);
for (const t of themes) {
  console.log(
    t.id.padEnd(15),
    'L',
    t.light.bg,
    t.light.text,
    t.light.primary,
    t.light.accent,
    '| D',
    t.dark.bg,
    t.dark.text,
    t.dark.primary,
    t.dark.accent,
  );
}
