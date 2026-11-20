# Writing beats (for Claude)

How to put Retro OS motion graphics and sound effects on a finished vertical video with `retro`.
README.md is the user's side; this is yours. Read this file, not the history of how it was built.

**The deal:** every beat is bespoke. Don't reuse a previous video's beats or turn them into
templates; the user wants each video to feel new. What's shared is the plumbing (kit, timing,
sound, placement, render) and the brand vocabulary below. Spend your effort on ideas, not on
plumbing, and don't re-derive anything this file already says.

## The loop

1. `retro new <video>`: makes `<video>-retro/` next to it, transcribes (words.json), finds faces
   and scene cuts (faces.json) and prints the free space per scene. ~1 min.
2. `retro words`: the transcript, one phrase per line with start times. Split it into beats: one
   idea per beat, roughly 2–8 s, back to back so the whole video is covered. Scene cuts
   (`retro layout`) are good beat edges.
3. Per beat: `retro beat 03-ton-smarter "a ton smarter" [--to "next phrase"|secs]`. It snaps the
   start to a scene cut within 0.5 s, ends at the next cut (or `--to`), and writes into the file:
   the beat's words with times, its cuts, and its **free space through time** (worst case, in u).
   That comment is everything you need to write the beat: don't run `words`/`layout` again.
   Land actions on words with `W('phrase')` (the skeleton defines it), not hand-typed numbers.
   Delete the notes comment when the beat is done (keep the one-line description).
4. `retro lint` (seconds, no render) checks four things. Fix all of them before looking at frames:
   - **face**: covers the face/chin zone. Move or shrink the window, or close it before the lean-in.
   - **safe**: in the Instagram UI zone.
   - **clip**: content cut off by its window ("needs h ≥ 38"). Use `h: 'auto'`, raise h, or
     shrink type. This was the commonest bug by far; trust it over your eye.
   - **timing**: things scheduled after the beat ends (a word lookup matched a later word, or
     an end phrase lands past the cut), sounds outside the beat, unknown sound names.
5. Look once: `retro frames all` (one frame per beat, one sheet), then `retro frames <beat>
   --events` for any beat you're unsure of (a frame just after each sound = each thing happening).
   Red box = face no-go zone.
6. `retro render --draft` once at the end, then tell the user about `retro preview` for toggling
   and moving things themselves. Never undo their moves (retro.json `move`).

## Timing tweaks (the user's, in retro.json)

The user retimes beats in the preview (click a beat's name) or with `retro time`. It's stored per
beat as `"time": { "retime": [a, b], "crop": [c, d] }` (video seconds):
- **stretch** (`retime`): the whole beat plays between a and b, faster or slower; every animation
  and sound moves proportionally (sounds keep their own length).
- **cut** (`crop`): only c..d shows, at normal speed; sounds outside it are dropped. A cut start
  skips the window's zoom-rect open, so it just appears.
The kit applies both in `R.done`, so lint, frames, preview and render all see the same thing. Write
beats in their natural times; `R.START`/`R.END` stay as written and `R.OUT` is where the beat shows.
The user can also switch off single animations: `"hide": ["copy"]` (layers; the preview's 👁, or
`retro hide <beat> <layer>`). A hidden layer is gone from lint, preview and render, and so are the
sounds cued on it, so cue each sound on the layer it belongs to (`{ layer: 'copy' }`).
Never undo the user's timing, hidden layers or moves; `retro ls` shows them all.

## Placement rules (the user's, non-negotiable)

- **Never cover the face**, and never put anything **right under the chin**. The no-go zone is
  the face box plus a brow band of 0.2 and a chin band of 0.45 face heights (`lib/faces.mjs`;
  faces.json boxes are `[x, y, w, h]` from the top-left, in u. Don't do this maths by hand:
  `retro zones` and the `retro beat` notes do it).
- **Prefer the space above the head.** Below the chest is fine. Covering an on-screen card or
  prop is fine. The sides work when the face is centred and small.
- Instagram UI: keep graphics in x 0–86u and y 20u to (frame height − 37u) (bottom = 140u at 9:16).
- `retro layout` prints, per scene, the face box and the free rectangles (above / below / left /
  right) in u, **worst case over the scene**. `retro zones [from] [to]` shows the same through time
  (people lean in mid-scene: a window above the head may have to close before they do). Place
  windows inside those. `allow: ["face"]` in retro.json exists for a deliberate
  gag the user asked for; don't add it yourself.

Units: everything is in **u = 1% of the frame width**. The frame is 100u wide and 177.8u tall at 9:16.

## The kit (kit/retro.js, kit/retro.css)

Each beat is `beats/NN-name/index.html`, a HyperFrames composition. `retro beat` writes the
skeleton: links `retro.css`, `gsap.min.js`, `retro.js` (and optionally `ships.js`), one
`<div class="clip" id="stage">`, and a script that sets `R.START`, builds, and ends with `R.done(end)`.
All times are **absolute seconds in the video**.

| Call | Does |
|---|---|
| `R.START = R.w('phrase', 0)` | beat start (set first) |
| `R.w(phrase, after?)` / `R.we(phrase, after?)` | start / end of a phrase in the transcript, first match after `after` (default START−1). Typos throw. |
| `R.win({ title, right, variant, body, x, y, w, h, layer })` | a window (variants: paper, grey, pink, world, clear). `h: 'auto'` = as tall as its content (the lint checks the real box against the face). |
| `R.box(cls, { x, y, w, h, html, id, layer, parent })` | any absolutely placed element (`.h` = starts hidden) |
| `R.open(el, t, { from: {x,y}, sfx })` / `R.close(el, t, { to, sfx })` | System-1 zoom-rect open (lands at t; never earlier than START + 4 frames so the trail plays inside the beat; returns the landing time) / close. Sound: open / close. |
| `R.show(el, t)` / `R.hide(el, t)` | 0 ms appear / vanish |
| `R.type(el, t, cps, { sfx })` | type-on, character by character (any glyphs: arrows, emoji). Element has class `type`. Sound: type clicks. Ends at t + chars/cps. |
| `R.text(el, t, s)` | swap text |
| `R.count(el, t, dur, from, to, fmt)` | stepped counter on twos |
| `R.blink(el, a, b, period)` / `R.flash(el, t, n)` | 50% blink / invert flash |
| `R.every(a, b, fn(t))` | call fn every frame (on twos), for procedural drawing. It also runs once at build with t = a. |
| `R.stagger(els, a, b, { gap, sfx, vol, every })` | reveal elements one by one, evenly a→b (or every `gap` s), a tick each (`every: 2` = every other). `els`: selector, element or list. Returns the times. |
| `R.press(el, t, { depth, sfx })` | a button pushed into its hard shadow for two frames. Sound: thunk. |
| `R.path(el, [[t, x, y], ...], { move })` | move along keyframes (u, in its parent), linear on twos; `move` = seconds per leg (then it waits). Cursors, claws, flying papers. |
| `R.flip(el, a, b, { fps })` + `R.pixAnim([rowsA, rowsB], cell)` | flip-book pixel art (fire, walking, waving), default 7.5 fps |
| `R.marquee(el, a, b, text, { chars, cps })` | scrolling LCD/ticker text |
| `R.lerp(a, b, k)` / `R.clamp(v, a, b)` / `R.measure(el)` | maths; an element's box in u |
| `R.tl.set(el, {...}, R.T(t))` | anything else in GSAP (no `className`: set properties) |
| `R.pix(rows, cell)` | pixel art: k ink, p paper, n accent, g green, w grey, `.` clear |
| `R.seg(n)` | segmented bar (fill cells by setting their background) |
| `R.rnd()` / `R.seed(n)` | seeded random (never `Math.random` or `Date`: renders must repeat) |
| `R.sfx(name, t, { vol, freq, layer })` | a sound at t (vol in dB) |
| `R.layer(name)` | a layer: things that move together in the preview and `retro move` |

**Layers:** give separate pieces their own layer (`layer: 'save'`) so the user can drag one without
the other. A cursor that clicks a button goes in the button's layer.

**Colour:** `--accent` is the world colour (pink by default). `data-world="teal"` on `<body>` or any
element switches it: pink teal magenta sage yellow blue lavender orange coral lime sky green.
Chips: `.chip-inv` (ink, accent text), `.chip`, `.chip--green/--warm/--cool/--world`.
Other classes: `.dots`, `.crop` (4 `<b>`), `.rule`, `.micro`, `.disp` (Inter Tight display), `.px`, `.mono`.

## Sound

Sounds belong to the beat that makes them, so switching a beat off silences it. `R.open`, `R.close`
and `R.type` cue their own (`{ sfx: false }` to skip, `{ sfx: 'notify' }` to swap); cue everything
else with `R.sfx`. Sounds (lib/synth.mjs): **open close tick type pop success alert error strike
lock thunk sweep crash sparkle boot notify blip** (blip takes `freq`; rising runs:
`500 * 2 ** (i / 16)`).
**8-bit game set** (NES-style, original): coin jump bigjump stomp powerup oneup shrink pipe fireball
bump brick kick rev turbo secret fanfare sword hurt heart gem select confirm cancel pause zap explode
warp gameover victory charge. Reach for them when the beat is playful: coin = money or a point
scored, powerup/oneup = something upgraded or gained, shrink/gameover = it got worse or failed,
secret = a reveal, fanfare/victory = a big win, select/confirm/cancel = menu choices, rev/turbo =
speed, zap/fireball = a shot, stomp/bump/brick = an impact, warp/pipe = going somewhere else. They
replace the plain sounds for that moment rather than stacking on top of them.
**80s synth-pop set** (detuned saws, FM, gated reverb; all in A minor, so any two sit together):
stab orchhit gated tomfill clap bell epiano sunset arpup arpdown swell filterup revcym tapestop
pluck fmbass syntom choir shimmer drop. Momentary effects with a little more body, never a bed.
stab/orchhit = a big reveal or a title landing; gated/clap/fmbass = a punchy accent (fmbass under
a heavy landing); bell/pluck/shimmer = a light, shiny "ding"; epiano/sunset/choir = a warm win or a
revelation; arpup/swell/filterup/tomfill = building into something (swell peaks ~0.8 s after
its cue, so cue it early); arpdown/drop/tapestop = a letdown or "wait, what"; revcym = a
transition into the next window.
**Mix the three sets freely** to give each moment its own feeling: plain OS sounds for the
machinery (ticks, typing, windows), 8-bit for playful wins and fails, synth-pop for the moments
that should feel big or warm. Keep it sparse: the synth sounds are longer, so one per moment.
What goes with what: windows open/close; each step, cell or counter jump = tick; labels and chips
landing = pop; done/pass/saved = success; warnings = alert; wrong = error; strike-through = strike;
padlocks/target lock = lock; big button press = thunk; build-ups = sweep then crash; dialogs asking
for attention = notify. Keep it sparse: one sound per visible event, nothing on decoration.
Levels are calibrated (the user turned them down twice); don't raise them. Per beat: `retro sfx <beat> -3`.

## Brand (brand/)

`brand/DESIGN.md` is the full Retro OS guide (from davecto.com, modelled on typesafe.ai);
`brand/guide.html` shows it live. The essentials:
- An early-80s windowed OS (Lisa / Mac System 1) over Swiss editorial type. **Everything is a window.**
- Two voices, never mixed on one line: Inter Tight display for what a person says (`.disp`),
  VT323 pixel / JetBrains Mono for what the machine says.
- 2px lines, no rounded corners, no soft shadows, no gradients, never pure black or white.
- **Motion:** linear or `steps()` only. Windows appear in 0 ms with the zoom-rect trail. Animate on
  twos (15 fps). Motion is a process running inside a window, never decoration sliding around.
  No springs, overshoot or easing. Something small is always running (clock, blink, counter).
- Oddly precise numbers (`193.6x`, `0.114s`). Window names: `Product 1.1`, `dot.notation`, `Brand · Role`.
- Vocabulary to draw from (DESIGN.md §4–6): crop marks, inverted labels, ✣ chips, segmented bars,
  slider races, toggle boxes, footnotes with (Proof), block cursor, version window, chevrons ▶▶▶,
  boot loader, terminal race, data chart, Pareto scatter, dot grid, dither blobs, Game of Life,
  patent figures, punch cards, base-64 easter eggs, wireframe cubes.

### Starships and critters (kit/ships.js)

The pixel Star Wars set from `brand/examples/top-10-trending-repos.html`. Add
`<script src="ships.js"></script>` after retro.js, then:

```js
R.ship('falcon', { x: 4, y: 22, w: 82, h: 30, from: R.w('framework'), to: R.START + 4, t0: 8, opts: { y: .5 } });
```
Box in u; `opts` are the kind's own options, positions as 0–1 fractions of the box (top of `brand/assets/js/retro-os-starships.js`).
`t0` = where the kind's own loop starts at `from`. Good starts (the big moment lands ~1 s in):

| kind | what | t0 | big moment |
|---|---|---|---|
| falcon | cruises in, stars stretch, jumps to lightspeed | 8.0 | jump at +1.3 s |
| dogfight | X-wing jinking, two TIEs on its tail firing | 4.6 | the chase |
| deathstar | turning Death Star, TIE in orbit, superlaser | 3.9 | fires at +0.7 s |
| ywing | two Y-wings, ion cannons | 6.0 | both firing |
| advanced | Vader's TIE roars up to the glass and peels away | 0 | full size at +0.9 s |
| crawler | sandcrawler; `droid: .6` beams an R2 aboard | 4.6 | droid at +0.7–1.8 s |
| asteroids | a TIE threads a field, meets a big one | 2.0 | impact at +1.2 s |
| destroyer | Star Destroyer chasing a blockade runner | 3.5 | turbolaser hits |
| arrival | Star Destroyer drops out of lightspeed | 0.1 | at +0.9 s |
| atat | AT-AT on the snow, snowspeeder run | 1.4 | run at +0.6–2 s |
| patrol | line of small TIEs crossing | — | |
| koi / bird / frog | critters (retro-os-critters.js) | — | |

They're one ink colour (`color`), chunky pixels (`cell` in u, default .5), and silent: cue
sweep/crash/alert yourself. They read best above the head as a band, or inside a window body.
Static generators from retro-os.js are fine too: `RetroOS.dither(canvas, opts)`,
`RetroOS.punchcard(el)`, `RetroOS.figure(el)`, `RetroOS.b64(el)`. Never put `data-ros`
attributes in a beat (they start real-time clocks and break renders); Game of Life and the cube
are real-time only, so build your own with `R.every` if you need them.

## Gotchas

- Renders must be deterministic: no `Math.random`, `Date`, `setTimeout`, `requestAnimationFrame`.
- Anything revealed later starts hidden (`.h` class, or `visibility:hidden` in CSS) and is shown
  with `R.show`/`R.open`. Windows, zoom rects and `.h` are opacity 0 too, so nothing inside an
  unopened window can show through.
- In `R.every`, toggle `display` (or opacity) for things that come and go; `visibility: visible`
  on a child beats a `visibility: hidden` parent.
- Content that should overflow on purpose (a conveyor running off the edge) goes inside its own
  `overflow: hidden` box, or gets `data-bleed` so the clip check skips it.
- A phrase can match a later sentence: pass `after` (`W('and', pa)`), and lint's timing check
  catches the ones that land past the beat's end.
- Keep windows inside the free space at their largest (the zoom trail starts at `from`; put
  `from` near where the attention is: the face or the previous window).
- The render size is 1440x2560 (Instagram 2K). Size things in u and it just works.
- Cost: write the beats, lint until clean, one `frames all`, one draft render. Don't render per tweak.
