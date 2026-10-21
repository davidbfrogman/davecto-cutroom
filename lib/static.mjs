/*
  Static file serving with Range support (video scrubbing needs it).
  Used by the app server and by the graphics renderer's private server.
*/
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { ASSETS, CUTROOM, USER_FONTS } from './paths.mjs';

export const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.srt': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.cube': 'text/plain; charset=utf-8',
};

/** URL prefix → folder. /assets is the bundled fonts and Cutaways CSS; /userfonts the user's own fonts. */
export const MOUNTS = [
  ['/ui/', join(CUTROOM, 'ui')],
  ['/graphics/', join(CUTROOM, 'graphics')],
  ['/shared/', join(CUTROOM, 'shared')],
  ['/assets/', ASSETS],
  ['/userfonts/', USER_FONTS],
];

/** Resolve a request path inside a root folder, refusing anything that escapes it. */
export function safeJoin(root, rel) {
  const p = normalize(join(root, decodeURIComponent(rel)));
  return p === root || p.startsWith(root + sep) ? p : null;
}

export function sendFile(req, res, file, { download } = {}) {
  if (!file || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end('Not found'); return; }
  const size = statSync(file).size;
  const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (download) headers['Content-Disposition'] = `attachment; filename="${download.replace(/"/g, '')}"`;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    if (start >= size || start < 0) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
    end = Math.min(end, size - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

/** Serve a mounted static path. Returns false if no mount matched. */
export function serveMounted(req, res, pathname) {
  for (const [prefix, root] of MOUNTS) {
    if (!pathname.startsWith(prefix)) continue;
    const file = safeJoin(root, pathname.slice(prefix.length));
    sendFile(req, res, file && existsSync(file) && statSync(file).isDirectory() ? join(file, 'index.html') : file);
    return true;
  }
  return false;
}

/** A throwaway server for the graphics page, on a random local port. */
export function staticServer() {
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (!serveMounted(req, res, pathname)) res.writeHead(404).end();
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}
