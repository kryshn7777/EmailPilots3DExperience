import {
  AdditiveBlending,
  BufferGeometry,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  Vector2,
} from 'three';
import { glowTexture } from '../bake/CanvasTextures';
import { fringeTexture, paintingTexture, shaftTexture } from '../bake/StudyTextures';
import { FLOOR_Y } from './StudyFurniture';
import { Kit, bevelBox, lathe, moulding, rod, tube, uvScale } from './StudyKit';
import type { Dispose, StudyMats } from './StudyMaterials';

export const ROOM = {
  x0: -4.6, x1: 6.48, zBack: -3.7, zFront: 6.5, ceil: 5.16,
  /** opening in the window wall, local coordinates (z, y) */
  winZ0: -1.0, winZ1: 2.6, winY0: 0.31, winY1: 3.7,
};

type Prof = [number, number][];
const SKIRTING: Prof = [[0, 0], [0.085, 0], [0.085, 0.3], [0.1, 0.33], [0.1, 0.36], [0.065, 0.385], [0, 0.385]];
const CHAIR_RAIL: Prof = [[0, 0], [0.11, 0], [0.125, 0.02], [0.125, 0.05], [0.1, 0.08], [0.075, 0.09], [0.05, 0.115], [0, 0.115]];
const CROWN: Prof = [[0, 0], [0.04, 0], [0.28, 0.2], [0.285, 0.27], [0.25, 0.31], [0.14, 0.33], [0.1, 0.34], [0, 0.34]];
const PICTURE_RAIL: Prof = [[0, 0], [0.06, 0], [0.085, 0.025], [0.085, 0.045], [0.06, 0.07], [0, 0.07]];

export interface Room {
  update(time: number): void;
}

/**
 * The architecture: parquet and rug, plaster walls with raised-panel wainscot, skirting, chair rail,
 * picture rail and cove cornice, the window's casing, stool and reveal, drapes, framed paintings,
 * wall sconces, a ceiling rose and a soft shaft of light from the window. All of it is baked through
 * the Kit (one draw per material) except the sprites and the light shafts.
 */
export function buildRoom(k: Kit, parent: Group, m: StudyMats, own: Dispose[], tier: 'high' | 'low'): Room {
  const high = tier === 'high';
  const keep = <T extends Dispose>(x: T): T => { own.push(x); return x; };
  const { x0, x1, zBack, zFront, ceil } = ROOM;
  const H = ceil - FLOOR_Y;
  const seg = high ? 28 : 14;

  // ——— the shell: floor, ceiling and plaster ———
  const roomW = x1 - x0;
  const roomD = zFront - zBack;
  const cx = (x0 + x1) / 2;
  const cz = (zBack + zFront) / 2;
  k.add(uvScale(new PlaneGeometry(roomW, roomD).rotateX(-Math.PI / 2), roomW / 1.6, roomD / 1.6), m.floor, { x: cx, y: FLOOR_Y, z: cz });
  k.add(new PlaneGeometry(roomW, roomD).rotateX(Math.PI / 2), m.ceiling, { x: cx, y: ceil, z: cz });
  const wallPlane = (w: number, place: { x: number; z: number; ry: number }): void =>
    k.add(uvScale(new PlaneGeometry(w, H), w / m.plasterTile, H / m.plasterTile), m.plaster, { ...place, y: FLOOR_Y + H / 2 });
  wallPlane(roomW, { x: cx, z: zBack, ry: 0 });
  wallPlane(roomD, { x: x0, z: cz, ry: Math.PI / 2 });
  wallPlane(roomW, { x: cx, z: zFront, ry: Math.PI });

  // ——— wall frames: local x runs along the wall, y is height above the floor, z is out of the wall ———
  const frames = {
    back: { x: x0, z: zBack, ry: 0, len: x1 - x0 },
    side: { x: x0, z: zFront, ry: Math.PI / 2, len: zFront - zBack },
    front: { x: x1, z: zFront, ry: Math.PI, len: x1 - x0 },
    window: { x: x1, z: zBack, ry: -Math.PI / 2, len: zFront - zBack },
  };
  const wallAt = (w: keyof typeof frames) => k.at({ x: frames[w].x, y: FLOOR_Y, z: frames[w].z, ry: frames[w].ry });
  type Wall = ReturnType<typeof wallAt>;
  /** a moulding run along the wall between x a and b at height wy */
  const run = (o: Wall, prof: Prof, a: number, b: number, wy: number, mat: MeshStandardMaterial): void => {
    o.add(moulding(prof, b - a).rotateY(-Math.PI / 2).translate(b, wy, 0), mat);
  };

  /** painted raised-panel wainscot between x a and b, `top` high, with real stiles, rails, bevelled fields and bead */
  const wainscot = (o: Wall, a: number, b: number, top: number, cap: boolean): void => {
    const len = b - a;
    const n = Math.max(1, Math.round(len / 1.6));
    const bay = len / n;
    const lo = 0.385;
    o.add(new BoxGeometry(len, top, 0.03), m.paint, { x: a + len / 2, y: top / 2, z: 0.015 });
    o.add(new BoxGeometry(len, 0.17, 0.05), m.paint, { x: a + len / 2, y: lo + 0.085, z: 0.025 });
    o.add(new BoxGeometry(len, 0.2, 0.05), m.paint, { x: a + len / 2, y: top - 0.1, z: 0.025 });
    for (let i = 0; i <= n; i++) {
      const sw = i === 0 || i === n ? 0.12 : 0.2;
      const sx = a + i * bay + (i === 0 ? sw / 2 : i === n ? -sw / 2 : 0);
      o.add(new BoxGeometry(sw, top - lo, 0.05), m.paint, { x: sx, y: (top + lo) / 2, z: 0.025 });
    }
    const fy0 = lo + 0.17;
    const fy1 = top - 0.2;
    for (let i = 0; i < n; i++) {
      const fx = a + (i + 0.5) * bay;
      const fw = bay - 0.34;
      const fh = fy1 - fy0;
      // bead round the field, then the raised panel and a stepped centre
      for (const s of [-1, 1]) {
        o.add(new BoxGeometry(fw, 0.028, 0.03), m.paint, { x: fx, y: (fy0 + fy1) / 2 + s * (fh / 2 - 0.014), z: 0.04 });
        o.add(new BoxGeometry(0.028, fh - 0.056, 0.03), m.paint, { x: fx + s * (fw / 2 - 0.014), y: (fy0 + fy1) / 2, z: 0.04 });
      }
      o.add(bevelBox(fw - 0.1, 0.06, fh - 0.1, 0.026).rotateX(Math.PI / 2), m.paint, { x: fx, y: (fy0 + fy1) / 2, z: 0.05 });
      if (high) o.add(bevelBox(fw - 0.42, 0.04, fh - 0.42, 0.016).rotateX(Math.PI / 2), m.paint, { x: fx, y: (fy0 + fy1) / 2, z: 0.07 });
    }
    run(o, SKIRTING, a, b, 0, m.paint);
    if (cap) run(o, CHAIR_RAIL, a, b, top, m.gloss);
  };

  const WAIN = 2.0;
  const PIC_Y = 5.42;
  const finishWall = (o: Wall, len: number, wains: [number, number][]): void => {
    for (const [a, b] of wains) wainscot(o, a, b, WAIN, true);
    run(o, CROWN, 0, len, H - 0.34, m.gloss);
    run(o, PICTURE_RAIL, 0, len, PIC_Y, m.gloss);
  };
  finishWall(wallAt('back'), frames.back.len, [[0, frames.back.len]]);
  finishWall(wallAt('side'), frames.side.len, [[0, frames.side.len]]);
  finishWall(wallAt('front'), frames.front.len, [[0, frames.front.len]]);

  // the window wall: panelled wainscot to either side of the opening, and an apron of panels under the stool
  {
    const o = wallAt('window');
    const a = frames.window.len;
    const wz0 = ROOM.winZ0 - zBack;
    const wz1 = ROOM.winZ1 - zBack;
    wainscot(o, 0, wz0 - 0.26, WAIN, true);
    wainscot(o, wz1 + 0.26, a, WAIN, true);
    wainscot(o, wz0 - 0.26, wz1 + 0.26, ROOM.winY0 - 0.12 - FLOOR_Y, false);
    run(o, CROWN, 0, a, H - 0.34, m.gloss);
    run(o, PICTURE_RAIL, 0, a, PIC_Y, m.gloss);
    // casing: jambs, a head with corner blocks and a cornice, a stool, apron and corbels, and painted reveal liners
    const wy0 = ROOM.winY0 - FLOOR_Y;
    const wy1 = ROOM.winY1 - FLOOR_Y;
    const ow = wz1 - wz0;
    for (const s of [-1, 1]) {
      const jx = s < 0 ? wz0 - 0.13 : wz1 + 0.13;
      o.add(bevelBox(0.26, 0.05, wy1 - wy0 + 0.1, 0.012).rotateX(Math.PI / 2), m.gloss, { x: jx, y: (wy0 + wy1) / 2 + 0.05, z: 0.025 });
      o.add(new BoxGeometry(0.04, wy1 - wy0, 0.07), m.gloss, { x: s < 0 ? wz0 - 0.02 : wz1 + 0.02, y: (wy0 + wy1) / 2, z: 0.0 });
      o.add(new BoxGeometry(0.03, wy1 - wy0, 0.24), m.gloss, { x: s < 0 ? wz0 + 0.015 : wz1 - 0.015, y: (wy0 + wy1) / 2, z: -0.12 });
      o.add(bevelBox(0.3, 0.075, 0.3, 0.02).rotateX(Math.PI / 2), m.gloss, { x: jx, y: wy1 + 0.13, z: 0.04 });
      o.add(new CylinderGeometry(0.075, 0.075, 0.02, 16).rotateX(Math.PI / 2), m.brass, { x: jx, y: wy1 + 0.13, z: 0.085 });
      o.add(new CylinderGeometry(0.045, 0.045, 0.024, 12).rotateX(Math.PI / 2), m.paint, { x: jx, y: wy1 + 0.13, z: 0.092 });
    }
    o.add(bevelBox(ow + 0.5, 0.05, 0.26, 0.012).rotateX(Math.PI / 2), m.gloss, { x: (wz0 + wz1) / 2, y: wy1 + 0.13, z: 0.03 });
    o.add(new BoxGeometry(ow, 0.03, 0.24), m.gloss, { x: (wz0 + wz1) / 2, y: wy1 - 0.015, z: -0.12 });
    run(o, CHAIR_RAIL, wz0 - 0.34, wz1 + 0.34, wy1 + 0.26, m.gloss);
    o.add(bevelBox(ow + 0.62, 0.065, 0.12, 0.014).rotateX(Math.PI / 2), m.gloss, { x: (wz0 + wz1) / 2, y: wy1 + 0.32, z: 0.06 });
    // stool (the sill board), apron and two scrolled corbels
    o.add(bevelBox(ow + 0.5, 0.07, 0.46, 0.02), m.gloss, { x: (wz0 + wz1) / 2, y: wy0 - 0.035, z: 0.15 });
    o.add(new BoxGeometry(ow + 0.3, 0.03, 0.24), m.gloss, { x: (wz0 + wz1) / 2, y: wy0 - 0.015, z: -0.12 });
    o.add(bevelBox(ow + 0.3, 0.2, 0.05, 0.012).rotateX(Math.PI / 2), m.gloss, { x: (wz0 + wz1) / 2, y: wy0 - 0.18, z: 0.03 });
    for (const s of [-1, 1]) o.add(bevelBox(0.07, 0.3, 0.2, 0.02).rotateX(Math.PI / 2), m.gloss, { x: (wz0 + wz1) / 2 + s * (ow / 2 - 0.2), y: wy0 - 0.28, z: 0.22 });
  }

  // ——— the rug, with a fringe at each end ———
  const rugW = 7.6; const rugD = 6.4;
  k.add(new PlaneGeometry(rugW, rugD).rotateX(-Math.PI / 2), m.rug, { x: 0.4, y: FLOOR_Y + 0.008, z: 0.4 });
  if (high) {
    const ft = keep(fringeTexture());
    ft.wrapS = RepeatWrapping; ft.repeat.set(rugD / 0.9, 1);
    const fringe = keep(new MeshStandardMaterial({ map: ft, alphaTest: 0.5, side: DoubleSide, roughness: 1 }));
    fringe.userData.noShadow = true;
    for (const s of [-1, 1]) k.add(new PlaneGeometry(rugD, 0.22).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), fringe, { x: 0.4 + s * (rugW / 2 + 0.11), y: FLOOR_Y + 0.006, z: 0.4 });
  }

  // ——— picture frames hung from the rail on cords ———
  const gilt = keep(new MeshStandardMaterial({ color: '#b98a3d', roughness: 0.34, metalness: 0.85, envMapIntensity: 1.2 }));
  const artCache = new Map<string, MeshStandardMaterial>();
  const hang = (o: Wall, cxw: number, cy: number, w: number, h: number, kind: 'lighthouse' | 'map' | 'plate' | 'plate2', frameMat: MeshStandardMaterial, bar: number, mat: boolean): void => {
    let artMat = artCache.get(kind);
    if (!artMat) {
      const art = paintingTexture(kind, high);
      own.push(art.map); if (art.normalMap) own.push(art.normalMap);
      artMat = keep(new MeshStandardMaterial({ map: art.map, ...(art.normalMap ? { normalMap: art.normalMap, normalScale: new Vector2(0.5, 0.5) } : {}), roughness: kind === 'lighthouse' ? 0.5 : 0.75 }));
      artCache.set(kind, artMat);
    }
    const t = 0.09;
    for (const s of [-1, 1]) {
      o.add(bevelBox(w + 2 * bar, t, bar, 0.022).rotateX(Math.PI / 2), frameMat, { x: cxw, y: cy + s * (h / 2 + bar / 2), z: 0.045 });
      o.add(bevelBox(bar, t, h, 0.022).rotateX(Math.PI / 2), frameMat, { x: cxw + s * (w / 2 + bar / 2), y: cy, z: 0.045 });
    }
    if (mat) o.add(new PlaneGeometry(w, h), m.paper, { x: cxw, y: cy, z: 0.012 });
    const inset = mat ? 0.16 : 0;
    o.add(new PlaneGeometry(w - inset, h - inset * 1.2), artMat, { x: cxw, y: cy, z: 0.02 });
    if (kind !== 'lighthouse') o.add(new PlaneGeometry(w, h), m.glass, { x: cxw, y: cy, z: 0.058 });
    // cords up to a brass hook on the picture rail
    const hook = new Vector3(cxw, PIC_Y + 0.02, 0.09);
    for (const s of [-1, 1]) o.add(rod(new Vector3(cxw + s * (w / 2 - 0.08), cy + h / 2 + bar, 0.05), hook, 0.005, 4), m.black);
    o.add(new TorusGeometry(0.025, 0.006, 5, 10, Math.PI * 1.5), m.brass, { x: cxw, y: PIC_Y + 0.05, z: 0.09 });
  };
  {
    const side = wallAt('side');
    // local x on the side wall = (zFront - world z): the big seascape centred on world z -1.1
    hang(side, zFront + 1.1, 3.23, 2.2, 1.5, 'lighthouse', gilt, 0.14, false);
    hang(side, zFront - 2.9, 3.25, 0.82, 1.1, 'plate', m.walnut, 0.07, true);
    hang(side, zFront - 1.8, 3.25, 0.82, 1.1, 'plate2', m.walnut, 0.07, true);
    const back = wallAt('back');
    hang(back, 4.9 - x0, 3.2, 1.8, 1.3, 'map', m.walnut, 0.09, true);
    hang(back, 1.6 - x0, 3.3, 0.82, 1.1, 'plate', m.walnut, 0.07, true);
    hang(back, 2.7 - x0, 3.3, 0.82, 1.1, 'plate2', m.walnut, 0.07, true);
  }

  // ——— wall sconces either side of the seascape: brass arm, glass tulip, a candle bulb ———
  const flame = keep(new MeshStandardMaterial({ color: '#fff0d2', emissive: '#ffc277', emissiveIntensity: 2.0 }));
  const halo = keep(glowTexture());
  const sconceHalos: Sprite[] = [];
  const sconce = (wz: number, wy: number): void => {
    const o = k.at({ x: x0, y: FLOOR_Y + wy, z: wz, ry: Math.PI / 2 });
    o.add(new CylinderGeometry(0.1, 0.12, 0.03, 20).rotateX(Math.PI / 2), m.brass, { z: 0.015 });
    o.add(new SphereGeometry(0.045, 10, 8), m.brass, { z: 0.06 });
    o.add(tube([[0, 0, 0.06], [0, -0.05, 0.2], [0, -0.04, 0.36]], 0.017, 12, 6), m.brass);
    o.add(new TorusGeometry(0.06, 0.008, 6, 14).rotateY(Math.PI / 2), m.brass, { y: -0.02, z: 0.36 });
    o.add(lathe([[0, 0], [0.05, 0], [0.06, 0.02], [0.03, 0.03], [0, 0.03]], 14), m.brass, { y: -0.05, z: 0.36 });
    o.add(new CylinderGeometry(0.02, 0.02, 0.1, 10), m.paper, { y: 0.02, z: 0.36 });
    o.add(new SphereGeometry(0.028, 10, 8).scale(1, 1.5, 1), flame, { y: 0.1, z: 0.36 });
    o.add(lathe([[0.03, 0], [0.07, 0.07], [0.1, 0.19], [0.095, 0.24], [0.085, 0.24], [0.088, 0.19], [0.06, 0.07], [0.026, 0]], 16), m.glass, { y: 0.0, z: 0.36 });
    const s = new Sprite(new SpriteMaterial({ map: halo, color: '#ffcf94', transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0.55 }));
    s.userData.glow = true;
    s.position.set(x0 + 0.36, FLOOR_Y + wy + 0.1, wz);
    s.scale.setScalar(0.8);
    parent.add(s);
    own.push(s.material);
    sconceHalos.push(s);
  };
  sconce(-2.6, 3.35);
  sconce(0.45, 3.35);

  // ——— a plaster ceiling rose around the pendant cord ———
  k.add(lathe([[0.05, -0.22], [0.08, -0.2], [0.18, -0.15], [0.3, -0.12], [0.36, -0.09], [0.5, -0.07], [0.5, -0.045], [0.62, -0.025], [0.62, 0]], seg), m.paint, { x: 0.9, y: ceil, z: -0.3 });
  for (let i = 0; i < 12 && high; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.add(new SphereGeometry(0.045, 8, 6).scale(1, 0.6, 1), m.paint, { x: 0.9 + Math.cos(a) * 0.42, y: ceil - 0.06, z: -0.3 + Math.sin(a) * 0.42 });
  }

  // ——— window: drapes on a brass rod, rings, finials ———
  const rodY = 4.3; const rodX = 6.28;
  k.add(rod(new Vector3(rodX, rodY, -3.1), new Vector3(rodX, rodY, 4.7), 0.034, 10), m.brass);
  for (const z of [-3.1, 4.7]) {
    k.add(new SphereGeometry(0.095, 14, 10), m.brass, { x: rodX, y: rodY, z });
    k.add(new CylinderGeometry(0.025, 0.04, 0.12, 8).rotateX(Math.PI / 2), m.brass, { x: rodX, y: rodY, z: z + Math.sign(z) * -0.1 });
  }
  for (const z of [-3.05, 4.65]) k.add(rod(new Vector3(rodX + 0.0, rodY, z), new Vector3(x1 - 0.02, rodY - 0.0, z), 0.012, 6), m.brass);
  const drape = (zOuter: number, dir: 1 | -1): void => {
    const W = 1.5; const yTop = rodY - 0.15; const Ht = yTop - (FLOOR_Y + 0.04);
    const cols = high ? 26 : 14; const rows = high ? 34 : 16;
    const g = new PlaneGeometry(W, Ht, cols, rows);
    const pos = g.attributes.position!;
    const tieY = FLOOR_Y + 2.15;
    const X0 = rodX - 0.07;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / W + 0.5;
      const v = Ht / 2 - pos.getY(i);
      const yw = yTop - v;
      const pinch = 1 - 0.55 * Math.exp(-(((yw - tieY) / 0.5) ** 2));
      const flare = yw < tieY - 0.2 ? 1 + (tieY - 0.2 - yw) * 0.04 : 1;
      const across = u * W * pinch * flare;
      const amp = 0.085 * (0.55 + 0.45 * Math.min(1, u * 5)) * (0.65 + 0.35 * pinch);
      pos.setXYZ(i, X0 + Math.sin(u * 6 * Math.PI * 2 + (dir > 0 ? 0 : 1.3)) * amp, yw, zOuter + dir * across);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    k.add(g, m.curtain);
    // the tie-back rope round the pinch, and the brass hook it hangs on
    k.add(new TorusGeometry(0.22, 0.02, 6, 18).rotateX(Math.PI / 2).scale(0.5, 1, 1), m.brassAged, { x: X0, y: tieY, z: zOuter + dir * W * 0.225 });
    k.add(new SphereGeometry(0.04, 8, 6), m.brass, { x: x1 - 0.04, y: tieY, z: zOuter + dir * 0.18 });
    for (let i = 0; i < 8; i++) k.add(new TorusGeometry(0.05, 0.007, 5, 12).rotateY(Math.PI / 2), m.brass, { x: rodX, y: rodY, z: zOuter + dir * (i + 0.5) * (W / 8) });
  };
  drape(-2.9, 1);
  drape(4.5, -1);

  // ——— the window's light: a few soft slanted shafts, faint, drifting a little ———
  const shaftMat = keep(new MeshBasicMaterial({ map: keep(shaftTexture()), color: '#ffd7a6', transparent: true, opacity: 0.07, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }));
  const shafts: Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const z = -0.5 + i * 1.3;
    const lean = 4.6 + i * 0.4;
    const g = new BufferGeometry();
    // a parallelogram: the window's height at the glass, carried down and into the room
    g.setAttribute('position', new Float32BufferAttribute([6.4, 3.5, 0, 6.4, 1.0, 0, 6.4 - lean, -1.3, 0, 6.4 - lean, 1.2, 0, 6.4, 3.5, 0, 6.4 - lean, -1.3, 0], 3));
    g.setAttribute('uv', new Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0], 2));
    const mesh = new Mesh(g, shaftMat);
    mesh.position.z = z;
    mesh.userData.glow = true;
    mesh.renderOrder = 4;
    parent.add(mesh);
    own.push(g);
    shafts.push(mesh);
  }

  return {
    update(time: number): void {
      shaftMat.opacity = 0.06 + Math.sin(time * 0.21) * 0.012;
      shafts.forEach((s, i) => { s.position.z = -0.5 + i * 1.3 + Math.sin(time * 0.1 + i * 2) * 0.05; });
      sconceHalos.forEach((s, i) => { (s.material as SpriteMaterial).opacity = 0.5 + Math.sin(time * 5.1 + i * 3) * 0.04 + Math.sin(time * 11.3 + i) * 0.02; });
    },
  };
}
