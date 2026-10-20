import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HOME_CELL } from '../bake/cityGen.mjs';
import { glowTexture } from '../bake/CanvasTextures';
import { mulberry32 } from '../util';
import type { KitLot } from './KitCity';

/**
 * Yard details for the houses the flight passes over: every lot gets its own
 * draw from a long menu (foundation beds, flower borders, a vegetable patch, a
 * patio set or a pool, a shed, a swing set, a trampoline, a firepit, mowing
 * stripes, dry patches, leaf piles ...), each with its own sizes, positions and
 * colours, so no two yards match. Flat things are decals in one merged mesh; the
 * rest are a handful of instanced props; the lights are glow points.
 *
 * Coordinates are lot-local: u across the lot (world x), v from the street edge
 * of the lot toward the rear, in site units (one unit is about three metres).
 */

// ---- decal atlas -------------------------------------------------------------------

type Tile =
  | 'mulch' | 'flowers' | 'stripes' | 'blob' | 'veg' | 'patio' | 'water' | 'drive'
  | 'wood' | 'sand' | 'leaves' | 'firepit' | 'dots' | 'gravel' | 'kiddie';
const TILES: Tile[] = [
  'mulch', 'flowers', 'stripes', 'blob', 'veg', 'patio', 'water', 'drive',
  'wood', 'sand', 'leaves', 'firepit', 'dots', 'gravel', 'kiddie',
];
const TILE_PX = 128;
const COLS = 8;
const ROWS = 2;

function decalAtlas(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_PX * COLS;
  canvas.height = TILE_PX * ROWS;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  let seed = 4242;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const S = TILE_PX;

  TILES.forEach((tile, i) => {
    ctx.save();
    ctx.translate((i % COLS) * S, Math.floor(i / COLS) * S);
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.clip();
    const speckle = (n: number, rgb: string, rMin: number, rMax: number, a: number): void => {
      for (let k = 0; k < n; k++) {
        ctx.fillStyle = `rgba(${rgb},${a * (0.5 + rnd() * 0.5)})`;
        ctx.beginPath();
        ctx.arc(rnd() * S, rnd() * S, rMin + rnd() * (rMax - rMin), 0, Math.PI * 2);
        ctx.fill();
      }
    };
    /** a rounded slab with a feathered edge, so decals do not end in a hard rectangle */
    const slab = (inset: number, fill: string, radius: number): void => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(inset, inset, S - inset * 2, S - inset * 2, radius);
      ctx.fill();
    };
    switch (tile) {
      case 'mulch':
        slab(4, 'rgb(200,172,146)', 14);
        speckle(260, '90,66,48', 1, 3.4, 0.7);
        speckle(120, '235,210,185', 1, 2.4, 0.5);
        break;
      case 'flowers':
        // white blossoms and a few leaves: the quad's tint colours them
        for (let k = 0; k < 90; k++) {
          const x = 10 + rnd() * (S - 20), y = 10 + rnd() * (S - 20), r = 2 + rnd() * 3.4;
          ctx.fillStyle = 'rgba(255,255,255,0.95)';
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(120,120,120,0.9)';
          ctx.beginPath();
          ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'stripes':
        // mowing bands: light over dark; tint stays near white
        for (let y = 0; y < S; y += 16) {
          ctx.fillStyle = (y / 16) % 2 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.15)';
          ctx.fillRect(0, y, S, 16);
        }
        break;
      case 'blob': {
        const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        g.addColorStop(0, 'rgba(255,255,255,0.62)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.34)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
        speckle(40, '255,255,255', 4, 14, 0.12);
        break;
      }
      case 'veg':
        slab(5, 'rgb(86,58,40)', 6);
        for (let x = 14; x < S - 8; x += 17) {
          ctx.fillStyle = 'rgba(40,24,14,0.5)';
          ctx.fillRect(x - 5, 8, 3, S - 16);
          for (let y = 12; y < S - 12; y += 11) {
            ctx.fillStyle = `rgba(${70 + rnd() * 40},${130 + rnd() * 60},${50 + rnd() * 30},0.95)`;
            ctx.beginPath();
            ctx.arc(x + (rnd() - 0.5) * 3, y, 3.5 + rnd() * 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      case 'patio':
        slab(3, 'rgb(186,184,176)', 4);
        ctx.strokeStyle = 'rgba(70,68,62,0.8)';
        ctx.lineWidth = 2;
        for (let k = 1; k < 4; k++) {
          ctx.beginPath();
          ctx.moveTo(S * k / 4, 3);
          ctx.lineTo(S * k / 4, S - 3);
          ctx.moveTo(3, S * k / 4);
          ctx.lineTo(S - 3, S * k / 4);
          ctx.stroke();
        }
        speckle(60, '120,118,110', 1, 3, 0.25);
        break;
      case 'water':
        slab(3, 'rgb(220,220,212)', 12);
        ctx.fillStyle = 'rgb(46,150,196)';
        ctx.beginPath();
        ctx.roundRect(12, 12, S - 24, S - 24, 12);
        ctx.fill();
        for (let k = 0; k < 14; k++) {
          ctx.strokeStyle = `rgba(190,235,250,${0.25 + rnd() * 0.3})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const y = 20 + rnd() * (S - 40);
          ctx.moveTo(18 + rnd() * 20, y);
          ctx.quadraticCurveTo(S / 2, y + (rnd() - 0.5) * 14, S - 18 - rnd() * 20, y + (rnd() - 0.5) * 8);
          ctx.stroke();
        }
        break;
      case 'drive':
        slab(2, 'rgb(176,173,166)', 3);
        ctx.strokeStyle = 'rgba(60,58,54,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(2, S / 2);
        ctx.lineTo(S - 2, S / 2);
        ctx.stroke();
        speckle(40, '70,64,58', 3, 9, 0.18);
        break;
      case 'wood':
        for (let y = 0; y < S; y += 14) {
          const l = 0.85 + rnd() * 0.3;
          ctx.fillStyle = `rgb(${150 * l},${108 * l},${70 * l})`;
          ctx.fillRect(2, y, S - 4, 13);
          ctx.fillStyle = 'rgba(30,18,8,0.7)';
          ctx.fillRect(2, y + 13, S - 4, 1);
        }
        break;
      case 'sand':
        slab(4, 'rgb(112,80,52)', 6);
        slab(12, 'rgb(220,196,146)', 5);
        speckle(90, '186,160,110', 1, 2.6, 0.6);
        break;
      case 'leaves':
        for (let k = 0; k < 120; k++) {
          const cx = S / 2 + (rnd() + rnd() + rnd() - 1.5) * S * 0.36;
          const cy = S / 2 + (rnd() + rnd() + rnd() - 1.5) * S * 0.36;
          const hue = rnd();
          ctx.fillStyle = hue < 0.4 ? 'rgb(190,96,38)' : hue < 0.7 ? 'rgb(214,160,52)' : 'rgb(150,60,34)';
          ctx.beginPath();
          ctx.ellipse(cx, cy, 3 + rnd() * 3, 1.6 + rnd() * 1.6, rnd() * 3.14, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'firepit':
        ctx.fillStyle = 'rgb(34,30,28)';
        ctx.beginPath();
        ctx.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2);
        ctx.fill();
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2;
          const l = 110 + rnd() * 50;
          ctx.fillStyle = `rgb(${l},${l - 4},${l - 12})`;
          ctx.beginPath();
          ctx.arc(S / 2 + Math.cos(a) * S * 0.36, S / 2 + Math.sin(a) * S * 0.36, 8 + rnd() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'dots':
        // dandelions and clover: the tint picks yellow or white
        for (let k = 0; k < 60; k++) {
          ctx.fillStyle = `rgba(255,255,255,${0.7 + rnd() * 0.3})`;
          ctx.beginPath();
          ctx.arc(rnd() * S, rnd() * S, 1.4 + rnd() * 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'gravel':
        slab(5, 'rgb(158,152,142)', 8);
        speckle(240, '100,96,90', 1, 3, 0.7);
        speckle(180, '210,204,194', 1, 2.4, 0.6);
        break;
      case 'kiddie':
        ctx.fillStyle = 'rgb(240,200,60)';
        ctx.beginPath();
        ctx.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgb(80,170,220)';
        ctx.beginPath();
        ctx.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
    ctx.restore();
  });

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** UV rectangle of a tile, nudged half a texel in so neighbours never bleed. */
function tileUV(tile: Tile): [number, number, number, number] {
  const i = TILES.indexOf(tile);
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const e = 0.6 / (TILE_PX * COLS);
  const f = 0.6 / (TILE_PX * ROWS);
  return [
    col / COLS + e, 1 - (row + 1) / ROWS + f,
    (col + 1) / COLS - e, 1 - row / ROWS - f,
  ];
}

// ---- props -------------------------------------------------------------------------

function tinted<T extends BufferGeometry>(g: T, hex: string): T {
  const c = new Color(hex);
  const n = g.attributes.position!.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(arr, 3));
  return g;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string): BufferGeometry =>
  tinted(new BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed(), hex);
const cyl = (r: number, h: number, x: number, y: number, z: number, hex: string, seg = 8): BufferGeometry =>
  tinted(new CylinderGeometry(r, r, h, seg).translate(x, y, z).toNonIndexed(), hex);

function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  return g;
}

type PropKind = 'shrub' | 'hedge' | 'mailbox' | 'shed' | 'patioSet' | 'umbrellaSet' | 'bbq' | 'swing'
  | 'trampoline' | 'woodpile' | 'pot' | 'bench';

/** Prop geometry, modelled at site scale (a person would be ~0.55 tall), in neutral colours the instance tint shifts. */
function propGeometry(kind: PropKind): BufferGeometry {
  switch (kind) {
    case 'shrub':
      return tinted(new IcosahedronGeometry(0.5, 1).translate(0, 0.42, 0).toNonIndexed(), '#ffffff');
    case 'hedge':
      return tinted(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed(), '#ffffff');
    case 'mailbox':
      return merge([
        box(0.022, 0.2, 0.022, 0, 0.1, 0, '#5a4630'),
        box(0.075, 0.05, 0.1, 0, 0.225, 0, '#9aa3ad'),
        box(0.012, 0.045, 0.012, 0.045, 0.24, 0.02, '#c22a24'),
      ]);
    case 'shed':
      return merge([
        box(0.52, 0.28, 0.4, 0, 0.14, 0, '#d8d4c8'),
        // gable roof: two sloped slabs
        tinted(new BoxGeometry(0.6, 0.02, 0.24).rotateZ(0).translate(0, 0, 0).toNonIndexed(), '#33353c')
          .rotateX(0.5).translate(0, 0.36, 0.1),
        tinted(new BoxGeometry(0.6, 0.02, 0.24).toNonIndexed(), '#33353c').rotateX(-0.5).translate(0, 0.36, -0.1),
        box(0.12, 0.2, 0.01, 0.12, 0.1, 0.205, '#4a4c52'),
      ]);
    case 'patioSet':
      return merge([
        cyl(0.13, 0.012, 0, 0.115, 0, '#c9c5ba', 10),
        cyl(0.018, 0.11, 0, 0.055, 0, '#6a6a66', 6),
        ...[[0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]].flatMap(([x, z]) => [
          box(0.09, 0.012, 0.09, x!, 0.07, z!, '#b9b4a6'),
          box(0.09, 0.07, 0.012, x!, 0.105, z! + (z === 0 ? 0 : z! > 0 ? 0.04 : -0.04) + (z === 0 ? 0 : 0), '#b9b4a6'),
        ]),
      ]);
    case 'umbrellaSet':
      return merge([
        cyl(0.13, 0.012, 0, 0.115, 0, '#c9c5ba', 10),
        cyl(0.012, 0.36, 0, 0.18, 0, '#58585a', 5),
        tinted(new ConeGeometry(0.26, 0.09, 10).translate(0, 0.38, 0).toNonIndexed(), '#ffffff'),
        ...[[0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]].map(([x, z]) =>
          box(0.09, 0.012, 0.09, x!, 0.07, z!, '#b9b4a6')),
      ]);
    case 'bbq':
      return merge([
        cyl(0.055, 0.05, 0, 0.14, 0, '#1b1c1f', 10),
        tinted(new IcosahedronGeometry(0.057, 0).scale(1, 0.6, 1).translate(0, 0.17, 0).toNonIndexed(), '#222428'),
        box(0.012, 0.11, 0.012, 0.035, 0.055, 0.035, '#56585d'),
        box(0.012, 0.11, 0.012, -0.035, 0.055, -0.035, '#56585d'),
      ]);
    case 'swing': {
      const legs: BufferGeometry[] = [];
      for (const z of [-0.17, 0.17]) {
        for (const x of [-0.26, 0.26]) {
          legs.push(tinted(new BoxGeometry(0.018, 0.4, 0.018).rotateZ(x > 0 ? 0.22 : -0.22).translate(x * 0.55, 0.19, z).toNonIndexed(), '#8a8f98'));
        }
      }
      return merge([
        ...legs,
        box(0.6, 0.02, 0.02, 0, 0.38, -0.17, '#ffffff'),
        box(0.6, 0.02, 0.02, 0, 0.38, 0.17, '#ffffff'),
        box(0.015, 0.015, 0.34, -0.1, 0.38, 0, '#8a8f98'),
        box(0.015, 0.015, 0.34, 0.1, 0.38, 0, '#8a8f98'),
        box(0.07, 0.01, 0.045, -0.1, 0.1, 0, '#3a4a6a'),
        box(0.07, 0.01, 0.045, 0.1, 0.1, 0, '#3a4a6a'),
      ]);
    }
    case 'trampoline':
      return merge([
        cyl(0.34, 0.012, 0, 0.14, 0, '#15171c', 14),
        tinted(new CylinderGeometry(0.355, 0.355, 0.026, 14, 1, true).translate(0, 0.14, 0).toNonIndexed(), '#ffffff'),
        ...[0, 1, 2, 3, 4, 5].map((k) => {
          const a = (k / 6) * Math.PI * 2;
          return cyl(0.008, 0.14, Math.cos(a) * 0.33, 0.07, Math.sin(a) * 0.33, '#6a6e76', 4);
        }),
      ]);
    case 'woodpile':
      return merge(
        [[-0.06, 0.02], [0, 0.02], [0.06, 0.02], [-0.03, 0.055], [0.03, 0.055], [0, 0.09]].map(([x, y]) =>
          tinted(new CylinderGeometry(0.03, 0.03, 0.28, 6).rotateZ(Math.PI / 2).translate(0, y! + 0.03, x!).toNonIndexed(), '#9a7348')),
      );
    case 'pot':
      return merge([
        cyl(0.03, 0.05, 0, 0.025, 0, '#b4623a', 8),
        tinted(new IcosahedronGeometry(0.035, 0).translate(0, 0.075, 0).toNonIndexed(), '#4c8a3a'),
      ]);
    case 'bench':
      return merge([
        box(0.22, 0.012, 0.06, 0, 0.065, 0, '#8a6a44'),
        box(0.22, 0.05, 0.01, 0, 0.1, -0.03, '#8a6a44'),
        box(0.012, 0.06, 0.05, -0.1, 0.03, 0, '#3a3d44'),
        box(0.012, 0.06, 0.05, 0.1, 0.03, 0, '#3a3d44'),
      ]);
  }
}

// ---- per-lot generation ------------------------------------------------------------

interface Decal {
  tile: Tile;
  x: number; z: number; w: number; d: number; yaw: number;
  color: string; layer: number;
}
interface PropPlacement {
  kind: PropKind; x: number; z: number; yaw: number; sx: number; sy: number; sz: number; color: string;
}
interface Light { x: number; y: number; z: number; kind: 'path' | 'porch' | 'pool' | 'fire'; }

const GREENS = ['#3f7a34', '#2f6a30', '#4f8a3a', '#5d8f3e', '#2c5a2d', '#6a9a45', '#3a6e46', '#7a9b3a'];
const BLOOM_SHRUBS = ['#c04a7a', '#d9a02e', '#b5392e', '#8a5ac0', '#e8e2d4', '#d8703a'];
const FLOWERS = ['#e8d44a', '#d94a6a', '#f2f2ec', '#9a6ad8', '#f08a3a', '#d83a3a', '#6aa6e8'];
const MULCH = ['#d6b79a', '#b89a80', '#9a8472', '#6f6a66', '#c9a27a'];
const LAWN_TONES = ['#4c8a34', '#6f9a3a', '#3a6a2c', '#8a9a3a', '#2f5a30', '#a0a040', '#5a9a50'];
const SHED_TINTS = ['#ffffff', '#cfe0c8', '#d8a89a', '#a9bfd6', '#d8d0a0', '#a8a8ae', '#9ab0a0'];
const UMBRELLAS = ['#e84a3a', '#2f7ad8', '#f2c230', '#2fa86a', '#e8e4d8', '#d86aa8'];
const PLAY = ['#d8402f', '#2f6ad8', '#e8a82a', '#2faa5a', '#9a4ad8'];
const BODY_TINTS = ['#ffffff', '#f0ece4', '#e4ecf4', '#f4e8e8'];

export class Yards {
  readonly group = new Group();
  private disposables: { dispose(): void }[] = [];
  private glow!: Points;

  /**
   * `lots` are the neighbourhood's lots; `parked` are the cars' front-yard spots, so a
   * driveway can lead to each one; `near` says which lots are worth detailing.
   */
  constructor(
    lots: KitLot[],
    kinds: Map<string, string>,
    parked: { x: number; z: number; yaw: number }[],
    near: (lot: KitLot) => boolean,
    detail: 'high' | 'low',
  ) {
    const { d: cellD, lotD, street, lotW } = HOME_CELL;
    const rand = mulberry32(60317);
    const decals: Decal[] = [];
    const props: PropPlacement[] = [];
    const lights: Light[] = [];
    const trees = lots.filter((l) => kinds.get(l.moduleId) === 'tree');

    for (const lot of lots) {
      if (kinds.get(lot.moduleId) !== 'house' || !near(lot)) continue;
      const toStreet = Math.cos(lot.yaw) > 0 ? 1 : -1;
      const iz = Math.floor(lot.z / cellD);
      const front = toStreet > 0 ? iz * cellD + lotD : iz * cellD + lotD + street;
      const cx = lot.x;
      const hw = lot.w;
      const hd = lot.d;
      const vF = (front - lot.z) * toStreet - hd / 2;
      const vR = vF + hd;
      const world = (u: number, v: number): [number, number] => [cx + u, front - toStreet * v];
      const nearbyTrees = trees
        .map((t) => ({ u: t.x - cx, v: (front - t.z) * toStreet, r: Math.max(t.w, t.d) * 0.42 + 0.12 }))
        .filter((t) => Math.abs(t.u) < lotW && t.v > -1 && t.v < lotD + 1);
      const taken: { u: number; v: number; r: number }[] = [];
      /** is a circle of radius r at (u, v) inside the lot, off the house and trees, and unclaimed? */
      const free = (u: number, v: number, r: number, zone: 'front' | 'back' | 'any' = 'any'): boolean => {
        if (Math.abs(u) > lotW / 2 - r - 0.08 || v < r + 0.25 || v > lotD - r - 0.12) return false;
        if (zone === 'front' && v + r > vF - 0.05) return false;
        if (zone === 'back' && v - r < vR + 0.08) return false;
        if (Math.abs(u) < hw / 2 + r && v + r > vF - 0.04 && v - r < vR + 0.04) return false;
        for (const t of nearbyTrees) if (Math.hypot(u - t.u, v - t.v) < r + t.r) return false;
        for (const t of taken) if (Math.hypot(u - t.u, v - t.v) < r + t.r) return false;
        return true;
      };
      const claim = (u: number, v: number, r: number): void => { taken.push({ u, v, r }); };
      const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)]!;
      const chance = (p: number): boolean => rand() < p;
      const between = (a: number, b: number): number => a + rand() * (b - a);
      /** tries a few spots for a feature of radius r, returns the first that is free */
      const place = (r: number, zone: 'front' | 'back' | 'any', uRange: [number, number], vRange: [number, number]): [number, number] | null => {
        for (let k = 0; k < 14; k++) {
          const u = between(uRange[0], uRange[1]);
          const v = between(vRange[0], vRange[1]);
          if (free(u, v, r, zone)) return [u, v];
        }
        return null;
      };
      const decal = (tile: Tile, u: number, v: number, w: number, dpt: number, yaw: number, color: string, layer: number): void => {
        const [x, z] = world(u, v);
        decals.push({ tile, x, z, w, d: dpt, yaw, color, layer });
      };
      const prop = (kind: PropKind, u: number, v: number, yaw: number, s: number | [number, number, number], color = '#ffffff'): void => {
        const [x, z] = world(u, v);
        const [sx, sy, sz] = typeof s === 'number' ? [s, s, s] : s;
        props.push({ kind, x, z, yaw, sx, sy, sz, color });
      };

      // — the lawn itself: large soft patches of different health, so no yard is one flat green
      const patches = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < patches; k++) {
        const size = between(1.6, 3.6);
        decal('blob', between(-2.6, 2.6), between(0.8, lotD - 0.8), size, size * between(0.7, 1.3), rand() * 3.14,
          pick(LAWN_TONES), 0);
      }
      if (chance(0.55)) {
        // mowing stripes over the front lawn, or the whole back, in either direction
        const front_ = chance(0.65);
        const v0 = front_ ? 0.4 : vR + 0.1;
        const v1 = front_ ? Math.max(vF - 0.1, 0.8) : lotD - 0.2;
        decal('stripes', 0, (v0 + v1) / 2, lotW - 0.3, v1 - v0, chance(0.5) ? 0 : Math.PI / 2, '#ffffff', 1);
      }
      if (chance(0.45)) {
        const p = place(0.7, 'any', [-2.4, 2.4], [0.8, lotD - 1]);
        if (p) decal('dots', p[0], p[1], between(1.2, 2.4), between(1.0, 2.0), rand() * 3.14, chance(0.6) ? '#f0d63a' : '#f4f4ee', 2);
      }
      if (chance(0.3)) {
        const p = place(0.6, 'any', [-2.4, 2.4], [0.8, lotD - 1]);
        if (p) decal('blob', p[0], p[1], between(0.9, 1.7), between(0.9, 1.6), rand() * 3.14, chance(0.5) ? '#9a8a3a' : '#7a6a3a', 1);
      }
      if (chance(0.3)) {
        const p = place(0.5, 'any', [-2.6, 2.6], [0.8, lotD - 1]);
        if (p) decal('leaves', p[0], p[1], between(0.7, 1.4), between(0.6, 1.2), rand() * 3.14, '#ffffff', 3);
      }

      // — foundation bed along the front of the house: mulch, shrubs, flowers
      if (chance(0.72)) {
        const w = hw * between(0.7, 1.0);
        const u0 = between(-0.12, 0.12) * hw;
        decal('mulch', u0, vF - 0.17, w, 0.3, 0, pick(MULCH), 1);
        if (chance(0.65)) decal('flowers', u0 + between(-0.3, 0.3), vF - 0.17, w * 0.85, 0.28, 0, pick(FLOWERS), 2);
        const shrubs = 3 + Math.floor(rand() * 4);
        for (let k = 0; k < shrubs; k++) {
          const u = u0 - w / 2 + ((k + 0.5) / shrubs) * w + between(-0.06, 0.06);
          if (Math.abs(u) < 0.5) continue; // leave the door and its walk clear
          const r = between(0.13, 0.26);
          prop('shrub', u, vF - 0.16 + between(-0.04, 0.04), rand() * 6, [r, r * between(0.7, 1.1), r],
            chance(0.2) ? pick(BLOOM_SHRUBS) : pick(GREENS));
        }
      }
      // border shrubs and a flower clump out in the yard
      for (let k = 0; k < Math.floor(rand() * 4); k++) {
        const r = between(0.12, 0.3);
        const p = place(r + 0.05, 'any', [-3.1, 3.1], [0.5, lotD - 0.8]);
        if (!p) continue;
        claim(p[0], p[1], r);
        prop('shrub', p[0], p[1], rand() * 6, [r, r * between(0.7, 1.1), r], chance(0.25) ? pick(BLOOM_SHRUBS) : pick(GREENS));
      }
      if (chance(0.35)) {
        const p = place(0.35, 'any', [-3, 3], [0.6, lotD - 1]);
        if (p) {
          claim(p[0], p[1], 0.35);
          decal('mulch', p[0], p[1], between(0.5, 0.9), between(0.4, 0.8), rand() * 3.14, pick(MULCH), 1);
          decal('flowers', p[0], p[1], between(0.45, 0.8), between(0.35, 0.7), rand() * 3.14, pick(FLOWERS), 2);
        }
      }
      // pots by the door
      if (chance(0.5)) {
        for (const side of [-1, 1]) if (chance(0.7)) prop('pot', side * between(0.3, 0.5), vF - 0.07, 0, between(0.8, 1.3), '#ffffff');
      }

      // — street side: mailbox at the curb, the light that shines on the walk
      if (chance(0.78)) prop('mailbox', (chance(0.5) ? -1 : 1) * between(2.5, 3.2), -0.2, 0, between(0.9, 1.15), pick(BODY_TINTS));
      if (chance(0.6)) lights.push({ ...worldLight(world, 0, vF - 0.05), y: 0.52, kind: 'porch' });
      if (chance(0.55)) {
        const n = 2 + Math.floor(rand() * 3);
        for (let k = 0; k < n; k++) {
          const v = 0.7 + ((k + 0.5) / n) * Math.max(vF - 1.1, 0.4);
          for (const side of [-1, 1]) if (chance(0.7)) lights.push({ ...worldLight(world, side * 0.62, v), y: 0.08, kind: 'path' });
        }
      }

      // — driveway: to the parked car if there is one, else sometimes an empty one
      const car = parked.find((p) => Math.hypot(p.x - cx, p.z - (front - toStreet * (vF + 0.9))) < 3.2 && Math.abs(p.z - lot.z) < 6);
      if (car) {
        const u = car.x - cx;
        const vCar = (front - car.z) * toStreet;
        decal('drive', u, (vCar + 0.85 - 0.05) / 2 + 0.05, 0.62, vCar + 0.85, Math.PI / 2, '#ffffff', 2);
      } else if (chance(0.3)) {
        const u = (chance(0.5) ? -1 : 1) * (hw / 2 + 0.55);
        if (Math.abs(u) < lotW / 2 - 0.35) decal('drive', u, (vF + 0.9) / 2, 0.62, vF + 0.9, Math.PI / 2, '#ffffff', 2);
      }

      // — the back yard: one big feature, then smaller ones around it
      const bigRoll = rand();
      if (bigRoll < 0.13) {
        // a pool, lit from below
        const w = between(1.3, 1.8), d = between(0.8, 1.1);
        const p = place(Math.max(w, d) / 2 + 0.1, 'back', [-1.6, 1.6], [vR + 0.9, lotD - 1.2]);
        if (p) {
          claim(p[0], p[1], Math.max(w, d) / 2);
          decal('water', p[0], p[1], w + 0.2, d + 0.2, chance(0.5) ? 0 : Math.PI / 2, '#ffffff', 2);
          lights.push({ ...worldLight(world, p[0], p[1]), y: 0.02, kind: 'pool' });
        }
      } else if (bigRoll < 0.62) {
        // a patio or deck against the back of the house, usually with a table
        const w = between(1.0, 1.7), d = between(0.7, 1.0);
        const u = between(-hw / 2 + w / 2 - 0.2, hw / 2 - w / 2 + 0.2);
        if (free(u, vR + d / 2 + 0.1, d / 2, 'back') || chance(0.6)) {
          claim(u, vR + d / 2 + 0.08, Math.max(w, d) / 2);
          decal(chance(0.4) ? 'wood' : 'patio', u, vR + d / 2 + 0.06, w, d, 0, chance(0.5) ? '#ffffff' : pick(['#e8e2d6', '#cfc8bc', '#d8d0c2']), 2);
          if (chance(0.7)) {
            const set = chance(0.55) ? 'umbrellaSet' : 'patioSet';
            prop(set, u + between(-0.15, 0.15), vR + d / 2 + 0.1, rand() * 3.14, between(0.9, 1.2), set === 'umbrellaSet' ? pick(UMBRELLAS) : pick(BODY_TINTS));
          }
          if (chance(0.4)) prop('bbq', u + w / 2 - 0.12, vR + 0.15, rand() * 3.14, between(0.9, 1.15));
        }
      }
      // vegetable garden
      if (chance(0.3)) {
        const w = between(0.9, 1.4), d = between(0.6, 0.9);
        const p = place(Math.max(w, d) / 2, 'back', [-2.1, 2.1], [vR + 0.6, lotD - 0.9]);
        if (p) {
          claim(p[0], p[1], Math.max(w, d) / 2);
          decal('veg', p[0], p[1], w, d, chance(0.5) ? 0 : Math.PI / 2, '#ffffff', 2);
        }
      }
      // a shed in a rear corner
      if (chance(0.36)) {
        const u = (chance(0.5) ? -1 : 1) * between(2.0, 2.8);
        if (free(u, lotD - 0.5, 0.32, 'back')) {
          claim(u, lotD - 0.5, 0.34);
          prop('shed', u, lotD - 0.5, toStreet > 0 ? Math.PI : 0, between(0.9, 1.2), pick(SHED_TINTS));
        }
      }
      // a play feature
      const play = rand();
      const playSpot = place(0.5, 'back', [-2.4, 2.4], [vR + 0.7, lotD - 1.0]);
      if (playSpot) {
        const [pu, pv] = playSpot;
        if (play < 0.16) {
          claim(pu, pv, 0.45);
          prop('swing', pu, pv, rand() < 0.5 ? 0 : Math.PI / 2, between(0.9, 1.15), pick(PLAY));
        } else if (play < 0.38) {
          claim(pu, pv, 0.42);
          prop('trampoline', pu, pv, rand() * 6, between(0.85, 1.1), pick(PLAY));
        } else if (play < 0.52) {
          claim(pu, pv, 0.35);
          decal('sand', pu, pv, between(0.5, 0.75), between(0.5, 0.75), rand() * 3.14, '#ffffff', 2);
        } else if (play < 0.6) {
          claim(pu, pv, 0.3);
          decal('kiddie', pu, pv, 0.45, 0.45, 0, '#ffffff', 2);
        } else if (play < 0.76) {
          claim(pu, pv, 0.32);
          decal('firepit', pu, pv, 0.52, 0.52, rand() * 6, '#ffffff', 2);
          lights.push({ ...worldLight(world, pu, pv), y: 0.05, kind: 'fire' });
          for (let k = 0; k < 3; k++) {
            const a = rand() * 6.28;
            prop('bench', pu + Math.cos(a) * 0.4, pv + Math.sin(a) * 0.4, -a, 0.8, '#ffffff');
          }
        }
      }
      if (chance(0.16)) {
        const p = place(0.2, 'back', [-2.8, 2.8], [vR + 0.4, lotD - 0.5]);
        if (p) prop('woodpile', p[0], p[1], rand() > 0.5 ? 0 : Math.PI / 2, between(0.9, 1.2), '#ffffff');
      }
      // a flower border along the rear fence
      if (chance(0.34)) {
        const a = between(-2.8, -0.4), b = between(0.4, 2.8);
        decal('mulch', (a + b) / 2, lotD - 0.28, b - a, 0.34, 0, pick(MULCH), 1);
        decal('flowers', (a + b) / 2, lotD - 0.28, b - a, 0.3, 0, pick(FLOWERS), 2);
        // a hedge standing behind it, now and then
        if (chance(0.35)) prop('hedge', (a + b) / 2, lotD - 0.12, 0, [b - a, between(0.22, 0.34), 0.16], pick(GREENS));
      }
    }

    this.buildDecals(decals);
    this.buildProps(props, detail);
    this.buildLights(lights);
  }

  // -- decals: one merged mesh, one draw -------------------------------------------------

  private buildDecals(decals: Decal[]): void {
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new Color();
    for (const d of decals) {
      const [u0, v0, u1, v1] = tileUV(d.tile);
      const cos = Math.cos(d.yaw), sin = Math.sin(d.yaw);
      const y = 0.012 + d.layer * 0.0025;
      const base = pos.length / 3;
      c.set(d.color);
      for (const [lx, lz, ux, uy] of [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]] as const) {
        const x = lx * d.w / 2, z = lz * d.d / 2;
        pos.push(d.x + x * cos - z * sin, y, d.z + x * sin + z * cos);
        uv.push(ux, uy);
        col.push(c.r, c.g, c.b);
      }
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    if (!idx.length) return;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const map = decalAtlas();
    const material = new MeshStandardMaterial({
      map, vertexColors: true, transparent: true, depthWrite: false, roughness: 0.95, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new Mesh(g, material);
    mesh.renderOrder = -3;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this.disposables.push(g, material, map);
  }

  // -- props: a few instanced meshes ----------------------------------------------------

  private buildProps(props: PropPlacement[], detail: 'high' | 'low'): void {
    const byKind = new Map<PropKind, PropPlacement[]>();
    for (const p of props) {
      // phones keep the shrubs, which carry the colour, and skip the small furniture
      if (detail === 'low' && p.kind !== 'shrub' && p.kind !== 'hedge') continue;
      const list = byKind.get(p.kind) ?? [];
      list.push(p);
      byKind.set(p.kind, list);
    }
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
    this.disposables.push(material);
    const m4 = new Matrix4();
    const q = new Quaternion();
    const Y = new Vector3(0, 1, 0);
    const pos = new Vector3();
    const sc = new Vector3();
    const tint = new Color();
    for (const [kind, list] of byKind) {
      const geometry = propGeometry(kind);
      const inst = new InstancedMesh(geometry, material, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(Y, p.yaw);
        inst.setMatrixAt(i, m4.compose(pos.set(p.x, 0, p.z), q, sc.set(p.sx, p.sy, p.sz)));
        inst.setColorAt(i, tint.set(p.color));
      });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.frustumCulled = false;
      this.group.add(inst);
      this.disposables.push(geometry, inst);
    }
  }

  // -- lights: warm porch and path lamps, a blue pool glow, firepit embers -------------------

  private buildLights(lights: Light[]): void {
    const make = (kind: Light['kind'], color: string, size: number, opacity: number): void => {
      const list = lights.filter((l) => l.kind === kind);
      if (!list.length) return;
      const pos = new Float32Array(list.length * 3);
      list.forEach((l, i) => {
        pos[i * 3] = l.x;
        pos[i * 3 + 1] = l.y;
        pos[i * 3 + 2] = l.z;
      });
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pos, 3));
      const m = new PointsMaterial({
        map: glowTexture(), color, size, transparent: true, opacity, depthWrite: false,
        blending: AdditiveBlending, sizeAttenuation: true,
      });
      const points = new Points(g, m);
      points.frustumCulled = false;
      this.group.add(points);
      this.disposables.push(g, m);
      if (kind === 'fire') this.glow = points;
    };
    make('porch', '#ffc880', 0.5, 0.85);
    make('path', '#ffe2a8', 0.22, 0.8);
    make('pool', '#5ad2ff', 1.5, 0.55);
    make('fire', '#ff8a3a', 0.6, 0.9);
  }

  /** the firepits breathe a little */
  update(time: number): void {
    if (this.glow) (this.glow.material as PointsMaterial).opacity = 0.75 + Math.sin(time * 7.3) * 0.1 + Math.sin(time * 12.1) * 0.06;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

function worldLight(world: (u: number, v: number) => [number, number], u: number, v: number): { x: number; y: number; z: number } {
  const [x, z] = world(u, v);
  return { x, y: 0, z };
}
