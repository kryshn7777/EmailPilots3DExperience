// The ending's flight line and camera, checked against the shot's rules (docs/ending.md, direction §4.4):
//
//   node --experimental-transform-types scripts/check-ending.mjs
//
//   - the line starts at the hand-off H = (250, 19, -3.5) on the tangent (0.883, -0.469, 0) at t = 0.88;
//   - its heading is constant (yaw 0 +-2 deg) from 0.88 to 1 and it stays on z = -3.5: every bend is vertical;
//   - every bend is ONE arc of constant radius, one sign: radius >= 3 at the tube, >= 12 elsewhere; straight between;
//   - x never decreases until the window;
//   - the dart (its span and keel) is never inside the tower or the house except in the relay tube and through the
//     open window (solids: public/models/comm-tower/manifest.json, public/models/recipient-room/manifest.json);
//   - the ending camera (rig/endingShot.ts) never passes through a lattice member, a cabin, the hall, the gallery,
//     a dish or a wall (it enters the house only through the window), on a 16:9 screen and on a 390 x 800 phone;
//   - the beats land where the shot list needs them (in the tube at 0.945, out of the dish by 0.962, in the screen
//     just before RECEIVED_T 0.990), and ENDING_BEATS (the analytic timetable the actors key to) agrees with the
//     spline the dart actually flies.
//
// The line is the real one: pathPoints.mjs's points (the copilot's last two, then ENDING_POINTS) through the same
// centripetal Catmull-Rom FlightPath uses. If the copilot's last point is not yet on H's tangent (its line has not
// landed), the check says so and uses a stand-in point on the tangent for the first segment.
import { register } from 'node:module';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) {
         if (/^\\.{1,2}\\//.test(s) && !/\\.[mc]?[jt]s$/.test(s)) return n(s + '.ts', c); throw e; } }`,
    ),
);

const { CatmullRomCurve3, Vector3 } = await import('three');
const E = await import('../src/webgl/rig/endingPoints.mjs');
const { PATH_POINTS, CH_START_INDEX } = await import('../src/webgl/rig/pathPoints.mjs');
const { endingPose } = await import('../src/webgl/rig/endingShot.ts');
const tower = JSON.parse(readFileSync(new URL('../public/models/comm-tower/manifest.json', import.meta.url)));
const house = JSON.parse(readFileSync(new URL('../public/models/recipient-room/manifest.json', import.meta.url)));

const DEG = 180 / Math.PI;
const Z = -3.5;
const H = new Vector3(250, 19, Z);
const HT = new Vector3(0.883, -0.469, 0).normalize();
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

// -- the line ---------------------------------------------------------------------------------------------------
const start = CH_START_INDEX[9];
const endPts = PATH_POINTS.slice(start);
assert.deepStrictEqual(endPts, E.ENDING_POINTS, 'pathPoints must end with ENDING_POINTS, CH_START_INDEX[9] at its first point');
let prev = PATH_POINTS.slice(Math.max(start - 2, 0), start).map((p) => new Vector3(...p));
const p1 = prev[prev.length - 1];
const onTangent = p1 && (() => {
  const d = new Vector3().subVectors(H, p1);
  return d.length() > 1 && d.normalize().angleTo(HT) * DEG < 0.5;
})();
if (!onTangent) {
  console.log(`note: the copilot's last point ${p1 ? p1.toArray().map((v) => +v.toFixed(2)).join(', ') : '-'} is not on H's tangent yet; using a stand-in on it`);
  prev = [H.clone().addScaledVector(HT, -20), H.clone().addScaledVector(HT, -10)];
}
const pts = [...prev, ...endPts.map((p) => new Vector3(...p))];
const curve = new CatmullRomCurve3(pts, false, 'centripetal');
const nSeg = pts.length - 1;
const u0 = prev.length / nSeg;
// fine samples of the ending zone, by curve parameter, then arc length
const N = 60000;
const raw = [];
for (let i = 0; i <= N; i++) raw.push(curve.getPoint(u0 + ((1 - u0) * i) / N));
const sArr = [0];
for (let i = 1; i <= N; i++) sArr.push(sArr[i - 1] + raw[i].distanceTo(raw[i - 1]));
const total = sArr[N];
const tOf = (s) => 0.88 + (0.12 * s) / total;
const pointAtT = (t) => {
  const s = ((t - 0.88) / 0.12) * total;
  let lo = 0;
  let hi = N;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (sArr[m] <= s) lo = m; else hi = m; }
  const k = (s - sArr[lo]) / Math.max(sArr[hi] - sArr[lo], 1e-9);
  return raw[lo].clone().lerp(raw[hi], k);
};
console.log(`ending line: ${endPts.length} points, ${total.toFixed(1)} units over t 0.88..1 (${(total / 0.12).toFixed(0)} per unit t)`);
check(Math.abs(total - E.ENDING_LENGTH) < 1.0, `spline length ${total.toFixed(2)} vs the analytic ENDING_LENGTH ${E.ENDING_LENGTH.toFixed(2)}`);

// H and its tangent
check(raw[0].distanceTo(H) < 1e-6, `the line starts at ${raw[0].toArray()} not H`);
const t0 = new Vector3().subVectors(raw[20], raw[0]).normalize();
check(t0.angleTo(HT) * DEG < 1, `tangent at H off the contract by ${(t0.angleTo(HT) * DEG).toFixed(2)} deg`);

// resample at even arc length for the derivative checks
const STEP = 0.05;
const even = [];
for (let s = 0; s <= total; s += STEP) {
  let lo = 0;
  let hi = N;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (sArr[m] <= s) lo = m; else hi = m; }
  const k = (s - sArr[lo]) / Math.max(sArr[hi] - sArr[lo], 1e-9);
  even.push({ s, p: raw[lo].clone().lerp(raw[hi], k) });
}
const pitch = [];
let maxYaw = 0;
let maxZ = 0;
for (let i = 0; i < even.length; i++) {
  const a = even[Math.max(i - 1, 0)].p;
  const b = even[Math.min(i + 1, even.length - 1)].p;
  const d = new Vector3().subVectors(b, a);
  const horiz = Math.hypot(d.x, d.z);
  if (horiz > 0.1 * d.length()) maxYaw = Math.max(maxYaw, Math.abs(Math.atan2(d.z, d.x) * DEG));
  pitch.push(Math.atan2(d.y, Math.max(horiz, 1e-9) * Math.sign(d.x || 1)));
  maxZ = Math.max(maxZ, Math.abs(even[i].p.z - Z));
}
check(maxYaw <= 2, `yaw strays ${maxYaw.toFixed(2)} deg from 0`);
check(maxZ <= 0.02, `the line leaves z = -3.5 by ${maxZ.toFixed(3)} (every bend must be vertical)`);

// bends: curvature in the vertical plane
// over a half-unit baseline (a third of the dart): the spline is C1, so its curvature spikes for a few centimetres at
// each control point, which no eye can see
const KB = 5;
const kappa = pitch.map((p, i) => (i < KB || i >= pitch.length - KB ? 0 : (pitch[i + KB] - pitch[i - KB]) / (2 * KB * STEP)));
// a bend: where the line curves tighter than a 250 radius; the spline eases into and out of each arc over the
// neighbouring control step (about a degree and a half), which belongs to the arc it eases into
const BEND = 1 / 250;
const bends = [];
let cur = null;
for (let i = 0; i < kappa.length; i++) {
  const on = Math.abs(kappa[i]) > BEND;
  if (on && !cur) cur = { i0: i, ks: [] };
  if (cur) {
    if (on) cur.ks.push({ i, k: kappa[i] });
    else { cur.i1 = i - 1; bends.push(cur); cur = null; }
  }
}
if (cur) { cur.i1 = kappa.length - 1; bends.push(cur); }
// two curved stretches a short gap apart are one bend if they turn the same way (an ease-in and its arc)
for (let j = bends.length - 1; j > 0; j--) {
  const a = bends[j - 1];
  const b = bends[j];
  const sa = Math.sign(a.ks.reduce((s, e) => s + e.k, 0));
  const sb = Math.sign(b.ks.reduce((s, e) => s + e.k, 0));
  const turnA = Math.abs(pitch[a.i1] - pitch[a.i0]) * DEG;
  const turnB = Math.abs(pitch[b.i1] - pitch[b.i0]) * DEG;
  if (sa === sb && (b.i0 - a.i1) * STEP < 0.8 && Math.min(turnA, turnB) < 3) {
    a.ks.push(...b.ks);
    a.i1 = b.i1;
    bends.splice(j, 1);
  }
}
const towerX = E.TOWER[0];
const xs = (tower.solids.find((s) => s.kind === 'hall') ?? { min: [-5], max: [5] });
const tubeXs = [towerX + xs.min[0] - 3, towerX + 5];
const rows = [];
// the spline ripples a fraction of a degree where an arc meets a straight: those are not bends (they are reported
// as the largest ripple and must stay under 1 degree)
let ripple = 0;
const real = bends.filter((b) => {
  const turn = Math.abs(pitch[b.i1] - pitch[b.i0]) * DEG;
  if (turn < 1) { ripple = Math.max(ripple, turn); return false; }
  return true;
});
bends.length = 0;
bends.push(...real);
console.log(`largest ripple at a joint: ${ripple.toFixed(2)} deg`);
for (const b of bends) {
  // trim the ends where the spline eases from the straight into the arc (or from one arc into the next)
  const ks = b.ks.map((e) => e.k);
  const sign = Math.sign(ks.reduce((a, k) => a + k, 0));
  const mixed = ks.some((k) => Math.sign(k) !== sign);
  // the arc proper: where it curves at least 0.7 as hard as it does at most (the ease-in and ease-out are outside).
  // Tolerances: the spline is C1, so where an arc meets a straight its curvature eases over about half a unit and can
  // run up to 10% tighter than the arc for a few centimetres; the arcs themselves are exact to 1%
  const peak = Math.max(...ks.map((k) => Math.abs(k)));
  const core = ks.filter((k) => Math.abs(k) >= peak * 0.7);
  const mid = core.slice(Math.floor(core.length * 0.05), Math.max(Math.ceil(core.length * 0.95), 1)).map((k) => 1 / Math.abs(k)).sort((a, c) => a - c);
  const med = mid[Math.floor(mid.length / 2)];
  const rMin = 1 / peak;
  const rMax = mid[mid.length - 1];
  const pm = even[Math.floor((b.i0 + b.i1) / 2)].p;
  const inTube = pm.x > tubeXs[0] && pm.x < tubeXs[1] && pm.y < 30;
  const need = inTube ? 3 : 12;
  const turn = (pitch[b.i1] - pitch[b.i0]) * DEG;
  rows.push({ at: `x ${pm.x.toFixed(1)} y ${pm.y.toFixed(1)}`, t: +tOf(even[b.i0].s).toFixed(4), turn: +turn.toFixed(1), radius: +med.toFixed(2), 'r min..max': `${rMin.toFixed(2)}..${rMax.toFixed(2)}`, need });
  // a sign change is only an S if the reversed stretch turns the line back by more than a degree
  let reversed = 0;
  for (const e of b.ks) if (Math.sign(e.k) !== sign) reversed += Math.abs(e.k) * STEP * DEG;
  check(!mixed || reversed < 1, `the bend at ${pm.x.toFixed(1)}, ${pm.y.toFixed(1)} changes sign (an S, not one arc: ${reversed.toFixed(2)} deg back)`);
  check(rMin >= need * 0.9, `the bend at ${pm.x.toFixed(1)}, ${pm.y.toFixed(1)} is tighter than ${need} (r ${rMin.toFixed(2)})`);
  check(rMax <= med * 1.25 && rMin >= med * 0.8, `the bend at ${pm.x.toFixed(1)}, ${pm.y.toFixed(1)} is not one constant radius (${rMin.toFixed(2)}..${rMax.toFixed(2)})`);
}
console.table(rows);
check(bends.length === 5, `expected 5 bends (the round-out, the intake, the feed, the crest, the flare), got ${bends.length}`);

// x never decreases until the window
const winT = E.ENDING_BEATS.window;
let back = 0;
for (let i = 1; i < even.length; i++) {
  if (tOf(even[i].s) > winT) break;
  back = Math.min(back, even[i].p.x - even[i - 1].p.x);
}
check(back > -1e-4, `x goes back by ${(-back).toFixed(5)} before the window`);

// -- solids ---------------------------------------------------------------------------------------------------------
const TW = (v) => new Vector3(v[0] + towerX, v[1], v[2] + Z);
const tubePath = tower.solids.find((s) => s.kind === 'tube').path.map(([x, y]) => new Vector3(x + towerX, y, Z));
const tubeR = tower.dims.tube_r;
const distSeg = (p, a, b) => {
  const ab = new Vector3().subVectors(b, a);
  const k = Math.min(Math.max(new Vector3().subVectors(p, a).dot(ab) / Math.max(ab.lengthSq(), 1e-12), 0), 1);
  return p.distanceTo(a.clone().addScaledVector(ab, k));
};
const distTube = (p) => {
  let d = Infinity;
  for (let i = 0; i < tubePath.length - 1; i++) d = Math.min(d, distSeg(p, tubePath[i], tubePath[i + 1]));
  return d;
};
const inBox = (p, mn, mx, pad = 0) => p.x > mn.x - pad && p.x < mx.x + pad && p.y > mn.y - pad && p.y < mx.y + pad && p.z > mn.z - pad && p.z < mx.z + pad;
const segs = tower.solids.filter((s) => s.kind === 'seg').map((s) => ({ ...s, A: TW(s.a), B: TW(s.b) }));
const boxes = tower.solids.filter((s) => ['box', 'cabin', 'hall', 'deck'].includes(s.kind)).map((s) => ({ ...s, MN: TW(s.min), MX: TW(s.max) }));
const drums = tower.solids.filter((s) => s.kind === 'drum').map((s) => ({ ...s, C: TW(s.c) }));
const dish = tower.solids.find((s) => s.kind === 'dish');
const dishC = TW(dish.c);
const dishN = new Vector3(...dish.n).normalize();
/** what the point hits in the tower (null: nothing). `pad` is the body's half size round it */
function towerHit(p, pad, allowTube) {
  if (allowTube && distTube(p) <= tubeR - pad) return null;
  for (const s of segs) if (distSeg(p, s.A, s.B) < s.r + pad) return `${s.name} ${s.A.toArray().map((v) => v.toFixed(1))}`;
  for (const b of boxes) {
    if (!inBox(p, b.MN, b.MX, pad)) continue;
    // the gallery is a ring: its middle (round the steel) is open
    if (b.kind === 'deck' && Math.abs(p.x - towerX) < b.hole - pad && Math.abs(p.z - Z) < b.hole - pad) continue;
    if (b.kind === 'deck' && p.y > b.MN.y + 0.2 && p.y < b.MX.y - 0.1 && (Math.abs(p.x - towerX) < b.MX.x - towerX - 0.3 && Math.abs(p.z - Z) < b.MX.z - Z - 0.3)) {
      // inside the railing's box but above the deck: only the rails themselves are solid (checked as the box's skin)
      const edge = Math.min(b.MX.x - p.x, p.x - b.MN.x, b.MX.z - p.z, p.z - b.MN.z);
      if (edge > pad + 0.1) continue;
    }
    return b.name;
  }
  for (const d of drums) if (p.distanceTo(d.C) < d.r + pad) return d.name;
  const rel = new Vector3().subVectors(p, dishC);
  const along = rel.dot(dishN);
  const radial = rel.clone().addScaledVector(dishN, -along).length();
  if (along > -0.8 - pad && along < 0.7 + pad && radial < dish.r + pad && radial > (allowTube ? dish.hole : 0)) return 'dish_main';
  return null;
}
// the house, in its own frame (x into the house from the window wall's outer face)
const hx = E.HOUSE.windowX;
const W = house.window;
const HH = (p) => new Vector3(p.x - hx, p.y, p.z - Z);
function houseHit(p, padZ, padY, through) {
  const q = HH(p);
  if (q.x > house.depth + 0.1 || Math.abs(q.z) > house.half + 0.1 + padZ) return null;
  if (q.x < -0.02 - padZ) {
    // in front of the window wall: the flower box under the opening, the shutters folded back beside it
    if (q.x > -0.55 - padZ && q.y < W.y0 - 0.02 + padY && q.y > W.y0 - 0.65 && Math.abs(q.z) < W.z1 + 0.15 + padZ) return 'the flower box';
    if (q.x > -0.15 - padZ && q.y > W.y0 - padY && q.y < W.y1 + padY && Math.abs(q.z) > W.z1 + 0.1 - padZ && Math.abs(q.z) < W.z1 + 1.45 + padZ) return 'a shutter';
    return null;
  }
  // the window wall
  if (q.x < house.wall + 0.02) {
    const inOpening = Math.abs(q.z) <= W.z1 - padZ && q.y >= W.y0 + padY && q.y <= W.y1 - padY;
    return through && inOpening ? null : 'the window wall';
  }
  if (q.x <= house.depth - house.wall && Math.abs(q.z) < house.half - house.wall) {
    // inside: the desk (to its top), the chair, the pendants; the laptop is where the line ends
    const sx = E.HOUSE.screen[0] - hx;
    if (Math.abs(q.z) < 2.0 && q.x > sx - 0.9 + 0.15 && q.x < sx + 1.05 && q.y < E.DESK_TOP + 0.05 + padY) return 'the desk';
    if (Math.abs(q.z - 1.3) < 0.32 + padZ || Math.abs(q.z + 1.3) < 0.32 + padZ) {
      if (Math.abs(q.x - (sx + 0.15)) < 0.32 + padZ && q.y > 2.45 - padY) return 'a pendant';
    }
    if (q.y > 3.6 - padY) return 'the ceiling';
    return null;
  }
  return 'the house';
}

// the dart's body: 0.75 either side (its span), 0.3 down (its keel), along its line
let dartHits = [];
const sScreen = ((E.ENDING_BEATS.screen - 0.88) / 0.12) * total;
for (const { s, p } of even) {
  if (s > sScreen - 0.6) break; // into the screen: the laptop is the target
  const th = towerHit(p, 0.75, true);
  if (th) dartHits.push(`t ${tOf(s).toFixed(4)} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}): ${th}`);
  const hh = houseHit(p, 0.75, 0.3, true);
  if (hh) dartHits.push(`t ${tOf(s).toFixed(4)} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}): ${hh}`);
}
check(dartHits.length === 0, `the dart hits: ${dartHits.slice(0, 6).join('; ')}${dartHits.length > 6 ? ` (+${dartHits.length - 6})` : ''}`);
// ...and in the tube it really is in the tube (the line is the tube's centreline)
let worstTube = 0;
for (const { s, p } of even) {
  const t = tOf(s);
  if (t < E.ENDING_BEATS.intake + 0.0003 || t > E.ENDING_BEATS.exit - 0.0003) continue;
  worstTube = Math.max(worstTube, distTube(p));
}
check(worstTube < 0.12, `the line leaves the tube's centreline by ${worstTube.toFixed(3)}`);

// -- the camera -----------------------------------------------------------------------------------------------------
const pose = { weight: 0, camPos: new Vector3(), look: new Vector3(), fov: 45, roll: 0, bars: 0 };
for (const [label, aspect] of [['16:9', 16 / 9], ['390x800', 390 / 800]]) {
  const hits = [];
  let lowest = Infinity;
  let maxStep = 0;
  let last = null;
  for (let t = 0.88; t <= 1.0000001; t += 0.0001) {
    endingPose(t, aspect, pose);
    if (pose.weight < 1) continue;
    const c = pose.camPos;
    lowest = Math.min(lowest, c.y);
    const th = towerHit(c, 0.25, false);
    if (th) hits.push(`t ${t.toFixed(4)}: ${th}`);
    const hh = houseHit(c, 0.2, 0.15, true);
    if (hh) hits.push(`t ${t.toFixed(4)} (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}): ${hh}`);
    if (last) maxStep = Math.max(maxStep, c.distanceTo(last));
    last = c.clone();
    check(Number.isFinite(pose.fov) && pose.fov > 20 && pose.fov < 90, `${label}: fov ${pose.fov} at ${t.toFixed(4)}`);
  }
  console.log(`camera ${label}: lowest y ${lowest.toFixed(2)}, largest step per 1e-4 t ${maxStep.toFixed(3)}, ${hits.length} hits`);
  check(lowest > 0.4, `${label}: the camera goes down to y ${lowest.toFixed(2)}`);
  check(hits.length === 0, `${label}: the camera passes through ${hits.slice(0, 5).join('; ')}${hits.length > 5 ? ` (+${hits.length - 5})` : ''}`);
}

// -- the beats ------------------------------------------------------------------------------------------------------
const B = E.ENDING_BEATS;
const at = (t) => pointAtT(t);
const near = (t, target, tol, what) => {
  const p = at(t);
  const d = p.distanceTo(new Vector3(...target));
  check(d < tol, `${what}: at t ${t.toFixed(4)} the dart is ${d.toFixed(2)} from ${target.map((v) => v.toFixed(2))}`);
};
near(B.intake, E.TUBE.mouth, 0.35, 'ENDING_BEATS.intake');
near(B.tube, E.TUBE.foot, 0.35, 'ENDING_BEATS.tube');
near(B.tubeTop, E.TUBE.top, 0.35, 'ENDING_BEATS.tubeTop');
near(B.exit, E.TUBE.exit, 0.35, 'ENDING_BEATS.exit');
near(B.screen, E.HOUSE.screen, 0.35, 'ENDING_BEATS.screen');
const p945 = at(0.945);
check(p945.y > E.TUBE.foot[1] + 2 && p945.y < E.TUBE.top[1] - 2 && Math.abs(p945.x - E.TUBE.foot[0]) < 0.5, `0.945: the dart should be in the tube's straight, at ${p945.toArray().map((v) => v.toFixed(2))}`);
check(B.exit < 0.962 && at(0.962).distanceTo(new Vector3(...E.TUBE.exit)) < 16, '0.962: the dart should be just out of the main dish');
check(B.screen > 0.986 && B.screen <= 0.9905, `the dart reaches the screen at ${B.screen.toFixed(4)} (RECEIVED_T is 0.990)`);
console.log('beats:', Object.entries(B).map(([k, v]) => `${k} ${v.toFixed(4)}`).join(', '));

if (fails.length) {
  console.error(`\ncheck-ending: ${fails.length} failure(s)`);
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('\ncheck-ending: all passed');
