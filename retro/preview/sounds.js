import { mix, RATE, SOUNDS, PACKS, INFO, CATEGORIES } from './synth.mjs';
import { $, DUR, S, beats, dB, esc, f2, opts, pop, r3, state, status, v } from './state.js';
import { save } from './api.js';
import { refreshCues, seek } from './stage.js';
import { renderTimeline } from './timeline.js';
import { renderAll, renderInspector, renderList } from './panel.js';

/* ---------- sound library ---------- */
export const PACK_OF = {};                                    // sound → its set's name
for (const [p, names] of Object.entries(PACKS)) for (const n of names) PACK_OF[n] = p;
export const PACK_LABEL = new Proxy({}, { get: (_, k) => k });   // (set names are already labels)
/* Every sound gets its own colour, from the brand palette: the 14 world colours first, then lighter,
   darker and slightly hue-shifted versions of them. Assigned in library order, so a sound keeps its
   colour as new sounds are added after it. */
export const BRAND = ['#F386A1', '#09AEA1', '#E8B53E', '#6FA3E0', '#D45BB6', '#A6C94B', '#F4894B', '#AE98E6', '#03AA5C', '#EF6B5B', '#3D6CB9', '#ABBAB9', '#CFE3F5', '#C77A55'];
export const RINGS = [[0, 0], [10, 14], [-10, -14], [18, 24], [-18, -20], [26, 7], [-26, -7], [34, 14]];   // [hue shift°, lightness shift %]
export function hsl(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l * 100];
  const sat = d / (1 - Math.abs(2 * l - 1)), h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, sat * 100, l * 100];
}
export const COLOR = {}, INK = {};
[...Object.keys(SOUNDS), 'blip'].forEach((n, i) => {
  const [h, sat, l] = hsl(BRAND[i % BRAND.length]), [dh, dl] = RINGS[Math.floor(i / BRAND.length) % RINGS.length];
  const L = Math.max(28, Math.min(84, l + dl));
  COLOR[n] = `hsl(${Math.round((h + dh + 360) % 360)} ${Math.round(Math.max(30, sat))}% ${Math.round(L)}%)`;
  INK[n] = L > 58 ? '#141416' : '#fbfbfd';               // readable text on the block
});
export const col = n => COLOR[n] || '#8f96a3', ink = n => INK[n] || '#141416';
export const dot = n => `<span class="sdot" style="background:${col(n)}"></span>`;
export const soundLen = n => (SOUNDS[n] ? SOUNDS[n].length / RATE : 0.02);
export const ac = new AudioContext({ sampleRate: RATE });
export function audition(name, vol = 0, freq, dur) {         // play one sound on its own, at its level
  ac.resume();
  const m = mix([{ t: 0.02, s: name, vol, freq, dur }], soundLen(name) + 0.1, state.sfxGain);
  const buf = ac.createBuffer(1, m.length, RATE); buf.copyToChannel(m, 0);
  const s = ac.createBufferSource(); s.buffer = buf; s.connect(ac.destination); s.start();
}

/* ---------- sound picker: categories, each one's sounds fly out beside them ---------- */

export function openPicker(anchor, { current, title, onPick, verb = 'Add' }) {
  closePicker();
  const el = document.createElement('div'); el.id = 'picker';
  const st = { cat: INFO[current]?.[0] || CATEGORIES[0], q: '', on: null };
  el.innerHTML = `<div class="pk-head"><input placeholder="Search: a moment or feeling (win, warm, fail funny, reveal…)" spellcheck="false"><span class="t">${esc(title)}</span></div>
    <div class="pk-body"><div class="pk-cats"></div><div class="pk-list"></div></div>
    <div class="pk-foot">Click a sound to hear it · ${verb} puts it in · ↑↓ to step through, Enter to ${verb.toLowerCase()}</div>`;
  document.body.append(el);
  const list = () => {
    const q = st.q.trim().toLowerCase();
    const names = q ? (() => { const ws = q.split(/\s+/), toks = n => `${n} ${INFO[n].join(' ')} ${PACK_OF[n] || ''}`.toLowerCase().split(/[^a-z0-9]+/),
                          sc = n => ws.filter(w => toks(n).some(t => t === w || (w.length >= 3 && t.startsWith(w)))).length;   // as you type, word starts count
                        return Object.keys(INFO).filter(n => sc(n) > 0).sort((a, b) => sc(b) - sc(a)); })()     // best matches first
                    : Object.keys(INFO).filter(n => INFO[n][0] === st.cat);
    el.querySelector('.pk-cats').innerHTML = CATEGORIES.map(c => `<div class="pk-cat ${!q && c === st.cat ? 'on' : ''}" data-c="${c}">${c}<span class="n">${Object.values(INFO).filter(x => x[0] === c).length}</span><span class="chev">›</span></div>`).join('');
    el.querySelector('.pk-list').innerHTML = names.map(n => `<div class="pk-item ${n === current ? 'cur' : ''} ${n === st.on ? 'on' : ''}" data-n="${n}" title="Click to hear it">
        ${dot(n)}<b>${n}</b><span class="d">${esc(INFO[n][1])}<span class="tg">${(INFO[n][2] || '').split(' ').filter(Boolean).map(t => `<i class="${q && q.split(/\s+/).some(w => w.length && t.startsWith(w)) ? 'hit' : ''}">${esc(t)}</i>`).join('')}</span></span><span class="p">${PACK_LABEL[PACK_OF[n] || 'os']}</span>
        <button class="pk-add" data-add="${n}">${verb}</button></div>`).join('') || '<div class="pk-empty">Nothing matches.</div>';
  };
  const hear = n => {                                  // preview: play it and mark it as the one Enter would add
    st.on = n; audition(n);
    el.querySelectorAll('.pk-item').forEach(r => { r.classList.toggle('on', r.dataset.n === n); r.classList.toggle('playing', r.dataset.n === n); });
    clearTimeout(hear.t); hear.t = setTimeout(() => el.querySelectorAll('.pk-item.playing').forEach(r => r.classList.remove('playing')), soundLen(n) * 1000 + 100);
    el.querySelector(`.pk-item[data-n="${n}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  el.pick = n => { closePicker(); onPick(n); };
  el.step = d => { const ns = [...el.querySelectorAll('.pk-item')].map(r => r.dataset.n); if (!ns.length) return; const i = ns.indexOf(st.on); hear(ns[(i + d + ns.length) % ns.length] ?? ns[0]); };
  el.enter = () => { if (st.on) el.pick(st.on); };
  list();
  el.addEventListener('pointerover', e => { const c = e.target.closest('.pk-cat'); if (c && (st.cat !== c.dataset.c || st.q)) { st.cat = c.dataset.c; st.q = ''; el.querySelector('input').value = ''; list(); } });
  el.addEventListener('click', e => {
    const add = e.target.closest('[data-add]'); if (add) { el.pick(add.dataset.add); return; }
    const it = e.target.closest('.pk-item'); if (it) hear(it.dataset.n);
  });
  el.querySelector('input').addEventListener('input', e => { st.q = e.target.value; list(); });
  // place it beside the anchor: to its left if there's room, otherwise above or below it
  const a = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  let x = a.left - w - 10, y = Math.min(innerHeight - h - 10, Math.max(10, a.top - 60));
  if (x < 10) { x = Math.max(10, Math.min(innerWidth - w - 10, a.left)); y = a.top > h + 20 ? a.top - h - 8 : Math.min(innerHeight - h - 10, a.bottom + 8); }
  Object.assign(el.style, { left: x + 'px', top: y + 'px' });
  el.querySelector('input').focus();
  S.picker = el;
  setTimeout(() => addEventListener('pointerdown', outside, true));
}
export function outside(e) { if (S.picker && !S.picker.contains(e.target)) closePicker(); }
export function closePicker() { if (S.picker) { S.picker.remove(); S.picker = null; } removeEventListener('pointerdown', outside, true); }

/* ---------- sound edits ---------- */
export const findCue = s => s && s.beat.cuesAll?.find(q => q.key === s.key);
export const written = (b, key) => b.win.R.cuesWritten.find(q => q.key === key);
export function tidy(b) {                                     // drop empty edits so retro.json stays clean
  for (const [key, e] of Object.entries(b.sounds.edit)) {
    if (e.s && e.s === written(b, key)?.s) delete e.s;
    if (!e.gain) delete e.gain; if (!e.off) delete e.off; if (!e.dur) delete e.dur;
    if (!e.shift || Math.abs(e.shift) < 0.001) delete e.shift;
    if (!Object.keys(e).length) delete b.sounds.edit[key];
  }
}
export function soundsChanged(b, { persist = true, quiet = false } = {}) {
  tidy(b); refreshCues(b); buildSfxSoon();
  if (persist) save(b, { sounds: b.sounds }, 200);
  if (quiet) return;                                   // mid-drag on a slider: leave the controls alone
  renderInspector(); renderList(); renderTimeline(); renderPop();
}
export const editOf = (b, q) => (q.added ? b.sounds.add[+q.key.slice(4)] : (b.sounds.edit[q.key] ||= {}));
export const level = (b, q) => { const e = q.added ? b.sounds.add[+q.key.slice(4)] : (b.sounds.edit[q.key] || {}); return q.added ? (e.vol || 0) : (e.gain || 0); };
export function setEffect(b, q, name) { const e = editOf(b, q); e.s = name; if (e.dur && e.dur >= soundLen(name)) delete e.dur; soundsChanged(b); audition(name, q.vol); }
export function setLevel(b, q, val, persist) { const e = editOf(b, q); if (q.added) e.vol = val; else e.gain = val; soundsChanged(b, { persist, quiet: !persist }); }
export function selectMany(list, add) {                        // list of { beat, key }; add = keep what's selected
  if (!add) S.msel = new Map();
  for (const x of list) { const id = `${beats.indexOf(x.beat)}|${x.key}`; if (add && S.msel.has(id) && list.length === 1) S.msel.delete(id); else S.msel.set(id, x); }
  if (S.msel.size === 1) { const [x] = S.msel.values(); S.msel = new Map(); selectSound(x.beat, x.key, { reveal: false }); }
  else S.snd = null;
  S.bulk = null; renderAll();
}
export function bulkBase() {                                    // each selected sound's level when this volume move began
  if (S.bulk) return S.bulk;
  const base = new Map();
  for (const [id, { beat: b, key }] of S.msel) { const q = b.cuesAll?.find(c => c.key === key); if (q) base.set(id, level(b, q)); }
  return (S.bulk = { delta: 0, base });
}
export function bulkLevel(delta, persist) {                     // everything selected moves by the same dB, from where it was
  const B = bulkBase(); B.delta = delta;
  const touched = new Set();
  for (const [id, { beat: b, key }] of S.msel) {
    const q = b.cuesAll?.find(c => c.key === key); if (!q || !B.base.has(id)) continue;
    const v = Math.max(-30, Math.min(12, B.base.get(id) + delta)), e = editOf(b, q);
    if (q.added) e.vol = v; else e.gain = v;
    touched.add(b);
  }
  for (const b of touched) soundsChanged(b, { persist, quiet: true });
  if (persist) { renderTimeline(); renderInspector(); }
}
export function bulkOff(off) {
  const touched = new Set();
  for (const { beat: b, key } of S.msel.values()) { const q = b.cuesAll?.find(c => c.key === key); if (q) { editOf(b, q).off = off; touched.add(b); } }
  for (const b of touched) soundsChanged(b, { quiet: true });
  renderAll();
}
export function setDur(b, q, d) { const e = editOf(b, q); if (!d || d >= soundLen(q.s) - 0.01) delete e.dur; else e.dur = r3(d); soundsChanged(b); }
export function toggleOff(b, q) { const e = editOf(b, q); e.off = !e.off; soundsChanged(b); }
export function revert(b, q) { delete b.sounds.edit[q.key]; soundsChanged(b); }
export function removeAdded(b, q) { b.sounds.add.splice(+q.key.slice(4), 1); S.snd = null; soundsChanged(b); }
export function moveSound(b, q, outT) {                       // any sound slides within its beat; it still moves with the beat's timing
  const t0 = Math.max(b.src.start, Math.min(b.src.end - 0.02, b.win.R.unmap(Math.max(b.start, Math.min(b.end - 0.02, outT)), q.layer)));
  if (q.added) editOf(b, q).t = r3(t0);
  else editOf(b, q).shift = r3(t0 - written(b, q.key).t);
  soundsChanged(b);
}
export function unshift(b, q) { const e = b.sounds.edit[q.key]; if (e) delete e.shift; soundsChanged(b); }
export function beatAt(t) {                                   // which beat a new sound at t belongs to
  const has = b => b.ready && t >= b.start && t < b.end;
  return (S.cur && has(S.cur) && S.cur) || beats.find(b => has(b) && b.on !== false) || beats.find(has) || null;
}
export function addSoundAt(t, name) {
  const b = beatAt(t);
  if (!b) { status('No animation plays here, so there is nothing to attach a sound to'); return; }
  const layer = soundLayer(b, t);
  b.sounds.add.push({ t: r3(b.win.R.unmap(t, layer)), s: name, vol: 0, layer });
  S.cur = b; S.snd = { beat: b, key: `add:${b.sounds.add.length - 1}` };
  soundsChanged(b); audition(name);
  if (!findCue(S.snd)) status(`Added ${name}, but ${layer} isn't playing at ${f2(t)} s, so it won't be heard there. Undo (⌘Z) and add it where an animation shows.`);
}
/* A sound belongs to an animation (layer): it moves with it, and goes when the animation is hidden or cut.
   So attach a new one to an animation that's actually playing at t: the selected one if it is, else the first
   that is, else one that isn't cut (an uncut animation keeps its sounds anywhere in the beat). */
export function soundLayer(b, t) {
  const shown = (b.layers || ['main']).filter(L => !b.hide.includes(L));
  const first = S.sel && S.sel.beat === b && shown.includes(S.sel.layer) ? [S.sel.layer] : [];
  const covers = L => { const s = b.L?.[L]; return !s || (t >= s.start - 0.02 && t <= s.end); };
  const uncut = L => !b.ltime[L]?.crop;
  const order = [...first, ...shown];
  return order.find(covers) || order.find(uncut) || shown[0] || 'main';
}

export function selectSound(b, key, { hear = true, reveal = true } = {}) {   // select a sound and put the playhead exactly on its start
  S.snd = { beat: b, key }; S.cur = b;
  const q = findCue(S.snd);
  if (q) { seek(q.t, { reveal }); if (hear) audition(q.s, q.vol + (b.sfxGain || 0), q.freq, q.dur); }
}

/* ---------- the sound editor (pops out to the left of the side panel) ---------- */
export function renderPop() {
  if (S.msel.size > 1) { renderBulk(); return; }
  const q = findCue(S.snd);
  if (!q) { pop.style.display = 'none'; return; }
  const b = S.snd.beat, lv = level(b, q), full = soundLen(q.s), len = q.dur || full;
  pop.innerHTML = `<div class="popin">
    <div class="shead">${dot(q.s)}<b>${esc(q.s)}</b>
      <span class="sub num">${b.id.slice(0, 2)} ${q.layer || 'main'}${q.added ? ' · added' : ''}</span>
      <button class="btn ghostb sm x" data-a="sclose" title="Close (Esc)">✕</button></div>
    <div class="line"><span class="lab">Sound</span>
      <button class="pickbtn" data-a="spick">${dot(q.s)}<b>${esc(q.s)}</b><span class="desc">${esc(INFO[q.s]?.[1] || '')}</span><span class="chev">›</span></button>
      <button class="btn sm" data-a="saudition" title="Listen">▶</button></div>
    <div class="line"><span class="lab">Volume</span><input type="range" data-a="slevel" min="-24" max="12" step="0.5" value="${lv}">
      <span class="val num" id="slevelV">${dB(lv)}</span></div>
    <div class="line"><span class="lab">Starts</span>
        <button class="btn sm" data-a="stime" data-d="-0.05" title="0.05 s earlier">−</button><span class="num" style="min-width:52px;text-align:center">${f2(q.t)} s</span>
        <button class="btn sm" data-a="stime" data-d="0.05" title="0.05 s later">+</button><button class="btn sm" data-a="shere" title="Move it to the playhead">Playhead</button>
        ${q.shift ? '<button class="btn ghostb sm" data-a="sunshift" title="Back to where its animation put it">Reset</button>' : ''}</div>
    <div class="line"><span class="lab">Length</span><span class="num" style="flex:1">${f2(len)} s${q.dur ? ` <span class="badge">of ${f2(full)}</span>` : ''}</span>
      ${q.dur ? '<button class="btn sm" data-a="sfull">Full length</button>' : '<span class="hint" style="margin:0">drag its right edge to shorten</span>'}</div>
    <div class="line"><span class="lab">Plays</span><span style="flex:1"></span><button class="sw ${q.off ? '' : 'on'}" data-a="soff" title="Switch off to mute this sound"></button></div>
    <div class="line" style="justify-content:flex-end;gap:6px">
      ${q.added ? '<button class="btn sm danger" data-a="sdelete">Delete sound</button>' : q.edited ? '<button class="btn sm" data-a="srevert">Revert to original</button>' : '<span class="hint" style="margin:0">Drag it on the timeline to move it. It stays with its beat when you trim or stretch.</span>'}
    </div></div>`;
  pop.style.display = 'block';
  placePop();
}
export function renderBulk() {
  const list = [...msel.values()].map(({ beat: b, key }) => ({ b, q: b.cuesAll?.find(c => c.key === key) })).filter(x => x.q);
  const nb = new Set(list.map(x => x.b)).size, d = S.bulk?.delta || 0, muted = list.filter(x => x.q.off).length;
  pop.innerHTML = `<div class="popin">
    <div class="shead"><b>${list.length} sounds</b><span class="sub">in ${nb} beat${nb > 1 ? 's' : ''}${muted ? ` · ${muted} muted` : ''}</span>
      <button class="btn ghostb sm x" data-a="bnone" title="Select none (Esc)">✕</button></div>
    <div class="line"><span class="lab">Volume</span>
      <button class="btn sm" data-a="bstep" data-d="-1" title="1 dB quieter">−</button>
      <input type="range" data-a="blevel" min="-18" max="18" step="0.5" value="${d}">
      <button class="btn sm" data-a="bstep" data-d="1" title="1 dB louder">+</button>
      <span class="val num" id="blevelV">${dB(d)}</span></div>
    <p class="hint" style="margin:2px 0 6px">Moves every selected sound up or down together, from where each one was.</p>
    <div class="line"><span class="lab">Plays</span><span style="flex:1"></span>
      <button class="btn sm" data-a="bmute">Mute all</button><button class="btn sm" data-a="bunmute">Unmute all</button></div>
    <div class="bulk-list">${list.map(({ q }) => `<span>${dot(q.s)}${esc(q.s)} <span class="num" style="border:0;padding:0;background:none">${f2(q.t)}</span></span>`).join('')}</div>
    <p class="hint">Drag a box on the sound lanes to select · ⇧ adds · Esc clears</p></div>`;
  pop.style.display = 'block';
  placePop();
}
export function placePop() {                                  // level with its row in the side panel, never below the player panel
  if (pop.style.display === 'none') return;
  const top = 62, floor = $('footer').getBoundingClientRect().top - 10;
  pop.style.maxHeight = (floor - top) + 'px'; if (pop.firstElementChild) pop.firstElementChild.style.maxHeight = (floor - top - 2) + 'px';
  const row = $('#insp .srow.sel'), ins = $('#insp').getBoundingClientRect(), h = pop.offsetHeight;
  let y = 120, arrow = 24;
  if (row) { const r = row.getBoundingClientRect(); if (r.top >= ins.top && r.bottom <= ins.bottom) { y = r.top - 22; arrow = 22; } }
  const yc = Math.max(top, Math.min(floor - h, y));
  arrow += y - yc;
  pop.style.top = yc + 'px'; pop.style.setProperty('--arrow', Math.max(14, Math.min(h - 26, arrow)) + 'px');
}
export function soundAction(a, btn) {
  const q = findCue(S.snd), b = S.snd?.beat; if (!q) return;
  if (a === 'sclose') { S.snd = null; renderAll(); }
  else if (a === 'spick') openPicker(btn, { current: q.s, title: `replace ${q.s}`, verb: 'Use', onPick: n => setEffect(b, findCue(S.snd), n) });
  else if (a === 'saudition') audition(q.s, q.vol + (b.sfxGain || 0), q.freq, q.dur);
  else if (a === 'soff') toggleOff(b, q);
  else if (a === 'sfull') setDur(b, q, 0);
  else if (a === 'srevert') revert(b, q);
  else if (a === 'sdelete') removeAdded(b, q);
  else if (a === 'sunshift') unshift(b, q);
  else if (a === 'stime') { moveSound(b, q, q.t + +btn.dataset.d); seek(findCue(S.snd).t, { reveal: false }); }
  else if (a === 'shere') moveSound(b, q, v.currentTime);
}

/* ---------- sound effects: the export's synth, in the browser ---------- */
let sfxBuf = null, src = null, sfxT = null;
export function buildSfx() {
  if (!beats.every(b => b.ready)) return;
  const cues = beats.filter(b => b.on !== false && b.sfx !== false).flatMap(b => b.cues.map(c => ({ ...c, vol: (c.vol || 0) + (b.sfxGain || 0) })));
  const m = mix(cues, DUR, state.sfxGain);
  sfxBuf = ac.createBuffer(1, m.length, RATE); sfxBuf.copyToChannel(m, 0);
  restartSfx();
}
export function buildSfxSoon() { clearTimeout(sfxT); sfxT = setTimeout(buildSfx, 120); }
export function restartSfx() {
  if (src) { src.stop(); src = null; }
  if (v.paused || !sfxBuf || !opts.sfx) return;
  src = ac.createBufferSource(); src.buffer = sfxBuf; src.connect(ac.destination);
  src.start(0, v.currentTime);
}
export function initSounds() {
  $('#addSnd').onclick = e => openPicker(e.currentTarget, { title: `at ${f2(v.currentTime)} s`, onPick: n => addSoundAt(v.currentTime, n) });
  pop.addEventListener('click', e => {
    const btn = e.target.closest('[data-a]'); if (!btn) return;
    const a = btn.dataset.a;
    if (a === 'bnone') { S.msel = new Map(); S.bulk = null; renderAll(); return; }
    if (a === 'bstep') { const d = Math.max(-18, Math.min(18, (S.bulk?.delta || 0) + +btn.dataset.d)); bulkLevel(d, true); renderBulk(); return; }
    if (a === 'bmute') { bulkOff(true); return; }
    if (a === 'bunmute') { bulkOff(false); return; }
    soundAction(a, btn);
  });
  pop.addEventListener('input', e => {
    if (e.target.dataset.a === 'blevel') { $('#blevelV').textContent = dB(+e.target.value); bulkLevel(+e.target.value, false); return; }
    if (e.target.dataset.a !== 'slevel') return;
    const q = findCue(S.snd); if (!q) return;
    $('#slevelV').textContent = dB(+e.target.value); setLevel(S.snd.beat, q, +e.target.value, false);
  });
  pop.addEventListener('change', e => {
    if (e.target.dataset.a === 'blevel') { bulkLevel(+e.target.value, true); renderBulk(); return; }
    if (e.target.dataset.a !== 'slevel') return;
    const q = findCue(S.snd); if (!q) return;
    setLevel(S.snd.beat, q, +e.target.value, true); const c = findCue(S.snd); audition(c.s, c.vol + (S.snd.beat.sfxGain || 0), c.freq, c.dur);
  });
  v.addEventListener('play', restartSfx);
  v.addEventListener('pause', restartSfx);
  v.addEventListener('seeked', restartSfx);
  v.addEventListener('ended', restartSfx);
}
