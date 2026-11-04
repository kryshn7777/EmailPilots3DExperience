"""The cars' optimisation pass: the tiers' resolutions and the maps baked for them.

`make_cars.py` builds every vehicle four times from the one description in `cars.py` (the body's
cross-section is an analytic function of x, so a finer skin is exact, never smoothed):

    high-poly   the bake source, never shipped: a cross-section every 1.5 cm, each of the 24 spans
                round it split in four along a Catmull-Rom curve, 64-segment wheels, every round
                part at 2.5x (63 to 78k triangles)
    hero        what ships for cars near the camera (HIGH only): a section every 4.5 cm, spans
                split in two, 32-segment wheels, round parts at 1.6x, a UV set on the body and
                the two maps below
    mid         the old close-up resolution, for cars a little further off (HIGH only), with
                its occlusion and grime baked per vertex
    lean        the old lofted shell (`cars.build`) for distance and phones, with the same
                occlusion and road grime baked into its vertex colours

The hero's two maps, 1024 px each:

    <type>-paint.webp     R  ambient occlusion: Cycles AO (0.5 m) with the whole car, its four
                             wheels and the road as occluders
                          G  road grime: heaviest low on the body (sills, lower doors, bumpers)
                             and in cavities, broken up by two octaves of noise
                          B  convex curvature (Cycles pointiness), for edge highlights
    <type>-paint-n.webp   tangent-space normals baked from the high-poly skin onto the hero's

`detail` and `wheel` keep their single vertex-coloured material (the colour's alpha is the
material class StreetCars.ts reads); their occlusion is baked per vertex and multiplied into
the colour, so the cabin seen through the glass, the inside of the wheel barrels, the grille
slats and the arch liners all darken where light cannot reach.
"""
import math

import bpy
import numpy as np
from mathutils import Matrix

TEX = 1024


# ---------------------------------------------------------------- geometry
def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def unwrap(obj):
    """One clean UV set (glTF TEXCOORD_0) over the body skin for its baked maps."""
    select_only([obj])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def wheel_copies(wheel, offsets):
    """The one wheel placed at its four stations (Blender frame), as bake occluders."""
    out = []
    for xw, zw, ygl in offsets:
        o = wheel.copy()
        o.data = wheel.data
        bpy.context.scene.collection.objects.link(o)
        y = -ygl
        o.matrix_world = Matrix.Translation((xw, y, zw)) @ (Matrix.Rotation(math.pi, 4, 'Z') if y < 0 else Matrix())
        out.append(o)
    return out


def ground():
    me = bpy.data.meshes.new('bake-ground')
    s = 12.0
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    o = bpy.data.objects.new('bake-ground', me)
    bpy.context.scene.collection.objects.link(o)
    return o


# ---------------------------------------------------------------- baking
def cycles(samples, ao_distance):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    if sc.world is None:
        sc.world = bpy.data.worlds.new('bake')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs[0].default_value = (1, 1, 1, 1)
        bg.inputs[1].default_value = 1.0
    sc.world.light_settings.distance = ao_distance


def _bake_material(obj, image=None, emit=None):
    """A plain material for the bake (one per object); `image` is the texture the bake writes into."""
    mat = bpy.data.materials.new(f'bake-{obj.name}')
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    if emit:
        sh = emit(nt)
        nt.links.new(sh.outputs[0], out.inputs['Surface'])
    else:
        sh = nt.nodes.new('ShaderNodeBsdfDiffuse')
        sh.inputs['Color'].default_value = (0.7, 0.7, 0.7, 1)
        nt.links.new(sh.outputs[0], out.inputs['Surface'])
    if image is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image
        nt.nodes.active = tex
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return mat


def _image(name, colour=True):
    img = bpy.data.images.new(name, TEX, TEX, alpha=False, float_buffer=True)
    if not colour:
        img.colorspace_settings.name = 'Non-Color'
    return img


def _pixels(img):
    a = np.empty(TEX * TEX * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(TEX, TEX, 4)


def ao_texture(target, occluders, samples=96):
    """Ambient occlusion of the body skin into its UV set (the occluders must already be in the scene)."""
    img = _image('bake-ao', colour=False)
    for o in occluders:
        _bake_material(o)
    _bake_material(target, img)
    select_only([target])
    bpy.context.scene.cycles.samples = samples
    bpy.ops.object.bake(type='AO', margin=8, margin_type='EXTEND', use_clear=True)
    return _pixels(img)[..., 0].copy()


def field_texture(target):
    """Emission bake of the fields the grime is computed from: height, two noise octaves, pointiness."""
    def emit(nt):
        tc = nt.nodes.new('ShaderNodeTexCoord')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(tc.outputs['Object'], sep.inputs[0])
        n1 = nt.nodes.new('ShaderNodeTexNoise')
        n1.inputs['Scale'].default_value = 2.2
        n1.inputs['Detail'].default_value = 6.0
        n2 = nt.nodes.new('ShaderNodeTexNoise')
        n2.inputs['Scale'].default_value = 26.0
        n2.inputs['Detail'].default_value = 4.0
        for n in (n1, n2):
            nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
        mix = nt.nodes.new('ShaderNodeMath')
        mix.operation = 'MULTIPLY'
        nt.links.new(n1.outputs['Fac'], mix.inputs[0])
        nt.links.new(n2.outputs['Fac'], mix.inputs[1])
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        zs = nt.nodes.new('ShaderNodeMath')
        zs.operation = 'MULTIPLY'
        zs.inputs[1].default_value = 0.5
        nt.links.new(sep.outputs['Z'], zs.inputs[0])
        comb = nt.nodes.new('ShaderNodeCombineXYZ')
        nt.links.new(zs.outputs[0], comb.inputs[0])
        nt.links.new(mix.outputs[0], comb.inputs[1])
        nt.links.new(geo.outputs['Pointiness'], comb.inputs[2])
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(comb.outputs[0], em.inputs['Color'])
        return em
    img = _image('bake-field', colour=False)
    _bake_material(target, img, emit=emit)
    select_only([target])
    bpy.context.scene.cycles.samples = 1
    bpy.ops.object.bake(type='EMIT', margin=8, margin_type='EXTEND', use_clear=True)
    return _pixels(img)[..., :3].copy()


def normal_texture(target, source):
    """Tangent-space normals of the high-poly skin, projected onto the hero skin's UV set."""
    img = _image('bake-normal', colour=False)
    _bake_material(source)
    _bake_material(target, img)
    select_only([source, target], active=target)
    bpy.context.scene.cycles.samples = 1
    bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_selected_to_active=True,
                        cage_extrusion=0.012, max_ray_distance=0.04, margin=8, margin_type='EXTEND', use_clear=True)
    return _pixels(img)[..., :3].copy()


def grime(ao, field):
    """Road film: low on the body and in what the light cannot reach, broken up by noise."""
    z = field[..., 0] * 2.0
    noise = field[..., 1]
    point = field[..., 2]
    low = np.clip(1.0 - (z - 0.16) / 0.50, 0.0, 1.0) ** 1.6
    cav = np.clip(1.0 - ao, 0.0, 1.0) ** 1.4
    concave = np.clip((0.5 - point) * 7.0, 0.0, 1.0)
    g = low * (0.35 + 2.2 * noise) + cav * (0.40 + 1.6 * noise) + concave * 0.25
    return np.clip(g, 0.0, 1.0)


def save_maps(path_paint, path_normal, ao, field, nrm, quality=88):
    from PIL import Image
    g = grime(ao, field)
    edge = np.clip((field[..., 2] - 0.5) * 7.0, 0.0, 1.0)
    packed = np.stack([np.clip(ao, 0, 1), g, edge], -1)
    # Blender's pixel rows run bottom-up; glTF's UVs (and the GLB's TEXCOORD_0) top-down
    Image.fromarray((packed[::-1] * 255 + 0.5).astype(np.uint8)).save(path_paint, 'WEBP', quality=quality, method=6)
    Image.fromarray((np.clip(nrm[::-1], 0, 1) * 255 + 0.5).astype(np.uint8)).save(path_normal, 'WEBP', quality=quality + 4, method=6)
    return dict(ao=float(ao.mean()), grime=float(g.mean()))


def vertex_ao(obj, occluders, samples=64, floor=0.22, power=1.0, grime_low=None):
    """Per-vertex occlusion multiplied into the object's colour (alpha, the material class, untouched).

    An object without colours (the lean paint) gets them: the occlusion, and a road-film tint low
    on the body (`grime_low`: the height in metres where it fades out)."""
    me = obj.data
    col = me.color_attributes.get('Col')
    ao = me.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER')
    me.color_attributes.active_color = ao
    for o in occluders:
        _bake_material(o)
    _bake_material(obj)
    select_only([obj])
    bpy.context.scene.cycles.samples = samples
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
    n = len(me.loops)
    a = np.empty(n * 4, dtype=np.float32)
    me.color_attributes['AO'].data.foreach_get('color', a)
    occ = a.reshape(n, 4)[:, 0]
    occ = floor + (1 - floor) * occ ** power
    if col is None:
        col = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
        base = np.ones((n, 4), dtype=np.float32)
        if grime_low:
            vz = np.empty(len(me.vertices) * 3, dtype=np.float32)
            me.vertices.foreach_get('co', vz)
            vi = np.empty(n, dtype=np.int32)
            me.loops.foreach_get('vertex_index', vi)
            z = vz.reshape(-1, 3)[vi, 2]
            low = np.clip(1.0 - (z - 0.16) / grime_low, 0, 1) ** 1.6 * 0.45
            dirt = np.array([0.50, 0.46, 0.40], dtype=np.float32)
            base[:, :3] = base[:, :3] * (1 - low[:, None]) + dirt * low[:, None]
    else:
        base = np.empty(n * 4, dtype=np.float32)
        col.data.foreach_get('color', base)
        base = base.reshape(n, 4)
    base[:, :3] *= occ[:, None]
    col.data.foreach_set('color', base.ravel())
    me.color_attributes.remove(me.color_attributes['AO'])
    me.color_attributes.active_color = me.color_attributes['Col']
    me.materials.clear()


def clear_materials(objs):
    for o in objs:
        if o.type == 'MESH':
            o.data.materials.clear()
