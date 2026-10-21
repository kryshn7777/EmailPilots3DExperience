import {
  AdditiveBlending,
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
  PerspectiveCamera,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';
import { HOME_CELL, ROOFTOP_BASE_Y } from '../bake/cityGen.mjs';
import { rigParamsAt } from '../../story/chapters';
import type { FlightPath } from '../rig/FlightPath';
import { mulberry32 } from '../util';
import { PaperBurst } from './PaperBurst';
import { PaperPlane } from './PaperPlane';
import type { TownSite, TownSites } from './Rooftops';

/** the mail-merge the story sends: "Email Pilots · batch sending 3/42" */
export const BATCH_TOTAL = 42;
/**
 * Story-t at which each of the three planes leaves the laptop screen: two scouts, then the hero
 * the camera follows. The hero's own appearance (Engine) is the third.
 */
export const RELEASE_T = [0.001, 0.0065, 0.012] as const;

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
/** the horizontal run before the house at which a scout leaves the street */
const LEG_RUN = 9.5;
/** which houses are candidates: along the street from the yards behind it to a few lots ahead */
const X_RANGE: [number, number] = [22, 50];
/** a landing must project inside this fraction of the half-screen (1 = the very edge) to count as in view */
const IN_VIEW = 0.8;

const FADE_FROM = 0.27;
const FADE_TO = 0.3;
const SCALE = 1.05;
const GROUND = ROOFTOP_BASE_Y;
const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);

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
  /** offset off the hero's line, in the street's width, and above it */
  side: number;
  lift: number;
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

  constructor(private path: FlightPath) {
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
    const specs = [
      { side: -0.85, lift: 0.45, lead: 0.03 },
      { side: 0.75, lift: 0.15, lead: 0.024 },
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
      this.group.add(plane.group, trail, ring, beam, burst.points);
      this.scouts.push({
        plane, burst, ring, ringMaterial, beam, beamMaterial, trail, trailMaterial, trailPositions, release: RELEASE_T[i]!, ...spec,
        leg: null, branchT: 1, landT: 1, rest: new Vector3(), chip: new Vector3(),
      });
    });
  }

  /** Where the scout is on the shared airway at line parameter `s`: the hero's spline, offset. */
  private linePos(sc: Scout, s: number, out: Vector3): Vector3 {
    const w = MathUtils.smoothstep(s, 0.004, 0.04);
    this.path.pointAt(s, out);
    this.path.tangentAt(s, this.tan);
    this.side.crossVectors(this.tan, UP).normalize();
    return out.addScaledVector(this.side, sc.side * w).addScaledVector(UP, sc.lift * w);
  }

  /** Position at story-t `t`: along the airway until the branch, then down the glide. */
  private posAt(sc: Scout, t: number, out: Vector3): Vector3 {
    if (!sc.leg || t < sc.branchT) {
      // the lead builds over the first stretch (out of the laptop, across the desk, out of the window)
      // and is held from there to the street, so the scouts are well ahead of the camera's plane
      const x = MathUtils.clamp((t - sc.release) / Math.max((sc.branchT - sc.release) * 0.4, 1e-3), 0, 1);
      const lead = sc.leg ? sc.lead * MathUtils.smoothstep(x, 0, 1) : 0;
      return this.linePos(sc, t + lead, out);
    }
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
    for (const sc of this.scouts) {
      const live = !!sc.leg && t >= sc.release;
      sc.plane.group.visible = live;
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
      if (!live) { sc.trail.visible = false; continue; }

      this.posAt(sc, t, this.p0);
      sc.plane.group.position.copy(this.p0);
      // the HUD tag rides above it while it flies, and stays over the house once it has landed
      if (t < sc.landT) sc.chip.copy(this.p0).y += 1.0;
      else sc.chip.copy(sc.rest).setY(GROUND + 2.1);

      // the contrail, sampled back along where it has been; it fades away once it has landed
      const base = Math.min(t, sc.landT);
      for (let k = 0; k < TRAIL_POINTS; k++) {
        this.posAt(sc, Math.max(base - k * TRAIL_STEP, sc.release), this.p1);
        sc.trailPositions[k * 3] = this.p1.x;
        sc.trailPositions[k * 3 + 1] = this.p1.y;
        sc.trailPositions[k * 3 + 2] = this.p1.z;
      }
      sc.trail.geometry.attributes.position!.needsUpdate = true;
      sc.trailMaterial.opacity = 0.8 * fade * (1 - MathUtils.smoothstep(t, sc.landT, sc.landT + 0.012));
      sc.trail.visible = sc.trailMaterial.opacity > 0.01;

      // heading from where it is about to be; bank from how fast that heading turns. After
      // landing the attitude is frozen at its last flying value.
      const tt = Math.min(t, sc.landT - 0.002);
      this.posAt(sc, tt, this.p0);
      this.posAt(sc, tt + 0.0015, this.p1);
      this.tan.subVectors(this.p1, this.p0).normalize();
      this.posAt(sc, tt + 0.0045, this.p2);
      this.tan2.subVectors(this.p2, this.p1).normalize();
      const turn = this.tan.x * this.tan2.z - this.tan.z * this.tan2.x;
      const landing = sc.leg ? MathUtils.smoothstep(t, sc.landT - LEG_T * 0.3, sc.landT) : 0;
      const roll = MathUtils.clamp(turn * 9, -0.8, 0.8) * (1 - landing * 0.85) + landing * 0.1;
      this.m4.lookAt(this.p1.copy(this.p0).add(this.tan), this.p0, UP);
      this.qBase.setFromRotationMatrix(this.m4);
      this.qRoll.setFromAxisAngle(this.tan, roll);
      // the flare: nose up just before it touches, settling flat as it stops
      const flare = MathUtils.smoothstep(t, sc.landT - LEG_T * 0.35, sc.landT - 0.004) * (1 - MathUtils.smoothstep(t, sc.landT - 0.004, sc.landT + 0.004));
      this.qPitch.setFromAxisAngle(X_AXIS, -0.3 * flare);
      sc.plane.group.quaternion.copy(this.qRoll).multiply(this.qBase).multiply(this.qPitch);

      const grow = MathUtils.smoothstep(t, sc.release, sc.release + 0.005);
      sc.plane.group.scale.setScalar(Math.max(SCALE * grow * fade, 1e-4));
      sc.plane.setFold(MathUtils.smoothstep(t, sc.release, sc.release + 0.014));
      sc.plane.flex(time + sc.side * 3, t < sc.landT ? 1 : 0);
    }
    this.prevT = t;
  }

  dispose(): void {
    for (const sc of this.scouts) {
      sc.plane.dispose();
      sc.burst.dispose();
      sc.ring.geometry.dispose();
      sc.ringMaterial.dispose();
      sc.beamMaterial.dispose();
      sc.trail.geometry.dispose();
      sc.trailMaterial.dispose();
    }
    this.beamGeometry.dispose();
    this.beamFade.dispose();
  }
}
