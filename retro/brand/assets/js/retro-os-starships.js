/* ==========================================================================
   RETRO OS STARSHIPS — a pixel-art space battle for the background of a frame
   Add-on to retro-os-critters.js (load it after). It registers more kinds for
   the same canvas, with the same rules: one ink colour, chunky square pixels,
   stepped motion, seeded, pauses when off screen, &still holds the t0 frame.

   <canvas class="critters" data-ros="critters" data-opts='{"kind":"dogfight", ...}'></canvas>

   opts (all positions are 0–1 fractions of the canvas width/height):
     dogfight   an X-wing jinking across a lane, two TIE fighters on its tail firing
                lanes [y, ...] (default [.33]), speed (default 30), gap s (default 1.2)
     patrol     a staggered line of small TIE fighters crossing a lane
                lanes (default [.05]), flock (default 3), speed (default 26), gap (default 1.5)
     falcon     the Millennium Falcon cruises in, the stars stretch, it jumps to lightspeed
                y (default .33), x1 jump point (default .8), speed (default 22)
     ywing      a pair of Y-wings crossing a lane, engines flickering, ion cannons firing
                lanes (default [.32]), count (default 2), speed (default 24), gap (default 1.2)
     advanced   Vader's TIE Advanced: a speck that roars up to full size, screams, peels away
                x,y centre (default .74, .335), every s (default 4.2)
     crawler    a Jawa sandcrawler grinding across the dunes, treads rolling, smoke puffing
                y ground line (default .39), speed (default 8)
                droid x (optional): an R2 unit waits on the dunes there and gets beamed aboard
     deathstar  a turning Death Star with a TIE in orbit; fires its superlaser now and then
                x,y centre (default .82, .33), r radius in cells (default 13), every s (default 6)
     destroyer  a Star Destroyer chasing a blockade runner, turbolasers landing on its engines
                lanes (default [.33]), speed (default 24), gap (default 1.2)
     arrival    a Star Destroyer drops out of lightspeed: streaks rush in, the hull flashes in
                x,y centre (default .74, .335), at s into each cycle (default 1), every s (default 5)
     asteroids  a TIE threads an asteroid field and meets a big one head on
                x,y impact point (default .7, .335), at s into each cycle (default 3.2), every s (default 5)
     atat       an AT-AT plods left on the snow; a snowspeeder makes a run, both sides firing
                x start (default .8), y ground line (default .4), every s between runs (default 4.5)

   For a reel card the big moment should land in its first two seconds: pick t0 so it does,
   and call canvas.__rewind() each time the card plays (see retro-os-critters.js).

   Remove the <script> tag and nothing else changes: canvases asking for these
   kinds are skipped.
   ========================================================================== */
(function () {
  "use strict";
  const C = window.RetroOSCritters;
  if (!C || !window.RetroOS) return;
  const rng = window.RetroOS.rng;

  /* ---------- drawing helpers on top of the critters pixel buffer ---------- */
  // rows of "X" (ink) and "o" (knock out); "." leaves what's underneath
  const draw = (b, rows, x, y, flip) => rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (c !== ".") b.set(Math.round(x) + (flip ? row.length - 1 - i : i), Math.round(y) + j, c === "X" ? 1 : 0);
    }
  });
  const rect = (b, x0, y0, x1, y1, v = 1) => {
    for (let y = Math.round(y0); y <= Math.round(y1); y++) for (let x = Math.round(x0); x <= Math.round(x1); x++) b.set(x, y, v);
  };
  const knock = (b, x0, y0, x1, y1) => {             // a 1px knocked-out line
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) || 1;
    for (let i = 0; i <= n; i++) b.set(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, 0);
  };
  const pass = (t, len) => { const p = Math.floor(t / len); return [p, t - p * len, p % 2 === 0]; };

  /* ---------- sprites ---------- */
  const XWING = [                                    // side on, nose right, S-foils open
    "XXXXXXXXXXXXXXXXXX..........",
    ".XX.........................",
    "..XX........................",
    "...XX.......................",
    "XXXXXX......XXXX............",
    "XXXXXXXXXXXXXXXXXXXXXXXX....",
    "XXXoXXXXXXXXXXXXXXXXXXXXXXXX",
    "XXXXXXXXXXXXXXXXXXXXXXXX....",
    "XXXXXX......................",
    "...XX.......................",
    "..XX........................",
    ".XX.........................",
    "XXXXXXXXXXXXXXXXXX..........",
  ];
  const TIE = [
    "X...........X",
    "XX.........XX",
    "XX.........XX",
    "XX...XXX...XX",
    "XX..XXXXX..XX",
    "XXXXXXoXXXXXX",
    "XX..XXXXX..XX",
    "XX...XXX...XX",
    "XX.........XX",
    "XX.........XX",
    "X...........X",
  ];
  const TIE_S = [
    "X.......X",
    "XX.....XX",
    "XX.XXX.XX",
    "XXXXoXXXX",
    "XX.XXX.XX",
    "XX.....XX",
    "X.......X",
  ];

  /* ---------- DOGFIGHT: X-wing jinks, two TIEs chase and fire ---------- */
  function dogfight(b, o, W, H) {
    const lanes = o.lanes || [.33], speed = o.speed || 30, gap = o.gap ?? 1.2;
    const len = (W + 130) / speed + gap, bolt = speed + 45;
    const jink = u => Math.round(Math.sin(u * 2.3) * 4);
    const TIES = [[34, 1, .45], [60, -7, .9]];        // [cells behind, y offset, lag s]
    return t => {
      b.clear();
      const [p, u, ltr] = pass(t, len), y0 = Math.round(lanes[p % lanes.length] * H) - 6;
      const X = (x, w) => ltr ? x : W - x - w;        // mirror right-to-left passes
      const lead = s => -30 + s * speed;
      const xx = lead(u), xy = y0 + jink(u);
      draw(b, XWING, X(xx, 28), xy, !ltr);
      if (Math.floor(t * 12) % 2) [5, 7].forEach(r => b.set(X(xx - 2, 1), xy + r));   // engine flicker
      TIES.forEach(([d, dy, lag], i) => {
        const ty = s => y0 + 1 + dy + jink(s - lag);
        draw(b, TIE, X(lead(u) - d, 13), ty(u));
        const last = Math.floor((u - i * .25) / .5);   // shots every .5s, staggered between the two
        for (let n = last; n > last - 6 && n >= 0; n--) {
          const ts = n * .5 + i * .25;
          if (ts < .4) continue;
          const bx = lead(ts) - d + 13 + (u - ts) * bolt, by = ty(ts) + 5 + (n % 2 ? -5 : 5);
          for (let q = 0; q < 4; q++) b.set(X(bx + q, 1), by);
        }
      });
    };
  }

  /* ---------- PATROL: a V of small TIEs ---------- */
  function patrol(b, o, W, H) {
    const lanes = o.lanes || [.05], flock = o.flock || 3, speed = o.speed || 26, gap = o.gap ?? 1.5;
    const len = (W + 60) / speed + gap;
    const V = Array.from({ length: flock }, (_, i) => [-i * 17, i % 2 ? -1 : 1]);        // line abreast, staggered a row
    return t => {
      b.clear();
      const [p, u, ltr] = pass(t, len), y0 = Math.round(lanes[p % lanes.length] * H) - 3;
      V.forEach(([dx, dy], i) => {
        const x = -12 + u * speed + dx, y = y0 + dy + Math.round(Math.sin(t * 3 + i * 2));
        draw(b, TIE_S, ltr ? x : W - x - 9, y);
      });
    };
  }

  /* ---------- FALCON: cruise in, stars stretch, jump to lightspeed ---------- */
  function ship(b, cx, cy) {                          // top down, nose right
    cx = Math.round(cx); cy = Math.round(cy);
    b.disc(cx, cy, 9);
    rect(b, cx + 3, cy - 7, cx + 16, cy - 2); rect(b, cx + 3, cy + 2, cx + 16, cy + 7);   // mandibles
    b.set(cx + 16, cy - 7, 0); b.set(cx + 16, cy + 7, 0);
    rect(b, cx + 6, cy - 1, cx + 17, cy + 1, 0);      // the slot between them
    rect(b, cx + 3, cy + 8, cx + 10, cy + 10); b.disc(cx + 11.5, cy + 10.5, 2.2); b.set(cx + 12, cy + 10, 0);   // cockpit, starboard
    for (let a = 0; a < 24; a += 2) { const r = a / 24 * Math.PI * 2; b.set(cx + .5 + Math.cos(r) * 4.5, cy + .5 + Math.sin(r) * 4.5, 0); }
    for (let a = 140; a <= 220; a += 8) { const r = a * Math.PI / 180; b.set(cx + .5 + Math.cos(r) * 7.5, cy + .5 + Math.sin(r) * 7.5, 0); }
    b.disc(cx - 1.5, cy - 3.5, 1.3, 0);               // dish
  }
  function falcon(b, o, W, H) {
    const cy = Math.round((o.y ?? .33) * H), x1 = Math.round((o.x1 ?? .8) * W), speed = o.speed || 22;
    const r = rng(o.seed || 3), S = Array.from({ length: 7 }, (_, i) => [Math.round(-8 + i * 2.7), .55 + r() * .7]);
    const cruise = (x1 + 30) / speed, CH = .7, JUMP = .3, AFTER = .7, cycle = cruise + CH + JUMP + AFTER + 1;
    return t => {
      b.clear();
      const u = t % cycle;
      if (u < cruise) {
        const cx = Math.round(-30 + u * speed), ph = Math.floor(t * 12) % 2;
        ship(b, cx, cy);
        [-4, 0, 4].forEach(dy => { for (let k = ph; k < 10; k += 2) b.set(cx - 11 - k * 1.5, cy + dy); });   // engine wake
      } else if (u < cruise + CH) {                   // stars stretch out behind, the hull shudders
        const f = (u - cruise) / CH, cx = x1 + Math.floor(t * 20) % 2;
        ship(b, cx, cy);
        S.forEach(([dy, l]) => b.line(cx - 11 - Math.round(f * 46 * l), cy + dy, cx - 11, cy + dy));
      } else if (u < cruise + CH + JUMP) {            // gone: the ship stretches to a streak
        const f = (u - cruise - CH) / JUMP, head = x1 + 16 + f * (W - x1 + 40);
        S.forEach(([dy]) => b.line(x1 - 30 + f * 40, cy + Math.round(dy / 2), head, cy + Math.round(dy / 2)));
      } else if (u < cruise + CH + JUMP + AFTER) {     // a ring where it was
        const rr = 3 + (u - cruise - CH - JUMP) / AFTER * 14;
        b.ring(x1, cy, rr, rr * .7);
      }
    };
  }

  /* ---------- CRAWLER: the Jawas' sandcrawler, nose left ---------- */
  function crawlerBody(b, x, y, ph) {
    x = Math.round(x);
    for (let r = 0; r <= 13; r++) rect(b, x + Math.round(12 - 12 * r / 13), y + r, x + Math.round(40 + 3 * r / 13), y + r);
    rect(b, x, y + 14, x + 44, y + 15);                // chassis
    rect(b, x + 33, y - 4, x + 35, y - 1);             // smokestack
    for (let k = 16; k <= 36; k += 4) rect(b, x + k, y + 3, x + k + 1, y + 4, 0);   // windows
    knock(b, x + 4, y + 13, x + 14, y + 1);            // the big front ramp
    knock(b, x + 15, y + 9, x + 41, y + 9);            // panel seam
    [[1, 19], [23, 44]].forEach(([a, z]) => {          // two tread units
      rect(b, x + a + 1, y + 16, x + z - 1, y + 21); rect(b, x + a, y + 17, x + z, y + 20);
      for (let k = a + 3; k <= z - 3; k += 5) b.disc(x + k + .5, y + 19, 1.3, 0);
      for (let k = a + 1; k < z; k++) {
        if ((((k + ph) % 3) + 3) % 3 === 0) b.set(x + k, y + 16, 0);
        if ((((k - ph) % 3) + 3) % 3 === 0) b.set(x + k, y + 21, 0);
      }
    });
  }
  const R2 = [
    ".XXX.",
    "XXoXX",
    "XXXXX",
    "XoXoX",
    "XXXXX",
    "X.X.X",
    "X...X",
  ];
  function crawler(b, o, W, H) {
    const ground = Math.round((o.y ?? .39) * H), speed = o.speed || 8, loop = W + 60, y = ground - 22;
    const pos = s => W + 5 - ((s * speed) % loop);
    const dx = o.droid != null ? Math.round(o.droid * W) : null, NEAR = 22, IN = 8;   // beam on at NEAR cells, aboard at IN
    return t => {
      b.clear();
      for (let x = Math.round(W * .45); x < W; x += 3) b.set(x + (Math.floor(x / 9) % 2), ground + 1);   // dunes
      const x = pos(t);
      if (dx != null && x > dx + IN) {                  // the droid: waiting, then pulled up the ramp
        const f = Math.max(0, (dx + NEAR - x) / (NEAR - IN));
        const rx = dx + (x + 6 - dx) * f, ry = ground - 6 - f * 10;
        if (f > 0) for (let k = 0; k <= 10; k += 2) b.set(rx + 5 + (x + 6 - rx - 5) * k / 10, ry + 3 + (y + 10 - ry - 3) * k / 10);   // tractor beam
        draw(b, R2, rx, ry + (f ? 0 : Math.floor(t * 4) % 2 ? 0 : -1));
        if (!f && Math.floor(t * 6) % 3 === 0) b.set(rx + 2, ry - 2);   // a beep
      }
      crawlerBody(b, x, y, Math.floor(t * 10));
      const last = Math.floor(t / .9);                  // smoke: one puff every .9s, drifting back and up
      for (let n = last; n > last - 3 && n >= 0; n--) {
        const a = t - n * .9, sx = pos(n * .9) + 34;
        if (Math.abs(sx - x - 34) > 40) continue;       // skip puffs left behind across the wrap
        const rr = 1 + a * 1.4; b.ring(sx + a * 4, y - 6 - a * 4, rr, rr);
      }
      if (Math.floor(t * 8) % 2) { b.set(x + 47, ground - 1); b.set(x + 49, ground); } else b.set(x + 48, ground - 2);   // dust
    };
  }

  /* ---------- DEATH STAR: turns, a TIE orbits, the superlaser fires ---------- */
  function deathstar(b, o, W, H) {
    const cx = Math.round((o.x ?? .82) * W), cy = Math.round((o.y ?? .33) * H), R = o.r || 13, every = o.every || 6;
    const r0 = rng(o.seed || 4), stars = Array.from({ length: 12 }, () => [cx + (r0() - .5) * R * 7, cy + (r0() - .5) * R * 2.6, r0() * 6]);
    const dx = cx - R * .4, dy = cy - R * .38, dr = R * .3, F = [dx - 6, dy + 2];
    return t => {
      b.clear();
      stars.forEach(([x, y, ph]) => { if (Math.hypot(x - cx, y - cy) > R + 3 && Math.sin(t * 2 + ph * 3) > -.4) b.set(x, y); });
      b.disc(cx, cy, R);
      for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++)    // the night side, half-toned
        if ((x - cx) * .7 + (y - cy) * .45 > R * .3 && (x + y) % 2) b.set(x, y, 0);
      const hw = Math.floor(R - .5);
      for (let x = cx - hw; x <= cx + hw; x++) b.set(x, cy, 0);                          // equatorial trench
      [-.62, -.3, .32, .64].forEach(s => {                                                // panel lines turning
        const w = R * Math.sqrt(1 - s * s);
        for (let k = 0; k < 12; k++) {
          const lon = k * Math.PI / 6 + t * .35;
          if (Math.cos(lon) > .2) { const x = cx + w * Math.sin(lon); b.set(x, cy + R * s, 0); b.set(x + 1, cy + R * s, 0); }
        }
      });
      for (let a = 0; a < 28; a++) { const r = a / 28 * Math.PI * 2; b.set(dx + Math.cos(r) * dr, dy + Math.sin(r) * dr, 0); }   // dish
      b.set(dx, dy, 0);
      const ph = t % every;
      if (ph > every - 2 && ph < every - 1.4) {           // six tributary beams meet in front of the dish
        for (let k = 0; k < 6; k++) {
          const a = k / 6 * Math.PI * 2 + .3, sx = dx + Math.cos(a) * dr, sy = dy + Math.sin(a) * dr, n = 10;
          for (let i = 0; i <= n; i += 2) b.set(sx + (F[0] - sx) * i / n, sy + (F[1] - sy) * i / n);
        }
        rect(b, F[0] - 1, F[1] - 1, F[0], F[1]);
      } else if (ph >= every - 1.4 && ph < every - .5) {   // the main beam
        const f = Math.min(1, (ph - every + 1.4) / .25), ex = F[0] - 150 * f, ey = F[1] + 28 * f;
        b.line(F[0], F[1], ex, ey); b.line(F[0], F[1] + 1, ex, ey + 1);
        rect(b, F[0] - 1, F[1] - 1, F[0] + 1, F[1] + 1);
      }
      const a = t * .9, ox = cx + Math.cos(a) * R * 1.9, oy = cy + Math.sin(a) * R * .45 - 1;   // TIE in orbit
      if (!(Math.sin(a) < 0 && Math.abs(ox - cx) < R + 4)) { rect(b, ox - 5, oy - 4, ox + 5, oy + 4, 0); draw(b, TIE_S, ox - 4, oy - 3); }
    };
  }

  /* ---------- Y-WING: top down, nose right, two nacelles behind a long nose ---------- */
  function yship(b, x, y, flip, flame) {
    const X = i => flip ? x + 37 - i : x + i;          // mirror for right-to-left
    const R = (x0, y0, x1, y1, v = 1) => rect(b, Math.min(X(x0), X(x1)), y + y0, Math.max(X(x0), X(x1)), y + y1, v);
    R(2, 0, 20, 2); R(2, 8, 20, 2 + 8);                 // nacelles
    b.set(X(21), y + 1); b.set(X(21), y + 9);           // their rounded fronts
    R(0, 0, 1, 0); R(0, 2, 1, 2); R(0, 8, 1, 8); R(0, 10, 1, 10);   // nozzle lips
    R(15, 2, 17, 8);                                   // crossbar
    R(17, 4, 33, 6);                                   // fuselage
    R(26, 3, 31, 7); R(34, 5, 37, 5);                  // cockpit, then the nose and its turret
    for (let i = 19; i <= 25; i += 2) { b.set(X(i), y + 4, 0); b.set(X(i), y + 6, 0); }   // the exposed skeleton
    b.set(X(29), y + 5, 0);                            // canopy
    for (let i = 6; i <= 18; i += 4) { b.set(X(i), y + 1, 0); b.set(X(i), y + 9, 0); }   // nacelle panel seams
    if (flame) [1, 9].forEach(r => { b.set(X(-1), y + r); b.set(X(-3), y + r); });
  }
  function ywing(b, o, W, H) {
    const lanes = o.lanes || [.32], count = o.count || 2, speed = o.speed || 24, gap = o.gap ?? 1.2;
    const len = (W + 50 + 32 * count) / speed + gap, bolt = speed + 40;
    return t => {
      b.clear();
      const [p, u, ltr] = pass(t, len), y0 = Math.round(lanes[p % lanes.length] * H) - 5;
      const mx = (x, w) => ltr ? x : W - x - w;
      for (let k = 0; k < count; k++) {
        const x = -40 + u * speed - k * 32, y = y0 + k * 11 + Math.round(Math.sin(t * 2.4 + k * 1.7));
        yship(b, mx(x, 38), y, !ltr, Math.floor(t * 12 + k) % 2);
        const last = Math.floor((u - k * .3) / .8);      // a pair of ion bolts from the nose every .8s
        for (let n = last; n > last - 3 && n >= 0; n--) {
          const ts = n * .8 + k * .3, bx = -40 + ts * speed - k * 32 + 39 + (u - ts) * bolt;
          if (ts < .5) continue;
          [4, 6].forEach(r => { b.set(mx(bx, 1), y + r); b.set(mx(bx + 1, 1), y + r); b.set(mx(bx + 2, 1), y + r); });
        }
      }
    };
  }

  /* ---------- ADVANCED: Vader's TIE Advanced, bent wings, roars up to the glass ---------- */
  function advancedShip(b, cx, cy) {
    cx = Math.round(cx); cy = Math.round(cy);
    [-1, 1].forEach(s => {                             // bent wings, the bend pointing out: < o >
      for (let w = 0; w < 3; w++) {
        b.line(cx + s * (10 + w), cy - 13, cx + s * (17 + w), cy);
        b.line(cx + s * (17 + w), cy, cx + s * (10 + w), cy + 13);
      }
      for (let r = -9; r <= 9; r += 3) b.set(cx + s * (12 + 7 * (1 - Math.abs(r) / 13)), cy + r, 0);   // panel ribs
      rect(b, Math.min(cx + s * 5, cx + s * 14), cy - 1, Math.max(cx + s * 5, cx + s * 14), cy + 1);  // strut
      b.set(cx + s * 9, cy, 0);
    });
    b.disc(cx + .5, cy + .5, 6.2);                     // the pod
    b.disc(cx + .5, cy + .5, 3.6, 0);                  // round window...
    b.line(cx - 3, cy, cx + 3, cy); b.line(cx, cy - 3, cx, cy + 3);   // ...with its spokes
    b.line(cx - 2, cy - 2, cx + 2, cy + 2); b.line(cx - 2, cy + 2, cx + 2, cy - 2);
    b.disc(cx + .5, cy + .5, 1.2);
  }
  function advanced(b, o, W, H) {
    const cx = Math.round((o.x ?? .74) * W), cy = Math.round((o.y ?? .335) * H), every = o.every || 4.2;
    return t => {
      b.clear();
      const u = t % every, bob = Math.round(Math.sin(t * 3));
      if (u < .3) { b.set(cx, cy); b.set(cx + 1, cy); }                    // a speck
      else if (u < .6) draw(b, TIE_S, cx - 4, cy - 3);                      // getting closer
      else if (u < .9) draw(b, TIE, cx - 6, cy - 5);
      else if (u < 3.2) {                                                   // full size, screaming
        advancedShip(b, cx, cy + bob);
        const a = (u - .9) % .55, rr = 22 + a * 40;
        [-1, 1].forEach(s => { for (let k = -5; k <= 5; k++) { const ang = k * .13; b.set(cx + s * Math.cos(ang) * rr, cy + Math.sin(ang) * rr * .9); } });
      } else if (u < 3.6) {                                                 // peels off up and right
        const f = (u - 3.2) / .4; advancedShip(b, cx + f * 90, cy - f * 14);
      }
    };
  }

  /* ---------- STAR DESTROYER: top down, nose right, a 46-cell dagger ---------- */
  function destroyerShip(b, x, y, flame) {             // x is the stern, y the centre line
    x = Math.round(x); y = Math.round(y);
    const L = 46, h = 11;
    for (let i = 0; i <= L; i++) { const hh = Math.round(h * (1 - i / L)); rect(b, x + i, y - hh, x + i, y + hh); }
    knock(b, x + 16, y, x + L - 3, y);                 // the spine
    knock(b, x + 3, y - h + 3, x + L - 14, y - 1); knock(b, x + 3, y + h - 3, x + L - 14, y + 1);   // hull plating
    rect(b, x + 3, y - 5, x + 14, y + 5, 0); rect(b, x + 5, y - 3, x + 12, y + 3);   // superstructure...
    rect(b, x + 6, y - 1, x + 8, y + 1, 0);            // ...and its bridge tower
    if (flame) [-6, 0, 6].forEach(r => { b.set(x - 1, y + r); b.set(x - 3, y + r); });
  }
  function runnerShip(b, x, y, flame) {                // the blockade runner, 26 long, stern at x
    x = Math.round(x); y = Math.round(y);
    rect(b, x, y - 4, x + 5, y + 4);                   // engine block
    [-3, -1, 1, 3].forEach(r => b.set(x, y + r, 0));
    rect(b, x + 6, y - 1, x + 19, y + 1);              // the long corridor
    rect(b, x + 20, y - 3, x + 25, y + 3);             // hammerhead
    b.set(x + 25, y - 3, 0); b.set(x + 25, y + 3, 0); b.set(x + 22, y, 0);
    if (flame) [-3, -1, 1, 3].forEach(r => b.set(x - 1, y + r));
  }

  /* ---------- DESTROYER: the opening shot, a runner with a Star Destroyer on its tail ---------- */
  function destroyer(b, o, W, H) {
    const lanes = o.lanes || [.33], speed = o.speed || 24, gap = o.gap ?? 1.2, D = 34, bolt = speed + 50;
    const len = (W + 110) / speed + gap, fly = D / (bolt - speed);   // a bolt lands this long after it fires
    return t => {
      b.clear();
      const p = Math.floor(t / len), u = t - p * len, y0 = Math.round(lanes[p % lanes.length] * H);
      const rx = s => -26 + s * speed, nose = s => rx(s) - D, fl = Math.floor(t * 12) % 2;
      const last = Math.floor(u / .5);                 // turbolasers every .5s, alternating port and starboard
      let hit = false;
      for (let n = last; n > last - 3 && n >= 0; n--) {
        const ts = n * .5, by = y0 + (n % 2 ? -3 : 3);
        if (nose(ts) < -4) continue;
        if (u < ts + fly) for (let q = 0; q < 3; q++) b.set(nose(ts) + (u - ts) * bolt + q, by);
        else if (u < ts + fly + .15) hit = true;
      }
      const jy = hit ? 1 : 0;                          // the runner shudders when one lands
      runnerShip(b, rx(u), y0 + jy, fl);
      if (hit) { const sx = rx(u) - 2; b.set(sx, y0 - 2); b.set(sx - 1, y0); b.set(sx, y0 + 2); b.set(sx - 2, y0 - 4); b.set(sx - 2, y0 + 4); }
      destroyerShip(b, nose(u) - 46, y0, fl);
    };
  }

  /* ---------- ARRIVAL: a Star Destroyer drops out of lightspeed ---------- */
  function arrival(b, o, W, H) {
    const cx = Math.round((o.x ?? .74) * W), cy = Math.round((o.y ?? .335) * H), every = o.every || 5, at = o.at ?? 1;
    const r = rng(o.seed || 6), S = Array.from({ length: 9 }, (_, i) => [Math.round(-10 + i * 2.5), .5 + r() * .8]);
    const nose = cx + 23;
    return t => {
      b.clear();
      const u = t % every;
      if (u < at) {                                    // streaks rush in and shrink onto the arrival point
        const f = u / at, head = -10 + f * (nose + 10);
        S.forEach(([dy, l]) => b.line(head - (1 - f) * 70 * l - 3, cy + dy, head, cy + dy));
      } else {
        const a = u - at, shake = a < .25 ? Math.floor(t * 20) % 2 : 0;
        destroyerShip(b, cx - 23 + Math.floor(a * .8) + shake, cy, Math.floor(t * 12) % 2);
        if (a < .5) { const rr = 6 + a * 60; b.ring(cx, cy, rr, rr * .55); }   // the flash rings out
      }
    };
  }

  /* ---------- ASTEROIDS: a TIE in the field, and the rock it doesn't see ---------- */
  function rock(b, x, y, r, seed, t) {
    b.disc(x, y, r);
    if (r > 2) [[.45, .3], [.4, .2]].forEach(([d, s], k) => {        // craters tumble round the face
      const a = seed * 2 + t * .8 + k * 2.6;
      if (Math.cos(a) > -.2) b.disc(x + Math.cos(a) * r * d, y + Math.sin(a) * r * d, Math.max(1, r * s), 0);
    });
    for (let k = 0; k < 6; k++) { const a = seed + k * 1.05; b.set(x + Math.cos(a) * r, y + Math.sin(a) * r, 0); }   // a ragged rim
  }
  function asteroids(b, o, W, H) {
    const px = Math.round((o.x ?? .7) * W), py = Math.round((o.y ?? .335) * H), every = o.every || 5, at = o.at ?? 3.2;
    const r = rng(o.seed || 8), span = W + 40;
    const R = Array.from({ length: 6 }, () => [r() * span, py + (r() - .5) * 46, 2 + Math.round(r() * 4), 4 + r() * 8, r() * 6]);
    const tv = (px + 9) / at;                          // so the TIE's centre reaches the impact point at `at`
    return t => {
      b.clear();
      const u = t % every;
      R.forEach(([x0, y, rr, v, ph]) => rock(b, ((x0 - t * v) % span + span) % span - 20, y + Math.round(Math.sin(t + ph)), rr, ph, t));
      rock(b, px + 8 + (at - u) * 10, py - (at - u) * 5, 7, 1, t);   // the big one, tumbling in on a slant
      if (u < at) draw(b, TIE, -15 + u * tv, py - 5);
      else if (u < at + .9) {                          // flash, a ring and flying debris
        const f = (u - at) / .9;
        if (f < .2) b.disc(px, py, 7);
        b.ring(px, py, 4 + f * 26, 4 + f * 20);
        for (let k = 0; k < 14; k++) {                 // debris: short streaks thrown outward
          const a = k * .45 + .2, d = 4 + f * (18 + (k % 3) * 8), ex = px + Math.cos(a) * d, ey = py + Math.sin(a) * d * .8;
          b.set(ex, ey); b.set(ex - Math.cos(a), ey - Math.sin(a) * .8);
        }
      }
    };
  }

  /* ---------- AT-AT: side on, facing left, legs stepping; a snowspeeder makes a run ---------- */
  function atatBody(b, x, y, t) {                      // x the body's front edge, y the ground line
    x = Math.round(x);
    const top = y - 27;
    rect(b, x + 2, top, x + 23, top + 9); rect(b, x, top + 2, x + 25, top + 7);   // body, corners clipped
    for (let k = x + 6; k <= x + 20; k += 7) knock(b, k, top + 2, k, top + 7);   // armour plates
    knock(b, x + 2, top + 9, x + 23, top + 9);         // the belly seam
    rect(b, x - 3, top + 4, x, top + 6);               // neck
    rect(b, x - 11, top + 2, x - 4, top + 9); b.set(x - 11, top + 2, 0); b.set(x - 4, top + 2, 0);   // head
    b.set(x - 9, top + 4, 0); b.set(x - 7, top + 4, 0);                            // viewports
    rect(b, x - 13, top + 8, x - 11, top + 8);                                     // chin guns
    [[3, 0], [8, 2], [17, 1], [22, 3]].forEach(([lx, ph]) => {                     // four legs, out of step
      const s = Math.floor(t * 4 + ph) % 4, lift = s === 0 ? 2 : 0, swing = [0, 1, 0, -1][s];
      const kx = x + lx + Math.round(swing / 2), ky = top + 18 - lift, fx = x + lx + swing;
      rect(b, x + lx - 1, top + 10, x + lx + 1, top + 12);                         // hip
      b.line(x + lx, top + 12, kx, ky); b.line(x + lx + 1, top + 12, kx + 1, ky);  // thigh
      rect(b, kx - 1, ky - 1, kx + 1, ky + 1);                                     // knee
      b.line(kx, ky, fx, y - 2 - lift);                                            // shin
      rect(b, fx - 1, y - 1 - lift, fx + 2, y - lift); b.set(fx - 2, y - lift); b.set(fx + 3, y - lift);   // foot pad
    });
  }
  const SPEEDER = [
    "XXX.........",
    "XXXXXXXX....",
    "XXXXXoXXXXXX",
    ".XXXXXXXXX..",
  ];
  function atat(b, o, W, H) {
    const x0 = Math.round((o.x ?? .8) * W), ground = Math.round((o.y ?? .4) * H), every = o.every || 4.5, sv = 70;
    return t => {
      b.clear();
      for (let x = 0; x < W; x += 4) b.set(x + (Math.floor(x / 12) % 2), ground + 1);   // snow line
      const ax = x0 - (t * 2) % (W * .6), u = t % every, sx = -15 + u * sv, sy = ground - 14;   // the speeder runs under the belly
      atatBody(b, ax, ground, t);
      if (sx < W + 15) {
        draw(b, SPEEDER, sx, sy + Math.round(Math.sin(t * 5)));
        const last = Math.floor(u / .3);               // the walker's chin guns, every .3s
        for (let n = last; n > last - 3 && n >= 0; n--) {
          const a = u - n * .3, bx = ax - 13 - a * 90, by = ground - 19 + a * 16;
          for (let q = 0; q < 3; q++) b.set(bx - q, by + q / 3);
        }
        const sh = Math.floor(u / .45);                 // the speeder fires back; bolts spark on the armour
        for (let n = sh; n > sh - 2 && n >= 0; n--) {
          const a = u - n * .45, fx = -15 + n * .45 * sv + 12, bx = fx + a * 130;
          if (bx < ax) for (let q = 0; q < 3; q++) b.set(bx + q, sy + 2);
          else if (bx < ax + 8 && fx < ax - 4) { b.set(ax, sy); b.set(ax - 1, sy + 2); b.set(ax, sy + 4); b.set(ax - 2, sy + 1); }
        }
      }
    };
  }

  Object.assign(C.KINDS, { dogfight, patrol, falcon, ywing, advanced, crawler, deathstar, destroyer, arrival, asteroids, atat });
})();
