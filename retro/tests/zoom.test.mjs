/* Zooms (lib/zoom.mjs): the rules that pick each beat's zoom, the transform at any moment, the lint seeing the
   face where the zoom puts it, and the render's per-frame ffmpeg zoom landing on the same picture as the contact
   sheet's for the same moment (an earlier version ran a frame ahead). */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { lint } from '../lib/lint.mjs';
import { Project } from '../lib/project.mjs';
import { noGo } from '../lib/rules.mjs';
import { at, DEFAULT, ffZoom, ffZoomAt, mapBox, plan, setting } from '../lib/zoom.mjs';
import { editCfg, fixture } from './helpers.mjs';

const FH = 177.78;
const near = (a, b, msg, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${msg}: expected ${b}, got ${a}`);
/** faces.json with one face box the whole time. */
const facesWith = (box, len = 12) => ({ fps: 5, height: FH, cuts: [], samples: Array.from({ length: len * 5 }, (_, i) => ({ t: i / 5, faces: [box] })) });
const MID = [40, 60, 20, 20];                                 // a face a little above the middle
const LOW = [40, 115, 20, 20];                                // low in the frame: a centre push would lose the chin band
const beats = (zoom, n = 3) => Array.from({ length: n }, (_, i) => ({ id: `0${i + 1}`, start: i * 4, end: i * 4 + 4, zoom }));
const screen = (z, [x, y]) => [z.S * x + z.X, z.S * y + z.Y];

test('settings: no zoom and no project default stays as shot; the project default fills in', () => {
  assert.equal(setting(undefined, null).kind, 'off');
  assert.equal(setting(undefined, 'auto').kind, 'auto');
  assert.equal(setting({ kind: 'push' }, 'auto').kind, 'push');
  assert.equal(setting({ kind: 'push' }, null).to, DEFAULT.to);
  const { segs } = plan(beats(undefined), facesWith(MID));
  assert.deepEqual(segs, [], 'nothing to do');
  assert.deepEqual(at(segs, 5), { S: 1, X: 0, Y: 0 });
});

test('auto: the opening beat pops (quick zoom out, then the push), the rest push 100→125% about the centre', () => {
  const { resolved, segs } = plan(beats({ kind: 'auto' }), facesWith(MID));
  assert.deepEqual(resolved.map(r => r.does), ['pop', 'push', 'push']);
  near(at(segs, 0).S, DEFAULT.to, 'pop starts zoomed in');
  near(at(segs, DEFAULT.pop).S, 1, 'and is out to 100% after 0.2 s', 0.01);
  near(at(segs, 4).S, 1, 'the next beat starts at 100%');
  near(at(segs, 6).S, 1.125, 'halfway through it: halfway to 125%');
  near(at(segs, 7.999).S, 1.25, 'its end: 125%', 0.01);
  const z = at(segs, 6);
  assert.deepEqual(screen(z, [50, FH / 2]).map(v => Math.round(v * 1000) / 1000), [50, Math.round(FH / 2 * 1000) / 1000], 'about the centre: the centre stays put');
  near(at(segs, 12.5).S, 1, 'after the last beat: as shot');
});

test('auto pans (zooms about the face) when a centre push would carry the chin band under the caption', () => {
  const { resolved, segs } = plan(beats({ kind: 'auto' }), facesWith(LOW));
  assert.deepEqual(resolved.map(r => r.does), ['pop', 'pan', 'pan']);
  const c = [LOW[0] + LOW[2] / 2, LOW[1] + LOW[3] / 2];
  for (const t of [4.1, 6, 7.9]) {
    const [x, y] = screen(at(segs, t), c);
    near(x, c[0], `face centre x at ${t}`, 0.01); near(y, c[1], `face centre y at ${t}`, 0.01);
  }
  const push = plan(beats({ kind: 'push' }), facesWith(LOW));
  const [, y] = screen(at(push.segs, 7.99), c);
  assert.ok(y > c[1] + 5, 'a plain push about the centre would have carried the face down');
});

test('punch-in: on the word the picture jumps closer about the face, which holds still, then it drops back', () => {
  const { segs } = plan(beats({ kind: 'push', punch: [{ t: 5, dur: 1, by: 1.2 }] }), facesWith(MID));
  const c = [MID[0] + MID[2] / 2, MID[1] + MID[3] / 2];
  const before = at(segs, 4.999), during = at(segs, 5.001), after = at(segs, 6.001);
  near(during.S / before.S, 1.2, 'jumps 20% closer', 0.01);
  const a = screen(before, c), b = screen(during, c);
  near(a[0], b[0], 'face x holds', 0.05); near(a[1], b[1], 'face y holds', 0.05);
  near(after.S, at(plan(beats({ kind: 'push' }), facesWith(MID)).segs, 6.001).S, 'back to the push after dur');
});

test('the picture always covers the frame: no black edges, never below 100%', () => {
  for (const box of [MID, LOW, [0, 5, 15, 15], [85, 150, 15, 15]]) {
    const { segs } = plan(beats({ kind: 'auto', to: 1.5, punch: [{ t: 2, by: 1.4 }, { t: 9, by: 1.3, dur: 2 }] }), facesWith(box));
    for (let t = 0; t < 12; t += 0.05) {
      const z = at(segs, t);
      assert.ok(z.S >= 1 - 1e-9, `S ${z.S} at ${t}`);
      assert.ok(z.X <= 1e-6 && z.X >= 100 * (1 - z.S) - 1e-6, `X ${z.X} at ${t} (S ${z.S}, face ${box})`);
      assert.ok(z.Y <= 1e-6 && z.Y >= FH * (1 - z.S) - 1e-6, `Y ${z.Y} at ${t} (S ${z.S}, face ${box})`);
    }
  }
});

test('the lint checks the face where the zoom puts it', () => {
  const { dir } = fixture();
  const p = new Project(dir), probes = { '01-hello': { start: 0.2, end: 3.0 }, '02-second': { start: 3.0, end: 5.8 } };
  // a box just above the face's no-go zone as shot: clear without a zoom, covered once the push grows the face
  const face = p.faces().samples[0].faces[0], zone = noGo(face), box = [zone[0], zone[1] - 4, zone[2], 3.5];
  const pr = { '01-hello': { ...probes['01-hello'], cues: [], boxes: [{ t: 2.9, seen: [['main', 'win', ...box]], clips: [] }] } };
  const faceIssues = faces => lint(p, pr, faces).filter(i => i.kind === 'face');
  assert.equal(faceIssues(p.screenFaces(probes)).length, 0, 'no zoom: clear');
  editCfg(dir, c => { c.beats = { '01-hello': { zoom: { kind: 'pan', to: 1.4 } } }; });
  const q = new Project(dir), zoomed = q.screenFaces(probes);
  assert.equal(lint(q, pr, zoomed).filter(i => i.kind === 'face').length, 1, 'zoomed: the face has grown into the box');
  const z = at(q.zoom(probes).segs, 2.8);
  assert.deepEqual(zoomed.samples.find(s => s.t === 2.8).faces[0], mapBox(face, z).map(v => Math.round(v * 10) / 10), 'screen faces = the zoom applied to faces.json');
});

test('render and contact sheet agree on the frame (the per-frame zoom is on the right timestamp)', { timeout: 60000 }, () => {
  const d = mkdtempSync(join(tmpdir(), 'retro-zoom-')), clip = join(d, 'c.mp4');
  const ff = args => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r; };
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=360x640:r=30:d=3', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '10', clip]);
  const { segs } = plan([{ id: 'a', start: 0, end: 3, zoom: { kind: 'push', to: 1.5 } }], null);
  const n = 40, t = n / 30;                                    // a frame well into the push
  ff(['-i', clip, '-vf', `${ffZoom(segs, { w: 360, h: 640 })},select='eq(n\\,${n})'`, '-frames:v', '1', join(d, 'dyn.png')]);
  ff(['-i', clip, '-vf', `select='eq(n\\,${n})',${ffZoomAt(at(segs, t), { w: 360, h: 640 })}`, '-frames:v', '1', join(d, 'st.png')]);
  ff(['-i', clip, '-vf', `select='eq(n\\,${n})',scale=360:640`, '-frames:v', '1', join(d, 'plain.png')]);
  const psnr = (a, b) => /average:(inf|[\d.]+)/.exec(spawnSync('ffmpeg', ['-i', join(d, a), '-i', join(d, b), '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' }).stderr)?.[1];
  const same = psnr('dyn.png', 'st.png');
  assert.ok(same === 'inf' || +same > 60, `the same picture (PSNR ${same} dB; a frame off is ~40)`);
  assert.ok(+psnr('st.png', 'plain.png') < 30, 'and it is zoomed');
});
