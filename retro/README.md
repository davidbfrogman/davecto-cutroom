# retro

**New here? Open `START.html`** (`open retro/START.html`): a step-by-step walkthrough for a new video.

Retro OS motion graphics and sound effects over a finished vertical video. Retro Studio (a local web
app) plus the command-line tools it shares its code with. It's separate from Cutroom: it only borrows the tools Cutroom installs
(HyperFrames, GSAP, Chromium, the whisper venv in `~/Library/Application Support/Cutroom`).

```bash
alias retro="$HOME/conductor/repos/davecto-cutroom/retro/retro"   # once, in ~/.zshrc
```

## Studio

```bash
retro                                 # (or retro studio) opens Retro Studio: http://localhost:4180
```

One page for the whole workflow, no terminal needed:

- **Projects** (home): every `*-retro` folder in `video/`, as cards with a thumbnail, length, beat count and
  last edit, and badges for a missing transcript or faces, the lint count, and the draft/final render
  (marked "render out of date" when the beats or retro.json changed after it).
  **+ Add video** opens the Mac's file dialog: pick a video from anywhere and the project is made next to
  it (transcript, faces). **Type a path…** does the same from a pasted path.
  Per card: open the editor, lint, contact sheet, render draft / final, play the render, re-transcribe,
  reveal in Finder, delete (the project folder goes to the Trash; the video is never touched).
- **Jobs** (new, transcribe, lint, contact sheet, render) run in the Studio's server with live progress
  and a Cancel button. One render at a time; the rest wait their turn.
- **Editor** (open a card): play, toggle, drag, retime, sounds, undo. Plus **Render** (draft or final,
  with progress), a **Lint** panel (click an issue to go to that beat and moment), and ← Projects.
  The **Instagram UI** toggle draws the Reels app over the video as it looks on an iPhone (buttons, username,
  caption, tab bar) and shades the strips the phone crops off each side (about 5u: x 0–5 and 95–100). A guide only: never rendered.

The server restarts itself when retro's code changes (after anything running finishes); open tabs keep
working. `retro preview` in a project folder opens that project's editor straight away.

Claude still writes the beats (it follows `GUIDE.md`, from the command line); the Studio doesn't.

## Zooms

The slow push-ins on the video, under the graphics (they're never zoomed). Rules, not AI: you pick, or the
easy button picks the usual for you. Per beat, in the editor's **Zoom** card or with `retro zoom`:

- **Push**: a slow push from 100% to 125% (the **Zoom to** slider) across the beat, about the centre.
- **Pop + push**: a quick zoom out (125%→100% in 0.2 s), then the slow push. The opening move.
- **Push + pan**: the slow push about your face instead of the centre, so the picture pans as it zooms and a
  face low in the frame doesn't fall off the bottom.
- **Auto**: pop + push on the opening beat, push on the rest, and push + pan wherever a centre push would carry
  your face (and the space under your chin) off the frame or under the Instagram caption.
- **Off**: as shot.
- **Punch in on a word**: pick a word and the picture jumps 15% closer, about your face, for 1.2 s (both
  adjustable), then back.

**⤢ Auto zoom** in the editor's header (or `retro zoom auto`) puts every beat on auto at 125%, as one undo.
New projects start on auto; older ones have no zoom until you press it. Zooms stay when a beat's graphics are
switched off. The lint, `retro zones` and the contact sheets check your face where the zoom puts it, and the
render zooms straight from the video's own size (a 4K video stays sharp at 125%).

## Command line

```bash
retro new ~/Videos/MyReel.mov         # makes ~/Videos/MyReel-retro/: transcript, faces, scene cuts
cd ~/Videos/MyReel-retro
# ask Claude: "add retro animations to this" (it follows retro/GUIDE.md)
retro preview                         # this project in the Studio's editor
retro render                          # → out/MyReel-retro.mp4 (1440x2560, sounds mixed in)
```

## Tweaking

Everything lives in `retro.json`, so you can edit it by hand, use the Studio's editor, or run commands.
In the editor, every edit can be undone: ⌘Z undoes, ⇧⌘Z (or ⌘Y) redoes, or use the ↶ ↷ buttons. A drag
or a slider counts as one step; the history lasts until you reload the page.

Commands:

```bash
retro ls                              # beats, times, layers, moves, sound counts
retro off 04 07                       # turn beats off (their sound effects go too)
retro on 04
retro move 06 save 0 -5               # move beat 06's "save" layer up 5u (u = 1% of the width)
retro move 07 3 0                     # move the whole main layer right 3u
retro move 06 save --reset
retro sfx 04 off                      # mute one beat's sounds, keep its graphics
retro sfx 04 -4                       # or turn them down 4 dB
retro sfx all -3                      # the whole sound-effects stem
retro lint                            # over your face or chin? under Instagram's UI? text cut off? mistimed?
retro frames 06                       # contact sheet of beat 06 over the video → out/check-06-….jpg
retro frames all                      # one frame from every beat in one sheet → out/check-all.jpg
retro zones 20 30                     # where there's room around your head, moment by moment
retro time 01 cut +2 -                # start beat 01 two seconds later (cut), same speed
retro time 04 stretch - 17.2          # squeeze beat 04 so it ends at 17.2 s (sounds move with it)
retro time 04 --reset                 # back to the beat's own timing
retro behind 01 main                  # put beat 01's animation behind you (you're cut out of the video)
retro front 01 main                   # back in front
retro zoom                            # every beat's zoom
retro zoom auto                       # the easy button (or: retro zoom auto 03 04)
retro zoom 05 pan --to 1.3            # push + pan to 130% on beat 05 (push, pop, pan, auto, off)
retro zoom 04 punch discount codes    # punch in on a word (--dur 1.2 --by 1.15; punch --clear)
retro zoom 05 --reset                 # back to the project's default
retro render --draft                  # quicker, lower quality export
retro render --video ../OtherCut.mov  # same graphics over another cut (same timing)
retro render --size 1080x1920
```

```json
{
  "video": "../MyReel.mov",
  "size": "1440x2560",
  "sfxGain": 0,
  "beats": {
    "04-rule-book": { "on": false },
    "06-framework": { "on": true, "move": { "save": [0, -5] }, "sfxGain": -3 },
    "09-hard-rules": { "on": true, "sfx": false }
  }
}
```

## Outputs (in `out/`)

- `<video>-retro.mp4`: the export.
- `overlays/<beat>.mov`: each beat as ProRes 4444 with transparency, plus `placements.csv`
  (where each goes on the timeline), if you'd rather finish in an editor.
  A beat with an animation behind you renders as `<beat>~back.mov` and `<beat>~front.mov`;
  `mattes/` holds your cutout (gray, white = you) for those stretches of the video.
- `sfx.wav`: the sound effects stem on its own, plus `sfx-cues.csv`.

## What's where

| | |
|---|---|
| `cli.mjs`, `retro` | the commands |
| `GUIDE.md` | how beats are written (the rules Claude follows: placement, brand, sound) |
| `kit/` | what every beat links: `retro.css`, `retro.js` (timing, windows, layers, sounds), `ships.js` (starships) |
| `brand/` | the Retro OS brand, copied from davecto.com: `DESIGN.md`, `guide.html`, the site's CSS/JS/fonts, and the Top 10 Trending Repos reel with the pixel Star Wars ships (`examples/`) |
| `lib/` | transcription (`words.py`), faces (`faces.swift`, `faces.mjs`), the placement rules (`rules.mjs`), zooms (`zoom.mjs`), probe, lint, render, synth; `studio.mjs` (the Studio's server) and `job.mjs` (one job, run by the server, calling the same functions as the CLI) |
| `studio/` | the Studio's projects page |
| `preview/` | the editor: `main.js` and one module per part (`stage`, `timeline`, `sounds`, `history`, `api`, `reset`, `zoom`), `preview.css` |
| `tests/` | `npm run retro:test`: a tiny fixture project, kit timing tests, Playwright tests of the Studio |

Updating the brand: copy the files from the site repo again (`brand/SOURCE.md` lists them). The
one local change is in `brand/assets/js/retro-os-critters.js`: `buffer` is exported for `kit/ships.js`.
