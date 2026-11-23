/* Playwright tests of the editor (the preview page, served by the Studio at /p/<name>/) against the fixture
   project: a fresh /tmp copy per test, so they don't depend on each other.
   Run: node --test retro/tests/editor.test.mjs   (the whole suite: npm run retro:test) */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { fixture, playwright, readCfg, studio } from './helpers.mjs';

let fx, srv, browser, n = 0;
before(async () => {
  fx = fixture('base');
  srv = await studio(fx.root);
  browser = await playwright().chromium.launch();
});
after(async () => { await browser?.close(); await srv?.stop(); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, what, ms = 10000) {                 // poll a condition instead of sleeping
  const t0 = Date.now();
  for (;;) {
    const r = await fn();
    if (r) return r;
    if (Date.now() - t0 > ms) assert.fail(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

/** A fresh copy of the fixture, opened in the editor with every beat loaded. Any console or page error fails the test. */
async function editor() {
  const name = `ed${++n}`, { dir } = fixture(name, fx.root);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  await page.goto(`${srv.url}/p/${name}-retro/`);
  await until(async () => (await page.locator('#tlInner .blk').count()) === 2 && (await page.locator('#insp .ihead').count()) === 1, 'both beats to load', 30000);
  await until(() => page.evaluate(() => document.querySelector('#v').readyState >= 2), 'the video to load', 30000);
  // every beat ready (its times in the list, nothing "Updating…"): a beat that finishes loading re-renders the
  // inspector, and a control picked before that would be swapped out from under the test
  await until(() => page.evaluate(() => [...document.querySelectorAll('#list .btime')].every(el => !el.textContent.includes('…'))
    && !document.querySelector('#insp .busy') && !document.querySelector('#insp [disabled]')), 'every beat to be ready', 30000);
  await sleep(300);                                          // let the first sync pass settle
  assert.equal(await page.locator('#insp h2').textContent(), '01-hello', 'the editor starts on the first beat, whichever loads first');
  await pickBeat(page, '01-hello');                          // say which beat the test works on; don't rely on a default
  return { page, dir, beat: id => readCfg(dir).beats?.[id] || {}, done: async () => { assert.deepEqual(page.errors, []); await page.close(); } };
}
/** Show a beat in the inspector by clicking its row in the list (doesn't move the playhead). */
async function pickBeat(page, id) {
  await page.locator('#list .brow', { hasText: id }).locator('.bname').click();
  await until(async () => (await page.locator('#insp h2').textContent()) === id, `${id} in the inspector`);
}
const seek = (page, t) => page.evaluate(t => { document.querySelector('#v').currentTime = t; }, t).then(() => sleep(250));
const time = page => page.evaluate(() => document.querySelector('#v').currentTime);
const undoDisabled = page => page.locator('#pUndo').isDisabled();
const mid = async loc => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const pps = page => page.evaluate(() => document.querySelector('#tlScroll').clientWidth / document.querySelector('#v').duration);   // px per second at "fit" zoom
const left = (page, sel) => page.locator(sel).evaluate(el => parseFloat(el.style.left));
const loaded = page => until(async () => !(await page.locator('#insp .busy').count()), 'the rebuild to finish');

describe('editor', () => {
  describe('undo / redo', () => {
    test('beat on/off switch', async () => {
      const e = await editor();
      await e.page.locator('#list .brow').first().locator('.sw').click();
      await until(() => e.beat('01-hello').on === false, 'on:false in retro.json');
      await e.page.keyboard.press('Meta+z');
      await until(() => e.beat('01-hello').on !== false, 'undo to switch it back on');
      await e.page.keyboard.press('Shift+Meta+z');
      await until(() => e.beat('01-hello').on === false, 'redo to switch it off again');
      await e.done();
    });

    test('hiding an animation with the eye button', async () => {
      const e = await editor();
      await e.page.locator('#insp .anim[data-l="tag"] .eye').click();
      await until(() => e.beat('01-hello').hide?.join() === 'tag', "hide: ['tag']");
      await loaded(e.page);
      await e.page.keyboard.press('Meta+z');
      await until(() => !e.beat('01-hello').hide?.length, 'undo to show it again');
      await loaded(e.page);
      await e.page.keyboard.press('Shift+Meta+z');
      await until(() => e.beat('01-hello').hide?.join() === 'tag', 'redo to hide it again');
      await e.done();
    });

    test('a slider drag through several values is one undo step', async () => {
      const e = await editor();
      assert.ok(await undoDisabled(e.page), 'nothing to undo yet');
      const gain = e.page.locator('#insp input[data-a="bgain"]');
      await gain.evaluate(async el => {
        for (const v of [-1, -2, -3, -4, -5]) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 30)); }
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await until(() => e.beat('01-hello').sfxGain === -5, 'sfxGain -5 in retro.json');
      assert.ok(!(await undoDisabled(e.page)));
      await e.page.keyboard.press('Meta+z');
      await until(() => !e.beat('01-hello').sfxGain, 'one undo to put the level back');
      assert.equal(await e.page.locator('#insp input[data-a="bgain"]').inputValue(), '0');
      assert.ok(await undoDisabled(e.page), 'the whole drag was a single step');
      await e.done();
    });
  });

  test('add sound lands on a playing layer and shows on the timeline', async () => {
    const e = await editor();
    await seek(e.page, 2.0);                                 // inside the tag layer's span
    await e.page.click('#addSnd');
    await e.page.waitForSelector('#picker .pk-item');
    await e.page.hover('#picker .pk-item');
    await e.page.locator('#picker .pk-add').first().click();
    const add = await until(() => e.beat('01-hello').sounds?.add?.length === 1 && e.beat('01-hello').sounds.add, 'sounds.add in retro.json');
    const spans = await e.page.evaluate(() => {
      const f = [...document.querySelectorAll('#stage iframe')].find(f => f.src.includes('/01-hello/'));
      return JSON.parse(JSON.stringify(f.contentWindow.R.LAYERS));
    });
    const L = spans[add[0].layer];
    assert.ok(L && L.start - 0.02 <= 2.0 && 2.0 <= L.end, `layer ${add[0].layer} plays at 2.0 s (${JSON.stringify(spans)})`);
    const snd = e.page.locator('#tlInner .snd.added');
    await snd.waitFor();
    assert.equal(await snd.count(), 1);
    const t = (await left(e.page, '#tlInner .snd.added')) / (await pps(e.page));
    assert.ok(Math.abs(t - 2.0) < 0.15, `the block sits at ${t.toFixed(2)} s, near 2.0`);
    await e.done();
  });

  test("clicking a beat or an animation doesn't move the playhead", async () => {
    const e = await editor();
    await seek(e.page, 1.0);
    assert.ok(Math.abs(await time(e.page) - 1.0) < 0.05);
    const clicks = [
      ['a beat on the timeline', () => e.page.locator('#tlInner .blk').first()],
      ['an animation on the timeline', () => e.page.locator('#tlInner .lyr[data-l="tag"]')],
      ['an animation in the inspector', () => e.page.locator('#insp .anim[data-l="main"] .aname')],
    ];
    for (const [what, loc] of clicks) {
      const [x, y] = await mid(loc());
      await e.page.mouse.click(x, y);
      await sleep(300);
      assert.ok(Math.abs(await time(e.page) - 1.0) < 0.05, `playhead stayed put after clicking ${what}`);
    }
    await e.done();
  });

  test('moving an animation on the timeline takes its sounds with it', async () => {
    const e = await editor();
    const P = await pps(e.page), dx = 0.5 * P;
    const pop = '#tlInner .snd[data-k^="pop@"]', lyr = '#tlInner .lyr[data-l="tag"]';
    const before = { pop: await left(e.page, pop), lyr: await left(e.page, lyr), open: await left(e.page, '#tlInner .snd[data-k^="open@"][data-i="0"]'), tick: await left(e.page, '#tlInner .snd[data-k^="tick@"][data-i="0"]') };
    const [x, y] = await mid(e.page.locator(lyr));
    await e.page.mouse.move(x, y); await e.page.mouse.down();
    await e.page.mouse.move(x + dx / 2, y, { steps: 5 }); await e.page.mouse.move(x + dx, y, { steps: 5 });
    await e.page.mouse.up();
    await until(() => e.beat('01-hello').ltime?.tag, 'ltime.tag in retro.json');
    await sleep(300); await loaded(e.page);                  // the beat rebuilt from retro.json
    const after = { pop: await left(e.page, pop), lyr: await left(e.page, lyr), open: await left(e.page, '#tlInner .snd[data-k^="open@"][data-i="0"]'), tick: await left(e.page, '#tlInner .snd[data-k^="tick@"][data-i="0"]') };
    const moved = after.lyr - before.lyr;
    assert.ok(Math.abs(moved - dx) < 6, `the block moved ${moved.toFixed(1)} px, wanted about ${dx.toFixed(1)}`);
    assert.ok(Math.abs(after.pop - before.pop - moved) < 4, `pop moved ${(after.pop - before.pop).toFixed(1)} px with the block (${moved.toFixed(1)})`);
    assert.ok(Math.abs(after.open - before.open) < 2 && Math.abs(after.tick - before.tick) < 2, "main's sounds stayed where they were");
    await e.done();
  });

  test('a rebuild never blanks the beat or its blocks', async () => {
    const e = await editor();
    await seek(e.page, 1.0);                                 // the playhead is inside 01-hello
    const sampling = e.page.evaluate(() => new Promise(done => {
      const seen = { frames: 0, minVisible: 99, maxIframes: 0, blkGone: 0, lyrGone: 0 }, t0 = performance.now();
      (function tick() {
        const ifr = [...document.querySelectorAll('#stage iframe')].filter(f => f.src.includes('/01-hello/'));
        seen.frames++; seen.maxIframes = Math.max(seen.maxIframes, ifr.length);
        seen.minVisible = Math.min(seen.minVisible, ifr.filter(f => getComputedStyle(f).visibility === 'visible').length);
        if (!document.querySelector('#tlInner .blk[data-i="0"]')) seen.blkGone++;
        if (document.querySelectorAll('#tlInner .lyr[data-i="0"]').length < 2) seen.lyrGone++;
        if (performance.now() - t0 < 1500) requestAnimationFrame(tick); else done(seen);
      })();
    }));
    await sleep(100);
    await e.page.locator('#insp .anim[data-l="tag"] .eye').click();   // hiding rebuilds the beat
    const seen = await sampling;
    await until(() => e.beat('01-hello').hide?.join() === 'tag', 'the hide to be saved');
    assert.ok(seen.frames > 20, `sampled ${seen.frames} frames`);
    assert.equal(seen.maxIframes >= 2, true, 'the rebuild really ran (a second iframe loaded alongside the first)');
    assert.equal(seen.minVisible, 1, 'a visible iframe on every frame');
    assert.equal(seen.blkGone, 0, 'the beat block stayed on the timeline');
    assert.equal(seen.lyrGone, 0, "the beat's animation blocks stayed on the timeline");
    await e.done();
  });
});
