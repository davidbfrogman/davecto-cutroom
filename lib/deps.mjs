/*
  Cutroom's npm dependencies: Playwright (draws graphics), HyperFrames (renders
  animations) and GSAP (the animations' timeline library).

  In a checkout they're in ./node_modules (npm install). Installed as a Claude
  Code plugin, setup puts them in DATA/node_modules instead, so updating the
  plugin doesn't throw them away. Both places are tried, in that order.
*/
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { CUTROOM, DATA } from './paths.mjs';

export const HYPERFRAMES_VERSION = '0.8.80';
export const GSAP_VERSION = '3.14.2';
const ROOTS = [CUTROOM, DATA];

const find = rel => ROOTS.map(r => join(r, 'node_modules', rel)).find(existsSync) || null;

/** Where the playwright package is installed (its cli.js downloads browsers), or null. */
export const playwrightDir = () => find('playwright');

/** The playwright module, or a clear error. */
export function playwright() {
  const dir = find('playwright');
  if (!dir) throw new Error("Playwright isn't installed. Run Cutroom setup (the setup tool, or node setup.mjs).");
  return createRequire(join(dir, '..', 'x.js'))('playwright');
}

/** gsap.min.js on disk, so animations render offline. Null when not installed. */
export const gsapFile = () => find(join('gsap', 'dist', 'gsap.min.js'));

/** How to run the HyperFrames CLI: the installed one, else npx (downloads it once). */
export function hyperframes(args) {
  const bin = find(join('hyperframes', 'bin', 'hyperframes.mjs'));
  return bin ? [process.execPath, [bin, ...args]] : ['npx', ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, ...args]];
}

/** What's installed, for status and setup. */
export function depsReport() {
  return {
    playwright: !!find('playwright'),
    hyperframes: !!find(join('hyperframes', 'bin', 'hyperframes.mjs')),
    gsap: !!gsapFile(),
  };
}
