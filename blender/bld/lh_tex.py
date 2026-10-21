"""Tileable surface maps for the lighthouse: colour and tangent-space normal for
ashlar stone, wet rock, slate, planking, whitewash and brick. numpy and Pillow only.

Every map is built from periodic value noise and periodic block layouts, so each
tiles seamlessly however the UVs repeat it. Colours are authored as sRGB.
"""
import numpy as np

N = 512


def _noise(gx, gy, seed):
    r = np.random.default_rng(seed)
    lat = r.random((gy, gx))
    ys = np.linspace(0, gy, N, endpoint=False)
    xs = np.linspace(0, gx, N, endpoint=False)
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    fy, fx = ys - y0, xs - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a, b = lat[y0 % gy][:, x0 % gx], lat[y0 % gy][:, (x0 + 1) % gx]
    c, d = lat[(y0 + 1) % gy][:, x0 % gx], lat[(y0 + 1) % gy][:, (x0 + 1) % gx]
    return (a * (1 - fx) + b * fx) * (1 - fy)[:, None] + (c * (1 - fx) + d * fx) * fy[:, None]


def fbm(gx, gy, octaves, seed, gain=0.5):
    out, amp, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        out = out + amp * _noise(gx * 2 ** o, gy * 2 ** o, seed + o * 7)
        tot += amp
        amp *= gain
    return out / tot


def normal_from_height(h, strength):
    """Tangent-space normal map from a periodic height field (rolled differences)."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    n = np.stack([-dx * strength, dy * strength, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def _hex(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)


def _blocks(rows, cols, jitter, seed, stagger=0.5):
    """Block ids and the position inside each block for a periodic running-bond layout.

    Returns (id, u, v, edge) where u, v run 0..1 across each block and `edge` is the
    distance to the nearest block edge in block units."""
    r = np.random.default_rng(seed)
    ys, xs = np.mgrid[0:N, 0:N] / N
    row = np.floor(ys * rows).astype(int)
    v = ys * rows - row
    shift = (row % 2) * stagger
    # per-row width jitter keeps the courses from lining up vertically
    wob = r.random(rows) * jitter
    xcol = xs * cols + shift + wob[row]
    col = np.floor(xcol).astype(int)
    u = xcol - col
    ident = (row * 131 + (col % cols) * 17) % 997
    edge = np.minimum.reduce([u, 1 - u, v, 1 - v])
    return ident, u, v, edge


def stone():
    """Ashlar limestone: coursed blocks, chipped arrises, rain streaks, grime."""
    ident, u, v, edge = _blocks(8, 6, 0.4, 3)
    r = np.random.default_rng(5)
    tone = (r.random(997)[ident] - 0.5)
    mortar = np.clip(1 - edge / 0.045, 0, 1) ** 1.5
    grain = fbm(48, 48, 4, 11)
    pits = fbm(160, 160, 2, 17)
    height = (1 - mortar * 0.9) * (0.7 + 0.3 * grain) - np.clip(0.2 - edge, 0, 1) * 0.6 * pits
    base = _hex('#b9b4a8')
    col = base[None, None, :] * (0.84 + tone[..., None] * 0.18 + (grain[..., None] - 0.5) * 0.22)
    col = col * (1 - mortar[..., None] * 0.55) + _hex('#6e6a60') * mortar[..., None] * 0.55
    # rain streaks running down from the arrises, and damp, dark staining
    streak = fbm(64, 4, 3, 23)
    col *= 1 - 0.2 * np.clip((streak - 0.5) * 3, 0, 1)[..., None] * (0.4 + 0.6 * (1 - v)[..., None])
    stain = fbm(5, 5, 4, 29)
    col *= 1 - 0.18 * np.clip((stain - 0.45) * 2.5, 0, 1)[..., None]
    return np.clip(col, 0, 1), normal_from_height(height, 7.0)


def rock():
    """Wet dark basalt: stratified, fractured, glistening."""
    strata = fbm(3, 14, 5, 41)
    lumps = fbm(14, 14, 5, 47)
    crack = 1 - np.abs(fbm(10, 10, 4, 53) * 2 - 1)
    cracks = np.clip((crack - 0.86) * 9, 0, 1)
    height = 0.55 * strata + 0.55 * lumps - cracks * 0.5
    base = _hex('#565c66')
    col = base[None, None, :] * (0.6 + 0.9 * lumps[..., None]) * (0.85 + 0.3 * strata[..., None])
    col = col * (1 - cracks[..., None] * 0.7)
    # pale mineral veins and the odd rust stain
    vein = np.clip((fbm(24, 24, 3, 59) - 0.72) * 5, 0, 1)
    col = col + vein[..., None] * 0.12
    rust = np.clip((fbm(6, 6, 3, 61) - 0.62) * 4, 0, 1)
    col = col * (1 - rust[..., None] * 0.35) + np.array([0.18, 0.09, 0.05], np.float32) * rust[..., None] * 0.35
    return np.clip(col, 0, 1), normal_from_height(height, 5.0)


def slate():
    """Slate roofing: overlapping courses of small tiles, one or two cracked."""
    ident, u, v, edge = _blocks(16, 14, 0.2, 7, 0.5)
    r = np.random.default_rng(9)
    tone = r.random(997)[ident] - 0.5
    lap = np.clip(1 - v, 0, 1)
    shadow = np.clip((0.12 - v) / 0.12, 0, 1)           # the lap shades the course below
    gap = np.clip(1 - np.minimum(u, 1 - u) / 0.03, 0, 1)
    height = lap * 0.8 + 0.12 * fbm(60, 60, 2, 71) - gap * 0.5
    col = _hex('#3b4350')[None, None, :] * (0.82 + tone[..., None] * 0.4)
    col *= (1 - shadow[..., None] * 0.55)
    col *= 1 - gap[..., None] * 0.6
    col += (fbm(30, 30, 3, 73)[..., None] - 0.5) * 0.06
    return np.clip(col, 0, 1), normal_from_height(height, 6.0)


def wood():
    """Weathered planks with grain, nail heads and bleached edges."""
    ident, u, v, edge = _blocks(1, 8, 0.0, 13, 0.0)
    r = np.random.default_rng(15)
    tone = r.random(997)[ident] - 0.5
    grain = fbm(2, 90, 4, 81)
    gap = np.clip(1 - np.minimum(u, 1 - u) / 0.025, 0, 1)
    height = grain * 0.5 - gap * 0.9
    col = _hex('#6a4e36')[None, None, :] * (0.7 + tone[..., None] * 0.4 + grain[..., None] * 0.5)
    col *= 1 - gap[..., None] * 0.75
    col = col * 0.8 + _hex('#8d8272') * 0.2 * fbm(12, 12, 3, 83)[..., None]
    return np.clip(col, 0, 1), normal_from_height(height, 4.0)


def plaster():
    """Whitewashed stone: soft lumps, damp stains at the foot, specks of lichen."""
    lumps = fbm(18, 18, 5, 91)
    height = lumps * 0.5 + fbm(90, 90, 2, 93) * 0.3
    col = _hex('#ddd8cb')[None, None, :] * (0.9 + 0.14 * lumps[..., None])
    stain = np.clip((fbm(6, 6, 4, 97) - 0.55) * 3, 0, 1)
    col *= 1 - 0.22 * stain[..., None]
    lichen = np.clip((fbm(40, 40, 3, 99) - 0.74) * 8, 0, 1)
    col = col * (1 - lichen[..., None] * 0.4) + _hex('#8b9a62') * lichen[..., None] * 0.4
    return np.clip(col, 0, 1), normal_from_height(height, 3.0)


def brick():
    """Chimney brick, soot-dark."""
    ident, u, v, edge = _blocks(14, 7, 0.2, 21, 0.5)
    r = np.random.default_rng(23)
    tone = r.random(997)[ident] - 0.5
    mortar = np.clip(1 - edge / 0.07, 0, 1)
    height = (1 - mortar) * 0.8 + 0.2 * fbm(80, 80, 2, 101)
    col = _hex('#8a4a38')[None, None, :] * (0.7 + tone[..., None] * 0.5)
    col = col * (1 - mortar[..., None]) + _hex('#8c877d') * mortar[..., None]
    col *= 0.75 + 0.25 * fbm(8, 8, 3, 103)[..., None]
    return np.clip(col, 0, 1), normal_from_height(height, 6.0)


MAPS = dict(stone=stone, rock=rock, slate=slate, wood=wood, plaster=plaster, brick=brick)
