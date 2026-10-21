/*
  Child processes: run a command and collect output, or run ffmpeg and report
  progress from its -progress stream.
*/
import { spawn } from 'node:child_process';

export class Cancelled extends Error {
  constructor() { super('Cancelled'); this.cancelled = true; }
}

/**
  Run a command. Resolves { stdout, stderr } on exit 0, rejects with the tail
  of stderr otherwise. onLine gets stderr lines as they arrive.
*/
export function run(cmd, args, { onLine, onStdoutLine, signal, cwd, input } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) return reject(new Cancelled());
    const child = spawn(cmd, args, { cwd, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', errBuf = '', outBuf = '';
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', d => {
      stdout += d;
      if (!onStdoutLine) return;
      outBuf += d;
      const lines = outBuf.split('\n');
      outBuf = lines.pop();
      lines.forEach(onStdoutLine);
    });
    child.stderr.on('data', d => {
      stderr += d;
      if (stderr.length > 2e6) stderr = stderr.slice(-1e6);
      if (!onLine) return;
      errBuf += d;
      const lines = errBuf.split(/\r?\n|\r/);
      errBuf = lines.pop();
      lines.forEach(onLine);
    });
    if (input) { child.stdin.end(input); }
    child.on('error', e => reject(e.code === 'ENOENT' ? new Error(`${cmd} not found. Run Cutroom setup (bash setup.sh).`) : e));
    child.on('close', code => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new Cancelled());
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${cmd.split('/').pop()} exited ${code}: ${stderr.trim().split('\n').slice(-6).join('\n')}`));
    });
  });
}

/** ffmpeg with progress: onProgress(0..1) based on out_time against the expected duration. */
export function ffmpeg(args, { duration, onProgress, signal } = {}) {
  const full = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', ...args];
  return run('ffmpeg', full, {
    signal,
    onStdoutLine: line => {
      const m = /^out_time_us=(\d+)/.exec(line);
      if (m && duration && onProgress) onProgress(Math.min(1, Number(m[1]) / 1e6 / duration));
    },
  });
}
