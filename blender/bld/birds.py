"""Birds: rock pigeons, starlings and a black-headed gull for the study window's flocks.

Pure geometry and colour, no bpy: everything here is numpy, so make_birds.py can build three
versions of each bird from one description:

  hi    the source that never ships: a smooth lofted body and head (thousands of quads), real
        feather vanes (a raised rachis, the vane's true outline with emarginations, barbs from the
        material's bump), a wing membrane under the lesser coverts, an eye, a beak with its cere,
        tucked feet. Cycles renders it for the before/after and bakes it.
  mid   the HIGH tier that ships: the same body at a few hundred triangles and every feather as an
        alpha-tested card (2-3 segments along, a raised rachis column across), each card pointing
        at its feather type's slot in the shared atlas
  lo    the phones' tier: the body at ~120 triangles, each wing one top and one underside card
        (the whole feathered wing baked onto it), the tail the same

Coordinates while building: metres, the bird's left wing along +x, forward +y, up +z, the body's
long axis on x = 0. make_birds.py turns the bird round (head to -y) so the glTF comes out head to +z,
up +y, which is what three's lookAt wants.

Every vertex carries the shader rig's inputs (see src/webgl/actors/Birds.ts):
  part   0 body/head (and the scapulars), 1 wing, 2 tail
  thin   1 on feathers and the wing's trailing membrane: they let the low sun through
  flex   how far the feather bends under load (0 at the root, ~1 at a primary's tip)
  occ    vertex occlusion the flat bakes can't see: the part of a feather tucked under the next row
"""
import math

import numpy as np

# ---------------------------------------------------------------------------------------------
# small helpers


def srgb(h):
    """'#rrggbb' -> linear rgb"""
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def ss(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    t = np.asarray(t, float)[..., None] if np.ndim(t) else t
    return a * (1 - t) + b * t


def hash2(a, b):
    """deterministic per-point noise in 0..1"""
    v = np.sin(np.asarray(a) * 127.1 + np.asarray(b) * 311.7) * 43758.5453
    return v - np.floor(v)


def vnoise(x, y, seed=0.0):
    """smooth value noise"""
    xi, yi = np.floor(x), np.floor(y)
    xf, yf = x - xi, y - yi
    u, v = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf)
    h = lambda i, j: hash2(xi + i + seed * 17.3, yi + j - seed * 9.1)  # noqa: E731
    return (h(0, 0) * (1 - u) + h(1, 0) * u) * (1 - v) + (h(0, 1) * (1 - u) + h(1, 1) * u) * v


def catmull(points, n):
    """resample a polyline of parameter rows (k x m) to n rows with Catmull-Rom"""
    p = np.asarray(points, float)
    k = len(p)
    out = []
    for i in range(n):
        t = i / (n - 1) * (k - 1)
        j = min(int(t), k - 2)
        f = t - j
        p0, p1, p2, p3 = p[max(j - 1, 0)], p[j], p[j + 1], p[min(j + 2, k - 1)]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3))
    return np.array(out)


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


# ---------------------------------------------------------------------------------------------
# geometry accumulator


class Geo:
    """vertices, quads/tris and per-vertex attributes. `uv` is in 0..1 of the part's own island
    until make_birds.py maps it into the atlas (`rect` remembers which island it belongs to)."""

    KEYS = dict(uv=2, col=3, rough=1, sheen=1, part=1, thin=1, flex=1, occ=1, fs=2, kind=1)

    def __init__(self):
        self.v = np.zeros((0, 3))
        self.faces = []
        self.a = {k: np.zeros((0, n)) for k, n in self.KEYS.items()}
        self.islands = []  # (island name, vertex slice)

    def add(self, verts, faces, island=None, **attrs):
        n0 = len(self.v)
        n = len(verts)
        self.v = np.vstack([self.v, verts])
        self.faces += [tuple(i + n0 for i in f) for f in faces]
        for k, m in self.KEYS.items():
            val = attrs.get(k)
            if val is None:
                val = np.zeros((n, m))
            val = np.asarray(val, float)
            if val.ndim == 0:
                val = np.full((n, m), float(val))
            elif val.ndim == 1 and m == 1:
                val = val[:, None]
            elif val.ndim == 1:
                val = np.tile(val, (n, 1))
            self.a[k] = np.vstack([self.a[k], val.reshape(n, m)])
        if island:
            self.islands.append((island, slice(n0, n0 + n)))
        return slice(n0, n0 + n)

    def extend(self, other):
        n0 = len(self.v)
        self.v = np.vstack([self.v, other.v])
        self.faces += [tuple(i + n0 for i in f) for f in other.faces]
        for k in self.KEYS:
            self.a[k] = np.vstack([self.a[k], other.a[k]])
        self.islands += [(nm, slice(s.start + n0, s.stop + n0)) for nm, s in other.islands]

    def mirrored(self):
        g = Geo()
        g.v = self.v * np.array([-1, 1, 1])
        g.faces = [tuple(reversed(f)) for f in self.faces]
        g.a = {k: v.copy() for k, v in self.a.items()}
        g.islands = list(self.islands)
        return g

    def tris(self):
        return sum(len(f) - 2 for f in self.faces)


def grid_faces(nu, nv, n0=0, wrap_v=False, flip=False):
    """quads over an nu x nv vertex grid (row-major, u slow)"""
    f = []
    cols = nv if wrap_v else nv - 1
    for i in range(nu - 1):
        for j in range(cols):
            a = i * nv + j
            b = i * nv + (j + 1) % nv
            c = (i + 1) * nv + (j + 1) % nv
            d = (i + 1) * nv + j
            f.append((a, d, c, b) if flip else (a, b, c, d))
    return f


# ---------------------------------------------------------------------------------------------
# lofts: body, head and beak


def loft(stations, n_along, n_round, power=2.2):
    """stations rows: (y, half-width, top, bottom, z-centre). Returns positions (n_along x n_round),
    the around parameter (0 at the back, 1 at the belly, mirrored) and the along parameter."""
    st = catmull(stations, n_along)
    th = np.linspace(-math.pi, math.pi, n_round, endpoint=False)
    s, c = np.sin(th), np.cos(th)
    sp = np.sign(s) * np.abs(s) ** (2 / power)
    cp = np.sign(c) * np.abs(c) ** (2 / power)
    y, a, bt, bb, zc = (st[:, i:i + 1] for i in range(5))
    x = a * sp
    z = zc + np.where(cp > 0, bt, bb) * cp
    P = np.stack([x, np.broadcast_to(y, x.shape), z], axis=-1)
    around = np.abs(th) / math.pi
    along = (st[:, 0] - st[0, 0]) / (st[-1, 0] - st[0, 0])
    return P, np.broadcast_to(around, x.shape), np.broadcast_to(along[:, None], x.shape)


def closed_loft(P, cap_front=True, cap_back=True):
    """faces for a loft that wraps round, with fan caps at either end (centre vertices appended)"""
    nu, nv, _ = P.shape
    verts = P.reshape(-1, 3)
    faces = grid_faces(nu, nv, wrap_v=True, flip=False)
    extra = []
    if cap_back:
        c = len(verts) + len(extra)
        extra.append(P[0].mean(axis=0))
        faces += [(c, (j + 1) % nv, j) for j in range(nv)]
    if cap_front:
        c = len(verts) + len(extra)
        extra.append(P[-1].mean(axis=0))
        base = (nu - 1) * nv
        faces += [(c, base + j, base + (j + 1) % nv) for j in range(nv)]
    return np.vstack([verts] + [np.array(extra)] if extra else [verts]), faces, len(extra)


# ---------------------------------------------------------------------------------------------
# feathers


def vane_width(u, w, notch=0.0, tip=0.78, base=0.10, taper=0.0):
    """half-width of one vane along the rachis (u 0 root .. 1 tip), as a fraction of the length"""
    u = np.asarray(u, float)
    rise = (0.35 + 0.65 * ss(0.0, base * 2.2, u)) * (1 - taper * np.clip((u - 0.3) / 0.7, 0, 1) ** 1.3)
    t = np.clip((u - tip) / (1 - tip), 0, 1)
    cap = np.sqrt(np.clip(1 - t ** 2.2, 0, 1))
    cut = 1 - notch * ss(0.52, 0.66, u) * (1 - 0.3 * ss(0.85, 1.0, u))
    return w * rise * cap * cut


class FeatherType:
    """one slot of the atlas: a shape and a colour pattern shared by every feather of that type"""

    def __init__(self, name, wo, wi, color, notch=0.0, tip=0.78, ref=0.15, rough=0.72, sheen=0.0,
                 notch_side='i', cam=0.03, taper=None):
        self.name, self.wo, self.wi, self.color = name, wo, wi, color
        # flight feathers narrow toward a pointed tip, coverts and rectrices hardly at all
        self.taper = taper if taper is not None else (0.5 if name.startswith('pr') else 0.18 if name.startswith('sec') else 0.08)
        self.notch, self.tip, self.ref, self.rough, self.sheen = notch, tip, ref, rough, sheen
        self.notch_side, self.cam = notch_side, cam
        uu = np.linspace(0, 1, 400)
        self.wo_max = float(self.width(uu, -1).max()) * 1.06 + 0.004
        self.wi_max = float(self.width(uu, 1).max()) * 1.06 + 0.004

    def width(self, u, side):
        w = self.wo if side < 0 else self.wi
        n = self.notch if (self.notch_side == ('o' if side < 0 else 'i')) else self.notch * 0.25
        return vane_width(u, w, n, self.tip, taper=self.taper)

    def card_widths(self, us):
        """card half-widths at the card's stations: the vane's widest point between neighbours"""
        out = []
        for k, u in enumerate(us):
            lo = us[max(k - 1, 0)]
            hi = us[min(k + 1, len(us) - 1)]
            uu = np.linspace(lo, hi, 50)
            out.append((float(self.width(uu, -1).max()) * 1.07 + 0.006,
                        float(self.width(uu, 1).max()) * 1.07 + 0.006))
        return np.array(out)

    def tex(self, u, s):
        """texture coordinate in the slot (0..1 across, 0..1 along) for feather space (u, s)"""
        x = (s + self.wo_max) / (self.wo_max + self.wi_max)
        y = (u + 0.015) / 1.03
        return np.stack([x, y], axis=-1)

    def shade(self, u, s):
        """albedo, roughness, sheen for feather-space points (s in feather lengths, - outer vane)"""
        u = np.asarray(u, float)
        s = np.asarray(s, float)
        w = np.where(s < 0, self.width(u, -1), self.width(u, 1))
        e = np.clip(np.abs(s) / np.maximum(w, 1e-6), 0, 1.5)
        col = self.color(u, s, e)
        # the rachis: a pale shaft down the middle, hollow-quill white at the root
        shaft = 1 - ss(0.0035, 0.0075, np.abs(s))
        flight = self.name.startswith(('pr', 'sec', 'rect'))
        col = mix(col, mix(col, srgb('#d8d4cc'), 0.3 if flight else 0.08), shaft * (1 - 0.6 * ss(0.6, 1.0, u)))
        # fine vane texture: barb ridges catch a little light, the vane's edge is slightly worn
        barbs = 0.5 + 0.5 * np.sin((u - np.abs(s) * 1.3) * 2 * math.pi * 120)
        col = col * (0.95 + 0.05 * barbs)[..., None] * (1 - 0.04 * ss(0.85, 1.0, e))[..., None]
        rough = np.full(u.shape, self.rough) - 0.12 * shaft
        sheen = np.full(u.shape, self.sheen)
        return col, rough, sheen


def feather(ft, base, d, side, up, L, us, columns, tilt=0.0, bend=0.0, twist=0.0, dense=False):
    """positions of one feather in place.

    base: rachis root; d: unit direction along the rachis; side: unit across the vane towards
    the inner vane; up: the feather's dorsal normal. us: stations along; columns: across-vane
    parameters per station given as callables or arrays. The vane drops by `tilt` (radians) on the
    inner side (so neighbours shingle), the tip curves by `bend` x L (positive down), and the
    cross-section has the type's camber.
    """
    d, side, up = unit(d), unit(side), unit(up)
    rows = []
    for k, u in enumerate(us):
        ss_ = columns[k]
        # rachis curve: tips droop / lift under bend, a little twist along the length
        tw = twist * u
        sd = side * math.cos(tw) + up * math.sin(tw)
        ud = up * math.cos(tw) - side * math.sin(tw)
        root = base + d * u * L + up * (-bend * L * u * u)
        pts = []
        for s in ss_:
            w = ft.width(u, -1 if s < 0 else 1)
            cam = ft.cam * L * (1 - min((abs(s) / max(w, 1e-6)) ** 2, 1.4))
            z = cam - math.sin(tilt) * s * L
            if dense:
                z += 0.0006 * L / 0.15 * math.exp(-(s * L / 0.0012) ** 2)  # the shaft stands proud
            pts.append(root + sd * s * L + ud * z)
        rows.append(pts)
    return np.array(rows)


def feather_geo(ft, place, L, dense, part, flex_k, occ_fn, us=None, flip=False):
    """a feather as Geo: dense vane (hi) or a card (mid). `place` gives base/d/side/up/tilt/bend."""
    if dense:
        us = np.linspace(0, 1, 26)
        ncol = 9
        cols = []
        for u in us:
            wo, wi = float(ft.width(u, -1)), float(ft.width(u, 1))
            a = -wo * np.linspace(1, 0, ncol)[:-1] ** 0.85
            b = wi * np.linspace(0, 1, ncol) ** 0.85
            cols.append(np.concatenate([a, b]))
    else:
        us = np.asarray(us if us is not None else [0, 0.45, 0.8, 1.0])
        cw = ft.card_widths(us)
        cols = [np.array([-cw[k, 0], 0.0, cw[k, 1]]) for k in range(len(us))]
    P = feather(ft, place['base'], place['d'], place['side'], place['up'], L, us, cols,
                tilt=place.get('tilt', 0), bend=place.get('bend', 0), twist=place.get('twist', 0), dense=dense)
    nu, nv = P.shape[:2]
    U = np.repeat(us[:, None], nv, axis=1)
    S = np.array(cols)
    g = Geo()
    col, rough, sheen = ft.shade(U.ravel(), S.ravel())
    # wind the quads so the face normal is the feather's dorsal side
    nrm = np.cross(unit(place['d']), unit(place['side']))
    g.add(P.reshape(-1, 3), grid_faces(nu, nv, flip=float(nrm @ unit(place['up'])) > 0), island=ft.name,
          uv=ft.tex(U.ravel(), S.ravel()), col=col, rough=rough, sheen=sheen, part=part, thin=1.0,
          flex=np.clip(U.ravel() ** 1.5 * flex_k, 0, 1), occ=occ_fn(U.ravel()),
          fs=np.stack([U.ravel() * L, S.ravel() * L], axis=-1), kind=1.0)
    return g


def prototype(ft, dense):
    """the type's flat feather (hi) or its slot quad (mid), lying on z = 0 with u along +y, at the
    type's reference length: what the HIGH atlas's feather slots are baked from"""
    L = ft.ref
    place = dict(base=np.zeros(3), d=np.array([0, 1.0, 0]), side=np.array([1.0, 0, 0]), up=np.array([0, 0, 1.0]))
    if dense:
        save = ft.cam
        ft.cam = 0.0
        g = feather_geo(ft, place, L, True, 0, 0, lambda u: np.ones_like(u))
        ft.cam = save
        return g
    us = np.array([-0.015, 1.015])
    xs = np.array([-ft.wo_max, ft.wi_max])
    P = np.array([[[x * L, u * L, -0.0005] for x in xs] for u in us])
    g = Geo()
    U = np.repeat(us[:, None], 2, axis=1).ravel()
    S = np.tile(xs, 2)
    g.add(P.reshape(-1, 3), grid_faces(2, 2, flip=False), island=ft.name, uv=ft.tex(U, S), part=0, kind=1.0)
    return g


# ---------------------------------------------------------------------------------------------
# species


def _pigeon_types():
    grey = srgb('#8f98a6')
    dark = srgb('#2b2e35')
    slate = srgb('#6f7684')

    def primary(u, s, e):
        # outer web darker, a sooty tip; inner web paler grey
        c = mix(mix(srgb('#596070'), srgb('#7d8491'), ss(-0.02, 0.03, s)), dark, ss(0.62, 0.86, u) * (0.75 + 0.25 * ss(0, -0.05, s)))
        return mix(c, c * 0.8, 0.3 * vnoise(u * 9, s * 30))

    def secondary(bar):
        def f(u, s, e):
            c = mix(srgb('#8a93a1'), srgb('#5f6672'), ss(0.7, 1.0, u) * 0.7)
            if bar:  # the rear wing bar: a black band across the exposed outer web
                c = mix(c, dark, ss(0.5, 0.56, u) * (1 - ss(0.74, 0.8, u)) * (1 - 0.25 * ss(0.0, 0.1, s)))
            return c
        return f

    def covert(bar):
        def f(u, s, e):
            c = mix(srgb('#a3abb8'), srgb('#959eac'), u)
            if bar:  # the fore wing bar: black distal spots on the greater coverts
                c = mix(c, dark, ss(0.58, 0.68, u) * (1 - ss(0.93, 0.99, u)) * (1 - 0.3 * ss(0.85, 1.0, e)))
            return c
        return f

    def rectrix(outer):
        def f(u, s, e):
            c = mix(srgb('#7f8796'), srgb('#6c7380'), u)
            c = mix(c, srgb('#24262c'), ss(0.76, 0.82, u) * (1 - ss(0.96, 1.0, u) * 0.5))
            if outer:  # white outer web on the outermost pair
                c = mix(c, srgb('#e3e5e8'), ss(-0.01, -0.03, s) * (1 - ss(0.74, 0.8, u)))
            return c
        return f

    def scap(u, s, e):
        return mix(srgb('#9ca5b2'), srgb('#8d96a4'), u)

    T = FeatherType
    return {
        'pr_out': T('pr_out', 0.045, 0.10, primary, notch=0.35, notch_side='o', tip=0.8, ref=0.175),
        'pr_in': T('pr_in', 0.06, 0.12, primary, tip=0.74, ref=0.13),
        'sec': T('sec', 0.075, 0.15, secondary(False), tip=0.72, ref=0.10),
        'sec_bar': T('sec_bar', 0.075, 0.15, secondary(True), tip=0.72, ref=0.10),
        'gc': T('gc', 0.17, 0.27, covert(False), tip=0.6, ref=0.05, cam=0.04),
        'gc_bar': T('gc_bar', 0.17, 0.27, covert(True), tip=0.6, ref=0.05, cam=0.04),
        'mc': T('mc', 0.26, 0.33, covert(False), tip=0.5, ref=0.032, cam=0.05),
        'pc': T('pc', 0.1, 0.18, lambda u, s, e: mix(srgb('#7b8290'), srgb('#686f7c'), u), tip=0.6, ref=0.07),
        'al': T('al', 0.08, 0.14, lambda u, s, e: mix(srgb('#666d79'), srgb('#4d535e'), u), tip=0.65, ref=0.04),
        'rect': T('rect', 0.12, 0.15, rectrix(False), tip=0.82, ref=0.115),
        'rect_out': T('rect_out', 0.1, 0.15, rectrix(True), tip=0.82, ref=0.11),
        'tcov': T('tcov', 0.2, 0.22, lambda u, s, e: mix(srgb('#9099a7'), srgb('#7e8695'), u), tip=0.55, ref=0.05),
        'scap': T('scap', 0.2, 0.26, scap, tip=0.55, ref=0.045, cam=0.05),
    }


def _pigeon_body(y, th, x, z, along):
    """rock dove (blue bar): blue-grey, darker slate head and neck with the green-purple sheen,
    pale grey mantle, a white rump, paler underparts"""
    head = srgb('#6a7282')
    neck = srgb('#55605e')
    mantle = srgb('#a2aab7')
    belly = srgb('#8d95a3')
    c = mix(mantle, belly, ss(0.35, 0.75, th))
    c = mix(c, neck, ss(0.035, 0.06, y))
    c = mix(c, head, ss(0.088, 0.1, y))
    # green above, purple low on the neck: the sheen mask carries the view-dependent part
    c = mix(c, srgb('#4f6a58'), ss(0.04, 0.06, y) * (1 - ss(0.08, 0.092, y)) * (1 - ss(0.25, 0.6, th)) * 0.5)
    c = mix(c, srgb('#5b4f68'), ss(0.03, 0.05, y) * (1 - ss(0.075, 0.09, y)) * ss(0.35, 0.7, th) * 0.45)
    # white rump patch on the lower back
    c = mix(c, srgb('#e6e8ea'), ss(-0.046, -0.056, y) * (1 - ss(-0.07, -0.08, y)) * (1 - ss(0.1, 0.22, th)))
    # vent and undertail darker
    c = mix(c, srgb('#6f7787'), ss(-0.045, -0.07, y) * ss(0.55, 0.8, th))
    c = c * (0.93 + 0.07 * vnoise(y * 300, th * 25))[..., None]
    sheen = ss(0.035, 0.055, y) * (1 - ss(0.085, 0.097, y))
    return c, np.full(y.shape, 0.7), sheen


def _starling_types():
    blk = srgb('#16151a')
    edge = srgb('#9a7b52')

    def flight(u, s, e):
        c = mix(srgb('#221f22'), srgb('#2f2a28'), ss(-0.02, 0.05, s))
        # buff-brown fringe round the vane's edge
        return mix(c, edge, ss(0.72, 0.95, e) * 0.85)

    def cov(u, s, e):
        c = mix(blk, srgb('#1d2421'), u)
        c = mix(c, edge, ss(0.8, 0.97, e) * 0.9)
        return mix(c, srgb('#e3d8c2'), ss(0.88, 0.95, u) * (1 - ss(0.3, 0.6, e)) * 0.85)

    T = FeatherType
    return {
        'pr_out': T('pr_out', 0.05, 0.1, flight, tip=0.82, ref=0.10, rough=0.55),
        'pr_in': T('pr_in', 0.06, 0.12, flight, tip=0.76, ref=0.085, rough=0.55),
        'sec': T('sec', 0.08, 0.14, flight, tip=0.72, ref=0.06, rough=0.55),
        'gc': T('gc', 0.18, 0.26, cov, tip=0.6, ref=0.032, rough=0.45, sheen=0.7, cam=0.04),
        'pc': T('pc', 0.12, 0.18, cov, tip=0.6, ref=0.04, rough=0.5, sheen=0.5),
        'rect': T('rect', 0.13, 0.15, flight, tip=0.85, ref=0.065, rough=0.55),
        'scap': T('scap', 0.2, 0.26, cov, tip=0.55, ref=0.03, rough=0.45, sheen=0.8, cam=0.05),
    }


def _starling_body(y, th, x, z, along):
    """common starling, late winter: oily black with green-purple gloss, buff-white spots"""
    c = np.tile(srgb('#141318'), (len(y), 1))
    c = mix(c, srgb('#1b2620'), (1 - ss(0.3, 0.7, th)) * 0.6)
    c = mix(c, srgb('#24182a'), ss(0.02, 0.05, y) * 0.5)
    # spangles: pale V-tips on the body feathers, densest on the belly and flanks
    cell = vnoise(y * 420, th * 46, 3.0)
    spot = ss(0.78, 0.86, cell) * (0.35 + 0.65 * ss(0.3, 0.8, th)) * (1 - ss(0.06, 0.075, y) * 0.7)
    c = mix(c, srgb('#e8dcc4'), spot * 0.9)
    sheen = (1 - spot) * (1 - ss(0.6, 0.95, th) * 0.5)
    return c, np.full(y.shape, 0.42), sheen


def _gull_types():
    grey = srgb('#b9c1cb')
    white = srgb('#f2f3f2')
    black = srgb('#17171a')

    def primary(outer):
        def f(u, s, e):
            # black-headed gull: a white wedge on the outer primaries, the tips and trailing edge black
            c = white if outer else mix(grey, white, 0.4)
            c = mix(np.broadcast_to(c, u.shape + (3,)), black, ss(0.74, 0.8, u) * (0.6 + 0.4 * ss(-0.02, 0.06, s)))
            if outer:
                c = mix(c, black, ss(0.02, -0.03, s) * ss(0.25, 0.35, u) * 0.85)
            return c
        return f

    def sec(u, s, e):
        return mix(grey, white, ss(0.82, 0.95, u))

    T = FeatherType
    return {
        'pr_out': T('pr_out', 0.04, 0.09, primary(True), tip=0.8, ref=0.24),
        'pr_in': T('pr_in', 0.06, 0.11, primary(False), tip=0.76, ref=0.2),
        'sec': T('sec', 0.07, 0.14, sec, tip=0.7, ref=0.13),
        'gc': T('gc', 0.17, 0.27, lambda u, s, e: mix(grey, grey * 0.96, u), tip=0.6, ref=0.07, cam=0.04),
        'mc': T('mc', 0.26, 0.33, lambda u, s, e: mix(grey, grey * 0.97, u), tip=0.5, ref=0.045, cam=0.05),
        'pc': T('pc', 0.1, 0.18, lambda u, s, e: mix(grey, white, u * 0.5), tip=0.6, ref=0.1),
        'rect': T('rect', 0.12, 0.15, lambda u, s, e: mix(white, srgb('#e6e8ea'), u), tip=0.86, ref=0.13),
        'scap': T('scap', 0.2, 0.26, lambda u, s, e: mix(grey, grey * 0.95, u), tip=0.55, ref=0.07, cam=0.05),
    }


def _gull_body(y, th, x, z, along):
    """black-headed gull in winter: white, a pale grey mantle, the dark ear spot"""
    c = mix(srgb('#b4bcc7'), srgb('#f4f5f4'), ss(0.18, 0.4, th))
    c = mix(c, srgb('#f4f5f4'), ss(0.06, 0.09, y))
    # ear spot behind the eye, faint smudge over the crown
    ear = np.exp(-(((y - 0.152) / 0.008) ** 2 + ((np.abs(x) - 0.019) / 0.006) ** 2 + ((z - 0.034) / 0.007) ** 2))
    c = mix(c, srgb('#2c2c33'), np.clip(ear * 1.4, 0, 1) * 0.9)
    crown = np.exp(-(((y - 0.15) / 0.02) ** 2)) * (1 - ss(0.0, 0.25, th))
    c = mix(c, srgb('#9aa0a8'), crown * 0.35)
    c = mix(c, srgb('#f4f5f4'), ss(-0.07, -0.1, y))  # white tail coverts
    c = c * (0.96 + 0.04 * vnoise(y * 200, th * 20))[..., None]
    return c, np.full(y.shape, 0.65), np.zeros(y.shape)


def _eye_color(iris, ring):
    def f(axis_cos):
        c = np.tile(srgb('#060506'), (len(axis_cos), 1))  # pupil
        c = mix(c, srgb(iris), ss(0.965, 0.94, axis_cos))
        c = mix(c, srgb(ring), ss(0.72, 0.6, axis_cos))
        return c
    return f


SPECIES = {
    'pigeon': dict(
        body=[  # (y, half-width, top, bottom, z-centre)
            (-0.084, 0.008, 0.006, 0.006, 0.004), (-0.072, 0.020, 0.013, 0.015, 0.003),
            (-0.048, 0.035, 0.026, 0.031, -0.001), (-0.018, 0.044, 0.034, 0.041, -0.004),
            (0.012, 0.045, 0.036, 0.044, -0.004), (0.038, 0.039, 0.033, 0.039, 0.0),
            (0.058, 0.028, 0.025, 0.028, 0.008), (0.074, 0.019, 0.019, 0.019, 0.016),
            (0.089, 0.016, 0.017, 0.016, 0.022), (0.101, 0.017, 0.018, 0.016, 0.026),
            (0.114, 0.0155, 0.0165, 0.014, 0.027), (0.125, 0.0105, 0.012, 0.009, 0.025),
            (0.132, 0.004, 0.005, 0.004, 0.023)],
        body_color=_pigeon_body, types=_pigeon_types,
        beak=dict(y0=0.124, y1=0.146, z=0.0215, r=0.0042, droop=0.0025, cere='#e6e2dc', tip='#3a3536', base='#4a4446'),
        eye=dict(c=(0.0128, 0.109, 0.0305), r=0.0043, iris='#d4561f', ring='#8b8f99'),
        feet=dict(y=-0.054, x=0.009, z=-0.031, len=0.026, r=0.0035, col='#c9646a'),
        # shoulder, elbow, wrist, end of the hand (rest pose: wing spread level)
        S=(0.022, 0.026, 0.020), E=(0.085, 0.010, 0.021), W=(0.158, 0.032, 0.021), H=(0.205, 0.024, 0.020),
        le=[(0.018, 0.044), (0.06, 0.047), (0.11, 0.043), (0.158, 0.036), (0.185, 0.030), (0.212, 0.022)],
        chord=[0.05, 0.045, 0.032, 0.022, 0.016, 0.01], thick=[0.013, 0.009, 0.006, 0.004, 0.003, 0.002],
        under='#d7dade', sheet='#9fa8b5', zw=0.021,
        prim=dict(n=10, L=(0.118, 0.182, 0.172), ang=(60, 9), types=['pr_in'] * 5 + ['pr_out'] * 5),
        sec=dict(n=12, L=(0.104, 0.092), ang=(76, 104), types=['sec'] * 6 + ['sec_bar'] * 6),
        gc=dict(n=11, k=0.5, types=['gc'] * 5 + ['gc_bar'] * 6), mc=dict(n=11, k=0.32), pc=dict(n=8, k=0.45),
        alula=3, scap=4,
        tail=dict(n=12, L=(0.118, 0.112), spread=26, y=-0.074, z=0.006, cov=5),
        flap=dict(hz=6.2, up=58, down=-42, fold=0.85, glide=22),
    ),
    'starling': dict(
        body=[
            (-0.06, 0.006, 0.005, 0.005, 0.004), (-0.05, 0.015, 0.01, 0.012, 0.003),
            (-0.032, 0.025, 0.019, 0.023, 0.0), (-0.01, 0.029, 0.023, 0.028, -0.002),
            (0.012, 0.028, 0.023, 0.027, -0.001), (0.03, 0.022, 0.019, 0.021, 0.004),
            (0.043, 0.015, 0.014, 0.014, 0.009), (0.055, 0.0125, 0.0125, 0.011, 0.012),
            (0.066, 0.0125, 0.012, 0.010, 0.013), (0.075, 0.009, 0.009, 0.007, 0.012),
            (0.08, 0.004, 0.004, 0.003, 0.011)],
        body_color=_starling_body, types=_starling_types,
        beak=dict(y0=0.076, y1=0.102, z=0.0105, r=0.0038, droop=0.0008, cere='#d9b13c', tip='#e8c24a', base='#c58f2e'),
        eye=dict(c=(0.0093, 0.067, 0.0145), r=0.0028, iris='#2a1a12', ring='#1a1716'),
        feet=dict(y=-0.036, x=0.006, z=-0.0215, len=0.018, r=0.0024, col='#b46a5c'),
        S=(0.014, 0.018, 0.012), E=(0.048, 0.008, 0.013), W=(0.09, 0.022, 0.013), H=(0.118, 0.016, 0.012),
        le=[(0.012, 0.03), (0.035, 0.031), (0.065, 0.029), (0.09, 0.025), (0.106, 0.02), (0.122, 0.013)],
        chord=[0.03, 0.028, 0.02, 0.014, 0.01, 0.006], thick=[0.008, 0.006, 0.004, 0.003, 0.002, 0.0015],
        under='#2c2828', sheet='#17161b', zw=0.013,
        prim=dict(n=9, L=(0.07, 0.105, 0.102), ang=(58, 6), types=['pr_in'] * 4 + ['pr_out'] * 5),
        sec=dict(n=9, L=(0.062, 0.056), ang=(78, 102), types=['sec'] * 9),
        gc=dict(n=9, k=0.5, types=['gc'] * 9), mc=None, pc=dict(n=6, k=0.42),
        alula=2, scap=3,
        tail=dict(n=12, L=(0.066, 0.064), spread=16, y=-0.053, z=0.005, cov=3),
        flap=dict(hz=10.5, up=55, down=-42, fold=0.8, glide=4),
    ),
    'gull': dict(
        body=[
            (-0.12, 0.010, 0.007, 0.007, 0.006), (-0.105, 0.026, 0.017, 0.019, 0.004),
            (-0.07, 0.046, 0.034, 0.04, -0.001), (-0.03, 0.056, 0.044, 0.052, -0.005),
            (0.01, 0.056, 0.045, 0.054, -0.005), (0.045, 0.047, 0.04, 0.045, 0.0),
            (0.075, 0.032, 0.03, 0.031, 0.01), (0.1, 0.022, 0.022, 0.021, 0.021),
            (0.125, 0.019, 0.02, 0.018, 0.029), (0.145, 0.021, 0.021, 0.019, 0.034),
            (0.163, 0.018, 0.019, 0.015, 0.035), (0.176, 0.011, 0.012, 0.009, 0.032),
            (0.183, 0.004, 0.005, 0.004, 0.03)],
        body_color=_gull_body, types=_gull_types,
        beak=dict(y0=0.174, y1=0.214, z=0.028, r=0.0055, droop=0.004, cere='#b3242a', tip='#1e1a1c', base='#b3242a'),
        eye=dict(c=(0.0175, 0.158, 0.039), r=0.0042, iris='#2a1a14', ring='#7a1d22'),
        feet=dict(y=-0.078, x=0.012, z=-0.043, len=0.036, r=0.0045, col='#b8282e'),
        S=(0.028, 0.03, 0.026), E=(0.148, 0.004, 0.027), W=(0.285, 0.042, 0.027), H=(0.345, 0.034, 0.026),
        le=[(0.024, 0.052), (0.09, 0.058), (0.18, 0.056), (0.285, 0.047), (0.32, 0.04), (0.352, 0.032)],
        chord=[0.07, 0.06, 0.045, 0.03, 0.02, 0.012], thick=[0.016, 0.011, 0.007, 0.005, 0.004, 0.002],
        under='#eef0f1', sheet='#b9c1cb', zw=0.027,
        prim=dict(n=10, L=(0.16, 0.25, 0.24), ang=(62, 7), types=['pr_in'] * 5 + ['pr_out'] * 5),
        sec=dict(n=15, L=(0.13, 0.115), ang=(80, 102), types=['sec'] * 15),
        gc=dict(n=13, k=0.5, types=['gc'] * 13), mc=dict(n=12, k=0.32), pc=dict(n=8, k=0.42),
        alula=3, scap=4,
        tail=dict(n=12, L=(0.13, 0.125), spread=14, y=-0.108, z=0.008, cov=4),
        flap=dict(hz=3.0, up=36, down=-26, fold=0.55, glide=4),
    ),
}


# ---------------------------------------------------------------------------------------------
# building one bird


def _lerp_poly(pts, t):
    """point along a polyline at fraction t of its length"""
    p = np.asarray(pts, float)
    seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)]) / seg.sum()
    i = min(np.searchsorted(cum, t, side='right') - 1, len(seg) - 1)
    f = (t - cum[i]) / max(cum[i + 1] - cum[i], 1e-9)
    return p[i] * (1 - f) + p[i + 1] * f


def body_geo(sp, tier):
    n_al, n_rd = dict(hi=110, mid=13, lo=8)[tier], dict(hi=72, mid=10, lo=8)[tier]
    P, around, along = loft(sp['body'], n_al, n_rd)
    verts, faces, ncap = closed_loft(P)
    th = np.concatenate([around.ravel(), [0.5] * ncap])
    al = np.concatenate([along.ravel(), [0.0, 1.0][:ncap]])
    y, x, z = verts[:, 1], verts[:, 0], verts[:, 2]
    col, rough, sheen = sp['body_color'](y, th, x, z, al)
    g = Geo()
    g.add(verts, faces, island='body', uv=np.stack([th, al], axis=-1), col=col, rough=rough, sheen=sheen,
          part=0, thin=0, occ=1.0, kind=0.0)
    return g


def beak_geo(sp, tier):
    b = sp['beak']
    n_al, n_rd = dict(hi=40, mid=6, lo=3)[tier], dict(hi=24, mid=8, lo=4)[tier]
    ys = np.linspace(b['y0'], b['y1'], 7)
    t = (ys - b['y0']) / (b['y1'] - b['y0'])
    r = b['r'] * (1.0 - 0.92 * t ** 1.15) * (1 + 0.12 * np.exp(-((t - 0.18) / 0.12) ** 2))
    st = np.stack([ys, r * 0.85, r, r * 0.8, b['z'] - b['droop'] * t ** 2.5], axis=-1)
    P, around, along = loft(st, n_al, n_rd, power=2.0)
    verts, faces, ncap = closed_loft(P, cap_back=False)
    tt = np.concatenate([along.ravel(), [1.0]])
    col = mix(srgb(b['base']), srgb(b['tip']), ss(0.4, 0.95, tt))
    col = mix(col, srgb(b['cere']), 1 - ss(0.22, 0.32, tt))
    th = np.concatenate([around.ravel(), [0.5]])
    g = Geo()
    g.add(verts, faces, island='beak', uv=np.stack([th, tt], axis=-1), col=col, rough=0.42, part=0, occ=1.0, kind=2.0)
    return g


def eye_geo(sp, tier):
    e = sp['eye']
    n = dict(hi=24, mid=4, lo=4)[tier]
    c = np.array(e['c'], float)
    # sit the eye on the head's surface (the cornea bulges ~2 mm proud of it)
    st = catmull(sp['body'], 400)
    c[0] = float(np.interp(c[1], st[:, 0], st[:, 1])) * 0.93
    ax = unit([1.0, 0.28, 0.12])
    # a squashed cap of a sphere: the visible cornea and the ring of bare skin round it
    us = np.linspace(0, 1, n)
    rings = []
    tmp = unit(np.cross(ax, [0, 0, 1]))
    b2 = np.cross(ax, tmp)
    for u in us:
        ang = u * 1.35
        rr = e['r'] * math.sin(ang)
        h = e['r'] * (math.cos(ang) - 0.55)
        rings.append([c + ax * h + (tmp * math.cos(a) + b2 * math.sin(a)) * rr
                      for a in np.linspace(0, 2 * math.pi, 2 * n, endpoint=False)])
    P = np.array(rings)
    verts = P.reshape(-1, 3)
    faces = grid_faces(n, 2 * n, wrap_v=True, flip=True)
    cosv = np.repeat(np.cos(us * 1.35), 2 * n)
    col = _eye_color(e['iris'], e['ring'])(cosv)
    uv = np.stack([0.5 + 0.5 * (verts - c) @ tmp / e['r'], 0.5 + 0.5 * (verts - c) @ b2 / e['r']], axis=-1)
    g = Geo()
    g.add(verts, faces, island='eye', uv=uv, col=col, rough=np.where(cosv > 0.72, 0.08, 0.5), part=0, occ=1.0, kind=2.0)
    return g


def feet_geo(sp, tier):
    f = sp['feet']
    n_al, n_rd = dict(hi=16, mid=4, lo=3)[tier], dict(hi=12, mid=5, lo=4)[tier]
    ys = np.linspace(f['y'], f['y'] - f['len'], 5)
    t = np.linspace(0, 1, 5)
    st = np.stack([ys, f['r'] * (1 - 0.4 * t), f['r'] * (1 - 0.4 * t), f['r'] * (1 - 0.4 * t), f['z'] + 0.004 * t], axis=-1)
    P, around, along = loft(st, n_al, n_rd, power=2.0)
    P[..., 0] += f['x']
    verts, faces, ncap = closed_loft(P)
    g = Geo()
    th = np.concatenate([around.ravel(), [0.5] * ncap])
    al = np.concatenate([along.ravel(), [0.0, 1.0]])
    col = mix(srgb(f['col']), srgb(f['col']) * 0.6, ss(0.7, 1.0, al))
    g.add(verts, faces, island='feet', uv=np.stack([th, al], axis=-1), col=col, rough=0.5, part=0, occ=0.8, kind=2.0)
    return g


def sheet_geo(sp, tier, side):
    """the inner wing's leading-edge membrane under the lesser coverts: top (side 1) or underside"""
    n_sp, n_ch = dict(hi=60, mid=7, lo=6)[tier], dict(hi=18, mid=3, lo=2)[tier]
    le = np.array(sp['le'])
    tpar = np.linspace(0, 1, n_sp)
    k = np.linspace(0, 1, len(le))
    chord = np.interp(tpar, k, sp['chord'])
    thick = np.interp(tpar, k, sp['thick'])
    cs = np.linspace(0, 1, n_ch + 1)
    rows = []
    for i, t in enumerate(tpar):
        p = _lerp_poly(le, t)
        row = []
        for c in cs:
            prof = 4 * c * (1 - c) ** 1.6 + 0.25 * (1 - c) * (c < 0.05)
            z = sp['zw'] + 0.002 + thick[i] * (prof * (0.75 if side > 0 else -0.35))
            row.append((p[0], p[1] - c * chord[i], z))
        rows.append(row)
    P = np.array(rows)
    nu, nv = P.shape[:2]
    X = P[..., 0].ravel()
    Y = P[..., 1].ravel()
    C = np.tile(cs, nu)
    if side > 0:
        base = srgb(sp['sheet'])
        col = mix(np.tile(base, (len(X), 1)), base * 0.92, ss(0.4, 1.0, C))
        col = col * (0.95 + 0.05 * vnoise(X * 400, Y * 400))[..., None]
    else:
        col = np.tile(srgb(sp['under']), (len(X), 1)) * (0.96 + 0.04 * vnoise(X * 400, Y * 300))[..., None]
    g = Geo()
    T = np.repeat(tpar, nv)
    g.add(P.reshape(-1, 3), grid_faces(nu, nv, flip=(side < 0)), island='sheet_top' if side > 0 else 'sheet_bot',
          uv=np.stack([T, C], axis=-1), col=col, rough=0.75, part=1, thin=ss(0.55, 1.0, C), occ=1.0, kind=0.0)
    return g


def wing_feathers(sp, types, tier):
    """every feather of the left wing, in place (rest pose: spread, level). Inner feathers lie on
    top of outer ones, each row of coverts on top of the row it covers, every vane tilted so the
    inner web tucks under its neighbour."""
    dense = tier == 'hi'
    zw = sp['zw']
    S, E, W, H = (np.array(sp[k], float) for k in 'SEWH')
    up = np.array([0, 0, 1.0])
    out = Geo()
    feathers = []  # (type, base, angle deg from +x towards -y, L, layer z, flex, bend, cover, us)

    pr = sp['prim']
    n = pr['n']
    for i in range(n):  # P1 inner .. Pn outer
        t = i / (n - 1)
        base = W + (H - W) * t
        Ls = pr['L']
        L = np.interp(t, [0, 0.8, 1], Ls)
        ang = pr['ang'][0] + (pr['ang'][1] - pr['ang'][0]) * t ** 0.8
        feathers.append((pr['types'][i], base, ang, L, -0.0016 - 0.00022 * i, 1.0, 0.05, 0.38, [0, 0.4, 0.75, 1.0]))
    sc = sp['sec']
    n = sc['n']
    for i in range(n):  # S1 at the wrist .. tertials by the body
        t = i / (n - 1)
        base = W + (E - W) * min(t / 0.82, 1) + (S + np.array([0.012, -0.006, 0]) - E) * max(t - 0.82, 0) / 0.18
        L = sc['L'][0] + (sc['L'][1] - sc['L'][0]) * t
        ang = sc['ang'][0] + (sc['ang'][1] - sc['ang'][0]) * t
        feathers.append((sc['types'][i], base, ang, L, -0.0004 + 0.0002 * i, 0.55, 0.03, 0.42, [0, 0.45, 1.0]))
    sec_feathers = feathers[pr['n']:]
    gc = sp['gc']
    for i in range(gc['n']):
        t = i / max(gc['n'] - 1, 1)
        j = min(int(round(t * (len(sec_feathers) - 1))), len(sec_feathers) - 1)
        _, b, a, Ls, *_ = sec_feathers[j]
        feathers.append((gc['types'][i], b + np.array([0, 0.006, 0]), a - 4, Ls * gc['k'], 0.0028 + 0.0001 * i, 0.15, 0.0, 0.5, [0, 0.55, 1.0]))
    if sp['mc']:
        mc = sp['mc']
        for i in range(mc['n']):
            t = i / (mc['n'] - 1)
            j = min(int(round(t * (len(sec_feathers) - 2))), len(sec_feathers) - 1)
            _, b, a, Ls, *_ = sec_feathers[j]
            feathers.append(('mc', b + np.array([0, 0.016 * Ls / 0.1, 0]), a - 8, Ls * mc['k'], 0.0046 + 0.0001 * i, 0.0, 0.0, 0.6, [0, 1.0]))
    pc = sp['pc']
    prim = feathers[:pr['n']]
    for i in range(pc['n']):
        t = i / (pc['n'] - 1)
        j = int(round(t * (pr['n'] - 1)))
        _, b, a, Lp, *_ = prim[j]
        feathers.append(('pc', b + np.array([-0.002, 0.004, 0]), a + 2, Lp * pc['k'], 0.0016 + 0.0002 * (pc['n'] - i), 0.2, 0.0, 0.55, [0, 0.55, 1.0]))
    for i in range(sp['alula']):
        feathers.append(('al', W + np.array([0.004 * i, 0.006 - 0.002 * i, 0]), -18 + 10 * i,
                         types['al'].ref * (1 - 0.18 * i) if 'al' in types else 0.03, 0.0062 - 0.0004 * i, 0.3, 0.0, 0.3, [0, 0.55, 1.0]))

    for (tname, base, ang, L, dz, flex, bend, cover, us) in feathers:
        if tname not in types:
            tname = 'pc'
        ft = types[tname]
        a = math.radians(ang)
        d = np.array([math.cos(a), -math.sin(a), 0.0])
        side = np.array([math.sin(a), math.cos(a), 0.0])  # +90 deg: towards the leading edge...
        side = -side  # ...so flip: + is the inner (trailing) vane
        b = np.array([base[0], base[1], zw + dz])
        place = dict(base=b, d=d, side=side, up=up, tilt=math.radians(4), bend=bend)
        occ_fn = (lambda c: (lambda u: 0.5 + 0.5 * ss(0.0, c, u)))(cover)
        if tname.startswith('al'):
            occ_fn = lambda u: np.ones_like(u)  # noqa: E731
        out.extend(feather_geo(ft, place, L, dense, 1, flex, occ_fn, us=us))
    return out


def tail_feathers(sp, types, tier):
    dense = tier == 'hi'
    tl = sp['tail']
    n = tl['n']
    out = Geo()
    up = np.array([0, 0, 1.0])
    half = n // 2
    for k in range(n):
        j = k - (half - 0.5)  # -5.5 .. 5.5
        frac = abs(j) / (half - 0.5)
        ang = math.radians(tl['spread'] * j / (half - 0.5))
        d = np.array([math.sin(ang), -math.cos(ang), 0.0])
        side = np.array([math.cos(ang), math.sin(ang), 0.0]) * (-1 if j > 0 else 1)
        # central pair on top, the outer pairs beneath
        b = np.array([0.003 * j, tl['y'], tl['z'] - 0.0011 * abs(j)])
        L = tl['L'][0] + (tl['L'][1] - tl['L'][0]) * frac
        tname = 'rect_out' if (abs(j) > half - 1 and 'rect_out' in types) else 'rect'
        place = dict(base=b, d=d, side=side, up=up, tilt=math.radians(4), bend=-0.02)
        g = feather_geo(types[tname], place, L, dense, 2, 0.15, lambda u: 0.55 + 0.45 * ss(0.0, 0.35, u),
                        us=[0, 0.5, 1.0])
        out.extend(g)
    # tail coverts over the base of the fan (upper), part of the tail so they move with it
    for k in range(tl['cov']):
        j = k - (tl['cov'] - 1) / 2
        ang = math.radians(9 * j)
        d = np.array([math.sin(ang), -math.cos(ang), 0.0])
        side = np.array([math.cos(ang), math.sin(ang), 0.0])
        L = types['scap'].ref * 1.2 if 'tcov' not in types else types['tcov'].ref
        b = np.array([0.004 * j, tl['y'] + 0.022 * L / 0.05, tl['z'] + 0.0035])
        place = dict(base=b, d=d, side=-side, up=up, tilt=0.0, bend=0.0)
        out.extend(feather_geo(types.get('tcov', types['scap']), place, L, dense, 2, 0.0,
                               lambda u: np.ones_like(u), us=[0, 0.55, 1.0]))
    return out


def scapulars(sp, types, tier):
    """the shoulder feathers that roof over the root of the wing: they stay with the body"""
    dense = tier == 'hi'
    out = Geo()
    S = np.array(sp['S'])
    up = np.array([0, 0, 1.0])
    for k in range(sp['scap']):
        ft = types['scap']
        L = ft.ref * (1.15 - 0.1 * k)
        ang = math.radians(95 + 6 * k)
        d = np.array([math.cos(ang), -math.sin(ang), -0.12])
        side = np.array([math.sin(ang), math.cos(ang), 0.0])
        b = np.array([S[0] - 0.006 + 0.003 * k, S[1] - 0.004 - 0.012 * k * L / 0.045, sp['zw'] + 0.009 - 0.0012 * k])
        place = dict(base=b, d=d, side=-side, up=up, tilt=math.radians(6), bend=0.0)
        g = feather_geo(ft, place, L, dense, 0, 0.0, lambda u: 0.75 + 0.25 * ss(0, 0.5, u), us=[0, 0.55, 1.0])
        g.a['thin'][:] = 0.4
        out.extend(g)
    return out
