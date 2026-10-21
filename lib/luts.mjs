/*
  3D LUTs (.cube): the built-in looks, technical conversions, and your own files.

  Built-ins are generated from code (deterministic, so nothing binary lives in
  git) and cached under $CUTROOM_HOME/cache/luts. Drop any standard .cube file
  into $CUTROOM_HOME/luts (~/Movies/Cutroom/luts) and it shows up in the picker.

  Looks:        paper (default), film, clean, ink
  Conversions:  apple-log (Apple Log → Rec.709), hlg (HLG → SDR), pq (PQ → SDR)
*/
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CACHE, USER_LUTS } from './paths.mjs';

const SIZE = 33;

/* ---------- .cube I/O ---------- */

export function parseCube(text) {
  let size = 0, min = [0, 0, 0], max = [1, 1, 1], title = '';
  const data = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const k = line.split(/\s+/);
    if (k[0] === 'TITLE') title = line.slice(5).trim().replace(/^"|"$/g, '');
    else if (k[0] === 'LUT_3D_SIZE') size = Number(k[1]);
    else if (k[0] === 'LUT_1D_SIZE') throw new Error('1D LUTs are not supported, use a 3D .cube');
    else if (k[0] === 'DOMAIN_MIN') min = k.slice(1, 4).map(Number);
    else if (k[0] === 'DOMAIN_MAX') max = k.slice(1, 4).map(Number);
    else if (/^[-\d.eE+]+$/.test(k[0]) && k.length >= 3) data.push(Number(k[0]), Number(k[1]), Number(k[2]));
  }
  if (!size || data.length !== size * size * size * 3) throw new Error(`Bad .cube: expected ${size}³ entries, got ${data.length / 3}`);
  return { title, size, min, max, data: Float32Array.from(data) };
}

export function writeCube(lut, title) {
  const rows = [`TITLE "${title || lut.title || 'Cutroom'}"`, `LUT_3D_SIZE ${lut.size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  const d = lut.data;
  for (let i = 0; i < d.length; i += 3) rows.push(`${d[i].toFixed(6)} ${d[i + 1].toFixed(6)} ${d[i + 2].toFixed(6)}`);
  return rows.join('\n') + '\n';
}

/** Build a LUT from a function (r, g, b) → [r, g, b] on the unit cube. R varies fastest. */
export function makeCube(fn, size = SIZE, title = '') {
  const data = new Float32Array(size * size * size * 3);
  let i = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const out = fn(r / (size - 1), g / (size - 1), b / (size - 1));
    data[i++] = clamp01(out[0]); data[i++] = clamp01(out[1]); data[i++] = clamp01(out[2]);
  }
  return { title, size, min: [0, 0, 0], max: [1, 1, 1], data };
}

/** Mix a LUT with identity: 0 = no change, 1 = full look. */
export function withIntensity(lut, k) {
  if (k >= 0.999) return lut;
  const n = lut.size, out = new Float32Array(lut.data.length);
  let i = 0;
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const id = [r / (n - 1), g / (n - 1), b / (n - 1)];
    for (let c = 0; c < 3; c++, i++) out[i] = id[c] + k * (lut.data[i] - id[c]);
  }
  return { ...lut, data: out };
}

/* ---------- Colour helpers ---------- */

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smooth = x => x * x * (3 - 2 * x);
const scurve = (x, k) => clamp01(x + k * (smooth(clamp01(x)) - x));
const sat = ([r, g, b], s) => { const y = luma(r, g, b); return [y + (r - y) * s, y + (g - y) * s, y + (b - y) * s]; };
/** Split-tone: tint shadows and highlights, weighted by luma. */
function tone([r, g, b], sh, hi) {
  const y = clamp01(luma(r, g, b));
  const ws = (1 - y) * (1 - y), wh = y * y;
  return [r + sh[0] * ws + hi[0] * wh, g + sh[1] * ws + hi[1] * wh, b + sh[2] * ws + hi[2] * wh];
}
const lift = ([r, g, b], l) => [l + r * (1 - l), l + g * (1 - l), l + b * (1 - l)];

/* BT.2020 → BT.709 primaries, linear light. */
const M2020_709 = [[1.6605, -0.5876, -0.0728], [-0.1246, 1.1329, -0.0083], [-0.0182, -0.1006, 1.1187]];
const mul = (m, v) => m.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const encode709 = x => Math.pow(clamp01(x), 1 / 2.4);
/** Extended Reinhard on luminance, hue preserved. x is relative to diffuse white. */
function tonemap(rgb, white) {
  const y = Math.max(1e-6, luma(...rgb));
  const t = (y * (1 + y / (white * white))) / (1 + y);
  return rgb.map(c => (c / y) * t);
}

/* ---------- Built-ins ---------- */

const LOOKS = {
  paper: {
    name: 'Paper',
    note: 'Warm, gentle contrast, soft blacks.',
    fn: (r, g, b) => {
      let c = [r, g, b].map(x => scurve(x, 0.28));
      c = tone(c, [-0.012, 0.004, 0.012], [0.03, 0.012, -0.022]);
      c = sat(c, 0.92);
      return lift(c, 0.018);
    },
  },
  film: {
    name: 'Film',
    note: 'Faded blacks, teal shadows, warm highlights.',
    fn: (r, g, b) => {
      let c = [r, g, b].map(x => scurve(x, 0.5));
      c = tone(c, [-0.03, 0.012, 0.035], [0.045, 0.016, -0.035]);
      c = sat(c, 0.88);
      return lift(c, 0.035).map(x => x * 0.975 + 0.005);
    },
  },
  clean: {
    name: 'Clean',
    note: 'Neutral with a little punch and colour.',
    fn: (r, g, b) => {
      let c = [r, g, b].map(x => scurve(x, 0.2));
      c = tone(c, [0, 0, 0.004], [0.008, 0.004, -0.006]);
      return sat(c, 1.08);
    },
  },
  ink: {
    name: 'Ink',
    note: 'Warm black and white.',
    fn: (r, g, b) => {
      const y = scurve(luma(r, g, b), 0.4);
      return lift([y * 1.015 + 0.006, y, y * 0.95], 0.02);
    },
  },
};

const CONVERSIONS = {
  'apple-log': {
    name: 'Apple Log → Rec.709',
    note: 'For iPhone footage shot in Apple Log. Apply before a look.',
    fn: (r, g, b) => {
      const R0 = -0.05641088, Rt = 0.01, c = 47.28711236, beta = 0.00964052, gamma = 0.08550479, delta = 0.69336945;
      const Pt = c * (Rt - R0) ** 2;
      const dec = P => (P >= Pt ? 2 ** ((P - delta) / gamma) - beta : P > 0 ? Math.sqrt(P / c) + R0 : R0);
      const lin = [r, g, b].map(dec).map(x => Math.max(0, x));
      const mapped = tonemap(mul(M2020_709, lin).map(x => Math.max(0, x * 1.15)), 8);
      return sat(mapped.map(encode709), 1.04);
    },
  },
  hlg: {
    name: 'HLG → SDR',
    note: 'iPhone HDR video (HLG) to standard range. Applied automatically.',
    fn: (r, g, b) => {
      const A = 0.17883277, B = 0.28466892, C = 0.55991073;
      const inv = x => (x <= 0.5 ? (x * x) / 3 : (Math.exp((x - C) / A) + B) / 12);
      const lin = [r, g, b].map(inv);
      const y = luma(...lin), ootf = Math.pow(Math.max(y, 1e-6), 0.2);
      const disp = lin.map(x => (x * ootf) / 0.2627);       // HLG 75% (diffuse white) ≈ 1.0
      return tonemap(mul(M2020_709, disp).map(x => Math.max(0, x)), 4.9).map(encode709);
    },
  },
  pq: {
    name: 'PQ → SDR',
    note: 'HDR10 / Dolby Vision (PQ) to standard range. Applied automatically.',
    fn: (r, g, b) => {
      const m1 = 0.1593017578125, m2 = 78.84375, c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875;
      const eotf = E => { const p = Math.pow(E, 1 / m2); return Math.pow(Math.max(p - c1, 0) / (c2 - c3 * p), 1 / m1) * 10000; };
      const disp = [r, g, b].map(x => eotf(x) / 203);
      return tonemap(mul(M2020_709, disp).map(x => Math.max(0, x)), 1000 / 203).map(encode709);
    },
  },
};

/* ---------- Library ---------- */

const userDirs = () => [USER_LUTS].filter(existsSync);

/** Every LUT the picker can offer. */
export function listLuts() {
  const out = [];
  for (const [id, l] of Object.entries(LOOKS)) out.push({ id, name: l.name, note: l.note, kind: 'look', builtin: true });
  for (const [id, l] of Object.entries(CONVERSIONS)) out.push({ id, name: l.name, note: l.note, kind: 'conversion', builtin: true });
  for (const dir of userDirs()) {
    for (const f of readdirSync(dir).filter(f => /\.cube$/i.test(f)).sort()) {
      out.push({ id: `user:${f}`, name: basename(f, '.cube').replace(/[_-]+/g, ' '), note: join(dir, f), kind: 'look', builtin: false });
    }
  }
  return out;
}

function sourceCube(id) {
  if (LOOKS[id]) return makeCube(LOOKS[id].fn, SIZE, LOOKS[id].name);
  if (CONVERSIONS[id]) return makeCube(CONVERSIONS[id].fn, SIZE, CONVERSIONS[id].name);
  if (id.startsWith('user:')) {
    const f = id.slice(5);
    if (f.includes('/') || f.includes('..')) throw new Error('Bad LUT id');
    for (const dir of userDirs()) if (existsSync(join(dir, f))) return parseCube(readFileSync(join(dir, f), 'utf8'));
  }
  throw new Error(`Unknown LUT: ${id}`);
}

/**
  Path to a ready-to-use .cube for ffmpeg's lut3d, at the given intensity.
  Returns null for no LUT. Cached by id and intensity.
*/
export function lutFile(id, intensity = 1) {
  if (!id || id === 'none' || intensity <= 0.001) return null;
  const k = Math.round(Math.min(1, intensity) * 100);
  const dir = join(CACHE, 'luts');
  mkdirSync(dir, { recursive: true });
  const safe = id.replace(/[^a-z0-9.-]+/gi, '_');
  const file = join(dir, `${safe}-${k}.cube`);
  if (!existsSync(file) || id.startsWith('user:')) {
    const lut = withIntensity(sourceCube(id), k / 100);
    writeFileSync(file, writeCube(lut, `${id} ${k}%`));
  }
  return file;
}

/** The conversion LUT a source needs before any look: HDR auto-detected, or set by hand. */
export function inputLutId(source, settings) {
  if (settings?.inputLut && settings.inputLut !== 'auto') return settings.inputLut === 'none' ? null : settings.inputLut;
  return source?.hdr || null;
}
