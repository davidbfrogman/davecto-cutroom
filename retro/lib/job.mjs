/* One Studio job in its own process: node lib/job.mjs <kind> '<json args>'. The Studio server (lib/studio.mjs)
   starts it with an IPC channel and RETRO_JOB=1, so progress bars arrive as messages (lib/progress.mjs) and
   everything printed arrives as log lines. Cancelling kills the process group. The work itself is the same
   lib functions the CLI calls: one implementation, two front ends.
     → { t: 'bar', label, frac, note }   progress (from bar() or step())
     → { t: 'result', result }           finished
     → { t: 'error', message }           failed */
import { detect } from './faces.mjs';
import { lintProject } from './lint.mjs';
import { report } from './progress.mjs';
import { checkDeps, createProject, Project, transcribe } from './project.mjs';
import { framesAll, renderProject } from './render.mjs';

const [kind, raw = '{}'] = process.argv.slice(2), a = JSON.parse(raw);
const step = (label, frac = 0, note = '') => { report({ t: 'bar', label, frac, note }, true); console.log(`… ${label}${note ? ` (${note})` : ''}`); };
const P = () => new Project(a.dir);

async function words(p, redo) {
  checkDeps();
  step('transcribing', 0.05, 'faster-whisper small.en, about a minute');
  const said = transcribe(p, redo); if (said) console.log(said);
  step('finding faces and scene cuts', 0.6);
  const f = detect(p);
  console.log(`faces: ${f.samples.length} samples, cuts at ${f.cuts.join(', ') || 'none'}`);
  return {};
}

const kinds = {
  async new() {
    checkDeps();
    const dir = createProject(a.video, a.dir || undefined);
    process.send({ t: 'project', dir });
    await words(new Project(dir), false);
    return { dir };
  },
  transcribe: () => words(P(), true),
  async lint() { const { issues } = await lintProject(P()); return { count: issues.length }; },
  async frames() { return { file: await framesAll(P()) }; },
  async render() { return { file: await renderProject(P(), { draft: !!a.draft }) }; },
};

const send = (msg, code) => process.send(msg, () => process.exit(code));
try {
  if (!kinds[kind]) throw new Error(`unknown job ${kind}`);
  send({ t: 'result', result: await kinds[kind]() }, 0);
} catch (e) {
  console.error(e.stack || e.message);
  send({ t: 'error', message: e.message }, 1);
}
