"""Builds the road vehicles of the neighbourhood.

    python blender/make_cars.py                     # all nine, then: npm run compress:models
    python blender/make_cars.py --only sedan,van    # some of them (the others keep their manifest entries)
    python blender/make_cars.py --hp DIR            # also write the never-shipped high-poly sources to DIR

Every vehicle type (six family cars, three exotics) comes from one description in
bld/cars.py, built four times (bld/car_bake.py has the details):

    high-poly       the bake source: a body section every 1.5 cm, 96 points round it, 64-segment
                    wheels; never shipped (`--hp` writes it out for comparison renders)
    <type>-hi.glb   the hero tier, for cars near the camera on HIGH: `paint` (a section every
                    4.5 cm, 48 points round, with a UV set and tangents), `glass`, `detail`
                    (vertex-coloured, the colour's alpha the material class, occlusion baked in)
                    and a single `wheel` at the origin that the site instances four times and
                    spins (its axle is the glTF z axis, outer face toward -z); 21 to 25k
                    triangles with its four wheels
    <type>-paint.webp, <type>-paint-n.webp
                    the hero skin's maps: occlusion, road grime and curvature packed in R, G, B,
                    and the normals of the high-poly skin
    <type>-mid.glb  the mid tier, for cars a little further off on HIGH: the close-up model at its
                    old resolution (10 to 13k triangles with its wheels), its occlusion and grime
                    baked into vertex colours, the same four meshes as the hero
    <type>.glb      the lean tier for distance and the LOW tier: `paint` (tinted per instance; its
                    vertex colours carry the same occlusion and grime) and `detail`, 1.4 to 1.6k

The manifest lists where the four wheels sit (`wheelOffsets`); `exotic` marks the supercars,
which the site paints from a palette of their own and deals out at about one car in seven.

The vehicles are modelled in metres and exported at SCALE, the same site scale as the houses.
"""
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402

from bld import car_bake as cb  # noqa: E402
from bld import cars  # noqa: E402
from bld.homes import SCALE  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'cars')

# resolution: (segments round a wheel, factor on every other cylinder, body section spacing in
# metres, segments per ring span); see WHEEL_N, CYL_RES, SKIN_DX and SKIN_SUB in bld/cars.py
HERO_RES = (32, 1.6, 0.045, 2)
MID_RES = (24, 1.0, None, 1)
HP_RES = (64, 2.5, 0.015, 4)


def export(objs, path, tangents=False):
    """Scale to site units, smooth by angle and write one GLB; returns the triangle count per object."""
    for o in objs:
        o.scale = (SCALE,) * 3
        cb.select_only([o])
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38))
    cb.select_only(objs)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False,
        export_materials='NONE', export_normals=True, export_yup=True, export_tangents=tangents,
        export_texcoords=True, export_cameras=False, export_lights=False, export_vertex_color='ACTIVE',
    )
    return {o.name: cb.tris(o) for o in objs}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build_hi(kind, res):
    cars.WHEEL_N, cars.CYL_RES, cars.SKIN_DX, cars.SKIN_SUB = res
    cars.SIDE_CURVE, cars.PLAN_ROUND = 1.0, 0.0
    try:
        objs, hi = cars.build_hi(kind)
    finally:
        cars.WHEEL_N, cars.CYL_RES, cars.SKIN_DX, cars.SKIN_SUB = 24, 1.0, None, 1
        cars.SIDE_CURVE = cars.PLAN_ROUND = 0.0
    return objs, {o.name: o for o in objs}, hi


def lean(kind):
    reset()
    objs, info = cars.build(kind)
    parts = {o.name: o for o in objs}
    g = cb.ground()
    cb.cycles(48, 0.55)
    cb.vertex_ao(parts['paint'], [parts['detail'], g], floor=0.30, power=0.9, grime_low=0.5)
    cb.vertex_ao(parts['detail'], [parts['paint'], g], floor=0.25)
    bpy.data.objects.remove(g)
    path = os.path.join(OUT, f'{kind}.glb')
    tris = sum(export(objs, path).values())
    return tris, info, path


def mid(kind):
    """The mid tier: the close-up model at its old resolution, occlusion and grime baked per vertex."""
    reset()
    objs, parts, info = build_hi(kind, MID_RES)
    paint, detail, glass, wheel = (parts.get(n) for n in ('paint', 'detail', 'glass', 'wheel'))
    if glass:
        glass.hide_render = True
    g = cb.ground()
    copies = cb.wheel_copies(wheel, [(x, z, y) for x, z, y in info['wheelOffsets']])
    wheel.hide_render = True
    cb.cycles(48, 0.5)
    cb.vertex_ao(paint, [detail, g, *copies], floor=0.30, power=0.9, grime_low=0.5)
    cb.vertex_ao(detail, [paint, g, *copies], floor=0.18)
    for o in copies:
        bpy.data.objects.remove(o)
    bpy.data.objects.remove(g)
    for o in (paint, detail):
        o.hide_render = True
    wheel.hide_render = False
    cb.cycles(48, 0.12)
    cb.vertex_ao(wheel, [], floor=0.20)
    for o in objs:
        o.hide_render = False
    path = os.path.join(OUT, f'{kind}-mid.glb')
    parts_tris = export(objs, path)
    return sum(parts_tris.values()) + 3 * parts_tris.get('wheel', 0), path


def hero(kind, hp_dir):
    reset()
    # the high-poly source first, renamed out of the way of the hero's names
    hp_objs, hp, _ = build_hi(kind, HP_RES)
    hp_tris = {o.name: cb.tris(o) for o in hp_objs}
    hp_total = sum(hp_tris.values()) + 3 * hp_tris.get('wheel', 0)
    if hp_dir:
        export(hp_objs, os.path.join(hp_dir, f'{kind}-hp.glb'))
        # export() scaled them to site units: back to metres for the bake
        for o in hp_objs:
            o.data.transform(Matrix.Scale(1 / SCALE, 4))
    for o in hp_objs:
        o.name = f'hp-{o.name}'

    objs, parts, info = build_hi(kind, HERO_RES)
    paint, detail, glass, wheel = (parts.get(n) for n in ('paint', 'detail', 'glass', 'wheel'))
    cb.unwrap(paint)
    cb.cycles(1, 0.5)
    nrm = cb.normal_texture(paint, hp['paint'])
    for o in hp_objs:
        bpy.data.objects.remove(o)

    if glass:
        glass.hide_render = True        # light reaches the cabin through the windows
    g = cb.ground()
    offs = [(x, z, y) for x, z, y in info['wheelOffsets']]
    copies = cb.wheel_copies(wheel, offs)
    wheel.hide_render = True
    cb.cycles(96, 0.5)
    ao = cb.ao_texture(paint, [detail, g, *copies])
    field = cb.field_texture(paint)
    cb.vertex_ao(detail, [paint, g, *copies], samples=64, floor=0.18)
    for o in copies:
        bpy.data.objects.remove(o)
    bpy.data.objects.remove(g)
    # the wheel on its own (it turns, so only its own parts may shade it)
    for o in (paint, detail):
        o.hide_render = True
    wheel.hide_render = False
    cb.cycles(64, 0.12)
    cb.vertex_ao(wheel, [], samples=64, floor=0.20)
    stats = cb.save_maps(os.path.join(OUT, f'{kind}-paint.webp'), os.path.join(OUT, f'{kind}-paint-n.webp'), ao, field, nrm)
    for o in objs:
        o.hide_render = False
    cb.clear_materials(objs)

    # MikkTSpace tangents need triangles
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(paint.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY', ngon_method='BEAUTY')
    bm.to_mesh(paint.data)
    bm.free()
    path = os.path.join(OUT, f'{kind}-hi.glb')
    # tangents for the normal map (only the paint has UVs, so only it gets them)
    parts_tris = export(objs, path, tangents=True)
    total = sum(parts_tris.values()) + 3 * parts_tris.get('wheel', 0)
    return total, parts_tris, info, path, hp_total, stats


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    only = None
    hp_dir = None
    if '--only' in argv:
        only = argv[argv.index('--only') + 1].split(',')
    if '--hp' in argv:
        hp_dir = argv[argv.index('--hp') + 1]
        os.makedirs(hp_dir, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    man_path = os.path.join(OUT, 'manifest.json')
    old = {}
    if os.path.exists(man_path):
        old = {t['id']: t for t in json.load(open(man_path))['types']}
    manifest = dict(types=[])
    for kind in cars.SPECS:
        if only and kind not in only and kind in old:
            manifest['types'].append(old[kind])
            continue
        t0 = time.time()
        tris, info, path = lean(kind)
        scaled = {k: (round(v * SCALE, 3) if isinstance(v, float) else v) for k, v in info.items()
                  if not isinstance(v, dict)}
        scaled['lamp'] = {k: [round(c * SCALE, 3) for c in v] for k, v in info['lamp'].items()}

        mid_tris, mid_path = mid(kind)
        hi_tris, parts, hi, hi_path, hp_tris, stats = hero(kind, hp_dir)
        entry = dict(
            id=kind, file=f'{kind}.glb', mid=f'{kind}-mid.glb', hi=f'{kind}-hi.glb', maps=dict(paint=f'{kind}-paint.webp', normal=f'{kind}-paint-n.webp'),
            tris=tris, midTris=mid_tris, hiTris=hi_tris, hpTris=hp_tris, **scaled,
            wheelRadius=round(hi['wheelRadius'] * SCALE, 4), wheelWidth=round(hi['wheelWidth'] * SCALE, 4),
            wheelOffsets=[[round(c * SCALE, 4) for c in o] for o in hi['wheelOffsets']],
        )
        manifest['types'].append(entry)
        print(f'{kind:8s} lo {tris:5d} tris {os.path.getsize(path) // 1024:4d} KB   mid {mid_tris:5d} tris   '
              f'hero {hi_tris:5d} tris {os.path.getsize(hi_path) // 1024:4d} KB  {parts}   high-poly {hp_tris}  '
              f'maps {stats}  {time.time() - t0:.0f} s', flush=True)
        with open(man_path, 'w') as f:
            json.dump(dict(types=manifest['types'] + [old[k] for k in cars.SPECS if k in old and
                                                      k not in {t['id'] for t in manifest['types']}]), f, indent=1)
    with open(man_path, 'w') as f:
        json.dump(manifest, f, indent=1)


main()
