"""Builds the recipient's house: the shell round the reused arrival-office interior (docs/ending.md).

    python blender/make_recipient_room.py                 # writes public/models/recipient-room/*
    python blender/make_recipient_room.py --render DIR    # ...and a Cycles preview sheet of both tiers
    npm run compress:models

Only the shell is modelled here: the room inside (plaster, wainscot, boards, rug, desk, the laptop, the lamp,
the bookcase, the beanbag) is the engine's (src/webgl/actors/RecipientRoom.ts). A small gabled house, its gable
end facing the tower: painted lap siding, white trim and corner boards, a fieldstone foundation band, an asphalt
shingle roof with a ridge cap and a brick chimney, gutters and a downpipe, and in the gable wall ONE TALL OPEN
WINDOW with no glass (sill 0.9, 2.4 wide, 1.6 high, centred on the flight line), its two shutters swung open,
a flower box under it and a porch lantern beside it. Lit windows on the two side walls (warm glass, emissive).
No door anywhere.

House-local frame (glTF, Y up): origin on the ground at the middle of the gable wall's outer face (the window
wall), +x into the house (the flight's heading), z across. Interior 10 x 10 x 3.6 from x 0.25 to 10.25.
HIGH (house.glb, about 9k triangles) and LOW (house-lean.glb, under 3k) are one draw each on one 1024 atlas
(house-color.webp, house-emissive.webp; LOW at 512).
"""
import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402
from PIL import Image  # noqa: E402

import make_comm_tower as T  # noqa: E402  (the geometry and atlas helpers)

ROOT = T.ROOT
OUT = os.path.join(ROOT, 'public', 'models', 'recipient-room')

WALL = 0.25
DEPTH = 10.5           # outer, along x
HALF = 5.25            # outer half width, along z
EAVE = 3.9
PITCH = 38 * T.DEG
RIDGE = EAVE + HALF * math.tan(PITCH)
OVER_EAVE = 0.45
OVER_GABLE = 0.35
FOUND = 0.38
WIN = dict(z0=-1.2, z1=1.2, y0=0.9, y1=2.5)          # the open window in the gable wall
SIDE_WIN = dict(x=3.2, half=0.8, y0=1.0, y1=2.6)     # one lit window in each side wall

CELLS = {
    'siding': (0, 0), 'trim': (1, 0), 'roof': (2, 0), 'stone': (3, 0),
    'brick': (0, 1), 'glass_lit': (1, 1), 'shutter': (2, 1), 'planter': (3, 1),
    'flowers': (0, 2), 'leaf': (1, 2), 'lantern': (2, 2), 'bulb': (3, 2),
    'gutter': (0, 3), 'soffit': (1, 3), 'reveal': (2, 3), 'dark': (3, 3),
}
TILE = {'siding': 3.0, 'trim': 1.5, 'roof': 3.0, 'stone': 2.0, 'brick': 1.2, 'glass_lit': 1.0, 'shutter': 1.0,
        'planter': 1.2, 'flowers': 1.0, 'leaf': 1.0, 'lantern': 0.5, 'bulb': 0.3, 'gutter': 2.0, 'soffit': 2.0,
        'reveal': 1.0, 'dark': 1.0}


def use_atlas():
    T.ATLAS = dict(cells=CELLS, tile=TILE, cols=4, rows=4, aspect=1.0)


def quad(g, a, b, c, d, cell, n, uvs=None):
    g.poly([a, b, c, d], cell, uvs=uvs, expect=n)


def wall_face(g, x_or_z, axis, n, spans, cell, u_range=(-HALF, HALF), v_range=(FOUND, EAVE)):
    """Rectangles on a wall plane: axis 'x' (a gable wall at x) spans in (z, y); 'z' (a side wall) in (x, y). The uvs
    run across the whole wall (u stretched; v by height, so the siding's boards line up from one piece to the next)."""
    uv = lambda u, y: ((u - u_range[0]) / (u_range[1] - u_range[0]), (y - v_range[0]) / (v_range[1] - v_range[0]))
    for (u0, u1, y0, y1) in spans:
        if axis == 'x':
            pts = [Vector((x_or_z, y0, u0)), Vector((x_or_z, y0, u1)), Vector((x_or_z, y1, u1)), Vector((x_or_z, y1, u0))]
        else:
            pts = [Vector((u0, y0, x_or_z)), Vector((u1, y0, x_or_z)), Vector((u1, y1, x_or_z)), Vector((u0, y1, x_or_z))]
        g.poly(pts, cell, uvs=[uv(u0, y0), uv(u1, y0), uv(u1, y1), uv(u0, y1)], expect=n)


def lap_siding(g, axis, plane, n, u_lo, u_hi, y_lo, y_hi_at, holes, hi):
    """Lap boards on a wall: rows from y_lo up to y_hi_at(u) (a gable's slope), cut round `holes` [(u0, u1, y0, y1)].
    HIGH steps each board out at its bottom edge; LOW is flat with the siding texture."""
    board = 0.22
    n = Vector(n)
    rows = int(math.ceil((max(y_hi_at(u_lo), y_hi_at((u_lo + u_hi) / 2), y_hi_at(u_hi)) - y_lo) / board))
    for r in range(rows):
        yb = y_lo + r * board
        yt = yb + board
        # the row's extent under the gable: where y_hi_at(u) >= yt (solve on a fine grid)
        us = np.linspace(u_lo, u_hi, 241)
        inside = [u for u in us if y_hi_at(u) >= yb + 0.02]
        if not inside:
            continue
        a, b = min(inside), max(inside)
        segs = [(a, b)]
        for (h0, h1, hy0, hy1) in holes:
            if yt > hy0 and yb < hy1:
                nxt = []
                for s0, s1 in segs:
                    if s1 <= h0 or s0 >= h1:
                        nxt.append((s0, s1))
                        continue
                    if s0 < h0:
                        nxt.append((s0, h0))
                    if s1 > h1:
                        nxt.append((h1, s1))
                segs = nxt
        # one board of the texture (it paints 13.64 to a cell, the lap's shadow at each board's top): the geometry
        # gives the lap itself, so each row samples a clean stretch of one board
        vb, vt = 1 - 6.95 / 13.64, 1 - 6.2 / 13.64
        lip = 0.03 if hi else 0.0
        P = (lambda u, y, w: Vector((plane + w * n.x, y, u)) if axis == 'x' else Vector((u, y, plane + w * n.z)))
        uu = lambda u: 0.02 + 0.96 * (u - u_lo) / (u_hi - u_lo)
        for s0, s1 in segs:
            if s1 - s0 < 0.01:
                continue
            # the row's top edge follows the gable where the gable is lower than the row's top
            top = [(s1, min(yt, y_hi_at(s1)))]
            for uc in sorted(cross(y_hi_at, yt, s0, s1), reverse=True):
                top.append((uc, yt))
            top.append((s0, min(yt, y_hi_at(s0))))
            pts = [P(s0, yb, lip), P(s1, yb, lip)] + [P(u, y, 0) for u, y in top]
            uvs = [(uu(s0), vb), (uu(s1), vb)] + [(uu(u), vb + (vt - vb) * (y - yb) / board) for u, y in top]
            g.poly(pts, 'siding', uvs=uvs, expect=n)
            if hi:
                # the board's underside lip
                g.poly([P(s0, yb, 0), P(s1, yb, 0), P(s1, yb, lip), P(s0, yb, lip)], 'trim', expect=Vector((0, -1, 0)))


def cross(f, y, a, b):
    """Where f(u) = y in [a, b] (f is the gable: piecewise linear, peaking in the middle)."""
    out = []
    us = np.linspace(a, b, 401)
    vals = [f(u) - y for u in us]
    for i in range(len(us) - 1):
        if vals[i] == 0 or vals[i] * vals[i + 1] < 0:
            t = vals[i] / (vals[i] - vals[i + 1]) if vals[i] != vals[i + 1] else 0
            out.append(us[i] + (us[i + 1] - us[i]) * t)
    return out


def build(hi):
    parts = {'house': T.Geo('house')}
    g = parts['house']
    box = T.box
    bar = T.bar
    lathe = T.lathe
    gable = lambda z: EAVE + (HALF - abs(z)) * math.tan(PITCH)

    # -- foundation band (fieldstone) ----------------------------------------------------------------------
    box(g, (DEPTH / 2, FOUND / 2 - 0.05, 0), (DEPTH + 0.08, FOUND + 0.1, HALF * 2 + 0.08), 'stone', skip=('-y',))

    # -- the gable wall with the open window (x = 0, facing -x) ---------------------------------------------
    holes = [(WIN['z0'] - 0.12, WIN['z1'] + 0.12, WIN['y0'] - 0.1, WIN['y1'] + 0.14), (-0.62, 0.62, 4.95, 6.1)]
    if hi:
        lap_siding(g, 'x', 0.0, (-1, 0, 0), -HALF, HALF, FOUND, gable, holes, hi)
    else:
        # flat panels round the opening, the gable as one triangle (the siding texture carries the boards)
        wall_face(g, 0.0, 'x', (-1, 0, 0), [(-HALF, WIN['z0'], FOUND, EAVE), (WIN['z1'], HALF, FOUND, EAVE),
                                             (WIN['z0'], WIN['z1'], FOUND, WIN['y0']), (WIN['z0'], WIN['z1'], WIN['y1'], EAVE)], 'siding')
        g.poly([Vector((0, EAVE, -HALF)), Vector((0, EAVE, HALF)), Vector((0, RIDGE, 0))], 'siding', uvs=[(0, 0), (1, 0), (0.5, 1)], expect=(-1, 0, 0))
    # the back gable (x = DEPTH, facing +x): no openings
    if hi:
        lap_siding(g, 'x', DEPTH, (1, 0, 0), -HALF, HALF, FOUND, gable, [], hi)
    else:
        wall_face(g, DEPTH, 'x', (1, 0, 0), [(-HALF, HALF, FOUND, EAVE)], 'siding')
        g.poly([Vector((DEPTH, EAVE, -HALF)), Vector((DEPTH, EAVE, HALF)), Vector((DEPTH, RIDGE, 0))], 'siding', uvs=[(0, 0), (1, 0), (0.5, 1)], expect=(1, 0, 0))
    # side walls (z = +-HALF), one lit window each
    for zs in (1, -1):
        sw = [(SIDE_WIN['x'] - SIDE_WIN['half'] - 0.1, SIDE_WIN['x'] + SIDE_WIN['half'] + 0.1, SIDE_WIN['y0'] - 0.1, SIDE_WIN['y1'] + 0.12)]
        if hi:
            lap_siding(g, 'z', zs * HALF, (0, 0, zs), 0.0, DEPTH, FOUND, lambda u: EAVE, sw, hi)
        else:
            x0, x1 = SIDE_WIN['x'] - SIDE_WIN['half'], SIDE_WIN['x'] + SIDE_WIN['half']
            wall_face(g, zs * HALF, 'z', (0, 0, zs), [(0, x0, FOUND, EAVE), (x1, DEPTH, FOUND, EAVE),
                                                      (x0, x1, FOUND, SIDE_WIN['y0']), (x0, x1, SIDE_WIN['y1'], EAVE)], 'siding', u_range=(0, DEPTH))
        # the lit glass (inset), its frame, sill and head
        x0, x1 = SIDE_WIN['x'] - SIDE_WIN['half'], SIDE_WIN['x'] + SIDE_WIN['half']
        z = zs * (HALF - 0.12)
        g.poly([Vector((x0, SIDE_WIN['y0'], z)), Vector((x1, SIDE_WIN['y0'], z)), Vector((x1, SIDE_WIN['y1'], z)), Vector((x0, SIDE_WIN['y1'], z))],
               'glass_lit', uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], expect=(0, 0, zs))
        box(g, ((x0 + x1) / 2, SIDE_WIN['y0'] - 0.06, zs * (HALF + 0.04)), (x1 - x0 + 0.4, 0.1, 0.2), 'trim')   # sill
        box(g, ((x0 + x1) / 2, SIDE_WIN['y1'] + 0.08, zs * (HALF + 0.02)), (x1 - x0 + 0.3, 0.14, 0.12), 'trim')  # head
        for xx in (x0 - 0.06, x1 + 0.06):
            box(g, (xx, (SIDE_WIN['y0'] + SIDE_WIN['y1']) / 2, zs * (HALF + 0.02)), (0.12, SIDE_WIN['y1'] - SIDE_WIN['y0'], 0.1), 'trim')
        # reveals
        for (pa, pb, nn) in (((x0, SIDE_WIN['y0']), (x1, SIDE_WIN['y0']), (0, 1, 0)), ((x0, SIDE_WIN['y1']), (x1, SIDE_WIN['y1']), (0, -1, 0))):
            g.poly([Vector((pa[0], pa[1], zs * HALF)), Vector((pb[0], pb[1], zs * HALF)), Vector((pb[0], pb[1], z)), Vector((pa[0], pa[1], z))], 'reveal', expect=nn)
        for xx, nn in ((x0, (1, 0, 0)), (x1, (-1, 0, 0))):
            g.poly([Vector((xx, SIDE_WIN['y0'], zs * HALF)), Vector((xx, SIDE_WIN['y1'], zs * HALF)), Vector((xx, SIDE_WIN['y1'], z)), Vector((xx, SIDE_WIN['y0'], z))], 'reveal', expect=nn)
        if hi:
            # muntins
            box(g, (SIDE_WIN['x'], (SIDE_WIN['y0'] + SIDE_WIN['y1']) / 2, z + zs * 0.02), (0.05, SIDE_WIN['y1'] - SIDE_WIN['y0'], 0.04), 'trim')
            box(g, (SIDE_WIN['x'], (SIDE_WIN['y0'] + SIDE_WIN['y1']) / 2 + 0.15, z + zs * 0.02), (x1 - x0, 0.05, 0.04), 'trim')

    # a small lit attic window high in the front gable
    ay0, ay1, ah = 5.0, 6.0, 0.5
    g.poly([Vector((-0.02, ay0, -ah)), Vector((-0.02, ay0, ah)), Vector((-0.02, ay1, ah)), Vector((-0.02, ay1, -ah))], 'glass_lit',
           uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], expect=(-1, 0, 0))
    box(g, (-0.05, ay0 - 0.05, 0), (0.12, 0.1, 2 * ah + 0.3), 'trim')
    box(g, (-0.04, ay1 + 0.05, 0), (0.1, 0.1, 2 * ah + 0.24), 'trim')
    for zz in (-ah - 0.06, ah + 0.06):
        box(g, (-0.04, (ay0 + ay1) / 2, zz), (0.1, ay1 - ay0, 0.12), 'trim')

    # -- the open window: reveals through the wall, a deep sill, the frame, shutters swung open, a flower box --
    z0, z1, y0, y1 = WIN['z0'], WIN['z1'], WIN['y0'], WIN['y1']
    # reveals (the wall's thickness, painted)
    g.poly([Vector((0, y0, z0)), Vector((0, y0, z1)), Vector((WALL, y0, z1)), Vector((WALL, y0, z0))], 'reveal', expect=(0, 1, 0))
    g.poly([Vector((0, y1, z0)), Vector((WALL, y1, z0)), Vector((WALL, y1, z1)), Vector((0, y1, z1))], 'reveal', expect=(0, -1, 0))
    g.poly([Vector((0, y0, z0)), Vector((WALL, y0, z0)), Vector((WALL, y1, z0)), Vector((0, y1, z0))], 'reveal', expect=(0, 0, 1))
    g.poly([Vector((0, y0, z1)), Vector((0, y1, z1)), Vector((WALL, y1, z1)), Vector((WALL, y0, z1))], 'reveal', expect=(0, 0, -1))
    # casing round the opening, a projecting sill below, a crown above
    box(g, (-0.04, y0 - 0.07, 0), (0.24, 0.1, z1 - z0 + 0.5), 'trim')
    box(g, (-0.03, y1 + 0.09, 0), (0.1, 0.16, z1 - z0 + 0.36), 'trim')
    box(g, (-0.06, y1 + 0.2, 0), (0.18, 0.06, z1 - z0 + 0.5), 'trim')
    for zz in (z0 - 0.08, z1 + 0.08):
        box(g, (-0.03, (y0 + y1) / 2, zz), (0.1, y1 - y0, 0.16), 'trim')
    # shutters: hinged at the casing, swung open flat against the wall either side (no glass anywhere)
    sw = (z1 - z0) / 2
    for zs in (-1, 1):
        zc = (z1 + 0.16 + sw / 2 + 0.02) if zs > 0 else (z0 - 0.16 - sw / 2 - 0.02)
        box(g, (-0.06, (y0 + y1) / 2, zc), (0.05, y1 - y0 + 0.02, sw), 'shutter')
        if hi:
            for k in range(9):
                yy = y0 + 0.15 + k * ((y1 - y0 - 0.3) / 8)
                box(g, (-0.095, yy, zc), (0.025, 0.035, sw - 0.12), 'shutter')
            box(g, (-0.075, y0 + 0.08, zc), (0.03, 0.1, sw - 0.02), 'shutter')
            box(g, (-0.075, y1 - 0.08, zc), (0.03, 0.1, sw - 0.02), 'shutter')
    # the flower box under the sill, on brackets; a row of flowers and leaves in it
    pb_y = y0 - 0.42
    box(g, (-0.28, pb_y, 0), (0.42, 0.3, z1 - z0 + 0.2), 'planter')
    if hi:
        for zz in (z0 + 0.25, z1 - 0.25):
            box(g, (-0.12, pb_y - 0.2, zz), (0.2, 0.12, 0.05), 'planter')
        rng = np.random.default_rng(5)
        for k in range(16):
            zz = z0 + 0.05 + (z1 - z0 - 0.1) * (k + rng.random() * 0.6) / 16
            c = (-0.28 + (rng.random() - 0.5) * 0.18, pb_y + 0.2 + rng.random() * 0.1, zz)
            r = 0.08 + rng.random() * 0.05
            sph(g, c, r, 'flowers' if k % 3 else 'leaf', 1)
    else:
        box(g, (-0.28, pb_y + 0.2, 0), (0.36, 0.14, z1 - z0 + 0.1), 'flowers', skip=('-y',))
    # the porch lantern beside the window: a bracket, a black frame, a warm bulb
    lz = z1 + 0.16 + sw + 0.55
    ly = y1 + 0.2
    bar(g, (-0.0, ly, lz), (-0.22, ly, lz), 0.025, 5, 'lantern')
    box(g, (-0.24, ly - 0.24, lz), (0.2, 0.04, 0.2), 'lantern')
    box(g, (-0.24, ly + 0.02, lz), (0.22, 0.05, 0.22), 'lantern')
    lathe(g, (-0.24, ly + 0.04, lz), (0, 1, 0), [(0.14, 0), (0.05, 0.12), (0.001, 0.14)], 8, 'lantern', frame=(Vector((1, 0, 0)), Vector((0, 0, 1))))
    bulb = T.Geo('bulb')
    box(bulb, (-0.24, ly - 0.11, lz), (0.15, 0.22, 0.15), 'bulb')
    g.merge(bulb)

    # -- corner boards and a frieze under the eaves -----------------------------------------------------------
    for xx in (0.0, DEPTH):
        for zs in (-1, 1):
            box(g, (xx + (-0.04 if xx == 0 else 0.04), (FOUND + EAVE) / 2, zs * (HALF + 0.04)), (0.12, EAVE - FOUND, 0.12), 'trim')
    for zs in (-1, 1):
        box(g, (DEPTH / 2, EAVE - 0.1, zs * (HALF + 0.03)), (DEPTH, 0.2, 0.06), 'trim')

    # -- roof: two pitched planes with overhangs, a ridge cap, fascias and barge boards, soffits ------------------
    rx0, rx1 = -OVER_GABLE, DEPTH + OVER_GABLE
    for zs in (-1, 1):
        ze = zs * (HALF + OVER_EAVE)
        ye = EAVE - OVER_EAVE * math.tan(PITCH)
        # top surface
        n = Vector((0, math.cos(PITCH), zs * math.sin(PITCH)))
        th = 0.12
        top = [Vector((rx0, ye + th, ze)), Vector((rx1, ye + th, ze)), Vector((rx1, RIDGE + th, 0)), Vector((rx0, RIDGE + th, 0))]
        if hi:
            # shingle courses: each course steps out a little at its lower edge
            courses = 18
            for k in range(courses):
                a = k / courses
                b = (k + 1) / courses
                pa = top[0].lerp(top[3], a)
                pb = top[0].lerp(top[3], b)
                lift = n * 0.025
                g.poly([pa + lift, Vector((rx1, pa.y, pa.z)) + lift, Vector((rx1, pb.y, pb.z)), pb], 'roof',
                       uvs=[(0.02, 0.1), (0.98, 0.1), (0.98, 0.9), (0.02, 0.9)], expect=n)
                g.poly([pa, Vector((rx1, pa.y, pa.z)), Vector((rx1, pa.y, pa.z)) + lift, pa + lift], 'dark', expect=Vector((0, -math.sin(PITCH), zs * math.cos(PITCH))))
        else:
            g.poly(top, 'roof', expect=n)
        # underside (soffit) and the eave's fascia
        bot = [Vector((rx0, ye, ze)), Vector((rx1, ye, ze)), Vector((rx1, RIDGE, 0)), Vector((rx0, RIDGE, 0))]
        g.poly(bot, 'soffit', expect=-n)
        g.poly([bot[0], bot[1], top[1], top[0]], 'trim', expect=(0, -0.3, zs))
        # barge boards along the gables
        for xx, nx in ((rx0, -1), (rx1, 1)):
            g.poly([Vector((xx, ye - 0.08, ze)), Vector((xx, RIDGE - 0.08, 0)), Vector((xx, RIDGE + th + 0.02, 0)), Vector((xx, ye + th + 0.02, ze))], 'trim', expect=(nx, 0, 0))
        # a gutter along the eave
        if hi:
            bar(g, (rx0 + 0.05, ye - 0.05, ze + zs * 0.06), (rx1 - 0.05, ye - 0.05, ze + zs * 0.06), 0.07, 8, 'gutter')
        else:
            box(g, (DEPTH / 2, ye - 0.05, ze + zs * 0.06), (DEPTH + 2 * OVER_GABLE - 0.1, 0.12, 0.12), 'gutter')
    # ridge cap
    box(g, (DEPTH / 2, RIDGE + 0.14, 0), (DEPTH + 2 * OVER_GABLE + 0.04, 0.1, 0.3), 'roof')
    # a downpipe at the back corner
    bar(g, (DEPTH - 0.2, EAVE - OVER_EAVE * math.tan(PITCH) - 0.05, HALF + OVER_EAVE * 0.7), (DEPTH - 0.2, 0.1, HALF + 0.12), 0.05, 6 if hi else 4, 'gutter')
    # the brick chimney through the north slope, near the back, with a cap
    cx, cz = DEPTH - 2.2, 1.9
    cy0 = EAVE + (HALF - cz - 0.4) * math.tan(PITCH) - 0.2
    box(g, (cx, (cy0 + RIDGE + 1.1) / 2, cz), (0.8, RIDGE + 1.1 - cy0, 0.8), 'brick', skip=('-y',))
    box(g, (cx, RIDGE + 1.16, cz), (0.96, 0.12, 0.96), 'stone')
    if hi:
        bar(g, (cx - 0.15, RIDGE + 1.2, cz), (cx - 0.15, RIDGE + 1.45, cz), 0.09, 8, 'brick')
        bar(g, (cx + 0.18, RIDGE + 1.2, cz), (cx + 0.18, RIDGE + 1.4, cz), 0.08, 8, 'brick')

    # -- shrubs at the gable's corners (HIGH: round clumps; LOW: one each) -------------------------------------
    rng = np.random.default_rng(9)
    for zs in (-1, 1):
        base = Vector((-0.7, 0, zs * (HALF - 0.6)))
        for k in range(5 if hi else 1):
            off = Vector(((rng.random() - 0.5) * 0.8, 0, (rng.random() - 0.5) * 0.8)) if hi else Vector()
            r = 0.55 + rng.random() * 0.25
            sph(g, base + off + Vector((0, r * 0.75, 0)), r, 'leaf', 1 if hi else 0)
    return parts


def sph(g, c, r, cell, subdiv):
    """A rough ball (icosahedron, subdivided once on HIGH), flattened a little."""
    import bmesh
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=subdiv + 1, radius=1.0)
    c = Vector(c)
    for f in tmp.faces:
        pts = [c + Vector((v.co.x * r, v.co.z * r * 0.8, v.co.y * r)) for v in f.verts]
        uvs = [(0.5 + 0.45 * v.co.x, 0.5 + 0.45 * v.co.z) for v in f.verts]
        g.poly(pts, cell, uvs=uvs, expect=(pts[0] + pts[1] + pts[2]) / 3 - c)
    tmp.free()


def paint(size):
    N = size // 4
    color = np.zeros((size, size, 3), np.float32)
    emis = np.zeros((size, size, 3), np.float32)
    rough = np.zeros((size, size), np.float32)
    T.SHAPE = (N, N)
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) / N
    noise = lambda sc, sd, o=4: T.vnoise(N, sc, sd, o)

    def put(cell, rgb, r, em=None):
        col, row = CELLS[cell]
        sl = (slice(row * N, (row + 1) * N), slice(col * N, (col + 1) * N))
        color[sl] = np.clip(rgb, 0, 1)
        rough[sl] = r
        if em is not None:
            emis[sl] = np.clip(em, 0, 1)

    def tint(rgb, n, amt):
        return np.stack([np.full((N, N), c / 255.0) for c in rgb], -1) * (1 + (n[..., None] - 0.5) * amt)

    # painted lap siding: the board shadow line at each board's lower edge, brush texture, a little grime low down
    board = (np.mod(yy * 3.0 / 0.22, 1))
    shade = 1 - 0.28 * np.clip(1 - board * 6, 0, 1) - 0.06 * board
    grain = noise(N / 60, 3, 2)[0:1, :].repeat(N, 0)
    siding = tint((132, 156, 168), noise(N / 4, 4), 0.1) * shade[..., None] * (0.97 + 0.06 * grain[..., None])
    put('siding', siding, 0.7)
    put('trim', tint((236, 234, 226), noise(N / 5, 5), 0.06), 0.55)
    # shingles: courses with staggered tabs, colour variation per tab
    course = np.floor(yy * 6)
    tab = np.floor(xx * 8 + 0.5 * np.mod(course, 2))
    rnd = np.random.default_rng(6).random((7, 10))
    var = rnd[course.astype(int) % 7, tab.astype(int) % 10]
    edge = (np.mod(yy * 6, 1) < 0.08) | (np.mod(xx * 8 + 0.5 * np.mod(course, 2), 1) < 0.02)
    roof = tint((58, 62, 70), noise(3, 7, 2), 0.35) * (0.85 + 0.3 * var[..., None]) * (1 - 0.5 * edge[..., None])
    put('roof', roof, 0.85)
    # fieldstone: cells of stone with mortar
    pts = np.random.default_rng(8).random((40, 2))
    d1 = np.full((N, N), 9.0)
    d2 = np.full((N, N), 9.0)
    idx = np.zeros((N, N), int)
    for i, (px, py) in enumerate(pts):
        d = np.sqrt((xx - px) ** 2 + (yy - py) ** 2)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        idx = np.where(closer, i, idx)
        d1 = np.where(closer, d, d1)
    mortar = (d2 - d1) < 0.018
    sv = np.random.default_rng(11).random(40)[idx]
    stone = tint((128, 122, 112), noise(N / 10, 12), 0.3) * (0.8 + 0.35 * sv[..., None])
    stone = np.where(mortar[..., None], np.array([0.62, 0.6, 0.56]), stone)
    put('stone', stone, 0.9)
    # brick: running bond
    brow = np.floor(yy * 12)
    bx = np.mod(xx * 4 + 0.5 * np.mod(brow, 2), 1)
    bmortar = (np.mod(yy * 12, 1) < 0.12) | (bx < 0.04)
    bvar = np.random.default_rng(13).random((12, 6))[brow.astype(int) % 12, np.floor(xx * 4 + 0.5 * np.mod(brow, 2)).astype(int) % 6]
    brick = tint((150, 66, 48), noise(N / 8, 14), 0.25) * (0.8 + 0.35 * bvar[..., None])
    put('brick', np.where(bmortar[..., None], np.array([0.7, 0.67, 0.62]), brick), 0.9)
    # a lit window: warm room light behind four panes, a lamp's glow low on one side
    frame = (xx < 0.05) | (xx > 0.95) | (yy < 0.05) | (yy > 0.95) | (np.abs(xx - 0.5) < 0.02) | (np.abs(yy - 0.42) < 0.02)
    warm = 0.55 + 0.45 * np.exp(-(((xx - 0.32) / 0.3) ** 2 + ((yy - 0.62) / 0.35) ** 2))
    glass = np.stack([warm * 1.0, warm * 0.74, warm * 0.46], -1)
    put('glass_lit', np.where(frame[..., None], np.array([0.9, 0.9, 0.87]), glass * 0.4), 0.1,
        np.where(frame[..., None], 0.0, glass * 0.9))
    sl = (np.mod(yy * 10, 1) < 0.5)
    put('shutter', tint((44, 82, 70), noise(N / 6, 15), 0.2) * (0.85 + 0.2 * sl[..., None]), 0.6)
    put('planter', tint((118, 82, 56), noise(N / 30, 16, 2), 0.35), 0.8)
    fl = noise(N / 10, 17, 2)
    hue = np.random.default_rng(18).random((8, 8))[np.floor(yy * 8).astype(int), np.floor(xx * 8).astype(int)]
    pal = np.array([[0.92, 0.36, 0.44], [0.98, 0.78, 0.3], [0.95, 0.95, 0.9], [0.7, 0.42, 0.85]])
    flowers = pal[(hue * 4).astype(int) % 4] * (0.75 + 0.4 * fl[..., None])
    leaves = tint((62, 104, 54), fl, 0.6)
    put('flowers', np.where((fl > 0.5)[..., None], flowers, leaves), 0.8)
    put('leaf', tint((58, 98, 52), noise(N / 12, 19, 3), 0.7), 0.85)
    put('lantern', tint((28, 28, 30), noise(N / 6, 20), 0.2), 0.4)
    put('bulb', np.full((N, N, 3), (1.0, 0.85, 0.6)), 0.2, np.full((N, N, 3), (1.0, 0.78, 0.45)))
    put('gutter', tint((214, 214, 208), noise(N / 6, 21), 0.08), 0.4)
    put('soffit', tint((222, 218, 206), noise(N / 6, 22), 0.08), 0.8)
    put('reveal', tint((226, 222, 210), noise(N / 6, 23), 0.08), 0.7)
    put('dark', np.full((N, N, 3), 0.08), 0.9)
    return color, emis, rough


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--render', help='write a Cycles preview of both tiers here')
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
    os.makedirs(args.out, exist_ok=True)
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    use_atlas()
    color, emis, rough = paint(1024)
    maps = {}
    for tag, size in (('house', 1024), ('house-lean', 512)):
        for k, a in (('color', color), ('emissive', emis)):
            im = T.to_img(a)
            if size != 1024:
                im = im.resize((size, size), Image.LANCZOS)
            path = os.path.join(args.out, f'{tag}-{k}.webp')
            im.save(path, 'WEBP', quality=88, method=6)
            if tag == 'house':
                maps[k] = path
    manifest = {'units': 'world units; Y up; origin on the ground at the middle of the window wall\'s outer face; +x into the house',
                'window': WIN, 'wall': WALL, 'depth': DEPTH, 'half': HALF, 'eave': EAVE, 'ridge': RIDGE, 'side_window': SIDE_WIN,
                'tiers': {}}
    for tier, hi in (('high', True), ('low', False)):
        T.clear()
        parts = build(hi)
        root = bpy.data.objects.new('house_root', None)
        bpy.context.scene.collection.objects.link(root)
        objs = [root, T.make_object(parts['house'], 'house', root)]
        name = 'house.glb' if hi else 'house-lean.glb'
        T.export(objs, os.path.join(args.out, name))
        manifest['tiers'][tier] = {'file': name, 'tris': parts['house'].tris(),
                                   'maps': [f'{"house" if hi else "house-lean"}-color.webp', f'{"house" if hi else "house-lean"}-emissive.webp']}
        print(f'{tier}: {parts["house"].tris()} tris')
    T.clear()
    with open(os.path.join(args.out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
        f.write('\n')
    with open(os.path.join(args.out, 'CREDITS.md'), 'w') as f:
        f.write('# Recipient\'s house\n\nModelled procedurally by `blender/make_recipient_room.py` (this repository); the atlas is painted '
                'by the same script. No third-party assets. The room inside is the engine\'s (src/webgl/actors/RecipientRoom.ts).\n')
    print(f'done in {time.time() - t0:.0f}s')
    if args.render:
        os.makedirs(args.render, exist_ok=True)
        for hi, dz in ((True, 7.5), (False, -7.5)):
            parts = build(hi)
            root = bpy.data.objects.new('house_root', None)
            bpy.context.scene.collection.objects.link(root)
            T.make_object(parts['house'], 'house', root)
            root.location = T.bl((0, 0, dz))
        render(args.render, maps)


def render(out, maps):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1200, 750
    world = bpy.data.worlds.new('dawn')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.62, 0.55, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.0
    sun.color = (1.0, 0.86, 0.7)
    so = bpy.data.objects.new('sun', sun)
    scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(62), 0, math.radians(-120))
    ground = bpy.data.meshes.new('ground')
    ground.from_pydata([(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [], [(0, 1, 2, 3)])
    go = bpy.data.objects.new('ground', ground)
    scene.collection.objects.link(go)
    gm = bpy.data.materials.new('grass')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.2, 0.28, 0.14, 1)
    ground.materials.append(gm)
    imgs = {k: bpy.data.images.load(p) for k, p in maps.items()}
    m = bpy.data.materials.get('house')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = imgs['color']
    nt.links.new(tex.outputs[0], bsdf.inputs['Base Color'])
    et = nt.nodes.new('ShaderNodeTexImage')
    et.image = imgs['emissive']
    nt.links.new(et.outputs[0], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 3.0
    bsdf.inputs['Roughness'].default_value = 0.7
    cam = bpy.data.cameras.new('cam')
    cam.lens = 32
    co = bpy.data.objects.new('cam', cam)
    scene.collection.objects.link(co)
    scene.camera = co
    # Blender coords (x, -z, y): the two houses at z +-7.5, seen from down the flight line (-x) and above
    co.location = (-22, 0, 9)
    look = Vector((4, 0, 3))
    co.rotation_euler = (look - Vector(co.location)).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(out, 'house-both.png')
    bpy.ops.render.render(write_still=True)
    print('rendered', scene.render.filepath)


if __name__ == '__main__':
    main()
