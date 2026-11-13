# Retro OS — Design & Style Guide

A design language modeled on **typesafe.ai** (studied Sept 29, 2026), rebuilt for Instagram guides, carousel cards and reel covers.

**The one-line brief:** *An early-80s windowed operating system (Lisa / Mac System 1) laid over Swiss editorial typography, printed on flat, saturated pink paper.*

The system has two voices. Big, tight grotesk headlines are the **human voice**. Pixel and mono type, 1px windows, dither, dot grids, base-64 noise and Game of Life cells are the **machine voice**. Every good card pairs one confident human headline with a scatter of precise machine details.

Files in this folder:

| File | What it is |
|---|---|
| `index.html` | The visual guide. Live swatches, specimens, components, animations and 7 Instagram templates. |
| `public/assets/css/retro-os.css` | Tokens and component classes. Link it from any card or guide (`/assets/css/retro-os.css` on the site). It imports `fonts.css`, which serves the bundled fonts from `public/assets/fonts`. |
| `public/assets/js/retro-os.js` | Generative textures and motion (dither, Game of Life, wireframe cube, clock, boot loader, terminal race, punch card, patent figure, base-64). No dependencies. |

`retro-os.css` and `retro-os.js` live in `public/assets` (not in this folder) so the site and this guide share one copy. Edit them there.
| `export-cards.sh` | Renders every template to a 1:1 PNG in `exports/` using headless Chrome. |
| `exports/` | Rendered PNGs of the templates. |

> **Observed vs. extended.** Values marked **(site)** were measured from the live site's computed styles and Framer tokens. Values marked **(ext.)** are my extensions for Instagram and aren't on the site.

---

## 1. Principles

1. **Everything is a window.** Data, lists, tools, photos and tooltips all live inside a 1px window with an ink title bar.
2. **Color is a place.** Each section (or card) is *one* flat world color. Sections change with hard cuts. No gradients, no blending.
3. **One-pixel precision.** Every line is 1px (2px on a 1080 canvas). There are no rounded corners and no soft shadows.
4. **Two voices, never mixed on one line.** Use the grotesk for what a person says and pixel or mono for what the machine says.
5. **Always alive.** Something small is always running: a clock ticks, cells crawl, sliders race, a cube turns.
6. **Oddly precise.** Use numbers like `193.6x`, `$0.042` and `0.114s`. Specific numbers read as measured.
7. **Hidden layers.** Base-64 blocks decode to real messages, and glyph corners mark the seams. Reward the people who look closely.

---

## 2. Color

### 2.1 Worlds (full-bleed backgrounds)

| Token | Hex | Role |
|---|---|---|
| `--pink` | **#F386A1** (site) | Primary world: home desktop, product, charts, stats. Default for cards. |
| `--teal` | **#09AEA1** (site) | Manifesto and long reads. Pair with the pink highlighter. |
| `--magenta` | **#D45BB6** (site) | People and team. Also the "Company News" tag color. |
| `--sage` | **#ABBAB9** (site) | Blog and archive. The quiet world, where duotone collage lives. |
| `--ink` | **#1E1E1E** (site) | FAQ, footer, end cards. |
| `--paper` | **#FEFEFE** (site) | Nav tabs, active window panes. |
| `--boot` → `--boot-dim` | **#E2E2E2 → #999999** (site) | Loader screen. It dims once loading hits 100%. |

### 2.2 Neutrals and UI

| Token | Hex | Role |
|---|---|---|
| `--ink-86` | **#1E1E1EDB** (site) | Default text color on light worlds (ink at 86%). |
| `--win` | **#DEDEDE** (site) | Window body. |
| `--win-2` | **#C4C4C4** (site) | Inactive pane ("LLM" side of a comparison), ✣ chips. |
| `--grey` | **#858585** (site) | Loader bar border, disabled. |
| `--green` | **#03AA5C** (site) | "Us / winner" chip in data. |
| `--data-cool` | ~#3D6CB9 (sampled) | Competitor chip (cool). |
| `--data-warm` | ~#8C4A33 (sampled) | Competitor chip (warm). |
| `--sky` | ~#CFE3F5 (sampled) | Pale sky behind the grainy pink-cloud photography. |

### 2.3 Rules

- **Page order on the site:** boot grey → paper nav → **pink** (hero + product) → **sage** (blog) → **ink** (FAQ + footer). Manifesto is a **teal** page. Team is a **magenta** page with a pink-cloud photo hero.
- **Usage per card:** about 60% world color, 18% ink, 14% paper/window greys, 8% one accent.
- **Never** use pure #000 or #FFF surfaces.
- **Contrast:** ink-86 on pink ≈ 6.9:1 and on teal ≈ 6.0:1. Paper on ink ≈ 16:1. Paper on pink ≈ 2.4:1, so use it only for highlighter spans at ≥ 40px on a 1080 canvas.
- **Knockout labels:** text inside an ink chip takes the *world* color (pink text on ink, on a pink world), so it looks punched out. `--knock` handles this automatically.

---

## 3. Typography

### 3.1 Families

| Role | Original (site) | Free substitute | Notes |
|---|---|---|---|
| Display + headings | **Die Grotesk C Medium** | **Inter Tight 600** | Tight neo-grotesk. Inter Tight needs about −0.045em tracking to match. |
| Body | **Die Grotesk C Regular** | **Inter Tight 400** | Site tracks body *positive* (+0.05em). Use +0.01em with Inter Tight. |
| Pixel UI | **LisaTerminal Paper 2X3Y Medium** | **VT323** (Google). Alt: Departure Mono | Tall, narrow bitmap face. VT323 runs small, so size up about 15%. |
| Micro mono | **JetBrains Mono 300** | same (free) | Also Fragment Mono on the site. |

Die Grotesk and LisaTerminal are commercial fonts. License them if you want the exact look. The substitutes get about 90% of the way.

### 3.2 Scale

| Role | Web (site) | IG 1080 canvas (ext.) | Details |
|---|---|---|---|
| Display | 150 / 0.8 | 170–210 / 0.8 | Title Case via `text-transform: capitalize`. Centered inside crop marks. |
| H2 | 64 / 0.9 | 110 / 0.9 | Stats, section titles. Left-aligned. |
| H3 | 48 / 0.9 | 80 / 0.9 | Article titles. |
| H4 | 30 / 0.9 | 56 | Card titles ("The Bitterest Lesson"). |
| Lead | 22 / 1.2 | 42–50 / 1.15 | Max about 7 lines. Narrow columns (30–45 characters). |
| Body | 17 / 1.2 | 34 / 1.2 | |
| Small / footer | 15 / 1.0 | 30 | |
| Pixel UI | 16–18 | 40–44 | Window bars, chips, data rows. |
| Pixel badge | 36 | 88–100 | Inverted acronym badges: `LM`, `RLHF`, `MCP`. |
| Pixel tag | 28 | 40 | "Company News". |
| Micro mono | 10–13, weight 300, +0.05em | 22–28, weight 400 | Title Case. Labels, FAQ questions, footnotes. |
| Base-64 | ~9 | 18 | Texture, not meant to be read. |

### 3.3 Rules

- Headlines are **Title Case Every Word** and set very tight (line-height 0.8). Aim for 2–4 words per line.
- Body copy always sits under a **micro-mono label** with a **1px rule** on its left.
- Emphasis comes from the **highlighter block**, never bold or italic.
- Pixel type is for **UI and data only**, never paragraphs.

---

## 4. Micrographics

| Element | Spec | Class |
|---|---|---|
| **Crop marks** | Four L-corners, 10px arms, 1px, currentColor. Frame every display headline and hero stat. | `.crop` |
| **T-marks ├ ┤** | Mid-edge ticks where two frames stack. | `.crop-t` |
| **Rule-left column** | 1px left rule, micro label, 40px gap, body text. A **dashed** rule means collapsed or inactive. | `.rule-col`, `.rule-col--dashed` |
| **Glyph corners** | `∵ ⩆` on the left and `⩆ ∵` on the right, JetBrains Mono 12px, at every section seam. | `.glyph-corners` |
| **[B.64] block** | Real base-64 of a hidden message, ~9px mono, ~170px wide, with a `[B.64]` header. The footer version is a single centered line. | `.b64` + `data-ros="b64" data-msg="…"` |
| **Inverted label** | Ink block with the world color as text (knockout), pixel font, padding 2/3/4. Sits **flush in the top-left corner** of a frame ("String Tax", "Jev.Cost", "TS.AI.OS1"). | `.chip-inv` |
| **✣ chip** | `✣` (U+2723) plus label on #C4C4C4, pixel font. Lists related items inside a window. | `.chip` |
| **Badge** | Big inverted pixel acronym at the top of a window body. | `.win__badge` |
| **Segmented bar** | 4 segments with 2px paper gaps, ink fill, right-aligned value. | `.seg-bar` (`--v: 0–1`) |
| **Slider** | 1px track with a 10px square thumb. Thumbs "race" in linear loops. | `.slider`, `.race` |
| **Toggle box** | 1px square with a chevron (FAQ). | `.toggle`, `.is-closed` |
| **Highlighter** | Pink block with paper text, on teal. Once per card. | `.hl` |
| **Footnote** | `*Based On …` in micro mono, plus an underlined `(Proof)`. Sits under big stats. | `.footnote` |
| **Glider icon** | 3×3 cell grid with the Game of Life glider in filled dots. | `.glider` |
| **Block cursor** | `█` blinking with `steps(1)`. | `.cursor` |
| **Version window** | Tiny "About" window: logo mark, `Version 0.01`, `©2026`, `Made In …`. | pattern |
| **Chevrons** | `▶▶▶` before a CTA ("Come Build With Us ▶▶▶ Open Roles"). | pattern |

---

## 5. Texture ("the grainy pixel style")

1. **Dot grid:** 1px ink dots at 60% opacity on a 4px pitch, filling every desktop frame like halftone paper. Demo areas use a denser 3px field. On IG, use 2px dots at 8px pitch. → `.dots`, `.dots--fine`
2. **Dither blobs:** huge soft circles rendered in 1-bit ordered (Bayer) dither. The core is a dense checker pattern and the edge breaks into scattered single pixels. Place 2–4 of them, bleeding off the frame edges. The site uses 2048² PNGs with `mix-blend-mode: multiply`. → `<canvas class="dither" data-ros="dither">`
3. **Game of Life:** 2–3px cells drifting over the desktop at 8–10 generations/sec. Gliders crawl out of the blobs. → `data-ros="life"`
4. **Film grain:** heavy grain on photography (the Team hero is hot-pink clouds on a pale sky). SVG `feTurbulence`, multiply, about 26%. → `.grain`, `.grain--animated`
5. **Duotone collage:** public-domain **patent drawings** (gears, hatching, leader lines, reference numerals, "FIG. 63") and **IBM punch cards**, cut into hard rectangles. Each panel gets one world color via grayscale → contrast → multiply, or is inverted to light line art on ink. A magenta category chip sits bottom-left. → `.duotone`, `data-ros="punchcard"`, `data-ros="figure"`
6. **Wireframe cubes:** 1px white 3D boxes (two overlapping) turning slowly behind the footer logo, with edges that flicker to dashed. The site builds this in Unicorn Studio WebGL. → `data-ros="cube"`

---

## 6. Components

### Window (core)
```
┌──────────────────────────┐  1px ink border + 2px hard shadow (55% ink)
│ Title Bar (pixel, paper) │  ink bar, 20px pixel type, padding 1/5/3
│┌────────────────────────┐│  2px inset, then a second 1px rule (double-rule chrome)
││ body #DEDEDE           ││  variants: --paper (white), --grey (#C4C4C4), --clear (transparent)
│└────────────────────────┘│
└──────────────────────────┘
```
```html
<div class="win">
  <div class="win__bar">RLHF</div>
  <div class="win__body"><span class="win__badge">RLHF</span><div>chat models</div>
    <div class="win__row"><span class="chip">gpt</span><span class="chip">claude</span></div></div>
</div>
```
Title-bar naming: `Clock Tool 1.1`, `Glider 1.1`, `Pareto.Curve`, `Jev.Cost`, `TypeSafe · CEO`. Use **Product + version**, **dot.notation**, or **Brand · Role**.

### Desktop hero
A 1px-bordered frame filled with `.dots`, with dither blobs and Game of Life behind it and an inverted `XX.OS1` label flush top-left. Windows overlap in cascades, each later window on top. A clear **Clock Tool** sits top-right, a **Version** window bottom-left and a **Glider** window bottom-right. The center window is a data table with racing sliders.

### Other patterns
- **Data chart:** a paper window titled `PRICE PER MILLION TOKENS [USD]`. Rows have a colored pixel chip, provider name, segmented bar and right-aligned price. Your entry is last and green ("FREE").
- **Scatter chart (Pareto.Curve):** white plot inside a window, light gridlines, diamond markers colored by provider, and a pink ★ for "us" with a dashed line showing the gap.
- **Terminal race ("String Tax"):** two windows side by side. One is paper (you) and one is grey (them). Each has a gutter of 1px squares that fill as each JSON line streams in. At the end, inverted chips show `COST $…` and `Completed in …s`.
- **Stats:** left-aligned 64px numbers with a 17px caption under a rule-left column. Hero stat: two lines of H2 inside crop marks, with a footnote.
- **Photo card (Team):** window titled `Brand · Role`, photo body, inverted pixel name, one-line bio. Stagger 3 vertically on magenta. A tiny **Fun fact** tooltip window overlaps a corner.
- **Nav tabs:** flat paper rectangles flush to the top edge with a 4px gap. The CTA is inverted to ink. Hover inverts instantly.
- **FAQ:** ink world. Questions in 13px micro mono with a toggle box on the right. The open item gets a solid left rule and collapsed items get dashed ones.
- **Blog card:** sage world. Collage image in a 2px ink frame with a magenta tag bottom-left, H3 title and a "Read More" link.

---

## 7. Motion

**Principles:** use only `linear` or `steps()`. No springs, overshoot or ease-in/out. World changes are **hard cuts** and windows **appear in 0ms**. Motion is always a *process running inside a window*, never decoration sliding around.

| Animation | Timing | Implementation |
|---|---|---|
| Boot loader | Spinner ring 1s linear. Bar fills in uneven jumps (~180ms ticks), then the screen dims #E2E2E2 → #999. | `data-ros="boot"` |
| Slider race | **18.248s** linear loop (site value), each row phase-shifted | `.race` + `--d` |
| Terminal race | Fast side ~40–60ms/line, slow side ~650–700ms/line, gutter squares fill per line | `data-ros="term-race"` |
| Game of Life | 8–10 generations/sec | `data-ros="life"` |
| Clock tick | 1s, no tween | `data-ros="clock"` |
| Blink | 2s linear, 50% duty (site keyframes). Cursor 1s. | `.blink`, `.cursor` |
| Wireframe cube | ~25s per turn, random dashed-edge flicker | `data-ros="cube"` |
| Grain boil | 4 steps / 0.4s | `.grain--animated` |

**For reels (ext.):** export at 30fps but animate "on twos" (12fps feel) so motion reads as stepped.
1. Boot loader, about 1.2s.
2. Hard cut to the pink desktop.
3. Windows pop in one per beat, at 0ms each.
4. The headline appears whole, with no typewriter effect on the display face. Pixel text *can* type on.
5. Hold the last frame for at least 1.5s.

---

## 8. Instagram

| Format | Size | Safe area (ext.) |
|---|---|---|
| Reel / Story | 1080×1920 | Keep key content out of the top ~220px, bottom ~400px and right ~150px (UI overlays). Keep the title inside the central 1080×1440 so it survives the profile-grid crop. |
| Post / Carousel | 1080×1350 (4:5) | 70–90px outer padding |

**Scaling from web to a 1080 canvas:** hairline 1px → 2px, crop arms 10 → 24px, dot pitch 4 → 8px, window shadow 2 → 5px, micro mono weight 300 → 400.

**Templates in `index.html`** (render one alone with `index.html?card=<id>`, or run `./export-cards.sh`):

| id | Format | World | Use for |
|---|---|---|---|
| `reel-cover` | 9:16 | pink | Reel cover: desktop frame, skill windows, huge title in crop marks |
| `stat` | 4:5 | pink | One headline number with a footnote and two supporting stats |
| `race` | 9:16 | pink | Before/after comparison as a terminal race |
| `steps` | 4:5 | sage | How-to steps inside a window, with segmented progress bars |
| `manifesto` | 4:5 | teal | Opinion or quote with a pink highlighter |
| `faq` | 4:5 | ink | Q&A / myth-busting with toggle boxes |
| `end` | 4:5 | ink | Follow CTA with the wireframe cube and a base-64 easter egg |

**Carousel rhythm:** cover (pink) → content slides alternating pink / sage → one teal opinion slide → ink FAQ → ink end card. The world changes act as chapter breaks.

---

## 9. Do / Don't

**Do**
- Use one flat world color per card.
- Keep lines at 1px (2px at 1080).
- Set headlines in Title Case, tight, at 0.8 line-height, inside crop marks.
- Put data in windows with ink title bars.
- Give every text block a micro label and a left rule.
- Use oddly precise numbers and a footnote with `(Proof)`.
- Hide real messages in base-64.
- Keep one slow loop alive in every reel.

**Don't**
- Round corners, use pills or soft shadows. Shadows are hard 2px offsets.
- Put gradients on backgrounds. Grainy photography is the only exception.
- Use pure #000 or #FFF.
- Set paragraphs in pixel type, or window chrome in the grotesk.
- Blend two world colors in one section.
- Use eased or springy motion, or fade between worlds.
- Use emoji. Use `✣ ∵ ⩆ ♟ ▶▶▶ █ ├ ┤` instead.
- Put paper text on pink below 40px.
- Copy TypeSafe's logo, cube mark or copy. Borrow the *language*, not the brand.

---

## 10. Prompt snippet: generating new cards

Paste this when asking Claude for a new guide or card:

```
Make a [1080x1350 carousel slide | 1080x1920 reel cover] in the Retro OS style.
Read brand/retro-os/DESIGN.md and link /assets/css/retro-os.css + /assets/js/retro-os.js.
Build the card as a <div class="ig world-<pink|teal|sage|magenta|ink>" data-fmt="<post|reel>">
at native size, following the templates in index.html (.ig overrides included).
Content: <headline>, <3–5 supporting points / numbers>, handle @<handle>.
Rules: one world color; Title Case display headline inside .crop; body text under a
.t-micro label in a .rule-col; data inside .win windows; at least two machine details
(glyph corners, [B.64] block, inverted label, dot grid, dither or Game of Life);
2px lines; no rounded corners, gradients or emoji; linear/stepped motion only.
Then render it to PNG with headless Chrome at 1:1.
```
