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
  // The plane leaves the window and dives into the town: over the front yards, down into the
  // street (z 10..16, the asphalt is 2.4 wide on its centre line z = 13), then it runs along it
  // below the rooftops, between the houses and the street trees, with the lamps either side. At
  // about x = 42 it pulls up over the street and climbs steeply into the cloud sea. (It used to
  // climb away from the window at once: the town was something seen from above, never flown through.)
  [14, 1.7, 4.5],
  // over the back rows' front yards, still above the roofs and chimneys
  [20, 0.9, 9.0],
  // CH3 takeoff — down into the street's corridor: the lamp arms reach 0.5 out from z 10.55 and
  // 15.45, so z 12.2..13.8 keeps clear of them, and the street trees are on the verge outside that
  [25, -0.8, 12.3],
  [30, -1.7, 13],
  [35, -1.9, 13],
  [39, -1.75, 13],
  // pull up over the street
  [43, -0.2, 12.5],
  [47.5, 3.6, 11],
  [52, 10.2, 9],
  [56, 17.4, 6.8],
  // CH4 formation — S through the cloud sea, above the city but not in orbit
  // over it: the climb tops out at 26, having gained 17 since CH3 started at
  // 9. The first pass gained 43 and put the district so far below that it
  // stopped reading as a city at all.
  [60, 24, 5],
  [70, 26, -4],
  [80, 25, 3],
  // CH5 storm — the let-down out of the high air, landing on the
  // original altitude by its last point so CH6's approach is undisturbed.
  // It used to be a slalom of +-6 swings through three gates; that was a lot of
  // bends in a short run, so it is now a gentle drift (+-2) through one gate
  [88, 23, -1],
  [94, 21, 2],
  [100, 19, -1.5],
  [106, 17, 1.5],
  [110, 15.5, -1.5],
  // CH6 beacon — calm rising arc, then the delivery: the dart climbs the last
  // stretch to the lantern, flies in through its glass (it dissolves into the lamp
  // there, the Engine shrinks it to nothing at the lantern's centre) and comes out
  // the far side. The three points either side of LANTERN are that pass; the
  // lighthouse itself is pinned at BEACON_ANCHOR, not derived from this zone.
  [122, 18, 0],
  [134, 20, -4],
  [138.8, 22.8, -5.3],
  [143.06, 25.8, -6.46], // the lantern room's centre
  [147.3, 26.3, -6.3],
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
  [150.5, 21, -3], // leaves the lamp in a long left-hand descent to the no-fly zones
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
export const CH_START_INDEX = [0, 3, 6, 14, 17, 22, 27, 30, 34, 37];

/**
 * Where the lighthouse stands, as the anchor Beacon hangs it from (the island sits at
 * +8, -13, -2.5 from this). It used to be the CH6 zone's midpoint; the zone now runs
 * through the lantern, so the old value is pinned here and the tower stays put.
 */
export const BEACON_ANCHOR = [135.06, 19.9, -3.96];
export const LANTERN = [143.06, 25.8, -6.46];
/**
 * Where the pre-flight checklist board stands (it used to hang off CH2's zone midpoint, which moved
 * when the plane started flying down the street). It stays where the window shot has always had it.
 */
export const PANEL_ANCHOR = [15.844, 6.431, -1.008];
/** The night city's and the copilot scene's anchors, as they were before the town flight changed the zones' midpoints (the baked rings hardcode the city's). */
export const CITY_ANCHOR = [193.819, 1.872, 1.611];
export const COPILOT_ANCHOR = [224.814, 23.947, 1.171];
