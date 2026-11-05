"""Builds the birds outside the study window: rock pigeons, starlings and a black-headed gull.

    python blender/make_birds.py [--render DIR] [--debug DIR] && npm run compress:models

Each species is described once in bld/birds.py and built three times (see there): a high-poly
source that never ships, the HIGH tier (body plus every feather as an alpha-tested card) and the
phones' LOW tier (body plus one top and one underside card per wing and for the tail).

Cycles bakes the source onto the shipped meshes:
  HIGH atlas (1024)  the body, beak, eye, feet and wing membrane are baked from the source in
                     place; every feather type (outer and inner primaries, secondaries with and
                     without the wing bar, coverts, alula, rectrices...) from a flat high-poly
                     feather onto its slot, which all the cards of that type share. Maps: colour
                     with the vane's cut-out in alpha, ORM (R occlusion, G roughness, B the neck's
                     iridescence mask) and tangent normals (raised rachis, barbs, body feather tips)
  LOW atlas (512)    the whole feathered wing (spread, from above and from below) onto the wing
                     cards, the fanned tail onto its cards, the body with its eye, scapulars and feet;
                     colour+alpha and ORM, no normal map

Writes public/models/birds/: birds.glb (HIGH), birds-lo.glb (LOW), birds-{color,orm,normal}.webp,
birds-lo-{color,orm}.webp and birds.json (rig pivots, flight parameters, triangle counts).
--render DIR: Cycles renders of the source next to both shipped tiers, per species and view.
--debug DIR: the raw maps as PNGs.
"""
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from bld import birds as B  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'birds')
ORDER = ['pigeon', 'starling', 'gull']
HI_SIZE, LO_SIZE = 1024, 512
PAD = 6


def arg(name):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else None


# ---------------------------------------------------------------------------------------------
# atlas layout


def shelf_pack(items, size, scale):
    """items: (key, w, h) in metres; scale: px per metre. Returns {key: (x, y, w, h)} or None"""
    rects = {}
    x = y = row = 0
    for key, w, h in sorted(items, key=lambda it: -it[2]):
        pw, ph = max(int(w * scale), 8), max(int(h * scale), 8)
        if x + pw + PAD > size:
            x, y, row = 0, y + row + PAD, 0
        if y + ph + PAD > size or pw + PAD > size:
            return None
        rects[key] = (x + PAD // 2, y + PAD // 2, pw, ph)
        x += pw + PAD
        row = max(row, ph)
    return rects


def fit(items, size, weights):
    """largest density that packs; weights scale an item's density (by its key's species)"""
    lo, hi = 100.0, 20000.0
    best = None
    for _ in range(30):
        mid = (lo + hi) / 2
        r = shelf_pack([(k, w * weights(k), h * weights(k)) for k, w, h in items], size, mid)
        if r:
            best, lo = (r, mid), mid
        else:
            hi = mid
    return best


def island_dims(sp, types, key, hi):
    """physical size (w, h) of an island in metres"""
    if key == 'body':
        st = np.array(sp['body'])
        return math.pi * float(np.mean(st[:, 1] + (st[:, 2] + st[:, 3]) / 2)) / 2 * 1.2, st[-1, 0] - st[0, 0]
    if key == 'beak':
        b = sp['beak']
        return math.pi * b['r'] * 1.2, b['y1'] - b['y0']
    if key == 'eye':
        return sp['eye']['r'] * 2.4, sp['eye']['r'] * 2.4
    if key == 'feet':
        return math.pi * sp['feet']['r'], sp['feet']['len']
    if key in ('sheet_top', 'sheet_bot'):
        le = np.array(sp['le'])
        return float(np.linalg.norm(np.diff(le, axis=0), axis=1).sum()), max(sp['chord']) * (1.6 if key == 'sheet_bot' else 1.0)
    if key in ('wing_top', 'wing_bot', 'tail_top', 'tail_bot'):
        bb = hi['lo_bbox'][key.split('_')[0]]
        return bb[2] - bb[0], bb[3] - bb[1]
    ft = types[key]
    return ft.ref * (ft.wo_max + ft.wi_max), ft.ref * 1.03


def to_atlas(geo, rects, prefix, size, bbox=None):
    """map each island's local uv into its atlas rectangle (in place)"""
    uv = geo.a['uv']
    for name, sl in geo.islands:
        x, y, w, h = rects[f'{prefix}:{name}']
        loc = uv[sl].copy()
        if bbox and name in bbox:
            bb = bbox[name]
            loc = (loc - [bb[0], bb[1]]) / [bb[2] - bb[0], bb[3] - bb[1]]
        uv[sl, 0] = (x + loc[:, 0] * w) / size
        uv[sl, 1] = (y + loc[:, 1] * h) / size
    geo.islands = []


# ---------------------------------------------------------------------------------------------
# building the parts


def build_species(name):
    sp = B.SPECIES[name]
    types = sp['types']()
    out = {'sp': sp, 'types': types}
    for tier in ('hi', 'mid'):
        parts = dict(
            body=B.body_geo(sp, tier), beak=B.beak_geo(sp, tier), eye=B.eye_geo(sp, tier),
            feet=B.feet_geo(sp, tier), sheet_top=B.sheet_geo(sp, tier, 1), sheet_bot=B.sheet_geo(sp, tier, -1),
            wing=B.wing_feathers(sp, types, tier), tail=B.tail_feathers(sp, types, tier),
            scap=B.scapulars(sp, types, tier),
        )
        out[tier] = parts
    hs = out['hi']['sheet_top']
    xs, ys = hs.a['uv'][:, 0], hs.a['uv'][:, 1]
    bb = (xs.min(), ys.min(), xs.max(), ys.max())
    out['sheet_bbox'] = bb
    out['lo'] = dict(body=B.body_geo(sp, 'lo'), beak=B.beak_geo(sp, 'lo'))
    out['lo'].update(lo_cards(sp, out['hi']))
    out['lo_bbox'] = {k: out['lo'][k + '_top'].bbox for k in ('wing', 'tail')}
    return out


def lo_cards(sp, hi):
    """the LOW tier's wing and tail: a card on top and one underneath, shaped round the source's
    spread wing / fanned tail, each with its own baked island"""
    out = {}
    wing = B.Geo()
    for k in ('wing', 'sheet_top'):
        wing.extend(hi[k])
    V = wing.v
    S = np.array(sp['S'])
    x0, x1 = S[0] - 0.004, V[:, 0].max() + 0.002
    # span stations bunched at the joints so the shader rig bends the card where the wing bends
    xs = sorted({x0, sp['E'][0], (sp['E'][0] + sp['W'][0]) / 2, sp['W'][0],
                 sp['H'][0], (sp['H'][0] + x1) / 2, x1 - 0.004})
    rows = []
    for x in xs:
        band = V[np.abs(V[:, 0] - x) < max(0.006, (x1 - x0) * 0.03)]
        if len(band) == 0:
            band = V[np.argsort(np.abs(V[:, 0] - x))[:20]]
        le, te = band[:, 1].max() + 0.002, band[:, 1].min() - 0.002
        if x >= xs[-1] - 1e-6:  # the tip: close to a narrow end
            m = (le + te) / 2
            le, te = m + (le - m) * 0.5, m + (te - m) * 0.5
        rows.append((x, le, te, band[:, 2].max() + 0.0015, band[:, 2].min() - 0.0015))
    for side, nm in ((1, 'wing_top'), (-1, 'wing_bot')):
        P, U = [], []
        for x, le, te, zt, zb in rows:
            for c in (0.0, 0.5, 1.0):
                y = le + (te - le) * c
                P.append((x, y, zt if side > 0 else zb))
                U.append((x, y))
        g = B.Geo()
        nu = len(rows)
        thin = np.tile([0.3, 1.0, 1.0], nu)
        xsr = np.repeat([r[0] for r in rows], 3)
        flex = np.clip((xsr - sp['W'][0]) / (x1 - sp['W'][0]), 0, 1) ** 1.5
        g.add(np.array(P), B.grid_faces(nu, 3, flip=(side < 0)), island=nm, uv=np.array(U), part=1,
              thin=thin, flex=flex, occ=1.0)
        uvs = np.array(U)
        g.bbox = (uvs[:, 0].min(), uvs[:, 1].min(), uvs[:, 0].max(), uvs[:, 1].max())
        out[nm] = g
    # tail: a fan from the base out to the tips
    T = hi['tail'].v
    tl = sp['tail']
    ys = np.linspace(tl['y'] + 0.01, T[:, 1].min() - 0.002, 4)
    trow = []
    for y in ys:
        band = T[np.abs(T[:, 1] - y) < 0.01]
        if len(band) == 0:
            band = T[np.argsort(np.abs(T[:, 1] - y))[:20]]
        w = np.abs(band[:, 0]).max() + 0.002
        trow.append((y, w, band[:, 2].max() + 0.0015, band[:, 2].min() - 0.0015))
    for side, nm in ((1, 'tail_top'), (-1, 'tail_bot')):
        P, U = [], []
        for y, w, zt, zb in trow:
            for c in (-1.0, 0.0, 1.0):
                P.append((c * w, y, zt if side > 0 else zb))
                U.append((c * w, y))
        g = B.Geo()
        g.add(np.array(P), B.grid_faces(len(trow), 3, flip=(side > 0)), island=nm, uv=np.array(U), part=2,
              thin=1.0, flex=0.0, occ=1.0)
        uvs = np.array(U)
        g.bbox = (uvs[:, 0].min(), uvs[:, 1].min(), uvs[:, 0].max(), uvs[:, 1].max())
        out[nm] = g
    return out


# ---------------------------------------------------------------------------------------------
# blender objects and materials


def make_object(name, geo, hi_attrs=False, offset=(0, 0, 0), turn=False, collection=None):
    v = geo.v.copy()
    if turn:  # head to -y, so the glTF faces +z
        v[:, 0] *= -1
        v[:, 1] *= -1
    v += np.array(offset)
    me = bpy.data.meshes.new(name)
    me.from_pydata(v.tolist(), [], [list(f) for f in geo.faces])
    me.update()
    me.shade_smooth()
    nl = len(me.loops)
    lv = np.zeros(nl, np.int32)
    me.loops.foreach_get('vertex_index', lv)
    uvl = me.uv_layers.new(name='UVMap')
    uvl.data.foreach_set('uv', geo.a['uv'][lv].astype(np.float32).ravel())
    if hi_attrs:
        ca = me.color_attributes.new('col', 'FLOAT_COLOR', 'POINT')
        rgba = np.concatenate([geo.a['col'], np.ones((len(v), 1))], axis=1).astype(np.float32)
        ca.data.foreach_set('color', rgba.ravel())
        for k in ('rough', 'sheen', 'kind'):
            at = me.attributes.new(k, 'FLOAT', 'POINT')
            at.data.foreach_set('value', geo.a[k][:, 0].astype(np.float32))
        at = me.attributes.new('fs', 'FLOAT2', 'POINT')
        at.data.foreach_set('vector', geo.a['fs'].astype(np.float32).ravel())
    else:
        a = me.attributes.new('_rig', 'FLOAT_VECTOR', 'POINT')
        rig = np.stack([geo.a['part'][:, 0] / 2, geo.a['thin'][:, 0], np.clip(geo.a['flex'][:, 0], 0, 1)], axis=1)
        a.data.foreach_set('vector', rig.astype(np.float32).ravel())
        a = me.attributes.new('_aux', 'FLOAT2', 'POINT')
        aux = np.stack([np.clip(geo.a['occ'][:, 0], 0, 1), np.zeros(len(v))], axis=1)
        a.data.foreach_set('vector', aux.astype(np.float32).ravel())
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def node(nt, kind, loc=(0, 0), **inputs):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, val in inputs.items():
        n.inputs[k].default_value = val
    return n


def hi_material():
    """the source's material: the vertex colours, roughness and sheen, and a bump of barbs on the
    feathers and of overlapping feather tips on the body. An emission branch, off for renders,
    lets the bake read any of them back (SEL: 0 colour, 1 roughness, 2 sheen, 3 white)."""
    mat = bpy.data.materials.new('bird_hi')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    L = nt.links
    col = node(nt, 'ShaderNodeAttribute', (-1400, 300))
    col.attribute_name = 'col'
    rough = node(nt, 'ShaderNodeAttribute', (-1400, 100))
    rough.attribute_name = 'rough'
    sheen = node(nt, 'ShaderNodeAttribute', (-1400, -50))
    sheen.attribute_name = 'sheen'
    kind = node(nt, 'ShaderNodeAttribute', (-1400, -200))
    kind.attribute_name = 'kind'
    fs = node(nt, 'ShaderNodeAttribute', (-1400, -400))
    fs.attribute_name = 'fs'
    sep = node(nt, 'ShaderNodeSeparateXYZ', (-1200, -400))
    L.new(fs.outputs['Vector'], sep.inputs[0])
    ab = node(nt, 'ShaderNodeMath', (-1050, -450))
    ab.operation = 'ABSOLUTE'
    L.new(sep.outputs['Y'], ab.inputs[0])
    m1 = node(nt, 'ShaderNodeMath', (-900, -450))
    m1.operation = 'MULTIPLY_ADD'
    L.new(ab.outputs[0], m1.inputs[0])
    m1.inputs[1].default_value = -1.3
    L.new(sep.outputs['X'], m1.inputs[2])
    m2 = node(nt, 'ShaderNodeMath', (-750, -450))
    m2.operation = 'MULTIPLY'
    L.new(m1.outputs[0], m2.inputs[0])
    m2.inputs[1].default_value = 2 * math.pi / 0.0009
    sn = node(nt, 'ShaderNodeMath', (-600, -450))
    sn.operation = 'SINE'
    L.new(m2.outputs[0], sn.inputs[0])
    barbs = node(nt, 'ShaderNodeMapRange', (-450, -450))
    L.new(sn.outputs[0], barbs.inputs['Value'])
    barbs.inputs['From Min'].default_value = -1
    # body: overlapping feather tips (voronoi cells stretched along the body)
    tc = node(nt, 'ShaderNodeTexCoord', (-1400, -650))
    mp = node(nt, 'ShaderNodeMapping', (-1200, -650))
    mp.inputs['Scale'].default_value = (1.0, 0.7, 1.0)
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    vor = node(nt, 'ShaderNodeTexVoronoi', (-1000, -650))
    vor.inputs['Scale'].default_value = 190.0
    L.new(mp.outputs['Vector'], vor.inputs['Vector'])
    # height: barbs on feathers (kind 1), voronoi on the body (kind 0), smooth on eye/beak (kind 2)
    isf = node(nt, 'ShaderNodeMath', (-450, -250))
    isf.operation = 'COMPARE'
    L.new(kind.outputs['Fac'], isf.inputs[0])
    isf.inputs[1].default_value = 1.0
    isf.inputs[2].default_value = 0.5
    isb = node(nt, 'ShaderNodeMath', (-450, -100))
    isb.operation = 'COMPARE'
    L.new(kind.outputs['Fac'], isb.inputs[0])
    isb.inputs[1].default_value = 0.0
    isb.inputs[2].default_value = 0.5
    h1 = node(nt, 'ShaderNodeMath', (-250, -450))
    h1.operation = 'MULTIPLY'
    L.new(barbs.outputs[0], h1.inputs[0])
    L.new(isf.outputs[0], h1.inputs[1])
    h2 = node(nt, 'ShaderNodeMath', (-250, -650))
    h2.operation = 'MULTIPLY'
    L.new(vor.outputs['Distance'], h2.inputs[0])
    L.new(isb.outputs[0], h2.inputs[1])
    h = node(nt, 'ShaderNodeMath', (-80, -550))
    h.operation = 'ADD'
    L.new(h1.outputs[0], h.inputs[0])
    L.new(h2.outputs[0], h.inputs[1])
    bump = node(nt, 'ShaderNodeBump', (100, -500))
    bump.inputs['Strength'].default_value = 0.6
    bump.inputs['Distance'].default_value = 0.00025
    L.new(h.outputs[0], bump.inputs['Height'])
    # colour detail: darken toward each body feather's edge and in the barbs' grooves; feather
    # undersides paler (Backfacing)
    det = node(nt, 'ShaderNodeMapRange', (-250, 250))
    L.new(h.outputs[0], det.inputs['Value'])
    det.inputs['To Min'].default_value = 0.9
    det.inputs['To Max'].default_value = 1.03
    cmul = node(nt, 'ShaderNodeMix', (-50, 300))
    cmul.data_type = 'RGBA'
    cmul.blend_type = 'MULTIPLY'
    cmul.inputs['Factor'].default_value = 1.0
    L.new(col.outputs['Color'], cmul.inputs['A'])
    L.new(det.outputs[0], cmul.inputs['B'])
    geom = node(nt, 'ShaderNodeNewGeometry', (-250, 500))
    back = node(nt, 'ShaderNodeMath', (-50, 500))
    back.operation = 'MULTIPLY'
    L.new(geom.outputs['Backfacing'], back.inputs[0])
    L.new(isf.outputs[0], back.inputs[1])
    bw = node(nt, 'ShaderNodeRGBToBW', (-50, 650))
    L.new(cmul.outputs['Result'], bw.inputs[0])
    pale = node(nt, 'ShaderNodeMath', (100, 650))
    pale.operation = 'MULTIPLY'
    L.new(bw.outputs[0], pale.inputs[0])
    pale.inputs[1].default_value = 1.25
    cfin = node(nt, 'ShaderNodeMix', (250, 400))
    cfin.data_type = 'RGBA'
    L.new(back.outputs[0], cfin.inputs['Factor'])
    L.new(cmul.outputs['Result'], cfin.inputs['A'])
    L.new(pale.outputs[0], cfin.inputs['B'])
    # the backfacing mix only goes half way
    bh = node(nt, 'ShaderNodeMath', (100, 500))
    bh.operation = 'MULTIPLY'
    L.new(back.outputs[0], bh.inputs[0])
    bh.inputs[1].default_value = 0.4
    L.new(bh.outputs[0], cfin.inputs['Factor'])
    bsdf = node(nt, 'ShaderNodeBsdfPrincipled', (500, 200))
    L.new(cfin.outputs['Result'], bsdf.inputs['Base Color'])
    L.new(rough.outputs['Fac'], bsdf.inputs['Roughness'])
    L.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    # a touch of sheen-driven gloss and subsurface on thin parts is left to the runtime shader
    # emission readout
    sel = node(nt, 'ShaderNodeValue', (100, -50))
    sel.name = sel.label = 'SEL'
    estr = node(nt, 'ShaderNodeValue', (100, -150))
    estr.name = estr.label = 'ESTR'
    estr.outputs[0].default_value = 0.0

    def is_(k, loc):
        c = node(nt, 'ShaderNodeMath', loc)
        c.operation = 'COMPARE'
        L.new(sel.outputs[0], c.inputs[0])
        c.inputs[1].default_value = k
        c.inputs[2].default_value = 0.5
        return c

    mx1 = node(nt, 'ShaderNodeMix', (500, -100))
    mx1.data_type = 'RGBA'
    L.new(is_(1, (300, -100)).outputs[0], mx1.inputs['Factor'])
    L.new(cfin.outputs['Result'], mx1.inputs['A'])
    L.new(rough.outputs['Fac'], mx1.inputs['B'])
    mx2 = node(nt, 'ShaderNodeMix', (650, -150))
    mx2.data_type = 'RGBA'
    L.new(is_(2, (300, -250)).outputs[0], mx2.inputs['Factor'])
    L.new(mx1.outputs['Result'], mx2.inputs['A'])
    L.new(sheen.outputs['Fac'], mx2.inputs['B'])
    mx3 = node(nt, 'ShaderNodeMix', (800, -200))
    mx3.data_type = 'RGBA'
    L.new(is_(3, (300, -400)).outputs[0], mx3.inputs['Factor'])
    L.new(mx2.outputs['Result'], mx3.inputs['A'])
    mx3.inputs['B'].default_value = (1, 1, 1, 1)
    em = node(nt, 'ShaderNodeEmission', (950, -200))
    L.new(mx3.outputs['Result'], em.inputs['Color'])
    L.new(estr.outputs[0], em.inputs['Strength'])
    add = node(nt, 'ShaderNodeAddShader', (1100, 100))
    L.new(bsdf.outputs[0], add.inputs[0])
    L.new(em.outputs[0], add.inputs[1])
    outn = node(nt, 'ShaderNodeOutputMaterial', (1300, 100))
    L.new(add.outputs[0], outn.inputs['Surface'])
    return mat


def shipped_material(name, color_png, orm_png, normal_png=None):
    """the shipped meshes in Cycles, from the baked maps (for the before/after renders)"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    L = nt.links
    bsdf = node(nt, 'ShaderNodeBsdfPrincipled', (300, 0))
    ci = node(nt, 'ShaderNodeTexImage', (-400, 200))
    ci.image = bpy.data.images.load(color_png)
    oi = node(nt, 'ShaderNodeTexImage', (-400, -100))
    oi.image = bpy.data.images.load(orm_png)
    oi.image.colorspace_settings.name = 'Non-Color'
    sep = node(nt, 'ShaderNodeSeparateColor', (-100, -100))
    L.new(oi.outputs['Color'], sep.inputs[0])
    mul = node(nt, 'ShaderNodeMix', (0, 250))
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    L.new(ci.outputs['Color'], mul.inputs['A'])
    L.new(sep.outputs['Red'], mul.inputs['B'])
    L.new(mul.outputs['Result'], bsdf.inputs['Base Color'])
    L.new(ci.outputs['Alpha'], bsdf.inputs['Alpha'])
    L.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    if normal_png:
        ni = node(nt, 'ShaderNodeTexImage', (-400, -400))
        ni.image = bpy.data.images.load(normal_png)
        ni.image.colorspace_settings.name = 'Non-Color'
        nm = node(nt, 'ShaderNodeNormalMap', (0, -400))
        L.new(ni.outputs['Color'], nm.inputs['Color'])
        L.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    out = node(nt, 'ShaderNodeOutputMaterial', (600, 0))
    L.new(bsdf.outputs[0], out.inputs['Surface'])
    return mat


# ---------------------------------------------------------------------------------------------
# baking


def new_image(name, size):
    img = bpy.data.images.new(name, size, size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.zeros(size * size * 4, np.float32))
    return img


def img_array(img):
    a = np.zeros(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)[::-1]  # top row first


def bake_set(target, sources, hi_mat, size, extrusion, ray, passes):
    """bake every pass of `sources` onto `target`'s UVs; returns {pass: HxWx4 array}"""
    scene = bpy.context.scene
    tmat = bpy.data.materials.new('bake_target')
    tmat.use_nodes = True
    tn = tmat.node_tree
    tn.nodes.clear()
    tex = tn.nodes.new('ShaderNodeTexImage')
    tn.nodes.active = tex
    target.data.materials.clear()
    target.data.materials.append(tmat)
    for o in (target,):
        o.visible_camera = o.visible_diffuse = o.visible_glossy = o.visible_shadow = False
        o.visible_transmission = o.visible_volume_scatter = False
    bpy.ops.object.select_all(action='DESELECT')
    for s in sources:
        s.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    sel = hi_mat.node_tree.nodes['SEL'].outputs[0]
    estr = hi_mat.node_tree.nodes['ESTR'].outputs[0]
    out = {}
    for p in passes:
        img = new_image(f'{target.name}.{p}', size)
        tex.image = img
        t0 = time.time()
        if p in ('color', 'rough', 'sheen', 'mask'):
            sel.default_value = dict(color=0, rough=1, sheen=2, mask=3)[p]
            estr.default_value = 1.0
            scene.cycles.samples = 4
            btype = 'EMIT'
        elif p == 'normal':
            estr.default_value = 0.0
            scene.cycles.samples = 4
            btype = 'NORMAL'
        else:
            estr.default_value = 0.0
            scene.cycles.samples = 48
            btype = 'AO'
        bpy.ops.object.bake(type=btype, use_selected_to_active=True, cage_extrusion=extrusion,
                            max_ray_distance=ray, margin=0 if p == 'mask' else 3, margin_type='EXTEND',
                            use_clear=False, normal_space='TANGENT', target='IMAGE_TEXTURES')
        out[p] = img_array(img)
        print(f'  bake {target.name} {p} {time.time() - t0:.1f}s', flush=True)
    estr.default_value = 0.0
    return out


def dilate(rgb, alpha, iters=10):
    """push the colour of covered texels out into the transparent ones (so mips don't fringe)"""
    rgb = rgb.copy()
    have = alpha > 0.5
    for _ in range(iters):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(alpha.shape)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            m = np.roll(np.roll(have, dy, 0), dx, 1)
            acc += np.roll(np.roll(rgb, dy, 0), dx, 1) * m[..., None]
            cnt += m
        grow = (~have) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        have = have | grow
    return rgb


def to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)


def save_maps(maps, cut_rects, size, stem, normal, debug):
    """colour (+alpha), ORM and optionally the normal map; alpha = the bake's mask inside the
    rectangles that are cut out (feathers, LOW wing/tail cards), solid elsewhere"""
    mask = maps['mask'][..., 0]
    alpha = np.zeros((size, size))
    solid = np.ones((size, size), bool)
    for (x, y, w, h) in cut_rects:
        yy0 = size - (y + h)  # image rows are top-first, rects are uv-space (bottom-first)
        solid[yy0:yy0 + h, x:x + w] = False
    alpha = np.where(solid, 1.0, np.clip((mask - 0.25) / 0.5, 0, 1))
    filled = maps['mask'][..., 3] > 0  # anything written
    alpha = np.where(solid & ~filled, 0.0, alpha)
    # baked pixels the margin wrote outside islands are opaque in the 'solid' area, fine
    col = dilate(maps['color'][..., :3], alpha)
    # occlusion floors at 0.5: the feet and the wing roots sit in the body's shadow, but they are
    # lit by the sky around them in flight (the wings move, the rest pose is only one moment)
    orm = np.stack([np.maximum(maps['ao'][..., 0], 0.5), maps['rough'][..., 0], maps['sheen'][..., 0]], axis=-1)
    orm = dilate(orm, alpha)
    orm[..., 0] = np.where(alpha > 0, orm[..., 0], 1.0) if False else orm[..., 0]
    rgba = np.concatenate([to_srgb(col), alpha[..., None]], axis=-1)
    paths = {}
    im = Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA')
    p = os.path.join(OUT, f'{stem}-color.webp')
    im.save(p, 'WEBP', quality=90, method=6, exact=True)
    paths['color'] = p
    im2 = Image.fromarray((np.clip(orm, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB')
    p = os.path.join(OUT, f'{stem}-orm.webp')
    im2.save(p, 'WEBP', quality=90, method=6)
    paths['orm'] = p
    if normal:
        n = dilate(maps['normal'][..., :3], np.where(maps['normal'][..., 3] > 0, 1.0, 0.0) * (alpha > 0.01))
        n = np.where((maps['normal'][..., 3] > 0)[..., None] | (alpha[..., None] > 0), n, [0.5, 0.5, 1.0])
        im3 = Image.fromarray((np.clip(n, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB')
        p = os.path.join(OUT, f'{stem}-normal.webp')
        im3.save(p, 'WEBP', quality=92, method=6)
        paths['normal'] = p
    if debug:
        os.makedirs(debug, exist_ok=True)
        im.save(os.path.join(debug, f'{stem}-color.png'))
        im2.save(os.path.join(debug, f'{stem}-orm.png'))
        if normal:
            im3.save(os.path.join(debug, f'{stem}-normal.png'))
        Image.fromarray((np.clip(mask, 0, 1) * 255).astype(np.uint8)).save(os.path.join(debug, f'{stem}-mask.png'))
    # png copies for the Cycles comparison renders
    tmp = {}
    for k, path in paths.items():
        q = os.path.join(bpy.app.tempdir or '/tmp', f'{stem}-{k}.png')
        Image.open(path).save(q)
        tmp[k] = q
    return paths, tmp


# ---------------------------------------------------------------------------------------------


def source_tris(hi):
    return sum(g.tris() * (2 if k in ('eye', 'feet', 'sheet_top', 'sheet_bot', 'wing', 'scap') else 1) for k, g in hi.items())


def joined(parts, keys, mirror=()):
    g = B.Geo()
    for k in keys:
        g.extend(parts[k])
        if k in mirror:
            g.extend(parts[k].mirrored())
    return g


def main():
    render_dir, debug = arg('--render'), arg('--debug')
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.use_denoising = False
    world = bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.6, 0.65, 0.75, 1)
    world.light_settings.distance = 0.03
    hi_mat = hi_material()

    data = {n: build_species(n) for n in ORDER}

    # ---- HIGH atlas layout: per species body, beak, eye, feet, membrane top/underside, one slot per feather type
    items = []
    for n in ORDER:
        d = data[n]
        for k in ('body', 'beak', 'eye', 'feet', 'sheet_top', 'sheet_bot'):
            items.append((f'{n}:{k}', *island_dims(d['sp'], d['types'], k, d)))
        for k in d['types']:
            items.append((f'{n}:{k}', *island_dims(d['sp'], d['types'], k, d)))
    # the small birds get more texels per metre (they're the ones seen close), the eye and beak too
    wt = lambda k: (1.5 if k.startswith('starling') else 0.8 if k.startswith('gull') else 1.0) * \
        (2.0 if k.endswith((':eye', ':beak')) else 0.6 if ':sheet' in k else 1.0)  # noqa: E731
    hi_rects, dens = fit(items, HI_SIZE, wt)
    print(f'HIGH atlas: {dens:.0f} px/m')
    # ---- LOW atlas: body, beak, wing and tail cards
    items = []
    for n in ORDER:
        d = data[n]
        for k in ('body', 'beak', 'wing_top', 'wing_bot', 'tail_top', 'tail_bot'):
            items.append((f'{n}:{k}', *island_dims(d['sp'], d['types'], k, d)))
    lo_rects, dens_lo = fit(items, LO_SIZE, lambda k: 1.4 if k.startswith('starling') else 1.0)
    print(f'LOW atlas: {dens_lo:.0f} px/m')

    # ---- map uvs, build the bake scene
    hi_sources, hi_targets, lo_sources, lo_targets = [], [], [], []
    hi_sources2, hi_targets2 = [], []
    shipped = {}
    for si, n in enumerate(ORDER):
        d = data[n]
        off = (si * 1.5, 0, 0)
        bbox = {}
        mid, hi, lo = d['mid'], d['hi'], d['lo']
        for k, g in mid.items():
            to_atlas(g, hi_rects, n, HI_SIZE, bbox)
        # bake targets: one of each unique island, in place
        tgt = joined(mid, ['body', 'beak', 'eye', 'feet'])
        # sources: the source's body parts (both sides) and, as occluders only, its feathers
        src = joined(hi, ['body', 'beak', 'eye', 'feet'], mirror=('eye', 'feet'))
        # the wing membrane goes with the feather slots (its root is inside the body)
        tgt2 = joined(mid, ['sheet_top', 'sheet_bot'])
        src2 = joined(hi, ['sheet_top', 'sheet_bot'], mirror=('sheet_top', 'sheet_bot'))
        occl = joined(hi, ['wing', 'tail', 'scap'], mirror=('wing', 'scap'))
        # the feather slots: flat source feathers, flat slot quads under them, in a row at z = -1
        protos_hi, protos_mid = B.Geo(), B.Geo()
        x = 0.0
        for k, ft in d['types'].items():
            ph, pm = B.prototype(ft, True), B.prototype(ft, False)
            to_atlas(pm, hi_rects, n, HI_SIZE)
            dx = ft.ref * ft.wo_max + x
            ph.v += [dx, 0, -1.0]
            pm.v += [dx, 0, -1.0]
            x = dx + ft.ref * ft.wi_max + 0.05
            protos_hi.extend(ph)
            protos_mid.extend(pm)
        tgt2.extend(protos_mid)
        src2.extend(protos_hi)
        hi_targets.append(make_object(f'{n}.bake_tgt', tgt, offset=off))
        hi_targets2.append(make_object(f'{n}.bake_tgt2', tgt2, offset=off))
        so = make_object(f'{n}.src', src, hi_attrs=True, offset=off)
        so.data.materials.append(hi_mat)
        hi_sources.append(so)
        so2 = make_object(f'{n}.src2', src2, hi_attrs=True, offset=off)
        so2.data.materials.append(hi_mat)
        hi_sources2.append(so2)
        oc = make_object(f'{n}.src_feathers', occl, hi_attrs=True, offset=off)
        oc.data.materials.append(hi_mat)
        lo_sources.append(oc)
        # LOW: targets are its own islands, sources the whole source bird
        for k, g in lo.items():
            to_atlas(g, lo_rects, n, LO_SIZE, {kk: lo[kk].bbox for kk in ('wing_top', 'wing_bot', 'tail_top', 'tail_bot')})
        lo_targets.append(make_object(f'{n}.lo_tgt', joined(lo, ['body', 'beak', 'wing_top', 'wing_bot', 'tail_top', 'tail_bot']), offset=off))
        shipped[n] = dict(
            mid=joined(mid, ['body', 'beak', 'eye', 'feet', 'sheet_top', 'sheet_bot', 'wing', 'tail', 'scap'],
                       mirror=('eye', 'feet', 'sheet_top', 'sheet_bot', 'wing', 'scap')),
            lo=joined(lo, ['body', 'beak', 'wing_top', 'wing_bot', 'tail_top', 'tail_bot'], mirror=('wing_top', 'wing_bot')),
        )
    # fold all species into one target per atlas
    def join_objs(objs, name):
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        objs[0].name = name
        return objs[0]

    hi_t = join_objs(hi_targets, 'hi_target')
    hi_t2 = join_objs(hi_targets2, 'hi_target2')
    lo_t = join_objs(lo_targets, 'lo_target')
    lo_t.hide_render = False

    t0 = time.time()
    lo_t.hide_set(True)
    lo_t.hide_render = True
    passes = ['mask', 'color', 'rough', 'sheen', 'normal', 'ao']
    hi_t2.hide_set(True)
    hi_t2.hide_render = True
    maps_hi = bake_set(hi_t, hi_sources, hi_mat, HI_SIZE, 0.006, 0.02, passes)
    hi_t2.hide_set(False)
    hi_t2.hide_render = False
    hi_t.hide_set(True)
    hi_t.hide_render = True
    maps2 = bake_set(hi_t2, hi_sources2, hi_mat, HI_SIZE, 0.004, 0.012, passes)
    # the membrane's root sits inside the body: don't let that darken its occlusion
    maps2['ao'][..., :3] = np.maximum(maps2['ao'][..., :3], 0.6)
    for p in passes:  # the two bakes write disjoint islands (alpha marks what each wrote)
        w = maps2[p][..., 3:4] > 0
        maps_hi[p] = np.where(w, maps2[p], maps_hi[p])
    hi_t2.hide_set(True)
    hi_t2.hide_render = True
    lo_t.hide_set(False)
    lo_t.hide_render = False
    hi_t.hide_set(True)
    hi_t.hide_render = True
    maps_lo = bake_set(lo_t, hi_sources + lo_sources, hi_mat, LO_SIZE, 0.012, 0.04,
                       ['mask', 'color', 'rough', 'sheen', 'ao'])
    print(f'bakes {time.time() - t0:.0f}s')

    cut_hi = [hi_rects[f'{n}:{k}'] for n in ORDER for k in data[n]['types']]
    cut_lo = [lo_rects[f'{n}:{k}'] for n in ORDER for k in ('wing_top', 'wing_bot', 'tail_top', 'tail_bot')]
    paths_hi, png_hi = save_maps(maps_hi, cut_hi, HI_SIZE, 'birds', True, debug)
    paths_lo, png_lo = save_maps(maps_lo, cut_lo, LO_SIZE, 'birds-lo', False, debug)

    # ---- export the shipped tiers
    manifest = {'species': {}, 'files': {
        'glb': 'birds.glb', 'glbLo': 'birds-lo.glb',
        'color': 'birds-color.webp', 'orm': 'birds-orm.webp', 'normal': 'birds-normal.webp',
        'colorLo': 'birds-lo-color.webp', 'ormLo': 'birds-lo-orm.webp'}}
    coll = bpy.data.collections.new('ship')
    scene.collection.children.link(coll)
    for tier, fname in (('mid', 'birds.glb'), ('lo', 'birds-lo.glb')):
        objs = []
        for n in ORDER:
            objs.append(make_object(n, shipped[n][tier], turn=True, collection=coll))
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        path = os.path.join(OUT, fname)
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=True, export_apply=False,
            export_materials='NONE', export_normals=True, export_yup=True, export_attributes=True,
            export_texcoords=True, export_vertex_color='NONE', export_cameras=False, export_lights=False,
        )
        for o in objs:
            o.name = f'{o.name}.{tier}'
            o.data.name = o.name
        print(f'{fname} {os.path.getsize(path) // 1024} KB')
    for n in ORDER:
        sp = data[n]['sp']
        t3 = lambda p: [round(abs(p[0]), 4), round(p[2], 4), round(p[1], 4)]  # noqa: E731
        manifest['species'][n] = dict(
            shoulder=t3(sp['S']), elbow=t3(sp['E']), wrist=t3(sp['W']),
            tail=[0, round(sp['tail']['z'], 4), round(sp['tail']['y'], 4)],
            flap=sp['flap'],
            tris=shipped[n]['mid'].tris(), trisLo=shipped[n]['lo'].tris(),
            span=round(2 * float(np.abs(shipped[n]['mid'].v[:, 0]).max()), 3),
        )
        print(f"{n:9s} HIGH {shipped[n]['mid'].tris():5d} tris  LOW {shipped[n]['lo'].tris():4d} tris  "
              f"source {source_tris(data[n]['hi']):6d} tris")
    with open(os.path.join(OUT, 'birds.json'), 'w') as f:
        json.dump(manifest, f, indent=1)

    if render_dir:
        render(render_dir, data, shipped, hi_mat, png_hi, png_lo)


def render(out_dir, data, shipped, hi_mat, png_hi, png_lo):
    """Cycles: the source next to the HIGH and LOW tiers, for each species, from the side
    (wings raised a little, so both surfaces show), from above and from below"""
    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    for o in list(scene.objects):
        o.hide_render = True
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 520, 360
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX' if 'AgX' in [v.identifier for v in scene.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.data.color = (1.0, 0.86, 0.68)
    sun.rotation_euler = (math.radians(55), 0, math.radians(35))
    scene.collection.objects.link(sun)
    world = scene.world
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.42, 0.5, 0.62, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 85
    scene.collection.objects.link(cam)
    scene.camera = cam
    mat_hi = shipped_material('ship_hi', png_hi['color'], png_hi['orm'], png_hi['normal'])
    mat_lo = shipped_material('ship_lo', png_lo['color'], png_lo['orm'])
    # the LOW tier draws front faces only (its wing and tail cards are back to back): same in Cycles
    nt = mat_lo.node_tree
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mx = nt.nodes.new('ShaderNodeMixShader')
    outn = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
    bs = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
    nt.links.new(geo.outputs['Backfacing'], mx.inputs[0])
    nt.links.new(bs.outputs[0], mx.inputs[1])
    nt.links.new(tr.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], outn.inputs['Surface'])
    files = []
    for n in ORDER:
        d = data[n]
        src = joined(d['hi'], ['body', 'beak', 'eye', 'feet', 'sheet_top', 'sheet_bot', 'wing', 'tail', 'scap'],
                     mirror=('eye', 'feet', 'sheet_top', 'sheet_bot', 'wing', 'scap'))
        objs = {
            'source': make_object(f'{n}.r_src', src, hi_attrs=True),
            'HIGH': make_object(f'{n}.r_mid', shipped[n]['mid']),
            'LOW': make_object(f'{n}.r_lo', shipped[n]['lo']),
        }
        objs['source'].data.materials.append(hi_mat)
        objs['HIGH'].data.materials.append(mat_hi)
        objs['LOW'].data.materials.append(mat_lo)
        tris = {'source': src.tris(), 'HIGH': shipped[n]['mid'].tris(), 'LOW': shipped[n]['lo'].tris()}
        span = float(np.abs(src.v[:, 0]).max()) * 2
        for view, (dirv, upz) in {'side': ((0.75, -0.55, 0.32), 1), 'above': ((0.15, -0.35, 1.0), 1),
                                  'below': ((0.25, -0.45, -1.0), 1)}.items():
            dv = np.array(dirv) / np.linalg.norm(dirv)
            dist = span * 1.75
            target = np.array([0, 0.0, 0.0])
            cam.location = (target + dv * dist).tolist()
            look = target - cam.location
            from mathutils import Vector
            cam.rotation_euler = Vector(look.tolist()).to_track_quat('-Z', 'Y').to_euler()
            for label, ob in objs.items():
                for o in objs.values():
                    o.hide_render = o is not ob
                p = os.path.join(out_dir, f'{n}-{view}-{label}.png')
                scene.render.filepath = p
                bpy.ops.render.render(write_still=True)
                files.append((n, view, label, p, tris[label]))
                print('render', p, flush=True)
        for o in objs.values():
            o.hide_render = True
    # contact sheets: rows = species x view, columns = source | HIGH | LOW
    from PIL import ImageDraw
    W, H = 520, 360
    for view in ('side', 'above', 'below'):
        sheet = Image.new('RGB', (W * 3, H * len(ORDER)), (20, 20, 24))
        dr = ImageDraw.Draw(sheet)
        for r, n in enumerate(ORDER):
            for c, label in enumerate(('source', 'HIGH', 'LOW')):
                f = [x for x in files if x[0] == n and x[1] == view and x[2] == label][0]
                sheet.paste(Image.open(f[3]).convert('RGB'), (c * W, r * H))
                dr.text((c * W + 8, r * H + 6), f'{n} {label}: {f[4]} tris', fill=(255, 255, 255))
        sheet.save(os.path.join(out_dir, f'compare-{view}.png'))


main()
