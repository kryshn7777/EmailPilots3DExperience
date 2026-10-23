"""People: the pedestrians of the town and the night city, and a dog for some of them to walk.

A figure is a handful of closed tubes lofted around a simple skeleton: a torso swept through
superellipse sections from the crotch to the neck, arms and legs swept along their bones
(knee, calf, elbow and forearm bulges are in the radius profiles), mitten hands with a thumb,
a head shaped ring by ring (jaw, cheekbones, brow, a nose ridge and ears pulled out of it,
the eyes and brows picked out as faces of their own), a hair shell over it and lofted shoes.
Everything is modelled in metres with the figure facing +x and standing on z = 0, and the
parts only overlap, never join, so a limb can turn about its joint without tearing anything.

Clothes are mostly not separate meshes but REGIONS of the same surfaces: a sleeve is the top
of the arm tube coloured as the top, made a little looser than the arm, ending in a hem (two
rings at the same height, one at each radius, so the hem is a real lip and the colour change
a crisp edge). Skirts and coat tails are real garments: open lofts hanging from the waist
that the runtime swings with the thighs. Hats, bags, backpacks, scarves, beards and the
longer hair styles are OPTIONS: always in the mesh, drawn only for the people who wear them.

Every face corner carries two custom attributes, `_rig` and `_aux` (make_people.py packs them
into one 4-byte glTF attribute, `_RIG` = (bone * 16 + region, option, weight * 255, occlusion * 255)):

    _rig = (bone, region, weight)      _aux = (option, occlusion)

    bone       which joint the vertex turns with (`B_*`, poses in Pedestrians.ts)
    region     what it is coloured as (`R_*`): skin, hair, top, bottom, shoes, accessory and
               under (the shirt under a jacket, tights) come from per-instance colours; dark
               (soles, eyes, belts) and light (sneaker soles) are fixed
    weight     how much of its own bone's turn it takes: the rings at a knee or an elbow take
               half, so the joint bends instead of creasing; a skirt's hem takes some of the
               thighs' swing (its side decides which thigh)
    option     0 = always drawn; k = drawn only when bit k-1 of the instance's option mask is set
    occlusion  ambient occlusion baked by casting rays against the body (1 open, darker in
               the armpits, between the legs, under the chin, under a hat brim)

The region is per face, so its boundaries are crisp; bone and weight are per vertex.
"""
import math

import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

# ---- bones ------------------------------------------------------------------------------
# parents: ROOT <- CHEST <- HEAD, CHEST <- UARM <- FARM, ROOT <- THIGH <- SHIN <- FOOT,
# ROOT <- SKIRT, ROOT <- BAG. The dog uses the arm and leg slots for its four legs and TAIL.
(B_ROOT, B_CHEST, B_HEAD, B_UARM_L, B_FARM_L, B_UARM_R, B_FARM_R,
 B_THIGH_L, B_SHIN_L, B_FOOT_L, B_THIGH_R, B_SHIN_R, B_FOOT_R, B_SKIRT, B_BAG, B_TAIL) = range(16)

# ---- colour regions -----------------------------------------------------------------------
R_SKIN, R_HAIR, R_TOP, R_BOTTOM, R_SHOES, R_ACC, R_UNDER, R_DARK, R_LIGHT = range(9)

# ---- options: bit (k - 1) of the per-instance mask turns option k on ------------------------
OPTIONS = ['bag', 'backpack', 'beanie', 'cap', 'ponytail', 'bun', 'long', 'beard', 'scarf']
O = {name: k + 1 for k, name in enumerate(OPTIONS)}

# ---- builds: joint heights and widths in metres --------------------------------------------
BUILDS = {
    'man': dict(crotch=0.81, hip=0.93, hip_y=0.088, knee=0.51, ankle=0.085, waist=1.07,
                shoulder=1.44, shoulder_y=0.185, neck=1.50, head=1.655, hs=1.0, upper=0.29, fore=0.255,
                foot=0.27, wide=1.0, deep=1.0, limb=1.0, bust=0.0, hips=1.0, waistw=1.0, chest=1.0),
    'woman': dict(crotch=0.765, hip=0.875, hip_y=0.085, knee=0.475, ankle=0.08, waist=1.02,
                  shoulder=1.345, shoulder_y=0.166, neck=1.40, head=1.545, hs=0.935, upper=0.27, fore=0.235,
                  foot=0.245, wide=0.92, deep=0.95, limb=0.88, bust=0.024, hips=1.13, waistw=0.86, chest=0.93),
    # a lean, narrow-shouldered build for the joggers (man or woman at this size)
    'athlete': dict(crotch=0.80, hip=0.915, hip_y=0.085, knee=0.50, ankle=0.085, waist=1.05,
                    shoulder=1.405, shoulder_y=0.176, neck=1.46, head=1.612, hs=0.97, upper=0.28, fore=0.245,
                    foot=0.26, wide=0.94, deep=0.9, limb=0.9, bust=0.0, hips=1.0, waistw=0.92, chest=0.96),
    # about eight years old: a bigger head for the size, short legs, no waist to speak of
    'child': dict(crotch=0.555, hip=0.635, hip_y=0.066, knee=0.35, ankle=0.062, waist=0.75,
                  shoulder=0.985, shoulder_y=0.128, neck=1.03, head=1.152, hs=0.86, upper=0.20, fore=0.175,
                  foot=0.19, wide=0.68, deep=0.74, limb=0.66, bust=0.0, hips=0.95, waistw=1.08, chest=1.0),
}

# The man's torso, bottom to top: z, front, back, side half-sizes and the superellipse power.
# Other builds map the z through their own joint heights (crotch, hip, waist, shoulder, neck).
TORSO = [
    (0.81, 0.050, 0.060, 0.068, 2.0),
    (0.87, 0.088, 0.110, 0.157, 2.3),
    (0.94, 0.095, 0.117, 0.171, 2.4),
    (1.02, 0.094, 0.099, 0.159, 2.3),
    (1.09, 0.099, 0.092, 0.151, 2.2),
    (1.18, 0.112, 0.096, 0.160, 2.3),
    (1.27, 0.122, 0.102, 0.174, 2.5),
    (1.35, 0.116, 0.104, 0.183, 2.6),
    (1.42, 0.094, 0.094, 0.188, 2.7),
    (1.46, 0.072, 0.075, 0.138, 2.4),
    (1.49, 0.057, 0.060, 0.080, 2.0),
]
MAN_KEYS = (0.81, 0.93, 1.07, 1.44, 1.50)

# The head, bottom to top, relative to its centre: dz, front, back, side, forward shift.
HEAD = [
    (-0.118, 0.030, 0.012, 0.030, 0.040),
    (-0.104, 0.062, 0.036, 0.048, 0.020),
    (-0.076, 0.086, 0.062, 0.061, 0.008),
    (-0.046, 0.094, 0.080, 0.069, 0.004),
    (-0.016, 0.097, 0.092, 0.074, 0.0),
    (0.010, 0.098, 0.098, 0.076, 0.0),
    (0.024, 0.098, 0.101, 0.077, 0.0),
    (0.038, 0.097, 0.103, 0.078, 0.0),
    (0.072, 0.089, 0.100, 0.076, -0.002),
    (0.103, 0.067, 0.082, 0.062, -0.004),
    (0.123, 0.034, 0.047, 0.034, -0.006),
]
# ring angles round the head (degrees from the front, toward the figure's left): dense at the
# face so the eyes and the nose get vertices of their own
HEAD_ANG = [0, 14, 29, 47, 70, 95, 130, 180, 230, 265, 290, 313, 331, 346]
EYE_FACES = (1, 12)          # faces between 14-29 and 331-346 degrees
BROW_FACES = (1, 2, 11, 12)
EAR_VERTS = (5, 9)           # 95 and 265 degrees
NOSE = {3: 0.010, 4: 0.019, 5: 0.011, 6: 0.006}   # ring index -> how far the front vertex is pulled out


def _v(x, y, z):
    return Vector((x, y, z))


def _frame(d, fwd=Vector((1, 0, 0))):
    """(F, L, D): D along the loft, F the hint made perpendicular to it, L = D x F (so F x L = D)."""
    D = d.normalized()
    F = fwd - D * fwd.dot(D)
    if F.length < 1e-6:
        F = Vector((0, 0, 1)) - D * D.z
    F.normalize()
    return F, D.cross(F), D


def _se(c, s, p):
    """superellipse factors: cos/sin pushed toward the square by power p"""
    return math.copysign(abs(c) ** (2 / p), c), math.copysign(abs(s) ** (2 / p), s)


def section(c, F, L, front, back, side, n=8, p=2.0, angles=None, side_l=None):
    """A ring of points round `c`: `front`/`back` along +-F, `side` along +-L (or `side_l` on +L).
    Ordered by angle from F toward L, i.e. counter-clockwise seen from the end the loft runs to."""
    pts = []
    for k in range(n):
        a = math.radians(angles[k]) if angles else 2 * math.pi * k / n
        ca, sa = _se(math.cos(a), math.sin(a), p)
        rf = front if ca >= 0 else back
        rs = side_l if (side_l is not None and sa > 0) else side
        pts.append(c + F * (ca * rf) + L * (sa * rs))
    return pts


class Fig:
    """One figure's faces, with the per-vertex bone/weight/option and per-face region kept in layers."""

    def __init__(self):
        self.bm = bmesh.new()
        self.l_bone = self.bm.verts.layers.int.new('bone')
        self.l_w = self.bm.verts.layers.float.new('w')
        self.l_opt = self.bm.verts.layers.int.new('opt')
        self.l_reg = self.bm.faces.layers.int.new('reg')
        self.opt = 0
        self.pivots = {}

    def vert(self, co, bone, w=1.0):
        v = self.bm.verts.new(co)
        v[self.l_bone] = bone
        v[self.l_w] = w
        v[self.l_opt] = self.opt
        return v

    def face(self, vs, reg):
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f[self.l_reg] = reg
        return f

    def loft(self, rings, bones, ws, regs, cap0=True, cap1=True, closed=True, cap_regs=None, tip0=None, tip1=None):
        """Quads between successive rings (ring i to i+1 coloured regs[i]); caps close the ends, as a
        flat polygon or, with `tip0`/`tip1`, a fan to that point (a rounded end)."""
        vs = [[self.vert(p, bones[i], ws[i]) for p in ring] for i, ring in enumerate(rings)]
        n = len(rings[0])
        faces = []
        for i in range(len(rings) - 1):
            a, b = vs[i], vs[i + 1]
            for k in range(n if closed else n - 1):
                k1 = (k + 1) % n
                f = self.face([a[k], a[k1], b[k1], b[k]], regs[i] if not callable(regs[i]) else regs[i](k))
                faces.append(f)
        cr0, cr1 = cap_regs or (regs[0] if not callable(regs[0]) else regs[0](0),
                                regs[-1] if not callable(regs[-1]) else regs[-1](0))
        if cap0 and closed:
            if tip0 is not None:
                t = self.vert(tip0, bones[0], ws[0])
                for k in range(n):
                    self.face([vs[0][(k + 1) % n], vs[0][k], t], cr0)
            else:
                self.face(list(reversed(vs[0])), cr0)
        if cap1 and closed:
            if tip1 is not None:
                t = self.vert(tip1, bones[-1], ws[-1])
                for k in range(n):
                    self.face([vs[-1][k], vs[-1][(k + 1) % n], t], cr1)
            else:
                self.face(vs[-1], cr1)
        return vs, faces

    def box(self, c, h, ax, bone, reg, w=1.0, taper=1.0):
        """Oriented box: centre c, half sizes h along the axes ax = (u, v, w); the +w end scaled by taper."""
        u, v, d = ax
        hu, hv, hw = h
        rect = lambda s, k: [c + u * (hu * k * a) + v * (hv * k * b) + d * (hw * s)
                             for a, b in ((1, -1), (1, 1), (-1, 1), (-1, -1))]
        # ring order: angle from u toward v, seen from +d
        rings = [rect(-1, 1.0), rect(1, taper)]
        return self.loft(rings, [bone, bone], [w, w], [reg])

    def ribbon(self, pts, normals, width, bone, reg, w=1.0, thick=0.004):
        """A thin strap along `pts` lying on a surface with the given outward `normals`."""
        rings = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            n = normals[i].normalized()
            s = t.cross(n).normalized() * (width / 2)
            o = n * thick
            rings.append([p - s, p - s + o, p + s + o, p + s])
        # rings run along t, and are ordered round it from -s through +n to +s: counter-clockwise seen
        # from the end the strap runs to only if (s x n) points along t, so fix the order per strap
        if rings and len(pts) > 1:
            t = (pts[1] - pts[0]).normalized()
            s = rings[0][3] - rings[0][0]
            n = rings[0][1] - rings[0][0]
            if s.cross(n).dot(t) < 0:
                rings = [list(reversed(r)) for r in rings]
        return self.loft(rings, [bone] * len(rings), [w] * len(rings), [reg] * (len(rings) - 1))


# =============================================================================================
# the parts
# =============================================================================================

def _zmap(b):
    """man torso z -> this build's z, piecewise through the joint heights"""
    keys = (b['crotch'], b['hip'], b['waist'], b['shoulder'] - 0.02 * b['hs'], b['neck'])
    man = MAN_KEYS[:3] + (1.42, 1.50)

    def f(z):
        if z <= man[0]:
            return keys[0] + (z - man[0])
        for i in range(len(man) - 1):
            if z <= man[i + 1]:
                t = (z - man[i]) / (man[i + 1] - man[i])
                return keys[i] + (keys[i + 1] - keys[i]) * t
        return keys[-1] + (z - man[-1])
    return f


def torso_rows(b):
    """this build's torso table: (z, front, back, side, power)"""
    zf = _zmap(b)
    rows = []
    for z, fr, bk, sd, p in TORSO:
        # what part of the body the row is: hips, waist, chest or shoulders
        hipness = max(0.0, 1 - abs(z - 0.93) / 0.12)
        waistness = max(0.0, 1 - abs(z - 1.07) / 0.09)
        bustness = max(0.0, 1 - abs(z - 1.27) / 0.08)
        shoulderness = max(0.0, 1 - abs(z - 1.41) / 0.07)
        sw = b['wide'] * (1 + (b['hips'] - 1) * hipness + (b['waistw'] - 1) * waistness
                          + (b['chest'] - 1) * shoulderness)
        dw = b['deep']
        rows.append((zf(z), fr * dw + b['bust'] * bustness, bk * dw * (1 + 0.6 * (b['hips'] - 1) * hipness),
                     sd * sw, p))
    return rows


def torso_at(rows, z):
    """front, back, side, power interpolated at z"""
    if z <= rows[0][0]:
        return rows[0][1:]
    for a, c in zip(rows, rows[1:]):
        if a[0] <= z <= c[0]:
            t = (z - a[0]) / (c[0] - a[0])
            return tuple(a[i] + (c[i] - a[i]) * t for i in range(1, 5))
    return rows[-1][1:]


def torso_point(rows, z, ang, out=0.0):
    """a point on the torso surface at height z, angle `ang` (radians from the front toward the left)"""
    fr, bk, sd, p = torso_at(rows, z)
    ca, sa = _se(math.cos(ang), math.sin(ang), p)
    return _v(ca * (fr if ca >= 0 else bk) * (1 + out), sa * sd * (1 + out), z)


TN = 14   # torso ring


def torso(fig, b, rows, spec):
    """The torso from the crotch to the neck base, with its garment regions and hems."""
    top, bottom = spec['top'], spec['bottom']
    hem = spec['hem'](b)          # where the top ends (z)
    loose = spec['loose']         # how much looser than the body the top is
    # rows, with the hem ring doubled
    zs = [r[0] for r in rows]
    ring_specs = []               # (z, scale, region of the segment above)
    for z in zs:
        if z < hem:
            ring_specs.append((z, 1.0 + (0.02 if bottom != 'skirt' else 0.0), R_BOTTOM))
        else:
            if not ring_specs or ring_specs[-1][0] < hem:
                ring_specs.append((hem, 1.02, R_TOP))                # the body under the hem
                ring_specs.append((hem, loose + 0.012, R_TOP))       # the hem's lip
            ring_specs.append((z, loose, R_TOP))
    rings, bones, ws = [], [], []
    for z, s, _ in ring_specs:
        fr, bk, sd, p = torso_at(rows, z)
        rings.append(section(_v(0, 0, z), _v(1, 0, 0), _v(0, 1, 0), fr * s, bk * s, sd * s, TN, p))
        if z < b['waist'] - 0.03:
            bones.append(B_ROOT)
            ws.append(1.0)
        elif z < b['waist'] + 0.03:
            bones.append(B_CHEST)
            ws.append(0.5)
        else:
            bones.append(B_CHEST)
            ws.append(1.0)
    # region per segment: the segment from ring i to i+1 takes the region of ring i+1's garment
    seg = []
    for i in range(len(ring_specs) - 1):
        z1 = ring_specs[i + 1][0]
        seg.append(R_TOP if z1 > hem or (z1 == hem and ring_specs[i + 1][1] > 1.03) else R_BOTTOM)
    # the open collar of a jacket or coat shows the shirt under it: front faces near the neck
    if spec.get('collar') == 'v':
        zc = b['shoulder'] - 0.13 * b['hs']
        for i in range(len(seg)):
            if ring_specs[i][0] >= zc and seg[i] == R_TOP:
                seg[i] = (lambda k: R_UNDER if k in (0, TN - 1) else R_TOP)
    fig.loft(rings, bones, ws, seg, tip0=_v(0.005, 0, rows[0][0] - 0.02), cap_regs=(R_BOTTOM, R_TOP))


def neck(fig, b, spec):
    z0, z1 = b['neck'] - 0.06 * b['hs'], b['head'] - 0.07 * b['hs']
    r = 0.056 * b['hs'] * (0.95 if b is BUILDS['woman'] else 1.0)
    rings, bones, ws = [], [], []
    for t, s in ((0.0, 1.05), (0.5, 1.0), (1.0, 0.98)):
        z = z0 + (z1 - z0) * t
        rings.append(section(_v(-0.01 * t, 0, z), _v(1, 0, 0), _v(0, 1, 0), r * 0.92 * s, r * s, r * s, 10, 2.0))
        bones.append(B_HEAD)
        ws.append(0.3 + 0.7 * t)
    fig.loft(rings, bones, ws, [R_SKIN, R_SKIN])
    if spec.get('collar') == 'coat':
        # a coat's stand-up collar round the base of the neck
        zc = b['neck'] - 0.03 * b['hs']
        rc = r * 1.55
        rings = [section(_v(-0.008, 0, zc + dz), _v(1, 0, 0), _v(0, 1, 0), rc * 0.95 * k, rc * k, rc * k, 12, 2.0)
                 for dz, k in ((-0.02, 1.08), (0.035 * b['hs'], 1.0))]
        fig.loft(rings, [B_CHEST] * 2, [1.0] * 2, [R_TOP], cap0=False, cap1=False)
        inner = [section(_v(-0.008, 0, zc + dz), _v(1, 0, 0), _v(0, 1, 0), rc * 0.95 * k, rc * k, rc * k, 12, 2.0)
                 for dz, k in ((0.035 * b['hs'], 0.86), (-0.02, 0.86))]
        fig.loft(inner, [B_CHEST] * 2, [1.0] * 2, [R_TOP], cap0=False, cap1=False)
        # the rim between the outer and inner walls
        fig.loft([rings[-1], inner[0]], [B_CHEST] * 2, [1.0] * 2, [R_TOP], cap0=False, cap1=False)


def head_ring(b, i, out=0.0, extra=None):
    dz, fr, bk, sd, sh = HEAD[i]
    s = b['hs']
    c = _v(sh * s + 0.012 * s, 0, b['head'] + dz * s)
    pts = []
    for k, a in enumerate(HEAD_ANG):
        ar = math.radians(a)
        ca, sa = _se(math.cos(ar), math.sin(ar), 2.15)
        e = extra(k, ar) if extra else 0.0
        pts.append(c + _v(ca * (fr if ca >= 0 else bk) * s * (1 + out) + math.cos(ar) * e,
                          sa * sd * s * (1 + out) + math.sin(ar) * e, 0))
    return pts


def head(fig, b):
    s = b['hs']
    rings = []
    for i in range(len(HEAD)):
        pts = head_ring(b, i)
        if i in NOSE:
            pts[0] = pts[0] + _v(NOSE[i] * s, 0, 0)
        if i in (4, 5, 6):
            for k in EAR_VERTS:
                d = pts[k] - _v(pts[k].x, 0, pts[k].z)
                pts[k] = pts[k] + d.normalized() * 0.011 * s + _v(-0.006 * s, 0, 0)
        rings.append(pts)
    n = len(HEAD_ANG)

    def reg_for(i):
        if i == 5:
            return lambda k: R_DARK if k in EYE_FACES else R_SKIN
        if i == 6:
            return lambda k: R_HAIR if k in BROW_FACES else R_SKIN
        return R_SKIN
    regs = [reg_for(i) for i in range(len(HEAD) - 1)]
    top = _v(-0.006 * s, 0, b['head'] + 0.130 * s)
    bot = _v(0.045 * s, 0, b['head'] - 0.121 * s)
    fig.loft(rings, [B_HEAD] * len(rings), [1.0] * len(rings), regs, tip0=bot, tip1=top)
    del n


def _head_r(b, z, ar):
    """distance from the head's vertical axis to its surface at height z (absolute), angle ar"""
    s = b['hs']
    dz = (z - b['head']) / s
    rows = HEAD
    if dz <= rows[0][0]:
        r = rows[0]
    elif dz >= rows[-1][0]:
        r = rows[-1]
    else:
        for a, c in zip(rows, rows[1:]):
            if a[0] <= dz <= c[0]:
                t = (dz - a[0]) / (c[0] - a[0])
                r = tuple(a[j] + (c[j] - a[j]) * t for j in range(5))
                break
    _, fr, bk, sd, sh = r
    ca, sa = _se(math.cos(ar), math.sin(ar), 2.15)
    return _v(ca * (fr if ca >= 0 else bk) * s + (sh + 0.012) * s, sa * sd * s, z)


def shell(fig, b, line, thick, z_top, reg, rings=5, bone=B_HEAD, fringe=None, lip=True):
    """A shell over the head from its crown down to `line(angle)` (absolute z), `thick(angle, t)` out
    from the scalp: hair, a beanie, a cap's crown."""
    out = []
    for j in range(rings + 1):
        t = 0.18 + 0.82 * j / rings
        ring = []
        for a in HEAD_ANG:
            ar = math.radians(a)
            z = z_top + (line(ar) - z_top) * t
            p = _head_r(b, z, ar)
            axis = _v((0.012 + HEAD[5][4]) * b['hs'], 0, z)
            d = p - axis
            ring.append(p + d.normalized() * thick(ar, t))
        out.append(ring)
    if lip:
        # tuck the edge back in to the scalp so the shell has thickness at its edge
        ring = []
        for k, a in enumerate(HEAD_ANG):
            ar = math.radians(a)
            p = _head_r(b, line(ar) + 0.004, ar)
            ring.append(p)
        out.append(ring)
    crown = _v(0.0, 0, z_top + thick(0.0, 0.0) + 0.004)
    out = [list(reversed(r)) for r in out]
    fig.loft(out, [bone] * len(out), [1.0] * len(out), [reg] * (len(out) - 1), tip0=crown, cap1=False)


def hair(fig, b, style):
    s = b['hs']
    hc = b['head']
    top = hc + 0.124 * s
    if style == 'short':
        def line(ar):
            a = abs(math.degrees(math.atan2(math.sin(ar), math.cos(ar))))
            # forehead, temples, above the ears, nape
            pts = [(0, 0.074), (30, 0.064), (60, 0.050), (90, 0.034), (115, 0.012), (150, -0.048), (180, -0.064)]
            return hc + _interp_deg(pts, a) * s

        def thick(ar, t):
            return (0.010 + 0.006 * (1 - math.cos(ar)) * 0.5) * s * (0.6 + 0.4 * (1 - t) + 0.4 * t)
        shell(fig, b, line, thick, top, R_HAIR, rings=4)
    else:   # 'bob': fuller, over the ears, down to the nape; the ponytail, bun and long hair add to it
        def line(ar):
            a = abs(math.degrees(math.atan2(math.sin(ar), math.cos(ar))))
            pts = [(0, 0.064), (25, 0.050), (55, 0.012), (85, -0.050), (120, -0.078), (180, -0.088)]
            return hc + _interp_deg(pts, a) * s

        def thick(ar, t):
            a = abs(math.degrees(math.atan2(math.sin(ar), math.cos(ar))))
            side = 0.016 + 0.012 * min(1.0, a / 90)
            return (side * (0.7 + 0.5 * t) if a > 20 else 0.012 + 0.006 * t) * s
        shell(fig, b, line, thick, top, R_HAIR, rings=5)


def _interp_deg(pts, a):
    for (a0, v0), (a1, v1) in zip(pts, pts[1:]):
        if a0 <= a <= a1:
            t = (a - a0) / (a1 - a0)
            return v0 + (v1 - v0) * t
    return pts[-1][1]


def tube_along(fig, pts, radii, bone, reg, n=8, w=1.0, fwd=Vector((1, 0, 0)), tip=True, flat=1.0):
    """A round tube through `pts` with `radii` (a ponytail, a strap, a tail, a dog's leg)."""
    rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)])
        F, L, D = _frame(d, fwd)
        rings.append(section(p, F, L, radii[i], radii[i], radii[i] * flat, n, 2.0))
    d0 = (pts[1] - pts[0]).normalized()
    d1 = (pts[-1] - pts[-2]).normalized()
    ws = w if isinstance(w, list) else [w] * len(pts)
    bones = bone if isinstance(bone, list) else [bone] * len(pts)
    return fig.loft(rings, bones, ws, [reg] * (len(rings) - 1),
                    tip0=pts[0] - d0 * radii[0] * 0.6 if tip else None,
                    tip1=pts[-1] + d1 * radii[-1] * 0.6 if tip else None)


# ---- arms and hands -------------------------------------------------------------------------

AN = 8


def arm(fig, b, side, spec):
    """One arm (side +1 = left, +y), from the deltoid to the wrist, plus the hand."""
    hs, lim = b['hs'], b['limb']
    S = _v(-0.005, side * b['shoulder_y'], b['shoulder'])
    abd = math.radians(7)
    d1 = _v(0.02, side * math.sin(abd), -math.cos(abd)).normalized()
    E = S + d1 * b['upper']
    d2 = _v(0.11, side * math.sin(abd) * 0.6, -1).normalized()
    W = E + d2 * b['fore']
    up, farm = (B_UARM_L, B_FARM_L) if side > 0 else (B_UARM_R, B_FARM_R)
    fig.pivots[up] = S
    fig.pivots[farm] = E
    sleeve = spec['sleeve']        # length of the sleeve from the shoulder, metres, or 0
    sl = spec['sleeve_loose']
    # rows: distance along the arm (upper arm, then forearm), front, back, side
    lu, lf = b['upper'], b['fore']
    rows = [
        (-0.018, 0.040, 0.040, 0.046),
        (0.035, 0.049, 0.047, 0.053),
        (0.15, 0.044, 0.042, 0.044),
        (lu - 0.045, 0.038, 0.037, 0.038),
        (lu, 0.036, 0.040, 0.037),
        (lu + 0.06, 0.041, 0.040, 0.041),
        (lu + 0.15, 0.034, 0.031, 0.033),
        (lu + lf - 0.015, 0.026, 0.024, 0.020),
        (lu + lf, 0.025, 0.023, 0.019),
    ]
    rows = [(d, f * lim, bk * lim, sd * lim) for d, f, bk, sd in rows]

    def at(d):
        if d <= lu:
            return S + d1 * d, d1
        return E + d2 * (d - lu), d2

    ring_specs = []   # (d, scale, reg above)
    for d, f, bk, sd in rows:
        if sleeve and d <= sleeve:
            ring_specs.append((d, f, bk, sd, sl, R_TOP))
        else:
            if sleeve and ring_specs and ring_specs[-1][0] < sleeve <= d:
                # the hem: the sleeve's lip, then the arm under it
                fi, bi, si = _lerp_row(rows, sleeve)
                ring_specs.append((sleeve, fi, bi, si, sl + 0.04, R_TOP))
                ring_specs.append((sleeve, fi, bi, si, 1.0, R_TOP))
            ring_specs.append((d, f, bk, sd, 1.0, R_SKIN))
    if sleeve and sleeve >= rows[-1][0]:
        # a long sleeve ends in a cuff at the wrist
        d, f, bk, sd = rows[-1]
        ring_specs.append((d, f, bk, sd, 1.0, R_TOP))
    rings, bones, ws, regs = [], [], [], []
    for i, (d, f, bk, sd, sc, reg) in enumerate(ring_specs):
        c, dd = at(d)
        if lu - 0.01 < d < lu + 0.01:
            dd = (d1 + d2).normalized()
        F, L, D = _frame(dd)
        rings.append(section(c, F, L, f * sc, bk * sc, sd * sc, AN, 2.0))
        if d < lu - 0.01:
            bones.append(up)
            ws.append(1.0)
        elif d < lu + 0.01:
            bones.append(farm)
            ws.append(0.5)
        else:
            bones.append(farm)
            ws.append(1.0)
        if i > 0:
            regs.append(reg)
    tip = S - d1 * 0.036 * lim + _v(0, side * 0.006, 0)
    fig.loft(rings, bones, ws, regs, tip0=tip, cap1=True,
             cap_regs=(R_TOP if sleeve else R_SKIN, R_TOP if sleeve and sleeve >= rows[-1][0] else R_SKIN))
    hand(fig, b, side, W, d2, farm)
    return W


def _lerp_row(rows, d):
    for a, c in zip(rows, rows[1:]):
        if a[0] <= d <= c[0]:
            t = (d - a[0]) / (c[0] - a[0])
            return tuple(a[i] + (c[i] - a[i]) * t for i in range(1, 4))
    return rows[-1][1:]


def hand(fig, b, side, W, d2, bone):
    lim = b['limb']
    d3 = (d2 + _v(0.0, -side * 0.06, 0)).normalized()
    F, L, D = _frame(d3)
    inward = -side * abs(L.y) / L.y if abs(L.y) > 1e-6 else 0
    medial = L * inward    # toward the thigh
    rows = [(-0.012, 0.024, 0.017, 0.0), (0.035, 0.039, 0.016, 0.0), (0.08, 0.041, 0.014, 0.003),
            (0.125, 0.035, 0.012, 0.010), (0.16, 0.026, 0.010, 0.016)]
    rings = []
    for d, wf, th, curl in rows:
        c = W + d3 * d * lim + medial * curl * lim
        rings.append(section(c, F, L, wf * lim, wf * lim, th * lim, 6, 2.6))
    tip = W + d3 * 0.178 * lim + medial * 0.02 * lim
    fig.loft(rings, [bone] * 5, [1.0] * 5, [R_SKIN] * 4, cap0=True, tip1=tip)
    # the thumb, on the front of the palm, pointing forward and down
    t0 = W + d3 * 0.025 * lim + F * 0.028 * lim
    tdir = (d3 * 0.75 + F * 0.45 + medial * 0.2).normalized()
    pts = [t0, t0 + tdir * 0.03 * lim, t0 + tdir * 0.058 * lim]
    tube_along(fig, pts, [0.013 * lim, 0.011 * lim, 0.009 * lim], bone, R_SKIN, n=4, fwd=F)


# ---- legs and shoes -------------------------------------------------------------------------

LN = 8


def leg(fig, b, side, spec):
    lim = b['limb']
    H = _v(0, side * b['hip_y'], b['hip'])
    K = _v(0, side * b['hip_y'], b['knee'])
    A = _v(0, side * b['hip_y'], b['ankle'])
    th, sh, ft = (B_THIGH_L, B_SHIN_L, B_FOOT_L) if side > 0 else (B_THIGH_R, B_SHIN_R, B_FOOT_R)
    fig.pivots[th], fig.pivots[sh], fig.pivots[ft] = H, K, A
    Lt, Ls = b['hip'] - b['knee'], b['knee'] - b['ankle']
    # rows: z, front, back, side, bone, weight
    rows = [
        (b['hip'] + 0.05 * lim, 0.074, 0.078, 0.074, th, 0.6),
        (b['hip'], 0.086, 0.092, 0.084, th, 0.85),
        (b['hip'] - 0.13 * Lt / 0.42, 0.077, 0.080, 0.074, th, 1.0),
        (b['hip'] - 0.29 * Lt / 0.42, 0.060, 0.058, 0.057, th, 1.0),
        (b['knee'] + 0.03, 0.051, 0.050, 0.050, th, 1.0),
        (b['knee'], 0.052, 0.046, 0.048, sh, 0.5),
        (b['knee'] - 0.12 * Ls / 0.425, 0.044, 0.059, 0.049, sh, 1.0),
        (b['knee'] - 0.27 * Ls / 0.425, 0.034, 0.040, 0.038, sh, 1.0),
        (b['ankle'] + 0.035, 0.028, 0.030, 0.030, sh, 1.0),
        (b['ankle'] - 0.01, 0.026, 0.028, 0.028, sh, 1.0),
    ]
    legs = spec['legs']               # region of the bare leg: skin or under (tights)
    trousers = spec['bottom'] in ('jeans', 'trousers')
    shorts = spec['bottom'] == 'shorts'
    short_end = b['knee'] + 0.10 * lim
    rings, bones, ws, regs = [], [], [], []
    prev_reg = None
    for z, f, bk, sd, bone, w in rows:
        f, bk, sd = f * lim, bk * lim, sd * lim
        reg = legs
        sc = 1.0
        if trousers:
            reg = R_BOTTOM
            sc = 1.06
            if z < b['knee']:
                # a straight trouser leg hangs off the knee instead of following the calf
                m = 0.052 * lim
                f, bk, sd = max(f, m), max(bk, m * 1.02), max(sd, m)
        elif shorts and z >= short_end:
            reg = R_BOTTOM
            sc = 1.16
        if shorts and prev_reg == R_BOTTOM and reg != R_BOTTOM:
            # hem of the shorts
            fi, bi, si = _row_at(rows, short_end, lim)
            for scale in (1.16 + 0.04, 1.0):
                rings.append(section(_v(0, side * b['hip_y'], short_end), _v(1, 0, 0), _v(0, 1, 0),
                                     fi * scale, bi * scale, si * scale, LN, 2.0))
                bones.append(th)
                ws.append(1.0)
                regs.append(R_BOTTOM)
        if trousers and z == rows[-2][0]:
            # trouser cuff over the shoe
            rings.append(section(_v(0, side * b['hip_y'], z), _v(1, 0, 0), _v(0, 1, 0), f * sc, bk * sc, sd * sc, LN, 2.0))
            bones.append(bone)
            ws.append(w)
            regs.append(reg)
            rings.append(section(_v(0, side * b['hip_y'], z), _v(1, 0, 0), _v(0, 1, 0), 0.6 * f, 0.6 * bk, 0.6 * sd, LN, 2.0))
            bones.append(bone)
            ws.append(w)
            regs.append(reg)
            break
        rings.append(section(_v(0, side * b['hip_y'], z), _v(1, 0, 0), _v(0, 1, 0), f * sc, bk * sc, sd * sc, LN, 2.0))
        bones.append(bone)
        ws.append(w)
        regs.append(reg)
        prev_reg = reg
    # loft goes downward: ring order must be counter-clockwise seen from below, so reverse each ring
    rings = [list(reversed(r)) for r in rings]
    fig.loft(rings, bones, ws, regs[1:], cap0=True, cap1=True, cap_regs=(regs[0], regs[-1]))
    shoe(fig, b, A, spec['shoes'], ft)


def _row_at(rows, z, lim):
    for a, c in zip(rows, rows[1:]):
        if c[0] <= z <= a[0]:
            t = (z - a[0]) / (c[0] - a[0])
            return tuple((a[i] + (c[i] - a[i]) * t) * lim for i in range(1, 4))
    return tuple(r * lim for r in rows[0][1:4])


SHOES = {
    # x from the heel (fraction of the length), half width, top height (m), for the profile
    'sneaker': dict(sole=R_LIGHT, st=0.026, prof=[(0.0, 0.032, 0.085), (0.07, 0.044, 0.108), (0.3, 0.047, 0.10),
                                                    (0.55, 0.052, 0.074), (0.8, 0.049, 0.058), (0.95, 0.037, 0.048),
                                                    (1.0, 0.02, 0.034)]),
    'shoe': dict(sole=R_DARK, st=0.02, prof=[(0.0, 0.030, 0.075), (0.07, 0.041, 0.097), (0.3, 0.044, 0.09),
                                              (0.55, 0.047, 0.066), (0.8, 0.044, 0.05), (0.95, 0.033, 0.042),
                                              (1.0, 0.017, 0.028)]),
    'flat': dict(sole=R_DARK, st=0.012, prof=[(0.0, 0.028, 0.06), (0.07, 0.037, 0.072), (0.3, 0.040, 0.062),
                                               (0.55, 0.042, 0.05), (0.8, 0.040, 0.042), (0.95, 0.030, 0.034),
                                               (1.0, 0.015, 0.024)]),
    'boot': dict(sole=R_DARK, st=0.022, prof=[(0.0, 0.033, 0.26), (0.07, 0.043, 0.28), (0.3, 0.046, 0.27),
                                               (0.5, 0.049, 0.13), (0.75, 0.047, 0.064), (0.95, 0.035, 0.048),
                                               (1.0, 0.018, 0.034)]),
}


def shoe(fig, b, A, kind, bone):
    """A shoe lofted heel to toe round the ankle A: upper in the shoe colour, sole picked out."""
    sp = SHOES[kind]
    L = b['foot']
    lim = b['limb'] ** 0.5
    x0 = A.x - 0.24 * L
    rings = []
    for fx, hw, top in sp['prof']:
        x = x0 + fx * L
        hw *= lim * (L / 0.27) ** 0.3
        top *= (L / 0.27) ** 0.6 if kind != 'boot' else (b['hip'] / 0.93)
        st = sp['st']
        y0 = A.y
        # (y, z) round the section, angle from +y toward +z (counter-clockwise seen from the toe)
        pts = [(hw, st + 0.35 * (top - st)), (hw * 0.62, top), (-hw * 0.62, top), (-hw, st + 0.35 * (top - st)),
               (-hw, st), (-hw * 0.92, 0.0), (hw * 0.92, 0.0), (hw, st)]
        rings.append([_v(x, y0 + y, z) for y, z in pts])

    def reg(k):
        # faces 4, 5 and 6 run round the sole band: its sides and the tread
        return sp['sole'] if k in (4, 5, 6) else R_SHOES
    fig.loft(rings, [bone] * len(rings), [1.0] * len(rings), [reg] * (len(rings) - 1),
             cap_regs=(R_SHOES, R_SHOES))
    fig.foot = (x0 - A.x, -A.z, x0 + L - A.x, -A.z)


# ---- garments that hang ----------------------------------------------------------------------

def skirt(fig, b, rows, z0, z1, flare, reg, swing, n=TN):
    """An open loft from the waist down: a skirt or a coat's tails. `swing` is the share of the
    thighs' swing the hem takes; the runtime picks the thigh from the side of each vertex."""
    zs = [z0 + (z1 - z0) * t for t in (0.0, 0.18, 0.4, 0.65, 0.85, 1.0)]
    fig.pivots[B_SKIRT] = _v(0, 0, b['hip'])
    out_rings, ws = [], []
    top = torso_at(rows, z0)
    for i, z in enumerate(zs):
        t = (z0 - z) / (z0 - z1)
        fr0, bk0, sd0, p0 = torso_at(rows, max(z, rows[0][0] + 0.02))
        # follow the body at the top, then fall free toward the hem's flare
        fr = max(fr0, top[0]) * (1.03 + flare[0] * t)
        bk = max(bk0, top[1]) * (1.03 + flare[1] * t)
        sd = max(sd0, top[2]) * (1.03 + flare[2] * t)
        out_rings.append(section(_v(0, 0, z), _v(1, 0, 0), _v(0, 1, 0), fr, bk, sd, n, 2.2))
        ws.append(swing * t ** 1.3)
    # inner wall at the hem, so the hem has a thickness when seen from below
    hem_in = section(_v(0, 0, zs[-1] + 0.03), _v(1, 0, 0), _v(0, 1, 0),
                     *(c * 0.94 for c in (fr, bk, sd)), n, 2.2)
    rings = [list(reversed(r)) for r in out_rings + [hem_in]]
    fig.loft(rings, [B_SKIRT] * len(rings), ws + [ws[-1]], [reg] * (len(rings) - 1), cap0=False, cap1=False)


# ---- accessories (options) --------------------------------------------------------------------

def beanie(fig, b, cap=False):
    s = b['hs']
    hc = b['head']
    if not cap:
        line = lambda ar: hc + (0.050 - 0.012 * (1 - math.cos(ar)) * 0.5) * s
        shell(fig, b, line, lambda ar, t: (0.026 + 0.004 * t) * s, hc + 0.124 * s, R_ACC, rings=4)
        # the folded brim band
        rings = []
        for dz, out in ((0.0, 0.040), (0.026, 0.042)):
            ring = []
            for a in HEAD_ANG:
                ar = math.radians(a)
                z = line(ar) + dz * s
                p = _head_r(b, z, ar)
                axis = _v((0.012 + HEAD[5][4]) * s, 0, z)
                ring.append(p + (p - axis).normalized() * out * s)
            rings.append(ring)
        fig.loft(rings, [B_HEAD] * 2, [1.0] * 2, [R_ACC], cap0=False, cap1=False)
    else:
        line = lambda ar: hc + (0.066 - 0.03 * (1 - math.cos(ar)) * 0.5) * s
        shell(fig, b, line, lambda ar, t: (0.022 + 0.003 * t) * s, hc + 0.124 * s, R_ACC, rings=4)
        # the visor: a curved plate out front, tipped down a little
        z = line(0.0) + 0.002
        rows = []
        for r in (0.0, 1.0):
            ring = []
            for a in (-62, -30, 0, 30, 62):
                ar = math.radians(a)
                p = _head_r(b, z, ar)
                axis = _v((0.012 + HEAD[5][4]) * s, 0, z)
                d = (p - axis).normalized()
                q = p + d * (0.02 + r * 0.075 * math.cos(ar) ** 0.5) * s
                q.z -= r * 0.018 * s
                ring.append(q)
            rows.append(ring)
        top = [[p + _v(0, 0, 0.006 * s) for p in rows[0]], [p + _v(0, 0, 0.006 * s) for p in rows[1]]]
        for i in range(4):
            quad = lambda pts: fig.face([fig.vert(p, B_HEAD) for p in pts], R_ACC)
            quad([top[0][i + 1], top[0][i], top[1][i], top[1][i + 1]])          # top, facing up
            quad([rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i]])      # underside
            quad([top[1][i + 1], top[1][i], rows[1][i], rows[1][i + 1]])        # rim, facing out


def ponytail(fig, b):
    s = b['hs']
    hc = b['head']
    p0 = _v(-0.092 * s, 0, hc + 0.052 * s)
    pts = [p0, p0 + _v(-0.035, 0, -0.02) * s, p0 + _v(-0.05, 0, -0.08) * s,
           p0 + _v(-0.045, 0, -0.15) * s, p0 + _v(-0.03, 0, -0.21) * s]
    tube_along(fig, pts, [0.022 * s, 0.028 * s, 0.026 * s, 0.018 * s, 0.008 * s], B_HEAD, R_HAIR, n=7,
               fwd=Vector((0, 0, 1)), flat=0.8)
    # the band holding it
    tube_along(fig, [p0 + _v(0.004, 0, 0.001) * s, p0 + _v(-0.012, 0, -0.006) * s], [0.024 * s, 0.024 * s],
               B_HEAD, R_ACC, n=7, fwd=Vector((0, 0, 1)), tip=False)


def bun(fig, b):
    s = b['hs']
    c = _v(-0.078 * s, 0, b['head'] + 0.088 * s)
    r = 0.045 * s
    d = _v(-0.7, 0, 0.7).normalized()
    pts = [c - d * r * 0.9, c - d * r * 0.4, c + d * r * 0.3, c + d * r * 0.8]
    tube_along(fig, pts, [r * 0.55, r * 0.95, r * 0.9, r * 0.5], B_HEAD, R_HAIR, n=8, fwd=Vector((0, 1, 0)))


def long_hair(fig, b, rows):
    """A curtain of hair down the back to the shoulder blades: the top turns with the head, the rest
    lies on the back and turns with the chest."""
    s = b['hs']
    hc = b['head']
    z_top = hc - 0.02 * s
    z_bot = b['shoulder'] - 0.16 * s
    zs = [z_top + (z_bot - z_top) * t for t in (0.0, 0.3, 0.6, 0.85, 1.0)]
    rings, bones, ws = [], [], []
    for i, z in enumerate(zs):
        # just behind whatever is furthest back at this height: the skull, the nape, the shoulders
        hb = -_head_r(b, z, math.pi).x if z > b['head'] - 0.085 * s else 0.0
        tb = torso_at(rows, z)[1] + 0.012 * s if z < b['neck'] else 0.0
        x = -(max(hb, tb, 0.074 * s) + 0.018 * s)
        half_w = (0.076 + 0.03 * i / 4) * s
        depth = (0.03 - 0.008 * i / 4) * s
        c = _v(x, 0, z)
        # sections lie in the horizontal plane; loft runs down: counter-clockwise seen from below
        F, L, D = _frame(_v(0, 0, -1))
        rings.append(section(c, F, L, depth, depth, half_w, 10, 2.8))
        bones.append(B_HEAD if z > b['neck'] - 0.02 else B_CHEST)
        ws.append(1.0)
    fig.loft(rings, bones, ws, [R_HAIR] * (len(rings) - 1))


def beard(fig, b):
    """A shell over the jaw and chin."""
    s = b['hs']
    out = []
    for dz in (-0.122, -0.104, -0.08, -0.055, -0.035):
        ring = []
        for a in (-100, -70, -47, -29, -14, 0, 14, 29, 47, 70, 100):
            ar = math.radians(a)
            z = b['head'] + dz * s
            p = _head_r(b, z, ar)
            axis = _v((0.012 + HEAD[5][4]) * s, 0, z)
            t = 0.006 if dz > -0.05 and abs(a) < 25 else 0.009
            if dz < -0.11:
                p = p + _v(0.012 * s, 0, 0) * math.cos(ar)
            ring.append(p + (p - axis).normalized() * t * s)
        out.append(ring)
    # mouth gap: skip the front faces of the top band (a moustache line stays)
    for i in range(len(out) - 1):
        for k in range(len(out[0]) - 1):
            if i == 2 and k in (4, 5):
                continue
            fig.face([fig.vert(out[i][k], B_HEAD), fig.vert(out[i][k + 1], B_HEAD),
                      fig.vert(out[i + 1][k + 1], B_HEAD), fig.vert(out[i + 1][k], B_HEAD)], R_HAIR)


def scarf(fig, b, rows):
    s = b['hs']
    zc = b['neck'] - 0.015 * s
    r = 0.068 * s
    rings = [section(_v(-0.005, 0, zc + dz * s), _v(1, 0, 0), _v(0, 1, 0), r * k, r * k, r * k * 1.05, 12, 2.0)
             for dz, k in ((-0.025, 1.08), (0.0, 1.14), (0.03, 1.02))]
    fig.loft(rings, [B_CHEST] * 3, [1.0] * 3, [R_ACC] * 2, cap0=True, cap1=True)
    # a tail hanging down the chest, left of centre
    zs = [zc - 0.02 * s, zc - 0.10 * s, zc - 0.20 * s]
    pts, nrm = [], []
    for z in zs:
        p = torso_point(rows, z, math.radians(18), out=0.06)
        pts.append(p)
        nrm.append(_v(1, 0.25, 0))
    fig.ribbon(pts, nrm, 0.055 * s, B_CHEST, R_ACC, thick=0.012 * s)


def backpack(fig, b, rows):
    s = b['hs'] * (1.0 if b['hs'] > 0.9 else 0.92)
    zc = b['shoulder'] - 0.19 * s
    fr, bk, sd, p = torso_at(rows, zc)
    c = _v(-bk - 0.065 * s, 0, zc)
    X, Y, Z = _v(1, 0, 0), _v(0, 1, 0), _v(0, 0, 1)
    fig.box(c, (0.055 * s, 0.135 * s, 0.19 * s), (X, Y, Z), B_CHEST, R_ACC, taper=0.92)
    fig.box(c + _v(-0.07 * s, 0, -0.07 * s), (0.022 * s, 0.10 * s, 0.07 * s), (X, Y, Z), B_CHEST, R_ACC)
    # two straps from the top of the pack over the shoulders and down the chest to the armpits
    sh = b['shoulder']
    for side in (1, -1):
        y = side * 0.095 * s
        z_back = sh - 0.07 * s
        z_front = sh - 0.09 * s
        z_pit = sh - 0.21 * s
        pts = [_v(-torso_at(rows, z_back)[1] - 0.03 * s, y, z_back),
               _v(-0.045 * s, y, sh + 0.03 * s),
               _v(0.03 * s, y, sh + 0.025 * s),
               _v(torso_at(rows, z_front)[0] + 0.006, y * 1.05, z_front),
               _v(torso_at(rows, z_pit)[0] * 0.75 + 0.006, y * 1.55, z_pit)]
        nrm = [_v(-1, 0, 0.3), _v(-0.3, 0, 1), _v(0.4, 0, 1), _v(1, 0, 0.2), _v(1, side * 0.6, 0)]
        fig.ribbon(pts, nrm, 0.034 * s, B_CHEST, R_DARK, thick=0.008 * s)


def crossbag(fig, b, rows):
    """A bag on the left hip on a strap from the right shoulder: the bag swings a little (B_BAG)."""
    s = b['hs']
    zb = b['hip'] + 0.02 * s
    fr, bk, sd, p = torso_at(rows, zb)
    c = _v(0.0, sd + 0.04 * s, zb)
    fig.pivots[B_BAG] = c + _v(0, 0, 0.09 * s)
    X, Y, Z = _v(1, 0, 0), _v(0, 1, 0), _v(0, 0, 1)
    fig.box(c, (0.105 * s, 0.032 * s, 0.085 * s), (X, Y, Z), B_BAG, R_ACC, taper=0.96)
    fig.box(c + _v(0, 0.026 * s, 0.03 * s), (0.10 * s, 0.012 * s, 0.05 * s), (X, Y, Z), B_BAG, R_ACC)
    # the strap: front and back, from the right shoulder to the top of the bag
    for front in (1, -1):
        pts, nrm = [], []
        for t in (0.0, 0.2, 0.4, 0.6, 0.8, 1.0):
            z = b['shoulder'] + 0.02 * s + (zb + 0.09 * s - b['shoulder'] - 0.02 * s) * t
            a = (math.radians(-95) + math.radians(185) * t)
            if front < 0:
                a = math.radians(-95) - math.radians(175) * t
            q = torso_point(rows, z, a, out=0.07)
            if t == 0.0:
                q = _v(-0.005, -b['shoulder_y'] * 0.85, b['shoulder'] + 0.045 * s)
            pts.append(q)
            nrm.append(_v(math.cos(a), math.sin(a), 0.6 if t == 0 else 0))
        fig.ribbon(pts, nrm, 0.026 * s, B_CHEST, R_DARK, thick=0.006 * s)


# =============================================================================================
# variants
# =============================================================================================

VARIANTS = {
    'man-casual': dict(build='man', top='tee', bottom='jeans', legs=R_SKIN, shoes='sneaker', hair='short',
                       options=['cap', 'backpack', 'bag', 'beard']),
    'man-jacket': dict(build='man', top='jacket', bottom='trousers', legs=R_SKIN, shoes='shoe', hair='short',
                       options=['beanie', 'bag', 'backpack', 'beard', 'scarf']),
    'man-coat': dict(build='man', top='coat', bottom='trousers', legs=R_SKIN, shoes='shoe', hair='short',
                     options=['beanie', 'scarf', 'bag', 'beard']),
    'woman-dress': dict(build='woman', top='blouse', bottom='skirt', legs=R_UNDER, shoes='flat', hair='bob',
                        options=['ponytail', 'bun', 'long', 'bag', 'scarf']),
    'woman-casual': dict(build='woman', top='tee3', bottom='trousers', legs=R_SKIN, shoes='sneaker', hair='bob',
                         options=['ponytail', 'bun', 'long', 'bag', 'backpack', 'beanie']),
    'woman-coat': dict(build='woman', top='coat', bottom='tights', legs=R_UNDER, shoes='boot', hair='bob',
                       options=['ponytail', 'bun', 'long', 'beanie', 'scarf', 'bag']),
    'child': dict(build='child', top='tee', bottom='shorts', legs=R_SKIN, shoes='sneaker', hair='short',
                  options=['cap', 'backpack', 'ponytail']),
    'jogger': dict(build='athlete', top='tee', bottom='shorts', legs=R_SKIN, shoes='sneaker', hair='short',
                   options=['cap', 'ponytail']),
}

TOPS = {
    # where the top's hem sits, how loose it is, the sleeve's length from the shoulder (m; 0 = none)
    'tee': dict(hem=lambda b: b['hip'] - 0.005 * b['hs'], loose=1.045, sleeve=lambda b: 0.13 * b['limb'], sl=1.10),
    'tee3': dict(hem=lambda b: b['hip'] + 0.005 * b['hs'], loose=1.05,
                 sleeve=lambda b: b['upper'] + 0.12 * b['limb'], sl=1.07),
    'jacket': dict(hem=lambda b: b['hip'] - 0.055 * b['hs'], loose=1.085, sleeve=lambda b: 9.0, sl=1.08, collar='v'),
    'coat': dict(hem=lambda b: b['waist'] - 0.02 * b['hs'], loose=1.10, sleeve=lambda b: 9.0, sl=1.11, collar='coat'),
    'blouse': dict(hem=lambda b: b['waist'] - 0.04 * b['hs'], loose=1.04, sleeve=lambda b: 0.15 * b['limb'], sl=1.08),
}


def build(name):
    """One variant: returns the Fig (with pivots, foot and hand points) and its spec."""
    v = VARIANTS[name]
    b = BUILDS[v['build']]
    top = TOPS[v['top']]
    spec = dict(top=v['top'], bottom=v['bottom'], legs=v['legs'], shoes=v['shoes'], hem=top['hem'],
                loose=top['loose'], collar=top.get('collar'))
    fig = Fig()
    rows = torso_rows(b)
    fig.pivots[B_ROOT] = _v(0, 0, b['hip'])
    fig.pivots[B_CHEST] = _v(0, 0, b['waist'])
    fig.pivots[B_HEAD] = _v(-0.005, 0, b['neck'] - 0.02 * b['hs'])
    fig.pivots[B_SKIRT] = _v(0, 0, b['hip'])
    fig.pivots[B_BAG] = _v(0, 0, b['hip'])
    fig.pivots[B_TAIL] = _v(0, 0, 0)

    torso(fig, b, rows, spec)
    neck(fig, b, spec)
    head(fig, b)
    hair(fig, b, v['hair'])
    sleeve = top['sleeve'](b)
    arm_spec = dict(sleeve=sleeve, sleeve_loose=top['sl'])
    wrists = {}
    for side in (1, -1):
        wrists[side] = arm(fig, b, side, arm_spec)
    for side in (1, -1):
        leg(fig, b, side, spec)
    if v['bottom'] == 'skirt':
        skirt(fig, b, rows, b['waist'] - 0.04 * b['hs'], b['knee'] + 0.07, (0.55, 0.42, 0.34), R_BOTTOM, 0.75)
    if v['top'] == 'coat':
        skirt(fig, b, rows, b['waist'] - 0.035 * b['hs'], b['knee'] + 0.0, (0.24, 0.26, 0.20), R_TOP, 0.62)

    # options
    for o in v['options']:
        fig.opt = O[o]
        if o == 'cap':
            beanie(fig, b, cap=True)
        elif o == 'beanie':
            beanie(fig, b)
        elif o == 'ponytail':
            ponytail(fig, b)
        elif o == 'bun':
            bun(fig, b)
        elif o == 'long':
            long_hair(fig, b, rows)
        elif o == 'beard':
            beard(fig, b)
        elif o == 'scarf':
            scarf(fig, b, rows)
        elif o == 'backpack':
            backpack(fig, b, rows)
        elif o == 'bag':
            crossbag(fig, b, rows)
    fig.opt = 0
    # the right hand's palm, where a leash is held (rest pose)
    W = wrists[-1]
    fig.hand = W + _v(0.0, 0.0, -0.075 * b['limb'])
    fig.legs = (b['hip'] - b['knee'], b['knee'] - b['ankle'])
    fig.height = b['head'] + 0.13 * b['hs']
    fig.build = v['build']
    return fig, v


# =============================================================================================
# the dog
# =============================================================================================

def build_dog():
    """A medium dog (about 0.5 m at the shoulder), trotting on four two-part legs, tail up."""
    fig = Fig()
    X, Y, Z = _v(1, 0, 0), _v(0, 1, 0), _v(0, 0, 1)
    fig.pivots[B_ROOT] = _v(0, 0, 0.40)
    # body, rump to chest: x, top, bottom, side, centre z
    rows = [(-0.31, 0.045, 0.045, 0.05, 0.415), (-0.28, 0.08, 0.075, 0.08, 0.41), (-0.19, 0.088, 0.082, 0.092, 0.405),
            (-0.06, 0.084, 0.056, 0.088, 0.418), (0.07, 0.09, 0.088, 0.094, 0.405), (0.17, 0.09, 0.10, 0.088, 0.41),
            (0.235, 0.06, 0.07, 0.066, 0.44)]
    F, L, D = Z, -Y, X     # sections in the y-z plane, F up, L = D x F
    rings = [section(_v(x, 0, zc), F, L, top, bot, sd, 12, 2.2) for x, top, bot, sd, zc in rows]
    fig.loft(rings, [B_ROOT] * len(rings), [1.0] * len(rings), [R_TOP] * (len(rings) - 1),
             tip0=_v(-0.325, 0, 0.42), tip1=None)
    # neck up to the head
    pts = [_v(0.19, 0, 0.44), _v(0.26, 0, 0.50), _v(0.31, 0, 0.555)]
    tube_along(fig, pts, [0.068, 0.058, 0.05], [B_ROOT, B_HEAD, B_HEAD], R_TOP, n=10, w=[1.0, 0.5, 1.0],
               fwd=Vector((0, 0, 1)), tip=False)
    fig.pivots[B_HEAD] = _v(0.24, 0, 0.48)
    # collar round the neck
    tube_along(fig, [_v(0.215, 0, 0.455), _v(0.24, 0, 0.478)], [0.066, 0.064], B_ROOT, R_ACC, n=10,
               fwd=Vector((0, 0, 1)), tip=False)
    fig.collar = _v(0.25, 0, 0.47)
    # skull and muzzle
    hrows = [(0.27, 0.035, 0.035, 0.035, 0.575), (0.30, 0.05, 0.05, 0.052, 0.58), (0.345, 0.048, 0.045, 0.05, 0.582),
             (0.375, 0.03, 0.032, 0.034, 0.565), (0.42, 0.024, 0.026, 0.027, 0.556), (0.455, 0.02, 0.02, 0.022, 0.552)]
    rings = [section(_v(x, 0, zc), F, L, top, bot, sd, 10, 2.3) for x, top, bot, sd, zc in hrows]

    def face_reg(i):
        if i == 1:
            return lambda k: R_DARK if k in (1, 8) else R_TOP   # eyes, up and to each side
        if i >= 3:
            return R_HAIR
        return R_TOP
    fig.loft(rings, [B_HEAD] * len(rings), [1.0] * len(rings), [face_reg(i) for i in range(len(rings) - 1)],
             tip0=_v(0.255, 0, 0.578))
    # the nose
    tube_along(fig, [_v(0.452, 0, 0.556), _v(0.468, 0, 0.557)], [0.016, 0.012], B_HEAD, R_DARK, n=6)
    # ears: floppy flaps
    for side in (1, -1):
        e0 = _v(0.30, side * 0.042, 0.615)
        pts = [e0, e0 + _v(0.008, side * 0.03, -0.02), e0 + _v(0.012, side * 0.038, -0.06)]
        tube_along(fig, pts, [0.022, 0.026, 0.016], B_HEAD, R_HAIR, n=6, fwd=Vector((1, 0, 0)), flat=0.3)
    # legs: front pair straight, hind pair with the hock
    legs = [(0.15, 1, B_UARM_L, B_FARM_L, False), (0.15, -1, B_UARM_R, B_FARM_R, False),
            (-0.22, 1, B_THIGH_L, B_SHIN_L, True), (-0.22, -1, B_THIGH_R, B_SHIN_R, True)]
    for x, side, up, low, hind in legs:
        top = _v(x, side * 0.058, 0.39)
        if hind:
            mid = _v(x - 0.05, side * 0.06, 0.17)
            paw = _v(x - 0.02, side * 0.06, 0.03)
            pts_up = [top + _v(0.0, 0, 0.03), top + _v(0.02, 0, -0.08), mid]
            r_up = [0.05, 0.045, 0.026]
        else:
            mid = _v(x + 0.0, side * 0.06, 0.19)
            paw = _v(x + 0.01, side * 0.06, 0.03)
            pts_up = [top + _v(0, 0, 0.03), top + _v(0.0, 0, -0.08), mid]
            r_up = [0.045, 0.036, 0.026]
        fig.pivots[up] = top
        fig.pivots[low] = mid
        tube_along(fig, pts_up, r_up, [up, up, low], R_TOP, n=7, w=[1.0, 1.0, 0.5], fwd=Vector((1, 0, 0)), tip=False)
        tube_along(fig, [mid, mid + (paw - mid) * 0.5, paw], [0.025, 0.022, 0.02], low, R_TOP, n=7, fwd=Vector((1, 0, 0)),
                   tip=False)
        # paw
        pc = paw + _v(0.018, 0, -0.008)
        tube_along(fig, [pc - _v(0.03, 0, 0), pc, pc + _v(0.022, 0, 0)], [0.018, 0.024, 0.016], low, R_TOP, n=7,
                   fwd=Vector((0, 0, 1)), flat=0.75)
    # tail
    pts = [_v(-0.29, 0, 0.44), _v(-0.34, 0, 0.49), _v(-0.37, 0, 0.555), _v(-0.375, 0, 0.61)]
    tube_along(fig, pts, [0.024, 0.02, 0.016, 0.008], B_TAIL, R_TOP, n=6, fwd=Vector((0, 0, 1)))
    fig.pivots[B_TAIL] = _v(-0.29, 0, 0.44)
    fig.height = 0.62
    fig.legs = (0.2, 0.17)
    fig.foot = (-0.02, -0.03, 0.04, -0.03)
    fig.hand = fig.collar
    fig.build = 'dog'
    return fig


# =============================================================================================
# occlusion and output
# =============================================================================================

def _hemisphere(n=24):
    """cosine-weighted directions about +z (a fixed spiral, so the bake is deterministic)"""
    out = []
    ga = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        u = (i + 0.5) / n
        r = math.sqrt(u)
        a = i * ga
        out.append(Vector((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1 - u)))))
    return out


def bake_occlusion(fig, reach=0.16, n=24):
    """Per-vertex occlusion against the always-drawn body (options are occluded by it, never the other
    way round, so a backpack does not darken the back of someone not wearing one)."""
    bm = fig.bm
    bm.verts.index_update()
    bm.faces.index_update()
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    base = [f for f in bm.faces if all(v[fig.l_opt] == 0 for v in f.verts)]
    verts = [v.co.copy() for v in bm.verts]
    polys = [[v.index for v in f.verts] for f in base]
    tree = BVHTree.FromPolygons(verts, polys, all_triangles=False)
    dirs = _hemisphere(n)
    ao = []
    for v in bm.verts:
        nrm = v.normal
        if nrm.length < 1e-6:
            ao.append(1.0)
            continue
        q = nrm.to_track_quat('Z', 'Y')
        hit = 0.0
        o = v.co + nrm * 0.003
        for d in dirs:
            dw = q @ d
            loc, _, _, dist = tree.ray_cast(o, dw, reach)
            if loc is not None:
                hit += 1.0 - 0.6 * dist / reach
        ao.append(max(0.3, 1.0 - 0.9 * hit / n))
    return ao
