/* Kit timing: how R.done (kit/retro.js) applies retime / crop / ltime / hide / videoEnd, read back through
   the real probe (headless Chromium). Times are video seconds; fixture words are in tests/fixture/words.json. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, editCfg, RETRO } from './helpers.mjs';
import { Project } from '../lib/project.mjs';
import { probe } from '../lib/probe.mjs';

const TOL = 0.02, FRAME = 1 / 30;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= TOL, `${msg || ''} expected ${b}, got ${a}`);
const words = JSON.parse(readFileSync(join(RETRO, 'tests', 'fixture', 'words.json'), 'utf8'));
const wt = w => words.find(x => x.w === w).t;                 // a word's start time
const H = '01-hello', S = '02-second';

/** Fresh fixture with `beats` set in retro.json, probed. Returns the probe results keyed by beat id. */
async function run(beats = {}) {
  const { dir } = fixture();
  editCfg(dir, c => { c.beats = beats; });
  return probe(new Project(dir), [H, S]);
}
const cue = (r, s) => r.cues.find(q => q.s === s);
const times = r => Object.fromEntries(r.cues.map(q => [q.s, q.t]));
// what 01-hello's cues are with no timing: the window's open (a frame-ish after "hello"), tick on "this", pop on "tiny"
const hello = r => ({ open: cue(r, 'open'), tick: cue(r, 'tick'), pop: cue(r, 'pop') });

test('1. no timing: beat shows as written, cues on their words, no warnings', { timeout: 120000 }, async () => {
  const base = await run();
  const r = base[H];
  near(r.start, 0.2, 'start'); near(r.end, 3.0, 'end');
  assert.deepEqual(r.src, { start: r.start, end: r.end });
  const { tick, pop, open } = hello(r);
  near(tick.t, wt('this'), 'tick on "this"'); near(pop.t, wt('tiny'), 'pop on "tiny"');
  assert.ok(open.t >= 0.2 && open.t < wt('there'), 'open comes right after "hello"');
  assert.equal(r.cues.length, 3);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(base[S].warnings, []);
  near(base[S].start, 3.0); near(base[S].end, 5.8);
  near(cue(base[S], 'coin').t, wt('here.'), 'coin on "here"');

  // setting then removing `time` changes nothing
  const { dir } = fixture();
  editCfg(dir, c => { c.beats[H] = { time: { retime: [1, 2.4] } }; });
  await probe(new Project(dir), [H]);
  editCfg(dir, c => { delete c.beats[H].time; });
  const again = (await probe(new Project(dir), [H]))[H];
  for (const k of ['start', 'end', 'src', 'warnings']) assert.deepEqual(again[k], r[k], k);
  assert.deepEqual(again.cues.map(q => [q.s, q.t, q.layer]), r.cues.map(q => [q.s, q.t, q.layer]));
});

test('2. stretch: retime [1.0, 2.4] maps every cue linearly', { timeout: 120000 }, async () => {
  const base = (await run())[H];
  for (const [a, b] of [[1.0, 2.4], [1.0, 5.2]]) {          // squeeze (x0.5) and slow down (x1.5)
    const r = (await run({ [H]: { time: { retime: [a, b] } } }))[H];
    near(r.start, a, 'start'); near(r.end, b, 'end');
    assert.deepEqual(r.src, base.src);                      // as written, untouched
    assert.equal(r.cues.length, base.cues.length);
    for (const q of base.cues) near(r.cues.find(x => x.s === q.s).t, a + (q.t - 0.2) * ((b - a) / 2.8), `${q.s} (${a}..${b})`);
    assert.deepEqual(r.warnings, []);
  }
});

test('3. cut: crop [1.0, 2.5] shows that window, drops sounds outside, keeps the rest in time', { timeout: 120000 }, async () => {
  const base = (await run())[H];
  const r = (await run({ [H]: { time: { crop: [1.0, 2.5] } } }))[H];
  near(r.start, 1.0); near(r.end, 2.5);
  assert.deepEqual(r.src, base.src);
  assert.equal(cue(r, 'open'), undefined, 'open (0.37) is before the cut');
  near(cue(r, 'tick').t, base.cues.find(q => q.s === 'tick').t);
  near(cue(r, 'pop').t, wt('tiny'));
  assert.equal(r.cues.length, 2);

  // a cut that ends before "tiny" drops the pop but keeps what's inside
  const e = (await run({ [H]: { time: { crop: [0.2, 1.5] } } }))[H];
  near(e.end, 1.5);
  assert.deepEqual(e.cues.map(q => q.s).sort(), ['open', 'tick']);
});

test('4. stretch + cut: crop is in output seconds, after the retime', { timeout: 120000 }, async () => {
  // retime [1.0, 2.4] puts open at 1.083, tick at 1.45, pop at 1.8; crop [1.5, 2.2] is read against those
  const r = (await run({ [H]: { time: { retime: [1.0, 2.4], crop: [1.5, 2.2] } } }))[H];
  near(r.start, 1.5); near(r.end, 2.2);
  near(r.src.start, 0.2); near(r.src.end, 3.0);             // R.SRC still the written beat
  assert.equal(cue(r, 'open'), undefined);                  // 1.083 is before the cut
  near(cue(r, 'tick').t, 1.0 + (wt('this') - 0.2) * 0.5, 'tick (mapped, then kept)');
  near(cue(r, 'pop').t, 1.0 + (wt('tiny') - 0.2) * 0.5, 'pop');
  assert.equal(r.cues.length, 2);
  // the cut can't reach outside the retimed span
  const w = (await run({ [H]: { time: { retime: [1.0, 2.4], crop: [0.0, 9.0] } } }))[H];
  near(w.start, 1.0); near(w.end, 2.4);
});

test('5. per-layer retime: moving the tag moves its pop, not main', { timeout: 120000 }, async () => {
  const base = (await run())[H];
  // The tag's natural span starts at "tiny" (R.show on W('tiny')); retime's start is where that span now begins,
  // so moving it +0.5 s puts the start at tiny + 0.5. (The end only sets the stretch; the pop sits at the start.)
  const la = wt('tiny') + 0.5;
  const r = (await run({ [H]: { ltime: { tag: { retime: [la, la + 0.6] } } } }))[H];
  near(cue(r, 'pop').t, base.cues.find(q => q.s === 'pop').t + 0.5, 'pop +0.5');
  for (const s of ['open', 'tick']) near(cue(r, s).t, base.cues.find(q => q.s === s).t, `${s} (main) unmoved`);
  assert.equal(r.cues.length, base.cues.length);
  near(r.start, 0.2); near(r.end, 3.0);                     // still inside the beat: it doesn't grow
});

test('6. per-layer crop: a tag cropped to end before "tiny" loses its pop, main keeps its sounds', { timeout: 120000 }, async () => {
  const base = (await run())[H];
  const r = (await run({ [H]: { ltime: { tag: { crop: [0.2, 1.5] } } } }))[H];
  assert.equal(cue(r, 'pop'), undefined);
  for (const s of ['open', 'tick']) near(cue(r, s).t, base.cues.find(q => q.s === s).t, s);
  near(r.start, 0.2); near(r.end, 3.0);                     // the beat itself isn't cut
  // and a crop that includes "tiny" keeps it
  const k = (await run({ [H]: { ltime: { tag: { crop: [1.5, 2.5] } } } }))[H];
  near(cue(k, 'pop').t, wt('tiny'));
});

test('7. videoEnd: a beat stretched past the 6.0 s clip is cut there, with a warning', { timeout: 120000 }, async () => {
  const r = (await run({ [S]: { time: { retime: [3.0, 7.0] } } }))[S];
  assert.ok(r.end <= 6.0 + FRAME, `end ${r.end}`);
  near(r.end, 6.0);
  near(r.start, 3.0);
  assert.ok(r.warnings.some(w => w.includes('past the end of the video')), JSON.stringify(r.warnings));
  assert.ok(r.cues.every(q => q.t <= 6.0), 'no sound after the end');
  // the coin (5.0 in the written beat) lands at 3 + 2.0 * 1.4286 = 5.857, inside; a later one would be dropped
  near(cue(r, 'coin').t, 3.0 + (wt('here.') - 3.0) * (4 / 2.8));
  // squeeze-free control: a beat that fits has no such warning
  assert.ok(!(await run())[S].warnings.some(w => w.includes('past the end')));
  // stretched so far that the coin lands after the end: dropped
  const far = (await run({ [S]: { time: { retime: [3.0, 12.0] } } }))[S];
  assert.ok(far.end <= 6.0 + FRAME);
  assert.equal(cue(far, 'coin'), undefined, 'coin at ~8.3 is past the end');
  assert.ok(far.cues.every(q => q.t <= 6.0));
});

test('8. hide: a hidden layer loses its sounds; main is untouched', { timeout: 120000 }, async () => {
  const base = (await run())[H];
  const r = (await run({ [H]: { hide: ['tag'] } }))[H];
  assert.equal(cue(r, 'pop'), undefined);
  for (const s of ['open', 'tick']) near(cue(r, s).t, base.cues.find(q => q.s === s).t, s);
  assert.equal(r.cues.length, 2);
  assert.deepEqual(r.layers, base.layers);                  // still reported (the preview lists it so it can be switched back on)
  near(r.start, 0.2); near(r.end, 3.0);
});
