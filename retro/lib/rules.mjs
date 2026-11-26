/* The placement rules, pure (no Node or DOM APIs): lib/faces.mjs, lib/zoom.mjs and the editor (served as
   rules.mjs) all use these, so the face zone is the same everywhere.

   The rules (the user's, Nov 2026; keep them here, not in anyone's head):
     - Don't cover the face. Ever, unless retro.json says allow: ["face"] for that beat.
     - Nothing right under the chin: the no-go zone runs from the brow to CHIN face-heights below
       the chin.
     - Prefer the space above the head. Below the chest is fine. Covering an on-screen card is fine.
     - Instagram UI: keep graphics inside x 0–86u, y 20u–(H-37u).
   Units: u = 1% of the frame width; boxes are [x, y, w, h] from the top-left. */

export const CHIN = 0.45;                       // no-go zone below the chin, in face heights
export const PAD_X = 0.12, PAD_TOP = 0.2;      // side and brow padding, in face sizes
export const SAFE = { x0: 0, x1: 86, y0: 20, bottom: 37 };

/** The no-go rectangle [x, y, w, h] in u for a face box. */
export function noGo([x, y, w, h]) {
  return [x - w * PAD_X, y - h * PAD_TOP, w * (1 + 2 * PAD_X), h * (1 + PAD_TOP + CHIN)];
}

/** The largest face at time t: the nearest sample that's in the same shot (never across a cut). */
export function faceAt(faces, t) {
  if (!faces?.samples.length) return null;
  const n = faces.samples.length, cuts = faces.cuts || [];
  let i = Math.max(0, Math.min(n - 1, Math.round(t * faces.fps)));
  const across = j => cuts.some(c => (faces.samples[j].t - c) * (t - c) < 0 || (t < c && faces.samples[j].t >= c));
  if (across(i)) i = Math.max(0, Math.min(n - 1, faces.samples[i].t > t ? i - 1 : i + 1));
  return faces.samples[i].faces[0] || null;
}
