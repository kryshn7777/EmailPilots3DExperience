import {
  AdditiveBlending,
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  Points,
  Quaternion,
  SRGBColorSpace,
  ShaderMaterial,
  TextureLoader,
  Vector3,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CROSS_STREET_X } from '../bake/cityGen.mjs';
import { glowTexture } from '../bake/CanvasTextures';
import { lampField } from '../materials/Streets';
import { asset } from '../asset';
import { mulberry32 } from '../util';
import { dequantized, KitCity, type KitLot } from './KitCity';
import type { Footprint } from './CityStreet';
import type { Stand } from './Pedestrians';
import type { Quality } from '../quality';

/**
 * The night city, lived in: the clutter a real downtown street collects, on the pavements, in the
 * parking lane, behind the plazas and on the roofs of the nearer blocks. Everything is a real model
 * (Poly Haven CC0 scans and procedural Blender props, baked into one shared atlas by
 * blender/make_city_props.py, public/models/city-props/) placed by a seeded, deliberately untidy
 * scatter: random yaw, offsets and scale, a lid left leaning on its can, a cone knocked over, bags
 * thrown on bags, never two alike in a row.
 *
 * Placement works on an occupancy grid (5 cm cells) of what is already there: the buildings (from the
 * lots), both pedestrian lanes of every pavement and the cross streets' too, the plazas' strolls and
 * groups, CityStreet's furniture, trees, lamps, signals and the parked cars, and the moving lanes, so a
 * prop never stands in a wall, a car, a lamp or a walker's way. The flight line is never touched: no
 * prop is nearer the canyon's centre line than the parking lane.
 *
 * Draws: the props are merged per chunk of street (and per chunk of roofs), each chunk one draw with a
 * near and a lean geometry, chosen by camera distance; a chunk past `far` is not drawn at all.
 * Plus one draw for steam (the coffee cart, roof vents) and, on HIGH, one for paper blowing about.
 */

/** site units per metre (the city's people and cars are drawn at 0.33 x 1.35) */
const U = 0.33 * 1.35;
const CURB = 2.3;
const FACE = 2.75;
const CROSS_HALF = 1.3;
const BIN = 0.25;
/** how far off a building's shell a prop keeps (a hero facade's steps and sills stand a little proud of it) */
const WALL_GAP = 0.06;
/** where the canyon's walkers' lanes run (PedestrianPlans: kerb 2.41, walls 2.6, each 0.22 wide) */
const LANES: [number, number] = [CURB - 0.02, FACE - 0.03];

/** footprint (x, z) and height of each prop in metres, front +z (from props.json; kept here so the plan is synchronous) */
const SIZE: Record<string, [number, number, number]> = {
  hydrant: [0.27, 0.32, 0.8], hydrant_aged: [0.27, 0.32, 0.8], trash_can: [0.78, 0.56, 0.91], trash_can_rust: [0.78, 0.56, 0.91],
  trashbag: [0.53, 0.46, 0.57], aircon: [0.8, 0.38, 0.93], aircon_rust: [0.8, 0.38, 0.93], utility_box: [0.52, 0.43, 1.12],
  utility_box_wide: [0.92, 0.43, 1.12], barrier: [1.57, 0.44, 1.11], barrel: [0.64, 0.64, 0.93], crate: [0.52, 1.16, 0.46],
  plastic_crate: [0.5, 0.4, 0.25], cardboard: [0.38, 0.52, 0.35], tyre: [0.6, 0.16, 0.6], chalkboard: [0.92, 0.76, 1.51],
  wet_sign: [0.3, 0.36, 0.63], coffee_cart: [2.17, 1.08, 1.72], planter: [0.92, 0.42, 0.42], propane: [0.34, 0.34, 0.55],
  chair: [0.64, 0.63, 0.88], water_tank: [3.14, 3.2, 6.11], rooftop_unit: [2.75, 1.4, 1.23], dish: [0.76, 0.99, 1.51],
  antenna: [3.2, 3.2, 4.2], roof_vent: [1.2, 0.68, 1.11], news_red: [0.48, 0.44, 0.95], news_blue: [0.48, 0.44, 0.95],
  news_yellow: [0.48, 0.44, 0.95], mailbox: [0.52, 0.55, 1.27], bike_rack: [0.75, 0.05, 0.89], bike_teal: [1.74, 0.49, 0.98],
  bike_black: [1.74, 0.49, 0.98], bike_red: [1.74, 0.49, 0.98], cone: [0.36, 0.36, 0.69], hoarding_a: [2.4, 0.3, 2.4],
  hoarding_b: [2.4, 0.3, 2.4], scaffold: [2.55, 0.95, 7.02], pallet: [1.2, 0.94, 0.14], litter_paper: [0.4, 0.28, 0.06],
  litter_cup: [0.13, 0.09, 0.09], litter_card: [0.6, 0.6, 0.03], litter_can: [0.12, 0.07, 0.07], litter_ball: [0.1, 0.1, 0.1],
};

interface Item {
  k: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  s: number;
  /** extra tilt (radians) about the prop's own x and z axes: a cone knocked over, a bag slumped */
  tx?: number;
  tz?: number;
  roof?: boolean;
}

interface Chunk { near: Mesh; lean: Mesh | null; cx: number; cz: number; cy: number; roof: boolean; tris: [number, number] }

export interface LifeInput {
  footprints: Footprint[];
  lots: KitLot[];
  /** lots nearest the flight (KitCity's near ring): the roofs that get tanks, units and dishes */
  roofLots: number[];
  plazas: { x0: number; x1: number; z0: number; z1: number }[];
  /** CityStreet's furniture, trees, signals: circles nothing else may stand in */
  occupied: { x: number; z: number; r: number }[];
  /** where CityStreet would have stood its own (primitive) hydrants and bins: real ones stand there */
  hydrants: { x: number; z: number }[];
  bins: { x: number; z: number }[];
  shelters: { x: number; z: number; yaw: number }[];
  parked: { x: number; z: number; yaw: number }[];
  lamps: { x: number; z: number }[];
  quality: Quality;
}

/** a regular grid of 5 cm cells over the district's street level: 1 where something already stands */
class Occupancy {
  readonly x0 = -48;
  readonly z0 = -14;
  readonly cell = 0.05;
  readonly nx = Math.ceil(110 / 0.05);
  readonly nz = Math.ceil(28 / 0.05);
  readonly a = new Uint8Array(this.nx * this.nz);

  private span(x: number, z: number, hx: number, hz: number, yaw: number, cb: (i: number) => boolean | void): boolean {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const ex = Math.abs(c) * hx + Math.abs(s) * hz;
    const ez = Math.abs(s) * hx + Math.abs(c) * hz;
    const i0 = Math.max(0, Math.floor((x - ex - this.x0) / this.cell));
    const i1 = Math.min(this.nx - 1, Math.ceil((x + ex - this.x0) / this.cell));
    const j0 = Math.max(0, Math.floor((z - ez - this.z0) / this.cell));
    const j1 = Math.min(this.nz - 1, Math.ceil((z + ez - this.z0) / this.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = this.x0 + (i + 0.5) * this.cell - x;
        const pz = this.z0 + (j + 0.5) * this.cell - z;
        // into the prop's frame (three: R_y(yaw) maps local +x to (cos, -sin))
        const lx = px * c - pz * s;
        const lz = px * s + pz * c;
        if (Math.abs(lx) > hx || Math.abs(lz) > hz) continue;
        if (cb(j * this.nx + i) === false) return false;
      }
    }
    return true;
  }
  free(x: number, z: number, hx: number, hz: number, yaw = 0): boolean {
    if (x < this.x0 + 1 || x > this.x0 + 109 || z < this.z0 + 1 || z > this.z0 + 27) return false;
    return this.span(x, z, hx, hz, yaw, (i) => this.a[i] === 0);
  }
  fill(x: number, z: number, hx: number, hz: number, yaw = 0, v = 1): void {
    this.span(x, z, hx, hz, yaw, (i) => { this.a[i] = Math.max(this.a[i]!, v); });
  }
  circle(x: number, z: number, r: number): void { this.fill(x, z, r, r, 0); }
}

export class CityLife {
  readonly group = new Group();
  /** people for the crowd: queues at the coffee cart and the bus stops, smokers by the doors */
  readonly stands: Stand[] = [];
  private items: Item[] = [];
  private chunks: Chunk[] = [];
  private steam: ShaderMaterial | null = null;
  private paper: MeshStandardMaterial | null = null;
  private steamAt: { x: number; y: number; z: number; k: number }[] = [];
  private paperAt: { x: number; z: number; dir: number; len: number }[] = [];
  private cableRuns: { a: Vector3; b: Vector3; sag: number }[] = [];
  private disposables: { dispose(): void }[] = [];
  private hydrantsAvoid: { x0: number; x1: number; side: number }[] = [];
  private far: number;
  private nearDist: number;
  private high: boolean;
  private eye = new Vector3();
  /** what the last update drew: chunks, triangles (for the probe) */
  readonly stats = { draws: 0, tris: 0, items: 0, chunks: 0 };

  constructor(private input: LifeInput) {
    this.high = input.quality.tier === 'high';
    this.far = this.high ? 70 : 34;
    this.nearDist = this.high ? 24 : 0;
    this.plan();
    this.load().catch((e: unknown) => console.warn('CityLife: props not loaded', e));
  }

  // ---- the plan -------------------------------------------------------------------------------
  private plan(): void {
    const { footprints, plazas, occupied, parked, lamps } = this.input;
    const high = this.high;
    const rand = mulberry32(51723);
    const r = (a: number, b: number): number => a + (b - a) * rand();
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    const occ = new Occupancy();

    // what stands already: the buildings, a hair larger (hero facades carry awnings and fire escapes)
    for (const f of footprints) occ.fill(f.x, f.z, f.hx + WALL_GAP, f.hz + WALL_GAP, 0, 2);
    // the canyon pavements' two lanes of walkers, end to end
    for (const side of [1, -1]) occ.fill(8, side * (LANES[0] + LANES[1]) / 2, 50, (LANES[1] - LANES[0]) / 2, 0, 3);
    // the cross streets: the roadway and the walkers down both pavements
    for (const sx of CROSS_STREET_X) {
      occ.fill(sx, 0, CROSS_HALF + 0.05, 14, 0, 3);
      for (const e of [-1, 1]) occ.fill(sx + e * (CROSS_HALF + 0.16), 0, 0.16, 14, 0, 3);
      // the crossings and the stop lines either side of the junction, in the road
      for (const e of [-1, 1]) occ.fill(sx + e * (CROSS_HALF + 0.8), 0, 0.75, CURB, 0, 3);
    }
    // the moving lanes of the canyon (a car is ~0.8 wide on lanes at 1.1)
    occ.fill(8, 0, 60, 1.58, 0, 3);
    // parked cars, lamps and CityStreet's furniture
    for (const c of parked) occ.fill(c.x, c.z, 1.18, 0.48, 0, 3);
    for (const l of lamps) occ.circle(l.x, l.z, 0.14);
    for (const o of occupied) occ.circle(o.x, o.z, o.r);
    // the plazas' people: the stroll along the back and the groups behind the tree row (PedestrianPlans)
    for (const p of plazas) {
      const side = p.z0 + p.z1 > 0 ? 1 : -1;
      const depth = p.z1 - p.z0;
      if (depth >= 2.3 && p.x1 - p.x0 >= 3) occ.fill((p.x0 + p.x1) / 2, side * (FACE + depth - 0.42), (p.x1 - p.x0) / 2, 0.28);
      if (depth >= 1.8) occ.fill((p.x0 + p.x1) / 2, side * (FACE + depth * 0.5 + 0.55), (p.x1 - p.x0) / 2, 0.42);
    }

    // the face of the buildings on each side, in bins along x: how much pavement is free past FACE
    const x0 = -44;
    const x1 = 60;
    const bins = Math.ceil((x1 - x0) / BIN);
    const faceAt = { 1: new Float32Array(bins).fill(99), [-1]: new Float32Array(bins).fill(99) } as Record<number, Float32Array>;
    for (const f of footprints) {
      const side = Math.sign(f.z);
      const a = Math.max(0, Math.floor((f.x - f.hx - x0) / BIN));
      const b = Math.min(bins - 1, Math.ceil((f.x + f.hx - x0) / BIN));
      for (let i = a; i <= b; i++) faceAt[side]![i] = Math.min(faceAt[side]![i]!, Math.abs(f.z) - f.hz);
    }
    const face = (side: number, x: number): number => faceAt[side]![Math.max(0, Math.min(bins - 1, Math.floor((x - x0) / BIN)))]!;
    const inPlaza = (x: number, z: number): boolean => plazas.some((p) => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1);

    const items = this.items;
    /** a prop at (x, z) if its footprint (padded) is free; marks it taken */
    const put = (k: string, x: number, z: number, yaw: number, s = 1, o: Partial<Item> = {}, pad = 0.015, check = true): boolean => {
      const [w, d] = SIZE[k]!;
      const hx = (w * U * s) / 2 + pad;
      const hz = (d * U * s) / 2 + pad;
      if (check && !occ.free(x, z, hx, hz, yaw)) return false;
      occ.fill(x, z, hx, hz, yaw);
      items.push({ k, x, y: 0, z, yaw, s, ...o });
      return true;
    };
    const toStreet = (side: number): number => (side > 0 ? Math.PI : 0);
    /** where a prop of kind k stands with its back to the wall `depth` past FACE (facing the street) */
    const wallZ = (side: number, depth: number, k: string, s = 1): number => side * (FACE + depth - WALL_GAP - (SIZE[k]![1] * U * s) / 2 - 0.012);
    /** a heading for a person (0 faces +x) that looks along (dx, dz) */
    const look = (dx: number, dz: number): number => Math.atan2(-dz, dx);
    const litter = (x: number, z: number, n: number, spread: number): void => {
      for (let i = 0; i < n; i++) {
        const k = pick(['litter_paper', 'litter_cup', 'litter_cup', 'litter_card', 'litter_can', 'litter_ball', 'litter_ball']);
        // litter lies where it falls: it may lie under feet, so only walls and props keep it out
        items.push({ k, x: x + r(-spread, spread), y: 0.004, z: z + r(-spread * 0.5, spread * 0.5), yaw: r(0, 6.28), s: k === 'litter_paper' || k === 'litter_card' ? r(0.5, 0.8) : r(0.8, 1.2) });
      }
    };

    // ---- scenes ---------------------------------------------------------------------------------
    /** bags thrown out for collection: a heap, a few slumped on top, a box and a can or two */
    const bagPile = (x: number, z: number, side: number, big: boolean): number => {
      let n = 0;
      const count = big ? Math.floor(r(5, 10)) : Math.floor(r(2, 5));
      const base: Item[] = [];
      for (let i = 0; i < count * 3 && n < count; i++) {
        const bx = x + r(-0.45, 0.45) * (big ? 1.4 : 0.8);
        const bz = z + r(-0.12, 0.12);
        const s = r(0.78, 1.18);
        if (put('trashbag', bx, bz, r(0, 6.28), s, { tx: r(-0.2, 0.2), tz: r(-0.2, 0.2) }, -0.04)) {
          n++;
          base.push(items[items.length - 1]!);
        }
      }
      // a few more thrown on top of the heap, sunk into the ones below
      const top = big ? Math.floor(r(1, 4)) : rand() < 0.4 ? 1 : 0;
      for (let i = 0; i < top && base.length > 1; i++) {
        const a = pick(base);
        items.push({ k: 'trashbag', x: a.x + r(-0.06, 0.06), y: 0.17 * a.s, z: a.z + r(-0.04, 0.04), yaw: r(0, 6.28), s: r(0.7, 1.0), tx: r(-0.5, 0.5), tz: r(-0.5, 0.5) });
      }
      if (rand() < 0.5) put('cardboard', x + r(-0.5, 0.5), z + r(-0.08, 0.08), r(0, 6.28), r(0.85, 1.2));
      if (rand() < 0.35) put(rand() < 0.5 ? 'trash_can' : 'trash_can_rust', x + r(-0.6, 0.6), z, toStreet(side) + r(-0.8, 0.8));
      litter(x, z + side * 0.05, Math.floor(r(2, 6)), 0.55);
      return n;
    };
    /** a shopfront: an A-frame or a chalkboard out front, a planter, chairs and a crate, cans by the door */
    const shopFront = (x: number, side: number, depth: number): void => {
      const board = rand() < 0.5 ? 'chalkboard' : 'wet_sign';
      if (rand() < 0.55 && depth > 0.3) put(board, x + r(-0.3, 0.3), wallZ(side, depth, board) + side * r(-0.12, 0), toStreet(side) + r(-0.5, 0.5), r(0.9, 1.05));
      if (rand() < 0.5) put('planter', x + r(-0.8, 0.8), wallZ(side, depth, 'planter'), toStreet(side) + r(-0.08, 0.08), r(0.85, 1.1));
      if (depth > 0.4 && rand() < 0.45) {
        const cx = x + r(-0.7, 0.7);
        if (put('chair', cx, wallZ(side, depth, 'chair') + side * r(-0.05, 0), toStreet(side) + r(-0.9, 0.9))) {
          const k = rand() < 0.5 ? 'plastic_crate' : 'propane';
          put(k, cx + r(0.3, 0.42) * (rand() < 0.5 ? -1 : 1), wallZ(side, depth, k), r(0, 6.28), 0.9);
          if (rand() < 0.5) put('chair', cx + r(-0.5, 0.5), wallZ(side, depth, 'chair'), r(0, 6.28));
        }
      }
      const can = rand() < 0.5 ? 'trash_can' : 'trash_can_rust';
      if (rand() < 0.45) put(can, x + r(-1, 1), wallZ(side, depth, can, 0.9), r(0, 6.28), 0.9);
      if (rand() < 0.25) put('barrel', x + r(-1, 1), wallZ(side, depth, 'barrel', 0.85), r(0, 6.28), 0.85);
      litter(x, side * (FACE + depth * 0.5), Math.floor(r(1, 4)), 0.6);
    };
    /** a delivery left on the kerb or by a wall: pallet, crates, plastic crates, boxes */
    const delivery = (x: number, z: number): void => {
      const yaw = r(-0.25, 0.25) + (rand() < 0.5 ? 0 : Math.PI / 2);
      if (put('pallet', x, z, yaw, 1)) {
        const stack = pick(['crate', 'plastic_crate', 'cardboard']);
        const n = stack === 'crate' ? 2 : 4;
        let y = 0.14 * U;
        for (let i = 0; i < n; i++) {
          items.push({ k: stack, x: x + r(-0.04, 0.04), y, z: z + r(-0.04, 0.04), yaw: yaw + r(-0.15, 0.15) + (stack === 'crate' ? Math.PI / 2 : 0), s: 1 });
          y += SIZE[stack]![2] * U * 0.98;
        }
      }
      for (let i = 0; i < 3; i++) put(pick(['plastic_crate', 'cardboard', 'cardboard', 'barrel']), x + r(-0.8, 0.8), z + r(-0.2, 0.2), r(0, 6.28), r(0.85, 1.1));
    };
    /** a street opened up: jersey barriers end to end with gaps, cones (one knocked over), a pallet */
    const works = (x: number, side: number): void => {
      const z = side * r(1.82, 1.98);
      const n = Math.floor(r(2, 4));
      let bx = x - (n * 0.72) / 2;
      for (let i = 0; i < n; i++) {
        put('barrier', bx + r(-0.03, 0.03), z + r(-0.05, 0.05), r(-0.12, 0.12) + (rand() < 0.5 ? 0 : Math.PI));
        bx += 1.57 * U + r(0.02, 0.22);
      }
      for (let i = 0; i < 6; i++) {
        const down = rand() < 0.18;
        put('cone', x + r(-1.8, 1.8), side * r(1.62, 2.22), r(0, 6.28), r(0.9, 1.05), down ? { tx: Math.PI / 2, y: 0.18 * U } : {});
      }
      if (rand() < 0.6) delivery(x + r(-1.6, 1.6), side * 2.0);
    };
    /** bikes locked to a row of racks, some racks empty, one bike lying against another */
    const bikes = (x: number, z: number, along: number): void => {
      const n = Math.floor(r(2, 5));
      for (let i = 0; i < n; i++) {
        const rx = x + (i - n / 2) * 0.36 * Math.cos(along) + r(-0.03, 0.03);
        const rz = z - (i - n / 2) * 0.36 * Math.sin(along) + r(-0.03, 0.03);
        const yawR = along + Math.PI / 2 + r(-0.05, 0.05);
        // a bike is locked alongside its hoop, so the hoop and the bike need room together
        const k = pick(['bike_teal', 'bike_black', 'bike_black', 'bike_red']);
        const bike = rand() < 0.72;
        const bx = rx + 0.06 * Math.cos(along);
        const bz = rz - 0.06 * Math.sin(along);
        const by = yawR + (rand() < 0.5 ? 0 : Math.PI) + r(-0.08, 0.08);
        if (bike && !occ.free(bx, bz, (SIZE[k]![0] * U) / 2, (SIZE[k]![1] * U) / 2, by)) continue;
        if (!put('bike_rack', rx, rz, yawR, 1, {}, 0.03)) continue;
        if (bike) put(k, bx, bz, by, r(0.95, 1.03), { tx: r(-0.1, 0.1) }, 0, false);
      }
    };
    /** newspaper boxes in a ragged row, a mailbox, a utility cabinet */
    const boxes = (x: number, z: number, side: number): void => {
      const n = Math.floor(r(1, 4));
      let bx = x;
      for (let i = 0; i < n; i++) {
        put(pick(['news_red', 'news_blue', 'news_yellow', 'news_blue']), bx, z + r(-0.03, 0.03), toStreet(side) + r(-0.14, 0.14));
        bx += 0.48 * U + r(0.01, 0.08);
      }
      if (rand() < 0.5) put('mailbox', bx + 0.1, z, toStreet(side) + r(-0.1, 0.1));
      if (rand() < 0.4) put(rand() < 0.5 ? 'utility_box' : 'utility_box_wide', x - 0.4, z, toStreet(side) + r(-0.05, 0.05));
    };

    // ---- the canyon, both sides, from end to end -------------------------------------------------
    const nearCross = (x: number, m: number): boolean => CROSS_STREET_X.some((sx) => Math.abs(x - sx) < CROSS_HALF + m);
    let cart: { x: number; z: number; side: number } | null = null;
    for (const side of [1, -1]) {
      let x = x0 + 4 + r(0, 2);
      while (x < x1 - 4) {
        const step = high ? r(1.1, 2.4) : r(2.2, 3.8);
        x += step;
        if (nearCross(x, 0.35)) continue;
        const depth = Math.min(face(side, x), 99) - FACE;
        const plaza = inPlaza(x, side * (FACE + 0.3));
        const roll = rand();
        if (!plaza && depth > 0.12 && depth < 4.2) {
          // a frontage with room in front of it: what shops and buildings put out
          if (roll < 0.34) bagPile(x, wallZ(side, depth, 'trashbag'), side, rand() < 0.4);
          else if (roll < 0.72) shopFront(x, side, Math.min(depth, 0.9));
          else if (roll < 0.84) boxes(x, wallZ(side, depth, 'news_blue'), side);
          else if (roll < 0.94 && depth > 1.0) bikes(x, side * (FACE + 0.5), 0);
          else { const k = pick(['utility_box', 'utility_box_wide', 'aircon_rust']); put(k, x, wallZ(side, depth, k), toStreet(side)); }
        } else if (plaza && roll < (high ? 0.85 : 0.45)) {
          // the plazas: bikes, boxes and a planter in whatever gaps the trees, benches and cafe leave
          const p = plazas.find((q) => x >= q.x0 && x <= q.x1 && (q.z0 + q.z1) * side > 0);
          for (let t = 0; p && t < (high ? 2 : 1); t++) {
            const zz = side * (FACE + r(0.25, Math.min(p.z1 - p.z0, 3.4) - 0.25));
            const pr = rand();
            if (pr < 0.35) bikes(x, zz, r(-0.3, 0.3));
            else if (pr < 0.6) boxes(x, zz, side);
            else if (pr < 0.8) put('planter', x, zz, r(-0.2, 0.2) + toStreet(side));
            else bagPile(x, zz, side, false);
          }
        }
        // the parking lane where no car is parked: bags at the kerb, deliveries, roadworks, bikes at the kerb
        for (let t = 0; t < (high && rand() < 0.5 ? 2 : 1); t++) {
          const kx = x + (t ? r(-1.6, -0.6) : r(-0.4, 0.4));
          const gap = rand() * (high ? 1 : 1.8);
          // bags come out in heaps by some doors and not at all by others
          if (gap < 0.2) bagPile(kx, side * r(2.04, 2.2), side, rand() < 0.4);
          else if (gap < 0.5) delivery(kx, side * r(1.85, 2.05));
          else if (gap < 0.57) works(kx, side);
          else if (gap < 0.66) {
            const k = pick(['bike_black', 'bike_teal', 'bike_red', 'bike_black']);
            put(k, kx, side * r(2.12, 2.18), r(-0.1, 0.1) + (rand() < 0.5 ? 0 : Math.PI), r(0.95, 1.03), { tx: side * r(0.05, 0.14) });
          } else if (gap < 0.8) {
            const k = pick(['cardboard', 'cardboard', 'plastic_crate', 'tyre', 'trash_can_rust', 'barrel']);
            put(k, kx, side * r(2.05, 2.18), r(0, 6.28), r(0.85, 1.1), k === 'tyre' && rand() < 0.6 ? { tx: Math.PI / 2, y: 0.08 * U } : {});
          }
        }
        // litter in the gutter, everywhere
        if (high || rand() < 0.4) litter(x, side * r(2.16, 2.27), Math.floor(r(1, high ? 5 : 2)), 0.9);
        // behind a plaza that opens onto an empty lot: a construction site's hoarding (once per run)
        if (depth > 4.6 && rand() < 0.5) {
          const hz = side * (FACE + 3.75);
          let hx = x;
          for (let i = 0; i < 3; i++) {
            const k = rand() < 0.5 ? 'hoarding_a' : 'hoarding_b';
            if (face(side, hx) - FACE < 4.4 || nearCross(hx, 1)) break;
            if (!put(k, hx, hz + r(-0.03, 0.03), toStreet(side) + r(-0.05, 0.05))) break;
            hx += 2.4 * U + r(-0.02, 0.01);
          }
          if (rand() < 0.6) put('cone', x + r(-0.5, 1.5), hz - side * 0.25, r(0, 6.28));
          if (rand() < 0.5) put('tyre', x + r(-0.5, 1.5), hz - side * 0.2, r(0, 6.28), 1, { tx: Math.PI / 2, y: 0.08 * U });
        }
        // the coffee cart: on the first deep plaza near the middle of the canyon, a queue in front of it
        if (!cart && plaza && x > -12 && x < 30) {
          const p = plazas.find((q) => x >= q.x0 && x <= q.x1 && (q.z0 + q.z1) * side > 0);
          if (p && p.z1 - p.z0 > 2.0) {
            const cz = side * (FACE + 0.55);
            for (const dx of [0, 0.6, -0.6, 1.2, -1.2]) {
              if (put('coffee_cart', x + dx, cz, toStreet(side), 1, {}, 0.04)) { cart = { x: x + dx, z: cz, side }; break; }
            }
          }
        }
      }
    }

    // ---- window and through-wall air conditioners up the canyon walls, above the walkers' heads (HIGH) ---
    if (high) {
      for (const f of footprints) {
        const fz = Math.abs(f.z) - f.hz;
        if (fz > FACE + 1.5 || f.x < x0 + 2 || f.x > x1 - 2 || (f.h ?? 0) < 3.5) continue;
        const side = Math.sign(f.z);
        const n = Math.floor(f.hx * 2 * r(0.4, 1.1));
        for (let i = 0; i < n; i++) {
          const floor = 1 + Math.floor(rand() * Math.min(5, Math.floor((f.h ?? 0) / 1.1) - 2));
          const y = 0.8 + floor * 1.1 - 0.36 + r(-0.03, 0.03);
          const ax = f.x + r(-f.hx + 0.25, f.hx - 0.25);
          items.push({ k: rand() < 0.6 ? 'aircon_rust' : 'aircon', x: ax, y, z: side * (fz - 0.09), yaw: toStreet(side) + r(-0.04, 0.04), s: r(0.8, 0.95) });
        }
      }
    }

    // ---- a sidewalk shed: scaffold over the pavement of a block being repointed (walkers pass under) ---
    const shedLots = footprints
      .filter((f) => Math.abs(Math.abs(f.z) - f.hz - FACE) < 0.03 && f.hx > 1.2 && f.x > -16 && f.x < 26)
      .sort((a, b) => Math.abs(a.x - 4) - Math.abs(b.x - 4))
      .slice(0, high ? 2 : 1);
    const BAY = 2.55 * U;
    for (const f of shedLots) {
      const side = Math.sign(f.z);
      const n = Math.floor((2 * f.hx - 0.2) / BAY);
      const sx0 = f.x - (n * BAY) / 2 + BAY / 2;
      const zc = side * (FACE - (0.95 * U) / 2 + 0.01);
      for (let i = 0; i < n; i++) {
        put('scaffold', sx0 + i * BAY, zc, toStreet(side), 1, {}, 0, false);
      }
      // the site's leavings at its foot, against the wall between the standards
      for (let i = 0; i < 3; i++) {
        const k = pick(['cone', 'plastic_crate', 'cardboard', 'trashbag']);
        put(k, sx0 + r(-0.3, n * BAY), side * (FACE - 0.08), r(0, 6.28), 0.9, {}, 0, false);
      }
      this.hydrantsAvoid.push({ x0: f.x - f.hx, x1: f.x + f.hx, side });
    }

    // ---- what CityStreet used to draw as primitives: hydrants and bins, now the real thing ----------
    for (const h of this.input.hydrants) if (!this.hydrantsAvoid.some((a) => Math.sign(h.z) === a.side && h.x > a.x0 - 0.2 && h.x < a.x1 + 0.2)) items.push({ k: rand() < 0.6 ? 'hydrant_aged' : 'hydrant', x: h.x, y: 0, z: Math.sign(h.z) * (CURB + 0.08), yaw: r(-0.6, 0.6) + (h.z > 0 ? Math.PI : 0), s: 0.95 });
    for (const b of this.input.bins) {
      items.push({ k: rand() < 0.5 ? 'trash_can' : 'trash_can_rust', x: b.x, y: 0, z: b.z, yaw: r(0, 6.28), s: 0.82 });
      if (rand() < 0.5) items.push({ k: 'trashbag', x: b.x + r(0.18, 0.26) * (rand() < 0.5 ? 1 : -1), y: 0, z: b.z, yaw: r(0, 6.28), s: r(0.7, 0.95), tx: r(-0.3, 0.3) });
    }

    // ---- people: the queue at the cart, waiting at the bus shelters, a smoke outside --------------------
    let group = 900;
    if (cart) {
      const { x, z, side } = cart;
      const n = high ? 4 : 2;
      for (let i = 0; i < n; i++) {
        // a ragged line coming off the cart's serving side, toward the plaza's open end
        const px = x - 0.55 - i * 0.36 + r(-0.05, 0.05);
        const pz = z + side * (0.34 + r(-0.06, 0.08) + i * 0.03);
        if (!occ.free(px, pz, 0.12, 0.12)) continue;
        this.stands.push({ x: px, z: pz, yaw: look(x - px, z - pz) + r(-0.3, 0.3), mood: rand() < 0.35 ? 'phone' : 'idle' });
        occ.circle(px, pz, 0.14);
      }
      this.steamAt.push({ x: x + 0.25, y: 1.75 * U, z, k: 1 });
    }
    for (const s of this.input.shelters) {
      if (rand() < (high ? 0.15 : 0.5)) continue;
      group++;
      const n = rand() < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const px = s.x + r(-0.35, 0.35);
        const pz = s.z - Math.sign(s.z) * r(0.1, 0.16);
        // waiting: looking up the road the bus comes from
        this.stands.push({ x: px, z: pz, yaw: (s.z > 0 ? Math.PI : 0) + r(-0.5, 0.5), mood: n > 1 ? 'chat' : rand() < 0.5 ? 'phone' : 'idle', ...(n > 1 ? { group } : {}) });
      }
    }
    // a pair by a doorway on a frontage set back enough to stand without blocking the lanes
    for (let i = 0, made = 0; i < 80 && made < (high ? 7 : 3); i++) {
      const side = rand() < 0.5 ? 1 : -1;
      const x = r(-30, 46);
      const depth = face(side, x) - FACE;
      if (depth < 0.55 || depth > 4 || nearCross(x, 0.6)) continue;
      const z = side * (FACE + Math.min(depth, 1.2) * 0.5);
      if (!occ.free(x, z, 0.32, 0.16)) continue;
      occ.fill(x, z, 0.32, 0.16);
      group++;
      made++;
      const solo = rand() < 0.35;
      this.stands.push({ x: x - (solo ? 0 : 0.2), z, yaw: solo ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) + r(-0.6, 0.6) : 0, mood: solo ? 'phone' : 'chat', ...(solo ? {} : { group }) });
      if (!solo) this.stands.push({ x: x + 0.2, z, yaw: Math.PI, mood: 'chat', group });
      litter(x, z, 2, 0.3);
    }

    // ---- roofs of the nearer blocks: tanks, plant, dishes, antennas, vents ------------------------------
    void this.planRoofs(rand);

    // ---- wires across the cross streets, house to house, well above the traffic ------------------------
    if (high) {
      for (const sx of CROSS_STREET_X) {
        if (sx < -40 || sx > 56) continue;
        for (const side of [1, -1]) {
          const runs = Math.floor(r(1, 4));
          for (let i = 0; i < runs; i++) {
            const z = side * r(3.4, 10);
            // between the walls either side of the street at this z
            const wa = footprints.find((f) => f.x < sx && Math.abs(f.z - z) < f.hz && Math.abs(f.x + f.hx - sx) < 4);
            const wb = footprints.find((f) => f.x > sx && Math.abs(f.z - z) < f.hz && Math.abs(f.x - f.hx - sx) < 4);
            if (!wa || !wb) continue;
            const y0 = r(2.4, 4.4);
            const a = new Vector3(wa.x + wa.hx + 0.02, y0, z);
            const b = new Vector3(wb.x - wb.hx - 0.02, y0 + r(-0.5, 0.5), z + r(-0.6, 0.6));
            const n = rand() < 0.5 ? 2 : 1;
            for (let k = 0; k < n; k++) this.cableRuns.push({ a: a.clone().setY(a.y - k * 0.08), b: b.clone().setY(b.y - k * 0.07), sag: r(0.12, 0.4) });
          }
        }
      }
    }

    // ---- paper blowing along the pavements (HIGH) -----------------------------------------------------
    if (high) {
      for (let i = 0; i < 14; i++) {
        const side = rand() < 0.5 ? 1 : -1;
        this.paperAt.push({ x: r(-24, 40), z: side * r(2.0, 2.7), dir: rand() < 0.75 ? 1 : -1, len: r(2.5, 6) });
      }
    }
  }

  private roofPlan: Promise<void> | null = null;

  /** rooftop props, from the measured flat cells of each block module (public/models/city-props/roofs.json) */
  private planRoofs(rand: () => number): Promise<void> {
    this.roofPlan = (async () => {
      const roofs = await fetch(asset('/models/city-props/roofs.json')).then((r) => r.json() as Promise<Record<string, { n: number; cells: [number, number, number][] }>>);
      const manifest = await fetch(asset('/models/city-kit/manifest.json'), { cache: 'no-cache' }).then((r) => r.json() as Promise<{ modules: { id: string; footprint: [number, number]; height: number }[] }>);
      const r = (a: number, b: number): number => a + (b - a) * rand();
      const kinds = this.high
        ? [['water_tank', 0.5], ['rooftop_unit', 1.8], ['aircon', 1.4], ['aircon_rust', 1.0], ['roof_vent', 2.2], ['dish', 0.6], ['antenna', 0.35]] as const
        : [['water_tank', 0.45], ['rooftop_unit', 1.0], ['roof_vent', 1.0]] as const;
      for (const li of this.input.roofLots) {
        const lot = this.input.lots[li]!;
        const roof = roofs[lot.moduleId];
        const mod = manifest.modules.find((m) => m.id === lot.moduleId);
        if (!roof || !mod || !roof.cells.length) continue;
        const [fw, fd] = mod.footprint;
        const rise = lot.rise ?? 1;
        const fit = Math.min(lot.w / fw, lot.d / fd, lot.h / rise / mod.height);
        const cell = new Map<number, number>();
        for (const [i, j, y] of roof.cells) cell.set(j * roof.n + i, y);
        const taken = new Set<number>();
        const c = Math.cos(lot.yaw);
        const s = Math.sin(lot.yaw);
        const want = Math.floor(r(2, this.high ? 7 : 3));
        for (let attempt = 0, placed = 0; attempt < 40 && placed < want; attempt++) {
          let roll = rand() * kinds.reduce((a, k) => a + k[1], 0);
          let k: string = kinds[0][0];
          for (const [name, w] of kinds) { roll -= w; if (roll <= 0) { k = name; break; } }
          const [w, d] = SIZE[k]!;
          const sc = r(0.85, 1.1);
          // the prop's footprint in cells (module space: a cell is fw/n by fd/n, the module scaled by fit)
          const ci = Math.ceil(((w * U * sc) / (fw * fit)) * roof.n * 0.5) + 1;
          const cj = Math.ceil(((d * U * sc) / (fd * fit)) * roof.n * 0.5) + 1;
          const rad = Math.max(ci, cj);
          const [i0, j0, y0] = roof.cells[Math.floor(rand() * roof.cells.length)]!;
          let ok = true;
          for (let dj = -rad; dj <= rad && ok; dj++) {
            for (let di = -rad; di <= rad; di++) {
              const key = (j0 + dj) * roof.n + i0 + di;
              const y = cell.get(key);
              if (y === undefined || Math.abs(y - y0) > 0.003 || taken.has(key)) { ok = false; break; }
            }
          }
          if (!ok) continue;
          for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) taken.add((j0 + dj) * roof.n + i0 + di);
          // module space to the city group: scale by fit, turn by the lot's yaw (three's R_y), move to the lot
          const mx = ((i0 + 0.5) / roof.n - 0.5) * fw * fit;
          const mz = ((j0 + 0.5) / roof.n - 0.5) * fd * fit;
          const x = lot.x + mx * c + mz * s;
          const z = lot.z - mx * s + mz * c;
          const y = y0 * mod.height * fit * rise;
          const yaw = lot.yaw + (Math.floor(rand() * 4) * Math.PI) / 2 + r(-0.12, 0.12);
          this.items.push({ k, x, y, z, yaw, s: sc, roof: true });
          placed++;
          if (k === 'roof_vent' && rand() < 0.4) this.steamAt.push({ x, y: y + 1.05 * U * sc, z, k: 0.6 });
        }
      }
    })().catch((e: unknown) => console.warn('CityLife: no roof props', e));
    return this.roofPlan;
  }

  // ---- building ---------------------------------------------------------------------------------
  private async load(): Promise<void> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const base = '/models/city-props/';
    const [near, lean] = await Promise.all([
      this.high ? loader.loadAsync(asset(`${base}props.glb`)) : Promise.resolve(null),
      loader.loadAsync(asset(`${base}props-lean.glb`)),
    ]);
    await this.roofPlan;
    const geoms = (gltf: typeof lean | null): Map<string, BufferGeometry> => {
      const map = new Map<string, BufferGeometry>();
      gltf?.scene.updateMatrixWorld(true);
      gltf?.scene.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        const g = dequantized(m.geometry).applyMatrix4(m.matrixWorld);
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        map.set(m.name.replace(/_n$/, '').replace(/\.\d+$/, ''), g);
      });
      return map;
    };
    const nearG = geoms(near);
    const leanG = geoms(lean);
    this.disposables.push(...nearG.values(), ...leanG.values());

    // the shared atlas material, lit by the street lamps the same way the road and paving are
    const tex = (file: string, srgb: boolean): Texture => {
      const t = new TextureLoader().load(asset(`${base}${file}`));
      t.flipY = false;
      t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
      t.anisotropy = 4;
      this.disposables.push(t);
      return t;
    };
    const material = new MeshStandardMaterial({
      map: tex('atlas-color.webp', true),
      roughnessMap: tex('atlas-orm.webp', false),
      roughness: 1,
      metalness: 0.08,
      ...(this.high ? { normalMap: tex('atlas-normal.webp', false) } : {}),
    });
    litByLamps(material, this.group.position, this.high ? 3 : 6);
    KitCity.adopt(material, 0.5);
    this.disposables.push(material);

    // chunk the items: the street in 12-unit runs, the roofs in runs of their own
    const CH = this.high ? 16 : 22;
    const buckets = new Map<string, Item[]>();
    for (const it of this.items) {
      if (!this.high && it.k.startsWith('litter') && it.x % 3 > 1) continue;
      // phones draw the roofs with the street below them (fewer, larger draws)
      const key = this.high ? `${it.roof ? 'r' : 's'}${Math.floor(it.x / (it.roof ? CH * 1.5 : CH))}` : `s${Math.floor(it.x / CH)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(it);
    }
    const m4 = new Matrix4();
    const q = new Quaternion();
    const qt = new Quaternion();
    const e = new Euler();
    const p = new Vector3();
    const sc = new Vector3();
    const cableUv = [0.5, 0.5];
    const build = (list: Item[], src: Map<string, BufferGeometry>, cables: boolean): BufferGeometry | null => {
      const parts: BufferGeometry[] = [];
      for (const it of list) {
        const g = src.get(it.k);
        if (!g) continue;
        q.setFromAxisAngle(Y, it.yaw);
        if (it.tx || it.tz) q.multiply(qt.setFromEuler(e.set(it.tx ?? 0, 0, it.tz ?? 0)));
        m4.compose(p.set(it.x, it.y, it.z), q, sc.setScalar(U * it.s));
        parts.push(g.clone().applyMatrix4(m4));
      }
      if (cables) {
        for (const c of this.cableRuns) parts.push(cableGeometry(c.a, c.b, c.sag, cableUv));
      }
      if (!parts.length) return null;
      const merged = mergeGeometries(parts, false);
      parts.forEach((g) => g.dispose());
      return merged;
    };
    const uvOf = leanG.get('cable')?.attributes.uv;
    if (uvOf) { cableUv[0] = uvOf.getX(0); cableUv[1] = uvOf.getY(0); }
    let cablesDone = false;
    for (const [key, list] of buckets) {
      const roof = key.startsWith('r') || (!this.high && list.every((i) => i.roof));
      // the wires go with the first street chunk (they are a few hundred triangles in all)
      const withCables = !roof && !cablesDone && this.cableRuns.length > 0;
      if (withCables) cablesDone = true;
      const nearGeo = this.high ? build(list, nearG, withCables) : null;
      const leanGeo = build(list, leanG, withCables && !this.high);
      const main = nearGeo ?? leanGeo;
      if (!main) continue;
      const mk = (g: BufferGeometry): Mesh => {
        g.computeBoundingSphere();
        const mesh = new Mesh(g, material);
        mesh.castShadow = false;
        mesh.receiveShadow = !roof && this.high;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.disposables.push(g);
        return mesh;
      };
      const nearMesh = mk(main);
      const leanMesh = nearGeo && leanGeo ? mk(leanGeo) : null;
      if (leanMesh) leanMesh.visible = false;
      const sph = main.boundingSphere!;
      const tris = (g: BufferGeometry | null): number => (g ? (g.index ? g.index.count : g.attributes.position!.count) / 3 : 0);
      this.chunks.push({ near: nearMesh, lean: leanMesh, cx: sph.center.x, cy: sph.center.y, cz: sph.center.z, roof, tris: [tris(main), tris(leanGeo)] });
    }
    this.stats.items = this.items.length;
    this.stats.chunks = this.chunks.length;

    this.buildSteam();
    if (this.high && this.paperAt.length) this.buildPaper(nearG.get('litter_paper'), material);
  }

  private buildSteam(): void {
    if (!this.steamAt.length) return;
    const PUFFS = this.high ? 18 : 8;
    const pos: number[] = [];
    const phase: number[] = [];
    const k: number[] = [];
    const rand = mulberry32(2291);
    for (const s of this.steamAt) {
      for (let i = 0; i < PUFFS; i++) {
        pos.push(s.x + (rand() - 0.5) * 0.05, s.y, s.z + (rand() - 0.5) * 0.05);
        phase.push((i + rand() * 0.8) / PUFFS);
        k.push(s.k);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('aPhase', new Float32BufferAttribute(phase, 1));
    g.setAttribute('aK', new Float32BufferAttribute(k, 1));
    const map = glowTexture();
    this.steam = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uMap: { value: map } },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        attribute float aK;
        uniform float uTime;
        varying float vAge;
        varying float vK;
        void main() {
          float age = fract(aPhase + uTime * (0.16 + 0.05 * aK));
          vAge = age;
          vK = aK;
          vec3 p = position;
          p.y += age * (0.55 + 0.6 * aK);
          p.x += age * age * 0.35 + sin(age * 7.0 + aPhase * 40.0) * 0.04 * age;
          p.z += sin(age * 5.0 + aPhase * 17.0) * 0.05 * age;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = min((8.0 + age * (34.0 + 30.0 * aK)) * (260.0 / -mv.z), 300.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying float vAge;
        varying float vK;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * (1.0 - vAge) * smoothstep(0.0, 0.1, vAge) * (0.12 + 0.12 * vK);
          gl_FragColor = vec4(vec3(0.86, 0.78, 0.7) * a, a);
        }`,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    const pts = new Points(g, this.steam);
    pts.frustumCulled = false;
    this.group.add(pts);
    this.disposables.push(g, this.steam, map);
  }

  /** sheets of newspaper skittering along the pavement in the wind, lifting and tumbling (HIGH) */
  private buildPaper(geo: BufferGeometry | undefined, base: MeshStandardMaterial): void {
    if (!geo) return;
    const n = this.paperAt.length;
    const g = geo.clone().scale(U, U, U);
    const mesh = new InstancedMesh(g, base.clone(), n);
    const ph = new Float32Array(n * 4);
    this.paperAt.forEach((pa, i) => {
      mesh.setMatrixAt(i, new Matrix4().makeTranslation(pa.x, 0, pa.z));
      ph.set([Math.random() * 10, pa.dir, pa.len, 0.6 + Math.random() * 0.6], i * 4);
    });
    g.setAttribute('aPaper', new InstancedBufferAttribute(ph, 4));
    const mat = mesh.material as MeshStandardMaterial;
    this.paper = mat;
    const uTime = { value: 0 };
    mat.userData.uTime = uTime;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uPaperTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aPaper;\nuniform float uPaperTime;')
        .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
          {
            // a gust carries it a few metres, it settles, the next gust takes it on
            float t = uPaperTime * 0.11 * aPaper.w + aPaper.x;
            float cyc = fract(t);
            float gust = smoothstep(0.0, 0.5, cyc) * (1.0 - smoothstep(0.5, 1.0, cyc));
            float a = gust * 9.0 + aPaper.x;
            float ca = cos(a), sa = sin(a);
            transformed.yz = mat2(ca, -sa, sa, ca) * transformed.yz * (0.4 + 0.6 * (1.0 - gust)) + vec2(0.0, 0.0);
            transformed.xz = mat2(cos(aPaper.x), -sin(aPaper.x), sin(aPaper.x), cos(aPaper.x)) * transformed.xz;
            transformed.x += aPaper.y * (cyc - 0.5) * aPaper.z;
            transformed.y += gust * gust * 0.22 + 0.01;
            transformed.z += sin(t * 6.2832 + aPaper.x) * 0.08;
          }`);
    };
    mat.customProgramCacheKey = () => 'city-paper';
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    this.group.add(mesh);
    this.disposables.push(g, mat, mesh);
  }

  /** `eye` in world space: chunks past `far` are hidden, nearer than `nearDist` get the detailed props */
  update(time: number, eye?: Vector3): void {
    if (this.steam) this.steam.uniforms.uTime!.value = time;
    if (this.paper) (this.paper.userData.uTime as { value: number }).value = time;
    if (!eye) return;
    this.eye.copy(eye).sub(this.group.parent ? this.group.parent.position : this.group.position);
    let draws = 0;
    let tris = 0;
    for (const c of this.chunks) {
      const d = Math.hypot(c.cx - this.eye.x, (c.cy - this.eye.y) * 0.5, c.cz - this.eye.z);
      const far = c.roof ? this.far * 1.5 : this.far;
      const show = d < far;
      const detail = show && (!c.lean || d < this.nearDist);
      c.near.visible = detail;
      if (c.lean) c.lean.visible = show && !detail;
      if (show) { draws++; tris += detail ? c.tris[0] : c.tris[1]; }
    }
    this.stats.draws = draws;
    this.stats.tris = tris;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

const Y = new Vector3(0, 1, 0);

/** a sagging wire between two points, as a thin six-sided tube on the atlas's black texel */
function cableGeometry(a: Vector3, b: Vector3, sag: number, uv: number[]): BufferGeometry {
  const SEG = 14;
  const SIDES = 4;
  const R = 0.012;
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const pt = (t: number): Vector3 => new Vector3().lerpVectors(a, b, t).setY(a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t));
  const dir = new Vector3().subVectors(b, a).normalize();
  const side = new Vector3().crossVectors(dir, Y).normalize();
  const up = new Vector3().crossVectors(side, dir).normalize();
  for (let i = 0; i <= SEG; i++) {
    const c = pt(i / SEG);
    for (let k = 0; k < SIDES; k++) {
      const ang = (k / SIDES) * Math.PI * 2;
      const n = side.clone().multiplyScalar(Math.cos(ang)).addScaledVector(up, Math.sin(ang));
      pos.push(c.x + n.x * R, c.y + n.y * R, c.z + n.z * R);
      nor.push(n.x, n.y, n.z);
      uvs.push(uv[0]!, uv[1]!);
    }
  }
  for (let i = 0; i < SEG; i++) {
    for (let k = 0; k < SIDES; k++) {
      const a0 = i * SIDES + k;
      const a1 = i * SIDES + ((k + 1) % SIDES);
      idx.push(a0, a0 + SIDES, a1, a1, a0 + SIDES, a1 + SIDES);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/**
 * The props take the streetlamps' light the way the road and paving do (materials/Streets.ts
 * `lampField`, read-only here): each lamp head a cos^2 downlight with inverse-square falloff, the
 * three nearest columns asked, in the lamps' warm sodium colour.
 */
function litByLamps(material: MeshStandardMaterial, origin: Vector3, k: number): void {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uLOrigin = { value: origin };
    shader.uniforms.uLamps = lampField.heads;
    shader.uniforms.uLampInfo = lampField.info;
    shader.uniforms.uLampLevel = lampField.level;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLOrigin;\nvarying vec3 vLW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLW = (modelMatrix * vec4(position, 1.0)).xyz - uLOrigin;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec3 vLW;
        uniform vec2 uLamps[${lampField.heads.value.length}];
        uniform vec4 uLampInfo;
        uniform float uLampLevel;
        vec3 propLamps(vec3 P, vec3 N, vec3 albedo) {
          vec3 sum = vec3(0.0);
          float col = floor((P.x - uLampInfo.x) / uLampInfo.y);
          for (int ci = -1; ci <= 1; ci++) {
            float cc = col + float(ci);
            if (cc < 0.0 || cc >= uLampInfo.z) continue;
            for (int sd = 0; sd < 2; sd++) {
              vec2 hp = uLamps[int(cc) * 2 + sd];
              vec3 L = vec3(hp.x, uLampInfo.w, hp.y) - P;
              float d2 = dot(L, L);
              vec3 Ln = L * inversesqrt(d2);
              // a little wrap, so a prop's sides facing the lamp still catch it
              float ndl = clamp(dot(N, Ln) * 0.8 + 0.2, 0.0, 1.0);
              float cone = 0.25 + 0.75 * Ln.y * Ln.y * step(0.0, Ln.y);
              sum += albedo * ndl * ${k.toFixed(1)} * cone / (d2 + 0.3);
            }
          }
          return sum * vec3(1.0, 0.74, 0.44) * uLampLevel;
        }`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        totalEmissiveRadiance += propLamps(vLW, inverseTransformDirection(normal, viewMatrix), diffuseColor.rgb);`);
  };
  material.customProgramCacheKey = () => 'city-life-props';
}

