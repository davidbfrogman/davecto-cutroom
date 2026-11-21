/* Placement lint: checks every beat's visible boxes (from the probe, every 2 frames) against the face
   no-go zone and the Instagram UI zone. Rules live in faces.mjs. Exceptions per beat in retro.json:
   "allow": ["face"] or ["safe"] (or both), or ["clip"] for a beat whose overflow is on purpose.
   Also reported: content a window cuts off (kind 'clip', from the probe) and the kit's timing
   warnings (kind 'timing'). */
import { faceAt, noGo, SAFE } from './faces.mjs';
import { NAMES } from './synth.mjs';

const overlap = ([ax, ay, aw, ah], [bx, by, bw, bh]) =>
  Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx)) * Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));

/** Returns [{ beat, layer, el, kind: 'face'|'safe', from, to, worst }] (worst: % of zone covered, or u outside). */
export function lint(project, probes, faces) {
  const issues = [];
  const bottom = (faces?.height ?? 177.78) - SAFE.bottom;
  for (const [id, p] of Object.entries(probes)) {
    const allow = project.beat(id).allow || [], behind = project.beat(id).behind || [];   // behind you: over the face is fine
    const open = new Map();                                  // key → issue being extended
    const hit = (key, mk, t, v) => {
      const cur = open.get(key);
      if (cur && t - cur.to < 0.15) { cur.to = t; cur.worst = Math.max(cur.worst, v); }
      else { const i = { ...mk, from: t, to: t, worst: v }; issues.push(i); open.set(key, i); }
    };
    for (const w of p.warnings || []) issues.push({ beat: id, kind: 'timing', msg: w });
    const bad = [...new Set((p.cues || []).map(c => c.s).filter(n => !NAMES.includes(n)))];
    if (bad.length) issues.push({ beat: id, kind: 'timing', msg: `unknown sound(s): ${bad.join(', ')} (see GUIDE.md › Sound)` });
    const sizes = new Map();
    for (const { seen } of p.boxes) for (const [layer, el, , , w, h] of seen) sizes.set(`${layer}/${el}`, [w, h]);
    for (const { t, clips = [] } of p.boxes) for (const [layer, el, side, u] of clips) {
      if (allow.includes('clip')) break;
      const [w, h] = sizes.get(`${layer}/${el}`) || [0, 0];
      hit(`c${layer}${el}${side}`, { beat: id, layer, el, kind: 'clip', side, size: side === 'bottom' || side === 'top' ? h : w }, t, u);
    }
    for (const { t, seen } of p.boxes) {
      const f = faceAt(faces, t), zone = f && noGo(f);
      for (const [layer, el, x, y, w, h] of seen) {
        const r = [x, y, w, h];
        if (zone && !allow.includes('face') && !behind.includes(layer)) {
          const pct = overlap(r, zone) / (zone[2] * zone[3]) * 100;
          if (pct >= 1) hit(`f${layer}${el}`, { beat: id, layer, el, kind: 'face' }, t, Math.round(pct));
        }
        if (!allow.includes('safe')) {
          const out = Math.max(SAFE.x0 - x, x + w - SAFE.x1, SAFE.y0 - y, y + h - bottom);
          if (out > 1) hit(`s${layer}${el}`, { beat: id, layer, el, kind: 'safe' }, t, Math.round(out * 10) / 10);
        }
      }
    }
  }
  return issues;
}

const fix = i => i.side === 'title' ? 'shorten the title/right text or widen it'
  : i.side === 'bottom' || i.side === 'top' ? `needs h ≥ ${Math.ceil((i.size + i.worst) * 2) / 2}, or h: 'auto', or smaller type`
  : `needs w ≥ ${Math.ceil((i.size + i.worst) * 2) / 2}, or smaller type`;
export const describe = i => i.kind === 'timing' ? `${i.beat}: ${i.msg}`
  : i.kind === 'clip' ? `${i.beat} [${i.layer}] ${i.el}: content cut off at the ${i.side} by ${i.worst}u, ${i.from.toFixed(2)}–${i.to.toFixed(2)}s (${fix(i)})`
  : i.kind === 'face'
  ? `${i.beat} [${i.layer}] ${i.el}: covers ${i.worst}% of the face/chin zone, ${i.from.toFixed(2)}–${i.to.toFixed(2)}s`
  : `${i.beat} [${i.layer}] ${i.el}: ${i.worst}u into the Instagram UI zone, ${i.from.toFixed(2)}–${i.to.toFixed(2)}s`;
