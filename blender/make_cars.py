"""Builds the road vehicles of the neighbourhood.

    python blender/make_cars.py

Writes public/models/cars/<type>.glb (two meshes each: `paint`, tinted per instance,
and `detail`, vertex-coloured) and public/models/cars/manifest.json. The cars are
modelled in metres and exported at SCALE, the same site scale as the houses.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from bld import cars  # noqa: E402
from bld.homes import SCALE  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'cars')


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = dict(types=[])
    for kind in cars.SPECS:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        objs, info = cars.build(kind)
        for o in objs:
            o.scale = (SCALE,) * 3
            bpy.ops.object.select_all(action='DESELECT')
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38))
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        path = os.path.join(OUT, f'{kind}.glb')
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=True, export_apply=False,
            export_materials='NONE', export_normals=True, export_yup=True,
            export_cameras=False, export_lights=False, export_vertex_color='ACTIVE',
        )
        tris = sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
        scaled = {k: (round(v * SCALE, 3) if isinstance(v, float) else v) for k, v in info.items()
                  if not isinstance(v, dict)}
        scaled['lamp'] = {k: [round(c * SCALE, 3) for c in v] for k, v in info['lamp'].items()}
        manifest['types'].append(dict(id=kind, file=f'{kind}.glb', tris=tris, **scaled))
        print(f'{kind:8s} {tris:5d} tris  {os.path.getsize(path) // 1024} KB')
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)


main()
