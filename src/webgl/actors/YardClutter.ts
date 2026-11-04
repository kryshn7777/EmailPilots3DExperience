import {
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  Quaternion,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { HOME_CELL, HOME_CELLS, type FenceRun } from '../bake/cityGen.mjs';
import { mulberry32 } from '../util';
import { asset } from '../asset';
import { requestCompile } from '../warm';
import { dequantized, type KitManifest } from './KitCity';
import type { YardLot } from './Yards';
import type { Stand } from './Pedestrians';
import type { DecalAnchors } from './HouseDecals';

/**
 * The lived-in layer of the town: what people leave about. Kerbside (paper leaf bags, a utility
 * pedestal, mailboxes of three kinds), the front yard (bikes and scooters dropped on the lawn, balls, a
 * toy truck, a portable basketball hoop at the end of the drive, pumpkins on the steps, a gnome in the
 * bed, a hose left out, a mower stopped mid-lawn, a covered car on an empty drive), the back yard (a
 * rotary washing line with laundry, a hot tub, a picnic table, a stone fire pit with odd chairs round
 * it, a slide, a kayak, grills, junk round the shed: a wheelbarrow, tyres, compost bags, a barrel,
 * crates, pots), the walls (a satellite dish, a ladder up to a window, a rain barrel, a hose reel, bins),
 * and distribution poles with sagging lines down the rear lot lines.
 *
 * Every household draws its own habits from a stream of its own (kids, a decorator, a gardener, a
 * tinkerer, how untidy), and everything is set down at a random turn, off true, some of it knocked
 * over, so no two yards repeat and nothing sits on a grid. Each piece keeps off what Yards, the fences,
 * the cars, the street furniture and the trees already hold.
 *
 * The models are one GLB and one atlas (blender/make_yard_props.py: Poly Haven CC0 models decimated and
 * re-baked, and procedural ones), drawn as ONE BatchedMesh: every kind, every instance, one draw call.
 * Each piece draws only within a reach of the camera that suits its size, and as its lean mesh past a
 * fraction of that (phones always lean, a shorter list and shorter reach).
 */

interface PropInfo { tris: number; lean: number; size: [number, number, number]; radius: number }
interface PropManifest { scale: number; props: Record<string, PropInfo> }

type Kind = string;
interface Item {
  kind: Kind;
  x: number; y: number; z: number;
  yaw: number;
  /** turns after the yaw, about the model's own x and z (knocked over, leaning, off level) */
  rx?: number; rz?: number;
  s: number;
  tint: string;
  /** hung on a wall at `y`: not set down on its lowest point */
  hung?: boolean;
}

/** how far from the camera each kind still draws (HIGH), by size */
const SMALL = 24;
const MEDIUM = 40;
const LARGE = 66;
const REACH: Record<Kind, number> = {
  'gnome': SMALL, 'clay-pot': SMALL, 'watering-can': SMALL, 'soccer-ball': SMALL, 'football': SMALL, 'ball': SMALL,
  'toy-truck': SMALL, 'pumpkin': SMALL, 'hose': SMALL, 'propane': SMALL, 'scooter': SMALL,
  'tyre': MEDIUM, 'bike': MEDIUM, 'kid-bike': MEDIUM, 'leaf-bag': MEDIUM, 'trash-bag': MEDIUM, 'monobloc': MEDIUM,
  'patio-chair': MEDIUM, 'patio-table': MEDIUM, 'rocker': MEDIUM, 'bench': MEDIUM, 'mower': MEDIUM, 'wheelbarrow': MEDIUM,
  'hose-reel': MEDIUM, 'kettle-grill': MEDIUM, 'gas-grill': MEDIUM, 'trash-can': MEDIUM, 'trash-can-rust': MEDIUM,
  'barrel': MEDIUM, 'crate': MEDIUM, 'compost-bags': MEDIUM, 'planter': MEDIUM, 'stepladder': MEDIUM, 'stump': MEDIUM,
  'mailbox-post': MEDIUM, 'mailbox-brick': MEDIUM, 'mailbox-white': MEDIUM, 'utility-box': MEDIUM, 'dish': MEDIUM,
  'ladder': LARGE, 'car-cover': LARGE, 'hot-tub': LARGE, 'picnic': LARGE, 'firepit': LARGE, 'clothesline': LARGE,
  'hoop': LARGE, 'slide': LARGE, 'kayak': LARGE, 'power-pole': 110,
};
/** what phones draw (lean meshes, about 60% of the reach): what reads from a phone at the flight's speed */
const LOW_KINDS = new Set<Kind>([
  'mailbox-post', 'mailbox-brick', 'mailbox-white', 'leaf-bag', 'pumpkin', 'bike', 'kid-bike', 'car-cover', 'hoop',
  'clothesline', 'hot-tub', 'picnic', 'trash-can', 'kettle-grill', 'gas-grill', 'wheelbarrow', 'slide', 'kayak',
]);
/** the HIGH tier swaps to the lean mesh beyond this share of a kind's reach */
const LEAN_AT = 0.42;

const PLASTIC = ['#e8e6e0', '#d9d4c4', '#3d5a3c', '#2f3134', '#b8b2a4'];
const BIKES = ['#b8402e', '#2f5f9a', '#3d6b4a', '#d8b23a', '#e6e4dc', '#26282b', '#8a4a9a', '#c86a8a', '#5a8ab8'];
const KAYAKS = ['#ffffff', '#ffd9a0', '#a8e0ff', '#c8f0a0', '#ffb0a0'];
const HOOP_BASE = ['#ffffff', '#d8dde6'];
const SLIDES = ['#ffffff', '#c8e4ff', '#d0f0c0'];
const CAN_TINTS = ['#ffffff', '#e8eef0', '#d8d8d0'];
const BOXES = ['#ffffff', '#d6dcc8', '#c4ccbc'];

/** a jittered grey-white, so the same model never comes twice in exactly one tone */
function wear(rand: () => number, base = '#ffffff', spread = 0.16): string {
  const c = new Color(base);
  const k = 1 - rand() * spread;
  return '#' + c.multiplyScalar(k).getHexString();
}

/** the lowest y of a geometry turned by q (its own origin fixed) */
const _v = new Vector3();
function lowest(g: BufferGeometry, q: Quaternion): number {
  const pos = g.attributes.position!;
  let min = Infinity;
  for (let i = 0; i < pos.count; i++) min = Math.min(min, _v.fromBufferAttribute(pos, i).applyQuaternion(q).y);
  return min;
}

/** a seed per lot from its position, so a lot's clutter does not depend on any other lot */
function lotSeed(x: number, z: number): number {
  return (Math.imul(Math.round(x * 100) | 0, 73856093) ^ Math.imul(Math.round(z * 100) | 0, 19349663) ^ 0x5bd1e995) >>> 0;
}

export interface ClutterContext {
  tier: 'high' | 'low';
  /** street furniture, street trees, lamps: what the verge already holds (world x/z) */
  kerb: { x: number; z: number; r: number }[];
  fences: FenceRun[];
  /** every tree in town (world): poles keep off them */
  trees: { x: number; z: number; r: number }[];
  /** the low part of the flight (world x/z of path samples less than a few units over the roofs) */
  lowPath: { x: number; z: number }[];
  /** is (x, z) within `reach` of the flight */
  near: (x: number, z: number, reach: number) => boolean;
}

export class YardClutter {
  readonly group = new Group();
  /** people and dogs in the yards, for the town's crowd (see PedestrianPlans.townCrowd) */
  readonly stands: Stand[] = [];
  private items: Item[] = [];
  private mesh: BatchedMesh | null = null;
  /** per instance: kind index, full and lean geometry ids, world x/z, reach squared */
  private slots: { full: number; lean: number; x: number; z: number; reach2: number; lean2: number; visible: boolean; isLean: boolean }[] = [];
  private eye = new Vector3(1e9, 0, 0);
  private at = new Vector3();
  private disposables: { dispose(): void }[] = [];
  private disposed = false;
  /** lots this pass dressed, kept for the wall pass once the anchors are in */
  private yards: YardLot[];
  private ctx: ClutterContext;
  private poles: { x: number; z: number; yaw: number }[] = [];

  constructor(yards: YardLot[], ctx: ClutterContext) {
    this.yards = yards;
    this.ctx = ctx;
    const high = ctx.tier === 'high';
    for (const y of yards) {
      // phones get what the flight passes closest
      if (!high && !ctx.near(y.lot.x, y.lot.z, 26)) continue;
      this.dress(y);
    }
    if (high) this.planPoles();
  }

  // ---- placement --------------------------------------------------------------------------------------

  private dress(L: YardLot): void {
    const { lotW, lotD } = HOME_CELL;
    const R = mulberry32(lotSeed(L.lot.x, L.lot.z));
    const pick = <T,>(a: T[]): T => a[Math.floor(R() * a.length)]!;
    const chance = (p: number): boolean => R() < p;
    const between = (a: number, b: number): number => a + R() * (b - a);
    const high = this.ctx.tier === 'high';
    const want = (k: Kind): boolean => high || LOW_KINDS.has(k);
    const { cx, front, toStreet, hw, vF, vR } = L;
    const world = (u: number, v: number): [number, number] => [cx + u, front - toStreet * v];
    /** a yaw (0 faces +x) that turns a model's +z toward lot direction (du, dv) */
    const face = (du: number, dv: number): number => Math.atan2(du, -toStreet * dv);
    const mine: { u: number; v: number; r: number; tall?: boolean }[] = [];
    const fences = this.fenceCircles(L);

    // the household
    const kids = chance(0.55);
    const decorator = chance(0.55);
    const gardener = chance(0.4);
    const tinkerer = chance(0.3);
    const mess = R();

    /** is a circle of radius r at (u, v) clear of everything on the lot, and of the verge's furniture? */
    const free = (u: number, v: number, r: number, o: { tall?: boolean; bed?: boolean; drive?: boolean; kerb?: boolean } = {}): boolean => {
      if (Math.abs(u) > lotW / 2 - r - 0.1) return false;
      if (o.kerb) {
        if (v > -0.12 || v < -0.62) return false;
        const [x, z] = world(u, v);
        for (const k of this.ctx.kerb) if (Math.hypot(k.x - x, k.z - z) < k.r + r + 0.05) return false;
      } else {
        if (v < r + 0.08 || v > lotD - r - 0.15) return false;
        // the house, and the bed along its front (only bed plants may stand there)
        if (Math.abs(u) < hw / 2 + r + 0.04 && v + r > vF - 0.04 && v - r < vR + 0.04) return false;
        if (!o.bed && Math.abs(u) < hw / 2 + 0.1 && v + r > vF - 0.4 && v < vF) return false;
        // the front walk
        if (Math.abs(u) < 0.22 + r && v < vF + 0.05) return false;
      }
      if (L.drive && !o.drive && Math.abs(u - L.drive.u) < L.drive.w / 2 + r && v < L.drive.v1 + r) return false;
      if (L.car) {
        for (const dv of [-0.42, 0, 0.42]) if (Math.hypot(u - L.car.u, v - (L.car.v + dv)) < r + 0.36) return false;
      }
      for (const t of L.taken) {
        const tr = t.tall && !o.tall && t.r > 0.4 ? t.r * 0.35 : t.r;
        if (Math.hypot(u - t.u, v - t.v) < r + tr) return false;
      }
      for (const t of mine) if (Math.hypot(u - t.u, v - t.v) < r + t.r) return false;
      for (const f of fences) if (Math.hypot(u - f.u, v - f.v) < r + f.r) return false;
      return true;
    };
    /** tries a few spots in a box for a piece of radius r */
    const spot = (r: number, us: [number, number], vs: [number, number], o: Parameters<typeof free>[3] = {}): [number, number] | null => {
      for (let k = 0; k < 16; k++) {
        const u = between(us[0], us[1]);
        const v = between(vs[0], vs[1]);
        if (free(u, v, r, o)) return [u, v];
      }
      return null;
    };
    const put = (kind: Kind, u: number, v: number, yaw: number, s: number, tint: string, r: number,
      o: { rx?: number; rz?: number; y?: number; tall?: boolean } = {}): void => {
      if (!want(kind)) return;
      const [x, z] = world(u, v);
      this.items.push({ kind, x, y: o.y ?? 0, z, yaw, s, tint, rx: o.rx, rz: o.rz });
      mine.push({ u, v, r, tall: o.tall });
    };
    /** a little off level: nothing in a yard stands quite plumb */
    const tilt = (a = 0.05): { rx: number; rz: number } => ({ rx: between(-a, a), rz: between(-a, a) });
    const spin = (): number => between(0, Math.PI * 2);
    const stand = (u: number, v: number, yaw: number, mood: Stand['mood'], variant?: string, group?: number): void => {
      if (!free(u, v, 0.09)) return;
      const [x, z] = world(u, v);
      this.stands.push({ x, z, yaw, mood, ...(variant ? { variant } : {}), ...(group !== undefined ? { group } : {}) });
      mine.push({ u, v, r: 0.09 });
    };
    /** world yaw that faces from lot point a to lot point b */
    const look = (ua: number, va: number, ub: number, vb: number): number => {
      const [xa, za] = world(ua, va);
      const [xb, zb] = world(ub, vb);
      return Math.atan2(-(zb - za), xb - xa);
    };
    const peopleNear = this.ctx.near(L.lot.x, L.lot.z, 20);
    let group = 9000 + (lotSeed(L.lot.x, L.lot.z) % 50000);

    // ---- kerb and front yard -------------------------------------------------------------------------
    if (L.mailbox) {
      // the mailbox Yards placed, as one of three kinds, door to the street, its post a little off plumb
      const kind = pick(['mailbox-post', 'mailbox-post', 'mailbox-white', 'mailbox-brick']);
      const [u, v] = [L.mailbox.x - cx, (front - L.mailbox.z) * toStreet];
      put(kind, u, v, -toStreet * Math.PI / 2 + between(-0.12, 0.12), between(0.92, 1.06),
        kind === 'mailbox-brick' ? wear(R, '#ffffff', 0.2) : wear(R), 0.1, tilt(kind === 'mailbox-brick' ? 0.01 : 0.05));
    }
    if (chance(0.42 + mess * 0.3)) {
      // autumn: paper leaf bags out at the kerb, or still on the lawn by the drive, one fallen over
      const n = 1 + Math.floor(R() * (2 + mess * 3));
      const atKerb = chance(0.6);
      const c = atKerb ? spot(0.12, [-2.8, 2.8], [-0.5, -0.25], { kerb: true }) : spot(0.12, [-2.8, 2.8], [0.3, Math.max(vF - 0.6, 0.5)]);
      if (c) {
        for (let k = 0; k < n; k++) {
          const u = c[0] + (k - (n - 1) / 2) * between(0.13, 0.18) + between(-0.03, 0.03);
          const v = c[1] + between(-0.05, 0.05);
          const fallen = chance(0.18);
          if (!free(u, v, 0.07, { kerb: atKerb })) continue;
          put('leaf-bag', u, v, spin(), between(0.9, 1.1), wear(R, '#ffffff', 0.18), 0.07,
            fallen ? { rx: Math.PI / 2 - 0.08 } : tilt(0.08));
        }
        if (atKerb && chance(0.3)) {
          const p = spot(0.09, [c[0] - 0.6, c[0] + 0.6], [-0.5, -0.25], { kerb: true });
          if (p) put('trash-bag', p[0], p[1], spin(), between(0.85, 1.1), wear(R, '#ffffff', 0.2), 0.09, tilt(0.1));
        }
      }
    }
    if (chance(0.2)) {
      // a green utility pedestal in a front corner of the lot
      const side = chance(0.5) ? -1 : 1;
      const p = spot(0.1, [side * 3.05, side * 3.25], [0.12, 0.35]);
      if (p) put('utility-box', p[0], p[1], face(0, -1) + between(-0.1, 0.1), between(0.9, 1.05), pick(BOXES), 0.1);
    }
    if (decorator && want('pumpkin')) {
      // pumpkins on and beside the steps, a few on the lawn by the walk
      const n = 1 + Math.floor(R() * 4);
      for (let k = 0; k < n; k++) {
        const side = k % 2 ? 1 : -1;
        const u = side * between(0.25, 0.42);
        const v = vF - between(0.05, 0.28);
        if (!free(u, v, 0.06, { bed: true })) continue;
        put('pumpkin', u, v, spin(), between(0.7, 1.35), wear(R, '#ffffff', 0.25), 0.06, tilt(0.12));
      }
      if (chance(0.3)) {
        const p = spot(0.06, [-1.6, 1.6], [0.5, Math.max(vF - 0.5, 0.6)]);
        if (p) put('pumpkin', p[0], p[1], spin(), between(1.1, 1.6), wear(R, '#ffffff', 0.2), 0.07, tilt(0.1));
      }
    }
    if (chance(0.12 + (gardener ? 0.2 : 0))) {
      // a gnome or two in the bed, or out on the lawn
      for (let k = 0; k < 1 + Math.floor(R() * 2); k++) {
        const p = chance(0.6) ? spot(0.05, [-hw / 2, hw / 2], [vF - 0.32, vF - 0.1], { bed: true })
          : spot(0.05, [-3, 3], [0.4, vF - 0.4]);
        if (p) put('gnome', p[0], p[1], face(0, -1) + between(-0.6, 0.6), between(0.8, 1.15), wear(R), 0.05, tilt(0.06));
      }
    }
    if (kids) {
      // what the kids dropped where they got off: bikes on their sides, a scooter, balls, a toy
      const n = 1 + Math.floor(R() * (1.5 + mess * 3.5));
      for (let k = 0; k < n; k++) {
        const roll = R();
        const onDrive = L.drive && chance(0.3);
        const us: [number, number] = onDrive ? [L.drive!.u - 0.25, L.drive!.u + 0.25] : [-3, 3];
        const vs: [number, number] = onDrive ? [0.3, Math.min(L.drive!.v1 - 0.3, vF)] : [0.4, Math.max(vF - 0.45, 0.6)];
        const o = { drive: !!onDrive };
        if (roll < 0.34) {
          const kind = chance(0.55) ? 'kid-bike' : 'bike';
          const p = spot(0.2, us, vs, o);
          if (p) {
            const lying = chance(0.8);
            put(kind, p[0], p[1], spin(), between(0.95, 1.05), pick(BIKES), 0.2,
              lying ? { rx: (chance(0.5) ? 1 : -1) * (Math.PI / 2 - 0.1) } : tilt(0.03));
          }
        } else if (roll < 0.5) {
          const p = spot(0.1, us, vs, o);
          if (p) put('scooter', p[0], p[1], spin(), between(0.9, 1.1), pick(BIKES), 0.1, { rx: Math.PI / 2 - 0.15 });
        } else if (roll < 0.82) {
          const kind = pick(['ball', 'soccer-ball', 'soccer-ball', 'football']);
          const p = spot(0.04, us, vs, o);
          if (p) put(kind, p[0], p[1], spin(), between(0.9, 1.1), kind === 'ball' ? pick(['#ffffff', '#ffd0c8', '#c8e0ff']) : wear(R), 0.04,
            kind === 'football' ? { rz: Math.PI / 2 } : {});
        } else {
          const p = spot(0.07, us, vs, o);
          if (p) put('toy-truck', p[0], p[1], spin(), between(0.9, 1.1), wear(R), 0.07, tilt(0.2));
        }
      }
      if (L.drive && chance(0.6)) {
        // a portable hoop at the street end of the drive, the board facing up it
        const u = L.drive.u + between(-0.08, 0.08);
        const v = between(0.2, 0.42);
        if (free(u, v, 0.14, { drive: true, tall: true })) {
          put('hoop', u, v, face(0, 1) + between(-0.08, 0.08), between(0.95, 1.05), pick(HOOP_BASE), 0.22, { tall: true, ...tilt(0.02) });
          if (peopleNear && chance(0.4)) {
            const b = 0.55 + between(0, 0.3);
            stand(u + between(-0.15, 0.15), b, look(u, b, u, v), 'idle', 'child');
          }
        }
      }
      if (peopleNear && chance(0.35)) {
        // two kids on the front lawn
        const p = spot(0.25, [-2.6, 2.6], [0.5, Math.max(vF - 0.5, 0.7)]);
        if (p) {
          group++;
          const a = spin();
          stand(p[0] + Math.cos(a) * 0.17, p[1] + Math.sin(a) * 0.17, look(p[0] + Math.cos(a) * 0.17, p[1] + Math.sin(a) * 0.17, p[0], p[1]), 'chat', 'child', group);
          stand(p[0] - Math.cos(a) * 0.17, p[1] - Math.sin(a) * 0.17, look(p[0] - Math.cos(a) * 0.17, p[1] - Math.sin(a) * 0.17, p[0], p[1]), 'chat', 'child', group);
        }
      }
    }
    if (!L.car && L.drive && chance(0.3)) {
      // a car under a cover on the drive, up by the house
      const u = L.drive.u + between(-0.04, 0.04);
      const v = Math.min(L.drive.v1 - 0.78, vF + 0.1);
      if (v > 0.8 && free(u, v - 0.4, 0.3, { drive: true }) && free(u, v + 0.4, 0.3, { drive: true })) {
        put('car-cover', u, v, (chance(0.5) ? 0 : Math.PI) + between(-0.05, 0.05), between(0.95, 1.02), wear(R, '#ffffff', 0.2), 0.32);
        mine.push({ u, v: v - 0.42, r: 0.3 }, { u, v: v + 0.42, r: 0.3 });
      }
    }
    if (chance(0.1 + mess * 0.12)) {
      // the mower, left where the mowing stopped
      const p = spot(0.14, [-2.8, 2.8], chance(0.5) ? [0.5, Math.max(vF - 0.5, 0.6)] : [vR + 0.5, lotD - 0.6]);
      if (p) {
        put('mower', p[0], p[1], spin(), between(0.95, 1.05), wear(R), 0.14, tilt(0.03));
        if (peopleNear && chance(0.4)) {
          const a = spin();
          stand(p[0] + Math.cos(a) * 0.28, p[1] + Math.sin(a) * 0.28, look(p[0] + Math.cos(a) * 0.28, p[1] + Math.sin(a) * 0.28, p[0], p[1]), 'phone');
        }
      }
    }
    if (chance(0.16 + (gardener ? 0.16 : 0))) {
      // a hose snaking over the lawn from the side of the house
      const side = chance(0.5) ? -1 : 1;
      const p = spot(0.16, [side * (hw / 2 + 0.25), side * (hw / 2 + 1.0)], [vF - 0.2, vR + 0.6]);
      if (p) put('hose', p[0], p[1], spin(), between(0.85, 1.15), wear(R), 0.16);
    }

    // ---- back yard -------------------------------------------------------------------------------------
    const back: [number, number] = [vR + 0.45, lotD - 0.45];
    for (const g of L.grills) {
      // the grill Yards set out, as a kettle (or a gas grill where it fits, with its spare tank)
      const [u, v] = [g.x - cx, (front - g.z) * toStreet];
      const gas = chance(0.35) && free(u, v, 0.15);
      put(gas ? 'gas-grill' : 'kettle-grill', u, v, spin(), between(0.95, 1.05), wear(R, '#ffffff', 0.1), gas ? 0.15 : 0.1, tilt(0.02));
      if (gas && chance(0.6)) {
        const a = spin();
        if (free(u + Math.cos(a) * 0.24, v + Math.sin(a) * 0.24, 0.06)) put('propane', u + Math.cos(a) * 0.24, v + Math.sin(a) * 0.24, spin(), 1, wear(R), 0.06);
      }
      if (peopleNear && chance(0.35)) {
        group++;
        const a = spin();
        const pu = u + Math.cos(a) * 0.25, pv = v + Math.sin(a) * 0.25;
        stand(pu, pv, look(pu, pv, u, v), 'idle', undefined, group);
        if (chance(0.6)) {
          const qu = pu + Math.cos(a + 1.2) * 0.38, qv = pv + Math.sin(a + 1.2) * 0.38;
          stand(qu, qv, look(qu, qv, pu, pv), 'chat', undefined, group);
        }
      }
    }
    if (chance(0.28)) {
      const p = spot(0.48, [-2.4, 2.4], back, { tall: true });
      if (p) put('clothesline', p[0], p[1], spin(), between(0.9, 1.05), wear(R, '#ffffff', 0.1), 0.48, { tall: true, ...tilt(0.025) });
    }
    if (chance(0.13)) {
      const near = L.patio ? [L.patio[0] + (chance(0.5) ? -1 : 1) * (L.patio[2] / 2 + 0.45), L.patio[1]] as const : null;
      const p = near && free(near[0], near[1], 0.42) ? [near[0], near[1]] as [number, number] : spot(0.42, [-2.3, 2.3], back);
      if (p) put('hot-tub', p[0], p[1], face(0, -1) + between(-0.3, 0.3), between(0.95, 1.05), wear(R, '#ffffff', 0.12), 0.42);
    }
    if (chance(0.2)) {
      const p = spot(0.42, [-2.4, 2.4], back);
      if (p) put('picnic', p[0], p[1], spin(), between(0.95, 1.05), wear(R, '#ffffff', 0.25), 0.42, tilt(0.015));
    }
    if (chance(0.17)) {
      // a stone fire pit with whatever chairs came to hand round it
      const p = spot(0.6, [-2.2, 2.2], back);
      if (p) {
        put('firepit', p[0], p[1], spin(), between(0.9, 1.05), wear(R), 0.26);
        const n = 2 + Math.floor(R() * 3);
        const a0 = spin();
        for (let k = 0; k < n; k++) {
          const a = a0 + (k / n) * Math.PI * 2 + between(-0.3, 0.3);
          const d = between(0.42, 0.52);
          const u = p[0] + Math.cos(a) * d, v = p[1] + Math.sin(a) * d;
          const kind = pick(['monobloc', 'monobloc', 'patio-chair', 'rocker']);
          // the chair faces the fire (its model's front is +z), give or take
          put(kind, u, v, look(u, v, p[0], p[1]) + Math.PI / 2 + between(-0.4, 0.4), between(0.95, 1.05),
            kind === 'monobloc' ? pick(PLASTIC) : wear(R), 0.1, tilt(0.03));
        }
      }
    }
    if (L.patio && chance(0.55)) {
      // odd chairs and a table on the patio
      const [pu, pv, pw, pd] = L.patio;
      if (chance(0.5)) {
        const p = spot(0.13, [pu - pw / 2 + 0.15, pu + pw / 2 - 0.15], [pv - pd / 2 + 0.15, pv + pd / 2 - 0.15]);
        if (p) put('patio-table', p[0], p[1], spin(), 1, wear(R), 0.13, tilt(0.01));
      }
      for (let k = 0; k < 1 + Math.floor(R() * 3); k++) {
        const p = spot(0.1, [pu - pw / 2 + 0.1, pu + pw / 2 - 0.1], [pv - pd / 2 + 0.1, pv + pd / 2 + 0.2]);
        const kind = pick(['monobloc', 'patio-chair', 'rocker', 'bench']);
        if (p) put(kind, p[0], p[1], spin(), between(0.95, 1.05), kind === 'monobloc' ? pick(PLASTIC) : wear(R), kind === 'bench' ? 0.2 : 0.1, tilt(0.02));
      }
      if (gardener) {
        for (let k = 0; k < 1 + Math.floor(R() * 3); k++) {
          const p = spot(0.08, [pu - pw / 2, pu + pw / 2], [pv - pd / 2, pv + pd / 2 + 0.25]);
          if (p) put(chance(0.5) ? 'planter' : 'clay-pot', p[0], p[1], spin(), between(0.85, 1.2), wear(R), 0.08);
        }
      }
    }
    if (kids && chance(0.55)) {
      const p = spot(0.3, [-2.4, 2.4], back, { tall: true });
      if (p) put('slide', p[0], p[1], spin(), between(0.9, 1.05), pick(SLIDES), 0.3, tilt(0.02));
      for (let k = 0; k < Math.floor(R() * 3); k++) {
        const q = spot(0.05, [-2.8, 2.8], back);
        if (q) put(pick(['ball', 'soccer-ball', 'toy-truck', 'football']), q[0], q[1], spin(), between(0.9, 1.1), wear(R), 0.05,
          tilt(0.1));
      }
      if (peopleNear && chance(0.45)) {
        const q = spot(0.2, [-2.4, 2.4], back);
        if (q) {
          group++;
          stand(q[0], q[1], spin(), 'chat', 'child', group);
          if (chance(0.6)) stand(q[0] + 0.3, q[1] + 0.05, spin(), 'chat', 'child', group);
        }
      }
    }
    if (chance(0.05 + mess * 0.04)) {
      // a kayak down the side of the house or along the back fence
      const side = chance(0.5) ? -1 : 1;
      const along = chance(0.5);
      const p = along ? spot(0.2, [-2.4, 2.4], [lotD - 0.4, lotD - 0.3]) : spot(0.2, [side * (hw / 2 + 0.3), side * 3.1], [vR - 0.4, lotD - 0.8]);
      if (p) put('kayak', p[0], p[1], along ? face(1, 0) : face(0, 1) + between(-0.15, 0.15), between(0.9, 1.05), pick(KAYAKS), 0.2,
        chance(0.3) ? { rx: Math.PI - 0.05 } : tilt(0.03));
    }
    if (L.shed && chance(0.5 + mess * 0.4)) {
      // junk round the shed
      const [su, sv] = L.shed;
      const n = 1 + Math.floor(R() * (1.5 + mess * 3.5));
      for (let k = 0; k < n; k++) {
        const kind = pick(['wheelbarrow', 'tyre', 'tyre', 'compost-bags', 'barrel', 'crate', 'clay-pot',
          'stepladder', 'trash-can-rust', 'watering-can', 'propane']);
        const r = kind === 'wheelbarrow' ? 0.16 : kind === 'compost-bags' ? 0.13 : 0.08;
        const p = spot(r, [su - 0.75, su + 0.75], [sv - 0.75, sv + 0.3]);
        if (!p) continue;
        const o = kind === 'tyre' ? (chance(0.6) ? { rx: Math.PI / 2 } : tilt(0.15)) : tilt(0.06);
        put(kind, p[0], p[1], spin(), between(0.9, 1.1), wear(R, '#ffffff', 0.22), r, o);
      }
    }
    if (gardener && chance(0.6)) {
      const p = spot(0.16, [-2.8, 2.8], [0.6, lotD - 0.6]);
      if (p) {
        put('wheelbarrow', p[0], p[1], spin(), between(0.95, 1.05), wear(R, '#ffffff', 0.25), 0.16, tilt(0.03));
        const q = spot(0.05, [p[0] - 0.4, p[0] + 0.4], [p[1] - 0.4, p[1] + 0.4]);
        if (q) put('watering-can', q[0], q[1], spin(), 1, wear(R), 0.05);
        if (peopleNear && chance(0.45)) {
          const a = spin();
          const pu = p[0] + Math.cos(a) * 0.3, pv = p[1] + Math.sin(a) * 0.3;
          stand(pu, pv, look(pu, pv, p[0], p[1]), 'idle');
        }
      }
    }
    if (chance(0.05 + mess * 0.05)) {
      const p = spot(0.2, [-2.8, 2.8], [0.6, lotD - 0.6]);
      if (p) put('stump', p[0], p[1], spin(), between(0.7, 1.1), wear(R), 0.2);
    }
    if (chance(0.08 + mess * 0.12)) {
      const p = spot(0.09, [-3, 3], back);
      if (p) put('tyre', p[0], p[1], spin(), between(0.9, 1.1), wear(R), 0.09, chance(0.7) ? { rx: Math.PI / 2, rz: between(-0.1, 0.1) } : tilt(0.2));
    }
    if (chance(0.22)) {
      // a seat out front: a bench or a rocker on the lawn by the house, a chair under a tree
      const side = chance(0.5) ? -1 : 1;
      const p = spot(0.16, [side * 0.7, side * 3.0], [vF - 1.4, vF - 0.5]);
      const kind = pick(['bench', 'rocker', 'monobloc', 'patio-chair']);
      if (p) put(kind, p[0], p[1], face(0, -1) + between(-0.6, 0.6), between(0.95, 1.05), kind === 'monobloc' ? pick(PLASTIC) : wear(R), kind === 'bench' ? 0.2 : 0.11, tilt(0.02));
    }
    if (chance(0.12 + mess * 0.1)) {
      // a wheelbarrow left out front, beside a bed
      const p = spot(0.16, [-3, 3], [0.5, Math.max(vF - 0.5, 0.6)]);
      if (p) put('wheelbarrow', p[0], p[1], spin(), between(0.95, 1.05), wear(R, '#ffffff', 0.25), 0.16, tilt(0.03));
    }
    if (tinkerer && chance(0.35)) {
      const side = chance(0.5) ? -1 : 1;
      const p = spot(0.1, [side * (hw / 2 + 0.2), side * (hw / 2 + 0.6)], [vF + 0.2, vR]);
      if (p) put('stepladder', p[0], p[1], spin(), 1, wear(R), 0.1, tilt(0.02));
    }
    if (peopleNear && chance(0.12)) {
      // the dog, out in the back
      const p = spot(0.1, [-2.6, 2.6], back);
      if (p) stand(p[0], p[1], spin(), 'idle', 'dog');
    }

    // remember this lot's own pieces for the wall pass
    (L as YardLot & { clutter?: typeof mine }).clutter = mine;
  }

  /** the fence runs on this lot, as rows of small circles in its frame */
  private fenceCircles(L: YardLot): { u: number; v: number; r: number }[] {
    const out: { u: number; v: number; r: number }[] = [];
    const { lotW, lotD } = HOME_CELL;
    for (const f of this.ctx.fences) {
      const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0);
      if (Math.abs((f.x0 + f.x1) / 2 - L.cx) > lotW / 2 + len / 2 + 0.5) continue;
      const n = Math.max(1, Math.ceil(len / 0.2));
      for (let k = 0; k <= n; k++) {
        const x = f.x0 + (f.x1 - f.x0) * (k / n);
        const z = f.z0 + (f.z1 - f.z0) * (k / n);
        const u = x - L.cx, v = (L.front - z) * L.toStreet;
        if (Math.abs(u) < lotW / 2 + 0.3 && v > -0.3 && v < lotD + 0.3) out.push({ u, v, r: 0.06 });
      }
    }
    return out;
  }

  /**
   * Things on and against the walls, once the house anchors are in (HIGH): a satellite dish high on a
   * side or back wall, a ladder up to a window, a rain barrel, a hose reel and bins along the foot of
   * a wall. Every piece is set beside a window, never over one, on the real wall plane the window sits in.
   */
  private dressWalls(anchors: DecalAnchors, modules: KitManifest['modules'], info: Record<string, PropInfo>): void {
    const byId = new Map(modules.map((m) => [m.id, m]));
    for (const L of this.yards) {
      const mod = byId.get(L.lot.moduleId);
      const list = anchors[L.lot.moduleId];
      if (!mod || !list || !this.ctx.near(L.lot.x, L.lot.z, 60)) continue;
      const mine = (L as YardLot & { clutter?: { u: number; v: number; r: number }[] }).clutter ?? [];
      const R = mulberry32(lotSeed(L.lot.x, L.lot.z) ^ 0x2545f491);
      const chance = (p: number): boolean => R() < p;
      const between = (a: number, b: number): number => a + R() * (b - a);
      const lot = L.lot;
      const fit = Math.min(lot.w / mod.footprint[0], lot.d / mod.footprint[1], lot.h / (lot.rise ?? 1) / mod.height);
      const c = Math.cos(lot.yaw), s = Math.sin(lot.yaw);
      const turn = (vx: number, vz: number): [number, number] => [vx * c + vz * s, -vx * s + vz * c];
      const wins = list.filter((a) => a[0] === 'win').map(([, ax, ay, az, nx, nz, ux, uz, w, h]) => {
        const [px, pz] = turn(ax * fit, az * fit);
        const [wnx, wnz] = turn(nx, nz);
        const [wux, wuz] = turn(ux, uz);
        return { x: lot.x + px, y: ay * fit, z: lot.z + pz, nx: wnx, nz: wnz, ux: wux, uz: wuz, w: w * fit, h: h * fit };
      });
      // the walls that face the street are the house's best side: nothing goes up on those
      const toStreet = L.toStreet;
      const sideOrBack = wins.filter((w) => w.nz * toStreet < 0.5);
      if (!sideOrBack.length) continue;
      const toLot = (x: number, z: number): [number, number] => [x - L.cx, (L.front - z) * toStreet];
      /** a point on a window's wall, `off` along it from the window's centre, clear of every window on that wall */
      const beside = (w: typeof wins[number], off: number, half: number): [number, number] | null => {
        const x = w.x + w.ux * off, z = w.z + w.uz * off;
        // the windows in this wall's plane: the piece keeps clear of each, and within their span (and a
        // little past it), so it cannot hang beyond the end of a short or set-back stretch of wall
        let lo = Infinity, hi = -Infinity;
        for (const o of wins) {
          if (o.nx * w.nx + o.nz * w.nz < 0.95) continue;
          const across = Math.abs((o.x - w.x) * w.nx + (o.z - w.z) * w.nz);
          if (across > 0.05) continue;
          const along = (o.x - x) * w.ux + (o.z - z) * w.uz;
          if (Math.abs(along) < o.w / 2 + half + 0.03) return null;
          const at = (o.x - w.x) * w.ux + (o.z - w.z) * w.uz;
          lo = Math.min(lo, at - o.w / 2);
          hi = Math.max(hi, at + o.w / 2);
        }
        if (off - half < lo - 0.22 || off + half > hi + 0.22) return null;
        // and inside the house's footprint
        const lx = (x - lot.x) * c - (z - lot.z) * s, lz = (x - lot.x) * s + (z - lot.z) * c;
        if (Math.abs(lx) > (mod.footprint[0] * fit) / 2 + 0.02 || Math.abs(lz) > (mod.footprint[1] * fit) / 2 + 0.02) return null;
        return [x, z];
      };
      const clear = (x: number, z: number, r: number): boolean => {
        const [u, v] = toLot(x, z);
        if (Math.abs(u) > HOME_CELL.lotW / 2 - r - 0.1) return false;
        for (const t of L.taken) if (Math.hypot(u - t.u, v - t.v) < r + t.r * (t.r > 0.4 ? 0.35 : 1)) return false;
        for (const t of mine) if (Math.hypot(u - t.u, v - t.v) < r + t.r) return false;
        return true;
      };
      const yawOut = (w: typeof wins[number]): number => Math.atan2(w.nx, w.nz);
      const push = (kind: Kind, x: number, y: number, z: number, yaw: number, sc: number, tint: string, r: number, extra: Partial<Item> = {}): void => {
        this.items.push({ kind, x, y, z, yaw, s: sc, tint, ...extra });
        const [u, v] = toLot(x, z);
        mine.push({ u, v, r });
      };
      const pickWin = (upper: boolean): typeof wins[number] | undefined => {
        const pool = sideOrBack.filter((w) => (upper ? w.y > 0.55 : w.y < 0.5));
        return pool.length ? pool[Math.floor(R() * pool.length)] : undefined;
      };
      const depth = (k: Kind): number => (info[k]?.size[2] ?? 0.1) / 2;

      if (chance(0.3)) {
        // a satellite dish beside an upper window (or beside a ground floor one on a bungalow), facing out
        const w = pickWin(true) ?? pickWin(false);
        if (w) {
          const side = chance(0.5) ? -1 : 1;
          const p = beside(w, side * (w.w / 2 + 0.12), 0.08);
          if (p) push('dish', p[0] + w.nx * (depth('dish') + 0.004), Math.min(w.y + w.h / 2 + 0.03, w.y + 0.3), p[1] + w.nz * (depth('dish') + 0.004),
            yawOut(w) + between(-0.25, 0.25), between(0.9, 1.1), '#ffffff', 0.08, { hung: true });
        }
      }
      if (chance(0.1)) {
        // a ladder up to an upper window (painting, the gutters), leaning on the wall beside it
        const w = pickWin(true);
        const L0 = (info['ladder']?.size[1] ?? 1.4);
        if (w) {
          const side = chance(0.5) ? -1 : 1;
          const top = w.y + w.h * between(0.1, 0.45);
          const sc = between(0.92, 1.05);
          const len = L0 * sc;
          if (top < len * 0.97) {
            const lean = Math.acos(top / len);
            const out = Math.sin(lean) * len;
            const p = beside(w, side * (w.w / 2 + 0.1), 0.08);
            if (p && clear(p[0] + w.nx * out, p[1] + w.nz * out, 0.1)) {
              // the model stands up its z... its rails are thin along x: turn x onto the wall's normal, then lean toward it
              const yaw = Math.atan2(-w.nz, w.nx);
              push('ladder', p[0] + w.nx * (out + 0.012), 0, p[1] + w.nz * (out + 0.012), yaw, sc, '#ffffff', 0.12, { rz: lean });
            }
          }
        }
      }
      for (const [kind, p] of [['barrel', 0.2], ['hose-reel', 0.18], ['trash-can', 0.35]] as const) {
        if (!chance(p)) continue;
        const w = pickWin(false) ?? pickWin(true);
        if (!w) continue;
        const r = info[kind]?.radius ?? 0.1;
        const side = chance(0.5) ? -1 : 1;
        const q = beside(w, side * (w.w / 2 + r + 0.04), r);
        if (!q) continue;
        const d = depth(kind) + 0.015;
        const x = q[0] + w.nx * d, z = q[1] + w.nz * d;
        if (!clear(x, z, r)) continue;
        push(kind, x, 0, z, yawOut(w) + between(-0.3, 0.3), between(0.92, 1.05), CAN_TINTS[Math.floor(R() * CAN_TINTS.length)]!, r,
          { rx: between(-0.02, 0.02), rz: between(-0.02, 0.02) });
        if (kind === 'trash-can' && chance(0.5)) {
          const q2 = beside(w, side * (w.w / 2 + r * 3 + 0.08), r);
          if (q2 && clear(q2[0] + w.nx * d, q2[1] + w.nz * d, r)) {
            push(chance(0.4) ? 'trash-can-rust' : 'trash-can', q2[0] + w.nx * d, 0, q2[1] + w.nz * d, yawOut(w) + between(-0.4, 0.4), between(0.92, 1.05), '#ffffff', r);
          }
        }
      }
    }
  }

  /**
   * Distribution poles down the rear lot lines (every other lot, give or take), each a little inside
   * one of the corners, kept off sheds, trees and the low part of the flight. Lines sag between them.
   */
  private planPoles(): void {
    const { w: cellW, d: cellD, lotW, lots } = HOME_CELL;
    const R = mulberry32(81234);
    for (let iz = HOME_CELLS.z[0]; iz <= HOME_CELLS.z[1]; iz++) {
      const z0 = iz * cellD;
      let x = HOME_CELLS.x[0] * cellW + lotW;
      while (x < HOME_CELLS.x[1] * cellW) {
        const cellX = ((x % cellW) + cellW) % cellW;
        // no pole on a cross street
        const onCross = cellX > lots * lotW - 0.2;
        const side = R() < 0.5 ? -1 : 1;
        const px = x + 0.28 * (R() < 0.5 ? -1 : 1);
        const pz = z0 + side * 0.24;
        const ok = !onCross && this.ctx.near(px, pz, 80)
          && this.ctx.lowPath.every((p) => Math.hypot(p.x - px, p.z - pz) > 6)
          && this.ctx.trees.every((t) => Math.hypot(t.x - px, t.z - pz) > t.r * 0.6 + 0.15)
          && this.yards.every((y) => y.taken.every((t) => Math.hypot(y.cx + t.u - px, y.front - y.toStreet * t.v - pz) > t.r + 0.08));
        if (ok) this.poles.push({ x: px, z: pz, yaw: Math.PI / 2 + (R() - 0.5) * 0.08 });
        else this.poles.push({ x: NaN, z: NaN, yaw: 0 }); // a gap: the line breaks here
        x += lotW * 2 + (R() - 0.5) * 0.6;
      }
      this.poles.push({ x: NaN, z: NaN, yaw: 0 });
    }
    for (const p of this.poles) if (!Number.isNaN(p.x)) this.items.push({ kind: 'power-pole', x: p.x, y: 0, z: p.z, yaw: p.yaw, s: 1, tint: '#ffffff', rx: (R() - 0.5) * 0.03, rz: (R() - 0.5) * 0.03 });
  }

  /** the lines: three on the crossarm and one lower on the pole, sagging between neighbours */
  private buildWires(height: number, arm: number): void {
    const tubes: BufferGeometry[] = [];
    const R = mulberry32(5150);
    const r = 0.0065;
    const tube = (a: Vector3, b: Vector3, sag: number): void => {
      const n = 12;
      const pos: number[] = [];
      const idx: number[] = [];
      const pts: Vector3[] = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        pts.push(new Vector3().lerpVectors(a, b, t).add(new Vector3(0, -sag * 4 * t * (1 - t), 0)));
      }
      const side = new Vector3();
      const up = new Vector3();
      for (let k = 0; k <= n; k++) {
        const d = pts[Math.min(k + 1, n)]!.clone().sub(pts[Math.max(k - 1, 0)]!).normalize();
        side.set(-d.z, 0, d.x).normalize();
        up.crossVectors(d, side).normalize();
        for (let j = 0; j < 3; j++) {
          const ang = (j / 3) * Math.PI * 2;
          const p = pts[k]!.clone().addScaledVector(side, Math.cos(ang) * r).addScaledVector(up, Math.sin(ang) * r);
          pos.push(p.x, p.y, p.z);
        }
      }
      for (let k = 0; k < n; k++) {
        for (let j = 0; j < 3; j++) {
          const a0 = k * 3 + j, a1 = k * 3 + ((j + 1) % 3), b0 = a0 + 3, b1 = a1 + 3;
          idx.push(a0, b0, a1, a1, b0, b1);
        }
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      g.setIndex(idx);
      tubes.push(g);
    };
    for (let i = 0; i + 1 < this.poles.length; i++) {
      const a = this.poles[i]!, b = this.poles[i + 1]!;
      if (Number.isNaN(a.x) || Number.isNaN(b.x)) continue;
      const span = Math.hypot(b.x - a.x, b.z - a.z);
      if (span > 22) continue;
      const sag = span * (0.012 + R() * 0.01);
      for (const k of [-1, 0, 1]) {
        const ax = a.x + Math.cos(a.yaw) * arm * k, az = a.z - Math.sin(a.yaw) * arm * k;
        const bx = b.x + Math.cos(b.yaw) * arm * k, bz = b.z - Math.sin(b.yaw) * arm * k;
        tube(new Vector3(ax, height, az), new Vector3(bx, height, bz), sag * (1 + k * 0.06));
      }
      // the cable and phone line, lower down and slacker
      tube(new Vector3(a.x, height * 0.62, a.z), new Vector3(b.x, height * 0.62, b.z), sag * 1.6);
    }
    if (!tubes.length) return;
    const g = mergeGeometries(tubes, false)!;
    tubes.forEach((t) => t.dispose());
    g.computeVertexNormals();
    const m = new MeshStandardMaterial({ color: '#1d1e20', roughness: 0.6, metalness: 0.2 });
    const mesh = new Mesh(g, m);
    mesh.matrixAutoUpdate = false;
    mesh.name = 'yard-wires';
    mesh.castShadow = true;
    this.group.add(mesh);
    this.disposables.push(g, m);
  }

  // ---- drawing -----------------------------------------------------------------------------------------

  /**
   * Streams the models and atlas in, adds the wall pieces once `anchors` resolve (HIGH), and builds the
   * one batched mesh. `onReady` lets the caller retire the stand-ins this replaces.
   */
  async load(manifest: KitManifest, anchors: Promise<DecalAnchors | null>, onReady: () => void): Promise<void> {
    const high = this.ctx.tier === 'high';
    const dir = '/models/yard-props';
    const [info, gltf, walls] = await Promise.all([
      fetch(asset(`${dir}/manifest.json`)).then((r) => r.json() as Promise<PropManifest>),
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(asset(`${dir}/props.glb`)),
      high ? anchors.catch(() => null) : Promise.resolve(null),
    ]);
    if (this.disposed) return;
    if (walls) this.dressWalls(walls, manifest.modules, info.props);

    const geoms = new Map<string, BufferGeometry>();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const g = dequantized(m.geometry).applyMatrix4(m.matrixWorld);
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.index) {
        const idx = new Uint32Array(g.attributes.position!.count);
        for (let i = 0; i < idx.length; i++) idx[i] = i;
        g.setIndex(new BufferAttribute(idx, 1));
      }
      geoms.set(m.name, g);
    });
    const items = this.items.filter((it) => geoms.has(it.kind) && (high || LOW_KINDS.has(it.kind)));
    if (!items.length) return;
    const kinds = [...new Set(items.map((i) => i.kind))];
    let verts = 0;
    let indices = 0;
    for (const k of kinds) {
      for (const g of high ? [geoms.get(k), geoms.get(`${k}-lean`)] : [geoms.get(`${k}-lean`) ?? geoms.get(k)]) {
        if (!g) continue;
        verts += g.attributes.position!.count;
        indices += g.index!.count;
      }
    }

    const loader = new TextureLoader();
    const tex = (file: string, srgb: boolean): Texture => {
      const t = loader.load(asset(`${dir}/${file}`));
      t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
      t.flipY = false;
      t.anisotropy = 4;
      this.disposables.push(t);
      return t;
    };
    const material = new MeshStandardMaterial(high
      ? { map: tex('atlas-color.webp', true), normalMap: tex('atlas-normal.webp', false), metalness: 1, roughness: 1 }
      : { map: tex('atlas-color-low.webp', true), roughness: 0.75, metalness: 0 });
    if (high) {
      const orm = tex('atlas-orm.webp', false);
      material.roughnessMap = orm;
      material.metalnessMap = orm;
    }
    this.disposables.push(material);

    const mesh = new BatchedMesh(items.length, verts, indices, material);
    mesh.name = 'yard-clutter';
    const ids = new Map<string, { full: number; lean: number }>();
    for (const k of kinds) {
      const full = high ? mesh.addGeometry(geoms.get(k)!) : -1;
      const leanG = geoms.get(`${k}-lean`);
      const lean = leanG ? mesh.addGeometry(leanG) : full;
      ids.set(k, { full: full < 0 ? lean : full, lean });
    }
    const m4 = new Matrix4();
    const q = new Quaternion();
    const qx = new Quaternion();
    const qz = new Quaternion();
    const X = new Vector3(1, 0, 0);
    const Y = new Vector3(0, 1, 0);
    const Z = new Vector3(0, 0, 1);
    const p = new Vector3();
    const sc = new Vector3();
    const color = new Color();
    for (const it of items) {
      const id = ids.get(it.kind)!;
      const inst = mesh.addInstance(high ? id.full : id.lean);
      q.setFromAxisAngle(Y, it.yaw);
      if (it.rx) q.multiply(qx.setFromAxisAngle(X, it.rx));
      if (it.rz) q.multiply(qz.setFromAxisAngle(Z, it.rz));
      // knocked over or off level: rest it on its lowest point (a lying bike on a pedal and a handlebar)
      let y = it.y;
      if (!it.hung && (it.rx || it.rz)) y -= lowest(geoms.get(high ? it.kind : `${it.kind}-lean`) ?? geoms.get(it.kind)!, q) * it.s;
      mesh.setMatrixAt(inst, m4.compose(p.set(it.x, y, it.z), q, sc.setScalar(it.s)));
      mesh.setColorAt(inst, color.set(it.tint));
      const reach = (REACH[it.kind] ?? MEDIUM) * (high ? 1 : 0.6);
      this.slots.push({ full: id.full, lean: id.lean, x: it.x, z: it.z, reach2: reach * reach, lean2: (reach * LEAN_AT) ** 2, visible: true, isLean: !high });
    }
    mesh.castShadow = high;
    mesh.receiveShadow = high;
    this.group.add(mesh);
    this.mesh = mesh;
    this.disposables.push(mesh);
    for (const g of geoms.values()) g.dispose();
    if (high && this.poles.length) {
      const pole = info.props['power-pole'];
      if (pole) this.buildWires(pole.size[1] * 0.93, pole.size[0] * 0.42);
    }
    this.eye.set(1e9, 0, 0);
    requestCompile(this.group);
    onReady();
  }

  /** draws each piece only within its reach of the camera, lean past a share of it; when the camera has moved a few units */
  update(eye: Vector3): void {
    const mesh = this.mesh;
    if (!mesh || eye.distanceToSquared(this.eye) < 4) return;
    this.eye.copy(eye);
    this.group.updateWorldMatrix(true, false);
    const at = this.group.worldToLocal(this.at.copy(eye));
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      const d2 = (s.x - at.x) ** 2 + (s.z - at.z) ** 2;
      const vis = d2 < s.reach2;
      if (vis !== s.visible) { mesh.setVisibleAt(i, vis); s.visible = vis; }
      if (!vis) continue;
      const lean = d2 > s.lean2;
      if (lean !== s.isLean && s.full !== s.lean) { mesh.setGeometryIdAt(i, lean ? s.lean : s.full); s.isLean = lean; }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.disposables) d.dispose();
  }
}
