#!/usr/bin/env node
/*
  Cutroom MCP server: lets Claude Code work on a Cutroom edit with you.

  Claude Code starts this over stdio (the plugin's .mcp.json). It talks
  to the Cutroom app server over HTTP, so every change Claude makes lands in
  the same project file and shows up live in your open editor. If the app
  server isn't running, this starts it.

  The loop: you write notes on shots in the editor and press "Send to Claude";
  Claude's wait_for_notes call returns them; Claude edits (edit, new_motion,
  render_motion…), checks its work (frame, render, look), replies on each
  thread, and calls wait_for_notes again.

  No dependencies, so it starts before setup has run: newline-delimited
  JSON-RPC 2.0, MCP tools only. The `setup` tool installs the rest.
*/
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { CUTROOM, HOME } from './lib/paths.mjs';

const PORT = Number(process.env.CUTROOM_PORT || 4100);
const BASE = `http://127.0.0.1:${PORT}`;
const VERSION = JSON.parse(readFileSync(join(CUTROOM, 'package.json'), 'utf8')).version;
const DEV = !!process.env.CUTROOM_DEV;   // restart the app server when Cutroom's code changes

/* ---------- talking to the app server ---------- */

async function http(method, path, body, { timeout = 120000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(BASE + path, { method, signal: ctl.signal, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const type = r.headers.get('content-type') || '';
    const data = type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    if (!r.ok) throw new Error(data?.error || `${r.status} ${r.statusText}`);
    return data;
  } finally { clearTimeout(timer); }
}

let starting = null;
async function ensureServer() {
  let running = null;
  try { running = await http('GET', '/api/version', null, { timeout: 2000 }); } catch { /* not up */ }
  if (running?.root === CUTROOM) return;
  // A server from another copy of Cutroom (an older version of the plugin): replace it.
  if (running) {
    await http('POST', '/api/shutdown', null, { timeout: 2000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 600));
  }
  if (!starting) {
    starting = (async () => {
      mkdirSync(HOME, { recursive: true });
      const log = openSync(join(HOME, 'server.log'), 'a');
      spawn(process.execPath, [...(DEV ? ['--watch'] : []), join(CUTROOM, 'server.mjs')], { cwd: CUTROOM, detached: true, stdio: ['ignore', log, log], env: process.env }).unref();
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 250));
        try { await http('GET', '/api/projects', null, { timeout: 1000 }); return; } catch { /* keep waiting */ }
      }
      throw new Error(`Couldn't start the Cutroom server on ${BASE}. See ${join(HOME, 'server.log')}.`);
    })().finally(() => { starting = null; });
  }
  return starting;
}

async function waitJob(id, { timeoutMs = 30 * 60 * 1000, onProgress } = {}) {
  const t0 = Date.now();
  for (;;) {
    const j = await http('GET', `/api/jobs/${id}`);
    onProgress?.(j);
    if (j.status !== 'running') return j;
    if (Date.now() - t0 > timeoutMs) throw new Error(`Job ${id} is still running after ${Math.round(timeoutMs / 60000)} minutes`);
    await new Promise(r => setTimeout(r, 1000));
  }
}

const clock = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = (t % 60).toFixed(1).padStart(4, '0'); return `${m}:${s}`; };
const editorUrl = id => `${BASE}/ui/#/p/${id}`;

/* ---------- images ---------- */

function ffmpegImage(args) {
  return new Promise((resolve, reject) => {
    const c = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args, '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '4', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [], err = [];
    c.stdout.on('data', d => out.push(d));
    c.stderr.on('data', d => err.push(d));
    c.on('close', code => (code === 0 && out.length ? resolve(Buffer.concat(out)) : reject(new Error(Buffer.concat(err).toString() || 'ffmpeg made no image'))));
  });
}
const img = buf => ({ type: 'image', data: buf.toString('base64'), mimeType: 'image/jpeg' });
const text = t => ({ type: 'text', text: t });

/**
  Frames from a video at the given times, side by side. For a transparent
  animation (alpha), each frame is laid over `bg` (an image file) or a neutral grey.
*/
async function strip(file, times, { width = 300, alpha = false, bg = null, size = null } = {}) {
  const ins = [], f = [];
  const N = times.length;
  for (const t of times) {
    if (alpha) ins.push('-c:v', 'libvpx-vp9', '-i', file);           // libvpx keeps the alpha; seek with trim
    else ins.push('-ss', String(Math.max(0, t)), '-i', file);
  }
  if (alpha) {
    const h = size ? Math.round((width * size.height) / size.width / 2) * 2 : Math.round((width * 16) / 9 / 2) * 2;
    if (bg) { ins.push('-i', bg); f.push(`[${N}:v]scale=${width}:${h},setsar=1,split=${N}${times.map((_, k) => `[b${k}]`).join('')}`); }
    else f.push(`color=c=0x7a7366:s=${width}x${h}:d=1,split=${N}${times.map((_, k) => `[b${k}]`).join('')}`);
  }
  times.forEach((t, k) => {
    if (alpha) f.push(`[${k}:v]trim=start=${t},setpts=PTS-STARTPTS,scale=${width}:-2,setsar=1,format=rgba[f${k}]`, `[b${k}][f${k}]overlay=format=auto:shortest=1[o${k}]`);
    else f.push(`[${k}:v]scale=${width}:-2,setsar=1[o${k}]`);
  });
  f.push(N > 1 ? `${times.map((_, k) => `[o${k}]`).join('')}hstack=inputs=${N}[out]` : '[o0]null[out]');
  return ffmpegImage([...ins, '-filter_complex', f.join(';'), '-map', '[out]', '-frames:v', '1']);
}

/* ---------- storyboard as text ---------- */

async function storyboardText(id) {
  const [{ project: p, dir }, a] = await Promise.all([http('GET', `/api/projects/${id}`), http('GET', `/api/projects/${id}/analysis`)]);
  const words = a.words;
  const s = p.settings;
  const lines = [];
  lines.push(`# ${p.name}  (project ${p.id}, rev ${p.rev || 0})`);
  lines.push(`Editor: ${editorUrl(p.id)}   Folder: ${dir}`);
  lines.push(`Source ${clock(p.source.duration)} · ${p.source.width}×${p.source.height} · format ${s.aspect} · look ${s.lut?.id || 'none'} ${Math.round((s.lut?.intensity ?? 1) * 100)}% · captions ${s.captions?.on ? `${s.captions.style}${s.captions.font === 'serif' ? ' serif' : ''}` : 'off'} · theme ${s.theme}`);
  lines.push('');
  const threadsByShot = new Map();
  for (const t of p.threads || []) { const k = t.shot || '*'; threadsByShot.set(k, [...(threadsByShot.get(k) || []), t]); }
  const fmtThread = t => `    note ${t.id} [${t.status}]: ` + t.messages.map(m => `${m.from}: ${m.text}`).join(' / ');
  for (const t of threadsByShot.get('*') || []) lines.push(fmtThread(t).replace(/^ {4}/, 'Whole video '));
  for (const sec of p.storyboard.sections) {
    const shots = p.storyboard.shots.filter(x => x.section === sec.id);
    if (!shots.length) continue;
    lines.push(`## ${sec.title}  (section ${sec.id})`);
    for (const sh of shots) {
      const head = [`${sh.id}`, sh.enabled === false ? 'OFF' : null, sh.kind !== 'talk' ? sh.kind : null,
        sh.transition?.type && sh.transition.type !== 'cut' ? `in: ${sh.transition.type} ${sh.transition.duration}s` : null,
        sh.transition?.stinger ? `stinger: ${sh.transition.stinger.name}` : null,
        sh.zoom > 1 ? `zoom ${sh.zoom}` : null, sh.motion && sh.motion !== 'none' ? sh.motion : null,
        sh.broll?.file ? `b-roll ${sh.broll.file.split('/').pop()}` : null].filter(Boolean).join(' · ');
      lines.push(`- ${head}`);
      if (sh.kind === 'talk') {
        const ws = words.slice(sh.w0, sh.w1 + 1).map(w => (sh.cut && w.i in sh.cut ? `[${w.text}]` : w.text)).join(' ');
        lines.push(`    words ${sh.w0}–${sh.w1} (${clock(words[sh.w0]?.start)}–${clock(words[sh.w1]?.end)} in source): ${ws}`);
      } else if (sh.kind === 'card') lines.push(`    card: ${JSON.stringify(sh.card)}`);
      if (sh.flag) lines.push(`    flag: ${sh.flag.note}`);
      for (const o of sh.overlays || []) lines.push(`    overlay ${o.id} ${o.type}${o.name ? ` ${o.name}` : ''}: ${JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => !['id', 'type', 'name', 'render'].includes(k))))}`);
      for (const t of threadsByShot.get(sh.id) || []) lines.push(fmtThread(t));
    }
  }
  lines.push('', 'Cut words appear in [brackets]. Address words by phrase or by index in edit ops.');
  return lines.join('\n');
}

/* ---------- tools ---------- */

const OPS_DOC = `Ops (applied in order, all or nothing):
{op:"settings", set:{"lut.id":"film","lut.intensity":0.7,"captions.style":"word","captions.font":"serif","captions.size":1.1,"aspect":"16:9","theme":"dark","cut.minGap":0.3}}
  brand (see the brand tool): {"brand.accent":"#ff5a1f","brand.plate":"#101820","brand.text":"#ffffff","brand.display":"user/Advercase-Regular.otf","brand.body":"inter","brand.name":"Sam Lee","brand.role":"Founder, Acme"} ('' = theme default)
{op:"shot", id, set:{enabled, zoom(1–1.8), fx, fy (0–1 focus point), motion:"none"|"push"|"pull", transition:{type:"cut"|"fade"|"fadeblack"|"dissolve"|"smoothleft"|"slideleft"|"wipeleft"|"zoomin"|"circleopen"|"hblur", duration, stinger?:{name, vars, dur, cut}}, broll:{file, in, start, dur, grade}, card:{...}}}
{op:"cut", shot, phrase:"by the way"}  or {op:"cut", shot, from, to}; add restore:true to bring words back
{op:"split", shot, phrase} / {op:"split", shot, at}   {op:"merge", shot}   {op:"move", shot, before|after}
{op:"overlay_add", shot, overlay:{type:"headline"|"lowerThird"|"chapter"|"stat"|"keyword"|"quote"|"cta", text, sub, eyebrow, keyword, at (s into shot), dur (s or "shot"), phrase (start on this phrase)}}
{op:"overlay_add", shot, overlay:{type:"motion", name, vars:{...}, at, dur (use the duration render_motion reports), phrase}}
{op:"overlay_update", id, set:{...}}   {op:"overlay_remove", id}
{op:"card_add", before|after, card:{eyebrow, title, sub, dur, motion?:{name, vars}}}
{op:"section", id, title}`;

const TOOLS = [
  {
    name: 'setup',
    local: true,
    description: 'Install what Cutroom needs on this Mac: ffmpeg, Node and uv (with Homebrew), Playwright, HyperFrames, faster-whisper, yt-dlp and the browsers that draw graphics. Takes a few minutes the first time; safe to run again. Call it when status reports missing tools, or before the first import.',
    inputSchema: { type: 'object', properties: { check: { type: 'boolean', description: 'Only report what is missing' } } },
    run: async (a, ctx) => {
      const lines = [];
      const code = await new Promise(resolve => {
        const c = spawn('bash', [join(CUTROOM, 'setup.sh'), ...(a.check ? ['--check'] : [])], { cwd: CUTROOM, env: process.env });
        const take = d => { for (const l of String(d).split('\n')) if (l.trim()) { lines.push(l); if (/[✓✗…]/.test(l)) ctx.progress?.(l.trim()); } };
        c.stdout.on('data', take); c.stderr.on('data', take);
        c.on('close', resolve);
      });
      const out = lines.filter(l => /[✓✗…]|ready|incomplete|failed|Homebrew|brew|curl/i.test(l)).slice(-40).join('\n');
      if (code === 2) return [text(`${out}\n\nHomebrew is missing. The user has to install it themselves in Terminal (it asks for their Mac password); give them the command above, then call setup again.`)];
      if (code === 0) {
        // A running app server may have started before the tools existed: restart it.
        await http('POST', '/api/shutdown', null, { timeout: 2000 }).catch(() => {});
        return [text(`${out}\n\nSetup complete.`)];
      }
      return [text(`${out}\n\nSetup didn't finish (exit ${code}). Read the ✗ lines above.`)];
    },
  },
  {
    name: 'brand',
    description: "The project's brand (colours, fonts, name and role, caption font and size) and the fonts available, including the user's own from ~/Movies/Cutroom/fonts. Change it with edit settings ops (brand.*, captions.font, captions.size). save_default:true makes the project's brand, captions and look the starting point for new videos.",
    inputSchema: { type: 'object', required: ['project'], properties: { project: { type: 'string' }, save_default: { type: 'boolean' } } },
    run: async a => {
      const [{ project: p }, { fonts, dir }] = await Promise.all([http('GET', `/api/projects/${a.project}`), http('GET', '/api/fonts')]);
      const s = p.settings;
      if (a.save_default) await http('PUT', '/api/brand', s);
      const b = s.brand || {};
      return [text([
        `Theme ${s.theme}. Colours (blank = theme default): plate ${b.plate || '-'}, text ${b.text || '-'}, accent ${b.accent || '-'}.`,
        `Fonts: titles ${b.display || 'fraunces'}, labels ${b.body || 'inter'}, captions ${s.captions?.font || 'sans'} at ${Math.round((s.captions?.size ?? 1) * 100)}%.`,
        `Lower third: ${b.name || '(no name)'}${b.role ? `, ${b.role}` : ''}.`,
        '', 'Fonts available (use the id):', ...fonts.map(f => `- ${f.id}  ${f.label}${f.user ? ' (theirs)' : ''}`),
        `The user adds fonts by dropping .otf/.ttf/.woff2 files into ${dir}.`,
        a.save_default ? '\nSaved as the default for new videos.' : '',
      ].join('\n'))];
    },
  },
  {
    name: 'status',
    description: 'Is Cutroom running, which projects exist (with open notes), which animations are available, and the editor URL. Starts the Cutroom app server if needed. Call this first.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const projects = await http('GET', '/api/projects');
      const rows = [];
      for (const p of projects) {
        let notes = '';
        try { const t = await http('GET', `/api/projects/${p.id}/threads`); const c = t.claude; notes = ` · notes: ${c.drafts} draft, ${c.waiting} sent, ${c.working} working`; } catch { /* ignore */ }
        rows.push(`- ${p.id}  "${p.name}"  ${p.status}  ${clock(p.duration)}  ${p.aspect || ''}${notes}  ${editorUrl(p.id)}`);
      }
      const health = await http('GET', '/api/health').catch(() => null);
      const missing = Object.entries(health?.tools || {}).filter(([k, v]) => !v.ok && k !== 'whisper').map(([k, v]) => `${k}: ${v.error}`);
      const warn = missing.length ? `\n\nSetup is incomplete, so imports or renders will fail:\n${missing.map(m => `- ${m}`).join('\n')}\nCall the setup tool (it takes a few minutes the first time).` : '';
      return [text(`Cutroom ${VERSION} is running at ${BASE}/ (projects in ${HOME}).${warn}\n\nProjects:\n${rows.join('\n') || '(none: use open_video)'}\n\nNext: call wait_for_notes to pick up notes the user sends from the editor, or storyboard to read a project.`)];
    },
  },
  {
    name: 'open_video',
    description: 'Import a video (local path or YouTube/URL) into a new Cutroom project: transcribes it and plans a first storyboard (rules, no model calls). Waits until done, then returns the storyboard and the editor URL to give the user.',
    inputSchema: { type: 'object', required: ['source'], properties: { source: { type: 'string', description: 'File path or URL' }, name: { type: 'string' }, aspect: { type: 'string', enum: ['9:16', '16:9', '1:1', '4:5'] }, model: { type: 'string', description: 'Whisper model: small.en (default), medium.en, large-v3-turbo, small' } } },
    run: async a => {
      const { project, job } = await http('POST', '/api/projects', { origin: a.source, name: a.name, aspect: a.aspect, model: a.model });
      const end = await waitJob(job.id);
      if (end.status !== 'done') throw new Error(`Import failed: ${end.error}`);
      return [text(`Imported. Open it: ${editorUrl(project.id)}\n\n${await storyboardText(project.id)}`)];
    },
  },
  {
    name: 'storyboard',
    description: 'The project as an annotated script: every shot with its id, words (cut ones in [brackets]), framing, transition, overlays, and note threads. Read this before editing.',
    inputSchema: { type: 'object', required: ['project'], properties: { project: { type: 'string' } } },
    run: async a => [text(await storyboardText(a.project))],
  },
  {
    name: 'wait_for_notes',
    description: 'Wait for the user to send notes from the Cutroom editor ("Send to Claude"). Returns as soon as there are notes (they are then marked working), or after the timeout with none. When it returns notes: do the work, reply to every thread, then call wait_for_notes again. If it times out, just call it again unless the user has told you to stop.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'Limit to one project (default: any)' }, timeout_seconds: { type: 'number', description: 'Default 300, max 900' } } },
    run: async (a, ctx) => {
      const secs = Math.min(900, Math.max(10, a.timeout_seconds || 300));
      const beat = setInterval(() => ctx.progress?.('Waiting for notes from the Cutroom editor…'), 20000);
      try {
        const r = await http('GET', `/api/claude/wait?timeout=${secs}${a.project ? `&project=${encodeURIComponent(a.project)}` : ''}`, null, { timeout: (secs + 30) * 1000 });
        if (!r.notes?.length) return [text(`No notes yet after ${secs}s. Call wait_for_notes again to keep listening.`)];
        const parts = r.notes.map(n => `Thread ${n.thread}${n.shot ? ` on shot ${n.shot.id}${n.shot.enabled ? '' : ' (switched off)'}: "${n.shot.text}"` : ' (whole video)'}\n${n.messages.map(m => `  ${m.from}: ${m.text}`).join('\n')}`);
        return [text(`${r.notes.length} note${r.notes.length > 1 ? 's' : ''} from the editor for project ${r.project} ("${r.name}", rev ${r.rev}). They are marked working; reply to each with reply().\n\n${parts.join('\n\n')}\n\nRead storyboard(${r.project}) for full context.`)];
      } finally { clearInterval(beat); }
    },
  },
  {
    name: 'reply',
    description: 'Answer a note thread in the editor. status "done" when the change is made, "question" when you need the user to decide something. List what you changed in `changes`.',
    inputSchema: { type: 'object', required: ['project', 'thread', 'text'], properties: { project: { type: 'string' }, thread: { type: 'string' }, text: { type: 'string' }, status: { type: 'string', enum: ['done', 'question'] }, changes: { type: 'array', items: { type: 'string' } } } },
    run: async a => {
      await http('POST', `/api/projects/${a.project}/threads/${a.thread}/messages`, { text: a.text, from: 'claude', status: a.status || 'done', changes: a.changes });
      return [text(`Replied on ${a.thread} (${a.status || 'done'}).`)];
    },
  },
  {
    name: 'note',
    description: 'Start a new thread in the editor yourself (a suggestion or a question about a shot, or the whole video when shot is omitted).',
    inputSchema: { type: 'object', required: ['project', 'text'], properties: { project: { type: 'string' }, shot: { type: 'string' }, text: { type: 'string' } } },
    run: async a => {
      const { thread } = await http('POST', `/api/projects/${a.project}/threads`, { shot: a.shot, text: a.text, from: 'claude' });
      await http('PATCH', `/api/projects/${a.project}/threads/${thread.id}`, { status: 'question' });
      return [text(`Started thread ${thread.id}.`)];
    },
  },
  {
    name: 'edit',
    description: `Change the storyboard. The open editor updates live and the user can undo. ${OPS_DOC}`,
    inputSchema: { type: 'object', required: ['project', 'ops'], properties: { project: { type: 'string' }, ops: { type: 'array', items: { type: 'object' } } } },
    run: async a => {
      const r = await http('POST', `/api/projects/${a.project}/ops`, { ops: a.ops });
      return [text(`Applied ${a.ops.length} op${a.ops.length > 1 ? 's' : ''} (rev ${r.rev}). Changed shots: ${r.changed.join(', ') || 'none'}${r.notes.length ? `\n${r.notes.join('\n')}` : ''}`)];
    },
  },
  {
    name: 'frame',
    description: 'See a shot: the source frame at the start of the shot (or `source_time` seconds), cropped and graded the way the edit will be. For finished output with graphics and animations, use render then look.',
    inputSchema: { type: 'object', required: ['project'], properties: { project: { type: 'string' }, shot: { type: 'string' }, source_time: { type: 'number' } } },
    run: async a => {
      const [{ project: p }, an] = await Promise.all([http('GET', `/api/projects/${a.project}`), http('GET', `/api/projects/${a.project}/analysis`)]);
      const s = a.shot ? p.storyboard.shots.find(x => x.id === a.shot) : null;
      if (a.shot && !s) throw new Error(`No shot ${a.shot}`);
      const t = a.source_time ?? (s?.kind === 'talk' ? an.words[s.w0].start + 0.4 : s?.in ?? 1);
      const q = new URLSearchParams({ t: String(t), w: '480', ...(s ? { z: s.zoom || 1, ...(s.fx != null ? { fx: s.fx } : {}), ...(s.fy != null ? { fy: s.fy } : {}) } : {}) });
      const buf = await http('GET', `/api/projects/${a.project}/frame?${q}`);
      return [img(buf), text(`Source ${clock(t)}${s ? `, shot ${s.id}` : ''}.`)];
    },
  },
  {
    name: 'motions',
    description: 'Animations available to this project (HyperFrames compositions): name, kind (text, transition, card), variables, description and folder. Use them with overlay_add type "motion", a shot transition stinger, or a card motion.',
    inputSchema: { type: 'object', required: ['project'], properties: { project: { type: 'string' } } },
    run: async a => {
      const { motions } = await http('GET', `/api/projects/${a.project}/motions`);
      return [text(motions.map(m => `- ${m.name} [${m.kind}${m.kind === 'transition' ? `, cut at ${m.cut}` : ''}] (${m.scope}) ${m.description}\n    vars: ${m.variables.map(v => `${v.id}${v.default !== undefined ? `="${v.default}"` : ''}`).join(', ') || 'none'}\n    ${m.path}/index.html`).join('\n') || 'None yet.')];
    },
  },
  {
    name: 'new_motion',
    description: 'Create a new animation (a HyperFrames composition) to write by hand: copies the blank template, or an existing animation with `from`. Returns the folder. Then edit its index.html with your file tools (read the Animations part of Cutroom\'s CLAUDE.md first), and check it with render_motion.',
    inputSchema: { type: 'object', required: ['project', 'name'], properties: { project: { type: 'string' }, name: { type: 'string', description: 'lowercase-with-dashes' }, from: { type: 'string', description: 'Existing animation to copy' }, scope: { type: 'string', enum: ['project', 'library'], description: 'library = reusable in every video (saved in ~/Movies/Cutroom/motion)' } } },
    run: async a => {
      const { motion } = await http('POST', `/api/projects/${a.project}/motions`, { name: a.name, from: a.from, scope: a.scope });
      return [text(`Created ${motion.name} at ${motion.path}/index.html (${motion.scope}). Edit that file, then render_motion to check it.\n\nRules: transparent background; size comes from Cutroom (lay out with %, vw/vh or var(--cr-w)/var(--cr-h)); inputs as data-composition-variables; one paused GSAP timeline on window.__timelines["root"]; meta cutroom:kind (text | transition | card) and cutroom:cut for transitions; colours and fonts only from the user's brand: var(--cr-plate), var(--cr-text), var(--cr-accent) (at most twice per frame), var(--cr-display), var(--cr-body), never hard-coded; no bounce or elastic eases.`)];
    },
  },
  {
    name: 'render_motion',
    description: 'Render an animation (HyperFrames) for this project\'s format with the given variables, and see it: returns lint findings, its duration, and frames over the shot (or a neutral background). Cached; the final render reuses it.',
    inputSchema: { type: 'object', required: ['project', 'name'], properties: { project: { type: 'string' }, name: { type: 'string' }, vars: { type: 'object' }, shot: { type: 'string', description: 'Shot to preview it over' }, frames: { type: 'number', description: 'How many frames to show (default 5)' } } },
    run: async a => {
      const lint = await http('POST', `/api/projects/${a.project}/motions/lint`, { name: a.name }, { timeout: 300000 }).catch(e => ({ report: e.message }));
      const r = await http('POST', `/api/projects/${a.project}/motions/render`, { name: a.name, vars: a.vars || {} }, { timeout: 600000 });
      const n = Math.max(2, Math.min(8, a.frames || 5));
      const times = Array.from({ length: n }, (_, k) => Math.min(r.duration - 0.04, ((k + 0.5) / n) * r.duration));
      let bg = null;
      if (a.shot) {
        const [{ project: p }, an] = await Promise.all([http('GET', `/api/projects/${a.project}`), http('GET', `/api/projects/${a.project}/analysis`)]);
        const s = p.storyboard.shots.find(x => x.id === a.shot);
        if (s?.kind === 'talk') {
          const buf = await http('GET', `/api/projects/${a.project}/frame?${new URLSearchParams({ t: String(an.words[s.w0].start + 0.4), w: '540', z: s.zoom || 1 })}`);
          bg = join(HOME, 'cache', `bg-${process.pid}.jpg`);
          mkdirSync(join(HOME, 'cache'), { recursive: true });
          writeFileSync(bg, buf);
        }
      }
      const pic = await strip(r.file, times, { width: 240, alpha: true, bg, size: { width: r.width, height: r.height } });
      const report = (lint.report || '').split('\n').filter(l => /error|⚠|✖|warning/i.test(l)).slice(0, 12).join('\n');
      return [img(pic), text(`${a.name}: ${r.duration.toFixed(2)}s at ${times.map(t => t.toFixed(2)).join(', ')}s. Use dur ${r.duration.toFixed(2)} when placing it.\nLint: ${report || 'clean'}`)];
    },
  },
  {
    name: 'render',
    description: 'Render the edit. draft (default) is 540p and fast, for checking; draft:false is the final 1080p. Waits until done. Returns the file path; then use look to see frames.',
    inputSchema: { type: 'object', required: ['project'], properties: { project: { type: 'string' }, draft: { type: 'boolean' } } },
    run: async (a, ctx) => {
      const { job } = await http('POST', `/api/projects/${a.project}/render`, { preview: a.draft !== false, by: 'claude' });
      const end = await waitJob(job.id, { onProgress: j => ctx.progress?.(`${Math.round(j.progress * 100)}% ${j.message}`) });
      if (end.status !== 'done') throw new Error(`Render failed: ${end.error}\n${(end.log || []).slice(-6).join('\n')}`);
      const { dir } = await http('GET', `/api/projects/${a.project}`);
      return [text(`Rendered ${clock(end.result.duration)} → ${join(dir, 'exports', end.result.file)}`)];
    },
  },
  {
    name: 'look',
    description: 'See frames of the latest render (output time, seconds). Use after render to check titles, animations, captions and cuts.',
    inputSchema: { type: 'object', required: ['project', 'times'], properties: { project: { type: 'string' }, times: { type: 'array', items: { type: 'number' } } } },
    run: async a => {
      const { project: p, dir } = await http('GET', `/api/projects/${a.project}`);
      const x = p.exports?.[0];
      if (!x) throw new Error('Nothing rendered yet: call render first.');
      const times = a.times.slice(0, 8);
      const pic = await strip(join(dir, 'exports', x.file), times, { width: times.length > 4 ? 200 : 260 });
      return [img(pic), text(`${x.file}${x.preview ? ' (draft)' : ''} at ${times.join(', ')}s. Rendered ${x.createdAt}; if you edited since, render again.`)];
    },
  },
];

/* ---------- JSON-RPC over stdio ---------- */

const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const INSTRUCTIONS = `Cutroom is the user's local video editor (installed at ${CUTROOM}). Read ${join(CUTROOM, 'skills', 'cutroom', 'SKILL.md')} before editing (the notes loop, the user's brand, animation rules). If status says setup is incomplete, call setup first. Typical session: status → (open_video) → give the user the editor URL → wait_for_notes → for each note: storyboard/frame, edit or new_motion+render_motion, render+look to check, reply → wait_for_notes again. Never stop the loop on a timeout unless the user says so.`;

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'cutroom', version: VERSION }, instructions: INSTRUCTIONS } });
  }
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
  if (method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === params?.name);
    if (!tool) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool ${params?.name}` } });
    const token = params?._meta?.progressToken;
    let n = 0;
    const ctx = { progress: token == null ? null : message => send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: ++n, message } }) };
    try {
      if (!tool.local) await ensureServer();
      const content = await tool.run(params.arguments || {}, ctx);
      return send({ jsonrpc: '2.0', id, result: { content } });
    } catch (e) {
      return send({ jsonrpc: '2.0', id, result: { content: [text(`Error: ${e.message}`)], isError: true } });
    }
  }
  if (id !== undefined && method) return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
}

createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  handle(msg).catch(e => process.stderr.write(`${e.stack}\n`));
});

