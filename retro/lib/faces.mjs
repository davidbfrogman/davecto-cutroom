/* Faces and free space: where graphics may go.
   detect(): sample the video at 5 fps, find faces with Apple Vision (faces.swift), find scene cuts
   with ffmpeg, write faces.json. Boxes are stored in u (1% of frame width; the frame is 100 wide
   and 100*H/W tall), top-left origin.

   The rules (the user's, Nov 2026; keep them here, not in anyone's head):
     - Don't cover the face. Ever, unless retro.json says allow: ["face"] for that beat.
     - Nothing right under the chin: the no-go zone runs from the brow to CHIN face-heights below
       the chin.
     - Prefer the space above the head. Below the chest is fine. Covering an on-screen card is fine.
     - Instagram UI: keep graphics inside x 0–86u, y 20u–(H-37u). */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RETRO, sh } from './project.mjs';

export const CHIN = 0.45;                       // no-go zone below the chin, in face heights
export const PAD_X = 0.12, PAD_TOP = 0.2;      // side and brow padding, in face sizes
export const SAFE = { x0: 0, x1: 86, y0: 20, bottom: 37 };

function binary() {
  const src = join(RETRO, 'lib', 'faces.swift');
  const h = createHash('sha1').update(readFileSync(src)).digest('hex').slice(0, 10);
  const bin = join(RETRO, '.bin', `faces-${h}`);
  if (!existsSync(bin)) {
    mkdirSync(join(RETRO, '.bin'), { recursive: true });
    process.stdout.write('… compiling faces.swift (once) ');
    sh('swiftc', ['-O', src, '-o', bin]);
    chmodSync(bin, 0o755);
    console.log('done');
  }
  return bin;
}

export function detect(project, fps = 5) {
  const tmp = mkdtempSync(join(tmpdir(), 'retro-faces-'));
  try {
    const [VW, VH] = sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', project.video]).trim().split(',').map(Number);
    const aspect = VH / VW;
    // One decode: frames for Vision, and scene cuts from showinfo (it logs on stderr).
    const r = spawnSync('ffmpeg', ['-v', 'info', '-nostdin', '-i', project.video, '-filter_complex',
      `[0:v]scale=360:-2,split[a][b];[a]fps=${fps}[f];[b]select='gt(scene\\,0.3)',showinfo[s]`,
      '-map', '[f]', '-q:v', '4', join(tmp, '%05d.jpg'), '-map', '[s]', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.split('\n').slice(-5).join('\n')}`);
    const cuts = [...r.stderr.matchAll(/pts_time:([\d.]+)/g)].map(m => Math.round(+m[1] * 100) / 100);
    const raw = JSON.parse(sh(binary(), [tmp, String(fps)]));
    const samples = raw.map(s => ({
      t: s.t,
      faces: s.faces.map(([x, y, w, h]) => [x * 100, y * 100 * aspect, w * 100, h * 100 * aspect].map(v => Math.round(v * 10) / 10))
        .sort((a, b) => b[2] * b[3] - a[2] * a[3]),
    }));
    const out = { fps, height: Math.round(100 * aspect * 100) / 100, cuts, samples };
    writeFileSync(join(project.dir, 'faces.json'), JSON.stringify(out));
    return out;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** The largest face at time t: the nearest sample that's in the same shot (never across a cut). */
export function faceAt(faces, t) {
  if (!faces?.samples.length) return null;
  const n = faces.samples.length, cuts = faces.cuts || [];
  let i = Math.max(0, Math.min(n - 1, Math.round(t * faces.fps)));
  const across = j => cuts.some(c => (faces.samples[j].t - c) * (t - c) < 0 || (t < c && faces.samples[j].t >= c));
  if (across(i)) i = Math.max(0, Math.min(n - 1, faces.samples[i].t > t ? i - 1 : i + 1));
  return faces.samples[i].faces[0] || null;
}

/** The no-go rectangle [x, y, w, h] in u for a face box. */
export function noGo([x, y, w, h]) {
  return [x - w * PAD_X, y - h * PAD_TOP, w * (1 + 2 * PAD_X), h * (1 + PAD_TOP + CHIN)];
}

/** Free space over [a, b): worst case across every face sample in it (not the median, which hides
    the moment the speaker leans up into a window). Bands as [x0, y0, x1, y1] in u; null face = all free. */
export function freeOver(faces, a, b) {
  const H = faces.height, bottom = H - SAFE.bottom, r1 = v => Math.round(v);
  const zs = faces.samples.filter(s => s.t >= a - 1e-6 && s.t < b && s.faces[0]).map(s => noGo(s.faces[0]));
  const mid = faceAt(faces, (a + b) / 2);
  if (mid && !zs.length) zs.push(noGo(mid));
  if (!zs.length) return { face: false, above: [SAFE.x0, SAFE.y0, SAFE.x1, r1(bottom)] };
  const top = Math.min(...zs.map(z => z[1])), bot = Math.max(...zs.map(z => z[1] + z[3]));
  const lft = Math.min(...zs.map(z => z[0])), rgt = Math.max(...zs.map(z => z[0] + z[2]));
  return {
    face: true,
    above: [SAFE.x0, SAFE.y0, SAFE.x1, Math.max(SAFE.y0, Math.floor(top))],
    below: [SAFE.x0, Math.min(r1(bottom), Math.ceil(bot)), SAFE.x1, r1(bottom)],
    left: [SAFE.x0, SAFE.y0, Math.max(SAFE.x0, Math.floor(lft)), r1(bottom)],
    right: [Math.min(SAFE.x1, Math.ceil(rgt)), SAFE.y0, SAFE.x1, r1(bottom)],
  };
}

/** Free space through time: worst case per `step` seconds, neighbours merged while they stay within
    `tol` u of each other. [{ a, b, above, below, left, right }]. Never merges across a scene cut. */
export function zones(faces, a, b, { step = 0.5, tol = 4 } = {}) {
  const cuts = (faces.cuts || []).filter(c => c > a + 0.05 && c < b - 0.05);
  const edges = [a];
  for (let t = a; t < b - 1e-6;) { const c = cuts.find(c => c > t + 1e-6 && c < t + step); t = c ?? Math.min(b, t + step); edges.push(t); }
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const f = { a: edges[i], b: edges[i + 1], ...freeOver(faces, edges[i], edges[i + 1]) };
    const p = out.at(-1), same = p && !cuts.some(c => Math.abs(c - f.a) < 1e-6) && p.face === f.face &&
      ['above', 'below'].every(k => !f[k] || Math.abs(p[k][3] - f[k][3]) <= tol && Math.abs(p[k][1] - f[k][1]) <= tol);
    if (same) { p.b = f.b; for (const k of ['above', 'below', 'left', 'right']) if (f[k]) p[k] = [Math.max(p[k][0], f[k][0]), Math.max(p[k][1], f[k][1]), Math.min(p[k][2], f[k][2]), Math.min(p[k][3], f[k][3])]; }
    else out.push(f);
  }
  return out;
}
export const fmtZone = z => !z.face ? 'no face: all free' : `above y${z.above[1]}→${z.above[3]} (${z.above[3] - z.above[1]}u) · below y${z.below[1]}→${z.below[3]} (${z.below[3] - z.below[1]}u) · left x0→${z.left[2]} · right x${z.right[0]}→86`;

/** Scenes (between cuts) with the median face and the free bands around it, for placing graphics.
    The bands are the worst case over the scene (freeOver), so anything inside them is clear throughout. */
export function layout(faces, end) {
  const edges = [0, ...faces.cuts.filter(c => c > 0.2 && c < end - 0.2), end];
  const H = faces.height, bottom = H - SAFE.bottom;
  return edges.slice(0, -1).map((a, i) => {
    const b = edges[i + 1];
    const fs = faces.samples.filter(s => s.t >= a && s.t < b && s.faces[0]).map(s => s.faces[0]);
    if (!fs.length) return { a, b, face: null, free: { all: [SAFE.x0, SAFE.y0, SAFE.x1, bottom] } };
    const med = k => fs.map(f => f[k]).sort((p, q) => p - q)[fs.length >> 1];
    const face = [0, 1, 2, 3].map(med);
    const r1 = v => Math.round(v), w = freeOver(faces, a, b);
    return { a, b, face: face.map(r1), free: { above: w.above, below: w.below, left: w.left, right: w.right } };
  });
}
