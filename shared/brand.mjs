/*
  The brand: the user's colours and fonts, applied to everything Cutroom draws
  into the video (titles, lower thirds, captions, cards, and the HyperFrames
  animations). Stored flat on settings.brand, so a project carries its brand and
  "make this my default" can copy it to new projects.

    settings.brand    { name, role, plate, text, accent, display, body }
                      colours are #rrggbb or '' (the theme's own); fonts are font ids or ''
    settings.captions { font, size }   font: 'sans' (the body font), 'serif' (Instrument Serif) or a font id

  A font id is a bundled font ('fraunces') or one of the user's own files in
  ~/Movies/Cutroom/fonts ('user/Advercase-Regular.otf').

  Pure module: runs in Node and in the browser.
*/

export const BUNDLED_FONTS = [
  { id: 'fraunces', family: 'Fraunces', file: 'fraunces.woff2', label: 'Fraunces (soft serif)' },
  { id: 'instrument-serif', family: 'Instrument Serif', file: 'instrument-serif.woff2', label: 'Instrument Serif (condensed serif)', capScale: 1.4 },
  { id: 'inter', family: 'Inter', file: 'inter.woff2', label: 'Inter (sans)' },
  { id: 'inter-tight', family: 'Inter Tight', file: 'inter-tight.woff2', label: 'Inter Tight (tight sans)' },
  { id: 'jetbrains-mono', family: 'JetBrains Mono', file: 'jetbrains-mono.woff2', label: 'JetBrains Mono (mono)', capScale: 0.9 },
];

/** Each theme's own colours, used where the brand leaves one blank. */
export const THEME_COLORS = {
  dark: { plate: '#141310', text: '#f3f0e9', accent: '#3e8b82' },
  light: { plate: '#f7f5f0', text: '#181614', accent: '#0f766e' },
};

export const USER_FONT_RE = /\.(woff2?|otf|ttf)$/i;
const HEX = /^#[0-9a-f]{6}$/i;

/** { id, family, file, scope, url } for a font id, or null. */
export function fontRef(id) {
  if (!id || typeof id !== 'string') return null;
  const b = BUNDLED_FONTS.find(f => f.id === id);
  if (b) return { id, family: b.family, file: b.file, scope: 'bundled', url: `/assets/fonts/${b.file}`, capScale: b.capScale || 1 };
  const m = /^user\/([^/\\]+)$/.exec(id);
  if (!m || !USER_FONT_RE.test(m[1]) || m[1].startsWith('.')) return null;
  return { id, family: `CR ${m[1].replace(USER_FONT_RE, '').replace(/[^\w -]+/g, ' ')}`, file: m[1], scope: 'user', url: `/userfonts/${encodeURIComponent(m[1])}`, capScale: 1 };
}

/** A readable name for a font id. */
export function fontLabel(id) {
  const f = fontRef(id);
  if (!f) return '';
  return f.scope === 'bundled' ? BUNDLED_FONTS.find(b => b.id === id).label : f.file.replace(USER_FONT_RE, '').replace(/[-_]+/g, ' ');
}

const stack = (f, fallback) => (f ? `"${f.family}", ${fallback}` : null);
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'ui-sans-serif, system-ui, -apple-system, sans-serif';

/**
  The resolved brand for some settings: every colour filled in from the theme,
  font stacks, and the font files that have to be loaded.
*/
export function resolveBrand(s = {}) {
  const b = s.brand || {};
  const theme = s.theme === 'light' ? 'light' : 'dark';
  const base = THEME_COLORS[theme];
  const color = k => (HEX.test(b[k] || '') ? b[k].toLowerCase() : base[k]);
  const display = fontRef(b.display) || fontRef('fraunces');
  const body = fontRef(b.body) || fontRef('inter');
  const capId = s.captions?.font;
  const caption = capId === 'serif' ? fontRef('instrument-serif') : capId && capId !== 'sans' ? fontRef(capId) : null;
  const size = Math.min(1.6, Math.max(0.6, Number(s.captions?.size) || 1));
  const fonts = [display, body, caption].filter(Boolean).filter((f, i, a) => a.findIndex(x => x.id === f.id) === i);
  return {
    theme,
    colors: { plate: color('plate'), text: color('text'), accent: color('accent') },
    custom: { plate: HEX.test(b.plate || ''), text: HEX.test(b.text || ''), accent: HEX.test(b.accent || '') },
    display: stack(display, SERIF),
    body: stack(body, SANS),
    caption: caption ? { stack: stack(caption, SANS), scale: caption.capScale * size, serif: caption.id === 'instrument-serif' } : { stack: null, scale: size, serif: false },
    fonts,
  };
}

/** CSS custom properties for an animation (HyperFrames composition): --cr-plate, --cr-text, --cr-accent, --cr-display, --cr-body. */
export function brandVars(brand) {
  return {
    '--cr-plate': brand.colors.plate,
    '--cr-text': brand.colors.text,
    '--cr-accent': brand.colors.accent,
    '--cr-display': brand.display,
    '--cr-body': brand.body,
  };
}

/** @font-face rules for the brand's fonts, with urls from `urlOf(fontRef)`. */
export function fontFaces(brand, urlOf = f => f.url) {
  return brand.fonts.map(f => `@font-face{font-family:"${f.family}";src:url("${urlOf(f)}");font-weight:100 900;font-display:block}`).join('\n');
}

/** The part of settings that is "the brand", for saving as the user's default. */
export function pickBrand(s) {
  return {
    theme: s.theme,
    brand: { ...s.brand },
    captions: { style: s.captions?.style, font: s.captions?.font, size: s.captions?.size },
    lut: s.lut ? { ...s.lut } : undefined,
  };
}
