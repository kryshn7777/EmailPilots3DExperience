"""Mesh primitives for the office props: plain vertex/face lists that the prop builders transform
and drop into a `Part` list, so one description can be built twice (high-poly bake source and
lean shipped mesh) just by changing segment counts and which details exist.

Blender axes: X right, -Y the front (the user's side, glTF +Z), Z up, metres.
"""
import math

import bpy  # noqa: F401  (bmesh needs bpy loaded first)
import bmesh
import numpy as np
from mathutils import Matrix, Vector


class Geo:
    """Vertices (N, 3) float array, faces as index tuples, optional per-face-corner UVs."""

    def __init__(self, verts, faces, uvs=None):
        self.v = np.asarray(verts, dtype=np.float64).reshape(-1, 3)
        self.f = [tuple(f) for f in faces]
        self.uv = uvs  # None or list (per face) of tuples of (u, v)

    # -- transforms (all return self) ------------------------------------------------------
    def move(self, x=0.0, y=0.0, z=0.0):
        self.v += (x, y, z)
        return self

    def scale(self, sx, sy=None, sz=None, o=(0, 0, 0)):
        sy = sx if sy is None else sy
        sz = sx if sz is None else sz
        o = np.asarray(o, dtype=np.float64)
        self.v = (self.v - o) * (sx, sy, sz) + o
        if (sx * sy * sz) < 0:
            self.f = [tuple(reversed(f)) for f in self.f]
            if self.uv:
                self.uv = [tuple(reversed(u)) for u in self.uv]
        return self

    def rot(self, axis, deg, o=(0, 0, 0)):
        m = np.array(Matrix.Rotation(math.radians(deg), 3, axis))
        o = np.asarray(o, dtype=np.float64)
        self.v = (self.v - o) @ m.T + o
        return self

    def mat(self, m3, o=(0, 0, 0)):
        m = np.array(m3)
        o = np.asarray(o, dtype=np.float64)
        self.v = (self.v - o) @ m.T + o
        return self

    def warp(self, fn):
        """fn(v (N,3)) -> (N,3)"""
        self.v = np.asarray(fn(self.v.copy()), dtype=np.float64)
        return self

    def copy(self):
        return Geo(self.v.copy(), list(self.f), list(self.uv) if self.uv else None)

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    @property
    def bounds(self):
        return self.v.min(0), self.v.max(0)


def join(geos):
    vs, fs, uvs, off, any_uv = [], [], [], 0, any(g.uv for g in geos)
    for g in geos:
        vs.append(g.v)
        fs.extend(tuple(i + off for i in f) for f in g.f)
        if any_uv:
            uvs.extend(g.uv if g.uv else [tuple((0.0, 0.0) for _ in f) for f in g.f])
        off += len(g.v)
    return Geo(np.concatenate(vs) if vs else np.zeros((0, 3)), fs, uvs if any_uv else None)


def _from_bm(bm, uv_layer=None):
    bm.verts.index_update()
    verts = [v.co[:] for v in bm.verts]
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    uvs = None
    if uv_layer is not None:
        uvs = [tuple(tuple(l[uv_layer].uv) for l in f.loops) for f in bm.faces]
    bm.free()
    return Geo(verts, faces, uvs)


# -- primitives ------------------------------------------------------------------------------

def box(sx, sy, sz, c=(0, 0, 0), bev=0.0, segs=3, top_only=False):
    """An axis-aligned box of size (sx, sy, sz) centred at c; `bev` rounds every edge."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    if bev > 0 and segs > 0:
        bev = min(bev, 0.49 * min(sx, sy, sz))
        edges = list(bm.edges)
        if top_only:
            edges = [e for e in edges if all(v.co.z > 0 for v in e.verts)]
        bmesh.ops.bevel(bm, geom=edges, offset=bev, segments=segs, affect='EDGES', profile=0.5,
                        clamp_overlap=True)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    return _from_bm(bm)


def rbox(sx, sy, sz, c=(0, 0, 0), r=0.01, segs=4, bev=0.0, bsegs=2, open_bottom=False):
    """A box rounded (radius r) round its vertical edges only, optionally bevelled top/bottom."""
    prof = rrect(sx, sy, r, segs)
    return prism(prof, sz, c=(c[0], c[1], c[2] - sz / 2), bev=bev, bsegs=bsegs, open_bottom=open_bottom)


def rrect(w, d, r, segs=4):
    """Rounded-rectangle outline (CCW, XY)."""
    r = min(r, 0.499 * min(w, d))
    pts = []
    if segs <= 0 or r <= 0:
        return [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
    for cx, cy, a0 in ((w / 2 - r, -d / 2 + r, -90), (w / 2 - r, d / 2 - r, 0), (-w / 2 + r, d / 2 - r, 90),
                       (-w / 2 + r, -d / 2 + r, 180)):
        for i in range(segs + 1):
            a = math.radians(a0 + 90 * i / segs)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def prism(poly, h, c=(0, 0, 0), bev=0.0, bsegs=2, open_bottom=False, cap=True):
    """Extrude a 2D outline (XY, CCW) up by h from z = c[2]; `bev` rounds the top and bottom rims."""
    bm = bmesh.new()
    vs = [bm.verts.new((x + c[0], y + c[1], c[2])) for x, y in poly]
    f = bm.faces.new(vs)
    bmesh.ops.reverse_faces(bm, faces=[f])  # bottom faces down
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    top = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((0, 0, h)), verts=top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if open_bottom:
        bot = [fa for fa in bm.faces if fa.normal.z < -0.99 and all(abs(v.co.z - c[2]) < 1e-9 for v in fa.verts)]
        bmesh.ops.delete(bm, geom=bot, context='FACES_ONLY')
    if bev > 0 and bsegs > 0:
        rim = [e for e in bm.edges if len(e.link_faces) == 2 and
               abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.5]
        bmesh.ops.bevel(bm, geom=rim, offset=min(bev, h * 0.45), segments=bsegs, affect='EDGES', profile=0.5,
                        clamp_overlap=True)
    return _from_bm(bm)


def slab(poly, h, axis='Y', at=0.0, bev=0.0, bsegs=2):
    """Extrude an outline drawn in the plane perpendicular to `axis` by h (centred on `at`).

    axis 'Y': outline (x, z), thickness along y. axis 'X': outline (y, z). axis 'Z': outline (x, y)."""
    g = prism(poly, h, c=(0, 0, -h / 2), bev=bev, bsegs=bsegs)
    if axis == 'Y':
        g.rot('X', 90)          # (x, y, z) -> (x, -z, y): outline y becomes z
        g.move(y=at)
    elif axis == 'X':
        g.rot('X', 90).rot('Z', 90)  # outline (y, z), thickness along x
        g.move(x=at)
    else:
        g.move(z=at)
    return g


def cyl(r, h, segs=24, c=(0, 0, 0), axis='Z', r2=None, bev=0.0, bsegs=2, caps=True):
    """Cylinder (or cone frustum with r2) of length h centred at c along `axis`."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r,
                          radius2=r if r2 is None else r2, depth=h)
    if bev > 0 and bsegs > 0 and caps:
        rim = [e for e in bm.edges if len(e.link_faces) == 2 and
               abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.5]
        bmesh.ops.bevel(bm, geom=rim, offset=min(bev, h * 0.45, r * 0.45), segments=bsegs, affect='EDGES',
                        profile=0.5, clamp_overlap=True)
    g = _from_bm(bm)
    if axis == 'X':
        g.rot('Y', 90)
    elif axis == 'Y':
        g.rot('X', 90)
    return g.move(*c)


def lathe(profile, segs=32, c=(0, 0, 0), cap_bottom=False, cap_top=False, arc=360.0):
    """Revolve [(r, z), ...] (bottom to top) around Z. r = 0 points collapse to the axis."""
    full = abs(arc - 360) < 1e-6
    n = segs if full else segs + 1
    verts, faces = [], []
    rings = []
    for r, z in profile:
        if r <= 1e-9:
            rings.append([len(verts)])
            verts.append((0, 0, z))
            continue
        ring = []
        for i in range(n):
            a = math.radians(arc) * i / segs
            ring.append(len(verts))
            verts.append((r * math.cos(a), r * math.sin(a), z))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % n
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                faces.append((a[0], b[i], b[j]) if True else ())
            elif len(b) == 1:
                faces.append((a[i], a[j], b[0]))
            else:
                faces.append((a[i], a[j], b[j], b[i]))
    if cap_bottom and len(rings[0]) > 1:
        faces.append(tuple(reversed(rings[0][:segs])))
    if cap_top and len(rings[-1]) > 1:
        faces.append(tuple(rings[-1][:segs]))
    return Geo(verts, faces).move(*c)


def _frames(pts):
    """Parallel-transport frames along a polyline."""
    pts = [Vector(p) for p in pts]
    tangents = []
    for i in range(len(pts)):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, len(pts) - 1)]
        t = (b - a)
        tangents.append(t.normalized() if t.length > 1e-12 else Vector((0, 0, 1)))
    up = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
    n = tangents[0].cross(up).normalized()
    frames = []
    for i, t in enumerate(tangents):
        if i:
            n = n - t * n.dot(t)
            if n.length < 1e-9:
                n = t.orthogonal()
            n.normalize()
        b = t.cross(n).normalized()
        frames.append((pts[i], t, n, b))
    return frames


def smooth_path(ctrl, n):
    """Catmull-Rom through control points, n samples in all."""
    c = [Vector(p) for p in ctrl]
    if len(c) == 2:
        return [c[0].lerp(c[1], i / (n - 1)) for i in range(n)]
    c = [c[0] * 2 - c[1]] + c + [c[-1] * 2 - c[-2]]
    # sample by approximate arc length per span
    spans = len(c) - 3
    lens = [(c[i + 2] - c[i + 1]).length for i in range(spans)]
    total = sum(lens) or 1.0
    out = []
    for s in range(spans):
        k = max(2, round(n * lens[s] / total))
        p0, p1, p2, p3 = c[s], c[s + 1], c[s + 2], c[s + 3]
        for i in range(k):
            t = i / k
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(c[-2])
    return out


def tube(pts, r, segs=8, caps=True, radii=None, twist=0.0):
    """A tube along a polyline (use smooth_path for curves)."""
    fr = _frames(pts)
    verts, faces = [], []
    for k, (p, t, n, b) in enumerate(fr):
        rr = radii[k] if radii else r
        for i in range(segs):
            a = 2 * math.pi * i / segs + twist * k
            verts.append(tuple(p + (n * math.cos(a) + b * math.sin(a)) * rr))
    m = len(fr)
    for k in range(m - 1):
        for i in range(segs):
            j = (i + 1) % segs
            faces.append((k * segs + i, k * segs + j, (k + 1) * segs + j, (k + 1) * segs + i))
    if caps:
        faces.append(tuple(reversed(range(segs))))
        faces.append(tuple((m - 1) * segs + i for i in range(segs)))
    g = Geo(verts, faces)
    # make sure the tube's faces point outward (frames can be left-handed)
    p, t, n, b = fr[0]
    if n.cross(b).dot(t) < 0:
        g.f = [tuple(reversed(f)) for f in g.f]
    return g


def sweep(pts, profile, caps=True, scales=None):
    """Sweep a 2D cross-section [(x, y)] (CCW) along a polyline."""
    fr = _frames(pts)
    verts, faces = [], []
    s = len(profile)
    for k, (p, t, n, b) in enumerate(fr):
        sc = scales[k] if scales else 1.0
        for x, y in profile:
            verts.append(tuple(p + (n * x + b * y) * sc))
    m = len(fr)
    for k in range(m - 1):
        for i in range(s):
            j = (i + 1) % s
            faces.append((k * s + i, k * s + j, (k + 1) * s + j, (k + 1) * s + i))
    if caps:
        faces.append(tuple(reversed(range(s))))
        faces.append(tuple((m - 1) * s + i for i in range(s)))
    g = Geo(verts, faces)
    p, t, n, b = fr[0]
    if n.cross(b).dot(t) < 0:
        g.f = [tuple(reversed(f)) for f in g.f]
    return g


def torus(R, r, segs=24, rsegs=8, c=(0, 0, 0), arc=360.0, axis='Z'):
    full = abs(arc - 360) < 1e-6
    n = segs if full else segs + 1
    pts = [(R * math.cos(math.radians(arc) * i / segs), R * math.sin(math.radians(arc) * i / segs), 0) for i in range(n)]
    if full:
        verts, faces = [], []
        fr = _frames(pts + [pts[0]])
        for p, t, nn, b in fr[:-1]:
            for i in range(rsegs):
                a = 2 * math.pi * i / rsegs
                verts.append(tuple(p + (nn * math.cos(a) + b * math.sin(a)) * r))
        for k in range(n):
            k2 = (k + 1) % n
            for i in range(rsegs):
                j = (i + 1) % rsegs
                faces.append((k * rsegs + i, k * rsegs + j, k2 * rsegs + j, k2 * rsegs + i))
        g = Geo(verts, faces)
        p, t, nn, b = fr[0]
        if nn.cross(b).dot(t) < 0:
            g.f = [tuple(reversed(f)) for f in g.f]
    else:
        g = tube(pts, r, rsegs, caps=True)
    if axis == 'X':
        g.rot('Y', 90)
    elif axis == 'Y':
        g.rot('X', 90)
    return g.move(*c)


def sphere(r, segs=24, rings=12, c=(0, 0, 0), scale=(1, 1, 1)):
    prof = [(r * math.sin(math.pi * i / rings), -r * math.cos(math.pi * i / rings)) for i in range(rings + 1)]
    prof[0] = (0.0, -r)
    prof[-1] = (0.0, r)
    return lathe(prof, segs).scale(*scale).move(*c)


def quad(p0, p1, p2, p3, uv=((0, 0), (1, 0), (1, 1), (0, 1))):
    return Geo([p0, p1, p2, p3], [(0, 1, 2, 3)], [tuple(uv)])


def grid(w, h, nx, ny, plane='XZ', uv=True):
    """A subdivided rectangle centred at the origin (XZ plane faces -Y)."""
    verts, faces, uvs = [], [], []
    for j in range(ny + 1):
        for i in range(nx + 1):
            u, v = i / nx, j / ny
            a, b = (u - 0.5) * w, (v - 0.5) * h
            verts.append((a, 0, b) if plane == 'XZ' else (a, b, 0))
    for j in range(ny):
        for i in range(nx):
            k = j * (nx + 1) + i
            faces.append((k, k + 1, k + nx + 2, k + nx + 1))
            uvs.append(((i / nx, j / ny), ((i + 1) / nx, j / ny), ((i + 1) / nx, (j + 1) / ny), (i / nx, (j + 1) / ny)))
    return Geo(verts, faces, uvs if uv else None)


def bend_x(g, radius, axis_y=0.0):
    """Wrap X round a vertical cylinder of `radius` whose axis lies in front (at y = axis_y - radius),
    so a flat panel (XZ) curves forward at its sides: a back rest that hugs the sitter."""
    def f(v):
        a = v[:, 0] / radius
        dist = radius + (v[:, 1] - axis_y)
        out = v.copy()
        out[:, 0] = np.sin(a) * dist
        out[:, 1] = axis_y - radius + np.cos(a) * dist
        return out
    return g.warp(f)
