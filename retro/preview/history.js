import { $, S, beats, status } from './state.js';
import { save } from './api.js';
import { persist } from './reset.js';
import { applyDepth, applyMove, ensureCut, refreshCues } from './stage.js';
import { buildSfxSoon, findCue } from './sounds.js';
import { renderAll } from './panel.js';

/* ---------- undo / redo ----------
   Every edit goes through save(), so that's where history is kept: each step is the before/after of the
   beats it touched (their whole editable state). Edits made in the same moment (a reset, a S.bulk change)
   are one step; repeated saves of the same kind on the same beat in quick succession (a drag, a slider,
   arrow-key nudges) fold into one. Undo/redo write the state back through save() like any other edit. */
export const editable = b => JSON.stringify({ on: b.on ?? null, move: b.move, time: b.time ?? null, ltime: b.ltime, hide: b.hide, behind: b.behind,
  sounds: b.sounds, sfxGain: b.sfxGain ?? null, sfx: b.sfx ?? null });
export const known = new Map(beats.map(b => [b.id, editable(b)]));     // each beat as of the last recorded step
export const undos = [], redos = [];

let moment = null, restoring = false;

export const WHAT = { move: 'move', time: 'beat timing', ltime: 'animation timing', sounds: 'sound edit', hide: 'show / hide', behind: 'behind me', on: 'beat on/off', sfxGain: 'beat level', sfx: 'beat sound on/off' };
export function record(b, patch) {
  if (restoring) return;
  const before = known.get(b.id), after = editable(b);
  if (before === after) return;
  known.set(b.id, after);
  const kind = Object.keys(patch).sort().join(), now = performance.now();
  if (moment) { const it = moment.items.find(i => i.id === b.id); if (it) it.after = after; else moment.items.push({ id: b.id, before, after }); return; }
  const top = undos.at(-1);
  if (top && !redos.length && top.items.length === 1 && top.items[0].id === b.id && top.kind === kind && now - top.t < 700) { top.items[0].after = after; top.t = now; return; }
  moment = { items: [{ id: b.id, before, after }], kind, t: now, label: Object.keys(patch).length > 3 ? 'reset' : (WHAT[Object.keys(patch)[0]] || 'edit') };
  undos.push(moment); if (undos.length > 300) undos.shift();
  redos.length = 0;
  queueMicrotask(() => { moment = null; renderUndo(); });
}
export function restore(step, back) {
  restoring = true;
  try {
    for (const it of step.items) {
      const b = beats.find(x => x.id === it.id); if (!b) continue;
      const was = JSON.parse(known.get(b.id)), to = JSON.parse(back ? it.before : it.after);
      Object.assign(b, to);
      for (const k of ['on', 'time', 'sfxGain', 'sfx']) if (to[k] == null) delete b[k];
      known.set(b.id, back ? it.before : it.after);
      const changed = Object.keys(to).filter(k => JSON.stringify(to[k]) !== JSON.stringify(was[k]));
      if (changed.some(k => ['time', 'ltime', 'hide'].includes(k))) { persist(b); continue; }   // the beat's own timeline changes: rebuild it
      save(b, { on: b.on !== false, move: b.move, time: b.time || null, ltime: b.ltime, hide: b.hide, behind: b.behind, sounds: b.sounds, sfxGain: b.sfxGain || 0, sfx: b.sfx !== false });
      applyMove(b); applyDepth(b); if (b.ready) refreshCues(b);
      if (changed.includes('behind')) ensureCut();
    }
  } finally { restoring = false; }
  if (S.snd && !findCue(S.snd)) S.snd = null;
  if (S.sel && !beats.includes(S.sel.beat)) S.sel = null;
  renderAll(); buildSfxSoon(); renderUndo();
  const ids = [...new Set(step.items.map(i => i.id))];
  S.undoNote = performance.now();
  status(`${back ? 'Undid' : 'Redid'} ${step.label} · ${ids.length > 2 ? ids.length + ' beats' : ids.join(', ')}`);
}
export function undo() { const s = undos.pop(); if (!s) return status('Nothing to undo'); redos.push(s); restore(s, true); }
export function redo() { const s = redos.pop(); if (!s) return status('Nothing to redo'); undos.push(s); restore(s, false); }
export function renderUndo() {
  const u = undos.at(-1), r = redos.at(-1);
  Object.assign($('#pUndo'), { disabled: !u, title: u ? `Undo ${u.label} (⌘Z)` : 'Nothing to undo' });
  Object.assign($('#pRedo'), { disabled: !r, title: r ? `Redo ${r.label} (⇧⌘Z)` : 'Nothing to redo' });
}
export function initHistory() {
  $('#pUndo').onclick = undo;
  $('#pRedo').onclick = redo;
}
