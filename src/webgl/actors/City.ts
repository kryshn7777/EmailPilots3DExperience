import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  type Camera,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  type Object3D,
  type Scene,
  type Texture,
  TextureLoader,
  Vector3,
  type WebGLRenderer,
} from 'three';
import {
  CITY_EXTENT,
  CROSS_STREET_X,
  cityRecipes,
  type Building,
} from '../bake/cityGen.mjs';
import { neonSignTexture, roadTexture } from '../bake/CanvasTextures';
import { glowTexture } from '../bake/CanvasTextures';
import { KitCity, type KitLot, type KitManifest, type KitRingSet } from './KitCity';
import { Streetlights, lampHead, lampHeadY, type Lamp } from './Streetlights';
import { StreetCars } from './StreetCars';
import { ReflectionProbe } from '../materials/ReflectionProbe';
import { CROSS_HALF, CityStreet, ROAD_HALF, canyonPhase, crossPhase, type Footprint } from './CityStreet';
import { Pedestrians } from './Pedestrians';
import { cityCrowd } from './PedestrianPlans';
import { CityLife } from './CityLife';
import { CAFE_SEAT, CafeTerrace } from './CafeTerrace';
import { pavingMaps } from '../bake/RoomTextures';
import { applyStreets, setLampField } from '../materials/Streets';
import { MAX_NEON, roadReflect } from '../materials/RoadReflect';
import { RoadDecals } from './RoadDecals';
import { dartGeometry } from './PaperPlane';
import { paperSheetTexture } from '../bake/CanvasTextures';
import { FLEET, type FleetKind } from '../../story/fleet';
import { asset } from '../asset';
import { mulberry32 } from '../util';
import type { FlightPath } from '../rig/FlightPath';
import type { Quality } from '../quality';

const WINDOW_AMBER = new Color('#ffc96b');
/** a delivered window: lit in the flight's teal and left lit, so the canyon keeps a tally in its walls */
const WINDOW_TEAL = new Color('#6ff2d8');
/** the Engine shows the city between these story-t (Engine.ts: city.group.visible); a delivery after it is not City's to draw */
export const CITY_SHOWN = [0.622, 0.856] as const;
/** how long an envelope and a window dart are in the air before they land, in story-t */
const ENVELOPE_FLIGHT = 0.022;
const DART_FLIGHT = 0.03;
const Y_AXIS = new Vector3(0, 1, 0);

/** a quadratic Bezier (a, b, c) at u, into out */
function bezier(a: Vector3, b: Vector3, c: Vector3, u: number, out: Vector3): Vector3 {
  const k = 1 - u;
  return out.copy(a).multiplyScalar(k * k).addScaledVector(b, 2 * k * u).addScaledVector(c, u * u);
}
/** where the phones' canyon cube is taken: over the stretch of road the flight comes down onto (city frame) */
const ROAD_ENV_X = -8;
const ROAD_ENV_Y = 1.5;
/** how close (world units) a street tree stands to the dive for the ~50k-triangle model, and for the ~15k one (HIGH) */
const CITY_TREE_ULTRA = 4.5;
const CITY_TREE_NEAR = 8;

/**
 * One of the campaign's city deliveries (src/story/fleet.ts): an envelope or a dart into a window, or
 * a window of the skyline flaring (the wave). City plans the windows (planFleet), flies and lights them.
 */
export interface CityMail {
  /** the FLEET row (1..42) */
  n: number;
  kind: FleetKind;
  from: number;
  land: number;
  /** the window (world) and which window instance */
  at: Vector3;
  windowIndex: number;
  /** the envelope's or the dart's flight, in the city group's frame (null for the wave) */
  p0: Vector3 | null;
  p1: Vector3 | null;
  /** its slot in the envelope or the dart InstancedMesh */
  slot: number;
  /** where it is this frame (world), for the HUD's chip */
  pos: Vector3;
  /** how lit its window was last written (to skip unchanged writes) */
  shown: number;
}

/**
 * CH8: the city of inboxes. Massing comes from the baked GLB (vertex-AO);
 * windows are instanced quads sharing the same deterministic layout. The
 * campaign's city rows (src/story/fleet.ts) are delivered here: envelopes and
 * darts into windows down the canyon and the skyline's wave under the climb,
 * each window lit teal on landing and left lit (planFleet / updateMail; one
 * draw for the envelopes, one for the darts), fully scrub-reversible.
 */
export class City {
  readonly group = new Group();
  private windows!: InstancedMesh;
  private windowBase: number[] = [];
  private windowMatrix: Matrix4[] = [];
  /** the campaign's city deliveries (planFleet), the envelopes' and the darts' one draw each */
  private mail: CityMail[] = [];
  private mailPlanned = false;
  private envelopes: InstancedMesh | null = null;
  private mailDarts: InstancedMesh | null = null;
  private mailPos = new Vector3();
  private mailAhead = new Vector3();
  private mailM4 = new Matrix4();
  private mailQ = new Quaternion();
  private mailS = new Vector3();
  private mailZero = new Matrix4().makeScale(0, 0, 0);
  private winP = new Vector3();
  private winQ = new Quaternion();
  private winS = new Vector3();
  private roofTops: Vector3[] = [];
  private path: FlightPath | null = null;
  private kitCity: KitCity | null = null;

  private color = new Color();
  private disposables: { dispose(): void }[] = [];

  constructor(anchor: Vector3, path: FlightPath, quality: Quality) {
    this.group.position.set(anchor.x, 0, 1);

    // what the wet street mirrors (materials/RoadReflect.ts): HIGH the Engine's live probe at the camera, phones
    // a cube of the canyon rendered once (captureRoadEnv), both read box-projected against the canyon's walls
    const shared = ReflectionProbe.current;
    if (!shared) {
      this.roadEnv = new ReflectionProbe(128, false);
      this.roadEnv.center.set(anchor.x + ROAD_ENV_X, ROAD_ENV_Y, 1);
      // filtered once while still black, so the road's programs are built with their env map from the start
      this.roadEnv.target.texture.needsPMREMUpdate = true;
    }
    const probe = (shared ?? this.roadEnv)!;
    this.roadEnvMap = probe.texture;
    roadReflect.probe.value = probe.center;
    roadReflect.box.value.set(1, 3.2, 14, 40);

    // ground sheet under the buildings
    // wet paving, not a black sheet: slabs, joints, stains, normal and roughness (HIGH)
    const paving = pavingMaps(4107);
    for (const t of [paving.map, paving.normalMap, paving.roughnessMap]) {
      t.wrapS = t.wrapT = RepeatWrapping;
      t.repeat.set(195, 150);
    }
    this.disposables.push(paving.map, paving.normalMap, paving.roughnessMap);
    const groundMaterial = new MeshStandardMaterial({
      map: paving.map,
      ...(quality.tier === 'high'
        ? { normalMap: paving.normalMap, roughnessMap: paving.roughnessMap, roughness: 1 }
        : { roughness: 0.6 }),
      color: '#8c8c94',
      metalness: 0.05,
    });
    // stains, gum, hairline cracks, shallow puddles; HIGH adds photographed concrete grain
    const high = quality.tier === 'high';
    const detail = (file: string): Texture => {
      const t = new TextureLoader().load(asset(`/models/homes/${file}`));
      t.colorSpace = NoColorSpace;
      t.wrapS = t.wrapT = RepeatWrapping;
      t.anisotropy = 8;
      this.disposables.push(t);
      return t;
    };
    const streetMaps = high ? { asphalt: detail('detail-asphalt.webp'), concrete: detail('detail-concrete.webp') } : {};
    const origin = this.group.position;
    groundMaterial.envMap = this.roadEnvMap;
    applyStreets(groundMaterial, { kind: 'paving', origin, fine: high, lamps: high ? 3 : 8, reflect: true, ...streetMaps });
    // 260x200, not 140x100: the district is 97 x 39 now and the old sheet's
    // edge cut across the frame in the upper corners of the dive
    const ground = new Mesh(new PlaneGeometry(260, 200), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    this.group.add(ground);
    this.disposables.push(ground.geometry, groundMaterial);

    this.buildTraffic(quality);
    this.buildCars(quality);
    void this.init(path, quality);
  }

  /**
   * Buildings are kit-instanced with ring-baked LODs (see KitCity). Dressing
   * follows the rings: windows spawn on NEAR+MID lots, billboards on NEAR
   * only. Rooftop plant is baked into the modules themselves.
   */
  private async init(path: FlightPath, quality: Quality): Promise<void> {
    // no-cache: lots and rings MUST come from the same bake — a stale cached
    // rings file indexes past the end of a freshly generated lot list
    const [manifest, allRings] = await Promise.all([
      fetch(asset('/models/city-kit/manifest.json'), { cache: 'no-cache' }).then(
        (r) => r.json() as Promise<KitManifest>,
      ),
      fetch(asset('/models/city-rings.json'), { cache: 'no-cache' }).then((r) => r.json()),
    ]);
    const rings = allRings.city[quality.tier] as KitRingSet;
    const { lots } = cityRecipes(manifest.modules);
    // the towers and blocks weather: upkeep, grime, rain streaks (HIGH adds photographed concrete grain)
    const wall = quality.tier === 'high' ? new TextureLoader().load(asset('/models/homes/detail-concrete.webp')) : undefined;
    if (wall) {
      wall.colorSpace = NoColorSpace;
      wall.wrapS = wall.wrapT = RepeatWrapping;
      wall.anisotropy = 8;
      this.disposables.push(wall);
    }
    this.kitCity = new KitCity(lots as KitLot[], rings, manifest, { tier: quality.tier, glow: 0.9, facades: wall ? { wall } : {} });
    this.group.add(this.kitCity.group);

    // effective wall half-extents per lot: kit modules are uniform-fit
    // INSIDE the lot box, so dressing placed on the old box faces would
    // hover in air beside the real walls (yaw 90/270 swaps the axes)
    const extents = new Map<number, { hx: number; hz: number }>();
    (lots as KitLot[]).forEach((lot, i) => {
      const mod = manifest.modules.find((m) => m.id === lot.moduleId);
      if (!mod) return;
      const sxz = Math.min(lot.w / mod.footprint[0], lot.d / mod.footprint[1]);
      const hx = (sxz * mod.footprint[0]) / 2;
      const hz = (sxz * mod.footprint[1]) / 2;
      const quarter = Math.round(lot.yaw / (Math.PI / 2)) % 2 !== 0;
      extents.set(i, quarter ? { hx: hz, hz: hx } : { hx, hz });
    });

    // dressing is placed from the LOTS, not from cityLayout: cityRecipes drops a
    // lot that would intrude on the canyon, which slid every later pairing by one
    // building, and the layout's heights are not the modules' heights anyway
    const buildings: Building[] = (lots as KitLot[]).map((l) => ({
      x: l.x, z: l.z, w: l.w, d: l.d, h: l.h,
    }));
    const nearSet = new Set(rings.near);
    const nearMid = new Set([...rings.near, ...rings.mid]);
    const keep = (set: Set<number>): [Building, { hx: number; hz: number }][] =>
      buildings
        .map((b, i) => [b, extents.get(i), set.has(i)] as const)
        .filter((row): row is [Building, { hx: number; hz: number }, true] => !!row[1] && row[2])
        .map(([b, e]) => [b, e]);
    this.buildWindows(keep(nearMid));
    const footprints: Footprint[] = [];
    extents.forEach((e, i) => {
      const lot = (lots as KitLot[])[i]!;
      footprints.push({ x: lot.x, z: lot.z, hx: e.hx, hz: e.hz, h: lot.h });
    });
    // the restaurant terrace takes the plaza on the left of the street (north, -z) that the flight has
    // ahead of it as it comes down into the canyon (x -3..6): on a wide screen it fills the left of the
    // frame from the descent until the camera draws level (x 8..14, tried too, sits behind the title)
    this.street = new CityStreet(footprints, quality, {
      realProps: true, cafe: { x: 1.5, side: -1 }, paint: { origin: this.group.position, envMap: this.roadEnvMap },
    });
    this.group.add(this.street.group);
    if (this.street.terrace) {
      this.terrace = new CafeTerrace(this.street.terrace, quality, this.group.position);
      this.street.occupied.push(...this.terrace.occupied);
      this.group.add(this.terrace.group);
      this.disposables.push(this.terrace);
    }
    void this.buildTrees(this.street.trees, path, quality);
    // the street lived in: clutter, deliveries, roadworks, bikes, roof plant (and the people about them)
    this.life = new CityLife({
      footprints, lots: lots as KitLot[], roofLots: rings.near,
      plazas: this.street.plazas, occupied: this.street.occupied, hydrants: this.street.hydrants,
      bins: this.street.bins, shelters: this.street.shelters, parked: this.parked, lamps: this.lampSpots(), quality,
    });
    this.group.add(this.life.group);
    this.disposables.push(this.life);
    // the street's markings, repairs, stains, covers, grates and litter (RoadDecals)
    {
      const [ex0, ex1] = CITY_EXTENT.x;
      this.decals = new RoadDecals({
        origin: this.group.position, quality, crossX: CROSS_STREET_X, x0: ex0 - 6, x1: ex1 + 6,
        parked: this.parked, occupied: this.street.occupied, plazas: this.street.plazas, vents: this.street.vents,
      }, this.roadEnvMap);
      this.group.add(this.decals.group);
      this.disposables.push(this.decals);
    }
    // the canyon's facade line, for the reflections' box: the nearest kit walls either side of the road
    {
      const faces = footprints.filter((f) => Math.abs(f.z) < 8).map((f) => Math.abs(f.z) - f.hz).filter((d) => d > 2.3);
      faces.sort((a, b) => a - b);
      if (faces.length) roadReflect.box.value.y = faces[Math.floor(faces.length * 0.3)]!;
    }
    this.buildPeople(this.street.plazas, quality, this.life.stands, this.terrace);
    this.buildRoofDetail(buildings.filter((_, i) => nearSet.has(i)));
    this.buildStreetDressing(keep(nearSet), quality);
    this.buildMail();
    this.roofTops = buildings
      .filter((b) => b.h > 4)
      .map((b) => new Vector3(b.x, b.h, b.z).add(this.group.position));
    this.path = path;
  }

  private blinkMaterial!: PointsMaterial;

  /**
   * Street level + skyline dressing: lamp posts lining the canyon with warm
   * glow sprites, neon signs on the canyon-facing walls, and antennas with
   * red aircraft-warning blinkers on the tallest towers. Five draws total.
   */
  private buildStreetDressing(rows: [Building, { hx: number; hz: number }][], quality: Quality): void {
    const rand = mulberry32(880);

    // streetlights down both canyon curbs: the same lamp as the town's (pole, raked arm,
    // luminaire, halo, light cone), a little smaller, with a pool of light on the road below
    const poleMaterial = new MeshStandardMaterial({ color: '#232936', roughness: 0.5, metalness: 0.5 });
    const q = new Quaternion();
    const s = new Vector3(1, 1, 1);
    const p = new Vector3();
    const lampList: Lamp[] = [];
    for (let x = -30; x <= 34; x += 6.4) {
      for (const z of [-2.05, 2.05]) {
        lampList.push({ x: x + rand() * 0.6, z, yaw: z < 0 ? 0 : Math.PI });
      }
    }
    this.streetlights = new Streetlights(lampList, quality.tier, 0.85, true);
    this.group.add(this.streetlights.group);
    // the pools of light on the road are the road's own (materials/Streets.ts): each lamp a downlight with
    // inverse-square falloff and a glossy streak on the wet asphalt, not a painted disc
    setLampField(lampList.map((l) => lampHead(l, 0.85)), -30, 6.4, lampHeadY(0.85));
    this.disposables.push(this.streetlights, poleMaterial);

    // neon signs on walls facing the canyon — on the ACTUAL kit walls
    const NEON = ['#ff5f8f', '#5fd0ff', '#ffd05f', '#8fff9f', '#c88fff'];
    const sign = neonSignTexture();
    const signMaterial = new MeshBasicMaterial({
      map: sign,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const signGeometry = new PlaneGeometry(1.5, 0.75);
    const candidates = rows.filter(([b]) => Math.abs(b.z) < 5 && b.h > 3);
    const signs = new InstancedMesh(signGeometry, signMaterial, Math.min(10, candidates.length));
    const yaw = new Quaternion();
    const Y = new Vector3(0, 1, 0);
    for (let i = 0; i < signs.count; i++) {
      const [b, e] = candidates[Math.floor(rand() * candidates.length)]!;
      const north = b.z < 0;
      p.set(
        b.x + (rand() - 0.5) * e.hx * 0.5,
        1.6 + rand() * Math.min(b.h - 2, 3.5),
        b.z + (e.hz + 0.06) * (north ? 1 : -1),
      );
      yaw.setFromAxisAngle(Y, north ? 0 : Math.PI);
      signs.setMatrixAt(i, new Matrix4().compose(p, yaw, s));
      signs.setColorAt(i, this.color.set(NEON[i % NEON.length]!));
      // the wet road mirrors each sign (RoadReflect): its centre, half size and colour
      if (i < MAX_NEON) {
        roadReflect.neonA.value[i]!.set(p.x, p.y, p.z, 0.62);
        roadReflect.neonB.value[i]!.set(this.color.r * 1.4, this.color.g * 1.4, this.color.b * 1.4, 0.26);
      }
    }
    if (signs.instanceColor) signs.instanceColor.needsUpdate = true;
    this.group.add(signs);
    this.disposables.push(signGeometry, signMaterial, sign, signs);

    // antennas + red blinkers on the tallest towers
    const tall = rows.map(([b]) => b).sort((a, b) => b.h - a.h).slice(0, 9);
    const antennaGeometry = new CylinderGeometry(0.015, 0.025, 1.6, 5);
    const antennas = new InstancedMesh(antennaGeometry, poleMaterial, tall.length);
    const blinkPos: number[] = [];
    tall.forEach((b, i) => {
      p.set(b.x, b.h + 0.8, b.z);
      antennas.setMatrixAt(i, new Matrix4().compose(p, q, s));
      blinkPos.push(b.x, b.h + 1.62, b.z);
    });
    this.group.add(antennas);
    this.disposables.push(antennaGeometry, antennas);

    const blinkGeometry = new BufferGeometry();
    blinkGeometry.setAttribute('position', new Float32BufferAttribute(blinkPos, 3));
    this.blinkMaterial = new PointsMaterial({
      map: glowTexture(),
      color: '#ff3b30',
      size: 0.45,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const blinkers = new Points(blinkGeometry, this.blinkMaterial);
    blinkers.frustumCulled = false;
    this.group.add(blinkers);
    this.disposables.push(blinkGeometry, this.blinkMaterial);
  }

  /**
   * Big lit billboards on the tallest towers — kit modules carry their own
   * cornices, so the old parapet lips are gone. One instanced draw.
   */
  private buildRoofDetail(buildings: Building[]): void {
    const rand = mulberry32(3117);

    // rooftop billboards, glowing over the skyline
    const NEON = ['#ff5f8f', '#5fd0ff', '#ffd05f', '#8fff9f'];
    const sign = neonSignTexture();
    const boardMaterial = new MeshBasicMaterial({
      map: sign,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const boardGeometry = new PlaneGeometry(2.6, 1.3);
    const tall = [...buildings].sort((a, b) => b.h - a.h).slice(2, 8);
    const boards = new InstancedMesh(boardGeometry, boardMaterial, tall.length);
    const Y = new Vector3(0, 1, 0);
    const yaw = new Quaternion();
    const p = new Vector3();
    const s = new Vector3(1, 1, 1);
    tall.forEach((b, i) => {
      p.set(b.x, b.h + 1.0, b.z);
      yaw.setFromAxisAngle(Y, (rand() - 0.5) * 0.9 + (b.z > 0 ? Math.PI : 0));
      boards.setMatrixAt(i, new Matrix4().compose(p, yaw, s));
      boards.setColorAt(i, this.color.set(NEON[i % NEON.length]!));
    });
    if (boards.instanceColor) boards.instanceColor.needsUpdate = true;
    this.group.add(boards);
    this.disposables.push(boardGeometry, boardMaterial, sign, boards);
  }

  /** where the cross streets end, in z (the cross-street traffic runs between them) */
  private crossEnds: [number, number] = [-33, 33];
  private crossCars: StreetCars | null = null;
  private streetCars: StreetCars | null = null;
  private people: Pedestrians | null = null;
  private street: CityStreet | null = null;
  /** CityLife's props: read by the probe (`__engine.city.life.stats`) */
  life: CityLife | null = null;
  /** the parked cars (buildCars), so the street's props keep out of them */
  private parked: { x: number; z: number; yaw: number }[] = [];
  private streetlights: Streetlights | null = null;
  /** Trattoria Luna's terrace (CafeTerrace): its diners are in the crowd, its delivery in BatchFleet */
  terrace: CafeTerrace | null = null;
  /** the road's decals (RoadDecals): read by the probe (`__engine.city.decals.count`) */
  decals: RoadDecals | null = null;
  /** phones: the canyon's cube, rendered once for the wet road to mirror (null on HIGH: the live probe) */
  private roadEnv: ReflectionProbe | null = null;
  private roadEnvMap: Texture | null = null;
  private roadEnvKit = 0;
  private roadEnvEye = new Vector3();

  /**
   * Phones: renders the canyon's cube for the road's reflections, two faces a frame, once the city is built
   * (and once more if more of the kit has streamed in since). The moving things (cars, people, the plane) are
   * left out of it, since they would hang frozen in the puddles.
   */
  captureRoadEnv(renderer: WebGLRenderer, scene: Scene, hide: Object3D[]): void {
    const env = this.roadEnv;
    if (!env || !this.kitCity || !this.life || !this.decals) return;
    const kit = this.kitCity.group.children.length;
    if (kit === 0 || (env.cubes > 0 && (env.cubes > 1 || kit <= this.roadEnvKit * 1.1))) return;
    const moving = [...hide, ...[this.streetCars, this.crossCars, this.people].flatMap((a) => (a ? [a.group] : []))];
    this.roadEnvEye.copy(env.center);
    // taken without the fog: the street's own fog lies over the road anyway, and a fogged cube mirrored
    // as a grey sheen over the whole road instead of the lit towers
    // (thinned to nothing rather than removed, so no program is rebuilt for it)
    const fog = scene.fog as { near?: number; far?: number; density?: number } | null;
    const was = fog ? [fog.near, fog.far, fog.density] : [];
    if (fog) {
      if (fog.density !== undefined) fog.density = 0;
      else { fog.near = 1e5; fog.far = 2e5; }
    }
    for (let i = 0; i < 2; i++) env.update(renderer, scene, this.roadEnvEye, 0, moving, ROAD_ENV_Y);
    if (fog && fog.density !== undefined) fog.density = was[2];
    else if (fog) [fog.near, fog.far] = was;
    if (env.cubes > 0) this.roadEnvKit = kit;
  }


  /** Roads in the canyon + cross streets, real cars on the canyon lanes. */
  private buildTraffic(quality: Quality): void {
    const road = roadTexture();
    // wet asphalt: the lamps and the neon streak in it
    const roadMat = new MeshStandardMaterial({ map: road, roughness: 0.42, metalness: 0.1 });
    // the junction boxes: plain asphalt with no lane markings, laid over the canyon's strip (and a hair
    // nearer the camera in depth, so the two never z-fight)
    const junctionMat = roadMat.clone();
    junctionMat.polygonOffset = true;
    junctionMat.polygonOffsetFactor = -2;
    junctionMat.polygonOffsetUnits = -2;
    // cracked, patched, oil-stained, with puddles in the ruts (HIGH adds the parallax cracks and photo grain)
    const high = quality.tier === 'high';
    const loadDetail = (file: string): Texture => {
      const t = new TextureLoader().load(asset(`/models/homes/${file}`));
      t.colorSpace = NoColorSpace;
      t.wrapS = t.wrapT = RepeatWrapping;
      t.anisotropy = 8;
      this.disposables.push(t);
      return t;
    };
    const asphalt = high ? loadDetail('detail-asphalt.webp') : undefined;
    for (const m of [roadMat, junctionMat]) {
      m.envMap = this.roadEnvMap;
      applyStreets(m, { kind: 'road', origin: this.group.position, fine: high, lamps: high ? 3 : 9, reflect: true, ...(asphalt ? { asphalt } : {}) });
    }
    this.disposables.push(roadMat, road, junctionMat);
    // roads span the built grid rather than a hardcoded 66x27: the district is
    // 24x11 blocks now, and the old canyon road stopped dead a third of the way
    // along it with buildings either side of open ground
    const [x0, x1] = CITY_EXTENT.x;
    const [z0, z1] = CITY_EXTENT.z;
    const runX = x1 - x0 + 12; // a little past the last block at each end
    const runZ = z1 - z0 + 10;
    const canyonRoad = new Mesh(new PlaneGeometry(runX, 4.6), roadMat);
    canyonRoad.rotation.x = -Math.PI / 2;
    canyonRoad.position.set((x0 + x1) / 2, 0.006, 0);
    // one dash tile per ~7.3 units, so the markings keep their spacing as the road grows instead of stretching
    const dashTiles = Math.round(runX / 7.3);
    if (canyonRoad.material.map) canyonRoad.material.map.repeat.set(dashTiles, 1);
    this.group.add(canyonRoad);
    this.disposables.push(canyonRoad.geometry);
    // each cross street starts at the canyon's kerb and runs out to its end (it used to run clean through
    // the canyon, under its surface), its dashes spaced like the canyon's
    const zMid = (z0 + z1) / 2;
    const crossEnds = [zMid - runZ / 2, zMid + runZ / 2] as const;
    const halves: [number, number][] = [[ROAD_HALF, crossEnds[1]], [crossEnds[0], -ROAD_HALF]];
    for (const sx of CROSS_STREET_X) {
      for (const [za, zb] of halves) {
        const len = zb - za;
        const half = new PlaneGeometry(len, 2 * CROSS_HALF);
        const uv = half.attributes.uv!;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / runX));
        const cross = new Mesh(half, roadMat);
        cross.rotation.x = -Math.PI / 2;
        cross.rotation.z = Math.PI / 2;
        cross.position.set(sx, 0.003, (za + zb) / 2);
        this.group.add(cross);
        this.disposables.push(half);
      }
      const boxGeometry = new PlaneGeometry(2 * CROSS_HALF, 2 * ROAD_HALF);
      // the same asphalt, sampled from a stretch of the texture with no dashes or edge lines in it
      const boxUv = boxGeometry.attributes.uv!;
      for (let i = 0; i < boxUv.count; i++) boxUv.setXY(i, (0.3 + boxUv.getX(i) * 0.3) / dashTiles, 0.1 + boxUv.getY(i) * 0.3);
      const box = new Mesh(boxGeometry, junctionMat);
      box.rotation.x = -Math.PI / 2;
      box.position.set(sx, 0.0075, 0);
      this.group.add(box);
      this.disposables.push(boxGeometry);
    }
    this.crossEnds = [crossEnds[0], crossEnds[1]];
  }

  /**
   * The canyon's traffic: the same cars as the neighbourhood (StreetCars: six body types with
   * interiors, lamps, spinning wheels, braking and car-following), drawn 1.35x larger so they
   * read against the block faces, one lane each way down the canyon road.
   */
  private buildCars(quality: Quality): void {
    // the whole length of the road, so the camera is never over an empty street
    const [ex0, ex1] = CITY_EXTENT.x;
    const x0 = ex0 - 6;
    const x1 = ex1 + 6;
    const high = quality.tier === 'high';
    const n = Math.round((x1 - x0) * (high ? 0.11 : 0.06));
    // parked along both curbs, clear of the cross streets (nose with the lane's own traffic)
    const parked: { x: number; z: number; yaw: number }[] = [];
    const rand = mulberry32(9031);
    for (let x = x0 + 2; x < x1 - 2; x += 3.6 + rand() * 2.2) {
      if (CROSS_STREET_X.some((sx) => Math.abs(x - sx) < 3.2)) continue;
      if (rand() < 0.4) continue;
      const side = rand() < 0.5 ? -1 : 1;
      parked.push({ x, z: side * 1.97, yaw: side < 0 ? Math.PI : 0 });
    }
    this.parked = parked;
    // stop lines before every cross street (CityStreet paints them 2.35 out from its centre; a car's nose stops 2.4 out)
    const STOP = CROSS_HALF + 1.1;
    const stopsPlus = CROSS_STREET_X.map((sx) => sx - STOP - x0);
    const stopsMinus = CROSS_STREET_X.map((sx) => x1 - (sx + STOP));
    this.streetCars = new StreetCars(quality, parked, {
      scale: 1.35,
      lanes: [
        // z -1.1 drives -x (oncoming, headlights at the camera); z +1.1 drives +x with the flight
        { z: -1.1, dir: -1, x0, x1, count: n, stops: stopsMinus, phase: canyonPhase },
        { z: 1.1, dir: 1, x0, x1, count: n, stops: stopsPlus, phase: canyonPhase },
      ],
    });
    // paint, chrome and windscreens mirror the canyon itself (the live probe, HIGH)
    if (ReflectionProbe.current) this.streetCars.setEnvMap(ReflectionProbe.current.texture);
    this.group.add(this.streetCars.group);
    this.disposables.push(this.streetCars);

    // the cross streets: one more set of cars, its frame turned a quarter so its lanes (which run along x)
    // run along the cross streets instead (local x = world -z, local z = world x). Every cross street has
    // a lane each way, and a car on one waits at the line before the canyon, on the cross street's own light.
    const [za, zb] = this.crossEnds;
    const lx0 = -zb;
    const lx1 = -za;
    const stopLine = ROAD_HALF + 0.55;
    const crossLanes: NonNullable<ConstructorParameters<typeof StreetCars>[2]>['lanes'] = [];
    for (const sx of CROSS_STREET_X) {
      crossLanes.push(
        // x = sx + 0.6 heads -z (local +x), from the +z side: its line is at z = +stopLine
        { z: sx + 0.6, dir: 1, x0: lx0, x1: lx1, count: high ? 4 : 2, stops: [zb - stopLine], phase: crossPhase },
        // x = sx - 0.6 heads +z (local -x), from the -z side: its line is at z = -stopLine
        { z: sx - 0.6, dir: -1, x0: lx0, x1: lx1, count: high ? 4 : 2, stops: [-za - stopLine], phase: crossPhase },
      );
    }
    this.crossCars = new StreetCars(quality, [], { scale: 1.35, lanes: crossLanes });
    this.crossCars.group.rotation.y = Math.PI / 2;
    if (ReflectionProbe.current) this.crossCars.setEnvMap(ReflectionProbe.current.texture);
    this.group.add(this.crossCars.group);
    this.disposables.push(this.crossCars);
  }

  private buildWindows(rows: [Building, { hx: number; hz: number }][]): void {
    const rand = mulberry32(77);
    const slots: { pos: Vector3; quat: Quaternion; lit: number }[] = [];
    const Y = new Vector3(0, 1, 0);
    const faceCanyonPos = new Quaternion(); // +Z
    const faceCanyonNeg = new Quaternion().setFromAxisAngle(Y, Math.PI); // -Z
    const faceBackX = new Quaternion().setFromAxisAngle(Y, -Math.PI / 2); // -X, toward the approaching camera

    for (const [b, e] of rows) {
      const floors = Math.max(1, Math.floor(b.h / 1.1) - 1);
      for (let f = 0; f < floors; f++) {
        const y = 0.8 + f * 1.1;
        // dense + bright: sparse dim windows lost to the massing at the city
        // entry and whole blocks read as gray boxes
        // The baked facade atlas already carries the lit windows; these quads are the ones
        // the delivery envelopes and landing darts light up, so they start dark (additive, so
        // dark means invisible, not a black square over the atlas). Same random stream as
        // before so no slot moves.
        const litRoll = (): number => {
          if (rand() < 0.72) rand();
          return 0;
        };
        // kit towers step back near their tops — no quads above 70% height,
        // that's where they hovered in air off the old box faces
        if (y > b.h * 0.7) continue;
        // canyon-facing wall (seen while banking through the dive) — placed
        // on the ACTUAL kit wall (effective extents), not the old lot box
        if (rand() >= 0.2) {
          const facingCanyon = b.z > 0 ? -1 : 1; // canyon sits at z≈0 local
          slots.push({
            pos: new Vector3(
              b.x - e.hx / 2 + rand() * e.hx,
              y,
              b.z + (e.hz + 0.03) * facingCanyon,
            ),
            quat: facingCanyon === -1 ? faceCanyonNeg : faceCanyonPos,
            lit: litRoll(),
          });
        }
        // -X wall: faces the camera flying up the canyon — without these the
        // whole city reads black (canyon windows are edge-on to the flight)
        if (rand() >= 0.18) {
          slots.push({
            pos: new Vector3(
              b.x - e.hx - 0.03,
              y,
              b.z - e.hz / 2 + rand() * e.hz,
            ),
            quat: faceBackX,
            lit: litRoll(),
          });
        }
      }
    }

    const geometry = new PlaneGeometry(0.34, 0.46);
    const material = new MeshBasicMaterial({
      color: '#ffffff', transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.windows = new InstancedMesh(geometry, material, slots.length);
    const m = new Matrix4();
    const s = new Vector3(1, 1, 1);
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      m.compose(slot.pos, slot.quat, s);
      this.windows.setMatrixAt(i, m);
      this.windowMatrix.push(m.clone());
      this.windows.setColorAt(i, this.color.copy(WINDOW_AMBER).multiplyScalar(slot.lit));
      this.windowBase.push(slot.lit);
    }
    this.windows.instanceMatrix.needsUpdate = true;
    if (this.windows.instanceColor) this.windows.instanceColor.needsUpdate = true;
    this.group.add(this.windows);
    this.disposables.push(geometry, material, this.windows);
  }

  /** the envelopes' and the window darts' instanced draws (the campaign's rows, see planFleet) */
  private buildMail(): void {
    const rows = FLEET.filter((r) => r.kind === 'envelope' || r.kind === 'window');
    const envCount = rows.filter((r) => r.kind === 'envelope').length;
    const dartCount = rows.length - envCount;
    const envGeometry = new BoxGeometry(0.5, 0.05, 0.35);
    const envMaterial = new MeshStandardMaterial({ color: '#ddd6c8', emissive: '#ffd9a0', emissiveIntensity: 0.6, roughness: 0.7 });
    this.envelopes = new InstancedMesh(envGeometry, envMaterial, Math.max(envCount, 1));
    const paper = paperSheetTexture();
    const dartMaterial = new MeshStandardMaterial({
      map: paper, color: '#ddd8ce', roughness: 0.85, side: DoubleSide, emissive: '#8f97a8', emissiveIntensity: 0.55,
    });
    const dartGeo = dartGeometry();
    this.mailDarts = new InstancedMesh(dartGeo, dartMaterial, Math.max(dartCount, 1));
    for (const im of [this.envelopes, this.mailDarts]) {
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, this.mailZero);
      im.frustumCulled = false;
      im.visible = false;
      im.castShadow = false;
      this.group.add(im);
    }
    this.disposables.push(envGeometry, envMaterial, paper, dartMaterial, dartGeo, this.envelopes, this.mailDarts);
  }

  /** the window instances are in: the fleet may plan its city deliveries */
  get windowsReady(): boolean {
    return !!this.windows && this.windowBase.length > 0 && !!this.path;
  }

  /** the roof tops of the city's lots (world), where the skyline's light columns stand */
  get roofs(): readonly Vector3[] {
    return this.roofTops;
  }

  /** the campaign's city deliveries as planned (empty until planFleet) */
  get fleetMail(): readonly CityMail[] {
    return this.mail;
  }

  /**
   * Picks a window for each of the campaign's city rows: one the camera `frame(t)` has in view as it
   * lands (and a moment before), off the middle of the frame where the chapter's title stands, near
   * enough to read for the envelopes and darts (the wave may be far: it is the skyline). `rand` is the
   * fleet's seeded stream. Returns the rows City cannot show (after the Engine hides the city, or a
   * wave window nowhere in frame): BatchFleet raises a far column for those instead.
   */
  planFleet(rows: readonly { n: number; kind: FleetKind; land: number }[], frame: (t: number) => Camera, rand: () => number): number[] {
    if (this.mailPlanned || !this.windowsReady) return [];
    this.mailPlanned = true;
    const origin = this.group.position;
    const slots: Vector3[] = this.windowMatrix.map((m) => new Vector3().setFromMatrixPosition(m));
    const ndc = new Vector3();
    const world = new Vector3();
    const off = (cam: Camera, local: Vector3): number => {
      ndc.copy(local).add(origin).project(cam);
      return ndc.z > 1 ? Infinity : Math.max(Math.abs(ndc.x), Math.abs(ndc.y));
    };
    const used = new Set<number>();
    const left: number[] = [];
    let env = 0;
    let dart = 0;
    for (const r of rows) {
      if (r.kind !== 'envelope' && r.kind !== 'window' && r.kind !== 'wave') continue;
      // (a flare in the last moment before the city is switched off would be gone before it was seen)
      if (r.land < CITY_SHOWN[0] || r.land >= CITY_SHOWN[1] - 0.004) {
        left.push(r.n);
        continue;
      }
      const near = r.kind !== 'wave';
      const camA = frame(r.land);
      const camPos = camA.position.clone();
      const offA = slots.map((p) => off(camA, p));
      const camB = frame(r.land - 0.006);
      const options: { index: number; view: number }[] = [];
      slots.forEach((p, index) => {
        if (used.has(index)) return;
        if (near && (Math.abs(p.z) > 7 || p.y < 1.5)) return;
        const view = Math.max(offA[index]!, off(camB, p));
        if (!Number.isFinite(view)) return;
        const dist = world.copy(p).add(origin).distanceTo(camPos);
        if (near && dist > 48) return;
        if (!near && (dist < 14 || dist > 150)) return;
        options.push({ index, view });
      });
      // in frame, clear of the title in the middle; failing that the few nearest the middle
      let pool = options.filter((o) => o.view < 0.8 && o.view > 0.22);
      if (!pool.length) pool = options.filter((o) => o.view < 0.85);
      if (!pool.length && r.kind !== 'wave') pool = [...options].sort((a, b) => a.view - b.view).slice(0, 3);
      const pick = pool[Math.floor(rand() * pool.length)];
      if (!pick) {
        left.push(r.n);
        continue;
      }
      // two deliveries never light the same pane or the one beside it
      const chosen = slots[pick.index]!;
      slots.forEach((p, i) => { if (p.distanceToSquared(chosen) < 0.8) used.add(i); });
      const to = chosen.clone();
      const at = to.clone().add(origin);
      let p0: Vector3 | null = null;
      let p1: Vector3 | null = null;
      let slot = -1;
      const flight = r.kind === 'envelope' ? ENVELOPE_FLIGHT : DART_FLIGHT;
      if (r.kind === 'envelope') {
        // from the flight line where it leaves, in an arc up and over into the window
        p0 = this.path!.storyPoint(r.land - flight).clone().sub(origin);
        p1 = p0.clone().lerp(to, 0.5);
        p1.y = Math.max(p0.y, to.y) + 2.2;
        slot = env++;
      } else if (r.kind === 'window') {
        // a dart out of the night over the canyon, a little ahead of the flight, diving into the window
        p0 = this.path!.storyPoint(Math.min(r.land - flight + 0.012, 0.86)).clone().sub(origin);
        p0.y += 5 + rand() * 3;
        p0.z += (rand() < 0.5 ? -1 : 1) * (3 + rand() * 3);
        p1 = p0.clone().lerp(to, 0.45);
        p1.y = Math.max(p0.y, to.y) + 2;
        slot = dart++;
      }
      this.mail.push({
        n: r.n, kind: r.kind, from: r.land - (r.kind === 'wave' ? 0 : flight), land: r.land,
        at, windowIndex: pick.index, p0, p1, slot, pos: at.clone(), shown: -1,
      });
    }
    return left;
  }

  /** the campaign's city mail at story-t `t`: the envelopes and darts in the air, the windows they light */
  private updateMail(t: number): void {
    let envOn = false;
    let dartOn = false;
    let dirty = false;
    for (const m of this.mail) {
      if (m.p0 && m.p1) {
        const x = MathUtils.clamp((t - m.from) / Math.max(m.land - m.from, 1e-6), 0, 1);
        const im = m.kind === 'envelope' ? this.envelopes! : this.mailDarts!;
        if (t > m.from && t < m.land) {
          const e = x * x * (3 - 2 * x);
          const to = this.winP.setFromMatrixPosition(this.windowMatrix[m.windowIndex]!);
          bezier(m.p0, m.p1, to, e, this.mailPos);
          bezier(m.p0, m.p1, to, Math.min(e + 0.04, 1), this.mailAhead);
          m.pos.copy(this.mailPos).add(this.group.position);
          if (m.kind === 'envelope') {
            this.mailQ.setFromAxisAngle(Y_AXIS, e * 2.2);
            this.mailS.setScalar(1);
            envOn = true;
          } else {
            // nose along the dive (+z forward: the target first, as Object3D.lookAt does for a mesh)
            this.mailM4.lookAt(this.mailAhead, this.mailPos, Y_AXIS);
            this.mailQ.setFromRotationMatrix(this.mailM4);
            // shrink into the window over the last stretch: it lands inside
            this.mailS.setScalar(Math.max(0.55 * (1 - MathUtils.smoothstep(x, 0.82, 1)), 1e-4));
            dartOn = true;
          }
          im.setMatrixAt(m.slot, this.mailM4.compose(this.mailPos, this.mailQ, this.mailS));
        } else {
          im.setMatrixAt(m.slot, this.mailZero);
          m.pos.copy(m.at);
        }
      }
      // its window: dark until it lands, then a teal flare that settles and stays lit (pure in t)
      const since = t - m.land;
      const wave = m.kind === 'wave';
      const level = since < 0 ? 0 : 2.4 + (wave ? 5 : 3.2) * Math.exp(-since / 0.004);
      const q = Math.round(level * 50);
      if (q !== m.shown) {
        m.shown = q;
        const base = this.windowBase[m.windowIndex]!;
        if (since < 0) this.windows.setColorAt(m.windowIndex, this.color.copy(WINDOW_AMBER).multiplyScalar(base));
        else this.windows.setColorAt(m.windowIndex, this.color.copy(WINDOW_TEAL).multiplyScalar(level));
        // the pane swells with the flare (the skyline's far ones a lot, so the wave reads from the climb) and
        // stays a little larger: a delivered window reads as a lit bay down the canyon, not a pinprick
        const grow = since < 0 ? 1 : 1.5 + (wave ? 2.4 : 1) * Math.exp(-since / 0.005);
        this.windowMatrix[m.windowIndex]!.decompose(this.winP, this.winQ, this.winS);
        this.windows.setMatrixAt(m.windowIndex, this.mailM4.compose(this.winP, this.winQ, this.winS.setScalar(grow)));
        dirty = true;
      }
    }
    this.envelopes!.instanceMatrix.needsUpdate = true;
    this.mailDarts!.instanceMatrix.needsUpdate = true;
    this.envelopes!.visible = envOn;
    this.mailDarts!.visible = dartOn;
    if (dirty) {
      this.windows.instanceMatrix.needsUpdate = true;
      if (this.windows.instanceColor) this.windows.instanceColor.needsUpdate = true;
    }
  }

  private trees: KitCity | null = null;

  /**
   * The street trees are the homes set's own trees (branching trunks, bark, leaf cards that sway
   * in the wind), not stand-ins: the ones the dive brushes past get the ~50k-triangle close-up
   * model on HIGH, the next ring the ~15k hero one, the rest the mid-detail one, which phones can
   * afford as well. No pines on a city street.
   */
  private async buildTrees(spots: CityStreet['trees'], path: FlightPath, quality: Quality): Promise<void> {
    if (!spots.length) return;
    const manifest = await fetch(asset('/models/homes/manifest.json'), { cache: 'no-cache' }).then(
      (r) => r.json() as Promise<KitManifest>,
    );
    const species = manifest.modules.filter((m) => m.kind === 'tree' && !m.lean && !/pine/.test(m.id));
    if (!species.length) return;
    const rand = mulberry32(6607);
    const lots: KitLot[] = spots.map((t) => {
      const mod = species[Math.floor(rand() * species.length)]!;
      const k = (2.1 * t.s) / mod.height;
      return {
        x: t.x, z: t.z, w: mod.footprint[0] * k, d: mod.footprint[1] * k, h: mod.height * k,
        yaw: t.yaw, tint: '#ffffff', moduleId: mod.id,
      };
    });
    // the dive, sampled in world space: trees within a few units of it are seen up close
    const line: Vector3[] = [];
    for (let t = 0.64; t <= 0.8; t += 0.002) line.push(path.storyPoint(t).clone());
    const at = new Vector3();
    const ultra: number[] = [];
    const near: number[] = [];
    const rest: number[] = [];
    const high = quality.tier === 'high';
    lots.forEach((lot, i) => {
      at.set(lot.x + this.group.position.x, lot.h * 0.6, lot.z + this.group.position.z);
      let d2 = Infinity;
      for (const c of line) d2 = Math.min(d2, c.distanceToSquared(at));
      if (high && d2 < CITY_TREE_ULTRA * CITY_TREE_ULTRA) ultra.push(i);
      (high && d2 < CITY_TREE_NEAR * CITY_TREE_NEAR ? near : rest).push(i);
    });
    const rings: KitRingSet = { near, mid: rest, far: [], detail: rest, ultra };
    this.trees = new KitCity(lots, rings, manifest, { tier: quality.tier, glow: 0, cloudEnv: false });
    this.group.add(this.trees.group);
  }

  /** the canyon lamps' poles, as buildStreetDressing stands them (its seeded jitter, replayed) */
  private lampSpots(): { x: number; z: number }[] {
    const rand = mulberry32(880);
    const out: { x: number; z: number }[] = [];
    for (let x = -30; x <= 34; x += 6.4) for (const z of [-2.05, 2.05]) out.push({ x: x + rand() * 0.6, z });
    return out;
  }

  update(t: number, time = 0, focus?: Vector3, eye?: Vector3): void {
    if (!this.group.visible) return;
    // the city is lit from the moment it appears (it switches on at 0.622, inside the weather): the lamps
    // and the windows start well up and only swell to full, because ramping them from dark left the first
    // stretch of the street - the one the flight comes down onto - black, with nothing to read
    const lamps = MathUtils.smoothstep(t, 0.622, 0.66);
    const lit = MathUtils.smoothstep(t, 0.622, 0.7);
    this.streetlights?.setLevel(0.7 + 0.3 * lamps);
    this.kitCity?.setPower(0.62 + 0.38 * lit);
    if (this.windows) (this.windows.material as MeshBasicMaterial).opacity = 0.65 + 0.35 * lit;
    if (focus) this.streetlights?.follow(focus);
    // traffic loops on absolute time only — the scene lives on its own, with
    // or without scroll (scroll-coupled surge removed by request)
    this.streetCars?.update(time);
    this.crossCars?.update(time);
    // the wet road's mirror: the clock for its rain rings, and the cars whose lamps it shows
    roadReflect.time.value = time;
    const ex = (eye ?? focus)?.x ?? this.group.position.x;
    this.streetCars?.nearLights(ex - this.group.position.x, roadReflect.cars.value);
    this.people?.update(time);
    KitCity.tick(time);
    this.street?.update(time);
    // the terrace answers its delivery; the diners at that table look up and wave
    if (this.terrace) {
      const wave = this.terrace.update(t, time);
      const at = this.terrace.waveAt;
      if (at) this.people?.setWave(at.x, at.z, 0.55, wave);
    }
    this.life?.update(time, eye);
    // aircraft-warning strobes on the antenna tips
    if (this.blinkMaterial) this.blinkMaterial.opacity = 0.25 + 0.65 * Math.abs(Math.sin(time * 2.1));
    if (this.mail.length) this.updateMail(t);
  }

  /** People on the canyon sidewalks, round the corners and in the plazas, at the cars' 1.35x (see PedestrianPlans.cityCrowd). */
  private buildPeople(plazas: CityStreet['plazas'], quality: Quality, extra: CityLife['stands'] = [], cafe: CafeTerrace | null = null): void {
    this.people = new Pedestrians(quality, cityCrowd(plazas, quality, extra,
      cafe ? { stands: cafe.stands, walks: cafe.walks, seat: CAFE_SEAT } : null));
    this.group.add(this.people.group);
  }

  // --- BatchFleet: the plazas' phone holders ---
  get crowd(): Pedestrians | null { return this.people; }
  // --- end BatchFleet ---

  dispose(): void {
    this.kitCity?.dispose();
    this.roadEnv?.dispose();
    this.trees?.dispose();
    this.people?.dispose();
    this.street?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
