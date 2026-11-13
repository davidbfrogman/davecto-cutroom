# retro

Retro OS motion graphics and sound effects over a finished vertical video. Command-line tools plus a
small preview page. It's separate from Cutroom: it only borrows the tools Cutroom installs
(HyperFrames, GSAP, Chromium, the whisper venv in `~/Library/Application Support/Cutroom`).

```bash
alias retro="$PWD/retro/retro"        # once, from the repo root (or put it in ~/.zshrc)
```

## Use

```bash
retro new ~/Videos/MyReel.mov         # makes ~/Videos/MyReel-retro/: transcript, faces, scene cuts
cd ~/Videos/MyReel-retro
# ask Claude: "add retro animations to this" (it follows retro/GUIDE.md)
retro preview                         # http://localhost:4180: play, toggle, drag
retro render                          # → out/MyReel-retro.mp4 (1440x2560, sounds mixed in)
```

## Tweaking

Everything lives in `retro.json`, so you can edit it by hand, use the preview page, or run commands:

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
retro lint                            # anything over your face or chin, or under Instagram's UI?
retro frames 06                       # contact sheet of beat 06 over the video → out/check-06-….jpg
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
- `sfx.wav`: the sound effects stem on its own, plus `sfx-cues.csv`.

## What's where

| | |
|---|---|
| `cli.mjs`, `retro` | the commands |
| `GUIDE.md` | how beats are written (the rules Claude follows: placement, brand, sound) |
| `kit/` | what every beat links: `retro.css`, `retro.js` (timing, windows, layers, sounds), `ships.js` (starships) |
| `brand/` | the Retro OS brand, copied from davecto.com: `DESIGN.md`, `guide.html`, the site's CSS/JS/fonts, and the Top 10 Trending Repos reel with the pixel Star Wars ships (`examples/`) |
| `lib/` | transcription (`words.py`), faces (`faces.swift`, `faces.mjs`), probe, lint, render, synth, preview |
| `preview/` | the preview page |

Updating the brand: copy the files from the site repo again (`brand/SOURCE.md` lists them). The
one local change is in `brand/assets/js/retro-os-critters.js`: `buffer` is exported for `kit/ships.js`.
