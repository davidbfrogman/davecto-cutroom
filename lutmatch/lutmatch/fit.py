"""
Fit a family of looks from measurements and write the .cube files.

Look kinds (the "looks" list in look.json):
  reference   the measured grade itself (exactly one; the others build on it)
  wb          the reference grade under different light: a white-balance shift solved so a neutral lands
              where the reference renders the "targets" patches (sunlit concrete, a wall at dusk, ...)
              optional "skin_key": {half, c0, c1} keeps skin/wood/lamp colours on the reference rendering
              optional "ceiling_frames": {"pattern", "stride"}: saturation limits raised to those frames' (measured step)
  clean       no reference: neutral greys, skin on the skin line, broadcast exposure
              {"grey_ire": 42, "white_ire": 90, "skin_scope": 123}
  tone-only   the reference tone curve with no colour change
Every look takes "soft": 0.6 to also write a 60% version.
"""
import json, os
import numpy as np
from scipy.optimize import minimize
from .colorlib import rgb_to_oklab, to_lin
from .flog import LABEL
from .look import Look, LUMA

def wb_from(v):
    """Two free gains (R, B); G is set so a grey keeps its luminance."""
    r, b = np.exp(v); g = (1 - LUMA[0] * r - LUMA[2] * b) / LUMA[1]; return np.array([r, g, b])

def fit_wb(spec, base, targets, inherit, samples):
    def graded(lk, p):
        s = base.neutral_L_to_scene(p['L']); return rgb_to_oklab(lk.grade_scene(np.array([s, s, s])))
    def err(v):
        lk = Look(dict(spec, pre_wb=wb_from(v).tolist(), skin=inherit), base.curve); lk.calibrate_skin(samples)
        return sum((o[1] - p['a']) ** 2 + (o[2] - p['b']) ** 2 for p in targets for o in [graded(lk, p)])
    res = minimize(err, [0.0, 0.0], method='Nelder-Mead', options=dict(xatol=1e-6, fatol=1e-14))
    lk = Look(dict(spec, pre_wb=wb_from(res.x).tolist(), skin=inherit), base.curve); lk.calibrate_skin(samples)
    fit = [dict(label=p['label'], L=round(p['L'], 3), measured=[round(p['a'], 4), round(p['b'], 4)],
                fitted=[round(float(o[1]), 4), round(float(o[2]), 4)]) for p in targets for o in [graded(lk, p)]]
    return lk, fit

def build(spec, measured, camera, out_dir, sizes=(33, 65)):
    """Fit every look in spec['looks'] from measured.json and the camera profile (no media needed); write cubes."""
    ref = measured['reference']; curve = camera['curve']; samples = camera['samples']
    base_spec = {k: ref[k] for k in ('floor_L', 'ceiling_L', 'skin_anchor', 'white_anchor', 'tint', 'chroma_ceiling')}
    base_spec['skin'] = {k: ref['skin'][k] for k in ('graded_a', 'graded_b', 'graded_chroma')}
    base = Look(base_spec, curve); report = {}; looks = {}
    ref_name = next(l['name'] for l in spec['looks'] if l['kind'] == 'reference')
    report[ref_name] = dict(kind='reference', skin=base.calibrate_skin(samples)); looks[ref_name] = base
    inherit = dict(rotation_deg=base.rot, chroma_gain=base.gain, skin_hue=base.skin_h)   # skin shifts with the light
    for l in spec['looks']:
        name, kind = l['name'], l['kind']
        if kind == 'wb':
            sp = dict(base_spec); r = dict(kind='wb')
            m = measured['looks'].get(name, {})
            if 'ceiling' in m:                            # saturation limits raised to those of the look's own frames
                sp['chroma_ceiling'] = dict(base_spec['chroma_ceiling'], table=m['ceiling']['table'])
                r.update(ceiling_frames=m['ceiling']['frames'], ceiling_bins_raised=m['ceiling']['bins_raised'])
            targets = measured['looks'][name]['targets']
            lk, fit = fit_wb(sp, base, targets, inherit, samples)
            if 'skin_key' in l:
                key_hue = float(np.degrees(np.arctan2(ref['skin']['graded_b'], ref['skin']['graded_a'])) % 360)
                lk = Look(dict(lk.spec, skin_key=dict(hue=key_hue, **l['skin_key'])), curve); lk.calibrate_skin(samples)
                r['skin_key'] = lk.spec['skin_key']
            r.update(pre_wb=lk.spec['pre_wb'], fit=fit); report[name] = r; looks[name] = lk
        elif kind == 'clean':
            Lof = lambda ire: float(np.cbrt(to_lin(np.array(ire / 100))))
            sp = dict(floor_L=0.0, ceiling_L=1.0, tint=None, skin=dict(scope_deg=l.get('skin_scope', 123.0)),
                      skin_anchor=dict(reflectance=0.18, L=Lof(l.get('grey_ire', 42))), white_anchor=dict(reflectance=0.90, L=Lof(l.get('white_ire', 90))))
            lk = Look(sp, curve); report[name] = dict(kind='clean', skin=lk.calibrate_skin(samples)); looks[name] = lk
        elif kind == 'tone-only':
            looks[name] = base; report[name] = dict(kind='tone-only')
    for name, lk in looks.items():
        report[name]['tone'] = dict(contrast=lk.C, pivot=lk.M, L_at={str(r): round(float(np.cbrt(lk.tone(np.array(r)))), 3) for r in (0.05, 0.18, 0.36, 0.9, 4.0)})
    # write
    tag = LABEL[curve]; os.makedirs(out_dir, exist_ok=True); written = []
    for l in spec['looks']:
        name = l['name']; lk = looks[name]; title = l.get('title', name.replace('-', ' ').title())
        jobs = [(0.0 if l['kind'] == 'tone-only' else 1.0, '', title)]
        if l.get('soft'): jobs.append((l['soft'], '_soft', f'{title} soft'))
        for k, suf, t in jobs:
            for size in sizes:
                sub = '' if size == 33 else f'{size}-point/'
                os.makedirs(os.path.join(out_dir, sub or '.'), exist_ok=True)
                path = os.path.join(out_dir, f'{sub}{name}{suf}_{tag}_to_709{"" if size == 33 else f"_{size}"}.cube')
                lk.write_cube(path, f'{t} ({tag.replace("FLog", "F-Log")} to Rec709{"" if size == 33 else f", {size}"})', k, size)
                written.append(path)
    json.dump(dict(report=report), open(os.path.join(out_dir, 'fit.json'), 'w'), indent=1, default=float)
    return report, looks, written
