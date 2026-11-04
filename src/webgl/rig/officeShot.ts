import { CatmullRomCurve3, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { DETOUR, detourWeight, smooth } from './detour';

/**
 * The office detour's camera and dart, keyed on the detour clock `u` (rig/detour.ts). Like
 * studyShot.ts: pure in `u` given the scene it is laid over, so a scrub always lands on the same
 * frame. Four legs:
 *
 *  0 .. cutIn       out in the city: the dart leaves the main line at P(T_S) on its tangent and
 *                   curves into the glass of the tower beside it; the camera chases it in
 *  cutIn .. cutOut  in the office (a separate stage, room units below): the establishing shot
 *                   from the window, the envelope into the live laptop, the dart circling, and
 *                   back out to the glass
 *  cutOut .. climb  in the city again: a held camera off the facade as the dart bursts out of it
 *  climb .. 1       up over the city to y ~40, a climbing turn, the dive, and onto the main line
 *                   at P(T_S) on its tangent: at u = 1 the pose is the main rig's
 */

/** room units per metre: the props are in metres; the room is drawn twice life size so the dart (0.45 scale) is in proportion */
export const ROOM_K = 2;
/** the dart's size in the office */
export const OFFICE_PLANE_SCALE = 0.45;
/** the office lens */
const OFFICE_FOV = 44;

/** where the detour sits: filled in by the Office actor once it knows the tower and the room */
export interface DetourScene {
  /** the main line at T_S, and its tangent */
  p0: Vector3;
  t0: Vector3;
  /** the main rig's camera at T_S (no turbulence), its look target and lens */
  mainCam: Vector3;
  mainLook: Vector3;
  mainFov: number;
  /** the dart's way in, on the tower's glass, and the facade's outward normal (horizontal) */
  entry: Vector3;
  normal: Vector3;
  /** the room's origin in the world (floor, centre of the window wall); room x right, y up, z inward */
  origin: Vector3;
  /** the live laptop's screen centre, room-local metres */
  screen: Vector3;
  /** the flight out of the facade, over the city and back onto the line (world), built by `buildExitCurve` */
  exit: CatmullRomCurve3 | null;
}

export interface DetourPose {
  weight: number;
  camPos: Vector3;
  look: Vector3;
  fov: number;
  roll: number;
  planePos: Vector3;
  planeQuat: Quaternion;
  planeScale: number;
}

export interface EnvelopePose {
  /** 0 hidden .. 1 full size */
  scale: number;
  pos: Vector3;
  quat: Quaternion;
}

type V3 = [number, number, number];
interface Key { u: number; p: V3 }

/** the dart in the office, room-local metres (the window wall is z = 0; the live laptop is at about (-3.0, 0.88, 3.42)) */
const PLANE_KEYS: Key[] = [
  { u: 0.08, p: [-2.15, 1.78, -0.05] },
  { u: 0.14, p: [-2.45, 1.6, 0.95] },
  { u: 0.2, p: [-2.75, 1.42, 1.75] },
  { u: 0.27, p: [-3.0, 1.26, 2.45] },
  { u: 0.33, p: [-2.95, 1.3, 3.05] },
  { u: 0.39, p: [-2.45, 1.62, 3.95] },
  { u: 0.45, p: [-1.45, 1.95, 4.05] },
  { u: 0.51, p: [-1.05, 2.1, 2.9] },
  { u: 0.56, p: [-1.85, 2.1, 1.95] },
  { u: 0.61, p: [-2.75, 2.0, 1.75] },
  { u: 0.64, p: [-2.6, 1.9, 0.75] },
  { u: 0.66, p: [-2.4, 1.86, -0.05] },
];

/** the camera in the office */
const CAM_KEYS: Key[] = [
  { u: 0.08, p: [-1.45, 2.15, 0.12] },
  { u: 0.16, p: [-1.35, 2.05, 0.4] },
  { u: 0.24, p: [-1.75, 1.66, 1.2] },
  { u: 0.32, p: [-2.45, 1.3, 1.85] },
  { u: 0.4, p: [-2.8, 1.12, 2.3] },
  { u: 0.47, p: [-2.95, 1.06, 2.5] },
  { u: 0.55, p: [-2.6, 1.28, 2.05] },
  { u: 0.6, p: [-2.1, 1.7, 1.55] },
  { u: 0.64, p: [-2.25, 1.9, 1.25] },
  { u: 0.66, p: [-2.3, 1.9, 0.95] },
];

/** where it looks when it is not watching the dart */
const LOOK_KEYS: Key[] = [
  { u: 0.08, p: [-2.7, 1.15, 3.2] },
  { u: 0.2, p: [-2.9, 1.05, 3.2] },
  { u: 0.4, p: [-3.0, 0.9, 3.42] },
  { u: 0.55, p: [-3.0, 0.95, 3.4] },
  { u: 0.62, p: [-2.4, 1.8, 0.0] },
  { u: 0.66, p: [-2.4, 1.85, -1.0] },
];

/** how much the camera watches the dart instead of the look keys, by u */
function trackAt(u: number): number {
  return 0.55 * (1 - smooth(u, 0.26, 0.36)) + 0.35 * smooth(u, 0.5, 0.56) * (1 - smooth(u, 0.6, 0.64)) + 0.5 * smooth(u, 0.6, 0.64);
}

/** non-uniform cardinal spline through keyed points (Hermite, tangents from the neighbours) */
function sampleKeys(keys: Key[], u: number, out: Vector3): Vector3 {
  const n = keys.length;
  if (u <= keys[0]!.u) return out.fromArray(keys[0]!.p);
  if (u >= keys[n - 1]!.u) return out.fromArray(keys[n - 1]!.p);
  let i = 0;
  while (u > keys[i + 1]!.u) i++;
  const k0 = keys[i]!;
  const k1 = keys[i + 1]!;
  const km = keys[Math.max(i - 1, 0)]!;
  const kp = keys[Math.min(i + 2, n - 1)]!;
  const du = k1.u - k0.u;
  const s = (u - k0.u) / du;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  for (let c = 0; c < 3; c++) {
    const m0 = (k1.p[c]! - km.p[c]!) / (k1.u - km.u || 1);
    const m1 = (kp.p[c]! - k0.p[c]!) / (kp.u - k0.u || 1);
    out.setComponent(c, h00 * k0.p[c]! + h10 * du * m0 + h01 * k1.p[c]! + h11 * du * m1);
  }
  return out;
}

const UP = new Vector3(0, 1, 0);

/**
 * The flight out of the tower and back: out of the facade along its normal, a climbing turn up to
 * about y 40 over the city, the dive, and a pull-out that lands on the main line at P(T_S) along its
 * tangent (the last two points sit ON that tangent, so the curve arrives along it). `clear` lifts a
 * point that would stand inside a building.
 */
export function buildExitCurve(scene: DetourScene, clear: (p: Vector3) => void): CatmullRomCurve3 {
  const { entry: e, normal: n, p0, t0 } = scene;
  // the flight's own frame at P(T_S): F forward (level), S to its left
  const f = new Vector3(t0.x, 0, t0.z).normalize();
  const s = new Vector3().crossVectors(UP, f).normalize();
  // which side the climbing turn goes: away from the tower's side of the line
  const side = Math.sign(s.dot(new Vector3().subVectors(p0, e))) || 1;
  const at = (df: number, ds: number, y: number): Vector3 =>
    p0.clone().addScaledVector(f, df).addScaledVector(s, ds * side).setY(y);
  const pts = [
    e.clone().addScaledVector(n, -0.4),
    e.clone().addScaledVector(n, 3.2).add(new Vector3(0, 1.4, 0)),
    at(-6, 3, e.y + 7),
    at(-13, 7, 31),
    at(-15, 13, 39.5),
    at(-10, 17, 40.5),
    at(-3, 14, 35),
    at(-6, 6, 25),
    // on the tangent, behind P(T_S): the pull-out
    p0.clone().addScaledVector(t0, -9),
    p0.clone().addScaledVector(t0, -4.5),
    p0.clone(),
  ];
  for (let i = 1; i < pts.length - 3; i++) clear(pts[i]!);
  return new CatmullRomCurve3(pts, false, 'centripetal');
}

// scratch
const A = new Vector3();
const B = new Vector3();
const C = new Vector3();
const D = new Vector3();
const M = new Matrix4();
const Q = new Quaternion();

/** the dart's attitude from where it is and where it is going, banked by `roll` */
function attitude(pos: Vector3, dir: Vector3, roll: number, out: Quaternion): Quaternion {
  A.copy(pos).add(dir);
  M.lookAt(A, pos, UP);
  out.setFromRotationMatrix(M);
  return out.premultiply(Q.setFromAxisAngle(dir, roll));
}

/** bank into the turn: the signed horizontal turn between two headings, scaled */
function bankOf(a: Vector3, b: Vector3, gain: number): number {
  const turn = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
  return MathUtils.clamp(-turn * gain, -0.9, 0.9);
}

/** a tall phone screen sees a thin slice sideways: the office opens the lens so the room still fits */
function widen(fov: number, aspect: number): number {
  const k = MathUtils.clamp(1.25 / aspect, 1, 1.7);
  if (k <= 1.001) return fov;
  return (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * k) * 180) / Math.PI;
}

function roomToWorld(scene: DetourScene, local: Vector3, out: Vector3): Vector3 {
  return out.copy(local).multiplyScalar(ROOM_K).add(scene.origin);
}

/** the dart's place in the office at u, world */
function officePlane(scene: DetourScene, u: number, out: Vector3): Vector3 {
  return roomToWorld(scene, sampleKeys(PLANE_KEYS, u, out), out);
}

const pA = new Vector3();
const pB = new Vector3();
const dirA = new Vector3();
const dirB = new Vector3();

/** where the dart is on the way in (0..cutIn): from P(T_S) on its tangent to the glass, head on */
function inbound(scene: DetourScene, u: number, out: Vector3, dir: Vector3): void {
  const s = MathUtils.clamp(u / DETOUR.cutIn, 0, 1);
  const len = scene.p0.distanceTo(scene.entry);
  // cubic Hermite: leaves along t0, arrives along -normal
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  const k = len * 1.1;
  out.set(0, 0, 0)
    .addScaledVector(scene.p0, h00)
    .addScaledVector(scene.t0, h10 * k)
    .addScaledVector(scene.entry, h01)
    .addScaledVector(scene.normal, -h11 * k);
  const d00 = 6 * s2 - 6 * s;
  const d10 = 3 * s2 - 4 * s + 1;
  const d01 = -6 * s2 + 6 * s;
  const d11 = 3 * s2 - 2 * s;
  dir.set(0, 0, 0)
    .addScaledVector(scene.p0, d00)
    .addScaledVector(scene.t0, d10 * k)
    .addScaledVector(scene.entry, d01)
    .addScaledVector(scene.normal, -d11 * k)
    .normalize();
}

/** where the dart is on the way out (cutOut..1), on the exit curve (world) */
function outbound(scene: DetourScene, u: number, out: Vector3, dir: Vector3): number {
  const curve = scene.exit!;
  // arc length by a cubic with set end speeds: out of the facade at a burst, fastest in the dive,
  // and onto the line at about the main flight's own pace (it moves ~43 units per unit of u there)
  const k = MathUtils.clamp((u - DETOUR.cutOut) / (1 - DETOUR.cutOut), 0, 1);
  const len = curve.getLength();
  const span = 1 - DETOUR.cutOut;
  const a = MathUtils.clamp((110 * span) / len, 0.05, 2.5);
  const b = MathUtils.clamp((43 * span) / len, 0.05, 2.5);
  const k2 = k * k;
  const k3 = k2 * k;
  const s = MathUtils.clamp(a * (k3 - 2 * k2 + k) + (-2 * k3 + 3 * k2) + b * (k3 - k2), 0, 1);
  curve.getPointAt(s, out);
  curve.getTangentAt(Math.min(s, 0.9999), dir);
  return s;
}

/**
 * The detour's pose at u. With no exit curve yet (the city's lots have not arrived), it stays on the
 * main rig (weight 0), so a first scroll into the detour before the city exists shows the plain flight.
 */
export function detourPose(u: number, scene: DetourScene | null, aspect: number, out: DetourPose): void {
  out.weight = scene?.exit ? detourWeight(u) : 0;
  if (out.weight <= 0 || !scene) return;
  out.planeScale = 1;
  out.roll = 0;

  if (u < DETOUR.cutIn) {
    // in: the camera slides off the main rig onto the dart's tail and chases it into the glass
    inbound(scene, u, out.planePos, dirA);
    inbound(scene, Math.max(u - 0.012, 0), pA, dirB);
    attitude(out.planePos, dirA, bankOf(dirB, dirA, 3), out.planeQuat);
    const k = smooth(u, 0, DETOUR.cutIn * 0.75);
    B.copy(out.planePos).addScaledVector(dirA, -2.3).addScaledVector(UP, 0.55);
    out.camPos.copy(scene.mainCam).lerp(B, k);
    C.copy(out.planePos).addScaledVector(dirA, 2.5);
    out.look.copy(scene.mainLook).lerp(C, k);
    out.fov = MathUtils.lerp(scene.mainFov, 52, k);
    return;
  }

  if (u < DETOUR.cutOut) {
    // the office
    out.planeScale = OFFICE_PLANE_SCALE;
    officePlane(scene, u, out.planePos);
    officePlane(scene, Math.min(u + 0.004, DETOUR.cutOut), pA);
    officePlane(scene, Math.max(u - 0.004, DETOUR.cutIn), pB);
    dirA.subVectors(pA, pB).normalize();
    officePlane(scene, Math.max(u - 0.02, DETOUR.cutIn), C);
    dirB.subVectors(pB, C).normalize();
    attitude(out.planePos, dirA, bankOf(dirB, dirA, 2.2), out.planeQuat);
    roomToWorld(scene, sampleKeys(CAM_KEYS, u, A), out.camPos);
    roomToWorld(scene, sampleKeys(LOOK_KEYS, u, B), out.look);
    out.look.lerp(out.planePos, trackAt(u));
    out.fov = widen(OFFICE_FOV, aspect);
    return;
  }

  // out: the burst, the climb, the dive and the rejoin
  const s = outbound(scene, u, out.planePos, dirA);
  outbound(scene, Math.max(u - 0.01, DETOUR.cutOut), pA, dirB);
  attitude(out.planePos, dirA, bankOf(dirB, dirA, 2.6), out.planeQuat);
  // a held camera off the facade watches it burst out ...
  const n = scene.normal;
  const side = D.crossVectors(UP, n).normalize();
  A.copy(scene.entry).addScaledVector(n, 6.5).addScaledVector(side, 2.6).addScaledVector(UP, -1.2);
  B.copy(scene.entry).lerp(out.planePos, 0.7);
  // ... then chases it up, over and down onto the line
  const curve = scene.exit!;
  curve.getPointAt(Math.max(s - 0.05, 0), C);
  C.addScaledVector(UP, 1.6).addScaledVector(dirA, -1.5);
  const chase = smooth(u, DETOUR.climb - 0.01, DETOUR.climb + 0.07);
  out.camPos.copy(A).lerp(C, chase);
  pB.copy(out.planePos).addScaledVector(dirA, 3);
  out.look.copy(B).lerp(pB, chase);
  out.fov = MathUtils.lerp(48, 56, chase);
  // and hands back to the main rig as the dart comes onto the line
  const home = smooth(u, 0.88, 1);
  out.camPos.lerp(scene.mainCam, home);
  out.look.lerp(scene.mainLook, home);
  out.fov = MathUtils.lerp(out.fov, scene.mainFov, home);
  out.roll *= 1 - home;
}

/**
 * The envelope that follows the dart into the office and is swallowed by the live laptop: it comes
 * out of the dart's wake at `envelopeFrom`, trails it to the desk, and turns into the screen while
 * the dart pulls up over the lid. Room-local metres (the Office actor owns the mesh, inside the room).
 */
export function envelopePose(u: number, scene: DetourScene, out: EnvelopePose): void {
  const appear = smooth(u, DETOUR.envelopeFrom, DETOUR.envelopeFrom + 0.03);
  const gone = smooth(u, DETOUR.absorbed - 0.05, DETOUR.absorbed);
  out.scale = appear * (1 - gone);
  if (out.scale <= 0.001) return;
  // in the dart's wake: a little behind it, a little below
  const lag = 0.045;
  sampleKeys(PLANE_KEYS, Math.max(u - lag, DETOUR.cutIn), out.pos);
  out.pos.y -= 0.12;
  sampleKeys(PLANE_KEYS, Math.max(u - lag + 0.004, DETOUR.cutIn), A);
  A.y -= 0.12;
  dirA.subVectors(A, out.pos);
  // then into the screen: first in front of it, then through it
  const front = B.copy(scene.screen).add(C.set(0, 0.02, -0.55));
  const toFront = smooth(u, 0.27, 0.36);
  const into = smooth(u, 0.36, DETOUR.absorbed);
  out.pos.lerp(front, toFront).lerp(scene.screen, into);
  // flat in flight (like a card thrown), turning to face the screen as it goes in
  if (dirA.lengthSq() < 1e-10) dirA.set(0, 0, 1);
  dirA.normalize();
  A.copy(out.pos).add(dirA);
  M.lookAt(A, out.pos, UP);
  out.quat.setFromRotationMatrix(M);
  // facing: the box's broad face is +y; the screen faces -z, so the face turns to -z (x by -90 degrees)
  Q.setFromAxisAngle(C.set(1, 0, 0), -Math.PI / 2);
  const facing = smooth(u, 0.3, 0.38);
  if (facing > 0) out.quat.slerp(Q, facing);
}
