"""Builds a building set: modules plus the texture atlases they share.

    python blender/make_buildings.py --set city                  # towers + blocks (the night city)
    python blender/make_buildings.py --set homes                 # every sheet of the homes set
    python blender/make_buildings.py --set homes --sheet hero-trees --only tree-oak-hero
    blender -b -P blender/make_buildings.py -- --set homes

A set is one folder under public/models/ and one manifest.json. Each set has one or
more SHEETS, a sheet being a group of modules that share one atlas (one material at
runtime):

  main         the lean modules, baked from high-poly twins (every set has one)
  hero-trees   close-up trees: bark tubes and leaf cards, built directly (homes only)
  hero-houses  close-up houses: the high-poly twin itself on a denser bake (homes only)
  hero-towers  close-up towers and blocks for the night city's canyon, the same way (city only)

Building a single sheet merges its modules and atlas into the existing manifest, so
a hero sheet can be rebuilt in seconds without re-baking the lean one.
See blender/README.md for how the pieces fit together.
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

from bld import archetypes, atlas, foliage, hero_trees, homes  # noqa: E402
from bld.bake import Baker  # noqa: E402
from bld.bark import normal_map as bark_normals  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SETS = {
    'city': dict(dir='city-kit', sheets={
        'main': dict(layout='city', kind='baked',
                     groups=(('tower', archetypes.TOWERS), ('block', archetypes.BLOCKS))),
        'hero-towers': dict(layout='city-hero', kind='hero-baked',
                            groups=(('tower', archetypes.TOWERS), ('block', archetypes.BLOCKS))),
    }),
    'homes': dict(dir='homes', sheets={
        'main': dict(layout='homes', kind='baked',
                     groups=(('house', homes.HOUSES), ('tree', homes.TREES))),
        'hero-trees': dict(layout='hero-trees', kind='trees'),
        'hero-houses': dict(layout='homes-hero', kind='hero-baked',
                            groups=(('house', homes.HOUSES),)),
    }),
}

# module id -> (species, the lean module it replaces, tier). 'hero' is for lots the
# camera passes close to, 'detail' for the ring of trees it still sees clearly, 'lite'
# for the many trees beyond that.
HERO_TREES = {
    'tree-oak-hero': ('oak', 'tree-oak', 'hero'),
    'tree-maple-hero': ('maple', 'tree-maple', 'hero'),
    'tree-pine-hero': ('pine', 'tree-pine', 'hero'),
    'tree-poplar-hero': ('poplar', 'tree-poplar', 'hero'),
    'tree-oak-detail': ('oak', 'tree-oak', 'detail'),
    'tree-maple-detail': ('maple', 'tree-maple', 'detail'),
    'tree-pine-detail': ('pine', 'tree-pine', 'detail'),
    'tree-poplar-detail': ('poplar', 'tree-poplar', 'detail'),
    'tree-oak-lite': ('oak', 'tree-oak', 'lite'),
    'tree-maple-lite': ('maple', 'tree-maple', 'lite'),
    'tree-pine-lite': ('pine', 'tree-pine', 'lite'),
    'tree-poplar-lite': ('poplar', 'tree-poplar', 'lite'),
}


def parse():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument('--set', default='city', choices=sorted(SETS))
    p.add_argument('--sheet', help='build only this sheet (default: all of the set)')
    p.add_argument('--out', help='defaults to public/models/<set directory>')
    p.add_argument('--only', nargs='*', help='module ids to build (atlas will be partial)')
    p.add_argument('--debug', help='also dump full-size PNGs of every map here')
    p.add_argument('--blend', help='save the low-poly models as a .blend here')
    p.add_argument('--no-bake', action='store_true', help='build and export geometry only')
    p.add_argument('--reuse-maps', action='store_true',
                   help='hero sheets: re-export the meshes against the atlas already on disk (no bake); '
                        'only valid while the modules\' slots and materials are unchanged')
    return p.parse_args(argv)


def export_glb(obj, path):
    """Write one object, or a list of them (the first is the active one), to a GLB."""
    objs = obj if isinstance(obj, (list, tuple)) else [obj]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False,
        export_materials='NONE', export_texcoords=True, export_normals=True,
        export_yup=True, export_cameras=False, export_lights=False,
    )


def atlas_names(sheet):
    """File names for a sheet's maps: the main sheet keeps the plain names."""
    pre = 'atlas-' if sheet == 'main' else f'atlas-{sheet}-'
    return {m: f'{pre}{m}.webp' for m in ('color', 'normal', 'orm', 'emissive')}, \
           {m: f'{pre}{m}-low.webp' for m in ('color', 'orm', 'emissive')}


def save_maps(sheet, maps, out, debug, size_full):
    """Write the full and half-size WebP maps. `maps` values are (H, W, 3|4) uint8."""
    full, low = atlas_names(sheet)
    sizes = {}
    for name, arr in maps.items():
        mode = 'RGBA' if arr.shape[-1] == 4 else 'RGB'
        im = Image.fromarray(arr, mode)
        if debug:
            im.save(os.path.join(debug, f'{sheet}-{name}.png'))
        # the half-size set is for phones. Colour and glow are what the eye reads on a facade,
        # so the main sheet keeps those at full size there (a half-size window grid went to
        # mush on a phone); the occlusion/roughness map halves, and a 1024 atlas is small enough
        # to keep whole
        low_size = size_full if (size_full <= 1024 or (sheet == 'main' and name in ('color', 'emissive'))) else size_full // 2
        for variant, size in ((full, size_full), (low, low_size)):
            # phones skip the normal map entirely
            if name not in variant:
                continue
            path = os.path.join(out, variant[name])
            sized = im if size == size_full else im.resize((size, size), Image.LANCZOS)
            if name == 'normal' and sheet == 'main':
                sized.save(path, 'WEBP', lossless=True, method=6)
            elif name == 'normal':
                # a hero sheet's normals are bark noise over a flat field: lossy holds up there
                sized.save(path, 'WEBP', quality=92, method=6)
            else:
                sized.save(path, 'WEBP', quality=90, alpha_quality=100, method=6)
            sizes[os.path.basename(path)] = os.path.getsize(path)
    return sizes


def build_baked(setname, sheet, cfg, args, out):
    layout = atlas.LAYOUTS[cfg['layout']]
    models = []
    for kind, fns in cfg['groups']:
        for index, fn in enumerate(fns):
            model = fn()
            if args.only and model.id not in args.only:
                continue
            model.tile_index = index
            models.append(model)
    solids = sorted({m['mat'] for model in models for m in model.lp.meta if m['kind'] == 'solid'})
    cells = layout.palette_cells(solids)
    print(f'[{sheet}] {len(models)} models, {len(solids)} solid colours')

    baker = None if args.no_bake else Baker(layout)
    entries = []
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
        export_glb(final, os.path.join(out, f'{model.id}.lod0.glb'))
        entries.append(dict(
            id=model.id, kind=model.kind, sheet=sheet, lod0=f'{model.id}.lod0.glb',
            footprint=[round(dx * k, 3), round(dy * k, 3)], height=round(dz * k, 3),
            tris0=model.tris(), density=round(model.density, 2),
        ))
        print(f'{model.id:24s} {model.tris():4d} tris  {model.density:5.1f} px/m  '
              f'{dx:5.1f}x{dy:5.1f}x{dz:5.1f} m  {time.time() - t:5.1f}s')
    sizes = {}
    if baker:
        m = baker.assemble(solids)
        sizes = save_maps(sheet, {k: m[k] for k in ('color', 'normal', 'orm', 'emissive')},
                          out, args.debug, layout.size)
    return entries, sizes, dict(normal=True, emissive=True, alpha=False)


def build_trees(setname, sheet, cfg, args, out):
    layout = atlas.LAYOUTS[cfg['layout']]
    t = time.time()
    cards = foliage.all_cards()
    barks = hero_trees.barks(layout)
    print(f'[{sheet}] {len(cards)} leaf cards and {len(barks)} bark strips in {time.time() - t:.0f}s')

    n = layout.size
    color = np.zeros((n, n, 4), np.uint8)
    orm = np.zeros((n, n, 3), np.uint8)
    orm[...] = (255, 204, 0)
    # the cards keep their soft radial lighting normals (a flat normal map there); the bark
    # gets the relief of its own furrows, which is what a trunk at arm's length is made of
    normal = np.zeros((n, n, 3), np.uint8)
    normal[...] = (128, 128, 255)
    for key, rect in layout.cards.items():
        x, y, w, h = rect
        color[y:y + h, x:x + w] = cards[key]
    for sp, rect in layout.bark.items():
        x, y, w, h = rect
        rgb, o, height = barks[sp]
        color[y:y + h, x:x + w, :3] = rgb
        color[y:y + h, x:x + w, 3] = 255
        orm[y:y + h, x:x + w] = o
        normal[y:y + h, x:x + w] = bark_normals(height, 9.0)

    entries = []
    for mid, (species, lean, lod) in HERO_TREES.items():
        if args.only and mid not in args.only:
            continue
        t = time.time()
        tree = hero_trees.HeroTree(mid, species, lean, scale=homes.SCALE, lod=lod).build(layout)
        dx, dy, dz = tree.dims()
        obj = tree.final_object()
        export_glb(obj, os.path.join(out, f'{mid}.lod0.glb'))
        entries.append(dict(
            id=mid, kind='tree', sheet=sheet, lean=lean, lod=lod, lod0=f'{mid}.lod0.glb',
            footprint=[round(dx * homes.SCALE, 3), round(dy * homes.SCALE, 3)],
            height=round(dz * homes.SCALE, 3), tris0=tree.tris(),
        ))
        print(f'{mid:24s} {tree.tris():5d} tris  {dx:5.1f}x{dy:5.1f}x{dz:5.1f} m  {time.time() - t:5.1f}s')
    sizes = save_maps(sheet, dict(color=color, orm=orm, normal=normal), out, args.debug, n)
    return entries, sizes, dict(normal=True, emissive=False, alpha=True)


def build_hero_baked(setname, sheet, cfg, args, out):
    """Hero tier of baked modules: same builders, a denser layout, and the high-poly
    twin itself as the mesh. No normal map: the relief is real geometry here."""
    layout = atlas.LAYOUTS[cfg['layout']]
    models = []
    for kind, fns in cfg['groups']:
        for index, fn in enumerate(fns):
            model = fn()
            if args.only and model.id not in args.only and f'{model.id}-hero' not in args.only:
                continue
            model.tile_index = index
            models.append(model)
    for model in models:
        model.finish()   # adds the flat roofs (and their materials) before the palette is sized
    # every material of the twin can end up as a flat-colour face, not just the solids
    names = sorted({n for model in models for n in model.hp.mats} |
                   {m['mat'] for model in models for m in model.lp.meta if m['kind'] == 'solid'})
    cells = layout.palette_cells(names)
    print(f'[{sheet}] {len(models)} models, {len(names)} palette colours')

    baker = None if args.reuse_maps else Baker(layout)
    entries = []
    for model in models:
        t = time.time()
        model.assign_uv(layout, layout.tile_rect(model.kind, model.tile_index), cells)
        dx, dy, dz = model.dims()
        # houses are exported at a fixed scale, towers normalised to their target size
        k = model.scale if model.scale else model.target / max(dx, dy, dz)
        if baker:
            hp = model.hp_object()
            baker.bake(model, hp)
            bpy.data.objects.remove(hp)
        hero = model.hero_object(k)
        # the panes go along as a second mesh, `glass`, drawn with the window shader
        glass = model.glass_object(k)
        export_glb([hero] + ([glass] if glass else []), os.path.join(out, f'{model.id}-hero.lod0.glb'))
        entries.append(dict(
            id=f'{model.id}-hero', kind=model.kind, sheet=sheet, lean=model.id, lod='hero',
            lod0=f'{model.id}-hero.lod0.glb',
            footprint=[round(dx * k, 3), round(dy * k, 3)], height=round(dz * k, 3),
            tris0=model.hero_tris(), density=round(model.density, 2),
        ))
        print(f'{model.id + "-hero":28s} {model.hero_tris():6d} tris  {model.density:5.1f} px/m  '
              f'{time.time() - t:5.1f}s')
    sizes = {}
    if baker:
        m = baker.assemble(names)
        sizes = save_maps(sheet, {n: m[n] for n in ('color', 'orm', 'emissive')}, out, args.debug,
                          layout.size)
    return entries, sizes, dict(normal=False, emissive=True, alpha=False)


BUILDERS = {'baked': build_baked, 'trees': build_trees, 'hero-baked': build_hero_baked}


def merge_manifest(out, setname, sheet, entries, features):
    """Fold one sheet's modules and atlas into the set's manifest.json."""
    path = os.path.join(out, 'manifest.json')
    manifest = json.load(open(path)) if os.path.exists(path) else {}
    manifest['dir'] = SETS[setname]['dir']
    built = {e['id'] for e in entries}
    modules = [m for m in manifest.get('modules', [])
               if not (m.get('sheet', 'main') == sheet and (m['id'] in built or not built))]
    # modules written before sheets existed belong to the main sheet
    for m in modules:
        m.setdefault('sheet', 'main')
    manifest['modules'] = modules + entries
    full, low = atlas_names(sheet)
    block = dict(
        color=full['color'], orm=full['orm'],
        low=dict(color=low['color'], orm=low['orm']),
    )
    if features['normal']:
        block['normal'] = full['normal']
    if features['emissive']:
        block['emissive'] = full['emissive']
        block['low']['emissive'] = low['emissive']
    if features['alpha']:
        block['alpha'] = True
    if sheet == 'main':
        manifest['atlas'] = block
    else:
        manifest.setdefault('sheets', {})[sheet] = dict(atlas=block)
    json.dump(manifest, open(path, 'w'), indent=2)


def main():
    args = parse()
    started = time.time()
    setcfg = SETS[args.set]
    out = args.out or os.path.join(ROOT, 'public', 'models', setcfg['dir'])
    os.makedirs(out, exist_ok=True)
    if args.debug:
        os.makedirs(args.debug, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)

    all_sizes = {}
    for sheet, cfg in setcfg['sheets'].items():
        if args.sheet and sheet != args.sheet:
            continue
        entries, sizes, features = BUILDERS[cfg['kind']](args.set, sheet, cfg, args, out)
        merge_manifest(out, args.set, sheet, entries, features)
        all_sizes.update(sizes)
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=args.blend, compress=True)
    for name, size in all_sizes.items():
        print(f'  {name:36s} {size / 1024:7.0f} KB')
    print(f'done in {time.time() - started:.0f}s')


main()
