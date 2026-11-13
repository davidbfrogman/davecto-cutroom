/* Probe: load each staged beat in headless Chromium and read what it does, without rendering video.
     start, end      R.START / R.END (absolute seconds)
     cues            R.cues: the beat's sound effects
     layers          layer names
     boxes           every 2 frames: the visible elements' boxes in u, per layer (for the lint)
   Cached in out/.probe/<beat>.json by the stage key. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { playwright } from './project.mjs';

const VERSION = 2;   // bump when what the probe records changes

export async function probe(project, ids, size = project.size) {
  const dir = join(project.out, '.probe');
  mkdirSync(dir, { recursive: true });
  const res = {}, todo = [];
  for (const id of ids) {
    const { work, key: k } = project.stage(id, size), key = `${k}:${VERSION}`;
    const f = join(dir, `${id}.json`);
    const hit = existsSync(f) && JSON.parse(readFileSync(f, 'utf8'));
    if (hit && hit.key === key) res[id] = hit; else todo.push({ id, work, key, f });
  }
  if (!todo.length) return res;
  const { chromium } = playwright();
  let browser;
  try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ channel: 'chrome' }); }
  try {
    const [W, H] = size;
    for (const { id, work, key, f } of todo) {
      const page = await browser.newPage({ viewport: { width: W, height: H } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(join(work, 'index.html')).href);
      await page.waitForFunction(() => !!window.__timelines?.root, null, { timeout: 15000 }).catch(() => {});
      if (errors.length) { await page.close(); throw new Error(`${id}: ${errors[0]}`); }
      const data = await page.evaluate(async () => {
        await document.fonts.ready;
        const R = window.R, tl = window.__timelines?.root;
        if (!tl) throw new Error('no timeline: did the beat call R.done(end)?');
        const U = window.innerWidth / 100, boxes = [];
        for (let t = R.START; t < R.END - 1e-6; t += 1 / 15) {   // overlays show [start, end)
          tl.seek(Math.max(0, t - R.START), false);
          const seen = [];
          for (const L of document.querySelectorAll('.layer')) {
            for (const el of L.children) {
              if (el.classList.contains('zoom')) continue;
              const cs = getComputedStyle(el);
              if (cs.visibility === 'hidden' || +cs.opacity === 0 || cs.display === 'none') continue;
              const r = el.getBoundingClientRect();
              if (r.width < 2 || r.height < 2) continue;
              seen.push([L.dataset.layer, el.id || el.className.split(' ')[0] || el.tagName.toLowerCase(),
                ...[r.left / U, r.top / U, r.width / U, r.height / U].map(v => Math.round(v * 10) / 10)]);
            }
          }
          boxes.push({ t: Math.round(t * 1000) / 1000, seen });
        }
        return { start: R.START, end: R.END, cues: R.cues, layers: R.layers(), boxes };
      });
      await page.close();
      const out = { key, ...data };
      writeFileSync(f, JSON.stringify(out));
      res[id] = out;
    }
  } finally { await browser.close(); }
  return res;
}
