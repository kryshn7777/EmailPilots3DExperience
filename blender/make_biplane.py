"""Builds the vintage banner-tow biplane of the storm chapter.

    python blender/make_biplane.py && npm run compress:models

Writes public/models/biplane/biplane.glb (meshes `fabric`, `paint`, `metal`, `leather`, `glass`,
`lamp`, `prop` and `spinner`, vertex coloured, in site units, plus Empties for the navigation
lights, the exhaust, the prop hub and the tow hook) and fabric-normal.webp, the tiling normal map
of the doped fabric: a rib tape with its stitching across each tile and the weave of the cloth.
One tile is one rib bay of the wings (the stringer spacing on the fuselage), see bld/biplane.py.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from bld import biplane  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'biplane')


def fabric_normal():
    """Rib tape (a raised band at u = 0 with pinked stitching) and a plain weave. Tangent space."""
    n = 256
    u = np.linspace(0, 1, n, endpoint=False)[None, :].repeat(n, axis=0)
    v = np.linspace(0, 1, n, endpoint=False)[:, None].repeat(n, axis=1)
    d = np.minimum(u, 1 - u)                                  # distance to the rib line
    tape = np.clip(1 - (d / 0.045) ** 2, 0, 1) ** 0.6 * 0.9
    stitch = np.exp(-((d - 0.03) / 0.008) ** 2) * (0.5 + 0.5 * np.cos(v * math.tau * 24)) * 0.35
    weave = 0.07 * np.sin(u * math.tau * 48) * np.sin(v * math.tau * 48)
    h = tape + stitch + weave                                 # (the sag between ribs is in the geometry)
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nrm = np.stack([-dx * 9, dy * 9, np.ones_like(h)], axis=-1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    path = os.path.join(OUT, 'fabric-normal.webp')
    Image.fromarray(((nrm * 0.5 + 0.5) * 255).astype(np.uint8)).save(path, 'WEBP', lossless=True, method=6)
    return os.path.getsize(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs, marks = biplane.build(bpy.context.scene.collection)
    for o in objs.values():
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.context.scene.collection.objects:
        obj.select_set(True)
    path = os.path.join(OUT, 'biplane.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False,
        export_materials='NONE', export_texcoords=True, export_normals=True, export_yup=True,
        export_cameras=False, export_lights=False, export_vertex_color='ACTIVE',
    )
    tris = {k: sum(len(p.vertices) - 2 for p in o.data.polygons) for k, o in objs.items()}
    print(f'{sum(tris.values())} tris:', ', '.join(f'{k} {v}' for k, v in tris.items()))
    print('marks', marks)
    print(f'glb {os.path.getsize(path) // 1024} KB, normal {fabric_normal() // 1024} KB')


if __name__ == '__main__':
    main()
