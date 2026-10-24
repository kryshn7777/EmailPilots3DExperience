import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { clockDial } from '../bake/StudyTextures';
import { STUDY_BOOKS } from '../bake/StudyTextures';
import { globeTexture } from '../bake/CanvasTextures';
import { mulberry32 } from '../util';
import { Kit, atlasBox, bevelBox, lathe, rod, tube, uvScale } from './StudyKit';
import type { Dispose, StudyMats } from './StudyMaterials';

export const FLOOR_Y = -1.28;
const TOP = -0.1;

export interface Furniture {
  update(time: number): void;
}

/** [u0, v0, u1, v1] of cell `i` in the book atlas, plus its cover-colour edge strip and the page strip */
function bookRects(i: number): { spine: [number, number, number, number]; cover: [number, number, number, number]; pages: [number, number, number, number] } {
  const { cols, cellW, cellH, rows } = STUDY_BOOKS;
  const W = cols * cellW;
  const H = rows * cellH + 24;
  const x = (i % cols) * cellW;
  const y = Math.floor(i / cols) * cellH;
  const u0 = x / W;
  const u1 = (x + cellW) / W;
  const v1 = 1 - y / H;
  const v0 = 1 - (y + cellH) / H;
  return {
    spine: [u0 + 0.003, v0, u1 - 0.003, v1],
    cover: [u0 + 0.001, v0 + 0.02, u0 + 0.004, v1 - 0.02],
    pages: [0, 0.004, 1, 0.058],
  };
}

/**
 * The desk, the bookcase and its contents, the credenza, a ladder and a longcase clock. Authored as
 * loose parts, baked by material through the Kit; the clock's pendulum and hands are the only movers.
 */
export function buildFurniture(k: Kit, parent: Group, m: StudyMats, own: Dispose[], tier: 'high' | 'low'): Furniture {
  const high = tier === 'high';
  const keep = <T extends Dispose>(x: T): T => { own.push(x); return x; };
  const seg = high ? 28 : 16;

  // ———————————————————————————————— the desk ————————————————————————————————
  // top: a walnut frame with mitred, chamfered joints around a green leather inlay with a gold line
  const W = 7.0; const D = 4.3; const TH = 0.09; const B = 0.5;
  const slabY = TOP - TH / 2;
  const grain = (g: ReturnType<typeof bevelBox>, _w: number, _d: number, ou: number): ReturnType<typeof bevelBox> => uvScale(g, 1 / 7.5, 1 / 3.4, ou, ou * 0.37);
  for (const s of [-1, 1]) {
    k.add(grain(bevelBox(W, TH, B, 0.014), W, B, s * 0.17), m.walnutLacquer, { y: slabY, z: s * (D / 2 - B / 2) });
    k.add(grain(bevelBox(B, TH, D - 2 * B, 0.014), B, D - 2 * B, s * 0.31 + 0.5), m.walnutLacquer, { y: slabY, x: s * (W / 2 - B / 2) });
  }
  const IW = W - 2 * B; const ID = D - 2 * B;
  k.add(uvScale(new BoxGeometry(IW, 0.012, ID), IW / 1.6, ID / 1.6), m.leather, { y: TOP - 0.006 });
  k.add(new BoxGeometry(IW, 0.07, ID), m.walnut, { y: TOP - 0.05 });
  for (const s of [-1, 1]) {
    k.add(new BoxGeometry(IW + 0.03, 0.006, 0.012), m.brass, { y: TOP - 0.001, z: s * (ID / 2 + 0.006) });
    k.add(new BoxGeometry(0.012, 0.006, ID), m.brass, { y: TOP - 0.001, x: s * (IW / 2 + 0.006) });
    k.add(new BoxGeometry(IW - 0.3, 0.004, 0.006), m.brass, { y: TOP - 0.0005, z: s * (ID / 2 - 0.1) });
    k.add(new BoxGeometry(0.006, 0.004, ID - 0.3), m.brass, { y: TOP - 0.0005, x: s * (IW / 2 - 0.1) });
  }
  // a moulded apron under the top and the back rail
  k.add(grain(bevelBox(W - 0.2, 0.17, 0.07, 0.012), W, 0.1, 0.1), m.walnut, { y: TOP - TH - 0.085, z: D / 2 - 0.2 });
  k.add(grain(bevelBox(W - 0.2, 0.62, 0.06, 0.012), W, 0.6, 0.3), m.walnut, { y: -0.58, z: -1.8 });

  // end panels: a raised, bevelled field in a frame, standing on a plinth
  for (const s of [-1, 1]) {
    const x = s * 3.3;
    k.add(grain(bevelBox(0.16, 1.1, 3.7, 0.014), 0.2, 3.7, s * 0.2), m.walnut, { x, y: -0.77 - 0.0 });
    k.add(bevelBox(0.03, 0.78, 2.9, 0.016), m.shelfWood, { x: s * 3.4 + 0, y: -0.78 });
    k.add(grain(bevelBox(0.26, 0.1, 3.84, 0.03), 0.3, 3.8, s * 0.7), m.walnut, { x: s * 3.3, y: FLOOR_Y + 0.05 });
  }

  // pedestals either side: three drawers each, facing the sitter (+z)
  const drawerFront = (x: number, y: number, z: number, w: number, h: number, key: boolean): void => {
    const o = k.at({ x, y, z });
    o.add(uvScale(new BoxGeometry(w, h, 0.045), w / 4, h / 3, x * 0.07, y * 0.1), m.shelfWood);
    // the raised field: a bevelled panel proud of the drawer front
    o.add(bevelBox(w - 0.2, 0.02, h - 0.12, 0.012).rotateX(Math.PI / 2), m.walnut, { z: 0.03 });
    // a gilt bead round the field
    o.add(new BoxGeometry(w - 0.14, 0.006, 0.006), m.brassAged, { y: h / 2 - 0.045, z: 0.027 });
    o.add(new BoxGeometry(w - 0.14, 0.006, 0.006), m.brassAged, { y: -h / 2 + 0.045, z: 0.027 });
    // bail pull: two rosettes and a hanging loop
    for (const dx of [-0.18, 0.18]) {
      o.add(new CylinderGeometry(0.034, 0.038, 0.012, 14).rotateX(Math.PI / 2), m.brass, { x: dx, y: 0.0, z: 0.05 });
      o.add(new SphereGeometry(0.014, 8, 6), m.brass, { x: dx, y: 0.0, z: 0.062 });
    }
    o.add(new TorusGeometry(0.2, 0.0085, 6, high ? 18 : 10, Math.PI).rotateZ(Math.PI), m.brass, { y: 0.0, z: 0.064 });
    if (key) {
      o.add(new CylinderGeometry(0.03, 0.03, 0.006, 14).rotateX(Math.PI / 2), m.brass, { x: 0, y: h / 2 - 0.1, z: 0.036 });
      o.add(new CircleGeometry(0.008, 8), m.black, { x: 0, y: h / 2 - 0.095, z: 0.0405 });
      o.add(new BoxGeometry(0.007, 0.022, 0.001), m.black, { x: 0, y: h / 2 - 0.115, z: 0.0405 });
    }
  };
  for (const s of [-1, 1]) {
    const x = s * 2.4;
    k.add(grain(bevelBox(1.6, 1.07, 3.55, 0.012), 1.6, 3.5, s * 0.4), m.walnut, { x, y: -0.745, z: 0.0 });
    for (let i = 0; i < 3; i++) drawerFront(x, -0.45 - i * 0.32, 1.8, 1.5, 0.3, i === 0);
  }
  // the kneehole: a shallow centre drawer in the apron
  drawerFront(0, TOP - TH - 0.1, 1.95, 2.8, 0.2, true);

  // ———————————————————————————————— the bookcase ————————————————————————————————
  const BX0 = -4.3; const BX1 = -0.9; const BZ = -3.34; const BD = 0.66;
  const midX = (BX0 + BX1) / 2;
  const shelfYs = [-0.55, 0.23, 1.01, 1.79];
  // base cabinet with two panelled doors, then four bays
  k.add(bevelBox(BX1 - BX0 + 0.1, 0.1, BD + 0.08, 0.02), m.walnut, { x: midX, y: FLOOR_Y + 0.05, z: BZ });
  k.add(grain(bevelBox(BX1 - BX0, 0.6, BD, 0.012), 3.4, BD, 0.2), m.walnut, { x: midX, y: FLOOR_Y + 0.1 + 0.3, z: BZ });
  for (const dx of [-0.85, 0.85]) {
    const o = k.at({ x: midX + dx, y: FLOOR_Y + 0.4, z: BZ + BD / 2 + 0.01 });
    o.add(bevelBox(1.6, 0.025, 0.5, 0.012).rotateX(Math.PI / 2), m.shelfWood);
    o.add(bevelBox(1.3, 0.02, 0.3, 0.012).rotateX(Math.PI / 2), m.walnut, { z: 0.02 });
    o.add(new SphereGeometry(0.035, 10, 8), m.brass, { x: -dx * 0.18 - 0.06 * Math.sign(dx), y: 0.05, z: 0.05 });
  }
  const bookTop = shelfYs[3]! + 0.72;
  const colBase = FLOOR_Y + 0.7;
  for (const s of [BX0, BX1]) {
    k.add(grain(new BoxGeometry(0.1, bookTop - colBase, BD), 0.1, BD, s), m.walnut, { x: s, y: (bookTop + colBase) / 2, z: BZ });
  }
  // a cornice with a cove and a dentil course
  k.add(grain(bevelBox(BX1 - BX0 + 0.34, 0.16, BD + 0.2, 0.03), 3.7, 0.9, 0.3), m.walnut, { x: midX, y: bookTop + 0.08, z: BZ + 0.04 });
  k.add(bevelBox(BX1 - BX0 + 0.1, 0.1, BD + 0.1, 0.02), m.walnut, { x: midX, y: bookTop - 0.04, z: BZ + 0.03 });
  if (high) for (let i = 0; i < 26; i++) k.add(new BoxGeometry(0.06, 0.05, 0.03), m.shelfWood, { x: BX0 + 0.1 + i * ((BX1 - BX0 - 0.2) / 25), y: bookTop - 0.1, z: BZ + BD / 2 + 0.02 });
  k.add(new BoxGeometry(BX1 - BX0, bookTop - colBase, 0.03), m.walnut, { x: midX, y: (bookTop + colBase) / 2, z: BZ - BD / 2 + 0.015 });
  for (const sy of shelfYs) k.add(grain(bevelBox(BX1 - BX0 - 0.1, 0.07, BD - 0.04, 0.01), 3.4, BD, sy), m.shelfWood, { x: midX, y: sy, z: BZ });

  // books: sixteen worn spines, varied height, depth and lean, a run per shelf with objects at the ends
  const rand = mulberry32(123);
  const book = (x: number, shelfTop: number, w: number, h: number, d: number, cell: number, lean = 0, dz = 0): number => {
    const r = bookRects(cell);
    const g = atlasBox(new BoxGeometry(w, h, d), [r.cover, r.cover, r.pages, r.pages, r.spine, r.cover]);
    const c = Math.cos(lean); const sn = Math.sin(lean);
    k.add(g, m.books, { x: x + w / 2 + (h / 2) * Math.abs(sn) * Math.sign(lean) * 0.9, y: shelfTop + (h / 2) * c + (w / 2) * Math.abs(sn), z: BZ - BD / 2 + 0.04 + d / 2 + dz, rz: -lean });
    return w;
  };
  const runs: [number, number, number, number][] = [
    [-0.55 + 0.035, BX0 + 0.1, BX1 - 0.12, 0], [0.23 + 0.035, BX0 + 0.1, BX1 - 0.55, 1], [1.01 + 0.035, BX0 + 0.1, BX1 - 0.95, 2],
  ];
  let ci = 0;
  for (const [top, x0, x1, row] of runs) {
    let x = x0;
    while (x < x1 - 0.2) {
      const w = 0.09 + rand() * 0.16;
      const h = 0.38 + rand() * 0.3;
      const out = rand() < 0.07 ? 0.05 : 0;
      book(x, top, w, h, 0.5 + rand() * 0.08, ci++ % 16, 0, out);
      x += w + 0.006 + (rand() < 0.1 ? 0.04 : 0);
    }
    // the run ends in a book leaning on its neighbour, and a flat stack
    const lw = 0.14; const lh = 0.5;
    book(x + 0.02, top, lw, lh, 0.52, ci++ % 16, 0.3);
    const stackX = x + 0.4;
    for (let i = 0; i < 3 - (row % 2); i++) {
      const r = bookRects((ci++ * 3) % 16);
      const g = atlasBox(new BoxGeometry(0.5 - i * 0.03, 0.09, 0.4), [r.pages, r.spine, r.spine, r.spine, r.spine, r.pages]);
      k.add(g, m.books, { x: stackX + (i % 2 ? 0.02 : -0.01), y: top + 0.045 + i * 0.092, z: BZ - BD / 2 + 0.03 + 0.2 + 0.02, ry: (i - 1) * 0.07 });
    }
    // a pair of brass bookends closing the run on the leaning side (the first bay of each row)
    if (row === 0) {
      k.add(new BoxGeometry(0.02, 0.26, 0.22), m.brass, { x: x0 - 0.02 + 0.0, y: top + 0.13, z: BZ + 0.0 });
      k.add(new BoxGeometry(0.16, 0.02, 0.22), m.brass, { x: x0 + 0.06, y: top + 0.01, z: BZ });
    }
  }

  // the top bay: a globe, a ship in a bottle, a trophy, glazed jars and a leaning print
  const topY = shelfYs[3]! + 0.035;
  const globeMap = keep(globeTexture());
  const globeMat = keep(new MeshStandardMaterial({ map: globeMap, roughness: 0.4 }));
  {
    const o = k.at({ x: -3.8, y: topY, z: BZ });
    o.add(lathe([[0, 0], [0.13, 0], [0.14, 0.02], [0.05, 0.05], [0.03, 0.2]], seg), m.brass);
    o.add(new SphereGeometry(0.2, seg, seg * 0.7), globeMat, { y: 0.4, rx: 0.4, rz: 0.4 });
    o.add(new TorusGeometry(0.225, 0.011, 6, 36), m.brass, { y: 0.4, rx: 0.4, rz: 0.4 + Math.PI / 2 });
  }
  {
    // ship in a bottle: a lathed glass bottle on its side on a walnut cradle, rigging inside
    const o = k.at({ x: -3.1, y: topY, z: BZ + 0.02, ry: 0.15 });
    o.add(new BoxGeometry(0.46, 0.05, 0.16), m.walnut, { y: 0.025 });
    o.add(new BoxGeometry(0.06, 0.11, 0.16), m.walnut, { x: -0.14, y: 0.075 });
    o.add(new BoxGeometry(0.06, 0.11, 0.16), m.walnut, { x: 0.14, y: 0.075 });
    o.add(lathe([[0, -0.3], [0.09, -0.29], [0.1, -0.2], [0.1, 0.1], [0.07, 0.19], [0.032, 0.26], [0.03, 0.34], [0.036, 0.345]], seg).rotateZ(-Math.PI / 2), m.glass, { y: 0.17, x: -0.02 });
    o.add(new BoxGeometry(0.2, 0.012, 0.06), m.shelfWood, { x: -0.04, y: 0.1, z: 0 });
    o.add(new BoxGeometry(0.1, 0.03, 0.05), m.shelfWood, { x: -0.05, y: 0.12 });
    for (const mx of [-0.09, -0.04, 0.01]) {
      o.add(rod(new Vector3(mx, 0.12, 0), new Vector3(mx, 0.2, 0), 0.003, 4), m.walnut);
      o.add(new PlaneGeometry(0.06, 0.07), m.paper, { x: mx + 0.004, y: 0.17, z: 0 });
    }
  }
  {
    const o = k.at({ x: -2.55, y: topY, z: BZ });
    const marble = keep(new MeshStandardMaterial({ color: '#2d3a34', roughness: 0.25, metalness: 0.1 }));
    o.add(bevelBox(0.3, 0.09, 0.3, 0.015), marble, { y: 0.045 });
    o.add(new BoxGeometry(0.16, 0.05, 0.01), m.brass, { y: 0.045, z: 0.15 });
    o.add(lathe([[0, 0.09], [0.08, 0.09], [0.09, 0.11], [0.03, 0.14], [0.025, 0.24], [0.1, 0.3], [0.13, 0.4], [0.14, 0.43], [0.12, 0.43], [0.1, 0.38], [0.04, 0.3]], seg), m.brass);
    for (const s of [-1, 1]) o.add(tube([[s * 0.13, 0.4, 0], [s * 0.22, 0.38, 0], [s * 0.2, 0.28, 0], [s * 0.1, 0.27, 0]], 0.012, 12, 6), m.brass);
  }
  ([[-2.0, 0.1, 0.34, '#2c8a86'], [-1.82, 0.08, 0.26, '#a9453d'], [-1.68, 0.065, 0.2, '#c79a3b']] as const).forEach(([jx, r, h, color]) => {
    const glaze = keep(new MeshStandardMaterial({ color, roughness: 0.2, metalness: 0.05 }));
    const o = k.at({ x: jx, y: topY, z: BZ });
    o.add(lathe([[0, 0], [r * 0.85, 0], [r, 0.05], [r * 1.02, h * 0.55], [r * 0.7, h * 0.92], [r * 0.5, h]], seg), glaze);
    o.add(lathe([[0, h], [r * 0.55, h], [r * 0.6, h + 0.035], [0, h + 0.04]], seg), m.brass);
  });
  {
    const o = k.at({ x: -1.35, y: topY, z: BZ + 0.2, ry: 0.25 });
    o.add(new BoxGeometry(0.32, 0.4, 0.014), m.walnut, { y: 0.2, rx: -0.16 });
    o.add(new BoxGeometry(0.26, 0.34, 0.006), m.paper, { y: 0.2, z: 0.008, rx: -0.16 });
  }

  // a library ladder against the left end of the shelves, hooked on a brass rail
  {
    const rail = new Vector3(-4.0, shelfYs[3]! - 0.07, BZ + BD / 2 + 0.12);
    const foot = new Vector3(-3.88, FLOOR_Y, BZ + BD / 2 + 0.98);
    k.add(rod(new Vector3(BX0 + 0.1, rail.y, rail.z), new Vector3(BX1 - 0.1, rail.y, rail.z), 0.022, 8), m.brass);
    for (const dx of [-0.17, 0.17]) {
      k.add(rod(new Vector3(rail.x + dx, rail.y, rail.z), new Vector3(foot.x + dx, foot.y + 0.03, foot.z), 0.034, 6), m.walnut);
      k.add(new SphereGeometry(0.045, 8, 6), m.rubber, { x: foot.x + dx, y: FLOOR_Y + 0.03, z: foot.z });
    }
    for (let i = 1; i <= 8; i++) {
      const f = i / 9;
      const p = rail.clone().lerp(foot, f);
      k.add(new CylinderGeometry(0.022, 0.022, 0.4, 8).rotateZ(Math.PI / 2), m.walnut, { x: p.x, y: p.y, z: p.z });
    }
  }

  // ———————————————————————————————— the credenza ————————————————————————————————
  {
    const CX = 4.9; const CZ = -3.15; const CY = FLOOR_Y;
    k.add(bevelBox(2.7, 0.1, 0.66, 0.02), m.walnut, { x: CX, y: CY + 0.05, z: CZ });
    k.add(grain(bevelBox(2.6, 0.75, 0.62, 0.014), 2.6, 0.62, 0.6), m.walnut, { x: CX, y: CY + 0.1 + 0.375, z: CZ });
    k.add(grain(bevelBox(2.8, 0.06, 0.72, 0.022), 2.8, 0.72, 0.9), m.walnutLacquer, { x: CX, y: CY + 0.91, z: CZ + 0.02 });
    for (const dx of [-0.66, 0.66]) {
      const o = k.at({ x: CX + dx, y: CY + 0.5, z: CZ + 0.33 });
      o.add(uvScale(new BoxGeometry(1.2, 0.66, 0.035), 0.3, 0.2, dx, 0.2), m.shelfWood);
      o.add(bevelBox(0.95, 0.02, 0.4, 0.014).rotateX(Math.PI / 2), m.walnut, { z: 0.024 });
      o.add(new SphereGeometry(0.04, 10, 8), m.brass, { x: -Math.sign(dx) * 0.5, y: 0.0, z: 0.06 });
      o.add(new CylinderGeometry(0.022, 0.03, 0.03, 10).rotateX(Math.PI / 2), m.brass, { x: -Math.sign(dx) * 0.5, y: 0.0, z: 0.036 });
    }
    // a brass tray with a decanter and two tumblers
    const tray = k.at({ x: CX + 0.9, y: CY + 0.94 + 0.0, z: CZ + 0.02 });
    tray.add(lathe([[0, 0], [0.26, 0], [0.28, 0.03], [0.265, 0.03], [0.25, 0.012], [0, 0.012]], seg), m.brass);
    const whisky = keep(new MeshStandardMaterial({ color: '#b3641f', roughness: 0.1, transparent: true, opacity: 0.8 }));
    whisky.userData.noShadow = true;
    tray.add(lathe([[0, 0.02], [0.09, 0.02], [0.115, 0.1], [0.07, 0.2], [0.032, 0.27], [0.03, 0.36], [0.04, 0.38], [0.04, 0.4], [0.026, 0.4], [0.024, 0.28], [0.06, 0.2], [0.098, 0.1], [0.08, 0.04], [0, 0.04]], seg), m.glass, { x: -0.06 });
    tray.add(lathe([[0, 0.04], [0.082, 0.04], [0.104, 0.1], [0.064, 0.18], [0, 0.18]], seg), whisky, { x: -0.06 });
    tray.add(new SphereGeometry(0.04, 10, 8), m.glass, { x: -0.06, y: 0.43 });
    for (const dx of [0.1, 0.19]) {
      tray.add(lathe([[0, 0.012], [0.04, 0.012], [0.05, 0.15], [0.044, 0.15], [0.036, 0.03], [0, 0.03]], 14), m.glass, { x: dx, z: dx === 0.1 ? 0.07 : -0.05 });
    }
  }

  // ———————————————————————————————— the longcase clock ————————————————————————————————
  const CLK = { x: -4.6 + 0.37, z: 1.7 };
    {
    const o = k.at({ x: CLK.x, y: FLOOR_Y, z: CLK.z, ry: Math.PI / 2 });
    // facing +x: its local +z points into the room after a quarter turn
    o.add(bevelBox(0.92, 0.28, 0.76, 0.04), m.walnut, { y: 0.14 });
    o.add(grain(bevelBox(0.74, 2.2, 0.58, 0.02), 0.74, 0.58, 0.7), m.walnut, { y: 0.28 + 1.1 });
    // the trunk door, its inset panel and a round glass lenticle for the bob
    o.add(bevelBox(0.62, 0.03, 1.72, 0.012).rotateX(Math.PI / 2), m.shelfWood, { y: 1.45, z: 0.3 });
    o.add(new PlaneGeometry(0.4, 1.34), m.black, { y: 1.5, z: 0.3175 });
    for (const sx of [-0.2, 0.2]) o.add(new BoxGeometry(0.014, 1.36, 0.014), m.brass, { x: sx, y: 1.5, z: 0.322 });
    for (const sy of [0.82, 2.18]) o.add(new BoxGeometry(0.414, 0.014, 0.014), m.brass, { y: sy, z: 0.322 });
    o.add(new PlaneGeometry(0.4, 1.34), m.glass, { y: 1.5, z: 0.327 });
    o.add(new SphereGeometry(0.02, 8, 6), m.brass, { x: 0.25, y: 1.1, z: 0.33 });
    // hood: a bevelled box under an arched pediment with turned finials
    o.add(grain(bevelBox(0.84, 0.82, 0.66, 0.025), 0.84, 0.66, 0.2), m.walnut, { y: 0.28 + 2.2 + 0.41 });
    o.add(new CylinderGeometry(0.42, 0.42, 0.62, 28, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).scale(1, 0.45, 1), m.walnut, { y: 0.28 + 2.2 + 0.82 });
    for (const sx of [-0.36, 0.36]) {
      o.add(new CylinderGeometry(0.03, 0.03, 0.7, 10), m.brass, { x: sx, y: 0.28 + 2.2 + 0.41, z: 0.33 });
      o.add(new SphereGeometry(0.05, 10, 8), m.brass, { x: sx, y: 0.28 + 2.2 + 1.0 });
    }
    o.add(new SphereGeometry(0.06, 12, 8), m.brass, { y: 0.28 + 2.2 + 1.1 });
    // the dial: brass bezel, enamel face and a moon-phase window
    const dialMap = keep(clockDial());
    const dialMat = keep(new MeshStandardMaterial({ map: dialMap, roughness: 0.4 }));
    o.add(new TorusGeometry(0.295, 0.02, 8, 36), m.brass, { y: 0.28 + 2.2 + 0.42, z: 0.335 });
    o.add(new CircleGeometry(0.29, 36), dialMat, { y: 0.28 + 2.2 + 0.42, z: 0.336 });
    o.add(new CircleGeometry(0.03, 12), m.brass, { y: 0.28 + 2.2 + 0.42, z: 0.35 });
  }
  const hands = new Group();
  const dialY = FLOOR_Y + 0.28 + 2.2 + 0.42;
  hands.position.set(CLK.x + 0.352, dialY, CLK.z);
  hands.rotation.y = Math.PI / 2;
  const hourHand = new Mesh(new BoxGeometry(0.03, 0.17, 0.006), m.black);
  hourHand.geometry.translate(0, 0.07, 0);
  const minuteHand = new Mesh(new BoxGeometry(0.02, 0.25, 0.006), m.black);
  minuteHand.geometry.translate(0, 0.1, 0);
  minuteHand.position.z = 0.008;
  const secondHand = new Mesh(new BoxGeometry(0.006, 0.26, 0.004), m.brass);
  secondHand.geometry.translate(0, 0.07, 0);
  secondHand.position.z = 0.016;
  hands.add(hourHand, minuteHand, secondHand);
  own.push(hourHand.geometry, minuteHand.geometry, secondHand.geometry);
  hands.traverse((c) => { c.userData.glow = true; });
  parent.add(hands);
  const pendulum = new Group();
  pendulum.position.set(CLK.x + 0.3225, FLOOR_Y + 2.12, CLK.z);
  const rodG = new Mesh(new CylinderGeometry(0.007, 0.007, 1.1, 6), m.brass);
  rodG.position.y = -0.55;
  const bob = new Mesh(new CylinderGeometry(0.1, 0.1, 0.014, 28).rotateZ(Math.PI / 2), m.brass);
  bob.position.y = -0.96;
  pendulum.add(rodG, bob);
  own.push(rodG.geometry, bob.geometry);
  pendulum.traverse((c) => { c.userData.glow = true; c.castShadow = false; });
  parent.add(pendulum);

  return {
    update(time: number): void {
      // the seconds pendulum: a two-second period, a visible tick on the second hand
      pendulum.rotation.x = Math.sin((time / 2) * Math.PI * 2) * 0.1;
      const sec = Math.floor(time);
      secondHand.rotation.z = -(sec % 60) * (Math.PI / 30);
      minuteHand.rotation.z = -(((8 * 60 + 41 + time / 60) % 60) * (Math.PI / 30)) - (sec % 60) * 0.0009;
      hourHand.rotation.z = -(((9 + (41 + time / 60) / 60) % 12) * (Math.PI / 6));
    },
  };
}

/** a swivel desk chair in tufted-look leather with brass nailheads, arms and a five-star base */
export function buildChair(k: Kit, m: StudyMats, high: boolean): void {
  const o = k.at({ x: -2.3, y: FLOOR_Y, z: 2.5, ry: -2.45 });
  o.add(uvScale(bevelBox(0.7, 0.16, 0.68, 0.06), 2.2, 2.2), m.chairLeather, { y: 0.66 });
  o.add(uvScale(bevelBox(0.66, 0.84, 0.14, 0.06), 2.2, 2.2), m.chairLeather, { y: 1.12, z: -0.3, rx: -0.14 });
  // arms: leather pads on brass-capped posts
  for (const sx of [-0.37, 0.37]) {
    o.add(uvScale(bevelBox(0.09, 0.07, 0.5, 0.025), 2.2, 2.2), m.chairLeather, { x: sx, y: 0.98, z: 0.0 });
    o.add(rod(new Vector3(sx, 0.7, -0.12), new Vector3(sx, 0.96, -0.12), 0.018, 8), m.walnut);
    o.add(rod(new Vector3(sx, 0.7, 0.18), new Vector3(sx, 0.96, 0.18), 0.018, 8), m.walnut);
  }
  if (high) {
    for (let i = 0; i < 15; i++) o.add(new SphereGeometry(0.012, 6, 5), m.brass, { x: -0.3 + i * 0.043, y: 0.595, z: 0.335 });
    for (let i = 0; i < 12; i++) o.add(new SphereGeometry(0.012, 6, 5), m.brass, { x: -0.26 + i * 0.047, y: 1.54, z: -0.255 });
  }
  o.add(new CylinderGeometry(0.05, 0.065, 0.5, 12), m.steel, { y: 0.34 });
  o.add(new CylinderGeometry(0.1, 0.1, 0.05, 14), m.steel, { y: 0.1 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    o.add(new BoxGeometry(0.34, 0.05, 0.07), m.steel, { x: Math.cos(a) * 0.17, y: 0.1, z: Math.sin(a) * 0.17, ry: -a });
    o.add(new CylinderGeometry(0.045, 0.045, 0.04, 10).rotateZ(Math.PI / 2), m.rubber, { x: Math.cos(a) * 0.33, y: 0.05, z: Math.sin(a) * 0.33 });
  }
}
