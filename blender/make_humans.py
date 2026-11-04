"""Builds the pedestrians from MakeHuman (CC0) bodies, clothes and hair, through MPFB2.

    python blender/fetch_humans.py                 # once: MPFB2 and the MakeHuman system assets (CC0)
    python blender/make_humans.py [--only ethan,mei] [--size 1024] [--render DIR]
    node scripts/compress-models.mjs               # meshopt

Writes public/models/people/:

    humans.glb        per person a lean mesh (`<id>`, 2.6k triangles), and the dog
    humans-hero.glb   per person a hero mesh (`<id>-hero`, 19k; loaded on HIGH only)
                      (the dog (`dog`, from bld/people.py). Every vertex: POSITION, byte
                      NORMAL, TEXCOORD_0 (the shared atlas) and _RIG (bone * 16 + region, option,
                      weight * 255, occlusion * 255), the attribute the shader rig reads.
    atlas-color.webp  4096 x 3072, a 1024 tile a person: albedo (tinted regions normalised to a
                      mean of 0.5, so the runtime's per-person tint times two is the colour), alpha
                      (hair, brows and lashes are cut out)
    atlas-orm.webp    R = occlusion (a white sky, two bounces), G = roughness
    atlas-normal.webp tangent-space normals (MakeHuman's cloth maps, pores, weave, hair strands)
    atlas-*-low.webp  the same at a quarter (256 a person), for phones and the far crowd
    manifest.json     as make_people.py's, plus per variant `hero`, `trisHero`, `tile`, `role`, `mix`,
                      `skin`, `hair` (tints near the person's own) and the atlas file names

`--render DIR` writes Cycles comparisons (the MakeHuman source with its own materials vs the shipped
hero and lean meshes with the baked maps) and a contact sheet of every person.
"""
import json
import math
import os
import struct
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

from bld import humans as H  # noqa: E402
from bld import people  # noqa: E402
from bld.homes import SCALE  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'people')
WORK = os.environ.get('HUMANS_WORK', os.path.join(ROOT, 'blender', 'cache', 'humans-work'))
COLS, ROWS = 4, 3
HERO_TRIS = 19000
LEAN_TRIS = 2600
REGIONS = ['skin', 'hair', 'top', 'bottom', 'shoes', 'accessory', 'under', 'fixed', 'light']


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def gl(v, k=SCALE):
    return [round(v[0] * k, 5), round(v[2] * k, 5), round(-v[1] * k, 5)]


def srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)


def lin(a):
    return np.where(a <= 0.04045, a / 12.92, np.power((a + 0.055) / 1.055, 2.4))


# ---- meshes to arrays ----------------------------------------------------------------------------

def mesh_arrays(o, bone, w, tile, occ=None):
    """Triangles of `o` as glTF arrays: positions (site units), normals, atlas UVs in the tile, rig."""
    me = o.data
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    tl = np.zeros(nt * 3, np.int32)
    me.loop_triangles.foreach_get('loops', tl)
    tp = np.zeros(nt, np.int32)
    me.loop_triangles.foreach_get('polygon_index', tp)
    lv = np.zeros(len(me.loops), np.int32)
    me.loops.foreach_get('vertex_index', lv)
    co = np.zeros(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    cn = np.zeros(len(me.loops) * 3, np.float32)
    me.corner_normals.foreach_get('vector', cn)
    cn = cn.reshape(-1, 3)
    uv = np.zeros(len(me.loops) * 2, np.float32)
    me.uv_layers['atlas'].data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    mi = np.zeros(len(me.polygons), np.int32)
    me.polygons.foreach_get('material_index', mi)
    regs = np.array([int(m.get('region', 0)) for m in me.materials], np.int32)
    loops = tl
    face = np.repeat(tp, 3)
    v = lv[loops]
    P = co[v]
    pos = np.stack([P[:, 0], P[:, 2], -P[:, 1]], 1) * SCALE
    N = cn[loops]
    nrm = np.stack([N[:, 0], N[:, 2], -N[:, 1]], 1)
    c, r = tile % COLS, tile // COLS
    U = uv[loops]
    # glTF's v runs down the image; tile r counts rows from the top
    tu = (c + np.clip(U[:, 0], 0, 1)) / COLS
    tv = (r + 1 - np.clip(U[:, 1], 0, 1)) / ROWS
    rig = np.zeros((len(loops), 4), np.uint8)
    rig[:, 0] = bone[v] * 16 + regs[mi[face]]
    rig[:, 1] = 0
    rig[:, 2] = np.round(np.clip(w[v], 0, 1) * 255)
    rig[:, 3] = 255 if occ is None else np.round(np.clip(occ[v], 0, 1) * 255)
    # weld identical corners
    key = np.concatenate([pos.astype(np.float32).view(np.uint32), np.round(nrm * 127).astype(np.int32),
                          np.round(np.stack([tu, tv], 1) * 65535).astype(np.int32), rig.astype(np.int32)], 1)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    first = np.zeros(len(uniq), np.int64)
    first[inv[::-1]] = np.arange(len(inv))[::-1]
    return dict(pos=pos[first].astype(np.float32), nrm=nrm[first], uv=np.stack([tu, tv], 1)[first],
                rig=rig[first], idx=inv.reshape(-1).astype(np.uint32))


def write_glb(path, meshes):
    """meshes: name -> arrays (see mesh_arrays; uv may be None). KHR_mesh_quantization packing."""
    out = bytearray()
    views, accs, gmeshes, nodes = [], [], [], []

    def put(arr, target, stride=None):
        while len(out) % 4:
            out.append(0)
        views.append(dict(buffer=0, byteOffset=len(out), byteLength=arr.nbytes, target=target,
                          **({'byteStride': stride} if stride else {})))
        out.extend(arr.tobytes())
        return len(views) - 1

    def acc(view, ctype, count, typ, **kw):
        accs.append(dict(bufferView=view, componentType=ctype, count=count, type=typ, **kw))
        return len(accs) - 1

    for name, m in meshes.items():
        n = len(m['pos'])
        at = {}
        at['POSITION'] = acc(put(np.ascontiguousarray(m['pos'], np.float32), 34962), 5126, n, 'VEC3',
                             min=m['pos'].min(0).tolist(), max=m['pos'].max(0).tolist())
        q = np.zeros((n, 4), np.int8)
        nn = m['nrm'] / np.maximum(np.linalg.norm(m['nrm'], axis=1, keepdims=True), 1e-8)
        q[:, :3] = np.clip(np.round(nn * 127), -127, 127)
        at['NORMAL'] = acc(put(q, 34962, 4), 5120, n, 'VEC3', normalized=True)
        if m.get('uv') is not None:
            u = np.round(np.clip(m['uv'], 0, 1) * 65535).astype(np.uint16)
            at['TEXCOORD_0'] = acc(put(np.ascontiguousarray(u), 34962), 5123, n, 'VEC2', normalized=True)
        at['_RIG'] = acc(put(np.ascontiguousarray(m['rig'], np.uint8), 34962), 5121, n, 'VEC4')
        idx = m['idx']
        small = n < 65536
        ind = np.ascontiguousarray(idx, np.uint16 if small else np.uint32)
        ia = acc(put(ind, 34963), 5123 if small else 5125, len(ind), 'SCALAR')
        gmeshes.append(dict(name=name, primitives=[dict(attributes=at, indices=ia)]))
        nodes.append(dict(name=name, mesh=len(gmeshes) - 1))
    while len(out) % 4:
        out.append(0)
    doc = dict(asset=dict(version='2.0', generator='blender/make_humans.py'), scene=0,
               scenes=[dict(nodes=list(range(len(nodes))))], nodes=nodes, meshes=gmeshes, accessors=accs,
               bufferViews=views, buffers=[dict(byteLength=len(out))],
               extensionsUsed=['KHR_mesh_quantization'], extensionsRequired=['KHR_mesh_quantization'])
    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(out), 0x004E4942))
        f.write(out)


def dog_arrays():
    """The dog of bld/people.py, untextured (its regions are tinted as before)."""
    fig = people.build_dog()
    ao = np.asarray(people.bake_occlusion(fig), np.float32)
    bm = fig.bm
    bm.verts.index_update()
    import bmesh
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    pos, nrm, rig = [], [], []
    for f in bm.faces:
        for v in f.verts:
            pos.append(gl(v.co))
            n = f.normal if not f.smooth else v.normal
            n = v.normal if v.normal.dot(f.normal) > math.cos(math.radians(48)) else f.normal
            nrm.append([n.x, n.z, -n.y])
            rig.append([v[fig.l_bone] * 16 + f[fig.l_reg], v[fig.l_opt], round(min(max(v[fig.l_w], 0), 1) * 255),
                        round(min(max(ao[v.index], 0), 1) * 255)])
    pos = np.asarray(pos, np.float32)
    nrm = np.asarray(nrm, np.float32)
    rig = np.asarray(rig, np.uint8)
    key = np.concatenate([pos.view(np.uint32), np.round(nrm * 127).astype(np.int32), rig.astype(np.int32)], 1)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    first = np.zeros(len(uniq), np.int64)
    first[inv[::-1]] = np.arange(len(inv))[::-1]
    entry = dict(id='dog', kind='dog', build='dog', mesh='dog', height=round(fig.height * SCALE, 4), options=[],
                 pivots=[gl(fig.pivots.get(k, fig.pivots[people.B_ROOT])) for k in range(16)],
                 legs=[round(fig.legs[0] * SCALE, 5), round(fig.legs[1] * SCALE, 5)],
                 foot=[round(c * SCALE, 5) for c in fig.foot], hand=gl(fig.hand), tris=len(inv) // 3)
    bm.free()
    return dict(pos=pos[first], nrm=nrm[first], uv=None, rig=rig[first], idx=inv.reshape(-1).astype(np.uint32)), entry


# ---- one person ------------------------------------------------------------------------------------

def make_person(spec, tile, size):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    t0 = time.time()
    parts, rig, _ = H.build_person(spec)
    src = H.assemble(spec, parts, rig)
    piv, legs, foot, hand, height = H.rig_info(spec, rig, src)
    print(f"  {spec['id']}: source {H.tri_count(src)} tris")
    hero = H.decimated(src, HERO_TRIS, spec['id'] + '-hero')
    bone_h, w_h = H.rig_attrs(hero)
    H.atlas_uvs(hero, bone_h)
    maps = H.bake_person(hero, size)
    mask = H.region_mask(hero, size)
    lean = H.decimated(hero, LEAN_TRIS, spec['id'], drop_kinds=('lashes', 'teeth'))
    bone_l, w_l = H.rig_attrs(lean)
    meshes = {hero.name: mesh_arrays(hero, bone_h, w_h, tile), lean.name: mesh_arrays(lean, bone_l, w_l, tile)}
    entry = dict(
        id=spec['id'], kind='person', build=spec['build'], mesh=lean.name, hero=hero.name,
        height=round(height * SCALE, 4), tris=len(meshes[lean.name]['idx']) // 3,
        trisHero=len(meshes[hero.name]['idx']) // 3, trisSource=H.tri_count(src), options=[],
        pivots=[gl(piv.get(k, piv[people.B_ROOT])) for k in range(16)],
        legs=[round(legs[0] * SCALE, 5), round(legs[1] * SCALE, 5)],
        foot=[round(float(c) * SCALE, 5) for c in foot], hand=gl(hand), tile=tile, role=spec['role'],
        mix=spec['mix'], jogger=bool(spec.get('jogger')), skin=spec['skins'], hair=spec['hairs'],
        sex='m' if spec['sex'] > 0.5 else 'f', age=spec['age'],
    )
    os.makedirs(WORK, exist_ok=True)
    np.savez_compressed(os.path.join(WORK, spec['id'] + '.npz'), mask=mask, **maps)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, spec['id'] + '.blend'))
    print(f"  {spec['id']}: hero {entry['trisHero']} lean {entry['tris']} tris, {time.time() - t0:.0f}s")
    return meshes, entry


def fit_height(meshes, e, cm):
    """Scales a person (both meshes and the rig) about the feet to `cm` tall (MakeHuman's macro height
    runs tall: its 0.78 is 2.17 m)."""
    f = cm / 100 * SCALE / e['height']
    if abs(f - 1) < 1e-4:
        return
    for k in (e['mesh'], e['hero']):
        meshes[k]['pos'] = (meshes[k]['pos'] * f).astype(np.float32)
    e['pivots'] = [[round(c * f, 5) for c in p] for p in e['pivots']]
    e['legs'] = [round(c * f, 5) for c in e['legs']]
    e['foot'] = [round(c * f, 5) for c in e['foot']]
    e['hand'] = [round(c * f, 5) for c in e['hand']]
    e['height'] = round(e['height'] * f, 4)


def compose_atlas(entries, size):
    """The tiles into the atlases: tinted regions normalised to a mean of 0.5 (linear)."""
    from PIL import Image
    W, Hh = COLS * size, ROWS * size
    color = np.zeros((Hh, W, 4), np.float32)
    color[..., :3] = 0.5
    orm = np.zeros((Hh, W, 3), np.float32)
    orm[..., 0] = 1
    orm[..., 1] = 0.8
    normal = np.zeros((Hh, W, 3), np.float32)
    normal[..., :] = (0.5, 0.5, 1.0)
    refs = {}
    for e in entries:
        d = np.load(os.path.join(WORK, e['id'] + '.npz'))
        alb, alpha, rough, ao, nrm, mask = (d['albedo'], d['alpha'][..., 0], d['rough'][..., 0], d['ao'][..., 0],
                                            d['normal'], d['mask'])
        out = alb.copy()
        means = {}
        for r in range(7):
            m = (mask == r) & (alpha > 0.5)
            if m.sum() < 16:
                continue
            mean = alb[m].mean(0)
            means[r] = srgb(mean).tolist()
            sel = mask == r
            out[sel] = alb[sel] / np.maximum(mean, 1e-3) * 0.5
        refs[e['id']] = means
        c, r = e['tile'] % COLS, e['tile'] // COLS
        ys = slice(r * size, (r + 1) * size)
        xs = slice(c * size, (c + 1) * size)
        # Blender's pixels run bottom-up; the atlas image runs top-down
        color[ys, xs, :3] = out[::-1]
        color[ys, xs, 3] = alpha[::-1]
        orm[ys, xs, 0] = np.clip(ao[::-1], 0, 1)
        orm[ys, xs, 1] = rough[::-1]
        orm[ys, xs, 2] = 0
        normal[ys, xs] = nrm[::-1]
        e['ref'] = means
    files = {}
    for name, arr, enc in (('atlas-color', color, 'srgb'), ('atlas-orm', orm, None), ('atlas-normal', normal, None)):
        a = arr.copy()
        if enc == 'srgb':
            a[..., :3] = srgb(a[..., :3])
        img = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
        q = 90 if name != 'atlas-orm' else 86
        img.save(os.path.join(OUT, name + '.webp'), quality=q, method=6)
        img.resize((W // 4, Hh // 4), Image.LANCZOS).save(os.path.join(OUT, name + '-low.webp'), quality=q, method=6)
        files[name] = name + '.webp'
    return files


def main():
    size = int(arg('--size', 1024))
    only = arg('--only')
    os.makedirs(OUT, exist_ok=True)
    meshes, entries = {}, []
    todo = [(i, p) for i, p in enumerate(H.PEOPLE) if not only or p['id'] in only.split(',')]
    if '--reexport' in sys.argv:
        todo = []
        only = 'none'
    cache = os.path.join(WORK, 'meshes.npz')
    old = {}
    if only and os.path.exists(cache):
        z = np.load(cache, allow_pickle=True)
        old = z['meshes'].item()
        old_entries = json.loads(str(z['entries']))
    for i, p in todo:
        m, e = make_person(p, i, size)
        meshes.update(m)
        entries.append(e)
    if old:
        for e in old_entries:
            if e['id'] not in [x['id'] for x in entries]:
                entries.append(e)
                for k in (e['mesh'], e['hero']):
                    meshes[k] = old[k]
    entries.sort(key=lambda e: e['tile'])
    import copy
    np.savez_compressed(cache, meshes=np.array(copy.deepcopy(meshes), dtype=object), entries=json.dumps(entries))
    cms = {p['id']: p['cm'] for p in H.PEOPLE}
    for e in entries:
        fit_height(meshes, e, cms[e['id']])
    files = compose_atlas(entries, size)
    dm, de = dog_arrays()
    meshes['dog'] = dm
    heroes = {e['hero'] for e in entries}
    write_glb(os.path.join(OUT, 'humans.glb'), {k: v for k, v in meshes.items() if k not in heroes})
    write_glb(os.path.join(OUT, 'humans-hero.glb'), {k: v for k, v in meshes.items() if k in heroes})
    manifest = dict(scale=SCALE, options=people.OPTIONS, regions=REGIONS, glb='humans.glb', glbHero='humans-hero.glb',
                    atlas=dict(grid=[COLS, ROWS], color=files['atlas-color'], orm=files['atlas-orm'],
                               normal=files['atlas-normal'], low=dict(color='atlas-color-low.webp',
                                                                       orm='atlas-orm-low.webp',
                                                                       normal='atlas-normal-low.webp')),
                    variants=entries + [de])
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print('humans.glb', os.path.getsize(os.path.join(OUT, 'humans.glb')) // 1024, 'KB')
    for e in entries:
        print(f"{e['id']:8s} hero {e['trisHero']:6d}  lean {e['tris']:5d}  source {e['trisSource']:6d}  h {e['height']:.3f}")


if __name__ == '__main__':
    main()
