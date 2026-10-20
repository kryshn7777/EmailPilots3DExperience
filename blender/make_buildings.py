"""Builds a building set: low-poly modules plus one shared texture atlas.

    python blender/make_buildings.py --set city       # towers + blocks (the night city)
    python blender/make_buildings.py --set homes      # houses + trees (outside the window)
    blender -b -P blender/make_buildings.py -- --set homes --only home-gable

Writes GLBs, the atlas maps and manifest.json into public/models/city-kit/ or
public/models/homes/. See blender/README.md for how the pieces fit together.
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from bld import archetypes, atlas, homes  # noqa: E402
from bld.bake import Baker  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def parse():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument('--set', default='city', choices=sorted(atlas.LAYOUTS))
    p.add_argument('--out', help='defaults to public/models/<set directory>')
    p.add_argument('--only', nargs='*', help='module ids to build (atlas will be partial)')
    p.add_argument('--debug', help='also dump full-size PNGs of every map here')
    p.add_argument('--blend', help='save the low-poly models as a .blend here')
    p.add_argument('--no-bake', action='store_true', help='build and export geometry only')
    return p.parse_args(argv)


SETS = {
    'city': dict(dir='city-kit', groups=(('tower', archetypes.TOWERS), ('block', archetypes.BLOCKS))),
    'homes': dict(dir='homes', groups=(('house', homes.HOUSES), ('tree', homes.TREES))),
}


def build_models(set_name, only):
    models = []
    for kind, fns in SETS[set_name]['groups']:
        for index, fn in enumerate(fns):
            model = fn()
            if only and model.id not in only:
                continue
            model.tile_index = index
            models.append(model)
    return models


def export_glb(obj, path):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False,
        export_materials='NONE', export_texcoords=True, export_normals=True,
        export_yup=True, export_cameras=False, export_lights=False,
    )


def save_maps(maps, out, debug, size_full):
    sizes = {}
    for name in ('color', 'normal', 'orm', 'emissive'):
        im = Image.fromarray(maps[name], 'RGB')
        if debug:
            im.save(os.path.join(debug, f'{name}.png'))
        for suffix, size in (('', size_full), ('-low', size_full // 2)):
            # the half-size set is for phones; they skip the normal map entirely
            if suffix and name == 'normal':
                continue
            path = os.path.join(out, f'atlas-{name}{suffix}.webp')
            sized = im if size == size_full else im.resize((size, size), Image.LANCZOS)
            if name == 'normal':
                sized.save(path, 'WEBP', lossless=True, method=6)
            else:
                sized.save(path, 'WEBP', quality=90, method=6)
            sizes[os.path.basename(path)] = os.path.getsize(path)
    return sizes


def main():
    args = parse()
    started = time.time()
    layout = atlas.LAYOUTS[args.set]
    args.out = args.out or os.path.join(ROOT, 'public', 'models', SETS[args.set]['dir'])
    os.makedirs(args.out, exist_ok=True)
    if args.debug:
        os.makedirs(args.debug, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)

    models = build_models(args.set, args.only)
    solids = sorted({m['mat'] for model in models for m in model.lp.meta if m['kind'] == 'solid'})
    cells = layout.palette_cells(solids)
    print(f'{len(models)} models, {len(solids)} solid colours')

    baker = None if args.no_bake else Baker(layout)
    manifest = []
    for model in models:
        t = time.time()
        model.finish()
        model.assign_uv(layout, layout.tile_rect(model.kind, model.tile_index), cells)
        dx, dy, dz = model.dims()
        k = model.scale if model.scale else model.target / max(dx, dy, dz)
        if baker:
            hp = model.hp_object()
            baker.bake(model, hp)
            bpy.data.objects.remove(hp)
        final = model.final_object(k)
        export_glb(final, os.path.join(args.out, f'{model.id}.lod0.glb'))
        manifest.append(dict(
            id=model.id, kind=model.kind, lod0=f'{model.id}.lod0.glb',
            footprint=[round(dx * k, 3), round(dy * k, 3)], height=round(dz * k, 3),
            tris0=model.tris(), density=round(model.density, 2),
        ))
        print(f'{model.id:24s} {model.tris():4d} tris  {model.density:5.1f} px/m  '
              f'{dx:5.1f}x{dy:5.1f}x{dz:5.1f} m  {time.time() - t:5.1f}s')

    sizes = {}
    if baker:
        sizes = save_maps(baker.assemble(solids), args.out, args.debug, layout.size)
    with open(os.path.join(args.out, 'manifest.json'), 'w') as f:
        json.dump(dict(
            dir=SETS[args.set]['dir'],
            atlas=dict(color='atlas-color.webp', normal='atlas-normal.webp',
                       orm='atlas-orm.webp', emissive='atlas-emissive.webp',
                       low=dict(color='atlas-color-low.webp', orm='atlas-orm-low.webp',
                                emissive='atlas-emissive-low.webp')),
            modules=manifest), f, indent=2)
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=args.blend, compress=True)
    for name, size in sizes.items():
        print(f'  {name:28s} {size / 1024:7.0f} KB')
    print(f'done in {time.time() - started:.0f}s')


main()
