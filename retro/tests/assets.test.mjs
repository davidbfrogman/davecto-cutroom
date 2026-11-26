/* Beat assets: files next to a beat's index.html (screenshots, logos) are copied into its render folder, and
   changing one changes the beat's key, so renders, probes and the preview pick it up. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers.mjs';
import { Project } from '../lib/project.mjs';

test('a beat folder\'s images are staged with it and keyed by their content', () => {
  const { dir } = fixture();
  const b = join(dir, 'beats', '01-hello');
  mkdirSync(join(b, 'img'), { recursive: true });
  writeFileSync(join(b, 'img', 'a.png'), 'one');
  writeFileSync(join(b, '.DS_Store'), 'x');
  const p = new Project(dir);
  const s1 = p.stage('01-hello');
  assert.equal(readFileSync(join(s1.work, 'img', 'a.png'), 'utf8'), 'one');
  assert.ok(!existsSync(join(s1.work, '.DS_Store')), 'dotfiles stay behind');
  assert.equal(p.stage('01-hello').key, s1.key, 'same files, same key');
  writeFileSync(join(b, 'img', 'a.png'), 'two');
  const s2 = p.stage('01-hello');
  assert.notEqual(s2.key, s1.key, 'an edited image changes the key');
  assert.equal(readFileSync(join(s2.work, 'img', 'a.png'), 'utf8'), 'two');
  const live = p.stage('01-hello', p.size, { live: true });
  assert.ok(existsSync(join(live.work, 'img', 'a.png')), 'the preview gets it too');
});
