/**
 * Tileable 3D noise for the raymarched cloud slab. Pure maths, no three.js and no DOM, so it runs
 * in a worker (cloudNoise.worker.ts) and under plain Node for inspection.
 *
 * Two volumes, both RGBA8 and periodic on every axis:
 *
 *  shape  (SHAPE_SIZE³)   R  Perlin-Worley: a Perlin fbm pushed up by the Worley fbm, the
 *                            billowy base every cumulus is cut from
 *                         G  Worley, 4 cells    B  Worley, 8 cells    A  Worley, 16 cells
 *  detail (DETAIL_SIZE³)  R  Worley, 4 cells    G  Worley, 8 cells    B  Worley, 16 cells
 *                            (A unused) the fine cauliflower the shape is eroded with
 *
 * Worley values are inverted (1 at a feature point), so a sum of them reads as puffs rather than
 * cells. The raymarch (cloudVolume.frag.glsl) used to evaluate three simplex octaves per step;
 * these turn that into one filtered fetch.
 */

export const SHAPE_SIZE = 64;
export const DETAIL_SIZE = 32;

/** 32-bit integer lattice hash to [0, 1) */
function hash(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1103515245) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  h = Math.imul(h, 2654435761);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** feature points of a periodic Worley lattice: `cells`³ jittered points, one per cell */
function featurePoints(cells: number, seed: number): Float32Array {
  const pts = new Float32Array(cells * cells * cells * 3);
  let i = 0;
  for (let z = 0; z < cells; z++) {
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        pts[i++] = hash(x, y, z, seed * 3 + 0);
        pts[i++] = hash(x, y, z, seed * 3 + 1);
        pts[i++] = hash(x, y, z, seed * 3 + 2);
      }
    }
  }
  return pts;
}

/** inverted F1 Worley at (u,v,w) in [0,1)³, periodic over `cells` cells per axis */
function worley(pts: Float32Array, cells: number, u: number, v: number, w: number): number {
  const px = u * cells;
  const py = v * cells;
  const pz = w * cells;
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  const cz = Math.floor(pz);
  let best = 8;
  for (let dz = -1; dz <= 1; dz++) {
    const nz = cz + dz;
    const wz = (nz + cells) % cells;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy;
      const wy = (ny + cells) % cells;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        const wx = (nx + cells) % cells;
        const k = ((wz * cells + wy) * cells + wx) * 3;
        const ex = nx + pts[k]! - px;
        const ey = ny + pts[k + 1]! - py;
        const ez = nz + pts[k + 2]! - pz;
        const d = ex * ex + ey * ey + ez * ez;
        if (d < best) best = d;
      }
    }
  }
  return Math.max(0, 1 - Math.sqrt(best));
}

/** gradient directions of a periodic Perlin lattice: `cells`³ unit vectors */
function gradients(cells: number, seed: number): Float32Array {
  const g = new Float32Array(cells * cells * cells * 3);
  let i = 0;
  for (let z = 0; z < cells; z++) {
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        // uniform on the sphere
        const a = hash(x, y, z, seed * 5 + 0) * 2 - 1;
        const b = hash(x, y, z, seed * 5 + 1) * Math.PI * 2;
        const r = Math.sqrt(1 - a * a);
        g[i++] = r * Math.cos(b);
        g[i++] = r * Math.sin(b);
        g[i++] = a;
      }
    }
  }
  return g;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** periodic gradient noise, ~[-1, 1] */
function perlin(g: Float32Array, cells: number, u: number, v: number, w: number): number {
  const px = u * cells;
  const py = v * cells;
  const pz = w * cells;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const z0 = Math.floor(pz);
  const fx = px - x0;
  const fy = py - y0;
  const fz = pz - z0;
  const corner = (ix: number, iy: number, iz: number): number => {
    const wx = (x0 + ix) % cells;
    const wy = (y0 + iy) % cells;
    const wz = (z0 + iz) % cells;
    const k = ((wz * cells + wy) * cells + wx) * 3;
    return g[k]! * (fx - ix) + g[k + 1]! * (fy - iy) + g[k + 2]! * (fz - iz);
  };
  const sx = fade(fx);
  const sy = fade(fy);
  const sz = fade(fz);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const x00 = lerp(corner(0, 0, 0), corner(1, 0, 0), sx);
  const x10 = lerp(corner(0, 1, 0), corner(1, 1, 0), sx);
  const x01 = lerp(corner(0, 0, 1), corner(1, 0, 1), sx);
  const x11 = lerp(corner(0, 1, 1), corner(1, 1, 1), sx);
  return lerp(lerp(x00, x10, sy), lerp(x01, x11, sy), sz) * 1.6;
}

const byte = (x: number): number => Math.max(0, Math.min(255, Math.round(x * 255)));

/** the base shape volume: SHAPE_SIZE³ RGBA8 */
export function bakeShape(size = SHAPE_SIZE): Uint8Array {
  const out = new Uint8Array(size * size * size * 4);
  const w4 = featurePoints(4, 1);
  const w8 = featurePoints(8, 2);
  const w16 = featurePoints(16, 3);
  const p4 = gradients(4, 4);
  const p8 = gradients(8, 5);
  const p16 = gradients(16, 6);
  let o = 0;
  for (let z = 0; z < size; z++) {
    const w = z / size;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const a = worley(w4, 4, u, v, w);
        const b = worley(w8, 8, u, v, w);
        const c = worley(w16, 16, u, v, w);
        // Perlin fbm to [0, 1], then lifted toward 1 by the Worley fbm: Perlin-Worley
        const pf =
          (0.5 * perlin(p4, 4, u, v, w) + 0.3 * perlin(p8, 8, u, v, w) + 0.2 * perlin(p16, 16, u, v, w)) * 0.5 + 0.5;
        const wf = 0.625 * a + 0.25 * b + 0.125 * c;
        const pw = wf + Math.max(0, Math.min(1, pf)) * (1 - wf);
        out[o++] = byte(pw);
        out[o++] = byte(a);
        out[o++] = byte(b);
        out[o++] = byte(c);
      }
    }
  }
  return out;
}

/** the erosion volume: DETAIL_SIZE³ RGBA8 */
export function bakeDetail(size = DETAIL_SIZE): Uint8Array {
  const out = new Uint8Array(size * size * size * 4);
  const w4 = featurePoints(4, 11);
  const w8 = featurePoints(8, 12);
  const w16 = featurePoints(16, 13);
  let o = 0;
  for (let z = 0; z < size; z++) {
    const w = z / size;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        out[o++] = byte(worley(w4, 4, u, v, w));
        out[o++] = byte(worley(w8, 8, u, v, w));
        out[o++] = byte(worley(w16, 16, u, v, w));
        out[o++] = 255;
      }
    }
  }
  return out;
}
