"""Cars: four road vehicles built by lofting cross-sections along the body.

The body is a stack of cross-sections (bottom, sill, shoulder, belt, tumblehome,
roof) swept along the car from nose to tail. The wheel arches are real notches in
the lower side wall, so a wheel shows in them; windows are the faces above the belt
line between the pillars. Everything is modelled in metres with the nose on +x
(the exporter turns that into three's frame) and the origin on the ground at the
car's centre.

Two meshes come out of each car: `paint`, which the site tints per instance, and
`detail` (glass, tyres, rims, bumpers, lamps), coloured with vertex colours so it
shares one material.
"""
import math

import bmesh
import bpy
from mathutils import Vector

PAINT, GLASS, TYRE, RIM, TRIM, HEAD, TAIL = range(7)
DETAIL_COLOURS = {
    GLASS: (0.012, 0.018, 0.026, 1),
    TYRE: (0.010, 0.010, 0.012, 1),
    RIM: (0.34, 0.35, 0.37, 1),
    TRIM: (0.016, 0.017, 0.020, 1),
    HEAD: (1.0, 0.86, 0.55, 1),
    TAIL: (0.95, 0.05, 0.03, 1),
}

# name -> length, width, ground clearance, wheelbase, wheel radius, belt height,
# the roof/body top profile (x, z) from nose to tail, and the glazing intervals.
SPECS = {
    'sedan': dict(
        L=4.70, W=1.82, clear=0.15, wb=2.75, wr=0.33, belt=0.98,
        top=[(2.35, 0.52), (2.32, 0.74), (2.05, 0.90), (1.25, 1.00), (0.85, 1.04), (0.25, 1.44),
             (-0.65, 1.46), (-1.25, 1.10), (-1.55, 1.04), (-2.20, 1.04), (-2.35, 0.90), (-2.35, 0.55)],
        wind=[(0.25, 0.85)], rear=[(-1.25, -0.65)],
        side=[(0.78, 0.0), (-0.14, -1.18)],
    ),
    'hatch': dict(
        L=3.95, W=1.74, clear=0.15, wb=2.45, wr=0.31, belt=0.96,
        top=[(1.97, 0.50), (1.94, 0.72), (1.72, 0.87), (1.05, 0.96), (0.70, 1.00), (0.15, 1.46),
             (-1.15, 1.48), (-1.75, 1.16), (-1.97, 0.86), (-1.97, 0.55)],
        wind=[(0.15, 0.70)], rear=[(-1.75, -1.15)],
        side=[(0.62, -0.06), (-0.20, -1.55)],
    ),
    'suv': dict(
        L=4.80, W=1.92, clear=0.22, wb=2.85, wr=0.37, belt=1.16,
        top=[(2.40, 0.62), (2.37, 0.88), (2.12, 1.08), (1.40, 1.16), (1.00, 1.20), (0.45, 1.70),
             (-1.75, 1.72), (-2.28, 1.56), (-2.40, 1.20), (-2.40, 0.64)],
        wind=[(0.45, 1.00)], rear=[(-2.28, -1.75)],
        side=[(0.92, -0.04), (-0.16, -1.70)],
    ),
    'pickup': dict(
        L=5.30, W=1.96, clear=0.24, wb=3.25, wr=0.39, belt=1.14,
        top=[(2.65, 0.64), (2.62, 0.92), (2.35, 1.10), (1.60, 1.18), (1.20, 1.22), (0.65, 1.72),
             (-0.20, 1.74), (-0.55, 1.28), (-0.66, 1.04), (-2.50, 1.02), (-2.65, 0.96), (-2.65, 0.62)],
        wind=[(0.65, 1.20)], rear=[(-0.55, -0.20)],
        side=[(1.14, 0.18), (0.08, -0.46)],
    ),
    # a delivery van: tall box, steep screen, glazing only in the cab
    'van': dict(
        L=5.35, W=2.02, clear=0.18, wb=3.30, wr=0.35, belt=1.14, tz=1.08,
        top=[(2.67, 0.60), (2.64, 0.88), (2.50, 1.06), (1.95, 1.13), (1.62, 1.17), (0.98, 2.02),
             (0.70, 2.12), (-2.40, 2.14), (-2.58, 2.06), (-2.67, 1.84), (-2.67, 0.66)],
        wind=[(0.98, 1.62)], rear=[],
        side=[(1.40, 0.50)],
    ),
}
# a cab is a sedan with a roof sign
SPECS['taxi'] = dict(SPECS['sedan'], sign=True)


def _interp(pts, x):
    """z at `x` on a polyline sorted from +x to -x."""
    if x >= pts[0][0]:
        return pts[0][1]
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        if x1 <= x <= x0:
            t = (x0 - x) / (x0 - x1) if x0 != x1 else 0
            return z0 + (z1 - z0) * t
    return pts[-1][1]


def _within(x, spans):
    return any(min(a, b) <= x <= max(a, b) for a, b in spans)


class _Mesh:
    """Faces collected per part, then written out as two Blender objects."""

    def __init__(self):
        self.paint = bmesh.new()
        self.detail = bmesh.new()
        self.col = self.detail.loops.layers.color.new('Col')

    def face(self, pts, part):
        bm = self.paint if part == PAINT else self.detail
        verts = [bm.verts.new(p) for p in pts]
        try:
            f = bm.faces.new(verts)
        except ValueError:
            return None
        if part != PAINT:
            c = DETAIL_COLOURS[part]
            for loop in f.loops:
                loop[self.col] = c
        return f

    def box(self, x0, x1, y0, y1, z0, z1, part):
        v = lambda x, y, z: Vector((x, y, z))
        c = [v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0),
             v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)]
        for idx in ((4, 5, 6, 7), (0, 3, 2, 1), (0, 4, 7, 3), (1, 2, 6, 5), (0, 1, 5, 4), (3, 7, 6, 2)):
            self.face([c[i] for i in idx], part)

    def wheel(self, x, y, r, width, side):
        """Tyre and rim as a prism along y, on the `side` (+1/-1) of the car."""
        n = 12
        rim_r = r * 0.62
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            c0, s0, c1, s1 = math.cos(a0), math.sin(a0), math.cos(a1), math.sin(a1)
            y0, y1 = y - width / 2, y + width / 2
            self.face([Vector((x + r * c0, y0, r + r * s0)), Vector((x + r * c1, y0, r + r * s1)),
                       Vector((x + r * c1, y1, r + r * s1)), Vector((x + r * c0, y1, r + r * s0))], TYRE)
            ye = y1 if side > 0 else y0
            ctr = Vector((x, ye, r))
            self.face([ctr, Vector((x + rim_r * c0, ye, r + rim_r * s0)),
                       Vector((x + rim_r * c1, ye, r + rim_r * s1))] if side > 0 else
                      [ctr, Vector((x + rim_r * c1, ye, r + rim_r * s1)),
                       Vector((x + rim_r * c0, ye, r + rim_r * s0))], RIM)
            self.face([Vector((x + rim_r * c0, ye, r + rim_r * s0)), Vector((x + r * c0, ye, r + r * s0)),
                       Vector((x + r * c1, ye, r + r * s1)), Vector((x + rim_r * c1, ye, r + rim_r * s1))]
                      if side > 0 else
                      [Vector((x + rim_r * c1, ye, r + rim_r * s1)), Vector((x + r * c1, ye, r + r * s1)),
                       Vector((x + r * c0, ye, r + r * s0)), Vector((x + rim_r * c0, ye, r + rim_r * s0))], TYRE)
            yi = y0 if side > 0 else y1   # the hidden inner wall closes the solid
            self.face([Vector((x, yi, r)), Vector((x + r * c1, yi, r + r * s1)), Vector((x + r * c0, yi, r + r * s0))]
                      if side > 0 else
                      [Vector((x, yi, r)), Vector((x + r * c0, yi, r + r * s0)), Vector((x + r * c1, yi, r + r * s1))], TYRE)


def build(kind):
    s = SPECS[kind]
    L, W, clear, wb, wr, belt = s['L'], s['W'], s['clear'], s['wb'], s['wr'], s['belt']
    top = s['top']
    half = W / 2
    m = _Mesh()

    # section positions: the profile's own breakpoints, plus a dense run through each
    # wheel arch so the notch is round
    xs = {round(x, 3) for x, _ in top}
    arch_r = wr * 1.28
    for xw in (wb / 2, -wb / 2):
        for k in range(-7, 8):
            xs.add(round(xw + arch_r * k / 7.0, 3))
    for a, b in s['wind'] + s['rear'] + s['side']:
        xs.add(round(a, 3))
        xs.add(round(b, 3))
    xs = sorted(xs, reverse=True)

    def arch(x, base):
        """z of the lower edge of the side wall at x: the body sill, lifted into an arc at the wheels."""
        z = base
        for xw in (wb / 2, -wb / 2):
            d = abs(x - xw)
            if d < arch_r:
                z = max(z, wr + math.sqrt(arch_r * arch_r - d * d) * 0.92 - 0.02)
        return min(z, belt - 0.12)

    zb = clear + 0.12   # underbody
    rings = []
    for x in xs:
        ztop = _interp(top, x)
        bl = min(belt, ztop)
        # nose and tail pinch in plan, so the ends are rounded rather than slab-sided
        edge = min(L / 2 - abs(x), 0.55)
        w = half * (0.80 + 0.20 * math.sin(edge / 0.55 * math.pi / 2)) if edge < 0.55 else half
        sill = arch(x, zb + 0.10)
        ring = [
            Vector((x, 0, zb)),
            Vector((x, w * 0.85, zb)),
            Vector((x, w, sill)),
            Vector((x, w, max(bl - 0.04, sill + 0.02))),
            Vector((x, w * 0.94, bl)),
            Vector((x, w * 0.72 if ztop > bl + 0.02 else w * 0.88, max(ztop - 0.05, bl))),
            Vector((x, 0, ztop)),
        ]
        rings.append((x, ztop, bl, ring))

    # sweep: quads between successive rings, mirrored; glass above the belt between pillars
    for (xa, za, bla, ra), (xb, zb_, blb, rb) in zip(rings, rings[1:]):
        xm = (xa + xb) / 2
        for sgn in (1, -1):
            for i in range(len(ra) - 1):
                def pt(r, j):
                    v = r[j]
                    return Vector((v.x, v.y * sgn, v.z))
                quad = [pt(ra, i), pt(ra, i + 1), pt(rb, i + 1), pt(rb, i)]
                part = PAINT
                if i == 4 and _within(xm, s['side']):
                    part = GLASS
                if i == 5 and (_within(xm, s['wind']) or _within(xm, s['rear'])):
                    part = GLASS
                if i == 4 and (_within(xm, s['wind']) or _within(xm, s['rear'])):
                    part = GLASS
                # normals out: the sweep runs +x -> -x, so reverse for sgn > 0
                m.face(quad if sgn < 0 else quad[::-1], part)
    # end caps
    for (x, _, _, ring), flip in ((rings[0], False), (rings[-1], True)):
        pts = [Vector(v) for v in ring] + [Vector((v.x, -v.y, v.z)) for v in reversed(ring[1:-1])]
        # drop duplicate centreline verts
        pts = [p for i, p in enumerate(pts) if i == 0 or (p - pts[i - 1]).length > 1e-6]
        m.face(pts if flip else pts[::-1], PAINT)

    # wheels, set into the arches
    for xw in (wb / 2, -wb / 2):
        for side in (1, -1):
            m.wheel(xw, side * (half - 0.20), wr, 0.24, side)
    # bumpers, grille, lamps, mirrors
    nose, tail = L / 2, -L / 2
    m.box(nose - 0.10, nose + 0.03, -half * 0.88, half * 0.88, clear + 0.04, clear + 0.30, TRIM)
    m.box(tail - 0.03, tail + 0.10, -half * 0.88, half * 0.88, clear + 0.04, clear + 0.30, TRIM)
    zh = _interp(top, nose - 0.1) - 0.06
    m.box(nose - 0.12, nose + 0.01, -half * 0.40, half * 0.40, clear + 0.32, clear + 0.50, TRIM)  # grille
    zt = s.get('tz', _interp(top, tail + 0.1) - 0.10)
    if s.get('sign'):
        zr = max(z for _, z in top)
        m.box(-0.30, 0.10, -0.26, 0.26, zr, zr + 0.16, HEAD)
    for sgn in (1, -1):
        m.box(nose - 0.14, nose - 0.01, sgn * half * 0.52, sgn * half * 0.88, zh - 0.12, zh + 0.02, HEAD)
        m.box(tail + 0.01, tail + 0.12, sgn * half * 0.55, sgn * half * 0.92, zt - 0.16, zt - 0.02, TAIL)
        m.box(0.62, 0.78, sgn * (half + 0.08), sgn * (half - 0.04), belt + 0.04, belt + 0.14, PAINT)  # mirror

    out = []
    for name, bm, auto in (('paint', m.paint, True), ('detail', m.detail, True)):
        if not bm.faces:
            continue
        # weld the shared corners so the surface is one connected solid, then let Blender
        # point every face outward
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(f'car-{kind}-{name}')
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(f'{name}', mesh)
        bpy.context.scene.collection.objects.link(obj)
        out.append(obj)
    return out, dict(length=L, width=W, height=max(z for _, z in top),
                     wheelbase=wb, nose=nose, tail=tail,
                     lamp=dict(head=[nose + 0.03, half * 0.7, zh - 0.05], tail=[tail - 0.03, half * 0.74, zt - 0.09]))


# ======================================================================================
# High-detail tier: the same six vehicles again, built for the camera that sails low over
# the street (a few thousand triangles, a real glasshouse and interior, separate wheels)
# ======================================================================================
#
# Four meshes come out of each: `paint` (tinted per instance), `glass` (a sheet inset from
# the body, drawn tinted and see-through so the interior shows), `detail` (everything else,
# vertex-coloured) and `wheel` (one wheel at the origin, axle along y, outer face on +y,
# which the site instances four times and spins). The alpha of `detail`/`wheel` vertex
# colours is not opacity: it carries the material class (see `K_*`), which the runtime
# turns into roughness, metalness and emission per vertex, so one draw call covers rubber,
# chrome, fabric and lamp lenses together.

(K_PLASTIC, K_CHROME, K_RUBBER, K_ALLOY, K_FABRIC, K_HEAD, K_TAIL, K_PLATE, K_DISC,
 K_AMBER, K_GLOSS, K_LINER) = range(12)

# sRGB values; the exporter converts them to linear
HC = dict(
    black=(0.045, 0.047, 0.052), trim=(0.10, 0.105, 0.115), seal=(0.012, 0.013, 0.015),
    liner=(0.05, 0.05, 0.054), under=(0.03, 0.03, 0.032),
    chrome=(0.80, 0.82, 0.85), darkchrome=(0.30, 0.31, 0.34), alloy=(0.66, 0.68, 0.72),
    rubber=(0.065, 0.065, 0.07), disc=(0.38, 0.38, 0.40), caliper=(0.72, 0.07, 0.05),
    seat=(0.22, 0.225, 0.24), dash=(0.12, 0.125, 0.14), liner_roof=(0.52, 0.52, 0.50),
    carpet=(0.15, 0.15, 0.16), head=(1.0, 0.94, 0.78), tail=(0.78, 0.035, 0.025),
    tail_dark=(0.30, 0.02, 0.02), amber=(1.0, 0.52, 0.06), plate=(0.90, 0.90, 0.86),
    ink=(0.05, 0.05, 0.12), gloss=(0.022, 0.028, 0.042), lensclear=(0.86, 0.88, 0.92),
    sign=(1.0, 0.82, 0.45),
)

# per-type extras for the high tier: tyre width and aspect, spokes, plates, equipment
HI = {
    'sedan': dict(tw=0.215, asp=0.55, spokes=7, cab_end=-1.22, seats=2, bench=True, sunroof=True, fin=True,
                  seatc=(0.34, 0.34, 0.36), exhaust=2),
    'hatch': dict(tw=0.195, asp=0.50, spokes=5, cab_end=-1.72, seats=2, bench=True, sunroof=False, fin=True,
                  seatc=(0.40, 0.38, 0.34), exhaust=1, hatchback=True),
    'suv': dict(tw=0.235, asp=0.62, spokes=8, cab_end=-2.24, seats=2, bench=True, sunroof=True, rails=True,
                seatc=(0.50, 0.42, 0.32), exhaust=2, hatchback=True, cladding=True),
    'pickup': dict(tw=0.265, asp=0.70, spokes=6, cab_end=-0.52, seats=2, bench=False, sunroof=False,
                   seatc=(0.30, 0.27, 0.24), exhaust=0, bed=True, cladding=True,
                   top=[(2.65, 0.64), (2.62, 0.92), (2.35, 1.10), (1.60, 1.18), (1.20, 1.22), (0.65, 1.72),
                        (-0.20, 1.74), (-0.55, 1.28), (-0.66, 1.04), (-2.40, 1.02), (-2.58, 1.02)]),
    'van': dict(tw=0.215, asp=0.65, spokes=5, cab_end=-0.05, seats=2, bench=False, sunroof=False,
                seatc=(0.30, 0.30, 0.32), exhaust=0, van=True, cladding=True),
    'taxi': dict(tw=0.215, asp=0.55, spokes=5, cab_end=-1.22, seats=2, bench=True, sunroof=False,
                 seatc=(0.42, 0.40, 0.36), exhaust=1, taxi=True),
}


def _newell(pts):
    n = Vector()
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def _lerp(a, b, t):
    return a + (b - a) * t


def _smooth(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def _pchip(pts):
    """Monotone cubic through (x, z) points sorted by decreasing x: a smooth roofline without overshoot."""
    pts = sorted(pts)
    xs, ys = [], []
    for x, y in pts:
        if xs and x - xs[-1] < 0.004:
            x = xs[-1] + 0.004   # a vertical step in the profile becomes a very steep one
        xs.append(x)
        ys.append(y)
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] > 0:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = max(k for k in range(n - 1) if xs[k] <= x)
        t = (x - xs[i]) / h[i]
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
                + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1])
    return f


class _Hi:
    """Faces collected per output mesh, with solid primitives that orient themselves outward."""

    def __init__(self):
        self.bm = {n: bmesh.new() for n in ('paint', 'detail', 'glass', 'wheel')}
        self.lay = {n: self.bm[n].loops.layers.color.new('Col') for n in ('detail', 'wheel')}

    def tint(self, part, faces, colour, cls):
        lay = self.lay.get(part)
        if lay is None:
            return
        rgba = (colour[0], colour[1], colour[2], (cls + 0.5) / 16)
        for f in faces:
            for lp in f.loops:
                lp[lay] = rgba

    def poly(self, part, pts, colour=None, cls=K_PLASTIC):
        bm = self.bm[part]
        try:
            f = bm.faces.new([bm.verts.new(p) for p in pts])
        except ValueError:
            return None
        self.tint(part, [f], colour, cls)
        return f

    def solid(self, part, loops, colour=None, cls=K_PLASTIC, caps=True, wrap=False, inward=False):
        """A closed solid through a stack of equal-sized vertex loops (a box, cylinder, cone, slab...)."""
        bm = self.bm[part]
        vs = [[bm.verts.new(p) for p in lp] for lp in loops]
        n = len(vs[0])
        cen = sum((p for lp in loops for p in lp), Vector()) / sum(len(lp) for lp in loops)
        centres = [sum(lp, Vector()) / n for lp in loops]
        faces = []

        def add(vl, ref):
            pts = [v.co.copy() for v in vl]
            nrm = _newell(pts)
            if nrm.length < 1e-12:
                return
            try:
                f = bm.faces.new(vl)
            except ValueError:
                return
            c = sum(pts, Vector()) / len(pts)
            if (nrm.dot(c - ref) < 0) != inward:
                f.normal_flip()
            faces.append(f)

        pairs = list(zip(range(len(vs)), range(1, len(vs)))) + ([(len(vs) - 1, 0)] if wrap else [])
        for ia, ib in pairs:
            a, b = vs[ia], vs[ib]
            ref = (centres[ia] + centres[ib]) / 2 if wrap else cen
            for i in range(n):
                add([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]], ref)
        if caps and not wrap:
            add(vs[0], cen)
            add(vs[-1], cen)
        self.tint(part, faces, colour, cls)
        return faces

    def box(self, part, c, h, colour=None, cls=K_PLASTIC, ax=None, taper=1.0, inward=False):
        """Oriented box: centre `c`, half sizes `h`, local axes `ax` (default world), the far end scaled by `taper`."""
        c = Vector(c)
        u, v, w = ax or (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
        hu, hv, hw = h

        def rect(s, k):
            return [c + u * (hu * k * a) + v * (hv * k * b) + w * (hw * s) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        return self.solid(part, [rect(-1, 1.0), rect(1, taper)], colour, cls, inward=inward)

    def cyl(self, part, p0, p1, r0, r1=None, colour=None, cls=K_PLASTIC, n=10, caps=True, inward=False):
        """Cylinder or cone from `p0` to `p1`."""
        p0, p1 = Vector(p0), Vector(p1)
        r1 = r0 if r1 is None else r1
        ax = (p1 - p0).normalized()
        ref = Vector((0, 0, 1)) if abs(ax.z) < 0.9 else Vector((1, 0, 0))
        u = ax.cross(ref).normalized()
        v = ax.cross(u)
        ring = lambda p, r: [p + (u * math.cos(2 * math.pi * i / n) + v * math.sin(2 * math.pi * i / n)) * r for i in range(n)]
        return self.solid(part, [ring(p0, r0), ring(p1, r1)], colour, cls, caps=caps, inward=inward)

    def finish(self, kind):
        out = []
        for name, bm in self.bm.items():
            for v in [v for v in bm.verts if not v.link_faces]:
                bm.verts.remove(v)
            if not bm.faces:
                continue
            mesh = bpy.data.meshes.new(f'car-{kind}-{name}-hi')
            bm.to_mesh(mesh)
            bm.free()
            obj = bpy.data.objects.new(name, mesh)
            bpy.context.scene.collection.objects.link(obj)
            out.append(obj)
        return out


class _Body:
    """The cross-section of one vehicle at any x, so the skin and everything that sits on it share one description."""

    def __init__(self, kind):
        s = SPECS[kind]
        e = HI[kind]
        self.kind, self.s, self.e = kind, s, e
        self.L, self.W, self.clear, self.wb, self.wr, self.belt = s['L'], s['W'], s['clear'], s['wb'], s['wr'], s['belt']
        self.half = self.W / 2
        self.top = e.get('top', s['top'])
        self.Z = _pchip(self.top)
        self.rim = None
        self.bed = (-self.L / 2 + 0.07, -0.66) if e.get('bed') else None
        self.floor = 0.64
        self.tumble = 0.30 if e.get('van') else (0.85 if kind == 'suv' else 1.0)
        self.arch_r = self.wr * 1.27
        self.zu0 = self.clear + 0.06
        self.base = self.zu0 + 0.09
        self.tw = e['tw']
        self.wy = self.half - 0.19          # wheel centre, from the centre line
        self.nose = self.L / 2
        self.tail = self.bed[0] if self.bed else -self.L / 2

    # ---- scalar fields along the body
    def plan(self, x):
        edge = max(self.L / 2 - abs(x), 0.0)
        if self.bed and x < 0:
            return self.half        # a pickup's bed is square at the back
        if edge >= 0.5:
            return self.half
        return self.half * (1 - 0.20 * (1 - edge / 0.5) ** 2.4)

    def edge_at(self, y):
        """Distance in from the nose (or tail) tip at which the plan is |y| wide."""
        r = min(abs(y) / self.half, 1.0)
        if r <= 0.8:
            return 0.0
        return 0.5 * (1 - ((1 - r) / 0.20) ** (1 / 2.4))

    def x_front(self, y):
        return self.nose - self.edge_at(y)

    def x_rear(self, y):
        if self.bed:
            return -self.L / 2
        return -self.L / 2 + self.edge_at(y)

    def zu(self, x):
        edge = max(self.L / 2 - abs(x), 0.0)
        return self.zu0 + 0.13 * max(1 - edge / 0.45, 0.0) ** 2

    def arch(self, x):
        z = self.base
        for xw in (self.wb / 2, -self.wb / 2):
            d = abs(x - xw)
            if d < self.arch_r:
                z = max(z, self.wr + math.sqrt(self.arch_r ** 2 - d * d) * 0.92 - 0.02)
        return min(z, self.belt - 0.14)

    def lift(self, x):
        """0 outside the wheel arches, up to 1 well inside them."""
        return _smooth(0.0, 0.07, self.arch(x) - self.base)

    def ring(self, x):
        """Half cross-section (y >= 0), thirteen rows from the underbody centre over the top to the roof centre."""
        w, zt, zu = self.plan(x), self.Z(x), self.zu(x)
        a, ah = self.lift(x), self.arch(x)
        ah = max(ah, zu + 0.09)
        bed = self.bed is not None and x <= self.bed[1] - 1e-6
        zs = max(min(self.belt, zt - 0.045), ah + 0.05)
        r = [None] * 13
        r[0] = (0.0, zu)
        r[1] = (w - (0.22 + 0.24 * a), zu)
        r[2] = (w - (0.045 + 0.415 * a), _lerp(zu + 0.05, ah, a))
        r[3] = (w * 0.99, ah)
        r[4] = (w, ah + (zs - ah) * 0.42)
        r[5] = (w * 0.996, ah + (zs - ah) * 0.80)
        r[6] = (w * 0.972, zs)
        c = 0.0
        if bed:
            rim = zt
            r[6] = (w * 0.972, rim - 0.05)
            r[7] = (w * 0.975, rim)
            r[8] = (w * 0.915, rim)
            r[9] = (w * 0.91, rim - 0.12)
            r[10] = (w * 0.905, self.floor + 0.06)
            r[11] = (w * 0.5, self.floor)
            r[12] = (0.0, self.floor)
        else:
            c = _smooth(0.0, 0.2, zt - zs - 0.08)
            tum = lambda f: 1 - (1 - f) * self.tumble
            cab = [(tum(0.952), zs + 0.035), (tum(0.912), zs + (zt - zs) * 0.40), (tum(0.80), zt - 0.09),
                   (tum(0.69), zt - 0.035), (tum(0.40), zt - 0.006), (0.0, zt)]
            hood = [(0.99, zs + 0.012), (0.972, zs + 0.028), (0.90, zt - 0.008), (0.70, zt + 0.002),
                    (0.36, zt + 0.007), (0.0, zt + 0.009)]
            for i in range(6):
                r[7 + i] = (_lerp(hood[i][0], cab[i][0], c) * w, _lerp(hood[i][1], cab[i][1], c))
        return dict(pts=[Vector((x, max(y, 0.0), z)) for y, z in r], c=c, a=a, bed=bed, zs=zs, zt=zt, w=w)

    # ---- lookups on the surface, for fitting parts to it
    def side_y(self, x, z):
        """Lateral position of the left flank at height z (rows 3..7)."""
        p = self.ring(x)['pts']
        for i in range(3, 7):
            if p[i].z <= z <= p[i + 1].z:
                t = (z - p[i].z) / max(p[i + 1].z - p[i].z, 1e-6)
                return _lerp(p[i].y, p[i + 1].y, t)
        return p[4].y if z < p[3].z else p[7].y

    def top_z(self, x, y):
        """Height of the upper surface at lateral position y (rows 8..12; roof, hood or deck)."""
        p = self.ring(x)['pts']
        for i in range(8, 12):
            if p[i + 1].y <= y <= p[i].y:
                t = (p[i].y - y) / max(p[i].y - p[i + 1].y, 1e-6)
                return _lerp(p[i].z, p[i + 1].z, t)
        return p[8].z if y > p[8].y else p[12].z

    def cabin(self, x):
        return self.ring(x)['c']


def _sections(B):
    """x positions of the cross-sections: the roofline's breakpoints, a dense run through each wheel arch, the glazing edges and the ends."""
    s = B.s
    xs = {round(x, 3) for x, _ in B.top}
    for xw in (B.wb / 2, -B.wb / 2):
        for k in range(-7, 8):
            xs.add(round(xw + B.arch_r * 1.04 * k / 7.0, 3))
    for a, b in s['wind'] + s['rear'] + s['side']:
        xs.add(round(a, 3))
        xs.add(round(b, 3))
    for d in (0.02, 0.07, 0.14, 0.23, 0.34, 0.47):
        xs.add(round(B.nose - d, 3))
        xs.add(round(B.tail + d, 3))
    if B.bed:
        xs.add(round(B.bed[1] - 0.006, 3))
        xs.add(round(B.bed[1], 3))
    xs = sorted((x for x in xs if B.tail - 1e-6 <= x <= B.nose + 1e-6), reverse=True)
    out = []
    for x in xs:
        if out and out[-1] - x < 0.014 and not (B.bed and abs(out[-1] - B.bed[1]) < 0.01):
            continue
        out.append(x)
    out[0], out[-1] = B.nose, B.tail
    return out


def _cell_part(B, ia, ib, xm, j):
    """What a patch of the skin is: paint, glass or a dark detail (underbody, wheel liner, bed liner)."""
    s = B.s
    row = j if j < 12 else 23 - j
    c, a = (ia['c'] + ib['c']) / 2, (ia['a'] + ib['a']) / 2
    if row == 0:
        return 'detail', HC['under'], K_LINER
    if row in (1, 2) and a > 0.45:
        return 'detail', HC['liner'], K_LINER
    if ia['bed'] and ib['bed']:
        if row >= 8:
            return 'detail', HC['liner'], K_LINER
        return 'paint', None, None
    if row in (7, 8) and c > 0.6 and _within(xm, s['side']):
        return 'glass', None, None
    if row in (10, 11) and (_within(xm, s['wind']) or _within(xm, s['rear'])):
        return 'glass', None, None
    return 'paint', None, None


def _skin(B, h):
    """Loft the body shell; returns the sections for the parts that fit onto it."""
    xs = _sections(B)
    infos = [B.ring(x) for x in xs]
    rings = []
    for info in infos:
        p = info['pts']
        rings.append(p + [Vector((q.x, -q.y, q.z)) for q in p[11:0:-1]])      # 24 points around
    S, J = len(xs), 24
    # a scratch copy of the whole closed surface, for vertex normals
    tmp = bmesh.new()
    tv = [[tmp.verts.new(p) for p in r] for r in rings]
    tf = {}
    for si in range(S - 1):
        for j in range(J):
            j2 = (j + 1) % J
            try:
                tf[si, j] = tmp.faces.new([tv[si][j], tv[si][j2], tv[si + 1][j2], tv[si + 1][j]])
            except ValueError:
                pass
    tmp.normal_update()
    # the winding must make the left flank face +y; test one flank cell and flip everything if not
    mid = S // 2
    flip = tf[mid, 5].normal.y < 0
    if flip:
        for f in tf.values():
            f.normal_flip()
        tmp.normal_update()
    nrm = [[v.normal.copy() for v in row] for row in tv]
    tmp.free()

    paint, glass, detail = h.bm['paint'], h.bm['glass'], h.bm['detail']
    pv = [[paint.verts.new(p) for p in r] for r in rings]
    gv = [[None] * J for _ in range(S)]

    def gvert(si, j):
        if gv[si][j] is None:
            gv[si][j] = glass.verts.new(rings[si][j] - nrm[si][j] * 0.016)
        return gv[si][j]

    kinds = {}
    for si in range(S - 1):
        xm = (xs[si] + xs[si + 1]) / 2
        for j in range(J):
            kinds[si, j] = _cell_part(B, infos[si], infos[si + 1], xm, j)

    def quad(vs, flipped):
        return vs[::-1] if flipped else vs

    for si in range(S - 1):
        for j in range(J):
            j2 = (j + 1) % J
            part, col, cls = kinds[si, j]
            a, b = rings[si], rings[si + 1]
            if (a[j] - a[j2]).length < 1e-6 and (b[j] - b[j2]).length < 1e-6:
                continue
            if part == 'paint':
                vl = [pv[si][j], pv[si][j2], pv[si + 1][j2], pv[si + 1][j]]
                try:
                    paint.faces.new(quad(vl, flip))
                except ValueError:
                    pass
            elif part == 'detail':
                h.poly('detail', quad([a[j], a[j2], b[j2], b[j]], flip), col, cls)
            else:
                vl = [gvert(si, j), gvert(si, j2), gvert(si + 1, j2), gvert(si + 1, j)]
                try:
                    glass.faces.new(quad(vl, flip))
                except ValueError:
                    pass
                # the black seal around the window: a reveal wherever the neighbour is not glass
                cen = (rings[si][j] + rings[si][j2] + rings[si + 1][j] + rings[si + 1][j2]) / 4
                edges = [((si, (j - 1) % J), (si, j), (si + 1, j)),
                         ((si, (j + 1) % J), (si, j2), (si + 1, j2)),
                         ((si - 1, j), (si, j), (si, j2)),
                         ((si + 1, j), (si + 1, j), (si + 1, j2))]
                for nb, e0, e1 in edges:
                    if nb[0] < 0 or nb[0] >= S - 1 or kinds[nb][0] == 'glass':
                        continue
                    p0, p1 = rings[e0[0]][e0[1]], rings[e1[0]][e1[1]]
                    q0, q1 = gvert(*e0), gvert(*e1)
                    pts = [p0, p1, q1.co.copy(), q0.co.copy()]
                    n = _newell(pts)
                    if n.dot(cen - sum(pts, Vector()) / 4) < 0:
                        pts = pts[::-1]
                    h.poly('detail', pts, HC['seal'], K_PLASTIC)

    # end caps: the whole ring as one polygon
    for si, direction in ((0, 1), (S - 1, -1)):
        pts = [pv[si][j] for j in range(J)]
        pts = [p for i, p in enumerate(pts) if i == 0 or (p.co - pts[i - 1].co).length > 1e-6]
        n = _newell([p.co for p in pts])
        if n.x * direction < 0:
            pts = pts[::-1]
        try:
            paint.faces.new(pts)
        except ValueError:
            pass
    return dict(xs=xs, infos=infos, rings=rings, flip=flip)


def _wheel(B, h):
    """One wheel at the origin, axle on y, outer face on +y: tyre with sidewall and shoulder, alloy rim, spokes, hub and disc."""
    r_out, tw = B.wr, B.tw
    sw = tw * B.e['asp']
    r_rim = r_out - sw
    N = 16
    half = [(r_rim, .40), (r_rim + .32 * sw, .49), (r_out - .09 * sw, .41), (r_out, .27), (r_out, .19),
            (r_out, .15), (r_out, .09)]
    prof = [(r, y * tw) for r, y in half] + [(r, -y * tw) for r, y in reversed(half)]
    r_mid = (r_rim + r_out) / 2

    def spin(prof_):
        faces = []
        bm = h.bm['wheel']
        vs = [[bm.verts.new((r * math.cos(2 * math.pi * k / N), y, r * math.sin(2 * math.pi * k / N))) for r, y in prof_]
              for k in range(N)]
        for k in range(N):
            k2 = (k + 1) % N
            for i in range(len(prof_) - 1):
                try:
                    f = bm.faces.new([vs[k][i], vs[k][i + 1], vs[k2][i + 1], vs[k2][i]])
                except ValueError:
                    continue
                f.index = i        # which row of the profile, for colouring
                faces.append(f)
        return faces

    # tyre: faces point away from the middle of the tube; the two tread grooves are rows of their own
    faces = spin(prof)
    for f in faces:
        c = f.calc_center_median()
        radial = Vector((c.x, 0, c.z)).normalized()
        if f.normal.dot(c - radial * r_mid) < 0:
            f.normal_flip()
    h.tint('wheel', faces, HC['rubber'], K_RUBBER)
    groove = len(half) - 3
    h.tint('wheel', [f for f in faces if f.index in (groove, len(prof) - 2 - groove)], (0.012, 0.012, 0.014), K_RUBBER)
    # rim lip and barrel, seen from outside: faces point out along +y, then in toward the axle
    rp = [(r_rim + .004, .40 * tw), (r_rim - .012, .435 * tw), (r_rim - .030, .40 * tw), (r_rim - .034, .14 * tw)]
    faces = spin(rp)
    for f in faces:
        c = f.calc_center_median()
        radial = Vector((c.x, 0, c.z)).normalized()
        n = f.normal
        # the lip faces +y; the barrel wall (|n.y| small) faces the axle
        if abs(n.y) > 0.5:
            if n.y < 0:
                f.normal_flip()
        elif n.dot(radial) > 0:
            f.normal_flip()
    h.tint('wheel', faces, HC['alloy'], K_ALLOY)
    # spokes
    S = B.e['spokes']
    r_hub, r_s1 = 0.05, r_rim - 0.03
    for k in range(S):
        phi = 2 * math.pi * k / S + 0.2
        d = Vector((math.cos(phi), 0, math.sin(phi)))
        e = Vector((-math.sin(phi), 0, math.cos(phi)))
        yv = Vector((0, 1, 0))

        def loop(r, w, y, t):
            c = d * r + yv * y
            return [c + e * (w * a) + yv * (t * b) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        h.solid('wheel', [loop(r_hub, 0.026, 0.27 * tw, 0.014), loop(r_s1, 0.034, 0.40 * tw, 0.014)], HC['alloy'], K_ALLOY)
    # hub cap, brake disc
    h.cyl('wheel', (0, 0.22 * tw, 0), (0, 0.31 * tw, 0), 0.058, 0.05, HC['chrome'], K_CHROME, n=10)
    h.cyl('wheel', (0, 0.10 * tw, 0), (0, 0.10 * tw + 0.024, 0), (r_rim - 0.034) * 0.9, colour=HC['disc'], cls=K_DISC, n=N)


def _calipers(B, h):
    """The brake caliper straddling each disc: it stays with the body while the wheel turns."""
    r_rim, tw = B.wr - tw_sw(B), B.tw
    for xw in (B.wb / 2, -B.wb / 2):
        for side in (1, -1):
            yc = side * (B.wy + 0.10 * tw + 0.012)
            phi = math.radians(18) if xw > 0 else math.radians(162)
            d = Vector((math.cos(phi), 0, math.sin(phi)))
            c = Vector((xw, yc, B.wr)) + d * ((r_rim - 0.034) * 0.72)
            e = Vector((-math.sin(phi), 0, math.cos(phi)))
            h.box('detail', c, (0.044, 0.026, 0.075), HC['caliper'], K_PLASTIC,
                  ax=(e, Vector((0, 1, 0)), d))


def tw_sw(B):
    return B.tw * B.e['asp']


X, Y, Zv = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def _rot_y(a):
    """Axes of a box pitched by `a` radians about y (nose up for a > 0)."""
    c, s = math.cos(a), math.sin(a)
    return Vector((c, 0, s)), Y, Vector((-s, 0, c))


def _ribbon(h, part, rows, colour, cls, up=None):
    """A thin strip through a list of point pairs (left edge, right edge), faced toward `up`."""
    for (a0, b0), (a1, b1) in zip(rows, rows[1:]):
        pts = [Vector(a0), Vector(a1), Vector(b1), Vector(b0)]
        if up is not None and _newell(pts).dot(up) < 0:
            pts = pts[::-1]
        h.poly(part, pts, colour, cls)


def _slab(B, h, part, front, y0, y1, z0, z1, off, depth, colour, cls, n=5):
    """A plate that follows the rounded nose (or tail) plan between two lateral positions, standing `off` proud of it."""
    d = 1 if front else -1
    loops = []
    for k in range(n):
        y = y0 + (y1 - y0) * k / (n - 1)
        x = B.x_front(y) if front else B.x_rear(y)
        loops.append([Vector((x + d * off, y, z0)), Vector((x + d * off, y, z1)),
                      Vector((x - d * depth, y, z1)), Vector((x - d * depth, y, z0))])
    return h.solid(part, loops, colour, cls)


def _plate(B, h, front, y, z):
    """A licence plate (52 x 11 cm) with a few characters, on the nose or tail."""
    x = (B.x_front(0) + 0.016) if front else (B.x_rear(0) - 0.016)
    d = 1 if front else -1
    h.box('detail', (x - d * 0.006, y, z), (0.006, 0.26, 0.057), HC['plate'], K_PLATE)
    h.box('detail', (x - d * 0.006, y, z), (0.0065, 0.262, 0.059), HC['black'], K_PLASTIC, taper=1.0)
    h.box('detail', (x - d * 0.003, y, z), (0.0066, 0.254, 0.051), HC['plate'], K_PLATE)
    for k in range(6):
        yy = y + (k - 2.5) * 0.072
        h.box('detail', (x + d * 0.0006, yy, z), (0.0035, 0.015, 0.027), HC['ink'], K_PLASTIC)


def _front_end(B, h):
    n, half, zu = B.nose, B.half, B.zu0
    e = B.e
    zl = B.Z(n - 0.06)
    for sg in (1, -1):
        y0, y1 = sg * 0.46, sg * min(half * 0.90, half - 0.07)
        ya, yb = (y0, y1)
        # headlamp: dark bezel, clear lens, projector and daylight strip
        _slab(B, h, 'detail', True, ya, yb, zl - 0.20, zl - 0.035, 0.010, 0.05, HC['darkchrome'], K_CHROME)
        _slab(B, h, 'detail', True, ya + sg * 0.012, yb - sg * 0.012, zl - 0.185, zl - 0.05, 0.019, 0.05, HC['lensclear'], K_HEAD)
        yp = (ya + yb) / 2 - sg * 0.02
        xp = B.x_front(yp)
        h.cyl('detail', (xp - 0.02, yp, zl - 0.115), (xp + 0.017, yp, zl - 0.115), 0.036, 0.04, HC['chrome'], K_CHROME, n=10)
        _slab(B, h, 'detail', True, ya + sg * 0.02, yb - sg * 0.02, zl - 0.062, zl - 0.052, 0.022, 0.03, HC['head'], K_HEAD, n=4)
        _slab(B, h, 'detail', True, yb - sg * 0.07, yb - sg * 0.012, zl - 0.185, zl - 0.15, 0.022, 0.03, HC['amber'], K_AMBER, n=3)
        # fog lamp and corner intake in the bumper
        yf = sg * min(half * 0.70, 0.66)
        xf = B.x_front(yf)
        zf = zu + 0.15
        h.cyl('detail', (xf - 0.03, yf, zf), (xf + 0.014, yf, zf), 0.048, 0.05, HC['black'], K_PLASTIC, n=10)
        h.cyl('detail', (xf - 0.01, yf, zf), (xf + 0.02, yf, zf), 0.034, 0.035, HC['lensclear'], K_HEAD, n=10)
    # grille: frame, dark mesh, slats and a badge
    yg = 0.43
    zg0, zg1 = zl - 0.215, zl - 0.045
    _slab(B, h, 'detail', True, -yg, yg, zg0, zg1, 0.014, 0.05, HC['chrome'], K_CHROME, n=3)
    _slab(B, h, 'detail', True, -yg + 0.02, yg - 0.02, zg0 + 0.015, zg1 - 0.015, 0.018, 0.05, HC['black'], K_GLOSS, n=3)
    for k in range(4):
        z = zg0 + 0.03 + (zg1 - zg0 - 0.06) * (k + 0.5) / 4
        _slab(B, h, 'detail', True, -yg + 0.03, yg - 0.03, z - 0.006, z + 0.006, 0.026, 0.03, HC['darkchrome'], K_CHROME, n=2)
    h.box('detail', (B.nose - 0.006, 0, (zg0 + zg1) / 2), (0.014, 0.045, 0.02), HC['chrome'], K_CHROME)
    # lower intake and splitter
    _slab(B, h, 'detail', True, -0.62, 0.62, zu + 0.045, zu + 0.165, 0.012, 0.05, HC['black'], K_GLOSS, n=5)
    for k in range(3):
        z = zu + 0.07 + 0.035 * k
        _slab(B, h, 'detail', True, -0.58, 0.58, z - 0.005, z + 0.005, 0.02, 0.03, HC['trim'], K_PLASTIC, n=5)
    _slab(B, h, 'detail', True, -(half - 0.12), half - 0.12, zu - 0.01, zu + 0.04, 0.03, 0.06, HC['black'], K_PLASTIC, n=7)
    _plate(B, h, True, 0.0, zu + 0.255)


def _rear_end(B, h):
    tail, half, zu = B.tail, B.half, B.zu0
    e = B.e
    zr = B.s.get('tz', B.Z(tail + 0.1) - 0.10)
    if B.bed:
        zr = 0.88
        tail = -B.L / 2
    van = e.get('van')
    for sg in (1, -1):
        if van:
            ya, yb, za, zb = sg * 0.60, sg * 0.96, 0.60, 1.30
            _slab(B, h, 'detail', False, ya, yb, za, zb, 0.012, 0.05, HC['tail_dark'], K_PLASTIC, n=9)
            _slab(B, h, 'detail', False, sg * 0.62, sg * 0.86, 0.88, 1.14, 0.02, 0.05, HC['tail'], K_TAIL, n=6)
            _slab(B, h, 'detail', False, sg * 0.62, sg * 0.86, 0.74, 0.84, 0.02, 0.05, HC['amber'], K_AMBER, n=6)
            _slab(B, h, 'detail', False, sg * 0.62, sg * 0.86, 0.64, 0.70, 0.02, 0.05, HC['lensclear'], K_PLATE, n=6)
            continue
        ya, yb = sg * 0.50, sg * min(half * 0.93, half - 0.04)
        za, zb = zr - 0.17, zr + 0.01
        _slab(B, h, 'detail', False, ya, yb, za, zb, 0.010, 0.05, HC['tail_dark'], K_PLASTIC)
        _slab(B, h, 'detail', False, ya + sg * 0.012, yb - sg * 0.07, za + 0.045, zb - 0.014, 0.017, 0.05, HC['tail'], K_TAIL)
        _slab(B, h, 'detail', False, yb - sg * 0.068, yb - sg * 0.012, za + 0.09, zb - 0.014, 0.017, 0.05, HC['amber'], K_AMBER, n=3)
        _slab(B, h, 'detail', False, yb - sg * 0.068, yb - sg * 0.012, za + 0.014, za + 0.07, 0.017, 0.05, HC['lensclear'], K_PLATE, n=3)
        _slab(B, h, 'detail', False, ya + sg * 0.012, yb - sg * 0.07, za + 0.012, za + 0.04, 0.017, 0.05, HC['tail'], K_TAIL)
    # bumper, plate, exhaust
    if not B.bed:
        _slab(B, h, 'detail', False, -(half - 0.12), half - 0.12, zu - 0.01, zu + 0.09, 0.03, 0.06, HC['black'], K_PLASTIC, n=7)
    else:
        h.box('detail', (tail - 0.07, 0, zu + 0.07), (0.07, half - 0.12, 0.085), HC['black'], K_PLASTIC)
    zp = zu + (0.30 if not (e.get('hatchback') or B.bed or van) else 0.34)
    if B.bed:
        zp = zu + 0.38
    _plate(B, h, False, 0.0, zp)
    for k in range(e.get('exhaust', 0)):
        y = (0.56 if e.get('exhaust') == 2 else 0.5) * (1 if k == 0 else -1)
        x0 = B.x_rear(y)
        h.cyl('detail', (x0 + 0.04, y, zu + 0.04), (x0 - 0.11, y, zu + 0.04), 0.038, 0.04, HC['chrome'], K_CHROME, n=10)
        h.cyl('detail', (x0 - 0.108, y, zu + 0.04), (x0 - 0.114, y, zu + 0.04), 0.031, 0.031, HC['black'], K_PLASTIC, n=10)
    # third brake light
    if e.get('hatchback') or B.bed:
        xr = B.tail + 0.2 if not B.bed else -0.36
        zrr = B.top_z(xr, 0) if not B.bed else B.Z(-0.36)
        h.box('detail', (xr - 0.012, 0, zrr - 0.02), (0.012, 0.22, 0.014), HC['tail'], K_TAIL, ax=_rot_y(math.radians(-18)))


def _side_details(B, h):
    s, e = B.s, B.e
    sx = s['side']
    # door shut lines: dark strips on the flank, plus a chrome beltline
    front_door = (sx[0][0] + 0.10)
    if len(sx) > 1:
        b_pillar = (sx[0][1] + sx[1][0]) / 2
        rear_door = sx[1][1] - 0.10
        lines = [front_door, b_pillar, rear_door]
    else:
        lines = [front_door, sx[0][1] - 0.05]
    if e.get('van'):
        lines = [1.50, 0.45, -0.55, -1.85]
    for sg in (1, -1):
        for xl in lines:
            ra, rb = B.ring(xl + 0.006)['pts'], B.ring(xl - 0.006)['pts']
            rows = [((xl + 0.006, sg * (ra[i].y + 0.0035), ra[i].z), (xl - 0.006, sg * (rb[i].y + 0.0035), rb[i].z))
                    for i in range(3, 8)]
            _ribbon(h, 'detail', rows, HC['seal'], K_PLASTIC, up=Y * sg)
        # chrome beltline under the glass
        xa, xb = sx[0][0] - 0.05, sx[-1][1] + 0.05
        rows = []
        for k in range(16):
            x = _lerp(xa, xb, k / 15)
            p = B.ring(x)['pts'][7]
            if B.ring(x)['c'] < 0.6:
                continue
            y = sg * (p.y + 0.003)
            rows.append(((x, y, p.z - 0.004), (x, y, p.z + 0.010)))
        _ribbon(h, 'detail', rows, HC['chrome'], K_CHROME, up=Y * sg)
        # door handles and mirrors
        hx = [lines[0] - 0.30, lines[1] - 0.30] if len(lines) > 2 else [lines[0] - 0.30]
        if e.get('van'):
            hx = [0.62, -0.82]
        for xh in hx:
            zh = min(B.belt, B.Z(xh) - 0.06) - 0.10
            y = sg * (B.side_y(xh, zh) + 0.012)
            h.box('detail', (xh, y, zh), (0.085, 0.014, 0.013), HC['chrome'], K_CHROME)
        xm = s['wind'][0][1] - 0.02
        zm = B.belt + (0.11 if e.get('van') else 0.05)
        ym = sg * (B.half + (0.09 if e.get('van') else 0.03))
        h.box('detail', (xm, sg * (B.half - 0.03), zm - 0.035), (0.014, 0.07, 0.010), HC['black'], K_PLASTIC)
        h.box('paint', (xm, ym, zm), (0.085, 0.060, 0.046), None, taper=0.85)
        h.box('detail', (xm - 0.087, ym, zm), (0.004, 0.052, 0.038), HC['darkchrome'], K_CHROME)
        if e.get('cladding'):
            ya = B.arch_r * 1.04
            for xw in (B.wb / 2, -B.wb / 2):
                rows = []
                for k in range(12):
                    x = xw - ya + 2 * ya * k / 11
                    ah = max(B.arch(x), B.zu(x) + 0.09)
                    if ah <= B.base + 0.01:
                        continue
                    y0 = sg * (B.side_y(x, ah + 0.002) + 0.012)
                    y1 = sg * (B.side_y(x, ah + 0.05) + 0.012)
                    rows.append(((x, y0, ah + 0.002), (x, y1, ah + 0.05)))
                _ribbon(h, 'detail', rows, HC['black'], K_PLASTIC, up=Y * sg)
            x0, x1 = -B.wb / 2 + B.arch_r * 1.05, B.wb / 2 - B.arch_r * 1.05
            rows = []
            for k in range(6):
                x = _lerp(x0, x1, k / 5)
                za = B.base
                rows.append(((x, sg * (B.side_y(x, za + 0.004) + 0.012), za), (x, sg * (B.side_y(x, za + 0.12) + 0.012), za + 0.12)))
            _ribbon(h, 'detail', rows, HC['black'], K_PLASTIC, up=Y * sg)
        else:
            x0, x1 = -B.wb / 2 + B.arch_r * 1.05, B.wb / 2 - B.arch_r * 1.05
            rows = []
            for k in range(6):
                x = _lerp(x0, x1, k / 5)
                za = B.base
                rows.append(((x, sg * (B.side_y(x, za + 0.004) + 0.006), za), (x, sg * (B.side_y(x, za + 0.07) + 0.006), za + 0.07)))
            _ribbon(h, 'detail', rows, HC['black'], K_PLASTIC, up=Y * sg)


def _top_details(B, h):
    """Panel lines on the hood and deck, the cowl, wipers, sunroof, antenna and roof rails."""
    e, s = B.e, B.s
    xc = s['wind'][0][1]

    def line(x0, x1, y, w=0.006, n=12):
        rows = []
        for k in range(n):
            x = _lerp(x0, x1, k / (n - 1))
            rows.append(((x, y - w, B.top_z(x, abs(y - w)) + 0.003), (x, y + w, B.top_z(x, abs(y + w)) + 0.003)))
        _ribbon(h, 'detail', rows, HC['seal'], K_PLASTIC, up=Zv)
    for sg in (1, -1):
        line(B.nose - 0.16, xc + 0.04, sg * B.half * 0.80)
        if B.kind in ('sedan', 'taxi'):
            line(s['rear'][0][0] - 0.03, B.tail + 0.12, sg * B.half * 0.78, n=8)
    # cowl: the dark strip at the foot of the screen, and a pair of wipers lying across the glass
    rows = []
    for k in range(9):
        y = B.half * 0.70 * (k / 4 - 1)
        rows.append(((xc + 0.085, y, B.top_z(xc + 0.085, abs(y)) + 0.003), (xc + 0.015, y, B.top_z(xc + 0.015, abs(y)) + 0.003)))
    _ribbon(h, 'detail', rows, HC['black'], K_PLASTIC, up=Zv)
    xw = xc - 0.12
    pitch = math.atan2(B.top_z(xw - 0.05, 0) - B.top_z(xw + 0.05, 0), -0.10)
    for sg, yc in ((1, 0.30), (-1, -0.30)):
        h.box('detail', (xw, yc, B.top_z(xw, abs(yc)) + 0.012), (0.008, 0.27, 0.007), HC['black'], K_PLASTIC, ax=_rot_y(-pitch))
    if e.get('sunroof') and not e.get('taxi'):
        x0, x1 = (-0.55, 0.0) if B.kind == 'sedan' else (-0.55, 0.15)
        ys = [-0.40 * B.half + 0.8 * B.half * k / 4 for k in range(5)]
        loops = []
        for y in ys:
            z0 = B.top_z(x0, y)
            z1 = B.top_z(x1, y)
            loops.append([Vector((x0, y, z0 + 0.003)), Vector((x1, y, z1 + 0.003)), Vector((x1, y, z1 - 0.02)), Vector((x0, y, z0 - 0.02))])
        h.solid('detail', loops, HC['gloss'], K_GLOSS)
    if e.get('fin'):
        xf = -0.80 if B.kind == 'sedan' else -0.9
        zf = B.top_z(xf, 0)
        h.box('detail', (xf, 0, zf + 0.03), (0.07, 0.012, 0.03), HC['black'], K_PLASTIC, taper=0.4)
    if e.get('rails'):
        for sg in (1, -1):
            y = sg * B.half * 0.60
            xa, xb = 0.15, s['rear'][0][0] + 0.55
            za, zb = B.top_z(xa, abs(y)) + 0.042, B.top_z(xb, abs(y)) + 0.042
            h.cyl('detail', (xa, y, za), (xb, y, zb), 0.014, colour=HC['darkchrome'], cls=K_CHROME, n=6)
            for xs_ in (xa - 0.02, xb + 0.02, (xa + xb) / 2):
                zr = B.top_z(xs_, abs(y))
                h.box('detail', (xs_, y, (zr + za) / 2), (0.02, 0.014, (za - zr) / 2 + 0.004), HC['black'], K_PLASTIC)


def _torus(h, part, c, a, b, R, r, colour, cls, n=14, m=6):
    """A ring of radius `R` and tube radius `r`, in the plane spanned by unit vectors a and b through `c`."""
    nrm = a.cross(b)
    loops = []
    for k in range(n):
        phi = 2 * math.pi * k / n
        rad = a * math.cos(phi) + b * math.sin(phi)
        ctr = c + rad * R
        loops.append([ctr + (rad * math.cos(2 * math.pi * i / m) + nrm * math.sin(2 * math.pi * i / m)) * r for i in range(m)])
    h.solid(part, loops, colour, cls, wrap=True)


def _interior(B, h, skin):
    """What shows through the glass: a headlined shell, dash, steering wheel, seats and console."""
    e, s = B.e, B.s
    xc, xe = s['wind'][0][1], e['cab_end']
    zf = B.zu0 + 0.17
    belt = B.belt
    # the shell: a coarse inward-facing copy of the cabin skin
    xs = [x for x in skin['xs'] if xe - 1e-6 <= x <= xc + 1e-6]
    pick = xs[::3]
    if pick[-1] != xs[-1]:
        pick.append(xs[-1])

    def inner(x):
        p = B.ring(x)['pts']
        out = [(0.0, zf), (p[3].y - 0.10, zf)]
        for r, dy, dz in ((4, .07, 0), (6, .065, 0), (8, .06, 0), (9, .06, .03), (10, .05, .05), (11, .04, .055)):
            out.append((max(p[r].y - dy, 0.02), p[r].z - dz))
        out.append((0.0, p[12].z - 0.055))
        return out
    rows = []
    for x in pick:
        hf = inner(x)
        rows.append([Vector((x, y, z)) for y, z in hf] + [Vector((x, -y, z)) for y, z in hf[-2:0:-1]])
    J = len(rows[0])
    for ra, rb in zip(rows, rows[1:]):
        for j in range(J):
            j2 = (j + 1) % J
            pts = [ra[j], ra[j2], rb[j2], rb[j]]
            if (ra[j] - ra[j2]).length < 1e-6 and (rb[j] - rb[j2]).length < 1e-6:
                continue
            cen = sum(pts, Vector()) / 4
            ref = Vector((cen.x, 0, (zf + B.Z(cen.x)) / 2))
            if _newell(pts).dot(ref - cen) < 0:
                pts = pts[::-1]
            row = j if j < J // 2 + 1 else J - j
            up = row >= 6
            h.poly('detail', pts, HC['liner_roof'] if up else (HC['carpet'] if row <= 1 else HC['seat']), K_FABRIC)
    for ring_, d in ((rows[0], -1), (rows[-1], 1)):
        pts = [p for i, p in enumerate(ring_) if i == 0 or (p - ring_[i - 1]).length > 1e-6]
        if _newell(pts).x * d < 0:
            pts = pts[::-1]
        h.poly('detail', pts, HC['seat'], K_FABRIC)

    # dash, cluster, wheel and column
    wc = B.ring(xc - 0.3)['pts'][4].y - 0.09
    prof = [(xc + 0.03, belt - 0.20), (xc + 0.03, belt), (xc - 0.20, belt + 0.008), (xc - 0.46, belt - 0.07),
            (xc - 0.52, belt - 0.15), (xc - 0.38, belt - 0.30), (xc - 0.15, zf + 0.04)]
    h.solid('detail', [[Vector((x, -wc, z)) for x, z in prof], [Vector((x, wc, z)) for x, z in prof]], HC['dash'], K_PLASTIC)
    dy = 0.38 if B.W > 1.8 else 0.36
    h.box('detail', (xc - 0.40, dy, belt - 0.03), (0.07, 0.20, 0.045), HC['dash'], K_PLASTIC)
    h.box('detail', (xc - 0.33, 0.0, belt - 0.02), (0.05, 0.14, 0.05), HC['black'], K_GLOSS)        # centre screen
    tilt = math.radians(24)
    nrm = Vector((-math.cos(tilt), 0, math.sin(tilt)))
    up = Vector((math.sin(tilt), 0, math.cos(tilt)))
    hub = Vector((xc - 0.52, dy, belt - 0.16))
    _torus(h, 'detail', hub, Y, up, 0.17, 0.0165, HC['black'], K_PLASTIC)
    for ang in (math.pi / 2, math.pi * 1.2, math.pi * 1.8):
        d = Y * math.cos(ang) + up * math.sin(ang)
        h.box('detail', hub + d * 0.085, (0.085, 0.012, 0.01), HC['black'], K_PLASTIC, ax=(d, nrm, d.cross(nrm)))
    h.cyl('detail', hub + nrm * 0.004, hub - nrm * 0.02, 0.04, colour=HC['black'], cls=K_PLASTIC, n=8)
    h.cyl('detail', hub - nrm * 0.1, hub + nrm * 0.0 + Vector((0.12, 0, -0.1)), 0.03, colour=HC['dash'], cls=K_PLASTIC, n=6)

    # seats: cushion, reclined back and headrest; a bench behind
    sx = xc - 0.95
    sz = belt - 0.42
    lean = _rot_y(math.radians(-14))

    def seat(x, y, hw):
        h.box('detail', (x, y, sz - 0.07), (0.26, hw, 0.07), e['seatc'], K_FABRIC)
        h.box('detail', (x - 0.30, y, sz + 0.26), (0.055, hw, 0.29), e['seatc'], K_FABRIC, ax=lean)
        return x - 0.37, y

    def headrest(x, y):
        z = min(sz + 0.62, B.top_z(x, 0) - 0.13)           # never through the glass
        h.box('detail', (x - 0.02, y, z), (0.035, 0.085, 0.065), e['seatc'], K_FABRIC, ax=lean)
    for sgn in (1, -1):
        x, y = seat(sx, sgn * dy, 0.23)
        headrest(x, y)
    h.box('detail', (sx + 0.12, 0, zf + 0.12), (0.26, 0.095, 0.11), HC['dash'], K_PLASTIC)        # console
    h.cyl('detail', (sx + 0.26, 0, zf + 0.23), (sx + 0.26, 0, zf + 0.34), 0.012, 0.02, HC['black'], K_PLASTIC, n=6)
    if e.get('bench'):
        bx = sx - 0.80
        wb_ = min(B.ring(bx)['pts'][4].y - 0.20, 0.62)
        x, y = seat(bx, 0, wb_)
        for yy in (-0.38, 0.0, 0.38):
            headrest(x, yy)


def _type_parts(B, h):
    """What only some vehicles carry: a taxi's sign and checks, a van's ribs and rear doors, a pickup's bed and tailgate."""
    e, s = B.e, B.s
    if e.get('taxi'):
        xs_ = -0.20
        zr = B.top_z(xs_, 0)
        h.box('detail', (xs_, 0, zr + 0.075), (0.15, 0.30, 0.07), (0.93, 0.93, 0.90), K_PLASTIC, taper=0.94)
        for sg in (1, -1):
            h.box('detail', (xs_ + sg * 0.1485, 0, zr + 0.075), (0.003, 0.275, 0.05), HC['sign'], K_HEAD)
            for k, wd in enumerate((0.045, 0.05, 0.05, 0.03)):
                h.box('detail', (xs_ + sg * 0.152, (k - 1.5) * 0.12, zr + 0.075), (0.002, wd / 2, 0.03), HC['black'], K_PLASTIC)
        for sg in (1, -1):
            for k in range(18):
                x = 0.62 - 0.1 * k
                for row in range(2):
                    if (k + row) % 2:
                        continue
                    z0 = 0.60 + 0.055 * row
                    pts = [(x, sg * (B.side_y(x, z0) + 0.004), z0), (x - 0.1, sg * (B.side_y(x - 0.1, z0) + 0.004), z0),
                           (x - 0.1, sg * (B.side_y(x - 0.1, z0 + 0.055) + 0.004), z0 + 0.055),
                           (x, sg * (B.side_y(x, z0 + 0.055) + 0.004), z0 + 0.055)]
                    pts = [Vector(p) for p in pts]
                    if _newell(pts).dot(Y * sg) < 0:
                        pts = pts[::-1]
                    h.poly('detail', pts, HC['black'], K_PLASTIC)
    if e.get('van'):
        for k, x in enumerate((-0.4, -1.1, -1.8)):
            zr = B.top_z(x, 0)
            ys = [-0.62 * B.half + 1.24 * B.half * i / 4 for i in range(5)]
            loops = [[Vector((x + 0.06, y, B.top_z(x + 0.06, abs(y)) - 0.01)), Vector((x + 0.035, y, B.top_z(x + 0.035, abs(y)) + 0.012)),
                      Vector((x - 0.035, y, B.top_z(x - 0.035, abs(y)) + 0.012)), Vector((x - 0.06, y, B.top_z(x - 0.06, abs(y)) - 0.01))]
                     for y in ys]
            h.solid('paint', loops)
        xr = B.tail
        _ribbon(h, 'detail', [((xr - 0.004, -0.006, B.zu0 + 0.12), (xr - 0.004, 0.006, B.zu0 + 0.12)),
                              ((xr - 0.004, -0.006, 1.95), (xr - 0.004, 0.006, 1.95))], HC['seal'], K_PLASTIC, up=-X)
        for sg in (1, -1):
            h.box('detail', (xr - 0.012, sg * 0.08, 1.05), (0.012, 0.012, 0.09), HC['chrome'], K_CHROME)
    if B.bed:
        floor = B.floor
        yb = B.half * 0.86
        for k in range(8):
            x = -0.95 - 0.22 * k
            if x < B.tail + 0.15:
                break
            h.box('detail', (x, 0, floor + 0.012), (0.03, yb, 0.012), HC['trim'], K_PLASTIC)
        for sg in (1, -1):
            xw = -B.wb / 2
            R = B.arch_r * 0.94
            prof = []
            for k in range(9):
                x = xw - R + 2 * R * k / 8
                prof.append((x, max(B.arch(x), floor) + 0.012))
            ytop, yin = sg * (B.half * 0.905 + 0.02), sg * (B.half - 0.50)
            loops = [[Vector((x, ytop, floor)), Vector((x, ytop, z)), Vector((x, yin, z)), Vector((x, yin, floor))] for x, z in prof]
            h.solid('detail', loops, HC['liner'], K_LINER)
        xg = B.tail - 0.035
        wg = B.plan(B.tail - 0.03) * 0.98
        rim = B.Z(B.tail)
        h.box('paint', (xg, 0, (B.zu0 + rim) / 2 - 0.02), (0.036, wg, (rim - B.zu0) / 2 + 0.02))
        h.box('detail', (xg - 0.038, 0, rim - 0.06), (0.004, 0.17, 0.018), HC['black'], K_PLASTIC)
        h.box('detail', (xg - 0.038, 0, 0.78), (0.003, wg - 0.08, 0.004), HC['seal'], K_PLASTIC)


def build_hi(kind):
    """The high-detail vehicle: its meshes and the numbers the site needs to fit wheels and lamps to it."""
    B = _Body(kind)
    h = _Hi()
    skin = _skin(B, h)
    _wheel(B, h)
    _calipers(B, h)
    _interior(B, h, skin)
    _front_end(B, h)
    _rear_end(B, h)
    _side_details(B, h)
    _top_details(B, h)
    _type_parts(B, h)
    objs = h.finish(kind)
    offs = [[xw, B.wr, -side * B.wy] for xw in (B.wb / 2, -B.wb / 2) for side in (1, -1)]   # glTF frame: front pair, rear pair
    return objs, dict(wheelRadius=B.wr, wheelWidth=B.tw, wheelOffsets=offs)
