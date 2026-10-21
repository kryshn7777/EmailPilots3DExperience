"""The lighthouse, its islet and the keeper's cottage, modelled in tower units.

Units match the old procedural tower so every anchor in Beacon.ts still holds: the
lantern centre is at z = 12.2, the base radius is 1.8, the islet runs to radius ~3.4.
The whole thing is then scaled by TOWER_SCALE at runtime.

The tower is real geometry from the foundation to the lightning rod: a coursed granite
base with a string course, a banded masonry hull with spiral stair windows (stone
surrounds, sills, lit glass), a studded door with iron straps and steps, a corbel table
and gallery with an iron balustrade and drain spouts, a lantern room with glazing bars,
a Fresnel lens and a ribbed copper dome with a weathervane. The cottage is whitewashed
stone with a slate roof, chimney, windows and a lit porch; around it sit a store, a
yard wall, barrels, crates, rope and a lifebuoy. The islet is a stratified rock heightfield
with barnacled, weeded colouring and a scatter of boulders.
"""
import math

import bmesh
import bpy
from mathutils import Vector

from .lh_geo import Part, fractal

R_BASE0, R_BASE1 = 1.52, 1.04        # batter of the granite base course (z 0.3 -> 2.6)
Y_BASE0, Y_BASE1 = 0.30, 2.60
Y_HULL0, Y_HULL1 = 2.80, 11.20
R_HULL0, R_HULL1 = 0.98, 0.56
Y_DECK = 11.67
Y_LANTERN0, Y_LANTERN1 = 11.95, 12.70
DOOR_ANGLE = math.atan2(-0.5, 1.0)   # toward the cottage (three +x, +z) in Z-up coordinates


def r_base(z):
    return R_BASE0 + (R_BASE1 - R_BASE0) * (z - Y_BASE0) / (Y_BASE1 - Y_BASE0)


def r_hull(z):
    return R_HULL0 + (R_HULL1 - R_HULL0) * (z - Y_HULL0) / (Y_HULL1 - Y_HULL0)


def polar(angle, radius, z=0.0):
    return Vector((radius * math.cos(angle), radius * math.sin(angle), z))


def tangent(angle):
    return Vector((-math.sin(angle), math.cos(angle), 0.0))


def build(collection):
    P = {n: Part(n) for n in ('granite', 'white', 'red', 'iron', 'copper', 'brass', 'slate', 'wood',
                              'plaster', 'brick', 'glass_warm', 'glass_lantern', 'lens')}
    P['rock'] = Part('rock', colours=True)
    P['misc'] = Part('misc', colours=True)
    tower(P)
    islet(P)
    cottage(P)
    props(P)
    return {k: v.finish(collection) for k, v in P.items()}


# ---------------------------------------------------------------------------------------
# the tower
# ---------------------------------------------------------------------------------------

def tower(P):
    g, white, red, iron = P['granite'], P['white'], P['red'], P['iron']

    # foundation: a stepped plinth, then the granite base course with its batter
    g.lathe([(1.86, -1.2), (1.86, 0.18), (1.7, 0.18), (1.7, 0.30)], 40, tile=2.0, r_ref=1.8)
    g.lathe([(1.7, 0.30), (1.56, 0.30)], 40, tile=2.0, r_ref=1.6)
    zs = [Y_BASE0 + (Y_BASE1 - Y_BASE0) * i / 8 for i in range(9)]
    g.lathe([(r_base(z), z) for z in zs], 40, tile=2.0, r_ref=1.3, repeat=7)
    # string course capping the base: a projecting moulding
    g.lathe([(R_BASE1, Y_BASE1), (1.16, Y_BASE1 + 0.02), (1.16, Y_BASE1 + 0.16), (1.1, Y_BASE1 + 0.24),
             (1.0, Y_BASE1 + 0.24), (R_HULL0, Y_HULL0)], 40, tile=2.0, r_ref=1.1, repeat=7)

    # the hull: nine bands of masonry, alternately white and red, each lit in rings
    bands = 9
    for i in range(bands):
        z0 = Y_HULL0 + (Y_HULL1 - Y_HULL0) * i / bands
        z1 = Y_HULL0 + (Y_HULL1 - Y_HULL0) * (i + 1) / bands
        part = red if i % 2 else white
        steps = 4
        prof = [(r_hull(z0 + (z1 - z0) * k / steps), z0 + (z1 - z0) * k / steps) for k in range(steps + 1)]
        part.lathe(prof, 40, tile=2.0, r_ref=0.8, repeat=5)
        # a thin projecting ring at the head of each band, like a painted course
        if i:
            g.lathe([(r_hull(z0) + 0.005, z0 - 0.015), (r_hull(z0) + 0.03, z0 - 0.015),
                     (r_hull(z0) + 0.03, z0 + 0.015), (r_hull(z0) + 0.005, z0 + 0.015)],
                    40, tile=2.0, r_ref=0.8, repeat=5)

    # spiral stair windows: stone surround, sill, lintel, lit slit
    for i in range(9):
        a = 0.6 + i * 2.4
        z = 3.55 + i * 0.86
        r = r_hull(z)
        place_window(P, a, r, z)

    # door with its surround, studded leaf, straps, steps and a lamp
    tower_door(P, DOOR_ANGLE)

    # lightning conductor strip down the hull, on standoffs
    a_c = 2.0
    zc = 11.2
    while zc > 1.0:
        zn = max(zc - 1.4, 0.4)
        r0 = (r_hull(zc) if zc > Y_HULL0 else r_base(max(zc, Y_BASE0))) + 0.045
        r1 = (r_hull(zn) if zn > Y_HULL0 else r_base(max(zn, Y_BASE0))) + 0.045
        P['copper'].bar(polar(a_c, r0, zc), polar(a_c, r1, zn), 0.026, 0.012)
        P['copper'].box(polar(a_c, r0 - 0.02, zc), (0.05, 0.03, 0.03), yaw=a_c)
        zc = zn

    # corbel table under the gallery and the gallery deck
    g.lathe([(0.56, Y_HULL1), (0.78, Y_HULL1 + 0.02), (1.0, Y_HULL1 + 0.22), (1.2, Y_HULL1 + 0.35),
             (1.2, Y_DECK - 0.02)], 40, tile=2.0, r_ref=1.0, repeat=6)
    g.lathe([(1.22, Y_DECK - 0.02), (1.22, Y_DECK), (0.68, Y_DECK)], 40, tile=2.0, r_ref=1.0, repeat=6)
    for k in range(24):
        a = 2 * math.pi * k / 24
        g.box(polar(a, 0.86, Y_HULL1 + 0.26), (0.34, 0.1, 0.3), yaw=a, pitch=0.5)
    # drain spouts
    for k in range(6):
        a = 2 * math.pi * k / 6 + 0.2
        iron.cylinder(polar(a, 1.1, Y_DECK + 0.02), polar(a, 1.3, Y_DECK - 0.07), 0.024, 0.02, 8)

    # gallery balustrade: posts, top rail, mid rail, finials, a gate gap toward the cottage
    for k in range(40):
        a = 2 * math.pi * k / 40
        if abs((a - DOOR_ANGLE + math.pi) % (2 * math.pi) - math.pi) < 0.2:
            continue
        iron.box(polar(a, 1.12, Y_DECK + 0.27), (0.03, 0.03, 0.5))
        if k % 4 == 0:
            iron.sphere(polar(a, 1.12, Y_DECK + 0.55), 0.04, segs=8, rings=5)
    iron.ring(Y_DECK + 0.5, 1.12, 0.022, 40, 6)
    iron.ring(Y_DECK + 0.26, 1.12, 0.016, 40, 5)
    iron.ring(Y_DECK + 0.04, 1.12, 0.02, 40, 5)

    # lantern base: a painted parapet with vents, and a projecting sill under the glass
    white.lathe([(0.69, Y_DECK), (0.66, Y_DECK + 0.02), (0.66, Y_LANTERN0 - 0.04)], 32, tile=2.0, r_ref=0.7, repeat=3)
    white.lathe([(0.66, Y_LANTERN0 - 0.04), (0.72, Y_LANTERN0 - 0.04)][::1], 32, tile=2.0, r_ref=0.7, repeat=3)
    white.lathe([(0.72, Y_LANTERN0 - 0.04), (0.72, Y_LANTERN0 - 0.0), (0.64, Y_LANTERN0)], 32, tile=2.0, r_ref=0.7, repeat=3)
    for k in range(6):
        a = 2 * math.pi * k / 6 + 0.3
        iron.box(polar(a, 0.665, Y_DECK + 0.14), (0.02, 0.16, 0.1), yaw=a)

    # the lantern: twelve glazed bays between iron mullions, two astragal rings and a middle one
    n = 12
    for k in range(n):
        a = 2 * math.pi * k / n
        iron.box(polar(a, 0.62, (Y_LANTERN0 + Y_LANTERN1) / 2), (0.05, 0.05, Y_LANTERN1 - Y_LANTERN0), yaw=a)
    for z in (Y_LANTERN0, (Y_LANTERN0 + Y_LANTERN1) / 2, Y_LANTERN1):
        iron.ring(z, 0.62, 0.026, 36, 6)
    for row in range(2):
        z0 = Y_LANTERN0 + 0.02 + row * (Y_LANTERN1 - Y_LANTERN0) / 2
        z1 = Y_LANTERN0 - 0.02 + (row + 1) * (Y_LANTERN1 - Y_LANTERN0) / 2
        for k in range(n):
            a0 = 2 * math.pi * (k + 0.10) / n
            a1 = 2 * math.pi * (k + 0.90) / n
            r = 0.605
            P['glass_lantern'].face(
                [polar(a0, r, z0), polar(a1, r, z0), polar(a1, r, z1), polar(a0, r, z1)],
                [(0, 0), (1, 0), (1, 1), (0, 1)], True)
    # diagonal glazing bars in each bay
    for k in range(n):
        a0 = 2 * math.pi * (k + 0.05) / n
        a1 = 2 * math.pi * (k + 0.95) / n
        iron.bar(polar(a0, 0.625, Y_LANTERN0 + 0.03), polar(a1, 0.625, Y_LANTERN1 - 0.03), 0.012, 0.012)

    # the Fresnel lens: a drum of stacked prism rings round a blazing core, on its pedestal
    P['lens'].cylinder((0, 0, 12.08), (0, 0, 12.6), 0.22, 0.22, 16, caps=True)
    for i, z in enumerate((12.1, 12.19, 12.28, 12.37, 12.46, 12.55)):
        P['lens'].ring(z, 0.27 - 0.01 * abs(i - 2.5), 0.035, 20, 5)
    P['brass'].ring(12.33, 0.34, 0.026, 24, 5)
    iron.cylinder((0, 0, Y_DECK), (0, 0, 12.08), 0.1, 0.07, 10)
    iron.cylinder((0, 0, 12.6), (0, 0, 12.68), 0.1, 0.07, 10)

    # the roof: eaves flange, a ribbed copper dome, ventilator, vane and conductor
    cu = P['copper']
    cu.lathe([(0.8, Y_LANTERN1), (0.8, Y_LANTERN1 + 0.1), (0.74, Y_LANTERN1 + 0.1)], 32, tile=2.0, r_ref=0.8, repeat=3)
    arc = [(0.74 * math.cos(t * math.pi / 2), Y_LANTERN1 + 0.1 + 0.62 * math.sin(t * math.pi / 2))
           for t in [i / 8 for i in range(9)]]
    arc[-1] = (0.0, arc[-1][1])
    cu.lathe(arc, 32, tile=2.0, r_ref=0.8, repeat=3)
    for k in range(12):
        a = 2 * math.pi * k / 12
        for (r0, z0), (r1, z1) in zip(arc, arc[1:]):
            iron.bar(polar(a, r0 + 0.012, z0), polar(a, r1 + 0.012, z1), 0.016, 0.012)
    top = arc[-1][1]
    P['brass'].sphere((0, 0, top + 0.07), 0.09, segs=12, rings=8)
    cu.cylinder((0, 0, top + 0.12), (0, 0, top + 0.26), 0.05, 0.03, 10)
    iron.cylinder((0, 0, top + 0.26), (0, 0, top + 1.1), 0.012, 0.007, 6)
    # weathervane: a cross of points and an arrow
    for k in range(4):
        a = k * math.pi / 2
        P['brass'].bar((0, 0, top + 0.62), polar(a, 0.24, top + 0.62), 0.012)
    P['brass'].bar(polar(0.4, -0.3, top + 0.82), polar(0.4, 0.3, top + 0.82), 0.014, 0.01)
    P['brass'].box(polar(0.4, 0.3, top + 0.82), (0.07, 0.03, 0.05), yaw=0.4)
    P['brass'].box(polar(0.4, -0.3, top + 0.82), (0.06, 0.018, 0.1), yaw=0.4)


def place_window(P, a, r, z):
    """A stair window on the hull: surround, sill, lintel and a lit slit."""
    g = P['granite']
    tan = tangent(a)
    c = polar(a, r, z)
    P['glass_warm'].box(c - polar(a, 0.012, 0), (0.03, 0.15, 0.42), yaw=a)
    g.box(c + polar(a, 0.01, -0.25) , (0.1, 0.34, 0.05), yaw=a)
    g.box(c + polar(a, 0.0, 0.27), (0.08, 0.3, 0.07), yaw=a)
    for s in (-1, 1):
        g.box(c + tan * 0.115 * s, (0.07, 0.05, 0.5), yaw=a)


def tower_door(P, a):
    g, wood, iron = P['granite'], P['wood'], P['iron']
    z = 0.3
    r = r_base(z + 0.6)
    tan = tangent(a)
    base = polar(a, r, z)
    # jambs and lintel
    for s in (-1, 1):
        g.box(base + tan * 0.36 * s + Vector((0, 0, 0.75)), (0.22, 0.14, 1.5), yaw=a)
    g.box(base + Vector((0, 0, 1.58)), (0.24, 0.9, 0.18), yaw=a)
    g.box(base + Vector((0, 0, 1.72)), (0.2, 0.3, 0.1), yaw=a)
    # the leaf, recessed, with iron straps and studs
    wood.box(base + polar(a, -0.04, 0.0) + Vector((0, 0, 0.72)), (0.08, 0.6, 1.4), yaw=a)
    for zz in (0.35, 0.72, 1.09):
        iron.box(base + polar(a, 0.02, 0.0) + Vector((0, 0, zz)), (0.02, 0.6, 0.05), yaw=a)
    for s in (-1, 1):
        iron.box(base + polar(a, 0.02, 0.0) + tan * 0.1 * s + Vector((0, 0, 0.72)), (0.02, 0.035, 1.35), yaw=a)
    P['brass'].box(base + polar(a, 0.04, 0.0) + tan * 0.18 + Vector((0, 0, 0.72)), (0.04, 0.05, 0.05), yaw=a)
    # steps down toward the walkway
    for k in range(3):
        g.box(polar(a, r + 0.2 + 0.2 * k, z - 0.0 - 0.1 * k + 0.03), (0.36, 1.0 - 0.08 * k, 0.12 + 0.1 * (2 - k)), yaw=a)
    # lamp over the door on an iron bracket
    iron.bar(base + Vector((0, 0, 1.88)), base + polar(a, 0.22, 1.9), 0.02)
    P['glass_warm'].sphere(base + polar(a, 0.26, 1.82), 0.07, segs=8, rings=6)
    iron.cylinder(base + polar(a, 0.26, 1.9), base + polar(a, 0.26, 1.95), 0.045, 0.02, 8)


# ---------------------------------------------------------------------------------------
# the islet
# ---------------------------------------------------------------------------------------

def islet(P):
    rock = P['rock']
    cottage_c = Vector((2.4, -0.4, 0))

    def height(x, y):
        r = math.hypot(x, y)
        top = 0.46 - (max(r - 2.15, 0) / 1.75) ** 1.7 * 2.7
        n = fractal(x * 0.7 + 3.1, y * 0.7 - 2.2, 0.5, 5)
        top += n * 0.42 * min(max((r - 1.2) / 1.6, 0), 1)
        top += fractal(x * 3.3, y * 3.3, 1.7, 3) * 0.05
        # a flat shelf under the cottage
        d = math.hypot(x - cottage_c.x, y - cottage_c.y)
        if d < 2.5:
            k = min(max((2.5 - d) / 1.3, 0), 1)
            top = top * (1 - k) + 0.52 * k
        # ledges: the strata step the slope
        step = math.floor(top * 3.0) / 3.0
        flat = min(max((2.5 - d) / 1.3, 0), 1)
        return top if flat > 0.99 else top * (0.62 + 0.38 * flat) + step * 0.38 * (1 - flat)

    def colour(x, y, z, nz):
        n = fractal(x * 1.7, y * 1.7, 9.0, 4)
        base = Vector((0.80, 0.82, 0.88)) * (0.7 + 0.5 * (n + 0.5))
        # weed and barnacle belt around the waterline, bleached salt above it
        if 0.0 < z < 0.7:
            k = 1.0 - abs(z - 0.28) / 0.45
            base = base.lerp(Vector((0.30, 0.46, 0.22)), max(k, 0) * 0.8 * (0.5 + 0.5 * (n + 0.5)))
        if z > 0.35 and nz > 0.6:
            base = base.lerp(Vector((2.2, 2.2, 2.1)), min(max(fractal(x * 2.3, y * 2.3, 4.0, 3) + 0.3, 0), 1) * 0.35)
        if z < 0.0:
            base = base.lerp(Vector((0.25, 0.3, 0.28)), 0.5)
        return (base.x, base.y, base.z, 1.0)

    rings, segs = 46, 110
    R = 3.95
    grid = []
    for i in range(rings + 1):
        rr = R * (i / rings) ** 0.85
        row = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            x, y = rr * math.cos(a), rr * math.sin(a)
            row.append(Vector((x, y, height(x, y))))
        grid.append(row)
    for i in range(rings):
        for j in range(segs):
            j2 = (j + 1) % segs
            p00, p01, p10, p11 = grid[i][j], grid[i][j2], grid[i + 1][j], grid[i + 1][j2]
            for tri in ((p00, p10, p01), (p01, p10, p11)):
                n = (tri[1] - tri[0]).cross(tri[2] - tri[0]).normalized()
                uvs = [((p.x) / 3.0, (p.y) / 3.0) for p in tri]
                # steep faces take their texture from the side so strata read as strata
                if abs(n.z) < 0.55:
                    uvs = [((p.x + p.y) / 3.0, p.z / 1.5) for p in tri]
                c = colour(sum(p.x for p in tri) / 3, sum(p.y for p in tri) / 3, sum(p.z for p in tri) / 3, abs(n.z))
                rock.face(list(tri), uvs, False, c)

    # boulders scattered round the foot
    for k in range(11):
        a = 2 * math.pi * (k + 0.35 * fractal(k, 1.3, 0.2, 2)) / 11
        r = 2.5 + (fractal(k * 1.7, 0.4, 5.5, 2) * 0.5 + 0.5) * 1.3
        size = 0.45 + (fractal(k * 2.3, 2.2, 1.1, 2) * 0.5 + 0.5) * 0.55
        boulder(rock, polar(a, r, -0.15 + 0.2 * fractal(k, 5, 5, 2)), size, k, colour)


def boulder(rock, centre, size, seed, colour):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in bm.verts:
        n = fractal(v.co.x * 1.6 + seed * 3.1, v.co.y * 1.6, v.co.z * 1.6 - seed, 4)
        v.co *= size * (1.0 + 0.38 * n)
        v.co.z *= 0.62
    bm.normal_update()
    for f in bm.faces:
        pts = [centre + v.co for v in f.verts]
        n = f.normal
        a, b = (0, 1) if abs(n.z) > 0.55 else ((0, 2) if abs(n.y) > abs(n.x) else (1, 2))
        uvs = [(p[a] / 3.0, p[b] / 3.0) for p in pts]
        c = colour(sum(p.x for p in pts) / 3, sum(p.y for p in pts) / 3, sum(p.z for p in pts) / 3, abs(n.z))
        rock.face(pts, uvs, False, c)
    bm.free()


# ---------------------------------------------------------------------------------------
# the cottage
# ---------------------------------------------------------------------------------------

def cottage(P):
    """Whitewashed keeper's cottage with a slate roof, in its own frame, placed on the islet."""
    pl, slate, wood, brick, gr = P['plaster'], P['slate'], P['wood'], P['brick'], P['granite']
    iron, glass = P['iron'], P['glass_warm']
    c = Vector((2.4, -0.4, 0.46))
    yaw = 0.25
    W, D, H = 2.3, 1.7, 1.12

    def at(x, y, z):
        """Cottage-local point (x along the front, y toward the back, z up) to world."""
        s, co = math.sin(yaw), math.cos(yaw)
        return Vector((c.x + x * co - y * s, c.y + x * s + y * co, c.z + z))

    def box(local, size, part=pl, **k):
        part.box(at(*local), size, yaw=yaw + k.pop('yaw', 0.0), **k)

    # stone plinth, walls
    box((0, 0, 0.1), (W + 0.12, D + 0.12, 0.2), gr)
    box((0, 0, 0.2 + H / 2), (W, D, H), pl, tile=2.5)
    # gable ends: the triangle across the depth, stacked as layers along the ridge
    z_w = 0.2 + H
    rise = 0.62
    for k in range(6):
        d_k = D * (1 - (k + 0.5) / 6) * 0.98
        box((0, 0, z_w + 0.0475 + k * rise / 6), (W, d_k, rise / 6 + 0.01), pl, tile=2.5)
    # roof: two slate slabs with an overhang, and a ridge cap
    half = D / 2 + 0.14
    z_ridge = z_w + rise + 0.05
    z_eave = z_w + 0.05 - rise * 0.14 / (D / 2)
    ang = math.atan2(z_ridge - z_eave, half)
    Ls = math.hypot(half, z_ridge - z_eave)
    for s_ in (-1, 1):
        slate.box(at(0, s_ * half / 2, (z_ridge + z_eave) / 2), (W + 0.3, Ls, 0.05), yaw=yaw, roll=-s_ * ang, tile=1.5)
    box((0, 0, z_ridge + 0.02), (W + 0.32, 0.1, 0.05), gr)
    # chimney with a cap and two pots
    box((0.7, -0.1, 0.2 + H + 0.45), (0.3, 0.3, 0.95), brick, tile=1.2)
    box((0.7, -0.1, 0.2 + H + 0.95), (0.38, 0.38, 0.07), gr)
    for dx in (-0.07, 0.07):
        P['brick'].cylinder(at(0.7 + dx, -0.1, 0.2 + H + 0.98), at(0.7 + dx, -0.1, 0.2 + H + 1.16), 0.05, 0.045, 8)
    # windows: frame, sill, lit pane, two on the front, one each side
    def window(x, y, z, face_yaw):
        out = Vector((math.cos(face_yaw), math.sin(face_yaw)))
        frame = wood
        p = at(x, y, z)
        glass.box(p, (0.02, 0.3, 0.34), yaw=yaw + face_yaw)
        for s in (-1, 1):
            frame.box(p + Vector((0, 0, 0)) + tangent_for(face_yaw + yaw) * 0.17 * s, (0.05, 0.04, 0.42), yaw=yaw + face_yaw)
        frame.box(p + Vector((0, 0, 0.2)), (0.05, 0.38, 0.04), yaw=yaw + face_yaw)
        frame.box(p + Vector((0, 0, -0.2)), (0.07, 0.4, 0.04), yaw=yaw + face_yaw)
        frame.box(p, (0.04, 0.3, 0.025), yaw=yaw + face_yaw)
        frame.box(p, (0.04, 0.025, 0.34), yaw=yaw + face_yaw)
        gr.box(p + Vector((0, 0, -0.25)), (0.12, 0.42, 0.05), yaw=yaw + face_yaw)
    def tangent_for(a):
        return Vector((-math.sin(a), math.cos(a), 0))

    # front faces local -y? the original front door faces +z in three (Blender -y); use -y as front
    front = -math.pi / 2
    window(-0.7, -D / 2 - 0.0, 0.75, front)
    window(0.7, -D / 2 - 0.0, 0.75, front)
    window(W / 2, 0.0, 0.75, 0.0)
    window(-W / 2, 0.0, 0.75, math.pi)
    # door with a hood and a lit lamp
    wood.box(at(-0.02, -D / 2 - 0.0, 0.2 + 0.4), (0.06, 0.34, 0.76), yaw=yaw + front)
    gr.box(at(-0.02, -D / 2 - 0.02, 0.2 + 0.84), (0.1, 0.5, 0.08), yaw=yaw + front)
    P['slate'].box(at(-0.02, -D / 2 - 0.22, 0.2 + 0.98), (0.5, 0.5, 0.04), yaw=yaw + front, pitch=0.0)
    for s in (-1, 1):
        wood.box(at(-0.02 + s * 0.27, -D / 2 - 0.4, 0.2 + 0.5), (0.04, 0.04, 0.96), yaw=yaw + front)
    glass.sphere(at(0.3, -D / 2 - 0.08, 0.2 + 0.78), 0.05, segs=8, rings=5)
    # doorstep
    gr.box(at(-0.02, -D / 2 - 0.3, 0.12), (0.56, 0.42, 0.1), yaw=yaw)

    # the store: a lean-to of stone with a plank door, joined to the end of the cottage
    box((-W / 2 - 0.45, 0.1, 0.2 + 0.36), (0.8, 0.9, 0.72), pl, tile=2.5)
    P['slate'].box(at(-W / 2 - 0.45, 0.1, 0.2 + 0.76), (0.92, 1.0, 0.04), yaw=yaw, pitch=-0.18, tile=1.5)
    wood.box(at(-W / 2 - 0.45, 0.1 - 0.46, 0.2 + 0.32), (0.4, 0.04, 0.6), yaw=yaw)

    # a low stone yard wall with a gap for the path
    for k in range(7):
        x = -1.4 + k * 0.5
        if abs(x - 0.0) < 0.35:
            continue
        gr.box(at(x, -D / 2 - 0.62, 0.2 + 0.0), (0.5, 0.12, 0.28), yaw=yaw)


def props(P):
    """Barrels, crates, a lifebuoy, coiled rope, bollards and a flag mast: the working litter of a station."""
    m = P['misc']
    c = Vector((2.4, -0.4, 0.46))
    yaw = 0.25

    def local(x, y):
        s, co = math.sin(yaw), math.cos(yaw)
        return Vector((c.x + x * co - y * s, c.y + x * s + y * co, c.z))

    def barrel(x, y, col=(0.28, 0.17, 0.09, 1)):
        p = local(x, y)
        m.cylinder(p + Vector((0, 0, 0.0)), p + Vector((0, 0, 0.3)), 0.11, 0.11, 10, colour=col)
        for z in (0.07, 0.23):
            m.cylinder(p + Vector((0, 0, z - 0.012)), p + Vector((0, 0, z + 0.012)), 0.115, 0.115, 10, caps=False,
                       colour=(0.1, 0.1, 0.11, 1))

    barrel(-0.6, -1.15)
    barrel(-0.38, -1.2, (0.2, 0.22, 0.26, 1))
    barrel(1.1, 0.95, (0.45, 0.12, 0.08, 1))
    for i, (x, y, z, s) in enumerate([(1.4, -1.1, 0.0, 0.22), (1.4, -1.1, 0.22, 0.2), (1.68, -1.05, 0.0, 0.2)]):
        p = local(x, y)
        m.box(p + Vector((0, 0, z + s / 2)), (s, s, s), yaw=yaw + 0.2 * i, colour=(0.42, 0.3, 0.18, 1))
    # coiled rope
    p = local(-1.15, -1.1)
    for k in range(4):
        m.ring(p.z + 0.03 + 0.03 * k, 0.1, 0.022, 14, 5, colour=(0.62, 0.52, 0.36, 1), centre=(p.x, p.y))
    # lifebuoy hung on the tower: red and white
    a = DOOR_ANGLE + 0.9
    r = r_base(1.4) + 0.05
    centre = polar(a, r, 1.5)
    for k in range(12):
        t0, t1 = 2 * math.pi * k / 12, 2 * math.pi * (k + 1) / 12
        col = (0.85, 0.1, 0.08, 1) if k % 2 == 0 else (0.92, 0.92, 0.9, 1)
        tan = tangent(a)
        up = Vector((0, 0, 1))
        pts = []
        for ang, rad in ((t0, 0.17), (t1, 0.17), (t1, 0.1), (t0, 0.1)):
            pts.append(centre + tan * rad * math.cos(ang) + up * rad * math.sin(ang) + polar(a, 0.02, 0))
        m.face(pts, [(0, 0), (1, 0), (1, 1), (0, 1)], False, col)
        pts2 = [p - polar(a, 0.04, 0) for p in pts][::-1]
        m.face(pts2, [(0, 0), (1, 0), (1, 1), (0, 1)], False, col)
    # mooring bollards on the rocks
    for ang in (3.2, 4.0):
        p = polar(ang, 2.55, 0.12)
        m.cylinder(p, p + Vector((0, 0, 0.18)), 0.055, 0.045, 8, colour=(0.08, 0.09, 0.1, 1))
        m.sphere(p + Vector((0, 0, 0.2)), 0.06, segs=8, rings=5, colour=(0.08, 0.09, 0.1, 1))
    # a flag mast by the cottage with a small red ensign
    p = local(0.9, 0.65)
    m.cylinder(p + Vector((0, 0, 1.2)), p + Vector((0, 0, 2.5)), 0.018, 0.012, 6, colour=(0.8, 0.8, 0.78, 1))
    m.face([p + Vector((0, 0, 2.45)), p + Vector((0.5, 0.0, 2.38)), p + Vector((0.5, 0.0, 2.2)), p + Vector((0, 0, 2.15))],
           [(0, 1), (1, 1), (1, 0), (0, 0)], False, (0.75, 0.08, 0.08, 1))
    m.face([p + Vector((0, 0, 2.15)), p + Vector((0.5, 0.0, 2.2)), p + Vector((0.5, 0.0, 2.38)), p + Vector((0, 0, 2.45))],
           [(0, 0), (1, 0), (1, 1), (0, 1)], False, (0.75, 0.08, 0.08, 1))
