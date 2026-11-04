import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CubicBezierCurve3,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three';
import { ROOFTOP_BASE_Y } from '../bake/cityGen.mjs';
import { paperSheetTexture } from '../bake/CanvasTextures';
import { rigParamsAt } from '../../story/chapters';
import type { BatchHudState } from '../interact/BatchHud';
import type { Quality } from '../quality';
import type { FlightPath } from '../rig/FlightPath';
import { mulberry32 } from '../util';
import { BATCH_TOTAL } from './BatchSend';
import { SHIP_DECK_SPOTS, type Beacon } from './Beacon';
import type { City } from './City';
import { dartGeometry } from './PaperPlane';
import type { TownSites } from './Rooftops';

/** the formation: the fleet rises out of the cloud sea and closes up between these story-t */
export const FLEET_JOIN = [0.272, 0.3] as const;
/** how many darts fly in the V (the tally counts nine joining on every tier) */
const COUNT_HIGH = 9;
const COUNT_LOW = 5;
const JOINED = 9;
/** the planes that are not delivered carry on with the hero into the storm, fading into it */
const CARRY = [0.345, 0.368] as const;
/** from here the rest of the batch is taken as delivered off-screen (the office detour freezes story-t here) */
export const FINAL_T = 0.79;
/** the card goes when the airliner chapter starts */
const HUD_END = 0.88;
/** the card is up across these story-t windows (the formation and town, the freighter, the city and after) */
const HUD_WINDOWS: readonly (readonly [number, number])[] = [[FLEET_JOIN[0], 0.345], [0.515, 0.585], [0.695, HUD_END]];
/** how long a delivery's toast holds the card's "delivered" phase */
const TOAST = 0.014;
/** a landing must project inside this fraction of the half-screen to count as in view (as BatchSend) */
const IN_VIEW = 0.8;
const GROUND = ROOFTOP_BASE_Y;
/** where the Engine holds the camera for the lighthouse delivery (Engine: rig.shot), and how strongly at story-t */
const SHOT_POS = new Vector3(147.6, 24.2, 0.9);
function shotWeight(t: number): number {
  return MathUtils.smoothstep(t, 0.512, 0.526) * (1 - MathUtils.smoothstep(t, 0.566, 0.58));
}
/** short contrails (HIGH only): points, and the story-t between them */
const TRAIL_POINTS = 14;
const TRAIL_STEP = 0.0012;
const UP = new Vector3(0, 1, 0);

type Kind = 'town' | 'ship' | 'phone' | 'window';
/**
 * Every delivery of the fleet, in story-t: when its plane leaves the flight and when it lands. The
 * tally reads these times alone, so it is a pure function of t whatever the plan picked. The two
 * window deliveries are City's first two dart landings (City.buildPlaneLandings: 0.698 + 0.021 i, 0.03 long).
 */
const SCHEDULE: readonly { kind: Kind; from: number; land: number; place: string }[] = [
  { kind: 'town', from: 0.303, land: 0.319, place: 'a lawn in the town' },
  { kind: 'town', from: 0.308, land: 0.328, place: 'a lawn in the town' },
  { kind: 'ship', from: 0.525, land: 0.548, place: 'harbour freighter' },
  { kind: 'ship', from: 0.537, land: 0.561, place: 'harbour freighter' },
  { kind: 'phone', from: 0.7, land: 0.722, place: 'a phone in the city' },
  { kind: 'window', from: 0.698, land: 0.728, place: 'a window in the city' },
  { kind: 'phone', from: 0.722, land: 0.744, place: 'a phone in the city' },
  { kind: 'window', from: 0.719, land: 0.749, place: 'a window in the city' },
];
/** how the light column over each kind of landing is sized, and when it goes (absolute t, or after landing) */
const BEAM: Record<Exclude<Kind, 'window'>, { h: number; r: number; off: (land: number) => [number, number] }> = {
  town: { h: 10, r: 0.5, off: () => [0.334, 0.345] },
  ship: { h: 26, r: 1.3, off: () => [0.572, 0.585] },
  phone: { h: 2.4, r: 0.11, off: (land) => [land + 0.02, land + 0.034] },
};
/** how bright each column is (additive): the town's stands in a bright evening haze */
const BEAM_GAIN: Record<Exclude<Kind, 'window'>, number> = { town: 1.2, ship: 0.8, phone: 0.7 };
/** where the HUD pins a landed chip above each kind of landing */
const CHIP_UP: Record<Kind, number> = { town: 2.1, ship: 15, phone: 1.0, window: 0.7 };

interface Delivery {
  kind: Kind;
  from: number;
  land: number;
  place: string;
  /** the dart instance it flies (-1: City flies it; `window` then says which of City's landings) and which way it peels off */
  plane: number;
  window: number;
  sign: number;
  planned: boolean;
  /** the glide: world points (town, phone), or offsets from the deck at the landing (ship) */
  curve: CubicBezierCurve3 | null;
  rest: Vector3;
  spot: readonly [number, number, number] | null;
  /** grows over the glide (from, to) */
  scale: [number, number];
  chip: Vector3;
}

/**
 * The batch fleet. Mid-flight, over the town, nine more planes of the hero's mail-merge (five on
 * LOW) rise out of the cloud sea behind it and close into a V around it; then, one at a time, planes
 * of the batch are delivered at random places: two peel off onto lawns in the town, two glide down
 * onto the freighter off the lighthouse, two come down onto the phones of people standing in the
 * city's plazas, and City's first two window darts count as two more. The hero and the rest carry
 * on. The HUD card (BatchHud) counts the batch the whole way: 3/42 out of the laptop, 12/42 in
 * formation, each delivery a toast, and from story-t 0.79 the whole 42/42.
 *
 * One InstancedMesh of the folded dart for every plane, one InstancedMesh of light columns over the
 * landings, and on HIGH one LineSegments of short contrails. The targets are chosen once per visit
 * (a random seed, or `?batchseed=N`), from the spots the chase camera actually sees as the plane
 * touches down; after that everything is a pure function of story-t, so it scrubs both ways.
 */
export class BatchFleet {
  readonly group = new Group();
  private count: number;
  private low: boolean;
  private darts: InstancedMesh;
  private dartGeometry = dartGeometry();
  private paper: CanvasTexture = paperSheetTexture();
  private dartMaterial: MeshStandardMaterial;
  private beams: InstancedMesh;
  private beamGeometry = new CylinderGeometry(1, 1, 1, 16, 1, true);
  private beamFade: CanvasTexture;
  private beamMaterial: MeshBasicMaterial;
  private trails: LineSegments | null = null;
  private trailPositions: Float32Array | null = null;
  private trailColors: Float32Array | null = null;
  private deliveries: Delivery[];
  private phases: number[] = [];
  private seed: number;
  private townPlanned = false;
  private shipPlanned = false;
  private phonePlanned = false;
  private windows: { t: number; at: Vector3 }[] = [];
  // scratch
  private p0 = new Vector3();
  private p1 = new Vector3();
  private p2 = new Vector3();
  private tan = new Vector3();
  private side = new Vector3();
  private deck = new Vector3();
  private slotV = new Vector3();
  private m4 = new Matrix4();
  private q = new Quaternion();
  private qRoll = new Quaternion();
  private scl = new Vector3();
  private zero = new Matrix4().makeScale(0, 0, 0);
  private beamColor = new Color('#6ff2d8');
  private c = new Color();
  private viewCamera = new PerspectiveCamera(50, 1, 0.1, 600);

  constructor(private path: FlightPath, quality: Quality, private beacon: Beacon, private city: City) {
    this.low = quality.tier === 'low';
    this.count = this.low ? COUNT_LOW : COUNT_HIGH;
    const param = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('batchseed') : null;
    this.seed = param !== null && Number.isFinite(Number(param)) ? Number(param) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
    const phase = mulberry32(77);
    for (let i = 0; i < this.count + 4; i++) this.phases.push(phase() * Math.PI * 2);

    // town deliveries fly the V's two wingtips; the freighter's and the phones' come in from out of frame
    let extra = this.count;
    let windows = 0;
    this.deliveries = SCHEDULE.map((s, i) => ({
      ...s,
      plane: s.kind === 'window' ? -1 : s.kind === 'town' ? this.count - 2 + i : extra++,
      window: s.kind === 'window' ? windows++ : -1,
      sign: i % 2 === 0 ? 1 : -1,
      planned: false,
      curve: null,
      rest: new Vector3(),
      spot: null,
      scale: s.kind === 'town' ? [0.8, 1.5] : s.kind === 'ship' ? [1, 2.4] : [0.55, 0.24],
      chip: new Vector3(),
    }));

    this.dartMaterial = new MeshStandardMaterial({
      map: this.paper, color: '#d6d1c7', roughness: 0.85, side: DoubleSide, emissive: '#8f97a8', emissiveIntensity: 0.14,
    });
    this.darts = new InstancedMesh(this.dartGeometry, this.dartMaterial, this.count + 4);
    this.darts.instanceMatrix.setUsage(DynamicDrawUsage);
    this.darts.frustumCulled = false;
    this.group.add(this.darts);

    // the light column over a landing: fades out upward (as BatchSend's), one instance per landing
    const gc = document.createElement('canvas');
    gc.width = 4;
    gc.height = 64;
    const gx = gc.getContext('2d')!;
    const grad = gx.createLinearGradient(0, 64, 0, 0);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.55, '#707070');
    grad.addColorStop(1, '#000000');
    gx.fillStyle = grad;
    gx.fillRect(0, 0, 4, 64);
    this.beamFade = new CanvasTexture(gc);
    this.beamMaterial = new MeshBasicMaterial({
      color: '#ffffff', alphaMap: this.beamFade, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false,
    });
    this.beams = new InstancedMesh(this.beamGeometry, this.beamMaterial, SCHEDULE.length);
    this.beams.instanceMatrix.setUsage(DynamicDrawUsage);
    this.beams.frustumCulled = false;
    for (let i = 0; i < SCHEDULE.length; i++) {
      this.beams.setMatrixAt(i, this.zero);
      this.beams.setColorAt(i, this.c.setRGB(0, 0, 0));
    }
    this.group.add(this.beams);

    if (!this.low) {
      const verts = (this.count + 4) * (TRAIL_POINTS - 1) * 2;
      this.trailPositions = new Float32Array(verts * 3);
      this.trailColors = new Float32Array(verts * 3);
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(this.trailPositions, 3).setUsage(DynamicDrawUsage));
      g.setAttribute('color', new BufferAttribute(this.trailColors, 3).setUsage(DynamicDrawUsage));
      this.trails = new LineSegments(g, new LineBasicMaterial({
        vertexColors: true, color: '#cfe8ff', transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false,
      }));
      this.trails.frustumCulled = false;
      this.group.add(this.trails);
    }
    this.group.visible = false;
  }

  // ---- the flight -------------------------------------------------------------------------------

  /** A plane's place in the V, in the hero's frame (forward, side, up): the apex ahead, the wingtips level with the hero. */
  private slot(i: number, aspect: number, out: Vector3): Vector3 {
    const kMax = (this.count - 1) / 2;
    const k = Math.ceil(i / 2) / kMax;
    const sign = i % 2 === 1 ? 1 : -1;
    // a phone held upright sees a thin slice sideways: the V closes up narrower there
    const wide = MathUtils.clamp(0.5 + 0.38 * (aspect - 0.56), 0.5, 1);
    return out.set(6.5 - 6 * k, i === 0 ? 0 : sign * k * 4.2 * wide, 0.5 - 0.7 * k);
  }

  /** Where formation plane `i` is at story-t `t` (rising out of the cloud sea, then in the V); its scale. */
  private formation(i: number, t: number, aspect: number, out: Vector3): number {
    const order = i === 0 ? 0 : (Math.ceil(i / 2) * 2 - (i % 2)) / this.count;
    const j0 = FLEET_JOIN[0] + order * 0.014;
    const e = MathUtils.smoothstep(t, j0, j0 + 0.014);
    if (t < j0) return 0;
    const v = this.slot(i, aspect, this.slotV);
    const ph = this.phases[i]!;
    // they come up out of the cloud deck under the V, not from behind the lens
    const f = MathUtils.lerp(v.x - 3 - 1.5 * Math.sin(ph), v.x, e);
    let s = v.y * MathUtils.lerp(1.5, 1, e);
    let u = MathUtils.lerp(v.z - 10, v.z, e);
    // a little life in the V: each plane rides its own gentle swell (in story-t, so it scrubs)
    u += 0.14 * Math.sin(t * 900 + ph);
    s += 0.1 * Math.sin(t * 610 + ph * 2);
    // the rest carry on with the hero into the storm, opening out a little as they go
    const carry = MathUtils.smoothstep(t, CARRY[0], CARRY[1]);
    s *= 1 + carry * 0.8;
    this.path.pointAt(t, out);
    this.path.tangentAt(t, this.tan);
    this.side.crossVectors(this.tan, UP).normalize();
    out.addScaledVector(this.tan, f).addScaledVector(this.side, s).addScaledVector(UP, u);
    return 0.8 * Math.min(e * 4, 1) * (1 - carry);
  }

  /** Where dart instance `i` is at story-t `t`, and its scale (0: not drawn). */
  private pose(i: number, t: number, aspect: number, out: Vector3): number {
    const d = this.deliveries.find((x) => x.plane === i);
    if (!d) return t < CARRY[1] ? this.formation(i, t, aspect, out) : 0;
    if (d.kind === 'town' && (t < d.from || !d.planned)) return t < CARRY[1] ? this.formation(i, t, aspect, out) : 0;
    if (!d.planned || !d.curve || t < d.from) return 0;
    const x = MathUtils.clamp((t - d.from) / (d.land - d.from), 0, 1);
    const u = 1 - Math.pow(1 - x, 1.5);
    d.curve.getPoint(u, out);
    if (d.kind === 'ship') out.add(this.beacon.shipDeckAt(Math.min(t, d.land), d.spot!, this.deck));
    let s = MathUtils.lerp(d.scale[0], d.scale[1], MathUtils.smoothstep(x, 0, 0.9));
    if (d.kind === 'town') s *= 1 - MathUtils.smoothstep(t, 0.335, 0.345);
    if (d.kind === 'ship') s *= 1 - MathUtils.smoothstep(t, 0.575, 0.585);
    // a phone takes its dart in: it shrinks into the screen over the last of the glide
    if (d.kind === 'phone') s *= 1 - MathUtils.smoothstep(x, 0.84, 1);
    return s;
  }

  // ---- choosing where they land -----------------------------------------------------------------

  /** The chase camera at story-t `t` with no gusts and no damping (and the lighthouse's held shot): enough to ask what is in frame. */
  private modelCamera(t: number, aspect: number): PerspectiveCamera {
    const rig = rigParamsAt(t);
    const cam = this.viewCamera;
    this.path.pointAt(t, this.p1);
    this.path.tangentAt(t, this.tan);
    this.side.crossVectors(this.tan, UP).normalize();
    this.path.pointAt(Math.max(t - rig.camLag, 0), this.p0);
    this.p0.addScaledVector(UP, rig.offsetUp).addScaledVector(this.side, rig.offsetSide).addScaledVector(this.tan, -rig.offsetBack);
    const dist = this.p0.distanceTo(this.p1);
    if (dist < 1.2) this.p0.sub(this.p1).multiplyScalar(1.2 / Math.max(dist, 1e-4)).add(this.p1);
    const w = shotWeight(t);
    cam.position.copy(this.p0).lerp(SHOT_POS, w);
    this.path.pointAt(Math.min(t + rig.lookAhead, 1), this.p1);
    this.p1.y += rig.lookUp ?? 0;
    this.p1.lerp(this.beacon.lantern, w);
    cam.fov = rig.fov;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    cam.lookAt(this.p1);
    cam.updateMatrixWorld();
    return cam;
  }

  /** How far from the middle of the screen `at` is at story-t `t`: 0 centre, 1 the edge, Infinity behind. */
  private offCentre(t: number, at: Vector3, aspect: number): number {
    const cam = this.modelCamera(t, aspect);
    this.p2.copy(at).project(cam);
    if (this.p2.z > 1) return Infinity;
    return Math.max(Math.abs(this.p2.x), Math.abs(this.p2.y));
  }

  /** In view as it touches down and a moment before (that is what the eye follows in). */
  private view(t: number, at: Vector3, aspect: number): number {
    return Math.max(this.offCentre(t, at, aspect), this.offCentre(t - 0.006, at, aspect));
  }

  /**
   * The lighthouse stands between the held shot and the sea: a spot whose screen x falls inside the
   * tower's silhouette (about 5 units either side of its axis) is hidden. Returns 0 when clear, else
   * more than IN_VIEW, larger the deeper behind it the spot is.
   */
  private behindTower(t: number, at: Vector3, aspect: number): number {
    const cam = this.modelCamera(t, aspect);
    const lamp = this.beacon.lantern;
    if (cam.position.distanceTo(at) < cam.position.distanceTo(lamp)) return 0;
    const sx = this.p2.copy(at).project(cam).x;
    const lx = this.p0.copy(lamp).project(cam).x;
    this.p1.setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(5).add(lamp);
    const half = Math.abs(this.p1.project(cam).x - lx);
    const dx = Math.abs(sx - lx);
    return dx < half ? 1 + (half - dx) : 0;
  }

  /** A random pick from what is in view, or failing that from the few nearest the middle of the screen. */
  private pick<T extends { view: number }>(options: T[], rand: () => number): T | undefined {
    let pool = options.filter((o) => o.view < IN_VIEW);
    if (!pool.length) pool = [...options].sort((a, b) => a.view - b.view).slice(0, 3);
    return pool[Math.floor(rand() * pool.length)];
  }

  /** Two lawns in the town, out ahead where the camera looks down on them through the haze. */
  private planTown(sites: TownSites, aspect: number): void {
    this.townPlanned = true;
    const rand = mulberry32(this.seed ^ 0x51a7);
    const used: Vector3[] = [];
    for (const d of this.deliveries) {
      if (d.kind !== 'town') continue;
      const options: { rest: Vector3; view: number }[] = [];
      for (const h of sites.houses) {
        if (h.x < 85 || h.x > 175 || Math.abs(h.z) > 70) continue;
        const front = Math.cos(h.yaw) > 0 ? 1 : -1;
        const rest = new Vector3(h.x + (rand() - 0.5) * 1.6, GROUND + 0.27, h.z + front * (h.d / 2 + 1.3));
        if (used.some((u) => u.distanceTo(rest) < 9)) continue;
        const blocked = sites.trees.some((tr) => Math.abs(tr.x - rest.x) < 5 && Math.abs(tr.z - rest.z) < 5 &&
          Math.hypot(tr.x - rest.x, tr.z - rest.z) < Math.max(tr.w, tr.d) * 0.42 + 0.6);
        if (blocked) continue;
        options.push({ rest, view: this.view(d.land, rest, aspect) });
      }
      const choice = this.pick(options, rand);
      if (!choice) continue;
      used.push(choice.rest);
      const start = new Vector3();
      this.formation(d.plane, d.from, aspect, start);
      this.path.tangentAt(d.from, this.tan);
      this.side.crossVectors(this.tan, UP).normalize();
      const span = start.distanceTo(choice.rest);
      const back = this.p0.subVectors(start, choice.rest).setY(0).normalize();
      d.curve = new CubicBezierCurve3(
        start,
        start.clone().addScaledVector(this.tan, span * 0.3).addScaledVector(this.side, d.sign * span * 0.12),
        choice.rest.clone().addScaledVector(back, span * 0.28).addScaledVector(UP, span * 0.1),
        choice.rest.clone(),
      );
      d.rest.copy(choice.rest);
      d.planned = true;
    }
  }

  /** Two of the freighter's spots, as the held lighthouse shot sees it. */
  private planShip(aspect: number): void {
    this.shipPlanned = true;
    const rand = mulberry32(this.seed ^ 0x5419);
    const free = [...SHIP_DECK_SPOTS];
    for (const d of this.deliveries) {
      if (d.kind !== 'ship') continue;
      const options = free.map((spot) => {
        const at = this.beacon.shipDeckAt(d.land, spot, new Vector3());
        const view = this.view(d.land, at, aspect);
        return { spot, view: Math.max(view, this.behindTower(d.land, at, aspect)) };
      });
      const choice = this.pick(options, rand);
      if (!choice) continue;
      free.splice(free.indexOf(choice.spot), 1);
      d.spot = choice.spot;
      // from beside the hero at the lantern, out and down across the water onto the deck: the glide is
      // kept relative to the spot at the landing, and rides the ship as it steams (see pose)
      const start = this.path.pointAt(d.from, new Vector3());
      this.path.tangentAt(d.from, this.tan);
      this.side.crossVectors(this.tan, UP).normalize();
      start.addScaledVector(this.side, d.sign * 2.5).addScaledVector(UP, 1.2);
      const deckFrom = this.beacon.shipDeckAt(d.from, choice.spot, new Vector3());
      const r0 = start.clone().sub(deckFrom);
      const flat = r0.clone().setY(0);
      const span = r0.length();
      d.curve = new CubicBezierCurve3(
        r0,
        r0.clone().addScaledVector(this.tan, span * 0.15).addScaledVector(UP, span * 0.06),
        flat.multiplyScalar(0.25).setY(span * 0.05),
        new Vector3(),
      );
      d.planned = true;
    }
  }

  /** Two people standing in the city with a phone in their hand, in frame as the dart comes down. */
  private planPhones(aspect: number, holders: { x: number; y: number; z: number; yaw: number }[]): void {
    this.phonePlanned = true;
    const rand = mulberry32(this.seed ^ 0x9407);
    const origin = this.city.group.position;
    const anyStand = this.city.crowd?.phoneHolders(true) ?? [];
    const used: Vector3[] = [];
    for (const d of this.deliveries) {
      if (d.kind !== 'phone') continue;
      const optionsFor = (list: typeof holders): { at: Vector3; yaw: number; view: number }[] => list
        .map((h) => ({ at: new Vector3(h.x, h.y, h.z).add(origin), yaw: h.yaw, view: 0 }))
        .filter((o) => !used.some((u) => u.distanceTo(o.at) < 1.5))
        .map((o) => ({ ...o, view: this.view(d.land, o.at, aspect) }));
      // a phone in view and near enough to read the person; if no one with a phone is, the nearest
      // few people standing in view (a dart landing 50 units down the canyon is a speck)
      const cam = this.modelCamera(d.land, aspect).position.clone();
      const near = (list: { at: Vector3; view: number }[]): typeof list =>
        list.filter((o) => o.view < IN_VIEW && o.at.distanceTo(cam) < 25);
      let options = near(optionsFor(holders));
      if (!options.length) {
        options = optionsFor(anyStand).filter((o) => o.view < IN_VIEW)
          .sort((a, b) => a.at.distanceTo(cam) - b.at.distanceTo(cam)).slice(0, 3);
      }
      if (!options.length) options = optionsFor(holders);
      const choice = this.pick(options, rand);
      if (!choice) continue;
      used.push(choice.at);
      const start = this.path.pointAt(d.from, new Vector3());
      this.path.tangentAt(d.from, this.tan);
      this.side.crossVectors(this.tan, UP).normalize();
      start.addScaledVector(this.tan, 2).addScaledVector(this.side, d.sign * 1.5).addScaledVector(UP, 2.2);
      const facing = new Vector3(Math.cos(choice.yaw), 0, -Math.sin(choice.yaw));
      d.curve = new CubicBezierCurve3(
        start,
        start.clone().addScaledVector(this.tan, 4).addScaledVector(UP, -0.4),
        choice.at.clone().addScaledVector(facing, 1.3).addScaledVector(UP, 0.7),
        choice.at.clone(),
      );
      d.rest.copy(choice.at);
      d.planned = true;
    }
  }

  // ---- each frame -------------------------------------------------------------------------------

  /** Which deliveries are planned, and where (for tests: identical for the same `?batchseed`). */
  targets(): { kind: Kind; land: number; at: number[] | null }[] {
    return this.deliveries.map((d) => ({
      kind: d.kind, land: d.land,
      at: d.kind === 'window' ? (this.windows[d.window]?.at.toArray() ?? null)
        : d.planned ? (d.kind === 'ship' ? [...d.spot!] : d.rest.toArray()) : null,
    }));
  }

  update(t: number, sites: TownSites | null, aspect: number): void {
    if (sites && !this.townPlanned) this.planTown(sites, aspect);
    if (!this.shipPlanned) this.planShip(aspect);
    if (!this.phonePlanned) {
      const holders = this.city.crowd?.phoneHolders() ?? [];
      if (holders.length) this.planPhones(aspect, holders);
    }
    if (!this.windows.length) this.windows = this.city.batchWindows;

    const on = (t > FLEET_JOIN[0] && t < CARRY[1]) || (t > 0.524 && t < 0.586) || (t > 0.699 && t < 0.78);
    this.group.visible = on;
    if (!on) return;
    // pale paper in the sunset; lit a little from within at night, so it reads against the dark
    this.dartMaterial.emissiveIntensity = t < 0.4 ? 0.14 : 0.55;

    for (let i = 0; i < this.count + 4; i++) {
      const s = this.attitude(i, t, aspect);
      if (s <= 1e-4) this.darts.setMatrixAt(i, this.zero);
      else this.darts.setMatrixAt(i, this.m4.compose(this.p0, this.q, this.scl.setScalar(s)));
      if (this.trails) this.trail(i, t, aspect, s);
    }
    this.darts.instanceMatrix.needsUpdate = true;
    if (this.trails) {
      this.trails.geometry.attributes.position!.needsUpdate = true;
      this.trails.geometry.attributes.color!.needsUpdate = true;
    }
    this.updateBeams(t);
  }

  /** Puts instance `i`'s place in p0 and heading in q; returns its scale. */
  private attitude(i: number, t: number, aspect: number): number {
    const s = this.pose(i, t, aspect, this.p0);
    if (s <= 1e-4) return 0;
    const d = this.deliveries.find((x) => x.plane === i);
    // heading from where it is about to be (frozen once landed, levelled onto the ground)
    const landed = d && d.planned && t >= d.land - 0.002;
    const tt = landed ? d.land - 0.002 : t;
    this.pose(i, tt, aspect, this.p1);
    this.pose(i, tt + 0.0012, aspect, this.p2);
    this.tan.subVectors(this.p2, this.p1);
    if (landed) this.tan.y *= 0.15;
    if (this.tan.lengthSq() < 1e-10) this.path.tangentAt(t, this.tan);
    this.tan.normalize();
    this.m4.lookAt(this.p1.copy(this.p0).add(this.tan), this.p0, UP);
    this.q.setFromRotationMatrix(this.m4);
    // bank: a gentle sway in formation, into the turn when it peels off
    const ph = this.phases[i]!;
    const peel = d && d.planned && t > d.from && !landed ? Math.sin(Math.PI * MathUtils.clamp((t - d.from) / (d.land - d.from), 0, 1)) : 0;
    const roll = (landed ? 0 : 0.08 * Math.sin(t * 520 + ph)) - (d ? d.sign * 0.5 * peel : 0);
    this.qRoll.setFromAxisAngle(this.tan, roll);
    this.q.premultiply(this.qRoll);
    return s;
  }

  /** Instance `i`'s contrail: sampled back along where it has been, faded down its length. */
  private trail(i: number, t: number, aspect: number, scale: number): void {
    const pos = this.trailPositions!;
    const col = this.trailColors!;
    const d = this.deliveries.find((x) => x.plane === i);
    const base = d && d.planned ? Math.min(t, d.land) : t;
    const fade = d && d.planned ? 1 - MathUtils.smoothstep(t, d.land, d.land + 0.008) : 1;
    let o = i * (TRAIL_POINTS - 1) * 6;
    let prevS = scale > 1e-4 ? this.pose(i, base, aspect, this.p1) : 0;
    this.p2.copy(this.p1);
    for (let k = 1; k < TRAIL_POINTS; k++) {
      const s = prevS > 1e-4 ? this.pose(i, base - k * TRAIL_STEP, aspect, this.p1) : 0;
      const live = prevS > 1e-4 && s > 1e-4;
      const a = live ? 0.55 * fade * Math.min(prevS / 0.8, 1) * Math.pow(1 - (k - 1) / (TRAIL_POINTS - 1), 2) : 0;
      const b = live ? 0.55 * fade * Math.min(prevS / 0.8, 1) * Math.pow(1 - k / (TRAIL_POINTS - 1), 2) : 0;
      pos[o] = this.p2.x; pos[o + 1] = this.p2.y; pos[o + 2] = this.p2.z;
      col[o] = col[o + 1] = col[o + 2] = a;
      pos[o + 3] = this.p1.x; pos[o + 4] = this.p1.y; pos[o + 5] = this.p1.z;
      col[o + 3] = col[o + 4] = col[o + 5] = b;
      o += 6;
      this.p2.copy(this.p1);
      prevS = s;
    }
  }

  /** The columns of light that come up over each landing. */
  private updateBeams(t: number): void {
    this.deliveries.forEach((d, i) => {
      if (d.kind === 'window' || !d.planned) {
        this.beams.setMatrixAt(i, this.zero);
        return;
      }
      const spec = BEAM[d.kind];
      const [o0, o1] = spec.off(d.land);
      const up = MathUtils.smoothstep(t, d.land, d.land + 0.01) * (1 - MathUtils.smoothstep(t, o0, o1));
      if (up < 0.01) {
        this.beams.setMatrixAt(i, this.zero);
        return;
      }
      const at = d.kind === 'ship' ? this.beacon.shipDeckAt(d.land, d.spot!, this.p1) : this.p1.copy(d.rest);
      const ground = d.kind === 'phone' ? at.y - d.rest.y + this.city.group.position.y : d.kind === 'ship' ? at.y - 2 : GROUND;
      const h = spec.h * up;
      this.m4.makeScale(spec.r, h, spec.r).setPosition(at.x, ground + h / 2, at.z);
      this.beams.setMatrixAt(i, this.m4);
      this.beams.setColorAt(i, this.c.copy(this.beamColor).multiplyScalar(BEAM_GAIN[d.kind] * up));
    });
    this.beams.instanceMatrix.needsUpdate = true;
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true;
  }

  // ---- the HUD ---------------------------------------------------------------------------------

  /**
   * What the batch card shows at story-t `t`, on top of the scouts' state (`base`): a pure function
   * of t. Sent: 3 out of the laptop, 12 once the formation has joined, 42 from FINAL_T. Delivered:
   * the scouts' two, then one more for every landing in SCHEDULE, and all 42 from FINAL_T.
   */
  state(t: number, base: BatchHudState, aspect = 16 / 9): BatchHudState {
    const chips = [...base.chips, ...this.deliveries.map((d) => this.chip(d, t, aspect))];
    if (t < FLEET_JOIN[0]) return { ...base, chips };
    const final = t >= FINAL_T;
    const join = MathUtils.clamp((t - FLEET_JOIN[0]) / (FLEET_JOIN[1] - FLEET_JOIN[0]), 0, 1);
    const joined = Math.round(JOINED * join);
    const sent = final ? BATCH_TOTAL : 3 + joined;
    const landed = this.deliveries.filter((d) => t >= d.land);
    const delivered = final ? BATCH_TOTAL : base.delivered + landed.length;
    const visible = HUD_WINDOWS.some(([a, b]) => t >= a && t < b);
    // the latest landing's toast, while it holds
    const toast = landed.filter((d) => t < d.land + TOAST).sort((a, b) => b.land - a.land)[0];
    let phase: 'sending' | 'done' = 'sending';
    let foot: string;
    if (final) {
      phase = 'done';
      foot = `${BATCH_TOTAL}/${BATCH_TOTAL} · batch delivered`;
    } else if (toast) {
      phase = 'done';
      foot = `Delivered · ${toast.place} · ${base.delivered + this.deliveries.filter((d) => d.land <= toast.land).length}/${BATCH_TOTAL}`;
    } else if (join < 1) {
      foot = `${joined} joining the formation`;
    } else if (!landed.length) {
      foot = `${JOINED} joined the formation`;
    } else {
      foot = `${delivered}/${BATCH_TOTAL} delivered · tracking plane 3`;
    }
    return { visible, sent, delivered, chips, phase, foot };
  }

  private chipScratch = new Vector3();
  /** A delivery's tag: over the plane while it flies in, then "Delivered" over where it landed. */
  private chip(d: Delivery, t: number, aspect: number): BatchHudState['chips'][number] {
    const label = `Plane ${4 + this.deliveries.indexOf(d)}`;
    if (d.kind === 'window') {
      const w = this.windows[d.window];
      if (w) d.chip.copy(w.at).y += CHIP_UP.window;
      return { anchor: d.chip, shown: !!w && t >= d.land && t < d.land + 0.022, mode: 'landed', label };
    }
    if (!d.planned) return { anchor: d.chip, shown: false, mode: 'flying', label };
    const flying = t < d.land;
    if (flying) {
      this.pose(d.plane, t, aspect, this.chipScratch);
      d.chip.copy(this.chipScratch).y += d.kind === 'ship' ? 3 : 0.9;
    } else if (d.kind === 'ship') {
      this.beacon.shipDeckAt(d.land, d.spot!, d.chip).y += CHIP_UP.ship;
    } else {
      d.chip.copy(d.rest).y += CHIP_UP[d.kind];
    }
    // flying tags only over the town and the city's plazas; the freighter is far out, its tag is the landing's
    const shownFlying = flying && t >= d.from + 0.003 && d.kind !== 'ship';
    const shownLanded = !flying && t < d.land + 0.022;
    return { anchor: d.chip, shown: shownFlying || shownLanded, mode: flying ? 'flying' : 'landed', label };
  }

  dispose(): void {
    this.dartGeometry.dispose();
    this.dartMaterial.dispose();
    this.paper.dispose();
    this.beamGeometry.dispose();
    this.beamFade.dispose();
    this.beamMaterial.dispose();
    if (this.trails) {
      this.trails.geometry.dispose();
      (this.trails.material as LineBasicMaterial).dispose();
    }
  }
}
