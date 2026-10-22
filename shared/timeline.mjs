/*
  Storyboard → timeline. The single source of truth for "what plays when".

  The renderer, the overlay track and the in-browser preview all call
  buildTimeline(), so captions and graphics land on the same frame everywhere.
  Every range is quantized to whole output frames here, and the renderer trims
  each range to exactly that many frames, so nothing drifts over a long edit.

  Pure module: runs in Node and in the browser.
*/
import { resolveBrand } from './brand.mjs';
import { isFiller } from './text.mjs';

export const DEFAULT_CUT = { minGap: 0.4, padIn: 0.08, padOut: 0.12, maxExtend: 0.35 };

/**
  Speech threshold for an envelope: 12 dB over the noise floor (10th percentile),
  but never more than 24 dB under the loud end (95th percentile), so a noisy room
  still separates words from gaps.
*/
export function speechThreshold(db) {
  if (!db?.length) return -45;
  const s = [...db].sort((a, b) => a - b);
  const q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return Math.min(q(0.1) + 12, q(0.95) - 24, -20);
}

/** Envelope helpers: dB values sampled at env.rate Hz, with a speech threshold env.thr. */
function loud(env, t) {
  if (!env || !env.db) return false;
  const k = Math.floor(t * env.rate);
  return k >= 0 && k < env.db.length && env.db[k] > env.thr;
}

/** Walk from t in steps of 1/rate while the audio is still loud, up to limit. */
function walk(env, t, dir, limit) {
  if (!env || !env.db) return t;
  const step = 1 / env.rate;
  let x = t;
  while ((dir > 0 ? x + step <= limit : x - step >= limit) && loud(env, dir > 0 ? x : x - step)) x += dir * step;
  return x;
}

/** The words a shot will actually play: in range, not cut. */
export function keptWords(shot, words) {
  if (shot.kind !== 'talk') return [];
  const cut = shot.cut || {};
  const out = [];
  for (let i = shot.w0; i <= shot.w1; i++) if (words[i] && !(i in cut)) out.push(words[i]);
  return out;
}

/**
  Source ranges for one shot, in seconds: kept words grouped into runs, split
  where a cut word sits between them or the pause is longer than minGap, padded,
  extended to the end of the audible tail, and clamped so a range never reaches
  into a neighbouring word that isn't part of it.
*/
export function shotRanges(shot, words, env, cut = {}, duration = Infinity, scenes = []) {
  if (shot.kind === 'raw') return [[Math.max(0, shot.in), Math.min(duration, shot.out)]];
  if (shot.kind !== 'talk') return [];
  const c = { ...DEFAULT_CUT, ...cut };
  const removed = shot.cut || {};
  const groups = [];
  let cur = null;
  for (let i = shot.w0; i <= shot.w1; i++) {
    const w = words[i];
    if (!w) continue;
    if (i in removed) { cur = null; continue; }
    if (cur && w.start - words[cur.last].end <= c.minGap) cur.last = i;
    else groups.push((cur = { first: i, last: i }));
  }
  const ranges = [];
  for (const g of groups) {
    const a = words[g.first], b = words[g.last];
    // A range may reach halfway to the neighbouring word, never further: the neighbour's own
    // range starts at the same midpoint, so back-to-back shots meet exactly instead of overlapping.
    const lo = g.first > 0 ? (words[g.first - 1].end + a.start) / 2 : 0;
    const hi = g.last + 1 < words.length ? (b.end + words[g.last + 1].start) / 2 : duration;
    const s0 = walk(env, a.start, -1, Math.max(lo, a.start - 0.25));
    const e0 = walk(env, b.end, +1, Math.min(hi, b.end + c.maxExtend));
    let s = Math.max(lo, s0 - c.padIn, 0);
    let e = Math.min(hi, e0 + c.padOut, duration);
    // Don't show a frame or two of the next camera angle: snap edges to a nearby camera cut.
    for (const t of scenes) {
      if (t > s && t < s + 0.2 && t < a.start + 0.05) s = t;
      if (t < e && t > e - 0.2 && t > b.end - 0.05) e = t;
    }
    if (e - s < 0.05) { s = a.start; e = Math.max(b.end, a.start + 0.05); }
    const last = ranges[ranges.length - 1];
    if (last && s - last[1] < 0.06) last[1] = Math.max(last[1], e);
    else ranges.push([s, e]);
  }
  return ranges;
}

const TRANSITION_TYPES = new Set(['cut', 'fade', 'fadeblack', 'fadewhite', 'dissolve', 'slideleft', 'slideright', 'slideup', 'smoothleft', 'smoothright', 'wipeleft', 'wiperight', 'circleopen', 'zoomin', 'hblur', 'radial']);
export const isTransition = t => TRANSITION_TYPES.has(t);

/** Output size for an aspect and a short-side resolution. Always even. */
export function outputSize(aspect = '9:16', short = 1080) {
  const [a, b] = String(aspect).split(':').map(Number);
  const even = x => Math.round(x / 2) * 2;
  if (!a || !b) return { width: 1080, height: 1920 };
  return a >= b ? { width: even((short * a) / b), height: short } : { width: short, height: even((short * b) / a) };
}

/**
  Build the edit timeline.
  project: { settings, storyboard: { sections, shots }, source: { duration } }
  analysis: { words, envelope }
*/
export function buildTimeline(project, analysis) {
  const s = project.settings || {};
  const fps = s.fps || 30;
  const words = analysis?.words || [];
  const env = analysis?.envelope;
  const duration = project.source?.duration ?? Infinity;
  const frames = x => Math.max(1, Math.round(x * fps));
  const { width, height } = outputSize(s.aspect, s.resolution || 1080);

  const scenes = analysis?.scenes || [];
  const items = [];
  // Back-to-back source ranges are joined on the exact frame, so a cut between them is invisible.
  let lastRawEnd = -1, lastEnd = -1;
  const sectionById = new Map((project.storyboard?.sections || []).map(x => [x.id, x]));
  let end = 0;
  for (const shot of project.storyboard?.shots || []) {
    if (shot.enabled === false) continue;
    let ranges = [], dur;
    if (shot.kind === 'card') {
      dur = frames(shot.card?.dur ?? 2.5) / fps;
    } else {
      let out0 = 0;
      for (const [a0, b] of shotRanges(shot, words, env, s.cut, duration, scenes)) {
        const a = Math.abs(a0 - lastRawEnd) < 0.002 ? lastEnd : a0;
        const n = frames(b - a);
        lastRawEnd = b;
        lastEnd = a + n / fps;
        ranges.push({ src0: a, src1: a + n / fps, out0, frames: n });
        out0 += n / fps;
      }
      if (!ranges.length) continue;
      dur = out0;
    }
    const prev = items[items.length - 1];
    let type = shot.transition?.type || 'cut';
    if (!isTransition(type) || !prev) type = 'cut';
    let d = 0;
    if (type !== 'cut') {
      const want = frames(shot.transition?.duration ?? 0.3);
      const cap = Math.floor(Math.min(prev.dur, dur) * fps / 2);
      d = Math.min(want, cap) / fps;
      if (d < 2 / fps) { type = 'cut'; d = 0; }
    }
    const start = prev ? end - d : 0;
    items.push({ id: shot.id, shot, section: shot.section, kind: shot.kind, start, dur, ranges, trans: { type, d } });
    end = start + dur;
  }

  // Where every kept word lands in the output.
  const placed = [];
  for (const it of items) {
    if (it.kind !== 'talk' && it.kind !== 'raw') continue;
    const cut = it.shot.cut || {};
    const lo = it.kind === 'talk' ? it.shot.w0 : 0;
    const hi = it.kind === 'talk' ? it.shot.w1 : words.length - 1;
    for (const r of it.ranges) {
      for (let i = lo; i <= hi; i++) {
        const w = words[i];
        if (!w || i in cut || w.end <= r.src0 || w.start >= r.src1) continue;
        const mid = (w.start + w.end) / 2;
        if (mid < r.src0 || mid > r.src1) continue;
        const t0 = it.start + r.out0 + Math.max(0, w.start - r.src0);
        const t1 = it.start + r.out0 + Math.min(r.src1, w.end) - r.src0;
        placed.push({ i, text: w.text, t0, t1, item: it.id, filler: isFiller(w) });
      }
    }
  }
  const wordAt = new Map(placed.map(p => [p.i, p]));

  // Graphics, in absolute output time.
  const overlays = [];
  for (const it of items) {
    if (it.kind === 'card') {
      const m = it.shot.card?.motion;
      // A card can be drawn by an animation (HyperFrames) instead of the Cutaways card.
      if (m?.name) overlays.push({ id: `${it.id}-card`, type: 'motion', start: it.start, end: it.start + it.dur, props: { name: m.name, vars: m.vars || {} }, item: it.id });
      else overlays.push({ id: `${it.id}-card`, type: 'card', start: it.start, end: it.start + it.dur, props: { ...it.shot.card }, item: it.id });
    }
    // A stinger: an animation laid over the cut into this shot, its cover point on the cut.
    const st = it.shot.transition?.stinger;
    if (st?.name && it.start > 0) {
      const len = Number(st.dur) || 1;
      const at = it.start + (it.trans.d || 0) / 2 - len * (st.cut ?? 0.5);
      overlays.push({ id: `${it.id}-stinger`, type: 'motion', start: Math.max(0, at), end: Math.max(0, at) + len, props: { name: st.name, vars: st.vars || {}, top: true }, item: it.id });
    }
    for (const o of it.shot.overlays || []) {
      if (o.enabled === false) continue;
      let start = it.start + (o.at ?? 0);
      if (o.word != null && wordAt.has(o.word)) start = wordAt.get(o.word).t0 - 0.2;
      start = Math.max(it.start, start);
      // Animations play their natural length (stored in dur once rendered).
      const len = o.type === 'motion' ? Number(o.dur) || 3 : o.dur === 'shot' || o.dur == null ? it.start + it.dur - start : o.dur;
      overlays.push({ id: o.id, type: o.type, start, end: Math.min(end, start + Math.max(0.5, len)), props: { ...o }, item: it.id });
    }
  }
  overlays.sort((a, b) => a.start - b.start);

  // Chapter markers, one per section, at the section's first shot.
  const chapters = [];
  const seen = new Set();
  for (const it of items) {
    if (!it.section || seen.has(it.section)) continue;
    seen.add(it.section);
    chapters.push({ id: it.section, title: sectionById.get(it.section)?.title || '', t: it.start });
  }

  const captions = s.captions?.on === false ? [] : chunkCaptions(placed, items, s.captions || {}, width < height);
  return { fps, width, height, duration: end, items, words: placed, overlays, chapters, captions };
}

/**
  Group placed words into caption chunks: short lines, broken at sentence ends,
  commas, pauses, and wherever the edit cuts to a card.
*/
export function chunkCaptions(placed, items, opt = {}, vertical = true) {
  const maxChars = opt.maxChars || (vertical ? 24 : 42);
  const maxDur = opt.maxDur || 2.6;
  const out = [];
  let cur = null;
  const push = () => { if (cur && cur.words.length) out.push(cur); cur = null; };
  const ws = placed.filter(w => !(opt.hideFillers !== false && w.filler));
  ws.forEach((w, k) => {
    const prev = ws[k - 1];
    const len = cur ? cur.words.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length : 0;
    if (cur && (len > maxChars || w.t1 - cur.t0 > maxDur || (prev && w.t0 - prev.t1 > 0.6) || (prev && prev.item !== w.item && items.find(i => i.id === w.item)?.trans.type !== 'cut'))) push();
    if (!cur) cur = { t0: w.t0, t1: w.t1, words: [] };
    cur.words.push({ text: w.text, t0: w.t0, t1: w.t1 });
    cur.t1 = w.t1;
    if (/[.?!…]["'”’)]*$/.test(w.text) || (/[,;:]$/.test(w.text) && cur.words.length >= 2)) push();
  });
  push();
  out.forEach((c, k) => {
    const next = out[k + 1];
    c.t1 = Math.min(next ? next.t0 : Infinity, c.t1 + 0.5);
    c.id = `c${k}`;
  });
  return out;
}

/**
  Animations that sit behind the speaker (overlay `behind: true`): the windows, in output
  seconds, where the cut-out speaker is laid back over the picture, and the shots that need
  a matte for it (talking shots overlapping a window; cards have nobody to cut out).
  `ends` (overlay id → end) overrides an animation's end once its real length is known.
*/
export function cutouts(tl, ends = null) {
  const windows = tl.overlays.filter(o => o.type === 'motion' && o.props.behind && !o.props.top)
    .map(o => ({ id: o.id, start: o.start, end: ends?.get(o.id) ?? o.end }))
    .filter(w => w.end > w.start);
  const items = tl.items.filter(it => it.kind !== 'card' && windows.some(w => it.start < w.end && it.start + it.dur > w.start)).map(it => it.id);
  return { windows, items };
}

/** What the graphics page (graphics/overlay.js) needs to draw a timeline's overlay track. */
export function overlayData(tl, s = {}) {
  return {
    width: tl.width, height: tl.height, fps: tl.fps, duration: tl.duration, theme: s.theme || 'dark',
    // Animations (type 'motion') are separate HyperFrames renders, not drawn by the graphics page.
    overlays: tl.overlays.filter(o => o.type !== 'motion').map(o => ({ id: o.id, type: o.type, start: o.start, end: o.end, props: o.props })),
    captions: s.captions?.on === false ? [] : tl.captions,
    captionStyle: s.captions?.style || 'phrase',
    brand: resolveBrand(s),
  };
}

/** Seconds → "m:ss" or "h:mm:ss". */
export function clock(t, frac = false) {
  t = Math.max(0, t || 0);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const ss = frac ? sec.toFixed(1).padStart(4, '0') : String(Math.floor(sec)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
