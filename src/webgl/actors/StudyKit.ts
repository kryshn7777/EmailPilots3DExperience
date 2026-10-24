import {
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Material,
  Matrix4,
  Mesh,
  Quaternion,
  Shape,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Small modelling kit for the study: author furniture and props as loose
 * geometry with a placement each, and ship one merged draw per material.
 * Geometry is normalised on the way in (non-indexed, position + normal + uv
 * only) so a Lathe, a Box, a Tube and an Extrusion can share a bucket.
 */

export interface Place {
  x?: number; y?: number; z?: number;
  rx?: number; ry?: number; rz?: number;
  /** uniform, or per axis */
  s?: number | [number, number, number];
}

const M = new Matrix4();
const Q = new Quaternion();
const E = new Euler();
const P = new Vector3();
const S = new Vector3();

export function placement(p: Place, out = new Matrix4()): Matrix4 {
  E.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0, 'YXZ');
  Q.setFromEuler(E);
  const s = p.s ?? 1;
  if (typeof s === 'number') S.set(s, s, s);
  else S.set(s[0], s[1], s[2]);
  return out.compose(P.set(p.x ?? 0, p.y ?? 0, p.z ?? 0), Q, S);
}

function normalise(g: BufferGeometry): BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  for (const name of Object.keys(flat.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') flat.deleteAttribute(name);
  }
  return flat;
}

export class Kit {
  private buckets = new Map<Material, BufferGeometry[]>();
  triangles = 0;

  /** bake `g` through `p` into the bucket for `m` */
  add(g: BufferGeometry, m: Material, p: Place = {}): void {
    const flat = normalise(g);
    flat.applyMatrix4(placement(p, M));
    this.triangles += flat.attributes.position!.count / 3;
    const bucket = this.buckets.get(m);
    if (bucket) bucket.push(flat);
    else this.buckets.set(m, [flat]);
  }

  /** one mesh per material, added to `parent`; the merged geometry goes to `owned` for disposal */
  flush(parent: Group, owned: { dispose(): void }[]): Mesh[] {
    const meshes: Mesh[] = [];
    for (const [material, parts] of this.buckets) {
      const merged = parts.length === 1 ? parts[0]! : mergeGeometries(parts, false);
      if (parts.length > 1) parts.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new Mesh(merged, material);
      parent.add(mesh);
      owned.push(merged);
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}

/** profile is [radius, y] from the bottom up; a lathe around the y axis */
export function lathe(profile: [number, number][], seg: number): LatheGeometry {
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), seg);
}

/** a tube along a smooth path through `pts`, flattened along z by `flat` (1 = round) */
export function tube(pts: [number, number, number][], r: number, tubular: number, radial: number, flat = 1): TubeGeometry {
  const curve = new CatmullRomCurve3(pts.map((p) => new Vector3(...p)));
  const g = new TubeGeometry(curve, tubular, r, radial, false);
  if (flat !== 1) g.scale(1, 1, flat);
  return g;
}

/** a cylinder whose axis runs from a to b */
export function rod(a: Vector3, b: Vector3, r: number, seg = 8, rb = r): CylinderGeometry {
  const g = new CylinderGeometry(rb, r, a.distanceTo(b), seg);
  g.applyQuaternion(Q.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/**
 * A slab with chamfered edges: w x h x d centred on the origin, the bevel `c` on every edge.
 * UVs are in world units on the large faces (u along x, v along z), so scale them to taste.
 */
export function bevelBox(w: number, h: number, d: number, c: number): BufferGeometry {
  const sh = new Shape();
  const hw = w / 2 - c;
  const hd = d / 2 - c;
  sh.moveTo(-hw, -hd); sh.lineTo(hw, -hd); sh.lineTo(hw, hd); sh.lineTo(-hw, hd); sh.closePath();
  const g = new ExtrudeGeometry(sh, {
    depth: h - 2 * c, bevelEnabled: true, bevelSize: c, bevelThickness: c, bevelSegments: 1, steps: 1,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -(h - 2 * c) / 2, 0);
  return g;
}

/**
 * A moulding run: the 2D `profile` ([depth out of the wall, height]) extruded `len` along +z, with
 * the back of the profile on x = 0. Rotate and place it with a Place.
 */
export function moulding(profile: [number, number][], len: number): BufferGeometry {
  const sh = new Shape();
  profile.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  sh.closePath();
  return new ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, steps: 1 });
}

/** remaps a box's UVs so each face shows `rect` ([u0, v0, u1, v1]) of an atlas; faces are +x -x +y -y +z -z */
export function atlasBox(g: BufferGeometry, rects: Array<[number, number, number, number]>): BufferGeometry {
  const uv = g.attributes.uv!;
  for (let f = 0; f < 6; f++) {
    const r = rects[Math.min(f, rects.length - 1)]!;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
    }
  }
  return g;
}

/** scale the uv of any geometry */
export function uvScale<T extends BufferGeometry>(g: T, su: number, sv: number, ou = 0, ov = 0): T {
  const uv = g.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, ou + uv.getX(i) * su, ov + uv.getY(i) * sv);
  return g;
}
