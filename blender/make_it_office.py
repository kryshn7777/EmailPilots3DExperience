"""Builds the night-time IT office's props: one GLB, one shared atlas.

    python blender/make_it_office.py && npm run compress:models
    python blender/make_it_office.py --render DIR      # also Cycles renders: high-poly vs shipped
    python blender/make_it_office.py --debug DIR       # also the atlas maps as PNGs

Every prop is described once (blender/bld/office.py) and built twice: a high-poly twin with
rounded bevels, every small detail as geometry and procedural wear in its materials
(bld/office_mats.py), and the lean mesh that ships. All lean meshes share one UV atlas; Cycles
bakes normals, bounce-aware occlusion, albedo and roughness/metalness from each twin onto its
lean mesh (bld/office_bake.py). Writes public/models/office/office-props.glb (13 root nodes,
material `office` on the atlas plus the emissive `screen`, `led`, `bulb`, `panel` and the
whiteboard's `board`) and manifest.json; compress:models then meshopt-packs the GLB.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from PIL import Image  # noqa: E402

from bld import office, office_bake as OB  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'office')
KEEP_HP = False
QUALITY = dict(color=90, orm=88, normal=94)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--render', help='write Cycles comparison renders (high-poly vs shipped) here')
    ap.add_argument('--views', default=','.join(OB.VIEWS), help='comma-separated render views')
    ap.add_argument('--samples', type=int, default=48)
    ap.add_argument('--res', default='1200x675', help='render size, WxH')
    ap.add_argument('--debug', help='write the atlas maps as PNGs here')
    ap.add_argument('--atlas', type=int, default=OB.ATLAS, help='atlas size (tests only; ships 2048)')
    ap.add_argument('--only', help='comma-separated props (tests only)')
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--keep-hp', action='store_true', help='reuse high-poly renders already in the render folder')
    ap.add_argument('--compare', help='only render: the high-poly twins against this (uncompressed) GLB; needs --render')
    args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
    OB.ATLAS = args.atlas
    global KEEP_HP
    KEEP_HP = args.keep_hp
    names = args.only.split(',') if args.only else list(office.BUILDERS)
    os.makedirs(args.out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    t0 = time.time()

    props = [OB.make_prop(n) for n in names]
    print(f'built {len(props)} props in {time.time() - t0:.0f}s')
    if args.compare:
        for p in props:
            for k in ('lp', 'own', 'proxy'):
                if p.get(k):
                    bpy.data.objects.remove(p[k])
                    p[k] = None
        os.makedirs(args.render, exist_ok=True)
        compare(props, args.compare, args.render, args.views.split(','), args.samples, args.res)
        return
    OB.unwrap(props)
    baker = OB.Baker()
    every = [o for p in props for o in (p['hp'], p['lp'], p['own']) if o]
    for p in props:
        others = [o for o in every if o not in (p['hp'], p['lp'], p['own'])]
        dt = baker.bake(p, others)
        print(f'  baked {p["name"]:22s} {dt:5.0f}s  ({p["lo_tris"]} tris from {p["hi_tris"]})')
    maps = OB.assemble(baker, args.debug)

    tmp = tempfile.mkdtemp(prefix='office-maps-')
    paths = {}
    for k, a in maps.items():
        paths[k] = os.path.join(tmp, f'office-{k}.webp')
        Image.fromarray(a).save(paths[k], 'WEBP', quality=QUALITY[k], method=6)
    lean = [OB.finalize(p) for p in props]
    glb = os.path.join(args.out, 'office-props.glb')
    OB.export_glb(lean, glb)
    subprocess.run(['node', os.path.join(ROOT, 'scripts', 'office-pack.mjs'), glb, paths['color'], paths['orm'], paths['normal']],
                   check=True, cwd=ROOT)
    manifest = {
        'file': 'office-props.glb',
        'units': 'metres; Y up; each node faces +Z, origin at the floor-centre of its footprint',
        'atlas': {k: [args.atlas, args.atlas] for k in maps},
        'nodes': [],
    }
    for p in props:
        node = {'name': p['name'], 'size': p['size'], 'emissive': p['emissive'], 'tris': p['tris']}
        if p['canvas']:
            node['canvas'] = p['canvas']
        manifest['nodes'].append(node)
    manifest['tris'] = sum(p['tris'] for p in props)
    with open(os.path.join(args.out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    kb = {k: os.path.getsize(v) // 1024 for k, v in paths.items()}
    print(f'{manifest["tris"]} tris in {len(props)} nodes; glb {os.path.getsize(glb) // 1024} KB (maps {kb}); '
          f'{time.time() - t0:.0f}s')

    if args.render:
        os.makedirs(args.render, exist_ok=True)
        plain = os.path.join(args.render, 'office-props.plain.glb')
        shutil.copy(glb, plain)
        compare(props, plain, args.render, args.views.split(','), args.samples, args.res)
    shutil.rmtree(tmp, ignore_errors=True)


def compare(props, glb, out, views, samples, res='1200x675'):
    """The same lights, camera and layout twice: the high-poly twins with their procedural
    materials, then the shipped GLB (re-imported) with its baked maps."""
    for p in props:
        for k in ('lp', 'own'):
            if p.get(k):
                bpy.data.objects.remove(p[k])
                p[k] = None
    cam = OB.setup_render_scene(res=tuple(int(v) for v in res.split('x')), samples=samples)
    hps = []
    for p in props:
        OB.place(p['hp'], p['name'])
        hps.append(p['hp'])
    for v in views:
        if KEEP_HP and os.path.exists(os.path.join(out, f'hp-{v}.png')):
            continue
        OB.aim(cam, v)
        OB.render(os.path.join(out, f'hp-{v}.png'))
    for o in hps:
        o.hide_render = True
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    for o in set(bpy.data.objects) - before:
        if o.name in OB.LAYOUT and o.parent is None:
            OB.place(o, o.name)
    for v in views:
        OB.aim(cam, v)
        OB.render(os.path.join(out, f'lp-{v}.png'))
        a, b = Image.open(os.path.join(out, f'hp-{v}.png')).convert('RGB'), Image.open(os.path.join(out, f'lp-{v}.png')).convert('RGB')
        sheet = Image.new('RGB', (a.width * 2 + 8, a.height), (20, 20, 20))
        sheet.paste(a, (0, 0))
        sheet.paste(b, (a.width + 8, 0))
        sheet.save(os.path.join(out, f'compare-{v}.png'))
    print('renders in', out)


main()
