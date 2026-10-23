"""A building as a pair of meshes: a few-hundred-triangle low-poly shell that
ships, and a high-poly twin that only exists to be baked onto it.

Face kinds on the low-poly mesh
  wall / roof   textured from the atlas, baked from the high-poly twin
  solid         a flat colour cell (masts, tanks, bulkheads): no bake, no
                texture space to speak of, just a palette lookup
"""
import math
import random
from contextlib import contextmanager

import bmesh
import bpy
from mathutils import Vector

from .facade import build_wall
from .geo import Builder, Frame, Z, rect_poly
from .roofs import flat_roof, pyramid_hp

X, Y = Vector((1, 0, 0)), Vector((0, 1, 0))

# what the room behind a pane is, from the pane's material: 0 plain glass (a dim room), 1 blinds
# drawn, then the lit rooms (warm, dim warm, white, cool, dim cool). The site's window shader
# reads it from the glass mesh's second UV set (see KitCity `windowMaterial`).
PANE_CODES = {'glass_blinds': 1, 'lit_warm': 2, 'lit_warm_dim': 3, 'lit_white': 4, 'lit_cool': 5,
              'lit_cool_dim': 6}


def _solid_uv(face, uv, normal, cx, cy, spread, A):
    """UVs for a flat-colour face: planar-fit into the middle of its palette cell.
    Fitted rather than collapsed to a point, so the UV has area and a tangent frame."""
    n = normal if normal.length > 1e-6 else Z
    a = X - n * X.dot(n)
    a = a.normalized() if a.length > 1e-4 else Y
    b = n.cross(a)
    pts = [l.vert.co for l in face.loops]
    us = [p.dot(a) for p in pts]
    vs = [p.dot(b) for p in pts]
    su = max(max(us) - min(us), 1e-3)
    sv = max(max(vs) - min(vs), 1e-3)
    for loop, u, v in zip(face.loops, us, vs):
        px = cx + ((u - min(us)) / su - 0.5) * spread
        py = cy + ((v - min(vs)) / sv - 0.5) * spread
        loop[uv].uv = (px / A, 1 - py / A)


def _newell_normal(pts):
    n = Vector()
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n.normalized()


class Model:
    def __init__(self, mid, kind, target=None, scale=None):
        # exactly one of: target (largest side in site units) or scale (units per metre)
        self.id, self.kind, self.target, self.scale = mid, kind, target, scale
        self.hp = Builder(f'{mid}.hp')
        self.lp = Builder(f'{mid}.lp')
        self.slots = {}
        self.volumes = []
        self.roofs = []
        self.count = 0
        self.layout = None

    def rng(self, key):
        return random.Random(f'{self.id}/{key}')

    @contextmanager
    def ctx(self, slot, origin, a, b, n):
        """High-poly faces built inside this block belong to a baked slot: `origin`,
        `a`, `b` are its UV frame and `n` its outward normal. Only faces that face
        the same way (the visible surface) will sample it in the hero tier."""
        self.hp.ctx = dict(slot=slot, o=Vector(origin), a=Vector(a), b=Vector(b), n=Vector(n).normalized())
        try:
            yield
        finally:
            self.hp.ctx = None

    # -- low-poly face helpers -------------------------------------------------

    def _slot(self, key, kind, w, h):
        have = self.slots.setdefault(key, dict(kind=kind, w=w, h=h))
        if abs(have['w'] - w) > 1e-3 or abs(have['h'] - h) > 1e-3:
            raise ValueError(f'{self.id}: slot {key} reused at a different size '
                             f'({have["w"]:.3f}x{have["h"]:.3f} vs {w:.3f}x{h:.3f})')

    def _solid(self, pts, mat, expect, smooth=False):
        self.lp.face(pts, 'lp', expect=expect, smooth=smooth,
                     meta=dict(slot=f'solid:{mat}', kind='solid', mat=mat))

    def _solid_cyl(self, cx, cy, r, z0, z1, segs, mat, r_top=None, cap=True, smooth=True):
        r_top = r if r_top is None else r_top
        ring = lambda rad, z: [Vector((cx + rad * math.cos(2 * math.pi * i / segs),
                                       cy + rad * math.sin(2 * math.pi * i / segs), z))
                               for i in range(segs)]
        lo, hi = ring(r, z0), ring(r_top, z1)
        for i in range(segs):
            j = (i + 1) % segs
            a = 2 * math.pi * (i + 0.5) / segs
            expect = Vector((math.cos(a), math.sin(a), 0.2))
            pts = [lo[i], lo[j], hi[0]] if r_top <= 1e-6 else [lo[i], lo[j], hi[j], hi[i]]
            self._solid(pts, mat, expect, smooth)
        if cap and r_top > 1e-6:
            self._solid(hi, mat, Z)

    # -- structure -------------------------------------------------------------

    def tier(self, cx, cy, w, d, z0, z1, wall, roof=None, chamfer=0.0,
             poly=None, keys=None, name=None):
        """A prism of floors: flat low-poly walls, a fully detailed high-poly twin."""
        tid = name or f't{self.count}'
        self.count += 1
        if poly is None:
            poly, keys = rect_poly(cx, cy, w, d, chamfer)
        n = len(poly)
        for i in range(n):
            a, b = Vector(poly[i]), Vector(poly[(i + 1) % n])
            L = (b - a).length
            fr = Frame(a, b - a)
            key = f'{tid}:{keys[i]}'
            style = wall if 'kind' in wall else wall[keys[i]]
            self._slot(key, 'wall', L, z1 - z0)
            self.lp.face(
                [fr.p(0, 0, z0), fr.p(L, 0, z0), fr.p(L, 0, z1), fr.p(0, 0, z1)], 'lp',
                expect=fr.n, meta=dict(slot=key, kind='wall', o=fr.p(0, 0, z0), a=fr.u, b=Z))
            # the hero tier samples this slot's baked pixels on every face that looks out of the wall
            with self.ctx(key, fr.p(0, 0, z0), fr.u, Z, fr.n):
                build_wall(self.hp, fr, L, z0, z1, style, self.rng(key))
        # roof=False: something (a mansard, a crown) sits on the whole top, so
        # a roof face here would only spend texture space on pixels nobody sees
        if roof is not False:
            self._roof(poly, z1, roof or {}, tid)
        xs, ys = [p[0] for p in poly], [p[1] for p in poly]
        self.volumes.append((min(xs), min(ys), max(xs), max(ys), z0))
        return poly

    def _roof(self, poly, z, spec, tid):
        xs, ys = [p[0] for p in poly], [p[1] for p in poly]
        key = f'{tid}:roof'
        self._slot(key, 'roof', max(xs) - min(xs), max(ys) - min(ys))
        self.lp.face([(x, y, z) for x, y in poly], 'lp', expect=Z,
                     meta=dict(slot=key, kind='roof', o=Vector((min(xs), min(ys), z)), a=X, b=Y))
        self.roofs.append((poly, z, spec, tid))

    def volume(self, cx, cy, w, d, z0, z1, mat, hp_mat=None):
        """A solid-colour box: bulkheads, chimneys, fins, sky-bridges."""
        poly, _ = rect_poly(cx, cy, w, d)
        for i in range(4):
            a, b = Vector(poly[i]), Vector(poly[(i + 1) % 4])
            fr = Frame(a, b - a)
            L = (b - a).length
            self._solid([fr.p(0, 0, z0), fr.p(L, 0, z0), fr.p(L, 0, z1), fr.p(0, 0, z1)],
                        mat, fr.n)
        self._solid([(x, y, z1) for x, y in poly], mat, Z)
        self.hp.box(cx, cy, w, d, z0, z1, hp_mat or mat)
        self.volumes.append((cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2, z0))

    def pyramid(self, cx, cy, w, d, z0, z1, mat, ax=0.0, ay=0.0):
        c = [(cx - w / 2, cy - d / 2), (cx + w / 2, cy - d / 2),
             (cx + w / 2, cy + d / 2), (cx - w / 2, cy + d / 2)]
        apex = (cx + ax, cy + ay, z1)
        for i in range(4):
            a, b = c[i], c[(i + 1) % 4]
            mid = Vector(((a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy, 0.3))
            self._solid([(a[0], a[1], z0), (b[0], b[1], z0), apex], mat, mid)
        pyramid_hp(self.hp, cx, cy, w, d, z0, z1, mat, ax, ay)
        self.volumes.append((cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2, z0))

    def mast(self, cx, cy, z0, z1, r, mat='frame_light'):
        self.pyramid(cx, cy, 2 * r, 2 * r, z0, z1, mat)

    def stack(self, cx, cy, z0, z1, r, r_top, mat, segs=8):
        """Tapered chimney / smokestack."""
        self._solid_cyl(cx, cy, r, z0, z1, segs, mat, r_top=r_top)
        self.hp.cylinder(cx, cy, r, z0, z1, segs * 2, mat, r_top=r_top)
        self.hp.cylinder(cx, cy, r_top * 1.12, z1 - 0.7, z1, segs * 2, 'concrete')
        self.volumes.append((cx - r, cy - r, cx + r, cy + r, z0))

    def tank(self, cx, cy, z0, r=2.0, h=3.2):
        """Rooftop water tank on legs, the New York skyline staple."""
        leg = 1.6
        self._solid_cyl(cx, cy, r * 0.8, z0, z0 + leg, 6, 'frame_dark', cap=False)
        self._solid_cyl(cx, cy, r, z0 + leg, z0 + leg + h, 8, 'tank_wood')
        self._solid_cyl(cx, cy, r + 0.15, z0 + leg + h, z0 + leg + h + 1.1, 8, 'metal_roof',
                        r_top=0.05)
        hp = self.hp
        for sx in (-1, 1):
            for sy in (-1, 1):
                hp.box(cx + sx * r * 0.7, cy + sy * r * 0.7, 0.22, 0.22, z0, z0 + leg + 0.2,
                       'frame_dark')
        hp.cylinder(cx, cy, r, z0 + leg, z0 + leg + h, 20, 'tank_wood')
        for k in (0.2, 0.5, 0.8):
            hp.cylinder(cx, cy, r + 0.05, z0 + leg + h * k - 0.06, z0 + leg + h * k + 0.06,
                        20, 'frame_dark', cap=False)
        hp.cylinder(cx, cy, r + 0.15, z0 + leg + h, z0 + leg + h + 1.1, 20, 'metal_roof',
                    r_top=0.05)
        self.volumes.append((cx - r, cy - r, cx + r, cy + r, z0))

    def wedge(self, cx, cy, w, d, z0, z_lo, z_hi, wall, roof):
        """Block with a single-pitch roof rising along +x: the sloped 'sail'
        crown that makes a skyline read as designed rather than extruded."""
        x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2
        faces = (
            ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z_hi), (x0, y0, z_lo)], wall, -Y),
            ([(x0, y1, z0), (x1, y1, z0), (x1, y1, z_hi), (x0, y1, z_lo)], wall, Y),
            ([(x0, y0, z0), (x0, y1, z0), (x0, y1, z_lo), (x0, y0, z_lo)], wall, -X),
            ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z_hi), (x1, y0, z_hi)], wall, X),
            ([(x0, y0, z_lo), (x1, y0, z_hi), (x1, y1, z_hi), (x0, y1, z_lo)], roof,
             Vector((z_lo - z_hi, 0, w))),
        )
        for pts, mat, expect in faces:
            self._solid(pts, mat, expect)
            self.hp.face(pts, mat, expect=expect)
        self.volumes.append((x0, y0, x1, y1, z0))

    def _canopy_face(self, pts, centre, extent, name):
        """A canopy polygon, textured by planar projection along its dominant
        axis. Unlike a wall these are all distinct faces that merely share a
        projection, so each one is baked (meta 'all')."""
        n = _newell_normal(pts)
        axis = max(range(3), key=lambda i: abs(n[i]))
        sign = '+' if n[axis] > 0 else '-'
        a, b = ((Y, Z), (X, Z), (X, Y))[axis]
        ea, eb = [extent[i] for i in {0: (1, 2), 1: (0, 2), 2: (0, 1)}[axis]]
        key = f'{name}:{"xyz"[axis]}{sign}'
        self._slot(key, 'wall', 2 * ea, 2 * eb)
        o = Vector(centre) - a * ea - b * eb
        self.lp.face(pts, 'lp', expect=n, smooth=True,
                     meta=dict(slot=key, kind='wall', all=True, o=o, a=a, b=b))

    def blob(self, cx, cy, cz, rx, ry, rz, name, seed=1, lump=0.14, subdiv=2):
        """Lumpy low-poly canopy, with the leaf mass built from many small
        clusters in the high-poly twin."""
        import random as _r
        rng = _r.Random(f'{self.id}/{name}/{seed}')
        tmp = bmesh.new()
        bmesh.ops.create_icosphere(tmp, subdivisions=subdiv, radius=1.0)
        shift = {}
        for v in tmp.verts:
            k = rng.uniform(1 - lump, 1 + lump)
            shift[v.index] = k
        tmp.verts.ensure_lookup_table()
        ext = (rx * (1 + lump), ry * (1 + lump), rz * (1 + lump))
        for f in tmp.faces:
            pts = [Vector((cx + v.co.x * rx * shift[v.index], cy + v.co.y * ry * shift[v.index],
                           cz + v.co.z * rz * shift[v.index])) for v in f.verts]
            self._canopy_face(pts, (cx, cy, cz), ext, name)
        tmp.free()
        return rng

    def cone(self, cx, cy, z0, z1, r, name, segs=8, r_top=0.0):
        """Conifer tier as a baked canopy cone."""
        ring = lambda rad, z: [Vector((cx + rad * math.cos(2 * math.pi * i / segs),
                                       cy + rad * math.sin(2 * math.pi * i / segs), z))
                               for i in range(segs)]
        lo, hi = ring(r, z0), ring(r_top, z1)
        ext = (r, r, (z1 - z0) / 2)
        centre = (cx, cy, (z0 + z1) / 2)
        for i in range(segs):
            j = (i + 1) % segs
            pts = [lo[i], lo[j], hi[0]] if r_top <= 1e-6 else [lo[i], lo[j], hi[j], hi[i]]
            self._canopy_face(pts, centre, ext, name)

    def mansard(self, cx, cy, w, d, z0, z1, inset, wall_mat='slate', dormers=(3, 2),
                name='m', roof=None):
        """Sloped slate roof with dormers; the dormers live only in the bake."""
        outer, keys = rect_poly(cx, cy, w, d)
        inner, _ = rect_poly(cx, cy, w - 2 * inset, d - 2 * inset)
        rise = z1 - z0
        for i in range(4):
            a0, b0 = Vector(outer[i]), Vector(outer[(i + 1) % 4])
            a1, b1 = Vector(inner[i]), Vector(inner[(i + 1) % 4])
            fr = Frame(a0, b0 - a0)
            L = (b0 - a0).length
            tilt = (fr.n * rise + Z * inset).normalized()
            up_slope = (-fr.n * inset + Z * rise).normalized()
            key = f'{name}:{keys[i]}'
            self._slot(key, 'wall', L, math.hypot(inset, rise))
            pts = [(a0.x, a0.y, z0), (b0.x, b0.y, z0), (b1.x, b1.y, z1), (a1.x, a1.y, z1)]
            self.lp.face(pts, 'lp', expect=tilt,
                         meta=dict(slot=key, kind='wall', o=Vector(pts[0]), a=fr.u, b=up_slope))
            with self.ctx(key, pts[0], fr.u, up_slope, tilt):
                self.hp.face(pts, wall_mat, expect=tilt)
                rng = self.rng(key)
                count = dormers[i % 2]
                for k in range(count):
                    u = L * (k + 0.5) / count
                    t = 0.42
                    w0 = -inset * t
                    zc = z0 + rise * t
                    self.hp.fbox(fr, u - 0.75, u + 0.75, w0 - 0.4, w0 + 0.9, zc - 0.7, zc + 0.9,
                                 'limestone', skip=('-w',))
                    lit = rng.choice(['lit_warm', 'glass_dark', 'glass_mid', 'lit_warm_dim'])
                    self.hp.pane(fr, u - 0.5, u + 0.5, zc - 0.45, zc + 0.65, w0 + 0.92, lit)
                    self.hp.face([fr.p(u - 0.85, w0 + 1.0, zc + 0.9), fr.p(u + 0.85, w0 + 1.0, zc + 0.9),
                                  fr.p(u + 0.85, w0 - 0.4, zc + 1.55), fr.p(u - 0.85, w0 - 0.4, zc + 1.55)],
                                 wall_mat, expect=Z + fr.n * 0.4)
        self._roof(inner, z1, roof or {'parapet': 0.0, 'margin': 0.8}, f'{name}')
        self.volumes.append((cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2, z0))

    def sawtooth(self, cx, cy, w, d, z0, teeth, h):
        """Factory roof: sloped metal one way, glazing the other."""
        pitch = w / teeth
        y0, y1 = cy - d / 2, cy + d / 2
        for i in range(teeth):
            xa = cx - w / 2 + i * pitch
            xb = xa + pitch
            for (pts, mat, expect) in (
                ([(xa, y0, z0), (xb, y0, z0 + h), (xb, y1, z0 + h), (xa, y1, z0)],
                 'metal_roof', Vector((-h, 0, pitch))),
                ([(xb, y0, z0), (xb, y1, z0), (xb, y1, z0 + h), (xb, y0, z0 + h)],
                 'glass_dark', X),
                ([(xa, y0, z0), (xb, y0, z0), (xb, y0, z0 + h)], 'concrete_d', -Y),
                ([(xa, y1, z0), (xb, y1, z0), (xb, y1, z0 + h)], 'concrete_d', Y),
            ):
                self._solid(pts, mat, expect)
                self.hp.face(pts, mat, expect=expect)
        self.volumes.append((cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2, z0))

    # -- finishing -------------------------------------------------------------

    def finish(self):
        for poly, z, spec, tid in self.roofs:
            keep = [v[:4] for v in self.volumes if v[4] >= z - 0.01]
            xs, ys = [p[0] for p in poly], [p[1] for p in poly]
            with self.ctx(f'{tid}:roof', (min(xs), min(ys), z), X, Y, Z):
                flat_roof(self.hp, poly, z, spec, self.rng(f'{tid}:roof'), keep)
        self._recenter()

    def _recenter(self):
        xs = [v.co.x for v in self.lp.bm.verts]
        ys = [v.co.y for v in self.lp.bm.verts]
        shift = Vector((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, 0.0))
        for b in (self.lp.bm, self.hp.bm):
            bmesh.ops.translate(b, verts=b.verts, vec=shift)
        for p in self.hp.panes:
            p['pts'] = [q + shift for q in p['pts']]
        for m in self.lp.meta:
            if 'o' in m:
                m['o'] = m['o'] + shift
        # high-poly faces share one context dict per wall or roof: shift each once
        seen = set()
        for m in self.hp.meta:
            if m is not None and id(m) not in seen:
                seen.add(id(m))
                m['o'] = m['o'] + shift

    def dims(self):
        bb = [v.co for v in self.lp.bm.verts]
        return (max(v.x for v in bb) - min(v.x for v in bb),
                max(v.y for v in bb) - min(v.y for v in bb),
                max(v.z for v in bb) - min(v.z for v in bb))

    def tris(self):
        return sum(len(f.verts) - 2 for f in self.lp.bm.faces)

    # -- UVs -------------------------------------------------------------------

    def assign_uv(self, layout, tile, palette_cells):
        """Pack this model's slots into its atlas tile and write the UVs."""
        self.layout, self.density = layout.layout_tile(self.slots, tile)
        self.atlas_layout, self.palette = layout, palette_cells
        bm = self.lp.bm
        uv = bm.loops.layers.uv.new('UVMap')
        bm.faces.ensure_lookup_table()
        A = layout.size
        # solids fill a cell of `pitch` px; their UVs stay in its middle half so a
        # mipmapped sample never reaches a neighbouring colour
        spread = layout.pitch * 0.3
        for face, meta in zip(bm.faces, self.lp.meta):
            if meta['kind'] == 'solid':
                cx, cy = palette_cells[meta['mat']]
                _solid_uv(face, uv, face.normal, cx, cy, spread, A)
                continue
            x, y, wpx, hpx = self.layout[meta['slot']]
            for l in face.loops:
                rel = l.vert.co - meta['o']
                px = x + rel.dot(meta['a']) * self.density
                py = y + hpx - rel.dot(meta['b']) * self.density
                l[uv].uv = (px / A, 1 - py / A)

    # -- objects ---------------------------------------------------------------

    def bake_object(self, group):
        """Low-poly proxy for one bake group: one face per slot, every face on
        its own vertices so the bake cage extrudes straight out of each face."""
        bm = bmesh.new()
        src_uv = self.lp.bm.loops.layers.uv['UVMap']
        uv = bm.loops.layers.uv.new('UVMap')
        seen = set()
        for face, meta in zip(self.lp.bm.faces, self.lp.meta):
            if meta['kind'] != group or (meta['slot'] in seen and not meta.get('all')):
                continue
            seen.add(meta['slot'])
            nf = bm.faces.new([bm.verts.new(l.vert.co) for l in face.loops])
            for nl, ol in zip(nf.loops, face.loops):
                nl[uv].uv = ol[src_uv].uv
        if not seen:
            bm.free()
            return None
        mesh = bpy.data.meshes.new(f'{self.id}.bake.{group}')
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(f'{self.id}.bake.{group}', mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj

    def hp_object(self):
        return self.hp.to_object()

    def final_object(self, scale):
        """The shipping mesh: welded, flat/smooth as authored, scaled to kit size."""
        bm = self.lp.bm.copy()
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bmesh.ops.scale(bm, vec=(scale, scale, scale), verts=bm.verts)
        mesh = bpy.data.meshes.new(self.id)
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(self.id, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


    # -- hero tier ---------------------------------------------------------------------

    def hero_object(self, scale):
        """The close-up mesh: the high-poly twin itself, minus what cannot be seen.

        Surfaces that face the way their wall or roof slot does sample that slot's
        baked pixels (the bake was projected along the same normal, so the pixel at
        a recessed window pane is the pane); every other face (reveals, trim sides,
        tops) takes the flat colour of its material from the palette strip. There is
        no normal map in this tier: the relief is geometry.
        """
        layout, cells = self.atlas_layout, self.palette
        A = layout.size
        src = self.hp.bm
        src.normal_update()
        faces = list(src.faces)
        # drop back-to-back coincident faces (the touching sides of neighbouring boxes)
        by_key = {}
        for i, f in enumerate(faces):
            key = tuple(sorted((round(v.co.x, 3), round(v.co.y, 3), round(v.co.z, 3)) for v in f.verts))
            by_key.setdefault(key, []).append(i)
        drop = set()
        for idxs in by_key.values():
            for a in range(len(idxs)):
                for b in range(a + 1, len(idxs)):
                    if faces[idxs[a]].normal.dot(faces[idxs[b]].normal) < -0.9:
                        drop.update((idxs[a], idxs[b]))
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new('UVMap')
        for i, (f, meta) in enumerate(zip(faces, self.hp.meta)):
            if i in drop:
                continue
            nf = bm.faces.new([bm.verts.new(v.co) for v in f.verts])
            nf.smooth = f.smooth
            slot = meta and self.layout.get(meta['slot'])
            if slot and f.normal.dot(meta['n']) > 0.9:
                x, y, _, hpx = slot
                for loop in nf.loops:
                    rel = loop.vert.co - meta['o']
                    px = x + rel.dot(meta['a']) * self.density
                    py = y + hpx - rel.dot(meta['b']) * self.density
                    loop[uv].uv = (px / A, 1 - py / A)
            else:
                cx, cy = cells[self.hp.mats[f.material_index]]
                _solid_uv(nf, uv, f.normal, cx, cy, layout.pitch * 0.3, A)
        bmesh.ops.scale(bm, vec=(scale, scale, scale), verts=bm.verts)
        mesh = bpy.data.meshes.new(f'{self.id}.hero')
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(f'{self.id}.hero', mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj

    def glass_object(self, scale):
        """The hero tier's window glass: one quad per pane, 4 mm proud of the baked pane.

        UVMap runs 0..1 across the whole window the pane belongs to; `Pane` holds the room
        code plus a random fraction in x (u is the one coordinate the glTF exporter leaves
        alone); `Size` is the window's width and height in metres, for the room's proportions.
        """
        panes = self.hp.panes
        if not panes:
            return None
        rng = self.rng('panes')
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new('UVMap')
        info = bm.loops.layers.uv.new('Pane')
        size = bm.loops.layers.uv.new('Size')
        for p in panes:
            pts = [q + p['n'] * 0.004 for q in p['pts']]
            uvs = p['uv']
            if _newell_normal(pts).dot(p['n']) < 0:
                pts, uvs = pts[::-1], uvs[::-1]
            f = bm.faces.new([bm.verts.new(q * scale) for q in pts])
            code = PANE_CODES.get(p['mat'], 0) + rng.random() * 0.999
            for loop, (u, v) in zip(f.loops, uvs):
                loop[uv].uv = (u, v)
                loop[info].uv = (code, 0.0)
                loop[size].uv = p['size']
        mesh = bpy.data.meshes.new(f'{self.id}.glass')
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new('glass', mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj

    def hero_tris(self):
        return sum(len(p.vertices) - 2 for p in bpy.data.objects[f'{self.id}.hero'].data.polygons)
