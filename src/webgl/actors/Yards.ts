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
  DoubleSide,
  PlaneGeometry,
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
import type { PoolSite } from './Pools';

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
  | 'wood' | 'sand' | 'leaves' | 'firepit' | 'dots' | 'gravel' | 'kiddie' | 'stone' | 'bed' | 'ring' | 'pavers';
const TILES: Tile[] = [
  'mulch', 'flowers', 'stripes', 'blob', 'veg', 'patio', 'water', 'drive',
  'wood', 'sand', 'leaves', 'firepit', 'dots', 'gravel', 'kiddie', 'stone',
  'bed', 'ring', 'pavers',
];
const TILE_PX = 128;
const COLS = 8;
const ROWS = 3;

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
      case 'water': {
        // the phone tier's pool: pale coping, a tiled basin shading from shallow to deep, ripples,
        // the lamp's glow, a ladder and steps (HIGH draws a real pool instead, see Pools.ts)
        slab(3, 'rgb(226,222,210)', 12);
        ctx.strokeStyle = 'rgba(120,114,100,0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(11, 11, S - 22, S - 22, 12);
        ctx.stroke();
        const basin = ctx.createLinearGradient(12, 0, S - 12, 0);
        basin.addColorStop(0, 'rgb(150,224,236)');
        basin.addColorStop(0.5, 'rgb(62,170,210)');
        basin.addColorStop(1, 'rgb(28,104,160)');
        ctx.fillStyle = basin;
        ctx.beginPath();
        ctx.roundRect(13, 13, S - 26, S - 26, 11);
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(230,246,250,0.16)';
        ctx.lineWidth = 1;
        for (let k = 13; k < S - 13; k += 9) {
          ctx.beginPath();
          ctx.moveTo(k, 13);
          ctx.lineTo(k, S - 13);
          ctx.moveTo(13, k);
          ctx.lineTo(S - 13, k);
          ctx.stroke();
        }
        const lamp = ctx.createRadialGradient(S * 0.7, S / 2, 0, S * 0.7, S / 2, S * 0.3);
        lamp.addColorStop(0, 'rgba(190,244,255,0.55)');
        lamp.addColorStop(1, 'rgba(190,244,255,0)');
        ctx.fillStyle = lamp;
        ctx.fillRect(0, 0, S, S);
        ctx.restore();
        for (let k = 0; k < 16; k++) {
          ctx.strokeStyle = `rgba(210,240,250,${0.2 + rnd() * 0.3})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          const y = 22 + rnd() * (S - 44);
          ctx.moveTo(20 + rnd() * 24, y);
          ctx.quadraticCurveTo(S / 2, y + (rnd() - 0.5) * 14, S - 20 - rnd() * 24, y + (rnd() - 0.5) * 8);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(250,252,252,0.95)';
        ctx.fillRect(15, 20, 10, 20);
        ctx.fillStyle = 'rgba(232,238,240,0.95)';
        ctx.fillRect(15, 24, 6, 12);
        ctx.fillStyle = 'rgb(210,220,226)';
        ctx.beginPath();
        ctx.arc(S - 11, S - 36, 3.2, 0, Math.PI * 2);
        ctx.arc(S - 11, S - 48, 3.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
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
      case 'stone': {
        // one flagstone: an irregular slab, a darker joint round it, a little lichen
        ctx.fillStyle = 'rgba(70,64,56,0.55)';
        const pts: [number, number][] = [];
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2;
          const r = S * (0.4 + rnd() * 0.08);
          pts.push([S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r]);
        }
        ctx.beginPath();
        pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgb(196,188,172)';
        ctx.beginPath();
        pts.forEach(([x, y], k) => {
          const px = S / 2 + (x - S / 2) * 0.9, py = S / 2 + (y - S / 2) * 0.9;
          if (k) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        });
        ctx.closePath();
        ctx.fill();
        speckle(70, '150,142,128', 1, 3.5, 0.5);
        speckle(16, '160,170,120', 2, 5, 0.35);
        break;
      }
      case 'bed': {
        // an organic planting bed: dark mulch with a soft edge and a spaded border
        const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.5);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.8, 'rgba(255,255,255,0.95)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        for (let k = 0; k <= 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          const r = S * (0.42 + 0.06 * Math.sin(a * 3 + 1) + 0.03 * Math.sin(a * 5));
          const x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
          if (k) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.fill();
        speckle(200, '90,70,52', 1, 3, 0.5);
        break;
      }
      case 'ring': {
        // mulch under a tree: a disc fading out at the rim
        const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.48);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.75, 'rgba(255,255,255,0.95)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
        speckle(160, '80,62,46', 1, 3, 0.45);
        break;
      }
      case 'pavers': {
        // a herringbone of brick pavers with a soldier course round the edge
        slab(2, 'rgb(150,92,70)', 3);
        ctx.save();
        ctx.beginPath();
        ctx.rect(8, 8, S - 16, S - 16);
        ctx.clip();
        for (let y = -S; y < S * 2; y += 8) {
          for (let x = -S; x < S * 2; x += 16) {
            const l = 0.82 + rnd() * 0.3;
            ctx.fillStyle = `rgb(${172 * l},${104 * l},${78 * l})`;
            ctx.fillRect(x + (y / 8) % 2 * 8, y, 15, 7);
          }
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(70,46,34,0.8)';
        ctx.lineWidth = 2;
        ctx.strokeRect(5, 5, S - 10, S - 10);
        break;
      }
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

/** A grass tuft on a transparent ground; the instance tint colours it. */
function tuftTexture(): CanvasTexture {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  let seed = 991;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 34; k++) {
    const x0 = S * 0.2 + rnd() * S * 0.6;
    const lean = (rnd() - 0.5) * S * 0.5;
    const h = S * (0.45 + rnd() * 0.5);
    const g = 150 + rnd() * 90;
    ctx.fillStyle = `rgb(${g * 0.55},${g},${g * 0.38})`;
    ctx.beginPath();
    ctx.moveTo(x0 - 2.4, S);
    ctx.quadraticCurveTo(x0 + lean * 0.3, S - h * 0.6, x0 + lean, S - h);
    ctx.quadraticCurveTo(x0 + lean * 0.3 + 2, S - h * 0.55, x0 + 2.4, S);
    ctx.closePath();
    ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
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
  | 'trampoline' | 'woodpile' | 'pot' | 'bench' | 'tuft'
  | 'conifer' | 'mound' | 'bloom' | 'trunk' | 'canopy' | 'birdbath' | 'raised' | 'chair';

/** a lumpy ball of a few blobs, for canopies and flower heads */
function blobs(n: number, spread: number, r: number, y: number, seed: number): BufferGeometry {
  let a = seed;
  const rnd = (): number => ((a = (a * 16807) % 2147483647) / 2147483647);
  const parts: BufferGeometry[] = [];
  for (let k = 0; k < n; k++) {
    const ang = (k / n) * Math.PI * 2 + rnd();
    const d = k === 0 ? 0 : spread * (0.6 + rnd() * 0.4);
    parts.push(tinted(new IcosahedronGeometry(r * (0.75 + rnd() * 0.4), 1)
      .translate(Math.cos(ang) * d, y + (rnd() - 0.4) * r * 0.6, Math.sin(ang) * d).toNonIndexed(), '#ffffff'));
  }
  return merge(parts);
}

/** Prop geometry, modelled at site scale (a person would be ~0.55 tall), in neutral colours the instance tint shifts. */
function propGeometry(kind: PropKind): BufferGeometry {
  switch (kind) {
    case 'tuft': {
      // three crossed cards: grass at this scale is a texture, not blades
      const cards: BufferGeometry[] = [];
      for (let k = 0; k < 3; k++) {
        const g = new PlaneGeometry(0.3, 0.26).translate(0, 0.13, 0).rotateY((k * Math.PI) / 3);
        cards.push(g);
      }
      const merged = mergeGeometries(cards.map((c) => c.toNonIndexed()), false)!;
      cards.forEach((c) => c.dispose());
      return merged;
    }
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
    case 'conifer':
      // a clipped arborvitae or juniper: a cone on a stub of trunk
      return merge([
        cyl(0.05, 0.08, 0, 0.04, 0, '#ffffff', 6),
        tinted(new ConeGeometry(0.5, 1, 9).translate(0, 0.58, 0).toNonIndexed(), '#ffffff'),
      ]);
    case 'mound':
      // hosta, fern or a perennial's leaves: a low dome
      return tinted(new IcosahedronGeometry(0.5, 1).scale(1, 0.55, 1).translate(0, 0.2, 0).toNonIndexed(), '#ffffff');
    case 'bloom':
      // the flower heads over a mound: small balls on the crown (the tint is the flower)
      return blobs(7, 0.3, 0.11, 0.42, 77);
    case 'trunk':
      return merge([
        cyl(0.045, 0.75, 0, 0.375, 0, '#5c4634', 6),
        tinted(new CylinderGeometry(0.012, 0.03, 0.4, 5).rotateZ(0.7).translate(0.12, 0.62, 0).toNonIndexed(), '#5c4634'),
        tinted(new CylinderGeometry(0.012, 0.03, 0.4, 5).rotateZ(-0.7).translate(-0.12, 0.6, 0.05).toNonIndexed(), '#5c4634'),
      ]);
    case 'canopy':
      // an ornamental tree's crown: maple, crabapple, dogwood, redbud (the tint)
      return blobs(5, 0.32, 0.36, 0.9, 311);
    case 'birdbath':
      return merge([
        cyl(0.07, 0.03, 0, 0.015, 0, '#b9b2a4', 10),
        cyl(0.035, 0.2, 0, 0.12, 0, '#c4bdb0', 8),
        cyl(0.15, 0.04, 0, 0.24, 0, '#c4bdb0', 14),
        cyl(0.125, 0.01, 0, 0.258, 0, '#5d7f92', 14),
      ]);
    case 'raised':
      // a raised vegetable bed: a timber box of soil with rows of greens
      return merge([
        box(0.8, 0.1, 0.34, 0, 0.05, 0, '#8a6844'),
        box(0.74, 0.02, 0.28, 0, 0.1, 0, '#3e2c20'),
        ...[-0.27, -0.09, 0.09, 0.27].flatMap((x) => [-0.07, 0.07].map((z) =>
          tinted(new IcosahedronGeometry(0.06, 0).scale(1, 0.7, 1).translate(x, 0.13, z).toNonIndexed(), '#5a9a3e'))),
      ]);
    case 'chair':
      // an Adirondack chair: slatted back, broad arms
      return merge([
        box(0.1, 0.012, 0.1, 0, 0.05, 0, '#ffffff'),
        tinted(new BoxGeometry(0.1, 0.012, 0.11).rotateX(-0.5).translate(0, 0.1, -0.06).toNonIndexed(), '#ffffff'),
        box(0.016, 0.012, 0.11, 0.06, 0.08, 0, '#ffffff'),
        box(0.016, 0.012, 0.11, -0.06, 0.08, 0, '#ffffff'),
        box(0.012, 0.05, 0.012, 0.045, 0.025, 0.04, '#ffffff'),
        box(0.012, 0.05, 0.012, -0.045, 0.025, 0.04, '#ffffff'),
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

/** tufts carry their own green; the tint only shifts it toward straw or lush */
const TUFT_TINTS = ['#ffffff', '#f4f8e4', '#e2efc0', '#f6efc4', '#d4e8a8', '#ffffff'];
const GREENS = ['#3f7a34', '#2f6a30', '#4f8a3a', '#5d8f3e', '#2c5a2d', '#6a9a45', '#3a6e46', '#7a9b3a'];
const BLOOM_SHRUBS = ['#c04a7a', '#d9a02e', '#b5392e', '#8a5ac0', '#e8e2d4', '#d8703a'];
const FLOWERS = ['#e8d44a', '#d94a6a', '#f2f2ec', '#9a6ad8', '#f08a3a', '#d83a3a', '#6aa6e8'];
const MULCH = ['#d6b79a', '#b89a80', '#9a8472', '#6f6a66', '#c9a27a'];
const LAWN_TONES = ['#4c8a34', '#6f9a3a', '#3a6a2c', '#8a9a3a', '#2f5a30', '#a0a040', '#5a9a50'];
const SHED_TINTS = ['#ffffff', '#cfe0c8', '#d8a89a', '#a9bfd6', '#d8d0a0', '#a8a8ae', '#9ab0a0'];
const UMBRELLAS = ['#e84a3a', '#2f7ad8', '#f2c230', '#2fa86a', '#e8e4d8', '#d86aa8'];
const PLAY = ['#d8402f', '#2f6ad8', '#e8a82a', '#2faa5a', '#9a4ad8'];
const BODY_TINTS = ['#ffffff', '#f0ece4', '#e4ecf4', '#f4e8e8'];
/** foundation evergreens: arborvitae, juniper blue, yew */
const CONIFERS = ['#2c5230', '#3b5e46', '#46684a', '#2a4a2c', '#557a52'];
/** hosta, fern and perennial leaf greens */
const MOUNDS = ['#4e7f3a', '#6a9446', '#3c6a3a', '#7a9a5a', '#5f8a6a', '#8aa860'];
/** ornamental trees in late season: japanese maple, crabapple, dogwood, redbud, a golden one */
const ORNAMENTAL = ['#a3322a', '#c45a3a', '#d98aa0', '#e2ddcf', '#8c4a7c', '#d4a43a', '#4f7a35', '#b8422e'];
const CHAIRS = ['#f2efe6', '#2f6a8a', '#c44a3a', '#3f7a4a', '#e8c25a'];

/** what phones keep of the props: the planting, which carries the colour */
const LOW_PROPS = new Set<PropKind>(['shrub', 'hedge', 'conifer', 'mound', 'bloom', 'trunk', 'canopy']);

export class Yards {
  readonly group = new Group();
  private disposables: { dispose(): void }[] = [];
  private glow!: Points;
  /** where the pools are (HIGH tier: each gets real geometry from `Pools`; LOW keeps the painted decal) */
  readonly poolSites: PoolSite[] = [];

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
    /** lots the camera passes close by: these get the full garden (see `lush` below) */
    rich: (lot: KitLot) => boolean = () => false,
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
      const lush = rich(lot);
      /** what the garden path leads to: the patio (u, v, w, d) and the shed (u, v), if any */
      let patio: [number, number, number, number] | null = null;
      let shed: [number, number] | null = null;
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
      if (lush || chance(0.72)) {
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
      if (lush || chance(0.55)) {
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
        const rich = detail === 'high';
        // the real pool wears a paved deck, so it needs a little more room round it
        const p = place(Math.max(w, d) / 2 + (rich ? 0.4 : 0.1), 'back', [-1.6, 1.6], [vR + 0.9, lotD - 1.2]);
        if (p) {
          claim(p[0], p[1], Math.max(w, d) / 2 + (rich ? 0.3 : 0));
          const turn = chance(0.5) ? 0 : Math.PI / 2;
          if (rich) {
            decal('patio', p[0], p[1], w + 0.78, d + 0.78, turn, '#e8e2d6', 2);
            const [px, pz] = world(p[0], p[1]);
            this.poolSites.push({ x: px, z: pz, w, d, yaw: turn });
          } else {
            decal('water', p[0], p[1], w + 0.2, d + 0.2, turn, '#ffffff', 2);
          }
          lights.push({ ...worldLight(world, p[0], p[1]), y: 0.02, kind: 'pool' });
        }
      } else if (bigRoll < 0.62 || lush) {
        // a patio or deck against the back of the house, usually with a table
        const w = between(1.0, 1.7), d = between(0.7, 1.0);
        const u = between(-hw / 2 + w / 2 - 0.2, hw / 2 - w / 2 + 0.2);
        if (free(u, vR + d / 2 + 0.1, d / 2, 'back') || chance(0.6)) {
          claim(u, vR + d / 2 + 0.08, Math.max(w, d) / 2);
          const floor = lush ? pick(['wood', 'patio', 'pavers', 'pavers'] as Tile[]) : chance(0.4) ? 'wood' : 'patio';
          decal(floor, u, vR + d / 2 + 0.06, w, d, 0, chance(0.5) ? '#ffffff' : pick(['#e8e2d6', '#cfc8bc', '#d8d0c2']), 2);
          patio = [u, vR + d / 2 + 0.06, w, d];
          if (lush || chance(0.7)) {
            const set = chance(0.55) ? 'umbrellaSet' : 'patioSet';
            prop(set, u + between(-0.15, 0.15), vR + d / 2 + 0.1, rand() * 3.14, between(0.9, 1.2), set === 'umbrellaSet' ? pick(UMBRELLAS) : pick(BODY_TINTS));
          }
          if (chance(0.4)) prop('bbq', u + w / 2 - 0.12, vR + 0.15, rand() * 3.14, between(0.9, 1.15));
        }
      }
      // vegetable garden: a dug plot, or on the near lots a pair of raised beds
      if (chance(lush ? 0.45 : 0.3)) {
        const w = between(0.9, 1.4), d = between(0.6, 0.9);
        const p = place(Math.max(w, d) / 2, 'back', [-2.1, 2.1], [vR + 0.6, lotD - 0.9]);
        if (p) {
          claim(p[0], p[1], Math.max(w, d) / 2);
          const turn = chance(0.5) ? 0 : Math.PI / 2;
          if (lush && chance(0.6)) {
            decal('gravel', p[0], p[1], w + 0.2, d + 0.2, turn, '#ffffff', 1);
            for (const k of [-1, 1]) {
              const off = k * d * 0.25;
              prop('raised', p[0] + (turn ? off : 0), p[1] + (turn ? 0 : off), turn, [w / 0.8 * 0.9, 1, 1]);
            }
          } else {
            decal('veg', p[0], p[1], w, d, turn, '#ffffff', 2);
          }
        }
      }
      // a shed in a rear corner
      if (chance(lush ? 0.5 : 0.36)) {
        const u = (chance(0.5) ? -1 : 1) * between(2.0, 2.8);
        if (free(u, lotD - 0.5, 0.32, 'back')) {
          claim(u, lotD - 0.5, 0.34);
          shed = [u, lotD - 0.5];
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

      // — more green: hedges, a thicker planting of shrubs, and grass where the mower misses
      if (chance(lush ? 0.4 : 0.24)) {
        // a clipped hedge along the front, from a side toward the walk
        const side = chance(0.5) ? -1 : 1;
        const len = between(1.0, 2.4);
        prop('hedge', side * (3.3 - len / 2 - 0.1), 0.52, 0, [len, between(0.2, 0.32), 0.17], pick(GREENS));
      }
      if (chance(lush ? 0.45 : 0.3)) {
        // a hedge down a property line, behind the house
        const side = chance(0.5) ? -1 : 1;
        const len = between(1.5, Math.max(lotD - vR - 0.6, 1.6));
        prop('hedge', side * 3.32, lotD - 0.5 - len / 2, Math.PI / 2, [len, between(0.22, 0.34), 0.17], pick(GREENS));
      }
      for (let k = 0; k < 1 + Math.floor(rand() * 4); k++) {
        const r = between(0.1, 0.22);
        const p = place(r + 0.05, 'any', [-3.2, 3.2], [0.5, lotD - 0.5]);
        if (!p) continue;
        claim(p[0], p[1], r);
        prop('shrub', p[0], p[1], rand() * 6, [r, r * between(0.6, 1.0), r], chance(0.2) ? pick(BLOOM_SHRUBS) : pick(GREENS));
      }
      if (lush) this.garden(
        { lotW, lotD, hw, vF, vR, toStreet }, nearbyTrees, patio, shed,
        { decal, prop, place, claim, pick, chance, between, light: (u, v, y, kind) => lights.push({ ...worldLight(world, u, v), y, kind }) },
      );

      // grass tufts: along the fence lines, up the walls of the house, and scattered
      const tufts = (lush ? 90 : 10) + Math.floor(rand() * (lush ? 70 : 26));
      for (let k = 0; k < tufts; k++) {
        const roll = rand();
        let u: number, v: number;
        if (roll < 0.4) {
          // hugging a fence line
          const rear = chance(0.5);
          u = rear ? between(-3.3, 3.3) : (chance(0.5) ? -1 : 1) * between(3.2, 3.4);
          v = rear ? lotD - between(0.05, 0.3) : between(vR, lotD);
        } else if (roll < 0.7) {
          // against the walls of the house
          u = (chance(0.5) ? -1 : 1) * (hw / 2 + between(0.04, 0.2));
          v = between(vF, vR);
        } else {
          u = between(-3.2, 3.2);
          v = between(0.4, lotD - 0.3);
        }
        if (!free(u, v, 0.05)) continue;
        prop('tuft', u, v, rand() * 3.14, between(0.7, 1.5), pick(TUFT_TINTS));
      }
    }

    this.buildDecals(decals, detail === 'high');
    this.buildProps(props, detail);
    this.buildLights(lights);
  }

  /**
   * The full garden, for the lots the camera passes close to: planting round every wall of the
   * house (mulch beds of shrubs, clipped evergreens and flowering perennials, a gap at each door),
   * mulch rings and hostas under the trees, an ornamental tree, island flower beds, a bird bath,
   * chairs on the lawn, and a stepping-stone path from the back door or patio out to the shed or
   * the bottom of the garden, lit by stake lights. Lot-local (u across, v from the street edge).
   */
  private garden(
    lot: { lotW: number; lotD: number; hw: number; vF: number; vR: number; toStreet: number },
    trees: { u: number; v: number; r: number }[],
    patio: [number, number, number, number] | null,
    shed: [number, number] | null,
    f: {
      decal: (tile: Tile, u: number, v: number, w: number, d: number, yaw: number, color: string, layer: number) => void;
      prop: (kind: PropKind, u: number, v: number, yaw: number, s: number | [number, number, number], color?: string) => void;
      place: (r: number, zone: 'front' | 'back' | 'any', uRange: [number, number], vRange: [number, number]) => [number, number] | null;
      claim: (u: number, v: number, r: number) => void;
      pick: <T>(list: T[]) => T;
      chance: (p: number) => boolean;
      between: (a: number, b: number) => number;
      light: (u: number, v: number, y: number, kind: Light['kind']) => void;
    },
  ): void {
    const { lotW, lotD, hw, vF, vR } = lot;
    const { decal, prop, place, claim, pick, chance, between, light } = f;
    const turn = (): number => between(0, Math.PI * 2);
    const clear = (u: number, v: number, r: number): boolean =>
      trees.every((t) => Math.hypot(u - t.u, v - t.v) > r + t.r * 0.55);
    /** one plant of a mixed border: a shrub, a clipped evergreen, or a perennial in flower */
    const plant = (u: number, v: number, scale = 1): void => {
      const roll = between(0, 1);
      if (roll < 0.42) {
        const r = between(0.16, 0.27) * scale;
        prop('shrub', u, v, turn(), [r, r * between(0.75, 1.1), r], chance(0.2) ? pick(BLOOM_SHRUBS) : pick(GREENS));
      } else if (roll < 0.62) {
        const r = between(0.13, 0.19) * scale;
        prop('conifer', u, v, turn(), [r * 2, between(0.5, 0.95) * scale, r * 2], pick(CONIFERS));
      } else {
        const r = between(0.13, 0.2) * scale;
        prop('mound', u, v, turn(), r * 2, pick(MOUNDS));
        if (chance(0.8)) prop('bloom', u, v, turn(), r * 2, pick(FLOWERS));
      }
    };
    /** a mulched border from (u0, v0) to (u1, v1), planted along its length, with gaps */
    const border = (u0: number, v0: number, u1: number, v1: number, gap: (u: number, v: number) => boolean): void => {
      const len = Math.hypot(u1 - u0, v1 - v0);
      if (len < 0.5) return;
      const du = (u1 - u0) / len, dv = (v1 - v0) / len;
      decal('mulch', (u0 + u1) / 2, (v0 + v1) / 2, len + 0.1, 0.48, Math.abs(dv) > 0.5 ? Math.PI / 2 : 0, pick(MULCH), 1);
      for (let t = between(0.12, 0.28); t < len - 0.08; t += between(0.32, 0.46)) {
        const u = u0 + du * t, v = v0 + dv * t;
        if (gap(u, v) || !clear(u, v, 0.12)) continue;
        plant(u, v);
      }
    };

    // planting round the house: the back (clear of the back door and a patio against the wall),
    // and the sides wherever the side yard is wide enough to walk past it
    const onPatio = (u: number, v: number): boolean =>
      !!patio && Math.abs(u - patio[0]) < patio[2] / 2 + 0.12 && Math.abs(v - patio[1]) < patio[3] / 2 + 0.25;
    border(-hw / 2 + 0.1, vR + 0.2, hw / 2 - 0.1, vR + 0.2, (u, v) => Math.abs(u) < 0.5 || onPatio(u, v));
    if (lotW / 2 - hw / 2 > 0.5) {
      for (const side of [-1, 1]) {
        const u = side * (hw / 2 + 0.2);
        border(u, vF + 0.15, u, vR - 0.15, () => false);
      }
    }
    // a pair of clipped evergreens framing the front door
    if (chance(0.5)) {
      for (const side of [-1, 1]) prop('conifer', side * 0.55, vF - 0.18, 0, [0.26, between(0.5, 0.65), 0.26], pick(CONIFERS));
    }

    // mulch rings and shade planting under the trees in the lot
    for (const t of trees) {
      if (Math.abs(t.u) > lotW / 2 - 0.2 || t.v < 0.3 || t.v > lotD - 0.2) continue;
      const ring = Math.min(t.r * 1.5, 1.3);
      decal('ring', t.u, t.v, ring, ring, 0, pick(MULCH), 1);
      const n = 3 + Math.floor(between(0, 3));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + between(0, 1);
        const d = ring * between(0.28, 0.42);
        prop('mound', t.u + Math.cos(a) * d, t.v + Math.sin(a) * d, turn(), between(0.18, 0.3), pick(MOUNDS));
      }
    }

    // an ornamental tree: japanese maple, crabapple, dogwood, redbud
    if (chance(0.7)) {
      const p = place(0.5, 'any', [-2.7, 2.7], [0.6, lotD - 0.7]);
      if (p) {
        claim(p[0], p[1], 0.5);
        const size = between(0.85, 1.3);
        prop('trunk', p[0], p[1], turn(), size);
        prop('canopy', p[0], p[1], turn(), [size * between(0.9, 1.2), size, size * between(0.9, 1.2)], pick(ORNAMENTAL));
        decal('ring', p[0], p[1], 0.7 * size, 0.7 * size, 0, pick(MULCH), 1);
      }
    }

    // island flower beds
    for (let k = 0; k < 2 + Math.floor(between(0, 2)); k++) {
      const w = between(1.1, 1.8), d = between(0.7, 1.1);
      const p = place(Math.max(w, d) / 2, 'any', [-2.5, 2.5], [0.6, lotD - 0.6]);
      if (!p) continue;
      claim(p[0], p[1], Math.max(w, d) / 2);
      const yaw = turn();
      decal('bed', p[0], p[1], w, d, yaw, pick(MULCH), 1);
      const n = 6 + Math.floor(between(0, 5));
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      for (let i = 0; i < n; i++) {
        const a = between(0, Math.PI * 2), rr = Math.sqrt(between(0, 1)) * 0.36;
        const lx = Math.cos(a) * rr * w, lz = Math.sin(a) * rr * d;
        plant(p[0] + lx * c - lz * sn, p[1] - (lx * sn + lz * c), i === 0 ? 1.3 : 1);
      }
    }

    // perennial borders along the back fence and down one side: mulch and a drift of plants
    {
      const a = between(-3.0, -1.2), b = between(1.2, 3.0);
      border(a, lotD - 0.32, b, lotD - 0.32, (u, v) => !!shed && Math.hypot(u - shed[0], v - shed[1]) < 0.55);
      const side = chance(0.5) ? -1 : 1;
      if (chance(0.6)) border(side * (lotW / 2 - 0.3), Math.max(vR + 0.3, lotD - between(2.5, 4.5)), side * (lotW / 2 - 0.3), lotD - 0.6, () => false);
    }

    // a bird bath, and chairs out on the lawn
    if (chance(0.4)) {
      const p = place(0.16, 'any', [-2.8, 2.8], [0.5, lotD - 0.5]);
      if (p) { claim(p[0], p[1], 0.16); prop('birdbath', p[0], p[1], 0, between(0.95, 1.2)); }
    }
    if (chance(0.45)) {
      const p = place(0.3, 'back', [-2.4, 2.4], [vR + 0.6, lotD - 0.6]);
      if (p) {
        claim(p[0], p[1], 0.3);
        const yaw = turn(), color = pick(CHAIRS);
        for (const k of [-1, 1]) prop('chair', p[0] + Math.cos(yaw) * 0.13 * k, p[1] + Math.sin(yaw) * 0.13 * k, -yaw, 1, color);
      }
    }

    // stepping stones from the back door (or the patio's far edge) to the shed or the garden's end
    const from: [number, number] = patio ? [patio[0], patio[1] + patio[3] / 2 + 0.12] : [between(-0.3, 0.3), vR + 0.16];
    const to: [number, number] = shed ? [shed[0] * 0.8, shed[1] - 0.4] : [between(-2.4, 2.4), lotD - between(0.6, 1.4)];
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (len > 0.8) {
      const bend = between(-0.5, 0.5);
      let k = 0;
      for (let t = 0.08; t < len; t += between(0.27, 0.33), k++) {
        const f = t / len;
        const nu = -(to[1] - from[1]) / len, nv = (to[0] - from[0]) / len;
        const sway = Math.sin(f * Math.PI) * bend;
        const u = from[0] + (to[0] - from[0]) * f + nu * sway, v = from[1] + (to[1] - from[1]) * f + nv * sway;
        const sz = between(0.24, 0.3);
        decal('stone', u, v, sz, sz * between(0.8, 1.0), turn(), pick(['#e2dccf', '#d0cabd', '#c8c0b0']), 2);
        if (k % 3 === 1) light(u + nu * 0.18 * (k % 2 ? 1 : -1), v + nv * 0.18, 0.08, 'path');
      }
    }
  }

  // -- decals: one merged mesh, one draw -------------------------------------------------

  private buildDecals(decals: Decal[], shadows: boolean): void {
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
    mesh.receiveShadow = shadows;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this.disposables.push(g, material, map);
  }

  // -- props: a few instanced meshes ----------------------------------------------------

  private buildProps(props: PropPlacement[], detail: 'high' | 'low'): void {
    const byKind = new Map<PropKind, PropPlacement[]>();
    for (const p of props) {
      // phones keep the shrubs, which carry the colour, and skip the small furniture
      if (detail === 'low' && !LOW_PROPS.has(p.kind)) continue;
      const list = byKind.get(p.kind) ?? [];
      list.push(p);
      byKind.set(p.kind, list);
    }
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
    const tuftMap = tuftTexture();
    const tuftMaterial = new MeshStandardMaterial({
      map: tuftMap, alphaTest: 0.5, side: DoubleSide, roughness: 0.9, metalness: 0,
    });
    this.disposables.push(material, tuftMaterial, tuftMap);
    const m4 = new Matrix4();
    const q = new Quaternion();
    const Y = new Vector3(0, 1, 0);
    const pos = new Vector3();
    const sc = new Vector3();
    const tint = new Color();
    for (const [kind, list] of byKind) {
      const geometry = propGeometry(kind);
      const inst = new InstancedMesh(geometry, kind === 'tuft' ? tuftMaterial : material, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(Y, p.yaw);
        inst.setMatrixAt(i, m4.compose(pos.set(p.x, 0, p.z), q, sc.set(p.sx, p.sy, p.sz)));
        inst.setColorAt(i, tint.set(p.color));
      });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.frustumCulled = false;
      // grass tufts are too small to throw a shadow worth drawing
      inst.castShadow = detail === 'high' && kind !== 'tuft';
      inst.receiveShadow = detail === 'high';
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
