import { CatmullRomCurve3, Vector3 } from 'three';
import { CH_START_INDEX, PATH_KNOTS, PATH_POINTS } from './pathPoints.mjs';

/**
 * The one flight line. Control points are authored per chapter zone (in
 * pathPoints.mjs, shared with the Node bake scripts); the curve is
 * centripetal Catmull-Rom so sharp slalom sections don't overshoot.
 * World actors place themselves off chapter anchor points from this path.
 */

const POINTS: Vector3[] = PATH_POINTS.map(([x, y, z]) => new Vector3(x, y, z));

interface Knot {
  /** story-t */
  t: number;
  /** arc-length fraction of the curve at the knot's control point */
  a: number;
  mode?: 'left' | 'right' | 'mean';
}

export class FlightPath {
  readonly curve = new CatmullRomCurve3(POINTS, false, 'centripetal');

  /** arc-length t of each chapter zone boundary: [start_0..start_9, 1] (chapter anchors only) */
  private zoneArcT: number[] = [];
  /** the timing knots (pathPoints.mjs PATH_KNOTS, plus the end), and the arc-t slope of each side of each */
  private knots: Knot[] = [];
  private slopes: (number | null)[] = [];
  private secants: number[] = [];
  /** the curve's length, world units */
  readonly length: number;

  constructor() {
    // The curve is arc-length parameterized, but story-t must reach each authored point at its own moment (the
    // chapters, the tower). Each knot is a control point's arc-t; story-t maps to arc-t through them, linearly
    // between plain knots (the dart's speed is constant there) and smoothly across a knot with a mode.
    //
    // --- scroll feel --- the arc-length table is fine enough that the dart's speed per unit t is
    // constant within a stretch: three's default (200 divisions) interpolates t linearly inside each
    // division, so the speed rippled by about +-10% every ~1.6 units, and the zone boundaries (measured
    // here on a different table) put a dip-and-spike in the speed at every seam (0.78: 290 -> 487 world
    // per unit t). The positions this moves are within ~0.05 units of the old ones.
    const divisions = 4096;
    this.curve.arcLengthDivisions = divisions;
    const lengths = this.curve.getLengths(divisions);
    const total = lengths[divisions]!;
    this.length = total;
    const n = POINTS.length - 1;
    const arcAt = (idx: number): number => {
      const x = (idx / n) * divisions;
      const i = Math.min(Math.floor(x), divisions - 1);
      return (lengths[i]! + (lengths[i + 1]! - lengths[i]!) * (x - i)) / total;
    };
    for (const idx of CH_START_INDEX) this.zoneArcT.push(arcAt(idx));
    this.zoneArcT.push(1);
    for (const [idx, t, mode] of PATH_KNOTS) this.knots.push({ t, a: arcAt(idx), ...(mode ? { mode } : {}) });
    this.knots.push({ t: 1, a: 1 });
    const K = this.knots;
    for (let j = 0; j < K.length - 1; j++) this.secants.push((K[j + 1]!.a - K[j]!.a) / (K[j + 1]!.t - K[j]!.t));
    this.slopes = K.map((k, j) => {
      const l = this.secants[Math.max(j - 1, 0)]!;
      const r = this.secants[Math.min(j, this.secants.length - 1)]!;
      if (k.mode === 'left') return l;
      if (k.mode === 'right') return r;
      if (k.mode === 'mean') return (2 * l * r) / (l + r);
      return null;
    });
  }

  /** story-t → arc-length t on the curve */
  private toArcT(storyT: number): number {
    const t = clamp01(storyT);
    const K = this.knots;
    let j = 0;
    while (j < K.length - 2 && t >= K[j + 1]!.t) j++;
    const k0 = K[j]!;
    const k1 = K[j + 1]!;
    const h = k1.t - k0.t;
    const s = Math.min(Math.max((t - k0.t) / h, 0), 1);
    const m0 = this.slopes[j];
    const m1 = this.slopes[j + 1];
    if (m0 === null && m1 === null) return k0.a + (k1.a - k0.a) * s;
    const sec = this.secants[j]!;
    const a0 = m0 ?? sec;
    const a1 = m1 ?? sec;
    const s2 = s * s;
    const s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * k0.a + (s3 - 2 * s2 + s) * h * a0 + (-2 * s3 + 3 * s2) * k1.a + (s3 - s2) * h * a1;
  }

  pointAt(storyT: number, target: Vector3): Vector3 {
    return this.curve.getPointAt(clamp01(this.toArcT(storyT)), target);
  }

  tangentAt(storyT: number, target: Vector3): Vector3 {
    return this.curve.getTangentAt(clamp01(this.toArcT(storyT)), target);
  }

  /** The dart's speed along the line at story-t, world units per unit of story-t (exact, from the timing knots). */
  speedAt(storyT: number): number {
    const e = 1e-5;
    const a = Math.max(storyT - e, 0);
    const b = Math.min(storyT + e, 1);
    return ((this.toArcT(b) - this.toArcT(a)) / (b - a)) * this.length;
  }

  /** World point for a story-t — for placing actors on the flight line. */
  storyPoint(storyT: number): Vector3 {
    return this.curve.getPointAt(clamp01(this.toArcT(storyT)), new Vector3());
  }

  /** World anchor for a chapter (its zone midpoint). */
  chapterAnchor(index: number): Vector3 {
    const a0 = this.zoneArcT[index]!;
    const a1 = this.zoneArcT[index + 1]!;
    return this.curve.getPointAt((a0 + a1) / 2, new Vector3());
  }
}

function clamp01(t: number): number {
  return Math.min(Math.max(t, 0), 1);
}
