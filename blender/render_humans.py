"""Cycles evidence for make_humans.py: per person the MakeHuman source (its own textures and the
procedural layer), the shipped hero mesh and the shipped lean mesh, both with the baked maps only,
under the same light; and a contact sheet of every person.

    python blender/render_humans.py DIR [--only ethan,mei] [--samples 48]

Reads the work files make_humans.py leaves in blender/cache/humans-work (one .blend and .npz a person).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

from bld import humans as H  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.environ.get('HUMANS_WORK', os.path.join(ROOT, 'blender', 'cache', 'humans-work'))


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def baked_material(name, d, shrink=1):
    """Principled from the baked tile (albedo before normalisation, alpha, roughness, ao, normal)."""
    def image(key, arr, nc):
        a = arr
        if shrink > 1:
            a = a[::shrink, ::shrink]
        s = a.shape[0]
        rgba = np.ones((s, s, 4), np.float32)
        if a.shape[2] == 1:
            rgba[..., :3] = a
        else:
            rgba[..., :3] = a[..., :3]
        img = bpy.data.images.new(f'{name}-{key}', s, s, float_buffer=True)
        if nc:
            img.colorspace_settings.name = 'Non-Color'
        img.pixels.foreach_set(rgba.ravel())
        return img
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    b = N['Principled BSDF']
    uv = N.new('ShaderNodeUVMap'); uv.uv_map = 'atlas'
    def tex(key, nc):
        t = N.new('ShaderNodeTexImage'); t.image = image(key, d[key], nc)
        L.new(uv.outputs[0], t.inputs[0])
        return t
    alb = tex('albedo', False)
    ao = tex('ao', True)
    mul = N.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1.0
    L.new(alb.outputs['Color'], mul.inputs['A']); L.new(ao.outputs['Color'], mul.inputs['B'])
    L.new(mul.outputs['Result'], b.inputs['Base Color'])
    L.new(tex('rough', True).outputs['Color'], b.inputs['Roughness'])
    L.new(tex('alpha', True).outputs['Color'], b.inputs['Alpha'])
    nm = N.new('ShaderNodeNormalMap'); nm.uv_map = 'atlas'
    L.new(tex('normal', True).outputs['Color'], nm.inputs['Color'])
    L.new(nm.outputs['Normal'], b.inputs['Normal'])
    return m


def setup(scene, samples):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    w = bpy.data.worlds.new('w'); w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.42, 0.45, 0.52, 1); bg.inputs['Strength'].default_value = 0.6
    scene.world = w
    key = bpy.data.objects.new('key', bpy.data.lights.new('key', 'AREA'))
    key.data.energy = 260; key.data.size = 1.5; key.location = (2.2, -1.6, 2.6)
    key.rotation_euler = (Vector((0, 0, 1.2)) - key.location).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(key)
    rim = bpy.data.objects.new('rim', bpy.data.lights.new('rim', 'AREA'))
    rim.data.energy = 120; rim.data.size = 1.0; rim.data.color = (1.0, 0.85, 0.65); rim.location = (-2.0, 1.8, 2.2)
    rim.rotation_euler = (Vector((0, 0, 1.4)) - rim.location).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(rim)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def look(cam, loc, at, lens):
    cam.location = loc
    cam.data.lens = lens
    cam.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()


def compare(pid, out_dir, samples):
    bpy.ops.wm.open_mainfile(filepath=os.path.join(WORK, pid + '.blend'))
    sc = bpy.context.scene
    d = dict(np.load(os.path.join(WORK, pid + '.npz')))
    src, hero, lean = bpy.data.objects[pid + '-src'], bpy.data.objects[pid + '-hero'], bpy.data.objects[pid]
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = True
    hm = baked_material(pid + '-baked', d)
    lm = baked_material(pid + '-baked-low', d, shrink=4)
    for o, m in ((hero, hm), (lean, lm)):
        o.data.materials.clear(); o.data.materials.append(m)
    for o, y in ((src, -0.75), (hero, 0.0), (lean, 0.75)):
        o.hide_render = False
        o.location = (0, y, 0)
    cam = setup(sc, samples)
    sc.render.film_transparent = False
    sc.render.resolution_x, sc.render.resolution_y = 1500, 1000
    look(cam, (5.5, 0, 1.05), (0, 0, 0.92), 50)
    sc.render.filepath = os.path.join(out_dir, f'{pid}-cmp-body.png')
    bpy.ops.render.render(write_still=True)
    top = max(v.co.z for v in hero.data.vertices)
    sc.render.resolution_x, sc.render.resolution_y = 1500, 560
    look(cam, (3.2, -0.25, top - 0.12), (0, 0, top - 0.14), 135)
    sc.render.filepath = os.path.join(out_dir, f'{pid}-cmp-face.png')
    bpy.ops.render.render(write_still=True)


def sheet(ids, out_dir, samples):
    """Every person's hero mesh with the baked maps, front three-quarter, from the hero camera distance."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    objs = []
    for i, pid in enumerate(ids):
        with bpy.data.libraries.load(os.path.join(WORK, pid + '.blend')) as (src, dst):
            dst.objects = [pid + '-hero']
        o = dst.objects[0]
        sc.collection.objects.link(o)
        d = dict(np.load(os.path.join(WORK, pid + '.npz')))
        m = baked_material(pid + '-sheet', d)
        o.data.materials.clear(); o.data.materials.append(m)
        o.location = (0, (i - (len(ids) - 1) / 2) * 0.72, 0)
        o.rotation_euler.z = math.radians(-20)
        objs.append(o)
    cam = setup(sc, samples)
    sc.render.resolution_x, sc.render.resolution_y = 2400, 760
    look(cam, (9.0, 0, 1.15), (0, 0, 0.95), 40)
    sc.render.filepath = os.path.join(out_dir, 'sheet-hero.png')
    bpy.ops.render.render(write_still=True)
    # the faces: each head on its own, three-quarter front, then side by side
    from PIL import Image
    sc.render.resolution_x, sc.render.resolution_y = 420, 520
    tiles = []
    for o in objs:
        for p in objs:
            p.hide_render = p is not o
        top = max((o.matrix_world @ v.co).z for v in o.data.vertices)
        c = o.matrix_world.translation
        at = (c.x, c.y, top - 0.13)
        look(cam, (c.x + 2.6, c.y - 0.9, top - 0.1), at, 150)
        path = os.path.join(out_dir, f'face-{o.name}.png')
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        tiles.append(Image.open(path))
    sheet_img = Image.new('RGB', (420 * len(tiles), 520))
    for i, t in enumerate(tiles):
        sheet_img.paste(t.convert('RGB'), (420 * i, 0))
    sheet_img.save(os.path.join(out_dir, 'sheet-faces.png'))


def main():
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    samples = int(arg('--samples', 48))
    ids = [p['id'] for p in H.PEOPLE]
    if arg('--only'):
        ids = [i for i in ids if i in arg('--only').split(',')]
    ids = [i for i in ids if os.path.exists(os.path.join(WORK, i + '.blend'))]
    if '--no-compare' not in sys.argv:
        for pid in ids:
            compare(pid, out_dir, samples)
    if '--no-sheet' not in sys.argv:
        sheet(ids, out_dir, samples)


main()
