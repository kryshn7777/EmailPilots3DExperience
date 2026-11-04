import {
  BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, CylinderGeometry, DoubleSide, Group, Material, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Batcher } from './OfficeProps';

/**
 * What hangs on the office's walls. The room's shell is three flat painted planes; a real open-plan IT office
 * has posters and charts in frames, a TV on a bracket, a kanban board, a corkboard, a clock, a door with an exit
 * sign over it, conduit, switches, a fire extinguisher, a vent, felt acoustic panels, a dado rail and two-tone
 * paint. Every poster is drawn into ONE atlas (one material, one draw); frames and fittings are batched by material.
 *
 * Wall coordinates: `a` runs along the wall (world x on the back wall, world z on the side walls), `y` is height.
 */
type Wall = 'back' | 'left' | 'right';

interface Rect { x: number; y: number; w: number; h: number }

const ATLAS = { w: 2048, h: 1536 };

function wallMatrix(wall: Wall, a: number, y: number, room: { x0: number; x1: number; D: number }, off: number): Matrix4 {
  const m = new Matrix4();
  if (wall === 'back') m.makeRotationY(Math.PI).setPosition(a, y, room.D - off);
  else if (wall === 'left') m.makeRotationY(Math.PI / 2).setPosition(room.x0 + off, y, a);
  else m.makeRotationY(-Math.PI / 2).setPosition(room.x1 - off, y, a);
  return m;
}

const rnd = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
};

/** the poster atlas: every printed thing on the walls, drawn once */
function drawAtlas(): { texture: CanvasTexture; rects: Record<string, Rect> } {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS.w;
  canvas.height = ATLAS.h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#e8e6df';
  g.fillRect(0, 0, ATLAS.w, ATLAS.h);
  const rects: Record<string, Rect> = {};
  const r = rnd(4401);
  const font = (px: number, w = 700): string => `${w} ${px}px "Inter Variable", Inter, "Helvetica Neue", Arial, sans-serif`;
  const cell = (id: string, x: number, y: number, w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): void => {
    rects[id] = { x, y, w, h };
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.rect(0, 0, w, h);
    g.clip();
    draw(g, w, h);
    g.restore();
  };
  const text = (c: CanvasRenderingContext2D, s: string, x: number, y: number, px: number, color: string, weight = 700, align: CanvasTextAlign = 'left'): void => {
    c.font = font(px, weight);
    c.fillStyle = color;
    c.textAlign = align;
    c.fillText(s, x, y);
  };
  const box = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, stroke = '#243044', label = '', px = 15): void => {
    c.fillStyle = fill;
    c.fillRect(x, y, w, h);
    c.strokeStyle = stroke;
    c.lineWidth = 2;
    c.strokeRect(x, y, w, h);
    if (label) text(c, label, x + w / 2, y + h / 2 + px * 0.35, px, '#12202e', 700, 'center');
  };

  // network topology
  cell('network', 0, 0, 520, 380, (c, w, h) => {
    c.fillStyle = '#f4f6f8'; c.fillRect(0, 0, w, h);
    text(c, 'NETWORK TOPOLOGY · HQ-01', 22, 36, 22, '#12202e');
    c.strokeStyle = '#4a6a8a'; c.lineWidth = 3;
    const link = (x1: number, y1: number, x2: number, y2: number): void => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
    link(260, 100, 260, 160); link(260, 200, 110, 260); link(260, 200, 260, 260); link(260, 200, 410, 260); link(110, 300, 70, 340); link(110, 300, 150, 340); link(410, 300, 380, 340); link(410, 300, 450, 340);
    box(c, 200, 70, 120, 32, '#ffd9a8', '#a35f12', 'INTERNET', 15);
    box(c, 200, 160, 120, 40, '#cfe3f6', '#243044', 'CORE SW', 16);
    box(c, 50, 260, 120, 40, '#dfeede', '#243044', 'SW-01', 16);
    box(c, 200, 260, 120, 40, '#dfeede', '#243044', 'FIREWALL', 16);
    box(c, 350, 260, 120, 40, '#dfeede', '#243044', 'SW-02', 16);
    for (const [x, y] of [[40, 335], [120, 335], [350, 335], [430, 335]] as const) box(c, x, y, 54, 28, '#fff', '#243044', 'PC', 13);
  });
  // "uptime is a feature"
  cell('uptime', 0, 390, 400, 560, (c, w, h) => {
    c.fillStyle = '#16233a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#35d0b4'; c.fillRect(0, h - 90, w, 90);
    text(c, 'UPTIME', w / 2, 190, 86, '#ffffff', 800, 'center');
    text(c, 'IS A', w / 2, 262, 46, '#35d0b4', 600, 'center');
    text(c, 'FEATURE', w / 2, 350, 74, '#ffffff', 800, 'center');
    text(c, '99.99% · NO EXCUSES', w / 2, 420, 24, '#a8b8d0', 600, 'center');
    text(c, 'HELPDESK EXT. 4411', w / 2, h - 36, 28, '#12202e', 800, 'center');
  });
  // wall calendar
  cell('calendar', 410, 390, 360, 480, (c, w, h) => {
    c.fillStyle = '#fbfaf5'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#c0392b'; c.fillRect(0, 0, w, 90);
    text(c, 'NOVEMBER', w / 2, 62, 40, '#fff', 800, 'center');
    const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    days.forEach((d, i) => text(c, d, 30 + i * 48, 126, 20, '#55606e', 700, 'center'));
    for (let d = 1; d <= 30; d++) {
      const col = (d + 5) % 7, row = Math.floor((d + 5) / 7);
      text(c, String(d), 30 + col * 48, 172 + row * 58, 24, col > 4 ? '#b84a3a' : '#222', 600, 'center');
    }
    c.strokeStyle = '#c0392b'; c.lineWidth = 4; c.beginPath(); c.arc(30 + 3 * 48, 172 + 1 * 58 - 8, 24, 0, 7); c.stroke();
    text(c, 'PATCH TUESDAY', w / 2, h - 28, 20, '#c0392b', 800, 'center');
  });
  // org chart
  cell('org', 780, 390, 640, 400, (c, w, h) => {
    c.fillStyle = '#f6f4ee'; c.fillRect(0, 0, w, h);
    text(c, 'IT DEPARTMENT', 24, 40, 26, '#12202e');
    c.strokeStyle = '#6a7a8c'; c.lineWidth = 3;
    const link = (x1: number, y1: number, x2: number, y2: number): void => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
    link(320, 120, 320, 170); link(110, 170, 530, 170); [110, 320, 530].forEach((x) => link(x, 170, x, 210)); [60, 160, 270, 370, 480, 580].forEach((x) => link(x, 300, x, 320));
    link(110, 300, 110, 270); link(320, 300, 320, 270); link(530, 300, 530, 270);
    box(c, 240, 70, 160, 50, '#cfe3f6', '#243044', 'HEAD OF IT', 17);
    box(c, 30, 210, 160, 56, '#dfeede', '#243044', 'INFRASTRUCTURE', 15);
    box(c, 240, 210, 160, 56, '#dfeede', '#243044', 'SERVICE DESK', 15);
    box(c, 450, 210, 160, 56, '#dfeede', '#243044', 'SECURITY', 15);
    for (const x of [20, 110, 220, 320, 430, 530]) box(c, x, 320, 90, 56, '#fff', '#6a7a8c', '', 12);
  });
  // fire plan
  cell('fireplan', 1430, 390, 420, 300, (c, w, h) => {
    c.fillStyle = '#1e7a3c'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#f2f6f2'; c.fillRect(14, 54, w - 28, h - 68);
    text(c, 'FIRE ASSEMBLY · EVACUATION PLAN', 18, 38, 22, '#fff');
    c.strokeStyle = '#243044'; c.lineWidth = 4; c.strokeRect(36, 74, w - 72, h - 110);
    c.beginPath(); c.moveTo(150, 74); c.lineTo(150, 150); c.moveTo(w - 150, h - 36); c.lineTo(w - 150, h - 110); c.stroke();
    c.strokeStyle = '#1e7a3c'; c.lineWidth = 6; c.setLineDash([12, 8]);
    c.beginPath(); c.moveTo(260, 190); c.lineTo(120, 190); c.lineTo(120, 100); c.stroke(); c.setLineDash([]);
    c.fillStyle = '#d8342a'; c.beginPath(); c.arc(260, 190, 11, 0, 7); c.fill();
    text(c, 'YOU ARE HERE', 276, 196, 15, '#d8342a');
  });
  // ---- boards and notices


  // kanban board: three columns of sticky notes
  cell('kanban', 530, 0, 760, 380, (c, w, h) => {
    c.fillStyle = '#f4f4f0'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#c9ced4'; c.fillRect(0, 0, w, 56);
    ['TO DO', 'DOING', 'DONE'].forEach((t, i) => { text(c, t, 126 + i * 254, 38, 28, '#243044', 800, 'center'); if (i) { c.fillStyle = '#b7bdc5'; c.fillRect(i * 253 - 2, 56, 4, h - 56); } });
    const notes = ['#ffe566', '#ff9fb2', '#9fe0ff', '#b6f0a0', '#ffc76b'];
    const label = ['VPN reset', 'Patch DC-02', 'Laptop #84', 'Printer 3F', 'Backups', 'MFA rollout', 'Wi-Fi AP', 'Onboarding', 'Cable tidy', 'Licences', 'SSL renew', 'UPS test'];
    for (let col = 0; col < 3; col++) for (let k = 0; k < 3 - (col === 1 ? 0 : 0); k++) {
      const x = 22 + col * 253 + (r() - 0.5) * 18, y = 70 + k * 96 + (r() - 0.5) * 12;
      c.save(); c.translate(x + 100, y + 38); c.rotate((r() - 0.5) * 0.12); c.fillStyle = notes[Math.floor(r() * notes.length)]!; c.shadowColor = 'rgba(0,0,0,0.25)'; c.shadowBlur = 6; c.fillRect(-100, -38, 200, 76); c.shadowBlur = 0;
      text(c, label[(col * 4 + k) % label.length]!, 0, 8, 24, '#33302a', 600, 'center'); c.restore();
    }
  });
  // corkboard
  cell('cork', 1300, 0, 480, 360, (c, w, h) => {
    c.fillStyle = '#b98b55'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) { c.fillStyle = `rgba(${90 + r() * 60},${55 + r() * 40},${20 + r() * 20},${0.12 + r() * 0.2})`; c.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3); }
    c.strokeStyle = '#6d4a26'; c.lineWidth = 10; c.strokeRect(5, 5, w - 10, h - 10);
    const paper = ['#fdfdf8', '#fff3a8', '#cfe7ff', '#ffd6dd'];
    for (let k = 0; k < 8; k++) {
      const pw = 90 + r() * 80, ph = 100 + r() * 70, x = 30 + (k % 4) * 108 + (r() - 0.5) * 20, y = 24 + Math.floor(k / 4) * 160 + (r() - 0.5) * 20;
      c.save(); c.translate(x + pw / 2, y + ph / 2); c.rotate((r() - 0.5) * 0.18); c.fillStyle = paper[k % 4]!; c.shadowColor = 'rgba(0,0,0,0.3)'; c.shadowBlur = 5; c.fillRect(-pw / 2, -ph / 2, pw, ph); c.shadowBlur = 0;
      c.fillStyle = '#9aa0a8'; for (let l = 0; l < 6; l++) c.fillRect(-pw / 2 + 8, -ph / 2 + 22 + l * 13, pw - 16 - r() * 30, 3);
      c.fillStyle = '#d8342a'; c.beginPath(); c.arc(0, -ph / 2 + 8, 5, 0, 7); c.fill(); c.restore();
    }
  });
  // server-room warning
  cell('warning', 1430, 700, 360, 240, (c, w, h) => {
    c.fillStyle = '#f5c400'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#111'; for (let i = -2; i < 14; i++) { c.beginPath(); c.moveTo(i * 30, 0); c.lineTo(i * 30 + 15, 0); c.lineTo(i * 30 - 20, 26); c.lineTo(i * 30 - 35, 26); c.fill(); }
    c.fillStyle = '#111'; c.fillRect(0, 30, w, h - 60);
    text(c, 'SERVER ROOM', w / 2, 98, 44, '#f5c400', 800, 'center');
    text(c, 'AUTHORISED PERSONNEL ONLY', w / 2, 146, 22, '#fff', 700, 'center');
    text(c, 'BADGE REQUIRED · NO FOOD OR DRINK', w / 2, 184, 17, '#d0d4d8', 600, 'center');
  });
  // lock your screen
  cell('lock', 1790, 0, 250, 330, (c, w, h) => {
    c.fillStyle = '#fffdf5'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#d8342a'; c.fillRect(0, 0, w, 70);
    text(c, 'LEAVING YOUR DESK?', w / 2, 44, 21, '#fff', 800, 'center');
    c.fillStyle = '#243044'; c.fillRect(w / 2 - 50, 100, 100, 70); c.fillRect(w / 2 - 20, 170, 40, 18); c.fillRect(w / 2 - 45, 188, 90, 8);
    text(c, 'WIN + L', w / 2, 250, 46, '#243044', 800, 'center');
    text(c, 'lock your screen', w / 2, 292, 20, '#55606e', 600, 'center');
  });
  // "every mail deserves a pilot": the brand's own poster, with a paper plane
  cell('pilot', 0, 960, 360, 500, (c, w, h) => {
    const grad = c.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, '#0e2142'); grad.addColorStop(1, '#2c5d8e');
    c.fillStyle = grad; c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(60, 190); c.lineTo(300, 110); c.lineTo(214, 262); c.lineTo(196, 214); c.closePath(); c.fill();
    c.fillStyle = '#c9d6e6'; c.beginPath(); c.moveTo(196, 214); c.lineTo(300, 110); c.lineTo(180, 250); c.closePath(); c.fill();
    text(c, 'EVERY MAIL', w / 2, 360, 52, '#fff', 800, 'center');
    text(c, 'DESERVES', w / 2, 414, 44, '#9be8ff', 600, 'center');
    text(c, 'A PILOT', w / 2, 470, 60, '#fff', 800, 'center');
  });
  // IT support sign for above the bench
  cell('itsign', 370, 960, 560, 150, (c, w, h) => {
    c.fillStyle = '#1b3a5c'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#9be8ff'; c.lineWidth = 4; c.strokeRect(8, 8, w - 16, h - 16);
    text(c, 'IT SUPPORT', 30, 74, 56, '#fff', 800);
    text(c, 'TICKETS · PATCHES · COFFEE', 32, 118, 24, '#9be8ff', 600);
  });
  // door sign
  cell('doorsign', 370, 1120, 300, 90, (c, w, h) => {
    c.fillStyle = '#e9e9e6'; c.fillRect(0, 0, w, h);
    text(c, 'STAIRS · LEVEL 31', w / 2, 56, 30, '#222', 700, 'center');
  });
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return { texture: t, rects };
}

/** a flat dashboard for the wall TV: ticket graph, queue, uptime */
function tvTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 576;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b1220'; g.fillRect(0, 0, 1024, 576);
  g.fillStyle = '#e8eefc'; g.font = '700 34px "Inter Variable", Inter, Arial, sans-serif'; g.fillText('SERVICE DESK · LIVE', 36, 62);
  g.fillStyle = '#35d0b4'; g.fillRect(36, 80, 220, 4);
  const stat = (x: number, label: string, value: string, color: string): void => {
    g.fillStyle = '#16213a'; g.fillRect(x, 110, 220, 120);
    g.fillStyle = '#8fa2c4'; g.font = '600 20px Inter, Arial, sans-serif'; g.fillText(label, x + 18, 144);
    g.fillStyle = color; g.font = '800 58px Inter, Arial, sans-serif'; g.fillText(value, x + 18, 208);
  };
  stat(36, 'OPEN TICKETS', '17', '#ffd166'); stat(276, 'AVG RESOLVE', '14m', '#35d0b4'); stat(516, 'UPTIME', '99.99', '#7fe8d8'); stat(756, 'MAIL SENT', '42', '#9be8ff');
  g.fillStyle = '#16213a'; g.fillRect(36, 258, 692, 270);
  g.strokeStyle = '#35d0b4'; g.lineWidth = 4; g.beginPath();
  for (let i = 0; i <= 46; i++) { const x = 52 + (i / 46) * 660, y = 440 - Math.sin(i * 0.4) * 36 - Math.sin(i * 0.17 + 1) * 46 - i * 1.5; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
  g.fillStyle = '#16213a'; g.fillRect(756, 258, 232, 270);
  [['Mail', 0.9, '#35d0b4'], ['VPN', 0.55, '#ffd166'], ['Wi-Fi', 0.75, '#9be8ff'], ['Print', 0.3, '#ff8a80']].forEach(([n, v, col], i) => {
    g.fillStyle = '#8fa2c4'; g.font = '600 20px Inter, Arial, sans-serif'; g.fillText(n as string, 772, 300 + i * 56);
    g.fillStyle = '#0b1220'; g.fillRect(836, 284 + i * 56, 138, 18); g.fillStyle = col as string; g.fillRect(836, 284 + i * 56, 138 * (v as number), 18);
  });
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function exitTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0c8f3f'; g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#fff'; g.font = '800 54px Inter, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('EXIT', 128, 66);
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(22, 48); g.lineTo(52, 26); g.lineTo(52, 70); g.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function clockTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#16191f'; g.beginPath(); g.arc(128, 128, 126, 0, 7); g.fill();
  g.fillStyle = '#f4f2ea'; g.beginPath(); g.arc(128, 128, 112, 0, 7); g.fill();
  g.fillStyle = '#222';
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.save(); g.translate(128, 128); g.rotate(a); g.fillRect(-3, -104, 6, i % 3 === 0 ? 22 : 12); g.restore(); }
  g.strokeStyle = '#111'; g.lineCap = 'round';
  g.lineWidth = 9; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.sin(0.3) * 56, 128 - Math.cos(0.3) * 56); g.stroke();
  g.lineWidth = 6; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.sin(4.2) * 84, 128 - Math.cos(4.2) * 84); g.stroke();
  g.strokeStyle = '#d8342a'; g.lineWidth = 3; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.sin(2.4) * 92, 128 - Math.cos(2.4) * 92); g.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface OfficeWalls {
  group: Group;
  /** everything to dispose with the room (geometries, materials, textures) */
  disposables: { dispose(): void }[];
  textures: Texture[];
}

export interface WallMaterials {
  dark: Material;
  metal: Material;
  screen: Material;
}

export function buildOfficeWalls(room: { x0: number; x1: number; D: number; h: number }, m: WallMaterials, high: boolean): OfficeWalls {
  const group = new Group();
  const disposables: { dispose(): void }[] = [];
  const textures: Texture[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => { disposables.push(x); return x; };
  const std = (color: string, roughness = 0.8, metalness = 0): MeshStandardMaterial => own(new MeshStandardMaterial({ color, roughness, metalness }));

  const { texture: atlasTex, rects } = drawAtlas();
  textures.push(atlasTex);
  own(atlasTex);
  const atlasMat = own(new MeshStandardMaterial({ map: atlasTex, roughness: 0.78, metalness: 0 }));

  const posters: BufferGeometry[] = [];
  const batch = new Batcher();
  const trim = std('#c9ccd1', 0.6);
  const frameDark = std('#1d2128', 0.5, 0.2);
  const wood = std('#6b4f38', 0.65);
  const redMat = std('#c92a22', 0.45, 0.1);
  const white = std('#e9eaec', 0.6);
  const feltTeal = std('#2f6f78', 0.95);
  const feltAmber = std('#b57a2e', 0.95);
  const feltGrey = std('#4a4f57', 0.95);
  const slate = std('#2a3342', 0.85);
  const navyLow = std('#1a2540', 0.85);

  const addBox = (mat: Material, wall: Wall, a: number, y: number, w: number, hh: number, d: number, off = 0): void => {
    const g = new BoxGeometry(w, hh, d);
    g.translate(0, 0, d / 2);
    g.applyMatrix4(wallMatrix(wall, a, y, room, off));
    batch.add(mat, g);
    g.dispose();
  };
  /** a poster from the atlas, framed, `wm` x `hm` metres, centred at (a, y) */
  const poster = (id: string, wall: Wall, a: number, y: number, wm: number, hm: number, frame: Material | null = frameDark): void => {
    const rc = rects[id]!;
    const g = new PlaneGeometry(wm, hm);
    const uv = g.attributes.uv!;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (rc.x + uv.getX(i) * rc.w) / ATLAS.w, 1 - (rc.y + (1 - uv.getY(i)) * rc.h) / ATLAS.h);
    }
    g.applyMatrix4(wallMatrix(wall, a, y, room, 0.03));
    posters.push(g);
    if (frame) {
      const t = 0.035;
      addBox(frame, wall, a, y + hm / 2 + t / 2, wm + 2 * t, t, 0.035);
      addBox(frame, wall, a, y - hm / 2 - t / 2, wm + 2 * t, t, 0.035);
      addBox(frame, wall, a - wm / 2 - t / 2, y, t, hm, 0.035);
      addBox(frame, wall, a + wm / 2 + t / 2, y, t, hm, 0.035);
    }
  };

  const { x0, x1, D } = room;
  // dado: a darker lower band and a chair rail, on all three walls
  addBox(navyLow, 'back', 0, 0.52, x1 - x0, 1.04, 0.012);
  addBox(trim, 'back', 0, 1.06, x1 - x0, 0.045, 0.03);
  addBox(slate, 'left', D / 2, 0.52, D, 1.04, 0.012);
  addBox(trim, 'left', D / 2, 1.06, D, 0.045, 0.03);
  addBox(slate, 'right', D / 2, 0.52, D, 1.04, 0.012);
  addBox(trim, 'right', D / 2, 1.06, D, 0.045, 0.03);

  // back wall
  for (const [x, mat] of [[-6.75, feltTeal], [-5.45, feltAmber], [-4.15, feltGrey]] as const) {
    addBox(mat, 'back', x, 2.0, 1.1, 0.7, 0.045);
    addBox(mat, 'back', x + 0.62 - 0.0, 2.0, 0.01, 0.7, 0.01); // seam shadow line
  }
  poster('pilot', 'back', 3.75, 1.95, 0.8, 1.1);
  poster('warning', 'back', 5.75, 2.35, 0.56, 0.37, null);
  // the TV on its bracket: bezel, the live display in front of it
  addBox(frameDark, 'back', 0.2, 1.72, 1.56, 0.92, 0.05);
  addBox(m.metal, 'back', 0.2, 1.72, 0.18, 0.22, 0.012, 0.0);
  const tv = new PlaneGeometry(1.5, 0.84);
  tv.applyMatrix4(wallMatrix('back', 0.2, 1.72, room, 0.057));
  // a shelf over the coffee station with mugs and a box
  addBox(wood, 'back', 2.3, 1.72, 1.1, 0.035, 0.22);
  for (const [dx, mug] of [[-0.35, '#d9d4c8'], [-0.18, '#2f6f78'], [0.2, '#b57a2e']] as const) addBox(std(mug, 0.5), 'back', 2.3 + dx, 1.72 + 0.075, 0.075, 0.115, 0.075, 0.05);
  addBox(std('#8d6e4c', 0.8), 'back', 2.3 + 0.38, 1.72 + 0.1, 0.18, 0.17, 0.15, 0.04);
  // the conduit that runs from the rack along the ceiling and down the corner
  addBox(m.metal, 'back', 5.6, 2.78, 3.0, 0.05, 0.05, 0.05);
  addBox(m.metal, 'back', 5.6, 2.9, 3.0, 0.03, 0.03, 0.05);
  for (const x of [4.3, 5.6, 6.9]) addBox(m.metal, 'back', x, 2.78, 0.14, 0.14, 0.08, 0.04);
  // outlets and a switch by the coffee station
  for (const x of [1.35, 3.15]) { addBox(white, 'back', x, 1.12, 0.08, 0.12, 0.012); addBox(frameDark, 'back', x, 1.12, 0.05, 0.05, 0.014); }

  // left wall: the door (with its exit sign), prints, switch, extinguisher, filing wall
  addBox(trim, 'left', 1.95, 1.06, 1.12, 2.16, 0.06);
  addBox(wood, 'left', 1.95, 1.05, 0.94, 2.1, 0.07);
  addBox(m.metal, 'left', 1.95 - 0.34, 1.0, 0.18, 0.04, 0.1, 0.05); // push bar
  addBox(frameDark, 'left', 1.95, 1.55, 0.14, 0.45, 0.075); // vision slit
  poster('doorsign', 'left', 1.95, 1.9, 0.5, 0.15, null);
  poster('network', 'left', 4.4, 1.7, 1.2, 0.88);
  poster('cork', 'left', 6.45, 1.95, 1.1, 0.82);
  poster('kanban', 'left', 8.55, 1.75, 1.5, 0.75);
  addBox(white, 'left', 3.05, 1.25, 0.08, 0.12, 0.012);
  // a fire extinguisher on its bracket with a sign
  const extG = new CylinderGeometry(0.075, 0.075, 0.42, 14);
  extG.translate(0, 0, 0.1);
  extG.applyMatrix4(wallMatrix('left', 3.6, 0.62, room, 0.0));
  batch.add(redMat, extG);
  extG.dispose();
  addBox(m.dark, 'left', 3.6, 0.9, 0.05, 0.1, 0.12, 0.0);
  addBox(white, 'left', 3.6, 1.35, 0.3, 0.3, 0.012);

  // right wall: org chart, calendar, plan, IT sign over the bench, vent, the electrical panel
  poster('org', 'right', 2.9, 1.9, 1.4, 0.88);
  poster('calendar', 'right', 4.15, 1.62, 0.52, 0.7);
  poster('fireplan', 'right', 8.3, 1.5, 0.7, 0.5);
  poster('itsign', 'right', 5.9, 2.5, 1.1, 0.3, frameDark);
  poster('lock', 'right', 7.4, 1.6, 0.34, 0.45);
  addBox(white, 'right', 1.35, 1.5, 0.5, 0.7, 0.06);
  addBox(frameDark, 'right', 1.35, 1.5, 0.44, 0.64, 0.065, 0.0);
  for (let i = 0; i < 6; i++) addBox(m.metal, 'right', 3.6, 2.62 + (i - 2.5) * 0.045, 0.62, 0.012, 0.03, 0.03); // vent slats
  addBox(trim, 'right', 3.6, 2.62, 0.7, 0.3, 0.02);

  const exitBack = new BoxGeometry(0.46, 0.2, 0.04);
  exitBack.translate(0, 0, 0.02);
  exitBack.applyMatrix4(wallMatrix('left', 1.95, 2.3, room, 0));
  batch.add(m.dark, exitBack);
  exitBack.dispose();

  // the posters and the screen
  for (const mesh of batch.build({ castShadow: false, receiveShadow: high })) group.add(mesh);
  const merged = mergeGeometries(posters, false);
  own(merged);
  const postersMesh = new Mesh(merged, atlasMat);
  group.add(postersMesh);
  posters.forEach((p) => p.dispose());

  const tvMesh = new Mesh(tv, new MeshBasicMaterial({ map: own(tvTexture()), toneMapped: false }));
  own(tvMesh.geometry);
  own(tvMesh.material as MeshBasicMaterial);
  group.add(tvMesh);

  const exitMat = own(new MeshBasicMaterial({ map: own(exitTexture()), toneMapped: false }));
  const exitGeom = new PlaneGeometry(0.42, 0.16);
  exitGeom.applyMatrix4(wallMatrix('left', 1.95, 2.3, room, 0.035));
  own(exitGeom);
  group.add(new Mesh(exitGeom, exitMat));
  const clockMat = own(new MeshBasicMaterial({ map: own(clockTexture()), side: DoubleSide }));
  const clockGeom = new CircleGeometry(0.19, 40);
  clockGeom.applyMatrix4(wallMatrix('back', -2.2, 2.62, room, 0.035));
  own(clockGeom);
  group.add(new Mesh(clockGeom, clockMat));

  return { group, disposables, textures };
}
