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
import { asset } from '../asset';
import { cityRecipes, type CityLot, type KitModuleRef } from '../bake/cityGen.mjs';
import { arrivalScreens, heightToNormal, plasterMaps, woodMaps } from '../bake/RoomTextures';
import { mulberry32 } from '../util';
import { requestCompile } from '../warm';
import type { Quality } from '../quality';
import type { FlightPath } from '../rig/FlightPath';
import type { CameraRig } from '../rig/CameraRig';
import { DETOUR, T_S, flareAt, smooth } from '../rig/detour';
import {
  ROOM_K, buildExitCurve, detourPose, envelopePose, type DetourPose, type DetourScene, type EnvelopePose,
} from '../rig/officeShot';
import { envelopeTextures } from './Envelopes';
import {
  Batcher, LAYOUT, PROP_SIZES, ROOM, meshesUnder, placementMatrix, standIn, type PropName, type StandInMaterial,
} from './OfficeProps';

/**
 * The office detour's stage (see rig/detour.ts): an open-plan IT office on a floor of the city
 * tower beside the copilot climb, which the dart flies into through the glass and leaves again.
 *
 * It is not inside the city: the room is its own stage far below the world (y = -200), and while
 * the camera is in it the Engine hides everything else (applyVisibility). What the window shows
 * is the real night city, rendered ONCE from the tower's facade into a texture (`bakeBackdrop`),
 * so the view out costs one textured quad. Everything that sits still is batched by material
 * (OfficeProps.Batcher), the laptops included, so the room is a few dozen draws.
 *
 * Three things move, all keyed on the detour clock u: the envelope that follows the dart in and is
 * swallowed by the one laptop that is on (its screen then flips from the waiting inbox to the
 * delivered one, the arrival office's `arrivalScreens`), the white flare over each cut, and the
 * glass bursting out of the facade as the dart leaves.
 */

/** the office's grade, laid over the chapter grade while the camera is inside (Engine.applyOfficeGrade) */
export const OFFICE_GRADE = {
  fogColor: '#121722', fogNear: 30, fogFar: 90, envIntensity: 0.2, rays: 0,
  filmic: 1, exposure: 1.1, sat: 1, bloom: 0.8, bloomThreshold: 0.9, bounce: 1.2, wet: 0.08,
  /** the scene's sun and sky light stand in for the ceiling's light: soft, cool, from above */
  sunColor: '#e9eeff', sunIntensity: 0.55, sunDir: [0.22, 1, 0.38] as [number, number, number],
  hemiSky: '#a9b6cf', hemiGround: '#3b352f', hemiIntensity: 0.62,
} as const;

/** how far below the world the room is staged */
const STAGE_Y = -200;
/** the laptop model's display is 1.38 wide; a 14-inch display is 0.31 m */
const LAPTOP_SCALE = 0.225;
const IDLE_GLOW = 0.55;

/** the delivered card, the same HUD card as the lighthouse's (`.delivery` in global.css) */
class OfficeCard {
  private el: HTMLDivElement;
  private projected = new Vector3();

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
          <span>INBOX // IT-OPS · DESK 07</span>
          <span class="delivery__live">LIVE</span>
        </div>
        <div class="delivery__title" data-text="EMAIL DELIVERED">EMAIL DELIVERED</div>
        <ul class="delivery__log">
          <li><span>SPF</span><b>PASS</b></li>
          <li><span>DKIM</span><b>PASS</b></li>
          <li><span>DMARC</span><b>ALIGNED</b></li>
          <li><span>FOLDER</span><b>INBOX</b></li>
        </ul>
        <div class="delivery__meter" aria-hidden="true"><i></i></div>
        <div class="delivery__foot"><span>14TH FLOOR</span><span>0.62 s</span></div>
      </div>`;
    document.body.appendChild(this.el);
  }

  update(visible: boolean, anchor: Vector3, camera: Camera): void {
    const next = visible ? 'true' : 'false';
    if (this.el.dataset.visible !== next) this.el.dataset.visible = next;
    if (!visible) return;
    this.projected.copy(anchor).project(camera);
    const behind = this.projected.z > 1;
    const x = (this.projected.x * 0.5 + 0.5) * innerWidth;
    const y = (-this.projected.y * 0.5 + 0.5) * innerHeight;
    this.el.dataset.flip = String(x > innerWidth - 400);
    this.el.dataset.below = String(y < 250);
    this.el.style.setProperty('--x', `${Math.round(behind ? innerWidth / 2 : x)}px`);
    this.el.style.setProperty('--y', `${Math.round(behind ? innerHeight / 2 : y)}px`);
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

  private stage: DetourScene | null = null;
  private lots: CityLot[] = [];
  private lotsLoaded = false;
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
  private screens = arrivalScreens();
  private screenMaterial: MeshStandardMaterial;
  private showing: 'idle' | 'received' = 'idle';
  private screenLight: PointLight;
  private lamp: SpotLight;
  private card = new OfficeCard();
  private screenWorld = new Vector3();
  private backdrop: Mesh;
  private backdropTarget: WebGLRenderTarget;
  private backdropCamera = new PerspectiveCamera(62, 2, 0.1, 400);
  /** the backdrop is baked for this entry point and this many city children (re-baked when either changes) */
  private bakedFor = '';
  private shardSeeds: { v: Vector3; spin: Vector3; size: number }[] = [];
  private tmpM = new Matrix4();
  private tmpQ = new Quaternion();
  private tmpV = new Vector3();
  private tmpV2 = new Vector3();
  private shardSide = new Vector3();
  private shardScale = new Vector3();
  private up = new Vector3(0, 1, 0);
  private materials: Record<StandInMaterial, Material>;

  constructor(private path: FlightPath, private city: { group: Group }, quality: Quality) {
    this.high = quality.tier === 'high';
    this.cityChildren0 = city.group.children.length;
    const p0 = path.pointAt(T_S, new Vector3());
    this.group.position.set(p0.x, STAGE_Y, p0.z);
    this.group.scale.setScalar(ROOM_K);
    this.group.visible = false;
    this.out = {
      weight: 0, camPos: new Vector3(), look: new Vector3(), fov: 45, roll: 0,
      planePos: new Vector3(), planeQuat: new Quaternion(), planeScale: 1,
    };

    this.materials = this.makeMaterials();
    this.buildShell();

    // the live laptop's display: the arrival office's two mail screens, swapped on u
    this.keep(this.screens.idle, this.screens.received);
    this.textures.push(this.screens.idle, this.screens.received);
    this.screenMaterial = this.own(new MeshStandardMaterial({
      map: this.screens.idle, emissiveMap: this.screens.idle, emissive: '#ffffff', emissiveIntensity: IDLE_GLOW, roughness: 0.25,
    }));

    // the envelope, as BatchSend makes it: air-mail paper, lit a little from within
    const faces = envelopeTextures();
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

    // the desk lamp (the room's key) and the live screen's spill
    this.lamp = new SpotLight('#ffd3a0', 7, 7, 0.62, 0.65, 1.6);
    this.lamp.position.set(-3.46, 1.18, 3.18);
    this.lamp.target.position.set(-3.0, 0.76, 3.12);
    if (this.high) {
      this.lamp.castShadow = true;
      this.lamp.shadow.mapSize.set(512, 512);
      this.lamp.shadow.camera.near = 0.05;
      this.lamp.shadow.camera.far = 8;
      this.lamp.shadow.bias = -0.0008;
      this.lamp.shadow.normalBias = 0.02;
    }
    this.screenLight = new PointLight('#9be8ff', 0.6, 5, 2);
    this.screenLight.position.set(-3.0, 0.95, 3.05);
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
      this.shardSeeds.push({
        v: new Vector3(3 + rand() * 7, (rand() - 0.3) * 5, (rand() - 0.5) * 7),
        spin: new Vector3(rand() * 12, rand() * 12, rand() * 12),
        size: 0.5 + rand() * 1.1,
      });
    }

    // the view out: a quad behind the glass, filled by bakeBackdrop
    const size = this.high ? [2048, 1024] : [1024, 512];
    this.backdropTarget = new WebGLRenderTarget(size[0]!, size[1]!, { type: HalfFloatType, generateMipmaps: false });
    this.backdropTarget.texture.minFilter = LinearFilter;
    this.own(this.backdropTarget);
    const dist = 14;
    const h = 2 * dist * Math.tan(MathUtils.degToRad(this.backdropCamera.fov / 2));
    const backdropMaterial = this.own(new MeshBasicMaterial({ color: '#0b1020', fog: false }));
    this.backdrop = new Mesh(this.own(new PlaneGeometry(h * 2, h)), backdropMaterial);
    this.backdrop.position.set(-2.3, 1.7, -dist);
    this.group.add(this.backdrop);

    void this.loadLots();
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

    // painted walls; the back wall in the company navy
    const grey = plasterMaps([192, 197, 202], 61);
    const navy = plasterMaps([40, 54, 82], 63);
    for (const m of [grey, navy]) {
      for (const t of [m.map, m.normalMap]) t.repeat.set(3, 1);
      this.keep(m.map, m.normalMap);
      this.textures.push(m.map, m.normalMap);
    }
    const wallMat = this.own(new MeshStandardMaterial({ map: grey.map, ...(high ? { normalMap: grey.normalMap, normalScale: new Vector2(0.5, 0.5) } : {}), roughness: 0.92 }));
    const backMat = high
      ? this.own(new MeshStandardMaterial({ map: navy.map, normalMap: navy.normalMap, normalScale: new Vector2(0.5, 0.5), roughness: 0.9 }))
      : wallMat;
    const back = add(new Mesh(new PlaneGeometry(W, h), backMat));
    back.position.set(0, h / 2, D);
    back.rotation.y = Math.PI;
    const left = add(new Mesh(new PlaneGeometry(D, h), wallMat));
    left.position.set(x0, h / 2, D / 2);
    left.rotation.y = Math.PI / 2;
    const right = add(new Mesh(new PlaneGeometry(D, h), wallMat));
    right.position.set(x1, h / 2, D / 2);
    right.rotation.y = -Math.PI / 2;

    // the window wall: anodised mullions every 1.4 m, a head, a sill and a transom; and the glass
    const batch = new Batcher();
    const alu = high ? this.own(new MeshStandardMaterial({ color: '#2a2e35', roughness: 0.35, metalness: 0.75 })) : this.materials.dark;
    const box = (m: Material, w: number, hh: number, d: number, x: number, y: number, z: number): void => {
      const g = new BoxGeometry(w, hh, d);
      g.translate(x, y, z);
      batch.add(m, g);
      g.dispose();
    };
    for (let x = x0; x <= x1 + 1e-6; x += 1.4) box(alu, 0.07, h, 0.14, x, h / 2, 0);
    box(alu, W, 0.12, 0.16, 0, h - 0.06, 0);
    box(alu, W, 0.1, 0.2, 0, 0.05, 0.02);
    box(alu, W, 0.05, 0.1, 0, 2.45, 0);
    // skirting and the ceiling's LED cove along three walls
    const skirt = this.materials.dark;
    box(skirt, W, 0.08, 0.02, 0, 0.04, D - 0.01);
    box(skirt, 0.02, 0.08, D, x0 + 0.01, 0.04, D / 2);
    box(skirt, 0.02, 0.08, D, x1 - 0.01, 0.04, D / 2);
    const cove = this.materials.panel;
    box(cove, W - 0.2, 0.025, 0.04, 0, h - 0.08, D - 0.06);
    box(cove, 0.04, 0.025, D - 0.2, x0 + 0.06, h - 0.08, D / 2);
    box(cove, 0.04, 0.025, D - 0.2, x1 - 0.06, h - 0.08, D / 2);
    for (const mesh of batch.build({ castShadow: false, receiveShadow: high })) this.group.add(mesh);

    // the glass: plain and transparent, with the room's environment in it (no transmission)
    const glassMat = this.own(new MeshStandardMaterial({
      color: '#9fb2c6', transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0.9,
      envMapIntensity: 1.4, depthWrite: false, side: DoubleSide,
    }));
    const glass = add(new Mesh(new PlaneGeometry(W, h), glassMat), false);
    glass.position.set(0, h / 2, 0.005);
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
        const gltf = await new GLTFLoader().loadAsync(asset(`/models/office/${manifest.file}`));
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
    const deskTop = sizeOf('desk_pod')[1];
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
        const geom = mesh.geometry.clone().applyMatrix4(local);
        return [{ geom, mat }];
      });
      glbParts.set(name, parts);
    }
    const m = new Matrix4();
    for (const p of LAYOUT.props) {
      placementMatrix(p, deskTop, sizeOf(p.name)[1], m);
      const glb = glbParts.get(p.name);
      if (glb) {
        for (const part of glb) batch.add(part.mat, part.geom, m);
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
        this.screenLight.position.set(c.x, c.y + 0.05, c.z - 0.28);
        this.group.add(screen);
      }
      requestCompile(this.group);
    });
  }

  /** the live screen's centre, room-local metres (an estimate until the laptop has loaded) */
  private screenCentre = new Vector3(-3.0, 0.88, 3.4);

  // ---------------------------------------------------------------- the tower and the flight

  private async loadLots(): Promise<void> {
    try {
      const manifest = (await fetch(asset('/models/city-kit/manifest.json')).then((r) => r.json())) as { modules: KitModuleRef[] };
      this.lots = cityRecipes(manifest.modules).lots;
    } catch {
      this.lots = [];
    }
    this.lotsLoaded = true;
    this.pickTower();
  }

  /** a lot's half extents on the ground (a quarter turn swaps width and depth) */
  private extents(lot: CityLot): [number, number] {
    const turned = Math.round(lot.yaw / (Math.PI / 2)) % 2 !== 0;
    return [(turned ? lot.d : lot.w) / 2, (turned ? lot.w : lot.d) / 2];
  }

  /**
   * The tower the dart flies into: the nearest lot to P(T_S) that stands at least 3 above the dart,
   * entered through the face that looks toward it. Picked from the city's own lots at runtime, then
   * refined against the real facade by a ray (`refineTarget`) once the city's models are in.
   */
  private pickTower(): void {
    const p0 = this.path.pointAt(T_S, new Vector3());
    const t0 = this.path.tangentAt(T_S, new Vector3());
    const g = this.city.group.position;
    let best: CityLot | null = null;
    let bestD = Infinity;
    for (const lot of this.lots) {
      if (lot.h < p0.y + 3) continue;
      const d = Math.hypot(lot.x + g.x - p0.x, lot.z + g.z - p0.z);
      if (d < bestD) { bestD = d; best = lot; }
    }
    if (!best || bestD > 30) return;
    const cx = best.x + g.x;
    const cz = best.z + g.z;
    const [hx, hz] = this.extents(best);
    const dx = p0.x - cx;
    const dz = p0.z - cz;
    const normal = Math.abs(dx) / hx > Math.abs(dz) / hz ? new Vector3(Math.sign(dx), 0, 0) : new Vector3(0, 0, Math.sign(dz));
    const entry = new Vector3(
      normal.x !== 0 ? cx + normal.x * hx : MathUtils.clamp(p0.x, cx - hx + 0.35, cx + hx - 0.35),
      MathUtils.clamp(p0.y + 1.0, 2, best.h * 0.6),
      normal.z !== 0 ? cz + normal.z * hz : MathUtils.clamp(p0.z, cz - hz + 0.35, cz + hz - 0.35),
    );
    this.stage = {
      p0, t0, mainCam: new Vector3(), mainLook: new Vector3(), mainFov: 40,
      entry, normal, origin: this.group.position.clone(), screen: this.screenCentre.clone(), exit: null,
    };
    this.stage.exit = buildExitCurve(this.stage, (p) => this.clear(p));
  }

  /** lift a point of the flight out of any building it would stand in */
  private clear(p: Vector3): void {
    const g = this.city.group.position;
    for (const lot of this.lots) {
      const [hx, hz] = this.extents(lot);
      if (Math.abs(p.x - (lot.x + g.x)) < hx + 1.4 && Math.abs(p.z - (lot.z + g.z)) < hz + 1.4 && p.y < lot.h + 2.5) {
        p.y = lot.h + 2.5;
      }
    }
  }

  /** Once the city's models are in: move the entry point onto the real glass (a ray at the facade). */
  refineTarget(): void {
    const stage = this.stage;
    if (!stage) return;
    const count = this.city.group.children.length;
    if (count <= this.cityChildren0 || count === this.refinedAt) return;
    const n = stage.normal;
    const ray = new Raycaster(stage.entry.clone().addScaledVector(n, 4), n.clone().negate(), 0, 8);
    const hits = ray.intersectObject(this.city.group, true);
    const hit = hits.find((h) => h.distance > 0.5 && (h.object as Mesh).isMesh);
    if (!hit) return; // the models are still streaming: try again on the next warm
    this.refinedAt = count;
    stage.entry.copy(hit.point).addScaledVector(n, 0.03);
    stage.exit = buildExitCurve(stage, (p) => this.clear(p));
  }

  /** the scene the detour flies through, once the tower is known (null before the city's lots arrive) */
  get scene(): DetourScene | null {
    return this.stage;
  }

  // ---------------------------------------------------------------- per frame

  /** The detour's camera and dart for u, written into the rig's `detour` (CameraRig applies it last). */
  pose(u: number, rig: CameraRig, aspect: number): void {
    const d = rig.detour;
    const stage = this.stage;
    if (!stage || u <= 0 || u >= 1) {
      d.weight = 0;
      this.planeScale = 1;
      return;
    }
    stage.mainFov = rig.mainPose(T_S, stage.mainCam, stage.mainLook);
    detourPose(u, stage, aspect, this.out);
    d.weight = this.out.weight;
    d.camPos.copy(this.out.camPos);
    d.look.copy(this.out.look);
    d.fov = this.out.fov;
    d.roll = this.out.roll;
    d.planePos.copy(this.out.planePos);
    d.planeQuat.copy(this.out.planeQuat);
    this.planeScale = this.out.weight > 0 ? this.out.planeScale : 1;
  }

  /** Everything in the office that moves with u, the flare on the lens and the glass on the facade. */
  update(u: number, inside: boolean, camera: PerspectiveCamera, showCard: boolean): void {
    const stage = this.stage;
    const live = !!stage && u > 0 && u < 1;

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

    // the glass bursting out of the facade
    const burst = live ? (u - DETOUR.cutOut) / (DETOUR.climb + 0.05 - DETOUR.cutOut) : -1;
    this.shards.visible = burst > 0 && burst < 1;
    if (this.shards.visible && stage) {
      const n = stage.normal;
      const side = this.shardSide.crossVectors(n, this.up).normalize();
      const k = burst * 0.9;
      for (let i = 0; i < this.shardSeeds.length; i++) {
        const s = this.shardSeeds[i]!;
        const p = this.tmpV.copy(stage.entry)
          .addScaledVector(n, s.v.x * k)
          .addScaledVector(side, s.v.z * k);
        p.y += s.v.y * k - 9 * k * k;
        this.tmpQ.setFromAxisAngle(this.tmpV2.set(s.spin.x, s.spin.y, s.spin.z).normalize(), (s.spin.x + s.spin.y) * k);
        const sc = s.size * (1 - smooth(burst, 0.7, 1));
        this.tmpM.compose(p, this.tmpQ, this.shardScale.setScalar(sc));
        this.shards.setMatrixAt(i, this.tmpM);
      }
      this.shards.instanceMatrix.needsUpdate = true;
    }

    if (!inside || !stage) {
      this.card.update(false, this.screenWorld, camera);
      this.envelope.visible = false;
      return;
    }

    // the envelope after the dart, into the screen
    envelopePose(u, stage, this.envPose);
    this.envelope.visible = this.envPose.scale > 0.002;
    if (this.envelope.visible) {
      this.envelope.position.copy(this.envPose.pos);
      this.envelope.quaternion.copy(this.envPose.quat);
      this.envelope.scale.setScalar(0.32 * this.envPose.scale);
    }

    // the screen: the waiting inbox brightens as the envelope reaches it, and reads delivered once it is in
    const arrive = smooth(u, 0.36, DETOUR.absorbed);
    const done = u >= DETOUR.received ? 1 : 0;
    const flash = done ? Math.exp(-(u - DETOUR.received) * 80) : 0;
    const want = done ? 'received' : 'idle';
    if (want !== this.showing) {
      this.showing = want;
      this.screenMaterial.map = this.screenMaterial.emissiveMap = this.screens[want];
    }
    this.screenMaterial.emissiveIntensity = IDLE_GLOW + arrive * 0.5 + done * 0.35 + flash * 2.2;
    this.screenLight.intensity = 0.6 + arrive * 1.6 + done * 1.0 + flash * 4;

    // the card, pinned to the screen
    this.screenWorld.copy(stage.screen).multiplyScalar(ROOM_K).add(stage.origin);
    this.card.update(showCard && u >= DETOUR.received + 0.01 && u < DETOUR.cardTo, this.screenWorld, camera);
  }

  // ---------------------------------------------------------------- warm-up

  /** the camera the backdrop is baked from, or null if it is already baked for this city */
  backdropCameraIfStale(): PerspectiveCamera | null {
    const stage = this.stage;
    if (!stage) return null;
    const key = `${stage.entry.x.toFixed(2)},${stage.entry.y.toFixed(2)},${stage.entry.z.toFixed(2)}:${this.city.group.children.length}`;
    if (key === this.bakedFor || this.city.group.children.length <= this.cityChildren0) return null;
    this.bakedFor = key;
    const cam = this.backdropCamera;
    cam.position.copy(stage.entry).addScaledVector(stage.normal, 0.8);
    cam.lookAt(this.tmpV.copy(cam.position).addScaledVector(stage.normal, 10).add(new Vector3(0, -1.2, 0)));
    cam.updateMatrixWorld();
    return cam;
  }

  /**
   * The view out of the office: the city as it stands at T_S, from just outside the tower's glass,
   * into a texture (the Engine has set the grade and visibility of T_S and hidden the dart).
   */
  bakeBackdrop(renderer: WebGLRenderer, scene: Scene, cam: PerspectiveCamera): void {
    const shown = [this.group.visible, this.flare.visible, this.shards.visible];
    this.group.visible = this.flare.visible = this.shards.visible = false;
    // (shadow maps update as usual: a city light whose map was never drawn must not be sampled empty)
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.backdropTarget);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    [this.group.visible, this.flare.visible, this.shards.visible] = shown as [boolean, boolean, boolean];
    const m = this.backdrop.material as MeshBasicMaterial;
    if (m.map !== this.backdropTarget.texture) {
      m.map = this.backdropTarget.texture;
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
    // from the back corner, looking at the window: nearly the whole room is in view
    cam.position.set(o.x + 6 * ROOM_K, o.y + 2.6 * ROOM_K, o.z + 9.6 * ROOM_K);
    cam.lookAt(o.x - 2 * ROOM_K, o.y + 0.8 * ROOM_K, o.z + 1 * ROOM_K);
    cam.updateMatrixWorld();
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
    // and from the window, looking in (the other side of every desk)
    cam.position.set(o.x - 1 * ROOM_K, o.y + 2 * ROOM_K, o.z + 0.4 * ROOM_K);
    cam.lookAt(o.x, o.y + 0.8 * ROOM_K, o.z + 6 * ROOM_K);
    cam.updateMatrixWorld();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
  }

  private warmCam: PerspectiveCamera | null = null;

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

