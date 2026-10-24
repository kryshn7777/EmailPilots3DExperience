import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CubicBezierCurve3,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Line,
  LineBasicMaterial,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { HOME_CELL, ROOFTOP_BASE_Y } from '../bake/cityGen.mjs';
import { glowTexture } from '../bake/CanvasTextures';
import { rigParamsAt } from '../../story/chapters';
import type { FlightPath } from '../rig/FlightPath';
import { HERO_RELEASE, JOIN_T, RELEASE_T, STAGE, heroParam, launchAttitude, launchParam, launchPulse, planeScale } from '../rig/launch';
import { mulberry32 } from '../util';
import { envelopeTextures } from './Envelopes';
import { PaperBurst } from './PaperBurst';
import { PaperPlane } from './PaperPlane';
import type { TownSite, TownSites } from './Rooftops';

/** the mail-merge the story sends: "Email Pilots · batch sending 3/42" */
export const BATCH_TOTAL = 42;
export { RELEASE_T };

/** where the display's centre is, and which way it faces (the screen leans back a little from vertical) */
const SCREEN = new Vector3(-0.64, 1.66, 0);
const SCREEN_N = new Vector3(Math.cos(0.24), Math.sin(0.24), 0);
const SCREEN_RIGHT = new Vector3(0, 0, -1);
/** the envelope: its box is 0.78 wide; scaled to sit beside a laptop whose display is 1.38 wide */
const ENVELOPE_SCALE = 0.56;

/** the street the flight runs down between the front yards, and the lawns' street-side edges */
const STREET_Z = HOME_CELL.lotD + HOME_CELL.street / 2;
const FRONT_N = HOME_CELL.lotD;
const FRONT_S = HOME_CELL.lotD + HOME_CELL.street;
/** the lamps' x within a cell, and how far a cell repeats: poles a glide must not fly into */
const LAMP_X = [3.5, 17.5];

/** how long the last glide, off the street and onto a lawn, takes in story-t */
const LEG_T = 0.038;
/** the HUD starts tagging the scouts "Plane 1" and "Plane 2" once they are out of the window */
const TAG_FROM = 0.085;
/** a scout's contrail: points, and the story-t between them */
const TRAIL_POINTS = 26;
const TRAIL_STEP = 0.0016;
/** in the room the contrails are short and tight: a thin streak, not a wire across the frame */
const ROOM_TRAIL = 0.45;
/** the horizontal run before the house at which a scout leaves the street */
const LEG_RUN = 9.5;
/** which houses are candidates: along the street from the yards behind it to a few lots ahead */
const X_RANGE: [number, number] = [22, 50];
/** a landing must project inside this fraction of the half-screen (1 = the very edge) to count as in view */
const IN_VIEW = 0.8;

const FADE_FROM = 0.27;
const FADE_TO = 0.3;
/** the scouts fly a touch bigger than the hero: they are the ones seen from the street */
const SCALE = 1.05;
const GROUND = ROOFTOP_BASE_Y;
const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);

/**
 * A little puff of paper flecks where a fold finishes: a handful of specks that drift apart and
 * fall, not an explosion. Two emissions per plane (the envelope opening, the last crease), both
 * pure functions of story-t so it scrubs both ways.
 */
const PUFF_LIFE = 0.014;
class LaunchPuff {
  readonly points: Points;
  private geometry = new BufferGeometry();
  private material: PointsMaterial;
  private positions: Float32Array;
  private colors: Float32Array;
  private dirs: Float32Array;
  private speeds: Float32Array;
  private first: number;

  constructor(count: number, map: CanvasTexture, rand: () => number) {
    this.first = Math.ceil(count * 0.4);
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.dirs = new Float32Array(count * 3);
    this.speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const theta = rand() * Math.PI * 2;
      const up = rand() * 1.1 - 0.15;
      const r = Math.sqrt(Math.max(1 - up * up, 0));
      this.dirs[i * 3] = Math.cos(theta) * r;
      this.dirs[i * 3 + 1] = up;
      this.dirs[i * 3 + 2] = Math.sin(theta) * r;
      this.speeds[i] = (i < this.first ? 0.16 : 0.26) + rand() * (i < this.first ? 0.14 : 0.3);
    }
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3).setUsage(DynamicDrawUsage));
    this.material = new PointsMaterial({
      map, size: 0.034, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending, color: '#fff1d6',
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** `a` and `b` are where, and `ta`, `tb` when, the two emissions happen. */
  update(t: number, a: Vector3, ta: number, b: Vector3, tb: number): void {
    const n = this.speeds.length;
    let any = false;
    for (let i = 0; i < n; i++) {
      const origin = i < this.first ? a : b;
      const u = (t - (i < this.first ? ta : tb)) / PUFF_LIFE;
      let bright = 0;
      if (u > 0 && u < 1) {
        any = true;
        const e = 1 - Math.pow(1 - u, 3);
        const d = this.speeds[i]! * e;
        this.positions[i * 3] = origin.x + this.dirs[i * 3]! * d;
        this.positions[i * 3 + 1] = origin.y + this.dirs[i * 3 + 1]! * d - 0.12 * u * u;
        this.positions[i * 3 + 2] = origin.z + this.dirs[i * 3 + 2]! * d;
        bright = 0.9 * Math.pow(1 - u, 1.4);
      }
      this.colors[i * 3] = this.colors[i * 3 + 1] = this.colors[i * 3 + 2] = bright;
    }
    this.points.visible = any;
    if (!any) return;
    this.geometry.attributes.position!.needsUpdate = true;
    this.geometry.attributes.color!.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** A few motes of dust turning slowly in the lamp's beam over the desk, in front of the lens. */
class LaunchMotes {
  readonly points: Points;
  private geometry = new BufferGeometry();
  private material: PointsMaterial;
  private base: Float32Array;
  private positions: Float32Array;

  constructor(count: number, map: CanvasTexture) {
    const rand = mulberry32(2024);
    this.base = new Float32Array(count * 3);
    this.positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    // the lamp's bulb and where its cone lands (Desk's lamp: world coordinates)
    const bulb = new Vector3(1.59, 2.08, -1.36);
    const aim = new Vector3(1.4, 1.19, -0.7);
    const axis = aim.clone().sub(bulb);
    for (let i = 0; i < count; i++) {
      const u = 0.15 + rand() * 0.85;
      const r = Math.sqrt(rand()) * (0.25 + u * 1.5);
      const a = rand() * Math.PI * 2;
      // across the beam, and drawn out toward the laptop, where the camera looks
      this.base[i * 3] = bulb.x + axis.x * u + Math.cos(a) * r - rand() * 1.3 * u;
      this.base[i * 3 + 1] = bulb.y + axis.y * u + (rand() - 0.5) * 0.5;
      this.base[i * 3 + 2] = bulb.z + axis.z * u + Math.sin(a) * r * 0.9;
      colors.fill(0.35 + 0.65 * (1 - Math.min(r / 1.3, 1)) * (1 - u * 0.3), i * 3, i * 3 + 3);
    }
    this.positions.set(this.base);
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute('color', new BufferAttribute(colors, 3));
    this.material = new PointsMaterial({
      map, size: 0.022, vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, blending: AdditiveBlending, color: '#ffeccc',
    });
    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  update(time: number, drift: boolean): void {
    if (!drift) return;
    for (let i = 0; i < this.positions.length; i += 3) {
      this.positions[i] = this.base[i]! + Math.sin(time * 0.17 + i) * 0.08;
      this.positions[i + 1] = this.base[i + 1]! + Math.sin(time * 0.11 + i * 1.7) * 0.06;
      this.positions[i + 2] = this.base[i + 2]! + Math.cos(time * 0.13 + i * 0.6) * 0.07;
    }
    this.geometry.attributes.position!.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

interface Scout {
  plane: PaperPlane;
  burst: PaperBurst;
  ring: Mesh;
  ringMaterial: MeshBasicMaterial;
  beam: Mesh;
  beamMaterial: MeshBasicMaterial;
  trail: Line;
  trailMaterial: LineBasicMaterial;
  trailPositions: Float32Array;
  release: number;
  /** the envelope it leaves the screen as, and the puff of flecks as it opens and folds */
  env: Mesh;
  puff: LaunchPuff;
  /** the offset off the hero's line (in the street's width) at the screen, in the room and out over the town; and above it */
  side0: number;
  sideRoom: number;
  side: number;
  lift: number;
  /** a swoop over the room's length: + climbs over the desk first, - hugs it */
  arc: number;
  /** the wobble of its bank */
  phase: number;
  /** how far ahead of the hero (in story-t) it is by the time it reaches the street */
  lead: number;
  /** filled in once the town's houses are known */
  leg: CubicBezierCurve3 | null;
  branchT: number;
  landT: number;
  rest: Vector3;
  /** where the HUD pins its "delivered" chip, above the landing */
  chip: Vector3;
}

/**
 * The batch behind the hero plane. The story is one email in a send of 42: from the study laptop
 * three planes go out, and the camera follows the third. The first two are "scouts": they leave
 * the screen ahead of it, fly out of the window along the same airway a little to each side, and
 * then, in front of the camera over the street, each peels off to a different house nearby and
 * lands on its front lawn: delivered. Which houses (one each side of the street) is chosen at
 * random on every visit.
 *
 * Everything is a function of story-t, so it scrubs both ways. Two flights per scout: the shared
 * airway (the hero's own spline, offset, pulled ahead of the hero by a little lead) and a cubic
 * glide from the street to the lawn.
 */
export class BatchSend {
  readonly group = new Group();
  private scouts: Scout[] = [];
  private planned = false;
  private prevT = 0;
  // scratch
  private p0 = new Vector3();
  private p1 = new Vector3();
  private p2 = new Vector3();
  private tan = new Vector3();
  private tan2 = new Vector3();
  private tmp = new Vector3();
  private side = new Vector3();
  private m4 = new Matrix4();
  private qBase = new Quaternion();
  private qRoll = new Quaternion();
  private qPitch = new Quaternion();
  private beamFade: CanvasTexture;
  private beamGeometry = new CylinderGeometry(0.3, 0.3, 1, 20, 1, true);
  // the launch: three envelopes, the hero's among them, and the room's light around them
  private envGeometry = new BoxGeometry(0.78, 0.02, 0.527);
  private envFaces = envelopeTextures();
  private envMaterials: MeshStandardMaterial[] = [];
  private heroEnv: Mesh;
  private heroPuff: LaunchPuff;
  private flecks = glowTexture();
  private glow: Sprite;
  private motes: LaunchMotes;
  private qFace = new Quaternion();
  private mFace = new Matrix4();
  private pA = new Vector3();
  private pB = new Vector3();

  constructor(private path: FlightPath, private opts: { low: boolean; calm: boolean } = { low: false, calm: false }) {
    // the envelope: air-mail paper, lit a little from within so it reads in the lamp's pool
    const paper = (map?: CanvasTexture): MeshStandardMaterial => {
      const m = new MeshStandardMaterial({
        ...(map ? { map, emissiveMap: map } : { color: '#efe6cf' }),
        emissive: '#ffd9a0', emissiveIntensity: 0.5, roughness: 0.75,
      });
      this.envMaterials.push(m);
      return m;
    };
    const edge = paper();
    const envMaterial = [edge, edge, paper(this.envFaces.front), paper(this.envFaces.back), edge, edge];
    const makeEnvelope = (): Mesh => {
      const m = new Mesh(this.envGeometry, envMaterial);
      m.visible = false;
      m.castShadow = false;
      return m;
    };
    this.heroEnv = makeEnvelope();
    // facing the screen: width along the display, the front toward its normal
    this.mFace.makeBasis(SCREEN_RIGHT, SCREEN_N, new Vector3().crossVectors(SCREEN_RIGHT, SCREEN_N));
    this.qFace.setFromRotationMatrix(this.mFace);

    // a column of light that fades out upward, marking a delivered house from afar
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

    const rand = mulberry32(31);
    const puffCount = opts.low ? 12 : 22;
    this.heroPuff = new LaunchPuff(puffCount, this.flecks, mulberry32(5));
    // scout 1 leaves the screen's right, climbs over the desk on the lamp's side; scout 2 leaves the
    // left, hugs the desk and swings wide; the hero (the Engine's plane) takes the middle, on the path
    const specs = [
      { side0: -0.3, sideRoom: -0.62, side: -0.85, lift: 0.45, arc: 0.3, phase: 0, lead: 0.03 },
      { side0: 0.3, sideRoom: 0.8, side: 0.75, lift: 0.15, arc: -0.08, phase: 2.1, lead: 0.024 },
    ];
    specs.forEach((spec, i) => {
      const plane = new PaperPlane();
      plane.group.visible = false;
      const ringMaterial = new MeshBasicMaterial({
        color: '#6ff2d8', transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false,
      });
      const ring = new Mesh(new RingGeometry(0.5, 0.6, 48), ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      const beamMaterial = new MeshBasicMaterial({
        color: '#6ff2d8', alphaMap: this.beamFade, transparent: true, opacity: 0, depthWrite: false,
        blending: AdditiveBlending, side: DoubleSide, fog: false,
      });
      const beam = new Mesh(this.beamGeometry, beamMaterial);
      beam.visible = false;
      // the contrail: white at the plane, fading to nothing down the line (additive, so black is clear)
      const trailPositions = new Float32Array(TRAIL_POINTS * 3);
      const trailColours = new Float32Array(TRAIL_POINTS * 3);
      for (let k = 0; k < TRAIL_POINTS; k++) trailColours.fill(Math.pow(1 - k / (TRAIL_POINTS - 1), 1.5), k * 3, k * 3 + 3);
      const trailGeometry = new BufferGeometry();
      trailGeometry.setAttribute('position', new BufferAttribute(trailPositions, 3).setUsage(DynamicDrawUsage));
      trailGeometry.setAttribute('color', new BufferAttribute(trailColours, 3));
      const trailMaterial = new LineBasicMaterial({
        vertexColors: true, color: '#cfe8ff', transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false, fog: false,
      });
      const trail = new Line(trailGeometry, trailMaterial);
      trail.frustumCulled = false;
      trail.visible = false;
      const burst = new PaperBurst(rand);
      const env = makeEnvelope();
      const puff = new LaunchPuff(puffCount, this.flecks, mulberry32(11 + i));
      this.group.add(plane.group, env, puff.points, trail, ring, beam, burst.points);
      this.scouts.push({
        plane, burst, ring, ringMaterial, beam, beamMaterial, trail, trailMaterial, trailPositions, release: RELEASE_T[i]!, env, puff, ...spec,
        leg: null, branchT: 1, landT: 1, rest: new Vector3(), chip: new Vector3(),
      });
    });
    this.group.add(this.heroEnv, this.heroPuff.points);

    // the screen's light: a soft halo that swells as each envelope leaves it
    this.glow = new Sprite(new SpriteMaterial({
      map: this.flecks, color: '#8fe3ff', transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, fog: false,
    }));
    this.glow.position.copy(SCREEN).addScaledVector(SCREEN_N, 0.12);
    this.glow.scale.set(2.5, 1.8, 1);
    this.glow.visible = false;
    this.motes = new LaunchMotes(opts.low ? 14 : 32, this.flecks);
    this.group.add(this.glow, this.motes.points);
  }

  /**
   * Where the scout is on the shared airway at line parameter `s`: the hero's spline, offset. It
   * leaves the screen a little to one side, fans out over the room, and by the window and the
   * town is on its own line either side of the hero's.
   */
  private linePos(sc: Scout, s: number, out: Vector3): Vector3 {
    this.path.pointAt(s, out);
    this.path.tangentAt(s, this.tan);
    this.side.crossVectors(this.tan, UP).normalize();
    const fan = MathUtils.smoothstep(s, 0, 0.05);
    const wide = MathUtils.smoothstep(s, 0.055, 0.115);
    const lateral = MathUtils.lerp(MathUtils.lerp(sc.side0, sc.sideRoom, fan), sc.side, wide);
    const up = sc.lift * MathUtils.smoothstep(s, 0.004, 0.04) + sc.arc * Math.sin(Math.PI * MathUtils.smoothstep(s, 0, 0.09));
    return out.addScaledVector(this.side, lateral).addScaledVector(UP, up);
  }

  /** Where the scout stands on the flight line at story-t: out of the laptop, through the room, then ahead of the hero. */
  private param(sc: Scout, t: number): number {
    return launchParam(t, sc.release, JOIN_T + sc.lead);
  }

  /** Position at story-t `t`: along the airway until the branch, then down the glide. */
  private posAt(sc: Scout, t: number, out: Vector3): Vector3 {
    if (!sc.leg || t < sc.branchT) return this.linePos(sc, this.param(sc, t), out);
    const x = MathUtils.clamp((t - sc.branchT) / LEG_T, 0, 1);
    return sc.leg.getPoint(1 - Math.pow(1 - x, 2.2), out);
  }

  /**
   * Where the chase camera is, and what it looks at, at story-t `t` (its rig, without the damping
   * and the gusts): enough to ask whether a spot on the ground is in frame.
   */
  private viewCamera = new PerspectiveCamera(50, 1, 0.1, 400);
  private modelCamera(t: number, aspect: number): PerspectiveCamera {
    const rig = rigParamsAt(t);
    const cam = this.viewCamera;
    this.path.pointAt(Math.max(t - rig.camLag, 0), this.p0);
    this.path.tangentAt(t, this.tan);
    this.side.crossVectors(this.tan, UP).normalize();
    this.p0.addScaledVector(UP, rig.offsetUp).addScaledVector(this.side, rig.offsetSide).addScaledVector(this.tan, -rig.offsetBack);
    cam.position.copy(this.p0);
    this.path.pointAt(Math.min(t + rig.lookAhead, 1), this.p1);
    cam.fov = rig.fov;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    cam.lookAt(this.p1);
    cam.updateMatrixWorld();
    return cam;
  }

  /** How far from the middle of the screen `at` lands at story-t `t`: 0 centre, 1 the edge, Infinity behind. */
  private offCentre(t: number, at: Vector3, aspect: number): number {
    const cam = this.modelCamera(t, aspect);
    this.p2.copy(at).project(cam);
    if (this.p2.z > 1) return Infinity;
    return Math.max(Math.abs(this.p2.x), Math.abs(this.p2.y));
  }

  /**
   * Pick the two landings: the first scout on a house north of the street, the second on one
   * south of it (so they never cross), each chosen at random from the houses that are actually
   * in view of the chase camera as the scout touches down, on the screen the page is shown on
   * (a phone held upright sees less of the street's sides than a desktop window). Each glide is
   * checked against the street trees, the lamps and the houses.
   */
  private plan(sites: TownSites, aspect: number): void {
    this.planned = true;
    const rand = mulberry32((Math.random() * 2 ** 32) >>> 0);
    const sides: (1 | -1)[] = [1, -1];
    interface Option { leg: CubicBezierCurve3; rest: Vector3; branchS: number; hits: number; landT: number; view: number }
    this.scouts.forEach((sc, i) => {
      const toStreet = sides[i]!; // +1: a house north of the street, its front facing +z
      const frontLine = toStreet > 0 ? FRONT_N : FRONT_S;
      const options: Option[] = [];
      for (const house of sites.houses) {
        if (house.x < X_RANGE[0] || house.x > X_RANGE[1] || Math.abs(house.z - STREET_Z) > 11) continue;
        if ((Math.cos(house.yaw) > 0 ? 1 : -1) !== toStreet) continue;
        const wall = house.z + toStreet * house.d / 2;
        const depth = Math.abs(frontLine - wall);
        for (const dx of [-1.6, -0.8, 0, 0.8, 1.6]) {
          const rest = new Vector3(house.x + dx, GROUND + 0.27, wall + toStreet * Math.min(depth * 0.6, 1.5));
          const branchS = this.branchFor(sc, rest.x - LEG_RUN);
          const start = this.linePos(sc, branchS, new Vector3());
          // forward along the street first, then across the verge onto the lawn: the last stretch
          // runs forward and toward the house (-toStreet), coming down at a shallow angle
          const heading = new Vector3(2.5, -0.55, -toStreet * 1.6);
          const leg = new CubicBezierCurve3(
            start,
            start.clone().add(new Vector3(5.2, -0.25, 0)),
            rest.clone().sub(heading).setY(GROUND + 0.75),
            rest,
          );
          const landT = branchS - sc.lead + LEG_T;
          // in frame when it touches down, and still a moment before (it is what the eye follows in)
          const view = Math.max(this.offCentre(landT, rest, aspect), this.offCentre(landT - 0.012, rest, aspect));
          options.push({ leg, rest, branchS, hits: this.countHits(leg, sites, house), landT, view });
        }
      }
      // clear of everything and in frame; failing that, the clear ones nearest the middle of the screen
      let pool = options.filter((o) => o.hits === 0 && o.view < IN_VIEW);
      if (!pool.length) {
        const clear = options.filter((o) => o.hits === 0).sort((a, b) => a.view - b.view);
        pool = clear.slice(0, 3);
      }
      if (!pool.length) pool = options.sort((a, b) => a.hits - b.hits || a.view - b.view).slice(0, 3);
      const pick = pool[Math.floor(rand() * pool.length)];
      if (!pick) return; // no house on this side: this scout stays out of sight
      sc.leg = pick.leg;
      sc.rest.copy(pick.rest);
      sc.chip.copy(pick.rest).setY(GROUND + 2.1);
      sc.branchT = pick.branchS - sc.lead;
      sc.landT = pick.landT;
    });
  }

  /** The line parameter at which the street's centreline has reached world x. */
  private branchFor(sc: Scout, x: number): number {
    let lo = 0.13;
    let hi = 0.24;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      this.linePos(sc, mid, this.tmp);
      if (this.tmp.x < x) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** How many samples of the glide are inside a tree crown, a house or a lamp pole. */
  private countHits(leg: CubicBezierCurve3, sites: TownSites, target: TownSite): number {
    let hits = 0;
    const cell = HOME_CELL.w;
    for (let i = 0; i <= 28; i++) {
      leg.getPoint(i / 28, this.p2);
      const { x, y, z } = this.p2;
      for (const tr of sites.trees) {
        if (Math.abs(tr.x - x) > 4 || Math.abs(tr.z - z) > 4) continue;
        const r = Math.max(tr.w, tr.d) * 0.42 + 0.55;
        if (Math.hypot(tr.x - x, tr.z - z) < r && y < GROUND + tr.h * 0.95) hits++;
      }
      for (const h of sites.houses) {
        if (Math.abs(h.x - x) > h.w && Math.abs(h.z - z) > h.d) continue;
        if (h === target && i > 24) continue; // the last strokes of the approach stand in front of its wall
        if (Math.abs(h.x - x) < h.w / 2 + 0.3 && Math.abs(h.z - z) < h.d / 2 + 0.3 && y < GROUND + h.h + 0.3) hits++;
      }
      for (const lx of LAMP_X) {
        const dx = ((x - lx) % cell + cell) % cell;
        if ((Math.min(dx, cell - dx) < 0.9) && (Math.abs(z - 10.55) < 0.9 || Math.abs(z - 15.45) < 0.9) && y < GROUND + 4.2) hits++;
      }
    }
    return hits;
  }

  /** Both scouts' houses, once planned: for the HUD pins and for tests. */
  get landings(): { at: Vector3; t: number }[] {
    return this.scouts.filter((s) => s.leg).map((s) => ({ at: s.rest, t: s.landT }));
  }

  /** What the HUD shows at story-t `t`: the count, and a tag on each scout (in flight, then landed). */
  state(t: number): {
    visible: boolean;
    sent: number;
    delivered: number;
    chips: { anchor: Vector3; shown: boolean; mode: 'flying' | 'landed'; label: string }[];
  } {
    const sent = RELEASE_T.filter((r) => t >= r).length;
    const delivered = this.scouts.filter((s) => s.leg && t >= s.landT).length;
    const last = Math.max(...this.scouts.map((s) => (s.leg ? s.landT : 0)), 0.19);
    const hideAt = Math.max(last + 0.05, 0.22);
    return {
      visible: t > 0.0005 && t < hideAt,
      sent,
      delivered,
      chips: this.scouts.map((s, i) => {
        const landed = !!s.leg && t >= s.landT;
        return {
          anchor: s.chip,
          // tagged from the window on: at the desk they are the whole frame and need no label
          shown: !!s.leg && t >= TAG_FROM && t < hideAt,
          mode: landed ? 'landed' : 'flying',
          label: `Plane ${i + 1}`,
        };
      }),
    };
  }

  update(t: number, time: number, sites: TownSites | null, aspect = 16 / 9): void {
    if (sites && !this.planned) this.plan(sites, aspect);
    this.group.visible = t < FADE_TO;
    if (!this.group.visible) { this.prevT = t; return; }

    const fade = 1 - MathUtils.smoothstep(t, FADE_FROM, FADE_TO);
    const calm = this.opts.calm;
    const grown = planeScale(t);
    this.updateRoom(t, time, calm);
    for (const sc of this.scouts) {
      const tau = t - sc.release;
      // on stage from the envelope's release; a scout with no house to land at leaves quietly at the town
      const stray = this.planned && !sc.leg;
      const on = tau >= 0 && (!stray || t < 0.15);
      sc.plane.group.visible = on && tau >= STAGE.openFrom;
      sc.env.visible = on && tau < STAGE.openTo;
      // landing ping, and the paper-scrap burst the moment it touches down
      const ping = sc.leg ? (t - sc.landT) / 0.022 : -1;
      sc.ring.visible = ping >= 0 && ping <= 1;
      if (sc.ring.visible) {
        sc.ring.position.set(sc.rest.x, GROUND + 0.08, sc.rest.z);
        sc.ring.scale.setScalar(0.6 + ping * 4.2);
        sc.ringMaterial.opacity = 0.9 * (1 - ping) * (1 - ping);
      }
      // and the column of light that stays up over the house it was delivered to
      const up = sc.leg ? MathUtils.smoothstep(t, sc.landT, sc.landT + 0.012) : 0;
      sc.beam.visible = up > 0.01 && fade > 0.01;
      if (sc.beam.visible) {
        const h = 7 * up;
        sc.beam.scale.set(1 + 0.15 * Math.sin(time * 3 + sc.side), h, 1 + 0.15 * Math.sin(time * 3 + sc.side));
        sc.beam.position.set(sc.rest.x, GROUND + h / 2, sc.rest.z);
        sc.beamMaterial.opacity = 0.5 * fade * (0.85 + 0.15 * Math.sin(time * 4 + sc.side * 2));
      }
      if (sc.leg && this.prevT < sc.landT && t >= sc.landT) sc.burst.trigger(sc.rest, time);
      sc.burst.update(time);
      // the little puffs where the envelope opens and where the last crease goes in
      this.puff(sc.puff, tau, t, (tt, out) => this.posAt(sc, tt, out), sc.release, calm);
      if (!on) { sc.trail.visible = false; continue; }

      this.posAt(sc, t, this.p0);
      sc.plane.group.position.copy(this.p0);
      // the HUD tag rides above it while it flies, and stays over the house once it has landed
      if (t < sc.landT) sc.chip.copy(this.p0).y += 1.0;
      else sc.chip.copy(sc.rest).setY(GROUND + 2.1);

      // the contrail, sampled back along where it has been; it fades away once it has landed
      const base = Math.min(t, sc.landT);
      for (let k = 0; k < TRAIL_POINTS; k++) {
        this.posAt(sc, Math.max(base - k * TRAIL_STEP * (1 - (1 - ROOM_TRAIL) * (1 - MathUtils.smoothstep(base, JOIN_T, JOIN_T + 0.03))), sc.release), this.p1);
        sc.trailPositions[k * 3] = this.p1.x;
        sc.trailPositions[k * 3 + 1] = this.p1.y;
        sc.trailPositions[k * 3 + 2] = this.p1.z;
      }
      sc.trail.geometry.attributes.position!.needsUpdate = true;
      const lit = MathUtils.smoothstep(tau, STAGE.openFrom, STAGE.openTo + 0.004);
      sc.trailMaterial.opacity = 0.8 * fade * lit * (1 - MathUtils.smoothstep(t, sc.landT, sc.landT + 0.012));
      sc.trail.visible = sc.trailMaterial.opacity > 0.01;

      // heading from where it is about to be; bank from how fast that heading turns. After
      // landing the attitude is frozen at its last flying value.
      const tt = Math.min(Math.max(t, sc.release), sc.landT - 0.002);
      this.posAt(sc, tt, this.p0);
      this.posAt(sc, tt + 0.0015, this.p1);
      this.tan.subVectors(this.p1, this.p0).normalize();
      this.posAt(sc, tt + 0.0045, this.p2);
      this.tan2.subVectors(this.p2, this.p1).normalize();
      const turn = this.tan.x * this.tan2.z - this.tan.z * this.tan2.x;
      const landing = sc.leg ? MathUtils.smoothstep(t, sc.landT - LEG_T * 0.3, sc.landT) : 0;
      // a gentle sway in the room, settling as it joins the airway (none when calm)
      const { pitch, sway } = launchAttitude(tau, t, sc.phase, calm);
      const roll = MathUtils.clamp(turn * 9, -0.8, 0.8) * (1 - landing * 0.85) + landing * 0.1 + sway;
      this.m4.lookAt(this.p1.copy(this.p0).add(this.tan), this.p0, UP);
      this.qBase.setFromRotationMatrix(this.m4);
      this.qRoll.setFromAxisAngle(this.tan, roll);
      // the letter climbs nose-up as it opens, and levels out as it folds into the dart
      const fold = MathUtils.smoothstep(tau, STAGE.foldFrom, STAGE.foldTo);
      const open = MathUtils.smoothstep(tau, STAGE.openFrom, STAGE.openTo);
      // the flare: nose up just before it touches, settling flat as it stops
      const flare = MathUtils.smoothstep(t, sc.landT - LEG_T * 0.35, sc.landT - 0.004) * (1 - MathUtils.smoothstep(t, sc.landT - 0.004, sc.landT + 0.004));
      this.qPitch.setFromAxisAngle(X_AXIS, -0.3 * flare + pitch);
      sc.plane.group.quaternion.copy(this.qRoll).multiply(this.qBase).multiply(this.qPitch);
      sc.plane.group.scale.setScalar(Math.max(SCALE * grown * (0.45 + 0.55 * open) * fade * (stray ? 1 - MathUtils.smoothstep(t, 0.13, 0.15) : 1), 1e-4));
      sc.plane.setFold(fold);
      sc.plane.flex(time + sc.side * 3, t < sc.landT ? 1 : 0);

      // the envelope: facing the screen as it pops out, turning flat as the letter slides out of it
      if (sc.env.visible) {
        sc.env.position.copy(sc.plane.group.position);
        sc.env.quaternion.copy(this.qFace).slerp(this.qBase, MathUtils.smoothstep(tau, 0.002, STAGE.openTo));
        sc.env.scale.setScalar(ENVELOPE_SCALE * (0.15 + 0.85 * MathUtils.smoothstep(tau, 0, STAGE.pop)) * (1 - open) + 1e-4);
      }
    }
    this.updateHero(t, calm);
    this.prevT = t;
  }

  /** The hero's envelope (the Engine owns its dart) and its puffs: it is on the main path itself. */
  private updateHero(t: number, calm: boolean): void {
    const tau = t - HERO_RELEASE;
    const on = tau >= 0 && tau < STAGE.openTo;
    this.heroEnv.visible = on;
    const heroAt = (tt: number, out: Vector3): Vector3 => this.path.pointAt(heroParam(tt), out);
    this.puff(this.heroPuff, tau, t, heroAt, HERO_RELEASE, calm);
    if (!on) return;
    heroAt(t, this.p0);
    this.heroEnv.position.copy(this.p0);
    this.path.tangentAt(heroParam(t), this.tan);
    this.m4.lookAt(this.p1.copy(this.p0).add(this.tan), this.p0, UP);
    this.qBase.setFromRotationMatrix(this.m4);
    const open = MathUtils.smoothstep(tau, STAGE.openFrom, STAGE.openTo);
    this.heroEnv.quaternion.copy(this.qFace).slerp(this.qBase, MathUtils.smoothstep(tau, 0.002, STAGE.openTo));
    this.heroEnv.scale.setScalar(ENVELOPE_SCALE * (0.15 + 0.85 * MathUtils.smoothstep(tau, 0, STAGE.pop)) * (1 - open) + 1e-4);
  }

  /** Drives one plane's puff of flecks: nothing when calm (the folds still happen, quietly). */
  private puff(
    puff: LaunchPuff, tau: number, t: number, at: (t: number, out: Vector3) => Vector3, release: number, calm: boolean,
  ): void {
    if (calm || tau < STAGE.openFrom || tau > STAGE.puff + PUFF_LIFE + 0.002) {
      puff.points.visible = false;
      return;
    }
    const ta = release + STAGE.openFrom + 0.001;
    const tb = release + STAGE.puff;
    at(ta, this.pA);
    at(tb, this.pB);
    puff.update(t, this.pA, ta, this.pB, tb);
  }

  /** The room's light at the launch: the screen's halo swells with each release, and the motes turn in the lamp's beam. */
  private updateRoom(t: number, time: number, calm: boolean): void {
    const pulse = launchPulse(t);
    this.glow.visible = pulse > 0.01;
    if (this.glow.visible) (this.glow.material as SpriteMaterial).opacity = (calm ? 0.08 : 0.26) * pulse;
    this.motes.points.visible = t < 0.14;
    if (this.motes.points.visible) this.motes.update(time, !calm);
  }

  dispose(): void {
    for (const sc of this.scouts) {
      sc.plane.dispose();
      sc.puff.dispose();
      sc.burst.dispose();
      sc.ring.geometry.dispose();
      sc.ringMaterial.dispose();
      sc.beamMaterial.dispose();
      sc.trail.geometry.dispose();
      sc.trailMaterial.dispose();
    }
    this.beamGeometry.dispose();
    this.beamFade.dispose();
    this.heroPuff.dispose();
    this.motes.dispose();
    (this.glow.material as SpriteMaterial).dispose();
    this.flecks.dispose();
    this.envGeometry.dispose();
    this.envFaces.front.dispose();
    this.envFaces.back.dispose();
    for (const m of this.envMaterials) m.dispose();
  }
}
