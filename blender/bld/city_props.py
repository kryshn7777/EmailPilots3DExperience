"""The night city's procedural street and rooftop props (bpy), in metres, front toward -Y (glTF +Z).

Each builder returns a list of objects with ordinary Principled materials (colour, roughness and a
noise-driven grime layer); `make_city_props.py` bakes them into the shared atlas with the Poly Haven
props. Kept deliberately low-poly: the detail that matters at the city's scale (a person is 0.76 site
units) is in the silhouettes and the baked occlusion.
"""
import math
import random

import bpy
import bmesh
from mathutils import Matrix, Vector


# ---------------------------------------------------------------- materials
def mat(name, color, rough=0.6, grime=0.35, scale=6.0, dark=0.45, streak=False):
    """Principled material whose colour is broken up by grime (noise) and, if `streak`, by vertical rain streaks."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = rough
    base = Vector(color) if len(color) == 4 else Vector((*color, 1.0))
    dirty = Vector((base[0] * dark, base[1] * dark * 0.95, base[2] * dark * 0.85, 1.0))
    tc = nt.nodes.new('ShaderNodeTexCoord')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = scale
    noise.inputs['Detail'].default_value = 6.0
    if streak:
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (6.0, 6.0, 0.4)
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
        nt.links.new(mp.outputs['Vector'], noise.inputs['Vector'])
    else:
        nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.5 - grime * 0.35
    ramp.color_ramp.elements[1].position = 0.5 + grime * 0.35
    ramp.color_ramp.elements[0].color = dirty
    ramp.color_ramp.elements[1].color = base
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    return m


def poster_mat(name, seed):
    """A bill-posted patch: bright blocks of colour (wave + voronoi), torn and faded by noise."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    rnd = random.Random(seed)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = 0.55
    tc = nt.nodes.new('ShaderNodeTexCoord')
    vor = nt.nodes.new('ShaderNodeTexVoronoi')
    vor.inputs['Scale'].default_value = 1.6 + rnd.random() * 1.5
    vor.feature = 'F1'
    nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    palette = [(0.85, 0.12, 0.1), (0.95, 0.75, 0.1), (0.1, 0.35, 0.75), (0.92, 0.9, 0.85), (0.1, 0.1, 0.12),
               (0.85, 0.3, 0.55), (0.2, 0.6, 0.35)]
    rnd.shuffle(palette)
    els = ramp.color_ramp.elements
    els[0].color = (*palette[0], 1)
    els[1].position = 0.5
    els[1].color = (*palette[1], 1)
    e = els.new(0.25)
    e.color = (*palette[2], 1)
    e = els.new(0.75)
    e.color = (*palette[3], 1)
    nt.links.new(vor.outputs['Color'], ramp.inputs['Fac'])
    # stripes of "type" over the colour
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 9.0
    wave.inputs['Distortion'].default_value = 0.0
    nt.links.new(tc.outputs['Object'], wave.inputs['Vector'])
    gt = nt.nodes.new('ShaderNodeMath')
    gt.operation = 'GREATER_THAN'
    gt.inputs[1].default_value = 0.82
    nt.links.new(wave.outputs['Fac'], gt.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['B'].default_value = (0.06, 0.06, 0.07, 1)
    nt.links.new(gt.outputs['Value'], mix.inputs['Factor'])
    nt.links.new(ramp.outputs['Color'], mix.inputs['A'])
    # faded and torn: noise mixes toward the grey paper and the board below
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 3.0
    noise.inputs['Detail'].default_value = 8.0
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    r2 = nt.nodes.new('ShaderNodeValToRGB')
    r2.color_ramp.elements[0].position = 0.38
    r2.color_ramp.elements[1].position = 0.62
    nt.links.new(noise.outputs['Fac'], r2.inputs['Fac'])
    mix2 = nt.nodes.new('ShaderNodeMix')
    mix2.data_type = 'RGBA'
    mix2.inputs['A'].default_value = (0.42, 0.36, 0.28, 1)
    nt.links.new(r2.outputs['Color'], mix2.inputs['Factor'])
    nt.links.new(mix.outputs['Result'], mix2.inputs['B'])
    nt.links.new(mix2.outputs['Result'], bsdf.inputs['Base Color'])
    return m


# ---------------------------------------------------------------- geometry helpers
def _obj(name, bm, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if material is not None:
        o.data.materials.append(material)
    return o


def box(name, size, at, material, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    m = Matrix.Diagonal((*size, 1.0))
    if rot:
        m = rot.to_4x4() @ m
    bmesh.ops.transform(bm, matrix=Matrix.Translation(at) @ m, verts=bm.verts)
    return _obj(name, bm, material)


def cyl(name, r0, r1, h, at, material, seg=12, axis='Z', cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r0, radius2=r1, depth=h)
    rot = Matrix()
    if axis == 'X':
        rot = Matrix.Rotation(math.pi / 2, 4, 'Y')
    elif axis == 'Y':
        rot = Matrix.Rotation(math.pi / 2, 4, 'X')
    bmesh.ops.transform(bm, matrix=Matrix.Translation(at) @ rot, verts=bm.verts)
    return _obj(name, bm, material)


def tube(name, pts, r, material, seg=6):
    """A pipe along a polyline (each segment its own open cylinder, joints hidden by the overlap)."""
    bm = bmesh.new()
    for a, b in zip(pts[:-1], pts[1:]):
        a, b = Vector(a), Vector(b)
        d = b - a
        L = d.length
        if L < 1e-6:
            continue
        geom = bmesh.ops.create_cone(bm, cap_ends=False, segments=seg, radius1=r, radius2=r, depth=L + r)
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4(), verts=geom['verts'])
    return _obj(name, bm, material)


def torus(name, R, r, at, material, seg=20, rseg=5, axis='X'):
    bm = bmesh.new()
    verts = []
    for i in range(seg):
        a = i / seg * math.tau
        ring = []
        for j in range(rseg):
            b = j / rseg * math.tau
            p = Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
            ring.append(bm.verts.new(p))
        verts.append(ring)
    for i in range(seg):
        for j in range(rseg):
            a, b = verts[i][j], verts[(i + 1) % seg][j]
            c, d = verts[(i + 1) % seg][(j + 1) % rseg], verts[i][(j + 1) % rseg]
            bm.faces.new((a, b, c, d))
    rot = Matrix.Rotation(math.pi / 2, 4, 'Y') if axis == 'X' else Matrix.Rotation(math.pi / 2, 4, 'X') if axis == 'Y' else Matrix()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(at) @ rot, verts=bm.verts)
    return _obj(name, bm, material)


def join(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


# ---------------------------------------------------------------- props
def water_tank():
    """A New York roof tank: cedar staves bound by steel hoops, a conical cap, on a steel stand."""
    wood = mat('tank_wood', (0.36, 0.25, 0.17), 0.85, 0.6, 3.0, 0.5, streak=True)
    steel = mat('tank_steel', (0.12, 0.12, 0.13), 0.6, 0.5, 4.0, 0.6)
    roof = mat('tank_roof', (0.2, 0.18, 0.16), 0.8, 0.5, 5.0, 0.6)
    parts = []
    base = 2.2
    R, H = 1.45, 2.9
    parts.append(cyl('staves', R, R * 0.97, H, (0, 0, base + H / 2), wood, seg=20, cap=False))
    for k in range(5):
        z = base + 0.25 + k * (H - 0.5) / 4
        parts.append(cyl(f'hoop{k}', R + 0.025, R + 0.025, 0.06, (0, 0, z), steel, seg=20, cap=False))
    parts.append(cyl('cap', R + 0.12, 0.08, 0.9, (0, 0, base + H + 0.45), roof, seg=20, cap=True))
    parts.append(cyl('hatch', 0.12, 0.12, 0.12, (0, 0, base + H + 0.95), roof, seg=6))
    # stand: legs, beams and the deck the tank sits on
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(box(f'leg{sx}{sy}', (0.16, 0.16, base), (sx * 1.05, sy * 1.05, base / 2), steel))
    for sy in (-1, 0, 1):
        parts.append(box(f'beam{sy}', (2.6, 0.14, 0.2), (0, sy * 1.0, base - 0.1), steel))
    parts.append(box('braceA', (0.06, 2.9, 0.06), (1.05, 0, base * 0.5), steel, Matrix.Rotation(0.65, 3, 'X')))
    parts.append(box('braceB', (2.9, 0.06, 0.06), (0, -1.05, base * 0.5), steel, Matrix.Rotation(-0.65, 3, 'Y')))
    # ladder up the side
    parts.append(tube('ladder', [(1.0, -R - 0.15, 0.2), (1.0, -R - 0.15, base + H)], 0.025, steel))
    parts.append(tube('ladder2', [(0.6, -R - 0.15, 0.2), (0.6, -R - 0.15, base + H)], 0.025, steel))
    return join('water_tank', parts)


def rooftop_unit():
    """A packaged rooftop air handler: louvred grey cabinet, a fan well on top, a duct into the roof."""
    shell = mat('rtu_shell', (0.55, 0.56, 0.55), 0.45, 0.5, 4.0, 0.55, streak=True)
    dark = mat('rtu_dark', (0.05, 0.05, 0.055), 0.7, 0.2)
    parts = [box('cab', (2.2, 1.3, 1.05), (0, 0, 0.62), shell), box('curb', (2.3, 1.4, 0.1), (0, 0, 0.05), dark)]
    for k in range(9):
        parts.append(box(f'louv{k}', (0.03, 0.02, 0.8), (-0.9 + k * 0.11, -0.66, 0.6), dark))
    parts.append(cyl('fanwell', 0.42, 0.42, 0.06, (0.45, 0, 1.17), dark, seg=14))
    parts.append(cyl('fanguard', 0.44, 0.44, 0.04, (0.45, 0, 1.21), shell, seg=14, cap=False))
    parts.append(box('duct', (0.6, 0.5, 0.5), (-1.3, 0.2, 0.3), shell))
    return join('rooftop_unit', parts)


def dish():
    white = mat('dish_white', (0.78, 0.78, 0.76), 0.5, 0.4, 5.0, 0.6)
    steel = mat('dish_steel', (0.25, 0.25, 0.27), 0.5, 0.3)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=6, radius=0.45)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > -0.18], context='VERTS')
    bmesh.ops.transform(bm, matrix=Matrix.Translation((0, 0, 0.45)) @ Matrix.Diagonal((1, 1, 0.55, 1)), verts=bm.verts)
    d = _obj('bowl', bm, white)
    d.matrix_world = Matrix.Translation((0, -0.1, 1.0)) @ Matrix.Rotation(-1.1, 4, 'X')
    parts = [d, tube('pole', [(0, 0.05, 0), (0, 0.05, 1.0)], 0.035, steel),
             tube('arm', [(0, -0.05, 0.85), (0, -0.55, 1.15)], 0.015, steel),
             box('lnb', (0.07, 0.1, 0.07), (0, -0.57, 1.17), white),
             box('foot', (0.5, 0.5, 0.04), (0, 0.05, 0.02), steel)]
    for o in parts:
        bpy.context.view_layer.objects.active = o
    return join('dish', parts)


def antenna():
    steel = mat('ant_steel', (0.3, 0.3, 0.32), 0.45, 0.3)
    parts = [tube('mast', [(0, 0, 0), (0, 0, 4.2)], 0.03, steel)]
    for k, z in enumerate((2.6, 3.2, 3.8)):
        w = 1.2 - k * 0.25
        parts.append(tube(f'boom{k}', [(0, -0.6, z), (0, 0.6, z)], 0.012, steel, seg=4))
        for j in range(5):
            y = -0.55 + j * 0.27
            parts.append(tube(f'el{k}{j}', [(-w / 2 * (1 - j * 0.1), y, z), (w / 2 * (1 - j * 0.1), y, z)], 0.008, steel, seg=4))
    for a in range(3):
        ang = a / 3 * math.tau
        parts.append(tube(f'guy{a}', [(0, 0, 3.0), (math.cos(ang) * 1.6, math.sin(ang) * 1.6, 0)], 0.006, steel, seg=3))
    return join('antenna', parts)


def roof_vent():
    """A mushroom vent and a gooseneck exhaust on a little curb."""
    galv = mat('vent_galv', (0.48, 0.49, 0.5), 0.4, 0.55, 6.0, 0.5)
    parts = [cyl('stack', 0.18, 0.18, 0.9, (0, 0, 0.45), galv, seg=10, cap=False),
             cyl('hood', 0.34, 0.05, 0.22, (0, 0, 1.0), galv, seg=10),
             box('curb', (0.6, 0.6, 0.15), (0, 0, 0.075), galv),
             tube('goose', [(0.5, 0.1, 0), (0.5, 0.1, 0.8), (0.65, 0.1, 0.98), (0.82, 0.1, 0.85)], 0.08, galv, seg=8)]
    return join('roof_vent', parts)


def news_box(color, name):
    paint = mat(f'news_{name}', color, 0.4, 0.5, 8.0, 0.55)
    dark = mat('news_dark', (0.06, 0.06, 0.07), 0.3, 0.2)
    paper = mat('news_paper', (0.75, 0.72, 0.66), 0.8, 0.4, 20.0, 0.7)
    parts = [box('body', (0.46, 0.42, 0.62), (0, 0, 0.62), paint),
             box('window', (0.36, 0.02, 0.28), (0, -0.215, 0.74), dark),
             box('paper', (0.32, 0.01, 0.2), (0, -0.218, 0.7), paper),
             box('coin', (0.08, 0.04, 0.1), (0.14, -0.22, 0.88), dark),
             box('top', (0.48, 0.44, 0.03), (0, 0, 0.94), paint),
             box('leg', (0.08, 0.08, 0.32), (0, 0, 0.16), dark),
             box('foot', (0.36, 0.3, 0.02), (0, 0, 0.01), dark)]
    return join(name, parts)


def mailbox():
    blue = mat('mail_blue', (0.08, 0.17, 0.42), 0.45, 0.5, 6.0, 0.55)
    dark = mat('news_dark', (0.06, 0.06, 0.07), 0.3, 0.2)
    parts = [box('body', (0.5, 0.52, 0.8), (0, 0, 0.62), blue),
             cyl('dome', 0.25, 0.25, 0.52, (0, 0, 1.02), blue, seg=12, axis='Y'),
             box('slot', (0.3, 0.03, 0.12), (0, -0.27, 1.0), dark)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(box(f'leg{sx}{sy}', (0.05, 0.05, 0.24), (sx * 0.2, sy * 0.2, 0.12), dark))
    o = join('mailbox', parts)
    # the dome's lower half is inside the body; trim it off visually by leaving it (hidden by the box)
    return o


def bike_rack():
    steel = mat('rack_steel', (0.32, 0.33, 0.35), 0.35, 0.45, 6.0, 0.5)
    pts = [(-0.35, 0, 0)]
    for i in range(9):
        a = math.pi - i / 8 * math.pi
        pts.append((math.cos(a) * 0.35, 0, 0.62 + math.sin(a) * 0.25))
    pts.append((0.35, 0, 0))
    return join('bike_rack', [tube('hoop', pts, 0.025, steel, seg=6)])


def bicycle(color, name):
    paint = mat(f'bike_{name}', color, 0.35, 0.4, 8.0, 0.6)
    tyre = mat('bike_tyre', (0.03, 0.03, 0.03), 0.75, 0.2)
    steel = mat('bike_steel', (0.5, 0.5, 0.52), 0.3, 0.3)
    seat = mat('bike_seat', (0.06, 0.05, 0.05), 0.6, 0.2)
    rw, fw = Vector((-0.52, 0, 0.34)), Vector((0.52, 0, 0.34))
    bb = Vector((-0.02, 0, 0.3))
    st = Vector((-0.16, 0, 0.82))
    ht = Vector((0.4, 0, 0.8))
    parts = [torus('rear', 0.33, 0.018, rw, tyre, seg=18, rseg=4, axis='Y'), torus('front', 0.33, 0.018, fw, tyre, seg=18, rseg=4, axis='Y'),
             tube('down', [bb, ht + Vector((0, 0, -0.08))], 0.02, paint), tube('top', [st, ht], 0.018, paint),
             tube('seatst', [bb, st + Vector((0, 0, 0.08))], 0.018, paint), tube('chain', [bb, rw], 0.012, paint),
             tube('stay', [st, rw], 0.012, paint), tube('fork', [ht, fw], 0.015, steel),
             tube('stem', [ht, ht + Vector((-0.05, 0, 0.14))], 0.015, steel),
             tube('bars', [ht + Vector((-0.05, -0.24, 0.15)), ht + Vector((-0.05, 0.24, 0.15))], 0.012, steel),
             box('saddle', (0.24, 0.1, 0.05), st + Vector((-0.02, 0, 0.1)), seat)]
    for w in (rw, fw):
        for k in range(3):
            a = k / 3 * math.pi
            d = Vector((math.cos(a) * 0.31, 0, math.sin(a) * 0.31))
            parts.append(tube(f'sp{k}', [w - d, w + d], 0.004, steel, seg=3))
    o = join(name, parts)
    # leans on its stand a little
    o.matrix_world = Matrix.Rotation(0.08, 4, 'X')
    return o


def cone():
    orange = mat('cone_orange', (0.85, 0.28, 0.05), 0.55, 0.55, 8.0, 0.5)
    white = mat('cone_white', (0.82, 0.82, 0.78), 0.5, 0.5, 8.0, 0.55)
    parts = [box('base', (0.36, 0.36, 0.03), (0, 0, 0.015), orange),
             cyl('body', 0.14, 0.03, 0.66, (0, 0, 0.36), orange, seg=10, cap=False),
             cyl('band', 0.105, 0.075, 0.12, (0, 0, 0.42), white, seg=10, cap=False)]
    return join('cone', parts)


def hoarding(seed, name):
    """A construction hoarding panel: plywood on posts, fly-posted, scuffed and rain-streaked."""
    ply = mat('hoard_ply', (0.4, 0.33, 0.24), 0.8, 0.6, 2.0, 0.55, streak=True)
    post = mat('hoard_post', (0.15, 0.13, 0.12), 0.8, 0.4)
    parts = [box('panel', (2.4, 0.04, 2.3), (0, 0, 1.2), ply),
             box('postL', (0.09, 0.09, 2.4), (-1.18, 0.07, 1.2), post), box('postR', (0.09, 0.09, 2.4), (1.18, 0.07, 1.2), post),
             box('foot', (2.4, 0.3, 0.06), (0, 0.15, 0.03), post)]
    rnd = random.Random(seed)
    for k in range(3 if seed % 2 else 2):
        w = 0.55 + rnd.random() * 0.25
        h = w * 1.4
        x = -0.8 + k * 0.75 + rnd.random() * 0.1
        z = 0.9 + rnd.random() * 0.4
        parts.append(box(f'poster{k}', (w, 0.006, h), (x, -0.024, z), poster_mat(f'poster{seed}_{k}', seed * 7 + k),
                         Matrix.Rotation((rnd.random() - 0.5) * 0.08, 3, 'Y')))
    return join(name, parts)


def scaffold():
    """One bay of tube-and-fitting scaffold (2.5 m long, 2 m a lift, 0.9 m deep), three lifts, boarded."""
    tubes = mat('scaf_tube', (0.5, 0.5, 0.48), 0.45, 0.6, 5.0, 0.45)
    board = mat('scaf_board', (0.5, 0.4, 0.26), 0.85, 0.6, 3.0, 0.5)
    net = mat('scaf_net', (0.1, 0.28, 0.22), 0.8, 0.5, 2.0, 0.6)
    parts = []
    L, D, lift, n = 2.5, 0.9, 2.0, 3
    for x in (0.0, L):
        for y in (0.0, D):
            parts.append(tube(f's{x}{y}', [(x, y, 0), (x, y, lift * n + 1.0)], 0.024, tubes, seg=6))
    for k in range(1, n + 1):
        z = k * lift
        for y in (0.0, D):
            parts.append(tube(f'l{k}{y}', [(-0.1, y, z), (L + 0.1, y, z)], 0.024, tubes, seg=6))
            parts.append(tube(f'g{k}{y}', [(-0.1, y, z + 1.0), (L + 0.1, y, z + 1.0)], 0.02, tubes, seg=5))
        parts.append(box(f'deck{k}', (L, D - 0.1, 0.05), (L / 2, D / 2, z + 0.05), board))
        parts.append(box(f'toe{k}', (L, 0.03, 0.15), (L / 2, -0.02, z + 0.12), board))
    parts.append(tube('brace', [(0, -0.03, 0), (L, -0.03, lift * 2)], 0.02, tubes, seg=5))
    # a strip of debris netting on the top lift
    parts.append(box('net', (L, 0.01, 1.0), (L / 2, -0.06, lift * n + 0.5), net))
    o = join('scaffold', parts)
    o.data.transform(Matrix.Translation((-L / 2, -D / 2, 0)))
    return o


def pallet():
    wood = mat('pallet_wood', (0.45, 0.36, 0.25), 0.85, 0.6, 4.0, 0.55)
    parts = []
    for k in range(5):
        parts.append(box(f'top{k}', (1.2, 0.14, 0.022), (0, -0.4 + k * 0.2, 0.133), wood))
    for k in range(3):
        parts.append(box(f'blk{k}', (1.2, 0.1, 0.1), (0, -0.4 + k * 0.4, 0.07), wood))
        parts.append(box(f'bot{k}', (1.2, 0.14, 0.02), (0, -0.4 + k * 0.4, 0.01), wood))
    return join('pallet', parts)


def litter():
    """Street litter, one object per piece: newspaper, a crushed cup, a flattened box, a can."""
    paper = mat('lit_paper', (0.78, 0.76, 0.7), 0.9, 0.5, 30.0, 0.6)
    print_ = mat('lit_print', (0.25, 0.25, 0.27), 0.9, 0.5, 40.0, 0.7)
    cup = mat('lit_cup', (0.86, 0.85, 0.82), 0.6, 0.4, 10.0, 0.7)
    lid = mat('lit_lid', (0.12, 0.1, 0.09), 0.5, 0.2)
    card = mat('lit_card', (0.5, 0.38, 0.24), 0.9, 0.5, 6.0, 0.6)
    can = mat('lit_can', (0.7, 0.1, 0.12), 0.3, 0.4, 10.0, 0.6)
    out = []
    # newspaper sheet, folded and creased: a few bent quads
    bm = bmesh.new()
    grid = bmesh.ops.create_grid(bm, x_segments=4, y_segments=3, size=0.2)
    rnd = random.Random(5)
    for v in grid['verts']:
        v.co.z = 0.005 + abs(v.co.x) * 0.15 * rnd.random() + rnd.random() * 0.01
        v.co.y *= 0.7
    o = _obj('litter_paper', bm, paper)
    o.data.materials.append(print_)
    for i, p in enumerate(o.data.polygons):
        p.material_index = 1 if i % 3 == 0 else 0
    out.append(o)
    c = join('litter_cup', [cyl('c', 0.04, 0.03, 0.12, (0, 0, 0.04), cup, seg=8, axis='X'), cyl('l', 0.043, 0.043, 0.012, (0.065, 0, 0.04), lid, seg=8, axis='X')])
    out.append(c)
    bm = bmesh.new()
    grid = bmesh.ops.create_grid(bm, x_segments=3, y_segments=2, size=0.3)
    for v in grid['verts']:
        v.co.z = 0.004 + (abs(v.co.x) > 0.2) * 0.02 + rnd.random() * 0.006
    out.append(_obj('litter_card', bm, card))
    out.append(join('litter_can', [cyl('k', 0.033, 0.03, 0.12, (0, 0, 0.033), can, seg=8, axis='X')]))
    # a crumpled paper ball
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.045)
    for v in bm.verts:
        v.co *= 0.75 + rnd.random() * 0.5
        v.co.z += 0.04
    out.append(_obj('litter_ball', bm, paper))
    return out


def cable_stub():
    """Not a prop: a short black cable whose atlas texel the site uses for the wires across the cross streets."""
    black = mat('cable_black', (0.02, 0.02, 0.022), 0.5, 0.1)
    return join('cable', [cyl('c', 0.02, 0.02, 0.4, (0, 0, 0.2), black, seg=6)])


def builders():
    """(id, function) for every procedural prop."""
    return [
        ('water_tank', water_tank), ('rooftop_unit', rooftop_unit), ('dish', dish), ('antenna', antenna),
        ('roof_vent', roof_vent),
        ('news_red', lambda: news_box((0.55, 0.06, 0.05), 'news_red')),
        ('news_blue', lambda: news_box((0.06, 0.2, 0.5), 'news_blue')),
        ('news_yellow', lambda: news_box((0.8, 0.6, 0.05), 'news_yellow')),
        ('mailbox', mailbox), ('bike_rack', bike_rack),
        ('bike_teal', lambda: bicycle((0.05, 0.4, 0.42), 'bike_teal')),
        ('bike_black', lambda: bicycle((0.06, 0.06, 0.07), 'bike_black')),
        ('bike_red', lambda: bicycle((0.6, 0.08, 0.06), 'bike_red')),
        ('cone', cone), ('hoarding_a', lambda: hoarding(3, 'hoarding_a')), ('hoarding_b', lambda: hoarding(8, 'hoarding_b')),
        ('scaffold', scaffold), ('pallet', pallet), ('cable', cable_stub),
    ]
