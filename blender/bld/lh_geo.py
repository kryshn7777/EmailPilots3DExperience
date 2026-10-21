"""Mesh builders for the lighthouse: lathes, boxes, bars and rings, grouped by material.

Winding rule: a lathe profile must run up (or inward on a top face) for its normals
to face out. A `Part` is one material's mesh. Faces carry UVs at a fixed world density (`tile`
units per texture repeat), so the same stone reads at the same scale on the hull, the
plinth and the cottage. Z is up here; the exporter turns it into three's Y.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector, noise


class Part:
    def __init__(self, name, colours=False):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.col = self.bm.loops.layers.color.new('Col') if colours else None

    # -- primitives ---------------------------------------------------------------------

    def face(self, pts, uvs, smooth=False, colour=None):
        try:
            f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        except ValueError:
            return None
        for loop, uv in zip(f.loops, uvs):
            loop[self.uv].uv = uv
            if self.col is not None:
                loop[self.col] = colour or (1, 1, 1, 1)
        f.smooth = smooth
        return f

    def box(self, centre, size, yaw=0.0, tile=2.0, pitch=0.0, roll=0.0, colour=None):
        """A box of `size` (x, y, z), turned by yaw about Z (then pitch about its Y,
        roll about its X), centred at `centre`. UVs are box-projected."""
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        m = Matrix.Translation(centre) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(pitch, 4, 'Y') \
            @ Matrix.Rotation(roll, 4, 'X')
        loc = [Vector(p) for p in [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
                                   (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]]
        faces = [
            ((4, 5, 6, 7), 2), ((0, 3, 2, 1), 2),
            ((0, 4, 7, 3), 0), ((1, 2, 6, 5), 0),
            ((0, 1, 5, 4), 1), ((3, 7, 6, 2), 1),
        ]
        for idx, axis in faces:
            pts = [m @ loc[i] for i in idx]
            a, b = [(1, 2), (0, 2), (0, 1)][axis]
            uvs = [(loc[i][a] / tile, loc[i][b] / tile) for i in idx]
            self.face(pts, uvs, False, colour)

    def bar(self, p0, p1, w, h=None, tile=2.0, colour=None):
        """A square-section bar between two points (rails, braces, struts)."""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        L = d.length
        if L < 1e-6:
            return
        h = w if h is None else h
        z = d.normalized()
        ref = Vector((0, 0, 1)) if abs(z.z) < 0.95 else Vector((1, 0, 0))
        x = z.cross(ref).normalized()
        y = z.cross(x)
        m = Matrix((x.to_4d(), y.to_4d(), z.to_4d(), Vector((0, 0, 0, 1)))).transposed()
        m.translation = (p0 + p1) / 2
        loc = [Vector(p) for p in [(-w / 2, -h / 2, -L / 2), (w / 2, -h / 2, -L / 2), (w / 2, h / 2, -L / 2),
                                   (-w / 2, h / 2, -L / 2), (-w / 2, -h / 2, L / 2), (w / 2, -h / 2, L / 2),
                                   (w / 2, h / 2, L / 2), (-w / 2, h / 2, L / 2)]]
        for idx in ((4, 5, 6, 7), (0, 3, 2, 1), (0, 4, 7, 3), (1, 2, 6, 5), (0, 1, 5, 4), (3, 7, 6, 2)):
            pts = [m @ loc[i] for i in idx]
            uvs = [(loc[i][0] / tile + loc[i][1] / tile, loc[i][2] / tile) for i in idx]
            self.face(pts, uvs, False, colour)

    def lathe(self, profile, segs, tile=2.0, smooth=True, r_ref=1.0, colour=None, repeat=None, close=False):
        """Revolve `profile` [(radius, z), ...] about the Z axis. U wraps `repeat` times
        around (default: the whole number that keeps a tile near `tile` units at r_ref)."""
        if repeat is None:
            repeat = max(1, round(2 * math.pi * r_ref / tile))
        z0 = profile[0][1]
        for i in range(len(profile) - 1):
            (r0, za), (r1, zb) = profile[i], profile[i + 1]
            for j in range(segs):
                a0, a1 = 2 * math.pi * j / segs, 2 * math.pi * (j + 1) / segs
                c0, s0, c1, s1 = math.cos(a0), math.sin(a0), math.cos(a1), math.sin(a1)
                u0, u1 = repeat * j / segs, repeat * (j + 1) / segs
                pts = [Vector((r0 * c0, r0 * s0, za)), Vector((r0 * c1, r0 * s1, za)),
                       Vector((r1 * c1, r1 * s1, zb)), Vector((r1 * c0, r1 * s0, zb))]
                dz = (zb - za)
                length = math.hypot(r1 - r0, dz)
                uvs = [(u0, (za - z0) / tile), (u1, (za - z0) / tile),
                       (u1, (za - z0) / tile + length / tile), (u0, (za - z0) / tile + length / tile)]
                # a profile that closes on the axis collapses its quads to triangles
                if r0 < 1e-6:
                    pts, uvs = [pts[0], pts[2], pts[3]], [uvs[0], uvs[2], uvs[3]]
                elif r1 < 1e-6:
                    pts, uvs = [pts[0], pts[1], pts[2]], [uvs[0], uvs[1], uvs[2]]
                self.face(pts, uvs, smooth, colour)

    def cylinder(self, p0, p1, r0, r1=None, segs=12, tile=2.0, caps=True, smooth=True, colour=None):
        """A tapered cylinder between two arbitrary points."""
        p0, p1 = Vector(p0), Vector(p1)
        r1 = r0 if r1 is None else r1
        d = p1 - p0
        L = d.length
        z = d.normalized()
        ref = Vector((0, 0, 1)) if abs(z.z) < 0.95 else Vector((1, 0, 0))
        x = z.cross(ref).normalized()
        y = z.cross(x)

        def ring(t, r, a):
            return p0 + z * (L * t) + (x * math.cos(a) + y * math.sin(a)) * r

        for j in range(segs):
            a0, a1 = 2 * math.pi * j / segs, 2 * math.pi * (j + 1) / segs
            pts = [ring(0, r0, a0), ring(0, r0, a1), ring(1, r1, a1), ring(1, r1, a0)]
            u0, u1 = j / segs * (2 * math.pi * max(r0, r1) / tile), (j + 1) / segs * (2 * math.pi * max(r0, r1) / tile)
            self.face(pts, [(u0, 0), (u1, 0), (u1, L / tile), (u0, L / tile)], smooth, colour)
            if caps:
                self.face([p0, ring(0, r0, a1), ring(0, r0, a0)], [(0.5, 0.5)] * 3, False, colour)
                self.face([p1, ring(1, r1, a0), ring(1, r1, a1)], [(0.5, 0.5)] * 3, False, colour)

    def ring(self, z, r_major, r_minor, segs=24, minor=6, colour=None, tile=2.0, centre=(0.0, 0.0)):
        """A torus about the Z axis (rails, astragals, moulding rings)."""
        for i in range(segs):
            a0, a1 = 2 * math.pi * i / segs, 2 * math.pi * (i + 1) / segs
            for k in range(minor):
                b0, b1 = 2 * math.pi * k / minor, 2 * math.pi * (k + 1) / minor

                def pt(a, b):
                    rr = r_major + r_minor * math.cos(b)
                    return Vector((centre[0] + rr * math.cos(a), centre[1] + rr * math.sin(a), z + r_minor * math.sin(b)))
                self.face([pt(a0, b0), pt(a1, b0), pt(a1, b1), pt(a0, b1)],
                          [(i / segs * 6, k / minor), ((i + 1) / segs * 6, k / minor),
                           ((i + 1) / segs * 6, (k + 1) / minor), (i / segs * 6, (k + 1) / minor)], True, colour)

    def sphere(self, centre, r, scale=(1, 1, 1), segs=12, rings=8, colour=None, smooth=True, cut_below=None):
        c = Vector(centre)
        sx, sy, sz = scale
        for k in range(rings):
            p0, p1 = math.pi * k / rings - math.pi / 2, math.pi * (k + 1) / rings - math.pi / 2
            if cut_below is not None and p1 <= cut_below:
                continue
            for j in range(segs):
                a0, a1 = 2 * math.pi * j / segs, 2 * math.pi * (j + 1) / segs

                def pt(a, p):
                    return c + Vector((r * sx * math.cos(p) * math.cos(a), r * sy * math.cos(p) * math.sin(a), r * sz * math.sin(p)))
                self.face([pt(a0, p0), pt(a1, p0), pt(a1, p1), pt(a0, p1)],
                          [(j / segs * 3, k / rings * 2), ((j + 1) / segs * 3, k / rings * 2),
                           ((j + 1) / segs * 3, (k + 1) / rings * 2), (j / segs * 3, (k + 1) / rings * 2)], smooth, colour)

    # -- output -------------------------------------------------------------------------

    def finish(self, collection):
        if not self.bm.faces:
            return None
        # every builder winds its faces outward (see the notes on each), so no recalculation:
        # on an open surface it can flip a whole panel
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-6)
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        return obj


def fractal(x, y, z, octaves=5, gain=0.5, lac=2.0):
    """Fractal noise in roughly [-1, 1] (Blender's own, so it is deterministic)."""
    return noise.fractal(Vector((x, y, z)), gain, lac, octaves)
