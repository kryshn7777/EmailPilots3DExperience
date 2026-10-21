"""Builds the lighthouse set: tower, islet, cottage and their surface maps.

    python blender/make_lighthouse.py

Writes public/models/lighthouse/lighthouse.glb (one mesh per material, named for it),
the tileable stone/rock/slate/wood/plaster/brick maps, and manifest.json, which holds
the material table the runtime builds its materials from (Beacon.ts). Modelled in the
old tower's units, so every anchor in Beacon.ts still holds.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from bld import lh_tex, lighthouse  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'lighthouse')

# name -> material spec for the runtime
MATERIALS = {
    'granite': dict(map='stone', color='#8c8881', roughness=0.9),
    'white': dict(map='stone', color='#f0ece2', roughness=0.8),
    'red': dict(map='stone', color='#c8412f', roughness=0.78),
    'rock': dict(map='rock', color='#ffffff', roughness=0.55, vertexColors=True),
    'iron': dict(color='#1c2229', roughness=0.45, metalness=0.75),
    'copper': dict(color='#58a58f', roughness=0.5, metalness=0.55),
    'brass': dict(color='#b68c3e', roughness=0.35, metalness=0.9),
    'slate': dict(map='slate', color='#ffffff', roughness=0.75),
    'wood': dict(map='wood', color='#b08a62', roughness=0.85),
    'plaster': dict(map='plaster', color='#ffffff', roughness=0.9),
    'brick': dict(map='brick', color='#ffffff', roughness=0.9),
    'glass_warm': dict(color='#241a0c', roughness=0.3, emissive='#ffc06a', emissiveIntensity=1.5),
    'glass_lantern': dict(color='#0d3a38', roughness=0.2, emissive='#7fe8d8', emissiveIntensity=2.2),
    'lens': dict(color='#123c3a', roughness=0.15, emissive='#eafffb', emissiveIntensity=3.4),
    'misc': dict(color='#ffffff', roughness=0.8, vertexColors=True),
}


def save(arr, path, mode='RGB'):
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), mode)
    im.save(path, 'WEBP', quality=88, method=6)
    return os.path.getsize(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for name, fn in lh_tex.MAPS.items():
        color, normal = fn()
        total += save(color, os.path.join(OUT, f'{name}-color.webp'))
        total += save(normal, os.path.join(OUT, f'{name}-normal.webp'))
    print(f'maps: {total // 1024} KB')

    bpy.ops.wm.read_factory_settings(use_empty=True)
    collection = bpy.context.scene.collection
    parts = lighthouse.build(collection)
    bpy.ops.object.select_all(action='DESELECT')
    tris = {}
    for name, obj in parts.items():
        if obj is None:
            continue
        obj.select_set(True)
        tris[name] = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        # faces keep the shading each builder asked for
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, 'lighthouse.glb'), export_format='GLB', use_selection=True,
        export_apply=False, export_materials='NONE', export_texcoords=True, export_normals=True,
        export_yup=True, export_cameras=False, export_lights=False, export_vertex_color='ACTIVE',
    )
    manifest = dict(materials=MATERIALS, tris=tris, maps=sorted(lh_tex.MAPS))
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print(f'{sum(tris.values())} tris:', ', '.join(f'{k} {v}' for k, v in tris.items()))
    print(f'glb {os.path.getsize(os.path.join(OUT, "lighthouse.glb")) // 1024} KB')


main()
