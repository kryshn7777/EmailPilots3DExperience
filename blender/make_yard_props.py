"""
The town's yard and kerbside clutter: one shared atlas, one GLB (public/models/yard-props/).

    python3 blender/make_yard_props.py                 # download (once), model, bake, export
    python3 blender/make_yard_props.py --sheet DIR     # also a Cycles contact sheet of every prop
    npm run compress:models                            # then meshopt-pack the GLB

Two kinds of source:

- **Poly Haven models** (CC0, https://polyhaven.com): a garden gnome, a covered car, a picnic table,
  chairs, a stone fire pit, planters, barrels, bins, bags, a stump, a utility pedestal, a power pole...
  Each is downloaded at 1k into `--cache` (default /tmp/polyhaven-yard), decimated to a few hundred
  triangles and re-baked from its full-resolution self.
- **Procedural models** built here in metres from primitives: pumpkins, paper leaf bags, a portable
  basketball hoop, bikes, a scooter, a wheelbarrow, a push mower, a hose reel and a loose hose, a rotary
  washing line with laundry, a toddler slide, a hot tub, an extension ladder, a satellite dish, kettle
  and gas grills, mailboxes, a playground ball, a toy truck, a kayak.

Every prop's low mesh is smart-UV-unwrapped into its own tile of one 2048 atlas and Cycles bakes, from
the high source onto it: albedo (emission-rewired), roughness and metalness (likewise), multi-ray
ambient occlusion over a ground plane, and a tangent-space normal map. AO is folded into the colour
(like the house atlases) and also kept in ORM.r. Outputs, in site units (0.33 a metre), y up, each
prop standing on y = 0 centred on its footprint, its front toward +z:

    props.glb               meshes `<id>` (HIGH) and `<id>-lean` (phones and distance)
    atlas-color.webp        2048, AO folded in        atlas-color-low.webp  1024 (phones)
    atlas-orm.webp          2048 (r AO, g roughness, b metalness)
    atlas-normal.webp       2048, OpenGL convention
    manifest.json           per prop: triangles, lean triangles, size, footprint radius
"""
import bpy
import bmesh
import json
import math
import os
import random
import sys
import urllib.request
from mathutils import Matrix, Vector

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]


def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = arg('--out', os.path.join(ROOT, 'public', 'models', 'yard-props'))
CACHE = arg('--cache', '/tmp/polyhaven-yard')
SHEET = arg('--sheet')
SITE = 0.33          # site units per metre (blender/bld/homes.py, the people)
ATLAS = 2048
SPREAD = 14.0        # metres between props while baking, so no ray reaches a neighbour
UA = {'User-Agent': 'EmailPilots-build/1.0 (yard props; blender/make_yard_props.py)'}
rng = random.Random(4517)

# ---- Poly Haven --------------------------------------------------------------------------------------

#: id -> (Poly Haven asset, object names to keep (None: all), high tris, lean tris, tile px)
PH = {
    'gnome':        ('garden_gnome', None, 520, 160, 128),
    'car-cover':    ('covered_car', None, 1500, 420, 512),
    'picnic':       ('wooden_picnic_table', None, 640, 220, 256),
    'monobloc':     ('plastic_monobloc_chair_01', None, 420, 130, 128),
    'firepit':      ('stone_fire_pit', None, 640, 220, 256),
    'stepladder':   ('wooden_ladder', None, 340, 110, 128),
    'planter':      ('planter_box_01', None, 300, 100, 128),
    'clay-pot':     ('planter_pot_clay', None, 160, 60, 128),
    'watering-can': ('watering_can_metal_01', None, 260, 90, 128),
    'barrel':       ('Barrel_02', None, 300, 100, 128),
    'trash-can':    ('metal_trash_can', ['metal_trash_can', 'metal_trash_can_lid', 'metal_trash_can_handle_left',
                                         'metal_trash_can_handle_right'], 420, 130, 256),
    'trash-can-rust': ('metal_trash_can', ['metal_trash_can_rust', 'metal_trash_can_rust_lid',
                                           'metal_trash_can_rust_handle_left', 'metal_trash_can_rust_handle_right'], 420, 130, 256),
    'tyre':         ('old_tyre', None, 260, 90, 128),
    'soccer-ball':  ('dirty_football', None, 160, 48, 128),
    'football':     ('american_football', None, 120, 40, 128),
    'propane':      ('propane_tank', None, 240, 80, 128),
    'compost-bags': ('compost_bags', ['compost_bags_floorstacked'], 300, 100, 256),
    'crate':        ('wooden_crate_02', None, 260, 90, 128),
    'bench':        ('painted_wooden_bench', None, 420, 160, 256),
    'trash-bag':    ('trashbag', None, 240, 80, 128),
    'stump':        ('tree_stump_01', None, 520, 160, 256),
    'utility-box':  ('utility_box_02', None, 220, 70, 128),
    'power-pole':   ('modular_electricity_poles', 'preset_01_', 2200, 520, 512),
    'rocker':       ('Rockingchair_01', None, 640, 200, 256),
    'patio-table':  ('outdoor_table_chair_set_01', ['outdoor_table_chair_set_01_table'], 320, 110, 256),
    'patio-chair':  ('outdoor_table_chair_set_01', ['outdoor_table_chair_set_01_chair_01'], 420, 130, 256),
}


def fetch(asset_id):
    """The asset's 1k glTF and its textures, downloaded once into the cache."""
    folder = os.path.join(CACHE, asset_id)
    done = os.path.join(folder, 'done')
    if not os.path.exists(done):
        os.makedirs(folder, exist_ok=True)

        def get(url):
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        files = json.loads(get(f'https://api.polyhaven.com/files/{asset_id}'))
        info = json.loads(get(f'https://api.polyhaven.com/info/{asset_id}'))
        g = files['gltf']['1k']['gltf']
        open(os.path.join(folder, os.path.basename(g['url'])), 'wb').write(get(g['url']))
        for rel, f in g['include'].items():
            p = os.path.join(folder, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, 'wb').write(get(f['url']))
        json.dump({'id': asset_id, 'name': info['name'], 'authors': list(info['authors'].keys()),
                   'url': f'https://polyhaven.com/a/{asset_id}', 'license': 'CC0 1.0'},
                  open(os.path.join(folder, 'meta.json'), 'w'), indent=1)
        open(done, 'w').write('ok')
    gltf = [f for f in os.listdir(folder) if f.endswith('.gltf')][0]
    return os.path.join(folder, gltf), json.load(open(os.path.join(folder, 'meta.json')))


# ---- scene helpers -----------------------------------------------------------------------------------

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 8
    scene.render.bake.margin = 6
    scene.view_settings.view_transform = 'Standard'


MATS = {}


def mat(name, color, rough=0.6, metal=0.0):
    """A plain principled material (procedural props); cached by name."""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    c = color if len(color) == 4 else (*color, 1)
    # colours are given in sRGB, as picked
    b.inputs['Base Color'].default_value = [srgb_to_lin(x) for x in c[:3]] + [1]
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    MATS[name] = m
    return m


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def finish(o, m, smooth=None):
    o.data.materials.clear()
    o.data.materials.append(m)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if smooth is not None:
        bpy.ops.object.shade_smooth_by_angle(angle=smooth)
    o.select_set(False)
    return o


def box(size, loc, m, rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = size
    if bevel:
        bpy.ops.object.transform_apply(scale=True)
        mod = o.modifiers.new('b', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier='b')
    return finish(o, m, 0.6 if bevel else None)


def cyl(r, h, loc, m, seg=12, rot=(0, 0, 0), r2=None, cap=True):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=h, location=loc, rotation=rot,
                                            end_fill_type='NGON' if cap else 'NOTHING')
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r, radius2=r2, depth=h, location=loc, rotation=rot,
                                        end_fill_type='NGON' if cap else 'NOTHING')
    return finish(bpy.context.object, m, 0.9)


def sphere(r, loc, m, seg=16, rings=10, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc)
    o = bpy.context.object
    o.scale = scale
    return finish(o, m, 1.2)


def torus(R, r, loc, m, seg=16, mseg=6, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_segments=seg, minor_segments=mseg, major_radius=R, minor_radius=r,
                                     location=loc, rotation=rot)
    return finish(bpy.context.object, m, 1.2)


def tube(p0, p1, r, m, seg=6):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=d.length, location=(p0 + p1) / 2)
    o = bpy.context.object
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return finish(o, m, 1.0)


def path_tube(points, r, m, seg=6, closed=False):
    """A tube along a polyline (hose, frames): one mesh, rings at every point."""
    bm = bmesh.new()
    pts = [Vector(p) for p in points]
    rings = []
    n = len(pts)
    for i, p in enumerate(pts):
        a = pts[(i - 1) % n] if closed or i > 0 else p
        b = pts[(i + 1) % n] if closed or i < n - 1 else p
        t = (b - a).normalized()
        up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        u = t.cross(up).normalized()
        v = t.cross(u).normalized()
        rings.append([bm.verts.new(p + (u * math.cos(k / seg * 6.2832) + v * math.sin(k / seg * 6.2832)) * r)
                      for k in range(seg)])
    for i in range(n if closed else n - 1):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for k in range(seg):
            bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
    me = bpy.data.meshes.new('tube')
    bm.to_mesh(me)
    o = bpy.data.objects.new('tube', me)
    bpy.context.collection.objects.link(o)
    return finish(o, m, 1.2)


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    o.data.name = name
    o.select_set(False)
    return o


# ---- procedural props (metres, z up, front toward -y so it exports facing +z) ----------------------

def p_pumpkin():
    orange = mat('pumpkin', hexc('#c8641e'), 0.55)
    stem = mat('stem', hexc('#5e5232'), 0.8)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=1)
    o = bpy.context.object
    for v in o.data.vertices:
        x, y, z = v.co
        th = math.atan2(y, x)
        rib = 0.9 + 0.1 * abs(math.cos(5 * th)) ** 0.6
        k = math.sqrt(max(1 - z * z, 0))
        dimple = 0.2 * (z ** 8) if z > 0 else 0.1 * (z ** 8)
        v.co = Vector((x * rib * 0.16, y * rib * 0.16, (z * (1 - dimple)) * 0.115 + 0.115 * (1 - 0.05 * (1 - k))))
    finish(o, orange, 1.2)
    s = cyl(0.014, 0.06, (0.004, 0, 0.245), stem, seg=6, rot=(0.25, 0.1, 0), r2=0.01)
    return [o, s]


def p_leafbag():
    kraft = mat('kraft', hexc('#a8875a'), 0.9)
    print_ = mat('kraft-print', hexc('#5f6e3a'), 0.9)
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.scale = (0.4, 0.28, 0.82)
    bpy.ops.object.transform_apply(scale=True)
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=4, use_grid_fill=True)
    for v in bm.verts:
        x, y, z = v.co
        bulge = 1 + 0.12 * (1 - (2 * z / 0.82) ** 2)
        crumple = 0.012 * math.sin(x * 40 + z * 23) * math.sin(y * 37 - z * 19)
        v.co = Vector((x * bulge + crumple, y * bulge + crumple, z + 0.41 + (0.03 * math.sin(x * 20) if z > 0.4 else 0)))
    top = [f for f in bm.faces if f.normal.z > 0.9]
    bmesh.ops.delete(bm, geom=top, context='FACES')
    bm.to_mesh(me)
    finish(o, kraft, 0.5)
    band = box((0.41, 0.005, 0.14), (0, -0.165, 0.42), print_)
    return [o, band]


def p_hoop():
    black = mat('hoop-base', hexc('#1e1f22'), 0.6)
    pole = mat('hoop-pole', hexc('#3a3d42'), 0.4, 0.6)
    board = mat('hoop-board', hexc('#e9eae6'), 0.3)
    red = mat('hoop-red', hexc('#b8321e'), 0.5)
    rim = mat('hoop-rim', hexc('#d4561a'), 0.4, 0.5)
    net = mat('hoop-net', hexc('#d8d8d2'), 0.9)
    parts = [box((0.65, 1.1, 0.28), (0, 0.25, 0.14), black, bevel=0.05)]
    parts += [cyl(0.05, 3.05, (0, 0, 1.6), pole, seg=8, rot=(-0.06, 0, 0))]
    parts += [box((1.12, 0.04, 0.72), (0, -0.28, 2.9), board, bevel=0.01)]
    parts += [box((0.6, 0.01, 0.44), (0, -0.305, 2.86), red), box((0.54, 0.012, 0.38), (0, -0.307, 2.86), board)]
    parts += [box((0.06, 0.25, 0.04), (0, -0.4, 2.62), rim), torus(0.23, 0.012, (0, -0.64, 2.62), rim, seg=16, mseg=4)]
    parts += [cyl(0.23, 0.38, (0, -0.64, 2.43), net, seg=12, r2=0.15, cap=False)]
    parts += [tube((0, 0.1, 0.25), (0, 0.6, 0.02), 0.03, pole)]
    return parts


def bike_parts(scale=1.0, frame_hex='#b8bcc2'):
    s = scale
    tyre = mat('tyre', hexc('#1a1a1c'), 0.8)
    frame = mat('bike-frame-' + frame_hex, hexc(frame_hex), 0.35, 0.3)
    steel = mat('steel', hexc('#9ea2a6'), 0.3, 0.9)
    seat = mat('saddle', hexc('#232325'), 0.6)
    R = 0.33 * s
    rear, front = Vector((-0.52 * s, 0, R)), Vector((0.52 * s, 0, R))
    crank = Vector((-0.08 * s, 0, 0.3 * s))
    seat_top = Vector((-0.2 * s, 0, 0.78 * s))
    head_top = Vector((0.4 * s, 0, 0.82 * s))
    head_bot = Vector((0.43 * s, 0, 0.66 * s))
    parts = []
    for c in (rear, front):
        parts.append(torus(R - 0.02 * s, 0.022 * s, c, tyre, seg=20, mseg=5, rot=(math.pi / 2, 0, 0)))
        parts.append(torus(R - 0.05 * s, 0.008 * s, c, steel, seg=16, mseg=3, rot=(math.pi / 2, 0, 0)))
        parts.append(cyl(0.025 * s, 0.1 * s, c, steel, seg=6, rot=(math.pi / 2, 0, 0)))
    for a, b in [(crank, seat_top), (crank, head_bot), (seat_top, head_top), (crank, rear), (seat_top, rear),
                 (head_top, front)]:
        parts.append(tube(a, b, 0.017 * s, frame))
    parts.append(tube(head_top, head_top + Vector((-0.06 * s, 0, 0.12 * s)), 0.014 * s, steel))
    hb = head_top + Vector((-0.06 * s, 0, 0.12 * s))
    parts.append(tube(hb + Vector((0, -0.24 * s, 0)), hb + Vector((0, 0.24 * s, 0)), 0.012 * s, steel))
    parts.append(tube(seat_top, seat_top + Vector((-0.02 * s, 0, 0.1 * s)), 0.012 * s, steel))
    parts.append(box((0.25 * s, 0.1 * s, 0.05 * s), seat_top + Vector((0, 0, 0.12 * s)), seat, bevel=0.01 * s))
    parts.append(cyl(0.09 * s, 0.015 * s, crank + Vector((0, 0.05 * s, 0)), steel, seg=12, rot=(math.pi / 2, 0, 0)))
    for side in (-1, 1):
        parts.append(box((0.08 * s, 0.05 * s, 0.02 * s), crank + Vector((0.12 * side * s, 0.1 * side * s, 0.12 * side * s)), seat))
    return parts


def p_bike():
    return bike_parts(1.0)


def p_kidbike():
    parts = bike_parts(0.62, '#c8cbd0')
    tyre = MATS['tyre']
    for side in (-1, 1):
        parts.append(torus(0.06, 0.012, (-0.4, 0.16 * side, 0.06), tyre, seg=12, mseg=4, rot=(math.pi / 2, 0, 0)))
        parts.append(tube((-0.32, 0, 0.2), (-0.4, 0.16 * side, 0.06), 0.008, MATS['steel']))
    return parts


def p_scooter():
    deck = mat('scooter-deck', hexc('#c9ccd0'), 0.4, 0.2)
    steel = mat('steel', hexc('#9ea2a6'), 0.3, 0.9)
    wheel = mat('scooter-wheel', hexc('#d9d6cc'), 0.5)
    grip = mat('saddle', hexc('#232325'), 0.6)
    parts = [box((0.5, 0.11, 0.025), (0, 0, 0.07), deck, bevel=0.008)]
    for x in (-0.27, 0.28):
        parts.append(cyl(0.05, 0.025, (x, 0, 0.05), wheel, seg=12, rot=(math.pi / 2, 0, 0)))
    parts.append(tube((0.28, 0, 0.06), (0.3, 0, 0.82), 0.014, steel))
    parts.append(tube((0.3, -0.2, 0.82), (0.3, 0.2, 0.82), 0.012, steel))
    for y in (-0.17, 0.17):
        parts.append(cyl(0.017, 0.07, (0.3, y, 0.82), grip, seg=6, rot=(math.pi / 2, 0, 0)))
    return parts


def p_wheelbarrow():
    tray = mat('barrow-tray', hexc('#3f6e4a'), 0.5, 0.4)
    wood = mat('barrow-wood', hexc('#8a6a46'), 0.7)
    tyre = MATS.get('tyre') or mat('tyre', hexc('#1a1a1c'), 0.8)
    steel = mat('steel', hexc('#9ea2a6'), 0.3, 0.9)
    bm = bmesh.new()
    # an open tapered tray: bottom 0.45 x 0.35, rim 0.85 x 0.62, 0.3 deep, front sloped
    b = [(-0.25, -0.17), (0.2, -0.17), (0.2, 0.17), (-0.25, 0.17)]
    t = [(-0.42, -0.31), (0.48, -0.31), (0.48, 0.31), (-0.42, 0.31)]
    vb = [bm.verts.new((x, y, 0.28)) for x, y in b]
    vt = [bm.verts.new((x, y, 0.58)) for x, y in t]
    bm.faces.new(vb[::-1])
    for i in range(4):
        bm.faces.new((vb[i], vb[(i + 1) % 4], vt[(i + 1) % 4], vt[i]))
    me = bpy.data.meshes.new('tray')
    bm.to_mesh(me)
    o = bpy.data.objects.new('tray', me)
    bpy.context.collection.objects.link(o)
    sol = o.modifiers.new('s', 'SOLIDIFY')
    sol.thickness = 0.012
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='s')
    finish(o, tray, 0.7)
    parts = [o]
    parts.append(torus(0.17, 0.045, (0.55, 0, 0.2), tyre, seg=16, mseg=6, rot=(math.pi / 2, 0, 0)))
    parts.append(cyl(0.11, 0.06, (0.55, 0, 0.2), steel, seg=10, rot=(math.pi / 2, 0, 0)))
    for y in (-0.24, 0.24):
        parts.append(tube((0.55, y * 0.4, 0.2), (-0.9, y, 0.5), 0.02, wood))
        parts.append(tube((-0.2, y * 0.8, 0.34), (-0.25, y * 0.9, 0.0), 0.015, steel))
        parts.append(cyl(0.022, 0.12, (-0.95, y, 0.52), MATS['saddle'] if 'saddle' in MATS else wood, seg=6, rot=(0, math.pi / 2, 0)))
    return parts


def p_mower():
    deck = mat('mower-deck', hexc('#a8301f'), 0.45, 0.3)
    engine = mat('mower-engine', hexc('#2a2b2e'), 0.5, 0.3)
    tyre = MATS.get('tyre') or mat('tyre', hexc('#1a1a1c'), 0.8)
    steel = mat('steel', hexc('#9ea2a6'), 0.3, 0.9)
    bag = mat('mower-bag', hexc('#3a3d36'), 0.9)
    parts = [box((0.52, 0.5, 0.12), (0, 0, 0.14), deck, bevel=0.04)]
    parts.append(cyl(0.12, 0.16, (0.04, 0, 0.28), engine, seg=12))
    parts.append(cyl(0.06, 0.05, (0.08, 0.08, 0.38), deck, seg=8))
    for x in (-0.2, 0.2):
        for y in (-0.25, 0.25):
            parts.append(cyl(0.085, 0.045, (x, y, 0.085), tyre, seg=12, rot=(math.pi / 2, 0, 0)))
    parts.append(box((0.32, 0.36, 0.26), (-0.42, 0, 0.24), bag, bevel=0.06))
    for y in (-0.2, 0.2):
        parts.append(tube((-0.22, y, 0.2), (-0.78, y, 0.92), 0.012, steel))
    parts.append(tube((-0.78, -0.2, 0.92), (-0.78, 0.2, 0.92), 0.014, MATS.get('saddle') or engine))
    return parts


def p_hosereel():
    green = mat('hose', hexc('#3e7a3a'), 0.55)
    cart = mat('reel-cart', hexc('#2f3134'), 0.5, 0.2)
    parts = []
    for y in (-0.16, 0.16):
        parts.append(cyl(0.2, 0.02, (0, y, 0.3), cart, seg=14, rot=(math.pi / 2, 0, 0)))
        parts.append(tube((0, y, 0.3), (-0.15, y, 0.0), 0.012, cart))
        parts.append(tube((0, y, 0.3), (0.15, y, 0.0), 0.012, cart))
        parts.append(tube((0, y, 0.3), (-0.22, y * 1.1, 0.75), 0.012, cart))
    parts.append(tube((-0.22, -0.18, 0.75), (-0.22, 0.18, 0.75), 0.014, cart))
    parts.append(cyl(0.13, 0.3, (0, 0, 0.3), green, seg=14, rot=(math.pi / 2, 0, 0)))
    # the hose's tail, trailing off the reel onto the ground
    parts.append(path_tube([(0.0, 0, 0.17), (0.18, 0.02, 0.06), (0.4, 0.1, 0.015), (0.65, 0.05, 0.015), (0.8, -0.12, 0.015)], 0.012, green))
    return parts


def p_hose():
    green = MATS.get('hose') or mat('hose', hexc('#3e7a3a'), 0.55)
    brass = mat('brass', hexc('#b08a3e'), 0.35, 0.9)
    pts = []
    # a loose, untidy coil on the lawn with a tail
    for i in range(70):
        a = i * 0.32
        r = 0.22 + 0.06 * math.sin(i * 0.7) + i * 0.002
        pts.append((math.cos(a) * r + 0.03 * math.sin(i * 1.3), math.sin(a) * r * 0.85, 0.015 + 0.012 * (i % 7 == 0)))
    for i in range(10):
        pts.append((pts[-1][0] + 0.08, pts[-1][1] + 0.05 * math.sin(i), 0.015))
    parts = [path_tube(pts, 0.011, green, seg=5)]
    parts.append(cyl(0.016, 0.06, (pts[-1][0] + 0.03, pts[-1][1], 0.016), brass, seg=6, rot=(0, math.pi / 2, 0)))
    return parts


LAUNDRY = ['#e8e6e0', '#7a94b8', '#c45a4a', '#e0cf9a', '#4a5a7a', '#f2f0ea', '#9ab08a', '#d89aa8']


def p_clothesline():
    steel = mat('line-steel', hexc('#b7b9bb'), 0.4, 0.8)
    line = mat('line', hexc('#d6d6d0'), 0.8)
    parts = [cyl(0.022, 1.9, (0, 0, 0.95), steel, seg=8)]
    arms = 4
    for k in range(arms):
        a = k / arms * 6.2832 + 0.4
        d = Vector((math.cos(a), math.sin(a), 0))
        parts.append(tube((0, 0, 1.75), d * 1.3 + Vector((0, 0, 1.62)), 0.012, steel))
        parts.append(tube((0, 0, 1.3), d * 0.5 + Vector((0, 0, 1.68)), 0.009, steel))
    for ring in (0.55, 0.85, 1.15):
        pts = []
        for k in range(arms):
            a = k / arms * 6.2832 + 0.4
            pts.append((math.cos(a) * ring, math.sin(a) * ring, 1.75 - 0.1 * ring))
        parts.append(path_tube(pts, 0.004, line, seg=3, closed=True))
    # laundry hanging off a couple of sides: sheets, towels, shirts
    rnd = random.Random(31)
    for k in (0, 1, 2):
        a0 = k / arms * 6.2832 + 0.4
        a1 = (k + 1) / arms * 6.2832 + 0.4
        ring = (0.85, 1.15, 0.55)[k]
        p0 = Vector((math.cos(a0) * ring, math.sin(a0) * ring, 1.75 - 0.1 * ring))
        p1 = Vector((math.cos(a1) * ring, math.sin(a1) * ring, 1.75 - 0.1 * ring))
        n = 2 if k < 2 else 1
        for j in range(n):
            f0 = 0.12 + j * 0.45
            f1 = f0 + rnd.uniform(0.25, 0.38)
            a = p0.lerp(p1, f0)
            b = p0.lerp(p1, f1)
            h = rnd.uniform(0.35, 0.75)
            m = mat('laundry%d' % (k * 2 + j), hexc(LAUNDRY[(k * 2 + j) % len(LAUNDRY)]), 0.9)
            bm = bmesh.new()
            cols = 5
            rows = 3
            grid = []
            for r_ in range(rows + 1):
                row = []
                for c in range(cols + 1):
                    p = a.lerp(b, c / cols)
                    sway = 0.03 * math.sin(c * 1.7 + r_) * (r_ / rows)
                    row.append(bm.verts.new(p + Vector((sway, -sway, -h * r_ / rows))))
                grid.append(row)
            for r_ in range(rows):
                for c in range(cols):
                    bm.faces.new((grid[r_][c], grid[r_][c + 1], grid[r_ + 1][c + 1], grid[r_ + 1][c]))
            me = bpy.data.meshes.new('cloth')
            bm.to_mesh(me)
            o = bpy.data.objects.new('cloth', me)
            bpy.context.collection.objects.link(o)
            sol = o.modifiers.new('s', 'SOLIDIFY')
            sol.thickness = 0.006
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier='s')
            parts.append(finish(o, m, 1.0))
    return parts


def p_slide():
    plastic = mat('slide-red', hexc('#b8402e'), 0.4)
    plastic2 = mat('slide-blue', hexc('#2f5f9a'), 0.4)
    yellow = mat('slide-yellow', hexc('#d8b23a'), 0.4)
    parts = []
    # the chute: a trough from the platform down to the lawn
    bm = bmesh.new()
    prof = [(-0.2, 0.08), (-0.18, 0.0), (0.18, 0.0), (0.2, 0.08)]
    rings = []
    for i in range(7):
        t = i / 6
        x = 0.25 + t * 1.15
        z = 0.85 * (1 - t) ** 1.2 + 0.05
        rings.append([bm.verts.new((x, y, z + dz)) for y, dz in prof])
    for i in range(6):
        for k in range(3):
            bm.faces.new((rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]))
    me = bpy.data.meshes.new('chute')
    bm.to_mesh(me)
    o = bpy.data.objects.new('chute', me)
    bpy.context.collection.objects.link(o)
    sol = o.modifiers.new('s', 'SOLIDIFY')
    sol.thickness = 0.025
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='s')
    parts.append(finish(o, plastic, 0.8))
    parts.append(box((0.5, 0.5, 0.06), (0.0, 0, 0.88), plastic2, bevel=0.02))
    for y in (-0.24, 0.24):
        parts.append(box((0.06, 0.04, 0.9), (-0.22, y, 0.45), yellow, bevel=0.01))
        parts.append(box((0.06, 0.04, 0.9), (0.22, y, 0.45), yellow, bevel=0.01))
        parts.append(box((0.5, 0.03, 0.2), (0.0, y, 1.0), plastic2, bevel=0.01))
    for k in range(3):
        parts.append(box((0.12, 0.44, 0.03), (-0.28 - 0.1 * k, 0, 0.22 + 0.25 * k), yellow, bevel=0.01))
    return parts


def p_hottub():
    cedar = mat('cedar', hexc('#7a5236'), 0.75)
    cover = mat('tub-cover', hexc('#5b5d5a'), 0.7)
    parts = [box((2.1, 2.1, 0.86), (0, 0, 0.43), cedar, bevel=0.04)]
    parts.append(box((2.14, 2.14, 0.1), (0, 0, 0.9), cover, bevel=0.04))
    parts.append(box((0.02, 2.1, 0.04), (0, 0, 0.955), cover))
    parts.append(box((0.5, 0.9, 0.22), (1.32, 0, 0.11), cedar, bevel=0.02))
    # the gaps between the skirt boards, on the two sides the yard sees most
    dark = mat('cedar-dark', hexc('#5a3a24'), 0.8)
    for k in range(-8, 9):
        parts.append(box((0.014, 0.01, 0.76), (k * 0.12, -1.052, 0.43), dark))
        parts.append(box((0.01, 0.014, 0.76), (-1.052, k * 0.12, 0.43), dark))
    return parts


def p_ladder():
    alu = mat('alu', hexc('#c6c8c8'), 0.35, 0.9)
    foot = mat('saddle', hexc('#232325'), 0.6)
    parts = []
    L = 4.2
    for y in (-0.21, 0.21):
        parts.append(box((0.025, 0.065, L), (0, y, L / 2), alu))
        parts.append(box((0.07, 0.08, 0.06), (0, y, 0.03), foot))
    for k in range(13):
        parts.append(cyl(0.016, 0.42, (0, 0, 0.3 + k * 0.3), alu, seg=6, rot=(math.pi / 2, 0, 0)))
    return parts


def p_dish():
    white = mat('dish', hexc('#dcdcd6'), 0.45)
    grey = mat('dish-arm', hexc('#6a6c6e'), 0.4, 0.6)
    bm = bmesh.new()
    seg, rings = 16, 5
    verts = [[bm.verts.new((0, 0, 0))]]
    for r in range(1, rings + 1):
        rr = 0.3 * r / rings
        verts.append([bm.verts.new((rr * math.cos(k / seg * 6.2832), rr * math.sin(k / seg * 6.2832) * 0.85, -(rr ** 2) * 0.6))
                      for k in range(seg)])
    for k in range(seg):
        bm.faces.new((verts[0][0], verts[1][k], verts[1][(k + 1) % seg]))
    for r in range(1, rings):
        for k in range(seg):
            bm.faces.new((verts[r][k], verts[r + 1][k], verts[r + 1][(k + 1) % seg], verts[r][(k + 1) % seg]))
    me = bpy.data.meshes.new('dish')
    bm.to_mesh(me)
    o = bpy.data.objects.new('dish', me)
    bpy.context.collection.objects.link(o)
    sol = o.modifiers.new('s', 'SOLIDIFY')
    sol.thickness = 0.01
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='s')
    # the dish faces up the sky and out from the wall (-y): tilt it
    o.rotation_euler = (math.radians(-55), 0, 0)
    o.location = (0, -0.25, 0.32)
    finish(o, white, 1.0)
    parts = [o]
    parts.append(tube((0, -0.25, 0.32), (0, -0.55, 0.62), 0.012, grey))
    parts.append(box((0.07, 0.06, 0.09), (0, -0.56, 0.63), grey, bevel=0.01))
    parts.append(tube((0, -0.02, 0.12), (0, -0.25, 0.32), 0.022, grey))
    parts.append(box((0.14, 0.02, 0.2), (0, 0, 0.12), grey))
    return parts


def p_kettle():
    black = mat('grill-black', hexc('#1b1c1e'), 0.35, 0.2)
    steel = mat('steel', hexc('#9ea2a6'), 0.3, 0.9)
    tyre = MATS.get('tyre') or mat('tyre', hexc('#1a1a1c'), 0.8)
    parts = [sphere(0.29, (0, 0, 0.72), black, seg=16, rings=10, scale=(1, 1, 0.85))]
    parts.append(torus(0.29, 0.008, (0, 0, 0.72), steel, seg=16, mseg=3))
    parts.append(cyl(0.03, 0.03, (0, 0, 0.98), steel, seg=8))
    parts.append(tube((-0.09, 0, 0.99), (0.09, 0, 0.99), 0.012, black))
    for k in range(3):
        a = k / 3 * 6.2832
        parts.append(tube((math.cos(a) * 0.2, math.sin(a) * 0.2, 0.6), (math.cos(a) * 0.32, math.sin(a) * 0.32, 0.05), 0.012, steel))
    parts.append(tube((math.cos(0) * 0.31, -0.18, 0.08), (math.cos(0) * 0.31, 0.18, 0.08), 0.008, steel))
    for y in (-0.18, 0.18):
        parts.append(cyl(0.06, 0.03, (0.31, y, 0.06), tyre, seg=10, rot=(math.pi / 2, 0, 0)))
    parts.append(torus(0.17, 0.006, (0, 0, 0.3), steel, seg=12, mseg=3))
    return parts


def p_gasgrill():
    black = mat('grill-black', hexc('#1b1c1e'), 0.35, 0.2)
    steel = mat('steel', hexc('#9ea2a6'), 0.3, 0.9)
    sst = mat('stainless', hexc('#b9bcbe'), 0.25, 0.9)
    tyre = MATS.get('tyre') or mat('tyre', hexc('#1a1a1c'), 0.8)
    parts = [box((0.75, 0.5, 0.55), (0, 0, 0.42), black, bevel=0.01)]
    parts.append(box((0.6, 0.48, 0.06), (0, 0, 0.73), black))
    parts.append(box((0.62, 0.46, 0.22), (0, 0, 0.86), sst, bevel=0.08))
    for x in (-0.55, 0.55):
        parts.append(box((0.32, 0.46, 0.03), (x, 0, 0.72), black))
    parts.append(tube((-0.25, -0.27, 0.95), (0.25, -0.27, 0.95), 0.012, steel))
    parts.append(box((0.6, 0.01, 0.4), (0, -0.255, 0.42), sst))
    for x in (-0.3, 0.3):
        parts.append(cyl(0.06, 0.04, (x, -0.2, 0.06), tyre, seg=10, rot=(math.pi / 2, 0, 0)))
    return parts


def p_mailbox_post():
    black = mat('mailbox-black', hexc('#26282b'), 0.45, 0.4)
    wood = mat('post-wood', hexc('#8c7458'), 0.8)
    red = mat('flag-red', hexc('#b02a20'), 0.5, 0.3)
    parts = [box((0.09, 0.09, 1.1), (0, 0, 0.55), wood, bevel=0.01)]
    parts.append(box((0.3, 0.12, 0.03), (0, 0, 1.11), wood))
    # the box: a half-cylinder vault on a flat bottom, opening toward the street (+x)
    parts.append(box((0.48, 0.17, 0.12), (0, 0, 1.18), black, bevel=0.005))
    parts.append(cyl(0.085, 0.48, (0, 0, 1.24), black, seg=12, rot=(0, math.pi / 2, 0)))
    parts.append(box((0.012, 0.03, 0.17), (-0.02, 0.1, 1.33), red))
    parts.append(box((0.012, 0.09, 0.03), (-0.02, 0.135, 1.4), red))
    return parts


def p_mailbox_brick():
    brick = mat('brick', hexc('#8a4a3a'), 0.85)
    cap = mat('stone-cap', hexc('#b8b2a6'), 0.8)
    black = mat('mailbox-black', hexc('#26282b'), 0.45, 0.4)
    parts = [box((0.42, 0.42, 1.05), (0, 0, 0.525), brick, bevel=0.01)]
    parts.append(box((0.5, 0.5, 0.06), (0, 0, 1.08), cap, bevel=0.01))
    parts.append(box((0.43, 0.2, 0.26), (0.0, 0, 0.72), black))
    parts.append(box((0.02, 0.24, 0.12), (0.22, 0, 0.4), cap))
    return parts


def p_mailbox_white():
    white = mat('post-white', hexc('#e6e4dc'), 0.6)
    green = mat('mailbox-green', hexc('#3f5442'), 0.45, 0.4)
    parts = [box((0.1, 0.1, 1.15), (0, 0, 0.575), white, bevel=0.01)]
    parts.append(tube((0, 0, 1.0), (0.32, 0, 1.0), 0.03, white))
    parts.append(tube((0, 0, 0.75), (0.25, 0, 1.0), 0.02, white))
    parts.append(box((0.46, 0.17, 0.12), (0.3, 0, 1.1), green, bevel=0.005))
    parts.append(cyl(0.085, 0.46, (0.3, 0, 1.16), green, seg=12, rot=(0, math.pi / 2, 0)))
    parts.append(sphere(0.05, (0, 0, 1.2), white, seg=8, rings=6))
    return parts


def p_ball():
    a = mat('ball-red', hexc('#b8402e'), 0.45)
    b = mat('ball-yellow', hexc('#d8b23a'), 0.45)
    s = sphere(0.11, (0, 0, 0.11), a, seg=14, rings=9)
    s2 = sphere(0.1105, (0, 0, 0.11), b, seg=14, rings=9, scale=(1, 0.35, 1))
    return [s, s2]


def p_toytruck():
    yellow = mat('toy-yellow', hexc('#d9a62a'), 0.45)
    red = mat('toy-red', hexc('#b8402e'), 0.45)
    black = MATS.get('tyre') or mat('tyre', hexc('#1a1a1c'), 0.8)
    parts = [box((0.22, 0.2, 0.12), (0.18, 0, 0.12), red, bevel=0.02)]
    parts.append(box((0.34, 0.22, 0.04), (-0.04, 0, 0.07), red))
    bm_parts = [box((0.34, 0.24, 0.14), (-0.06, 0, 0.17), yellow, rot=(0, -0.25, 0), bevel=0.015)]
    parts += bm_parts
    for x in (-0.12, 0.18):
        for y in (-0.12, 0.12):
            parts.append(cyl(0.05, 0.04, (x, y, 0.05), black, seg=10, rot=(math.pi / 2, 0, 0)))
    return parts


def p_kayak():
    shell = mat('kayak', hexc('#c85a2a'), 0.35)
    seat = mat('saddle', hexc('#232325'), 0.6)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=1)
    o = bpy.context.object
    for v in o.data.vertices:
        x, y, z = v.co
        v.co = Vector((x * 1.6, y * 0.33 * (1 - 0.3 * abs(x) ** 2), (z * 0.16 if z < 0 else z * 0.1) + 0.15))
    finish(o, shell, 1.2)
    parts = [o]
    # the cockpit: a dark oval coaming and the seat in it
    parts.append(sphere(0.2, (0.05, 0, 0.245), seat, seg=12, rings=4, scale=(1.6, 0.85, 0.12)))
    return parts


PROC = {
    # id: (builder, high tris budget (None: as built), lean tris, tile px)
    'pumpkin':     (p_pumpkin, 300, 90, 128),
    'leaf-bag':    (p_leafbag, None, 60, 128),
    'hoop':        (p_hoop, None, 140, 256),
    'bike':        (p_bike, 900, 260, 256),
    'kid-bike':    (p_kidbike, 900, 240, 256),
    'scooter':     (p_scooter, None, 70, 128),
    'wheelbarrow': (p_wheelbarrow, 520, 150, 256),
    'mower':       (p_mower, 560, 160, 256),
    'hose-reel':   (p_hosereel, 520, 140, 128),
    'hose':        (p_hose, 700, 200, 128),
    'clothesline': (p_clothesline, 900, 260, 256),
    'slide':       (p_slide, None, 120, 256),
    'hot-tub':     (p_hottub, None, 60, 256),
    'ladder':      (p_ladder, None, 90, 256),
    'dish':        (p_dish, None, 80, 128),
    'kettle-grill': (p_kettle, 520, 140, 128),
    'gas-grill':   (p_gasgrill, None, 120, 256),
    'mailbox-post': (p_mailbox_post, None, 70, 128),
    'mailbox-brick': (p_mailbox_brick, None, 50, 128),
    'mailbox-white': (p_mailbox_white, None, 80, 128),
    'ball':        (p_ball, 220, 60, 128),
    'toy-truck':   (p_toytruck, None, 60, 128),
    'kayak':       (p_kayak, None, 80, 256),
}


# ---- build -------------------------------------------------------------------------------------------

def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def ground_it(o):
    """centre the footprint on the origin, base on z = 0"""
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = Vector([min(v[i] for v in bb) for i in range(3)])
    mx = Vector([max(v[i] for v in bb) for i in range(3)])
    off = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    o.data.transform(Matrix.Translation(-off))
    o.matrix_world = Matrix.Identity(4)
    return mn, mx


def import_ph(pid, asset, keep):
    path, meta = fetch(asset)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    if isinstance(keep, str):
        meshes = [o for o in meshes if o.name.startswith(keep)]
    elif keep:
        meshes = [o for o in meshes if o.name in keep]
    for o in new:
        if o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in meshes:
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.data = o.data.copy()
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        o.select_set(False)
    hi = join(meshes, pid + '#hi') if len(meshes) > 1 else meshes[0]
    hi.name = pid + '#hi'
    return hi, meta


def make_low(hi, pid, target):
    bpy.ops.object.select_all(action='DESELECT')
    lo = hi.copy()
    lo.data = hi.data.copy()
    bpy.context.collection.objects.link(lo)
    lo.name = pid
    lo.data.name = pid
    lo.data.materials.clear()
    bpy.context.view_layer.objects.active = lo
    lo.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.mesh.quads_convert_to_tris()
    bpy.ops.object.mode_set(mode='OBJECT')
    n = tris(lo)
    if target and n > target:
        mod = lo.modifiers.new('d', 'DECIMATE')
        mod.ratio = target / n
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='d')
    for uv in list(lo.data.uv_layers):
        lo.data.uv_layers.remove(uv)
    lo.data.uv_layers.new(name='UVMap')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.03, area_weight=0.0, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))
    lo.select_set(False)
    return lo


def make_lean(lo, target):
    lean = lo.copy()
    lean.data = lo.data.copy()
    bpy.context.collection.objects.link(lean)
    lean.name = lo.name + '-lean'
    lean.data.name = lean.name
    n = tris(lean)
    if n > target * 1.3:
        # bolts, insulators, handles: small loose parts the collapse cannot take below a few dozen
        # triangles each, and which are a pixel at the distance the lean mesh is drawn
        bm = bmesh.new()
        bm.from_mesh(lean.data)
        bm.faces.ensure_lookup_table()
        seen = set()
        parts = []
        for f in bm.faces:
            if f.index in seen:
                continue
            stack, comp = [f], []
            seen.add(f.index)
            while stack:
                g = stack.pop()
                comp.append(g)
                for e in g.edges:
                    for h in e.link_faces:
                        if h.index not in seen:
                            seen.add(h.index)
                            stack.append(h)
            pts = [v.co for g in comp for v in g.verts]
            diag = (Vector([max(p[i] for p in pts) for i in range(3)]) - Vector([min(p[i] for p in pts) for i in range(3)])).length
            parts.append((diag, comp))
        big = max(d for d, _ in parts)
        drop = [g for d, comp in parts if d < big * 0.09 for g in comp]
        if drop and len(drop) < len(bm.faces) * 0.8:
            bmesh.ops.delete(bm, geom=drop, context='FACES')
        bm.to_mesh(lean.data)
        bm.free()
        n = tris(lean)
    if n > target:
        bpy.context.view_layer.objects.active = lean
        mod = lean.modifiers.new('d', 'DECIMATE')
        mod.ratio = target / n
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='d')
    return lean


def pack(items):
    """shelf-pack square tiles (px) into the atlas; returns {id: (x, y, size)} in px from the bottom left"""
    order = sorted(items, key=lambda k: -items[k])
    out = {}
    x = y = shelf = 0
    for k in order:
        s = items[k]
        if x + s > ATLAS:
            x = 0
            y += shelf
            shelf = 0
        out[k] = (x, y, s)
        x += s
        shelf = max(shelf, s)
    assert y + shelf <= ATLAS, 'atlas overflow'
    return out


def place_uvs(o, rect):
    x, y, s = rect
    pad = 3
    u0, v0 = (x + pad) / ATLAS, (y + pad) / ATLAS
    k = (s - 2 * pad) / ATLAS
    for d in o.data.uv_layers.active.data:
        d.uv = (u0 + d.uv[0] * k, v0 + d.uv[1] * k)


def rewire(materials, channel):
    """point every source material's output at an emission of `channel` (base, rough, metal), or restore"""
    for m in materials:
        nt = m.node_tree
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output), None)
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not out or not bsdf:
            continue
        if channel is None:
            for l in list(out.inputs['Surface'].links):
                nt.links.remove(l)
            nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
            continue
        em = nt.nodes.get('#emit') or nt.nodes.new('ShaderNodeEmission')
        em.name = '#emit'
        em.inputs['Strength'].default_value = 1.0
        for l in list(em.inputs['Color'].links):
            nt.links.remove(l)
        sock = bsdf.inputs[{'base': 'Base Color', 'rough': 'Roughness', 'metal': 'Metallic'}[channel]]
        if sock.links:
            nt.links.new(sock.links[0].from_socket, em.inputs['Color'])
        else:
            v = sock.default_value
            em.inputs['Color'].default_value = (list(v)[:3] + [1]) if channel == 'base' else (v, v, v, 1)
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])


def main():
    reset()
    os.makedirs(OUT, exist_ok=True)
    built = {}    # id -> dict(hi, lo, lean, tile, credit)
    credits = {}
    for pid, (asset, keep, hi_t, lean_t, tile) in PH.items():
        hi, meta = import_ph(pid, asset, keep)
        if pid == 'power-pole':
            # the kit's poles are 6 m; a suburban distribution pole stands nearer 10
            hi.data.transform(Matrix.Scale(1.6, 4))
        credits[pid] = meta
        built[pid] = dict(hi=hi, hi_t=hi_t, lean_t=lean_t, tile=tile)
        print('ph', pid, tris(hi), flush=True)
    for pid, (fn, hi_t, lean_t, tile) in PROC.items():
        parts = fn()
        hi = join(parts, pid + '#hi')
        built[pid] = dict(hi=hi, hi_t=hi_t, lean_t=lean_t, tile=tile)
        print('proc', pid, tris(hi), flush=True)

    # every prop on the ground at its own spot, then its low and lean meshes
    ids = list(built)
    # the nominal tiles (128/256/512) grown to fill the sheet: about 80% of it is used
    tiles = pack({k: {128: 160, 256: 320}.get(built[k]['tile'], built[k]['tile']) for k in ids})
    for i, pid in enumerate(ids):
        b = built[pid]
        mn, mx = ground_it(b['hi'])
        b['size'] = [mx.x - mn.x, mx.z - mn.z, mx.y - mn.y]
        lo = make_low(b['hi'], pid, b['hi_t'])
        place_uvs(lo, tiles[pid])
        b['lo'] = lo
        off = Matrix.Translation(((i % 8) * SPREAD, (i // 8) * SPREAD, 0))
        b['hi'].matrix_world = off
        lo.matrix_world = off
        print('low', pid, tris(lo), flush=True)

    # ground planes under every prop for the occlusion
    bpy.ops.mesh.primitive_plane_add(size=SPREAD * 9, location=(SPREAD * 3.5, SPREAD * 3, -0.002))
    ground = bpy.context.object
    ground.data.materials.append(mat('ground', (0.3, 0.3, 0.3), 0.9))

    # the bake target: every low joined into one object (copies; the originals are exported)
    copies = []
    for pid in ids:
        c = built[pid]['lo'].copy()
        c.data = built[pid]['lo'].data.copy()
        bpy.context.collection.objects.link(c)
        copies.append(c)
    target = join(copies, '#bake')
    bake_mat = bpy.data.materials.new('#bake')
    bake_mat.use_nodes = True
    target.data.materials.clear()
    target.data.materials.append(bake_mat)
    imgs = {}
    for name, srgb in (('color', True), ('rough', False), ('metal', False), ('ao', False), ('normal', False)):
        img = bpy.data.images.new(name, ATLAS, ATLAS, alpha=False, float_buffer=False)
        img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        imgs[name] = img
    node = bake_mat.node_tree.nodes.new('ShaderNodeTexImage')
    bake_mat.node_tree.nodes.active = node
    sources = [built[p]['hi'] for p in ids]
    src_mats = {m for o in sources for m in o.data.materials if m and m.use_nodes}

    scene = bpy.context.scene
    bk = scene.render.bake
    bk.use_selected_to_active = True
    bk.cage_extrusion = 0.03
    bk.max_ray_distance = 0.12
    bk.margin = 6

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
        rewire(src_mats, channel)
        bake('EMIT', imgs[img], 4)
    rewire(src_mats, None)
    scene.world = bpy.data.worlds.new('w')
    scene.world.light_settings.distance = 0.5
    bake('AO', imgs['ao'], 48)
    bake('NORMAL', imgs['normal'], 4, normal_space='TANGENT')

    # compose and write the maps
    import numpy as np
    from PIL import Image

    def arr(img):
        a = np.array(img.pixels[:], dtype=np.float32).reshape(ATLAS, ATLAS, 4)[::-1]
        return a
    col = arr(imgs['color'])[..., :3]
    ao = arr(imgs['ao'])[..., 0]
    rough = arr(imgs['rough'])[..., 0]
    metal = arr(imgs['metal'])[..., 0]
    nrm = arr(imgs['normal'])[..., :3]
    # AO folded into the albedo; pixels are sRGB-encoded already (byte images), so fold in linear
    lin = np.where(col <= 0.04045, col / 12.92, ((col + 0.055) / 1.055) ** 2.4)
    lin *= (0.35 + 0.65 * ao)[..., None]
    enc = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(np.clip(lin, 0, 1), 1 / 2.4) - 0.055)
    to8 = lambda a: Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8))
    to8(enc).save(os.path.join(OUT, 'atlas-color.webp'), quality=88, method=6)
    to8(enc).resize((ATLAS // 2, ATLAS // 2), Image.LANCZOS).save(os.path.join(OUT, 'atlas-color-low.webp'), quality=85, method=6)
    to8(np.stack([ao, rough, metal], -1)).save(os.path.join(OUT, 'atlas-orm.webp'), quality=88, method=6)
    to8(nrm).save(os.path.join(OUT, 'atlas-normal.webp'), quality=90, method=6)

    # export: every low and lean at the origin, in site units
    bpy.ops.object.select_all(action='DESELECT')
    manifest = {'scale': SITE, 'props': {}}
    exported = []
    for pid in ids:
        b = built[pid]
        lo = b['lo']
        lo.matrix_world = Matrix.Identity(4)
        lean = make_lean(lo, b['lean_t'])
        for o in (lo, lean):
            o.data.transform(Matrix.Scale(SITE, 4))
            o.data.materials.clear()
            exported.append(o)
        w, h, d = (x * SITE for x in b['size'])
        manifest['props'][pid] = {'tris': tris(lo), 'lean': tris(lean), 'size': [round(w, 4), round(h, 4), round(d, 4)],
                                  'radius': round(math.hypot(w, d) / 2, 4)}
        print('out', pid, tris(lo), tris(lean), flush=True)
    for o in exported:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'props.glb'), export_format='GLB', use_selection=True,
                              export_materials='NONE', export_texcoords=True, export_normals=True,
                              export_apply=True, export_yup=True)
    manifest['credits'] = {pid: credits[pid] for pid in credits}
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)

    if SHEET:
        contact_sheet(exported, SHEET)


def contact_sheet(objs, folder):
    """every HIGH prop in a grid, lit by a sun and a sky, with the baked atlas on it"""
    os.makedirs(folder, exist_ok=True)
    m = bpy.data.materials.new('#sheet')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = bpy.data.images.load(os.path.join(OUT, 'atlas-color.webp'))
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    for o in bpy.data.objects:
        o.hide_render = True
    highs = [o for o in objs if not o.name.endswith('-lean')]
    for i, o in enumerate(highs):
        o.hide_render = False
        o.data.materials.append(m)
        o.matrix_world = Matrix.Translation(((i % 8) * 0.8, -(i // 8) * 0.8, 0))
    bpy.ops.object.light_add(type='SUN', rotation=(0.8, 0.2, 0.6))
    bpy.context.object.data.energy = 3
    bpy.context.scene.world.color = (0.5, 0.55, 0.6)
    bpy.ops.object.camera_add(location=(2.8, -6.5, 5.5), rotation=(math.radians(52), 0, 0))
    cam = bpy.context.object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 7.2
    scene = bpy.context.scene
    scene.camera = cam
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1100
    scene.cycles.samples = 24
    scene.render.filepath = os.path.join(folder, 'sheet.png')
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
