#!/usr/bin/env node
/*
  retro: Retro OS motion graphics + sound effects over a finished vertical video.
  Run `retro help` (or `node retro/cli.mjs help`). GUIDE.md is how to write beats; README.md is how to use it.
*/
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { detect, layout } from './lib/faces.mjs';
import { describe, lint } from './lib/lint.mjs';
import { probe } from './lib/probe.mjs';
import { checkDeps, createProject, duration, findProject, Project, PYTHON, RETRO, sh } from './lib/project.mjs';
import { exportVideo, frames, renderOverlays, writeSfx } from './lib/render.mjs';

const HELP = `retro: Retro OS overlays + sound effects for a finished video

Setup
  retro new <video> [--dir d]     make a project (<video>-retro/ next to it), transcribe, find faces
  retro words [from] [to]         the transcript, one phrase per line with start times
  retro faces                     find faces and scene cuts again (after a re-cut)
  retro layout                    each scene's face and the free space around it (in u)
  retro beat <NN-name> [phrase]   start a new beat file (boilerplate only, starting at a phrase)

Look
  retro ls                        beats: on/off, times, layers, moves, sounds
  retro lint [beats]              check placement: face/chin zone and the Instagram UI zone
  retro frames <beat> [t ...]     contact sheet of a beat over the video (red box = face no-go zone)
  retro preview [--port 4180]     browser preview: play, toggle beats, drag layers (saves to retro.json)

Tweak (all of this is retro.json; edit it by hand if you like)
  retro off <beats>  /  retro on <beats>
  retro move <beat> [layer] <dx> <dy>   nudge a layer (default main; * = whole beat) in u (1% of width)
  retro move <beat> [layer] --reset
  retro sfx <beat> off|on|<dB>          mute a beat's sounds or set their level (e.g. -3)
  retro sfx all <dB>                    level of the whole sound stem

Render
  retro render [beats] [--draft] [--no-sfx] [--video other.mov] [--size 1080x1920]
                                  overlays (cached) + lint + SFX + the export: out/<video>-retro.mp4

Options: -p <project dir> (default: the nearest folder up with a retro.json)`;

const argv = process.argv.slice(2);
const flag = (name, val = false) => {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = val ? argv[i + 1] : true;
  argv.splice(i, val ? 2 : 1);
  return v;
};
const cmd = argv.shift() || 'help';
const pdir = flag('-p', true);
const P = () => new Project(findProject(pdir));

async function probes(p, ids = p.beatIds()) { return probe(p, ids); }

const cmds = {
  help() { console.log(HELP); },

  async new() {
    checkDeps();
    const dirArg = flag('--dir', true), video = argv[0];
    if (!video) throw new Error('retro new <video>');
    argv.length = 0;
    const dir = createProject(video, dirArg);
    const p = new Project(dir);
    console.log(`project: ${dir}`);
    await cmds.words.call(null, true, p);
    process.stdout.write('… faces ');
    const f = detect(p);
    console.log(`${f.samples.length} samples, cuts at ${f.cuts.join(', ') || 'none'}`);
    printLayout(p, f);
    console.log(`\nNext: write beats in ${join(dir, 'beats')} (GUIDE.md), then retro render.`);
  },

  async words(redo = flag('--redo'), p = P()) {
    if (redo || !existsSync(join(p.dir, 'words.json'))) {
      process.stdout.write('… transcribing (faster-whisper small.en) ');
      console.log(sh(PYTHON, [join(RETRO, 'lib', 'words.py'), p.video, join(p.dir, 'words.json')]).trim());
    }
    const [a = 0, b = 1e9] = argv.map(Number);
    let line = [], start = 0;
    const flush = () => { if (line.length) console.log(`${start.toFixed(2).padStart(6)}  ${line.join(' ')}`); line = []; };
    const ws = p.words();
    ws.forEach((w, i) => {
      if (w.t < a || w.t > b) return;
      if (!line.length) start = w.t;
      line.push(w.w);
      const gap = (ws[i + 1]?.t ?? 1e9) - w.e;
      if (/[.?!]$/.test(w.w) || gap > 0.3 || line.length >= 14) flush();
    });
    flush();
  },

  faces() { const p = P(); const f = detect(p); console.log(`${f.samples.length} samples, cuts at ${f.cuts.join(', ')}`); printLayout(p, f); },
  layout() { const p = P(); const f = p.faces(); if (!f) throw new Error('No faces.json: run retro faces'); printLayout(p, f); },

  beat() {
    const p = P(), id = argv[0], phrase = argv.slice(1).join(' ');
    if (!/^\d\d-[a-z0-9-]+$/.test(id || '')) throw new Error('retro beat <NN-name> [phrase], e.g. retro beat 03-ton-smarter "a ton smarter"');
    const d = join(p.dir, 'beats', id);
    if (existsSync(join(d, 'index.html'))) throw new Error(`${id} exists`);
    mkdirSync(d, { recursive: true });
    const start = phrase ? `R.w(${JSON.stringify(phrase)}, 0)` : '0';
    writeFileSync(join(d, 'index.html'), `<!doctype html>
<!-- ${id}: what's said, and what happens on which word. -->
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=1080, height=1920" />
  <title>${id}</title>
  <link rel="stylesheet" href="retro.css" />
  <script src="gsap.min.js"></script>
  <script src="retro.js"></script>
  <!-- <script src="ships.js"></script>  starships / critters / dither (kit/ships.js) -->
  <style>
  </style>
</head>
<body>
  <div id="root" data-composition-id="root" data-width="1080" data-height="1920">
    <div class="clip" id="stage" data-start="0" data-duration="5"></div>
  </div>
  <script>
    R.START = ${start};
    // const W = R.win({ title: 'Name.app', right: 'v1', variant: 'paper', x: 8, y: 24, w: 60, h: 30, body: '' });
    // R.open(W, R.w('word'));
    R.done(R.START + 3);
  </script>
</body>
</html>
`);
    p.beat(id); p.save();
    console.log(join(d, 'index.html'));
  },

  async ls() {
    const p = P(), pr = await probes(p);
    for (const id of p.beatIds()) {
      const b = p.beat(id), x = pr[id];
      const mv = Object.entries(b.move || {}).map(([k, [dx, dy]]) => `${k}:${dx},${dy}`).join(' ');
      console.log(`${p.on(id) ? 'on ' : 'off'}  ${id.padEnd(20)} ${x.start.toFixed(2).padStart(6)}–${x.end.toFixed(2).padEnd(6)} layers: ${x.layers.join(',').padEnd(18)} sfx: ${b.sfx === false ? 'muted' : `${x.cues.length}${b.sfxGain ? ` @${b.sfxGain}dB` : ''}`}${mv ? `  move ${mv}` : ''}${b.allow ? `  allow ${b.allow.join(',')}` : ''}`);
    }
  },

  async lint() {
    const p = P(), ids = p.match(argv).filter(id => p.on(id)), pr = await probes(p, ids);
    const issues = lint(p, pr, p.faces());
    if (!p.faces()) console.log('(no faces.json: only the Instagram zone was checked; run retro faces)');
    issues.forEach(i => console.log(describe(i)));
    console.log(issues.length ? `${issues.length} placement issue(s)` : 'placement ok');
    process.exitCode = issues.some(i => i.kind === 'face') ? 1 : 0;
  },

  async frames() {
    const p = P(), [id] = p.match([argv.shift()]), pr = await probes(p, [id]), x = pr[id];
    const movs = renderOverlays(p, [id]);
    let ts = argv.map(Number);
    if (!ts.length) ts = [0.15, 0.4, 0.65, 0.92].map(k => +(x.start + (x.end - x.start) * k).toFixed(2));
    console.log(frames(p, id, x, movs[id], ts, { faces: p.faces(), zones: !flag('--clean') }));
  },

  on() { const p = P(); p.match(argv).forEach(id => { p.beat(id).on = true; }); p.save(); cmds.ls(); },
  off() { const p = P(); p.match(argv).forEach(id => { p.beat(id).on = false; }); p.save(); cmds.ls(); },

  move() {
    const p = P(), [id] = p.match([argv.shift()]), b = p.beat(id);
    const reset = flag('--reset');
    const layer = argv.length === 3 || (reset && argv.length === 1) ? argv.shift() : 'main';
    b.move ||= {};
    if (reset) delete b.move[layer];
    else {
      const [dx, dy] = argv.map(Number);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('retro move <beat> [layer] <dx> <dy>');
      const [x0, y0] = b.move[layer] || [0, 0];
      b.move[layer] = [Math.round((x0 + dx) * 10) / 10, Math.round((y0 + dy) * 10) / 10];
    }
    if (!Object.keys(b.move).length) delete b.move;
    p.save();
    console.log(`${id} move: ${JSON.stringify(b.move || {})}`);
  },

  sfx() {
    const p = P(), what = argv.shift(), v = argv.shift();
    if (what === 'all') { p.cfg.sfxGain = Number(v); p.save(); console.log(`sound stem ${p.cfg.sfxGain} dB`); return; }
    const [id] = p.match([what]), b = p.beat(id);
    if (v === 'off') b.sfx = false; else if (v === 'on') delete b.sfx; else { delete b.sfx; b.sfxGain = Number(v); }
    p.save();
    console.log(`${id}: sound ${b.sfx === false ? 'muted' : `on${b.sfxGain ? ` at ${b.sfxGain} dB` : ''}`}`);
  },

  async render() {
    checkDeps();
    const p = P();
    const draft = !!flag('--draft'), noSfx = !!flag('--no-sfx');
    const video = flag('--video', true), sizeArg = flag('--size', true);
    const size = sizeArg ? sizeArg.split('x').map(Number) : p.size;
    const ids = p.match(argv).filter(id => p.on(id));
    const off = p.beatIds().filter(id => !p.on(id));
    if (off.length) console.log(`off: ${off.join(', ')}`);
    const pr = await probe(p, ids, size);
    const issues = lint(p, pr, p.faces());
    issues.forEach(i => console.log(`! ${describe(i)}`));
    const movs = renderOverlays(p, ids, size);
    const out = exportVideo(p, pr, movs, { video: video ? resolve(video) : p.video, size, sfx: !noSfx, draft });
    console.log(`→ ${out}`);
  },

  async preview() {
    const { serve } = await import('./lib/preview.mjs');
    await serve(P(), Number(flag('--port', true)) || 4180);
  },

  // Write only the SFX stem (out/sfx.wav), e.g. to drop into an editor.
  async stem() { const p = P(); const pr = await probes(p); const s = writeSfx(p, pr, duration(p.video)); console.log(`${s.count} cues → ${s.file}`); },
};

function printLayout(p, f) {
  const end = p.words().at(-1)?.e ?? f.samples.at(-1).t;
  console.log(`frame: 100 x ${f.height}u. Face no-go zone = face + brow + chin band. Free space (x0,y0 → x1,y1):`);
  for (const s of layout(f, Math.max(end, f.samples.at(-1).t))) {
    if (!s.face) { console.log(`${s.a.toFixed(2).padStart(6)}–${s.b.toFixed(2).padEnd(6)} no face`); continue; }
    const [x, y, w, h] = s.face, fr = s.free, r = ([a, b, c, d]) => `${a},${b}→${c},${d}`;
    console.log(`${s.a.toFixed(2).padStart(6)}–${s.b.toFixed(2).padEnd(6)} face x${x}–${x + w} y${y}–${y + h} | above ${r(fr.above)} (${fr.above[3] - fr.above[1]}u tall) | below ${r(fr.below)} (${fr.below[3] - fr.below[1]}u) | left ${r(fr.left)} | right ${r(fr.right)}`);
  }
}

try {
  if (!cmds[cmd]) { console.log(HELP); process.exit(1); }
  await cmds[cmd]();
} catch (e) {
  console.error(`retro ${cmd}: ${e.message}`);
  process.exit(1);
}
