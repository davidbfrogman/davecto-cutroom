#!/usr/bin/env node
/*
  Cutroom app server: the storyboard UI plus a small JSON API over the same
  pipeline the CLI uses. Local only (binds 127.0.0.1): it runs ffmpeg and
  reads files from your disk.

    npm start               → http://127.0.0.1:4100 (npm run dev restarts it when the code changes)
    CUTROOM_PORT=4200 npm start
    CUTROOM_HOME=/Volumes/Edit/Cutroom npm start

  Usually Claude starts it for you through the MCP server (mcp.mjs).
*/
import { createServer } from 'node:http';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { BRAND_FILE, BROLL, CUTROOM, DATA, HOME, MUSIC, PYTHON, USER_FONTS, YTDLP, ensureDirs, projectDir } from './lib/paths.mjs';
import { createProject, deleteProject, listProjects, loadAnalysis, loadProject, updateProject } from './lib/store.mjs';
import { startIngest } from './lib/ingest.mjs';
import { startRender } from './lib/render.mjs';
import { getJob, projectJob, startJob } from './lib/jobs.mjs';
import { listLuts, lutFile, inputLutId } from './lib/luts.mjs';
import { esc, frameAt, probe } from './lib/media.mjs';
import { download, isUrl } from './lib/ytdlp.mjs';
import { run } from './lib/proc.mjs';
import { depsReport, playwright } from './lib/deps.mjs';
import { safeJoin, sendFile, serveMounted } from './lib/static.mjs';
import { plan, withDefaults } from './shared/plan.mjs';
import { addMessage, addThread, applyClaudeOps, bus, claudeState, commitEdit, deleteThread, sendNotes, setThread, touchClaude, waitForNotes } from './lib/collab.mjs';
import { createMotion, lintMotion, listMotions, renderMotion } from './lib/motion.mjs';
import { matteKey, previewCutout, startPreviewCutout, stillCutout } from './lib/cutout.mjs';
import { cropRectEven } from './shared/framing.mjs';
import { outputSize } from './shared/timeline.mjs';
import { BUNDLED_FONTS, USER_FONT_RE, fontLabel, pickBrand, resolveBrand } from './shared/brand.mjs';

const PORT = Number(process.env.CUTROOM_PORT || 4100);
const VERSION = JSON.parse(readFileSync(join(CUTROOM, 'package.json'), 'utf8')).version;
const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|mts)$/i;
const AUDIO_EXT = /\.(mp3|m4a|wav|aac|ogg|flac)$/i;

ensureDirs();

/* ---------- helpers ---------- */

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function body(req, limit = 20e6) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Request too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Bad JSON'); }
}

const safeName = n => basename(String(n || 'video.mp4')).replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'video.mp4';

/** Files the UI may stream: anything under Cutroom's home, or a project's source video. */
function allowedMedia(p) {
  const abs = resolve(p);
  return abs.startsWith(HOME + sep) || [...projectSources()].includes(abs);
}
function* projectSources() {
  for (const p of listProjects()) {
    try { const q = loadProject(p.id); if (q.source?.path) yield resolve(q.source.path); } catch { /* skip */ }
  }
}

/* ---------- tool check ---------- */

let health = null;
async function checkHealth() {
  const out = { home: HOME, data: DATA, python: PYTHON, tools: {} };
  const probeTool = async (name, cmd, args, pick = s => s.split('\n')[0]) => {
    try { const r = await run(cmd, args); out.tools[name] = { ok: true, version: pick(r.stdout || r.stderr).trim() }; }
    catch (e) { out.tools[name] = { ok: false, error: e.message.split('\n')[0] }; }
  };
  await Promise.all([
    probeTool('ffmpeg', 'ffmpeg', ['-hide_banner', '-version'], s => s.split('\n')[0].replace('ffmpeg version ', '').split(' ')[0]),
    probeTool('faster-whisper', PYTHON, ['-c', 'import faster_whisper; print(faster_whisper.__version__)']),
    probeTool('whisper', PYTHON, ['-c', 'import whisper; print(whisper.__version__)']),
    probeTool('yt-dlp', YTDLP, ['--version']),
    (async () => {
      try {
        const { chromium } = playwright();
        const ok = existsSync(chromium.executablePath()) || existsSync('/Applications/Google Chrome.app');
        out.tools.playwright = ok ? { ok, version: 'Chromium ready' } : { ok, error: 'Chromium for graphics is not installed (run setup)' };
      }
      catch (e) { out.tools.playwright = { ok: false, error: e.message }; }
    })(),
  ]);
  const deps = depsReport();
  out.tools.hyperframes = deps.hyperframes && deps.gsap ? { ok: true, version: 'installed' } : { ok: false, error: 'HyperFrames and GSAP are not installed (run setup)' };
  const f = out.tools.ffmpeg;
  if (f.ok) {
    const { stdout } = await run('ffmpeg', ['-hide_banner', '-filters']);
    const need = ['lut3d', 'xfade', 'acrossfade', 'sidechaincompress', 'alimiter', 'overlay'];
    const missing = need.filter(n => !new RegExp(`\\s${n}\\s`).test(stdout));
    if (missing.length) { f.ok = false; f.error = `ffmpeg is missing filters: ${missing.join(', ')}`; }
  }
  health = out;
  return out;
}

/* ---------- thumbnails (queued: a storyboard asks for dozens at once) ---------- */

const thumbQueue = [];
let thumbsRunning = 0;
function queued(fn) {
  return new Promise((res, rej) => {
    thumbQueue.push({ fn, res, rej });
    pump();
  });
}
function pump() {
  while (thumbsRunning < 4 && thumbQueue.length) {
    const { fn, res, rej } = thumbQueue.shift();
    thumbsRunning++;
    fn().then(res, rej).finally(() => { thumbsRunning--; pump(); });
  }
}

async function frame(req, res, id, q) {
  const p = loadProject(id);
  const proxy = join(projectDir(id), 'proxy.mp4');
  if (!existsSync(proxy)) throw new HttpError(404, 'No preview yet');
  const t = Math.max(0, Math.min(p.source.duration - 0.05, Number(q.get('t')) || 0));
  const width = Math.min(1080, Math.max(64, Number(q.get('w')) || 240));
  const lut = q.get('lut') ?? (p.settings.lut?.id || 'none');
  const k = q.has('k') ? Number(q.get('k')) : p.settings.lut?.intensity ?? 1;
  let crop = null;
  if (q.get('crop') !== '0') {
    const pi = await probeProxy(id, proxy);
    const { width: W, height: H } = outputSize(q.get('aspect') || p.settings.aspect, 1080);
    crop = cropRectEven(pi.width, pi.height, W, H, Number(q.get('z')) || 1, Number(q.get('fx') ?? p.settings.framing.fx), Number(q.get('fy') ?? p.settings.framing.fy));
  }
  // HDR is already mapped to SDR in the proxy; a manual conversion (Apple Log) isn't.
  const conv = p.source?.hdr ? null : inputLutId(p.source, p.settings);
  const luts = [conv ? lutFile(conv) : null, lut && lut !== 'none' ? lutFile(lut, k) : null].filter(Boolean);
  // cutout=1: just the speaker, as a PNG with the matte as alpha (to lay over an animation).
  const cut = q.get('cutout') === '1';
  const key = createHash('sha1').update(JSON.stringify([t.toFixed(2), width, crop, luts, statSync(proxy).mtimeMs, cut ? matteKey() : 0])).digest('hex').slice(0, 16);
  const out = join(projectDir(id), 'cache', 'thumbs', `${key}.${cut ? 'png' : 'jpg'}`);
  if (!existsSync(out) && cut) {
    const pi = await probeProxy(id, proxy);
    const c = crop || { x: 0, y: 0, w: pi.width, h: pi.height };
    const h = Math.round((width * c.h) / c.w / 2) * 2;
    const vf = [crop ? `crop=${c.w}:${c.h}:${c.x}:${c.y}` : null, `scale=${width}:${h}`, ...luts.map(l => `lut3d=file='${esc(l)}'`)].filter(Boolean).join(',');
    mkdirSync(join(projectDir(id), 'cache', 'thumbs'), { recursive: true });
    await stillCutout(proxy, t, out, { width, height: h, vf });
  } else if (!existsSync(out)) await queued(() => frameAt(proxy, t, out, { width, luts, crop }));
  res.setHeader('Cache-Control', 'max-age=3600');
  sendFile(req, res, out);
}

const proxyInfo = new Map();
async function probeProxy(id, file) {
  const m = statSync(file).mtimeMs;
  const c = proxyInfo.get(id);
  if (c && c.m === m) return c.info;
  const info = await probe(file);
  proxyInfo.set(id, { m, info });
  return info;
}

/* ---------- library: B-roll and music you can pick ---------- */

function library(id) {
  const broll = [];
  const add = (dir, source) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) if (VIDEO_EXT.test(f) && !f.includes('.part.')) broll.push({ file: join(dir, f), name: f, source });
  };
  if (id) add(join(projectDir(id), 'broll'), 'This project');
  add(BROLL, 'Cutroom library');
  const music = [];
  const addMusic = dir => { if (existsSync(dir)) for (const f of readdirSync(dir)) if (AUDIO_EXT.test(f)) music.push({ file: join(dir, f), name: f }); };
  addMusic(MUSIC);
  return { broll, music };
}

/* ---------- routes ---------- */

async function api(req, res, path, q) {
  const m = path.match(/^\/api\/projects\/([a-z0-9-]+)(\/.*)?$/);
  const method = req.method;

  if (path === '/api/health') return json(res, health || await checkHealth());
  if (path === '/api/version') return json(res, { version: VERSION, root: CUTROOM });
  if (path === '/api/shutdown' && method === 'POST') { json(res, { ok: true }); setTimeout(() => process.exit(0), 100); return; }
  if (path === '/api/luts') return json(res, listLuts());
  const lm = path.match(/^\/api\/luts\/(.+)\.cube$/);
  if (lm) {
    const f = lutFile(decodeURIComponent(lm[1]), Number(q.get('k') ?? 1));
    if (!f) throw new HttpError(404, 'No LUT');
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'max-age=600' });
    return res.end(readFileSync(f));
  }
  if (path === '/api/library') return json(res, library(q.get('project')));
  if (path === '/api/fonts') {
    const user = existsSync(USER_FONTS) ? readdirSync(USER_FONTS).filter(f => USER_FONT_RE.test(f) && !f.startsWith('.')).sort() : [];
    return json(res, { dir: USER_FONTS, fonts: [...BUNDLED_FONTS.map(f => ({ id: f.id, label: f.label })), ...user.map(f => ({ id: `user/${f}`, label: fontLabel(`user/${f}`), user: true }))] });
  }
  // The user's default brand (colours, fonts, captions, look): new projects start with it.
  if (path === '/api/brand' && method === 'GET') return json(res, existsSync(BRAND_FILE) ? JSON.parse(readFileSync(BRAND_FILE, 'utf8')) : {});
  if (path === '/api/brand' && method === 'PUT') {
    const b = pickBrand(withDefaults(await body(req)));
    writeFileSync(BRAND_FILE, JSON.stringify(b, null, 2) + '\n');
    return json(res, b);
  }
  if (path === '/api/claude/wait') {
    // Long poll for wait_for_notes. Resolves when notes are sent, or after the timeout.
    const project = q.get('project') || null;
    const ms = Math.min(15 * 60, Math.max(5, Number(q.get('timeout')) || 300)) * 1000;
    const r = await waitForNotes(project, ms, cancel => req.on('close', cancel));
    if (!res.destroyed) json(res, r || { project, notes: [], timeout: true });
    return;
  }
  if (path === '/api/claude/seen' && method === 'POST') { touchClaude(q.get('project') || null); return json(res, { ok: true }); }
  if (path === '/api/media') {
    const f = q.get('path');
    if (!f || !allowedMedia(f)) throw new HttpError(403, 'Not allowed');
    return sendFile(req, res, resolve(f));
  }
  if (path === '/api/reveal' && method === 'POST') {
    const { path: f } = await body(req);
    if (!f || !allowedMedia(f) || !existsSync(f)) throw new HttpError(403, 'Not allowed');
    spawn('open', ['-R', resolve(f)], { stdio: 'ignore', detached: true }).unref();
    return json(res, { ok: true });
  }

  const jm = path.match(/^\/api\/jobs\/([\w-]+)(\/events|\/cancel)?$/);
  if (jm) {
    const job = getJob(jm[1]);
    if (!job) throw new HttpError(404, 'No such job');
    if (jm[2] === '/cancel') { job.cancel(); return json(res, job.snapshot()); }
    if (jm[2] === '/events') return events(req, res, job);
    return json(res, job.snapshot());
  }

  if (path === '/api/projects' && method === 'GET') return json(res, listProjects());
  if (path === '/api/projects' && method === 'POST') {
    const b = await body(req);
    const origin = String(b.origin || '').trim().replace(/^file:\/\//, '').replace(/^['"]|['"]$/g, '');
    if (!origin) throw new HttpError(400, 'Give a file path or a URL');
    if (!isUrl(origin) && !existsSync(resolve(origin))) throw new HttpError(400, `File not found: ${origin}`);
    const p = createProject({ name: b.name || (isUrl(origin) ? origin : basename(origin)), origin: isUrl(origin) ? origin : resolve(origin) });
    if (b.aspect) updateProject(p.id, x => { x.settings.aspect = b.aspect; });
    const job = startIngest(p.id, { model: b.model, engine: b.engine, language: b.language });
    return json(res, { project: loadProject(p.id), job: job.snapshot() }, 201);
  }
  if (path === '/api/projects/upload' && method === 'POST') {
    const name = safeName(q.get('name'));
    const p = createProject({ name, origin: null });
    const dest = join(projectDir(p.id), 'source', name);
    await pipeline(req, createWriteStream(dest));
    updateProject(p.id, x => { x.origin = dest; if (q.get('aspect')) x.settings.aspect = q.get('aspect'); });
    const job = startIngest(p.id, { model: q.get('model') || undefined, engine: q.get('engine') || undefined });
    return json(res, { project: loadProject(p.id), job: job.snapshot() }, 201);
  }

  if (!m) throw new HttpError(404, 'Not found');
  const id = m[1], sub = m[2] || '';

  if (sub === '' && method === 'GET') {
    const p = loadProject(id);
    const j = projectJob(id);
    return json(res, { project: p, job: j ? j.snapshot() : null, hasProxy: existsSync(join(projectDir(id), 'proxy.mp4')), dir: projectDir(id) });
  }
  if (sub === '' && method === 'PUT') {
    const b = await body(req);
    const cur = loadProject(id);
    // Saved on top of an older version (Claude edited meanwhile): refuse, send back the current one.
    if (b.rev != null && b.rev !== (cur.rev || 0)) return json(res, { error: 'Changed since you loaded it', project: cur }, 409);
    if (b.storyboard && (!Array.isArray(b.storyboard.shots) || !Array.isArray(b.storyboard.sections))) throw new HttpError(400, 'Bad storyboard');
    const p = commitEdit(id, x => {
      if (typeof b.name === 'string') x.name = b.name.slice(0, 120);
      if (b.settings) x.settings = withDefaults(b.settings);
      if (b.storyboard) x.storyboard = b.storyboard;
    }, { by: b.client || 'editor' });
    return json(res, { project: p, rev: p.rev });
  }
  if (sub === '' && method === 'DELETE') {
    const j = projectJob(id);
    if (j?.status === 'running') j.cancel();
    deleteProject(id);
    return json(res, { ok: true });
  }
  if (sub === '/analysis') {
    const a = loadAnalysis(id);
    if (!a) throw new HttpError(404, 'Not transcribed yet');
    return json(res, { words: a.words, envelope: a.envelope, scenes: a.scenes, model: a.model, engine: a.engine, language: a.language });
  }
  if (sub === '/plan' && method === 'POST') {
    const b = await body(req);
    const a = loadAnalysis(id);
    if (!a) throw new HttpError(400, 'Not transcribed yet');
    const p = commitEdit(id, x => {
      if (b.settings) x.settings = withDefaults(b.settings);
      x.storyboard = plan(a.words, { settings: x.settings, scenes: a.scenes });
      x.plannedAt = new Date().toISOString();
    }, { by: b.client || 'editor' });
    return json(res, { project: p });
  }
  if (sub === '/ingest' && method === 'POST') {
    const b = await body(req);
    return json(res, { job: startIngest(id, { model: b.model, engine: b.engine, language: b.language, keepProxy: b.keepProxy !== false }).snapshot() });
  }
  if (sub === '/render' && method === 'POST') {
    const b = await body(req);
    if (b.by === 'claude') touchClaude(id);
    return json(res, { job: startRender(id, { preview: !!b.preview }).snapshot() });
  }
  if (sub === '/proxy.mp4') return sendFile(req, res, join(projectDir(id), 'proxy.mp4'));
  if (sub === '/frame') return frame(req, res, id, q);
  const em = sub.match(/^\/exports\/(.+)$/);
  if (em) {
    const f = safeJoin(join(projectDir(id), 'exports'), em[1]);
    return sendFile(req, res, f, { download: q.has('download') ? basename(f || '') : null });
  }
  if (sub === '/broll' && method === 'POST') {
    const b = await body(req);
    if (!isUrl(b.url)) throw new HttpError(400, 'Give a video URL');
    const dir = join(projectDir(id), 'broll');
    mkdirSync(dir, { recursive: true });
    const section = b.from != null && b.to != null ? `*${Number(b.from)}-${Number(b.to)}` : null;
    const job = startJob(id, 'broll', [{ id: 'fetch', label: 'Downloading B-roll', weight: 1 }], async j => {
      const tick = j.begin('fetch', `Downloading ${b.url}`);
      const file = await download(b.url, dir, { section, onProgress: tick, onLine: l => j.note(l), signal: j.signal });
      return { file, name: basename(file) };
    });
    return json(res, { job: job.snapshot() });
  }
  if (sub === '/broll/upload' && method === 'POST') {
    const dir = join(projectDir(id), 'broll');
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, safeName(q.get('name')));
    await pipeline(req, createWriteStream(dest));
    return json(res, { file: dest, name: basename(dest) });
  }
  /* ----- live updates, notes and Claude ----- */
  if (sub === '/events') return projectEvents(req, res, id);
  if (sub === '/ops' && method === 'POST') {
    const b = await body(req);
    if (!Array.isArray(b.ops) || !b.ops.length) throw new HttpError(400, 'Send { ops: [...] }');
    return json(res, applyClaudeOps(id, b.ops));
  }
  if (sub === '/threads' && method === 'GET') return json(res, { threads: loadProject(id).threads || [], claude: claudeState(id) });
  if (sub === '/threads' && method === 'POST') {
    const b = await body(req);
    if (!String(b.text || '').trim()) throw new HttpError(400, 'Write a note first');
    return json(res, { thread: addThread(id, { shot: b.shot || null, text: b.text, from: b.from === 'claude' ? 'claude' : 'you' }) }, 201);
  }
  const tm = sub.match(/^\/threads\/([\w-]+)(\/messages)?$/);
  if (tm && tm[2] && method === 'POST') {
    const b = await body(req);
    return json(res, { thread: addMessage(id, tm[1], { text: b.text, from: b.from === 'claude' ? 'claude' : 'you', status: b.status, changes: b.changes }) });
  }
  if (tm && !tm[2] && method === 'PATCH') return json(res, { thread: setThread(id, tm[1], await body(req)) });
  if (tm && !tm[2] && method === 'DELETE') { deleteThread(id, tm[1]); return json(res, { ok: true }); }
  if (sub === '/send' && method === 'POST') return json(res, { sent: sendNotes(id), claude: claudeState(id) });

  /* ----- animations (HyperFrames) ----- */
  if (sub === '/motions' && method === 'GET') return json(res, { motions: listMotions(id).map(({ dir, ...m }) => ({ ...m, path: dir })) });
  if (sub === '/motions' && method === 'POST') {
    const b = await body(req);
    const m = createMotion(id, b.name, { from: b.from, scope: b.scope });
    return json(res, { motion: { ...m, path: m.dir } }, 201);
  }
  if (sub === '/motions/render' && method === 'POST') {
    const b = await body(req);
    const p = loadProject(id);
    const size = outputSize(p.settings.aspect, b.preview ? 540 : p.settings.resolution || 1080);
    // The editor sends the brand it's showing (it may not have saved yet); otherwise the project's.
    const brand = resolveBrand(b.brand ? { theme: b.brand.theme, brand: b.brand.brand } : p.settings);
    const r = await serial(id, () => renderMotion(id, b.name, { width: b.width || size.width, height: b.height || size.height, fps: p.settings.fps || 30, vars: b.vars || {}, brand }));
    return json(res, { key: r.key, duration: r.duration, width: r.width, height: r.height, blend: r.blend, url: `/api/projects/${id}/motion/${r.key}.webm`, file: r.file });
  }
  if (sub === '/motions/lint' && method === 'POST') {
    const b = await body(req);
    const p = loadProject(id);
    const size = outputSize(p.settings.aspect, 1080);
    return json(res, { report: await lintMotion(id, b.name, { ...size, brand: resolveBrand(p.settings) }) });
  }
  const mm = sub.match(/^\/motion\/([a-f0-9]{16})\.webm$/);
  if (mm) return sendFile(req, res, join(projectDir(id), 'cache', 'motion', `${mm[1]}.webm`));

  /* ----- cutouts: the proxy with the speaker's matte underneath, for the preview ----- */
  if (sub === '/cutout') {
    const c = method === 'POST' ? startPreviewCutout(id) : previewCutout(id);
    return json(res, { state: c.state, progress: c.progress, error: c.error || null, url: c.state === 'ready' ? `/api/projects/${id}/cutout.mp4?v=${statSync(c.file).mtimeMs}` : null });
  }
  if (sub === '/cutout.mp4') {
    const c = previewCutout(id);
    if (c.state !== 'ready') throw new HttpError(404, 'No cutout yet');
    return sendFile(req, res, c.file);
  }

  if (sub === '/conversion') {
    const p = loadProject(id);
    return json(res, { id: inputLutId(p.source, p.settings) });
  }
  throw new HttpError(404, 'Not found');
}

function events(req, res, job) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  let timer = null, pending = null;
  const send = s => res.write(`data: ${JSON.stringify(s)}\n\n`);
  const update = s => {
    pending = s;
    if (timer) return;
    timer = setTimeout(() => { timer = null; send(pending); }, 120);
  };
  const end = s => { clearTimeout(timer); send(s); res.end(); cleanup(); };
  const cleanup = () => { job.off('update', update); job.off('end', end); };
  send(job.snapshot());
  if (job.status !== 'running') { res.end(); return; }
  job.on('update', update);
  job.on('end', end);
  req.on('close', cleanup);
}

/** Server-sent events for an open editor: storyboard changes, notes, Claude's state. */
function projectEvents(req, res, id) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = e => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const p = loadProject(id);
  send({ type: 'hello', rev: p.rev || 0, claude: claudeState(id, p) });
  bus.on(id, send);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { bus.off(id, send); clearInterval(ping); });
}

/** One HyperFrames render at a time per project (each launches Chrome workers). */
const queues = new Map();
function serial(id, fn) {
  const next = (queues.get(id) || Promise.resolve()).then(fn, fn);
  queues.set(id, next.catch(() => {}));
  return next;
}

/* ---------- server ---------- */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  try {
    if (path === '/' || path === '/index.html') { res.writeHead(302, { Location: '/ui/' }); return res.end(); }
    if (path === '/favicon.ico') return sendFile(req, res, join(CUTROOM, 'ui', 'favicon.svg'));
    if (path.startsWith('/api/')) return await api(req, res, path, url.searchParams);
    if (serveMounted(req, res, path)) return;
    res.writeHead(404).end('Not found');
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    if (!res.headersSent) json(res, { error: e.message }, status);
    else res.end();
  }
});

// Projects left mid-job by a previous run are not running any more.
for (const p of listProjects()) {
  if (p.status === 'ingesting' || p.status === 'rendering') {
    updateProject(p.id, x => { x.status = x.storyboard ? 'ready' : 'error'; x.error = x.storyboard ? null : 'Interrupted. Start the import again.'; });
  }
}

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`Cutroom  ${url}\nProjects ${HOME}`);
  checkHealth().then(h => {
    for (const [k, v] of Object.entries(h.tools)) if (!v.ok && k !== 'whisper') console.log(`  ! ${k}: ${v.error}`);
  });
  // npm run dev runs under node --watch, which restarts this process when Cutroom's code changes.
  // The watcher (our parent) stays the same across restarts, so open the browser once per watcher.
  const marker = join(HOME, '.opened-by');
  const opened = existsSync(marker) && readFileSync(marker, 'utf8') === String(process.ppid);
  if (process.argv.includes('--open') && !opened) {
    writeFileSync(marker, String(process.ppid));
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
  }
});

