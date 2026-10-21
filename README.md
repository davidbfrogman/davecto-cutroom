# Cutroom

Edit your talking-head videos with Claude. Cutroom transcribes a take, cuts the pauses, filler and
retakes, plans a storyboard with titles, captions and transitions in your brand, and renders the
finished video. You review it in an editor in your browser and leave notes on any shot; Claude
makes the changes, renders a draft to check them, and replies.

Everything runs on your Mac. Your footage never leaves it.

**Needs:** macOS, [Claude Code](https://claude.com/claude-code), and [Homebrew](https://brew.sh)
(setup uses it to install ffmpeg, Node and uv).

## Install

In Claude Code:

```
/plugin marketplace add <owner>/cutroom
/plugin install cutroom@cutroom
```

Then say *"set up Cutroom"*. Claude runs setup, which takes a few minutes the first time: it
installs ffmpeg, Node and uv with Homebrew, then Whisper (transcription), yt-dlp (YouTube) and the
headless browsers that draw graphics and animations, into `~/Library/Application Support/Cutroom`.
You can also run it yourself: `bash setup.sh` in the plugin folder.

## Use

Say *"edit ~/Movies/take-3.mov with Cutroom"* (or paste a YouTube link). Claude imports it and
gives you the editor link.

1. In the editor, select a shot and write what you want under **Notes for Claude**: an animation,
   a cut, a title, a different framing. Notes on no shot are about the whole video.
2. Press **Send to Claude**. The header shows **Claude is working**; its edits appear live and
   highlighted, and each one is a single undo.
3. Claude replies on each note: done, or a question for you. Add more notes, send again.
4. **Render** for the final video. Exports go to `~/Movies/Cutroom/projects/<id>/exports`, with
   `.srt` captions and YouTube chapters.

You can also edit by hand: click words to cut or restore them, drag shots, set framing, add
graphics, B-roll and title cards.

## Your brand

Settings → **Brand**: plate, text and accent colours, a titles font and a labels font, your name and
role for the lower third. Settings → **Captions**: caption font and size. Everything drawn into the
video uses them, animations included. **Make this my default** starts every new video with it. Or
just tell Claude: *"make the captions orange on black, in my font"*.

Your own fonts: drop `.otf`, `.ttf` or `.woff2` files into `~/Movies/Cutroom/fonts`.

## Your files

Everything you make lives in `~/Movies/Cutroom` (set `CUTROOM_HOME` to move it):

| Folder | What |
|---|---|
| `projects/<id>/` | each video: `project.json` (storyboard and settings), `exports/` |
| `fonts/` | your fonts |
| `music/` | music for the music picker |
| `broll/` | B-roll clips for every video |
| `luts/` | your own `.cube` colour looks |
| `motion/` | animations saved for every video |
| `brand.json` | your default brand |

## How it works

No model calls happen inside the edit. The editing decisions are rules in `shared/plan.mjs`;
transcription is local Whisper; everything on screen is drawn by code. Claude joins through an MCP
server (`mcp.mjs`): the project file is the shared state and the Cutroom server is its only writer.
Claude edits through small operations (`shared/ops.mjs`), every edit bumps a revision, and an editor
saving on top of a newer revision gets the new version instead of overwriting it.

## The flow

1. **Import.** Drop a file, paste a path (the file stays where it is) or paste a YouTube URL
   (yt-dlp). Pick the format (9:16, 16:9, 1:1, 4:5) and a Whisper model.
2. **Ingest** (about 1× real time on an M2 for 4K, faster for 1080p):
   ffprobe → a 720p H.264 proxy for the browser → Faster-Whisper word timestamps and a loudness
   envelope → camera-cut detection → loudness measurement → a first storyboard.
3. **Storyboard.** One row per sentence, grouped into sections. Every automatic decision is
   visible and reversible:
   - pauses longer than the gap setting are cut (shown as `·0.8s·` in the text)
   - um/uh, stutters and repeated phrases are struck through (dotted = automatic)
   - abandoned takes are switched off with a note saying which take was kept
   - "hey guys, welcome back" openers are switched off
   - list items ("First…", "Second…") become sections with chapter titles
   - numbers worth seeing ("53%", "160,000 stars") get a stat callout
   - "I'm Sam" gets the name lower third (your name and role, from your brand); "comment LAB" gets a CTA card
   - every other same-angle cut punches in 1.1× to hide the jump; sections crossfade
4. **Edit.** Click words to cut or restore them, ⌥-click to split a shot, drag to reorder, set
   framing (click the frame to set the focus point), punch-in, push/pull moves, transitions,
   graphics, B-roll, title cards. The preview plays the edit live from the proxy with the real
   LUT (WebGL) and the real graphics page on top, so there's nothing to render to check an idea.
5. **Render.** Per-shot clips (cached, so re-renders only redo what changed) → graphics track →
   assembly with transitions, music ducking and loudness → H.264 MP4, plus `.srt` captions,
   YouTube chapters and the edit list.

## Animations (HyperFrames)

Text animations, stinger transitions and animated title cards are [HyperFrames](https://hyperframes.heygen.com)
compositions: HTML and GSAP, rendered to transparent WebM and composited by ffmpeg. Built in:
**Kinetic title**, **Slam text**, **Invert stat** (the number shows the video in negative) and
**Stinger wipe**. Claude writes new ones per video or for your library. Each takes variables (the
text, a label, a position), so one animation serves many shots, and each picks up your brand.

## Looks (colour)

Built in: **Paper** (warm, soft blacks), **Film**, **Clean**, **Ink** (warm black and white).
Conversions, applied before the look: **Apple Log → Rec.709** (Settings → Source colour) and
**HLG/PQ → SDR**, applied automatically to iPhone HDR video. Any 3D `.cube` file in
`~/Movies/Cutroom/luts` appears in the picker, with a strength slider.

## What it's built from

| Job | Tool |
|---|---|
| Cuts, crops, zoom, LUTs, transitions, mixing, encoding | ffmpeg |
| Transcription with word timestamps | faster-whisper (or openai-whisper: `node setup.mjs --with-whisper`) |
| YouTube sources and B-roll | yt-dlp |
| Titles, lower thirds, captions | `graphics/overlay.html` in headless Chromium (Playwright) |
| Animations and stinger transitions | HyperFrames 0.8.80 (`lib/motion.mjs`) |
| Claude Code | `mcp.mjs` (MCP over stdio) and `lib/collab.mjs` (notes, live edits, wait-for-notes) |

## Files

```
.claude-plugin/       plugin and marketplace manifests (the MCP server is declared in plugin.json)
skills/cutroom/       what Claude reads to work with you
bin/mcp.sh            starts the MCP server with Homebrew's Node
setup.sh, setup.mjs   setup (Homebrew tools, then npm, Python and browsers)
server.mjs            app server and JSON API (127.0.0.1 only)
cli.mjs               the same pipeline from the terminal
mcp.mjs               MCP server for Claude Code (no dependencies)
motion/               built-in animations (_template is the blank start)
assets/               bundled fonts and the graphics tokens (cutaways.css)
shared/               pure modules, used by Node and the browser
  plan.mjs              transcript → storyboard (the rules)
  timeline.mjs          storyboard → frame-exact timeline
  brand.mjs             the user's colours and fonts → CSS for graphics and animations
  framing.mjs, text.mjs, ops.mjs
lib/                  Node only: ingest, render, motion, collab, luts, media, deps, paths, …
py/transcribe.py      Whisper → words and loudness envelope
graphics/             the overlay page drawn into the video
ui/                   the editor
tests/                vitest
```

## Developing

```bash
npm install && npx playwright install chromium
bash setup.sh            # the Python side and HyperFrames' browser
npm test
npm run dev              # http://127.0.0.1:4100, restarts on code changes
node cli.mjs new ~/Movies/take-3.mov --aspect 9:16
node cli.mjs show <id>   # the storyboard as a script
node cli.mjs render <id> --preview
```

`CLAUDE.md` has the rules for changing the code.

## Limits worth knowing

- It edits by speech. A section with no talking (a silent demo) is cut as a pause; switch that
  shot to untouched source by setting `"kind": "raw", "in": …, "out": …` in project.json.
- Preview transitions are approximated as crossfades or dips; the render uses the real `xfade`.
- 4K 10-bit HEVC decodes slowly: a 30-second 4K take renders in about 75 seconds on an M2.
  Quick draft (540p) is much faster for checking.
- No face tracking: framing uses one focus point per project, overridable per shot.
