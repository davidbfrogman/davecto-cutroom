/* Zooms: the slow push-ins on the video under the graphics. Rules, not judgement: no model picks them.
   Pure (no Node or DOM APIs): the editor (served as zoom.mjs), the lint and the render all build the same
   plan from the same inputs, so they agree on where the picture is at every frame.

   Per beat in retro.json:  "zoom": { "kind": "auto", "to": 1.25, "punch": [{ "t": 12.3, "dur": 1.2, "by": 1.15 }] }
   A beat with no "zoom" uses the project's own "zoom" (new projects: "auto"; older ones: none).
     push   a slow push from 100% to `to` across the beat, about the frame's centre
     pop    the opening move: a quick zoom out from `to` to 100% (POP s), then the slow push
     pan    the slow push about the face instead of the centre: the picture moves as it zooms, so a face
            low in the frame doesn't fall off the bottom
     auto   pop on the opening beat, push on the rest; about the face (pan) instead of the centre when a
            centre push would carry the face and chin band off the frame or under the Instagram caption
     off    no push (punch-ins still play)
   punch: punch-ins on words. From t for dur seconds the picture jumps `by` (1.15 = 15% closer) about the
   face, then back.

   The picture at time t: screen = S·p + (X, Y), p a point of the video in u (1% of the frame width,
   top-left origin). A plan is a list of segments [a, b, S0, S1, X0, X1, Y0, Y1], linear in t between a
   and b; outside every segment the picture is as shot. Zoom is never below 100% and the picture always
   covers the frame (no black edges). */
import { faceAt, noGo, SAFE } from './rules.mjs';

export const DEFAULT = { to: 1.25, pop: 0.2, by: 1.15, dur: 1.2 };
export const KINDS = ['auto', 'push', 'pop', 'pan', 'off'];
export const NONE = { S: 1, X: 0, Y: 0 };

/** The zoom a beat asks for, with defaults filled in: { kind, to, punch }. dflt: the project's "zoom". */
export function setting(zoom, dflt) {
  const z = zoom ?? (typeof dflt === 'string' ? { kind: dflt } : dflt) ?? null;
  if (!z) return { kind: 'off', to: DEFAULT.to, punch: [] };
  return { kind: KINDS.includes(z.kind) ? z.kind : 'auto', to: Math.max(1, Math.min(2, +z.to || DEFAULT.to)), punch: (z.punch || []).filter(p => Number.isFinite(+p.t)) };
}

const median = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1];
/** The face's centre over [a, b) (median of the samples), or null. */
function faceCentre(faces, a, b) {
  const fs = (faces?.samples || []).filter(s => s.t >= a - 1e-6 && s.t < b && s.faces[0]).map(s => s.faces[0]);
  if (!fs.length) { const f = faceAt(faces, (a + b) / 2); return f ? [f[0] + f[2] / 2, f[1] + f[3] / 2] : null; }
  return [median(fs.map(f => f[0] + f[2] / 2)), median(fs.map(f => f[1] + f[3] / 2))];
}
/** Would a push to `to` about the centre carry the face's no-go zone off the frame or under the caption? */
export function wouldLeave(faces, a, b, to, fh) {
  const cx = 50, cy = fh / 2, m = (v, c) => c + to * (v - c);
  return (faces?.samples || []).some(s => {
    if (s.t < a - 1e-6 || s.t >= b || !s.faces[0]) return false;
    const [x, y, w, h] = noGo(s.faces[0]);
    return m(y + h, cy) > fh - SAFE.bottom || m(y, cy) < 0 || m(x, cx) < 0 || m(x + w, cx) > 100;
  });
}

/** What each beat does: [{ id, a, b, kind (as asked), does: 'push'|'pop'|'pan'|'off', to, anchor, punch }].
    beats: [{ id, start, end, zoom }] (start/end: where the beat shows). faces: faces.json (or null). */
export function resolve(beats, faces, { fh = faces?.height ?? 177.78, dflt = null } = {}) {
  const list = beats.filter(b => b.start != null && b.end > b.start).sort((p, q) => p.start - q.start);
  return list.map((b, i) => {
    const z = setting(b.zoom, dflt), a = b.start, end = b.end;
    const centre = [50, fh / 2], face = faceCentre(faces, a, end);
    const leaves = face && wouldLeave(faces, a, end, z.to, fh);
    let does = z.kind;
    if (does === 'auto') does = i === 0 && a < 1 ? 'pop' : leaves ? 'pan' : 'push';
    const anchor = (does === 'pan' || (does === 'pop' && leaves)) && face ? face : centre;
    if (does === 'pan' && !face) does = 'push';
    const punch = z.punch.map(p => ({ t: +p.t, end: Math.min(end, +p.t + (+p.dur || DEFAULT.dur)), by: Math.max(1, +p.by || DEFAULT.by),
      at: (() => { const f = faceAt(faces, +p.t); return f ? [f[0] + f[2] / 2, f[1] + f[3] / 2] : anchor; })() }))
      .filter(p => p.t >= a - 1e-6 && p.t < end && p.end > p.t);
    return { id: b.id, a, b: end, kind: z.kind, does, to: z.to, anchor, punch, pop: does === 'pop' ? Math.min(DEFAULT.pop, (end - a) / 3) : 0 };
  });
}

/** The base push's scale at t inside a resolved beat. */
function baseS(r, t) {
  if (r.does === 'off') return 1;
  if (r.pop && t < r.a + r.pop) return r.to + (1 - r.to) * (t - r.a) / r.pop;
  const a = r.a + r.pop;
  return 1 + (r.to - 1) * Math.max(0, t - a) / Math.max(1e-6, r.b - a);
}
/** Keep the picture covering the frame: X in [100(1-S), 0], Y in [fh(1-S), 0]. */
const cover = (z, fh) => ({ S: z.S, X: Math.min(0, Math.max(100 * (1 - z.S), z.X)), Y: Math.min(0, Math.max(fh * (1 - z.S), z.Y)) });
/** The transform at t inside a resolved beat with the punch-ins in `on` applied (each about its face, as it
    shows at that moment, so the face holds still while the picture jumps closer). */
function evalAt(r, t, on, fh) {
  const s = baseS(r, t);
  let z = { S: s, X: r.anchor[0] * (1 - s), Y: r.anchor[1] * (1 - s) };
  for (const p of on) {
    const ax = z.S * p.at[0] + z.X, ay = z.S * p.at[1] + z.Y;     // the face on screen
    z = { S: p.by * z.S, X: p.by * z.X + (1 - p.by) * ax, Y: p.by * z.Y + (1 - p.by) * ay };
  }
  return cover(z, fh);
}

/** Segments for the whole video: [[a, b, S0, S1, X0, X1, Y0, Y1], ...], sorted, not overlapping. */
export function segments(resolved, { fh = 177.78 } = {}) {
  const out = [];
  for (const r of resolved) {
    if (r.does === 'off' && !r.punch.length) continue;
    const cuts = [...new Set([r.a, r.b, r.a + r.pop, ...r.punch.flatMap(p => [p.t, p.end])].filter(t => t >= r.a && t <= r.b).map(t => Math.round(t * 1e4) / 1e4))].sort((p, q) => p - q);
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1];
      if (b - a < 1e-4) continue;
      const on = r.punch.filter(p => p.t <= a + 1e-6 && p.end >= b - 1e-6);
      const za = evalAt(r, a, on, fh), zb = evalAt(r, b - 1e-6, on, fh);
      out.push([a, b, za.S, zb.S, za.X, zb.X, za.Y, zb.Y].map(v => Math.round(v * 1e5) / 1e5));
    }
  }
  return out.sort((p, q) => p[0] - q[0]);
}

/** The whole thing: beats + faces → { resolved, segs }. */
export function plan(beats, faces, opts = {}) {
  const fh = opts.fh ?? faces?.height ?? 177.78, resolved = resolve(beats, faces, { ...opts, fh });
  return { resolved, segs: segments(resolved, { fh }) };
}

/** The transform { S, X, Y } at time t. */
export function at(segs, t) {
  for (const [a, b, S0, S1, X0, X1, Y0, Y1] of segs) {
    if (t < a) break;
    if (t < b) { const k = (t - a) / (b - a); return { S: S0 + (S1 - S0) * k, X: X0 + (X1 - X0) * k, Y: Y0 + (Y1 - Y0) * k }; }
  }
  return NONE;
}

/** A box [x, y, w, h] in the video → where it shows on screen. */
export const mapBox = ([x, y, w, h], z) => [z.S * x + z.X, z.S * y + z.Y, z.S * w, z.S * h];

/** faces.json as it shows: every sample's boxes moved by the zoom at its time. */
export function zoomFaces(faces, segs) {
  if (!faces || !segs.length) return faces;
  const r = v => Math.round(v * 10) / 10;
  return { ...faces, zoomed: true, samples: faces.samples.map(s => ({ ...s, faces: s.faces.map(f => mapBox(f, at(segs, s.t)).map(r)) })) };
}

/* ---------- ffmpeg ----------
   The zoom is a per-frame scale (to w·S × h·S, straight from the video's own size, so there's one resample)
   and a w×h crop at the zoom's offset. It runs at the speed of a plain scale; the perspective filter, which
   does it to the sub-pixel, rebuilt a whole-frame lookup table every frame and doubled the export time.
   Rounding to whole pixels moves things by under a pixel. Time is the frame's own timestamp (+ t0). */
const n = v => (Math.round(v * 1e5) / 1e5).toString();
/** One value (k: 2 = S, 4 = X, 6 = Y) as an ffmpeg expression of time ld(0), piecewise over the segments. */
function piece(segs, k, dflt) {
  let e = n(dflt);                                      // after the last segment: as shot
  for (const s of [...segs].reverse()) {                 // each earlier segment wraps the ones after it
    const [a, b] = s, v0 = s[k], v1 = s[k + 1];
    const lin = v0 === v1 ? n(v0) : `(${n(v0)}+${n((v1 - v0) / (b - a))}*(ld(0)-${n(a)}))`;
    e = `if(lt(ld(0),${n(a)}),${n(dflt)},if(lt(ld(0),${n(b)}),${lin},${e}))`;
  }
  return e;
}
/** Filters that turn a picture of any size into w×h with the plan's zoom (a plain scale when there's none). */
export function ffZoom(segs, { w, h, t0 = 0, flags = 'lanczos' }) {
  if (!segs.length) return `scale=${w}:${h}:flags=${flags}`;
  const T = `st(0,t+${n(t0)})`, S = piece(segs, 2, 1), X = piece(segs, 4, 0), Y = piece(segs, 6, 0), px = n(w / 100);
  return `scale=w='${T};trunc(${w}*${S}+0.5)':h='${T};trunc(${h}*${S}+0.5)':eval=frame:flags=${flags},` +
    // the crop's iw/ih stay the first frame's size, so it's clamped against the scaled size worked out here
    `crop=${w}:${h}:x='${T};clip(trunc(-${px}*${X}+0.5),0,trunc(${w}*${S}+0.5)-${w})':y='${T};clip(trunc(-${px}*${Y}+0.5),0,trunc(${h}*${S}+0.5)-${h})'`;
}
/** The same for one moment (contact sheets): the zoom { S, X, Y } as constants. */
export function ffZoomAt(z, { w, h, flags = 'lanczos' }) {
  if (z.S === 1 && !z.X && !z.Y) return `scale=${w}:${h}:flags=${flags}`;
  const sw = Math.trunc(w * z.S + 0.5), sh = Math.trunc(h * z.S + 0.5), r = v => Math.trunc(v + 0.5);
  const x = Math.min(sw - w, Math.max(0, r(-w / 100 * z.X))), y = Math.min(sh - h, Math.max(0, r(-w / 100 * z.Y)));
  return `scale=${sw}:${sh}:flags=${flags},crop=${w}:${h}:${x}:${y}`;
}
