/* Probe: load each staged beat in headless Chromium and read what it does, without rendering video.
     start, end      R.START / R.END (absolute seconds)
     cues            R.cues: the beat's sound effects
     layers          layer names
     boxes           every 2 frames: the visible elements' boxes in u, per layer (for the lint), and
                     clips: windows whose visible content is cut off by the window body or title bar
     warnings        the kit's timing warnings (things scheduled after the beat ends, stray sounds)
   Cached in out/.probe/<beat>.json by the stage key. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { playwright } from './project.mjs';

const VERSION = 4;   // bump when what the probe records changes

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
          boxes.push({ t: Math.round(t * 1000) / 1000, seen, clips: clipped(U) });
        }
        return { start: R.START, end: R.END, cues: R.cues, layers: R.layers(), boxes, warnings: R.warnings || [] };

        // Visible content a window cuts off: [layer, window, side, u]. Content inside its own
        // overflow:hidden box (a belt, a marquee) is that box's business, not the window's.
        // data-bleed on a window (or an element) opts out.
        function clipped(U) {
          const out = [];
          for (const win of document.querySelectorAll('.layer .win')) {
            if (win.dataset.bleed != null) continue;
            const ws = getComputedStyle(win);
            if (ws.visibility === 'hidden' || +ws.opacity === 0 || ws.display === 'none') continue;
            const name = [win.closest('.layer').dataset.layer, win.id || 'win'];
            const bar = win.querySelector('.win__bar');
            if (bar && bar.scrollWidth - bar.clientWidth > 2) out.push([...name, 'title', Math.round((bar.scrollWidth - bar.clientWidth) / U * 10) / 10]);
            const body = win.querySelector('.win__body');
            if (!body || getComputedStyle(body).overflow === 'visible') continue;   // it doesn't clip: spilling out is the point
            const b = body.getBoundingClientRect();
            const ix0 = b.left + body.clientLeft, iy0 = b.top + body.clientTop, ix1 = ix0 + body.clientWidth, iy1 = iy0 + body.clientHeight;
            let worst = { bottom: 0, right: 0, top: 0, left: 0 };
            for (const d of body.querySelectorAll('*')) {
              if (d.closest('[data-bleed]')) continue;
              const cs = getComputedStyle(d);
              if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
              let a = d.parentElement, own = false;
              for (; a && a !== body; a = a.parentElement) if (getComputedStyle(a).overflow !== 'visible' || getComputedStyle(a).display === 'none' || +getComputedStyle(a).opacity === 0) { own = true; break; }
              if (own) continue;
              if (!d.children.length && !d.textContent.trim() && cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.borderTopWidth === '0px') continue;
              const r = d.getBoundingClientRect();
              if (r.width < 1 || r.height < 1) continue;
              worst.bottom = Math.max(worst.bottom, r.bottom - iy1); worst.right = Math.max(worst.right, r.right - ix1);
              worst.top = Math.max(worst.top, iy0 - r.top); worst.left = Math.max(worst.left, ix0 - r.left);
            }
            for (const [side, px] of Object.entries(worst)) if (px / U >= 0.5) out.push([...name, side, Math.round(px / U * 10) / 10]);
          }
          return out;
        }
      });
      await page.close();
      const out = { key, ...data };
      writeFileSync(f, JSON.stringify(out));
      res[id] = out;
    }
  } finally { await browser.close(); }
  return res;
}
