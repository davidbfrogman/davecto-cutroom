/*
  Motion: HyperFrames compositions used as animated text, transitions and cards.

  Where they live
    <project>/motion/<name>/          one-offs written for a single video (usually by Claude)
    ~/Movies/Cutroom/motion/<name>/   the user's own library, reusable in every project
    <cutroom>/motion/<name>/          built-in, ship with Cutroom
  The first one found wins, in that order.

  A composition is a normal HyperFrames project (index.html with a GSAP timeline
  on window.__timelines). Cutroom adds three conventions:
    · size comes from Cutroom: author in %, vw/vh or var(--cr-w)/var(--cr-h);
      data-width/height and the viewport are rewritten for each render
    · background is transparent: it's composited over the video
    · <meta name="cutroom:kind" content="text | transition | card"> and, for
      transitions, <meta name="cutroom:cut" content="0.45"> (where in the clip the cut sits, 0..1)
    · <meta name="cutroom:blend" content="invert"> makes it a mask: wherever it draws, the
      picture below shows in negative (draw in white; only the alpha is used)
  Text and other inputs are HyperFrames variables (data-composition-variables),
  filled per use from the overlay's `vars`.

  The user's brand is injected into every render: --cr-plate, --cr-text,
  --cr-accent, --cr-display and --cr-body (shared/brand.mjs), plus @font-face
  rules for the fonts they name. Compositions use those instead of fixed colours.

  Renders are transparent VP9 WebM (the browser preview plays them directly,
  ffmpeg composites them with libvpx-vp9), cached by a hash of the
  composition's files, size, frame rate, variables and brand.
*/
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CUTROOM, FONTS, USER_FONTS, USER_MOTION, projectDir } from './paths.mjs';
import { run } from './proc.mjs';
import { probe } from './media.mjs';
import { gsapFile, hyperframes } from './deps.mjs';
import { BUNDLED_FONTS, fontFaces, brandVars, resolveBrand } from '../shared/brand.mjs';

export const LIBRARY = join(CUTROOM, 'motion');
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const validName = n => typeof n === 'string' && NAME_RE.test(n) && n !== '_template';

function attr(html, re) { const m = re.exec(html); return m ? m[1] : null; }

/** What a composition says about itself. */
export function describe(dir, name, scope) {
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  let variables = [];
  const raw = attr(html, /data-composition-variables='([^']*)'/) || attr(html, /data-composition-variables="([^"]*)"/);
  if (raw) { try { variables = JSON.parse(raw.replace(/&quot;/g, '"')); } catch { variables = []; } }
  const cutRaw = attr(html, /<meta\s+name="cutroom:cut"\s+content="([^"]*)"/);
  const cut = cutRaw == null ? NaN : Number(cutRaw);
  return {
    name, scope, dir,
    title: attr(html, /<title>([^<]*)<\/title>/) || name,
    description: attr(html, /<meta\s+name="description"\s+content="([^"]*)"/) || '',
    kind: attr(html, /<meta\s+name="cutroom:kind"\s+content="([^"]*)"/) || 'text',
    cut: Number.isFinite(cut) ? cut : 0.5,
    blend: attr(html, /<meta\s+name="cutroom:blend"\s+content="([^"]*)"/) === 'invert' ? 'invert' : 'normal',
    variables,
  };
}

/** Every composition a project can use: its own first, then the built-ins. */
export function listMotions(projectId) {
  const out = new Map();
  const scan = (root, scope) => {
    if (!existsSync(root)) return;
    for (const n of readdirSync(root).sort()) {
      if (!validName(n) || out.has(n) || !existsSync(join(root, n, 'index.html'))) continue;
      try { out.set(n, describe(join(root, n), n, scope)); } catch { /* unreadable: skip */ }
    }
  };
  if (projectId) scan(join(projectDir(projectId), 'motion'), 'project');
  scan(USER_MOTION, 'library');
  scan(LIBRARY, 'built-in');
  return [...out.values()];
}

export function motionDir(projectId, name) {
  if (!validName(name)) throw Object.assign(new Error(`Bad animation name "${name}" (use lowercase-with-dashes)`), { status: 400 });
  const local = projectId ? join(projectDir(projectId), 'motion', name) : null;
  if (local && existsSync(join(local, 'index.html'))) return local;
  for (const lib of [join(USER_MOTION, name), join(LIBRARY, name)]) if (existsSync(join(lib, 'index.html'))) return lib;
  throw Object.assign(new Error(`No animation called "${name}"`), { status: 404 });
}

/**
  Start a new composition from an existing one (or the blank template), in the
  project (default) or the user's library. Returns its description.
*/
export function createMotion(projectId, name, { from = '_template', scope = 'project' } = {}) {
  if (!validName(name)) throw Object.assign(new Error(`Bad animation name "${name}" (use lowercase-with-dashes)`), { status: 400 });
  const dest = scope === 'library' ? join(USER_MOTION, name) : join(projectDir(projectId), 'motion', name);
  if (existsSync(dest)) throw Object.assign(new Error(`"${name}" already exists at ${dest}`), { status: 409 });
  const src = from === '_template' ? join(LIBRARY, '_template') : motionDir(projectId, from);
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true, filter: p => !/[/\\](renders|\.hf-|node_modules)/.test(p) });
  writeFileSync(join(dest, 'meta.json'), JSON.stringify({ id: name, name }, null, 2) + '\n');
  return describe(dest, name, scope);
}

function filesOf(dir) {
  const out = [];
  const walk = d => {
    for (const f of readdirSync(d).sort()) {
      if (/^(renders|node_modules|\.hf-.*|\.debug)$/.test(f)) continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p); else out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Cache key: the composition's files plus everything about this use of it. */
export function motionKey(dir, { width, height, fps, vars, brand }) {
  const h = createHash('sha1');
  for (const f of filesOf(dir)) h.update(relative(dir, f)).update(readFileSync(f));
  const userFonts = (brand?.fonts || []).filter(f => f.scope === 'user').map(f => [f.file, existsSync(join(USER_FONTS, f.file)) ? statSync(join(USER_FONTS, f.file)).size : 0]);
  h.update(JSON.stringify({ width, height, fps, vars: vars || {}, brand: brand ? [brandVars(brand), userFonts] : null, v: 3 }));
  return h.digest('hex').slice(0, 16);
}

const fontUrl = f => `assets/fonts/${encodeURIComponent(f.file)}`;

/**
  Ready the composition for this render: root attributes, viewport, --cr-w/--cr-h,
  the user's brand (colours and fonts), and GSAP from disk instead of the CDN.
*/
export function resizeHtml(html, W, H, brand = resolveBrand({})) {
  const vars = Object.entries(brandVars(brand)).map(([k, v]) => `${k}:${v}`).join(';');
  const bundled = BUNDLED_FONTS.map(f => `@font-face{font-family:"${f.family}";src:url("assets/fonts/${f.file}");font-weight:100 900;font-display:block}`).join('\n');
  const custom = fontFaces({ fonts: brand.fonts.filter(f => f.scope === 'user') }, fontUrl);
  return html
    .replace(/(data-width=")\d+(")/g, `$1${W}$2`)
    .replace(/(data-height=")\d+(")/g, `$1${H}$2`)
    .replace(/(<meta\s+name="viewport"\s+content=")[^"]*(")/, `$1width=${W}, height=${H}$2`)
    .replace(/<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@[^"]*\/dist\/gsap\.min\.js"><\/script>/, m => (gsapFile() ? '<script src="gsap.min.js"></script>' : m))
    .replace(/<\/head>/i, `<style data-cutroom>${bundled}\n${custom}\n:root{--cr-w:${W}px;--cr-h:${H}px;${vars}}html,body{width:${W}px;height:${H}px}</style></head>`);
}

/** Copy a composition into a work folder with everything it needs to render offline. */
function prepare(src, work, { width, height, brand }) {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  cpSync(src, work, { recursive: true, filter: p => !/[/\\](renders|\.hf-|node_modules)/.test(p) });
  mkdirSync(join(work, 'assets', 'fonts'), { recursive: true });
  for (const f of BUNDLED_FONTS) cpSync(join(FONTS, f.file), join(work, 'assets', 'fonts', f.file));
  for (const f of brand.fonts) if (f.scope === 'user' && existsSync(join(USER_FONTS, f.file))) cpSync(join(USER_FONTS, f.file), join(work, 'assets', 'fonts', f.file));
  if (gsapFile()) cpSync(gsapFile(), join(work, 'gsap.min.js'));
  writeFileSync(join(work, 'index.html'), resizeHtml(readFileSync(join(work, 'index.html'), 'utf8'), width, height, brand));
}

/**
  Render one use of a composition. Returns { file, key, duration } with file a
  transparent WebM under <project>/cache/motion. Cached.
*/
export async function renderMotion(projectId, name, { width, height, fps = 30, vars = {}, brand = resolveBrand({}), signal, onLine } = {}) {
  const src = motionDir(projectId, name);
  const key = motionKey(src, { width, height, fps, vars, brand });
  const root = join(projectDir(projectId), 'cache', 'motion');
  const file = join(root, `${key}.webm`);
  const meta = join(root, `${key}.json`);
  const { blend } = describe(src, name);
  if (existsSync(file) && existsSync(meta)) return { file, key, blend, ...JSON.parse(readFileSync(meta, 'utf8')) };

  const work = join(root, 'work', key);
  prepare(src, work, { width, height, brand });

  const tmp = join(root, `${key}.part.webm`);
  const { stdout, stderr } = await run(...hyperframes(['render', work, '--format', 'webm', '-o', tmp, '--fps', String(fps), '--quality', 'high', '--variables', JSON.stringify(vars || {}), '--quiet']), { signal, onLine });
  if (!existsSync(tmp)) throw new Error(`HyperFrames didn't write a video.\n${(stderr || stdout).split('\n').slice(-12).join('\n')}`);
  renameSync(tmp, file);
  const info = await probe(file);
  const out = { duration: Math.round(info.duration * 1000) / 1000, width, height };
  writeFileSync(meta, JSON.stringify(out));
  rmSync(work, { recursive: true, force: true });
  return { file, key, blend, ...out };
}

/** HyperFrames lint on a composition (sized like the edit). Returns the report text. */
export async function lintMotion(projectId, name, { width = 1080, height = 1920, brand = resolveBrand({}) } = {}) {
  const src = motionDir(projectId, name);
  const work = join(projectDir(projectId), 'cache', 'motion', 'lint', name);
  prepare(src, work, { width, height, brand });
  try {
    const r = await run(...hyperframes(['lint', work]));
    return (r.stdout + r.stderr).trim();
  } catch (e) {
    return e.message;
  }
}
