"""Builds the airliner of the landing chapter (blender/bld/airliner.py).

    python blender/make_airliner.py                 # both tiers and the livery maps
    python blender/make_airliner.py --render DIR    # ...and Cycles previews of the HIGH model into DIR

Writes into public/models/airliner/:

    airliner.glb        the close model (HIGH tier), ~60k triangles
    airliner-low.glb    the phone model (LOW tier), about a third of that, no fan blades or panel lines
    livery.webp         2048 square livery atlas: the fuselage unrolled into the top half (u along the
                        hull nose-right, v round it from the keel up the starboard side), the fin and
                        rudder projected side-on into the bottom half
    livery-low.webp     the same at 1024
    glow.webp           the cabin windows lit, same layout, 1024 (the skin's emissive map)

then `node scripts/compress-models.mjs` packs the GLBs (meshopt, as the city's).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from bld import airliner as A  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'airliner')
FONT = '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'

# painting is done at twice the shipped size and filtered down
WF, HF = 4096, 2048            # the fuselage: u along the hull, phi round it
Z_TOP, Z_BOT, PPM_Z = 2.3, -2.3, 220.0
HE = int((Z_TOP - Z_BOT) * PPM_Z)
FIN_H = 4096 - 2080            # the fin's rows (the atlas' lower half, under a 32-row margin)

L = A.L


def hexrgb(h, a=255):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


NAVY, SKY, WHITE = hexrgb(A.HEX['navy']), hexrgb(A.HEX['sky']), hexrgb(A.HEX['white'])
GLASS, FRAME, SEAM = hexrgb('#1b2531'), hexrgb('#b4bcc6'), hexrgb('#9ba4af')


def ex(s):
    return (L - s) / L * WF


def ez(z):
    return (Z_TOP - z) * PPM_Z


def z_line(s):
    """top of the navy belly: low under the cockpit, level along the cabin, sweeping up over the tail"""
    base = A.lerp(-0.62, -1.05, A.smooth(0.0, 3.0, s))
    return base + 3.5 * A.smooth(19.0, 33.8, s) ** 1.25


def rrect(d, s0, s1, z0, z1, r, fill=None, outline=None, width=0):
    d.rounded_rectangle([ex(s1), ez(z1), ex(s0), ez(z0)], radius=r * PPM_Z, fill=fill, outline=outline, width=width)


def text_at(img, txt, size_m, s_left, z_base, colour, mirror):
    """Words on the hull, reading tail to nose on the starboard side and nose to tail on port.
    s_left is the station under the first letter (the tail end of the word on starboard)."""
    font = ImageFont.truetype(FONT, int(size_m * PPM_Z * 1.38))
    box = font.getbbox(txt)
    w, h = box[2] - box[0] + 8, box[3] - box[1] + 8
    # the hull is drawn at PPM_Z vertically but WF/L horizontally: squeeze the word to match
    sx = (WF / L) / PPM_Z
    tile = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(tile).text((4 - box[0], 4 - box[1]), txt, font=font, fill=colour)
    tile = tile.resize((max(1, int(w * sx)), h), Image.LANCZOS)
    if mirror:
        tile = tile.transpose(Image.FLIP_LEFT_RIGHT)
    x = int(ex(s_left)) if not mirror else int(ex(s_left)) - tile.width
    img.alpha_composite(tile, (x if not mirror else x, int(ez(z_base)) - h + 4))
    return tile.width / (WF / L)


def elevation(side, glow=False):
    """The hull seen side-on (u along it, z up), for one side: belly, windows, doors, titles."""
    img = Image.new('RGBA', (WF, HE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    win = [7.15 + 0.533 * k for k in range(41)]
    if glow:
        for s in win:
            rrect(d, s - 0.115, s + 0.115, 0.15, 0.48, 0.09, fill=(255, 205, 140, 255))
        for s0, s1, z0 in ((5.45, 5.77, 0.28), (30.40, 30.72, 0.38)):
            rrect(d, s0, s1, z0, z0 + 0.28, 0.08, fill=(255, 205, 140, 200))
        return img
    # the navy belly and its sky pinstripe
    ss = np.linspace(0, L, 900)
    top = [(ex(s), ez(z_line(s))) for s in ss]
    d.polygon(top + [(ex(L), HE), (ex(0), HE)], fill=NAVY)
    stripe = [(ex(s), ez(z_line(s) + 0.11)) for s in ss] + [(ex(s), ez(z_line(s) + 0.2)) for s in ss[::-1]]
    d.polygon(stripe, fill=SKY)
    # cabin windows
    for s in win:
        rrect(d, s - 0.135, s + 0.135, 0.13, 0.5, 0.1, fill=FRAME)
        rrect(d, s - 0.115, s + 0.115, 0.15, 0.48, 0.09, fill=GLASS)
    # doors: forward and aft passenger doors with their windows, the overwing exits
    for s0, s1, z0, z1 in ((5.2, 6.02, -0.8, 1.1), (30.15, 30.97, -0.62, 1.2)):
        rrect(d, s0, s1, z0, z1, 0.14, outline=SEAM, width=5)
        rrect(d, s0 + 0.25, s1 - 0.25, z1 - 0.82, z1 - 0.54, 0.08, fill=GLASS)
        rrect(d, s0 + 0.08, s0 + 0.2, 0.1, 0.16, 0.02, fill=SEAM)
    for s0 in (15.22, 16.02):
        rrect(d, s0, s0 + 0.52, -0.2, 0.84, 0.12, outline=SEAM, width=5)
    if side > 0:
        # cargo doors, starboard only: in the navy, so a lighter seam
        for s0, s1, z0, z1 in ((8.3, 10.1, -1.85, -0.6), (23.9, 25.7, -1.75, -0.55), (27.3, 28.05, -1.25, -0.5)):
            rrect(d, s0, s1, z0, z1, 0.12, outline=hexrgb('#4a69a8'), width=5)
    # titles and registration
    mirror = side < 0
    if not mirror:
        text_at(img, 'EmailPilots', 0.74, 18.2, 0.76, NAVY, False)
    else:
        text_at(img, 'EmailPilots', 0.74, 7.6, 0.76, NAVY, True)
    text_at(img, 'N320EP', 0.3, 33.6 if not mirror else 31.2, 0.25, WHITE, mirror)
    return img


def remap(elev_s, elev_p, out_rows=HF):
    """Wrap the two side elevations round the hull: each (u, phi) texel takes the elevation colour
    at the height where the hull passes it."""
    es = np.asarray(elev_s, dtype=np.float32)
    ep = np.asarray(elev_p, dtype=np.float32)
    cols = np.arange(WF)
    s = L * (1 - (cols + 0.5) / WF)
    dims = np.array([A.fus_dims(v) for v in s], dtype=np.float32)
    _, top, bot = dims.T
    zc, h = (top + bot) / 2, (top - bot) / 2
    out = np.zeros((out_rows, WF, 4), np.float32)
    half = out_rows // 2
    for r0, r1, src in ((0, half, es), (half, out_rows, ep)):
        phi = (np.arange(r0, r1) + 0.5) / out_rows * math.tau
        z = zc[None, :] - h[None, :] * np.cos(phi)[:, None]
        ye = (Z_TOP - z) * PPM_Z
        y0 = np.clip(np.floor(ye).astype(np.int32), 0, HE - 2)
        f = np.clip(ye - y0, 0, 1)[..., None]
        cc = np.broadcast_to(cols, y0.shape)
        out[r0:r1] = src[y0, cc] * (1 - f) + src[y0 + 1, cc] * f
    return out


def over(base, layer):
    a = layer[..., 3:4] / 255.0
    base[..., :3] = base[..., :3] * (1 - a) + layer[..., :3] * a
    return base


def fs_px(s, phi):
    """a station and hull angle to fuselage texel"""
    return (L - s) / L * WF, phi / math.tau * HF


def paint_fuselage():
    base = np.zeros((HF, WF, 3), np.float32)
    base[:] = WHITE[:3]
    over(base, remap(elevation(1), elevation(-1)))
    img = Image.fromarray(base.clip(0, 255).astype(np.uint8), 'RGB')
    d = ImageDraw.Draw(img, 'RGBA')
    # skin joints: frames round the hull and lap joints along it, barely there
    for s in (1.75, 6.9, 9.6, 12.4, 18.6, 22.1, 25.3, 28.2, 32.0):
        d.line([fs_px(s, 0), fs_px(s, math.tau)], fill=(0, 0, 0, 20), width=3)
    for phi in (math.pi - 0.95, math.pi - 0.45, math.pi + 0.45, math.pi + 0.95, 0.55, math.tau - 0.55):
        d.line([fs_px(6.4, phi), fs_px(30.0, phi)], fill=(0, 0, 0, 16), width=3)
    # the black mask round the cockpit windows (the glass sits on it, the posts are the gaps)
    for win in A.cockpit_windows():
        for mirror in (False, True):
            pts = [fs_px(s, math.tau - f if mirror else f) for s, f in win]
            d.polygon(pts, fill=hexrgb('#14171c'), outline=hexrgb('#14171c'), width=22)
    # the radome's joint, a touch darker
    d.line([fs_px(1.72, 0), fs_px(1.72, math.tau)], fill=(0, 0, 0, 34), width=4)
    return img


def fin_px(s, z):
    s0, s1, z0, z1 = A.ATLAS_FIN
    return (s - s0) / (s1 - s0) * WF, (z1 - z) / (z1 - z0) * FIN_H


def bez(p0, p1, p2, n=60):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in np.linspace(0, 1, n)]


def paint_fin():
    img = Image.new('RGB', (WF, FIN_H), NAVY[:3])
    d = ImageDraw.Draw(img, 'RGBA')
    # a sky-blue band sweeping up the rudder, with a white pinstripe ahead of it
    a = bez((34.35, 1.2), (33.85, 4.6), (35.3, 8.6))
    b = bez((35.2, 1.2), (34.7, 4.6), (36.15, 8.6))
    d.polygon([fin_px(*p) for p in a + b[::-1]], fill=SKY)
    w = bez((34.12, 1.2), (33.62, 4.6), (35.07, 8.6))
    d.polygon([fin_px(*p) for p in w + a[::-1]], fill=WHITE)
    # the mark: a paper dart climbing forward, folded down its keel
    c = np.array([32.8, 4.45])
    v = np.array([-0.45, 0.893])
    p = np.array([v[1], -v[0]])
    nose, tail = c + v * 1.25, c - v * 0.85
    tip_a, tip_b = tail + p * 0.75 - v * 0.05, tail - p * 0.75 - v * 0.05
    keel = tail + v * 0.22
    d.polygon([fin_px(*q) for q in (nose, tip_a, keel)], fill=WHITE)
    d.polygon([fin_px(*q) for q in (nose, keel, tip_b)], fill=hexrgb('#cfe0f5'))
    d.line([fin_px(*nose), fin_px(*keel)], fill=hexrgb('#9fbbe0'), width=6)
    return img


def paint(out_dir):
    fus = paint_fuselage()
    fin = paint_fin()
    atlas = Image.new('RGB', (4096, 4096), NAVY[:3])
    atlas.paste(fus, (0, 0))
    atlas.paste(fin, (0, 2080))
    sizes = {}
    for name, px in (('livery.webp', 2048), ('livery-low.webp', 1024)):
        path = os.path.join(out_dir, name)
        atlas.resize((px, px), Image.LANCZOS).save(path, 'WEBP', quality=90, method=6)
        sizes[name] = os.path.getsize(path)
    g = np.zeros((4096, 4096, 3), np.float32)
    gl = remap(elevation(1, glow=True), elevation(-1, glow=True))
    g[:HF] = gl[..., :3] * (gl[..., 3:4] / 255.0)
    path = os.path.join(out_dir, 'glow.webp')
    Image.fromarray(g.clip(0, 255).astype(np.uint8), 'RGB').resize((1024, 1024), Image.LANCZOS).save(
        path, 'WEBP', quality=85, method=6)
    sizes['glow.webp'] = os.path.getsize(path)
    return sizes


def export(detail, path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    coll = bpy.context.scene.collection
    objs = A.build(coll, detail)
    bpy.ops.object.select_all(action='DESELECT')
    for o in coll.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False,
        export_materials='NONE', export_texcoords=True, export_normals=True, export_yup=True,
        export_cameras=False, export_lights=False, export_vertex_color='ACTIVE',
    )
    tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs}
    return tris


def preview(out_dir, render_dir):
    """Cycles stills of the HIGH model as built (call right after export('high'))."""
    scene = bpy.context.scene
    coll = scene.collection
    img = bpy.data.images.load(os.path.join(out_dir, 'livery.webp'))
    glow = bpy.data.images.load(os.path.join(out_dir, 'glow.webp'))

    def mat(name, metallic=0.0, rough=0.4, tex=None, emit=None, coat=0.0, colour=None):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes['Principled BSDF']
        if tex:
            t = nt.nodes.new('ShaderNodeTexImage')
            t.image = tex
            nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
            g = nt.nodes.new('ShaderNodeTexImage')
            g.image = glow
            nt.links.new(g.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = 0.6
        elif colour:
            bsdf.inputs['Base Color'].default_value = colour
        else:
            a = nt.nodes.new('ShaderNodeVertexColor')
            a.layer_name = 'Col'
            nt.links.new(a.outputs['Color'], bsdf.inputs['Base Color'])
            if emit:
                nt.links.new(a.outputs['Color'], bsdf.inputs['Emission Color'])
                bsdf.inputs['Emission Strength'].default_value = emit
        bsdf.inputs['Metallic'].default_value = metallic
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Coat Weight'].default_value = coat
        return m

    mats = {
        'skin': mat('skin', 0.0, 0.3, tex=img, coat=0.6), 'paint': mat('paint', 0.05, 0.38, coat=0.3),
        'metal': mat('metal', 0.9, 0.28), 'dark': mat('dark', 0.2, 0.6),
        'glass': mat('glass', 0.8, 0.05, colour=(0.01, 0.015, 0.02, 1)), 'lit': mat('lit', emit=6.0),
        'fan': mat('fan', 0.7, 0.35), 'gear_paint': mat('gp', 0.05, 0.45), 'gear_metal': mat('gm', 0.9, 0.25),
        'wheel': mat('wheel', 0.2, 0.6),
    }
    for o in list(coll.objects):
        if o.type != 'MESH':
            continue
        key = 'fan' if o.name.startswith('fan') else 'wheel' if o.name.startswith('wheel') else o.name
        o.data.materials.append(mats.get(key, mats['paint']))
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, -0.72))
    ground = bpy.context.active_object
    gm = bpy.data.materials.new('ground')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.09, 0.09, 0.1, 1)
    ground.data.materials.append(gm)
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.2
    sun.angle = 0.03
    so = bpy.data.objects.new('sun', sun)
    so.rotation_euler = (math.radians(50), math.radians(-12), math.radians(-140))
    coll.objects.link(so)
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.42, 0.5, 0.62, 1)
    bg.inputs['Strength'].default_value = 0.8
    scene.world = world
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.view_settings.view_transform = 'AgX'
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    coll.objects.link(cam)
    scene.camera = cam
    from mathutils import Vector
    views = {
        'three_quarter': ((6.2, -6.4, 1.2), (0.3, 0, -0.1), 40),
        'side': ((0.0, -11.5, 0.0), (0.0, 0, 0.1), 45),
        'rear': ((-7.5, 5.5, 2.6), (-0.4, 0, 0), 40),
        'nose': ((5.6, -1.9, 0.35), (3.1, 0, 0.0), 40),
        'engine': ((3.4, -3.0, -0.45), (1.2, -1.1, -0.35), 40),
        'top': ((1.0, -2.0, 9.0), (0.0, 0, 0), 50),
        'fin': ((-2.0, -4.2, 1.2), (-3.0, 0, 0.9), 45),
        'cockpit': ((4.9, -1.2, 0.55), (3.2, 0, 0.15), 45),
        'front': ((6.6, 0.0, 0.35), (3.0, 0, 0.12), 60),
        'gear': ((1.6, -2.6, -0.45), (0.4, -0.5, -0.5), 40),
    }
    pick = os.environ.get('VIEWS')
    for name, (eye, at, lens) in views.items():
        if pick and name not in pick.split(','):
            continue
        cam.location = eye
        cam.data.lens = lens * 0.6
        d = Vector(at) - Vector(eye)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(render_dir, f'{name}.png')
        bpy.ops.render.render(write_still=True)
        print('rendered', scene.render.filepath)


def main():
    os.makedirs(OUT, exist_ok=True)
    render_dir = None
    if '--render' in sys.argv:
        render_dir = sys.argv[sys.argv.index('--render') + 1]
        os.makedirs(render_dir, exist_ok=True)
    if '--no-paint' not in sys.argv:
        print('maps', {k: f'{v // 1024} KB' for k, v in paint(OUT).items()})
    for detail, name in (('low', 'airliner-low.glb'), ('high', 'airliner.glb')):
        path = os.path.join(OUT, name)
        tris = export(detail, path)
        print(f'{name}: {sum(tris.values())} tris, {os.path.getsize(path) // 1024} KB:',
              ', '.join(f'{k} {v}' for k, v in tris.items()))
    if render_dir:
        preview(OUT, render_dir)


main()
