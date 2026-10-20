"""Small bmesh toolkit shared by the high-poly and low-poly builders.

Blender is Z-up; the glTF exporter converts to the site's Y-up. Everything
here is in metres, because the facade detail (a 1.5 m window, a 4 m storey)
only looks right when it is modelled at real size. The site rescales each
module uniformly to its lot, so absolute size never reaches the runtime.
"""
import math

import bmesh
import bpy
from mathutils import Vector

Z = Vector((0.0, 0.0, 1.0))


class Frame:
    """A wall-local frame: `u` runs along the wall, `n` points out of it.

    `u x up == n`, which is the outward normal for a counter-clockwise
    footprint, so a wall described left-to-right as seen from outside always
    faces out. Wall `w` is depth (positive = toward the viewer), `v` is height
    above the ground.
    """

    def __init__(self, origin, u):
        self.o = Vector((origin[0], origin[1], 0.0))
        self.u = Vector((u[0], u[1], 0.0)).normalized()
        self.n = self.u.cross(Z)

    def p(self, u, w, v):
        return self.o + self.u * u + self.n * w + Z * v


def _newell(pts):
    n = Vector()
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


class Builder:
    """Accumulates faces with a material name per face.

    Every face gets its own vertices on purpose: the geometry is a soup of
    boxes and quads, and shared vertices would only matter for smoothing,
    which neither the bake source nor the flat-shaded buildings want.
    """

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.meta = []

    def slot(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def face(self, pts, mat, expect=None, smooth=False, meta=None):
        """Add a polygon, flipping its winding to agree with `expect`."""
        pts = [Vector(p) for p in pts]
        if expect is not None and _newell(pts).dot(expect) < 0:
            pts.reverse()
        f = self.bm.faces.new([self.bm.verts.new(p) for p in pts])
        f.material_index = self.slot(mat)
        f.smooth = smooth
        self.meta.append(meta)
        return f

    # -- wall-frame primitives -------------------------------------------------

    def fquad(self, fr, u0, u1, v0, v1, w, mat, meta=None):
        self.face(
            [fr.p(u0, w, v0), fr.p(u1, w, v0), fr.p(u1, w, v1), fr.p(u0, w, v1)],
            mat, expect=fr.n, meta=meta,
        )

    def fbox(self, fr, u0, u1, w0, w1, v0, v1, mat, skip=()):
        """Box in a wall frame. `skip` drops hidden faces: '-w', '+u', '-v' ..."""
        c = lambda iu, iw, iv: fr.p((u0, u1)[iu], (w0, w1)[iw], (v0, v1)[iv])
        faces = {
            '-w': ([c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)], -fr.n),
            '+w': ([c(0, 1, 0), c(1, 1, 0), c(1, 1, 1), c(0, 1, 1)], fr.n),
            '-u': ([c(0, 0, 0), c(0, 1, 0), c(0, 1, 1), c(0, 0, 1)], -fr.u),
            '+u': ([c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)], fr.u),
            '-v': ([c(0, 0, 0), c(1, 0, 0), c(1, 1, 0), c(0, 1, 0)], -Z),
            '+v': ([c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)], Z),
        }
        for name, (pts, expect) in faces.items():
            if name not in skip:
                self.face(pts, mat, expect=expect)

    # -- free-standing primitives ----------------------------------------------

    def box(self, cx, cy, w, d, z0, z1, mat, yaw=0.0, skip=('-v',)):
        fr = Frame((cx, cy), (math.cos(yaw), math.sin(yaw)))
        # a frame box is anchored at its u/w origin, so centre it on (cx, cy)
        fr.o = fr.o - fr.u * (w / 2) - fr.n * (d / 2)
        self.fbox(fr, 0, w, 0, d, z0, z1, mat, skip=skip)

    def cylinder(self, cx, cy, r, z0, z1, segs, mat, r_top=None, cap=True, smooth=True):
        r_top = r if r_top is None else r_top
        ring = lambda rad, z: [
            Vector((cx + rad * math.cos(2 * math.pi * i / segs),
                    cy + rad * math.sin(2 * math.pi * i / segs), z))
            for i in range(segs)
        ]
        lo, hi = ring(r, z0), ring(r_top, z1)
        for i in range(segs):
            j = (i + 1) % segs
            a = 2 * math.pi * (i + 0.5) / segs
            quad = [lo[i], lo[j], hi[j], hi[i]]
            if r_top <= 1e-6:
                quad = [lo[i], lo[j], hi[0]]
            self.face(quad, mat, expect=Vector((math.cos(a), math.sin(a), 0.2)), smooth=smooth)
        if cap and r_top > 1e-6:
            self.face(hi, mat, expect=Z)

    def sphere(self, cx, cy, cz, rx, ry, rz, mat, subdiv=2):
        """Ellipsoid from an icosphere (subdiv 1 = 20 faces, 2 = 80)."""
        tmp = bmesh.new()
        bmesh.ops.create_icosphere(tmp, subdivisions=subdiv, radius=1.0)
        for f in tmp.faces:
            pts = [Vector((cx + v.co.x * rx, cy + v.co.y * ry, cz + v.co.z * rz)) for v in f.verts]
            mid = Vector((f.normal.x / max(rx, 1e-6), f.normal.y / max(ry, 1e-6),
                          f.normal.z / max(rz, 1e-6)))
            self.face(pts, mat, expect=mid)
        tmp.free()

    def prism(self, poly, z0, z1, mat, skip=('-v',)):
        """Extrude a counter-clockwise polygon [(x, y)...] into a closed prism."""
        n = len(poly)
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            fr = Frame(a, (b[0] - a[0], b[1] - a[1]))
            self.fquad(fr, 0, math.hypot(b[0] - a[0], b[1] - a[1]), z0, z1, 0.0, mat)
        if '+v' not in skip:
            self.face([(x, y, z1) for x, y in poly], mat, expect=Z)
        if '-v' not in skip:
            self.face([(x, y, z0) for x, y in poly], mat, expect=-Z)

    # -- output ----------------------------------------------------------------

    def to_object(self, name=None):
        mesh = bpy.data.meshes.new(name or self.name)
        self.bm.to_mesh(mesh)
        for mat in self.mats:
            mesh.materials.append(bpy.data.materials.get(mat) or bpy.data.materials.new(mat))
        obj = bpy.data.objects.new(name or self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def rect_poly(cx, cy, w, d, chamfer=0.0):
    """Counter-clockwise footprint starting on the bottom edge, plus edge keys.

    Opposite edges share a key ('A' runs along x, 'B' along y, 'C' is a
    chamfer) so they can share texture space: a tower reads the same from
    either side, which doubles the pixels each facade gets.
    """
    hw, hd, c = w / 2, d / 2, chamfer
    if c <= 0:
        pts = [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)]
        keys = ['A', 'B', 'A', 'B']
    else:
        pts = [(-hw + c, -hd), (hw - c, -hd), (hw, -hd + c), (hw, hd - c),
               (hw - c, hd), (-hw + c, hd), (-hw, hd - c), (-hw, -hd + c)]
        keys = ['A', 'C', 'B', 'C', 'A', 'C', 'B', 'C']
    return [(cx + x, cy + y) for x, y in pts], keys
