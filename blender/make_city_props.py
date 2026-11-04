"""Builds the night city's street and rooftop props into ONE shared atlas (one material on the site).

    python blender/fetch_city_props.py                  # once: the Poly Haven (CC0) sources, into blender/cache/polyhaven
    python blender/make_city_props.py [--src DIR] [--render DIR] [--only id,id]
    npm run compress:models                             # meshopt-packs the two GLBs

Two kinds of prop go in:

- Poly Haven models (hydrants, bins, bags, AC units, utility boxes, a jersey barrier, a barrel, crates,
  a cardboard box, a tyre, a chalkboard, a wet-floor A-frame, a coffee cart, a planter, a propane tank,
  a plastic chair). Each is split into its variants, decimated to a site budget (`near`, then `lean`
  for phones and distance), unwrapped into the shared atlas, and its 1k photo-scanned material baked
  across from the full-resolution model (selected-to-active: colour, roughness, tangent normals);
- procedural props from `bld/city_props.py` (roof water tanks, rooftop units, dishes, antennas, vents,
  newspaper boxes, a mailbox, bike racks and bicycles, cones, hoardings, scaffold, a pallet, litter),
  whose noise-grimed materials are baked the same way.

Cycles then bakes ambient occlusion on every low mesh (with a ground plane) and multiplies it into
the colour. Out, in public/models/city-props/:

    props.glb        every prop at its `near` budget, one mesh node per prop (metres, front +Z)
    props-lean.glb   the same at the `lean` budget, same UVs
    atlas-color.webp colour x occlusion (sRGB), 1024 px
    atlas-orm.webp   R occlusion, G roughness, B metalness (0), 1024 px
    atlas-normal.webp  tangent-space normals (HIGH only)
    props.json       per prop: triangles near/lean, size (metres) and the cable texel
    CREDITS.md       the Poly Haven sources, their authors and licence
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from bld import city_props as cp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'city-props')
TEX = 1024

# Poly Haven props: id -> (asset, object filter on the imported names / x side, near tris, lean tris, yaw fix)
# `side` picks one of the variants that Poly Haven lays side by side (x < 0 or x > 0).
PH = {
    'hydrant': ('fire_hydrant', {'has': '_aged', 'not': True}, 900, 180, 0),
    'hydrant_aged': ('fire_hydrant', {'has': '_aged'}, 900, 180, 0),
    'trash_can': ('metal_trash_can', {'side': 1}, 700, 160, 0),
    'trash_can_rust': ('metal_trash_can', {'side': -1}, 700, 160, 0),
    'trashbag': ('trashbag', {}, 420, 90, 0),
    'aircon': ('exterior_aircon_unit', {'side': -1}, 500, 80, 0),
    'aircon_rust': ('exterior_aircon_unit', {'side': 1}, 500, 80, 0),
    'utility_box': ('utility_box_01', {}, 260, 40, 0),
    'utility_box_wide': ('utility_box_02', {}, 300, 50, 0),
    'barrier': ('concrete_road_barrier_02', {}, 380, 70, 0),
    'barrel': ('barrel_03', {}, 300, 70, 0),
    'crate': ('wooden_crate_02', {}, 220, 30, 0),
    'plastic_crate': ('plastic_crate_02', {}, 360, 60, 0),
    'cardboard': ('cardboard_box_01', {}, 160, 30, 0),
    'tyre': ('old_tyre', {}, 300, 70, 0),
    'chalkboard': ('standing_chalkboard_01', {}, 300, 60, 0),
    'wet_sign': ('WetFloorSign_01', {}, 228, 60, 0),
    'coffee_cart': ('CoffeeCart_01', {}, 3200, 500, 0),
    'planter': ('planter_box_01', {}, 600, 100, 0),
    'propane': ('propane_tank', {}, 240, 50, 0),
    'chair': ('plastic_monobloc_chair_01', {}, 420, 80, 0),
}
# procedural props: lean budget as a fraction of near (they are built at their near budget)
PROC_LEAN = {'water_tank': 0.5, 'rooftop_unit': 0.6, 'dish': 0.6, 'antenna': 1.0, 'roof_vent': 0.6, 'mailbox': 0.6,
             'bike_teal': 0.45, 'bike_black': 0.45, 'bike_red': 0.45, 'scaffold': 0.7, 'pallet': 1.0, 'cone': 1.0}


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def apply_all(o):
    select_only([o])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def ground_origin(o):
    """Origin to the middle of its footprint, on the ground."""
    vs = np.array([v.co[:] for v in o.data.vertices])
    mn, mx = vs.min(0), vs.max(0)
    o.data.transform(Matrix.Translation((-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2])))
    return (mx - mn).tolist()


def import_ph(pid, src):
    asset, flt, near, lean, yaw = PH[pid]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src, asset, f'{asset}_1k.gltf'))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    keep = []
    for o in meshes:
        cx = sum((o.matrix_world @ Vector(c)).x for c in o.bound_box) / 8
        ok = True
        if 'has' in flt:
            ok = (flt['has'] in o.name) != bool(flt.get('not'))
        if 'side' in flt:
            ok = ok and (cx > 0) == (flt['side'] > 0)
        (keep if ok else []).append(o)
    for o in keep:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in new:
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    hi = cp.join(f'{pid}_hi', keep) if len(keep) > 1 else keep[0]
    hi.name = f'{pid}_hi'
    apply_all(hi)
    if yaw:
        hi.data.transform(Matrix.Rotation(yaw, 4, 'Z'))
    size = ground_origin(hi)
    lo = hi.copy()
    lo.data = hi.data.copy()
    lo.name = pid
    bpy.context.scene.collection.objects.link(lo)
    t = tris(lo)
    if t > near:
        dec = lo.modifiers.new('dec', 'DECIMATE')
        dec.ratio = near / t
        dec.use_collapse_triangulate = True
        select_only([lo])
        bpy.ops.object.modifier_apply(modifier='dec')
    return hi, lo, size, lean


def bake_target_material(img):
    m = bpy.data.materials.new('bake_target')
    m.use_nodes = True
    n = m.node_tree.nodes.new('ShaderNodeTexImage')
    n.image = img
    m.node_tree.nodes.active = n
    return m


def set_target(objs, img):
    """Make `img` the active (bake target) image node in every material of these objects."""
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if not m or not m.use_nodes:
                continue
            node = m.node_tree.nodes.get('__bake__')
            if node is None:
                node = m.node_tree.nodes.new('ShaderNodeTexImage')
                node.name = '__bake__'
            node.image = img
            m.node_tree.nodes.active = node


def new_image(name, fill, non_color):
    img = bpy.data.images.new(name, TEX, TEX, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    px = np.tile(np.array([*fill, 1.0], dtype=np.float32), TEX * TEX)
    img.pixels.foreach_set(px)
    return img


def save_webp(img, path, quality=88):
    img.filepath_raw = path
    img.file_format = 'WEBP'
    img.save(filepath=path, quality=quality)


def export(objs, path):
    for o in objs:
        select_only([o])
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    select_only(objs)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True,
        export_materials='NONE', export_normals=True, export_yup=True, export_tangents=False,
        export_texcoords=True, export_cameras=False, export_lights=False, export_vertex_color='NONE',
    )


def main():
    args = sys.argv[1:]
    src = os.path.join(ROOT, 'blender', 'cache', 'polyhaven')
    render = None
    only = None
    if '--src' in args:
        src = args[args.index('--src') + 1]
    if '--render' in args:
        render = args[args.index('--render') + 1]
    if '--only' in args:
        only = set(args[args.index('--only') + 1].split(','))
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    world.light_settings.distance = 0.6
    scene.world = world

    pairs = []      # (id, hi or None, lo, size, lean target, source)
    for pid in PH:
        if only and pid not in only:
            continue
        hi, lo, size, lean = import_ph(pid, src)
        pairs.append((pid, hi, lo, size, lean, PH[pid][0]))
        print(f'{pid:18s} {tris(hi):6d} -> {tris(lo):5d} tris, size {[round(s, 2) for s in size]}')
    litter = []
    for pid, fn in cp.builders():
        if only and pid not in only:
            continue
        o = fn()
        apply_all(o)
        size = ground_origin(o)
        lean = max(12, int(tris(o) * PROC_LEAN.get(pid, 0.7)))
        pairs.append((pid, None, o, size, lean, None))
        print(f'{pid:18s} procedural {tris(o):5d} tris, size {[round(s, 2) for s in size]}')
    if not only or 'litter' in only:
        for o in cp.litter():
            apply_all(o)
            size = ground_origin(o)
            pairs.append((o.name, None, o, size, tris(o), None))
            litter.append(o.name)

    # lay every pair out on its own spot so the occlusion bake sees only its own prop (and the ground)
    for i, (pid, hi, lo, size, lean, _) in enumerate(pairs):
        at = Matrix.Translation(((i % 8) * 8.0, (i // 8) * 8.0, 0))
        lo.matrix_world = at
        if hi:
            hi.matrix_world = at

    # ---- the shared atlas: one UV set over every low mesh, islands scaled to the same texel density
    lows = [p[2] for p in pairs]
    for o in lows:
        while o.data.uv_layers:
            o.data.uv_layers.remove(o.data.uv_layers[0])
        o.data.uv_layers.new(name='atlas')
    select_only(lows)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')

    color = new_image('atlas_color', (0.5, 0.5, 0.5), False)
    rough = new_image('atlas_rough', (0.7, 0.7, 0.7), True)
    normal = new_image('atlas_normal', (0.5, 0.5, 1.0), True)
    ao = new_image('atlas_ao', (1.0, 1.0, 1.0), True)

    # Poly Haven lows bake from their source; give them a bare target material
    targets = {}
    for pid, hi, lo, *_ in pairs:
        if hi:
            lo.data.materials.clear()
            targets[pid] = bake_target_material(color)
            lo.data.materials.append(targets[pid])

    scene.cycles.samples = 8
    scene.render.bake.margin = 3
    bake = scene.render.bake

    def run(kind, img, selected, cage=0.0, ray=0.0, passes=None, space='TANGENT'):
        for pid, hi, lo, size, *_ in pairs:
            if selected and not hi:
                continue
            if not selected and hi and kind not in ('AO',):
                continue
            set_target([lo], img)
            if selected:
                select_only([hi, lo], active=lo)
                ext = max(size) * 0.025
                kw = dict(use_selected_to_active=True, cage_extrusion=ext, max_ray_distance=ext * 3)
            else:
                select_only([lo])
                kw = dict(use_selected_to_active=False)
            if passes:
                kw['pass_filter'] = passes
            if kind == 'NORMAL':
                kw['normal_space'] = space
            bpy.ops.object.bake(type=kind, margin=3, use_clear=False, **kw)

    # colour and roughness from the scans (selected-to-active) and from the procedural materials (themselves)
    run('DIFFUSE', color, True, passes={'COLOR'})
    run('DIFFUSE', color, False, passes={'COLOR'})
    run('ROUGHNESS', rough, True)
    run('ROUGHNESS', rough, False)
    run('NORMAL', normal, True)
    # occlusion on every low mesh, a ground plane under each
    me = bpy.data.meshes.new('ground')
    me.from_pydata([(-10, -10, 0), (80, -10, 0), (80, 80, 0), (-10, 80, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new('ground', me)
    scene.collection.objects.link(g)
    scene.cycles.samples = 64
    for pid, hi, lo, *_ in pairs:
        if hi:
            hi.hide_render = True
    run('AO', ao, False)

    # colour x occlusion; ORM = (occlusion, roughness, 0)
    c = np.array(color.pixels[:], dtype=np.float32).reshape(-1, 4)
    a = np.array(ao.pixels[:], dtype=np.float32).reshape(-1, 4)
    r = np.array(rough.pixels[:], dtype=np.float32).reshape(-1, 4)
    occ = 0.25 + 0.75 * a[:, 0:1]
    c[:, :3] *= occ
    color.pixels.foreach_set(c.ravel())
    orm = np.ones_like(c)
    orm[:, 0] = a[:, 0]
    orm[:, 1] = r[:, 0]
    orm[:, 2] = 0.0
    ormi = new_image('atlas_orm', (1, 1, 1), True)
    ormi.pixels.foreach_set(orm.ravel())
    save_webp(color, os.path.join(OUT, 'atlas-color.webp'))
    save_webp(ormi, os.path.join(OUT, 'atlas-orm.webp'))
    save_webp(normal, os.path.join(OUT, 'atlas-normal.webp'), 92)

    # ---- export: near, then lean (decimated copies; UVs carry over)
    for pid, hi, lo, *_ in pairs:
        lo.matrix_world = Matrix()
        if hi:
            bpy.data.objects.remove(hi, do_unlink=True)
    bpy.data.objects.remove(g, do_unlink=True)
    info = {}
    for pid, _, lo, size, lean, source in pairs:
        info[pid] = {'near': tris(lo), 'size': [round(s, 3) for s in size], **({'source': source} if source else {})}
    # the cable's texel: the middle of its first face's UVs
    cab = next((p[2] for p in pairs if p[0] == 'cable'), None)
    if cab:
        uv = cab.data.uv_layers[0].data
        f = cab.data.polygons[0]
        u = sum(uv[i].uv[0] for i in f.loop_indices) / f.loop_total
        v = sum(uv[i].uv[1] for i in f.loop_indices) / f.loop_total
        info['cable']['uv'] = [round(u, 5), round(1 - v, 5)]
    export(lows, os.path.join(OUT, 'props.glb'))
    leans = []
    for pid, _, lo, size, lean, _s in pairs:
        o = lo.copy()
        o.data = lo.data.copy()
        o.name = f'{pid}.lean'
        scene.collection.objects.link(o)
        t = tris(o)
        if lean < t:
            dec = o.modifiers.new('dec', 'DECIMATE')
            dec.ratio = lean / t
            dec.use_collapse_triangulate = True
            select_only([o])
            bpy.ops.object.modifier_apply(modifier='dec')
        info[pid]['lean'] = tris(o)
        leans.append(o)
    for o in lows:
        o.hide_set(True)
        o.name = o.name + '_n'
    for o in leans:
        o.name = o.name.replace('.lean', '')
    export(leans, os.path.join(OUT, 'props-lean.glb'))
    json.dump({'atlas': TEX, 'litter': litter, 'props': info}, open(os.path.join(OUT, 'props.json'), 'w'), indent=1)

    # ---- credits
    seen = {}
    for pid, _, _, _, _, source in pairs:
        if source:
            seen.setdefault(source, []).append(pid)
    lines = ['# City props: credits', '',
             'The night city\'s street and rooftop props (`props.glb`, `props-lean.glb` and the atlas maps) are built by',
             '`blender/make_city_props.py`. The procedural ones (roof water tanks, rooftop units, dishes, antennas, vents,',
             'newspaper boxes, the mailbox, bike racks and bicycles, cones, hoardings, scaffold, the pallet, litter and the',
             'cable) are modelled in `blender/bld/city_props.py` for this site. These are decimated and re-baked from',
             'Poly Haven models, all licensed **CC0** (public domain, https://polyhaven.com/license):', '',
             '| prop(s) | Poly Haven asset | author(s) |', '| --- | --- | --- |']
    for source, ids in seen.items():
        meta = {}
        p = os.path.join(src, source, 'info.json')
        if os.path.exists(p):
            meta = json.load(open(p))
        lines.append(f"| {', '.join(ids)} | [{meta.get('name', source)}](https://polyhaven.com/a/{source}) | {', '.join(meta.get('authors', []))} |")
    open(os.path.join(OUT, 'CREDITS.md'), 'w').write('\n'.join(lines) + '\n')

    if render:
        for o in leans:
            o.hide_set(True)
            o.hide_render = True
        contact_sheet(lows, render)
    print('done', len(pairs), 'props')


def contact_sheet(objs, out):
    """A Cycles render of every near prop with the atlas maps on, in rows (for checking the bake)."""
    os.makedirs(out, exist_ok=True)
    scene = bpy.context.scene
    m = bpy.data.materials.new('preview')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    tc = nt.nodes.new('ShaderNodeTexImage')
    tc.image = bpy.data.images.load(os.path.join(OUT, 'atlas-color.webp'))
    nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = bpy.data.images.load(os.path.join(OUT, 'atlas-normal.webp'))
    tn.image.colorspace_settings.name = 'Non-Color'
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 0.6
    x = 0.0
    row = 0
    rowx = [0.0, 0.0, 0.0, 0.0]
    for o in objs:
        o.hide_set(False)
        o.hide_render = False
        o.data.materials.clear()
        o.data.materials.append(m)
        w = max(o.dimensions.x, 0.3)
        if o.dimensions.z > 2.5:
            row_i = 3
        elif o.dimensions.z > 0.9:
            row_i = 2
        elif o.dimensions.z > 0.3:
            row_i = 1
        else:
            row_i = 0
        o.location = (rowx[row_i] + w / 2, row_i * 2.0, (0.0, 0.6, 1.8, 4.2)[row_i])
        rowx[row_i] += w + 0.3
    del x, row
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    span = max(rowx)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = max(span, 10.5 * 16 / 7) * 1.08
    cam.rotation_euler = (math.radians(84), 0, 0)
    cam.location = Vector((span / 2, 3.0, 5.0)) - cam.rotation_euler.to_matrix() @ Vector((0, 0, -40))
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.25, 0.27, 0.3, 1)
    scene.render.resolution_x, scene.render.resolution_y = 1600, 700
    scene.cycles.samples = 16
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = os.path.join(out, 'props-sheet.png')
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
