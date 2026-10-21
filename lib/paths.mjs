/*
  Where things live.

  CUTROOM   this package: code, the editor, bundled fonts and animations
  HOME      the user's work: projects, renders and caches are big, so ~/Movies/Cutroom
            by default, or $CUTROOM_HOME. Their own fonts, music, B-roll, LUTs, animations
            and default look (brand.json) go here too.
  DATA      tools Cutroom installs for itself (the Python environment for transcription):
            ~/Library/Application Support/Cutroom, or $CUTROOM_DATA. Kept out of CUTROOM
            so updating the plugin doesn't throw it away.
*/
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CUTROOM = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ASSETS = join(CUTROOM, 'assets');
export const FONTS = join(ASSETS, 'fonts');
export const HOME = resolve(process.env.CUTROOM_HOME || join(homedir(), 'Movies', 'Cutroom'));
export const PROJECTS = join(HOME, 'projects');
export const USER_LUTS = join(HOME, 'luts');
export const USER_FONTS = join(HOME, 'fonts');
export const MUSIC = join(HOME, 'music');
export const BROLL = join(HOME, 'broll');
export const USER_MOTION = join(HOME, 'motion');
export const CACHE = join(HOME, 'cache');
export const BRAND_FILE = join(HOME, 'brand.json');
export const DATA = resolve(process.env.CUTROOM_DATA || join(homedir(), 'Library', 'Application Support', 'Cutroom'));
export const VENV = join(DATA, 'venv');

// The Python environment: Cutroom's own (setup), else a dev one in the package, else the system's.
const bin = [join(VENV, 'bin'), join(CUTROOM, '.venv', 'bin')].find(d => existsSync(join(d, 'python')));
export const PYTHON = bin ? join(bin, 'python') : 'python3';
export const YTDLP = bin && existsSync(join(bin, 'yt-dlp')) ? join(bin, 'yt-dlp') : 'yt-dlp';

export function ensureDirs() {
  for (const d of [PROJECTS, USER_LUTS, USER_FONTS, MUSIC, BROLL, USER_MOTION, CACHE]) mkdirSync(d, { recursive: true });
}

export const projectDir = id => join(PROJECTS, id);
