import { $, S, beats, esc } from './state.js';
import { save } from './api.js';
import { undo } from './history.js';
import { rebuild } from './stage.js';
import { laneOf } from './timeline.js';
import { buildSfxSoon, findCue } from './sounds.js';
import { renderAll } from './panel.js';

/* ---------- reset to defaults (asks first; Undo for a while after) ---------- */
export const RESETS = [
  ['move',    'Animation positions', 'where you dragged them on the video', b => Object.keys(b.move).filter(k => (b.move[k] || []).some(Boolean)).length,
              b => { b.move = {}; }],
  ['time',    'Beat timing', 'beat trims and stretches', b => (b.time ? 1 : 0), b => { delete b.time; }],
  ['ltime',   'Animation timing', 'animations moved, trimmed or stretched inside a beat', b => Object.keys(b.ltime).length, b => { b.ltime = {}; }],
  ['hide',    'Hidden animations', 'show them all again', b => b.hide.length, b => { b.hide = []; }],
  ['behind',  'Animations behind you', 'bring them back in front', b => b.behind.length, b => { b.behind = []; }],
  ['on',      'Beats switched off', 'switch them all back on', b => (b.on === false ? 1 : 0), b => { b.on = true; }],
  ['sedit',   'Sound edits', 'swapped sounds, volume, mute, length', b => Object.values(b.sounds.edit || {}).filter(e => e.s || e.gain || e.off || e.dur).length,
              b => { for (const e of Object.values(b.sounds.edit || {})) { delete e.s; delete e.gain; delete e.off; delete e.dur; } }],
  ['spos',    'Sound positions', 'sounds you slid along the timeline', b => Object.values(b.sounds.edit || {}).filter(e => e.shift).length,
              b => { for (const e of Object.values(b.sounds.edit || {})) delete e.shift; }],
  ['sadd',    'Added sounds', 'remove the sounds you added', b => (b.sounds.add || []).length, b => { b.sounds.add = []; }],
  ['level',   'Beat sound levels', 'beat volume sliders, beats muted', b => (b.sfxGain ? 1 : 0) + (b.sfx === false ? 1 : 0), b => { delete b.sfxGain; delete b.sfx; }],
  ['zoom',    'Zooms', "zoom settings and punch-ins, back to the project's default", b => (b.zoom ? 1 : 0), b => { b.zoom = null; }],
];
let resetScope = 'all', resetAsk = null, undoT = null;
export const scopeBeats = () => (resetScope === 'beat' && S.cur ? [S.cur] : beats);
export function persist(b) {                                  // write a beat's whole editable state, then rebuild it
  for (const [k, e] of Object.entries(b.sounds.edit || {})) if (!Object.keys(e).length) delete b.sounds.edit[k];
  save(b, { on: b.on !== false, move: b.move, time: b.time || null, ltime: b.ltime, hide: b.hide, behind: b.behind, sounds: b.sounds, sfxGain: b.sfxGain || 0, sfx: b.sfx !== false, zoom: b.zoom || null });
  for (const k of [...laneOf.keys()]) if (k.startsWith(b.id + '|')) laneOf.delete(k);
  if (b.ready) rebuild(b);
}
export function renderReset() {
  const m = $('#resetMenu'), bs = scopeBeats();
  const counts = RESETS.map(([id, , , count]) => bs.reduce((n, b) => n + count(b), 0)), total = counts.reduce((a, c) => a + c, 0);
  const scopeName = resetScope === 'beat' && S.cur ? S.cur.id : 'all beats';
  const row = (id, label, help, n) => `
    <div class="rs-row ${n ? '' : 'none'} ${id === 'all' ? 'all' : ''}">
      <span class="what">${label}<small>${help}</small></span>
      <span class="n">${n ? `${n} change${n > 1 ? 's' : ''}` : 'nothing to reset'}</span>
      <button class="btn sm" data-r="${id}" ${n ? '' : 'disabled'}>Reset</button>
      ${resetAsk === id ? `<div class="rs-confirm"><span>Reset ${label.toLowerCase()} in ${scopeName}? ${n} change${n > 1 ? 's' : ''} go back to how they were written.</span>
        <button class="btn sm" data-r="no">Cancel</button><button class="btn sm warnb" data-r="yes">Yes, reset</button></div>` : ''}
    </div>`;
  m.innerHTML = `<h3>Reset to defaults</h3><div class="sub">Puts things back the way the beats were written. You'll be asked first, and can undo right after.</div>
    <div class="seg" style="margin-bottom:8px"><button data-scope="all" class="${resetScope === 'all' ? 'on' : ''}">All beats</button><button data-scope="beat" class="${resetScope === 'beat' ? 'on' : ''}" ${S.cur ? '' : 'disabled'}>Only ${S.cur ? S.cur.id : 'this beat'}</button></div>
    ${RESETS.map(([id, label, help], i) => row(id, label, help, counts[i])).join('')}
    ${row('all', 'Everything', 'all of the above', total)}`;
}
export function openReset() { resetAsk = null; renderReset(); $('#resetMenu').style.display = 'block'; const r = $('#pReset').getBoundingClientRect(); $('#resetMenu').style.left = Math.max(10, r.right - 440) + 'px'; setTimeout(() => addEventListener('pointerdown', resetOutside, true)); }
export function closeReset() { $('#resetMenu').style.display = 'none'; resetAsk = null; removeEventListener('pointerdown', resetOutside, true); }
export function resetOutside(e) { if (!$('#resetMenu').contains(e.target) && e.target !== $('#pReset')) closeReset(); }

export function toast(msg, undo) {
  const t = $('#toast'); clearTimeout(undoT);
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button class="btn sm" id="undoBtn">Undo</button>' : ''}<button class="btn ghostb sm" id="toastX">✕</button>`;
  t.style.display = 'flex';
  const hide = () => { t.style.display = 'none'; };
  if (undo) $('#undoBtn').onclick = () => { hide(); clearTimeout(undoT); undo(); };
  $('#toastX').onclick = hide;
  undoT = setTimeout(hide, 12000);
}
export function initReset() {
  $('#pReset').onclick = () => ($('#resetMenu').style.display === 'block' ? closeReset() : openReset());
  $('#resetMenu').addEventListener('click', e => {
    const sc = e.target.closest('[data-scope]'); if (sc && !sc.disabled) { resetScope = sc.dataset.scope; resetAsk = null; renderReset(); return; }
    const r = e.target.closest('[data-r]')?.dataset.r; if (!r) return;
    if (r === 'no') { resetAsk = null; renderReset(); return; }
    if (r !== 'yes') { resetAsk = r; renderReset(); return; }
    // confirmed
    const kinds = resetAsk === 'all' ? RESETS : RESETS.filter(x => x[0] === resetAsk), label = resetAsk === 'all' ? 'everything' : kinds[0][1].toLowerCase();
    const bs = scopeBeats().filter(b => kinds.some(([, , , count]) => count(b)));
    const n = bs.reduce((a, b) => a + kinds.reduce((c, k) => c + k[3](b), 0), 0);
    for (const b of bs) { for (const k of kinds) k[4](b); persist(b); }
    if (S.snd && !findCue(S.snd)) S.snd = null;
    S.sel = null; closeReset(); renderAll(); buildSfxSoon();
    toast(`Reset ${label} · ${n} change${n > 1 ? 's' : ''} in ${bs.length} beat${bs.length > 1 ? 's' : ''}`, undo);
  });
}
