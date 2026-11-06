import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  HalfFloatType,
  InstancedMesh,
  LinearFilter,
  Material,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  SRGBColorSpace,
  NoColorSpace,
  Scene,
  SpotLight,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { asset } from '../asset';
import { arrivalScreens, heightToNormal, plasterMaps, woodMaps } from '../bake/RoomTextures';
import { mulberry32 } from '../util';
import { requestCompile } from '../warm';
import type { Quality } from '../quality';
import type { FlightPath } from '../rig/FlightPath';
import type { CameraRig } from '../rig/CameraRig';
import { DETOUR, T_S, flareAt, smooth, tOfU } from '../rig/detour';
import {
  OFFICE_LINE, ROOM_K, detourPose, envelopePose, type DetourPose, type DetourScene, type EnvelopePose,
} from '../rig/officeShot';
import { envelopeTextures } from './Envelopes';
import { DETOUR_COPY } from '../../story/copy';
import { CAMPAIGN, OFFICE_ROW } from '../../story/fleet';
import { buildOfficeWalls } from './OfficeWalls';
import {
  Batcher, LAYOUT, PROP_SIZES, ROOM, meshesUnder, placementMatrix, standIn, type PropName, type StandInMaterial,
} from './OfficeProps';

/**
 * The office detour's stage (see rig/detour.ts): an open-plan IT office on a floor of the city tower the flight
 * line crosses (pathPoints.mjs DETOUR_TOWER). The line goes straight in the tower's west face and straight out of
 * its east face; between the two cuts the camera is in here, and the dart crosses the room in one straight, level
 * line from the window it came in by to the window wall opposite, right over the one live laptop.
 *
 * It is not inside the city: the room is its own stage far below the world (y = -200), and while
 * the camera is in it the Engine hides everything else (applyVisibility). What each window wall shows
 * is the real night city, rendered ONCE from the tower's facade on that side into a texture (`bakeBackdrop`),
 * so each view out costs one textured quad. Everything that sits still is batched by material
 * (OfficeProps.Batcher), the laptops included, so the room is a few dozen draws.
 *
 * What moves, all keyed on the detour clock u: every monitor in the room flickering on red (all the same "Dear
 * all", the old way) as the dart comes in, then dying; the envelope that drops out of the dart's belly into the
 * one laptop that is on (its screen then flips from the waiting inbox to the delivered one, the arrival office's
 * `arrivalScreens`); the white flare over each cut; and the glass bursting out of the east face as the dart leaves.
 */

/** the office's grade, laid over the chapter grade while the camera is inside (Engine.applyOfficeGrade) */
export const OFFICE_GRADE = {
  fogColor: '#121722', fogNear: 30, fogFar: 90, envIntensity: 0.45, rays: 0,
  filmic: 1, exposure: 1.3, sat: 1, bloom: 0.8, bloomThreshold: 0.9, bounce: 1.2, wet: 0.08,
  /** the scene's sun and sky light stand in for the ceiling's light: soft, cool, from above */
  sunColor: '#e9eeff', sunIntensity: 0.95, sunDir: [0.22, 1, 0.38] as [number, number, number],
  hemiSky: '#a9b6cf', hemiGround: '#3b352f', hemiIntensity: 1.15,
} as const;

/** how far below the world the room is staged */
const STAGE_Y = -200;
/** the laptop model's display is 1.38 wide; a 14-inch display is 0.31 m */
const LAPTOP_SCALE = 0.225;
const IDLE_GLOW = 0.55;

/** the office card's words, the red flicker's and Lena's screen's: story/copy.ts DETOUR_COPY */
const CARD_ROWS = DETOUR_COPY.rows.map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');

/** the delivered card, the same HUD card as the lighthouse's (`.delivery` in global.css) */
class OfficeCard {
  private el: HTMLDivElement;
  private panel: HTMLDivElement;
  private projected = new Vector3();
  private docked = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'delivery delivery--office';
    this.el.dataset.visible = 'false';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `
      <span class="delivery__ring" aria-hidden="true"></span>
      <svg class="delivery__leader" width="56" height="44" viewBox="0 0 56 44" aria-hidden="true">
        <path d="M0 44 L26 10 L56 10" fill="none" stroke="currentColor" stroke-width="1.5" />
      </svg>
      <div class="delivery__panel">
        <div class="delivery__bar">
          <span>${DETOUR_COPY.bar}</span>
          <span class="delivery__live">LIVE</span>
        </div>
        <div class="delivery__title" data-text="${DETOUR_COPY.title}">${DETOUR_COPY.title}</div>
        <div class="delivery__sub">${DETOUR_COPY.sub}</div>
        <ul class="delivery__log">${CARD_ROWS}</ul>
      </div>`;
    this.panel = this.el.querySelector<HTMLDivElement>('.delivery__panel')!;
    document.body.appendChild(this.el);
  }

  /**
   * Pinned to the screen with its leader on a wide screen; on a narrow one (a phone) the panel cannot sit beside
   * the screen without leaving the frame, so it docks across the bottom inside a 16 px gutter, without the leader.
   */
  update(visible: boolean, anchor: Vector3, camera: Camera): void {
    const next = visible ? 'true' : 'false';
    if (this.el.dataset.visible !== next) this.el.dataset.visible = next;
    if (!visible) return;
    const dock = innerWidth < 640;
    if (dock !== this.docked) {
      this.docked = dock;
      const ring = this.el.querySelector<HTMLElement>('.delivery__ring');
      const leader = this.el.querySelector<SVGElement>('.delivery__leader');
      if (ring) ring.style.display = dock ? 'none' : '';
      if (leader) leader.style.display = dock ? 'none' : '';
      this.panel.style.left = dock ? '16px' : '';
      this.panel.style.right = dock ? 'auto' : '';
      this.panel.style.bottom = dock ? '0px' : '';
      this.panel.style.top = dock ? 'auto' : '';
      this.panel.style.width = dock ? `${Math.max(innerWidth - 32, 200)}px` : '';
      this.panel.style.boxSizing = dock ? 'border-box' : '';
    }
    if (dock) {
      this.el.dataset.flip = 'false';
      this.el.dataset.below = 'false';
      this.panel.style.width = `${Math.max(innerWidth - 32, 200)}px`;
      this.el.style.setProperty('--x', '0px');
      // (the panel hangs above this point: its bottom edge is 24 px off the frame's)
      this.el.style.setProperty('--y', `${Math.round(innerHeight - 24)}px`);
      return;
    }
    this.projected.copy(anchor).project(camera);
    const behind = this.projected.z > 1;
    const x = (this.projected.x * 0.5 + 0.5) * innerWidth;
    const y = (-this.projected.y * 0.5 + 0.5) * innerHeight;
    // the panel is up to 330 wide, 54 off the anchor: keep it, and the anchor, inside the frame's 16 px gutter
    const flip = x > innerWidth - 400;
    const cx = MathUtils.clamp(x, flip ? 16 + 54 + 330 : 16, flip ? innerWidth - 16 : innerWidth - 16 - 54 - 330);
    this.el.dataset.flip = String(flip);
    this.el.dataset.below = String(y < 250);
    this.el.style.setProperty('--x', `${Math.round(behind ? innerWidth / 2 : cx)}px`);
    this.el.style.setProperty('--y', `${Math.round(behind ? innerHeight / 2 : MathUtils.clamp(y, 120, innerHeight - 40))}px`);
  }

  dispose(): void {
    this.el.remove();
  }
}

interface PropManifest {
  file: string;
  nodes: { name: string; size?: [number, number, number]; emissive?: string[] }[];
}

export class Office {
  /** the room, staged below the world, in room units (metres x ROOM_K) */
  readonly group = new Group();
  /** a white-out laid over the lens at each cut (a top-level scene child, placed on the camera every frame) */
  readonly flare: Mesh;
  /** the facade's glass bursting out with the dart (city world, top level) */
  readonly shards: InstancedMesh;
  /** the dart's size this frame relative to the main rig's */
  planeScale = 1;

  private stage: DetourScene;
  /**
   * The flight line's crossing of the tower, world: where it meets the west face (the cut in) and the east face
   * (the cut out), each face's outward normal, and the glass found there by a ray once the city's models are in.
   */
  private faces = {
    entry: new Vector3(), exit: new Vector3(),
    inNormal: new Vector3(-1, 0, 0), outNormal: new Vector3(1, 0, 0),
    entryGlass: new Vector3(), exitGlass: new Vector3(),
  };
  private refinedAt = -1;
  private cityChildren0: number;
  private out: DetourPose;
  private envPose: EnvelopePose = { scale: 0, pos: new Vector3(), quat: new Quaternion() };

  private high: boolean;
  private disposables: { dispose(): void }[] = [];
  private textures: Texture[] = [];
  private props = new Group();
  private propsBuilt = false;
  private laptopsBuilt = false;
  private envelope: Mesh;
  // Lena's screen: the note drafted on this PC, from the sample campaign, at her row's clock
  private screens = arrivalScreens({
    ...DETOUR_COPY.screen,
    from: CAMPAIGN.from,
    time: OFFICE_ROW.clock,
    label: CAMPAIGN.name.toUpperCase() + ' · ' + CAMPAIGN.label,
  });
  private screenMaterial: MeshStandardMaterial;
  private showing: 'idle' | 'received' = 'idle';
  private screenLight: PointLight;
  private lamp: SpotLight;
  private card = new OfficeCard();
  private screenWorld = new Vector3();
  /** the two views out: through the window wall the dart comes in by (west) and the one it leaves by (east) */
  private backdrops: { mesh: Mesh; target: WebGLRenderTarget; camera: PerspectiveCamera; bakedFor: string; face: 'in' | 'out' }[] = [];
  /** every monitor in the room: the ops dashboard dimmed, the red "Dear all" flicker, then dark */
  private monitorMaps: { dash: CanvasTexture; red: CanvasTexture } | null = null;
  private monitorState: 'dash' | 'red' | 'off' = 'dash';
  private shardSeeds: { v: Vector3; spin: Vector3; size: number }[] = [];
  private tmpM = new Matrix4();
  private tmpQ = new Quaternion();
  private tmpV = new Vector3();
  private tmpV2 = new Vector3();
  private shardSide = new Vector3();
  private shardScale = new Vector3();
  private up = new Vector3(0, 1, 0);
  private materials: Record<StandInMaterial, Material>;

  constructor(path: FlightPath, private city: { group: Group }, quality: Quality) {
    this.high = quality.tier === 'high';
    this.cityChildren0 = city.group.children.length;
    // the crossing: the flight line meets the west face at the cut in and the east face at the cut out
    path.pointAt(tOfU(DETOUR.cutIn), this.faces.entry);
    path.pointAt(tOfU(DETOUR.cutOut), this.faces.exit);
    this.faces.entryGlass.copy(this.faces.entry);
    this.faces.exitGlass.copy(this.faces.exit);
    const p0 = path.pointAt(T_S, new Vector3());
    this.group.position.set(p0.x, STAGE_Y, p0.z);
    this.group.scale.setScalar(ROOM_K);
    this.group.visible = false;
    this.stage = { origin: this.group.position.clone(), screen: new Vector3(-0.7, 0.95, 6.45) };
    this.out = {
      weight: 0, camPos: new Vector3(), look: new Vector3(), fov: 45, roll: 0,
      planePos: new Vector3(), planeQuat: new Quaternion(), planeScale: 1,
    };

    this.materials = this.makeMaterials();
    this.buildShell();
    this.buildWalls();

    // the live laptop's display: the arrival office's two mail screens, swapped on u
    this.keep(this.screens.idle, this.screens.received);
    this.textures.push(this.screens.idle, this.screens.received);
    this.screenMaterial = this.own(new MeshStandardMaterial({
      map: this.screens.idle, emissiveMap: this.screens.idle, emissive: '#ffffff', emissiveIntensity: IDLE_GLOW, roughness: 0.25,
    }));

    // the envelope, as BatchSend makes it: air-mail paper, lit a little from within
    const faces = envelopeTextures(OFFICE_ROW.name); // Lena's name on it
    this.keep(faces.front, faces.back);
    this.textures.push(faces.front, faces.back);
    const paper = (map?: CanvasTexture): MeshStandardMaterial => this.own(new MeshStandardMaterial({
      ...(map ? { map, emissiveMap: map } : { color: '#efe6cf' }),
      emissive: '#ffd9a0', emissiveIntensity: 0.5, roughness: 0.75,
    }));
    const edge = paper();
    const envGeometry = this.own(new BoxGeometry(0.78, 0.02, 0.527));
    this.envelope = new Mesh(envGeometry, [edge, edge, paper(faces.front), paper(faces.back), edge, edge]);
    this.envelope.visible = false;
    this.group.add(this.envelope);

    // the desk lamp at the live laptop (the room's key) and the live screen's spill
    const hx = OFFICE_LINE.x;
    this.lamp = new SpotLight('#ffd3a0', 7, 7, 0.62, 0.65, 1.6);
    this.lamp.position.set(hx - 0.46, 1.18, 6.48);
    this.lamp.target.position.set(hx, 0.76, 6.42);
    if (this.high) {
      this.lamp.castShadow = true;
      this.lamp.shadow.mapSize.set(512, 512);
      this.lamp.shadow.camera.near = 0.05;
      this.lamp.shadow.camera.far = 8;
      this.lamp.shadow.bias = -0.0008;
      this.lamp.shadow.normalBias = 0.02;
    }
    this.screenLight = new PointLight('#9be8ff', 0.6, 5, 2);
    this.screenLight.position.set(hx, 0.95, 6.15);
    this.group.add(this.lamp, this.lamp.target, this.screenLight);

    // the flare
    const flareMaterial = this.own(new MeshBasicMaterial({
      color: new Color('#f2f6ff').multiplyScalar(3), transparent: true, opacity: 0,
      depthTest: false, depthWrite: false, fog: false, toneMapped: true,
    }));
    this.flare = new Mesh(this.own(new PlaneGeometry(2, 2)), flareMaterial);
    this.flare.frustumCulled = false;
    this.flare.renderOrder = 10000;
    this.flare.visible = false;

    // the glass shards: little triangles of tinted glass
    const tri = new BufferGeometry();
    tri.setAttribute('position', new BufferAttribute(new Float32Array([-0.09, -0.06, 0, 0.1, -0.05, 0, -0.01, 0.1, 0]), 3));
    tri.computeVertexNormals();
    this.own(tri);
    const glass = this.own(new MeshStandardMaterial({
      color: '#d4e8ff', metalness: 0.9, roughness: 0.08, side: DoubleSide, emissive: '#6f8fb8', emissiveIntensity: 0.5,
    }));
    const n = this.high ? 42 : 24;
    this.shards = new InstancedMesh(tri, glass, n);
    this.shards.frustumCulled = false;
    this.shards.visible = false;
    const rand = mulberry32(7307);
    for (let i = 0; i < n; i++) {
      // out along the face's normal (x), spread up/down (y) and across the face (z), in world units per unit of burst
      this.shardSeeds.push({
        v: new Vector3(1.2 + rand() * 3.4, (rand() - 0.25) * 2.4, (rand() - 0.5) * 3.6),
        spin: new Vector3(rand() * 12, rand() * 12, rand() * 12),
        size: 0.35 + rand() * 0.8,
      });
    }

    // the two views out: a quad behind each window wall, filled by bakeBackdrop from that face of the tower
    const size = this.high ? [2048, 1024] : [1024, 512];
    const dist = 14;
    for (const face of ['in', 'out'] as const) {
      const target = this.own(new WebGLRenderTarget(size[0]!, size[1]!, { type: HalfFloatType, generateMipmaps: false }));
      target.texture.minFilter = LinearFilter;
      const camera = new PerspectiveCamera(62, 2, 0.1, 400);
      const h = 2 * dist * Math.tan(MathUtils.degToRad(camera.fov / 2));
      const material = this.own(new MeshBasicMaterial({ color: '#0b1020', fog: false }));
      const mesh = new Mesh(this.own(new PlaneGeometry(h * 2, h)), material);
      // behind the window the dart came in by (looking back west), and behind the far one (east, ahead)
      if (face === 'in') mesh.position.set(hx, 1.7, -dist);
      else {
        mesh.position.set(hx, 1.7, ROOM.z1 + dist);
        mesh.rotation.y = Math.PI;
      }
      this.group.add(mesh);
      this.backdrops.push({ mesh, target, camera, bakedFor: '', face });
    }

    this.buildLaptops();
    void this.loadProps();
  }

  private own<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private keep(...xs: { dispose(): void }[]): void {
    this.disposables.push(...xs);
  }

  // ---------------------------------------------------------------- the room

  private makeMaterials(): Record<StandInMaterial, Material> {
    const high = this.high;
    const std = (o: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial =>
      this.own(new MeshStandardMaterial(o));
    const lam = woodMaps({ boards: 1, base: [214, 206, 190], seed: 71, roughness: 0.5, normal: 0.8 });
    this.keep(lam.map, lam.normalMap, lam.roughnessMap);
    this.textures.push(lam.map, lam.normalMap, lam.roughnessMap);
    const laminate = std({ map: lam.map, ...(high ? { normalMap: lam.normalMap, roughnessMap: lam.roughnessMap } : {}), roughness: high ? 1 : 0.5 });
    const white = std({ color: '#e7e8e6', roughness: 0.5 });
    const frame = high ? std({ color: '#d9dcdf', roughness: 0.42, metalness: 0.35 }) : white;
    const metal = std({ color: '#8b9198', roughness: 0.36, metalness: 0.8 });
    const dark = std({ color: '#1a1d23', roughness: 0.5, metalness: 0.2 });
    const fabric = std({ color: '#33475f', roughness: 1 });
    const monitor = monitorTexture();
    this.own(monitor);
    this.textures.push(monitor);
    const red = blastTexture();
    this.own(red);
    this.textures.push(red);
    this.monitorMaps = { dash: monitor, red };
    const screen = std({ map: monitor, emissiveMap: monitor, emissive: '#ffffff', emissiveIntensity: 0.75, roughness: 0.22 });
    const led = this.own(new MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new Color(2.6, 2.6, 2.6) }));
    const panel = std({ color: '#f4f7ff', emissive: '#eef3ff', emissiveIntensity: 0.9, roughness: 0.6 });
    const glow = high ? std({ color: '#fff1d6', emissive: '#ffd49a', emissiveIntensity: 2.2 }) : panel;
    const plant = std({ color: '#2f6a3b', roughness: 0.8 });
    const pot = high ? std({ color: '#d6d0c4', roughness: 0.7 }) : white;
    const board = whiteboardTexture();
    this.own(board);
    this.textures.push(board);
    const paper = std({ map: board, roughness: 0.22 });
    return { laminate, frame, metal, dark, fabric, screen, led, panel, white, plant, pot, paper, glow };
  }

  /** floor, ceiling, walls, the window wall's mullions and glass, the LED cove */
  /** posters, a TV, a door, conduit, panels, a dado: what hangs on and is fixed to the walls (OfficeWalls.ts) */
  private buildWalls(): void {
    const { x0, x1, z1, h } = ROOM;
    const walls = buildOfficeWalls({ x0, x1, D: z1, h }, { dark: this.materials.dark, metal: this.materials.metal, screen: this.materials.screen }, this.high);
    this.group.add(walls.group);
    for (const d of walls.disposables) this.own(d);
    this.textures.push(...walls.textures);
  }

  private buildShell(): void {
    const { x0, x1, z1, h } = ROOM;
    const W = x1 - x0;
    const D = z1;
    const high = this.high;
    const add = (mesh: Mesh, receive = true): Mesh => {
      mesh.receiveShadow = receive && high;
      mesh.castShadow = false;
      this.group.add(mesh);
      this.own(mesh.geometry);
      return mesh;
    };

    // carpet tiles, quarter-turned
    const carpet = carpetMaps();
    for (const t of [carpet.map, carpet.normalMap]) t.repeat.set(W / 2, D / 2);
    this.keep(carpet.map, carpet.normalMap);
    this.textures.push(carpet.map, carpet.normalMap);
    const floorMat = this.own(new MeshStandardMaterial({ map: carpet.map, ...(high ? { normalMap: carpet.normalMap } : {}), roughness: 0.95 }));
    const floor = add(new Mesh(new PlaneGeometry(W, D), floorMat));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, D / 2);

    // the suspended ceiling: 600 mm tiles in a grid
    const tiles = ceilingTexture();
    tiles.repeat.set(W / 2.4, D / 2.4);
    this.own(tiles);
    this.textures.push(tiles);
    const ceilMat = this.own(new MeshStandardMaterial({ map: tiles, roughness: 0.9 }));
    const ceiling = add(new Mesh(new PlaneGeometry(W, D), ceilMat), false);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, h, D / 2);

    // painted side walls (the two other walls are glass: the tower's west and east faces)
    const grey = plasterMaps([192, 197, 202], 61);
    for (const t of [grey.map, grey.normalMap]) t.repeat.set(3, 1);
    this.keep(grey.map, grey.normalMap);
    this.textures.push(grey.map, grey.normalMap);
    const wallMat = this.own(new MeshStandardMaterial({ map: grey.map, ...(high ? { normalMap: grey.normalMap, normalScale: new Vector2(0.5, 0.5) } : {}), roughness: 0.92 }));
    const left = add(new Mesh(new PlaneGeometry(D, h), wallMat));
    left.position.set(x0, h / 2, D / 2);
    left.rotation.y = Math.PI / 2;
    const right = add(new Mesh(new PlaneGeometry(D, h), wallMat));
    right.position.set(x1, h / 2, D / 2);
    right.rotation.y = -Math.PI / 2;

    // the two window walls: anodised mullions every 1.4 m, a head, a sill and a transom; and the glass
    const batch = new Batcher();
    const alu = high ? this.own(new MeshStandardMaterial({ color: '#2a2e35', roughness: 0.35, metalness: 0.75 })) : this.materials.dark;
    const box = (m: Material, w: number, hh: number, d: number, x: number, y: number, z: number): void => {
      const g = new BoxGeometry(w, hh, d);
      g.translate(x, y, z);
      batch.add(m, g);
      g.dispose();
    };
    for (const [z, inward] of [[0, 1], [D, -1]] as const) {
      // (the dart's line, x OFFICE_LINE.x, runs through the middle of a bay: no mullion on it)
      for (let x = x0; x <= x1 + 1e-6; x += 1.4) box(alu, 0.07, h, 0.14, x, h / 2, z);
      box(alu, W, 0.12, 0.16, 0, h - 0.06, z);
      box(alu, W, 0.1, 0.2, 0, 0.05, z + 0.02 * inward);
      box(alu, W, 0.05, 0.1, 0, 2.45, z);
    }
    // skirting and the ceiling's LED cove along the side walls
    const skirt = this.materials.dark;
    box(skirt, 0.02, 0.08, D, x0 + 0.01, 0.04, D / 2);
    box(skirt, 0.02, 0.08, D, x1 - 0.01, 0.04, D / 2);
    const cove = this.materials.panel;
    box(cove, 0.04, 0.025, D - 0.2, x0 + 0.06, h - 0.08, D / 2);
    box(cove, 0.04, 0.025, D - 0.2, x1 - 0.06, h - 0.08, D / 2);
    for (const mesh of batch.build({ castShadow: false, receiveShadow: high })) this.group.add(mesh);

    // the glass: plain and transparent, with the room's environment in it (no transmission); one pane each side
    const glassMat = this.own(new MeshStandardMaterial({
      color: '#9fb2c6', transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0.9,
      envMapIntensity: 1.4, depthWrite: false, side: DoubleSide,
    }));
    const glassGeom = new PlaneGeometry(W, h);
    const g0 = glassGeom.clone().translate(0, h / 2, 0.005);
    const g1 = glassGeom.clone().translate(0, h / 2, D - 0.005);
    glassGeom.dispose();
    const glass = add(new Mesh(mergeGeometries([g0, g1], false), glassMat), false);
    g0.dispose();
    g1.dispose();
    glass.renderOrder = 2;
  }

  /** the furniture: the models agent's GLB where it has a prop, a stand-in where it does not */
  private async loadProps(): Promise<void> {
    let manifest: PropManifest | null = null;
    try {
      const r = await fetch(asset('/models/office/manifest.json'));
      if (r.ok) manifest = (await r.json()) as PropManifest;
    } catch {
      manifest = null;
    }
    let roots = new Map<string, Object3D>();
    const emissive = new Map<string, string[]>();
    const sizes = new Map<string, [number, number, number]>();
    if (manifest?.file) {
      try {
        const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(asset(`/models/office/${manifest.file}`));
        roots = new Map();
        for (const node of manifest.nodes) {
          const root = gltf.scene.getObjectByName(node.name);
          if (!root) continue;
          roots.set(node.name, root);
          if (node.emissive) emissive.set(node.name, node.emissive);
          if (node.size) sizes.set(node.name, node.size);
        }
      } catch {
        roots = new Map();
      }
    }
    this.buildProps(roots, emissive, sizes);
  }

  private buildProps(roots: Map<string, Object3D>, emissive: Map<string, string[]>, sizes: Map<string, [number, number, number]>): void {
    if (this.propsBuilt) return;
    this.propsBuilt = true;
    const batch = new Batcher();
    const sizeOf = (n: PropName): [number, number, number] => sizes.get(n) ?? [...PROP_SIZES[n]];
    // the desk's own height, not the pod's: the real model stands its monitor on the desk, so it is taller
    const deskTop = PROP_SIZES.desk_pod[1];
    // a GLB prop's parts, prop-local, with each material swapped where the manifest says it glows
    const glbParts = new Map<string, { geom: BufferGeometry; mat: Material }[]>();
    const glowing = new Map<Material, Material>();
    for (const [name, root] of roots) {
      const marks = emissive.get(name) ?? [];
      const parts = meshesUnder(root).flatMap(({ mesh, local }) => {
        const src = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
        let mat = src;
        const lit = marks.some((m) => mesh.name.includes(m) || src.name.includes(m));
        if (lit) {
          // screens show the office's own dashboard; LEDs and panels glow in their own colour
          if (/screen|display|monitor/i.test(mesh.name + src.name)) mat = this.materials.screen;
          else {
            let g = glowing.get(src);
            if (!g) {
              const s = src as MeshStandardMaterial;
              g = this.own(new MeshStandardMaterial({ color: s.color ?? '#ffffff', emissive: s.color ?? '#ffffff', emissiveIntensity: 1.6, roughness: 0.5 }));
              glowing.set(src, g);
            }
            mat = g;
          }
        }
        // the models face +z; the layout faces -z toward the window
        const geom = mesh.geometry.clone().applyMatrix4(local).rotateY(Math.PI);
        return [{ geom, mat }];
      });
      glbParts.set(name, parts);
    }
    const m = new Matrix4();
    const mm = new Matrix4();
    const tr = new Matrix4();
    const sc = new Matrix4();
    // the real props are built to their own sizes: a desk is one desk where the layout has a pod of two, a cable
    // tray is two metres where it has three, a rack with its doors open is wider than the layout allows, and so on
    const FIT: Partial<Record<PropName, { scale?: number; copies?: number[] }>> = {
      desk_pod: { copies: [-0.8, 0.8] },
      cable_tray: { copies: [-0.5, 0.5] },
      rack_42u: { scale: 0.85 },
      whiteboard: { scale: 1.4 },
      plant_pot: { scale: 0.75 },
    };
    for (const p of LAYOUT.props) {
      // (the real racks are wider than the layout's with their doors open: the second one stands a little further on)
      const prop = p.name === 'rack_42u' && p.z > 8.8 ? { ...p, z: p.z + 0.3 } : p;
      placementMatrix(prop, deskTop, sizeOf(p.name)[1], m);
      const glb = glbParts.get(p.name);
      if (glb) {
        const fit = FIT[p.name];
        for (const dx of fit?.copies ?? [0]) {
          mm.copy(m).multiply(tr.makeTranslation(dx, 0, 0));
          if (fit?.scale) mm.multiply(sc.makeScale(fit.scale, fit.scale, fit.scale));
          for (const part of glb) batch.add(part.mat, part.geom, mm);
        }
      } else {
        for (const part of standIn(p.name)) {
          batch.add(this.materials[part.mat], part.geom, m);
          part.geom.dispose();
        }
      }
    }
    for (const parts of glbParts.values()) parts.forEach((p) => p.geom.dispose());
    for (const mesh of batch.build({ castShadow: this.high, receiveShadow: this.high })) {
      this.props.add(mesh);
      this.own(mesh.geometry);
    }
    // a placement whose prop sits on the desk shifts the laptops to the same desk height
    this.deskTop = deskTop;
    this.group.add(this.props);
    requestCompile(this.props);
  }

  private deskTop: number = PROP_SIZES.desk_pod[1];

  /**
   * Seven laptops from the study's model, all batched by material: lids posed through the model's
   * `lid` empty (some shut, some open and dark), and one that is on, whose display is its own mesh
   * with the live mail screen.
   */
  private buildLaptops(): void {
    const high = this.high;
    const keysTexture = new TextureLoader().load(asset('/models/laptop/laptop-keys.webp'));
    keysTexture.flipY = false;
    keysTexture.colorSpace = SRGBColorSpace;
    keysTexture.anisotropy = 8;
    this.own(keysTexture);
    this.textures.push(keysTexture);
    const std = (o: ConstructorParameters<typeof MeshStandardMaterial>[0]): MeshStandardMaterial => this.own(new MeshStandardMaterial(o));
    const alu = high
      ? this.own(new MeshPhysicalMaterial({ color: '#aeb2ba', metalness: 1, roughness: 0.34, clearcoat: 0.25, clearcoatRoughness: 0.4, envMapIntensity: 1.3 }))
      : this.materials.metal;
    const black = high ? std({ color: '#0c0e13', roughness: 0.35, metalness: 0.2 }) : this.materials.dark;
    const glassy = high ? std({ color: '#1c2029', roughness: 0.18, metalness: 0.2 }) : this.materials.dark;
    const keys = std({ map: keysTexture, roughness: 0.55, metalness: 0.1 });
    const off = high ? std({ color: '#06080c', roughness: 0.12, metalness: 0.3 }) : this.materials.dark;
    const backlight = high ? this.own(new MeshBasicMaterial({ color: '#4f8fe0', toneMapped: false, transparent: true, opacity: 0.22 })) : null;
    const led = high ? this.own(new MeshBasicMaterial({ color: '#5fff9f', toneMapped: false })) : null;
    const emblem = high ? std({ color: '#1a2030', emissive: '#7fb4ff', emissiveIntensity: 1.1 }) : null;
    const byName: Record<string, Material | null> = {
      base: alu, lid_shell: alu, bezel: black, black, camera: black, trackpad: glassy, rubber: black,
      keys, well: black, backlight, led, cam_led: led, emblem, screen: off,
    };
    new GLTFLoader().load(asset('/models/laptop/laptop.glb'), (gltf) => {
      if (this.laptopsBuilt) return;
      this.laptopsBuilt = true;
      const root = gltf.scene;
      let lid: Object3D | null = null;
      root.traverse((o) => { if (o.name === 'lid') lid = o; });
      const batch = new Batcher();
      const place = new Matrix4();
      const q = new Quaternion();
      let heroScreen: BufferGeometry | null = null;
      for (const lp of LAYOUT.laptops) {
        if (lid) (lid as Object3D).rotation.z = MathUtils.lerp(-Math.PI / 2 + 0.035, 0.2, lp.lid);
        const y = lp.y === 'desk' || lp.y === undefined ? this.deskTop : lp.y;
        q.setFromAxisAngle(new Vector3(0, 1, 0), lp.ry + Math.PI / 2);
        place.compose(new Vector3(lp.x, y + 0.01, lp.z), q, new Vector3(LAPTOP_SCALE, LAPTOP_SCALE, LAPTOP_SCALE));
        for (const { mesh, local } of meshesUnder(root)) {
          const world = new Matrix4().multiplyMatrices(place, local);
          if (lp.on && mesh.name === 'screen') {
            const g = mesh.geometry.clone();
            // glTF uvs run top-down; the mail screens are canvases drawn top-down with flipY
            const uv = g.attributes.uv;
            if (uv) for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
            g.applyMatrix4(world);
            heroScreen = g;
            continue;
          }
          const mat = mesh.name in byName ? byName[mesh.name] : black;
          if (!mat) continue;
          batch.add(mat, mesh.geometry, world);
        }
      }
      for (const mesh of batch.build({ castShadow: high, receiveShadow: high })) {
        this.group.add(mesh);
        this.own(mesh.geometry);
        if (mesh.material === backlight) mesh.castShadow = false;
      }
      root.traverse((o) => (o as Mesh).geometry?.dispose());
      if (heroScreen) {
        const g = heroScreen as BufferGeometry;
        const screen = new Mesh(g, this.screenMaterial);
        this.own(g);
        g.computeBoundingBox();
        const c = g.boundingBox!.getCenter(new Vector3());
        this.screenCentre.copy(c);
        if (this.stage) this.stage.screen.copy(c);
        this.screenLight.position.set(c.x, c.y + 0.12, c.z - 0.34);
        this.group.add(screen);
      }
      requestCompile(this.group);
    });
  }

  /** the live screen's centre, room-local metres (an estimate until the laptop has loaded) */
  private screenCentre = new Vector3(OFFICE_LINE.x, 0.95, 6.45);

  // ---------------------------------------------------------------- the tower and the flight

  /**
   * Once the city's models are in: find the real glass on both faces where the flight line crosses them (a ray
   * along the line at each face), for the shards and the views out. The crossing itself is the flight line's.
   */
  refineTarget(): void {
    const count = this.city.group.children.length;
    if (count <= this.cityChildren0 || count === this.refinedAt) return;
    const f = this.faces;
    let found = 0;
    for (const [at, n, out] of [[f.entry, f.inNormal, f.entryGlass], [f.exit, f.outNormal, f.exitGlass]] as const) {
      const ray = new Raycaster(at.clone().addScaledVector(n, 3), n.clone().negate(), 0, 4.5);
      // (a Sprite's raycast reads the ray's camera: the city has sprites, and without one the cast threw, which
      // stopped the warm-up before the views out were ever baked)
      ray.camera = this.backdrops[0]!.camera;
      let hits: ReturnType<Raycaster['intersectObject']> = [];
      try {
        hits = ray.intersectObject(this.city.group, true);
      } catch {
        hits = [];
      }
      const hit = hits.find((h) => (h.object as Mesh).isMesh);
      if (!hit) continue; // the models are still streaming: try again on the next warm
      out.copy(hit.point).addScaledVector(n, 0.03);
      found++;
    }
    if (found === 2) this.refinedAt = count;
  }

  /** the office's stage */
  get scene(): DetourScene {
    return this.stage;
  }

  // ---------------------------------------------------------------- per frame

  /** The office's camera and dart for u, written into the rig's `detour` (CameraRig applies it last). */
  pose(u: number, rig: CameraRig, aspect: number): void {
    const d = rig.detour;
    detourPose(u, this.stage, aspect, this.out);
    d.weight = this.out.weight;
    if (d.weight <= 0) {
      this.planeScale = 1;
      return;
    }
    d.camPos.copy(this.out.camPos);
    d.look.copy(this.out.look);
    d.fov = this.out.fov;
    d.roll = this.out.roll;
    d.planePos.copy(this.out.planePos);
    d.planeQuat.copy(this.out.planeQuat);
    this.planeScale = this.out.planeScale;
  }

  /** Everything in the office that moves with u, the flare on the lens and the glass out of the east face. */
  update(u: number, inside: boolean, camera: PerspectiveCamera, showCard: boolean): void {
    const stage = this.stage;
    const live = u > 0 && u < 1;

    // the white-out over each cut
    const f = live ? flareAt(u) : 0;
    this.flare.visible = f > 0.003;
    if (this.flare.visible) {
      const mat = this.flare.material as MeshBasicMaterial;
      mat.opacity = Math.min(f * 1.15, 1);
      const dist = camera.near * 1.5;
      const hh = dist * Math.tan(MathUtils.degToRad(camera.fov / 2)) * 1.2;
      this.flare.position.copy(camera.position).add(this.tmpV.set(0, 0, -dist).applyQuaternion(camera.quaternion));
      this.flare.quaternion.copy(camera.quaternion);
      this.flare.scale.set(hh * camera.aspect, hh, 1);
      this.flare.updateMatrixWorld();
    }

    // the glass bursting out of the east face with the dart: along the face's normal, falling, spinning
    const burst = live ? (u - DETOUR.cutOut) / (DETOUR.shardsTo - DETOUR.cutOut) : -1;
    this.shards.visible = burst > 0 && burst < 1;
    if (this.shards.visible) {
      const n = this.faces.outNormal;
      const side = this.shardSide.crossVectors(n, this.up).normalize();
      // fast out of the glass, slowing: the dart itself crosses this stretch slowly (the pace eases out of the cut)
      const k = 1 - (1 - burst) * (1 - burst);
      for (let i = 0; i < this.shardSeeds.length; i++) {
        const s = this.shardSeeds[i]!;
        const p = this.tmpV.copy(this.faces.exitGlass)
          .addScaledVector(n, s.v.x * k)
          .addScaledVector(side, s.v.z * k);
        p.y += s.v.y * k - 3.2 * burst * burst;
        this.tmpQ.setFromAxisAngle(this.tmpV2.set(s.spin.x, s.spin.y, s.spin.z).normalize(), (s.spin.x + s.spin.y) * burst);
        const sc = s.size * (1 - smooth(burst, 0.75, 1));
        this.tmpM.compose(p, this.tmpQ, this.shardScale.setScalar(sc));
        this.shards.setMatrixAt(i, this.tmpM);
      }
      this.shards.instanceMatrix.needsUpdate = true;
    }

    if (!inside) {
      this.card.update(false, this.screenWorld, camera);
      this.envelope.visible = false;
      return;
    }

    // every monitor: the dashboard, dim, as the dart comes in; then all of them at once on the same red "Dear all"
    // (flickering), the old way; then dark. Only the one laptop stays lit.
    this.updateMonitors(u);

    // the envelope out of the dart's belly, into the screen
    envelopePose(u, stage, this.envPose);
    this.envelope.visible = this.envPose.scale > 0.002;
    if (this.envelope.visible) {
      this.envelope.position.copy(this.envPose.pos);
      this.envelope.quaternion.copy(this.envPose.quat);
      this.envelope.scale.setScalar(0.32 * this.envPose.scale);
    }

    // the screen: the waiting inbox brightens as the envelope reaches it, and reads delivered once it is in
    const arrive = smooth(u, DETOUR.envelopeFrom + 0.03, DETOUR.absorbed);
    const done = u >= DETOUR.received ? 1 : 0;
    const flash = done ? Math.exp(-(u - DETOUR.received) * 80) : 0;
    const want = done ? 'received' : 'idle';
    if (want !== this.showing) {
      this.showing = want;
      this.screenMaterial.map = this.screenMaterial.emissiveMap = this.screens[want];
    }
    this.screenMaterial.emissiveIntensity = IDLE_GLOW + arrive * 0.5 + done * 0.35 + flash * 2.2;
    this.screenLight.intensity = 0.45 + arrive * 0.8 + done * 0.35 + flash * 2.5;

    // the card, pinned to the screen
    this.screenWorld.copy(stage.screen).multiplyScalar(ROOM_K).add(stage.origin);
    this.card.update(showCard && u >= DETOUR.received + 0.01 && u < DETOUR.cardTo, this.screenWorld, camera);
  }

  /** the monitors' state at u (one shared material: swapping its map costs nothing) */
  private updateMonitors(u: number): void {
    const maps = this.monitorMaps;
    const mat = this.materials.screen as MeshStandardMaterial;
    if (!maps) return;
    const red = u >= DETOUR.flickerFrom && u < DETOUR.flickerTo;
    const want: 'dash' | 'red' | 'off' = red ? 'red' : u < DETOUR.flickerFrom ? 'dash' : 'off';
    if (want !== this.monitorState) {
      this.monitorState = want;
      const map = want === 'red' ? maps.red : maps.dash;
      // (texture for texture: a uniform, no new program)
      if (mat.map !== map) mat.map = mat.emissiveMap = map;
    }
    if (want === 'red') {
      // a hard flicker keyed on u (so a scrub replays it): on, a stutter, on
      const k = (u - DETOUR.flickerFrom) / (DETOUR.flickerTo - DETOUR.flickerFrom);
      const stutter = k > 0.35 && k < 0.5 ? 0.25 : k > 0.8 ? 0.6 : 1;
      mat.emissiveIntensity = 1.6 * stutter;
    } else mat.emissiveIntensity = want === 'dash' ? 0.35 : 0.02;
  }

  // ---------------------------------------------------------------- warm-up

  /** the cameras the views out are baked from that are stale (the city's models changed since): none, one or two */
  backdropCamerasIfStale(): PerspectiveCamera[] {
    const n = this.city.group.children.length;
    if (n <= this.cityChildren0) return [];
    const out: PerspectiveCamera[] = [];
    for (const b of this.backdrops) {
      const glass = b.face === 'in' ? this.faces.entryGlass : this.faces.exitGlass;
      const normal = b.face === 'in' ? this.faces.inNormal : this.faces.outNormal;
      const key = `${glass.x.toFixed(2)},${glass.y.toFixed(2)},${glass.z.toFixed(2)}:${n}`;
      if (key === b.bakedFor) continue;
      b.bakedFor = key;
      const cam = b.camera;
      cam.position.copy(glass).addScaledVector(normal, 0.8);
      cam.lookAt(this.tmpV.copy(cam.position).addScaledVector(normal, 10).add(this.tmpV2.set(0, -1.2, 0)));
      cam.updateMatrixWorld();
      out.push(cam);
    }
    return out;
  }

  /**
   * A view out of the office: the city as it stands at T_S, from just outside the tower's glass on that side, into
   * a texture (the Engine has set the grade and visibility of T_S and hidden the dart).
   */
  bakeBackdrop(renderer: WebGLRenderer, scene: Scene, cam: PerspectiveCamera): void {
    const b = this.backdrops.find((x) => x.camera === cam);
    if (!b) return;
    const shown = [this.group.visible, this.flare.visible, this.shards.visible];
    this.group.visible = this.flare.visible = this.shards.visible = false;
    // (shadow maps update as usual: a city light whose map was never drawn must not be sampled empty)
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(b.target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    [this.group.visible, this.flare.visible, this.shards.visible] = shown as [boolean, boolean, boolean];
    const m = b.mesh.material as MeshBasicMaterial;
    if (m.map !== b.target.texture) {
      m.map = b.target.texture;
      m.color.set('#ffffff');
      m.needsUpdate = true;
    }
  }

  /**
   * Upload what the office draws and draw it once, off screen, so the first frame inside links,
   * uploads and allocates nothing (programs are linked by the Engine's warm states; this covers
   * textures, geometry buffers and the lamp's shadow map). The Engine has made the office state visible.
   */
  warmRender(renderer: WebGLRenderer, scene: Scene, target: WebGLRenderTarget): void {
    for (const t of this.textures) renderer.initTexture(t);
    if (!this.warmCam) this.warmCam = new PerspectiveCamera(100, 2, 0.1, 400);
    const cam = this.warmCam;
    const o = this.group.position;
    // from the far corner, looking back at the entry window: nearly the whole room is in view
    cam.position.set(o.x + 6 * ROOM_K, o.y + 2.6 * ROOM_K, o.z + 9.6 * ROOM_K);
    cam.lookAt(o.x - 2 * ROOM_K, o.y + 0.8 * ROOM_K, o.z + 1 * ROOM_K);
    cam.updateMatrixWorld();
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    // the flare is drawn too (fully transparent), so its program is the one the frame will ask for; and the
    // monitors in their red state, so its texture is uploaded
    const flareShown = this.flare.visible;
    const flareMat = this.flare.material as MeshBasicMaterial;
    const flareOpacity = flareMat.opacity;
    this.flare.visible = true;
    flareMat.opacity = 0;
    this.updateMonitors((DETOUR.flickerFrom + DETOUR.flickerTo) / 2);
    renderer.render(scene, cam);
    this.updateMonitors(0);
    this.flare.visible = flareShown;
    flareMat.opacity = flareOpacity;
    // and from the entry window, looking in (the other side of every desk), toward the far windows
    cam.position.set(o.x - 1 * ROOM_K, o.y + 2 * ROOM_K, o.z + 0.4 * ROOM_K);
    cam.lookAt(o.x, o.y + 0.8 * ROOM_K, o.z + 6 * ROOM_K);
    cam.updateMatrixWorld();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
  }

  private warmCam: PerspectiveCamera | null = null;

  /**
   * The tower close up, as the dart flies at it: the main flight never comes this near it, so its
   * close-up tier (and whatever streams in with it) is drawn once here, off screen, ahead of the
   * detour. The Engine has set T_S's visibility and moved the city's detail toward the entry.
   */
  warmApproach(renderer: WebGLRenderer, scene: Scene, target: WebGLRenderTarget): void {
    if (!this.warmCam) this.warmCam = new PerspectiveCamera(100, 2, 0.1, 400);
    const cam = this.warmCam;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    // both faces: the run at the west one, the burst out of the east one
    for (const [at, n] of [[this.faces.entry, this.faces.inNormal], [this.faces.exit, this.faces.outNormal]] as const) {
      cam.position.copy(at).addScaledVector(n, 5).add(this.tmpV.set(0, 0.5, 0));
      cam.lookAt(at);
      cam.updateMatrixWorld();
      renderer.render(scene, cam);
    }
    renderer.setRenderTarget(prev);
  }

  /** where the flight line meets the tower's west face (the cut into the office) */
  get entry(): Vector3 {
    return this.faces.entry;
  }

  /** triangles and draws of the room as built (for the budget check) */
  stats(): { triangles: number; draws: number } {
    let triangles = 0;
    let draws = 0;
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const g = m.geometry;
      const n = g.index ? g.index.count : g.attributes.position!.count;
      const mats = Array.isArray(m.material) ? m.material.length : 1;
      triangles += n / 3;
      draws += mats;
    });
    return { triangles: Math.round(triangles), draws };
  }

  dispose(): void {
    this.card.dispose();
    for (const d of this.disposables) d.dispose();
    this.shards.dispose();
  }
}

// ---------------------------------------------------------------- the room's own canvases

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function repeating(c: HTMLCanvasElement, srgb: boolean): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** 500 mm carpet tiles, four to a side, laid quarter-turned (the pile reads in alternating directions) */
function carpetMaps(): { map: CanvasTexture; normalMap: CanvasTexture } {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rand = mulberry32(5501);
  const T = S / 4;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const shade = 46 + Math.floor(rand() * 8);
      ctx.fillStyle = `rgb(${shade - 8}, ${shade - 2}, ${shade + 10})`;
      ctx.fillRect(i * T, j * T, T, T);
      const across = (i + j) % 2 === 0;
      for (let k = 0; k < 90; k++) {
        const a = 0.04 + rand() * 0.06;
        ctx.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
        const o = rand() * T;
        if (across) ctx.fillRect(i * T, j * T + o, T, 1 + rand() * 1.5);
        else ctx.fillRect(i * T + o, j * T, 1 + rand() * 1.5, T);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(i * T, j * T, T, 1);
      ctx.fillRect(i * T, j * T, 1, T);
    }
  }
  // fleck
  for (let k = 0; k < 4000; k++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(120,140,170,0.25)' : 'rgba(10,12,16,0.3)';
    ctx.fillRect(rand() * S, rand() * S, 1, 1);
  }
  return { map: repeating(c, true), normalMap: heightToNormal(c, 1.4) };
}

/** a suspended ceiling: 600 mm tiles with fissured faces in a slim white grid */
function ceilingTexture(): CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rand = mulberry32(5509);
  ctx.fillStyle = '#d9dcdf';
  ctx.fillRect(0, 0, S, S);
  for (let k = 0; k < 2600; k++) {
    ctx.fillStyle = `rgba(90,95,105,${0.05 + rand() * 0.12})`;
    ctx.fillRect(rand() * S, rand() * S, 1 + rand() * 3, 1);
  }
  ctx.fillStyle = '#f2f3f4';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(i * (S / 4), 0, 4, S);
    ctx.fillRect(0, i * (S / 4), S, 4);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(i * (S / 4) + 4, 0, 1, S);
    ctx.fillRect(0, i * (S / 4) + 4, S, 1);
  }
  return repeating(c, true);
}

/** what the monitors show after hours: a dark ops dashboard (traffic graphs, queue counters, a status grid) */
function monitorTexture(): CanvasTexture {
  const W = 512;
  const H = 300;
  const [c, ctx] = canvas(W, H);
  const rand = mulberry32(5521);
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0f1726';
  ctx.fillRect(0, 0, W, 22);
  ctx.fillStyle = '#3d7cff';
  ctx.fillRect(10, 8, 60, 6);
  const panel = (x: number, y: number, w: number, h: number): void => {
    ctx.fillStyle = '#0d1422';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#1c2a42';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  };
  panel(10, 32, 300, 140);
  ctx.strokeStyle = '#38d9a9';
  ctx.lineWidth = 2;
  ctx.beginPath();
  let v = 90;
  for (let x = 18; x < 304; x += 6) {
    v = MathUtils.clamp(v + (rand() - 0.5) * 22, 50, 160);
    if (x === 18) ctx.moveTo(x, v);
    else ctx.lineTo(x, v);
  }
  ctx.stroke();
  ctx.strokeStyle = '#3d7cff';
  ctx.beginPath();
  v = 130;
  for (let x = 18; x < 304; x += 6) {
    v = MathUtils.clamp(v + (rand() - 0.5) * 14, 90, 165);
    if (x === 18) ctx.moveTo(x, v);
    else ctx.lineTo(x, v);
  }
  ctx.stroke();
  panel(320, 32, 182, 66);
  panel(320, 106, 182, 66);
  ctx.fillStyle = '#e8eefc';
  ctx.font = 'bold 30px monospace';
  ctx.fillText('99.98%', 336, 78);
  ctx.fillStyle = '#38d9a9';
  ctx.fillText('0 queued', 330, 152);
  panel(10, 182, 492, 108);
  for (let i = 0; i < 24; i++) {
    for (let j = 0; j < 4; j++) {
      const r = rand();
      ctx.fillStyle = r < 0.85 ? '#1e7f5c' : r < 0.95 ? '#b38a1f' : '#2a3550';
      ctx.fillRect(20 + i * 20, 194 + j * 23, 16, 18);
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * The old way, on every monitor at once for a moment as the dart comes in: one message to everybody, the same on
 * every screen (`Dear all,` and a BCC line of hundreds). Red, like the app's own 550 / spam state.
 */
function blastTexture(): CanvasTexture {
  const W = 512;
  const H = 300;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#2a0508';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#5c0c12';
  ctx.fillRect(0, 0, W, 34);
  ctx.fillStyle = '#ffb3b3';
  ctx.font = 'bold 20px monospace';
  ctx.fillText(DETOUR_COPY.bcc[1], 16, 24);
  ctx.fillStyle = '#ff5a5a';
  ctx.font = 'bold 58px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(DETOUR_COPY.bcc[0], 24, 128);
  ctx.fillStyle = 'rgba(255,140,140,0.55)';
  for (let i = 0; i < 6; i++) ctx.fillRect(24, 160 + i * 20, 300 + ((i * 97) % 160), 8);
  ctx.strokeStyle = '#ff3b3b';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** the whiteboard: the mail route drawn up in marker, and a few sticky notes */
function whiteboardTexture(): CanvasTexture {
  const W = 1024;
  const H = 683;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#f4f6f5';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(120,130,140,0.06)';
  for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 120, 3);
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.font = 'bold 40px "Comic Sans MS", "Segoe Print", cursive';
  const box = (x: number, y: number, label: string, col: string): void => {
    ctx.strokeStyle = col;
    ctx.strokeRect(x, y, 190, 90);
    ctx.fillStyle = col;
    ctx.fillText(label, x + 22, y + 60);
  };
  box(60, 120, 'Outbox', '#1d4fbf');
  box(410, 120, 'SMTP', '#1d4fbf');
  box(760, 120, 'Inbox', '#1a8a4d');
  ctx.strokeStyle = '#222';
  for (const [x0, x1] of [[255, 405], [605, 755]] as const) {
    ctx.beginPath();
    ctx.moveTo(x0, 165);
    ctx.lineTo(x1, 165);
    ctx.lineTo(x1 - 22, 150);
    ctx.moveTo(x1, 165);
    ctx.lineTo(x1 - 22, 180);
    ctx.stroke();
  }
  ctx.fillStyle = '#c0392b';
  ctx.font = 'bold 34px "Comic Sans MS", "Segoe Print", cursive';
  ctx.fillText('SPF ✓  DKIM ✓  DMARC ✓', 300, 330);
  ctx.fillStyle = '#222';
  ctx.fillText('warm-up: 5 → 50 / day', 300, 400);
  for (const [x, y, col] of [[80, 470, '#ffe066'], [250, 500, '#ffa8a8'], [820, 450, '#a5d8ff']] as const) {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 130, 120);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x + 16, y + 40, 90, 6);
    ctx.fillRect(x + 16, y + 64, 70, 6);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

