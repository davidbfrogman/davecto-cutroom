/*
  yt-dlp: pull a video (or a section of one) from YouTube or any site it supports.
*/
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { YTDLP } from './paths.mjs';
import { run } from './proc.mjs';

export const isUrl = s => /^https?:\/\//i.test(String(s || '').trim());

/**
  Download url into dir as MP4 (≤1080p). sections: "*12-20" style ranges
  (yt-dlp --download-sections) to fetch only part of a long video.
  Resolves to the downloaded file path.
*/
export async function download(url, dir, { section, onProgress, onLine, signal } = {}) {
  const args = [
    '--no-playlist', '--newline', '--no-mtime', '--restrict-filenames',
    // YouTube needs a JavaScript runtime for some formats; Node is already here.
    '--js-runtimes', `node:${process.execPath}`,
    '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b',
    '--merge-output-format', 'mp4',
    '-o', join(dir, '%(title).60B-%(id)s.%(ext)s'),
    '--print', 'after_move:filepath',
  ];
  if (section) args.push('--download-sections', section, '--force-keyframes-at-cuts');
  args.push(url);
  const before = new Set(readdirSync(dir));
  let printed = '';
  await run(YTDLP, args, {
    signal,
    onStdoutLine: line => {
      const m = /\[download\]\s+([\d.]+)%/.exec(line);
      if (m) onProgress?.(Number(m[1]) / 100);
      else if (line.startsWith('/')) printed = line.trim();
      else if (line.trim()) onLine?.(line.trim());
    },
    onLine: line => line.trim() && onLine?.(line.trim()),
  });
  if (printed) return printed;
  const fresh = readdirSync(dir).filter(f => !before.has(f) && /\.(mp4|mkv|webm|mov)$/i.test(f));
  if (!fresh.length) throw new Error('yt-dlp finished but no video file appeared.');
  return join(dir, fresh.sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs)[0]);
}
