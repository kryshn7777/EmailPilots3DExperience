"""Builds the pedestrians (and a dog) for the town and the night city.

    python blender/make_people.py [--render /tmp/people]

Writes public/models/people/people.glb (one mesh per variant, named after it; float positions,
byte normals and the rig packed in one 4-byte `_RIG` attribute, see `pack_glb`) and a
manifest.json the runtime (src/webgl/actors/Pedestrians.ts) builds from:

    variants[]   id, kind (person / dog), build, triangle count, height, the options the mesh
                 carries, and its rig in glTF frame and site units: `pivots` (one per bone, see
                 B_* in bld/people.py), `legs` (thigh and shin length), `foot` (heel and toe
                 from the ankle, x forward / y up, for the ground contact), `hand` (the right
                 palm, where a leash is held; the dog's is its collar)
    options[]    the option names, in bit order (bit k-1 of an instance's mask is option k)
    regions[]    the colour regions, in the order `_rig.y` counts them

The figures are modelled in metres and exported at SCALE, the same site scale as the houses
and the cars. `--render DIR` also writes a turntable-ish contact sheet of every variant with
every option on (Cycles, CPU) to check the shapes without the site.
"""
import json
import math
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from bld import people  # noqa: E402
from bld.homes import SCALE  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'people')
REGIONS = ['skin', 'hair', 'top', 'bottom', 'shoes', 'accessory', 'under', 'dark', 'light']


def gl(v, k=SCALE):
    """Blender (x forward, y left, z up) metres -> glTF (x, y up, z = -y) site units"""
    return [round(v.x * k, 5), round(v.z * k, 5), round(-v.y * k, 5)]


def to_object(name, fig):
    """The figure's bmesh as an object, its layers turned into the two exported corner attributes."""
    ao = people.bake_occlusion(fig)
    bm = fig.bm
    bm.verts.index_update()
    bm.faces.index_update()
    mesh = bpy.data.meshes.new(f'person-{name}')
    bm.to_mesh(mesh)
    nv = len(mesh.vertices)
    bone = np.zeros(nv, np.int32)
    mesh.attributes['bone'].data.foreach_get('value', bone)
    w = np.zeros(nv, np.float32)
    mesh.attributes['w'].data.foreach_get('value', w)
    opt = np.zeros(nv, np.int32)
    mesh.attributes['opt'].data.foreach_get('value', opt)
    reg = np.zeros(len(mesh.polygons), np.int32)
    mesh.attributes['reg'].data.foreach_get('value', reg)
    nl = len(mesh.loops)
    lv = np.zeros(nl, np.int32)
    mesh.loops.foreach_get('vertex_index', lv)
    lf = np.zeros(nl, np.int32)
    starts = np.zeros(len(mesh.polygons), np.int32)
    counts = np.zeros(len(mesh.polygons), np.int32)
    mesh.polygons.foreach_get('loop_start', starts)
    mesh.polygons.foreach_get('loop_total', counts)
    for i, (s, c) in enumerate(zip(starts, counts)):
        lf[s:s + c] = i
    ao = np.asarray(ao, np.float32)
    rig = np.stack([bone[lv].astype(np.float32), reg[lf].astype(np.float32), w[lv]], axis=1)
    aux = np.stack([opt[lv].astype(np.float32), np.round(ao[lv], 3)], axis=1)
    a = mesh.attributes.new('_rig', 'FLOAT_VECTOR', 'CORNER')
    a.data.foreach_set('vector', rig.ravel())
    a = mesh.attributes.new('_aux', 'FLOAT2', 'CORNER')
    a.data.foreach_set('vector', aux.ravel())
    for n in ('bone', 'w', 'opt', 'reg'):
        mesh.attributes.remove(mesh.attributes[n])
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def pack_glb(path):
    """Rewrites the exported GLB with its vertices packed (44 bytes a vertex down to 20):

        POSITION  float x 3 (as exported)
        NORMAL    signed byte x 3, normalized, stride 4 (KHR_mesh_quantization)
        _RIG      unsigned byte x 4: (bone * 16 + region, option, weight * 255, occlusion * 255)

    The exporter writes the custom attributes as floats; they are all small integers or 0..1."""
    with open(path, 'rb') as f:
        data = f.read()
    jlen = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + jlen])
    blen = struct.unpack_from('<I', data, 20 + jlen)[0]
    bin0 = data[28 + jlen:28 + jlen + blen]
    comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
    types = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}

    def read(i):
        a = doc['accessors'][i]
        bv = doc['bufferViews'][a['bufferView']]
        n = comps[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        dt = np.dtype(types[a['componentType']])
        return np.frombuffer(bin0, dt, a['count'] * n, off).reshape(a['count'], n), a

    out = bytearray()
    views, accs = [], []

    def put(arr, target, stride=None):
        while len(out) % 4:
            out.append(0)
        views.append(dict(buffer=0, byteOffset=len(out), byteLength=arr.nbytes, target=target,
                          **({'byteStride': stride} if stride else {})))
        out.extend(arr.tobytes())
        return len(views) - 1

    def acc(view, ctype, count, typ, **kw):
        accs.append(dict(bufferView=view, componentType=ctype, count=count, type=typ, **kw))
        return len(accs) - 1

    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            at = prim['attributes']
            pos, pa = read(at['POSITION'])
            nrm, _ = read(at['NORMAL'])
            rig, _ = read(at['_RIG'])
            aux, _ = read(at['_AUX'])
            idx, ia = read(prim['indices'])
            n = len(pos)
            new = {}
            new['POSITION'] = acc(put(np.ascontiguousarray(pos, np.float32), 34962), 5126, n, 'VEC3',
                                  min=pa['min'], max=pa['max'])
            q = np.zeros((n, 4), np.int8)
            q[:, :3] = np.clip(np.round(nrm * 127), -127, 127)
            new['NORMAL'] = acc(put(q, 34962, 4), 5120, n, 'VEC3', normalized=True)
            r = np.zeros((n, 4), np.uint8)
            r[:, 0] = np.round(rig[:, 0]) * 16 + np.round(rig[:, 1])
            r[:, 1] = np.round(aux[:, 0])
            r[:, 2] = np.round(np.clip(rig[:, 2], 0, 1) * 255)
            r[:, 3] = np.round(np.clip(aux[:, 1], 0, 1) * 255)
            new['_RIG'] = acc(put(r, 34962), 5121, n, 'VEC4')
            small = idx.max() < 65536
            ind = np.ascontiguousarray(idx.ravel(), np.uint16 if small else np.uint32)
            prim['indices'] = acc(put(ind, 34963), 5123 if small else 5125, len(ind), 'SCALAR')
            prim['attributes'] = new
    doc['accessors'] = accs
    doc['bufferViews'] = views
    while len(out) % 4:
        out.append(0)
    doc['buffers'] = [dict(byteLength=len(out))]
    for key in ('extensionsUsed', 'extensionsRequired'):
        doc[key] = sorted(set(doc.get(key, [])) | {'KHR_mesh_quantization'})
    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(out), 0x004E4942))
        f.write(out)


def finish(obj):
    obj.scale = (SCALE,) * 3
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(48))
    me = obj.data
    opt = np.zeros(len(me.loops) * 2, np.float32)
    me.attributes['_aux'].data.foreach_get('vector', opt)
    opt = opt.reshape(-1, 2)[:, 0]
    full = sum(len(p.vertices) - 2 for p in me.polygons)
    base = sum(len(p.vertices) - 2 for p in me.polygons if opt[p.loop_start] < 0.5)
    return base, full


def _sheet_copy(obj, keep):
    """A copy of `obj` with every option not in `keep` (option numbers) deleted, coloured by region."""
    import bmesh
    palette = [(0.82, 0.6, 0.47), (0.12, 0.08, 0.05), (0.2, 0.4, 0.75), (0.25, 0.3, 0.4), (0.9, 0.9, 0.9),
               (0.75, 0.25, 0.2), (0.9, 0.9, 0.85), (0.03, 0.03, 0.03), (0.85, 0.85, 0.85)]
    me = obj.data.copy()
    opt = np.zeros(len(me.loops) * 2, np.float32)
    me.attributes['_aux'].data.foreach_get('vector', opt)
    opt = np.round(opt.reshape(-1, 2)[:, 0]).astype(int)
    dead = [i for i, p in enumerate(me.polygons)
            if any(k > 0 and k not in keep for k in opt[p.loop_start:p.loop_start + p.loop_total])]
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in dead], context='FACES')
    bm.to_mesh(me)
    bm.free()
    rig = np.zeros(len(me.loops) * 3, np.float32)
    me.attributes['_rig'].data.foreach_get('vector', rig)
    a2 = np.zeros(len(me.loops) * 2, np.float32)
    me.attributes['_aux'].data.foreach_get('vector', a2)
    col = np.array([palette[int(r)] + (1.0,) for r in rig.reshape(-1, 3)[:, 1]], np.float32)
    col[:, :3] *= a2.reshape(-1, 2)[:, 1][:, None]
    ca = me.color_attributes.new('region_col', 'FLOAT_COLOR', 'CORNER')
    ca.data.foreach_set('color', col.ravel())
    o = bpy.data.objects.new(obj.name + '-sheet', me)
    bpy.context.scene.collection.objects.link(o)
    return o


def render_sheet(objs, out_dir, dressed):
    """Every variant side by side (bare, then dressed with `dressed[id]`), front, back, side and a
    three-quarter view from above, flat-coloured by region and shaded by the baked occlusion."""
    from mathutils import Vector
    os.makedirs(out_dir, exist_ok=True)
    mat = bpy.data.materials.new('regions')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'region_col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.7
    for o in objs:
        o.hide_render = True
    row = []
    for o in objs:
        row.append(_sheet_copy(o, set()))
    for o in objs:
        row.append(_sheet_copy(o, {people.O[n] for n in dressed.get(o.name, [])}))
    for i, o in enumerate(row):
        o.data.materials.append(mat)
        o.location = (0, (i - (len(row) - 1) / 2) * 0.26, 0)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = 2400
    scene.render.resolution_y = 420
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.78, 0.82, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.7
    scene.world = world
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-40))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = len(row) * 0.26 + 0.05
    scene.collection.objects.link(cam)
    scene.camera = cam
    for view, (yaw, pitch, turn) in {'front': (0, 3, 0), 'back': (180, 3, 0), 'side': (0, 3, -90),
                                     'above': (0, 28, -35)}.items():
        for o in row:
            o.rotation_euler.z = math.radians(turn)
        a, e = math.radians(yaw), math.radians(pitch)
        d = 8
        cam.location = (d * math.cos(a) * math.cos(e), d * math.sin(a) * math.cos(e), 0.3 + d * math.sin(e))
        cam.rotation_euler = (Vector((0, 0, 0.3)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(out_dir, f'sheet-{view}.png')
        bpy.ops.render.render(write_still=True)


def main():
    render_dir = sys.argv[sys.argv.index('--render') + 1] if '--render' in sys.argv else None
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    manifest = dict(scale=SCALE, options=people.OPTIONS, regions=REGIONS, variants=[])
    objs = []
    entries = []
    for name in list(people.VARIANTS) + ['dog']:
        fig, v = (people.build(name) if name != 'dog' else (people.build_dog(), None))
        piv = [gl(fig.pivots.get(k, fig.pivots[people.B_ROOT])) for k in range(16)]
        obj = to_object(name, fig)
        objs.append(obj)
        entries.append(dict(
            id=name, kind='dog' if name == 'dog' else 'person', build=fig.build, mesh=name,
            height=round(fig.height * SCALE, 4),
            options=[] if v is None else v['options'],
            pivots=piv,
            legs=[round(fig.legs[0] * SCALE, 5), round(fig.legs[1] * SCALE, 5)],
            foot=[round(c * SCALE, 5) for c in fig.foot],
            hand=gl(fig.hand),
        ))
    for obj, e in zip(objs, entries):
        e['tris'], e['trisWithOptions'] = finish(obj)
        print(f"{e['id']:13s} {e['tris']:5d} tris ({e['trisWithOptions']:5d} with every option)  "
              f"{len(obj.data.vertices):5d} verts  h {e['height']:.3f}")
    manifest['variants'] = entries
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    path = os.path.join(OUT, 'people.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False,
        export_materials='NONE', export_normals=True, export_yup=True, export_attributes=True,
        export_texcoords=False, export_cameras=False, export_lights=False,
    )
    pack_glb(path)
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print(f'people.glb {os.path.getsize(path) // 1024} KB')
    if render_dir:
        render_sheet(objs, render_dir, dict(
            (k, v) for k, v in {
                'man-casual': ['cap', 'backpack'], 'man-jacket': ['bag', 'beard'], 'man-coat': ['beanie', 'scarf'],
                'woman-dress': ['ponytail', 'bag'], 'woman-casual': ['long', 'backpack'],
                'woman-coat': ['bun', 'scarf'], 'child': ['cap', 'backpack'], 'jogger': ['ponytail'],
            }.items()))


main()
