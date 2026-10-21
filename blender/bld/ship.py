"""A container freighter, bow toward +X, Z up, waterline at z = 0, 9.2 units long.

Lofted from cross-sections (a flared bow with a bulb, parallel midbody, a transom stern), a steel
deck with hatch covers, stacks of corrugated containers in a palette of line colours, a five-deck
accommodation block aft with a wide bridge, a funnel and a radar mast, lifeboats, vents, a forecastle
with a windlass and bollards, handrails and lit windows. One mesh per material, named for it, with
colour in vertex colours. Empties mark the navigation lights and the radar.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

X0, X1 = -4.3, 4.9           # stern, bow
BEAM = 0.95                  # half beam
KEEL = -0.53
DECK = 0.64
WL = 0.0

PALETTE = ['#c8402f', '#2f66b3', '#e0a52b', '#2e8b57', '#d9d9d6', '#e07b2e', '#6b6f78', '#8b5a34',
           '#1f4f6e', '#a2283b', '#cfd3d8', '#3c7f9e']


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def rgba(h, v=1.0):
    """sRGB hex to a linear vertex colour."""
    h = h.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        c = c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
        out.append(min(c * v, 1.0))
    return (out[0], out[1], out[2], 1.0)


class Part:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.col = self.bm.loops.layers.color.new('Col')

    def poly(self, pts, colour, uvs=None, smooth_shade=False):
        try:
            f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        except ValueError:
            return None
        for i, loop in enumerate(f.loops):
            loop[self.col] = colour
            if uvs:
                loop[self.uv].uv = uvs[i]
        f.smooth = smooth_shade
        return f

    def box(self, c, size, colour, sides_uv=False, tile=1.0):
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        loc = [Vector(p) for p in [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
                                   (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]]
        off = Vector(c)
        for idx, axis in (((4, 5, 6, 7), 2), ((0, 3, 2, 1), 2), ((0, 4, 7, 3), 0), ((1, 2, 6, 5), 0), ((0, 1, 5, 4), 1), ((3, 7, 6, 2), 1)):
            pts = [off + loc[i] for i in idx]
            if sides_uv and axis != 2:
                uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
            else:
                a, b = [(1, 2), (0, 2), (0, 1)][axis]
                uvs = [(loc[i][a] / tile, loc[i][b] / tile) for i in idx]
            self.poly(pts, colour, uvs)

    def cyl(self, p0, p1, r0, r1=None, colour=(1, 1, 1, 1), segs=10, caps=True):
        r1 = r0 if r1 is None else r1
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        z = d.normalized()
        ref = Vector((0, 0, 1)) if abs(z.z) < 0.95 else Vector((1, 0, 0))
        x = z.cross(ref).normalized()
        y = z.cross(x)

        def ring(t, r, a):
            return p0 + d * t + (x * math.cos(a) + y * math.sin(a)) * r
        for j in range(segs):
            a0, a1 = 2 * math.pi * j / segs, 2 * math.pi * (j + 1) / segs
            self.poly([ring(0, r0, a0), ring(0, r0, a1), ring(1, r1, a1), ring(1, r1, a0)], colour, smooth_shade=True)
            if caps:
                self.poly([p0, ring(0, r0, a1), ring(0, r0, a0)], colour)
                self.poly([p1, ring(1, r1, a0), ring(1, r1, a1)], colour)

    def ellipsoid(self, c, r, colour, segs=14, rings=8):
        c = Vector(c)
        for k in range(rings):
            p0, p1 = math.pi * k / rings - math.pi / 2, math.pi * (k + 1) / rings - math.pi / 2
            for j in range(segs):
                a0, a1 = 2 * math.pi * j / segs, 2 * math.pi * (j + 1) / segs

                def pt(a, p):
                    return c + Vector((r[0] * math.cos(p) * math.cos(a), r[1] * math.cos(p) * math.sin(a), r[2] * math.sin(p)))
                self.poly([pt(a1, p0), pt(a0, p0), pt(a0, p1), pt(a1, p1)], colour, smooth_shade=True)

    def finish(self, collection):
        if not self.bm.faces:
            return None
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-6)
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        return obj


# ---- hull lines -------------------------------------------------------------------------------

def half_beam(s):
    if s > 0.6:
        t = (s - 0.6) / 0.4
        return BEAM * max(0.0, 1 - t ** 1.7) ** 0.62
    return BEAM * (0.66 + 0.34 * smooth(0.0, 0.14, s))


def keel_z(s):
    if s > 0.82:
        return lerp(KEEL, -0.08, smooth(0.82, 1.0, s))
    if s < 0.1:
        return lerp(-0.36, KEEL, smooth(0.0, 0.1, s))
    return KEEL


def deck_z(s):
    return DECK + (0.14 * ((s - 0.78) / 0.22) ** 2 if s > 0.78 else 0.0) + 0.05 * (1 - smooth(0.0, 0.12, s))


def section(s):
    """Starboard cross-section points (y, z) from the keel centreline up to the deck edge."""
    b = max(half_beam(s), 0.015)
    zk, zd = keel_z(s), deck_z(s)
    rb = min(0.3, b * 0.6)
    pts = [(0.0, zk), (max(b - rb, 0.0) * 0.55, zk), (max(b - rb, 0.0), zk)]
    for k in range(1, 5):
        a = math.pi / 2 * k / 4
        pts.append((b - rb + rb * math.sin(a), zk + rb - rb * math.cos(a)))
    flare = 1 + 0.34 * smooth(0.7, 1.0, s)
    for z in (WL - 0.05, WL + 0.2, zd):
        t = max(0.0, (z - (zk + rb)) / max(zd - (zk + rb), 1e-6))
        pts.append((b * (1 + (flare - 1) * t ** 1.4), z))
    return pts


def hull(c):
    part = Part('hull')
    black, red = rgba('#171d25'), rgba('#7c2a22')
    n_st = 48
    rings = []
    for i in range(n_st + 1):
        s = i / n_st
        rings.append([(lerp(X0, X1, s), y, z) for y, z in section(s)])
    n = len(rings[0])
    for side in (1, -1):
        for i in range(n_st):
            for j in range(n - 1):
                quad = [rings[i][j], rings[i + 1][j], rings[i + 1][j + 1], rings[i][j + 1]]
                pts = [(p[0], side * p[1], p[2]) for p in quad]
                if side == -1:
                    pts = pts[::-1]
                zc = sum(p[2] for p in pts) / 4
                part.poly(pts, red if zc < WL + 0.02 else black, smooth_shade=True)
    # transom
    tr = rings[0]
    outline = [(p[0], p[1], p[2]) for p in tr] + [(p[0], -p[1], p[2]) for p in reversed(tr[1:-1])]
    part.poly(outline, black)
    # bulbous bow below the waterline, ahead of the stem
    part.ellipsoid((X1 - 0.06, 0, -0.3), (0.34, 0.13, 0.17), red)
    # a white rudder and skeg are below the waterline, unseen; the propeller guard rail is skipped
    # make every face point outward: reference is the nearest point on the centreline
    bm = part.bm
    bm.normal_update()
    for f in bm.faces:
        ctr = f.calc_center_median()
        out = Vector((0, ctr.y, ctr.z + 0.2))
        if f.normal.dot(out) < 0 and abs(ctr.y) > 1e-3:
            f.normal_flip()
    # the transom faces aft
    for f in bm.faces:
        ctr = f.calc_center_median()
        if abs(ctr.y) < 1e-3 and ctr.x < X0 + 0.01 and f.normal.x > 0:
            f.normal_flip()
    return part


def deck(c):
    part = Part('deck')
    grey, green = rgba('#505862'), rgba('#3f4d45')
    top = []
    for i in range(49):
        s = i / 48
        top.append((lerp(X0, X1, s), half_beam(s) * (1 + 0.34 * smooth(0.7, 1.0, s)), deck_z(s)))
    outline = top + [(x, -y, z) for x, y, z in reversed(top[1:-1])]
    f = part.poly(outline, grey)
    if f is not None:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
        bmesh.ops.triangulate(part.bm, faces=[f])
    # hatch covers
    for bay in range(10):
        x = -2.62 + bay * 0.64 + 0.32
        part.box((x, 0, deck_z((x - X0) / (X1 - X0)) + 0.03), (0.6, 1.62, 0.06), green)
    # the raised forecastle bulwark and a poop deck
    part.box((4.05, 0, DECK + 0.08), (1.1, 1.45, 0.1), grey)
    return part


def containers(c):
    part = Part('containers')
    rnd = random.Random(7)
    for bay in range(11):
        x = -2.55 + bay * 0.635
        s = (x - X0) / (X1 - X0)
        avail = 2 * half_beam(s) * 0.93
        cols = max(0, min(3, int(avail / 0.6)))
        if cols == 0:
            continue
        tiers = 5 if bay < 3 else (4 if bay < 7 else 3)
        if cols < 3:
            tiers = max(2, tiers - 1)
        y0 = -0.6 * (cols - 1) / 2
        for col in range(cols):
            y = y0 + col * 0.6
            ht = tiers - (1 if rnd.random() < 0.18 else 0) - (1 if col == 1 and rnd.random() < 0.12 else 0)
            colour = rnd.choice(PALETTE)
            for tier in range(ht):
                if tier > 0 and rnd.random() < 0.55:
                    colour = rnd.choice(PALETTE)
                shade = 0.82 + rnd.random() * 0.3
                z = deck_z(s) + 0.06 + 0.15 + tier * 0.3
                part.box((x, y, z), (0.6, 0.56, 0.285), rgba(colour, shade), sides_uv=True)
    return part


def upper(c):
    """The accommodation block, bridge, funnel, mast, lifeboats, vents, rails, bollards."""
    part = Part('upper')
    white, grey = rgba('#dfe2e6'), rgba('#9aa2ad')
    dark, orange = rgba('#262c35'), rgba('#e2641b')
    # five decks, stepping in; the bridge deck is the widest, with wings
    z0 = DECK + 0.03
    decks = [(-3.55, 1.1, 0.86), (-3.52, 1.04, 0.82), (-3.5, 0.98, 0.78), (-3.5, 0.94, 0.74)]
    for i, (cx, w, hw) in enumerate(decks):
        part.box((cx, 0, z0 + 0.14 + i * 0.28), (w, hw * 2, 0.28), white)
    zb = z0 + 4 * 0.28
    part.box((-3.55, 0, zb + 0.14), (0.7, 1.9, 0.28), white)          # the bridge with its wings
    part.box((-3.55, 0, zb + 0.3), (0.76, 1.96, 0.04), grey)          # the roof
    # funnel, raked aft, with a company band and a black top
    part.cyl((-3.95, 0, zb - 0.1), (-4.02, 0, zb + 0.68), 0.19, 0.17, rgba('#d9b13a'), 14)
    part.cyl((-4.0, 0, zb + 0.5), (-4.02, 0, zb + 0.68), 0.172, 0.17, rgba('#1b1f26'), 14)
    part.cyl((-3.97, 0, zb + 0.28), (-3.99, 0, zb + 0.4), 0.182, 0.18, rgba('#f2f2f0'), 14)
    # radar mast (the radar itself is an Empty, with its bar below)
    part.cyl((-3.42, 0, zb + 0.32), (-3.42, 0, zb + 0.9), 0.022, 0.016, grey, 8)
    part.cyl((-3.42, 0, zb + 0.9), (-3.42, 0, zb + 1.02), 0.008, 0.005, grey, 6)
    # lifeboats on davits, one pair a side
    for side in (-1, 1):
        for x in (-3.15, -3.62):
            part.cyl((x - 0.16, side * 0.9, z0 + 0.62), (x + 0.16, side * 0.9, z0 + 0.62), 0.07, 0.07, orange, 8)
            part.box((x, side * 0.9, z0 + 0.7), (0.34, 0.12, 0.03), white)
            part.box((x - 0.14, side * 0.9, z0 + 0.74), (0.02, 0.02, 0.15), dark)
            part.box((x + 0.14, side * 0.9, z0 + 0.74), (0.02, 0.02, 0.15), dark)
    # vent masts down both sides, bollards and a windlass forward
    for side in (-1, 1):
        for k in range(10):
            x = -2.4 + k * 0.62
            s = (x - X0) / (X1 - X0)
            y = side * (half_beam(s) - 0.04)
            z = deck_z(s)
            part.cyl((x, y, z), (x, y, z + 0.13), 0.018, 0.018, grey, 6)
            part.cyl((x, y, z + 0.13), (x, y * 0.97, z + 0.16), 0.018, 0.022, grey, 6)
    for side in (-1, 1):
        for x in (3.5, 3.9, 4.3):
            s = (x - X0) / (X1 - X0)
            part.cyl((x, side * (half_beam(s) - 0.12), deck_z(s) + 0.1), (x, side * (half_beam(s) - 0.12), deck_z(s) + 0.2), 0.03, 0.03, dark, 8)
    part.box((4.05, 0, DECK + 0.21), (0.3, 0.5, 0.1), dark)
    part.cyl((4.05, -0.25, DECK + 0.21), (4.05, 0.25, DECK + 0.21), 0.07, 0.07, grey, 10)
    # foremast with a light, and the bow's jackstaff
    part.cyl((4.4, 0, DECK + 0.14), (4.4, 0, DECK + 0.7), 0.022, 0.014, white, 8)
    part.cyl((-4.15, 0, DECK + 0.1), (-4.15, 0, DECK + 0.45), 0.015, 0.012, white, 6)
    # handrails: posts every 0.15 and two rails, port and starboard
    for side in (-1, 1):
        prev = None
        for i in range(0, 47):
            s = i / 48
            x = lerp(X0 + 0.05, X1 - 0.1, i / 46)
            s = (x - X0) / (X1 - X0)
            y = side * (half_beam(s) * (1 + 0.34 * smooth(0.7, 1.0, s)) - 0.02)
            z = deck_z(s)
            if i % 2 == 0:
                part.cyl((x, y, z), (x, y, z + 0.08), 0.006, 0.006, white, 5, caps=False)
            if prev is not None:
                part.cyl(prev, (x, y, z + 0.08), 0.004, 0.004, white, 4, caps=False)
            prev = (x, y, z + 0.08)
    return part


def lit(c):
    """Windows: warm, a quarter of them dark. Placed a hair proud of the block's faces."""
    part = Part('lit')
    rnd = random.Random(11)
    warm, off = rgba('#ffd9a0'), rgba('#141a24')
    z0 = DECK + 0.03
    decks = [(-3.55, 1.1, 0.86), (-3.52, 1.04, 0.82), (-3.5, 0.98, 0.78), (-3.5, 0.94, 0.74)]
    for i, (cx, w, hw) in enumerate(decks):
        zc = z0 + 0.14 + i * 0.28 + 0.03
        # front (+x) and the two sides
        for k in range(9):
            y = -hw + 0.1 + k * (2 * hw - 0.2) / 8
            part.box((cx + w / 2 + 0.003, y, zc), (0.006, 0.09, 0.07), warm if rnd.random() < 0.78 else off)
        for side in (-1, 1):
            for k in range(6):
                x = cx - w / 2 + 0.12 + k * (w - 0.24) / 5
                part.box((x, side * (hw + 0.003), zc), (0.09, 0.006, 0.07), warm if rnd.random() < 0.78 else off)
    zb = z0 + 4 * 0.28
    part.box((-3.55 + 0.352, 0, zb + 0.15), (0.006, 1.8, 0.11), warm)        # the bridge window band
    for side in (-1, 1):
        part.box((-3.55, side * 0.983, zb + 0.15), (0.6, 0.006, 0.1), warm)
    return part


def empties(collection):
    """Navigation lights and the radar's pivot."""
    z0 = DECK + 0.03
    zb = z0 + 4 * 0.28
    marks = {
        'nav_red': (-3.55, -0.99, zb + 0.18),
        'nav_green': (-3.55, 0.99, zb + 0.18),
        'nav_mast': (-3.42, 0, zb + 1.04),
        'nav_bow': (4.4, 0, DECK + 0.72),
        'nav_stern': (-4.15, 0, DECK + 0.47),
        'radar': (-3.42, 0, zb + 0.6),
    }
    for name, p in marks.items():
        e = bpy.data.objects.new(name, None)
        e.location = p
        collection.objects.link(e)
    return marks


def build(collection):
    out = {}
    for fn in (hull, deck, containers, upper, lit):
        part = fn(collection)
        obj = part.finish(collection)
        out[part.name] = obj
    empties(collection)
    return out
