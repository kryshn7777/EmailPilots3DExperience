"""Material table for the high-poly source, and the bake-pass swaps.

The high-poly models never get rendered with lighting. Each pass of the bake
swaps every material for an Emission shader that outputs exactly the quantity
being baked (albedo, a packed roughness/metalness colour, or the lit-window
glow), so what lands in the atlas is the material table's value, not a
lighting result. Lighting is the runtime's job.
"""
import bpy

# name: base colour (sRGB hex), roughness, metalness, glow (sRGB hex or None),
#       noise = blotchy tone variation, streak = vertical weathering stains
PALETTE = {
    # masonry and cladding
    'concrete':     dict(c='#a3a39d', r=0.86, m=0.0, noise=0.10, streak=0.10),
    'concrete_d':   dict(c='#74757a', r=0.88, m=0.0, noise=0.10, streak=0.12),
    'limestone':    dict(c='#cdbf9f', r=0.80, m=0.0, noise=0.08, streak=0.12),
    'brick_red':    dict(c='#92503e', r=0.92, m=0.0, noise=0.18, streak=0.10),
    'brick_brn':    dict(c='#715041', r=0.92, m=0.0, noise=0.16, streak=0.10),
    'plaster':      dict(c='#ddd6c6', r=0.90, m=0.0, noise=0.05, streak=0.08),
    'terracotta':   dict(c='#b0674a', r=0.85, m=0.0, noise=0.10, streak=0.06),
    # frames, panels, louvres
    'frame_dark':   dict(c='#23272c', r=0.40, m=0.85),
    'frame_light':  dict(c='#9aa0a6', r=0.35, m=0.90),
    'bronze':       dict(c='#5a4631', r=0.40, m=0.85),
    'spandrel':     dict(c='#101a20', r=0.28, m=0.55),
    'louver':       dict(c='#2b3034', r=0.50, m=0.60),
    'railing':      dict(c='#8fb0bd', r=0.12, m=0.30),
    # glass: tones sit close together because a curtain wall is one coating on
    # one run of glass; the variety that reads is reflection, which comes from
    # the environment map at runtime, not from the albedo
    'glass_dark':   dict(c='#101c29', r=0.06, m=0.70),
    'glass_mid':    dict(c='#172a3b', r=0.06, m=0.70),
    'glass_teal':   dict(c='#163a42', r=0.06, m=0.70),
    'glass_sky':    dict(c='#2a4560', r=0.06, m=0.65),
    'glass_blinds': dict(c='#6f6556', r=0.55, m=0.0),
    # lit rooms: base is the dim interior, glow is what the camera sees at dusk
    'lit_warm':     dict(c='#4a3d2b', r=0.30, m=0.2, glow='#ffc36b'),
    'lit_warm_dim': dict(c='#3c3226', r=0.30, m=0.2, glow='#b8803c'),
    'lit_cool':     dict(c='#3b4655', r=0.30, m=0.2, glow='#bcd8ff'),
    'lit_cool_dim': dict(c='#303a48', r=0.30, m=0.2, glow='#6b88ab'),
    'lit_white':    dict(c='#4d483f', r=0.30, m=0.2, glow='#fff0d4'),
    # roofs and rooftop plant
    'roof_gravel':  dict(c='#5a5856', r=0.96, m=0.0, noise=0.18),
    'roof_membrane': dict(c='#9a9ca0', r=0.80, m=0.0, noise=0.08),
    'roof_tar':     dict(c='#36363a', r=0.92, m=0.0, noise=0.10),
    'roof_green':   dict(c='#58783f', r=0.95, m=0.0, noise=0.25),
    'metal_roof':   dict(c='#858c93', r=0.45, m=0.75, noise=0.06),
    'tank_wood':    dict(c='#6e4c31', r=0.90, m=0.0, noise=0.12),
    'copper':       dict(c='#5f9684', r=0.55, m=0.50, noise=0.10),
    'slate':        dict(c='#444a54', r=0.70, m=0.05, noise=0.08),
    'solar':        dict(c='#131f35', r=0.30, m=0.40),
    'paint_red':    dict(c='#b02a24', r=0.55, m=0.0),

    # -- homes ---------------------------------------------------------------
    # cladding: `pattern` is real-scale (metres) procedural detail, baked into the albedo
    'siding_white': dict(c='#e9e6dc', r=0.80, m=0.0, noise=0.05, streak=0.07, pattern='siding'),
    'siding_cream': dict(c='#dfcb9f', r=0.80, m=0.0, noise=0.05, streak=0.07, pattern='siding'),
    'siding_sage':  dict(c='#9cae93', r=0.80, m=0.0, noise=0.05, streak=0.07, pattern='siding'),
    'siding_blue':  dict(c='#7d9ab4', r=0.80, m=0.0, noise=0.05, streak=0.07, pattern='siding'),
    'siding_gray':  dict(c='#8c949b', r=0.80, m=0.0, noise=0.05, streak=0.07, pattern='siding'),
    'siding_red':   dict(c='#95463a', r=0.82, m=0.0, noise=0.06, streak=0.07, pattern='siding'),
    'siding_ochre': dict(c='#d2b26a', r=0.80, m=0.0, noise=0.05, streak=0.07, pattern='siding'),
    'brick_h_red':  dict(c='#9a4f3d', r=0.92, m=0.0, noise=0.10, streak=0.08, pattern='brick'),
    'brick_h_brn':  dict(c='#7a5642', r=0.92, m=0.0, noise=0.10, streak=0.08, pattern='brick'),
    'stucco_cream': dict(c='#dccfb2', r=0.95, m=0.0, noise=0.12, streak=0.09),
    'stucco_terra': dict(c='#c28f68', r=0.95, m=0.0, noise=0.12, streak=0.09),
    'stucco_white': dict(c='#e6e2d6', r=0.95, m=0.0, noise=0.10, streak=0.08),
    'fieldstone':   dict(c='#8d867b', r=0.90, m=0.0, noise=0.30, streak=0.10),
    'trim_white':   dict(c='#f0ede5', r=0.55, m=0.0),
    'trim_dark':    dict(c='#2d2b29', r=0.55, m=0.0),
    'door_red':     dict(c='#7d2b22', r=0.45, m=0.0),
    'door_blue':    dict(c='#2f4c6e', r=0.45, m=0.0),
    'door_green':   dict(c='#2f5a45', r=0.45, m=0.0),
    'garage_door':  dict(c='#d6d3c8', r=0.55, m=0.10, pattern='panel'),
    'deck_wood':    dict(c='#8d6c4b', r=0.85, m=0.0, noise=0.12, pattern='siding'),
    'shutter':      dict(c='#2c3f50', r=0.60, m=0.0),
    'chimney_brick': dict(c='#8d4b3a', r=0.92, m=0.0),
    # roofing: dz is the height of one course in metres of rise
    'shingle_gray': dict(c='#4d5056', r=0.95, m=0.0, noise=0.10, pattern='shingle_lo'),
    'shingle_brn':  dict(c='#5e473a', r=0.95, m=0.0, noise=0.10, pattern='shingle_lo'),
    'shingle_blk':  dict(c='#3c3f45', r=0.95, m=0.0, noise=0.10, pattern='shingle_lo'),
    'shingle_gray_hi': dict(c='#4d5056', r=0.95, m=0.0, noise=0.10, pattern='shingle_hi'),
    'shingle_brn_hi':  dict(c='#5e473a', r=0.95, m=0.0, noise=0.10, pattern='shingle_hi'),
    'shingle_red_hi':  dict(c='#74382f', r=0.95, m=0.0, noise=0.10, pattern='shingle_hi'),
    'tile_terra':   dict(c='#b4634a', r=0.80, m=0.0, noise=0.14, pattern='tile'),
    'metal_seam':   dict(c='#7b878c', r=0.40, m=0.75, noise=0.05, pattern='seam'),
    'metal_seam_dk': dict(c='#3f464b', r=0.40, m=0.75, noise=0.05, pattern='seam'),
    # planting
    'leaf_oak':     dict(c='#4f6f36', r=0.90, m=0.0, noise=0.35),
    'leaf_maple':   dict(c='#a2602c', r=0.90, m=0.0, noise=0.35),
    'leaf_pine':    dict(c='#2f5035', r=0.92, m=0.0, noise=0.30),
    'leaf_birch':   dict(c='#82a44e', r=0.90, m=0.0, noise=0.35),
    'leaf_oak_dk':  dict(c='#3b5629', r=0.90, m=0.0, noise=0.30),
    'leaf_oak_lt':  dict(c='#6d8f46', r=0.88, m=0.0, noise=0.30),
    'leaf_maple_dk': dict(c='#7c4a22', r=0.90, m=0.0, noise=0.30),
    'leaf_maple_lt': dict(c='#c07a3a', r=0.88, m=0.0, noise=0.30),
    'leaf_pine_dk': dict(c='#223a28', r=0.92, m=0.0, noise=0.25),
    'leaf_pine_lt': dict(c='#3a6143', r=0.90, m=0.0, noise=0.25),
    'leaf_birch_dk': dict(c='#5f7e38', r=0.90, m=0.0, noise=0.30),
    'leaf_birch_lt': dict(c='#9ab864', r=0.88, m=0.0, noise=0.30),
    'bark':         dict(c='#4d3d30', r=0.95, m=0.0, noise=0.20),
    'bark_pale':    dict(c='#bdb7a6', r=0.90, m=0.0, noise=0.18),
    'lawn':         dict(c='#5f7f40', r=0.95, m=0.0, noise=0.30),
}


def _lin(hex_):
    """sRGB hex -> linear RGB tuple (Blender node colours are linear)."""
    h = hex_.lstrip('#')
    out = []
    for i in (0, 2, 4):
        s = int(h[i:i + 2], 16) / 255.0
        out.append(s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def srgb(hex_):
    h = hex_.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def _emission_material(name, color_node_builder=None, color=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 1.0
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    if color_node_builder:
        color_node_builder(nt, em.inputs['Color'])
    else:
        em.inputs['Color'].default_value = (*color, 1.0)
    return mat


# (brick width, row height) in metres, mortar thickness, stagger, mortar colour
_COURSES = {
    'brick':       (0.225, 0.075, 0.012, 0.5, '#8a8479'),
    'shingle_lo':  (0.17, 0.085, 0.007, 0.5, '#15161a'),
    'shingle_hi':  (0.17, 0.14, 0.008, 0.5, '#15161a'),
    'tile':        (0.34, 0.16, 0.020, 0.5, '#3a1d16'),
    'panel':       (0.80, 0.55, 0.030, 0.0, '#8d8a80'),
}


def _wave_scale(period):
    """Blender's wave texture runs 20 radians per unit before Scale, so a band
    of `period` metres needs Scale = 2*pi / (20 * period)."""
    import math
    return 2 * math.pi / (20.0 * period)


def _pattern(nt, coord, spec, base):
    """Metre-scale cladding detail. Returns (colour socket or None, tone socket or None)."""
    pattern = spec.get('pattern')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(coord.outputs['Object'], sep.inputs['Vector'])
    # walls here are axis-aligned, so x + y is "distance along the wall" whichever
    # way it faces; courses then run in (along, up)
    along = nt.nodes.new('ShaderNodeMath')
    along.operation = 'ADD'
    nt.links.new(sep.outputs['X'], along.inputs[0])
    nt.links.new(sep.outputs['Y'], along.inputs[1])
    flat = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(along.outputs['Value'], flat.inputs['X'])
    nt.links.new(sep.outputs['Z'], flat.inputs['Y'])

    if pattern in ('siding', 'seam'):
        wave = nt.nodes.new('ShaderNodeTexWave')
        wave.wave_type = 'BANDS'
        wave.wave_profile = 'SAW'
        wave.inputs['Distortion'].default_value = 0.0
        wave.inputs['Detail'].default_value = 0.0
        if pattern == 'siding':
            wave.bands_direction = 'Z'
            wave.inputs['Scale'].default_value = _wave_scale(0.17)
            nt.links.new(coord.outputs['Object'], wave.inputs['Vector'])
        else:
            wave.bands_direction = 'X'
            wave.inputs['Scale'].default_value = _wave_scale(0.45)
            nt.links.new(flat.outputs['Vector'], wave.inputs['Vector'])
        groove = nt.nodes.new('ShaderNodeMapRange')
        groove.inputs['From Min'].default_value = 0.86
        groove.inputs['From Max'].default_value = 1.0
        groove.inputs['To Min'].default_value = 1.0
        groove.inputs['To Max'].default_value = 0.58
        groove.clamp = True
        nt.links.new(wave.outputs['Fac'], groove.inputs['Value'])
        return None, groove.outputs['Result']

    bw, rh, ms, stagger, mortar = _COURSES[pattern]
    brick = nt.nodes.new('ShaderNodeTexBrick')
    brick.offset = stagger
    brick.offset_frequency = 2
    brick.inputs['Scale'].default_value = 1.0
    brick.inputs['Brick Width'].default_value = bw
    brick.inputs['Row Height'].default_value = rh
    brick.inputs['Mortar Size'].default_value = ms
    brick.inputs['Mortar Smooth'].default_value = 0.08
    brick.inputs['Color1'].default_value = (*[min(c * 1.12, 1.0) for c in base], 1.0)
    brick.inputs['Color2'].default_value = (*[c * 0.78 for c in base], 1.0)
    brick.inputs['Mortar'].default_value = (*_lin(mortar), 1.0)
    nt.links.new(flat.outputs['Vector'], brick.inputs['Vector'])
    return brick.outputs['Color'], None


def _weathered(spec):
    """Albedo: base colour or a course pattern, with blotches and vertical
    stains driven by object-space noise."""
    base = _lin(spec['c'])
    noise, streak = spec.get('noise', 0.0), spec.get('streak', 0.0)
    pattern = spec.get('pattern')

    def build(nt, target):
        if not noise and not streak and not pattern:
            target.default_value = (*base, 1.0)
            return
        coord = nt.nodes.new('ShaderNodeTexCoord')
        tones = []
        for freq, scale_z, amp in ((0.9, 1.0, noise), (2.2, 0.06, streak)):
            if not amp:
                continue
            mapping = nt.nodes.new('ShaderNodeMapping')
            mapping.inputs['Scale'].default_value = (freq, freq, freq * scale_z)
            tex = nt.nodes.new('ShaderNodeTexNoise')
            tex.inputs['Scale'].default_value = 1.0
            tex.inputs['Detail'].default_value = 4.0
            nt.links.new(coord.outputs['Object'], mapping.inputs['Vector'])
            nt.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
            rng = nt.nodes.new('ShaderNodeMapRange')
            rng.inputs['From Min'].default_value = 0.3
            rng.inputs['From Max'].default_value = 0.7
            rng.inputs['To Min'].default_value = 1.0 - amp
            rng.inputs['To Max'].default_value = 1.0 + amp * 0.4
            rng.clamp = True
            nt.links.new(tex.outputs['Fac'], rng.inputs['Value'])
            tones.append(rng.outputs['Result'])
        color_src = None
        if pattern:
            color_src, ptone = _pattern(nt, coord, spec, base)
            if ptone is not None:
                tones.append(ptone)
        # ShaderNodeMix reuses the names A/B/Result across its float, vector and
        # colour variants, so the colour sockets are addressed by index
        tint = nt.nodes.new('ShaderNodeMix')
        tint.data_type = 'RGBA'
        tint.blend_type = 'MULTIPLY'
        tint.inputs[0].default_value = 1.0
        if color_src is not None:
            nt.links.new(color_src, tint.inputs[6])
        else:
            tint.inputs[6].default_value = (*base, 1.0)
        if tones:
            tone = tones[0]
            for nxt in tones[1:]:
                both = nt.nodes.new('ShaderNodeMath')
                both.operation = 'MULTIPLY'
                nt.links.new(tone, both.inputs[0])
                nt.links.new(nxt, both.inputs[1])
                tone = both.outputs['Value']
            grey = nt.nodes.new('ShaderNodeCombineColor')
            for ch in ('Red', 'Green', 'Blue'):
                nt.links.new(tone, grey.inputs[ch])
            nt.links.new(grey.outputs['Color'], tint.inputs[7])
        else:
            tint.inputs[7].default_value = (1.0, 1.0, 1.0, 1.0)
        nt.links.new(tint.outputs[2], target)

    return build


def _diffuse_material(name, color_node_builder):
    """Plain diffuse in the real albedo: what the global-illumination pass lights."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Metallic'].default_value = 0.0
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    color_node_builder(nt, bsdf.inputs['Base Color'])
    return mat


def build_bake_materials():
    """One swap material per (pass, name). Returns {pass: {name: material}}."""
    sets = {'color': {}, 'orm': {}, 'emit': {}, 'gi': {}}
    for name, spec in PALETTE.items():
        sets['gi'][name] = _diffuse_material(f'{name}.gi', _weathered(spec))
        sets['color'][name] = _emission_material(f'{name}.color', _weathered(spec))
        # R is filled by the AO pass afterwards; G = roughness, B = metalness
        sets['orm'][name] = _emission_material(
            f'{name}.orm', color=(0.0, spec['r'], spec['m']))
        sets['emit'][name] = _emission_material(
            f'{name}.emit', color=_lin(spec['glow']) if spec.get('glow') else (0.0, 0.0, 0.0))
    return sets
