// The flight spline's control points, plain ESM so Node bake scripts can
// import them without a TS loader. FlightPath.ts maps these to Vector3s;
// keep the two consumers in sync by editing ONLY this file.
export const PATH_POINTS = [
  // CH1 desk — starts ON the laptop screen (mid-send), dips over the letter
  [-0.62, 1.75, 0],
  // the dip is shallow now: at 1.25 the line ran below the desk clutter
  [1.2, 1.62, 0.2],
  // clears the Newton's cradle, whose frame tops out at world y≈1.70 — the
  // old 1.5 ran straight through it
  [2.5, 1.98, -0.1],
  // CH2 preflight taxi past the panel, through the middle of the window
  // opening (frame centred at y=2) rather than into its sill and hinge
  [8, 2.06, 1.0],
  // hard climb the moment the window is cleared: at the old y≈2 the camera
  // rode BELOW the rooftops, so the empty apron of the city's ground plane
  // filled the lower frame. Higher camera pushes the frame's bottom ground
  // hit far enough out that buildings cover it.
  [16, 6.5, -1.0],
  // CH3 takeoff — a long shallow cruise ACROSS the district before the climb
  // starts; the old line was already at cloud height by x=32 and the city
  // was behind you before you had looked at it
  [24, 9, 2],
  [33, 13, -2],
  // Then the nose comes up and the district drops away for good. This climb
  // is deliberately long and deliberately steep — four points instead of
  // three — because the whole beat is the distance travelled between the
  // rooftops and the weather. The old 15-unit top left the city still close
  // underneath when the cloud arrived; the deck rides on the CH4 anchor, so
  // taking the path this high carries the whole cloud sea up with it.
  [42, 15, 3],
  [50, 20, -1],
  // CH4 formation — S through the cloud sea, above the city but not in orbit
  // over it: the climb tops out at 26, having gained 17 since CH3 started at
  // 9. The first pass gained 43 and put the district so far below that it
  // stopped reading as a city at all.
  [60, 24, 8],
  [70, 26, -8],
  [80, 25, 6],
  // CH5 storm slalom — the let-down out of the high air, landing on the
  // original altitude by its last point so CH6's approach is undisturbed
  [88, 23, -6],
  [94, 21, 6],
  [100, 19, -6],
  [106, 17, 6],
  [110, 15.5, -4],
  // CH6 beacon — calm rising arc
  [122, 18, 0],
  [134, 20, -4],
  // CH7 no-fly — ONE easy arc around the red zones, not a slalom. The old
  // line ran z −4 → 8 → 14 → 6 → 1 across five control points: an 18-unit
  // swing out and back inside 30 units of travel, which is what made the dart
  // wag through this chapter. Halving the excursion to a single crest keeps
  // the detour readable while the curve stays gentle enough to fly.
  // Flattened again: the crest is now barely a crest. Most of the remaining
  // swing came from the -4 this chapter INHERITS from the end of CH6, so
  // pulling the middle down to +2.5 makes the whole run -4 → 0 → 2.5 → 2 → 1
  // — a drift rather than an arc. The bend around the zones is now carried by
  // where the zones sit, not by throwing the dart sideways.
  [147, 16.5, 0],
  [157, 15, 2.5],
  [167, 13.5, 2],
  // CH8 city dive — the canyon runs world z 0..2 (group z offset 1); the old
  // z −4 leg flew straight through the north building row
  [176, 10, 1],
  [184, 5, 0.4],
  [192, 2.2, 1.6],
  [200, 2.0, 1.0],
  // CH9 copilot climb into the starfield
  [210, 10, -2],
  [220, 20, 0],
  [230, 26, 2],
  // CH10 landing — long descent, touchdown, then the delivery itself: right
  // off the runway, up the apron, in through the arrival office door and
  // into the screen. The last point IS the laptop display.
  [240, 16, 0],
  [250, 6, 0],
  [258, 1.2, 0],
  [266, 0.55, 0],
  [271, 0.5, 1.6],
  [275, 0.55, 7],
  [277.6, 0.8, 13],
  [278, 1.05, 19.1],
];

/** First control-point index of each chapter's zone (matches the blocks). */
export const CH_START_INDEX = [0, 3, 5, 9, 12, 17, 19, 22, 26, 29];
