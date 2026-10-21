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
const BAKE_SCALE = detectQuality('').tier === 'high' ? 2 : 1;

function makeCanvas(size: number): [HTMLCanvasElement, Ctx] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * BAKE_SCALE;
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
