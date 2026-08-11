import { CatmullRomCurve3, Vector3 } from 'three';
import { CHAPTERS } from '../../story/chapters';
import { CH_START_INDEX, PATH_POINTS } from './pathPoints.mjs';

/**
 * The one flight line. Control points are authored per chapter zone (in
 * pathPoints.mjs, shared with the Node bake scripts); the curve is
 * centripetal Catmull-Rom so sharp slalom sections don't overshoot.
 * World actors place themselves off chapter anchor points from this path.
 */

const POINTS: Vector3[] = PATH_POINTS.map(([x, y, z]) => new Vector3(x, y, z));

export class FlightPath {
  readonly curve = new CatmullRomCurve3(POINTS, false, 'centripetal');

  /** arc-length t of each chapter zone boundary: [start_0..start_9, 1] */
  private zoneArcT: number[] = [];

  constructor() {
    // The curve is arc-length parameterized, but story chapters must map to
    // their AUTHORED zones. Compute each zone boundary's arc-t, then remap
    // story-t chapter-by-chapter. Without this, chapter windows drift far
    // past their scenery (the original desk was left behind at t≈0.01).
    const divisions = 512;
    const lengths = this.curve.getLengths(divisions);
    const total = lengths[divisions]!;
    const n = POINTS.length - 1;
    for (const idx of CH_START_INDEX) {
      const u = idx / n;
      const li = Math.min(Math.round(u * divisions), divisions);
      this.zoneArcT.push(lengths[li]! / total);
    }
    this.zoneArcT.push(1);
  }

  /** story-t (chapter timeline) → arc-length t on the curve */
  private toArcT(storyT: number): number {
    const t = clamp01(storyT);
    for (let i = CHAPTERS.length - 1; i >= 0; i--) {
      const c = CHAPTERS[i]!;
      if (t >= c.t0) {
        const local = (t - c.t0) / (c.t1 - c.t0);
        const a0 = this.zoneArcT[i]!;
        const a1 = this.zoneArcT[i + 1]!;
        return a0 + (a1 - a0) * Math.min(local, 1);
      }
    }
    return 0;
  }

  pointAt(storyT: number, target: Vector3): Vector3 {
    return this.curve.getPointAt(this.toArcT(storyT), target);
  }

  tangentAt(storyT: number, target: Vector3): Vector3 {
    return this.curve.getTangentAt(this.toArcT(storyT), target);
  }

  /** World point for a story-t — for placing actors on the flight line. */
  storyPoint(storyT: number): Vector3 {
    return this.curve.getPointAt(this.toArcT(storyT), new Vector3());
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
