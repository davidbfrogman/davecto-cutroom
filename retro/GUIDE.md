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
6. `retro render --draft` once at the end, then tell the user to open the project in Retro Studio
   (`retro`, or `retro preview` in the project folder) for toggling and moving things themselves,
   linting and rendering. Never undo their moves (retro.json `move`). The Studio runs the same lint and
   render code as the CLI, so `retro lint` and the Studio's Lint panel always agree.

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
The user tunes sounds in the preview too (sound lanes under the timeline, a library of all three
sets). Stored per beat as `"sounds": { "edit": { "<key>": { "s": "coin", "gain": -3, "off": true, "dur": 0.3, "shift": 0.12 } },
"add": [{ "t", "s", "vol", "layer", "dur" }] }` (dur = the user shortened it; shift = they slid it, in
beat seconds) and `"sfxGain"` (the beat's level). A cue's key is its
written `name@time` (`pop@12.40`, `#2` for repeats), so if you change a beat's own sound cues after
the user has edited them, those edits stop matching: check `retro ls`/retro.json first and carry
them over. Added sounds are in the beat's written time, so they move with stretch/cut like the rest.
Each sound's category and one-line use are in `INFO` (lib/synth.mjs): the preview's picker groups by it, and it's a quick way to choose. Timing in the preview is now done by dragging a beat's edges (trim/stretch).
Per animation: `"ltime": { "cac": { "retime": [57.76, 64.21], "crop": [c, d] } }` (beat seconds as written;
the preview's Animations lane, one block per layer: drag to move it, edges trim/stretch). The kit
shifts/stretches that layer's tweens (per-frame code included: R.every finds its layer by what it draws)
and its sounds, and hides it outside crop. Moving a layer past the beat's edges makes the beat longer.
Cue each sound on its layer (`{ layer: 'cac' }`) so it travels with it.
The video's end is a hard stop: the build injects `videoEnd`, beats are cut there (lint says by how much),
later sounds are dropped and the stem fades out over its last 20 ms.
Behind the speaker: `"behind": ["main"]` (layers; the preview's **In front / Behind me** button, or
`retro behind <beat> <layer>` / `retro front …`) draws that layer between the speaker and the
background. The speaker is cut out with Cutroom's matte tool (Apple Vision person segmentation,
`swift/matte.swift`): the render makes a matte for that beat's time (`out/mattes/`, cached) and
composites video → behind layers → the speaker → everything else; `retro frames` shows it the same
way, and the preview cuts out a light copy once per video. A behind layer may sit over the face (lint
skips the face check for it). The matte is Vision's guess: fast hands blur at the edge and big objects
near the speaker can get cut out too, so check `retro frames` before suggesting one.
Never undo the user's timing, hidden layers, behind layers, sound edits or moves; `retro ls` shows them all.

**Zooms are the user's** (README › Zooms; `lib/zoom.mjs`): the push-ins on the video under the graphics,
per beat in retro.json `"zoom"`, set in the editor or with `retro zoom`. Don't set or change them yourself
unless asked. They move the face: a slow push to 125% grows it and, about the centre, carries a face below
the middle further down. The lint, `retro zones`, `retro beat`'s notes and `retro frames` all use the face
where it shows (`project.screenFaces()`), so trust them over faces.json. The notes only know the zooms of
beats probed so far (out/.probe), so lint again after writing a beat in a project that zooms.

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

**Colour: one accent, pink.** The user's call (Nov 2026): a video reads as one piece when every beat is
pink + ink + paper + the window greys, like the first videos. A different world colour per beat looked
jarring and disjointed. So keep `data-world="pink"` (the skeleton's default) on every beat, use the accent
for the one thing that matters, and leave `.chip--green/--warm/--cool` alone. Another world colour only
when the user asks for it. (`data-world` can switch `--accent` to teal magenta sage yellow blue lavender
orange coral lime sky green.) Chips: `.chip-inv` (ink, accent text), `.chip`, `.chip--world`.
Other classes: `.dots`, `.crop` (4 `<b>`), `.rule`, `.micro`, `.disp` (Inter Tight display), `.px`, `.mono`.

## Sound

Sounds belong to the beat that makes them, so switching a beat off silences it. `R.open`, `R.close`
and `R.type` cue their own (`{ sfx: false }` to skip, `{ sfx: 'notify' }` to swap); cue everything
else with `R.sfx(name, t, { vol, layer })` (always pass the layer the sound belongs to).

**Finding the right sound:** `retro sounds` prints the whole catalogue (98 sounds, five sets): what
each is for, its set, its length and its tags. `retro sounds <words>` searches it by what's happening
on screen and ranks the results (★ = matches every word): `retro sounds win warm`, `retro sounds fail
funny`, `retro sounds reveal`, `retro sounds delete`, `retro sounds transition`. The tags use one
small vocabulary, so search with these words:
- size: tiny · light · medium · big
- mood: techy · playful · warm · cool · magical · dramatic · ominous · funny · sad · tense · nostalgic · triumphant
- moment: window · typing · step · label · menu · notification · lock / unlock · money · win · upgrade ·
  discovery · reveal · title · build · transition · impact · accent · delete · fail · warning · wrong ·
  speed · momentum · start · end
The catalogue lives in `INFO` in lib/synth.mjs; the preview's sound picker searches the same words.
When you add a sound, give it an `INFO` entry with tags from that vocabulary.

**The sets, and how to mix them** (each beat can use all five):
- **Retro OS** (open close tick type pop success alert error …): the machinery. Windows, typing, steps,
  labels. Quiet and frequent; never the star.
- **8-bit** (coin jump powerup oneup gameover secret victory …): playful wins and fails.
- **Synth-pop** (stab orchhit gated bell sunset tapestop swell …): moments that should feel big or warm.
- **Adventure** (dungeon chest keyget itemget fairy solved bossdoor …): quests, discoveries, unlocks,
  something entered or found, in a classic 8-bit adventure-game style (our own phrases).
- **Synthwave** (neon brass polysweep riser sunrise vhs gatetom …): cinematic, cool, 1980s night drive.
Rules of thumb: one sound per visible event, nothing on decoration; the machinery stays Retro OS and
the 2–4 moments per beat that matter get a sound from the other sets; build-ups (swell, riser, polysweep)
peak late, so cue them early; big sounds are long, so leave them room.
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
