"""Builds the container ship of the beacon chapter.

    python blender/make_ship.py                # public/models/ship/ship.glb (high) and ship-lo.glb (phones)
    python blender/make_ship.py --render DIR   # ...and Cycles stills of the high model into DIR
    npm run compress:models                    # then meshopt-pack them

Each GLB has meshes `hull`, `deck`, `containers`, `upper`, `lit`, vertex coloured, plus Empties for the
navigation lights (`nav_*`), the deck floodlights (`flood_*`) and the radar scanners (`radar*`); the model is
in metres, bow toward +x, waterline at y = 0 (the GLTF exporter turns Blender's Z up into Y up).
container-normal.webp is the tiling corrugation the containers' side faces map onto.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from bld import ship  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'ship')


def corrugation():
    """A container side: vertical ribs (14 to the tile, which is one container width), a flat frame top and bottom."""
    n = 256
    xs = np.linspace(0, 1, n, endpoint=False)[None, :].repeat(n, axis=0)
    ys = np.linspace(0, 1, n, endpoint=False)[:, None].repeat(n, axis=1)
    ribs = 0.5 + 0.5 * np.sin(xs * math.tau * 14)
    frame = np.minimum(ys, 1 - ys)
    mask = np.clip((frame - 0.035) / 0.02, 0, 1)
    h = ribs * mask
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nrm = np.stack([-dx * 38, dy * 38, np.ones_like(h)], axis=-1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    path = os.path.join(OUT, 'container-normal.webp')
    Image.fromarray(((nrm * 0.5 + 0.5) * 255).astype(np.uint8)).save(path, 'WEBP', lossless=True, method=6)
    return os.path.getsize(path)


def export(detail, name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ship.FONT.clear()
    ship.build(bpy.context.scene.collection, detail)
    bpy.ops.object.select_all(action='DESELECT')
    tris = {}
    for obj in bpy.context.scene.collection.objects:
        obj.select_set(True)
        if obj.type == 'MESH':
            tris[obj.name] = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    path = os.path.join(OUT, name)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False,
        export_materials='NONE', export_texcoords=True, export_normals=True, export_yup=True,
        export_cameras=False, export_lights=False, export_vertex_color='ACTIVE',
    )
    print(f'{name}: {sum(tris.values())} tris:', ', '.join(f'{k} {v}' for k, v in tris.items()), f'glb {os.path.getsize(path) // 1024} KB')


def preview(render_dir):
    """Cycles stills of whatever is in the scene (call right after export('high'))."""
    from mathutils import Vector
    scene = bpy.context.scene
    coll = scene.collection

    def mat(name, rough, metal=0.0, emit=0.0):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes['Principled BSDF']
        a = nt.nodes.new('ShaderNodeVertexColor')
        a.layer_name = 'Col'
        nt.links.new(a.outputs['Color'], bsdf.inputs['Base Color'])
        if emit:
            nt.links.new(a.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emit
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        return m
    mats = {'hull': mat('hull', 0.55, 0.3), 'deck': mat('deck', 0.85), 'containers': mat('c', 0.62, 0.2),
            'upper': mat('u', 0.55, 0.15), 'lit': mat('l', 0.5, 0.0, 4.0)}
    for o in list(coll.objects):
        if o.type == 'MESH':
            o.data.materials.append(mats.get(o.name, mats['upper']))
    bpy.ops.mesh.primitive_plane_add(size=1200, location=(0, 0, 0.0))
    sea = bpy.context.active_object
    sm = bpy.data.materials.new('sea')
    sm.use_nodes = True
    sm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.01, 0.06, 0.08, 1)
    sm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.2
    sea.data.materials.append(sm)
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.0
    so = bpy.data.objects.new('sun', sun)
    so.rotation_euler = (math.radians(50), math.radians(-12), math.radians(-120))
    coll.objects.link(so)
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.42, 0.5, 0.62, 1)
    bg.inputs['Strength'].default_value = 0.9
    scene.world = world
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = int(os.environ.get('SAMPLES', '16'))
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1280, 560
    scene.view_settings.view_transform = 'AgX'
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    coll.objects.link(cam)
    scene.camera = cam
    views = {
        'side': ((0, -330, 22), (0, 0, 16), 28),
        'three_quarter': ((150, -200, 55), (0, 0, 14), 35),
        'stern': ((-170, -70, 40), (-60, 0, 18), 40),
        'bridge': ((-20, -105, 40), (-72, 0, 22), 45),
        'bow': ((190, -60, 24), (70, 0, 6), 40),
        'cargo': ((10, -70, 35), (10, 0, 14), 50),
    }
    pick = os.environ.get('VIEWS')
    for name, (eye, at, lens) in views.items():
        if pick and name not in pick.split(','):
            continue
        cam.location = eye
        cam.data.lens = lens
        cam.data.clip_end = 3000
        d = Vector(at) - Vector(eye)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(render_dir, f'{name}.png')
        bpy.ops.render.render(write_still=True)
        print('rendered', scene.render.filepath)


def main():
    os.makedirs(OUT, exist_ok=True)
    render_dir = None
    if '--render' in sys.argv:
        render_dir = sys.argv[sys.argv.index('--render') + 1]
        os.makedirs(render_dir, exist_ok=True)
    export('low', 'ship-lo.glb')
    export('high', 'ship.glb')
    print(f'normal {corrugation() // 1024} KB')
    if render_dir:
        preview(render_dir)


main()
