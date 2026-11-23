/* Playwright tests of Retro Studio against the fixture project (a /tmp copy, its own Trash).
   Run: npm run retro:test */
import assert from 'node:assert/strict';
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fixture, playwright, readCfg, studio } from './helpers.mjs';

let fx, srv, browser;
before(async () => {
  fx = fixture('fx');
  srv = await studio(fx.root);
  browser = await playwright().chromium.launch();
});
after(async () => { await browser?.close(); await srv?.stop(); });

/** A page that fails the test on any console error or page error. */
async function open(path) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  await page.goto(srv.url + path);
  return page;
}

describe('projects page', () => {
  test('lists projects with their details', async () => {
    const page = await open('/');
    const card = page.locator('.card[data-name="fx-retro"]');
    await card.waitFor();
    const text = await card.innerText();
    assert.match(text, /2 beats/);
    assert.match(text, /clip\.mp4/);
    assert.match(text, /0:06/);
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('lint runs as a job and the badge shows the result', async () => {
    const page = await open('/');
    const card = page.locator('.card[data-name="fx-retro"]');
    await card.waitFor();
    await card.locator('[data-act="job"][data-kind="lint"]').click();
    await card.locator('.badge', { hasText: /lint/ }).waitFor({ timeout: 30000 });
    assert.ok(existsSync(join(fx.dir, 'out', '.lint.json')));
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('delete asks first, then moves the folder to the Trash and keeps the video', async () => {
    const copy = join(fx.root, 'gone-retro');
    cpSync(fx.dir, copy, { recursive: true });
    const page = await open('/');
    const card = page.locator('.card[data-name="gone-retro"]');
    await card.waitFor();
    await card.locator('[data-act="menu"]').click();
    await card.locator('[data-act="delete"]').click();
    assert.ok(existsSync(copy), 'nothing happens before the confirm');
    await card.locator('[data-act="delete-yes"]').click();
    await card.waitFor({ state: 'detached' });
    assert.ok(!existsSync(copy));
    assert.ok(readdirSync(srv.trash).includes('gone-retro'));
    assert.ok(existsSync(join(fx.root, 'clip.mp4')), 'the source video stays');
    assert.ok(await page.locator('.card[data-name="fx-retro"]').isVisible());
    assert.deepEqual(page.errors, []);
    await page.close();
  });
});

export { open, fx, srv, readCfg };
