// Self-test for the office detour's scroll mapping (src/webgl/rig/detour.ts).
// Run: node --experimental-strip-types scripts/check-detour.mjs
import assert from 'node:assert';
import { T_S, detourMap, detourStart, detourWeight, flareAt, insideAt, progressOf, DETOUR } from '../src/webgl/rig/detour.ts';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
for (const w of [0, 1 / 11, 120 / 1220, 0.2]) {
  // ends
  assert(near(detourMap(0, w).t, 0) && near(detourMap(1, w).t, 1), `ends at w=${w}`);
  // monotone, continuous t
  let prev = 0;
  for (let i = 0; i <= 20000; i++) {
    const p = i / 20000;
    const { t, u } = detourMap(p, w);
    assert(t >= prev - 1e-12, `t monotone at p=${p}`);
    assert(t - prev < 0.001, `t continuous at p=${p} (jump ${t - prev})`);
    assert(u >= 0 && u <= 1);
    prev = t;
  }
  if (w > 0) {
    const ps = detourStart(w);
    assert(near(ps, T_S * (1 - w)));
    assert(near(detourMap(ps - 1e-9, w).t, T_S, 1e-6), 'left edge meets T_S');
    assert(near(detourMap(ps + w + 1e-9, w).t, T_S, 1e-6), 'right edge meets T_S');
    assert(near(detourMap(ps + w / 2, w).u, 0.5) && detourMap(ps + w / 2, w).t === T_S, 'u runs while t holds');
  }
  // round trip
  for (const t of [0, 0.3, 0.6, 0.78, 0.8, 0.95, 1]) assert(near(detourMap(progressOf(t, w), w).t, t, 1e-9), `round trip t=${t}`);
  if (w > 0) for (const u of [0.1, 0.5, 0.9]) assert(near(detourMap(progressOf(T_S, w, u), w).u, u, 1e-9), `round trip u=${u}`);
}
// the frame is the main rig's at both ends, and the cuts sit under the flare
assert(detourWeight(0) === 0 && detourWeight(1) === 0 && detourWeight(0.5) === 1);
assert(flareAt(DETOUR.cutIn) > 0.99 && flareAt(DETOUR.cutOut) > 0.99 && flareAt(0.3) < 1e-3 && flareAt(0) === 0);
assert(!insideAt(0.079) && insideAt(0.08) && insideAt(0.659) && !insideAt(0.66));
const w = 120 / 1220;
console.log(`detour OK: W=${w.toFixed(4)} Ps=${detourStart(w).toFixed(4)} ends ${(detourStart(w) + w).toFixed(4)}`);
