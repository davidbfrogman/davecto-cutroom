import { $, S, beats, opts } from './state.js';
import { initApi, save } from './api.js';
import { initHistory, redo, undo } from './history.js';
import { initReset, toast } from './reset.js';
import { applyMove, ensureCut, guides, initStage, layout, mount, nudge, togglePlay } from './stage.js';
import { initTimeline, trimToPlayhead } from './timeline.js';
import { closePicker, initSounds, restartSfx } from './sounds.js';
import { initPanel, renderAll } from './panel.js';
import { initStudio } from './studio.js';
import { initPrep } from './prep.js';
import { initIg } from './ig.js';
import { autoZoomAll } from './zoom.js';

// Retro preview: the entry point. Each module exports an init() that wires its listeners; the order in
// the start-up sequence at the bottom is the page's start-up order (the same as it was in one file).

/* ---------- header toggles ---------- */
function initHeader() {
  const pills = { sfx: $('#pSfx'), zone: $('#pZone'), ig: $('#pIg'), snapV: $('#pSnapV'), snapH: $('#pSnapH') };
  for (const [key, el] of Object.entries(pills)) {
    el.classList.toggle('on', opts[key]);
    el.addEventListener('click', () => {
      opts[key] = !opts[key]; el.classList.toggle('on', opts[key]); localStorage.setItem('retro.' + key, opts[key] ? '1' : '0');
      if (key === 'sfx') restartSfx();
      guides();
    });
  }
  setTool(S.tool);
  $('#toolTrim').onclick = () => setTool('trim');
  $('#toolStretch').onclick = () => setTool('stretch');
  $('#pZoomAll').onclick = () => { const n = autoZoomAll(); renderAll(); toast(`Auto zoom on ${n} beat${n > 1 ? 's' : ''}: 100→125%, the opening beat pops`, undo); };
}
function setTool(t) { S.tool = t; localStorage.setItem('retro.tool', t); $('#toolTrim').classList.toggle('on', t === 'trim'); $('#toolStretch').classList.toggle('on', t === 'stretch'); }



/* ---------- keyboard ---------- */
function initKeys() {
  addEventListener('keydown', e => {
    if (S.picker) {
      if (e.key === 'Escape') closePicker();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); S.picker.step(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'Enter') { e.preventDefault(); S.picker.enter(); }
      return;
    }
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') { if (e.key === 'Enter') e.target.blur(); return; }
    const z = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && (z === 'z' || z === 'y')) { e.preventDefault(); (z === 'y' || e.shiftKey ? redo : undo)(); return; }
    const s = e.shiftKey ? 5 : 0.5;
    const keys = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] };
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (keys[e.key] && S.sel && e.target.type !== 'range') { e.preventDefault(); nudge(...keys[e.key]); }
    else if (e.key === '[' || e.key === ']') trimToPlayhead(S.cur, e.key === ']' ? 1 : 0);
    else if ((e.key === 'r' || e.key === 'R') && S.sel) { delete S.sel.beat.move[S.sel.layer]; applyMove(S.sel.beat); save(S.sel.beat, { move: S.sel.beat.move }); renderAll(); }
    else if (e.key === 'Escape' && (S.sel || S.snd || S.msel.size)) { S.sel = null; S.snd = null; S.msel = new Map(); S.bulk = null; renderAll(); }
  });
}

/* ---------- start-up ---------- */
await initPrep();                                      // a project still being set up says so (and reloads when it's ready)
$('#v').src = 'video.mp4';                             // only now: before this it may not exist yet
initApi();
initIg();
initHeader();
initReset();
S.cur = beats[0] || null;                              // the inspector starts on the first beat, not whichever loads first
for (const b of beats) mount(b);
ensureCut();
initHistory();
initPanel();
initSounds();
initTimeline();
initStage();
initKeys();
initStudio();
renderAll();
layout();
