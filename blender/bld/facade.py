"""High-poly facade generators.

Each generator fills one wall rectangle (width `L`, from `z0` to `z1`) in a
wall-local `Frame` with real reveals, mullions, piers, sills and balconies. None
of this ships: it exists to be baked into the normal / colour / occlusion /
glow maps of a flat low-poly wall, which is how a 300-triangle tower gets a
facade that holds up at close range.

Every generator is deterministic in (style, wall key), so two walls that share
a texture slot are identical and the bake does not care which one it hits.
"""
import random

from .geo import Z

GLASS_POOL = ['glass_dark'] * 4 + ['glass_mid'] * 3 + ['glass_sky'] + ['glass_teal']
WARM = ['lit_warm', 'lit_warm', 'lit_warm_dim', 'lit_white']
COOL = ['lit_cool', 'lit_cool_dim']
AWNINGS = ['awning_red', 'awning_green', 'awning_navy', 'awning_tan', 'awning_wine']
SIGNS = ['sign_warm', 'sign_warm', 'sign_cool', 'sign_pink', 'sign_white']


def _ends(u0, u1, L, base=('-w',)):
    """Skip list for a slab set into the wall: its outer ends lie in the neighbouring walls'
    planes, and a second, coplanar skin there z-fights in the hero tier and darkens the bake."""
    return base + (('-u',) if u0 < 1e-6 else ()) + (('+u',) if u1 > L - 1e-6 else ())


def pick_glass(rng, pool, blinds):
    return 'glass_blinds' if rng.random() < blinds else rng.choice(pool)


class Lights:
    """Which cells glow. Rooms light a run of bays at a time and some floors
    stay dark end to end, which reads as people working late, not as noise."""

    def __init__(self, rng, floors, cols, density, cool=0.35):
        self.grid = [[None] * cols for _ in range(floors)]
        for f in range(floors):
            activity = rng.random() ** 1.6
            p = min(0.92, density * (0.25 + 2.2 * activity))
            c = 0
            while c < cols:
                run = rng.randint(1, 3)
                if rng.random() < p:
                    mat = rng.choice(COOL if rng.random() < cool else WARM)
                    for k in range(c, min(cols, c + run)):
                        self.grid[f][k] = mat
                c += run

    def get(self, f, c):
        return self.grid[f][c]


def _grid(L, z0, z1, floor_h, bay):
    nf = max(1, round((z1 - z0) / floor_h))
    nc = max(1, round(L / bay))
    return nf, (z1 - z0) / nf, nc, L / nc


def _frame4(hp, fr, u0, u1, v0, v1, w, depth, t, mat):
    """Window frame: four thin bars standing proud of a pane at depth `w`."""
    hp.fbox(fr, u0, u1, w, w + depth, v0, v0 + t, mat, skip=('-w',))
    hp.fbox(fr, u0, u1, w, w + depth, v1 - t, v1, mat, skip=('-w',))
    hp.fbox(fr, u0, u0 + t, w, w + depth, v0 + t, v1 - t, mat, skip=('-w',))
    hp.fbox(fr, u1 - t, u1, w, w + depth, v0 + t, v1 - t, mat, skip=('-w',))


def curtain(hp, fr, L, z0, z1, st, rng):
    """Glass curtain wall: spandrel glass, vision glass, mullions, transoms."""
    nf, fh, nc, bw = _grid(L, z0, z1, st['floor_h'], st['bay'])
    lights = Lights(rng, nf, nc, st.get('lit', 0.14), st.get('cool', 0.35))
    sp, tr, md, mw = st.get('sp_h', 1.15), 0.08, 0.14, 0.07
    frame = st['frame']
    for f in range(nf):
        fz = z0 + f * fh
        hp.fquad(fr, 0, L, fz, fz + sp, -0.04, st['spandrel'])
        hp.fbox(fr, 0, L, 0, md, fz + sp, fz + sp + tr, frame, skip=('-w',))
        hp.fbox(fr, 0, L, 0, md, fz + fh - tr, fz + fh, frame, skip=('-w',))
        for c in range(nc):
            mat = lights.get(f, c) or pick_glass(rng, st['glass'], st.get('blinds', 0.06))
            hp.pane(fr, c * bw, (c + 1) * bw, fz + sp + tr, fz + fh - tr, -0.1, mat)
    for c in range(nc + 1):
        hp.fbox(fr, max(0, c * bw - mw / 2), min(L, c * bw + mw / 2), 0, md, z0, z1,
                frame, skip=('-w',))


def punched(hp, fr, L, z0, z1, st, rng):
    """Masonry or concrete wall with deep-set windows, sills and lintels."""
    nf, fh, nc, bw = _grid(L, z0, z1, st['floor_h'], st['bay'])
    lights = Lights(rng, nf, nc, st.get('lit', 0.17), st.get('cool', 0.35))
    ww, wh, sill = bw * st['win_w'], fh * st['win_h'], fh * st['sill']
    depth, wall = st.get('depth', 0.45), st['wall']
    trim = st.get('trim', wall)
    for f in range(nf):
        fz = z0 + f * fh
        wz0, wz1 = fz + sill, fz + sill + wh
        hp.fbox(fr, 0, L, -depth, 0, fz, wz0, wall, skip=_ends(0, L, L))
        hp.fbox(fr, 0, L, -depth, 0, wz1, fz + fh, wall, skip=_ends(0, L, L))
        edges = [0.0]
        for c in range(nc):
            u0 = (c + 0.5) * bw - ww / 2
            edges += [u0, u0 + ww]
        edges.append(L)
        for i in range(0, len(edges), 2):
            if edges[i + 1] - edges[i] > 1e-3:
                hp.fbox(fr, edges[i], edges[i + 1], -depth, 0, wz0, wz1, wall, skip=_ends(edges[i], edges[i + 1], L))
        for c in range(nc):
            u0, u1 = edges[1 + 2 * c], edges[2 + 2 * c]
            mat = lights.get(f, c) or pick_glass(rng, st['glass'], st.get('blinds', 0.08))
            hp.pane(fr, u0, u1, wz0, wz1, -depth + 0.03, mat)
            _frame4(hp, fr, u0, u1, wz0, wz1, -depth + 0.03, 0.08, 0.06, st['frame'])
            if st.get('sills', True):
                hp.fbox(fr, u0 - 0.1, u1 + 0.1, -depth, 0.1, wz0 - 0.12, wz0, trim,
                        skip=('-w', '-v'))
            if st.get('lintel', True):
                hp.fbox(fr, u0 - 0.12, u1 + 0.12, -depth, 0.07, wz1, wz1 + 0.16, trim,
                        skip=('-w',))
            if ww > 1.3:
                mid = (u0 + u1) / 2
                hp.fbox(fr, mid - 0.04, mid + 0.04, -depth + 0.03, -depth + 0.13, wz0, wz1,
                        st['frame'], skip=('-w',))
    dress = random.Random(rng.random())
    if st.get('ac_units'):
        # window air conditioners hung on the sills of a few flats: the walk-up's signature
        for f in range(nf):
            fz = z0 + f * fh
            for c in range(nc):
                if dress.random() < st['ac_units']:
                    uc = (c + 0.5) * bw
                    w = min(0.34, ww * 0.4)
                    hp.fbox(fr, uc - w, uc + w, -depth + 0.05, 0.34, fz + sill + 0.02, fz + sill + 0.44,
                            'metal_roof', skip=('-w',))
                    hp.fbox(fr, uc - w + 0.04, uc + w - 0.04, 0.34, 0.36, fz + sill + 0.08, fz + sill + 0.38,
                            'louver', skip=('-w',))
    if st.get('fire_escape') and nc >= 4 and nf >= 3:
        fire_escape(hp, fr, nc // 2 - 1, bw, z0, nf, fh, sill)


def fire_escape(hp, fr, c0, bw, z0, nf, fh, sill):
    """A steel fire escape across two bays: a landing under the windows of every storey above
    the first, railings with balusters, and a stair running up from each landing to the next,
    switching direction floor by floor. All of it stands clear of the wall."""
    ua, ub = c0 * bw + 0.15, (c0 + 2) * bw - 0.15
    deep = 1.15
    for f in range(1, nf):
        pz = z0 + f * fh + sill - 0.12
        hp.fbox(fr, ua, ub, 0.04, deep, pz - 0.07, pz, 'frame_dark')
        # railing: top rail, mid rail and balusters along the front, rails at both ends
        for zr, t in ((pz + 0.98, 0.05), (pz + 0.5, 0.03)):
            hp.fbox(fr, ua, ub, deep - 0.05, deep, zr, zr + t, 'frame_dark', skip=('-w',))
            for ue in (ua, ub - 0.04):
                hp.fbox(fr, ue, ue + 0.04, 0.04, deep - 0.05, zr, zr + t, 'frame_dark')
        u = ua
        while u <= ub - 0.02:
            hp.fbox(fr, u, u + 0.025, deep - 0.04, deep - 0.015, pz, pz + 0.98, 'frame_dark', skip=('-v', '+v'))
            u += 0.24
        if f == nf - 1:
            break
        # the stair to the next landing: treads between two stringers, alternating ends
        up = (f % 2 == 1)
        run = min(2.6, (ub - ua) * 0.55)
        sa, sb = (ub - run, ub - 0.1) if up else (ua + 0.1, ua + run)
        z_lo, z_hi = pz, pz + fh
        n = max(6, int(fh / 0.2))
        for i in range(n):
            t = (i + 0.5) / n
            uu = sa + (sb - sa) * (t if up else 1 - t)
            zz = z_lo + (z_hi - z_lo) * t
            hp.fbox(fr, uu - 0.13, uu + 0.13, 0.2, 0.95, zz - 0.03, zz, 'frame_dark', skip=('-w',))
        for wv in (0.17, 0.95):
            p0 = (sa, z_lo) if up else (sb, z_lo)
            p1 = (sb, z_hi) if up else (sa, z_hi)
            pts = [fr.p(p0[0], wv, p0[1] - 0.12), fr.p(p1[0], wv, p1[1] - 0.12),
                   fr.p(p1[0], wv, p1[1] + 0.02), fr.p(p0[0], wv, p0[1] + 0.02)]
            hp.face(pts, 'frame_dark', expect=fr.n if wv > 0.5 else -fr.n)
            hp.face(pts, 'frame_dark', expect=-fr.n if wv > 0.5 else fr.n)


def deco(hp, fr, L, z0, z1, st, rng):
    """Continuous stone piers with recessed glass and bronze spandrels."""
    nf, fh, nc, bw = _grid(L, z0, z1, st['floor_h'], st['bay'])
    lights = Lights(rng, nf, nc, st.get('lit', 0.16), st.get('cool', 0.2))
    pw, proj, wall = st.get('pier', 0.6), st.get('proj', 0.35), st['wall']
    # the backing wall sits BEHIND the window plane (-0.28); in front of it the
    # glass is buried and the whole tower reads as one slab of stone
    hp.fbox(fr, 0, L, -0.62, -0.34, z0, z1, wall, skip=('-w',))
    for c in range(nc + 1):
        hp.fbox(fr, max(0, c * bw - pw / 2), min(L, c * bw + pw / 2), -0.62, proj, z0, z1,
                wall, skip=('-w',))
    for f in range(nf):
        fz = z0 + f * fh
        wz0, wz1 = fz + 0.5, fz + fh - 1.25
        top = fz + fh + 0.5 if f < nf - 1 else fz + fh
        for c in range(nc):
            u0, u1 = c * bw + pw / 2, (c + 1) * bw - pw / 2
            mat = lights.get(f, c) or pick_glass(rng, st['glass'], 0.05)
            hp.pane(fr, u0, u1, wz0, wz1, -0.28, mat)
            _frame4(hp, fr, u0, u1, wz0, wz1, -0.28, 0.1, 0.05, st['frame'])
            hp.fquad(fr, u0, u1, wz1, top, -0.12, 'bronze')


def ribbon(hp, fr, L, z0, z1, st, rng):
    """Residential slab: ribbon glazing behind projecting balcony decks."""
    nf, fh, nc, bw = _grid(L, z0, z1, st['floor_h'], st['bay'])
    lights = Lights(rng, nf, nc, st.get('lit', 0.2), st.get('cool', 0.25))
    bal = st.get('balcony', 1.3)
    every = st.get('solid_every', 4)
    fin_every = st.get('fin_every', 0)
    for f in range(nf):
        fz = z0 + f * fh
        hp.fbox(fr, 0, L, 0, bal, fz, fz + 0.22, st['slab'], skip=('-w',))
        hp.fquad(fr, 0, L, fz + 0.22, fz + 1.15, bal - 0.04, 'railing')
        hp.fbox(fr, 0, L, bal - 0.07, bal, fz + 1.15, fz + 1.21, st['frame'])
        for c in range(nc):
            u0, u1 = c * bw, (c + 1) * bw
            if c % every == every - 1:
                hp.fquad(fr, u0, u1, fz + 0.22, fz + fh, 0.0, st['wall'])
            else:
                mat = lights.get(f, c) or pick_glass(rng, st['glass'], 0.18)
                hp.pane(fr, u0, u1, fz + 0.4, fz + fh - 0.12, 0.0, mat)
                _frame4(hp, fr, u0, u1, fz + 0.4, fz + fh - 0.12, 0.0, 0.06, 0.05, st['frame'])
    if fin_every:
        for c in range(0, nc + 1, fin_every):
            hp.fbox(fr, max(0, c * bw - 0.1), min(L, c * bw + 0.1), 0, bal + 0.1, z0, z1,
                    st['wall'], skip=('-w',))


def steel(hp, fr, L, z0, z1, st, rng):
    """Loft building: brick wall, big steel-sash windows with fine muntins."""
    nf, fh, nc, bw = _grid(L, z0, z1, st['floor_h'], st['bay'])
    lights = Lights(rng, nf, nc, st.get('lit', 0.18), st.get('cool', 0.3))
    ww, wh, sill = bw * 0.74, fh * 0.72, fh * 0.14
    depth, wall = 0.4, st['wall']
    for f in range(nf):
        fz = z0 + f * fh
        wz0, wz1 = fz + sill, fz + sill + wh
        hp.fbox(fr, 0, L, -depth, 0, fz, wz0, wall, skip=_ends(0, L, L))
        hp.fbox(fr, 0, L, -depth, 0, wz1, fz + fh, wall, skip=_ends(0, L, L))
        edges = [0.0]
        for c in range(nc):
            u0 = (c + 0.5) * bw - ww / 2
            edges += [u0, u0 + ww]
        edges.append(L)
        for i in range(0, len(edges), 2):
            hp.fbox(fr, edges[i], edges[i + 1], -depth, 0, wz0, wz1, wall, skip=_ends(edges[i], edges[i + 1], L))
        for c in range(nc):
            u0, u1 = edges[1 + 2 * c], edges[2 + 2 * c]
            nx, ny = max(2, round(ww / 0.75)), max(3, round(wh / 0.75))
            # one tone per window: a sash is one room, and per-pane noise reads
            # as static instead of as muntins
            lit = lights.get(f, c)
            tone = lit or pick_glass(rng, st['glass'], 0.05)
            for ix in range(nx):
                for iy in range(ny):
                    mat = tone if rng.random() < 0.94 else pick_glass(rng, st['glass'], 0.0)
                    hp.pane(fr, u0 + ww * ix / nx, u0 + ww * (ix + 1) / nx,
                            wz0 + wh * iy / ny, wz0 + wh * (iy + 1) / ny, -depth + 0.05, mat,
                            whole=(u0, u1, wz0, wz1))
            for ix in range(nx + 1):
                x = u0 + ww * ix / nx
                hp.fbox(fr, x - 0.025, x + 0.025, -depth + 0.05, -depth + 0.14, wz0, wz1,
                        st['frame'], skip=('-w',))
            for iy in range(ny + 1):
                y = wz0 + wh * iy / ny
                hp.fbox(fr, u0, u1, -depth + 0.05, -depth + 0.14, y - 0.025, y + 0.025,
                        st['frame'], skip=('-w',))
            hp.fbox(fr, u0 - 0.12, u1 + 0.12, -depth, 0.1, wz0 - 0.14, wz0, wall, skip=('-w', '-v'))


def louver(hp, fr, L, z0, z1, st, rng):
    """Mechanical floor: a dark backing wall behind horizontal slats."""
    hp.fquad(fr, 0, L, z0, z1, -0.3, st.get('backing', 'spandrel'))
    pitch = st.get('pitch', 0.42)
    n = max(1, int((z1 - z0) / pitch))
    for i in range(n):
        z = z0 + (i + 0.5) * (z1 - z0) / n
        hp.fbox(fr, 0.15, L - 0.15, -0.3, 0.2, z - 0.06, z + 0.06, st['mat'], skip=('-w',))
    for c in range(0, int(L // 5) + 2):
        u = min(L, c * 5.0)
        hp.fbox(fr, max(0, u - 0.12), min(L, u + 0.12), -0.3, 0.25, z0, z1, st['frame'],
                skip=('-w',))


def storefront(hp, fr, L, z0, z1, g, rng):
    """Ground floor: tall shopfront glazing between piers and a signband, and per shop
    either a striped-colour awning or a lit sign box, a door with its transom, and now and
    then a blade sign hung out over the pavement. With `lobby` the middle bay is the tower's
    entrance instead: full-height glass under a canopy with downlights."""
    nc = max(1, round(L / g.get('bay', 4.5)))
    bw = L / nc
    pier = 0.7
    # the dressing draws from a stream of its own, seeded from the wall's: shared walls stay
    # identical, and the shop lights below keep their own draws
    dress = random.Random(rng.random())
    hp.fbox(fr, 0, L, -0.35, 0, z0, z0 + 0.5, g['wall'], skip=_ends(0, L, L))
    for c in range(nc + 1):
        a, b = max(0, c * bw - pier / 2), min(L, c * bw + pier / 2)
        hp.fbox(fr, a, b, -0.35, 0.1, z0, z1, g['wall'], skip=_ends(a, b, L))
    lobby = nc // 2 if g.get('lobby') and nc >= 3 else -1
    zs = z1 - 1.15                     # underside of the signband
    for c in range(nc):
        u0, u1 = c * bw + pier / 2, (c + 1) * bw - pier / 2
        mat = rng.choice(WARM) if rng.random() < g.get('lit', 0.55) else pick_glass(rng, GLASS_POOL, 0.1)
        if c == lobby:
            hp.pane(fr, u0, u1, z0 + 0.05, zs - 0.5, -0.3, 'lit_white')
            n = max(2, round((u1 - u0) / 1.2))
            for k in range(n + 1):
                u = u0 + (u1 - u0) * k / n
                hp.fbox(fr, u - 0.04, u + 0.04, -0.3, -0.18, z0 + 0.05, zs - 0.5, 'frame_dark', skip=('-w',))
            hp.fbox(fr, u0, u1, -0.3, -0.18, z0 + 2.6, z0 + 2.7, 'frame_dark', skip=('-w',))
            hp.fquad(fr, u0, u1, zs - 0.5, zs, -0.3, 'bronze')
            # canopy over the doors, with a row of downlights in its soffit
            hp.fbox(fr, u0 - 0.6, u1 + 0.6, 0.1, 2.8, zs - 0.75, zs - 0.45, 'frame_dark')
            for k in range(4):
                u = u0 + (u1 - u0) * (k + 0.5) / 4
                for w in (0.9, 2.1):
                    hp.face([fr.p(u - 0.12, w - 0.12, zs - 0.76), fr.p(u + 0.12, w - 0.12, zs - 0.76),
                             fr.p(u + 0.12, w + 0.12, zs - 0.76), fr.p(u - 0.12, w + 0.12, zs - 0.76)],
                            'lamp_glow', expect=-Z)
            continue
        hp.pane(fr, u0, u1, z0 + 0.6, zs, -0.3, mat)
        _frame4(hp, fr, u0, u1, z0 + 0.6, zs, -0.3, 0.08, 0.07, 'frame_dark')
        # the door: a dark leaf with a glazed top, in a frame, at one end of the bay
        if u1 - u0 > 2.6:
            d0 = u0 + 0.2 if dress.random() < 0.5 else u1 - 1.25
            hp.fquad(fr, d0, d0 + 1.05, z0 + 0.02, z0 + 2.35, -0.26, 'frame_dark')
            hp.pane(fr, d0 + 0.14, d0 + 0.91, z0 + 0.9, z0 + 2.2, -0.24, mat)
            _frame4(hp, fr, d0 - 0.05, d0 + 1.1, z0, z0 + 2.45, -0.3, 0.1, 0.07, 'frame_dark')
        if dress.random() < g.get('awnings', 0.5):
            # awning: a sloped skin over the shop window, a valance, closed cheeks
            colour = dress.choice(AWNINGS)
            za, zb, wa, wb = zs - 0.05, zs - 0.75, 0.12, 1.35
            a0, a1 = u0 - 0.1, u1 + 0.1
            up = Z * (wb - wa) + fr.n * (za - zb)
            hp.face([fr.p(a0, wa, za), fr.p(a1, wa, za), fr.p(a1, wb, zb), fr.p(a0, wb, zb)], colour, expect=up)
            hp.face([fr.p(a0, wa, za - 0.03), fr.p(a1, wa, za - 0.03), fr.p(a1, wb, zb - 0.03),
                     fr.p(a0, wb, zb - 0.03)], colour, expect=-up)
            hp.fbox(fr, a0, a1, wb - 0.02, wb + 0.01, zb - 0.32, zb, colour)
            for ue, nrm in ((a0, -fr.u), (a1, fr.u)):
                hp.face([fr.p(ue, wa, za), fr.p(ue, wb, zb), fr.p(ue, wb, zb - 0.32)], colour, expect=nrm)
        else:
            # a lit sign box on the signband
            hp.fbox(fr, u0 + 0.3, u1 - 0.3, 0.15, 0.34, zs + 0.2, z1 - 0.18, dress.choice(SIGNS))
        if dress.random() < g.get('blades', 0.25):
            # a blade sign hung out over the pavement, on a bracket
            ub = u1 + pier / 2 - 0.05 if c < nc - 1 else u0 - pier / 2 + 0.05
            hp.fbox(fr, ub - 0.05, ub + 0.05, 0.3, 1.2, z1 - 0.95, z1 + 0.45, dress.choice(SIGNS))
            hp.fbox(fr, ub - 0.02, ub + 0.02, 0.15, 1.25, z1 + 0.5, z1 + 0.55, 'frame_dark')
    hp.fbox(fr, 0, L, -0.35, 0.15, zs, z1, g['wall'], skip=('-w',))


KINDS = {
    'curtain': curtain, 'punched': punched, 'deco': deco,
    'ribbon': ribbon, 'steel': steel, 'louver': louver,
}


def build_wall(hp, fr, L, z0, z1, st, rng):
    """One wall: optional shopfront storey, the facade, optional cornice."""
    ground = st.get('ground')
    if ground:
        storefront(hp, fr, L, z0, z0 + ground['h'], ground, rng)
        z0 += ground['h']
    KINDS[st['kind']](hp, fr, L, z0, z1, st, rng)
    if st.get('cornice'):
        h, d, mat = st['cornice']
        hp.fbox(fr, 0, L, -0.1, d, z1 - h, z1, mat, skip=('-w',))
    if st.get('belt'):
        zb, d, mat = st['belt']
        hp.fbox(fr, 0, L, -0.1, d, z0 + zb, z0 + zb + 0.35, mat, skip=('-w',))
