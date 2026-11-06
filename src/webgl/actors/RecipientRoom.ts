import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  type InterleavedBufferAttribute,
  type Material,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOOK_SPINE_CELLS, bookSpineTexture, frameArtTexture, softShadowTexture } from '../bake/CanvasTextures';
import {
  WAINSCOT, arrivalScreens, leatherMaps, plasterMaps, rugMaps, wainscotMaps, woodMaps, type ArrivalScreens, type SurfaceMaps,
} from '../bake/RoomTextures';
import { asset } from '../asset';
import type { Tier } from '../quality';
import { RECEIVED_T } from '../../story/chapters';
import { CAMPAIGN, HERO, HERO_REPLY_T } from '../../story/fleet';
import { DESK_TOP, ENDING_BEATS, HOUSE } from '../rig/endingPoints.mjs';
import { requestCompile } from '../warm';
import { Beanbag } from './Beanbag';
import { createLaptop, type Laptop } from './Laptop';

/**
 * The recipient's room at home (docs/ending.md): where the dart is delivered. A small gabled house stands beyond
 * the communications tower with its gable to the runway and one tall OPEN window in it (no glass), right on the
 * flight line; behind the window is the warm study that was the old arrival office's interior (sage plaster over
 * painted wainscot, oak boards and a wool rug, a walnut desk, the brass lamp, a wall of books, framed pictures,
 * the beanbag and the potted plant), re-laid so the desk stands in the room facing the window and the laptop's
 * screen looks straight back down the line. The dart flies in through the window and into that screen.
 *
 * The house shell is blender/make_recipient_room.py's (public/models/recipient-room, one draw). The room is built
 * here once the page is idle, every surface batched by material (about 20 draws, the laptop and the beanbag
 * included). Light: on HIGH a desk lamp, a ceiling bounce and the screen's own spill; on LOW no lights at all, the
 * room's warmth is emissive.
 *
 * House-local frame: origin on the ground at the middle of the window wall's outer face (HOUSE.windowX, 0, -3.5),
 * +x into the house; interior x 0.25..10.25, z -5..5, ceiling 3.6.
 */

/**
 * The recipient and her message: the sample campaign's last row (src/story/fleet.ts: her name, her clock, the
 * sender) and the lines of direction §3 CH10 (the opening, her reply). The campaign is labelled SAMPLE on screen.
 */
export const CARA = {
  name: HERO.name,
  subject: '',
  snippet: `Hi ${HERO.name}, saw you just…`,
  reply: 'Re: Yes, Thursday works.',
  from: CAMPAIGN.from,
  time: HERO.clock,
  label: `${CAMPAIGN.name.toUpperCase()} · ${CAMPAIGN.label}`,
};

/** when the screen flips to EMAIL RECEIVED, when the message opens, and when Cara's reply is typed and sent */
const OPEN_T = 0.9935;
const REPLY_FROM = HERO_REPLY_T;
const REPLY_TO = 0.9985;

const WALL = 0.25;
const ROOM = { x0: 0.25, x1: 10.25, z0: -5, z1: 5, h: 3.6 };
const WINDOW = { z0: -1.2, z1: 1.2, y0: 0.9, y1: 2.5 };
const SIDE_WIN = { x: 3.2, half: 0.8, y0: 1.0, y1: 2.6 };
/** the screen's centre in house-local x (the line's last stretch runs at the screen's height through the window) */
const SCREEN_X = HOUSE.screen[0] - HOUSE.windowX;
const IDLE_GLOW = 0.55;

/** what the open window shows from far off: lamplight on the back wall, the screen's cool glow low in the middle */
function roomGlowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#5b4532');
  g.addColorStop(0.55, '#c98f57');
  g.addColorStop(1, '#3a2a1e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 192, 128);
  const lamp = ctx.createRadialGradient(140, 70, 4, 140, 70, 70);
  lamp.addColorStop(0, 'rgba(255,214,150,0.95)');
  lamp.addColorStop(1, 'rgba(255,214,150,0)');
  ctx.fillStyle = lamp;
  ctx.fillRect(0, 0, 192, 128);
  const screen = ctx.createRadialGradient(96, 84, 2, 96, 84, 36);
  screen.addColorStop(0, 'rgba(150,230,255,0.9)');
  screen.addColorStop(1, 'rgba(150,230,255,0)');
  ctx.fillStyle = screen;
  ctx.fillRect(0, 0, 192, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** geometry collected per material, merged into one draw per material */
class Batch {
  private lists = new Map<Material, BufferGeometry[]>();
  add(mat: Material, g: BufferGeometry, m: Matrix4): void {
    const geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    geo.applyMatrix4(m);
    let l = this.lists.get(mat);
    if (!l) this.lists.set(mat, (l = []));
    l.push(geo);
  }
  build(into: Group, own: (d: { dispose(): void }) => void): void {
    for (const [mat, list] of this.lists) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new Mesh(merged, mat);
      into.add(mesh);
      own(merged);
    }
    this.lists.clear();
  }
}

function plainGeometry(source: BufferGeometry): BufferGeometry {
  const g = new BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const attr = source.getAttribute(name) as BufferAttribute | InterleavedBufferAttribute | undefined;
    if (!attr) continue;
    const n = attr.itemSize;
    const out = new Float32Array(attr.count * n);
    for (let i = 0; i < attr.count; i++) {
      out[i * n] = attr.getX(i);
      if (n > 1) out[i * n + 1] = attr.getY(i);
      if (n > 2) out[i * n + 2] = attr.getZ(i);
    }
    g.setAttribute(name, new BufferAttribute(out, n));
  }
  if (source.index) g.setIndex(new BufferAttribute(Uint32Array.from(source.index.array as ArrayLike<number>), 1));
  return g;
}

export class RecipientRoom {
  readonly group = new Group();
  private readonly high: boolean;
  private built = false;
  /**
   * The room behind the window: drawn only from the dive on (from further out the window is a few pixels and the
   * room would cost its whole draw list); until then a warm card just inside the opening stands in for it.
   */
  private readonly interior = new Group();
  private readonly glowCard: Mesh;
  private screens: ArrivalScreens | null = null;
  private screenMaterial: MeshStandardMaterial | null = null;
  private showing: Texture | null = null;
  private screenLight: PointLight | null = null;
  /** the room's warm emissive fill on LOW (no lights there): the materials it is set on */
  private disposables: { dispose(): void }[] = [];

  constructor(tier: Tier) {
    this.high = tier === 'high';
    this.group.name = 'recipient-room';
    this.group.position.set(HOUSE.windowX, 0, HOUSE.screen[2]);
    this.loadShell(tier);
    this.interior.name = 'recipient-room-interior';
    this.interior.visible = false;
    this.group.add(this.interior);
    const card = new MeshBasicMaterial({ map: roomGlowTexture(), toneMapped: false, fog: true });
    this.glowCard = new Mesh(new PlaneGeometry(WINDOW.z1 - WINDOW.z0, WINDOW.y1 - WINDOW.y0), card);
    this.glowCard.position.set(ROOM.x0 + 0.35, (WINDOW.y0 + WINDOW.y1) / 2, 0);
    this.glowCard.rotation.y = -Math.PI / 2;
    this.group.add(this.glowCard);
    // HIGH: the room's lights (the desk lamp, a ceiling bounce, the screen's spill). Made here, not with the room, and
    // kept in the always-visible group: a changing light count recompiles every lit program
    if (this.high) {
      this.screenLight = new PointLight('#9be8ff', 0, 6, 2);
      this.screenLight.position.set(SCREEN_X - 0.8, DESK_TOP + 0.7, 0);
      const deskLight = new PointLight('#ffcc8f', 3.4, 8, 1.6);
      deskLight.position.set(SCREEN_X + 0.15 + 0.25, DESK_TOP + 0.6, -1.55);
      const roomLight = new PointLight('#ffd9a8', 6.5, 14, 1.6);
      roomLight.position.set((ROOM.x0 + ROOM.x1) / 2, 2.9, 0);
      this.group.add(this.screenLight, deskLight, roomLight);
    }
    this.disposables.push(card, card.map!, this.glowCard.geometry);
    // the room has a lot of surface to draw: it is built once the page is idle, or at once if the flight gets here first
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (idle) idle(() => this.ensure(), { timeout: 4000 });
    else setTimeout(() => this.ensure(), 2500);
  }

  private loadShell(tier: Tier): void {
    const high = tier === 'high';
    const tex = (file: string): Texture => {
      const t = new TextureLoader().load(asset(`/models/recipient-room/${file}`));
      t.flipY = false;
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = high ? 8 : 2;
      this.disposables.push(t);
      return t;
    };
    const prefix = high ? 'house' : 'house-lean';
    const mat = new MeshStandardMaterial({
      map: tex(`${prefix}-color.webp`), emissiveMap: tex(`${prefix}-emissive.webp`), emissive: '#ffffff', emissiveIntensity: 1.4,
      roughness: 0.75, metalness: 0,
    });
    this.disposables.push(mat);
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(asset(`/models/recipient-room/${high ? 'house.glb' : 'house-lean.glb'}`), (gltf) => {
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const parts: BufferGeometry[] = [];
      root.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        parts.push(plainGeometry(m.geometry).applyMatrix4(m.matrixWorld));
        m.geometry.dispose();
      });
      const merged = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      if (!merged) return;
      const mesh = new Mesh(merged, mat);
      mesh.name = 'house-shell';
      mesh.receiveShadow = high;
      this.group.add(mesh);
      this.disposables.push(merged);
      requestCompile(mesh);
    });
  }

  private ensure(): void {
    if (this.built) return;
    this.built = true;
    this.build();
  }

  private build(): void {
    const own = (...items: { dispose(): void }[]): void => { this.disposables.push(...items); };
    const batch = new Batch();
    const M = new Matrix4();
    const tmp = new Object3D();
    const place = (px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0): Matrix4 => {
      tmp.position.set(px, py, pz);
      tmp.rotation.set(rx, ry, rz);
      tmp.updateMatrix();
      return M.copy(tmp.matrix);
    };
    const surface = (m: SurfaceMaps, extra: ConstructorParameters<typeof MeshStandardMaterial>[0] = {}): MeshStandardMaterial => {
      own(m.map, m.normalMap);
      if (m.roughnessMap) own(m.roughnessMap);
      return new MeshStandardMaterial({
        map: m.map, normalMap: m.normalMap, ...(m.roughnessMap ? { roughnessMap: m.roughnessMap } : {}), roughness: 1, ...extra,
      });
    };
    const repeat = (m: SurfaceMaps, u: number, v: number): void => {
      for (const t of [m.map, m.normalMap, m.roughnessMap]) t?.repeat.set(u, v);
    };
    const box = (m: Material, w: number, h: number, d: number, px: number, py: number, pz: number, ry = 0): void => {
      batch.add(m, new BoxGeometry(w, h, d), place(px, py, pz, 0, ry));
    };
    const plane = (m: Material, w: number, h: number, px: number, py: number, pz: number, ry = 0, rx = 0): void => {
      batch.add(m, new PlaneGeometry(w, h), place(px, py, pz, rx, ry));
    };
    /** a wall face with rectangular holes: the wall split into the bands round them (u along the wall) */
    const wallWithHoles = (m: Material, u0: number, u1: number, y0: number, y1: number,
      holes: { u0: number; u1: number; y0: number; y1: number }[], at: (u: number, y: number) => [number, number, number], ry: number): void => {
      const ys = [...new Set([y0, y1, ...holes.flatMap((h) => [h.y0, h.y1])])].filter((y) => y >= y0 && y <= y1).sort((a, b) => a - b);
      for (let i = 0; i < ys.length - 1; i++) {
        const ya = ys[i]!;
        const yb = ys[i + 1]!;
        let segs: [number, number][] = [[u0, u1]];
        for (const h of holes) {
          if (h.y1 <= ya || h.y0 >= yb) continue;
          segs = segs.flatMap(([a, b]) => (h.u1 <= a || h.u0 >= b ? [[a, b]] : [...(a < h.u0 ? [[a, h.u0]] : []), ...(b > h.u1 ? [[h.u1, b]] : [])] as [number, number][]));
        }
        for (const [a, b] of segs) {
          const [px, py, pz] = at((a + b) / 2, (ya + yb) / 2);
          const g = new PlaneGeometry(b - a, yb - ya);
          // keep the texture's scale: offset the uvs to where this piece sits on the wall
          const uv = g.getAttribute('uv') as BufferAttribute;
          for (let k = 0; k < uv.count; k++) {
            uv.setXY(k, (a + uv.getX(k) * (b - a) - u0) / (u1 - u0), (ya + uv.getY(k) * (yb - ya) - y0) / (y1 - y0));
          }
          batch.add(m, g, place(px, py, pz, 0, ry));
        }
      }
    };
    const { x0, x1, z0, z1, h: H } = ROOM;
    const cx = (x0 + x1) / 2;
    const W = x1 - x0;
    const D = z1 - z0;

    // floor slab under the boards, sage plaster walls, a warm ceiling
    const plaster = plasterMaps([172, 184, 158], 43);
    repeat(plaster, 3, 1.1);
    const wall = surface(plaster, { roughness: 0.93, normalScale: new Vector2(0.55, 0.55), side: DoubleSide });
    const ceilingMat = new MeshStandardMaterial({ color: '#ece4d2', roughness: 0.95 });
    own(wall, ceilingMat);
    const winHole = { u0: WINDOW.z0, u1: WINDOW.z1, y0: WINDOW.y0, y1: WINDOW.y1 };
    const sideHole = { u0: SIDE_WIN.x - SIDE_WIN.half, u1: SIDE_WIN.x + SIDE_WIN.half, y0: SIDE_WIN.y0, y1: SIDE_WIN.y1 };
    // the window wall (faces +x, into the room), the back wall (faces -x), the side walls
    wallWithHoles(wall, z0, z1, 0, H, [winHole], (u, y) => [x0, y, -u], Math.PI / 2);
    plane(wall, D, H, x1, H / 2, 0, -Math.PI / 2);
    wallWithHoles(wall, x0, x1, 0, H, [sideHole], (u, y) => [u, y, z1], Math.PI);
    wallWithHoles(wall, x0, x1, 0, H, [sideHole], (u, y) => [u, y, z0], 0);
    plane(ceilingMat, W, D, cx, H, 0, 0, Math.PI / 2);

    // oak boards, a wool rug under the desk
    const oak = woodMaps({ boards: 8, base: [190, 138, 86], seed: 47, joints: 1, gap: 2.2, roughness: 0.46, normal: 2.6 });
    repeat(oak, W / 5.5, D / 3.2);
    const floorMat = surface(oak, { metalness: 0 });
    own(floorMat);
    plane(floorMat, W, D, cx, 0.085, 0, 0, -Math.PI / 2);
    const rugSet = rugMaps(51);
    const rugMat = new MeshStandardMaterial({ map: rugSet.map, normalMap: rugSet.normalMap, normalScale: new Vector2(0.7, 0.7), roughness: 1 });
    own(rugSet.map, rugSet.normalMap, rugMat);
    plane(rugMat, 4.6, 6.2, SCREEN_X + 0.2, 0.09, 0, Math.PI / 2, -Math.PI / 2);

    // painted wainscot, chair rail, baseboard and crown (round the window and the side windows)
    const wain = wainscotMaps([222, 211, 188], 53);
    repeat(wain, W / WAINSCOT.bayW, 1);
    const wainMat = surface(wain, { roughness: 0.55, normalScale: new Vector2(1.1, 1.1) });
    const paint = new MeshStandardMaterial({ color: '#ddd3bd', roughness: 0.5 });
    own(wainMat, paint);
    const wy = 0.09 + WAINSCOT.height / 2;
    const wainHole = (h: { u0: number; u1: number; y0: number; y1: number }) => ({ ...h, y0: h.y0 - 0.002 });
    wallWithHoles(wainMat, z0, z1, 0.09, 0.09 + WAINSCOT.height, [wainHole(winHole)], (u, y) => [x0 + 0.003, y, -u], Math.PI / 2);
    plane(wainMat, D, WAINSCOT.height, x1 - 0.003, wy, 0, -Math.PI / 2);
    wallWithHoles(wainMat, x0, x1, 0.09, 0.09 + WAINSCOT.height, [wainHole(sideHole)], (u, y) => [u, y, z1 - 0.003], Math.PI);
    wallWithHoles(wainMat, x0, x1, 0.09, 0.09 + WAINSCOT.height, [wainHole(sideHole)], (u, y) => [u, y, z0 + 0.003], 0);
    const railY = 0.09 + WAINSCOT.height + 0.02;
    // rails, baseboards, crowns on the back and side walls (the window wall's rail is cut by the opening)
    box(paint, 0.09, 0.1, D - 0.3, x1 - 0.04, railY, 0);
    box(paint, 0.08, 0.3, D - 0.3, x1 - 0.04, 0.25, 0);
    box(paint, 0.14, 0.22, D - 0.3, x1 - 0.06, H - 0.1, 0);
    for (const zz of [z0 + 0.04, z1 - 0.04]) {
      box(paint, W - 0.3, 0.3, 0.08, cx, 0.25, zz);
      box(paint, W - 0.3, 0.22, 0.14, cx, H - 0.1, zz + (zz > 0 ? -0.02 : 0.02));
      box(paint, sideHole.u0 - x0 - 0.15, 0.1, 0.09, (x0 + 0.15 + sideHole.u0) / 2, railY, zz);
      box(paint, x1 - 0.15 - sideHole.u1, 0.1, 0.09, (sideHole.u1 + x1 - 0.15) / 2, railY, zz);
    }
    box(paint, 0.08, 0.3, D - 0.3, x0 + 0.04, 0.25, 0);
    box(paint, 0.14, 0.22, D - 0.3, x0 + 0.06, H - 0.1, 0);
    // the window's inner casing (the shell has the outside)
    box(paint, 0.12, 0.1, WINDOW.z1 - WINDOW.z0 + 0.36, x0 + 0.06, WINDOW.y0 - 0.03, 0);
    box(paint, 0.1, 0.14, WINDOW.z1 - WINDOW.z0 + 0.36, x0 + 0.05, WINDOW.y1 + 0.07, 0);
    for (const zz of [WINDOW.z0 - 0.09, WINDOW.z1 + 0.09]) box(paint, 0.1, WINDOW.y1 - WINDOW.y0, 0.14, x0 + 0.05, (WINDOW.y0 + WINDOW.y1) / 2, zz);

    // dawn at the side windows: low gold light in a white frame with a mullion cross
    const dawn = new MeshBasicMaterial({ toneMapped: false, side: DoubleSide });
    dawn.color.set('#ffd2a2').multiplyScalar(1.5);
    own(dawn);
    for (const zs of [1, -1]) {
      const zz = zs * (z1 - 0.12);
      plane(dawn, SIDE_WIN.half * 2, SIDE_WIN.y1 - SIDE_WIN.y0, SIDE_WIN.x, (SIDE_WIN.y0 + SIDE_WIN.y1) / 2, zz, zs > 0 ? Math.PI : 0);
      box(paint, 0.05, SIDE_WIN.y1 - SIDE_WIN.y0, 0.05, SIDE_WIN.x, (SIDE_WIN.y0 + SIDE_WIN.y1) / 2, zz - zs * 0.02);
      box(paint, SIDE_WIN.half * 2, 0.05, 0.05, SIDE_WIN.x, (SIDE_WIN.y0 + SIDE_WIN.y1) / 2 + 0.15, zz - zs * 0.02);
    }

    // the desk: walnut, standing in the room facing the window; the laptop on it, its screen down the flight line
    const walnut = woodMaps({ boards: 1, base: [116, 80, 56], seed: 55, roughness: 0.36, normal: 1.1 });
    own(walnut.map, walnut.normalMap, walnut.roughnessMap!);
    const deskTop = new MeshStandardMaterial({ map: walnut.map, normalMap: walnut.normalMap, roughnessMap: walnut.roughnessMap, roughness: 1, envMapIntensity: 0.9 });
    const deskDark = new MeshStandardMaterial({ map: walnut.map, normalMap: walnut.normalMap, roughnessMap: walnut.roughnessMap, roughness: 1, color: '#a68e79' });
    const brass = new MeshStandardMaterial({ color: '#c09a5e', roughness: 0.3, metalness: 1 });
    own(deskTop, deskDark, brass);
    const dx = SCREEN_X + 0.15; // the desk's centre (x); the laptop's hinge is near its back edge
    const dd = 1.8; // depth (x)
    const dw = 4.0; // width (z)
    box(deskTop, dd, 0.09, dw, dx, DESK_TOP, 0);
    box(deskDark, dd, 0.12, dw, dx, DESK_TOP - 0.1, 0);
    for (const zz of [-dw / 2 + 0.12, dw / 2 - 0.12]) box(deskDark, dd - 0.2, 0.62, 0.14, dx, DESK_TOP - 0.46, zz);
    box(deskDark, 0.05, 0.4, dw - 0.4, dx + dd / 2 - 0.12, DESK_TOP - 0.3, 0); // the modesty panel at the back
    box(deskDark, 1.5, 0.52, 1.0, dx, DESK_TOP - 0.3, dw / 2 - 0.85); // drawer unit
    box(brass, 0.03, 0.03, 0.4, dx - 0.76, DESK_TOP - 0.2, dw / 2 - 0.85);
    box(brass, 0.03, 0.03, 0.4, dx - 0.76, DESK_TOP - 0.45, dw / 2 - 0.85);

    // the leather chair, pulled back off the desk and turned aside (she has just got up): off the line
    const leather = leatherMaps([104, 62, 38], 57);
    own(leather.map, leather.normalMap, leather.roughnessMap!);
    const seat = new MeshStandardMaterial({ map: leather.map, normalMap: leather.normalMap, roughnessMap: leather.roughnessMap, roughness: 1 });
    own(seat);
    const chair = new Object3D();
    chair.position.set(dx - 1.9, 0.09, -1.55);
    chair.rotation.y = -Math.PI / 2 + 0.75;
    chair.updateMatrix();
    const cp = (m: Material, w: number, h: number, d: number, px: number, py: number, pz: number): void => {
      tmp.position.set(px, py, pz);
      tmp.rotation.set(0, 0, 0);
      tmp.updateMatrix();
      batch.add(m, new BoxGeometry(w, h, d), M.multiplyMatrices(chair.matrix, tmp.matrix));
    };
    cp(seat, 0.9, 0.16, 0.9, 0, 0.55, 0);
    cp(seat, 0.9, 1.0, 0.14, 0, 1.1, -0.42);
    cp(seat, 0.14, 0.3, 0.7, -0.5, 0.78, 0);
    cp(seat, 0.14, 0.3, 0.7, 0.5, 0.78, 0);
    cp(brass, 0.1, 0.5, 0.1, 0, 0.25, 0);
    cp(brass, 0.8, 0.06, 0.1, 0, 0.04, 0);
    cp(brass, 0.1, 0.06, 0.8, 0, 0.04, 0);

    // the laptop: the Blender model, its hinge near the desk's back edge and the display turned to face the window
    // (-x); it waits, then reads EMAIL RECEIVED, opens the message and shows Cara's reply (see `update`)
    this.screens = arrivalScreens(CARA);
    own(this.screens.idle, this.screens.received);
    if (this.screens.open) own(this.screens.open);
    if (this.screens.reply) own(this.screens.reply.texture);
    const screenMaterial = new MeshStandardMaterial({
      map: this.screens.idle, emissiveMap: this.screens.idle, emissive: '#ffffff', emissiveIntensity: IDLE_GLOW, roughness: 0.25,
    });
    this.screenMaterial = screenMaterial;
    this.showing = this.screens.idle;
    own(screenMaterial);
    const laptop: Laptop = createLaptop({ screen: screenMaterial, tilt: 0.18, tier: this.high ? 'high' : 'low' });
    // panel centre = hinge + (-0.093 along the base's -x, 0.568 up) in the model; turned by pi the display faces -x
    laptop.group.position.set(SCREEN_X - 0.093, DESK_TOP + 0.045, 0);
    laptop.group.rotation.y = Math.PI;
    this.interior.add(laptop.group);
    own(laptop);

    // the brass desk lamp with a green shade, at the desk's end
    const enamel = new MeshStandardMaterial({ color: '#27503f', roughness: 0.32, metalness: 0.35, side: DoubleSide });
    const bulbGlow = new MeshStandardMaterial({ color: '#fff1d6', emissive: '#ffd49a', emissiveIntensity: 1.5 });
    own(enamel, bulbGlow);
    const lx = dx + 0.35;
    const lz = -dw / 2 + 0.45;
    batch.add(brass, new CylinderGeometry(0.16, 0.19, 0.04, 24), place(lx, DESK_TOP + 0.065, lz));
    batch.add(brass, new CylinderGeometry(0.022, 0.022, 0.62, 8), place(lx, DESK_TOP + 0.38, lz));
    batch.add(enamel, new CylinderGeometry(0.07, 0.24, 0.3, 28, 1, true), place(lx, DESK_TOP + 0.74, lz));
    batch.add(bulbGlow, new SphereGeometry(0.07, 12, 10), place(lx, DESK_TOP + 0.68, lz));
    // pendants over the desk, either side of the line
    for (const pz of [-1.3, 1.3]) {
      batch.add(paint, new CylinderGeometry(0.01, 0.01, 0.9, 6), place(dx, H - 0.45, pz));
      batch.add(enamel, new CylinderGeometry(0.05, 0.3, 0.26, 24, 1, true), place(dx, H - 1.0, pz));
      batch.add(bulbGlow, new SphereGeometry(0.08, 10, 8), place(dx, H - 1.04, pz));
    }

    // a wall of books on the north wall (screen-right, looking in), pictures and a clock on the back wall
    const shelfWood = new MeshStandardMaterial({ map: walnut.map, normalMap: walnut.normalMap, roughnessMap: walnut.roughnessMap, roughness: 1, color: '#9a8470' });
    const spineMap = bookSpineTexture();
    const books = new MeshStandardMaterial({ map: spineMap, roughness: 0.74 });
    own(shelfWood, spineMap, books);
    const spineCell = (g: BoxGeometry, cell: number): BoxGeometry => {
      const uv = g.attributes.uv as BufferAttribute;
      const step = 1 / BOOK_SPINE_CELLS;
      const inset = step * 0.03;
      const span = step - inset * 2;
      const ccx = (cell % BOOK_SPINE_CELLS) * step + inset;
      const ccy = Math.floor(cell / BOOK_SPINE_CELLS) * step + inset;
      for (let v = 0; v < uv.count; v++) uv.setXY(v, ccx + uv.getX(v) * span, ccy + uv.getY(v) * span);
      return g;
    };
    // the bookcase runs along x against the north wall; its books face -z (into the room)
    const shelfZ = z1 - 0.3;
    const shelfX = 7.0;
    const L = 3.4;
    box(shelfWood, 3.4, 3.0, 0.04, shelfX, 0.09 + 1.5, shelfZ + 0.23);
    box(shelfWood, 0.06, 3.0, 0.5, shelfX - L / 2, 0.09 + 1.5, shelfZ);
    box(shelfWood, 0.06, 3.0, 0.5, shelfX + L / 2, 0.09 + 1.5, shelfZ);
    box(shelfWood, 3.5, 0.06, 0.56, shelfX, 0.09 + 3.0, shelfZ);
    for (let row = 0; row < 5; row++) {
      const y = 0.1 + row * 0.62 + 0.03;
      box(shelfWood, 3.4, 0.05, 0.5, shelfX, y + 0.02, shelfZ);
      let xx = shelfX - L / 2 + 0.15;
      let i = 0;
      while (xx < shelfX + L / 2 - 0.3) {
        const wd = 0.1 + ((row * 7 + i) % 4) * 0.035;
        const th = 0.34 + ((row * 5 + i) % 3) * 0.07;
        const dp = 0.3 + ((row * 3 + i) % 3) * 0.03;
        batch.add(books, spineCell(new BoxGeometry(dp, th, wd), (row * 5 + i * 3) % (BOOK_SPINE_CELLS * BOOK_SPINE_CELLS)),
          place(xx + wd / 2, y + 0.05 + th / 2, shelfZ + 0.05 + (0.3 - dp) / 2 - 0.02, 0, Math.PI / 2));
        xx += wd + 0.012;
        i++;
        if (i % 11 === 0) xx += 0.25;
      }
    }
    const frameWood = new MeshStandardMaterial({ map: walnut.map, normalMap: walnut.normalMap, roughnessMap: walnut.roughnessMap, roughness: 1, color: '#8f7258' });
    const mat = new MeshStandardMaterial({ color: '#efe6d2', roughness: 0.9 });
    own(frameWood, mat);
    ([[-2.2, 2.35, 0], [2.4, 2.3, 1]] as const).forEach(([dz, fy, variant]) => {
      const art = frameArtTexture(variant);
      const artMat = new MeshStandardMaterial({ map: art, roughness: 0.8 });
      own(art, artMat);
      const fx = x1 - 0.06;
      box(frameWood, 0.06, 1.8, 1.5, fx, fy, dz);
      plane(mat, 1.34, 1.64, fx - 0.034, fy, dz, -Math.PI / 2);
      plane(artMat, 1.0, 1.3, fx - 0.036, fy, dz, -Math.PI / 2);
    });
    const clockMat = new MeshStandardMaterial({ color: '#f0e9d8', roughness: 0.5 });
    own(clockMat);
    batch.add(clockMat, new CylinderGeometry(0.4, 0.4, 0.05, 32), place(x1 - 0.05, 2.75, 0.1, 0, 0, Math.PI / 2));

    // the beanbag in the south-east corner, turned to the room, on a soft dark pool
    const beanbag = new Beanbag();
    beanbag.group.position.set(8.2, 0.09, -3.2);
    beanbag.group.rotation.y = Math.PI * 0.75;
    this.interior.add(beanbag.group);
    own(beanbag);
    const pool = new MeshBasicMaterial({ map: softShadowTexture(), color: '#000000', transparent: true, opacity: 0.6, depthWrite: false });
    own(pool, pool.map!);
    const poolMesh = new Mesh(new PlaneGeometry(1.9, 1.7), pool);
    poolMesh.position.set(8.2, 0.095, -3.2);
    poolMesh.rotation.x = -Math.PI / 2;
    poolMesh.renderOrder = -1;
    this.interior.add(poolMesh);
    own(poolMesh.geometry);

    // on LOW nothing here is lit by a lamp: the walls, the boards and the wood carry the lamplight as emissive
    if (!this.high) {
      for (const m of [wall, floorMat, wainMat, deskTop, deskDark, shelfWood, books, seat, rugMat, paint, ceilingMat, frameWood, mat]) {
        m.emissive.set('#ffb070');
        m.emissiveIntensity = 0.11;
        if (m.map) m.emissiveMap = m.map;
      }
    }

    batch.build(this.interior, (d) => own(d));

    // the potted plant (the study's), streamed in after first paint, in the north-west corner
    // (HIGH only: it is 8.7k triangles)
    if (this.high) new GLTFLoader().load(asset('/models/potted_plant_04.glb'), (gltf) => {
      const s = gltf.scene;
      const bb = new Box3().setFromObject(s);
      const size = bb.getSize(new Vector3());
      s.scale.setScalar(1.5 / Math.max(size.y, 1e-3));
      bb.setFromObject(s);
      s.position.set(x0 + 0.9, 0.09 - bb.min.y, z1 - 0.9);
      this.interior.add(s);
      requestCompile(s);
    });
    requestCompile(this.interior);
  }

  update(t: number, time: number): void {
    if (!this.group.visible) return;
    this.ensure();
    const inside = t > ENDING_BEATS.dive - 0.002;
    this.interior.visible = inside;
    this.glowCard.visible = !inside;
    const s = this.screens;
    const m = this.screenMaterial;
    if (!s || !m) return;
    // the inbox waits; the screen wakes as the dart comes through the window; at RECEIVED_T it reads EMAIL RECEIVED
    // (a flash marks the change), then the message opens and Cara's reply is typed and sent
    const arrive = MathUtils.smoothstep(t, ENDING_BEATS.window - 0.004, RECEIVED_T);
    const done = t >= RECEIVED_T ? 1 : 0;
    const flash = done ? Math.exp(-(t - RECEIVED_T) * 420) : 0;
    let want: Texture = s.idle;
    if (t >= RECEIVED_T) want = s.received;
    if (t >= OPEN_T && s.open) want = s.open;
    if (t >= REPLY_FROM && s.reply) {
      s.reply.draw((t - REPLY_FROM) / (REPLY_TO - REPLY_FROM));
      want = s.reply.texture;
    }
    if (want !== this.showing) {
      this.showing = want;
      m.map = m.emissiveMap = want;
      m.needsUpdate = true;
    }
    const ping = arrive * (1 + Math.sin(time * 3.4) * 0.05);
    m.emissiveIntensity = IDLE_GLOW + ping * 0.5 + done * 0.35 + flash * 2.6;
    if (this.screenLight) this.screenLight.intensity = ping * 2.0 + done * 1.6 + flash * 4;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
