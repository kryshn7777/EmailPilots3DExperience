import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { DETOUR, detourWeight, smooth } from './detour';

/**
 * The office detour's camera and dart while the camera is in the office, keyed on the detour clock `u`
 * (rig/detour.ts). Pure in `u` given the stage, so a scrub always lands on the same frame.
 *
 * Outside the two cuts there is nothing here: the dart is on the flight line, which runs straight in the tower's
 * west face and straight out of its east face, and the camera is the main rig's (its beats frame the run at the
 * glass and the burst out of the far face). Between the cuts (the office, its own stage below the world) the dart
 * crosses the room in ONE straight, level line at one speed, from the window it came in by (z = 0) to the window
 * wall opposite (z = the room's depth), passing right over the one live laptop; the camera tracks beside it on a
 * parallel dolly, a little behind and above, and looks down at the laptop as the dart passes it. The envelope does
 * the curving: it drops out of the dart's belly and glides into the laptop's screen. The dart never turns.
 */

/** room units per metre: the props are in metres; the room is drawn twice life size so the dart (0.45 scale) is in proportion */
export const ROOM_K = 2;
/** the dart's size in the office */
export const OFFICE_PLANE_SCALE = 0.45;
/** the office lens */
const OFFICE_FOV = 46;

/** the room's depth, metres: the entry window is z = 0, the far window z = OFFICE_DEPTH (OfficeProps ROOM.z1) */
export const OFFICE_DEPTH = 10;

/** where the detour sits: filled in by the Office actor */
export interface DetourScene {
  /** the room's origin in the world (floor, centre of the entry window wall); room x right, y up, z inward */
  origin: Vector3;
  /** the live laptop's screen centre, room-local metres */
  screen: Vector3;
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

/**
 * The dart's line through the room, room-local metres: over the live laptop (x), at a height that clears every
 * monitor and lamp in its way (y), from just outside the entry glass to just outside the far glass (z).
 */
export const OFFICE_LINE = { x: -0.7, y: 1.55, z0: -0.15, z1: OFFICE_DEPTH + 0.15 } as const;

/** the dart's place in the room at u (room-local metres): constant speed, cutIn -> cutOut */
export function officePlaneAt(u: number, out: Vector3): Vector3 {
  const k = (u - DETOUR.cutIn) / (DETOUR.cutOut - DETOUR.cutIn);
  return out.set(OFFICE_LINE.x, OFFICE_LINE.y, MathUtils.lerp(OFFICE_LINE.z0, OFFICE_LINE.z1, k));
}

/**
 * The dolly: a little to the dart's right (the aisle side, +x), above and behind it, at its speed. Close enough
 * to its line that a phone's narrow frame keeps the dart in it (it was 21 degrees off the lens, out of frame).
 */
const DOLLY = { dx: 0.55, y: 1.95, back: 2.2 };

/** where the dolly looks: ahead of the dart, a little low; over the laptop it drops to the screen */
function dollyLook(u: number, plane: Vector3, screen: Vector3, out: Vector3): Vector3 {
  out.set(OFFICE_LINE.x + 0.05, 1.25, plane.z + 1.8);
  // the envelope's way into the laptop: the lens drops toward the screen and holds it while it flips to received
  const toScreen = smooth(u, 0.3, 0.38) * (1 - smooth(u, 0.5, 0.58));
  if (toScreen > 0) out.lerp(B.copy(screen).add(C.set(0, 0.1, 0.2)), toScreen * 0.75);
  return out;
}

// scratch
const A = new Vector3();
const B = new Vector3();
const C = new Vector3();
const M = new Matrix4();
const Q = new Quaternion();
const UP = new Vector3(0, 1, 0);
const FWD = new Vector3(0, 0, 1);

/** a tall phone screen sees a thin slice sideways: the office opens the lens so the room still fits */
function widen(fov: number, aspect: number): number {
  const k = MathUtils.clamp(1.25 / aspect, 1, 1.7);
  if (k <= 1.001) return fov;
  return (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * k) * 180) / Math.PI;
}

function roomToWorld(scene: DetourScene, local: Vector3, out: Vector3): Vector3 {
  return out.copy(local).multiplyScalar(ROOM_K).add(scene.origin);
}

/** The office's pose at u: weight 1 between the cuts (the office owns the frame), 0 everywhere else. */
export function detourPose(u: number, scene: DetourScene | null, aspect: number, out: DetourPose): void {
  out.weight = scene ? detourWeight(u) : 0;
  if (out.weight <= 0 || !scene) return;
  out.planeScale = OFFICE_PLANE_SCALE;
  out.roll = 0;
  officePlaneAt(u, A);
  roomToWorld(scene, A, out.planePos);
  // level, nose along +z, no bank: it does not turn
  B.copy(out.planePos).add(FWD);
  M.lookAt(B, out.planePos, UP);
  out.planeQuat.setFromRotationMatrix(M);
  // the dolly
  C.set(A.x + DOLLY.dx, DOLLY.y, A.z - DOLLY.back);
  roomToWorld(scene, C, out.camPos);
  dollyLook(u, A, scene.screen, B);
  roomToWorld(scene, B, out.look);
  out.fov = widen(OFFICE_FOV, aspect);
}

/**
 * The envelope that drops out of the dart's belly and glides into the live laptop: it leaves the dart at
 * `envelopeFrom`, falls away in front of the screen, and goes into it by `absorbed`. Room-local metres (the Office
 * actor owns the mesh, inside the room).
 */
export function envelopePose(u: number, scene: DetourScene, out: EnvelopePose): void {
  const appear = smooth(u, DETOUR.envelopeFrom, DETOUR.envelopeFrom + 0.02);
  const gone = smooth(u, DETOUR.absorbed - 0.02, DETOUR.absorbed);
  out.scale = appear * (1 - gone);
  if (out.scale <= 0.001) return;
  // from under the dart (where it is at envelopeFrom) to just in front of the screen, then into it: a quadratic
  // curve that keeps the dart's forward speed at first and drops away under it
  const k = MathUtils.clamp((u - DETOUR.envelopeFrom) / (DETOUR.absorbed - DETOUR.envelopeFrom), 0, 1);
  officePlaneAt(DETOUR.envelopeFrom, A);
  A.y -= 0.1;
  const front = B.copy(scene.screen).add(C.set(0, 0.04, -0.3));
  // control point: ahead of the release along the line, at the release height (the envelope keeps going, then drops)
  C.set(OFFICE_LINE.x, A.y - 0.05, MathUtils.lerp(A.z, front.z, 0.75));
  const s = Math.min(k / 0.85, 1);
  const a = (1 - s) * (1 - s);
  const b = 2 * (1 - s) * s;
  const c = s * s;
  out.pos.set(a * A.x + b * C.x + c * front.x, a * A.y + b * C.y + c * front.y, a * A.z + b * C.z + c * front.z);
  // the last stretch: into the screen
  out.pos.lerp(scene.screen, smooth(k, 0.85, 1));
  // flat in flight (like a card thrown), turning to face the screen as it goes in
  M.lookAt(A.copy(out.pos).add(FWD), out.pos, UP);
  out.quat.setFromRotationMatrix(M);
  // facing: the box's broad face is +y; the screen faces -z, so the face turns to -z (x by -90 degrees)
  Q.setFromAxisAngle(C.set(1, 0, 0), -Math.PI / 2);
  const facing = smooth(k, 0.55, 0.95);
  if (facing > 0) out.quat.slerp(Q, facing);
}
