import { $, DUR, FH, H, S, W, alarm, beats, cut, f2, grab, opts, r1, r2, selBox, stage, state, status, tlScroll, v, zone } from './state.js';
import { save, whenSaved } from './api.js';
import { pps } from './timeline.js';
import { ac, buildSfxSoon, placePop, restartSfx } from './sounds.js';
import { renderAll, renderInspector } from './panel.js';
import { applyZoom, faceZone } from './zoom.js';

let k = 1, U = 1;                                                         // display scale; px per u on screen

/* ---------- layout ---------- */
export function layout() {                                   // fit the video to whatever room the timeline leaves it
  const wrap = $('#stageWrap'), aw = wrap.clientWidth - 28, ah = wrap.clientHeight - 28;
  if (aw <= 0 || ah <= 0) return;
  k = Math.min(ah / H, aw / W); const dw = Math.round(W * k), dh = Math.round(H * k); U = dw / 100;
  Object.assign(stage.style, { width: dw + 'px', height: dh + 'px' });
  stage.style.setProperty('--u', U + 'px');              // the Instagram UI overlay is sized in it
  Object.assign(v.style, { width: dw + 'px', height: (cut.on ? 2 * dh : dh) + 'px' });   // the cutout copy has its matte under the picture
  Object.assign($('#bg').style, { width: dw + 'px', height: dh + 'px' });
  for (const b of beats) if (b.frame) b.frame.style.transform = `scale(${k})`;
  placePop();
}

/* ---------- beats as live iframes ---------- */
/* Each beat runs in an iframe. A rebuild (a timing or hide change) loads the new version in a second, hidden
   iframe and swaps it in once it's ready: the old one keeps playing meanwhile, so nothing on the video or the
   timeline blinks out and back. */
export function mount(b) {
  const gen = (b.gen = (b.gen || 0) + 1), f = document.createElement('iframe');
  f.width = W; f.height = H;
  f.src = `work/${b.id}/index.html${gen > 1 ? `?t=${Date.now()}` : ''}`;
  stage.insertBefore(f, b.frame ? b.frame.nextSibling : zone);
  if (!b.frame) b.frame = f;
  f.onload = async () => {
    const w = f.contentWindow;
    for (let i = 0; i < 200 && !w.__timelines?.root; i++) await new Promise(r => setTimeout(r, 25));
    if (gen !== b.gen) { if (f !== b.frame) f.remove(); return; }   // a newer rebuild started meanwhile
    if (!w.__timelines?.root) { status(`${b.id}: no timeline (see the console)`); return; }
    await w.document.fonts.ready;
    if (gen !== b.gen) { if (f !== b.frame) f.remove(); return; }
    const first = !b.ready && gen === 1, old = b.frame;
    const O = w.R.OUT || { start: w.R.START, end: w.R.END };
    f.style.transform = `scale(${k})`;
    Object.assign(b, { ready: true, loading: false, frame: f, start: O.start, end: O.end, src: w.R.SRC || O, layers: w.R.layers(), L: w.R.LAYERS || {}, win: w });
    refreshCues(b);
    applyMove(b);
    applyDepth(b);
    if (show0(b)) { w.__timelines.root.seek(Math.max(0, v.currentTime - b.start), false); f.style.visibility = 'visible'; }
    if (old && old !== f) old.remove();
    if (!S.cur) S.cur = b;                                 // (main.js starts on the first beat; this covers a page with none picked)
    renderAll();
    if (beats.every(x => x.ready)) { buildSfxSoon(); if (first) status(`${beats.length} beats loaded`); }
  };
}

export const show0 = b => b.on !== false && v.currentTime >= b.start && v.currentTime < b.end;

export function rebuild(b) {                                  // reload a beat after a timing or hide change (swapped in when ready)
  b.loading = true; renderInspector();
  whenSaved().then(() => mount(b));                    // the server builds it from retro.json: let the save land first
}
export function refreshCues(b) {                              // the beat's own code applies the sound edits
  const R = b.win.R;
  b.cuesAll = R.sfxApply ? R.sfxApply(b.sounds) : R.cues;
  b.cues = b.cuesAll.filter(q => !q.off);
}
export function applyMove(b) {
  if (!b.win) return;
  const all = b.move['*'] || [0, 0];
  for (const el of b.win.document.querySelectorAll('.layer')) {
    const [dx, dy] = b.move[el.dataset.layer] || [0, 0];
    el.style.transform = `translate(calc(var(--u) * ${dx + all[0]}), calc(var(--u) * ${dy + all[1]}))`;
  }
}
/* ---------- behind me ----------
   A layer marked "behind" sits between the speaker and the background. The server makes a copy of the
   preview video with the speaker's matte stacked under the picture (once per video); once it's there the
   page plays that copy (showing only the top half) and paints the speaker, cut out, into a canvas inside
   each beat that needs it, above its behind layers and below the rest. */
export const cutNote = () => cut.state === 'error' ? `Couldn't cut you out: ${cut.error}` : `Cutting you out of the video (once)… ${Math.round(cut.progress * 100)}%. Until then it shows in front.`;
export function applyDepth(b) {
  if (!b.win) return;
  const doc = b.win.document, back = b.behind.filter(L => !b.hide.includes(L));
  for (const el of doc.querySelectorAll('.layer')) el.style.zIndex = back.includes(el.dataset.layer) ? 0 : 2;
  let c = doc.getElementById('__me');
  if (back.length && !c) {
    c = doc.createElement('canvas'); c.id = '__me';
    c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none';
    doc.querySelector('#stage').append(c);
  }
  if (c) c.style.display = back.length ? 'block' : 'none';
  b.me = back.length ? c : null;
}
export async function ensureCut() {
  if (!beats.some(b => b.behind.length) || cut.state === 'ready' || cut.polling) return;
  cut.polling = true;
  for (let make = 1; ; make = 0) {
    let r = null;
    try { r = await (await fetch(`api/cutout${make ? '?make=1' : ''}`)).json(); } catch {}
    if (r) Object.assign(cut, r);
    if (cut.state === 'ready') { useCut(); break; }
    if (cut.state === 'error') { alarm(cutNote()); break; }
    status(cutNote()); renderInspector();
    await new Promise(r => setTimeout(r, 1000));
  }
  cut.polling = false; renderInspector();
}
export function useCut() {                                    // switch the player to the copy with the matte under it
  if (cut.on) return;
  const t = v.currentTime, playing = !v.paused;
  cut.on = true;
  v.src = 'cut.mp4';
  v.style.opacity = 0; $('#bg').style.display = 'block';   // the picture is painted from the same frame as the cutout now
  v.addEventListener('loadedmetadata', () => { v.currentTime = t; if (playing) v.play(); layout(); }, { once: true });
  layout(); status('Cutout ready');
}
export function cutGL() {                                     // picture (top half) × matte (bottom half) → the speaker on clear
  if (cut.gl) return cut.gl;
  const c = document.createElement('canvas'), gl = c.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true });
  const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); return x; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main() { uv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }'));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, 'precision mediump float; varying vec2 uv; uniform sampler2D v; uniform float whole; void main() { vec3 c = texture2D(v, vec2(uv.x, uv.y * .5)).rgb; float a = max(whole, texture2D(v, vec2(uv.x, uv.y * .5 + .5)).r); gl_FragColor = vec4(c * a, a); }'));
  gl.linkProgram(pr); gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
  cut.canvas = c; cut.whole = gl.getUniformLocation(pr, 'whole');
  return (cut.gl = gl);
}
/* The background and the cutout must come from the very same decoded frame. A <video> element is put on
   screen by the browser's own video path, a canvas by the page's paint, and the two drift apart by a
   frame or more while playing (the cutout ghosts ahead of or behind the picture). So once the cutout copy
   is playing, the <video> is hidden and both are drawn here, from one texture upload, in the same paint. */
export function paintCut(list) {
  if (!cut.on || v.readyState < 2 || !v.videoWidth) return;
  const gl = cutGL(), c = cut.canvas, w = v.videoWidth, h = v.videoHeight / 2, bg = $('#bg');
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  gl.viewport(0, 0, w, h);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
  const draw = whole => { gl.uniform1f(cut.whole, whole); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
  draw(1);                                             // the picture
  if (bg.width !== w || bg.height !== h) { bg.width = w; bg.height = h; }
  bg.getContext('2d').drawImage(c, 0, 0);
  if (!list.length) return;
  draw(0);                                             // the speaker on clear
  for (const b of list) {
    if (!b.me?.isConnected) applyDepth(b);
    const m = b.me; if (!m) continue;
    if (m.width !== w || m.height !== h) { m.width = w; m.height = h; }
    const x = m.getContext('2d'); x.clearRect(0, 0, w, h); x.drawImage(c, 0, 0);
  }
}

export const showing = (b, t = v.currentTime) => b.ready && b.on !== false && t >= b.start && t < b.end;

/* ---------- the picture ----------
   The picture is always painted here, into #bg, from the decoded frame and with that frame's own zoom, in one
   paint (the <video> is only the decoder). A zoom set as a CSS transform on the <video> moved on the page's
   clock (each display refresh, from an estimate of currentTime) while the browser put frames up on its own
   path, so the push stepped out of phase with the frames: a shimmer on every zoomed shot. Each new frame
   (requestVideoFrameCallback) is painted with its own media time, the time the render zooms it at. */
const rvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
let paintedT = null;
const deepAt = t => beats.filter(b => showing(b, t) && b.behind.some(L => !b.hide.includes(L)));
export function paintPicture(t) {
  if (v.readyState < 2 || !v.videoWidth) return;
  const deep = deepAt(t);
  if (cut.on) paintCut(deep);
  else {
    const bg = $('#bg'), w = v.videoWidth, h = v.videoHeight;
    if (bg.width !== w || bg.height !== h) { bg.width = w; bg.height = h; }
    bg.getContext('2d').drawImage(v, 0, 0);
  }
  applyZoom(t, U, deep);
  paintedT = t;
}
let frameCb = null, frameAt = 0;
function onFrame(now, m) { frameAt = performance.now(); paintPicture(m.mediaTime); frameCb = v.requestVideoFrameCallback(onFrame); }
function watchFrames() {                              // (re)arm the frame callback, e.g. after a new src (the cutout copy)
  if (frameCb != null) v.cancelVideoFrameCallback(frameCb);
  frameAt = performance.now(); frameCb = v.requestVideoFrameCallback(onFrame);
}


/* ---------- moving: click an animation on the video, drag it ---------- */
export const SNAP = 1.5;                                  // pull distance in u
export function guides(hitV = false, hitH = false) {
  $('#ig').style.display = opts.ig ? 'block' : 'none';
  $('#guideV').style.display = opts.snapV ? 'block' : 'none';
  $('#guideH').style.display = opts.snapH ? 'block' : 'none';
  $('#guideV').classList.toggle('hit', hitV); $('#guideH').classList.toggle('hit', hitH);
}

export function layerBox(b, layer, onlyShown = false) {   // [x0, y0, x1, y1] in u, as drawn now (moves included)
  if (!b.win) return null;
  const doc = b.win.document, px = W / 100;
  const Ls = layer === '*' ? [...doc.querySelectorAll('.layer')] : [doc.querySelector(`.layer[data-layer="${layer}"]`)].filter(Boolean);
  const kids = Ls.filter(L => L.style.display !== 'none').flatMap(L => [...L.children]).filter(el => !el.classList.contains('zoom'))
    .map(el => ({ r: el.getBoundingClientRect(), cs: b.win.getComputedStyle(el) })).filter(o => o.r.width >= 2 && o.r.height >= 2);
  const shown = kids.filter(o => o.cs.visibility !== 'hidden' && +o.cs.opacity > 0 && o.cs.display !== 'none');
  const use = shown.length || onlyShown ? shown : kids;
  if (!use.length) return null;
  return [Math.min(...use.map(o => o.r.left)) / px, Math.min(...use.map(o => o.r.top)) / px,
          Math.max(...use.map(o => o.r.right)) / px, Math.max(...use.map(o => o.r.bottom)) / px];
}
export const inBox = (bx, x, y) => bx && x >= bx[0] && x <= bx[2] && y >= bx[1] && y <= bx[3];
export function hitTest(ux, uy) {                         // the topmost animation under a point on the video
  for (const b of [...beats].reverse()) {
    if (!showing(b)) continue;
    for (const L of [...(b.layers || [])].reverse()) {
      if (b.hide.includes(L)) continue;
      if (inBox(layerBox(b, L, true), ux, uy)) return { beat: b, layer: L };
    }
  }
  return null;
}
export const stageU = e => { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left) / U, (e.clientY - r.top) / U]; };
let drag = null;

export function nudge(dx, dy) {
  if (!S.sel) return;
  const b = S.sel.beat, [x, y] = b.move[S.sel.layer] || [0, 0];
  b.move[S.sel.layer] = [r1(x + dx), r1(y + dy)];
  applyMove(b); renderInspector(); save(b, { move: b.move }, 250);
}

/* ---------- time ---------- */
export function sync() {
  const t = v.currentTime;
  for (const b of beats) {
    if (!b.ready) continue;
    const show = showing(b, t);
    b.frame.style.visibility = show ? 'visible' : 'hidden';
    if (show) b.win.__timelines.root.seek(Math.max(0, t - b.start), false);
  }
  // The picture (and the cut-out speaker), zoomed; never the graphics. With frame callbacks, each frame paints
  // itself (onFrame); here only a resize is caught up on. Without them, paint at the playhead each refresh.
  if (!rvfc || paintedT == null) paintPicture(t);
  else {
    if (!v.paused && performance.now() - frameAt > 500) watchFrames();   // playing, but no frames called back
    applyZoom(paintedT, U, deepAt(paintedT));
  }
  $('#tc').innerHTML = `<b>${f2(t)}</b> / ${f2(DUR)}`;
  $('#play').textContent = v.paused ? '▶' : '❚❚';
  const hx = t * pps(), hd = $('#head'); if (hd) hd.style.left = `${hx}px`;
  if (!v.paused && (hx < tlScroll.scrollLeft || hx > tlScroll.scrollLeft + tlScroll.clientWidth - 20)) tlScroll.scrollLeft = hx - 40;   // follow the playhead
  const z = opts.zone && faceZone(t);
  zone.style.display = z ? 'block' : 'none';
  if (z) Object.assign(zone.style, { left: z[0] * U + 'px', top: z[1] * U + 'px', width: z[2] * U + 'px', height: z[3] * U + 'px' });
  const box = S.sel && showing(S.sel.beat, t) && layerBox(S.sel.beat, S.sel.layer);
  selBox.style.display = box ? 'block' : 'none';
  if (box) {
    Object.assign(selBox.style, { left: box[0] * U - 3 + 'px', top: box[1] * U - 3 + 'px', width: (box[2] - box[0]) * U + 6 + 'px', height: (box[3] - box[1]) * U + 6 + 'px' });
    selBox.firstChild.textContent = `${S.sel.beat.id} · ${S.sel.layer === '*' ? 'all' : S.sel.layer}`;
  }
  const now = beats.filter(b => b.ready && t >= b.start && t < b.end).map(b => b.id).join();
  if (now !== S.lastNow) {                           // "playing now" markers, without re-rendering the panel
    S.lastNow = now;
    for (const q of ['.brow', '.blk']) document.querySelectorAll(q).forEach(r => { const b = beats[+r.dataset.i]; r.classList.toggle('now', b.ready && t >= b.start && t < b.end); });
  }
}

// Moving the playhead also brings it into view (zoom kept, playhead ~15% in). Scrubbing and drags pass
// reveal: false so the timeline doesn't slide out from under the pointer.
export function seek(t, { reveal = true } = {}) { v.currentTime = t; restartSfx(); if (reveal) revealT(t); }
export function revealT(t) {
  const x = t * pps(), w = tlScroll.clientWidth;
  if (S.zoom <= 1.001) return;                           // everything's already in view
  const left = Math.max(0, x - w * 0.15), far = Math.abs(left - tlScroll.scrollLeft) > w;
  tlScroll.scrollTo({ left, behavior: far ? 'instant' : 'smooth' });   // far jumps land at once; near ones glide
}
export function togglePlay() { ac.resume(); v.paused ? v.play() : v.pause(); }
export function initStage() {
  new ResizeObserver(layout).observe($('#stageWrap'));
  guides();
  grab.addEventListener('pointerdown', e => {
    const [ux, uy] = stageU(e);
    const keep = S.sel && showing(S.sel.beat) && inBox(layerBox(S.sel.beat, S.sel.layer, true), ux, uy);   // "all together" stays selected
    const hit = keep ? S.sel : hitTest(ux, uy);
    if (!hit) { if (S.sel) { S.sel = null; renderAll(); } return; }
    if (!S.sel || S.sel.beat !== hit.beat || S.sel.layer !== hit.layer) { S.sel = hit; if (S.cur !== hit.beat) S.snd = null; S.cur = hit.beat; renderAll(); }
    const m = [...(S.sel.beat.move[S.sel.layer] || [0, 0])], box = layerBox(S.sel.beat, S.sel.layer);
    drag = { x: e.clientX, y: e.clientY, m, moved: false, c0: box && [(box[0] + box[2]) / 2 - m[0], (box[1] + box[3]) / 2 - m[1]] };
    grab.setPointerCapture(e.pointerId); grab.classList.add('dragging');
  });
  grab.addEventListener('pointermove', e => {
    if (!drag) { grab.classList.toggle('can', !!hitTest(...stageU(e))); return; }   // hover: grab hand over anything movable
    const b = S.sel.beat, rx = drag.m[0] + (e.clientX - drag.x) / U, ry = drag.m[1] + (e.clientY - drag.y) / U;
    let x = Math.round(rx * 2) / 2, y = Math.round(ry * 2) / 2, hitV = false, hitH = false;
    if (drag.c0 && !e.altKey) {
      const tx = 50 - drag.c0[0], ty = FH / 2 - drag.c0[1];
      if (opts.snapV && Math.abs(rx - tx) < SNAP) { x = r2(tx); hitV = true; }
      if (opts.snapH && Math.abs(ry - ty) < SNAP) { y = r2(ty); hitH = true; }
    }
    drag.moved = true;
    b.move[S.sel.layer] = [x, y];
    applyMove(b); guides(hitV, hitH);
  });
  grab.addEventListener('pointerup', () => {
    if (!drag) return;
    const moved = drag.moved; drag = null; grab.classList.remove('dragging'); guides();
    if (moved) { save(S.sel.beat, { move: S.sel.beat.move }, 150); renderInspector(); }
  });
  v.style.opacity = 0; $('#bg').style.display = 'block';   // the picture is painted (paintPicture), not the <video>
  if (rvfc) watchFrames();
  (function loop() { sync(); requestAnimationFrame(loop); })();
  $('#play').addEventListener('click', togglePlay);
}
