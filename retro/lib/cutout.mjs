/* "Behind me": an animation layer sitting between the speaker and the background.
   The speaker is cut out with Cutroom's own matte tool (Apple Vision person segmentation,
   swift/matte.swift via lib/cutout.mjs), so retro and Cutroom cut people out the same way.

     render   a matte per beat that has a layer behind the speaker, at render size (accurate),
              covering just that beat's time on screen. Cached in out/mattes/.
     preview  the light preview copy with its matte stacked underneath (out/.preview-cut-*.mp4):
              one video, so picture and matte can't drift apart in the browser. Balanced quality,
              made once per video, the first time something goes behind. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { matteKey, throughMatte } from '../../lib/cutout.mjs';
import { bar, secs } from './progress.mjs';
import { duration } from './project.mjs';

const FPS = 30;
/** Layers of a beat that go behind the speaker (and are showing). */
export const behindOf = (project, id) => (project.beat(id).behind || []).filter(L => !(project.beat(id).hide || []).includes(L));

/** The speaker's matte (gray FFV1, W×H, 30 fps) for [start, end] of a video. Starts on a frame. */
export async function rangeMatte(video, outDir, start, end, [W, H]) {
  const s = Math.floor(start * FPS) / FPS, d = Math.ceil((end - s) * FPS) / FPS;
  const v = statSync(video), dir = join(outDir, 'mattes');
  const out = join(dir, `${s.toFixed(3)}-${d.toFixed(3)}-${W}x${H}-${Math.round(v.mtimeMs)}-${matteKey()}.mkv`);
  if (existsSync(out)) return { file: out, start: s };
  mkdirSync(dir, { recursive: true });
  const tmp = out.replace(/\.mkv$/, '.part.mkv'), frames = Math.round(d * FPS);
  const b = bar(`cutout ${s.toFixed(1)}–${(s + d).toFixed(1)}s`, { pipeEvery: 0 });
  b.update(0, 'cutting you out');
  await throughMatte(['-ss', s.toFixed(4), '-i', video, '-t', d.toFixed(4), '-map', '0:v:0', '-vf', `scale=${W}:${H}:flags=lanczos,fps=${FPS}`],
    ['-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0', '-c:v', 'ffv1', '-pix_fmt', 'gray', tmp],
    { width: W, height: H, quality: 'accurate', onFrame: n => b.update(Math.min(1, n / frames), `frame ${n}/${frames} · ${secs(b.elapsed())}`) });
  renameSync(tmp, out);
  b.done(`  ✓ cutout ${s.toFixed(1)}–${(s + d).toFixed(1)}s ${secs(b.elapsed())}`);
  return { file: out, start: s };
}

/* ---------- preview: the light copy with its matte stacked underneath ---------- */

let job = null;   // { progress, error }
const cutFile = project => join(project.out, `.preview-cut-${matteKey()}.mp4`);

/** { state: 'ready' | 'working' | 'error' | 'none', progress, error } */
export function previewCut(project, light) {
  const f = cutFile(project);
  if (existsSync(f) && statSync(f).mtimeMs >= statSync(light).mtimeMs) return { state: 'ready', progress: 1, file: f };
  if (job) return { state: job.error ? 'error' : 'working', progress: job.progress, error: job.error };
  return { state: 'none', progress: 0 };
}

/** Start making it if it isn't there yet. */
export function startPreviewCut(project, light) {
  const cur = previewCut(project, light);
  if (cur.state === 'ready' || cur.state === 'working') return cur;
  job = { progress: 0, error: null };
  const out = cutFile(project), tmp = out.replace(/\.mp4$/, '.part.mp4');
  const [w, h] = probeSize(light), total = Math.max(1, Math.round(duration(light) * FPS));
  console.log('… cutting you out of the preview copy (once per video)');
  const f = `[0:v]fps=${FPS},setpts=N/(${FPS}*TB)[c];[1:v]setpts=N/(${FPS}*TB),format=yuv420p[m];[c][m]vstack=shortest=1[v]`;
  throughMatte(['-i', light, '-map', '0:v:0', '-vf', `fps=${FPS}`],
    ['-i', light, '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${w}x${h}`, '-r', String(FPS), '-i', 'pipe:0',
      '-filter_complex', f, '-map', '[v]', '-map', '0:a:0?', '-c:a', 'copy',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-g', '15', '-keyint_min', '15', '-movflags', '+faststart', tmp],
    { width: w, height: h, quality: 'balanced', onFrame: n => { job.progress = Math.min(0.999, n / total); } })
    .then(() => { renameSync(tmp, out); job = null; console.log('  ✓ preview cutout ready'); })
    .catch(e => { job.error = e.message; console.error(e); });
  return previewCut(project, light);
}

function probeSize(f) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f], { encoding: 'utf8' });
  return r.stdout.trim().split(',').map(Number);
}
