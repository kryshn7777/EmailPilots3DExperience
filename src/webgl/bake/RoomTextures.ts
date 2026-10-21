import { CanvasTexture, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';
import { detectQuality } from '../quality';
import { mulberry32 } from '../util';

/**
 * The study's surfaces: wood, paint, panelling, leather and wool, drawn once at
 * boot. Every set comes as colour plus a tangent-space normal map taken from the
 * same drawing, and where a surface is not uniformly glossy, a roughness map,
 * so light rakes across the grain and pools in the pores instead of sliding off
 * flat colour. Everything is seeded, so the room is the same room every load.
 */

export interface SurfaceMaps {
  map: CanvasTexture;
  normalMap: CanvasTexture;
  roughnessMap?: CanvasTexture;
}

type Ctx = CanvasRenderingContext2D;

// same bake scale as CanvasTextures; the contexts here are read back (normal and roughness
// maps come from the drawing), so they ask for a software canvas, where readback is cheap
const BAKE_SCALE = detectQuality('').tier === 'high' ? 2 : 1.5;

function makeCanvas(size: number): [HTMLCanvasElement, Ctx] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.round(size * BAKE_SCALE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d context unavailable');
  ctx.scale(BAKE_SCALE, BAKE_SCALE);
  return [canvas, ctx];
}

const TAU = Math.PI * 2;

function texture(canvas: HTMLCanvasElement, srgb: boolean, repeat = true): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** A blank canvas of the same pixel size as a `makeCanvas` one, drawn in 0..size units. */
function sibling(of: HTMLCanvasElement, size: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = of.width;
  c.height = of.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.scale(of.width / size, of.height / size);
  return [c, ctx];
}

/** Tangent-space normal map from the luminance of a drawing (periodic, so tiles stay seamless). */
function heightToNormal(src: HTMLCanvasElement, strength: number): CanvasTexture {
  const w = src.width;
  const h = src.height;
  const px = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = (px[i * 4]! * 0.3 + px[i * 4 + 1]! * 0.59 + px[i * 4 + 2]! * 0.11) / 255;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const ym = ((y + h - 1) % h) * w;
    const yp = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xm = (x + w - 1) % w;
      const xp = (x + 1) % w;
      const dx = lum[y * w + xp]! - lum[y * w + xm]!;
      const dy = lum[yp + x]! - lum[ym + x]!;
      let nx = -dx * strength;
      let ny = dy * strength;
      const inv = 1 / Math.hypot(nx, ny, 1);
      nx *= inv; ny *= inv;
      const o = (y * w + x) * 4;
      img.data[o] = (nx * 0.5 + 0.5) * 255;
      img.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[o + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return texture(out, false);
}

/** Roughness map: mid grey that follows the drawing's darkness (pores and gaps hold dirt, so run rougher). */
function roughnessFrom(src: HTMLCanvasElement, base: number, spread: number): CanvasTexture {
  const w = src.width;
  const h = src.height;
  const px = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const l = (px[i * 4]! * 0.3 + px[i * 4 + 1]! * 0.59 + px[i * 4 + 2]! * 0.11) / 255;
    const r = Math.min(1, Math.max(0.05, base + (0.5 - l) * spread));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = r * 255;
    img.data[i * 4 + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return texture(out, false);
}

const rgb = (c: [number, number, number], k = 1, a = 1): string =>
  `rgba(${Math.round(c[0] * k)}, ${Math.round(c[1] * k)}, ${Math.round(c[2] * k)}, ${a})`;

/**
 * Board by board, grain by grain: long wavy streaks that close on themselves
 * across the tile (whole numbers of periods), cathedral figure, the odd knot,
 * pores, and dark gaps between boards. `boards` is the number of planks across v;
 * `joints` how many butt joints each plank carries along u.
 */
function drawWood(
  ctx: Ctx, S: number, W: number, boards: number, base: [number, number, number],
  seed: number, joints: number, gap: number,
): void {
  const rand = mulberry32(seed);
  const bh = S / boards;
  for (let b = 0; b < boards; b++) {
    const y0 = b * bh;
    const tone = 0.82 + rand() * 0.36;
    const hue = (rand() - 0.5) * 14;
    // split the plank at its joints: each length is its own piece of timber
    const cuts = [0];
    for (let j = 0; j < joints; j++) cuts.push((j + 0.3 + rand() * 0.5) / joints * W);
    cuts.push(W);
    cuts.sort((a, c) => a - c);
    for (let k = 0; k < cuts.length - 1; k++) {
      const x0 = cuts[k]!;
      const x1 = cuts[k + 1]!;
      const t2 = tone * (0.93 + rand() * 0.14);
      ctx.fillStyle = rgb([base[0] + hue, base[1] + hue * 0.4, base[2] - hue * 0.5], t2);
      ctx.fillRect(x0, y0, x1 - x0, bh);
      // grain streaks, batched by style: one stroke per (tone, width) bucket, not one per streak
      const streaks = Math.round(bh * 1.2);
      const buckets = new Map<string, [number, number][][]>();
      for (let i = 0; i < streaks; i++) {
        const y = y0 + rand() * bh;
        const amp = 0.4 + rand() * 2.2;
        const k1 = 1 + Math.floor(rand() * 3);
        const k2 = 3 + Math.floor(rand() * 5);
        const p1 = rand() * TAU;
        const p2 = rand() * TAU;
        const dark = rand() < 0.62;
        const strong = rand() < 0.35;
        const wide = rand() < 0.3;
        const key = `${dark ? 'd' : 'l'}${strong ? 's' : 'w'}${wide ? 'w' : 'n'}`;
        const line: [number, number][] = [];
        for (let x = x0; x <= x1 + 12; x += 12) {
          const xx = Math.min(x, x1);
          line.push([xx, y + Math.sin((xx / W) * TAU * k1 + p1) * amp + Math.sin((xx / W) * TAU * k2 + p2) * amp * 0.35]);
        }
        const list = buckets.get(key);
        if (list) list.push(line); else buckets.set(key, [line]);
      }
      for (const [key, lines] of buckets) {
        const dark = key[0] === 'd';
        const strong = key[1] === 's';
        ctx.strokeStyle = dark
          ? `rgba(34, 18, 8, ${strong ? 0.17 : 0.07})`
          : `rgba(255, 224, 180, ${strong ? 0.09 : 0.04})`;
        ctx.lineWidth = key[2] === 'w' ? 1.5 : 0.6;
        ctx.beginPath();
        for (const line of lines) {
          ctx.moveTo(line[0]![0], line[0]![1]);
          for (let i = 1; i < line.length; i++) ctx.lineTo(line[i]![0], line[i]![1]);
        }
        ctx.stroke();
      }
      // pores: tiny dashes along the grain, in one fill
      ctx.fillStyle = 'rgba(30, 16, 6, 0.1)';
      ctx.beginPath();
      for (let i = 0; i < bh * (x1 - x0) / 60; i++) {
        ctx.rect(x0 + rand() * (x1 - x0), y0 + rand() * bh, 1 + rand() * 4, 0.6);
      }
      ctx.fill();
      // a knot now and then: rings pushed apart by the wobble of the grain
      if (rand() < 0.16 && x1 - x0 > W * 0.12) {
        const kx = x0 + (0.25 + rand() * 0.5) * (x1 - x0);
        const ky = y0 + (0.3 + rand() * 0.4) * bh;
        for (let r = 5; r > 0; r--) {
          ctx.strokeStyle = `rgba(40, 20, 8, ${0.10 + (5 - r) * 0.05})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.ellipse(kx, ky, r * 3.4, r * 1.4, 0, 0, TAU);
          ctx.stroke();
        }
      }
      // end-grain joint
      if (k > 0) {
        ctx.fillStyle = 'rgba(14, 7, 3, 0.85)';
        ctx.fillRect(x0 - gap / 2, y0, gap, bh);
      }
    }
    // gap between boards: dark line with a lit lip under it
    if (gap > 0) {
      ctx.fillStyle = 'rgba(12, 6, 2, 0.92)';
      ctx.fillRect(0, y0 - gap / 2, W, gap);
      ctx.fillStyle = 'rgba(255, 220, 170, 0.07)';
      ctx.fillRect(0, y0 + gap / 2, W, 1);
    }
  }
  // the wrap-around gap of the first board, drawn at the bottom edge
  if (gap > 0) {
    ctx.fillStyle = 'rgba(12, 6, 2, 0.92)';
    ctx.fillRect(0, S - gap / 2, W, gap / 2);
  }
}

/**
 * Timber for the desk, the floor and the cabinets. `boards` 1 is a single slab
 * with the grain running along u.
 */
export function woodMaps(opts: {
  boards: number; base: [number, number, number]; seed: number;
  joints?: number; gap?: number; roughness?: number; normal?: number;
}): Required<SurfaceMaps> {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S);
  drawWood(ctx, S, S, opts.boards, opts.base, opts.seed, opts.joints ?? 0, opts.gap ?? 0);
  // a light satin sheen: wipe-marks across the finish (hand polish), subtle
  const rand = mulberry32(opts.seed + 7);
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = `rgba(255, 238, 205, ${0.015 + rand() * 0.02})`;
    ctx.lineWidth = 8 + rand() * 18;
    ctx.beginPath();
    const y = rand() * S;
    ctx.moveTo(0, y + rand() * 40);
    ctx.lineTo(S, y - rand() * 40);
    ctx.stroke();
  }
  return {
    map: texture(canvas, true),
    normalMap: heightToNormal(canvas, opts.normal ?? 2.2),
    roughnessMap: roughnessFrom(canvas, opts.roughness ?? 0.5, 0.9),
  };
}

/** Painted plaster: soft trowel mottling and fine grit. */
export function plasterMaps(base: [number, number, number], seed: number): SurfaceMaps {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S);
  const rand = mulberry32(seed);
  ctx.fillStyle = rgb(base);
  ctx.fillRect(0, 0, S, S);
  // big soft clouds of lighter and darker paint, repeated across the tile edge so it still wraps
  for (let i = 0; i < 36; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 50 + rand() * 120;
    const light = rand() < 0.5;
    for (const ox of [-S, 0, S]) {
      if ((ox < 0 && x > r) || (ox > 0 && x < S - r)) continue;
      for (const oy of [-S, 0, S]) {
        if ((oy < 0 && y > r) || (oy > 0 && y < S - r)) continue;
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, light ? 'rgba(255, 248, 232, 0.06)' : 'rgba(40, 30, 20, 0.06)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
  // trowel and roller strokes
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(255, 246, 228, 0.035)' : 'rgba(30, 24, 16, 0.035)';
    ctx.lineWidth = 3 + rand() * 9;
    ctx.beginPath();
    const x = rand() * S;
    const y = rand() * S;
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 40 + rand() * 80, y + (rand() - 0.5) * 50, x + 80 + rand() * 120, y + (rand() - 0.5) * 30);
    ctx.stroke();
  }
  // grit, one fill per tone
  for (const fill of ['rgba(30, 24, 18, 0.08)', 'rgba(255, 250, 240, 0.08)']) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let i = 0; i < 2600; i++) ctx.rect(rand() * S, rand() * S, 0.8 + rand() * 1.4, 0.8 + rand() * 1.4);
    ctx.fill();
  }
  return { map: texture(canvas, true), normalMap: heightToNormal(canvas, 0.9) };
}

/**
 * Painted raised-panel wainscot: one bay (1.7 units wide, 2.0 tall) per tile —
 * stiles, rails, a bevelled panel field — with its own height map so the
 * mouldings throw real shadows under a raking lamp.
 */
export const WAINSCOT = { bayW: 1.7, height: 2.0 };
export function wainscotMaps(base: [number, number, number], seed: number): SurfaceMaps {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S);
  const [height, hctx] = sibling(canvas, S);
  const rand = mulberry32(seed);
  const stile = 34;
  const top = 46;
  const bottom = 98;
  const inset = 18;
  // paint with a little brush-stroke variation
  ctx.fillStyle = rgb(base);
  ctx.fillRect(0, 0, S, S);
  hctx.fillStyle = '#b4b4b4';
  hctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(255, 250, 238, 0.035)' : 'rgba(60, 44, 24, 0.035)';
    ctx.fillRect(rand() * S, rand() * S, 1.5 + rand() * 3, 20 + rand() * 60);
  }
  // the recessed field and its bevel
  const fx0 = stile + inset;
  const fx1 = S - stile - inset;
  const fy0 = top + inset;
  const fy1 = S - bottom - inset;
  const field = (g: Ctx, shade: string): void => {
    g.fillStyle = shade;
    g.fillRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
  };
  // bevel ramp: from the frame (high) down to the field (low), four mitred faces
  const bevel = (g: Ctx, hiSide: string, loSide: string): void => {
    const quad = (pts: number[][], fill: string): void => {
      g.fillStyle = fill;
      g.beginPath();
      g.moveTo(pts[0]![0]!, pts[0]![1]!);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0]!, pts[i]![1]!);
      g.closePath();
      g.fill();
    };
    quad([[fx0 - inset, fy0 - inset], [fx1 + inset, fy0 - inset], [fx1, fy0], [fx0, fy0]], hiSide);
    quad([[fx0 - inset, fy0 - inset], [fx0, fy0], [fx0, fy1], [fx0 - inset, fy1 + inset]], hiSide);
    quad([[fx1 + inset, fy0 - inset], [fx1 + inset, fy1 + inset], [fx1, fy1], [fx1, fy0]], loSide);
    quad([[fx0 - inset, fy1 + inset], [fx0, fy1], [fx1, fy1], [fx1 + inset, fy1 + inset]], loSide);
  };
  // colour: lit upper-left bevels, shaded lower-right ones
  bevel(ctx, 'rgba(255, 250, 238, 0.30)', 'rgba(50, 36, 20, 0.28)');
  field(ctx, 'rgba(60, 44, 24, 0.07)');
  // height: field low, bevel ramps
  bevel(hctx, '#8c8c8c', '#8c8c8c');
  field(hctx, '#5a5a5a');
  // a bead of moulding along the top rail and above the baseboard
  for (const [y, h] of [[top - 14, 7], [S - bottom + 10, 9]] as const) {
    ctx.fillStyle = 'rgba(255, 250, 238, 0.2)';
    ctx.fillRect(0, y, S, 2);
    ctx.fillStyle = 'rgba(50, 36, 20, 0.28)';
    ctx.fillRect(0, y + h, S, 3);
    hctx.fillStyle = '#d2d2d2';
    hctx.fillRect(0, y, S, h);
  }
  // shadow lines where the stiles meet the next bay
  ctx.fillStyle = 'rgba(40, 28, 14, 0.4)';
  ctx.fillRect(0, 0, 2, S);
  hctx.fillStyle = '#404040';
  hctx.fillRect(0, 0, 2, S);
  const t = (c: HTMLCanvasElement, srgb: boolean): CanvasTexture => texture(c, srgb);
  return { map: t(canvas, true), normalMap: heightToNormal(height, 3.2) };
}

/** Leather: pebbled grain, creases, a little wear on the high points. */
export function leatherMaps(base: [number, number, number], seed: number, tile = 512): SurfaceMaps {
  const [canvas, ctx] = makeCanvas(tile);
  const [height, hctx] = sibling(canvas, tile);
  const rand = mulberry32(seed);
  ctx.fillStyle = rgb(base);
  ctx.fillRect(0, 0, tile, tile);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, tile, tile);
  // pebbles: bright domes on the height map, a darker pore beside each, batched
  hctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  hctx.beginPath();
  ctx.fillStyle = 'rgba(20, 8, 2, 0.09)';
  ctx.beginPath();
  for (let i = 0; i < 5200; i++) {
    const x = rand() * tile;
    const y = rand() * tile;
    const r = 1.2 + rand() * 2.2;
    hctx.moveTo(x + r, y);
    hctx.arc(x, y, r, 0, TAU);
    ctx.rect(x + r * 0.4, y + r * 0.4, r * 0.8, r * 0.8);
  }
  hctx.fill();
  ctx.fill();
  for (let i = 0; i < 46; i++) {
    const x = rand() * tile;
    const y = rand() * tile;
    ctx.strokeStyle = `rgba(20, 8, 2, ${0.12 + rand() * 0.14})`;
    hctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = hctx.lineWidth = 0.9 + rand() * 1.3;
    for (const g of [ctx, hctx]) {
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + (rand() - 0.5) * 90, y + (rand() - 0.5) * 90, x + (rand() - 0.5) * 120, y + (rand() - 0.5) * 120);
      g.stroke();
    }
  }
  return { map: texture(canvas, true), normalMap: heightToNormal(height, 2.4), roughnessMap: roughnessFrom(height, 0.52, -0.5) };
}

/** A wool rug: oxblood field, cream and indigo borders, a lozenge medallion, woven pile. */
export function rugMaps(seed: number): SurfaceMaps {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S);
  const [height, hctx] = sibling(canvas, S);
  const rand = mulberry32(seed);
  const field = '#6b2a28';
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, S, S);
  hctx.fillStyle = '#909090';
  hctx.fillRect(0, 0, S, S);
  const band = (inset: number, w: number, colour: string): void => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = w;
    ctx.strokeRect(inset + w / 2, inset + w / 2, S - 2 * inset - w, S - 2 * inset - w);
  };
  band(14, 22, '#d6c39a');
  band(40, 10, '#26334f');
  band(56, 5, '#d6c39a');
  // lattice of small diamonds filling the field
  const step = 26;
  for (let y = 80; y < S - 80; y += step) {
    for (let x = 80; x < S - 80; x += step) {
      const odd = (((x - 80) / step + (y - 80) / step) | 0) % 2 === 0;
      ctx.fillStyle = odd ? 'rgba(214, 195, 154, 0.55)' : 'rgba(38, 51, 79, 0.55)';
      ctx.beginPath();
      ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y);
      ctx.closePath();
      ctx.fill();
    }
  }
  // the medallion
  const c = S / 2;
  for (const [r, col] of [[120, '#26334f'], [100, '#d6c39a'], [84, field], [58, '#26334f'], [40, '#c9a35c']] as const) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(c, c - r); ctx.lineTo(c + r, c); ctx.lineTo(c, c + r); ctx.lineTo(c - r, c);
    ctx.closePath();
    ctx.fill();
  }
  // woven pile: fine horizontal weft and a speckle of fibres
  for (let y = 0; y < S; y += 2) {
    ctx.fillStyle = `rgba(0, 0, 0, ${0.04 + (y % 4 === 0 ? 0.03 : 0)})`;
    ctx.fillRect(0, y, S, 1);
    hctx.fillStyle = y % 4 === 0 ? '#a0a0a0' : '#808080';
    hctx.fillRect(0, y, S, 1);
  }
  for (const fill of ['rgba(255, 240, 215, 0.06)', 'rgba(20, 8, 8, 0.07)']) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let i = 0; i < 3500; i++) ctx.rect(rand() * S, rand() * S, 1, 2);
    ctx.fill();
  }
  const maps: SurfaceMaps = { map: texture(canvas, true, false), normalMap: heightToNormal(height, 1.4) };
  maps.normalMap.wrapS = maps.normalMap.wrapT = RepeatWrapping;
  return maps;
}

/**
 * A glass curtain wall for the tower this study belongs to: 6 bays by 8 floors per tile,
 * dark reflective panes between metal mullions and spandrel bands, and a scatter of lit
 * offices (warm lamps, the odd cold television) as the emissive map.
 */
export const CURTAIN_WALL = { bays: 6, floors: 8, bayW: 1.5, floorH: 3.2 };
export function curtainWallMaps(seed: number): { map: CanvasTexture; emissiveMap: CanvasTexture } {
  const W = 256;
  const H = 512;
  const mk = (): [HTMLCanvasElement, Ctx] => {
    const c = document.createElement('canvas');
    c.width = Math.round(W * BAKE_SCALE);
    c.height = Math.round(H * BAKE_SCALE);
    const ctx = c.getContext('2d')!;
    ctx.scale(BAKE_SCALE, BAKE_SCALE);
    return [c, ctx];
  };
  const [colour, cctx] = mk();
  const [glow, gctx] = mk();
  const rand = mulberry32(seed);
  const cw = W / CURTAIN_WALL.bays;
  const rh = H / CURTAIN_WALL.floors;
  cctx.fillStyle = '#2b3550';
  cctx.fillRect(0, 0, W, H);
  gctx.fillStyle = '#000';
  gctx.fillRect(0, 0, W, H);
  const spandrel = rh * 0.22;
  for (let r = 0; r < CURTAIN_WALL.floors; r++) {
    for (let c = 0; c < CURTAIN_WALL.bays; c++) {
      const x = c * cw + 3;
      const y = r * rh + spandrel;
      const w = cw - 6;
      const h = rh - spandrel - 3;
      // the pane: a deep blue glass with a diagonal reflection of the sky
      const g = cctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, '#1a2640');
      g.addColorStop(0.5, '#0f1830');
      g.addColorStop(1, '#16213a');
      cctx.fillStyle = g;
      cctx.fillRect(x, y, w, h);
      cctx.fillStyle = 'rgba(150, 180, 230, 0.12)';
      cctx.beginPath();
      cctx.moveTo(x, y + h * 0.55);
      cctx.lineTo(x + w * 0.5, y);
      cctx.lineTo(x + w * 0.72, y);
      cctx.lineTo(x, y + h * 0.9);
      cctx.fill();
      // lit offices
      const roll = rand();
      if (roll < 0.2) {
        gctx.fillStyle = `rgba(255, 196, 132, ${0.55 + rand() * 0.4})`;
        gctx.fillRect(x, y, w, h);
        // a blind half drawn
        if (rand() < 0.4) { gctx.fillStyle = 'rgba(0,0,0,0.6)'; gctx.fillRect(x, y, w, h * (0.2 + rand() * 0.4)); }
      } else if (roll < 0.3) {
        gctx.fillStyle = 'rgba(140, 170, 255, 0.3)';
        gctx.fillRect(x + w * 0.2, y + h * 0.3, w * 0.6, h * 0.5);
      }
    }
    // the spandrel band: opaque painted metal, lighter at its lower lip
    cctx.fillStyle = '#313c58';
    cctx.fillRect(0, r * rh, W, spandrel);
    cctx.fillStyle = 'rgba(190, 205, 235, 0.25)';
    cctx.fillRect(0, r * rh + spandrel - 1.5, W, 1.5);
  }
  // mullions
  cctx.fillStyle = '#4a5878';
  for (let c = 0; c <= CURTAIN_WALL.bays; c++) cctx.fillRect(c * cw - 1.5, 0, 3, H);
  const t = (c: HTMLCanvasElement): CanvasTexture => {
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.anisotropy = 8;
    return tex;
  };
  return { map: t(colour), emissiveMap: t(glow) };
}

/**
 * City pavement: one tile of concrete slabs (a 4 x 4 grid of 1-unit slabs) with joints, tar
 * seams, stains, chewing-gum dots and worn corners, plus the normal and roughness maps from the
 * same drawing. Slightly wet: the lamps and neon streak in it.
 */
export function pavingMaps(seed: number): Required<SurfaceMaps> {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S);
  const rand = mulberry32(seed);
  const slab = S / 4;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = 70 + rand() * 22;
      ctx.fillStyle = `rgb(${v}, ${v + 1}, ${v + 4})`;
      ctx.fillRect(c * slab, r * slab, slab, slab);
      // a soft trowelled gradient across the slab
      const g = ctx.createLinearGradient(c * slab, r * slab, (c + 1) * slab, (r + 1) * slab);
      g.addColorStop(0, `rgba(255,255,255,${0.02 + rand() * 0.05})`);
      g.addColorStop(1, `rgba(0,0,0,${0.03 + rand() * 0.05})`);
      ctx.fillStyle = g;
      ctx.fillRect(c * slab, r * slab, slab, slab);
    }
  }
  // aggregate speckle, in two fills
  for (const fill of ['rgba(255,255,255,0.07)', 'rgba(0,0,0,0.1)']) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let i = 0; i < 4200; i++) ctx.rect(rand() * S, rand() * S, 0.8 + rand() * 1.3, 0.8 + rand() * 1.3);
    ctx.fill();
  }
  // oil and water stains
  for (let i = 0; i < 14; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const rad = 14 + rand() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(10, 12, 20, ${0.12 + rand() * 0.18})`);
    g.addColorStop(1, 'rgba(10, 12, 20, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // expansion joints with a darker, rougher seam, and the odd crack
  ctx.fillStyle = 'rgba(8, 9, 14, 0.92)';
  for (let i = 0; i <= 4; i++) {
    ctx.fillRect(i * slab - 1.5, 0, 3, S);
    ctx.fillRect(0, i * slab - 1.5, S, 3);
  }
  ctx.strokeStyle = 'rgba(8, 9, 14, 0.7)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    let x = rand() * S;
    let y = rand() * S;
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rand() - 0.5) * 30; y += (rand() - 0.2) * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return {
    map: texture(canvas, true),
    normalMap: heightToNormal(canvas, 3.4),
    roughnessMap: roughnessFrom(canvas, 0.46, 1.5),
  };
}

/** Large stone pavers for plazas: a running-bond of 2 x 1 units with a border band and a worn centre. */
export function plazaMaps(seed: number): Required<SurfaceMaps> {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S);
  const rand = mulberry32(seed);
  ctx.fillStyle = '#8a8478';
  ctx.fillRect(0, 0, S, S);
  const rowH = S / 4;
  for (let r = 0; r < 4; r++) {
    const shift = (r % 2) * (S / 4);
    for (let c = -1; c < 3; c++) {
      const x = c * (S / 2) + shift;
      const t = 0.82 + rand() * 0.3;
      ctx.fillStyle = `rgb(${Math.round(150 * t)}, ${Math.round(142 * t)}, ${Math.round(128 * t)})`;
      ctx.fillRect(x, r * rowH, S / 2, rowH);
    }
  }
  ctx.fillStyle = 'rgba(14, 12, 10, 0.85)';
  for (let r = 0; r <= 4; r++) ctx.fillRect(0, r * rowH - 1.5, S, 3);
  for (let r = 0; r < 4; r++) {
    const shift = (r % 2) * (S / 4);
    for (let c = -1; c < 3; c++) ctx.fillRect(c * (S / 2) + shift - 1.5, r * rowH, 3, rowH);
  }
  for (const fill of ['rgba(255,255,255,0.08)', 'rgba(0,0,0,0.12)']) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let i = 0; i < 3800; i++) ctx.rect(rand() * S, rand() * S, 0.8 + rand() * 1.4, 0.8 + rand() * 1.4);
    ctx.fill();
  }
  return {
    map: texture(canvas, true),
    normalMap: heightToNormal(canvas, 3.0),
    roughnessMap: roughnessFrom(canvas, 0.5, 1.2),
  };
}

// ------------------------------------------------------------------------------------------------
// The arrival laptop's screen: a mail client in two states. `idle` is an inbox with nothing new,
// waiting; `received` has the delivered mail at the top, selected, open in the reading pane, and a
// notification toast reading EMAIL RECEIVED. Same layout, so the swap is only the news.
// ------------------------------------------------------------------------------------------------

const SANS = '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, "JetBrains Mono", "DejaVu Sans Mono", monospace';

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface Mail { from: string; subject: string; preview: string; time: string; unread?: boolean; tag?: string; hue: number }

const OLDER: Mail[] = [
  { from: 'Ops Desk', subject: 'Weekly deliverability digest', preview: 'Inbox placement held at 98.6% across all seeds. Two soft bounces on…', time: '9:14 PM', hue: 200 },
  { from: 'Mara Quinn', subject: 'Re: Q4 launch sequence', preview: 'Love the new subject lines. Can we send the second wave at 6 a.m.…', time: '8:02 PM', hue: 330 },
  { from: 'DMARC Reports', subject: 'Aggregate report for emailpilots.dev', preview: '412 messages evaluated. SPF pass 100%, DKIM pass 100%, alignment…', time: '6:47 PM', hue: 140 },
  { from: 'Jon at Harbor Co.', subject: 'Your plane is cleared', preview: 'Thanks for flying with us. The runway lights are on and the tower…', time: '5:30 PM', hue: 30 },
  { from: 'Billing', subject: 'Receipt: Pilot plan (annual)', preview: 'Thanks for your payment. Your receipt for the overnight flight plan…', time: 'Tue', hue: 260 },
  { from: 'Priya N.', subject: 'Copilot notes from the storm', preview: 'Logged the turbulence at the second gate. Nothing alarming, but the…', time: 'Tue', hue: 10 },
];

/** The mail the dart delivers: the top row once it is inside, selected and open in the reading pane. */
const DELIVERED: Mail = {
  from: 'Email Pilots Delivery', subject: 'Delivered: your launch hit 12,408 inboxes',
  preview: 'SPF, DKIM and DMARC all passed. Not one bounce, not one spam flag…', time: 'now', unread: true, tag: 'NEW', hue: 168,
};
/** and the note from the flight itself, now second in the list */
const FLIGHT_NOTE: Mail = {
  from: 'The Overnight Flight', subject: 'Re: On time, in one piece',
  preview: 'Wheels down at 9:41 PM. The runway lights were on and the tower…', time: '9:41 PM', unread: true, hue: 215,
};

/** Cuts `text` with an ellipsis so it fits `maxW` pixels in the context's current font. */
function fit(ctx: Ctx, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

function drawMail(ctx: Ctx, W: number, H: number, state: 'idle' | 'received', rand: () => number): void {
  const received = state === 'received';
  // window: deep night-blue, a chrome bar, three folders' worth of sidebar, a list, a reading pane
  ctx.fillStyle = '#0b1019';
  ctx.fillRect(0, 0, W, H);
  // chrome
  ctx.fillStyle = '#121a28';
  ctx.fillRect(0, 0, W, 54);
  for (const [i, c] of ['#ff5f57', '#febc2e', '#28c840'].entries()) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(30 + i * 26, 27, 8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#9fb1cc';
  ctx.font = `600 22px ${SANS}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('Inbox', 126, 27);
  ctx.fillStyle = '#58698a';
  ctx.font = `400 20px ${SANS}`;
  ctx.fillText(received ? '130 messages · 5 unread' : '128 messages · 3 unread', 196, 27);
  // search box
  ctx.fillStyle = '#0b1019';
  rr(ctx, W - 330, 12, 300, 30, 15);
  ctx.fill();
  ctx.fillStyle = '#4b5b78';
  ctx.font = `400 18px ${SANS}`;
  ctx.fillText('Search mail', W - 300, 27);

  // sidebar
  const SB = 210;
  ctx.fillStyle = '#0e1523';
  ctx.fillRect(0, 54, SB, H - 54);
  ctx.fillStyle = '#1b6fe8';
  rr(ctx, 18, 72, SB - 36, 44, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `600 20px ${SANS}`;
  ctx.fillText('+  Compose', 40, 94);
  const folders: [string, string][] = [
    ['Inbox', received ? '5' : '3'], ['Starred', ''], ['Sent', ''], ['Drafts', '2'], ['Archive', ''], ['Spam', ''],
  ];
  folders.forEach(([name, count], i) => {
    const y = 140 + i * 46;
    if (i === 0) {
      ctx.fillStyle = 'rgba(80,140,255,0.16)';
      rr(ctx, 12, y - 6, SB - 24, 40, 8);
      ctx.fill();
    }
    ctx.fillStyle = i === 0 ? '#cfe0ff' : '#7e8fae';
    rr(ctx, 30, y + 6, 16, 16, 4);
    ctx.fill();
    ctx.font = `${i === 0 ? 600 : 400} 20px ${SANS}`;
    ctx.fillText(name, 62, y + 14);
    if (count) {
      ctx.textAlign = 'right';
      ctx.fillStyle = i === 0 ? '#8fb6ff' : '#58698a';
      ctx.fillText(count, SB - 28, y + 14);
      ctx.textAlign = 'left';
    }
  });
  ctx.fillStyle = '#58698a';
  ctx.font = `600 15px ${SANS}`;
  ctx.fillText('LABELS', 30, 440);
  for (const [i, [name, c]] of ([['Customers', '#4ade80'], ['Campaigns', '#f59e0b'], ['Flight log', '#38bdf8']] as const).entries()) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(38, 478 + i * 36, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7e8fae';
    ctx.font = `400 19px ${SANS}`;
    ctx.fillText(name, 56, 478 + i * 36);
  }

  // message list
  const LX = SB;
  const LW = 420;
  ctx.fillStyle = '#0d131f';
  ctx.fillRect(LX, 54, LW, H - 54);
  ctx.fillStyle = '#1b2539';
  ctx.fillRect(LX + LW - 1, 54, 1, H - 54);
  const list = received ? [DELIVERED, FLIGHT_NOTE, ...OLDER] : OLDER;
  const ROW = 84;
  list.slice(0, 7).forEach((m, i) => {
    const y = 54 + i * ROW;
    const selected = received && i === 0;
    if (selected) {
      ctx.fillStyle = 'rgba(70,140,255,0.2)';
      ctx.fillRect(LX, y, LW - 1, ROW);
      ctx.fillStyle = '#4c9dff';
      ctx.fillRect(LX, y, 4, ROW);
    }
    ctx.fillStyle = '#1b2539';
    ctx.fillRect(LX + 14, y + ROW - 1, LW - 28, 1);
    // avatar
    ctx.fillStyle = `hsl(${m.hue} 55% 42%)`;
    ctx.beginPath();
    ctx.arc(LX + 44, y + 36, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `700 22px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(m.from[0]!, LX + 44, y + 37);
    ctx.textAlign = 'left';
    const unread = m.unread || (!received && i < 3) || (received && i > 1 && i < 4);
    ctx.fillStyle = unread ? '#f2f6ff' : '#9fb1cc';
    ctx.font = `${unread ? 700 : 500} 20px ${SANS}`;
    ctx.fillText(m.from, LX + 84, y + 26);
    ctx.fillStyle = unread ? '#c4d4f2' : '#7e8fae';
    ctx.font = `${unread ? 600 : 400} 18px ${SANS}`;
    ctx.fillText(fit(ctx, m.subject, LW - 84 - 22), LX + 84, y + 52);
    ctx.fillStyle = '#58698a';
    ctx.font = `400 16px ${SANS}`;
    ctx.fillText(fit(ctx, m.preview, LW - 84 - (m.tag ? 76 : 22)), LX + 84, y + 74);
    ctx.textAlign = 'right';
    ctx.fillStyle = unread ? '#8fb6ff' : '#58698a';
    ctx.font = `500 16px ${SANS}`;
    ctx.fillText(m.time, LX + LW - 18, y + 26);
    ctx.textAlign = 'left';
    if (m.tag) {
      ctx.fillStyle = '#19c8a7';
      rr(ctx, LX + LW - 64, y + 56, 46, 22, 6);
      ctx.fill();
      ctx.fillStyle = '#04221c';
      ctx.font = `800 13px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText(m.tag, LX + LW - 41, y + 68);
      ctx.textAlign = 'left';
    }
    if (unread && !m.tag) {
      ctx.fillStyle = '#4c9dff';
      ctx.beginPath();
      ctx.arc(LX + LW - 28, y + 54, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // reading pane
  const PX = LX + LW;
  const PW = W - PX;
  ctx.fillStyle = '#0b1019';
  ctx.fillRect(PX, 54, PW, H - 54);
  if (!received) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#26324a';
    ctx.font = `400 22px ${SANS}`;
    ctx.fillText('Select a message to read', PX + PW / 2, H / 2 - 10);
    ctx.fillStyle = '#3a4a68';
    ctx.font = `400 17px ${MONO}`;
    ctx.fillText('Waiting for the next delivery' + '.'.repeat(1 + Math.floor(rand() * 3)), PX + PW / 2, H / 2 + 26);
    ctx.textAlign = 'left';
  } else {
    ctx.fillStyle = '#eaf1ff';
    ctx.font = `700 26px ${SANS}`;
    ctx.fillText(fit(ctx, DELIVERED.subject, PW - 64), PX + 32, 108);
    ctx.fillStyle = `hsl(${DELIVERED.hue} 55% 42%)`;
    ctx.beginPath();
    ctx.arc(PX + 52, 168, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `700 22px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('E', PX + 52, 169);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#d4e0f8';
    ctx.font = `600 20px ${SANS}`;
    ctx.fillText(DELIVERED.from, PX + 88, 160);
    ctx.fillStyle = '#6b7c9c';
    ctx.font = `400 17px ${SANS}`;
    ctx.fillText('to me  ·  just now', PX + 88, 184);
    // the body: real words, then lines of grey for the rest
    ctx.fillStyle = '#b8c7e4';
    ctx.font = `400 21px ${SANS}`;
    ctx.fillText('Hi Captain,', PX + 32, 244);
    ctx.fillText('Your launch took off at 9:41 PM and landed', PX + 32, 278);
    ctx.fillText('in 12,408 inboxes, right on time.', PX + 32, 306);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = '#1e2a40';
      rr(ctx, PX + 32, 340 + i * 26, PW - 64 - (i === 3 ? 160 : rand() * 60), 12, 6);
      ctx.fill();
    }
    // the authentication results
    ctx.fillStyle = '#0f1828';
    rr(ctx, PX + 32, 482, PW - 64, 104, 12);
    ctx.fill();
    ctx.strokeStyle = '#1e3150';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    for (const [i, [k, v]] of ([['SPF', 'PASS'], ['DKIM', 'PASS'], ['DMARC', 'ALIGNED']] as const).entries()) {
      const x = PX + 56 + i * ((PW - 96) / 3);
      ctx.fillStyle = '#6b7c9c';
      ctx.font = `600 15px ${SANS}`;
      ctx.fillText(k, x, 514);
      ctx.fillStyle = '#4ade80';
      ctx.font = `700 24px ${MONO}`;
      ctx.fillText('✓ ' + v, x, 550);
    }
  }

  // status bar
  ctx.fillStyle = '#0e1523';
  ctx.fillRect(0, H - 30, W, 30);
  ctx.fillStyle = '#58698a';
  ctx.font = `400 15px ${SANS}`;
  ctx.fillText(received ? 'Delivered just now · all systems normal' : 'Connected · syncing every 5 s', 18, H - 15);
  ctx.fillStyle = received ? '#4ade80' : '#f59e0b';
  ctx.beginPath();
  ctx.arc(W - 24, H - 15, 5, 0, Math.PI * 2);
  ctx.fill();

  if (received) {
    // the toast: bright, top right, over the whole window
    const tw = 360;
    const tx = W - tw - 28;
    const ty = 70;
    const glow = ctx.createRadialGradient(tx + tw / 2, ty + 32, 20, tx + tw / 2, ty + 32, 260);
    glow.addColorStop(0, 'rgba(60, 255, 214, 0.28)');
    glow.addColorStop(1, 'rgba(60, 255, 214, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(tx - 200, ty - 120, tw + 400, 320);
    ctx.fillStyle = '#07221f';
    rr(ctx, tx, ty, tw, 68, 14);
    ctx.fill();
    ctx.strokeStyle = '#19e0bb';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#19e0bb';
    rr(ctx, tx + 16, ty + 16, 36, 36, 9);
    ctx.fill();
    ctx.fillStyle = '#04221c';
    ctx.font = `800 22px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('✉', tx + 34, ty + 35);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#c9fff3';
    ctx.font = `800 24px ${SANS}`;
    ctx.fillText('EMAIL RECEIVED', tx + 68, ty + 28);
    ctx.fillStyle = '#6fb9ab';
    ctx.font = `400 16px ${SANS}`;
    ctx.fillText('Email Pilots Delivery · now', tx + 68, ty + 52);
  }
}

/** Both states of the arrival laptop's display, 1.48:1 (the Blender laptop's panel). */
export function arrivalScreens(): { idle: CanvasTexture; received: CanvasTexture } {
  const W = 1024;
  const H = 692;
  const make = (state: 'idle' | 'received'): CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    drawMail(ctx, W, H, state, mulberry32(state === 'idle' ? 11 : 23));
    // a faint pixel grid and a vignette make a screen read as a screen up close
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { idle: make('idle'), received: make('received') };
}
