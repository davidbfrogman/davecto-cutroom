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
   nothing) or write an animation for it (below), check with `render` (draft) and `look`, then
   `reply` with status `done`, or `question` when they need to choose. List what changed in
   `changes`.
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

Animations are where a video gets its personality, and you write them: each one is a HyperFrames
composition (HTML, CSS and a GSAP timeline) rendered to transparent video and laid over the edit.
Anything a browser can draw works: kinetic type, stickers, emoji, SVG scribbles and arrows,
counters, 3D flips, particle bursts, masks, text that slides behind the speaker.

**When the user asks for something animated, make it for this moment.** "Make this fun", "add some
energy here", "something pops up when I say 160,000": write a new composition with `new_motion`
rather than reaching for the nearest built-in or a static graphic. The built-ins (`kinetic-title`,
`slam-text`, `pop-words`, `invert-stat`, `stinger-wipe`) are good starting points (`from`) and
quick defaults when the user only wants a title. They aren't the menu.

How to work it, conversationally:
1. **Read the moment.** `storyboard` for the words, `frame` for the picture (where the speaker
   is, where there's room), `timing` for when each word lands.
2. **Pick an idea and say it in a line** ("the number counts up and bursts, then 'stars' drops in
   behind you"). Don't ask permission for a small idea: build it and show it. Ask first only when
   the note is vague and the options differ a lot.
3. **Build it.** `new_motion` (from a built-in when one is close), then write `index.html`.
   `animations.md` (next to this skill) has the recipes: per-word timing, overshoot pops, drawn
   SVG lines, seeded particle bursts, counters, masks and 3D.
4. **Look at it.** `render_motion` with `shot` (and `behind: true` if it sits behind the speaker)
   shows frames over the real picture. Check timing against `timing`, readability, and that
   nothing important is hidden. Iterate until it's good, then place it with `edit`.
5. **Show the user** in your reply what you made and one way to push it ("want it bigger and
   louder, or calmer?"). Their next note is the next iteration: change the composition, not just
   its variables, when they ask for a different feel.

Behind the speaker: an `overlay_add` of type `motion` with `behind: true` (or the editor's
**Sits: Behind the speaker**) cuts the speaker out of the shot and lays them back over the
animation, the "text behind the person" look. Make it big: giant type or shapes that pass
behind the head and shoulders, with the words that matter clear of the body (`frame` shows
where they are). The speaker is cut out of the picture only; titles, captions and other
animations stay in front.

What makes it render (these are firm):
- Transparent background. Cutroom sizes it per render: lay out with %, vw/vh or `var(--cr-w)` /
  `var(--cr-h)`, never fixed px.
- One paused GSAP timeline on `window.__timelines["root"]`; its length is the animation's
  length (end with `tl.set({}, {}, total)`). Deterministic: a seeded random, never
  `Math.random()` or `Date.now()`.
- Every element starts hidden or off-screen if it shouldn't show on frame 0.
- `<meta name="cutroom:kind" content="text | transition | card">`. Transitions also set
  `cutroom:cut` (0..1): the moment the frame is fully covered; Cutroom puts the cut there.
- `<meta name="cutroom:blend" content="invert">` makes it a mask: wherever it draws, the video
  below shows in negative. Draw in white. `invert-stat` is the example.

Style (defaults, not rules; the user's taste wins):
- Start from the brand: `var(--cr-plate)`, `var(--cr-text)`, `var(--cr-accent)`,
  `var(--cr-display)`, `var(--cr-body)`, so it matches their titles and captions. Use other
  colours when the idea needs them or they ask (emoji, a red "NO", a highlighter yellow).
- Text has to read on any frame: a plate, a stroke, a shadow or a dark band behind it.
- Match the energy they asked for. Playful: overshoot (`back.out`), elastic, wiggles, tilts,
  pops. Serious: smooth `power2`/`expo`, nothing bouncing. Land beats on the words (`timing`).
- Variables (`data-composition-variables`) are for what changes between uses. A one-off for
  this video can just have its text in the HTML; make it reusable when it's going to the library
  (`scope: "library"`, saved to `~/Movies/Cutroom/motion` for every video).
- Place it with `edit`: `overlay_add` type `motion` (with `dur` from `render_motion`, pinned with
  `phrase`, `behind: true` to sit behind the speaker), a shot `transition.stinger`, or
  `card_add` with `card.motion`.

For HyperFrames details: `npx hyperframes@0.8.80 docs <topic>` (compositions, data-attributes, gsap).

## Where things are

- Projects: `~/Movies/Cutroom/projects/<id>/` (`project.json` is the storyboard and settings,
  `exports/` the finished videos, captions and chapters).
- The user's own fonts, music, B-roll, LUTs and animations: `~/Movies/Cutroom/fonts`, `music`,
  `broll`, `luts`, `motion`.
- Server log: `~/Movies/Cutroom/server.log`.
