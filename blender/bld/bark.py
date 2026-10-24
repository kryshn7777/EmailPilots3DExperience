"""Procedural bark strips, periodic around the trunk.

A tube's u runs once around its circumference, so the strip must wrap in x. The bark is
plates: a Voronoi pattern of seed points laid out on a grid that is long in v, so the cells
are tall plates and the cracks between them (where the nearest and second-nearest seed are
about as close) run up the trunk in short, branching furrows. Each plate has a tone of its
own, domes up from the cracks, and carries fine vertical grain; the occlusion map darkens
the furrows, and a species can add moss or the dark horizontal lenticels of a poplar.
Returns sRGB colour, an occlusion/roughness/metalness strip, and the height field the
plates were cut from (for the hero sheet's normal map).
"""
import numpy as np


def _noise(w, h, gx, gy, seed, wrap_y=False):
    r = np.random.default_rng(seed)
    lat = r.random((gy + 1, gx))
    ys = np.linspace(0, gy, h, endpoint=False)
    xs = np.linspace(0, gx, w, endpoint=False)
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    fy, fx = ys - y0, xs - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    y1 = (y0 + 1) % gy if wrap_y else y0 + 1
    a, b = lat[y0][:, x0 % gx], lat[y0][:, (x0 + 1) % gx]
    c, d = lat[y1][:, x0 % gx], lat[y1][:, (x0 + 1) % gx]
    return (a * (1 - fx) + b * fx) * (1 - fy)[:, None] + (c * (1 - fx) + d * fx) * fy[:, None]


def _fbm(w, h, gx, gy, octaves, seed):
    out, amp, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        out = out + amp * _noise(w, h, gx * 2 ** o, gy * 2 ** o, seed + o)
        tot += amp
        amp *= 0.5
    return out / tot


def _lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 1e-8), 1 / 2.4) - 0.055)


def hex_rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)


def _voronoi(w, h, nx, ny, seed, warp=0.0):
    """F1, F2 (pixels to the nearest and second-nearest seed) and the nearest seed's random tone.
    Seeds sit one per cell of an nx by ny grid that wraps in x (and y), so cells are w/nx by h/ny
    pixels; distances are measured in pixels, so a crack is as wide up the trunk as across it."""
    r = np.random.default_rng(seed)
    pts = r.random((ny, nx, 2)).astype(np.float32)
    tone = r.random((ny, nx)).astype(np.float32)
    sx, sy = w / nx, h / ny
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / sx, ys / sy
    if warp:
        # a little wobble so the plates are not a lattice: low-frequency noise, in cells
        u = u + (_fbm(w, h, 6, 10, 2, seed + 5) - 0.5) * 2 * warp
        v = v + (_fbm(w, h, 6, 10, 2, seed + 9) - 0.5) * 2 * warp * 0.6
    iu, iv = np.floor(u).astype(int), np.floor(v).astype(int)
    f1 = np.full((h, w), 1e9, np.float32)
    f2 = np.full((h, w), 1e9, np.float32)
    tid = np.zeros((h, w), np.float32)
    for dj in (-1, 0, 1):
        for di in (-2, -1, 0, 1, 2):
            cj, ci = iv + dj, iu + di
            px = (ci + pts[cj % ny, ci % nx, 0]) * sx
            py = (cj + pts[cj % ny, ci % nx, 1]) * sy
            d = np.hypot(u * sx - px, v * sy - py)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            tid = np.where(closer, tone[cj % ny, ci % nx], tid)
            f1 = np.where(closer, d, f1)
    return f1, f2, tid


def _vnoise(u, v, gx, seed):
    """Value noise at lattice coordinates (u wraps every gx lattice cells, v does not)."""
    r = np.random.default_rng(seed)
    gy = int(np.ceil(v.max())) + 2
    lat = r.random((gy + 1, gx)).astype(np.float32)
    x0, y0 = np.floor(u).astype(int), np.floor(v).astype(int)
    fx, fy = u - x0, v - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    x1 = (x0 + 1) % gx
    x0 = x0 % gx
    return (lat[y0, x0] * (1 - fx) + lat[y0, x1] * fx) * (1 - fy) + (lat[y0 + 1, x0] * (1 - fx) + lat[y0 + 1, x1] * fx) * fy


def _fbm_at(u, v, gx, octaves, seed):
    out, amp, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        out = out + amp * _vnoise(u * 2 ** o, v * 2 ** o, gx * 2 ** o, seed + o * 7)
        tot += amp
        amp *= 0.5
    return out / tot


def _smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def _fissures(w, h, seed, gx, gy, width, gate=0.5):
    """Long, branching, broken cracks that run up the strip: where a stretched noise crosses its
    midline. Returns (crack 0..1, distance from the nearest crack 0..1 -- the ridge profile)."""
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    U, V = xs / w, ys / h
    # warp the lattice so the fissures wander and fork instead of running dead straight
    U = U + (_fbm_at(U * 5, V * 6, 5, 2, seed + 1) - 0.5) * 0.05
    V = V + (_fbm_at(U * 5, V * 6, 5, 2, seed + 2) - 0.5) * 0.06
    a = _fbm_at(U * gx, V * gy, gx, 3, seed + 3)
    d = np.abs(a * 2 - 1)
    crack = 1.0 - _smooth(0.0, width, d)
    # a fissure has a beginning and an end: it only shows where a slower noise says so
    g = _fbm_at(U * gx * 0.45, V * gy * 1.6, int(gx * 0.45), 2, seed + 4)
    crack = crack * _smooth(gate - 0.1, gate + 0.1, g)
    return crack, np.clip(d / 0.45, 0, 1)


def bark(w, h, tint, seed, moss=0.0, lenticels=0.0, furrow=1.0, style='ridged', cells=(30, 9), crack=2.6,
         plate=0.55, fissure=(26, 3, 0.07)):
    """(rgb uint8 (h, w, 3), orm uint8 (h, w, 3), height float (h, w)) for one species.
    style 'ridged' is furrowed bark (oak, maple, poplar): long ridges between fissures that run up
    the trunk, `fissure` = (lattice cells across, cells up the strip, width of a crack). Style
    'plates' is the pine's scaly bark: Voronoi plates on a grid of `cells` seeds, `crack` pixels
    across, `plate` how much tone varies from plate to plate."""
    grain = _fbm(w, h, 150, 14, 3, seed + 31)         # fine vertical grain
    broad = _fbm(w, h, 8, 6, 3, seed + 77)
    if style == 'plates':
        nx, ny = cells
        f1, f2, tid = _voronoi(w, h, nx, ny, seed, warp=0.35)
        edge = f2 - f1
        cw = crack * furrow
        groove = 1.0 - _smooth(0.0, cw * 2.0, edge)
        dome = _smooth(0.0, cw * 7.0, edge) ** 0.7
        tone = 1.0 - plate * 0.5 + plate * tid
    else:
        gx, gy, wd = fissure
        groove1, prof1 = _fissures(w, h, seed, gx, gy, wd * furrow)
        groove2, prof2 = _fissures(w, h, seed + 40, gx * 2, gy * 3, wd * furrow * 0.8, gate=0.62)
        groove = np.maximum(groove1, 0.55 * groove2)
        dome = np.minimum(prof1, 0.55 + 0.45 * prof2) ** 0.8
        # each ridge its own tone: a slow noise stretched along the trunk
        tone = 0.8 + 0.4 * _fbm(w, h, int(gx), int(max(2, gy)), 2, seed + 55)
    height = np.clip(0.2 + 0.58 * dome + 0.20 * (grain - 0.5) + 0.10 * (broad - 0.5) - 0.30 * groove, 0, 1)

    base = _lin(hex_rgb(tint))
    dark = base * 0.10
    light = base * 1.55
    t = np.clip(height * 1.25 - 0.08, 0, 1)[..., None]
    col = dark + (light - dark) * t
    col = col * tone[..., None] * (0.86 + 0.28 * broad)[..., None]
    col = col * (1.0 - 0.6 * groove)[..., None]

    if moss > 0:
        m = np.clip((_fbm(w, h, 4, 3, 3, seed + 101) - (1 - moss)) * 5, 0, 1)
        # moss grows on the sheltered ridges and in the cracks, not on the crests
        m = (m * (0.35 + 0.65 * (1.0 - dome * 0.6)))[..., None]
        col = col * (1 - 0.65 * m) + _lin(np.array([0.22, 0.34, 0.12], np.float32)) * 0.65 * m * (0.5 + height[..., None])
    if lenticels > 0:
        # short dark horizontal dashes, as on birch and poplar
        d = _fbm(w, h, 28, 90, 1, seed + 211)
        dash = (d > 1 - lenticels * 0.35).astype(np.float32)[..., None]
        col = col * (1 - 0.7 * dash)

    ao = 0.40 + 0.60 * np.clip(height * 1.3, 0, 1)
    orm = np.stack([ao, np.full_like(ao, 0.92), np.zeros_like(ao)], axis=-1)
    to8 = lambda a: np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)
    return to8(_srgb(col)), to8(orm), height


def normal_map(height, strength):
    """Tangent-space normals (OpenGL: +x along u, +y along v, which runs up the image) from a
    height field that wraps in x, as uint8 RGB."""
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5
    dy = np.zeros_like(height)
    dy[1:-1] = (height[2:] - height[:-2]) * 0.5
    nx, ny = -dx * strength, dy * strength
    nz = np.ones_like(height)
    n = np.stack([nx, ny, nz], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return np.clip((n * 0.5 + 0.5) * 255 + 0.5, 0, 255).astype(np.uint8)
