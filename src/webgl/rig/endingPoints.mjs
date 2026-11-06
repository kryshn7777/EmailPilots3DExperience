// The ending's flight line (owned by the communications-tower ending, docs/ending.md). pathPoints.mjs appends
// these after the copilot chapter's own points, so this file is the only place the ending's line is authored.
// Contract: the first point is the hand-off from the copilot chapter, H = (250, 19, -3.5) with tangent
// (0.883, -0.469, 0) at t = 0.88. Until the tower ending lands, this holds today's landing line unchanged.
export const ENDING_POINTS = [
  [240, 16, 0],
  [250, 6, 0],
  [258, 1.2, 0],
  [266, 0.55, 0],
  [271, 0.5, 1.6],
  [275, 0.55, 7],
  [277.6, 0.8, 13],
  [278, 1.05, 19.1],
];

/** where the Landing group stands (Engine mounts `new Landing(LANDING_ANCHOR)`) */
export const LANDING_ANCHOR = [270, 0.5, 0];
