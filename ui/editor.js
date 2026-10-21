/*
  The editor: storyboard on the left, preview and inspector on the right.

  Everything you change edits project.storyboard / project.settings in memory,
  rebuilds the timeline (the same function the renderer uses), refreshes the
  preview, and autosaves. Undo/redo keeps whole snapshots; storyboards are small.

  Words:   click to cut or restore · shift-click for a range · ⌥-click to split the shot
  Keys:    space play · ↑↓ shot · ⌫ switch shot on/off · ⌘Z undo · ⇧⌘Z redo

  Working with Claude: notes on shots (or the whole video) are threads in the
  project file. "Send to Claude" hands them to a waiting Claude Code session
  (cutroom/mcp.mjs). Claude's edits arrive over /events, get highlighted, and
  are one undo step each. Saves carry the rev they started from, so an edit
  never silently overwrites one Claude made a moment earlier.
*/
import { h, clear, debounce, toast, menu, uid } from './dom.js';
import { api, follow, frameUrl } from './api.js';
import { Player } from './player.js';
import { buildTimeline, clock, keptWords } from '/shared/timeline.mjs';
import { shotFraming, cropRect } from '/shared/framing.mjs';
import { diffShots } from '/shared/ops.mjs';
import { joinWords } from '/shared/text.mjs';
import { pickBrand, resolveBrand } from '/shared/brand.mjs';

const TRANSITIONS = [
  ['cut', 'Cut'], ['fade', 'Crossfade'], ['fadeblack', 'Dip to black'], ['dissolve', 'Dissolve'],
  ['smoothleft', 'Push'], ['slideleft', 'Slide'], ['wipeleft', 'Wipe'], ['zoomin', 'Zoom'], ['circleopen', 'Iris'], ['hblur', 'Blur'], ['fadewhite', 'Dip to white'],
];
const TNAME = Object.fromEntries(TRANSITIONS);
const GRAPHICS = [
  ['headline', 'Headline', { text: 'Your hook line.' }],
  ['lowerThird', 'Lower third', { text: 'Your Name', sub: 'What you do' }],
  ['chapter', 'Chapter', { eyebrow: '01', text: 'Chapter title' }],
  ['stat', 'Stat', { text: '70%', sub: 'what the number means' }],
  ['keyword', 'Keyword', { text: 'Ship it.' }],
  ['quote', 'Quote', { text: 'A line worth repeating.', sub: '' }],
  ['cta', 'Call to action', { text: 'Comment LAB.', sub: 'For the full playbook', keyword: 'LAB' }],
];
const GNAME = { ...Object.fromEntries(GRAPHICS.map(g => [g[0], g[1]])), motion: 'Animation' };
const NOTE_STATUS = { draft: 'Not sent yet', sent: 'Sent to Claude', working: 'Claude is on it', question: 'Claude has a question', done: 'Done' };
const CLAUDE_STATE = {
  listening: ['Claude is listening', 'Claude Code is waiting for your notes.'],
  working: ['Claude is working', 'Claude Code is working on your notes.'],
  idle: ['Claude connected', 'Claude Code was here a moment ago. Ask it to wait for notes.'],
  away: ['Claude not connected', 'In Claude Code, ask: "work on my Cutroom video". It will wait for the notes you send.'],
};
const FIELDS = { headline: ['text'], lowerThird: ['text', 'sub'], chapter: ['eyebrow', 'text'], stat: ['text', 'sub'], keyword: ['text'], quote: ['text', 'sub'], cta: ['text', 'sub', 'keyword'] };
const FIELD_LABEL = { text: 'Text', sub: 'Second line', eyebrow: 'Eyebrow', keyword: 'Keyword' };
const MODELS = [['small.en', 'Small (English, fast)'], ['medium.en', 'Medium (English)'], ['large-v3-turbo', 'Large v3 Turbo (best)'], ['small', 'Small (any language)'], ['large-v3', 'Large v3 (any language, slow)']];

export async function mountEditor(root, id) {
  const S = { id, sel: null, history: [], future: [], anchor: null, thumbs: new Map(), rows: new Map(), wordEls: new Map(), client: uid('c'), motionCache: new Map(), remote: new Map(), claude: { state: 'away', drafts: 0 } };
  const loaded = await api.project(id);
  S.project = { ...loaded.project, dir: loaded.dir };

  if (!S.project.storyboard || loaded.job?.status === 'running' && loaded.job.type === 'ingest') {
    return waitForIngest(root, S, loaded);
  }
  S.analysis = await api.analysis(id);
  S.words = S.analysis.words;
  S.luts = await api.luts().catch(() => []);
  S.library = await api.library(id).catch(() => ({ broll: [], music: [] }));
  S.fonts = await api.fonts().catch(() => ({ fonts: [], dir: '' }));
  S.motions = (await api.motions(id).catch(() => ({ motions: [] }))).motions;
  S.rev = S.project.rev || 0;

  /* ---------- layout ---------- */
  const nameIn = h('input.name', { type: 'text', value: S.project.name, 'aria-label': 'Project name', onchange: e => commit(p => { p.name = e.target.value; }) });
  const durEl = h('span.meta');
  const saveEl = h('span.meta.savestate');
  const undoBtn = h('button.btn.ghost.sm', { title: 'Undo (⌘Z)', onclick: () => undo() }, 'Undo');
  const redoBtn = h('button.btn.ghost.sm', { title: 'Redo (⇧⌘Z)', onclick: () => redo() }, 'Redo');
  const claudeEl = h('span.claude', { title: '' });
  const sendBtn = h('button.btn', { onclick: () => sendToClaude(), title: 'Hand your notes to Claude Code' }, 'Send to Claude');
  const head = h('header.ed-head',
    h('a.link', { href: '#/' }, '← Projects'),
    nameIn, durEl, saveEl, undoBtn, redoBtn, claudeEl, sendBtn,
    h('button.btn', { onclick: () => openSettings() }, 'Settings'),
    h('button.btn.primary', { onclick: () => openRender() }, 'Render'));
  const sbEl = h('div.sb');
  const main = h('main.ed-main', sbEl);
  const pvEl = h('section.pv');
  const inspEl = h('div.insp');
  const side = h('aside.ed-side', pvEl, inspEl);
  clear(root).append(h('div.ed', head, h('div.ed-body', main, side)));

  /* ---------- preview ---------- */
  const timeEl = h('span.t', '0:00.0');
  const playIcon = () => h('span', { innerHTML: S.player?.playing ? '<svg viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10"/><rect x="7" y="1" width="3" height="10"/></svg>' : '<svg viewBox="0 0 12 12"><path d="M2 1l9 5-9 5z"/></svg>' });
  const playBtn = h('button.play', { title: 'Play (space)', onclick: () => S.player.toggle() });
  const scrub = h('div.scrub');
  S.player = new Player({
    proxyUrl: `/api/projects/${id}/proxy.mp4`,
    onTime: t => onTime(t),
    onState: () => { clear(playBtn).append(playIcon()); },
  });
  playBtn.append(playIcon());
  pvEl.append(S.player.el, h('div.pv-bar', playBtn, timeEl, h('span.grow'), h('span.meta', 'Space to play')), scrub);
  scrub.addEventListener('pointerdown', e => {
    const seekTo = ev => { const r = scrub.getBoundingClientRect(); S.player.seek(((ev.clientX - r.left) / r.width) * S.tl.duration); };
    seekTo(e);
    scrub.setPointerCapture(e.pointerId);
    const move = ev => seekTo(ev);
    scrub.addEventListener('pointermove', move);
    scrub.addEventListener('pointerup', () => scrub.removeEventListener('pointermove', move), { once: true });
  });

  /* ---------- state changes ---------- */
  const snapshot = () => JSON.stringify({ name: S.project.name, settings: S.project.settings, storyboard: S.project.storyboard });
  const restore = snap => { const s = JSON.parse(snap); Object.assign(S.project, s); nameIn.value = s.name; refresh(); save(); };
  function commit(fn, { quiet } = {}) {
    S.history.push(snapshot());
    if (S.history.length > 150) S.history.shift();
    S.future = [];
    fn(S.project);
    if (!quiet) refresh();
    save();
  }
  function undo() { if (!S.history.length) return; S.future.push(snapshot()); restore(S.history.pop()); }
  function redo() { if (!S.future.length) return; S.history.push(snapshot()); restore(S.future.pop()); }

  const saveNow = async () => {
    saveEl.textContent = 'Saving…';
    try {
      const r = await api.saveRev(id, { name: S.project.name, settings: S.project.settings, storyboard: S.project.storyboard, rev: S.rev, client: S.client });
      if (r.status === 409) { adopt(r.project, 'Claude changed the edit while you were working; your last change was not saved.'); return; }
      if (!r.ok) throw new Error(r.error || 'Save failed');
      S.rev = r.rev;
      saveEl.textContent = 'Saved';
    } catch (e) { saveEl.textContent = 'Not saved'; toast(e.message); }
  };
  const save = debounce(saveNow, 600);
  saveEl.textContent = 'Saved';

  /** Take someone else's version (Claude's edit): one undo step, changed shots highlighted. */
  function adopt(p, message) {
    const changed = diffShots(S.project.storyboard, p.storyboard);
    S.history.push(snapshot());
    S.future = [];
    Object.assign(S.project, { name: p.name, settings: p.settings, storyboard: p.storyboard, threads: p.threads || [], rev: p.rev });
    S.rev = p.rev || 0;
    nameIn.value = p.name;
    if (S.sel && !shotById(S.sel)) S.sel = null;
    refresh();
    // Claude may have written a new animation since the list was loaded.
    const known = new Set(S.motions.map(m => m.name));
    const used = shots().flatMap(sh => [...(sh.overlays || []).map(o => o.type === 'motion' && o.name), sh.transition?.stinger?.name, sh.card?.motion?.name]);
    if (used.some(n => n && !known.has(n))) api.motions(id).then(r => { S.motions = r.motions; renderStoryboard(); renderInspector(); }).catch(() => {});
    // Highlight what changed for a few seconds (survives re-renders of the storyboard).
    const until = Date.now() + 5000;
    for (const sid of changed) { S.remote.set(sid, until); S.rows.get(sid)?.classList.add('remote'); }
    setTimeout(() => { for (const [sid, t] of S.remote) if (t <= Date.now()) { S.remote.delete(sid); S.rows.get(sid)?.classList.remove('remote'); } }, 5100);
    saveEl.textContent = 'Saved';
    toast(message || `Claude updated ${changed.length ? `${changed.length} shot${changed.length > 1 ? 's' : ''}` : 'the edit'}. Undo puts it back.`, 3500);
  }

  // Live updates from the server: Claude's edits, notes, and whether Claude is listening.
  const events = new EventSource(`/api/projects/${id}/events`);
  events.onmessage = async ev => {
    if (!root.isConnected) { events.close(); return; }
    const e = JSON.parse(ev.data);
    if (e.claude || e.type === 'claude') showClaude(e.claude || e);
    if (e.type === 'changed' && e.by !== S.client && e.rev > S.rev) {
      if (save.pending()) await save.flush();     // a local edit in flight: its save gets the 409 and adopts
      const { project } = await api.project(id);
      if ((project.rev || 0) > S.rev) adopt(project, e.by === 'claude' ? null : 'The edit changed in another window.');
    }
    if (e.type === 'threads') {
      S.project.threads = e.threads;
      renderStoryboard();
      // Don't wipe a note you're halfway through typing.
      if (!inspEl.contains(document.activeElement) || document.activeElement.tagName !== 'TEXTAREA' || !document.activeElement.value) renderInspector();
      else renderThreadsInPlace();
    }
  };

  function showClaude(c) {
    S.claude = c;
    const [label, tip] = CLAUDE_STATE[c.state] || CLAUDE_STATE.away;
    claudeEl.className = `claude ${c.state}`;
    claudeEl.title = tip;
    claudeEl.textContent = label;
    const drafts = (S.project.threads || []).filter(t => t.status === 'draft').length;
    sendBtn.textContent = drafts ? `Send to Claude (${drafts})` : 'Send to Claude';
    sendBtn.disabled = !drafts;
    sendBtn.classList.toggle('primary', drafts > 0);
  }

  async function sendToClaude() {
    try {
      const r = await api.sendNotes(id);
      toast(['listening', 'working'].includes(S.claude.state) ? `Sent ${r.sent} note${r.sent === 1 ? '' : 's'} to Claude.` : `Sent ${r.sent} note${r.sent === 1 ? '' : 's'}. Claude picks them up when it next waits for notes.`, 3500);
    } catch (e) { toast(e.message); }
  }

  /* Animations: render (cached on the server) the first time the preview needs one. */
  const brandOf = () => ({ theme: S.project.settings.theme, brand: S.project.settings.brand });
  const motionKey = o => JSON.stringify([o.props.name, o.props.vars || {}, S.tl.width, S.tl.height, brandOf()]);
  function motionUrl(o) {
    const key = motionKey(o);
    const hit = S.motionCache.get(key);
    if (hit?.url) { syncMotionDur(o, hit.duration); return hit.url; }
    if (!hit) {
      S.motionCache.set(key, { pending: true });
      toast(`Rendering animation “${o.props.name}”…`, 2500);
      api.renderMotion(id, { name: o.props.name, vars: o.props.vars || {}, brand: brandOf() })
        .then(r => { S.motionCache.set(key, r); syncMotionDur(o, r.duration); S.player.setTimeline(S.tl, S.project); })
        .catch(err => { S.motionCache.set(key, { error: err.message }); toast(`Animation “${o.props.name}”: ${err.message}`, 6000); });
    }
    return null;
  }
  /** Animations play their natural length: store it so the timeline knows. */
  function syncMotionDur(o, duration) {
    if (!duration) return;
    const d = Math.round(duration * 1000) / 1000;
    let target = null;
    if (o.id.endsWith('-stinger')) target = shotById(o.id.slice(0, -8))?.transition?.stinger;
    else if (!o.id.endsWith('-card')) for (const sh of shots()) { const x = (sh.overlays || []).find(y => y.id === o.id); if (x) target = x; }
    if (target && Math.abs((Number(target.dur) || 0) - d) > 0.01) {
      target.dur = d;
      setTimeout(() => { S.tl = buildTimeline(S.project, S.analysis); S.player.setTimeline(S.tl, S.project); renderScrub(); save(); });
    }
  }

  function refresh() {
    S.tl = buildTimeline(S.project, S.analysis);
    durEl.textContent = `${clock(S.project.source.duration)} → ${clock(S.tl.duration)}`;
    undoBtn.disabled = !S.history.length;
    redoBtn.disabled = !S.future.length;
    renderStoryboard();
    renderInspector();
    renderScrub();
    S.player.motionSrc = motionUrl;
    S.player.motionBlend = o => S.motionCache.get(motionKey(o))?.blend;
    S.player.setTimeline(S.tl, S.project);
    const s = S.project.settings;
    S.player.setLuts(S.project.source.hdr ? null : (s.inputLut && !['auto', 'none'].includes(s.inputLut) ? s.inputLut : null), s.lut?.id, s.lut?.intensity ?? 1);
  }

  /* ---------- helpers ---------- */
  const shots = () => S.project.storyboard.shots;
  const sections = () => S.project.storyboard.sections;
  const shotById = sid => shots().find(s => s.id === sid);
  const itemById = sid => S.tl.items.find(i => i.id === sid);
  const settings = () => S.project.settings;
  const motionByName = n => S.motions.find(m => m.name === n);
  const varDefaults = n => Object.fromEntries((motionByName(n)?.variables || []).map(v => [v.id, v.default ?? '']));
  /** Inputs for an animation's variables; writes into holder.vars. */
  const varFields = holder => (motionByName(holder.name)?.variables || []).map(v => h('div.field', h('span.label', v.label || v.id),
    h('input', { type: 'text', value: holder.vars?.[v.id] ?? v.default ?? '', onchange: e => commit(() => { holder.vars = { ...holder.vars, [v.id]: e.target.value }; }) })));
  const motionSelect = (holder, kinds, onPick) => h('select', { onchange: e => commit(() => onPick(e.target.value)) },
    S.motions.filter(m => kinds.includes(m.kind)).map(m => h('option', { value: m.name, selected: m.name === holder?.name }, `${m.title}${m.scope === 'project' ? ' (this video)' : ''}`)));

  function select(sid, { seek = true } = {}) {
    S.sel = sid;
    for (const [k, row] of S.rows) row.classList.toggle('sel', k === sid);
    renderInspector();
    renderScrub();
    const it = itemById(sid);
    if (seek && it && !S.player.playing) S.player.seek(it.start + 0.01);
  }

  function thumb(shot, w = 54) {
    const s = settings();
    const vertical = S.tl.width < S.tl.height;
    const tw = vertical ? w : Math.round(w * 2.2), th = Math.round(tw * S.tl.height / S.tl.width);
    if (shot.kind === 'card') return h('div.thumb.card-thumb', { style: { width: `${tw}px`, height: `${th}px` } }, shot.card?.title || 'Card');
    const it = itemById(shot.id);
    const src = it?.ranges[0] ? it.ranges[0].src0 + Math.min(0.6, (it.ranges[0].frames / S.tl.fps) / 2) : S.words[shot.w0]?.start || 0;
    const fr = shotFraming(shot, s);
    const url = frameUrl(id, { t: src.toFixed(2), w: tw * 2, z: fr.zoom, fx: fr.fx, fy: fr.fy, aspect: s.aspect, lut: s.lut?.id || 'none', k: s.lut?.intensity ?? 1 });
    let img = S.thumbs.get(url);
    if (!img) { img = h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' }); S.thumbs.set(url, img); }
    const box = h('div.thumb', { style: { width: `${tw}px`, height: `${th}px` } }, img);
    if (shot.broll?.file) box.append(h('span.tag', 'B-roll'));
    return box;
  }

  /* ---------- storyboard ---------- */
  function renderStoryboard() {
    const scroll = main.scrollTop;
    clear(sbEl);
    S.rows.clear();
    S.wordEls.clear();
    const all = shots();
    const on = all.filter(s => s.enabled !== false).length;
    const stats = S.project.storyboard.stats || {};
    sbEl.append(
      h('div.sb-top',
        h('div', h('p.eyebrow.accent', 'Storyboard'), h('h2.serif', plural(on, 'shot') + ', ' + plural(sections().filter(sec => all.some(s => s.section === sec.id)).length, 'section'))),
        h('span.grow'),
        h('span.meta', [stats.retakes ? `${stats.retakes} retakes dropped` : null, stats.fillers ? `${stats.fillers} fillers` : null, stats.repeats ? `${stats.repeats} repeats` : null].filter(Boolean).join(' · '))),
      h('p.sb-hint', 'Click a word to cut it, shift-click to cut a run, ⌥-click to split the shot there. Drag ⋮⋮ to reorder. Pauses longer than ', h('b', `${settings().cut.minGap}s`), ' are cut automatically.'));

    let n = 0;
    for (const sec of sections()) {
      const list = all.filter(s => s.section === sec.id);
      if (!list.length) continue;
      n++;
      const secEl = h('section.sec',
        h('div.sec-head',
          h('span.n', String(n).padStart(2, '0')),
          h('input', { type: 'text', value: sec.title, 'aria-label': 'Section title', onchange: e => commit(() => { sec.title = e.target.value; }) }),
          h('span.acts',
            h('button.link', { onclick: () => insertCard(list.find(s => s.enabled !== false) || list[0], sec) }, 'Add title card'),
            h('button.link', { onclick: () => { const on = list.every(x => x.enabled === false); commit(() => { list.forEach(x => { x.enabled = on; }); }); } }, list.every(x => x.enabled === false) ? 'Use section' : 'Skip section'))));
      list.forEach((shot, k) => {
        const it = itemById(shot.id);
        const opens = it && S.tl.items[0]?.id !== shot.id;
        // The transition into a section sits in its heading; the rest sit between rows.
        if (opens && k === list.findIndex(x => itemById(x.id))) secEl.querySelector('.sec-head').insertBefore(transButton(shot, it, 'chip'), secEl.querySelector('.sec-head .acts'));
        else if (opens) secEl.append(h('div.trans', transButton(shot, it)));
        secEl.append(shotRow(shot, it));
      });
      sbEl.append(secEl);
    }
    main.scrollTop = scroll;
  }

  function transButton(shot, it, cls) {
    const type = it.trans.type;
    const st = shot.transition?.stinger ? ` + ${motionByName(shot.transition.stinger.name)?.title || shot.transition.stinger.name}` : '';
    const label = (type === 'cut' ? 'Cut' : `${TNAME[type] || type} ${it.trans.d.toFixed(1)}s`) + st;
    return h('button', { class: cls || (type === 'cut' && !st ? 'cutonly' : 'set'), type: 'button', title: 'Transition into this shot', onclick: e => transMenu(e.currentTarget, shot) }, cls ? h('b', 'In') : null, cls ? ` ${label}` : label);
  }

  function transMenu(anchor, shot) {
    const cur = shot.transition?.type || 'cut';
    menu(anchor, [
      ...TRANSITIONS.map(([k, name]) => ({ label: name, pressed: cur === k, onClick: () => commit(() => { shot.transition = { type: k, duration: shot.transition?.duration || 0.3 }; }) })),
      'hr',
      ...[0.2, 0.3, 0.5, 0.8].map(d => ({ label: `${d}s`, meta: 'duration', pressed: (shot.transition?.duration || 0.3) === d, onClick: () => commit(() => { shot.transition = { ...shot.transition, type: cur === 'cut' ? 'fade' : cur, duration: d }; }) })),
      ...stingerItems(shot),
    ]);
  }

  /** Menu entries for stinger animations laid over the cut (HyperFrames, kind "transition"). */
  function stingerItems(shot) {
    const st = S.motions.filter(m => m.kind === 'transition');
    if (!st.length) return [];
    const cur = shot.transition?.stinger?.name;
    return ['hr',
      ...st.map(m => ({ label: `Stinger: ${m.title}`, pressed: cur === m.name, onClick: () => commit(() => { shot.transition = { type: 'cut', duration: 0.3, ...shot.transition, stinger: { name: m.name, vars: varDefaults(m.name), cut: m.cut } }; }) })),
      ...(cur ? [{ label: 'No stinger', onClick: () => commit(() => { delete shot.transition.stinger; }) }] : [])];
  }

  function shotRow(shot, it) {
    const idx = S.tl.items.indexOf(it);
    const body = h('div.body');
    const line = h('div.line',
      h('span.idx', idx >= 0 ? String(idx + 1) : '–'),
      h('span.meta', it ? `${clock(it.start, true)} · ${it.dur.toFixed(1)}s` : 'off'),
      shot.zoom > 1 ? h('span.meta', `zoom ${shot.zoom.toFixed(2)}×`) : null,
      shot.motion && shot.motion !== 'none' ? h('span.meta', shot.motion === 'push' ? 'push in' : 'pull out') : null);
    body.append(line);
    if (shot.kind === 'card') {
      body.append(h('div.txt.serif', shot.card?.eyebrow ? `${shot.card.eyebrow}  ` : '', shot.card?.title || ''), shot.card?.sub ? h('div.meta', shot.card.sub) : null);
    } else if (shot.kind === 'raw') {
      body.append(h('div.txt.muted', `Untouched source ${clock(shot.in, true)}–${clock(shot.out, true)}`));
    } else {
      body.append(wordsEl(shot));
    }
    if (shot.flag) body.append(h('div.flag', shot.flag.note));
    const chips = h('div.chips');
    for (const o of shot.overlays || []) {
      const label = o.type === 'motion' ? o.vars?.text || o.vars?.label || motionByName(o.name)?.title || o.name : o.text;
      chips.append(h('button.chip', { onclick: e => { e.stopPropagation(); select(shot.id); } }, h('b', GNAME[o.type] || o.type), label ? ` ${String(label).slice(0, 28)}` : ''));
    }
    if (shot.broll?.file) chips.append(h('span.chip', h('b', 'B-roll'), ` ${shot.broll.file.split('/').pop().slice(0, 24)}`));
    if (shot.transition?.stinger) chips.prepend(h('span.chip', h('b', 'Stinger'), ` ${shot.transition.stinger.name}`));
    for (const t of (S.project.threads || []).filter(x => x.shot === shot.id)) {
      const last = t.messages[t.messages.length - 1];
      chips.append(h('button.chip.note', { class: t.status, title: last?.text || '', onclick: e => { e.stopPropagation(); select(shot.id); } }, h('b', last?.from === 'claude' ? 'Claude' : 'Note'), ` ${NOTE_STATUS[t.status] || t.status}`));
    }
    if (chips.childNodes.length) body.append(chips);

    const use = h('input', { type: 'checkbox', checked: shot.enabled !== false, title: 'Use this shot', onclick: e => e.stopPropagation(), onchange: e => commit(() => { shot.enabled = e.target.checked; }) });
    const grip = h('span.grip', { title: 'Drag to reorder', draggable: 'true' }, '⋮⋮');
    const row = h('div.shot', { class: [shot.enabled === false ? 'off' : '', S.sel === shot.id ? 'sel' : '', (S.remote.get(shot.id) || 0) > Date.now() ? 'remote' : ''].join(' '), dataset: { id: shot.id } },
      thumb(shot), body, h('div.side', use, grip));
    row.addEventListener('click', e => { if (!e.target.closest('.w, input, button')) select(shot.id); });
    dragAndDrop(row, grip, shot);
    S.rows.set(shot.id, row);
    return row;
  }

  function wordsEl(shot) {
    const txt = h('div.txt');
    const cut = shot.cut || {};
    const minGap = settings().cut.minGap;
    for (let i = shot.w0; i <= shot.w1; i++) {
      const w = S.words[i];
      if (!w) continue;
      if (i > shot.w0) {
        const gap = w.start - S.words[i - 1].end;
        txt.append(' ');
        if (gap > minGap) txt.append(h('span.gap', { title: 'Pause, cut automatically' }, `·${gap.toFixed(1)}s·`), ' ');
      }
      const reason = cut[i];
      const span = h('span.w', { class: [reason ? 'cut' : '', reason && reason !== 'user' ? 'auto' : ''].join(' '), title: reason && reason !== 'user' ? `Cut: ${reason}` : '' }, w.text);
      span.addEventListener('click', e => wordClick(e, shot, i));
      S.wordEls.set(i, span);
      txt.append(span);
    }
    return txt;
  }

  function wordClick(e, shot, i) {
    e.stopPropagation();
    if (e.altKey) {
      if (i === shot.w0) return toast('Already the first word of the shot');
      return commit(() => split(shot, i));
    }
    if (e.shiftKey && S.anchor && S.anchor.shot === shot.id) {
      const [a, b] = [Math.min(S.anchor.i, i), Math.max(S.anchor.i, i)];
      const cutting = !(shot.cut && i in shot.cut);
      commit(() => { shot.cut = shot.cut || {}; for (let k = a; k <= b; k++) { if (cutting) shot.cut[k] = 'user'; else delete shot.cut[k]; } });
    } else {
      commit(() => { shot.cut = shot.cut || {}; if (i in shot.cut) delete shot.cut[i]; else shot.cut[i] = 'user'; });
    }
    S.anchor = { shot: shot.id, i };
    if (S.sel !== shot.id) select(shot.id, { seek: false });
  }

  function split(shot, i) {
    const list = shots();
    const at = list.indexOf(shot);
    const cutA = {}, cutB = {};
    for (const [k, v] of Object.entries(shot.cut || {})) (Number(k) < i ? cutA : cutB)[k] = v;
    const ovA = [], ovB = [];
    for (const o of shot.overlays || []) (o.word != null && o.word >= i ? ovB : ovA).push(o);
    const next = { ...structuredClone(shot), id: uid('s'), w0: i, cut: cutB, overlays: ovB, transition: { type: 'cut', duration: 0.3 }, flag: null, zoom: (shot.zoom || 1) > 1 ? 1 : settings().zoom.amount };
    shot.w1 = i - 1; shot.cut = cutA; shot.overlays = ovA;
    list.splice(at + 1, 0, next);
    S.sel = next.id;
  }

  function insertCard(before, sec) {
    commit(() => {
      const list = shots();
      const at = list.indexOf(before);
      const n = sections().indexOf(sec);
      const card = { id: uid('s'), kind: 'card', section: sec.id, enabled: true, card: { eyebrow: String(n + 1).padStart(2, '0'), title: sec.title.replace(/\.?$/, '.'), sub: '', dur: 2 }, transition: { type: 'fade', duration: 0.3 }, overlays: [] };
      list.splice(Math.max(0, at), 0, card);
      if (before && (before.transition?.type || 'cut') === 'cut') before.transition = { type: 'fade', duration: 0.3 };
      S.sel = card.id;
    });
  }

  /* drag to reorder */
  function dragAndDrop(row, grip, shot) {
    grip.addEventListener('dragstart', e => { S.drag = shot.id; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', shot.id); });
    grip.addEventListener('dragend', () => { S.drag = null; row.classList.remove('dragging'); document.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); });
    row.addEventListener('dragover', e => {
      if (!S.drag || S.drag === shot.id) return;
      e.preventDefault();
      const r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      row.classList.toggle('drop-after', after);
      row.classList.toggle('drop-before', !after);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      const after = row.classList.contains('drop-after');
      row.classList.remove('drop-before', 'drop-after');
      const moving = shotById(S.drag);
      if (!moving || moving === shot) return;
      commit(() => {
        const list = shots();
        list.splice(list.indexOf(moving), 1);
        list.splice(list.indexOf(shot) + (after ? 1 : 0), 0, moving);
        moving.section = shot.section;
      });
    });
  }

  /* ---------- scrub bar ---------- */
  function renderScrub() {
    clear(scrub);
    if (!S.tl?.duration) return;
    const D = S.tl.duration;
    const lane = h('div.lane');
    for (const it of S.tl.items) {
      lane.append(h('div.blk', { class: `${it.kind === 'card' ? 'card' : ''} ${it.id === S.sel ? 'sel' : ''}`, style: { left: `${(it.start / D) * 100}%`, width: `${Math.max(0.2, (it.dur / D) * 100)}%` }, title: `${it.id}` }));
    }
    for (const c of S.tl.chapters) lane.append(h('i.mark', { style: { left: `${(c.t / D) * 100}%` }, title: c.title }));
    scrub.append(lane);
    for (const o of S.tl.overlays) scrub.append(h('div.ov', { style: { left: `${(o.start / D) * 100}%`, width: `${((o.end - o.start) / D) * 100}%` }, title: GNAME[o.type] || o.type }));
    S.headEl = h('div.head', { style: { left: `${(S.player.t / D) * 100}%` } });
    scrub.append(S.headEl);
  }

  /* ---------- playhead → storyboard ---------- */
  let lastItem = null, lastWord = null;
  function onTime(t) {
    timeEl.textContent = `${clock(t, true)} / ${clock(S.tl.duration, true)}`;
    if (S.headEl) S.headEl.style.left = `${(t / S.tl.duration) * 100}%`;
    const it = S.tl.items.filter(i => t >= i.start && t < i.start + i.dur).pop();
    if (it?.id !== lastItem) {
      S.rows.get(lastItem)?.classList.remove('playing');
      if (it) {
        const row = S.rows.get(it.id);
        row?.classList.add('playing');
        if (S.player.playing && row) {
          const r = row.getBoundingClientRect(), m = main.getBoundingClientRect();
          if (r.top < m.top || r.bottom > m.bottom) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
      lastItem = it?.id ?? null;
    }
    const w = S.tl.words.find(x => t >= x.t0 && t < x.t1);
    if (w?.i !== lastWord) {
      S.wordEls.get(lastWord)?.classList.remove('now');
      if (w) S.wordEls.get(w.i)?.classList.add('now');
      lastWord = w?.i ?? null;
    }
  }

  /* ---------- inspector ---------- */
  function renderInspector() {
    clear(inspEl);
    const shot = shotById(S.sel);
    if (!shot) {
      inspEl.append(h('p.eyebrow', 'Inspector'), h('p.empty', 'Select a shot to set its framing, transition, graphics and B-roll, or to leave Claude a note about it.'));
      inspEl.append(notesGroup(null), projectSummary());
      return;
    }
    const it = itemById(shot.id);
    const idx = S.tl.items.indexOf(it);
    inspEl.append(h('div', h('p.eyebrow', shot.kind === 'card' ? 'Title card' : `Shot ${idx >= 0 ? idx + 1 : '(off)'}`),
      h('h3.serif', shot.kind === 'card' ? shot.card?.title || 'Card' : clip(joinWords(keptWords(shot, S.words)), 90) || 'Every word is cut'),
      h('p.meta', it ? `${clock(it.start, true)} → ${clock(it.start + it.dur, true)} · ${it.dur.toFixed(2)}s · ${it.ranges.length || 1} piece${it.ranges.length > 1 ? 's' : ''}` : 'Not in the edit')));

    inspEl.append(notesGroup(shot.id));
    if (shot.kind === 'card') inspEl.append(cardGroup(shot));
    else inspEl.append(framingGroup(shot));
    inspEl.append(transitionGroup(shot), graphicsGroup(shot, it));
    if (shot.kind !== 'card') inspEl.append(brollGroup(shot, it));
    inspEl.append(actionsGroup(shot));
  }

  /* ---------- notes for Claude ---------- */
  function threadEl(t) {
    const reply = h('textarea', { rows: 2, placeholder: t.status === 'question' ? 'Answer Claude…' : 'Add to this note…' });
    const send = async () => {
      if (!reply.value.trim()) return;
      try { await api.reply(id, t.id, { text: reply.value.trim() }); reply.value = ''; } catch (e) { toast(e.message); }
    };
    reply.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } });
    return h('div.thread', { class: t.status },
      t.messages.map(m => h('div.msg', { class: m.from }, h('span.who', m.from === 'claude' ? 'Claude' : 'You'), h('div.say', m.text),
        m.changes?.length ? h('ul.changes', m.changes.map(c => h('li', c))) : null)),
      h('div.row', h('span.meta.grow', NOTE_STATUS[t.status] || t.status),
        t.status !== 'done' ? h('button.link', { onclick: () => api.setThread(id, t.id, { status: 'done' }).catch(e => toast(e.message)) }, 'Mark done') : null,
        h('button.link.danger', { onclick: () => api.deleteThread(id, t.id).catch(e => toast(e.message)) }, 'Delete')),
      t.status === 'working' || t.status === 'sent' ? null : h('div.reply', reply, h('button.btn.sm', { onclick: send }, 'Add')));
  }

  function notesGroup(shotId) {
    const list = h('div.threads');
    const fill = () => {
      clear(list);
      const ts = (S.project.threads || []).filter(t => (t.shot || null) === shotId);
      for (const t of ts) list.append(threadEl(t));
    };
    fill();
    const box = h('textarea', { rows: 3, placeholder: shotId ? 'Tell Claude what you want here: an animation, a cut, a title, a different framing…' : 'A note about the whole video…' });
    const add = async () => {
      if (!box.value.trim()) return;
      try { await api.addNote(id, { shot: shotId, text: box.value.trim() }); box.value = ''; } catch (e) { toast(e.message); }
    };
    box.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); } });
    S.notesFill = fill;
    return h('div.grp.notes', h('div.row', h('span.label.grow', shotId ? 'Notes for Claude' : 'Notes for Claude: whole video')),
      list, box, h('div.row', h('button.btn.sm', { onclick: add }, 'Add note'), h('span.meta', '⌘↩ adds it. Send to Claude (top right) when you’re ready.')));
  }
  function renderThreadsInPlace() { S.notesFill?.(); showClaude(S.claude); }

  function projectSummary() {
    const s = settings();
    const lut = S.luts.find(l => l.id === s.lut?.id);
    return h('div.grp', h('span.label', 'This edit'),
      h('p.meta', `${s.aspect} · ${S.tl.width}×${S.tl.height} · ${s.fps} fps · look: ${lut ? lut.name : 'none'}${s.lut?.id ? ` ${Math.round((s.lut.intensity ?? 1) * 100)}%` : ''} · captions ${s.captions.on ? s.captions.style : 'off'}`),
      h('p.meta', `${S.tl.items.length} shots · ${S.tl.overlays.length} graphics · ${clock(S.tl.duration, true)} long`),
      h('div.row', h('button.btn.sm', { onclick: () => openSettings() }, 'Settings'), h('button.btn.sm', { onclick: () => openRender() }, 'Render')));
  }

  function framingGroup(shot) {
    const s = settings();
    const fr = shotFraming(shot, s);
    const it = itemById(shot.id);
    const t = it?.ranges[0] ? it.ranges[0].src0 + 0.3 : S.words[shot.w0]?.start || 0;
    const img = h('img', { src: frameUrl(id, { t: t.toFixed(2), w: 420, crop: 0, lut: s.lut?.id || 'none', k: s.lut?.intensity ?? 1 }), alt: 'Source frame' });
    const rect = h('div.crop');
    const focus = h('div.focus', { title: 'Click to set what the frame centres on' }, img, rect);
    const place = () => {
      const W = S.project.source.width, H = S.project.source.height;
      const r = cropRect(W, H, S.tl.width, S.tl.height, fr.zoom, fr.fx, fr.fy);
      Object.assign(rect.style, { left: `${(r.x / W) * 100}%`, top: `${(r.y / H) * 100}%`, width: `${(r.w / W) * 100}%`, height: `${(r.h / H) * 100}%` });
    };
    place();
    focus.addEventListener('click', e => {
      const r = focus.getBoundingClientRect();
      const fx = Math.round(((e.clientX - r.left) / r.width) * 100) / 100, fy = Math.round(((e.clientY - r.top) / r.height) * 100) / 100;
      commit(() => { shot.fx = fx; shot.fy = fy; });
    });
    const zoom = h('input', { type: 'range', min: 1, max: 1.8, step: 0.01, value: fr.zoom });
    const zlabel = h('span.meta', `${fr.zoom.toFixed(2)}×`);
    const orig = shot.zoom;
    // Live while dragging; one undo step when you let go.
    zoom.addEventListener('input', () => { zlabel.textContent = `${Number(zoom.value).toFixed(2)}×`; shot.zoom = fr.zoom = Number(zoom.value); place(); S.player.requestDraw(); });
    zoom.addEventListener('change', () => { const v = Number(zoom.value); shot.zoom = orig; commit(() => { shot.zoom = v; }); });
    const motion = seg([['none', 'Still'], ['push', 'Push in'], ['pull', 'Pull out']], shot.motion || 'none', v => commit(() => { shot.motion = v; }));
    return h('div.grp', h('span.label', 'Framing'), focus,
      h('div.field', h('span.label', 'Punch-in', zlabel), zoom),
      h('div.field', h('span.label', 'Camera move'), motion),
      h('div.row', h('button.link', { onclick: () => commit(() => { delete shot.fx; delete shot.fy; shot.zoom = 1; shot.motion = 'none'; }) }, 'Reset framing'),
        h('button.link', { onclick: () => commit(p => { p.settings.framing = { fx: fr.fx, fy: fr.fy }; for (const x of shots()) { delete x.fx; delete x.fy; } }) }, 'Use this focus for every shot')));
  }

  function cardGroup(shot) {
    const c = shot.card || (shot.card = {});
    const f = (k, label, area) => h('div.field', h('span.label', label), h(area ? 'textarea' : 'input', { type: 'text', value: c[k] || '', onchange: e => commit(() => { c[k] = e.target.value; }) }));
    const dur = h('input', { type: 'number', min: 0.5, max: 10, step: 0.1, value: c.dur ?? 2, onchange: e => commit(() => { c.dur = Math.max(0.5, Number(e.target.value) || 2); }) });
    const anims = S.motions.filter(m => m.kind === 'card' || m.kind === 'text');
    const drawn = h('select', { onchange: e => commit(() => { if (e.target.value) c.motion = { name: e.target.value, vars: varDefaults(e.target.value) }; else delete c.motion; }) },
      h('option', { value: '' }, 'Cutaways title card'), anims.map(m => h('option', { value: m.name, selected: c.motion?.name === m.name }, `Animation: ${m.title}`)));
    return h('div.grp', h('span.label', 'Card'), h('div.field', h('span.label', 'Drawn by'), drawn),
      ...(c.motion ? [h('div.field', h('span.label', 'Seconds'), dur), ...varFields(c.motion)] : [h('div.two', f('eyebrow', 'Eyebrow'), h('div.field', h('span.label', 'Seconds'), dur)), f('title', 'Title', true), f('sub', 'Second line')]));
  }

  function transitionGroup(shot) {
    const first = S.tl.items[0]?.id === shot.id;
    const tr = shot.transition || { type: 'cut', duration: 0.3 };
    const sel = h('select', { disabled: first, onchange: e => commit(() => { shot.transition = { ...tr, type: e.target.value }; }) },
      TRANSITIONS.map(([k, n]) => h('option', { value: k, selected: tr.type === k }, n)));
    const dur = h('input', { type: 'range', min: 0.1, max: 1.2, step: 0.05, value: tr.duration ?? 0.3, disabled: first || tr.type === 'cut' });
    const dl = h('span.meta', `${(tr.duration ?? 0.3).toFixed(2)}s`);
    dur.addEventListener('input', () => { dl.textContent = `${Number(dur.value).toFixed(2)}s`; });
    dur.addEventListener('change', () => commit(() => { shot.transition = { ...tr, duration: Number(dur.value) }; }));
    const stingers = S.motions.filter(m => m.kind === 'transition');
    const st = tr.stinger;
    const stSel = h('select', { disabled: first, onchange: e => commit(() => {
      const m = motionByName(e.target.value);
      if (!m) delete shot.transition.stinger;
      else shot.transition = { ...tr, stinger: { name: m.name, vars: varDefaults(m.name), cut: m.cut } };
    }) }, h('option', { value: '' }, 'No stinger'), stingers.map(m => h('option', { value: m.name, selected: st?.name === m.name }, m.title)));
    return h('div.grp', h('span.label', 'Transition in'), first ? h('p.meta', 'The first shot opens the video.') : null, h('div.two', sel, h('div.field', h('span.label', 'Length', dl), dur)),
      stingers.length ? h('div.field', h('span.label', 'Stinger (an animation over the cut)'), stSel) : null,
      st ? varFields(st) : null);
  }

  function graphicsGroup(shot, it) {
    const grp = h('div.grp', h('div.row', h('span.label.grow', 'Graphics'), h('button.btn.sm', { onclick: e => addGraphicMenu(e.currentTarget, shot) }, 'Add')));
    const list = shot.overlays || [];
    if (!list.length) grp.append(h('p.empty', 'None on this shot.'));
    for (const o of list) {
      const isMotion = o.type === 'motion';
      const fields = isMotion
        ? [h('div.field', h('span.label', 'Animation'), motionSelect(o, ['text', 'card'], v => { o.name = v; o.vars = varDefaults(v); delete o.dur; })), ...varFields(o),
           h('p.meta', motionByName(o.name)?.description || `No animation called “${o.name}”.`)]
        : (FIELDS[o.type] || ['text']).map(k => h('div.field', h('span.label', FIELD_LABEL[k]),
          h(k === 'text' && ['headline', 'quote'].includes(o.type) ? 'textarea' : 'input', { type: 'text', value: o[k] || '', onchange: e => commit(() => { o[k] = e.target.value; }) })));
      const whole = o.dur === 'shot';
      const at = h('input', { type: 'number', step: 0.1, min: 0, value: o.word != null ? '' : (o.at ?? 0), placeholder: o.word != null ? 'on word' : '0', onchange: e => commit(() => { o.at = Math.max(0, Number(e.target.value) || 0); delete o.word; }) });
      const dur = h('input', { type: 'number', step: 0.1, min: 0.5, value: whole ? '' : (o.dur ?? 3), placeholder: whole ? 'whole shot' : '3', disabled: whole, onchange: e => commit(() => { o.dur = Math.max(0.5, Number(e.target.value) || 3); }) });
      const wholeBox = h('label.check', h('input', { type: 'checkbox', checked: whole, onchange: e => commit(() => { o.dur = e.target.checked ? 'shot' : 3; }) }), 'Whole shot');
      const anchor = o.word != null && S.words[o.word] ? h('p.meta', `Starts on “${S.words[o.word].text}”. Set a start time to unpin it.`) : null;
      grp.append(h('div.ovl',
        h('div.hd', h('b.grow', GNAME[o.type] || o.type), h('label.check', h('input', { type: 'checkbox', checked: o.enabled !== false, onchange: e => commit(() => { o.enabled = e.target.checked; }) }), 'Show'),
          h('button.link.danger', { onclick: () => commit(() => { shot.overlays = list.filter(x => x !== o); }) }, 'Remove')),
        fields, isMotion
          ? h('div.two', h('div.field', h('span.label', 'Start (s)'), at), h('div.field', h('span.label', 'Plays'), h('span.meta', o.dur ? `${Number(o.dur).toFixed(2)}s` : 'rendering…')))
          : h('div.three', h('div.field', h('span.label', 'Start (s)'), at), h('div.field', h('span.label', 'Length (s)'), dur), h('div.field', h('span.label', '\u00a0'), wholeBox)), anchor));
    }
    if (it) grp.append(h('p.meta', 'Times are from the start of this shot. Graphics can run on into the next shot.'));
    return grp;
  }

  function addGraphicMenu(anchor, shot) {
    const anims = S.motions.filter(m => m.kind !== 'transition');
    menu(anchor, [
      ...GRAPHICS.map(([type, name, props]) => ({
        label: name,
        onClick: () => commit(() => {
          const s = settings();
          const p = type === 'lowerThird' ? { text: s.brand.name, sub: s.brand.role } : { ...props };
          (shot.overlays = shot.overlays || []).push({ id: uid('o'), type, ...p, at: 0.2, dur: type === 'headline' || type === 'cta' ? 'shot' : 3 });
        }),
      })),
      ...(anims.length ? ['hr'] : []),
      ...anims.map(m => ({ label: m.title, meta: 'animation', onClick: () => commit(() => { (shot.overlays = shot.overlays || []).push({ id: uid('o'), type: 'motion', name: m.name, vars: varDefaults(m.name), at: 0.2 }); }) })),
    ]);
  }

  function brollGroup(shot, it) {
    const b = shot.broll;
    const grp = h('div.grp', h('span.label', 'B-roll'));
    const options = [h('option', { value: '' }, b?.file ? 'Remove B-roll' : 'Choose a clip…')];
    const groups = {};
    for (const x of S.library.broll) (groups[x.source] = groups[x.source] || []).push(x);
    for (const [src, list] of Object.entries(groups)) options.push(h('optgroup', { label: src }, list.map(x => h('option', { value: x.file, selected: b?.file === x.file }, x.name))));
    if (b?.file && !S.library.broll.some(x => x.file === b.file)) options.push(h('option', { value: b.file, selected: true }, b.file.split('/').pop()));
    const pick = h('select', { onchange: e => commit(() => { shot.broll = e.target.value ? { file: e.target.value, in: 0, start: 0, dur: null, grade: false } : null; }) }, options);
    grp.append(pick);
    if (b?.file) {
      const num = (k, label, ph) => h('div.field', h('span.label', label), h('input', { type: 'number', step: 0.1, min: 0, value: b[k] ?? '', placeholder: ph, onchange: e => commit(() => { b[k] = e.target.value === '' ? null : Math.max(0, Number(e.target.value)); }) }));
      grp.append(h('div.three', num('start', 'Starts at', '0'), num('dur', 'Length', it ? it.dur.toFixed(1) : ''), num('in', 'Clip in', '0')),
        h('label.check', h('input', { type: 'checkbox', checked: !!b.grade, onchange: e => commit(() => { b.grade = e.target.checked; }) }), 'Apply the look to this clip (camera footage, not graphics)'),
        h('p.meta', 'The voice keeps playing underneath. Clips in ~/Movies/Cutroom/broll show up in this list.'));
    }
    const url = h('input', { type: 'url', placeholder: 'YouTube or video URL' });
    const from = h('input', { type: 'number', placeholder: 'from s', min: 0, step: 1 });
    const to = h('input', { type: 'number', placeholder: 'to s', min: 0, step: 1 });
    const file = h('input', { type: 'file', accept: 'video/*', hidden: true, onchange: async () => {
      const f = file.files[0];
      if (!f) return;
      toast(`Uploading ${f.name}…`);
      const r = await api.brollUpload(id, f).catch(e => toast(e.message));
      if (r?.file) { S.library = await api.library(id); commit(() => { shot.broll = { file: r.file, in: 0, start: 0, dur: null, grade: true }; }); }
    } });
    const fetchBtn = h('button.btn.sm', { onclick: async () => {
      if (!url.value) return toast('Paste a URL first');
      fetchBtn.disabled = true; fetchBtn.textContent = 'Downloading…';
      try {
        const { job } = await api.broll(id, { url: url.value, from: from.value || null, to: to.value || null });
        const end = await follow(job.id, s => { fetchBtn.textContent = `Downloading ${Math.round(s.progress * 100)}%`; });
        if (end.status !== 'done') throw new Error(end.error || 'Download failed');
        S.library = await api.library(id);
        commit(() => { shot.broll = { file: end.result.file, in: 0, start: 0, dur: null, grade: true }; });
      } catch (e) { toast(e.message); fetchBtn.disabled = false; fetchBtn.textContent = 'Fetch'; }
    } }, 'Fetch');
    grp.append(h('div.row', url, from, to, fetchBtn), h('div.row', h('button.link', { onclick: () => file.click() }, 'Upload a clip'), file));
    return grp;
  }

  function actionsGroup(shot) {
    const list = shots();
    const i = list.indexOf(shot);
    const next = list[i + 1];
    const canMerge = shot.kind === 'talk' && next?.kind === 'talk' && next.w0 === shot.w1 + 1;
    const sec = sections().find(x => x.id === shot.section);
    return h('div.grp', h('span.label', 'Shot'),
      h('div.row.wrap',
        h('button.btn.sm', { onclick: () => commit(() => { shot.enabled = shot.enabled === false; }) }, shot.enabled === false ? 'Use shot' : 'Skip shot'),
        h('button.btn.sm', { disabled: i <= 0, onclick: () => commit(() => { list.splice(i, 1); list.splice(i - 1, 0, shot); shot.section = list[i]?.section || shot.section; }) }, 'Move up'),
        h('button.btn.sm', { disabled: i >= list.length - 1, onclick: () => commit(() => { list.splice(i, 1); list.splice(i + 1, 0, shot); shot.section = list[i]?.section || shot.section; }) }, 'Move down'),
        canMerge ? h('button.btn.sm', { onclick: () => commit(() => { shot.w1 = next.w1; shot.cut = { ...shot.cut, ...next.cut }; shot.overlays = [...(shot.overlays || []), ...(next.overlays || [])]; list.splice(i + 1, 1); }) }, 'Merge with next') : null,
        h('button.btn.sm', { onclick: () => insertCard(shot, sec) }, 'Title card before'),
        shot.kind === 'talk' && Object.values(shot.cut || {}).some(v => v === 'user') ? h('button.btn.sm', { onclick: () => commit(() => { for (const [k, v] of Object.entries(shot.cut)) if (v === 'user') delete shot.cut[k]; }) }, 'Restore my cuts') : null,
        shot.kind === 'talk' && i > 0 && list[i - 1].section === shot.section ? h('button.btn.sm', { onclick: () => commit(() => {
          const sid = uid('sec'), at = sections().indexOf(sec);
          sections().splice(at + 1, 0, { id: sid, kind: 'part', title: 'New section' });
          for (let k = i; k < list.length && list[k].section === sec.id; k++) list[k].section = sid;
        }) }, 'New section from here') : null,
        shot.kind !== 'talk' ? h('button.btn.sm', { onclick: () => commit(() => { list.splice(i, 1); S.sel = null; }) }, 'Delete') : null));
  }

  /* ---------- settings ---------- */
  function sheet(title, build) {
    const scrim = h('div.scrim');
    const body = h('div.sheet-body');
    const close = () => { scrim.remove(); panel.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') close(); };
    const panel = h('aside.sheet', { role: 'dialog', 'aria-label': title }, h('div.sheet-head', h('h2.serif', title), h('button.btn.ghost.sm', { onclick: close }, 'Close')), body);
    scrim.addEventListener('click', close);
    document.addEventListener('keydown', esc);
    document.body.append(scrim, panel);
    build(body, close);
    return { close, body };
  }

  function openSettings() {
    sheet('Settings', body => {
      const s = settings();
      const set = (fn, opts) => commit(p => fn(p.settings), opts);
      const rerender = () => { clear(body); build(); };
      const build = () => {
        const firstT = S.tl.items.find(i => i.ranges[0])?.ranges[0].src0 + 0.5 || 1;
        // Format
        body.append(h('div.grp', h('p.eyebrow', 'Format'),
          seg([['9:16', '9:16 Reel'], ['16:9', '16:9'], ['1:1', '1:1'], ['4:5', '4:5']], s.aspect, v => { set(x => { x.aspect = v; }); rerender(); }),
          h('div.two',
            h('div.field', h('span.label', 'Resolution'), h('select', { onchange: e => set(x => { x.resolution = Number(e.target.value); }) }, [[720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '4K']].map(([v, n]) => h('option', { value: v, selected: s.resolution === v }, n)))),
            h('div.field', h('span.label', 'Frame rate'), h('select', { onchange: e => set(x => { x.fps = Number(e.target.value); }) }, [24, 25, 30, 60].map(v => h('option', { value: v, selected: s.fps === v }, `${v} fps`)))))));

        // Look
        const looks = S.luts.filter(l => l.kind === 'look');
        const lutBtn = (lid, name) => h('button.lut', { type: 'button', 'aria-pressed': (s.lut?.id || 'none') === lid ? 'true' : 'false', onclick: () => { set(x => { x.lut = { id: lid, intensity: x.lut?.intensity ?? 0.8 }; }); rerender(); } },
          h('div.im', h('img', { src: frameUrl(id, { t: firstT.toFixed(2), w: 240, crop: 0, lut: lid, k: 1 }), alt: '' })), h('span', name));
        const k = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.lut?.intensity ?? 0.8, disabled: !s.lut?.id || s.lut.id === 'none' });
        const kl = h('span.meta', `${Math.round((s.lut?.intensity ?? 0.8) * 100)}%`);
        k.addEventListener('input', () => { kl.textContent = `${Math.round(k.value * 100)}%`; });
        k.addEventListener('change', () => set(x => { x.lut = { ...x.lut, intensity: Number(k.value) }; }));
        const convs = S.luts.filter(l => l.kind === 'conversion');
        body.append(h('div.grp', h('p.eyebrow', 'Look'),
          h('div.luts', lutBtn('none', 'None'), looks.map(l => lutBtn(l.id, l.name))),
          h('div.field', h('span.label', 'Strength', kl), k),
          h('div.field', h('span.label', 'Source colour'), h('select', { onchange: e => set(x => { x.inputLut = e.target.value; }) },
            h('option', { value: 'auto', selected: !s.inputLut || s.inputLut === 'auto' }, S.project.source.hdr ? `Automatic (HDR ${S.project.source.hdr.toUpperCase()} → SDR)` : 'Automatic (standard video)'),
            h('option', { value: 'none', selected: s.inputLut === 'none' }, 'Leave as shot'),
            convs.map(l => h('option', { value: l.id, selected: s.inputLut === l.id }, l.name)))),
          h('p.meta', 'Your own .cube files go in ', h('code', '~/Movies/Cutroom/luts'), '. Reload to see them.')));

        // Brand: colours and fonts for everything drawn into the video
        const b = resolveBrand(s);
        const setBrand = (k, v) => { set(x => { x.brand = { ...x.brand, [k]: v }; }); rerender(); };
        const colour = (label, k) => h('div.field', h('span.label', label, b.custom[k] ? h('button.link', { onclick: () => setBrand(k, '') }, 'Theme colour') : h('span.meta', 'Theme')),
          h('input.swatch', { type: 'color', value: b.colors[k], onchange: e => setBrand(k, e.target.value) }));
        const fontPick = (value, onPick, extra = []) => h('select', { onchange: e => onPick(e.target.value) },
          extra.map(([v, n]) => h('option', { value: v, selected: value === v }, n)),
          S.fonts.fonts.map(f => h('option', { value: f.id, selected: value === f.id }, f.label)));
        body.append(h('div.grp', h('p.eyebrow', 'Brand'),
          h('div.row', h('span.label.grow', 'Theme'), seg([['dark', 'Dark'], ['light', 'Light']], s.theme, v => { set(x => { x.theme = v; }); rerender(); })),
          h('div.three', colour('Plate', 'plate'), colour('Text', 'text'), colour('Accent', 'accent')),
          h('div.two',
            h('div.field', h('span.label', 'Titles font'), fontPick(s.brand.display || 'fraunces', v => setBrand('display', v))),
            h('div.field', h('span.label', 'Labels font'), fontPick(s.brand.body || 'inter', v => setBrand('body', v)))),
          h('div.two',
            h('div.field', h('span.label', 'Name'), h('input', { type: 'text', value: s.brand.name, placeholder: 'For the lower third', onchange: e => set(x => { x.brand = { ...x.brand, name: e.target.value }; }) })),
            h('div.field', h('span.label', 'Role'), h('input', { type: 'text', value: s.brand.role, onchange: e => set(x => { x.brand = { ...x.brand, role: e.target.value }; }) }))),
          h('p.meta', 'Your own fonts (.otf, .ttf, .woff2) go in ', h('code', '~/Movies/Cutroom/fonts'), '. ',
            h('button.link', { onclick: () => api.reveal(S.fonts.dir) }, 'Show folder'), '. Reopen settings to see new ones.'),
          h('div.row', h('button.btn.sm', { onclick: async () => { await api.saveBrand(pickBrand(settings())); toast('Saved. New videos start with this brand, captions and look.'); } }, 'Make this my default'))));

        // Captions
        const cap = h('input', { type: 'range', min: 0.7, max: 1.5, step: 0.05, value: s.captions.size ?? 1 });
        const capL = h('span.meta', `${Math.round((s.captions.size ?? 1) * 100)}%`);
        cap.addEventListener('input', () => { capL.textContent = `${Math.round(cap.value * 100)}%`; });
        cap.addEventListener('change', () => set(x => { x.captions = { ...x.captions, size: Number(cap.value) }; }));
        body.append(h('div.grp', h('p.eyebrow', 'Captions'),
          h('div.row', h('label.check.grow', h('input', { type: 'checkbox', checked: s.captions.on, onchange: e => set(x => { x.captions = { ...x.captions, on: e.target.checked }; }) }), 'Captions'),
            seg([['phrase', 'Phrase'], ['word', 'Word by word']], s.captions.style, v => { set(x => { x.captions = { ...x.captions, style: v }; }); rerender(); })),
          h('div.two',
            h('div.field', h('span.label', 'Font'), fontPick(s.captions.font || 'sans', v => { set(x => { x.captions = { ...x.captions, font: v }; }); rerender(); },
              [['sans', 'Same as labels'], ['serif', 'Condensed serif']])),
            h('div.field', h('span.label', 'Size', capL), cap))));

        // Cuts (live)
        const slider = (label, path, min, max, step, fmt) => {
          const [a, b] = path;
          const r = h('input', { type: 'range', min, max, step, value: s[a][b] });
          const l = h('span.meta', fmt(s[a][b]));
          r.addEventListener('input', () => { l.textContent = fmt(Number(r.value)); });
          r.addEventListener('change', () => set(x => { x[a] = { ...x[a], [b]: Number(r.value) }; }));
          return h('div.field', h('span.label', label, l), r);
        };
        body.append(h('div.grp', h('p.eyebrow', 'Pauses'),
          slider('Cut pauses longer than', ['cut', 'minGap'], 0.15, 1.5, 0.05, v => `${v.toFixed(2)}s`),
          h('div.two', slider('Air before a word', ['cut', 'padIn'], 0, 0.3, 0.01, v => `${Math.round(v * 1000)}ms`), slider('Air after a word', ['cut', 'padOut'], 0, 0.4, 0.01, v => `${Math.round(v * 1000)}ms`)),
          h('p.meta', 'These apply immediately. Nothing is re-planned.')));

        // Audio
        const music = h('select', { onchange: e => set(x => { x.audio = { ...x.audio, music: e.target.value || null }; }) },
          h('option', { value: '' }, 'No music'), S.library.music.map(m => h('option', { value: m.file, selected: s.audio.music === m.file }, m.name)));
        const mdb = h('input', { type: 'range', min: -36, max: -12, step: 1, value: s.audio.musicDb ?? -24 });
        const mdl = h('span.meta', `${s.audio.musicDb ?? -24} dB`);
        mdb.addEventListener('input', () => { mdl.textContent = `${mdb.value} dB`; });
        mdb.addEventListener('change', () => set(x => { x.audio = { ...x.audio, musicDb: Number(mdb.value) }; }));
        body.append(h('div.grp', h('p.eyebrow', 'Sound'),
          h('label.check', h('input', { type: 'checkbox', checked: s.audio.polish, onchange: e => set(x => { x.audio = { ...x.audio, polish: e.target.checked }; }) }), 'Clean up the voice (rumble filter, gentle compression)'),
          h('div.field', h('span.label', 'Loudness'), h('select', { onchange: e => set(x => { x.audio = { ...x.audio, loudness: Number(e.target.value) }; }) },
            [[-14, '-14 LUFS · Instagram, YouTube, TikTok'], [-16, '-16 LUFS · podcasts'], [-23, '-23 LUFS · broadcast']].map(([v, n]) => h('option', { value: v, selected: s.audio.loudness === v }, n)))),
          h('div.two', h('div.field', h('span.label', 'Music bed'), music), h('div.field', h('span.label', 'Music level', mdl), mdb)),
          h('p.meta', 'Music ducks under the voice automatically. Add tracks to ', h('code', '~/Movies/Cutroom/music'), '.')));

        // Export
        body.append(h('div.grp', h('p.eyebrow', 'Export'),
          h('div.field', h('span.label', 'Encoder'), seg([['x264', 'Best quality (x264)'], ['videotoolbox', 'Fast (Apple hardware)']], s.encoder || 'x264', v => { set(x => { x.encoder = v; }); rerender(); }))));

        // Re-plan
        const replan = h('button.btn', { onclick: async () => {
          if (replan.dataset.armed !== '1') { replan.dataset.armed = '1'; replan.textContent = 'Click again to replace your storyboard edits'; return; }
          replan.disabled = true; replan.textContent = 'Planning…';
          S.history.push(snapshot());
          const r = await api.plan(id, S.project.settings);
          S.project.storyboard = r.project.storyboard;
          S.sel = null;
          refresh();
          rerender();
          toast('Storyboard re-planned. Undo brings your edits back.');
        } }, 'Re-plan storyboard');
        const tog = (k, label) => h('label.check', h('input', { type: 'checkbox', checked: s.clean[k], onchange: e => set(x => { x.clean = { ...x.clean, [k]: e.target.checked }; }, { quiet: true }) }), label);
        const gtog = (k, label) => h('label.check', h('input', { type: 'checkbox', checked: s.graphics[k], onchange: e => set(x => { x.graphics = { ...x.graphics, [k]: e.target.checked }; }, { quiet: true }) }), label);
        body.append(h('div.grp', h('p.eyebrow', 'Planning'),
          h('p.meta', 'These shape the first storyboard. Change them, then re-plan.'),
          h('div.two', tog('fillers', 'Cut um and uh'), tog('repeats', 'Cut stutters and repeats'), tog('retakes', 'Keep only the last take'), tog('intros', 'Drop “hey guys” openers')),
          h('div.two', gtog('headline', 'Hook headline'), gtog('lowerThird', 'Name lower third'), gtog('stats', 'Stat callouts'), gtog('cta', 'Call-to-action card')),
          h('div.two',
            h('label.check', h('input', { type: 'checkbox', checked: s.zoom.punchIn, onchange: e => set(x => { x.zoom = { ...x.zoom, punchIn: e.target.checked }; }, { quiet: true }) }), 'Punch in on every other cut'),
            h('div.field', h('span.label', 'Punch-in'), h('select', { onchange: e => set(x => { x.zoom = { ...x.zoom, amount: Number(e.target.value) }; }, { quiet: true }) }, [1.05, 1.1, 1.15, 1.2, 1.3].map(v => h('option', { value: v, selected: s.zoom.amount === v }, `${v}×`))))),
          h('div.two',
            h('div.field', h('span.label', 'Between sections'), h('select', { onchange: e => set(x => { x.sectionTransition = { ...x.sectionTransition, type: e.target.value }; }, { quiet: true }) }, TRANSITIONS.map(([k2, n]) => h('option', { value: k2, selected: s.sectionTransition.type === k2 }, n)))),
            h('div.field', h('span.label', 'Chapter markers'), h('select', { onchange: e => set(x => { x.chapters = e.target.value; }, { quiet: true }) }, [['overlay', 'Corner title'], ['card', 'Full title card'], ['none', 'None']].map(([k2, n]) => h('option', { value: k2, selected: s.chapters === k2 }, n))))),
          h('div.row', replan)));

        // Transcription
        const model = h('select', MODELS.map(([v, n]) => h('option', { value: v, selected: S.analysis.model === v }, n)));
        const engine = h('select', h('option', { value: 'faster' }, 'Faster-Whisper'), h('option', { value: 'openai', selected: S.analysis.engine === 'openai' }, 'Whisper (openai-whisper)'));
        const again = h('button.btn', { onclick: async () => {
          if (again.dataset.armed !== '1') { again.dataset.armed = '1'; again.textContent = 'Click again: this re-plans the storyboard'; return; }
          try { await api.ingest(id, { model: model.value, engine: engine.value, keepProxy: true }); location.reload(); } catch (e) { toast(e.message); }
        } }, 'Transcribe again');
        body.append(h('div.grp', h('p.eyebrow', 'Transcript'),
          h('p.meta', `${S.words.length} words · ${S.analysis.engine === 'openai' ? 'Whisper' : 'Faster-Whisper'} ${S.analysis.model} · ${S.analysis.language || ''}`),
          h('div.two', h('div.field', h('span.label', 'Model'), model), h('div.field', h('span.label', 'Engine'), engine)), h('div.row', again)));
      };
      build();
    });
  }

  /* ---------- render ---------- */
  async function openRender() {
    await save.flush();
    const { body } = sheet('Render', () => {});
    const state = h('div.prog');
    const exportsEl = h('div');
    body.append(h('div.grp', state), h('div.grp', h('p.eyebrow', 'Exports'), exportsEl));
    const showExports = async () => {
      const { project } = await api.project(id);
      clear(exportsEl);
      if (!project.exports?.length) { exportsEl.append(h('p.empty', 'Nothing rendered yet.')); return; }
      project.exports.forEach((x, k) => {
        const url = `/api/projects/${id}/exports/${encodeURIComponent(x.file)}`;
        exportsEl.append(h('div.exp',
          k === 0 ? h('video', { src: url, controls: true, preload: 'metadata', playsInline: true }) : null,
          h('div.row', h('b.grow', x.file), h('span.meta', `${clock(x.duration, true)} · ${(x.size / 1e6).toFixed(1)} MB${x.preview ? ' · draft' : ''}`)),
          h('div.row', h('a.link', { href: `${url}?download` }, 'Download'),
            x.srt ? h('a.link', { href: `/api/projects/${id}/exports/${encodeURIComponent(x.srt)}?download` }, 'Captions .srt') : null,
            x.chapters ? h('a.link', { href: `/api/projects/${id}/exports/${encodeURIComponent(x.chapters)}`, target: '_blank' }, 'Chapters') : null,
            h('button.link', { onclick: () => api.reveal(`${S.project.dir}/exports/${x.file}`) }, 'Show in Finder'))));
      });
    };
    const idle = () => {
      clear(state).append(
        h('p.meta', `${S.tl.items.length} shots · ${S.tl.width}×${S.tl.height} · ${clock(S.tl.duration, true)}. Shots you haven't changed since the last render come from cache.`),
        h('div.row', h('button.btn.primary', { onclick: () => go(false) }, 'Render video'), h('button.btn', { onclick: () => go(true) }, 'Quick draft (540p)')));
    };
    const watch = async job => {
      const bar = h('i', { style: { width: '0%' } });
      const steps = h('ul.steps');
      const log = h('div.log');
      const cancel = h('button.btn.sm', { onclick: () => api.cancel(job.id) }, 'Cancel');
      clear(state).append(h('div.row', h('b.grow', 'Rendering'), cancel), h('div.bar', bar), steps, log);
      const end = await follow(job.id, s => {
        bar.style.width = `${Math.round(s.progress * 100)}%`;
        clear(steps).append(...s.steps.map(st => h('li', { class: s.steps.findIndex(x => x.id === s.step) > s.steps.indexOf(st) ? 'done' : st.id === s.step ? 'now' : '' }, st.label)));
        log.textContent = s.log.join('\n');
        log.scrollTop = log.scrollHeight;
      });
      if (end.status === 'done') { toast('Render finished'); idle(); }
      else { clear(state).append(h('p.err', end.error || 'Render failed'), h('div.log', (end.log || []).join('\n'))); state.append(h('div.row', h('button.btn', { onclick: idle }, 'Back'))); }
      showExports();
    };
    const go = async preview => {
      try {
        const { job } = await api.render(id, { preview, project: { name: S.project.name, settings: S.project.settings, storyboard: S.project.storyboard } });
        watch(job);
      } catch (e) { toast(e.message); }
    };
    const cur = (await api.project(id)).job;
    if (cur?.status === 'running' && cur.type === 'render') watch(cur); else idle();
    showExports();
  }

  /* ---------- keys ---------- */
  const onKey = e => {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey); S.player.destroy(); return; }
    if (e.target.closest('input, textarea, select') || document.querySelector('.sheet')) return;
    const list = shots();
    const at = list.findIndex(s => s.id === S.sel);
    if (e.key === ' ') { e.preventDefault(); S.player.toggle(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = list[Math.max(0, Math.min(list.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (n) { select(n.id); S.rows.get(n.id)?.scrollIntoView({ block: 'nearest' }); }
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && at >= 0) { e.preventDefault(); commit(() => { list[at].enabled = list[at].enabled === false; }); }
  };
  document.addEventListener('keydown', onKey);

  window.cutroom = S; // for poking at in devtools
  refresh();
  showClaude(S.claude);
  if (loaded.job?.status === 'running' && loaded.job.type === 'render') openRender();
}

/* ---------- waiting for ingest ---------- */
async function waitForIngest(root, S, loaded) {
  const bar = h('i', { style: { width: '0%' } });
  const steps = h('ul.steps');
  const log = h('div.log');
  const msg = h('p.meta');
  const title = h('h1.serif', S.project.name);
  clear(root).append(h('div.waiting', h('a.link', { href: '#/' }, '← Projects'), h('p.eyebrow', { style: { marginTop: '28px' } }, 'Importing'), title, h('div.prog', h('div.bar', bar), steps, msg, log)));
  let job = loaded.job;
  if (!job || job.status !== 'running') {
    if (S.project.status === 'error' || S.project.error) {
      msg.className = 'err';
      msg.textContent = S.project.error || 'Import failed.';
      root.querySelector('.prog').append(h('div.row', h('button.btn', { onclick: async () => { await api.ingest(S.id, { keepProxy: false }); location.reload(); } }, 'Try again')));
      return;
    }
    root.querySelector('.prog').append(h('div.row', h('button.btn.primary', { onclick: async () => { await api.ingest(S.id, { keepProxy: false }); location.reload(); } }, 'Start import')));
    return;
  }
  const end = await follow(job.id, s => {
    bar.style.width = `${Math.round(s.progress * 100)}%`;
    clear(steps).append(...s.steps.map((st, k) => h('li', { class: s.steps.findIndex(x => x.id === s.step) > k ? 'done' : st.id === s.step ? 'now' : '' }, st.label)));
    msg.textContent = s.message;
    log.textContent = s.log.join('\n');
    log.scrollTop = log.scrollHeight;
  });
  if (end.status === 'done') mountEditor(root, S.id);
  else { msg.className = 'err'; msg.textContent = end.error || 'Import failed'; }
}

/* ---------- small pieces ---------- */
function seg(options, value, onPick) {
  return h('div.seg', options.map(([v, label]) => h('button', { type: 'button', 'aria-pressed': String(value === v), onclick: () => onPick(v) }, label)));
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

