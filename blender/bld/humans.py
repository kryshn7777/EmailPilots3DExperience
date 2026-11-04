"""Humans: the pedestrians of the town and the night city, built from MakeHuman (CC0) through MPFB2.

Each base person is a MakeHuman body shaped by MPFB2's macro targets (sex, age, weight, muscle,
height, proportions, ethnicity) and a few face targets of its own (nose, chin, brow, cheeks, ears),
dressed in MakeHuman system clothes, hair, eyebrows, eyelashes and eyes, all fitted to the body by
MPFB's proxy binding. The game-engine rig MPFB adds is used twice: to put the arms down from the
A pose (and curl the fingers a little), then to give every vertex the one bone and weight the
runtime's shader rig needs (see `rig_attrs`); the rig itself never ships.

The person is then one mesh with two UV maps: `orig` (the MakeHuman layouts its textures are
painted on) and `atlas` (its own tile of the shared atlas: islands at an even texel density, the
face and hands enlarged). Cycles bakes every material, the MakeHuman textures plus a procedural
layer of pores, freckles, weave and wear, from `orig` onto `atlas` on the same mesh (no rays
between meshes, so nothing is lost but resolution): albedo, alpha, roughness, ambient occlusion,
tangent normals. The tiers are decimations of that mesh that keep the atlas UVs, so they all draw
from the one atlas (and the phones' half... quarter-size copy of it).

Everything is in metres, the figure facing +x on z = 0 (as bld/people.py), ready for the same
_RIG packing and the same shader.
"""
import importlib
import json
import math
import os

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Quaternion, Vector

from .people import (B_BAG, B_CHEST, B_FARM_L, B_FARM_R, B_FOOT_L, B_FOOT_R, B_HEAD, B_ROOT, B_SHIN_L,
                     B_SHIN_R, B_SKIRT, B_THIGH_L, B_THIGH_R, B_UARM_L, B_UARM_R, R_ACC, R_BOTTOM, R_DARK,
                     R_HAIR, R_SHOES, R_SKIN, R_TOP, R_UNDER)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.environ.get('MH_CACHE', os.path.join(ROOT, 'blender', 'cache', 'makehuman'))
MPFB_SRC = os.path.join(CACHE, 'mpfb2', 'src', 'mpfb')
SYS = os.path.join(CACHE, 'makehuman_system_assets')

# ---- the shader rig's bones, from the game-engine rig's ------------------------------------------
# parents: ROOT <- CHEST <- HEAD, CHEST <- UARM <- FARM, ROOT <- THIGH <- SHIN <- FOOT
PARENT = {B_ROOT: None, B_CHEST: B_ROOT, B_HEAD: B_CHEST, B_UARM_L: B_CHEST, B_FARM_L: B_UARM_L,
          B_UARM_R: B_CHEST, B_FARM_R: B_UARM_R, B_THIGH_L: B_ROOT, B_SHIN_L: B_THIGH_L,
          B_FOOT_L: B_SHIN_L, B_THIGH_R: B_ROOT, B_SHIN_R: B_THIGH_R, B_FOOT_R: B_SHIN_R}
DEPTH = {}
for _b in PARENT:
    d, p = 0, _b
    while PARENT[p] is not None:
        d, p = d + 1, PARENT[p]
    DEPTH[_b] = d


def _ge_map(name):
    """A game-engine bone -> [(shader bone, share)]."""
    side = name[-2:]
    L = side == '_l'
    if name in ('Root', 'pelvis'):
        return [(B_ROOT, 1.0)]
    if name == 'spine_01':
        return [(B_ROOT, 0.55), (B_CHEST, 0.45)]
    if name in ('spine_02', 'spine_03') or name.startswith('clavicle'):
        return [(B_CHEST, 1.0)]
    if name == 'neck_01':
        return [(B_CHEST, 0.45), (B_HEAD, 0.55)]
    if name == 'head':
        return [(B_HEAD, 1.0)]
    if name.startswith('upperarm'):
        return [(B_UARM_L if L else B_UARM_R, 1.0)]
    if name.startswith(('lowerarm', 'hand', 'index', 'middle', 'ring', 'pinky', 'thumb')):
        return [(B_FARM_L if L else B_FARM_R, 1.0)]
    if name.startswith('thigh'):
        return [(B_THIGH_L if L else B_THIGH_R, 1.0)]
    if name.startswith('calf'):
        return [(B_SHIN_L if L else B_SHIN_R, 1.0)]
    if name.startswith(('foot', 'ball')):
        return [(B_FOOT_L if L else B_FOOT_R, 1.0)]
    return None


# ---- the people ------------------------------------------------------------------------------------
# age in years (MakeHuman's 0..1: 25 years at 0.5, 90 at 1); race = (asian, caucasian, african);
# wear = MakeHuman clothes, each with the region of each of its pieces (largest piece first;
# missing entries: the last one repeats); cm = standing height (MakeHuman's own runs tall, the
# figure is scaled to it); face = extra targets (name: weight) for a face of its own.
# role / mix steer the runtime's palettes and how common each person is in the town (day) and the
# night city; skin / hair: the tints a crowd draws them in (near the person's own).
PEOPLE = [
    dict(id='ethan', cm=182, sex=1.0, age=29, race=(0.05, 0.9, 0.05), weight=0.5, muscle=0.6, height=0.6, prop=0.7,
         skin='young_caucasian_male', hair='short02', brows='eyebrow001', lashes='eyelashes01', eyes='bluegreen',
         wear=[('male_casualsuit05', [R_TOP, R_BOTTOM, R_UNDER, R_UNDER])], shoes='shoes01',
         face={'nose/nose-scale-vert-incr': 0.3, 'chin/chin-prominent-incr': 0.4, 'head/head-square': 0.3},
         role='jacket', mix=dict(day=1.6, night=2.6), build='man',
         skins=['#e9bfa0', '#e3b08e', '#d9a07c'], hairs=['#3b291c', '#4f3524', '#2a1c14', '#6a4a2e']),
    dict(id='marcus', cm=179, sex=1.0, age=52, race=(0.0, 0.1, 0.9), weight=0.68, muscle=0.55, height=0.55, prop=0.5,
         skin='middleage_african_male', hair='short04', brows='eyebrow004', lashes='eyelashes02', eyes='brown',
         wear=[('male_elegantsuit01', [R_TOP, R_BOTTOM])], shoes='shoes02',
         face={'nose/nose-scale-horiz-incr': 0.35, 'mouth/mouth-scale-horiz-incr': 0.3, 'eyebrows/eyebrows-trans-down': 0.3},
         role='suit', mix=dict(day=0.5, night=2.4), build='man',
         skins=['#6e4329', '#5b3624', '#7a4b2f'], hairs=['#1b1512', '#3a3632', '#8f8a84']),
    dict(id='mei', cm=161, sex=0.0, age=24, race=(0.92, 0.08, 0.0), weight=0.38, muscle=0.4, height=0.42, prop=0.7,
         skin='young_asian_female', hair='bob01', brows='eyebrow010', lashes='eyelashes03', eyes='brown',
         wear=[('female_casualsuit01', [R_TOP, R_BOTTOM])], shoes='shoes05',
         face={'chin/chin-height-decr': 0.2, 'nose/nose-scale-depth-decr': 0.2},
         role='casual', mix=dict(day=2.6, night=1.4), build='woman',
         skins=['#ecc9aa', '#e2b893', '#f0d2b8'], hairs=['#121212', '#1b1512', '#2a1c14']),
    dict(id='claire', cm=168, sex=0.0, age=41, race=(0.0, 1.0, 0.0), weight=0.5, muscle=0.45, height=0.55, prop=0.65,
         skin='middleage_caucasian_female', hair='long01', brows='eyebrow002', lashes='eyelashes04', eyes='blue',
         wear=[('female_elegantsuit01', [R_TOP, R_BOTTOM])], shoes='shoes03',
         face={'nose/nose-hump-incr': 0.3, 'cheek/l-cheek-bones-incr': 0.3, 'cheek/r-cheek-bones-incr': 0.3},
         role='dress', mix=dict(day=1.8, night=2.4), build='woman',
         skins=['#f1d2bd', '#eac3a6', '#f6dccb'], hairs=['#8c6a43', '#b8925c', '#6a4a2e', '#d6bb83']),
    dict(id='kwame', cm=188, sex=1.0, age=23, race=(0.0, 0.0, 1.0), weight=0.4, muscle=0.62, height=0.78, prop=0.8,
         skin='young_african_male', hair='afro01', brows='eyebrow005', lashes='eyelashes01', eyes='brown',
         wear=[('male_casualsuit06', [R_TOP, R_BOTTOM])], shoes='shoes06',
         face={'nose/nose-flaring-incr': 0.3, 'mouth/mouth-lowerlip-volume-incr': 0.3},
         role='casual', mix=dict(day=2.2, night=1.4), build='man',
         skins=['#553222', '#4a2c1e', '#61392a'], hairs=['#121212', '#1b1512']),
    dict(id='rosa', cm=157, sex=0.0, age=67, race=(0.05, 0.75, 0.2), weight=0.72, muscle=0.3, height=0.3, prop=0.35,
         skin='old_caucasian_female', hair='bob02', brows='eyebrow007', lashes='eyelashes02', eyes='brownlight',
         wear=[('female_elegantsuit01', [R_TOP, R_BOTTOM])], shoes='shoes02',
         face={'nose/nose-scale-vert-incr': 0.2, 'chin/chin-width-incr': 0.3},
         role='coat', mix=dict(day=1.2, night=1.6), build='woman',
         skins=['#e0b394', '#d6a583', '#e8c1a5'], hairs=['#c9c5bf', '#8f8a84', '#e3dfd8', '#b5aca3']),
    dict(id='hiro', cm=166, sex=1.0, age=71, race=(0.95, 0.05, 0.0), weight=0.42, muscle=0.35, height=0.38, prop=0.45,
         skin='old_asian_male', hair='short04', brows='eyebrow008', lashes='eyelashes01', eyes='brown',
         wear=[('male_casualsuit03', [R_TOP, R_BOTTOM])], shoes='shoes01',
         face={'ears/r-ear-scale-incr': 0.3, 'ears/l-ear-scale-incr': 0.3, 'nose/nose-scale-depth-incr': 0.2},
         role='jacket', mix=dict(day=1.2, night=1.2), build='man',
         skins=['#e3bb95', '#d6aa83', '#eac7a4'], hairs=['#c9c5bf', '#8f8a84', '#3a3632']),
    dict(id='amara', cm=172, sex=0.0, age=32, race=(0.0, 0.1, 0.9), weight=0.52, muscle=0.5, height=0.62, prop=0.75,
         skin='young_african_female', hair='braid01', brows='eyebrow011', lashes='eyelashes04', eyes='brown',
         wear=[('female_casualsuit01', [R_TOP, R_BOTTOM])], shoes='shoes03',
         face={'mouth/mouth-upperlip-volume-incr': 0.3, 'nose/nose-scale-horiz-incr': 0.2},
         role='casual', mix=dict(day=2.2, night=1.6), build='woman',
         skins=['#7a4b2f', '#6e4329', '#8a5838'], hairs=['#121212', '#1b1512', '#2a1c14']),
    dict(id='omar', cm=176, sex=1.0, age=44, race=(0.3, 0.55, 0.15), weight=0.62, muscle=0.6, height=0.5, prop=0.55,
         skin='middleage_caucasian_male', hair='short03', brows='eyebrow003', lashes='eyelashes02', eyes='brown',
         wear=[('male_casualsuit05', [R_TOP, R_BOTTOM, R_UNDER, R_UNDER])], shoes='shoes04',
         face={'nose/nose-hump-incr': 0.5, 'eyebrows/eyebrows-angle-down': 0.3, 'chin/chin-prominent-incr': 0.2},
         role='coat', mix=dict(day=1.2, night=2.4), build='man',
         skins=['#c9946e', '#bd8862', '#d29a72'], hairs=['#1b1512', '#2a1c14', '#3a3632']),
    dict(id='sophie', cm=167, sex=0.0, age=19, race=(0.0, 1.0, 0.0), weight=0.38, muscle=0.55, height=0.5, prop=0.6,
         skin='young_caucasian_female', hair='ponytail01', brows='eyebrow012', lashes='eyelashes03', eyes='green',
         wear=[('female_sportsuit01', [R_TOP, R_BOTTOM])], shoes='shoes05', freckles=True,
         face={'nose/nose-scale-vert-decr': 0.2, 'chin/chin-height-decr': 0.2},
         role='sport', mix=dict(day=0.0, night=0.0), build='athlete', jogger=True,
         skins=['#f3d6c2', '#f6dccb', '#efcbb2'], hairs=['#6e2f1c', '#8c4a2a', '#b8925c', '#4f3524']),
]


def years(age):
    """MakeHuman's age scale: 1 year at 0, 25 at 0.5, 90 at 1."""
    return 0.5 * (age - 1) / 24 if age <= 25 else 0.5 + 0.5 * (age - 25) / 65


# ---- MPFB ------------------------------------------------------------------------------------------

_HS = None


def mpfb():
    """MPFB2 as a Blender extension (linked into the user extension repo), its HumanService."""
    global _HS
    if _HS is None:
        import addon_utils
        repo = bpy.utils.user_resource('EXTENSIONS', path='user_default', create=True)
        dst = os.path.join(repo, 'mpfb')
        if not os.path.exists(dst):
            os.symlink(MPFB_SRC, dst)
        bpy.ops.extensions.repo_refresh_all()
        addon_utils.enable('bl_ext.user_default.mpfb', default_set=True)
        _HS = importlib.import_module('bl_ext.user_default.mpfb.services.humanservice').HumanService
    return _HS


def target_path(name):
    return os.path.join(MPFB_SRC, 'data', 'targets', name + '.target.gz')


def _asset(sub, name, ext='.mhclo'):
    return os.path.join(SYS, sub, name, name + ext)


def _mhmat(path):
    d = {}
    for line in open(path, encoding='utf-8', errors='ignore'):
        p = line.split(None, 1)
        if len(p) == 2 and not line.startswith('#'):
            d[p[0]] = p[1].strip()
    return d


# ---- building one person ---------------------------------------------------------------------------

def _rot_bone_to(rig, pb, target_dir_world):
    """Turn pose bone `pb` so its current (posed) direction points along target_dir_world."""
    bpy.context.view_layer.update()
    Mw = rig.matrix_world.to_3x3()
    cur = (Mw @ (pb.tail - pb.head)).normalized()
    q_world = cur.rotation_difference(target_dir_world.normalized())
    B = Mw @ pb.matrix.to_3x3()
    q_local = (B.inverted() @ q_world.to_matrix() @ B).to_quaternion()
    pb.rotation_mode = 'QUATERNION'
    pb.rotation_quaternion = pb.rotation_quaternion @ q_local
    bpy.context.view_layer.update()


def _bend(rig, pb, axis_world, ang):
    Mw = rig.matrix_world.to_3x3()
    B = Mw @ pb.matrix.to_3x3()
    q = Quaternion(B.inverted() @ Vector(axis_world), ang)
    pb.rotation_mode = 'QUATERNION'
    pb.rotation_quaternion = q @ pb.rotation_quaternion


def pose_rest(rig):
    """Arms down by the sides from MakeHuman's A pose, palms in, fingers loosely curled."""
    pb = rig.pose.bones
    for side, s in (('l', 1), ('r', -1)):
        # MakeHuman faces -y: the figure's left is +x. Down, a little out and a touch forward.
        _rot_bone_to(rig, pb['upperarm_' + side], Vector((0.16 * s, -0.04, -1.0)))
        # elbows nearly straight (the shader adds its own bend), the hand in line with the forearm
        _rot_bone_to(rig, pb['lowerarm_' + side], Vector((0.08 * s, -0.12, -1.0)))
        _rot_bone_to(rig, pb['hand_' + side], Vector((0.03 * s, -0.10, -1.0)))
    for side, s in (('l', 1), ('r', -1)):
        for f in ('index', 'middle', 'ring', 'pinky'):
            for k, a in ((1, 14), (2, 22), (3, 14)):
                n = f'{f}_0{k}_{side}'
                if n in pb:
                    # curl toward the palm: about each finger bone's own x axis
                    p = pb[n]
                    p.rotation_mode = 'XYZ'
                    p.rotation_euler.x += math.radians(a + (4 if f == 'pinky' else 0))
        for k, a in ((2, 8), (3, 10)):
            n = f'thumb_0{k}_{side}'
            if n in pb:
                pb[n].rotation_mode = 'XYZ'
                pb[n].rotation_euler.x += math.radians(a)
    bpy.context.view_layer.update()


def build_person(spec):
    """MPFB human + assets, posed and applied: returns (parts, rig) where parts is a list of
    (object, kind, region per piece) and every object is in metres, posed, modifiers applied."""
    HS = mpfb()
    race = dict(zip(('asian', 'caucasian', 'african'), spec['race']))
    macro = {'gender': spec['sex'], 'age': years(spec['age']), 'muscle': spec['muscle'], 'weight': spec['weight'],
             'proportions': spec['prop'], 'height': spec['height'], 'cupsize': 0.5, 'firmness': 0.5, 'race': race}
    h = HS.create_human(macro_detail_dict=macro)
    TS = importlib.import_module('bl_ext.user_default.mpfb.services.targetservice').TargetService
    for t, w in spec.get('face', {}).items():
        p = target_path(t)
        if os.path.exists(p):
            TS.load_target(h, p, weight=w)
        else:
            print('  (no target', t, ')')
    rig = HS.add_builtin_rig(h, 'game_engine')
    parts = [(h, 'body', None)]

    def add(sub, name, kind, regions, asset_type='Clothes'):
        o = HS.add_mhclo_asset(_asset(sub, name), h, asset_type=asset_type, subdiv_levels=0)
        o['src_dir'] = os.path.join(SYS, sub, name)
        parts.append((o, kind, regions))
        return o

    add('eyes', 'low-poly', 'eyes', None, 'Eyes')
    add('eyebrows', spec['brows'], 'brows', None, 'Eyebrows')
    add('eyelashes', spec['lashes'], 'lashes', None, 'Eyelashes')
    add('hair', spec['hair'], 'hair', None, 'Hair')
    for name, regs in spec['wear']:
        add('clothes', name, 'cloth', regs)
    add('clothes', spec['shoes'], 'shoes', [R_SHOES])
    pose_rest(rig)
    # bake the targets, then apply the armature and the masks (helpers, skin under the clothes)
    TS.bake_targets(h)
    for o, _, _ in parts:
        bpy.context.view_layer.objects.active = o
        for md in list(o.modifiers):
            if md.type == 'SUBSURF':
                o.modifiers.remove(md)
                continue
            with bpy.context.temp_override(object=o, active_object=o):
                bpy.ops.object.modifier_apply(modifier=md.name)
        o.parent = None
    return parts, rig, h


# ---- materials: what Cycles bakes from -------------------------------------------------------------

def _img(path, non_color=False):
    im = bpy.data.images.load(path, check_existing=True)
    if non_color:
        im.colorspace_settings.name = 'Non-Color'
    return im


def source_material(name, kind, src_dir, spec, mh=None):
    """A Principled material over the `orig` UVs: the MakeHuman texture(s) plus a procedural layer.

    kind: skin, hair (alpha cut-out), brows, lashes, eyes, cloth, shoes. Nodes named 'albedo',
    'alpha', 'rough' feed the bakes (see bake_person)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N['Principled BSDF']
    uv = N.new('ShaderNodeUVMap')
    uv.uv_map = 'orig'
    mh = mh or {}
    diffuse = mh.get('diffuseTexture')
    col = None
    alpha = None
    if diffuse:
        t = N.new('ShaderNodeTexImage')
        t.image = _img(os.path.join(src_dir, diffuse))
        t.interpolation = 'Cubic'
        L.new(uv.outputs[0], t.inputs[0])
        col = t.outputs['Color']
        if kind in ('hair', 'brows', 'lashes'):
            alpha = t.outputs['Alpha']
    obj = N.new('ShaderNodeTexCoord')
    # the procedural layer, in object space (metres)
    if kind == 'skin':
        # blotches and a warm flush (cheeks, nose and ears get it through the texture already)
        n1 = N.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value = 9.0; n1.inputs['Detail'].default_value = 4
        L.new(obj.outputs['Object'], n1.inputs['Vector'])
        mixc = N.new('ShaderNodeMix'); mixc.data_type = 'RGBA'; mixc.blend_type = 'MULTIPLY'
        mixc.inputs['Factor'].default_value = 0.0
        ramp = N.new('ShaderNodeMapRange'); ramp.inputs['From Min'].default_value = 0.35; ramp.inputs['From Max'].default_value = 0.7
        ramp.inputs['To Min'].default_value = 0.0; ramp.inputs['To Max'].default_value = 0.16
        L.new(n1.outputs['Fac'], ramp.inputs['Value'])
        L.new(ramp.outputs['Result'], mixc.inputs['Factor'])
        L.new(col, mixc.inputs['A'])
        mixc.inputs['B'].default_value = (0.86, 0.62, 0.58, 1)
        col = mixc.outputs['Result']
        if spec.get('freckles'):
            vor = N.new('ShaderNodeTexVoronoi'); vor.inputs['Scale'].default_value = 260.0
            vor.inputs['Randomness'].default_value = 1.0
            L.new(obj.outputs['Object'], vor.inputs['Vector'])
            n2 = N.new('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = 14.0
            L.new(obj.outputs['Object'], n2.inputs['Vector'])
            f1 = N.new('ShaderNodeMapRange'); f1.inputs['From Min'].default_value = 0.09; f1.inputs['From Max'].default_value = 0.03
            L.new(vor.outputs['Distance'], f1.inputs['Value'])
            f2 = N.new('ShaderNodeMath'); f2.operation = 'MULTIPLY'
            L.new(f1.outputs['Result'], f2.inputs[0])
            g = N.new('ShaderNodeMapRange'); g.inputs['From Min'].default_value = 0.45; g.inputs['From Max'].default_value = 0.65
            g.inputs['To Max'].default_value = 0.55
            L.new(n2.outputs['Fac'], g.inputs['Value'])
            L.new(g.outputs['Result'], f2.inputs[1])
            mf = N.new('ShaderNodeMix'); mf.data_type = 'RGBA'; mf.blend_type = 'MULTIPLY'
            L.new(f2.outputs['Value'], mf.inputs['Factor'])
            L.new(col, mf.inputs['A'])
            mf.inputs['B'].default_value = (0.62, 0.4, 0.26, 1)
            col = mf.outputs['Result']
    if kind in ('cloth', 'shoes'):
        # wear: lighter, flatter patches where the cloth rubs, a little dirt toward the hems
        n1 = N.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value = 16.0; n1.inputs['Detail'].default_value = 8
        L.new(obj.outputs['Object'], n1.inputs['Vector'])
        mr = N.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 0.55; mr.inputs['From Max'].default_value = 0.8
        mr.inputs['To Max'].default_value = 0.07
        L.new(n1.outputs['Fac'], mr.inputs['Value'])
        mw = N.new('ShaderNodeMix'); mw.data_type = 'RGBA'; mw.blend_type = 'SCREEN'
        L.new(mr.outputs['Result'], mw.inputs['Factor'])
        if col is None:
            rgb = N.new('ShaderNodeRGB'); rgb.outputs[0].default_value = (0.5, 0.5, 0.5, 1); col = rgb.outputs[0]
        L.new(col, mw.inputs['A'])
        mw.inputs['B'].default_value = (0.7, 0.7, 0.7, 1)
        col = mw.outputs['Result']
    ao = mh.get('aomapTexture')
    if ao and col is not None:
        t = N.new('ShaderNodeTexImage'); t.image = _img(os.path.join(src_dir, ao), True)
        L.new(uv.outputs[0], t.inputs[0])
        ma = N.new('ShaderNodeMix'); ma.data_type = 'RGBA'; ma.blend_type = 'MULTIPLY'; ma.inputs['Factor'].default_value = 0.6
        L.new(col, ma.inputs['A']); L.new(t.outputs['Color'], ma.inputs['B'])
        col = ma.outputs['Result']
    if col is None:
        rgb = N.new('ShaderNodeRGB'); rgb.outputs[0].default_value = (0.5, 0.5, 0.5, 1); col = rgb.outputs[0]
    # albedo: a passthrough node the bakes read
    alb = N.new('ShaderNodeMix'); alb.name = 'albedo'; alb.data_type = 'RGBA'; alb.inputs['Factor'].default_value = 0.0
    L.new(col, alb.inputs['A'])
    L.new(alb.outputs['Result'], bsdf.inputs['Base Color'])
    # roughness
    rough = {'skin': 0.52, 'hair': 0.42, 'brows': 0.6, 'lashes': 0.6, 'eyes': 0.06, 'cloth': 0.86, 'shoes': 0.55}[kind]
    if kind == 'shoes' and 'sneak' in name:
        rough = 0.7
    rn = N.new('ShaderNodeTexNoise'); rn.inputs['Scale'].default_value = 40.0
    L.new(obj.outputs['Object'], rn.inputs['Vector'])
    rr = N.new('ShaderNodeMapRange'); rr.name = 'rough'
    rr.inputs['To Min'].default_value = rough - (0.08 if kind == 'skin' else 0.05)
    rr.inputs['To Max'].default_value = rough + (0.08 if kind == 'skin' else 0.05)
    L.new(rn.outputs['Fac'], rr.inputs['Value'])
    L.new(rr.outputs['Result'], bsdf.inputs['Roughness'])
    # normals: the MakeHuman normal map, then a bump of pores (skin) or weave (cloth)
    nrm_out = None
    nm = mh.get('normalmapTexture')
    if nm:
        t = N.new('ShaderNodeTexImage'); t.image = _img(os.path.join(src_dir, nm), True)
        L.new(uv.outputs[0], t.inputs[0])
        nmap = N.new('ShaderNodeNormalMap'); nmap.uv_map = 'orig'
        nmap.inputs['Strength'].default_value = float(mh.get('normalmapIntensity', 1.0))
        L.new(t.outputs['Color'], nmap.inputs['Color'])
        nrm_out = nmap.outputs['Normal']
    bump_h = None
    if kind == 'skin':
        v = N.new('ShaderNodeTexVoronoi'); v.inputs['Scale'].default_value = 900.0; v.feature = 'F1'
        L.new(obj.outputs['Object'], v.inputs['Vector'])
        n = N.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 300.0; n.inputs['Detail'].default_value = 3
        L.new(obj.outputs['Object'], n.inputs['Vector'])
        add = N.new('ShaderNodeMath'); add.operation = 'ADD'
        L.new(v.outputs['Distance'], add.inputs[0]); L.new(n.outputs['Fac'], add.inputs[1])
        bump_h, strength, dist = add.outputs[0], 0.22, 0.0006
    elif kind == 'cloth' and not nm:
        w1 = N.new('ShaderNodeTexWave'); w1.inputs['Scale'].default_value = 160.0; w1.bands_direction = 'X'
        w2 = N.new('ShaderNodeTexWave'); w2.inputs['Scale'].default_value = 160.0; w2.bands_direction = 'Y'
        L.new(uv.outputs[0], w1.inputs['Vector']); L.new(uv.outputs[0], w2.inputs['Vector'])
        add = N.new('ShaderNodeMath'); add.operation = 'MULTIPLY'
        L.new(w1.outputs['Fac'], add.inputs[0]); L.new(w2.outputs['Fac'], add.inputs[1])
        bump_h, strength, dist = add.outputs[0], 0.25, 0.0008
    elif kind == 'cloth':
        # a fine weave over the MakeHuman normal map (folds and seams are in that)
        n = N.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 220.0; n.inputs['Detail'].default_value = 2
        L.new(obj.outputs['Object'], n.inputs['Vector'])
        bump_h, strength, dist = n.outputs['Fac'], 0.12, 0.0005
    if bump_h is not None:
        b = N.new('ShaderNodeBump'); b.inputs['Strength'].default_value = strength; b.inputs['Distance'].default_value = dist
        L.new(bump_h, b.inputs['Height'])
        if nrm_out is not None:
            L.new(nrm_out, b.inputs['Normal'])
        nrm_out = b.outputs['Normal']
    if nrm_out is not None:
        L.new(nrm_out, bsdf.inputs['Normal'])
    if kind == 'skin':
        bsdf.inputs['Subsurface Weight'].default_value = 0.12
        bsdf.inputs['Subsurface Radius'].default_value = (0.9, 0.35, 0.2)
        bsdf.inputs['Subsurface Scale'].default_value = 0.01
    if kind == 'eyes':
        bsdf.inputs['Coat Weight'].default_value = 1.0
        bsdf.inputs['Coat Roughness'].default_value = 0.02
    # alpha (hair cards): a separate value node the alpha bake reads
    av = N.new('ShaderNodeMath'); av.name = 'alpha'; av.operation = 'MULTIPLY'; av.inputs[1].default_value = 1.0
    if alpha is not None:
        L.new(alpha, av.inputs[0])
    else:
        av.inputs[0].default_value = 1.0
    L.new(av.outputs[0], bsdf.inputs['Alpha'])
    m['kind'] = kind
    return m


def eye_material(name, color):
    p = os.path.join(SYS, 'eyes', 'materials', color + '.mhmat')
    mh = _mhmat(p)
    return source_material(name, 'eyes', os.path.join(SYS, 'eyes', 'materials'), {}, mh)


# ---- one mesh, its attributes and UVs ---------------------------------------------------------------

def _components(me):
    """Connected pieces of a mesh, as a face -> piece index array (largest piece = 0)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    comp = np.full(len(bm.faces), -1, np.int32)
    k = 0
    sizes = []
    for f in bm.faces:
        if comp[f.index] >= 0:
            continue
        stack = [f]
        comp[f.index] = k
        n = 0
        while stack:
            g = stack.pop()
            n += 1
            for e in g.edges:
                for h in e.link_faces:
                    if comp[h.index] < 0:
                        comp[h.index] = k
                        stack.append(h)
        sizes.append(n)
        k += 1
    bm.free()
    order = np.argsort(-np.asarray(sizes))
    rank = np.empty_like(order)
    rank[order] = np.arange(len(order))
    return rank[comp]


def assemble(spec, parts, rig):
    """Every part with its source material(s) and region, joined into one object facing +x."""
    objs = []
    for o, kind, regions in parts:
        me = o.data
        if me.uv_layers:
            me.uv_layers[0].name = 'orig'
        else:
            me.uv_layers.new(name='orig')
        src = o.get('src_dir')
        if kind == 'body':
            # MPFB's body slots: body, nipple, lips, fingernails, toenails, ears, genitals -> one skin material
            skin_dir = os.path.join(SYS, 'skins', spec['skin'])
            mh = _mhmat(os.path.join(skin_dir, spec['skin'] + '.mhmat'))
            mat = source_material(f"{spec['id']}-skin", 'skin', skin_dir, spec, mh)
            mat['region'] = R_SKIN
            me.materials.clear()
            me.materials.append(mat)
            for p in me.polygons:
                p.material_index = 0
        elif kind == 'eyes':
            mat = eye_material(f"{spec['id']}-eyes", spec['eyes'])
            mat['region'] = R_DARK
            me.materials.clear(); me.materials.append(mat)
        else:
            name = os.path.basename(src)
            mh = _mhmat(os.path.join(src, name + '.mhmat'))
            k = 'cloth' if kind == 'cloth' else kind
            if kind == 'cloth' or kind == 'shoes':
                comp = _components(me)
                regs = regions
                mats = {}
                me.materials.clear()
                for fi, p in enumerate(me.polygons):
                    r = regs[min(comp[fi], len(regs) - 1)]
                    if r not in mats:
                        mat = source_material(f"{spec['id']}-{name}-{r}", k, src, spec, mh)
                        mat['region'] = r
                        me.materials.append(mat)
                        mats[r] = len(me.materials) - 1
                    p.material_index = mats[r]
            else:
                mat = source_material(f"{spec['id']}-{name}", k, src, spec, mh)
                mat['region'] = R_HAIR
                me.materials.clear(); me.materials.append(mat)
        o['kind'] = kind
        objs.append(o)
    # one object
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    person = objs[0]
    person.name = spec['id'] + '-src'
    # face +x (MakeHuman faces -y), apply
    person.rotation_euler = (0, 0, math.pi / 2)
    bpy.ops.object.select_all(action='DESELECT')
    person.select_set(True)
    bpy.context.view_layer.objects.active = person
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    me = person.data
    # weld nothing (pieces must stay apart), but drop loose verts
    return person


def rig_info(spec, rig, person):
    """Pivots, leg lengths, foot contact and the palm, from the posed rig (rotated to face +x)."""
    R = Matrix.Rotation(math.pi / 2, 4, 'Z') @ rig.matrix_world
    pb = rig.pose.bones
    head = lambda n: R @ pb[n].head
    piv = {}
    hl, hr = head('thigh_l'), head('thigh_r')
    piv[B_ROOT] = Vector((0.5 * (hl.x + hr.x), 0, 0.5 * (hl.z + hr.z)))
    piv[B_CHEST] = Vector((head('spine_02').x, 0, head('spine_02').z))
    piv[B_HEAD] = Vector((head('neck_01').x, 0, head('neck_01').z))
    for side, up, fa, th, sh, ft in (('l', B_UARM_L, B_FARM_L, B_THIGH_L, B_SHIN_L, B_FOOT_L),
                                     ('r', B_UARM_R, B_FARM_R, B_THIGH_R, B_SHIN_R, B_FOOT_R)):
        piv[up] = head('upperarm_' + side)
        piv[fa] = head('lowerarm_' + side)
        piv[th] = head('thigh_' + side)
        piv[sh] = head('calf_' + side)
        piv[ft] = head('foot_' + side)
    piv[B_SKIRT] = piv[B_ROOT].copy()
    piv[B_BAG] = piv[B_ROOT].copy()
    th, kn, an = piv[B_THIGH_R], piv[B_SHIN_R], piv[B_FOOT_R]
    legs = ((th - kn).length, (kn - an).length)
    # the sole: the lowest vertices of the right foot bone, heel (back) and toe (front)
    me = person.data
    vg = person.vertex_groups
    co = np.zeros(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    foot = []
    for v in me.vertices:
        for g in v.groups:
            if vg[g.group].name in ('foot_r', 'ball_r') and g.weight > 0.5:
                foot.append(v.index)
                break
    fp = co[foot]
    x0, x1 = fp[:, 0].min(), fp[:, 0].max()
    sole = max(fp[:, 2].min(), 0.0)
    footv = (x0 - an.x, sole - an.z, x1 - an.x, sole - an.z)
    palm = []
    for v in me.vertices:
        for g in v.groups:
            if vg[g.group].name == 'hand_r' and g.weight > 0.6:
                palm.append(v.index)
                break
    hand = Vector(co[palm].mean(axis=0)) if palm else head('hand_r')
    height = float(co[:, 2].max())
    return piv, legs, footv, hand, height


def rig_attrs(person):
    """Per vertex: the one shader bone it turns with and how much of that bone's own turn it takes
    (every bone above it turns it fully, see Pedestrians.ts). From the game-engine weights: S(b) is
    the weight of b and everything below it; the vertex takes the deepest bone with S >= 0.15, at
    S(b) / S(parent), which is what linear blending of a chain gives when the parent is fully on."""
    me = person.data
    names = {g.index: g.name for g in person.vertex_groups}
    maps = {i: _ge_map(n) for i, n in names.items()}
    nv = len(me.vertices)
    bone = np.zeros(nv, np.int32)
    w = np.ones(nv, np.float32)
    for v in me.vertices:
        W = {}
        for g in v.groups:
            m = maps.get(g.group)
            if not m or g.weight <= 0:
                continue
            for b, share in m:
                W[b] = W.get(b, 0.0) + g.weight * share
        tot = sum(W.values())
        if tot <= 0:
            continue
        S = {b: 0.0 for b in PARENT}
        for b, x in W.items():
            p = b
            while p is not None:
                S[p] += x / tot
                p = PARENT[p]
        best = B_ROOT
        for b in PARENT:
            if S[b] >= 0.15 and (DEPTH[b] > DEPTH[best] or (DEPTH[b] == DEPTH[best] and S[b] > S[best])):
                best = b
        bone[v.index] = best
        par = PARENT[best]
        w[v.index] = 1.0 if par is None else min(1.0, S[best] / max(S[par], 1e-6))
    return bone, w


def atlas_uvs(person, bone):
    """`atlas` UVs: the `orig` islands at an even texel density, the face (x2.6), hands (x1.6) and
    eyes enlarged, packed into the unit square."""
    me = person.data
    uv = me.uv_layers.new(name='atlas')
    me.uv_layers.active = uv
    bpy.ops.object.select_all(action='DESELECT')
    person.select_set(True)
    bpy.context.view_layer.objects.active = person
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    # enlarge islands by what they are: per face, then islands keep their shape (scale about centroid
    # of each orig-connected island)
    mats = me.materials
    uv = me.uv_layers['atlas']
    data = np.zeros(len(me.loops) * 2, np.float32)
    uv.data.foreach_get('uv', data)
    data = data.reshape(-1, 2)
    comp = _uv_islands(me, 'atlas')
    lv = np.zeros(len(me.loops), np.int32)
    me.loops.foreach_get('vertex_index', lv)
    co = np.zeros(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    starts = np.zeros(len(me.polygons), np.int32); me.polygons.foreach_get('loop_start', starts)
    tot = np.zeros(len(me.polygons), np.int32); me.polygons.foreach_get('loop_total', tot)
    mi = np.zeros(len(me.polygons), np.int32); me.polygons.foreach_get('material_index', mi)
    face_of_loop = np.repeat(np.arange(len(me.polygons)), tot)
    scale = np.ones(comp.max() + 1, np.float32)
    for isl in range(comp.max() + 1):
        fl = np.nonzero(comp == isl)[0]
        f0 = fl[0]
        kind = mats[int(mi[f0])].get('kind')
        loops = np.concatenate([np.arange(starts[f], starts[f] + tot[f]) for f in fl])
        bones = bone[lv[loops]]
        zs = co[lv[loops], 2]
        if kind == 'skin':
            hb = np.mean(bones == B_HEAD)
            hand = np.mean(np.isin(bones, (B_FARM_L, B_FARM_R)))
            scale[isl] = 2.6 if hb > 0.5 else 1.6 if hand > 0.5 else 1.0
        elif kind == 'eyes':
            scale[isl] = 3.0
        elif kind in ('brows', 'lashes'):
            scale[isl] = 1.6
        elif kind == 'hair':
            scale[isl] = 1.3
        if scale[isl] != 1.0:
            c = data[loops].mean(axis=0)
            data[loops] = c + (data[loops] - c) * scale[isl]
    me.uv_layers['atlas'].data.foreach_set('uv', data.ravel())
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin=0.006)
    bpy.ops.object.mode_set(mode='OBJECT')


def _uv_islands(me, layer):
    """Face -> island index for a UV layer (faces sharing an edge with matching UVs)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv[layer]
    bm.faces.ensure_lookup_table()
    comp = np.full(len(bm.faces), -1, np.int32)
    k = 0
    for f in bm.faces:
        if comp[f.index] >= 0:
            continue
        comp[f.index] = k
        stack = [f]
        while stack:
            g = stack.pop()
            for l in g.loops:
                e = l.edge
                for l2 in e.link_loops:
                    h = l2.face
                    if comp[h.index] >= 0:
                        continue
                    # same UVs at both ends of the shared edge
                    a0, a1 = l[uvl].uv, l.link_loop_next[uvl].uv
                    b0, b1 = l2[uvl].uv, l2.link_loop_next[uvl].uv
                    if ((a0 - b1).length < 1e-5 and (a1 - b0).length < 1e-5) or \
                       ((a0 - b0).length < 1e-5 and (a1 - b1).length < 1e-5):
                        comp[h.index] = k
                        stack.append(h)
        k += 1
    bm.free()
    return comp


# ---- baking -----------------------------------------------------------------------------------------

def _set_bake_mode(mats, mode):
    """Rewire every material's output for a bake: 'albedo' / 'alpha' / 'rough' as emission, or
    'normal' / 'ao' / 'full' through the Principled BSDF."""
    for m in mats:
        nt = m.node_tree
        out = nt.nodes['Material Output']
        bsdf = nt.nodes['Principled BSDF']
        em = nt.nodes.get('bake-emit')
        if em is None:
            em = nt.nodes.new('ShaderNodeEmission')
            em.name = 'bake-emit'
        for l in list(out.inputs['Surface'].links):
            nt.links.remove(l)
        for l in list(em.inputs['Color'].links):
            nt.links.remove(l)
        if mode in ('albedo', 'alpha', 'rough'):
            src = {'albedo': nt.nodes['albedo'].outputs['Result'], 'alpha': nt.nodes['alpha'].outputs[0],
                   'rough': nt.nodes['rough'].outputs['Result']}[mode]
            nt.links.new(src, em.inputs['Color'])
            nt.links.new(em.outputs[0], out.inputs['Surface'])
        elif mode == 'ao':
            dif = nt.nodes.get('bake-diffuse') or nt.nodes.new('ShaderNodeBsdfDiffuse')
            dif.name = 'bake-diffuse'
            dif.inputs['Color'].default_value = (1, 1, 1, 1)
            tr = nt.nodes.get('bake-transp') or nt.nodes.new('ShaderNodeBsdfTransparent')
            tr.name = 'bake-transp'
            mx = nt.nodes.get('bake-mix') or nt.nodes.new('ShaderNodeMixShader')
            mx.name = 'bake-mix'
            for l in list(mx.inputs[0].links):
                nt.links.remove(l)
            nt.links.new(nt.nodes['alpha'].outputs[0], mx.inputs[0])
            nt.links.new(tr.outputs[0], mx.inputs[1])
            nt.links.new(dif.outputs[0], mx.inputs[2])
            nt.links.new(mx.outputs[0], out.inputs['Surface'])
        else:
            nt.links.new(bsdf.outputs[0], out.inputs['Surface'])


def bake_person(person, size, samples_ao=48):
    """Bakes the person's materials from `orig` onto `atlas`: returns float arrays (size, size, k):
    albedo (linear rgb), alpha, roughness, ao, normal (tangent space, 0..1 encoded)."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.render.bake.margin = 12
    sc.render.bake.margin_type = 'EXTEND'
    sc.render.bake.use_selected_to_active = False
    me = person.data
    me.uv_layers.active = me.uv_layers['atlas']
    for u in me.uv_layers:
        u.active_render = u.name == 'atlas'
    mats = list(me.materials)
    out = {}
    # nothing else in the way (the undecimated source stands exactly where the person does)
    hidden = [o for o in bpy.context.scene.objects if o is not person and not o.hide_render]
    for o in hidden:
        o.hide_render = True
    # a uniform white sky for the occlusion bake
    world = bpy.data.worlds.new('bake-sky')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    sc.world = world
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 3
    sc.cycles.diffuse_bounces = 2
    sc.cycles.transparent_max_bounces = 8
    bpy.ops.object.select_all(action='DESELECT')
    person.select_set(True)
    bpy.context.view_layer.objects.active = person

    def target(name, non_color):
        img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
        if non_color:
            img.colorspace_settings.name = 'Non-Color'
        for m in mats:
            nt = m.node_tree
            t = nt.nodes.get('bake-target') or nt.nodes.new('ShaderNodeTexImage')
            t.name = 'bake-target'
            t.image = img
            nt.nodes.active = t
        return img

    def grab(img, ch):
        a = np.array(img.pixels[:], np.float32).reshape(size, size, 4)
        return a[..., :ch].copy()

    for mode, typ, samples, ch, nc in (('albedo', 'EMIT', 4, 3, True), ('alpha', 'EMIT', 4, 1, True),
                                       ('rough', 'EMIT', 2, 1, True), ('normal', 'NORMAL', 4, 3, True),
                                       ('ao', 'DIFFUSE', samples_ao, 1, True)):
        _set_bake_mode(mats, mode)
        sc.cycles.samples = samples
        img = target(f'{person.name}-{mode}', nc)
        kw = dict(type=typ)
        if typ == 'NORMAL':
            kw.update(normal_space='TANGENT')
        if mode == 'ao':
            kw.update(pass_filter={'DIRECT', 'INDIRECT'})
        bpy.ops.object.bake(**kw)
        out[mode] = grab(img, ch)
        bpy.data.images.remove(img)
    _set_bake_mode(mats, 'full')
    for o in hidden:
        o.hide_render = False
    return out


def region_mask(person, size, layer='atlas'):
    """The atlas tile's region per pixel (-1 = no face), rasterised from the UVs and grown a little."""
    from PIL import Image, ImageDraw
    me = person.data
    uv = me.uv_layers[layer]
    data = np.zeros(len(me.loops) * 2, np.float32)
    uv.data.foreach_get('uv', data)
    data = data.reshape(-1, 2)
    img = Image.new('L', (size, size), 255)
    dr = ImageDraw.Draw(img)
    regs = [int(m.get('region', 0)) for m in me.materials]
    for p in me.polygons:
        pts = [(float(data[l][0] * size), float((1 - data[l][1]) * size)) for l in range(p.loop_start, p.loop_start + p.loop_total)]
        dr.polygon(pts, fill=regs[p.material_index], outline=regs[p.material_index])
    a = np.array(img, np.int32)
    a[a == 255] = -1
    # grow into the margin (the bake's margin is filled the same way)
    for _ in range(10):
        empty = a < 0
        if not empty.any():
            break
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            s = np.roll(np.roll(a, dy, 0), dx, 1)
            fill = empty & (s >= 0)
            a[fill] = s[fill]
            empty = a < 0
    return a[::-1]   # bottom row first, like Blender's pixels


# ---- tiers -------------------------------------------------------------------------------------------

def decimated(person, tris, name, drop_kinds=()):
    """A copy decimated to about `tris` triangles, keeping both UV maps and the vertex groups."""
    o = person.copy()
    o.data = person.data.copy()
    o.name = name
    bpy.context.scene.collection.objects.link(o)
    me = o.data
    if drop_kinds:
        bm = bmesh.new()
        bm.from_mesh(me)
        kinds = [m.get('kind') for m in me.materials]
        dead = [f for f in bm.faces if kinds[f.material_index] in drop_kinds]
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        bm.to_mesh(me)
        bm.free()
    now = sum(len(p.vertices) - 2 for p in me.polygons)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    if now > tris:
        md = o.modifiers.new('dec', 'DECIMATE')
        md.decimate_type = 'COLLAPSE'
        md.ratio = tris / now
        md.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='dec')
    md = o.modifiers.new('tri', 'TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier='tri')
    return o


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)
