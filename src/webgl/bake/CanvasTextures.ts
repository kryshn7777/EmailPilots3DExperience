import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { detectQuality } from '../quality';

/**
 * Runtime "texture baking": every map the world needs is drawn once into a
 * canvas at boot (all < 16ms), replacing authored bitmap assets.
 */

// bake scale: the desk chapter parks the lens close enough to magnify a 512
// canvas ~2.5x, which read as smeared low-res. All makeCanvas callers draw in
// their original coordinate space; the backing store is 2x on HIGH (mobile
// keeps 1x so bake memory stays flat there).
const BAKE_SCALE = detectQuality('').tier === 'high' ? 2 : 1;

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * BAKE_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.scale(BAKE_SCALE, BAKE_SCALE);
  return [canvas, ctx];
}

/**
 * The dart's sheet, UV-mapped to the flat crease pattern: paper grain, the
 * email's ruled handwriting, and the fold diagonals radiating from the nose
 * (u 0.5, v 1). Creases must match PaperPlane's panel layout: keel crease at
 * u 0.5±0.098, wing crease at u 0.5±0.415.
 */
export function paperSheetTexture(): CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S);
  ctx.fillStyle = '#f7f3ec';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const shade = 236 + Math.floor(Math.random() * 16);
    ctx.fillStyle = `rgba(${shade}, ${shade - 3}, ${shade - 8}, 0.5)`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 2, 1);
  }

  // the email itself, written across the sheet
  ctx.strokeStyle = 'rgba(40, 48, 70, 0.34)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (const ly of [0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.72]) {
    const y = ly * S;
    const width = (ly === 0.72 ? 0.3 : 0.5 + Math.random() * 0.26) * S;
    ctx.beginPath();
    let x = S * 0.14;
    ctx.moveTo(x, y);
    while (x < S * 0.14 + width) {
      x += 7 + Math.random() * 12;
      ctx.lineTo(x, y + (Math.random() - 0.5) * 4);
    }
    ctx.stroke();
  }

  // fold creases: shadow + highlight pairs radiating from the nose
  const nose: [number, number] = [S * 0.5, S];
  const crease = (uTail: number): void => {
    ctx.strokeStyle = 'rgba(70, 66, 58, 0.28)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(...nose);
    ctx.lineTo(uTail * S, 0);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(nose[0] + 2, nose[1]);
    ctx.lineTo(uTail * S + 2, 0);
    ctx.stroke();
  };
  crease(0.5 - 0.098);
  crease(0.5 + 0.098);
  crease(0.5 - 0.415);
  crease(0.5 + 0.415);
  // center spine
  ctx.strokeStyle = 'rgba(70, 66, 58, 0.35)';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(S * 0.5, 0);
  ctx.lineTo(S * 0.5, S);
  ctx.stroke();

  // worn sheet edge
  ctx.strokeStyle = 'rgba(120, 112, 96, 0.35)';
  ctx.lineWidth = 4;
  ctx.strokeRect(1, 1, S - 2, S - 2);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** The tow banner: EMAIL PILOTS on weathered cloth, edge stripes, stitching. */
export function bannerTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.fillStyle = '#efe5cf';
  ctx.fillRect(0, 0, 1024, 256);
  // cloth weave
  for (let i = 0; i < 2400; i++) {
    const v = 214 + Math.floor(Math.random() * 24);
    ctx.fillStyle = `rgba(${v}, ${v - 6}, ${v - 22}, 0.4)`;
    ctx.fillRect(Math.random() * 1024, Math.random() * 256, 2, 1);
  }
  // stripes + stitching at the tow edge
  ctx.fillStyle = '#a5352f';
  ctx.fillRect(0, 10, 1024, 12);
  ctx.fillRect(0, 234, 1024, 12);
  ctx.strokeStyle = 'rgba(90, 60, 40, 0.6)';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(14, 24);
  ctx.lineTo(14, 232);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#8c2f28';
  ctx.font = '900 128px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EMAIL PILOTS', 512, 136, 940);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Modern area rug: charcoal field, one thin accent border, flat weave. */
export function rugTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(512);
  ctx.fillStyle = '#232833';
  ctx.fillRect(0, 0, 512, 512);
  // subtle two-tone weave bands
  for (let y = 0; y < 512; y += 16) {
    if ((y / 16) % 2 === 0) continue;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.fillRect(0, y, 512, 16);
  }
  ctx.strokeStyle = 'rgba(154, 161, 176, 0.8)';
  ctx.lineWidth = 6;
  ctx.strokeRect(30, 30, 452, 452);
  // pile noise
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(255, 245, 225, ${0.015 + Math.random() * 0.02})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  // floor maps live at grazing angles — without anisotropy they mip to mush
  texture.anisotropy = 8;
  return texture;
}

/** Subtle paper fiber grain — used by the plane and the letter. */
export function paperTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(256);
  ctx.fillStyle = '#f7f3ec';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2200; i++) {
    const shade = 238 + Math.floor(Math.random() * 14);
    ctx.fillStyle = `rgba(${shade}, ${shade - 3}, ${shade - 8}, 0.5)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

/** The letter: ruled handwriting strokes on paper — readable as "an email". */
export function letterTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(512);
  ctx.fillStyle = '#f7f3ec';
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = 'rgba(40, 48, 70, 0.55)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  const lines = [0.18, 0.26, 0.34, 0.42, 0.5, 0.58, 0.66, 0.8];
  for (const ly of lines) {
    const y = ly * 512;
    const width = (ly === 0.8 ? 0.3 : 0.55 + Math.random() * 0.3) * 512;
    ctx.beginPath();
    let x = 64;
    ctx.moveTo(x, y);
    while (x < 64 + width) {
      x += 8 + Math.random() * 14;
      ctx.lineTo(x, y + (Math.random() - 0.5) * 5);
    }
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Preflight panel face: dark plate, checklist rows, READY strip at top. */
export function panelTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(512);
  ctx.fillStyle = '#10141f';
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = 'rgba(155, 232, 255, 0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 12, 488, 488);

  ctx.fillStyle = '#9be8ff';
  ctx.font = '600 34px monospace';
  ctx.fillText('PRE-FLIGHT', 36, 70);

  ctx.font = '400 22px monospace';
  const rows = ['INBOX CONNECTED', 'ACCOUNTS HEALTHY', 'SUBJECT WRITTEN', 'SCHEDULES SET', "TODAY'S ALLOWANCE"];
  rows.forEach((row, i) => {
    const y = 140 + i * 62;
    ctx.fillStyle = 'rgba(155, 232, 255, 0.75)';
    ctx.fillText(row, 90, y);
    ctx.strokeStyle = 'rgba(155, 232, 255, 0.4)';
    ctx.strokeRect(40, y - 24, 30, 30);
  });

  ctx.fillStyle = '#7fe8d8';
  ctx.font = '700 30px monospace';
  ctx.fillText('READY FOR TAKEOFF', 60, 480);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Runway asphalt, full markings: threshold piano keys both ends, "27"
 * designator, touchdown-zone bars, centerline dashes, edge stripes, tire
 * scuff near the touchdown zone, asphalt noise. Long axis = V (texture Y).
 */
export function runwayTexture(): CanvasTexture {
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');

  ctx.fillStyle = '#23262e';
  ctx.fillRect(0, 0, S, S);
  // asphalt noise
  for (let i = 0; i < 9000; i++) {
    const v = 26 + Math.random() * 24;
    ctx.fillStyle = `rgba(${v}, ${v + 2}, ${v + 8}, 0.35)`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  // tire scuff bands near the near-end touchdown zone
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(12, 12, 14, ${0.05 + Math.random() * 0.1})`;
    const y = S * 0.6 + Math.random() * S * 0.25;
    ctx.fillRect(S * 0.3 + Math.random() * S * 0.4, y, 3 + Math.random() * 5, 26 + Math.random() * 60);
  }

  const paint = 'rgba(240, 236, 226, 0.92)';
  ctx.fillStyle = paint;
  // edge stripes
  ctx.fillRect(S * 0.045, 0, 10, S);
  ctx.fillRect(S * 0.955 - 10, 0, 10, S);
  // threshold piano keys, both ends
  const KEYS = 8;
  for (let i = 0; i < KEYS; i++) {
    const x = S * 0.09 + i * ((S * 0.82) / KEYS) + 8;
    const w = (S * 0.82) / KEYS - 16;
    ctx.fillRect(x, S - 78, w, 62);
    ctx.fillRect(x, 16, w, 62);
  }
  // touchdown-zone bars (two groups per side)
  for (const ty of [S * 0.78, S * 0.7]) {
    for (const tx of [S * 0.16, S * 0.72]) {
      ctx.fillRect(tx, ty, S * 0.12, 20);
    }
  }
  // centerline dashes
  for (let y = S * 0.12; y < S * 0.66; y += 84) {
    ctx.fillRect(S / 2 - 9, y, 18, 52);
  }
  // designator
  ctx.font = `700 ${S * 0.11}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('27', S / 2, S * 0.905);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  // the landing camera skims the deck — markings smear without anisotropy
  texture.anisotropy = 8;
  return texture;
}

/** The payoff sheet: "Re:" reply sliding out from under the landed letter. */
export function replyTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(512);
  ctx.fillStyle = '#fdfbf7';
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = 'rgba(30, 40, 66, 0.9)';
  ctx.font = '700 64px monospace';
  ctx.fillText('Re:', 56, 110);
  ctx.strokeStyle = 'rgba(40, 48, 70, 0.5)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const ly of [0.42, 0.52, 0.62]) {
    const y = ly * 512;
    ctx.beginPath();
    let x = 56;
    ctx.moveTo(x, y);
    const width = (ly === 0.62 ? 0.35 : 0.68) * 512;
    while (x < 56 + width) {
      x += 9 + Math.random() * 13;
      ctx.lineTo(x, y + (Math.random() - 0.5) * 5);
    }
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Laptop display: compose window mid-send — the shot the flight launches from. */
export function laptopScreenTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(512);
  ctx.fillStyle = '#0b101d';
  ctx.fillRect(0, 0, 512, 512);

  // title bar
  ctx.fillStyle = '#141c30';
  ctx.fillRect(0, 0, 512, 54);
  ctx.fillStyle = '#9be8ff';
  ctx.font = '700 24px monospace';
  ctx.fillText('EMAIL PILOTS', 24, 36);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = 'rgba(155, 232, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(452 + i * 20, 27, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // clean face: just the brand centered above the firing strip — every other
  // text hidden by request
  ctx.fillStyle = '#9be8ff';
  ctx.font = '900 52px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('EMAIL PILOTS', 256, 220);
  ctx.strokeStyle = 'rgba(155, 232, 255, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(96, 250);
  ctx.lineTo(416, 250);
  ctx.stroke();
  // paper-dart emblem under the wordmark
  ctx.fillStyle = 'rgba(155, 232, 255, 0.9)';
  ctx.beginPath();
  ctx.moveTo(216, 330);
  ctx.lineTo(296, 296);
  ctx.lineTo(232, 352);
  ctx.lineTo(240, 322);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = 'left';

  // firing strip
  ctx.fillStyle = '#101a2e';
  ctx.fillRect(0, 408, 512, 104);
  ctx.fillStyle = '#7fe8d8';
  ctx.font = '700 34px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('FIRING EMAIL…', 256, 450);
  ctx.textAlign = 'left';
  ctx.strokeStyle = 'rgba(127, 232, 216, 0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(56, 468, 400, 18);
  ctx.fillRect(58, 470, 396 * 0.82, 14);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Pre-dawn apartment facade: floor rows of windows — a few warm-lit, some
 * dim, most dark — with mullions, a parapet band, and grime streaks. Shared
 * by every instanced rooftop building (stretch across heights reads fine in
 * fog at night).
 */
export function facadeTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  // the wall has to READ as mass: at #151b29 the far impostors went black
  // against the night sky and the district looked like floating windows
  ctx.fillStyle = '#3c4763';
  ctx.fillRect(0, 0, 256, 512);
  // parapet band
  ctx.fillStyle = '#2b344a';
  ctx.fillRect(0, 0, 256, 26);
  // window grid: 8 floors × 6 bays
  const COLS = 6;
  const ROWS = 8;
  const cw = 256 / COLS;
  const rh = (512 - 40) / ROWS;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const roll = Math.random();
      let fill = '#1b2233'; // dark glass, still lighter than the night sky
      if (roll < 0.22) fill = `rgba(255, 201, 138, ${0.55 + Math.random() * 0.4})`; // lamp on
      else if (roll < 0.38) fill = 'rgba(148, 168, 204, 0.16)'; // tv glow
      ctx.fillStyle = fill;
      ctx.fillRect(c * cw + 7, 40 + r * rh + 9, cw - 14, rh - 18);
    }
  }
  // grime streaks
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(6, 8, 14, ${0.05 + Math.random() * 0.1})`;
    ctx.fillRect(Math.random() * 256, 26, 1 + Math.random() * 3, 60 + Math.random() * 300);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Lighthouse hull: classic red/white bands with weather streaks. */
/** how many spine variants per side of the book atlas */
export const BOOK_SPINE_CELLS = 4;

/**
 * Sixteen book spines in a 4×4 atlas: cloth grain, head and tail bands, gilt
 * rules and a lettering panel each, with the left-lit/right-shadowed gradient
 * that makes a flat box read as a rounded spine.
 *
 * One texture and ONE material for the whole wall — each book's box UVs are
 * remapped into its own cell, so the shelf still collapses to a single draw
 * call in Desk.mergeStatics(). Per-book materials would cost ~60 calls, which
 * is exactly why the wall was flat-coloured before.
 *
 * Titles are abstract bars rather than lettering: the camera passes this wall
 * at a distance where real words would be unreadable mush anyway.
 */
export function bookSpineTexture(): CanvasTexture {
  const S = 1024;
  const C = S / BOOK_SPINE_CELLS;
  const [canvas, ctx] = makeCanvas(S);
  // seeded, so the wall is the same wall on every reload
  let seed = 20260810;
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cloth = [
    '#3f4a63', '#6b4230', '#2f5d4a', '#5a3550', '#4a4f5c', '#7a6234', '#2b3f57', '#734a3a',
    '#39543f', '#4c3550', '#5b6070', '#6d5a2c', '#334a66', '#5d3a30', '#2e4c46', '#453c58',
  ];
  for (let cell = 0; cell < BOOK_SPINE_CELLS * BOOK_SPINE_CELLS; cell++) {
    ctx.save();
    ctx.translate((cell % BOOK_SPINE_CELLS) * C, Math.floor(cell / BOOK_SPINE_CELLS) * C);
    ctx.beginPath();
    ctx.rect(0, 0, C, C);
    ctx.clip();

    ctx.fillStyle = cloth[cell]!;
    ctx.fillRect(0, 0, C, C);
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = `rgba(0,0,0,${(0.03 + rand() * 0.05).toFixed(3)})`;
      ctx.fillRect(rand() * C, 0, 1 + rand() * 2, C); // cloth grain runs with the spine
    }

    // rounded-spine shading
    const round = ctx.createLinearGradient(0, 0, C, 0);
    round.addColorStop(0, 'rgba(255,255,255,0.18)');
    round.addColorStop(0.3, 'rgba(255,255,255,0.04)');
    round.addColorStop(1, 'rgba(0,0,0,0.36)');
    ctx.fillStyle = round;
    ctx.fillRect(0, 0, C, C);

    // head and tail bands, then the gilt rules that frame the panel
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(0, C * 0.07, C, C * 0.035);
    ctx.fillRect(0, C * 0.895, C, C * 0.035);
    const gilt = rand() < 0.5 ? '#c9a44c' : '#d6d0c2';
    ctx.fillStyle = gilt;
    ctx.fillRect(0, C * 0.118, C, 2);
    ctx.fillRect(0, C * 0.872, C, 2);

    // lettering panel
    const ly = C * (0.22 + rand() * 0.1);
    const lh = C * (0.2 + rand() * 0.1);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(C * 0.1, ly, C * 0.8, lh);
    ctx.strokeStyle = gilt;
    ctx.lineWidth = 2;
    ctx.strokeRect(C * 0.1, ly, C * 0.8, lh);
    ctx.fillStyle = gilt;
    const bars = 2 + Math.floor(rand() * 2);
    for (let b = 0; b < bars; b++) {
      const bw = C * (0.28 + rand() * 0.34);
      ctx.fillRect(C * 0.5 - bw / 2, ly + lh * (0.24 + b * 0.27), bw, 3);
    }
    ctx.restore();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function lighthouseTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.fillStyle = '#e8e2d6';
  ctx.fillRect(0, 0, 256, 512);
  ctx.fillStyle = '#a5352f';
  const BANDS = 4;
  for (let i = 0; i < BANDS; i++) {
    ctx.fillRect(0, (i * 2 + 0.5) * (512 / (BANDS * 2 + 1)), 256, 512 / (BANDS * 2 + 1));
  }
  // weather streaks running down
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(40, 44, 52, ${0.04 + Math.random() * 0.08})`;
    const x = Math.random() * 256;
    ctx.fillRect(x, Math.random() * 380, 1 + Math.random() * 2, 40 + Math.random() * 120);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  return texture;
}

/** Abstract neon storefront sign — bright bars/rings on black, no words. */
export function neonSignTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, 128, 64);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  // abstract glyphs: bars + a ring + a tick — reads as signage at distance
  ctx.beginPath();
  ctx.moveTo(14, 16);
  ctx.lineTo(14, 48);
  ctx.moveTo(30, 16);
  ctx.lineTo(30, 48);
  ctx.moveTo(22, 32);
  ctx.lineTo(38, 32);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(62, 32, 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(88, 46);
  ctx.lineTo(100, 18);
  ctx.lineTo(112, 46);
  ctx.stroke();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** City road strip: asphalt, center dashes, edge lines. Dashes run along U. */
export function roadTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.fillStyle = '#191c24';
  ctx.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 1600; i++) {
    const v = 20 + Math.random() * 18;
    ctx.fillStyle = `rgba(${v}, ${v + 2}, ${v + 7}, 0.4)`;
    ctx.fillRect(Math.random() * 512, Math.random() * 256, 2, 2);
  }
  ctx.fillStyle = 'rgba(214, 208, 190, 0.5)';
  ctx.fillRect(0, 10, 512, 5);
  ctx.fillRect(0, 241, 512, 5);
  ctx.fillStyle = 'rgba(226, 220, 200, 0.55)';
  for (let x = 0; x < 512; x += 86) ctx.fillRect(x, 125, 40, 6);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Home wall: paneled wainscot grooves, plaster tone, subtle shading. */
export function wallPanelTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#232c42');
  g.addColorStop(0.65, '#1c2436');
  g.addColorStop(1, '#161d2c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  // plaster noise
  for (let i = 0; i < 2600; i++) {
    const v = 26 + Math.random() * 22;
    ctx.fillStyle = `rgba(${v}, ${v + 4}, ${v + 14}, 0.25)`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // panel grooves
  for (let x = 0; x <= 512; x += 128) {
    ctx.fillStyle = 'rgba(8, 10, 18, 0.5)';
    ctx.fillRect(x - 2, 0, 3, 512);
    ctx.fillStyle = 'rgba(120, 140, 190, 0.10)';
    ctx.fillRect(x + 1, 0, 2, 512);
  }
  // picture rail line
  ctx.fillStyle = 'rgba(8, 10, 18, 0.55)';
  ctx.fillRect(0, 96, 512, 4);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Wooden plank floor: warm boards, grain streaks, board gaps. */
export function floorPlankTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(512);
  const PLANK = 64;
  for (let row = 0; row < 512 / PLANK; row++) {
    const warm = 0.85 + Math.random() * 0.3;
    ctx.fillStyle = `rgb(${Math.floor(74 * warm)}, ${Math.floor(56 * warm)}, ${Math.floor(38 * warm)})`;
    ctx.fillRect(0, row * PLANK, 512, PLANK);
    // grain
    for (let i = 0; i < 46; i++) {
      ctx.fillStyle = `rgba(30, 20, 12, ${0.08 + Math.random() * 0.12})`;
      ctx.fillRect(Math.random() * 512, row * PLANK + Math.random() * PLANK, 30 + Math.random() * 90, 1.5);
    }
    // board gap + end joints
    ctx.fillStyle = 'rgba(10, 7, 4, 0.8)';
    ctx.fillRect(0, row * PLANK, 512, 3);
    ctx.fillRect(((row * 197) % 512), row * PLANK, 3, PLANK);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Small abstract wall art: dusk gradient + a tiny dart silhouette. */
export function frameArtTexture(variant: number): CanvasTexture {
  const [canvas, ctx] = makeCanvas(128);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  if (variant === 0) {
    g.addColorStop(0, '#3a4a78');
    g.addColorStop(1, '#c98f68');
  } else {
    g.addColorStop(0, '#22304f');
    g.addColorStop(1, '#7fe8d8');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(250, 246, 238, 0.9)';
  ctx.beginPath();
  if (variant === 0) {
    ctx.moveTo(34, 78);
    ctx.lineTo(96, 58);
    ctx.lineTo(50, 92);
    ctx.closePath();
  } else {
    ctx.arc(64, 52, 18, 0, Math.PI * 2);
  }
  ctx.fill();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Laptop deck: key grid + trackpad. */
export function laptopKeysTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(256);
  ctx.fillStyle = '#1a2030';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#232b40';
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 13; col++) {
      ctx.fillRect(10 + col * 18.2, 14 + row * 21, 15, 16);
    }
  }
  // spacebar + trackpad
  ctx.fillRect(70, 119, 116, 16);
  ctx.fillStyle = '#151b2a';
  ctx.fillRect(78, 152, 100, 84);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  // the deck is seen nearly edge-on from the desk camera
  texture.anisotropy = 8;
  return texture;
}

/**
 * The city floor seen from altitude: a seamless street grid with lane
 * markings, crossings, per-block rooftop massing and traffic. Roads sit on
 * the tile edges and at its midpoints, so the pattern wraps in both axes and
 * one bake covers the whole district.
 *
 * Baked rather than downloaded: the CC0 libraries carry road MATERIALS
 * (asphalt, kerbs, lane tiles), not top-down city blocks, and a tileable
 * grid has to know where its own roads meet the edge.
 */
export function cityGridTexture(): CanvasTexture {
  const S = 1024;
  const [canvas, ctx] = makeCanvas(S);
  let seed = 977;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const CELL = S / 4; // four blocks per tile edge
  const ROAD = 34;

  ctx.fillStyle = '#171b24';
  ctx.fillRect(0, 0, S, S);

  // rooftops: each block broken into a few slabs of slightly different grey,
  // with a courtyard well, so the ground never reads as flat paint
  for (let bx = 0; bx < 4; bx++) {
    for (let bz = 0; bz < 4; bz++) {
      const x0 = bx * CELL + ROAD / 2;
      const z0 = bz * CELL + ROAD / 2;
      const w = CELL - ROAD;
      const splitX = 0.35 + rand() * 0.3;
      const splitZ = 0.35 + rand() * 0.3;
      const parts: [number, number, number, number][] = [
        [x0, z0, w * splitX, w * splitZ],
        [x0 + w * splitX, z0, w * (1 - splitX), w * splitZ],
        [x0, z0 + w * splitZ, w * splitX, w * (1 - splitZ)],
        [x0 + w * splitX, z0 + w * splitZ, w * (1 - splitX), w * (1 - splitZ)],
      ];
      for (const [px, pz, pw, ph] of parts) {
        const v = 34 + Math.floor(rand() * 26);
        ctx.fillStyle = `rgb(${v}, ${v + 3}, ${v + 9})`;
        ctx.fillRect(px + 1.5, pz + 1.5, pw - 3, ph - 3);
        // roof clutter specks + the odd lit skylight
        for (let i = 0; i < 5; i++) {
          const lit = rand() < 0.18;
          ctx.fillStyle = lit ? 'rgba(255, 201, 138, 0.75)' : `rgba(${v - 12}, ${v - 10}, ${v - 4}, 1)`;
          const cw = 3 + rand() * 9;
          ctx.fillRect(px + 4 + rand() * Math.max(1, pw - cw - 8), pz + 4 + rand() * Math.max(1, ph - cw - 8), cw, cw * 0.7);
        }
      }
    }
  }

  // asphalt: full-width bands on every cell boundary, wrapping at the edges
  ctx.fillStyle = '#0d1017';
  for (let i = 0; i < 4; i++) {
    const p = i * CELL - ROAD / 2;
    ctx.fillRect(p, 0, ROAD, S);
    ctx.fillRect(0, p, S, ROAD);
    if (i === 0) {
      ctx.fillRect(S - ROAD / 2, 0, ROAD / 2, S);
      ctx.fillRect(0, S - ROAD / 2, S, ROAD / 2);
    }
  }
  // lane dashes down the middle of every road
  ctx.fillStyle = 'rgba(226, 220, 200, 0.5)';
  for (let i = 0; i < 4; i++) {
    const c = i * CELL;
    for (let d = 6; d < S; d += 34) {
      ctx.fillRect(c - 1.5, d, 3, 16);
      ctx.fillRect(d, c - 1.5, 16, 3);
    }
  }
  // crossings at the intersections
  ctx.fillStyle = 'rgba(226, 220, 200, 0.42)';
  for (let bx = 0; bx < 4; bx++) {
    for (let bz = 0; bz < 4; bz++) {
      const cx = bx * CELL;
      const cz = bz * CELL;
      for (let s = -14; s <= 14; s += 7) {
        ctx.fillRect(cx + s, cz - ROAD / 2 - 12, 4, 10);
        ctx.fillRect(cx + s, cz + ROAD / 2 + 2, 4, 10);
        ctx.fillRect(cx - ROAD / 2 - 12, cz + s, 10, 4);
        ctx.fillRect(cx + ROAD / 2 + 2, cz + s, 10, 4);
      }
    }
  }
  // traffic: headlight whites one way, tail reds the other
  for (let i = 0; i < 230; i++) {
    const along = rand() * S;
    const lane = Math.floor(rand() * 4) * CELL + (rand() < 0.5 ? -7 : 7);
    const red = rand() < 0.5;
    ctx.fillStyle = red ? 'rgba(255, 96, 84, 0.95)' : 'rgba(255, 246, 214, 0.95)';
    if (rand() < 0.5) ctx.fillRect(lane - 1.5, along, 3, 6);
    else ctx.fillRect(along, lane - 1.5, 6, 3);
  }
  // street lamps beading the kerbs
  ctx.fillStyle = 'rgba(255, 201, 138, 0.55)';
  for (let i = 0; i < 4; i++) {
    const c = i * CELL;
    for (let d = 16; d < S; d += 46) {
      ctx.fillRect(c - ROAD / 2 - 3, d, 2.5, 2.5);
      ctx.fillRect(d, c - ROAD / 2 - 3, 2.5, 2.5);
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Overcast deck seen from above: soft billowed cloud tops, drawn as stacked
 * radial blobs so the layer reads as weather rather than a painted plane.
 * Alpha falls off inside each blob, so two offset copies parallax into a
 * convincing depth without a single raymarch step.
 */
export function cloudDeckTexture(): CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S);
  ctx.clearRect(0, 0, S, S);
  let seed = 20260810;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const blob = (x: number, y: number, r: number, a: number, tint: string): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${tint}, ${a})`);
    g.addColorStop(0.55, `rgba(${tint}, ${a * 0.55})`);
    g.addColorStop(1, `rgba(${tint}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  // thin base haze: the deck has to have real holes in it now that there is
  // a lit city floor worth seeing between the clouds
  blob(S / 2, S / 2, S * 0.85, 0.16, '206, 218, 236');
  for (let i = 0; i < 130; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = S * (0.05 + rand() * 0.13);
    // shaded underside first, lit crown offset up-left toward the dawn sun
    blob(x, y + r * 0.22, r, 0.32, '120, 136, 166');
    blob(x - r * 0.16, y - r * 0.2, r * 0.82, 0.5, '236, 242, 252');
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** The arrival laptop: the payoff screen the dart flies into. */
export function arrivalScreenTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(512);
  ctx.fillStyle = '#0b101d';
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#141c30';
  ctx.fillRect(0, 0, 512, 54);
  ctx.fillStyle = '#9be8ff';
  ctx.font = '700 24px monospace';
  ctx.fillText('INBOX', 24, 36);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#7fe8d8';
  ctx.font = '900 46px monospace';
  ctx.fillText('EMAIL', 256, 226);
  ctx.fillText('RECEIVED', 256, 282);
  ctx.strokeStyle = 'rgba(127, 232, 216, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(112, 312);
  ctx.lineTo(400, 312);
  ctx.stroke();

  // the delivered dart, resting in the inbox
  ctx.fillStyle = 'rgba(155, 232, 255, 0.9)';
  ctx.beginPath();
  ctx.moveTo(212, 388);
  ctx.lineTo(300, 350);
  ctx.lineTo(230, 412);
  ctx.lineTo(238, 378);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = 'left';

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Soft radial spot — dust motes, rain caps, glows. */
export function glowTexture(): CanvasTexture {
  const [canvas, ctx] = makeCanvas(64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}
