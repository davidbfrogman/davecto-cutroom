# Animation recipes

Building blocks for Cutroom animations (HyperFrames: HTML, CSS, one paused GSAP timeline). Mix
them; the point is an animation that fits what's being said, not a template. Every snippet here
renders in HyperFrames as written.

## The skeleton

`new_motion` gives you this (from `_template`). The parts that matter:

```html
<html lang="en" data-composition-variables='[{"id":"text","type":"string","label":"Text","default":"Your line"}]'>
<head>
  <meta name="cutroom:kind" content="text" />
  <meta name="description" content="What it does and when to use it." />
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <style>
    :root { --cr-plate: #141310; --cr-text: #f3f0e9; --cr-accent: #3e8b82; --cr-display: Fraunces, Georgia, serif; --cr-body: Inter, system-ui, sans-serif;
            --cr-w: 1080px; --cr-h: 1920px; --u: calc(min(var(--cr-w), var(--cr-h)) / 100); }
    html, body { margin: 0; overflow: hidden; background: transparent; }
    #root { position: relative; width: var(--cr-w); height: var(--cr-h); overflow: hidden; }
    .clip { position: absolute; inset: 0; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="root" data-width="1080" data-height="1920">
    <div class="clip" id="main" data-start="0" data-duration="3"> … </div>
  </div>
  <script>
    const v = window.__hyperframes.getVariables();
    const tl = gsap.timeline({ paused: true });
    // … tweens at absolute times: tl.to(el, {...}, 0.4)
    const total = 3;
    document.getElementById("main").setAttribute("data-duration", String(total));
    tl.set({}, {}, total);                      // the animation's length
    window.__timelines = window.__timelines || {};
    window.__timelines["root"] = tl;
  </script>
</body>
</html>
```

- Size everything in `--u` (1% of the short side) or %, so it works at 9:16, 16:9 and 1:1.
- Cutroom replaces the `:root` brand values with the user's. Those defaults are only for
  rendering the file on its own.
- Everything is driven by the timeline. CSS `@keyframes`, `transition` and `setTimeout` don't
  follow the render's clock: never use them.
- Anything that shouldn't show on frame 0 starts hidden (`opacity: 0` in CSS, or a `fromTo`).

## Landing on the words

`timing` gives each word's time from the animation's start (the same start `overlay_add` with
`phrase` uses). Put the times in the timeline, or in a `beats` variable when the animation is
reusable:

```js
const beats = String(v.beats || "").split(",").map(Number).filter(Number.isFinite);
words.forEach((w, i) => tl.fromTo(`#w${i}`, { opacity: 0, scale: 0.2 }, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(3)" }, beats[i] ?? i * 0.28));
```

Land a hit slightly before the word (0.05 to 0.1s): it reads as on time.

## Splitting text

```js
const box = document.getElementById("line");
String(v.text).split(/\s+/).forEach((w, i) => box.insertAdjacentHTML("beforeend", `<span class="w" id="w${i}">${w.replace(/[<&]/g, "")}</span> `));
// letters: [...word].map((ch, k) => `<span class="ch">${ch}</span>`)
tl.from("#line .w", { y: "60%", opacity: 0, duration: 0.35, ease: "power3.out", stagger: 0.06 }, 0.1);
```

`.w { display: inline-block }` so transforms apply.

## Energy: pops, wiggles, slams

```js
// Sticker pop with a tilt and a settle
tl.fromTo(el, { scale: 0.2, rotation: -15, opacity: 0 }, { scale: 1, rotation: -4, opacity: 1, duration: 0.42, ease: "back.out(3)" }, t);
tl.to(el, { keyframes: { rotation: [-6, -2.5, -4] }, duration: 0.3, ease: "sine.inOut" }, t + 0.34);
// Slam: big to size, fast, then a short shake
tl.fromTo(el, { scale: 2.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.24, ease: "expo.out" }, t);
tl.to(el, { keyframes: { x: ["0.9%", "-0.7%", "0.4%", "0%"] }, duration: 0.16, ease: "none" }, t + 0.13);
// Springy flip-up (3D): give the parent `perspective: 1200px`
tl.from(el, { rotationX: -90, transformOrigin: "50% 100%", opacity: 0, duration: 0.6, ease: "elastic.out(1, 0.5)" }, t);
```

Calm alternative for serious content: `y: 40, opacity: 0` with `power2.out`, 0.5s.

## Drawn lines: underlines, circles, arrows

```html
<svg viewBox="0 0 100 20" preserveAspectRatio="none" style="position:absolute; left:5%; top:26%; width:90%; height:14%; overflow:visible">
  <path id="ring" d="M5,10 C5,0 95,0 95,10 C95,20 5,20 8,8" fill="none" stroke="var(--cr-accent)" stroke-width="1.2"
        stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>
</svg>
```

```js
tl.to("#ring", { strokeDashoffset: 0, duration: 0.5, ease: "power2.inOut" }, t);
```

`pathLength="1"` makes any path draw with the same 0→1 tween. Wobbly hand-drawn paths look
better than perfect ones. For an arrow pointing at the speaker, check where they are with
`frame` and draw toward that point.

## Bursts and confetti (seeded)

```js
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;   // deterministic
for (let i = 0; i < 14; i++) {
  box.insertAdjacentHTML("beforeend", `<div class="bit" id="b${i}">${["✨", "⭐️", "🔥"][i % 3]}</div>`);
  const a = rnd() * Math.PI * 2, r = 20 + rnd() * 25;
  tl.fromTo(`#b${i}`, { x: 0, y: 0, scale: 0, opacity: 1 },
    { x: `${Math.cos(a) * r}vw`, y: `${Math.sin(a) * r}vw`, scale: 1, rotation: rnd() * 90 - 45, duration: 0.7, ease: "power3.out" }, t);
  tl.to(`#b${i}`, { opacity: 0, duration: 0.25 }, t + 0.55);
}
```

Colour emoji render. Coloured dots (`border-radius: 50%; background: var(--cr-accent)`) work too.

## Counters

```js
const c = { v: 0 }, n = document.getElementById("n");
tl.to(c, { v: 160000, duration: 1.2, ease: "power3.out", onUpdate: () => { n.textContent = Math.round(c.v).toLocaleString("en-US"); } }, t);
```

Use `font-variant-numeric: tabular-nums` so the width doesn't jitter.

## Reveals and masks

```js
// Wipe a band or a word in from the left
tl.fromTo("#band", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.4, ease: "expo.out" }, t);
// Highlighter swipe behind a word: an absolutely placed span under the text
tl.fromTo("#hl", { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.3, ease: "power2.out" }, t);
// Text rising out of a slot: wrap it in `overflow: hidden`, animate y from 100%
```

`color`, `filter` (blur, drop-shadow), `clip-path` and `width`/`height` tween too.

## Behind the speaker

Placed with `behind: true`, the speaker is cut out and laid over the animation. What works:
- **Huge type** (20 to 40 `--u`) across the upper third, so the head and shoulders overlap the
  bottom of the letters. The classic look.
- **Shapes and bands** sweeping across the frame and passing behind the body.
- Keep the words that matter clear of the body: `frame` shows where the speaker sits. Text fully
  behind the torso can't be read.
- Plates are optional here: the speaker gives the depth, so bold outlined or solid text reads.
- Check it with `render_motion` with `shot` and `behind: true`.

## Readability over video

Over a busy frame, text needs one of: a plate (`background: var(--cr-plate)`), a stroke
(`-webkit-text-stroke: calc(var(--u) * 0.6) var(--cr-plate); paint-order: stroke fill`), or a
shadow (`text-shadow: 0 calc(var(--u) * 0.4) calc(var(--u) * 1.5) rgb(0 0 0 / 0.5)`). Look at the
`render_motion` frames over the real shot before placing it.

## Transitions (stingers) and cards

- A stinger is `cutroom:kind` `transition` with `cutroom:cut` set to the moment it fully covers
  the frame; it has to cover it completely at that moment (`stinger-wipe` is the example).
- A card (`cutroom:kind` `card`) is a full-screen title over black: it can fill the frame with
  colour.
