// The Instagram Reels UI on an iPhone, drawn over the stage (the header's "Instagram UI" toggle). A guide only:
// never rendered or linted (the lint has its own Instagram zone).
// Measured from iPhone screenshots (1320×2868 px, Nov 2026): the UI from a Reels feed screenshot, the video's size
// and crop from one of this project's reels (a window known to sit at x 9–91u). Instagram top-aligns the reel and
// scales it to 2613 px tall (the bottom 255 px, under the tab bar, is outside the video), so the 9:16 frame is
// 1470 px wide on a 1320 px screen: the phone shows x 5.1–94.9u (shaded outside), and the tab bar never covers it.
// Positions are in p = 1% of the phone screen's width (the screen is 217.2p tall; the video ends at 198p), centre points.
import { $, state } from './state.js';

const SCREEN = 100 * 1320 / (2613 * 9 / 16);          // screen width in u (89.8)
const icon = (d, w = 5.6, fill = false, sw = 2) =>
  `<svg viewBox="0 0 24 24" style="width:calc(var(--p)*${w});height:calc(var(--p)*${w})" fill="${fill ? '#fff' : 'none'}" stroke="#fff" stroke-width="${fill ? 0 : sw}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const P = {
  heart: '<path d="M12 20.2s-7.6-4.5-9.4-9.1C1.3 7.8 3.3 4.4 6.9 4.4c2.1 0 3.7 1.2 5.1 3 1.4-1.8 3-3 5.1-3 3.6 0 5.6 3.4 4.3 6.7-1.8 4.6-9.4 9.1-9.4 9.1z"/>',
  comment: '<path d="M20.4 12a8.4 8.4 0 0 1-12.3 7.4L3.6 20.4l1-4.3A8.4 8.4 0 1 1 20.4 12z"/>',
  repost: '<path d="M17 2.5l3 3-3 3M4 11V9a3.5 3.5 0 0 1 3.5-3.5H20M7 21.5l-3-3 3-3M20 13v2a3.5 3.5 0 0 1-3.5 3.5H4"/>',
  share: '<path d="M21 3.5 3 9.5l7.2 3.3L13.5 20zM10.2 12.8 21 3.5"/>',
  save: '<path d="M6 3.5h12v17l-6-4.6-6 4.6z"/>',
  menu: '<path d="M4 9h16M7 15h13"/>',
};
const at = (x, y, html, cls = '') => `<div class="ig-at ${cls}" style="left:calc(var(--p)*${x});top:calc(var(--p)*${y})">${html}</div>`;

export function initIg() {
  const user = state.igUser || 'davecto';
  const right = [['heart', 108.1, '12.4K'], ['comment', 123.6, '318'], ['repost', 139.5, '96'], ['share', 155.8, '1,204'], ['save', 171.6, '120']];
  $('#ig').style.setProperty('--screen', SCREEN);
  $('#ig').innerHTML = `
    <div class="ig-crop l"></div><div class="ig-crop r"></div>
    <div class="ig-phone">
      ${at(16.3, 7.3, '<b class="ig-time">7:06</b>', 'ig-l')}
      ${at(89.3, 7.3, `<span class="ig-stat"><i class="sig"><s></s><s></s><s></s><s></s></i>${icon('<path d="M2.5 9.5a14 14 0 0 1 19 0M6 13a9 9 0 0 1 12 0M9.4 16.4a4 4 0 0 1 5.2 0"/><circle cx="12" cy="19.5" r="1" fill="#fff"/>', 4.4, false, 2.6)}<b class="bat">70</b></span>`, 'ig-rt')}
      ${right.map(([k, y, n]) => at(93.05, y, icon(P[k])) + at(93.05, y + 6.4, `<span class="ig-n">${n}</span>`)).join('')}
      ${at(93.05, 186.6, icon(P.menu, 5.2))}
      ${at(8.6, 172.3, '<span class="ig-av ring"></span>')}
      ${at(15.5, 172.3, `<span class="ig-user"><b>${user}</b><span class="ig-tick">✓</span><span class="ig-follow">Follow</span></span>`, 'ig-l')}
      ${at(3.7, 181.4, '<span class="ig-cap">Comment the keyword and I\'ll send you the guide …</span>', 'ig-l')}
      ${at(3.7, 188.6, '<span class="ig-fb"><span class="ig-av xs"></span><span class="ig-av xs"></span><span class="ig-av xs"></span>Followed by <b>someone</b> and <b>10 others</b></span>', 'ig-l')}
      <div class="ig-prog"><i></i></div>
    </div>`;
}
