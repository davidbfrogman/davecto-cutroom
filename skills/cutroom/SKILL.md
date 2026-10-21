---
name: cutroom
description: Edit the user's video with them in Cutroom, a local video editor on their Mac (cuts, captions, titles, animations in their brand, colour, renders). Use when they ask to edit, cut, caption, animate, brand, grade or render a video file or YouTube link, to "work on my Cutroom video", to pick up notes from the Cutroom editor, or to set up Cutroom.
---

# Cutroom

Cutroom is a video editor that runs on the user's Mac. It transcribes a take, cuts pauses, filler
and retakes, plans a storyboard with titles and captions, and renders with ffmpeg. The user edits
in the browser and leaves you notes; you make the changes with the `cutroom` MCP tools. Nothing
leaves their Mac.

The Cutroom folder is two levels up from this skill (the plugin root). Its `CLAUDE.md` is for
working on Cutroom's own code; you don't need it to edit a video.

## First run: setup

Call `status`. If it says setup is incomplete, or `open_video` fails for a missing tool, call
`setup` and tell the user it takes a few minutes the first time (it installs ffmpeg, Node and uv
with Homebrew, then the transcription model's Python packages and two headless browsers).

- **No Homebrew:** setup stops and prints the install command. The user runs it in Terminal
  themselves (it asks for their Mac password), then you call `setup` again.
- **The `cutroom` tools aren't there at all** (the MCP server couldn't start, usually because
  Node isn't installed): run `bash <plugin root>/setup.sh` with the Bash tool, then ask the user to
  run `/mcp` and reconnect `cutroom`, or restart Claude Code.

## The notes loop

1. `status`. New video: `open_video` with the file path or URL (and `aspect`: 9:16 for Reels and
   Shorts, 16:9 for YouTube). Give the user the editor URL.
2. `wait_for_notes`. The user writes notes on shots in the editor and presses **Send to Claude**;
   the call returns them, marked working. On a timeout, call it again. Keep looping until the
   user tells you to stop.
3. For each note: read `storyboard`, look with `frame`, change things with `edit` (ops, all or
   nothing) or build an animation (below), check with `render` (draft) and `look`, then `reply`
   with status `done`, or `question` when they need to choose. List what changed in `changes`.
4. Back to `wait_for_notes`.

Your edits land in the open editor live, highlighted, one undo step each. Never write
project.json yourself while the editor is open; go through the tools. Say what you looked at
when you check your work.

## Their brand

Everything Cutroom draws into the video (titles, lower thirds, captions, cards, animations) uses
the project's brand: plate, text and accent colours, a titles font and a labels font, a caption
font and size, and the name and role for the lower third. Blank colours fall back to the theme
(dark or light).

- `brand` shows the current brand and every font available, including the user's own.
- Change it with `edit` settings ops, e.g. `{"brand.accent":"#ff5a1f","brand.display":"user/Advercase-Regular.otf","captions.font":"serif","captions.size":1.1}`.
- Their own fonts: they drop `.otf`, `.ttf` or `.woff2` files into `~/Movies/Cutroom/fonts`; the
  id is `user/<file name>`.
- `brand` with `save_default: true` makes it the starting brand for every new video (the editor's
  Settings → Brand → **Make this my default** does the same).

When the user describes a look ("bold and orange", "like my website"), pick colours with enough
contrast between plate and text, set them, render a draft and show them a frame before moving on.

## Animations (HyperFrames)

Text animations, stingers (transitions) and animated title cards are HyperFrames compositions:
HTML plus a GSAP timeline, rendered to transparent video. Built-ins: `kinetic-title`,
`slam-text`, `invert-stat`, `stinger-wipe`. Write one-offs for a video with `new_motion` (copy a
built-in with `from` when it's close), edit its `index.html`, and check it with `render_motion`
(lint plus frames over the shot). `scope: "library"` saves it to `~/Movies/Cutroom/motion` for
every video.

Conventions:
- Transparent background. Cutroom sizes it per render: lay out with %, vw/vh or `var(--cr-w)` /
  `var(--cr-h)`, never fixed px for layout.
- Colours and fonts come from the brand, never hard-coded: `var(--cr-plate)` (the band or plate
  behind text), `var(--cr-text)`, `var(--cr-accent)` (at most twice per frame), `var(--cr-display)`
  for statements, `var(--cr-body)` for labels. Text over video sits on a plate so it reads on any frame.
- Inputs are `data-composition-variables` (text, labels, options); each use passes `vars`. Make it
  reusable rather than baking in one line.
- `<meta name="cutroom:kind" content="text | transition | card">`. Transitions also set
  `cutroom:cut` (0..1): the moment the frame is fully covered; Cutroom puts the cut there.
- `<meta name="cutroom:blend" content="invert">` makes the animation a mask: wherever it draws,
  the video below shows in negative. Draw in white. `invert-stat` is the example.
- Deterministic: one paused GSAP timeline on `window.__timelines["root"]`, no `Date.now()` or
  `Math.random()`. Smooth eases (power2, power3, expo), no bounce or elastic.
- Place it with `edit`: `overlay_add` type `motion` (with `dur` from `render_motion`, pinned with
  `phrase`), a shot `transition.stinger`, or `card_add` with `card.motion`.

For HyperFrames details: `npx hyperframes@0.8.80 docs <topic>` (compositions, data-attributes, gsap).

## Where things are

- Projects: `~/Movies/Cutroom/projects/<id>/` (`project.json` is the storyboard and settings,
  `exports/` the finished videos, captions and chapters).
- The user's own fonts, music, B-roll, LUTs and animations: `~/Movies/Cutroom/fonts`, `music`,
  `broll`, `luts`, `motion`.
- Server log: `~/Movies/Cutroom/server.log`.
