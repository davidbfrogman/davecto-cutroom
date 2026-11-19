/* Progress for the long steps of a render: run a tool while reading its output live, and draw a
   one-line bar. On a terminal the bar redraws in place; when the output is piped (a log, Claude) it
   prints a plain line every `pipeEvery` percent instead (0 = only the final line). No dependencies. */
import { spawn } from 'node:child_process';
import { basename } from 'node:path';

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** 4.2 → "4.2s", 135 → "2m 15s". */
export const secs = s => (s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`);

/** Run cmd and call onLine(text) for every line it prints (stdout and stderr; \r counts as a line
    break, colours stripped). Rejects with the last 25 lines if it fails, like sh(). */
export function run(cmd, args, onLine = () => {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }), tail = [];
    const reader = () => {
      let buf = '';
      return d => {
        const parts = (buf + d).split(/\r\n|\r|\n/);
        buf = parts.pop();
        for (const raw of parts) {
          const line = raw.replace(ANSI, '');
          if (!line.trim()) continue;
          tail.push(line); if (tail.length > 25) tail.shift();
          onLine(line);
        }
      };
    };
    p.stdout.setEncoding('utf8').on('data', reader());
    p.stderr.setEncoding('utf8').on('data', reader());
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`${basename(cmd)} failed:\n${tail.join('\n')}`))));
  });
}

/** A progress line: bar.update(0–1, note) as it goes, bar.done(message) to finish it. */
export function bar(label, { pipeEvery = 10 } = {}) {
  const tty = !!process.stdout.isTTY, t0 = Date.now();
  let shown = -1;
  const elapsed = () => (Date.now() - t0) / 1000;
  return {
    elapsed,
    update(frac, note = '') {
      const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
      if (tty) {
        const w = 24, n = Math.round(pct / 100 * w), cols = process.stdout.columns || 100;
        let line = `  ${label}  ${'█'.repeat(n)}${'░'.repeat(w - n)} ${String(pct).padStart(3)}%  ${note}`;
        if (line.length > cols - 1) line = line.slice(0, cols - 2) + '…';
        process.stdout.write(`\r\x1b[2K${line}`);
      } else if (pipeEvery && Math.floor(pct / pipeEvery) > shown) {
        shown = Math.floor(pct / pipeEvery);
        console.log(`  ${label} ${pct}%  ${note}`);
      }
    },
    done(msg) {
      if (tty) process.stdout.write('\r\x1b[2K');
      console.log(msg);
    },
  };
}
