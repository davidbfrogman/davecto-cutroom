/* Test helpers: a fresh copy of the fixture project (2 beats over a 6 s test-pattern clip made with ffmpeg),
   and a Studio server on it with its own Trash. Nothing here touches real projects. */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RETRO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(homedir(), 'Library', 'Application Support', 'Cutroom');
export const playwright = () => createRequire(join(DATA, 'node_modules', 'x.js'))('playwright');

let clip = null;
function testClip() {                                    // made once per run, shared by every copy
  if (clip) return clip;
  const d = mkdtempSync(join(tmpdir(), 'retro-clip-')); clip = join(d, 'clip.mp4');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=360x640:r=30:d=6', '-f', 'lavfi', '-i', 'sine=f=220:d=6',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
  if (r.status) throw new Error('ffmpeg failed making the test clip');
  return clip;
}

/** A videos folder in /tmp with the fixture as <name>-retro and its clip next to it. Returns { root, dir }. */
export function fixture(name = 'fx', root = mkdtempSync(join(tmpdir(), 'retro-test-'))) {
  mkdirSync(root, { recursive: true });
  if (!existsSync(join(root, 'clip.mp4'))) cpSync(testClip(), join(root, 'clip.mp4'));
  const dir = join(root, `${name}-retro`);
  cpSync(join(RETRO, 'tests', 'fixture'), dir, { recursive: true });
  return { root, dir };
}
export const readCfg = dir => JSON.parse(readFileSync(join(dir, 'retro.json'), 'utf8'));
/** Change retro.json's beats: fn(cfg) edits it in place. */
export function editCfg(dir, fn) { const c = readCfg(dir); fn(c); writeFileSync(join(dir, 'retro.json'), JSON.stringify(c, null, 2) + '\n'); }

/** Start a Studio on a videos folder (own port, state file and Trash). Returns { url, stop, trash }. */
export async function studio(root, port = 4300 + Math.floor(Math.random() * 500), env = {}) {
  const trash = join(root, '.trash');
  const p = spawn(process.execPath, [join(RETRO, 'cli.mjs'), 'studio', '--port', String(port), '--no-open'], {
    env: { ...process.env, ...env, RETRO_STUDIO_CHILD: '1', RETRO_VIDEOS: root, RETRO_STUDIO_STATE: join(root, '.studio.json'), RETRO_TRASH: trash },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let log = ''; p.stdout.on('data', d => { log += d; }); p.stderr.on('data', d => { log += d; });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${url}/api/ping`).then(r => r.ok, () => false)) break;
    if (p.exitCode != null) throw new Error(`studio exited: ${log}`);
    await new Promise(r => setTimeout(r, 100));
  }
  return { url, trash, log: () => log, stop: () => new Promise(r => { if (p.exitCode != null) return r(); p.once('exit', r); p.kill('SIGTERM'); }) };
}
