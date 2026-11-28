/* Playwright tests of the editor (the preview page, served by the Studio at /p/<name>/) against the fixture
   project: a fresh /tmp copy per test, so they don't depend on each other.
   Run: node --test retro/tests/editor.test.mjs   (the whole suite: npm run retro:test) */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { editCfg, fixture, playwright, readCfg, studio } from './helpers.mjs';

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
/** setup(cfg): change the copy's retro.json before the page opens (edits the user made earlier). */
async function editor(setup = null) {
  const name = `ed${++n}`, { dir } = fixture(name, fx.root);
  if (setup) editCfg(dir, setup);
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
    && !document.querySelector('#insp .busy') && !document.querySelector('#insp input[data-a="bgain"]:disabled')), 'every beat to be ready', 30000);
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

  test('reset everything asks first, puts retro.json back as written, and can be undone', async () => {
    const edits = {
      '01-hello': { on: true, move: { main: [3, -2] }, hide: ['tag'], sfxGain: -4, time: { crop: [0.5, 2.8] } },
      '02-second': { on: false, sounds: { edit: {}, add: [{ t: 4, s: 'pop', vol: 0, layer: 'main' }] } },
    };
    const e = await editor(cfg => { cfg.beats = structuredClone(edits); });
    const beats = () => readCfg(e.dir).beats;

    // Cancel at the confirm: nothing changes
    await e.page.click('#pReset');
    await e.page.click('#resetMenu [data-r="all"]');
    await e.page.click('#resetMenu [data-r="no"]');
    await sleep(500);
    assert.deepEqual(beats(), edits, 'cancel leaves every edit alone');

    // Reset everything: every kind of edit goes, on every beat
    await e.page.click('#resetMenu [data-r="all"]');
    await e.page.click('#resetMenu [data-r="yes"]');
    await until(() => {
      const b = beats(), h = b['01-hello'] || {}, s2 = b['02-second'] || {};
      return !h.move && !h.hide && !h.sfxGain && !h.time && h.on !== false && s2.on !== false && !s2.sounds;
    }, 'retro.json back to the beats as written');
    await loaded(e.page);

    // Undo (the toast's button) brings all of it back
    await e.page.click('#toast #undoBtn');
    await until(() => {
      const b = beats(), h = b['01-hello'] || {};
      return h.move?.main?.join() === '3,-2' && h.hide?.join() === 'tag' && h.sfxGain === -4 && h.time?.crop?.join() === '0.5,2.8'
        && b['02-second']?.on === false && b['02-second']?.sounds?.add?.length === 1;
    }, 'undo to restore every edit');
    await loaded(e.page);
    await e.done();
  });
});

test('the Instagram UI toggle shows the Reels buttons over the video, scales with it, and is remembered', { timeout: 90000 }, async () => {
  const { page, dir, done } = await editor();
  await page.evaluate(() => localStorage.removeItem('retro.ig'));
  await page.reload();
  await until(async () => (await page.locator('#tlInner .blk').count()) === 2, 'the editor to load again', 30000);
  assert.equal(await page.locator('#ig').isVisible(), false, 'off by default');
  await page.locator('#pIg').click();
  assert.equal(await page.locator('#ig').isVisible(), true);
  assert.ok(await page.locator('#pIg').evaluate(el => el.classList.contains('on')));
  // the iPhone crops the frame's sides (shaded), and the like button sits inside the screen, on its right, below the middle
  const [st, ph, heart] = await Promise.all([page.locator('#stage').boundingBox(), page.locator('#ig .ig-phone').boundingBox(), page.locator('#ig .ig-at svg').nth(0).boundingBox()]);
  assert.ok(Math.abs((ph.x - st.x) / st.width - 0.051) < 0.004 && ph.height > st.height, 'the phone crops ~5u each side, and its screen runs past the video\'s bottom');
  const like = await page.locator('#ig .ig-at', { has: page.locator('svg') }).nth(1).boundingBox();
  assert.ok(like.x > ph.x + ph.width * 0.85 && like.x + like.width <= ph.x + ph.width, 'like button on the screen\'s right edge');
  assert.ok(like.y > st.y + st.height * 0.45, 'like button in the lower half');
  assert.ok(heart, 'icons drawn');
  assert.equal(await page.locator('#ig .ig-user b').textContent(), 'davecto');
  assert.equal(await page.locator('#ig').evaluate(el => getComputedStyle(el).pointerEvents), 'none', 'never gets in the way of dragging');
  await page.reload();                                       // remembered across reloads
  await until(async () => (await page.locator('#tlInner .blk').count()) === 2, 'the editor to load again', 30000);
  assert.equal(await page.locator('#ig').isVisible(), true, 'still on after a reload');
  await page.locator('#pIg').click();
  assert.equal(await page.locator('#ig').isVisible(), false);
  assert.equal(JSON.stringify(readCfg(dir)).includes('ig'), false, 'a view setting: nothing written to retro.json');
  await done();
});

describe('zoom', () => {
  // the picture is painted into #bg (the <video> is only the decoder), so the zoom is read off the canvas
  const scale = page => page.evaluate(() => { const m = /scale\(([\d.]+)\)/.exec(document.querySelector('#bg').style.transform); return m ? +m[1] : 1; });

  test('Auto zoom: every beat on auto, the video pushes in under the graphics, one undo takes it all back', async () => {
    const e = await editor();
    await seek(e.page, 2.0);
    assert.equal(await scale(e.page), 1, 'no zoom in this project yet');
    await e.page.locator('#pZoomAll').click();
    await until(() => e.beat('01-hello').zoom?.kind === 'auto' && e.beat('02-second').zoom?.kind === 'auto', 'auto on both beats in retro.json');
    assert.equal(e.beat('01-hello').zoom.to, 1.25);
    await until(async () => (await scale(e.page)) > 1.1, 'the video zoomed in at 2.0 s');
    const s = await scale(e.page);
    // 01-hello is the opening beat (0.2–3.0): a 0.2 s pop out, then the push from 0.4 s: at 2.0 s about 100→125% × 1.6/2.6
    assert.ok(Math.abs(s - (1 + 0.25 * 1.6 / 2.6)) < 0.02, `scale ${s} at 2.0 s`);
    const frame = await e.page.evaluate(() => [...document.querySelectorAll('#stage iframe')].find(f => f.src.includes('/01-hello/')).style.transform);
    assert.ok(!/translate/.test(frame), 'the graphics are never zoomed');
    await e.page.keyboard.press('Meta+z');
    await until(() => !e.beat('01-hello').zoom && !e.beat('02-second').zoom, 'one undo to take both back');
    await until(async () => (await scale(e.page)) === 1, 'the video as shot again');
    await e.done();
  });

  test('playing, the zoom moves with the frames: one step per new frame, painted with the picture', async () => {
    const e = await editor();
    await e.page.locator('#pZoomAll').click();
    await until(() => e.beat('01-hello').zoom?.kind === 'auto', 'auto in retro.json');
    await seek(e.page, 0.6);
    const r = await e.page.evaluate(async () => {
      const v = document.querySelector('#v'), bg = document.querySelector('#bg');
      v.muted = true; await v.play();
      let frames = 0, changes = 0, last = bg.style.transform;
      const cb = () => { frames++; v.requestVideoFrameCallback(cb); }; v.requestVideoFrameCallback(cb);
      const t0 = performance.now();
      await new Promise(done => (function loop() { if (bg.style.transform !== last) { changes++; last = bg.style.transform; } performance.now() - t0 < 1200 ? requestAnimationFrame(loop) : done(); })());
      v.pause();
      const px = bg.getContext('2d').getImageData(bg.width >> 1, bg.height >> 1, 1, 1).data;
      return { frames, changes, vop: getComputedStyle(v).opacity, px: px[0] + px[1] + px[2] };
    });
    assert.ok(r.frames >= 20, `frames played: ${r.frames}`);
    assert.ok(r.changes > 10, `the push moved: ${r.changes} steps`);
    assert.ok(r.changes <= r.frames + 1, `the zoom stepped ${r.changes} times over ${r.frames} frames: it should only move with a new frame`);
    assert.equal(r.vop, '0', 'the picture comes from the canvas, not the <video>');
    assert.ok(r.px > 0, 'the canvas holds the picture');
    await e.done();
  });

  test('the Zoom card: a kind, how far, and a punch-in on a word, all saved to retro.json', async () => {
    const e = await editor();
    await e.page.locator('#insp .zseg button[data-k="pan"]').click();
    await until(() => e.beat('01-hello').zoom?.kind === 'pan', 'pan in retro.json');
    const to = e.page.locator('#insp input[data-a="zto"]');
    await to.evaluate(el => { el.value = 140; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await until(() => e.beat('01-hello').zoom?.to === 1.4, 'to: 1.4');
    const opt = await e.page.locator('#insp select[data-a="padd"] option').nth(1).getAttribute('value');
    await e.page.locator('#insp select[data-a="padd"]').selectOption(opt);
    await until(() => e.beat('01-hello').zoom?.punch?.length === 1, 'a punch-in');
    assert.equal(e.beat('01-hello').zoom.punch[0].t, +opt, 'on the word picked');
    assert.equal(await e.page.locator('#insp .prow').count(), 1, 'listed in the card');
    await e.page.locator('#insp .prow [data-a="pdel"]').click();
    await until(() => !e.beat('01-hello').zoom?.punch, 'removed');
    await e.done();
  });
});
