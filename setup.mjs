#!/usr/bin/env node
/*
  Cutroom setup: everything after Homebrew (setup.sh does that part).

    node setup.mjs                   check ffmpeg; install npm packages, Python (faster-whisper,
                                     yt-dlp) and the browsers that draw graphics and animations
    node setup.mjs --check           only report what's missing (exit 1 if anything is)
    node setup.mjs --with-whisper    also install openai-whisper (PyTorch, ~2 GB)
    node setup.mjs --model small.en  download a transcription model now instead of on first import

  Installs into DATA (~/Library/Application Support/Cutroom), not into this
  folder, so updating Cutroom keeps them. Safe to run again: it upgrades yt-dlp
  (YouTube changes often) and skips what's there.
*/
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CUTROOM, DATA, HOME, VENV, ensureDirs } from './lib/paths.mjs';
import { depsReport, hyperframes, playwright, playwrightDir } from './lib/deps.mjs';
import { matteTool, matteToolPath } from './lib/cutout.mjs';

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const value = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const ok = m => console.log(`  ✓ ${m}`);
const bad = m => console.log(`  ✗ ${m}`);
const step = m => console.log(`  … ${m}`);
const sh = (cmd, a, opts = {}) => spawnSync(cmd, a, { stdio: opts.quiet ? 'pipe' : 'inherit', encoding: 'utf8', cwd: opts.cwd });
const has = cmd => sh('which', [cmd], { quiet: true }).status === 0;
const CHECK = flag('--check');

let failed = false;
console.log(CHECK ? 'Cutroom: checking setup\n' : 'Cutroom setup\n');

// Node.
if (Number(process.versions.node.split('.')[0]) < 22) { bad(`Node ${process.versions.node}: Cutroom needs 22 or newer (brew upgrade node)`); failed = true; }
else ok(`Node ${process.versions.node}`);

// ffmpeg with the filters the renderer uses.
const ff = sh('ffmpeg', ['-hide_banner', '-filters'], { quiet: true });
if (ff.status !== 0) { bad('ffmpeg not found (brew install ffmpeg)'); failed = true; }
else {
  const missing = ['lut3d', 'xfade', 'acrossfade', 'sidechaincompress', 'alimiter', 'overlay', 'silencedetect', 'negate', 'alphamerge'].filter(f => !new RegExp(`\\s${f}\\s`).test(ff.stdout));
  if (missing.length) { bad(`ffmpeg is missing filters: ${missing.join(', ')}`); failed = true; }
  else ok(`ffmpeg ${sh('ffmpeg', ['-version'], { quiet: true }).stdout.split(' ')[2]}`);
}

// npm packages: Playwright, HyperFrames, GSAP. A checkout with its own node_modules uses those.
mkdirSync(DATA, { recursive: true });
let deps = depsReport();
if (!(deps.playwright && deps.hyperframes && deps.gsap) && !CHECK) {
  step('installing Playwright, HyperFrames and GSAP');
  const pkg = JSON.parse(readFileSync(join(CUTROOM, 'package.json'), 'utf8'));
  writeFileSync(join(DATA, 'package.json'), JSON.stringify({ name: 'cutroom-deps', private: true, dependencies: pkg.dependencies }, null, 2) + '\n');
  if (sh('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: DATA }).status !== 0) { bad('npm install failed'); failed = true; }
  deps = depsReport();
}
for (const [k, v] of Object.entries(deps)) (v ? ok : bad)(v ? k : `${k} not installed`);
if (!Object.values(deps).every(Boolean)) failed = true;

// Python: faster-whisper (transcription) and yt-dlp (downloads), in Cutroom's own environment.
const py = join(VENV, 'bin', 'python');
if (!CHECK) {
  if (!existsSync(py)) {
    step(`creating the Python environment in ${VENV}`);
    const r = has('uv') ? sh('uv', ['venv', '--quiet', '--python', '3.12', VENV]) : sh('python3', ['-m', 'venv', VENV]);
    if (r.status !== 0) { bad('Could not create the Python environment (brew install uv)'); failed = true; }
  }
  if (existsSync(py)) {
    step('installing faster-whisper and yt-dlp');
    const pip = list => (has('uv') ? sh('uv', ['pip', 'install', '--quiet', '--upgrade', '--python', py, ...list]) : sh(py, ['-m', 'pip', 'install', '-q', '--upgrade', ...list]));
    if (pip(['-r', join(CUTROOM, 'requirements.txt')]).status !== 0) { bad('Python packages failed to install'); failed = true; }
    if (flag('--with-whisper')) { step('installing openai-whisper (large download)'); if (pip(['openai-whisper']).status !== 0) { bad('openai-whisper install failed'); failed = true; } }
  }
}
const v = existsSync(py) ? sh(py, ['-c', 'import faster_whisper, yt_dlp; print(faster_whisper.__version__, yt_dlp.version.__version__)'], { quiet: true }) : { status: 1 };
if (v.status === 0) { const [fw, yt] = v.stdout.trim().split(' '); ok(`faster-whisper ${fw}`); ok(`yt-dlp ${yt}`); }
else { bad('faster-whisper and yt-dlp not installed'); failed = true; }

// Prefetch a transcription model.
const model = value('--model');
if (model && !CHECK && existsSync(py)) {
  step(`downloading the ${model} model`);
  const r = sh(py, ['-c', `from faster_whisper import WhisperModel; WhisperModel(${JSON.stringify(model)}, device="cpu", compute_type="int8"); print("ok")`]);
  if (r.status === 0) ok(`model ${model}`); else { bad(`model ${model}`); failed = true; }
}

// Browsers: Playwright's Chromium draws the graphics; HyperFrames brings its own for animations.
if (deps.playwright) {
  const { chromium } = playwright();
  if (!existsSync(chromium.executablePath()) && !CHECK) {
    step('downloading Chromium for graphics');
    sh(process.execPath, [join(playwrightDir(), 'cli.js'), 'install', 'chromium']);
  }
  if (existsSync(chromium.executablePath())) ok('Chromium (graphics)');
  else { bad('Chromium for graphics not installed'); failed = true; }
}
if (deps.hyperframes) {
  if (!CHECK) {
    step('checking the HyperFrames browser (animations)');
    const [cmd, a] = hyperframes(['browser', 'ensure']);
    if (sh(cmd, a, { quiet: true }).status === 0) ok('HyperFrames browser (animations)'); else { bad('HyperFrames could not get its browser'); failed = true; }
  } else {
    const [cmd, a] = hyperframes(['browser', 'path']);
    if (sh(cmd, a, { quiet: true }).status === 0) ok('HyperFrames browser (animations)'); else { bad('HyperFrames browser not downloaded'); failed = true; }
  }
}

// Cutouts (animations behind the speaker): Apple Vision, built with the Command Line Tools' swiftc.
// Optional: everything else works without it.
if (existsSync(matteToolPath())) ok('Cutouts (Apple Vision)');
else if (CHECK) bad('Cutouts tool not built yet (optional; built on first use)');
else {
  step('building the cutout tool (Apple Vision)');
  try { await matteTool(); ok('Cutouts (Apple Vision)'); }
  catch (e) { bad(`Cutouts unavailable (optional): ${e.message.split('\n')[0]}`); }
}

ensureDirs();
ok(`your videos, fonts and music live in ${HOME}`);
console.log(failed
  ? `\n${CHECK ? 'Setup is incomplete' : 'Some steps failed'} (see above).${CHECK ? ' Run setup to fix it.' : ''}`
  : '\nCutroom is ready.');
process.exit(failed ? 1 : 0);
