// The flight spline's control points, plain ESM so Node bake scripts can
// import them without a TS loader. FlightPath.ts maps these to Vector3s;
// keep the two consumers in sync by editing ONLY this file (and endingPoints.mjs for CH10).
import { ENDING_POINTS } from './endingPoints.mjs';

// ---------------------------------------------------------------- the city -> copilot line (docs/flight-line.md)

/**
 * The office detour's timing, in story-t (rig/detour.ts re-exports these). Story-t does not stop in the detour: it
 * runs from T_S to T_S + D_T across the detour's stretch of scroll, u = (t - T_S) / D_T is the office's clock, and
 * the dart is always on the flight line except between the two cuts, when the camera is in the office.
 */
export const DETOUR_TIMING = {
  T_S: 0.79,
  D_T: 0.012,
  /** the dart reaches the tower's west face: flare and cut into the office */
  cutIn: 0.08,
  /** the dart reaches the east face from inside: flare and cut back to the city */
  cutOut: 0.66,
};

/**
 * The tower the dart flies through (the IT office is on one of its floors). Fixed here, offline: the city lot at
 * (217.11, -2.72) world, a twin-slab skyscraper 2.9 deep (x) and 1.94 wide (z), 22.9 tall (cityGen's lot plus the
 * city group's offset (193.819, 0, 1); scripts/check-line.mjs asserts it). The low block in front of it (213.7,
 * -3.3, roof 13.8) hides its west face below about 15, which is why the line comes in high. `entryY` is the line's
 * height on the west face (filled in by the builder below).
 */
export const DETOUR_TOWER = { x: 217.1079, z: -2.7208, hx: 1.4551, hz: 0.9708, h: 22.93, entryY: 0 };

/** The hand-off to the ending (contract with docs/ending.md): H at t 0.88, flying (0.883, -0.469, 0): yaw 0, pitch -28. */
export const HANDOFF = { t: 0.88, p: [250, 19, -3.5], tangent: [0.883, -0.469, 0] };

/**
 * The shape of the line from the canyon to H, in numbers that mean something (world units, degrees). Height is
 * built along x from arcs and straights; the sideways drift toward the tower is one smooth move in z(x); x only
 * ever grows, so the line cannot turn back.
 */
export const LINE = {
  /** the canyon run's z */
  canyonZ: 0.7,
  /** the climb leaves the street here (x), level, at this height */
  climbX: 197.2,
  climbY: 1.15,
  /** the climb's two bends: pulling up out of the street, and easing down onto the tower's pitch (radii) */
  pullR: 6,
  easeR: 8,
  /**
   * The straight through the tower: its pitch, how far before the west face it starts (it must start before the
   * low block, to clear its roof by 1.5), and its z on the west face. Its yaw is solved so that it carries the line
   * to H's z with no second sideways move.
   */
  towerPitch: 24,
  towerPre: 5,
  towerZ: -2.35,
  /** the crest: its radius over the top and into the descent, and the straight descent's run into H */
  crestR: 25,
  descentR: 25,
  descentRun: 3.9,
  /**
   * The sideways drift toward the tower, by x: it eases in from the canyon's heading (driftX..driftFull), holds one
   * steady heading, and eases onto the tower straight's (driftEase..the straight).
   */
  driftX: 194,
  driftFull: 199,
  driftEase: 207.6,
};

const DEG = Math.PI / 180;

function cityLine() {
  const L = LINE;
  const T = DETOUR_TOWER;
  const [hx, hy, hz] = HANDOFF.p;
  const thH = Math.atan2(-HANDOFF.tangent[1], HANDOFF.tangent[0]);
  const PT = L.towerPitch * DEG;
  const xW = T.x - T.hx;
  const xE = T.x + T.hx;
  // the crest, worked back from H: the straight descent, the arc into it, the arc over the top
  const xArcEnd = hx - L.descentRun;
  const yArcEnd = hy + L.descentRun * Math.tan(thH);
  const xTop = xArcEnd - L.descentR * Math.sin(thH);
  const yTop = yArcEnd + L.descentR * (1 - Math.cos(thH));
  const xP = xTop - L.crestR * Math.sin(PT); // the tower straight ends here
  const yP = yTop - L.crestR * (1 - Math.cos(PT));
  const yW = yP - (xP - xW) * Math.tan(PT);
  const xS = xW - L.towerPre; // and starts here
  const yS = yW - L.towerPre * Math.tan(PT);
  // the climb: an arc pullR up from level to th, a straight at th, an arc easeR down to the tower's pitch, ending
  // at (xS, yS); th by bisection
  const climb = (th) => {
    const a1x = L.pullR * Math.sin(th);
    const a1y = L.pullR * (1 - Math.cos(th));
    const a2x = L.easeR * (Math.sin(th) - Math.sin(PT));
    const a2y = L.easeR * (Math.cos(PT) - Math.cos(th));
    const run = xS - L.climbX - a1x - a2x;
    return { y: L.climbY + a1y + a2y + run * Math.tan(th), a1x, a1y, run };
  };
  let lo = PT + 1e-3;
  let hi = 85 * DEG;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (climb(mid).y < yS) lo = mid;
    else hi = mid;
  }
  const TH = (lo + hi) / 2;
  const C = climb(TH);
  const xa = L.climbX + C.a1x;
  const ya = L.climbY + C.a1y;
  const xb = xa + C.run;
  const yb = ya + C.run * Math.tan(TH);
  const circleUp = (x, cx, cy, r) => cy + Math.sqrt(Math.max(r * r - (x - cx) * (x - cx), 0));
  const canyonY = (x) => (x < 197 ? 1.1 + (0.05 * (x - 191)) / 6 : L.climbY);
  const Y = (x) => {
    if (x <= L.climbX) return canyonY(x);
    if (x <= xa) return L.climbY + L.pullR - Math.sqrt(Math.max(L.pullR * L.pullR - (x - L.climbX) ** 2, 0));
    if (x <= xb) return ya + (x - xa) * Math.tan(TH);
    if (x <= xS) return circleUp(x, xb + L.easeR * Math.sin(TH), yb - L.easeR * Math.cos(TH), L.easeR);
    if (x <= xP) return yW + (x - xW) * Math.tan(PT);
    if (x <= xTop) return circleUp(x, xTop, yTop - L.crestR, L.crestR);
    if (x <= xArcEnd) return circleUp(x, xTop, yTop - L.descentR, L.descentR);
    return yArcEnd - (x - xArcEnd) * Math.tan(thH);
  };
  // z: the tower straight's slope m carries the line from the west face to H's z (after the straight, a quadratic
  // ease that arrives level on H: m solves both). Before the tower, ONE smooth sideways move out of the canyon's z
  // onto the straight's line, built from its slope: it eases from level up to one steady slope (driftX..driftFull),
  // holds it, and eases into the straight's (driftEase..the straight), with no kink anywhere; the steady slope is
  // solved so the move lands on the line. (Starting it at driftX and holding it late keeps it out of the twin tower
  // at the street's end: z above -0.75 until x 202.75.)
  const Lp = hx - xP;
  const m = (-2 * (L.towerZ - hz)) / Lp / (1 + (2 * (xP - xW)) / Lp);
  const zP = L.towerZ + (xP - xW) * m;
  const zS = L.towerZ - L.towerPre * m;
  // (a half-cosine ramp of the heading: the turn rate rises from 0 and falls back to 0, its peak only 1.57x the mean)
  const smoother = (s) => (s <= 0 ? 0 : s >= 1 ? 1 : (1 - Math.cos(Math.PI * s)) / 2);
  const bump = (x) => (x < L.driftFull ? smoother((x - L.driftX) / (L.driftFull - L.driftX)) : 1 - smoother((x - L.driftEase) / (xS - L.driftEase)));
  const ease = (x) => smoother((x - L.driftEase) / (xS - L.driftEase));
  const DX = 0.01;
  let iBump = 0;
  let iEase = 0;
  for (let x = L.driftX + DX / 2; x < xS; x += DX) {
    iBump += bump(x) * DX;
    iEase += ease(x) * DX;
  }
  const k = (L.canyonZ - zS + m * iEase) / iBump;
  const zTable = [L.canyonZ];
  for (let x = L.driftX + DX / 2, z = L.canyonZ; x < xS; x += DX) {
    z += (-k * bump(x) + m * ease(x)) * DX;
    zTable.push(z);
  }
  const Z = (x) => {
    if (x <= L.driftX) return L.canyonZ;
    if (x <= xS) {
      const f = (x - L.driftX) / DX;
      const i = Math.min(Math.floor(f), zTable.length - 2);
      return zTable[i] + (zTable[i + 1] - zTable[i]) * (f - i);
    }
    if (x <= xP) return L.towerZ + (x - xW) * m;
    const q = (hx - x) / Lp;
    return hz + (zP - hz) * q * q;
  };
  // Sampled densely enough that the Catmull-Rom through the samples is the analytic line (closer in x where it
  // climbs steeply, so the samples are about evenly spaced along it); the tower straight gets collinear samples (a
  // Catmull-Rom segment is straight where its four points are).
  // (evenly in x through the drift and the climb: a centripetal Catmull-Rom through unevenly spaced samples puts a
  // kink in the heading where the spacing changes)
  const xs = [];
  for (let i = 0; 191 + 0.6 * i < xS - 0.25; i++) xs.push(Math.round((191 + 0.6 * i) * 1e6) / 1e6);
  xs.push(xS);
  for (let x = xS + 1.25; x < xW - 0.3; x += 1.25) xs.push(x);
  xs.push(xW, (xW + xE) / 2, xE);
  for (let x = xE + 1.5; x < xP - 0.3; x += 1.5) xs.push(x);
  xs.push(xP);
  for (let x = xP + 2.2; x < hx - 1.2; x += 2.24) xs.push(x);
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const points = xs.map((x) => [r4(x), r4(Y(x)), r4(Z(x))]);
  T.entryY = r4(yW);
  // indices in PATH_POINTS: the hand-placed points before these end at index 32 ([185, 1.35, 0.7])
  const base = 33;
  const at = (x) => base + xs.findIndex((v) => Math.abs(v - x) < 1e-9);
  return {
    points,
    /** the knot that ends the canyon run's old pace (the x 194 sample), and its story-t (where the old line was there) */
    canyonEnd: at(194),
    canyonEndT: 0.72238,
    west: at(xW),
    east: at(xE),
    handoff: base + xs.length,
    /** what the checks and the docs quote */
    climbPitch: TH / DEG,
    towerYaw: Math.atan(m) / DEG,
    straightFrom: xS,
    straightTo: xP,
    crest: [xTop, yTop],
  };
}

export const CITY_LINE = cityLine();

/**
 * Until the communications-tower ending lands (its day-0 stub still holds the old landing line, which starts at
 * (240, 16, 0), behind H), lead from H onto the stub's runway and shed so this branch still flies to the end. With
 * the real ending (ENDING_POINTS[0] is H) this is ENDING_POINTS untouched.
 */
const isH = (p) => Math.hypot(p[0] - HANDOFF.p[0], p[1] - HANDOFF.p[1], p[2] - HANDOFF.p[2]) < 1e-6;
const ENDING = isH(ENDING_POINTS[0])
  ? ENDING_POINTS
  : [HANDOFF.p, [258.5, 14.5, -3.5], [266, 7.6, -3.0], [272, 2.6, -2.0], [276, 0.7, 1.0], ...ENDING_POINTS.filter((p) => p[2] > 5)];

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
  // CH4 formation — straight through the cloud sea, above the town but not in orbit over it: the
  // climb tops out at 26, having gained 17 since CH3 started at 9. (It used to S across the line,
  // z 5 → −4 → 3 in twenty units, and with the storm's slalom after it the dart zig-zagged through
  // the whole middle of the flight; it now eases back onto the line z = 0 and holds it.)
  [60, 24, 5.2],
  [70, 25.8, 3.0],
  [80, 25, 1.4],
  // CH5 storm — the let-down out of the high air, a straight descent through the one gate,
  // landing on the original altitude so CH6's approach is undisturbed (it was a ±2 slalom)
  [88, 23.1, 0.6],
  [94, 21.2, 0.2],
  [100, 19.3, 0],
  [106, 17.6, 0],
  [110, 16.8, 0],
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
  // the dive: down into the street (lamp arms reach 0.5 out from z -2.05 and 2.05, cars and people stand on the
  // road below y 0.8), then a run along it at about lamp height, between the lamps, through the traffic and the
  // crowd. From here to the hand-off the line is BUILT rather than placed point by point (cityLine above): the
  // canyon at one z, one climb out of the street, one straight through the IT-office tower, one crest and one
  // straight descent to H. (It used to S round the tower with a 40-degree jink, and the office detour looped out
  // of the facade and back round the city to rejoin it.)
  [180, 4, 0.75],
  [185, 1.35, 0.7],
  ...CITY_LINE.points,
  // CH10 landing — authored in endingPoints.mjs (the ending owns its own line; its first point is the
  // hand-off from this chapter, H)
  ...ENDING,
];

/**
 * First control-point index of each chapter's zone (matches the blocks). The copilot's is the tower's west face:
 * its chapter starts at 0.78 wherever the line's timing (PATH_KNOTS) puts the dart then; only chapterAnchor uses it.
 */
export const CH_START_INDEX = [0, 3, 6, 14, 17, 22, 27, 30, CITY_LINE.west, CITY_LINE.handoff];

/**
 * The flight line's timing: story-t at control points (FlightPath.toArcT). Between two plain knots the dart moves
 * at one constant speed along the curve (linear in arc length), as every chapter always has; at a knot with a
 * mode the speed eases through instead (cubic Hermite in arc length): 'left' keeps the speed of the stretch before
 * it, 'right' of the stretch after it, 'mean' blends the two. The chapter starts are knots (CHAPTERS' t0, copied:
 * scripts/check-line.mjs asserts they agree) except the copilot's: from the end of the canyon run to the hand-off
 * the line is timed by the tower instead, so the dart reaches its west face at T_S + cutIn·D_T and its east face at
 * T_S + cutOut·D_T exactly (rig/detour.ts), and H at 0.88. H is a plain knot: the ending's line (186 units in 0.12
 * of t, ENDING_BEATS keyed to its constant speed) is about four times as fast per unit t as the copilot's, and a
 * Hermite matching that speed at H made the copilot all but stop at 0.83 (32 units per t) before racing into H.
 * The step in speed per unit t is the pace warp's to hide (rig/pace.ts: the world speed per pixel is smooth across
 * it), and the chase measures its lag and look-ahead across H in distance (CameraRig.along).
 * @type {[number, number, ('left' | 'right' | 'mean')?][]}
 */
export const PATH_KNOTS = [
  [0, 0], [3, 0.09], [6, 0.17], [14, 0.26], [17, 0.36], [22, 0.48], [27, 0.58], [30, 0.66],
  // the canyon run keeps its old pace up to here (the café, phone and window deliveries pick spots from it)
  [CITY_LINE.canyonEnd, CITY_LINE.canyonEndT, 'left'],
  [CITY_LINE.west, DETOUR_TIMING.T_S + DETOUR_TIMING.cutIn * DETOUR_TIMING.D_T, 'mean'],
  [CITY_LINE.east, DETOUR_TIMING.T_S + DETOUR_TIMING.cutOut * DETOUR_TIMING.D_T, 'mean'],
  [CITY_LINE.handoff, HANDOFF.t],
];

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
