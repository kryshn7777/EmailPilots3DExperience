import { CanvasTexture, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';
import { detectQuality } from '../quality';
import { mulberry32 } from '../util';
import { heightToNormal, roughnessFrom, type SurfaceMaps } from './RoomTextures';

/**
 * The study's drawn surfaces (beyond RoomTextures' wood, plaster and leather): herringbone
 * parquet, the rug, the paintings, drapery, the clock dial, the books' spines and the light
 * shafts. Seeded and drawn once at boot, like everything else in the room.
 */

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
const BAKE = detectQuality('').tier === 'high' ? 2 : 1.5;

/** a canvas of w x h drawing units, backed by BAKE pixels per unit */
export function canvasWH(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = Math.round(w * BAKE);
  c.height = Math.round(h * BAKE);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d context unavailable');
  ctx.scale(BAKE, BAKE);
  return [c, ctx];
}

export function tex(c: HTMLCanvasElement, srgb = true, repeat = false): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const hsl = (h: number, s: number, l: number, a = 1): string => `hsla(${h}, ${s}%, ${l}%, ${a})`;

/** Herringbone oak parquet: 8 x 8 cells of 4:1 planks per tile. Rotate the UVs 45 degrees to lay the zigzag along the room. */
export function herringboneMaps(seed: number): Required<SurfaceMaps> {
  const U = 512;
  const cell = U / 8;
  const [canvas, ctx] = canvasWH(U, U);
  const [hc, hctx] = canvasWH(U, U);
  const rand = mulberry32(seed);
  hctx.fillStyle = '#202020';
  hctx.fillRect(0, 0, U, U);
  ctx.fillStyle = '#2a1a0e';
  ctx.fillRect(0, 0, U, U);
  const plank = (x: number, y: number, w: number, h: number, hue: number, light: number, horiz: boolean): void => {
    const g = ctx.createLinearGradient(x, y, x + (horiz ? w : 0), y + (horiz ? 0 : h));
    g.addColorStop(0, hsl(hue, 42, light + 3));
    g.addColorStop(0.5, hsl(hue + 2, 40, light - 2));
    g.addColorStop(1, hsl(hue - 1, 44, light + 1));
    ctx.fillStyle = g;
    ctx.fillRect(x + 1.2, y + 1.2, w - 2.4, h - 2.4);
    hctx.fillStyle = '#9a9a9a';
    hctx.fillRect(x + 1.6, y + 1.6, w - 3.2, h - 3.2);
    // grain along the plank
    for (let i = 0; i < 16; i++) {
      const o = 3 + rand() * ((horiz ? h : w) - 6);
      ctx.strokeStyle = rand() < 0.5 ? `rgba(60, 34, 14, ${0.1 + rand() * 0.18})` : `rgba(255, 226, 170, ${0.05 + rand() * 0.1})`;
      ctx.lineWidth = 0.4 + rand() * 0.9;
      ctx.beginPath();
      if (horiz) { ctx.moveTo(x + 2, y + o); ctx.bezierCurveTo(x + w * 0.3, y + o + (rand() - 0.5) * 3, x + w * 0.7, y + o + (rand() - 0.5) * 3, x + w - 2, y + o); }
      else { ctx.moveTo(x + o, y + 2); ctx.bezierCurveTo(x + o + (rand() - 0.5) * 3, y + h * 0.3, x + o + (rand() - 0.5) * 3, y + h * 0.7, x + o, y + h - 2); }
      ctx.stroke();
      hctx.strokeStyle = `rgba(0,0,0,${0.12 + rand() * 0.1})`;
      hctx.lineWidth = 0.5;
      hctx.beginPath();
      if (horiz) { hctx.moveTo(x + 2, y + o); hctx.lineTo(x + w - 2, y + o + (rand() - 0.5) * 2); }
      else { hctx.moveTo(x + o, y + 2); hctx.lineTo(x + o + (rand() - 0.5) * 2, y + h - 2); }
      hctx.stroke();
    }
    // worn bevel catching light at the long edges
    ctx.fillStyle = 'rgba(255, 230, 180, 0.12)';
    if (horiz) ctx.fillRect(x + 1.2, y + 1.2, w - 2.4, 1.2); else ctx.fillRect(x + 1.2, y + 1.2, 1.2, h - 2.4);
  };
  for (let k = 0; k < 8; k++) {
    const hueA = 28 + rand() * 7;
    const lightA = 36 + rand() * 14;
    const hueB = 28 + rand() * 7;
    const lightB = 36 + rand() * 14;
    for (const ox of [-U, 0, U]) {
      for (const oy of [-U, 0, U]) {
        ctx.save(); hctx.save();
        ctx.translate(ox, oy); hctx.translate(ox, oy);
        plank(k * cell, k * cell, cell * 4, cell, hueA, lightA, true);
        plank(((k + 4) % 8) * cell, (k - 3) * cell, cell, cell * 4, hueB, lightB, false);
        ctx.restore(); hctx.restore();
      }
    }
  }
  // the room's dust and a satin sheen
  const normalMap = heightToNormal(hc, 4.2);
  return { map: tex(canvas, true, true), normalMap, roughnessMap: roughnessFrom(hc, 0.44, -0.5) };
}

/** The wool rug, one non-repeating drawing: madder field, indigo and ivory borders, a lobed medallion, worn pile. */
export function studyRugMaps(seed: number): { map: CanvasTexture; normalMap: CanvasTexture } {
  const W = 640;
  const H = 540;
  const [canvas, ctx] = canvasWH(W, H);
  const rand = mulberry32(seed);
  const field = '#74302b';
  const indigo = '#243457';
  const ivory = '#dccfae';
  const gold = '#c19a4e';
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, W, H);
  // abrash: bands of slightly different dye
  for (let y = 0; y < H; y += 6) {
    ctx.fillStyle = `rgba(${rand() < 0.5 ? '255, 160, 120' : '30, 8, 8'}, ${0.02 + rand() * 0.05})`;
    ctx.fillRect(0, y, W, 6 + rand() * 18);
  }
  const rect = (i: number, w: number, col: string): void => {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.strokeRect(i + w / 2, i + w / 2, W - 2 * i - w, H - 2 * i - w);
  };
  // borders, outside in: ivory selvedge, indigo main band, guard stripes
  rect(0, 14, ivory);
  ctx.fillStyle = indigo;
  ctx.fillRect(18, 18, W - 36, 78);
  ctx.fillStyle = field;
  ctx.fillRect(18 + 78, 18 + 78, W - 36 - 156, H - 36 - 156);
  // the main band is a frame: draw it as four strips so the field stays clear
  ctx.fillStyle = field;
  ctx.fillRect(96, 96, W - 192, H - 192);
  ctx.fillStyle = indigo;
  ctx.fillRect(18, 96, 78, H - 192);
  ctx.fillRect(W - 96, 96, 78, H - 192);
  ctx.fillRect(18, H - 96, W - 36, 78);
  rect(100, 5, ivory);
  rect(110, 3, gold);
  rect(14, 4, gold);
  // rosettes round the band
  const rosette = (cx: number, cy: number, r: number, col: string, core: string): void => {
    ctx.fillStyle = col;
    for (let p = 0; p < 8; p++) {
      const a = (p / 8) * TAU;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.42, r * 0.2, a, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.28, 0, TAU);
    ctx.fill();
  };
  const bandX = (y: number): void => {
    for (let x = 40; x < W - 30; x += 28) { rosette(x, y, 10, ivory, gold); }
    for (let x = 54; x < W - 50; x += 28) { ctx.fillStyle = '#5b2530'; ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 7, y); ctx.fill(); }
  };
  const bandY = (x: number): void => {
    for (let y = 134; y < H - 120; y += 28) rosette(x, y, 10, ivory, gold);
  };
  bandX(57); bandX(H - 57); bandY(57); bandY(W - 57);
  for (const [cx, cy] of [[57, 57], [W - 57, 57], [57, H - 57], [W - 57, H - 57]] as const) rosette(cx, cy, 22, gold, indigo);
  // field lattice of small lozenges
  const step = 30;
  for (let y = 130; y < H - 120; y += step) {
    for (let x = 130; x < W - 120; x += step) {
      const odd = (((x - 130) / step + (y - 130) / step) | 0) % 2 === 0;
      ctx.fillStyle = odd ? 'rgba(220, 207, 174, 0.38)' : 'rgba(36, 52, 87, 0.5)';
      ctx.beginPath();
      ctx.moveTo(x, y - 8); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 8, y); ctx.fill();
    }
  }
  // medallion
  const cx = W / 2;
  const cy = H / 2;
  const lobed = (r: number, col: string): void => {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * TAU;
      const rr = r * (0.86 + 0.14 * Math.abs(Math.cos(a * 2))) * (1 + 0.04 * Math.cos(a * 8));
      const px = cx + Math.cos(a) * rr * 1.3;
      const py = cy + Math.sin(a) * rr * 0.92;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.fill();
  };
  lobed(150, indigo); lobed(132, ivory); lobed(120, field); lobed(86, indigo); lobed(70, '#8c3a30'); lobed(38, gold);
  rosette(cx, cy, 34, ivory, indigo);
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    // corner spandrels
    ctx.fillStyle = indigo;
    ctx.beginPath();
    ctx.moveTo(cx + s * (W / 2 - 112), cy + t * (H / 2 - 112));
    ctx.lineTo(cx + s * (W / 2 - 112 - 90), cy + t * (H / 2 - 112));
    ctx.quadraticCurveTo(cx + s * (W / 2 - 112 - 30), cy + t * (H / 2 - 112 - 30), cx + s * (W / 2 - 112), cy + t * (H / 2 - 112 - 70));
    ctx.fill();
  }
  // wear and fibre
  for (let i = 0; i < 26; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    const x = rand() * W;
    const y = rand() * H;
    const r = 30 + rand() * 80;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(r * (0.8 + rand()), r * 0.5);
    g.addColorStop(0, rand() < 0.5 ? 'rgba(255, 240, 215, 0.07)' : 'rgba(10, 4, 4, 0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
    ctx.restore();
  }
  for (let y = 0; y < H; y += 2) { ctx.fillStyle = `rgba(0, 0, 0, ${0.035 + (y % 4 === 0 ? 0.03 : 0)})`; ctx.fillRect(0, y, W, 1); }
  for (const fill of ['rgba(255, 240, 215, 0.07)', 'rgba(20, 8, 8, 0.08)']) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let i = 0; i < 6000; i++) ctx.rect(rand() * W, rand() * H, 1, 2);
    ctx.fill();
  }
  const [hc, hx] = canvasWH(W, H);
  hx.fillStyle = '#808080';
  hx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 2) { hx.fillStyle = y % 4 === 0 ? '#a4a4a4' : '#767676'; hx.fillRect(0, y, W, 1); }
  hx.fillStyle = 'rgba(255,255,255,0.18)';
  hx.beginPath();
  for (let i = 0; i < 9000; i++) hx.rect(rand() * W, rand() * H, 1, 1.6);
  hx.fill();
  return { map: tex(canvas, true), normalMap: heightToNormal(hc, 1.6) };
}

/** the fringe: cream tassels on an alpha channel, tiling along u */
export function fringeTexture(): CanvasTexture {
  const [c, ctx] = canvasWH(128, 32);
  ctx.strokeStyle = '#e4d8b8';
  for (let i = 0; i < 16; i++) {
    const x = 4 + i * 8;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + (i % 3 - 1) * 3, 10, x - (i % 2 ? 4 : -3), 20, x + (i % 4 - 1.5) * 2, 32);
    ctx.stroke();
    ctx.strokeStyle = i % 2 ? '#d6c9a6' : '#ece2c6';
  }
  const t = tex(c, true, true);
  return t;
}

/** Oil paintings, antique map and botanical plates; `normal` adds brush relief for the HIGH tier. */
export function paintingTexture(kind: 'lighthouse' | 'map' | 'plate' | 'plate2', normal: boolean): { map: CanvasTexture; normalMap: CanvasTexture | null } {
  const W = kind === 'lighthouse' ? 560 : kind === 'map' ? 480 : 300;
  const H = kind === 'lighthouse' ? 380 : kind === 'map' ? 340 : 400;
  const [c, ctx] = canvasWH(W, H);
  const rand = mulberry32(kind.length * 97 + 11);
  const stroke = (x: number, y: number, len: number, th: number, col: string, ang = 0): void => {
    ctx.strokeStyle = col;
    ctx.lineWidth = th;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  };
  if (kind === 'lighthouse') {
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.62);
    sky.addColorStop(0, '#16304a'); sky.addColorStop(0.5, '#6d6f86'); sky.addColorStop(0.82, '#e59a5c'); sky.addColorStop(1, '#f4cf8e');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H * 0.62);
    const sun = ctx.createRadialGradient(W * 0.72, H * 0.58, 4, W * 0.72, H * 0.58, 150);
    sun.addColorStop(0, 'rgba(255, 240, 200, 0.95)'); sun.addColorStop(1, 'rgba(255, 200, 120, 0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H * 0.8);
    for (let i = 0; i < 26; i++) stroke(rand() * W, 20 + rand() * H * 0.4, 50 + rand() * 120, 6 + rand() * 12, `rgba(${200 + rand() * 40 | 0}, ${150 + rand() * 40 | 0}, ${150 + rand() * 40 | 0}, 0.2)`, (rand() - 0.5) * 0.14);
    const sea = ctx.createLinearGradient(0, H * 0.6, 0, H);
    sea.addColorStop(0, '#d89864'); sea.addColorStop(0.18, '#3c5a72'); sea.addColorStop(1, '#0e2234');
    ctx.fillStyle = sea; ctx.fillRect(0, H * 0.6, W, H * 0.4);
    for (let i = 0; i < 520; i++) {
      const y = H * 0.6 + rand() * H * 0.4;
      const k = (y - H * 0.6) / (H * 0.4);
      stroke(rand() * W, y, 14 + rand() * 50 * (0.4 + k), 1.5 + k * 4, rand() < 0.2 ? `rgba(255, 230, 190, ${0.16 + rand() * 0.2})` : `rgba(10, 30, 50, ${0.16 + rand() * 0.2})`, (rand() - 0.5) * 0.08);
    }
    // the rock, the tower and the lantern
    ctx.fillStyle = '#1a1a22';
    ctx.beginPath(); ctx.moveTo(W * 0.14, H * 0.78); ctx.lineTo(W * 0.2, H * 0.6); ctx.lineTo(W * 0.3, H * 0.52); ctx.lineTo(W * 0.4, H * 0.62); ctx.lineTo(W * 0.5, H * 0.8); ctx.fill();
    const tx = W * 0.3;
    ctx.fillStyle = '#e8e2d2';
    ctx.beginPath(); ctx.moveTo(tx - 15, H * 0.54); ctx.lineTo(tx - 8, H * 0.2); ctx.lineTo(tx + 8, H * 0.2); ctx.lineTo(tx + 15, H * 0.54); ctx.fill();
    ctx.fillStyle = '#b63f35';
    ctx.fillRect(tx - 12, H * 0.34, 24, 13); ctx.fillRect(tx - 14, H * 0.46, 28, 11);
    ctx.fillStyle = '#25252d'; ctx.fillRect(tx - 11, H * 0.18, 22, 5); ctx.fillRect(tx - 9, H * 0.12, 18, 3);
    ctx.fillStyle = '#ffe9a8'; ctx.fillRect(tx - 7, H * 0.143, 14, 7);
    const beam = ctx.createLinearGradient(tx, 0, W, 0);
    beam.addColorStop(0, 'rgba(255, 236, 170, 0.5)'); beam.addColorStop(1, 'rgba(255, 236, 170, 0)');
    ctx.fillStyle = beam;
    ctx.beginPath(); ctx.moveTo(tx, H * 0.15); ctx.lineTo(W, H * 0.02); ctx.lineTo(W, H * 0.3); ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    for (let i = 0; i < 40; i++) ctx.fillRect(W * 0.1 + rand() * W * 0.5, H * 0.72 + rand() * H * 0.12, 6 + rand() * 18, 1.5);
  } else if (kind === 'map') {
    ctx.fillStyle = '#d9c291'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 160; i++) { ctx.fillStyle = `rgba(${90 + rand() * 40 | 0}, ${60 + rand() * 30 | 0}, 20, ${0.03 + rand() * 0.05})`; ctx.beginPath(); ctx.arc(rand() * W, rand() * H, 8 + rand() * 40, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = 'rgba(80, 52, 24, 0.35)'; ctx.lineWidth = 0.7;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.fillStyle = '#b9a56f';
    for (const [bx, by, br] of [[130, 150, 70], [330, 120, 55], [250, 250, 62], [400, 250, 36], [90, 270, 34]] as const) {
      ctx.beginPath();
      for (let i = 0; i <= 28; i++) { const a = (i / 28) * TAU; const rr = br * (0.7 + rand() * 0.5); const px = bx + Math.cos(a) * rr * 1.3; const py = by + Math.sin(a) * rr * 0.9; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.fill(); ctx.strokeStyle = 'rgba(70, 44, 20, 0.7)'; ctx.lineWidth = 1.4; ctx.stroke();
    }
    ctx.strokeStyle = '#a02e22'; ctx.lineWidth = 1.6; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(60, 300); ctx.bezierCurveTo(140, 200, 200, 320, 280, 190); ctx.bezierCurveTo(330, 110, 400, 190, 440, 60); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#a02e22'; ctx.beginPath(); ctx.moveTo(440, 60); ctx.lineTo(424, 74); ctx.lineTo(430, 62); ctx.lineTo(414, 56); ctx.fill();
    ctx.save(); ctx.translate(60, 70); ctx.strokeStyle = '#4a3018'; ctx.fillStyle = '#4a3018'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, TAU); ctx.stroke();
    for (let p = 0; p < 4; p++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(5, -6); ctx.lineTo(-5, -6); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = '#4a3018'; ctx.font = 'italic 700 15px Georgia, serif'; ctx.fillText('MARE AERIUM', 300, 320); ctx.font = '600 9px Georgia, serif'; ctx.fillText('terra incognita', 120, 218);
    ctx.strokeStyle = '#4a3018'; ctx.lineWidth = 3; ctx.strokeRect(6, 6, W - 12, H - 12);
  } else {
    ctx.fillStyle = kind === 'plate' ? '#ebe2c8' : '#e6e0cf'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) { ctx.fillStyle = `rgba(120, 90, 40, ${0.02 + rand() * 0.04})`; ctx.beginPath(); ctx.arc(rand() * W, rand() * H, 6 + rand() * 30, 0, TAU); ctx.fill(); }
    const leaf = kind === 'plate' ? '#4f7a4a' : '#6a8d54';
    ctx.strokeStyle = '#3a5a36'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(W / 2, H * 0.84); ctx.bezierCurveTo(W / 2 - 10, H * 0.6, W / 2 + 14, H * 0.4, W / 2, H * 0.14); ctx.stroke();
    for (let i = 0; i < 9; i++) {
      const y = H * 0.78 - i * 38;
      const s = i % 2 ? 1 : -1;
      const len = 62 - i * 3.5;
      ctx.fillStyle = leaf; ctx.strokeStyle = '#33502f'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(W / 2, y); ctx.quadraticCurveTo(W / 2 + s * len * 0.7, y - 28, W / 2 + s * len, y - 8); ctx.quadraticCurveTo(W / 2 + s * len * 0.6, y + 8, W / 2, y); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(30, 60, 30, 0.5)'; ctx.beginPath(); ctx.moveTo(W / 2, y); ctx.lineTo(W / 2 + s * len * 0.9, y - 8); ctx.stroke();
    }
    ctx.fillStyle = kind === 'plate' ? '#c8503e' : '#d6a23a';
    for (let p = 0; p < 7; p++) { const a = (p / 7) * TAU; ctx.beginPath(); ctx.ellipse(W / 2 + Math.cos(a) * 20, H * 0.14 + Math.sin(a) * 20, 14, 9, a, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#6a4a1e'; ctx.beginPath(); ctx.arc(W / 2, H * 0.14, 8, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3b2c1a'; ctx.font = 'italic 600 15px Georgia, serif'; ctx.textAlign = 'center';
    ctx.fillText(kind === 'plate' ? 'Papaver aeriale' : 'Rosa volans', W / 2, H - 38);
    ctx.font = '600 9px Georgia, serif'; ctx.fillText(kind === 'plate' ? 'PLATE XII' : 'PLATE XIV', W / 2, H - 20);
    ctx.textAlign = 'left';
  }
  // varnish: a fine canvas weave over everything, and dust in the corners
  ctx.fillStyle = 'rgba(0,0,0,0.035)';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  const vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(20, 10, 0, 0.32)');
  ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
  return { map: tex(c), normalMap: normal ? heightToNormal(c, 1.4) : null };
}

/** Roman dial with a minute track, on cream enamel. */
export function clockDial(): CanvasTexture {
  const [c, ctx] = canvasWH(256, 256);
  const g = ctx.createRadialGradient(128, 118, 10, 128, 128, 128);
  g.addColorStop(0, '#f6efdc'); g.addColorStop(1, '#d9ceb0');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#1e1a14'; ctx.fillStyle = '#1e1a14';
  for (let m = 0; m < 60; m++) {
    const a = (m / 60) * TAU;
    const long = m % 5 === 0;
    ctx.lineWidth = long ? 2.4 : 0.9;
    ctx.beginPath();
    ctx.moveTo(128 + Math.sin(a) * (long ? 100 : 106), 128 - Math.cos(a) * (long ? 100 : 106));
    ctx.lineTo(128 + Math.sin(a) * 112, 128 - Math.cos(a) * 112);
    ctx.stroke();
  }
  ctx.font = '700 21px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const R = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  R.forEach((n, i) => {
    const a = (i / 12) * TAU;
    ctx.save();
    ctx.translate(128 + Math.sin(a) * 80, 128 - Math.cos(a) * 80);
    ctx.rotate(a);
    ctx.scale(0.75, 1);
    ctx.fillText(n, 0, 0);
    ctx.restore();
  });
  ctx.font = 'italic 600 11px Georgia, serif';
  ctx.fillText('Tempus Fugit', 128, 168);
  ctx.font = '600 8px Georgia, serif';
  ctx.fillText('LONDON', 128, 98);
  return tex(c);
}

/** Linen drape: a woven ground with a quiet stripe, plus its normal map. */
export function drapeMaps(): SurfaceMaps {
  const [c, ctx] = canvasWH(256, 256);
  const rand = mulberry32(77);
  ctx.fillStyle = '#8c4a3a'; ctx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 32) { ctx.fillStyle = 'rgba(214, 170, 120, 0.16)'; ctx.fillRect(x, 0, 3, 256); ctx.fillStyle = 'rgba(40, 10, 8, 0.12)'; ctx.fillRect(x + 6, 0, 1.5, 256); }
  for (let y = 0; y < 256; y += 2) { ctx.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.05})`; ctx.fillRect(0, y, 256, 1); }
  for (let x = 0; x < 256; x += 2) { ctx.fillStyle = `rgba(255, 220, 190, ${0.02 + rand() * 0.04})`; ctx.fillRect(x, 0, 1, 256); }
  return { map: tex(c, true, true), normalMap: heightToNormal(c, 1.6) };
}

/** the soft vertical beam the window throws into the room (bright at the glass, gone by the far end) */
export function shaftTexture(): CanvasTexture {
  const [c, ctx] = canvasWH(32, 128);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 128);
  ctx.globalCompositeOperation = 'destination-in';
  const h = ctx.createLinearGradient(0, 0, 32, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.5, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = h; ctx.fillRect(0, 0, 32, 128);
  return tex(c);
}

export const STUDY_BOOKS = { cols: 8, rows: 2, cellW: 64, cellH: 176 };

/**
 * An atlas of sixteen worn book spines (cloth, leather and paper, gilt bands and lettering) plus
 * a strip of page edge. A book samples its spine from one cell, its page edges from the strip and
 * its boards from the cell's outer border, which is plain cover colour.
 */
export function studyBookAtlas(): CanvasTexture {
  const { cols, rows, cellW, cellH } = STUDY_BOOKS;
  const W = cols * cellW;
  const H = rows * cellH + 24;
  const [c, ctx] = canvasWH(W, H);
  const rand = mulberry32(5);
  const palette: [string, string, string][] = [
    ['#6e2430', '#d8b768', 'THE ARCHITECTURE OF AIR'], ['#24402f', '#d8b768', 'WINDS & WEATHER'], ['#233252', '#e6d9b0', 'PRINCIPIA VOLANS'],
    ['#7a5a34', '#2a1c0e', 'A GAZETTEER'], ['#2e2e34', '#c9a85a', 'LETTERS, VOL. IX'], ['#8a3b22', '#f0e2bd', 'TYPOGRAPHY'],
    ['#e3d8bb', '#2d2a24', 'FIELD NOTES'], ['#3a4b3c', '#d8b768', 'ORNITHOLOGY'], ['#5a2a3e', '#d8b768', 'THE COMPLETE POEMS'],
    ['#2b4a5c', '#f0e2bd', 'COASTAL LIGHTS'], ['#9a7a3a', '#2a1c0e', 'ALMANAC'], ['#40322a', '#d8b768', 'CARTOGRAPHY'],
    ['#b8b09a', '#2d2a24', 'ESSAYS'], ['#6a1f1f', '#e6d9b0', 'MECHANICS OF FLIGHT'], ['#1d3a3a', '#d8b768', 'A SHORT HISTORY'], ['#4a3b5c', '#e6d9b0', 'NOCTURNES'],
  ];
  for (let i = 0; i < 16; i++) {
    const [base, ink, title] = palette[i]!;
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    ctx.fillStyle = base; ctx.fillRect(x, y, cellW, cellH);
    // plain cover border (the boards sample this)
    // cloth/leather texture: fine vertical fibres and rub-wear at the edges
    for (let k = 0; k < 70; k++) { ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'; ctx.fillRect(x + 4 + rand() * (cellW - 8), y + rand() * cellH, 0.8, 6 + rand() * 30); }
    const shade = ctx.createLinearGradient(x, 0, x + cellW, 0);
    shade.addColorStop(0, 'rgba(0,0,0,0.28)'); shade.addColorStop(0.18, 'rgba(255,255,255,0.06)'); shade.addColorStop(0.5, 'rgba(0,0,0,0)'); shade.addColorStop(0.85, 'rgba(255,255,255,0.05)'); shade.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = shade; ctx.fillRect(x + 3, y, cellW - 6, cellH);
    ctx.fillStyle = base; ctx.fillRect(x, y, 3, cellH); ctx.fillRect(x + cellW - 3, y, 3, cellH);
    // raised bands and gilt rules
    const bands = 2 + (i % 3);
    for (let b = 0; b < bands; b++) {
      const by = y + 14 + b * 11;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 4, by + 1.5, cellW - 8, 3);
      ctx.fillStyle = ink; ctx.globalAlpha = 0.8; ctx.fillRect(x + 4, by, cellW - 8, 1.4); ctx.globalAlpha = 1;
    }
    // a label panel and lettering, read bottom-to-top
    ctx.fillStyle = i % 3 === 0 ? 'rgba(230, 210, 160, 0.9)' : 'rgba(0,0,0,0.22)';
    ctx.fillRect(x + 9, y + 62, cellW - 18, 78);
    ctx.save(); ctx.translate(x + cellW / 2 + 1, y + 101); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = i % 3 === 0 ? '#2a1c0e' : ink; ctx.font = `700 ${title.length > 15 ? 7 : 9}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(title, 0, 0, 74);
    ctx.restore();
    ctx.fillStyle = ink; ctx.fillRect(x + 10, y + cellH - 24, cellW - 20, 1.2);
    ctx.beginPath(); ctx.arc(x + cellW / 2, y + cellH - 13, 4, 0, TAU); ctx.fill();
    // foxing
    for (let k = 0; k < 10; k++) { ctx.fillStyle = `rgba(40, 20, 8, ${0.05 + rand() * 0.08})`; ctx.beginPath(); ctx.arc(x + 4 + rand() * (cellW - 8), y + rand() * cellH, 1 + rand() * 3, 0, TAU); ctx.fill(); }
  }
  // page edge strip
  const py = rows * cellH;
  ctx.fillStyle = '#e9dfc4'; ctx.fillRect(0, py, W, 24);
  for (let k = 0; k < 24; k += 2) { ctx.fillStyle = `rgba(120, 90, 40, ${0.12 + rand() * 0.1})`; ctx.fillRect(0, py + k, W, 0.8); }
  return tex(c);
}
