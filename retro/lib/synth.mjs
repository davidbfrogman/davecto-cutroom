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

/* ---- Adventure set: an original sound world in the style of the classic 8-bit adventure games: NES-like
   pulse (12.5% / 25%) and triangle voices, noise-channel hits, notes articulated one by one with their own
   quick decay, and chords "faked" by cycling their notes every 1/60 s (frame arpeggios). Heroic keys
   (G and D major). Every phrase is our own: no melody from any existing game. ---- */
const tri = (steps, o = {}) => tone(steps, { wave: 'tri', ...o });
const m2f = m => 440 * Math.pow(2, (m - 69) / 12);                 // MIDI note → Hz (60 = middle C)
/** Feedback delay (an echo): `time` s between repeats, `fb` level of each repeat, `n` repeats. */
function echo(dry, { time = .18, fb = .45, n = 4, mix = .6 } = {}) {
  const d = N(time), out = new Float32Array(dry.length + d * n);
  for (let i = 0; i < dry.length; i++) out[i] += dry[i];
  for (let r = 1, g = fb; r <= n; r++, g *= fb) for (let i = 0; i < dry.length; i++) out[i + d * r] += dry[i] * g * mix;
  return out;
}
/** Notes played one by one like a game's sound driver: each its own short decay. hold = the last note's length. */
const nes = (midis, { len = .07, duty = .25, decay = 12, wave = 'square', vol = .28, hold } = {}) =>
  lay(midis.map((m, i) => [m == null ? new Float32Array(1) : tone([[m2f(m), i === midis.length - 1 && hold ? hold : len]], { duty, wave, decay: i === midis.length - 1 && hold ? 3 : decay, vol, lp: .6 }), i * len]));
/** A chord the NES way: its notes cycled every 1/60 s. */
const frameArp = (midis, dur, { duty = .25, decay = 2.5, vol = .26 } = {}) =>
  tone(Array.from({ length: Math.round(dur * 60) }, (_, i) => [m2f(midis[i % midis.length]), 1 / 60]), { duty, decay, vol, lp: .6 });
/** NES noise channel: bright, gritty; lp lower = deeper. */
const nnoise = (dur, { lp = .5, decay = 10, vol = .3 } = {}) => hiss(dur, { lp, decay, vol });
// G major: G3 55 · B3 59 · D4 62 · G4 67 · A4 69 · B4 71 · D5 74 · E5 76 · F#5 78 · G5 79 · A5 81 · B5 83 · D6 86 · G6 91
Object.assign(SOUNDS, {
  dungeon:   peak(lay([[nnoise(1.0, { lp: .06, decay: 1.6 }), 0, .9], [tone(Array.from({ length: 24 }, (_, i) => [m2f(31 + (i % 2)), .04]), { wave: 'tri', vol: .4 }), 0],
               [nes([43, 38], { len: .22, wave: 'tri', decay: 5, vol: .45 }), .55], [lay([[nnoise(.18, { lp: .2, decay: 18 }), 0], [tri([[m2f(31), .25, m2f(26)]], { vol: .5, decay: 10 }), 0]]), 1.0]]), .34),  // the dungeon door grinds open, a low triangle groan, thud
  chest:     peak(lay([[tone(Array.from({ length: 12 }, (_, i) => [[m2f(55 + i), .028], [m2f(62 + i), .028]]).flat(), { duty: .125, vol: .24, lp: .6 }), 0],
               [frameArp([67, 71, 74, 79], .7, { duty: .25, decay: 2.2 }), .68], [nes([43], { len: .7, wave: 'tri', decay: 2.5, vol: .4 }), .68]]), .3),  // tremolo build climbs, then a shimmering G-major chord
  keyget:    peak(echo(nes([74, 78, 81, 86], { len: .055, duty: .125, decay: 16, hold: .22 }), { time: .09, fb: .35, n: 2 }), .26),  // a key: quick bright run up a D chord
  itemget:   peak(lay([[nes([67, 71, 74], { len: .11, duty: .25, decay: 10 }), 0], [frameArp([79, 83, 86], .7, { duty: .25, decay: 1.8 }), .33],
               [nes([43, 47, 50, 55], { len: .11, wave: 'tri', decay: 6, vol: .42, hold: .7 }), 0]]), .3),  // found it: three steps up, then the chord held high
  fairy:     peak(echo(nes([67, 71, 74, 79, 83, 86, 91, 95, 98], { len: .045, duty: .125, decay: 18, vol: .22 }), { time: .12, fb: .5, n: 4 }), .22),  // a fairy's sparkle: a fast pulse arpeggio rising three octaves, echoing
  container: peak(lay([[nes([62, 66, 69, 74, 78, 81], { len: .05, duty: .125, decay: 16 }), 0], [frameArp([74, 78, 81, 86], .8, { duty: .125, decay: 2 }), .3],
               [nes([50], { len: .8, wave: 'tri', decay: 2.2, vol: .42 }), .3]]), .28),  // heart container: a run, then a bright D-major shimmer
  magic:     peak(lay([[tri([[m2f(55), .5, m2f(79)]], { vol: .32, decay: 1.8 }), 0],                                   // a smooth glide rising underneath
               [echo(nes([79, 81, 83, 86, 88, 91, 95], { len: .055, duty: .25, decay: 20, vol: .16 }), { time: .11, fb: .4, n: 3 }), .18],   // sparkles climbing, echoing
               [frameArp([86, 91, 95], .5, { duty: .25, decay: 4.5, vol: .12 }), .58]]), .24),  // a spell is cast: glide, sparkle, shimmer
  boomerang: peak(tone(Array.from({ length: 22 }, (_, i) => [m2f(79 + 5 * Math.sin(i * .9)), .03]), { duty: .125, vol: .24, lp: .55 }), .22),  // thrown: a whirring pulse that circles
  bomb:      peak(lay([[tone(Array.from({ length: 8 }, () => [[0, .03], [1, .012]]).flat().map(([f, d]) => [f ? 3000 : 0, d]), { noise: 1, vol: .3, lp: .7 }), 0],
               [nnoise(.7, { lp: .22, decay: 5.5, vol: .5 }), .34], [tri([[m2f(36), .3, m2f(24)]], { vol: .45, decay: 8 }), .34]]), .36),  // fuse crackles, then an 8-bit boom
  pushblock: peak(lay([[lay(Array.from({ length: 7 }, (_, i) => [nnoise(.07, { lp: .1, decay: 8 }), i * .075])), 0], [nes([38], { len: .25, wave: 'tri', decay: 9, vol: .45 }), .55]]), .32),  // a stone block scrapes, then settles
  cave:      peak(echo(nes([43, null, 38, 37], { len: .2, wave: 'tri', decay: 3.5, vol: .45, hold: .5 }), { time: .3, fb: .4, n: 3 }), .3),  // into a dark cave: low triangle steps, echoing
  ocarina:   peak(echo(nes([76, 79, 84, 83, 79], { len: .17, wave: 'tri', decay: 1.2, vol: .4, hold: .45 }), { time: .2, fb: .3, n: 2 }), .26),  // a little wind-instrument phrase (our own tune)
  solved:    peak(lay([[nes([62, 66, 69, 74, 78], { len: .075, duty: .25, decay: 9 }), 0], [frameArp([81, 86, 90], .6, { duty: .25, decay: 2 }), .375],
               [nes([38, 42, 45, 50], { len: .095, wave: 'tri', decay: 5, vol: .4, hold: .6 }), 0]]), .3),  // puzzle solved: a confident run up D major to a held chord (our own)
  bossdoor:  peak(lay([[tri([[m2f(31), .35, m2f(19)]], { vol: .6, decay: 6 }), 0], [nnoise(.3, { lp: .18, decay: 10, vol: .5 }), 0], [nes([26], { len: .4, wave: 'tri', decay: 4, vol: .4 }), .1]]), .36),  // the boss door slams shut
  lowhealth: peak(tone([[m2f(86), .06], [0, .07], [m2f(86), .06], [0, .07], [m2f(86), .06], [0, .07], [m2f(86), .06]], { duty: .5, vol: .2, lp: .55 }), .2),  // low-health beeps
  poof:      peak(lay([[nnoise(.22, { lp: .55, decay: 16 }), 0, .9], [tone([[m2f(91), .16, m2f(67)]], { duty: .125, vol: .2, decay: 10, lp: .55 }), .02]]), .26),  // an enemy vanishes in a puff
  talk:      peak(lay([76, 79, 76, 81, 79, 76, 83].map((m, i) => [tone([[m2f(m), .025]], { duty: .125, vol: .18, decay: 30, lp: .6 }), i * .055])), .18),  // dialogue text ticking by
});

/* ---- Synthwave set: neon 1980s TV-cop-show night drive (detuned saws, gated toms, echoes). A minor. ---- */
const AM7 = [220, 261.6, 329.6, 392], AM9 = [110, 261.6, 329.6, 392, 493.9];
Object.assign(SOUNDS, {
  neon:      peak(echo(synth([880, 1318.5], .18, { voices: 5, detune: 18, c0: 6000, c1: 1500, ftime: .15, env: { a: .002, d: .1, sus: .3, r: .05 } }), { time: .19, fb: .45, n: 4 }), .26),  // a bright neon lead stab, echoing
  polysweep: peak(verb(synth(AM9, 1.1, { voices: 4, detune: 16, c0: 300, c1: 5000, ftime: .9, env: { a: .05, d: 1, sus: 1, r: .2 } }), { time: 1, mix: .35 }), .26),  // a big poly chord, filter opening
  brass:     peak(verb(synth([220, 329.6, 440], .9, { voices: 4, detune: 12, c0: 600, c1: 3200, ftime: .25, env: { a: .12, d: .5, sus: .6, r: .2 } }), { time: .9, mix: .3 }), .28),  // synth brass swell: the theme-song moment
  chordhit:  peak(echo(synth(AM7.map(f => f * 2), .16, { voices: 3, detune: 10, c0: 4500, c1: 1200, env: { a: .002, d: .08, sus: .2, r: .04 } }), { time: .25, fb: .5, n: 3 }), .26),  // minor-seventh chord stab with an echo
  arpwave:   peak(echo(lay([220, 261.6, 329.6, 392, 440, 523.3, 659.3, 784].map((f, i) => [synth([f], .09, { voices: 2, detune: 9, c0: 3500, c1: 900, env: { a: .002, d: .05, sus: .2, r: .03 } }), i * .07])), { time: .21, fb: .35, n: 2 }), .26),  // a sequenced arpeggio, night-drive style
  riser:     peak(lay([[synth([110, 165], 1.2, { voices: 4, detune: 20, glide: 12, c0: 200, c1: 7000, env: { a: .6, d: 1, sus: 1, r: .05 } }), 0], [hiss(1.2, { lp: .6, hp: .2, rise: true }), 0, .5]]), .26),  // everything rises into the drop
  pulse:     peak(lay(Array.from({ length: 6 }, (_, i) => [synth([55], .12, { voices: 2, detune: 6, c0: 900, c1: 250, env: { a: .002, d: .06, sus: .4, r: .03 } }), i * .14])), .32),  // a driving eighth-note bassline
  echostab:  peak(echo(synth([659.3, 784, 987.8], .12, { voices: 4, detune: 14, c0: 5000, c1: 1800, env: { a: .002, d: .06, sus: .2, r: .04 } }), { time: .28, fb: .55, n: 6, mix: .7 }), .24),  // one stab, a long trail of echoes
  glide:     peak(echo(synth([659.3], .7, { voices: 3, detune: 8, glide: 5, c0: 3500, env: { a: .03, d: .6, sus: .7, r: .15 } }), { time: .22, fb: .35, n: 2 }), .24),  // a lead that slides up into the note
  gatetom:   peak(verb(synth([98], .3, { voices: 1, wave: 'sine', glide: -14, c0: 3000, env: { a: .001, d: .14, sus: 0, r: .04 } }), { time: 1, mix: .55, gate: .32 }), .34),  // a huge gated tom
  starfall:  peak(echo(lay([2093, 1760, 1568, 1318.5, 1046.5].map((f, i) => [fm(f, .25, { ratio: 2, index: 1, idecay: .06, env: { a: .002, d: .1, sus: 0, r: .06 } }), i * .07])), { time: .17, fb: .45, n: 4 }), .18),  // sparkles falling with echoes
  cowbell:   peak(lay([[tone([[540, .25]], { vol: .3, duty: .5, decay: 14, lp: .3 }), 0], [tone([[800, .25]], { vol: .3, duty: .5, decay: 14, lp: .3 }), 0]]), .24),  // the 808 cowbell
  vhs:       peak(synth([220, 261.6, 329.6], .9, { voices: 3, detune: 10, c0: 2200, env: { a: .02, d: 1, sus: .9, r: .1 } }).map((x, i) => x * (1 + .25 * Math.sin(i / RATE * 9))), .22),  // a chord on a worn tape, wobbling
  sunrise:   peak(verb(synth([329.6, 415.3, 493.9, 659.3], 1.0, { voices: 5, detune: 14, c0: 1200, c1: 5000, ftime: .6, env: { a: .25, d: .6, sus: .5, r: .3 } }), { time: 1.1, mix: .35 }), .24),  // a bright major chord blooming: hope
});

const blips = new Map();
/** A short tick at any pitch (rising runs: freq = 500 * 2 ** (i / 16)). */
const blip = f => blips.get(f) || blips.set(f, tone([[f, .014]], { vol: .2, decay: 220, lp: .5 })).get(f);

export const NAMES = [...Object.keys(SOUNDS), 'blip'];
/** The sound catalogue: name → [category, what it is, tags]. Tags say how big it is (tiny · light ·
    medium · big), its mood, and the moments it suits, so a sound can be found by what's happening on
    screen: `retro sounds` lists them all, `retro sounds win warm` searches (the preview's picker
    searches the same words). Every name in SOUNDS (and blip) appears exactly once. */
export const INFO = {
  // ---- Interface: the machinery (quiet, frequent, never the star)
  open:      ['Interface', 'window opens: a quick rising blip', 'light techy window appear start show'],
  close:     ['Interface', 'window closes: a quick falling blip', 'light techy window disappear end hide'],
  tick:      ['Interface', 'a step: a cell filling, a row appearing, a counter ticking', 'tiny techy step count progress list row'],
  type:      ['Interface', 'one key press (R.type cues these itself)', 'tiny techy typing keyboard text'],
  pop:       ['Interface', 'a label, chip or badge lands', 'light playful label chip badge appear land'],
  select:    ['Interface', '8-bit menu cursor moving', 'tiny playful menu choice hover step'],
  confirm:   ['Interface', '8-bit menu OK', 'light playful choice ok yes accept'],
  cancel:    ['Interface', '8-bit menu back', 'light playful no back cancel undo fail'],
  pause:     ['Interface', '8-bit pause jingle', 'light playful stop wait pause hold'],
  blip:      ['Interface', 'a tiny tick at any pitch (freq); rising runs: freq = 500 * 2 ** (i / 16)', 'tiny techy step run count pitch'],
  notify:    ['Interface', 'a dialog asks for attention', 'light techy notification message alert dm'],
  lock:      ['Interface', 'a padlock clicks shut', 'light techy lock secure locked closed'],
  talk:      ['Interface', 'dialogue text ticking by, 8-bit adventure style', 'light playful message speech text dm chat'],
  // ---- Good news: wins, money, upgrades, nice discoveries
  success:   ['Good news', 'done / passed / saved: a bright three-note rise', 'medium techy done pass check saved win small'],
  coin:      ['Good news', 'a point scored, money in, a small win', 'light playful money revenue win point sale small'],
  gem:       ['Good news', 'a small sparkly pickup', 'tiny playful collect pickup small win'],
  heart:     ['Good news', 'health refilled, a little love', 'light playful love like heal refill'],
  oneup:     ['Good news', 'extra life, a bonus, a nice surprise', 'medium playful bonus surprise extra win'],
  powerup:   ['Good news', 'upgraded, growing, levelled up', 'medium playful upgrade grow level improve'],
  fanfare:   ['Good news', 'an item held up high, a small triumph', 'medium playful triumphant win announce'],
  victory:   ['Good news', 'stage clear: the full win jingle', 'big playful triumphant win finish complete'],
  sparkle:   ['Good news', 'a little glint', 'tiny magical shine polish new'],
  shimmer:   ['Good news', 'a glittery bell run', 'light magical shine polish reveal'],
  bell:      ['Good news', 'a DX7 bell "ding"', 'light warm notification ding idea win small'],
  epiano:    ['Good news', 'an electric-piano chord: a warm "yes"', 'medium warm yes agree good win'],
  sunset:    ['Good news', 'a bright synth chord: the feel-good moment', 'big warm happy payoff feelgood win'],
  chest:     ['Good news', 'a treasure chest: tremolo build, then a shining chord', 'big magical discovery reveal treasure unlock win'],
  keyget:    ['Good news', 'got a key: a quick bright run', 'medium magical unlock access key win'],
  itemget:   ['Good news', 'found an item, held up high', 'big triumphant discovery found win'],
  fairy:     ['Good news', 'a fairy\'s sparkle: three-octave pulse arpeggio', 'medium magical help heal sparkle'],
  container: ['Good news', 'max health up: a run and a shimmer', 'medium magical upgrade grow capacity'],
  solved:    ['Good news', 'puzzle solved: a confident run to a held chord', 'big triumphant solved answer figured fix win'],
  starfall:  ['Good news', 'sparkles falling, echoing', 'medium cool magical shine dreamy'],
  sunrise:   ['Good news', 'a bright chord blooming slowly: hope', 'big warm hope new beginning payoff win'],
  // ---- Bad news: fails, warnings, losses, letdowns
  error:     ['Bad news', 'wrong / failed: a low two-note buzz', 'medium techy wrong fail error no'],
  alert:     ['Bad news', 'the system beep: a warning', 'medium techy warning attention danger fail'],
  hurt:      ['Bad news', 'took a hit', 'light playful pain hit damage oops fail'],
  shrink:    ['Bad news', 'power down, downgraded, shrinking', 'medium playful downgrade lose shrink worse fail'],
  gameover:  ['Bad news', 'you lose: a slow sad descent', 'big funny sad lose fail end zero'],
  drop:      ['Bad news', 'pitch and filter fall out of a moment', 'medium cool letdown fall end out fail'],
  tapestop:  ['Bad news', 'a record stops: "wait, what?"', 'medium funny surprise stop wait confused fail'],
  arpdown:   ['Bad news', 'an arpeggio winding down', 'medium cool letdown decline end fail'],
  bossdoor:  ['Bad news', 'a heavy door slams shut behind you', 'big ominous trapped locked doom'],
  lowhealth: ['Bad news', 'low-health warning beeps', 'light tense warning running out low fail'],
  vhs:       ['Bad news', 'a chord on worn, wobbly tape', 'medium nostalgic old worn broken dated'],
  // ---- Big moments: reveals, titles, entrances
  orchhit:   ['Big moments', 'orchestra HIT: the dramatic reveal', 'big dramatic reveal title announce'],
  stab:      ['Big moments', 'brass stab: a title or card lands', 'medium dramatic title card land announce'],
  secret:    ['Big moments', 'a hidden thing found: an 8-bit discovery phrase', 'big playful discovery secret reveal'],
  choir:     ['Big moments', 'an "aah" pad: wonder, a revelation', 'big magical wonder revelation awe'],
  crash:     ['Big moments', 'something breaks', 'big dramatic break crash destroy'],
  explode:   ['Big moments', 'a big 8-bit boom', 'big playful explosion boom destroy'],
  boot:      ['Big moments', 'a startup chord', 'medium techy start launch boot begin'],
  dungeon:   ['Big moments', 'a dungeon door grinds open, groan, thud', 'big ominous enter open start quest'],
  cave:      ['Big moments', 'entering a dark cave: low steps, echoing', 'medium ominous enter dark unknown'],
  ocarina:   ['Big moments', 'a little wind-instrument phrase (our own tune)', 'medium magical story memory song'],
  neon:      ['Big moments', 'a bright neon lead stab, echoing', 'medium cool entrance title stylish'],
  brass:     ['Big moments', 'synth brass swell: the theme-song moment', 'big cool triumphant entrance hero'],
  echostab:  ['Big moments', 'one stab, a long trail of echoes', 'medium cool reveal stylish dramatic'],
  // ---- Build-ups: something is coming (cue them early)
  sweep:     ['Build-ups', 'a rising whoosh', 'light techy rise build incoming'],
  charge:    ['Build-ups', 'powering up a shot', 'medium playful charge build power'],
  arpup:     ['Build-ups', 'an arpeggio climbing', 'medium cool rise build grow'],
  swell:     ['Build-ups', 'a pad swells in (peaks ~0.8 s after the cue: cue it early)', 'medium warm build anticipation'],
  filterup:  ['Build-ups', 'a synth sweep: here it comes', 'medium cool build rise incoming'],
  revcym:    ['Build-ups', 'a reverse cymbal sucking into the next thing', 'medium cool transition into next'],
  tomfill:   ['Build-ups', 'a drum fill lead-in', 'medium cool lead-in transition next'],
  rev:       ['Build-ups', 'an engine revving up', 'medium playful speed ready go'],
  polysweep: ['Build-ups', 'a big poly chord with the filter opening', 'big cool build open reveal'],
  arpwave:   ['Build-ups', 'a night-drive arpeggio', 'medium cool build momentum'],
  riser:     ['Build-ups', 'everything rises into the drop', 'big cool build tension drop'],
  // ---- Hits: impacts and accents
  thunk:     ['Hits', 'a heavy button press', 'medium techy press button click commit'],
  stomp:     ['Hits', 'a squash', 'medium playful squash crush defeat'],
  bump:      ['Hits', 'hit a wall', 'light playful blocked stuck cant fail'],
  brick:     ['Hits', 'something smashed', 'medium playful smash break blocked'],
  kick:      ['Hits', 'kicked away', 'light playful kick away dismiss'],
  gated:     ['Hits', 'a gated 80s snare: a punchy accent', 'medium cool accent punch hit'],
  clap:      ['Hits', 'a drum-machine clap', 'light cool applause accent celebrate'],
  fmbass:    ['Hits', 'deep weight under a landing', 'medium cool weight land heavy'],
  strike:    ['Hits', 'a pen scratch, a strike-through', 'light techy cross out delete redact strike'],
  sword:     ['Hits', 'a swish', 'light playful slash cut swipe'],
  syntom:    ['Hits', 'a laser tom "pew-oom"', 'medium cool zap accent'],
  bomb:      ['Hits', 'a fuse crackles, then an 8-bit boom', 'big playful explode destroy surprise'],
  pushblock: ['Hits', 'a stone block scrapes into place', 'medium playful move place heavy'],
  poof:      ['Hits', 'an enemy vanishes in a puff', 'light playful gone vanish delete remove fail'],
  chordhit:  ['Hits', 'a minor-seventh chord stab with an echo', 'medium cool accent stylish'],
  gatetom:   ['Hits', 'a huge gated tom', 'big cool impact accent drama'],
  cowbell:   ['Hits', 'an 808 cowbell', 'light funny accent groove'],
  // ---- Motion: things moving, speed, shots
  jump:      ['Motion', 'a hop', 'light playful up jump hop appear'],
  bigjump:   ['Motion', 'a big leap', 'medium playful launch leap up big'],
  warp:      ['Motion', 'teleport, warp somewhere else', 'medium playful teleport jump transition'],
  pipe:      ['Motion', 'down a tube', 'medium playful down enter exit'],
  turbo:     ['Motion', 'full throttle', 'medium playful speed fast rush'],
  zap:       ['Motion', 'a laser', 'light playful shoot zap fast'],
  fireball:  ['Motion', 'a shot', 'light playful shoot fire mistake'],
  pluck:     ['Motion', 'a light shiny tick', 'light cool tag land small'],
  magic:     ['Motion', 'a spell: glide, sparkle, shimmer', 'medium magical transform change spell'],
  boomerang: ['Motion', 'thrown, whirring round and back', 'light playful throw return back'],
  pulse:     ['Motion', 'a driving bassline', 'medium cool momentum drive go'],
  glide:     ['Motion', 'a lead sliding up into the note', 'medium cool smooth arrive'],
};
export const CATEGORIES = ['Interface', 'Good news', 'Bad news', 'Big moments', 'Build-ups', 'Hits', 'Motion'];

/** The sets, for the preview's library (names in the order they were added). */
const ALL = Object.keys(SOUNDS), at = n => ALL.indexOf(n);
export const PACKS = {
  'Retro OS': [...ALL.slice(0, at('coin')), 'blip'],
  '8-bit': ALL.slice(at('coin'), at('stab')),
  'Synth-pop': ALL.slice(at('stab'), at('dungeon')),
  'Adventure': ALL.slice(at('dungeon'), at('neon')),
  'Synthwave': ALL.slice(at('neon')),
};

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
    // dur: the user trimmed the sound's tail; a 12 ms fade so the cut doesn't click
    const len = c.dur ? Math.min(buf.length, Math.round(c.dur * RATE)) : buf.length, fade = c.dur ? Math.min(576, len) : 0;
    for (let i = 0; i < len && o + i < N; i++) if (o + i >= 0) out[o + i] += buf[i] * v * (fade && i > len - fade ? (len - i) / fade : 1);
  }
  // the video's end: anything still ringing fades out over the last 20 ms instead of clicking off
  const F = Math.min(N, Math.round(0.02 * RATE));
  for (let i = 0; i < F; i++) out[N - 1 - i] *= i / F;
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
