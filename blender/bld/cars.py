"""Cars: nine road vehicles built by lofting cross-sections along the body.

The body is a stack of cross-sections (bottom, sill, shoulder, belt, tumblehome,
roof) swept along the car from nose to tail. The wheel arches are real notches in
the lower side wall, so a wheel shows in them; windows are the faces above the belt
line between the pillars. Everything is modelled in metres with the nose on +x
(the exporter turns that into three's frame) and the origin on the ground at the
car's centre.

Six are the neighbourhood's own (sedan, hatch, suv, pickup, van, taxi); three are
exotics (`supercar`, a mid-engine wedge; `gt`, a front-engine grand tourer; `hyper`,
a winged track hypercar), flagged `exotic` so the site paints them from a palette
of their own and deals them out at about one car in seven.

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
# Optional, shared by both tiers: `archk` (arch radius over wheel radius), `archcap`
# (how far under the belt the arch crown must stop), `wyi` (wheel centre in from the
# flank), `lw` (lean tyre width), `rimk` (lean rim over tyre radius), `cabw` (lean
# roof-edge width), `tz` (tail-lamp height), `intake` / `vent` (dark flank openings,
# x front to x rear), `wing` and `scoop` (a hypercar's aero), `lamps` (where the glow
# sprites sit when the lamps are not where the generic nose and tail put them).
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
    # a mid-engine supercar (Huracan / 720S): a low wedge, the cabin pulled forward over the
    # front axle, a steep-raked screen, the engine under a louvred deck, intakes behind the doors
    'supercar': dict(
        L=4.52, W=1.98, clear=0.06, wb=2.62, wr=0.34, belt=0.80, archk=1.16, archcap=0.05, wyi=0.165,
        lw=0.28, rimk=0.76, cabw=0.56, tz=0.86, exotic=True, intake=(-0.40, -0.86),
        top=[(2.26, 0.40), (2.23, 0.52), (2.06, 0.62), (1.60, 0.72), (1.10, 0.80), (0.94, 0.83), (0.16, 1.14),
             (-0.28, 1.16), (-0.62, 1.12), (-1.05, 1.02), (-1.70, 0.95), (-2.12, 0.92), (-2.22, 0.92),
             (-2.26, 0.86), (-2.26, 0.48)],
        wind=[(0.16, 0.94)], rear=[(-1.05, -0.62)],
        side=[(0.84, -0.66)],
        lamps=dict(head=(-0.12, 0.74, 0.56), tail=(-0.03, 0.70, 0.835)),
    ),
    # a front-engine grand tourer (812 / DB11): a long hood, the cabin set well back, a fastback
    # roof to a short ducktail, vents behind the front wheels, quad round tail lamps
    'gt': dict(
        L=4.70, W=1.97, clear=0.08, wb=2.72, wr=0.355, belt=0.84, archk=1.18, archcap=0.06, wyi=0.17,
        lw=0.27, rimk=0.75, cabw=0.62, tz=0.86, exotic=True, vent=(0.86, 0.60),
        top=[(2.35, 0.52), (2.31, 0.64), (2.10, 0.74), (1.50, 0.82), (0.80, 0.88), (0.46, 0.90), (-0.36, 1.25),
             (-0.68, 1.28), (-1.02, 1.22), (-1.55, 1.07), (-1.98, 0.99), (-2.26, 0.97), (-2.35, 0.93),
             (-2.35, 0.55)],
        wind=[(-0.36, 0.46)], rear=[(-1.80, -1.02)],
        side=[(0.42, -1.10)],
        lamps=dict(head=(-0.14, 0.74, 0.62), tail=(-0.03, 0.77, 0.815)),
    ),
    # a track hypercar (P1 / Chiron): a teardrop canopy, a roof snorkel and fin, a big wing on
    # swan-neck struts over a huge diffuser
    'hyper': dict(
        L=4.60, W=1.96, clear=0.05, wb=2.67, wr=0.35, belt=0.79, archk=1.15, archcap=0.04, wyi=0.165,
        lw=0.28, rimk=0.77, cabw=0.46, tz=0.88, exotic=True, intake=(-0.30, -0.84), wing=True, scoop=True,
        top=[(2.30, 0.36), (2.27, 0.47), (2.06, 0.59), (1.55, 0.71), (1.06, 0.80), (0.90, 0.82), (0.08, 1.16),
             (-0.26, 1.19), (-0.66, 1.13), (-1.08, 1.03), (-1.70, 0.97), (-2.18, 0.95), (-2.30, 0.92),
             (-2.30, 0.50)],
        wind=[(0.08, 0.90)], rear=[(-1.02, -0.66)],
        side=[(0.84, -0.58)],
        lamps=dict(head=(-0.12, 0.76, 0.52), tail=(-0.03, 0.80, 0.852)),
    ),
}
# a cab is a sedan with a roof sign
SPECS['taxi'] = dict(SPECS['sedan'], sign=True)
# the manifest lists the family cars first, then the exotics
SPECS = {k: SPECS[k] for k in ('sedan', 'hatch', 'suv', 'pickup', 'van', 'taxi', 'supercar', 'gt', 'hyper')}

# the hypercar's wing: chord from x0 to x1, span to +-y, height of the blade
WING = dict(x0=-1.80, x1=-2.16, y=0.86, z=1.10)


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

    def wheel(self, x, y, r, width, side, rimk=0.62):
        """Tyre and rim as a prism along y, on the `side` (+1/-1) of the car."""
        n = 12
        rim_r = r * rimk
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
    ex = s.get('exotic', False)
    m = _Mesh()

    # section positions: the profile's own breakpoints, plus a dense run through each
    # wheel arch so the notch is round
    xs = {round(x, 3) for x, _ in top}
    arch_r = wr * s.get('archk', 1.28)
    cap = belt - s.get('archcap', 0.12)
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
        return min(z, cap)

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
            Vector((x, w * s.get('cabw', 0.72) if ztop > bl + 0.02 else w * 0.88, max(ztop - 0.05, bl))),
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
    wy = half - s.get('wyi', 0.19) - 0.01
    for xw in (wb / 2, -wb / 2):
        for side in (1, -1):
            m.wheel(xw, side * wy, wr, s.get('lw', 0.24), side, s.get('rimk', 0.62))
    # bumpers, grille, lamps, mirrors
    nose, tail = L / 2, -L / 2
    zh = _interp(top, nose - 0.1) - 0.06
    zt = s.get('tz', _interp(top, tail + 0.1) - 0.10)
    if ex:
        # an exotic's nose is all intake over a thin splitter, its tail a dark diffuser
        m.box(nose - 0.16, nose + 0.05, -half * 0.92, half * 0.92, clear + 0.03, clear + 0.065, TRIM)
        m.box(nose - 0.10, nose + 0.012, -half * 0.84, half * 0.84, clear + 0.08, clear + 0.24, TRIM)
        m.box(tail - 0.04, tail + 0.14, -half * 0.82, half * 0.82, clear + 0.04, clear + 0.26, TRIM)
        m.box(tail - 0.012, tail + 0.05, -half * 0.80, half * 0.80, clear + 0.26, zt - 0.10, TRIM)
    else:
        m.box(nose - 0.10, nose + 0.03, -half * 0.88, half * 0.88, clear + 0.04, clear + 0.30, TRIM)
        m.box(tail - 0.03, tail + 0.10, -half * 0.88, half * 0.88, clear + 0.04, clear + 0.30, TRIM)
        m.box(nose - 0.12, nose + 0.01, -half * 0.40, half * 0.40, clear + 0.32, clear + 0.50, TRIM)  # grille
    if kind == 'gt':
        m.box(nose - 0.10, nose + 0.014, -half * 0.52, half * 0.52, clear + 0.10, clear + 0.34, TRIM)
    if s.get('sign'):
        zr = max(z for _, z in top)
        m.box(-0.30, 0.10, -0.26, 0.26, zr, zr + 0.16, HEAD)
    lamps = s.get('lamps')
    for sgn in (1, -1):
        if ex:
            hx, hy, hz = lamps['head']
            m.box(nose + hx - 0.18, nose - 0.03, sgn * half * (hy - 0.14), sgn * half * (hy + 0.07),
                  hz - 0.03, hz + 0.035, HEAD)
            if kind == 'gt':     # quad round lamps
                for yl in (0.60, 0.80):
                    m.box(tail - 0.012, tail + 0.03, sgn * half * (yl - 0.07), sgn * half * min(yl + 0.07, 0.80),
                          zt - 0.095, zt + 0.005, TAIL)
            else:
                m.box(tail - 0.012, tail + 0.03, sgn * half * 0.38, sgn * half * 0.78, zt - 0.06, zt - 0.02, TAIL)
            m.box(0.80 if kind != 'gt' else 0.30, 0.66 if kind != 'gt' else 0.16, sgn * (half + 0.10), sgn * (half - 0.0),
                  belt + 0.04, belt + 0.12, PAINT)  # mirror on its stalk
        else:
            m.box(nose - 0.14, nose - 0.01, sgn * half * 0.52, sgn * half * 0.88, zh - 0.12, zh + 0.02, HEAD)
            m.box(tail + 0.01, tail + 0.12, sgn * half * 0.55, sgn * half * 0.92, zt - 0.16, zt - 0.02, TAIL)
            m.box(0.62, 0.78, sgn * (half + 0.08), sgn * (half - 0.04), belt + 0.04, belt + 0.14, PAINT)  # mirror
        if s.get('intake'):     # the dark scoop behind the door
            xa, xb = s['intake']
            m.box(xb, xa, sgn * (half - 0.03), sgn * (half + 0.004), belt - 0.34, belt - 0.13, TRIM)
        if s.get('vent'):       # the gill behind the front wheel
            xa, xb = s['vent']
            m.box(xb, xa, sgn * (half - 0.03), sgn * (half + 0.004), belt - 0.33, belt - 0.17, TRIM)
    if s.get('wing'):
        w = WING
        m.box(w['x1'], w['x0'], -w['y'], w['y'], w['z'] - 0.025, w['z'] + 0.02, TRIM)
        for sgn in (1, -1):
            m.box(w['x1'] - 0.02, w['x0'] + 0.04, sgn * w['y'], sgn * (w['y'] + 0.015), w['z'] - 0.16, w['z'] + 0.07, TRIM)
            xs_ = (w['x0'] + w['x1']) / 2 + 0.04
            m.box(xs_ - 0.04, xs_ + 0.04, sgn * 0.30, sgn * 0.33, _interp(top, xs_) - 0.02, w['z'] + 0.05, TRIM)
    if s.get('scoop'):
        zr = max(z for _, z in top)
        m.box(-0.78, -0.12, -0.11, 0.11, zr - 0.03, zr + 0.075, PAINT)
        m.box(-0.13, -0.10, -0.09, 0.09, zr + 0.005, zr + 0.065, TRIM)

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
    if lamps:
        (hx, hy, hz), (tx, ty, tz) = lamps['head'], lamps['tail']
        lamp = dict(head=[nose + hx, half * hy, hz], tail=[tail + tx, half * ty, tz])
    else:
        lamp = dict(head=[nose + 0.03, half * 0.7, zh - 0.05], tail=[tail - 0.03, half * 0.74, zt - 0.09])
    return out, dict(length=L, width=W, height=max(z for _, z in top),
                     wheelbase=wb, nose=nose, tail=tail, exotic=ex, lamp=lamp)


# ======================================================================================
# High-detail tier: the same nine vehicles again, built for the camera that sails low over
# the street (up to ~14k triangles counting the wheel four times, a real glasshouse and
# interior, separate wheels)
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
 K_AMBER, K_GLOSS, K_LINER, K_CARBON, K_LED, K_ENAMEL) = range(15)

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
    # carbon weave, LED light guides, carbon-ceramic discs, painted calipers and the
    # rim finishes beyond plain alloy
    carbon=(0.050, 0.054, 0.062), led=(0.90, 0.95, 1.0), ceramic=(0.25, 0.245, 0.24),
    hat=(0.10, 0.10, 0.11), groove=(0.012, 0.012, 0.014), letter=(0.20, 0.20, 0.21),
    caliper_grey=(0.24, 0.245, 0.255), giallo=(0.96, 0.74, 0.06), arancio=(0.96, 0.40, 0.06),
    graphite=(0.16, 0.165, 0.175), gunmetal=(0.30, 0.31, 0.33), steel=(0.07, 0.07, 0.075),
    cover=(0.62, 0.63, 0.65), white=(0.92, 0.92, 0.90),
)

# per-type extras for the high tier: tyre width and aspect, rim design (style, spokes) and
# finish, calipers and discs, plates, equipment; the exotics also shape their bodies here
# (`tumble`: how far the glasshouse is pulled in from the shoulders, a number or (x, k)
# points; `fender`: the crown of the front and rear haunches over the shoulder line;
# `waist`: how far the flanks are pinched between the wheels; `pinch`: how much and over
# what length the nose and tail round off in plan; `ramp`: how far the underbody lifts at
# the ends; `intake`: the depth of the scoop behind the doors)
HI = {
    'sedan': dict(tw=0.215, asp=0.55, rim=('twin', 5), cab_end=-1.22, seats=2, bench=True, sunroof=True, fin=-0.55,
                  seatc=(0.34, 0.34, 0.36), exhaust=2, caliper='caliper', frame='chrome', flap=True),
    'hatch': dict(tw=0.195, asp=0.50, rim=('star', 5), cab_end=-1.72, seats=2, bench=True, sunroof=False, fin=-1.02,
                  seatc=(0.40, 0.38, 0.34), exhaust=1, hatchback=True, wiper=True, spoiler=True, flap=True,
                  doors=[0.72, -0.13, -1.27]),
    'suv': dict(tw=0.235, asp=0.62, rim=('y', 6), cab_end=-2.24, seats=2, bench=True, sunroof=True, rails=True,
                seatc=(0.50, 0.42, 0.32), exhaust=2, hatchback=True, cladding=True, fin=-1.62, wiper=True,
                spoiler=True, flap=True, doors=[1.02, -0.10, -1.40]),
    'pickup': dict(tw=0.265, asp=0.70, rim=('six', 6), rimc='gunmetal', cab_end=-0.52, seats=2, bench=False,
                   sunroof=False, seatc=(0.30, 0.27, 0.24), exhaust=0, bed=True, cladding=True, fin=-0.08,
                   repeater='fender', flap=True,
                   top=[(2.65, 0.64), (2.62, 0.92), (2.35, 1.10), (1.60, 1.18), (1.20, 1.22), (0.65, 1.72),
                        (-0.20, 1.74), (-0.55, 1.28), (-0.66, 1.04), (-2.40, 1.02), (-2.58, 1.02)]),
    'van': dict(tw=0.215, asp=0.65, rim=('steel', 8), cab_end=-0.05, seats=2, bench=False, sunroof=False,
                seatc=(0.30, 0.30, 0.32), exhaust=0, van=True, cladding=True, repeater='fender'),
    'taxi': dict(tw=0.215, asp=0.55, rim=('cover', 12), cab_end=-1.22, seats=2, bench=True, sunroof=False,
                 seatc=(0.42, 0.40, 0.36), exhaust=1, taxi=True, fin=-0.62, repeater='fender', flap=True),
    'supercar': dict(tw=0.275, asp=0.32, rim=('y', 5), caliper='giallo', disc='ceramic', cab_end=-0.68,
                     seats=2, bench=False, seatc=(0.13, 0.13, 0.14), seatx=1.13, exhaust=0,
                     tumble=1.45, fender=(0.050, 0.070), waist=0.035, pinch=(0.24, 0.62), ramp=0.07,
                     intake=0.075, doors=[0.90, -0.36], handles=False, belt_trim=None, frame='gloss',
                     hoodw=0.55, wipers=1),
    'gt': dict(tw=0.265, asp=0.35, rim=('multi', 10), caliper='caliper', disc='ceramic', cab_end=-1.30,
               seats=2, bench=False, seatc=(0.55, 0.34, 0.20), seatx=1.0, exhaust=0,
               tumble=1.25, fender=(0.035, 0.050), waist=0.02, pinch=(0.22, 0.58), ramp=0.09,
               doors=[0.40, -0.78], frame='chrome', hoodw=0.70, flap=True, fin=-0.92, flush=True),
    'hyper': dict(tw=0.28, asp=0.30, rim=('blade', 10), rimc='graphite', lock=True, caliper='arancio',
                  disc='ceramic', cab_end=-0.64, seats=2, bench=False, seatc=(0.10, 0.10, 0.11), seatx=1.1,
                  exhaust=0, tumble=[(0.6, 1.50), (-0.2, 1.72), (-1.0, 2.25)], fender=(0.065, 0.085),
                  waist=0.045, pinch=(0.26, 0.70), ramp=0.06, intake=0.09, doors=[0.86, -0.26], handles=False,
                  belt_trim=None, frame='gloss', hoodw=0.50, wipers=1, roofc=True),
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

    def solid(self, part, loops, colour=None, cls=K_PLASTIC, caps=True, wrap=False, inward=False, local=False):
        """A closed solid through a stack of equal-sized vertex loops (a box, cylinder, cone, slab...).

        Faces are turned away from the solid's centre; `local` judges each band against its own
        pair of loops instead, for solids that bend (twisted spokes, swan necks)."""
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
            ref = (centres[ia] + centres[ib]) / 2 if (wrap or local) else cen
            for i in range(n):
                add([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]], ref)
        if caps and not wrap:
            add(vs[0], centres[1] if local else cen)
            add(vs[-1], centres[-2] if local else cen)
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
        self.exotic = s.get('exotic', False)
        self.half = self.W / 2
        self.top = e.get('top', s['top'])
        self.Z = _pchip(self.top)
        self.rim = None
        self.bed = (-self.L / 2 + 0.07, -0.66) if e.get('bed') else None
        self.floor = 0.64
        tum = e.get('tumble', 0.30 if e.get('van') else (0.85 if kind == 'suv' else 1.0))
        self.tumble = (lambda x: _interp(tum, x)) if isinstance(tum, list) else (lambda x: tum)
        self.arch_r = self.wr * s.get('archk', 1.27)
        self.arch_cap = self.belt - s.get('archcap', 0.14)
        self.pinch, self.pinch_d = e.get('pinch', (0.20, 0.5))
        self.ramp = e.get('ramp', 0.13)
        self.fender = e.get('fender', (0.0, 0.0))
        self.waist = e.get('waist', 0.0)
        # the scoop behind each door: x where it opens, x of its back wall, depth there
        self.intake = (s['intake'][0], s['intake'][1], e['intake']) if e.get('intake') else None
        self.zu0 = self.clear + 0.06
        self.base = self.zu0 + 0.09
        self.tw = e['tw']
        self.wy = self.half - s.get('wyi', 0.19)          # wheel centre, from the centre line
        self.nose = self.L / 2
        self.tail = self.bed[0] if self.bed else -self.L / 2

    # ---- scalar fields along the body
    def plan(self, x):
        edge = max(self.L / 2 - abs(x), 0.0)
        w = self.half
        if self.waist:
            # the flanks pinch in between the wheels (most behind the doors' leading edge), so the
            # haunches stand out
            xf, xr = self.wb / 2 - self.arch_r, -self.wb / 2 + self.arch_r
            w -= self.waist * _smooth(xr, xr + 0.55, x) * _smooth(xf, xf - 0.30, x)
        if self.bed and x < 0:
            return w        # a pickup's bed is square at the back
        if edge >= self.pinch_d:
            return w
        return w * (1 - self.pinch * (1 - edge / self.pinch_d) ** 2.4)

    def edge_at(self, y):
        """Distance in from the nose (or tail) tip at which the plan is |y| wide."""
        r = min(abs(y) / self.half, 1.0)
        if r <= 1 - self.pinch:
            return 0.0
        return self.pinch_d * (1 - ((1 - r) / self.pinch) ** (1 / 2.4))

    def x_front(self, y):
        return self.nose - self.edge_at(y)

    def x_rear(self, y):
        if self.bed:
            return -self.L / 2
        return -self.L / 2 + self.edge_at(y)

    def zu(self, x):
        edge = max(self.L / 2 - abs(x), 0.0)
        return self.zu0 + self.ramp * max(1 - edge / 0.45, 0.0) ** 2

    def arch(self, x):
        z = self.base
        for xw in (self.wb / 2, -self.wb / 2):
            d = abs(x - xw)
            if d < self.arch_r:
                z = max(z, self.wr + math.sqrt(self.arch_r ** 2 - d * d) * 0.92 - 0.02)
        return min(z, self.arch_cap)

    def lift(self, x):
        """0 outside the wheel arches, up to 1 well inside them."""
        return _smooth(0.0, 0.07, self.arch(x) - self.base)

    def crown(self, x):
        """How far the fender tops rise over the shoulder line at x (an exotic's haunches)."""
        f = 0.0
        for xw, hgt in ((self.wb / 2, self.fender[0]), (-self.wb / 2, self.fender[1])):
            d = abs(x - xw) / (self.arch_r * 2.1)
            if hgt and d < 1:
                f = max(f, hgt * (0.5 + 0.5 * math.cos(math.pi * d)))
        return f

    def ring(self, x):
        """Half cross-section (y >= 0), thirteen rows from the underbody centre over the top to the roof centre."""
        w, zt, zu = self.plan(x), self.Z(x), self.zu(x)
        a, ah = self.lift(x), self.arch(x)
        ah = max(ah, zu + 0.09)
        bed = self.bed is not None and x <= self.bed[1] - 1e-6
        zs = max(min(self.belt, zt - 0.045), ah + 0.05)
        f = self.crown(x)
        zf = zs + f            # the shoulder, lifted over the wheels on an exotic
        r = [None] * 13
        r[0] = (0.0, zu)
        r[1] = (w - (0.22 + 0.24 * a), zu)
        r[2] = (w - (0.045 + 0.415 * a), _lerp(zu + 0.05, ah, a))
        r[3] = (w * 0.99, ah)
        r[4] = (w, ah + (zf - ah) * 0.42)
        r[5] = (w * 0.996, ah + (zf - ah) * 0.80)
        r[6] = (w * 0.972, zf)
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
            k = self.tumble(x)
            tum = lambda f_: max(1 - (1 - f_) * k, f_ * 0.3)
            cab = [(tum(0.952), zf + 0.035), (tum(0.912), zf + (zt - zf) * 0.40), (tum(0.80), zt - 0.09),
                   (tum(0.69), zt - 0.035), (tum(0.40), zt - 0.006), (0.0, zt)]
            # the hood (or deck) crowns gently; on an exotic the fenders stand over it
            hood = [(0.99, zf + 0.012), (0.972, zf + 0.028), (0.90, zt - 0.008 + f * 0.75), (0.70, zt + 0.002 + f * 0.3),
                    (0.36, zt + 0.007), (0.0, zt + 0.009)]
            for i in range(6):
                r[7 + i] = (_lerp(hood[i][0], cab[i][0], c) * w, _lerp(hood[i][1], cab[i][1], c))
        if self.intake and not bed:
            xa, xb, dep = self.intake
            if xb - 1e-6 <= x <= xa:
                # the scoop deepens from flush at the door to its back wall, so it gulps air from the flank
                d = dep * _smooth(xa, xb, x)
                r[4] = (r[4][0] - d, r[4][1])
                r[5] = (r[5][0] - d * 0.92, r[5][1])
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

    def pillar(self, x):
        """Between two side windows (a B or C pillar)."""
        sx = sorted(self.s['side'], key=lambda ab: -max(ab))
        return any(min(a0, b0) > x > max(a1, b1) for (a0, b0), (a1, b1) in zip(sx, sx[1:]))


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
    if B.exotic:
        # an exotic's nose and tail are where most of its shape is: a few more sections there
        for d in (0.60, 0.75):
            xs.add(round(B.nose - d, 3))
            xs.add(round(B.tail + d, 3))
    if B.waist:
        # the pinched flanks are curved along x: sections every 0.25 m between the arches
        x0, x1 = -B.wb / 2 + B.arch_r, B.wb / 2 - B.arch_r
        for k in range(int((x1 - x0) / 0.25) + 1):
            xs.add(round(x0 + 0.25 * k, 3))
    if B.intake:
        xa, xb, _ = B.intake
        for x in (xa, (xa + xb) / 2, xb + 0.12, xb, xb - 0.016):
            xs.add(round(x, 3))
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
    """What a patch of the skin is: paint, glass or a dark detail (underbody, wheel liner, bed liner, pillar, intake)."""
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
    # the pillars between side windows are gloss black, so the glasshouse reads as one band
    if row in (7, 8) and c > 0.6 and B.pillar(xm):
        return 'detail', HC['gloss'], K_GLOSS
    if B.intake and row == 4 and B.intake[1] - 0.02 <= xm <= B.intake[0]:
        return 'detail', HC['black'], K_GLOSS
    # a hypercar's canopy roof (and its pillars) is bare carbon
    if B.e.get('roofc') and row in (9, 10, 11) and c > 0.75 and B.tail + 1.0 < xm < s['wind'][0][1]:
        return 'detail', HC['carbon'], K_CARBON
    return 'paint', None, None


def _skin(B, h):
    """Loft the body shell; returns the sections for the parts that fit onto it."""
    xs = _sections(B)
    B.xs = xs
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


X, Y, Zv = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def _wheel(B, h):
    """One wheel at the origin, axle on y, outer face on +y: tyre, rim, spokes, hub and a ventilated disc.

    The tyre's outer half carries the detail (bulged sidewall with a ring of raised lettering,
    a squared shoulder, two ribs either side of a groove, a sipe across the shoulder rib in
    every segment); its inner half, which faces the car, is plain. The rim is a lip and barrel
    with one of a few face designs (`HI[...]['rim']`): broad `star` or `six` spokes, thin
    `multi` spokes, `twin` pairs, `y` forks, twisted `blade`s, a pressed `steel` dish or a
    plastic `cover`, all on a concave dish so the hub sits deep."""
    e = B.e
    r_out, tw = B.wr, B.tw
    sw = tw * e['asp']
    r_rim = r_out - sw
    N = 24
    bm = h.bm['wheel']
    rimc = HC[e.get('rimc', 'alloy')]
    rim_cls = K_GLOSS if e.get('rimc') == 'graphite' else K_ALLOY

    def spin(prof_, n=N, a0=0.0):
        """Revolve an (r, y) profile about the axle; returns (face, profile row, segment) triples."""
        vs = [[bm.verts.new((r * math.cos(a0 + 2 * math.pi * k / n), y, r * math.sin(a0 + 2 * math.pi * k / n)))
               for r, y in prof_] for k in range(n)]
        out = []
        for k in range(n):
            k2 = (k + 1) % n
            for i in range(len(prof_) - 1):
                try:
                    f = bm.faces.new([vs[k][i], vs[k][i + 1], vs[k2][i + 1], vs[k2][i]])
                except ValueError:
                    continue
                out.append((f, i, k))
        return out

    def face_out(faces, axial):
        """Turn revolved faces outward: along +y where the face is a disc (`axial` rows), else away from the axle."""
        for f, i, _ in faces:
            c = f.calc_center_median()
            radial = Vector((c.x, 0, c.z)).normalized()
            if i in axial:
                if f.normal.y < 0:
                    f.normal_flip()
            elif f.normal.dot(radial) < 0:
                f.normal_flip()

    # ---- tyre: faces point away from the middle of the tube
    outer = [(r_rim, .40), (r_rim + .32 * sw, .49), (r_out - .09 * sw, .41), (r_out, .27), (r_out, .19),
             (r_out, .15), (r_out, .09)]
    inner = [(r_out, -.27), (r_out - .09 * sw, -.41), (r_rim + .32 * sw, -.49), (r_rim, -.40)]
    prof = [(r, y * tw) for r, y in outer] + [(r, y * tw) for r, y in inner]
    r_mid = (r_rim + r_out) / 2
    faces = spin(prof)
    for f, _, _ in faces:
        c = f.calc_center_median()
        radial = Vector((c.x, 0, c.z)).normalized()
        if f.normal.dot(c - radial * r_mid) < 0:
            f.normal_flip()
    h.tint('wheel', [f for f, _, _ in faces], HC['rubber'], K_RUBBER)
    h.tint('wheel', [f for f, i, _ in faces if i == 4], HC['groove'], K_RUBBER)
    # a sipe across the outer shoulder rib in every segment, and across the inner tread at half a pitch
    for k in range(N):
        for (y0, y1), a in (((.27, .19), (k + 0.5)), ((-.27, .09), k)):
            phi = 2 * math.pi * a / N
            d = Vector((math.cos(phi), 0, math.sin(phi)))
            t = Vector((-math.sin(phi), 0, math.cos(phi)))
            c0, c1 = d * (r_out + 0.0012) + Y * (y0 * tw), d * (r_out + 0.0012) + Y * (y1 * tw)
            pts = [c0 - t * 0.006, c0 + t * 0.006, c1 + t * 0.006, c1 - t * 0.006]
            if _newell(pts).dot(d) < 0:
                pts = pts[::-1]
            h.poly('wheel', pts, HC['groove'], K_RUBBER)
    # raised lettering on the sidewall: two arcs of blocks of uneven widths
    rl0, rl1 = r_rim + 0.18 * sw, r_rim + 0.42 * sw
    yl = (.40 + (.49 - .40) * 0.6) * tw + 0.0015
    widths = (0.7, 1.0, 0.8, 1.0, 0.6, 1.0, 0.9, 0.7, 1.0)
    for arc in (math.pi * 0.5, math.pi * 1.5):
        a = arc - 0.36
        for wd in widths:
            a1 = a + 0.07 * wd
            pts = [Vector((r * math.cos(t), yl, r * math.sin(t))) for r, t in ((rl0, a), (rl0, a1), (rl1, a1), (rl1, a))]
            if _newell(pts).y < 0:
                pts = pts[::-1]
            h.poly('wheel', pts, HC['letter'], K_RUBBER)
            a = a1 + 0.022

    # ---- rim lip and barrel, seen from outside: the lip faces +y, the barrel wall the axle
    rp = [(r_rim + .004, .40 * tw), (r_rim - .012, .435 * tw), (r_rim - .030, .40 * tw), (r_rim - .034, .14 * tw)]
    faces = spin(rp)
    for f, _, _ in faces:
        c = f.calc_center_median()
        radial = Vector((c.x, 0, c.z)).normalized()
        n = f.normal
        if abs(n.y) > 0.5:
            if n.y < 0:
                f.normal_flip()
        elif n.dot(radial) > 0:
            f.normal_flip()
    h.tint('wheel', [f for f, _, _ in faces], rimc, rim_cls)

    # ---- the face: spokes (or a dish) on a concave profile
    style, count = e['rim']
    r_hub = 0.074
    r_s = r_rim - 0.026          # where the spokes meet the lip

    def yface(r):
        t = min(max((r - r_hub) / (r_s - r_hub), 0.0), 1.0)
        return tw * (0.28 + 0.13 * t ** 1.5)

    def spoke(path, thick=0.017, flare=1.3):
        """A spoke through (r, angle, half width) samples, its face on the dish and its back flared."""
        loops = []
        for r, phi, w in path:
            d = Vector((math.cos(phi), 0, math.sin(phi)))
            t = Vector((-math.sin(phi), 0, math.cos(phi)))
            c = d * r + Y * yface(r)
            loops.append([c - t * w, c + t * w, c + t * (w * flare) - Y * thick, c - t * (w * flare) - Y * thick])
        h.solid('wheel', loops, rimc, rim_cls, local=True)

    rm = (r_hub + r_s) / 2
    for k in range(count if style not in ('steel', 'cover') else 0):
        phi = 2 * math.pi * k / count + 0.2
        if style == 'star':          # broad straight spokes, widening to the lip
            spoke([(r_hub, phi, 0.019), (rm, phi, 0.021), (r_s, phi, 0.034)])
        elif style == 'six':         # thick spokes
            spoke([(r_hub, phi, 0.024), (rm, phi, 0.026), (r_s, phi, 0.040)], thick=0.022)
        elif style == 'multi':       # thin forged spokes
            spoke([(r_hub, phi, 0.0095), (rm, phi, 0.0105), (r_s, phi, 0.014)])
        elif style == 'twin':        # pairs that part from the hub
            for sd in (-1, 1):
                spoke([(r_hub, phi + sd * 0.05, 0.0105), (rm, phi + sd * 0.075, 0.011), (r_s, phi + sd * 0.10, 0.0135)])
        elif style == 'y':           # a stem that forks into two prongs
            rf = r_hub + 0.42 * (r_s - r_hub)
            spoke([(r_hub, phi, 0.016), (rf + 0.006, phi, 0.017)])
            for sd in (-1, 1):
                spoke([(rf - 0.004, phi + sd * 0.025, 0.0105), ((rf + r_s) / 2, phi + sd * 0.11, 0.0105),
                       (r_s, phi + sd * 0.18, 0.013)])
        elif style == 'blade':       # turbine blades swept against the roll
            spoke([(r_hub, phi, 0.011), (_lerp(r_hub, r_s, 0.35), phi + 0.09, 0.012),
                   (_lerp(r_hub, r_s, 0.7), phi + 0.21, 0.013), (r_s, phi + 0.33, 0.015)], thick=0.014)
    if style in ('steel', 'cover'):
        # a pressed steel dish with round vents (a van's), or a plastic wheel cover with radial slots
        col, cls = (HC['steel'], K_PLASTIC) if style == 'steel' else (HC['cover'], K_PLASTIC)
        dish = [(r_hub + 0.004, yface(r_hub) + 0.004), (rm, yface(rm) - 0.004), (r_s + 0.012, .405 * tw)]
        faces = spin(dish, n=16)
        face_out(faces, axial=(0, 1))
        h.tint('wheel', [f for f, _, _ in faces], col, cls)
        for k in range(count):
            phi = 2 * math.pi * k / count + 0.13
            d = Vector((math.cos(phi), 0, math.sin(phi)))
            t = Vector((-math.sin(phi), 0, math.cos(phi)))
            if style == 'steel':
                r0, r1 = rm - 0.005, r_s - 0.008
                pts = [d * r0 - t * 0.014, d * r0 + t * 0.014, d * r1 + t * 0.022, d * r1 - t * 0.022]
                pts = [p + Y * (yface(Vector((p.x, 0, p.z)).length) + 0.003) for p in pts]
            else:
                r0, r1 = rm - 0.02, r_s - 0.012
                pts = [d * r0 - t * 0.006, d * r0 + t * 0.006, d * r1 + t * 0.009, d * r1 - t * 0.009]
                pts = [p + Y * (yface(Vector((p.x, 0, p.z)).length) + 0.004) for p in pts]
            if _newell(pts).y < 0:
                pts = pts[::-1]
            h.poly('wheel', pts, HC['seal'], K_PLASTIC)
        # centre cap (and the steel wheel's nuts round it)
        yh = yface(r_hub)
        if style == 'steel':
            for k in range(6):
                a = 2 * math.pi * k / 6
                p = Vector((math.cos(a) * 0.062, yh, math.sin(a) * 0.062))
                h.cyl('wheel', p, p + Y * 0.014, 0.0095, 0.008, HC['chrome'], K_CHROME, n=6)
        h.cyl('wheel', (0, yh, 0), (0, yh + 0.022, 0), 0.050 if style == 'steel' else 0.068, 0.042 if style == 'steel' else 0.058,
              HC['cover'] if style == 'steel' else HC['chrome'], K_CHROME if style == 'cover' else K_PLASTIC, n=12)
    else:
        # the hub: a boss, five lug nuts (or a single centre-lock nut) and a cap
        yh = yface(r_hub)
        h.cyl('wheel', (0, yh - 0.03, 0), (0, yh + 0.004, 0), r_hub + 0.006, r_hub, rimc, rim_cls, n=12)
        if e.get('lock'):
            h.cyl('wheel', (0, yh, 0), (0, yh + 0.026, 0), 0.046, 0.042, HC[e['caliper']], K_ENAMEL, n=6)
            h.cyl('wheel', (0, yh + 0.024, 0), (0, yh + 0.036, 0), 0.020, 0.015, HC['chrome'], K_CHROME, n=8)
        else:
            for k in range(5):
                a = 2 * math.pi * k / 5 + 0.2 + math.pi / 5
                p = Vector((math.cos(a) * 0.052, yh, math.sin(a) * 0.052))
                h.cyl('wheel', p, p + Y * 0.014, 0.0095, 0.008, HC['chrome'], K_CHROME, n=6)
            h.cyl('wheel', (0, yh, 0), (0, yh + 0.016, 0), 0.031, 0.027, HC['chrome'] if rim_cls == K_ALLOY else HC['black'],
                  K_CHROME if rim_cls == K_ALLOY else K_GLOSS, n=10)

    # ---- brake disc: a ventilated rotor (vanes show between its plates), drilled when it is ceramic
    ceramic = e.get('disc') == 'ceramic'
    r_d1 = (r_rim - 0.034) * 0.9
    r_d0 = r_d1 * 0.5
    yd0, yd1 = 0.10 * tw, 0.10 * tw + 0.026
    faces = spin([(r_d0, yd1), (r_d1, yd1), (r_d1, yd0)])
    face_out(faces, axial=(0,))
    dc = HC['ceramic'] if ceramic else HC['disc']
    h.tint('wheel', [f for f, _, _ in faces], dc, K_DISC)
    h.tint('wheel', [f for f, i, k in faces if i == 1 and k % 2], HC['hat'], K_DISC)
    h.cyl('wheel', (0, yd1 - 0.004, 0), (0, yface(r_hub) - 0.028, 0), r_d0, r_d0 * 0.9, HC['hat'], K_DISC, n=12, caps=False)
    if ceramic:
        for ring_i, rr in enumerate((0.64, 0.76, 0.88)):
            for k in range(12):
                a = 2 * math.pi * (k + ring_i / 3) / 12
                d = Vector((math.cos(a), 0, math.sin(a)))
                t = Vector((-math.sin(a), 0, math.cos(a)))
                c = d * (r_d1 * rr) + Y * (yd1 + 0.0012)
                pts = [c - t * 0.005, c + d * 0.005, c + t * 0.005, c - d * 0.005]
                if _newell(pts).y < 0:
                    pts = pts[::-1]
                h.poly('wheel', pts, HC['hat'], K_DISC)


def tw_sw(B):
    return B.tw * B.e['asp']


def _calipers(B, h):
    """The brake caliper straddling each disc, curved to its rim: it stays with the body while the wheel turns."""
    tw = B.tw
    r_rim = B.wr - tw_sw(B)
    r_d1 = (r_rim - 0.034) * 0.9
    col = HC[B.e.get('caliper', 'caliper_grey')]
    big = B.exotic
    span = 0.42 if big else 0.32
    for xw in (B.wb / 2, -B.wb / 2):
        for side in (1, -1):
            y0 = side * (B.wy + 0.10 * tw - 0.012)
            y1 = side * (B.wy + 0.10 * tw + (0.050 if big else 0.040))
            phi0 = math.radians(18) if xw > 0 else math.radians(162)
            loops = []
            for k in range(4):
                phi = phi0 + span * (k / 3 - 0.5)
                d = Vector((math.cos(phi), 0, math.sin(phi)))
                c = Vector((xw, 0, B.wr))
                r0, r1 = r_d1 - (0.060 if big else 0.048), r_d1 + 0.014
                loops.append([c + d * r0 + Y * y0, c + d * r1 + Y * y0, c + d * r1 + Y * y1, c + d * r0 + Y * y1])
            h.solid('detail', loops, col, K_ENAMEL, local=True)
            if big:
                # the maker's name across it
                d = Vector((math.cos(phi0), 0, math.sin(phi0)))
                e_ = Vector((-math.sin(phi0), 0, math.cos(phi0)))
                c = Vector((xw, y1 + side * 0.0015, B.wr)) + d * (r_d1 - 0.022)
                h.box('detail', c, (0.032, 0.0015, 0.007), HC['white'] if B.e['caliper'] != 'giallo' else HC['black'],
                      K_PLASTIC, ax=(e_, Y, d))


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


def _beam(h, part, p0, p1, hw, hh, colour=None, cls=K_PLASTIC, up=None, taper=1.0):
    """A bar from p0 to p1, `hw` wide and `hh` thick (half sizes), its thickness along `up`."""
    p0, p1 = Vector(p0), Vector(p1)
    u = p1 - p0
    ln = u.length / 2
    u.normalize()
    v = (up or Zv).cross(u)
    if v.length < 1e-6:
        v = Y.cross(u)
    v.normalize()
    w = u.cross(v)
    return h.box(part, (p0 + p1) / 2, (ln, hw, hh), colour, cls, ax=(u, v, w), taper=taper)


def _slab(B, h, part, front, y0, y1, z0, z1, off, depth, colour, cls, n=5):
    """A plate that follows the rounded nose (or tail) plan between two lateral positions, standing `off` proud of it.

    `z0` and `z1` may be functions of y, for a plate whose edges slope across the car."""
    d = 1 if front else -1
    loops = []
    for k in range(n):
        y = y0 + (y1 - y0) * k / (n - 1)
        x = B.x_front(y) if front else B.x_rear(y)
        za, zb = (z0(y) if callable(z0) else z0), (z1(y) if callable(z1) else z1)
        loops.append([Vector((x + d * off, y, za)), Vector((x + d * off, y, zb)),
                      Vector((x - d * depth, y, zb)), Vector((x - d * depth, y, za))])
    return h.solid(part, loops, colour, cls)


def _on_skin(B, x, u):
    """The point of the left half of the skin at section x, fractional row u (0 underbody centre .. 12 roof
    centre), and the outward normal there."""
    def at(x_, u_):
        p = B.ring(min(max(x_, B.tail), B.nose))['pts']
        u_ = min(max(u_, 0.0), 12.0)
        i = min(int(u_), 11)
        return p[i].lerp(p[i + 1], u_ - i)
    q = at(x, u)
    tu = at(x, u + 0.03) - at(x, u - 0.03)
    tx = at(x + 0.006, u) - at(x - 0.006, u)
    ref = Vector((0, tu.z, -tu.y))
    n = tx.cross(tu)
    if n.length < 1e-9:
        n = ref
    if n.dot(ref) < 0:
        n = -n
    return q, n.normalized()


def _patch(B, h, xr, ur, off, colour, cls, nx=3, nu=1, sides=(1, -1), part='detail', depth=0.0):
    """A sheet lying on the skin over sections xr = (x0, x1) and rows ur = (u0, u1), `off` proud of it, on
    each of `sides` (mirrored for -1). The rows may be functions of x, for a strip that sweeps across
    the body (a lamp along a fender, a window frame along the roof rail). With `depth` it gets side
    walls down that far, so it reads as a raised part rather than a decal."""
    x0, x1 = xr
    # sample at the skin's own sections too, so a long sheet follows its facets instead of cutting chords
    lo_, hi_ = min(x0, x1), max(x0, x1)
    cuts = {_lerp(x0, x1, i / nx) for i in range(nx + 1)}
    cuts |= {x for x in getattr(B, 'xs', ()) if lo_ + 0.01 < x < hi_ - 0.01}
    cuts = sorted(cuts, reverse=x0 > x1)
    nx = len(cuts) - 1
    G = []
    for x in cuts:
        u0 = ur[0](x) if callable(ur[0]) else ur[0]
        u1 = ur[1](x) if callable(ur[1]) else ur[1]
        row = []
        for j in range(nu + 1):
            q, n = _on_skin(B, x, _lerp(u0, u1, j / nu))
            row.append((q + n * off, n))
        G.append(row)
    for sg in sides:
        mir = (lambda p: Vector((p.x, -p.y, p.z))) if sg < 0 else (lambda p: p)

        def emit(pts, nrm):
            pts = [mir(p) for p in pts]
            if _newell(pts).dot(mir(nrm)) < 0:
                pts = pts[::-1]
            h.poly(part, pts, colour, cls)
        for i in range(nx):
            for j in range(nu):
                emit([G[i][j][0], G[i + 1][j][0], G[i + 1][j + 1][0], G[i][j + 1][0]], G[i][j][1] + G[i + 1][j + 1][1])
        if depth > 0:
            cen = sum((p for row in G for p, _ in row), Vector()) / ((nx + 1) * (nu + 1))
            edges = ([(G[i][0], G[i + 1][0]) for i in range(nx)] + [(G[i][nu], G[i + 1][nu]) for i in range(nx)]
                     + [(G[0][j], G[0][j + 1]) for j in range(nu)] + [(G[nx][j], G[nx][j + 1]) for j in range(nu)])
            for (pa, na), (pb, nb) in edges:
                pts = [pa, pb, pb - nb * depth, pa - na * depth]
                emit(pts, (pa + pb) / 2 - cen)


def _flank(B, h, x0, x1, z0, z1, sg, colour, cls, off=0.004):
    """A quad on the flank between two sections and two heights, `off` proud of it."""
    pts = [Vector((x, sg * (B.side_y(x, z) + off), z)) for x, z in ((x0, z0), (x1, z0), (x1, z1), (x0, z1))]
    if _newell(pts).dot(Y * sg) < 0:
        pts = pts[::-1]
    h.poly('detail', pts, colour, cls)


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


def _badge(B, h, front, z, w=0.045, lettering=True):
    """The maker's badge on the centre line, and the model's name in chrome letters off to the right at the back."""
    x = B.x_front(0) + 0.004 if front else B.x_rear(0) - 0.004
    d = 1 if front else -1
    h.box('detail', (x, 0, z), (0.008, w, w * 0.42), HC['chrome'], K_CHROME, taper=0.8)
    h.box('detail', (x + d * 0.006, 0, z), (0.004, w * 0.62, w * 0.24), HC['ink'], K_ENAMEL)
    if lettering and not front:
        for k, lw in enumerate((0.016, 0.012, 0.016, 0.014, 0.010)):
            yy = -(B.half * 0.42) - k * 0.036
            h.box('detail', (B.x_rear(yy) - 0.004, yy, z - 0.01), (0.005, lw, 0.012), HC['chrome'], K_CHROME)


def _front_end(B, h):
    if B.exotic:
        return _front_exotic(B, h)
    n, half, zu = B.nose, B.half, B.zu0
    zl = B.Z(n - 0.06)
    for sg in (1, -1):
        y0, y1 = sg * 0.46, sg * min(half * 0.90, half - 0.07)
        ya, yb = (y0, y1)
        # headlamp: dark bezel, clear lens, projector, an L of LED running light and the indicator
        _slab(B, h, 'detail', True, ya, yb, zl - 0.20, zl - 0.035, 0.010, 0.05, HC['darkchrome'], K_CHROME)
        _slab(B, h, 'detail', True, ya + sg * 0.012, yb - sg * 0.012, zl - 0.185, zl - 0.05, 0.019, 0.05, HC['lensclear'], K_HEAD)
        yp = (ya + yb) / 2 - sg * 0.02
        xp = B.x_front(yp)
        h.cyl('detail', (xp - 0.02, yp, zl - 0.115), (xp + 0.017, yp, zl - 0.115), 0.036, 0.04, HC['chrome'], K_CHROME, n=10)
        h.cyl('detail', (xp + 0.012, yp, zl - 0.115), (xp + 0.022, yp, zl - 0.115), 0.022, 0.02, HC['lensclear'], K_HEAD, n=10)
        _slab(B, h, 'detail', True, ya + sg * 0.02, yb - sg * 0.02, zl - 0.066, zl - 0.054, 0.023, 0.03, HC['led'], K_LED, n=4)
        _slab(B, h, 'detail', True, ya + sg * 0.02, ya + sg * 0.034, zl - 0.17, zl - 0.054, 0.023, 0.03, HC['led'], K_LED, n=2)
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
    _badge(B, h, True, (zg0 + zg1) / 2, w=0.05)
    # lower intake and splitter
    _slab(B, h, 'detail', True, -0.62, 0.62, zu + 0.045, zu + 0.165, 0.012, 0.05, HC['black'], K_GLOSS, n=5)
    for k in range(3):
        z = zu + 0.07 + 0.035 * k
        _slab(B, h, 'detail', True, -0.58, 0.58, z - 0.005, z + 0.005, 0.02, 0.03, HC['trim'], K_PLASTIC, n=5)
    _slab(B, h, 'detail', True, -(half - 0.12), half - 0.12, zu - 0.01, zu + 0.04, 0.03, 0.06, HC['black'], K_PLASTIC, n=7)
    _plate(B, h, True, 0.0, zu + 0.255)
    # the tow-eye cover, low on the right
    yt = -min(half * 0.80, half - 0.14)
    h.box('detail', (B.x_front(yt) + 0.002, yt, zu + 0.235), (0.004, 0.026, 0.018), HC['trim'], K_PLASTIC)


def _rear_end(B, h):
    if B.exotic:
        return _rear_exotic(B, h)
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
        # an LED light guide along the top of the lamp
        _slab(B, h, 'detail', False, ya + sg * 0.03, yb - sg * 0.08, zb - 0.032, zb - 0.022, 0.021, 0.03, HC['tail'], K_TAIL, n=4)
    # bumper, plate, exhaust
    if not B.bed:
        _slab(B, h, 'detail', False, -(half - 0.12), half - 0.12, zu - 0.01, zu + 0.09, 0.03, 0.06, HC['black'], K_PLASTIC, n=7)
    else:
        h.box('detail', (tail - 0.07, 0, zu + 0.07), (0.07, half - 0.12, 0.085), HC['black'], K_PLASTIC)
    zp = zu + (0.30 if not (e.get('hatchback') or B.bed or van) else 0.34)
    if B.bed:
        zp = zu + 0.38
    _plate(B, h, False, 0.0, zp)
    if not B.bed and not van:
        _badge(B, h, False, zp + 0.13, w=0.04)
    for k in range(e.get('exhaust', 0)):
        y = (0.56 if e.get('exhaust') == 2 else 0.5) * (1 if k == 0 else -1)
        x0 = B.x_rear(y)
        h.cyl('detail', (x0 + 0.04, y, zu + 0.04), (x0 - 0.11, y, zu + 0.04), 0.038, 0.04, HC['chrome'], K_CHROME, n=10)
        h.cyl('detail', (x0 - 0.108, y, zu + 0.04), (x0 - 0.114, y, zu + 0.04), 0.031, 0.031, HC['black'], K_PLASTIC, n=10)
    # the tow eye under the bumper
    yt = -half * 0.55
    h.box('detail', (B.x_rear(yt) - 0.035, yt, zu - 0.005), (0.03, 0.012, 0.012), HC['darkchrome'], K_CHROME)
    # third brake light
    if e.get('hatchback') or B.bed:
        xr = B.tail + 0.2 if not B.bed else -0.36
        zrr = B.top_z(xr, 0) if not B.bed else B.Z(-0.36)
        h.box('detail', (xr - 0.012, 0, zrr - 0.02), (0.012, 0.22, 0.014), HC['tail'], K_TAIL, ax=_rot_y(math.radians(-18)))


def _corner_lamp(B, h, xr, ur, sides, glow):
    """An exotic's headlamp lying on the corner of the nose: a dark bezel, a clear lens over it, and an LED blade."""
    _patch(B, h, xr, ur, 0.004, HC['darkchrome'], K_CHROME, nx=6, nu=2, sides=sides, depth=0.012)
    (x0, x1), (u0, u1) = xr, ur
    U0 = (lambda x: (u0(x) if callable(u0) else u0))
    U1 = (lambda x: (u1(x) if callable(u1) else u1))
    lens = (lambda x: _lerp(U0(x), U1(x), 0.12), lambda x: _lerp(U0(x), U1(x), 0.88))
    _patch(B, h, (x0 - 0.012, x1 + 0.012), lens, 0.008, HC['lensclear'], K_HEAD, nx=5, nu=1, sides=sides)
    a, b = glow
    _patch(B, h, (x0 - 0.02, x1 + 0.02), (lambda x: _lerp(U0(x), U1(x), a), lambda x: _lerp(U0(x), U1(x), b)),
           0.010, HC['led'], K_LED, nx=5, nu=1, sides=sides)


def _front_exotic(B, h):
    """An exotic's nose: lamps on the corners, big intakes over a carbon splitter (and canards on the hypercar)."""
    n, half, zu = B.nose, B.half, B.zu0
    kind = B.kind
    zt = B.Z(n - 0.02)               # top of the nose face
    for sg in (1, -1):
        if kind == 'supercar':
            # a slim lamp swept back along the corner, a Y of light inside it
            _corner_lamp(B, h, (n - 0.50, n - 0.07), (lambda x: 7.55 + (n - 0.07 - x) * 1.0, lambda x: 9.55 - (n - 0.07 - x) * 0.8),
                         (sg,), (0.40, 0.58))
            _patch(B, h, (n - 0.30, n - 0.15), (lambda x: 8.2 + (n - 0.15 - x) * 4.0, lambda x: 8.42 + (n - 0.15 - x) * 4.0),
                   0.0115, HC['led'], K_LED, nx=2, nu=1, sides=(sg,))
            # the big corner intakes, split by a carbon blade
            ys = (sg * 0.30, sg * (half - 0.12))
            _slab(B, h, 'detail', True, ys[0], ys[1], zu + 0.035, lambda y: zt - 0.07 - 0.10 * abs(y) / half, 0.006, 0.05,
                  HC['black'], K_GLOSS, n=6)
            _slab(B, h, 'detail', True, ys[0], ys[1], zu + 0.115, zu + 0.13, 0.018, 0.03, HC['carbon'], K_CARBON, n=6)
            _slab(B, h, 'detail', True, sg * (half - 0.25), sg * (half - 0.235), zu + 0.04, zu + 0.24, 0.016, 0.03,
                  HC['carbon'], K_CARBON, n=2)
        elif kind == 'gt':
            # long lamps swept up the fender line
            _corner_lamp(B, h, (n - 0.66, n - 0.09), (lambda x: 7.45 + (n - 0.09 - x) * 0.5, lambda x: 9.35 - (n - 0.09 - x) * 0.7),
                         (sg,), (0.10, 0.24))
            # the side intakes at the corners of the bumper
            _slab(B, h, 'detail', True, sg * 0.62, sg * (half - 0.14), zu + 0.05, zu + 0.20, 0.006, 0.05, HC['black'], K_GLOSS, n=4)
        else:
            # leaf-shaped lamps, wide intakes split by vertical carbon vanes, canards on the corners
            _corner_lamp(B, h, (n - 0.46, n - 0.07), (lambda x: 7.45 + (n - 0.07 - x) * 1.5, lambda x: 9.75 - (n - 0.07 - x) * 1.3),
                         (sg,), (0.42, 0.62))
            ys = (sg * 0.22, sg * (half - 0.10))
            _slab(B, h, 'detail', True, ys[0], ys[1], zu + 0.03, lambda y: zt - 0.05 - 0.10 * abs(y) / half, 0.006, 0.05,
                  HC['black'], K_GLOSS, n=6)
            for yv in (0.42, 0.62):
                _slab(B, h, 'detail', True, sg * yv, sg * (yv + 0.016), zu + 0.03, zt - 0.10, 0.02, 0.03, HC['carbon'], K_CARBON, n=2)
            # canards: two dive planes on each corner of the bumper, pitched nose-down
            for k, (dz, wd) in enumerate(((0.11, 0.075), (0.19, 0.055))):
                yc = sg * (half - 0.03 - wd)
                xc = B.x_front(yc) + 0.025
                h.box('detail', (xc, yc, zu + dz), (0.055, wd, 0.004), HC['carbon'], K_CARBON,
                      ax=_rot_y(math.radians(-10)))
    if kind == 'gt':
        # a wide low grille: a dark-chrome frame round a black mesh, three bars across it
        yg, zg0, zg1 = 0.56, zu + 0.08, zt - 0.10
        lo = lambda d: (lambda y: zg0 + d + 0.05 * (abs(y) / yg) ** 4)
        hi = lambda d: (lambda y: zg1 - d - 0.07 * (abs(y) / yg) ** 4)
        _slab(B, h, 'detail', True, -yg, yg, lo(0), hi(0), 0.012, 0.05, HC['darkchrome'], K_CHROME, n=11)
        _slab(B, h, 'detail', True, -yg + 0.025, yg - 0.025, lo(0.02), hi(0.02), 0.016, 0.05, HC['black'], K_GLOSS, n=11)
        for k in range(3):
            z = _lerp(zg0 + 0.04, zg1 - 0.04, (k + 0.5) / 3)
            _slab(B, h, 'detail', True, -yg + 0.03, yg - 0.03, z - 0.005, z + 0.005, 0.022, 0.03, HC['darkchrome'], K_CHROME, n=5)
        _badge(B, h, True, zt - 0.045, w=0.036, lettering=False)
        _slab(B, h, 'detail', True, -(half - 0.10), half - 0.10, zu - 0.02, zu + 0.01, 0.035, 0.08, HC['black'], K_GLOSS, n=9)
    else:
        # the centre intake, the badge on the nose and the carbon splitter out ahead of everything
        yi = 0.24 if kind == 'supercar' else 0.18
        _slab(B, h, 'detail', True, -yi, yi, zu + 0.035, zu + 0.15, 0.006, 0.05, HC['black'], K_GLOSS, n=4)
        _badge(B, h, True, zt - 0.06, w=0.034, lettering=False)
        _slab(B, h, 'detail', True, -(half - 0.05), half - 0.05, zu - 0.025, zu + 0.004, 0.055, 0.25, HC['carbon'], K_CARBON, n=11)
    # the tow-eye cover
    h.box('detail', (B.x_front(-0.40) + 0.002, -0.40, zu + 0.17), (0.004, 0.022, 0.014), HC['black'], K_PLASTIC)


def _rear_exotic(B, h):
    """An exotic's tail: slim LED lamps (quad rounds on the GT), a black mesh, a carbon diffuser with strakes, the pipes."""
    tail, half, zu = B.tail, B.half, B.zu0
    kind = B.kind
    zr = B.s['tz']
    zt = B.Z(tail + 0.02)
    for sg in (1, -1):
        if kind == 'supercar':
            # a thin blade of light across each corner, a Y dropping from it
            _slab(B, h, 'detail', False, sg * 0.36, sg * (half - 0.05), zr - 0.055, zr - 0.015, 0.008, 0.05,
                  HC['tail_dark'], K_PLASTIC, n=6)
            _slab(B, h, 'detail', False, sg * 0.38, sg * (half - 0.07), zr - 0.044, zr - 0.026, 0.016, 0.05, HC['tail'], K_TAIL, n=6)
            yc = sg * 0.66 * half
            _slab(B, h, 'detail', False, yc, yc + sg * 0.16, lambda y: zr - 0.04 - 0.55 * abs(abs(y) - abs(yc)),
                  lambda y: zr - 0.026 - 0.55 * abs(abs(y) - abs(yc)), 0.015, 0.05, HC['tail'], K_TAIL, n=3)
        elif kind == 'gt':
            # quad round lamps in dark-chrome cups
            for yl in (0.60, 0.80):
                y = sg * half * yl
                x0 = B.x_rear(y)
                c = Vector((x0, y, zr - 0.045))
                h.cyl('detail', c + X * 0.02, c - X * 0.012, 0.062, 0.060, HC['darkchrome'], K_CHROME, n=14)
                h.cyl('detail', c - X * 0.008, c - X * 0.018, 0.050, 0.047, HC['tail'], K_TAIL, n=14)
                h.cyl('detail', c - X * 0.016, c - X * 0.022, 0.024, 0.022, HC['tail_dark'], K_TAIL, n=10)
        else:
            # a full-width light bar with hooked ends
            _slab(B, h, 'detail', False, sg * (half - 0.22), sg * (half - 0.06), lambda y: zr - 0.04 - 0.3 * max(abs(y) - (half - 0.14), 0),
                  zr - 0.018, 0.014, 0.05, HC['tail'], K_TAIL, n=4)
    if kind == 'hyper':
        _slab(B, h, 'detail', False, -(half - 0.22), half - 0.22, zr - 0.034, zr - 0.022, 0.014, 0.05, HC['tail'], K_TAIL, n=9)
    # the black mesh across the tail (a valance under the plate on the GT), carbon bars over it
    if kind == 'gt':
        _slab(B, h, 'detail', False, -(half - 0.30), half - 0.30, zu + 0.155, zu + 0.235, 0.006, 0.05, HC['black'], K_GLOSS, n=7)
    else:
        ym, m0, m1 = (half - 0.20, zu + 0.22, zr - 0.12) if kind == 'supercar' else (half - 0.14, zu + 0.24, zr - 0.08)
        _slab(B, h, 'detail', False, -ym, ym, m0, lambda y: m1 - 0.08 * (abs(y) / ym) ** 4, 0.006, 0.05, HC['black'], K_GLOSS, n=9)
        for k in range(3):
            z = _lerp(m0 + 0.04, m1 - 0.10, k / 2)
            _slab(B, h, 'detail', False, -(ym - 0.02), ym - 0.02, z - 0.004, z + 0.004, 0.012, 0.03, HC['carbon'], K_CARBON, n=7)
    # the diffuser: a carbon tray, its strakes standing out behind the car
    yd = half - (0.20 if kind != 'gt' else 0.30)
    dz = 0.24 if kind == 'hyper' else (0.20 if kind == 'supercar' else 0.15)
    _slab(B, h, 'detail', False, -yd, yd, zu - 0.02, zu + dz, 0.012, 0.06, HC['carbon'], K_CARBON, n=9)
    ns = 7 if kind == 'hyper' else 5
    for k in range(ns):
        y = _lerp(-yd + 0.08, yd - 0.08, k / (ns - 1))
        x0 = B.x_rear(y)
        p0 = Vector((x0 + 0.40, y, zu - 0.01))
        p1 = Vector((x0 - (0.07 if kind == 'hyper' else 0.04), y, zu + dz - 0.02))
        h.solid('detail', [[p0 + Vector((0, -0.005, 0)), p0 + Vector((0, 0.005, 0)), p0 + Vector((0, 0.005, -0.012)), p0 + Vector((0, -0.005, -0.012))],
                           [p1 + Vector((0, -0.005, 0)), p1 + Vector((0, 0.005, 0)), Vector((p1.x, y + 0.005, zu - 0.03)), Vector((p1.x, y - 0.005, zu - 0.03))]],
                HC['carbon'], K_CARBON)
    # pipes: a pair high in the middle (supercar), one big one (hypercar), two pairs (GT)
    if kind == 'supercar':
        pipes = [(0.09, zu + 0.29, 0.046), (-0.09, zu + 0.29, 0.046)]
    elif kind == 'hyper':
        pipes = [(0.0, zr - 0.15, 0.065)]
    else:
        pipes = [(sg * yy, zu + 0.08, 0.040) for sg in (1, -1) for yy in (0.50, 0.62)]
    for y, z, r in pipes:
        x0 = B.x_rear(y)
        h.cyl('detail', (x0 + 0.05, y, z), (x0 - 0.05, y, z), r, r * 1.04, HC['darkchrome'] if kind != 'gt' else HC['chrome'], K_CHROME, n=12)
        h.cyl('detail', (x0 - 0.046, y, z), (x0 - 0.052, y, z), r * 0.8, r * 0.8, HC['seal'], K_PLASTIC, n=12)
    # the plate and badge
    zp = {'supercar': zr - 0.13, 'gt': zu + 0.30, 'hyper': zu + 0.31}[kind]
    _plate(B, h, False, 0.0, zp)
    _badge(B, h, False, zr - 0.05 if kind == 'gt' else zp + 0.10 if kind == 'hyper' else zt - 0.035, w=0.034,
           lettering=kind == 'gt')
    # a carbon lip along the top of the tail (the GT's ducktail is bodywork)
    if kind != 'gt':
        xl = B.tail + 0.06
        _patch(B, h, (xl, B.tail + 0.004), (10.2, 12.0), 0.006, HC['carbon'], K_CARBON, nx=1, nu=3, depth=0.008)


def _side_details(B, h):
    s, e = B.s, B.e
    sx = s['side']
    van = e.get('van')
    # door shut lines: dark strips on the flank, plus a chrome beltline
    front_door = (sx[0][0] + 0.10)
    if len(sx) > 1:
        b_pillar = (sx[0][1] + sx[1][0]) / 2
        rear_door = sx[1][1] - 0.10
        lines = [front_door, b_pillar, rear_door]
    else:
        lines = [front_door, sx[0][1] - 0.05]
    if van:
        lines = [1.50, 0.45, -0.55, -1.85]
    lines = e.get('doors', lines)
    # where the bumpers meet the wings, just clear of the arches
    joints = [B.wb / 2 + B.arch_r + 0.05]
    if not B.bed:
        joints.append(-B.wb / 2 - B.arch_r - 0.05)
    for sg in (1, -1):
        for xl in lines + joints:
            ra, rb = B.ring(xl + 0.006)['pts'], B.ring(xl - 0.006)['pts']
            top_row = 8 if xl in lines else 7
            rows = [((xl + 0.006, sg * (ra[i].y + 0.0035), ra[i].z), (xl - 0.006, sg * (rb[i].y + 0.0035), rb[i].z))
                    for i in range(3, top_row)]
            _ribbon(h, 'detail', rows, HC['seal'], K_PLASTIC, up=Y * sg)
        # beltline under the glass, and the frame along its top edge
        trim = e.get('belt_trim', 'chrome')
        frame = e.get('frame', 'gloss')
        for xa, xb in sx:
            glazed = [x for x in (_lerp(xa, xb, k / 24) for k in range(25)) if B.cabin(x) > 0.62]
            if len(glazed) < 2:
                continue
            g0, g1 = glazed[0], glazed[-1]
            col, cls = (HC['chrome'], K_CHROME) if frame == 'chrome' else (HC['gloss'], K_GLOSS)
            _patch(B, h, (g0 + 0.01, g1 - 0.01), (8.94, 9.16), 0.003, col, cls, nx=10, sides=(sg,))
            if trim:
                col, cls = (HC['chrome'], K_CHROME) if trim == 'chrome' else (HC['gloss'], K_GLOSS)
                _patch(B, h, (xa + 0.04, xb - 0.04), (6.92, 7.08), 0.003, col, cls, nx=8, sides=(sg,))
        # door handles (flush on the GT), none on the supercars
        if e.get('handles', True):
            hx = [lines[0] - 0.30, lines[1] - 0.30] if len(lines) > 2 else [lines[0] - 0.30]
            if van:
                hx = [0.62, -0.82]
            if e.get('flush'):
                hx = [lines[1] + 0.18]
            for xh in hx:
                zh = min(B.belt, B.Z(xh) - 0.06) - 0.10
                y = sg * (B.side_y(xh, zh) + (0.004 if e.get('flush') else 0.012))
                h.box('detail', (xh, y, zh), (0.085, 0.006 if e.get('flush') else 0.014, 0.013), HC['chrome'], K_CHROME)
                if not e.get('flush'):
                    h.box('detail', (xh + 0.03, sg * (B.side_y(xh, zh) + 0.003), zh), (0.05, 0.004, 0.022), HC['seal'], K_PLASTIC)
        # mirror: a black sail at the window's corner, a stalk, the housing with its glass and a repeater
        xm = s['wind'][0][1] - 0.02 - (0.12 if B.exotic else 0.0)
        if B.exotic:
            zm, out_ = B.belt + 0.085, 0.075
        else:
            zm, out_ = B.belt + (0.11 if van else 0.05), (0.09 if van else 0.045)
        ym = sg * (B.half + out_)
        yd = B.side_y(xm, B.belt - 0.02)
        h.box('detail', (xm + 0.02, sg * (yd - 0.012), zm - 0.045), (0.05, 0.03, 0.012), HC['black'], K_PLASTIC)
        _beam(h, 'paint' if B.exotic else 'detail', (xm + 0.03, sg * (yd - 0.005), zm - 0.05),
              (xm - 0.01, sg * (B.half + out_ - 0.05), zm - 0.012), 0.014 if B.exotic else 0.022, 0.008,
              None if B.exotic else HC['black'], K_PLASTIC)
        hs = (0.075, 0.055, 0.038) if B.exotic else (0.085, 0.060, 0.046)
        h.box('paint', (xm, ym, zm), hs, None, taper=0.85)
        h.box('detail', (xm - hs[0] - 0.002, ym, zm), (0.004, hs[1] - 0.008, hs[2] - 0.008), HC['darkchrome'], K_CHROME)
        if B.exotic:
            pass
        elif e.get('repeater') != 'fender':
            h.box('detail', (xm + hs[0] * 0.55, ym + sg * hs[1] * 0.55, zm - hs[2] * 0.65), (0.03, 0.022, 0.004),
                  HC['amber'], K_AMBER, ax=(X, Y, Zv))
        else:
            # a side repeater on the wing, behind the front wheel
            xr_ = B.wb / 2 - B.arch_r - 0.10
            zr_ = min(B.belt, B.Z(xr_) - 0.05) - 0.12
            _flank(B, h, xr_ + 0.03, xr_ - 0.03, zr_ - 0.012, zr_ + 0.012, sg, HC['amber'], K_AMBER, off=0.005)
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
        elif B.exotic:
            # a carbon blade along the sill between the arches
            x0, x1 = -B.wb / 2 + B.arch_r * 1.02, B.wb / 2 - B.arch_r * 1.02
            _patch(B, h, (x1, x0), (2.55, 3.18), 0.014, HC['carbon'], K_CARBON, nx=18, nu=1, sides=(sg,), depth=0.014)
        else:
            x0, x1 = -B.wb / 2 + B.arch_r * 1.05, B.wb / 2 - B.arch_r * 1.05
            rows = []
            for k in range(6):
                x = _lerp(x0, x1, k / 5)
                za = B.base
                rows.append(((x, sg * (B.side_y(x, za + 0.004) + 0.006), za), (x, sg * (B.side_y(x, za + 0.07) + 0.006), za + 0.07)))
            _ribbon(h, 'detail', rows, HC['black'], K_PLASTIC, up=Y * sg)
        # the fuel flap, on the right-hand rear quarter
        if e.get('flap') and sg < 0:
            xf = min(-B.wb / 2 + 0.02, lines[-1] - 0.16)
            zf = min(B.belt, B.Z(xf) - 0.05) - 0.13
            for (xa, xb, za, zb) in ((xf + 0.085, xf - 0.085, zf + 0.062, zf + 0.068), (xf + 0.085, xf - 0.085, zf - 0.068, zf - 0.062),
                                     (xf + 0.085, xf + 0.079, zf - 0.062, zf + 0.062), (xf - 0.079, xf - 0.085, zf - 0.062, zf + 0.062)):
                _flank(B, h, xa, xb, za, zb, sg, HC['seal'], K_PLASTIC, off=0.0035)
        # an exotic's flank openings: carbon blades across the scoop, the GT's gills
        if B.intake:
            xa, xb, _ = B.intake
            for f in (0.36, 0.66):
                _patch(B, h, (xa - 0.10, xb + 0.005), (4.0 + f, 4.0 + f + 0.06), 0.006, HC['carbon'], K_CARBON, nx=4,
                       sides=(sg,), depth=0.01)
        if s.get('vent'):
            xa, xb = s['vent']
            _patch(B, h, (xa, xb), (4.15, 5.55), 0.003, HC['black'], K_GLOSS, nx=3, nu=1, sides=(sg,))
            for f in (0.25, 0.5, 0.75):
                u = _lerp(4.15, 5.55, f)
                _patch(B, h, (xa + 0.01, xb - 0.01), (u - 0.035, u + 0.035), 0.008, HC['chrome'], K_CHROME, nx=3,
                       sides=(sg,), depth=0.006)


def _fin(B, h, xf):
    """A shark-fin antenna on the roof centre line, leaning back."""
    loops = []
    ln = 0.17
    for k in range(5):
        t = k / 4
        x = xf - ln * t
        z0 = B.top_z(x, 0) - 0.004
        hgt = 0.012 + 0.055 * math.sin(min(t * 1.25, 1.0) * math.pi / 2) * (1 - 0.25 * t)
        wd = 0.032 * (1 - 0.45 * t) + 0.004
        loops.append([Vector((x, -wd, z0)), Vector((x, wd, z0)), Vector((x - 0.01, wd * 0.25, z0 + hgt)),
                      Vector((x - 0.01, -wd * 0.25, z0 + hgt))])
    h.solid('detail', loops, HC['gloss'], K_GLOSS, local=True)


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

    def across(x, y0, y1, w=0.006, n=8):
        rows = []
        for k in range(n):
            y = _lerp(y0, y1, k / (n - 1))
            rows.append(((x - w, y, B.top_z(x - w, abs(y)) + 0.003), (x + w, y, B.top_z(x + w, abs(y)) + 0.003)))
        _ribbon(h, 'detail', rows, HC['seal'], K_PLASTIC, up=Zv)
    hw = B.half * e.get('hoodw', 0.80)
    for sg in (1, -1):
        line(B.nose - (0.10 if B.exotic else 0.16), xc + 0.04, sg * hw)
        if B.kind in ('sedan', 'taxi'):
            line(s['rear'][0][0] - 0.03, B.tail + 0.12, sg * B.half * 0.78, n=8)
        if B.kind in ('supercar', 'hyper'):
            line(s['rear'][0][0] - 0.03, B.tail + 0.10, sg * B.half * 0.50, n=10)
    if B.exotic:
        across(B.nose - 0.10, -hw, hw)                 # the frunk lid's leading edge
    if B.kind in ('supercar', 'hyper'):
        across(B.tail + 0.10, -B.half * 0.50, B.half * 0.50)
    # cowl: the dark strip at the foot of the screen, and the wipers lying across the glass
    rows = []
    for k in range(9):
        y = B.half * 0.70 * (k / 4 - 1)
        rows.append(((xc + 0.085, y, B.top_z(xc + 0.085, abs(y)) + 0.003), (xc + 0.015, y, B.top_z(xc + 0.015, abs(y)) + 0.003)))
    _ribbon(h, 'detail', rows, HC['black'], K_PLASTIC, up=Zv)
    xw = xc - 0.12
    pitch = math.atan2(B.top_z(xw - 0.05, 0) - B.top_z(xw + 0.05, 0), -0.10)
    wipers = ((1, 0.30), (-1, -0.30)) if e.get('wipers', 2) == 2 else ((1, 0.0),)
    for sg, yc in wipers:
        hl = 0.27 if len(wipers) == 2 else 0.42
        h.box('detail', (xw, yc, B.top_z(xw, abs(yc)) + 0.012), (0.008, hl, 0.007), HC['black'], K_PLASTIC, ax=_rot_y(-pitch))
        h.cyl('detail', (xc + 0.05, yc - hl * 0.9, B.top_z(xc + 0.05, abs(yc - hl * 0.9)) - 0.004),
              (xc + 0.05, yc - hl * 0.9, B.top_z(xc + 0.05, abs(yc - hl * 0.9)) + 0.022), 0.012, 0.01, HC['black'], K_PLASTIC, n=6)
    if e.get('sunroof') and not e.get('taxi'):
        x0, x1 = (-0.55, 0.0) if B.kind == 'sedan' else (-0.55, 0.15)
        ys = [-0.40 * B.half + 0.8 * B.half * k / 4 for k in range(5)]
        loops = []
        for y in ys:
            z0 = B.top_z(x0, y)
            z1 = B.top_z(x1, y)
            loops.append([Vector((x0, y, z0 + 0.003)), Vector((x1, y, z1 + 0.003)), Vector((x1, y, z1 - 0.02)), Vector((x0, y, z0 - 0.02))])
        h.solid('detail', loops, HC['gloss'], K_GLOSS)
    if e.get('fin') is not None:
        _fin(B, h, e['fin'])
    if e.get('rails'):
        for sg in (1, -1):
            y = sg * B.half * 0.60
            xa, xb = 0.15, s['rear'][0][0] + 0.55
            za, zb = B.top_z(xa, abs(y)) + 0.042, B.top_z(xb, abs(y)) + 0.042
            h.cyl('detail', (xa, y, za), (xb, y, zb), 0.014, colour=HC['darkchrome'], cls=K_CHROME, n=6)
            for xs_ in (xa - 0.02, xb + 0.02, (xa + xb) / 2):
                zr = B.top_z(xs_, abs(y))
                h.box('detail', (xs_, y, (zr + za) / 2), (0.02, 0.014, (za - zr) / 2 + 0.004), HC['black'], K_PLASTIC)
    if e.get('hatchback'):
        # a roof spoiler over the tailgate glass, and the rear wiper parked across it
        xr0, xr1 = s['rear'][0]
        if e.get('spoiler'):
            xs_ = xr1 + 0.02
            zr = B.top_z(xs_, 0)
            h.box('paint', (xs_ - 0.06, 0, zr + 0.006), (0.075, B.plan(xs_) * 0.80, 0.014), None, ax=_rot_y(math.radians(-6)),
                  taper=0.96)
            h.box('detail', (xs_ - 0.13, 0, zr - 0.006), (0.006, 0.20, 0.008), HC['tail'], K_TAIL)
        if e.get('wiper'):
            xp = _lerp(xr0, xr1, 0.10)
            p0, n0 = _on_skin(B, xp, 11.7)
            p0 = Vector((p0.x, 0.0, p0.z))
            q1, _ = _on_skin(B, _lerp(xr0, xr1, 0.62), 10.6)
            p1 = q1 + n0 * 0.012
            h.cyl('detail', p0 - n0 * 0.004, p0 + n0 * 0.03, 0.016, 0.012, HC['black'], K_PLASTIC, n=8)
            _beam(h, 'detail', p0 + n0 * 0.02, p1, 0.007, 0.005, HC['black'], K_PLASTIC, up=n0)
    if B.kind == 'supercar':
        # the louvred engine deck: a black well with slats across it
        x0, x1 = s['rear'][0][0] - 0.10, B.tail + 0.26
        _patch(B, h, (x0, x1), (10.3, 12.0), 0.002, HC['black'], K_GLOSS, nx=4, nu=2, depth=0.0)
        for k in range(7):
            x = _lerp(x0 - 0.04, x1 + 0.04, k / 6)
            _patch(B, h, (x + 0.025, x - 0.025), (10.45, 12.0), 0.012, HC['carbon'], K_CARBON, nx=1, nu=2, depth=0.01)
    if B.kind == 'gt':
        # two vents in the long hood, behind the front wheels' crowns
        for sg in (1, -1):
            _patch(B, h, (B.wb / 2 + 0.05, B.wb / 2 - 0.28), (10.25, 10.95), 0.003, HC['black'], K_GLOSS, nx=3, sides=(sg,))
            for k in range(4):
                x = _lerp(B.wb / 2 + 0.02, B.wb / 2 - 0.25, k / 3)
                _patch(B, h, (x + 0.012, x - 0.012), (10.25, 10.95), 0.008, HC['darkchrome'], K_CHROME, nx=1, sides=(sg,))


def _aero(B, h):
    """A hypercar's roof snorkel, dorsal fin, canards and its wing on swan-neck struts."""
    if B.kind != 'hyper':
        return
    # the snorkel: an air box on the roof, its mouth black
    x0, x1 = -0.12, -0.80
    loops = []
    for k in range(6):
        t = k / 5
        x = _lerp(x0, x1, t)
        z0 = B.top_z(x, 0) - 0.01
        hgt = 0.085 * (1 - 0.15 * t) * min(1.0, 0.45 + t * 3)
        wd = 0.115 - 0.03 * t
        loops.append([Vector((x, -wd, z0)), Vector((x, wd, z0)), Vector((x, wd * 0.85, z0 + hgt)), Vector((x, -wd * 0.85, z0 + hgt))])
    h.solid('paint', loops, local=True)
    zm = B.top_z(x0 - 0.02, 0)
    h.box('detail', (x0 - 0.005, 0, zm + 0.042), (0.004, 0.092, 0.03), HC['black'], K_GLOSS)
    # the dorsal fin down the engine cover
    loops = []
    for k in range(6):
        t = k / 5
        x = _lerp(x1 + 0.02, -1.95, t)
        z0 = B.top_z(x, 0) - 0.01
        hgt = 0.075 * (1 - t) + 0.012
        loops.append([Vector((x, -0.009, z0)), Vector((x, 0.009, z0)), Vector((x, 0.006, z0 + hgt)), Vector((x, -0.006, z0 + hgt))])
    h.solid('paint', loops, local=True)
    # the wing: an airfoil in carbon, endplates, and swan necks that hang it from above
    w = WING
    chord = [(0.0, 0.0), (0.06, 0.022), (0.30, 0.030), (0.70, 0.016), (1.0, -0.004), (0.70, -0.006), (0.30, -0.010), (0.06, -0.010)]
    aoa = math.radians(9)

    def foil(y):
        out = []
        for f, zz in chord:
            dx, dz = (w['x0'] - w['x1']) * f, zz
            # leading edge at x0, trailing edge raised by the angle of attack
            out.append(Vector((w['x0'] - dx * math.cos(aoa) + 0.0, y, w['z'] + dz + dx * math.sin(aoa) - 0.03)))
        return out
    h.solid('detail', [foil(-w['y']), foil(-w['y'] * 0.33), foil(w['y'] * 0.33), foil(w['y'])], HC['carbon'], K_CARBON, local=True)
    for sg in (1, -1):
        y = sg * (w['y'] + 0.008)
        pts = [(w['x0'] + 0.06, w['z'] - 0.14), (w['x0'] + 0.04, w['z'] + 0.06), (w['x1'] - 0.03, w['z'] + 0.10),
               (w['x1'] - 0.04, w['z'] - 0.10)]
        h.solid('detail', [[Vector((x, y - 0.006, z)) for x, z in pts], [Vector((x, y + 0.006, z)) for x, z in pts]],
                HC['carbon'], K_CARBON)
        # swan neck: up from the deck behind the wing, over it, down onto its top
        ys = sg * 0.32
        xd = w['x1'] + 0.10
        zd = B.top_z(xd, abs(ys)) - 0.01
        path = [Vector((xd, ys, zd)), Vector((xd - 0.02, ys, w['z'] + 0.10)), Vector((xd + 0.08, ys, w['z'] + 0.14)),
                Vector((w['x0'] - 0.10, ys, w['z'] + 0.06)), Vector((w['x0'] - 0.12, ys, w['z'] - 0.005))]
        loops = []
        for k, p in enumerate(path):
            a = path[min(k + 1, len(path) - 1)] - path[max(k - 1, 0)]
            a.normalize()
            nrm = Y.cross(a).normalized()
            loops.append([p + Y * 0.012 + nrm * 0.022, p - Y * 0.012 + nrm * 0.022, p - Y * 0.012 - nrm * 0.022, p + Y * 0.012 - nrm * 0.022])
        h.solid('detail', loops, HC['carbon'], K_CARBON, local=True)


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
            h.poly('detail', pts, HC['liner_roof'] if up and not B.exotic else (HC['carpet'] if row <= 1 or up else HC['seat']), K_FABRIC)
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
    _torus(h, 'detail', hub, Y, up, 0.17 if not B.exotic else 0.155, 0.0165, HC['black'], K_PLASTIC)
    for ang in (math.pi / 2, math.pi * 1.2, math.pi * 1.8):
        d = Y * math.cos(ang) + up * math.sin(ang)
        h.box('detail', hub + d * 0.085, (0.085, 0.012, 0.01), HC['black'], K_PLASTIC, ax=(d, nrm, d.cross(nrm)))
    h.cyl('detail', hub + nrm * 0.004, hub - nrm * 0.02, 0.04, colour=HC['black'], cls=K_PLASTIC, n=8)
    h.cyl('detail', hub - nrm * 0.1, hub + nrm * 0.0 + Vector((0.12, 0, -0.1)), 0.03, colour=HC['dash'], cls=K_PLASTIC, n=6)

    # seats: cushion, reclined back and headrest; a bench behind
    sx = xc - e.get('seatx', 0.95)
    sz = belt - 0.42
    lean = _rot_y(math.radians(-14 if not B.exotic else -20))

    def seat(x, y, hw):
        h.box('detail', (x, y, sz - 0.07), (0.26, hw, 0.07), e['seatc'], K_FABRIC)
        h.box('detail', (x - 0.30, y, sz + 0.26), (0.055, hw, 0.29), e['seatc'], K_FABRIC, ax=lean)
        if B.exotic:
            # a bucket's side bolsters
            for sd in (-1, 1):
                h.box('detail', (x - 0.27, y + sd * (hw - 0.02), sz + 0.18), (0.075, 0.03, 0.20), e['seatc'], K_FABRIC, ax=lean)
        return x - 0.37, y

    def headrest(x, y):
        z = min(sz + 0.62, B.top_z(x, 0) - 0.13)           # never through the glass
        h.box('detail', (x - 0.02, y, z), (0.035, 0.085, 0.065), e['seatc'], K_FABRIC, ax=lean)
    for sgn in (1, -1):
        x, y = seat(sx, sgn * dy, 0.23)
        headrest(x, y)
    h.box('detail', (sx + 0.12, 0, zf + 0.12), (0.26, 0.095, 0.11), HC['dash'] if not B.exotic else HC['carbon'],
          K_PLASTIC if not B.exotic else K_CARBON)        # console
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
            # the sliding door's rail, and the roof aerial
            xs_ = [_lerp(-0.45, -1.70, k / 5) for k in range(6)]
            rows = [((x, sg * (B.side_y(x, 1.30) + 0.004), 1.30), (x, sg * (B.side_y(x, 1.32) + 0.004), 1.32)) for x in xs_]
            _ribbon(h, 'detail', rows, HC['black'], K_PLASTIC, up=Y * sg)
        h.cyl('detail', (0.55, 0.0, B.top_z(0.55, 0) - 0.01), (0.40, 0.0, B.top_z(0.55, 0) + 0.32), 0.004, 0.003,
              HC['black'], K_PLASTIC, n=5)
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
        # the tow hitch under the tailgate
        h.box('detail', (-B.L / 2 - 0.06, 0, B.zu0 + 0.02), (0.07, 0.03, 0.03), HC['black'], K_PLASTIC)
        h.cyl('detail', (-B.L / 2 - 0.11, 0, B.zu0 + 0.05), (-B.L / 2 - 0.11, 0, B.zu0 + 0.10), 0.024, 0.024, HC['chrome'], K_CHROME, n=8)


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
    _aero(B, h)
    _type_parts(B, h)
    objs = h.finish(kind)
    offs = [[xw, B.wr, -side * B.wy] for xw in (B.wb / 2, -B.wb / 2) for side in (1, -1)]   # glTF frame: front pair, rear pair
    return objs, dict(wheelRadius=B.wr, wheelWidth=B.tw, wheelOffsets=offs)
