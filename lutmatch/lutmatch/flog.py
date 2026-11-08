"""Fujifilm F-Log / F-Log2 (F-Gamut = BT.2020 primaries, D65), from Fujifilm's data sheets."""
import numpy as np

CURVES = {
    'flog':  dict(a=0.555556, b=0.009468, c=0.344676, d=0.790453, e=8.735631, f=0.092864, cut2=0.100537775223865),
    'flog2': dict(a=5.555556, b=0.064829, c=0.245281, d=0.384316, e=8.799461, f=0.092864, cut2=0.100686685370811),
}
LABEL = {'flog': 'FLog', 'flog2': 'FLog2'}
BT2020_TO_709 = np.array([[1.660491, -0.587641, -0.072850],
                          [-0.124550, 1.132900, -0.008349],
                          [-0.018151, -0.100579, 1.118730]])

def lut_input_to_signal(x):
    """NLEs and ffmpeg hand a LUT legal-range video normalised (code 64 -> 0, 940 -> 1).
    Fujifilm's formula is in code value / 1023, so put the offset back."""
    return (np.asarray(x) * 876 + 64) / 1023

def decode(v, curve):
    p = CURVES[curve]
    return np.where(v >= p['cut2'], (10 ** ((v - p['d']) / p['c']) - p['b']) / p['a'], (v - p['f']) / p['e'])

def encode(r, curve):
    p = CURVES[curve]; cut1 = (p['cut2'] - p['f']) / p['e']
    return np.where(r >= cut1, p['c'] * np.log10(p['a'] * np.maximum(r, 1e-9) + p['b']) + p['d'], p['e'] * r + p['f'])

def to_709_linear(x, curve):
    """LUT input (F-Log/F-Log2, F-Gamut) -> scene-linear Rec.709, out-of-gamut pulled toward grey."""
    lin = decode(lut_input_to_signal(x), curve) @ BT2020_TO_709.T
    Y = np.maximum(lin @ np.array([0.2126, 0.7152, 0.0722]), 0)[..., None]
    mn = lin.min(-1, keepdims=True)
    k = np.where(mn < 0, Y / np.maximum(Y - mn, 1e-9), 1.0)
    return Y + (lin - Y) * np.clip(k, 0, 1)

def ire(reflectance, curve):
    """Waveform level (IRE, legal range) that a scene reflectance records at."""
    return float((encode(np.array(reflectance), curve) * 1023 - 64) / 876 * 100)
