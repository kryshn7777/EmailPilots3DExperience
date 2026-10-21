"""A laptop: aluminium unibody, legended keyboard, glass trackpad, hinge, bezel and ports.

Built in the scene's own units (the desk laptop's display is 1.38 x 0.93), Z up. The base runs
out along +X from the hinge at the origin (front edge at x = DEPTH), the lid is an Empty named
`lid` at the hinge with its children modelled standing straight up, display facing +X, so the
runtime can tilt it. One mesh per material, named for it; the runtime assigns the materials.
The keyboard's key tops carry UVs into the legend atlas written by make_laptop.py.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

DEPTH = 1.0          # hinge to front edge
DISPLAY = (1.38, 0.93)
BEZEL_SIDE, BEZEL_TOP, BEZEL_BOTTOM = 0.065, 0.05, 0.075
W = DISPLAY[0] + 2 * BEZEL_SIDE
LID_H = DISPLAY[1] + BEZEL_TOP + BEZEL_BOTTOM
T = 0.05             # base thickness
LT = 0.034           # lid thickness
HINGE_Z = 0.036

# keyboard layout: key widths in key pitches, a row at a time
ROWS = [
    (True, [('esc', 1.5)] + [(f'F{i}', 1) for i in range(1, 13)] + [('pwr', 1.5)]),
    (False, [(c, 1) for c in '1234567890-='] + [('del', 2)]),
    (False, [('tab', 1.5)] + [(c, 1) for c in 'QWERTYUIOP[]'] + [('\\', 1.5)]),
    (False, [('caps', 1.75)] + [(c, 1) for c in "ASDFGHJKL;'"] + [('ret', 2.25)]),
    (False, [('shift', 2.25)] + [(c, 1) for c in 'ZXCVBNM,./'] + [('shift', 2.75)]),
    (False, [('fn', 1.25), ('ctrl', 1.25), ('opt', 1.25), ('', 6), ('cmd', 1.25), ('opt', 1.25), ('<>', 2.75)]),
]
LABELS = [''] + sorted({k for _, row in ROWS for k, _ in row} - {''})
ATLAS_COLS = 16


def atlas_cell(label):
    """(u0, v0, u1, v1) of a label's cell in the legend atlas; v runs up from the bottom."""
    i = LABELS.index(label)
    rows = math.ceil(len(LABELS) / ATLAS_COLS)
    cw, ch = 1 / ATLAS_COLS, 1 / rows
    u0 = (i % ATLAS_COLS) * cw
    v1 = 1 - (i // ATLAS_COLS) * ch
    return (u0 + 0.004, v1 - ch + 0.004, u0 + cw - 0.004, v1 - 0.004)


def _object(name, bm, collection, parent=None, smooth=True, angle=32):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    if smooth:
        for p in mesh.polygons:
            p.use_smooth = True
        # shade by angle: keep hard edges where the surface turns sharply
        bpy.context.view_layer.objects.active = obj
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
        except RuntimeError:
            pass
    return obj


def _rbox(center, size, bevel=0.0, segs=3):
    """A box, optionally with every edge rounded. Returns a bmesh with UVs (box projected)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs, affect='EDGES', profile=0.6)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return bm


def _cyl(center, r, length, axis='Y', segs=24):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=length)
    rot = {'X': Matrix.Rotation(math.pi / 2, 4, 'Y'), 'Y': Matrix.Rotation(math.pi / 2, 4, 'X'), 'Z': Matrix.Identity(4)}[axis]
    bmesh.ops.transform(bm, matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return bm


def _merge(bms):
    out = bmesh.new()
    for b in bms:
        mesh = bpy.data.meshes.new('tmp')
        b.to_mesh(mesh)
        b.free()
        out.from_mesh(mesh)
        bpy.data.meshes.remove(mesh)
    return out


def _keycap(bm, uv, x, y, w, d, h, cell):
    """A tapered key standing on the base: sides, and a flat top carrying the legend."""
    inset = min(w, d) * 0.1
    bw, bd, tw, td = w / 2, d / 2, w / 2 - inset, d / 2 - inset
    v = lambda px, py, pz: bm.verts.new((x + px, y + py, pz))  # noqa: E731
    b = [v(-bd, -bw, T), v(bd, -bw, T), v(bd, bw, T), v(-bd, bw, T)]
    t = [v(-td, -tw, T + h), v(td, -tw, T + h), v(td, tw, T + h), v(-td, tw, T + h)]
    u0, v0, u1, v1 = cell
    for quad, uvs in (
        ((b[1], b[0], t[0], t[1]), [(0, 0)] * 4),
        ((b[2], b[1], t[1], t[2]), [(0, 0)] * 4),
        ((b[3], b[2], t[2], t[3]), [(0, 0)] * 4),
        ((b[0], b[3], t[3], t[0]), [(0, 0)] * 4),
        # top: the legend reads along +y (the width), top-to-bottom toward -x (the front edge is +x)
        ((t[0], t[1], t[2], t[3]), [(u0, v1), (u0, v0), (u1, v0), (u1, v1)]),
    ):
        f = bm.faces.new(quad)
        for loop, c in zip(f.loops, uvs):
            loop[uv].uv = c


def build(collection):
    """Every part of the laptop, linked into `collection`. Returns {name: object}."""
    out = {}
    # ---- base, hinge, feet, ports, speaker slots, LED ---------------------------------------
    base = _object('base', _rbox((DEPTH / 2, 0, T / 2), (DEPTH, W, T), 0.012, 3), collection)
    out['base'] = base

    pitch = (W - 0.16) / 15
    key_h, gap = 0.014, pitch * 0.12
    kb_x0 = 0.07
    keys = bmesh.new()
    uv = keys.loops.layers.uv.new('UVMap')
    x = kb_x0
    row_depths = [pitch * (0.74 if small else 0.98) for small, _ in ROWS]
    for (small, row), rd in zip(ROWS, row_depths):
        y = -W / 2 + 0.08
        for label, wu in row:
            kw, kd = wu * pitch - gap, rd - gap
            _keycap(keys, uv, x + kd / 2, y + kw / 2, kw, kd, key_h, atlas_cell(label))
            y += wu * pitch
        x += rd
    kb_depth = x - kb_x0
    keys.normal_update()
    out['keys'] = _object('keys', keys, collection, smooth=False)

    out['well'] = _object('well', _rbox((kb_x0 + kb_depth / 2 - 0.005, 0, T + 0.001), (kb_depth + 0.04, W - 0.1, 0.004)),
                          collection, smooth=False)
    # the light that leaks between the keys
    bl = bmesh.new()
    z = T + 0.0035
    xs = (kb_x0, kb_x0 + kb_depth)
    ys = (-(W - 0.16) / 2, (W - 0.16) / 2)
    bl.faces.new([bl.verts.new((xs[0], ys[0], z)), bl.verts.new((xs[1], ys[0], z)),
                  bl.verts.new((xs[1], ys[1], z)), bl.verts.new((xs[0], ys[1], z))])
    out['backlight'] = _object('backlight', bl, collection, smooth=False)

    pad_x = kb_x0 + kb_depth + 0.04
    pad_d = max(0.2, DEPTH - pad_x - 0.1)
    out['trackpad'] = _object('trackpad', _rbox((pad_x + pad_d / 2, 0, T + 0.002), (pad_d, W * 0.34, 0.004), 0.002, 2), collection)
    parts = []
    for side in (-1, 1):
        parts.append(_rbox((kb_x0 + kb_depth / 2, side * (W / 2 - 0.045), T + 0.001), (kb_depth * 0.9, 0.028, 0.002)))
    parts.append(_cyl((-0.004, 0, HINGE_Z - 0.002), 0.026, W * 0.84, 'Y', 20))
    for i in range(3):
        parts.append(_rbox((0.3 + i * 0.085, -W / 2, 0.026), (0.034, 0.005, 0.012), 0.002, 2))
    parts.append(_cyl((0.62, -W / 2, 0.026), 0.007, 0.005, 'Y', 10))
    out['black'] = _object('black', _merge(parts), collection)

    feet = [_cyl((fx, fy, -0.003), 0.025, 0.008, 'Z', 14) for fx, fy in
            ((0.1, -W / 2 + 0.1), (0.1, W / 2 - 0.1), (DEPTH - 0.1, -W / 2 + 0.1), (DEPTH - 0.1, W / 2 - 0.1))]
    out['rubber'] = _object('rubber', _merge(feet), collection)
    out['led'] = _object('led', _rbox((DEPTH - 0.02, W / 2 - 0.004, 0.026), (0.012, 0.006, 0.006)), collection, smooth=False)

    # ---- lid: an Empty at the hinge, children modelled standing up, display toward +X -------------
    lid = bpy.data.objects.new('lid', None)
    lid.location = (0, 0, HINGE_Z)
    collection.objects.link(lid)
    out['lid'] = lid
    out['lid_shell'] = _object('lid_shell', _rbox((-LT / 2, 0, LID_H / 2), (LT, W, LID_H), 0.012, 3), collection, parent=lid)
    out['bezel'] = _object('bezel', _rbox((0.002, 0, LID_H / 2), (0.004, W - 0.02, LID_H - 0.02), 0.004, 2), collection, parent=lid)

    sc = bmesh.new()
    suv = sc.loops.layers.uv.new('UVMap')
    dy = BEZEL_BOTTOM + DISPLAY[1] / 2
    hw, hh = DISPLAY[0] / 2, DISPLAY[1] / 2
    sx = 0.0045
    f = sc.faces.new([sc.verts.new((sx, -hw, dy - hh)), sc.verts.new((sx, hw, dy - hh)),
                      sc.verts.new((sx, hw, dy + hh)), sc.verts.new((sx, -hw, dy + hh))])
    for loop, c in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop[suv].uv = c
    out['screen'] = _object('screen', sc, collection, parent=lid, smooth=False)

    cam = [_cyl((0.0048, 0, LID_H - BEZEL_TOP / 2), 0.006, 0.002, 'X', 12)]
    out['camera'] = _object('camera', _merge(cam), collection, parent=lid)
    out['cam_led'] = _object('cam_led', _cyl((0.0048, 0.02, LID_H - BEZEL_TOP / 2), 0.0022, 0.002, 'X', 8), collection, parent=lid)
    # the mark on the lid's back: a dart, a flat triangle
    em = bmesh.new()
    ex, ez = -LT - 0.001, LID_H * 0.56
    pts = [(ex, 0.0, ez + 0.075), (ex, -0.065, ez - 0.045), (ex, 0.065, ez - 0.045)]
    face = em.faces.new([em.verts.new(p) for p in pts])
    face.normal_flip()
    out['emblem'] = _object('emblem', em, collection, parent=lid, smooth=False)
    return out
