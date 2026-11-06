import { MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import { rigParamsAt, type RigParams } from '../../story/chapters';
import type { FlightPath } from './FlightPath';
import { HERO_RELEASE, heroParam, launchAttitude } from './launch';
import { studyShot } from './studyShot';
import { endingPose, type EndingPose } from './endingShot';
import { DETOUR_TIMING, DETOUR_TOWER, HANDOFF } from './pathPoints.mjs';
import type { PaperPlane } from '../actors/PaperPlane';

/** the story-t the dart reaches the tower's west face, and leaves its east face (pathPoints.mjs) */
const AT_GLASS = DETOUR_TIMING.T_S + DETOUR_TIMING.cutIn * DETOUR_TIMING.D_T;
const OUT_GLASS = DETOUR_TIMING.T_S + DETOUR_TIMING.cutOut * DETOUR_TIMING.D_T;

const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const DEG = Math.PI / 180;

/**
 * A directed moment laid over the chase camera, keyed to story-t so a scrub always lands on the
 * same frame. `at` is [fade in from, full by, full until, faded out by].
 */
interface Beat {
  id: string;
  at: [number, number, number, number];
  /** focal change at full weight, as a multiplier on the chapter's fov (< 1 pushes in) */
  fov?: number;
  /**
   * Hold: the camera stops where the chase cam stands at this story-t (plus `nudge`, world units)
   * and pans to follow the dart, which flies away from it — then catches up as the beat fades.
   */
  hold?: number;
  nudge?: [number, number, number];
  /** or hold at a fixed world position (the window, the runway edge) */
  holdAt?: [number, number, number];
  /** letterbox bars, 0..1 */
  bars?: number;
  /** dutch tilt in degrees */
  dutch?: number;
  /** background defocus in pixels (at 720 lines) */
  bokeh?: number;
  /** the chase camera's lag, as a multiplier on the chapter's at full weight (< 1 rides closer) */
  lag?: number;
  /** the chase camera's side offset and how far ahead it looks, as multipliers on the chapter's at full weight */
  side?: number;
  ahead?: number;
  /**
   * With `holdAt`: the held camera dollies along after the dart, by this share of how far the dart has flown since
   * the beat began (0 holds still, 1 keeps pace), so letting go of it is a short move, not a lunge.
   */
  follow?: number;
  /** the story-t the following starts from (default: the beat's start) */
  followFrom?: number;
}

/** how far either side (story-t) the chase camera's frame averages the line's heading from the canyon to H */
const CHASE_SMOOTH = 0.005;
/** how long (story-t) a following hold takes to come up to its share of the dart's speed */
const FOLLOW_EASE = 0.025;
/** the hand-off onto the ending's line (pathPoints.mjs), where the line's speed per unit of story-t steps up */
const HAND_T = HANDOFF.t;

/**
 * Off the tower's far face, where the camera waits for the dart to burst out (see the 'burst' beat): north of the
 * tower over the canyon, short of its east face and a little above the exit, so the lens still looks the way the
 * dart flies (under 30 degrees off it) and the dart comes out past the tower's corner in front of it.
 */
const BURST_CAM: [number, number, number] = [
  DETOUR_TOWER.x + DETOUR_TOWER.hx - 8.5,
  DETOUR_TOWER.entryY + 2.3,
  DETOUR_TOWER.z + DETOUR_TOWER.hz + 4.1,
];

/**
 * The shot list. Everything here is additive to the per-chapter rig in story/chapters.ts.
 */
const BEATS: Beat[] = [
  // the opening is matted like a title sequence; the bars open as the dart drops into the town
  { id: 'title', at: [0, 0, 0.11, 0.15], bars: 0.8 },
  // the launch (studyShot.ts carries the camera): a longer lens close on the laptop screen with the
  // room soft behind it, easing open as the three planes cross the desk to the window
  { id: 'launch', at: [0, 0, 0.05, 0.092], fov: 0.9, bokeh: 3.2 },
  // out of the window: the camera stops in the opening and pans to watch the dart drop away over
  // the yards, then follows it out (the release flies the lens out through the same opening)
  { id: 'window', at: [0.086, 0.098, 0.112, 0.15], holdAt: [6.5, 2.85, 0.9], fov: 0.92 },
  // down the street: a wider lens, with a little dutch as it threads the lamps
  { id: 'street', at: [0.165, 0.178, 0.195, 0.206], fov: 1.06, dutch: -2.5 },
  // the pull-up: the camera stays down in the street and watches the dart climb away into the sky
  { id: 'climb', at: [0.198, 0.21, 0.222, 0.252], hold: 0.205, fov: 0.84, bars: 0.6 },
  // into the cloud sea: a held breath as the deck swallows the dart
  { id: 'clouds', at: [0.25, 0.262, 0.272, 0.29], fov: 0.9, bars: 0.4, bokeh: 1.2 },
  // the storm: wide and matted, rolling with the weather
  { id: 'storm', at: [0.37, 0.39, 0.45, 0.48], bars: 0.55, fov: 1.04 },
  // the lighthouse: an establishing wide on the approach, then the Engine's held shot of the
  // delivery (rig.shot) with the frame matted and the lantern isolated against the sea
  { id: 'beacon-wide', at: [0.478, 0.488, 0.5, 0.514], fov: 1.1 },
  { id: 'delivery', at: [0.505, 0.518, 0.566, 0.585], bars: 1, bokeh: 2.2, fov: 0.92 },
  // the dive into the city: the frame tilts into the drop (the lens holds: widening it shrank the towers)
  { id: 'dive', at: [0.655, 0.668, 0.69, 0.715], dutch: 4, bars: 0.6 },
  // the canyon floor: low over the wet street, leaning the other way
  { id: 'canyon', at: [0.7, 0.715, 0.73, 0.745], dutch: -2 },
  // the push to the glass: the camera closes in behind the dart and the lens tightens, the lit facade filling the
  // frame as the dart reaches it (the cut into the office is at AT_GLASS, under the flare)
  // (straight behind it, not out to the side as the copilot's chase rides, and looking at the dart and the glass
  // just past it, not into the tower: on a phone the dart was out at the frame's edge)
  { id: 'glass', at: [0.758, 0.784, AT_GLASS, AT_GLASS], lag: 0.82, side: 0.2, ahead: 0.35, fov: 0.88, bars: 0.35 },
  // out of the far face: after the cut the camera is off the tower's north side (BURST_CAM) and watches the dart
  // burst out past the corner, shards first; it holds still while the dart bursts out slowly, sets off after it
  // as the dart picks up the line's speed (at the end of the detour), and settles into the chase well clear of the
  // tower
  { id: 'burst', at: [OUT_GLASS, OUT_GLASS, 0.814, 0.866], holdAt: BURST_CAM, follow: 1, followFrom: OUT_GLASS + 0.004, fov: 0.92, bars: 0.35 },
];

function beatWeight(b: Beat, t: number): number {
  const [a, b0, b1, c] = b.at;
  const rise = b0 > a ? MathUtils.smoothstep(t, a, b0) : t >= a ? 1 : 0;
  const fall = c > b1 ? 1 - MathUtils.smoothstep(t, b1, c) : t <= b1 ? 1 : 0;
  return rise * fall;
}

/** What the camera asks of the screen effects this frame (post/Cinema.ts reads it). */
export interface CineState {
  /** 0..1 letterbox */
  bars: number;
  /** background defocus radius, pixels at 720 lines */
  bokeh: number;
  /** distance from the lens to the subject, world units */
  focus: number;
}

export interface CameraRigOptions {
  /** no rolls, kicks or focal punches; holds and bars stay (they only take motion away) */
  reducedMotion: boolean;
}

/**
 * Follows the flight path: plane leads with banking + turbulence, camera
 * trails at a chapter-tuned lag with a damped look target that leads the
 * plane. Per-chapter tuning comes from story/chapters.ts; the directed beats
 * (holds, push-ins, dutch angles, letterbox) are the BEATS list above.
 */
export class CameraRig {
  /** world-space state exposed for actors that fly relative to the plane */
  readonly planeWorldPos = new Vector3();
  readonly currentTangent = new Vector3(0, 0, 1);
  readonly currentSide = new Vector3(1, 0, 0);

  /**
   * A held shot laid over the follow camera: `weight` 0 is the chase cam, 1 is `position`
   * looking at `look`. The Engine drives it for beats that need the camera to stay outside
   * something the dart flies through (the lighthouse lantern).
   */
  readonly shot = { weight: 0, position: new Vector3(), look: new Vector3() };

  /** what the lens asks of the screen effects (letterbox, focus), read by the Engine */
  readonly cine: CineState = { bars: 0, bokeh: 0, focus: 4 };

  /** a jolt to the camera, 0..1 (the Engine feeds it the storm's lightning) */
  jolt = 0;

  // --- scroll feel ---
  /**
   * How fast the flight is going for the eye, 0..1 (the Engine: smoothstep of the dart's speed over
   * the camera's height, faded out by the detour's weight). A little wider lens and a little more air
   * at speed. 0 under reduced motion.
   */
  speed = 0;
  /** 0..1: the scroll has been at rest a while (the Engine eases it in): the camera breathes */
  rest = 0;
  private turnLP = 0;
  // --- end scroll feel ---

  // --- office detour (rig/detour.ts, rig/officeShot.ts): laid over everything else, last ---
  /**
   * The office detour's own camera and dart, blended in by `weight` (0 at both ends of the detour,
   * so the frame there IS this rig's). The main rig's dart pose is kept in `mainPlanePos/Quat`.
   */
  readonly detour = {
    weight: 0,
    camPos: new Vector3(), look: new Vector3(), fov: 45, roll: 0,
    planePos: new Vector3(), planeQuat: new Quaternion(),
    mainPlanePos: new Vector3(), mainPlaneQuat: new Quaternion(),
  };

  /**
   * The main rig's pose at story-t `t` with no turbulence, damping or roll: the chase cam (with the beats' lag and
   * lens changes) and the ending's own camera; with `holds`, the beats' held shots too (not the study's shot over
   * the desk, nor the lighthouse's held shot, which the Engine lays on). Returns the fov. Pure in t (the pace
   * measures the chase without the holds, as it always has; check-line measures both).
   */
  mainPose(t: number, pos: Vector3, look: Vector3, holds = false): number {
    const rig = this.beatRig(t);
    this.chasePosition(t, rig, pos);
    this.path.pointAt(Math.min(this.along(t, rig.lookAhead), 1), look);
    look.y += rig.lookUp ?? 0;
    let fovMul = 1;
    let holdW = 0;
    for (const beat of BEATS) {
      const w = beatWeight(beat, t);
      if (w <= 0) continue;
      if (beat.fov !== undefined) fovMul *= 1 + (beat.fov - 1) * w;
      if (holds && (beat.hold !== undefined || beat.holdAt) && w > holdW) {
        holdW = w;
        if (beat.holdAt) this.poseHold.fromArray(beat.holdAt);
        else this.chasePosition(beat.hold!, rigParamsAt(beat.hold!), this.poseHold);
        if (beat.nudge) this.poseHold.add(this.tA.fromArray(beat.nudge));
        if (beat.holdAt && beat.follow) this.followDart(beat, t, this.poseHold);
      }
    }
    const hold = holdW * holdW * (3 - 2 * holdW);
    if (hold > 0) {
      pos.lerp(this.poseHold, hold);
      look.lerp(this.path.pointAt(t, this.tB), hold);
    }
    let fov = rig.fov * (this.options.reducedMotion ? 1 : fovMul);
    const e = endingPose(t, this.camera.aspect, this.poseEnding);
    if (e.weight > 0) {
      pos.lerp(e.camPos, e.weight);
      look.lerp(e.look, e.weight);
      fov = MathUtils.lerp(fov, e.fov, e.weight);
    }
    return fov;
  }
  private poseHold = new Vector3();
  private poseEnding: EndingPose = { weight: 0, camPos: new Vector3(), look: new Vector3(), fov: 40, roll: 0 };
  // --- end office detour ---

  /** the ending's own camera this frame (rig/endingShot.ts, owned by the ending), laid over everything last */
  readonly ending: EndingPose = { weight: 0, camPos: new Vector3(), look: new Vector3(), fov: 40, roll: 0, bars: 0 };

  /**
   * A following hold: moved on by `follow` x the dart's way since `followFrom` (the beat's start by default), the
   * share easing in over 0.01 of story-t so the camera sets off without a jolt (pure in t).
   */
  private followDart(beat: Beat, t: number, out: Vector3): void {
    const from = beat.followFrom ?? beat.at[0];
    if (t <= from) return;
    // the camera's velocity is the share times the dart's: sum the share over the dart's way, step by step (the
    // share of the way so far, not of the whole way, or the camera lunges as the share grows)
    const steps = 16;
    this.path.pointAt(from, this.tFollowB);
    for (let i = 1; i <= steps; i++) {
      const s = from + ((t - from) * i) / steps;
      this.path.pointAt(s, this.tFollowA);
      const share = beat.follow! * MathUtils.smoothstep(s - (t - from) / (2 * steps), from, from + FOLLOW_EASE);
      out.addScaledVector(this.tFollowB.sub(this.tFollowA).negate(), share);
      this.tFollowB.copy(this.tFollowA);
    }
  }
  private tFollowA = new Vector3();
  private tFollowB = new Vector3();

  /** the chapter's rig at t with the beats' changes to it (the chase camera's lag), in a scratch object */
  private beatRig(t: number): RigParams {
    const s = this.rigScratch;
    s.dutch = 0;
    s.bank = 0;
    s.lookUp = 0;
    const rig = Object.assign(s, rigParamsAt(t));
    let lag = 1;
    let side = 1;
    let ahead = 1;
    for (const beat of BEATS) {
      if (beat.lag === undefined && beat.side === undefined && beat.ahead === undefined) continue;
      const w = beatWeight(beat, t);
      if (w <= 0) continue;
      if (beat.lag !== undefined) lag *= 1 + (beat.lag - 1) * w;
      if (beat.side !== undefined) side *= 1 + (beat.side - 1) * w;
      if (beat.ahead !== undefined) ahead *= 1 + (beat.ahead - 1) * w;
    }
    rig.camLag *= lag;
    rig.offsetSide *= side;
    rig.lookAhead *= ahead;
    return rig;
  }
  private rigScratch: RigParams = { fov: 45, camLag: 0, lookAhead: 0, turbAmp: 0, offsetUp: 0, offsetSide: 0, offsetBack: 0 };

  private noise = new ImprovedNoise();
  private roll = 0;
  private camRoll = 0;
  private fovTarget = 45;
  private lookTarget = new Vector3();
  private lookInitialized = false;

  // scratch
  private planePos = new Vector3();
  private tangent = new Vector3();
  private prevTangent = new Vector3();
  private camPos = new Vector3();
  private holdPos = new Vector3();
  private side = new Vector3();
  private lookAtPoint = new Vector3();
  private lookMatrix = new Matrix4();
  private baseQuat = new Quaternion();
  private rollQuat = new Quaternion();
  private tA = new Vector3();
  private tB = new Vector3();
  private tSmooth = new Vector3();
  private sideScratch = new Vector3();
  private planeScratch = new Vector3();
  private studyPos = new Vector3();
  private studyLook = new Vector3();
  private qLaunch = new Quaternion();

  constructor(
    private path: FlightPath,
    private camera: PerspectiveCamera,
    private plane: PaperPlane,
    private options: CameraRigOptions = { reducedMotion: false },
  ) {}

  /** the line's speed per unit t just after the hand-off over just before it (lazily: the path is a parameter) */
  private handK = 0;
  /**
   * The story-t at the distance a lag or look-ahead `d` (story-t, at the copilot's speed) reaches from `t`: t + d
   * everywhere but across the hand-off. The ending's line is about four times as fast per unit of story-t as the
   * copilot's (FlightPath: a step in its speed at H; the pace warp gives the ending as many more pixels per unit t,
   * so the dart's speed per pixel carries straight across), and an offset in story-t that crossed H would stretch to
   * four times its distance within a few pixels: the chase would drop back, and the look run on, in a jerk. Measured
   * at the copilot's speed the chase stays the same distance behind the dart, and looks the same distance ahead.
   */
  private along(t: number, d: number): number {
    const k = this.handK || (this.handK = this.path.speedAt(HAND_T + 1e-3) / Math.max(this.path.speedAt(HAND_T - 1e-3), 1e-6));
    const u = t <= HAND_T ? t : HAND_T + (t - HAND_T) * k;
    const v = u + d;
    return v <= HAND_T ? v : HAND_T + (v - HAND_T) / k;
  }

  /**
   * Where the chase camera stands for story-t `t`, with no turbulence: the chapter's lag and
   * offsets, kept a minimum distance off the dart. Pure in t, so a held shot can ask where the
   * camera WAS and stay there.
   */
  private chasePosition(t: number, rig: RigParams, out: Vector3): Vector3 {
    const planePos = this.path.pointAt(t, this.planeScratch);
    const tangent = this.path.tangentAt(t, this.tA);
    // From the canyon to the hand-off the camera's frame follows the line's heading over a few units, not its
    // instant one: the climb out of the street eases its heading and pitch onto the tower's line within a couple of
    // units, and a chase camera hung off the instant tangent swung its side and back offsets with it (a jerk).
    const k = CHASE_SMOOTH * MathUtils.smoothstep(t, 0.7, 0.72) * (1 - MathUtils.smoothstep(t, 0.86, 0.88));
    if (k > 0) {
      tangent.add(this.path.tangentAt(Math.max(t - k, 0), this.tSmooth));
      tangent.add(this.path.tangentAt(Math.min(t + k, 1), this.tSmooth)).normalize();
    }
    const side = this.sideScratch.crossVectors(tangent, UP).normalize();
    this.path.pointAt(Math.max(this.along(t, -rig.camLag), 0), out);
    out.addScaledVector(UP, rig.offsetUp);
    out.addScaledVector(side, rig.offsetSide);
    out.addScaledVector(tangent, -rig.offsetBack);
    // distance floor: when a chapter blend swings offsetBack through zero
    // (CH1's reverse angle → CH2's chase), the raw lerp would drag the camera
    // through the plane — clamp to an orbit around it instead
    const dist = out.distanceTo(planePos);
    // 3.4 through the CH1→CH2 swing (the 1.6-long dart fills the frame under
    // that); a small 1.2 safety net everywhere else
    const MIN_CAM_DIST = t < 0.105 ? 3.4 : 1.2;
    if (dist < MIN_CAM_DIST) {
      out.sub(planePos).multiplyScalar(MIN_CAM_DIST / Math.max(dist, 1e-4)).add(planePos);
    }
    return out;
  }

  /**
   * How hard the flight line is turning at t, as a signed yaw over a short window of story-t:
   * the camera banks with it. Pure in t, so it never depends on how fast someone scrolls.
   */
  private pathTurn(t: number): number {
    const a = this.path.tangentAt(Math.max(t - 0.004, 0), this.tA);
    const b = this.path.tangentAt(Math.min(t + 0.004, 1), this.tB);
    return Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
  }

  update(t: number, time: number, dt: number): void {
    const rig = this.beatRig(t);
    const calm = this.options.reducedMotion;

    // --- plane ---
    // in the study the hero leaves the laptop on its own time (launch.ts); from the window on it is the path's t
    const sHero = heroParam(t);
    this.path.pointAt(sHero, this.planePos);
    const a = rig.turbAmp * (1 + 0.6 * (calm ? 0 : this.speed)); // scroll feel: more air at speed
    if (a > 0) {
      this.planePos.x += this.noise.noise(time * 0.6, 0, 0) * a;
      this.planePos.y += this.noise.noise(0, time * 0.7 + 13.7, 0) * a;
      this.planePos.z += this.noise.noise(0, 0, time * 0.5 + 71.3) * a;
    }

    this.path.tangentAt(sHero, this.tangent);

    // banking: signed yaw rate between successive tangents
    if (this.prevTangent.lengthSq() === 0) this.prevTangent.copy(this.tangent);
    const crossY =
      this.prevTangent.x * this.tangent.z - this.prevTangent.z * this.tangent.x;
    const turn = crossY / Math.max(dt, 1e-4);
    // scroll feel: the per-frame yaw rate is noisy (frame times jitter, the scroll arrives in steps);
    // low-pass it at 12/s before it banks the dart
    this.turnLP = MathUtils.damp(this.turnLP, turn, 12, dt);
    const targetRoll = MathUtils.clamp(this.turnLP * 2.2, -0.6, 0.6);
    this.roll = MathUtils.damp(this.roll, targetRoll, 8, dt);
    this.prevTangent.copy(this.tangent);

    this.plane.group.position.copy(this.planePos);
    this.lookAtPoint.copy(this.planePos).add(this.tangent);
    this.lookMatrix.lookAt(this.lookAtPoint, this.planePos, UP);
    this.baseQuat.setFromRotationMatrix(this.lookMatrix);
    // the letter sways and noses up while it opens and folds, over the desk
    const tau = t - HERO_RELEASE;
    const att = tau > 0 && t < 0.11 ? launchAttitude(tau, t, 4.2, calm) : null;
    this.rollQuat.setFromAxisAngle(this.tangent, this.roll + (att ? att.sway : 0));
    this.plane.group.quaternion.copy(this.rollQuat).multiply(this.baseQuat);
    if (att && att.pitch !== 0) this.plane.group.quaternion.multiply(this.qLaunch.setFromAxisAngle(X_AXIS, att.pitch));
    // office detour: the dart leaves the main line (the main pose is kept for the copilot)
    const dw = this.detour.weight;
    this.detour.mainPlanePos.copy(this.planePos);
    this.detour.mainPlaneQuat.copy(this.plane.group.quaternion);
    if (dw > 0) {
      this.planePos.lerp(this.detour.planePos, dw);
      this.plane.group.position.copy(this.planePos);
      this.plane.group.quaternion.slerp(this.detour.planeQuat, dw);
    }

    this.planeWorldPos.copy(this.planePos);
    this.currentTangent.copy(this.tangent);
    this.side.crossVectors(this.tangent, UP).normalize();
    this.currentSide.copy(this.side);

    // --- the shot list ---
    let fovMul = 1;
    let bars = 0;
    let dutch = rig.dutch ?? 0;
    let bokeh = 0;
    let holdW = 0;
    for (const beat of BEATS) {
      const w = beatWeight(beat, t);
      if (w <= 0) continue;
      if (beat.fov !== undefined) fovMul *= 1 + (beat.fov - 1) * w;
      if (beat.bars !== undefined) bars = Math.max(bars, beat.bars * w);
      if (beat.dutch !== undefined) dutch += beat.dutch * w;
      if (beat.bokeh !== undefined) bokeh = Math.max(bokeh, beat.bokeh * w);
      if ((beat.hold !== undefined || beat.holdAt) && w > holdW) {
        holdW = w;
        if (beat.holdAt) this.holdPos.fromArray(beat.holdAt);
        else this.chasePosition(beat.hold!, rigParamsAt(beat.hold!), this.holdPos);
        if (beat.nudge) this.holdPos.add(this.tA.fromArray(beat.nudge));
        if (beat.holdAt && beat.follow) this.followDart(beat, t, this.holdPos);
      }
    }

    // --- camera ---
    this.chasePosition(t, rig, this.camPos);
    // slice of the plane's gusts so the camera feels the same air
    if (a > 0) {
      this.camPos.x += this.noise.noise(time * 0.6, 5.1, 0) * a * 0.2;
      this.camPos.y += this.noise.noise(0, time * 0.7 + 43.7, 0) * a * 0.2;
    }
    // a held shot eases the camera to a stop and then back into the chase; smoothstepping the
    // weight again gives the catch-up a slow start instead of a lurch
    const hold = holdW * holdW * (3 - 2 * holdW);
    // the study: low beside the desk on the laptop, then along with the planes to the window
    const study = 1 - MathUtils.smoothstep(t, 0.1, 0.112);
    if (study > 0) {
      studyShot(t, this.path, this.studyPos, this.studyLook, this.camera.aspect);
      this.camPos.lerp(this.studyPos, study);
    }
    if (hold > 0) this.camPos.lerp(this.holdPos, hold);
    // lightning: a short shake, as if the thunder reached the lens
    if (!calm && this.jolt > 0.01) {
      const j = this.jolt * 0.05;
      this.camPos.x += this.noise.noise(time * 31, 1.3, 0) * j;
      this.camPos.y += this.noise.noise(0, time * 29 + 7.1, 0) * j;
    }
    if (this.shot.weight > 0) this.camPos.lerp(this.shot.position, this.shot.weight);
    // scroll feel: at rest the camera breathes, a slow drift of a few centimetres (7 s period)
    if (!calm && this.rest > 0) {
      const b = this.rest * 0.04;
      this.camPos.x += this.noise.noise(time * 0.143, 91.7, 3.3) * b;
      this.camPos.y += this.noise.noise(5.9, time * 0.143, 27.1) * b;
      this.camPos.z += this.noise.noise(44.2, 8.8, time * 0.143) * b;
    }
    if (dw > 0) this.camPos.lerp(this.detour.camPos, dw);
    // the ending's own camera (rig/endingShot.ts), laid over everything last
    const end = endingPose(t, this.camera.aspect, this.ending);
    const ew = end.weight;
    if (ew > 0) this.camPos.lerp(end.camPos, ew);
    this.camera.position.copy(this.camPos);

    const lookT = Math.min(this.along(t, rig.lookAhead), 1);
    this.path.pointAt(lookT, this.lookAtPoint);
    this.lookAtPoint.y += rig.lookUp ?? 0;
    if (!this.lookInitialized) {
      this.lookTarget.copy(this.lookAtPoint);
      this.lookInitialized = true;
    }
    // scroll feel: 10/s (was 6): the scrub spring already smooths the scroll, and a slow look target
    // on top of it was a second lag that made the frame swing in late after each stop
    this.lookTarget.x = MathUtils.damp(this.lookTarget.x, this.lookAtPoint.x, 10, dt);
    this.lookTarget.y = MathUtils.damp(this.lookTarget.y, this.lookAtPoint.y, 10, dt);
    this.lookTarget.z = MathUtils.damp(this.lookTarget.z, this.lookAtPoint.z, 10, dt);
    this.lookAtPoint.copy(this.lookTarget);
    if (study > 0) this.lookAtPoint.lerp(this.studyLook, study);
    // a held camera pans with the dart itself rather than with the point ahead of it
    if (hold > 0) this.lookAtPoint.lerp(this.planePos, hold);
    if (this.shot.weight > 0) this.lookAtPoint.lerp(this.shot.look, this.shot.weight);
    if (dw > 0) this.lookAtPoint.lerp(this.detour.look, dw);
    if (ew > 0) this.lookAtPoint.lerp(end.look, ew);
    this.camera.lookAt(this.lookAtPoint);

    // roll: a dutch angle where the beat wants one, and a share of the dart's bank into turns —
    // the horizon leans with the flight. Damped, and never under reduced motion.
    const free = 1 - Math.max(hold, this.shot.weight);
    const bank = calm ? 0 : -this.pathTurn(t) * 2.4 * (rig.bank ?? 0) * free;
    const rollTarget = calm ? 0 : MathUtils.clamp(bank, -0.18, 0.18) + dutch * DEG;
    this.camRoll = MathUtils.damp(this.camRoll, rollTarget, 4, dt);
    let roll = dw > 0 ? MathUtils.lerp(this.camRoll, this.detour.roll, dw) : this.camRoll;
    if (ew > 0) roll = MathUtils.lerp(roll, calm ? 0 : end.roll, ew);
    if (Math.abs(roll) > 1e-4) this.camera.rotateZ(roll);

    // focal length: the chapter's lens times the beat's push, plus a kick when lightning hits
    let fov = rig.fov * (calm ? 1 : fovMul) + (calm ? 0 : this.jolt * 0.8);
    // scroll feel: the lens opens up to 3.5 degrees at speed, and breathes +-0.3 degrees at rest
    if (!calm) fov += Math.min(3.5, 3.5 * this.speed) + this.rest * 0.3 * Math.sin((time * 2 * Math.PI) / 7);
    // a tall phone screen sees a thin slice sideways: the study opens its lens so the laptop still fits
    const widen = MathUtils.lerp(1, MathUtils.clamp(1.25 / this.camera.aspect, 1, 1.9), study);
    if (widen > 1.001) fov = (2 * Math.atan(Math.tan((fov * DEG) / 2) * widen)) / DEG;
    this.fovTarget = calm ? fov : MathUtils.damp(this.fovTarget, fov, 5, dt);
    let lens = dw > 0 ? MathUtils.lerp(this.fovTarget, this.detour.fov, dw) : this.fovTarget;
    if (ew > 0) lens = MathUtils.lerp(lens, end.fov, ew);
    if (Math.abs(this.camera.fov - lens) > 0.01) {
      this.camera.fov = lens;
      this.camera.updateProjectionMatrix();
    }

    // the lens: what is in focus, how soft the rest is, how matted the frame
    this.cine.bars = ew > 0 && end.bars !== undefined ? Math.max(bars * (1 - ew), end.bars * ew) : bars;
    this.cine.bokeh = 0.4 + bokeh;
    this.tB.copy(this.planePos).lerp(this.shot.look, this.shot.weight);
    this.cine.focus = this.camPos.distanceTo(this.tB);
  }
}
