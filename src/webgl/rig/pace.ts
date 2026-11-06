import { Vector3 } from 'three';
import { CHAPTERS } from '../../story/chapters';
import { T_S, T_E, D_T, DETOUR, detourMap, detourStart, progressOf, smooth, tOfU, type DetourState } from './detour';
import { studyShot } from './studyShot';
import type { FlightPath } from './FlightPath';
import type { CameraRig } from './CameraRig';

/**
 * The scroll's pace: how much story each pixel of scroll carries.
 *
 * Story-t is tied to fixed world positions all over the engine (the lighthouse shot, the holds, the
 * pinned titles, the cuts), so the pace is NOT built into the flight line (FlightPath.toArcT): it is a
 * warp of scroll -> t. The dart stands at the same place for every t; only the number of pixels each
 * stretch of t is given changes. The Engine maps
 *
 *   scroll p -> detourMap(p).t = tl (linear, as before) -> t = paceT(tl)
 *
 * and the inverse (idle presets, the progress rail's ticks, jumps) is `progressOf(paceLin(t), W)`.
 *
 * Why: `toArcT` is linear per chapter, so the world's speed per pixel jumped at every chapter seam
 * (2.35 -> 5.0 world units per 100 px at preflight -> takeoff) and ran from 0.9 at the desk to 5.0 in
 * the street. The warp asks for a world speed per pixel that follows the camera's height over what is
 * under it (what you see is angular speed, so a low pass reads faster: v* = h^0.6 / dwell), blended
 * 65/35 with today's authored balance, smoothed, and clamped to half/double today's pixels. World speed
 * per pixel is 1/sigma, continuous across the seams (the steps in the flight line's own speed are
 * cancelled by the pixel density rho = s' * sigma).
 *
 * `paceLin` is the cumulative integral of rho, normalised separately on [0, T_S] and [T_E, 1], so 0, T_S, T_E
 * and 1 stay fixed: the office detour's stretch of scroll is where it always was.
 *
 * Inside the detour (story-t T_S..T_E, its own spacer of scroll) the office clock `u` has its own pace (paceU):
 * outside the two cuts the dart is on the flight line in the city, and there the pixels per unit u are matched
 * to the main warp's at T_S and T_E, so the dart's world speed per pixel does not jump at the detour's edges; the
 * office between the cuts gets the rest, at one even density (the dart crosses the room at one speed), never
 * faster than one unit of u per unit of u_lin around the cuts (so MAX_U_RATE still holds every flare on screen).
 * Out of the far face the pace eases from the office's up to the line's: the burst through the glass is slow.
 *
 * Pure apart from sampling the path and the rig once (`paceInputs`); scripts/check-pace.mjs tests it.
 */

/** bins over story-t */
const N = 2000;
/** today's balance kept in the blend (Q3: 0.65 new, 0.35 authored) */
const BLEND = 0.65;
/** Gaussian smoothing of log sigma, in story-t */
const SMOOTH_T = 0.012;
/** the new pixels per stretch of t stay within this factor of today's */
const RATIO_MIN = 0.5;
const RATIO_MAX = 2.0;
/** heights clamp (world units) */
const H_MIN = 0.8;
const H_MAX = 14;

/**
 * What the camera sees under it, world y, by story-t (the reference its speed reads against).
 * Checked against the scene: the study desk top (Desk at y 1.29), the town's ground (cityGen's
 * ROOFTOP_BASE_Y, -3.2), the formation cloud deck (centred on chapterAnchor(3).y ~25, puffs from about
 * 21 up), the sea under the storm and the lighthouse (Beacon: anchor 19.9 - 13 + 0.15 ~ 7), the city
 * street (0) and the airfield (0.5).
 */
export function floorAt(t: number, _camY?: number): number {
  const k = (a: number, b: number): number => smooth(t, a, b);
  let y = 1.29; // the desk
  y += (-3.2 - y) * k(0.088, 0.1); // the town from the window on
  y += (21 - y) * k(0.27, 0.3); // into the formation's cloud deck
  y += (7 - y) * k(0.38, 0.42); // the storm lets down over the sea, the lighthouse
  y += (0 - y) * k(0.58, 0.62); // the no-fly zones over the city, the canyon, the copilot climb
  y += (0.5 - y) * k(0.9, 0.92); // the airfield
  return y;
}

/** The camera's base pose at t (no turbulence or damping): the chase cam, the study's shot over the desk. */
export function cameraAt(path: FlightPath, rig: CameraRig, t: number, out: Vector3): Vector3 {
  rig.mainPose(t, out, LOOK);
  const study = 1 - smooth(t, 0.1, 0.112);
  if (study > 0) {
    studyShot(t, path, STUDY, LOOK, 16 / 9);
    out.lerp(STUDY, study);
  }
  return out;
}
const LOOK = new Vector3();
const STUDY = new Vector3();

/**
 * Dwell: where the pace slows, as a multiplier on the pixels per world unit. The pinned titles (the title windows
 * of the scene direction's table, which PinnedTitles.ts SPOTS follow: each over [from + 0.014, to - 0.014]), the
 * lighthouse delivery, the storm's strike on the BCC bomber, the flight report at the crest, the rise up the
 * communications tower, the received screen and the reply, and the launch from the laptop.
 */
const TITLES: [number, number][] = [
  [-0.007, 0.047], [0.098, 0.152], [0.163, 0.217], [0.288, 0.342], [0.388, 0.442], [0.452, 0.512],
  [0.518, 0.572], [0.568, 0.622], [0.688, 0.742], [0.8, 0.85], [0.958, 0.985],
];
const DWELLS: { a: number; b: number; amt: number }[] = [
  ...TITLES.map(([from, to]) => ({ a: from + 0.014, b: to - 0.014, amt: 0.35 })),
  { a: 0.518, b: 0.566, amt: 0.3 }, // the delivery
  { a: 0.408, b: 0.422, amt: 0.3 }, // the strike on the BCC bomber
  { a: 0.858, b: 0.882, amt: 0.35 }, // the flight report
  { a: 0.94, b: 0.955, amt: 0.25 }, // the rise up the tower
  { a: 0.986, b: 0.998, amt: 0.4 }, // received, and the reply
  { a: 0.02, b: 0.05, amt: 0.2 }, // the launch
];
const RAMP = 0.01;
export function dwellAt(t: number): number {
  let d = 1;
  for (const w of DWELLS) d += w.amt * smooth(t, w.a - RAMP, w.a) * (1 - smooth(t, w.b, w.b + RAMP));
  return d;
}

export interface PaceInputs {
  /** per bin: the flight line's world speed per unit of story-t (s') */
  speed: Float64Array;
  /** per bin: the camera's height over the floor */
  height: Float64Array;
  /** per bin: the camera's acceleration in story-t, |d2 cam / dt2| */
  camAcc: Float64Array;
}

/** Samples the flight line and the camera once (2000 bins; a few ms). */
export function paceInputs(path: FlightPath, rig: CameraRig): PaceInputs {
  const speed = new Float64Array(N);
  const height = new Float64Array(N);
  const camAcc = new Float64Array(N);
  const c0 = new Vector3();
  const c2 = new Vector3();
  const cam = new Vector3();
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    // s': the flight line's speed per unit t, exact from its timing knots (FlightPath: constant between plain
    // knots, easing across a smooth one; sampling positions instead would pick up the arc-length table's ripple)
    speed[i] = Math.max(path.speedAt(t), 1e-3);
    cameraAt(path, rig, t, cam);
    let h = Math.min(Math.max(cam.y - floorAt(t, cam.y), H_MIN), H_MAX);
    // the city canyon: the walls either side are closer than the street below
    if (t > 0.69 && t < 0.745) h = Math.min(h, 5);
    height[i] = h;
    const d = 1 / N;
    cameraAt(path, rig, Math.max(t - d, 0), c0);
    cameraAt(path, rig, Math.min(t + d, 1), c2);
    camAcc[i] = c0.add(c2).addScaledVector(cam, -2).length() / (d * d);
  }
  return { speed, height, camAcc };
}

export interface Pace {
  /** linear story-t (from the scroll) -> story-t */
  paceT(tl: number): number;
  /** story-t -> linear story-t (then progressOf(..., W) for the scroll) */
  paceLin(t: number): number;
  /** the office clock: linear u (from the scroll) -> u */
  paceU(ul: number): number;
  /** u -> linear u */
  paceUinv(u: number): number;
  /** pixels per unit t, relative to today's (1 = unchanged), at story-t: for the ?perf overlay */
  ratioAt(t: number): number;
  /** the detour's share of the scroll (measured by the Engine): the office clock's pace depends on it */
  setDetourShare(w: number): void;
  /** the office's pixel density in u (relative to the spacer's even 1): its slope at the cuts is 1 over this */
  officeDensity(): number;
}

export function buildPace(inp: PaceInputs): Pace {
  const { speed, height, camAcc } = inp;
  // Where the camera already swings hard today (a chapter's rig blending into the next, the climbs),
  // the warp may not hurry the scroll: the camera's acceleration per pixel goes with the square of the
  // speed. Below today's 95th percentile it may speed up as far as the clamp allows; above it, not at all.
  const sorted = Float64Array.from(camAcc).sort();
  const acc95 = Math.max(sorted[Math.floor(N * 0.95)]!, 1e-9);
  const logSigma = new Float64Array(N);
  const logR = new Float64Array(N);
  let mean = 0;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    // 1/v* = dwell / h^0.6: pixels per world unit asked for
    const ls = BLEND * Math.log(dwellAt(t) / Math.pow(height[i]!, 0.6)) + (1 - BLEND) * Math.log(1 / speed[i]!);
    logR[i] = ls + Math.log(speed[i]!); // vs today's sigma = 1/s'
    mean += logR[i]!;
  }
  mean /= N;
  // centred (the total length is kept: Q2), clamped to [0.5, 2] of today's, BEFORE the smoothing so
  // the world speed stays continuous wherever the clamp bites
  const lo = Math.log(RATIO_MIN);
  const hi = Math.log(RATIO_MAX);
  for (let i = 0; i < N; i++) {
    const floor = Math.log(Math.min(Math.max(Math.sqrt(camAcc[i]! / acc95), RATIO_MIN), 1));
    const r = Math.min(Math.max(logR[i]! - mean, lo, floor), hi);
    logSigma[i] = r - Math.log(speed[i]!);
  }
  // Gaussian smoothing of log sigma (edges clamped)
  const sm = new Float64Array(N);
  const sd = SMOOTH_T * N;
  const rad = Math.ceil(sd * 3);
  const kern: number[] = [];
  for (let k = -rad; k <= rad; k++) kern.push(Math.exp(-0.5 * (k / sd) * (k / sd)));
  for (let i = 0; i < N; i++) {
    let acc = 0;
    let wsum = 0;
    for (let k = -rad; k <= rad; k++) {
      const j = Math.min(Math.max(i + k, 0), N - 1);
      const w = kern[k + rad]!;
      acc += logSigma[j]! * w;
      wsum += w;
    }
    sm[i] = acc / wsum;
  }
  // pixel density per unit t, and its integral at the bin edges
  const cum = new Float64Array(N + 1);
  const ratio = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const rho = speed[i]! * Math.exp(sm[i]!);
    ratio[i] = rho;
    cum[i + 1] = cum[i]! + rho / N;
  }
  // normalised separately on [0, T_S] and [T_E, 1]: 0, T_S, T_E and 1 stay fixed (the detour's own stretch,
  // T_S..T_E, is the spacer's: paceU below; the identity here)
  const iS = Math.round(T_S * N);
  const iE = Math.round(T_E * N);
  const cS = cum[iS]!;
  const cE = cum[iE]!;
  const c1 = cum[N]!;
  const lin = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    lin[i] = i <= iS ? (T_S * cum[i]!) / cS
      : i < iE ? T_S + ((T_E - T_S) * (i - iS)) / (iE - iS)
        : T_E + ((1 - T_E) * (cum[i]! - cE)) / (c1 - cE);
  }
  lin[0] = 0;
  lin[iS] = T_S;
  lin[iE] = T_E;
  lin[N] = 1;
  // relative density vs today's (1/N per bin), each part on its own normalisation
  for (let i = 0; i < N; i++) ratio[i] = (lin[i + 1]! - lin[i]!) * N;

  const paceLin = (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const x = t * N;
    const i = Math.min(Math.floor(x), N - 1);
    return lin[i]! + (lin[i + 1]! - lin[i]!) * (x - i);
  };
  const paceT = (tl: number): number => {
    if (tl <= 0) return 0;
    if (tl >= 1) return 1;
    if (tl === T_S) return T_S;
    if (tl === T_E) return T_E;
    let a = 0;
    let b = N;
    while (b - a > 1) {
      const m = (a + b) >> 1;
      if (lin[m]! <= tl) a = m;
      else b = m;
    }
    const d = lin[b]! - lin[a]!;
    return (a + (d > 0 ? (tl - lin[a]!) / d : 0)) / N;
  };

  // --- the office clock: the line's pixel density either side of the detour, as density in u ---
  // world per unit scroll just outside the spacer is s' (1 - D_T) / ((1 - W) ratio); inside it s' D_T / (W rho)
  const ratioS = ratio[iS - 1]!;
  const ratioE = ratio[iE]!;
  let w = W_HOME;
  let U = buildU(w, ratioS, ratioE);
  return {
    paceT,
    paceLin,
    paceU: (ul) => U.paceU(ul),
    paceUinv: (u) => U.paceUinv(u),
    ratioAt: (t) => ratio[Math.min(Math.max(Math.floor(t * N), 0), N - 1)]!,
    setDetourShare(share: number): void {
      if (!(share > 0) || Math.abs(share - w) < 1e-6) return;
      w = share;
      U = buildU(w, ratioS, ratioE);
    },
    officeDensity: () => U.office,
  };
}

/** the detour's share of the scroll on the home page (Experience.astro: a 120vh spacer in a 1220vh timeline) */
export const W_HOME = 120 / 1220;

/**
 * Scroll progress -> story-t and the detour clock, through the pace: the Engine's mapping (check-pace and
 * check-line replay it). Outside the detour the warp of story-t; inside it the office clock's pace, and t follows u.
 */
export function mapScroll(pace: Pace, p: number, w: number): DetourState {
  const m = detourMap(p, w);
  if (m.active) {
    const u = pace.paceU(m.u);
    return { t: tOfU(u), u, active: true };
  }
  return { t: pace.paceT(m.t), u: 0, active: false };
}

/** The inverse: the scroll progress that shows story-t `t`, or the detour at clock `u` (exact). */
export function scrollFor(pace: Pace, w: number, t: number, u?: number): number {
  if (u !== undefined || (t > T_S && t < T_E)) {
    const uu = Math.min(Math.max(u ?? (t - T_S) / D_T, 0), 1);
    if (!(w > 0)) return progressOf(pace.paceLin(tOfU(uu)), w);
    return detourStart(w) + pace.paceUinv(uu) * w;
  }
  return progressOf(pace.paceLin(t), w);
}

/**
 * The office clock's pace. Density in u (pixels per unit u, relative to the spacer's even 1): in the run at the
 * glass (before the first cut) and out of the far face (after the second), the main warp's density at T_S and
 * T_E carried across, so the dart's world speed per pixel is the line's; between the cuts and 0.025 either side of
 * them (where the flare is up) one even density for the office, solved so the total is 1 (about 1.5: it is never
 * under 1, so u never runs faster than u_lin there and MAX_U_RATE keeps each flare on screen); out of the far face
 * it eases from the office's density down to the line's over 0.14 of u (the burst through the glass is slow).
 */
function buildU(w: number, ratioS: number, ratioE: number): { paceU(ul: number): number; paceUinv(u: number): number; office: number } {
  const M = 2000;
  const k = (D_T * (1 - w)) / (w * (1 - D_T));
  const rhoIn = k * ratioS;
  const rhoOut = k * ratioE;
  // On the way in the dart keeps the line's speed right up to the glass (the cut is a hard flash: the run-in is a
  // few pixels of scroll) and the office's density takes over just after the cut, under the flare's peak, so the
  // dart never slows down in plain view; the far side of the flare, in the office, is at the office's density.
  // On the way out the office's density holds through the flare, then eases down to the line's.
  // The burst eases the speed (u per pixel, 1 / density) up so the pixels see an even acceleration: its square
  // runs from the office's to the line's on a smoothstep in u (a constant d(v^2)/du is a constant dv/dpx).
  const R_IN = 0.004;
  const B_OUT = 0.025;
  const shape = (u: number, rhoOff: number): number => {
    if (u < 0.5) return rhoIn + (rhoOff - rhoIn) * smooth(u, DETOUR.cutIn, DETOUR.cutIn + R_IN);
    const v0 = 1 / rhoOff;
    const v1 = 1 / rhoOut;
    const k = smooth(u, DETOUR.cutOut + B_OUT, 0.99);
    return 1 / Math.sqrt(v0 * v0 + (v1 * v1 - v0 * v0) * k);
  };
  const total = (c: number): number => {
    let s = 0;
    for (let i = 0; i < M; i++) s += shape((i + 0.5) / M, c) / M;
    return s;
  };
  // solve for the office's density (the total is increasing in it)
  let a = 0.05;
  let b = 20;
  for (let q = 0; q < 60; q++) {
    const m = (a + b) / 2;
    if (total(m) < 1) a = m;
    else b = m;
  }
  const c = (a + b) / 2;
  const L = new Float64Array(M + 1);
  for (let i = 0; i < M; i++) L[i + 1] = L[i]! + shape((i + 0.5) / M, c) / M;
  for (let i = 0; i <= M; i++) L[i] = L[i]! / L[M]!;
  const paceUinv = (u: number): number => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    const x = u * M;
    const i = Math.min(Math.floor(x), M - 1);
    return L[i]! + (L[i + 1]! - L[i]!) * (x - i);
  };
  const paceU = (ul: number): number => {
    if (ul <= 0) return 0;
    if (ul >= 1) return 1;
    let lo = 0;
    let hi = M;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (L[m]! <= ul) lo = m;
      else hi = m;
    }
    const d = L[hi]! - L[lo]!;
    return (lo + (d > 0 ? (ul - L[lo]!) / d : 0)) / M;
  };
  return { paceU, paceUinv, office: c };
}

/** chapter starts, for the rail's ticks */
export const CHAPTER_T0 = CHAPTERS.map((c) => c.t0);
