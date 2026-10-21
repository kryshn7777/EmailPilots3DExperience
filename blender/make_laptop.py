"""Builds the laptop used on the study desk and in the arrival office.

    python blender/make_laptop.py

Writes public/models/laptop/laptop.glb (one mesh per material, `lid` an Empty at the hinge with
the display, bezel and lid shell as children) and laptop-keys.webp, the atlas of key legends
the keyboard's UVs point into.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from bld import laptop  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'laptop')


def legends():
    cell = 64
    cols = laptop.ATLAS_COLS
    rows = (len(laptop.LABELS) + cols - 1) // cols
    im = Image.new('RGB', (cols * cell, rows * cell), (43, 47, 58))
    d = ImageDraw.Draw(im)
    for i, label in enumerate(laptop.LABELS):
        if not label:
            continue
        font = ImageFont.truetype('DejaVuSans.ttf', 30 if len(label) <= 2 else 17)
        cx, cy = (i % cols) * cell + cell // 2, (i // cols) * cell + cell // 2
        d.text((cx, cy), label, font=font, fill=(223, 231, 243), anchor='mm')
    path = os.path.join(OUT, 'laptop-keys.webp')
    im.save(path, 'WEBP', quality=92, method=6)
    return os.path.getsize(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    parts = laptop.build(bpy.context.scene.collection)
    bpy.ops.object.select_all(action='DESELECT')
    tris = 0
    for name, obj in parts.items():
        obj.select_set(True)
        if obj.type == 'MESH':
            tris += sum(len(p.vertices) - 2 for p in obj.data.polygons)
    path = os.path.join(OUT, 'laptop.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False,
        export_materials='NONE', export_texcoords=True, export_normals=True, export_yup=True,
        export_cameras=False, export_lights=False,
    )
    print(f'{tris} tris, glb {os.path.getsize(path) // 1024} KB, legends {legends() // 1024} KB')


main()
