"""
A look = tone curve + neutral cast + chroma ceiling + skin correction (+ optional white-balance shift),
applied to Fujifilm F-Log2 (or F-Log) / F-Gamut and baked into a .cube.

Spec keys (all optional except the tone ones):
  floor_L, ceiling_L                 OKLab L of input black / of the brightest highlight
  skin_anchor, white_anchor          {reflectance, L}: where two scene reflectances land (sets contrast + pivot)
  tint                               {a_poly, b_poly, L_range, highlight_taper}: cast on neutrals vs lightness
  tint_offset                        [da, db] added to that cast
  chroma_ceiling                     {L_centres, table[L][hue/30deg]}: soft chroma limit; absent = no limit
  pre_wb                             [r, g, b] scene-linear gains before the tone curve (white balance shift)
  skin_key                           {hue, half, c0, c1}: colours near this graded hue (skin, wood, lamps) keep the
                                     rendering they'd have without pre_wb, like a colourist's skin key
  skin                               how to solve the skin correction from your footage:
                                       {"graded_a","graded_b","graded_chroma"}  match graded reference skin
                                       {"scope_deg": 123}                         put skin on that vectorscope angle
                                       {"rotation_deg", "chroma_gain"}            fixed values
"""
import numpy as np
from .colorlib import rgb_to_oklab, oklab_to_rgb_lin, to_enc, scope_angle
from .flog import to_709_linear, decode, encode, lut_input_to_signal

LUMA = np.array([0.2126, 0.7152, 0.0722])

class Look:
    def __init__(self, spec, curve='flog2'):
        self.spec, self.curve = spec, curve
        self.Yf, self.Yc = spec['floor_L'] ** 3, spec['ceiling_L'] ** 3
        g = lambda L: (L ** 3 - self.Yf) / (self.Yc - self.Yf)
        (r1, L1), (r2, L2) = [(spec[k]['reflectance'], spec[k]['L']) for k in ('skin_anchor', 'white_anchor')]
        k1, k2 = np.log(1 / g(L1) - 1), np.log(1 / g(L2) - 1)
        self.C = (k1 - k2) / np.log(r2 / r1); self.M = r1 * np.exp(k1 / self.C)
        self.wb = np.array(spec.get('pre_wb', [1.0, 1.0, 1.0]))
        self.rot, self.gain, self.skin_h = 0.0, 1.0, 30.0
        if 'chroma_ceiling' in spec:
            self.CT = np.array(spec['chroma_ceiling']['table']); self.LC = np.array(spec['chroma_ceiling']['L_centres'])

    # --- stages -------------------------------------------------------------------------------
    def tone(self, lin):
        r = np.maximum(lin, 0); return self.Yf + (self.Yc - self.Yf) * r ** self.C / (r ** self.C + self.M ** self.C)

    def tint(self, L):
        t = self.spec.get('tint'); off = np.array(self.spec.get('tint_offset', [0.0, 0.0]))
        if t is None: return np.zeros(np.shape(L) + (2,)) + off
        lmin, lmax = t['L_range']; Lc = np.clip(L, lmin, lmax)
        k = 1 - np.clip((L - lmax) / (1 - lmax), 0, 1) * (1 - t['highlight_taper'])
        return np.stack([np.polyval(t['a_poly'], Lc) * k, np.polyval(t['b_poly'], Lc) * k], -1) + off

    def cmax(self, L, h):
        CT, LC = self.CT, self.LC; HB = CT.shape[1]
        fi = np.clip((L - LC[0]) / (LC[1] - LC[0]), 0, len(LC) - 1); i0 = np.floor(fi).astype(int); i1 = np.minimum(i0 + 1, len(LC) - 1); wi = fi - i0
        fj = (h / (360 / HB) - 0.5) % HB; j0 = np.floor(fj).astype(int); j1 = (j0 + 1) % HB; wj = fj - j0
        return (1 - wi) * ((1 - wj) * CT[i0, j0] + wj * CT[i0, j1]) + wi * ((1 - wj) * CT[i1, j0] + wj * CT[i1, j1])

    def compress(self, L, ab, gain):
        if 'chroma_ceiling' not in self.spec: return ab * gain
        c = np.hypot(ab[..., 0], ab[..., 1]) + 1e-9; h = np.degrees(np.arctan2(ab[..., 1], ab[..., 0])) % 360
        cm = self.cmax(L, h); return ab * (cm * np.tanh(gain * c / cm) / c)[..., None]

    def rotate(self, ab, rot, half=45.0):
        c = np.hypot(ab[..., 0], ab[..., 1]); h = np.degrees(np.arctan2(ab[..., 1], ab[..., 0])) % 360
        dh = ((h - self.skin_h + 180) % 360) - 180
        w = np.where(abs(dh) < half, 0.5 * (1 + np.cos(np.pi * dh / half)), 0) * np.clip(c / 0.02, 0, 1)
        h2 = np.radians(h + rot * w); return np.stack([c * np.cos(h2), c * np.sin(h2)], -1)

    # --- pipelines ------------------------------------------------------------------------------
    def base_scene(self, lin, wb=True):     # scene-linear Rec.709 -> display Rec.709, tone only
        return to_enc(self.tone(lin * (self.wb if wb else 1.0)))

    def look_display(self, b, rot=None, gain=None):
        rot = self.rot if rot is None else rot; gain = self.gain if gain is None else gain
        lab = rgb_to_oklab(b); L = lab[..., 0]
        ab = self.compress(L, self.rotate(lab[..., 1:], rot), gain) + self.tint(L)
        lin = oklab_to_rgb_lin(np.concatenate([L[..., None], ab], -1))
        Y = np.clip(lin @ LUMA, 0, 1)[..., None]                 # out of gamut: pull toward its own grey
        hi = np.max(np.maximum(lin - 1, 0) / np.maximum(lin - Y, 1e-9), -1, keepdims=True)
        lo = np.max(np.maximum(-lin, 0) / np.maximum(Y - lin, 1e-9), -1, keepdims=True)
        return to_enc(np.clip(Y + (lin - Y) * np.clip(1 - np.maximum(hi, lo), 0, 1), 0, 1))

    def grade_scene(self, lin, strength=1.0):
        b = self.base_scene(lin); g = self.look_display(b)
        k = self.spec.get('skin_key')
        if k:                                # protect skin-range colours from the white-balance shift
            g0 = self.look_display(self.base_scene(lin, wb=False)); lab0 = rgb_to_oklab(g0)
            c = np.hypot(lab0[..., 1], lab0[..., 2]); h = np.degrees(np.arctan2(lab0[..., 2], lab0[..., 1])) % 360
            dh = ((h - k['hue'] + 180) % 360) - 180
            w = np.where(abs(dh) < k['half'], 0.5 * (1 + np.cos(np.pi * dh / k['half'])), 0) * np.clip((c - k['c0']) / (k['c1'] - k['c0']), 0, 1)
            g = g + (g0 - g) * w[..., None]
        return b + (g - b) * strength

    def grade(self, x, strength=1.0):       # LUT input (F-Log2 code values, NLE-normalised) -> display
        return self.grade_scene(to_709_linear(x, self.curve), strength)

    # --- skin calibration -----------------------------------------------------------------------
    def skin_inputs(self, samples):
        """LUT inputs for skin samples, white-balanced against a same-light neutral when one is given."""
        out = []
        for s in samples:
            ten = 'codes10' in s; c = np.array(s['codes10' if ten else 'codes'], float)
            x = (c - 64) / 876 if ten else (c - 16) / 219
            n = s.get('neutral_codes10' if ten else 'neutral_codes')
            if n is not None:
                nx = (np.array(n, float) - 64) / 876 if ten else (np.array(n, float) - 16) / 219
                lin = decode(lut_input_to_signal(x), self.curve); nl = decode(lut_input_to_signal(nx), self.curve)
                x = (encode(lin * nl.mean() / nl, self.curve) * 1023 - 64) / 876
            out.append(x)
        return np.array(out)

    def calibrate_skin(self, samples):
        sk = self.spec.get('skin', {})
        if 'rotation_deg' in sk:
            self.rot, self.gain, self.skin_h = sk['rotation_deg'], sk['chroma_gain'], sk['skin_hue']; return dict(sk)
        b = self.base_scene(to_709_linear(self.skin_inputs(samples), self.curve)); lab = rgb_to_oklab(b)
        self.skin_h = float(np.degrees(np.arctan2(lab[:, 2].mean(), lab[:, 1].mean())) % 360)
        if 'scope_deg' in sk:                           # put the mean graded skin on a vectorscope angle
            ang = lambda r: float(scope_angle(self.look_display(b, r, 1.0).mean(0))[0])
            lo, hi = -40.0, 40.0                        # scope angle rises as OKLab hue rotates toward yellow
            for _ in range(60):
                mid = (lo + hi) / 2
                if ang(mid) > sk['scope_deg']: hi = mid
                else: lo = mid
            self.rot, self.gain = (lo + hi) / 2, 1.0
            return dict(skin_hue=self.skin_h, rotation_deg=self.rot, chroma_gain=1.0, graded_scope=ang(self.rot))
        tgt_h = float(np.degrees(np.arctan2(sk['graded_b'], sk['graded_a'])) % 360); tgt_C = sk['graded_chroma']
        def graded(rot, gain):
            ab = self.compress(lab[:, 0], self.rotate(lab[:, 1:], rot), gain) + self.tint(lab[:, 0]); m = ab.mean(0)
            return float(np.degrees(np.arctan2(m[1], m[0])) % 360), float(np.hypot(ab[:, 0], ab[:, 1]).mean())
        rot, gain = 0.0, 1.0
        for _ in range(30):
            rot += ((tgt_h - graded(rot, gain)[0] + 180) % 360) - 180
            lo, hi = 0.05, 5.0
            for _ in range(60):
                gain = (lo + hi) / 2
                if graded(rot, gain)[1] > tgt_C: hi = gain
                else: lo = gain
        self.rot, self.gain = float(np.clip(rot, -30, 30)), gain
        return dict(skin_hue=self.skin_h, rotation_deg=self.rot, chroma_gain=self.gain, target_hue=tgt_h, target_chroma=tgt_C,
                    graded=graded(self.rot, self.gain), scope_of_mean=float(scope_angle(self.look_display(b).mean(0))[0]))

    def neutral_L_to_scene(self, L):
        """Scene grey level that this look renders at OKLab lightness L (before any white-balance shift)."""
        lo, hi = 1e-5, 50.0
        for _ in range(80):
            mid = np.sqrt(lo * hi)
            if np.cbrt(self.tone(np.array(mid))) > L: hi = mid
            else: lo = mid
        return mid

    def write_cube(self, path, title, strength=1.0, size=33):
        t = np.linspace(0, 1, size); bb, gg, rr = np.meshgrid(t, t, t, indexing='ij')
        out = self.grade(np.stack([rr, gg, bb], -1).reshape(-1, 3), strength)
        with open(path, 'w') as f:
            name = {'flog2': 'F-Log2', 'flog': 'F-Log'}[self.curve]
            f.write(f'TITLE "{title}"\n# Input: Fujifilm {name} / F-Gamut (legal range video). Output: Rec.709 gamma 2.4.\n')
            f.write(f'LUT_3D_SIZE {size}\nDOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n')
            np.savetxt(f, out, fmt='%.6f')
