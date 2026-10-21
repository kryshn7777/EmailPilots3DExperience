"""Builds the road vehicles of the neighbourhood.

    python blender/make_cars.py

Writes two tiers per vehicle type into public/models/cars/ and a manifest.json:

    <type>.glb      the lean model for distance and the LOW tier: two meshes, `paint`
                    (tinted per instance) and `detail` (vertex-coloured), ~1.4k triangles
    <type>-hi.glb   the close-up model: `paint`, `detail`, `glass` and a single `wheel` at
                    the origin that the site instances four times and spins (its axle is
                    the glTF z axis, outer face toward -z); the manifest lists where the
                    four wheels sit (`wheelOffsets`), 5 to 8k triangles with them

The vehicles are modelled in metres and exported at SCALE, the same site scale as the houses.
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


def export(objs, path):
    """Scale to site units, smooth by angle and write one GLB; returns the triangle count per object."""
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
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False,
        export_materials='NONE', export_normals=True, export_yup=True,
        export_cameras=False, export_lights=False, export_vertex_color='ACTIVE',
    )
    return {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs}


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = dict(types=[])
    for kind in cars.SPECS:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        objs, info = cars.build(kind)
        path = os.path.join(OUT, f'{kind}.glb')
        tris = sum(export(objs, path).values())
        scaled = {k: (round(v * SCALE, 3) if isinstance(v, float) else v) for k, v in info.items()
                  if not isinstance(v, dict)}
        scaled['lamp'] = {k: [round(c * SCALE, 3) for c in v] for k, v in info['lamp'].items()}

        bpy.ops.wm.read_factory_settings(use_empty=True)
        objs, hi = cars.build_hi(kind)
        hi_path = os.path.join(OUT, f'{kind}-hi.glb')
        parts = export(objs, hi_path)
        wheel_tris = parts.get('wheel', 0)
        hi_tris = sum(parts.values()) + 3 * wheel_tris          # the wheel mesh is drawn four times
        entry = dict(
            id=kind, file=f'{kind}.glb', hi=f'{kind}-hi.glb', tris=tris, hiTris=hi_tris, **scaled,
            wheelRadius=round(hi['wheelRadius'] * SCALE, 4), wheelWidth=round(hi['wheelWidth'] * SCALE, 4),
            wheelOffsets=[[round(c * SCALE, 4) for c in o] for o in hi['wheelOffsets']],
        )
        manifest['types'].append(entry)
        print(f'{kind:8s} lo {tris:5d} tris {os.path.getsize(path) // 1024:4d} KB   '
              f'hi {hi_tris:5d} tris {os.path.getsize(hi_path) // 1024:4d} KB  {parts}')
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)


main()
