import { build, PAL } from './character.mjs';
import { writeFileSync } from 'node:fs';
const V = [
  ['tired · default', {}], ['annoyed', { eyes: 'glare', mouth: 'frown', pose: 'crossed' }], ['locked in', { eyes: 'glare', mouth: 'smirk', pose: 'mug' }],
  ['wait, what', { eyes: 'wide', mouth: 'o' }], ['3am', { eyes: 'closed', mouth: 'open', pose: 'mug' }], ['shipped it', { eyes: 'happy', mouth: 'grin', blush: true }],
];
const cell = (rows, s) => `<div class="spr" style="grid-template-columns:repeat(${rows[0].length},${s}px)">${rows.join('').split('').map(c => `<i style="background:${c === '.' ? 'transparent' : PAL[c]}"></i>`).join('')}</div>`;
writeFileSync(new URL('./sheet.html', import.meta.url), `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:28px;background:#1E1E1E;font:14px/1.3 ui-monospace,Menlo,monospace;color:#FEFEFE}
.row{display:flex;gap:24px;align-items:flex-end;flex-wrap:wrap}.card{display:flex;flex-direction:column;align-items:center;gap:8px}
.spr{display:grid}.spr i{display:block;aspect-ratio:1}.bg{padding:14px;background:#F386A1}.bg2{padding:14px;background:#FEFEFE}.bg3{padding:12px;background:#DEDEDE}
h2{font-weight:400;color:#F386A1;margin:0 0 12px}</style>
<h2>night-shift kid · hi-res (44×60) · v9 · headphones, X arms</h2><div class="row">${V.map(([n, o]) => `<div class="card"><div class="bg3">${cell(build(o), 5)}</div>${n}</div>`).join('')}</div>
<h2 style="margin-top:26px">big</h2><div class="row"><div class="bg2">${cell(build({}), 12)}</div><div class="bg">${cell(build({ eyes: 'glare', mouth: 'frown', pose: 'crossed' }), 12)}</div><div class="bg2">${cell(build({ eyes: 'glare', mouth: 'smirk', pose: 'mug' }), 12)}</div></div>
<h2 style="margin-top:26px">on the video (≈0.5u and 0.35u cells)</h2><div class="row"><div class="bg2">${cell(build({}), 2.6)}</div><div class="bg">${cell(build({ eyes: 'glare', mouth: 'frown', pose: 'crossed' }), 2.6)}</div><div class="bg2">${cell(build({ eyes: 'glare', pose: 'mug', mouth: 'smirk' }), 1.8)}</div></div>`);
