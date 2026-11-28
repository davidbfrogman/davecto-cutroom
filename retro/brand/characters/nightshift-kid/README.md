# Night-shift kid

A chibi pixel character for Retro OS beats: short messy dark hair, big over-ear headphones, pink eyes, a charcoal
hoodie. Tired and a little grumpy by default. 44×60 cells, drawn in code so every pose shares the same head.

- `character.mjs`: `build({ eyes, mouth, pose, blush })` returns rows of palette letters (`PAL`).
  eyes: tired (default), open, glare, wide, closed, happy · mouth: flat, frown, smirk, o, open, grin ·
  pose: idle, mug, crossed.
- `sheet.mjs`: writes `sheet.html`, every expression and pose (`node sheet.mjs`, then open it). `sheet.png` is the latest.

Not used in any beat yet. Its palette has skin tones and greys beyond the kit's `R.pix` letters, so a beat would draw
it with its own small renderer (or extend `R.pix`).
