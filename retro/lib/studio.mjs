/* Retro Studio: one local server for every retro project. Plain node:http, no dependencies.
     /                       the projects page (studio/)
     /p/<name>/…             one project's editor (preview/) and its API: state, beat edits, video, cutout
     /api/projects           the cards: every *-retro folder in the videos folder, plus ones added from elsewhere
     /api/jobs, /api/events  long tasks (new, transcribe, lint, frames, render) run as child processes
                             (lib/job.mjs, the same lib functions the CLI calls); progress streams over SSE.
                             One render (or contact sheet, which renders overlays too) at a time; the rest queue.
   Paths: RETRO_VIDEOS = the videos folder (default: video/ next to retro/); RETRO_STUDIO_STATE = where projects
   added from elsewhere are remembered; RETRO_TRASH = a folder to use as the Trash (tests). */
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, normalize, resolve } from 'node:path';
import { previewCut, startPreviewCut } from './cutout.mjs';
import { duration, Project, RETRO } from './project.mjs';

/** What the page and this server agree on. Bump it whenever /api/beat learns a new kind of edit: a page
    that sees a different number warns that its edits may not save. */
export const API = 5;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const DATA = join(homedir(), 'Library', 'Application Support', 'Cutroom');
export const VIDEOS = resolve(process.env.RETRO_VIDEOS || join(RETRO, '..', 'video'));
const STATE = process.env.RETRO_STUDIO_STATE || join(DATA, 'retro-studio.json');
const TRASH = process.env.RETRO_TRASH || join(homedir(), '.Trash');

/* ---------- http helpers ---------- */
function sendFile(req, res, file) {
  if (!file || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  const size = statSync(file).size, type = TYPES[extname(file)] || 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1 });
    return createReadStream(file, { start: a, end: b }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}
const json = (res, v, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(v)); };
const body = req => new Promise((ok, no) => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { no(e); } }); });
/** A file directly inside dir (no sub-folders, no ..). */
const inside = (dir, name) => { const f = normalize(join(dir, name)); return dirname(f) === normalize(dir) && existsSync(f) ? f : null; };
const ffmpeg = args => new Promise((ok, no) => { const p = spawn('ffmpeg', args, { stdio: 'ignore' }); p.on('close', c => (c === 0 ? ok() : no(new Error('ffmpeg failed')))); p.on('error', no); });

/* ---------- projects ---------- */
const remembered = () => { try { return JSON.parse(readFileSync(STATE, 'utf8')).extra || []; } catch { return []; } };
function remember(dir, keep = true) {
  const extra = remembered().filter(d => d !== dir && existsSync(join(d, 'retro.json')));
  if (keep && !dir.startsWith(VIDEOS + '/')) extra.push(dir);
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify({ extra }, null, 2) + '\n');
}
/** name → folder. Names are the folder names (a second one with the same name gets ~2). */
function projects() {
  const dirs = existsSync(VIDEOS) ? readdirSync(VIDEOS).filter(d => d.endsWith('-retro')).map(d => join(VIDEOS, d)).filter(d => existsSync(join(d, 'retro.json'))) : [];
  for (const d of remembered()) if (existsSync(join(d, 'retro.json')) && !dirs.includes(d)) dirs.push(d);
  const out = new Map();
  for (const d of dirs) { let n = basename(d); for (let i = 2; out.has(n); i++) n = `${basename(d)}~${i}`; out.set(n, d); }
  return out;
}
const nameOf = dir => [...projects()].find(([, d]) => d === dir)?.[0];

const lengths = new Map();                              // video → [mtime, seconds]
function lengthOf(video) {
  try {
    const m = statSync(video).mtimeMs, c = lengths.get(video);
    if (c && c[0] === m) return c[1];
    const s = duration(video); lengths.set(video, [m, s]); return s;
  } catch { return null; }
}
const mtime = f => (existsSync(f) ? statSync(f).mtimeMs : 0);
/** When the project's sources last changed: retro.json or any beat. */
function edited(p) { return Math.max(mtime(p.file), ...p.beatIds().map(id => mtime(join(p.dir, 'beats', id, 'index.html')))); }
export const renderFile = (p, draft) => join(p.out, `${basename(p.video, extname(p.video))}-retro${draft ? '-draft' : ''}.mp4`);

function card(name, dir) {
  const p = new Project(dir), ed = edited(p), ids = p.beatIds();
  const lint = (() => { try { const l = JSON.parse(readFileSync(join(p.out, '.lint.json'), 'utf8')); return { count: l.issues.length, at: l.at, stale: ed > l.at }; } catch { return null; } })();
  const render = draft => { const f = renderFile(p, draft); return existsSync(f) ? { file: basename(f), at: mtime(f), stale: ed > mtime(f) } : null; };
  return { name, dir, video: p.video, videoName: basename(p.video), videoMissing: !existsSync(p.video), length: lengthOf(p.video),
    beats: ids.length, on: ids.filter(id => p.on(id)).length, edited: ed,
    words: existsSync(join(dir, 'words.json')), faces: existsSync(join(dir, 'faces.json')),
    lint, draft: render(true), final: render(false), sheet: existsSync(join(p.out, 'check-all.jpg')) ? mtime(join(p.out, 'check-all.jpg')) : null };
}

/** Move a project folder to the Trash. Never the source video: if it lives inside the folder, refuse. */
function trash(dir) {
  const p = new Project(dir);
  if (p.video.startsWith(dir + '/')) throw new Error(`The source video is inside ${basename(dir)}, so it isn't deleted from here. Move the video out first.`);
  mkdirSync(TRASH, { recursive: true });
  let to = join(TRASH, basename(dir));
  for (let i = 2; existsSync(to); i++) to = join(TRASH, `${basename(dir)} ${i}`);
  renameSync(dir, to);
  remember(dir, false);                                 // drops it from the list of projects added from elsewhere
  return to;
}

/* ---------- per-project media (light copy, filmstrip, thumbnail), made in the background ---------- */
const media = new Map();                                 // dir → { light: Promise, strip }
function lightCopy(p) {
  const out = join(p.out, '.preview.mp4');
  if (existsSync(out) && mtime(out) > mtime(p.video)) return Promise.resolve(out);
  console.log(`… ${basename(p.dir)}: making a light preview copy of the video (once)`);
  const tmp = join(p.out, '.preview.part.mp4');
  return ffmpeg(['-v', 'error', '-y', '-i', p.video, '-vf', 'scale=720:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
    '-g', '15', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', tmp]).then(() => { renameSync(tmp, out); return out; });
}
/* The filmstrip on the timeline: one small frame every `every` seconds, in one row (a sprite), made once
   from the light copy and cached next to it. */
const TH = 120;                                          // frame height in the sprite (2× the row, for sharp screens)
function filmstrip(p, light, len) {
  const every = Math.max(0.5, Math.ceil(len / 400 * 10) / 10), n = Math.ceil(len / every);
  const file = join(p.out, `.thumbs-${every}.jpg`);
  const ready = light.then(l => (existsSync(file) && mtime(file) > mtime(l) ? file
    : ffmpeg(['-v', 'error', '-y', '-i', l, '-vf', `fps=1/${every}:start_time=0,scale=-2:${TH},tile=${n}x1`, '-frames:v', '1', '-q:v', '5', file]).then(() => file)));
  ready.catch(e => console.error(e.message));
  return { every, n, h: TH, ready };
}
function mediaOf(p) {
  let m = media.get(p.dir);
  if (!m || m.video !== mtime(p.video)) {
    const light = lightCopy(p); light.catch(e => console.error(e.message));
    const len = duration(p.video);
    m = { video: mtime(p.video), len, light, strip: filmstrip(p, light, len) };
    media.set(p.dir, m);
  }
  return m;
}
const thumbs = new Map();
function thumb(p) {
  const f = join(p.out, '.card.jpg');
  if (existsSync(f) && mtime(f) > mtime(p.video)) return Promise.resolve(f);
  if (!thumbs.has(p.dir)) {
    const t = ffmpeg(['-v', 'error', '-y', '-ss', String(Math.min(2, (lengthOf(p.video) || 2) / 3)), '-i', p.video, '-frames:v', '1', '-vf', 'scale=-2:480', '-q:v', '4', f]).then(() => f);
    t.finally(() => thumbs.delete(p.dir)).catch(() => {});
    thumbs.set(p.dir, t);
  }
  return thumbs.get(p.dir);
}

/* ---------- jobs ---------- */
const SERIAL = new Set(['render', 'frames']);            // heavy: one at a time, the rest wait
const LABEL = { new: 'New project', transcribe: 'Transcribe', lint: 'Lint', frames: 'Contact sheet', render: 'Render' };
const jobs = new Map(); let seq = 0;
const clients = new Set();
function emit(event, data) { const s = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); }
const pub = j => ({ id: j.id, kind: j.kind, draft: j.draft, project: j.project, label: j.label, state: j.state, bar: j.bar, log: j.log.slice(-60), result: j.result, error: j.error,
  created: j.created, started: j.started, ended: j.ended, queued: j.state === 'queued' ? [...jobs.values()].filter(x => x.state === 'queued' && SERIAL.has(x.kind) && x.created < j.created).length : 0 });
function changed(j, now = false) {                       // tell the pages, at most ~5 times a second per job
  if (now) { clearTimeout(j.t); j.t = null; j.sent = Date.now(); emit('job', pub(j)); return; }
  if (j.t) return;
  j.t = setTimeout(() => { j.t = null; j.sent = Date.now(); emit('job', pub(j)); }, Math.max(0, 200 - (Date.now() - (j.sent || 0))));
}
export const running = () => [...jobs.values()].filter(j => j.state === 'running').length;

function addJob(kind, { project, dir, draft = false, video } = {}) {
  const same = [...jobs.values()].find(j => j.kind === kind && j.dir === dir && !!j.draft === !!draft && (j.state === 'queued' || j.state === 'running'));
  if (same && dir) return same;
  const j = { id: String(++seq), kind, draft, project, dir, video, label: `${LABEL[kind]}${kind === 'render' ? (draft ? ' draft' : ' final') : ''}`,
    state: 'queued', bar: null, log: [], result: null, error: null, created: Date.now() };
  jobs.set(j.id, j);
  changed(j, true); pump();
  return j;
}
function pump() {
  const busy = [...jobs.values()].some(j => j.state === 'running' && SERIAL.has(j.kind));
  for (const j of [...jobs.values()].filter(j => j.state === 'queued').sort((a, b) => a.created - b.created)) {
    if (SERIAL.has(j.kind)) { if (busy || [...jobs.values()].some(x => x.state === 'running' && SERIAL.has(x.kind))) continue; }
    start(j);
  }
  for (const j of jobs.values()) if (j.state === 'queued') changed(j);   // places in the queue moved
}
function start(j) {
  j.state = 'running'; j.started = Date.now();
  const args = { dir: j.dir, draft: j.draft, video: j.video };
  const c = spawn(process.execPath, [join(RETRO, 'lib', 'job.mjs'), j.kind, JSON.stringify(args)],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: true, env: { ...process.env, RETRO_JOB: '1' } });
  j.child = c;
  const lines = () => { let buf = ''; return d => { const parts = (buf + d).split(/\r\n|\r|\n/); buf = parts.pop(); for (const l of parts) if (l.trim()) { j.log.push(l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')); if (j.log.length > 400) j.log.shift(); } changed(j); }; };
  c.stdout.setEncoding('utf8').on('data', lines()); c.stderr.setEncoding('utf8').on('data', lines());
  c.on('message', m => {
    if (m.t === 'bar') j.bar = { label: m.label, frac: m.frac, note: m.note };
    else if (m.t === 'project') { j.dir = m.dir; remember(m.dir); j.project = nameOf(m.dir); emit('projects', {}); }
    else if (m.t === 'result') j.result = m.result;
    else if (m.t === 'error') j.error = m.message;
    changed(j);
  });
  c.on('close', code => {
    j.child = null; j.ended = Date.now();
    if (j.state === 'running') j.state = code === 0 && !j.error ? 'done' : 'error';
    if (j.state === 'error' && !j.error) j.error = j.log.slice(-3).join('\n') || `stopped (exit ${code})`;
    if (j.state === 'cancelled' && j.kind === 'render') {   // a cancelled export leaves half a file: don't let it pass for a render
      const f = renderFile(new Project(j.dir), j.draft);
      if (existsSync(f) && mtime(f) >= j.started) try { renameSync(f, f.replace(/\.mp4$/, '.cancelled.mp4')); } catch {}
    }
    changed(j, true); emit('projects', {}); pump();
  });
}
function cancel(j) {
  if (j.state === 'queued') { j.state = 'cancelled'; j.ended = Date.now(); changed(j, true); pump(); return; }
  if (j.state !== 'running' || !j.child) return;
  j.state = 'cancelled';
  try { process.kill(-j.child.pid, 'SIGTERM'); } catch { j.child.kill('SIGTERM'); }
  changed(j, true);
}
function stopAll() { for (const j of jobs.values()) if (j.child) try { process.kill(-j.child.pid, 'SIGTERM'); } catch {} }

/* ---------- one project's routes: /p/<name>/<sub> ---------- */
const EDITOR = join(RETRO, 'preview');
async function projectRoute(req, res, name, dir, sub, url) {
  const p = new Project(dir);                            // re-read retro.json each request (hand edits win)
  if (sub === '') return sendFile(req, res, join(EDITOR, 'index.html'));
  if (sub === 'synth.mjs') return sendFile(req, res, join(RETRO, 'lib', 'synth.mjs'));
  if (sub === 'thumb.jpg') return sendFile(req, res, await thumb(p).catch(() => null));
  if (sub.startsWith('out/')) { const f = inside(p.out, sub.slice(4)); return sendFile(req, res, f && /\.(mp4|jpg|png)$/.test(f) ? f : null); }
  if (sub === 'api/lint') { try { return json(res, JSON.parse(readFileSync(join(p.out, '.lint.json'), 'utf8'))); } catch { return json(res, null); } }
  if (sub === 'api/card') return json(res, card(name, dir));
  const m = mediaOf(p);
  if (sub === 'video.mp4') return sendFile(req, res, await m.light);
  if (sub === 'thumbs.jpg') return sendFile(req, res, await m.strip.ready.catch(() => null));
  // The preview copy with the speaker's matte stacked under it, for animations behind the speaker.
  // GET api/cutout says how it's going; ?make=1 starts it.
  if (sub === 'cut.mp4') { const light = await m.light, c = previewCut(p, light); return c.state === 'ready' ? sendFile(req, res, c.file) : (res.writeHead(404), res.end()); }
  if (sub === 'api/cutout') {
    const light = await m.light, c = url.searchParams.get('make') ? startPreviewCut(p, light) : previewCut(p, light);
    return json(res, { state: c.state, progress: c.progress, error: c.error || null });
  }
  if (sub === 'api/state' && req.method === 'GET') {
    return json(res, { api: API, name, size: p.size, duration: m.len, thumbs: { every: m.strip.every, n: m.strip.n, h: m.strip.h }, sfxGain: p.cfg.sfxGain || 0, faces: p.faces(),
      beats: p.beatIds().map(id => ({ id, ...p.beat(id) })) });
  }
  if (sub === 'api/beat' && req.method === 'POST') {
    const { id, on, move, sfx, time, ltime, hide, behind, sounds, sfxGain } = await body(req);
    if (!p.beatIds().includes(id)) return json(res, { error: `no beat ${id}` }, 404);
    const b = p.beat(id);
    if (on != null) b.on = on;
    if (sounds !== undefined) { if (sounds && (Object.keys(sounds.edit || {}).length || (sounds.add || []).length)) b.sounds = sounds; else delete b.sounds; }
    if (sfxGain !== undefined) { if (sfxGain) b.sfxGain = sfxGain; else delete b.sfxGain; }
    if (hide !== undefined) { if (hide?.length) b.hide = hide; else delete b.hide; }
    if (behind !== undefined) { if (behind?.length) b.behind = behind; else delete b.behind; }
    if (time !== undefined) { if (time && Object.keys(time).length) b.time = time; else delete b.time; }
    if (ltime !== undefined) { if (ltime && Object.keys(ltime).length) b.ltime = ltime; else delete b.ltime; }
    if (sfx != null) { if (sfx) delete b.sfx; else b.sfx = false; }
    if (move) {   // kept to 0.01u so a snapped centre stays dead centre
      b.move = Object.fromEntries(Object.entries(move).filter(([, v]) => v[0] || v[1]).map(([k, [x, y]]) => [k, [Math.round(x * 100) / 100, Math.round(y * 100) / 100]]));
      if (!Object.keys(b.move).length) delete b.move;
    }
    p.save();
    return json(res, { id, api: API, ...b });
  }
  const w = /^work\/([^/]+)\/(.+)$/.exec(sub);
  if (w) {
    if (!p.beatIds().includes(w[1])) { res.writeHead(404); return res.end(); }
    const { work } = p.stage(w[1], p.size, { live: true });   // the page applies moves itself
    const f = normalize(join(work, w[2]));
    if (!f.startsWith(work)) { res.writeHead(403); return res.end(); }
    return sendFile(req, res, f);
  }
  return sendFile(req, res, inside(EDITOR, sub));         // the editor's own modules and styles
}

/* ---------- the server ---------- */
export async function studio({ port = 4180, open = null } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), path = decodeURIComponent(url.pathname);
    try {
      if (path === '/') return sendFile(req, res, join(RETRO, 'studio', 'index.html'));
      if (path.startsWith('/studio/')) return sendFile(req, res, inside(join(RETRO, 'studio'), path.slice(8)));
      if (path === '/api/ping') return json(res, { studio: true, api: API, pid: process.pid });
      if (path === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(`event: hello\ndata: ${JSON.stringify({ jobs: [...jobs.values()].map(pub) })}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => { clearInterval(ping); clients.delete(res); });
        return;
      }
      if (path === '/api/projects' && req.method === 'GET') {
        const list = [...projects()].map(([n, d]) => { try { return card(n, d); } catch (e) { return { name: n, dir: d, error: e.message }; } });
        return json(res, { videos: VIDEOS, projects: list.sort((a, b) => (b.edited || 0) - (a.edited || 0)) });
      }
      if (path === '/api/projects' && req.method === 'POST') {        // new project from a video path
        const { video } = await body(req), v = resolve(String(video || '').replace(/^~(?=\/)/, homedir()));
        if (!video || !existsSync(v) || !statSync(v).isFile()) return json(res, { error: `No such video: ${v}` }, 400);
        const dir = join(dirname(v), `${basename(v, extname(v))}-retro`);
        if (existsSync(join(dir, 'retro.json'))) { remember(dir); emit('projects', {}); return json(res, { error: `${basename(dir)} already exists`, project: nameOf(dir) }, 409); }
        return json(res, pub(addJob('new', { video: v, project: basename(dir) })));
      }
      if (path === '/api/projects/open' && req.method === 'POST') {   // retro preview: make sure the studio knows this folder
        const { dir } = await body(req);
        if (!existsSync(join(dir, 'retro.json'))) return json(res, { error: `No retro.json in ${dir}` }, 400);
        if (!nameOf(dir)) { remember(dir); emit('projects', {}); }
        return json(res, { name: nameOf(dir) });
      }
      if (path === '/api/jobs' && req.method === 'GET') return json(res, [...jobs.values()].map(pub));
      if (path === '/api/jobs' && req.method === 'POST') {
        const { kind, project, draft } = await body(req), dir = projects().get(project);
        if (!dir) return json(res, { error: `No project ${project}` }, 404);
        if (!LABEL[kind] || kind === 'new') return json(res, { error: `No job ${kind}` }, 400);
        return json(res, pub(addJob(kind, { project, dir, draft: !!draft })));
      }
      const jc = /^\/api\/jobs\/(\d+)\/(cancel|dismiss)$/.exec(path);
      if (jc && req.method === 'POST') {
        const j = jobs.get(jc[1]); if (!j) return json(res, { error: 'no such job' }, 404);
        if (jc[2] === 'cancel') { cancel(j); return json(res, pub(j)); }
        if (j.state === 'running' || j.state === 'queued') return json(res, { error: 'still running' }, 409);
        jobs.delete(j.id); emit('gone', { id: j.id }); return json(res, { ok: true });
      }
      if ((path === '/api/reveal' || path === '/api/trash') && req.method === 'POST') {
        const { project, file } = await body(req), dir = projects().get(project);
        if (!dir) return json(res, { error: `No project ${project}` }, 404);
        if (path === '/api/reveal') {
          const f = file ? inside(join(dir, 'out'), file) : dir;
          if (process.platform === 'darwin' && f) spawnSync('open', ['-R', f]);
          return json(res, { ok: !!f });
        }
        if ([...jobs.values()].some(j => j.dir === dir && (j.state === 'running' || j.state === 'queued'))) return json(res, { error: 'Something is still running on this project. Cancel it first.' }, 409);
        const to = trash(dir); emit('projects', {});
        return json(res, { ok: true, trashed: to });
      }
      const pm = /^\/p\/([^/]+)(\/.*)?$/.exec(path);
      if (pm) {
        const dir = projects().get(pm[1]);
        if (!dir) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end(`No project ${pm[1]}`); }
        if (!pm[2]) { res.writeHead(302, { Location: `/p/${encodeURIComponent(pm[1])}/` }); return res.end(); }
        return await projectRoute(req, res, pm[1], dir, pm[2].slice(1), url);
      }
      res.writeHead(404); res.end('not found');
    } catch (e) {
      console.error(e);
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end(String(e.stack || e)); } else res.end();
    }
  });
  await new Promise((ok, no) => { server.once('error', no); server.listen(port, '127.0.0.1', ok); });
  const base = `http://localhost:${port}`;
  console.log(`Retro Studio: ${base}   (Ctrl-C to stop; projects in ${VIDEOS})`);
  if (open != null && process.platform === 'darwin') {
    let to = base + '/';
    if (open) { const dir = resolve(open); if (!nameOf(dir)) remember(dir); to = `${base}/p/${encodeURIComponent(nameOf(dir))}/`; }
    spawnSync('open', [to]);
  }
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopAll(); process.exit(0); });
  // the parent (cli.mjs studio) asks for a restart when retro's code changes: go once nothing is running
  process.on('message', m => {
    if (m !== 'restart') return;
    const go = () => { if (running()) return setTimeout(go, 1000); server.close(); process.exit(0); };
    go();
  });
  return server;
}
