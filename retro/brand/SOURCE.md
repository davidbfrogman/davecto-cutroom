# Where these came from

Copied on 2026-11-13 from the davecto.com site repo (`davecto.burando`, branch
`davidbfrogman/shelf-chrome-top-level-pages`, last change to these files b229f22, 2026-11-03).

| here | site repo |
|---|---|
| `DESIGN.md` | `brand/retro-os/DESIGN.md` |
| `guide.html` | `brand/retro-os/index.html` (asset paths made relative) |
| `assets/css/retro-os.css`, `retro-os-site.css`, `fonts.css` | `public/assets/css/` (fonts.css trimmed to the three Retro OS fonts) |
| `assets/js/retro-os.js`, `retro-os-critters.js`, `retro-os-starships.js` | `public/assets/js/` |
| `assets/fonts/inter-tight.woff2`, `jetbrains-mono.woff2`, `vt323.woff2` | `public/assets/fonts/` |
| `examples/top-10-trending-repos.html`, `-og.html` | `public/video/top-10-trending-repos/` (asset paths made relative) |

Local change: `retro-os-critters.js` exports `buffer` on `window.RetroOSCritters` so
`kit/ships.js` can draw starship frames from the beat's timeline.

Open `guide.html` or `examples/top-10-trending-repos.html` in a browser to see everything moving.
