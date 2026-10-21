/*
  Ingest: source → proxy → transcript → analysis → first storyboard.

    1. fetch    yt-dlp for URLs; local files are referenced in place
    2. probe    ffprobe: size, rate, rotation, HDR
    3. proxy    720p H.264 for the browser (HDR mapped to SDR)
    4. words    faster-whisper (or openai-whisper) word timestamps + loudness envelope
    5. analyze  speech threshold, scene cuts, loudness measurement
    6. plan     rule-based storyboard (shared/plan.mjs)

  Re-running ingest with keep: ['proxy'] re-transcribes without re-encoding.
*/
import { existsSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { PYTHON, CUTROOM, projectDir } from './paths.mjs';
import { run } from './proc.mjs';
import { probe, makeProxy, measureLoudness, detectScenes } from './media.mjs';
import { download, isUrl } from './ytdlp.mjs';
import { lutFile, inputLutId } from './luts.mjs';
import { loadProject, updateProject, writeJson, readJson } from './store.mjs';
import { startJob } from './jobs.mjs';
import { cleanWords } from '../shared/text.mjs';
import { speechThreshold } from '../shared/timeline.mjs';
import { plan } from '../shared/plan.mjs';

const STEPS = [
  { id: 'fetch', label: 'Fetching video', weight: 3 },
  { id: 'probe', label: 'Reading file', weight: 0.2 },
  { id: 'proxy', label: 'Making preview copy', weight: 3 },
  { id: 'words', label: 'Transcribing', weight: 6 },
  { id: 'analyze', label: 'Finding cuts and levels', weight: 1 },
  { id: 'plan', label: 'Planning the storyboard', weight: 0.2 },
];

export function startIngest(id, opts = {}) {
  const p = loadProject(id);
  const steps = STEPS.filter(s => s.id !== 'fetch' || isUrl(p.origin)).filter(s => !(opts.keepProxy && s.id === 'proxy'));
  return startJob(id, 'ingest', steps, job => ingest(id, job, opts));
}

async function ingest(id, job, { model = 'small.en', engine = 'faster', language = null, keepProxy = false } = {}) {
  const dir = projectDir(id);
  const { signal } = job;
  updateProject(id, p => { p.status = 'ingesting'; p.error = null; });
  try {
    let p = loadProject(id);

    // 1. Source file.
    let src = p.source?.path;
    if (!src || !existsSync(src)) {
      if (isUrl(p.origin)) {
        const tick = job.begin('fetch', `Downloading ${p.origin}`);
        src = await download(p.origin, join(dir, 'source'), { onProgress: tick, onLine: l => job.note(l), signal });
        if (p.name === p.id || /^https?/.test(p.name)) updateProject(id, q => { q.name = basename(src).replace(/-[\w-]{11}\.mp4$/, '').replace(/[_]+/g, ' '); });
      } else {
        src = resolve(String(p.origin || ''));
        if (!existsSync(src) || !statSync(src).isFile()) throw new Error(`File not found: ${p.origin}`);
      }
    }

    // 2. Probe.
    job.begin('probe');
    const info = await probe(src);
    if (!info.hasAudio) throw new Error('This file has no audio track. Cutroom edits by what is said, so it needs speech.');
    p = updateProject(id, q => { q.source = { path: src, ...info, mtime: statSync(src).mtimeMs }; });
    job.note(`${info.width}×${info.height} · ${info.fps} fps · ${info.duration.toFixed(1)}s${info.hdr ? ` · HDR (${info.hdr})` : ''}`);

    // 3. Proxy.
    const proxy = join(dir, 'proxy.mp4');
    if (!(keepProxy && existsSync(proxy))) {
      const tick = job.begin('proxy');
      const conv = inputLutId(p.source, p.settings);
      await makeProxy(src, proxy, info, { hdrLut: conv ? lutFile(conv) : null, onProgress: tick, signal });
    }

    // 4. Words.
    const tick = job.begin('words', `Transcribing with ${engine === 'openai' ? 'Whisper' : 'Faster-Whisper'} (${model})`);
    const tx = join(dir, 'transcript.json');
    await run(PYTHON, ['-I', join(CUTROOM, 'py', 'transcribe.py'), '--input', src, '--out', tx, '--engine', engine, '--model', model, ...(language ? ['--language', language] : [])], {
      signal,
      onLine: line => {
        if (!line.startsWith('{')) { if (/error|Error/.test(line)) job.note(line); return; }
        try { const m = JSON.parse(line); if (m.progress != null) tick(m.progress); if (m.stage) job.note(`${m.stage}${m.model ? ` ${m.model}` : ''}`); } catch { /* not ours */ }
      },
    });
    const raw = readJson(tx);

    // 5. Analysis.
    const tick5 = job.begin('analyze');
    const words = dropHallucinations(cleanWords(raw.words, info.duration), raw.envelope);
    const envelope = { ...raw.envelope, thr: speechThreshold(raw.envelope.db) };
    const scenes = await detectScenes(proxy, { signal }).catch(() => []);
    tick5(0.4);
    const loudness = { polish: await measureLoudness(src, { polish: true, target: p.settings.audio.loudness, signal }) };
    tick5(0.8);
    loudness.raw = await measureLoudness(src, { polish: false, target: p.settings.audio.loudness, signal });
    writeJson(join(dir, 'analysis.json'), { version: 1, engine: raw.engine, model: raw.model, language: raw.language, words, envelope, scenes, loudness, targetLoudness: p.settings.audio.loudness });
    job.note(`${words.length} words · ${scenes.length} picture cuts · ${loudness.polish ? `${loudness.polish.I.toFixed(1)} LUFS` : 'no loudness'}`);

    // 6. Plan.
    job.begin('plan');
    const board = plan(words, { settings: p.settings, scenes });
    updateProject(id, q => { q.storyboard = board; q.status = 'ready'; q.plannedAt = new Date().toISOString(); });
    return { words: words.length, ...board.stats };
  } catch (e) {
    updateProject(id, q => { q.status = q.storyboard ? 'ready' : 'error'; q.error = e.cancelled ? null : String(e.message || e); });
    throw e;
  }
}

/** Whisper sometimes "hears" words in dead silence. Drop low-confidence words with no sound under them. */
function dropHallucinations(words, env) {
  if (!env?.db?.length) return words;
  const thr = speechThreshold(env.db);
  const out = words.filter(w => {
    if (w.p > 0.5) return true;
    const a = Math.floor(w.start * env.rate), b = Math.max(a + 1, Math.ceil(w.end * env.rate));
    let peak = -99;
    for (let k = a; k < b && k < env.db.length; k++) peak = Math.max(peak, env.db[k]);
    return peak > thr;
  });
  return out.map((w, i) => ({ ...w, i }));
}
