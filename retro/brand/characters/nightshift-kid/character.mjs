// Night-shift kid, hi-res: 44x60. Shapes painted, details placed by hand, then an outside outline.
export const PAL = {
  k: '#1E1E1E', d: '#28232F', h: '#3A3443', H: '#554D61', L: '#7D7290', r: '#D06A8C',
  s: '#F8DACB', S: '#E9BBA8', T: '#D99C8B', w: '#FEFEFE', p: '#F386A1', P: '#C25A7E', q: '#5E2440', m: '#7E3449', n: '#A86A6E', b: '#F2B8B4',
  c: '#2A2931', C: '#42414C', D: '#5A5966', g: '#6E6E78', G: '#B9B9C2',
};
const W = 44, HT = 61, CX = 21.5;
const grid = () => Array.from({ length: HT }, () => Array(W).fill('.'));
const put = (g, r, c, v) => { if (r >= 0 && r < HT && c >= 0 && c < W) g[r][c] = v; };
const get = (g, r, c) => g[r]?.[c];
const row = (g, r, a, b, v) => { for (let c = Math.round(a); c <= Math.round(b); c++) put(g, r, c, v); };
const stamp = (g, r0, c0, rows) => rows.forEach((s, i) => [...s].forEach((v, j) => { if (v !== ' ') put(g, r0 + i, c0 + j, v); }));
const mirror = rows => rows.map(r => [...r].reverse().join(''));

const EYE = {   // left eye, 7x9; the right one is mirrored
  open:   [' kkkkk ', 'kkkkkkk', 'kqqqqqk', 'kwwqqPk', 'kwwqPPk', 'kPqqPPk', 'kPPPPpk', 'kppppwk', ' kkkkk '],
  tired:  ['       ', '       ', 'kkkkkkk', 'kkkkkkk', 'kwqqqPk', 'kPqqPPk', 'kPPPPpk', 'kppppwk', ' kkkkk '],
  glare:  ['       ', 'k      ', 'kkkk   ', 'kkkkkkk', 'kwqqqPk', 'kPqqPPk', 'kPPPPpk', 'kppppwk', ' kkkkk '],
  wide:   [' kkkkk ', 'kwwwwwk', 'kwwwwwk', 'kwwqqwk', 'kwwqqwk', 'kwwwwwk', 'kwwwwwk', 'kwwwwwk', ' kkkkk '],
  closed: ['       ', '       ', '       ', '       ', 'k     k', ' kkkkk ', '       ', '       ', '       '],
  happy:  ['       ', '       ', '       ', ' kkkkk ', 'k     k', '       ', '       ', '       ', '       '],
};
const MOUTH = { flat: ['nn'], frown: [' nn ', 'n  n'], smirk: ['  n', 'nn '], o: [' kk ', 'kmmk', ' kk '], open: [' kkk ', 'kmmmk', 'kmbmk', ' kkk '], grin: ['kkkkk', 'kwwwk', ' kkk '] };
function head(g, { eyes, mouth, blush }) {
  // hair dome
  for (let r = 0; r < 34; r++) for (let c = 0; c < W; c++) if (((c + 0.5 - CX - 0.5) / 16.2) ** 2 + ((r + 0.5 - 16.4) / 15.4) ** 2 <= 1) put(g, r, c, 'h');
  // top tufts + cowlick
  stamp(g, 0, 12, ['    hh      h  ', '   hhh     hhh ', '  hhhh    hhhh ']);
  stamp(g, 0, 26, [' h   ', 'hhh  ', 'hhhh ']);
  // face
  const hw = r => (r <= 15 ? 7.5 : r <= 24 ? 9.5 : [9, 8.5, 7.8, 6.8, 5.6, 4, 2][r - 25]);
  for (let r = 15; r <= 31; r++) { const w = hw(r); if (w) row(g, r, CX - w + 0.5, CX + w - 0.5, 's'); }
  // fringe: clumps swept down to the left, each with a pointed tip
  const clumps = [[7, 10, 27], [11, 14, 24], [15, 18, 21], [19, 22, 20], [23, 26, 19], [27, 30, 18], [31, 33, 20], [34, 36, 23]];
  for (const [a, b, depth] of clumps) for (let c = a; c <= b; c++) {
    const mid = (a + b) / 2, t = Math.round(depth - Math.abs(c - mid) * 1.5 + (c < mid ? 0.5 : 0));
    for (let r = 10; r < t; r++) put(g, r, c, 'h');
    put(g, t, c, get(g, t, c) === 's' ? 'S' : get(g, t, c));            // a shadow under each tip
  }
  // separations between clumps and a mid-tone down each one
  for (const [a, , depth] of clumps.slice(1)) for (let i = 0; i < 7; i++) { const r = depth - 3 - i, c = a + Math.floor(i / 2); if (get(g, r, c) === 'h') put(g, r, c, 'd'); }
  for (const [a, b, depth] of clumps.filter((_, i) => i % 2)) for (let i = 0; i < 5; i++) { const r = depth - 5 - i, c = Math.round((a + b) / 2) + Math.floor(i / 2); if (get(g, r, c) === 'h') put(g, r, c, 'H'); }
  // side locks to the jaw, flipping out
  for (let r = 16; r < 30; r++) { row(g, r, 6, 11 - Math.max(0, r - 25), 'h'); row(g, r, 32 + Math.max(0, r - 25), 37, 'h'); }
  stamp(g, 28, 6, ['hh', 'h ']); stamp(g, 28, 36, ['hh', ' h']);   // pointed ends, a little outward
  stamp(g, 21, 8, ['d', 'd', ' d', ' d', '  d']); stamp(g, 21, 35, [' d', ' d', 'd ', 'd ', 'd ']);
  // shine: a stepped band across the crown, and a pink rim light on the right
  stamp(g, 4, 9, ['       LLLL', '     LLLLH ', '   LLLHH   ', '  LLHH     ', ' HHH       ']);
  stamp(g, 4, 25, ['   LL', '  LLH', ' LHH ', 'HH   ']);
  for (const r of [11, 12, 13, 14, 15, 16]) { let c = W - 1; while (c > 0 && get(g, r, c) === '.') c--; if (get(g, r, c) === 'h') put(g, r, c, 'r'); }
  // eyes, nose, mouth, blush
  stamp(g, 19, 13, EYE[eyes]); stamp(g, 19, 24, mirror(EYE[eyes]));
  put(g, 26, 22, 'T');
  const M = MOUTH[mouth]; stamp(g, 29, 22 - Math.floor(M[0].length / 2), M);
  if (blush) { row(g, 27, 13, 15, 'b'); row(g, 27, 28, 30, 'b'); }
  // jaw shading
  for (let r = 27; r <= 31; r++) { const w = hw(r); if (w) { put(g, r, Math.round(CX - w + 0.5), 'S'); put(g, r, Math.round(CX + w - 0.5), 'S'); } }
  row(g, 31, 20, 23, 'S');
  // big over-ear headphones
  for (let th = 0; th <= Math.PI; th += 0.01) { const x = Math.round(CX + 17.6 * Math.cos(th)), y = Math.round(17.2 - 16.6 * Math.sin(th)); put(g, y, x, 'g'); put(g, y + 1, x, y < 6 ? 'G' : 'g'); }
  const CUP = ['  kkk  ', ' kgggk ', 'kgGggpk', 'kgppppk', 'kgppppk', 'kgPppPk', 'kgppppk', 'kgPPPPk', 'kgggggk', ' kgggk ', '  kkk  '];
  stamp(g, 16, 1, CUP); stamp(g, 16, 36, mirror(CUP));
}

function body(g, pose) {
  // the hood collar, right under the chin (no neck: the head sits on the body)
  row(g, 34, 15, 28, 'c'); row(g, 35, 13, 30, 'c');
  // torso
  for (let r = 35; r <= 51; r++) { const w = [6.5, 7.5, 8.5, 9.5][r - 35] ?? 10; row(g, r, CX - w + 0.5, CX + w - 0.5, r < 37 ? 'c' : 'C'); }
  for (let r = 39; r <= 49; r++) { put(g, r, 13, 'D'); put(g, r, 30, 'c'); }
  row(g, 35, 16, 27, 'D'); row(g, 36, 18, 25, 'D');                                    // hood rim
  // drawstrings
  for (let r = 37; r <= 42; r++) { put(g, r, 19, 'p'); put(g, r, 24, 'p'); }
  put(g, 43, 19, 'w'); put(g, 43, 24, 'w');
  // pocket + hem
  row(g, 44, 15, 29, 'c'); for (let r = 45; r <= 49; r++) { put(g, r, 15, 'c'); put(g, r, 29, 'c'); }
  row(g, 50, 12, 31, 'c'); row(g, 51, 12, 31, 'c');
  // arms: drawn by hand, angled a little away from the body, tapering to small hands; no two alike
  const LA = ['      CCC', '     CCCC', '    CCCCk', '    CCCCk', '   CCCCk ', '   CCCCk ', '   CCcCk ', '  CCCCk  ', '  CCCck  ', '  CCCk   ', '  cccc   ', '  ssss   ', '  sssS   ', '   SS    '];
  const RA = ['CCC      ', 'CCCC     ', 'kCCCC    ', 'kCCCC    ', ' kCCCC   ', ' kCCCCC  ', '  kCCCC  ', '  kCCcC  ', ' kCCCCk  ', ' kCCCk   ', ' kcccc   ', ' ssss    ', ' sSss    ', '  SS     '];   // a little bent at the elbow
  const HOLD = ['CCC     ', 'CCCC    ', 'kCCCC   ', 'kCCCC   ', ' kCCCC  ', ' kCCCC  ', ' kCCCCk ', 'kCCCCCk ', 'CCCCCk  ', 'ccck    '];
  if (pose === 'idle') { stamp(g, 36, 5, LA); stamp(g, 36, 28, RA); }
  if (pose === 'mug') {
    stamp(g, 36, 5, LA); stamp(g, 36, 28, HOLD);
    stamp(g, 37, 24, [' kkkkkkk  ', 'kwwwwwwwk ', 'kwwwwwwwkkk', 'kppppppwk k', 'kppppppwk k', 'kwwwwwwwkkk', 'kwwwwwwwk ', ' kwwwwwk  ', '  kkkkk   ']);
    stamp(g, 41, 22, ['sss', 'sSs', 'SSS']);
    stamp(g, 34, 26, [' L  ', '  L ', ' L  ']);                                       // steam
  }
  if (pose === 'crossed') {
    // an X: each forearm rises from its elbow to the opposite upper arm; the right one passes under, the left one over
    const band = (r0, c0, r1, c1, th, fill, top) => {
      const cells = new Set(), K = (r, c) => r * 100 + c;
      for (let r = Math.floor(Math.min(r0, r1)) - 5; r <= Math.ceil(Math.max(r0, r1)) + 5; r++) for (let c = Math.floor(Math.min(c0, c1)) - 5; c <= Math.ceil(Math.max(c0, c1)) + 5; c++) {
        const dx = c1 - c0, dy = r1 - r0, t = Math.max(0, Math.min(1, ((c - c0) * dx + (r - r0) * dy) / (dx * dx + dy * dy)));
        if (Math.hypot(c - (c0 + t * dx), r - (r0 + t * dy)) <= th / 2) cells.add(K(r, c));
      }
      for (const k of cells) {
        const r = Math.floor(k / 100), c = k % 100, edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !cells.has(K(r + a, c + b)));
        put(g, r, c, edge ? 'k' : top && !cells.has(K(r - 2, c)) ? top : fill);
      }
    };
    // upper arms first; both forearms cross in front of them, each hand wrapping the outside of the other arm
    for (let r = 36; r <= 44; r++) { const o = Math.min(2, Math.floor((r - 36) / 3)); row(g, r, 9 - o, 12, 'C'); put(g, r, 13, 'k'); }    // left upper arm
    for (let r = 36; r <= 44; r++) { const o = Math.min(2, Math.floor((r - 36) / 3)); row(g, r, 31, 34 + o, 'C'); put(g, r, 30, 'k'); }   // right upper arm
    band(45, 30, 40, 12, 5, 'c');                                                            // the right forearm, under
    band(45.5, 13, 40.5, 31, 5.4, 'C', 'D');                                                 // the left forearm, over
    stamp(g, 38, 8, [' kkk ', 'ksssk', 'kSssk', 'kSSsk', ' kkk ']);                          // under hand, on the end of its forearm
    stamp(g, 38, 30, [' kkk ', 'ksssk', 'ksssk', 'ksSSk', ' kkk ']);                         // over hand
  }
  // legs + sneakers
  for (let r = 52; r <= 55; r++) { row(g, r, 15, 20, 'c'); row(g, r, 23, 28, 'c'); put(g, r, 16, 'C'); put(g, r, 24, 'C'); }
  stamp(g, 56, 13, [' wwwwwww  ', 'wwwwppwwk ', 'GGGGGGGGG ']);
  stamp(g, 56, 22, ['  wwwwwww ', ' kwwppwwww', ' GGGGGGGGG']);
}

export function build({ eyes = 'tired', mouth = 'flat', pose = 'idle', blush = false } = {}) {
  const g = grid(), b = grid();
  body(b, pose);
  for (let r = 3; r < HT; r++) for (let c = 0; c < W; c++) if (b[r][c] !== '.') g[r - 3][c] = b[r][c];   // raised: no neck
  head(g, { eyes, mouth, blush });
  const o = g.map(r => [...r]);
  for (let r = 0; r < HT; r++) for (let c = 0; c < W; c++) if (g[r][c] === '.' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dr, dc]) => { const v = get(g, r + dr, c + dc); return v && v !== '.' && v !== 'k'; })) o[r][c] = 'k';
  return o.map(r => r.join(''));
}
