/* Rendering: overlays (HyperFrames → ProRes 4444 with alpha), the sound-effects stem, and the export
   (video + overlays + voice/SFX mix) in one ffmpeg pass. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { behindOf, rangeMatte } from './cutout.mjs';
import { faceAt, noGo } from './faces.mjs';
import { describe, lint, saveLint } from './lint.mjs';
import { probe } from './probe.mjs';
import { bar, run, secs } from './progress.mjs';
import { checkDeps, duration, HF, sh } from './project.mjs';
import { mix, wav } from './synth.mjs';

/** Render the overlay .mov for each beat that's stale. Returns { id: { front, back } }: back is only there
    for a beat with layers behind the speaker (retro.json "behind"), and front then holds the rest.
    Shows HyperFrames' own progress (compile → capturing frame n/N → encode) on one line per pass. */
export async function renderOverlays(project, ids, size = project.size) {
  const dir = project.overlayDir(size);
  mkdirSync(dir, { recursive: true });
  const jobs = ids.flatMap(id => (behindOf(project, id).length ? ['front', 'back'] : [null]).map(pass => {
    const { work, key } = project.stage(id, size, { pass }), name = pass ? `${id}~${pass}` : id;
    const mov = join(dir, `${name}.mov`), stamp = join(dir, `.${name}.key`);
    return { id, pass, name, work, key, mov, stamp, cached: existsSync(mov) && existsSync(stamp) && readFileSync(stamp, 'utf8') === key };
  }));
  const todo = jobs.filter(j => !j.cached);
  if (jobs.length) console.log(`… overlays: ${todo.length ? `${todo.length} to render` : 'all cached'}${todo.length && todo.length < jobs.length ? `, ${jobs.length - todo.length} cached` : ''}`);
  const t0 = Date.now();
  for (const [i, j] of todo.entries()) {
    const b = bar(`[${String(i + 1).padStart(String(todo.length).length)}/${todo.length}] ${j.name}`, { pipeEvery: 0 });
    b.update(0, 'starting');
    await run(process.execPath, [HF, 'render', j.work, '--format', 'mov', '-o', j.mov, '--fps', '30', '--workers', '2'], line => {
      const m = /[█░]+\s+(\d+)%\s+(.+)$/.exec(line);   // "████░░░  45%  Capturing frame 38/87 (2 workers)"
      if (m) b.update(+m[1] / 100, `${m[2].replace(/\s*\(\d+ workers?\)/, '').trim()} · ${secs(b.elapsed())}`);
    });
    writeFileSync(j.stamp, j.key);
    b.done(`  ✓ ${j.name} ${secs(b.elapsed())}`);
  }
  if (todo.length > 1) console.log(`  overlays done in ${secs((Date.now() - t0) / 1000)}`);
  const out = {};
  for (const j of jobs) (out[j.id] ||= {})[j.pass === 'back' ? 'back' : 'front'] = j.mov;
  return out;
}

/** The cues of the beats that are on and not muted, with per-beat gain applied. */
export function activeCues(project, probes) {
  const cues = [];
  for (const [id, p] of Object.entries(probes)) {
    const b = project.beat(id);
    if (!project.on(id) || b.sfx === false) continue;
    for (const c of p.cues) cues.push({ ...c, beat: id, vol: (c.vol || 0) + (b.sfxGain || 0) });
  }
  return cues.sort((a, b) => a.t - b.t);
}

export function writeSfx(project, probes, len) {
  const cues = activeCues(project, probes);
  const f = join(project.out, 'sfx.wav');
  writeFileSync(f, wav(mix(cues, len, project.cfg.sfxGain || 0)));
  writeFileSync(join(project.out, 'sfx-cues.csv'), 'time_s,sound,beat,layer\n' + cues.map(c => `${c.t.toFixed(3)},${c.s},${c.beat},${c.layer}`).join('\n') + '\n');
  return { file: f, count: cues.length };
}

/** Composite the beats that are on over the video and mix the SFX under the voice. Bottom to top: the video,
    the layers that go behind the speaker, the speaker cut out of the video (only where something is
    behind them), then everything else. ffmpeg reports how far through the video it is (-progress),
    shown as a bar with time left. */
export async function exportVideo(project, probes, movs, { video = project.video, size = project.size, sfx = true, draft = false } = {}) {
  const [W, H] = size, ids = Object.keys(movs).filter(id => project.on(id));
  const len = duration(video);
  const s = sfx ? writeSfx(project, probes, len) : null;
  const backs = ids.filter(id => movs[id].back);
  const mattes = [];
  for (const id of backs) mattes.push(await rangeMatte(video, project.out, probes[id].start, probes[id].end, size));
  const inputs = ['-i', video], chain = [], add = (file, at) => { inputs.push('-itsoffset', at.toFixed(3), '-i', file); return inputs.filter(x => x === '-i').length - 1; };
  let cur = 'base', n = 0;
  const over = top => {                                // lay a label or an input (its number) over what's there so far
    n++;
    if (typeof top === 'number') { chain.push(`[${top}:v]format=yuva444p[t${n}]`); top = `t${n}`; }
    chain.push(`[${cur}][${top}]overlay=eof_action=pass:format=auto[v${n}]`); cur = `v${n}`;
  };
  chain.push(`[0:v]scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p${backs.length ? ',split=2[base][pic]' : '[base]'}`);
  for (const id of backs) over(add(movs[id].back, probes[id].start));
  if (backs.length) {                                  // the speaker, cut out, over the layers behind them
    chain.push(`color=c=black:s=${W}x${H}:r=30:d=${len.toFixed(3)},format=yuv444p[m0]`);
    mattes.forEach((m, i) => {
      const k = add(m.file, m.start);
      chain.push(`[${k}:v]format=yuv444p[mi${i}]`, `[m${i}][mi${i}]overlay=eof_action=pass:format=yuv444[m${i + 1}]`);
    });
    chain.push(`[m${mattes.length}]format=gray[mat]`, `[pic][mat]alphamerge[me]`);
    over('me');
  }
  for (const id of ids) over(add(movs[id].front, probes[id].start));
  chain.push(`[${cur}]format=yuv420p[vout]`);
  const nIn = inputs.filter(x => x === '-i').length;
  let amap = ['-map', '0:a'];
  if (s) {
    inputs.push('-i', s.file);
    chain.push(`[0:a]aresample=48000[voice]`, `[voice][${nIn}:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]`);
    amap = ['-map', '[aout]'];
  }
  const name = basename(video, extname(video));
  const out = join(project.out, `${name}-retro${draft ? '-draft' : ''}.mp4`);
  const enc = draft ? ['-crf', '24', '-preset', 'veryfast'] : ['-crf', '18', '-preset', 'medium'];
  console.log(`… export ${W}x${H}${draft ? ' draft' : ''}, ${ids.length} overlays${backs.length ? ` (${backs.length} behind you)` : ''}${s ? `, ${s.count} sound cues` : ''} → ${basename(out)}`);
  const b = bar('export', { pipeEvery: 10 });
  let speed = '';
  b.update(0, 'starting');
  await run('ffmpeg', ['-v', 'error', '-nostats', '-progress', 'pipe:1', '-y', ...inputs, '-filter_complex', chain.join(';'), '-map', '[vout]', ...amap,
    '-c:v', 'libx264', ...enc, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', out], line => {
    const sp = /^speed=\s*([\d.]+x)/.exec(line);
    if (sp) speed = sp[1];
    const m = /^out_time_us=(\d+)/.exec(line);
    if (!m) return;
    const done = Math.min(len, +m[1] / 1e6), frac = done / len, el = b.elapsed();
    const left = frac > 0.03 ? ` · ~${secs(el / frac - el)} left` : '';
    b.update(frac, `${done.toFixed(1)} / ${len.toFixed(1)}s of video${speed ? ` · ${speed}` : ''}${left}`);
  });
  b.done(`  ✓ export ${secs(b.elapsed())}`);
  writeFileSync(join(project.out, 'placements.csv'), 'beat,start_s,end_s,start_tc,file\n' + ids.map(id => {
    const p = probes[id], f = Math.round(p.start * 30), tc = `00:00:${String(Math.floor(f / 30)).padStart(2, '0')}:${String(f % 30).padStart(2, '0')}`;
    return `${id},${p.start.toFixed(3)},${p.end.toFixed(3)},${tc},${basename(project.overlayDir(size))}/${basename(movs[id].front)}`;
  }).join('\n') + '\n');
  return out;
}

/** A contact sheet: items [{ id, probe, mov: { front, back }, matte, t }] (any beats), up to `cols` across.
    A beat with layers behind the speaker needs its matte ({ file, start } from rangeMatte) to show them
    the way the export does. → out/<name>.jpg */
export function sheet(project, items, name, { zones = true, faces, cols = 5 } = {}) {
  const [W, H] = project.size, U = W / 100, tmp = mkdtempSync(join(tmpdir(), 'retro-frames-'));
  try {
    items.forEach(({ probe, mov, matte, t }, i) => {
      const rel = Math.max(0, t - probe.start - 0.2), src = probe.start + rel;
      const f = zones && faceAt(faces, t), z = f && noGo(f);
      const box = z ? `,drawbox=x=${(z[0] * U) | 0}:y=${(z[1] * U) | 0}:w=${(z[2] * U) | 0}:h=${(z[3] * U) | 0}:color=red@0.9:t=6` : '';
      const ins = ['-ss', String(src), '-i', project.video, '-ss', String(rel), '-i', mov.front];
      let g = `[0:v]scale=${W}:${H}[a]`;
      if (mov.back && matte) {
        ins.push('-ss', String(rel), '-i', mov.back, '-ss', String(Math.max(0, src - matte.start)), '-i', matte.file);
        g = `[0:v]scale=${W}:${H},split=2[s][p];[s][2:v]overlay[b];[3:v]format=gray[m];[p][m]alphamerge[me];[b][me]overlay[a]`;
      }
      sh('ffmpeg', ['-v', 'error', '-y', ...ins, '-filter_complex',
        `${g};[a][1:v]overlay,select='gte(t\\,0.2)'${box},scale=432:768`, '-frames:v', '1', join(tmp, `${String(i).padStart(3, '0')}.png`)]);
    });
    const out = join(project.out, `${name}.jpg`), c = Math.min(cols, items.length), r = Math.ceil(items.length / c);
    sh('ffmpeg', ['-v', 'error', '-y', '-pattern_type', 'glob', '-i', join(tmp, '*.png'), '-vf', `tile=${c}x${r}:color=0x1E1E1E`, '-frames:v', '1', out]);
    return out;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** The whole render, as `retro render` and the Studio run it: check (lint, printed), overlays (cached), export.
    ids: beats to include (default: all that are on). Returns the export's path. */
export async function renderProject(project, { ids, draft = false, sfx = true, video = project.video, size = project.size } = {}) {
  checkDeps();
  ids = (ids || project.beatIds()).filter(id => project.on(id));
  const off = project.beatIds().filter(id => !project.on(id));
  if (off.length) console.log(`off: ${off.join(', ')}`);
  const t0 = Date.now();
  process.stdout.write(`… checking ${ids.length} beats (timing, placement, sounds) `);
  const pr = await probe(project, ids, size);
  const issues = lint(project, pr, project.faces());
  if (size === project.size) saveLint(project, issues, pr, ids.length === project.beatIds().filter(id => project.on(id)).length);
  console.log(issues.length ? `${issues.length} placement note(s):` : 'ok');
  issues.forEach(i => console.log(`! ${describe(i)}`));
  const movs = await renderOverlays(project, ids, size);
  const out = await exportVideo(project, pr, movs, { video, size, sfx, draft });
  console.log(`→ ${out}`);
  console.log(`  done in ${secs((Date.now() - t0) / 1000)}`);
  return out;
}

/** One frame per beat (that's on), `at` of the way into each, in one sheet → out/check-all.jpg. */
export async function framesAll(project, { at = 0.85, zones = true } = {}) {
  const ids = project.beatIds().filter(id => project.on(id));
  if (!ids.length) throw new Error('No beats to show yet');
  const pr = await probe(project, ids), movs = await renderOverlays(project, ids);
  const mattes = {};
  for (const id of ids) if (movs[id].back) mattes[id] = await rangeMatte(project.video, project.out, pr[id].start, pr[id].end, project.size);
  const items = ids.map(id => ({ id, t: +(pr[id].start + (pr[id].end - pr[id].start) * at).toFixed(2) }));
  return sheet(project, items.map(i => ({ ...i, probe: pr[i.id], mov: movs[i.id], matte: mattes[i.id] })), 'check-all', { faces: project.faces(), zones });
}
