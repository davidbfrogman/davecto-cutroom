/*
  Crop math shared by the ffmpeg renderer and the canvas preview, so the frame
  you see in the browser is the frame you get in the MP4.

  zoom 1 = the largest region of the source with the output's aspect ratio.
  fx, fy = where the centre of attention sits in the source, 0..1.
*/

export function cropRect(srcW, srcH, outW, outH, zoom = 1, fx = 0.5, fy = 0.5) {
  const ar = outW / outH;
  let w = srcW, h = srcW / ar;
  if (h > srcH) { h = srcH; w = srcH * ar; }
  const z = Math.max(1, zoom || 1);
  w /= z; h /= z;
  const x = clamp(fx * srcW - w / 2, 0, srcW - w);
  const y = clamp(fy * srcH - h / 2, 0, srcH - h);
  return { x, y, w, h };
}

/** Same rect, rounded to even pixels for ffmpeg's crop filter. */
export function cropRectEven(srcW, srcH, outW, outH, zoom, fx, fy) {
  const r = cropRect(srcW, srcH, outW, outH, zoom, fx, fy);
  const e = v => Math.max(2, Math.floor(v / 2) * 2);
  const w = Math.min(e(r.w), srcW - (srcW % 2)), h = Math.min(e(r.h), srcH - (srcH % 2));
  const x = clamp(Math.floor(r.x / 2) * 2, 0, srcW - w), y = clamp(Math.floor(r.y / 2) * 2, 0, srcH - h);
  return { x, y, w, h };
}

/** Framing for a shot: per-shot values win over the project default. */
export function shotFraming(shot, settings = {}) {
  const f = settings.framing || {};
  return {
    zoom: shot.zoom ?? 1,
    fx: shot.fx ?? f.fx ?? 0.5,
    fy: shot.fy ?? f.fy ?? 0.42,
    motion: shot.motion || 'none',
  };
}

/** Zoom at local time t for a push-in/out, matching the ffmpeg expression. */
export function zoomAt(fr, t, dur) {
  const k = dur > 0 ? Math.min(1, Math.max(0, t / dur)) : 0;
  if (fr.motion === 'push') return fr.zoom * (1 + 0.06 * k);
  if (fr.motion === 'pull') return fr.zoom * (1.06 - 0.06 * k);
  return fr.zoom;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
