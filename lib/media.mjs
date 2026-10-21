/*
  ffprobe / ffmpeg helpers for ingest and preview: probe a file, make the
  browser proxy, grab a frame, measure loudness, find camera cuts.
*/
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { run, ffmpeg } from './proc.mjs';

/** What we need to know about a source file. */
export async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(stdout);
  const v = j.streams.find(s => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const a = j.streams.find(s => s.codec_type === 'audio');
  const duration = Number(j.format?.duration || v?.duration || a?.duration || 0);
  if (!duration) throw new Error('Could not read the duration of this file.');
  let rotation = 0;
  if (v) {
    const sd = (v.side_data_list || []).find(x => x.rotation != null);
    rotation = Math.abs(Number(sd?.rotation ?? v.tags?.rotate ?? 0)) % 360;
  }
  const rate = s => { const [n, d] = String(s || '0/1').split('/').map(Number); return d ? n / d : n; };
  const swap = rotation === 90 || rotation === 270;
  const transfer = v?.color_transfer || '';
  return {
    duration,
    hasVideo: !!v,
    hasAudio: !!a,
    width: v ? (swap ? v.height : v.width) : 0,
    height: v ? (swap ? v.width : v.height) : 0,
    fps: v ? Math.round((rate(v.avg_frame_rate) || rate(v.r_frame_rate) || 30) * 1000) / 1000 : 0,
    codec: v?.codec_name || '',
    pixFmt: v?.pix_fmt || '',
    hdr: transfer === 'arib-std-b67' ? 'hlg' : transfer === 'smpte2084' ? 'pq' : null,
    rotation,
    size: Number(j.format?.size || 0),
  };
}

/**
  A small, quick-seeking H.264 copy for the browser: 720p short side, a keyframe
  every half second, HDR mapped to SDR so the preview matches the render.
  Tries the hardware encoder first, then libx264.
*/
export async function makeProxy(src, out, info, { hdrLut, onProgress, signal } = {}) {
  const short = 720;
  const scale = info.width >= info.height ? `scale=-2:${Math.min(short, info.height)}` : `scale=${Math.min(short, info.width)}:-2`;
  const vf = [hdrLut ? `lut3d=file='${esc(hdrLut)}'` : null, scale, 'format=yuv420p'].filter(Boolean).join(',');
  const audio = info.hasAudio ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : ['-an'];
  const base = ['-i', src, '-map', '0:v:0', ...(info.hasAudio ? ['-map', '0:a:0'] : []), '-vf', vf, '-g', '15', '-keyint_min', '15'];
  const tail = [...audio, '-movflags', '+faststart', out];
  try {
    await ffmpeg([...base, '-c:v', 'h264_videotoolbox', '-b:v', '4M', '-allow_sw', '1', ...tail], { duration: info.duration, onProgress, signal });
  } catch (e) {
    if (e.cancelled) throw e;
    await ffmpeg([...base, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', ...tail], { duration: info.duration, onProgress, signal });
  }
}

/** One JPEG frame at time t, optionally cropped and through LUTs (applied in order). */
export async function frameAt(src, t, out, { width = 480, luts = [], crop } = {}) {
  mkdirSync(dirname(out), { recursive: true });
  const vf = [crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}` : null, `scale=${width}:-2`, ...luts.filter(Boolean).map(l => `lut3d=file='${esc(l)}'`)].filter(Boolean).join(',');
  await run('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-ss', String(Math.max(0, t)), '-i', src, '-frames:v', '1', '-vf', vf, '-q:v', '4', out]);
  if (!existsSync(out)) throw new Error('No frame at that time.');
  return out;
}

/** Voice clean-up chain: rumble filter and a gentle compressor. */
export const POLISH = 'highpass=f=80,acompressor=threshold=-21dB:ratio=2.5:attack=8:release=120:makeup=2';

/** EBU R128 measurement of the source audio (after the polish chain, if on). */
export async function measureLoudness(src, { polish = true, target = -14, signal } = {}) {
  const af = [polish ? POLISH : null, `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`].filter(Boolean).join(',');
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostdin', '-nostats', '-i', src, '-vn', '-af', af, '-f', 'null', '-'], { signal });
  const m = stderr.match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!m) return null;
  const j = JSON.parse(m[0]);
  const num = k => Number(j[k]);
  if (!Number.isFinite(num('input_i')) || num('input_i') < -70) return null;
  return { I: num('input_i'), TP: num('input_tp'), LRA: num('input_lra'), thresh: num('input_thresh'), offset: num('target_offset') };
}

/** Times where the picture cuts (a camera change, a slide change). Run on the proxy: it's small. */
export async function detectScenes(src, { threshold = 0.35, signal } = {}) {
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error', '-i', src, '-an',
    '-vf', `scale=192:-2,select='gt(scene,${threshold})',metadata=print:file=-`, '-f', 'null', '-'], { signal });
  const out = [];
  for (const m of stdout.matchAll(/pts_time:([\d.]+)/g)) out.push(Number(m[1]));
  return out;
}

/**
  A path for use inside a single-quoted ffmpeg filter argument. Inside quotes
  ':' and ',' are literal; a quote can't be escaped reliably through both
  parsing levels, so those paths are refused (filter paths are our own caches).
*/
export function esc(p) {
  if (/['\\]/.test(p)) throw new Error(`Path can't be used in an ffmpeg filter: ${p}`);
  return String(p);
}
