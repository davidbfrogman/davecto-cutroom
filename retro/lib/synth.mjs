/* Retro OS sound effects, synthesized (square waves, clicks, filtered noise): no samples, no licences.
   Pure JS (no Node or DOM APIs): the renderer and the preview page both import it, so what you hear
   in the preview is what gets mixed into the export.

   Cues come from the beats (R.sfx / R.open / R.close / R.type in kit/retro.js):
     { t: seconds, s: sound name, vol?: dB, freq?: Hz (blip only) }
   To add a sound: add it to SOUNDS (a Float32Array at RATE) and mention it in GUIDE.md. */

export const RATE = 48000;

let seed = 3;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** Square-wave steps [[freq, dur], ...]; opts: vol, decay (1/s), noise (0–1 mix), lp (one-pole), duty. */
export function tone(steps, { vol = 0.5, decay = 0, noise = 0, lp = 0.35, duty = 0.5 } = {}) {
  const out = []; let ph = 0, y = 0;
  for (const [f, d] of steps) {
    const n = Math.round(d * RATE);
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      ph += f / RATE;
      let s = f ? (ph % 1 < duty ? 1 : -1) : 0;
      if (noise) s = s * (1 - noise) + (rnd() * 2 - 1) * noise;
      const env = (decay ? Math.exp(-t * decay) : 1) * Math.min(1, i / 48, (n - i) / 48);  // 1ms de-click
      y += lp * (s * env - y);                                                              // soften the square
      out.push(y * vol);
    }
  }
  return Float32Array.from(out);
}
const click = (vol = 0.5, ms = 7, lp = 0.6) => tone([[0, ms / 1000]], { vol, noise: 1, decay: 500, lp });

// Built in this order on purpose: the noise sounds share one seeded generator.
export const SOUNDS = {
  open:    tone([[523, .028], [784, .028], [1047, .04]], { vol: .32, lp: .3 }),              // zoom-rect blip up
  close:   tone([[1047, .025], [784, .025], [523, .035]], { vol: .28, lp: .3 }),
  tick:    tone([[1800, .012]], { vol: .22, decay: 260, lp: .5 }),                            // a step, a cell filling
  type:    click(.32, 6),                                                                     // one character
  pop:     tone([[988, .03], [1319, .06]], { vol: .32, decay: 22, lp: .32 }),                 // a chip or label lands
  success: tone([[1047, .07], [1319, .07], [1568, .14]], { vol: .3, decay: 6, lp: .28 }),     // done / pass / saved
  alert:   tone([[880, .11], [0, .05], [880, .16]], { vol: .38, lp: .25 }),                   // the system beep
  error:   tone([[220, .09], [165, .16]], { vol: .4, duty: .3, lp: .22 }),                    // wrong / fail
  strike:  tone([[0, .07]], { vol: .3, noise: 1, decay: 30, lp: .2 }),                        // pen scratch, strike-through
  lock:    (() => { const a = click(.6, 6, .45), b = tone([[330, .05]], { vol: .3, decay: 60, lp: .25 }); const o = new Float32Array(a.length + 2600 + b.length); o.set(a); o.set(b, 2600); return o; })(),
  thunk:   tone([[147, .14]], { vol: .55, decay: 18, lp: .18 }),                              // a heavy button press
  sweep:   tone(Array.from({ length: 9 }, (_, i) => [220 * Math.pow(1.32, i), .034]), { vol: .3, lp: .3 }),  // rising whoosh
  crash:   tone([[0, .25]], { vol: .4, noise: 1, decay: 14, lp: .35 }),                       // something breaks
  sparkle: tone([[2093, .03], [2637, .03], [3136, .05]], { vol: .16, decay: 20, lp: .5 }),
  boot:    (() => { const n = Math.round(.9 * RATE), o = new Float32Array(n); for (const f of [262, 330, 392, 523]) { const t = tone([[f, .9]], { vol: .11, decay: 3.2, lp: .2 }); for (let i = 0; i < n; i++) o[i] += t[i]; } return o; })(),
  notify:  tone([[1568, .06], [0, .03], [2093, .1]], { vol: .26, decay: 10, lp: .3 }),        // a dialog asks for attention
};
const blips = new Map();
/** A short tick at any pitch (rising runs: freq = 500 * 2 ** (i / 16)). */
const blip = f => blips.get(f) || blips.set(f, tone([[f, .014]], { vol: .2, decay: 220, lp: .5 })).get(f);

export const NAMES = [...Object.keys(SOUNDS), 'blip'];

/** Gain that puts the reference mix (PromptGuideNoText, all beats) at -19 dBFS peak, the level the
    user signed off on. Fixed, so turning beats off doesn't make the others louder. */
export const BASE_GAIN = Math.pow(10, -19 / 20) / 0.6147923338053769;

/** Mix cues into a mono Float32Array of `len` seconds. gainDb shifts the whole stem. */
export function mix(cues, len, gainDb = 0) {
  const N = Math.round(len * RATE), out = new Float32Array(N);
  const g = BASE_GAIN * Math.pow(10, gainDb / 20);
  for (const c of cues) {
    const buf = c.s === 'blip' ? blip(c.freq || 1000) : SOUNDS[c.s];
    if (!buf) throw new Error(`unknown sound "${c.s}" (${NAMES.join(' ')})`);
    const o = Math.round(c.t * RATE), v = g * Math.pow(10, (c.vol || 0) / 20);
    for (let i = 0; i < buf.length && o + i < N; i++) if (o + i >= 0) out[o + i] += buf[i] * v;
  }
  return out;
}

/** 16-bit stereo WAV bytes from a mono mix (hard-clipped at full scale). */
export function wav(mono) {
  const n = mono.length, buf = new ArrayBuffer(44 + n * 4), d = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); d.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt '); d.setUint32(16, 16, true);
  d.setUint16(20, 1, true); d.setUint16(22, 2, true); d.setUint32(24, RATE, true); d.setUint32(28, RATE * 4, true);
  d.setUint16(32, 4, true); d.setUint16(34, 16, true); str(36, 'data'); d.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, mono[i])) * 32767 | 0; d.setInt16(44 + i * 4, v, true); d.setInt16(46 + i * 4, v, true); }
  return new Uint8Array(buf);
}
