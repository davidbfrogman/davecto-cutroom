# Retro Studio: PRD (overnight build)

**Goal:** one web app that runs the whole retro workflow without the terminal. The CLI stays, because it's
how Claude writes beats, but the Studio and the CLI call the same functions: one implementation, two
front ends. Branch: `davidbfrogman/retro-next-3`. Squash-merge to main when done, then branch fresh.

## Build order (strict)

### 1. Split the preview page into modules (first)
- Turn `retro/preview/index.html` (about 1,500 lines) into plain ES modules with no build step:
  - `stage.js` (video, cutout, layer moves)
  - `timeline.js` (lanes and drags)
  - `sounds.js` (lanes, popover, picker)
  - `history.js` (undo and redo)
  - `api.js` (save, flush, whenSaved)
  - `reset.js`
  - a small `main.js`
  - CSS in `preview.css`
- **Pure refactor:** no behaviour change. Before splitting, check these still work: load, play, move a
  layer, beat and layer drags, add/move/trim a sound, undo/redo, behind me, reset. Check them again after.

### 2. Retro Studio
- **Launch:** `retro` with no arguments (or `retro studio`) starts one server and opens the browser. Keep
  `retro preview` working as a shortcut straight into one project's editor.
- **Server:** grows from one project to all projects. Every project route is `/p/<name>/…`. It keeps its
  self-restart when the code changes.
- **Jobs:** long tasks (new/transcribe, lint, frames, render draft and final) run in the server with
  progress streamed to the page over SSE.
  - Jobs reuse the functions in `lib/` that the CLI already calls. Don't shell out to parse CLI text.
  - One render at a time, with the rest queued. Each job can be cancelled.
- **Projects page (home):**
  - **What it lists:** every `*-retro` folder in `video/`. "Add" also accepts a video path from anywhere
    and creates the project next to that video.
  - **Each card shows:** a thumbnail, length, beat count and last edit, plus badges:
    - transcript/faces missing
    - lint issue count
    - draft or final render present, and "render out of date" if retro.json or the beats are newer than it
  - **Actions:**
    - New project (progress)
    - Re-transcribe
    - Open editor
    - Lint
    - Contact sheet (shows the image)
    - Render draft
    - Render final
    - Play the render in the page
    - Reveal in Finder
    - Delete: moves the project folder to the macOS Trash (never the source `.mov`), after a confirm
- **Editor:** today's preview plus:
  - a Render button (draft or final) with progress
  - a ← Projects link
  - a lint panel, where clicking an issue selects its beat and seeks to its time (the one place a click
    may seek; it's an explicit "go there")
- **Look:** match the current preview's dark UI. Keep it light and don't overbuild.
- **Docs:** update README.md (Studio first, CLI second) and GUIDE.md only where Claude's workflow changes.

### 3. Real test suite (if tokens remain)
- `retro/tests/` with a tiny fixture project (a few seconds of video, 2 beats). Run with `npm run retro:test`.
- **Playwright tests** against the Studio:
  - undo/redo (on/off, hide, slider = one step)
  - add sound lands on a playing layer and shows on the timeline
  - clicking a beat or animation doesn't move the playhead
  - layer drag moves sounds with it
  - no flicker on rebuild
  - projects page lists and deletes (to a temp Trash dir in tests)
- **Kit timing tests:** stretch, cut, per-layer retime/crop, videoEnd cut, and no change when there's
  no timing.

## Non-goals
- No writing beats from the UI. That's Claude's job via the CLI.
- No auth, no remote access, no packaging into a .app tonight.

## Rules (unchanged)
- Never reset or undo the user's moves, timing, hides, sound edits, behind or ltime. Don't touch
  their projects' retro.json except through their actions.
- Verify with headless Playwright and real renders on a copy (`/tmp`), never the user's projects.
- Commit in logical steps (split, studio, tests). Squash-merge at the end.
