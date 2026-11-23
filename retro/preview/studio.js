// The editor inside Retro Studio: ← Projects, the Lint panel and the Render menu. Lint and render run as Studio
// jobs (the same code as `retro lint` / `retro render`); progress comes over the Studio's event stream.
// Clicking a lint issue is the one click that moves the playhead: it's an explicit "go there".
import { $, S, beats, esc, f2, state, status } from './state.js';
import { flush, whenSaved } from './api.js';
import { pick, renderAll } from './panel.js';
import { seek } from './stage.js';

const NAME = state.name, enc = encodeURIComponent;
const jobs = new Map();                                // this project's jobs, by id
let lint = null, openPanel = null;                     // 'lint' | 'render' | null
const post = (u, b) => fetch(u, { method: 'POST', body: JSON.stringify(b || {}) }).then(r => r.json()).catch(e => ({ error: e.message }));
const mine = kind => [...jobs.values()].filter(j => j.kind === kind).sort((a, b) => b.created - a.created)[0];
const live = j => j && (j.state === 'running' || j.state === 'queued');

function bar(j) {
  if (j.state === 'queued') return `<div class="sj"><span>${esc(j.label)}: waiting${j.queued ? ` (${j.queued} ahead)` : ''}…</span><button class="btn sm" data-x="${j.id}">Cancel</button></div>`;
  const b = j.bar, pct = Math.round((b?.frac || 0) * 100);
  return `<div class="sj"><span>${esc(j.label)}${b ? ` · ${esc(b.label)}` : ''}</span><button class="btn sm" data-x="${j.id}">Cancel</button></div>
    <div class="sbar"><i style="width:${pct}%"></i></div><div class="snote num">${b ? `${pct}% ${esc(b.note || '')}` : 'starting…'}</div>`;
}
const failed = j => (j?.state === 'error' ? `<p class="serr">${esc(j.label)} failed: ${esc(j.error || '')}</p>` : '');

/* ---------- lint ---------- */
async function loadLint() { lint = await fetch('api/lint').then(r => r.json()).catch(() => null); paintLintPill(); if (openPanel === 'lint') renderLint(); }
function paintLintPill() {
  const n = lint?.issues?.length, j = mine('lint');
  $('#pLint').innerHTML = `<span class="dot"></span>Lint${live(j) ? ' …' : n != null ? ` · ${n}` : ''}`;
  $('#pLint').classList.toggle('warn', !!n);
}
function renderLint() {
  const el = $('#lintPanel'), j = mine('lint');
  const list = lint?.issues || [];
  el.innerHTML = `<div class="sp-head"><h3>Lint</h3><span class="sub">${lint ? `${list.length ? `${list.length} issue${list.length > 1 ? 's' : ''}` : 'all clear'} · ${new Date(lint.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'not run yet'}</span>
      <button class="btn sm pri" data-a="runlint" ${live(j) ? 'disabled' : ''}>${lint ? 'Run again' : 'Run lint'}</button></div>
    ${live(j) ? bar(j) : failed(j)}
    ${lint && !lint.faces ? '<p class="hint">No faces.json, so only the Instagram zone was checked.</p>' : ''}
    <div class="lint-list">${list.map((i, k) => `<div class="li" data-k="${k}" title="Go to ${esc(i.beat)} at ${f2(i.t)} s">
        <span class="lk ${i.kind}">${i.kind}</span><span class="lt">${esc(i.text)}</span><span class="num lts">${f2(i.t)}</span></div>`).join('')}</div>
    ${list.length ? '<p class="hint">Click an issue to go to its beat and moment.</p>' : ''}`;
}
function goTo(i) {                                     // select the beat (and the animation, if the issue names one), then seek
  const b = beats.find(x => x.id === i.beat); if (!b) return;
  pick(b);
  S.sel = i.layer && (b.layers || []).includes(i.layer) ? { beat: b, layer: i.layer } : null;
  seek(Math.max(0, i.t + 0.01));
  renderAll();
}

/* ---------- render ---------- */
function renderRender() {
  const el = $('#renderMenu'), j = mine('render');
  const done = ['draft', 'final'].map(k => ({ k, j: [...jobs.values()].filter(x => x.kind === 'render' && !!x.draft === (k === 'draft') && x.state === 'done').sort((a, b) => b.ended - a.ended)[0] })).filter(x => x.j);
  el.innerHTML = `<div class="sp-head"><h3>Render</h3><span class="sub">with your edits, as retro render does</span></div>
    ${live(j) ? bar(j) : `<div class="rr"><button class="btn pri" data-a="render" data-draft="1">Draft</button><span class="hint">quick, lower quality</span></div>
      <div class="rr"><button class="btn" data-a="render">Final</button><span class="hint">full quality, 1440×2560</span></div>`}
    ${failed(j)}
    ${done.map(({ k, j }) => `<div class="rr"><button class="btn sm" data-a="play" data-f="${esc(j.result.file.split('/').pop())}">▶ Play ${k}</button><button class="btn sm ghostb" data-a="reveal" data-f="${esc(j.result.file.split('/').pop())}">Show in Finder</button></div>`).join('')}`;
  const r = $('#pRender');
  r.innerHTML = live(j) ? `Rendering ${Math.round((j.bar?.frac || 0) * 100)}%` : 'Render…';
  r.classList.toggle('on', live(j));
}
function play(file) {
  const m = document.createElement('div'); m.id = 'playModal';
  m.innerHTML = `<div class="pm"><div class="sp-head"><h3>${esc(file)}</h3><button class="btn sm" data-a="close">Close</button></div><video src="out/${enc(file)}?t=${Date.now()}" controls autoplay playsinline></video></div>`;
  m.addEventListener('click', e => { if (e.target === m || e.target.dataset.a === 'close') m.remove(); });
  document.body.append(m);
}

/* ---------- panels ---------- */
function toggle(which) {
  openPanel = openPanel === which ? null : which;
  for (const [k, id, btn] of [['lint', '#lintPanel', '#pLint'], ['render', '#renderMenu', '#pRender']]) {
    const el = $(id); el.style.display = openPanel === k ? 'block' : 'none';
    if (openPanel === k) { const r = $(btn).getBoundingClientRect(); el.style.left = Math.max(10, Math.min(innerWidth - el.offsetWidth - 10, r.right - el.offsetWidth)) + 'px'; }
  }
  if (openPanel === 'lint') renderLint(); else if (openPanel === 'render') renderRender();
}
async function act(e) {
  const x = e.target.closest('[data-x]'); if (x) { await post(`/api/jobs/${x.dataset.x}/cancel`); return; }
  const it = e.target.closest('.li'); if (it) { goTo(lint.issues[+it.dataset.k]); return; }
  const a = e.target.closest('[data-a]')?.dataset; if (!a) return;
  if (a.a === 'runlint' || a.a === 'render') {
    await flush(); await whenSaved();                  // the job reads retro.json: let the edits land first
    const j = await post('/api/jobs', { kind: a.a === 'runlint' ? 'lint' : 'render', project: NAME, draft: !!a.draft });
    if (j.error) status(j.error); else { jobs.set(j.id, j); openPanel === 'lint' ? renderLint() : renderRender(); paintLintPill(); }
  } else if (a.a === 'play') play(a.f);
  else if (a.a === 'reveal') post('/api/reveal', { project: NAME, file: a.f });
}

export function initStudio() {
  if (!NAME) return;                                   // not served by the Studio
  $('#projName').textContent = NAME;
  document.title = `${NAME} · Retro Studio`;
  $('#pLint').onclick = () => toggle('lint');
  $('#pRender').onclick = () => toggle('render');
  $('#lintPanel').addEventListener('click', act);
  $('#renderMenu').addEventListener('click', act);
  addEventListener('pointerdown', e => { if (openPanel && !e.target.closest('#lintPanel, #renderMenu, #pLint, #pRender, #playModal')) toggle(openPanel); }, true);
  const es = new EventSource('/api/events');
  const got = j => {
    if (j.project !== NAME) return;
    const was = jobs.get(j.id); jobs.set(j.id, j);
    if (j.state === 'done' && was?.state !== 'done') {
      if (j.kind === 'lint' || j.kind === 'render') loadLint();
      if (j.kind === 'render') status(`Rendered ${j.result?.file?.split('/').pop() || ''}`);
    }
    paintLintPill(); renderRender();
    if (openPanel === 'lint') renderLint();
  };
  es.addEventListener('hello', e => { for (const j of JSON.parse(e.data).jobs) got(j); });
  es.addEventListener('job', e => got(JSON.parse(e.data)));
  loadLint(); renderRender();
}
