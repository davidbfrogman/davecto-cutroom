/* Placement lint: checks every beat's visible boxes (from the probe, every 2 frames) against the face
   no-go zone and the Instagram UI zone. Rules live in faces.mjs. Exceptions per beat in retro.json:
   "allow": ["face"] or ["safe"] (or both). */
import { faceAt, noGo, SAFE } from './faces.mjs';

const overlap = ([ax, ay, aw, ah], [bx, by, bw, bh]) =>
  Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx)) * Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));

/** Returns [{ beat, layer, el, kind: 'face'|'safe', from, to, worst }] (worst: % of zone covered, or u outside). */
export function lint(project, probes, faces) {
  const issues = [];
  const bottom = (faces?.height ?? 177.78) - SAFE.bottom;
  for (const [id, p] of Object.entries(probes)) {
    const allow = project.beat(id).allow || [];
    const open = new Map();                                  // key → issue being extended
    const hit = (key, mk, t, v) => {
      const cur = open.get(key);
      if (cur && t - cur.to < 0.15) { cur.to = t; cur.worst = Math.max(cur.worst, v); }
      else { const i = { ...mk, from: t, to: t, worst: v }; issues.push(i); open.set(key, i); }
    };
    for (const { t, seen } of p.boxes) {
      const f = faceAt(faces, t), zone = f && noGo(f);
      for (const [layer, el, x, y, w, h] of seen) {
        const r = [x, y, w, h];
        if (zone && !allow.includes('face')) {
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

export const describe = i => i.kind === 'face'
  ? `${i.beat} [${i.layer}] ${i.el}: covers ${i.worst}% of the face/chin zone, ${i.from.toFixed(2)}–${i.to.toFixed(2)}s`
  : `${i.beat} [${i.layer}] ${i.el}: ${i.worst}u into the Instagram UI zone, ${i.from.toFixed(2)}–${i.to.toFixed(2)}s`;
