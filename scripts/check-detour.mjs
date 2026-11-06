// Self-test for the office detour's scroll mapping (src/webgl/rig/detour.ts).
// Run: node --experimental-strip-types scripts/check-detour.mjs
//
// Story-t no longer stops in the detour: across the spacer it runs T_S -> T_E = T_S + D_T and u = (t - T_S) / D_T.
// Asserted: t(p) continuous and increasing (strictly inside the detour too), u = (t - T_S) / D_T while it runs and
// 0 outside, progressOf the exact inverse everywhere (including inside the detour), the ends fixed, W = 0 the
// identity, the cuts under their flares, and the office owning the frame exactly between the cuts.
import assert from 'node:assert';
import {
  T_S, T_E, D_T, DETOUR, MAX_U_RATE, detourMap, detourStart, detourWeight, flareAt, insideAt, progressOf, tOfU, uOfT,
} from '../src/webgl/rig/detour.ts';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
assert(near(T_E, T_S + D_T) && D_T > 0.005 && D_T < 0.03, 'D_T in range');
for (const w of [0, 1 / 11, 120 / 1220, 0.2]) {
  // ends
  assert(near(detourMap(0, w).t, 0) && near(detourMap(1, w).t, 1), `ends at w=${w}`);
  // monotone, continuous t; strictly increasing inside the detour
  let prev = 0;
  for (let i = 0; i <= 20000; i++) {
    const p = i / 20000;
    const { t, u, active } = detourMap(p, w);
    assert(t >= prev - 1e-12, `t monotone at p=${p}`);
    assert(t - prev < 0.001, `t continuous at p=${p} (jump ${t - prev})`);
    if (active) {
      assert(i === 0 || t > prev, `t strictly increasing in the detour at p=${p}`);
      assert(near(u, (t - T_S) / D_T, 1e-9), `u = (t - T_S) / D_T at p=${p}`);
    } else assert(u === 0, `u is 0 outside the detour (p=${p})`);
    prev = t;
  }
  if (w > 0) {
    const ps = detourStart(w);
    assert(near(ps, (T_S * (1 - w)) / (1 - D_T)));
    assert(near(detourMap(ps - 1e-9, w).t, T_S, 1e-6), 'left edge meets T_S');
    assert(near(detourMap(ps + w + 1e-9, w).t, T_E, 1e-6), 'right edge meets T_E');
    const mid = detourMap(ps + w / 2, w);
    assert(near(mid.u, 0.5) && near(mid.t, T_S + D_T / 2), 'u and t run together');
    // the rest of the story keeps its proportions: equal slopes either side
    const k = (detourMap(ps * 0.5 + 1e-4, w).t - detourMap(ps * 0.5, w).t) / 1e-4;
    const k2 = (detourMap(ps + w + 0.05 + 1e-4, w).t - detourMap(ps + w + 0.05, w).t) / 1e-4;
    assert(near(k, k2, 1e-6), 'same slope before and after the detour');
  } else {
    assert(near(detourMap(0.3, w).t, 0.3) && !detourMap(0.795, w).active, 'w = 0 is the identity, no office');
  }
  // round trip, both ways, everywhere (inside the detour too)
  for (let t = 0; t <= 1.000001; t += 0.0005) {
    const tt = Math.min(t, 1);
    assert(near(detourMap(progressOf(tt, w), w).t, tt, 1e-9), `round trip t=${tt} at w=${w}`);
  }
  for (let i = 0; i <= 1000; i++) {
    const p = i / 1000;
    assert(near(progressOf(detourMap(p, w).t, w), p, 1e-9), `round trip p=${p} at w=${w}`);
  }
}
for (const u of [0, 0.2, 0.45, 1]) assert(near(uOfT(tOfU(u)), u), `tOfU/uOfT u=${u}`);
// the cuts sit under the flare; the office owns the frame exactly between them
assert(detourWeight(0) === 0 && detourWeight(1) === 0 && detourWeight(0.5) === 1 && detourWeight(DETOUR.cutIn - 1e-6) === 0 && detourWeight(DETOUR.cutOut) === 0);
assert(flareAt(DETOUR.cutIn) > 0.99 && flareAt(DETOUR.cutOut) > 0.99 && flareAt(0.3) < 1e-3 && flareAt(0) === 0);
assert(!insideAt(DETOUR.cutIn - 1e-3) && insideAt(DETOUR.cutIn) && insideAt(DETOUR.cutOut - 1e-3) && !insideAt(DETOUR.cutOut));
assert(MAX_U_RATE > 0 && MAX_U_RATE <= 2, 'the detour speed cap is kept');
const w = 120 / 1220;
console.log(`detour OK: T_S=${T_S} D_T=${D_T} T_E=${T_E.toFixed(4)} W=${w.toFixed(4)} Ps=${detourStart(w).toFixed(4)} ends ${(detourStart(w) + w).toFixed(4)}`);
