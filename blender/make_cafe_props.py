"""
The night city's restaurant terrace: bistro chairs, two laid tables, three parasols, planters, an
A-frame menu board and a festoon post, in one shared atlas and one GLB (public/models/cafe/).

    python3 blender/make_cafe_props.py                 # model, bake, export
    python3 blender/make_cafe_props.py --sheet DIR     # also a Cycles contact sheet of every prop
    npm run compress:models                            # then meshopt-pack the GLB

Every prop is built procedurally, in metres, twice from one description:

- the **near** mesh (HIGH): bentwood chairs with a curved cane back inside a bent hoop, a stretcher ring and
  a cane seat in a bentwood rim; marble-topped tables on a turned cast-iron column and three curved feet,
  laid for two (plates with food, wine glasses, a bottle, a candle in a jar, cutlery, napkins, a bud
  vase); market parasols whose eight fabric panels sag between their ribs, with a scalloped valance,
  ribs and stretchers underneath, a runner, a finial, a tapered pole and a weighted base; planters with
  boxwood; a chalk menu board; a festoon post;
- the **lean** mesh (phones, LOW): the same silhouettes from a handful of faces (a chair about 80
  triangles, a laid table about 70, a parasol about 70), its UVs carried over from the near mesh
  (nearest-face interpolation), so both tiers sample the one atlas.

The near mesh is smart-UV-unwrapped into its own tile of one 1024 atlas and Cycles bakes onto it, from
a copy that also carries what only a texture can hold (the cane weave, the marble's veins, the fabric's
weave and the chalk lettering, as procedural colour and bump): albedo and roughness (emission-rewired),
ambient occlusion over a ground plane (folded into the colour, kept in ORM.r), and tangent normals.

    cafe.glb                meshes `<id>` (near) and `<id>-lean`, metres, y up, front toward +z
    atlas-color.webp        1024, AO folded in        atlas-color-low.webp  512 (phones)
    atlas-orm.webp          1024 (r AO, g roughness, b metalness)
    atlas-normal.webp       1024, OpenGL convention (HIGH only)
    manifest.json           per prop: triangles near/lean, size; and the seat and table-top heights
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import make_yard_props as yp  # noqa: E402  (the yard set's scene, mesh and bake helpers)
from make_yard_props import box, cyl, finish, hexc, join, path_tube, sphere, torus, tris, tube  # noqa: E402

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = ARGV[ARGV.index('--out') + 1] if '--out' in ARGV else os.path.join(ROOT, 'public', 'models', 'cafe')
SHEET = ARGV[ARGV.index('--sheet') + 1] if '--sheet' in ARGV else None
ATLAS = 1024
yp.ATLAS = ATLAS
SPREAD = 6.0
SEAT = 0.46
TOP = 0.74


# ---- materials: plain, or with a procedural pattern (colour and bump) the bake carries into the atlas --

def lin(c):
    return [yp.srgb_to_lin(x) for x in c[:3]] + [1]


def pmat(name, a, b=None, rough=0.6, metal=0.0, kind=None, scale=40.0, bump=0.3):
    """A principled material; `kind` adds a pattern between colours a and b: weave, veins, wood, fabric."""
    if name in yp.MATS:
        return yp.MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    a = hexc(a) if isinstance(a, str) else a
    b = hexc(b) if isinstance(b, str) else (b or a)
    bsdf.inputs['Base Color'].default_value = lin(a)
    if kind:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        sock(mix.inputs, 'A_Color').default_value = lin(a)
        sock(mix.inputs, 'B_Color').default_value = lin(b)
        bmp = nt.nodes.new('ShaderNodeBump')
        bmp.inputs['Strength'].default_value = bump
        if kind == 'weave':
            # cane: two sets of strands over and under, a check of waves
            w1 = nt.nodes.new('ShaderNodeTexWave')
            w1.inputs['Scale'].default_value = scale
            w1.bands_direction = 'X'
            w2 = nt.nodes.new('ShaderNodeTexWave')
            w2.inputs['Scale'].default_value = scale
            w2.bands_direction = 'Y'
            ck = nt.nodes.new('ShaderNodeTexChecker')
            ck.inputs['Scale'].default_value = scale * 0.5
            for n in (w1, w2, ck):
                nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
            sel = nt.nodes.new('ShaderNodeMix')
            sel.data_type = 'FLOAT'
            nt.links.new(ck.outputs['Fac'], sock(sel.inputs, 'Factor_Float'))
            nt.links.new(w1.outputs['Fac'], sock(sel.inputs, 'A_Float'))
            nt.links.new(w2.outputs['Fac'], sock(sel.inputs, 'B_Float'))
            fac = sock(sel.outputs, 'Result_Float')
        elif kind == 'veins':
            nz = nt.nodes.new('ShaderNodeTexNoise')
            nz.inputs['Scale'].default_value = scale * 0.1
            nz.inputs['Detail'].default_value = 8
            wv = nt.nodes.new('ShaderNodeTexWave')
            wv.inputs['Scale'].default_value = scale * 0.06
            wv.inputs['Distortion'].default_value = 9
            wv.inputs['Detail'].default_value = 6
            nt.links.new(tc.outputs['Object'], wv.inputs['Vector'])
            ramp = nt.nodes.new('ShaderNodeValToRGB')
            ramp.color_ramp.elements[0].position = 0.0
            ramp.color_ramp.elements[1].position = 0.12
            nt.links.new(wv.outputs['Fac'], ramp.inputs['Fac'])
            fac = ramp.outputs['Color']
            bmp.inputs['Strength'].default_value = 0.02
        elif kind == 'wood':
            wv = nt.nodes.new('ShaderNodeTexWave')
            wv.inputs['Scale'].default_value = scale
            wv.inputs['Distortion'].default_value = 4
            wv.bands_direction = 'Z'
            nt.links.new(tc.outputs['Object'], wv.inputs['Vector'])
            fac = wv.outputs['Fac']
        elif kind == 'fabric':
            # a fine basket weave and a little soiling
            ck = nt.nodes.new('ShaderNodeTexChecker')
            ck.inputs['Scale'].default_value = scale
            nz = nt.nodes.new('ShaderNodeTexNoise')
            nz.inputs['Scale'].default_value = 3
            for n in (ck, nz):
                nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
            sel = nt.nodes.new('ShaderNodeMath')
            sel.operation = 'MULTIPLY'
            nt.links.new(nz.outputs['Fac'], sel.inputs[0])
            sel.inputs[1].default_value = 0.35
            fac = sel.outputs['Value']
            nt.links.new(ck.outputs['Fac'], bmp.inputs['Height'])
            bmp.inputs['Strength'].default_value = 0.08
        else:
            raise ValueError(kind)
        nt.links.new(fac, sock(mix.inputs, 'Factor_Float'))
        nt.links.new(sock(mix.outputs, 'Result_Color'), bsdf.inputs['Base Color'])
        if kind != 'fabric':
            nt.links.new(fac, bmp.inputs['Height'])
        nt.links.new(bmp.outputs['Normal'], bsdf.inputs['Normal'])
    yp.MATS[name] = m
    return m


def sock(socks, ident):
    return next(s for s in socks if s.identifier == ident)


def plain(name, c, rough=0.6, metal=0.0):
    return pmat(name, c, rough=rough, metal=metal)


def mesh_obj(name, verts, faces, m, smooth=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return finish(o, m, smooth)


def cut_to_top(o):
    """keep only the faces looking up (a plate seen from above)"""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < 0.5], context='FACES')
    bm.to_mesh(o.data)
    bm.free()


def drop_bottom(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.5], context='FACES')
    bm.to_mesh(o.data)
    bm.free()


def lathe(profile, seg, m, z0=0.0, cap_top=False, cap_bottom=True, smooth=0.9):
    """a surface of revolution about z from (radius, height) pairs, bottom first"""
    verts, faces = [], []
    n = len(profile)
    for k in range(seg):
        a = 2 * math.pi * k / seg
        for r, z in profile:
            verts.append((r * math.cos(a), r * math.sin(a), z0 + z))
    for k in range(seg):
        k2 = (k + 1) % seg
        for i in range(n - 1):
            faces.append((k * n + i, k2 * n + i, k2 * n + i + 1, k * n + i + 1))
    if cap_bottom and profile[0][0] > 1e-4:
        faces.append(tuple(k * n for k in range(seg))[::-1])
    if cap_top and profile[-1][0] > 1e-4:
        faces.append(tuple(k * n + n - 1 for k in range(seg)))
    return mesh_obj('lathe', verts, faces, m, smooth)


def text_mesh(body, size, at, m, rot_x=math.pi / 2, align='CENTER', extrude=0.0012):
    bpy.ops.object.text_add(location=(0, 0, 0))
    o = bpy.context.object
    o.data.body = body
    o.data.size = size
    o.data.align_x = align
    o.data.align_y = 'CENTER'
    o.data.extrude = extrude
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.object
    o.data.transform(Matrix.Rotation(rot_x, 4, 'X'))
    o.data.transform(Matrix.Translation(Vector(at)))
    return finish(o, m)


# ---- props (metres, z up, front toward -y so it exports facing +z) ----------------------------------------

def chair(lod):
    """A bentwood bistro chair: cane seat in a bent rim, the back legs rising into a bent hoop round a
    curved cane panel, splayed front legs and a stretcher ring. The sitter faces -y."""
    hi = lod == 'hi'
    seg = 8 if hi else 3
    wood = pmat('bentwood', '#3a2516', '#24160d', rough=0.42, kind='wood', scale=18, bump=0.05)
    cane = pmat('cane', '#c9a46a', '#8a6a3c', rough=0.7, kind='weave', scale=90, bump=0.6)
    parts, extra = [], []
    # the seat: a cane disc a little squared at the front, in its bentwood rim
    sseg = 24 if hi else 6
    s = cyl(0.205, 0.035 if hi else 0.045, (0, 0, SEAT - 0.018), cane, seg=sseg)
    for v in s.data.vertices:
        if v.co.y < 0:
            v.co.x *= 1.0 + 0.08 * (-v.co.y / 0.205)
    parts.append(s)
    if hi:
        rim = torus(0.205, 0.016, (0, 0, SEAT - 0.012), wood, seg=24, mseg=6)
        for v in rim.data.vertices:
            if v.co.y < 0:
                v.co.x *= 1.0 + 0.08 * (-v.co.y / 0.205)
        parts.append(rim)
    # splayed front legs
    for sx in (-1, 1):
        parts.append(tube((sx * 0.15, -0.13, SEAT - 0.02), (sx * 0.18, -0.18, 0.0), 0.015, wood, seg=seg))
    # the back legs run up into the hoop: one bent rod from floor to floor
    n = 12 if hi else 3
    pts = [(-0.165, 0.2, 0.0), (-0.145, 0.15, SEAT - 0.02), (-0.152, 0.175, 0.62)]
    for i in range(1, n):
        a = math.pi * i / n
        pts.append((-0.152 * math.cos(a), 0.18 + 0.03 * math.sin(a), 0.62 + 0.25 * math.sin(a)))
    pts += [(0.152, 0.175, 0.62), (0.145, 0.15, SEAT - 0.02), (0.165, 0.2, 0.0)]
    parts.append(path_tube(pts, 0.016, wood, seg=seg))
    # the cane back, curved round the sitter, filling the hoop
    cols, rows = (8, 6) if hi else (2, 2)
    verts, faces = [], []
    for j in range(rows + 1):
        v = j / rows
        for i in range(cols + 1):
            u = -1 + 2 * i / cols
            x = 0.135 * u
            top = 0.62 + 0.23 * math.sqrt(max(1 - u * u, 0.0)) ** 0.8 if hi else (0.8 if abs(u) < 0.5 else 0.66)
            z = 0.52 + (top - 0.52) * v
            y = 0.17 + 0.035 * (z - 0.52) / 0.3 + 0.03 * u * u
            verts.append((x, y, z))
    for j in range(rows):
        for i in range(cols):
            a = j * (cols + 1) + i
            faces.append((a, a + 1, a + cols + 2, a + cols + 1))
    parts.append(mesh_obj('back', verts, faces, cane, 0.8))
    if hi:
        # the stretcher ring and the seat's brace under it
        parts.append(torus(0.165, 0.009, (0, 0.0, 0.17), wood, seg=24, mseg=5))
        parts.append(torus(0.17, 0.01, (0, 0.0, SEAT - 0.06), wood, seg=24, mseg=5))
    return parts, extra


def table(lod, variant):
    """A round marble bistro table on a turned cast-iron column and three curved feet, laid for two across
    y (the chairs stand at y = +-0.5): plates with a meal, wine glasses, a bottle, a candle in a jar."""
    hi = lod == 'hi'
    marble = pmat('marble', '#ece7dc', '#9a958d', rough=0.25, kind='veins', scale=60)
    iron = plain('cast-iron', hexc('#1d1e21'), 0.45, 0.6)
    brass = plain('brass', hexc('#b08a3e'), 0.3, 0.9)
    china = plain('china', hexc('#f4f1ea'), 0.25)
    glass = plain('glass', hexc('#cfe3e6'), 0.08)
    wine = plain('red-wine', hexc('#4a0d16'), 0.15)
    bottle = plain('bottle-green', hexc('#1d3a22'), 0.15, 0.1) if variant == 'a' else plain('bottle-amber', hexc('#6a3a12'), 0.15, 0.1)
    label = plain('label', hexc('#e8dcc0'), 0.7)
    wax = plain('wax', hexc('#f6efd9'), 0.5)
    jar = plain('jar-amber', hexc('#c7782a'), 0.2)
    napkin = pmat('napkin', '#f2ede2', '#d8d0c0', rough=0.85, kind='fabric', scale=200)
    steel = plain('cutlery', hexc('#c8ccd2'), 0.2, 1.0)
    parts, extra = [], []
    seg = 32 if hi else 8
    parts.append(cyl(0.33, 0.026, (0, 0, TOP - 0.013), marble, seg=seg))
    if not hi:
        drop_bottom(parts[-1])
    if hi:
        parts.append(torus(0.33, 0.012, (0, 0, TOP - 0.016), brass, seg=32, mseg=5))
        prof = [(0.05, 0.0), (0.045, 0.04), (0.03, 0.08), (0.038, 0.12), (0.024, 0.2), (0.02, 0.48), (0.03, 0.56),
                (0.022, 0.6), (0.026, 0.66), (0.06, 0.7), (0.07, TOP - 0.026)]
        parts.append(lathe(prof, 12, iron, cap_top=True))
        for k in range(3):
            a = 2 * math.pi * k / 3 + math.pi / 2
            c, s = math.cos(a), math.sin(a)
            pts = [(c * r, s * r, z) for r, z in ((0.03, 0.09), (0.12, 0.07), (0.2, 0.035), (0.26, 0.02))]
            parts.append(path_tube(pts, 0.018, iron, seg=6))
            parts.append(sphere(0.022, (c * 0.27, s * 0.27, 0.018), iron, seg=8, rings=5, scale=(1, 1, 0.7)))
    else:
        parts.append(cyl(0.03, TOP - 0.03, (0, 0, (TOP - 0.03) / 2), iron, seg=4, cap=False))
        parts.append(cyl(0.24, 0.05, (0, 0, 0.025), iron, seg=5, r2=0.04, cap=False))
    t = TOP
    meals = {'a': ('pasta', 'salad'), 'b': ('pizza', 'steak')}[variant]
    for side, meal in zip((-1, 1), meals):
        y = side * 0.18
        if hi:
            parts.append(lathe([(0.0, 0.0), (0.08, 0.0), (0.1, 0.008), (0.125, 0.016), (0.12, 0.018), (0.095, 0.011),
                                (0.0, 0.011)], 24, china, z0=t, cap_bottom=False))
            parts[-1].data.transform(Matrix.Translation((0, y, 0)))
        else:
            parts.append(cyl(0.12, 0.02, (0, y, t + 0.01), china, seg=6, r2=0.115))
            # only its top: the rim and the underside are below the table's edge from anywhere
            cut_to_top(parts[-1])
        # the meal on the plate
        if hi:
            if meal == 'pasta':
                f = plain('pasta', hexc('#e3b04b'), 0.55)
                for k in range(5):
                    a = k * 1.3
                    parts.append(torus(0.03, 0.009, (0.025 * math.cos(a), y + 0.025 * math.sin(a), t + 0.02 + 0.006 * k),
                                       f, seg=10, mseg=4, rot=(0.3 * k, 0.5, a)))
                parts.append(sphere(0.03, (0, y, t + 0.025), plain('sauce', hexc('#a8321e'), 0.4), seg=10, rings=6, scale=(1, 1, 0.45)))
            elif meal == 'salad':
                f = plain('leaves', hexc('#5c8f3a'), 0.6)
                for k in range(7):
                    a = k * 0.9
                    parts.append(sphere(0.028, (0.04 * math.cos(a), y + 0.04 * math.sin(a), t + 0.024), f, seg=8, rings=5,
                                        scale=(1.2, 0.8, 0.5)))
                parts.append(sphere(0.012, (0.01, y, t + 0.04), plain('tomato', hexc('#c8321f'), 0.35), seg=8, rings=5))
            elif meal == 'pizza':
                parts.append(cyl(0.105, 0.012, (0, y, t + 0.018), plain('crust', hexc('#c98b45'), 0.7), seg=20))
                parts.append(cyl(0.09, 0.006, (0, y, t + 0.026), plain('tomato-sauce', hexc('#b8361f'), 0.5), seg=20))
                for k in range(6):
                    a = k * 1.05
                    parts.append(cyl(0.014, 0.004, (0.05 * math.cos(a), y + 0.05 * math.sin(a), t + 0.03),
                                     plain('mozzarella', hexc('#f3ecd2'), 0.5), seg=8))
            else:
                parts.append(sphere(0.06, (0, y, t + 0.02), plain('steak', hexc('#5e2e1a'), 0.55), seg=12, rings=6,
                                    scale=(1.1, 0.7, 0.25)))
                for k in range(4):
                    parts.append(box((0.012, 0.012, 0.05), (0.06, y - 0.02 + 0.012 * k, t + 0.02),
                                     plain('fries', hexc('#e3b55a'), 0.6), rot=(0, 0, 0.3 * k)))
            # a wine glass with wine in it, cutlery, a napkin
            gx = 0.13
            gy = y - side * 0.07
            extra_glass = lathe([(0.03, 0.0), (0.004, 0.004), (0.004, 0.07), (0.02, 0.085), (0.035, 0.12), (0.032, 0.16)],
                                10, glass, z0=t, cap_bottom=True)
            extra_glass.data.transform(Matrix.Translation((gx, gy, 0)))
            parts.append(extra_glass)
            parts.append(cyl(0.026, 0.02, (gx, gy, t + 0.1), wine, seg=10))
            parts.append(box((0.012, 0.18, 0.004), (-0.145, y, t + 0.003), steel))
            parts.append(box((0.012, 0.18, 0.004), (0.145, y, t + 0.003), steel))
            parts.append(box((0.07, 0.11, 0.012), (-0.18, y - side * 0.02, t + 0.008), napkin, rot=(0, 0, 0.2 * side), bevel=0.004))
        else:
            parts.append(cyl(0.07, 0.03, (0, y, t + 0.03), plain('meal-' + meal, hexc({'pasta': '#d9a441', 'salad': '#6d9a49',
                                                                                     'pizza': '#c4522e', 'steak': '#6a3420'}[meal]), 0.6), seg=5, r2=0.0, cap=False))
    # the bottle, the candle in its jar, a bud vase
    if hi:
        b = lathe([(0.0, 0.0), (0.036, 0.0), (0.038, 0.004), (0.038, 0.19), (0.03, 0.22), (0.013, 0.25), (0.012, 0.3), (0.014, 0.305),
                   (0.0, 0.305)], 14, bottle, z0=t)
        b.data.transform(Matrix.Translation((-0.07, 0.0, 0)))
        parts.append(b)
        parts.append(cyl(0.0385, 0.07, (-0.07, 0.0, t + 0.1), label, seg=14, cap=False))
        parts.append(cyl(0.032, 0.075, (0.06, 0.02, t + 0.0375), jar, seg=12))
        parts.append(cyl(0.022, 0.045, (0.06, 0.02, t + 0.045), wax, seg=10))
        parts.append(cyl(0.012, 0.09, (0.0, -0.06, t + 0.045), glass, seg=8, r2=0.008))
        parts.append(tube((0.0, -0.06, t + 0.08), (0.005, -0.062, t + 0.14), 0.003, plain('stem', hexc('#3b6b44'), 0.6), seg=4))
        parts.append(sphere(0.016, (0.005, -0.062, t + 0.145), plain('flower', hexc('#d8455e'), 0.6), seg=8, rings=5))
    else:
        parts.append(cyl(0.035, 0.3, (-0.07, 0.0, t + 0.15), bottle, seg=4, r2=0.012, cap=False))
        parts.append(cyl(0.03, 0.07, (0.06, 0.02, t + 0.035), jar, seg=3, r2=0.026, cap=False))
    return parts, extra


PARASOLS = {
    # id: (panel colours, alternating by sector; valance colour)
    'parasol-stripe': (('#efe5cf', '#b3302a'), '#b3302a'),
    'parasol-green': (('#2e5a3c',), '#e9dfc6'),
    'parasol-brand': (('#127a72',), '#f1ead9'),
}


def parasol(lod, pid):
    """A market parasol: eight fabric panels sagging between ribs, a scalloped valance, ribs and
    stretchers under it, a runner on a tapered pole, a finial, a weighted base."""
    hi = lod == 'hi'
    colours, val = PARASOLS[pid]
    panels = [pmat(f'canvas-{c}', c, rough=0.85, kind='fabric', scale=160) for c in colours]
    valance = pmat(f'canvas-{val}', val, rough=0.85, kind='fabric', scale=160)
    wood = pmat('pole-wood', '#6b4a2c', '#4a321d', rough=0.5, kind='wood', scale=30, bump=0.05)
    steel = plain('parasol-steel', hexc('#2a2b2e'), 0.4, 0.8)
    stone = pmat('base-granite', '#4b4a48', '#2a2a29', rough=0.7, kind='veins', scale=90)
    R, HUB, RIM = 1.3, 2.47, 2.1
    SECT = 8
    parts, extra = [], []
    radial = 6 if hi else 2
    ang = 6 if hi else 2

    def canopy(r, f, k):
        """a point on the canopy: radius r, fraction f across sector k"""
        a = 2 * math.pi * (k + f) / SECT
        u = r / R
        z = HUB + (RIM - HUB) * u + 0.07 * math.sin(math.pi * u)
        sag = 0.075 * math.sin(math.pi * f) * u ** 1.2
        rr = r * (1 - 0.035 * math.sin(math.pi * f) * u)
        return (rr * math.cos(a), rr * math.sin(a), z - sag)
    for k in range(SECT):
        verts, faces = [canopy(0, 0, k)], []
        for i in range(1, radial + 1):
            for j in range(ang + 1):
                verts.append(canopy(R * i / radial, j / ang, k))
        for j in range(ang):
            faces.append((0, 1 + j, 2 + j))
        for i in range(1, radial):
            a0 = 1 + (i - 1) * (ang + 1)
            a1 = 1 + i * (ang + 1)
            for j in range(ang):
                faces.append((a0 + j, a1 + j, a1 + j + 1, a0 + j + 1))
        parts.append(mesh_obj('panel', verts, faces, panels[k % len(panels)], 0.9))
        # the valance hangs from the rim, scalloped at the bottom
        vs = 6 if hi else 1
        vv, vf = [], []
        for j in range(vs + 1):
            f = j / vs
            p = Vector(canopy(R, f, k))
            drop = 0.17 - (0.06 * abs(math.sin(math.pi * f)) if hi else 0.03)
            vv += [tuple(p + Vector((0, 0, 0.005))), tuple(p - Vector((0, 0, drop)))]
        for j in range(vs):
            vf.append((2 * j, 2 * j + 1, 2 * j + 3, 2 * j + 2))
        parts.append(mesh_obj('valance', vv, vf, valance, 0.9))
    if hi:
        for k in range(SECT):
            p0 = Vector(canopy(0.06, 0, k)) - Vector((0, 0, 0.03))
            pts = [tuple(Vector(canopy(R * i / 5, 0, k)) - Vector((0, 0, 0.018))) for i in range(1, 6)]
            parts.append(path_tube([tuple(p0)] + pts, 0.007, steel, seg=4))
            mid = Vector(canopy(R * 0.55, 0, k)) - Vector((0, 0, 0.02))
            parts.append(tube((0, 0, 1.82), tuple(mid), 0.005, steel, seg=4))
        parts.append(cyl(0.035, 0.12, (0, 0, 1.82), steel, seg=10))
        parts.append(cyl(0.05, 0.05, (0, 0, HUB + 0.02), steel, seg=12, r2=0.02))
        parts.append(sphere(0.03, (0, 0, HUB + 0.07), wood, seg=10, rings=6))
        parts.append(cyl(0.024, HUB, (0, 0, HUB / 2), wood, seg=10, r2=0.019))
        parts.append(box((0.5, 0.5, 0.09), (0, 0, 0.045), stone, bevel=0.012))
        parts.append(cyl(0.045, 0.12, (0, 0, 0.15), steel, seg=10, r2=0.03))
    else:
        parts.append(cyl(0.025, HUB, (0, 0, HUB / 2), wood, seg=4, cap=False))
        parts.append(box((0.5, 0.5, 0.09), (0, 0, 0.045), stone))
    return parts, extra


def planter(lod):
    """A long planter of dark-stained boards with clipped boxwood: the terrace's fence line."""
    hi = lod == 'hi'
    wood = pmat('planter-wood', '#3d2c1f', '#26190f', rough=0.7, kind='wood', scale=10, bump=0.25)
    soil = plain('soil', hexc('#2a1f17'), 0.95)
    leaf = pmat('boxwood', '#2f5a2a', '#1c3a1a', rough=0.8, kind='weave', scale=60, bump=0.9)
    parts = [box((1.2, 0.36, 0.44), (0, 0, 0.22), wood, bevel=0.015 if hi else 0.0)]
    if hi:
        parts.append(box((1.14, 0.3, 0.02), (0, 0, 0.42), soil))
        for x in (-0.6, 0.6):
            for y in (-0.18, 0.18):
                parts.append(box((0.05, 0.05, 0.47), (x, y, 0.235), wood, bevel=0.008))
    # clipped boxwood: overlapping lumpy domes along the box (one long dome on the lean mesh)
    blobs = [(-0.4, 0.24), (-0.13, 0.27), (0.14, 0.25), (0.41, 0.23)] if hi else [(0.0, 0.62)]
    for k, (bx, br) in enumerate(blobs):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3 if hi else 2, radius=1, location=(0, 0, 0))
        o = bpy.context.object
        for v in o.data.vertices:
            x, y, z = v.co
            n = 1 + (0.09 * math.sin(x * 11 + z * 7 + k) * math.sin(y * 9 - x * 5 + 2 * k) + 0.05 * math.sin(z * 17 + x * 13) if hi else 0)
            sy = 0.19 if hi else 0.2
            v.co = Vector((bx + x * br * n, y * sy * n, max(z, -0.4) * (0.2 if hi else 0.21) * n + 0.6))
        parts.append(finish(o, leaf, 1.2))
    return parts, []


def menu_board(lod):
    """An A-frame chalk board: the day's menu in chalk on the face toward the street (-y)."""
    hi = lod == 'hi'
    wood = pmat('frame-wood', '#6b4a2c', '#4a321d', rough=0.6, kind='wood', scale=24, bump=0.1)
    slate = pmat('slate', '#1e2321', '#2b302d', rough=0.85, kind='veins', scale=40)
    chalk = plain('chalk', hexc('#efeae0'), 0.9)
    chalk_r = plain('chalk-red', hexc('#e0605a'), 0.9)
    chalk_y = plain('chalk-yellow', hexc('#f0c75a'), 0.9)
    parts, extra = [], []
    tilt = 0.2
    H = 0.95
    for side in (-1, 1):
        objs = [box((0.62, 0.03, H), (0, 0, H / 2), wood, bevel=0.008 if hi else 0.0)]
        objs.append(box((0.54, 0.034, H - 0.12), (0, 0, H / 2 + 0.01), slate))
        if side < 0 and hi:
            f = -0.0175
            extra += [
                text_mesh('TRATTORIA', 0.075, (0, f, 0.83), chalk_y),
                text_mesh('LUNA', 0.06, (0, f, 0.75), chalk_y),
                text_mesh('~ stasera ~', 0.04, (0, f, 0.67), chalk_r),
                text_mesh('tagliatelle   14', 0.036, (0, f, 0.59), chalk),
                text_mesh('pizza margherita   11', 0.032, (0, f, 0.53), chalk),
                text_mesh('risotto funghi   15', 0.032, (0, f, 0.47), chalk),
                text_mesh('tiramisu   7', 0.032, (0, f, 0.41), chalk),
                text_mesh('vino della casa', 0.032, (0, f, 0.33), chalk_r),
                text_mesh('6 / 22', 0.032, (0, f, 0.28), chalk_r),
            ]
        rot = Matrix.Translation((0, side * 0.22, 0)) @ Matrix.Rotation(side * tilt, 4, 'X')
        for o in objs + (extra if side < 0 else []):
            o.data.transform(rot)
        parts += objs
    return parts, extra


def post(lod):
    """A black steel post the festoon lights hang from, with a ring at the top."""
    hi = lod == 'hi'
    steel = plain('post-steel', hexc('#1f2023'), 0.45, 0.7)
    parts = [cyl(0.03, 2.7, (0, 0, 1.35), steel, seg=10 if hi else 4, r2=0.024)]
    if hi:
        parts.append(box((0.2, 0.2, 0.04), (0, 0, 0.02), steel, bevel=0.008))
        parts.append(torus(0.04, 0.008, (0, 0, 2.66), steel, seg=12, mseg=4, rot=(math.pi / 2, 0, 0)))
        parts.append(sphere(0.035, (0, 0, 2.72), steel, seg=10, rings=6))
    return parts, []


PROPS = {
    # id: (builder, tile px)
    'chair': (chair, 256),
    'table-a': (lambda lod: table(lod, 'a'), 256),
    'table-b': (lambda lod: table(lod, 'b'), 256),
    'parasol-stripe': (lambda lod: parasol(lod, 'parasol-stripe'), 256),
    'parasol-green': (lambda lod: parasol(lod, 'parasol-green'), 256),
    'parasol-brand': (lambda lod: parasol(lod, 'parasol-brand'), 256),
    'planter': (planter, 256),
    'menu': (menu_board, 256),
    'post': (post, 64),
}


# ---- build -----------------------------------------------------------------------------------------------

def unwrap(o):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    for uv in list(o.data.uv_layers):
        o.data.uv_layers.remove(uv)
    o.data.uv_layers.new(name='UVMap')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.quads_convert_to_tris()
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.02, area_weight=0.0, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    o.select_set(False)


def transfer_uvs(src, dst):
    """the lean mesh samples the near mesh's tile: each lean face corner takes the UV of the nearest
    near-mesh point facing the same way (barycentric on its triangle), probed a little inside the face
    so a face never straddles two islands"""
    from mathutils.bvhtree import BVHTree
    from mathutils.geometry import barycentric_transform
    sm = src.data
    sm.calc_loop_triangles()
    suv = sm.uv_layers.active.data
    tris_ = [(t.vertices[:], t.loops[:], t.normal.copy()) for t in sm.loop_triangles]
    bvh = BVHTree.FromPolygons([v.co.copy() for v in sm.vertices], [t[0] for t in tris_])
    bm = bmesh.new()
    bm.from_mesh(dst.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    for old in list(bm.loops.layers.uv.values()):
        bm.loops.layers.uv.remove(old)
    uvl = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        c = f.calc_center_median()
        n = f.normal
        for lp in f.loops:
            q = lp.vert.co * 0.85 + c * 0.15
            best = None
            for co, nrm, idx, dist in bvh.find_nearest_range(q, 0.25):
                tn = tris_[idx][2]
                score = dist + 0.2 * (1 - max(-1.0, min(1.0, tn.dot(n))))
                if best is None or score < best[0]:
                    best = (score, co, idx)
            if best is None:
                co, nrm, idx, dist = bvh.find_nearest(q)
                best = (0, co, idx)
            _, co, idx = best
            vs, ls, _ = tris_[idx]
            p = [sm.vertices[v].co for v in vs]
            uv = [Vector((suv[l].uv[0], suv[l].uv[1], 0)) for l in ls]
            lp[uvl].uv = barycentric_transform(co, p[0], p[1], p[2], uv[0], uv[1], uv[2]).xy
    for uv in list(dst.data.uv_layers):
        dst.data.uv_layers.remove(uv)
    bm.to_mesh(dst.data)
    bm.free()


def main():
    yp.reset()
    os.makedirs(OUT, exist_ok=True)
    ids = list(PROPS)
    tiles = yp.pack({k: PROPS[k][1] for k in ids})
    built = {}
    for i, pid in enumerate(ids):
        fn = PROPS[pid][0]
        parts, extra = fn('hi')
        near = join(parts, pid)
        # the bake source: the near mesh's own surfaces with their patterned materials, plus the chalk
        src = near.copy()
        src.data = near.data.copy()
        bpy.context.collection.objects.link(src)
        src.name = pid + '#src'
        if extra:
            src = join([src] + extra, pid + '#src')
        lparts, lextra = fn('lean')
        for e in lextra:
            bpy.data.objects.remove(e, do_unlink=True)
        lean = join(lparts, pid + '-lean')
        # ground every tier by the near mesh's footprint
        bb = [near.matrix_world @ Vector(c) for c in near.bound_box]
        mn = Vector([min(v[k] for v in bb) for k in range(3)])
        mx = Vector([max(v[k] for v in bb) for k in range(3)])
        off = Matrix.Translation(-Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, 0)))
        if pid.startswith('chair') or pid.startswith('table'):
            off = Matrix.Identity(4)   # the chair's seat and the table's column stay on the origin
        for o in (near, src, lean):
            o.data.transform(off)
        near.data.materials.clear()
        lean.data.materials.clear()
        unwrap(near)
        yp.place_uvs(near, tiles[pid])
        transfer_uvs(near, lean)
        bpy.ops.object.select_all(action='DESELECT')
        for o in (near, lean):
            bpy.context.view_layer.objects.active = o
            o.select_set(True)
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(45))
            o.select_set(False)
        at = Matrix.Translation(((i % 4) * SPREAD, (i // 4) * SPREAD, 0))
        for o in (near, src):
            o.matrix_world = at
        built[pid] = dict(near=near, src=src, lean=lean, size=[mx.x - mn.x, mx.z - mn.z, mx.y - mn.y])
        print('built', pid, tris(near), tris(lean), flush=True)

    bpy.ops.mesh.primitive_plane_add(size=SPREAD * 6, location=(SPREAD * 1.5, SPREAD * 1, -0.002))
    ground = bpy.context.object
    ground.data.materials.append(plain('ground', (0.3, 0.3, 0.3), 0.9))
    for pid in ids:
        built[pid]['lean'].hide_render = True

    copies = []
    for pid in ids:
        c = built[pid]['near'].copy()
        c.data = built[pid]['near'].data.copy()
        bpy.context.collection.objects.link(c)
        copies.append(c)
    target = join(copies, '#bake')
    bake_mat = bpy.data.materials.new('#bake')
    bake_mat.use_nodes = True
    target.data.materials.clear()
    target.data.materials.append(bake_mat)
    for pid in ids:
        built[pid]['near'].hide_render = True
    imgs = {}
    for name, srgb in (('color', True), ('rough', False), ('metal', False), ('ao', False), ('normal', False)):
        img = bpy.data.images.new(name, ATLAS, ATLAS, alpha=False, float_buffer=False)
        img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        imgs[name] = img
    node = bake_mat.node_tree.nodes.new('ShaderNodeTexImage')
    bake_mat.node_tree.nodes.active = node
    sources = [built[p]['src'] for p in ids]
    src_mats = {m for o in sources for m in o.data.materials if m and m.use_nodes}
    scene = bpy.context.scene
    bk = scene.render.bake
    bk.use_selected_to_active = True
    bk.cage_extrusion = 0.012
    bk.max_ray_distance = 0.03
    bk.margin = 4

    def bake(kind, img, samples, **kw):
        node.image = img
        scene.cycles.samples = samples
        bpy.ops.object.select_all(action='DESELECT')
        for o in sources:
            o.select_set(True)
        target.select_set(True)
        bpy.context.view_layer.objects.active = target
        print('bake', img.name, flush=True)
        bpy.ops.object.bake(type=kind, **kw)

    for channel, img in (('base', 'color'), ('rough', 'rough'), ('metal', 'metal')):
        yp.rewire(src_mats, channel)
        bake('EMIT', imgs[img], 2)
    yp.rewire(src_mats, None)
    scene.world = bpy.data.worlds.new('w')
    scene.world.light_settings.distance = 0.4
    bake('AO', imgs['ao'], 64)
    bake('NORMAL', imgs['normal'], 2, normal_space='TANGENT')

    import numpy as np
    from PIL import Image

    def arr(img):
        return np.array(img.pixels[:], dtype=np.float32).reshape(ATLAS, ATLAS, 4)[::-1]
    col = arr(imgs['color'])[..., :3]
    ao = arr(imgs['ao'])[..., 0]
    rough = arr(imgs['rough'])[..., 0]
    metal = arr(imgs['metal'])[..., 0]
    nrm = arr(imgs['normal'])[..., :3]
    lin_c = np.where(col <= 0.04045, col / 12.92, ((col + 0.055) / 1.055) ** 2.4)
    lin_c *= (0.4 + 0.6 * ao)[..., None]
    enc = np.where(lin_c <= 0.0031308, lin_c * 12.92, 1.055 * np.power(np.clip(lin_c, 0, 1), 1 / 2.4) - 0.055)
    to8 = lambda a: Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8))
    to8(enc).save(os.path.join(OUT, 'atlas-color.webp'), quality=90, method=6)
    to8(enc).resize((ATLAS // 2, ATLAS // 2), Image.LANCZOS).save(os.path.join(OUT, 'atlas-color-low.webp'), quality=86, method=6)
    to8(np.stack([ao, rough, metal], -1)).save(os.path.join(OUT, 'atlas-orm.webp'), quality=90, method=6)
    to8(nrm).save(os.path.join(OUT, 'atlas-normal.webp'), quality=92, method=6)

    bpy.ops.object.select_all(action='DESELECT')
    manifest = {'units': 'metres', 'seat': SEAT, 'top': TOP, 'props': {}}
    exported = []
    for pid in ids:
        b = built[pid]
        b['near'].matrix_world = Matrix.Identity(4)
        b['lean'].matrix_world = Matrix.Identity(4)
        for o in (b['near'], b['lean']):
            o.hide_render = False
            o.data.materials.clear()
            exported.append(o)
        w, h, d = b['size']
        manifest['props'][pid] = {'tris': tris(b['near']), 'lean': tris(b['lean']),
                                  'size': [round(w, 3), round(h, 3), round(d, 3)]}
        print('out', pid, tris(b['near']), tris(b['lean']), flush=True)
    for o in exported:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'cafe.glb'), export_format='GLB', use_selection=True,
                              export_materials='NONE', export_texcoords=True, export_normals=True,
                              export_apply=True, export_yup=True)
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
    if SHEET:
        contact_sheet(ids, built, SHEET)


def contact_sheet(ids, built, folder):
    """near (top row) and lean (bottom row) of every prop, sun and sky, the baked atlas on them"""
    os.makedirs(folder, exist_ok=True)
    m = bpy.data.materials.new('#sheet')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = bpy.data.images.load(os.path.join(OUT, 'atlas-color.webp'))
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.6
    for o in bpy.data.objects:
        o.hide_render = True
    x = 0.0
    for pid in ids:
        w = max(built[pid]['size'][0], built[pid]['size'][2], 0.6)
        for row, key in enumerate(('near', 'lean')):
            o = built[pid][key]
            o.hide_render = False
            o.data.materials.append(m)
            o.matrix_world = Matrix.Translation((x + w / 2, row * -3.2, 0))
        x += w + 0.25
    bpy.ops.object.light_add(type='SUN', rotation=(0.9, 0.2, 0.7))
    bpy.context.object.data.energy = 3.5
    bpy.context.scene.world.color = (0.45, 0.5, 0.58)
    bpy.ops.object.camera_add(location=(x / 2, -9.5, 6.0), rotation=(math.radians(64), 0, 0))
    cam = bpy.context.object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = x + 0.6
    scene = bpy.context.scene
    scene.camera = cam
    scene.render.resolution_x = 2000
    scene.render.resolution_y = 900
    scene.cycles.samples = 32
    scene.render.filepath = os.path.join(folder, 'cafe-sheet.png')
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
