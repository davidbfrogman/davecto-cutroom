/*
  Render: storyboard → finished MP4, entirely with ffmpeg and a headless browser.

    1. clips     one intermediate per shot: exact frame counts, crop/zoom/push,
                 HDR/Log conversion, the look LUT, B-roll, cleaned and levelled
                 audio with 5 ms fades at every internal cut. Cached by content
                 hash, so re-renders only redo the shots you changed.
    2. motion    HyperFrames animations (lib/motion.mjs): transparent WebMs, cached
    3. graphics  the overlay track (titles, lower thirds, captions, cards) drawn
                 by graphics/overlay.html in Chromium. Only frames that differ
                 are screenshotted; the rest are held via an ffconcat list.
    4. assemble  hard cuts concatenated, transitions via xfade/acrossfade,
                 overlay on top, optional music ducked under the voice, final
                 H.264 encode.
    5. extras    captions (.srt), YouTube chapters (.txt), the edit list (.json)
*/
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CUTROOM, projectDir, MUSIC } from './paths.mjs';
import { ffmpeg } from './proc.mjs';
import { esc, POLISH } from './media.mjs';
import { lutFile, inputLutId } from './luts.mjs';
import { renderMotion } from './motion.mjs';
import { loadProject, loadAnalysis, updateProject, slugify } from './store.mjs';
import { startJob } from './jobs.mjs';
import { staticServer } from './static.mjs';
import { playwright } from './deps.mjs';
import { buildTimeline, clock, overlayData } from '../shared/timeline.mjs';
import { resolveBrand } from '../shared/brand.mjs';
import { cropRectEven, shotFraming } from '../shared/framing.mjs';

const CLIP_VERSION = 5;
const SR = 48000;

const STEPS = [
  { id: 'clips', label: 'Cutting shots', weight: 5 },
  { id: 'motion', label: 'Rendering animations', weight: 2 },
  { id: 'graphics', label: 'Drawing graphics', weight: 3 },
  { id: 'assemble', label: 'Assembling and encoding', weight: 4 },
  { id: 'extras', label: 'Writing captions and chapters', weight: 0.2 },
];

export function startRender(id, opts = {}) {
  const p = loadProject(id);
  if (!p.storyboard) throw Object.assign(new Error('This project has no storyboard yet.'), { status: 400 });
  return startJob(id, 'render', STEPS, job => render(id, job, opts));
}

const hash = x => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const f6 = x => Number(x).toFixed(6);

async function pool(items, n, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async (_, w) => {
    while (next < items.length) { const k = next++; await fn(items[k], k, w); }
  });
  await Promise.all(workers);
}

async function render(id, job, { preview = false } = {}) {
  updateProject(id, p => { p.status = 'rendering'; });
  try {
    const p = loadProject(id);
    const analysis = loadAnalysis(id);
    if (!analysis) throw new Error('Run ingest first: there is no transcript.');
    if (!p.source?.path || !existsSync(p.source.path)) throw new Error(`Source video is missing: ${p.source?.path}`);
    const s = p.settings;
    if (preview) { s.resolution = 540; }
    const tl = buildTimeline(p, analysis);
    if (!tl.items.length) throw new Error('Nothing to render: every shot is switched off.');
    const dir = projectDir(id);
    const cache = join(dir, 'cache');
    job.note(`${tl.items.length} shots · ${tl.width}×${tl.height} · ${clock(tl.duration, true)}`);

    // 1. Clips.
    const ctx = makeContext(p, analysis, tl);
    const tickClips = job.begin('clips', `Cutting ${tl.items.length} shots`);
    mkdirSync(join(cache, 'clips'), { recursive: true });
    const clipFiles = new Array(tl.items.length);
    let done = 0, reused = 0;
    // Where the source simply carries on from one shot into the next, don't fade the audio at the join.
    tl.items.forEach((it, k) => {
      const prev = tl.items[k - 1], next = tl.items[k + 1];
      const end = r => r.src0 + r.frames / tl.fps;
      const flows = (a, b) => a && b && b.trans.type === 'cut' && a.ranges.length && b.ranges.length && Math.abs(end(a.ranges[a.ranges.length - 1]) - b.ranges[0].src0) < 0.002;
      it.flowIn = !!flows(prev, it);
      it.flowOut = !!flows(it, next);
    });
    await pool(tl.items, 2, async (item, k) => {
      const spec = clipSpec(item, ctx);
      const file = join(cache, 'clips', `${hash(spec)}.mov`);
      if (existsSync(file)) reused++;
      else {
        const tmp = file.replace(/\.mov$/, '.part.mov');
        await ffmpeg([...clipArgs(item, ctx), tmp], { signal: job.signal });
        renameSync(tmp, file);
      }
      clipFiles[k] = file;
      tickClips(++done / tl.items.length);
    });
    job.note(`Shots ready (${reused} reused from cache)`);

    // 2. Animations (HyperFrames), each a transparent WebM laid over the cut video.
    const tickM = job.begin('motion');
    const motionOvs = tl.overlays.filter(o => o.type === 'motion');
    const motions = [];
    const brand = resolveBrand(s);
    for (const [k, o] of motionOvs.entries()) {
      const r = await renderMotion(id, o.props.name, { width: tl.width, height: tl.height, fps: tl.fps, vars: o.props.vars || {}, brand, signal: job.signal });
      motions.push({ file: r.file, start: o.start, end: Math.min(tl.duration, o.start + r.duration), top: !!o.props.top, blend: r.blend });
      tickM((k + 1) / motionOvs.length);
    }
    if (motions.length) job.note(`${motions.length} animation${motions.length > 1 ? 's' : ''} ready`);

    // 3. Graphics.
    const tickG = job.begin('graphics');
    const overlay = await renderGraphics(tl, s, join(cache, 'graphics'), { onProgress: tickG, signal: job.signal, note: m => job.note(m) });

    // 4. Assemble.
    const tickA = job.begin('assemble');
    mkdirSync(join(dir, 'exports'), { recursive: true });
    const d = new Date(), two = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
    const name = `${slugify(p.name)}-${s.aspect.replace(':', 'x')}-${stamp}${preview ? '-preview' : ''}`;
    const out = join(dir, 'exports', `${name}.mp4`);
    await assemble(tl, clipFiles, overlay, out, s, { motions, gain: ctx.gain, onProgress: tickA, signal: job.signal, scratch: cache, preview });

    // 5. Extras.
    job.begin('extras');
    const srt = join(dir, 'exports', `${name}.srt`);
    writeFileSync(srt, toSrt(tl.captions.length ? tl.captions : wordsAsCaptions(tl)));
    const chapters = join(dir, 'exports', `${name}-chapters.txt`);
    writeFileSync(chapters, tl.chapters.map(c => `${clock(c.t)} ${c.title}`).join('\n') + '\n');
    writeFileSync(join(dir, 'exports', `${name}-edit.json`), JSON.stringify({ duration: tl.duration, width: tl.width, height: tl.height, fps: tl.fps, items: tl.items.map(i => ({ id: i.id, kind: i.kind, start: i.start, dur: i.dur, ranges: i.ranges, transition: i.trans })) }, null, 1));

    const entry = { file: basename(out), srt: basename(srt), chapters: basename(chapters), createdAt: new Date().toISOString(), duration: tl.duration, width: tl.width, height: tl.height, aspect: s.aspect, size: statSync(out).size, preview };
    updateProject(id, q => { q.exports = [entry, ...(q.exports || [])].slice(0, 30); q.status = 'ready'; q.error = null; });
    return entry;
  } catch (e) {
    updateProject(id, q => { q.status = 'ready'; q.error = e.cancelled ? null : `Render failed: ${e.message}`; });
    throw e;
  }
}

/* ---------- 1. Clips ---------- */

function makeContext(p, analysis, tl) {
  const s = p.settings;
  const conv = inputLutId(p.source, s);
  const look = s.lut?.id && s.lut.id !== 'none' ? s.lut : null;
  const loud = analysis.loudness?.[s.audio.polish ? 'polish' : 'raw'];
  const gain = loud ? Math.max(-20, Math.min(20, s.audio.loudness - loud.I)) : 0;
  const lutMtime = id => (id?.startsWith('user:') ? lutStamp(id) : 0);
  return {
    src: p.source.path, srcW: p.source.width, srcH: p.source.height, mtime: p.source.mtime || 0,
    W: tl.width, H: tl.height, fps: tl.fps, settings: s,
    conv, convFile: conv ? lutFile(conv) : null,
    look, lookFile: look ? lutFile(look.id, look.intensity ?? 1) : null, lutStamp: [lutMtime(conv), lutMtime(look?.id)],
    polish: s.audio.polish !== false, gain,
    brollDir: join(projectDir(p.id), 'broll'),
  };
}

function lutStamp(id) {
  try { return statSync(lutFile(id)).size; } catch { return 0; }
}

function brollPath(b, ctx) {
  if (!b?.file) return null;
  const f = b.file.startsWith('/') ? b.file : join(ctx.brollDir, b.file);
  return existsSync(f) ? f : null;
}

/** Everything that changes a clip's pixels or samples. Its hash is the cache key. */
function clipSpec(item, ctx) {
  const b = item.shot.broll ? { ...item.shot.broll, path: brollPath(item.shot.broll, ctx) } : null;
  return {
    v: CLIP_VERSION, kind: item.kind, src: ctx.src, mtime: ctx.mtime, W: ctx.W, H: ctx.H, fps: ctx.fps,
    ranges: item.ranges.map(r => [f6(r.src0), r.frames]), frames: Math.round(item.dur * ctx.fps), flow: [item.flowIn, item.flowOut],
    fr: shotFraming(item.shot, ctx.settings), conv: ctx.conv, look: ctx.look, lutStamp: ctx.lutStamp,
    broll: b && b.path ? { ...b, mtime: statSync(b.path).mtimeMs } : null,
  };
}

/** Colour chain: conversion LUT, look LUT, then a clean BT.709 conversion back to 4:2:0. */
function colour(ctx, { grade = true } = {}) {
  const f = [];
  if (ctx.convFile) f.push('format=gbrp16le', `lut3d=file='${esc(ctx.convFile)}':interp=tetrahedral`);
  if (grade && ctx.lookFile) { if (!ctx.convFile) f.push('format=gbrp'); f.push(`lut3d=file='${esc(ctx.lookFile)}':interp=tetrahedral`); }
  f.push('scale=out_color_matrix=bt709:out_range=tv', 'format=yuv420p', 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv', 'setsar=1');
  return f.join(',');
}

const ENC_CLIP = fps => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-g', String(fps * 2), '-pix_fmt', 'yuv420p',
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'pcm_s16le', '-ar', String(SR), '-ac', '2'];

function clipArgs(item, ctx) {
  const { W, H, fps } = ctx;
  const N = Math.round(item.dur * fps);
  const samples = n => Math.round((n / fps) * SR);
  const args = [];
  const f = [];

  if (item.kind === 'card') {
    args.push('-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${fps}`, '-f', 'lavfi', '-i', `anullsrc=r=${SR}:cl=stereo`);
    f.push(`[0:v]trim=end_frame=${N},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v]`);
    f.push(`[1:a]atrim=end_sample=${samples(N)},asetpts=PTS-STARTPTS[a]`);
    return [...args, '-filter_complex', f.join(';'), '-map', '[v]', '-map', '[a]', ...ENC_CLIP(fps)];
  }

  item.ranges.forEach((r, k) => {
    args.push('-ss', f6(r.src0), '-t', f6(r.frames / fps + 0.5), '-i', ctx.src);
    const d = r.frames / fps;
    // 5 ms fades at every real cut so it doesn't click; none where the source carries straight on.
    const fadeIn = !(k === 0 && item.flowIn), fadeOut = !(k === item.ranges.length - 1 && item.flowOut);
    const fades = [fadeIn ? 'afade=t=in:d=0.005' : null, fadeOut ? `afade=t=out:st=${Math.max(0, d - 0.005).toFixed(4)}:d=0.005` : null].filter(Boolean).join(',');
    f.push(`[${k}:v:0]fps=${fps},trim=end_frame=${r.frames},setpts=PTS-STARTPTS[v${k}]`);
    f.push(`[${k}:a:0]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=end_sample=${samples(r.frames)},asetpts=PTS-STARTPTS${fades ? `,${fades}` : ''}[a${k}]`);
  });
  const K = item.ranges.length;
  f.push(`${item.ranges.map((_, k) => `[v${k}][a${k}]`).join('')}concat=n=${K}:v=1:a=1[vc][ac]`);

  const fr = shotFraming(item.shot, ctx.settings);
  const c = cropRectEven(ctx.srcW, ctx.srcH, W, H, fr.zoom, fr.fx, fr.fy);
  let v = `[vc]crop=${c.w}:${c.h}:${c.x}:${c.y}`;
  if (fr.motion === 'push' || fr.motion === 'pull') {
    const e = fr.motion === 'push' ? `(1+0.06*t/${f6(item.dur)})` : `(1.06-0.06*t/${f6(item.dur)})`;
    v += `,scale=w='trunc(${W}*${e}/2)*2':h='trunc(${H}*${e}/2)*2':eval=frame:flags=bicubic,crop=${W}:${H}`;
  } else {
    v += `,scale=${W}:${H}:flags=lanczos`;
  }
  v += `,${colour(ctx)}`;

  const bpath = brollPath(item.shot.broll, ctx);
  if (bpath) {
    const b = item.shot.broll;
    const start = Math.max(0, Math.min(item.dur - 0.1, b.start || 0));
    const len = Math.min(item.dur - start, b.dur || item.dur);
    const nb = Math.max(1, Math.round(len * fps));
    args.push('-ss', f6(b.in || 0), '-t', f6(len + 0.5), '-i', bpath);
    f.push(`${v}[vb]`);
    f.push(`[${K}:v:0]fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},${colour(ctx, { grade: !!b.grade })},trim=end_frame=${nb},setpts=PTS-STARTPTS+${f6(start)}/TB[bv]`);
    f.push(`[vb][bv]overlay=eof_action=pass:enable='between(t,${f6(start)},${f6(start + nb / fps - 0.001)})'[v]`);
  } else {
    f.push(`${v}[v]`);
  }
  // Voice clean-up and loudness run once over the whole edit in assemble(), so compressor and
  // limiter state never restarts at a join.
  f.push(`[ac]atrim=end_sample=${samples(N)}[a]`);
  return [...args, '-filter_complex', f.join(';'), '-map', '[v]', '-map', '[a]', '-frames:v', String(N), ...ENC_CLIP(fps)];
}

/* ---------- 2. Graphics ---------- */

const GRAPHICS_FILES = ['overlay.html', 'overlay.css', 'overlay.js'];

async function launchBrowser() {
  const { chromium } = playwright();
  try { return await chromium.launch(); } catch (e) {
    try { return await chromium.launch({ channel: 'chrome' }); } catch {
      throw new Error(`Couldn't start Chromium. Run Cutroom setup (it installs Playwright's Chromium).\n${e.message}`);
    }
  }
}

/**
  Render the overlay track. Returns the path of an RGBA video (PNG frames, VFR),
  or null when there's nothing to draw.
*/
export async function renderGraphics(tl, s, root, { onProgress, signal, note } = {}) {
  const data = overlayData(tl, s);
  if (!data.overlays.length && !data.captions.length) { note?.('No graphics or captions'); return null; }
  const stamp = GRAPHICS_FILES.map(f => statSync(join(CUTROOM, 'graphics', f)).mtimeMs);
  const dir = join(root, hash({ data, stamp }));
  const list = join(dir, 'list.ffconcat');
  const track = join(dir, 'overlay.mov');
  if (existsSync(track)) { note?.('Graphics reused from cache'); onProgress?.(1); return track; }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const server = await staticServer();
  const browser = await launchBrowser();
  try {
    const url = `http://127.0.0.1:${server.address().port}/graphics/overlay.html?render=1`;
    const open = async () => {
      const page = await browser.newPage({ viewport: { width: data.width, height: data.height }, deviceScaleFactor: 1 });
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.CR && window.CR.ready === true);
      await page.evaluate(d => window.CR.load(d), data);
      await page.evaluate(() => document.fonts.ready);
      return page;
    };
    const first = await open();
    const total = Math.max(1, Math.round(tl.duration * tl.fps));
    const sigs = await first.evaluate(([fps, n]) => window.CR.signatures(fps, n), [tl.fps, total]);

    // Runs of identical frames → one image each; identical states share one file.
    const runs = [];
    for (let f = 0; f < total; f++) {
      if (runs.length && runs[runs.length - 1].sig === sigs[f]) runs[runs.length - 1].n++;
      else runs.push({ sig: sigs[f], f, n: 1 });
    }
    const unique = new Map();
    for (const r of runs) if (!unique.has(r.sig)) unique.set(r.sig, { f: r.f, file: `f${String(unique.size).padStart(6, '0')}.png` });
    note?.(`${unique.size} distinct graphics frames for ${total} video frames`);

    const jobs = [...unique.values()];
    const pages = [first, ...(await Promise.all(Array.from({ length: Math.min(3, Math.ceil(jobs.length / 40)) }, open)))];
    let done = 0;
    await pool(jobs, pages.length, async (j, _k, w) => {
      if (signal?.aborted) return;
      const page = pages[w];
      await page.evaluate(t => window.CR.seek(t), j.f / tl.fps);
      await page.screenshot({ path: join(dir, j.file), omitBackground: true, type: 'png' });
      onProgress?.(++done / jobs.length);
    });
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });

    const lines = ['ffconcat version 1.0'];
    for (const r of runs) lines.push(`file '${unique.get(r.sig).file}'`, `duration ${f6(r.n / tl.fps)}`);
    lines.push(`file '${unique.get(runs[runs.length - 1].sig).file}'`);
    writeFileSync(list, lines.join('\n') + '\n');
    // One RGBA track. Chrome writes fully opaque frames (title cards) as RGB PNGs, and a pixel
    // format change mid-stream makes ffmpeg rebuild the whole assemble graph, losing xfade state.
    // Variable frame rate, so only the distinct frames are stored.
    const tmp = track.replace(/\.mov$/, '.part.mov');
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', 'format=rgba', '-c:v', 'png', '-pix_fmt', 'rgba', '-fps_mode', 'vfr', tmp], { signal });
    renameSync(tmp, track);
    return track;
  } finally {
    await browser.close();
    server.close();
  }
}

/* ---------- 3. Assemble ---------- */

function musicPath(m) {
  if (!m) return null;
  const f = m.startsWith('/') ? m : join(MUSIC, m);
  return existsSync(f) ? f : null;
}

async function assemble(tl, clips, overlay, out, s, { motions = [], gain, onProgress, signal, scratch, preview }) {
  const { fps } = tl;
  const args = [];
  clips.forEach(c => args.push('-i', c));
  let k = clips.length;
  const ovlIn = overlay ? k++ : -1;
  if (overlay) args.push('-i', overlay);
  const motionIn = motions.map(m => { args.push('-c:v', 'libvpx-vp9', '-i', m.file); return k++; });   // libvpx keeps the alpha
  const music = musicPath(s.audio?.music);
  const musIn = music ? k++ : -1;
  if (music) args.push('-stream_loop', '-1', '-i', music);

  const f = [];
  tl.items.forEach((_, i) => {
    f.push(`[${i}:v:0]setpts=PTS-STARTPTS,fps=${fps},settb=1/${fps},format=yuv420p,setsar=1[v${i}]`);
    f.push(`[${i}:a:0]aresample=${SR},asetpts=PTS-STARTPTS[a${i}]`);
  });

  // Runs of hard cuts.
  const runs = [];
  tl.items.forEach((it, i) => {
    const frames = Math.round(it.dur * fps);
    if (!runs.length || it.trans.type !== 'cut') runs.push({ items: [i], frames, trans: it.trans });
    else { runs[runs.length - 1].items.push(i); runs[runs.length - 1].frames += frames; }
  });
  runs.forEach((r, j) => {
    if (r.items.length === 1) { r.v = `v${r.items[0]}`; r.a = `a${r.items[0]}`; return; }
    f.push(`${r.items.map(i => `[v${i}][a${i}]`).join('')}concat=n=${r.items.length}:v=1:a=1[rc${j}][ra${j}]`, `[rc${j}]settb=1/${fps}[rv${j}]`);
    r.v = `rv${j}`; r.a = `ra${j}`;
  });

  // Transitions between runs.
  let v = runs[0].v, a = runs[0].a, len = runs[0].frames;
  for (let j = 1; j < runs.length; j++) {
    const r = runs[j];
    const d = Math.round(r.trans.d * fps);
    f.push(`[${v}][${r.v}]xfade=transition=${r.trans.type === 'dissolve' ? 'dissolve' : r.trans.type}:duration=${f6(d / fps)}:offset=${f6((len - d) / fps)}[xv${j}]`);
    f.push(`[${a}][${r.a}]acrossfade=d=${f6(d / fps)}:c1=tri:c2=tri[xa${j}]`);
    v = `xv${j}`; a = `xa${j}`;
    len += r.frames - d;
  }
  const total = len / fps;

  // Voice: clean-up, then one fixed gain to the loudness target, then a peak limiter, over the whole edit.
  const voice = [s.audio?.polish !== false ? POLISH : null, `volume=${(gain || 0).toFixed(2)}dB`, 'alimiter=limit=0.84:level=false:attack=5:release=50'].filter(Boolean).join(',');
  f.push(`[${a}]${voice}[vox]`);
  a = 'vox';

  // Layers, bottom to top: the cut video, text animations, titles and captions, then transition
  // stingers (a wipe has to cover the captions too).
  f.push(`[${v}]format=yuv444p[l0]`);
  let layer = 'l0';
  const lay = top => motions.forEach((m, j) => {
    if (m.top !== top) return;
    if (m.blend === 'invert') {
      // A mask: the layer below, negated, shows through the animation's alpha.
      f.push(`[${layer}]split[lb${j}][li${j}]`);
      f.push(`[li${j}]trim=start=${f6(m.start)}:end=${f6(m.end)},setpts=PTS-STARTPTS,negate[ln${j}]`);
      f.push(`[${motionIn[j]}:v]format=yuva444p,setpts=PTS-STARTPTS,alphaextract[mk${j}]`);
      f.push(`[ln${j}][mk${j}]alphamerge,setpts=PTS-STARTPTS+${f6(m.start)}/TB[m${j}]`);
      layer = `lb${j}`;
    } else f.push(`[${motionIn[j]}:v]format=yuva444p,setpts=PTS-STARTPTS+${f6(m.start)}/TB[m${j}]`);
    f.push(`[${layer}][m${j}]overlay=0:0:format=yuv444:eof_action=pass:repeatlast=0:enable='between(t,${f6(m.start)},${f6(m.end)})'[lm${j}]`);
    layer = `lm${j}`;
  });
  lay(false);
  if (overlay) {
    f.push(`[${ovlIn}:v]format=rgba,setpts=PTS-STARTPTS[ovl]`);
    f.push(`[${layer}][ovl]overlay=0:0:format=yuv444:eof_action=pass:repeatlast=1[lg]`);
    layer = 'lg';
  }
  lay(true);
  f.push(`[${layer}]format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv[vout]`);

  if (music) {
    const db = s.audio.musicDb ?? -24;
    f.push(`[${musIn}:a:0]aresample=${SR},aformat=channel_layouts=stereo,volume=${db}dB,atrim=0:${f6(total)},afade=t=in:d=1.5,afade=t=out:st=${f6(Math.max(0, total - 2.5))}:d=2.5[mus]`);
    f.push(`[${a}]asplit=2[voice][key]`);
    f.push(`[mus][key]sidechaincompress=threshold=0.02:ratio=6:attack=30:release=500:makeup=1[duck]`);
    f.push(`[voice][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.84:level=false:attack=5:release=50[aout]`);
  } else f.push(`[${a}]anull[aout]`);

  const script = join(scratch, 'assemble.filter');
  writeFileSync(script, f.join(';\n'));
  const enc = s.encoder === 'videotoolbox'
    ? ['-c:v', 'h264_videotoolbox', '-b:v', preview ? '4M' : '14M', '-profile:v', 'high']
    : ['-c:v', 'libx264', '-preset', preview ? 'veryfast' : 'medium', '-crf', preview ? '23' : '18', '-profile:v', 'high'];
  const tmp = out.replace(/\.mp4$/, '.part.mp4');
  const full = [...args, '-/filter_complex', script, '-map', '[vout]', '-map', '[aout]', ...enc, '-pix_fmt', 'yuv420p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k', '-ar', String(SR), '-movflags', '+faststart', '-t', f6(total), tmp];
  // The exact command, for re-running by hand when something looks off.
  writeFileSync(join(scratch, 'assemble.sh'), `ffmpeg -y ${full.map(a => `'${String(a).replace(/'/g, "'\\''")}'`).join(' ')}\n`);
  await ffmpeg(full, { duration: total, onProgress, signal });
  renameSync(tmp, out);
}

/* ---------- 4. Extras ---------- */

function srtTime(t) {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

export function toSrt(chunks) {
  return chunks.map((c, k) => `${k + 1}\n${srtTime(c.t0)} --> ${srtTime(c.t1)}\n${c.words.map(w => w.text).join(' ')}\n`).join('\n');
}

function wordsAsCaptions(tl) {
  // Captions are off in the video, but the .srt is still useful for uploads.
  const chunks = [];
  for (const w of tl.words) {
    const c = chunks[chunks.length - 1];
    if (c && c.words.length < 7 && w.t0 - c.t1 < 0.6) { c.words.push(w); c.t1 = w.t1; }
    else chunks.push({ t0: w.t0, t1: w.t1, words: [w] });
  }
  return chunks;
}
