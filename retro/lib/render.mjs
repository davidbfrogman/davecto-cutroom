/* Rendering: overlays (HyperFrames → ProRes 4444 with alpha), the sound-effects stem, and the export
   (video + overlays + voice/SFX mix) in one ffmpeg pass. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { faceAt, noGo } from './faces.mjs';
import { bar, run, secs } from './progress.mjs';
import { duration, HF, sh } from './project.mjs';
import { mix, wav } from './synth.mjs';

/** Render the overlay .mov for each beat that's stale. Returns { id: movPath }.
    Shows HyperFrames' own progress (compile → capturing frame n/N → encode) on one line per beat. */
export async function renderOverlays(project, ids, size = project.size) {
  const dir = project.overlayDir(size);
  mkdirSync(dir, { recursive: true });
  const jobs = ids.map(id => {
    const { work, key } = project.stage(id, size);
    const mov = join(dir, `${id}.mov`), stamp = join(dir, `.${id}.key`);
    return { id, work, key, mov, stamp, cached: existsSync(mov) && existsSync(stamp) && readFileSync(stamp, 'utf8') === key };
  });
  const todo = jobs.filter(j => !j.cached);
  if (jobs.length) console.log(`… overlays: ${todo.length ? `${todo.length} to render` : 'all cached'}${todo.length && todo.length < jobs.length ? `, ${jobs.length - todo.length} cached` : ''}`);
  const t0 = Date.now();
  for (const [i, j] of todo.entries()) {
    const b = bar(`[${String(i + 1).padStart(String(todo.length).length)}/${todo.length}] ${j.id}`, { pipeEvery: 0 });
    b.update(0, 'starting');
    await run(process.execPath, [HF, 'render', j.work, '--format', 'mov', '-o', j.mov, '--fps', '30', '--workers', '2'], line => {
      const m = /[█░]+\s+(\d+)%\s+(.+)$/.exec(line);   // "████░░░  45%  Capturing frame 38/87 (2 workers)"
      if (m) b.update(+m[1] / 100, `${m[2].replace(/\s*\(\d+ workers?\)/, '').trim()} · ${secs(b.elapsed())}`);
    });
    writeFileSync(j.stamp, j.key);
    b.done(`  ✓ ${j.id} ${secs(b.elapsed())}`);
  }
  if (todo.length > 1) console.log(`  overlays done in ${secs((Date.now() - t0) / 1000)}`);
  return Object.fromEntries(jobs.map(j => [j.id, j.mov]));
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

/** Composite the beats that are on over the video and mix the SFX under the voice.
    ffmpeg reports how far through the video it is (-progress), shown as a bar with time left. */
export async function exportVideo(project, probes, movs, { video = project.video, size = project.size, sfx = true, draft = false } = {}) {
  const [W, H] = size, ids = Object.keys(movs).filter(id => project.on(id));
  const len = duration(video);
  const s = sfx ? writeSfx(project, probes, len) : null;
  const inputs = ['-i', video], chain = [`[0:v]scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p[v0]`];
  ids.forEach((id, i) => {
    inputs.push('-itsoffset', probes[id].start.toFixed(3), '-i', movs[id]);
    chain.push(`[${i + 1}:v]format=yuva444p[o${i}]`, `[v${i}][o${i}]overlay=eof_action=pass:format=auto[v${i + 1}]`);
  });
  chain.push(`[v${ids.length}]format=yuv420p[vout]`);
  let amap = ['-map', '0:a'];
  if (s) {
    inputs.push('-i', s.file);
    chain.push(`[0:a]aresample=48000[voice]`, `[voice][${ids.length + 1}:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]`);
    amap = ['-map', '[aout]'];
  }
  const name = basename(video, extname(video));
  const out = join(project.out, `${name}-retro${draft ? '-draft' : ''}.mp4`);
  const enc = draft ? ['-crf', '24', '-preset', 'veryfast'] : ['-crf', '18', '-preset', 'medium'];
  console.log(`… export ${W}x${H}${draft ? ' draft' : ''}, ${ids.length} overlays${s ? `, ${s.count} sound cues` : ''} → ${basename(out)}`);
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
    return `${id},${p.start.toFixed(3)},${p.end.toFixed(3)},${tc},${basename(project.overlayDir(size))}/${id}.mov`;
  }).join('\n') + '\n');
  return out;
}

/** Contact sheet of one beat over the video at absolute times, with the face no-go zone outlined. */
export function frames(project, id, probe, mov, times, opts = {}) {
  return sheet(project, times.map(t => ({ id, probe, mov, t })), `check-${id}`, opts);
}

/** A contact sheet: items [{ id, probe, mov, t }] (any beats), up to `cols` across. → out/<name>.jpg */
export function sheet(project, items, name, { zones = true, faces, cols = 5 } = {}) {
  const [W, H] = project.size, U = W / 100, tmp = mkdtempSync(join(tmpdir(), 'retro-frames-'));
  try {
    items.forEach(({ probe, mov, t }, i) => {
      const rel = Math.max(0, t - probe.start - 0.2), src = probe.start + rel;
      const f = zones && faceAt(faces, t), z = f && noGo(f);
      const box = z ? `,drawbox=x=${(z[0] * U) | 0}:y=${(z[1] * U) | 0}:w=${(z[2] * U) | 0}:h=${(z[3] * U) | 0}:color=red@0.9:t=6` : '';
      sh('ffmpeg', ['-v', 'error', '-y', '-ss', String(src), '-i', project.video, '-ss', String(rel), '-i', mov, '-filter_complex',
        `[0:v]scale=${W}:${H}[a];[a][1:v]overlay,select='gte(t\\,0.2)'${box},scale=432:768`, '-frames:v', '1', join(tmp, `${String(i).padStart(3, '0')}.png`)]);
    });
    const out = join(project.out, `${name}.jpg`), c = Math.min(cols, items.length), r = Math.ceil(items.length / c);
    sh('ffmpeg', ['-v', 'error', '-y', '-pattern_type', 'glob', '-i', join(tmp, '*.png'), '-vf', `tile=${c}x${r}:color=0x1E1E1E`, '-frames:v', '1', out]);
    return out;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
