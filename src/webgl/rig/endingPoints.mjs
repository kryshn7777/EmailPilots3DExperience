// The ending's flight line (owned by the communications-tower ending, docs/ending.md). pathPoints.mjs appends
// ENDING_POINTS after the copilot chapter's own points, so this file is the only place the ending's line is
// authored. Plain ESM (no imports), so the Node bake and check scripts can read it.
//
// Contract: the first point is the hand-off from the copilot chapter, H = (250, 19, -3.5) with tangent
// (0.883, -0.469, 0) at t = 0.88; CH10 (0.88..1.0) maps story-t linearly to arc length from H to the last point.
//
// The line is built from straight runs and circular arcs, every bend in the vertical plane z = -3.5 (the runway's
// centreline), so the heading is +x from H to the laptop: no turn, no U-turn, no orbit. In order:
//
//   H, on the copilot's descent (-28 deg)  -> one round-out (R 14) onto the runway low pass at y 1.6
//   the low pass along the runway         -> the bell-mouth intake in the relay hall at the tower's foot
//   one quarter bend (R 3) up the tube    -> straight up the glass relay tube in the tower's core
//   one bend (R 3) into the main dish     -> out of its feed at +35 deg, toward the sunrise
//   one arc over the crest (R 12)         -> a straight dive (-52 deg) at the house
//   one flare (R 12) to level             -> through the open window and into the laptop's screen
//
// The arc lengths are what time the beats: the dart's speed is constant inside a chapter, so the tower stands
// far enough down the runway that the dart is in the tube at t ~0.945, out of the dish by ~0.955 and in the
// screen at ~0.9895 (RECEIVED_T is 0.990). ENDING_BEATS below is that timetable, computed from the same lengths.

const Z = -3.5;
const DEG = Math.PI / 180;
const CH_T0 = 0.88;
const CH_T1 = 1.0;

/** the hand-off from the copilot chapter */
const H = [250, 19];
const H_PITCH = Math.atan2(-0.469, 0.883);

/** shape: the round-out onto the runway, the tube's bends, the crest and the flare (radii, world units) */
const R_ROUND = 14;
const R_TUBE = 3;
const R_ARC = 12;
/** the low pass over the runway */
export const LOW_Y = 1.6;
/** the glass tube leans this far forward (+x going up): keeps the dart's heading defined (never exactly vertical) */
const LEAN = 1 * DEG;
/** the main dish's boresight, which the dart leaves along */
export const EXIT_PITCH = 35 * DEG;
/** the dive at the house */
const DIVE = -52 * DEG;
/** the screen's centre height: the house floor at 0, the desk top 0.62, the laptop's panel centre 0.613 above it */
export const DESK_TOP = 0.62;
export const SCREEN_Y = DESK_TOP + 0.045 + 0.568;

// lengths of the straights (tuned so the beats land where the shot list wants them; see ENDING_BEATS)
const LOW_PASS = 47.5;
const TUBE_TOP_Y = 21.6;
/** the straight out of the dish's feed along its boresight */
const BORESIGHT = 1.6;
/** level run after the flare, before the window; then the window to the screen */
const LEVEL_IN = 2.2;
const WINDOW_TO_SCREEN = 3.4;

/** segments: { kind: 'line', len } or { kind: 'arc', r, to: pitch }; the pitch carries from one to the next */
function plan() {
  const segs = [];
  const roundDrop = R_ROUND * (1 - Math.cos(H_PITCH));
  const descent = (H[1] - LOW_Y - roundDrop) / Math.sin(-H_PITCH);
  segs.push({ id: 'descent', kind: 'line', len: descent });
  segs.push({ id: 'round-out', kind: 'arc', r: R_ROUND, to: 0 });
  segs.push({ id: 'low-pass', kind: 'line', len: LOW_PASS });
  segs.push({ id: 'intake', kind: 'arc', r: R_TUBE, to: 90 * DEG - LEAN });
  // the tube's straight: from the end of the intake bend to TUBE_TOP_Y
  const tubeBottom = LOW_Y + R_TUBE * (1 - Math.cos(90 * DEG - LEAN));
  segs.push({ id: 'tube', kind: 'line', len: (TUBE_TOP_Y - tubeBottom) / Math.cos(LEAN) });
  segs.push({ id: 'feed', kind: 'arc', r: R_TUBE, to: EXIT_PITCH });
  // out of the dish along its boresight before the arc over begins
  segs.push({ id: 'boresight', kind: 'line', len: BORESIGHT });
  segs.push({ id: 'crest', kind: 'arc', r: R_ARC, to: DIVE });
  // the dive: down to where the flare (R_ARC, DIVE -> 0) ends at the screen's height
  segs.push({ id: 'dive', kind: 'line', len: 0 });
  segs.push({ id: 'flare', kind: 'arc', r: R_ARC, to: 0 });
  segs.push({ id: 'level', kind: 'line', len: LEVEL_IN });
  segs.push({ id: 'window', kind: 'line', len: WINDOW_TO_SCREEN });
  segs.push({ id: 'screen', kind: 'line', len: 0 });
  // solve the dive's length from the heights
  const exitY = walk(segs, 'crest').y;
  const crestDrop = R_ARC * (Math.cos(DIVE) - Math.cos(EXIT_PITCH)); // signed: y change over the crest arc
  const flareRise = R_ARC * (1 - Math.cos(DIVE));
  segs.find((s) => s.id === 'dive').len = (exitY + crestDrop - (SCREEN_Y + flareRise)) / Math.sin(-DIVE);
  return segs;
}

/** walks the segments from H; returns the pose at the START of segment `id` (or the end, if absent) */
function walk(segs, id, sink, res = 0.05) {
  let x = H[0];
  let y = H[1];
  let pitch = H_PITCH;
  let s = 0;
  for (const seg of segs) {
    if (seg.id === id) return { x, y, pitch, s };
    if (seg.kind === 'line') {
      const n = Math.max(1, Math.ceil(seg.len / res));
      for (let i = 1; i <= n; i++) {
        const d = seg.len / n;
        x += Math.cos(pitch) * d;
        y += Math.sin(pitch) * d;
        s += d;
        sink?.(x, y, pitch, s, seg.id);
      }
    } else {
      const dir = Math.sign(seg.to - pitch);
      // centre to the left of the motion when pitching up (dir > 0), to the right when pitching down
      const cx = x - dir * seg.r * Math.sin(pitch);
      const cy = y + dir * seg.r * Math.cos(pitch);
      const sweep = Math.abs(seg.to - pitch);
      const n = Math.max(1, Math.ceil((sweep * seg.r) / res));
      const p0 = pitch;
      for (let i = 1; i <= n; i++) {
        pitch = p0 + (dir * sweep * i) / n;
        x = cx + dir * seg.r * Math.sin(pitch);
        y = cy - dir * seg.r * Math.cos(pitch);
        s += (sweep * seg.r) / n;
        sink?.(x, y, pitch, s, seg.id);
      }
    }
  }
  return { x, y, pitch, s };
}

const SEGS = plan();
/** the line sampled every 5 mm: where the control points are read from */
const FINE = [{ x: H[0], y: H[1], s: 0 }];
walk(SEGS, null, (x, y, pitch, s) => FINE.push({ x, y, s }), 0.005);

/**
 * Control points for the centripetal Catmull-Rom: the analytic line sampled densely, then thinned. On an arc, a point
 * every 5 degrees of bend (3 on the tube's radius-3 bends), so the spline holds the circle; on a straight, steps that
 * grow by 1.3x from the bend's step up to 2 units and come down again toward the next bend, so the spline has no
 * reason to ripple where an arc meets a straight.
 */
function controlPoints() {
  const MAX = 2.0;
  const GROW = 1.3;
  const arcStep = (g) => g.r * (g.r < 5 ? 2 : 2.5) * DEG;
  /** steps along a straight of length `len` that ramp geometrically from `a` (the arc before) to `b` (the arc after) */
  const lineSteps = (len, a, b) => {
    const ramp = (s) => { const r = []; for (let x = s; x < MAX; x *= GROW) r.push(x); return r; };
    const head = ramp(a);
    const tail = ramp(b);
    const fixed = [...head, ...tail].reduce((p, q) => p + q, 0);
    if (fixed <= len) {
      const n = Math.max(1, Math.ceil((len - fixed) / MAX));
      const mid = (len - fixed) / n;
      const steps = [...head, ...Array(fixed < len - 1e-9 ? n : 0).fill(mid), ...tail.reverse()];
      return steps;
    }
    // a short straight: a geometric run from a to b, scaled to fit
    let n = 1;
    let steps = [len];
    for (n = 2; n < 60; n++) {
      steps = Array.from({ length: n }, (_, i) => a * Math.pow(b / a, i / (n - 1)));
      if (steps.reduce((p, q) => p + q, 0) >= len) break;
    }
    const k = len / steps.reduce((p, q) => p + q, 0);
    return steps.map((s) => s * k);
  };
  const out = [[H[0], H[1], Z]];
  // runs: each arc on its own, consecutive straights together (they are one straight line)
  const runs = [];
  for (const g of SEGS) {
    const last = runs[runs.length - 1];
    if (g.kind === 'line' && last && last.kind === 'line') last.segs.push(g);
    else runs.push({ kind: g.kind, segs: [g] });
  }
  runs.forEach((run, ri) => {
    const g = run.segs[0];
    const gi = SEGS.indexOf(run.segs[run.segs.length - 1]);
    const p0 = walk(SEGS, g.id);
    const next = SEGS[gi + 1] ? walk(SEGS, SEGS[gi + 1].id) : walk(SEGS, null);
    const len = next.s - p0.s;
    if (len <= 1e-9) return;
    let dists;
    if (run.kind === 'arc') {
      const n = Math.max(1, Math.round(len / arcStep(g)));
      dists = Array.from({ length: n }, (_, i) => (len * (i + 1)) / n);
    } else {
      // ramp from the arc before (H: its own step) to the arc after (the end: up to the tail's 2 units)
      const a = ri > 0 ? arcStep(runs[ri - 1].segs[0]) : MAX;
      const b = runs[ri + 1] ? arcStep(runs[ri + 1].segs[0]) : MAX;
      let acc = 0;
      dists = lineSteps(len, a, b).map((s) => (acc += s));
      dists[dists.length - 1] = len;
    }
    // the points at those distances along this segment (from the fine samples, interpolated)
    for (const d of dists) {
      const s = p0.s + d;
      let lo = 0;
      let hi = FINE.length - 1;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (FINE[m].s <= s) lo = m;
        else hi = m;
      }
      const a = FINE[lo];
      const b = FINE[hi];
      const k = Math.min(Math.max((s - a.s) / Math.max(b.s - a.s, 1e-12), 0), 1);
      out.push([+(a.x + (b.x - a.x) * k).toFixed(4), +(a.y + (b.y - a.y) * k).toFixed(4), Z]);
    }
  });
  // drop any duplicate (a zero-length segment, a rounding repeat)
  return out.filter((p, i) => i === 0 || Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 1e-3);
}

const LINE = controlPoints();
const TOTAL = walk(SEGS, null).s;
/** the line continues straight on behind the screen for the rest of the chapter (the dart is in the laptop) */
const SCREEN_S = walk(SEGS, 'screen').s;
const SCREEN_T = 0.9895;
const TAIL = ((CH_T1 - SCREEN_T) / (SCREEN_T - CH_T0)) * SCREEN_S;
const tailEnd = walk(SEGS, null);
const TAIL_STEPS = Math.ceil(TAIL / 2);
for (let i = 1; i <= TAIL_STEPS; i++) LINE.push([+(tailEnd.x + (TAIL * i) / TAIL_STEPS).toFixed(4), +SCREEN_Y.toFixed(4), Z]);

export const ENDING_POINTS = LINE;
/** the line's length from H to its last point (world units) */
export const ENDING_LENGTH = TOTAL + TAIL;

/** story-t at arc length s from H (the chapter is linear in arc length) */
const tAt = (s) => CH_T0 + ((CH_T1 - CH_T0) * s) / ENDING_LENGTH;
const at = (id) => walk(SEGS, id);

/**
 * The ending's timetable (story-t) and the places it happens, from the same arc lengths the dart flies by.
 * The actors and the camera key to these, so the tower lights up, the cabins flash and the screen flips as the
 * dart actually passes.
 */
const P = {
  roundOut: at('round-out'),
  lowPass: at('low-pass'),
  intake: at('intake'),
  tube: at('tube'),
  feed: at('feed'),
  boresight: at('boresight'),
  crest: at('crest'),
  dive: at('dive'),
  flare: at('flare'),
  level: at('level'),
  window: at('window'),
  screen: at('screen'),
};
export const ENDING_BEATS = {
  /** level on the runway low pass */
  lowPass: tAt(P.lowPass.s),
  /** the dart reaches the bell-mouth's throat */
  intake: tAt(P.intake.s),
  /** in the straight of the tube, and at its top */
  tube: tAt(P.tube.s),
  tubeTop: tAt(P.feed.s),
  /** out of the main dish's feed */
  exit: tAt(P.boresight.s),
  /** the top of the arc (pitch 0) */
  crest: tAt(P.crest.s + R_ARC * EXIT_PITCH),
  dive: tAt(P.dive.s),
  flare: tAt(P.flare.s),
  /** the window wall, the screen */
  window: tAt(P.window.s),
  screen: tAt(P.screen.s),
};

/** where the tower's relay tube runs: the throat of the bell-mouth, the foot of the straight, its top, the feed */
export const TUBE = {
  mouth: [P.intake.x, P.intake.y, Z],
  foot: [P.tube.x, P.tube.y, Z],
  top: [P.feed.x, P.feed.y, Z],
  exit: [P.boresight.x, P.boresight.y, Z],
  radius: R_TUBE,
  lean: LEAN,
  exitPitch: EXIT_PITCH,
};
/** the communications tower: centre of its footprint on the ground (the tube's axis at the ground) */
export const TOWER = [P.tube.x - P.tube.y * Math.tan(LEAN), 0, Z];
/** the recipient's house: the window wall's x, the screen's centre */
export const HOUSE = {
  windowX: P.window.x,
  screen: [P.screen.x, SCREEN_Y, Z],
  /** the line's height through the window */
  lineY: SCREEN_Y,
};

/** where the Landing group stands (Engine mounts `new Landing(LANDING_ANCHOR)`): on the runway's centreline */
export const LANDING_ANCHOR = [270, 0.5, Z];
