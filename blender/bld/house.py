"""Houses: wall openings, gable and hip roofs, porches, chimneys, dormers.

Same two-mesh idea as the towers. The low-poly shell is a handful of flat
polygons (a gable wall is a pentagon, a roof slope a quad); the high-poly twin
has real window reveals, trim, sills, shutters, door steps and fascia boards,
and its materials carry metre-scale clapboard, brick and shingle patterns. The
bake projects all of it onto the shell.

Axis names are compass names for the footprint edges, in counter-clockwise
order from the bottom: S (-y, the front of an unrotated house), E, N, W.
"""
import math

from mathutils import Vector

from .facade import COOL, GLASS_POOL, WARM, _frame4, pick_glass
from .geo import Frame, Z, rect_poly

X, Y = Vector((1, 0, 0)), Vector((0, 1, 0))


# -- openings ------------------------------------------------------------------

def win(u, floor=0, w=1.0, h=1.45, sill=0.9, shutters=False):
    return dict(t='win', u=u, floor=floor, w=w, h=h, sill=sill, shutters=shutters)


def door(u, w=1.0, h=2.15, mat='door_red', lit=False):
    return dict(t='door', u=u, w=w, h=h, mat=mat, lit=lit)


def garage(u, w=4.9, h=2.2):
    return dict(t='garage', u=u, w=w, h=h)


def row(L, n, floor, margin=1.3, skip=(), **kw):
    """n windows spread evenly across a wall of length L."""
    span = L - 2 * margin
    centres = [margin + span * (i + 0.5) / n for i in range(n)]
    return [win(u, floor, **kw) for i, u in enumerate(centres) if i not in skip]


def decompose(L, H, openings, breaks=()):
    """Split a wall into solid rectangles around its openings.

    Every opening edge and break line cuts the wall into cells; cells that fall
    outside all openings are merged along each row. This replaces a boolean cut
    and is exact for axis-aligned openings.
    """
    us = sorted({0.0, L, *(o[0] for o in openings), *(o[1] for o in openings)})
    vs = sorted({0.0, H, *(o[2] for o in openings), *(o[3] for o in openings), *breaks})
    inside = lambda u, v: any(o[0] < u < o[1] and o[2] < v < o[3] for o in openings)
    rects = []
    for j in range(len(vs) - 1):
        v0, v1 = vs[j], vs[j + 1]
        if v1 - v0 < 1e-4:
            continue
        run = None
        for i in range(len(us) - 1):
            u0, u1 = us[i], us[i + 1]
            if u1 - u0 < 1e-4:
                continue
            if not inside((u0 + u1) / 2, (v0 + v1) / 2):
                run = (run[0], u1) if run else (u0, u1)
            elif run:
                rects.append((run[0], run[1], v0, v1))
                run = None
        if run:
            rects.append((run[0], run[1], v0, v1))
    return rects


def _room_light(hp, rng, spec):
    if rng.random() < spec.get('lit', 0.3):
        return rng.choice(COOL if rng.random() < 0.2 else WARM)
    return pick_glass(rng, spec.get('glass', GLASS_POOL), 0.12)


def _window(hp, fr, o, z0, spec, rng):
    uc, w, h = o['u'], o['w'], o['h']
    u0, u1 = uc - w / 2, uc + w / 2
    z = z0 + o['floor'] * spec.get('floor_h', 2.7) + o['sill']
    z1 = z + h
    trim, depth = spec.get('trim', 'trim_white'), 0.22
    hp.fquad(fr, u0, u1, z, z1, -depth + 0.02, _room_light(hp, rng, spec))
    _frame4(hp, fr, u0, u1, z, z1, -depth, depth + 0.03, 0.07, trim)
    zm = z + h * 0.52
    hp.fbox(fr, u0, u1, -depth, -depth + 0.1, zm - 0.03, zm + 0.03, trim, skip=('-w',))
    if w > 1.15:
        hp.fbox(fr, uc - 0.03, uc + 0.03, -depth, -depth + 0.1, z, z1, trim, skip=('-w',))
    hp.fbox(fr, u0 - 0.08, u1 + 0.08, -depth, 0.13, z - 0.08, z, trim, skip=('-w', '-v'))
    hp.fbox(fr, u0 - 0.1, u1 + 0.1, -depth, 0.06, z1, z1 + 0.1, trim, skip=('-w',))
    if o['shutters']:
        sw = w * 0.42
        mat = spec.get('shutter', 'shutter')
        for a, b in ((u0 - 0.05 - sw, u0 - 0.05), (u1 + 0.05, u1 + 0.05 + sw)):
            hp.fbox(fr, a, b, 0, 0.06, z, z1, mat, skip=('-w',))
            # louvres: a slat every 11 cm, each standing 1.5 cm proud of the frame
            for k in range(int((h - 0.2) / 0.11)):
                zs = z + 0.1 + k * 0.11
                hp.fbox(fr, a + 0.05, b - 0.05, 0.06, 0.075, zs, zs + 0.07, mat, skip=('-w',))


def _attic(hp, fr, uc, z, spec, rng):
    """Small gable-end window. The gable is a single surface, so unlike a real
    opening this one stands in FRONT of it (a recessed pane would be hidden)."""
    w, h = 0.7, 0.9
    hp.fquad(fr, uc - w / 2, uc + w / 2, z, z + h, 0.02, _room_light(hp, rng, spec))
    _frame4(hp, fr, uc - w / 2, uc + w / 2, z, z + h, 0.02, 0.06, 0.07, spec.get('trim', 'trim_white'))


def _door(hp, fr, o, z0, spec, rng):
    uc, w, h = o['u'], o['w'], o['h']
    u0, u1 = uc - w / 2, uc + w / 2
    trim = spec.get('trim', 'trim_white')
    hp.fquad(fr, u0, u1, z0, z0 + h, -0.10, o['mat'])
    _frame4(hp, fr, u0 - 0.05, u1 + 0.05, z0, z0 + h + 0.08, -0.22, 0.28, 0.1, trim)
    hp.fquad(fr, u0 + w * 0.18, u1 - w * 0.18, z0 + h * 0.58, z0 + h * 0.9, -0.085,
             rng.choice(WARM) if (o['lit'] or rng.random() < 0.4) else 'glass_dark')
    hp.fbox(fr, u0 - 0.3, u1 + 0.3, 0, 0.95, z0, z0 + 0.2, 'concrete', skip=('-w',))
    # raised panels (two over four) and a knob: the geometry of a real door
    pm, gap = 0.13, 0.07
    pw = (w - 2 * pm - gap) / 2
    gl = h * 0.58 - 0.08  # the glazed light sits above this; panels only below it
    rows = [(0.1, gl * 0.5 - 0.03), (gl * 0.5 + 0.03, gl)]
    for ci in range(2):
        px0 = u0 + pm + ci * (pw + gap)
        for r0, r1 in rows:
            if r1 - r0 > 0.2:
                hp.fbox(fr, px0, px0 + pw, -0.10, -0.075, z0 + r0, z0 + r1, o['mat'], skip=('-w',))
    hp.fbox(fr, u1 - 0.17, u1 - 0.09, -0.10, -0.03, z0 + h * 0.46, z0 + h * 0.46 + 0.08, 'frame_light',
            skip=('-w',))


def _garage(hp, fr, o, z0, spec, rng):
    uc, w, h = o['u'], o['w'], o['h']
    u0, u1 = uc - w / 2, uc + w / 2
    hp.fquad(fr, u0, u1, z0, z0 + h, -0.06, 'garage_door')
    _frame4(hp, fr, u0 - 0.06, u1 + 0.06, z0, z0 + h + 0.1, -0.22, 0.26, 0.12, spec.get('trim', 'trim_white'))
    for k in range(4):
        x0 = u0 + w * (k + 0.1) / 4
        hp.fquad(fr, x0, x0 + w * 0.8 / 4, z0 + h * 0.8, z0 + h * 0.92, -0.045, 'glass_dark')


def timber(hp, fr, L, v0, v1, mat='trim_dark', pitch=1.5):
    """Half-timbering: posts and rails standing proud of the plaster."""
    n = max(2, round(L / pitch))
    for i in range(n + 1):
        u = L * i / n
        hp.fbox(fr, max(0, u - 0.07), min(L, u + 0.07), 0, 0.07, v0, v1, mat, skip=('-w',))
    for v in (v0, (v0 + v1) / 2, v1 - 0.12):
        hp.fbox(fr, 0, L, 0, 0.07, v, v + 0.12, mat, skip=('-w',))


def house_wall(hp, fr, L, z0, z1, spec, rng):
    """One wall: cladding with real openings. `spec` may be a list of
    side-by-side segments (a terrace of houses) via spec['segments']."""
    if 'segments' in spec:
        u = 0.0
        for seg_len, seg in spec['segments']:
            o = fr.p(u, 0, 0)
            house_wall(hp, Frame((o.x, o.y), fr.u), seg_len, z0, z1, seg, rng)
            u += seg_len
        return
    H = z1 - z0
    found_h, found_mat = spec.get('found', (0.5, 'concrete_d'))
    fh = spec.get('floor_h', 2.7)
    items = []
    for o in spec.get('openings', []):
        u, w = o['u'], o['w']
        if o['t'] == 'win':
            v0 = o['floor'] * fh + o['sill']
            items.append((o, (u - w / 2, u + w / 2, v0, v0 + o['h'])))
        else:
            items.append((o, (u - w / 2, u + w / 2, 0.0, o['h'])))
    for u0, u1, v0, v1 in decompose(L, H, [r for _, r in items], breaks=[found_h]):
        mat = found_mat if (v0 + v1) / 2 < found_h else spec['wall']
        # the slab's outer ends sit in the neighbouring wall's plane: a second, coplanar
        # skin there z-fights in the close-up tier and shadows its neighbour in the bake
        ends = (('-u',) if u0 < 1e-6 else ()) + (('+u',) if u1 > L - 1e-6 else ())
        hp.fbox(fr, u0, u1, -0.28, 0.0, z0 + v0, z0 + v1, mat, skip=('-w',) + ends)
    if spec['wall'].startswith(('siding', 'deck_wood')):
        # lap siding: real boards, each standing 2 cm proud, so every course throws a
        # shadow line. In the lean tier this lands in the normal map instead.
        for u0, u1, v0, v1 in decompose(L, H, [r for _, r in items], breaks=[found_h]):
            if (v0 + v1) / 2 < found_h:
                continue
            for k in range(int((v1 - v0) / 0.17)):
                z = z0 + v0 + k * 0.17
                hp.fbox(fr, u0, u1, 0.0, 0.022, z, z + 0.15, spec['wall'], skip=('-w', '-u', '+u'))
    trim = spec.get('trim', 'trim_white')
    # clapboard wants corner boards; brick, stucco and stone turn the corner themselves
    if spec.get('corners', not spec['wall'].startswith(('brick', 'stucco', 'fieldstone'))):
        for u in (0.0, L - 0.12):
            hp.fbox(fr, u, u + 0.12, -0.28, 0.045, z0 + found_h, z0 + H, trim, skip=('-w',))
        hp.fbox(fr, 0, L, -0.28, 0.05, z0 + found_h - 0.02, z0 + found_h + 0.1, trim, skip=('-w',))
    for o, _ in items:
        {'win': _window, 'door': _door, 'garage': _garage}[o['t']](hp, fr, o, z0, spec, rng)
    if spec.get('timber'):
        timber(hp, fr, L, z0 + spec['timber'][0], z0 + spec['timber'][1])


# -- structures ----------------------------------------------------------------

def _rot(ridge):
    """Local roof frame (ridge along local x) -> world, for ridge along x or y."""
    return (lambda x, y: (x, y)) if ridge == 'x' else (lambda x, y: (-y, x))


def house_block(m, cx, cy, w, d, z0, ze, walls, roof, name, ridge='x', skip=()):
    """Walls up to the eaves at `ze`, then a gable, hip or flat roof."""
    kind = roof['kind']
    if kind == 'hip':
        ridge = 'x' if w >= d else 'y'
    pitch = roof.get('pitch', 0.5)
    run = (d if ridge == 'x' else w) / 2 if kind == 'gable' else min(w, d) / 2
    rise = 0.0 if kind == 'flat' else run * pitch
    zr = ze + rise
    poly, _ = rect_poly(cx, cy, w, d)
    ends = ('E', 'W') if ridge == 'x' else ('S', 'N')
    for i, nm in enumerate('SENW'):
        if nm in skip:
            continue
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % 4])
        fr, L = Frame(a, b - a), (b - a).length
        key, gable = f'{name}:{nm}', kind == 'gable' and nm in ends
        outline = [(0, z0), (L, z0), (L, ze), (L / 2, zr), (0, ze)] if gable else \
                  [(0, z0), (L, z0), (L, ze), (0, ze)]
        m._slot(key, 'wall', L, (zr if gable else ze) - z0)
        m.lp.face([fr.p(u, 0, v) for u, v in outline], 'lp', expect=fr.n,
                  meta=dict(slot=key, kind='wall', o=fr.p(0, 0, z0), a=fr.u, b=Z))
        spec = walls[nm]
        with m.ctx(key, fr.p(0, 0, z0), fr.u, Z, fr.n):
            house_wall(m.hp, fr, L, z0, ze, spec, m.rng(key))
            if not gable and L > 3.0:
                # a downspout at each end of the long walls
                for u in (0.2, L - 0.3):
                    m.hp.fbox(fr, u, u + 0.09, 0.0, 0.1, z0 + 0.35, ze - 0.02, 'frame_light', skip=('-w',))
            if gable:
                m.hp.face([fr.p(0, 0, ze), fr.p(L, 0, ze), fr.p(L / 2, 0, zr)], spec['wall'],
                          expect=fr.n)
                if spec['wall'].startswith('siding'):
                    for k in range(int(rise / 0.17) - 1):
                        z = ze + 0.05 + k * 0.17
                        half = (L / 2) * (1 - (z + 0.15 - ze) / rise)
                        if half > 0.1:
                            m.hp.fbox(fr, L / 2 - half, L / 2 + half, 0.0, 0.022, z, z + 0.15,
                                      spec['wall'], skip=('-w', '-u', '+u'))
                if spec.get('attic'):
                    _attic(m.hp, fr, L / 2, ze + rise * 0.3, spec, m.rng(key + ':attic'))
    if kind == 'gable':
        _gable_roof(m, cx, cy, w, d, ze, zr, pitch, roof, ridge, name)
    elif kind == 'hip':
        _hip_roof(m, cx, cy, w, d, ze, zr, pitch, roof, ridge, name)
    else:
        m._roof(poly, ze, roof.get('flat', dict(parapet=0.5, margin=0.8)), name)
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    m.volumes.append((min(xs), min(ys), max(xs), max(ys), z0))


def _roof_face(m, key, pts, expect, mat, origin, a, b, w_m, h_m):
    m._slot(key, 'roof', w_m, h_m)
    m.lp.face(pts, 'lp', expect=expect,
              meta=dict(slot=key, kind='roof', o=Vector(origin), a=a, b=b))
    with m.ctx(key, origin, a, b, expect):
        m.hp.face(pts, mat, expect=expect)


def _courses(m, key, origin, a, b, n, length, u_range, mat, pitch=0.17, step=0.03):
    """Stepped roofing courses on a roof plane. The riser of each course is flat
    colour, the tread samples the roof slot's baked pixels like the plane under it.
    `u_range(s)` gives the width across the slope at distance s from the eave."""
    o = Vector(origin)
    P = lambda u, s, h: o + a * u + b * s + n * h
    s = 0.0
    while s + pitch <= length + 1e-6:
        u0, u1 = u_range(s)
        v0, v1 = u_range(s + pitch)
        m.hp.face([P(u0, s, 0), P(u1, s, 0), P(u1, s, step), P(u0, s, step)], mat, expect=-b)
        with m.ctx(key, origin, a, b, n):
            m.hp.face([P(u0, s, step), P(u1, s, step), P(v1, s + pitch, 0), P(v0, s + pitch, 0)],
                      mat, expect=n)
        s += pitch


def _gutter(m, p0, p1, z):
    """Half-round gutter hung just below the fascia along one eave edge."""
    a, b = Vector(p0), Vector(p1)
    d = (b - a).normalized()
    a, b = a + d * 0.3, b - d * 0.3   # stop short of the rake overhang at each end
    fr = Frame(a, b - a)
    L = (b - a).length
    m.hp.fbox(fr, 0.0, L, 0.03, 0.15, z - 0.17, z - 0.05, 'frame_light', skip=('-w',))
    m.hp.fbox(fr, 0.0, L, 0.14, 0.16, z - 0.05, z + 0.02, 'frame_light', skip=('-w',))


def _fascia(m, p0, p1, z, mat, outward):
    """Fascia board hanging off an eave edge from p0 to p1 (world xy)."""
    a, b = Vector(p0), Vector(p1)
    fr = Frame(a, b - a)
    m.hp.fbox(fr, 0, (b - a).length, -0.04, 0.03, z - 0.2, z + 0.03, mat, skip=('-w',))


def _gable_roof(m, cx, cy, w, d, ze, zr, pitch, roof, ridge, name):
    mat, oh, rk = roof['mat'], roof.get('oh', 0.5), roof.get('rake', 0.3)
    R = _rot(ridge)
    half = (w if ridge == 'x' else d) / 2 + rk
    run = (d if ridge == 'x' else w) / 2
    ye, ze_e = run + oh, ze - oh * pitch
    W = lambda x, y, z: Vector((cx + R(x, y)[0], cy + R(x, y)[1], z))
    wd = lambda x, y: Vector((*R(x, y), 0.0))
    length = math.hypot(ye, zr - ze_e)
    for sgn in (-1, 1):
        pts = [W(-half, sgn * ye, ze_e), W(half, sgn * ye, ze_e), W(half, 0, zr), W(-half, 0, zr)]
        expect = Vector((*R(0, sgn * pitch), 1.0))
        up = (wd(0, -sgn * ye) + Z * (zr - ze_e)).normalized()
        if sgn < 0:
            origin, a = pts[0], wd(1, 0)
        else:
            origin, a = pts[1], wd(-1, 0)
        _roof_face(m, f'{name}:R', pts, expect, mat, origin, a, up, 2 * half, length)
        _courses(m, f'{name}:R', origin, a, up, expect.normalized(), length, lambda s: (0.0, 2 * half), mat)
        ex0, ex1 = (pts[0], pts[1]) if sgn < 0 else (pts[1], pts[0])
        _fascia(m, (ex0.x, ex0.y), (ex1.x, ex1.y), ze_e, roof.get('fascia', 'trim_white'), sgn)
        _gutter(m, (ex0.x, ex0.y), (ex1.x, ex1.y), ze_e)
    ridge_fr = Frame((W(-half, 0, 0).x, W(-half, 0, 0).y), wd(1, 0))
    m.hp.fbox(ridge_fr, 0, 2 * half, -0.14, 0.14, zr - 0.04, zr + 0.1, mat, skip=('-v',))


def _hip_roof(m, cx, cy, w, d, ze, zr, pitch, roof, ridge, name):
    mat, oh = roof['mat'], roof.get('oh', 0.5)
    R = _rot(ridge)
    long_, short = (w, d) if ridge == 'x' else (d, w)
    L2, S2, rl = long_ / 2 + oh, short / 2 + oh, (long_ - short) / 2
    ze_e = ze - oh * pitch
    W = lambda x, y, z: Vector((cx + R(x, y)[0], cy + R(x, y)[1], z))
    wd = lambda x, y: Vector((*R(x, y), 0.0))
    # ridge ends can coincide (a pyramid); duplicates would make a degenerate face
    def poly(pts):
        out = []
        for p in pts:
            if not out or (p - out[-1]).length > 0.05:
                out.append(p)
        return out if len(out) > 1 and (out[0] - out[-1]).length > 0.05 else out[:-1]
    for sgn in (-1, 1):
        pts = poly([W(-L2, sgn * S2, ze_e), W(L2, sgn * S2, ze_e), W(rl, 0, zr), W(-rl, 0, zr)])
        up = (wd(0, -sgn * S2) + Z * (zr - ze_e)).normalized()
        origin, a = (pts[0], wd(1, 0)) if sgn < 0 else (pts[1], wd(-1, 0))
        slope = math.hypot(S2, zr - ze_e)
        nrm = Vector((*R(0, sgn * pitch), 1.0))
        _roof_face(m, f'{name}:RS', pts, nrm, mat, origin, a, up, 2 * L2, slope)
        wid = lambda s: (2 * L2) + (2 * rl - 2 * L2) * s / slope
        _courses(m, f'{name}:RS', origin, a, up, nrm.normalized(), slope,
                 lambda s: ((2 * L2 - wid(s)) / 2, (2 * L2 + wid(s)) / 2), mat)
        e0, e1 = (pts[0], pts[1]) if sgn < 0 else (pts[1], pts[0])
        _fascia(m, (e0.x, e0.y), (e1.x, e1.y), ze_e, roof.get('fascia', 'trim_white'), sgn)
        _gutter(m, (e0.x, e0.y), (e1.x, e1.y), ze_e)
    for sgn in (-1, 1):
        pts = poly([W(sgn * L2, -S2, ze_e), W(sgn * L2, S2, ze_e), W(sgn * rl, 0, zr)])
        up = (wd(-sgn * (L2 - rl), 0) + Z * (zr - ze_e)).normalized()
        origin, a = (pts[0], wd(0, 1)) if sgn > 0 else (pts[1], wd(0, -1))
        _roof_face(m, f'{name}:RE', pts, Vector((*R(sgn * pitch, 0), 1.0)), mat, origin, a, up,
                   2 * S2, math.hypot(L2 - rl, zr - ze_e))
        e0, e1 = (pts[0], pts[1]) if sgn > 0 else (pts[1], pts[0])
        _fascia(m, (e0.x, e0.y), (e1.x, e1.y), ze_e, roof.get('fascia', 'trim_white'), sgn)
    if rl > 0.05:
        ridge_fr = Frame((W(-rl, 0, 0).x, W(-rl, 0, 0).y), wd(1, 0))
        m.hp.fbox(ridge_fr, 0, 2 * rl, -0.14, 0.14, zr - 0.04, zr + 0.1, mat, skip=('-v',))


def chimney(m, x, y, w, d, z0, z1, mat='brick_h_red'):
    """Brick stack. The four faces are baked like any wall; the cap and flue
    pots exist only in the high-poly twin."""
    m.count += 1
    tid = f'chim{m.count}'
    poly, _ = rect_poly(x, y, w, d)
    spec = dict(wall=mat, corners=False, found=(0.0, mat))
    for i in range(4):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % 4])
        fr, L = Frame(a, b - a), (b - a).length
        # four unique slots: a chimney usually stands half-buried in a house wall,
        # and a face shared with its buried twin would bake the inside of that wall
        key = f'{tid}:{"SENW"[i]}'
        m._slot(key, 'wall', L, z1 - z0)
        m.lp.face([fr.p(0, 0, z0), fr.p(L, 0, z0), fr.p(L, 0, z1), fr.p(0, 0, z1)], 'lp',
                  expect=fr.n, meta=dict(slot=key, kind='wall', o=fr.p(0, 0, z0), a=fr.u, b=Z))
        with m.ctx(key, fr.p(0, 0, z0), fr.u, Z, fr.n):
            house_wall(m.hp, fr, L, z0, z1, spec, m.rng(key))
    m._solid([(px, py, z1) for px, py in poly], 'concrete', Z)
    m.hp.box(x, y, w + 0.16, d + 0.16, z1 - 0.12, z1, 'concrete')
    m.hp.cylinder(x - w / 4, y, 0.12, z1, z1 + 0.35, 8, 'concrete_d')
    m.hp.cylinder(x + w / 4, y, 0.12, z1, z1 + 0.35, 8, 'concrete_d')
    m.volumes.append((x - w / 2, y - d / 2, x + w / 2, y + d / 2, z0))


def _shed(m, cx, cy, w, d, z_front, z_back, mat, tid, trim='trim_white'):
    """Porch roof: a real single slope rising toward the house (+y), so the
    roofing pattern, which runs up the slope, has a slope to run up."""
    x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2
    dz = z_back - z_front
    top = [(x0, y0, z_front), (x1, y0, z_front), (x1, y1, z_back), (x0, y1, z_back)]
    up = Vector((0, d, dz)).normalized()
    _roof_face(m, f'{tid}:top', top, Vector((0, -dz / d, 1)), mat, (x0, y0, z_front), X, up, w,
               math.hypot(d, dz))
    # fascia and cheeks are flat colour; nobody looks up at a porch roof from here
    fascia = [(x0, y0, z_front - 0.2), (x1, y0, z_front - 0.2), (x1, y0, z_front), (x0, y0, z_front)]
    m._solid(fascia, trim, -Y)
    for sx, e in ((1, X), (-1, -X)):
        xs = x1 if sx > 0 else x0
        m._solid([(xs, y0, z_front - 0.2), (xs, y1, z_back - 0.2), (xs, y1, z_back),
                  (xs, y0, z_front)], trim, e)
    m.hp.face(fascia, trim, expect=-Y)
    m.volumes.append((x0, y0, x1, y1, z_front))


def porch(m, cx, cy, w, d, ze, posts=2, roof_mat='shingle_gray', z0=0.0):
    """Covered porch on the front (-y) of a house: deck, posts, flat roof."""
    m.volume(cx, cy, w, d, z0, z0 + 0.4, 'deck_wood')
    n = max(2, posts)
    for i in range(n):
        px = cx - w / 2 + 0.2 + (w - 0.4) * i / (n - 1)
        m.volume(px, cy - d / 2 + 0.2, 0.2, 0.2, z0 + 0.4, ze, 'trim_white')
    m.count += 1
    _shed(m, cx, cy, w + 0.3, d + 0.3, ze, ze + 0.4, roof_mat, f'porch{m.count}')
    # railing, steps and post trim: high-poly only (the baked deck carries them)
    fr = Frame((cx - w / 2, cy - d / 2), (1, 0))
    gap0, gap1 = w / 2 - 0.75, w / 2 + 0.75
    for r0, r1 in ((0.1, gap0), (gap1, w - 0.1)):
        m.hp.fbox(fr, r0, r1, -0.11, -0.05, z0 + 0.4 + 0.85, z0 + 0.4 + 0.92, 'trim_white')
        m.hp.fbox(fr, r0, r1, -0.11, -0.05, z0 + 0.4 + 0.08, z0 + 0.4 + 0.14, 'trim_white')
    for k in range(int(w / 0.18)):
        u = 0.15 + k * 0.18
        if gap0 - 0.05 < u < gap1 + 0.05:
            continue
        m.hp.box(cx - w / 2 + u, cy - d / 2 + 0.08, 0.04, 0.04,
                 z0 + 0.4 + 0.14, z0 + 0.4 + 0.85, 'trim_white')
    for k in range(2):
        m.hp.fbox(fr, gap0 + 0.05, gap1 - 0.05, -0.05, 0.3 * (k + 1), z0, z0 + 0.4 * (1 - (k + 1) / 3),
                  'deck_wood', skip=('-v',))
    for i in range(n):
        px = cx - w / 2 + 0.2 + (w - 0.4) * i / (n - 1)
        m.hp.box(px, cy - d / 2 + 0.2, 0.3, 0.3, z0 + 0.4, z0 + 0.52, 'trim_white')
        m.hp.box(px, cy - d / 2 + 0.2, 0.3, 0.3, ze - 0.12, ze, 'trim_white')


def dormer(m, x, main_cy, main_d, ze, pitch, name, roof_mat, wall_mat='siding_white', width=1.5):
    """A small gabled dormer on the front (-y) slope of an x-ridge roof. It is
    a house_block of its own, half-buried in the slope, with no back wall."""
    run = main_d / 2
    y_front = main_cy - run * 0.5
    z_slope = ze + pitch * (y_front - (main_cy - run))
    depth = 2.2
    plain = dict(wall=wall_mat, corners=False, found=(0.0, wall_mat))
    front = dict(wall=wall_mat, corners=False, found=(0.0, wall_mat),
                 openings=[win(width / 2, 0, w=0.7, h=0.95, sill=0.45)], lit=0.45)
    house_block(m, x, y_front + depth / 2, width, depth, z_slope - 0.45, z_slope + 1.3,
                dict(S=front, E=plain, N=plain, W=plain),
                dict(kind='gable', mat=roof_mat, pitch=0.8, oh=0.18, rake=0.12),
                name, ridge='y', skip=('N',))
