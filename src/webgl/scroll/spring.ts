/**
 * The scrub spring: what the frame renders chases the scroll with weight, as a pure function.
 *
 * The world used to run on a spring at zeta 0.80 (K 120, C 17.5), stepped once per frame: it leaned
 * past the target and came BACK after you stopped (the flight reversing on its own), and it snapped
 * the last 0.0004 of progress (~4.4 px, ~0.2 world units at landing speed) in one frame. This one:
 *
 *  - is stepped in fixed 1/120 s substeps, so a 144 Hz screen, a 60 Hz one and a frame that hitched
 *    to 50 ms all land on the same curve;
 *  - is critically damped (zeta 1), more so while it moves fast (zeta up to 1.4 above 0.4 progress/s),
 *    so a long flick arrives without a lurch. A critically damped spring's impulse response is never
 *    negative, so a target that only moves one way is followed without overshoot or reversal;
 *  - still guards against an overshoot (the target reversing, a substep's rounding): when the error
 *    changes sign the velocity is cut to a fifth, so it settles rather than swinging back;
 *  - snaps only when the remaining error is below 1.5e-5 of the story (~0.16 px) and nearly still.
 *
 * `capDetour` is the office detour's speed limit (rig/detour.ts MAX_U_RATE), applied after the step.
 * scripts/check-spring.mjs replays real input through Lenis' lerp and this at 60, 144 and jittered
 * frame rates.
 */

export interface SpringState {
  /** the rendered value (scroll progress, 0..1) */
  x: number;
  /** its velocity, progress per second */
  v: number;
}

export interface SpringParams {
  /** natural frequency, rad/s (11 by default; the input kind changes it, ScrollDirector) */
  omega: number;
  /** base damping ratio (1) */
  zeta?: number;
}

export const SUBSTEP = 1 / 120;
const SNAP_ERR = 1.5e-5;
const SNAP_VEL = 5e-4;

function smoothstep(x: number, a: number, b: number): number {
  const k = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return k * k * (3 - 2 * k);
}

/**
 * Advances the spring by `dt` seconds toward `target`. Mutates and returns `s`.
 *
 * Each substep is the exact solution of the damped spring over that substep (critically or over
 * damped, with zeta from the velocity at its start), not an Euler step: an Euler step at 16 rad/s and
 * 120 Hz is a little under-damped and lets a stopping jump creep past its end.
 */
export function step(s: SpringState, target: number, dt: number, p: SpringParams): SpringState {
  const w = p.omega;
  const z0 = p.zeta ?? 1;
  let left = Math.max(dt, 0);
  while (left > 1e-9) {
    const h = Math.min(SUBSTEP, left);
    left -= h;
    const e0 = s.x - target;
    const v0 = s.v;
    if (e0 === 0 && v0 === 0) break;
    const zeta = Math.max(z0, 1) + 0.4 * smoothstep(Math.abs(v0), 0.05, 0.4);
    let e: number;
    let v: number;
    if (zeta - 1 < 1e-4) {
      const k = Math.exp(-w * h);
      const b = v0 + w * e0;
      e = (e0 + b * h) * k;
      v = (v0 - w * b * h) * k;
    } else {
      const q = Math.sqrt(zeta * zeta - 1);
      const r1 = -w * (zeta - q);
      const r2 = -w * (zeta + q);
      const c1 = (v0 - r2 * e0) / (r1 - r2);
      const c2 = e0 - c1;
      const k1 = Math.exp(r1 * h);
      const k2 = Math.exp(r2 * h);
      e = c1 * k1 + c2 * k2;
      v = c1 * r1 * k1 + c2 * r2 * k2;
    }
    if (e0 !== 0 && e !== 0 && Math.sign(e) !== Math.sign(e0)) {
      // overshoot guard: arriving faster than the spring can stop (the target stopped dead, or turned
      // back to meet it), it lands on the target and stops there instead of swinging back past it.
      // (Cutting the velocity to a fifth, the first version, still came back by a pixel or so.) The
      // crossing is inside one 1/120 s substep, so the landing moves it by less than that substep's travel.
      s.x = target;
      s.v = 0;
      continue;
    }
    s.x = target + e;
    s.v = v;
  }
  if (Math.abs(target - s.x) < SNAP_ERR && Math.abs(s.v) < SNAP_VEL) {
    s.x = target;
    s.v = 0;
  }
  return s;
}

/**
 * The detour's speed limit: a flick may not carry the detour clock faster than `maxURate` (u per
 * second), so both cuts always play under their flare instead of being stepped over between two
 * frames. `ps` is where the detour starts in progress and `w` its share. Returns the capped progress;
 * when it caps, the velocity is set to what was actually travelled.
 */
export function capDetour(s: SpringState, prev: number, ps: number, w: number, maxURate: number, dt: number): void {
  if (!(w > 0)) return;
  const next = s.x;
  const lo = Math.min(prev, next);
  const hi = Math.max(prev, next);
  const cap = maxURate * w * dt;
  if (hi > ps && lo < ps + w && hi - lo > cap) {
    s.x = prev + Math.sign(next - prev) * cap;
    s.v = (s.x - prev) / Math.max(dt, 1e-4);
  }
}
