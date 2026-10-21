/*
  Working with Claude: notes threads, live edits, and the wait-for-notes loop.

  The project file is the shared state; the app server is its only writer.
  Every storyboard edit (from the editor, from Claude, from a re-plan) bumps
  project.rev and is broadcast to open editors, which pull the new state and
  highlight what changed. An editor saving on top of an older rev gets a 409
  instead of silently overwriting someone else's edit.

  Notes are threads on a shot (or on the whole video):
    draft → sent → working → question | done
  "Send to Claude" in the editor turns drafts into sent and wakes any
  wait_for_notes call (a long poll from the MCP server). Claiming notes marks
  them working; Claude's reply marks them question (needs you) or done.
*/
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { listProjects, loadProject, loadAnalysis, saveProject, updateProject } from './store.mjs';
import { applyOps } from '../shared/ops.mjs';
import { joinWords } from '../shared/text.mjs';

export const bus = new EventEmitter();
bus.setMaxListeners(200);
const emit = (id, event) => bus.emit(id, event);

const rid = p => `${p}${randomBytes(3).toString('hex')}`;
const now = () => new Date().toISOString();

/* ---------- storyboard edits ---------- */

/** Change the project's storyboard/settings: bumps rev and tells every open editor. */
export function commitEdit(id, fn, { by = 'server', shots = [] } = {}) {
  const p = updateProject(id, x => { fn(x); x.rev = (x.rev || 0) + 1; x.editedBy = by; });
  emit(id, { type: 'changed', rev: p.rev, by, shots });
  return p;
}

/** Apply edit ops (shared/ops.mjs) on behalf of Claude, all or nothing. */
export function applyClaudeOps(id, ops) {
  seen(id);
  const p = loadProject(id);
  const words = loadAnalysis(id)?.words || [];
  const { project, changed, notes } = applyOps(p, ops, words);
  const saved = commitEdit(id, x => { x.settings = project.settings; x.storyboard = project.storyboard; }, { by: 'claude', shots: changed });
  return { rev: saved.rev, changed, notes };
}

/* ---------- threads ---------- */

function threads(p) { return (p.threads = p.threads || []); }

function shotContext(p, words, shotId) {
  const s = p.storyboard?.shots.find(x => x.id === shotId);
  if (!s) return null;
  const text = s.kind === 'talk' ? joinWords(words.slice(s.w0, s.w1 + 1).filter(w => !(s.cut && w.i in s.cut))) : s.kind === 'card' ? `[title card] ${s.card?.title || ''}` : '[raw footage]';
  return { id: s.id, kind: s.kind, text, enabled: s.enabled !== false };
}

function threadsChanged(id, p) {
  emit(id, { type: 'threads', threads: p.threads || [] });
  emit(id, { type: 'claude', ...claudeState(id, p) });
}

export function addThread(id, { shot = null, text, from = 'you' }) {
  const t = { id: rid('t'), shot, status: 'draft', createdAt: now(), updatedAt: now(), messages: [{ id: rid('m'), from, text: String(text), at: now() }] };
  const p = updateProject(id, x => { threads(x).push(t); });
  threadsChanged(id, p);
  return t;
}

/** Add a message. Your message on a thread reopens it as a draft; Claude sets question or done. */
export function addMessage(id, tid, { text, from = 'you', status, changes }) {
  let t;
  const p = updateProject(id, x => {
    t = threads(x).find(y => y.id === tid);
    if (!t) throw Object.assign(new Error(`No thread ${tid}`), { status: 404 });
    if (text) t.messages.push({ id: rid('m'), from, text: String(text), at: now(), ...(changes?.length ? { changes } : {}) });
    t.status = status || (from === 'claude' ? 'question' : 'draft');
    t.updatedAt = now();
  });
  if (from === 'claude') seen(id);
  threadsChanged(id, p);
  return t;
}

export function setThread(id, tid, patch) {
  let t;
  const p = updateProject(id, x => {
    t = threads(x).find(y => y.id === tid);
    if (!t) throw Object.assign(new Error(`No thread ${tid}`), { status: 404 });
    if (patch.status) t.status = patch.status;
    if ('shot' in patch) t.shot = patch.shot;
    t.updatedAt = now();
  });
  threadsChanged(id, p);
  return t;
}

export function deleteThread(id, tid) {
  const p = updateProject(id, x => { x.threads = threads(x).filter(y => y.id !== tid); });
  threadsChanged(id, p);
}

/** "Send to Claude": every draft becomes sent. Wakes anyone waiting. */
export function sendNotes(id) {
  let n = 0;
  const p = updateProject(id, x => { for (const t of threads(x)) if (t.status === 'draft') { t.status = 'sent'; t.updatedAt = now(); n++; } });
  threadsChanged(id, p);
  wake(id);
  return n;
}

/* ---------- the wait-for-notes loop ---------- */

const waiters = new Set();
const lastSeen = new Map();
function seen(id) { lastSeen.set(id || '*', Date.now()); }

/** Mark one project's sent notes as working and return them with shot context, or null. */
function claim(id) {
  const p = loadProject(id);
  const sent = threads(p).filter(t => t.status === 'sent');
  if (!sent.length) return null;
  for (const t of sent) { t.status = 'working'; t.updatedAt = now(); }
  saveProject(p);
  const words = loadAnalysis(id)?.words || [];
  threadsChanged(id, p);
  return {
    project: id, name: p.name, rev: p.rev || 0,
    notes: sent.map(t => ({ thread: t.id, shot: t.shot ? shotContext(p, words, t.shot) : null, messages: t.messages.map(m => ({ from: m.from, text: m.text })) })),
  };
}

function claimAny(project) {
  if (project) return claim(project);
  for (const p of listProjects()) { const r = claim(p.id); if (r) return r; }
  return null;
}

function wake(id) {
  for (const w of [...waiters]) {
    if (w.project && w.project !== id) continue;
    const r = claim(id);
    if (!r) return;
    w.done(r);
  }
}

/**
  Long poll: resolves with claimed notes as soon as there are any (now, or when
  you press Send), or null after `ms`. `project` null = any project.
*/
export function waitForNotes(project, ms, onClose) {
  seen(project);
  const ready = claimAny(project);
  if (ready) return Promise.resolve(ready);
  return new Promise(resolve => {
    const w = { project };
    w.done = v => {
      if (!waiters.has(w)) return;
      clearTimeout(w.timer);
      waiters.delete(w);
      seen(project);
      presence(project);
      resolve(v);
    };
    w.timer = setTimeout(() => w.done(null), ms);
    waiters.add(w);
    onClose?.(() => w.done(null));
    presence(project);
  });
}

function presence(project) {
  const ids = project ? [project] : listProjects().map(p => p.id);
  for (const id of ids) { try { emit(id, { type: 'claude', ...claudeState(id) }); } catch { /* deleted */ } }
}

/** What the editor shows: is Claude listening, working, or not around? */
export function claudeState(id, p = null) {
  const proj = p || loadProject(id);
  const working = threads(proj).filter(t => t.status === 'working').length;
  const listening = [...waiters].some(w => !w.project || w.project === id);
  const last = Math.max(lastSeen.get(id) || 0, lastSeen.get('*') || 0);
  const state = working ? 'working' : listening ? 'listening' : Date.now() - last < 120000 ? 'idle' : 'away';
  return { state, working, waiting: threads(proj).filter(t => t.status === 'sent').length, drafts: threads(proj).filter(t => t.status === 'draft').length };
}

export { seen as touchClaude, now };
