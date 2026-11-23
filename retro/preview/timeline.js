import { $, DUR, H, S, W, beats, dB, esc, f2, r3, state, status, tlInner, tlScroll, v } from './state.js';
import { save } from './api.js';
import { rebuild, seek } from './stage.js';
import { col, findCue, ink, moveSound, renderPop, selectMany, selectSound, setDur, soundLen } from './sounds.js';
import { pick, renderAll, renderInspector, renderList } from './panel.js';

/* ---------- timing: drag a beat's edges ---------- */
export function applyEdge(b, edge, t, mode) {                 // trim = crop at normal speed; stretch = retime to fit
  const src = [b.src.start, b.src.end], R0 = b.time?.retime || src, C0 = b.time?.crop;
  const time = { ...(b.time || {}) };
  if (mode === 'trim') {
    const c = [...(C0 || [b.start, b.end])]; c[edge] = r3(Math.max(R0[0], Math.min(R0[1], t)));
    if (c[1] - c[0] < 0.2) return;
    if (Math.abs(c[0] - R0[0]) < 0.005 && Math.abs(c[1] - R0[1]) < 0.005) delete time.crop; else time.crop = c;
  } else {
    const shown = edge ? b.end : b.start, d = t - shown, r = [...R0]; r[edge] = r3(r[edge] + d);
    if (r[1] - r[0] < 0.2) return;
    if (C0) { const c = [...C0]; c[edge] = r3(c[edge] + d); time.crop = c; }
    if (Math.abs(r[0] - src[0]) < 0.005 && Math.abs(r[1] - src[1]) < 0.005) delete time.retime; else time.retime = r;
  }
  b.time = Object.keys(time).length ? time : undefined;
  const s0 = b.start, e0 = b.end; if (edge) b.end = t; else b.start = t;
  if (mode !== 'trim') { shiftLocal(b, s0, e0, b.start, b.end); for (const x of Object.values(b.L || {})) { const f = v => b.start + (v - s0) * (b.end - b.start) / (e0 - s0); x.start = f(x.start); x.end = f(x.end); } }
  else for (const x of Object.values(b.L || {})) { x.start = Math.max(x.start, b.start); x.end = Math.min(x.end, b.end); }
  save(b, { time: b.time || null }); renderTimeline(); rebuild(b);
}
/* One animation (a layer) inside a beat: retro.json "ltime": { layer: { retime: [a, b], crop: [c, d] } } in the
   beat's written seconds. Moving shifts it (and its sounds); Stretch fits its whole span to the new edges;
   Trim hides it outside them. The beat grows if an animation moves past its edges. */
export function setLtime(b, L, lt) {
  const x = b.L[L], near = (p, q) => p && q && Math.abs(p[0] - q[0]) < 0.005 && Math.abs(p[1] - q[1]) < 0.005;
  if (lt.retime && near(lt.retime, x.nat)) delete lt.retime;
  if (lt.crop && lt.crop[1] - lt.crop[0] < 0.1) return;
  if (Object.keys(lt).length) b.ltime[L] = lt; else delete b.ltime[L];
  save(b, { ltime: b.ltime }); renderTimeline(); rebuild(b);
}
/* Show an edit on the timeline straight away (the rebuilt beat replaces these numbers a moment later):
   the block lands where it was dropped and its sounds go with it, instead of snapping back meanwhile. */
export function shiftLocal(b, s0, e0, s1, e1, keep = q => true) {
  const k = (e1 - s1) / Math.max(1e-6, e0 - s0);
  for (const q of b.cuesAll || []) if (keep(q) && q.t >= s0 - 0.2 && q.t <= e0 + 0.05) q.t = s1 + (q.t - s0) * k;
}
export const wsec = (b, t) => b.win.R.unmap(t);               // video seconds → the beat's written seconds
export function moveLayer(b, L, dt) {
  const x = b.L[L], lt = { ...(b.ltime[L] || {}) }, d = wsec(b, x.start + dt) - wsec(b, x.start);
  shiftLocal(b, x.start, x.end, x.start + dt, x.end + dt, q => (q.layer || 'main') === L);
  b.L[L] = { ...x, start: x.start + dt, end: x.hold ? Math.max(x.end, x.start + dt) : x.end + dt };
  b.start = Math.min(b.start, b.L[L].start); if (!x.hold) b.end = Math.max(b.end, b.L[L].end);
  lt.retime = (lt.retime || x.retime).map(v => r3(v + d));
  if (lt.crop) lt.crop = lt.crop.map(v => r3(v + d));
  setLtime(b, L, lt);
  status(`Moved ${x.title || L} ${dt >= 0 ? '+' : ''}${dt.toFixed(2)} s`);
}
export function layerEdge(b, L, edge, t, mode) {
  const x0 = b.L[L];
  b.L[L] = { ...x0, [edge ? 'end' : 'start']: t };
  if (mode === 'stretch') shiftLocal(b, x0.start, x0.end, b.L[L].start, b.L[L].end, q => (q.layer || 'main') === L);
  const x = x0, lt = { ...(b.ltime[L] || {}) }, w = r3(wsec(b, t)), rt = [...(lt.retime || x.retime)];
  if (mode === 'stretch' && !(edge === 1 && x.hold)) {   // an animation that holds to the beat's end has no end to stretch: trim it
    const old = edge ? wsec(b, x.end) : wsec(b, x.start);
    rt[edge] = r3(rt[edge] + (w - old)); if (rt[1] - rt[0] < 0.2) return;
    lt.retime = rt;
  } else {
    const c = [...(lt.crop || [Math.min(rt[0], wsec(b, x.start)), Math.max(rt[1], wsec(b, x.end)) + (x.hold ? 60 : 0)])];
    c[edge] = w; lt.crop = c;
  }
  setLtime(b, L, lt);
}
export function trimToPlayhead(b, edge) { if (b?.ready) applyEdge(b, edge, v.currentTime, 'trim'); }

/* ---------- timeline: ruler, beats, sound lanes ---------- */

export const pps = () => (tlScroll.clientWidth / DUR) * S.zoom;  // px per second
export const FILM = 64;                                       // the filmstrip row (frames from the video, for finding your place)
export const RULER = 40, BEATS = 88, ANIM = 56, LANE = 48, MAXL = 60, TAIL = 150;   // row heights; TAIL = px shown after the video's end  // timeline row heights (px); sounds never pile up in one lane
let lanesN = 6;
export const laneOf = new Map(), laneHint = new Map();     // sticky lane per sound; the lane a dropped sound would like back

export function renderTimeline() {
  const P = pps(), X = t => t * P;
  lanesN = MAXL;                                       // packing room; only the lanes in use (or that fit) are drawn
  tlInner.style.width = Math.max(tlScroll.clientWidth, DUR * P + TAIL) + 'px';
  const step = [0.25, 0.5, 1, 2, 5, 10, 20].find(s => s * P >= 64) || 30;
  let ruler = '';
  for (let t = 0; t <= DUR; t += step) if (DUR - t > step * 0.6) ruler += `<div class="tick" style="left:${X(t)}px"><span class="num">${+t.toFixed(2)}s</span></div>`;
  ruler += `<div class="endmark" style="left:${X(DUR)}px" title="Nothing plays after the video ends: beats and sounds are cut here">END ${f2(DUR)}s</div>`;
  let blocks = '';
  for (const [i, b] of beats.entries()) {
    if (b.start == null) continue;
    if (b.src && (Math.abs(b.src.start - b.start) > 0.01 || Math.abs(b.src.end - b.end) > 0.01))
      blocks += `<div class="ghost" style="left:${X(b.src.start)}px;width:${X(b.src.end - b.src.start)}px" title="where ${b.id} was written"></div>`;
    const r = b.time?.retime, speed = r ? (b.src.end - b.src.start) / (r[1] - r[0]) : 1;
    const tags = `${Math.abs(speed - 1) > 0.005 ? `<span class="tag">${speed.toFixed(2)}×</span>` : ''}${b.time?.crop ? '<span class="tag">✂</span>' : ''}`;
    blocks += `<div class="blk ${b === S.cur ? 'sel' : ''} ${b.on === false ? 'off' : ''}" data-i="${i}" style="left:${X(b.start)}px;width:${Math.max(18, X(b.end - b.start) - 2)}px" title="${b.id} · ${f2(b.start)}–${f2(b.end)}">
      <span class="h h0" data-edge="0"></span>${b.id.slice(0, 2)}<span style="opacity:.7">${b.id.slice(3)}</span>${tags}<span class="h h1" data-edge="1"></span></div>`;
  }
  // animations: one block per layer of each beat, a lane per layer (in the beat's own order)
  const nA = Math.max(1, ...beats.map(b => (b.ready && b.on !== false ? Object.keys(b.L || {}).length : 0)));
  const arows = Array.from({ length: nA }, () => []);
  for (const [i, b] of beats.entries()) {
    if (!b.ready || b.on === false) continue;
    (b.layers || []).filter(L => b.L?.[L]).forEach((L, j) => {
      const x = b.L[L], w = Math.max(18, X(x.end - x.start) - 2), isSel = S.sel && S.sel.beat === b && S.sel.layer === L;
      const tag = `${b.ltime[L] ? '<span class="tag">⏱</span>' : ''}${b.behind.includes(L) ? '<span class="tag" title="behind you">⧉</span>' : ''}`;
      arows[j].push(`<div class="lyr ${isSel ? 'sel' : ''} ${b.hide.includes(L) ? 'hid' : ''}" data-i="${i}" data-l="${esc(L)}" style="left:${X(x.start)}px;width:${w}px;top:6px"
        title="${esc(x.title || L)} (${b.id}, layer ${esc(L)}) · ${f2(x.start)}–${f2(x.end)} s · drag to move it, its edges to trim or stretch">
        <span class="h h0" data-edge="0"></span>${esc(x.title || L)}${x.title ? ` <span class="ln">${esc(L)}</span>` : ''}${tag}<span class="h h1" data-edge="1"></span></div>`);
    });
  }
  // sounds: packed into lanes so they don't sit on top of each other
  // Lanes are sticky: a sound keeps its lane, so dragging one never reshuffles the others. Only sounds
  // without a lane (new ones, or the one just dropped) look for one: their old lane if it's clear, else
  // the first clear lane, in seconds so zooming doesn't move anything.
  const lanes = Array.from({ length: lanesN }, () => []), busy = Array.from({ length: lanesN }, () => []);
  const all = beats.flatMap((b, i) => (b.ready && b.on !== false ? (b.cuesAll || []).map(q => ({ q, b, i, id: `${b.id}|${q.key}` })) : [])).sort((x, y) => x.q.t - y.q.t);
  const span = q => [q.t, q.t + Math.max(q.dur || soundLen(q.s), 0.05)];   // real length, not on-screen width, so zoom never matters
  const free = (L, [a, z]) => busy[L].every(([c, d]) => z <= c + 0.005 || a >= d - 0.005);
  for (const o of all) { const L = laneOf.get(o.id); if (L != null && L < lanesN) busy[L].push(span(o.q)); else o.need = true; }
  for (const o of all.filter(o => o.need)) {
    const sp = span(o.q), hint = laneHint.get(o.id);
    let L = hint != null && hint < lanesN && free(hint, sp) ? hint : busy.findIndex((_, j) => free(j, sp));
    if (L < 0) L = busy.reduce((m, l, j) => (l.length < busy[m].length ? j : m), 0);
    laneOf.set(o.id, L); laneHint.delete(o.id); busy[L].push(sp);
  }
  for (const { q, b, i, id } of all) {
    const len = q.dur || soundLen(q.s), cut = q.t + len > DUR;          // nothing plays past the end of the video
    const x = X(q.t), w = Math.max(8, Math.min(len, DUR - q.t) * P), L = laneOf.get(id);
    const isSel = S.snd && S.snd.beat === b && S.snd.key === q.key, isM = S.msel.has(`${i}|${q.key}`);
    const st = q.off ? `border-color:${col(q.s)};color:${col(q.s)}` : `background:${col(q.s)};color:${ink(q.s)}`;
    lanes[L].push(`<div class="snd ${cut ? 'cut' : ''} ${q.off ? 'off' : ''} ${q.edited ? 'edited' : ''} ${q.added ? 'added' : ''} ${isSel ? 'sel' : ''} ${isM ? 'msel' : ''} ${b.sfx === false ? 'dim' : ''}"
      data-i="${i}" data-k="${esc(q.key)}" style="left:${x}px;width:${w}px;${st}" title="${esc(q.s)} · ${f2(q.t)} s · ${b.id}${q.vol ? ` · ${dB(q.vol)}` : ''}">${w > 40 ? esc(q.s) : ''}${w > 16 ? '<span class="hr"></span>' : ''}</div>`);
  }
  // Lanes drawn: every lane that has a sound plus a spare to drop into, and at least enough to fill the
  // panel. More than fit → the timeline scrolls up and down (the ruler stays put at the top).
  const fit = Math.max(1, Math.floor((tlScroll.clientHeight - RULER - FILM - BEATS - nA * ANIM - 2) / LANE));
  // filmstrip: a frame wherever one fits (never more often than the strip has frames), each the video at its left edge
  const TB = state.thumbs, fh = FILM - 4, fw = Math.round(fh * W / H), gap = Math.max(fw + 2, TB.every * P);
  let film = '';
  for (let x = 0; x < DUR * P; x += gap) {
    const j = Math.min(TB.n - 1, Math.round(x / P / TB.every)), cw = Math.min(fw, DUR * P - x);
    film += `<i style="left:${x}px;width:${cw}px;background-size:${TB.n * fw}px ${fh}px;background-position:${-j * fw}px 0"></i>`;
  }
  const shown = Math.max(fit, lanes.reduce((m, l, j) => (l.length ? j + 1 : m), 0) + 1);
  tlInner.innerHTML = `<div class="row-ruler">${ruler}</div><div class="row-film" style="height:${FILM}px">${film}</div><div class="row-beats">${blocks}</div>` +
    arows.map(r => `<div class="row-anim" style="height:${ANIM}px">${r.join('')}</div>`).join('') +
    `<div class="after" style="left:${X(DUR)}px" title="The video ends here: nothing plays after it"></div>` +
    lanes.slice(0, shown).map(l => `<div class="row-snd">${l.join('')}</div>`).join('') + '<div id="head"></div><div id="marquee"></div>';
  $('#tlLabels').innerHTML = `<div class="lr" style="height:${RULER}px;border-bottom:1px solid var(--line)"></div><div style="height:${FILM}px;border-bottom:1px solid var(--line)">Video</div><div style="height:${BEATS}px;border-bottom:1px solid var(--line)">Beats</div>` +
    `<div style="height:${nA * ANIM}px;border-bottom:1px solid var(--line)">Animations</div>` +
    `<div style="height:${LANE}px">Sounds</div><div style="height:${shown * LANE}px"></div>`;
  $('#tlLabels').scrollTop = tlScroll.scrollTop;
  S.lastNow = null;
}
export function setZoom(z, centreT = v.currentTime) {
  S.zoom = Math.max(1, Math.min(80, z)); renderTimeline();
  tlScroll.scrollLeft = centreT * pps() - tlScroll.clientWidth / 2;
}

let tdrag = null;                                      // what a pointer drag on the timeline is doing
// pointer x → seconds. The timeline's own left edge is time 0 (getBoundingClientRect already includes the scroll offset).
export const tlTime = e => { const r = tlInner.getBoundingClientRect(); return Math.max(0, Math.min(DUR, (e.clientX - r.left) / pps())); };
export const snapHead = t => (Math.abs(t - v.currentTime) * pps() < 8 ? v.currentTime : t);   // edges stick to the playhead

export function hitBox(el, r, [x, y, w, h]) {                    // does a sound block touch the box (both in timeline coords)?
  const s = el.getBoundingClientRect(), sx = s.left - r.left, sy = s.top - r.top;
  return sx < x + w && sx + s.width > x && sy < y + h && sy + s.height > y;
}

export const setTlh = h => { h = Math.max(150, Math.min(innerHeight * 0.72, h)); document.documentElement.style.setProperty('--tlh', h + 'px'); return h; };
export function initTimeline() {
  let tlW = 0, tlH = 0;
  new ResizeObserver(() => { if (tlScroll.clientWidth !== tlW || tlScroll.clientHeight !== tlH) { tlW = tlScroll.clientWidth; tlH = tlScroll.clientHeight; renderTimeline(); } }).observe(tlScroll);
  setTlh(+localStorage.getItem('retro.tlh') || 330);
  {
    const g = $('#grip'); let y0 = 0, h0 = 0;
    g.addEventListener('pointerdown', e => { y0 = e.clientY; h0 = $('#tl').getBoundingClientRect().height; g.setPointerCapture(e.pointerId); g.classList.add('on'); });
    g.addEventListener('pointermove', e => { if (g.classList.contains('on')) setTlh(h0 + (y0 - e.clientY)); });
    g.addEventListener('pointerup', () => { g.classList.remove('on'); localStorage.setItem('retro.tlh', parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tlh'))); });
  }
  $('#zIn').onclick = () => setZoom(S.zoom * 1.6);
  $('#zOut').onclick = () => setZoom(S.zoom / 1.6);
  $('#zFit').onclick = () => setZoom(1);
  $('#zBeat').onclick = () => { if (S.cur?.ready) setZoom((DUR / (S.cur.end - S.cur.start)) * 0.8, (S.cur.start + S.cur.end) / 2); };
  tlScroll.addEventListener('scroll', () => { $('#tlLabels').scrollTop = tlScroll.scrollTop; });   // labels follow the lanes up and down
  tlScroll.addEventListener('wheel', e => {                // pinch / ⌘-scroll zooms around the pointer
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = tlScroll.getBoundingClientRect(), t = (e.clientX - r.left + tlScroll.scrollLeft) / pps();
    S.zoom = Math.max(1, Math.min(80, S.zoom * Math.exp(-e.deltaY * 0.01))); renderTimeline();
    tlScroll.scrollLeft = t * pps() - (e.clientX - r.left);
  }, { passive: false });
  tlInner.addEventListener('pointerdown', e => {
    const h = e.target.closest('.blk .h'), m = e.target.closest('.snd'), blk = e.target.closest('.blk'), ly = e.target.closest('.lyr');
    tlInner.setPointerCapture(e.pointerId);
    if (ly) {                                            // one animation: drag to move it, its edges to trim / stretch it
      const b = beats[+ly.dataset.i], L = ly.dataset.l, x = b.L?.[L]; if (!b.ready || !x) return;
      S.cur = b; S.sel = { beat: b, layer: L }; S.snd = null; renderList(); renderInspector();
      tlInner.querySelectorAll('.lyr.sel').forEach(el => el.classList.remove('sel')); ly.classList.add('sel');
      const lh = e.target.closest('.lyr .h');
      tdrag = lh ? { kind: 'ledge', b, L, x, edge: +lh.dataset.edge, el: ly, mode: e.altKey ? (S.tool === 'trim' ? 'stretch' : 'trim') : S.tool }
                 : { kind: 'lmove', b, L, x, el: ly, off: tlTime(e) - x.start, moved: false };
      return;
    }
    if (h) {                                             // beat edge: trim or stretch
      const b = beats[+blk.dataset.i]; if (!b.ready) return;
      if (S.cur !== b) { S.cur = b; S.sel = null; S.snd = null; renderList(); renderInspector(); }
      tdrag = { kind: 'edge', b, edge: +h.dataset.edge, el: blk, mode: e.altKey ? (S.tool === 'trim' ? 'stretch' : 'trim') : S.tool };
      blk.classList.add('dragging');
      return;
    }
    if (m && e.shiftKey) { selectMany([{ beat: beats[+m.dataset.i], key: m.dataset.k }], true); return; }   // ⇧-click: add / remove
    if (m) {                                             // a sound: select it, then drag to move it (or its right edge to shorten it)
      const b = beats[+m.dataset.i];
      if (S.msel.size) { S.msel = new Map(); S.bulk = null; }
      selectSound(b, m.dataset.k, { reveal: false });
      const q = findCue(S.snd); if (!q) return;
      tdrag = e.target.classList.contains('hr') ? { kind: 'slen', b, q, el: m } : { kind: 'smove', b, q, el: m, off: tlTime(e) - q.t, moved: false };
      renderList(); renderInspector(); renderPop();
      m.classList.add('sel');
      return;
    }
    if (blk) { pick(beats[+blk.dataset.i], false); tdrag = { kind: 'beat', b: beats[+blk.dataset.i], x: e.clientX }; return; }
    if (e.target.closest('.row-snd')) {                  // empty sound lane: drag a box to select; a plain click moves the playhead
      const r = tlInner.getBoundingClientRect();
      tdrag = { kind: 'box', x0: e.clientX - r.left, y0: e.clientY - r.top, add: e.shiftKey, moved: false, t: tlTime(e) };
      return;
    }
    tdrag = { kind: 'scrub' };
    seek(tlTime(e), { reveal: false });
  });
  tlInner.addEventListener('pointermove', e => {
    if (!tdrag) return;
    const P = pps(), t = tlTime(e);
    if (tdrag.kind === 'box') {
      const r = tlInner.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (!tdrag.moved && Math.hypot(x - tdrag.x0, y - tdrag.y0) < 4) return;
      tdrag.moved = true;
      const bx = [Math.min(x, tdrag.x0), Math.min(y, tdrag.y0), Math.abs(x - tdrag.x0), Math.abs(y - tdrag.y0)];
      Object.assign($('#marquee').style, { display: 'block', left: bx[0] + 'px', top: bx[1] + 'px', width: bx[2] + 'px', height: bx[3] + 'px' });
      tdrag.box = bx;
      // live highlight of what the box touches
      tlInner.querySelectorAll('.snd').forEach(el => el.classList.toggle('msel', hitBox(el, r, bx) || (tdrag.add && S.msel.has(`${el.dataset.i}|${el.dataset.k}`))));
      return;
    }
    if (tdrag.kind === 'lmove') {
      const { x } = tdrag, len = x.end - x.start, ns = Math.max(0, Math.min(DUR - len, snapHead(t - tdrag.off)));
      if (!tdrag.moved && Math.abs(ns - x.start) * P < 3) return;
      tdrag.moved = true; tdrag.t = ns; tdrag.el.classList.add('moving'); tdrag.el.style.left = ns * P + 'px';
      status(`${x.title || tdrag.L} → ${f2(ns)}–${f2(ns + len)} s (${ns >= x.start ? '+' : ''}${(ns - x.start).toFixed(2)} s)`);
      return;
    }
    if (tdrag.kind === 'ledge') {
      const { x, edge, el } = tdrag, te = Math.min(DUR, snapHead(t)), s = edge ? x.start : te, en = edge ? te : x.end;
      if (en - s < 0.2) return;
      el.style.left = s * P + 'px'; el.style.width = (en - s) * P - 2 + 'px'; tdrag.t = te;
      status(`${tdrag.mode === 'trim' ? '✂ Trim' : '↔ Stretch'} ${x.title || tdrag.L} ${edge ? 'end' : 'start'} → ${f2(te)} s`);
      return;
    }
    if (tdrag.kind === 'beat' && Math.abs(e.clientX - tdrag.x) > 3) tdrag = { kind: 'scrub' };   // dragging on a beat scrubs
    if (tdrag.kind === 'scrub') seek(t, { reveal: false });
    else if (tdrag.kind === 'edge') {
      const { b, edge, el } = tdrag, s = edge ? b.start : snapHead(t), en = edge ? Math.min(DUR, snapHead(t)) : b.end;
      if (en - s < 0.2) return;
      el.style.left = s * P + 'px'; el.style.width = (en - s) * P - 2 + 'px'; tdrag.t = edge ? en : s;
      status(`${tdrag.mode === 'trim' ? '✂ Trim' : '↔ Stretch'} ${b.id} ${edge ? 'end' : 'start'} → ${f2(tdrag.t)} s`);
    } else if (tdrag.kind === 'slen') {
      const d = Math.max(0.03, Math.min(soundLen(tdrag.q.s), t - tdrag.q.t));
      tdrag.el.style.width = Math.max(8, d * P) + 'px'; tdrag.d = d;
    } else if (tdrag.kind === 'smove') {
      const nt = Math.max(tdrag.b.start, Math.min(tdrag.b.end - 0.02, snapHead(t - tdrag.off)));
      if (!tdrag.moved && Math.abs(nt - tdrag.q.t) * P < 3) return;      // a click, not a drag
      tdrag.el.style.left = nt * P + 'px'; tdrag.el.classList.add('moving'); tdrag.t = nt; tdrag.moved = true;
      status(`${tdrag.q.s} → ${f2(nt)} s`);
    }
  });
  tlInner.addEventListener('pointerup', () => {
    const d = tdrag; tdrag = null; if (!d) return;
    if (d.kind === 'box') {
      $('#marquee').style.display = 'none';
      if (!d.moved) { if (S.msel.size && !d.add) { S.msel = new Map(); S.bulk = null; renderAll(); } seek(d.t, { reveal: false }); return; }
      const r = tlInner.getBoundingClientRect();
      const got = [...tlInner.querySelectorAll('.snd')].filter(el => hitBox(el, r, d.box)).map(el => ({ beat: beats[+el.dataset.i], key: el.dataset.k }));
      if (got.length) selectMany(got, d.add); else if (!d.add) { S.msel = new Map(); S.bulk = null; renderAll(); }
      return;
    }
    if (d.kind === 'lmove') {                            // a click just selects the animation (for moving it); the playhead stays put
      if (d.moved) moveLayer(d.b, d.L, d.t - d.x.start);
      else { if (S.cur !== d.b) S.snd = null; S.cur = d.b; S.sel = { beat: d.b, layer: d.L }; renderAll(); }
      return;
    }
    if (d.kind === 'ledge') { if (d.t != null) layerEdge(d.b, d.L, d.edge, d.t, d.mode); else renderTimeline(); return; }
    if (d.kind === 'edge') { d.el.classList.remove('dragging'); if (d.t != null) applyEdge(d.b, d.edge, d.t, d.mode); else renderTimeline(); }
    if (d.kind === 'slen' && d.d) setDur(d.b, d.q, d.d);
    if (d.kind === 'smove' && d.moved) {                 // the dropped sound finds a clear lane; nothing else moves
      const id = `${d.b.id}|${d.q.key}`; laneHint.set(id, laneOf.get(id)); laneOf.delete(id);
      moveSound(d.b, d.q, d.t); const q = findCue(S.snd); if (q) seek(q.t, { reveal: false });
    }
  });
}
