/*
  Projects on disk. One folder per project under $CUTROOM_HOME/projects/<id>:

    project.json      settings, storyboard, source info, exports  (the thing you edit)
    transcript.json   raw recogniser output, words + envelope
    analysis.json     cleaned words, envelope + threshold, scene cuts, loudness
    proxy.mp4         small browser copy of the source
    source/           downloaded or uploaded originals (local paths are referenced, not copied)
    exports/          finished videos, captions (.srt), chapters (.txt)
    cache/            per-shot clips, graphics frames, thumbnails
*/
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BRAND_FILE, PROJECTS, projectDir } from './paths.mjs';
import { withDefaults } from '../shared/plan.mjs';

export function slugify(s) {
  return String(s || '').toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';
}

export function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 1));
  renameSync(tmp, file);
}

export const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

export function createProject({ name, origin }) {
  const id = `${slugify(name)}-${randomBytes(2).toString('hex')}`;
  const dir = projectDir(id);
  for (const d of ['', 'source', 'exports', 'cache']) mkdirSync(join(dir, d), { recursive: true });
  const now = new Date().toISOString();
  const project = { version: 1, id, name: name || id, createdAt: now, updatedAt: now, status: 'new', origin, source: null, settings: withDefaults(defaultBrand()), storyboard: null, exports: [] };
  writeJson(join(dir, 'project.json'), project);
  return project;
}

/** The user's saved brand (Settings → "Make this my default"), as settings to start from. */
function defaultBrand() {
  try { return existsSync(BRAND_FILE) ? JSON.parse(readFileSync(BRAND_FILE, 'utf8')) : {}; } catch { return {}; }
}

export function validId(id) {
  return typeof id === 'string' && /^[a-z0-9-]{1,64}$/.test(id) && existsSync(join(projectDir(id), 'project.json'));
}

export function loadProject(id) {
  if (!validId(id)) throw Object.assign(new Error(`No project ${id}`), { status: 404 });
  const p = readJson(join(projectDir(id), 'project.json'));
  p.settings = withDefaults(p.settings);
  return p;
}

export function saveProject(p) {
  p.updatedAt = new Date().toISOString();
  writeJson(join(projectDir(p.id), 'project.json'), p);
  return p;
}

/** Load, change, save, under one call so concurrent writers don't drop each other's fields. */
export function updateProject(id, fn) {
  const p = loadProject(id);
  fn(p);
  return saveProject(p);
}

export function loadAnalysis(id) {
  const f = join(projectDir(id), 'analysis.json');
  return existsSync(f) ? readJson(f) : null;
}

export function listProjects() {
  if (!existsSync(PROJECTS)) return [];
  return readdirSync(PROJECTS)
    .filter(validId)
    .map(id => {
      try {
        const p = readJson(join(projectDir(id), 'project.json'));
        return { id, name: p.name, status: p.status, error: p.error || null, createdAt: p.createdAt, updatedAt: p.updatedAt, duration: p.source?.duration || 0, aspect: p.settings?.aspect, exports: (p.exports || []).length, hasProxy: existsSync(join(projectDir(id), 'proxy.mp4')) };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function deleteProject(id) {
  if (!validId(id)) throw Object.assign(new Error(`No project ${id}`), { status: 404 });
  rmSync(projectDir(id), { recursive: true, force: true });
}
