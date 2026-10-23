import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HOME_CELL, HOME_CELLS } from '../bake/cityGen.mjs';
import { mulberry32 } from '../util';
import type { TownSite } from './Rooftops';

type Part = [BufferGeometry, string];

/** Merges coloured parts into one geometry with a `color` attribute: one draw call per kind. */
function prop(parts: Part[]): BufferGeometry {
  const geoms = parts.map(([g, hex]) => {
    const geo = g.index ? g.toNonIndexed() : g;
    const c = new Color(hex);
    const n = geo.attributes.position!.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geo.deleteAttribute('uv');
    return geo;
  });
  const merged = mergeGeometries(geoms, false)!;
  geoms.forEach((g) => g.dispose());
  return merged;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry =>
  new BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, seg = 10): BufferGeometry =>
  new CylinderGeometry(r0, r1, h, seg).translate(x, y, z);

/**
 * Prop geometry at site scale (0.33 units a metre, a person ~0.58 tall), each facing +x: what a
 * sign shows faces +x, a bin's lid opens toward -x.
 */
function kinds(detail: boolean): Record<string, BufferGeometry> {
  const seg = detail ? 12 : 8;
  const octagon = (r: number, t: number, x: number, y: number): BufferGeometry =>
    new CylinderGeometry(r, r, t, 8).rotateY(Math.PI / 8).rotateZ(Math.PI / 2).translate(x, y, 0);
  return {
    // a fire hydrant: barrel, bonnet, two hose outlets and the big pumper nozzle
    hydrant: prop([
      [cyl(0.05, 0.055, 0.03, 0, 0.015, 0, seg), '#6d6f73'],
      [cyl(0.04, 0.042, 0.17, 0, 0.115, 0, seg), '#b3261e'],
      [cyl(0.046, 0.046, 0.018, 0, 0.2, 0, seg), '#b3261e'],
      [cyl(0.035, 0.012, 0.05, 0, 0.234, 0, seg), '#b3261e'],
      [cyl(0.008, 0.008, 0.02, 0, 0.264, 0, 6), '#d8d4c8'],
      [cyl(0.016, 0.016, 0.05, 0, 0.15, 0, 8).rotateX(Math.PI / 2).translate(0, 0, 0), '#9c2019'],
      [cyl(0.022, 0.022, 0.035, 0, 0.12, 0, 8).rotateZ(Math.PI / 2).translate(0.045, 0, 0), '#9c2019'],
      [cyl(0.026, 0.026, 0.008, 0, 0.12, 0, 8).rotateZ(Math.PI / 2).translate(0.065, 0, 0), '#d8d4c8'],
    ]),
    // a stop sign with the street-name blades on top of its post
    stop: prop([
      [cyl(0.012, 0.012, 0.78, 0, 0.39, 0, 6), '#8e939b'],
      [octagon(0.13, 0.008, 0.012, 0.66), '#f4f1ea'],
      [octagon(0.118, 0.01, 0.016, 0.66), '#b8211c'],
      [box(0.004, 0.022, 0.12, 0.022, 0.66, 0), '#f4f1ea'],
      [box(0.24, 0.045, 0.006, 0, 0.82, 0), '#1f6b3e'],
      [box(0.006, 0.045, 0.24, 0, 0.875, 0), '#1f6b3e'],
      [box(0.2, 0.01, 0.007, 0, 0.82, 0), '#e9eee8'],
      [box(0.007, 0.01, 0.2, 0, 0.875, 0), '#e9eee8'],
    ]),
    // wheelie bins out for collection: a body, its lid and hinge, two wheels
    bin: prop([
      [box(0.2, 0.3, 0.19, 0, 0.17, 0), '#ffffff'],
      [box(0.22, 0.02, 0.21, 0.004, 0.33, 0), '#ffffff'],
      [box(0.03, 0.03, 0.2, -0.105, 0.31, 0), '#25272b'],
      [cyl(0.035, 0.035, 0.02, 0, 0.035, 0, 8).rotateX(Math.PI / 2).translate(-0.09, 0, 0.085), '#1a1b1e'],
      [cyl(0.035, 0.035, 0.02, 0, 0.035, 0, 8).rotateX(Math.PI / 2).translate(-0.09, 0, -0.085), '#1a1b1e'],
    ]),
    // a bus shelter: posts, roof, glass back and ends, a bench, the timetable and route sign
    shelter: prop([
      [box(0.42, 0.02, 1.25, 0, 0.83, 0), '#3c4350'],
      [box(0.02, 0.8, 0.02, -0.19, 0.4, -0.6), '#3c4350'],
      [box(0.02, 0.8, 0.02, -0.19, 0.4, 0.6), '#3c4350'],
      [box(0.02, 0.8, 0.02, 0.19, 0.4, -0.6), '#3c4350'],
      [box(0.02, 0.8, 0.02, 0.19, 0.4, 0.6), '#3c4350'],
      [box(0.008, 0.62, 1.18, -0.19, 0.45, 0), '#7d9cb3'],
      [box(0.36, 0.62, 0.008, 0, 0.45, -0.6), '#7d9cb3'],
      [box(0.13, 0.02, 0.9, -0.1, 0.16, 0), '#7a5a3a'],
      [box(0.02, 0.15, 0.9, -0.16, 0.25, 0), '#7a5a3a'],
      [box(0.012, 0.3, 0.2, -0.18, 0.5, 0.42), '#f2e3b6'],
      [cyl(0.01, 0.01, 0.95, 0.22, 0.475, -0.72, 6), '#8e939b'],
      [box(0.006, 0.12, 0.2, 0.226, 0.86, -0.72), '#1d5aa6'],
    ]),
    // a park bench: slatted seat and back on cast-iron ends
    bench: prop([
      [box(0.13, 0.012, 0.48, 0, 0.14, 0), '#7a5a3a'],
      [box(0.012, 0.1, 0.48, -0.06, 0.22, 0), '#7a5a3a'],
      [box(0.13, 0.14, 0.015, 0, 0.07, -0.22), '#24262b'],
      [box(0.13, 0.14, 0.015, 0, 0.07, 0.22), '#24262b'],
      [box(0.02, 0.12, 0.015, -0.065, 0.2, -0.22), '#24262b'],
      [box(0.02, 0.12, 0.015, -0.065, 0.2, 0.22), '#24262b'],
    ]),
    // a kid's bike dropped on the verge, and the newspaper box by the bus stop
    bike: prop([
      [cyl(0.075, 0.075, 0.012, 0, 0.075, 0, 12).rotateX(Math.PI / 2).translate(0.15, 0, 0), '#1c1d20'],
      [cyl(0.075, 0.075, 0.012, 0, 0.075, 0, 12).rotateX(Math.PI / 2).translate(-0.15, 0, 0), '#1c1d20'],
      [box(0.3, 0.014, 0.014, 0, 0.13, 0).rotateZ(0.25), '#ffffff'],
      [box(0.012, 0.13, 0.012, -0.08, 0.13, 0), '#ffffff'],
      [box(0.06, 0.012, 0.03, -0.08, 0.2, 0), '#2a2a2c'],
      [box(0.012, 0.012, 0.12, 0.14, 0.21, 0), '#2a2a2c'],
    ]),
    news: prop([
      [box(0.13, 0.2, 0.13, 0, 0.16, 0), '#2f63b8'],
      [box(0.006, 0.08, 0.1, 0.067, 0.2, 0), '#d9e2ea'],
      [box(0.02, 0.06, 0.02, 0, 0.03, 0), '#3a3c40'],
    ]),
  };
}

const BINS = ['#3d6b3f', '#2f5aa0', '#5d6068', '#3d6b3f', '#7a4b2a'];
const HYDRANT_TINTS = ['#ffffff', '#ffffff', '#ffe08a'];

/**
 * The town's street furniture: hydrants on the verges, stop signs with street-name blades at the
 * corners, wheelie bins out on the curb for collection day, bus shelters with a bench and a
 * newspaper box, a dropped bike now and then. Seeded and placed only near the flight path (the
 * same reach as the yards), one instanced draw per kind.
 */
export class StreetFurniture {
  readonly group = new Group();
  private disposables: { dispose(): void }[] = [];

  constructor(houses: TownSite[], near: (x: number, z: number) => boolean, tier: 'high' | 'low') {
    const rand = mulberry32(31337);
    const place: Record<string, { x: number; z: number; yaw: number; tint?: string }[]> = {
      hydrant: [], stop: [], bin: [], shelter: [], bench: [], bike: [], news: [],
    };
    const { w, d, lotD, street, lotW, lots } = HOME_CELL;
    const cross0 = lots * lotW;
    // verge centre lines either side of the street (cell-local z)
    const vergeN = lotD + 0.35;
    const vergeS = lotD + street - 0.35;
    for (let iz = HOME_CELLS.z[0]; iz < HOME_CELLS.z[1]; iz++) {
      for (let ix = HOME_CELLS.x[0]; ix < HOME_CELLS.x[1]; ix++) {
        const ox = ix * w;
        const oz = iz * d;
        if (!near(ox + w / 2, oz + lotD + street / 2)) continue;
        // stop signs at the four corners of the crossing, each facing the traffic coming at it
        for (const [cx, face] of [[cross0 + 0.35, Math.PI], [w - 0.35, 0]] as const) {
          for (const vz of [vergeN, vergeS]) {
            if (near(ox + cx, oz + vz)) place.stop!.push({ x: ox + cx, z: oz + vz, yaw: face });
          }
        }
        // a hydrant on each verge, somewhere between the lamps
        for (const vz of [vergeN, vergeS]) {
          const x = ox + 6 + rand() * 18;
          if (rand() < 0.8) place.hydrant!.push({ x, z: oz + vz, yaw: rand() * 6.28, tint: HYDRANT_TINTS[Math.floor(rand() * 3)]! });
        }
        // now and then a bus stop: shelter facing the road, a bench beside it, a newspaper box
        if (rand() < 0.35) {
          const south = rand() < 0.5;
          const x = ox + 9 + rand() * 6;
          const z = oz + (south ? vergeS + 0.12 : vergeN - 0.12);
          const yaw = south ? Math.PI / 2 : -Math.PI / 2;
          place.shelter!.push({ x, z, yaw });
          place.bench!.push({ x: x + 0.9, z, yaw });
          place.news!.push({ x: x - 0.85, z, yaw });
        }
      }
    }
    // collection day: bins at the curb in front of a good share of the houses
    for (const h of houses) {
      const toStreet = Math.cos(h.yaw) > 0 ? 1 : -1;
      const front = h.z + toStreet * (h.d / 2);
      // the lot's street edge, then the verge just past it
      const cellZ = ((front % d) + d) % d;
      const curb = front - cellZ + (toStreet > 0 ? vergeN : vergeS);
      if (!near(h.x, curb)) continue;
      if (rand() < 0.45) {
        const x = h.x + (rand() < 0.5 ? -1 : 1) * (1.2 + rand() * 1.2);
        const yaw = toStreet > 0 ? -Math.PI / 2 : Math.PI / 2;
        place.bin!.push({ x, z: curb, yaw: yaw + (rand() - 0.5) * 0.3, tint: BINS[Math.floor(rand() * BINS.length)]! });
        if (rand() < 0.6) {
          place.bin!.push({ x: x + 0.26, z: curb + (rand() - 0.5) * 0.04, yaw: yaw + (rand() - 0.5) * 0.3, tint: '#2f5aa0' });
        }
      }
      if (rand() < 0.06) {
        // a kid's bike dropped on the lawn by the walk, lying on its side
        place.bike!.push({ x: h.x + (rand() - 0.5) * 2, z: front + toStreet * (0.5 + rand() * 0.6), yaw: rand() * 6.28 });
      }
    }

    const geometry = kinds(tier === 'high');
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 });
    this.disposables.push(material);
    const m4 = new Matrix4();
    const q = new Quaternion();
    const qTip = new Quaternion();
    const Y = new Vector3(0, 1, 0);
    const X = new Vector3(1, 0, 0);
    const p = new Vector3();
    const one = new Vector3(1, 1, 1);
    const color = new Color();
    for (const [kind, list] of Object.entries(place)) {
      const g = geometry[kind]!;
      this.disposables.push(g);
      if (!list.length) continue;
      const mesh = new InstancedMesh(g, material, list.length);
      list.forEach((it, i) => {
        q.setFromAxisAngle(Y, it.yaw);
        // a dropped bike lies on its side
        if (kind === 'bike') q.multiply(qTip.setFromAxisAngle(X, Math.PI / 2 - 0.12));
        mesh.setMatrixAt(i, m4.compose(p.set(it.x, kind === 'bike' ? 0.012 : 0, it.z), q, one));
        mesh.setColorAt(i, color.set(it.tint ?? '#ffffff'));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = tier === 'high';
      mesh.receiveShadow = tier === 'high';
      this.group.add(mesh);
      this.disposables.push(mesh);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
