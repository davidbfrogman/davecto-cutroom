// Retro Studio projects page. Plain ES module, no build.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !j.error) j.error = `HTTP ${r.status}`;
  return j;
};

let projects = [], videos = '';
const jobs = new Map();           // id -> job
let openMenu = null;              // project name with its ⋯ menu open
let confirmDel = null;            // project name awaiting delete confirm
const shown = new Set();          // names of cards that completed a frames job this session (sheet viewable)
const errMsg = new Map();         // project -> inline action error

const live = (j) => j.state === 'queued' || j.state === 'running';
const fmtLen = (s) => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function ago(ms) {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  const u = [[60, 'min'], [3600, 'hour'], [86400, 'day'], [604800, 'week'], [2592000, 'month']];
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) { const h = Math.round(s / 3600); return `${h} hour${h > 1 ? 's' : ''} ago`; }
  if (s < 604800) { const d = Math.round(s / 86400); return `${d} day${d > 1 ? 's' : ''} ago`; }
  if (s < 2592000) { const w = Math.round(s / 604800); return `${w} week${w > 1 ? 's' : ''} ago`; }
  return new Date(ms).toLocaleDateString();
}
const jobsFor = (name) => [...jobs.values()].filter((j) => j.project === name && (live(j) || j.state === 'error'));

/* ---------- card html ---------- */
function jobHtml(j) {
  const b = j.bar, pct = b ? Math.round(b.frac * 100) : 0;
  if (j.state === 'error') {
    return `<div class="job err"><div class="top"><span class="lbl msg">${esc(j.label)} failed: ${esc(j.error || 'error')}</span><button class="btn sm ghostb" data-act="dismiss" data-id="${j.id}">Dismiss</button></div>
      ${j.log?.length ? `<details><summary>Log</summary><pre>${esc(j.log.slice(-8).join('\n'))}</pre></details>` : ''}</div>`;
  }
  const q = j.state === 'queued';
  return `<div class="job"><div class="top"><span class="lbl">${esc(j.label)}${q ? ` · queued (${j.queued ?? 0} ahead)` : ''}</span>
      <button class="btn sm" data-act="cancel" data-id="${j.id}">Cancel</button></div>
    <div class="bar ${b || q ? '' : 'ind'}"><i style="width:${pct}%"></i></div>
    ${b ? `<div class="note">${esc([b.label, b.note].filter(Boolean).join(' · '))}</div>` : ''}</div>`;
}

function badges(c) {
  const out = [];
  if (c.videoMissing) out.push('<span class="badge">video missing</span>');
  if (!c.words) out.push('<span class="badge">no transcript</span>');
  if (!c.faces) out.push('<span class="badge">no faces</span>');
  if (c.lint) out.push(`<span class="badge ok ${c.lint.stale ? 'old' : ''}">${c.lint.count ? `lint: ${c.lint.count} issue${c.lint.count > 1 ? 's' : ''}` : 'lint ok'}${c.lint.stale ? ' (old)' : ''}</span>`);
  for (const k of ['draft', 'final']) {
    if (c[k]) out.push(`<span class="chip">${k}</span>${c[k].stale ? '<span class="badge">render out of date</span>' : ''}`);
  }
  return out.join('');
}

function cardHtml(c) {
  const js = jobsFor(c.name), busy = js.some(live);
  const open = `/p/${enc(c.name)}/`;
  const hasSheet = c.sheet || shown.has(c.name);
  const renders = ['draft', 'final'].filter((k) => c[k]);
  const jb = (kind, label, extra = '') => `<button class="btn sm" data-act="job" data-kind="${kind}" ${extra} ${busy ? 'disabled' : ''}>${label}</button>`;
  const meta = [`<span>${esc(c.videoName || '')}</span>`,
    `<span class="sep">${c.beats === c.on ? `${c.beats} beats` : `${c.on} of ${c.beats} on`}</span>`,
    c.edited ? `<span class="sep">${esc(ago(c.edited))}</span>` : ''].join('');
  return `
    <a class="thumb" href="${open}" title="Open editor">
      ${c.error ? '<div class="nothumb">error</div>' : `<img src="/p/${enc(c.name)}/thumb.jpg" alt="" loading="lazy" onerror="this.style.display='none'">`}
      ${c.length ? `<span class="len num">${fmtLen(c.length)}</span>` : ''}
    </a>
    <div class="body">
      <div class="name" title="${esc(c.dir)}">${esc(c.name)}</div>
      ${c.error ? `<div class="badge">${esc(c.error)}</div>` : `<div class="meta">${meta}</div><div class="badges">${badges(c)}</div>`}
      ${js.map(jobHtml).join('')}
      ${errMsg.has(c.name) ? `<div class="badge">${esc(errMsg.get(c.name))}</div>` : ''}
      ${confirmDel === c.name ? `<div class="confirm"><div>Delete <b>${esc(c.name)}</b>? The folder goes to the Trash. The source video is kept.</div>
        <div class="row"><button class="btn sm danger" data-act="delete-yes">Move to Trash</button><button class="btn sm" data-act="delete-no">Cancel</button></div></div>` : ''}
      <div class="actions">
        <a class="btn sm pri" href="${open}" style="text-decoration:none">Open editor</a>
        ${jb('lint', 'Lint')}
        ${hasSheet ? `<button class="btn sm" data-act="sheet">View sheet</button>` : ''}
        ${jb('frames', hasSheet ? 'Redo sheet' : 'Contact sheet')}
        ${jb('render', 'Render draft', 'data-draft="1"')}
        ${jb('render', 'Render final')}
        ${renders.length ? `<button class="btn sm" data-act="play">Play</button>` : ''}
        <button class="btn sm ghostb more" data-act="menu" title="More">⋯</button>
        ${openMenu === c.name ? `<div class="menu">
          <button class="btn sm" data-act="job" data-kind="transcribe" ${busy ? 'disabled' : ''}>Re-transcribe</button>
          <button class="btn sm" data-act="reveal">Reveal in Finder</button>
          <button class="btn sm danger" data-act="delete" ${busy ? 'disabled' : ''}>Delete…</button></div>` : ''}
      </div>
    </div>`;
}

function placeholderHtml(j) {
  return `<div class="thumb" style="cursor:default"><div class="nothumb">new project</div></div>
    <div class="body"><div class="name">${esc(j.project || 'New project')}</div>${j.state === 'error' ? '' : ''}${jobHtml(j)}</div>`;
}

/* ---------- render: keep each card's element, only rewrite when its html changes ---------- */
function render() {
  const grid = $('#grid'), want = [];
  const names = new Set(projects.map((p) => p.name));
  for (const j of jobs.values()) if (j.kind === 'new' && (live(j) || j.state === 'error') && !names.has(j.project)) want.push({ key: `new:${j.id}`, html: placeholderHtml(j), ph: true });
  for (const c of projects) want.push({ key: c.name, html: cardHtml(c), name: c.name });
  const have = new Map([...grid.children].map((e) => [e.dataset.key, e]));
  let prev = null;
  for (const w of want) {
    let el = have.get(w.key);
    if (!el) { el = document.createElement('div'); el.dataset.key = w.key; el.className = 'card' + (w.ph ? ' ph' : ''); if (w.name) el.dataset.name = w.name; }
    have.delete(w.key);
    if (el._html !== w.html) { el.innerHTML = w.html; el._html = w.html; }
    const target = prev ? prev.nextSibling : grid.firstChild;
    if (target !== el) grid.insertBefore(el, target);
    prev = el;
  }
  for (const el of have.values()) el.remove();
  $('#empty').hidden = want.length > 0;
  const active = [...jobs.values()].filter(live);
  $('#status').textContent = `${projects.length} project${projects.length === 1 ? '' : 's'}${videos ? ` in ${videos}` : ''}${active.length ? ` · ${active.length} job${active.length > 1 ? 's' : ''} running` : ''}`;
  $('#jobsStrip').innerHTML = active.slice(0, 4).map((j) => `<span class="jchip">${esc(j.project || '')} · ${esc(j.label)}${j.bar ? ` ${Math.round(j.bar.frac * 100)}%` : ''}</span>`).join('');
}

async function refresh() {
  try { const r = await (await fetch('/api/projects')).json(); projects = r.projects || []; videos = r.videos || ''; } catch { /* server gone */ }
  render();
}

/* ---------- events ---------- */
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', (e) => { jobs.clear(); for (const j of JSON.parse(e.data).jobs) jobs.set(String(j.id), j); render(); });
  es.addEventListener('job', (e) => {
    const j = JSON.parse(e.data), old = jobs.get(String(j.id));
    jobs.set(String(j.id), j);
    if (j.state === 'done' && old?.state !== 'done') {
      if (j.kind === 'frames') shown.add(j.project);
      refresh();
    }
    render();
  });
  es.addEventListener('projects', () => refresh());
}

/* ---------- actions ---------- */
function modal(inner) {
  const m = $('#modal');
  m.innerHTML = inner;
  m.hidden = false;
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); openMenu = null; confirmDel = null; render(); } });

function playModal(c, kind) {
  const f = c[kind]; if (!f) return;
  const others = ['draft', 'final'].filter((k) => c[k]);
  const url = `/p/${enc(c.name)}/out/${enc(f.file)}?t=${f.at || ''}`;
  modal(`<div class="mbar"><span>${esc(c.name)}</span>${others.map((k) => `<button class="btn sm ${k === kind ? 'pri' : ''}" data-switch="${k}">${k}</button>`).join('')}<button class="btn sm" data-close>Close</button></div>
    <video src="${url}" controls autoplay playsinline></video>`);
  $('#modal').querySelectorAll('[data-switch]').forEach((b) => b.onclick = () => playModal(c, b.dataset.switch));
}

$('#grid').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const card = b.closest('.card'), name = card.dataset.name, c = projects.find((p) => p.name === name);
  const act = b.dataset.act;
  errMsg.delete(name);
  if (act === 'menu') { openMenu = openMenu === name ? null : name; return render(); }
  openMenu = null;
  if (act === 'cancel') { await post(`/api/jobs/${b.dataset.id}/cancel`); return; }
  if (act === 'dismiss') { jobs.delete(b.dataset.id); fetch(`/api/jobs/${b.dataset.id}/dismiss`, { method: 'POST' }); return render(); }
  if (act === 'job') {
    const r = await post('/api/jobs', { kind: b.dataset.kind, project: name, draft: !!b.dataset.draft });
    if (r.error) { errMsg.set(name, r.error); render(); } else if (r.id != null) { jobs.set(String(r.id), r); render(); }
    return;
  }
  if (act === 'sheet') return modal(`<div class="mbar"><span>${esc(name)} · contact sheet</span><button class="btn sm" data-close>Close</button></div><img src="/p/${enc(name)}/out/check-all.jpg?t=${c?.sheet || Date.now()}" alt="contact sheet">`);
  if (act === 'play') { const k = c.draft ? 'draft' : 'final'; return playModal(c, k); }
  if (act === 'reveal') { await post('/api/reveal', { project: name }); return render(); }
  if (act === 'delete') { confirmDel = name; return render(); }
  if (act === 'delete-no') { confirmDel = null; return render(); }
  if (act === 'delete-yes') {
    const r = await post('/api/trash', { project: name });
    confirmDel = null;
    if (r.error) errMsg.set(name, r.error);
    await refresh();
  }
});
document.addEventListener('click', (e) => { if (openMenu && !e.target.closest('.more, .menu')) { openMenu = null; render(); } });

/* add video */
const addForm = $('#addForm');
function addErr(t) { const el = $('#addErr'); el.textContent = t || ''; el.hidden = !t; }
$('#addBtn').onclick = () => { addForm.hidden = !addForm.hidden; $('#addBtn').hidden = !addForm.hidden; if (!addForm.hidden) $('#addPath').focus(); };
$('#addCancel').onclick = () => { addForm.hidden = true; $('#addBtn').hidden = false; addErr(''); };
addForm.onsubmit = async (e) => {
  e.preventDefault();
  const video = $('#addPath').value.trim(); if (!video) return;
  const r = await post('/api/projects', { video });
  if (r.error) { addErr(r.error); return; }
  addErr(''); $('#addPath').value = ''; addForm.hidden = true; $('#addBtn').hidden = false;
  if (r.id != null) jobs.set(String(r.id), r);
  render();
};

refresh();
connect();
setInterval(render, 30000);   // keep "3 min ago" fresh
