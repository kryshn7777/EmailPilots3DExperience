"""Builds the ending's communications tower (docs/ending.md): two tiers and their atlas.

    python blender/make_comm_tower.py                  # writes public/models/comm-tower/*
    python blender/make_comm_tower.py --render DIR     # ...and a Cycles preview sheet of both tiers
    python blender/make_comm_tower.py --debug DIR      # ...and the atlas maps as PNGs
    npm run compress:models                            # then meshopt-pack the two GLBs

The network's relay hub at the end of the runway: a 4-leg tapered lattice (9 wide at the foot, 3 at the top of
the steel, 24 high) of galvanised round legs and angle-iron bracing, red/white aviation banding on its top third,
concrete footings, a glass relay hall at the foot with server racks and a cable tray, three equipment cabins
with lit window bands (8 / 15 / 21), a gallery at 21.4 carrying six drum dishes on yaw pivots, the main dish on
top aimed +x and 35 degrees up, a mast with red beacons, a cable ladder-tray and a caged climbing ladder.
Down its core runs the glass relay tube the dart rides: a bell-mouth intake facing -x at the dart's height
(y 1.6) inside the hall, one quarter bend up, a straight leaning 1 degree forward, and one bend into the main
dish's feed. The tube's path is read from src/webgl/rig/endingPoints.mjs (the flight line), so the model and
the line cannot drift apart.

Two tiers from the same description: HIGH (tower.glb: round legs with flanges, angle-iron bracing with
gussets, railings, ladder cage, panel antennas, about 50k triangles) and LOW (tower-lean.glb: the lean truss,
square members, no small parts, under 10k). Both share one atlas layout: tower-color/-emissive/-orm.webp at
2048 for HIGH, tower-lean-color/-emissive.webp at 1024 for LOW, painted procedurally here (galvanised zinc
spangle and white-rust runs, chalky aviation paint, concrete, ribbed cabin cladding, lit windows, rack LEDs,
the radome fabric, the dish panels).

Nodes (glTF, metres, Y up, origin = the tube's axis on the ground, +x = down the runway, toward the house):
  tower_root           the whole tower (Empty)
    lattice            everything static that shares the atlas (mesh)
    cabin_glow_1..3    the cabins' window bands (mesh), flashed as the light passes
    rack_glow          the hall's rack fronts (mesh), intake_glow the bell-mouth's lit throat ring (mesh)
    beacon_1..4        the red aviation beacons (mesh)
    dish_main          the main dish's elevation pivot (Empty) -> dish_main_mesh
    dish_1..6          the drum dishes' yaw pivots (Empty) -> dish_<n>_mesh
    tube               the glass relay tube and its bell-mouth (mesh, material `tube`; uv.y = 0..1 along it)
    hall_glass         the relay hall's glazing (mesh, material `hall_glass`)
    intake             Empty at the bell-mouth's throat, +x into the tube
    tube_top           Empty at the main dish's feed, where the dart leaves
The engine (src/webgl/actors/CommTower.ts) merges these by material into 3 draws on HIGH (tower, tube,
hall glass) and 2 on LOW (tower, glass), keeping each named part's id per vertex so it can still turn the dishes
and flash the cabins, beacons and racks in the shader. manifest.json lists the parts, their pivots and the
solids the flight line and the ending camera are checked against (scripts/check-ending.mjs).
"""
import argparse
import json
import math
import os
import subprocess
import sys
import time


import bpy
import numpy as np
from mathutils import Matrix, Vector
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'comm-tower')
DEG = math.pi / 180

# ------------------------------------------------------------------------------------------------
# layout (tower-local, Y up; x toward the house, z across the runway)
# ------------------------------------------------------------------------------------------------

STEEL_TOP = 24.0      # top of the lattice
BASE_HALF = 4.5       # half width at the ground
TOP_HALF = 1.5        # half width at STEEL_TOP
GIRTS = [0.0, 4.2, 7.0, 9.8, 12.2, 14.2, 16.4, 18.4, 20.0, 21.4, 22.7, STEEL_TOP]
BAND_FROM = 16.0      # red/white banding from here up (the top third of the steel)
BAND_H = 2.0
HALL = dict(x0=-3.4, x1=3.4, z0=-3.4, z1=3.4, y0=0.25, y1=3.8)
CABINS = [  # centre y, half size, height
    dict(y=8.4, half=2.55, h=2.4),
    dict(y=15.3, half=1.85, h=2.1),
    dict(y=20.7, half=1.45, h=1.3),
]
GALLERY_Y = 21.4
GALLERY_HALF = 2.9
MAST_TOP = 30.6
TUBE_R = 1.0          # the glass relay tube (the dart's span is 1.48)
BELL_R = 1.42         # the bell-mouth's lip (its rolled edge clears the pad at y 1.6 - 1.42 - 0.12)
BELL_LEN = 2.3        # how far the bell flares out west of the throat
MAIN_DISH_R = 2.35
DRUMS = [  # angle round the tower (deg from +x, toward +z), radius, initial yaw offset from outward (deg)
    (28, 2.75, 24), (-30, 2.75, -38), (76, 2.75, 52), (-78, 2.75, -20), (118, 2.65, 40), (-116, 2.65, -60),
]
DRUM_R = 0.72
DRUM_D = 0.5


def half_w(y):
    return BASE_HALF + (TOP_HALF - BASE_HALF) * (y / STEEL_TOP)


def line_layout():
    """The tube's path in tower-local coordinates, from the flight line itself (endingPoints.mjs)."""
    js = ("import('./src/webgl/rig/endingPoints.mjs').then(m => console.log(JSON.stringify("
          "{ TUBE: m.TUBE, TOWER: m.TOWER, LOW_Y: m.LOW_Y })))")
    out = subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    d = json.loads(out)
    tx = d['TOWER'][0]
    loc = lambda p: (p[0] - tx, p[1])
    t = d['TUBE']
    return dict(mouth=loc(t['mouth']), foot=loc(t['foot']), top=loc(t['top']), exit=loc(t['exit']),
                bend=t['radius'], lean=t['lean'], pitch=t['exitPitch'], low=d['LOW_Y'], tower_x=tx)


def tube_path(L, step):
    """Points (x, y, pitch, s) along the tube's centreline: the bell (west of the throat), the quarter bend, the
    straight and the feed bend, ending at the dish's feed. `s` is arc length from the bell's lip."""
    pts = []
    mx, my = L['mouth']
    R = L['bend']
    # the bell: a straight run west of the throat
    n = max(2, int(BELL_LEN / step))
    for i in range(n + 1):
        pts.append((mx - BELL_LEN + BELL_LEN * i / n, my, 0.0))
    # quarter bend: centre (mx, my + R), pitch 0 -> 90 - lean
    p_end = math.pi / 2 - L['lean']
    n = max(4, int(R * p_end / (step * 0.5)))
    for i in range(1, n + 1):
        p = p_end * i / n
        pts.append((mx + R * math.sin(p), my + R - R * math.cos(p), p))
    # the straight
    fx, fy = L['foot']
    tx, ty = L['top']
    ln = math.hypot(tx - fx, ty - fy)
    n = max(2, int(ln / step))
    for i in range(1, n + 1):
        pts.append((fx + (tx - fx) * i / n, fy + (ty - fy) * i / n, p_end))
    # the feed bend: pitch p_end -> exit pitch, turning toward +x (centre to the right of the motion)
    cx = tx + R * math.sin(p_end)
    cy = ty - R * math.cos(p_end)
    n = max(4, int(R * (p_end - L['pitch']) / (step * 0.5)))
    for i in range(1, n + 1):
        p = p_end + (L['pitch'] - p_end) * i / n
        pts.append((cx - R * math.sin(p), cy + R * math.cos(p), p))
    out = []
    s = 0.0
    for i, (x, y, p) in enumerate(pts):
        if i:
            s += math.hypot(x - pts[i - 1][0], y - pts[i - 1][1])
        out.append((x, y, p, s))
    return out


# ------------------------------------------------------------------------------------------------
# atlas: 8 x 8 cells; each face maps into one cell
# ------------------------------------------------------------------------------------------------

# the atlas is 8 columns by 4 rows of cells twice as tall as they are wide: a member's length runs along v
CELL_COLS = 8
CELL_ROWS = 4
ASPECT = 2.0
CELLS = {
    'galv': (0, 0), 'galv2': (1, 0), 'red': (2, 0), 'white': (3, 0), 'concrete': (4, 0), 'pad': (5, 0),
    'grate': (6, 0), 'dark': (7, 0),
    'cabin_wall': (0, 1), 'cabin_window': (1, 1), 'cabin_roof': (2, 1), 'louvre': (3, 1), 'hall_frame': (4, 1),
    'hall_floor': (5, 1), 'rack': (6, 1), 'rack_side': (7, 1),
    'tray': (0, 2), 'cable': (1, 2), 'dish_white': (2, 2), 'dish_back': (3, 2), 'radome': (4, 2),
    'mouth_metal': (5, 2), 'mouth_glow': (6, 2), 'beacon': (7, 2),
    'feed_glow': (0, 3), 'antenna': (1, 3), 'hazard': (2, 3), 'ac_unit': (3, 3), 'plinth': (4, 3),
    'glass': (5, 3), 'roof_hall': (6, 3), 'tube': (7, 3),
}
# world size one cell spans when a face is mapped at its true size (larger faces are scaled to fit)
TILE = {'galv': 2.5, 'galv2': 2.5, 'red': 2.5, 'white': 2.5, 'concrete': 3.0, 'pad': 14.0, 'grate': 3.0,
        'dark': 2.0, 'cabin_wall': 5.2, 'cabin_roof': 5.6, 'louvre': 1.0, 'hall_frame': 3.0, 'hall_floor': 7.0,
        'rack': 1.0, 'rack_side': 1.0, 'tray': 2.0, 'cable': 2.0, 'dish_white': 1.0, 'dish_back': 2.0,
        'radome': 1.0, 'mouth_metal': 1.0, 'mouth_glow': 1.0, 'beacon': 1.0, 'feed_glow': 1.0, 'antenna': 1.6,
        'hazard': 2.0, 'ac_unit': 1.0, 'plinth': 7.0, 'glass': 3.0, 'roof_hall': 7.0, 'tube': 1.0}
INSET = 0.035
ATLAS = dict(cells=CELLS, tile=TILE, cols=CELL_COLS, rows=CELL_ROWS, aspect=ASPECT)


def cell_uv(cell, u, v):
    """(u, v) in 0..1 of a cell -> Blender UV (origin bottom-left; the atlas image's row 0 is the top)."""
    col, row = ATLAS['cells'][cell]
    CELL_COLS, CELL_ROWS, ASPECT = ATLAS['cols'], ATLAS['rows'], ATLAS['aspect']
    uu = (col + INSET + u * (1 - 2 * INSET)) / CELL_COLS
    vv = 1.0 - (row + INSET / ASPECT + (1 - v) * (1 - 2 * INSET / ASPECT)) / CELL_ROWS
    return (uu, vv)


# ------------------------------------------------------------------------------------------------
# geometry accumulation (tower-local Y-up; converted to Blender's Z-up at the end)
# ------------------------------------------------------------------------------------------------

class Geo:
    def __init__(self, name):
        self.name = name
        self.v = []
        self.faces = []  # (indices, uvs, smooth)

    def poly(self, pts, cell, uvs=None, smooth=False, expect=None, raw=False):
        pts = [Vector(p) for p in pts]
        if expect is not None:
            n = Vector()
            for i, a in enumerate(pts):
                b = pts[(i + 1) % len(pts)]
                n.x += (a.y - b.y) * (a.z + b.z)
                n.y += (a.z - b.z) * (a.x + b.x)
                n.z += (a.x - b.x) * (a.y + b.y)
            if n.dot(Vector(expect)) < 0:
                pts.reverse()
                if uvs is not None:
                    uvs = list(reversed(uvs))
        if uvs is None:
            uvs = planar_uv(pts, ATLAS['tile'].get(cell, 2.0))
        base = len(self.v)
        self.v.extend(pts)
        self.faces.append((list(range(base, base + len(pts))), list(uvs) if raw else [cell_uv(cell, u, v) for u, v in uvs], smooth))

    def tris(self):
        return sum(len(f[0]) - 2 for f in self.faces)

    def merge(self, other):
        base = len(self.v)
        self.v.extend(other.v)
        for idx, uvs, sm in other.faces:
            self.faces.append(([i + base for i in idx], uvs, sm))


def planar_uv(pts, tile):
    a, b, c = pts[0], pts[1], pts[2]
    n = (b - a).cross(c - a)
    if n.length < 1e-9:
        n = Vector((0, 1, 0))
    n.normalize()
    if abs(n.y) > 0.7:
        e1, e2 = Vector((1, 0, 0)), Vector((0, 0, 1))
    else:
        e1 = Vector((0, 1, 0)).cross(n)
        e1.normalize()
        e2 = n.cross(e1)
    cs = [(p.dot(e1), p.dot(e2)) for p in pts]
    # the longer extent runs along the cell's v (which is ASPECT times longer)
    if max(c[0] for c in cs) - min(c[0] for c in cs) > max(c[1] for c in cs) - min(c[1] for c in cs):
        cs = [(c[1], c[0]) for c in cs]
    u0 = min(c[0] for c in cs)
    v0 = min(c[1] for c in cs)
    su = max(c[0] for c in cs) - u0
    sv = max(c[1] for c in cs) - v0
    tu, tv = tile, tile * ATLAS['aspect']
    k = 1.0 / max(1.0, su / tu, sv / tv)
    if sv > tv * 1.5 and su <= tu:
        # a member longer than the cell is squeezed along its length only (keeps its width's texel density)
        return [((c[0] - u0) / tu, (c[1] - v0) / sv) for c in cs]
    return [((c[0] - u0) * k / tu, (c[1] - v0) * k / tv) for c in cs]


def frame_of(d):
    """Two unit vectors perpendicular to direction d."""
    d = Vector(d).normalized()
    up = Vector((0, 1, 0)) if abs(d.y) < 0.95 else Vector((1, 0, 0))
    e1 = d.cross(up).normalized()
    e2 = e1.cross(d).normalized()
    return e1, e2


def bar(g, p0, p1, r, sides, cell, caps=True, smooth=True, r1=None, phase=0.0, frame=None):
    """A prism (or a cone frustum) along p0 -> p1, `sides` sides of circumradius r (r1 at p1)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    ln = d.length
    if ln < 1e-6:
        return
    e1, e2 = frame or frame_of(d)
    r1 = r if r1 is None else r1
    ring = lambda c, rad: [c + (e1 * math.cos(phase + 2 * math.pi * i / sides) + e2 * math.sin(phase + 2 * math.pi * i / sides)) * rad for i in range(sides)]
    a, b = ring(p0, r), ring(p1, r1)
    tile = ATLAS['tile'].get(cell, 2.0) * ATLAS['aspect']
    vlen = min(1.0, ln / tile) if ln < tile * 1.5 else 1.0
    for i in range(sides):
        j = (i + 1) % sides
        u0, u1 = i / sides, (i + 1) / sides
        mid = (a[i] + a[j]) * 0.5 - p0
        g.poly([a[i], a[j], b[j], b[i]], cell, uvs=[(u0, 0), (u1, 0), (u1, vlen), (u0, vlen)], smooth=smooth, expect=mid)
    if caps:
        g.poly(list(reversed(a)), cell, expect=-d)
        g.poly(b, cell, expect=d)


def angle_iron(g, p0, p1, a, t, out, cell):
    """An L-section member p0 -> p1, flanges `a` wide and `t` thick, its heel toward `out`."""
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0).normalized()
    o = Vector(out)
    o = (o - d * o.dot(d))
    if o.length < 1e-6:
        o = frame_of(d)[0]
    o.normalize()
    side = d.cross(o).normalized()
    # heel at the axis offset toward `out`; flanges run inward (-o) and sideways (+/-side) from it
    e1 = (-o + side).normalized()
    e2 = (-o - side).normalized()
    heel = o * (a * 0.35)
    sec = [heel, heel + e1 * a, heel + e1 * a + e2 * t, heel + e2 * t + e1 * t, heel + e2 * a + e1 * t, heel + e2 * a]
    A = [p0 + s for s in sec]
    B = [p1 + s for s in sec]
    n = len(sec)
    for i in range(n):
        j = (i + 1) % n
        mid = (sec[i] + sec[j]) * 0.5 - (heel + (e1 + e2) * (a * 0.3))
        g.poly([A[i], A[j], B[j], B[i]], cell, expect=mid)
    g.poly(list(reversed(A)), cell, expect=-d)
    g.poly(B, cell, expect=d)


def box(g, c, size, cell, skip=(), yaw=0.0, cells=None):
    """Axis box (yawed about Y) centred at c with full size (sx, sy, sz). `cells` overrides per face key."""
    cx, cy, cz = c
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    cs, sn = math.cos(yaw), math.sin(yaw)
    P = lambda x, y, z: Vector((cx + x * cs + z * sn, cy + y, cz - x * sn + z * cs))
    R = lambda x, y, z: Vector((x * cs + z * sn, y, -x * sn + z * cs))
    faces = {
        '+x': ([P(sx, -sy, -sz), P(sx, -sy, sz), P(sx, sy, sz), P(sx, sy, -sz)], R(1, 0, 0)),
        '-x': ([P(-sx, -sy, sz), P(-sx, -sy, -sz), P(-sx, sy, -sz), P(-sx, sy, sz)], R(-1, 0, 0)),
        '+z': ([P(sx, -sy, sz), P(-sx, -sy, sz), P(-sx, sy, sz), P(sx, sy, sz)], R(0, 0, 1)),
        '-z': ([P(-sx, -sy, -sz), P(sx, -sy, -sz), P(sx, sy, -sz), P(-sx, sy, -sz)], R(0, 0, -1)),
        '+y': ([P(-sx, sy, -sz), P(sx, sy, -sz), P(sx, sy, sz), P(-sx, sy, sz)], R(0, 1, 0)),
        '-y': ([P(-sx, -sy, sz), P(sx, -sy, sz), P(sx, -sy, -sz), P(-sx, -sy, -sz)], R(0, -1, 0)),
    }
    for k, (pts, n) in faces.items():
        if k in skip:
            continue
        g.poly(pts, (cells or {}).get(k, cell), expect=n)


def disc(g, c, n, r, segs, cell, uv_polar=True):
    """A flat disc facing n."""
    c = Vector(c)
    e1, e2 = frame_of(n)
    pts = [c + (e1 * math.cos(2 * math.pi * i / segs) + e2 * math.sin(2 * math.pi * i / segs)) * r for i in range(segs)]
    uvs = [(0.5 + 0.5 * math.cos(2 * math.pi * i / segs), 0.5 + 0.5 * math.sin(2 * math.pi * i / segs)) for i in range(segs)]
    g.poly(pts, cell, uvs=uvs, expect=n)


def plate_with_hole(g, c, n, e_u, e_v, hu, hv, r, segs, cell):
    """A flat rectangular plate (half sizes hu, hv along e_u, e_v) centred on c, facing n, with a round hole of
    radius r: quads from the circle out to the rectangle along rays from the centre."""
    c, e_u, e_v = Vector(c), Vector(e_u), Vector(e_v)

    def rect(a):
        ca, sa = math.cos(a), math.sin(a)
        k = min(hu / max(abs(ca), 1e-6), hv / max(abs(sa), 1e-6))
        return c + e_u * (ca * k) + e_v * (sa * k)
    for i in range(segs):
        a0 = 2 * math.pi * i / segs
        a1 = 2 * math.pi * (i + 1) / segs
        p0 = c + (e_u * math.cos(a0) + e_v * math.sin(a0)) * r
        p1 = c + (e_u * math.cos(a1) + e_v * math.sin(a1)) * r
        q0, q1 = rect(a0), rect(a1)
        g.poly([p0, p1, q1, q0], cell, expect=n)
        # a rectangle corner between the two rays needs its own triangle
        for cu, cv in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
            ac = math.atan2(cv * hv, cu * hu) % (2 * math.pi)
            if a0 < ac < a1:
                corner_p = c + e_u * (cu * hu) + e_v * (cv * hv)
                g.poly([q0, corner_p, q1], cell, expect=n)


def lathe(g, axis_c, axis_d, profile, segs, cell, smooth=True, v_range=(0, 1), frame=None, flip=False):
    """Revolve a profile [(radius, along)] about the axis; uv u around, v along the profile."""
    c = Vector(axis_c)
    d = Vector(axis_d).normalized()
    e1, e2 = frame or frame_of(d)
    rings = []
    for r, a in profile:
        rings.append([c + d * a + (e1 * math.cos(2 * math.pi * i / segs) + e2 * math.sin(2 * math.pi * i / segs)) * r for i in range(segs)])
    m = len(profile)
    for k in range(m - 1):
        v0 = v_range[0] + (v_range[1] - v_range[0]) * k / (m - 1)
        v1 = v_range[0] + (v_range[1] - v_range[0]) * (k + 1) / (m - 1)
        for i in range(segs):
            j = (i + 1) % segs
            quad = [rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]]
            uvs = [(i / segs, v0), ((i + 1) / segs, v0), ((i + 1) / segs, v1), (i / segs, v1)]
            ang = 2 * math.pi * (i + 0.5) / segs
            radial = e1 * math.cos(ang) + e2 * math.sin(ang)
            # outward normal of the surface of revolution (sign of the radius slope decides nothing here)
            dr = profile[k + 1][0] - profile[k][0]
            da = profile[k + 1][1] - profile[k][1]
            nrm = radial * da - d * dr
            if flip:
                nrm = -nrm
            g.poly(quad, cell, uvs=uvs, smooth=smooth, expect=nrm)


# ------------------------------------------------------------------------------------------------
# the tower
# ------------------------------------------------------------------------------------------------

def corner(y, sx, sz):
    w = half_w(y)
    return Vector((sx * w, y, sz * w))


def band_cell(y):
    if y < BAND_FROM:
        return 'galv'
    return 'red' if int((y - BAND_FROM) // BAND_H) % 2 == 0 else 'white'


CORNERS = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
FACES = {  # face name -> (corner a, corner b, outward)
    'east': ((1, -1), (1, 1), (1, 0, 0)),
    'north': ((1, 1), (-1, 1), (0, 0, 1)),
    'west': ((-1, 1), (-1, -1), (-1, 0, 0)),
    'south': ((-1, -1), (1, -1), (0, 0, -1)),
}


def build(hi, L):
    parts = {k: Geo(k) for k in ['lattice', 'rack_glow', 'intake_glow', 'cabin_glow_1', 'cabin_glow_2', 'cabin_glow_3',
                                  'beacon_1', 'beacon_2', 'beacon_3', 'beacon_4', 'dish_main', 'tube', 'hall_glass']}
    for i in range(1, 7):
        parts[f'dish_{i}'] = Geo(f'dish_{i}')
    G = parts['lattice']
    seg = 12 if hi else 6
    pivots = {}
    solids = []  # for check-ending: boxes {min, max, name} and segments {a, b, r, name}

    # -- ground: a gravel pad, the footings, the hall's plinth ------------------------------------------
    box(G, (0, -0.04, 0), (13.0, 0.12, 13.0), 'pad', skip=('-y',))
    for sx, sz in CORNERS:
        c = corner(0, sx, sz)
        if hi:
            # a stepped pier with a chamfered top, four anchor bolts and a base plate
            box(G, (c.x, 0.18, c.z), (1.5, 0.44, 1.5), 'concrete', skip=('-y',))
            box(G, (c.x, 0.52, c.z), (1.1, 0.26, 1.1), 'concrete', skip=('-y',))
            box(G, (c.x, 0.67, c.z), (0.62, 0.04, 0.62), 'galv2', skip=('-y',))
            for bx, bz in CORNERS:
                bar(G, (c.x + bx * 0.22, 0.65, c.z + bz * 0.22), (c.x + bx * 0.22, 0.78, c.z + bz * 0.22), 0.035, 6, 'galv2')
        else:
            box(G, (c.x, 0.33, c.z), (1.3, 0.72, 1.3), 'concrete', skip=('-y',))
        solids.append(dict(kind='box', name='footing', min=[c.x - 0.75, 0, c.z - 0.75], max=[c.x + 0.75, 0.8, c.z + 0.75]))
    h = HALL
    box(G, ((h['x0'] + h['x1']) / 2, h['y0'] / 2, 0), (h['x1'] - h['x0'] + 0.5, h['y0'], h['z1'] - h['z0'] + 0.5), 'plinth', skip=('-y',))
    if hi:
        # a hazard stripe on the plinth's west edge, under the intake
        box(G, (h['x0'] - 0.18, h['y0'] - 0.03, 0), (0.14, 0.06, 4.6), 'hazard', skip=('-y',))

    # -- legs ---------------------------------------------------------------------------------------------
    for sx, sz in CORNERS:
        for k in range(len(GIRTS) - 1):
            y0, y1 = GIRTS[k], GIRTS[k + 1]
            a, b = corner(max(y0, 0.7), sx, sz), corner(y1, sx, sz)
            r0 = 0.2 - 0.07 * (y0 / STEEL_TOP)
            r1 = 0.2 - 0.07 * (y1 / STEEL_TOP)
            cell = band_cell((y0 + y1) / 2)
            # a long panel in the band region is split at the band lines
            cuts = [y0] + [BAND_FROM + BAND_H * i for i in range(10) if y0 < BAND_FROM + BAND_H * i < y1] + [y1]
            for j in range(len(cuts) - 1):
                ya, yb = cuts[j], cuts[j + 1]
                pa = corner(max(ya, 0.7), sx, sz)
                pb = corner(yb, sx, sz)
                ra = 0.2 - 0.07 * (ya / STEEL_TOP)
                rb = 0.2 - 0.07 * (yb / STEEL_TOP)
                bar(G, pa, pb, ra, seg, band_cell((ya + yb) / 2), caps=False, r1=rb)
            if hi and k > 0:
                # bolted flange at the joint
                f = corner(y0, sx, sz)
                d = (b - a).normalized()
                bar(G, f - d * 0.05, f + d * 0.05, r0 + 0.09, seg, band_cell(y0), caps=True)
                for q in range(6):
                    ang = q * math.pi / 3
                    e1, e2 = frame_of(d)
                    bp = f + (e1 * math.cos(ang) + e2 * math.sin(ang)) * (r0 + 0.06)
                    bar(G, bp - d * 0.09, bp + d * 0.09, 0.022, 4, 'galv2')
        top = corner(STEEL_TOP, sx, sz)
        bar(G, top, top + Vector((0, 0.12, 0)), 0.15, seg, band_cell(STEEL_TOP - 0.1))
        solids.append(dict(kind='seg', name='leg', a=list(corner(0, sx, sz)), b=list(top), r=0.22))

    # -- bracing: a girt at every panel line, X-bracing in each face (portal at the foot, the dish mount at the top)
    def member(p0, p1, out, cell, big=False):
        if hi:
            angle_iron(G, p0, p1, 0.16 if big else 0.11, 0.022, out, cell)
        else:
            bar(G, p0, p1, 0.085 if big else 0.06, 4, cell, caps=False, smooth=False, phase=math.pi / 4)
        solids.append(dict(kind='seg', name='brace', a=list(p0), b=list(p1), r=0.1 if big else 0.08))

    for fname, (ca, cb, out) in FACES.items():
        for k in range(1, len(GIRTS)):
            y = GIRTS[k]
            if fname == 'east' and y >= GIRTS[-2]:
                continue  # the relay tube's feed bend and the main dish's vertex pass through here
            a, b = corner(y, *ca), corner(y, *cb)
            inset = (b - a).normalized() * 0.18
            member(a + inset, b - inset, out, band_cell(y), big=True)
        for k in range(len(GIRTS) - 1):
            y0, y1 = GIRTS[k], GIRTS[k + 1]
            if k == 0:
                # the portal: knee braces only, the hall stands in the opening
                for c0, c1 in ((ca, cb), (cb, ca)):
                    p = corner(y1 - 1.3, *c0)
                    q = corner(y1, *c0).lerp(corner(y1, *c1), 0.22)
                    member(p, q, out, band_cell(y1 - 0.6))
                continue
            if fname == 'east' and y0 >= GIRTS[-3]:
                continue  # the main dish's mount and the feed bend pass through here
            a0, b0 = corner(y0, *ca), corner(y0, *cb)
            a1, b1 = corner(y1, *ca), corner(y1, *cb)
            mid_y = (y0 + y1) / 2
            ins = lambda p, q: p.lerp(q, 0.04)
            member(ins(a0, b1), ins(b1, a0), out, band_cell(mid_y))
            member(ins(b0, a1), ins(a1, b0), out, band_cell(mid_y))
            if hi and (y1 - y0) > 2.0:
                # redundant members: a mid-height horizontal to the X's crossing, both sides
                m = (a0 + b1) * 0.5
                pa = (a0 + a1) * 0.5
                pb = (b0 + b1) * 0.5
                angle_iron(G, pa.lerp(m, 0.06), m, 0.07, 0.016, out, band_cell(mid_y))
                angle_iron(G, m, pb.lerp(m, 0.06), 0.07, 0.016, out, band_cell(mid_y))
            if hi:
                # gusset plates where the braces meet the legs
                for p, q in ((a0, b1), (b0, a1), (a1, b0), (b1, a0)):
                    d = (q - p).normalized()
                    gp = p + d * 0.32
                    box(G, (gp.x, gp.y, gp.z), (0.26 if abs(out[0]) < 0.5 else 0.03, 0.26, 0.26 if abs(out[2]) < 0.5 else 0.03),
                        band_cell(gp.y))
    # plan bracing (horizontal diagonals) at a few girts, clear of the tube
    for y in (9.8, 14.2, 18.4):
        for sx, sz in CORNERS:
            p = corner(y, sx, sz)
            q = p.lerp(Vector((0, y, 0)), 0.45)
            member(p, q, (0, -1, 0), band_cell(y))

    # -- the relay hall -----------------------------------------------------------------------------------
    HX0, HX1, HZ0, HZ1, HY0, HY1 = h['x0'], h['x1'], h['z0'], h['z1'], h['y0'], h['y1']
    box(G, ((HX0 + HX1) / 2, HY0 + 0.02, 0), (HX1 - HX0 - 0.1, 0.04, HZ1 - HZ0 - 0.1), 'hall_floor', skip=('-y',))
    # roof slab with a parapet; a hole for the tube is not cut (the tube passes through it visually at its core)
    roof_y = HY1
    box(G, ((HX0 + HX1) / 2, roof_y + 0.12, 0), (HX1 - HX0 + 0.3, 0.24, HZ1 - HZ0 + 0.3), 'roof_hall')
    if hi:
        for zz in (HZ0 - 0.1, HZ1 + 0.1):
            box(G, ((HX0 + HX1) / 2, roof_y + 0.36, zz), (HX1 - HX0 + 0.3, 0.24, 0.1), 'hall_frame')
        for xx in (HX0 - 0.1, HX1 + 0.1):
            box(G, (xx, roof_y + 0.36, 0), (0.1, 0.24, HZ1 - HZ0 + 0.3), 'hall_frame')
    # mullions and transoms
    mull = 0.09 if hi else 0.12
    bays = 4 if hi else 2
    glass = parts['hall_glass']
    for side in ('west', 'east', 'north', 'south'):
        if side in ('west', 'east'):
            x = HX0 if side == 'west' else HX1
            p0, p1 = Vector((x, 0, HZ0)), Vector((x, 0, HZ1))
            nrm = Vector((-1 if side == 'west' else 1, 0, 0))
        else:
            z = HZ1 if side == 'north' else HZ0
            p0, p1 = Vector((HX1, 0, z)), Vector((HX0, 0, z))
            nrm = Vector((0, 0, 1 if side == 'north' else -1))
        for i in range(bays + 1):
            p = p0.lerp(p1, i / bays)
            if side == 'west' and abs(p.z) < 1.35:
                # not across the bell's opening: the mullion stops at the infill
                box(G, (p.x, (HY0 + 2.7 + HY1) / 2, p.z), (mull, HY1 - HY0 - 2.7, mull), 'hall_frame')
                continue
            box(G, (p.x, (HY0 + HY1) / 2, p.z), (mull if side in ('west', 'east') else mull, HY1 - HY0, mull), 'hall_frame')
        for yy in (HY0 + 0.05, HY0 + 2.7, HY1 - 0.05):
            m = p0.lerp(p1, 0.5)
            ln = (p1 - p0).length
            box(G, (m.x, yy, m.z), (mull if side in ('west', 'east') else ln, 0.1, ln if side in ('west', 'east') else mull), 'hall_frame')
        # glazing, one pane per bay and storey (the west wall leaves the intake's opening)
        for i in range(bays):
            a, b = p0.lerp(p1, i / bays), p0.lerp(p1, (i + 1) / bays)
            for ya, yb in ((HY0 + 0.1, HY0 + 2.65), (HY0 + 2.75, HY1 - 0.1)):
                if side == 'west' and ya < L['low']:
                    # the bell-mouth passes the wall here (its radius is about 1.1 at the wall): a steel infill
                    # with a round hole takes these bays
                    za, zb = sorted((a.z, b.z))
                    if zb > -1.3 and za < 1.3:
                        continue
                off = nrm * 0.01
                glass.poly([a + off + Vector((0, ya, 0)), b + off + Vector((0, ya, 0)), b + off + Vector((0, yb, 0)), a + off + Vector((0, yb, 0))],
                           'glass', uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], expect=nrm)
                glass.poly([b - off + Vector((0, ya, 0)), a - off + Vector((0, ya, 0)), a - off + Vector((0, yb, 0)), b - off + Vector((0, yb, 0))],
                           'glass', uvs=[(1, 0), (0, 0), (0, 1), (1, 1)], expect=-nrm)
    # the west wall round the bell: a steel infill with a round hole, and a collar
    span = (HZ1 - HZ0) / bays
    nb = [i for i in range(bays) if (HZ0 + span * (i + 1)) > -1.3 and (HZ0 + span * i) < 1.3]
    iz0, iz1 = HZ0 + span * nb[0], HZ0 + span * (nb[-1] + 1)
    hv = min(L['low'] - HY0 - 0.1, HY0 + 2.65 - L['low'])
    for sgn in (1, -1):
        plate_with_hole(G, (HX0 - sgn * 0.02, L['low'], (iz0 + iz1) / 2), (-sgn, 0, 0), (0, 0, 1), (0, 1, 0), (iz1 - iz0) / 2,
                        hv, 1.2, 32 if hi else 12, 'hall_frame')
    top_gap = (HY0 + 2.65) - (L['low'] + hv)
    if top_gap > 0.01:
        box(G, (HX0, HY0 + 2.65 - top_gap / 2, (iz0 + iz1) / 2), (0.05, top_gap, iz1 - iz0), 'hall_frame')
    lathe(G, (0, L['low'], 0), (1, 0, 0), [(1.2, HX0 - 0.14), (1.32, HX0 - 0.14), (1.32, HX0 + 0.14), (1.2, HX0 + 0.14)], 32 if hi else 12, 'hall_frame',
          frame=(Vector((0, 1, 0)), Vector((0, 0, 1))))
    solids.append(dict(kind='hall', name='hall', min=[HX0, 0, HZ0], max=[HX1, HY1 + 0.5, HZ1]))

    # racks: two rows facing the tube, LED fronts on their own part
    rack_w, rack_h, rack_d = 0.62, 2.05, 0.95
    racks = [(-1.7 + i * 0.66) for i in range(6)] if hi else [(-1.4 + i * 0.95) for i in range(4)]
    for zs in (-1, 1):
        zc = zs * (HZ1 - 0.75)
        for x in racks:
            box(G, (x, HY0 + rack_h / 2 + 0.04, zc), (rack_w, rack_h, rack_d), 'rack_side',
                skip=('-z',) if zs > 0 else ('+z',))
            fz = zc - zs * (rack_d / 2 + 0.005)
            nrm = (0, 0, -zs)
            parts['rack_glow'].poly([(x - rack_w / 2 + 0.03, HY0 + 0.1, fz), (x + rack_w / 2 - 0.03, HY0 + 0.1, fz),
                                     (x + rack_w / 2 - 0.03, HY0 + rack_h, fz), (x - rack_w / 2 + 0.03, HY0 + rack_h, fz)],
                                    'rack', uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], expect=nrm)
        # overhead cable tray along each row
        if hi:
            box(G, (0, HY1 - 0.35, zs * (HZ1 - 0.75)), (len(racks) * 0.66 + 0.4, 0.08, 0.5), 'tray')
            bar(G, (racks[0] - 0.3, HY1 - 0.28, zs * (HZ1 - 0.75)), (racks[-1] + 0.3, HY1 - 0.28, zs * (HZ1 - 0.75)), 0.09, 6, 'cable')

    # -- the relay tube: glass, from the bell's lip to the dish feed; uv.y = arc length / total ----------------
    path = tube_path(L, 0.35 if hi else 0.9)
    total = path[-1][3]
    tsegs = 32 if hi else 12
    tube = parts['tube']
    throat_s = BELL_LEN
    rings = []
    glass_path = [q for q in path if q[3] >= throat_s - 1e-6]
    total = path[-1][3] - throat_s
    for x, y, p, s in glass_path:
        r = TUBE_R
        s = s - throat_s
        d = Vector((math.cos(p), math.sin(p), 0))
        n = Vector((-math.sin(p), math.cos(p), 0))
        ring = [Vector((x, y, 0)) + (n * math.cos(2 * math.pi * i / tsegs) + Vector((0, 0, 1)) * math.sin(2 * math.pi * i / tsegs)) * r
                for i in range(tsegs)]
        rings.append((ring, s / total, Vector((x, y, 0))))
    for k in range(len(rings) - 1):
        ra, va, ca = rings[k]
        rb, vb, cb = rings[k + 1]
        for i in range(tsegs):
            j = (i + 1) % tsegs
            out = (ra[i] + ra[j]) * 0.5 - ca
            tube.poly([ra[i], ra[j], rb[j], rb[i]], 'tube', uvs=[(i / tsegs, va), ((i + 1) / tsegs, va), ((i + 1) / tsegs, vb), (i / tsegs, vb)],
                      smooth=True, expect=out, raw=True)
    pivots['tube_len'] = total

    # the bell-mouth's metal shell (outside the glass) and its lit throat ring
    mx, my = L['mouth']
    prof = []
    for i in range(9 if hi else 4):
        k = i / (8 if hi else 3)
        s = k * throat_s
        kk = 1 - s / throat_s
        r = TUBE_R + (BELL_R - TUBE_R) * (1 - math.sqrt(max(0.0, 1 - kk * kk)))
        prof.append((r + 0.06, mx - BELL_LEN + s))
    # a rolled lip
    lathe(G, (0, my, 0), (1, 0, 0), [(BELL_R + 0.1, mx - BELL_LEN + 0.05), (BELL_R + 0.07, mx - BELL_LEN - 0.07), (BELL_R - 0.02, mx - BELL_LEN)] + prof,
          32 if hi else 12, 'mouth_metal', frame=(Vector((0, 1, 0)), Vector((0, 0, 1))))
    # the bell's inside (seen down the mouth): dark metal, and the throat ring that breathes light (its own part)
    inner = [(r - 0.04, a) for r, a in prof]
    lathe(G, (0, my, 0), (1, 0, 0), inner, 32 if hi else 12, 'mouth_metal', frame=(Vector((0, 1, 0)), Vector((0, 0, 1))), flip=True)
    lathe(parts['intake_glow'], (0, my, 0), (1, 0, 0), [(TUBE_R + 0.02, mx - 0.5), (TUBE_R + 0.02, mx + 0.02)], 32 if hi else 12, 'mouth_glow',
          frame=(Vector((0, 1, 0)), Vector((0, 0, 1))), flip=True)
    lathe(parts['intake_glow'], (0, my, 0), (1, 0, 0), [(BELL_R + 0.08, mx - BELL_LEN - 0.075), (BELL_R - 0.01, mx - BELL_LEN - 0.075)], 32 if hi else 12,
          'mouth_glow', frame=(Vector((0, 1, 0)), Vector((0, 0, 1))))
    # tube clamps every 2.4 up the straight, braced back to the girts
    fx, fy = L['foot']
    tx, ty = L['top']
    for yc in np.arange(6.0, ty - 0.5, 2.4 if hi else 4.8):
        f = (yc - fy) / (ty - fy)
        cx = fx + (tx - fx) * f
        lathe(G, (cx, yc, 0), (math.sin(L['lean']), math.cos(L['lean']), 0), [(TUBE_R + 0.1, -0.08), (TUBE_R + 0.1, 0.08)], 24 if hi else 8, 'galv2')
    solids.append(dict(kind='tube', name='tube', r=TUBE_R, path=[[round(x, 3), round(y, 3)] for x, y, p, s in path[::2]]))

    # -- cabins: a ribbed box with a roof, a lit window band on its own part, louvres and an AC unit ----------
    for ci, cab in enumerate(CABINS):
        y0 = cab['y'] - cab['h'] / 2
        y1 = cab['y'] + cab['h'] / 2
        hs = cab['half']
        box(G, (0, cab['y'], 0), (hs * 2, cab['h'], hs * 2), 'cabin_wall')
        box(G, (0, y1 + 0.1, 0), (hs * 2 + 0.3, 0.2, hs * 2 + 0.3), 'cabin_roof')
        box(G, (0, y0 - 0.08, 0), (hs * 2 + 0.2, 0.16, hs * 2 + 0.2), 'galv2')
        win = parts[f'cabin_glow_{ci + 1}']
        panes = (4 if hi else 2) if ci < 2 else (3 if hi else 1)
        wy0 = cab['y'] - (0.32 if ci < 2 else 0.2)
        wy1 = cab['y'] + (0.38 if ci < 2 else 0.25)
        for side, (ca, cb, out) in FACES.items():
            o = Vector(out)
            t = Vector((-o.z, 0, o.x))  # along the wall
            for i in range(panes):
                u0 = -hs + 0.3 + (2 * hs - 0.6) * i / panes + 0.04
                u1 = -hs + 0.3 + (2 * hs - 0.6) * (i + 1) / panes - 0.04
                base = o * (hs + 0.012)
                win.poly([base + t * u0 + Vector((0, wy0, 0)), base + t * u1 + Vector((0, wy0, 0)),
                          base + t * u1 + Vector((0, wy1, 0)), base + t * u0 + Vector((0, wy1, 0))],
                         'cabin_window', uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], expect=o)
            if hi:
                # a sill and a hood over the band, louvres below one side, an AC unit on the north
                box(G, tuple(o * (hs + 0.05) + Vector((0, wy0 - 0.04, 0))), (abs(t.x) * (2 * hs - 0.4) + abs(o.x) * 0.1, 0.05, abs(t.z) * (2 * hs - 0.4) + abs(o.z) * 0.1), 'galv2')
                box(G, tuple(o * (hs + 0.08) + Vector((0, wy1 + 0.07, 0))), (abs(t.x) * (2 * hs - 0.4) + abs(o.x) * 0.16, 0.04, abs(t.z) * (2 * hs - 0.4) + abs(o.z) * 0.16), 'galv2')
                if side == 'south' and ci < 2:
                    lp = o * (hs + 0.012) + t * (hs - 0.7) + Vector((0, y0 + 0.45, 0))
                    win_l = [lp - t * 0.35 - Vector((0, 0.25, 0)), lp + t * 0.35 - Vector((0, 0.25, 0)), lp + t * 0.35 + Vector((0, 0.25, 0)), lp - t * 0.35 + Vector((0, 0.25, 0))]
                    G.poly(win_l, 'louvre', uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], expect=o)
        if hi and ci < 2:
            box(G, (0.6, y1 - 0.45, hs + 0.32), (0.9, 0.6, 0.55), 'ac_unit', cells={'+z': 'ac_unit'})
        solids.append(dict(kind='cabin', name=f'cabin_{ci + 1}', min=[-hs - 0.15, y0 - 0.16, -hs - 0.15], max=[hs + 0.15, y1 + 0.2, hs + 0.15]))
        pivots[f'cabin_{ci + 1}'] = [0, cab['y'], 0]
    # a catwalk round cabin 1 (HIGH): grating and a rail
    if hi:
        c1 = CABINS[0]
        yw = c1['y'] - c1['h'] / 2 - 0.16
        hs = c1['half'] + 0.7
        for side, (ca, cb, out) in FACES.items():
            o = Vector(out)
            t = Vector((-o.z, 0, o.x))
            m = o * (c1['half'] + 0.35) + Vector((0, yw, 0))
            box(G, tuple(m), (abs(t.x) * hs * 2 + abs(o.x) * 0.7, 0.05, abs(t.z) * hs * 2 + abs(o.z) * 0.7), 'grate')

    # -- the gallery at 21.4: a grated deck round the steel, a railing, six drum dishes on yaw pivots ---------
    gy = GALLERY_Y
    gh = GALLERY_HALF
    for side, (ca, cb, out) in FACES.items():
        o = Vector(out)
        t = Vector((-o.z, 0, o.x))
        inner = half_w(gy) - 0.1
        m = o * ((inner + gh) / 2) + Vector((0, gy, 0))
        span = gh * 2
        box(G, tuple(m), (abs(t.x) * span + abs(o.x) * (gh - inner), 0.08, abs(t.z) * span + abs(o.z) * (gh - inner)), 'grate')
        # toe board and two rails on posts
        e = o * gh
        a = e - t * gh
        b = e + t * gh
        if hi:
            posts = 6
            for i in range(posts + 1):
                p = a.lerp(b, i / posts) + Vector((0, gy, 0))
                bar(G, p, p + Vector((0, 1.1, 0)), 0.03, 6, band_cell(gy + 0.5))
            for hy, r in ((1.1, 0.032), (0.55, 0.022)):
                bar(G, a + Vector((0, gy + hy, 0)), b + Vector((0, gy + hy, 0)), r, 6, band_cell(gy + 0.5))
            box(G, tuple(e + Vector((0, gy + 0.09, 0))), (abs(t.x) * span + abs(o.x) * 0.02, 0.14, abs(t.z) * span + abs(o.z) * 0.02), band_cell(gy))
        else:
            box(G, tuple(e + Vector((0, gy + 1.08, 0))), (abs(t.x) * span + abs(o.x) * 0.07, 0.07, abs(t.z) * span + abs(o.z) * 0.07), band_cell(gy + 1))
            box(G, tuple(e + Vector((0, gy + 0.08, 0))), (abs(t.x) * span + abs(o.x) * 0.03, 0.14, abs(t.z) * span + abs(o.z) * 0.03), band_cell(gy))
            for f in (-1, 0, 1):
                pp = e + t * (f * (gh - 0.05)) + Vector((0, gy + 0.55, 0))
                box(G, tuple(pp), (0.06, 1.1, 0.06), band_cell(gy + 1))
    solids.append(dict(kind='deck', name='gallery', min=[-gh, gy - 0.1, -gh], max=[gh, gy + 1.15, gh], hole=half_w(gy) - 0.1))
    # support brackets under the deck (HIGH)
    if hi:
        for side, (ca, cb, out) in FACES.items():
            o = Vector(out)
            t = Vector((-o.z, 0, o.x))
            for f in (-0.6, 0.6):
                p = o * (half_w(gy - 1.4)) + t * f * half_w(gy - 1.4) + Vector((0, gy - 1.4, 0))
                q = o * (gh - 0.2) + t * f * half_w(gy - 1.4) + Vector((0, gy - 0.05, 0))
                angle_iron(G, p, q, 0.08, 0.016, (0, -1, 0), band_cell(gy - 0.7))

    drum_seg = 28 if hi else 12
    for i, (ang, rad, off) in enumerate(DRUMS):
        g = parts[f'dish_{i + 1}']
        a = ang * DEG
        piv = Vector((rad * math.cos(a), gy + 0.04, rad * math.sin(a)))
        # the drum's face looks outward from the tower, turned by `off`; the engine turns it to +x
        yaw0 = math.atan2(math.sin(a), math.cos(a)) + off * DEG
        face = Vector((math.cos(yaw0), 0, math.sin(yaw0)))
        pole_top = piv + Vector((0, 1.45, 0))
        bar(g, piv, pole_top + Vector((0, 0.3, 0)), 0.06, 8 if hi else 5, 'galv2')
        dc = pole_top + face * 0.35
        # the drum: a short cylinder, a slightly domed radome on its face, a flat back
        e1 = Vector((0, 1, 0))
        e2 = face.cross(e1).normalized()
        lathe(g, dc - face * (DRUM_D / 2), face, [(DRUM_R, 0), (DRUM_R, DRUM_D)], drum_seg, 'dish_back', frame=(e1, e2))
        prof = [(DRUM_R, DRUM_D)] + ([(DRUM_R * 0.8, DRUM_D + 0.07), (DRUM_R * 0.45, DRUM_D + 0.11), (0.001, DRUM_D + 0.12)] if hi else [(0.001, DRUM_D + 0.08)])
        lathe(g, dc - face * (DRUM_D / 2), face, prof, drum_seg, 'radome', frame=(e1, e2))
        disc(g, dc - face * (DRUM_D / 2), -face, DRUM_R, drum_seg, 'dish_back')
        # the mount arm from the pole to the drum's back
        bar(g, pole_top, dc - face * (DRUM_D / 2), 0.05, 6 if hi else 4, 'galv2')
        if hi:
            # a rim band and the feeder cable down the pole
            lathe(g, dc + face * (DRUM_D - 0.04 - DRUM_D / 2), face, [(DRUM_R + 0.03, 0), (DRUM_R + 0.03, 0.06)], drum_seg, 'dish_back', frame=(e1, e2))
            bar(g, dc - face * (DRUM_D / 2 + 0.02) - e1 * 0.2, piv + Vector((0, 0.3, 0)) - face * 0.08, 0.025, 5, 'cable')
        pivots[f'dish_{i + 1}'] = dict(pos=[piv.x, piv.y, piv.z], yaw0=yaw0, axis=[0, 1, 0])
        solids.append(dict(kind='drum', name=f'dish_{i + 1}', c=[dc.x, dc.y, dc.z], r=DRUM_R + 0.1))

    # -- the main dish: its vertex at the feed (the tube's end), boresight +x and up 35 degrees ---------------
    ex, ey = L['exit']
    bs = Vector((math.cos(L['pitch']), math.sin(L['pitch']), 0))
    vtx = Vector((ex, ey, 0))
    g = parts['dish_main']
    e1 = Vector((0, 0, 1))
    e2 = bs.cross(e1).normalized()
    depth = 0.55
    rings_n = 9 if hi else 4
    prof_front = [(TUBE_R + 0.18 + (MAIN_DISH_R - TUBE_R - 0.18) * (k / (rings_n - 1)), 0) for k in range(rings_n)]
    prof_front = [(r, depth * (r / MAIN_DISH_R) ** 2 - 0.12) for r, _ in prof_front]
    lathe(g, vtx, bs, prof_front, 48 if hi else 16, 'dish_white', frame=(e1, e2), flip=True)
    back = [(r, a - 0.05) for r, a in prof_front]
    lathe(g, vtx, bs, back[::-1], 48 if hi else 16, 'dish_back', frame=(e1, e2), flip=True)
    # rim
    rim = prof_front[-1]
    lathe(g, vtx, bs, [(MAIN_DISH_R, rim[1] - 0.05), (MAIN_DISH_R + 0.06, rim[1] - 0.05), (MAIN_DISH_R + 0.06, rim[1] + 0.06), (MAIN_DISH_R, rim[1] + 0.06)],
          48 if hi else 16, 'dish_back', frame=(e1, e2))
    # the feed: a collar round the tube's mouth that glows (on the main dish's part, so it nods with it)
    lathe(g, vtx, bs, [(TUBE_R + 0.2, -0.3), (TUBE_R + 0.2, -0.05), (TUBE_R + 0.05, 0.02)], 32 if hi else 12, 'feed_glow', frame=(e1, e2))
    # the back frame: struts from the dish's back to a collar round the tube, and a yoke either side down to the
    # platform on the steel's top (the tube itself feeds the dish from behind)
    collar_c = vtx - bs * 0.45
    lathe(g, collar_c, bs, [(TUBE_R + 0.08, -0.15), (TUBE_R + 0.22, -0.15), (TUBE_R + 0.22, 0.15), (TUBE_R + 0.08, 0.15)], 24 if hi else 10, 'dish_back',
          frame=(e1, e2))
    if hi:
        for k in range(8):
            ang = 2 * math.pi * (k + 0.5) / 8
            radial = e1 * math.cos(ang) + e2 * math.sin(ang)
            rp = vtx + radial * (MAIN_DISH_R * 0.82) + bs * (depth * 0.67 - 0.17)
            bar(g, collar_c + radial * (TUBE_R + 0.2), rp, 0.04, 5, 'dish_back')
    for zz in (-1, 1):
        top = vtx - bs * 0.3 + Vector((0, 0, zz * 1.45))
        foot = Vector((-0.4, STEEL_TOP + 0.1, zz * 1.2))
        bar(g, foot, top, 0.09, 6 if hi else 4, 'galv2')
        bar(g, top, top - Vector((0, 0, zz * 0.3)), 0.12, 6 if hi else 4, 'galv2')
    pivots['dish_main'] = dict(pos=[vtx.x, vtx.y, vtx.z], axis=[0, 0, 1])
    solids.append(dict(kind='dish', name='dish_main', c=[ex + bs.x * 0.2, ey + bs.y * 0.2, 0], n=[bs.x, bs.y, 0], r=MAIN_DISH_R + 0.1, hole=TUBE_R))
    # a platform at the steel's top for the dish's yoke
    box(G, (-0.68, STEEL_TOP + 0.05, 0), (1.95, 0.1, TOP_HALF * 2 + 0.3), 'grate')

    # -- the mast behind the dish, panel antennas, beacons -------------------------------------------------------
    mbase = Vector((-0.9, STEEL_TOP, 0))
    mtop = Vector((-0.9, MAST_TOP, 0))
    bar(G, mbase, mtop, 0.16, 10 if hi else 6, 'red', r1=0.1)
    for k in range(int((MAST_TOP - STEEL_TOP) / BAND_H) + 1):
        y0 = STEEL_TOP + k * BAND_H
        if k % 2 == 1 and y0 < MAST_TOP:
            r0 = 0.16 + (0.1 - 0.16) * (y0 - STEEL_TOP) / (MAST_TOP - STEEL_TOP) + 0.006
            bar(G, Vector((-0.9, y0, 0)), Vector((-0.9, min(y0 + BAND_H, MAST_TOP), 0)), r0, 10 if hi else 6, 'white', r1=r0 - 0.012)
    bar(G, mtop, mtop + Vector((0, 1.1, 0)), 0.02, 4, 'galv2')
    # sector antennas: three pairs on the steel's top corners (not on the dish's side)
    if hi:
        for sx, sz in ((-1, 1), (-1, -1)):
            c = corner(STEEL_TOP - 0.6, sx, sz)
            for f in (-0.35, 0.35):
                p = c + Vector((sx * 0.35, 0, f))
                box(G, (p.x, p.y, p.z), (0.14, 1.5, 0.32), 'antenna', yaw=math.atan2(sz, sx))
    beacons = [(mtop + Vector((0, 0.1, 0)), 0.19), (corner(STEEL_TOP + 0.2, -1, 1), 0.15), (corner(STEEL_TOP + 0.2, -1, -1), 0.15),
               (corner(12.2 + 0.25, 1, 1) + Vector((0.25, 0, 0.25)), 0.14)]
    for i, (p, r) in enumerate(beacons):
        g = parts[f'beacon_{i + 1}']
        bar(g, p - Vector((0, 0.14, 0)), p, r * 0.75, 8, 'galv2')
        prof = [(r, 0), (r * 0.95, r * 0.4), (r * 0.7, r * 0.8), (r * 0.3, r * 1.05), (0.001, r * 1.12)] if hi else [(r, 0), (r * 0.6, r * 0.9), (0.001, r * 1.1)]
        lathe(g, p, (0, 1, 0), prof, 16 if hi else 8, 'beacon', frame=(Vector((1, 0, 0)), Vector((0, 0, 1))))
        pivots[f'beacon_{i + 1}'] = [p.x, p.y, p.z]

    # -- the cable ladder-tray up the north face and the caged ladder up the south face --------------------------
    def face_point(y, side_z, along):
        w = half_w(y)
        return Vector((along * w * 0.55, y, side_z * (w - 0.25)))
    for zs, kind in ((1, 'tray'), (-1, 'ladder')):
        for xo in ((-0.32, 0.32) if kind == 'tray' else (-0.22, 0.22)):
            pts = [face_point(y, zs, 0) + Vector((xo, 0, 0)) for y in np.linspace(HY1 + 0.4, GALLERY_Y, 10)]
            for a, b in zip(pts, pts[1:]):
                if hi:
                    box_bar = bar
                    box_bar(G, a, b, 0.035, 4, 'galv', caps=False, smooth=False, phase=math.pi / 4)
                else:
                    bar(G, a, b, 0.05, 3, 'galv', caps=False, smooth=False)
        if hi:
            ys = np.arange(HY1 + 0.6, GALLERY_Y, 0.42 if kind == 'tray' else 0.3)
            for y in ys:
                p = face_point(y, zs, 0)
                w = 0.32 if kind == 'tray' else 0.22
                bar(G, p - Vector((w, 0, 0)), p + Vector((w, 0, 0)), 0.016, 4, 'galv')
            if kind == 'tray':
                for co, cr in ((-0.12, 0.07), (0.1, 0.06), (0.0, 0.05)):
                    pts = [face_point(y, zs, 0) + Vector((co, 0, zs * 0.08)) for y in np.linspace(HY1 + 0.4, GALLERY_Y, 10)]
                    for a, b in zip(pts, pts[1:]):
                        bar(G, a, b, cr, 6, 'cable', caps=False)
            else:
                # the cage: hoops every metre from 3 up, five verticals
                for y in np.arange(HY1 + 2.4, GALLERY_Y, 1.0):
                    c = face_point(y, zs, 0)
                    hoop = [c + Vector((0.38 * math.cos(math.pi * k / 10), 0, zs * (0.38 * math.sin(math.pi * k / 10)))) for k in range(11)]
                    for a, b in zip(hoop, hoop[1:]):
                        bar(G, a, b, 0.016, 4, 'galv', caps=False)
                for k in range(5):
                    ang = math.pi * (k + 0.5) / 5
                    pts = [face_point(y, zs, 0) + Vector((0.38 * math.cos(ang), 0, zs * 0.38 * math.sin(ang))) for y in np.linspace(HY1 + 2.4, GALLERY_Y, 6)]
                    for a, b in zip(pts, pts[1:]):
                        bar(G, a, b, 0.014, 4, 'galv', caps=False)

    # -- named empties -------------------------------------------------------------------------------------------
    pivots['intake'] = [L['mouth'][0], L['mouth'][1], 0.0]
    pivots['tube_top'] = [L['exit'][0], L['exit'][1], 0.0]
    return parts, pivots, solids


# ------------------------------------------------------------------------------------------------
# the atlas
# ------------------------------------------------------------------------------------------------

SHAPE = (512, 256)  # (rows, cols) of one cell at 2048; set by paint_atlas


def vnoise(_n, scale, seed, octaves=4):
    """Value noise over one cell, isotropic in texels; `scale` is the feature size in texels."""
    h, w = SHAPE
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp = 1.0
    tot = 0.0
    s = scale
    for _ in range(octaves):
        gh, gw = max(2, int(h / s)), max(2, int(w / s))
        grid = rng.random((gh + 1, gw + 1)).astype(np.float32)
        img = Image.fromarray((grid * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += amp * (np.asarray(img, np.float32) / 255.0)
        tot += amp
        amp *= 0.5
        s /= 2
    return out / tot


def paint_atlas(size, seed=7):
    """Colour (sRGB), emissive and ORM (R 1, G roughness, B metalness) at `size`."""
    global SHAPE
    NW = size // CELL_COLS
    NH = size // CELL_ROWS
    SHAPE = (NH, NW)
    N = NW
    color = np.zeros((size, size, 3), np.float32)
    emis = np.zeros((size, size, 3), np.float32)
    orm = np.zeros((size, size, 3), np.float32)
    orm[..., 0] = 1.0
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:NH, 0:NW].astype(np.float32)
    yy /= NH
    xx /= NW
    A = ASPECT

    def put(cell, rgb, rough, metal, em=None):
        col, row = CELLS[cell]
        sl = (slice(row * NH, (row + 1) * NH), slice(col * NW, (col + 1) * NW))
        color[sl] = np.clip(rgb, 0, 1)
        orm[sl][..., 1] = np.clip(rough, 0.03, 1)
        orm[sl][..., 2] = np.clip(metal, 0, 1)
        if em is not None:
            emis[sl] = np.clip(em, 0, 1)

    def tint(base, n, amt):
        return np.stack([np.full((NH, NW), base[i] / 255.0) for i in range(3)], -1) * (1 + (n[..., None] - 0.5) * amt)

    s = seed
    # galvanised zinc: spangle crystals, blotches, white-rust runs down the members
    sp = vnoise(N, N / 18, s + 1, 2)
    spangle = (np.floor(sp * 7) / 7)
    blot = vnoise(N, N / 3, s + 2)
    runs = np.clip(vnoise(N, N / 40, s + 3, 1)[0:1, :].repeat(NH, 0) * 1.6 - 0.75, 0, 1) * (0.4 + 0.6 * yy)
    galv = tint((168, 173, 176), blot, 0.22) * (0.94 + 0.08 * spangle[..., None])
    galv = galv * (1 - 0.1 * runs[..., None]) + runs[..., None] * np.array([0.08, 0.08, 0.07])
    put('galv', galv, 0.42 + 0.2 * blot + 0.15 * runs, 0.72 - 0.25 * runs)
    put('galv2', galv * 0.82, 0.48 + 0.2 * blot, 0.65)
    # aviation paint: chalky, slightly faded toward the top of each cell, chips showing zinc
    chips = (vnoise(N, N / 30, s + 4, 2) > 0.8).astype(np.float32)
    chalk = vnoise(N, N / 6, s + 5)
    red = tint((176, 44, 30), chalk, 0.3) * (1 - chips[..., None]) + galv * chips[..., None]
    put('red', red, 0.55 + 0.25 * chalk - 0.2 * chips, 0.05 + 0.6 * chips)
    white = tint((226, 223, 214), chalk, 0.12) * (1 - chips[..., None]) + galv * chips[..., None]
    white *= 1 - 0.1 * runs[..., None]
    put('white', white, 0.5 + 0.2 * chalk, 0.05 + 0.6 * chips)
    # concrete: speckle, stains, a drip line
    spk = vnoise(N, 3, s + 6, 2)
    conc = tint((152, 149, 141), vnoise(N, N / 4, s + 7), 0.25) * (0.92 + 0.12 * spk[..., None])
    conc *= (0.82 + 0.18 * yy)[..., None]
    put('concrete', conc, 0.92, 0.0)
    put('plinth', tint((140, 138, 132), vnoise(N, N / 5, s + 8), 0.2), 0.85, 0.0)
    # gravel pad: stones
    grav = vnoise(N, 2.2, s + 9, 3)
    put('pad', tint((118, 114, 104), grav, 0.6) * (0.8 + 0.25 * vnoise(N, N / 3, s + 10))[..., None], 0.95, 0.0)
    # grating: a square grid of holes over shadow
    gx = (np.mod(xx * 26, 1) < 0.22) | (np.mod(yy * 26 * A, 1) < 0.22)
    grate = np.where(gx[..., None], galv * 0.95, np.array([0.06, 0.06, 0.07]))
    put('grate', grate, np.where(gx, 0.5, 0.9), np.where(gx, 0.6, 0.0))
    put('dark', tint((52, 55, 60), blot, 0.2), 0.5, 0.4)
    # cabin cladding: trapezoidal ribs, grime under the roof
    rib = (np.mod(xx * 7, 1) < 0.16).astype(np.float32)
    wall = tint((196, 199, 196), vnoise(N, N / 5, s + 11), 0.1) * (1 - 0.18 * rib[..., None])
    wall *= (1 - 0.18 * np.clip(1 - yy * 6, 0, 1))[..., None]
    wall *= (1 - 0.1 * runs[..., None])
    put('cabin_wall', wall, 0.5 + 0.1 * rib, 0.35)
    # a cabin window: a dark frame, glass with a warm-lit interior and a teal screen glow (emissive)
    frame = (xx < 0.08) | (xx > 0.92) | (yy < 0.1) | (yy > 0.9)
    inside = np.clip(1 - np.abs(yy - 0.62) * 1.6, 0, 1) * (0.7 + 0.3 * vnoise(N, N / 4, s + 12))
    glass = np.stack([0.07 + 0.25 * inside, 0.09 + 0.22 * inside, 0.11 + 0.18 * inside], -1)
    win = np.where(frame[..., None], np.array([0.22, 0.23, 0.25]), glass)
    scr = np.exp(-(((xx - 0.33) / 0.12) ** 2 + ((yy - 0.6) / 0.12) ** 2)) + np.exp(-(((xx - 0.7) / 0.1) ** 2 + ((yy - 0.58) / 0.1) ** 2))
    em_win = np.stack([1.0 * inside + 0.1 * scr, 0.78 * inside + 0.85 * scr, 0.52 * inside + 0.8 * scr], -1) * (~frame)[..., None]
    put('cabin_window', win, np.where(frame, 0.5, 0.08), np.where(frame, 0.5, 0.2), em_win)
    put('cabin_roof', tint((78, 80, 84), vnoise(N, N / 6, s + 13), 0.25), 0.7, 0.2)
    lv = (np.mod(yy * 12, 1) < 0.5).astype(np.float32)
    put('louvre', tint((150, 154, 156), lv, 0.5), 0.5, 0.5)
    put('ac_unit', tint((200, 202, 198), vnoise(N, N / 6, s + 14), 0.1) * (1 - 0.5 * ((((xx - 0.5) ** 2 + (yy - 0.5) ** 2) < 0.12) & (np.mod(xx * 20, 1) < 0.3)))[..., None], 0.5, 0.3)
    # hall: anodised frame, epoxy floor with seams
    put('hall_frame', tint((44, 48, 54), blot, 0.15), 0.32, 0.65)
    seam = ((np.mod(xx * 4, 1) < 0.01) | (np.mod(yy * 4 * A, 1) < 0.01 * A)).astype(np.float32)
    put('hall_floor', tint((84, 92, 100), vnoise(N, N / 6, s + 15), 0.15) * (1 - 0.4 * seam[..., None]), 0.28, 0.0)
    put('roof_hall', tint((70, 72, 76), vnoise(N, N / 5, s + 16), 0.2), 0.8, 0.1)
    # a server rack's front: perforated door, a column of LEDs (emissive teal/green/amber), unit lines
    units = (np.mod(yy * 21, 1) < 0.08).astype(np.float32)
    perf = ((np.mod(xx * 40, 1) < 0.35) & (np.mod(yy * 80, 1) < 0.35)).astype(np.float32)
    rack = np.full((NH, NW, 3), 0.05) * (1 + 0.6 * perf[..., None]) * (1 - 0.5 * units[..., None])
    em_rack = np.zeros((NH, NW, 3), np.float32)
    for k in range(21):
        for j in range(6):
            if rng.random() < 0.7:
                cx, cy = 0.12 + j * 0.035, (k + 0.5) / 21
                col = [(0.24, 1.0, 0.84), (0.3, 1.0, 0.45), (1.0, 0.7, 0.2)][int(rng.random() * 3 if rng.random() > 0.6 else 0)]
                d = np.exp(-(((xx - cx) / 0.008) ** 2 + ((yy - cy) / 0.008) ** 2))
                em_rack += d[..., None] * np.array(col)
        # a status bar on some units
        if rng.random() < 0.4:
            bar_m = ((xx > 0.55) & (xx < 0.55 + 0.35 * rng.random()) & (np.abs(yy - (k + 0.5) / 21) < 0.006)).astype(np.float32)
            em_rack += bar_m[..., None] * np.array([0.15, 0.7, 0.9])
    put('rack', rack, 0.4, 0.5, np.clip(em_rack, 0, 1))
    put('rack_side', tint((30, 33, 38), blot, 0.1), 0.45, 0.5)
    put('tray', galv * 0.9, 0.5, 0.6)
    put('cable', tint((22, 22, 24), vnoise(N, N / 8, s + 17), 0.3), 0.65, 0.0)
    # the main dish: white panels with radial seams (uv u is round the dish)
    seams = (np.mod(xx * 12, 1) < 0.02).astype(np.float32) + ((np.abs(yy - 0.5) < 0.008)).astype(np.float32)
    put('dish_white', tint((232, 231, 226), vnoise(N, N / 5, s + 18), 0.08) * (1 - 0.25 * np.clip(seams, 0, 1)[..., None]), 0.42, 0.05)
    put('dish_back', tint((128, 134, 140), blot, 0.2), 0.45, 0.7)
    weave = (np.mod(xx * 90, 1) < 0.5) ^ (np.mod(yy * 90 * A, 1) < 0.5)
    put('radome', tint((218, 214, 202), vnoise(N, N / 4, s + 19), 0.1) * (0.97 + 0.04 * weave[..., None]), 0.8, 0.0)
    brushed = vnoise(N, N / 60, s + 20, 1)[0:1, :].repeat(NH, 0)
    put('mouth_metal', tint((70, 76, 84), brushed, 0.3), 0.28, 0.9)
    ring = np.clip(1 - np.abs(yy - 0.5) * 2.2, 0, 1)
    put('mouth_glow', np.stack([0.2 * ring, 0.6 * ring, 0.55 * ring], -1), 0.3, 0.0,
        np.stack([0.3 * ring + 0.1, 1.0 * ring + 0.2, 0.86 * ring + 0.2], -1))
    put('feed_glow', np.stack([0.2 * ring, 0.6 * ring, 0.55 * ring], -1), 0.3, 0.0,
        np.stack([0.3 * ring + 0.1, 1.0 * ring + 0.2, 0.86 * ring + 0.2], -1))
    dome = np.clip(1 - ((xx - 0.5) ** 2 + (yy - 0.5) ** 2) * 2, 0, 1)
    put('beacon', np.stack([0.7 + 0.3 * dome, 0.08 + 0.1 * dome, 0.06 + 0.06 * dome], -1), 0.15, 0.0,
        np.stack([1.0 * (0.5 + 0.5 * dome), 0.12 * dome + 0.04, 0.06 * dome + 0.03], -1))
    put('antenna', tint((206, 206, 202), vnoise(N, N / 5, s + 21), 0.06), 0.55, 0.0)
    hz = (np.mod((xx + yy) * 6, 1) < 0.5)
    put('hazard', np.where(hz[..., None], np.array([0.85, 0.66, 0.08]), np.array([0.08, 0.08, 0.08])), 0.6, 0.0)
    put('glass', np.full((NH, NW, 3), 0.6), 0.05, 0.0)
    put('tube', np.full((NH, NW, 3), 0.8), 0.05, 0.0)
    return color, emis, orm


def to_img(a, srgb=True):
    a = np.clip(a, 0, 1)
    return Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'RGB')


# ------------------------------------------------------------------------------------------------
# Blender objects, export
# ------------------------------------------------------------------------------------------------

def bl(p):
    """tower-local Y-up -> Blender Z-up (the glTF exporter turns it back)."""
    return (p[0], -p[2], p[1])


def make_object(geo, mat_name, parent, origin=(0, 0, 0), name=None):
    mesh = bpy.data.meshes.new(name or geo.name)
    o = Vector(origin)
    verts = [bl(v - o) for v in geo.v]
    faces = [f[0] for f in geo.faces]
    mesh.from_pydata(verts, [], faces)
    uvl = mesh.uv_layers.new(name='UVMap')
    k = 0
    for poly, (idx, uvs, sm) in zip(mesh.polygons, geo.faces):
        poly.use_smooth = sm
        for li, uv in zip(poly.loop_indices, uvs):
            uvl.data[li].uv = uv
    mesh.validate()
    mat = bpy.data.materials.get(mat_name) or bpy.data.materials.new(mat_name)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name or geo.name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = (0, 0, 0)
    return obj


def empty(name, pos, parent):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.5
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = bl(pos)
    return e


def assemble(parts, pivots, tag):
    root = bpy.data.objects.new('tower_root', None)
    bpy.context.scene.collection.objects.link(root)
    objs = [root]
    for name, g in parts.items():
        if not g.faces:
            continue
        if name == 'tube':
            # the tube's uv is raw: u round it, v the arc fraction from the throat (0) to the feed (1); the glTF
            # exporter flips v, so store 1 - v here and the engine reads uv.y = arc fraction
            for idx, uvs, sm in g.faces:
                uvs[:] = [(u, 1 - v) for u, v in uvs]
            objs.append(make_object(g, 'tube', root))
        elif name == 'hall_glass':
            objs.append(make_object(g, 'hall_glass', root))
        elif name.startswith('dish_'):
            piv = pivots[name]['pos']
            e = empty(name, piv, root)
            o = make_object(g, 'tower', e, origin=piv, name=f'{name}_mesh')
            objs += [e, o]
        else:
            objs.append(make_object(g, 'tower', root))
    for n in ('intake', 'tube_top'):
        objs.append(empty(n, pivots[n], root))
    return objs


def export(objs, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=False,
                              export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials='EXPORT', export_image_format='NONE', export_cameras=False,
                              export_lights=False, export_extras=False, export_attributes=False)


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)


# ------------------------------------------------------------------------------------------------
# preview
# ------------------------------------------------------------------------------------------------

def preview(render_dir, maps):
    """Cycles stills of both tiers side by side, as shipped (atlas maps on, emissive lit)."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1200, 750
    world = bpy.data.worlds.new('dawn')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    sky = world.node_tree.nodes.new('ShaderNodeTexSky')
    try:
        sky.sky_type = 'NISHITA'
        sky.sun_elevation = 14 * DEG
        sky.sun_rotation = 200 * DEG
    except Exception:
        pass
    world.node_tree.links.new(sky.outputs[0], bg.inputs[0])
    bg.inputs[1].default_value = 0.6
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.5
    sun.color = (1.0, 0.9, 0.78)
    so = bpy.data.objects.new('sun', sun)
    scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(70), 0, math.radians(110))
    imgs = {}
    for k, path in maps.items():
        imgs[k] = bpy.data.images.load(path)
        if k != 'color':
            imgs[k].colorspace_settings.name = 'Non-Color' if k == 'orm' else 'sRGB'
    for m in bpy.data.materials:
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes.get('Principled BSDF')
        if bsdf is None:
            continue
        if m.name in ('tower', 'tower_lean'):
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = imgs['color']
            nt.links.new(tex.outputs[0], bsdf.inputs['Base Color'])
            et = nt.nodes.new('ShaderNodeTexImage')
            et.image = imgs['emissive']
            nt.links.new(et.outputs[0], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = 4.0
            ot = nt.nodes.new('ShaderNodeTexImage')
            ot.image = imgs['orm']
            sep = nt.nodes.new('ShaderNodeSeparateColor')
            nt.links.new(ot.outputs[0], sep.inputs[0])
            nt.links.new(sep.outputs[1], bsdf.inputs['Roughness'])
            nt.links.new(sep.outputs[2], bsdf.inputs['Metallic'])
        elif m.name == 'tube':
            bsdf.inputs['Base Color'].default_value = (0.75, 0.95, 1.0, 1)
            bsdf.inputs['Transmission Weight'].default_value = 0.9
            bsdf.inputs['Roughness'].default_value = 0.05
            bsdf.inputs['Emission Color'].default_value = (0.3, 1.0, 0.9, 1)
            bsdf.inputs['Emission Strength'].default_value = 0.6
        elif m.name == 'hall_glass':
            bsdf.inputs['Base Color'].default_value = (0.7, 0.85, 0.9, 1)
            bsdf.inputs['Transmission Weight'].default_value = 0.85
            bsdf.inputs['Roughness'].default_value = 0.04
    cam = bpy.data.cameras.new('cam')
    cam.lens = 30
    co = bpy.data.objects.new('cam', cam)
    scene.collection.objects.link(co)
    scene.camera = co
    views = {
        'both': ((0, 66, 16), (0, 0, 14.5)),          # (Blender coords) the two tiers side by side, from the south
        'foot': ((-28.5, 7.5, 3.0), (-17.2, 0, 2.6)),  # HIGH: the hall and the bell-mouth, from down the runway
        'top': ((-5.5, 10.5, 29.5), (-13, 0, 23.5)),   # HIGH: the gallery, the drums and the main dish's face
    }
    out = []
    for name, (pos, look) in views.items():
        co.location = pos
        d = Vector(look) - Vector(pos)
        co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(render_dir, f'tower-{name}.png')
        bpy.ops.render.render(write_still=True)
        out.append(scene.render.filepath)
        print('rendered', scene.render.filepath)
    # contact sheet
    ims = [Image.open(p) for p in out]
    w, hh = ims[0].size
    sheet = Image.new('RGB', (w, hh * 2), (20, 20, 24))
    sheet.paste(ims[0], (0, 0))
    sheet.paste(ims[1].resize((w // 2, hh // 2)), (0, hh))
    sheet.paste(ims[2].resize((w // 2, hh // 2)), (w // 2, hh))
    sheet = sheet.resize((w, hh * 2 // 1))
    sheet.save(os.path.join(render_dir, 'tower-sheet.png'))
    print('sheet', os.path.join(render_dir, 'tower-sheet.png'))


# ------------------------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--render', help='write a Cycles preview sheet of both tiers here')
    ap.add_argument('--debug', help='write the atlas maps as PNGs here')
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
    os.makedirs(args.out, exist_ok=True)
    t0 = time.time()
    L = line_layout()
    bpy.ops.wm.read_factory_settings(use_empty=True)

    color, emis, orm = paint_atlas(2048)
    maps = {}
    for tag, size in (('tower', 2048), ('tower-lean', 1024)):
        for k, a in (('color', color), ('emissive', emis), ('orm', orm)):
            if tag == 'tower-lean' and k == 'orm':
                continue
            im = to_img(a)
            if size != 2048:
                im = im.resize((size, size), Image.LANCZOS)
            path = os.path.join(args.out, f'{tag}-{k}.webp')
            im.save(path, 'WEBP', quality=88 if k != 'orm' else 90, method=6)
            if tag == 'tower':
                maps[k] = path
            if args.debug:
                os.makedirs(args.debug, exist_ok=True)
                im.save(os.path.join(args.debug, f'{tag}-{k}.png'))

    manifest = {'units': 'world units (the dart is 1.6 long); Y up; origin = the relay tube axis on the ground; +x toward the house',
                'tiers': {}, 'line': {k: L[k] for k in ('mouth', 'foot', 'top', 'exit', 'bend', 'lean', 'pitch', 'tower_x')}}
    for tier, hi in (('high', True), ('low', False)):
        clear()
        parts, pivots, solids = build(hi, L)
        objs = assemble(parts, pivots, tier)
        name = 'tower.glb' if hi else 'tower-lean.glb'
        export(objs, os.path.join(args.out, name))
        tris = {k: g.tris() for k, g in parts.items() if g.faces}
        manifest['tiers'][tier] = {
            'file': name, 'tris': sum(tris.values()), 'parts': tris,
            'maps': ['tower-color.webp', 'tower-emissive.webp', 'tower-orm.webp'] if hi else ['tower-lean-color.webp', 'tower-lean-emissive.webp'],
        }
        if hi:
            manifest['pivots'] = pivots
            manifest['solids'] = solids
            manifest['dims'] = dict(steel_top=STEEL_TOP, base_half=BASE_HALF, top_half=TOP_HALF, gallery_y=GALLERY_Y, mast_top=MAST_TOP,
                                    hall=HALL, tube_r=TUBE_R, bell_r=BELL_R, bell_len=BELL_LEN, main_dish_r=MAIN_DISH_R,
                                    cabins=CABINS)
        print(f'{tier}: {sum(tris.values())} tris  {tris}')
    clear()
    with open(os.path.join(args.out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
        f.write('\n')
    with open(os.path.join(args.out, 'CREDITS.md'), 'w') as f:
        f.write('# Communications tower\n\nModelled procedurally by `blender/make_comm_tower.py` (this repository); the atlas is painted '
                'by the same script. No third-party assets.\n')
    print(f'done in {time.time() - t0:.0f}s')
    if args.render:
        os.makedirs(args.render, exist_ok=True)
        # both tiers side by side: HIGH on the left, LOW on the right
        for hi, dx in ((True, -14), (False, 14)):
            parts, pivots, solids = build(hi, L)
            objs = assemble(parts, pivots, 'high' if hi else 'low')
            objs[0].location = (dx, 0, 0)
        preview(args.render, maps)


if __name__ == '__main__':
    main()
