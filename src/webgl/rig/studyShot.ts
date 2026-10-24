import { MathUtils, Vector3 } from 'three';
import type { FlightPath } from './FlightPath';
import { launchParam, JOIN_T, RELEASE_T } from './launch';

/**
 * The opening shot in the study: a low camera on the desk's near side, close on the laptop
 * screen. As the envelopes leave it, it slides along the desk beside the planes (never in their
 * lane: the lens stays 2+ units off the flight line) and arrives at the window opening, where
 * CameraRig's 'window' hold takes over. Pure in story-t: a scrub always lands on the same frame.
 */

/** the camera's keyframes: story-t, position, and where it looks while the planes are still near the laptop */
interface Key { t: number; p: [number, number, number] }
const KEYS: Key[] = [
  { t: 0.0, p: [2.0, 1.52, 2.5] },
  { t: 0.02, p: [2.05, 1.62, 2.6] },
  { t: 0.04, p: [2.1, 1.9, 2.8] },
  { t: 0.06, p: [2.6, 2.15, 2.8] },
  { t: 0.08, p: [4.3, 2.5, 2.2] },
  { t: 0.092, p: [5.6, 2.72, 1.4] },
  { t: 0.098, p: [6.5, 2.85, 0.9] }, // CameraRig's 'window' hold
];

/** where the lens rests while it looks at the screen: left of the screen, so the laptop sits right of the HUD */
const SCREEN_LOOK = new Vector3(-0.95, 1.55, 0.38);

/** the middle of the three planes is what the camera watches once they are in the air */
const CENTRE = new Vector3();
const P = new Vector3();
const SPECS: { release: number; sEnd: number }[] = [
  { release: RELEASE_T[0], sEnd: JOIN_T + 0.03 },
  { release: RELEASE_T[1], sEnd: JOIN_T + 0.024 },
  { release: RELEASE_T[2], sEnd: JOIN_T },
];

/** non-uniform cardinal spline through the keyframes (Hermite, tangents from the neighbours) */
function sampleKeys(t: number, out: Vector3): Vector3 {
  const n = KEYS.length;
  if (t <= KEYS[0]!.t) return out.fromArray(KEYS[0]!.p);
  if (t >= KEYS[n - 1]!.t) return out.fromArray(KEYS[n - 1]!.p);
  let i = 0;
  while (t > KEYS[i + 1]!.t) i++;
  const k0 = KEYS[i]!;
  const k1 = KEYS[i + 1]!;
  const km = KEYS[Math.max(i - 1, 0)]!;
  const kp = KEYS[Math.min(i + 2, n - 1)]!;
  const dt = k1.t - k0.t;
  const u = (t - k0.t) / dt;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  for (let c = 0; c < 3; c++) {
    const m0 = (k1.p[c]! - km.p[c]!) / (k1.t - km.t || 1);
    const m1 = (kp.p[c]! - k0.p[c]!) / (kp.t - k0.t || 1);
    out.setComponent(c, h00 * k0.p[c]! + h10 * dt * m0 + h01 * k1.p[c]! + h11 * dt * m1);
  }
  return out;
}

/** The camera's place and aim at story-t, in the study. Valid up to the window hold (t ~ 0.1). */
export function studyShot(t: number, path: FlightPath, pos: Vector3, look: Vector3): void {
  sampleKeys(t, pos);
  // the group of planes: the mean of where each stands on the flight line (unreleased ones sit on the screen)
  CENTRE.set(0, 0, 0);
  for (const sp of SPECS) CENTRE.add(path.pointAt(launchParam(t, sp.release, sp.sEnd), P));
  CENTRE.multiplyScalar(1 / SPECS.length);
  const follow = MathUtils.smoothstep(t, 0.006, 0.034);
  // the hero (the one the story follows) takes the frame from the scouts while it folds
  path.pointAt(launchParam(t, SPECS[2]!.release, SPECS[2]!.sEnd), P);
  CENTRE.lerp(P, 0.8 * MathUtils.smoothstep(t, 0.028, 0.06));
  look.copy(SCREEN_LOOK).lerp(CENTRE, follow);
  // looking at the opening as the planes go through it
  const toHold = MathUtils.smoothstep(t, 0.072, 0.098);
  if (toHold > 0) look.lerp(path.pointAt(Math.max(t, 0), P), toHold);
}
