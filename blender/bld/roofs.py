"""High-poly roofs: the clutter that makes a rooftop read as a rooftop.

The flight crosses this district looking down, so roofs get a lot of screen
space. Plant, skylights and parapets live only in the high-poly source and are
baked into a flat low-poly roof, where their shadows and normals do the work.
"""
import math
import random

from mathutils import Vector

from .geo import Frame, Z


def poly_area(poly):
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1]))) / 2


def inside(poly, x, y):
    hit = False
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            hit = not hit
    return hit


def parapet(hp, poly, z, h, t, mat):
    n = len(poly)
    for i in range(n):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % n])
        fr = Frame(a, b - a)
        L = (b - a).length
        hp.fbox(fr, 0, L, -t, 0, z, z + h, mat, skip=('-w', '-v'))
        hp.fbox(fr, 0, L, -t - 0.04, 0.06, z + h, z + h + 0.07, mat, skip=('-w',))


# -- plant ---------------------------------------------------------------------
# each returns the (width, depth) footprint it consumed

def _ac(hp, x, y, z, rng):
    hp.box(x, y, 2.4, 1.5, z, z + 1.2, 'metal_roof')
    for dx in (-0.6, 0.6):
        hp.cylinder(x + dx, y, 0.5, z + 1.2, z + 1.3, 12, 'louver', smooth=False)
    return 2.6, 1.7


def _vent(hp, x, y, z, rng):
    hp.cylinder(x, y, 0.2, z, z + rng.uniform(1.2, 2.2), 8, 'metal_roof')
    hp.cylinder(x, y, 0.32, z + 1.5, z + 1.6, 8, 'metal_roof', smooth=False)
    return 0.8, 0.8


def _skylight(hp, x, y, z, rng):
    hp.box(x, y, 3.4, 2.2, z, z + 0.55, 'concrete')
    hp.face([(x - 1.5, y - 0.95, z + 0.58), (x + 1.5, y - 0.95, z + 0.58),
             (x + 1.5, y + 0.95, z + 0.58), (x - 1.5, y + 0.95, z + 0.58)],
            'glass_sky', expect=Z)
    return 3.6, 2.4


def _bulkhead(hp, x, y, z, rng):
    w, d, h = rng.uniform(3.0, 4.6), rng.uniform(2.6, 3.6), rng.uniform(2.4, 3.0)
    hp.box(x, y, w, d, z, z + h, 'concrete_d')
    hp.box(x, y, w + 0.3, d + 0.3, z + h, z + h + 0.15, 'concrete')
    hp.fquad(Frame((x - 0.5, y - d / 2), (1, 0)), 0, 1.0, z, z + 2.1, 0.02, 'frame_dark')
    return w + 0.6, d + 0.6


def _solar(hp, x, y, z, rng):
    for i in range(4):
        x0 = x - 4.6 + i * 2.35
        hp.face([(x0, y - 0.55, z + 0.25), (x0 + 2.2, y - 0.55, z + 0.25),
                 (x0 + 2.2, y + 0.55, z + 0.75), (x0, y + 0.55, z + 0.75)], 'solar', expect=Z)
        hp.box(x0 + 1.1, y, 2.2, 0.08, z, z + 0.25, 'frame_light')
    return 9.8, 1.9


def _garden(hp, x, y, z, rng):
    hp.box(x, y, 5.0, 3.6, z, z + 0.18, 'roof_green')
    for _ in range(4):
        hp.cylinder(x + rng.uniform(-2, 2), y + rng.uniform(-1.4, 1.4), rng.uniform(0.4, 0.7),
                    z + 0.18, z + rng.uniform(0.8, 1.4), 7, 'roof_green')
    return 5.4, 4.0


ITEMS = {'ac': _ac, 'vent': _vent, 'skylight': _skylight, 'bulkhead': _bulkhead,
         'solar': _solar, 'garden': _garden}


def flat_roof(hp, poly, z, spec, rng, keepouts=()):
    """Roof plate, parapet, tonal patches and scattered plant on a footprint."""
    hp.face([(x, y, z) for x, y in poly], spec.get('mat', 'roof_gravel'), expect=Z)
    if spec.get('parapet', 1.0):
        parapet(hp, poly, z, spec.get('parapet', 1.0), 0.35, spec.get('parapet_mat', 'concrete'))

    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    margin = spec.get('margin', 1.5)
    placed = [(a - 0.8, b - 0.8, c + 0.8, d + 0.8) for a, b, c, d in keepouts]
    scale = poly_area(poly) / 400.0

    def free(x, y, w, d):
        if x - w / 2 < x0 + margin or x + w / 2 > x1 - margin:
            return False
        if y - d / 2 < y0 + margin or y + d / 2 > y1 - margin:
            return False
        for cx, cy in ((x - w / 2, y - d / 2), (x + w / 2, y - d / 2),
                       (x + w / 2, y + d / 2), (x - w / 2, y + d / 2)):
            if not inside(poly, cx, cy):
                return False
        return all(x + w / 2 < a or x - w / 2 > c or y + d / 2 < b or y - d / 2 > e
                   for a, b, c, e in placed)

    for _ in range(round(spec.get('patches', 4) * max(scale, 0.6))):
        w, d = rng.uniform(3, 9), rng.uniform(3, 9)
        x, y = rng.uniform(x0 + w / 2, x1 - w / 2), rng.uniform(y0 + d / 2, y1 - d / 2)
        if all(inside(poly, x + sx * w / 2, y + sy * d / 2) for sx in (-1, 1) for sy in (-1, 1)):
            hp.box(x, y, w, d, z + 0.01, z + 0.03,
                   rng.choice(['roof_membrane', 'roof_tar', 'roof_membrane']))

    for kind, per400 in spec.get('items', {}).items():
        want = per400 * scale
        count = int(want) + (1 if rng.random() < want - int(want) else 0)
        for _ in range(count):
            for _try in range(40):
                x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
                # ask the item what it needs by building it into a throwaway
                # footprint estimate first: sizes are small and fixed per kind
                w, d = {'ac': (2.6, 1.7), 'vent': (0.8, 0.8), 'skylight': (3.6, 2.4),
                        'bulkhead': (5.2, 4.2), 'solar': (9.8, 1.9),
                        'garden': (5.4, 4.0)}[kind]
                if free(x, y, w, d):
                    ITEMS[kind](hp, x, y, z, rng)
                    placed.append((x - w / 2, y - d / 2, x + w / 2, y + d / 2))
                    break

    pad = spec.get('helipad')
    if pad:
        cx, cy, r = pad
        hp.cylinder(cx, cy, r, z, z + 0.14, 24, 'paint_red', smooth=False)
        hp.cylinder(cx, cy, r - 0.5, z + 0.14, z + 0.16, 24, 'roof_membrane', smooth=False)
        for dx in (-0.9, 0.9):
            hp.box(cx + dx, cy, 0.3, 3.4, z + 0.16, z + 0.18, 'frame_light')
        hp.box(cx, cy, 1.5, 0.3, z + 0.16, z + 0.18, 'frame_light')


def pyramid_hp(hp, cx, cy, w, d, z0, z1, mat, ax=0.0, ay=0.0):
    """Four-sided pyramid (crown caps, spires) for the high-poly source."""
    c = [(cx - w / 2, cy - d / 2), (cx + w / 2, cy - d / 2),
         (cx + w / 2, cy + d / 2), (cx - w / 2, cy + d / 2)]
    apex = (cx + ax, cy + ay, z1)
    for i in range(4):
        a, b = c[i], c[(i + 1) % 4]
        mid = Vector(((a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy, 0.3))
        hp.face([(a[0], a[1], z0), (b[0], b[1], z0), apex], mat, expect=mid)
