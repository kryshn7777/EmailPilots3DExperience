"""A 1,800-TEU feeder container ship, built in metres: bow toward +X, port +Y, Z up, waterline z = 0.

181 m overall, 27.2 m beam, 8 m draught, 14.5 m to the main deck. The scene scales it by 0.5 units a metre,
the same scale as the lighthouse (a 38 m tower to the lantern), so the two are in true proportion.

  hull        lofted from cross-sections (a bilge, flared topsides, a raked stem, a bulbous bow, a raked
              transom with rudder and propeller), antifouling red under the waterline, boot topping, navy
              topsides weathered with rust streaks, bilge keels, draught marks, the name, a load line
  deck        steel deck, hatch covers on raised coamings, cell guides, lashing bridges, vents
  containers  ISO 20 ft and 40 ft boxes (standard and high-cube) in line colours, door ends, corner castings
  upper       the eight-level accommodation block with bridge wings, funnel and logo, mast and scanners,
              lifeboats on davits, rails, ladders, cranes, winches, bollards, foremast, flagstaffs
  lit         windows, lamp fixtures (emissive)

One mesh per material, named for it, colour in vertex colours; Empties mark the navigation lights, the
deck floodlights and the radar scanners. `build(collection, detail)` with detail 'low' leaves out the
details that only read close up (castings, door bars, rails, ladders, lettering) for phones.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

# ---- principal dimensions (m) -------------------------------------------------------------------
X0, XS = -84.0, 88.0         # keel-level transom, stem station (the raked tops reach -90 and +91.6)
HB = 13.6                    # half beam
T = 8.0                      # draught
DECK = 6.5                   # main deck above the waterline
DH = 14.5                    # keel to main deck
BODY0, BODY1 = -40.0, 32.0   # parallel midbody
COLP = 2.6                   # container column pitch
BAY0, BAYP, NBAY = -54.0, 12.9, 9
LEV = 3.4                    # accommodation deck height

NAVY = '#3a6494'
TOPSIDE = NAVY
HULL_RED = '#7b231c'
BOOT = '#16181c'
LINE_PALETTE = [
    ('#c8402f', 3), ('#2f66b3', 3), ('#e0a52b', 2), ('#2e8b57', 2), ('#d9d9d6', 3), ('#e07b2e', 2),
    ('#6b6f78', 2), ('#8b5a34', 2), ('#1f4f6e', 3), ('#a2283b', 2), ('#cfd3d8', 2), ('#3c7f9e', 2),
    ('#e8c840', 2), ('#a8b4c4', 1), ('#5d2f6e', 1), ('#3d5a3a', 1),
]


def lerp(a, b, t):
    return a + (b - a) * t


def clamp(x, a, b):
    return max(a, min(b, x))


def smooth(a, b, x):
    t = clamp((x - a) / (b - a), 0.0, 1.0)
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


def mixc(a, b, t):
    return tuple(lerp(a[i], b[i], t) for i in range(4))


def shade(c, v):
    return (min(c[0] * v, 1.0), min(c[1] * v, 1.0), min(c[2] * v, 1.0), 1.0)


def hash2(i, j):
    n = (i * 374761393 + j * 668265263) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


def vnoise(x, y):
    xi, yi = math.floor(x), math.floor(y)
    fx, fy = x - xi, y - yi
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = hash2(xi, yi), hash2(xi + 1, yi)
    c, d = hash2(xi, yi + 1), hash2(xi + 1, yi + 1)
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy)


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
        multi = isinstance(colour, list)
        for i, loop in enumerate(f.loops):
            loop[self.col] = colour[i] if multi else colour
            loop[self.uv].uv = uvs[i] if uvs else (0.5, 0.01)
        f.smooth = smooth_shade
        return f

    def facing(self, pts, colour, direction, uvs=None):
        """A polygon wound so its normal points along `direction` (colour may be a list per point)."""
        a, b, c = Vector(pts[0]), Vector(pts[1]), Vector(pts[2])
        n = (b - a).cross(c - a)
        if n.dot(Vector(direction)) < 0:
            pts = pts[::-1]
            if isinstance(colour, list):
                colour = colour[::-1]
            if uvs:
                uvs = uvs[::-1]
        return self.poly(pts, colour, uvs)

    def box(self, c, size, colour, uv='flat', faces='xXyYzZ'):
        """An axis-aligned box. `faces` picks sides: x/X = -x/+x, y/Y, z/Z (bottom/top)."""
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        loc = [Vector(p) for p in [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
                                   (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]]
        off = Vector(c)
        table = {'Z': (4, 5, 6, 7), 'z': (0, 3, 2, 1), 'x': (0, 4, 7, 3), 'X': (1, 2, 6, 5), 'y': (0, 1, 5, 4), 'Y': (3, 7, 6, 2)}
        for key in faces:
            idx = table[key]
            pts = [off + loc[i] for i in idx]
            self.poly(pts, colour)

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

    def beam(self, p0, p1, w0, w1=None, colour=(1, 1, 1, 1), h0=None, h1=None, up=(0, 0, 1)):
        """A tapered square-section bar between two points."""
        w1 = w0 if w1 is None else w1
        h0 = w0 if h0 is None else h0
        h1 = w1 if h1 is None else h1
        p0, p1 = Vector(p0), Vector(p1)
        z = (p1 - p0).normalized()
        ref = Vector(up) if abs(z.dot(Vector(up))) < 0.95 else Vector((1, 0, 0))
        x = z.cross(ref).normalized()
        y = z.cross(x).normalized()

        def sq(p, w, h):
            return [p + x * (w / 2) + y * (h / 2), p - x * (w / 2) + y * (h / 2),
                    p - x * (w / 2) - y * (h / 2), p + x * (w / 2) - y * (h / 2)]
        a, b = sq(p0, w0, h0), sq(p1, w1, h1)
        for i in range(4):
            j = (i + 1) % 4
            self.poly([a[i], a[j], b[j], b[i]], colour)
        self.poly(a[::-1], colour)
        self.poly(b, colour)

    def prism(self, ring_pts, z0, z1, colour, cap_top=True, smooth_sides=False, taper=None):
        """Extrude a convex polygon (counter-clockwise from +z) between two heights."""
        n = len(ring_pts)
        lo = [(x, y, z0) for x, y in ring_pts]
        hi = [(x, y, z1) for x, y in ring_pts] if taper is None else [(x * taper[0] + taper[1], y * taper[2], z1) for x, y in ring_pts]
        for i in range(n):
            j = (i + 1) % n
            self.poly([lo[i], lo[j], hi[j], hi[i]], colour, smooth_shade=smooth_sides)
        if cap_top:
            self.poly(hi, colour)

    def ellipsoid(self, c, r, colour, segs=14, rings=8, uvs=False):
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
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        return obj


# ---- hull lines ---------------------------------------------------------------------------------

def half_beam(x):
    if x > BODY1:
        t = (x - BODY1) / (XS - BODY1)
        return HB * max(0.0, 1 - t ** 2.2) ** 0.6
    if x < BODY0:
        t = (BODY0 - x) / (BODY0 - X0)
        return HB * (1 - 0.25 * t ** 1.6)
    return HB


def keel_z(x):
    if x > 58.0:
        return lerp(-T, -5.0, smooth(58.0, XS, x) ** 1.3)
    if x < -52.0:
        return lerp(-T, -4.4, smooth(-52.0, X0, x))
    return -T


def deck_z(x):
    return DECK + 2.0 * smooth(46.0, 90.0, x) ** 1.6 + 0.5 * (1 - smooth(-84.0, -58.0, x))


def flare(x):
    return 1 + 0.26 * smooth(38.0, 86.0, x) + 0.12 * (1 - smooth(-84.0, -50.0, x))


def rake(x):
    """How far the top of a section sits ahead of its keel (the raked stem forward, the raked transom aft)."""
    return 3.6 * smooth(52.0, XS, x) - 6.0 * (1 - smooth(-84.0, -62.0, x))


def bilge_r(x):
    return min(2.5, half_beam(x) * 0.55)


def section_y(x, z):
    """Starboard half breadth of the hull at station x and height z."""
    b = half_beam(x)
    zk = keel_z(x)
    rb = bilge_r(x)
    zd = deck_z(x)
    zr = zk + rb
    if z <= zr:
        dz = min(max(zr - z, 0.0), rb)
        return (b - rb) + math.sqrt(max(rb * rb - dz * dz, 0.0))
    t = clamp((z - zr) / max(zd - zr, 1e-6), 0.0, 1.0)
    return b * (1 + (flare(x) - 1) * t ** 1.5)


def shear(x, z):
    return rake(x) * (z + T) / DH


def surf(x_world, z):
    """(station, half breadth) of the hull surface where the world x and z are: the loft's inverse."""
    xs = x_world
    for _ in range(5):
        xs = clamp(x_world - shear(xs, z), X0, XS)
    return xs, section_y(xs, z)


def hull_y(x, z):
    return surf(x, z)[1]


def stations():
    xs = []
    xs += [lerp(X0, BODY0, i / 22) for i in range(22)]
    xs += [lerp(BODY0, BODY1, i / 18) for i in range(18)]
    xs += [lerp(BODY1, XS, i / 40) for i in range(41)]
    return xs


LEVELS = (-3.0, -1.6, -0.6, 0.0, 0.7, 1.3, 2.4, 3.6, 4.8, 5.8)


def section_pts(x):
    """Starboard cross-section (y, z) from the keel centre line up to the deck edge: always the same rows."""
    b = max(half_beam(x), 0.0)
    zk, zd, rb = keel_z(x), deck_z(x), bilge_r(x)
    pts = [(0.0, zk), ((b - rb) * 0.5, zk), (max(b - rb, 0.0), zk)]
    for k in range(1, 7):
        a = math.pi / 2 * k / 6
        pts.append((b - rb + rb * math.sin(a), zk + rb - rb * math.cos(a)))
    zr = zk + rb
    for z in LEVELS:
        ze = min(max(z, zr + 0.01), zd - 0.05)
        pts.append((section_y(x, ze), ze))
    pts.append((section_y(x, zd), zd))
    return pts


def hull_xyz(x, y, z):
    return (x + shear(x, z), y, z)


def ccw(ring):
    area = sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))
    return ring if area > 0 else ring[::-1]


def hull(detail):
    part = Part('hull')
    red, boot, top = rgba(HULL_RED), rgba(BOOT), rgba(TOPSIDE)
    xs = stations()
    rings = [[hull_xyz(x, y, z) for y, z in section_pts(x)] for x in xs]
    n = len(rings[0])

    def colour_at(p, zc):
        wob = vnoise(p[0] * 0.18, zc * 0.9) * 0.22 + vnoise(p[0] * 0.9, zc * 2.1) * 0.08
        if zc < -0.15:
            return shade(mixc(red, rgba('#9b3a2a'), vnoise(p[0] * 0.3, zc * 0.4)), 0.8 + wob)
        if zc < 1.25:
            return shade(boot, 0.9 + wob * 0.8)
        # topsides: plated in strakes and frames, each a shade of its own, slightly sun-faded higher up
        plate = 0.9 + 0.2 * hash2(int((p[0] + 100) // 6), int((zc + 10) // 2.4))
        return shade(mixc(top, rgba('#2f527f'), smooth(1.2, 6.0, zc) * 0.4), (0.82 + wob) * plate)

    for side in (1, -1):
        for i in range(len(rings) - 1):
            for j in range(n - 1):
                quad = [rings[i][j], rings[i + 1][j], rings[i + 1][j + 1], rings[i][j + 1]]
                pts = [(p[0], side * p[1], p[2]) for p in quad]
                zc = sum(p[2] for p in pts) / 4
                f = part.poly(pts, colour_at(pts[0], zc), smooth_shade=True)
                if f is not None:
                    f.normal_update()
                    ctr = f.calc_center_median()
                    out = Vector((0, ctr.y, ctr.z + 3.0))
                    if f.normal.dot(out) < 0:
                        f.normal_flip()
    # the transom: a flat plate closing the first section, facing aft
    tr = rings[0]
    outline = list(tr) + [(p[0], -p[1], p[2]) for p in reversed(tr[1:])]
    part.facing(outline, [colour_at(p, p[2]) for p in outline], (-1, 0, 0))
    # the bulbous bow, below the waterline ahead of the stem
    part.ellipsoid((hull_xyz(84.6, 0, -4.7)[0], 0, -4.7), (7.4, 3.3, 2.7), shade(red, 0.9), segs=20, rings=10)
    # the propeller, hub and five blades, and the rudder, in the aperture under the counter
    prop(part, -86.8, -4.7)
    rudder(part, -88.8, -4.7)
    # bilge keels: a thin fin along the turn of the bilge either side
    for side in (1, -1):
        prev = None
        for x in [lerp(-34.0, 28.0, i / 15) for i in range(16)]:
            b, rb = half_beam(x), bilge_r(x)
            a = math.radians(48)
            p = (x, side * (b - rb + rb * math.sin(a) + 0.2), keel_z(x) + rb - rb * math.cos(a))
            if prev is not None:
                part.beam(prev, p, 0.1, 0.1, shade(red, 0.9), h0=0.6, h1=0.6, up=(0, 1, 0))
            prev = p
    plimsoll(part)
    if detail == 'high':
        hull_fittings(part)
        draught_marks(part)
        lettering(part)
        streaks(part)
    return part


def hull_fittings(part):
    """Hawse pipes, a pilot door, a freeing port row and a bow thruster grille: dark shapes laid on the plating."""
    dark = rgba('#0b0d10')
    for side in (1, -1):
        for x, z, rx, rz in ((81.0, 3.7, 0.75, 0.75), (8.0, 3.6, 1.0, 1.1)):
            n = 14
            for k in range(n):
                a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
                pts = [(x, side * (hull_y(x, z) + 0.14), z)]
                for a in (a0, a1):
                    xx, zz = x + rx * math.cos(a), z + rz * math.sin(a)
                    pts.append((xx, side * (hull_y(xx, zz) + 0.14), zz))
                part.facing(pts, dark, (0, side, 0))
        # a pilot door
        for x0, x1, z0, z1, c in ((44.0, 46.4, 2.6, 5.0, rgba('#d8d8d2')),):
            pts = [(xx, side * (hull_y(xx, zz) + 0.13), zz) for xx, zz in ((x0, z0), (x1, z0), (x1, z1), (x0, z1))]
            part.facing(pts, c, (0, side, 0))
        # the freeing ports in the bulwarks
        for x in [lerp(66.0, 84.0, i / 5) for i in range(6)]:
            zd = deck_z(x)
            pts = [(xx, side * (hull_y(xx, zd + 0.2) + 0.1), zz) for xx, zz in ((x - 0.7, zd + 0.15), (x + 0.7, zd + 0.15), (x + 0.7, zd + 0.65), (x - 0.7, zd + 0.65))]
            part.facing(pts, dark, (0, side, 0))


def prop(part, x, z):
    bronze = rgba('#9c7a3a')
    part.cyl((x - 0.9, 0, z), (x + 1.6, 0, z), 0.55, 0.28, bronze, 12)
    for k in range(5):
        a = 2 * math.pi * k / 5
        ca, sa = math.cos(a), math.sin(a)
        prof = ((0.5, 0.5, 0.0), (1.5, 0.95, 0.12), (2.4, 0.95, 0.3), (3.1, 0.35, 0.5))
        for i in range(len(prof) - 1):
            def v(r, w, tilt, s):
                return (x + s * w * 0.5 * math.cos(tilt), (r) * ca - s * w * 0.5 * math.sin(tilt) * sa, z + r * sa + s * w * 0.5 * math.sin(tilt) * ca)
            q = [v(prof[i][0], prof[i][1], prof[i][2], -1), v(prof[i][0], prof[i][1], prof[i][2], 1),
                 v(prof[i + 1][0], prof[i + 1][1], prof[i + 1][2], 1), v(prof[i + 1][0], prof[i + 1][1], prof[i + 1][2], -1)]
            part.poly(q, bronze)
            part.poly(q[::-1], bronze)


def rudder(part, x, z):
    red = rgba(HULL_RED)
    # a streamlined section: rounded leading edge, a tapering trailing edge (x is the leading edge)
    sec = [(0.0, 0.0), (0.3, 0.45), (1.2, 0.62), (2.6, 0.38), (3.8, 0.06), (3.8, -0.06), (2.6, -0.38), (1.2, -0.62), (0.3, -0.45)]
    ring = ccw([(x - s, w) for s, w in sec])
    part.prism(ring, z - 4.0, z + 3.4, red)
    part.cyl((x - 1.0, 0, z + 3.4), (x - 1.0, 0, z + 4.4), 0.5, 0.4, red, 8)


def plimsoll(part):
    white = rgba('#e8e8e4')
    for side in (1, -1):
        x, z = 6.0, 3.1
        y = side * (hull_y(x, z) + 0.15)
        n = 14
        for k in range(n):
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            r0, r1 = 0.62, 0.8
            pts = [(x + r0 * math.cos(a0), y, z + r0 * math.sin(a0)), (x + r1 * math.cos(a0), y, z + r1 * math.sin(a0)),
                   (x + r1 * math.cos(a1), y, z + r1 * math.sin(a1)), (x + r0 * math.cos(a1), y, z + r0 * math.sin(a1))]
            part.facing(pts, white, (0, side, 0))
        part.facing([(x - 1.2, y, z - 0.07), (x + 1.2, y, z - 0.07), (x + 1.2, y, z + 0.07), (x - 1.2, y, z + 0.07)], white, (0, side, 0))


FONT = {}


def text_mesh(s, size):
    """The triangles of a line of text, in its own plane (x right, y up), centred on x = 0, y = 0."""
    key = (s, size)
    if key in FONT:
        return FONT[key]
    cu = bpy.data.curves.new('t', 'FONT')
    cu.body = s
    cu.size = size
    cu.align_x = 'CENTER'
    cu.resolution_u = 2
    cu.fill_mode = 'FRONT'
    ob = bpy.data.objects.new('t', cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    tris = [[(v.co.x, v.co.y) for v in f.verts] for f in bm.faces]
    bm.free()
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    ys = [p[1] for t in tris for p in t]
    mid = (max(ys) + min(ys)) / 2 if ys else 0.0
    tris = [[(p[0], p[1] - mid) for p in t] for t in tris]
    FONT[key] = tris
    return tris


def decal_on_hull(part, s, size, cx, cz, side, colour, off=0.14):
    """Lettering laid on the hull side, following its curve. It reads toward the bow on the starboard side."""
    for tri in text_mesh(s, size):
        pts = []
        for u, v in tri:
            x = cx + (u if side < 0 else -u)
            z = cz + v
            pts.append((x, side * (hull_y(x, z) + off), z))
        part.facing(pts, colour, (0, side, 0))


def lettering(part):
    white = rgba('#ecece6')
    for side in (1, -1):
        decal_on_hull(part, 'EMAIL PILOT', 2.1, 64.5, 4.1, side, white)
    # the transom: the name and the port of registry
    for s, size, z in (('EMAIL PILOT', 1.7, 4.2), ('VALLETTA', 1.1, 2.4)):
        for tri in text_mesh(s, size):
            pts = [(X0 + shear(X0, z + v) - 0.15, -u, z + v) for u, v in tri]
            part.facing(pts, white, (-1, 0, 0))


def draught_marks(part):
    white = rgba('#f0f0ea')
    for side in (1, -1):
        for x, zs in ((84.0, range(-2, 6)), (-81.0, range(-2, 6)), (-5.0, range(-5, 6, 2))):
            for z in zs:
                if z < keel_z(x) + bilge_r(x) + 0.3:
                    continue
                decal_on_hull(part, str(z + 8), 0.46, x, z, side, white, off=0.12)


def streaks(part):
    """Rust running down from the scuppers."""
    rnd = random.Random(21)
    rust = rgba('#6b3a22')
    top = rgba(TOPSIDE)
    for side in (1, -1):
        for _ in range(46):
            x = rnd.uniform(-76.0, 80.0)
            h = rnd.uniform(1.8, 4.6)
            w = rnd.uniform(0.18, 0.5)
            z1 = deck_z(x) - 0.3
            z0 = z1 - h
            corners = [(xx, side * (hull_y(xx, zz) + 0.1), zz) for xx, zz in ((x - w, z0), (x + w, z0), (x + w * 0.6, z1), (x - w * 0.6, z1))]
            cols = [shade(top, 1.0), shade(top, 1.0), mixc(top, rust, 0.75), mixc(top, rust, 0.75)]
            part.facing(corners, cols, (0, side, 0))


# ---- the deck -----------------------------------------------------------------------------------

def hatch_z():
    return DECK + 2.1


def deck(detail):
    part = Part('deck')
    plate, cover, coam = rgba('#4a5249'), rgba('#586a5f'), rgba('#8c9298')
    guide = rgba('#c8a640')
    xs = stations()
    top = [(x + shear(x, deck_z(x)), section_y(x, deck_z(x)), deck_z(x)) for x in xs]
    # the deck as strips across the beam
    for i in range(len(top) - 1):
        a, b = top[i], top[i + 1]
        for side in (1, -1):
            p = [(a[0], 0, a[2]), (b[0], 0, b[2]), (b[0], side * b[1], b[2]), (a[0], side * a[1], a[2])]
            if side == -1:
                p = p[::-1]
            tone = 0.85 + 0.3 * vnoise(a[0] * 0.2, side * 3.0)
            part.poly(p, shade(plate, tone))
    # hatch covers on raised coamings, one per bay
    rnd = random.Random(5)
    for k in range(NBAY):
        cx = BAY0 + BAYP * (k + 0.5)
        zd = deck_z(cx)
        hw = min(11.7, half_beam(cx + 6.2) - 1.7)
        zt = hatch_z()
        # the coaming plates, and the cover on them
        for side in (1, -1):
            part.box((cx, side * (hw + 0.1), (zd + zt) / 2 - 0.15), (12.5, 0.3, zt - zd - 0.3), coam, faces='xXyYZ')
        for sx in (1, -1):
            part.box((cx + sx * 6.25, 0, (zd + zt) / 2 - 0.15), (0.3, 2 * hw, zt - zd - 0.3), coam, faces='xXyYZ')
        part.box((cx, 0, zt - 0.15), (12.2, 2 * hw, 0.3), shade(cover, 0.85 + 0.25 * rnd.random()), faces='xXyYZ')
        if detail == 'high':
            # cover panel seams and the lifting pockets
            for xo in (-3.0, 3.0):
                part.box((cx + xo, 0, zt + 0.01), (0.08, 2 * hw, 0.02), shade(cover, 0.6), faces='Z')
            for sx in (-1, 1):
                for yo in (-hw * 0.6, 0, hw * 0.6):
                    part.box((cx + sx * 5.2, yo, zt + 0.05), (0.5, 0.5, 0.1), shade(coam, 0.8), faces='XxyYZ')
    # cell guides standing at the ends of the bays
    if detail == 'high':
        for kk in range(NBAY):
            cxb = BAY0 + BAYP * (kk + 0.5)
            n = column_count(kk)
            for sx in (-1, 1):
                for j in range(n + 1):
                    y = (j - n / 2) * COLP
                    x = cxb + sx * 6.2
                    part.beam((x, y, hatch_z()), (x, y, hatch_z() + 5.4), 0.14, 0.14, guide)
    # lashing bridges at two of the bay boundaries: a cross walkway between the stacks, on posts
    for k in (3, 6):
        xg = BAY0 + BAYP * k
        zt = hatch_z() + COLP * 3.1
        part.box((xg, 0, zt), (1.5, 24.4, 0.14), shade(guide, 0.8), faces='Z')
        part.box((xg, 0, zt - 0.3), (1.5, 24.4, 0.16), shade(coam, 0.7), faces='xXyYz')
        for yy in range(-4, 5):
            part.beam((xg - 0.7, yy * 2.8, hatch_z()), (xg - 0.7, yy * 2.8, zt - 0.4), 0.12, 0.12, shade(coam, 0.8))
        if detail == 'high':
            for side in (1, -1):
                rail([(xg - 0.7, side * 12.2, zt - 0.0), (xg - 0.7, side * 0.0, zt - 0.0)], 1.1, 2.8, rgba('#e4e6e8'), part)
    return part


def column_count(k):
    cx = BAY0 + BAYP * (k + 0.5)
    hb = half_beam(cx + 6.4) * (1 + 0.1)
    return int(clamp(math.floor((2 * hb - 4.2) / COLP), 1, 9))


CRANES = [(-15.3, -1), (23.4, -1), (-15.3, 1), (23.4, 1)]   # (x, side): -1 starboard


def crane_bays():
    out = set()
    for cx, side in CRANES:
        for k in range(NBAY):
            x0, x1 = BAY0 + BAYP * k, BAY0 + BAYP * (k + 1)
            if x0 - 2.0 < cx < x1 + 2.0:
                out.add((k, side))
    return out


# ---- the cargo ----------------------------------------------------------------------------------

def pick_line(rnd):
    tot = sum(w for _, w in LINE_PALETTE)
    r = rnd.random() * tot
    for c, w in LINE_PALETTE:
        r -= w
        if r <= 0:
            return c
    return LINE_PALETTE[0][0]


def container(part, c, ln, ht, colour, rnd, detail, exposed, door_end):
    """One ISO box: the centre c, length ln (m), height ht. Sides are mapped to the corrugation map in metres."""
    x, y, z = c
    hx, hy, hz = ln / 2, 1.219, ht / 2
    p = lambda sx, sy, sz: (x + sx * hx, y + sy * hy, z + sz * hz)  # noqa: E731
    lo, hi = shade(colour, 0.78), shade(colour, 1.0)
    u1 = ln / 2.438
    # long sides (±y): u runs along the ship
    part.poly([p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1)], [lo, lo, hi, hi], [(0, 0), (u1, 0), (u1, 1), (0, 1)])
    part.poly([p(1, 1, -1), p(-1, 1, -1), p(-1, 1, 1), p(1, 1, 1)], [lo, lo, hi, hi], [(0, 0), (u1, 0), (u1, 1), (0, 1)])
    # ends (±x)
    part.poly([p(-1, 1, -1), p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1)], [lo, lo, hi, hi], [(0, 0), (1, 0), (1, 1), (0, 1)])
    part.poly([p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), p(1, -1, 1)], [lo, lo, hi, hi], [(0, 0), (1, 0), (1, 1), (0, 1)])
    # the roof, a little darker and flat on the map
    part.poly([p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)], shade(colour, 0.92), None)
    if detail != 'high':
        return
    # the door end: a seam, locking bars and a handle plate, as thin quads just proud of the face
    sx = door_end
    ex = x + sx * (hx + 0.012)
    dark, steel = shade(colour, 0.45), rgba('#9aa0a6')
    for yy in (-0.85, -0.3, 0.3, 0.85):
        part.poly(*(_end_quad(ex, y + yy, z, 0.045, hz * 0.86, sx, steel)))
    part.poly(*(_end_quad(ex, y, z, 0.02, hz * 0.9, sx, dark)))
    part.poly(*(_end_quad(ex, y - 0.16, z - 0.1, 0.09, 0.13, sx, dark)))
    # corner castings where the box is seen from outside: the four upper corners
    cast = rgba('#2b2d31')
    for ix in (-1, 1):
        for iy in (-1, 1):
            if not exposed(ix, iy):
                continue
            part.box((x + ix * (hx - 0.1), y + iy * (hy - 0.09), z + hz - 0.06), (0.2, 0.18, 0.12), cast, faces='xXyYZ')


def _end_quad(x, y, z, hw, hh, sx, colour):
    pts = [(x, y - hw, z - hh), (x, y + hw, z - hh), (x, y + hw, z + hh), (x, y - hw, z + hh)]
    if sx < 0:
        pts = pts[::-1]
    return pts, colour


def containers(detail):
    part = Part('containers')
    rnd = random.Random(7)
    skip = crane_bays()
    z0 = hatch_z()
    base = [5, 5, 5, 5, 4, 4, 4, 3, 3]
    for k in range(NBAY):
        cx = BAY0 + BAYP * (k + 0.5)
        n = column_count(k)
        for j in range(n):
            ys = (j - (n - 1) / 2) * COLP
            outer = j == 0 or j == n - 1
            side = 1 if ys > 0 else -1
            if outer and (k, side) in skip:
                continue
            tiers = base[k] + (1 if rnd.random() < 0.15 and base[k] < 5 else 0) - (1 if rnd.random() < 0.2 else 0) - (1 if outer and rnd.random() < 0.25 else 0)
            tiers = max(0, tiers)
            if rnd.random() < 0.02:
                tiers = 0
            twenty = rnd.random() < 0.2
            colour = pick_line(rnd)
            z = z0 + 0.04
            for tier in range(tiers):
                if rnd.random() < 0.6:
                    colour = pick_line(rnd)
                hc = rnd.random() < 0.14
                ht = 2.896 if hc else 2.591
                tone = 0.86 + rnd.random() * 0.34
                col = rgba(colour, tone)
                if rnd.random() < 0.16:
                    col = mixc(col, rgba('#7c6a58'), 0.45)       # sun-faded, dusty
                if rnd.random() < 0.07:
                    col = mixc(col, rgba('#6a3d28'), 0.55)       # rusty

                def exposed(ix, iy, k=k, j=j, n=n, tier=tier):
                    return (outer and iy == (1 if ys > 0 else -1)) or (k == 0 and ix < 0) or (k == NBAY - 1 and ix > 0)
                units = [(cx - 3.065, 6.058), (cx + 3.065, 6.058)] if twenty else [(cx, 12.192)]
                for ux, ln in units:
                    door = 1 if rnd.random() < 0.5 else -1
                    container(part, (ux, ys, z + ht / 2), ln, ht, col, rnd, detail, exposed, door)
                z += ht + 0.02
    return part


# ---- the accommodation, funnel, mast ------------------------------------------------------------

DECKS = [  # level: (x aft, x fwd, half width)
    (-83.0, -60.0, 11.0), (-83.0, -60.6, 10.9), (-82.6, -61.2, 10.8), (-82.3, -61.6, 10.7),
    (-82.0, -62.0, 10.6), (-81.6, -62.4, 10.5),
]
BRIDGE = (-73.2, -61.4, 10.0)
COMPASS = (-71.4, -65.6, 6.4)
WHITE = '#e3e6ea'
GREY = '#9aa2ad'
FUNNEL = '#e2a82a'


def level_z(k):
    return DECK + k * LEV


def upper(detail):
    part = Part('upper')
    white, grey = rgba(WHITE), rgba(GREY)
    dark, orange = rgba('#262c35'), rgba('#e2641b')
    # the eight levels
    for k, (xa, xf, hw) in enumerate(DECKS):
        z = level_z(k)
        part.box(((xa + xf) / 2, 0, z + LEV / 2), (xf - xa, 2 * hw, LEV), shade(white, 0.94 + 0.06 * (k % 2)), faces='xXyYZ')
        # the deck edge overhang of the roof
        part.box(((xa + xf) / 2, 0, z + LEV - 0.12), (xf - xa + 0.5, 2 * hw + 0.5, 0.24), shade(grey, 1.05), faces='xXyYZz')
    xa, xf, hw = BRIDGE
    z6 = level_z(6)
    part.box(((xa + xf) / 2, 0, z6 + LEV / 2), (xf - xa, 2 * hw, LEV), white, faces='xXyYZ')
    part.box(((xa + xf) / 2, 0, z6 + LEV - 0.12), (xf - xa + 0.6, 2 * hw + 0.6, 0.26), shade(grey, 1.1), faces='xXyYZz')
    # bridge wings and their rails
    for side in (1, -1):
        part.box(((xf - 3.6), side * (hw + 2.0), z6 + 0.55), (7.2, 4.0, 1.1), white, faces='xXyYzZ')
        part.box(((xf - 3.6), side * (hw + 2.0), z6 + 1.2), (7.4, 4.2, 0.12), shade(grey, 0.9), faces='Zz')
        if detail == 'high':
            rail([(xf - 7.2, side * (hw + 4.0), z6 + 1.2), (xf, side * (hw + 4.0), z6 + 1.2), (xf, side * hw, z6 + 1.2)], 1.0, 1.4, white, part)
    # the compass deck
    xa, xf, hw = COMPASS
    zc = level_z(7)
    part.box(((xa + xf) / 2, 0, zc + 1.2), (xf - xa, 2 * hw, 2.4), shade(white, 0.96), faces='xXyYZ')
    part.box(((xa + xf) / 2, 0, zc + 2.4), (xf - xa + 0.5, 2 * hw + 0.5, 0.2), shade(grey, 1.1), faces='xXyYZz')
    # the funnel: a rounded section raked aft, yellow with a white band and a black top, a roundel each side
    zf0, zf1 = level_z(6) - 0.6, level_z(7) + 8.2

    def fz(z):
        t = (z - zf0) / (zf1 - zf0)
        return (-77.9 - 2.4 * t, 4.6 - 0.9 * t, 3.2 - 0.6 * t)       # centre x, half length, half width

    def tube(za, zb, colour, cap=False, k=1.0):
        rings = []
        for z in (za, zb):
            cx, a_, b_ = fz(z)
            rings.append([(cx + math.cos(2 * math.pi * i / 28) * a_ * k, math.sin(2 * math.pi * i / 28) * b_ * k, z) for i in range(28)])
        for i in range(28):
            j = (i + 1) % 28
            part.poly([rings[0][i], rings[0][j], rings[1][j], rings[1][i]], colour, smooth_shade=True)
        if cap:
            part.poly(rings[1], colour)

    tube(zf0, zf1 - 4.6, rgba(FUNNEL))
    tube(zf1 - 4.6, zf1 - 3.5, rgba('#eceae4'), k=1.01)
    tube(zf1 - 3.5, zf1, rgba('#17191d'), cap=True, k=1.0)
    for side in (1, -1):
        part.cyl((-81.4, side * 2.6, zf1 - 3.5), (-81.4, side * 2.6, zf1 + 1.3), 0.45, 0.4, shade(grey, 0.8), 10)
    part.cyl((-77.5, 0, zf1 - 3.2), (-77.5, 0, zf1 + 1.0), 0.35, 0.3, shade(grey, 0.8), 8)
    # the company roundel on both flanks: a paper plane on a white disc
    for side in (1, -1):
        cz = zf1 - 8.4
        cx, _, bw = fz(cz)
        ycen = side * (bw + 0.06)
        disc, plane = rgba('#f3f1ea'), rgba('#0f4c81')
        n = 18
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            part.facing([(cx, ycen, cz), (cx + 2.1 * math.cos(a0), ycen, cz + 2.1 * math.sin(a0)), (cx + 2.1 * math.cos(a1), ycen, cz + 2.1 * math.sin(a1))], disc, (0, side, 0))
        yy = ycen + side * 0.05
        part.facing([(cx - 1.4, yy, cz - 0.7), (cx + 1.5, yy, cz + 0.1), (cx - 0.5, yy, cz + 1.1)], plane, (0, side, 0))
        part.facing([(cx - 1.4, yy, cz - 0.7), (cx - 0.5, yy, cz + 1.1), (cx - 0.5, yy, cz - 0.2)], shade(plane, 1.6), (0, side, 0))
    # the mast: a tubular pole with a platform, two yards, a light and the aerials
    mx = -68.5
    zm0 = zc + 2.5
    part.cyl((mx, 0, zm0), (mx, 0, zm0 + 4.2), 0.42, 0.34, grey, 12)
    part.cyl((mx, 0, zm0 + 4.2), (mx, 0, zm0 + 10.0), 0.3, 0.12, grey, 8)
    part.cyl((mx, -3.4, zm0 + 6.6), (mx, 3.4, zm0 + 6.6), 0.1, 0.1, grey, 6)
    part.cyl((mx, -2.2, zm0 + 8.4), (mx, 2.2, zm0 + 8.4), 0.08, 0.08, grey, 6)
    part.cyl((mx, 0, zm0 + 4.2), (mx, 0, zm0 + 4.3), 1.3, 1.3, shade(grey, 0.9), 12)
    for side in (1, -1):
        part.cyl((mx + 0.5, side * 1.1, zm0 + 4.3), (mx + 0.5, side * 1.1, zm0 + 5.3), 0.04, 0.04, grey, 4, caps=False)
        part.cyl((mx - 1.2, side * 2.6, zc + 2.4), (mx - 1.2, side * 2.6, zc + 6.2), 0.07, 0.04, grey, 5, caps=False)
    # scanner pedestals (the bars turn: Empties) and GPS and satcom domes
    for side in (1, -1):
        part.cyl((mx + 0.8, side * 3.4, zc + 2.4), (mx + 0.8, side * 3.4, zc + 4.1), 0.34, 0.34, grey, 8)
    part.ellipsoid((mx - 3.3, 3.8, zc + 3.5), (1.3, 1.3, 1.3), white, 14, 8)
    part.ellipsoid((mx - 3.3, -3.8, zc + 3.4), (0.9, 0.9, 0.9), white, 12, 6)
    part.ellipsoid((mx + 2.0, 0, zm0 + 0.6), (0.7, 0.7, 0.7), white, 10, 6)
    # lifeboats on davits, one a side, a rescue boat and life rafts
    zb = level_z(2) - 0.1
    for side in (1, -1):
        part.box((-70.0, side * 12.6, zb - 0.1), (11.0, 3.6, 0.2), shade(grey, 0.8), faces='xXyYZz')
        part.ellipsoid((-70.0, side * 12.4, zb + 1.7), (4.4, 1.35, 1.2), orange, 18, 8)
        part.box((-70.0, side * 12.4, zb + 2.55), (4.0, 0.9, 0.3), shade(orange, 0.9), faces='xXyYZ')
        for gx in (-72.0, -68.0):
            part.cyl((gx, side * 11.4, zb), (gx, side * 11.4, zb + 4.6), 0.14, 0.14, dark, 6)
            part.cyl((gx, side * 11.4, zb + 4.6), (gx, side * 13.6, zb + 4.0), 0.13, 0.13, dark, 6)
            part.cyl((gx, side * 13.6, zb + 4.0), (gx, side * 12.4, zb + 2.8), 0.04, 0.04, dark, 4, caps=False)
        for rx in (-77.0, -76.0):
            part.cyl((rx, side * 12.4, zb + 0.5), (rx + 0.0, side * 12.4, zb + 0.5 + 1.4), 0.55, 0.55, shade(rgba('#d8d6ce'), 0.9), 10)
        part.ellipsoid((-77.5, side * 12.5, zb + 1.2), (2.0, 0.9, 0.7), shade(orange, 0.95), 12, 6)
    # deck gear aft: the mooring deck behind the block, bollards, winches, a flagstaff
    zm = deck_z(-87.0)
    for side in (1, -1):
        part.cyl((-87.0, side * 5.0, zm), (-87.0, side * 5.0, zm + 1.0), 0.4, 0.4, dark, 8)
        part.cyl((-87.0, side * 5.0, zm + 1.0), (-87.0, side * 5.0, zm + 1.2), 0.55, 0.55, dark, 8)
        part.box((-85.0, side * 8.0, zm + 0.7), (2.4, 1.6, 1.4), shade(dark, 1.4), faces='xXyYZ')
        part.cyl((-85.0, side * 7.1, zm + 1.1), (-85.0, side * 8.9, zm + 1.1), 0.55, 0.55, shade(grey, 0.7), 8)
    part.cyl((-89.2, 0, zm), (-89.2, 0, zm + 9.0), 0.14, 0.09, white, 6)
    part.poly([(-89.2, 0.05, zm + 8.8), (-89.2, 0.05, zm + 7.6), (-89.2 - 2.6, 0.05, zm + 7.8), (-89.2 - 2.6, 0.05, zm + 8.6)], rgba('#c9302c'))
    part.poly([(-89.2, -0.05, zm + 8.8), (-89.2 - 2.6, -0.05, zm + 8.6), (-89.2 - 2.6, -0.05, zm + 7.8), (-89.2, -0.05, zm + 7.6)], rgba('#c9302c'))
    # the forecastle: bulwark, windlass, winches, bollards, fairleads, foremast, jackstaff, hawse pipes
    forecastle(part)
    if detail == 'high':
        # rails round the bridge deck's roof, the compass deck's and the open roof round the funnel
        xa, xf, hw = BRIDGE
        rail([(xf + 0.1, hw, level_z(7)), (xf + 0.1, -hw, level_z(7)), (xa, -hw, level_z(7)), (xa, hw, level_z(7)), (xf + 0.1, hw, level_z(7))], 1.05, 2.0, white, part)
        xa, xf, hw = COMPASS
        rail([(xf + 0.1, hw, level_z(7) + 2.5), (xf + 0.1, -hw, level_z(7) + 2.5), (xa, -hw, level_z(7) + 2.5), (xa, hw, level_z(7) + 2.5), (xf + 0.1, hw, level_z(7) + 2.5)], 1.05, 2.0, white, part)
        xa, xf, hw = DECKS[5]
        rail([(-73.4, hw - 0.3, level_z(6)), (xa + 0.2, hw - 0.3, level_z(6)), (xa + 0.2, -hw + 0.3, level_z(6)), (-73.4, -hw + 0.3, level_z(6))], 1.05, 2.0, white, part)
        # the accommodation ladder: an inclined stair down the starboard side, with its landing and rails
        gx0, gx1 = -52.0, -30.0
        z_top, z_bot = DECK + 0.1, 1.6
        yg = -(half_beam(-40.0) + 1.4)
        n = 44
        for side in (-0.55, 0.55):
            part.beam((gx0, yg + side, z_top), (gx1, yg + side, z_bot), 0.12, 0.12, shade(grey, 0.9))
            part.beam((gx0, yg + side, z_top + 1.0), (gx1, yg + side, z_bot + 1.0), 0.05, 0.05, white)
        for i in range(1, n):
            f = i / n
            part.box((lerp(gx0, gx1, f), yg, lerp(z_top, z_bot, f) + 0.05), (0.22, 1.0, 0.05), shade(grey, 0.75), faces='xXyYZ')
        part.box((gx1 - 0.5, yg, z_bot - 0.1), (1.4, 1.4, 0.12), shade(grey, 0.8), faces='xXyYZz')
        part.box((gx0 - 0.5, yg + 0.3, z_top + 0.0), (1.6, 2.2, 0.12), shade(grey, 0.8), faces='xXyYZz')
    # the cranes
    for cx, side in CRANES:
        crane(part, cx, side, detail)
    # vents and deck pipes alongside the hatches
    rnd = random.Random(3)
    for side in (1, -1):
        for k in range(NBAY * 2):
            x = BAY0 + 3.0 + k * BAYP / 2
            y = side * (half_beam(x) - 0.9)
            z = deck_z(x)
            if rnd.random() < 0.6:
                part.cyl((x, y, z), (x, y, z + 1.1), 0.15, 0.15, grey, 6, caps=False)
                part.cyl((x, y, z + 1.1), (x + 0.4, y + side * 0.3, z + 1.3), 0.15, 0.2, grey, 6)
            else:
                part.cyl((x, y, z), (x, y, z + 0.8), 0.28, 0.24, shade(orange, 0.9), 8)
    if detail == 'high':
        # rails along the weather deck, either side, from the block to the bow
        for side in (1, -1):
            line = []
            for i in range(0, 56):
                x = lerp(-60.0, 64.0, i / 55)
                line.append((x + shear(x, deck_z(x)) * 0.0, side * (half_beam(x) * 1.0 - 0.1), deck_z(x)))
            rail(line, 1.05, 2.5, white, part)
        # ladders on the block's aft face and up to the bridge
        for k in range(0, 6):
            xa = DECKS[k][0]
            ladder(part, (xa - 0.05, 3.0 * (1 if k % 2 else -1), level_z(k)), (xa - 0.05, 3.0 * (1 if k % 2 else -1), level_z(k + 1)), 0.6, shade(grey, 0.9))
        ladder(part, (-62.0, -9.0, deck_z(-62.0)), (-62.0, -9.0, level_z(1)), 0.7, shade(grey, 0.9))
        ladder(part, (-61.0, 8.0, level_z(1)), (-61.0, 8.0, level_z(2)), 0.7, shade(grey, 0.9))
        # a Jacob's ladder gantry at midships
        part.beam((0.0, -13.0, DECK + 0.1), (0.0, -13.0, DECK + 1.5), 0.2, 0.2, white)
    return part


def rail(pts, h, every, colour, part):
    """Stanchions every `every` m and two rails along a polyline."""
    acc = 0.0
    prev = None
    for p in pts:
        if prev is not None:
            d = (Vector(p) - Vector(prev)).length
            acc += d
            part.cyl((prev[0], prev[1], prev[2] + h * 0.5), (p[0], p[1], p[2] + h * 0.5), 0.035, 0.035, colour, 4, caps=False)
            part.cyl((prev[0], prev[1], prev[2] + h), (p[0], p[1], p[2] + h), 0.04, 0.04, colour, 4, caps=False)
        if prev is None or acc >= every:
            part.cyl((p[0], p[1], p[2]), (p[0], p[1], p[2] + h), 0.045, 0.045, colour, 4, caps=False)
            acc = 0.0
        prev = p


def ladder(part, p0, p1, w, colour):
    p0, p1 = Vector(p0), Vector(p1)
    n = max(2, int((p1 - p0).length / 0.3))
    for s in (-w / 2, w / 2):
        part.beam(p0 + Vector((0, s, 0)), p1 + Vector((0, s, 0)), 0.05, 0.05, colour)
    for i in range(1, n):
        p = p0.lerp(p1, i / n)
        part.beam(p + Vector((0, -w / 2, 0)), p + Vector((0, w / 2, 0)), 0.04, 0.04, colour)


def forecastle(part):
    white, grey = rgba(WHITE), rgba(GREY)
    dark = rgba('#262c35')
    plate = shade(rgba(TOPSIDE), 1.15)
    # bulwark: a plate standing 1.35 m on the deck edge from the last bay to the stem, and round the stern
    xs_all = stations()
    for lo, hi in ((60.0, XS), (X0, -74.0)):
        sel = [x for x in xs_all if lo <= x <= hi]
        for side in (1, -1):
            for xa, xb in zip(sel[:-1], sel[1:]):
                za, zb_ = deck_z(xa), deck_z(xb)
                ya, yb = section_y(xa, za), section_y(xb, zb_)
                a0 = (xa + shear(xa, za), side * ya, za)
                b0 = (xb + shear(xb, zb_), side * yb, zb_)
                a1 = (a0[0], a0[1], za + 1.35)
                b1 = (b0[0], b0[1], zb_ + 1.35)
                ia = (a0[0], side * (ya - 0.18), za + 1.35)
                ib = (b0[0], side * (yb - 0.18), zb_ + 1.35)
                ja = (a0[0], side * (ya - 0.18), za)
                jb = (b0[0], side * (yb - 0.18), zb_)
                part.facing([a0, b0, b1, a1], plate, (0, side, 0))
                part.facing([a1, b1, ib, ia], plate, (0, 0, 1))
                part.facing([ia, ib, jb, ja], shade(plate, 0.8), (0, -side, 0))
    # anchors sit in the hawse pipes
    for side in (1, -1):
        x, z = 80.5, 3.6
        y = side * (hull_y(x, z) + 0.1)
        part.cyl((x, y, z), (x + 0.2, y + side * 0.7, z - 0.3), 0.7, 0.7, dark, 10)
        part.box((x + 0.4, y + side * 0.55, z - 1.8), (0.9, 1.0, 2.6), shade(grey, 0.5), faces='xXyYZz')
    # windlass and winches
    part.box((78.0, 0, DECK + 2.5 * 0.0 + 1.2 + 0.2), (5.0, 6.8, 1.0), shade(grey, 0.55), faces='xXyYZ')
    for side in (1, -1):
        part.cyl((78.0, side * 1.7, DECK + 2.4), (78.0, side * 1.7, DECK + 2.9), 0.9, 0.9, shade(rgba('#9aa2ad'), 0.6), 10)
        part.cyl((75.0, side * 2.6, DECK + 1.2), (75.0, side * 4.6, DECK + 1.2), 0.65, 0.65, rgba('#b44a1c'), 10)
        part.cyl((72.0, side * 2.6, DECK + 1.0), (72.0, side * 4.4, DECK + 1.0), 0.6, 0.6, rgba('#b44a1c'), 10)
    # bollards and fairleads
    for side in (1, -1):
        for x in (68.0, 71.5, 75.0, 82.0, 85.0):
            y = side * (hull_y(x, deck_z(x)) - 0.9)
            z = deck_z(x)
            for dy in (-0.5, 0.5):
                part.cyl((x, y + dy, z), (x, y + dy, z + 0.9), 0.3, 0.33, dark, 8)
            part.box((x, y, z + 0.9), (0.8, 1.6, 0.15), dark, faces='xXyYZ')
        for x in (-86.0, -82.0):
            y = side * (hull_y(x, deck_z(x)) - 0.9)
            z = deck_z(x)
            for dy in (-0.5, 0.5):
                part.cyl((x, y + dy, z), (x, y + dy, z + 0.9), 0.3, 0.33, dark, 8)
    # the foremast, with a platform
    part.cyl((74.0, 0, DECK + 0.4), (74.0, 0, DECK + 13.0), 0.45, 0.22, white, 10)
    part.cyl((74.0, 0, DECK + 8.0), (74.0, 0, DECK + 8.2), 1.2, 1.2, shade(grey, 0.9), 12)
    part.box((74.0, 0, DECK + 14.0 - 0.3), (0.9, 0.9, 0.5), shade(grey, 0.5))
    part.cyl((74.0, -1.8, DECK + 10.0), (74.0, 1.8, DECK + 10.0), 0.07, 0.07, grey, 5)
    # jackstaff at the stem
    xj = 91.0
    part.cyl((xj, 0, deck_z(88.0) + 1.0), (xj, 0, deck_z(88.0) + 4.4), 0.1, 0.07, white, 6)
    # a small provision crane
    crane_small(part, 66.0, 6.0)


def crane_small(part, x, y):
    grey, orange = rgba(GREY), rgba('#d9a52a')
    z = deck_z(x)
    part.cyl((x, y, z), (x, y, z + 3.0), 0.4, 0.4, grey, 8)
    part.box((x, y, z + 3.4), (1.2, 0.9, 0.9), orange, faces='xXyYZ')
    part.beam((x, y, z + 3.6), (x + 3.6, y, z + 8.2), 0.34, 0.2, orange)
    part.cyl((x + 3.6, y, z + 8.2), (x + 3.6, y, z + 4.0), 0.03, 0.03, rgba('#101214'), 4, caps=False)
    part.box((x + 3.6, y, z + 3.8), (0.3, 0.2, 0.4), rgba('#101214'))


def crane(part, cx, side, detail):
    """A 45 t deck crane on a pedestal outboard of the coamings, jib raised."""
    white, grey = rgba('#d9dde0'), rgba(GREY)
    yellow, dark = rgba('#d8a824'), rgba('#17191d')
    y = side * 11.8
    z = deck_z(cx)
    part.cyl((cx, y, z), (cx, y, z + 3.4), 1.6, 1.5, shade(yellow, 0.8), 14)
    # the house: a machinery housing and a cab with its window forward
    part.box((cx - 0.6, y, z + 5.0), (4.0, 3.2, 3.2), yellow, faces='xXyYZ')
    part.box((cx + 1.6, y + side * 0.6, z + 5.6), (1.6, 1.4, 2.0), white, faces='xXyYZ')
    part.box((cx + 1.6, y + side * 0.6 - 0.0, z + 5.9), (1.62, 1.1, 0.8), dark, faces='X')
    part.box((cx - 0.6, y, z + 6.65), (4.2, 3.4, 0.2), shade(grey, 0.7), faces='xXyYZ')
    # the jib: a tapered box section, luffed 50 degrees, pointing outboard fore or aft by crane
    face = -side
    ang = math.radians(52)
    L = 26.0
    p0 = Vector((cx + face * 1.2, y, z + 6.2))
    p1 = p0 + Vector((face * math.cos(ang) * L, 0, math.sin(ang) * L))
    part.beam(p0, p1, 1.6, 0.8, yellow, h0=1.6, h1=0.8)
    part.beam(p0 + Vector((face * 0.9, 0, 0.4)), p0 + Vector((face * math.cos(ang) * 12, 0, math.sin(ang) * 12 + 0.8)), 0.7, 0.7, shade(yellow, 0.8))
    # the luffing ram
    part.cyl((cx - face * 1.4, y, z + 6.4), p0 + Vector((face * math.cos(ang) * 7.5, 0, math.sin(ang) * 7.5)), 0.17, 0.2, shade(grey, 0.6), 6)
    # hoist wires and the hook block
    if detail == 'high':
        hook = p1 + Vector((0, 0, -13.0))
        for s in (-0.25, 0.25):
            part.cyl(p1 + Vector((0, s, 0)), hook + Vector((0, s, 0.6)), 0.04, 0.04, dark, 4, caps=False)
        part.box(hook, (0.9, 0.7, 1.2), dark, faces='xXyYZz')
    # the sheave housing at the head
    part.box(p1, (0.9, 1.0, 0.9), shade(yellow, 0.85), faces='xXyYZz')


def lit(detail):
    """Windows and lamp fixtures: emissive, a hair proud of the faces."""
    part = Part('lit')
    rnd = random.Random(11)
    warm = [rgba('#ffd9a0'), rgba('#ffcf8a'), rgba('#f7e6b8'), rgba('#ffc47a')]
    off = rgba('#0d131c')
    # the six levels of block: front (+x), both sides and the aft face
    for k, (xa, xf, hw) in enumerate(DECKS):
        zc = level_z(k) + 1.95
        # front
        pitch = 2.7
        n = int((2 * hw - 2.0) / pitch)
        for i in range(n):
            y = -(n - 1) * pitch / 2 + i * pitch
            on = rnd.random() < 0.7
            window(part, (xf + 0.012, y, zc), 'X', 1.5, 1.15, rnd.choice(warm) if on else off)
        for side in (1, -1):
            m = int((xf - xa - 2.0) / pitch)
            for i in range(m):
                x = xa + 1.5 + i * pitch
                on = rnd.random() < 0.7
                window(part, (x, side * (hw + 0.012), zc), 'Y' if side > 0 else 'y', 1.5, 1.15, rnd.choice(warm) if on else off)
        for i in range(max(1, int((2 * hw - 3.0) / (pitch * 1.5)))):
            y = -hw + 2.0 + i * pitch * 1.5
            window(part, (xa - 0.012, y, zc), 'x', 1.2, 1.0, rnd.choice(warm) if rnd.random() < 0.55 else off)
    # the bridge: a continuous window band across the front and round the wings, dim with consoles lit
    xa, xf, hw = BRIDGE
    zb = level_z(6) + 1.95
    glass = rgba('#46391f')
    n = 17
    for i in range(n):
        y = -hw + 0.7 + i * (2 * hw - 1.4) / (n - 1)
        window(part, (xf + 0.015, y, zb), 'X', 1.15, 1.7, glass if rnd.random() < 0.75 else rgba('#b88a48'))
    for side in (1, -1):
        for i in range(5):
            x = xa + 1.4 + i * (xf - xa - 2.4) / 4
            window(part, (x, side * (hw + 0.015), zb), 'Y' if side > 0 else 'y', 1.5, 1.7, glass)
        # the wing doors and front glass
        for i in range(4):
            window(part, (xf - 1.0 - i * 1.6, side * (hw + 4.0 + 0.012), level_z(6) + 2.3), 'Y' if side > 0 else 'y', 1.3, 1.4, glass)
    # the compass deck's glazed top
    xa, xf, hw = COMPASS
    for i in range(7):
        y = -hw + 0.9 + i * (2 * hw - 1.8) / 6
        window(part, (xf + 0.012, y, level_z(7) + 1.2), 'X', 1.2, 1.2, glass)
    # a navigation light fixture on each wing and the mast
    for pos, col in (((-65.5, 14.7, level_z(6) + 1.6), rgba('#ff3b30')), ((-65.5, -14.7, level_z(6) + 1.6), rgba('#30ff80'))):
        part.box(pos, (0.5, 0.35, 0.45), col)
    # floodlight fixtures on the block's front and the cranes
    for x, y, z in ((-60.8, 5.5, level_z(3) + 0.1), (-60.8, -5.5, level_z(3) + 0.1), (-61.7, 0.0, level_z(4) + 3.3)):
        part.box((x, y, z), (0.35, 0.8, 0.4), rgba('#fff4d8'))
    return part


def window(part, c, face, w, h, colour, frame=True):
    x, y, z = c
    if frame:
        # a dark surround just behind the pane
        fx, fy = x, y
        if face in ('X', 'x'):
            fx = x - 0.006 if face == 'X' else x + 0.006
        else:
            fy = y - 0.006 if face == 'Y' else y + 0.006
        window(part, (fx, fy, z), face, w + 0.35, h + 0.3, rgba('#161c24'), False)
    hw, hh = w / 2, h / 2
    if face in ('X', 'x'):
        pts = [(x, y - hw, z - hh), (x, y + hw, z - hh), (x, y + hw, z + hh), (x, y - hw, z + hh)]
        if face == 'x':
            pts = pts[::-1]
    else:
        pts = [(x - hw, y, z - hh), (x + hw, y, z - hh), (x + hw, y, z + hh), (x - hw, y, z + hh)]
        if face == 'Y':
            pts = pts[::-1]
    part.poly(pts, colour)


def empties(collection):
    """Navigation lights, floodlights and the scanners' pivots."""
    z6 = level_z(6)
    zc = level_z(7)
    marks = {
        'nav_red': (-65.5, 14.8, z6 + 2.2),
        'nav_green': (-65.5, -14.8, z6 + 2.2),
        'nav_mast': (-68.5, 0, zc + 2.5 + 10.3),
        'nav_bow': (74.0, 0, DECK + 14.2),
        'nav_stern': (-89.0, 0, deck_z(-88.0) + 1.2),
        'radar': (-67.7, 3.4, zc + 4.2),
        'radar2': (-67.7, -3.4, zc + 4.2),
        'flood_0': (-60.8, 5.5, level_z(3) + 0.5),
        'flood_1': (-60.8, -5.5, level_z(3) + 0.5),
        'flood_2': (-61.7, 0.0, level_z(4) + 3.7),
        'flood_3': (-15.3, -11.8, deck_z(-15.3) + 9.0),
        'flood_4': (23.4, 11.8, deck_z(23.4) + 9.0),
        'flood_5': (74.0, 0, DECK + 10.5),
        'flood_6': (45.0, 0, hatch_z() + 11.0),
    }
    for name, p in marks.items():
        e = bpy.data.objects.new(name, None)
        e.location = p
        collection.objects.link(e)
    return marks


def build(collection, detail='high'):
    out = {}
    for fn in (hull, deck, containers, upper, lit):
        part = fn(detail)
        obj = part.finish(collection)
        out[part.name] = obj
    empties(collection)
    return out
