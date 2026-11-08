"""
Measure reference frames: known-colour patches and whole-frame statistics -> what a look is made of.

Patches (in look.json) are boxes on extracted frames, in crop coordinates:
  {"frame": "ref2_005", "box": [x0, y0, x1, y1], "label": "white tee", "role": "neutral"}
Roles:
  neutral   something white/grey/black in real life -> the cast against lightness
            "white_anchor": true  a white in good light: sets where 90% reflectance lands
            "metal": true         measured but left out of the cast (metal mirrors its surroundings)
  skin      -> the graded skin target
            "skin_anchor": true   frontally key-lit skin: sets where 36% reflectance lands
"""
import glob, os
import numpy as np
from PIL import Image
from .colorlib import rgb_to_oklab, scope_angle

def load_frame(frames_dir, name, crop):
    """crop: [x0, y0, x1, y1], None for the whole frame, or a function frame name -> crop."""
    c = crop(name) if callable(crop) else crop
    im = Image.open(os.path.join(frames_dir, f'{name}.png')).convert('RGB')
    return np.asarray(im.crop(tuple(c)) if c else im, dtype=np.float64) / 255

def measure_patch(frames_dir, crop, p):
    x0, y0, x1, y1 = p['box']
    rgb = np.median(load_frame(frames_dir, p['frame'], crop)[y0:y1, x0:x1].reshape(-1, 3), 0)
    L, a, b = rgb_to_oklab(rgb); ang, sat = scope_angle(rgb)
    return dict(p, rgb=(rgb * 255).round(1).tolist(), L=float(L), a=float(a), b=float(b), C=float(np.hypot(a, b)),
                hue=float(np.degrees(np.arctan2(b, a)) % 360), scope=float(ang), scope_sat=float(sat))

def frame_names(frames_dir, pattern, skip=()):
    names = [os.path.basename(f)[:-4] for f in sorted(glob.glob(os.path.join(frames_dir, f'{pattern}.png')))]
    return [n for n in names if n not in set(skip)]

def frame_pixels(frames_dir, names, crop, ignore_rows=None, stride=3):
    """OKLab pixels of whole frames (inside the crop, minus an ignored band such as captions)."""
    px = []
    for n in names:
        a = load_frame(frames_dir, n, crop)
        if ignore_rows: a = np.concatenate([a[:ignore_rows[0]], a[ignore_rows[1]:]])
        px.append(a[::stride, ::stride].reshape(-1, 3))
    return rgb_to_oklab(np.concatenate(px))

def tint_fn(t):
    lmin, lmax = t['L_range']
    def tint(L):
        Lc = np.clip(L, lmin, lmax); k = 1 - np.clip((L - lmax) / (1 - lmax), 0, 1) * (1 - t['highlight_taper'])
        return np.stack([np.polyval(t['a_poly'], Lc) * k, np.polyval(t['b_poly'], Lc) * k], -1)
    return tint

def chroma_ceiling(lab, tint, L_bins=10, hue_bins=12, min_px=500, fallback=None):
    """99th-percentile chroma (cast removed) per lightness x hue bin, smoothed around the hue wheel."""
    L = lab[:, 0]; d = lab[:, 1:] - tint(L); Cd = np.hypot(d[:, 0], d[:, 1]); Hd = np.degrees(np.arctan2(d[:, 1], d[:, 0])) % 360
    LB = np.linspace(0, 1, L_bins + 1); hw = 360 / hue_bins; ceil = np.full((L_bins, hue_bins), np.nan)
    for i in range(L_bins):
        mL = (L >= LB[i]) & (L < LB[i + 1])
        if mL.sum() < min_px: continue
        for j in range(hue_bins):
            m = mL & (Hd >= j * hw) & (Hd < j * hw + hw)
            ceil[i, j] = np.percentile(Cd[m], 99) if m.sum() > min_px else np.percentile(Cd[mL], 99)
    ok = [i for i in range(L_bins) if not np.isnan(ceil[i]).all()]
    for i in range(L_bins):
        if np.isnan(ceil[i]).all(): ceil[i] = ceil[min(ok, key=lambda k: abs(k - i))]
    ceil = np.maximum((np.roll(ceil, 1, 1) + 2 * ceil + np.roll(ceil, -1, 1)) / 4, 0.03)
    return ceil, ((LB[:-1] + LB[1:]) / 2)

def reference(neutral, skin, lab):
    """Everything the base look needs, from measured patches and whole-frame OKLab pixels."""
    lab = lab.astype(np.float64); L = lab[:, 0]; out = {}
    out['floor_L'] = float(np.percentile(L, 0.2))
    out['ceiling_L'] = float(np.percentile(L, 99.9))
    key_skin = [p['L'] for p in skin if p.get('skin_anchor')]
    lit_white = [p['L'] for p in neutral if p.get('white_anchor')]
    if not key_skin or not lit_white: raise SystemExit('look.json needs at least one skin patch with "skin_anchor": true and one neutral with "white_anchor": true')
    out['skin_anchor'] = dict(L=float(np.mean(key_skin)), n=len(key_skin), reflectance=0.36)
    out['white_anchor'] = dict(L=float(np.median(lit_white)), n=len(lit_white), reflectance=0.90)
    out['L_percentiles'] = {str(p): float(np.percentile(L, p)) for p in (5, 25, 50, 75, 95)}
    neu = [p for p in neutral if not p.get('metal')]
    nl = np.array([p['L'] for p in neu]); na = np.array([p['a'] for p in neu]); nb = np.array([p['b'] for p in neu])
    pa, pb = np.polyfit(nl, na, 2), np.polyfit(nl, nb, 2)
    band = lambda lo, hi: (L >= lo) & (L < hi)
    taper = float(np.hypot(*np.median(lab[band(0.9, 1.0), 1:], 0)) / np.hypot(*np.median(lab[band(0.8, 0.9), 1:], 0)))
    out['tint'] = dict(a_poly=pa.tolist(), b_poly=pb.tolist(), L_range=[float(nl.min()), float(nl.max())], highlight_taper=taper, n=len(neu))
    tint = tint_fn(out['tint'])
    res = np.stack([na, nb], -1) - tint(nl); out['tint']['rms_residual'] = float(np.sqrt((res ** 2).sum(1).mean()))
    ceil, centres = chroma_ceiling(lab, tint)
    out['chroma_ceiling'] = dict(L_centres=centres.tolist(), hue_bin_deg=30, table=ceil.round(5).tolist())
    sk = np.array([[p['a'], p['b']] for p in skin]) - tint(np.array([p['L'] for p in skin]))
    out['skin'] = dict(hue=float(np.degrees(np.arctan2(sk[:, 1].mean(), sk[:, 0].mean())) % 360), chroma=float(np.hypot(sk[:, 0], sk[:, 1]).mean()),
                       scope_deg=[round(p['scope'], 1) for p in skin],
                       graded_a=float(np.mean([p['a'] for p in skin])), graded_b=float(np.mean([p['b'] for p in skin])),
                       graded_chroma=float(np.mean([p['C'] for p in skin])))
    return out

def raised_ceiling(lab, tint, base_table, min_px=300):
    """A look's own frames' 99th-percentile chroma per bin, where higher than the base grade's."""
    L = lab[:, 0]; dd = lab[:, 1:] - tint(L)
    Cd = np.hypot(dd[:, 0], dd[:, 1]); Hd = np.degrees(np.arctan2(dd[:, 1], dd[:, 0])) % 360
    CT = np.array(base_table); W = CT.copy(); used = np.zeros_like(CT, bool)
    for i in range(CT.shape[0]):
        for j in range(CT.shape[1]):
            m = (L >= i / 10) & (L < i / 10 + 0.1) & (Hd >= j * 30) & (Hd < j * 30 + 30)
            if m.sum() > min_px: W[i, j] = np.percentile(Cd[m], 99); used[i, j] = True
    W = np.maximum(np.where(used, (np.roll(W, 1, 1) + 2 * W + np.roll(W, -1, 1)) / 4, CT), CT)
    return W.round(5).tolist(), int(used.sum())
