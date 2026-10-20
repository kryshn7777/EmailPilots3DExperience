"""Hero trees: the close-up tier. Real branching, real bark, hundreds of leaf cards.

Built directly (no bake from a twin): the trunk and every branch is a tapering bark
tube, UV-mapped at a constant texel density into a procedural bark strip; the
canopy is a few hundred cards, each showing a rendered leaf cluster (see
foliage.py), scattered around the branch tips and clipped to the canopy shape.

Cards carry soft radial lighting normals, pointing out of the canopy instead of
along the card, which is what makes a heap of flat quads shade like a rounded mass
of foliage. Each card exists twice (front and back winding, same normal) so the
material can stay single-sided and the normal never flips.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from .bark import bark

SPECIES = ['oak', 'maple', 'poplar', 'pine']
CARD_V = (0.20, 0.82)        # the band of a card image the cluster occupies
TEXEL = 100.0                # bark pixels per metre


# species: trunk/branch growth, canopy volume, card count and size.
# lens[d] is the length of a depth-d branch; kids[d] children spawn on a depth-d branch.
PARAMS = {
    'oak': dict(
        trunk_r=(0.50, 0.20), lens=[4.6, 3.4, 2.3, 1.5], kids=[6, 4, 3], kid_t=(0.5, 1.0),
        angle=(38, 72), wobble=0.26, up=0.10, taper=0.62, sides=(8, 6, 5, 4),
        centre=(0, 0, 7.8), radii=(4.7, 4.7, 3.8), cards=900, size=(0.95, 1.55),
        bark=dict(tint='#5b4a3a', moss=0.55, furrow=1.0)),
    'maple': dict(
        trunk_r=(0.42, 0.18), lens=[4.0, 2.8, 1.9, 1.2], kids=[5, 4, 3], kid_t=(0.5, 1.0),
        angle=(34, 64), wobble=0.24, up=0.12, taper=0.62, sides=(8, 6, 5, 4),
        centre=(0, 0, 6.8), radii=(3.9, 3.9, 3.9), cards=760, size=(0.85, 1.4),
        bark=dict(tint='#6a5646', moss=0.3, furrow=0.8)),
    'poplar': dict(
        trunk_r=(0.34, 0.07), lens=[10.0, 1.9, 1.2, 0.8], kids=[11, 3, 2], kid_t=(0.22, 0.98),
        angle=(12, 30), wobble=0.12, up=0.22, taper=0.5, sides=(8, 6, 5, 4),
        centre=(0, 0, 7.9), radii=(2.0, 2.0, 6.6), cards=620, size=(0.75, 1.2),
        bark=dict(tint='#c9c3b2', moss=0.0, lenticels=0.6, furrow=0.35)),
    'pine': dict(
        trunk_r=(0.40, 0.04), height=11.2, whorl=(1.9, 0.74), branches=7, reach=2.7,
        cards_per_branch=6, size=(1.2, 1.8), skirt=11,
        bark=dict(tint='#5b3f2f', moss=0.15, furrow=1.2)),
}


class TreeBuilder:
    def __init__(self, layout, species, seed):
        self.layout, self.species = layout, species
        self.P = PARAMS[species]
        self.rng = random.Random(f'{species}/{seed}')
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.normals = []
        self.anchors = []
        self.bark_rect = layout.bark[species]

    # -- face plumbing ---------------------------------------------------------------

    def _atlas_uv(self, rect, u, v):
        x, y, w, h = rect
        A = self.layout.size
        return ((x + u * w) / A, 1 - (y + (1 - v) * h) / A)

    def _face(self, pts, uvs, normals):
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        for loop, uv in zip(f.loops, uvs):
            loop[self.uv].uv = uv
        self.normals.extend(normals)

    # -- bark ------------------------------------------------------------------------

    def tube(self, pts, radii, sides, v0_frac=0.0):
        """Tapering bark tube along `pts`. Bark texel density is TEXEL unless the
        tube is too long for the strip (a 10 m poplar trunk), when it is relaxed so
        the V range stays inside it instead of sampling whatever lies beyond."""
        rect = self.bark_rect
        n = len(pts)
        total = sum((pts[i + 1] - pts[i]).length for i in range(n - 1))
        texel = min(TEXEL, 0.95 * rect[3] / max(total, 1e-3))
        v0 = v0_frac * max(0.0, 1.0 - total * texel / rect[3])
        t0 = (pts[1] - pts[0]).normalized()
        ref = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
        N = t0.cross(ref).normalized()
        rings, s = [], 0.0
        for i in range(n):
            a = pts[i - 1] if i else pts[i]
            b = pts[i + 1] if i + 1 < n else pts[i]
            t = (b - a).normalized()
            N = (N - t * N.dot(t)).normalized()
            B = t.cross(N)
            rings.append((pts[i], N.copy(), B.copy(), radii[i], s))
            if i + 1 < n:
                s += (pts[i + 1] - pts[i]).length
        for i in range(n - 1):
            ca, na, ba, ra, sa = rings[i]
            cb, nb, bb, rb, sb = rings[i + 1]
            umax = min(1.0, max(0.18, 2 * math.pi * (ra + rb) / 2 * texel / rect[2]))
            va = v0 + sa * texel / rect[3]
            vb = v0 + sb * texel / rect[3]
            for j in range(sides):
                a0, a1 = 2 * math.pi * j / sides, 2 * math.pi * (j + 1) / sides
                d0 = math.cos(a0) * na + math.sin(a0) * ba
                d1 = math.cos(a1) * na + math.sin(a1) * ba
                e0 = math.cos(a0) * nb + math.sin(a0) * bb
                e1 = math.cos(a1) * nb + math.sin(a1) * bb
                quad = [ca + d0 * ra, ca + d1 * ra, cb + e1 * rb, cb + e0 * rb]
                nrm = [d0, d1, e1, e0]
                u0, u1 = j / sides * umax, (j + 1) / sides * umax
                uvs = [self._atlas_uv(rect, u0, va), self._atlas_uv(rect, u1, va),
                       self._atlas_uv(rect, u1, vb), self._atlas_uv(rect, u0, vb)]
                geo = (quad[1] - quad[0]).cross(quad[3] - quad[0])
                if geo.dot(d0 + d1) < 0:
                    quad.reverse(); nrm.reverse(); uvs.reverse()
                self._face(quad, uvs, nrm)

    def grow(self, p0, d0, depth, r0):
        P, rng = self.P, self.rng
        length = P['lens'][depth] * rng.uniform(0.85, 1.12) if depth else P['lens'][0]
        n = 6 if depth == 0 else 4
        r1 = r0 * (P['trunk_r'][1] / P['trunk_r'][0] if depth == 0 else 0.35)
        pts, dirs, d = [p0], [d0.normalized()], d0.normalized()
        seg = length / (n - 1)
        for _ in range(n - 1):
            # a trunk stands up; only branches are allowed to wander
            j = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * P['wobble'] \
                * (0.22 if depth == 0 else 1.0)
            d = (d + j + Vector((0, 0, 1)) * P['up']).normalized()
            pts.append(pts[-1] + d * seg)
            dirs.append(d)
        radii = [r0 + (r1 - r0) * (i / (n - 1)) for i in range(n)]
        if depth == 0:
            radii[0] *= 1.4          # root flare
            radii[1] *= 1.12
        self.tube(pts, radii, P['sides'][min(depth, len(P['sides']) - 1)], rng.random())
        if depth < len(P['kids']):
            for _ in range(P['kids'][depth]):
                f = rng.uniform(*P['kid_t']) * (n - 1)
                i = min(int(f), n - 2)
                fr = f - i
                pos = pts[i].lerp(pts[i + 1], fr)
                par = dirs[i].lerp(dirs[i + 1], fr).normalized()
                ang = math.radians(rng.uniform(*P['angle']))
                az = rng.uniform(0, 2 * math.pi)
                ref = Vector((0, 0, 1)) if abs(par.z) < 0.9 else Vector((1, 0, 0))
                a = par.cross(ref).normalized()
                b = par.cross(a)
                cd = par * math.cos(ang) + (a * math.cos(az) + b * math.sin(az)) * math.sin(ang)
                rr = radii[i] + (radii[i + 1] - radii[i]) * fr
                self.grow(pos, cd, depth + 1, rr * P['taper'])
        else:
            self.anchors.append(pts[-1])
            self.anchors.append(pts[-2])
            self.anchors.append(pts[1])

    # -- leaves ----------------------------------------------------------------------

    def card(self, centre, n_geo, light_n, size, variant, flip, up_hint=None):
        """A pair of back-to-back cards. `n_geo` is the card's facing, `light_n` the
        shading normal both faces use."""
        rng = self.rng
        rect = self.layout.cards[(self.species, variant)]
        ref = Vector((0, 0, 1))
        right = ref.cross(n_geo)
        if right.length < 1e-3:
            right = Vector((1, 0, 0))
        right.normalize()
        up = n_geo.cross(right)
        roll = math.radians(rng.uniform(-38, 38))
        right, up = (right * math.cos(roll) + up * math.sin(roll),
                     up * math.cos(roll) - right * math.sin(roll))
        w = size
        h = size * (CARD_V[1] - CARD_V[0])
        c = [centre - right * w / 2 - up * h / 2, centre + right * w / 2 - up * h / 2,
             centre + right * w / 2 + up * h / 2, centre - right * w / 2 + up * h / 2]
        u0, u1 = (1.0, 0.0) if flip else (0.0, 1.0)
        v0, v1 = CARD_V
        uvs = [self._atlas_uv(rect, u0, v0), self._atlas_uv(rect, u1, v0),
               self._atlas_uv(rect, u1, v1), self._atlas_uv(rect, u0, v1)]
        self._face(c, uvs, [light_n] * 4)
        self._face(c[::-1], uvs[::-1], [light_n] * 4)

    def canopy(self):
        P, rng = self.P, self.rng
        centre = Vector(P['centre'])
        radii = Vector(P['radii'])
        anchors = self.anchors
        for i in range(P['cards']):
            if i % 3 == 0:
                # a third of the cards fill the volume directly, so the crown is
                # one mass rather than a clump per branch tip with sky between
                base = centre + Vector((rng.gauss(0, 0.55) * radii.x, rng.gauss(0, 0.55) * radii.y,
                                        rng.gauss(0, 0.5) * radii.z))
            else:
                base = anchors[i % len(anchors)]
            size = rng.uniform(*P['size'])
            off = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 0.8))) * size * 0.55
            p = base + off
            q = Vector(((p.x - centre.x) / radii.x, (p.y - centre.y) / radii.y, (p.z - centre.z) / radii.z))
            if q.length > 1.0:
                q = q / q.length
                p = centre + Vector((q.x * radii.x, q.y * radii.y, q.z * radii.z))
            radial = p - centre
            radial = radial.normalized() if radial.length > 1e-4 else Vector((0, 0, 1))
            rnd = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
            n_geo = (radial * 0.55 + rnd * 0.9).normalized()
            light_n = (radial * 0.85 + Vector((0, 0, 0.35)) + n_geo * 0.15).normalized()
            self.card(p, n_geo, light_n, size, rng.randrange(2), rng.random() < 0.5)

    def conifer(self):
        P, rng = self.P, self.rng
        H = P['height']
        rect = self.bark_rect
        n = 7
        pts = [Vector((rng.uniform(-0.05, 0.05) * i / n, rng.uniform(-0.05, 0.05) * i / n, H * i / (n - 1)))
               for i in range(n)]
        radii = [P['trunk_r'][0] * (1.35 if i == 0 else 1.0) * (1 - i / (n - 1)) ** 0.9 + P['trunk_r'][1]
                 for i in range(n)]
        self.tube(pts, radii, 8, 0.0)
        z, k = P['whorl'][0], 0
        while z < H - 0.7:
            frac = (z - P['whorl'][0]) / (H - 0.7 - P['whorl'][0])
            reach = P['reach'] * (1 - frac) ** 0.9
            twist = rng.uniform(0, 2 * math.pi)
            for b in range(P['branches']):
                az = twist + 2 * math.pi * b / P['branches'] + rng.uniform(-0.2, 0.2)
                d = Vector((math.cos(az), math.sin(az), 0))
                L = max(0.5, reach * rng.uniform(0.82, 1.1))
                base = Vector((0, 0, z + rng.uniform(-0.1, 0.1)))
                path = [base, base + d * L * 0.45 + Vector((0, 0, -0.06 * L)),
                        base + d * L * 0.8 + Vector((0, 0, -0.2 * L)),
                        base + d * L + Vector((0, 0, -0.42 * L))]
                self.tube(path, [0.06 * (1 - frac) + 0.03, 0.04 * (1 - frac) + 0.02,
                                 0.025, 0.012], 5, rng.random())
                for c in range(P['cards_per_branch']):
                    t = 0.22 + 0.78 * (c + rng.uniform(0, 0.6)) / P['cards_per_branch']
                    i = min(int(t * 3), 2)
                    pos = path[i].lerp(path[i + 1], t * 3 - i) + Vector((0, 0, rng.uniform(-0.06, 0.1)))
                    size = rng.uniform(*P['size']) * (0.7 + 0.5 * (1 - frac))
                    # the spray lies along the branch: its facing is up, tilted outward
                    n_geo = (Vector((0, 0, 1)) + d * 0.35 + Vector((rng.uniform(-.2, .2),) * 2 + (0,))).normalized()
                    radial = Vector((pos.x, pos.y, 0))
                    radial = radial.normalized() if radial.length > 1e-4 else d
                    light_n = (radial * 0.5 + Vector((0, 0, 0.8))).normalized()
                    self.card_along(pos, d, n_geo, light_n, size, rng.randrange(2), rng.random() < 0.5)
            # a skirt of sprays fills the gaps between branches: conifers are dense
            for _ in range(P['skirt']):
                az = rng.uniform(0, 2 * math.pi)
                out = Vector((math.cos(az), math.sin(az), 0))
                r = reach * rng.uniform(0.4, 0.85)
                pos = Vector((out.x * r, out.y * r, z - 0.2 - 0.45 * r / P['reach'] * 1.6))
                n_geo = (out * 0.5 + Vector((0, 0, 0.85))).normalized()
                light_n = (out * 0.55 + Vector((0, 0, 0.75))).normalized()
                self.card_along(pos, out, n_geo, light_n, rng.uniform(1.5, 2.2) * (0.6 + 0.6 * (1 - frac)),
                                rng.randrange(2), rng.random() < 0.5)
            z += P['whorl'][1]
            k += 1
        # the leader: a last small spray at the top
        self.card_along(Vector((0, 0, H - 0.5)), Vector((1, 0, 0)), Vector((0, 0, 1)),
                        Vector((0, 0, 1)), 1.3, 0, False)

    def card_along(self, centre, along, n_geo, light_n, size, variant, flip):
        """A needle-spray card whose long axis follows the branch direction."""
        rect = self.layout.cards[(self.species, variant)]
        right = along - n_geo * along.dot(n_geo)
        right = right.normalized() if right.length > 1e-4 else Vector((1, 0, 0))
        up = n_geo.cross(right)
        w = size
        h = size * (CARD_V[1] - CARD_V[0])
        c = [centre - right * w / 2 - up * h / 2, centre + right * w / 2 - up * h / 2,
             centre + right * w / 2 + up * h / 2, centre - right * w / 2 + up * h / 2]
        u0, u1 = (1.0, 0.0) if flip else (0.0, 1.0)
        v0, v1 = CARD_V
        uvs = [self._atlas_uv(rect, u0, v0), self._atlas_uv(rect, u1, v0),
               self._atlas_uv(rect, u1, v1), self._atlas_uv(rect, u0, v1)]
        self._face(c, uvs, [light_n] * 4)
        self._face(c[::-1], uvs[::-1], [light_n] * 4)

    def build(self):
        if self.species == 'pine':
            self.conifer()
        else:
            P = self.P
            self.grow(Vector((0, 0, 0)), Vector((0, 0, 1)), 0, P['trunk_r'][0])
            self.canopy()
        return self


class HeroTree:
    """A finished tree: geometry, normals, and what the manifest needs to know."""

    def __init__(self, mid, species, lean, scale, seed=1):
        self.id, self.species, self.lean, self.scale, self.seed = mid, species, lean, scale, seed
        self.kind = 'tree'
        self.builder = None

    def build(self, layout):
        self.builder = TreeBuilder(layout, self.species, self.seed).build()
        return self

    def dims(self):
        vs = [v.co for v in self.builder.bm.verts]
        return (max(v.x for v in vs) - min(v.x for v in vs),
                max(v.y for v in vs) - min(v.y for v in vs),
                max(v.z for v in vs) - min(v.z for v in vs))

    def tris(self):
        return sum(len(f.verts) - 2 for f in self.builder.bm.faces)

    def final_object(self):
        b = self.builder
        bm = b.bm.copy()
        # centre on the trunk footprint, base at z = 0 (the generator already stands
        # trunks on z = 0; xy is re-centred on the bounding box like every module)
        xs = [v.co.x for v in bm.verts]
        ys = [v.co.y for v in bm.verts]
        bmesh.ops.translate(bm, verts=bm.verts, vec=(-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, 0))
        bmesh.ops.scale(bm, vec=(self.scale,) * 3, verts=bm.verts)
        mesh = bpy.data.meshes.new(self.id)
        bm.to_mesh(mesh)
        bm.free()
        mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
        mesh.normals_split_custom_set([tuple(n) for n in b.normals])
        obj = bpy.data.objects.new(self.id, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def barks(layout):
    """{species: (rgb, orm)} bark strips at the layout's rects."""
    out = {}
    for i, sp in enumerate(SPECIES):
        _, _, w, h = layout.bark[sp]
        out[sp] = bark(w, h, seed=100 + i, **PARAMS[sp]['bark'])
    return out
