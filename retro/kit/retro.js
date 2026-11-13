/* Retro OS motion kit for HyperFrames compositions (one beat = one composition).
   Motion rules (../brand/DESIGN.md §7): linear or steps() only, windows appear in 0ms, animate on twos.

   Times: every helper takes absolute times (seconds in the source video). R.T() maps them onto the
   composition's own clock. R.w('phrase') looks a time up in the transcript, so a beat can say
   R.open(win, R.w('recommends')) instead of a number.

   Sound: sound effects live with the animation that makes them. R.open/R.close/R.type cue their
   own sounds (pass { sfx: false } or another sound name to change that); anything else calls
   R.sfx(name, t). The renderer reads R.cues, so turning a beat off in retro.json silences it too.
   Sound names: lib/synth.mjs (open close tick type pop success alert error strike lock thunk sweep
   crash sparkle boot notify blip).

   Layers: R.win/R.box take { layer: 'name' } (default 'main'). retro.json can move a layer
   ("move": { "save": [0, -4] }, in u) and the lint reports per layer.

   window.RETRO is injected by the build: { words: [{t,e,w}], move: {layer: [dx,dy]}, beat }. */
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
    const from = after ?? (R.START - 1);
    for (let i = 0; i < WORDS.length; i++) {
      if (WORDS[i].t < from - 1e-6) continue;
      let ok = true;
      for (let j = 0; j < q.length && ok; j++) {
        const w = WORDS[i + j]?.n ?? '';
        ok = j === q.length - 1 ? w.startsWith(q[j]) || w.replace(/[^a-z0-9]/g, '').startsWith(q[j].replace(/[^a-z0-9]/g, '')) : w === q[j] || w.replace(/[^a-z0-9]/g, '') === q[j].replace(/[^a-z0-9]/g, '');
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

  /** A window. variant: paper | grey | pink | world | clear. */
  R.win = ({ title, right = '', variant = '', body = '', ...g }) =>
    R.box(`win ${variant ? 'win--' + variant : ''}`, {
      ...g,
      html: `<div class="win__bar"><span class="t">${title}</span><span class="r">${right}</span></div><div class="win__body">${body}</div>`,
    });

  /** Open a window with the System-1 zoom-rect trail so it lands exactly at `at`. Sound: 'open'. */
  R.open = (el, at, { from, steps = 3, sfx } = {}) => {
    const tl = R.tl, g = el._g;
    const o = from || { x: g.x + g.w / 2, y: g.y + g.h / 2 };
    const t0 = R.T(at) - steps * R.F;
    for (let i = 1; i <= steps; i++) {
      const s = i / (steps + 1);
      const z = R.box('zoom', {
        x: o.x + (g.x - o.x) * s, y: o.y + (g.y - o.y) * s, w: g.w * s, h: g.h * s, parent: el.parentNode,
      });
      tl.set(z, { autoAlpha: 1 }, Math.max(0, t0 + (i - 1) * R.F));
      tl.set(z, { autoAlpha: 0 }, Math.max(0, t0 + (i + 1) * R.F));
    }
    tl.set(el, { autoAlpha: 1 }, R.T(at));
    R.sfx(auto(sfx, 'open'), at - 0.1, { layer: el._layer });
    return el;
  };

  /** Close: window vanishes, zoom rects collapse toward a point. Sound: 'close'. */
  R.close = (el, at, { to, steps = 3, sfx } = {}) => {
    const tl = R.tl, g = el._g;
    const o = to || { x: g.x + g.w / 2, y: g.y + g.h / 2 };
    tl.set(el, { autoAlpha: 0 }, R.T(at));
    for (let i = 1; i <= steps; i++) {
      const s = 1 - i / (steps + 1);
      const z = R.box('zoom', { x: o.x + (g.x - o.x) * s, y: o.y + (g.y - o.y) * s, w: g.w * s, h: g.h * s, parent: el.parentNode });
      tl.set(z, { autoAlpha: 1 }, R.T(at) + (i - 1) * R.F);
      tl.set(z, { autoAlpha: 0 }, R.T(at) + i * R.F);
    }
    R.sfx(auto(sfx, 'close'), at, { layer: el._layer });
  };

  R.show = (el, at) => R.tl.set(el, { autoAlpha: 1 }, R.T(at));
  R.hide = (el, at) => R.tl.set(el, { autoAlpha: 0 }, R.T(at));

  /** Pixel type-on (monospace): reveals characters in steps. Sound: a 'type' click per character
      (at most 15 a second). */
  R.type = (el, at, cps = 22, { sfx } = {}) => {
    const n = [...el.textContent].length;
    R.tl.set(el, { autoAlpha: 1 }, R.T(at));
    R.tl.fromTo(el, { width: '0ch' }, { width: `${n}ch`, duration: n / cps, ease: `steps(${n})` }, R.T(at));
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
    R.$$('.clip').forEach(c => c.setAttribute('data-duration', String(total)));
    R.tl.set({}, {}, total);
    window.__timelines = window.__timelines || {};
    window.__timelines.root = R.tl;
  };
})();
