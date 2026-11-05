// The scroll's pace: how much world each pixel of scroll carries, chapter by chapter.
// Run: node --experimental-transform-types scripts/check-pace.mjs [--baseline] [--json out.json]
//
// Sweeps scroll progress p over the home page's stage at a 900 px viewport (10 chapters of 120vh + the
// office detour's 120vh, minus one viewport: 10980 px), maps p -> story-t exactly as the Engine does
// (detourMap, then the pace warp in rig/pace.ts) and measures, per chapter:
//   - world units per 100 px of the flight line (mean and max), the speed the dart moves at;
//   - v/h, that speed over the camera's height above what is under it (perceived speed);
//   - the speed ratio across each chapter seam (1 = continuous);
//   - the camera's acceleration, the second difference of its position per px^2 (a jolt at a seam
//     shows up here).
// --baseline measures with the pace warp switched off (today's linear scroll -> t). Without it the
// pace warp is applied and the assertions run (monotone, continuous, round trip, seam ratios, spread
// and camera acceleration against scripts/pace-baseline.json, measured before any of the scroll-feel work).
import { register } from 'node:module';
import assert from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';

// the sources import each other without extensions (Vite style): try '.ts' when a relative import misses
register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) {
         if (/^\\.{1,2}\\//.test(s) && !/\\.[mc]?[jt]s$/.test(s)) return n(s + '.ts', c); throw e; } }`,
    ),
);

const args = process.argv.slice(2);
const baseline = args.includes('--baseline');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

const { PerspectiveCamera, Vector3 } = await import('three');
const { FlightPath } = await import('../src/webgl/rig/FlightPath.ts');
const { CameraRig } = await import('../src/webgl/rig/CameraRig.ts');
const { CHAPTERS } = await import('../src/story/chapters.ts');
const { detourMap, progressOf, T_S } = await import('../src/webgl/rig/detour.ts');
const pace = await import('../src/webgl/rig/pace.ts');

const VH = 900;
const STAGE = (10 * 1.2 + 1.2) * VH - VH; // 10980 px
const W = (1.2 * VH) / STAGE; // the detour's share
const path = new FlightPath();
const camera = new PerspectiveCamera(45, 16 / 9, 0.1, 1000);
const rig = new CameraRig(path, camera, /** @type any */ ({}), { reducedMotion: false });
const warp = baseline ? null : pace.buildPace(pace.paceInputs(path, rig));

const tOf = (p) => {
  const tl = detourMap(p, W).t;
  return warp ? warp.paceT(tl) : tl;
};
const camAt = (t, out) => pace.cameraAt(path, rig, t, out);
const floorAt = pace.floorAt;

const DP = 0.0002;
const N = Math.round(1 / DP);
const pxPerStep = DP * STAGE;
const rows = CHAPTERS.map((c) => ({ id: c.id, t0: c.t0, t1: c.t1, n: 0, sum: 0, max: 0, vh: 0, vhMax: 0, vh6: 0, acc: 0, accs: [], px: 0 }));
const chapterOf = (t) => {
  let i = 0;
  while (i < CHAPTERS.length - 1 && t >= CHAPTERS[i + 1].t0) i++;
  return i;
};

const P0 = new Vector3();
const P1 = new Vector3();
const C0 = new Vector3();
const C1 = new Vector3();
const C2 = new Vector3();
let prevT = tOf(0);
const speeds = []; // [t, world per 100 px]
for (let i = 1; i <= N; i++) {
  const pa = (i - 1) * DP;
  const pb = i * DP;
  const ta = tOf(pa);
  const tb = tOf(pb);
  // monotone and continuous
  if (warp) {
    assert(tb >= prevT - 1e-12, `t monotone at p=${pb}`);
    assert(tb - prevT < 0.003, `t continuous at p=${pb} (jump ${tb - prevT})`);
  }
  prevT = tb;
  if (ta === tb) continue; // the detour holds t
  const tm = (ta + tb) / 2;
  const row = rows[chapterOf(tm)];
  path.pointAt(ta, P0);
  path.pointAt(tb, P1);
  const v = (P0.distanceTo(P1) / pxPerStep) * 100;
  camAt(tm, C1);
  const h = Math.min(Math.max(C1.y - floorAt(tm, C1.y), 0.8), 14);
  // camera acceleration: second difference over three samples one step apart in p
  camAt(tOf(Math.max(pa - DP, 0)), C0);
  camAt(tb, C2);
  const mid = camAt(ta, new Vector3());
  const acc = C0.add(C2).addScaledVector(mid, -2).length() / (pxPerStep * pxPerStep);
  row.n++;
  row.sum += v;
  row.max = Math.max(row.max, v);
  row.vh += v / h;
  row.vhMax = Math.max(row.vhMax, v / h);
  row.acc = Math.max(row.acc, acc);
  row.accs.push(acc);
  row.vh6 += v / Math.pow(h, 0.6);
  row.px += pxPerStep;
  speeds.push([tm, v]);
}

// seam ratios: the speed just before vs just after each chapter start (about 20 px either side): a jump
// in the flight line's speed per pixel, which the old linear map had at every seam
const seams = [];
for (let c = 1; c < CHAPTERS.length; c++) {
  const t0 = CHAPTERS[c].t0;
  const before = speeds.filter(([t]) => t < t0 && t > t0 - 0.002).map(([, v]) => v);
  const after = speeds.filter(([t]) => t >= t0 && t < t0 + 0.002).map(([, v]) => v);
  if (!before.length || !after.length) continue;
  const a = before.reduce((x, y) => x + y) / before.length;
  const b = after.reduce((x, y) => x + y) / after.length;
  seams.push({ at: `${CHAPTERS[c - 1].id}->${CHAPTERS[c].id}`, ratio: Math.max(a / b, b / a) });
}

const table = rows.map((r) => ({
  chapter: r.id,
  px: Math.round(r.px),
  'w/100px': +(r.sum / r.n).toFixed(2),
  'w/100px max': +r.max.toFixed(2),
  'v/h': +(r.vh / r.n).toFixed(3),
  'v/h max': +r.vhMax.toFixed(3),
  'v/h^0.6': +(r.vh6 / r.n).toFixed(3),
  'cam acc p95 (1e-4/px^2)': +(p95(r.accs) * 1e4).toFixed(2),
  'cam acc max (1e-4/px^2)': +(r.acc * 1e4).toFixed(2),
}));
function p95(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length * 0.95)] ?? 0;
}
console.log(baseline ? 'BASELINE (no pace warp)' : 'WITH PACE WARP');
console.table(table);
console.table(seams.map((s) => ({ seam: s.at, ratio: +s.ratio.toFixed(3) })));
const means = rows.map((r) => r.sum / r.n);
const mean = means.reduce((a, b) => a + b) / means.length;
const spread = (Math.max(...means) - Math.min(...means)) / mean;
const vhs = rows.map((r) => r.vh / r.n);
const vhMean = vhs.reduce((a, b) => a + b) / vhs.length;
const vhSpread = (Math.max(...vhs) - Math.min(...vhs)) / vhMean;
const v6 = rows.map((r) => r.vh6 / r.n);
const v6Mean = v6.reduce((a, b) => a + b) / v6.length;
const v6Spread = (Math.max(...v6) - Math.min(...v6)) / v6Mean;
const maxSeam = Math.max(...seams.map((s) => s.ratio));
const accP95 = p95(rows.flatMap((r) => r.accs));
const maxAcc = Math.max(...rows.map((r) => r.acc));
console.log(
  `spread of world units per 100 px across chapters (max-min)/mean: ${(spread * 100).toFixed(1)}%` +
    ` | of v/h: ${(vhSpread * 100).toFixed(1)}% | of v/h^0.6: ${(v6Spread * 100).toFixed(1)}%` +
    ` | worst seam ratio ${maxSeam.toFixed(3)} | cam acc p95 ${(accP95 * 1e4).toFixed(2)}, max ${(maxAcc * 1e4).toFixed(2)} (1e-4/px^2)`,
);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ viewport: VH, stagePx: STAGE, W, chapters: table, seams, spread, vhSpread, v6Spread, maxSeam, accP95, maxAcc }, null, 2) + '\n');
  console.log('wrote', jsonOut);
}

if (warp) {
  // round trip: t -> scroll -> t, on both sides of the detour, and the fixed points
  for (let t = 0; t <= 1.00001; t += 0.01) {
    const tt = Math.min(t, 1);
    const back = tOf(progressOf(warp.paceLin(tt), W));
    assert(Math.abs(back - tt) < 1e-4, `round trip t=${tt} -> ${back}`);
  }
  assert(Math.abs(warp.paceT(T_S) - T_S) < 1e-9 && warp.paceT(0) === 0 && warp.paceT(1) === 1, 'T_S, 0 and 1 stay fixed');
  // the office clock: monotone, ends fixed, slope 1 at both cuts
  let prevU = 0;
  for (let i = 0; i <= 10000; i++) {
    const u = warp.paceU(i / 10000);
    assert(u >= prevU - 1e-12 && u - prevU < 0.002, `u monotone/continuous at ${i / 10000}`);
    prevU = u;
  }
  assert(warp.paceU(0) === 0 && Math.abs(warp.paceU(1) - 1) < 1e-9, 'u ends fixed');
  for (const cut of [0.08, 0.66]) {
    const ul = warp.paceUinv(cut);
    const slope = (warp.paceU(ul + 1e-3) - warp.paceU(ul - 1e-3)) / 2e-3;
    assert(Math.abs(slope - 1) < 0.02, `slope 1 at the cut ${cut} (${slope.toFixed(3)})`);
  }
  assert(maxSeam < 1.12, `seam speed ratio ${maxSeam.toFixed(3)} >= 1.12`);
  // The plan's "spread of world speed per 100 px across chapters < 35%" cannot hold together with its own
  // model: the target speed follows the camera's height (h^0.6, a low pass is slower in world units) and
  // keeps 35% of today's balance (Q3), and today's spread is 131%. What is asserted instead: the spread
  // of world speed does not grow, the spread of perceived speed (v/h^0.6) falls by a fifth or more, and
  // the camera's acceleration per pixel (95th percentile) is no worse than today's.
  const base = JSON.parse(readFileSync(new URL('./pace-baseline.json', import.meta.url), 'utf8'));
  assert(spread <= base.spread, `world speed spread ${(spread * 100).toFixed(1)}% grew (today ${(base.spread * 100).toFixed(1)}%)`);
  assert(v6Spread <= base.v6Spread * 0.8, `v/h^0.6 spread ${(v6Spread * 100).toFixed(1)}% not 20% under today's ${(base.v6Spread * 100).toFixed(1)}%`);
  assert(accP95 <= base.accP95 * 1.05, `camera acceleration p95 ${(accP95 * 1e4).toFixed(2)} over today's ${(base.accP95 * 1e4).toFixed(2)}`);
  console.log(`vs today: world speed spread ${(base.spread * 100).toFixed(0)}% -> ${(spread * 100).toFixed(0)}%, v/h^0.6 spread ${(base.v6Spread * 100).toFixed(0)}% -> ${(v6Spread * 100).toFixed(0)}%, worst seam ${base.maxSeam.toFixed(2)} -> ${maxSeam.toFixed(2)}, cam acc p95 ${(base.accP95 * 1e4).toFixed(2)} -> ${(accP95 * 1e4).toFixed(2)}`);
  console.log('pace OK');
}
