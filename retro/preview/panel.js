import { $, S, beats, cut, dB, esc, f2, v } from './state.js';
import { save } from './api.js';
import { applyDepth, applyMove, cutNote, ensureCut, rebuild, seek } from './stage.js';
import { renderTimeline } from './timeline.js';
import { addSoundAt, buildSfx, buildSfxSoon, dot, openPicker, placePop, renderPop, selectSound } from './sounds.js';
import { zoomCard, zoomEvent } from './zoom.js';

/* ---------- side panel: beat list ---------- */

export function renderList() {
  const t = v.currentTime;
  $('#list').innerHTML = `<p class="sec-title">Beats</p>` + beats.map((b, i) => `
    <div class="brow ${b === S.cur ? 'sel' : ''} ${b.on === false ? 'off' : ''} ${b.ready && t >= b.start && t < b.end ? 'now' : ''}" data-i="${i}">
      <button class="sw ${b.on === false ? '' : 'on'}" data-a="on" title="Show this beat"></button>
      <span class="bname">${b.id}</span>
      ${b.time ? '<span class="badge" title="Timing changed">⏱</span>' : ''}
      ${b.hide.length ? `<span class="badge" title="${b.hide.length} animation(s) hidden">◐</span>` : ''}
      ${b.behind.length ? `<span class="badge" title="${b.behind.length} animation(s) behind you">⧉</span>` : ''}
      ${Object.keys(b.sounds.edit || {}).length || (b.sounds.add || []).length ? '<span class="badge" title="Sounds edited">♪</span>' : ''}
      ${b.sfx === false ? '<span class="badge" title="Sounds muted">mute</span>' : ''}
      ${b.zoom ? '<span class="badge" title="Zoom set for this beat">⤢</span>' : ''}
      <span class="btime num">${b.start != null ? `${f2(b.start)}–${f2(b.end)}` : '…'}</span>
    </div>`).join('');
}

export function pick(b, jump) {
  if (S.cur !== b) { S.sel = null; S.snd = null; }
  S.cur = b;
  if (jump && b.ready) seek(b.start);
  renderAll();
}

/* ---------- side panel: inspector ---------- */
export const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
export const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7c1.9 0 3.6-.6 5-1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
export function renderInspector() {
  const b = S.cur, el = $('#insp');
  const scroll = el.scrollTop;
  if (!b || b.start == null) { el.innerHTML = `<p class="empty">Pick a beat in the list or on the timeline.</p>`; return; }
  const busy = !b.ready || b.loading, dis = !b.ready ? 'disabled' : '';
  const layers = b.layers || [];
  const r = b.time?.retime, speed = r ? (b.src.end - b.src.start) / (r[1] - r[0]) : 1;
  const allMoved = (b.move['*'] || [0, 0]).some(Boolean);
  const cues = [...(b.cuesAll || [])].sort((x, y) => x.t - y.t), gain = b.sfxGain || 0;
  el.innerHTML = `
    <div class="ihead">
      <div><h2>${b.id}</h2><div class="sub num">${f2(b.start)}–${f2(b.end)} s · ${b.cues ? b.cues.length : 0} sounds</div></div>
      <button class="btn sm jump" data-a="jump">Jump to start</button>
    </div>
    <div class="card">
      <div class="line"><span class="lab grow">Show this beat</span><button class="sw ${b.on === false ? '' : 'on'}" data-a="on"></button></div>
      <div class="line"><span class="lab grow">Sound effects</span><button class="sw ${b.sfx === false ? '' : 'on'}" data-a="sfx"></button></div>
    </div>

    <p class="sec-title">Animations</p>
    <div class="card" style="padding:6px">
      ${layers.map(L => {
        const hid = b.hide.includes(L), [dx, dy] = b.move[L] || [0, 0], isSel = S.sel && S.sel.beat === b && S.sel.layer === L;
        return `<div class="anim ${isSel ? 'sel' : ''} ${hid ? 'hid' : ''}" data-l="${L}">
          <button class="eye" data-a="eye" title="${hid ? 'Show' : 'Hide'} this animation (and its sounds)" ${dis}>${hid ? EYE_OFF : EYE}</button>
          <span class="aname">${L}</span>
          <span class="apos num">${dx || dy ? `moved ${dx}, ${dy}` : ''}${b.ltime[L] ? ' · retimed' : ''}</span>
          ${b.ltime[L] ? `<button class="btn ghostb sm" data-a="lreset" title="Put this animation back at its written time">Reset time</button>` : ''}
          <button class="depth ${b.behind.includes(L) ? 'on' : ''}" data-a="behind" title="${b.behind.includes(L) ? 'Behind you: you\'re cut out of the video and drawn over it. Click to bring it back in front.' : 'Put it behind you (you\'re cut out of the video and drawn over it)'}" ${dis || (hid ? 'disabled' : '')}>${b.behind.includes(L) ? 'Behind me' : 'In front'}</button>
          ${dx || dy ? `<button class="btn ghostb sm" data-a="unmove" title="Put it back where it was written">Reset</button>` : ''}
        </div>`;
      }).join('')}
      ${layers.length > 1 ? `<div class="anim ${S.sel && S.sel.beat === b && S.sel.layer === '*' ? 'sel' : ''}" data-l="*">
          <span style="width:26px"></span><span class="aname">All together</span>
          <span class="apos num">${allMoved ? `moved ${b.move['*'].join(', ')}` : ''}</span>
          ${allMoved ? `<button class="btn ghostb sm" data-a="unmove">Reset</button>` : ''}</div>` : ''}
      <p class="hint" style="margin:6px 8px 4px">Click one on the video (or here) to select it, then drag it or use the arrow keys. <b>In front / Behind me</b> puts it between you and the background.</p>
      ${b.behind.length && cut.state !== 'ready' ? `<p class="busy" style="margin:2px 8px 4px">${cutNote()}</p>` : ''}
    </div>

    <p class="sec-title">Sounds</p>
    <div class="card">
      <div class="line"><span class="lab">Beat level</span><input type="range" data-a="bgain" min="-18" max="6" step="0.5" value="${gain}" ${dis}>
        <span class="val num" id="bgainV">${dB(gain)}</span></div>
      <div class="slist">${cues.map(q => `
        <div class="srow ${S.snd && S.snd.beat === b && S.snd.key === q.key ? 'sel' : ''} ${q.off ? 'off' : ''}" data-k="${esc(q.key)}">
          ${dot(q.s)}<span class="num">${f2(q.t)}</span>
          <span>${esc(q.s)}${q.added ? ' <span class="badge">added</span>' : q.edited ? ' <span class="badge">edited</span>' : ''}</span>
          <span class="sv num">${q.vol ? dB(q.vol) : ''}</span>
        </div>`).join('') || '<p class="hint">No sounds in this beat.</p>'}</div>
      <div style="margin-top:10px"><button class="btn sm" data-a="sadd" ${dis} title="Add a sound to this beat at the playhead">+ Add sound at playhead</button></div>
    </div>

    ${zoomCard(b)}

    <p class="sec-title">Timing</p>
    <div class="card">
      <div class="tsum">
        <span class="chip num">Written ${f2(b.src.start)}–${f2(b.src.end)}</span>
        <span class="chip num ${b.time ? 'hl' : ''}">Showing ${f2(b.start)}–${f2(b.end)}</span>
        ${Math.abs(speed - 1) > 0.005 ? `<span class="chip hl num">${speed.toFixed(2)}× speed</span>` : ''}
        ${b.time?.crop ? '<span class="chip hl">trimmed</span>' : ''}
      </div>
      <p class="hint">Drag the beat's edges on the timeline. <b>Trim</b> cuts it shorter at normal speed; <b>Stretch</b> speeds it up or slows it down to fit (hold ⌥ while dragging for the other one). Its sounds go with it either way.</p>
      ${b.time ? `<div style="margin-top:10px"><button class="btn sm" data-a="treset" ${dis}>Reset timing</button></div>` : ''}
      ${busy ? '<p class="busy">Updating…</p>' : ''}
    </div>`;
  el.scrollTop = scroll;
}

export function renderAll() { renderList(); renderInspector(); renderTimeline(); renderPop(); }
export function initPanel() {
  $('#list').addEventListener('click', e => {
    const row = e.target.closest('.brow'); if (!row) return;
    const b = beats[+row.dataset.i];
    if (e.target.dataset.a === 'on') { b.on = b.on === false; save(b, { on: b.on }); buildSfx(); renderAll(); return; }
    pick(b);
  });
  $('#insp').addEventListener('scroll', placePop);
  $('#insp').addEventListener('click', e => {
    const btn = e.target.closest('[data-a]'), a = btn?.dataset.a, row = e.target.closest('.anim'), srow = e.target.closest('.srow');
    const b = S.cur; if (!b) return;
    if (e.target.closest('.zoomc') && zoomEvent(e, b, renderAll)) return;
    if (srow) { selectSound(b, srow.dataset.k); renderAll(); return; }
    if (a === 'sadd') { openPicker(btn, { title: `at ${f2(v.currentTime)} s`, onPick: n => addSoundAt(v.currentTime, n) }); return; }
    if (a === 'jump') { if (b.ready) seek(b.start); return; }
    if (a === 'on') { b.on = b.on === false; save(b, { on: b.on }); buildSfx(); renderAll(); return; }
    if (a === 'sfx') { b.sfx = b.sfx === false ? undefined : false; save(b, { sfx: b.sfx !== false }); buildSfx(); renderAll(); return; }
    if (a === 'eye' && row) {
      const L = row.dataset.l;
      b.hide = b.hide.includes(L) ? b.hide.filter(x => x !== L) : [...b.hide, L];
      if (S.sel && S.sel.layer === L && b.hide.includes(L)) S.sel = null;
      save(b, { hide: b.hide }); rebuild(b); return;
    }
    if (a === 'lreset' && row) { delete b.ltime[row.dataset.l]; save(b, { ltime: b.ltime }); rebuild(b); return; }
    if (a === 'behind' && row) {
      const L = row.dataset.l;
      b.behind = b.behind.includes(L) ? b.behind.filter(x => x !== L) : [...b.behind, L];
      save(b, { behind: b.behind }); applyDepth(b); ensureCut(); renderAll(); return;
    }
    if (a === 'unmove' && row) { delete b.move[row.dataset.l]; applyMove(b); save(b, { move: b.move }); renderAll(); return; }
    if (a === 'treset') { delete b.time; save(b, { time: null }); rebuild(b); return; }
    if (row && !btn) {                                 // select an animation to move it
      const L = row.dataset.l;
      S.sel = S.sel && S.sel.beat === b && S.sel.layer === L ? null : { beat: b, layer: L };
      renderAll();
    }
  });
  $('#insp').addEventListener('input', e => {
    if (e.target.closest('.zoomc') && zoomEvent(e, S.cur, renderAll)) return;
    if (e.target.dataset.a === 'bgain' && S.cur) { $('#bgainV').textContent = dB(+e.target.value); S.cur.sfxGain = +e.target.value; buildSfxSoon(); }
  });
  $('#insp').addEventListener('change', e => {
    if (e.target.closest('.zoomc') && zoomEvent(e, S.cur, renderAll)) return;
    if (e.target.dataset.a === 'bgain' && S.cur) { save(S.cur, { sfxGain: S.cur.sfxGain }); renderInspector(); }
  });
}
