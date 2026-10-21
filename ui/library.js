/* Projects page: start a new edit from a file, a path or a URL; open an old one. */
import { h, clear, toast } from './dom.js';
import { api } from './api.js';
import { clock } from '/shared/timeline.mjs';

const MODELS = [['small.en', 'Small, English (fast)'], ['medium.en', 'Medium, English'], ['large-v3-turbo', 'Large v3 Turbo (most accurate)'], ['small', 'Small, any language']];

export async function mountLibrary(root) {
  const path = h('input', { type: 'text', placeholder: '/Users/you/Movies/take-3.mov  or  https://youtube.com/watch?v=…', 'aria-label': 'File path or URL' });
  const aspect = h('select', [['9:16', '9:16 · Reels, Shorts, TikTok'], ['16:9', '16:9 · YouTube'], ['1:1', '1:1 · Square'], ['4:5', '4:5 · Feed']].map(([v, n]) => h('option', { value: v }, n)));
  const model = h('select', MODELS.map(([v, n]) => h('option', { value: v }, n)));
  const engine = h('select', h('option', { value: 'faster' }, 'Faster-Whisper'), h('option', { value: 'openai' }, 'Whisper (openai-whisper)'));
  const file = h('input', { type: 'file', accept: 'video/*', hidden: true, onchange: () => file.files[0] && upload(file.files[0]) });
  const go = h('button.btn.primary', { onclick: () => start() }, 'Import');
  path.addEventListener('keydown', e => { if (e.key === 'Enter') start(); });

  const drop = h('div.drop',
    h('div.row', path, go),
    h('div.opts',
      h('div.field', h('span.label', 'Format'), aspect),
      h('div.field', h('span.label', 'Transcription'), model),
      h('div.field', h('span.label', 'Engine'), engine)),
    h('p.meta', 'Drop a video file anywhere in this box, ', h('button.link', { onclick: () => file.click() }, 'choose one'), ', paste a path (the file stays where it is), or paste a YouTube link (fetched with yt-dlp).'), file);
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) upload(f); });

  const list = h('div.plist');
  const tools = h('div.tools');
  clear(root).append(h('div.lib',
    h('p.eyebrow.accent', 'Cutroom'),
    h('h1.serif', 'Edit talking-head video by what you said.'),
    h('p.lead', 'Import a take. Cutroom transcribes it, cuts the pauses, retakes and filler, plans a storyboard with titles and transitions, and renders the finished video with ffmpeg. You approve the storyboard first. No model calls, no tokens.'),
    h('section', h('p.eyebrow', 'New edit'), drop),
    h('section', h('p.eyebrow', 'Projects'), list),
    h('section', h('p.eyebrow', 'Tools'), tools)));

  async function start() {
    const origin = path.value.trim();
    if (!origin) return toast('Paste a file path or a URL, or drop a file.');
    go.disabled = true;
    try {
      const { project } = await api.create({ origin, aspect: aspect.value, model: model.value, engine: engine.value });
      location.hash = `#/p/${project.id}`;
    } catch (e) { toast(e.message); go.disabled = false; }
  }

  async function upload(f) {
    toast(`Uploading ${f.name}…`, 6000);
    go.disabled = true;
    try {
      const { project } = await api.upload(f, { aspect: aspect.value, model: model.value, engine: engine.value });
      location.hash = `#/p/${project.id}`;
    } catch (e) { toast(e.message); go.disabled = false; }
  }

  const projects = await api.projects().catch(() => []);
  if (!projects.length) list.append(h('p.empty', 'No projects yet.'));
  for (const p of projects) {
    const del = h('button.link.danger', { onclick: async e => {
      e.stopPropagation();
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Click again to delete'; return; }
      await api.remove(p.id);
      item.remove();
    } }, 'Delete');
    const status = p.status === 'ready' ? `${p.exports ? `${p.exports} export${p.exports > 1 ? 's' : ''}` : 'Not rendered'}` : p.status === 'error' ? 'Import failed' : p.status === 'ingesting' ? 'Importing…' : p.status === 'rendering' ? 'Rendering…' : p.status;
    const item = h('div.pitem', { onclick: () => { location.hash = `#/p/${p.id}`; } },
      h('div.serif', p.name),
      h('div.acts', h('span.meta', new Date(p.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })), del),
      h('div.meta', [p.duration ? clock(p.duration) : null, p.aspect, status].filter(Boolean).join(' · ')));
    list.append(item);
  }

  const health = await api.health().catch(() => null);
  if (health) {
    for (const [name, t] of Object.entries(health.tools)) {
      if (name === 'whisper' && !t.ok) { tools.append(h('span.meta', 'whisper not installed (optional)')); continue; }
      tools.append(h('span', { class: `meta ${t.ok ? 'ok' : 'bad'}`, title: t.error || '' }, `${name} ${t.ok ? t.version || '' : `· ${t.error}`}`));
    }
    tools.append(h('span.meta', `Projects in ${health.home}`));
    if (!health.tools.whisper?.ok) engine.querySelector('option[value=openai]').disabled = true;
  }
}
