# Cutroom: working on the code

This file is for changing Cutroom itself. To edit a video with the user, follow
`skills/cutroom/SKILL.md` (the notes loop, the brand, animation rules). `README.md` has the flow
and the file map.

**Three looks, kept apart:**
- `ui/` is the editor, with its own tokens in `ui/tokens.css`. Semantic tokens only, no hex.
- `graphics/` is what gets drawn into the video: `assets/css/cutaways.css` tokens, recoloured and
  re-fonted per video by the user's brand (`shared/brand.mjs` → `applyBrand()` in `graphics/overlay.js`).
  Accent = corner bracket plus one thing; motion ≤600ms, opacity and ≤10px rise. The editor shows
  it in an iframe.
- `motion/` compositions take the brand as `--cr-plate`, `--cr-text`, `--cr-accent`,
  `--cr-display`, `--cr-body`, injected by `lib/motion.mjs`. Never hard-code colours or fonts there.
- "Look" in the code means the colour grade (LUT). The user's colours and fonts are the "brand".

**Rules:**
- No model calls in the pipeline. Edit decisions are rules in `shared/plan.mjs`. If a rule is
  wrong, fix the rule and add a test in `tests/cutroom.test.ts`.
- `shared/` must stay pure (no Node or DOM APIs): the browser preview and the renderer both import
  it. Anything that decides *what plays when* goes through `buildTimeline()`, so preview, graphics
  and render agree to the frame.
- Ranges are frame-quantized in `timeline.mjs` and trimmed to exact frame counts in `render.mjs`.
  Don't add timing logic anywhere else.
- Render clips are cached by a hash of everything that affects them (`clipSpec`). If you add a
  setting that changes clip pixels or audio, add it to `clipSpec` and bump `CLIP_VERSION` when the
  clip recipe changes. Animations are cached by `motionKey` (files, size, vars, brand).
- Paths inside ffmpeg filter strings go through `esc()`.
- Paths come from `lib/paths.mjs`: CUTROOM (this folder, replaced on every plugin update, so
  never write into it at runtime), HOME (`~/Movies/Cutroom`, the user's work), DATA
  (`~/Library/Application Support/Cutroom`, installed tools). npm packages are found in
  `./node_modules` or `DATA/node_modules` (`lib/deps.mjs`).
- `mcp.mjs` has no dependencies, so it starts before setup has run. Keep it that way.

**Check your work:** `npm test`, then render (`node cli.mjs render <id> --preview` is quick) and
look at frames: `ffmpeg -ss 5 -i export.mp4 -frames:v 1 frame.png`. Say what you looked at.

**Developing with Claude Code:** install the plugin from this folder (`/plugin marketplace add
<this folder>`, then `/plugin install cutroom@cutroom`). Set `CUTROOM_DEV=1` in your environment
so the app server restarts when the code changes (`npm run dev` does the same by hand). Close an
editor tab before editing a project.json by hand: the UI autosaves and would overwrite your change.
