/* Retro OS sound effects, synthesized (square waves, clicks, filtered noise): no samples, no licences.
   Pure JS (no Node or DOM APIs): the renderer and the preview page both import it, so what you hear
   in the preview is what gets mixed into the export.

   Cues come from the beats (R.sfx / R.open / R.close / R.type in kit/retro.js):
     { t: seconds, s: sound name, vol?: dB, freq?: Hz (blip only) }
   To add a sound: add it to SOUNDS (a Float32Array at RATE) and mention it in GUIDE.md. */

export const RATE = 48000;

let seed = 3;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** Square-wave steps [[freq, dur, toFreq?], ...] (toFreq = a linear pitch slide across the step);
    opts: vol, decay (1/s), noise (0–1 mix), lp (one-pole), duty, wave ('square' | 'tri', the NES bass). */
export function tone(steps, { vol = 0.5, decay = 0, noise = 0, lp = 0.35, duty = 0.5, wave = 'square' } = {}) {
  const out = []; let ph = 0, y = 0;
  for (const [f0, d, f1] of steps) {
    const n = Math.round(d * RATE);
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const f = f1 === undefined ? f0 : f0 + (f1 - f0) * i / n;
      ph += f / RATE;
      let s = !f ? 0 : wave === 'tri' ? 4 * Math.abs((ph % 1) - .5) - 1 : (ph % 1 < duty ? 1 : -1);
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

  /* ---- 8-bit game set (original sounds in the NES style; appended so the noise seed above is untouched) ---- */
  coin:     tone([[1175, .05], [1568, .22]], { vol: .26, decay: 9, duty: .25, lp: .35 }),            // a point, money in
  jump:     tone([[330, .15, 990]], { vol: .26, duty: .25, decay: 4, lp: .3 }),                       // a hop up
  bigjump:  tone([[220, .24, 1250]], { vol: .26, duty: .25, decay: 3, lp: .3 }),                      // a big leap
  stomp:    tone([[420, .09, 110]], { vol: .34, duty: .5, decay: 12, noise: .25, lp: .25 }),          // squash
  powerup:  tone([523, 659, 784, 587, 740, 880, 659, 831, 988, 698, 880, 1047].map(f => [f, .035]), { vol: .24, lp: .3 }),  // growing / upgraded
  oneup:    tone([659, 784, 1319, 1047, 1175, 1568].map(f => [f, .075]), { vol: .22, duty: .25, lp: .3 }),  // extra life, bonus
  shrink:   tone([988, 932, 740, 698, 523, 494, 370, 349].map(f => [f, .045]), { vol: .24, duty: .25, lp: .3 }),  // power down, downgrade
  pipe:     tone([0, 1, 2].flatMap(k => [[440 - k * 90, .05], [220 - k * 45, .05]]), { vol: .26, lp: .25 }),  // going down a tube
  fireball: tone([[1400, .07, 300]], { vol: .26, noise: .35, decay: 18, lp: .35 }),                   // a shot
  bump:     tone([[110, .06], [98, .05]], { vol: .42, decay: 25, lp: .2 }),                           // hit a wall
  brick:    tone([[0, .18]], { vol: .36, noise: 1, decay: 22, lp: .3 }),                              // something smashed
  kick:     tone([[740, .02, 330], [0, .01], [1480, .03, 900]], { vol: .28, duty: .25, decay: 30, lp: .35 }),  // a shell / a ball kicked
  rev:      tone(Array.from({ length: 24 }, (_, i) => [70 + i * 7 + (i % 2) * 18, .022]), { vol: .3, duty: .3, lp: .22 }),  // engine revs up
  turbo:    tone(Array.from({ length: 30 }, (_, i) => [180 + (i % 3) * 28, .016]), { vol: .26, duty: .25, noise: .15, lp: .25 }),  // full throttle buzz
  secret:   tone([392, 370, 311, 220, 208, 330, 415, 523].map(f => [f, .075]), { vol: .22, lp: .3 }),  // a hidden thing found (original phrase)
  fanfare:  tone([[523, .1], [523, .1], [523, .1], [698, .32]], { vol: .24, duty: .25, decay: 1.2, lp: .28 }),  // item held up high
  sword:    tone([[0, .09]], { vol: .3, noise: 1, decay: 28, lp: .55 }),                              // a swish
  hurt:     tone([880, 587, 831, 554, 784, 523].map(f => [f, .03]), { vol: .3, duty: .5, lp: .25 }),   // took a hit
  heart:    tone([[1047, .03], [0, .02], [1397, .03], [0, .02], [1760, .05]], { vol: .22, lp: .35 }),  // health refilled
  gem:      tone([[2093, .025], [2637, .025], [3136, .025], [4186, .05]], { vol: .16, decay: 14, lp: .5 }),  // a small pickup
  select:   tone([[1319, .025]], { vol: .2, duty: .25, decay: 50, lp: .4 }),                         // menu cursor moves
  confirm:  tone([[988, .04], [1976, .08]], { vol: .24, duty: .25, decay: 12, lp: .35 }),             // menu OK
  cancel:   tone([[784, .04], [392, .08]], { vol: .24, duty: .25, decay: 12, lp: .3 }),               // menu back
  pause:    tone([[988, .04], [1319, .04], [988, .04], [1319, .07]], { vol: .22, duty: .25, lp: .35 }),  // the game stops
  zap:      tone([[2400, .14, 180]], { vol: .22, duty: .25, decay: 6, lp: .35 }),                     // a laser
  explode:  tone([[0, .6]], { vol: .42, noise: 1, decay: 6, lp: .12 }),                               // big boom
  warp:     tone([0, 1, 2, 3].map(k => [300 + k * 120, .07, 900 + k * 260]), { vol: .22, duty: .25, lp: .3 }),  // teleport / level warp
  gameover: tone([[392, .18], [330, .18], [262, .18], [196, .45]], { vol: .32, wave: 'tri', decay: 1.5, lp: .3 }),  // you lose
  victory:  tone([[523, .09], [659, .09], [784, .09], [1047, .18], [0, .05], [784, .09], [1047, .32]], { vol: .22, duty: .25, decay: .8, lp: .3 }),  // stage clear
  charge:   tone(Array.from({ length: 16 }, (_, i) => [200 * Math.pow(1.12, i) + (i % 2) * 40, .03]), { vol: .22, duty: .25, lp: .3 }),  // powering up a shot
};
/* ---- 80s synth-pop set: detuned saws, filter sweeps, FM bells, gated reverb. Momentary effects, not
   music. Tuned to A minor so any two of them sit together. Built after everything above, so the
   shared noise generator gives the earlier sounds exactly what it always did. ---- */
const N = d => Math.round(d * RATE);
const TAU = Math.PI * 2;
/** Attack / release envelope (seconds) with exponential decay toward `sus` in between. */
const adsr = (i, n, { a = .005, d = .2, sus = .6, r = .08 }) => {
  const t = i / RATE, end = n / RATE;
  const body = t < a ? t / a : sus + (1 - sus) * Math.exp(-(t - a) / d);
  return body * Math.min(1, (end - t) / r);
};
/** Detuned saw/square voices through a two-pole lowpass whose cutoff glides c0 → c1 (Hz). */
function synth(freqs, dur, { voices = 3, detune = 12, wave = 'saw', c0 = 4000, c1 = c0, ftime = dur, env = {}, glide = 0, vol = .3 } = {}) {
  const n = N(dur), o = new Float32Array(n), ph = [];
  freqs.forEach(() => { for (let v = 0; v < voices; v++) ph.push(rnd()); });
  let y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const k = i / n, bend = glide ? Math.pow(2, glide * k / 12) : 1;
    let x = 0, p = 0;
    for (const f of freqs) for (let v = 0; v < voices; v++, p++) {
      const cents = voices > 1 ? (v / (voices - 1) - .5) * 2 * detune : 0;
      ph[p] += f * bend * Math.pow(2, cents / 1200) / RATE;
      const q = ph[p] % 1;
      x += wave === 'square' ? (q < .5 ? 1 : -1) : wave === 'sine' ? Math.sin(TAU * q) : 2 * q - 1;
    }
    x /= Math.sqrt(freqs.length * voices);
    const fc = c0 * Math.pow(c1 / c0, Math.min(1, i / N(ftime))), g = 1 - Math.exp(-TAU * fc / RATE);
    y1 += g * (x - y1); y2 += g * (y1 - y2);
    o[i] = y2 * adsr(i, n, env) * vol;
  }
  return o;
}
/** Two-operator FM (sine carrier, sine modulator), modulation index falling over `idecay` s: bells, e-piano, bass. */
function fm(f, dur, { ratio = 3.5, index = 4, idecay = .25, env = {}, vol = .3 } = {}) {
  const n = N(dur), o = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE, I = index * Math.exp(-t / idecay);
    o[i] = Math.sin(TAU * f * t + I * Math.sin(TAU * f * ratio * t)) * adsr(i, n, env) * vol;
  }
  return o;
}
/** Filtered noise: lp/hp as one-pole coefficients, exponential decay (1/s), or a rising swell. */
function hiss(dur, { lp = .5, hp = 0, decay = 0, rise = false, vol = .3 } = {}) {
  const n = N(dur), o = new Float32Array(n); let y = 0, z = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE, x = rnd() * 2 - 1;
    y += lp * (x - y); z += hp * (y - z);
    const e = rise ? Math.pow(i / n, 2.2) : decay ? Math.exp(-t * decay) : 1;
    o[i] = (y - (hp ? z : 0)) * e * Math.min(1, (n - i) / 96) * vol;
  }
  return o;
}
/** Small Schroeder reverb (4 combs, 2 allpasses). gate: cut the tail hard after this many seconds. */
function verb(dry, { time = 1.2, mix = .35, gate = 0 } = {}) {
  const tail = N(gate || time), n = dry.length + tail, out = new Float32Array(n), wet = new Float32Array(n);
  for (const [d, g] of [[1557, .84], [1617, .83], [1491, .85], [1422, .86]]) {
    const buf = new Float32Array(d); let k = 0, lp = 0;
    for (let i = 0; i < n; i++) { const y = buf[k]; lp += .3 * (y - lp); buf[k] = (dry[i] || 0) + lp * g; k = (k + 1) % d; wet[i] += y / 4; }
  }
  for (const d of [225, 556]) {
    const buf = new Float32Array(d); let k = 0;
    for (let i = 0; i < n; i++) { const b = buf[k], x = wet[i], y = -.5 * x + b; buf[k] = x + .5 * y; k = (k + 1) % d; wet[i] = y; }
  }
  for (let i = 0; i < n; i++) {
    const gateEnv = gate ? (i < dry.length + N(gate) - 480 ? 1 : Math.max(0, (dry.length + N(gate) - i) / 480)) : 1;
    out[i] = ((dry[i] || 0) * (1 - mix) + wet[i] * mix * 2.2) * gateEnv;
  }
  return out;
}
/** Lay buffers out in time: [[buf, at seconds, gain], ...]. */
const lay = parts => {
  const n = Math.max(...parts.map(([b, at = 0]) => N(at) + b.length)), o = new Float32Array(n);
  for (const [b, at = 0, g = 1] of parts) { const s = N(at); for (let i = 0; i < b.length; i++) o[s + i] += b[i] * g; }
  return o;
};
/** Scale to a peak, so every sound in the set sits at the same calibrated level. */
const peak = (b, p) => { let m = 0; for (const v of b) m = Math.max(m, Math.abs(v)); const g = m ? p / m : 0; return b.map(v => v * g); };

// A minor: A2 110 · C3 131 · E3 165 · F3 175 · A3 220 · C4 262 · D4 294 · E4 330 · G4 392 · A4 440 · C5 523 · E5 659 · G5 784 · A5 880
const AM = [220, 261.6, 329.6], FMAJ7 = [174.6, 220, 261.6, 329.6];
Object.assign(SOUNDS, {
  stab:     peak(verb(synth(AM.map(f => f * 2), .16, { voices: 4, detune: 14, c0: 5200, c1: 700, ftime: .14, env: { a: .002, d: .06, sus: .3, r: .04 } }), { time: .7, mix: .25 }), .3),       // brass stab: a reveal, a title landing
  orchhit:  peak(verb(lay([[synth([110, 220, 261.6, 329.6, 440], .22, { voices: 3, detune: 20, c0: 7000, c1: 900, env: { a: .001, d: .08, sus: .15, r: .06 } })], [hiss(.12, { lp: .6, decay: 30 }), 0, .7]]), { time: .9, mix: .3 }), .34),  // the big "HIT": a dramatic reveal
  gated:    peak(verb(lay([[synth([196], .07, { voices: 1, wave: 'sine', glide: -7, c0: 3000, env: { a: .001, d: .03, sus: 0, r: .02 } })], [hiss(.09, { lp: .55, hp: .06, decay: 26 }), 0, .9]]), { time: 1, mix: .55, gate: .3 }), .34),  // gated-reverb snare: a punchy accent
  tomfill:  peak(lay([196, 165, 131, 110].map((f, i) => [verb(synth([f], .16, { voices: 1, wave: 'sine', glide: -10, c0: 2500, env: { a: .001, d: .07, sus: 0, r: .03 } }), { time: .5, mix: .3, gate: .12 }), i * .085])), .34),  // electronic tom fill: a lead-in
  clap:     peak(verb(lay([0, .011, .022, .034].map((d, i) => [hiss(i < 3 ? .012 : .08, { lp: .7, hp: .3, decay: i < 3 ? 80 : 32 }), d])), { time: .8, mix: .3, gate: .22 }), .3),  // drum-machine clap: a beat lands
  bell:     peak(verb(fm(880, .9, { ratio: 3.5, index: 3, idecay: .3, env: { a: .002, d: .35, sus: 0, r: .1 } }), { time: .8, mix: .3 }), .24),  // DX bell: a notification, a "ding"
  epiano:   peak(verb(lay(AM.map((f, i) => [fm(f * 2, .7, { ratio: 1, index: 1.6, idecay: .12, env: { a: .003, d: .3, sus: .1, r: .15 } }), i * .018])), { time: .7, mix: .25 }), .26),  // e-piano chord: a warm "yes"
  sunset:   peak(verb(synth(FMAJ7.map(f => f * 2), 1.05, { voices: 5, detune: 16, c0: 900, c1: 4200, ftime: .5, env: { a: .03, d: .5, sus: .4, r: .35 } }), { time: .9, mix: .35 }), .26),  // bright maj7 swell: the feel-good moment
  arpup:    peak(verb(lay([220, 261.6, 329.6, 440, 523.3, 659.3, 880, 1046.5].map((f, i) => [synth([f], .1, { voices: 2, detune: 8, wave: 'square', c0: 2600, c1: 900, env: { a: .002, d: .05, sus: .2, r: .03 } }), i * .055])), { time: .7, mix: .25 }), .26),  // sequenced arpeggio up: something building
  arpdown:  peak(verb(lay([880, 659.3, 523.3, 440, 329.6, 261.6, 220, 164.8].map((f, i) => [synth([f], .1, { voices: 2, detune: 8, wave: 'square', c0: 2600, c1: 900, env: { a: .002, d: .05, sus: .2, r: .03 } }), i * .055])), { time: .7, mix: .25 }), .26),  // arpeggio down: winding down, a letdown
  swell:    peak(synth([110, 164.8, 220, 329.6], .9, { voices: 4, detune: 18, c0: 250, c1: 3800, env: { a: .7, d: 1, sus: 1, r: .12 } }), .26),  // pad swells up into a moment (cue it .8 s early)
  filterup: peak(synth([55, 110], .6, { voices: 3, detune: 20, c0: 120, c1: 6000, env: { a: .01, d: 1, sus: 1, r: .06 } }), .28),  // resonant-style sweep up: "whoosh, here it comes"
  revcym:   peak(hiss(.75, { lp: .8, hp: .25, rise: true }), .24),  // reverse cymbal: a transition, sucks into the next thing
  tapestop: peak(synth([220, 329.6], .45, { voices: 3, detune: 10, glide: -30, c0: 3000, c1: 300, env: { a: .002, d: 1, sus: 1, r: .05 } }), .26),  // pitch dives to a halt: record-scratch "wait, what"
  pluck:    peak(verb(synth([659.3], .2, { voices: 3, detune: 10, c0: 5000, c1: 500, ftime: .12, env: { a: .001, d: .07, sus: 0, r: .05 } }), { time: .9, mix: .35 }), .22),  // chorused pluck: a light tick with shine
  fmbass:   peak(fm(55, .3, { ratio: 1, index: 5, idecay: .06, env: { a: .002, d: .12, sus: .3, r: .05 } }), .34),  // FM bass hit: weight under a landing
  syntom:   peak(verb(synth([330], .3, { voices: 1, wave: 'sine', glide: -24, c0: 4000, env: { a: .001, d: .12, sus: 0, r: .04 } }), { time: .8, mix: .3 }), .3),  // laser tom "pew-oom": a zap with body
  choir:    peak(verb(lay(AM.map(f => [synth([f, f * 2.01], .8, { voices: 3, detune: 9, wave: 'sine', c0: 1400, env: { a: .12, d: .4, sus: .6, r: .25 } }), 0])), { time: .9, mix: .4 }), .22),  // "aah" pad stab: wonder, a revelation
  shimmer:  peak(verb(lay([1318.5, 1568, 1760, 2093].map((f, i) => [fm(f, .4, { ratio: 2, index: 1.2, idecay: .1, env: { a: .002, d: .15, sus: 0, r: .1 } }), i * .04])), { time: .9, mix: .45 }), .16),  // glittery bell run: magic, polish
  drop:     peak(synth([220, 110], .55, { voices: 3, detune: 14, glide: -12, c0: 5000, c1: 160, env: { a: .002, d: 1, sus: 1, r: .08 } }), .26),  // filter + pitch fall: the downlifter, out of a moment
});

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
