import { $, FH, S, W, beats, esc, f2, state, v } from './state.js';
import { save } from './api.js';
import { at, DEFAULT, KINDS, mapBox, plan, setting } from './zoom.mjs';
import { faceAt, noGo } from './rules.mjs';

/* ---------- zoom: the slow push-ins on the video ----------
   The plan comes from lib/zoom.mjs (served as zoom.mjs), the same code the lint and the render use, built from
   the beats as they show here, so the preview, the red face zone and the export agree. The video, the
   background canvas and the cut-out speaker are all moved by it; the graphics never are. */

let key = null, zp = { resolved: [], segs: [] };
export function zplan() {                                      // rebuilt only when a beat's time or zoom changes
  const k = beats.map(b => `${b.id}:${b.ready ? `${b.start},${b.end}` : '-'}:${JSON.stringify(b.zoom ?? null)}`).join('|');
  if (k !== key) {
    key = k;
    zp = plan(beats.filter(b => b.ready).map(b => ({ id: b.id, start: b.start, end: b.end, zoom: b.zoom })), state.faces, { fh: FH, dflt: state.zoom });
  }
  return zp;
}
export const zoomAt = (t = v.currentTime) => at(zplan().segs, t);
export const resolvedOf = b => zplan().resolved.find(r => r.id === b.id);

/** The face no-go zone where it shows now (same rule as lib/rules.mjs noGo, after the zoom). */
export function faceZone(t) {
  const f = faceAt(state.faces, t);
  return f ? noGo(mapBox(f, zoomAt(t))) : null;
}

let last = '';
/** Move the picture: the canvas it's painted into (stage.js paintPicture, called with the painted frame's own
    time) and each showing beat's cut-out speaker canvas (inside its iframe, so in the iframe's own pixels).
    U: stage px per u. */
export function applyZoom(t, U, list) {
  const z = zoomAt(t), css = `translate(${z.X * U}px, ${z.Y * U}px) scale(${z.S})`;
  if (css !== last) { last = css; const el = $('#bg'); el.style.transformOrigin = '0 0'; el.style.transform = css; }
  const px = W / 100, inner = `translate(${z.X * px}px, ${z.Y * px}px) scale(${z.S})`;
  for (const b of list) if (b.me && b.me.style.transform !== inner) { b.me.style.transformOrigin = '0 0'; b.me.style.transform = inner; }
}

/* ---------- the inspector's Zoom card ---------- */
const NAMES = { auto: 'Auto', push: 'Push', pop: 'Pop + push', pan: 'Push + pan', off: 'Off' };
const TIPS = { auto: 'Pop + push on the opening beat, push on the rest; push + pan when a centre push would lose you off the frame',
  push: 'A slow push in about the centre', pop: 'A quick zoom out, then the slow push (an opening move)',
  pan: 'The slow push about your face: the picture pans as it zooms, so you stay in frame', off: 'No push (punch-ins still play)' };
const DOES = { push: 'a slow push about the centre', pop: 'a quick zoom out, then a slow push', pan: 'a slow push about your face (the picture pans so you stay in frame)', off: 'no push' };
const wordAt = t => (state.words || []).find(w => Math.abs(w.t - t) < 0.02)?.w || '';
const pct = x => Math.round(x * 100);

export function zoomCard(b) {
  const z = setting(b.zoom, state.zoom), r = resolvedOf(b), dis = b.ready ? '' : 'disabled';
  const words = (state.words || []).filter(w => w.t >= b.start - 0.05 && w.t < b.end - 0.1);
  const from = !b.zoom ? (state.zoom ? ' This is the project default.' : '') : '';
  return `
    <p class="sec-title">Zoom</p>
    <div class="card zoomc">
      <div class="seg zseg">${KINDS.map(k => `<button data-a="zkind" data-k="${k}" class="${z.kind === k ? 'on' : ''}" title="${TIPS[k]}" ${dis}>${NAMES[k]}</button>`).join('')}</div>
      <p class="hint">${r ? `${z.kind === 'auto' ? 'Auto does ' : ''}${DOES[r.does]}${r.does === 'off' ? '' : `, 100→${pct(z.to)}%`}.` : ''}${from}</p>
      <div class="line"><span class="lab">Zoom to</span><input type="range" data-a="zto" min="105" max="150" step="1" value="${pct(z.to)}" ${dis || (z.kind === 'off' ? 'disabled' : '')}>
        <span class="val num" id="ztoV">${pct(z.to)}%</span></div>
      <div class="plist">${z.punch.map((p, i) => `
        <div class="prow" data-i="${i}" title="Punch in: the picture jumps closer on this word, then back">
          <span class="num">${f2(p.t)}</span><span class="pw">${esc(wordAt(p.t))}</span>
          <label>+<input type="number" data-a="pby" min="5" max="60" step="1" value="${pct((p.by ?? DEFAULT.by) - 1)}">%</label>
          <label><input type="number" data-a="pdur" min="0.2" max="5" step="0.1" value="${p.dur ?? DEFAULT.dur}"> s</label>
          <button class="btn ghostb sm" data-a="pdel" title="Remove this punch-in">✕</button>
        </div>`).join('')}</div>
      <select data-a="padd" ${dis || (words.length ? '' : 'disabled')} title="Pick a word: the picture jumps ${pct(DEFAULT.by - 1)}% closer on it for ${DEFAULT.dur} s">
        <option value="">+ Punch in on a word…</option>${words.map(w => `<option value="${w.t}">${f2(w.t)}  ${esc(w.w)}</option>`).join('')}</select>
    </div>`;
}

/** Change a beat's zoom: the first edit writes down what it was doing (the project default included). */
export function setZoom(b, patch, delay = 0) {
  const z = setting(b.zoom, state.zoom);
  b.zoom = { kind: z.kind, to: z.to, punch: z.punch, ...patch };
  save(b, { zoom: b.zoom }, delay);
}
/** Inspector events for the Zoom card. Returns true when it handled the event. */
export function zoomEvent(e, b, rerender) {
  const a = e.target.closest('[data-a]')?.dataset.a, row = e.target.closest('.prow');
  if (!a || !b) return false;
  const z = setting(b.zoom, state.zoom), punch = z.punch.map(p => ({ ...p }));
  if (e.type === 'click' && a === 'zkind') { setZoom(b, { kind: e.target.closest('[data-k]').dataset.k }); rerender(); return true; }
  if (e.type === 'click' && a === 'pdel' && row) { punch.splice(+row.dataset.i, 1); setZoom(b, { punch }); rerender(); return true; }
  if (e.type === 'input' && a === 'zto') { $('#ztoV').textContent = `${e.target.value}%`; b.zoom = { kind: z.kind, to: +e.target.value / 100, punch: z.punch }; return true; }
  if (e.type === 'change' && a === 'zto') { setZoom(b, { to: +e.target.value / 100 }); rerender(); return true; }
  if (e.type === 'change' && a === 'padd' && e.target.value) {
    const t = +e.target.value;
    setZoom(b, { punch: [...punch.filter(p => Math.abs(p.t - t) > 0.05), { t, dur: DEFAULT.dur, by: DEFAULT.by }].sort((p, q) => p.t - q.t) });
    rerender(); return true;
  }
  if (e.type === 'change' && (a === 'pby' || a === 'pdur') && row) {
    const p = punch[+row.dataset.i], val = +e.target.value;
    if (!p || !Number.isFinite(val)) return true;
    if (a === 'pby') p.by = 1 + Math.max(1, Math.min(60, val)) / 100; else p.dur = Math.max(0.2, Math.min(5, val));
    setZoom(b, { punch }); rerender(); return true;
  }
  return a === 'zto' || a === 'padd' || a === 'pby' || a === 'pdur' || a === 'zkind' || a === 'pdel';
}

/** The easy button: every beat on auto at 100→125% (punch-ins kept). One undo step. */
export function autoZoomAll() {
  for (const b of beats) setZoom(b, { kind: 'auto', to: DEFAULT.to });
  return beats.length;
}
