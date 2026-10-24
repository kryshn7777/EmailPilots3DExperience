import { MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import { rigParamsAt, type RigParams } from '../../story/chapters';
import type { FlightPath } from './FlightPath';
import { HERO_RELEASE, heroParam, launchAttitude } from './launch';
import { studyShot } from './studyShot';
import type { PaperPlane } from '../actors/PaperPlane';

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
}

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
  { id: 'canyon', at: [0.7, 0.715, 0.735, 0.75], dutch: -2 },
  // touchdown: the camera swings out to the runway edge at wheel height and waits there; the dart
  // flares past it in profile and lands, then the lens catches up through the office door
  { id: 'touchdown', at: [0.92, 0.936, 0.956, 0.972], holdAt: [263.5, 0.95, -4.0], fov: 0.9, bars: 1, bokeh: 2.4 },
  // the last push into the screen, the matte opening as the dart becomes the page
  { id: 'arrival', at: [0.962, 0.972, 0.982, 0.996], bars: 0.6, fov: 0.94 },
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

  /**
   * Where the chase camera stands for story-t `t`, with no turbulence: the chapter's lag and
   * offsets, kept a minimum distance off the dart. Pure in t, so a held shot can ask where the
   * camera WAS and stay there.
   */
  private chasePosition(t: number, rig: RigParams, out: Vector3): Vector3 {
    const planePos = this.path.pointAt(t, this.planeScratch);
    const tangent = this.path.tangentAt(t, this.tA);
    const side = this.sideScratch.crossVectors(tangent, UP).normalize();
    this.path.pointAt(Math.max(t - rig.camLag, 0), out);
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
    const rig = rigParamsAt(t);
    const calm = this.options.reducedMotion;

    // --- plane ---
    // in the study the hero leaves the laptop on its own time (launch.ts); from the window on it is the path's t
    const sHero = heroParam(t);
    this.path.pointAt(sHero, this.planePos);
    const a = rig.turbAmp;
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
    const targetRoll = MathUtils.clamp(turn * 2.2, -0.6, 0.6);
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
      studyShot(t, this.path, this.studyPos, this.studyLook);
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
    this.camera.position.copy(this.camPos);

    const lookT = Math.min(t + rig.lookAhead, 1);
    this.path.pointAt(lookT, this.lookAtPoint);
    this.lookAtPoint.y += rig.lookUp ?? 0;
    if (!this.lookInitialized) {
      this.lookTarget.copy(this.lookAtPoint);
      this.lookInitialized = true;
    }
    this.lookTarget.x = MathUtils.damp(this.lookTarget.x, this.lookAtPoint.x, 6, dt);
    this.lookTarget.y = MathUtils.damp(this.lookTarget.y, this.lookAtPoint.y, 6, dt);
    this.lookTarget.z = MathUtils.damp(this.lookTarget.z, this.lookAtPoint.z, 6, dt);
    this.lookAtPoint.copy(this.lookTarget);
    if (study > 0) this.lookAtPoint.lerp(this.studyLook, study);
    // a held camera pans with the dart itself rather than with the point ahead of it
    if (hold > 0) this.lookAtPoint.lerp(this.planePos, hold);
    if (this.shot.weight > 0) this.lookAtPoint.lerp(this.shot.look, this.shot.weight);
    this.camera.lookAt(this.lookAtPoint);

    // roll: a dutch angle where the beat wants one, and a share of the dart's bank into turns —
    // the horizon leans with the flight. Damped, and never under reduced motion.
    const free = 1 - Math.max(hold, this.shot.weight);
    const bank = calm ? 0 : -this.pathTurn(t) * 2.4 * (rig.bank ?? 0) * free;
    const rollTarget = calm ? 0 : MathUtils.clamp(bank, -0.18, 0.18) + dutch * DEG;
    this.camRoll = MathUtils.damp(this.camRoll, rollTarget, 4, dt);
    if (Math.abs(this.camRoll) > 1e-4) this.camera.rotateZ(this.camRoll);

    // focal length: the chapter's lens times the beat's push, plus a kick when lightning hits
    const fov = rig.fov * (calm ? 1 : fovMul) + (calm ? 0 : this.jolt * 0.8);
    this.fovTarget = calm ? fov : MathUtils.damp(this.fovTarget, fov, 5, dt);
    if (Math.abs(this.camera.fov - this.fovTarget) > 0.01) {
      this.camera.fov = this.fovTarget;
      this.camera.updateProjectionMatrix();
    }

    // the lens: what is in focus, how soft the rest is, how matted the frame
    this.cine.bars = bars;
    this.cine.bokeh = 0.9 + bokeh;
    this.tB.copy(this.planePos).lerp(this.shot.look, this.shot.weight);
    this.cine.focus = this.camPos.distanceTo(this.tB);
  }
}
