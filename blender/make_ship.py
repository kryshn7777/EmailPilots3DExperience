"""Builds the container freighter of the beacon chapter.

    python blender/make_ship.py

Writes public/models/ship/ship.glb (meshes `hull`, `deck`, `containers`, `upper`, `lit`, vertex
coloured, plus Empties for the navigation lights and the radar) and container-normal.webp, the
tiling corrugation the containers' side faces map onto.
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
    """A container side: vertical ribs, a flat frame around the edge. Tangent-space normal map."""
    n = 256
    xs = np.linspace(0, 1, n, endpoint=False)[None, :].repeat(n, axis=0)
    ys = np.linspace(0, 1, n, endpoint=False)[:, None].repeat(n, axis=1)
    ribs = 0.5 + 0.5 * np.sin(xs * math.tau * 14)
    frame = np.minimum.reduce([xs, 1 - xs, ys, 1 - ys])
    mask = np.clip((frame - 0.035) / 0.02, 0, 1)
    h = ribs * mask
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nrm = np.stack([-dx * 38, dy * 38, np.ones_like(h)], axis=-1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    path = os.path.join(OUT, 'container-normal.webp')
    Image.fromarray(((nrm * 0.5 + 0.5) * 255).astype(np.uint8)).save(path, 'WEBP', lossless=True, method=6)
    return os.path.getsize(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    parts = ship.build(bpy.context.scene.collection)
    bpy.ops.object.select_all(action='DESELECT')
    tris = {}
    for obj in bpy.context.scene.collection.objects:
        obj.select_set(True)
        if obj.type == 'MESH':
            tris[obj.name] = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    path = os.path.join(OUT, 'ship.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False,
        export_materials='NONE', export_texcoords=True, export_normals=True, export_yup=True,
        export_cameras=False, export_lights=False, export_vertex_color='ACTIVE',
    )
    print(f'{sum(tris.values())} tris:', ', '.join(f'{k} {v}' for k, v in tris.items()))
    print(f'glb {os.path.getsize(path) // 1024} KB, normal {corrugation() // 1024} KB')


main()
