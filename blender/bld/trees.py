"""Four trees. The low-poly canopy is one lumpy blob (or a few cones); the
high-poly twin is a shell of a hundred small leaf clusters around a dark core,
so the bake paints in leafy colour variation and the deep shade between
clusters. Smooth shading plus that baked occlusion is what makes a 80-triangle
sphere read as foliage."""
import math

from mathutils import Vector

from .model import Model

SCALE = 0.33   # site units per metre, shared with the houses


def _dir(rng):
    z = rng.uniform(-1, 1)
    a = rng.uniform(0, 2 * math.pi)
    r = math.sqrt(1 - z * z)
    return Vector((r * math.cos(a), r * math.sin(a), z))


def _leaf_shell(m, rng, centre, radii, mats, dark, count, crad, shell=(0.82, 1.02), bottom=-0.55):
    """Leaf clusters on a thick shell, skipping the underside (nobody sees it)."""
    cx, cy, cz = centre
    rx, ry, rz = radii
    m.hp.sphere(cx, cy, cz, rx * 0.8, ry * 0.8, rz * 0.8, dark, subdiv=1)
    for _ in range(count):
        d = _dir(rng)
        if d.z < bottom:
            continue
        k = rng.uniform(*shell)
        r = rng.uniform(*crad)
        m.hp.sphere(cx + d.x * rx * k, cy + d.y * ry * k, cz + d.z * rz * k,
                    r, r * 0.9, r * 0.85, rng.choice(mats), subdiv=1)


def _trunk(m, z0, z1, r0, r1, mat='bark', segs=6):
    m._solid_cyl(0, 0, r0, z0, z1, segs, mat, r_top=r1, cap=False, smooth=False)
    m.hp.cylinder(0, 0, r0, z0, z1, 12, mat, r_top=r1, cap=False)


def oak():
    m = Model('tree-oak', 'tree', scale=SCALE)
    _trunk(m, 0, 5.2, 0.5, 0.3)
    rng = m.blob(0, 0, 7.4, 4.3, 4.3, 3.4, 'c', lump=0.16)
    for _ in range(4):
        d = _dir(rng)
        m.hp.cylinder(d.x * 0.5, d.y * 0.5, 0.18, 4.4, 6.6, 8, 'bark', r_top=0.1, cap=False)
    _leaf_shell(m, rng, (0, 0, 7.4), (4.3, 4.3, 3.4),
                ['leaf_oak', 'leaf_oak_dk', 'leaf_oak_lt', 'leaf_oak'], 'leaf_oak_dk', 110, (0.8, 1.5))
    return m


def maple():
    m = Model('tree-maple', 'tree', scale=SCALE)
    _trunk(m, 0, 4.4, 0.42, 0.26)
    rng = m.blob(0, 0, 6.4, 3.5, 3.5, 3.6, 'c', lump=0.15)
    _leaf_shell(m, rng, (0, 0, 6.4), (3.5, 3.5, 3.6),
                ['leaf_maple', 'leaf_maple_dk', 'leaf_maple_lt', 'leaf_maple'], 'leaf_maple_dk',
                95, (0.7, 1.3))
    return m


def pine():
    m = Model('tree-pine', 'tree', scale=SCALE)
    _trunk(m, 0, 2.4, 0.36, 0.22)
    tiers = ((1.7, 5.2, 2.7), (4.2, 7.8, 2.1), (6.8, 10.6, 1.4))
    rng = None
    for i, (z0, z1, r) in enumerate(tiers):
        m.cone(0, 0, z0, z1, r, f'c{i}', segs=8)
        m.hp.cylinder(0, 0, r * 0.7, z0 + 0.3, z1, 14, 'leaf_pine_dk', r_top=0.05, cap=False)
    import random
    rng = random.Random('pine')
    for z0, z1, r in tiers:
        for _ in range(78):
            h = rng.uniform(0, 0.92)
            rad = r * (1 - h) * rng.uniform(0.78, 1.0)
            a = rng.uniform(0, 2 * math.pi)
            s = rng.uniform(0.55, 0.9)
            m.hp.sphere(rad * math.cos(a), rad * math.sin(a), z0 + (z1 - z0) * h + 0.1,
                        s * 1.1, s * 1.1, s * 0.55,
                        rng.choice(['leaf_pine', 'leaf_pine', 'leaf_pine_dk', 'leaf_pine_lt']), subdiv=1)
    return m


def poplar():
    m = Model('tree-poplar', 'tree', scale=SCALE)
    _trunk(m, 0, 3.0, 0.34, 0.22, mat='bark_pale')
    rng = m.blob(0, 0, 7.4, 2.0, 2.0, 6.0, 'c', lump=0.1)
    _leaf_shell(m, rng, (0, 0, 7.4), (2.0, 2.0, 6.0),
                ['leaf_birch', 'leaf_birch_dk', 'leaf_birch_lt', 'leaf_birch'], 'leaf_birch_dk',
                100, (0.6, 1.1), bottom=-0.75)
    return m
