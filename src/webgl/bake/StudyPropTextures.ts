import type { CanvasTexture } from 'three';
import { mulberry32 } from '../util';
import { canvasWH, tex } from './StudyTextures';

/** The small drawn things on the desk: mug glazes, coffee, a stain, printed paper goods, a phone, steam. */

const TAU = Math.PI * 2;

export interface MugSpec {
  glaze: string;
  /** the darker glaze that runs down from the lip, or null for a single colour */
  drip: string | null;
  ink: string;
  band: 'logo' | 'stripes';
  seed: number;
}

/** wraps a mug: u runs round the body (the logo faces +z), v is height, 0 at the foot */
export function mugTexture(spec: MugSpec): CanvasTexture {
  const W = 256;
  const H = 128;
  const [c, ctx] = canvasWH(W, H);
  const rand = mulberry32(spec.seed);
  ctx.fillStyle = spec.glaze;
  ctx.fillRect(0, 0, W, H);
  // glaze pooling: darker toward the foot and the lip, an unglazed bare-clay ring right at the foot
  const pool = ctx.createLinearGradient(0, 0, 0, H);
  pool.addColorStop(0, 'rgba(0,0,0,0.22)'); pool.addColorStop(0.3, 'rgba(0,0,0,0)'); pool.addColorStop(0.75, 'rgba(255,255,255,0.06)'); pool.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = pool; ctx.fillRect(0, 0, W, H);
  if (spec.drip) {
    ctx.fillStyle = spec.drip;
    ctx.beginPath();
    ctx.moveTo(0, 0); // canvas top is the lip (v = 1)
    for (let x = 0; x <= W; x += 2) ctx.lineTo(x, 13 + 20 * Math.max(0, Math.sin(x * 0.09 + 1.3)) ** 3 + 8 * Math.max(0, Math.sin(x * 0.23)) ** 4);
    ctx.lineTo(W, 0);
    ctx.fill();
  }
  const band = (y: number, h: number, col: string): void => { ctx.fillStyle = col; ctx.fillRect(0, y, W, h); };
  if (spec.band === 'stripes') {
    band(58, 3, spec.ink); band(65, 3, spec.ink); band(72, 8, spec.ink); band(84, 3, spec.ink);
  } else {
    // a printed logo band: thin rules above and below, a paper dart and the wordmark facing +z
    band(52, 1.6, spec.ink); band(92, 1.6, spec.ink);
    ctx.fillStyle = spec.ink;
    ctx.font = '800 15px "Inter", "Helvetica Neue", Arial, sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (const ox of [0, W]) {
      ctx.save();
      ctx.translate(ox, 72);
      ctx.beginPath(); ctx.moveTo(-34, -4); ctx.lineTo(-14, -10); ctx.lineTo(-22, 10); ctx.lineTo(-25, 2); ctx.closePath(); ctx.fill();
      ctx.fillText('EMAIL', -8, -5);
      ctx.fillText('PILOTS', -8, 9);
      ctx.restore();
    }
    ctx.font = '600 6px "Inter", Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('★ ★ ★   FLIGHT CREW   ★ ★ ★', W / 2, 72);
  }
  // crackle: a fine net of hairlines under the glaze
  ctx.lineWidth = 0.45;
  for (let i = 0; i < 90; i++) {
    let x = rand() * W;
    let y = rand() * H;
    ctx.strokeStyle = `rgba(40, 24, 12, ${0.1 + rand() * 0.16})`;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (rand() - 0.5) * 22; y += (rand() - 0.5) * 22; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  // iron speckle
  ctx.fillStyle = 'rgba(30, 18, 10, 0.5)';
  ctx.beginPath();
  for (let i = 0; i < 140; i++) ctx.rect(rand() * W, rand() * H, 0.9, 0.9);
  ctx.fill();
  // bare foot ring
  ctx.fillStyle = '#c9b69a'; ctx.fillRect(0, H - 5, W, 5);
  return tex(c);
}

/** coffee seen from above: a dark body, a tan crema ring with swirl, and bubbles clinging to the rim */
export function cremaTexture(): CanvasTexture {
  const [c, ctx] = canvasWH(128, 128);
  const rand = mulberry32(31);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, '#2b160a'); g.addColorStop(0.55, '#3b2010'); g.addColorStop(0.82, '#7a4a28'); g.addColorStop(0.94, '#b88655'); g.addColorStop(1, '#4a2a14');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = `rgba(190, 140, 90, ${0.1 + rand() * 0.12})`;
    ctx.beginPath(); ctx.arc(64, 64, 10 + i * 9 + rand() * 4, rand() * TAU, rand() * TAU + 3); ctx.stroke();
  }
  for (let i = 0; i < 80; i++) {
    const a = rand() * TAU;
    const r = 52 + rand() * 9;
    ctx.fillStyle = `rgba(230, 190, 140, ${0.35 + rand() * 0.4})`;
    ctx.beginPath(); ctx.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 0.7 + rand() * 1.5, 0, TAU); ctx.fill();
  }
  return tex(c);
}

/** a coffee ring with a gap where the mug was lifted, and a drip: alpha on brown */
export function ringStainTexture(): CanvasTexture {
  const [c, ctx] = canvasWH(128, 128);
  const rand = mulberry32(9);
  for (let pass = 0; pass < 3; pass++) {
    ctx.strokeStyle = `rgba(70, 38, 16, ${0.22 + pass * 0.07})`;
    ctx.lineWidth = 2.4 - pass * 0.5;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const a = 0.4 + (i / 60) * (TAU - 0.9);
      const r = 40 + Math.sin(a * 3 + pass) * 1.4 + rand() * 0.5 - pass * 0.8;
      const x = 64 + Math.cos(a) * r;
      const y = 64 + Math.sin(a) * r;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(70, 38, 16, 0.18)';
  ctx.beginPath(); ctx.ellipse(64 + 36, 64 + 26, 5, 8, 0.6, 0, TAU); ctx.fill();
  return tex(c);
}

/** a soft wisp of vapour (white on alpha) */
export function steamTexture(): CanvasTexture {
  const [c, ctx] = canvasWH(64, 128);
  for (let i = 0; i < 9; i++) {
    const y = 118 - i * 12;
    const x = 32 + Math.sin(i * 0.9) * 9;
    const r = 11 + i * 1.4;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.34 - i * 0.025})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 128);
  }
  return tex(c);
}

/** the lit lock screen of a phone */
export function phoneScreenTexture(): CanvasTexture {
  const [c, ctx] = canvasWH(120, 250);
  const g = ctx.createLinearGradient(0, 0, 120, 250);
  g.addColorStop(0, '#26335e'); g.addColorStop(0.55, '#6b3f7a'); g.addColorStop(1, '#f08a4b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 120, 250);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
  ctx.font = '300 14px "Inter", Arial, sans-serif'; ctx.fillText('Thursday, 24 October', 60, 38);
  ctx.font = '600 44px "Inter", Arial, sans-serif'; ctx.fillText('9:41', 60, 84);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(10, 130, 100, 36); ctx.fillRect(10, 172, 100, 36);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
  ctx.font = '700 8px "Inter", Arial, sans-serif'; ctx.fillText('EMAIL PILOTS', 16, 145);
  ctx.font = '400 8px "Inter", Arial, sans-serif'; ctx.fillText('42 of 42 delivered', 16, 158);
  ctx.font = '700 8px "Inter", Arial, sans-serif'; ctx.fillText('Mia', 16, 187);
  ctx.font = '400 8px "Inter", Arial, sans-serif'; ctx.fillText('Got it, thank you!', 16, 200);
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(40, 240, 40, 3);
  return tex(c);
}

/** where each printed thing sits on the prop atlas, as [u0, v0, u1, v1] */
export type Rect = [number, number, number, number];
const AW = 512;
const px = (x: number, y: number, w: number, h: number): Rect => [x / AW, 1 - (y + h) / AW, (x + w) / AW, 1 - y / AW];
export const ATLAS = {
  bookFront: px(0, 0, 150, 210), bookSpine: px(0, 460, 210, 40), bookPages: px(190, 0, 150, 40),
  nb0: px(0, 215, 120, 170), nb1: px(120, 215, 120, 170), nb2: px(240, 215, 120, 170),
  note0: px(0, 390, 64, 64), note1: px(64, 390, 64, 64), note2: px(128, 390, 64, 64), note3: px(192, 390, 64, 64),
  calendar: px(260, 390, 150, 100), photo: px(365, 215, 140, 100), paper: px(260, 45, 80, 50), cream: px(345, 0, 24, 24),
};

export function propAtlas(): CanvasTexture {
  const [c, ctx] = canvasWH(AW, AW);
  const rand = mulberry32(17);
  ctx.fillStyle = '#e9e1cd'; ctx.fillRect(0, 0, AW, AW);
  const hand = (x: number, y: number, w: number, col: string, lines = 1): void => {
    ctx.strokeStyle = col; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
    for (let l = 0; l < lines; l++) {
      ctx.beginPath(); ctx.moveTo(x, y + l * 9);
      for (let k = 0; k < w; k += 5) ctx.lineTo(x + k, y + l * 9 + Math.sin(k * 1.7 + l) * 2 + (rand() - 0.5) * 1.2);
      ctx.stroke();
    }
  };
  // hardback: green cloth, gilt rules, a title block, a spine with lettering
  const cloth = (x: number, y: number, w: number, h: number, col: string): void => {
    ctx.fillStyle = col; ctx.fillRect(x, y, w, h);
    for (let k = 0; k < 160; k++) { ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)'; ctx.fillRect(x + rand() * w, y + rand() * h, rand() < 0.5 ? 0.8 : 5, rand() < 0.5 ? 5 : 0.8); }
  };
  cloth(0, 0, 150, 210, '#27493a');
  ctx.strokeStyle = '#d6b66a'; ctx.lineWidth = 1.6; ctx.strokeRect(10, 10, 130, 190); ctx.lineWidth = 0.8; ctx.strokeRect(14, 14, 122, 182);
  ctx.fillStyle = '#d6b66a'; ctx.textAlign = 'center'; ctx.font = '700 15px Georgia, serif';
  ctx.fillText('ATLAS', 75, 74); ctx.fillText('OF SKIES', 75, 94);
  ctx.fillRect(40, 104, 70, 1.2); ctx.font = 'italic 600 8px Georgia, serif'; ctx.fillText('a history of flight', 75, 120);
  ctx.beginPath(); ctx.moveTo(75, 148); ctx.lineTo(90, 170); ctx.lineTo(75, 164); ctx.lineTo(60, 170); ctx.closePath(); ctx.fill();
  cloth(0, 460, 210, 40, '#27493a');
  ctx.fillStyle = '#d6b66a'; ctx.fillRect(22, 462, 2, 36); ctx.fillRect(28, 462, 1, 36); ctx.fillRect(186, 462, 1, 36); ctx.fillRect(190, 462, 2, 36);
  ctx.font = '700 12px Georgia, serif'; ctx.textBaseline = 'middle'; ctx.fillText('ATLAS OF SKIES', 105, 481);
  ctx.fillStyle = '#efe6cf'; ctx.fillRect(190, 0, 150, 40);
  for (let k = 0; k < 40; k += 1.6) { ctx.fillStyle = `rgba(110, 80, 40, ${0.1 + rand() * 0.14})`; ctx.fillRect(190, k, 150, 0.7); }
  // notebooks
  const nb = (x: number, col: string, mark: string, ink: string): void => {
    cloth(x, 215, 120, 170, col);
    ctx.fillStyle = ink; ctx.fillRect(x + 8, 215, 4, 170); // elastic
    ctx.textAlign = 'center'; ctx.font = '700 11px "Inter", Arial, sans-serif'; ctx.fillText(mark, x + 66, 270);
    ctx.fillRect(x + 36, 282, 60, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x + 100, 215, 20, 170);
  };
  nb(0, '#b99a6a', 'FIELD NOTES', '#2a2218');
  nb(120, '#222c4a', 'DAILY', '#d6b66a');
  nb(240, '#6a2430', 'SKETCHES', '#e8d9b0');
  // sticky notes with scribbles
  const note = (x: number, col: string): void => {
    ctx.fillStyle = col; ctx.fillRect(x, 390, 64, 64);
    const g = ctx.createLinearGradient(x, 390, x, 454); g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(0.2, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.08)');
    ctx.fillStyle = g; ctx.fillRect(x, 390, 64, 64);
  };
  note(0, '#f3d368'); hand(8, 410, 44, '#2a3350', 3); ctx.fillStyle = '#c0392b'; ctx.font = '700 14px "Inter", Arial, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('!!', 44, 446);
  note(64, '#ee9aa0'); hand(76, 408, 40, '#2a3350', 1); for (let r = 0; r < 3; r++) { ctx.strokeStyle = '#2a3350'; ctx.strokeRect(74, 420 + r * 11, 5, 5); hand(84, 424 + r * 11, 30, '#2a3350', 1); }
  note(128, '#a8d8a6'); ctx.strokeStyle = '#2a3350'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(140, 438); ctx.bezierCurveTo(150, 410, 170, 450, 182, 408); ctx.stroke(); ctx.beginPath(); ctx.moveTo(182, 408); ctx.lineTo(174, 412); ctx.moveTo(182, 408); ctx.lineTo(181, 417); ctx.stroke(); hand(136, 446, 36, '#2a3350', 1);
  note(192, '#f6b56a'); hand(200, 410, 38, '#2a3350', 2); ctx.strokeStyle = '#2a3350'; ctx.beginPath(); ctx.arc(224, 440, 8, 0, TAU); ctx.stroke(); hand(204, 436, 12, '#2a3350', 1);
  // the flip calendar
  ctx.fillStyle = '#f4efe2'; ctx.fillRect(260, 390, 150, 100);
  ctx.fillStyle = '#9d3b2e'; ctx.fillRect(260, 390, 150, 22);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = '700 12px "Inter", Arial, sans-serif'; ctx.fillText('OCTOBER', 268, 406); ctx.textAlign = 'right'; ctx.fillText('2026', 402, 406);
  ctx.textAlign = 'center'; ctx.font = '500 8px "Inter", Arial, sans-serif';
  for (let d = 0; d < 7; d++) { ctx.fillStyle = '#6a5c48'; ctx.fillText('MTWTFSS'[d]!, 272 + d * 20, 424); }
  for (let d = 0; d < 31; d++) {
    const k = d + 3;
    const cx = 272 + (k % 7) * 20;
    const cy = 438 + Math.floor(k / 7) * 12;
    ctx.fillStyle = d === 23 ? '#fff' : '#2c2820';
    if (d === 23) { ctx.fillStyle = '#9d3b2e'; ctx.beginPath(); ctx.arc(cx, cy - 3, 7, 0, TAU); ctx.fill(); ctx.fillStyle = '#fff'; }
    ctx.fillText(String(d + 1), cx, cy);
  }
  // framed photograph: a dusk beach and three figures
  const sky = ctx.createLinearGradient(0, 215, 0, 275); sky.addColorStop(0, '#5b7fb0'); sky.addColorStop(0.7, '#f1b27a'); sky.addColorStop(1, '#f6d6a2');
  ctx.fillStyle = sky; ctx.fillRect(365, 215, 140, 60);
  ctx.fillStyle = '#3d6a86'; ctx.fillRect(365, 275, 140, 14);
  ctx.fillStyle = '#d9bf8f'; ctx.fillRect(365, 289, 140, 26);
  ctx.fillStyle = '#fff1c4'; ctx.beginPath(); ctx.arc(440, 270, 9, 0, TAU); ctx.fill();
  ctx.fillStyle = '#2b2530';
  for (const [fx, fh] of [[410, 34], [432, 26], [452, 38]] as const) { ctx.beginPath(); ctx.arc(fx, 296 - fh, 4.2, 0, TAU); ctx.fill(); ctx.fillRect(fx - 3.5, 300 - fh, 7, fh - 4); }
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.fillRect(365, 215, 140, 100);
  // a tinted blank for paper goods
  ctx.fillStyle = '#efe9d8'; ctx.fillRect(260, 45, 80, 50);
  ctx.fillStyle = '#efe6cf'; ctx.fillRect(345, 0, 24, 24);
  return tex(c);
}
