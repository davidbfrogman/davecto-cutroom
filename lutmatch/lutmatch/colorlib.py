"""Colour maths: display transfer, OKLab, vectorscope angle. Pure numpy."""
import numpy as np

def to_lin(v):
    """Display-encoded -> linear (sRGB curve; web video and NLE viewers decode close to this)."""
    v = np.clip(v, 0, 1); return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)

def to_enc(l):
    l = np.clip(l, 0, 1); return np.where(l <= 0.0031308, l * 12.92, 1.055 * l ** (1 / 2.4) - 0.055)

M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]])
M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]])

def rgb_to_oklab(rgb):
    """Display-encoded RGB (0..1, ...x3) -> OKLab (L, a, b)."""
    return np.cbrt(to_lin(rgb) @ M1.T) @ M2.T

def oklab_to_rgb(lab):
    return to_enc(oklab_to_rgb_lin(lab))

def oklab_to_rgb_lin(lab):
    return (lab @ np.linalg.inv(M2).T) ** 3 @ np.linalg.inv(M1).T

def scope_angle(rgb):
    """Vectorscope angle in degrees from +Cb toward +Cr (Rec.709), and saturation. The skin-tone line is ~123 deg."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    cb, cr = (b - y) / 1.8556, (r - y) / 1.5748
    return np.degrees(np.arctan2(cr, cb)) % 360, np.hypot(cb, cr)
