"""Bakes the sky the buildings sit in: a volumetric cloud sea below, broken
cumulus above, a physical sky between, path-traced in Cycles into one
equirectangular HDR.

    python blender/make_cloud_env.py [--width 1024] [--samples 128]

Why an environment map and not lightmaps: glass reflects whatever is around
it, and a facade is lit from every direction at once, including from below by
the cloud sea the district stands in. Both are view- and orientation-dependent
in ways a texture on an instanced, four-way-rotated module cannot hold, but an
environment map holds them exactly: the runtime's image-based lighting turns
it into diffuse light and sharp-to-blurry reflections per material roughness.

The sun is deliberately NOT in the picture. Its direction changes every
chapter and the engine already lights with a real directional light; a sun
baked into the map would double the light and point the wrong way. The sun
still lights the clouds here (so they glow and have silver edges on the sun
side), it is only the disc and its glare that are left out.
"""
import argparse
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def parse():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument('--out', default=os.path.join(ROOT, 'public', 'hdri', 'cloud_env_1k.hdr'))
    p.add_argument('--width', type=int, default=1024)
    p.add_argument('--samples', type=int, default=128)
    p.add_argument('--seed', type=float, default=7.0)
    # the chapter grades were tuned against a dim night HDRI (mean luminance
    # ~0.07, upper half ~0.12); this keeps the baked sky in the same range so
    # the per-chapter envIntensity values keep meaning what they meant
    p.add_argument('--target-mean', type=float, default=0.30)
    # cost knobs: volume scattering dominates the render time
    p.add_argument('--detail', type=float, default=6.0, help='noise octaves per density sample')
    p.add_argument('--vbounces', type=int, default=2)
    p.add_argument('--step-rate', type=float, default=2.0)
    p.add_argument('--max-steps', type=int, default=128)
    # sun direction in the SITE's coordinates (x forward along the flight, y up)
    p.add_argument('--sun', default='0.62,0.25,0.10')
    p.add_argument('--preview', help='write a tone-mapped PNG here')
    return p.parse_args(argv)


def node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def cloud_material(name, base_z, thickness, scale_m, threshold, softness, density, aniso,
                   seed, bottom_flat=0.18, detail=6.0):
    """Volume shader: world-space fractal noise thresholded into puffs, shaped
    by a vertical profile (flat base, rounded top), scattered like water."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    pos = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(pos.outputs['Position'], sep.inputs['Vector'])

    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1 / scale_m, 1 / scale_m, 1 / (scale_m * 1.6))
    mapping.inputs['Location'].default_value = (seed * 3.1, seed * 1.7, seed * 0.9)
    nt.links.new(pos.outputs['Position'], mapping.inputs['Vector'])
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.noise_dimensions = '3D'
    noise.inputs['Detail'].default_value = detail
    noise.inputs['Roughness'].default_value = 0.62
    noise.inputs['Lacunarity'].default_value = 2.15
    noise.inputs['Distortion'].default_value = 0.35
    nt.links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
    shape = nt.nodes.new('ShaderNodeMapRange')
    shape.inputs['From Min'].default_value = threshold
    shape.inputs['From Max'].default_value = threshold + softness
    shape.clamp = True
    nt.links.new(noise.outputs['Fac'], shape.inputs['Value'])

    # height 0..1 through the slab; sin() gives a soft top and bottom, and the
    # sqrt pulls the profile toward a flat, dense base like real cumulus
    h = nt.nodes.new('ShaderNodeMapRange')
    h.inputs['From Min'].default_value = base_z
    h.inputs['From Max'].default_value = base_z + thickness
    h.clamp = True
    nt.links.new(sep.outputs['Z'], h.inputs['Value'])
    prof = nt.nodes.new('ShaderNodeMath')
    prof.operation = 'MULTIPLY'
    prof.inputs[1].default_value = math.pi
    nt.links.new(h.outputs['Result'], prof.inputs[0])
    sine = nt.nodes.new('ShaderNodeMath')
    sine.operation = 'SINE'
    nt.links.new(prof.outputs['Value'], sine.inputs[0])
    flat = nt.nodes.new('ShaderNodeMath')
    flat.operation = 'POWER'
    flat.inputs[1].default_value = bottom_flat * 2.0 + 0.25
    nt.links.new(sine.outputs['Value'], flat.inputs[0])

    both = nt.nodes.new('ShaderNodeMath')
    both.operation = 'MULTIPLY'
    nt.links.new(shape.outputs['Result'], both.inputs[0])
    nt.links.new(flat.outputs['Value'], both.inputs[1])
    dens = nt.nodes.new('ShaderNodeMath')
    dens.operation = 'MULTIPLY'
    dens.inputs[1].default_value = density
    nt.links.new(both.outputs['Value'], dens.inputs[0])

    vol = nt.nodes.new('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    vol.inputs['Anisotropy'].default_value = aniso
    nt.links.new(dens.outputs['Value'], vol.inputs['Density'])
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(vol.outputs['Volume'], out.inputs['Volume'])
    return mat


def slab(name, base_z, thickness, extent, material):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, base_z + thickness / 2))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (extent, extent, thickness)
    obj.data.materials.append(material)
    return obj


def main():
    args = parse()
    started = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    sx, sy, sz = (float(v) for v in args.sun.split(','))
    # site (x, y up, z) -> Blender (x, -z, y up is Blender z)
    sun_dir = Vector((sx, -sz, sy)).normalized()

    # -- sky ------------------------------------------------------------------
    world = bpy.data.worlds.new('sky')
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new('ShaderNodeTexSky')
    kinds = [e.identifier for e in sky.bl_rna.properties['sky_type'].enum_items]
    sky.sky_type = next(k for k in ('MULTIPLE_SCATTERING', 'NISHITA') if k in kinds)
    sky.sun_disc = False
    # the node ignores `sun_direction` (it is derived); its own convention is
    # azimuth = 90 deg - rotation, measured counter-clockwise from +X
    az = math.atan2(sun_dir.y, sun_dir.x)
    sky.sun_elevation = math.asin(sun_dir.z)
    sky.sun_rotation = math.radians(90) - az
    sky.altitude = 2500.0
    sky.air_density = 1.0
    sky.aerosol_density = 2.2
    sky.ozone_density = 1.0
    bg = nt.nodes.new('ShaderNodeBackground')
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    scene.world = world

    # -- sun: lights the clouds, never seen directly ------------------------------
    # strength: the sky texture's radiance puts roughly 9 W/m2 of diffuse light on
    # a flat surface, and at a 22 degree elevation direct sun is about three
    # times the sky, so ~70 W/m2 on the lamp keeps sun and sky in the ratio the
    # real atmosphere has (5 left every sunlit cloud dimmer than the blue sky)
    SUN_STRENGTH = 70.0
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.angle = math.radians(0.9)
    sun.energy = SUN_STRENGTH
    sun.use_shadow = True
    sun.color = (1.0, 0.80, 0.60)
    sun_obj = bpy.data.objects.new('sun', sun)
    sun_obj.rotation_euler = sun_dir.to_track_quat('Z', 'Y').to_euler()
    scene.collection.objects.link(sun_obj)

    # -- clouds ---------------------------------------------------------------
    # the deck the district stands in: dense, bumpy-topped, lit from above
    sea = cloud_material('cloud_sea', -1100.0, 950.0, 650.0, 0.30, 0.16, 0.075, 0.55, args.seed,
                         bottom_flat=0.0, detail=args.detail)
    slab('cloud_sea', -1100.0, 950.0, 60000.0, sea)
    # sparse towering cumulus overhead. Sparse on purpose: at a 22 degree sun a
    # broken layer shadows most of the deck, and the deck is the brightest thing
    # the buildings see, so coverage here is what sets how much light bounces up
    cumulus = cloud_material('cumulus', 2000.0, 1000.0, 1300.0, 0.63, 0.12, 0.05, 0.6,
                             args.seed + 11.0, bottom_flat=0.5, detail=args.detail)
    slab('cumulus', 2000.0, 1000.0, 60000.0, cumulus)

    # -- camera: equirectangular, forward = site +x ----------------------------------
    cam_data = bpy.data.cameras.new('env')
    cam_data.type = 'PANO'
    cam_data.panorama_type = 'EQUIRECTANGULAR'
    # Cycles clips camera rays at clip_end (100 m by default), which silently
    # deletes every cloud that is further away than that
    cam_data.clip_start = 0.1
    cam_data.clip_end = 1.0e7
    cam = bpy.data.objects.new('env', cam_data)
    cam.location = (0, 0, 0)
    cam.rotation_euler = (math.radians(90), 0, math.radians(-90))
    scene.collection.objects.link(cam)
    scene.camera = cam

    # -- render -----------------------------------------------------------------
    r = scene.render
    r.engine = 'CYCLES'
    r.resolution_percentage = 100
    r.image_settings.file_format = 'HDR'
    c = scene.cycles
    c.device = 'CPU'
    c.use_denoising = True
    try:
        c.denoiser = 'OPENIMAGEDENOISE'
    except TypeError:
        pass
    c.max_bounces = 8
    c.volume_bounces = args.vbounces
    c.volume_step_rate = args.step_rate
    c.volume_max_steps = args.max_steps
    c.sample_clamp_indirect = 20.0
    scene.view_settings.view_transform = 'Standard'
    os.makedirs(os.path.dirname(args.out), exist_ok=True)

    def render(path, width, samples, scale):
        bg.inputs['Strength'].default_value = scale
        sun.energy = SUN_STRENGTH * scale
        r.resolution_x, r.resolution_y = width, width // 2
        r.filepath = path
        c.samples = samples
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path, check_existing=False)
        w, h = img.size
        a = np.empty(w * h * 4, np.float32)
        img.pixels.foreach_get(a)
        bpy.data.images.remove(img)
        return np.flipud(a.reshape(h, w, 4)[..., :3])

    probe_path = args.out + '.probe.hdr'
    probe = render(probe_path, 128, 4, 1.0)
    os.remove(probe_path)
    scale = args.target_mean / float((probe @ np.array([0.2126, 0.7152, 0.0722])).mean())
    print(f'probe mean {args.target_mean / scale:.3f} -> scaling by {scale:.4f}')
    a = render(args.out, args.width, args.samples, scale)
    w, h = a.shape[1], a.shape[0]

    # -- report + preview -----------------------------------------------------------
    lum = a @ np.array([0.2126, 0.7152, 0.0722])
    print(f'{w}x{h}  mean {lum.mean():.3f}  p99 {np.percentile(lum, 99):.2f}  max {lum.max():.1f}')
    print(f'upper half mean {lum[: h // 2].mean():.3f}   lower half mean {lum[h // 2:].mean():.3f}')
    if args.preview:
        from PIL import Image
        t = a / (1.0 + a)
        Image.fromarray((np.clip(t, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).save(args.preview)
    print(f'{os.path.getsize(args.out) / 1024:.0f} KB in {time.time() - started:.0f}s')


main()
