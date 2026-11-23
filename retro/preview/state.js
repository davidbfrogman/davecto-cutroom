// Shared by every module: the page's DOM handles, the server's state, the beats, and S, the one object
// that holds what several modules reassign (ES module imports are read-only, so a shared `let` lives here).
export const $ = s => document.querySelector(s);
export const v = $('#v'), stage = $('#stage'), grab = $('#grab'), zone = $('#zone'), selBox = $('#selBox');
export const tlScroll = $('#tlScroll'), tlInner = $('#tlInner'), pop = $('#sndPop');
export const state = await (await fetch('api/state')).json();
export const [W, H] = state.size, DUR = state.duration, FH = 100 * H / W;      // frame height in u
export const cut = { state: 'none', progress: 0, on: false, gl: null, canvas: null };   // the speaker cutout (see "behind me")

export const beats = state.beats.map(b => ({ ...b, move: b.move || {}, ltime: b.ltime || {}, hide: b.hide || [], behind: b.behind || [], sounds: b.sounds || { edit: {}, add: [] }, ready: false }));
export const S = {
  cur: null,                     // the beat in the inspector
  sel: null,                     // { beat, layer } being moved
  snd: null,                     // { beat, key } the selected sound
  msel: new Map(),               // several sounds selected (box or shift-click): 'beatIndex|key' → { beat, key }
  bulk: null,                    // the bulk volume move in progress: { delta, base: Map(id → level) }
  tool: localStorage.getItem('retro.tool') || 'trim',
  zoom: 1,                       // timeline zoom: 1 = the whole video fits
  lastNow: null,                 // which beats were last marked "playing now"
  picker: null,                  // the open sound picker, if any
  undoNote: -1e9,                // when undo/redo last said something (so "Saved" doesn't talk over it)
};
const pref = (k, d) => (localStorage.getItem('retro.' + k) ?? d) === '1';
export const opts = { sfx: pref('sfx', '1'), zone: pref('zone', '0'), snapV: pref('snapV', '0'), snapH: pref('snapH', '0') };

let statusT = null;
export const status = s => { $('#status').textContent = s; $('#status').style.opacity = 1; clearTimeout(statusT); statusT = setTimeout(() => { $('#status').style.opacity = 0; }, 2500); };
export const f2 = n => n.toFixed(2);
export const r1 = n => Math.round(n * 10) / 10, r2 = n => Math.round(n * 100) / 100, r3 = n => Math.round(n * 1000) / 1000;
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const dB = n => `${n > 0 ? '+' : ''}${n.toFixed(1)} dB`;
export function alarm(msg) {
  let el = $('#alarm');
  if (!el) { el = document.createElement('div'); el.id = 'alarm'; document.body.append(el); }
  el.innerHTML = `<span>⚠ ${esc(msg)}</span><button class="btn sm" onclick="this.parentNode.remove()">OK</button>`;
}
