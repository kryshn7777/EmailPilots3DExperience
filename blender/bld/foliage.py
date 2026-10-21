"""Leaf-cluster cards: the texture a hero tree's canopy is made of.

A realistic canopy is a few hundred small cards, each showing a twig with a dozen
or two real leaves. Each card here is a Cycles render of an actual 3D twig, built
leaf by leaf (a lobed or ovate blade with a bent midrib and cupped surface, a
petiole, a colour gradient and veins), lit by a uniform white sky so the leaves
shade each other where they overlap, on a transparent film. The result is an
albedo-with-occlusion RGBA image; the runtime does the lighting.

Species: oak (lobed), maple (palmate, autumn), poplar (small ovate), pine (needle
spray). Two variants of each so a canopy does not repeat a single card.
"""
import math
import os
import random
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from PIL import Image

SIZE = 512            # delivered card size
RENDER = 1024         # rendered at 2x and filtered down
FRAME = 1.3           # metres across the ortho camera


# -- leaf blades -------------------------------------------------------------------

def _lobed(theta, kind):
    """Radius multiplier around a leaf's centre for the lobed species."""
    if kind == 'oak':      # seven rounded lobes
        return 0.62 + 0.38 * abs(math.cos(3.5 * theta))
    # maple: five pointed lobes
    return 0.30 + 0.70 * max(0.0, math.cos(2.5 * theta)) ** 1.6


def _polar_leaf(bm, uv, R, kind, curl, rng):
    """Star-shaped blade fanned out from its centre; fine rings so it can bend."""
    n, rings = 26, 4
    centre = bm.verts.new((0, 0, 0))
    ring_verts = []
    for k in range(1, rings + 1):
        row = []
        for i in range(n):
            th = 2 * math.pi * i / n
            r = R * _lobed(th, kind) * k / rings
            x, y = r * math.cos(th), r * math.sin(th)
            row.append(bm.verts.new((x, y, 0)))
        ring_verts.append(row)
    faces = []
    for i in range(n):
        faces.append([centre, ring_verts[0][i], ring_verts[0][(i + 1) % n]])
    for k in range(rings - 1):
        for i in range(n):
            j = (i + 1) % n
            faces.append([ring_verts[k][i], ring_verts[k + 1][i], ring_verts[k + 1][j], ring_verts[k][j]])
    for f in faces:
        face = bm.faces.new(f)
        for loop in face.loops:
            p = loop.vert.co
            loop[uv].uv = (p.x / (2 * R) + 0.5, p.y / (2 * R) + 0.5)
    for v in bm.verts:
        d = math.hypot(v.co.x, v.co.y)
        v.co.z = curl * R * (d / R) ** 2


def _ovate_leaf(bm, uv, L, W, curl):
    """Pointed oval blade along +x with a creased midrib."""
    nu, nv = 9, 4
    grid = []
    for i in range(nu + 1):
        t = i / nu
        w = W * math.sin(math.pi * t ** 0.8) ** 0.8
        row = []
        for j in range(nv + 1):
            s = j / nv * 2 - 1
            z = curl * L * (s * s) * 0.5 - 0.10 * L * abs(s) * w / max(W, 1e-6) - 0.10 * L * t * t
            row.append(bm.verts.new((t * L, s * w, z)))
        grid.append(row)
    for i in range(nu):
        for j in range(nv):
            f = bm.faces.new([grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]])
            for loop in f.loops:
                p = loop.vert.co
                loop[uv].uv = (p.x / L, p.y / (2 * W) + 0.5)


def _leaf_material(name, base, tip, vein):
    """Colour gradient from stem to tip, a different tone per leaf, a pale midrib."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = 0.8
    bsdf.inputs['Specular IOR Level'].default_value = 0.0
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    uv = nt.nodes.new('ShaderNodeUVMap')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(uv.outputs['UV'], sep.inputs['Vector'])
    grad = nt.nodes.new('ShaderNodeValToRGB')
    grad.color_ramp.elements[0].color = (*base, 1)
    grad.color_ramp.elements[1].color = (*tip, 1)
    nt.links.new(sep.outputs['X'], grad.inputs['Fac'])

    geo = nt.nodes.new('ShaderNodeNewGeometry')
    tone = nt.nodes.new('ShaderNodeMapRange')
    tone.inputs['To Min'].default_value = 0.74
    tone.inputs['To Max'].default_value = 1.22
    nt.links.new(geo.outputs['Random Per Island'], tone.inputs['Value'])
    grey = nt.nodes.new('ShaderNodeCombineColor')
    for ch in ('Red', 'Green', 'Blue'):
        nt.links.new(tone.outputs['Result'], grey.inputs[ch])
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs[0].default_value = 1.0
    nt.links.new(grad.outputs['Color'], mul.inputs[6])
    nt.links.new(grey.outputs['Color'], mul.inputs[7])

    # midrib: lighter along the centre line v = 0.5
    sub = nt.nodes.new('ShaderNodeMath')
    sub.operation = 'SUBTRACT'
    sub.inputs[1].default_value = 0.5
    nt.links.new(sep.outputs['Y'], sub.inputs[0])
    ab = nt.nodes.new('ShaderNodeMath')
    ab.operation = 'ABSOLUTE'
    nt.links.new(sub.outputs['Value'], ab.inputs[0])
    rib = nt.nodes.new('ShaderNodeMapRange')
    rib.inputs['From Min'].default_value = 0.0
    rib.inputs['From Max'].default_value = 0.045
    rib.inputs['To Min'].default_value = 0.55
    rib.inputs['To Max'].default_value = 0.0
    rib.clamp = True
    nt.links.new(ab.outputs['Value'], rib.inputs['Value'])
    light = nt.nodes.new('ShaderNodeMix')
    light.data_type = 'RGBA'
    light.blend_type = 'MIX'
    nt.links.new(rib.outputs['Result'], light.inputs[0])
    nt.links.new(mul.outputs[2], light.inputs[6])
    light.inputs[7].default_value = (*[min(c * 2.2 + 0.05, 1.0) for c in tip], 1)
    nt.links.new(light.outputs[2], bsdf.inputs['Base Color'])
    return mat


def _srgb(h):
    h = h.lstrip('#')
    out = []
    for i in (0, 2, 4):
        s = int(h[i:i + 2], 16) / 255.0
        out.append(s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4)
    return tuple(out)


# -- species -----------------------------------------------------------------------

SPECIES = {
    'oak':    dict(kind='oak', size=0.15, count=34, base='#3e6a2a', tip='#7fa84a', vein='#2d4d1d'),
    'maple':  dict(kind='maple', size=0.135, count=28, base='#9a3f1c', tip='#d9892f', vein='#6b2a12'),
    'poplar': dict(kind='ovate', size=0.13, count=46, base='#5f8a35', tip='#a8c768', vein='#46682a'),
    'pine':   dict(kind='needle', size=0.17, count=22, base='#233f2a', tip='#4f8050', vein='#1a2f20'),
}


def _build_twig(species, seed, bm, uv, collection_mats):
    """Fill `bm` with a twig and its leaves lying (loosely) in the XZ plane."""
    sp = SPECIES[species]
    rng = random.Random(f'{species}{seed}')
    # the twig: a gentle arc from the left edge toward the middle
    pts = [Vector((-0.58 + 1.1 * t, 0.0, -0.18 + 0.30 * math.sin(t * 2.1) + rng.uniform(-0.03, 0.03)))
           for t in (i / 7 for i in range(8))]
    twig_faces = []
    for a, b in zip(pts, pts[1:]):
        d = (b - a)
        side = d.cross(Vector((0, 1, 0))).normalized() * 0.008
        f = bm.faces.new([bm.verts.new(a - side), bm.verts.new(b - side),
                          bm.verts.new(b + side), bm.verts.new(a + side)])
        twig_faces.append(f)
    leaves = []
    if sp['kind'] == 'needle':
        # a spray: side branchlets, each carrying a fan of needles
        for k in range(sp['count']):
            t = (k + rng.uniform(0.0, 0.5)) / sp['count']
            base = pts[min(7, int(t * 7))] + Vector((0.0, rng.uniform(-0.04, 0.04), 0))
            side = 1 if k % 2 == 0 else -1
            ang = math.radians(rng.uniform(40, 75)) * side
            for n in range(38):
                a2 = ang + math.radians(rng.uniform(-28, 28))
                ln = sp['size'] * rng.uniform(0.85, 1.25)
                dirv = Vector((math.sin(a2) * 0.55 + 0.45, rng.uniform(-0.25, 0.25), math.cos(a2)))
                dirv.normalize()
                origin = base + Vector((rng.uniform(-0.05, 0.05), 0, rng.uniform(-0.01, 0.01)))
                perp = dirv.cross(Vector((0, 1, 0))).normalized() * 0.0035
                tip = origin + dirv * ln
                f = bm.faces.new([bm.verts.new(origin - perp), bm.verts.new(origin + perp),
                                  bm.verts.new(tip)])
                leaves.append(f)
        return twig_faces, leaves
    for k in range(sp['count']):
        t = (k + rng.uniform(-0.2, 0.4)) / sp['count']
        t = min(max(t, 0.0), 1.0)
        base = pts[min(7, int(t * 7))]
        side = 1 if k % 2 == 0 else -1
        yaw = math.radians(rng.uniform(35, 80)) * side + rng.uniform(-0.2, 0.2)
        size = sp['size'] * rng.uniform(0.7, 1.25) * (1.15 - 0.35 * t * 0)
        tmp = bmesh.new()
        tuv = tmp.loops.layers.uv.new('UVMap')
        curl = rng.uniform(0.04, 0.16)
        if sp['kind'] in ('oak', 'maple'):
            _polar_leaf(tmp, tuv, size, sp['kind'], curl, rng)
        else:
            _ovate_leaf(tmp, tuv, size * 1.5, size * 0.55, curl)
        # blade frame: built in local XY with +x along its length; Rx(90 deg) lays it
        # into the card plane (local y -> world z, local z -> world -y), Ry swings it
        # within that plane, and a pitch tilts it out of the plane toward the camera
        pitch = math.radians(rng.uniform(-32, 32))
        roll = rng.uniform(0, 2 * math.pi) if sp['kind'] in ('oak', 'maple') else 0.0
        rot = (Matrix.Rotation(yaw, 4, 'Y') @ Matrix.Rotation(math.pi / 2, 4, 'X')
               @ Matrix.Rotation(pitch, 4, 'X') @ Matrix.Rotation(roll, 4, 'Z'))
        off = Vector((rng.uniform(-0.02, 0.02), rng.uniform(-0.05, 0.05), 0.0))
        for v in tmp.verts:
            v.co = rot @ v.co + base + off
        # copy into the shared bmesh
        vmap = {v: bm.verts.new(v.co) for v in tmp.verts}   # indices of new bmesh verts are stale
        for f in tmp.faces:
            nf = bm.faces.new([vmap[v] for v in f.verts])
            for nl, ol in zip(nf.loops, f.loops):
                nl[uv].uv = ol[tuv].uv
            leaves.append(nf)
        tmp.free()
    return twig_faces, leaves


def render_card(species, seed, work):
    """One RGBA leaf-cluster card as a (SIZE, SIZE, 4) uint8 array, straight alpha."""
    sp = SPECIES[species]
    scene = bpy.data.scenes.new(f'card.{species}.{seed}')
    world = bpy.data.worlds.new(f'cardsky.{species}.{seed}')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (1, 1, 1, 1)
    bg.inputs['Strength'].default_value = 1.0
    scene.world = world

    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    twig_faces, leaves = _build_twig(species, seed, bm, uv, None)
    mesh = bpy.data.meshes.new('twig')
    bm.to_mesh(mesh)
    twig_n = len(twig_faces)
    bm.free()
    leaf_mat = _leaf_material(f'leaf.{species}', _srgb(sp['base']), _srgb(sp['tip']), _srgb(sp['vein']))
    twig_mat = bpy.data.materials.new('twig')
    twig_mat.use_nodes = True
    twig_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*_srgb('#4a3a2a'), 1)
    twig_mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    mesh.materials.append(twig_mat)
    mesh.materials.append(leaf_mat)
    for i, poly in enumerate(mesh.polygons):
        poly.material_index = 0 if i < twig_n else 1
    obj = bpy.data.objects.new('twig', mesh)
    scene.collection.objects.link(obj)

    cam_data = bpy.data.cameras.new('cardcam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = FRAME
    cam = bpy.data.objects.new('cardcam', cam_data)
    cam.location = (0, -4, 0)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.collection.objects.link(cam)
    scene.camera = cam

    r = scene.render
    r.engine = 'CYCLES'
    r.resolution_x = r.resolution_y = RENDER
    r.resolution_percentage = 100
    r.film_transparent = True
    r.image_settings.file_format = 'PNG'
    r.image_settings.color_mode = 'RGBA'
    r.image_settings.color_depth = '8'
    scene.view_settings.view_transform = 'Standard'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 40
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 3
    path = os.path.join(work, f'{species}{seed}.png')
    r.filepath = path
    bpy.ops.render.render(write_still=True, scene=scene.name)
    img = Image.open(path).convert('RGBA').resize((SIZE, SIZE), Image.LANCZOS)
    arr = np.asarray(img).astype(np.float32) / 255.0
    arr = _bleed(arr)
    return (arr * 255 + 0.5).astype(np.uint8)


def _bleed(rgba, iterations=10):
    """Spread colour into transparent pixels so mip-mapping and filtering never
    pull a dark fringe in from the empty background."""
    rgb, a = rgba[..., :3].copy(), rgba[..., 3]
    known = a > 0.02
    for _ in range(iterations):
        pad_rgb = np.pad(rgb, ((1, 1), (1, 1), (0, 0)), mode='edge')
        pad_k = np.pad(known, ((1, 1), (1, 1)), mode='constant')
        acc = np.zeros_like(rgb)
        cnt = np.zeros(known.shape, np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                k = pad_k[1 + dy:1 + dy + known.shape[0], 1 + dx:1 + dx + known.shape[1]]
                v = pad_rgb[1 + dy:1 + dy + known.shape[0], 1 + dx:1 + dx + known.shape[1]]
                acc += v * k[..., None]
                cnt += k
        grow = (~known) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        known = known | grow
    out = rgba.copy()
    out[..., :3] = rgb
    return out


def all_cards():
    """{(species, variant): uint8 RGBA (SIZE, SIZE, 4)}"""
    work = tempfile.mkdtemp(prefix='cards')
    cards = {}
    for species in ('oak', 'maple', 'poplar', 'pine'):
        for variant in (0, 1):
            cards[(species, variant)] = render_card(species, variant, work)
    return cards
