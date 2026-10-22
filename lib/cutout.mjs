/*
  Cutouts: the speaker cut out of the picture, so an animation can sit behind them and in
  front of the background (an overlay with `behind: true`).

  The matte comes from Apple's Vision person segmentation (swift/matte.swift), compiled on
  first use into DATA/bin with swiftc from the Command Line Tools (Homebrew installs them).
  ffmpeg decodes into it and encodes out of it, so frame timing stays with ffmpeg.

    render   a matte per shot clip that an animation sits behind, made from the clip
             itself so it matches the crop, push-in and grade to the pixel. Accurate
             quality; cached next to the clip, keyed by the clip.
    preview  the proxy with its matte stacked underneath (cache/cutout/proxy-<tool>.mp4):
             one video, so picture and matte can't drift apart in the browser. Balanced
             quality (about 4× faster). Made once per project, the first time the editor
             shows an animation behind the speaker.
*/
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CUTROOM, DATA, projectDir } from './paths.mjs';
import { Cancelled, run } from './proc.mjs';
import { probe } from './media.mjs';

const SOURCE = join(CUTROOM, 'swift', 'matte.swift');
export const MATTE_VERSION = 1;

const toolKey = () => createHash('sha1').update(readFileSync(SOURCE)).digest('hex').slice(0, 10);
/** Changes whenever a matte would come out differently: part of every matte's cache key. */
export const matteKey = () => `${toolKey()}-${MATTE_VERSION}`;

/** Where the compiled matte tool lives (it may not be built yet). */
export const matteToolPath = () => join(DATA, 'bin', `matte-${toolKey()}`);

let building = null;
/** Path of the compiled matte tool, compiling it the first time. */
export function matteTool() {
  const bin = matteToolPath();
  if (existsSync(bin)) return Promise.resolve(bin);
  building ??= (async () => {
    mkdirSync(join(DATA, 'bin'), { recursive: true });
    const tmp = `${bin}.part`;
    try {
      await run('swiftc', ['-O', SOURCE, '-o', tmp]);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw new Error(`Cutouts need Apple's Command Line Tools to build the matte tool (run: xcode-select --install).\n${e.message}`);
    }
    renameSync(tmp, bin);
    return bin;
  })().finally(() => { building = null; });
  return building;
}

/**
  decoder (ffmpeg → raw BGRA frames) → matte tool → encoder (ffmpeg, matte on pipe:0).
  onFrame(n) after each matte frame.
*/
async function throughMatte(decArgs, encArgs, { width, height, quality, signal, onFrame }) {
  const tool = await matteTool();
  if (signal?.aborted) throw new Cancelled();
  const ff = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
  const procs = [
    spawn('ffmpeg', [...ff, ...decArgs, '-f', 'rawvideo', '-pix_fmt', 'bgra', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] }),
    spawn(tool, [String(width), String(height), quality], { stdio: ['pipe', 'pipe', 'pipe'] }),
    spawn('ffmpeg', [...ff, '-y', ...encArgs], { stdio: ['pipe', 'ignore', 'pipe'] }),
  ];
  const [dec, mat, enc] = procs;
  const errs = procs.map(() => '');
  procs.forEach((c, k) => c.stderr.on('data', d => { errs[k] = (errs[k] + d).slice(-4000); }));
  // A process downstream exiting early closes our pipe: that's reported by its exit code instead.
  for (const s of [mat.stdin, enc.stdin]) s.on('error', () => {});
  dec.stdout.pipe(mat.stdin);
  mat.stdout.pipe(enc.stdin);
  const frame = width * height;
  let bytes = 0;
  mat.stdout.on('data', d => { bytes += d.length; onFrame?.(Math.floor(bytes / frame)); });
  const kill = () => procs.forEach(c => c.kill('SIGKILL'));
  signal?.addEventListener('abort', kill, { once: true });
  const codes = await Promise.all(procs.map(c => new Promise(r => { c.on('error', e => { errs[procs.indexOf(c)] += e.message; r(-1); }); c.on('close', r); })));
  signal?.removeEventListener('abort', kill);
  if (signal?.aborted) throw new Cancelled();
  const bad = codes.findIndex(c => c !== 0);
  if (bad >= 0) throw new Error(`Cutout failed (${['decode', 'matte', 'encode'][bad]}): ${errs[bad].trim().split('\n').slice(-4).join('\n') || `exit ${codes[bad]}`}`);
}

/**
  A matte for one rendered clip: gray FFV1, same size and frames. `blank` lists [t0, t1]
  windows (clip seconds) with no speaker in them: B-roll covers the picture there.
*/
export async function clipMatte(clip, out, { width, height, fps, frames, blank = [], signal, onProgress }) {
  const tmp = out.replace(/\.mkv$/, '.part.mkv');
  const off = blank.map(([a, b]) => `lut=c0=0:enable='between(t,${a.toFixed(4)},${b.toFixed(4)})'`).join(',');
  await throughMatte(['-i', clip, '-map', '0:v:0'],
    ['-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0', ...(off ? ['-vf', off] : []), '-c:v', 'ffv1', '-pix_fmt', 'gray', tmp],
    { width, height, quality: 'accurate', signal, onFrame: n => onProgress?.(Math.min(1, n / frames)) });
  renameSync(tmp, out);
  return out;
}

/**
  One still of the speaker, cut out: a PNG with the matte as alpha. `vf` is the crop, scale
  and grade to apply first (it must come out width × height).
*/
export async function stillCutout(src, t, out, { width, height, vf }) {
  const tmp = out.replace(/\.png$/, '.part.png');
  await throughMatte(['-ss', String(t), '-i', src, '-frames:v', '1', '-vf', vf],
    ['-ss', String(t), '-i', src, '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${width}x${height}`, '-i', 'pipe:0',
      '-filter_complex', `[0:v]${vf},format=rgba[c];[1:v]format=gray[m];[c][m]alphamerge[v]`, '-map', '[v]', '-frames:v', '1', tmp],
    { width, height, quality: 'accurate' });
  renameSync(tmp, out);
  return out;
}

/* ---------- preview: the proxy with its matte underneath ---------- */

const previews = new Map();   // project id → { progress, error, promise }

const previewFile = id => join(projectDir(id), 'cache', 'cutout', `proxy-${matteKey()}.mp4`);

/** Is the preview cutout there (and newer than the proxy)? */
function previewReady(id) {
  const f = previewFile(id), proxy = join(projectDir(id), 'proxy.mp4');
  return existsSync(f) && existsSync(proxy) && statSync(f).mtimeMs >= statSync(proxy).mtimeMs;
}

/** { state: 'ready' | 'working' | 'error' | 'none', progress, error, file } */
export function previewCutout(id) {
  if (previewReady(id)) return { state: 'ready', progress: 1, file: previewFile(id) };
  const p = previews.get(id);
  if (p) return { state: p.error ? 'error' : 'working', progress: p.progress, error: p.error || null };
  return { state: 'none', progress: 0 };
}

/** Start making the preview cutout if it isn't there yet. Returns its state. */
export function startPreviewCutout(id) {
  const cur = previewCutout(id);
  if (cur.state === 'ready' || cur.state === 'working') return cur;
  const job = { progress: 0, error: null };
  previews.set(id, job);
  job.promise = makePreview(id, p => { job.progress = p; })
    .then(() => previews.delete(id))
    .catch(e => { job.error = e.message; console.error(e); });
  return previewCutout(id);
}

async function makePreview(id, onProgress) {
  const proxy = join(projectDir(id), 'proxy.mp4');
  if (!existsSync(proxy)) throw new Error('No preview copy yet: import the video first.');
  const info = await probe(proxy);
  const out = previewFile(id);
  // One per project: drop any made by an older matte tool.
  rmSync(join(projectDir(id), 'cache', 'cutout'), { recursive: true, force: true });
  mkdirSync(join(projectDir(id), 'cache', 'cutout'), { recursive: true });
  const tmp = out.replace(/\.mp4$/, '.part.mp4');
  const total = Math.max(1, Math.round(info.duration * info.fps));
  // Both halves are timed by frame number, so frame k of the matte lands on frame k of the picture.
  const f = `[0:v]setpts=N/(${info.fps}*TB)[c];[1:v]setpts=N/(${info.fps}*TB),format=yuv420p[m];[c][m]vstack=shortest=1[v]`;
  await throughMatte(['-i', proxy, '-map', '0:v:0'],
    ['-i', proxy, '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${info.width}x${info.height}`, '-r', String(info.fps), '-i', 'pipe:0',
      '-filter_complex', f, '-map', '[v]', ...(info.hasAudio ? ['-map', '0:a:0', '-c:a', 'copy'] : []),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-g', '15', '-keyint_min', '15', '-movflags', '+faststart', tmp],
    { width: info.width, height: info.height, quality: 'balanced', onFrame: n => onProgress(Math.min(0.999, n / total)) });
  renameSync(tmp, out);
}
