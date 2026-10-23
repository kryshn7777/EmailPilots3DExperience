"""An A320neo-class single-aisle airliner for the landing chapter (blender/make_airliner.py).

Modelled in metres from the A320neo's published dimensions (37.57 m long, 35.8 m span over the
sharklets, 11.76 m tall, 7.59 m main gear track, 12.64 m wheelbase) with the nose toward +X, Z up,
port toward +Y and the fuselage axis on z = 0; `finish` scales everything by S so the jet is 7.4
site units long with its tyres 0.72 below the axis (src/webgl/actors/Airliner.ts `AIRLINER`).

Parts, one mesh per material, named for it:

    skin        the lofted fuselage, fin, rudder and dorsal fillet, UV mapped onto the livery atlas
                (the fuselage unrolled into the top half, the fin projected side-on into the bottom)
    paint       vertex-coloured paint: wings, flaps, ailerons, tailplane, belly fairing, nacelles,
                pylons, flap-track fairings, sharklets, antennas, and the panel lines laid over them
    metal       bare metal: slats and leading edges, intake lips, core cowls, exhaust plugs, probes
    dark        intake ducts, fan frames, the APU exhaust, static wicks
    glass       the cockpit windows
    lit         lamp lenses (navigation, strobe, beacon, landing and taxi lights)
    fan_l/r     fan blades and spinner of each engine, about the engine axis (the site spins them)
    gear_paint  gear legs and doors;  gear_metal  chrome pistons, axles, torque links
    wheel_*     each tyre and hub on its own, origin at its axle (the site spins them)

Empties mark the lights (`nav_*`, `strobe_*`, `beacon_*`, `land_*`, `taxi`) and the fan axes.
`detail` is 'high' (about 60k triangles) or 'low' (the phone tier, a third of that).
"""
import math

import bmesh
import bpy
from mathutils import Vector

L = 37.57                      # length, metres
S = 7.4 / L                    # site units per metre
XN = L / 2                     # nose x
GROUND = -0.72 / S             # tyre contact, below the axis
W_F, H_F = 1.975, 2.07         # fuselage half width, half height
TAU = math.tau


def X(s):
    """station (metres aft of the nose) to x"""
    return XN - s


def clamp(x, a=0.0, b=1.0):
    return min(max(x, a), b)


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(a, b, x):
    t = clamp((x - a) / (b - a))
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


# the livery's palette (make_airliner.py paints the atlas from the same hexes)
HEX = dict(white='#f2f3f1', navy='#13306e', sky='#3e9be4', wing='#c3c8cf', wing_dk='#8e959f',
           grey='#d9dce0', light='#e6e8eb', metal='#c2c7ce', steel='#8a9099', dark='#22262c',
           duct='#3a3f47', black='#121418', tyre='#1b1c1f', hub='#a9aeb6', fan='#3b4048',
           chrome='#d4d8dd', blade='#646b75', red='#ff2a1a', green='#22ff66', lamp='#fff6e0', strobe='#f4f8ff')
C = {k: rgba(v) for k, v in HEX.items()}

ATLAS_FIN = (25.0, 37.9, 1.0, 8.4)     # fin projection: s0, s1, z0, z1 (metres) -> the atlas' lower half
FIN_ROW0 = 1040 / 2048                 # the fin rectangle starts this far down the atlas


def newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


class Part:
    """One mesh being built: faces with per-corner colour (and UVs on the skin)."""

    def __init__(self, name, uv=False):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new('Col')
        self.uv = self.bm.loops.layers.uv.new('UVMap') if uv else None

    def face(self, pts, col, uvs=None, n=None, smooth_shade=True):
        pts = [Vector(p) for p in pts]
        # drop repeated corners (poles of a lathe, the nose apex)
        keep = []
        for i, p in enumerate(pts):
            if all((p - pts[k]).length > 1e-7 for k in keep):
                keep.append(i)
        if len(keep) < 3:
            return None
        pts = [pts[i] for i in keep]
        cols = [col[i] for i in keep] if isinstance(col, list) else [col] * len(pts)
        uvs = [uvs[i] for i in keep] if uvs else None
        if n is not None and newell(pts).dot(Vector(n)) < 0:
            pts.reverse()
            cols.reverse()
            if uvs:
                uvs.reverse()
        try:
            f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        except ValueError:
            return None
        for i, loop in enumerate(f.loops):
            loop[self.col] = cols[i]
            if self.uv and uvs:
                loop[self.uv].uv = uvs[i]
        f.smooth = smooth_shade
        return f

    def grid(self, rows, col, uvs=None, n=None, smooth_shade=True, wrap=False):
        """Quads between consecutive rows (and, with wrap, between the last and first column).
        col: a colour or f(i, j); uvs: f(i, j) -> (u, v); n: f(centroid) -> outward hint."""
        faces = []
        nj = len(rows[0])
        for i in range(len(rows) - 1):
            for j in range(nj if wrap else nj - 1):
                j1 = (j + 1) % nj
                idx = [(i, j), (i, j1), (i + 1, j1), (i + 1, j)]
                pts = [rows[a][b] for a, b in idx]
                c = [col(a, b) for a, b in idx] if callable(col) else col
                uv = [uvs(a, b if not (wrap and b == 0 and j1 == 0) else nj) for a, b in idx] if uvs else None
                hint = n(sum(pts, Vector()) / 4) if n else None
                f = self.face(pts, c, uv, hint, smooth_shade)
                if f:
                    faces.append(f)
        return faces

    def cap(self, ring, col, n=None):
        f = self.face(list(ring), col, None, n, smooth_shade=False)
        return [f] if f else []

    def orient(self, faces):
        """Turn a closed shell outward (by the sign of its volume)."""
        vol = 0.0
        for f in faces:
            vs = [v.co for v in f.verts]
            for k in range(1, len(vs) - 1):
                vol += vs[0].dot(vs[k].cross(vs[k + 1]))
        if vol < 0:
            bmesh.ops.reverse_faces(self.bm, faces=faces)
        return faces

    def loft(self, sections, col, caps=True, uvs=None):
        """Closed loops stacked into a shell, capped at both ends, turned outward."""
        faces = self.grid(sections, col, uvs, wrap=True)
        if caps:
            c0 = col(0, 0) if callable(col) else col
            c1 = col(len(sections) - 1, 0) if callable(col) else col
            faces += self.cap(sections[0], c0)
            faces += self.cap(sections[-1], c1)
        return self.orient(faces)

    def lathe(self, centre, axis, profile, segs, col, theta0=0.0, closed=False):
        """Revolve (a, r) about `axis` through `centre`. Walk the profile with the outside on the
        left of travel (normal = (-dr, da)) and it faces out; `closed` shells are oriented anyway."""
        A = Vector(axis).normalized()
        U = Vector((0, 0, 1)).cross(A) if abs(A.z) < 0.9 else Vector((1, 0, 0)).cross(A)
        U.normalize()
        V = A.cross(U)
        c = Vector(centre)
        rows = []
        for a, r in profile:
            rows.append([c + A * a + (U * math.cos(theta0 + TAU * j / segs) + V * math.sin(theta0 + TAU * j / segs)) * r
                         for j in range(segs)])
        faces = self.grid(rows, col, wrap=True)
        return self.orient(faces) if closed else faces

    def tube(self, p0, p1, r0, r1=None, col=None, segs=10, caps=True):
        r1 = r0 if r1 is None else r1
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        length = d.length
        prof = [(0.0, 0.0), (0.0, r0), (length, r1), (length, 0.0)] if caps else [(0.0, r0), (length, r1)]
        return self.lathe(p0, d, prof, segs, col, closed=caps)

    def blob(self, c, r, col, segs=12, rings=6):
        c = Vector(c)
        rows = []
        for k in range(rings + 1):
            p = math.pi * k / rings - math.pi / 2
            rows.append([c + Vector((r[0] * math.cos(p) * math.cos(TAU * j / segs),
                                     r[1] * math.cos(p) * math.sin(TAU * j / segs), r[2] * math.sin(p)))
                         for j in range(segs)])
        return self.orient(self.grid(rows, col, wrap=True))

    def slab(self, corners, col):
        """A hexahedron from 8 corners: bottom loop 0-3, top loop 4-7."""
        q = [Vector(p) for p in corners]
        faces = []
        for idx in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
            f = self.face([q[i] for i in idx], col, smooth_shade=False)
            if f:
                faces.append(f)
        return self.orient(faces)

    def box(self, c, size, col):
        cx, cy, cz = c
        sx, sy, sz = (v / 2 for v in size)
        return self.slab([(cx - sx, cy - sy, cz - sz), (cx + sx, cy - sy, cz - sz), (cx + sx, cy + sy, cz - sz),
                          (cx - sx, cy + sy, cz - sz), (cx - sx, cy - sy, cz + sz), (cx + sx, cy - sy, cz + sz),
                          (cx + sx, cy + sy, cz + sz), (cx - sx, cy + sy, cz + sz)], col)

    def finish(self, collection, origin=None, sharp_deg=48):
        if not self.bm.faces:
            self.bm.free()
            return None
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-6)
        o = Vector(origin) if origin is not None else Vector((0, 0, 0))
        for v in self.bm.verts:
            v.co = (v.co - o) * S
        lim = math.radians(sharp_deg)
        for e in self.bm.edges:
            if len(e.link_faces) == 2:
                try:
                    e.smooth = e.calc_face_angle() < lim
                except ValueError:
                    e.smooth = False
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        if mesh.color_attributes:
            mesh.color_attributes.active_color = mesh.color_attributes[0]
            mesh.color_attributes.render_color_index = 0
        obj = bpy.data.objects.new(self.name, mesh)
        obj.location = o * S
        collection.objects.link(obj)
        return obj


# ---- fuselage -----------------------------------------------------------------------------------

def fus_dims(s):
    """half width, crown z and keel z at station s"""
    tw = clamp(s / 5.4)
    w = W_F * (1 - (1 - tw) ** 2.4) ** 0.5
    tb = clamp(s / 5.9)
    bot = -0.55 + (0.55 - H_F) * (1 - (1 - tb) ** 2.2) ** 0.5
    tt = clamp(s / 7.6)
    top = -0.55 + (H_F + 0.55) * (1 - (1 - tt) ** 2.0) ** 0.6
    if s > 23.0:
        bot = lerp(bot, 0.95, ((s - 23.0) / (L - 23.0)) ** 1.55)
    if s > 29.5:
        top = lerp(top, 1.50, ((s - 29.5) / (L - 29.5)) ** 1.7)
    if s > 25.0:
        w = lerp(w, 0.29, ((s - 25.0) / (L - 25.0)) ** 1.35)
    return w, top, bot


def fus_pt(s, phi, off=0.0):
    """phi runs round the hull from the keel (0) up the starboard side (pi/2) over the crown (pi)."""
    w, top, bot = fus_dims(s)
    zc, h = (top + bot) / 2, (top - bot) / 2
    p = Vector((X(s), -w * math.sin(phi), zc - h * math.cos(phi)))
    if off:
        p += fus_n(s, phi) * off
    return p


def fus_n(s, phi):
    e = 1e-3
    ds = fus_pt(min(s + e, L), phi) - fus_pt(max(s - e, 0.0), phi)
    dp = fus_pt(s, phi + e) - fus_pt(s, phi - e)
    n = dp.cross(ds)
    return n.normalized() if n.length > 1e-12 else Vector((1, 0, 0))


def phi_at(s, z, side=1):
    """the angle at which the hull at station s passes height z (side 1 starboard, -1 port)"""
    w, top, bot = fus_dims(s)
    zc, h = (top + bot) / 2, (top - bot) / 2
    a = math.acos(clamp((zc - z) / h, -1.0, 1.0))
    return a if side > 0 else TAU - a


def fus_uv(s, phi):
    return ((L - s) / L, 1 - phi / (2 * TAU))


def fuselage(skin, dark, metal, D):
    st = [0.0, 0.04, 0.12, 0.25, 0.42, 0.62, 0.85, 1.1, 1.4, 1.75, 2.1, 2.5, 2.9, 3.3, 3.7, 4.1, 4.6, 5.1,
          5.7, 6.4, 7.2, 8.2, 9.4, 10.8, 12.4, 14.0, 15.6, 17.2, 18.8, 20.4, 22.0, 23.2, 24.3, 25.4, 26.5,
          27.6, 28.7, 29.8, 30.8, 31.8, 32.7, 33.6, 34.4, 35.2, 35.9, 36.5, 37.0, 37.35, L]
    if D['low']:
        st = st[:3] + st[3:-3:2] + st[-3:]
    n = D['fus']
    rows = [[fus_pt(s, TAU * j / n) for j in range(n + 1)] for s in st]
    skin.grid(rows, (1, 1, 1, 1), uvs=lambda i, j: fus_uv(st[i], TAU * j / n))

    # the APU exhaust in the tail cone: a metal lip and a dark pipe
    ring = [fus_pt(L, TAU * j / n) for j in range(n)]
    w, top, bot = fus_dims(L)
    centre = Vector((X(L), 0, (top + bot) / 2))
    inner = [centre + (p - centre) * 0.72 for p in ring]
    back = Vector((-1, 0, 0))
    for j in range(n):
        j1 = (j + 1) % n
        metal.face([ring[j], ring[j1], inner[j1], inner[j]], C['steel'], n=back)
    deep = [p + Vector((0.35, 0, 0)) for p in inner]
    for j in range(n):
        j1 = (j + 1) % n
        q = [inner[j], inner[j1], deep[j1], deep[j]]
        dark.face(q, C['black'], n=centre - sum(q, Vector()) / 4)
    dark.face(deep, C['black'], n=back)


# cockpit windows, as (s, phi) corner loops on the starboard side; the port side mirrors them
def cockpit_windows():
    p = math.pi

    def sz(s, z):
        return (s, phi_at(s, z))
    return [
        # a windscreen panel, from the centre post out to the corner post
        [(2.05, p - 0.04), sz(2.42, 0.78), sz(3.0, 1.22), (2.86, p - 0.04)],
        # the sliding side window, then the small rear one
        [sz(2.53, 0.75), sz(3.48, 0.80), sz(3.62, 1.26), sz(3.10, 1.21)],
        [sz(3.61, 0.81), sz(4.18, 0.85), sz(4.0, 1.19), sz(3.74, 1.26)],
    ]


def cockpit_glass(glass, D):
    k = 4 if not D['low'] else 2
    for win in cockpit_windows():
        for mirror in (False, True):
            def at(u, v):
                (s0, f0), (s1, f1), (s2, f2), (s3, f3) = win
                s = lerp(lerp(s0, s1, u), lerp(s3, s2, u), v)
                f = lerp(lerp(f0, f1, u), lerp(f3, f2, u), v)
                if mirror:
                    f = TAU - f
                return s, f
            rows = []
            for a in range(k + 1):
                rows.append([fus_pt(*at(b / k, a / k), off=0.014) for b in range(k + 1)])
            sm, fm = at(0.5, 0.5)
            nh = fus_n(sm, fm)
            glass.grid(rows, C['black'], n=lambda c, nh=nh: nh)


# ---- airfoils -----------------------------------------------------------------------------------

AF_X = [0.0, 0.0025, 0.0075, 0.015, 0.03, 0.05, 0.075, 0.11, 0.15, 0.2, 0.26, 0.33, 0.4, 0.48, 0.56, 0.64, 0.72, 0.8,
        0.87, 0.93, 0.97, 1.0]


def af_thick(x):
    return 5 * (0.2969 * math.sqrt(x) - 0.1260 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4) + 0.0015 * x


def af_camber(x, m=0.02, p=0.6):
    return m / p ** 2 * (2 * p * x - x * x) if x < p else m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x * x)


def af_loop(c0, c1, t, low=False, sym=False):
    """A closed chord-section loop for the chord fractions c0..c1: upper surface aft to fore,
    then lower fore to aft. Returns (x, z) per chord."""
    xs = [x for x in (AF_X[::3] + [0.0025, 0.0075] if low else AF_X) if c0 + 1e-6 < x < c1 - 1e-6]
    xs = sorted(set([c0] + xs + [c1]))
    cam = (lambda x: 0.0) if sym else af_camber
    lo = 1.0 if sym else 0.86
    upper = [(x, cam(x) + af_thick(x) * t) for x in reversed(xs)]
    lower = [(x, cam(x) - af_thick(x) * t * lo) for x in xs]
    if c0 == 0.0:
        lower = lower[1:]
    return upper + lower


# ---- wings --------------------------------------------------------------------------------------

def wing_le(y):
    return 12.45 + max(0.0, y - 1.9) * 0.52


def wing_te(y):
    return 19.4 if y <= 6.3 else 19.4 + (y - 6.3) * 0.2233


def wing_z(y):
    return -1.30 + max(0.0, y - 1.9) * 0.0892


def wing_t(y):
    return lerp(0.15, 0.125, clamp((y - 1.9) / 4.4)) if y < 6.3 else lerp(0.125, 0.105, clamp((y - 6.3) / 10.75))


TIP_Y = 17.05


def wing_pt(side, y, x, zr):
    c = wing_te(y) - wing_le(y)
    return Vector((X(wing_le(y) + x * c), -side * y, wing_z(y) + zr * c))


def upper_z(y, x):
    return wing_z(y) + (af_camber(x) + af_thick(x) * wing_t(y)) * (wing_te(y) - wing_le(y))


def lower_z(y, x):
    return wing_z(y) + (af_camber(x) - af_thick(x) * wing_t(y) * 0.86) * (wing_te(y) - wing_le(y))


def wing_piece(part, side, y0, y1, c0, c1, col, D):
    ys = sorted(set([y0, y1] + [b for b in (1.9, 6.3) if y0 < b < y1]))
    secs = []
    for y in ys:
        secs.append([wing_pt(side, y, x, z) for x, z in af_loop(c0, c1, wing_t(y), D['low'])])
    return part.loft(secs, col)


def strip(part, pts, width_dir, col, n_hint, w=0.035):
    """a thin painted line along pts, `width_dir` across it"""
    rows = [[p - width_dir * (w / 2), p + width_dir * (w / 2)] for p in pts]
    part.grid(rows, col, n=lambda c: n_hint, smooth_shade=False)


def wing(paint, metal, dark, side, D):
    G = 0.025  # gap either side of a moving surface
    # the box, and the fixed leading and trailing edges
    for y0, y1, c0, c1 in ((0.9, 2.0, 0.0, 1.0), (2.0, 6.3, 0.13, 0.70), (6.3, 13.0, 0.13, 0.74),
                           (13.0, 16.2, 0.13, 0.76), (16.2, TIP_Y, 0.13, 1.0)):
        wing_piece(paint, side, y0, y1, c0, c1, C['wing'], D)
    # slats (and the fixed leading edge by the pylon and at the tip), bare metal
    for y0, y1 in ((2.0, 5.45), (5.45, 6.05), (6.05, 8.65), (8.65, 11.15), (11.15, 13.75), (13.75, 16.4), (16.4, TIP_Y)):
        a = y0 + (G if y0 > 2.0 else 0.0)
        b = y1 - (G if y1 < TIP_Y else 0.0)
        wing_piece(metal, side, a, b, 0.0, 0.13 - 0.004, C['metal'], D)
    # flaps and the aileron
    for y0, y1, c0 in ((2.0, 6.3, 0.70), (6.3, 13.0, 0.74), (13.0, 16.2, 0.76)):
        wing_piece(paint, side, y0 + G, y1 - G, c0 + 0.006, 1.0, C['wing'], D)

    up = Vector((0, 0, 1))
    if not D['low']:
        # spoiler panels on the upper skin ahead of the flaps, and a walkway by the root
        lines = []
        for y0, y1 in ((2.4, 5.3), (6.6, 8.2), (8.3, 9.9), (10.0, 11.6), (11.7, 13.0)):
            cr = 0.70 if y1 <= 6.3 else 0.74
            lines.append(('span', 0.57, y0, y1))
            lines.append(('chord', y0, 0.57, cr))
            lines.append(('chord', y1, 0.57, cr))
        for y0, y1, x0, x1 in ((2.3, 3.7, 0.24, 0.52),):
            lines += [('span', x0, y0, y1), ('span', x1, y0, y1), ('chord', y0, x0, x1), ('chord', y1, x0, x1)]
        lines.append(('span', 0.62, 13.2, 16.0))     # the aileron's balance panel
        for kind, a, b0, b1 in lines:
            if kind == 'span':
                pts = [wing_pt(side, lerp(b0, b1, k / 4), a, 0) for k in range(5)]
                pts = [Vector((p.x, p.y, upper_z(-p.y * side, a) + 0.012)) for p in pts]
                strip(paint, pts, Vector((1, 0, 0)), C['wing_dk'], up)
            else:
                pts = []
                for k in range(4):
                    x = lerp(b0, b1, k / 3)
                    p = wing_pt(side, a, x, 0)
                    pts.append(Vector((p.x, p.y, upper_z(a, x) + 0.012)))
                strip(paint, pts, Vector((0, 1, 0)), C['wing_dk'], up)

    # flap-track fairings: canoes under the trailing edge
    for yk in (4.1, 8.0, 10.4, 12.6):
        le, te = wing_le(yk), wing_te(yk)
        c = te - le
        s0, s1 = le + 0.5 * c, te + (1.5 if yk < 9 else 1.25)
        segs = D['canoe']
        secs = []
        nt = 10 if not D['low'] else 6
        for k in range(nt + 1):
            t = k / nt
            s = lerp(s0, s1, t)
            x = clamp((s - le) / c, 0.0, 1.0)
            top = lower_z(yk, x) + 0.06 if s < te else lerp(lower_z(yk, 1.0), lower_z(yk, 1.0) - 0.3, (s - te) / (s1 - te))
            env = math.sin(math.pi * t) ** 0.6
            depth = 0.62 * env * (1 - 0.25 * t)
            rz = depth / 2 + 0.02
            zc = top - depth / 2
            ry = 0.21 * math.sin(math.pi * t) ** 0.5
            secs.append([Vector((X(s), -side * yk + ry * math.cos(TAU * j / segs), zc + rz * math.sin(TAU * j / segs)))
                         for j in range(segs)])
        paint.orient(paint.grid(secs, C['wing'], wrap=True))

    # the sharklet: a blended curve up from the tip into a swept, canted fin
    yt, zt = TIP_Y, wing_z(TIP_Y)
    R, turn = 0.6, math.radians(80)
    arc = R * turn
    total = arc + 2.05
    secs, cols = [], []
    nsec = 10 if not D['low'] else 6
    for k in range(nsec + 1):
        ell = total * (k / nsec) ** 1.15
        if ell <= arc:
            a = ell / R
            py, pz = yt + R * math.sin(a), zt + R * (1 - math.cos(a))
            dy, dz = math.cos(a), math.sin(a)
        else:
            a = turn
            py = yt + R * math.sin(a) + (ell - arc) * math.cos(a)
            pz = zt + R * (1 - math.cos(a)) + (ell - arc) * math.sin(a)
            dy, dz = math.cos(a), math.sin(a)
        ny, nz = -dz, dy
        ch = lerp(wing_te(yt) - wing_le(yt), 0.52, smooth(0.15, total, ell))
        sle = wing_le(yt) + max(0.0, ell - 0.12) * 0.85
        t = lerp(0.105, 0.08, ell / total)
        loop = []
        for x, zr in af_loop(0.0, 1.0, t, D['low']):
            loop.append(Vector((X(sle + x * ch), -side * (py + ny * zr * ch), pz + nz * zr * ch)))
        secs.append(loop)
        cols.append(C['wing'] if k < 2 else C['navy'])
    paint.loft(secs, lambda i, j: cols[i])

    if not D['low']:
        # static wicks off the tip and the aileron
        for yk in (14.4, 15.6, 16.7):
            p = wing_pt(side, yk, 1.0, 0)
            dark.tube(p + Vector((0.05, 0, 0)), p + Vector((-0.32, 0, -0.02)), 0.012, 0.008, C['black'], segs=4)


# ---- tail ---------------------------------------------------------------------------------------

def tailplane(paint, dark, side, D):
    def le(y):
        return 32.25 + y * 0.62

    def chord(y):
        return lerp(3.85, 1.35, y / 6.22)

    def pt(y, x, zr):
        c = chord(y)
        return Vector((X(le(y) + x * c), -side * y, 0.85 + y * 0.105 + zr * c))

    def piece(y0, y1, c0, c1):
        secs = [[pt(y, x, z) for x, z in af_loop(c0, c1, 0.10, D['low'], sym=True)] for y in (y0, y1)]
        paint.loft(secs, C['light'])

    piece(0.0, 0.8, 0.0, 1.0)
    piece(0.8, 6.0, 0.0, 0.70)
    piece(6.0, 6.22, 0.0, 1.0)
    piece(0.82, 5.98, 0.706, 1.0)        # elevator
    if not D['low']:
        p = pt(6.0, 1.0, 0)
        dark.tube(p + Vector((0.05, 0, 0)), p + Vector((-0.3, 0, 0)), 0.011, 0.008, C['black'], segs=4)


def fin_uv(p):
    s0, s1, z0, z1 = ATLAS_FIN
    s = XN - p.x
    u = (s - s0) / (s1 - s0)
    v = (p.z - z0) / (z1 - z0)
    return (u, (1 - FIN_ROW0) * v)


def fin(skin, dark, D):
    def le(z):
        return 29.4 + (z - 1.6) * 0.66

    def chord(z):
        return lerp(5.9, 2.0, (z - 1.6) / 6.5)

    def pt(z, x, yr):
        c = chord(z)
        return Vector((X(le(z) + x * c), yr * c, z))

    def piece(z0, z1, c0, c1):
        secs = [[pt(z, x, zr) for x, zr in af_loop(c0, c1, 0.11, D['low'], sym=True)] for z in (z0, z1)]
        faces = skin.loft(secs, (1, 1, 1, 1))
        for f in faces:
            for loop in f.loops:
                loop[skin.uv].uv = fin_uv(loop.vert.co)

    piece(1.4, 2.15, 0.0, 1.0)
    piece(2.15, 7.9, 0.0, 0.70)
    piece(7.9, 8.1, 0.0, 1.0)
    piece(2.17, 7.88, 0.706, 1.0)        # rudder
    # the dorsal fillet running forward into the crown
    secs = []
    for k in range(9):
        t = k / 8
        s = lerp(25.4, 30.5, t)
        h = 0.98 * t ** 2.2
        base = fus_dims(s)[1] - 0.06
        hw = 0.1 + 0.2 * t
        secs.append([Vector((X(s), y, base + z)) for y, z in (
            (hw, 0.0), (0.45 * hw, 0.55 * h + 0.03), (0.0, h + 0.04), (-0.45 * hw, 0.55 * h + 0.03), (-hw, 0.0), (0.0, -0.25))])
    faces = skin.loft(secs, (1, 1, 1, 1))
    for f in faces:
        for loop in f.loops:
            loop[skin.uv].uv = fin_uv(loop.vert.co)
    if not D['low']:
        for z in (6.6, 7.5):
            p = pt(z, 1.0, 0)
            dark.tube(p + Vector((0.05, 0, 0)), p + Vector((-0.3, 0, 0.02)), 0.011, 0.008, C['black'], segs=4)


# ---- belly fairing ------------------------------------------------------------------------------

def belly_fairing(paint, D):
    s0, s1 = 9.6, 23.4
    secs = []
    n = D['belly']
    for k in range(13):
        t = k / 12
        s = lerp(s0, s1, t)
        e = math.sin(math.pi * clamp(t * 1.25 if t < 0.4 else 0.5 + (t - 0.4) / 0.6 * 0.5)) ** 0.55
        bw = lerp(1.25, 2.18, e)
        bot = lerp(-1.80, -2.36, e)
        top, zc = -0.66, -1.25
        loop = []
        for j in range(n):
            a = TAU * j / n
            ca, sa = math.cos(a), math.sin(a)
            y = bw * math.copysign(abs(ca) ** (2 / 2.6), ca)
            hz = (top - zc) if sa > 0 else (zc - bot)
            z = zc + hz * math.copysign(abs(sa) ** (2 / 2.6), sa)
            loop.append(Vector((X(s), y, z)))
        secs.append(loop)
    paint.loft(secs, C['navy'])


# ---- engines ------------------------------------------------------------------------------------

ENG_Y, ENG_Z = 5.75, -2.0
S_LIP, S_FAN = 10.3, 11.35


def nacelle_r(s):
    """outer radius of the fan cowl"""
    pts = [(10.28, 1.02), (10.34, 1.075), (10.45, 1.12), (10.7, 1.17), (11.1, 1.205), (11.7, 1.215),
           (12.4, 1.205), (13.1, 1.165), (13.6, 1.11), (13.95, 1.05)]
    for (a, ra), (b, rb) in zip(pts, pts[1:]):
        if s <= b:
            return lerp(ra, rb, clamp((s - a) / (b - a)))
    return pts[-1][1]


def engine(paint, metal, dark, fan, side, D, coll):
    y = -side * ENG_Y
    ctr = Vector((XN, y, ENG_Z))       # a measured from the nose, so a = -s along +x... see `ax`
    segs = D['nac']

    def ax(s):
        return X(s) - XN               # axial coordinate along +x

    A = (1, 0, 0)
    # cowl (navy), the lip (bare metal), the duct (dark); walked with the outside on the left
    cowl = [(13.95, 1.05), (13.6, 1.11), (13.1, 1.165), (12.4, 1.205), (11.7, 1.215), (11.1, 1.205), (10.7, 1.17)]
    lip = [(10.7, 1.17), (10.52, 1.135), (10.40, 1.10), (10.33, 1.06), (10.29, 1.025), (10.30, 0.99),
           (10.36, 0.968), (10.48, 0.958), (10.65, 0.962)]
    duct = [(10.65, 0.962), (10.95, 0.975), (11.3, 0.985), (11.7, 0.985), (12.6, 0.98), (13.4, 0.985), (13.9, 1.025),
            (13.95, 1.05)]
    paint.lathe(ctr, A, [(ax(s), r) for s, r in cowl], segs, C['navy'])
    metal.lathe(ctr, A, [(ax(s), r) for s, r in lip], segs, C['metal'])
    dark.lathe(ctr, A, [(ax(s), r) for s, r in duct], segs, C['duct'])
    # the fan frame behind the blades, and the core cowl, nozzle and plug
    dark.lathe(ctr, A, [(ax(11.62), 0.99), (ax(11.62), 0.36)], segs, C['black'])
    metal.lathe(ctr, A, [(ax(15.28), 0.565), (ax(14.6), 0.70), (ax(13.95), 0.78), (ax(13.3), 0.80),
                         (ax(12.9), 0.79), (ax(12.9), 0.30)], segs, C['steel'])
    dark.lathe(ctr, A, [(ax(15.28), 0.44), (ax(15.28), 0.565)], segs, C['black'])
    metal.lathe(ctr, A, [(ax(16.35), 0.0), (ax(16.0), 0.22), (ax(15.6), 0.37), (ax(15.2), 0.44), (ax(15.2), 0.0)],
                segs, C['steel'], closed=True)

    if not D['low']:
        # cowl seams: the inlet / fan cowl split and the thrust reverser's translating sleeve
        for s in (11.2, 12.55):
            r = nacelle_r(s) + 0.008
            rows = []
            for j in range(segs + 1):
                a = TAU * j / segs
                d = Vector((0, math.cos(a), math.sin(a)))
                rows.append([ctr + Vector((ax(s - 0.02), 0, 0)) + d * r, ctr + Vector((ax(s + 0.02), 0, 0)) + d * r])
            paint.grid([list(r) for r in zip(*rows)], C['black'],
                       n=lambda c: Vector((0, c.y - ctr.y, c.z - ctr.z)), smooth_shade=False)
        for a in (math.radians(100), math.radians(80), math.radians(-90)):
            d = Vector((0, math.cos(a), math.sin(a)))
            pts = [ctr + Vector((ax(s), 0, 0)) + d * (nacelle_r(s) + 0.008) for s in (11.2, 11.9, 12.55, 13.2, 13.85)]
            strip(paint, pts, Vector((0, -d.z, d.y)), C['black'], d, w=0.03)
        # the nacelle strake on the inboard side
        a = math.radians(35)
        d = Vector((0, side * math.cos(a), math.sin(a)))
        b0 = ctr + Vector((ax(10.95), 0, 0)) + d * (nacelle_r(10.95) - 0.02)
        b1 = ctr + Vector((ax(11.9), 0, 0)) + d * (nacelle_r(11.9) - 0.02)
        t0 = b0 + d * 0.06 + Vector((-0.1, 0, 0))
        t1 = b1 + d * 0.42
        thin = Vector((0, -d.z, d.y)) * 0.015
        paint.slab([b0 - thin, b1 - thin, b1 + thin, b0 + thin, t0 - thin, t1 - thin, t1 + thin, t0 + thin], C['navy'])

    # the fan: spinner and blades about the engine axis, built around the axis point itself
    hub = Vector((X(S_FAN), y, ENG_Z))
    fp = fan
    spin = [(-0.25, 0.0), (-0.25, 0.37), (0.0, 0.37), (0.2, 0.33), (0.42, 0.2), (0.56, 0.08), (0.62, 0.0)]
    rows = []
    sseg = D['spin']
    for a, r in spin:
        rows.append([hub + Vector((a, r * math.cos(TAU * j / sseg), r * math.sin(TAU * j / sseg))) for j in range(sseg)])

    def spin_col(i, j):
        if D['low']:
            return C['dark']
        ang = (TAU * j / sseg - spin[min(i, len(spin) - 1)][0] * 7.5) % TAU
        return C['white'] if ang < 0.5 and i >= 2 else C['dark']
    fp.orient(fp.grid(rows, spin_col, wrap=True))
    nb = D['blades']
    if nb:
        for b in range(nb):
            th0 = TAU * b / nb
            secs = []
            for k in range(7):
                q = k / 6
                r = lerp(0.36, 0.955, q)
                beta = math.radians(lerp(28, 64, q))
                th = th0 + side * 0.22 * q ** 2
                half = lerp(0.14, 0.21, q ** 0.7)
                tk = lerp(0.03, 0.01, q)
                loop = []
                for ca, cb in ((half, 0.0), (0.4 * half, tk), (-0.5 * half, tk), (-half, 0.0), (-0.5 * half, -tk * 0.6),
                               (0.4 * half, -tk * 0.6)):
                    # chord along (axial cos beta, tangential sin beta), thickness across it
                    da = ca * math.cos(beta) - cb * math.sin(beta)
                    dt = ca * math.sin(beta) + cb * math.cos(beta)
                    t = th + dt / r
                    loop.append(hub + Vector((da - 0.02, r * math.cos(t), r * math.sin(t))))
                secs.append(loop)
            fp.loft(secs, C['blade'])
    else:
        fp.lathe(hub, A, [(-0.05, 0.37), (-0.05, 0.96)], 16, C['fan'])
    e = bpy.data.objects.new('fanaxis_' + ('r' if side > 0 else 'l'), None)
    e.location = hub * S
    coll.objects.link(e)


def pylon(paint, side, D):
    y = ENG_Y
    secs = []
    n = 10 if not D['low'] else 6
    for k in range(n + 1):
        t = k / n
        s = lerp(10.95, 18.3, t)
        # the top: up the front of the wing to its leading edge, then along the lower skin
        le = wing_le(y)
        c = wing_te(y) - le
        if s < le:
            top = lerp(ENG_Z + nacelle_r(10.95) - 0.1, wing_z(y) + 0.05, smooth(10.95, le, s) ** 0.8)
        else:
            top = lower_z(y, clamp((s - le) / c)) + 0.08
        if s < 13.95:
            bot = ENG_Z + nacelle_r(s) - 0.12
        elif s < 15.3:
            bot = ENG_Z + lerp(0.76, 0.6, (s - 13.95) / 1.35)
        else:
            bot = lerp(ENG_Z + 0.6, lower_z(y, clamp((18.3 - le) / c)) - 0.02, smooth(15.3, 18.3, s))
        hw = 0.26 * math.sin(math.pi * clamp(0.08 + 0.92 * t)) ** 0.35
        zc, hz = (top + bot) / 2, max(0.01, (top - bot) / 2)
        loop = []
        for j in range(10):
            a = TAU * j / 10
            ca, sa = math.cos(a), math.sin(a)
            loop.append(Vector((X(s), -side * y + hw * math.copysign(abs(ca) ** 0.6, ca), zc + hz * math.copysign(abs(sa) ** 0.5, sa))))
        secs.append(loop)
    paint.loft(secs, C['grey'])


# ---- gear ---------------------------------------------------------------------------------------

def wheel(coll, name, centre, R, wdt, D):
    part = Part(name)
    k = R / 0.585
    hw = wdt / 2
    prof = [(-0.09 * k, 0.0), (-0.09 * k, 0.09 * k), (-0.12 * k, 0.15 * k), (-0.11 * k, 0.31 * k), (-hw * 0.86, 0.33 * k),
            (-hw * 0.9, 0.37 * k), (-hw, 0.46 * k), (-hw * 0.95, 0.54 * k), (-hw * 0.78, R), (hw * 0.78, R),
            (hw * 0.95, 0.54 * k), (hw, 0.46 * k), (hw * 0.9, 0.37 * k), (hw * 0.86, 0.33 * k), (0.11 * k, 0.31 * k),
            (0.12 * k, 0.15 * k), (0.09 * k, 0.09 * k), (0.09 * k, 0.0)]
    cols = [C['steel'], C['steel'], C['hub'], C['hub'], C['hub'], C['tyre'], C['tyre'], C['tyre'], C['tyre'], C['tyre'],
            C['tyre'], C['tyre'], C['tyre'], C['hub'], C['hub'], C['hub'], C['steel'], C['steel']]
    # the axle is y (three's z): build about the origin, then `finish` moves it to the axle
    rows = []
    n = D['wheel']
    for a, r in prof:
        rows.append([Vector((r * math.cos(TAU * j / n), a, r * math.sin(TAU * j / n))) + centre for j in range(n)])
    part.orient(part.grid(rows, lambda i, j: cols[i], wrap=True))
    return part.finish(coll, origin=centre, sharp_deg=40)


def gear(gp, gm, coll, D):
    # mains: a leg on each side at 17.8 m with twin wheels, track 7.59 m
    RM, RN = 0.585, 0.38
    sm, sn = 17.8, 5.07
    axle_m = GROUND + RM
    axle_n = GROUND + RN
    wheels = []
    for side in (1, -1):
        yg = 3.795
        Y = -side * yg
        x = X(sm)
        gp.tube((x, Y, -1.25), (x, Y, -2.55), 0.15, 0.14, C['grey'], segs=D['strut'])
        gm.tube((x, Y, -2.5), (x, Y, axle_m + 0.12), 0.105, None, C['chrome'], segs=D['strut'])
        gm.tube((x, Y - 0.62, axle_m), (x, Y + 0.62, axle_m), 0.075, None, C['steel'], segs=D['strut'])
        gp.box((x, Y, axle_m + 0.1), (0.36, 0.42, 0.22), C['grey'])
        # side stay up to the belly
        gp.tube((x + 0.05, Y, -2.25), (x + 0.15, -side * 1.95, -1.75), 0.06, 0.06, C['grey'], segs=6)
        if not D['low']:
            # torque links ahead of the piston
            for z0, z1 in ((-2.48, -2.78), (-2.78, axle_m + 0.12)):
                gm.slab([(x + 0.13, Y - 0.04, z0), (x + 0.22, Y - 0.04, (z0 + z1) / 2), (x + 0.22, Y + 0.04, (z0 + z1) / 2),
                         (x + 0.13, Y + 0.04, z0), (x + 0.13, Y - 0.04, z1), (x + 0.22, Y - 0.04, (z0 + z1) / 2 - 0.02),
                         (x + 0.22, Y + 0.04, (z0 + z1) / 2 - 0.02), (x + 0.13, Y + 0.04, z1)], C['chrome'])
            # brake housings inside the hubs
            for dy in (-0.46, 0.46):
                gm.tube((x, Y + dy - 0.09, axle_m), (x, Y + dy + 0.09, axle_m), 0.25, None, C['steel'], segs=D['strut'])
        # the leg door on the outboard face of the strut
        yd = Y - side * 0.2
        gp.slab([(x - 0.45, yd, -2.42), (x + 0.4, yd, -2.42), (x + 0.4, yd - side * 0.05, -2.42), (x - 0.45, yd - side * 0.05, -2.42),
                 (x - 0.55, yd + side * 0.06, -1.45), (x + 0.5, yd + side * 0.06, -1.45), (x + 0.5, yd + side * 0.01, -1.45),
                 (x - 0.55, yd + side * 0.01, -1.45)], C['navy'])
        for i, dy in enumerate((-0.46, 0.46)):
            wheels.append(wheel(coll, f'wheel_m{(0 if side > 0 else 2) + i}', Vector((x, Y + dy, axle_m)), RM, 0.42, D))
    # nose: a single leg with a pair of wheels, and the bay doors hanging open either side
    x = X(sn)
    gp.tube((x, 0, -1.7), (x, 0, -2.75), 0.11, 0.1, C['grey'], segs=D['strut'])
    gm.tube((x, 0, -2.7), (x, 0, axle_n + 0.06), 0.075, None, C['chrome'], segs=D['strut'])
    gm.tube((x, -0.38, axle_n), (x, 0.38, axle_n), 0.05, None, C['steel'], segs=D['strut'])
    gp.tube((x - 0.05, 0, -2.2), (x + 0.75, 0, -1.85), 0.045, 0.045, C['grey'], segs=6)    # drag brace
    gp.box((x, 0, axle_n + 0.08), (0.2, 0.3, 0.14), C['grey'])
    if not D['low']:
        gm.slab([(x + 0.08, -0.03, -2.72), (x + 0.2, -0.03, -2.92), (x + 0.2, 0.03, -2.92), (x + 0.08, 0.03, -2.72),
                 (x + 0.08, -0.03, axle_n + 0.06), (x + 0.19, -0.03, -2.92), (x + 0.19, 0.03, -2.92),
                 (x + 0.08, 0.03, axle_n + 0.06)], C['chrome'])
    for sd in (1, -1):
        yd = sd * 0.46
        bot = fus_dims(4.4)[2]
        gp.slab([(X(3.55), yd, bot + 0.25), (X(5.55), yd, bot + 0.25), (X(5.55), yd + sd * 0.04, bot + 0.25),
                 (X(3.55), yd + sd * 0.04, bot + 0.25), (X(3.65), yd + sd * 0.04, bot - 0.62), (X(5.5), yd + sd * 0.04, bot - 0.62),
                 (X(5.5), yd, bot - 0.62), (X(3.65), yd, bot - 0.62)], C['navy'])
    for i, dy in enumerate((-0.25, 0.25)):
        wheels.append(wheel(coll, f'wheel_n{i}', Vector((x, dy, axle_n)), RN, 0.24, D))
    return wheels


# ---- small parts: antennas, probes, lamps ---------------------------------------------------------

def blade(part, s, phi, h, chord, col, sweep=0.5):
    base = fus_pt(s, phi, off=-0.03)
    n = fus_n(s, phi)
    secs = []
    for k, (hh, cc, sw) in enumerate(((0.0, chord, 0.0), (h, chord * 0.45, h * sweep))):
        c0 = base + n * hh + Vector((-sw, 0, 0))
        side = n.cross(Vector((1, 0, 0))).normalized()
        th = 0.035 if k == 0 else 0.02
        secs.append([c0 + Vector((cc * 0.5, 0, 0)), c0 + side * th, c0 + Vector((-cc * 0.5, 0, 0)), c0 - side * th])
    part.loft(secs, col)


def details(paint, metal, dark, lit, coll, D):
    marks = {}
    zt = wing_z(TIP_Y)
    for side, tag in ((1, 'r'), (-1, 'l')):
        Y = -side * TIP_Y
        # navigation and strobe lights in the wingtip fairing, under the sharklet
        marks['nav_green' if side > 0 else 'nav_red'] = Vector((X(wing_le(TIP_Y) - 0.02), Y - side * 0.06, zt))
        marks['strobe_' + tag] = Vector((X(wing_te(TIP_Y) + 0.02), Y - side * 0.1, zt + 0.02))
        lit.blob(marks['nav_green' if side > 0 else 'nav_red'], (0.11, 0.07, 0.06), C['green'] if side > 0 else C['red'], 8, 4)
        lit.blob(marks['strobe_' + tag], (0.07, 0.06, 0.05), C['strobe'], 8, 4)
        # landing lights under the wing roots
        p = Vector((X(wing_le(4.3) + 0.5), -side * 4.3, lower_z(4.3, 0.12) - 0.03))
        marks['land_' + tag] = p
        lit.blob(p, (0.13, 0.13, 0.05), C['lamp'], 10, 4)
    # tail: the white navigation light and strobe on the cone
    marks['nav_tail'] = Vector((X(L - 0.12), 0, fus_dims(L - 0.12)[1] + 0.02))
    lit.blob(marks['nav_tail'], (0.07, 0.07, 0.06), C['strobe'], 8, 4)
    marks['strobe_tail'] = marks['nav_tail'] + Vector((0.0, 0, 0.02))
    # beacons, top and bottom
    marks['beacon_top'] = fus_pt(18.8, math.pi, off=0.06)
    marks['beacon_bot'] = Vector((X(15.2), 0, -2.38))
    lit.blob(marks['beacon_top'], (0.16, 0.1, 0.09), C['red'], 10, 5)
    lit.blob(marks['beacon_bot'], (0.16, 0.1, 0.09), C['red'], 10, 5)
    # taxi light on the nose leg
    marks['taxi'] = Vector((X(5.07) + 0.14, 0, -2.42))
    lit.blob(marks['taxi'], (0.06, 0.12, 0.09), C['lamp'], 10, 4)

    # antennas: VHF blades on the crown and belly, a TCAS blade, a satcom bump
    blade(paint, 8.6, math.pi, 0.42, 0.42, C['light'])
    blade(paint, 21.5, math.pi, 0.36, 0.36, C['light'])
    blade(paint, 25.5, 0.0, 0.34, 0.36, C['navy'])
    blade(paint, 7.4, 0.0, 0.3, 0.32, C['navy'])
    if not D['low']:
        blade(paint, 12.0, math.pi, 0.18, 0.5, C['light'], sweep=0.2)
        # pitot probes and angle-of-attack vanes ahead of the cockpit
        for side in (1, -1):
            for s, z in ((2.25, 0.05), (2.35, -0.35), (2.95, -0.6)):
                ph = phi_at(s, z, side)
                p = fus_pt(s, ph)
                n = fus_n(s, ph)
                tip = p + n * 0.16 + Vector((0.08, 0, 0))
                metal.tube(p - n * 0.02, p + n * 0.12, 0.022, 0.018, C['metal'], segs=5)
                metal.tube(p + n * 0.12, tip + Vector((0.12, 0, 0)), 0.016, 0.012, C['metal'], segs=5)
        # the overwing escape-slide fairings? no: drain masts under the belly
        for s in (6.4, 24.8):
            p = fus_pt(s, 0.0)
            dark.tube(p + Vector((0, 0, 0.05)), p + Vector((-0.12, 0, -0.16)), 0.03, 0.02, C['steel'], segs=5)

    for name, p in marks.items():
        e = bpy.data.objects.new(name, None)
        e.location = p * S
        coll.objects.link(e)
    return marks


# ---- the whole aircraft -------------------------------------------------------------------------

DETAIL = {
    'high': dict(low=False, fus=72, nac=64, spin=32, blades=18, wheel=36, strut=14, canoe=14, belly=32),
    'low': dict(low=True, fus=28, nac=20, spin=12, blades=0, wheel=14, strut=6, canoe=6, belly=12),
}


def build(coll, detail='high'):
    D = DETAIL[detail]
    skin = Part('skin', uv=True)
    paint, metal, dark, glass, lit = Part('paint'), Part('metal'), Part('dark'), Part('glass'), Part('lit')
    fans = {1: Part('fan_r'), -1: Part('fan_l')}
    gp, gm = Part('gear_paint'), Part('gear_metal')

    fuselage(skin, dark, metal, D)
    cockpit_glass(glass, D)
    fin(skin, dark, D)
    belly_fairing(paint, D)
    for side in (1, -1):
        wing(paint, metal, dark, side, D)
        tailplane(paint, dark, side, D)
        engine(paint, metal, dark, fans[side], side, D, coll)
        pylon(paint, side, D)
    wheels = gear(gp, gm, coll, D)
    details(paint, metal, dark, lit, coll, D)

    objs = [p.finish(coll) for p in (skin, paint, metal, dark, glass, lit, gp, gm)]
    for side, part in fans.items():
        axis = Vector((X(S_FAN), -side * ENG_Y, ENG_Z))
        objs.append(part.finish(coll, origin=axis))
    return [o for o in objs + wheels if o]
