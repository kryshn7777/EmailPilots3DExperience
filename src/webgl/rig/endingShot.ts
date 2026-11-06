import { MathUtils, Vector3 } from 'three';
import { ENDING_BEATS as B, HOUSE, TOWER, TUBE } from './endingPoints.mjs';
import { FlightPath } from './FlightPath';

/**
 * The ending's own camera (docs/ending.md), laid over the chase like officeShot.ts and pure in t, so a scrub always
 * lands on the same frame. CameraRig applies it last, blended by `weight`:
 *
 *   camPos.lerp(e.camPos, w); look.lerp(e.look, w); fov = lerp(fov, e.fov, w); roll = lerp(roll, e.roll, w);
 *   bars = lerp(bars, e.bars, w)
 *
 * The shot list, keyed to the line's own timetable (ENDING_BEATS):
 *   0.880..0.889  hand-over from the chapter rig (weight 0 -> 1)
 *   descent       chase from behind and above, down through the cloud seam onto the runway's centreline
 *   low pass      low chase 0.6 over the dart, looking ahead and up at the tower growing over the rabbit
 *   intake        the camera runs on and stops at the relay hall's glass; the dart is swallowed by the bell-mouth
 *   rise          held at the foot, dollying back and tilting up with the light in the tube (a tall frame on phones)
 *   pop           a crane up the tower's north-west side to the main dish as the dart bursts out past its rim
 *   arc and dive  a wide chase over the crest and down at the house, sky above, the lit window below
 *   window        down to the window and through it behind the dart, into the warm room
 *   screen        the push into the laptop's screen: EMAIL RECEIVED, the message, Cara's reply; the bars open
 * Phones keep a minimum horizontal field (the lens widens on a tall screen), and the last push stands further back so
 * the screen's message spans the frame.
 */
export interface EndingPose {
  weight: number;
  camPos: Vector3;
  look: Vector3;
  fov: number;
  roll: number;
  /** letterbox amount, 0..1 */
  bars?: number;
}

const Z = TOWER[2];
const DEG = Math.PI / 180;
const X = new Vector3(1, 0, 0);

let path: FlightPath | null = null;
const P = new Vector3();
const Q = new Vector3();
const T = new Vector3();
const A = new Vector3();
const L = new Vector3();
const C = new Vector3();
const D = new Vector3();

/** the dart on the flight line (the same FlightPath the Engine flies) */
function dart(t: number, out: Vector3): Vector3 {
  path ??= new FlightPath();
  return path.pointAt(Math.min(Math.max(t, 0), 1), out);
}
function tangent(t: number, out: Vector3): Vector3 {
  path ??= new FlightPath();
  return path.tangentAt(Math.min(Math.max(t, 0), 1), out);
}

const ss = (t: number, a: number, b: number): number => MathUtils.smoothstep(t, a, b);

/** vertical fov that keeps at least `hmin` degrees across on a narrow screen */
function lens(base: number, hmin: number, aspect: number): number {
  const v = (2 * Math.atan(Math.tan((hmin * DEG) / 2) / Math.max(aspect, 0.2))) / DEG;
  return Math.max(base, v);
}

/** Catmull-Rom (uniform) through keyframes [t, x, y, z], clamped at the ends */
type Key = [number, number, number, number];
function keyed(keys: Key[], t: number, out: Vector3): Vector3 {
  const n = keys.length;
  if (t <= keys[0]![0]) return out.set(keys[0]![1], keys[0]![2], keys[0]![3]);
  if (t >= keys[n - 1]![0]) return out.set(keys[n - 1]![1], keys[n - 1]![2], keys[n - 1]![3]);
  let i = 0;
  while (t > keys[i + 1]![0]) i++;
  const k0 = keys[Math.max(i - 1, 0)]!;
  const k1 = keys[i]!;
  const k2 = keys[i + 1]!;
  const k3 = keys[Math.min(i + 2, n - 1)]!;
  const u = (t - k1[0]) / (k2[0] - k1[0]);
  const dt = k2[0] - k1[0];
  // non-uniform (time-aware) Hermite tangents, so uneven key spacing does not overshoot
  const h00 = 2 * u * u * u - 3 * u * u + 1;
  const h10 = u * u * u - 2 * u * u + u;
  const h01 = -2 * u * u * u + 3 * u * u;
  const h11 = u * u * u - u * u;
  for (let c = 1; c <= 3; c++) {
    const m1 = (k2[c]! - k0[c]!) / (k2[0] - k0[0] || 1);
    const m2 = (k3[c]! - k1[c]!) / (k3[0] - k1[0] || 1);
    out.setComponent(c - 1, h00 * k1[c]! + h10 * dt * m1 + h01 * k2[c]! + h11 * dt * m2);
  }
  return out;
}

// -- the fixed places ------------------------------------------------------------------------------------------------
const TX = TOWER[0];
/** short of the relay hall, off the runway's edge: where the camera stops as the dart dives into the bell-mouth */
const HOLD_AT = [TX - 11.4, 2.3, Z + 3.2] as const;
/**
 * The crane up the tower's north-west side, outside the steel, to above and behind the main dish's rim: the dart
 * bursts out of the dish's face past its rim and flies on up and to the right (the screen direction never flips:
 * +x is always away or to the right).
 */
const CRANE: Key[] = [
  [B.tubeTop - 0.001, HOLD_AT[0], HOLD_AT[1], HOLD_AT[2]],
  [B.tubeTop + 0.0022, TX - 11.2, 13.0, Z + 7.0],
  [B.exit + 0.0012, TX - 9.6, 24.6, Z + 9.6],
  [B.crest + 0.003, TX - 6.6, 27.4, Z + 9.8],
];
/** the last of it: down to the window, through it, and the push into the screen */
const SX = HOUSE.screen[0];
const SY = HOUSE.screen[1];
const WX = HOUSE.windowX;

/** The ending's camera at story-t `t`; `aspect` = width / height. */
export function endingPose(t: number, aspect: number, out: EndingPose): EndingPose {
  out.weight = ss(t, 0.88, 0.889);
  out.roll = 0;
  out.bars = 0;
  if (out.weight <= 0) return out;
  const portrait = MathUtils.clamp((1.2 - aspect) / 0.7, 0, 1);

  // 1. the chase: descent, then the low pass (the offsets ease from one to the other)
  dart(t, P);
  tangent(t, T);
  const low = ss(t, B.lowPass - 0.012, B.lowPass + 0.004);
  const back = MathUtils.lerp(4.2, 3.1, low);
  const up = MathUtils.lerp(1.5, 0.6, low);
  const side = MathUtils.lerp(1.1, 0.55, low);
  C.copy(P).addScaledVector(T, -back);
  C.y += up;
  C.z += side;
  // look ahead along the runway and up at the tower as it comes
  dart(t + 0.004, L);
  L.addScaledVector(X, MathUtils.lerp(2, 9, low));
  L.y += MathUtils.lerp(0.2, 2.4 + 1.5 * portrait, low);
  let fov = MathUtils.lerp(lens(48, 40, aspect), lens(54, 44, aspect), low);
  let bars = 0.5 * ss(t, 0.9, 0.915);

  // 2. the intake hold and the rise: the camera runs on and stops short of the hall (it never moves back), the dart
  // flies on into the bell-mouth, then the camera tilts up with the light in the tube
  const hold = ss(t, B.intake - 0.012, B.intake - 0.004);
  if (hold > 0) {
    A.set(HOLD_AT[0], HOLD_AT[1], HOLD_AT[2]);
    // where it looks: into the bell-mouth's throat, then up the tube with the light (leading it a little)
    const yDart = MathUtils.lerp(TUBE.foot[1], TUBE.top[1], MathUtils.clamp((t - B.tube) / (B.tubeTop - B.tube), 0, 1));
    const rise = ss(t, B.intake + 0.0005, B.tube + 0.004);
    D.set(TUBE.mouth[0] + 0.4, TUBE.mouth[1] + 0.3, Z).lerp(Q.set(TUBE.foot[0], Math.min(yDart + 3.5, TUBE.top[1] + 2.5), Z), rise);
    C.lerp(A, hold);
    L.lerp(D, hold);
    fov = MathUtils.lerp(fov, MathUtils.lerp(lens(50, 42, aspect), lens(60, 38, aspect), rise), hold);
    bars = MathUtils.lerp(bars, 0.75, hold);
  }

  // 3. the crane to the dish and the pop: watching the feed, then the dart as it bursts out and over
  const crane = ss(t, B.tubeTop - 0.0012, B.tubeTop + 0.0022);
  if (crane > 0) {
    keyed(CRANE, t, A);
    dart(t, Q);
    // the feed until the dart is out, then between the dish and the dart (the dish stays in frame as it flies off)
    // (a phone's narrow frame stays nearer the dish)
    D.fromArray(TUBE.exit).lerp(Q, MathUtils.lerp(0.6, 0.45, portrait) * ss(t, B.exit - 0.001, B.exit + 0.004));
    D.y += 1.0;
    C.lerp(A, crane);
    L.lerp(D, crane);
    fov = MathUtils.lerp(fov, lens(56, 44, aspect), crane);
    bars = MathUtils.lerp(bars, 0.55, crane);
  }

  // 4. the arc and the dive: a wide chase from behind and above, sky over the house, the lit window below
  const dive = ss(t, B.crest + 0.0035, B.dive + 0.003);
  if (dive > 0) {
    dart(t, Q);
    // pulls in closer as the dart comes down and flares
    const near = ss(t, B.flare - 0.004, B.window - 0.002);
    A.copy(Q);
    A.x += MathUtils.lerp(-7.5, -4.4, near);
    A.y += MathUtils.lerp(3.0, 1.0, near);
    A.z += MathUtils.lerp(2.6, 0.4, near);
    // look between the dart and a point well above the window (sky over the house for the title), then at the window
    D.set(WX + MathUtils.lerp(6, 0, near), SY + MathUtils.lerp(7.5, 0.4, near), Z);
    dart(t + 0.004, Q);
    const lookAt = Q.lerp(D, MathUtils.lerp(0.45, 0.75, near));
    C.lerp(A, dive);
    L.lerp(lookAt, dive);
    fov = MathUtils.lerp(fov, lens(54, 38, aspect), dive);
    bars = MathUtils.lerp(bars, 0.4, dive);
    out.roll = -3 * DEG * dive * (1 - near);
  }

  // 5. through the window and the push into the screen
  const into = ss(t, B.window - 0.0042, B.window - 0.0012);
  if (into > 0) {
    // how far from the screen the camera ends: landscape fills with the screen, a phone keeps the message across
    const dEnd = MathUtils.lerp(1.38, 2.25, portrait);
    const keys: Key[] = [
      [B.window - 0.0042, WX - 6.5, SY + 2.0, Z + 0.55],
      [B.window - 0.0008, WX - 1.4, SY + 0.32, Z + 0.06],
      [B.screen, SX - Math.max(2.9, dEnd + 0.6), SY + 0.2, Z],
      [0.995, SX - dEnd - 0.25, SY + 0.12, Z],
      [1.0, SX - dEnd, SY + 0.1, Z],
    ];
    keyed(keys, t, A);
    // on a phone the final push centres on the message (the reading pane, right of the screen's middle)
    const pane = 0.24 * portrait * ss(t, B.screen - 0.002, 0.993);
    A.z += pane;
    D.set(SX, SY + 0.02, Z + pane);
    C.lerp(A, into);
    L.lerp(D, into);
    fov = MathUtils.lerp(fov, MathUtils.lerp(lens(46, 40, aspect), MathUtils.lerp(40, 50, portrait), ss(t, B.screen - 0.001, 0.994)), into);
    bars = MathUtils.lerp(bars, 0, ss(t, B.window - 0.002, 0.991));
    out.roll *= 1 - into;
  }

  out.camPos.copy(C);
  out.look.copy(L);
  out.fov = fov;
  out.bars = bars;
  return out;
}
