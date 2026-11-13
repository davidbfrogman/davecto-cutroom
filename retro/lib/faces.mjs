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

/** Scenes (between cuts) with the median face and the free bands around it, for placing graphics. */
export function layout(faces, end) {
  const edges = [0, ...faces.cuts.filter(c => c > 0.2 && c < end - 0.2), end];
  const H = faces.height, bottom = H - SAFE.bottom;
  return edges.slice(0, -1).map((a, i) => {
    const b = edges[i + 1];
    const fs = faces.samples.filter(s => s.t >= a && s.t < b && s.faces[0]).map(s => s.faces[0]);
    if (!fs.length) return { a, b, face: null, free: { all: [SAFE.x0, SAFE.y0, SAFE.x1, bottom] } };
    const med = k => fs.map(f => f[k]).sort((p, q) => p - q)[fs.length >> 1];
    const face = [0, 1, 2, 3].map(med);
    const [zx, zy, zw, zh] = noGo(face);
    const r1 = v => Math.round(v);
    return {
      a, b, face: face.map(r1),
      free: {
        above: [SAFE.x0, SAFE.y0, SAFE.x1, r1(zy)],                  // x0, y0, x1, y1
        below: [SAFE.x0, r1(zy + zh), SAFE.x1, r1(bottom)],
        left: [SAFE.x0, SAFE.y0, r1(zx), r1(bottom)],
        right: [r1(zx + zw), SAFE.y0, SAFE.x1, r1(bottom)],
      },
    };
  });
}
