"""Hero trees: the close-up tiers. Real branching, real bark, hundreds of leaf cards.

Built directly (no bake from a twin): the trunk and every branch is a tapering bark
tube, UV-mapped at a constant texel density into a procedural bark strip; the
canopy is a few hundred to a few thousand cards, each showing a rendered leaf cluster
(see foliage.py), scattered around the branch tips and clipped to the canopy shape.

Cards carry soft radial lighting normals, pointing out of the canopy instead of
along the card, which is what makes a heap of flat quads shade like a rounded mass
of foliage. Each card exists twice (front and back winding, same normal) so the
material can stay single-sided and the normal never flips.

Every vertex also carries a colour (COLOR_0, multiplied into the atlas by the runtime):
the light that reaches it. The heart of a crown is dark and its sunlit skin bright, the
underside is shaded, each lobe of leaves has a tone and a tint of its own, so a canopy
has depth and patches of light and dark instead of one flat green.

Tiers (TIERS below): 'ultra' (~50k triangles: a full skeleton down to twigs with buttress
roots, knots and branch collars, cards in three sizes and several hundred individual 3D
leaves, or the pine's whorls with sub-branches and needle tufts), 'hero' (~15k), 'detail'
(~2.5k) and 'lite' (~0.7k).
"""
import math
import random
from collections import Counter

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import foliage
from .bark import bark

SPECIES = ['oak', 'maple', 'poplar', 'pine']
TEXEL = 200.0                # bark pixels per metre
Z = Vector((0, 0, 1))
GOLDEN = math.pi * (3 - math.sqrt(5))


def smooth(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def clamp(x, lo=0.0, hi=1.0):
    return min(max(x, lo), hi)


# species: trunk/branch growth, canopy volume, card count and size.
# lens[d] is the length of a depth-d branch; kids[d] children spawn on a depth-d branch.
PARAMS = {
    'oak': dict(
        trunk_r=(0.50, 0.20), lens=[4.6, 3.4, 2.3, 1.5, 0.8], kids=[6, 4, 3, 2], kid_t=(0.5, 1.0),
        angle=(38, 72), wobble=0.26, up=0.10, taper=0.62, sides=(16, 10, 7, 5, 4),
        centre=(0, 0, 7.8), radii=(4.7, 4.7, 3.8), cards=3300, size=(0.48, 0.84), lobes=11,
        bark=dict(tint='#5b4a3a', moss=0.45, furrow=1.0, fissure=(30, 3.5, 0.075))),
    'maple': dict(
        trunk_r=(0.42, 0.18), lens=[4.0, 2.8, 1.9, 1.2, 0.65], kids=[5, 4, 3, 2], kid_t=(0.5, 1.0),
        angle=(34, 64), wobble=0.24, up=0.12, taper=0.62, sides=(16, 10, 7, 5, 4),
        centre=(0, 0, 6.8), radii=(3.9, 3.9, 3.9), cards=2800, size=(0.44, 0.78), lobes=10,
        bark=dict(tint='#6a5646', moss=0.25, furrow=0.8, fissure=(26, 3, 0.06))),
    'poplar': dict(
        trunk_r=(0.34, 0.07), lens=[10.0, 1.9, 1.2, 0.8, 0.45], kids=[11, 3, 2, 2], kid_t=(0.22, 0.98),
        angle=(12, 30), wobble=0.12, up=0.22, taper=0.5, sides=(14, 7, 5, 4, 4),
        centre=(0, 0, 7.9), radii=(2.0, 2.0, 6.6), cards=2300, size=(0.4, 0.7), lobes=10,
        bark=dict(tint='#c9c3b2', moss=0.0, lenticels=0.6, furrow=0.6, fissure=(14, 4, 0.05))),
    'pine': dict(
        trunk_r=(0.40, 0.04), height=11.2, whorl=(1.9, 0.5), branches=9, reach=2.7,
        cards_per_branch=11, size=(0.85, 1.3), skirt=20,
        bark=dict(tint='#5b3f2f', moss=0.12, furrow=1.1, fissure=(18, 6, 0.085))),
}


# 'ultra' is the tier for the trees the camera passes within a few metres of: ~50k triangles.
# segs[d] is the number of stations along a depth-d branch (more of them bend it more smoothly
# and give the trunk a root flare to grow out of); bend arcs a branch, droop sags the outer ones.
# roots/root_amp/root_h shape the buttresses, knots and stubs dot the bark, collar swells a
# branch where it leaves its parent, sizes3 are the card sizes of the three kinds of card
# (volume fill, lobe skin, twig tip), leaves3d is the number of individual 3D leaves.
ULTRA = {
    'oak': dict(
        lens=[4.6, 3.6, 2.5, 1.7, 1.1], kids=[7, 5, 4, 3], sides=(28, 14, 9, 6, 5),
        segs=(15, 9, 6, 5, 4), bend=0.55, droop=(0, 0.1, 0.2, 0.3, 0.35), collar=1.5,
        roots=6, root_amp=1.1, root_h=1.4, knots=18, stubs=6, lean=2.5, tip_k=0.32,
        cards=3500, sizes3=((0.8, 1.2), (0.5, 0.84), (0.26, 0.46)), lobes=13,
        leaves3d=440, autumn=0.07),
    'maple': dict(
        lens=[4.0, 3.0, 2.1, 1.4, 0.9], kids=[6, 5, 4, 3], sides=(26, 14, 9, 6, 5),
        segs=(14, 9, 6, 5, 4), bend=0.5, droop=(0, 0.05, 0.15, 0.25, 0.3), collar=1.45,
        roots=5, root_amp=0.9, root_h=1.2, knots=14, stubs=5, lean=3.0, tip_k=0.32,
        cards=3300, sizes3=((0.75, 1.1), (0.48, 0.78), (0.24, 0.42)), lobes=12,
        leaves3d=520, autumn=0.09),
    'poplar': dict(
        lens=[10.0, 2.1, 1.4, 1.0, 0.6], kids=[14, 4, 3, 2], sides=(24, 10, 7, 5, 4),
        segs=(18, 6, 5, 4, 3), bend=0.3, droop=(0, 0.0, 0.1, 0.15, 0.2), collar=1.4,
        roots=5, root_amp=0.7, root_h=1.0, knots=22, stubs=4, lean=1.5, tip_k=0.4,
        cards=2900, sizes3=((0.62, 0.95), (0.4, 0.66), (0.2, 0.36)), lobes=12,
        leaves3d=620, autumn=0.08),
    'pine': dict(
        whorl=(1.7, 0.36), branches=7, reach=2.7, trunk_n=18, trunk_sides=22,
        roots=6, root_amp=0.9, root_h=1.1, knots=14, stubs=7, lean=1.5,
        cards_per_branch=5, size=(0.7, 1.1), skirt=7, sub=5, tufts=2, needles=7),
}

# 'detail' is the tier for trees the camera sees clearly but not up close: the same
# trunk and boughs with the twig level dropped, and a few hundred larger cards.
DETAIL = {
    'oak': dict(lens=[4.6, 3.4, 2.3], kids=[6, 3], sides=(6, 5, 4), cards=400, size=(1.2, 1.9)),
    'maple': dict(lens=[4.0, 2.8, 1.9], kids=[5, 3], sides=(6, 5, 4), cards=360, size=(1.05, 1.7)),
    'poplar': dict(lens=[10.0, 1.9, 1.2], kids=[11, 2], sides=(6, 5, 4), cards=300, size=(0.95, 1.5)),
    'pine': dict(whorl=(1.9, 0.85), branches=6, cards_per_branch=4, size=(1.4, 2.1), skirt=7),
}

# 'lite' is the tier for the many trees beyond that: a trunk and the main boughs and
# about a hundred big cards (~0.5 to 0.9k triangles), still real branching and real leaves,
# where the lean module is a 40-triangle blob.
LITE = {
    'oak': dict(lens=[4.6, 3.4], kids=[6], sides=(5, 4), cards=130, size=(2.0, 3.0), lobes=7),
    'maple': dict(lens=[4.0, 2.8], kids=[5], sides=(5, 4), cards=120, size=(1.8, 2.7), lobes=7),
    'poplar': dict(lens=[10.0, 1.9], kids=[9], sides=(5, 4), cards=110, size=(1.5, 2.3), lobes=6),
    'pine': dict(whorl=(2.2, 1.75), branches=4, cards_per_branch=2, size=(1.9, 2.8), skirt=2),
}
TIERS = {'ultra': ULTRA, 'detail': DETAIL, 'lite': LITE}

# individual 3D leaves: a blade as a few stations along its length, each (t, half-width as a
# fraction of the blade's width scale, 0) -- the lobed oak swings in and out, the maple is a
# fan (see leaf_maple), the poplar a pointed oval. L is the blade length in metres.
LEAF = {
    'oak': dict(L=0.15, W=0.30, droop=0.28, cup=0.10,
                st=((0.0, 0.07), (0.16, 0.62), (0.34, 0.46), (0.52, 0.86), (0.70, 0.50), (0.86, 0.60))),
    'poplar': dict(L=0.115, W=0.30, droop=0.22, cup=0.12,
                   st=((0.0, 0.06), (0.22, 0.82), (0.50, 1.0), (0.78, 0.58))),
    'maple': dict(L=0.115, W=1.0, droop=0.20, cup=0.14),
}
# the maple's blade as polar (angle degrees from the leaf axis, radius): five lobes, the sinuses between
MAPLE_OUTLINE = ((180, 0.10), (112, 0.34), (74, 0.82), (55, 0.52), (36, 1.0), (18, 0.58), (0, 1.0),
                 (-18, 0.58), (-36, 1.0), (-55, 0.52), (-74, 0.82), (-112, 0.34))

# the colours of an individual leaf: (base, tip) in linear light, same palette the cards are drawn in;
# an autumn leaf picks one of AUTUMN
AUTUMN = {
    'oak': ('#7a3c14', '#d09030'), 'maple': ('#7a1a10', '#d8452a'), 'poplar': ('#a08a22', '#ecd860'),
    'pine': ('#4a7a36', '#a4c868'),
}


def lin(h):
    return Vector(foliage._srgb(h))


class TreeBuilder:
    def __init__(self, layout, species, seed, lod='hero'):
        self.layout, self.species, self.lod = layout, species, lod
        self.P = {**PARAMS[species], **TIERS.get(lod, {}).get(species, {})}
        self.rng = random.Random(f'{species}/{seed}')
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.col = self.bm.loops.layers.float_color.new('Col')
        self.normals = []
        self.anchors = []          # branch tips the canopy's small cards gather at
        self.twigs = []            # (points, directions) of every last-level twig, for 3D leaves
        self.tris = Counter()      # triangles by kind, for tuning
        self.bark_rect = layout.bark[species]
        sx, sy, sw, sh = layout.swatch
        A = layout.size
        self.swatch_uv = ((sx + sw / 2) / A, 1 - (sy + sh / 2) / A)
        P = self.P
        # a tree leans a little, and its crown with it
        az = self.rng.uniform(0, 2 * math.pi)
        lean = math.radians(P.get('lean', 0.0))
        self.lean = Vector((math.cos(az) * math.sin(lean), math.sin(az) * math.sin(lean), math.cos(lean)))
        self.crown = None
        if 'centre' in P:
            c = Vector(P['centre'])
            self.crown = (c + Vector((self.lean.x / self.lean.z * c.z, self.lean.y / self.lean.z * c.z, 0)),
                          Vector(P['radii']))
        base, tip = foliage.SPECIES[species]['base'], foliage.SPECIES[species]['tip']
        self.leaf_cols = (lin(base), lin(tip))
        self.autumn_cols = tuple(lin(c) for c in AUTUMN[species])

    # -- face plumbing ---------------------------------------------------------------

    def _atlas_uv(self, rect, u, v):
        x, y, w, h = rect
        A = self.layout.size
        return ((x + u * w) / A, 1 - (y + (1 - v) * h) / A)

    def _face(self, pts, uvs, normals, cols=None, cat='bark'):
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        for i, (loop, uv) in enumerate(zip(f.loops, uvs)):
            loop[self.uv].uv = uv
            c = cols[i] if cols else (1.0, 1.0, 1.0)
            loop[self.col] = (c[0], c[1], c[2], 1.0)
        self.normals.extend(normals)
        self.tris[cat] += len(pts) - 2

    def _double(self, pts, uvs, normals, cols, facing, cat):
        """A face and its back, both with the same normals: the first looks along `facing`."""
        geo = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        if geo.dot(facing) < 0:
            pts, uvs, normals, cols = pts[::-1], uvs[::-1], normals[::-1], cols[::-1]
        self._face(pts, uvs, normals, cols, cat)
        self._face(pts[::-1], uvs[::-1], normals[::-1], cols[::-1], cat)

    # -- light -----------------------------------------------------------------------

    def occ(self, p):
        """The light that reaches a point: 1 on the sunlit skin of the crown, dark in its heart,
        darker again underneath."""
        P = self.P
        if self.species == 'pine':
            frac = clamp(p.z / P['height'])
            reach = max(P['reach'] * (1 - frac) ** 0.9, 0.3)
            outer = smooth(0.1, 1.0, math.hypot(p.x, p.y) / reach)
            return clamp((0.30 + 0.70 * outer ** 0.9) * (0.60 + 0.40 * smooth(0.0, 0.8, frac)), 0.1, 1.0)
        c, r = self.crown
        q = Vector(((p.x - c.x) / r.x, (p.y - c.y) / r.y, (p.z - c.z) / r.z))
        outer = smooth(0.1, 1.0, q.length)
        under = smooth(-0.9, 0.6, q.z)
        return clamp((0.28 + 0.72 * outer ** 0.9) * (0.62 + 0.38 * under), 0.1, 1.0)

    def bark_light(self, p):
        """Bark under the crown is in its shade; a trunk's foot is in the ground's."""
        return clamp((0.38 + 0.62 * self.occ(p)) * (0.74 + 0.26 * smooth(0.0, 0.9, p.z)), 0.15, 1.0)

    # -- bark ------------------------------------------------------------------------

    def tube(self, pts, radii, sides, v0_frac=0.0, mod=None, cat='bark', closed=False):
        """Tapering bark tube along `pts`. Bark texel density is TEXEL unless the
        tube is too long for the strip (a 10 m poplar trunk), when it is relaxed so
        the V range stays inside it instead of sampling whatever lies beyond.
        `mod(ring, angle)` scales a ring's radius at an angle (buttresses)."""
        rect = self.bark_rect
        n = len(pts)
        total = sum((pts[i + 1] - pts[i]).length for i in range(n - 1))
        texel = min(TEXEL, 0.92 * rect[3] / max(total, 1e-3))
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
            rings.append((pts[i], N.copy(), B.copy(), radii[i], s, self.bark_light(pts[i])))
            if i + 1 < n:
                s += (pts[i + 1] - pts[i]).length
        # keep V off the strip's very edge: it is a different tile beyond it
        vv = lambda v: 0.004 + 0.992 * v
        for i in range(n - 1):
            ca, na, ba, ra, sa, la = rings[i]
            cb, nb, bb, rb, sb, lb = rings[i + 1]
            umax = min(1.0, max(0.18, 2 * math.pi * (ra + rb) / 2 * texel / rect[2]))
            va = v0 + sa * texel / rect[3]
            vb = v0 + sb * texel / rect[3]
            ma = [mod(i, 2 * math.pi * j / sides) if mod else 1.0 for j in range(sides + 1)]
            mb = [mod(i + 1, 2 * math.pi * j / sides) if mod else 1.0 for j in range(sides + 1)]
            for j in range(sides):
                a0, a1 = 2 * math.pi * j / sides, 2 * math.pi * (j + 1) / sides
                d0 = math.cos(a0) * na + math.sin(a0) * ba
                d1 = math.cos(a1) * na + math.sin(a1) * ba
                e0 = math.cos(a0) * nb + math.sin(a0) * bb
                e1 = math.cos(a1) * nb + math.sin(a1) * bb
                quad = [ca + d0 * ra * ma[j], ca + d1 * ra * ma[j + 1],
                        cb + e1 * rb * mb[j + 1], cb + e0 * rb * mb[j]]
                nrm = [d0, d1, e1, e0]
                u0, u1 = j / sides * umax, (j + 1) / sides * umax
                uvs = [self._atlas_uv(rect, u0, vv(va)), self._atlas_uv(rect, u1, vv(va)),
                       self._atlas_uv(rect, u1, vv(vb)), self._atlas_uv(rect, u0, vv(vb))]
                cols = [(la,) * 3, (la,) * 3, (lb,) * 3, (lb,) * 3]
                geo = (quad[1] - quad[0]).cross(quad[3] - quad[0])
                if geo.dot(d0 + d1) < 0:
                    quad.reverse(); nrm.reverse(); uvs.reverse(); cols.reverse()
                self._face(quad, uvs, nrm, cols, cat)
        if closed:
            # the cut end of a thick bough: a fan of triangles in the dark of the heartwood
            c, nn, bb, r, _, lt = rings[-1]
            t = (pts[-1] - pts[-2]).normalized()
            uv = self._atlas_uv(rect, 0.5, 0.5)
            ring = [c + (math.cos(2 * math.pi * j / sides) * nn + math.sin(2 * math.pi * j / sides) * bb) * r
                    for j in range(sides)]
            for j in range(sides):
                self._face([c + t * r * 0.08, ring[j], ring[(j + 1) % sides]], [uv] * 3, [t] * 3,
                           [(lt * 0.5,) * 3] * 3, cat)

    def cap(self, centre, axis, radius, sides=6, light=0.35):
        """A dark disc closing the cut end of a stub."""
        ref = Z if abs(axis.z) < 0.9 else Vector((1, 0, 0))
        N = axis.cross(ref).normalized()
        B = axis.cross(N)
        rect = self.bark_rect
        uv = self._atlas_uv(rect, 0.5, 0.5)
        ring = [centre + (N * math.cos(2 * math.pi * j / sides) + B * math.sin(2 * math.pi * j / sides)) * radius
                for j in range(sides)]
        for j in range(sides):
            self._face([centre + axis * radius * 0.12, ring[j], ring[(j + 1) % sides]], [uv] * 3,
                       [axis] * 3, [(light,) * 3] * 3, 'bark')

    def knot(self, pos, out, radius, height):
        """A burl on the bark: a raised lip round a dark hollow, where a branch once was."""
        ref = Z if abs(out.z) < 0.9 else Vector((1, 0, 0))
        N = out.cross(ref).normalized()
        B = out.cross(N)
        rect = self.bark_rect
        n = 8
        # (radius fraction, height fraction, light) of the rings: skin, lip, hollow
        prof = ((1.0, 0.0, 0.95), (0.62, 1.0, 0.8), (0.28, 0.35, 0.22))
        rings = []
        for rf, hf, lt in prof:
            rings.append([(pos + (N * math.cos(2 * math.pi * j / n) + B * math.sin(2 * math.pi * j / n)) * radius * rf
                           + out * height * hf, lt) for j in range(n)])
        uvc = self.rng.uniform(0.2, 0.8), self.rng.uniform(0.2, 0.8)
        uv = self._atlas_uv(rect, *uvc)
        base_l = self.bark_light(pos)
        for k in range(len(prof) - 1):
            for j in range(n):
                a, b = rings[k][j], rings[k][(j + 1) % n]
                c, d = rings[k + 1][(j + 1) % n], rings[k + 1][j]
                quad = [a[0], b[0], c[0], d[0]]
                cols = [(a[1] * base_l,) * 3, (b[1] * base_l,) * 3, (c[1] * base_l,) * 3, (d[1] * base_l,) * 3]
                nrm = [(q - pos).normalized() * 0.6 + out * 0.8 for q in quad]
                nrm = [m.normalized() for m in nrm]
                if (quad[1] - quad[0]).cross(quad[3] - quad[0]).dot(out) < 0:
                    quad.reverse(); cols.reverse(); nrm.reverse()
                self._face(quad, [uv] * 4, nrm, cols, 'bark')
        lt = prof[-1][2] * base_l
        for j in range(n):
            tri = [rings[-1][j][0], rings[-1][(j + 1) % n][0], pos + out * height * 0.1]
            if (tri[1] - tri[0]).cross(tri[2] - tri[0]).dot(out) < 0:
                tri.reverse()
            self._face(tri, [uv] * 3, [out] * 3, [(lt,) * 3] * 3, 'bark')

    def mod_roots(self, a0):
        """Radius multiplier of the trunk's rings: buttresses spreading out of the ground."""
        k = self.P['roots']
        self._root_phases = [self.rng.uniform(-0.25, 0.25) for _ in range(k)]
        self._root_a0 = a0
        self._root_s = []                      # filled by the trunk with each ring's height
        return lambda i, a: self.root_mult(self._root_s[i], a)

    def root_mult(self, s, a):
        """Buttresses: lobes that are broad at the foot and narrow as they climb the trunk."""
        P = self.P
        k, amp, h = P['roots'], P['root_amp'], P['root_h']
        if s > 4 * h:
            return 1.0
        f = 0.0
        for m, ph in enumerate(self._root_phases):
            da = (a - self._root_a0 - 2 * math.pi * m / k - ph + math.pi) % (2 * math.pi) - math.pi
            f = max(f, max(0.0, math.cos(da * k / 2)) ** 2.5)
        return 1.0 + amp * math.exp(-s / h) * (0.25 + 0.75 * f)

    def root_tubes(self, trunk_r):
        """Roots surfacing from the trunk's foot and running into the ground."""
        P, rng = self.P, self.rng
        k = P['roots']
        a0 = self._root_a0
        for m in range(k):
            a = a0 + 2 * math.pi * m / k + rng.uniform(-0.25, 0.25)
            d = Vector((math.cos(a), math.sin(a), 0))
            r = trunk_r * rng.uniform(0.28, 0.4)
            reach = trunk_r * rng.uniform(2.6, 3.8)
            pts = [d * trunk_r * 0.7 + Vector((0, 0, trunk_r * rng.uniform(0.9, 1.4))),
                   d * trunk_r * 1.35 + Vector((0, 0, trunk_r * 0.55)),
                   d * (trunk_r + reach * 0.55) + Vector((0, 0, trunk_r * 0.14)),
                   d * (trunk_r + reach) + Vector((0, 0, 0.0))]
            self.tube(pts, [r * 1.15, r * 0.85, r * 0.55, r * 0.25], 7, rng.random(), cat='roots')

    def scatter_bark_details(self, pts, radii):
        """Knots and stubs on the trunk (pts are its stations)."""
        P, rng = self.P, self.rng

        def at(t):
            f = t * (len(pts) - 1)
            i = min(int(f), len(pts) - 2)
            fr = f - i
            return pts[i].lerp(pts[i + 1], fr), radii[i] + (radii[i + 1] - radii[i]) * fr
        for _ in range(P.get('knots', 0)):
            c, r = at(rng.uniform(0.12, 0.85))
            a = rng.uniform(0, 2 * math.pi)
            out = Vector((math.cos(a), math.sin(a), 0))
            rad = rng.uniform(0.035, 0.09)
            r *= self.root_mult(max(c.z, 0.0), a) if c.z < 4 * P['root_h'] else 1.0
            self.knot(c + out * r * 0.97, out, rad, rad * rng.uniform(0.35, 0.6))
        for _ in range(P.get('stubs', 0)):
            c, r = at(rng.uniform(0.25, 0.6))
            a = rng.uniform(0, 2 * math.pi)
            out = Vector((math.cos(a), math.sin(a), 0))
            r *= self.root_mult(max(c.z, 0.0), a) if c.z < 4 * P['root_h'] else 1.0
            d = (out * 0.9 + Z * rng.uniform(0.0, 0.5)).normalized()
            ln = rng.uniform(0.18, 0.4)
            rr = rng.uniform(0.03, 0.05)
            p0 = c + out * r * 0.8
            path = [p0, p0 + d * ln * 0.5 + Vector((0, 0, -0.01)), p0 + d * ln + Vector((0, 0, -0.03))]
            self.tube(path, [rr * 1.5, rr * 1.0, rr * 0.85], 6, rng.random())
            self.cap(path[-1], d, rr * 0.85, 6)

    def grow(self, p0, d0, depth, r0):
        P, rng = self.P, self.rng
        length = P['lens'][depth] * rng.uniform(0.85, 1.12) if depth else P['lens'][0]
        n = P['segs'][min(depth, len(P['segs']) - 1)] if 'segs' in P else (6 if depth == 0 else 4)
        tip_k = P.get('tip_k', 0.35)
        r1 = r0 * (P['trunk_r'][1] / P['trunk_r'][0] if depth == 0 else tip_k)
        pts, dirs, d = [p0], [d0.normalized()], d0.normalized()
        # the trunk's stations crowd towards its foot, where the buttresses are
        spacing = [((i + 1) / (n - 1)) ** 1.35 if depth == 0 and 'roots' in P else (i + 1) / (n - 1)
                   for i in range(n - 1)]
        prev = 0.0
        # a branch is an arc, not a random walk: a steady bend to one side, and the outer ones sag
        bend_ax = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)))
        bend_ax = (bend_ax - d0 * bend_ax.dot(d0)).normalized() if depth else Vector((0, 0, 0))
        bend = P.get('bend', 0.0)
        droop = P['droop'][min(depth, len(P['droop']) - 1)] if 'droop' in P else 0.0
        # the hero tier's four stations are the unit: more of them take smaller steps
        ks = 3.0 / (n - 1) if 'segs' in P else 1.0
        for k in range(n - 1):
            step = (spacing[k] - prev) * length
            prev = spacing[k]
            j = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * P['wobble'] \
                * (0.22 if depth == 0 else 1.0) * math.sqrt(ks)
            if depth == 0:
                # a trunk stands up (leaning a little, as its tree does)
                d = (d + j + Z * P['up'] * ks).normalized()
                d = (d * 0.92 + self.lean * 0.08).normalized()
            else:
                d = (d + j + Z * P['up'] * ks + bend_ax * (bend * ks * 1.2) - Z * (droop * ks)).normalized()
            pts.append(pts[-1] + d * step)
            dirs.append(d)
        if depth >= 2 and self.crown is not None:
            # twigs that end outside the crown would stick out of it bare
            c, e = self.crown
            tip = pts[-1]
            if Vector(((tip.x - c.x) / e.x, (tip.y - c.y) / e.y, (tip.z - c.z) / e.z)).length > 1.1:
                return
        radii = [r0 + (r1 - r0) * (i / (n - 1)) ** (0.8 if depth == 0 and 'roots' in P else 1.0) for i in range(n)]
        mod = None
        if depth == 0:
            if 'roots' in P:
                mod = self.mod_roots(rng.uniform(0, 2 * math.pi))
                self._root_s[:] = [max(p.z, 0.0) for p in pts]
            else:
                radii[0] *= 1.4
                radii[1] *= 1.12
        elif 'collar' in P:
            # the swelling where a branch leaves its parent
            radii[0] *= P['collar']
            if n > 2:
                radii[1] *= 1 + (P['collar'] - 1) * 0.35
        self.tube(pts, radii, P['sides'][min(depth, len(P['sides']) - 1)], rng.random(), mod,
                  closed=depth >= 1 and radii[-1] > 0.03)
        if depth == 0 and 'roots' in P:
            self.root_tubes(radii[0] * 0.95)
            self.scatter_bark_details(pts, radii)
        if depth < len(P['kids']):
            nk = P['kids'][depth]
            az0 = rng.uniform(0, 2 * math.pi)
            for kk in range(nk):
                f = rng.uniform(*P['kid_t']) * (n - 1)
                i = min(int(f), n - 2)
                fr = f - i
                pos = pts[i].lerp(pts[i + 1], fr)
                par = dirs[i].lerp(dirs[i + 1], fr).normalized()
                ang = math.radians(rng.uniform(*P['angle']))
                # branches round a bough are spread by the golden angle, not thrown at random
                az = az0 + kk * GOLDEN + rng.uniform(-0.5, 0.5) if 'segs' in P else rng.uniform(0, 2 * math.pi)
                ref = Z if abs(par.z) < 0.9 else Vector((1, 0, 0))
                a = par.cross(ref).normalized()
                b = par.cross(a)
                cd = par * math.cos(ang) + (a * math.cos(az) + b * math.sin(az)) * math.sin(ang)
                rr = radii[i] + (radii[i + 1] - radii[i]) * fr
                self.grow(pos, cd, depth + 1, rr * P['taper'])
        else:
            self.anchors.append(pts[-1])
            self.anchors.append(pts[-2])
            self.anchors.append(pts[1])
            self.twigs.append((pts, dirs))

    # -- leaves ----------------------------------------------------------------------

    def card(self, centre, n_geo, light_n, size, variant, flip, shade=1.0, tint=(1, 1, 1)):
        """A pair of back-to-back cards. `n_geo` is the card's facing, `light_n` the
        shading normal both faces use. `shade` and `tint` are the vertex colour."""
        rng = self.rng
        rect = self.layout.cards[(self.species, variant)]
        ref = Vector((0, 0, 1))
        right = ref.cross(n_geo)
        if right.length < 1e-3:
            right = Vector((1, 0, 0))
        right.normalize()
        up = n_geo.cross(right)
        roll = rng.uniform(0, 2 * math.pi)
        right, up = (right * math.cos(roll) + up * math.sin(roll),
                     up * math.cos(roll) - right * math.sin(roll))
        w = size
        h = size * rect[3] / rect[2]
        c = [centre - right * w / 2 - up * h / 2, centre + right * w / 2 - up * h / 2,
             centre + right * w / 2 + up * h / 2, centre - right * w / 2 + up * h / 2]
        u0, u1 = (1.0, 0.0) if flip else (0.0, 1.0)
        uvs = [self._atlas_uv(rect, u0, 0.0), self._atlas_uv(rect, u1, 0.0),
               self._atlas_uv(rect, u1, 1.0), self._atlas_uv(rect, u0, 1.0)]
        # each corner takes the light at its own place; the card's own lower edge a touch darker
        cols = []
        for k, p in enumerate(c):
            s = shade * (0.94 + 0.06 * self.occ(p) / max(self.occ(centre), 0.05) - (0.08 if k < 2 else 0.0))
            s = clamp(s)
            cols.append((s * tint[0], s * tint[1], s * tint[2]))
        self._double(c, uvs, [light_n] * 4, cols, n_geo, 'cards')

    def canopy(self):
        P, rng = self.P, self.rng
        centre, radii = self.crown
        anchors = self.anchors
        sizes3 = P.get('sizes3')
        # the crown is a handful of overlapping lobes, not one ellipsoid: each lobe is
        # a rounded mass of leaves with its own shading, and the dark gaps between them
        # are what make a silhouette read as a tree rather than a bush-shaped ball
        lobes = []
        for _ in range(P.get('lobes', 8)):
            d = Vector((rng.gauss(0, 1), rng.gauss(0, 1), abs(rng.gauss(0, 0.9)) - 0.25)).normalized()
            c = centre + Vector((d.x * radii.x, d.y * radii.y, d.z * radii.z)) * rng.uniform(0.4, 0.72)
            lobes.append((c, rng.uniform(0.36, 0.52) * min(radii.x, radii.y), self.pick_tone()))
        autumn = P.get('autumn', 0.0)
        for i in range(P['cards']):
            lobe_c, tone = None, None
            if i % 3 == 0:
                # a third of the cards fill the volume directly, so the crown is
                # one mass rather than a clump per branch tip with sky between
                base = centre + Vector((rng.gauss(0, 0.55) * radii.x, rng.gauss(0, 0.55) * radii.y,
                                        rng.gauss(0, 0.5) * radii.z))
                size = rng.uniform(*sizes3[0]) if sizes3 else rng.uniform(*P['size'])
            elif i % 3 == 1:
                lobe_c, lobe_r, tone = lobes[rng.randrange(len(lobes))]
                base = lobe_c + Vector((rng.gauss(0, 0.5), rng.gauss(0, 0.5), rng.gauss(0, 0.5))) * lobe_r
                size = rng.uniform(*sizes3[1]) if sizes3 else rng.uniform(*P['size'])
            else:
                base = anchors[i % len(anchors)]
                size = rng.uniform(*sizes3[2]) if sizes3 else rng.uniform(*P['size'])
            off = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 0.8))) * size * 0.55
            p = base + off
            q = Vector(((p.x - centre.x) / radii.x, (p.y - centre.y) / radii.y, (p.z - centre.z) / radii.z))
            if q.length > 1.0:
                q = q / q.length
                p = centre + Vector((q.x * radii.x, q.y * radii.y, q.z * radii.z))
            radial = p - centre
            radial = radial.normalized() if radial.length > 1e-4 else Vector((0, 0, 1))
            if lobe_c is not None and (p - lobe_c).length > 1e-4:
                radial = (radial * 0.4 + (p - lobe_c).normalized() * 0.6).normalized()
            rnd = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
            n_geo = (radial * 0.55 + rnd * 0.9).normalized()
            light_n = (radial * 0.85 + Vector((0, 0, 0.35)) + n_geo * 0.15).normalized()
            if tone is None:
                tone = self.pick_tone()
            variant = rng.randrange(2)
            # a few cards are in their autumn colours, on the sunlit skin, towards the top
            if autumn and q.length > 0.8 and rng.random() < autumn * (0.5 + max(q.z, 0.0) * 1.5):
                variant = 2
            self.card(p, n_geo, light_n, size, variant, rng.random() < 0.5, self.occ(p) * tone[0], tone[1])

    def pick_tone(self):
        """(brightness, tint) of a cluster of leaves: some are lighter, some darker, some warm or cool."""
        rng = self.rng
        k = rng.random()
        tint = (1.0, 1.0, 1.0) if k < 0.66 else (1.0, 0.93, 0.62) if k < 0.84 else (0.78, 0.95, 0.9)
        return (rng.uniform(0.78, 1.0), tint)

    # -- individual 3D leaves and needles ---------------------------------------------

    def leaf_colour(self, rng):
        a = self.P.get('autumn', 0.0)
        base, tip = self.leaf_cols
        if a and rng.random() < a:
            base, tip = self.autumn_cols
            if self.species == 'maple' and rng.random() < 0.5:
                tip = tip * 0.8
        k = rng.uniform(0.0, 1.0)
        col = base.lerp(tip, k * 0.7)
        tone = rng.uniform(0.7, 1.15)
        return col * tone

    def leaf3d(self, o, x, zn, L, light_n, colour, shade):
        """One blade: o its stalk end, x along it, zn out of its face, L long."""
        spec = LEAF[self.species]
        y = zn.cross(x)
        uv = self.swatch_uv

        def vc(c, f):
            return (clamp(c.x * f * shade), clamp(c.y * f * shade), clamp(c.z * f * shade))

        if self.species == 'maple':
            R = L
            hub = o + x * R * 0.12
            ring = []
            for ang, rad in MAPLE_OUTLINE:
                a = math.radians(ang)
                u = rad * R
                cup = spec['cup'] * R * (rad ** 2)
                ring.append((hub + (x * math.cos(a) + y * math.sin(a)) * u + zn * (cup - spec['droop'] * R * 0.5 * rad ** 2),
                             rad))
            hub_c = vc(colour, 1.35)
            n = len(ring)
            for i in range(n):
                (pa, ra), (pb, rb) = ring[i], ring[(i + 1) % n]
                cols = [hub_c, vc(colour, 0.85 + 0.2 * ra), vc(colour, 0.85 + 0.2 * rb)]
                nrm = [(light_n + zn * 0.2).normalized(),
                       (light_n + (pa - hub).normalized() * 0.35).normalized(),
                       (light_n + (pb - hub).normalized() * 0.35).normalized()]
                self._double([hub, pa, pb], [uv] * 3, nrm, cols, zn, 'leaves')
            return
        rows = []
        for t, w in spec['st']:
            W = w * spec['W'] * L
            s = t * L
            droop = spec['droop'] * L * t * t
            row = []
            for side in (-1, 0, 1):
                z = -droop + spec['cup'] * abs(side) * W * 1.5 - (0.04 * L if side == 0 and 0.0 < t < 1.0 else 0.0)
                row.append(o + x * s + y * side * W + zn * z)
            rows.append((t, row))
        tip = o + x * L + zn * (-spec['droop'] * L)
        # the vein is lighter, the edge a shade darker, the stalk the darkest
        cols_for = lambda t: (vc(colour, 0.82 + 0.25 * t), vc(colour, 1.28), vc(colour, 0.82 + 0.25 * t))
        side_n = [(light_n - y * 0.28).normalized(), light_n, (light_n + y * 0.28).normalized()]
        for k in range(len(rows) - 1):
            (t0, r0), (t1, r1) = rows[k], rows[k + 1]
            c0, c1 = cols_for(t0), cols_for(t1)
            for s in (0, 1):
                quad = [r0[s], r0[s + 1], r1[s + 1], r1[s]]
                cols = [c0[s], c0[s + 1], c1[s + 1], c1[s]]
                nrm = [side_n[s], side_n[s + 1], side_n[s + 1], side_n[s]]
                self._double(quad, [uv] * 4, nrm, cols, zn, 'leaves')
        t_last, r_last = rows[-1]
        cl = cols_for(t_last)
        tc = vc(colour, 1.1)
        for s in (0, 1):
            self._double([r_last[s], r_last[s + 1], tip], [uv] * 3, [side_n[s], side_n[s + 1], light_n],
                         [cl[s], cl[s + 1], tc], zn, 'leaves')

    def leaves3d(self):
        P, rng = self.P, self.rng
        n = P.get('leaves3d', 0)
        if not n or not self.twigs:
            return
        centre, _ = self.crown
        spec = LEAF[self.species]
        twigs = self.twigs[:]
        rng.shuffle(twigs)
        per = max(1, math.ceil(n / len(twigs)))
        made = 0
        for ti, (pts, dirs) in enumerate(twigs):
            for k in range(per):
                if made >= n:
                    return
                t = 1.0 - rng.random() ** 1.6 * 0.65         # towards the tip
                f = t * (len(pts) - 1)
                i = min(int(f), len(pts) - 2)
                fr = f - i
                pos = pts[i].lerp(pts[i + 1], fr)
                d = dirs[i].lerp(dirs[i + 1], fr).normalized()
                ref = Z if abs(d.z) < 0.9 else Vector((1, 0, 0))
                a = d.cross(ref).normalized()
                radial = pos - centre
                radial = radial.normalized() if radial.length > 1e-4 else Z
                # a leaf faces out of the crown and up to the sky, with some scatter; its blade runs
                # along the twig's direction as seen from there, swung about its own face
                rnd = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)))
                zn = (radial * 0.6 + Z * 0.7 + rnd * 0.35).normalized()
                x = d - zn * d.dot(zn)
                x = x.normalized() if x.length > 1e-3 else (a - zn * a.dot(zn)).normalized()
                sw = math.radians(rng.uniform(-75, 75))
                x = (x * math.cos(sw) + zn.cross(x) * math.sin(sw)).normalized()
                x = (x - Z * rng.uniform(0.0, 0.25)).normalized()           # leaves hang a little
                zn = (zn - x * zn.dot(x)).normalized()
                L = spec['L'] * rng.uniform(0.8, 1.3)
                light_n = (radial * 0.75 + Z * 0.3 + zn * 0.35).normalized()
                self.leaf3d(pos, x, zn, L, light_n, self.leaf_colour(rng), self.occ(pos + x * L * 0.5))
                made += 1

    # -- conifer ---------------------------------------------------------------------

    def needle_tuft(self, pos, along, count, length, colour, spread=0.55):
        """A fan of needles, each a thin double-sided triangle."""
        rng = self.rng
        uv = self.swatch_uv
        shade = self.occ(pos)
        ref = Z if abs(along.z) < 0.9 else Vector((1, 0, 0))
        a = along.cross(ref).normalized()
        b = along.cross(a)
        for k in range(count):
            az = k * GOLDEN + rng.uniform(-0.3, 0.3)
            dirv = (along + (a * math.cos(az) + b * math.sin(az)) * spread * rng.uniform(0.5, 1.2)
                    - Z * rng.uniform(0.0, 0.18)).normalized()
            ln = length * rng.uniform(0.8, 1.2)
            side = dirv.cross(Z)
            side = side.normalized() if side.length > 1e-3 else a
            w = 0.0045
            base = pos + dirv * 0.005
            tip = base + dirv * ln + Z * (-0.012)
            kk = rng.uniform(0.75, 1.15)
            cb, ct = colour * 0.62 * kk, colour * 1.18 * kk
            vcb = (clamp(cb.x * shade), clamp(cb.y * shade), clamp(cb.z * shade))
            vct = (clamp(ct.x * shade), clamp(ct.y * shade), clamp(ct.z * shade))
            mid = base + dirv * ln * 0.5 + side * 0.0
            light_n = (dirv * 0.3 + Vector((pos.x, pos.y, 0)).normalized() * 0.5 + Z * 0.8).normalized() \
                if Vector((pos.x, pos.y, 0)).length > 1e-3 else Z
            pts = [base - side * w, base + side * w, tip]
            self._double(pts, [uv] * 3, [light_n] * 3, [vcb, vcb, vct], Z, 'needles')

    def conifer(self):
        P, rng = self.P, self.rng
        H = P['height']
        n = P.get('trunk_n', 7)
        ultra = 'sub' in P
        lean = Vector((self.lean.x / self.lean.z, self.lean.y / self.lean.z, 0))
        pts = []
        for i in range(n):
            f = i / (n - 1)
            z = H * (f ** 1.25 if ultra else f)
            wob = rng.uniform(-0.05, 0.05) * f
            pts.append(Vector((wob + lean.x * z * 0.5, rng.uniform(-0.05, 0.05) * f + lean.y * z * 0.5, z)))
        radii = [P['trunk_r'][0] * (1.35 if i == 0 and not ultra else 1.0) * (1 - i / (n - 1)) ** 0.9 + P['trunk_r'][1]
                 for i in range(n)]
        mod = None
        if ultra:
            mod = self.mod_roots(rng.uniform(0, 2 * math.pi))
            self._root_s[:] = [max(p.z, 0.0) for p in pts]
        self.tube(pts, radii, P.get('trunk_sides', 8), 0.0, mod)
        if ultra:
            self.root_tubes(radii[0] * 0.95)
            self.scatter_bark_details(pts, radii)
        col_b, col_t = self.leaf_cols
        z, k = P['whorl'][0], 0
        while z < H - 0.7:
            frac = (z - P['whorl'][0]) / (H - 0.7 - P['whorl'][0])
            # layers: every few whorls a fuller one, so the tree reads as tiers
            tier = 1.0 + (0.14 * math.sin(k * 1.9) if ultra else 0.0)
            reach = P['reach'] * (1 - frac) ** 0.9 * tier
            twist = rng.uniform(0, 2 * math.pi)
            nb = P['branches'] + (rng.randrange(-1, 2) if ultra else 0)
            for b in range(nb):
                az = twist + 2 * math.pi * b / nb + rng.uniform(-0.2, 0.2)
                d = Vector((math.cos(az), math.sin(az), 0))
                L = max(0.5, reach * rng.uniform(0.82, 1.1))
                base = Vector((lean.x * z * 0.5, lean.y * z * 0.5, z + rng.uniform(-0.1, 0.1)))
                path = [base, base + d * L * 0.45 + Vector((0, 0, -0.06 * L)),
                        base + d * L * 0.8 + Vector((0, 0, -0.2 * L)),
                        base + d * L + Vector((0, 0, -0.42 * L))]
                if ultra:
                    # five stations so the bough can arc and curl up at the end
                    path = [base, base + d * L * 0.28 + Z * (0.02 * L), base + d * L * 0.58 + Z * (-0.08 * L),
                            base + d * L * 0.84 + Z * (-0.24 * L), base + d * L + Z * (-0.36 * L)]
                    rads = [0.05 * (1 - frac) + 0.035, 0.04 * (1 - frac) + 0.027, 0.03 * (1 - frac) + 0.02, 0.016, 0.007]
                    self.tube(path, rads, 6, rng.random())
                else:
                    self.tube(path, [0.06 * (1 - frac) + 0.03, 0.04 * (1 - frac) + 0.02, 0.025, 0.012], 5, rng.random())
                m = len(path) - 1
                at = lambda t: path[min(int(t * m), m - 1)].lerp(path[min(int(t * m), m - 1) + 1], t * m - min(int(t * m), m - 1))
                for c in range(P['cards_per_branch']):
                    t = 0.22 + 0.78 * (c + rng.uniform(0, 0.6)) / P['cards_per_branch']
                    pos = at(min(t, 0.999)) + Vector((0, 0, rng.uniform(-0.06, 0.1)))
                    size = rng.uniform(*P['size']) * (0.7 + 0.5 * (1 - frac))
                    # the spray lies along the branch: its facing is up, tilted outward
                    n_geo = (Z + d * 0.35 + Vector((rng.uniform(-.2, .2),) * 2 + (0,))).normalized()
                    radial = Vector((pos.x, pos.y, 0))
                    radial = radial.normalized() if radial.length > 1e-4 else d
                    light_n = (radial * 0.5 + Vector((0, 0, 0.8))).normalized()
                    var = 2 if (ultra and t > 0.8 and rng.random() < 0.3) else rng.randrange(2)
                    tone = self.pick_tone()
                    self.card_along(pos, d, n_geo, light_n, size, var, rng.random() < 0.5,
                                    self.occ(pos) * tone[0], tone[1])
                if ultra:
                    self.pine_sub(path, d, frac)
            # a skirt of sprays fills the gaps between branches: conifers are dense
            for _ in range(P['skirt']):
                az = rng.uniform(0, 2 * math.pi)
                out = Vector((math.cos(az), math.sin(az), 0))
                r = reach * rng.uniform(0.4, 0.85)
                pos = Vector((out.x * r, out.y * r, z - 0.2 - 0.45 * r / P['reach'] * 1.6))
                n_geo = (out * 0.5 + Vector((0, 0, 0.85))).normalized()
                light_n = (out * 0.55 + Vector((0, 0, 0.75))).normalized()
                tone = self.pick_tone()
                self.card_along(pos, out, n_geo, light_n, rng.uniform(1.5, 2.2) * (0.6 + 0.6 * (1 - frac)) * (0.7 if ultra else 1.0),
                                rng.randrange(2), rng.random() < 0.5, self.occ(pos) * tone[0], tone[1])
            z += P['whorl'][1]
            k += 1
        # the leader: a last small spray at the top
        top = Vector((lean.x * H * 0.5, lean.y * H * 0.5, H - 0.5))
        self.card_along(top, Vector((1, 0, 0)), Z, Z, 1.3, 0, False, 0.95, (1, 1, 1))
        if ultra:
            for _ in range(5):
                self.needle_tuft(top + Z * rng.uniform(0.0, 0.4), Z, 9, 0.22, col_t, 0.8)

    def pine_sub(self, path, d, frac):
        """Side branchlets along a pine bough, each ending in tufts of needles."""
        P, rng = self.P, self.rng
        col_b, col_t = self.leaf_cols
        m = len(path) - 1
        total = sum((path[i + 1] - path[i]).length for i in range(m))
        for s in range(P['sub']):
            t = 0.3 + 0.68 * (s + rng.uniform(0, 0.5)) / P['sub']
            i = min(int(t * m), m - 1)
            pos = path[i].lerp(path[i + 1], t * m - i)
            side = 1 if s % 2 == 0 else -1
            perp = Z.cross(d) * side
            ln = total * 0.42 * (1.05 - t * 0.55) * rng.uniform(0.8, 1.15)
            dirv = (d * 0.62 + perp * 0.75 + Z * rng.uniform(-0.25, 0.1)).normalized()
            sp = [pos, pos + dirv * ln * 0.5 + Z * (-0.03 * ln), pos + dirv * ln + Z * (-0.12 * ln)]
            r = 0.016 * (1 - 0.4 * t)
            self.tube(sp, [r, r * 0.65, r * 0.35], 4, rng.random())
            for u in range(P['tufts']):
                tp = sp[1 + u] if u < 2 else sp[-1]
                tdir = (sp[-1] - sp[-2]).normalized() if u else (sp[-1] - sp[0]).normalized()
                col = col_b.lerp(col_t, rng.uniform(0.15, 0.85)) * rng.uniform(0.8, 1.2)
                self.needle_tuft(tp, tdir, P['needles'], rng.uniform(0.11, 0.17), col)

    def card_along(self, centre, along, n_geo, light_n, size, variant, flip, shade=1.0, tint=(1, 1, 1)):
        """A needle-spray card whose long axis follows the branch direction."""
        rect = self.layout.cards[(self.species, variant)]
        right = along - n_geo * along.dot(n_geo)
        right = right.normalized() if right.length > 1e-4 else Vector((1, 0, 0))
        up = n_geo.cross(right)
        w = size
        h = size * rect[3] / rect[2]
        c = [centre - right * w / 2 - up * h / 2, centre + right * w / 2 - up * h / 2,
             centre + right * w / 2 + up * h / 2, centre - right * w / 2 + up * h / 2]
        u0, u1 = (1.0, 0.0) if flip else (0.0, 1.0)
        uvs = [self._atlas_uv(rect, u0, 0.0), self._atlas_uv(rect, u1, 0.0),
               self._atlas_uv(rect, u1, 1.0), self._atlas_uv(rect, u0, 1.0)]
        cols = []
        for k in range(4):
            s = clamp(shade * (0.9 if k < 2 else 1.0))
            cols.append((s * tint[0], s * tint[1], s * tint[2]))
        self._double(c, uvs, [light_n] * 4, cols, n_geo, 'cards')

    def build(self):
        if self.species == 'pine':
            self.conifer()
        else:
            P = self.P
            self.grow(Vector((0, 0, 0)), self.lean.copy(), 0, P['trunk_r'][0])
            self.canopy()
            self.leaves3d()
        return self


class HeroTree:
    """A finished tree: geometry, normals, and what the manifest needs to know."""

    def __init__(self, mid, species, lean, scale, seed=1, lod='hero'):
        self.id, self.species, self.lean, self.scale, self.seed = mid, species, lean, scale, seed
        self.lod = lod
        self.kind = 'tree'
        self.builder = None

    def build(self, layout):
        self.builder = TreeBuilder(layout, self.species, self.seed, self.lod).build()
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
