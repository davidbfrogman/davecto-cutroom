import { S, alarm, state, status } from './state.js';
import { record } from './history.js';

/* Saving. Every edit goes to retro.json through the server, and every save is checked: the server sends
   back what it stored, and if something we sent isn't there (an out-of-date server), or the server
   can't be reached for a while, a red banner says so instead of the edit quietly vanishing. */
export const API = 5;                                         // must match lib/studio.mjs API
export const pending = new Map();                             // beat id → patch waiting to be saved
let saveT = null;
export function save(b, patch, delay = 0) {
  record(b, patch);
  pending.set(b.id, { ...(pending.get(b.id) || {}), ...patch });
  clearTimeout(saveT);
  saveT = setTimeout(flush, delay);
}
let flushing = 0;
export async function flush() {
  flushing++;
  try { await flushNow(); } finally { flushing--; }
}
export const whenSaved = async () => { for (let i = 0; i < 400 && (pending.size || flushing); i++) await new Promise(r => setTimeout(r, 15)); };
export async function flushNow() {
  const all = [...pending]; pending.clear();
  for (const [id, p] of all) {
    let got = null;
    for (let i = 0; i < 12 && !got; i++) {               // the server may be restarting: try for ~6 s
      try { const r = await fetch('api/beat', { method: 'POST', body: JSON.stringify({ id, ...p }) }); if (r.ok) got = await r.json(); } catch {}
      if (!got) { status('Saving… (waiting for the preview server)'); await new Promise(r => setTimeout(r, 500)); }
    }
    if (!got) { alarm(`Couldn't save ${id}: the preview server isn't answering. Run retro preview again; this tab keeps your edits until you reload.`); pending.set(id, { ...p, ...(pending.get(id) || {}) }); continue; }
    const lost = Object.entries(p).filter(([k, v]) => !stored(k, v, got)).map(([k]) => k);
    if (got.api !== API || lost.length) { alarm(`This preview server is out of date and didn't save ${lost.join(', ') || 'everything'}. Stop it (Ctrl-C) and run retro again, then make the edit once more.`); continue; }
  }
  if (all.length && performance.now() - S.undoNote > 2500) status(`Saved ${all.map(([id]) => id).join(', ')}`);
}
export function stored(k, v, got) {                           // did the server keep what we sent? (empty values = "remove it")
  const empty = v == null || v === false && k !== 'on' || v === 0 || (Array.isArray(v) && !v.length) || (typeof v === 'object' && v && !Array.isArray(v) && !Object.keys(v).length)
    || (k === 'sounds' && !Object.keys(v.edit || {}).length && !(v.add || []).length) || (k === 'move' && !Object.values(v).some(x => (x || []).some(Boolean)));
  if (k === 'sfx') return v ? got.sfx === undefined : got.sfx === false;
  if (k === 'on') return (got.on !== false) === (v !== false);
  if (empty) return got[k] === undefined || got[k] === null;
  return got[k] !== undefined;
}
export function initApi() {
  setTimeout(() => { if (state.api !== API) alarm('This preview server is older than the page, so some edits won\'t save. Stop it (Ctrl-C) and run retro again.'); });
  addEventListener('beforeunload', e => { if (pending.size) { flush(); e.preventDefault(); } });
}
