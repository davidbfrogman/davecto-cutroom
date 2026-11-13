/* ==========================================================================
   RETRO OS CRITTERS — pixel-art wildlife for the background of a frame
   Optional add-on to retro-os.js (load it after). Same rules: one ink colour,
   chunky square pixels, stepped motion, seeded, pauses when off screen.

   <canvas class="critters" data-ros="critters" data-opts='{...}'></canvas>
   Put it after the dither/life canvases and before the content layer, so the
   critters move behind the cards' panels and show through the gaps.

   opts (all positions are 0–1 fractions of the canvas width/height):
     kind   "koi" | "bird" | "frog"
     cell   pixel size in px (default 5, same as the life texture)
     fps    step rate (default 12)
     color  ink colour (default #1E1E1E)
     seed   any number; varies spots, timing and flap phase
     t0     seconds to fast-forward, so a still frame catches the critter in view

     koi:   path  closed loop of [x, y] points, rounded off automatically
                  (default: a moat round the edge of the frame)
            count number of fish spread round the loop (default 1)
            speed cells per second (default 9); negative swims the other way
            len   body length in cells (default 24)
            size  scale of the whole fish (default 1)
     bird:  lanes [y, ...] a pass at each lane in turn (default [.035])
            flock birds per pass, in a loose V (default 3)
            speed cells per second (default 34)
            gap   seconds between passes (default 1.5)
     frog:  y     lily-pad line (default .97)
            x0,x1 hop range (default .06–.9)
            pads  number of lily pads (default 5)
            hop   leap height in cells (default 9)

   Add &still to the page URL and critters hold their t0 frame (for exports).
   canvas.__rewind() jumps the clock back to t0, so a card that replays gets
   its critter's big moment at the same point every time.

   Remove the <script> tag and nothing else changes: unknown data-ros names
   are ignored by retro-os.js.
   ========================================================================== */
(function () {
  "use strict";
  if (!window.RetroOS) return;
  const rng = window.RetroOS.rng;
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- pixel buffer ---------- */
  function buffer(W, H) {
    const px = new Uint8Array(W * H);
    const set = (x, y, v = 1) => { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < W && y < H) px[y * W + x] = v; };
    const disc = (cx, cy, r, v = 1) => {
      for (let y = Math.floor(cy - r); y <= cy + r; y++)
        for (let x = Math.floor(cx - r); x <= cx + r; x++)
          if ((x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= r * r) set(x, y, v);
    };
    const line = (x0, y0, x1, y1) => {
      const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) || 1;
      for (let i = 0; i <= n; i++) set(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
    };
    const ring = (cx, cy, rx, ry) => {            // dotted ellipse outline, every other pixel
      const n = Math.max(12, Math.round((rx + ry) * 3));
      for (let i = 0; i < n; i += 2) { const a = i / n * Math.PI * 2; set(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); }
    };
    const sprite = (rows, x, y, flip) => rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] === "X") set(x + (flip ? row.length - 1 - i : i), y + j);
    });
    return { px, set, disc, line, ring, sprite, clear: () => px.fill(0) };
  }

  /* ---------- path helpers (koi) ---------- */
  function chaikin(pts, n) {                     // corner-cutting: a closed polyline turns smooth
    for (let k = 0; k < n; k++) {
      const out = [];
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % pts.length];
        out.push([p[0] * .75 + q[0] * .25, p[1] * .75 + q[1] * .25], [p[0] * .25 + q[0] * .75, p[1] * .25 + q[1] * .75]);
      });
      pts = out;
    }
    return pts;
  }
  function densify(pts, max) {                   // short segments, so corner-cutting only rounds the corners
    const out = [];
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / max));
      for (let k = 0; k < n; k++) out.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]);
    });
    return out;
  }
  function track(pts) {                          // arc-length lookup on a closed polyline
    const seg = [], L = [0];
    pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; seg.push([p, q]); L.push(L[L.length - 1] + Math.hypot(q[0] - p[0], q[1] - p[1])); });
    const total = L[L.length - 1];
    return { total, at(s) {
      s = ((s % total) + total) % total;
      let lo = 0, hi = seg.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (L[m] <= s) lo = m; else hi = m - 1; }
      const [p, q] = seg[lo], f = (s - L[lo]) / ((L[lo + 1] - L[lo]) || 1);
      return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
    } };
  }

  /* ---------- KOI: a body that follows the loop, tail wagging, spots knocked out ---------- */
  function koi(b, o, W, H) {
    const pts = (o.path || [[.965, .5], [.965, .03], [.02, .03], [.02, .98], [.965, .98]]).map(([x, y]) => [x * W, y * H]);
    const T = track(chaikin(densify(pts, 6), 3)), n = o.count || 1, speed = o.speed || 9, z = o.size || 1, len = Math.round((o.len || 24) * z);
    const fish = Array.from({ length: n }, (_, i) => {
      const r = rng((o.seed || 1) * 31 + i);
      return { off: T.total * i / n + r() * 6, spots: [[.17 + r() * .17, r() < .5 ? -1 : 1], [.46 + r() * .2, r() < .5 ? -1 : 1], [.7 + r() * .12, 0]] };
    });
    const ripples = [];
    let nextRipple = 2;
    const radius = k => { const u = k / len; return z * (u < .15 ? 2.4 + u / .15 * 1.3 : 3.7 - (u - .15) / .85 * 2.5); };
    return t => {
      b.clear();
      fish.forEach((f, fi) => {
        const head = f.off + speed * t;
        const P = [];
        for (let k = 0; k <= len; k++) P.push(T.at(head - Math.sign(speed) * k * 1.1));
        const N = P.map((p, k) => {                         // unit normal at each segment
          const a = P[Math.max(0, k - 1)], c = P[Math.min(len, k + 1)];
          const dx = a[0] - c[0], dy = a[1] - c[1], d = Math.hypot(dx, dy) || 1;
          return [-dy / d, dx / d];
        });
        const wag = k => Math.sin(k * .38 - t * 7 + fi) * 1.6 * (k / len) ** 1.5;
        const Q = P.map((p, k) => [p[0] + N[k][0] * wag(k), p[1] + N[k][1] * wag(k)]);
        Q.forEach((q, k) => b.disc(q[0], q[1], radius(k)));
        // pectoral fins
        [-1, 1].forEach(s => { const q = Q[5], nn = N[5]; b.line(q[0], q[1], q[0] + nn[0] * s * 5.5 * z - (Q[3][0] - Q[7][0]) * .3, q[1] + nn[1] * s * 5.5 * z - (Q[3][1] - Q[7][1]) * .3); });
        // tail fin: two splayed strokes that flutter
        const tl = Q[len], tp = Q[len - 3], dx = tl[0] - tp[0], dy = tl[1] - tp[1], d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d, fl = Math.sin(t * 7 + fi) * .25;
        [-1, 1].forEach(s => [.22, .36, .5, .64].forEach((a0, j) => {
          const a = s * a0 + fl, c = Math.cos(a), sn = Math.sin(a), l = z * (4.5 + j * 1.1);
          b.line(tl[0], tl[1], tl[0] + (ux * c - uy * sn) * l, tl[1] + (ux * sn + uy * c) * l);
        }));
        // markings and eyes
        f.spots.forEach(([u, side]) => { const k = Math.round(u * len), q = Q[k], nn = N[k]; b.disc(q[0] + nn[0] * side * 1.4 * z, q[1] + nn[1] * side * 1.4 * z, 1.45 * z, 0); });
        [-1, 1].forEach(s => b.set(Q[1][0] + N[1][0] * s * 1.7 * z, Q[1][1] + N[1][1] * s * 1.7 * z, 0));
        if (fi === 0 && t > nextRipple) { ripples.push([Q[0][0], Q[0][1], t]); nextRipple = t + 3.2; }
      });
      for (let i = ripples.length - 1; i >= 0; i--) {
        const [x, y, t1] = ripples[i], age = t - t1;
        if (age > 1.6) { ripples.splice(i, 1); continue; }
        const r = 3 + age * 7; b.ring(x, y, r, r * .6);
      }
    };
  }

  /* ---------- BIRD: a small flock crossing a lane, wings flapping ---------- */
  const WINGS = [
    ["XX.............XX", ".XX...........XX.", "..XXX.......XXX..", "...XXXX...XXXX...", ".....XXX.XXX.....", "......XXXXX......", ".......XXX.......", "................."],
    [".................", ".................", "XXXXX.......XXXXX", "..XXXXX.X.XXXXX..", "......XXXXX......", ".......XXX.......", ".................", "................."],
    [".................", ".................", "......XXXXX......", "....XXXXXXXXX....", "..XXXX.XXX.XXXX..", ".XXX...XXX...XXX.", "XX.............XX", "................."],
  ];
  const FLAP = [0, 1, 2, 1];
  function bird(b, o, W, H) {
    const lanes = o.lanes || [.035], flock = o.flock || 3, speed = o.speed || 34, gap = o.gap || 1.5;
    const span = W + 60, pass = span / speed + gap, r = rng(o.seed || 2);
    const V = Array.from({ length: flock }, (_, i) => [-(i ? Math.ceil(i / 2) * 22 : 0), i ? (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 4 : 0, Math.floor(r() * 4)]);
    return t => {
      b.clear();
      const p = Math.floor(t / pass), u = t - p * pass, ltr = p % 2 === 0;
      const y0 = lanes[p % lanes.length] * H;
      const x0 = -30 + u * speed;
      V.forEach(([dx, dy, ph], i) => {
        const x = x0 + dx, y = y0 + dy + Math.round(Math.sin(t * 2 + i) * 1.5) - 2;
        const f = WINGS[FLAP[(Math.floor(t * 9) + ph) % 4]];
        b.sprite(f, ltr ? x : W - x - 17, y);
      });
    };
  }

  /* ---------- FROG: sits on a lily pad, leaps to the next, turns at the end ---------- */
  const FROG_SIT = [
    "..........XXX...",
    ".........XX.XX..",
    "......XXXXXXXXXX",
    "....XXXXXXXXXXXX",
    "..XXXXXXXXXXXXX.",
    ".XXXXXXXXXXXXX..",
    "XXXXX.XXXXXX....",
    "XXXX..XXX.XX....",
    ".XXXXXX..XXXX...",
  ];
  const FROG_LEAP = [
    "............XXX...",
    "...........XX.XX..",
    "......XXXXXXXXXXXX",
    "..XXXXXXXXXXXXXXX.",
    "XXXXXXXXXXXXXXX...",
    "XX....XXX..XX.....",
    "X...........XX....",
  ];
  function frog(b, o, W, H) {
    const y = (o.y ?? .97) * H, x0 = (o.x0 ?? .06) * W, x1 = (o.x1 ?? .9) * W, n = o.pads || 5;
    const pads = Array.from({ length: n }, (_, i) => x0 + (x1 - x0) * i / (n - 1));
    const SIT = 1.1, HOP = .6, step = SIT + HOP, hops = (n - 1) * 2;
    const at = t => {                                      // pad index from, to, and hop progress
      const k = Math.floor(t / step) % hops, u = t - Math.floor(t / step) * step;
      const from = k < n - 1 ? k : hops - k, to = k < n - 1 ? k + 1 : hops - k - 1;
      return [from, to, u < SIT ? 0 : (u - SIT) / HOP];
    };
    return t => {
      b.clear();
      pads.forEach(px => { b.ring(px, y + 1, 7, 2); b.set(px + 6, y + 1, 0); });
      const [from, to, f] = at(t), flip = to < from;
      const x = pads[from] + (pads[to] - pads[from]) * f, lift = f ? Math.sin(f * Math.PI) * (o.hop || 9) : 0;
      const s = f ? FROG_LEAP : FROG_SIT, w = s[0].length;
      b.sprite(s, x - w / 2, y - s.length - lift, flip);
      if (!f) { const since = t % step; if (since < .5 && t > step) { const r = 7 + since * 16; b.ring(pads[from], y + 1, r, r * .3); } }
    };
  }

  /* ---------- canvas driver ---------- */
  const KINDS = { koi, bird, frog };
  function critters(canvas, o) {
    o = Object.assign({ kind: "koi", cell: 5, fps: 12, color: "#1E1E1E", seed: 1, t0: 0 }, o);
    if (!KINDS[o.kind]) return;                      // e.g. a starships kind without retro-os-starships.js
    const w = canvas.offsetWidth || 300, h = canvas.offsetHeight || 150;
    const W = Math.ceil(w / o.cell), H = Math.ceil(h / o.cell);
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d"), b = buffer(W, H), draw = KINDS[o.kind](b, o, W, H);
    const frame = t => {
      draw(t);
      ctx.clearRect(0, 0, W, H); ctx.fillStyle = o.color;
      for (let i = 0; i < b.px.length; i++) if (b.px[i]) ctx.fillRect(i % W, (i / W) | 0, 1, 1);
    };
    let tick = 0;
    frame(o.t0);
    canvas.__rewind = () => { tick = 0; frame(o.t0); };   // restart from t0, e.g. when a reel card replays
    if (reduced || /[?&]still\b/.test(location.search)) return;
    let timer = null;
    const go = vis => {
      if (vis && !timer) timer = setInterval(() => frame(o.t0 + ++tick / o.fps), 1000 / o.fps);
      if (!vis && timer) { clearInterval(timer); timer = null; }
    };
    if ("IntersectionObserver" in window) new IntersectionObserver(es => es.forEach(e => go(e.isIntersecting))).observe(canvas);
    else go(true);
  }

  function init(root) {
    (root || document).querySelectorAll('[data-ros="critters"]').forEach(el => {
      if (el.__critters) return; el.__critters = true;
      let o = {}; try { o = el.dataset.opts ? JSON.parse(el.dataset.opts) : {}; } catch (e) {}
      critters(el, o);
    });
  }
  window.RetroOS.critters = critters;
  window.RetroOSCritters = { init, KINDS, buffer };   // retro/: buffer exposed so kit/ships.js can draw frames on the timeline
  if (document.readyState !== "loading") init(); else document.addEventListener("DOMContentLoaded", () => init());
})();
