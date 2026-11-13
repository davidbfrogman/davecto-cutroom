/* Starships and critters on the beat's timeline.
   The build stages this file as ships.js = brand/assets/js/retro-os.js + retro-os-critters.js +
   retro-os-starships.js + this adapter, so a beat only adds <script src="ships.js"></script>
   after retro.js.

   The brand scripts run their own clocks (setInterval) on the site. Here nothing auto-starts: the
   adapter draws each frame from the GSAP timeline, so renders are deterministic and seekable.

     R.ship('falcon', { x: 6, y: 20, w: 88, h: 30, from: R.w('framework'), to: 24, t0: 8, opts: { y: .5 } })

   kind: starships  dogfight patrol falcon ywing advanced crawler deathstar destroyer arrival asteroids atat
         critters   koi bird frog
   Kind options go in opts (lanes, y, speed, every, ...); they're documented at the top of
   brand/assets/js/retro-os-starships.js and retro-os-critters.js; positions there are 0–1
   fractions of this box. t0 = seconds into the kind's own loop at `from` (pick it so the big
   moment lands on the word; the brand example lists good t0 values per kind).
   cell = pixel size in u (default .5), color = ink by default, fps = 15 (on twos).
   Sound: none by default; cue it yourself (e.g. R.sfx('sweep', R.w('jump'))).

   Static generators from retro-os.js can be called directly on an element you made:
     RetroOS.dither(canvas, { color, blobs, ... })   RetroOS.punchcard(el, opts)
     RetroOS.figure(el, opts)  ("FIG. 12" patent drawing)   RetroOS.b64(el) with data-msg
   Don't put data-ros attributes in a beat: those auto-start real-time clocks. */
(function () {
  const C = window.RetroOSCritters;
  if (!C || !C.buffer) throw new Error('ships.js: brand scripts missing (stage it with the build)');
  R.ship = (kind, { x = 0, y = 0, w = 100, h = 40, layer, cell = 0.5, color = '#1E1E1E', seed = 1, fps = R.FPS2, from, to, t0 = 0, opts = {} }) => {
    const draw0 = C.KINDS[kind];
    if (!draw0) throw new Error(`R.ship: unknown kind "${kind}" (${Object.keys(C.KINDS).join(' ')})`);
    if (from == null || to == null) throw new Error('R.ship: needs from and to (absolute seconds)');
    const box = R.box('h', { x, y, w, h, layer, html: '<canvas class="ros"></canvas>' });
    const cv = box.firstChild;
    cv.style.left = 0; cv.style.top = 0; cv.style.width = '100%'; cv.style.height = '100%';
    const px = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cr-w')) / 100 * cell;
    const W = Math.ceil(box.offsetWidth / px), H = Math.ceil(box.offsetHeight / px);
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), b = C.buffer(W, H);
    const draw = draw0(b, { color, seed, ...opts }, W, H);
    const frame = t => {
      draw(t);
      ctx.clearRect(0, 0, W, H); ctx.fillStyle = color;
      for (let i = 0; i < b.px.length; i++) if (b.px[i]) ctx.fillRect(i % W, (i / W) | 0, 1, 1);
    };
    frame(t0);
    R.show(box, from);
    R.hide(box, to);
    R.every(from, to, t => frame(t0 + (t - from)), fps);
    return box;
  };
})();
