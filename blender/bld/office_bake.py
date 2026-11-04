"""Office props pipeline: Blender objects from the two builds, one shared UV atlas, Cycles bakes
from each high-poly twin onto its lean mesh, map assembly, glTF export and comparison renders.

Bake passes (selected-to-active, each prop alone in the scene):
  normal  tangent-space normals from the real bevels, keycaps, jacks, vents and the materials' bump
  gi      path-traced diffuse light under a uniform white sky over a white floor (and the wall or
          ceiling the prop backs onto): bounce-aware occlusion, 1.0 in the open. It goes to the ORM
          map's R and, a little of it, into the albedo
  color   albedo with the procedural wear (EMIT through each material's EM_C branch)
  orm     roughness (G) and metalness (B) (EM_ORM)
  mask    coverage (EM_W), so empty texels are filled by push-pull rather than left grey
"""
import math
import os
import time

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from . import office, office_mats as M

ATLAS = 2048
AREA = 0.978            # islands pack into [0, AREA]^2; the strip beyond holds the LED palette cells
CELL = 1.0 / 32         # LED palette cell height (v)
CAGE = 0.008            # cage extrusion (m): every high-poly detail sits within this of its lean surface
REACH = 0.05            # max ray distance
SAMPLES = dict(normal=6, color=8, orm=4, mask=1, gi=32)


def led_uv(tint):
    k = M.LED_TINTS.index(tint)
    return ((1 + AREA) / 2, 1 - (k + 0.5) * CELL)


# -- objects ---------------------------------------------------------------------------------------------

def _mesh(name, items, smooth=35, tri=False):
    """items: [(geo, material name, weight, tint)] -> a mesh object, a material slot per name."""
    mats = []
    for _, m, _, _ in items:
        if m not in mats:
            mats.append(m)
    verts, faces, mi, uvs, wts, pid = [], [], [], [], [], []
    off = 0
    for pi, (g, m, w, tint) in enumerate(items):
        verts.append(g.v)
        k = mats.index(m)
        for fi, f in enumerate(g.f):
            faces.append([i + off for i in f])
            mi.append(k)
            wts.append(w)
            pid.append(pi)
            if m == 'led' and tint:
                uvs.append([led_uv(tint)] * len(f))
            elif g.uv:
                uvs.append(list(g.uv[fi]))
            else:
                uvs.append([(0.0, 0.0)] * len(f))
        off += len(g.v)
    me = bpy.data.meshes.new(name)
    v = np.concatenate(verts) if verts else np.zeros((0, 3))
    me.from_pydata(v.tolist(), [], faces)
    me.polygons.foreach_set('material_index', mi)
    uvl = me.uv_layers.new(name='UVMap')
    flat = [c for face in uvs for uv in face for c in uv]
    uvl.data.foreach_set('uv', flat)
    attr = me.attributes.new('w', 'FLOAT', 'FACE')
    attr.data.foreach_set('value', wts)
    attr = me.attributes.new('part', 'INT', 'FACE')
    attr.data.foreach_set('value', pid)
    me.validate(clean_customdata=False)
    if tri:
        # the lean meshes are triangulated before they are unwrapped and baked, so the tangent
        # frame the normal map is baked in is exactly the one exported
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='BEAUTY')
        bm.to_mesh(me)
        bm.free()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(smooth))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob, mats


def make_prop(name):
    """Build both twins of a prop; returns dict(hp, lp, own, offset). Everything is re-centred on
    the lean mesh's footprint: x, y centred, z = 0 at its lowest point."""
    lo = office.build(name, False)
    hi = office.build(name, True)
    v = np.concatenate([g.v for g, *_ in lo.parts])
    lo_min, lo_max = v.min(0), v.max(0)
    off = np.array([-(lo_min[0] + lo_max[0]) / 2, -(lo_min[1] + lo_max[1]) / 2, -lo_min[2]])
    for b in (lo, hi):
        for g, *_ in b.parts:
            g.v = g.v + off
    hp_items = []
    for g, m, w, tint in hi.parts:
        if m == 'led':
            m = 'led_' + (tint or 'green')
        hp_items.append((g, m, w, None))
    hp, hp_mats = _mesh(f'{name}.hp', hp_items, smooth=40)
    for m in hp_mats:
        hp.data.materials.append(M.get(m))
    atlas = [p for p in lo.parts if p[1] not in office.OWN]
    own = [p for p in lo.parts if p[1] in office.OWN]
    lp, _ = _mesh(f'{name}.lp', atlas, smooth=35, tri=True)
    culled = cull_hidden(lp, floor=office.SURROUND.get(name, ('floor',))[:1] == ('floor',))
    # a twin of the lean mesh with every part scaled by its atlas weight about its own centre:
    # unwrapping that gives each part UV area in proportion to weight^2 x real area
    px = lp.copy()
    px.data = lp.data.copy()
    px.name = f'{name}.uvproxy'
    bpy.context.scene.collection.objects.link(px)
    _weight_scale(px.data, [(g.v.mean(0), w) for g, m, w, tint in atlas])
    ow = None
    if own:
        ow, own_mats = _mesh(f'{name}.own', own, smooth=35, tri=True)
        for m in own_mats:
            ow.data.materials.append(export_material(m))
    print(f'  {name}: culled {culled} hidden lean faces', flush=True)
    return dict(name=name, hp=hp, lp=lp, proxy=px, own=ow, lo_tris=lo.tris(), hi_tris=hi.tris(),
                emissive=sorted({p[1] for p in own if p[1] in ('screen', 'bulb', 'panel', 'led')}),
                canvas=sorted({p[1] for p in own if p[1] in M.CANVAS}))


def _weight_scale(me, parts):
    """Scale each part's vertices by its weight about its centre (parts never share vertices)."""
    n = len(me.vertices)
    co = np.empty(n * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(n, 3)
    pid = np.empty(len(me.polygons), dtype=np.int32)
    me.attributes['part'].data.foreach_get('value', pid)
    vpart = np.full(n, -1, dtype=np.int32)
    for poly, p in zip(me.polygons, pid):
        vpart[list(poly.vertices)] = p
    cs = np.array([c for c, w in parts])
    ws = np.array([w for c, w in parts])
    ok = vpart >= 0
    c = cs[vpart[ok]]
    co[ok] = (co[ok] - c) * ws[vpart[ok], None] + c
    me.vertices.foreach_set('co', co.ravel())
    me.update()


def cull_hidden(ob, floor=True):
    """Delete lean faces nobody can see: faces buried inside another closed part (the back of a
    drawer front inside the carcass, a leg's top under the desk), faces pressed against another
    surface, and on floor-standing props the faces flat on the floor. A face goes only when its
    centre and three points toward its corners are all hidden."""
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm)
    play = bm.faces.layers.int.get('part')
    # which parts are closed shells: only a closed part can bury a face inside it (an open sheet
    # such as a leaf just above another must not count)
    open_parts = set()
    for e in bm.edges:
        if len(e.link_faces) != 2:
            for f in e.link_faces:
                open_parts.add(f[play])
    dead = []
    for f in bm.faces:
        n = f.normal
        if n.length < 0.5:
            continue
        c = f.calc_center_median()
        if floor and n.z < -0.98 and all(v.co.z < 0.002 for v in f.verts):
            dead.append(f)
            continue
        pts = [c] + [c.lerp(v.co, 0.8) for v in f.verts]
        hidden = True
        for p in pts:
            o = p + n * 2e-4
            loc, hn, idx, dist = tree.ray_cast(o, n, 3.0)
            if loc is None:
                hidden = False
                break
            if dist < 0.0025:
                continue          # pressed against something
            if hn.dot(n) > 0.0 and bm.faces[idx][play] not in open_parts:
                continue          # inside a closed part: the first wall it meets faces away
            hidden = False
            break
        if hidden:
            dead.append(f)
    k = len(dead)
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return k


_export_mats = {}


def export_material(name):
    """The shipped materials: `office` (the atlas; textures are attached after export) and the
    lean mesh's own ones."""
    m = _export_mats.get(name)
    if m:
        return m
    if name == 'office':
        m = M.plain('office', '#ffffff', 1.0, metal=1.0)
    elif name == 'led':
        m = M.plain('led', '#ffffff', 0.35, glow=(1.0, 1.0, 1.0))
    elif name in M.EMISSIVE:
        s = M.EMISSIVE[name]
        m = M.plain(name, s['c'], s['r'], glow=s['glow'])
    else:
        s = M.CANVAS[name]
        m = M.plain(name, s['c'], s['r'])
    _export_mats[name] = m
    return m


# -- UVs ---------------------------------------------------------------------------------------

def _select_only(objs, active=None):
    bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode != 'OBJECT' else None
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def unwrap(props):
    """Smart-project every prop's weighted proxy, equalise texel density across all of them, pack
    them into one atlas, then copy the UVs onto the real lean meshes."""
    prox = [p['proxy'] for p in props]
    for ob in prox:
        _select_only([ob])
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    _select_only(prox)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    print('  unwrapped', flush=True)
    bpy.ops.uv.average_islands_scale()
    t = time.time()
    bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, rotate_method='CARDINAL', scale=True,
                            merge_overlap=False, margin_method='FRACTION', margin=0.0022, shape_method='AABB')
    bpy.ops.object.mode_set(mode='OBJECT')
    print(f'  packed in {time.time() - t:.0f}s')
    for p in props:
        src = p['proxy'].data.uv_layers['UVMap'].data
        uv = np.empty(len(src) * 2, dtype=np.float32)
        src.foreach_get('uv', uv)
        uv *= AREA
        p['lp'].data.uv_layers['UVMap'].data.foreach_set('uv', uv)
        bpy.data.objects.remove(p['proxy'])
        del p['proxy']


# -- baking -----------------------------------------------------------------------------------

def _image(name):
    img = bpy.data.images.new(name, ATLAS, ATLAS, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    img.generated_color = (0, 0, 0, 1)
    return img


def _target(name, img):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = img
    nt.nodes.active = n
    nt.nodes.new('ShaderNodeOutputMaterial')
    return mat


def _surround_planes(kinds, hp):
    lo, hi = _bounds(hp)
    out = []
    white = bpy.data.materials.get('bake.white') or M.plain('bake.white', '#e6e6e6', 0.9)
    for k in kinds:
        bm = bmesh.new()
        s = 20.0
        if k == 'floor':
            co = [(-s, -s, -0.0005), (s, -s, -0.0005), (s, s, -0.0005), (-s, s, -0.0005)]
        elif k == 'ceiling':
            z = hi[2] + 0.002
            co = [(-s, -s, z), (-s, s, z), (s, s, z), (s, -s, z)]
        else:  # the wall behind (+Y)
            y = hi[1] + 0.002
            co = [(-s, y, -1), (s, y, -1), (s, y, s), (-s, y, s)]
        bm.faces.new([bm.verts.new(c) for c in co])
        me = bpy.data.meshes.new(f'surround.{k}')
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(f'surround.{k}', me)
        bpy.context.scene.collection.objects.link(ob)
        me.materials.append(white)
        out.append(ob)
    return out


def _bounds(ob):
    v = np.array([ob.matrix_world @ Vector(c) for c in ob.bound_box])
    return v.min(0), v.max(0)


class Baker:
    def __init__(self):
        sc = bpy.context.scene
        sc.render.engine = 'CYCLES'
        sc.cycles.device = 'CPU'
        sc.cycles.use_denoising = False
        sc.cycles.max_bounces = 6
        sc.cycles.diffuse_bounces = 4
        sc.render.bake.use_clear = False
        sc.render.bake.margin = 0
        self.images = {k: _image(f'atlas.{k}') for k in SAMPLES}
        self.targets = {k: _target(f'target.{k}', im) for k, im in self.images.items()}
        world = bpy.data.worlds.new('bake.sky')
        world.use_nodes = True
        world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
        world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
        sc.world = world

    def bake(self, p, others):
        t0 = time.time()
        hp, lp = p['hp'], p['lp']
        for o in others:
            o.hide_render = True
        hp.hide_render = False
        lp.hide_render = False
        if p['own']:
            p['own'].hide_render = True
        # the lean mesh must not shadow or occlude its own high-poly twin
        for attr in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_shadow',
                     'visible_volume_scatter'):
            setattr(lp, attr, False)
        planes = _surround_planes(office.SURROUND.get(p['name'], ('floor',)), hp)
        lp.data.materials.clear()
        lp.data.materials.append(None)
        for kind, btype, mode in (('mask', 'EMIT', 'EM_W'), ('normal', 'NORMAL', 'GI'), ('color', 'EMIT', 'EM_C'),
                                  ('orm', 'EMIT', 'EM_ORM'), ('gi', 'DIFFUSE', 'GI')):
            for slot in hp.material_slots:
                M.mode(slot.material, mode)
            lp.data.materials[0] = self.targets[kind]
            _select_only([hp, lp], lp)
            bpy.context.scene.cycles.samples = SAMPLES[kind]
            kw = dict(type=btype, use_selected_to_active=True, cage_extrusion=CAGE, max_ray_distance=REACH,
                      margin=0, use_clear=False, target='IMAGE_TEXTURES')
            if btype == 'NORMAL':
                kw['normal_space'] = 'TANGENT'
            if btype == 'DIFFUSE':
                kw['pass_filter'] = {'DIRECT', 'INDIRECT'}
            tb = time.time()
            bpy.ops.object.bake(**kw)
            print(f'    {kind} {time.time() - tb:.1f}s', flush=True)
        for slot in hp.material_slots:
            M.mode(slot.material, 'BSDF')
        for o in planes:
            bpy.data.objects.remove(o)
        for attr in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_shadow',
                     'visible_volume_scatter'):
            setattr(lp, attr, True)
        for o in others:
            o.hide_render = False
        return time.time() - t0

    def read(self, kind):
        img = self.images[kind]
        buf = np.empty(ATLAS * ATLAS * 4, dtype=np.float32)
        img.pixels.foreach_get(buf)
        return np.flipud(buf.reshape(ATLAS, ATLAS, 4)[..., :3]).copy()


def push_pull(img, mask):
    """Fill the texels outside `mask` from the covered ones (coarse-to-fine), so mip levels and
    bilinear taps at island edges never pull in a background colour."""
    levels = []
    cur, w = img * mask[..., None], mask.astype(np.float32)
    while cur.shape[0] > 1:
        levels.append((cur, w))
        h = cur.shape[0] // 2
        cur = cur.reshape(h, 2, h, 2, -1).sum((1, 3))
        w = w.reshape(h, 2, h, 2).sum((1, 3))
    filled = cur / np.maximum(w, 1e-8)[..., None]
    for cur, w in reversed(levels):
        up = np.repeat(np.repeat(filled, 2, 0), 2, 1)
        own = cur / np.maximum(w, 1e-8)[..., None]
        filled = np.where((w > 0)[..., None], own, up)
    return filled


def _masked_blur(a, mask, passes=2):
    """A small normalised box blur that only mixes covered texels: takes the sampling noise out of
    the occlusion pass without bleeding across island borders into the background."""
    m = mask.astype(np.float32)[..., None]
    v, w = a * m, m.copy()
    for _ in range(passes):
        for ax in (0, 1):
            v = (np.roll(v, 1, ax) + v + np.roll(v, -1, ax))
            w = (np.roll(w, 1, ax) + w + np.roll(w, -1, ax))
    return np.where(m > 0, v / np.maximum(w, 1e-6), a)


def _to_srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(np.maximum(a, 1e-8), 1 / 2.4) - 0.055)


def assemble(baker, debug=None):
    mask = baker.read('mask')[..., 0] > 0.5
    gi = _masked_blur(np.clip(baker.read('gi')[..., :1], 0, 1), mask)
    color = np.clip(baker.read('color'), 0, 1)
    orm = np.clip(baker.read('orm'), 0, 1)
    normal = np.clip(baker.read('normal'), 0, 1)
    # bounce-aware occlusion: all of it to ORM.R (three applies it to ambient light only) and a
    # little into the albedo, for the contact shadows direct light would otherwise lose
    color = color * (0.72 + 0.28 * gi)
    orm[..., 0:1] = gi
    color, orm, normal = (push_pull(a, mask) for a in (color, orm, normal))
    nrm = normal * 2 - 1
    nrm /= np.maximum(np.linalg.norm(nrm, axis=-1, keepdims=True), 1e-6)
    normal = nrm * 0.5 + 0.5
    # LED palette cells in the strip at the right (rows from the top)
    x0 = int(math.ceil(AREA * ATLAS)) + 2
    for k, tint in enumerate(M.LED_TINTS):
        r0, r1 = int(k * CELL * ATLAS) + 2, int((k + 1) * CELL * ATLAS) - 2
        c = M.lin(M.SPECS['led_' + tint]['glow'])[:3]
        color[r0:r1, x0:] = c
        orm[r0:r1, x0:] = (1.0, 0.3, 0.0)
        normal[r0:r1, x0:] = (0.5, 0.5, 1.0)
    to8 = lambda a: np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)  # noqa: E731
    out = dict(color=to8(_to_srgb(color)), orm=to8(orm), normal=to8(normal))
    if debug:
        from PIL import Image
        os.makedirs(debug, exist_ok=True)
        for k, a in out.items():
            Image.fromarray(a).save(os.path.join(debug, f'atlas-{k}.png'))
        Image.fromarray(to8(mask.astype(np.float32))).save(os.path.join(debug, 'atlas-mask.png'))
    return out


# -- export ---------------------------------------------------------------------------------------

def finalize(p):
    """Join the lean mesh and its own (emissive / canvas) faces into the shipped object."""
    lp = p['lp']
    lp.data.materials.clear()
    lp.data.materials.append(export_material('office'))
    for poly in lp.data.polygons:
        poly.material_index = 0
    objs = [lp] + ([p['own']] if p['own'] else [])
    _select_only(objs, lp)
    if len(objs) > 1:
        bpy.ops.object.join()
    lp.name = p['name']
    lp.data.name = p['name']
    if 'w' in lp.data.attributes:
        lp.data.attributes.remove(lp.data.attributes['w'])
    p['lp'] = lp
    p['own'] = None
    lo, hi = _bounds(lp)
    p['size'] = [round(float(hi[0] - lo[0]), 3), round(float(hi[2] - lo[2]), 3), round(float(hi[1] - lo[1]), 3)]
    p['tris'] = sum(len(poly.vertices) - 2 for poly in lp.data.polygons)
    return lp


def export_glb(objs, path):
    _select_only(objs)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=False,
                              export_yup=True, export_texcoords=True, export_normals=True, export_tangents=True,
                              export_materials='EXPORT', export_image_format='NONE', export_cameras=False,
                              export_lights=False, export_extras=False, export_attributes=False)


# -- comparison renders --------------------------------------------------------------------------

# where each prop stands in the comparison set (x, y, z, rotation about Z in degrees)
LAYOUT = {
    'rack_42u': (-3.2, 1.2, 0.0, 0),
    'it_bench': (-1.3, 1.6, 0.0, 0),
    'whiteboard': (0.8, 2.05, 0.75, 0),
    'filing_cabinet': (2.0, 1.75, 0.0, 0),
    'coffee_station': (3.4, 1.7, 0.0, 0),
    'printer': (4.6, 1.6, 0.0, -20),
    'desk_pod': (0.4, 0.0, 0.0, 0),
    'chair_office': (0.35, -0.75, 0.0, 200),
    'desk_lamp': (-0.85, -1.0, 0.0, 30),
    'monitor_24': (-1.6, -0.9, 0.0, 15),
    'plant_pot': (2.0, 0.1, 0.0, 0),
    'ceiling_light_panel': (1.4, -1.2, 0.0, 0),
    'cable_tray': (-0.9, -1.9, 0.0, 10),
}

VIEWS = {
    'overview': dict(loc=(0.6, -7.8, 4.4), target=(0.5, 0.4, 0.6), lens=30),
    'desk': dict(loc=(1.5, -2.2, 1.55), target=(0.35, -0.1, 0.85), lens=40),
    'rack': dict(loc=(-2.3, -1.1, 1.5), target=(-3.15, 0.75, 1.05), lens=32),
    'bench': dict(loc=(-0.6, -0.55, 1.6), target=(-1.35, 1.55, 1.0), lens=32),
    'back': dict(loc=(3.4, -1.4, 1.5), target=(3.2, 1.6, 0.7), lens=30),
    'small': dict(loc=(-0.7, -2.9, 1.0), target=(-0.95, -1.2, 0.25), lens=40),
}


def setup_render_scene(res=(1200, 675), samples=48):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except TypeError:
        pass
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'None'
    world = bpy.data.worlds.new('office.night')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.012, 0.016, 0.028, 1)
    bg.inputs['Strength'].default_value = 1.0
    sc.world = world
    objs = []
    # floor (carpet tiles) and a back wall
    for name, co, col in (('floor', [(-12, -12, 0), (12, -12, 0), (12, 12, 0), (-12, 12, 0)], '#3b3f45'),
                          ('wall', [(-12, 2.12, 0), (12, 2.12, 0), (12, 2.12, 4), (-12, 2.12, 4)], '#8d8f8c')):
        bm = bmesh.new()
        f = bm.faces.new([bm.verts.new(c) for c in co])
        if name == 'wall':
            f.normal_flip()
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new('render.' + name, me)
        sc.collection.objects.link(ob)
        me.materials.append(M.plain('render.' + name, col, 0.85))
        objs.append(ob)
    # overhead LED panels (4000 K) and a warm desk-lamp pool
    for i, (x, y) in enumerate(((-2.4, 0.6), (0.0, 0.6), (2.4, 0.6), (-1.2, -1.6), (1.2, -1.6), (3.6, -1.0), (-3.6, -1.0))):
        L = bpy.data.lights.new(f'panel{i}', 'AREA')
        L.shape = 'SQUARE'
        L.size = 0.6
        L.energy = 160
        L.color = (1.0, 0.94, 0.86)
        ob = bpy.data.objects.new(f'render.panel{i}', L)
        ob.location = (x, y, 2.8)
        sc.collection.objects.link(ob)
        objs.append(ob)
    L = bpy.data.lights.new('fill', 'AREA')
    L.size = 4
    L.energy = 120
    L.color = (0.7, 0.8, 1.0)
    ob = bpy.data.objects.new('render.fill', L)
    ob.location = (0.5, -6, 3)
    ob.rotation_euler = (math.radians(60), 0, 0)
    sc.collection.objects.link(ob)
    objs.append(ob)
    cam = bpy.data.cameras.new('cam')
    co = bpy.data.objects.new('render.cam', cam)
    sc.collection.objects.link(co)
    sc.camera = co
    objs.append(co)
    return co


def place(ob, name):
    x, y, z, rz = LAYOUT[name]
    ob.location = (x, y, z)
    ob.rotation_mode = 'XYZ'      # the glTF importer leaves objects in quaternion mode
    ob.rotation_euler = (0, 0, math.radians(rz))


def aim(cam, view):
    v = VIEWS[view]
    cam.location = v['loc']
    d = Vector(v['target']) - Vector(v['loc'])
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = v['lens']


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
