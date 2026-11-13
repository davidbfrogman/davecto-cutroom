/* A retro project: one folder per video.
     retro.json    which video, render size, and per-beat switches (on/off, moves, sound)
     words.json    transcript word timings (retro new / retro words --redo)
     faces.json    face boxes and scene cuts (retro faces)
     beats/NN-name/index.html   one bespoke HyperFrames composition per beat
     out/          overlays, sfx stem, the export, check frames, caches */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RETRO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const KIT = join(RETRO, 'kit'), BRAND = join(RETRO, 'brand');
const DATA = join(homedir(), 'Library', 'Application Support', 'Cutroom');
export const HF = join(DATA, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');
export const GSAP = join(DATA, 'node_modules', 'gsap', 'dist', 'gsap.min.js');
export const PYTHON = join(DATA, 'venv', 'bin', 'python');
export const playwright = () => createRequire(join(DATA, 'node_modules', 'x.js'))('playwright');
export const checkDeps = () => {
  const miss = [[HF, 'HyperFrames'], [GSAP, 'GSAP'], [PYTHON, 'the whisper venv']].filter(([p]) => !existsSync(p)).map(([, n]) => n);
  if (miss.length) throw new Error(`Missing ${miss.join(', ')} in ${DATA}. Run Cutroom's setup once (node setup.mjs in the Cutroom folder).`);
};

export const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
  if (r.status !== 0) throw new Error(`${basename(cmd)} failed:\n${(r.stderr || r.stdout || '').split('\n').slice(-25).join('\n')}`);
  return r.stdout;
};
export const duration = f => Number(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).trim());

/** Find the project folder: -p <dir>, else the nearest folder up from cwd with a retro.json. */
export function findProject(arg) {
  let d = resolve(arg || process.cwd());
  if (arg) { if (!existsSync(join(d, 'retro.json'))) throw new Error(`No retro.json in ${d}`); return d; }
  for (; ; d = dirname(d)) {
    if (existsSync(join(d, 'retro.json'))) return d;
    if (d === dirname(d)) throw new Error('Not in a retro project (no retro.json here or above). Use -p <dir> or `retro new <video>`.');
  }
}

export class Project {
  constructor(dir) {
    this.dir = dir;
    this.file = join(dir, 'retro.json');
    this.cfg = JSON.parse(readFileSync(this.file, 'utf8'));
    this.cfg.beats ||= {};
    for (const b of this.beatIds()) this.cfg.beats[b] ||= { on: true };
    this.out = join(dir, 'out');
    mkdirSync(this.out, { recursive: true });
  }
  save() { writeFileSync(this.file, JSON.stringify(this.cfg, null, 2) + '\n'); }
  get video() { return resolve(this.dir, this.cfg.video); }
  get size() { return (this.cfg.size || '1440x2560').split('x').map(Number); }
  beatIds() {
    const d = join(this.dir, 'beats');
    return existsSync(d) ? readdirSync(d).filter(b => existsSync(join(d, b, 'index.html'))).sort() : [];
  }
  /** Beat ids matching prefixes ("06", "06-framework"); all beats when none given. */
  match(prefixes = []) {
    const all = this.beatIds();
    if (!prefixes.length) return all;
    const hit = all.filter(b => prefixes.some(p => b.startsWith(p)));
    const miss = prefixes.filter(p => !all.some(b => b.startsWith(p)));
    if (miss.length) throw new Error(`No beat matches ${miss.join(', ')} (beats: ${all.join(' ')})`);
    return hit;
  }
  beat(id) { return (this.cfg.beats[id] ||= { on: true }); }
  on(id) { return this.beat(id).on !== false; }
  words() { const f = join(this.dir, 'words.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : []; }
  faces() { const f = join(this.dir, 'faces.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; }

  /** Write a beat's render folder (index.html with size + RETRO injected, kit, brand scripts, fonts).
      Returns { work, key }: key changes whenever anything that affects its pixels changes.
      live: for the preview, which applies moves itself (own folder, no moves baked in). */
  stage(id, [W, H] = this.size, { live = false } = {}) {
    const src = readFileSync(join(this.dir, 'beats', id, 'index.html'), 'utf8');
    const move = live ? {} : this.beat(id).move || {};
    const inject = { beat: id, words: this.words(), move };
    const kit = ['retro.css', 'retro.js', 'ships.js'].map(f => readFileSync(join(KIT, f), 'utf8'));
    const brandJs = ['retro-os.js', 'retro-os-critters.js', 'retro-os-starships.js'].map(f => readFileSync(join(BRAND, 'assets', 'js', f), 'utf8'));
    const key = createHash('sha1').update(src).update(kit.join('')).update(brandJs.join('')).update(JSON.stringify(inject)).update(`${W}x${H}`).digest('hex').slice(0, 12);
    const work = join(this.out, live ? '.live' : '.work', id);
    if (existsSync(join(work, '.key')) && readFileSync(join(work, '.key'), 'utf8') === key) return { work, key };
    rmSync(work, { recursive: true, force: true });
    mkdirSync(join(work, 'assets', 'fonts'), { recursive: true });
    let html = src
      .replace(/data-width="\d+"/g, `data-width="${W}"`).replace(/data-height="\d+"/g, `data-height="${H}"`)
      .replace(/(<meta name="viewport" content=")[^"]*"/, `$1width=${W}, height=${H}"`)
      .replace('</head>', `<style>:root{--cr-w:${W}px;--cr-h:${H}px}html,body{width:${W}px;height:${H}px}</style></head>`);
    const tag = `<script>window.RETRO=${JSON.stringify(inject).replace(/</g, '\\u003c')}</script>`;
    html = html.includes('<script src="retro.js"></script>') ? html.replace('<script src="retro.js"></script>', `${tag}\n  <script src="retro.js"></script>`) : html.replace('</head>', `${tag}</head>`);
    writeFileSync(join(work, 'index.html'), html);
    writeFileSync(join(work, 'retro.css'), kit[0]);
    writeFileSync(join(work, 'retro.js'), kit[1]);
    writeFileSync(join(work, 'ships.js'), brandJs.join('\n;\n') + '\n;\n' + kit[2]);
    cpSync(GSAP, join(work, 'gsap.min.js'));
    for (const f of ['vt323', 'inter-tight', 'jetbrains-mono']) cpSync(join(BRAND, 'assets', 'fonts', `${f}.woff2`), join(work, 'assets', 'fonts', `${f}.woff2`));
    writeFileSync(join(work, '.key'), key);
    return { work, key };
  }
  overlayDir([W, H] = this.size) {
    const [w0, h0] = this.size;
    return join(this.out, W === w0 && H === h0 ? 'overlays' : `overlays-${W}x${H}`);
  }
}

/** Create a project folder for a video. */
export function createProject(video, dir) {
  const v = resolve(video);
  if (!existsSync(v)) throw new Error(`No such video: ${v}`);
  dir = resolve(dir || join(dirname(v), `${basename(v, extname(v))}-retro`));
  if (existsSync(join(dir, 'retro.json'))) throw new Error(`${dir} already has a retro.json`);
  mkdirSync(join(dir, 'beats'), { recursive: true });
  const rel = v.startsWith(dir) ? v.slice(dir.length + 1) : relativePath(dir, v);
  writeFileSync(join(dir, 'retro.json'), JSON.stringify({ video: rel, size: '1440x2560', sfxGain: 0, beats: {} }, null, 2) + '\n');
  return dir;
}
function relativePath(from, to) {
  const a = from.split('/'), b = to.split('/');
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}
