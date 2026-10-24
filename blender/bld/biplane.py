"""The vintage banner-tow biplane of the storm chapter: a two-seat, Stearman-style trainer.

Modelled in metres with the nose toward +X, Z up, the port (left) wing toward +Y and the thrust
line at z = 0: span 9.8 m, 8.7 m from spinner to rudder. `build` returns the parts; the exporter
(blender/make_biplane.py) scales them by SCALE to the site's units.

    fuselage   lofted cross-sections (flat sides with rounded chines, an elliptical turtle deck),
               metal forward panels with panel lines and louvres, doped fabric aft, a cream
               cheat line, two cockpits with padded coamings and windscreens, a pilot in a
               leather helmet, goggles and a scarf in the rear one, racing-number roundels
    engine     a nine-cylinder radial: finned barrels and heads, rocker boxes, pushrods, ignition
               harness, a nose case, exhaust stubs into a collector ring with a tail pipe, all
               inside a polished Townend ring
    prop       a two-blade laminated wooden propeller with real twist and taper and brass tips,
               and a separate hub plate and spinner; both are built around PROP_HUB so the site
               can spin them
    wings      NACA 2412 sections with the fabric sagging between the ribs, ailerons in their own
               cut-outs, a trailing-edge cut-out over the front cockpit, rounded tips, crimson tip
               bands, a walkway, racing numbers under the lower wing, streamlined cabane and
               interplane struts, doubled flying wires and landing wires
    tail       stabiliser, split elevators, fin and a striped rudder, bracing wires, a tail skid
    gear       V-strut legs, a streamlined spreader bar and axle, spoked wire wheels with tyres

One mesh per material, coloured with vertex colours: `fabric` (UVs scaled so one texture tile
is one rib bay, see make_biplane.py's normal map), `paint`, `metal`, `leather`, `glass`, `lamp`
(unlit: navigation lights and the exhaust's glow), `prop` and `spinner`. Empties mark the
navigation lights, the exhaust outlet, the prop hub and the tow hook.
"""
import math

import bmesh
import bpy
from mathutils import Vector

SCALE = 2.3 / 9.8            # span 9.8 m -> the site's 2.3
PROP_HUB = Vector((3.74, 0.0, 0.0))
BAY = 0.33                   # rib spacing; one tile of the fabric normal map


def rgba(h, v=1.0):
    """sRGB hex to a linear vertex colour."""
    h = h.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        c = c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
        out.append(min(c * v, 1.0))
    return (out[0], out[1], out[2], 1.0)


CRIMSON = rgba('#a11d24')
CRIMSON_DK = rgba('#5e0f14')
CREAM = rgba('#f0e5c6')
INK = rgba('#121318')
WALK = rgba('#2a2b2f')
ALU = rgba('#c9cdd2')
STEEL = rgba('#8d9299')
GUNMETAL = rgba('#3d4047')
BRASS = rgba('#c9a14a')
HOT = rgba('#6b4a3a')
LEATHER = rgba('#5b3520')
LEATHER_DK = rgba('#33200f')
SKIN = rgba('#c48c69')
SCARF = rgba('#f4f1ea')
TYRE = rgba('#1b1b1d')
WOOD = rgba('#8c4a22')
WOOD_DK = rgba('#6a3416')
GLASS = rgba('#b9d2e0')
RED_LAMP = (1.0, 0.06, 0.04, 1.0)
GREEN_LAMP = (0.1, 1.0, 0.3, 1.0)
WHITE_LAMP = (1.0, 0.95, 0.85, 1.0)
EXHAUST_LAMP = (1.0, 0.42, 0.08, 1.0)


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def basis(axis, hint=None):
    """Two unit vectors perpendicular to `axis` (and to each other); the first leans toward `hint`."""
    z = axis.normalized()
    if hint is None:
        hint = Vector((0, 0, 1)) if abs(z.z) < 0.9 else Vector((1, 0, 0))
    x = hint - z * hint.dot(z)
    if x.length < 1e-6:
        x = Vector((1, 0, 0)) - z * z.x
    x.normalize()
    return x, z.cross(x), z


class Part:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.col = self.bm.loops.layers.color.new('Col')

    def _face(self, verts, colour, uvs=None):
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return None
        for i, loop in enumerate(f.loops):
            loop[self.col] = colour
            loop[self.uv].uv = uvs[i] if uvs else (0.0, 0.0)
        return f

    def poly(self, pts, colour, outward=None, uvs=None):
        pts = [Vector(p) for p in pts]
        if outward is not None and newell(pts).dot(Vector(outward)) < 0:
            pts.reverse()
            uvs = uvs[::-1] if uvs else None
        return self._face([self.bm.verts.new(p) for p in pts], colour, uvs)

    def grid(self, rows, colour, uvs=None, wrap=True, caps=(False, False), cap_colour=None,
             loop_rows=False, outward=None):
        """Quads between consecutive rings (`rows`, each a list of points of the same length).

        `wrap` closes each ring, `loop_rows` joins the last ring back to the first. The whole sheet
        is turned to face away from the rings' centroids (or toward `outward` for an open sheet).
        `colour` is an rgba or fn(i, j) of the quad between rings i, i+1 and points j, j+1. A cap is
        True (a fan from the ring's centroid) or the point to fan from.
        """
        rows = [[Vector(p) for p in r] for r in rows]
        n, m = len(rows[0]), len(rows)
        jn = n if wrap else n - 1
        im = m if loop_rows else m - 1
        quads = []
        for i in range(im):
            i1 = (i + 1) % m
            for j in range(jn):
                j1 = (j + 1) % n
                quads.append((i, j, [(i, j), (i, j1), (i1, j1), (i1, j)]))
        cents = [sum(r, Vector()) / n for r in rows]
        score = 0.0
        for i, j, idx in quads:
            pts = [rows[a][b] for a, b in idx]
            if outward is not None:
                ref = Vector(outward)
            else:
                ref = sum(pts, Vector()) / 4 - (cents[idx[0][0]] + cents[idx[2][0]]) / 2
            score += newell(pts).dot(ref)
        flip = score < 0
        verts = [[self.bm.verts.new(p) for p in r] for r in rows]
        for i, j, idx in quads:
            if flip:
                idx = idx[::-1]
            col = colour(i, j) if callable(colour) else colour
            uv = [uvs[a][b] for a, b in idx] if uvs else None
            self._face([verts[a][b] for a, b in idx], col, uv)
        for ci, k in ((0, 0), (1, m - 1)):
            cap = caps[ci]
            if cap is False or cap is None:
                continue
            centre = cents[k] if cap is True else Vector(cap)
            away = centre - cents[k]
            if away.length < 1e-7:
                if m > 1:
                    away = cents[k] - cents[1 if k == 0 else m - 2]
                else:
                    other = caps[1 - ci]
                    away = cents[k] - (Vector(other) if not isinstance(other, bool) else cents[k] + Vector((1, 0, 0)))
            c = self.bm.verts.new(centre)
            cc = cap_colour or (colour(min(k, m - 2), 0) if callable(colour) else colour)
            for j in range(jn):
                tri = [c, verts[k][j], verts[k][(j + 1) % n]]
                if newell([v.co for v in tri]).dot(away) < 0:
                    tri.reverse()
                self._face(tri, cc)
        return verts

    def finish(self, collection):
        if not self.bm.faces:
            self.bm.free()
            return None
        bmesh.ops.scale(self.bm, vec=(SCALE, SCALE, SCALE), verts=self.bm.verts)
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        return obj


# ---- generic solids -----------------------------------------------------------------------------

def lathe(part, origin, axis, profile, colour, segs=12, phase=0.0, hint=None):
    """Surface of revolution: `profile` is [(radius, distance along axis)]; zero radii at the ends
    become pointed caps."""
    o, (bx, by, bz) = Vector(origin), basis(Vector(axis), hint)
    prof = list(profile)
    cap0 = cap1 = False
    if prof[0][0] <= 1e-6:
        cap0 = o + bz * prof[0][1]
        prof = prof[1:]
    if prof[-1][0] <= 1e-6:
        cap1 = o + bz * prof[-1][1]
        prof = prof[:-1]
    angles = [phase + 2 * math.pi * k / segs for k in range(segs)]
    rows = [[o + bz * h + (bx * math.cos(a) + by * math.sin(a)) * r for a in angles] for r, h in prof]
    part.grid(rows, colour, caps=(cap0, cap1))


def tube(part, p0, p1, r, colour, segs=6, r1=None, caps=True):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    r1 = r if r1 is None else r1
    prof = [(r, 0.0), (r1, d.length)]
    if caps:
        prof = [(0.0, 0.0)] + prof + [(0.0, d.length)]
    lathe(part, p0, d, prof, colour, segs)


def sweep(part, path, section, colour, closed=False, caps=True, up=None, uvs=None):
    """A section swept along a polyline with a transported frame. `section` is a radius (a circle
    of 8) or [(a, b)] offsets along the frame's (normal, binormal)."""
    path = [Vector(p) for p in path]
    n = len(path)
    if not isinstance(section, (list, tuple)):
        r = section
        section = [(r * math.cos(2 * math.pi * k / 8), r * math.sin(2 * math.pi * k / 8)) for k in range(8)]
    tans = []
    for i in range(n):
        if closed:
            t = path[(i + 1) % n] - path[i - 1]
        else:
            t = path[min(i + 1, n - 1)] - path[max(i - 1, 0)]
        tans.append(t.normalized())
    nx, _, _ = basis(tans[0], Vector(up) if up is not None else None)
    rows = []
    for i in range(n):
        t = tans[i]
        nx = (nx - t * nx.dot(t))
        if nx.length < 1e-6:
            nx, _, _ = basis(t)
        nx.normalize()
        bx = t.cross(nx)
        rows.append([path[i] + nx * a + bx * b for a, b in section])
    part.grid(rows, colour, uvs=uvs, loop_rows=closed,
              caps=(False, False) if closed or not caps else (True, True))


def strut(part, p0, p1, chord, thick, colour):
    """Streamlined strut, long axis of the section along the flight direction (+X)."""
    sec = []
    for k in range(10):
        a = 2 * math.pi * k / 10
        c = math.cos(a)
        # a teardrop: full round nose (c > 0, forward), tapered tail
        sec.append((chord * (0.42 * c if c > 0 else 0.58 * c), thick * 0.5 * math.sin(a) * (1 - 0.35 * max(-c, 0))))
    sweep(part, [p0, p1], sec, colour, up=Vector((1, 0, 0)))


def ellipsoid(part, c, r, colour, segs=12, rings=8):
    c = Vector(c)
    rows = []
    for k in range(1, rings):
        p = math.pi * k / rings - math.pi / 2
        rows.append([c + Vector((r[0] * math.cos(p) * math.cos(a), r[1] * math.cos(p) * math.sin(a), r[2] * math.sin(p)))
                     for a in (2 * math.pi * j / segs for j in range(segs))])
    part.grid(rows, colour, caps=(c - Vector((0, 0, r[2])), c + Vector((0, 0, r[2]))))


def box(part, c, size, colour, axes=None):
    c = Vector(c)
    ax = axes or (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
    h = [ax[i] * (size[i] / 2) for i in range(3)]
    corners = {}
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                corners[(sx, sy, sz)] = c + h[0] * sx + h[1] * sy + h[2] * sz
    for axis in range(3):
        for s in (-1, 1):
            quad = []
            for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                key = [0, 0, 0]
                key[axis] = s
                key[(axis + 1) % 3] = a
                key[(axis + 2) % 3] = b
                quad.append(corners[tuple(key)])
            part.poly(quad, colour, outward=h[axis] * s)


# ---- airfoils and lifting surfaces --------------------------------------------------------------

def naca(f, t, m=0.0, p=0.4):
    """Camber and half thickness (fractions of chord) of a NACA 4-digit section, closed trailing edge."""
    f = min(max(f, 0.0), 1.0)
    yt = 5 * t * (0.2969 * math.sqrt(f) - 0.1260 * f - 0.3516 * f * f + 0.2843 * f ** 3 - 0.1036 * f ** 4)
    if m == 0:
        yc = 0.0
    elif f < p:
        yc = m / (p * p) * (2 * p * f - f * f)
    else:
        yc = m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * f - f * f)
    return yc, yt


def cos_space(n):
    return [0.5 * (1 - math.cos(math.pi * k / (n - 1))) for k in range(n)]


def section_fracs(c0, c1, n=10):
    """Chord fractions around a section loop between c0 and c1: (fraction, +1 upper / -1 lower)."""
    fs = [c0 + (c1 - c0) * u for u in cos_space(n)]
    upper = [(f, 1) for f in reversed(fs)]
    lower = [(f, -1) for f in fs]
    if c0 <= 0.0:
        lower = lower[1:]
    if c1 >= 1.0:
        lower = lower[:-1]
    return upper + lower


class Surface:
    """A lifting surface described per station s (signed spanwise coordinate): `place(s)` gives the
    leading-edge point, chord, local chord direction (LE to TE), up (thickness) direction, and
    sag (0..1, how much the upper fabric dips between ribs there)."""

    def __init__(self, place, t, m=0.0, colour=None, sag=0.0):
        self.place, self.t, self.m, self.colour, self.sag = place, t, m, colour, sag

    def point(self, s, f, side, sagged=True):
        le, chord, cdir, up = self.place(s)
        yc, yt = naca(f, self.t, self.m)
        if sagged and side > 0 and self.sag:
            u = (abs(s) / BAY) % 1.0
            yt *= 1 - self.sag * math.sin(math.pi * u) * smooth(0.06, 0.22, f)
        return le + cdir * (f * chord) + up * ((yc + side * yt) * chord)

    def loft(self, part, stations, c0=0.0, c1=1.0, caps=(True, True), n=10):
        fr = section_fracs(c0, c1, n)
        rows, uvs = [], []
        for s in stations:
            ring = [self.point(s, f, side) for f, side in fr]
            rows.append(ring)
            arc, uv = 0.0, []
            for k, p in enumerate(ring):
                if k:
                    arc += (p - ring[k - 1]).length
                uv.append((s / BAY, arc / BAY))
            uvs.append(uv)

        def colour(i, j):
            fa, sa = fr[j]
            fb, _ = fr[(j + 1) % len(fr)]
            return self.colour((stations[i] + stations[i + 1]) / 2, (fa + fb) / 2, sa)
        part.grid(rows, colour, uvs=uvs, caps=caps)


def stations(a, b, extra=(), step=BAY / 3):
    """Spanwise stations from a to b (a < b): every third of a rib bay plus `extra`."""
    out = {round(a, 5), round(b, 5)}
    k = math.ceil(a / step - 1e-6)
    while k * step < b - 1e-6:
        out.add(round(k * step, 5))
        k += 1
    for e in extra:
        if a < e < b:
            out.add(round(e, 5))
    pts = sorted(out)
    clean = [pts[0]]
    for p in pts[1:]:
        if p - clean[-1] > 0.02:
            clean.append(p)
    clean[-1] = pts[-1]
    return clean


def tip_stations(a, b, n=9):
    return [a + (b - a) * u for u in (0, 0.22, 0.42, 0.6, 0.74, 0.85, 0.93, 0.975, 1.0)][:n]


# ---- the airframe -------------------------------------------------------------------------------

UPPER = dict(z=1.52, le=1.88, sweep=0.06, chord=1.52, span=4.9, ail=(2.75, 4.45), tip=0.48)
LOWER = dict(z=-0.40, root=0.40, dihedral=0.055, le=1.56, sweep=0.06, chord=1.40, span=4.6, ail=(2.55, 4.15), tip=0.44)


def wing_place(W, lower):
    def place(s):
        a = abs(s)
        chord = W['chord']
        le_x = W['le'] - W['sweep'] * a
        z = W['z'] + (W['dihedral'] * max(a - W['root'], 0.0) if lower else 0.0)
        t0 = W['span'] - W['tip']
        if a > t0:
            k = math.sqrt(max(0.0, 1 - ((a - t0) / W['tip']) ** 2))
            k = max(k, 0.07)
            le_x -= chord * (1 - k) * 0.42
            chord *= k
        if not lower and a < 0.62:
            # trailing-edge cut-out over the front cockpit
            chord -= 0.36 * math.sqrt(max(0.0, 1 - (a / 0.62) ** 2))
        return Vector((le_x, s, z)), chord, Vector((-1, 0, 0)), Vector((0, 0, 1))
    return place


def wing_colour(W, lower):
    def colour(s, f, side):
        a = abs(s)
        if a > W['span'] - 0.62:
            return CRIMSON
        if lower and side > 0 and a < 1.05 and f < 0.6:
            return WALK
        return CREAM
    return colour


def build_wing(fabric, W, lower):
    surf = Surface(wing_place(W, lower), t=0.12, m=0.02, colour=wing_colour(W, lower), sag=0.11)
    a0, a1 = W['ail']
    t0 = W['span'] - W['tip']
    tipband = W['span'] - 0.62
    gap = 0.025
    if not lower:
        surf.loft(fabric, stations(-a0, a0))                     # the centre section, tip to tip of it
    for side in (1, -1):
        def sg(lst):
            return [side * x for x in lst]
        if lower:
            surf.loft(fabric, sg(stations(W['root'], a0, (1.05,))))
        surf.loft(fabric, sg(stations(a0, a1, (tipband,))), c1=0.74)                     # ahead of the aileron
        surf.loft(fabric, sg(stations(a0 + gap, a1 - gap, (tipband,))), c0=0.765)        # the aileron
        surf.loft(fabric, sg(stations(a1, t0, (tipband,)) + tip_stations(t0, W['span'])[1:]))
    return surf


def wing_pt(surf, s, f, side):
    return surf.point(s, f, side, sagged=False)


# fuselage stations: x, half width, bottom z, widest line z, crown z, chine radius
FUS = [
    (3.03, 0.47, -0.46, 0.04, 0.47, 0.40),
    (2.80, 0.48, -0.51, 0.13, 0.53, 0.30),
    (2.40, 0.48, -0.55, 0.22, 0.57, 0.16),
    (1.60, 0.47, -0.57, 0.26, 0.59, 0.11),
    (0.60, 0.46, -0.57, 0.27, 0.60, 0.10),
    (-0.40, 0.44, -0.54, 0.28, 0.61, 0.10),
    (-1.10, 0.40, -0.49, 0.28, 0.64, 0.09),
    (-1.90, 0.32, -0.40, 0.26, 0.52, 0.08),
    (-2.80, 0.22, -0.28, 0.23, 0.39, 0.06),
    (-3.50, 0.13, -0.17, 0.21, 0.30, 0.04),
    (-4.06, 0.035, -0.07, 0.19, 0.23, 0.015),
]


def _pchip(xs, ys):
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        x = min(max(x, xs[0]), xs[-1])
        i = max(0, min(n - 2, next((k for k in range(n - 1) if x <= xs[k + 1]), n - 2)))
        t = (x - xs[i]) / h[i]
        h00, h10, h01, h11 = 2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t, -2 * t ** 3 + 3 * t ** 2, t ** 3 - t ** 2
        return h00 * ys[i] + h10 * h[i] * m[i] + h01 * ys[i + 1] + h11 * h[i] * m[i + 1]
    return f


_FX = [r[0] for r in reversed(FUS)]
_FCOLS = [_pchip(_FX, [r[k] for r in reversed(FUS)]) for k in range(1, 6)]


def fus(x):
    w, zb, zs, zt, rc = (f(x) for f in _FCOLS)
    return w, zb, zs, zt, min(rc, w - 0.03, zs - zb - 0.03)


SIDE_FRACS = (0.4, 0.72, 0.86, 1.0)     # flat side, chine to widest line; the cheat line is 0.72..0.86


def fus_half(x):
    """Starboard half-section from the bottom centre to the crown: 17 points (y <= 0)."""
    w, zb, zs, zt, rc = fus(x)
    pts = [(0.0, zb), (-(w - rc) * 0.5, zb), (-(w - rc), zb)]
    for k in range(1, 5):
        a = k * math.pi / 8
        pts.append((-(w - rc + rc * math.sin(a)), zb + rc - rc * math.cos(a)))
    for fr in SIDE_FRACS:
        pts.append((-w, zb + rc + fr * (zs - zb - rc)))
    for k in range(1, 7):
        a = k * math.pi / 12
        pts.append((-w * math.cos(a), zs + (zt - zs) * math.sin(a)))
    return pts


def fus_ring(x):
    h = fus_half(x)
    full = h + [(-y, z) for y, z in reversed(h[1:-1])]
    return [Vector((x, y, z)) for y, z in full]


def deck_z(x, y):
    """Height of the turtle deck at (x, y)."""
    w, zb, zs, zt, rc = fus(x)
    q = min(abs(y) / w, 1.0)
    return zs + (zt - zs) * math.sqrt(max(0.0, 1 - q * q))


def side_y(x):
    return fus(x)[0]


def build_fuselage(paint, fabric, leather, glass, metal):
    split = -1.0
    xs_front = [3.03, 2.95, 2.85, 2.72, 2.58, 2.42, 2.2, 1.95, 1.7, 1.45, 1.2, 0.95, 0.7, 0.45, 0.2, -0.05, -0.3, -0.55, -0.75, split]
    xs_back = [split, -1.15, -1.4, -1.65, -1.9, -2.15, -2.4, -2.65, -2.9, -3.15, -3.4, -3.6, -3.8, -3.95, -4.06]
    stripe = {8, 23}

    def colour(i, j):
        return CREAM if j in stripe else CRIMSON

    paint.grid([fus_ring(x) for x in xs_front], colour, caps=(True, False), cap_colour=GUNMETAL)
    # aft fabric: rings opened at the keel so the UVs run round without a seam jump
    rows, uvs = [], []
    for x in xs_back:
        ring = fus_ring(x)
        ring = ring + [ring[0]]
        rows.append(ring)
        arc, uv = 0.0, []
        for k, p in enumerate(ring):
            if k:
                arc += (p - ring[k - 1]).length
            uv.append((arc / 0.13, x / BAY))
        uvs.append(uv)
    fabric.grid(rows, colour, uvs=uvs, wrap=False, caps=(False, True))

    # panel lines on the metal forward fuselage: raised dark strips round the section
    for xp in (2.62, 1.82, 0.08, -0.985):
        lo, hi = xp - 0.009, xp + 0.009
        r0, r1 = fus_ring(lo), fus_ring(hi)
        c0 = Vector((lo, 0, sum(p.z for p in r0) / len(r0)))
        c1 = Vector((hi, 0, sum(p.z for p in r1) / len(r1)))

        def out(p, c):
            d = p - c
            d.x = 0
            return p + d.normalized() * 0.005
        paint.grid([[out(p, c0) for p in r0], [out(p, c1) for p in r1]], CRIMSON_DK)
    # a horizontal panel seam along each side
    for sgn in (1, -1):
        xs = [2.85, 2.4, 1.8, 1.2, 0.6, 0.0, -0.6, -0.985]
        path = []
        for x in xs:
            w, zb, zs, zt, rc = fus(x)
            path.append(Vector((x, sgn * (w + 0.004), zb + rc + 0.4 * (zs - zb - rc))))
        sweep(paint, path, [(0.0, 0.009), (0.004, 0.0), (0.0, -0.009)], CRIMSON_DK, up=Vector((0, sgn, 0)))

    # louvres on the nose sides
    for sgn in (1, -1):
        for k in range(6):
            x = 2.72 - k * 0.075
            w, zb, zs, zt, rc = fus(x)
            box(paint, (x, sgn * (w + 0.008), zs - 0.2), (0.022, 0.016, 0.2), INK)

    # racing number roundels behind the rear cockpit
    for sgn in (1, -1):
        number_roundel(paint, -2.05, -0.02, sgn)

    # cockpits
    for xc, a, b in ((0.62, 0.33, 0.26), (REAR, 0.34, 0.28)):
        cockpit(leather, xc, a, b)
    windscreen(glass, metal, 0.62 + 0.33 + 0.05, 0.2)
    windscreen(glass, metal, REAR + 0.34 + 0.06, 0.24)
    # headrest fairing behind the rear cockpit
    path = []
    for k in range(9):
        x = -1.0 - k * 0.12
        path.append(Vector((x, 0, deck_z(x, 0) + 0.035 * (1 - k / 8) ** 1.5)))
    sweep(leather, path, [(0.0, 0.07), (0.02, 0.05), (0.03, 0.0), (0.02, -0.05), (0.0, -0.07)] , LEATHER_DK,
          up=Vector((0, 0, 1)))


DIGIT_7 = [  # blocky racing "7", unit height, centred
    [(-0.30, 0.50), (0.32, 0.50), (0.32, 0.34), (-0.30, 0.34)],
    [(0.32, 0.34), (0.12, 0.34), (-0.16, -0.50), (0.05, -0.50)],
]


def number_roundel(part, x, z, sgn):
    """A cream disc with an ink ring and number on the fuselage side (sgn +1 port, -1 starboard)."""
    out = Vector((0, sgn, 0))

    def at(u, v, lift):
        # glyph u to the viewer's right: -x on the port side, +x on starboard
        px = x - sgn * u
        return Vector((px, sgn * (side_y(px) + lift), z + v))
    rings = 28
    disc = [at(0.235 * math.cos(2 * math.pi * k / rings), 0.235 * math.sin(2 * math.pi * k / rings), 0.006) for k in range(rings)]
    centre = at(0, 0, 0.006)
    for k in range(rings):
        part.poly([centre, disc[k], disc[(k + 1) % rings]], CREAM, outward=out)
    for k in range(rings):
        a0, a1 = 2 * math.pi * k / rings, 2 * math.pi * (k + 1) / rings
        q = [at(0.235 * math.cos(a0), 0.235 * math.sin(a0), 0.008), at(0.235 * math.cos(a1), 0.235 * math.sin(a1), 0.008),
             at(0.205 * math.cos(a1), 0.205 * math.sin(a1), 0.008), at(0.205 * math.cos(a0), 0.205 * math.sin(a0), 0.008)]
        part.poly(q, INK, outward=out)
    for stroke in DIGIT_7:
        part.poly([at(u * 0.3, v * 0.3, 0.009) for u, v in stroke], INK, outward=out)


REAR = -0.58     # the rear (pilot's) cockpit


def cockpit(leather, xc, a, b):
    n = 28
    rim = []
    for k in range(n):
        t = 2 * math.pi * k / n
        x, y = xc + a * math.cos(t), b * math.sin(t)
        rim.append(Vector((x, y, deck_z(x, y) + 0.022)))
    sweep(leather, rim, 0.032, LEATHER, closed=True)
    # the dark well inside the coaming
    well = []
    for k in range(n):
        t = 2 * math.pi * k / n
        x, y = xc + (a - 0.01) * math.cos(t), (b - 0.01) * math.sin(t)
        well.append(Vector((x, y, deck_z(x, y) + 0.006)))
    c = Vector((xc, 0, deck_z(xc, 0) + 0.004))
    for k in range(n):
        leather.poly([c, well[k], well[(k + 1) % n]], INK, outward=(0, 0, 1))


def windscreen(glass, metal, x0, h):
    """A small curved screen on the deck at x0 with a brass frame, leaning back."""
    ys = [-0.22, -0.13, 0.0, 0.13, 0.22]
    bottom, top = [], []
    for y in ys:
        xb = x0 - 0.03 * (abs(y) / 0.22) ** 2
        bottom.append(Vector((xb, y, deck_z(xb, y) + 0.01)))
        top.append(Vector((xb - h * 0.55, y * 0.92, deck_z(xb, y) + 0.01 + h)))
    glass.grid([bottom, top], GLASS, wrap=False, outward=(1, 0, 0.3))
    sweep(metal, [bottom[0]] + top + [bottom[-1]], 0.008, BRASS)


def build_pilot(leather, glass, metal, xc, k=1.2, lift=0.03):
    """Built at true size, then scaled up a little about the seat (k) so he reads from a distance."""
    marks = [len(p.bm.verts) for p in (leather, glass, metal)]
    _pilot(leather, glass, metal, xc)
    top = deck_z(xc, 0)
    origin = Vector((xc, 0, top))
    for p, n0 in zip((leather, glass, metal), marks):
        p.bm.verts.ensure_lookup_table()
        for v in p.bm.verts[n0:]:
            v.co = origin + (v.co - origin) * k + Vector((0, 0, lift))


def _pilot(leather, glass, metal, xc):
    top = deck_z(xc, 0)
    xh, zh = xc - 0.02, top + 0.40
    ellipsoid(leather, (xc - 0.05, 0, top + 0.06), (0.17, 0.24, 0.2), LEATHER, segs=14, rings=8)
    ellipsoid(leather, (xc - 0.03, 0, top + 0.21), (0.06, 0.06, 0.06), SKIN, segs=8, rings=5)   # neck
    ellipsoid(leather, (xh, 0, zh), (0.095, 0.08, 0.105), SKIN, segs=14, rings=8)
    ellipsoid(leather, (xh - 0.028, 0, zh + 0.018), (0.104, 0.091, 0.106), LEATHER_DK, segs=14, rings=8)
    # ear flaps
    for s in (1, -1):
        ellipsoid(leather, (xh - 0.01, s * 0.082, zh - 0.03), (0.045, 0.018, 0.06), LEATHER_DK, segs=8, rings=5)
    # goggles: brass rims, glass lenses, a strap round the helmet
    for s in (1, -1):
        c = Vector((xh + 0.086, s * 0.036, zh + 0.012))
        lathe(metal, c - Vector((0.012, 0, 0)), (1, 0, 0), [(0.0, 0.0), (0.03, 0.0), (0.03, 0.022), (0.022, 0.026)], BRASS, segs=10)
        lathe(glass, c + Vector((0.006, 0, 0)), (1, 0, 0), [(0.0, 0.0), (0.023, 0.0), (0.0, 0.006)], GLASS, segs=10)
    strap = []
    for k in range(20):
        t = 2 * math.pi * k / 20
        strap.append(Vector((xh - 0.028 + 0.108 * math.cos(t), 0.094 * math.sin(t), zh + 0.012)))
    sweep(leather, strap, [(0.012, 0.004), (-0.012, 0.004), (-0.012, -0.004), (0.012, -0.004)], INK, closed=True,
          up=Vector((0, 0, 1)))
    # the scarf: a wrap round the neck and two tails streaming back in the slipstream
    wrap = []
    for k in range(16):
        t = 2 * math.pi * k / 16
        wrap.append(Vector((xc - 0.03 + 0.078 * math.cos(t), 0.078 * math.sin(t), top + 0.2)))
    sweep(leather, wrap, 0.03, SCARF, closed=True)
    for s, ph in ((1, 0.0), (-1, 1.7)):
        path = []
        for k in range(10):
            u = k / 9
            path.append(Vector((xc - 0.1 - 0.62 * u, s * 0.03 + 0.07 * u * math.sin(u * 7 + ph), top + 0.19 + 0.05 * u + 0.03 * u * math.sin(u * 5 + ph))))
        wid = 0.05
        sweep(leather, path, [(wid, 0.006), (-wid, 0.006), (-wid, -0.006), (wid, -0.006)], SCARF, up=Vector((0, 0, 1)))


def build_engine(metal, lamp):
    xc = 3.28
    # crankcase, nose case and prop shaft housing
    lathe(metal, (3.02, 0, 0), (1, 0, 0), [(0.0, 0.0), (0.26, 0.0), (0.27, 0.12), (0.235, 0.16), (0.235, 0.36),
                                            (0.2, 0.40), (0.15, 0.52), (0.1, 0.6), (0.075, 0.62), (0.0, 0.64)],
          GUNMETAL, segs=18)
    # ignition harness ring
    ring = [Vector((3.40, 0.215 * math.cos(2 * math.pi * k / 24), 0.215 * math.sin(2 * math.pi * k / 24))) for k in range(24)]
    sweep(metal, ring, 0.014, BRASS, closed=True)
    n = 9
    for k in range(n):
        phi = math.pi / 2 + 2 * math.pi * k / n
        d = Vector((0, math.cos(phi), math.sin(phi)))
        tng = Vector((0, -math.sin(phi), math.cos(phi)))
        base = Vector((xc, 0, 0)) + d * 0.22
        prof = [(0.0, 0.0), (0.082, 0.0), (0.082, 0.014), (0.066, 0.02)]
        h = 0.03
        for _ in range(5):           # barrel fins
            prof += [(0.066, h), (0.088, h + 0.004), (0.088, h + 0.010), (0.066, h + 0.014)]
            h += 0.03
        prof += [(0.07, h + 0.004)]
        h += 0.008
        for _ in range(3):           # head fins, wider
            prof += [(0.07, h), (0.098, h + 0.004), (0.098, h + 0.011), (0.07, h + 0.015)]
            h += 0.034
        prof += [(0.065, h + 0.01), (0.04, h + 0.03), (0.0, h + 0.036)]
        lathe(metal, base, d, prof, lambda i, j: GUNMETAL if i < 23 else ALU, segs=8, hint=Vector((1, 0, 0)))
        head = base + d * (h - 0.02)
        # rocker boxes and pushrods
        for s in (1, -1):
            rb = head + tng * (0.05 * s) + Vector((0.06, 0, 0))
            box(metal, rb, (0.05, 0.05, 0.05), ALU, axes=(Vector((1, 0, 0)), tng, d))
            tube(metal, Vector((xc + 0.09, 0, 0)) + d * 0.2 + tng * (0.03 * s), rb - d * 0.02, 0.011, STEEL, segs=5)
        # plug lead from the harness
        tube(metal, Vector((3.40, 0, 0)) + d * 0.215, head + Vector((0.045, 0, 0)) - d * 0.06, 0.006, BRASS, segs=4)
        # exhaust stub back to the collector ring
        tube(metal, head - Vector((0.05, 0, 0)) - d * 0.05, Vector((3.06, 0, 0)) + d * 0.5, 0.03, HOT, segs=6)
    # collector ring and the tail pipe down the starboard side
    coll = [Vector((3.06, 0.5 * math.cos(2 * math.pi * k / 30), 0.5 * math.sin(2 * math.pi * k / 30))) for k in range(30)]
    sweep(metal, coll, 0.045, HOT, closed=True)
    pipe = [Vector((3.06, -0.33, -0.37)), Vector((2.9, -0.47, -0.42)), Vector((2.6, -0.56, -0.43)),
            Vector((2.0, -0.565, -0.44)), Vector((1.62, -0.565, -0.45))]
    sweep(metal, pipe, 0.048, HOT, caps=False)
    end = pipe[-1]
    lathe(lamp, end + Vector((0.01, 0, 0)), (-1, 0, 0), [(0.0, 0.0), (0.046, 0.0), (0.0, 0.004)], EXHAUST_LAMP, segs=8)
    # Townend ring
    prof = [(0.605, 3.10), (0.598, 3.25), (0.606, 3.40), (0.628, 3.485), (0.66, 3.50), (0.69, 3.485),
            (0.708, 3.42), (0.712, 3.30), (0.698, 3.18), (0.672, 3.10), (0.64, 3.085)]
    rows = []
    for k in range(44):
        a = 2 * math.pi * k / 44
        rows.append([Vector((x, r * math.cos(a), r * math.sin(a))) for r, x in prof])
    metal.grid(rows, lambda i, j: CRIMSON if 5 <= j <= 9 else ALU, loop_rows=True)
    return pipe[-1]


def blade(prop, sgn):
    R = 1.22
    rs = [0.09, 0.13, 0.18, 0.25, 0.34, 0.45, 0.57, 0.69, 0.81, 0.92, 1.01, 1.08, 1.13, 1.17, 1.195, 1.212, 1.22]
    fr = section_fracs(0.0, 1.0, 9)
    rows = []
    cols = []
    for r in rs:
        u = r / R
        chord = 0.105 + 0.11 * math.sin(math.pi * min(u / 0.9, 1.0) ** 0.8) * (1 - 0.25 * u)
        if r > 1.08:
            chord *= math.sqrt(max(0.0, 1 - ((r - 1.08) / 0.142) ** 2))
            chord = max(chord, 0.012)
        beta = min(math.atan(1.75 / (2 * math.pi * r)), math.radians(55))
        t = lerp(0.62, 0.09, smooth(0.09, 0.6, r))
        ec = Vector((-math.sin(beta), 0, -math.cos(beta)))      # leading to trailing edge
        nrm = Vector((math.cos(beta), 0, -math.sin(beta)))      # the cambered face, forward
        ring = []
        for f, side in fr:
            yc, yt = naca(f, t, 0.04 * (1 - smooth(0.09, 0.3, r)) + 0.03, 0.4)
            p = Vector((0, r, 0)) + ec * ((f - 0.35) * chord) + nrm * ((yc + side * yt) * chord)
            ring.append(PROP_HUB + Vector((p.x, sgn * p.y, sgn * p.z)))
        rows.append(ring)
        cols.append(BRASS if r > 1.1 else WOOD)
    prop.grid(rows, lambda i, j: cols[i + 1] if cols[i + 1] is BRASS else (WOOD_DK if j in (0, len(fr) - 1) else WOOD),
              caps=(True, True))


def build_prop(prop, spinner):
    blade(prop, 1)
    blade(prop, -1)
    lathe(prop, PROP_HUB - Vector((0.11, 0, 0)), (1, 0, 0),
          [(0.0, 0.0), (0.1, 0.0), (0.13, 0.03), (0.135, 0.11), (0.125, 0.19), (0.1, 0.21), (0.0, 0.21)], WOOD_DK, segs=16)
    hx = PROP_HUB.x + 0.10
    lathe(spinner, (hx, 0, 0), (1, 0, 0), [(0.0, 0.0), (0.118, 0.0), (0.118, 0.018), (0.1, 0.022), (0.098, 0.06),
                                         (0.085, 0.1), (0.06, 0.135), (0.03, 0.155), (0.0, 0.162)], ALU, segs=18)
    for k in range(6):
        a = 2 * math.pi * k / 6 + 0.3
        c = Vector((hx + 0.018, 0.105 * math.cos(a), 0.105 * math.sin(a)))
        lathe(spinner, c, (1, 0, 0), [(0.0, 0.0), (0.014, 0.0), (0.014, 0.012), (0.0, 0.016)], STEEL, segs=6)


def build_tail(fabric, metal):
    # stabiliser and split elevators: symmetric sections, rounded tips, crimson tips
    S0, CH, LE, Z = 1.6, 0.98, -3.12, 0.13

    def stab_place(s):
        a = abs(s)
        chord, le = CH, LE - 0.05 * a
        t0 = S0 - 0.55
        if a > t0:
            k = max(math.sqrt(max(0.0, 1 - ((a - t0) / 0.55) ** 2)), 0.07)
            le -= chord * (1 - k) * 0.35
            chord *= k
        return Vector((le, s, Z)), chord, Vector((-1, 0, 0)), Vector((0, 0, 1))

    def tail_colour(s, f, side):
        return CRIMSON if abs(s) > S0 - 0.38 else CREAM
    stab = Surface(stab_place, t=0.09, colour=tail_colour, sag=0.06)
    band = (S0 - 0.38,)
    core = stations(-(S0 - 0.55), S0 - 0.55, (-band[0], band[0]))
    tipp = tip_stations(S0 - 0.55, S0)
    st = [-x for x in reversed(tipp[1:])] + core + tipp[1:]
    stab.loft(fabric, st, c1=0.6)
    for side in (1, -1):
        el = stations(0.14, S0 - 0.55, band) + tipp[1:]
        el = [side * x for x in el] if side > 0 else [side * x for x in reversed(el)]
        stab.loft(fabric, el, c0=0.625)

    # fin (span runs up z) and rudder with horizontal stripes
    def fin_place(z):
        u = (z - 0.1) / 0.92
        le = -3.32 - 0.66 * u ** 1.4
        te = -4.05
        return Vector((le, 0, z)), max(le - te, 0.03), Vector((-1, 0, 0)), Vector((0, 1, 0))
    fin = Surface(fin_place, t=0.1, colour=lambda s, f, side: CRIMSON)
    fz = [0.1 + 0.92 * u for u in (0, 0.12, 0.25, 0.38, 0.5, 0.62, 0.72, 0.8, 0.87, 0.93, 0.97, 1.0)]
    fin.loft(fabric, fz)

    z0, z1 = -0.16, 1.16
    edges = [z0 + (z1 - z0) * k / 7 for k in range(8)]

    def rud_place(z):
        u = (z - z0) / (z1 - z0)
        e = 2 * u - 1
        k = (1 - abs(e) ** 3.2) ** 0.5
        chord = max(0.62 * k, 0.04) / 0.7
        hinge = -4.07
        return Vector((hinge + 0.3 * chord, 0, z)), chord, Vector((-1, 0, 0)), Vector((0, 1, 0))

    def rud_colour(z, f, side):
        band = min(int((z - z0) / (z1 - z0) * 7), 6)
        return CRIMSON if band % 2 == 0 else CREAM
    rud = Surface(rud_place, t=0.12, colour=rud_colour)
    rz = sorted(set([round(z, 4) for z in edges] + [round(z0 + (z1 - z0) * u, 4) for u in (0.015, 0.05, 0.95, 0.985)]))
    rud.loft(fabric, rz, c0=0.3)

    # bracing wires from the stabiliser to the fin and to the fuselage bottom
    for s in (1, -1):
        a = stab.point(s * 0.85, 0.3, 1, sagged=False)
        b = stab.point(s * 0.85, 0.3, -1, sagged=False)
        tube(metal, a, Vector((-3.72, 0, 0.78)), 0.009, STEEL, segs=4)
        tube(metal, b, Vector((-3.4, s * 0.1, fus(-3.4)[1] + 0.02)), 0.009, STEEL, segs=4)
    # tail skid
    sweep(metal, [Vector((-3.5, 0, fus(-3.5)[1] + 0.02)), Vector((-3.66, 0, -0.27)), Vector((-3.84, 0, -0.36)),
                  Vector((-3.96, 0, -0.38))], [(0.0, 0.03), (0.012, 0.0), (0.0, -0.03), (-0.012, 0.0)], GUNMETAL,
          up=Vector((0, 0, 1)))
    box(metal, (-3.95, 0, -0.395), (0.12, 0.05, 0.025), STEEL)
    return Vector((-4.0, 0, -0.1))


def build_gear(paint, metal, leather):
    ax, az, ay = 1.28, -1.28, 0.92
    for s in (1, -1):
        apex = Vector((ax, s * ay, az))
        strut(paint, Vector((1.82, s * 0.3, fus(1.82)[1] + 0.03)), apex, 0.1, 0.045, CRIMSON)
        strut(paint, Vector((0.78, s * 0.3, fus(0.78)[1] + 0.03)), apex, 0.1, 0.045, CRIMSON)
        # bungee wraps at the apex
        lathe(leather, apex - Vector((0, s * 0.02, 0)), (0, s, 0), [(0.0, 0.0), (0.05, 0.0), (0.05, 0.08), (0.0, 0.08)],
              INK, segs=8)
    strut(paint, Vector((ax, ay, az)), Vector((ax, -ay, az)), 0.12, 0.04, CRIMSON)
    tube(metal, Vector((ax, 1.2, az)), Vector((ax, -1.2, az)), 0.022, STEEL, segs=8)
    for s in (1, -1):
        wheel(metal, leather, paint, Vector((ax, s * 1.1, az)))


def wheel(metal, leather, paint, c):
    R, r = 0.31, 0.075
    # tyre: a torus round the y axis
    rows = []
    for k in range(30):
        a = 2 * math.pi * k / 30
        rad = Vector((math.cos(a), 0, math.sin(a)))
        rows.append([c + rad * (R + r * math.cos(b)) + Vector((0, r * 1.0 * math.sin(b), 0)) for b in
                     (2 * math.pi * j / 10 for j in range(10))])
    leather.grid(rows, TYRE, loop_rows=True)
    # rim
    rim = []
    for k in range(30):
        a = 2 * math.pi * k / 30
        rim.append(c + Vector((math.cos(a), 0, math.sin(a))) * (R - r * 0.75))
    sweep(metal, rim, [(0.05, 0.0), (0.0, 0.012), (-0.05, 0.0), (0.0, -0.012)], ALU, closed=True, up=Vector((0, 1, 0)))
    # hub and its crimson cap
    lathe(metal, c - Vector((0, 0.09, 0)), (0, 1, 0), [(0.0, 0.0), (0.04, 0.0), (0.035, 0.18), (0.0, 0.18)], ALU, segs=10)
    for s in (1, -1):
        lathe(paint, c + Vector((0, s * 0.09, 0)), (0, s, 0), [(0.0, 0.0), (0.06, 0.0), (0.045, 0.02), (0.0, 0.03)],
              CRIMSON, segs=12)
    # spokes, crossed from both hub flanges
    for k in range(24):
        a = 2 * math.pi * k / 24
        s = 1 if k % 2 else -1
        rim_pt = c + Vector((math.cos(a + 0.12 * s), 0, math.sin(a + 0.12 * s))) * (R - r * 0.8)
        hub_pt = c + Vector((math.cos(a) * 0.04, s * 0.07, math.sin(a) * 0.04))
        tube(metal, hub_pt, rim_pt, 0.0045, STEEL, segs=3, caps=False)


def build_struts(paint, metal, up, lo):
    # cabane: two N frames from the deck to the centre section
    for s in (1, -1):
        topf, topr = wing_pt(up, s * 0.33, 0.17, -1), wing_pt(up, s * 0.33, 0.66, -1)
        bf = Vector((1.72, s * 0.3, deck_z(1.72, 0.3)))
        br = Vector((1.02, s * 0.3, deck_z(1.02, 0.3)))
        strut(paint, bf, topf, 0.075, 0.032, CRIMSON)
        strut(paint, br, topr, 0.075, 0.032, CRIMSON)
        strut(paint, bf, topr, 0.06, 0.028, CRIMSON)
    # interplane struts at the tenth rib
    si = 10 * BAY
    for s in (1, -1):
        for f in (0.2, 0.68):
            strut(paint, wing_pt(lo, s * si, f, 1), wing_pt(up, s * si, f, -1), 0.11, 0.04, CRIMSON)
        # flying wires (doubled) from the lower root up to the strut tops; landing wires down
        for f in (0.2, 0.68):
            top = wing_pt(up, s * si, f, -1)
            for dx in (0.0, 0.05):
                a = wing_pt(lo, s * 0.62, f, 1) + Vector((dx, 0, 0))
                tube(metal, a, top + Vector((dx, 0, 0)), 0.011, STEEL, segs=4)
            tube(metal, wing_pt(up, s * 0.45, f, -1), wing_pt(lo, s * si, f, 1), 0.011, STEEL, segs=4)
        # incidence wire across the strut pair
        tube(metal, wing_pt(lo, s * si, 0.2, 1), wing_pt(up, s * si, 0.68, -1), 0.008, STEEL, segs=4)
    # pitot on the port strut
    p = wing_pt(up, si, 0.2, -1).lerp(wing_pt(lo, si, 0.2, 1), 0.2) + Vector((0.03, 0, 0))
    tube(metal, p, p + Vector((0.42, 0, 0)), 0.012, BRASS, segs=6)


def number_under_wing(paint, lo, s, x_mid):
    """Black racing number under the lower wing, read from below, its top toward the leading edge."""
    def at(u, v):
        sy = s + u * 0.62
        le, chord, _, _ = lo.place(sy)
        f = (le.x - (x_mid + v * 0.95)) / chord
        return lo.point(sy, f, -1, sagged=False) + Vector((0, 0, -0.006))
    for stroke in DIGIT_7:
        n = 6
        for i in range(n):
            for j in range(n):
                q = []
                for di, dj in ((0, 0), (1, 0), (1, 1), (0, 1)):
                    a, b = (i + di) / n, (j + dj) / n
                    p0 = [stroke[0][k] + (stroke[1][k] - stroke[0][k]) * a for k in (0, 1)]
                    p1 = [stroke[3][k] + (stroke[2][k] - stroke[3][k]) * a for k in (0, 1)]
                    q.append(at(p0[0] + (p1[0] - p0[0]) * b, p0[1] + (p1[1] - p0[1]) * b))
                paint.poly(q, INK, outward=(0, 0, -1))


def lamp_at(lamp, c, r, colour):
    ellipsoid(lamp, c, r, colour, segs=8, rings=6)


def build(collection):
    parts = {k: Part(k) for k in ('fabric', 'paint', 'metal', 'leather', 'glass', 'lamp', 'prop', 'spinner')}
    fab, paint, metal, leather = parts['fabric'], parts['paint'], parts['metal'], parts['leather']

    up = build_wing(fab, UPPER, lower=False)
    lo = build_wing(fab, LOWER, lower=True)
    build_fuselage(paint, fab, leather, parts['glass'], metal)
    build_pilot(leather, parts['glass'], metal, REAR)
    exhaust = build_engine(metal, parts['lamp'])
    build_prop(parts['prop'], parts['spinner'])
    tow = build_tail(fab, metal)
    build_gear(paint, metal, leather)
    build_struts(paint, metal, up, lo)
    for s in (1, -1):
        number_under_wing(paint, lo, s * 3.05, lo.place(3.05)[0].x - 0.7)

    # navigation lights: red to port, green to starboard on the upper tips, white on the rudder
    tip = UPPER['span']
    marks = {}
    for s, col, name in ((1, RED_LAMP, 'nav_port'), (-1, GREEN_LAMP, 'nav_star')):
        le, chord, _, _ = up.place(s * (tip - 0.03))
        c = Vector((le.x - chord * 0.4, s * (tip + 0.01), UPPER['z'] + 0.02))
        lamp_at(parts['lamp'], c, (0.07, 0.035, 0.03), col)
        marks[name] = c + Vector((0, s * 0.06, 0))
    c = Vector((-4.69, 0, 0.5))
    lamp_at(parts['lamp'], c, (0.035, 0.022, 0.04), WHITE_LAMP)
    marks['nav_tail'] = c + Vector((-0.05, 0, 0))
    marks['exhaust'] = exhaust + Vector((-0.04, 0, 0))
    marks['prop_hub'] = PROP_HUB.copy()
    marks['tow'] = tow

    objs = {}
    for k, p in parts.items():
        o = p.finish(collection)
        if o:
            objs[k] = o
    for name, loc in marks.items():
        e = bpy.data.objects.new(name, None)
        e.location = loc * SCALE
        collection.objects.link(e)
    return objs, {k: [round(c * SCALE, 4) for c in v] for k, v in marks.items()}
