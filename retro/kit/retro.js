/* Retro OS motion kit for HyperFrames compositions (one beat = one composition).
   Motion rules (../brand/DESIGN.md §7): linear or steps() only, windows appear in 0ms, animate on twos.

   Times: every helper takes absolute times (seconds in the source video). R.T() maps them onto the
   composition's own clock. R.w('phrase') looks a time up in the transcript, so a beat can say
   R.open(win, R.w('recommends')) instead of a number.

   Sound: sound effects live with the animation that makes them. R.open/R.close/R.type cue their
   own sounds (pass { sfx: false } or another sound name to change that); anything else calls
   R.sfx(name, t). The renderer reads R.cues, so turning a beat off in retro.json silences it too.
   Sound names: lib/synth.mjs (open close tick type pop success alert error strike lock thunk sweep
   crash sparkle boot notify blip, plus the 8-bit set: coin jump bigjump stomp powerup oneup shrink
   pipe fireball bump brick kick rev turbo secret fanfare sword hurt heart gem select confirm cancel
   pause zap explode warp gameover victory charge, plus the 80s synth-pop set: stab orchhit gated
   tomfill clap bell epiano sunset arpup arpdown swell filterup revcym tapestop pluck fmbass syntom
   choir shimmer drop).

   Layers: R.win/R.box take { layer: 'name' } (default 'main'). retro.json can move a layer
   ("move": { "save": [0, -4] }, in u) and the lint reports per layer.

   window.RETRO is injected by the build: { words: [{t,e,w}], move: {layer: [dx,dy]}, time: {retime, crop}, hide: [layer], beat }.
   Timing tweaks (retro.json "time", set in the preview or with `retro time`) are applied in R.done:
   write beats in their natural times; R.OUT says where the beat ends up. */
(function () {
  const CFG = window.RETRO || {};
  const R = (window.R = {});
  R.FPS2 = 15;                      // "on twos" at 30fps
  R.F = 1 / R.FPS2;
  R.START = 0;
  R.END = null;
  R.T = t => Math.max(0, Math.round((t - R.START) * 30) / 30);
  R.$ = s => document.querySelector(s);
  R.$$ = s => [...document.querySelectorAll(s)];
  R.u = n => `calc(var(--u) * ${n})`;

  R.tl = gsap.timeline({ paused: true });

  /* ---------- transcript ---------- */
  const norm = s => String(s).toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9'%$.]+/g, ' ').replace(/(^|\s)\.+|\.+(\s|$)/g, ' ').trim();
  // Hyphenated words come back split ("four" "-part"), so phrases are matched word by word on both sides.
  const WORDS = (CFG.words || []).flatMap(x => norm(x.w).split(' ').filter(Boolean).map(n => ({ ...x, n })));
  /** Find a phrase in the transcript at or after `after` (default: this beat's start - 1s).
      Returns the matched words; throws if it isn't there, so typos fail the build loudly. */
  R.find = (phrase, after) => {
    const q = norm(phrase).split(' ');
    if (!q[0]) throw new Error(`R.w: "${phrase}" has no words in it`);
    const from = after ?? (R.START - 1);
    for (let i = 0; i < WORDS.length; i++) {
      if (WORDS[i].t < from - 1e-6) continue;
      let ok = true;
      for (let j = 0; j < q.length && ok; j++) {
        const w = WORDS[i + j]?.n ?? '';
        const a = w.replace(/[^a-z0-9]/g, ''), b = q[j].replace(/[^a-z0-9]/g, '');
        // a punctuation-only query ("%", "$") compares raw text: stripped, it would match every word
        ok = !b ? w.includes(q[j]) : j === q.length - 1 ? w.startsWith(q[j]) || a.startsWith(b) : w === q[j] || a === b;
      }
      if (ok) return WORDS.slice(i, i + q.length);
    }
    throw new Error(`R.w: "${phrase}" not in the transcript after ${from.toFixed(2)}s`);
  };
  /** Start time of a phrase (first word). R.w('recommends'), R.w('a test', 36). */
  R.w = (phrase, after) => R.find(phrase, after)[0].t;
  /** End time of a phrase (last word). */
  R.we = (phrase, after) => { const m = R.find(phrase, after); return m[m.length - 1].e; };

  /* ---------- sound ---------- */
  R.cues = [];
  R.sfxAuto = true;                 // R.open/R.close/R.type cue sounds unless told not to
  let curLayer = 'main';
  /** Cue a sound at absolute time t. opts: { vol (dB, default 0), freq (blip), layer }. */
  R.sfx = (name, t, opts = {}) => {
    if (!name) return;
    R.cues.push({ t, s: name, ...opts, layer: opts.layer || curLayer });
  };
  const auto = (v, dflt) => (v === false ? null : typeof v === 'string' ? v : R.sfxAuto ? dflt : null);

  /* ---------- layers ---------- */
  const layers = {};
  /** The layer element for `name` (created on first use, moved by retro.json). */
  R.layer = (name = 'main') => {
    if (layers[name]) return layers[name];
    const el = document.createElement('div');
    el.className = 'layer';
    el.dataset.layer = name;
    const [dx, dy] = (CFG.move || {})[name] || [0, 0];
    const [ax, ay] = (CFG.move || {})['*'] || [0, 0];
    if (dx || dy || ax || ay) el.style.transform = `translate(${R.u(dx + ax)}, ${R.u(dy + ay)})`;
    R.$('#stage').append(el);
    return (layers[name] = el);
  };
  R.layers = () => Object.keys(layers);

  /** Absolutely positioned element, geometry in u. */
  R.box = (cls, { x, y, w, h, html = '', parent, id, layer, style = {} } = {}) => {
    const el = document.createElement('div');
    el.className = cls;
    if (id) el.id = id;
    if (x != null) el.style.left = R.u(x);
    if (y != null) el.style.top = R.u(y);
    if (w != null) el.style.width = R.u(w);
    if (h != null) el.style.height = R.u(h);
    Object.assign(el.style, style);
    el.style.position = el.style.position || 'absolute';
    el.innerHTML = html;
    const L = parent ? null : layer || 'main';
    (parent || R.layer(L)).append(el);
    el._g = { x, y, w, h };
    el._layer = L || parent.closest('.layer')?.dataset.layer || 'main';
    return el;
  };

  /** A window. variant: paper | grey | pink | world | clear.
      h: 'auto' sizes the window to its content (measured once fonts load; the lint reports the real box). */
  R.win = ({ title, right = '', variant = '', body = '', ...g }) => {
    const auto = g.h === 'auto';
    const el = R.box(`win ${variant ? 'win--' + variant : ''}${auto ? ' win--auto' : ''}`, {
      ...g, h: auto ? null : g.h,
      html: `<div class="win__bar"><span class="t">${title}</span><span class="r">${right}</span></div><div class="win__body">${body}</div>`,
    });
    if (auto) { el._g.auto = true; el._g.h = R.measure(el).h; }
    return el;
  };

  /** An element's box in u, measured now (works while it's hidden). */
  R.measure = el => {
    const U = R.$('#root').getBoundingClientRect().width / 100 || 1, r = el.getBoundingClientRect(), L = el.closest('.layer')?.getBoundingClientRect() || { left: 0, top: 0 };
    return { x: (r.left - L.left) / U, y: (r.top - L.top) / U, w: r.width / U, h: r.height / U };
  };
  // auto-height windows are re-measured once fonts are in, and their zoom trails follow
  const remeasure = [];
  if (document.fonts) document.fonts.ready.then(() => remeasure.forEach(f => f()));

  /** Open a window with the System-1 zoom-rect trail so it lands exactly at `at`. Sound: 'open'. */
  /** Open a window with the System-1 zoom-rect trail so it lands exactly at `at`. Sound: 'open'.
      If `at` is too close to R.START for the trail to play inside the beat, it lands a little later
      (the trail needs `steps` frames on twos). Returns the landing time. */
  R.open = (el, at, { from, steps = 3, sfx } = {}) => {
    const tl = R.tl, g = el._g;
    at = Math.max(at, R.START + (steps + 1) * R.F);
    const t0 = R.T(at) - steps * R.F, zs = [];
    const place = () => {
      const o = from || { x: g.x + g.w / 2, y: g.y + g.h / 2 };
      zs.forEach((z, k) => { const s = (k + 1) / (steps + 1); Object.assign(z.style, { left: R.u(o.x + (g.x - o.x) * s), top: R.u(o.y + (g.y - o.y) * s), width: R.u(g.w * s), height: R.u(g.h * s) }); });
    };
    for (let i = 1; i <= steps; i++) {
      const z = R.box('zoom', { parent: el.parentNode });
      zs.push(z);
      tl.set(z, { autoAlpha: 1 }, t0 + (i - 1) * R.F);
      tl.set(z, { autoAlpha: 0 }, t0 + (i + 1) * R.F);
    }
    place();
    if (g.auto) remeasure.push(() => { g.h = R.measure(el).h; place(); });
    tl.set(el, { autoAlpha: 1 }, R.T(at));
    R.sfx(auto(sfx, 'open'), at - 0.1, { layer: el._layer });
    return at;
  };

  /** Close: window vanishes, zoom rects collapse toward a point. Sound: 'close'. */
  R.close = (el, at, { to, steps = 3, sfx } = {}) => {
    const tl = R.tl, g = el._g, zs = [];
    const place = () => {
      const o = to || { x: g.x + g.w / 2, y: g.y + g.h / 2 };
      zs.forEach((z, k) => { const s = 1 - (k + 1) / (steps + 1); Object.assign(z.style, { left: R.u(o.x + (g.x - o.x) * s), top: R.u(o.y + (g.y - o.y) * s), width: R.u(g.w * s), height: R.u(g.h * s) }); });
    };
    tl.set(el, { autoAlpha: 0 }, R.T(at));
    for (let i = 1; i <= steps; i++) {
      const z = R.box('zoom', { parent: el.parentNode });
      zs.push(z);
      tl.set(z, { autoAlpha: 1 }, R.T(at) + (i - 1) * R.F);
      tl.set(z, { autoAlpha: 0 }, R.T(at) + i * R.F);
    }
    place();
    if (g.auto) remeasure.push(place);
    R.sfx(auto(sfx, 'close'), at, { layer: el._layer });
  };

  R.show = (el, at) => R.tl.set(el, { autoAlpha: 1 }, R.T(at));
  R.hide = (el, at) => R.tl.set(el, { autoAlpha: 0 }, R.T(at));

  /** Pixel type-on (monospace): reveals characters in steps. Sound: a 'type' click per character
      (at most 15 a second). */
  R.type = (el, at, cps = 22, { sfx } = {}) => {
    const chars = [...(el._full ??= el.textContent)], n = chars.length, o = { k: 0 };
    el.style.width = 'auto';
    el.textContent = '';
    R.tl.set(el, { autoAlpha: 1 }, R.T(at));
    R.tl.fromTo(o, { k: 0 }, { k: n, duration: n / cps, ease: `steps(${n})`, onUpdate: () => { el.textContent = chars.slice(0, Math.round(o.k)).join(''); } }, R.T(at));
    const s = auto(sfx, 'type');
    if (s) { const every = Math.max(1, Math.ceil(cps / 15)); for (let i = 0; i < n; i += every) R.sfx(s, at + i / cps, { layer: el.closest?.('.layer')?.dataset.layer }); }
  };

  /** Stepped counter, on twos. */
  R.count = (el, at, dur, from, to, fmt = v => Math.round(v).toLocaleString('en-US')) => {
    const o = { v: from };
    el.textContent = fmt(from);
    R.tl.to(o, { v: to, duration: dur, ease: `steps(${Math.max(1, Math.round(dur * R.FPS2))})`, onUpdate: () => { el.textContent = fmt(o.v); } }, R.T(at));
  };

  /** Swap text at a moment (reverts when seeking back). */
  R.text = (el, at, s) => R.tl.set(el, { textContent: s }, R.T(at));

  /** Blink: 50% duty, `period` seconds, between a and b. */
  R.blink = (el, a, b, period = 1) => {
    for (let t = a; t < b; t += period) {
      R.tl.set(el, { autoAlpha: 1 }, R.T(t));
      R.tl.set(el, { autoAlpha: 0 }, R.T(Math.min(b, t + period / 2)));
    }
  };

  /** Flash an element inverted n times (classic alert). */
  R.flash = (el, at, n = 2) => {
    for (let i = 0; i < n; i++) {
      R.tl.set(el, { filter: 'invert(1)' }, R.T(at) + i * 2 * R.F);
      R.tl.set(el, { filter: 'none' }, R.T(at) + (i * 2 + 1) * R.F);
    }
  };

  /** Run fn(t) on every frame between a and b (absolute times, stepped on twos by default).
      For canvases and anything drawn procedurally; fn gets absolute video time. */
  R.every = (a, b, fn, fps = R.FPS2) => {
    const o = { k: 0 }, n = Math.max(1, Math.round((b - a) * fps));
    R.tl.fromTo(o, { k: 0 }, { k: n, duration: R.T(b) - R.T(a), ease: `steps(${n})`, onUpdate: () => fn(a + o.k / fps) }, R.T(a));
  };

  /* ---------- building blocks (the mechanics most beats end up needing) ---------- */
  R.clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  R.lerp = (a, b, k) => a + (b - a) * R.clamp(k);
  const arr = els => (typeof els === 'string' ? R.$$(els) : els instanceof Element ? [els] : [...els]);

  /** Reveal elements one by one, evenly from a to b (or every `gap` s from a). Sound per item
      (default tick; every: cue every nth; vol). Returns the times. */
  R.stagger = (els, a, b, { gap, sfx = 'tick', vol = -5, every = 1, layer } = {}) => {
    els = arr(els);
    const n = els.length, ts = els.map((_, i) => gap != null ? a + i * gap : n < 2 ? a : a + (b - a) * i / (n - 1));
    els.forEach((el, i) => {
      R.show(el, ts[i]);
      if (sfx && i % every === 0) R.sfx(sfx, ts[i], { vol, layer: layer || el.closest?.('.layer')?.dataset.layer });
    });
    return ts;
  };

  /** A button pressed in: shifts into its hard shadow for two frames. Sound: thunk. */
  R.press = (el, t, { depth = .5, sfx = 'thunk', vol = 0 } = {}) => {
    const sh = getComputedStyle(el).boxShadow;
    R.tl.set(el, { x: R.u(depth), y: R.u(depth), boxShadow: 'none' }, R.T(t));
    R.tl.set(el, { x: 0, y: 0, boxShadow: sh }, R.T(t) + 2 * R.F);
    if (sfx) R.sfx(sfx, t, { vol, layer: el.closest?.('.layer')?.dataset.layer });
  };

  /** Move an element through keys [[t, x, y], ...] (u, relative to its offset parent), linear,
      stepped on twos. move: seconds each leg takes (default: the whole gap). Holds at the ends. */
  R.path = (el, keys, { move } = {}) => {
    const at = t => {
      let i = 0; while (i < keys.length - 2 && t >= keys[i + 1][0]) i++;
      const [a, x0, y0] = keys[i], [b, x1, y1] = keys[Math.min(i + 1, keys.length - 1)];
      const k = b === a ? 1 : R.clamp((t - a) / Math.max(R.F, move ? Math.min(move, b - a) : b - a));
      return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
    };
    const put = t => { const [x, y] = at(t); el.style.left = R.u(x.toFixed(2)); el.style.top = R.u(y.toFixed(2)); };
    put(keys[0][0]);
    R.every(keys[0][0], keys.at(-1)[0], put);
    return at;
  };

  /** Flip-book: cycle an element's children (one visible at a time) from a to b, `fps` frames a
      second (7.5 = every other twos frame). Pair with R.pixAnim. */
  R.flip = (el, a, b, { fps = 7.5 } = {}) => {
    const kids = [...el.children];
    const put = t => { const k = Math.floor((t - a) * fps + 1e-6) % kids.length; kids.forEach((c, i) => { c.style.display = i === k ? '' : 'none'; }); };
    put(a);
    R.every(a, b, put);
  };
  /** Pixel-art frames for R.flip: R.pixAnim([rowsA, rowsB], cell). */
  R.pixAnim = (frames, cell) => `<span class="flip">${frames.map((f, i) => `<span${i ? ' style="display:none"' : ''}>${R.pix(f, cell)}</span>`).join('')}</span>`;

  /** Scrolling marquee: el shows `chars` characters of text, scrolling `cps` characters a second. */
  R.marquee = (el, a, b, text, { chars = 22, cps = 15 } = {}) => {
    const loop = [...(text + text)], n = [...text].length;
    R.every(a, b, t => { const k = Math.floor((t - a) * cps) % n; el.textContent = loop.slice(k, k + chars).join(''); });
  };

  /** Seeded random, deterministic. */
  let seed = 11;
  R.rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  R.seed = s => { seed = s; };

  /** Pixel art from rows of chars: k ink, p paper, n accent, g green, w window grey, . empty. */
  R.pix = (rows, cell) => {
    const w = rows[0].length;
    return `<div class="pix" style="grid-template-columns:repeat(${w}, calc(var(--u) * ${cell}));grid-auto-rows:calc(var(--u) * ${cell})">` +
      rows.join('').split('').map(c => `<i class="${c === '.' ? '' : c}"></i>`).join('') + '</div>';
  };

  R.seg = (n = 4) => `<div class="seg">${'<i></i>'.repeat(n)}</div>`;

  /** Finish: set length and register. `end` is absolute. */
  R.done = end => {
    R.END = end;
    const total = R.T(end);
    // anything timed after the beat ends never shows: usually a word lookup that matched too late
    R.warnings = [];
    const late = R.tl.getChildren(true, true, true).filter(c => c.startTime() > total + 1e-3);
    if (late.length) R.warnings.push(`${late.length} animation(s) start after the beat ends (${end.toFixed(2)}s), first at ${(R.START + Math.min(...late.map(c => c.startTime()))).toFixed(2)}s`);
    const lateSfx = R.cues.filter(c => c.t > end + 0.05 || c.t < R.START - 0.15);
    if (lateSfx.length) R.warnings.push(`${lateSfx.length} sound(s) outside the beat: ${lateSfx.slice(0, 3).map(c => `${c.s}@${c.t.toFixed(2)}`).join(', ')}`);
    R.tl.set({}, {}, total);

    // Timing from retro.json ("time": { retime: [a, b], crop: [c, d] }, absolute seconds):
    //   retime  the whole beat plays between a and b instead (faster or slower), sounds move with it
    //   crop    only c..d shows (no speed change); sounds outside it are dropped
    // Everything downstream (lint, preview, render, the sound mix) reads R.OUT (where the beat shows,
    // in video seconds) and R.cues (rewritten to output times). R.START/R.END stay as written, so
    // per-frame code that reads them keeps working; R.SRC is the same pair.
    const tm = CFG.time || {}, s0 = R.START, e0 = end;
    R.SRC = { start: s0, end: e0 };
    const [a, b] = tm.retime && tm.retime[1] - tm.retime[0] > 0.1 ? tm.retime : [s0, e0];
    const k = (b - a) / (e0 - s0);
    let [c, d] = tm.crop || [a, b];
    c = Math.max(a, Math.min(c, b - R.F)); d = Math.min(b, Math.max(d, c + R.F));
    const out = t => a + (t - s0) * k;                        // a beat time → output time
    R.cues = R.cues.map(q => ({ ...q, t: Math.round(out(q.t) * 1000) / 1000 })).filter(q => q.t >= c - 0.15 && q.t <= d);
    // Layers the user switched off (retro.json "hide": [layer, ...]): gone, sounds included
    const hide = CFG.hide || [];
    hide.forEach(L => { if (layers[L]) layers[L].style.display = 'none'; });
    R.cues = R.cues.filter(q => !hide.includes(q.layer || 'main'));
    R.map = out;
    R.OUT = { start: c, end: d };
    let root = R.tl;
    if (k !== 1 || c !== a || d !== b) {
      root = gsap.timeline({ paused: true });
      root.add(R.tl.tweenFromTo((c - a) / k, (d - a) / k, { duration: d - c, ease: 'none' }), 0);
      root.set({}, {}, d - c);
    }
    R.$$('.clip').forEach(el => el.setAttribute('data-duration', String(Math.round((d - c) * 30) / 30)));
    window.__timelines = window.__timelines || {};
    window.__timelines.root = root;
  };
})();
