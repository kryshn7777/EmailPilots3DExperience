"""High-poly -> low-poly bake into shared float atlases, plus final map assembly.

Passes (all selected-to-active, so the detailed twin projects onto the flat
shell):
  normal   tangent-space normals from the real reveals, mullions and cornices
  gi       path-traced diffuse light under a uniform sky, with bounces: how much
           sky each texel actually sees once light has bounced between the
           reveals, balconies and plant around it. It replaces plain ambient
           occlusion, which would leave every cavity darker than it really is
  color    albedo, via the emission swap in materials.py
  orm      (G) roughness and (B) metalness, same trick; R is filled from `gi`
  emit     lit-window glow
  mask     where anything was baked, so untouched pixels get neutral defaults
"""
import time

import bpy
import numpy as np

from .materials import PALETTE, build_bake_materials, srgb

SAMPLES = dict(normal=4, color=6, orm=4, emit=6, mask=2, gi=96)
def _image(name, size):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    return img


def _target_material(name, image):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    node = nt.nodes.new('ShaderNodeTexImage')
    node.image = image
    nt.nodes.active = node
    return mat


class Baker:
    def __init__(self, layout):
        self.layout = layout
        scene = bpy.context.scene
        scene.render.engine = 'CYCLES'
        scene.cycles.device = 'CPU'
        scene.cycles.use_denoising = False
        bk = scene.render.bake
        bk.use_clear = False
        bk.use_selected_to_active = True
        bk.use_cage = False
        bk.margin = layout.margin
        bk.margin_type = 'EXTEND'
        bk.normal_space = 'TANGENT'
        self.scene = scene
        self.images = {k: _image(f'atlas.{k}', layout.size) for k in SAMPLES}
        self.targets = {k: _target_material(f'target.{k}', im) for k, im in self.images.items()}
        self.swaps = build_bake_materials()
        white = bpy.data.materials.new('mask.white')
        white.use_nodes = True
        nt = white.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
        self.swaps['mask'] = {name: white for name in PALETTE}
        # a unit-radiance uniform sky: an open, unobstructed surface bakes to 1.0,
        # so the result is directly usable as an occlusion multiplier
        world = bpy.data.worlds.new('bake')
        world.use_nodes = True
        bg = world.node_tree.nodes['Background']
        bg.inputs['Color'].default_value = (1.0, 1.0, 1.0, 1.0)
        bg.inputs['Strength'].default_value = 1.0
        self.scene.world = world
        self.scene.cycles.max_bounces = 6
        self.scene.cycles.diffuse_bounces = 4

    def _swap(self, hp, which, mat_names):
        for slot, name in zip(hp.material_slots, mat_names):
            slot.material = self.swaps[which][name]

    def bake(self, model, hp):
        started = time.time()
        for group, (extrusion, reach) in self.layout.reach.items():
            lp = model.bake_object(group)
            if lp is None:
                continue
            bk = self.scene.render.bake
            bk.cage_extrusion = extrusion
            bk.max_ray_distance = reach
            for kind, bake_type, swap in (
                ('normal', 'NORMAL', 'color'), ('gi', 'DIFFUSE', 'gi'), ('color', 'EMIT', 'color'),
                ('orm', 'EMIT', 'orm'), ('emit', 'EMIT', 'emit'), ('mask', 'EMIT', 'mask'),
            ):
                self._swap(hp, swap, model.hp.mats)
                lp.data.materials.clear()
                lp.data.materials.append(self.targets[kind])
                bpy.ops.object.select_all(action='DESELECT')
                hp.select_set(True)
                lp.select_set(True)
                bpy.context.view_layer.objects.active = lp
                self.scene.cycles.samples = SAMPLES[kind]
                if bake_type == 'DIFFUSE':
                    # lighting only: albedo is applied at runtime
                    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'})
                else:
                    bpy.ops.object.bake(type=bake_type)
            bpy.data.objects.remove(lp)
        return time.time() - started

    # -- assembly --------------------------------------------------------------

    def _read(self, kind):
        img = self.images[kind]
        n = self.layout.size
        buf = np.empty(n * n * 4, dtype=np.float32)
        img.pixels.foreach_get(buf)
        # Blender rows run bottom-to-top, files top-to-bottom
        return np.flipud(buf.reshape(n, n, 4)[..., :3])

    def assemble(self, solids):
        """Return the final 8-bit maps as numpy arrays (H, W, 3), top-left origin."""
        mask = self._read('mask')[..., 0] > 0.5
        gi = np.clip(self._read('gi')[..., 0], 0, 1)
        color = np.clip(self._read('color'), 0, 1)
        orm = np.clip(self._read('orm'), 0, 1)
        emit = np.clip(self._read('emit'), 0, 1)
        normal = np.clip(self._read('normal'), 0, 1)

        # a little of the bounce-aware occlusion goes straight into the albedo:
        # the sun is not the only light at dusk, and baked cavities carry the
        # depth that the flat low-poly walls would otherwise lose
        color = color * (0.58 + 0.42 * gi)[..., None]
        orm = orm.copy()
        orm[..., 0] = gi

        neutral = ~mask
        color[neutral] = (0.5, 0.5, 0.5)
        orm[neutral] = (1.0, 0.9, 0.0)
        emit[neutral] = 0.0
        normal[neutral] = (0.5, 0.5, 1.0)

        L = self.layout
        ox, oy, pitch = *L.palette_origin, L.pitch
        for i, name in enumerate(sorted(solids)):
            x0 = ox + pitch * (i % L.cols)
            y0 = oy + pitch * (i // L.cols)
            spec = PALETTE[name]
            lin = np.array([_to_lin(c) for c in srgb(spec['c'])])
            color[y0:y0 + pitch, x0:x0 + pitch] = lin
            orm[y0:y0 + pitch, x0:x0 + pitch] = (1.0, spec['r'], spec['m'])
            emit[y0:y0 + pitch, x0:x0 + pitch] = 0.0
            normal[y0:y0 + pitch, x0:x0 + pitch] = (0.5, 0.5, 1.0)

        to8 = lambda a: np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)
        return dict(
            color=to8(_to_srgb(color)), normal=to8(normal), orm=to8(orm), emissive=to8(_to_srgb(emit)),
            mask=mask,
        )


def _to_lin(s):
    return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4


def _to_srgb(a):
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(np.maximum(a, 1e-8), 1 / 2.4) - 0.055)
