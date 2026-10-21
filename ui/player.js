/*
  Preview player: plays the edit straight from the proxy, no render needed.

  It walks the same timeline the renderer uses (shared/timeline.mjs). Two
  video elements take turns: while one plays the current range, the other is
  parked on the next range's first frame, so jump cuts are seamless. Frames go
  through WebGL with the project's crop, punch-in and LUTs. The graphics page
  (graphics/overlay.html) sits on top in an iframe and is seeked to the same
  time, so titles and captions are the ones the render will draw.
*/
import { GLView, parseCube } from './lutgl.js';
import { cropRect, shotFraming, zoomAt } from '/shared/framing.mjs';
import { overlayData } from '/shared/timeline.mjs';
import { h } from './dom.js';
import { mediaUrl } from './api.js';

const DIP = new Set(['fadeblack', 'fadewhite']);

export class Player {
  constructor({ proxyUrl, onTime, onState }) {
    this.onTime = onTime || (() => {});
    this.onState = onState || (() => {});
    this.t = 0;
    this.playing = false;
    this.tl = null;
    this.canvas = h('canvas');
    this.iframe = h('iframe', { src: '/graphics/overlay.html?preview=1', title: 'Graphics', tabindex: '-1' });
    this.msg = h('div.pv-msg', 'Loading preview…');
    // Animations (HyperFrames renders, transparent WebM) sit between the picture and the graphics page.
    this.motionBox = h('div.pv-motion');
    this.motionVids = new Map();
    this.motionLayers = [];
    this.motionSrc = () => null;
    this.motionBlend = () => 'normal';
    this.el = h('div.pv-frame', this.canvas, this.motionBox, this.iframe, this.msg);
    this.gl = new GLView(this.canvas);
    const mk = () => {
      const v = h('video', { preload: 'auto', playsInline: true, crossOrigin: 'anonymous' });
      v.addEventListener('seeked', () => this.requestDraw());
      v.addEventListener('loadeddata', () => this.requestDraw());
      return v;
    };
    this.vids = [mk(), mk()];
    this.vids.forEach(v => { v.src = proxyUrl; v.muted = true; v.seg = null; });
    this.broll = mk();
    this.broll.muted = true;
    // In the document (Chrome won't decode frames for detached elements), but invisible: the canvas shows them.
    for (const v of [...this.vids, this.broll]) { Object.assign(v.style, { position: 'absolute', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' }); this.el.prepend(v); }
    this.iframe.addEventListener('load', () => { this.ovReady = true; this.loadOverlay(); });
    this.loop = this.loop.bind(this);
    this.lutKeys = [null, null];
    new ResizeObserver(() => this.layout()).observe(this.el);
  }

  /** New timeline (after any edit). Keeps the playhead where it is. */
  setTimeline(tl, project) {
    this.tl = tl;
    this.project = project;
    this.segs = [];
    for (const it of tl.items) {
      if (it.kind === 'card') { this.segs.push({ item: it, card: true, out0: it.start, out1: it.start + it.dur }); continue; }
      it.ranges.forEach((r, k) => this.segs.push({ item: it, key: `${it.id}:${k}`, out0: it.start + r.out0, out1: it.start + r.out0 + r.frames / tl.fps, src0: r.src0 }));
    }
    for (const v of this.vids) v.seg = null;
    this.motionLayers = tl.overlays.filter(o => o.type === 'motion').map(o => ({ o, url: this.motionSrc(o), blend: this.motionBlend(o) }));
    this.t = Math.min(this.t, tl.duration);
    this.layout();
    this.loadOverlay();
    this.requestDraw();
  }

  /** LUTs for preview: conversion (Apple Log; HDR is already in the proxy) and look. */
  async setLuts(conv, look, intensity) {
    const want = [conv ? `${conv}@1` : null, look && look !== 'none' ? `${look}@${intensity}` : null];
    await Promise.all(want.map(async (key, slot) => {
      if (this.lutKeys[slot] === key) return;
      this.lutKeys[slot] = key;
      if (!key) { this.gl.setLut(slot, null); return; }
      const [id, k] = key.split('@');
      const text = await fetch(`/api/luts/${encodeURIComponent(id)}.cube?k=${k}`).then(r => (r.ok ? r.text() : null)).catch(() => null);
      if (this.lutKeys[slot] === key) this.gl.setLut(slot, text ? parseCube(text) : null);
    }));
    this.requestDraw();
  }

  layout() {
    if (!this.tl) return;
    const box = this.el.parentElement?.getBoundingClientRect();
    if (!box) return;
    const ar = this.tl.width / this.tl.height;
    const maxH = Math.max(240, window.innerHeight * 0.56);
    let w = Math.min(box.width, 440), hh = w / ar;
    if (hh > maxH) { hh = maxH; w = hh * ar; }
    w = Math.round(w); hh = Math.round(hh);
    if (this.el.style.width !== `${w}px` || this.el.style.height !== `${hh}px`) {
      this.el.style.width = `${w}px`;
      this.el.style.height = `${hh}px`;
      this.gl.resize(w, hh);
      this.size = { w, h: hh };
      this.loadOverlay();
    }
    this.requestDraw();
  }

  loadOverlay() {
    const cr = this.iframe.contentWindow?.CR;
    if (!this.ovReady || !cr || !this.tl || !this.size) return;
    const d = overlayData(this.tl, this.project.settings);
    cr.load({ ...d, width: this.size.w, height: this.size.h });
    cr.seek(this.t);
  }

  play() {
    if (!this.tl || this.playing) return;
    if (this.t >= this.tl.duration - 0.05) this.t = 0;
    this.playing = true;
    this.wall = performance.now();
    this.t0 = this.t;
    this.onState(true);
    requestAnimationFrame(this.loop);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    for (const v of [...this.vids, this.broll, ...this.motionVids.values()]) v.pause();
    this.onState(false);
    this.requestDraw();
  }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  seek(t) {
    if (!this.tl) return;
    this.t = Math.max(0, Math.min(this.tl.duration, t));
    this.t0 = this.t;
    this.wall = performance.now();
    this.requestDraw();
    this.onTime(this.t);
  }

  loop(now) {
    if (!this.playing) return;
    // Hold the clock while the picture we need is still seeking, so sound and picture stay together.
    const primary = this.active(this.t)[0];
    const pv = primary && this.vids.find(v => v.seg === primary);
    if (pv && (pv.seeking || pv.readyState < 2)) { this.wall = now; this.t0 = this.t; }
    else this.t = this.t0 + (now - this.wall) / 1000;
    if (this.t >= this.tl.duration) { this.t = this.tl.duration; this.pause(); }
    this.frame();
    this.onTime(this.t);
    if (this.playing) requestAnimationFrame(this.loop);
  }

  requestDraw() {
    if (this.playing || this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => { this.drawQueued = false; this.frame(); });
  }

  /** Segments on screen at t: [incoming/current, outgoing during a transition]. */
  active(t) {
    if (!this.segs?.length) return [];
    const at = this.segs.filter(s => t >= s.out0 && t < s.out1);
    if (!at.length) { const last = this.segs[this.segs.length - 1]; return t >= last.out1 - 0.001 ? [last] : []; }
    at.sort((a, b) => b.item.start - a.item.start);
    return at.slice(0, 2);
  }

  /** Put a video element on a segment at time t (or park it there, paused). */
  bind(v, seg, t, play) {
    const want = seg.src0 + (t - seg.out0);
    if (v.seg !== seg) {
      // Continuing straight on in the source (back-to-back shots): keep playing, no seek, no hitch.
      const flowing = play && !v.paused && v.seg && !v.seeking && Math.abs(v.currentTime - want) < 0.08;
      v.seg = seg;
      if (!flowing) v.currentTime = want;
    } else {
      const drift = Math.abs(v.currentTime - want);
      if ((play && drift > 0.15) || (!play && drift > 0.02)) v.currentTime = want;
    }
    if (play && v.paused) v.play().catch(() => {});
    if (!play && !v.paused) v.pause();
  }

  frame() {
    if (!this.tl || !this.size) return;
    const t = this.t;
    const act = this.active(t);
    const live = act.filter(s => !s.card);

    // Keep elements already on a live segment; give the rest out.
    const used = new Set();
    for (const s of live) { const v = this.vids.find(x => x.seg === s); if (v) used.add(v); }
    for (const s of live) {
      let v = this.vids.find(x => x.seg === s);
      // Prefer the element that just played the source leading into this segment.
      if (!v) v = this.vids.find(x => !used.has(x) && x.seg && !x.paused && Math.abs(x.currentTime - (s.src0 + (t - s.out0))) < 0.08);
      if (v) used.add(v);
      if (!v) { v = this.vids.find(x => !used.has(x)); if (!v) continue; used.add(v); }
      this.bind(v, s, t, this.playing);
    }
    // Park the spare one on the next segment.
    const spare = this.vids.find(x => !used.has(x));
    if (spare) {
      const next = this.segs.find(s => !s.card && s.out0 > t + 0.001 && !live.includes(s));
      if (next) this.bind(spare, next, next.out0, false);
    }

    // Sound: the current segment, crossfaded during transitions.
    const [cur, prev] = act;
    const p = cur && prev ? Math.min(1, Math.max(0, (t - cur.item.start) / Math.max(0.001, cur.item.trans.d))) : 1;
    for (const v of this.vids) {
      const isCur = cur && v.seg === cur && !cur.card, isPrev = prev && v.seg === prev && !prev.card;
      v.muted = !this.playing || !(isCur || isPrev);
      v.volume = isCur ? (prev ? p : 1) : isPrev ? 1 - p : 0;
    }

    // Picture.
    this.gl.clear();
    let drew = false;
    const layer = (seg, alpha, gain) => {
      if (!seg || seg.card) return;
      const it = seg.item;
      const b = this.brollFor(it, t);
      if (b) { drew = this.gl.draw(b, cover(b, this.tl), { alpha, gain, lut: !!it.shot.broll.grade }) || drew; return; }
      const v = this.vids.find(x => x.seg === seg);
      if (!v || v.readyState < 2) return;
      const fr = shotFraming(it.shot, this.project.settings);
      const z = zoomAt(fr, t - it.start, it.dur);
      drew = this.gl.draw(v, cropRect(v.videoWidth, v.videoHeight, this.tl.width, this.tl.height, z, fr.fx, fr.fy), { alpha, gain }) || drew;
    };
    if (prev) {
      const type = cur.item.trans.type;
      if (DIP.has(type)) {
        if (p < 0.5) layer(prev, 1, 1 - p * 2); else layer(cur, 1, p * 2 - 1);
      } else {
        layer(prev, 1, 1);
        layer(cur, p, 1);
      }
    } else layer(cur, 1, 1);
    if (drew) this.everDrew = true;
    if (!this.segs.length) { this.msg.textContent = 'Every shot is switched off.'; this.msg.hidden = false; }
    else this.msg.hidden = drew || this.everDrew || act.some(s => s.card);

    this.drawMotion(t);
    const cr = this.iframe.contentWindow?.CR;
    if (cr && this.ovReady) cr.seek(t);
  }

  /** Show, hide and sync the animation videos. Top-layer ones (stingers) go above the graphics. */
  drawMotion(t) {
    const live = new Set();
    for (const { o, url, blend } of this.motionLayers) {
      if (!url) continue;
      let v = this.motionVids.get(o.id);
      if (!v || v.dataset.src !== url) {
        v?.remove();
        v = h('video', { muted: true, playsInline: true, preload: 'auto' });
        v.dataset.src = url;
        v.src = url;
        v.addEventListener('seeked', () => this.requestDraw());
        this.motionVids.set(o.id, v);
      }
      const box = o.props?.top ? this.el : this.motionBox;
      if (v.parentElement !== box) { if (o.props?.top) this.el.insertBefore(v, this.msg); else box.append(v); }
      v.classList.toggle('top', !!o.props?.top);
      // Invert masks are drawn in white, so difference shows the picture in negative, as the render does.
      v.style.mixBlendMode = blend === 'invert' ? 'difference' : '';
      live.add(o.id);
      const on = t >= o.start && t < o.end;
      v.style.visibility = on ? 'visible' : 'hidden';
      if (!on) { if (!v.paused) v.pause(); continue; }
      const want = t - o.start;
      if (Math.abs(v.currentTime - want) > (this.playing ? 0.12 : 0.02)) v.currentTime = want;
      if (this.playing && v.paused) v.play().catch(() => {});
      if (!this.playing && !v.paused) v.pause();
    }
    for (const [k, v] of this.motionVids) if (!live.has(k)) { v.remove(); this.motionVids.delete(k); }
  }

  /** The B-roll element if this item shows B-roll at time t. */
  brollFor(it, t) {
    const b = it.shot.broll;
    if (!b?.file) return null;
    const s0 = it.start + (b.start || 0), s1 = s0 + (b.dur || it.dur);
    if (t < s0 || t >= Math.min(s1, it.start + it.dur)) { if (!this.broll.paused) this.broll.pause(); return null; }
    const src = mediaUrl(b.file.startsWith('/') ? b.file : `${this.project.dir}/broll/${b.file}`);
    if (this.broll.dataset.src !== src) { this.broll.dataset.src = src; this.broll.src = src; }
    const want = (b.in || 0) + (t - s0);
    if (Math.abs(this.broll.currentTime - want) > (this.playing ? 0.2 : 0.03)) this.broll.currentTime = want;
    if (this.playing && this.broll.paused) this.broll.play().catch(() => {});
    if (!this.playing && !this.broll.paused) this.broll.pause();
    return this.broll.readyState >= 2 ? this.broll : null;
  }

  destroy() {
    this.pause();
    for (const v of this.motionVids.values()) v.remove();
    for (const v of [...this.vids, this.broll]) { v.removeAttribute('src'); v.load(); }
  }
}

function cover(v, tl) {
  return cropRect(v.videoWidth, v.videoHeight, tl.width, tl.height, 1, 0.5, 0.5);
}
