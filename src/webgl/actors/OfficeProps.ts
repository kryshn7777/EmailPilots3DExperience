import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  Material,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The IT office's furniture: where every prop stands (metres, room-local: the window wall the dart comes in by is
 * z = 0, the window wall it leaves by is z = 10, the room runs x -7..7, 3 m high), primitive stand-ins for each
 * prop, and the batcher that merges everything sharing a material into one draw. The dart's line runs straight
 * across at x -0.7 (officeShot.ts OFFICE_LINE), right over the live laptop, so nothing tall stands on it.
 *
 * The real props are modelled in Blender and exported to `public/models/office/office-props.glb`
 * with `manifest.json` beside it: `{ file, nodes: [{ name, size: [w, h, d], emissive?: [...] }] }`,
 * one root node per prop, origin at the floor centre, Y up, metres. The Office actor drops a GLB prop
 * in wherever its name appears below and keeps the stand-in for any name the GLB does not have.
 */

/** the props this layout places, and the size each stand-in is built to (w, h, d metres) */
export const PROP_SIZES = {
  desk_pod: [3.2, 0.75, 1.6],
  monitor_24: [0.56, 0.5, 0.2],
  rack_42u: [0.6, 2.0, 1.0],
  cable_tray: [3.0, 0.1, 0.3],
  it_bench: [1.8, 1.6, 0.75],
  chair_office: [0.65, 1.05, 0.65],
  desk_lamp: [0.22, 0.5, 0.42],
  ceiling_light_panel: [1.2, 0.06, 0.6],
  filing_cabinet: [0.5, 1.3, 0.62],
  whiteboard: [1.8, 1.2, 0.05],
  printer: [0.6, 1.1, 0.65],
  plant_pot: [0.5, 1.3, 0.5],
  coffee_station: [1.6, 1.0, 0.65],
} as const satisfies Record<string, readonly [number, number, number]>;

export type PropName = keyof typeof PROP_SIZES;

export const ROOM = { x0: -7, x1: 7, z0: 0, z1: 10, h: 3.0 };

export interface Placement {
  name: PropName;
  x: number;
  z: number;
  /** height of the prop's origin: 0 on the floor; desk items sit on the desk top; ceiling items hang from it */
  y?: number | 'desk' | 'ceiling';
  /** yaw, radians: 0 faces -z (toward the window) */
  ry?: number;
}

/** a laptop on a desk: hinge at (x, z), display facing -z (ry 0) or +z (ry PI); `lid` 0 shut .. 1 open */
export interface LaptopPlacement { x: number; z: number; ry: number; lid: number; y?: 'desk' | number; on?: boolean }

const PI = Math.PI;
const POD_A = { x: -2.2, z: 3.6 };
const POD_B = { x: 2.4, z: 3.6 };
const POD_C = { x: 0.1, z: 6.8 };

/** seat `i` of a pod: 0, 1 on the window side (sitting with their backs to it), 2, 3 across the divider */
function seat(pod: { x: number; z: number }, i: number): { x: number; z: number; side: -1 | 1 } {
  const side = i < 2 ? -1 : 1;
  return { x: pod.x + (i % 2 === 0 ? -0.8 : 0.8), z: pod.z + side * 0.38, side };
}

function buildLayout(): { props: Placement[]; laptops: LaptopPlacement[] } {
  const props: Placement[] = [];
  const laptops: LaptopPlacement[] = [];
  for (const pod of [POD_A, POD_B, POD_C]) props.push({ name: 'desk_pod', x: pod.x, z: pod.z });
  // what is on each desk: m monitor, mm two, l open laptop (dark), c shut laptop. (Pod C's seat 0 is the live
  // laptop's, under the dart's line: only the laptop and its lamp on it.)
  const desks: [typeof POD_A, number, string][] = [
    [POD_A, 0, 'mm'], [POD_A, 1, 'c'], [POD_A, 2, 'mm'], [POD_A, 3, 'l'],
    [POD_B, 0, 'm'], [POD_B, 1, 'l'], [POD_B, 2, 'c'], [POD_B, 3, 'm'],
    [POD_C, 1, 'm'], [POD_C, 2, 'm l'], [POD_C, 3, 'mm'],
  ];
  for (const [pod, i, what] of desks) {
    const s = seat(pod, i);
    // a screen faces the person at the desk: the window side's people face +z, so their screens face -z
    const ry = s.side === -1 ? 0 : PI;
    const back = s.z + s.side * 0.2; // toward the divider
    const items = what.split(' ');
    for (const it of items) {
      if (it === 'm') props.push({ name: 'monitor_24', x: s.x + (items.length > 1 ? 0.22 : 0), z: back, y: 'desk', ry });
      if (it === 'mm') {
        props.push({ name: 'monitor_24', x: s.x - 0.3, z: back, y: 'desk', ry: ry + 0.18 * -s.side });
        props.push({ name: 'monitor_24', x: s.x + 0.3, z: back, y: 'desk', ry: ry - 0.18 * -s.side });
      }
      if (it === 'l' || it === 'c') {
        laptops.push({ x: s.x - (items.length > 1 ? 0.25 : 0), z: s.z + s.side * 0.12, ry, lid: it === 'l' ? 1 : 0, y: 'desk' });
      }
    }
  }
  // the one that is on: pod C, the window side's left desk, its screen toward the window the dart comes in by,
  // right under the dart's line (officeShot.ts OFFICE_LINE.x = HERO_SEAT.x)
  const hero = seat(POD_C, 0);
  laptops.unshift({ x: hero.x, z: hero.z + 0.1, ry: 0, lid: 1, y: 'desk', on: true });
  props.push({ name: 'desk_lamp', x: hero.x - 0.55, z: hero.z + 0.12, y: 'desk', ry: -0.5 });
  // chairs: every seat, turned and pushed about the way people leave them; the hero's is pushed aside
  for (const [pod, n] of [[POD_A, 0], [POD_B, 4], [POD_C, 8]] as const) {
    for (let i = 0; i < 4; i++) {
      const s = seat(pod, i);
      const k = n + i;
      const jitter = ((k * 37) % 11) / 11 - 0.5;
      const aside = pod === POD_C && i === 0 ? 0.55 : 0;
      props.push({
        name: 'chair_office',
        x: s.x + jitter * 0.3 + aside,
        z: s.z + s.side * (0.72 + ((k * 13) % 5) * 0.05),
        ry: (s.side === -1 ? PI : 0) + jitter * 0.9 + aside * 1.2,
      });
    }
  }
  // the server corner, on the right wall by the far windows: two racks, cable trays overhead to the desks
  props.push({ name: 'rack_42u', x: 6.45, z: 8.35, ry: PI / 2 }, { name: 'rack_42u', x: 6.45, z: 9.05, ry: PI / 2 });
  for (const [x, z, ry] of [[5.4, 7.4, PI / 2], [5.4, 4.4, PI / 2], [3.6, 7.9, 0]] as const) {
    props.push({ name: 'cable_tray', x, z, y: 'ceiling', ry });
  }
  // the IT bench along the right wall, a laptop open on it
  props.push({ name: 'it_bench', x: 6.55, z: 5.9, ry: PI / 2 });
  props.push({ name: 'chair_office', x: 5.6, z: 5.7, ry: -PI / 2 + 0.4 });
  laptops.push({ x: 6.62, z: 5.6, ry: PI / 2, lid: 0.85, y: 0.9 });
  // ceiling panels on a 3 x 3 grid
  for (const x of [-4.2, 0, 4.2]) for (const z of [2.2, 5.0, 7.8]) props.push({ name: 'ceiling_light_panel', x, z, y: 'ceiling' });
  // the left wall: filing, the whiteboard, the printer in the corner; under the far windows a coffee counter
  for (const z of [5.8, 6.45, 7.1]) props.push({ name: 'filing_cabinet', x: -6.64, z, ry: -PI / 2 });
  props.push({ name: 'printer', x: -5.9, z: 9.35 });
  props.push({ name: 'whiteboard', x: -6.95, z: 8.55, y: 0.95, ry: -PI / 2 });
  props.push({ name: 'coffee_station', x: 2.6, z: 9.55 });
  props.push(
    { name: 'plant_pot', x: -6.35, z: 0.75 }, { name: 'plant_pot', x: 6.35, z: 0.75 },
    { name: 'plant_pot', x: -2.3, z: 9.45 }, { name: 'plant_pot', x: 4.9, z: 9.5 },
  );
  return { props, laptops };
}

export const LAYOUT = buildLayout();

/** the prop's placement as a matrix (metres, room-local), given the desk top's height */
export function placementMatrix(p: Placement, deskTop: number, propH: number, out = new Matrix4()): Matrix4 {
  const y = p.y === 'desk' ? deskTop : p.y === 'ceiling' ? ROOM.h - propH - 0.02 : p.y ?? 0;
  return out.compose(new Vector3(p.x, y, p.z), new Quaternion().setFromEuler(new Euler(0, p.ry ?? 0, 0)), new Vector3(1, 1, 1));
}

/** the materials the stand-ins are made of (the Office actor supplies them) */
export type StandInMaterial =
  | 'laminate' | 'frame' | 'metal' | 'dark' | 'fabric' | 'screen' | 'led' | 'panel' | 'white' | 'plant' | 'pot' | 'paper' | 'glow';

export interface Part { mat: StandInMaterial; geom: BufferGeometry }

const tmpM = new Matrix4();

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number, mat: StandInMaterial, ry = 0, rx = 0): Part {
  const g = new BoxGeometry(w, h, d);
  tmpM.makeRotationFromEuler(new Euler(rx, ry, 0)).setPosition(x, y, z);
  g.applyMatrix4(tmpM);
  return { mat, geom: g };
}

function cylAt(r0: number, r1: number, h: number, x: number, y: number, z: number, mat: StandInMaterial, seg = 12, rx = 0, rz = 0): Part {
  const g = new CylinderGeometry(r0, r1, h, seg);
  tmpM.makeRotationFromEuler(new Euler(rx, 0, rz)).setPosition(x, y, z);
  g.applyMatrix4(tmpM);
  return { mat, geom: g };
}

/** an LED: a small coloured box (the batch's vertex colours give each its colour) */
function ledAt(x: number, y: number, z: number, rgb: [number, number, number], s = 0.012): Part {
  const g = new BoxGeometry(s, s, s * 0.6);
  g.translate(x, y, z);
  const n = g.attributes.position!.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(rgb, i * 3);
  g.setAttribute('color', new BufferAttribute(c, 3));
  return { mat: 'led', geom: g };
}

/**
 * Primitive stand-ins, prop-local metres (origin at the floor centre, Y up, front toward -z),
 * sized as PROP_SIZES. Plain but separable: each reads as what it is from across the room.
 */
export function standIn(name: PropName): Part[] {
  const P: Part[] = [];
  switch (name) {
    case 'desk_pod': {
      // a bench for four: one long top, two A-frame legs and a middle beam, a low fabric divider
      P.push(boxAt(3.2, 0.03, 1.6, 0, 0.735, 0, 'laminate'));
      for (const x of [-1.52, 0, 1.52]) {
        P.push(boxAt(0.05, 0.7, 0.05, x, 0.37, -0.68, 'frame'), boxAt(0.05, 0.7, 0.05, x, 0.37, 0.68, 'frame'));
        P.push(boxAt(0.05, 0.05, 1.42, x, 0.7, 0, 'frame'));
      }
      P.push(boxAt(3.04, 0.06, 0.05, 0, 0.66, 0, 'frame'));
      P.push(boxAt(3.1, 0.36, 0.03, 0, 0.93, 0, 'fabric'));
      P.push(boxAt(3.12, 0.02, 0.05, 0, 1.115, 0, 'frame'));
      // cable spines under it
      P.push(boxAt(0.12, 0.66, 0.12, -0.8, 0.33, 0, 'dark'), boxAt(0.12, 0.66, 0.12, 0.8, 0.33, 0, 'dark'));
      break;
    }
    case 'monitor_24': {
      P.push(boxAt(0.22, 0.012, 0.18, 0, 0.006, 0.02, 'dark'));
      P.push(boxAt(0.04, 0.26, 0.03, 0, 0.14, 0.06, 'dark'));
      P.push(boxAt(0.56, 0.33, 0.025, 0, 0.32, 0.035, 'dark'));
      P.push(boxAt(0.53, 0.3, 0.004, 0, 0.32, 0.02, 'screen'));
      break;
    }
    case 'rack_42u': {
      P.push(boxAt(0.6, 2.0, 1.0, 0, 1.0, 0, 'dark'));
      // the units: alternating faces, a vented door frame
      for (let u = 0; u < 14; u++) {
        const y = 0.18 + u * 0.125;
        P.push(boxAt(0.5, 0.1, 0.01, 0, y, -0.505, u % 3 === 0 ? 'metal' : 'frame'));
        for (let k = 0; k < 6; k++) {
          const lit = (u * 7 + k * 3) % 5;
          const rgb: [number, number, number] = lit === 0 ? [1.0, 0.62, 0.15] : lit === 3 ? [0.2, 0.55, 1.0] : [0.2, 1.0, 0.45];
          if ((u + k) % 4 !== 1) P.push(ledAt(-0.2 + k * 0.022, y + 0.025, -0.512, rgb));
        }
      }
      P.push(boxAt(0.6, 0.04, 0.02, 0, 1.98, -0.51, 'metal'), boxAt(0.6, 0.04, 0.02, 0, 0.02, -0.51, 'metal'));
      break;
    }
    case 'cable_tray': {
      P.push(boxAt(3.0, 0.01, 0.3, 0, 0.005, 0, 'metal'));
      P.push(boxAt(3.0, 0.08, 0.01, 0, 0.04, -0.145, 'metal'), boxAt(3.0, 0.08, 0.01, 0, 0.04, 0.145, 'metal'));
      // bundles of cable in it, blue and grey
      P.push(cylAt(0.04, 0.04, 2.96, 0, 0.05, -0.06, 'fabric', 8, 0, Math.PI / 2));
      P.push(cylAt(0.035, 0.035, 2.96, 0, 0.045, 0.05, 'dark', 8, 0, Math.PI / 2));
      for (const x of [-1.2, 0, 1.2]) P.push(boxAt(0.02, 0.4, 0.02, x, 0.25, 0, 'frame'));
      break;
    }
    case 'it_bench': {
      P.push(boxAt(1.8, 0.04, 0.75, 0, 0.88, 0, 'laminate'));
      for (const x of [-0.85, 0.85]) for (const z of [-0.32, 0.32]) P.push(boxAt(0.05, 0.86, 0.05, x, 0.43, z, 'metal'));
      P.push(boxAt(1.7, 0.03, 0.6, 0, 0.18, 0, 'metal'));
      // pegboard and tools
      P.push(boxAt(1.8, 0.7, 0.02, 0, 1.25, 0.36, 'white'));
      for (let i = 0; i < 9; i++) {
        const x = -0.75 + i * 0.19;
        P.push(boxAt(0.02, 0.16 + (i % 3) * 0.05, 0.02, x, 1.2 + (i % 2) * 0.14, 0.33, i % 3 === 0 ? 'dark' : 'metal'));
      }
      // a soldering station, a multimeter, a parts drawer, a coil of cable
      P.push(boxAt(0.22, 0.08, 0.16, -0.55, 0.94, 0.12, 'dark'), boxAt(0.1, 0.16, 0.04, 0.5, 0.98, 0.15, 'dark'));
      P.push(ledAt(-0.5, 0.95, 0.039, [1.0, 0.3, 0.1], 0.02));
      P.push(boxAt(0.36, 0.22, 0.24, 0.0, 1.01, 0.2, 'white'));
      P.push(cylAt(0.09, 0.09, 0.05, 0.7, 0.925, -0.1, 'fabric', 14));
      break;
    }
    case 'chair_office': {
      P.push(cylAt(0.24, 0.27, 0.035, 0, 0.06, 0, 'dark', 5));
      P.push(cylAt(0.025, 0.025, 0.36, 0, 0.26, 0, 'metal', 8));
      P.push(boxAt(0.5, 0.08, 0.48, 0, 0.47, 0, 'fabric'));
      P.push(boxAt(0.46, 0.52, 0.06, 0, 0.82, 0.24, 'fabric', 0, -0.12));
      P.push(boxAt(0.04, 0.2, 0.3, -0.27, 0.6, 0.02, 'dark'), boxAt(0.04, 0.2, 0.3, 0.27, 0.6, 0.02, 'dark'));
      break;
    }
    case 'desk_lamp': {
      P.push(cylAt(0.08, 0.09, 0.02, 0, 0.01, 0.12, 'dark', 16));
      P.push(cylAt(0.01, 0.01, 0.36, 0, 0.19, 0.08, 'metal', 6, 0.22));
      P.push(cylAt(0.01, 0.01, 0.3, 0, 0.39, -0.06, 'metal', 6, 1.1));
      P.push(cylAt(0.035, 0.075, 0.1, 0, 0.43, -0.18, 'dark', 16, -0.5));
      P.push(cylAt(0.03, 0.03, 0.01, 0, 0.395, -0.2, 'glow', 12, -0.5));
      break;
    }
    case 'ceiling_light_panel': {
      P.push(boxAt(1.2, 0.04, 0.6, 0, 0.04, 0, 'frame'));
      P.push(boxAt(1.16, 0.01, 0.56, 0, 0.015, 0, 'panel'));
      break;
    }
    case 'filing_cabinet': {
      P.push(boxAt(0.5, 1.3, 0.62, 0, 0.65, 0, 'metal'));
      for (let i = 0; i < 4; i++) {
        P.push(boxAt(0.46, 0.29, 0.01, 0, 0.17 + i * 0.32, -0.315, 'frame'));
        P.push(boxAt(0.12, 0.02, 0.02, 0, 0.27 + i * 0.32, -0.33, 'dark'));
      }
      break;
    }
    case 'whiteboard': {
      P.push(boxAt(1.8, 1.2, 0.02, 0, 0.6, 0.0, 'frame'));
      P.push(boxAt(1.74, 1.14, 0.01, 0, 0.6, -0.015, 'paper'));
      P.push(boxAt(1.6, 0.03, 0.06, 0, 0.0, -0.03, 'frame'));
      break;
    }
    case 'printer': {
      P.push(boxAt(0.6, 0.62, 0.62, 0, 0.31, 0, 'white'));
      P.push(boxAt(0.6, 0.3, 0.6, 0, 0.77, 0.01, 'white'));
      P.push(boxAt(0.56, 0.06, 0.5, 0, 0.95, 0.02, 'dark'));
      P.push(boxAt(0.22, 0.03, 0.12, 0.15, 0.94, -0.28, 'dark', 0, -0.4));
      P.push(boxAt(0.4, 0.015, 0.3, 0, 0.66, -0.2, 'paper'));
      P.push(ledAt(0.24, 0.95, -0.34, [0.2, 1.0, 0.45], 0.015));
      break;
    }
    case 'plant_pot': {
      P.push(cylAt(0.2, 0.15, 0.4, 0, 0.2, 0, 'pot', 16));
      // a tall leafy plant: stacked, offset spheres
      for (let i = 0; i < 6; i++) {
        const a = i * 2.3;
        const g = new SphereGeometry(0.16 + (i % 3) * 0.03, 10, 8);
        g.scale(1, 1.25, 1);
        g.translate(Math.cos(a) * 0.1, 0.6 + i * 0.12, Math.sin(a) * 0.1);
        P.push({ mat: 'plant', geom: g });
      }
      break;
    }
    case 'coffee_station': {
      P.push(boxAt(1.6, 0.9, 0.62, 0, 0.45, 0, 'laminate'));
      P.push(boxAt(1.56, 0.85, 0.01, 0, 0.44, -0.315, 'white'));
      P.push(boxAt(0.36, 0.42, 0.36, -0.4, 1.11, 0.05, 'dark'));
      P.push(boxAt(0.3, 0.12, 0.02, -0.4, 1.2, -0.13, 'metal'));
      P.push(ledAt(-0.3, 1.25, -0.14, [0.2, 0.6, 1.0], 0.02));
      for (const x of [0.2, 0.32, 0.44]) P.push(cylAt(0.04, 0.035, 0.1, x, 0.95, -0.05, 'white', 10));
      P.push(boxAt(0.3, 0.3, 0.3, 0.55, 1.05, 0.08, 'metal'));
      break;
    }
  }
  return P;
}

/**
 * Merges geometry that shares a material into one mesh per material (static batching): the whole
 * room is a couple of dozen draws however many props stand in it.
 */
export class Batcher {
  private buckets = new Map<Material, BufferGeometry[]>();

  add(material: Material, geometry: BufferGeometry, matrix?: Matrix4): void {
    const g = normalise(geometry);
    if (matrix) g.applyMatrix4(matrix);
    let list = this.buckets.get(material);
    if (!list) this.buckets.set(material, (list = []));
    list.push(g);
  }

  /** one mesh per material; each bucket's sources are disposed */
  build(opts: { castShadow: boolean; receiveShadow: boolean }): Mesh[] {
    const out: Mesh[] = [];
    for (const [material, list] of this.buckets) {
      // within one bucket every geometry must carry the same attributes
      const names = new Set<string>();
      for (const g of list) for (const n of Object.keys(g.attributes)) names.add(n);
      for (const g of list) {
        for (const n of names) {
          if (g.attributes[n]) continue;
          const size = n === 'uv' ? 2 : n === 'color' ? 3 : 3;
          const fill = new Float32Array(g.attributes.position!.count * size);
          if (n === 'color') fill.fill(1);
          g.setAttribute(n, new BufferAttribute(fill, size));
        }
      }
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, material);
      mesh.castShadow = opts.castShadow;
      mesh.receiveShadow = opts.receiveShadow;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      out.push(mesh);
    }
    this.buckets.clear();
    return out;
  }
}

/** a copy with position, normal, uv (and colour where it has one) only, indexed, so any two merge */
function normalise(src: BufferGeometry): BufferGeometry {
  const g = new BufferGeometry();
  for (const n of ['position', 'normal', 'uv', 'color']) {
    const a = src.getAttribute(n);
    if (!a) continue;
    // interleaved or normalised integer attributes (meshopt) are read back as plain floats
    const size = n === 'color' ? 3 : a.itemSize;
    const arr = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < size; c++) arr[i * size + c] = c < a.itemSize ? a.getComponent(i, c) : 1;
    }
    g.setAttribute(n, new BufferAttribute(arr, size));
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const count = g.getAttribute('position')!.count;
  if (src.index) {
    const idx = new Uint32Array(src.index.count);
    for (let i = 0; i < idx.length; i++) idx[i] = src.index.getX(i);
    g.setIndex(new BufferAttribute(idx, 1));
  } else {
    const idx = new Uint32Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;
    g.setIndex(new BufferAttribute(idx, 1));
  }
  return g;
}

/** every mesh under `root`, with its transform relative to `root` */
export function meshesUnder(root: Object3D): { mesh: Mesh; local: Matrix4 }[] {
  root.updateMatrixWorld(true);
  const inv = new Matrix4().copy(root.matrixWorld).invert();
  const out: { mesh: Mesh; local: Matrix4 }[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) out.push({ mesh: m, local: new Matrix4().multiplyMatrices(inv, m.matrixWorld) });
  });
  return out;
}
