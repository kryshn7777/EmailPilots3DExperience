import { Vector3 } from 'three';
import { CHAPTERS } from '../../story/chapters';
import { T_S, DETOUR, smooth } from './detour';
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
 * `paceLin` is the cumulative integral of rho, normalised separately on [0, T_S] and [T_S, 1], so 0, T_S
 * and 1 stay fixed: the office detour leaves from and rejoins the same scroll positions as before.
 *
 * The office has its own, smaller dwell on its clock `u` (paceU): slope 1 around both cuts (so
 * MAX_U_RATE and the flares behave exactly as before), slower over the received card.
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
 * Dwell: where the pace slows, as a multiplier on the pixels per world unit. The pinned titles
 * (PinnedTitles.ts SPOTS, copied: each over [from + 0.014, to - 0.014]), the lighthouse delivery,
 * touchdown and the launch from the laptop.
 */
const TITLES: [number, number][] = [
  [-0.007, 0.047], [0.098, 0.152], [0.163, 0.217], [0.288, 0.342], [0.388, 0.442], [0.452, 0.512],
  [0.518, 0.572], [0.568, 0.622], [0.688, 0.742], [0.788, 0.842], [0.93, 0.968],
];
const DWELLS: { a: number; b: number; amt: number }[] = [
  ...TITLES.map(([from, to]) => ({ a: from + 0.014, b: to - 0.014, amt: 0.35 })),
  { a: 0.518, b: 0.566, amt: 0.3 }, // the delivery
  { a: 0.936, b: 0.956, amt: 0.3 }, // touchdown
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
  const a = new Vector3();
  const b = new Vector3();
  const cam = new Vector3();
  // s': the chapter's arc length over its span of t (toArcT is linear per chapter, so this is the
  // flight line's speed per unit t; sampling it pointwise picks up the arc-length table's ripple)
  const chapterSpeed = CHAPTERS.map((c) => {
    let len = 0;
    path.pointAt(c.t0, a);
    for (let k = 1; k <= 400; k++) {
      path.pointAt(c.t0 + ((c.t1 - c.t0) * k) / 400, b);
      len += a.distanceTo(b);
      a.copy(b);
    }
    return Math.max(len / (c.t1 - c.t0), 1e-3);
  });
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    let ci = 0;
    while (ci < CHAPTERS.length - 1 && t >= CHAPTERS[ci + 1]!.t0) ci++;
    speed[i] = chapterSpeed[ci]!;
    cameraAt(path, rig, t, cam);
    let h = Math.min(Math.max(cam.y - floorAt(t, cam.y), H_MIN), H_MAX);
    // the city canyon: the walls either side are closer than the street below
    if (t > 0.69 && t < 0.75) h = Math.min(h, 5);
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
  // normalised separately on [0, T_S] and [T_S, 1]: 0, T_S and 1 stay fixed
  const iS = Math.round(T_S * N);
  const cS = cum[iS]!;
  const c1 = cum[N]!;
  const lin = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    lin[i] = i <= iS ? (T_S * cum[i]!) / cS : T_S + ((1 - T_S) * (cum[i]! - cS)) / (c1 - cS);
  }
  lin[0] = 0;
  lin[iS] = T_S;
  lin[N] = 1;
  // relative density vs today's (1/N per bin), each half on its own normalisation
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

  // --- the office clock ---
  const U = buildU();
  return {
    paceT,
    paceLin,
    paceU: U.paceU,
    paceUinv: U.paceUinv,
    ratioAt: (t) => ratio[Math.min(Math.max(Math.floor(t * N), 0), N - 1)]!,
  };
}

/**
 * The office dwell. Density in u (pixels per unit u, relative): 1 within 0.03 of either cut, 1/0.65
 * over the received card (0.45..0.62), a constant elsewhere that keeps the total at 1, with 0.01 ramps.
 */
function buildU(): { paceU(ul: number): number; paceUinv(u: number): number } {
  const M = 2000;
  const near = (u: number): number => {
    let k = 0;
    for (const c of [DETOUR.cutIn, DETOUR.cutOut]) k = Math.max(k, smooth(u, c - 0.04, c - 0.03) * (1 - smooth(u, c + 0.03, c + 0.04)));
    return k;
  };
  const dwell = (u: number): number => smooth(u, 0.44, 0.45) * (1 - smooth(u, 0.62, 0.63));
  const shape = (u: number, c: number): number => {
    const base = c + (1 / 0.65 - c) * dwell(u);
    return base + (1 - base) * near(u);
  };
  const total = (c: number): number => {
    let s = 0;
    for (let i = 0; i < M; i++) s += shape((i + 0.5) / M, c) / M;
    return s;
  };
  // solve for the constant (total is increasing in c)
  let a = 0.2;
  let b = 2;
  for (let k = 0; k < 50; k++) {
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
  return { paceU, paceUinv };
}

/** chapter starts, for the rail's ticks */
export const CHAPTER_T0 = CHAPTERS.map((c) => c.t0);
