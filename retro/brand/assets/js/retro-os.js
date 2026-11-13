/* ==========================================================================
   RETRO OS — generative textures + motion helpers
   No dependencies. Everything is seeded, so a card renders identically
   every time (important when exporting frames for reels).

   Auto-init: any element with data-ros="<name>" is picked up by RetroOS.init().
     data-ros="dither"      <canvas>  ordered-dither halftone blobs
     data-ros="life"        <canvas>  Conway's Game of Life scatter
     data-ros="cube"        <canvas>  rotating wireframe boxes
     data-ros="clock"       any       live date + time (Clock Tool)
     data-ros="boot"        .boot     stepped loading bar
     data-ros="term-race"   any       two terminals racing line by line
     data-ros="punchcard"   any       generated punch-card SVG
     data-ros="figure"      any       generated patent-drawing SVG ("FIG. 12")
     data-ros="b64"         any       fills with base64 of data-msg
   ========================================================================== */
(function () {
  "use strict";

  /* ---------- utils ---------- */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function bayer(n) {
    if (n === 1) return [[0]];
    const m = bayer(n / 2), h = n / 2, out = [];
    for (let y = 0; y < n; y++) {
      out.push([]);
      for (let x = 0; x < n; x++) {
        const v = 4 * m[y % h][x % h];
        const q = (y < h ? (x < h ? 0 : 2) : (x < h ? 3 : 1));
        out[y].push(v + q);
      }
    }
    return out;
  }
  const B8 = bayer(8);
  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function size(el) {
    return { w: el.offsetWidth || el.clientWidth || +el.getAttribute("width") || 300,
             h: el.offsetHeight || el.clientHeight || +el.getAttribute("height") || 150 };
  }
  function whenVisible(el, onChange) {
    if (!("IntersectionObserver" in window)) { onChange(true); return; }
    new IntersectionObserver(es => es.forEach(e => onChange(e.isIntersecting))).observe(el);
  }
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 1. Dither blobs ----------
     blobs: [{x, y, r}] in 0–1 units of canvas width/height (r is a fraction of width).
     The look: dense ordered-dither core, thinning to scattered single pixels at the edge. */
  function dither(canvas, o) {
    o = Object.assign({ pixel: 3, color: "#1E1E1E", seed: 7, gamma: 1.6, density: .78, jitter: .3,
      blobs: [{ x: .18, y: .8, r: .28 }, { x: .85, y: .35, r: .24 }, { x: .5, y: 1.05, r: .3 }] }, o);
    const { w, h } = size(canvas);
    const W = Math.ceil(w / o.pixel), H = Math.ceil(h / o.pixel);
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d"), img = ctx.createImageData(W, H), d = img.data;
    const [r, g, b] = hexToRgb(o.color), rand = rng(o.seed);
    const blobs = o.blobs.map(bl => ({ cx: bl.x * W, cy: bl.y * H, rad: bl.r * W }));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let keep = 1;
        for (const bl of blobs) {
          const dist = Math.hypot(x - bl.cx, y - bl.cy) / bl.rad;
          if (dist < 1.25) {
            const f = Math.pow(Math.max(0, 1 - dist / 1.25), o.gamma);
            keep *= 1 - f;
          }
        }
        const v = (1 - keep) * o.density;
        const t = ((B8[y & 7][x & 7] + .5) / 64) * (1 - o.jitter) + rand() * o.jitter;
        if (v > t) { const i = (y * W + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /* ---------- 2. Game of Life scatter ---------- */
  const GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
  function life(canvas, o) {
    o = Object.assign({ cell: 3, fps: 8, density: .14, seed: 3, color: "#1E1E1E", gliders: 10 }, o);
    const { w, h } = size(canvas);
    const W = Math.ceil(w / o.cell), H = Math.ceil(h / o.cell);
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d"), rand = rng(o.seed);
    let grid = new Uint8Array(W * H), next = new Uint8Array(W * H);
    function seed() {
      // a few soup patches + some gliders, so it always looks "alive"
      for (let p = 0; p < 5; p++) {
        const px = Math.floor(rand() * W), py = Math.floor(rand() * H), s = 6 + Math.floor(rand() * 10);
        for (let y = 0; y < s; y++) for (let x = 0; x < s; x++)
          if (rand() < o.density * 3) grid[((py + y) % H) * W + ((px + x) % W)] = 1;
      }
      for (let k = 0; k < o.gliders; k++) {
        const gx = Math.floor(rand() * W), gy = Math.floor(rand() * H), flip = rand() < .5;
        GLIDER.forEach(([x, y]) => { grid[((gy + y) % H) * W + ((gx + (flip ? 2 - x : x)) % W)] = 1; });
      }
    }
    function draw() {
      ctx.clearRect(0, 0, W, H); ctx.fillStyle = o.color;
      for (let i = 0; i < grid.length; i++) if (grid[i]) ctx.fillRect(i % W, (i / W) | 0, 1, 1);
    }
    function step() {
      let pop = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
          if (dx || dy) n += grid[((y + dy + H) % H) * W + ((x + dx + W) % W)];
        const alive = grid[y * W + x];
        const v = (alive && (n === 2 || n === 3)) || (!alive && n === 3) ? 1 : 0;
        next[y * W + x] = v; pop += v;
      }
      [grid, next] = [next, grid];
      if (pop < (W * H) / 900) seed();
      draw();
    }
    seed(); draw();
    if (reduced) return;
    let timer = null;
    whenVisible(canvas, vis => {
      if (vis && !timer) timer = setInterval(step, 1000 / o.fps);
      if (!vis && timer) { clearInterval(timer); timer = null; }
    });
  }

  /* ---------- 3. Wireframe boxes ---------- */
  function cube(canvas, o) {
    o = Object.assign({ color: "#FEFEFE", speed: .25, flicker: .06 }, o);
    const { w, h } = size(canvas), dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
    const boxes = [
      { c: [-.28, .12, 0], s: [1.05, .85, .9] },
      { c: [.3, -.18, .12], s: [.62, 1.15, .78] }
    ];
    const E = [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]];
    const rand = rng(11);
    function frame(t) {
      const a = t * .001 * o.speed, tilt = -.42 + Math.sin(t * .0004) * .08;
      ctx.clearRect(0, 0, w, h); ctx.strokeStyle = o.color; ctx.lineWidth = 1;
      const scale = Math.min(w, h) * .42;
      for (const bx of boxes) {
        const pts = [];
        for (let i = 0; i < 8; i++) {
          let x = bx.c[0] + (i & 1 ? .5 : -.5) * bx.s[0];
          let y = bx.c[1] + (i & 2 ? .5 : -.5) * bx.s[1];
          let z = bx.c[2] + (i & 4 ? .5 : -.5) * bx.s[2];
          const x1 = x * Math.cos(a) - z * Math.sin(a), z1 = x * Math.sin(a) + z * Math.cos(a);
          const y1 = y * Math.cos(tilt) - z1 * Math.sin(tilt), z2 = y * Math.sin(tilt) + z1 * Math.cos(tilt);
          const p = 3 / (3 + z2);
          pts.push([w / 2 + x1 * scale * p, h / 2 + y1 * scale * p]);
        }
        for (const [i, j] of E) {
          ctx.setLineDash(rand() < o.flicker ? [14, 9] : []);
          ctx.beginPath(); ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[j][0], pts[j][1]); ctx.stroke();
        }
      }
      if (!reduced) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- 4. Clock tool ---------- */
  function clock(el) {
    const dEl = el.querySelector("[data-date]"), tEl = el.querySelector("[data-time]");
    const fixed = el.dataset.fixed ? new Date(el.dataset.fixed) : null;
    function tick() {
      const now = fixed || new Date();
      if (dEl) dEl.textContent = now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
      if (tEl) tEl.textContent = now.toLocaleTimeString("en-GB", { hour12: false });
    }
    tick(); if (!fixed) setInterval(tick, 1000);
  }

  /* ---------- 5. Boot loader ---------- */
  function boot(el) {
    const bar = el.querySelector(".boot__bar"), pct = bar && bar.querySelector("b");
    const screen = el.closest("[data-boot-screen]");
    const loop = el.hasAttribute("data-loop");
    let p = 0;
    function run() {
      p = 0; if (screen) screen.style.background = "var(--boot)";
      const iv = setInterval(() => {
        p = Math.min(1, p + (Math.random() < .3 ? .22 : .06));    // stepped, uneven, like a real loader
        bar.style.setProperty("--p", p);
        if (pct) pct.textContent = Math.round(p * 100) + "%";
        if (p >= 1) {
          clearInterval(iv);
          if (screen) screen.style.background = "var(--boot-dim)";
          if (loop) setTimeout(run, 2600);
        }
      }, 180);
    }
    if (reduced) { bar.style.setProperty("--p", 1); if (pct) pct.textContent = "100%"; return; }
    run();
  }

  /* ---------- 6. Terminal race ----------
     Markup: [data-ros=term-race] containing two [data-term] windows, each with
     .term__gutter and pre.term. Lines come from a <script type="application/json"> child. */
  function termRace(el) {
    const data = JSON.parse(el.querySelector("script[type='application/json']").textContent);
    const terms = [...el.querySelectorAll("[data-term]")];
    const speeds = terms.map(t => +t.dataset.speed || 400);
    function build(t) {
      const gutter = t.querySelector(".term__gutter"); gutter.innerHTML = "";
      data.lines.forEach(() => gutter.appendChild(document.createElement("i")));
      t.querySelector("pre").textContent = data.header + "\n";
    }
    function run() {
      terms.forEach(build);
      const t0 = performance.now(), n = data.lines.length;
      const state = terms.map(t => ({ pre: t.querySelector("pre"), cells: t.querySelectorAll(".term__gutter i"),
        stat: t.querySelector("[data-stat]"), shown: 0 }));
      state.forEach(s => { if (s.stat) s.stat.hidden = true; });
      // time-based, so it stays correct even when the browser throttles timers
      const iv = setInterval(() => {
        const el = performance.now() - t0;
        state.forEach((s, k) => {
          const want = Math.min(n, Math.floor(el / speeds[k]) + 1);
          while (s.shown < want) { s.pre.textContent += data.lines[s.shown] + "\n"; s.cells[s.shown].classList.add("on"); s.shown++; }
          if (s.shown >= n && s.stat) s.stat.hidden = false;
        });
        if (el > Math.max(...speeds) * n + 3500) { clearInterval(iv); run(); }
      }, 30);
    }
    if (reduced) {
      terms.forEach(t => { build(t); const pre = t.querySelector("pre");
        pre.textContent += data.lines.join("\n"); t.querySelectorAll(".term__gutter i").forEach(c => c.classList.add("on")); });
      return;
    }
    let started = false;
    whenVisible(el, vis => { if (vis && !started) { started = true; run(); } });
  }

  /* ---------- 7. Punch card (SVG) ---------- */
  function punchcard(el, o) {
    o = Object.assign({ cols: 28, seed: 5, header: "SYS.CARD//0110-A$.-<>/+" }, o);
    const rand = rng(o.seed), cw = 14, rh = 22, W = o.cols * cw + 10, H = 10 * rh + 40;
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block">`;
    s += `<text x="6" y="18" font-family="VT323,monospace" font-size="20" fill="currentColor" letter-spacing="2">${o.header}</text>`;
    for (let c = 0; c < o.cols; c++) {
      const holes = new Set(); holes.add(Math.floor(rand() * 10)); if (rand() < .35) holes.add(Math.floor(rand() * 10));
      for (let r = 0; r < 10; r++) {
        const x = 6 + c * cw, y = 36 + r * rh;
        s += holes.has(r)
          ? `<rect x="${x + 2}" y="${y}" width="7" height="16" rx="3" fill="currentColor"/>`
          : `<text x="${x + 5.5}" y="${y + 14}" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="13" fill="currentColor">${r}</text>`;
      }
    }
    el.innerHTML = s + "</svg>";
  }

  /* ---------- 8. Patent figure (SVG line art) ---------- */
  function figure(el, o) {
    o = Object.assign({ seed: 9, fig: "12" }, o);
    const rand = rng(o.seed), W = 400, H = 300, cx = 170 + rand() * 30, cy = 150;
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block" fill="none" stroke="currentColor" stroke-width="1.2">`;
    // gear
    const teeth = 18, R = 92, r = 80;
    let d = "";
    for (let i = 0; i < teeth * 2; i++) {
      const a0 = (i / (teeth * 2)) * Math.PI * 2, a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2, rr = i % 2 ? r : R;
      d += `${i ? "L" : "M"}${cx + Math.cos(a0) * rr},${cy + Math.sin(a0) * rr}L${cx + Math.cos(a1) * rr},${cy + Math.sin(a1) * rr}`;
    }
    s += `<path d="${d}Z"/>`;
    [60, 44, 18].forEach(rad => { s += `<circle cx="${cx}" cy="${cy}" r="${rad}"/>`; });
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; s += `<line x1="${cx + Math.cos(a) * 18}" y1="${cy + Math.sin(a) * 18}" x2="${cx + Math.cos(a) * 44}" y2="${cy + Math.sin(a) * 44}"/>`; }
    // hatch block
    s += `<rect x="${cx + 70}" y="${cy - 110}" width="90" height="60" transform="rotate(18 ${cx + 115} ${cy - 80})"/>`;
    for (let i = 0; i < 9; i++) s += `<line x1="${cx + 74 + i * 10}" y1="${cy - 106}" x2="${cx + 64 + i * 10}" y2="${cy - 56}" stroke-width=".7" transform="rotate(18 ${cx + 115} ${cy - 80})"/>`;
    // leader lines + reference numerals
    const labels = [[cx - 140, 40], [cx - 150, 250], [cx + 150, 260], [cx + 170, 120]];
    labels.forEach(([lx, ly], i) => {
      const n = 700 + Math.floor(rand() * 90);
      s += `<path d="M${lx + 20},${ly}Q${(lx + cx) / 2},${ly - 20} ${cx + (rand() - .5) * 120},${cy + (rand() - .5) * 120}" stroke-width=".8"/>`;
      s += `<text x="${lx}" y="${ly + 5}" font-family="JetBrains Mono,monospace" font-size="14" fill="currentColor" stroke="none">${n}</text>`;
    });
    s += `<text x="${W - 16}" y="${H - 20}" font-family="JetBrains Mono,monospace" font-size="26" fill="currentColor" stroke="none" transform="rotate(-90 ${W - 16} ${H - 20})">FIG. ${o.fig}</text>`;
    el.innerHTML = s + "</svg>";
  }

  /* ---------- 9. Base64 filler ---------- */
  function b64(el) {
    const msg = el.dataset.msg || "Made With Retro OS";
    const len = +el.dataset.len || 460;
    let out = "", enc = btoa(unescape(encodeURIComponent(msg + " — ")));
    while (out.length < len) out += enc;
    el.textContent = out.slice(0, len);
  }

  /* ---------- init ---------- */
  function opts(el) { try { return el.dataset.opts ? JSON.parse(el.dataset.opts) : {}; } catch (e) { return {}; } }
  const MAP = { dither, life, cube, clock, boot, "term-race": termRace, punchcard, figure, b64 };
  function init(root) {
    (root || document).querySelectorAll("[data-ros]").forEach(el => {
      if (el.__ros) return; el.__ros = true;
      const fn = MAP[el.dataset.ros]; if (fn) fn(el, opts(el));
    });
  }
  let rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => document.querySelectorAll("[data-ros=dither]").forEach(el => dither(el, opts(el))), 200);
  });

  window.RetroOS = Object.assign({ init, rng }, MAP);
  if (document.readyState !== "loading") init(); else document.addEventListener("DOMContentLoaded", () => init());
})();
