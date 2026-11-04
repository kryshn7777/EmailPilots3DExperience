"""The night-time IT office's props, each built twice from one description.

`build(name, hi)` returns a `Build`: a list of parts (geometry, material, atlas weight, LED tint).
With hi=True it is the high-poly bake source: rounded bevels of three segments, 24 to 64 sided
round parts, and every small detail (keycaps' bevels, RJ45 jacks, drive caddies, vents, screws,
sticky notes, mouse pads, cables lying flat, labels...) as real geometry under procedural
materials (office_mats.py). With hi=False it is the lean mesh that ships: the same parts with
chamfers or none, fewer sides, and whatever lies within a few millimetres of a surface left to
the baked normal and colour maps.

Blender axes: X right, -Y the front (the user's side; glTF +Z), Z up, metres; each prop stands
on z = 0 round the origin (make_it_office.py re-centres it on its footprint).

Materials named in office_mats.EMISSIVE / CANVAS, and `led`, are not baked into the atlas: they
stay their own materials (screen / bulb / panel glow, the whiteboard face, the LEDs), with
UVs of their own (0..1 across a screen or the board; an LED samples its tint's palette cell).
"""
import math
import random

from .office_geo import (Geo, bend_x, box, cyl, grid, join, lathe, prism, quad, rbox, rrect, slab,
                         smooth_path, sphere, torus, tube, sweep)

U = 0.04445  # one rack unit

OWN = {'screen', 'bulb', 'panel', 'board', 'led'}


class Build:
    def __init__(self, hi, seed=1):
        self.hi = hi
        self.parts = []   # (geo, mat, weight, tint)
        self.rng = random.Random(seed)

    def add(self, g, mat, w=1.0, tint=None):
        if g is not None:
            self.parts.append((g, mat, w, tint))
        return g

    def n(self, hp, lp):
        return hp if self.hi else lp

    def mark(self):
        return len(self.parts)

    def xform(self, i0, fn):
        for g, *_ in self.parts[i0:]:
            fn(g)

    def tris(self):
        return sum(g.tris() for g, *_ in self.parts)


# -- helpers ---------------------------------------------------------------------------------

def bx(b, sx, sy, sz, c, mat, r=0.0, w=1.0, lp=True, chamfer=None):
    """A box: rounded by r (three segments) in the high-poly build, chamfered (one) in the lean
    build when r >= 4 mm (or `chamfer` says so); lp=False leaves it to the bake."""
    if b.hi:
        return b.add(box(sx, sy, sz, c, bev=r, segs=3 if r > 0 else 0), mat, w)
    if not lp:
        return None
    ch = (r >= 0.004) if chamfer is None else chamfer
    return b.add(box(sx, sy, sz, c, bev=r if ch else 0.0, segs=1 if ch else 0), mat, w)


def hp(b, g, mat):
    """A high-poly-only detail (lies within the cage of a lean surface)."""
    if b.hi:
        b.add(g() if callable(g) else g, mat)


def cy(b, r, h, c, mat, axis='Z', hs=32, ls=16, bev=0.0, w=1.0, lp=True, r2=None):
    if not b.hi and not lp:
        return None
    return b.add(cyl(r, h, b.n(hs, ls), c, axis, r2=r2, bev=bev if b.hi else 0.0, bsegs=2), mat, w)


def cable(b, ctrl, r, mat, hs=10, ls=6, hn=40, ln=12, w=0.4, lp=True):
    if not b.hi and not lp:
        return None
    pts = smooth_path(ctrl, b.n(hn, ln))
    return b.add(tube(pts, r, b.n(hs, ls)), mat, w)


def led(b, x, y, z, tint, sx=0.003, sz=0.003, face='-Y'):
    """An LED: an emissive dot just proud of a front face (-Y) or a top face (+Z; then sz is its
    depth along Y). A quad in the lean build."""
    if b.hi:
        if face == '+Z':
            b.add(box(sx, sz, 0.0008, (x, y, z + 0.0002)), 'led_' + tint)
        else:
            b.add(box(sx, 0.0008, sz, (x, y - 0.0002, z)), 'led_' + tint)
        return
    if face == '+Z':
        zz = z + 0.001
        g = quad((x - sx / 2, y - sz / 2, zz), (x + sx / 2, y - sz / 2, zz), (x + sx / 2, y + sz / 2, zz), (x - sx / 2, y + sz / 2, zz))
    else:
        yy = y - 0.001
        g = quad((x - sx / 2, yy, z - sz / 2), (x + sx / 2, yy, z - sz / 2), (x + sx / 2, yy, z + sz / 2),
                 (x - sx / 2, yy, z + sz / 2))
    b.add(g, 'led', 1.0, tint)


def screen(b, cx, y, cz, w, h, mat='screen'):
    """A display face toward -Y with UVs 0..1 (u to the viewer's right, v up)."""
    g = quad((cx - w / 2, y, cz - h / 2), (cx + w / 2, y, cz - h / 2), (cx + w / 2, y, cz + h / 2),
             (cx - w / 2, y, cz + h / 2))
    b.add(g, mat)
    return g


def sticky(b, x, y, z, mat, ang=0.0, curl=0.004, size=0.076, plane='XY'):
    """A sticky note (high-poly only: it bakes into whatever it is stuck to)."""
    if not b.hi:
        return
    g = grid(size, size, 6, 6, plane='XY', uv=False).move(z=0.0003)

    def f(v):
        t = (v[:, 1] + size / 2) / size
        v[:, 2] += curl * t ** 2.2
        return v
    g.warp(f).rot('Z', ang)
    # give it a back so it is a closed sheet
    back = g.copy().move(z=-0.0002)
    back.f = [tuple(reversed(fc)) for fc in back.f]
    g = join([g, back])
    if plane == 'XZ':  # stuck on a vertical face toward -Y
        g.rot('X', 90)
    b.add(g.move(x, y, z), mat)


def mug(b, x, y, z=0.0, mat='ceramic_white', ang=0.0, full=True, r=0.041, h=0.096):
    s = b.n(40, 20)
    prof = [(0.0, 0.0), (r - 0.006, 0.0), (r - 0.002, 0.002), (r, 0.008), (r, h - 0.003), (r - 0.0015, h),
            (r - 0.0035, h), (r - 0.0045, h - 0.004), (r - 0.0045, 0.012), (r - 0.012, 0.008), (0.0, 0.008)]
    if not b.hi:
        prof = [(0.0, 0.0), (r - 0.004, 0.0), (r, 0.006), (r, h - 0.002), (r - 0.0025, h),
                (r - 0.0045, h - 0.004), (r - 0.0045, 0.012), (0.0, 0.008)]
    i0 = b.mark()
    b.add(lathe(prof, s), mat, 1.2)
    hpts = [(r - 0.002, 0, h * 0.82), (r + 0.022, 0, h * 0.78), (r + 0.028, 0, h * 0.5), (r + 0.02, 0, h * 0.25),
            (r - 0.002, 0, h * 0.2)]
    b.add(sweep(smooth_path(hpts, b.n(28, 8)), [(-0.006, -0.0035), (0.006, -0.0035), (0.006, 0.0035), (-0.006, 0.0035)]
                if not b.hi else _rounded_section(0.012, 0.007, 3)), mat, 1.0)
    if full:
        b.add(lathe([(0.0, h * 0.78), (r - 0.0045, h * 0.78)], s), 'coffee', 0.6)
    b.xform(i0, lambda g: g.rot('Z', ang).move(x, y, z))


def _rounded_section(w, h, segs):
    pts = []
    r = min(w, h) * 0.45
    for cx, cy, a0 in ((w / 2 - r, -h / 2 + r, -90), (w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90),
                       (-w / 2 + r, -h / 2 + r, 180)):
        for i in range(segs + 1):
            a = math.radians(a0 + 90 * i / segs)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


# -- monitor -------------------------------------------------------------------------------------

MON_W, MON_H = 0.5436, 0.3226       # 24-inch 16:9 panel with 6.5 mm bezels and an 18 mm chin
MON_ACTIVE = (0.5309, 0.2986)


def monitor(b, stand=True, notes=False):
    """A 24-inch monitor, panel centred on the origin, screen toward -Y (front at y = -6 mm)."""
    W, H = MON_W, MON_H
    chin = 0.018
    aw, ah = MON_ACTIVE
    sc_z = -H / 2 + chin + ah / 2
    bx(b, W, 0.012, H, (0, 0, 0), 'plastic_black', r=0.003, w=1.4, chamfer=True)
    screen(b, 0, -0.0072, sc_z, aw, ah)
    if b.hi:
        # the glass sits a hair below a 1 mm lip; the chin has a soft-touch strip and a logo
        lip = 0.0012
        for sx, sz, cx, cz in ((W - 0.004, lip, 0, sc_z + ah / 2 + lip / 2 + 0.0002), (W - 0.004, lip, 0, sc_z - ah / 2 - lip / 2 - 0.0002),
                               (lip, ah, -aw / 2 - lip / 2 - 0.0002, sc_z), (lip, ah, aw / 2 + lip / 2 + 0.0002, sc_z)):
            b.add(box(sx, 0.0024, sz, (cx, -0.0068, cz)), 'plastic_gloss')
        b.add(box(0.034, 0.0006, 0.0042, (0, -0.0062, -H / 2 + chin / 2)), 'alu')
        b.add(box(0.008, 0.0012, 0.004, (W / 2 - 0.03, -0.0062, -H / 2 + chin / 2)), 'plastic_dark')
    led(b, W / 2 - 0.018, -0.006, -H / 2 + chin / 2, 'white', 0.002, 0.002)
    # back: a shallow tray across the whole panel, a deeper rounded housing behind the middle
    bx(b, W - 0.006, 0.008, H - 0.006, (0, 0.009, 0), 'plastic_black', r=0.003, w=0.6)
    if b.hi:
        b.add(box(0.42, 0.03, 0.24, (0, 0.026, -0.01), bev=0.014, segs=4), 'plastic_black')
    else:
        b.add(box(0.42, 0.03, 0.24, (0, 0.026, -0.01), bev=0.012, segs=2), 'plastic_black', 0.6)
    if b.hi:
        # vents along the housing top, ports in a recess at the bottom
        b.add(box(0.30, 0.016, 0.0016, (0, 0.024, 0.11)), 'vent_black')
        for i, (wpx, col) in enumerate(((0.014, 'plastic_dark'), (0.016, 'plastic_dark'), (0.011, 'chip'), (0.009, 'chip'), (0.012, 'chip'))):
            b.add(box(wpx, 0.007, 0.0014, (-0.08 + i * 0.035, 0.026, -0.1305)), col)
        for i in range(4):  # VESA screws
            b.add(cyl(0.0035, 0.002, 16, (-0.05 + (i % 2) * 0.1, 0.0418, -0.05 + (i // 2) * 0.1), 'Y'), 'steel_bare')
    bx(b, 0.13, 0.006, 0.13, (0, 0.0438, 0.0), 'plastic_dark', r=0.004, w=0.4)
    if stand:
        # a tilting neck into a flat oval foot
        i0 = b.mark()
        bx(b, 0.075, 0.03, 0.27, (0, 0.062, -0.13), 'alu_dark', r=0.008, w=0.7)
        bx(b, 0.09, 0.03, 0.05, (0, 0.06, 0.0), 'plastic_dark', r=0.008, w=0.4)
        b.xform(i0, lambda g: g.rot('X', 6, o=(0, 0.06, 0)))
        foot = rrect(0.25, 0.2, 0.07, b.n(10, 4))
        b.add(prism(foot, 0.013, c=(0, 0.06, -H / 2 - 0.11 + 0.0), bev=b.n(0.004, 0.0), bsegs=b.n(3, 0)), 'alu_dark', 0.8)
        hp(b, lambda: prism(rrect(0.22, 0.17, 0.06, 10), 0.002, c=(0, 0.06, -H / 2 - 0.112)), 'rubber')
    if notes and b.hi:
        sticky(b, -W / 2 + 0.05, -0.0064, -H / 2 + 0.015, 'note_yellow', ang=4, curl=0.006, size=0.07, plane='XZ')
        sticky(b, W / 2 - 0.06, -0.0064, H / 2 - 0.06, 'note_pink', ang=-6, curl=0.005, size=0.06, plane='XZ')


def build_monitor_24(b):
    i0 = b.mark()
    monitor(b, stand=True)
    # stand foot bottom at z = -H/2 - 0.112: lift it all onto z = 0
    b.xform(i0, lambda g: g.rot('X', -4, o=(0, 0, 0)).move(z=MON_H / 2 + 0.112))


# -- keyboard, mouse, small desk things -----------------------------------------------------------------

def keyboard(b, x, y, z, ang=0.0):
    i0 = b.mark()
    W, D = 0.44, 0.135
    prof = [(-D / 2, 0.0), (D / 2, 0.0), (D / 2, 0.026), (D / 2 - 0.01, 0.028), (-D / 2 + 0.006, 0.0165), (-D / 2, 0.012)]
    b.add(slab(prof, W, axis='X', bev=b.n(0.003, 0.0), bsegs=b.n(3, 0)), 'plastic_black', 1.6)
    pitch = 0.019
    slope = (0.026 - 0.0165) / (D - 0.016)
    rows = [  # (units per key, ...) left to right, main block 15 u; gaps as negative
        [1, -1, 1, 1, 1, 1, -0.5, 1, 1, 1, 1, -0.5, 1, 1, 1, 1, -0.25, 1, 1, 1],
        [1] * 13 + [2, -0.25, 1, 1, 1, -0.25, 1, 1, 1, 1],
        [1.5] + [1] * 12 + [1.5, -0.25, 1, 1, 1, -0.25, 1, 1, 1, 1],
        [1.75] + [1] * 11 + [2.25, -0.25, -3, -0.25, 1, 1, 1, 1],
        [2.25] + [1] * 10 + [2.75, -0.25, -1, 1, -1, -0.25, 1, 1, 1, 1],
        [1.25, 1.25, 1.25, 6.25, 1.25, 1.25, 1.25, 1.25, -0.25, 1, 1, 1, -0.25, 2, 1, 1],
    ]
    total = 22.5 * pitch
    for ri, row in enumerate(rows):
        ky = D / 2 - 0.016 - ri * pitch - (0.006 if ri else 0.0)
        kx = -total / 2
        for wu in row:
            if wu < 0:
                kx += -wu * pitch
                continue
            kw = wu * pitch - 0.0022
            kd = pitch - 0.0022 if ri else pitch * 0.8
            cx, cy = kx + wu * pitch / 2, ky - pitch / 2
            zb = 0.0165 + slope * (cy + D / 2 - 0.006) - 0.002
            if b.hi:
                g = box(kw, kd, 0.009, (cx, cy, zb + 0.0045), bev=0.0012, segs=2)
            else:
                g = box(kw, kd, 0.009, (cx, cy, zb + 0.0045))
                g.f = [f for f in g.f if not all(abs(g.v[i][2] - zb) < 1e-6 for i in f)]

            def taper(v, cx=cx, cy=cy, zb=zb):
                t = (v[:, 2] - zb) / 0.009
                k = 1 - 0.18 * t
                v[:, 0] = cx + (v[:, 0] - cx) * (1 - 0.12 * t)
                v[:, 1] = cy + (v[:, 1] - cy) * k
                return v
            b.add(g.warp(taper), 'plastic_dark' if wu == 1 else 'plastic_black', 1.4)
            kx += wu * pitch
    hp(b, lambda: box(0.012, 0.004, 0.0015, (W / 2 - 0.05, D / 2 - 0.006, 0.0262)), 'led_white')
    b.xform(i0, lambda g: g.rot('Z', ang).move(x, y, z))


def mouse(b, x, y, z, ang=0.0):
    i0 = b.mark()
    g = sphere(0.5, b.n(40, 14), b.n(20, 8))

    def shape(v):
        v[:, 2] = np.maximum(v[:, 2], -0.32) + 0.32
        v[:, 0] *= 0.064 * (1 - 0.12 * (v[:, 1] + 0.5))
        v[:, 2] *= 0.046 * (0.75 + 0.5 * (v[:, 1] + 0.5) * (1.5 - (v[:, 1] + 0.5)))
        v[:, 1] *= 0.116
        return v
    b.add(g.warp(shape), 'plastic_black', 1.6)
    cy(b, 0.0105, 0.007, (0, -0.03, 0.033), 'rubber', 'X', 24, 8)
    hp(b, lambda: box(0.0008, 0.05, 0.002, (0, -0.033, 0.034)).warp(lambda v: _bulge(v, 0.0)), 'plastic_dark')
    b.xform(i0, lambda g: g.rot('Z', ang).move(x, y, z))


def _bulge(v, z0):
    v[:, 2] += 0.004 * (1 - (v[:, 1] / 0.06) ** 2)
    return v


import numpy as np  # noqa: E402  (used by the warps above)


def notebook(b, x, y, z, ang=0.0):
    i0 = b.mark()
    bx(b, 0.150, 0.212, 0.0016, (0, 0, 0.0008), 'notebook_cover', r=0.001)
    bx(b, 0.146, 0.208, 0.0105, (0.001, 0, 0.0016 + 0.00525), 'paper', r=0.0015, w=0.8)
    bx(b, 0.150, 0.212, 0.0016, (0, 0, 0.0137), 'notebook_cover', r=0.001, w=1.2)
    hp(b, lambda: box(0.006, 0.214, 0.0155, (0.058, 0, 0.0075), bev=0.0006, segs=2), 'rubber')
    hp(b, lambda: box(0.004, 0.0004, 0.09, (-0.02, -0.107, 0.06)).rot('X', 70, o=(0, -0.107, 0.014)), 'plastic_red')
    b.xform(i0, lambda g: g.rot('Z', ang).move(x, y, z))


def pen(b, x, y, z, ang=0.0, mat='plastic_blue'):
    i0 = b.mark()
    cy(b, 0.0045, 0.14, (0, 0, 0.0045), 'plastic_white', 'X', 16, 6)
    cy(b, 0.005, 0.045, (0.055, 0, 0.0045), mat, 'X', 16, 6)
    hp(b, lambda: cyl(0.0012, 0.04, 8, (0.05, 0, 0.0102), 'X'), mat)
    hp(b, lambda: cyl(0.0045, 0.008, 16, (-0.074, 0, 0.0045), 'X', r2=0.001), 'steel_bare')
    b.xform(i0, lambda g: g.rot('Z', ang).move(x, y, z))


def paper_stack(b, x, y, z, n=6, ang=0.0, w=0.21, d=0.297):
    i0 = b.mark()
    if b.hi:
        rng = random.Random(7)
        for i in range(n):
            b.add(box(w, d, 0.0011, (rng.uniform(-0.004, 0.004), rng.uniform(-0.004, 0.004), 0.0006 + i * 0.0012))
                  .rot('Z', rng.uniform(-3, 3)), 'paper_print' if i == n - 1 else 'paper')
    else:
        b.add(box(w + 0.004, d + 0.004, n * 0.0012, (0, 0, n * 0.0006)), 'paper', 0.7)
    b.xform(i0, lambda g: g.rot('Z', ang).move(x, y, z))


# -- desk pod ----------------------------------------------------------------------------------------

def build_desk_pod(b):
    W, D, H, T = 1.6, 0.8, 0.74, 0.025
    top = H - T / 2
    # top: oak laminate with an edge band
    bx(b, W, D, T, (0, 0, top), 'laminate_oak', r=0.003, w=0.85, chamfer=True)
    if b.hi:  # the cable grommet at the back right
        b.add(cyl(0.032, 0.004, 40, (0.55, 0.3, H + 0.0005), bev=0.0012), 'plastic_dark')
        b.add(cyl(0.024, 0.001, 32, (0.55, 0.3, H + 0.0025)), 'chip')
    # frame: two side frames, a beam, a perforated modesty panel, a cable tray
    for sx in (-1, 1):
        xl = sx * (W / 2 - 0.08)
        bx(b, 0.07, 0.04, H - T - 0.04, (xl, 0.0, (H - T - 0.04) / 2 + 0.035), 'steel_white', r=0.006, w=0.7)
        bx(b, 0.07, D - 0.06, 0.03, (xl, 0.0, 0.025), 'steel_white', r=0.006, w=0.5)
        bx(b, 0.05, D - 0.08, 0.03, (xl, 0.0, H - T - 0.015), 'steel_white', r=0.005, w=0.3)
        for fy in (-1, 1):
            cy(b, 0.016, 0.012, (xl, fy * (D / 2 - 0.06), 0.006), 'rubber', hs=24, ls=8)
    bx(b, W - 0.24, 0.05, 0.05, (0, 0.2, H - T - 0.03), 'steel_white', r=0.005, w=0.4)
    bx(b, W - 0.26, 0.003, 0.32, (0, 0.3, H - T - 0.2), 'perf_grey', w=0.5)
    # cable tray under the back edge: a folded steel channel with a power strip in it
    for (sx, sy, sz, c) in ((1.0, 0.12, 0.002, (0.1, 0.25, 0.6)), (1.0, 0.002, 0.08, (0.1, 0.19, 0.64)),
                            (1.0, 0.002, 0.08, (0.1, 0.31, 0.64))):
        bx(b, sx, sy, sz, c, 'steel_white', w=0.3)
    bx(b, 0.4, 0.05, 0.04, (0.25, 0.25, 0.621), 'plastic_white', r=0.004, w=0.3)
    led(b, 0.07, 0.2245, 0.625, 'red', 0.004, 0.003)
    # acoustic privacy screen along the back edge, on two clamps
    bx(b, W - 0.02, 0.03, 0.45, (0, D / 2 - 0.02, H + 0.22), 'fabric_screen', r=0.012, w=0.5, chamfer=True)
    for sx in (-0.55, 0.55):
        bx(b, 0.04, 0.05, 0.06, (sx, D / 2 - 0.02, H + 0.01), 'alu_dark', r=0.004, w=0.3)
    # monitor arm: clamp, pole, two links, a tilt head
    ax, ay = 0.42, D / 2 - 0.07
    bx(b, 0.07, 0.09, 0.03, (ax, ay, H + 0.015), 'alu_dark', r=0.005, w=0.4)
    bx(b, 0.05, 0.02, 0.09, (ax, D / 2 + 0.008, H - 0.03), 'alu_dark', r=0.004, w=0.2)
    bx(b, 0.05, 0.09, 0.012, (ax, ay, H - T - 0.05), 'alu_dark', r=0.003, w=0.2)
    cy(b, 0.018, 0.34, (ax, ay, H + 0.17), 'alu', hs=40, ls=14, w=0.6)
    cy(b, 0.021, 0.03, (ax, ay, H + 0.3), 'plastic_dark', hs=40, ls=14, bev=0.003)
    j1 = (0.17, D / 2 - 0.16, H + 0.3)
    j2 = (0.0, 0.10, H + 0.3)
    for (p0, p1) in (((ax, ay, H + 0.3), j1), (j1, j2)):
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        ln = math.hypot(dx, dy)
        ang = math.degrees(math.atan2(dy, dx))
        g = box(ln, 0.04, 0.03, (ln / 2, 0, 0), bev=b.n(0.008, 0.008), segs=b.n(3, 1))
        b.add(g.rot('Z', ang).move(p0[0], p0[1], p0[2] + 0.0), 'alu', 0.6)
        cy(b, 0.024, 0.036, p1, 'plastic_dark', hs=40, ls=14, bev=0.003)
    bx(b, 0.04, 0.05, 0.06, (0.0, 0.07, H + 0.3), 'alu_dark', r=0.006, w=0.3)
    # the monitor on the arm, a little high and tilted back
    i0 = b.mark()
    monitor(b, stand=False, notes=True)
    mon_c = (0.0, 0.0, H + 0.3)
    b.xform(i0, lambda g: g.rot('X', -5).move(mon_c[0], 0.0, mon_c[2]))
    # its cable down the arm and through the grommet
    cable(b, [(0.0, 0.03, H + 0.18), (0.02, 0.1, H + 0.22), (0.15, 0.2, H + 0.27), (ax - 0.03, ay + 0.03, H + 0.24),
              (ax - 0.02, ay + 0.035, H + 0.1), (0.55, 0.3, H + 0.02), (0.55, 0.3, H - 0.1), (0.4, 0.27, 0.64)],
          0.0032, 'cable_black', w=0.3)
    # keyboard, mouse on a pad, the keyboard's cable
    keyboard(b, -0.06, -0.2, H, ang=-1.5)
    mouse(b, 0.3, -0.2, H + 0.003, ang=8)
    if b.hi:
        b.add(prism(rrect(0.26, 0.22, 0.012, 6), 0.003, c=(0.3, -0.19, H), bev=0.0012, bsegs=2), 'felt_black')
        cable(b, [(-0.06, -0.13, H + 0.01), (-0.05, -0.07, H + 0.0025), (0.1, 0.05, H + 0.0025), (0.4, 0.2, H + 0.0025),
                  (0.55, 0.28, H + 0.0025)], 0.0022, 'cable_black')
        cable(b, [(0.3, -0.14, H + 0.01), (0.31, -0.09, H + 0.0025), (0.42, 0.05, H + 0.0025), (0.53, 0.27, H + 0.0025)],
              0.0016, 'cable_black')
    # clutter: coffee, a notebook and pen, papers, notes, a dock with its LED
    mug(b, 0.6, -0.02, H, 'ceramic_blue', ang=200)
    notebook(b, -0.52, -0.16, H, ang=14)
    pen(b, -0.5, -0.17, H + 0.0153, ang=60)
    paper_stack(b, -0.62, 0.14, H, n=7, ang=-8)
    sticky(b, -0.36, 0.06, H, 'note_yellow', ang=8, curl=0.002)
    sticky(b, -0.31, 0.02, H, 'note_pink', ang=-12, curl=0.003)
    sticky(b, 0.15, -0.05, H, 'note_blue', ang=20, curl=0.002)
    bx(b, 0.13, 0.065, 0.022, (0.32, 0.17, H + 0.011), 'plastic_dark', r=0.005, w=0.6)
    led(b, 0.37, 0.1373, H + 0.011, 'blue', 0.003, 0.002)
    if b.hi:
        for i in range(3):
            b.add(box(0.009, 0.002, 0.0045, (0.29 + i * 0.016, 0.1373, H + 0.011)), 'chip')


# -- office chair ------------------------------------------------------------------------------

def build_chair_office(b):
    # five-star base on twin-wheel casters
    hub_z = 0.115
    for k in range(5):
        a = 90 + k * 72
        i0 = b.mark()
        L = 0.3
        g = box(L, 0.05, 0.045, (0.035 + L / 2, 0, 0), bev=b.n(0.012, 0.01), segs=b.n(4, 1))

        def arm(v):
            t = np.clip((v[:, 0] - 0.035) / L, 0, 1)
            v[:, 1] *= 1 - 0.32 * t
            v[:, 2] = v[:, 2] * (1 - 0.35 * t) - 0.03 * t
            return v
        b.add(g.warp(arm), 'alu', 0.7)
        cy(b, 0.011, 0.02, (0.32, 0, -0.035), 'chrome', hs=20, ls=6)
        # caster: housing and twin wheels, turned a little at random
        j0 = b.mark()
        bx(b, 0.04, 0.05, 0.028, (0.0, 0.006, 0.0), 'plastic_black', r=0.01, w=0.3, chamfer=True)
        for sx in (-1, 1):
            cy(b, 0.026, 0.016, (sx * 0.013, 0.018, -0.022), 'plastic_black', 'X', 32, 10, bev=0.003, w=0.3)
            hp(b, lambda sx=sx: cyl(0.02, 0.017, 24, (sx * 0.013, 0.018, -0.022), 'X'), 'rubber')
        turn = b.rng.uniform(0, 360)
        b.xform(j0, lambda g, turn=turn: g.rot('Z', turn).move(0.32, 0, -0.06))
        b.xform(i0, lambda g, a=a: g.rot('Z', a).move(0, 0, hub_z))
    cy(b, 0.042, 0.07, (0, 0, hub_z), 'alu', hs=48, ls=16, bev=0.006)
    # gas lift with its telescopic cover
    cy(b, 0.026, 0.16, (0, 0, hub_z + 0.11), 'plastic_black', hs=40, ls=14, bev=0.003)
    cy(b, 0.0145, 0.12, (0, 0, hub_z + 0.23), 'chrome', hs=32, ls=10)
    if b.hi:
        for i in range(6):  # ridges of the cover
            b.add(torus(0.026, 0.0025, 40, 8, (0, 0, hub_z + 0.05 + i * 0.022)), 'plastic_black')
    # tilt mechanism and its levers
    seat_z = 0.47
    bx(b, 0.22, 0.24, 0.05, (0, 0.02, seat_z - 0.11), 'plastic_black', r=0.008, w=0.5)
    bx(b, 0.2, 0.22, 0.02, (0, 0.02, seat_z - 0.08), 'steel_black', r=0.004, w=0.3)
    cable(b, [(0.1, -0.02, seat_z - 0.1), (0.2, -0.04, seat_z - 0.105), (0.25, -0.09, seat_z - 0.1)], 0.005, 'steel_black',
          hs=12, ls=6, hn=20, ln=5, w=0.3)
    bx(b, 0.04, 0.06, 0.012, (0.26, -0.11, seat_z - 0.1), 'plastic_black', r=0.005, w=0.2)
    # seat: shell and a cushion with a waterfall front edge and piping
    bx(b, 0.47, 0.46, 0.02, (0, 0.0, seat_z - 0.06), 'plastic_black', r=0.008, w=0.5)
    g = _subdivided_box(0.5, 0.49, 0.085, (0, 0.0, seat_z - 0.005), b.n(0.035, 0.03), b.n(5, 2), b.n(24, 6), b.n(24, 6))

    def seat(v):
        y = (v[:, 1] + 0.245) / 0.49  # 0 front .. 1 back
        x = v[:, 0] / 0.25
        top = v[:, 2] > seat_z - 0.01
        v[:, 2] -= np.where(y < 0.2, (0.2 - y) ** 2 * 1.1, 0.0)           # waterfall
        v[:, 2] -= np.where(top, 0.012 * (1 - x ** 2) * np.sin(np.pi * np.clip(y, 0, 1)), 0.0)  # sitting dish
        v[:, 2] += np.where(top, 0.01 * x ** 4, 0.0)                         # side bolsters
        return v
    b.add(g.warp(seat), 'fabric_chair', 1.3)
    # backrest: a curved plastic frame carrying a mesh panel, joined to the mechanism by a spine
    back_z0, back_h = seat_z + 0.1, 0.6
    i0 = b.mark()
    fr = _subdivided_box(0.48, 0.03, back_h, (0, 0, back_h / 2), 0.03 if b.hi else 0.02, b.n(4, 1), b.n(20, 8))
    bend_x(fr, 0.55)
    b.add(fr, 'plastic_black', 0.8)
    if b.hi:
        # the back shell's moulded ribs, a rim and a lumbar knob
        for k in range(-3, 4):
            rib = box(0.014, 0.008, back_h - 0.12, (k * 0.06, 0.016, back_h / 2 + 0.01), bev=0.003, segs=2)
            b.add(bend_x(rib, 0.55), 'plastic_black')
        rim = _subdivided_box(0.46, 0.006, 0.02, (0, 0.017, back_h - 0.03), 0.003, 2, 20)
        b.add(bend_x(rim, 0.55), 'plastic_dark')
        b.add(cyl(0.02, 0.008, 32, (0, 0.019, 0.12), 'Y', bev=0.002), 'plastic_dark')
    mesh_panel = _subdivided_box(0.43, 0.012, back_h - 0.05, (0, -0.018, back_h / 2), 0.006 if b.hi else 0.0,
                                 b.n(2, 0), b.n(20, 8))
    bend_x(mesh_panel, 0.55)
    b.add(mesh_panel, 'mesh_chair', 1.3)
    # lumbar pad
    lp_ = _subdivided_box(0.3, 0.02, 0.08, (0, -0.032, 0.17), 0.008 if b.hi else 0.0, b.n(3, 0), b.n(14, 6))
    bend_x(lp_, 0.52)
    b.add(lp_, 'plastic_dark', 0.5)

    def lean(g):
        g.rot('X', -12).move(0, 0.27, back_z0)
        # lumbar S-curve: push the lower back forward a touch
        return g
    b.xform(i0, lean)
    spine = [(0, 0.1, seat_z - 0.1), (0, 0.24, seat_z - 0.09), (0, 0.31, seat_z + 0.0), (0, 0.3, back_z0 + 0.12)]
    b.add(sweep(smooth_path(spine, b.n(30, 8)), _rounded_section(0.06, 0.018, b.n(3, 1))), 'plastic_black', 0.5)
    # armrests: posts from brackets under the seat to soft pads
    for sx in (-1, 1):
        bx(b, 0.09, 0.05, 0.016, (sx * 0.2, 0.03, seat_z - 0.085), 'steel_black', r=0.004, w=0.2)
        post = [(sx * 0.25, 0.03, seat_z - 0.085), (sx * 0.275, 0.035, seat_z - 0.05), (sx * 0.28, 0.05, seat_z + 0.1),
                (sx * 0.28, 0.06, seat_z + 0.2)]
        b.add(sweep(smooth_path(post, b.n(24, 6)), _rounded_section(0.05, 0.025, b.n(3, 1))), 'plastic_black', 0.4)
        bx(b, 0.035, 0.06, 0.07, (sx * 0.28, 0.06, seat_z + 0.16), 'plastic_dark', r=0.006, w=0.2)
        bx(b, 0.085, 0.26, 0.028, (sx * 0.28, 0.03, seat_z + 0.215), 'rubber', r=0.012, w=0.5, chamfer=True)


def _subdivided_box(sx, sy, sz, c, bev, segs, n, ny=1):
    """A rounded box cut n times along X and ny times along Y (so it can bend and warp)."""
    import bmesh
    from mathutils import Vector
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    if bev > 0 and segs > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bev, 0.49 * min(sx, sy, sz)), segments=segs,
                        affect='EDGES', profile=0.5, clamp_overlap=True)
    for axis, size, k in ((0, sx, n), (1, sy, ny)):
        for i in range(1, k):
            x = -size / 2 + size * i / k
            if abs(x) < size / 2 - bev - 1e-4:
                co = [0, 0, 0]
                co[axis] = x
                no = [0, 0, 0]
                no[axis] = 1
                bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), plane_co=co, plane_no=no)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    from .office_geo import _from_bm
    return _from_bm(bm)


# -- 42U rack ------------------------------------------------------------------------------------

RACK_W, RACK_D, RACK_H = 0.8, 1.0, 2.05
RAIL_Y = -RACK_D / 2 + 0.1
RU0 = 0.12            # z of the bottom of U1


def _uz(u):
    return RU0 + (u - 1) * U


def _ports(b, x0, z, n, pitch, gap_every=6, gap=0.006, y=None, hole=(0.0118, 0.0086), body=(0.0138, 0.0112)):
    """RJ45 jacks: a block and its dark opening. Returns the port centre xs."""
    xs = []
    x = x0
    for i in range(n):
        xs.append(x)
        if b.hi:
            b.add(box(body[0], 0.004, body[1], (x, y - 0.002, z)), 'plastic_black')
            b.add(box(hole[0], 0.0006, hole[1], (x, y - 0.0043, z - 0.0005)), 'chip')
            b.add(box(0.0034, 0.0004, 0.0018, (x, y - 0.0046, z - hole[1] / 2 + 0.0002)), 'gold')
        x += pitch + (gap if (i + 1) % gap_every == 0 else 0.0)
    return xs


def _ears(b, z0, h, y, mat='steel_black', handles=False):
    for sx in (-1, 1):
        bx(b, 0.021, 0.003, h, (sx * 0.2308, y + 0.0015, z0 + h / 2), mat, w=0.15)
        if handles:
            bx(b, 0.012, 0.025, h * 0.7, (sx * 0.226, y - 0.012, z0 + h / 2), 'steel_bare', r=0.003, w=0.15)


def rack_device(b, kind, u, nu, y, leds=True):
    """A 19-inch device on the front rails: its front face at y (toward -Y)."""
    z0 = _uz(u) + 0.0005
    h = nu * U - 0.001
    zc = z0 + h / 2
    depth = dict(patch=0.12, switch=0.32, server=0.72, storage=0.7, ups=0.62, blank=0.004, kvm=0.6, mgr=0.08,
                 fw=0.3).get(kind, 0.5)
    rb = b.rng
    if kind == 'blank':
        bx(b, 0.4826, 0.003, h, (0, y + 0.0015, zc), 'steel_black', w=0.9)
        if b.hi:
            for i in range(nu * 2):
                b.add(box(0.44, 0.0008, 0.003, (0, y - 0.0003, z0 + (i + 0.5) * h / (nu * 2))), 'steel_black')
        return
    body_mat = {'ups': 'plastic_black', 'kvm': 'steel_black'}.get(kind, 'steel_black')
    bx(b, 0.44, depth, h, (0, y + depth / 2 + 0.003, zc), body_mat, r=0.0015, w=0.12)
    if kind == 'patch':
        _ears(b, z0, h, y)
        bx(b, 0.44, 0.003, h, (0, y + 0.0015, zc), 'steel_black', w=2.6)
        xs = _ports(b, -0.195, zc - 0.003, 24, 0.0155, 6, 0.012, y)
        hp(b, lambda: box(0.4, 0.0005, 0.0045, (0, y - 0.0003, zc + 0.0155)), 'label_print')
        return xs
    if kind == 'mgr':
        # 1U horizontal manager: a plate and five D-rings
        bx(b, 0.4826, 0.003, h, (0, y + 0.0015, zc), 'steel_black', w=0.3)
        for i in range(5):
            x = -0.19 + i * 0.095
            ring = [(x - 0.022, y, zc + 0.012), (x - 0.022, y - 0.05, zc + 0.012), (x - 0.01, y - 0.07, zc + 0.016),
                    (x + 0.01, y - 0.07, zc + 0.016), (x + 0.022, y - 0.05, zc + 0.012), (x + 0.022, y, zc + 0.012)]
            b.add(sweep(smooth_path(ring, b.n(24, 6)), [(-0.006, -0.0015), (0.006, -0.0015), (0.006, 0.0015), (-0.006, 0.0015)]),
                  'plastic_black', 0.15)
        return
    if kind in ('switch', 'fw'):
        _ears(b, z0, h, y)
        bx(b, 0.44, 0.003, h, (0, y + 0.0015, zc), 'steel_black', w=2.6)
        n = 24 if kind == 'switch' else 8
        top = _ports(b, -0.165, zc + 0.0078, n, 0.0145, 6, 0.006, y)
        bot = _ports(b, -0.165, zc - 0.0078, n, 0.0145, 6, 0.006, y) if kind == 'switch' else []
        if b.hi:
            for i in range(4):  # SFP cages
                b.add(box(0.0145, 0.004, 0.009, (0.16 + i * 0.0165, y - 0.002, zc + 0.006)), 'steel_bare')
                b.add(box(0.012, 0.0006, 0.0065, (0.16 + i * 0.0165, y - 0.0043, zc + 0.006)), 'chip')
            b.add(box(0.03, 0.0004, 0.006, (-0.2, y - 0.0003, zc + 0.008)), 'label_print')
            b.add(box(0.012, 0.004, 0.009, (0.205, y - 0.002, zc - 0.009)), 'plastic_blue')
        if leds:
            for i, x in enumerate(top):
                led(b, x + 0.004, y, zc + 0.0155 if kind == 'switch' else zc + 0.0, rb.choice(['green', 'green', 'green', 'amber']), 0.0024, 0.0016)
            for i in range(4):
                led(b, -0.2 + i * 0.006, y, zc - 0.006, ['green', 'green', 'amber', 'green'][i], 0.0022, 0.0022)
        return top, bot
    if kind in ('server', 'storage'):
        _ears(b, z0, h, y, handles=True)
        bx(b, 0.44, 0.004, h, (0, y + 0.002, zc), 'steel_black', w=2.4)
        if nu == 1:
            cols, rows, bw, bh = 10, 1, 0.0306, 0.0142
        elif kind == 'storage':
            cols, rows, bw, bh = 6, 4, 0.0485, 0.0372
        else:
            cols, rows, bw, bh = 4, 3, 0.0742, 0.0262
            bw, bh = 0.0742, 0.0262
        bay_w = cols * (bw + 0.0018)
        x0 = -0.215 + bw / 2 + 0.002
        for r in range(rows):
            for c in range(cols):
                cx = x0 + c * (bw + 0.0018)
                cz = z0 + 0.0035 + bh / 2 + r * (bh + 0.0016)
                if b.hi:
                    b.add(box(bw, 0.003, bh, (cx, y - 0.0015, cz), bev=0.0006, segs=2), 'plastic_black')
                    b.add(box(bw * 0.85, 0.0012, bh * 0.25, (cx, y - 0.0032, cz - bh * 0.22)), 'steel_bare')
                    b.add(box(bw * 0.55, 0.0006, bh * 0.4, (cx + bw * 0.12, y - 0.0031, cz + bh * 0.18)), 'vent_black')
                if leds and rb.random() < 0.9:
                    led(b, cx - bw * 0.38, y - 0.003, cz + bh * 0.3, rb.choice(['green', 'green', 'blue', 'amber']) if kind == 'storage' else 'green',
                        0.002, 0.002)
        # control panel and vent beside the bays
        vx0 = x0 + bay_w - 0.002
        if b.hi:
            b.add(box(0.215 - vx0, 0.0008, h - 0.008, ((vx0 + 0.215) / 2, y - 0.0004, zc)), 'vent_black')
            b.add(cyl(0.004, 0.003, 20, (0.205, y - 0.0015, z0 + h - 0.009), 'Y'), 'steel_bare')
        if leds:
            led(b, 0.205, y - 0.003, z0 + h - 0.009, 'blue', 0.0035, 0.0035)
            led(b, 0.193, y, z0 + h - 0.009, 'green', 0.002, 0.002)
        return
    if kind == 'ups':
        bx(b, 0.4826, 0.01, h, (0, y + 0.005, zc), 'plastic_black', r=0.004, w=1.6, chamfer=True)
        if b.hi:
            for i in range(18):
                b.add(box(0.008, 0.002, h * 0.7, (-0.2 + i * 0.012, y - 0.0005, zc)), 'vent_black')
            for i in range(3):
                b.add(cyl(0.0035, 0.002, 16, (0.17 + i * 0.012, y - 0.001, zc - 0.022), 'Y'), 'plastic_grey')
        led(b, 0.1, y, zc + 0.005, 'lcd', 0.05, 0.022)
        led(b, 0.16, y, zc + 0.02, 'green', 0.003, 0.003)
        return
    if kind == 'kvm':
        _ears(b, z0, h, y)
        bx(b, 0.44, 0.006, h, (0, y + 0.003, zc), 'steel_black', w=1.6)
        bx(b, 0.2, 0.018, 0.012, (0, y - 0.009, zc), 'steel_bare', r=0.004, w=0.2)
        led(b, 0.19, y, zc, 'green', 0.002, 0.002)


def build_rack_42u(b):
    W, D, H = RACK_W, RACK_D, RACK_H
    t = 0.02
    side_h = H - 0.1 - 0.04
    for sx in (-1, 1):
        bx(b, t, D, side_h, (sx * (W / 2 - t / 2), 0, 0.1 + side_h / 2), 'steel_black', r=0.004, w=0.35, chamfer=True)
        if b.hi:
            b.add(box(0.003, 0.03, 0.12, (sx * (W / 2 + 0.0005), 0.1, 1.05), bev=0.001, segs=2), 'plastic_black')
    bx(b, W, D, 0.04, (0, 0, H - 0.02), 'steel_black', r=0.005, w=0.35, chamfer=True)
    if b.hi:
        b.add(box(0.5, 0.4, 0.002, (0, 0.2, H + 0.0005)), 'perf_black')
        b.add(box(0.3, 0.08, 0.003, (0, -0.25, H + 0.001), bev=0.001, segs=2), 'rubber')
    # plinth and levelling feet
    bx(b, W - 0.03, D - 0.03, 0.08, (0, 0, 0.06), 'steel_black', r=0.004, w=0.3)
    for fx in (-1, 1):
        for fy in (-1, 1):
            cy(b, 0.025, 0.02, (fx * (W / 2 - 0.06), fy * (D / 2 - 0.06), 0.01), 'steel_bare', hs=24, ls=10, w=0.1)
    # back wall of the cabinet: the closed perforated rear door
    bx(b, W - 0.01, 0.02, side_h, (0, D / 2 - 0.012, 0.1 + side_h / 2), 'perf_black', r=0.003, w=0.15)
    # inside: a dark floor/roof, the rails, vertical cable managers
    bx(b, W - 0.04, D - 0.06, 0.01, (0, 0, 0.105), 'steel_black', w=0.2)
    rail_h = 42 * U + 0.02
    for sx in (-1, 1):
        for ry in (RAIL_Y + 0.008, D / 2 - 0.12):
            bx(b, 0.017, 0.016, rail_h, (sx * 0.2415, ry, RU0 - 0.01 + rail_h / 2), 'rail', w=0.35 if ry < 0 else 0.1)
        # vertical finger duct between the rails and the side panel
        mx = sx * 0.33
        bx(b, 0.11, 0.003, rail_h, (mx, RAIL_Y + 0.12, RU0 - 0.01 + rail_h / 2), 'steel_black', w=0.15)
        bx(b, 0.003, 0.12, rail_h, (sx * 0.385, RAIL_Y + 0.06, RU0 - 0.01 + rail_h / 2), 'steel_black', w=0.15)
        for k in range(22):
            z = RU0 + k * 2 * U + U
            bx(b, 0.006, 0.1, 0.012, (sx * 0.276, RAIL_Y + 0.05, z), 'plastic_black', w=0.06)
            bx(b, 0.006, 0.1, 0.012, (sx * 0.384 - sx * 0.003, RAIL_Y + 0.05, z), 'plastic_black', w=0.06)
    # equipment, bottom to top
    y = RAIL_Y - 0.0
    layout = [('ups', 1, 2), ('ups', 3, 2), ('blank', 5, 1), ('server', 6, 2), ('server', 8, 2), ('blank', 10, 1),
              ('storage', 11, 4), ('blank', 15, 2), ('kvm', 17, 1), ('blank', 18, 1), ('server', 19, 1), ('server', 20, 1),
              ('server', 21, 1), ('server', 22, 1), ('server', 23, 2), ('blank', 25, 1), ('fw', 26, 1), ('blank', 27, 2),
              ('server', 32, 2), ('switch', 34, 1), ('mgr', 35, 1), ('patch', 36, 1), ('switch', 37, 1), ('mgr', 38, 1),
              ('patch', 39, 1), ('blank', 40, 1), ('patch', 41, 1), ('blank', 42, 1)]
    got = {}
    for kind, u, nu in layout:
        got[u] = rack_device(b, kind, u, nu, y)
    # patch leads: panel above -> switch below, in front of the manager, colour coded
    colours = ['cable_blue'] * 8 + ['cable_yellow'] * 4 + ['cable_grey'] * 6 + ['cable_red'] * 2 + ['cable_green'] * 2
    rng = random.Random(11)
    for pu, su in ((36, 34), (39, 37)):
        pxs = got[pu]
        top, bot = got[su]
        sports = top + bot
        zp = _uz(pu) + U / 2 - 0.003
        for i, px in enumerate(pxs):
            if i in (5, 17, 22) or rng.random() < 0.08:
                continue
            j = min(len(sports) - 1, i if i < 24 else i)
            sx_ = sports[j] if j < len(top) else sports[j]
            zs = _uz(su) + U / 2 + (0.0078 if j < len(top) else -0.0078)
            col = colours[i % len(colours)]
            sag = 0.05 + rng.uniform(0, 0.03)
            side = (px + sx_) / 2 + rng.uniform(-0.01, 0.01)
            ctrl = [(px, y - 0.03, zp), (px, y - 0.045, zp - 0.006), ((px * 0.7 + side * 0.3), y - 0.06 - sag * 0.6, zp - 0.03),
                    (side, y - 0.06 - sag, (zp + zs) / 2), ((sx_ * 0.7 + side * 0.3), y - 0.06 - sag * 0.6, zs + 0.03),
                    (sx_, y - 0.045, zs + 0.006), (sx_, y - 0.03, zs)]
            cable(b, ctrl, 0.003, col, hs=10, ls=6, hn=36, ln=12, w=0.25)
            for (bxp, bz) in ((px, zp), (sx_, zs)):
                if b.hi:
                    b.add(box(0.0115, 0.022, 0.0095, (bxp, y - 0.016, bz), bev=0.0015, segs=2), col.replace('cable_', 'plastic_')
                          if col.replace('cable_', 'plastic_') in ('plastic_blue', 'plastic_red', 'plastic_green', 'plastic_yellow') else 'plastic_grey')
                    b.add(box(0.0118, 0.006, 0.0086, (bxp, y - 0.003, bz - 0.0005)), 'plastic_clear')
                else:
                    b.add(box(0.0115, 0.026, 0.0095, (bxp, y - 0.014, bz)), col, 0.15)
    # uplinks from the switches' right ends into the right-hand duct, and two bundles running up it
    for su in (34, 37):
        top, bot = got[su]
        for k, x in enumerate(top[-4:]):
            zs = _uz(su) + U / 2 + 0.0078
            ctrl = [(x, y - 0.03, zs), (x + 0.02, y - 0.06, zs - 0.005), (0.24, y - 0.05, zs + 0.01 + k * 0.004),
                    (0.3, y + 0.02, zs + 0.03 + k * 0.006), (0.31 + k * 0.006, y + 0.06, zs + 0.15)]
            cable(b, ctrl, 0.003, 'cable_blue' if k % 2 else 'cable_grey', hs=10, ls=5, hn=30, ln=7, w=0.2)
    for sx, col in ((1, 'cable_blue'), (-1, 'cable_grey'), (1, 'cable_yellow')):
        x = sx * (0.33 if col != 'cable_yellow' else 0.35)
        pts = [(x, RAIL_Y + 0.06, RU0 + 0.3), (x + sx * 0.005, RAIL_Y + 0.065, 1.0), (x, RAIL_Y + 0.06, 1.7),
               (x, RAIL_Y + 0.07, RU0 + 42 * U - 0.02), (x * 0.7, RAIL_Y + 0.2, H - 0.06)]
        if b.hi:
            # a real bundle: many cables twisting slowly round each other
            for k in range(10):
                a = 2 * math.pi * k / 10
                rr = 0.011 if k % 2 else 0.006
                off = [(p[0] + rr * math.cos(a + i * 0.4), p[1] + rr * math.sin(a + i * 0.4), p[2]) for i, p in enumerate(pts)]
                cable(b, off, 0.003, col, hs=8, hn=70)
        else:
            cable(b, pts, 0.016, col, ls=8, ln=14, w=0.4)
        for z in (0.5, 0.9, 1.3, 1.7):
            if b.hi:
                b.add(torus(0.0175, 0.0014, 32, 6, (x, RAIL_Y + 0.062, z)), 'velcro')
    # double front doors, perforated, swung open
    dh = side_h - 0.01
    for sx in (-1, 1):
        i0 = b.mark()
        dw = W / 2 - 0.004
        # local: hinge at origin, door runs along -sx*X... modelled on +X then mirrored
        frame = 0.035
        if b.hi:
            for (bw, bh, cx, cz) in ((dw, frame, dw / 2, frame / 2), (dw, frame, dw / 2, dh - frame / 2),
                                     (frame, dh, frame / 2, dh / 2), (frame, dh, dw - frame / 2, dh / 2)):
                b.add(box(bw, 0.022, bh, (cx, -0.011, cz), bev=0.0025, segs=3), 'steel_black')
            b.add(box(dw - 2 * frame + 0.004, 0.0015, dh - 2 * frame + 0.004, (dw / 2, -0.012, dh / 2)), 'perf_black')
            b.add(box(dw - 2 * frame + 0.004, 0.0015, dh - 2 * frame + 0.004, (dw / 2, -0.0105, dh / 2)), 'perf_black')
            for hz in (0.15, dh - 0.15):
                b.add(cyl(0.008, 0.06, 24, (0.0, -0.004, hz)), 'steel_bare')
        else:
            b.add(box(dw, 0.022, dh, (dw / 2, -0.011, dh / 2), bev=0.004, segs=1), 'perf_black', 1.0)
            # the inner face has the same perforation: the lean door is a solid slab baked both sides
        if sx == 1:  # the handle is on the right-hand door's free edge
            bx(b, 0.02, 0.03, 0.18, (dw - 0.03, -0.035, dh / 2), 'plastic_black', r=0.006, w=0.2, chamfer=True)
            cy(b, 0.008, 0.012, (dw - 0.03, -0.05, dh / 2 + 0.06), 'chrome', 'Y', 20, 8)

        def place2(g, sx=sx):
            # each door is modelled from its hinge along +X; the right-hand one is mirrored so it
            # runs toward -X, then both swing out about their hinges at the cabinet's front corners
            if sx == 1:
                g.scale(-1, 1, 1)
            g.rot('Z', sx * 105)
            g.move(sx * (W / 2 - 0.002), -D / 2, 0.105)
            return g
        b.xform(i0, place2)


# -- cable tray ----------------------------------------------------------------------------------

def build_cable_tray(b):
    L, Wt, Ht = 2.0, 0.3, 0.06
    r = 0.0025
    # longitudinal wires: along the floor and up the sides, the top edge thicker
    ys = [-Wt / 2 + i * Wt / 6 for i in range(7)]
    for y in ys:
        cy(b, r, L, (0, y, r), 'zinc', 'X', 10, 4, w=0.08)
    for sy in (-1, 1):
        for z in (Ht * 0.5,):
            cy(b, r, L, (0, sy * Wt / 2, z), 'zinc', 'X', 10, 4, w=0.08)
        cy(b, 0.0032, L, (0, sy * Wt / 2, Ht), 'zinc', 'X', 12, 5, w=0.08)
    # transverse U wires every 50 mm, the ends T-welded over the top wire
    nU = int(L / 0.05)
    for i in range(nU + 1):
        x = -L / 2 + i * 0.05
        pts = [(x, -Wt / 2, Ht + 0.003), (x, -Wt / 2, 0.012), (x, -Wt / 2 + 0.012, 0.0), (x, Wt / 2 - 0.012, 0.0),
               (x, Wt / 2, 0.012), (x, Wt / 2, Ht + 0.003)]
        b.add(tube(smooth_path(pts, b.n(24, 8)) if b.hi else pts, r, b.n(10, 4)), 'zinc', 0.08)
    # two trapeze supports: strut channel under the tray with rod stubs
    for sx in (-0.65, 0.65):
        bx(b, 0.041, 0.42, 0.021, (sx, 0, -0.0105 - 0.0), 'zinc', r=0.002, w=0.2)
        for sy in (-1, 1):
            cy(b, 0.005, 0.12, (sx, sy * 0.19, 0.04), 'zinc', hs=16, ls=6, w=0.05)
            cy(b, 0.009, 0.008, (sx, sy * 0.19, 0.004), 'steel_bare', hs=6, ls=6, w=0.05)
    # cable bundles lying in the tray, strapped with velcro ties
    bundles = [(-0.07, 0.022, 'cable_blue', 14), (0.05, 0.016, 'cable_yellow', 8), (0.11, 0.013, 'cable_grey', 5)]
    for bi, (by, br, col, n) in enumerate(bundles):
        ctrl = [(-L / 2 - 0.0, by, br + 0.004), (-L / 4, by + 0.012 * math.sin(bi + 1), br + 0.004),
                (0.0, by - 0.01, br + 0.004), (L / 4, by + 0.01, br + 0.004), (L / 2, by - 0.005, br + 0.004)]
        if b.hi:
            pts = smooth_path(ctrl, 120)
            from .office_geo import _frames
            fr = _frames(pts)
            k = 0
            rings = [(0, 1)] + [(br * 0.45, 6)] + [(br * 0.82, max(1, n - 7))]
            for rr, m in rings:
                for j in range(m):
                    a0 = 2 * math.pi * j / m
                    path = []
                    for i, (p, tt, nn, bb) in enumerate(fr):
                        a = a0 + i * 0.05
                        path.append(tuple(p + (nn * math.cos(a) + bb * math.sin(a)) * rr))
                    b.add(tube(path, 0.0031 if col != 'cable_grey' else 0.0045, 10, caps=True), col)
                    k += 1
        else:
            cable(b, ctrl, br, col, ls=9, ln=16, w=0.35)
        for tx in (-0.8, -0.4, 0.0, 0.4, 0.8):
            if b.hi:
                b.add(torus(br + 0.002, 0.0012, 40, 6, (tx, by + 0.012 * math.sin(bi + 1) * (1 - abs(tx)) * 0.0, br + 0.004),
                            axis='X').scale(1, 1, 1, o=(tx, 0, 0)), 'velcro')
            else:
                b.add(sweep(_ring_path(tx, by, br + 0.004, br + 0.0025, 8), [(-0.006, -0.0012), (0.006, -0.0012), (0.006, 0.0012), (-0.006, 0.0012)],
                            caps=False), 'velcro', 0.1)


def _ring_path(x, y, z, r, n):
    return [(x, y + r * math.cos(2 * math.pi * i / n), z + r * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]


# -- IT workbench ---------------------------------------------------------------------------------

def hdd(b, x, y, z, ang=0.0, ssd=False):
    i0 = b.mark()
    if ssd:
        w, d, h = 0.0698, 0.1, 0.007
        bx(b, w, d, h, (0, 0, h / 2), 'alu_dark', r=0.0015, w=0.6)
        hp(b, lambda: box(w * 0.8, d * 0.6, 0.0003, (0, 0.005, h + 0.0001)), 'label_print')
        hp(b, lambda: box(0.03, 0.003, 0.004, (0.01, d / 2 + 0.0005, h / 2)), 'chip')
    else:
        w, d, h = 0.1016, 0.147, 0.0261
        bx(b, w, d, h * 0.72, (0, 0, h * 0.28 + h * 0.36), 'alu', r=0.002, w=0.7)
        bx(b, w - 0.004, d - 0.01, h * 0.28, (0, 0.003, h * 0.14), 'pcb', w=0.4)
        if b.hi:
            b.add(box(w * 0.86, d * 0.7, 0.0003, (0, -0.01, h + 0.0001)), 'label_print')
            for i in range(6):
                b.add(cyl(0.0022, 0.0006, 12, (-w / 2 + 0.012 + (i % 2) * (w - 0.024), -d / 2 + 0.02 + (i // 2) * 0.05, h + 0.0002)), 'steel_bare')
            for i in range(5):
                b.add(box(0.012, 0.006, 0.006, (-0.03 + i * 0.015, 0.03, 0.002)), 'chip')
            b.add(box(0.05, 0.004, 0.006, (-0.015, d / 2 + 0.001, 0.005)), 'plastic_black')
    b.xform(i0, lambda g: g.rot('Z', ang).move(x, y, z))


def multimeter(b, x, y, z, ang=0.0):
    i0 = b.mark()
    W, D, H = 0.095, 0.185, 0.048
    # rubber holster and the meter in it
    g = box(W, D, H, (0, 0, H / 2), bev=b.n(0.014, 0.012), segs=b.n(4, 2))
    b.add(g, 'plastic_yellow', 1.2)
    bx(b, W - 0.016, D - 0.024, 0.006, (0, 0, H + 0.0), 'plastic_dark', r=0.006, w=1.2, chamfer=True)
    if b.hi:
        b.add(box(0.064, 0.042, 0.002, (0, 0.05, H + 0.003), bev=0.001, segs=2), 'glass_dark')
        b.add(box(0.058, 0.036, 0.0012, (0, 0.05, H + 0.0035)), 'lcd')
        for i, xx in enumerate((-0.02, 0.0, 0.02)):
            for j in range(2):
                b.add(box(0.015, 0.008, 0.003, (xx, 0.015 - j * 0.011, H + 0.003), bev=0.001, segs=2), 'plastic_grey')
        for i, (xx, col) in enumerate(((-0.03, 'plastic_black'), (-0.01, 'plastic_red'), (0.01, 'plastic_black'), (0.03, 'plastic_red'))):
            b.add(cyl(0.0055, 0.003, 20, (xx, -0.078, H + 0.002)), col)
            b.add(cyl(0.002, 0.004, 12, (xx, -0.078, H + 0.003)), 'chip')
        b.add(box(0.05, 0.03, 0.0003, (0, 0.05, H + 0.0045)).scale(1, 1, 1), 'lcd')
    # rotary selector
    cy(b, 0.024, 0.006, (0, -0.032, H + 0.006), 'plastic_dark', hs=48, ls=14, bev=0.002, w=0.6)
    bx(b, 0.008, 0.04, 0.008, (0, -0.032, H + 0.012), 'plastic_black', r=0.003, w=0.3, chamfer=True)
    if b.hi:
        b.add(box(0.0016, 0.012, 0.0004, (0, -0.02, H + 0.0162)), 'plastic_white')
    b.xform(i0, lambda g: g.rot('Z', ang).move(x, y, z))
    # probes and their leads, lying on the mat (the leads only bake)
    for k, (col, plast) in enumerate((('cable_red', 'plastic_red'), ('cable_black', 'plastic_black'))):
        j0 = b.mark()
        px, py = (0.13 + k * 0.03, -0.06 - k * 0.02)
        cy(b, 0.0045, 0.11, (0, 0, 0.0045), plast, 'X', 20, 6, w=0.3)
        cy(b, 0.006, 0.008, (0.045, 0, 0.0045), plast, 'X', 20, 6, w=0.1)
        cy(b, 0.0011, 0.03, (-0.07, 0, 0.0045), 'steel_bare', 'X', 10, 4, w=0.05)
        b.xform(j0, lambda g, px=px, py=py, k=k: g.rot('Z', 20 + k * 25).move(x + px, y + py, z))
        if b.hi:
            jx = x + (-0.01 if k == 0 else 0.03) * math.cos(math.radians(ang))
            cable(b, [(x - 0.01 + k * 0.04, y - 0.09, z + 0.05), (x + k * 0.03, y - 0.12, z + 0.012), (x + 0.05, y - 0.16 - k * 0.02, z + 0.0019),
                      (x + 0.2, y - 0.13 + k * 0.02, z + 0.0019), (x + 0.23 + k * 0.03, y - 0.04 + k * 0.01, z + 0.0019),
                      (x + px + 0.05 * math.cos(math.radians(20 + k * 25)), y + py + 0.05 * math.sin(math.radians(20 + k * 25)), z + 0.0045)],
                  0.0019, col, hs=10, hn=60)


def laptop_chassis(b, x, y, z, ang=0.0):
    """A laptop lying lid-down with its bottom cover off: mainboard, fan, heat pipe, battery, RAM."""
    i0 = b.mark()
    W, D = 0.34, 0.235
    bx(b, W, D, 0.008, (0, 0, 0.004), 'alu_dark', r=0.004, w=0.6, chamfer=True)       # the closed lid underneath
    t = 0.0018
    hb = 0.016
    for (sx, sy, cx, cy_) in ((W, t, 0, -D / 2 + t / 2), (W, t, 0, D / 2 - t / 2), (t, D, -W / 2 + t / 2, 0), (t, D, W / 2 - t / 2, 0)):
        bx(b, sx, sy, hb, (cx, cy_, 0.008 + hb / 2), 'alu_dark', w=0.4)
    bx(b, W - 2 * t, D - 2 * t, 0.0012, (0, 0, 0.0095), 'alu_dark', w=0.9)
    # mainboard along the hinge side, battery in front
    bx(b, 0.2, 0.11, 0.0016, (0.055, 0.05, 0.0115), 'pcb_black', w=1.4)
    bx(b, 0.29, 0.075, 0.009, (0.0, -0.065, 0.0145), 'plastic_dark', r=0.002, w=0.8)
    if b.hi:
        b.add(box(0.12, 0.05, 0.0003, (-0.05, -0.065, 0.0191)), 'label_print')
        for (cx, cyy, sx, sy) in ((0.08, 0.06, 0.035, 0.035), (0.0, 0.04, 0.018, 0.018), (0.12, 0.03, 0.012, 0.02),
                                  (0.03, 0.08, 0.02, 0.012), (0.14, 0.08, 0.015, 0.015)):
            b.add(box(sx, sy, 0.002, (cx, cyy, 0.0133)), 'chip')
        for i in range(18):
            b.add(box(0.0025, 0.0015, 0.0012, (0.01 + (i % 6) * 0.012, 0.0 + (i // 6) * 0.007, 0.0128)), 'steel_bare')
        for i in range(10):
            b.add(cyl(0.0012, 0.0012, 8, (-W / 2 + 0.012 + i * 0.035, D / 2 - 0.01, 0.0105)), 'steel_bare')
    # fan and heat pipe over the CPU
    cy(b, 0.032, 0.007, (-0.09, 0.055, 0.0135), 'plastic_black', hs=48, ls=14, w=0.6)
    if b.hi:
        for k in range(23):
            a = k * 360 / 23
            b.add(box(0.022, 0.0008, 0.005, (0.016, 0, 0)).rot('X', 25).rot('Z', a).move(-0.09, 0.055, 0.0175), 'plastic_dark')
        b.add(cyl(0.008, 0.002, 24, (-0.09, 0.055, 0.0175)), 'label')
    b.add(sweep(smooth_path([(-0.06, 0.07, 0.0145), (0.0, 0.07, 0.0145), (0.06, 0.06, 0.0145), (0.08, 0.06, 0.0145)], b.n(20, 5)),
                [(-0.004, -0.0012), (0.004, -0.0012), (0.004, 0.0012), (-0.004, 0.0012)]), 'copper', 0.4)
    bx(b, 0.045, 0.04, 0.003, (0.08, 0.06, 0.0145), 'copper', w=0.3)
    # two SO-DIMMs and an M.2 SSD
    for k in range(2):
        bx(b, 0.0675, 0.03, 0.0012, (0.14, 0.02 - k * 0.004, 0.0135 + k * 0.004), 'pcb', w=0.6)
        if b.hi:
            for i in range(4):
                b.add(box(0.01, 0.008, 0.0012, (0.115 + i * 0.016, 0.02 - k * 0.004, 0.0147 + k * 0.004)), 'chip')
            b.add(box(0.0675, 0.003, 0.0004, (0.14, 0.0065 - k * 0.004, 0.0143 + k * 0.004)), 'gold')
    bx(b, 0.08, 0.022, 0.0025, (0.0, 0.098, 0.0135), 'pcb_black', w=0.5)
    if b.hi:
        b.add(box(0.05, 0.016, 0.0004, (0.0, 0.098, 0.0152)), 'label_print')
        # speaker modules and a ribbon cable
        for sx in (-1, 1):
            b.add(box(0.04, 0.02, 0.006, (sx * 0.13, -0.095, 0.013), bev=0.001, segs=2), 'plastic_black')
        b.add(box(0.012, 0.05, 0.0004, (0.03, 0.0, 0.0124)).rot('Z', 30, o=(0.03, 0, 0)), 'plastic_orange')
    b.xform(i0, lambda g: g.rot('Z', ang).move(x, y, z))


def screwdriver_stand(b, x, y, z, ang=0.0):
    i0 = b.mark()
    bx(b, 0.18, 0.055, 0.035, (0, 0, 0.0175), 'plastic_dark', r=0.006, w=0.6, chamfer=True)
    cols = ['plastic_red', 'plastic_yellow', 'plastic_blue', 'plastic_red', 'plastic_green', 'plastic_orange']
    for i, col in enumerate(cols):
        sx = -0.075 + i * 0.03
        hh = 0.09 + (i % 3) * 0.012
        cy(b, 0.0025, 0.05, (sx, 0, 0.035 + 0.02), 'steel_bare', hs=12, ls=5, w=0.05)
        z0 = 0.035 + 0.045
        if b.hi:
            prof = [(0.0, z0), (0.006, z0), (0.0115, z0 + 0.012), (0.0125, z0 + hh * 0.5), (0.0115, z0 + hh - 0.006),
                    (0.008, z0 + hh), (0.0, z0 + hh)]
            g = lathe(prof, 36)

            def flutes(v, sx=sx):
                a = np.arctan2(v[:, 1], v[:, 0])
                rr = np.hypot(v[:, 0], v[:, 1])
                k = 1 - 0.08 * (0.5 + 0.5 * np.cos(a * 6)) * (rr > 0.009)
                v[:, 0] *= k
                v[:, 1] *= k
                return v
            b.add(g.warp(flutes).move(sx, 0, 0), col)
            b.add(cyl(0.0105, 0.012, 24, (sx, 0, z0 + 0.006)), 'rubber')
        else:
            b.add(lathe([(0.0, z0), (0.0115, z0 + 0.012), (0.0125, z0 + hh * 0.5), (0.011, z0 + hh - 0.005), (0.0, z0 + hh)], 8)
                  .move(sx, 0, 0), col, 0.25)
    b.xform(i0, lambda g: g.rot('Z', ang).move(x, y, z))


def label_printer(b, x, y, z, ang=0.0):
    i0 = b.mark()
    W, D, H = 0.115, 0.21, 0.065
    g = box(W, D, H, (0, 0, H / 2), bev=b.n(0.016, 0.014), segs=b.n(4, 2))

    def wedge(v):
        t = (v[:, 1] + D / 2) / D
        v[:, 2] *= 0.6 + 0.4 * t
        return v
    b.add(g.warp(wedge), 'plastic_white', 1.2)
    if b.hi:
        b.add(box(0.07, 0.03, 0.002, (0, 0.055, H * 0.86 + 0.002)).rot('X', -8, o=(0, 0.055, H * 0.86)), 'lcd')
        for r in range(5):
            for c in range(8):
                b.add(box(0.0095, 0.0085, 0.0025, (-0.042 + c * 0.012, -0.075 + r * 0.0115, H * (0.6 + 0.4 * (0.1 + r * 0.054)) + 0.0005),
                          bev=0.0008, segs=2), 'plastic_dark' if (r + c) % 7 else 'plastic_blue')
    # the label tape coming out of the side slot
    bx(b, 0.04, 0.012, 0.0004, (W / 2 + 0.018, 0.08, 0.035), 'label_print', w=0.2)
    b.xform(i0, lambda g: g.rot('Z', ang).move(x, y, z))


def parts_tray(b, x, y, z, ang=0.0):
    i0 = b.mark()
    W, D, H, t = 0.24, 0.16, 0.035, 0.002
    bx(b, W, D, t, (0, 0, t / 2), 'plastic_blue', w=0.6)
    for (sx, sy, cx, cyy) in ((W, t, 0, -D / 2), (W, t, 0, D / 2), (t, D, -W / 2, 0), (t, D, W / 2, 0)):
        bx(b, sx, sy, H, (cx, cyy, H / 2), 'plastic_blue', w=0.4)
    for i in range(1, 4):
        bx(b, t, D, H * 0.9, (-W / 2 + i * W / 4, 0, H * 0.45), 'plastic_blue', w=0.25)
    bx(b, W, t, H * 0.9, (0, 0, H * 0.45), 'plastic_blue', w=0.25)
    if b.hi:
        rng = random.Random(3)
        for cell in range(8):
            cx = -W / 2 + (cell % 4 + 0.5) * W / 4
            cyy = -D / 4 + (cell // 4) * D / 2
            kind = cell % 4
            for k in range(rng.randint(6, 14)):
                px, py = cx + rng.uniform(-0.022, 0.022), cyy + rng.uniform(-0.03, 0.03)
                a = rng.uniform(0, 360)
                if kind == 0:   # screws
                    b.add(join([cyl(0.0012, 0.008, 8, (0, 0, 0), 'X'), cyl(0.0024, 0.0012, 12, (0.0045, 0, 0), 'X')]).rot('Z', a).move(px, py, 0.0035), 'steel_bare')
                elif kind == 1:  # standoffs
                    b.add(cyl(0.0025, 0.006, 6, (0, 0, 0), 'X').rot('Z', a).move(px, py, 0.0045), 'brass')
                elif kind == 2:  # jumpers / caps
                    b.add(box(0.004, 0.0025, 0.005, (0, 0, 0)).rot('Z', a).move(px, py, 0.0045), 'plastic_black')
                else:           # rubber feet
                    b.add(cyl(0.004, 0.002, 12, (px, py, 0.003)), 'rubber')
    b.xform(i0, lambda g: g.rot('Z', ang).move(x, y, z))


def small_switch(b, x, y, z, n=8):
    i0 = b.mark()
    W, D, H = 0.16, 0.1, 0.028
    bx(b, W, D, H, (0, 0, H / 2), 'steel_black', r=0.003, w=0.6)
    xs = _ports(b, -0.06, H / 2, n, 0.0145, 4, 0.006, -D / 2)
    for i, px in enumerate(xs):
        led(b, px, -D / 2, H - 0.004, 'green' if i % 3 else 'amber', 0.002, 0.0015)
    led(b, 0.068, -D / 2, H / 2, 'blue', 0.003, 0.003)
    b.xform(i0, lambda g: g.move(x, y, z))
    return [(x + px, y - D / 2, z + H / 2) for px in xs]


def build_it_bench(b):
    W, D, H, T = 1.8, 0.75, 0.9, 0.03
    top = H - T / 2
    bx(b, W, D, T, (0, 0, top), 'laminate_grey', r=0.003, w=0.8, chamfer=True)
    # frame
    for sx in (-1, 1):
        for sy in (-1, 1):
            bx(b, 0.05, 0.05, H - T, (sx * (W / 2 - 0.05), sy * (D / 2 - 0.05), (H - T) / 2), 'steel_grey', r=0.005, w=0.4)
            cy(b, 0.02, 0.012, (sx * (W / 2 - 0.05), sy * (D / 2 - 0.05), 0.006), 'rubber', hs=24, ls=8, w=0.05)
        for z in (0.16, H - T - 0.03):
            bx(b, 0.04, D - 0.12, 0.04, (sx * (W / 2 - 0.05), 0, z), 'steel_grey', r=0.004, w=0.25)
    for sy in (-1, 1):
        bx(b, W - 0.14, 0.04, 0.05, (0, sy * (D / 2 - 0.05), H - T - 0.03), 'steel_grey', r=0.004, w=0.3)
        bx(b, W - 0.14, 0.04, 0.04, (0, sy * (D / 2 - 0.05), 0.16), 'steel_grey', r=0.004, w=0.2)
    bx(b, W - 0.12, D - 0.1, 0.02, (0, 0, 0.19), 'laminate_grey', r=0.002, w=0.6)
    # riser: uprights, a pegboard, a shelf, a power strip
    yb = D / 2 - 0.025
    for sx in (-1, 1):
        bx(b, 0.05, 0.05, 0.9, (sx * (W / 2 - 0.05), yb, H + 0.45), 'steel_grey', r=0.005, w=0.3)
    bx(b, W - 0.14, 0.004, 0.36, (0, yb + 0.01, H + 0.22), 'perf_grey', w=0.7)
    bx(b, W - 0.1, 0.3, 0.02, (0, yb - 0.13, H + 0.42), 'steel_grey', r=0.003, w=0.6)
    bx(b, W - 0.1, 0.004, 0.04, (0, yb - 0.28, H + 0.43), 'steel_grey', r=0.0015, w=0.2)
    bx(b, W - 0.14, 0.05, 0.05, (0, yb - 0.02, H + 0.025), 'plastic_dark', r=0.005, w=0.5, chamfer=True)
    if b.hi:
        for i in range(8):
            sx = -0.7 + i * 0.2
            b.add(box(0.034, 0.002, 0.034, (sx, yb - 0.046, H + 0.025), bev=0.003, segs=2), 'plastic_black')
            for k in (-1, 1):
                b.add(cyl(0.0022, 0.003, 10, (sx + k * 0.009, yb - 0.047, H + 0.025), 'Y'), 'chip')
        # tools hanging on the pegboard
        for i, (tx, mat) in enumerate(((-0.6, 'plastic_red'), (-0.5, 'plastic_blue'), (-0.42, 'plastic_yellow'), (0.55, 'plastic_red'))):
            b.add(cyl(0.002, 0.03, 8, (tx, yb - 0.005, H + 0.3), 'Y'), 'steel_bare')
            b.add(box(0.02, 0.012, 0.09, (tx, yb - 0.02, H + 0.24), bev=0.005, segs=2), mat)
            b.add(box(0.008, 0.005, 0.06, (tx, yb - 0.02, H + 0.16), bev=0.002, segs=2), 'steel_bare')
    led(b, 0.75, yb - 0.045, H + 0.025, 'red', 0.012, 0.008)
    # wall-mounted patch panel and a small switch behind the bench
    wy = D / 2 + 0.02
    py = wy - 0.12
    i0 = b.mark()
    bx(b, 0.52, 0.12, 0.004, (0, wy - 0.06, 0.0), 'steel_black', w=0.3)
    bx(b, 0.52, 0.12, 0.004, (0, wy - 0.06, 2 * U), 'steel_black', w=0.3)
    for sx in (-1, 1):
        bx(b, 0.004, 0.12, 2 * U, (sx * 0.258, wy - 0.06, U), 'steel_black', w=0.2)
    bx(b, 0.52, 0.004, 2 * U + 0.004, (0, wy - 0.002, U), 'steel_black', w=0.2)
    b.xform(i0, lambda g: g.move(0.35, 0, H + 0.62))
    i0 = b.mark()
    pxs = rack_device(b, 'patch', 1, 1, py, leds=False)
    b.xform(i0, lambda g: g.move(0.35, 0, H + 0.62 + U - RU0 - 0.0005 + 0.0))
    i0 = b.mark()
    rack_device(b, 'blank', 1, 1, py)
    b.xform(i0, lambda g: g.move(0.35, 0, H + 0.62 - RU0 + 0.0))
    # a few leads from the panel down behind the shelf to the bench switch
    sports = small_switch(b, 0.55, 0.12, H + 0.44)
    zp = H + 0.62 + U + U / 2 - 0.003
    for k, (i, col) in enumerate(((0, 'cable_blue'), (1, 'cable_blue'), (6, 'cable_yellow'), (12, 'cable_grey'), (13, 'cable_red'))):
        px = 0.35 + pxs[i]
        sp = sports[k]
        ctrl = [(px, py - 0.03, zp), (px, py - 0.06, zp - 0.02), (px + 0.02, py - 0.09, H + 0.55), (px * 0.5 + sp[0] * 0.5, sp[1] - 0.09, H + 0.5),
                (sp[0], sp[1] - 0.06, sp[2] + 0.005), (sp[0], sp[1] - 0.03, sp[2])]
        cable(b, ctrl, 0.003, col, hn=40, ln=9, w=0.2)
        for (bxp, byp, bz) in ((px, py, zp), (sp[0], sp[1], sp[2])):
            bx(b, 0.0115, 0.024, 0.0095, (bxp, byp - 0.015, bz), 'plastic_grey' if b.hi else col, r=0.0015, w=0.1)
    # one lead hanging down to the laptop on the mat
    # on the shelf: spare-parts boxes and a cable spool
    bx(b, 0.3, 0.2, 0.12, (-0.55, 0.22, H + 0.49), 'cardboard', r=0.003, w=0.6)
    bx(b, 0.22, 0.16, 0.09, (-0.56, 0.21, H + 0.475 + 0.12), 'cardboard', r=0.003, w=0.5)
    hp(b, lambda: box(0.12, 0.0004, 0.05, (-0.55, 0.1198, H + 0.49)), 'label_print')
    # a reel of patch cable: two flanges on a wound core, standing on edge
    for fy in (-0.034, 0.034):
        cy(b, 0.09, 0.008, (-0.15, 0.2 + fy, H + 0.43 + 0.09), 'plastic_dark', 'Y', 48, 16, bev=0.002, w=0.3)
    cy(b, 0.066, 0.06, (-0.15, 0.2, H + 0.43 + 0.09), 'cable_blue', 'Y', 48, 16, w=0.3)
    cy(b, 0.02, 0.08, (-0.15, 0.2, H + 0.43 + 0.09), 'plastic_dark', 'Y', 24, 10, w=0.05)
    if b.hi:
        for k in range(14):  # the turns of cable on the core
            b.add(torus(0.064, 0.0025, 64, 8, (-0.15, 0.2 - 0.028 + k * 0.0043, H + 0.43 + 0.09), axis='Y'), 'cable_blue')
    # on the mat: the open laptop, the meter, drives, tools, labeller, tray, bowl, a coffee
    mat_z = H + 0.002
    if b.hi:
        b.add(box(1.2, 0.6, 0.002, (-0.15, -0.06, H + 0.001), bev=0.0008, segs=2), 'esd_mat')
        b.add(cyl(0.006, 0.004, 20, (0.43, -0.34, H + 0.004)), 'steel_bare')
        cable(b, [(0.43, -0.34, H + 0.006), (0.5, -0.33, H + 0.01), (0.6, -0.36, H + 0.04), (0.75, -0.36, H + 0.003),
                  (0.86, -0.35, H - 0.02), (W / 2 - 0.03, -0.34, H - 0.05)], 0.0018, 'cable_green', hn=50)
        # a wrist strap and a pink anti-static bag
        b.add(torus(0.03, 0.006, 40, 10, (0.3, 0.15, H + 0.008)).scale(1, 1, 0.4, o=(0.3, 0.15, H + 0.008)), 'velcro')
        g = grid(0.17, 0.22, 10, 10, plane='XY', uv=False)
        g.warp(lambda v: (v.__setitem__((slice(None), 2), 0.003 * np.sin(v[:, 0] * 30) * np.cos(v[:, 1] * 20) + 0.002), v)[1])
        b.add(g.rot('Z', -18).move(-0.62, 0.12, H), 'plastic_clear')
        # loose screws
        rng = random.Random(5)
        for k in range(9):
            px, py2 = 0.1 + rng.uniform(-0.1, 0.1), -0.25 + rng.uniform(-0.05, 0.05)
            b.add(join([cyl(0.0011, 0.006, 8, (0, 0, 0), 'X'), cyl(0.0021, 0.001, 12, (0.0035, 0, 0), 'X')]).rot('Z', rng.uniform(0, 360))
                  .move(px, py2, mat_z + 0.0021), 'steel_bare')
        sticky(b, 0.6, -0.08, H, 'note_yellow', ang=-10, curl=0.002)
        sticky(b, 0.64, -0.12, H + 0.0004, 'note_yellow', ang=4, curl=0.003)
        # a RAM stick out of its slot
        b.add(box(0.0675, 0.03, 0.0012, (0.3, -0.2, mat_z + 0.0006)).rot('Z', 30, o=(0.3, -0.2, 0)), 'pcb')
    laptop_chassis(b, -0.2, -0.08, mat_z, ang=-4)
    multimeter(b, -0.6, -0.12, mat_z, ang=8)
    hdd(b, 0.15, 0.02, mat_z, ang=-12)
    hdd(b, 0.16, 0.025, mat_z + 0.0262, ang=-4)
    hdd(b, 0.32, -0.02, mat_z, ang=25, ssd=True)
    hdd(b, 0.36, 0.08, mat_z, ang=-35, ssd=True)
    screwdriver_stand(b, 0.2, 0.22, mat_z)
    label_printer(b, 0.55, 0.05, H, ang=-15)
    parts_tray(b, -0.25, 0.2, mat_z, ang=3)
    i0 = b.mark()
    b.add(lathe([(0.0, 0.0), (0.035, 0.0), (0.065, 0.02), (0.075, 0.03), (0.072, 0.031), (0.06, 0.022), (0.03, 0.006), (0.0, 0.006)],
                b.n(48, 16)), 'steel_bare', 0.5)
    if b.hi:
        rng = random.Random(9)
        for k in range(12):
            a, rr = rng.uniform(0, 6.28), rng.uniform(0, 0.03)
            b.add(join([cyl(0.0011, 0.006, 8, (0, 0, 0), 'X'), cyl(0.0021, 0.001, 12, (0.0035, 0, 0), 'X')]).rot('Z', rng.uniform(0, 360))
                  .move(rr * math.cos(a), rr * math.sin(a), 0.0085 + rr * 0.3), 'steel_bare')
    b.xform(i0, lambda g: g.move(0.05, -0.27, mat_z))
    mug(b, 0.75, 0.15, H, 'ceramic_red', ang=40)
    # a coiled patch lead
    i0 = b.mark()
    for k in range(4):
        b.add(torus(0.07 + k * 0.004, 0.0028, b.n(48, 14), b.n(8, 4), (0, 0, 0.003 + k * 0.0045)), 'cable_yellow', 0.15)
    b.xform(i0, lambda g: g.scale(1, 0.8, 1).move(0.7, -0.22, H))
    # under the bench: a PC tower
    bx(b, 0.2, 0.44, 0.42, (-0.55, -0.02, 0.2 + 0.21), 'steel_black', r=0.006, w=0.6, chamfer=True)
    if b.hi:
        b.add(box(0.19, 0.003, 0.41, (-0.55, -0.2415, 0.41), bev=0.002, segs=2), 'plastic_black')
        b.add(box(0.15, 0.001, 0.3, (-0.55, -0.243, 0.38)), 'vent_black')
        b.add(cyl(0.008, 0.002, 24, (-0.55, -0.2435, 0.58), 'Y'), 'steel_bare')
    led(b, -0.51, -0.2445, 0.58, 'blue', 0.004, 0.004)
    bx(b, 0.4, 0.3, 0.2, (0.4, 0.05, 0.2 + 0.1), 'cardboard', r=0.003, w=0.5)
    cable(b, [(0.3, 0.0, 0.405), (0.35, -0.05, 0.42), (0.42, -0.02, 0.41), (0.48, 0.05, 0.43), (0.5, 0.12, 0.45)], 0.004, 'cable_grey', w=0.2)


# -- desk lamp -----------------------------------------------------------------------------------

def build_desk_lamp(b):
    # weighted base
    b.add(lathe([(0.0, 0.0), (0.084, 0.0), (0.09, 0.006), (0.09, 0.018), (0.086, 0.024), (0.07, 0.028), (0.0, 0.03)], b.n(64, 20)),
          'steel_black', 1.2)
    hp(b, lambda: cyl(0.08, 0.002, 48, (0, 0, -0.0005)), 'felt_black')
    cy(b, 0.008, 0.012, (0.04, -0.03, 0.032), 'plastic_dark', hs=24, ls=8, bev=0.002, w=0.2)
    # yoke and pivot
    bx(b, 0.04, 0.03, 0.05, (0, 0.03, 0.05), 'steel_black', r=0.006, w=0.3)
    cy(b, 0.012, 0.05, (0, 0.03, 0.065), 'alu', 'X', 32, 12, w=0.2)
    p0 = (0, 0.03, 0.065)
    a1 = math.radians(74)
    L1 = 0.34
    p1 = (0, p0[1] + L1 * math.cos(a1) * 1.0, p0[2] + L1 * math.sin(a1))
    a2 = math.radians(-8)
    L2 = 0.32
    p2 = (0, p1[1] - L2 * math.cos(a2), p1[2] + L2 * math.sin(a2))
    for (pa, pb, rr) in ((p0, p1, 0.0045), (p1, p2, 0.004)):
        for sx in (-0.012, 0.012):
            b.add(tube([(pa[0] + sx, pa[1], pa[2]), (pb[0] + sx, pb[1], pb[2])], rr, b.n(16, 6)), 'alu', 0.3)
    # springs beside the lower arm
    for sx in (-0.022, 0.022):
        s0 = (sx, p0[1] - 0.02, p0[2] + 0.02)
        s1 = (sx, p0[1] + 0.12 * math.cos(a1) - 0.02, p0[2] + 0.12 * math.sin(a1) + 0.02)
        if b.hi:
            d = np.subtract(s1, s0)
            ln = np.linalg.norm(d)
            t = d / ln
            nrm = np.cross(t, (1, 0, 0))
            nrm /= np.linalg.norm(nrm)
            bn = np.cross(t, nrm)
            pts = [tuple(np.add(s0, t * ln * i / 400 + (nrm * math.cos(i * 0.5) + bn * math.sin(i * 0.5)) * 0.005)) for i in range(401)]
            b.add(tube(pts, 0.0009, 6), 'steel_bare')
        else:
            b.add(tube([s0, s1], 0.006, 6), 'steel_bare', 0.1)
        b.add(tube([s1, (sx, p1[1] - 0.05, p1[2] - 0.02)], 0.0012, b.n(8, 4)), 'steel_bare', 0.05)
    # elbow and head joints
    cy(b, 0.011, 0.04, p1, 'steel_black', 'X', 32, 12, bev=0.002, w=0.2)
    cy(b, 0.01, 0.04, p2, 'steel_black', 'X', 32, 12, bev=0.002, w=0.2)
    # the shade: a thin shell (outside black, inside white) pointing forward and down
    i0 = b.mark()
    s = b.n(64, 20)
    outer = [(0.0, 0.0), (0.022, 0.0), (0.03, 0.01), (0.034, 0.05), (0.06, 0.1), (0.074, 0.13), (0.076, 0.135)]
    inner = [(0.073, 0.134), (0.071, 0.129), (0.057, 0.1), (0.031, 0.052), (0.027, 0.014), (0.0, 0.012)]
    b.add(lathe(outer, s), 'steel_black', 1.0)
    b.add(lathe(inner, s), 'steel_white', 0.7)
    b.add(lathe([(0.0, 0.03), (0.018, 0.03), (0.024, 0.045), (0.02, 0.06), (0.0, 0.065)], b.n(32, 10)), 'bulb')
    cy(b, 0.016, 0.02, (0, 0, -0.005), 'steel_black', hs=32, ls=10, bev=0.002, w=0.2)

    def head(g):
        g.rot('X', 118).move(p2[0], p2[1] - 0.02, p2[2] - 0.01)
        return g
    b.xform(i0, head)
    cy(b, 0.007, 0.02, (0.03, p2[1] - 0.03, p2[2] + 0.02), 'plastic_dark', 'X', 20, 8, w=0.1)
    # the lead from the head down the arm and away off the back of the base
    cable(b, [(0, p2[1] - 0.01, p2[2] + 0.02), (0, p1[1] + 0.02, p1[2] + 0.02), (0, (p0[1] + p1[1]) / 2 + 0.03, (p0[2] + p1[2]) / 2),
              (0, p0[1] + 0.04, 0.06), (0, 0.11, 0.035), (0.02, 0.16, 0.004), (0.05, 0.2, 0.0025)], 0.0022, 'cable_black', hn=40, ln=12, w=0.2)


# -- ceiling LED panel ---------------------------------------------------------------------------

def build_ceiling_light_panel(b):
    S, F, T = 0.595, 0.012, 0.011
    # the lit diffuser faces down: UVs 0..1 across it
    a = S / 2 - F
    g = quad((-a, a, 0.0015), (a, a, 0.0015), (a, -a, 0.0015), (-a, -a, 0.0015))
    b.add(g, 'panel')
    for (sx, sy, cx, cy_) in ((S, F, 0, -S / 2 + F / 2), (S, F, 0, S / 2 - F / 2), (F, S - 2 * F, -S / 2 + F / 2, 0),
                              (F, S - 2 * F, S / 2 - F / 2, 0)):
        bx(b, sx, sy, T, (cx, cy_, T / 2), 'steel_white', r=0.0015, w=0.5)
    bx(b, S - 0.02, S - 0.02, 0.02, (0, 0, T + 0.01), 'steel_white', r=0.003, w=0.4)
    bx(b, 0.16, 0.05, 0.026, (0.1, 0.12, T + 0.02 + 0.013), 'plastic_white', r=0.003, w=0.2)
    cable(b, [(0.02, 0.12, T + 0.033), (-0.05, 0.13, T + 0.035), (-0.15, 0.1, T + 0.03), (-0.25, 0.0, T + 0.024)], 0.003, 'cable_white', w=0.1)
    if b.hi:
        for sx in (-1, 1):
            b.add(box(0.03, 0.002, 0.012, (sx * 0.2, -S / 2 + F + 0.001, T + 0.006)), 'steel_bare')


# -- filing cabinet -----------------------------------------------------------------------------

def build_filing_cabinet(b):
    W, D, H = 0.47, 0.62, 1.32
    bx(b, W, D - 0.02, H - 0.06, (0, 0.01, 0.06 + (H - 0.06) / 2), 'steel_light', r=0.006, w=0.5, chamfer=True)
    bx(b, W - 0.02, D - 0.06, 0.06, (0, 0.03, 0.03), 'steel_black', w=0.2)
    n = 4
    dh = (H - 0.08) / n
    for i in range(n):
        z0 = 0.07 + i * dh
        i0 = b.mark()
        bx(b, W - 0.012, 0.022, dh - 0.006, (0, -D / 2 + 0.0, z0 + dh / 2), 'steel_light', r=0.007, w=0.6, chamfer=True)
        # aluminium pull and label holder
        hz = z0 + dh * 0.62
        bx(b, 0.16, 0.012, 0.022, (0, -D / 2 - 0.016, hz), 'alu', r=0.004, w=0.3, chamfer=True)
        for sx in (-0.07, 0.07):
            bx(b, 0.012, 0.016, 0.016, (sx, -D / 2 - 0.009, hz), 'alu', r=0.003, w=0.05)
        if b.hi:
            b.add(box(0.085, 0.003, 0.034, (0, -D / 2 - 0.0115, hz + 0.045), bev=0.001, segs=2), 'alu')
            b.add(box(0.075, 0.0006, 0.026, (0, -D / 2 - 0.0132, hz + 0.045)), 'label_print' if i != 2 else 'label')
        b.xform(i0, lambda g: g)
    cy(b, 0.009, 0.01, (W / 2 - 0.05, -D / 2 - 0.004, H - 0.035), 'chrome', 'Y', 24, 10, w=0.05)
    hp(b, lambda: box(0.0012, 0.002, 0.007, (W / 2 - 0.05, -D / 2 - 0.0092, H - 0.035)), 'chip')
    # a folder and a box of paper on top
    bx(b, 0.24, 0.32, 0.06, (-0.08, 0.05, H + 0.03), 'plastic_blue', r=0.004, w=0.4, chamfer=True)
    hp(b, lambda: box(0.0005, 0.08, 0.04, (-0.2003, 0.05, H + 0.03)), 'label')
    paper_stack(b, 0.1, -0.05, H + 0.0, n=5, ang=12)


# -- whiteboard ---------------------------------------------------------------------------------

def build_whiteboard(b):
    W, H, T = 1.2, 0.9, 0.018
    z0 = 0.05
    f = 0.018
    # back panel, the face, an aluminium frame with corner caps
    bx(b, W - 0.01, T, H - 0.01, (0, 0.0, z0 + H / 2), 'mdf', w=0.15)
    a = (W - 2 * f) / 2
    hgt = (H - 2 * f) / 2
    fy = -T / 2 - 0.0015
    g = quad((-a, fy, z0 + H / 2 - hgt), (a, fy, z0 + H / 2 - hgt), (a, fy, z0 + H / 2 + hgt), (-a, fy, z0 + H / 2 + hgt))
    b.add(g, 'board')
    for (cx, cz, ln, rot) in ((0, z0 + f / 2, W, 0), (0, z0 + H - f / 2, W, 0), (-W / 2 + f / 2, z0 + H / 2, H, 90),
                              (W / 2 - f / 2, z0 + H / 2, H, 90)):
        g = prism([(x, y) for x, y in [(-f / 2, 0.0), (f / 2, 0.0), (f / 2, -0.012), (f / 2 - 0.004, -0.022), (-f / 2 + 0.004, -0.022), (-f / 2, -0.016)]],
                  ln, c=(0, 0, -ln / 2), bev=b.n(0.0012, 0.0), bsegs=b.n(2, 0))
        # prism: outline in XY (x across the bar, y depth), extruded along Z (the bar's length)
        if rot == 0:
            g.rot('Y', 90)
        g.move(cx, T / 2, cz)
        b.add(g, 'alu', 0.25)
    for sx in (-1, 1):
        for sz in (0, 1):
            bx(b, 0.03, 0.026, 0.03, (sx * (W / 2 - 0.008), -0.002, z0 + 0.008 + sz * (H - 0.016)), 'plastic_grey', r=0.006, w=0.08, chamfer=True)
    # marker tray: a J-shaped aluminium extrusion along the bottom, markers and an eraser in it
    tray = [(-0.0, 0.0), (-0.072, 0.0), (-0.076, 0.004), (-0.076, 0.024), (-0.0715, 0.024), (-0.0715, 0.0045), (-0.004, 0.0045),
            (-0.004, 0.045), (0.0, 0.045)]
    g = slab([(y, z) for y, z in tray], 0.7, axis='X', bev=b.n(0.0008, 0.0), bsegs=b.n(2, 0))
    b.add(g.move(0, -T / 2, 0.0), 'alu', 0.4)
    for sx in (-1, 1):
        bx(b, 0.006, 0.076, 0.026, (sx * 0.353, -T / 2 - 0.038, 0.013), 'plastic_grey', r=0.002, w=0.05)
    for k, (mx, col) in enumerate(((-0.2, 'plastic_black'), (-0.13, 'plastic_blue'), (-0.09, 'plastic_red'), (0.06, 'plastic_green'))):
        i0 = b.mark()
        cy(b, 0.0085, 0.12, (0, 0, 0), 'plastic_white', 'X', 24, 8, w=0.15)
        cy(b, 0.0095, 0.045, (0.07, 0, 0), col, 'X', 24, 8, bev=0.002, w=0.1)
        cy(b, 0.006, 0.01, (-0.065, 0, 0), col, 'X', 24, 8, w=0.05)
        b.xform(i0, lambda g, mx=mx, k=k: g.rot('Z', (k - 1.5) * 6).move(mx, -T / 2 - 0.035, 0.0045 + 0.0095))
    bx(b, 0.13, 0.05, 0.022, (0.2, -T / 2 - 0.036, 0.0045 + 0.011), 'plastic_dark', r=0.008, w=0.2, chamfer=True)
    bx(b, 0.13, 0.05, 0.012, (0.2, -T / 2 - 0.036, 0.0045 + 0.006), 'felt_black', r=0.002, w=0.1)
    if b.hi:
        # ghosting and a stuck note on the frame
        sticky(b, W / 2 - 0.08, -T / 2 - 0.024, z0 + H - 0.1, 'note_yellow', ang=-5, curl=0.006, size=0.076, plane='XZ')


# -- printer ---------------------------------------------------------------------------------

def build_printer(b):
    W, D = 0.58, 0.6
    # cabinet on casters with two paper drawers
    for fx in (-1, 1):
        for fy in (-1, 1):
            cy(b, 0.02, 0.016, (fx * 0.24, fy * 0.24, 0.02), 'plastic_black', 'X', 24, 8, w=0.05)
            bx(b, 0.03, 0.03, 0.02, (fx * 0.24, fy * 0.24, 0.045), 'plastic_black', w=0.05)
    bx(b, W, D, 0.3, (0, 0, 0.055 + 0.15), 'plastic_grey', r=0.006, w=0.6, chamfer=True)
    for i in range(2):
        z = 0.07 + i * 0.145
        bx(b, W - 0.02, 0.012, 0.135, (0, -D / 2 - 0.004, z + 0.0675), 'plastic_white', r=0.005, w=0.5, chamfer=True)
        bx(b, 0.16, 0.012, 0.02, (0, -D / 2 - 0.012, z + 0.11), 'plastic_dark', r=0.005, w=0.1, chamfer=True)
        if b.hi:
            b.add(box(0.03, 0.0006, 0.04, (0.22, -D / 2 - 0.0103, z + 0.06)), 'plastic_dark')
    # main body: two cassettes, the front door and the side bypass tray
    z1 = 0.355
    bx(b, W, D, 0.42, (0, 0, z1 + 0.21), 'plastic_white', r=0.008, w=0.5, chamfer=True)
    for i in range(2):
        z = z1 + 0.005 + i * 0.09
        bx(b, W - 0.02, 0.01, 0.083, (0, -D / 2 - 0.003, z + 0.0415), 'plastic_white', r=0.004, w=0.4)
        bx(b, 0.14, 0.01, 0.016, (0, -D / 2 - 0.009, z + 0.065), 'plastic_dark', r=0.004, w=0.1, chamfer=True)
        if b.hi:
            b.add(box(0.03, 0.0006, 0.05, (-0.22, -D / 2 - 0.0085, z + 0.04)), 'plastic_dark')
    bx(b, W - 0.02, 0.01, 0.22, (0, -D / 2 - 0.003, z1 + 0.19 + 0.11), 'plastic_white', r=0.004, w=0.4)
    if b.hi:
        b.add(box(0.2, 0.0008, 0.06, (-0.12, -D / 2 - 0.0085, z1 + 0.33)), 'vent_black')
        b.add(box(0.06, 0.0006, 0.012, (0.18, -D / 2 - 0.0085, z1 + 0.38)), 'plastic_dark')
    bx(b, 0.012, 0.32, 0.03, (W / 2 + 0.006, 0.0, z1 + 0.2), 'plastic_grey', r=0.004, w=0.2, chamfer=True)
    # the output bay between body and scanner, with a stack of prints
    z2 = z1 + 0.42
    bx(b, 0.14, D, 0.13, (W / 2 - 0.07, 0, z2 + 0.065), 'plastic_white', r=0.006, w=0.5, chamfer=True)
    bx(b, W - 0.14, D - 0.05, 0.01, ((-0.07), 0.02, z2 + 0.005), 'plastic_grey', w=0.4)
    paper_stack(b, -0.07, 0.03, z2 + 0.01, n=8, ang=90)
    # scanner unit and document feeder
    z3 = z2 + 0.13
    bx(b, W, D - 0.02, 0.085, (0, 0.01, z3 + 0.0425), 'plastic_white', r=0.008, w=0.6, chamfer=True)
    bx(b, W - 0.06, D - 0.08, 0.035, (0, 0.03, z3 + 0.085 + 0.0175), 'plastic_white', r=0.008, w=0.5, chamfer=True)
    bx(b, 0.42, 0.3, 0.07, (0.0, 0.1, z3 + 0.12 + 0.035), 'plastic_white', r=0.012, w=0.5, chamfer=True)
    i0 = b.mark()
    bx(b, 0.32, 0.24, 0.008, (0, 0, 0), 'plastic_grey', r=0.003, w=0.3)
    paper_stack(b, 0, 0.0, 0.004, n=5, ang=0, w=0.21, d=0.2)
    b.xform(i0, lambda g: g.rot('X', 12).move(0.0, 0.05, z3 + 0.2))
    # control panel: a tilted tablet with its touch screen, at the front right
    i0 = b.mark()
    bx(b, 0.27, 0.13, 0.024, (0, 0, 0), 'plastic_dark', r=0.008, w=0.5, chamfer=True)
    g = quad((-0.095, -0.05, 0.0125), (0.095, -0.05, 0.0125), (0.095, 0.05, 0.0125), (-0.095, 0.05, 0.0125))
    b.add(g, 'led', 1.0, 'lcd')
    if b.hi:
        b.add(box(0.2, 0.108, 0.001, (0, 0, 0.012)), 'glass_dark')
        for k in range(3):
            b.add(cyl(0.006, 0.002, 20, (0.115, -0.03 + k * 0.03, 0.012)), 'plastic_grey')
    led(b, 0.115, -0.05, 0.0126, 'green', 0.004, 0.004, face='+Z')
    b.xform(i0, lambda g: g.rot('X', 28).move(0.12, -D / 2 - 0.02, z3 + 0.06))
    led(b, -0.25, -D / 2 - 0.008, z1 + 0.395, 'blue', 0.005, 0.003)


# -- plant ----------------------------------------------------------------------------------

def _leaf(b, length, width, fold, droop, mat_front='leaf', mat_back='leaf_back'):
    """A fiddle-leaf fig leaf along +X from the origin, broad near the tip with a waist, folded
    along its midrib and drooping. Front and back are separate sheets (the atlas material is one
    sided); u runs along the leaf, v across it (the high-poly material draws its veins from them)."""
    nu, nv = b.n(18, 8), b.n(8, 3)
    verts, faces, uvs = [], [], []
    for i in range(nu + 1):
        t = i / nu
        wv = width * (0.18 + 0.82 * math.sin(math.pi * min(1.0, t * 1.08) ** 0.75)) * (1 - 0.18 * math.exp(-((t - 0.42) / 0.12) ** 2))
        if t > 0.92:
            wv *= max(0.05, (1 - t) / 0.08) ** 0.5
        for j in range(nv + 1):
            s = j / nv - 0.5
            y = s * wv
            z = fold * abs(s) * wv * 2 - droop * t ** 2 + 0.01 * math.sin(t * 9) * abs(s)
            verts.append((t * length, y, z))
    for i in range(nu):
        for j in range(nv):
            k = i * (nv + 1) + j
            faces.append((k, k + nv + 1, k + nv + 2, k + 1))
            uvs.append(((i / nu, j / nv), ((i + 1) / nu, j / nv), ((i + 1) / nu, (j + 1) / nv), (i / nu, (j + 1) / nv)))
    front = Geo(verts, faces, uvs)
    back = Geo(verts, [tuple(reversed(f)) for f in faces], [tuple(reversed(u)) for u in uvs]).move(z=-0.0006)
    return front, back


def build_plant_pot(b):
    # an anthracite fibreglass planter, tapered, with a rolled rim
    prof = [(0.0, 0.0), (0.155, 0.0), (0.165, 0.006), (0.168, 0.02), (0.205, 0.5), (0.212, 0.505), (0.212, 0.515), (0.2, 0.518),
            (0.196, 0.49), (0.19, 0.45)]
    if not b.hi:
        prof = [(0.0, 0.0), (0.16, 0.0), (0.168, 0.02), (0.205, 0.5), (0.212, 0.515), (0.198, 0.515), (0.19, 0.45)]
    b.add(lathe(prof, b.n(72, 24)), 'pot', 1.0)
    b.add(lathe([(0.19, 0.45), (0.0, 0.452)] if not b.hi else [(0.19, 0.45), (0.12, 0.456), (0.0, 0.458)], b.n(72, 24)), 'soil', 0.6)
    if b.hi:
        rng = random.Random(2)
        for k in range(160):  # bark mulch and pebbles on the soil
            a, rr = rng.uniform(0, 6.283), 0.18 * math.sqrt(rng.random())
            px, py = rr * math.cos(a), rr * math.sin(a)
            if rng.random() < 0.6:
                b.add(box(rng.uniform(0.008, 0.02), rng.uniform(0.006, 0.012), 0.003, (0, 0, 0), bev=0.001, segs=1)
                      .rot('Z', rng.uniform(0, 180)).rot('X', rng.uniform(-15, 15)).move(px, py, 0.458), 'bark')
            else:
                b.add(sphere(rng.uniform(0.003, 0.006), 10, 6, (px, py, 0.457), (1, 0.8, 0.6)), 'pot')
    # trunk and two side stems
    rng = random.Random(4)
    stems = [
        [(0.0, 0.0, 0.44), (0.01, 0.005, 0.7), (-0.01, 0.0, 0.95), (0.0, -0.01, 1.2), (0.01, -0.01, 1.36)],
        [(0.0, 0.0, 0.74), (0.06, 0.03, 0.85), (0.12, 0.05, 1.0), (0.15, 0.06, 1.08)],
        [(0.0, 0.0, 0.86), (-0.07, -0.02, 0.95), (-0.12, -0.05, 1.08), (-0.15, -0.06, 1.15)],
    ]
    for si, ctrl in enumerate(stems):
        pts = smooth_path(ctrl, b.n(30, 8))
        n = len(pts)
        r0 = 0.016 if si == 0 else 0.008
        radii = [r0 * (1 - 0.65 * i / (n - 1)) for i in range(n)]
        b.add(tube(pts, r0, b.n(12, 6), radii=radii), 'bark', 0.5)
        # leaves spiral up the upper part of each stem
        nleaf = (24, 9, 9)[si]
        start = (0.45, 0.35, 0.35)[si]
        for k in range(nleaf):
            t = start + (1 - start) * (k + 0.5) / nleaf
            idx = min(n - 1, int(t * (n - 1)))
            p = pts[idx]
            az = k * 137.5 + si * 40 + rng.uniform(-10, 10)
            size = 0.72 + 0.4 * (1 - abs(t - 0.75) * 1.6) + rng.uniform(-0.08, 0.08)
            length, width = 0.27 * size, 0.18 * size
            lift = rng.uniform(15, 45) - (1 - t) * 20
            front, back = _leaf(b, length, width, fold=rng.uniform(0.08, 0.16), droop=length * rng.uniform(0.15, 0.3))
            # a short petiole lifts the leaf off the stem
            pet = tube([(0, 0, 0), (0.025, 0, 0.01), (0.04, 0, 0.012)], 0.0025, b.n(8, 4))
            for g, m in ((front, 'leaf'), (back, 'leaf_back'), (pet, 'bark')):
                if g is not pet:
                    g.move(0.038, 0, 0.012)
                g.rot('Z', rng.uniform(-8, 8)).rot('Y', -lift).rot('Z', az).move(p.x, p.y, p.z)
                b.add(g, m, 0.9 if m != 'bark' else 0.1)


# -- coffee station ---------------------------------------------------------------------------

def build_coffee_station(b):
    W, D, H, T = 1.2, 0.6, 0.9, 0.03
    # base unit: carcass, plinth, two doors and a drawer bank, oak worktop
    bx(b, W - 0.01, D - 0.03, H - T - 0.1, (0, 0.01, 0.1 + (H - T - 0.1) / 2), 'laminate_white', r=0.002, w=0.3)
    bx(b, W - 0.03, D - 0.08, 0.1, (0, 0.03, 0.05), 'plastic_dark', w=0.15)
    fz0, fh = 0.1, H - T - 0.1
    fronts = [(-0.45, 0.296, fz0 + 0.003, fh - 0.006), (-0.15, 0.296, fz0 + 0.003, fh - 0.006)]
    for k in range(3):
        hh = (fh - 0.012) / 3
        fronts.append((0.3, 0.596, fz0 + 0.003 + k * (hh + 0.003), hh))
    for (cx, wd, z0, hh) in fronts:
        bx(b, wd, 0.019, hh, (cx, -D / 2 + 0.005, z0 + hh / 2), 'laminate_grey', r=0.002, w=0.45)
        hz = z0 + hh - 0.06 if wd > 0.5 else z0 + hh - 0.08
        if wd > 0.5:
            b.add(cyl(0.006, 0.18, b.n(20, 6), (cx, -D / 2 - 0.025, z0 + hh - 0.05), 'X'), 'steel_bare', 0.1)
            for sx in (-0.07, 0.07):
                cy(b, 0.005, 0.025, (cx + sx, -D / 2 - 0.012, z0 + hh - 0.05), 'steel_bare', 'Y', 16, 6, w=0.03)
        else:
            hx = cx + (0.12 if cx < -0.3 else -0.12)
            b.add(cyl(0.006, 0.16, b.n(20, 6), (hx, -D / 2 - 0.025, z0 + hh - 0.15), 'Z'), 'steel_bare', 0.1)
            for sz in (-0.06, 0.06):
                cy(b, 0.005, 0.025, (hx, -D / 2 - 0.012, z0 + hh - 0.15 + sz), 'steel_bare', 'Y', 16, 6, w=0.03)
    bx(b, W + 0.02, D + 0.02, T, (0, 0, H - T / 2), 'laminate_oak', r=0.003, w=0.7, chamfer=True)
    # bean-to-cup machine
    mx, my = -0.3, 0.02
    i0 = b.mark()
    mw, md, mh = 0.3, 0.44, 0.38
    bx(b, mw, md, mh, (0, 0, mh / 2), 'plastic_black', r=0.02, w=1.0, chamfer=True)
    bx(b, mw - 0.03, 0.008, mh * 0.5, (0, -md / 2 - 0.003, mh * 0.7), 'steel_bare', r=0.003, w=0.6)
    bx(b, 0.12, 0.09, 0.05, (0, -md / 2 - 0.035, mh * 0.6), 'plastic_black', r=0.01, w=0.4, chamfer=True)
    for sx in (-0.02, 0.02):
        cy(b, 0.006, 0.02, (sx, -md / 2 - 0.05, mh * 0.6 - 0.033), 'chrome', hs=20, ls=8, w=0.05)
    bx(b, mw - 0.04, 0.13, 0.03, (0, -md / 2 - 0.05, 0.015), 'steel_bare', r=0.004, w=0.4, chamfer=True)
    hp(b, lambda: box(mw - 0.06, 0.11, 0.0015, (0, -md / 2 - 0.05, 0.0305)), 'perf_black')
    mug(b, 0.0, -md / 2 - 0.05, 0.031, 'ceramic_white', ang=-30, r=0.032, h=0.075)
    bx(b, 0.2, 0.015, 0.05, (0, -md / 2 - 0.005, mh - 0.04), 'glass_dark', r=0.003, w=0.4)
    led(b, -0.03, -md / 2 - 0.0125, mh - 0.04, 'lcd', 0.07, 0.03)
    led(b, 0.075, -md / 2 - 0.0125, mh - 0.04, 'white', 0.006, 0.006)
    if b.hi:
        for k in range(4):
            b.add(cyl(0.006, 0.002, 20, (-0.08 + k * 0.025 + (0.13 if k > 1 else 0), -md / 2 - 0.013, mh - 0.065), 'Y'), 'plastic_grey')
    # bean hopper lid and the water tank at the side
    bx(b, 0.18, 0.16, 0.02, (0.0, 0.08, mh + 0.01), 'plastic_clear', r=0.008, w=0.3, chamfer=True)
    bx(b, 0.04, 0.3, 0.3, (mw / 2 + 0.02, 0.03, 0.17), 'plastic_clear', r=0.008, w=0.3, chamfer=True)
    b.xform(i0, lambda g: g.move(mx, my, H))
    # mugs, a kettle, jars, a stack of cups
    mug(b, 0.02, -0.1, H, 'ceramic_red', ang=120)
    mug(b, 0.12, -0.14, H, 'ceramic_white', ang=60, full=False)
    mug(b, 0.08, -0.02, H, 'ceramic_blue', ang=-20, full=False)
    i0 = b.mark()
    b.add(lathe([(0.0, 0.0), (0.075, 0.0), (0.08, 0.01), (0.08, 0.02)], b.n(48, 16)), 'plastic_black', 0.3)
    kp = [(0.0, 0.02), (0.078, 0.02), (0.08, 0.03), (0.08, 0.17), (0.07, 0.21), (0.05, 0.225), (0.0, 0.228)]
    b.add(lathe(kp, b.n(48, 16)), 'steel_bare', 0.8)
    b.add(sweep(smooth_path([(-0.075, 0, 0.19), (-0.115, 0, 0.18), (-0.12, 0, 0.1), (-0.08, 0, 0.05)], b.n(24, 8)),
                _rounded_section(0.018, 0.024, b.n(3, 1))), 'plastic_black', 0.3)
    b.add(sweep(smooth_path([(0.07, 0, 0.15), (0.1, 0, 0.18), (0.12, 0, 0.2)], b.n(16, 5)), _rounded_section(0.02, 0.02, b.n(3, 1))),
          'steel_bare', 0.2)
    b.xform(i0, lambda g: g.rot('Z', -60).move(0.38, 0.08, H))
    for k, (jx, mat) in enumerate(((0.2, 'glass_clear'), (0.28, 'glass_clear'))):
        i0 = b.mark()
        b.add(lathe([(0.0, 0.0), (0.045, 0.0), (0.048, 0.005), (0.048, 0.14), (0.042, 0.15)], b.n(40, 14)), mat, 0.4)
        b.add(lathe([(0.0, 0.08 if k else 0.1), (0.045, 0.08 if k else 0.1)], b.n(40, 14)), 'coffee' if k == 0 else 'paper', 0.1)
        b.add(lathe([(0.04, 0.145), (0.05, 0.15), (0.05, 0.165), (0.0, 0.167)], b.n(40, 14)), 'plastic_dark', 0.3)
        b.xform(i0, lambda g, jx=jx: g.move(jx, 0.22, H))
    i0 = b.mark()
    b.add(lathe([(0.0, 0.0), (0.028, 0.0), (0.04, 0.13)], b.n(32, 12)), 'paper', 0.3)
    if b.hi:
        for k in range(12):
            b.add(torus(0.0395, 0.0012, 32, 6, (0, 0, 0.125 - k * 0.002)), 'paper')
    b.xform(i0, lambda g: g.move(0.48, 0.2, H))
    if b.hi:
        # a tray of sugar sticks and stirrers
        b.add(box(0.16, 0.1, 0.004, (0.2, 0.08, H + 0.002), bev=0.001, segs=2), 'plastic_dark')
        rng = random.Random(8)
        for k in range(14):
            b.add(box(0.07, 0.012, 0.004, (0.2 + rng.uniform(-0.03, 0.03), 0.08 + rng.uniform(-0.03, 0.03), H + 0.006 + k * 0.0008)).rot(
                'Z', rng.uniform(-30, 30), o=(0.2, 0.08, 0)), 'paper_print' if k % 2 else 'paper')


BUILDERS = {
    'desk_pod': build_desk_pod,
    'monitor_24': build_monitor_24,
    'chair_office': build_chair_office,
    'rack_42u': build_rack_42u,
    'cable_tray': build_cable_tray,
    'it_bench': build_it_bench,
    'desk_lamp': build_desk_lamp,
    'ceiling_light_panel': build_ceiling_light_panel,
    'filing_cabinet': build_filing_cabinet,
    'whiteboard': build_whiteboard,
    'printer': build_printer,
    'plant_pot': build_plant_pot,
    'coffee_station': build_coffee_station,
}

# what the bake's occlusion pass puts round each prop (open sky elsewhere): the floor it stands
# on, the ceiling a panel or tray hangs from, the wall a board or bench backs onto
SURROUND = {
    'ceiling_light_panel': ('ceiling',),
    'cable_tray': (),
    'whiteboard': ('wall',),
    'it_bench': ('floor', 'wall'),
}


def build(name, hi, seed=1):
    b = Build(hi, seed)
    BUILDERS[name](b)
    return b
