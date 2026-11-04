"""Procedural PBR materials for the office props' high-poly twins (the bake sources).

Each material is a Principled BSDF fed by node graphs for colour, roughness, metalness and a
bump height, with the wear evaluated on the high-poly surface itself:

  edge     convex edges found by comparing a Bevel-node normal with the true normal (a curvature
           mask, ray traced) break up into chips and rubbed-through paint
  cavity   the AO node darkens creases and the corners between parts with grime
  dust     faces turned up gather a fine, light, rough film, thickest in the open
  smudge   large soft noise moves roughness about: fingerprints on gloss, polished patches
  var      low-frequency colour variation so no surface is a flat fill

Patterns give each surface its micro structure: powder-coat orange peel, plastic grain, fabric
weave, mesh fabric, wood grain, brushed metal, perforated sheet steel, rubber, paper, soil, leaf.

Every material also carries two emission branches the baker switches the output to: `EM_C`
(final albedo) and `EM_ORM` (0, roughness, metalness), so colour and ORM bake through EMIT while
normals bake from the BSDF (its Normal input carries the bump).
"""
import bpy


def lin(c):
    """sRGB hex or 0..1 tuple to linear RGBA."""
    if isinstance(c, str):
        c = tuple(int(c[i:i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda s: s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4  # noqa: E731
    return (f(c[0]), f(c[1]), f(c[2]), 1.0)


# name: dict(c colour, r roughness, m metal, p pattern, dust, edge, ec edge colour, cav, smudge, var, ...)
SPECS = {
    # painted / powder-coated steel
    'steel_black': dict(c='#1d1f22', r=0.52, m=0.0, p='peel', dust=0.6, edge=0.6, ec='#8a8d90', em=0.9, cav=0.5, smudge=0.25),
    'steel_grey': dict(c='#8d9096', r=0.48, m=0.0, p='peel', dust=0.5, edge=0.5, ec='#b9bcbf', em=0.9, cav=0.5, smudge=0.25),
    'steel_light': dict(c='#c9cbc8', r=0.45, m=0.0, p='peel', dust=0.45, edge=0.5, ec='#9da1a4', em=0.8, cav=0.55, smudge=0.3),
    'steel_white': dict(c='#e4e4e0', r=0.42, m=0.0, p='peel', dust=0.4, edge=0.4, ec='#a4a6a8', em=0.8, cav=0.5, smudge=0.25),
    'steel_blue': dict(c='#2f4f73', r=0.45, m=0.0, p='peel', dust=0.45, edge=0.55, ec='#9aa0a6', em=0.9, cav=0.5),
    'perf_black': dict(c='#1b1d20', r=0.5, m=0.0, p='perf', hole=0.006, pitch=0.0095, dust=0.4, edge=0.5, ec='#8a8d90', em=0.9, cav=0.4),
    'perf_grey': dict(c='#8d9096', r=0.5, m=0.0, p='perf_sq', hole=0.0045, pitch=0.0254, dust=0.4, edge=0.4, ec='#b9bcbf', em=0.9, cav=0.4),
    'vent_black': dict(c='#202226', r=0.5, m=0.0, p='perf', hole=0.0022, pitch=0.0035, dust=0.5, cav=0.4),
    'rail': dict(c='#9a9ea3', r=0.38, m=1.0, p='perf_sq', hole=0.0095, pitch=0.015875, axis='Z', dust=0.3, cav=0.5),
    # metals
    'alu': dict(c='#c3c6ca', r=0.3, m=1.0, p='brushed', dust=0.35, cav=0.4, smudge=0.35),
    'alu_dark': dict(c='#4a4d52', r=0.35, m=1.0, p='brushed', dust=0.35, cav=0.4, smudge=0.35),
    'chrome': dict(c='#e8e9eb', r=0.08, m=1.0, dust=0.25, cav=0.4, smudge=0.5),
    'steel_bare': dict(c='#a9adb1', r=0.32, m=1.0, p='brushed', dust=0.3, cav=0.5, smudge=0.3),
    'zinc': dict(c='#b3b7b9', r=0.42, m=1.0, p='spangle', dust=0.5, cav=0.5, var=0.15),
    'copper': dict(c='#c27c4e', r=0.35, m=1.0, dust=0.2, cav=0.4, var=0.2),
    'gold': dict(c='#e5b74f', r=0.25, m=1.0, cav=0.3),
    'brass': dict(c='#c9a24c', r=0.35, m=1.0, cav=0.4),
    # plastics
    'plastic_black': dict(c='#141518', r=0.48, m=0.0, p='grain', dust=0.55, edge=0.35, ec='#3a3c40', em=0.0, er=0.3, cav=0.45, smudge=0.35),
    'plastic_gloss': dict(c='#0c0d0f', r=0.18, m=0.0, dust=0.35, cav=0.35, smudge=0.6),
    'plastic_dark': dict(c='#2b2d31', r=0.5, m=0.0, p='grain', dust=0.5, edge=0.35, ec='#55585c', em=0.0, er=0.35, cav=0.45, smudge=0.3),
    'plastic_grey': dict(c='#8a8d91', r=0.5, m=0.0, p='grain', dust=0.45, edge=0.3, ec='#b0b3b6', em=0.0, er=0.4, cav=0.45, smudge=0.3),
    'plastic_white': dict(c='#e7e6e1', r=0.45, m=0.0, p='grain', dust=0.45, edge=0.25, ec='#cfccc4', em=0.0, er=0.5, cav=0.55, smudge=0.3),
    'plastic_beige': dict(c='#d8d3c6', r=0.5, m=0.0, p='grain', dust=0.45, cav=0.5, smudge=0.3),
    'plastic_yellow': dict(c='#f2b51c', r=0.55, m=0.0, p='grain', dust=0.4, edge=0.3, ec='#c89a2a', em=0.0, cav=0.45),
    'plastic_red': dict(c='#b8221c', r=0.42, m=0.0, p='grain', cav=0.4, smudge=0.3),
    'plastic_blue': dict(c='#1f5fae', r=0.42, m=0.0, p='grain', cav=0.4, smudge=0.3),
    'plastic_green': dict(c='#2c8a44', r=0.42, m=0.0, p='grain', cav=0.4, smudge=0.3),
    'plastic_orange': dict(c='#e06a1b', r=0.45, m=0.0, p='grain', cav=0.4, smudge=0.3),
    'plastic_clear': dict(c='#9fb1b8', r=0.12, m=0.0, cav=0.3, smudge=0.4),
    'rubber': dict(c='#1a1a1b', r=0.85, m=0.0, p='rubber', dust=0.6, cav=0.5),
    'rubber_grey': dict(c='#4b4d50', r=0.8, m=0.0, p='rubber', dust=0.5, cav=0.5),
    'esd_mat': dict(c='#3e6f8f', r=0.78, m=0.0, p='rubber', dust=0.5, cav=0.4, smudge=0.5, var=0.25),
    'cable_black': dict(c='#18191b', r=0.55, m=0.0, p='cable', dust=0.5, cav=0.5),
    'cable_grey': dict(c='#8d9195', r=0.5, m=0.0, p='cable', dust=0.5, cav=0.5),
    'cable_blue': dict(c='#1d5fbf', r=0.45, m=0.0, p='cable', dust=0.45, cav=0.5),
    'cable_yellow': dict(c='#e8c21e', r=0.45, m=0.0, p='cable', dust=0.45, cav=0.5),
    'cable_red': dict(c='#c0262a', r=0.45, m=0.0, p='cable', dust=0.45, cav=0.5),
    'cable_green': dict(c='#2b9a4a', r=0.45, m=0.0, p='cable', dust=0.45, cav=0.5),
    'cable_white': dict(c='#e3e3df', r=0.45, m=0.0, p='cable', dust=0.45, cav=0.5),
    'cable_orange': dict(c='#e8771e', r=0.45, m=0.0, p='cable', dust=0.45, cav=0.5),
    'velcro': dict(c='#202224', r=0.95, m=0.0, p='fabric', weave=900, dust=0.5),
    'pcb': dict(c='#1d4a2a', r=0.35, m=0.0, p='pcb', cav=0.4, dust=0.3),
    'pcb_black': dict(c='#151a17', r=0.32, m=0.0, p='pcb', cav=0.4, dust=0.3),
    'chip': dict(c='#131416', r=0.4, m=0.0, cav=0.3, dust=0.3),
    'lcd': dict(c='#9aa58f', r=0.2, m=0.0, cav=0.3, smudge=0.6),
    'glass_dark': dict(c='#0a0c0e', r=0.06, m=0.0, smudge=0.7, dust=0.25),
    'label': dict(c='#ecebe4', r=0.6, m=0.0, p='paper', cav=0.3, var=0.1),
    'label_print': dict(c='#ecebe4', r=0.6, m=0.0, p='print', cav=0.3),
    # soft furnishings and fabric
    'fabric_chair': dict(c='#2c3138', r=0.92, m=0.0, p='fabric', weave=380, dust=0.4, cav=0.55, var=0.12),
    'mesh_chair': dict(c='#1d2024', r=0.85, m=0.0, p='mesh', weave=160, dust=0.35, cav=0.5),
    'fabric_screen': dict(c='#5d6f78', r=0.95, m=0.0, p='felt', dust=0.45, cav=0.5, var=0.15),
    'felt_black': dict(c='#1d1e20', r=0.95, m=0.0, p='felt', dust=0.4, cav=0.4),
    # wood and boards
    'laminate_oak': dict(c='#c19a6b', r=0.42, m=0.0, p='wood', dust=0.35, cav=0.4, smudge=0.4, edge=0.3, ec='#d8bf98', em=0.0, er=0.5),
    'laminate_white': dict(c='#e8e6e0', r=0.35, m=0.0, p='grain', dust=0.35, cav=0.4, smudge=0.45),
    'laminate_grey': dict(c='#7d8287', r=0.45, m=0.0, p='grain', dust=0.35, cav=0.4, smudge=0.45),
    'edge_band': dict(c='#dcd7cf', r=0.4, m=0.0, p='grain', cav=0.5, edge=0.4, ec='#bfb8ab', em=0.0),
    'mdf': dict(c='#a98d6c', r=0.75, m=0.0, p='paper', cav=0.5),
    'cardboard': dict(c='#b08a5a', r=0.85, m=0.0, p='paper', cav=0.5, var=0.15, edge=0.4, ec='#cfae80', em=0.0),
    'paper': dict(c='#f1f0ea', r=0.75, m=0.0, p='paper', cav=0.35, var=0.05),
    'paper_print': dict(c='#f1f0ea', r=0.75, m=0.0, p='print', cav=0.35),
    'note_yellow': dict(c='#f5e46b', r=0.75, m=0.0, p='paper', cav=0.3),
    'note_pink': dict(c='#f29cc0', r=0.75, m=0.0, p='paper', cav=0.3),
    'note_blue': dict(c='#8ed1ee', r=0.75, m=0.0, p='paper', cav=0.3),
    'notebook_cover': dict(c='#2a3446', r=0.7, m=0.0, p='leather', cav=0.4, edge=0.4, ec='#56627a', em=0.0),
    'ceramic_white': dict(c='#eeeee9', r=0.12, m=0.0, cav=0.35, dust=0.2, smudge=0.35),
    'ceramic_blue': dict(c='#2b5a8c', r=0.12, m=0.0, cav=0.35, dust=0.2, smudge=0.35),
    'ceramic_red': dict(c='#a8332b', r=0.15, m=0.0, cav=0.35, dust=0.2, smudge=0.35),
    'coffee': dict(c='#2a1608', r=0.05, m=0.0),
    'glass_clear': dict(c='#3b4446', r=0.05, m=0.0, smudge=0.5),
    'enamel_white': dict(c='#f3f3f0', r=0.1, m=0.0, smudge=0.5, cav=0.3),
    # plants
    'leaf': dict(c='#2f5a24', r=0.38, m=0.0, p='leaf', var=0.3, dust=0.35),
    'leaf_back': dict(c='#5f7f45', r=0.55, m=0.0, p='leaf', var=0.25),
    'bark': dict(c='#6b5a48', r=0.85, m=0.0, p='bark', var=0.25, cav=0.5),
    'soil': dict(c='#2e241b', r=0.95, m=0.0, p='soil', var=0.35, cav=0.6),
    'pot': dict(c='#34373b', r=0.6, m=0.0, p='concrete', dust=0.5, edge=0.4, ec='#6c6f72', em=0.0, cav=0.5, var=0.12),
    # emissive LEDs etc. in the high-poly render (the lean mesh carries `led` etc. on their own)
    'led_green': dict(c='#1c4a22', r=0.2, m=0.0, glow='#4dff6a', gs=3.0),
    'led_amber': dict(c='#4a3510', r=0.2, m=0.0, glow='#ffb22e', gs=3.0),
    'led_blue': dict(c='#10284a', r=0.2, m=0.0, glow='#3d8bff', gs=3.0),
    'led_white': dict(c='#3a3a3a', r=0.2, m=0.0, glow='#e8f0ff', gs=3.0),
    'led_red': dict(c='#4a1010', r=0.2, m=0.0, glow='#ff3a2e', gs=3.0),
    'led_lcd': dict(c='#18324a', r=0.2, m=0.0, glow='#7fb7e8', gs=1.0),
}

# the lean mesh's own (not atlas) materials: emissive and canvas faces
EMISSIVE = {
    'screen': dict(c='#08090b', r=0.08, glow=(0.32, 0.42, 0.56)),
    'bulb': dict(c='#f4efe4', r=0.3, glow=(1.0, 0.86, 0.66)),
    'panel': dict(c='#f2f2ee', r=0.5, glow=(1.0, 0.97, 0.92)),
}
CANVAS = {'board': dict(c='#f4f4f1', r=0.12)}
# LED tints: palette cells in the colour atlas the `led` faces sample (base and emissive alike)
LED_TINTS = ['green', 'amber', 'blue', 'white', 'red', 'lcd']


def _n(nt, kind, **inputs):
    node = nt.nodes.new(kind)
    for k, v in inputs.items():
        if k.startswith('_'):
            setattr(node, k[1:], v)
        else:
            node.inputs[k].default_value = v
    return node


def _math(nt, op, a, b=None, clamp=False):
    m = nt.nodes.new('ShaderNodeMath')
    m.operation = op
    m.use_clamp = clamp
    for i, x in enumerate((a, b)):
        if x is None:
            continue
        if isinstance(x, (int, float)):
            m.inputs[i].default_value = x
        else:
            nt.links.new(x, m.inputs[i])
    return m.outputs[0]


def _mix(nt, fac, a, b, kind='RGBA'):
    m = nt.nodes.new('ShaderNodeMix')
    m.data_type = kind
    if kind == 'RGBA':
        ia, ib, out = m.inputs[6], m.inputs[7], m.outputs[2]
    else:
        ia, ib, out = m.inputs[2], m.inputs[3], m.outputs[0]
    for sock, x in ((m.inputs[0], fac), (ia, a), (ib, b)):
        if isinstance(x, (int, float, tuple)):
            sock.default_value = x
        else:
            nt.links.new(x, sock)
    return out


def _ramp(nt, x, lo, hi):
    m = nt.nodes.new('ShaderNodeMapRange')
    m.clamp = True
    m.inputs['From Min'].default_value = lo
    m.inputs['From Max'].default_value = hi
    nt.links.new(x, m.inputs['Value'])
    return m.outputs[0]


def _noise(nt, vec, scale, detail=4.0, rough=0.55, dims='3D', w=None):
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.noise_dimensions = dims
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough
    nt.links.new(vec, n.inputs['Vector'])
    return n.outputs['Fac']


def _vmath(nt, op, a, b=None, scale=None):
    m = nt.nodes.new('ShaderNodeVectorMath')
    m.operation = op
    nt.links.new(a, m.inputs[0])
    if b is not None:
        if isinstance(b, tuple):
            m.inputs[1].default_value = b
        else:
            nt.links.new(b, m.inputs[1])
    if scale is not None:
        m.inputs[3].default_value = scale
    return m.outputs[1] if op in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE') else m.outputs[0]


def _xyz(nt, vec):
    s = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(vec, s.inputs[0])
    return s.outputs


def _dots(nt, a, b, pitch, hole, square=False, stagger=True):
    """1 inside the holes of a perforated sheet, 0 on the metal; a, b = in-plane coordinates."""
    u = _math(nt, 'DIVIDE', a, pitch)
    v = _math(nt, 'DIVIDE', b, pitch * (0.866 if stagger and not square else 1.0))
    if stagger and not square:
        row = _math(nt, 'FLOOR', v)
        shift = _math(nt, 'MULTIPLY', _math(nt, 'FRACT', _math(nt, 'MULTIPLY', row, 0.5)), 1.0)
        u = _math(nt, 'ADD', u, shift)
    fu = _math(nt, 'SUBTRACT', _math(nt, 'FRACT', u), 0.5)
    fv = _math(nt, 'SUBTRACT', _math(nt, 'FRACT', v), 0.5)
    rr = hole / pitch / 2
    if square:
        d = _math(nt, 'MAXIMUM', _math(nt, 'ABSOLUTE', fu), _math(nt, 'ABSOLUTE', fv))
    else:
        d = _math(nt, 'SQRT', _math(nt, 'ADD', _math(nt, 'MULTIPLY', fu, fu), _math(nt, 'MULTIPLY', fv, fv)))
    return _ramp(nt, d, rr + 0.04, rr - 0.04)


def build(name, spec):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = _n(nt, 'ShaderNodeOutputMaterial', _name='OUT')
    bsdf = _n(nt, 'ShaderNodeBsdfPrincipled', _name='BSDF')
    tc = _n(nt, 'ShaderNodeTexCoord')
    geo = _n(nt, 'ShaderNodeNewGeometry')
    obj = tc.outputs['Object']
    X, Y, Z = _xyz(nt, obj)
    N = geo.outputs['Normal']
    NX, NY, NZ = _xyz(nt, N)

    base = _n(nt, 'ShaderNodeRGB')
    base.outputs[0].default_value = lin(spec['c'])
    col = base.outputs[0]
    rough = spec['r']
    metal = spec.get('m', 0.0)
    rough_s = _n(nt, 'ShaderNodeValue')
    rough_s.outputs[0].default_value = rough
    rough_s = rough_s.outputs[0]
    metal_s = _n(nt, 'ShaderNodeValue')
    metal_s.outputs[0].default_value = metal
    metal_s = metal_s.outputs[0]
    height = None  # bump height (metres-ish, scaled by the bump node's distance)
    bump_dist = 0.0005

    # colour variation
    var = spec.get('var', 0.06)
    if var:
        n = _noise(nt, obj, 2.2, 3)
        n2 = _noise(nt, obj, 17.0, 3)
        f = _math(nt, 'ADD', _math(nt, 'MULTIPLY', _math(nt, 'SUBTRACT', n, 0.5), var * 1.6),
                  _math(nt, 'MULTIPLY', _math(nt, 'SUBTRACT', n2, 0.5), var * 0.6))
        f = _math(nt, 'ADD', f, 1.0)
        col = _vmath(nt, 'SCALE', col, scale=None) if False else col
        m = nt.nodes.new('ShaderNodeVectorMath')
        m.operation = 'MULTIPLY'
        nt.links.new(col, m.inputs[0])
        c3 = nt.nodes.new('ShaderNodeCombineXYZ')
        for i in range(3):
            nt.links.new(f, c3.inputs[i])
        nt.links.new(c3.outputs[0], m.inputs[1])
        col = m.outputs[0]

    p = spec.get('p')
    if p == 'peel':
        height = _math(nt, 'MULTIPLY', _noise(nt, obj, 420.0, 2, 0.4), 0.6)
        bump_dist = 0.00012
    elif p == 'grain':
        height = _noise(nt, obj, 900.0, 3, 0.6)
        bump_dist = 0.00008
        rough_s = _math(nt, 'ADD', rough_s, _math(nt, 'MULTIPLY', _math(nt, 'SUBTRACT', _noise(nt, obj, 260.0, 2), 0.5), 0.12))
    elif p == 'rubber':
        height = _noise(nt, obj, 700.0, 2, 0.5)
        bump_dist = 0.00015
    elif p == 'brushed':
        stretch = _n(nt, 'ShaderNodeMapping')
        stretch.inputs['Scale'].default_value = (1.0, 1.0, 1.0)
        nt.links.new(obj, stretch.inputs['Vector'])
        sc = nt.nodes.new('ShaderNodeCombineXYZ')
        nt.links.new(_math(nt, 'MULTIPLY', X, 8.0), sc.inputs[0])
        nt.links.new(_math(nt, 'MULTIPLY', Y, 1800.0), sc.inputs[1])
        nt.links.new(_math(nt, 'MULTIPLY', Z, 1800.0), sc.inputs[2])
        st = _noise(nt, sc.outputs[0], 1.0, 6, 0.6)
        height = _math(nt, 'MULTIPLY', st, 0.4)
        bump_dist = 0.00005
        rough_s = _math(nt, 'ADD', rough_s, _math(nt, 'MULTIPLY', _math(nt, 'SUBTRACT', st, 0.5), 0.15))
    elif p == 'spangle':
        vor = _n(nt, 'ShaderNodeTexVoronoi', Scale=60.0)
        nt.links.new(obj, vor.inputs['Vector'])
        sp = vor.outputs['Color']
        sx = _xyz(nt, sp)[0]
        rough_s = _math(nt, 'ADD', rough_s, _math(nt, 'MULTIPLY', _math(nt, 'SUBTRACT', sx, 0.5), 0.25))
        col = _mix(nt, _math(nt, 'MULTIPLY', sx, 0.25), col, lin('#d7dadb'))
    elif p in ('fabric', 'mesh'):
        sc = spec.get('weave', 380.0)
        w1 = _n(nt, 'ShaderNodeTexWave', Scale=sc, Distortion=0.4, Detail=1.0, _wave_type='BANDS', _bands_direction='X')
        w2 = _n(nt, 'ShaderNodeTexWave', Scale=sc, Distortion=0.4, Detail=1.0, _wave_type='BANDS', _bands_direction='Z')
        nt.links.new(obj, w1.inputs['Vector'])
        nt.links.new(obj, w2.inputs['Vector'])
        a, b = w1.outputs['Fac'], w2.outputs['Fac']
        if p == 'mesh':
            # open mesh: dark holes between the strands
            strand = _math(nt, 'MAXIMUM', _ramp(nt, a, 0.55, 0.8), _ramp(nt, b, 0.55, 0.8))
            col = _mix(nt, _math(nt, 'SUBTRACT', 1.0, strand), col, lin('#050506'))
            height = strand
            bump_dist = 0.0006
        else:
            height = _math(nt, 'MULTIPLY', _math(nt, 'ADD', a, b), 0.5)
            fl = _noise(nt, obj, 1400.0, 2)
            height = _math(nt, 'ADD', height, _math(nt, 'MULTIPLY', fl, 0.4))
            bump_dist = 0.0003
            col = _mix(nt, _math(nt, 'MULTIPLY', _math(nt, 'SUBTRACT', height, 0.6), 0.5), col, lin('#0b0c0d'))
    elif p == 'felt':
        height = _noise(nt, obj, 1100.0, 6, 0.7)
        bump_dist = 0.0003
        col = _mix(nt, _math(nt, 'MULTIPLY', _math(nt, 'SUBTRACT', height, 0.5), 0.6), col, lin('#202326'))
    elif p == 'wood':
        warp = _n(nt, 'ShaderNodeMapping')
        nt.links.new(obj, warp.inputs['Vector'])
        warp.inputs['Scale'].default_value = (1.0, 7.0, 7.0)
        wave = _n(nt, 'ShaderNodeTexWave', Scale=9.0, Distortion=6.0, Detail=4.0, _wave_type='RINGS', _rings_direction='X')
        wave.inputs['Detail Scale'].default_value = 1.5
        nt.links.new(warp.outputs[0], wave.inputs['Vector'])
        g = wave.outputs['Fac']
        fine = _noise(nt, warp.outputs[0], 60.0, 2)
        col = _mix(nt, _math(nt, 'MULTIPLY', _ramp(nt, g, 0.3, 0.9), 0.35), col, lin('#8a6238'))
        col = _mix(nt, _math(nt, 'MULTIPLY', fine, 0.12), col, lin('#e0c49a'))
        height = _math(nt, 'MULTIPLY', g, 0.3)
        bump_dist = 0.00006
    elif p in ('perf', 'perf_sq'):
        axis = spec.get('axis', 'auto')
        # in-plane coordinates: the face's two non-normal axes
        ax = _math(nt, 'ABSOLUTE', NX)
        ay = _math(nt, 'ABSOLUTE', NY)
        if axis == 'Z':
            # rail posts: holes run up the post, across its face
            uu = _mix(nt, _ramp(nt, ax, 0.6, 0.7), X, Y, 'FLOAT')
            holes = _dots(nt, uu, Z, spec['pitch'], spec['hole'], square=True, stagger=False)
        else:
            # faces facing Y use (X, Z); facing X use (Y, Z); facing Z use (X, Y)
            uu = _mix(nt, _ramp(nt, ax, 0.6, 0.7), X, Y, 'FLOAT')
            vv = _mix(nt, _ramp(nt, _math(nt, 'ABSOLUTE', NZ), 0.6, 0.7), Z, Y, 'FLOAT')
            holes = _dots(nt, uu, vv, spec['pitch'], spec['hole'], square=(p == 'perf_sq'), stagger=(p == 'perf'))
        # holes only where the material is (the builders keep borders solid with other parts)
        col = _mix(nt, holes, col, lin('#020203'))
        rough_s = _mix(nt, holes, rough_s, 0.95, 'FLOAT')
        height = _math(nt, 'SUBTRACT', 1.0, holes)
        bump_dist = 0.0012
    elif p == 'cable':
        # a fine lengthwise extrusion texture and a printed marking now and then
        height = _noise(nt, obj, 1500.0, 2)
        bump_dist = 0.00005
    elif p == 'pcb':
        vor = _n(nt, 'ShaderNodeTexVoronoi', Scale=180.0, _feature='DISTANCE_TO_EDGE')
        nt.links.new(obj, vor.inputs['Vector'])
        tr = _ramp(nt, vor.outputs['Distance'], 0.0, 0.05)
        col = _mix(nt, _math(nt, 'MULTIPLY', _math(nt, 'SUBTRACT', 1.0, tr), 0.5), col, lin('#3f7d47'))
        height = tr
        bump_dist = 0.00003
    elif p == 'paper':
        height = _noise(nt, obj, 600.0, 5, 0.65)
        bump_dist = 0.00008
    elif p in ('print', 'label_print'):
        # lines of "text": rows of short dark dashes
        u = _math(nt, 'MULTIPLY', X, 220.0)
        v = _math(nt, 'MULTIPLY', _math(nt, 'ADD', Y, Z), 140.0)
        row = _ramp(nt, _math(nt, 'ABSOLUTE', _math(nt, 'SUBTRACT', _math(nt, 'FRACT', v), 0.5)), 0.22, 0.12)
        word = _ramp(nt, _noise(nt, _comb(nt, u, _math(nt, 'FLOOR', v)), 1.0, 1), 0.5, 0.55)
        ink = _math(nt, 'MULTIPLY', row, word)
        col = _mix(nt, _math(nt, 'MULTIPLY', ink, 0.75), col, lin('#2a2a2e'))
        height = _noise(nt, obj, 600.0, 5, 0.65)
        bump_dist = 0.00005
    elif p == 'leather':
        vor = _n(nt, 'ShaderNodeTexVoronoi', Scale=700.0, _feature='DISTANCE_TO_EDGE')
        nt.links.new(obj, vor.inputs['Vector'])
        height = _ramp(nt, vor.outputs['Distance'], 0.0, 0.15)
        bump_dist = 0.0001
    elif p == 'leaf':
        uv = _n(nt, 'ShaderNodeUVMap')
        U, V, _ = _xyz(nt, uv.outputs[0])
        # midrib along u at v = 0.5, lateral veins slanting out from it
        mid = _ramp(nt, _math(nt, 'ABSOLUTE', _math(nt, 'SUBTRACT', V, 0.5)), 0.02, 0.0)
        lat = _math(nt, 'ADD', _math(nt, 'MULTIPLY', U, 9.0), _math(nt, 'MULTIPLY', _math(nt, 'ABSOLUTE', _math(nt, 'SUBTRACT', V, 0.5)), 7.0))
        lat = _ramp(nt, _math(nt, 'ABSOLUTE', _math(nt, 'SUBTRACT', _math(nt, 'FRACT', lat), 0.5)), 0.06, 0.0)
        veins = _math(nt, 'MAXIMUM', mid, _math(nt, 'MULTIPLY', lat, 0.6))
        col = _mix(nt, _math(nt, 'MULTIPLY', veins, 0.55), col, lin('#a9c47a'))
        edge = _ramp(nt, _math(nt, 'ABSOLUTE', _math(nt, 'SUBTRACT', V, 0.5)), 0.35, 0.5)
        col = _mix(nt, _math(nt, 'MULTIPLY', edge, 0.25), col, lin('#6b7a2e'))
        height = _math(nt, 'SUBTRACT', 1.0, veins)
        bump_dist = 0.0004
        rough_s = _mix(nt, veins, rough_s, 0.6, 'FLOAT')
    elif p == 'bark':
        sc = nt.nodes.new('ShaderNodeCombineXYZ')
        nt.links.new(_math(nt, 'MULTIPLY', X, 300.0), sc.inputs[0])
        nt.links.new(_math(nt, 'MULTIPLY', Y, 300.0), sc.inputs[1])
        nt.links.new(_math(nt, 'MULTIPLY', Z, 40.0), sc.inputs[2])
        height = _noise(nt, sc.outputs[0], 1.0, 6, 0.6)
        bump_dist = 0.0008
        col = _mix(nt, _math(nt, 'MULTIPLY', height, 0.5), lin('#3b3026'), col)
    elif p == 'soil':
        vor = _n(nt, 'ShaderNodeTexVoronoi', Scale=180.0)
        nt.links.new(obj, vor.inputs['Vector'])
        bits = vor.outputs['Distance']
        height = _math(nt, 'ADD', _math(nt, 'SUBTRACT', 1.0, bits), _math(nt, 'MULTIPLY', _noise(nt, obj, 400, 4), 0.5))
        bump_dist = 0.0015
        col = _mix(nt, _ramp(nt, _noise(nt, obj, 90.0, 3), 0.55, 0.75), col, lin('#5e4a36'))
    elif p == 'concrete':
        height = _noise(nt, obj, 300.0, 6, 0.6)
        bump_dist = 0.0002
        col = _mix(nt, _math(nt, 'MULTIPLY', _noise(nt, obj, 40.0, 4), 0.3), col, lin('#4a4e52'))

    # micro roughness on everything: no surface is perfectly even
    rough_s = _math(nt, 'ADD', rough_s, _math(nt, 'MULTIPLY', _math(nt, 'SUBTRACT', _noise(nt, obj, 140.0, 3), 0.5), 0.06))

    # smudges and polish (roughness only, big and soft)
    sm = spec.get('smudge', 0.15)
    if sm:
        s1 = _ramp(nt, _noise(nt, obj, 9.0, 5, 0.65), 0.45, 0.75)
        rough_s = _math(nt, 'ADD', rough_s, _math(nt, 'MULTIPLY', _math(nt, 'SUBTRACT', s1, 0.4), sm * 0.35))

    # cavity grime (local AO)
    cav = spec.get('cav', 0.3)
    if cav:
        ao = _n(nt, 'ShaderNodeAmbientOcclusion', Distance=0.025, _samples=8, _only_local=True)
        dirt = _math(nt, 'MULTIPLY', _math(nt, 'SUBTRACT', 1.0, _ramp(nt, ao.outputs['AO'], 0.25, 0.95)), cav)
        dirt = _math(nt, 'MULTIPLY', dirt, _ramp(nt, _noise(nt, obj, 30.0, 4), 0.25, 0.7))
        col = _mix(nt, _math(nt, 'MULTIPLY', dirt, 0.6), col, lin('#2a241e'))
        rough_s = _math(nt, 'ADD', rough_s, _math(nt, 'MULTIPLY', dirt, 0.15))

    # edge wear: curvature from a ray-traced bevel normal against the true normal
    ew = spec.get('edge', 0.0)
    if ew:
        bev = _n(nt, 'ShaderNodeBevel', Radius=0.0025, _samples=8)
        curv = _math(nt, 'SUBTRACT', 1.0, _vmath(nt, 'DOT_PRODUCT', bev.outputs[0], N))
        convex = _ramp(nt, curv, 0.01, 0.08)
        chips = _ramp(nt, _noise(nt, obj, 120.0, 8, 0.7), 0.42, 0.6)
        wear = _math(nt, 'MULTIPLY', _math(nt, 'MULTIPLY', convex, chips), ew)
        wear = _math(nt, 'MINIMUM', wear, 1.0)
        col = _mix(nt, wear, col, lin(spec.get('ec', '#888888')))
        rough_s = _mix(nt, wear, rough_s, spec.get('er', 0.35), 'FLOAT')
        metal_s = _mix(nt, wear, metal_s, spec.get('em', 0.0), 'FLOAT')

    # dust on up-facing surfaces, thicker in the open and patchy
    du = spec.get('dust', 0.2)
    if du:
        up = _ramp(nt, NZ, 0.55, 0.95)
        patch = _ramp(nt, _noise(nt, obj, 6.0, 4), 0.35, 0.7)
        speck = _noise(nt, obj, 380.0, 2)
        d = _math(nt, 'MULTIPLY', _math(nt, 'MULTIPLY', up, patch), du * 0.38)
        d = _math(nt, 'MULTIPLY', d, _math(nt, 'ADD', 0.6, _math(nt, 'MULTIPLY', speck, 0.8)))
        col = _mix(nt, d, col, lin('#9b968c'))
        rough_s = _mix(nt, d, rough_s, 0.85, 'FLOAT')
        metal_s = _mix(nt, d, metal_s, 0.0, 'FLOAT')

    rough_s = _math(nt, 'MINIMUM', _math(nt, 'MAXIMUM', rough_s, 0.03), 1.0)

    nt.links.new(col, bsdf.inputs['Base Color'])
    nt.links.new(rough_s, bsdf.inputs['Roughness'])
    nt.links.new(metal_s, bsdf.inputs['Metallic'])
    if height is not None:
        bump = _n(nt, 'ShaderNodeBump', Strength=1.0, Distance=bump_dist)
        nt.links.new(height, bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    glow = spec.get('glow')
    if glow:
        bsdf.inputs['Emission Color'].default_value = lin(glow) if isinstance(glow, str) else (*glow, 1)
        bsdf.inputs['Emission Strength'].default_value = spec.get('gs', 1.0)
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])

    emc = _n(nt, 'ShaderNodeEmission', _name='EM_C', Strength=1.0)
    nt.links.new(col, emc.inputs['Color'])
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(rough_s, comb.inputs[1])
    nt.links.new(metal_s, comb.inputs[2])
    emo = _n(nt, 'ShaderNodeEmission', _name='EM_ORM', Strength=1.0)
    nt.links.new(comb.outputs[0], emo.inputs['Color'])
    _n(nt, 'ShaderNodeEmission', _name='EM_W', Strength=1.0, Color=(1, 1, 1, 1))
    # the occlusion bake's stand-in: a plain diffuse (with the
    # bump), so the many bounces stay cheap and only the geometry decides what light gets in
    # (a fixed light grey: Cycles' lighting-only bake divides by albedo, so a near-black paint
    # would come out black)
    gi = _n(nt, 'ShaderNodeBsdfDiffuse', _name='GI', Color=(0.6, 0.6, 0.6, 1))
    if height is not None:
        nt.links.new(bump.outputs['Normal'], gi.inputs['Normal'])
    return mat


def _comb(nt, a, b):
    c = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(a, c.inputs[0])
    nt.links.new(b, c.inputs[1])
    return c.outputs[0]


def mode(mat, which):
    """Point a library material's output at 'BSDF', 'EM_C' or 'EM_ORM'."""
    nt = mat.node_tree
    node = nt.nodes.get(which)
    if node is None:
        return
    nt.links.new(node.outputs[0], nt.nodes['OUT'].inputs['Surface'])


def plain(name, c, r, glow=None, metal=0.0):
    """A flat Principled material (the lean mesh's own emissive / canvas materials)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = lin(c)
    b.inputs['Roughness'].default_value = r
    b.inputs['Metallic'].default_value = metal
    if glow:
        b.inputs['Emission Color'].default_value = (*glow, 1.0)
        b.inputs['Emission Strength'].default_value = 1.0
    return mat


_cache = {}


def get(name):
    """The high-poly library material by name (built once per session)."""
    m = _cache.get(name)
    if m is None or m.name not in bpy.data.materials:
        if name in EMISSIVE:
            s = EMISSIVE[name]
            m = plain('hp.' + name, s['c'], s['r'], s['glow'])
        elif name in CANVAS:
            s = CANVAS[name]
            m = plain('hp.' + name, s['c'], s['r'])
        else:
            m = build(name, SPECS[name])
        _cache[name] = m
    return m
