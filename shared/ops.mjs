/*
  Edit operations: the vocabulary Claude (or any script) uses to change a
  storyboard. Each op is a small JSON object; applyOps() applies a list to a
  copy of the project, all or nothing, and reports which shots changed.

  Words can be addressed by index (from get_storyboard) or by phrase ("by the
  way"), which is usually easier and survives re-transcription.

    { op: 'settings', set: { 'lut.id': 'film', 'captions.style': 'word', 'captions.font': 'serif' } }
    { op: 'shot', id, set: { enabled, zoom, fx, fy, motion, transition, broll, card, section } }
    { op: 'cut', shot, phrase | from,to, restore?: true }      cut (or restore) words
    { op: 'split', shot, at | phrase }                          new shot starts at that word
    { op: 'merge', shot }                                       join with the next shot
    { op: 'move', shot, before | after }                        reorder (takes the target's section)
    { op: 'overlay_add', shot, overlay: { type, text, sub, eyebrow, keyword, at, dur, phrase, name, vars, behind } }
    { op: 'overlay_update', id, set }
    { op: 'overlay_remove', id }
    { op: 'card_add', before | after, card: { title, sub, eyebrow, dur, motion?: { name, vars } } }
    { op: 'section', id, title }

  Pure module: runs in Node and the browser.
*/
import { tok } from './text.mjs';
import { withDefaults } from './plan.mjs';

const OVERLAY_TYPES = new Set(['headline', 'lowerThird', 'chapter', 'stat', 'keyword', 'quote', 'cta', 'motion']);
const SHOT_KEYS = new Set(['enabled', 'zoom', 'fx', 'fy', 'motion', 'transition', 'broll', 'card', 'section']);
const OVERLAY_KEYS = new Set(['text', 'sub', 'eyebrow', 'keyword', 'at', 'dur', 'word', 'enabled', 'name', 'vars', 'type', 'behind']);

const rid = p => `${p}${Math.random().toString(36).slice(2, 8)}`;

class OpError extends Error {}

/** Word indices in a shot matching a phrase (case and punctuation ignored). */
export function findPhrase(shot, words, phrase) {
  const want = String(phrase || '').split(/\s+/).map(tok).filter(Boolean);
  if (!want.length) throw new OpError('Empty phrase');
  for (let i = shot.w0; i + want.length - 1 <= shot.w1; i++) {
    let ok = true;
    for (let k = 0; k < want.length; k++) if (tok(words[i + k]?.text || '') !== want[k]) { ok = false; break; }
    if (ok) return Array.from({ length: want.length }, (_, k) => i + k);
  }
  throw new OpError(`"${phrase}" isn't in shot ${shot.id}`);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' ? { ...o[k] } : {};
  o[keys[keys.length - 1]] = value;
}

/**
  Apply ops to a project (not mutated). Returns { project, changed: [shot ids], notes: [string] }
  or throws with the failing op's index and reason.
*/
export function applyOps(project, ops, words) {
  const p = structuredClone(project);
  p.settings = withDefaults(p.settings);
  const sb = p.storyboard;
  if (!sb) throw new Error('No storyboard yet');
  const changed = new Set();
  const notes = [];
  const shot = sid => { const s = sb.shots.find(x => x.id === sid); if (!s) throw new OpError(`No shot ${sid}`); return s; };
  const overlayById = oid => {
    for (const s of sb.shots) { const o = (s.overlays || []).find(x => x.id === oid); if (o) return { s, o }; }
    throw new OpError(`No overlay ${oid}`);
  };
  const wordsOf = (s, op) => {
    if (s.kind !== 'talk') throw new OpError(`Shot ${s.id} has no words`);
    if (op.phrase) return findPhrase(s, words, op.phrase);
    const from = Number(op.from ?? op.at), to = Number(op.to ?? op.from ?? op.at);
    if (!(from >= s.w0 && to <= s.w1 && from <= to)) throw new OpError(`Words ${from}–${to} are outside shot ${s.id} (${s.w0}–${s.w1})`);
    return Array.from({ length: to - from + 1 }, (_, k) => from + k);
  };

  ops.forEach((op, n) => {
    try {
      switch (op.op) {
        case 'settings':
          for (const [k, v] of Object.entries(op.set || {})) setPath(p.settings, k, v);
          p.settings = withDefaults(p.settings);
          notes.push(`settings: ${Object.keys(op.set || {}).join(', ')}`);
          break;
        case 'shot': {
          const s = shot(op.id);
          for (const [k, v] of Object.entries(op.set || {})) {
            if (!SHOT_KEYS.has(k)) throw new OpError(`Can't set "${k}" on a shot`);
            if (v === null) delete s[k]; else s[k] = v;
          }
          changed.add(s.id);
          break;
        }
        case 'cut': {
          const s = shot(op.shot);
          s.cut = s.cut || {};
          for (const i of wordsOf(s, op)) { if (op.restore) delete s.cut[i]; else s.cut[i] = 'claude'; }
          changed.add(s.id);
          break;
        }
        case 'split': {
          const s = shot(op.shot);
          const i = op.phrase ? findPhrase(s, words, op.phrase)[0] : Number(op.at);
          if (!(i > s.w0 && i <= s.w1)) throw new OpError(`Can't split shot ${s.id} at word ${i}`);
          const a = {}, b = {};
          for (const [k, v] of Object.entries(s.cut || {})) (Number(k) < i ? a : b)[k] = v;
          const next = { ...structuredClone(s), id: rid('s'), w0: i, cut: b, overlays: (s.overlays || []).filter(o => o.word != null && o.word >= i), transition: { type: 'cut', duration: 0.3 }, flag: null };
          s.w1 = i - 1; s.cut = a; s.overlays = (s.overlays || []).filter(o => !(o.word != null && o.word >= i));
          sb.shots.splice(sb.shots.indexOf(s) + 1, 0, next);
          changed.add(s.id); changed.add(next.id);
          notes.push(`split ${s.id} → new shot ${next.id}`);
          break;
        }
        case 'merge': {
          const s = shot(op.shot);
          const next = sb.shots[sb.shots.indexOf(s) + 1];
          if (!next || s.kind !== 'talk' || next.kind !== 'talk' || next.w0 !== s.w1 + 1) throw new OpError(`Shot ${s.id} can't merge with the next shot`);
          s.w1 = next.w1; s.cut = { ...s.cut, ...next.cut }; s.overlays = [...(s.overlays || []), ...(next.overlays || [])];
          sb.shots.splice(sb.shots.indexOf(next), 1);
          changed.add(s.id);
          break;
        }
        case 'move': {
          const s = shot(op.shot);
          const target = shot(op.before || op.after);
          sb.shots.splice(sb.shots.indexOf(s), 1);
          sb.shots.splice(sb.shots.indexOf(target) + (op.after ? 1 : 0), 0, s);
          s.section = target.section;
          changed.add(s.id);
          break;
        }
        case 'overlay_add': {
          const s = shot(op.shot);
          const o = { id: rid('o'), at: 0.2, dur: 3, ...op.overlay };
          if (!OVERLAY_TYPES.has(o.type)) throw new OpError(`Unknown overlay type "${o.type}"`);
          if (o.type === 'motion' && !o.name) throw new OpError('A motion overlay needs the animation name');
          if (o.behind && o.type !== 'motion') throw new OpError('Only animations (type "motion") can sit behind the speaker');
          if (o.phrase) { o.word = findPhrase(s, words, o.phrase)[0]; delete o.phrase; }
          (s.overlays = s.overlays || []).push(o);
          changed.add(s.id);
          notes.push(`overlay ${o.id} (${o.type}) on ${s.id}`);
          break;
        }
        case 'overlay_update': {
          const { s, o } = overlayById(op.id);
          for (const [k, v] of Object.entries(op.set || {})) {
            if (!OVERLAY_KEYS.has(k)) throw new OpError(`Can't set "${k}" on an overlay`);
            if (v === null) delete o[k]; else o[k] = v;
          }
          if (o.behind && o.type !== 'motion') throw new OpError('Only animations (type "motion") can sit behind the speaker');
          if (o.type === 'motion') delete o.render;
          changed.add(s.id);
          break;
        }
        case 'overlay_remove': {
          const { s, o } = overlayById(op.id);
          s.overlays = s.overlays.filter(x => x !== o);
          changed.add(s.id);
          break;
        }
        case 'card_add': {
          const target = shot(op.before || op.after);
          const card = { id: rid('s'), kind: 'card', section: target.section, enabled: true, overlays: [],
            card: { eyebrow: '', title: '', sub: '', dur: 2, ...op.card }, transition: op.transition || { type: 'fade', duration: 0.3 } };
          sb.shots.splice(sb.shots.indexOf(target) + (op.after ? 1 : 0), 0, card);
          changed.add(card.id);
          notes.push(`card ${card.id}`);
          break;
        }
        case 'section': {
          const sec = sb.sections.find(x => x.id === op.id);
          if (!sec) throw new OpError(`No section ${op.id}`);
          sec.title = String(op.title || '');
          break;
        }
        default:
          throw new OpError(`Unknown op "${op.op}"`);
      }
    } catch (e) {
      const err = new Error(`Op ${n + 1} (${op.op}): ${e.message}`);
      err.status = 400;
      throw err;
    }
  });
  return { project: p, changed: [...changed], notes };
}

/** Which shots differ between two storyboards (for highlighting someone else's edits). */
export function diffShots(a, b) {
  const old = new Map((a?.shots || []).map(s => [s.id, JSON.stringify(s)]));
  const out = [];
  (b?.shots || []).forEach((s, k) => {
    if (old.get(s.id) !== JSON.stringify(s) || a?.shots?.[k]?.id !== s.id) out.push(s.id);
  });
  return out;
}
