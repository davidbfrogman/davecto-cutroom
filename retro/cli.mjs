#!/usr/bin/env node
/*
  retro: Retro OS motion graphics + sound effects over a finished vertical video.
  Run `retro help` (or `node retro/cli.mjs help`). GUIDE.md is how to write beats; README.md is how to use it.
*/
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { detect, fmtZone, freeOver, layout, zones } from './lib/faces.mjs';
import { describe, lint } from './lib/lint.mjs';
import { probe } from './lib/probe.mjs';
import { secs } from './lib/progress.mjs';
import { checkDeps, createProject, duration, findProject, Project, PYTHON, RETRO, sh } from './lib/project.mjs';
import { exportVideo, frames, renderOverlays, sheet, writeSfx } from './lib/render.mjs';

const HELP = `retro: Retro OS overlays + sound effects for a finished video

Setup
  retro new <video> [--dir d]     make a project (<video>-retro/ next to it), transcribe, find faces
  retro words [from] [to]         the transcript, one phrase per line with start times
  retro faces                     find faces and scene cuts again (after a re-cut)
  retro layout                    each scene's face and the free space around it (in u, worst case)
  retro zones [from] [to]         free space through time (every 0.5 s, merged): where a window fits when
  retro sounds [words...]         the sound catalogue (98 sounds): what each is for, its set, length, tags;
                                  with words, ranked matches (★ = matches every word): retro sounds win warm
  retro beat <NN-name> [phrase] [--to phrase|secs]
                                  start a beat: snaps to a nearby scene cut, and writes the words, cuts
                                  and free space for its span into the file as a comment

Look
  retro ls                        beats: on/off, times, layers, moves, sounds
  retro lint [beats]              check placement (face/chin zone, Instagram UI zone), content cut off
                                  by its window, and anything timed after the beat ends
  retro frames <beat> [t ...]     contact sheet of a beat over the video (red box = face no-go zone)
  retro frames <beat> --events    a frame just after each moment something happens (from its sounds)
  retro frames all|<beats...>     one frame per beat in one sheet (--at 0.85 = how far into each beat)
  retro preview [--port 4180] [--no-open]
                                  browser preview (opens it): play, toggle, move, retime (saves to retro.json)

Tweak (all of this is retro.json; edit it by hand if you like)
  retro off <beats>  /  retro on <beats>
  retro move <beat> [layer] <dx> <dy>   nudge a layer (default main; * = whole beat) in u (1% of width)
  retro move <beat> [layer] --reset
  retro sfx <beat> off|on|<dB>          mute a beat's sounds or set their level (e.g. -3)
  retro sfx all <dB>                    level of the whole sound stem
  retro time <beat> stretch|cut <start> <end>
                                  retime a beat: stretch = play the whole thing between start and end
                                  (faster/slower, sounds move with it); cut = show only start..end at
                                  normal speed. Values: seconds (12.4), +/- from the current edge
                                  (+0.5, -0.3) or - to keep. Both can be combined.
  retro time <beat> --reset [stretch|cut]
  retro hide <beat> <layer>  /  retro show <beat> <layer>
                                  switch one animation (a layer) off or on, its sounds with it

Render
  retro render [beats] [--draft] [--no-sfx] [--no-open] [--video other.mov] [--size 1080x1920]
                                  overlays (cached) + lint + SFX + the export: out/<video>-retro.mp4,
                                  then shows it in Finder (--no-open to skip)

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
    const p = P(), to = flag('--to', true), id = argv[0], phrase = argv.slice(1).join(' ');
    if (!/^\d\d-[a-z0-9-]+$/.test(id || '')) throw new Error('retro beat <NN-name> [phrase] [--to phrase|secs], e.g. retro beat 03-ton-smarter "a ton smarter"');
    const d = join(p.dir, 'beats', id);
    if (existsSync(join(d, 'index.html'))) throw new Error(`${id} exists`);
    const ws = p.words(), f = p.faces(), cuts = f?.cuts || [];
    const find = (q, after = 0) => {
      const n = s => s.toLowerCase().replace(/[^a-z0-9%$' ]+/g, ' ').trim(), qs = n(q).split(/\s+/);
      const i = ws.findIndex((w, i) => w.t >= after - 1e-6 && qs.every((x, j) => n(ws[i + j]?.w || '') === x || (j === qs.length - 1 && n(ws[i + j]?.w || '').startsWith(x))));
      if (i < 0) throw new Error(`"${q}" not in the transcript after ${after}s`);
      return ws[i].t;
    };
    let a = phrase ? find(phrase) : 0, startSrc;
    const cut = cuts.find(c => Math.abs(c - a) <= 0.5);
    if (cut != null) { a = cut; startSrc = `${cut};${' '.repeat(Math.max(1, 30 - String(cut).length))}// the scene cut${phrase ? ` (by "${phrase}")` : ''}`; }
    else startSrc = phrase ? `R.w(${JSON.stringify(phrase)}, 0);` : '0;';
    const end = to ? (isNaN(+to) ? find(to, a + 0.1) : +to)
      : Math.min(cuts.find(c => c > a + 1.5) ?? 1e9, (ws.at(-1)?.e ?? a + 5) + 0.3);
    const endC = cuts.find(c => Math.abs(c - end) <= 0.3) ?? end;
    // the beat's words, cuts and free space, so writing it needs no other lookups
    const said = ws.filter(w => w.t >= a - 0.05 && w.t < endC).map(w => `${w.w}@${w.t.toFixed(2)}`);
    const lines = []; for (let i = 0; i < said.length; i += 10) lines.push(said.slice(i, i + 10).join(' '));
    const zs = f ? zones(f, a, endC) : [];
    const info = [
      `${id} ${a.toFixed(2)}–${endC.toFixed(2)}${cuts.some(c => c > a + 0.05 && c < endC - 0.05) ? `  (cuts inside: ${cuts.filter(c => c > a + 0.05 && c < endC - 0.05).join(', ')})` : ''}`,
      ...lines.map(l => `  ${l}`),
      'Free space (worst case; u; Instagram-safe x0–86, y20–' + (f ? Math.round(f.height - 37) : 141) + '):',
      ...(f ? [`  whole beat   ${fmtZone({ a, b: endC, ...freeOver(f, a, endC) })}`] : []),
      ...zs.map(z => `  ${z.a.toFixed(2)}–${z.b.toFixed(2)}  ${fmtZone(z)}`),
    ].map(l => `     ${l}`).join('\n').replace(/--/g, '- -');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'index.html'), `<!doctype html>
<!-- ${id}: what's said, and what happens on which word. (Replace this line; keep the notes below
     until the beat is done, then delete them.)
${info} -->
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
<body data-world="pink">
  <div id="root" data-composition-id="root" data-width="1080" data-height="1920">
    <div class="clip" id="stage" data-start="0" data-duration="5"></div>
  </div>
  <script>
    R.START = ${startSrc}
    const END = ${endC.toFixed(2)}, W = p => R.w(p, R.START - 0.1);
    // const A = R.win({ title: 'Name.app', right: 'v1', variant: 'paper', x: 4, y: 20.5, w: 82, h: 'auto', body: '' });
    // R.open(A, W('word'));
    R.done(END);
  </script>
</body>
</html>
`);
    p.beat(id); p.save();
    console.log(join(d, 'index.html'));
    console.log(info.replace(/^ {5}/gm, ''));
  },

  async sounds() {
    const { INFO, CATEGORIES, PACKS, SOUNDS, RATE } = await import('./lib/synth.mjs');
    const set = {}; for (const [p, ns] of Object.entries(PACKS)) for (const n of ns) set[n] = p;
    const q = argv.join(' ').toLowerCase().split(/\s+/).filter(Boolean);   // 'win warm' or win warm
    // whole words ("win" isn't "window"); words of 4+ letters also match as a start ("celebr" → celebrate)
    const toks = n => `${n} ${INFO[n].join(' ')} ${set[n]}`.toLowerCase().split(/[^a-z0-9]+/);
    const has = (n, w) => toks(n).some(t => t === w || (w.length >= 4 && t.startsWith(w)));
    // ranked: sounds matching more of the words first (all of them = the best fits), partial matches after
    const score = n => q.filter(w => has(n, w)).length;
    const hits = Object.keys(INFO).filter(n => !q.length || score(n) > 0).sort((a, b) => score(b) - score(a));
    if (!hits.length) { console.log(`no sound matches "${q.join(' ')}". Try other words, or: retro sounds`); return; }
    if (q.length > 1) {
      const best = hits.filter(n => score(n) === q.length);
      console.log(best.length ? `best fits (all of "${q.join(' ')}"): ${best.join(', ')}` : `nothing matches all of "${q.join(' ')}"; closest below`);
    }
    for (const c of CATEGORIES) {
      const ns = hits.filter(n => INFO[n][0] === c).sort((a, b) => score(b) - score(a)); if (!ns.length) continue;
      console.log(`\n${c}`);
      for (const n of ns) console.log(`${q.length > 1 && score(n) === q.length ? '★ ' : '  '}${n.padEnd(10)} ${set[n].padEnd(9)} ${(SOUNDS[n] ? (SOUNDS[n].length / RATE).toFixed(2) + 's' : ' ~0s').padStart(5)}  ${INFO[n][1]}  [${INFO[n][2]}]`);
    }
    console.log(`\n${hits.length} sound(s). Cue one with R.sfx(name, t, { vol, layer }).`);
  },

  zones() {
    const p = P(), f = p.faces(); if (!f) throw new Error('No faces.json: run retro faces');
    const [a = 0, b = Math.max(p.words().at(-1)?.e ?? 0, f.samples.at(-1).t)] = argv.map(Number);
    console.log(`free space, worst case per stretch (u). Cuts: ${f.cuts.join(', ')}`);
    for (const z of zones(f, a, b)) console.log(`${z.a.toFixed(2).padStart(6)}–${z.b.toFixed(2).padEnd(6)} ${fmtZone(z)}`);
  },

  async ls() {
    const p = P(), pr = await probes(p);
    for (const id of p.beatIds()) {
      const b = p.beat(id), x = pr[id];
      const mv = Object.entries(b.move || {}).map(([k, [dx, dy]]) => `${k}:${dx},${dy}`).join(' ');
      console.log(`${p.on(id) ? 'on ' : 'off'}  ${id.padEnd(20)} ${x.start.toFixed(2).padStart(6)}–${x.end.toFixed(2).padEnd(6)} layers: ${x.layers.join(',').padEnd(18)} sfx: ${b.sfx === false ? 'muted' : `${x.cues.length}${b.sfxGain ? ` @${b.sfxGain}dB` : ''}`}${mv ? `  move ${mv}` : ''}${b.time ? `  time ${JSON.stringify(b.time)}` : ''}${b.hide ? `  hidden ${b.hide.join(',')}` : ''}${b.allow ? `  allow ${b.allow.join(',')}` : ''}`);
    }
  },

  async lint() {
    const p = P(), ids = p.match(argv).filter(id => p.on(id)), pr = await probes(p, ids);
    const issues = lint(p, pr, p.faces());
    if (!p.faces()) console.log('(no faces.json: only the Instagram zone was checked; run retro faces)');
    issues.forEach(i => console.log(describe(i)));
    const n = k => issues.filter(i => i.kind === k).length;
    console.log(issues.length ? `${n('face') + n('safe')} placement · ${n('clip')} clipped · ${n('timing')} timing issue(s)` : 'ok: placement, clipping, timing');
    process.exitCode = issues.some(i => i.kind === 'face' || i.kind === 'clip') ? 1 : 0;
  },

  async frames() {
    const p = P(), events = !!flag('--events'), clean = !!flag('--clean'), at = Number(flag('--at', true) ?? 0.85);
    const args = [], ts = [];
    const isBeat = v => !/^\d+(\.\d+)?$/.test(v) || (/^\d\d$/.test(v) && p.beatIds().some(b => b.startsWith(v)));
    for (const v of argv) (args.length && !isBeat(v) ? ts : args).push(v);   // "12" = beat 12 if there is one; "12.0" = 12 s
    const ids = args[0] === 'all' ? p.beatIds().filter(id => p.on(id)) : p.match(args);
    if (!ids.length) throw new Error('retro frames <beat> [t ...] | --events | all | <beats...>');
    const pr = await probes(p, ids), movs = await renderOverlays(p, ids);
    let items;
    if (ids.length > 1) items = ids.map(id => ({ id, t: +(pr[id].start + (pr[id].end - pr[id].start) * at).toFixed(2) }));
    else {
      const id = ids[0], x = pr[id];
      let t = ts.map(Number);
      if (events) {   // just after each sound = just after each thing happens; close ones merge
        for (const c of [...x.cues].sort((m, n) => m.t - n.t)) { const v = Math.min(x.end - 0.05, c.t + 0.15); if (!t.length || v - t.at(-1) > 0.45) t.push(+v.toFixed(2)); }
        if (t.length > 10) t = t.filter((_, i) => i % Math.ceil(t.length / 10) === 0);
      }
      if (!t.length) t = [0.15, 0.4, 0.65, 0.92].map(k => +(x.start + (x.end - x.start) * k).toFixed(2));
      items = t.map(v => ({ id, t: v }));
    }
    const name = ids.length > 1 ? (args[0] === 'all' ? 'check-all' : `check-${ids.map(i => i.slice(0, 2)).join('-')}`) : `check-${ids[0]}`;
    const out = sheet(p, items.map(i => ({ ...i, probe: pr[i.id], mov: movs[i.id] })), name, { faces: p.faces(), zones: !clean });
    console.log(out);
    console.log(items.map((i, k) => `${k + 1}: ${i.id} @${i.t}`).join('  '));
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

  async time() {
    const p = P(), reset = flag('--reset'), [id] = p.match([argv.shift()]), b = p.beat(id);
    const key = { stretch: 'retime', cut: 'crop' };
    if (reset) {
      const which = argv[0] ? [key[argv[0]]] : ['retime', 'crop'];
      if (b.time) { which.forEach(k => delete b.time[k]); if (!Object.keys(b.time).length) delete b.time; }
    } else {
      const [mode, sa = '-', sb = '-'] = argv, k = key[mode];
      if (!k) throw new Error('retro time <beat> stretch|cut <start> <end>   (e.g. retro time 01 cut +2 -,  retro time 04 stretch - 17.2)');
      const x = (await probes(p, [id]))[id];
      const src = x.src || { start: x.start, end: x.end };
      const cur = b.time?.[k] || (k === 'crop' ? [x.start, x.end] : b.time?.retime || [src.start, src.end]);
      const val = (v, c) => v === '-' ? c : /^[+-]/.test(v) ? c + Number(v) : Number(v);
      const [na, nb] = [val(sa, cur[0]), val(sb, cur[1])].map(v => Math.round(v * 1000) / 1000);
      if (!Number.isFinite(na) || !Number.isFinite(nb) || nb - na < 0.2) throw new Error(`bad times ${na}–${nb} (end must be at least 0.2 s after start)`);
      b.time = { ...(b.time || {}), [k]: [na, nb] };
    }
    p.save();
    const x = (await probes(p, [id]))[id], src = x.src || x;
    const r = b.time?.retime, speed = r ? (src.end - src.start) / (r[1] - r[0]) : 1;
    console.log(`${id}: written ${src.start.toFixed(2)}–${src.end.toFixed(2)} · shows ${x.start.toFixed(2)}–${x.end.toFixed(2)}${speed !== 1 ? ` · ${speed.toFixed(2)}x speed` : ''} · ${x.cues.length} sounds${b.time ? `  ${JSON.stringify(b.time)}` : ''}`);
  },

  hide() { cmds.show(true); },
  show(hiding = false) {
    const p = P(), [id] = p.match([argv.shift()]), b = p.beat(id), L = argv[0];
    if (!L) throw new Error(`retro ${hiding ? 'hide' : 'show'} <beat> <layer>   (retro ls lists the layers)`);
    const h = new Set(b.hide || []); hiding ? h.add(L) : h.delete(L);
    if (h.size) b.hide = [...h]; else delete b.hide;
    p.save();
    console.log(`${id}: ${b.hide ? `hidden: ${b.hide.join(', ')}` : 'all layers showing'}`);
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
    const draft = !!flag('--draft'), noSfx = !!flag('--no-sfx'), noOpen = !!flag('--no-open');
    const video = flag('--video', true), sizeArg = flag('--size', true);
    const size = sizeArg ? sizeArg.split('x').map(Number) : p.size;
    const ids = p.match(argv).filter(id => p.on(id));
    const off = p.beatIds().filter(id => !p.on(id));
    if (off.length) console.log(`off: ${off.join(', ')}`);
    const t0 = Date.now();
    process.stdout.write(`… checking ${ids.length} beats (timing, placement, sounds) `);
    const pr = await probe(p, ids, size);
    const issues = lint(p, pr, p.faces());
    console.log(issues.length ? `${issues.length} placement note(s):` : 'ok');
    issues.forEach(i => console.log(`! ${describe(i)}`));
    const movs = await renderOverlays(p, ids, size);
    const out = await exportVideo(p, pr, movs, { video: video ? resolve(video) : p.video, size, sfx: !noSfx, draft });
    console.log(`→ ${out}`);
    console.log(`  done in ${secs((Date.now() - t0) / 1000)}`);
    // Show it in Finder (what you want next 99% of the time); --no-open to skip, e.g. in scripts
    if (!noOpen && process.platform === 'darwin') spawnSync('open', ['-R', out]);
  },

  // The preview runs as a child process that this one restarts whenever retro's own code changes, so a
  // long-running preview never keeps serving old code (an old server silently ignored new kinds of
  // edits once). The browser tab stays put: the page retries a save while the server restarts.
  async preview() {
    const port = Number(flag('--port', true)) || 4180, noOpen = !!flag('--no-open');
    if (process.env.RETRO_PREVIEW_CHILD) { const { serve } = await import('./lib/preview.mjs'); await serve(P(), port, { open: !noOpen }); return; }
    const { spawn } = await import('node:child_process'), { readdirSync, statSync } = await import('node:fs');
    const dir = P().dir, files = () => [join(RETRO, 'cli.mjs'), ...readdirSync(join(RETRO, 'lib')).filter(f => f.endsWith('.mjs')).map(f => join(RETRO, 'lib', f))];
    const stamp = () => files().map(f => statSync(f).mtimeMs).join();
    let child = null, first = true, last = stamp();
    const start = () => {
      child = spawn(process.execPath, [join(RETRO, 'cli.mjs'), 'preview', '-p', dir, '--port', String(port), ...(first && !noOpen ? [] : ['--no-open'])],
        { stdio: 'inherit', env: { ...process.env, RETRO_PREVIEW_CHILD: '1' } });
      first = false;
      child.on('exit', code => { if (code && !child.restarting) { console.error(`retro preview stopped (exit ${code})`); process.exit(code); } });
    };
    start();
    setInterval(() => {
      const now = stamp(); if (now === last) return;
      last = now; console.log('… retro was updated: restarting the preview server (your browser tab keeps working)');
      child.restarting = true; child.once('exit', start); child.kill();
    }, 1000);
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child?.kill(); process.exit(0); });
    await new Promise(() => {});
  },

  // Write only the SFX stem (out/sfx.wav), e.g. to drop into an editor.
  async stem() { const p = P(); const pr = await probes(p); const s = writeSfx(p, pr, duration(p.video)); console.log(`${s.count} cues → ${s.file}`); },
};

function printLayout(p, f) {
  const end = p.words().at(-1)?.e ?? f.samples.at(-1).t;
  console.log(`frame: 100 x ${f.height}u. Face no-go zone = face + brow + chin band. Free space, worst case over each scene (x0,y0 → x1,y1); retro zones for it through time:`);
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
