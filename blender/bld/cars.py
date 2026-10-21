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
}


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
    for sgn in (1, -1):
        m.box(nose - 0.14, nose - 0.01, sgn * half * 0.52, sgn * half * 0.88, zh - 0.12, zh + 0.02, HEAD)
        zt = _interp(top, tail + 0.1) - 0.10
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
                     lamp=dict(head=[nose - 0.05, half * 0.7, zh - 0.05], tail=[tail + 0.05, half * 0.74, zt - 0.09]))
