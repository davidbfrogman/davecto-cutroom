/* retro preview: a local page that plays the video with every beat running live on top (no render),
   the sound effects mixed in the browser with the same synth as the export, and switches that
   write straight to retro.json. Plain node:http, no dependencies. */
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { duration, Project, RETRO } from './project.mjs';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg' };

function proxy(project) {
  const out = join(project.out, '.preview.mp4');
  if (existsSync(out) && statSync(out).mtimeMs > statSync(project.video).mtimeMs) return out;
  process.stdout.write('… making a light preview copy of the video (once) ');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', project.video, '-vf', 'scale=720:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
    '-g', '15', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out], { stdio: 'inherit' });
  if (r.status) throw new Error('ffmpeg failed making the preview copy');
  console.log('done');
  return out;
}

function sendFile(req, res, file) {
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  const size = statSync(file).size, type = TYPES[extname(file)] || 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1 });
    return createReadStream(file, { start: a, end: b }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}

export async function serve(project, port) {
  const video = proxy(project), len = duration(project.video);
  const fresh = () => new Project(project.dir);                 // re-read retro.json each request (hand edits win)
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), p = decodeURIComponent(url.pathname);
    try {
      if (p === '/') return sendFile(req, res, join(RETRO, 'preview', 'index.html'));
      if (p === '/synth.mjs') return sendFile(req, res, join(RETRO, 'lib', 'synth.mjs'));
      if (p === '/video.mp4') return sendFile(req, res, video);
      if (p === '/api/state' && req.method === 'GET') {
        const pr = fresh();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ size: pr.size, duration: len, sfxGain: pr.cfg.sfxGain || 0, faces: pr.faces(),
          beats: pr.beatIds().map(id => ({ id, ...pr.beat(id) })) }));
      }
      if (p === '/api/beat' && req.method === 'POST') {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          const { id, on, move, sfx } = JSON.parse(body), pr = fresh(), b = pr.beat(id);
          if (on != null) b.on = on;
          if (sfx != null) { if (sfx) delete b.sfx; else b.sfx = false; }
          if (move) {
            b.move = Object.fromEntries(Object.entries(move).filter(([, v]) => v[0] || v[1]).map(([k, [x, y]]) => [k, [Math.round(x * 10) / 10, Math.round(y * 10) / 10]]));
            if (!Object.keys(b.move).length) delete b.move;
          }
          pr.save();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id, ...b }));
        });
        return;
      }
      const w = /^\/work\/([^/]+)\/(.+)$/.exec(p);
      if (w) {
        const pr = fresh();
        if (!pr.beatIds().includes(w[1])) { res.writeHead(404); return res.end(); }
        const { work } = pr.stage(w[1], pr.size, { live: true });   // the page applies moves itself
        const f = normalize(join(work, w[2]));
        if (!f.startsWith(work)) { res.writeHead(403); return res.end(); }
        return sendFile(req, res, f);
      }
      res.writeHead(404); res.end('not found');
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end(String(e.stack || e));
    }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  console.log(`preview: http://localhost:${port}   (Ctrl-C to stop; changes save to ${join(project.dir, 'retro.json')})`);
}
