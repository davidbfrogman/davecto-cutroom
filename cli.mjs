#!/usr/bin/env node
/*
  Cutroom from the terminal. Same pipeline as the app, no browser needed.

    node cli.mjs new <file | url> [--name "Title"] [--model small.en] [--engine faster|openai] [--aspect 9:16]
    node cli.mjs list
    node cli.mjs show <id>              storyboard as a script, with cuts and graphics
    node cli.mjs set <id> aspect=16:9 lut.id=film lut.intensity=0.6 captions.on=false
    node cli.mjs plan <id>              rebuild the storyboard from the transcript (drops edits)
    node cli.mjs render <id> [--preview]
    node cli.mjs luts
*/
import { ensureDirs, projectDir } from './lib/paths.mjs';
import { createProject, listProjects, loadProject, loadAnalysis, updateProject } from './lib/store.mjs';
import { startIngest } from './lib/ingest.mjs';
import { startRender } from './lib/render.mjs';
import { listLuts } from './lib/luts.mjs';
import { isUrl } from './lib/ytdlp.mjs';
import { plan } from './shared/plan.mjs';
import { buildTimeline, clock } from './shared/timeline.mjs';
import { basename, join, resolve } from 'node:path';

const cwd = process.env.INIT_CWD || process.cwd();

function parse(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      flags[k] = v;
    } else pos.push(a);
  }
  return { pos, flags };
}

function follow(job) {
  return new Promise((res, rej) => {
    let last = '';
    const draw = s => {
      const pct = `${Math.round(s.progress * 100)}`.padStart(3);
      const line = `${pct}%  ${s.message}`;
      if (line !== last) { process.stdout.write(`\r\x1b[2K${line.slice(0, process.stdout.columns ? process.stdout.columns - 1 : 120)}`); last = line; }
    };
    job.on('update', draw);
    job.on('end', s => {
      process.stdout.write('\n');
      if (s.status === 'done') res(s.result); else rej(new Error(s.error));
    });
  });
}

function setPath(obj, path, raw) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {};
  let v = raw;
  if (raw === 'true' || raw === 'false') v = raw === 'true';
  else if (raw === 'null') v = null;
  else if (/^-?\d+(\.\d+)?$/.test(raw)) v = Number(raw);
  o[keys[keys.length - 1]] = v;
}

function show(id) {
  const p = loadProject(id), a = loadAnalysis(id);
  if (!p.storyboard || !a) { console.log(`${id}: ${p.status}${p.error ? ` (${p.error})` : ''}`); return; }
  const tl = buildTimeline(p, a);
  const placed = new Map(tl.items.map(i => [i.id, i]));
  console.log(`${p.name}  ·  ${clock(p.source.duration)} → ${clock(tl.duration)}  ·  ${p.settings.aspect}  ·  LUT ${p.settings.lut?.id || 'none'}\n`);
  for (const sec of p.storyboard.sections) {
    const shots = p.storyboard.shots.filter(s => s.section === sec.id);
    if (!shots.length) continue;
    console.log(`── ${sec.title}`);
    for (const s of shots) {
      const it = placed.get(s.id);
      const text = s.kind === 'card' ? `[card] ${s.card?.title}` : a.words.slice(s.w0, s.w1 + 1).map(w => (s.cut && w.i in s.cut ? `\x1b[9m${w.text}\x1b[0m` : w.text)).join(' ');
      const mark = s.enabled === false ? '\x1b[2m✕' : ' ';
      const meta = it ? `${clock(it.start, true)} ${it.trans.type !== 'cut' ? it.trans.type : ''}${s.zoom > 1 ? ` z${s.zoom}` : ''}` : '';
      console.log(`${mark} ${meta.padEnd(16)} ${text}\x1b[0m${s.flag ? `\x1b[2m  ← ${s.flag.note}\x1b[0m` : ''}`);
      for (const o of s.overlays || []) console.log(`${' '.repeat(19)}+ ${o.type}: ${o.text}${o.sub ? ` / ${o.sub}` : ''}`);
    }
  }
}

async function main() {
  ensureDirs();
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parse(rest);
  switch (cmd) {
    case 'new': {
      const origin = pos[0];
      if (!origin) throw new Error('Usage: new <file | url>');
      const src = isUrl(origin) ? origin : resolve(cwd, origin);
      const p = createProject({ name: flags.name || (isUrl(origin) ? 'YouTube video' : basename(src)), origin: src });
      if (flags.aspect) updateProject(p.id, q => { q.settings.aspect = flags.aspect; });
      console.log(`Project ${p.id}  →  ${projectDir(p.id)}`);
      const r = await follow(startIngest(p.id, { model: flags.model, engine: flags.engine, language: flags.language }));
      console.log(`${r.words} words · ${r.retakes} retakes · ${r.fillers} fillers · ${r.repeats} repeats`);
      show(p.id);
      break;
    }
    case 'list':
      for (const p of listProjects()) console.log(`${p.id.padEnd(32)} ${p.status.padEnd(10)} ${clock(p.duration).padStart(6)}  ${p.name}`);
      break;
    case 'show':
      show(pos[0]);
      break;
    case 'set': {
      const [id, ...pairs] = pos;
      updateProject(id, p => { for (const kv of pairs) { const [k, ...v] = kv.split('='); setPath(p.settings, k, v.join('=')); } });
      console.log(JSON.stringify(loadProject(id).settings, null, 1));
      break;
    }
    case 'plan': {
      const id = pos[0];
      const a = loadAnalysis(id);
      updateProject(id, p => { p.storyboard = plan(a.words, { settings: p.settings, scenes: a.scenes }); });
      show(id);
      break;
    }
    case 'render': {
      const r = await follow(startRender(pos[0], { preview: !!flags.preview }));
      console.log(join(projectDir(pos[0]), 'exports', r.file));
      break;
    }
    case 'luts':
      for (const l of listLuts()) console.log(`${l.id.padEnd(24)} ${l.name.padEnd(22)} ${l.note}`);
      break;
    default:
      console.log('Commands: new <file|url> · list · show <id> · set <id> k=v… · plan <id> · render <id> [--preview] · luts');
  }
}

main().then(() => process.exit(0), e => { console.error(`\n${e.message}`); process.exit(1); });
